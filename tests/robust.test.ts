// Надёжность: битое сохранение не роняет игру, отбой после полуночи не ломает день,
// рассвет приходит утром по местному времени в любом часовом поясе.

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { Store } from '../src/state/store';
import { repairState } from '../src/state/repair';
import { currentShift, summaryDue } from '../src/state/economy';
import { newGame } from './helpers';

afterEach(() => {
  mock.timers.reset();
  process.env.TZ = 'UTC';
});

test('пустое сохранение чинится до игры, которая тикает без ошибок', () => {
  newGame();
  const s = repairState({ tasks: [], projects: [], hero: {}, resources: {}, settings: {} });
  const store = new Store(s);
  store.tick();
  assert.ok(Number.isFinite(store.state.resources.gold));
  assert.ok(store.state.projects.some((p) => p.id === 'main'), 'главная ратуша на месте');
  assert.match(store.state.settings.wakeUp, /^\d{1,2}:\d{2}$/);
});

test('битые задачи отбрасываются, а задача с несуществующим проектом уходит во входящие', () => {
  newGame();
  const s = repairState({ tasks: [{ id: 'a', title: 'Ок', projectId: 'нет-такого', level: 9, status: '??' }, { title: 'без id' }, 5], projects: [], hero: {}, settings: {} });
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].projectId, null);
  assert.equal(s.tasks[0].level, null);
  assert.equal(s.tasks[0].status, 'inbox');
});

test('отбой после полуночи: днём день, вечером вечер, итоги дня только к ночи', () => {
  const store = newGame((s) => {
    s.settings.wakeUp = '09:00';
    s.settings.bedtime = '01:00';
  });
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 20, h, m));
  assert.equal(currentShift(store.state, at(10)), 'day');
  assert.equal(currentShift(store.state, at(23, 30)), 'evening');
  assert.equal(currentShift(store.state, at(0, 40)), 'evening');
  assert.equal(currentShift(store.state, at(3)), 'night');
  assert.equal(summaryDue(store.state, at(12)), false);
  assert.equal(summaryDue(store.state, at(0, 40)), true);
  assert.equal(summaryDue(store.state, at(8, 30)), true, 'до подъёма это ещё вечер прошлого дня');
});

test('рассвет по местному времени: в Лос-Анджелесе мана восстанавливается утром, а не в 17:00', () => {
  process.env.TZ = 'America/Los_Angeles';
  // 20 октября 2026, 16:30 по Лос-Анджелесу = 23:30 UTC.
  const evening = Date.UTC(2026, 9, 20, 23, 30);
  const store = newGame((s) => {
    s.lastDawn = '2026-10-20';
    s.hero.mana = 10;
  });
  store.tick(evening);
  store.tick(evening + 60 * 60_000); // 17:30 местного, полночь UTC позади
  assert.equal(store.state.hero.mana < store.state.hero.maxMana, true, 'вечером рассвета нет');
  store.tick(Date.UTC(2026, 9, 21, 15, 0)); // 08:00 местного 21 октября
  assert.equal(store.state.hero.mana, store.state.hero.maxMana);
  assert.equal(store.state.lastDawn, '2026-10-21');
});
