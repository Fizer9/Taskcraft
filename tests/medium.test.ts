// Средние баги из проверки 22 октября: план дня, быстрая строка, сроки демонов, крепости,
// пробуждение Легиона, мана после отсутствия, скверна, совет земель, законсервированные базы.

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { BALANCE } from '../src/state/config';
import { isDemon, legionAsleep, sphereReport } from '../src/state/economy';
import { parseQuick } from '../src/state/quick';
import { DAY, advance, newGame, night, onlyBases, unit } from './helpers';

afterEach(() => mock.timers.reset());

test('дерево за план дня даётся за задачу один раз, сделанные задачи из плана не выпадают', () => {
  const store = newGame();
  const base = store.state.projects[1].id;
  onlyBases(store, [base]);
  const [a, b, c] = [unit(store, base, 1, 'A'), unit(store, base, 1, 'B'), unit(store, base, 1, 'C')];
  const lumber = () => store.state.resources.lumber;
  const l0 = lumber();
  store.planDay([a.id, b.id, c.id]);
  assert.equal(lumber(), l0 + 3 * BALANCE.planLumberPerTask);
  store.planDay([b.id, c.id]);
  store.planDay([a.id, b.id, c.id]);
  assert.equal(lumber(), l0 + 3 * BALANCE.planLumberPerTask, 'снять и отметить снова: дерева нет');
  store.complete(a.id);
  store.planDay([b.id, c.id]); // окно показывает только открытые задачи
  assert.deepEqual(store.state.dayPlan!.taskIds.sort(), [a.id, b.id, c.id].sort(), 'план «1 из 3», а не «0 из 2»');
});

test('быстрая строка: несуществующие и прошедшие даты остаются в названии, дни недели только целым словом', () => {
  const store = newGame();
  const today = '2026-10-23'; // пятница
  const q = (line: string) => parseQuick(store.state, line, today);
  for (const bad of ['@31.02', '@99.99', '@32.13', '@2026-02-30', '@2026-13-45', '@2026-01-05']) {
    const r = q(`Дело ${bad}`);
    assert.equal(r.due, null, bad);
    assert.deepEqual(r.bad, [bad]);
    assert.equal(r.title, `Дело ${bad}`);
  }
  assert.deepEqual([q('Срочно сделать @срочно').due, q('Срочно сделать @срочно').title], [null, 'Срочно сделать @срочно']);
  assert.equal(q('Купить @втулка').due, null);
  assert.equal(q('Отчёт @пятницу').due, '2026-10-30');
  assert.equal(q('Отчёт @понедельник').due, '2026-10-26');
  assert.equal(q('Отчёт @вс').due, '2026-10-25');
  assert.equal(q('Отчёт @05.11').due, '2026-11-05');
  assert.equal(q('Отчёт @15.01').due, '2027-01-15');
  assert.equal(q('Купить хлеб !2').level, 2);
});

test('уровень без проекта остаётся у задачи во входящих', () => {
  const store = newGame();
  const t = store.addTask('Купить хлеб', null, 2);
  assert.equal(t.status, 'inbox');
  assert.equal(t.level, 2);
});

test('перенос срока демона на прошедший день отклоняется без платы', () => {
  const store = newGame();
  const base = store.state.projects[1].id;
  onlyBases(store, [base]);
  const t = unit(store, base, 1, 'Просрочка');
  t.due = '2026-10-15';
  t.demonSince = '2026-10-16';
  t.demonRank = 1;
  const lumber = store.state.resources.lumber;
  store.setDue(t.id, '2026-10-18');
  assert.equal(store.state.resources.lumber, lumber);
  assert.equal(t.due, '2026-10-15');
  assert.ok(isDemon(t));
  store.setDue(t.id, '2026-10-22');
  assert.ok(!isDemon(t), 'перенос на будущее прогоняет демона');
});

test('крепость, уменьшенная ниже нанесённого урона, пала: это победа; ✎ после победы ставит новую', () => {
  const store = newGame();
  const p = store.state.projects[1];
  p.fortressMaxHp = 40;
  p.fortressHp = 16;
  store.updateProject(p.id, { hp: 20 });
  assert.equal(p.fortressHp, 0);
  assert.ok(p.wonAt, 'победа записана');
  store.updateProject(p.id, { hp: 20 });
  assert.equal(p.fortressHp, 20, 'тот же размер начинает новую крепость');
  assert.equal(p.wonAt, undefined);
});

test('Легион спит три полных дня: игра с понедельника днём просыпается в четверг утром', () => {
  const store = newGame((s) => {
    s.startedAt = Date.UTC(2026, 9, 19, 10, 1);
    s.settings.legion = 'normal';
  });
  assert.equal(legionAsleep(store.state, Date.UTC(2026, 9, 21, 23, 0)), true);
  assert.equal(legionAsleep(store.state, Date.UTC(2026, 9, 22, 7, 30)), false);
});

test('после нескольких дней отсутствия утро начинается с полной маной', () => {
  const fri = Date.UTC(2026, 9, 23, 7, 45);
  const store = newGame((s) => {
    s.lastTick = fri;
    s.lastConfirmAt = fri;
    s.lastDawn = '2026-10-23';
    s.lastLegionDay = '2026-10-23';
  });
  const s = store.state;
  const base = s.projects[1].id;
  onlyBases(store, [base]);
  const t = unit(store, base, 1, 'Работа');
  t.status = 'active';
  s.hero.baseId = base;
  s.hero.mana = 80;
  store.tick(Date.UTC(2026, 9, 26, 8, 0));
  assert.equal(s.hero.mana, s.hero.maxMana);
});

test('скверна горит за каждую ночь отсутствия, но не дольше, чем ползёт', () => {
  const store = newGame((s) => (s.startedAt = Date.UTC(2026, 8, 1)));
  const p = store.state.projects[1];
  onlyBases(store, [p.id]);
  p.lastActivityAt = Date.now() - (BALANCE.blightDays + 5) * DAY;
  store.state.lastLegionDay = '2026-10-10';
  store.tick();
  assert.equal(p.damage, 6 * BALANCE.blightDamagePerDay);
  advance(DAY);
  store.tick();
  assert.equal(p.damage, 7 * BALANCE.blightDamagePerDay, 'следующая ночь добавляет одну');
  void night;
});

test('совет земель считает крепость и задачи базы, ушедшей в зал славы', () => {
  const store = newGame((s) => (s.councilAt = Date.now() - DAY));
  const p = store.state.projects[1];
  onlyBases(store, [p.id]);
  const t = unit(store, p.id, 1, 'Сделано');
  store.complete(t.id);
  p.fortressHp = 0;
  p.wonAt = Date.now();
  store.enshrine(p.id);
  const r = sphereReport(store.state, p.sphereId);
  assert.equal(r.fortresses, 1);
  assert.equal(r.done, 1);
  assert.ok(r.bases >= 1);
});

test('в законсервированную базу юнит не нанимается', () => {
  const store = newGame();
  const p = store.state.projects[1];
  p.frozen = true;
  const t = store.addTask('Найм в замороженную', p.id, 1);
  assert.equal(t.status, 'inbox');
  assert.equal(t.projectId, p.id);
  assert.equal(t.level, 1);
});
