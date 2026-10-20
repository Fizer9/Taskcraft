// Дерево технологий людей, раздел 9 дизайна. Каждое здание открывает новую
// возможность трекера, так игра учит функциям по одной. Ратуша улучшается до
// крепости и замка, а стройка идёт только пока тикает таймер работы.

import { price } from './economy';
import type { BuildingId, GameState, Level, SmithId, TechId } from './types';

export type { BuildingId, SmithId, TechId };

export interface Tech {
  id: TechId;
  name: string;
  icon: string;
  /** Какой тир ратуши нужен: 1 ратуша, 2 крепость, 3 замок. */
  tier: number;
  requires: BuildingId[];
  gold: number;
  lumber: number;
  /** Сколько минут работы под таймером уходит на стройку. */
  minutes: number;
  /** Что открывает, одной строкой. */
  gives: string;
}

export const TECH: Record<BuildingId | 'keep' | 'castle', Tech> = {
  lumbermill: {
    id: 'lumbermill',
    name: 'Лесопилка',
    icon: '🪚',
    tier: 1,
    requires: [],
    gold: 300,
    lumber: 100,
    minutes: 60,
    gives: 'Подзадачи: большую задачу можно разбить на отряд.',
  },
  keep: {
    id: 'keep',
    name: 'Крепость',
    icon: '🏰',
    tier: 1,
    requires: ['lumbermill'],
    gold: 1200,
    lumber: 400,
    minutes: 240,
    gives: 'Второй тир: мастерская, кузница, сторожевые башни и второй герой на алтаре.',
  },
  workshop: {
    id: 'workshop',
    name: 'Мастерская',
    icon: '⚙',
    tier: 2,
    requires: [],
    gold: 700,
    lumber: 200,
    minutes: 120,
    gives: 'Повторяющиеся задачи и привычки.',
  },
  blacksmith: {
    id: 'blacksmith',
    name: 'Кузница',
    icon: '⚒',
    tier: 2,
    requires: [],
    gold: 700,
    lumber: 200,
    minutes: 120,
    gives: 'Улучшения «Доспехи» и «Оружие».',
  },
  towers: {
    id: 'towers',
    name: 'Сторожевые башни',
    icon: '🗼',
    tier: 2,
    requires: [],
    gold: 500,
    lumber: 150,
    minutes: 90,
    gives: 'Напоминания о сроках: метеор Инфернала над базой за 3 дня до срока большой задачи.',
  },
  castle: {
    id: 'castle',
    name: 'Замок',
    icon: '♜',
    tier: 2,
    requires: ['workshop', 'blacksmith'],
    gold: 2000,
    lumber: 600,
    minutes: 360,
    gives: 'Третий тир: грифонье гнездо, хранилище тайн и третий герой.',
  },
  aviary: {
    id: 'aviary',
    name: 'Грифонье гнездо',
    icon: '🦅',
    tier: 3,
    requires: [],
    gold: 1000,
    lumber: 300,
    minutes: 180,
    gives: 'Задачи 4 уровня и большие отряды без предела.',
  },
  vault: {
    id: 'vault',
    name: 'Хранилище тайн',
    icon: '📜',
    tier: 3,
    requires: [],
    gold: 800,
    lumber: 250,
    minutes: 120,
    gives: 'Статистика по дням, сферам и проектам.',
  },
};

export const BUILDING_ORDER: BuildingId[] = ['lumbermill', 'workshop', 'blacksmith', 'towers', 'aviary', 'vault'];

/** Улучшения кузницы, по три ступени. Вторая ступень требует крепость, третья замок. */
export const SMITH: Record<SmithId, { name: string; icon: string; effect: (level: number) => string }> = {
  armor: {
    name: 'Доспехи',
    icon: '🛡',
    effect: (l) => `Демоны растут медленнее: каждая ступень демона наступает на ${l} ${l === 1 ? 'день' : 'дня'} позже.`,
  },
  weapons: {
    name: 'Оружие',
    icon: '⚔',
    effect: (l) => `Задачи бьют по крепостям, Повелителю ужаса и Архимонду сильнее: +${l} к урону.`,
  },
};

/** Подзадач в отряде без грифоньего гнезда. */
export const SQUAD_LIMIT = 3;

export function tierOf(state: GameState): number {
  return state.tier ?? 1;
}

export function hasBuilding(state: GameState, id: BuildingId): boolean {
  return !!state.buildings?.[id];
}

export function smithLevel(state: GameState, id: SmithId): number {
  return state.smith?.[id] ?? 0;
}

/** Цена и требования улучшения кузницы следующей ступени, null если всё изучено. */
export function smithTech(state: GameState, id: SmithId): Tech | null {
  const next = smithLevel(state, id) + 1;
  if (next > 3) return null;
  const s = SMITH[id];
  return {
    id,
    name: `${s.name}, ступень ${next}`,
    icon: s.icon,
    tier: next,
    requires: ['blacksmith'],
    gold: 300 * next,
    lumber: 100 * next,
    minutes: 60 * next,
    gives: s.effect(next),
  };
}

/** Здание или улучшение с ценой по множителю цен из настроек. */
export function techOf(state: GameState, id: TechId): Tech | null {
  const t = id === 'armor' || id === 'weapons' ? smithTech(state, id) : TECH[id];
  return t && { ...t, gold: price(state, t.gold), lumber: price(state, t.lumber) };
}

/** Уже построено или изучено. */
export function isDone(state: GameState, id: TechId): boolean {
  if (id === 'keep') return tierOf(state) >= 2;
  if (id === 'castle') return tierOf(state) >= 3;
  if (id === 'armor' || id === 'weapons') return smithLevel(state, id) >= 3;
  return hasBuilding(state, id);
}

/** Почему нельзя начать стройку; null если можно. */
export function techBlock(state: GameState, id: TechId): string | null {
  const t = techOf(state, id);
  if (!t || isDone(state, id)) return 'Уже есть.';
  if (state.construction) return state.construction.id === id ? 'Уже строится.' : 'Рабочие заняты другой стройкой.';
  if (tierOf(state) < t.tier) return `Нужна ${t.tier === 2 ? 'крепость' : 'замок'}.`;
  const missing = t.requires.filter((b) => !hasBuilding(state, b));
  if (missing.length) return `Нужно: ${missing.map((b) => TECH[b].name.toLowerCase()).join(', ')}.`;
  if (state.resources.gold < t.gold) return 'Не хватает золота.';
  if (state.resources.lumber < t.lumber) return 'Не хватает дерева.';
  return null;
}

// ---------- Что открывают здания ----------

export function maxLevel(state: GameState): Level {
  return hasBuilding(state, 'aviary') ? 4 : 3;
}

export function canSubtasks(state: GameState): boolean {
  return hasBuilding(state, 'lumbermill');
}

export function canRepeat(state: GameState): boolean {
  return hasBuilding(state, 'workshop');
}

export function meteorsOn(state: GameState): boolean {
  return hasBuilding(state, 'towers');
}

export function squadLimit(state: GameState): number {
  return hasBuilding(state, 'aviary') ? Infinity : SQUAD_LIMIT;
}

/** Дополнительный урон от «Оружия». */
export function weaponBonus(state: GameState): number {
  return smithLevel(state, 'weapons');
}

/** На сколько дней позже наступает каждая ступень демона благодаря «Доспехам». */
export function armorDelay(state: GameState): number {
  return smithLevel(state, 'armor');
}
