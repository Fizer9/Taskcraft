// Способности Горного короля, раздел 7 дизайна. Каждая это приём продуктивности:
// стоит маны, перезаряжается днями и растёт по ступеням, как в WC3.
// Обычные способности изучаются на 1, 3 и 5 уровне героя, ультимейт на 6.

import type { AbilityId, GameState, Hero } from './types';

export interface Ability {
  id: AbilityId;
  name: string;
  /** Прозвище приёма продуктивности, которое стоит за способностью. */
  trick: string;
  icon: string;
  ult?: boolean;
  passive?: boolean;
  /** Мана по ступеням. */
  mana: number[];
  /** Перезарядка в днях. */
  cooldownDays: number;
  /** Что даёт ступень, одной строкой. */
  effect: (rank: number) => string;
}

/** Числа способностей по ступеням 1–3 (у ультимейта одна ступень). */
export const SKILL = {
  frogXp: [2, 2.5, 3],
  /** Лягушка только из задач этого уровня и выше: мелочь лягушкой не бывает. */
  frogMinLevel: 2,
  clapMinutes: [45, 60, 75],
  clapGoldStep: [3, 5, 7],
  clapMaxSeries: 6,
  bashChance: [0.1, 0.2, 0.3],
  avatarMinutes: 90,
  avatarFactor: 2,
};

export const ABILITIES: Record<AbilityId, Ability> = {
  stormbolt: {
    id: 'stormbolt',
    name: 'Молот бури',
    trick: 'съесть лягушку',
    icon: '⚡',
    mana: [20, 20, 20],
    cooldownDays: 1,
    effect: (r) =>
      `Самая тяжёлая задача первой за день. Если она первой из задач ${SKILL.frogMinLevel}+ уровня закрыта сегодня, опыт ×${SKILL.frogXp[r - 1]}.`,
  },
  thunderclap: {
    id: 'thunderclap',
    name: 'Удар грома',
    trick: 'серия мелочей',
    icon: '✺',
    mana: [15, 15, 15],
    cooldownDays: 1,
    effect: (r) =>
      `${SKILL.clapMinutes[r - 1]} минут на мелочи: каждая задача 1 уровня подряд даёт +${SKILL.clapGoldStep[r - 1]} золота за каждую в серии (до ${SKILL.clapMaxSeries}). Задача уровнем выше обрывает серию.`,
  },
  bash: {
    id: 'bash',
    name: 'Оглушение',
    trick: 'нечаянная удача',
    icon: '✸',
    passive: true,
    mana: [0, 0, 0],
    cooldownDays: 0,
    effect: (r) => `Пассивная. С шансом ${Math.round(SKILL.bashChance[r - 1] * 100)}% караван за закрытую задачу привозит вдвое больше золота.`,
  },
  avatar: {
    id: 'avatar',
    name: 'Аватар',
    trick: 'глубокий фокус',
    icon: '♛',
    ult: true,
    mana: [50],
    cooldownDays: 3,
    effect: () =>
      `${SKILL.avatarMinutes} минут без переключений: добыча на базе героя ×${SKILL.avatarFactor}. Переход героя на другую базу рассеивает аватар.`,
  },
};

export const ABILITY_ORDER: AbilityId[] = ['stormbolt', 'thunderclap', 'bash', 'avatar'];

export function isMountainKing(hero: Hero): boolean {
  return (hero.kind ?? 'mountainking') === 'mountainking';
}

export function rankOf(hero: Hero, id: AbilityId): number {
  return hero.skills?.[id] ?? 0;
}

/** Очки навыков: по одному за уровень героя, минус уже потраченные. */
export function skillPoints(hero: Hero): number {
  // Способности остальных героев ещё не сделаны: очки у них появятся вместе со способностями.
  if (!isMountainKing(hero)) return 0;
  const spent = ABILITY_ORDER.reduce((n, id) => n + rankOf(hero, id), 0);
  return Math.max(0, hero.level - spent);
}

/** Какой уровень героя нужен для следующей ступени: 1, 3, 5 у обычных, 6 у ультимейта. */
export function levelForNextRank(hero: Hero, id: AbilityId): number | null {
  const rank = rankOf(hero, id);
  if (ABILITIES[id].ult) return rank ? null : 6;
  return rank >= 3 ? null : rank * 2 + 1;
}

export function canLearn(hero: Hero, id: AbilityId): boolean {
  const need = levelForNextRank(hero, id);
  return need !== null && skillPoints(hero) > 0 && hero.level >= need;
}

export function manaCost(hero: Hero, id: AbilityId): number {
  const a = ABILITIES[id];
  return a.mana[Math.max(0, rankOf(hero, id) - 1)];
}

/** День, когда способность снова готова; null если готова сейчас. */
export function cooldownUntil(state: GameState, id: AbilityId, today: string): string | null {
  const until = state.hero.cooldowns?.[id];
  return until && until > today ? until : null;
}

/** Почему способность нельзя применить сейчас; null если можно. */
export function castBlock(state: GameState, id: AbilityId, today: string): string | null {
  const h = state.hero;
  const a = ABILITIES[id];
  if (!isMountainKing(h)) return 'Способность Горного короля, а на дежурстве другой герой.';
  if (!rankOf(h, id)) return 'Способность ещё не изучена.';
  if (h.fallenAt) return 'Герой пал: воскреси его на алтаре.';
  if (a.passive) return 'Пассивная способность работает сама.';
  const cd = cooldownUntil(state, id, today);
  if (cd) return `Перезарядка до ${cd.slice(8)}.${cd.slice(5, 7)}.`;
  if (h.mana < manaCost(h, id)) return 'Не хватает маны.';
  return null;
}

export function clapActive(state: GameState, now = Date.now()): boolean {
  return !!state.hero.clap && state.hero.clap.until > now;
}

export function avatarActive(state: GameState, baseId: string, now = Date.now()): boolean {
  const a = state.hero.avatar;
  return !!a && a.until > now && a.baseId === baseId && state.hero.baseId === baseId;
}
