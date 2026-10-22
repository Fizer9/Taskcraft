// Цвет базы, как цвет игрока в WC3: у каждой базы проекта свой, без повторов. Им
// окрашены флаги и командные части зданий и юнитов базы, точка на мини-карте и ⚑ на карточке.
// Главная ратуша синяя: синий запечён в текстуры моделей (scripts/mdx2gltf.py).

import { MAIN_HALL_ID, type GameState, type Project } from './types';

/** Цвета игроков WC3 по порядку; первый, синий, у главной ратуши. */
export const TEAM_COLORS = [
  '#0042ff', '#ff0303', '#1ce6b9', '#540081', '#fffc01', '#fe8a0e', '#20c000', '#e55bb0',
  '#959697', '#7ebff1', '#106246', '#4e2a04', '#9b0000', '#0000c3', '#00eaff', '#be00fe',
  '#ebcd87', '#f8a48b', '#bfff80', '#dcb9eb', '#282828', '#ebf0ff', '#00781e', '#a46f33',
];

export function projectColor(p: Pick<Project, 'color'>): string {
  return TEAM_COLORS[(p.color ?? 0) % TEAM_COLORS.length];
}

/**
 * Раздаёт цвета базам без цвета и базам с повторившимся цветом (например, два устройства
 * одновременно завели по проекту). Цвет, раз выданный, у базы не меняется.
 */
export function assignColors(s: GameState) {
  const used = new Set<number>();
  const main = s.projects.find((p) => p.id === MAIN_HALL_ID);
  if (main) {
    main.color = 0;
    used.add(0);
  }
  for (const p of s.projects) {
    if (p === main) continue;
    if (p.color != null && p.color > 0 && p.color < TEAM_COLORS.length && !used.has(p.color)) used.add(p.color);
    else delete p.color;
  }
  for (const p of s.projects) {
    if (p.color != null) continue;
    let c = 1;
    while (used.has(c) && c < TEAM_COLORS.length) c++;
    // Баз больше, чем цветов WC3: дальше цвета идут по второму кругу.
    p.color = c < TEAM_COLORS.length ? c : 1 + (used.size % (TEAM_COLORS.length - 1));
    used.add(p.color);
  }
}
