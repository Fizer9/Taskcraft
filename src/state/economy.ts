// Живая база, раздел 4: добыча идёт, только пока задача в работе.
// Здесь только чистые функции, состояние меняет store.ts.

import { BALANCE } from './config';
import type { GameState, Level, Project } from './types';

export type Shift = 'day' | 'evening' | 'night' | 'weekend';

export const SHIFT_NAMES: Record<Shift, string> = {
  day: 'Дневная смена',
  evening: 'Вечерняя смена',
  night: 'Ночь',
  weekend: 'Выходной',
};

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function currentShift(state: GameState, now = new Date()): Shift {
  const s = state.settings;
  const mins = now.getHours() * 60 + now.getMinutes();
  const isoDay = now.getDay() === 0 ? 7 : now.getDay();
  const awake = mins >= minutesOf(s.wakeUp) && mins < minutesOf(s.bedtime);
  if (!awake) return 'night';
  if (!s.workDays.includes(isoDay)) return 'weekend';
  if (mins >= minutesOf(s.dayStart) && mins < minutesOf(s.dayEnd)) return 'day';
  if (mins >= minutesOf(s.dayEnd)) return 'evening';
  return 'evening'; // утро до начала смены считаем личным временем
}

/** Сколько базы этого типа добывают в текущую смену (личные днём дремлют). */
export function shiftFactor(kind: Project['kind'], shift: Shift): number {
  if (kind === 'any') return 1;
  if (shift === 'day') return kind === 'work' ? 1 : 0.5;
  if (shift === 'evening' || shift === 'weekend') return kind === 'personal' ? 1 : 0.8;
  return 0.6; // ночь
}

/** Работа вне своей смены и ночью тратит ману быстрее. */
export function manaDrainFactor(kind: Project['kind'], shift: Shift): number {
  if (shift === 'night') return 1.5;
  if (kind === 'work' && shift !== 'day') return 1.5;
  return 1;
}

export function foodCap(state: GameState): number {
  return BALANCE.hallFood + state.farms;
}

export function foodUsed(state: GameState): number {
  return state.tasks.filter((t) => t.status === 'active').length;
}

export function upkeep(state: GameState) {
  const used = foodUsed(state);
  let tier = BALANCE.upkeep[0];
  for (const u of BALANCE.upkeep) if (used >= u.from) tier = u;
  return tier;
}

/** Рабочие сели отдыхать, потому что давно не было отметок. */
export function idleGuardTripped(state: GameState, now = Date.now()): boolean {
  return now - state.lastConfirmAt > BALANCE.idleGuardMinutes * 60_000;
}

export function activeTaskOf(state: GameState, projectId: string) {
  return state.tasks.find((t) => t.status === 'active' && t.projectId === projectId);
}

export function isTired(state: GameState): boolean {
  return state.hero.mana < state.hero.maxMana * BALANCE.tiredThreshold;
}

/** Множитель добычи базы прямо сейчас, 0 если база стоит. */
export function miningFactor(state: GameState, project: Project, now = new Date()): number {
  if (project.frozen || state.onBreak) return 0;
  if (!activeTaskOf(state, project.id)) return 0;
  if (idleGuardTripped(state, now.getTime())) return 0;
  const heroHere = state.hero.baseId === project.id;
  let f = heroHere ? 1 : BALANCE.remoteBaseFactor;
  f *= shiftFactor(project.kind, currentShift(state, now));
  f *= upkeep(state).factor;
  if (heroHere && isTired(state)) f *= 0.5;
  if (heroHere && state.hero.mana <= 0) f = 0;
  return f;
}

export function xpForLevel(level: number): number {
  const t = BALANCE.heroXpTable;
  return t[Math.min(level, t.length - 1)];
}

/** Калибровка: какой уровень подходит под реально потраченное время. */
export function levelBySpentTime(spentMs: number): Level {
  const h = spentMs / 3_600_000;
  if (h <= 0.75) return 1;
  if (h <= 3) return 2;
  if (h <= 10) return 3;
  return 4;
}
