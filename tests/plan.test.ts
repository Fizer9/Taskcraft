// Утреннее планирование: сколько угодно задач одного проекта, дерево за каждую новую.

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { BALANCE } from '../src/state/config';
import { newGame, unit } from './helpers';

afterEach(() => mock.timers.reset());

test('в план дня берутся все отмеченные задачи проекта, за каждую новую дерево', () => {
  const store = newGame();
  const a = [1, 2, 3, 4].map((i) => unit(store, 'dating', 1, `Свидание ${i}`).id);
  const b = unit(store, 'cooking', 1, 'Борщ').id;
  const lumber = store.state.resources.lumber;
  store.planDay([...a, b, a[0]]);
  assert.deepEqual(store.state.dayPlan!.taskIds, [...a, b]);
  assert.equal(store.state.resources.lumber - lumber, 5 * BALANCE.planLumberPerTask);
  store.planDay([...a, b]);
  assert.equal(store.state.resources.lumber - lumber, 5 * BALANCE.planLumberPerTask, 'повторный план дерева не даёт');
});
