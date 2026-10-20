// Дерево технологий: что можно строить, цены, стройка только под таймером, что открывают здания.

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { canRepeat, canSubtasks, techBlock, TECH, weaponBonus } from '../src/state/tech';
import { advance, newGame, onlyBases, unit } from './helpers';

afterEach(() => mock.timers.reset());

const BASE = 'fullstack-sertification';

function rich() {
  const store = newGame((s) => (s.resources = { gold: 5000, lumber: 5000 }));
  onlyBases(store, [BASE]);
  return store;
}

describe('стройка', () => {
  test('порядок: крепость после лесопилки, здания второго тира только в крепости', () => {
    const store = rich();
    assert.match(techBlock(store.state, 'keep')!, /лесопилка/);
    assert.match(techBlock(store.state, 'workshop')!, /Нужна крепость/);
    assert.equal(techBlock(store.state, 'lumbermill'), null);
    store.state.resources.gold = 10;
    assert.equal(techBlock(store.state, 'lumbermill'), 'Не хватает золота.');
  });

  test('стройка берёт цену сразу и идёт только пока тикает таймер работы', () => {
    const store = rich();
    store.build('lumbermill');
    const c = store.state.construction!;
    assert.equal(c.id, 'lumbermill');
    assert.equal(store.state.resources.gold, 5000 - TECH.lumbermill.gold);
    assert.equal(store.state.resources.lumber, 5000 - TECH.lumbermill.lumber);
    assert.match(techBlock(store.state, 'keep')!, /Рабочие заняты|лесопилка/);
    // Без задачи в работе стройка стоит.
    advance(10 * 60_000);
    store.tick(Date.now());
    assert.equal(store.state.construction!.leftMs, c.totalMs);
    // С задачей под таймером на базе героя идёт.
    store.state.hero.baseId = BASE;
    store.start(unit(store, BASE).id);
    for (let m = 0; m < TECH.lumbermill.minutes; m += 5) {
      advance(5 * 60_000);
      store.tick(Date.now());
    }
    assert.equal(store.state.construction, undefined);
    assert.equal(canSubtasks(store.state), true);
    assert.equal(canRepeat(store.state), false);
  });

  test('отмена стройки возвращает всё', () => {
    const store = rich();
    store.build('lumbermill');
    store.cancelBuild();
    assert.equal(store.state.construction, undefined);
    assert.deepEqual(store.state.resources, { gold: 5000, lumber: 5000 });
  });

  test('«Оружие» кузницы добавляет урона по крепостям', () => {
    const store = rich();
    store.state.smith = { weapons: 2 };
    assert.equal(weaponBonus(store.state), 2);
    store.complete(unit(store, BASE, 1).id);
    assert.equal(store.project(BASE)!.fortressHp, store.project(BASE)!.fortressMaxHp - 3);
  });

  test('улучшения кузницы дорожают по ступеням и требуют кузницу и тир', () => {
    const store = rich();
    store.state.tier = 2;
    assert.match(techBlock(store.state, 'armor')!, /кузница/);
    store.state.buildings = { blacksmith: true };
    assert.equal(techBlock(store.state, 'armor'), null);
    store.state.smith = { armor: 1 };
    assert.equal(techBlock(store.state, 'armor'), null);
    store.state.smith = { armor: 2 };
    assert.match(techBlock(store.state, 'armor')!, /замок/);
  });
});
