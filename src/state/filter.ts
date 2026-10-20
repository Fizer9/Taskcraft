// Поиск и фильтры в панели свитков: по словам в названии, проекту, уровню и статусу.

import { isDemon, isOpen } from './economy';
import type { GameState, Task } from './types';

export type StatusFilter = 'open' | 'inbox' | 'hired' | 'active' | 'demon' | 'done' | 'cancelled' | 'all';

export interface TaskFilter {
  /** Слова из названия, все должны встретиться. */
  q: string;
  /** '' все проекты, '-' без проекта, иначе id проекта. */
  projectId: string;
  /** '' любой, '0' без уровня, '1'–'4' уровень. */
  level: string;
  status: StatusFilter;
}

export const DEFAULT_FILTER: TaskFilter = { q: '', projectId: '', level: '', status: 'open' };

export const STATUS_NAMES: Record<StatusFilter, string> = {
  open: 'Открытые',
  inbox: 'Входящие',
  hired: 'В казарме',
  active: 'В работе',
  demon: 'Демоны',
  done: 'Готовые',
  cancelled: 'Отменённые',
  all: 'Все',
};

export function isDefaultFilter(f: TaskFilter): boolean {
  return !f.q.trim() && !f.projectId && !f.level && f.status === 'open';
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

function statusMatches(t: Task, status: StatusFilter): boolean {
  if (status === 'open') return isOpen(t);
  if (status === 'demon') return isDemon(t);
  return status === 'all' || t.status === status;
}

/** Порядок в выдаче: демоны, в работе, казарма, входящие, потом готовые от свежих. */
function rank(t: Task): number {
  if (isDemon(t)) return 0;
  return { active: 1, hired: 2, inbox: 3, done: 4, cancelled: 5 }[t.status];
}

export function filterTasks(state: GameState, f: TaskFilter): Task[] {
  const words = norm(f.q).split(/\s+/).filter(Boolean);
  return state.tasks
    .filter((t) => {
      if (!statusMatches(t, f.status)) return false;
      if (f.projectId === '-' ? t.projectId : f.projectId && t.projectId !== f.projectId) return false;
      if (f.level === '0' ? t.level : f.level && String(t.level) !== f.level) return false;
      const title = norm(t.title);
      return words.every((w) => title.includes(w));
    })
    .sort((a, b) => rank(a) - rank(b) || (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt));
}
