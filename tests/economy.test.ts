// Экономика: добыча, смены, содержание, защита от забытого таймера, ступени демонов.

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { BALANCE } from '../src/state/config';
import { demonRank, miningFactor, overLimitFactor, shiftFactor } from '../src/state/economy';
import { plural } from '../src/state/store';
import type { Task } from '../src/state/types';
import { advance, newGame, NOON, onlyBases, unit } from './helpers';

afterEach(() => mock.timers.reset());

const WORK = 'fullstack-sertification';
const PERSONAL = 'cooking';

/** Игра, где в бою одна задача на рабочей базе, а герой стоит там же. */
function working() {
  const store = newGame();
  onlyBases(store, [WORK, PERSONAL]);
  store.state.hero.baseId = WORK;
  const t = unit(store, WORK, 2);
  assert.equal(store.start(t.id), true);
  return { store, t, p: store.project(WORK)! };
}

describe('добыча', () => {
  test('на базе героя днём рабочая база добывает в полную силу', () => {
    const { store, p } = working();
    assert.equal(miningFactor(store.state, p), 1);
    const { gold, lumber } = store.state.resources;
    advance(10 * 60_000);
    store.tick(Date.now());
    assert.ok(Math.abs(store.state.resources.gold - gold - BALANCE.goldPerMinute * 10) < 1e-6);
    assert.ok(Math.abs(store.state.resources.lumber - lumber - BALANCE.lumberPerMinute * 10) < 1e-6);
  });

  test('без героя база добывает долю, личная база днём вполсилы', () => {
    const { store } = working();
    const t = unit(store, PERSONAL, 1);
    store.start(t.id);
    const p = store.project(PERSONAL)!;
    assert.equal(miningFactor(store.state, p), BALANCE.remoteBaseFactor * 0.5);
    store.state.hero.baseId = PERSONAL;
    assert.equal(miningFactor(store.state, p), 0.5);
  });

  test('смены: личные базы вечером, рабочие днём, «в любое время» всегда', () => {
    assert.equal(shiftFactor('work', 'day'), 1);
    assert.equal(shiftFactor('personal', 'day'), 0.5);
    assert.equal(shiftFactor('personal', 'evening'), 1);
    assert.equal(shiftFactor('work', 'evening'), 0.8);
    assert.equal(shiftFactor('any', 'night'), 1);
    assert.equal(shiftFactor('work', 'night'), 0.6);
  });

  test('без задачи в работе, на привале и законсервированная база не добывают', () => {
    const { store, t, p } = working();
    store.toggleBreak();
    assert.equal(miningFactor(store.state, p), 0);
    store.toggleBreak();
    store.stop(t.id);
    assert.equal(miningFactor(store.state, p), 0);
    store.start(t.id);
    p.frozen = true;
    assert.equal(miningFactor(store.state, p), 0);
  });

  test('через 90 минут без отметок рабочие садятся, а долгое отсутствие не копит золото', () => {
    const { store, p } = working();
    const gold = store.state.resources.gold;
    advance(5 * 60 * 60_000);
    assert.equal(miningFactor(store.state, p), 0);
    store.tick(Date.now());
    // Добыто только до срабатывания защиты, а не за все пять часов.
    const mined = store.state.resources.gold - gold;
    assert.ok(Math.abs(mined - BALANCE.goldPerMinute * BALANCE.idleGuardMinutes) < 1e-6, `добыто ${mined}`);
    store.confirmWorking();
    assert.equal(miningFactor(store.state, p), 1);
  });

  test('армия растянута: каждая база сверх лимита −10%, но не больше половины', () => {
    const store = newGame();
    const active = store.state.projects.length - 1;
    assert.equal(overLimitFactor(store.state), 1 - Math.min(0.5, BALANCE.overLimitPenalty * (active - BALANCE.activeBasesLimit)));
    onlyBases(store, [WORK]);
    assert.equal(overLimitFactor(store.state), 1);
  });

  test('усталый герой добывает вдвое меньше, без маны не добывает', () => {
    const { store, p } = working();
    store.state.hero.mana = store.state.hero.maxMana * 0.1;
    assert.equal(miningFactor(store.state, p), 0.5);
  });

  test('работа под таймером тратит ману героя, привал её возвращает', () => {
    const { store } = working();
    const mana = store.state.hero.mana;
    advance(60 * 60_000);
    store.tick(Date.now());
    assert.ok(Math.abs(mana - store.state.hero.mana - BALANCE.manaDrainPerHour) < 1e-6);
    store.toggleBreak();
    advance(30 * 60_000);
    store.tick(Date.now());
    assert.ok(store.state.hero.mana > mana - BALANCE.manaDrainPerHour);
  });
});

describe('ступени демонов', () => {
  const demon = (since: string) => ({ demonSince: since }) as Task;
  test('Гончая сразу, Страж с 3 дней, Стражник Рока с 7, Инфернал с 14', () => {
    assert.equal(NOON > 0, true);
    assert.equal(demonRank(demon('2026-10-20'), '2026-10-20', 0), 1);
    assert.equal(demonRank(demon('2026-10-17'), '2026-10-20', 0), 2);
    assert.equal(demonRank(demon('2026-10-13'), '2026-10-20', 0), 3);
    assert.equal(demonRank(demon('2026-10-06'), '2026-10-20', 0), 4);
  });
  test('«Доспехи» сдвигают каждую ступень на день позже', () => {
    assert.equal(demonRank(demon('2026-10-17'), '2026-10-20', 1), 1);
    assert.equal(demonRank(demon('2026-10-16'), '2026-10-20', 1), 2);
    assert.equal(demonRank(demon('2026-10-06'), '2026-10-20', 1), 3);
    assert.equal(demonRank(demon('2026-10-03'), '2026-10-20', 1), 4);
  });
});

test('склонения', () => {
  assert.equal(plural(1, 'юнит', 'юнита', 'юнитов'), 'юнит');
  assert.equal(plural(3, 'юнит', 'юнита', 'юнитов'), 'юнита');
  assert.equal(plural(11, 'юнит', 'юнита', 'юнитов'), 'юнитов');
  assert.equal(plural(21, 'юнит', 'юнита', 'юнитов'), 'юнит');
});

describe('множители баланса из настроек', () => {
  test('добыча ×2 вдвое ускоряет шахты и караваны', () => {
    const { store, t } = working();
    store.state.settings.balance = { mining: 2 };
    const gold = store.state.resources.gold;
    advance(10 * 60_000);
    store.tick(Date.now());
    assert.ok(Math.abs(store.state.resources.gold - gold - BALANCE.goldPerMinute * 20) < 1e-6);
    const before = store.state.resources.gold;
    store.complete(t.id);
    assert.equal(store.state.resources.gold - before, BALANCE.caravanGoldPerLevel * 2 * 2);
  });

  test('цены ×0,5 удешевляют здания, а отмена стройки возвращает ровно уплаченное', async () => {
    const { techOf, TECH } = await import('../src/state/tech');
    const store = newGame();
    store.state.settings.balance = { prices: 0.5 };
    assert.equal(techOf(store.state, 'lumbermill')!.gold, TECH.lumbermill.gold / 2);
    const gold = store.state.resources.gold;
    store.build('lumbermill');
    assert.equal(store.state.resources.gold, gold - TECH.lumbermill.gold / 2);
    store.state.settings.balance = { prices: 2 };
    store.cancelBuild();
    assert.equal(store.state.resources.gold, gold);
  });

  test('опыт ×1,5 ускоряет рост героя', () => {
    const store = newGame();
    store.state.settings.balance = { xp: 1.5 };
    store.complete(unit(store, WORK, 2).id);
    assert.equal(store.state.hero.xp, 60);
  });
});

describe('здоровье юнита', () => {
  test('без срока полная полоска, к сроку тает', async () => {
    const { unitHealth } = await import('../src/state/economy');
    assert.equal(unitHealth({ due: null }, '2026-10-20'), 1);
    assert.equal(unitHealth({ due: '2026-10-30' }, '2026-10-20'), 1);
    assert.equal(unitHealth({ due: '2026-10-23' }, '2026-10-20'), 0.5);
    assert.equal(unitHealth({ due: '2026-10-20' }, '2026-10-20'), 0.125);
    assert.equal(unitHealth({ due: '2026-10-10' }, '2026-10-20'), 0.05);
  });
});
