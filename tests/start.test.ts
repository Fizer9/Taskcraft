// Новая игра из лобби: что закладывается, и как Легион спит первые дни и в мирном режиме.

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { BALANCE } from '../src/state/config';
import { demonsAt, isBlighted, legionAsleep, portalSize } from '../src/state/economy';
import { createInitialState } from '../src/state/seed';
import { Store } from '../src/state/store';
import { MAIN_HALL_ID, type LegionMode } from '../src/state/types';
import { advance, DAY, NOON, night } from './helpers';

afterEach(() => mock.timers.reset());

function lobby(legion: LegionMode = 'normal', projects = 2) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOON });
  const store = new Store(createInitialState(NOON));
  store.startGame({
    spheres: [
      { name: 'Здоровье', score: 4, target: 8 },
      { name: 'Карьера', score: 6, target: 8 },
    ],
    projects: Array.from({ length: projects }, (_, i) => ({ name: `Проект ${i + 1}`, sphere: i % 2, kind: 'work' as const, hp: 40 })),
    hero: 'archmage',
    settings: { ...store.state.settings, legion },
  });
  return store;
}

function overdue(store: Store, projectId: string, due: string) {
  const t = store.addTask(`Долг ${due}`, projectId, 1);
  t.due = due;
  return t;
}

describe('лобби новой игры', () => {
  test('новая игра без сохранения ждёт лобби, старые сохранения считаются настроенными', () => {
    assert.equal(new Store(createInitialState(NOON)).state.setupDone, undefined);
    const old = createInitialState(NOON, true);
    assert.ok(new Store(old).state.setupDone);
  });

  test('лобби закладывает сферы, базы, героя и считает совет этого месяца проведённым', () => {
    const s = lobby().state;
    assert.deepEqual(
      s.spheres.map((sp) => [sp.name, sp.score, sp.target]),
      [
        ['Здоровье', 4, 8],
        ['Карьера', 6, 8],
      ],
    );
    const bases = s.projects.filter((p) => p.id !== MAIN_HALL_ID);
    assert.deepEqual(
      bases.map((p) => [p.name, p.sphereId === s.spheres[bases.indexOf(p) % 2].id, p.fortressMaxHp, p.frozen]),
      [
        ['Проект 1', true, 40, false],
        ['Проект 2', true, 40, false],
      ],
    );
    assert.notDeepEqual(bases[0].slot, bases[1].slot);
    assert.equal(s.hero.kind, 'archmage');
    assert.equal(s.hero.name, 'Архимаг');
    assert.equal(s.councilMonth, '2026-10');
    assert.ok(s.setupDone && s.startedAt && s.tutorialDone);
  });

  test('проекты сверх лимита закладываются законсервированными', () => {
    const s = lobby('normal', BALANCE.activeBasesLimit + 2).state;
    assert.equal(s.projects.filter((p) => p.frozen).length, 2);
  });
});

describe('режимы Легиона', () => {
  test('первые дни новой игры Легион спит, потом приходят демоны, считая с пробуждения', () => {
    const store = lobby();
    const base = store.state.projects[1].id;
    overdue(store, base, '2026-10-20');
    advance(DAY);
    night(store);
    assert.equal(legionAsleep(store.state), true);
    assert.equal(demonsAt(store.state, base).length, 0);
    advance(BALANCE.quietDays * DAY);
    night(store);
    assert.equal(legionAsleep(store.state), false);
    const [demon] = demonsAt(store.state, base);
    assert.ok(demon);
    assert.equal(demon.demonSince, '2026-10-23');
  });

  test('в мирном режиме нет демонов, портала и скверны', () => {
    const store = lobby('peace');
    const base = store.state.projects[1].id;
    overdue(store, base, '2026-10-20');
    for (let i = 0; i < 4; i++) store.addTask(`Свиток ${i}`);
    advance(20 * DAY);
    night(store);
    assert.equal(demonsAt(store.state, base).length, 0);
    assert.equal(portalSize(store.state), 0);
    assert.equal(isBlighted(store.state, store.state.projects[1]), false);
  });

  test('пылающий Легион не спит и захватывает базу с трёх демонов', () => {
    const store = lobby('burning');
    const base = store.state.projects[1].id;
    for (const d of ['2026-10-17', '2026-10-18', '2026-10-19']) overdue(store, base, d);
    advance(DAY);
    night(store);
    assert.ok(store.project(base)!.capturedAt);
  });
});
