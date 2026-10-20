// Действия игрока: найм, бой, награды, переносы сроков с долгом, разбор входящих, базы в игре.

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { BALANCE, UNITS } from '../src/state/config';
import { activeBases, canThaw } from '../src/state/economy';
import { MAIN_HALL_ID } from '../src/state/types';
import { last, newGame, onlyBases, TODAY, unit } from './helpers';

afterEach(() => mock.timers.reset());

const BASE = 'fullstack-sertification';

describe('найм и бой', () => {
  test('свиток с базой и уровнем сразу юнит в казарме, за план +5 дерева', () => {
    const store = newGame();
    const lumber = store.state.resources.lumber;
    const t = unit(store, BASE, 2);
    assert.equal(t.status, 'hired');
    assert.equal(store.state.resources.lumber, lumber + BALANCE.hireLumber);
    const scroll = store.addTask('Просто мысль');
    assert.equal(scroll.status, 'inbox');
  });

  test('«Готово»: караван с золотом, опыт и удар по крепости уроном уровня', () => {
    const store = newGame();
    const t = unit(store, BASE, 3);
    store.start(t.id);
    const gold = store.state.resources.gold;
    store.complete(t.id);
    assert.equal(t.status, 'done');
    assert.equal(store.state.resources.gold, gold + BALANCE.caravanGoldPerLevel * 3);
    assert.equal(store.state.hero.xp, UNITS[3].xp);
    assert.equal(store.project(BASE)!.fortressHp, BALANCE.fortressHp - 3);
  });

  test('крепость падает, когда урон набран: миссия выиграна', () => {
    const store = newGame();
    const p = store.project(BASE)!;
    for (let i = 0; i < Math.ceil(BALANCE.fortressHp / 3); i++) store.complete(unit(store, BASE, 3).id);
    assert.equal(p.fortressHp, 0);
    assert.ok(p.wonAt);
    assert.match(store.events.map((e) => e.text).join('\n'), /крепость проекта .* пала/);
  });

  test('одна задача в работе на базу, еды хватает на три', () => {
    const store = newGame();
    onlyBases(store, [BASE, 'cooking', 'dating', 'friends']);
    assert.equal(store.start(unit(store, BASE).id), true);
    assert.equal(store.start(unit(store, BASE).id), false);
    assert.match(last(store), /Одна задача в работе/);
    store.start(unit(store, 'cooking').id);
    store.start(unit(store, 'dating').id);
    assert.equal(store.start(unit(store, 'friends').id), false, 'ферм не хватает');
    assert.equal(BALANCE.hallFood, 3);
  });

  test('отмена: юнит распущен без награды', () => {
    const store = newGame();
    const t = unit(store, BASE, 2);
    const gold = store.state.resources.gold;
    store.cancel(t.id);
    assert.equal(t.status, 'cancelled');
    assert.equal(store.state.resources.gold, gold);
  });

  test('задачи 4 уровня без грифоньего гнезда ложатся во входящие без уровня', () => {
    const store = newGame();
    const t = unit(store, BASE, 4);
    assert.equal(t.level, null);
    assert.equal(t.status, 'inbox');
    store.state.buildings = { aviary: true };
    assert.equal(unit(store, BASE, 4).level, 4);
  });

  test('подзадачи только с лесопилкой, до гнезда не больше трёх в отряде', () => {
    const store = newGame();
    const parent = unit(store, BASE, 3);
    assert.equal(store.addSubtask(parent.id, 'Шаг', 1), undefined);
    store.state.buildings = { lumbermill: true };
    for (let i = 0; i < 3; i++) assert.ok(store.addSubtask(parent.id, `Шаг ${i}`, 1));
    assert.equal(store.addSubtask(parent.id, 'Лишний', 1), undefined);
  });
});

describe('сроки и дерево', () => {
  test('поставить или приблизить срок бесплатно, отодвинуть стоит дерева', () => {
    const store = newGame();
    const t = unit(store, BASE, 2);
    const lumber = store.state.resources.lumber;
    store.setDue(t.id, '2026-10-25');
    store.setDue(t.id, '2026-10-23');
    assert.equal(store.state.resources.lumber, lumber);
    store.setDue(t.id, '2026-10-30');
    assert.equal(store.state.resources.lumber, lumber - BALANCE.rescheduleLumberPerLevel * 2);
  });

  test('без дерева перенос уходит в долг, и следующее дерево за план гасит его', () => {
    const store = newGame();
    const t = unit(store, BASE, 3);
    t.due = '2026-10-21';
    store.state.resources.lumber = 0;
    store.setDue(t.id, '2026-11-01');
    assert.equal(store.state.lumberDebt, BALANCE.rescheduleLumberPerLevel * 3);
    unit(store, BASE, 1);
    assert.equal(store.state.lumberDebt, BALANCE.rescheduleLumberPerLevel * 3 - BALANCE.hireLumber);
    assert.equal(store.state.resources.lumber, 0);
  });

  test('разбор входящих пачкой: нанять, датировать, сжечь одной сводкой', () => {
    const store = newGame();
    const a = store.addTask('Нанять');
    const b = store.addTask('Сжечь');
    const c = store.addTask('Со сроком');
    const lumber = store.state.resources.lumber;
    store.triage([
      { id: a.id, projectId: BASE, level: 1, due: null, drop: false },
      { id: b.id, projectId: null, level: null, due: null, drop: true },
      { id: c.id, projectId: null, level: null, due: '2026-10-25', drop: false },
    ]);
    assert.equal(a.status, 'hired');
    assert.equal(b.status, 'cancelled');
    assert.equal(c.due, '2026-10-25');
    assert.equal(store.state.resources.lumber, lumber + BALANCE.hireLumber);
    assert.match(last(store), /Входящие разобраны: нанято 1 юнит/);
  });
});

describe('базы в игре', () => {
  test('законсервированная база: задача в работе возвращается в казарму, герой уходит в ратушу', () => {
    const store = newGame();
    onlyBases(store, [BASE, 'cooking']);
    store.state.hero.baseId = BASE;
    const t = unit(store, BASE);
    store.start(t.id);
    store.freezeProject(BASE);
    assert.equal(store.project(BASE)!.frozen, true);
    assert.equal(t.status, 'hired');
    assert.equal(store.state.hero.baseId, MAIN_HALL_ID);
    assert.equal(store.start(t.id), false);
  });

  test('вернуть базу в игру можно только при свободном месте', () => {
    const store = newGame();
    const ids = store.state.projects.filter((p) => p.id !== MAIN_HALL_ID).map((p) => p.id);
    onlyBases(store, ids.slice(0, BALANCE.activeBasesLimit));
    assert.equal(canThaw(store.state), false);
    assert.equal(store.unfreezeProject(ids[BALANCE.activeBasesLimit]), false);
    store.freezeProject(ids[0]);
    assert.equal(store.unfreezeProject(ids[BALANCE.activeBasesLimit]), true);
    assert.equal(store.project(ids[BALANCE.activeBasesLimit])!.thawedOn, TODAY);
    assert.equal(activeBases(store.state).length, BALANCE.activeBasesLimit);
  });

  test('новый проект сверх лимита закладывается законсервированным', () => {
    const store = newGame();
    const p = store.createProject('Испанский', 'career', 'personal');
    assert.equal(p.frozen, true);
  });
});
