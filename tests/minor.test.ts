// Мелочи из проверки 22 октября: игровой день Молота бури, склонения, дерево за найм,
// второе дыхание, захват при входе, причина без Повелителя ужаса, починка сохранения.

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { BALANCE } from '../src/state/config';
import { gameDayAt } from '../src/state/economy';
import { repairState } from '../src/state/repair';
import { DAY, newGame, onlyBases, unit } from './helpers';

afterEach(() => mock.timers.reset());

test('игровой день момента: до подъёма это ещё вчера', () => {
  const store = newGame();
  assert.equal(gameDayAt(store.state, Date.UTC(2026, 9, 21, 0, 30)), '2026-10-20');
  assert.equal(gameDayAt(store.state, Date.UTC(2026, 9, 21, 9, 0)), '2026-10-21');
});

test('скверна и портал пишут числа с согласованием', () => {
  const store = newGame((s) => (s.startedAt = Date.UTC(2026, 8, 1)));
  const p = store.state.projects[1];
  onlyBases(store, [p.id]);
  p.lastActivityAt = Date.now() - 22 * DAY;
  for (let i = 0; i < 3; i++) store.addTask(`Свиток ${i}`).createdAt = Date.now() - 10 * DAY;
  store.state.lastLegionDay = '2026-10-19';
  store.tick();
  const texts = store.events.map((e) => e.text).join('\n');
  assert.match(texts, /22 дня без движения/);
  assert.match(texts, /3 неразобранные задачи/);
});

test('дерево за найм даётся один раз за задачу', () => {
  const store = newGame();
  const p = store.state.projects[1];
  onlyBases(store, [p.id]);
  const t = store.addTask('Дело');
  const l0 = store.state.resources.lumber;
  store.hire(t.id, p.id, 1);
  t.status = 'inbox';
  store.hire(t.id, p.id, 1);
  assert.equal(store.state.resources.lumber, l0 + BALANCE.hireLumber);
});

test('второе дыхание при полной мане не тратит попытку дня', () => {
  const store = newGame((s) => (s.hero.mana = s.hero.maxMana));
  mock.timers.setTime(Date.UTC(2026, 9, 20, 20, 0));
  store.secondWind();
  assert.notEqual(store.state.secondWindDay, '2026-10-20');
  store.state.hero.mana = 50;
  store.secondWind();
  assert.equal(store.state.secondWindDay, '2026-10-20');
  assert.equal(store.state.hero.mana, 50 + BALANCE.secondWindMana);
});

test('захват базы при входе не съедает последние полтора часа работы на ней', () => {
  const left = Date.UTC(2026, 9, 20, 18, 0);
  const store = newGame((s) => {
    s.startedAt = Date.UTC(2026, 8, 1);
    s.lastTick = left;
    s.lastConfirmAt = left;
  });
  const s = store.state;
  const p = s.projects[1];
  onlyBases(store, [p.id]);
  const t = unit(store, p.id, 1, 'Работа');
  t.status = 'active';
  s.hero.baseId = p.id;
  const d = unit(store, p.id, 1, 'Инфернал');
  d.due = '2026-09-25';
  d.demonSince = '2026-09-26';
  d.demonRank = 4;
  const gold = s.resources.gold;
  store.tick(Date.UTC(2026, 9, 21, 9, 0));
  assert.ok(p.capturedAt, 'база захвачена');
  assert.ok(s.resources.gold > gold, 'добыча за полтора часа до ухода начислена');
  assert.ok(t.spentMs >= 89 * 60_000);
});

test('без Повелителя ужаса совет называет верную причину', () => {
  const store = newGame((s) => (s.settings.legion = 'burning'));
  const s = store.state;
  s.spheres = [{ ...s.spheres[0], score: 4, target: 8 }];
  for (const p of s.projects) if (p.id !== 'main') p.frozen = true;
  s.councilMonth = '2026-09';
  store.holdCouncil([{ id: s.spheres[0].id, score: 4, target: 8 }]);
  const texts = store.events.map((e) => e.text).join('\n');
  assert.doesNotMatch(texts, /все сферы у цели/);
  assert.match(texts, /нет баз в игре/);
});

test('починка сохранения: сделанные задачи базы из зала славы помнят её, чужие id отбрасываются', () => {
  const s = repairState({
    tasks: [
      { id: 'a', title: 'Сделано', projectId: 'hall-1', status: 'done', createdAt: 1, spentMs: 0, due: '<x>' },
      { id: '"><img src=x>', title: 'Плохой id', projectId: null, status: 'inbox', createdAt: 1, spentMs: 0 },
    ],
    projects: [],
    hero: {},
    settings: {},
    dreadlord: { name: 5 },
  });
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].projectId, 'hall-1');
  assert.equal(s.tasks[0].due, undefined);
  assert.equal(s.dreadlord, undefined);
});
