// Пылающий Легион: демоны из просрочек, их рост, захват базы, отбивание и ремонт.

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { BALANCE } from '../src/state/config';
import { demonRank, demonsAt, miningFactor, repairCost } from '../src/state/economy';
import { MAIN_HALL_ID } from '../src/state/types';
import { advance, DAY, last, newGame, night, onlyBases, TODAY, unit } from './helpers';

afterEach(() => mock.timers.reset());

const BASE = 'dating';

function overdue(store: ReturnType<typeof newGame>, due = '2026-10-19', level: 1 | 2 | 3 = 1) {
  const t = unit(store, BASE, level, `Долг ${due}`);
  t.due = due;
  return t;
}

describe('демоны', () => {
  test('утром просроченная задача становится демоном у своей базы, срок сегодня ещё нет', () => {
    const store = newGame();
    const late = overdue(store);
    const fresh = overdue(store, TODAY);
    night(store);
    assert.equal(late.demonSince, TODAY);
    assert.equal(fresh.demonSince, undefined);
    assert.deepEqual(demonsAt(store.state, BASE).map((t) => t.id), [late.id]);
  });

  test('демон растёт с каждым днём, до Инфернала за две недели', () => {
    const store = newGame();
    const t = overdue(store);
    night(store);
    for (let d = 1; d <= 14; d++) {
      advance(DAY);
      night(store);
    }
    assert.equal(t.demonRank, 4);
  });

  test('«Доспехи» замедляют рост, ступень пересчитывается ночью', () => {
    const store = newGame((s) => (s.smith = { armor: 2 }));
    const t = overdue(store);
    t.demonSince = '2026-10-16';
    night(store);
    assert.equal(demonRank(t, TODAY, 0), 2);
    assert.equal(t.demonRank, 1);
  });

  test('у законсервированной базы Легион не появляется', () => {
    const store = newGame();
    const t = overdue(store);
    store.project(BASE)!.frozen = true;
    night(store);
    assert.equal(t.demonSince, undefined);
  });

  test('каждый демон снижает добычу базы, от трёх рабочие прячутся', () => {
    const store = newGame();
    onlyBases(store, [BASE]);
    store.state.hero.baseId = BASE;
    store.state.settings.dayStart = '13:00'; // вечер: личная база в полную силу
    const work = unit(store, BASE);
    store.start(work.id);
    const p = store.project(BASE)!;
    assert.equal(miningFactor(store.state, p), 1);
    overdue(store);
    night(store);
    assert.ok(Math.abs(miningFactor(store.state, p) - (1 - BALANCE.demonMiningPenalty)) < 1e-9);
    overdue(store, '2026-10-18');
    overdue(store, '2026-10-17');
    advance(DAY);
    night(store);
    assert.equal(miningFactor(store.state, p), 0);
  });

  test('перенос срока прогоняет демона за дерево, изгнание бесплатно', () => {
    const store = newGame();
    const a = overdue(store);
    const b = overdue(store);
    night(store);
    const lumber = store.state.resources.lumber;
    store.setDue(a.id, '2026-10-27');
    assert.equal(a.demonSince, undefined);
    assert.equal(store.state.resources.lumber, lumber - BALANCE.rescheduleLumberPerLevel);
    store.cancel(b.id);
    assert.equal(store.state.resources.lumber, lumber - BALANCE.rescheduleLumberPerLevel);
    assert.equal(demonsAt(store.state, BASE).length, 0);
  });
});

describe('захват базы', () => {
  function captured() {
    const store = newGame();
    onlyBases(store, [BASE, 'cooking']);
    store.state.hero.baseId = BASE;
    const ts = [1, 2, 3, 4, 5].map((i) => overdue(store, `2026-10-1${i}`));
    night(store);
    return { store, ts, p: store.project(BASE)! };
  }

  test('пять демонов захватывают базу: она выходит из игры в руинах, герой бежит в ратушу', () => {
    const { store, p } = captured();
    assert.ok(p.capturedAt);
    assert.equal(p.frozen, true);
    assert.equal(p.damage, 100);
    assert.equal(store.state.hero.baseId, MAIN_HALL_ID);
    assert.match(store.events.map((e) => e.text).join('\n'), /Легион захватил базу/);
  });

  test('Инфернал захватывает базу и в одиночку', () => {
    const store = newGame();
    overdue(store, '2026-10-01');
    night(store);
    assert.ok(store.project(BASE)!.capturedAt);
  });

  test('захваченную базу нельзя вернуть в игру и чинить', () => {
    const { store, p } = captured();
    assert.equal(store.unfreezeProject(BASE), false);
    const gold = store.state.resources.gold;
    store.repair(BASE);
    assert.equal(store.state.resources.gold, gold);
    assert.equal(p.damage, 100);
  });

  test('экран возвращения: разобрал всех демонов разом, и база отбита, а руины чинятся за золото', () => {
    const { store, ts, p } = captured();
    const gold = store.state.resources.gold;
    store.repelLegion([
      { id: ts[0].id, act: 'done' },
      { id: ts[1].id, act: 'done' },
      { id: ts[2].id, act: 'move', due: '2026-11-01' },
      { id: ts[3].id, act: 'banish' },
      { id: ts[4].id, act: 'banish' },
    ]);
    const text = store.events.map((e) => e.text).join('\n');
    assert.match(text, /Легион отброшен: повержено 2, перенесено 1, изгнано 2/);
    assert.match(text, /База «.*» отбита у Легиона! Она снова в игре/);
    assert.equal(p.capturedAt, undefined);
    assert.equal(p.frozen, false);
    assert.equal(store.state.resources.gold, gold + 2 * BALANCE.caravanGoldPerLevel);
    store.state.resources.gold = 1000;
    const cost = repairCost(p);
    store.repair(BASE);
    assert.equal(p.damage, 0);
    assert.equal(store.state.resources.gold, 1000 - cost);
    assert.match(last(store), /отремонтирована/);
  });

  test('пока у стен остался хоть один демон, база остаётся у Легиона', () => {
    const { store, ts, p } = captured();
    store.repelLegion(ts.slice(0, 4).map((t) => ({ id: t.id, act: 'banish' as const })));
    store.tick(Date.now());
    assert.ok(p.capturedAt);
  });
});
