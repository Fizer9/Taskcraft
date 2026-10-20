// Общая подготовка: игра из начального сохранения, часы остановлены на полудне вторника
// 20 октября 2026 (UTC), служебные окна дня уже пройдены.

import { mock } from 'node:test';
import { createInitialState } from '../src/state/seed';
import { Store } from '../src/state/store';
import { MAIN_HALL_ID, type GameState, type Level } from '../src/state/types';

export const DAY = 86_400_000;
export const NOON = Date.UTC(2026, 9, 20, 12, 0, 0);
export const TODAY = '2026-10-20';

/** Перевести остановленные часы вперёд. */
export function advance(ms: number) {
  mock.timers.tick(ms);
}

export function newGame(patch: (s: GameState) => void = () => {}): Store {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOON });
  const s = createInitialState(NOON);
  s.lastLegionDay = TODAY;
  s.lastDawn = TODAY;
  s.tutorialDone = NOON;
  patch(s);
  return new Store(s);
}

/** Оставить в игре только эти базы, остальные законсервировать: так лимит баз не мешает. */
export function onlyBases(store: Store, ids: string[]) {
  for (const p of store.state.projects) if (p.id !== MAIN_HALL_ID) p.frozen = !ids.includes(p.id);
}

/** Нанятая задача на базе. */
export function unit(store: Store, projectId: string, level: Level = 1, title = 'Задача') {
  return store.addTask(title, projectId, level);
}

/** Прогнать ночной подсчёт Легиона на сегодняшнее утро. */
export function night(store: Store) {
  store.state.lastLegionDay = null;
  store.tick(Date.now());
}

export function last(store: Store): string {
  return store.events[store.events.length - 1]?.text ?? '';
}
