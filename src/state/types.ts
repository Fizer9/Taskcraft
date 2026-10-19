// Модель данных Taskcraft. Всё состояние игры это один JSON, который
// сохраняется в браузере и (если настроено) в секретном Gist.

export type Level = 1 | 2 | 3 | 4;

/** Путь задачи из дизайн-документа, раздел 6. */
export type TaskStatus = 'inbox' | 'hired' | 'active' | 'done' | 'cancelled';

/** Тип базы, раздел 5: рабочая, личная или в любое время. */
export type BaseKind = 'work' | 'personal' | 'any';

export interface Sphere {
  id: string;
  name: string;
  score: number;
  target: number;
}

export interface Project {
  id: string;
  name: string;
  sphereId: string;
  kind: BaseKind;
  /** Здоровье вражеской крепости: финальная цель проекта. */
  fortressHp: number;
  fortressMaxHp: number;
  /** Позиция базы на карте (клетка сетки). */
  slot: { x: number; z: number };
  frozen: boolean;
}

export interface Task {
  id: string;
  title: string;
  projectId: string | null;
  level: Level | null;
  status: TaskStatus;
  createdAt: number;
  /** Сколько миллисекунд задача провела в работе (для калибровки уровня). */
  spentMs: number;
  doneAt?: number;
  due?: string;
}

export interface Hero {
  id: string;
  name: string;
  level: number;
  xp: number;
  mana: number;
  maxMana: number;
  /** На какой базе стоит герой: там добыча идёт в полную силу. */
  baseId: string;
}

export interface Settings {
  dayStart: string; // "09:00"
  dayEnd: string; // "18:00"
  workDays: number[]; // 1 = пн ... 7 = вс
  wakeUp: string;
  bedtime: string;
}

export interface GameState {
  schema: 1;
  /** Номер ревизии: растёт при каждом сохранении в Gist, нужен для защиты от перезаписи. */
  rev: number;
  updatedAt: number;
  resources: { gold: number; lumber: number };
  spheres: Sphere[];
  projects: Project[];
  tasks: Task[];
  hero: Hero;
  farms: number;
  onBreak: boolean;
  /** Когда игрок последний раз подтвердил, что работает (защита от забытого таймера). */
  lastConfirmAt: number;
  lastTick: number;
  /** День последнего рассвета, "2026-10-19": по нему восстанавливается мана. */
  lastDawn: string;
  settings: Settings;
}

/** id главной ратуши: бытовые дела без финала, её нельзя выиграть или потерять. */
export const MAIN_HALL_ID = 'main';
