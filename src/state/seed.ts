// Стартовые данные Игоря из дизайн-документа, раздел 3. Новая игра начинается с одной
// главной ратуши: проекты Игорь закладывает сам (окно «Проекты» в меню). Список из
// документа остался для тестов и симуляции баланса.

import { BALANCE } from './config';
import { localDay } from './economy';
import { MAIN_HALL_ID, type GameState, type Project, type Sphere } from './types';

const spheres: Sphere[] = [
  { id: 'spirit', name: 'Духовное развитие', score: 7, target: 8 },
  { id: 'relations', name: 'Отношения', score: 6, target: 8 },
  { id: 'career', name: 'Карьера и навыки', score: 7, target: 8 },
  { id: 'rest', name: 'Отдых', score: 8, target: 8 },
  { id: 'talents', name: 'Таланты и хобби', score: 8, target: 8 },
  { id: 'health', name: 'Здоровье', score: 6, target: 7 },
  { id: 'finance', name: 'Финансы', score: 5, target: 7 },
  { id: 'friends', name: 'Друзья', score: 7, target: 8 },
];

export const SAMPLE_PROJECTS: Array<[string, string, Project['kind']]> = [
  ['Dating', 'relations', 'personal'],
  ['Fullstack Sertification', 'career', 'work'],
  ['Джедайская академия', 'career', 'work'],
  ['Church Alice', 'career', 'work'],
  ['AI & Moodle', 'career', 'work'],
  ['DnD Ideas', 'talents', 'personal'],
  ['Photography', 'talents', 'personal'],
  ['Cooking', 'talents', 'personal'],
  ['Friends', 'friends', 'personal'],
  ['Telegram Channel', 'friends', 'any'],
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '');
}

/** samples: заложить базы проектов из документа (для тестов), иначе только главная ратуша. */
export function createInitialState(now = Date.now(), samples = false): GameState {
  // Главная ратуша в центре, базы проектов по кругу от неё.
  const projects: Project[] = [
    {
      id: MAIN_HALL_ID,
      name: 'Главная ратуша',
      sphereId: 'home',
      kind: 'any',
      fortressHp: 0,
      fortressMaxHp: 0,
      slot: { x: 0, z: 0 },
      frozen: false,
    },
  ];
  const list = samples ? SAMPLE_PROJECTS : [];
  list.forEach(([name, sphereId, kind], i) => {
    const angle = (i / list.length) * Math.PI * 2;
    projects.push({
      id: slug(name),
      name,
      sphereId,
      kind,
      fortressHp: BALANCE.fortressHp,
      fortressMaxHp: BALANCE.fortressHp,
      slot: { x: Math.round(Math.cos(angle) * 120), z: Math.round(Math.sin(angle) * 120) },
      frozen: false,
    });
  });

  return {
    schema: 1,
    rev: 0,
    gameId: `g-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    updatedAt: now,
    resources: { gold: BALANCE.startGold, lumber: BALANCE.startLumber },
    spheres,
    projects,
    tasks: [],
    hero: {
      id: 'mountain-king',
      name: 'Горный король',
      level: 1,
      xp: 0,
      mana: BALANCE.heroMaxMana,
      maxMana: BALANCE.heroMaxMana,
      baseId: MAIN_HALL_ID,
    },
    farms: 0,
    onBreak: false,
    lastConfirmAt: now,
    lastTick: now,
    lastDawn: localDay(new Date(now)),
    settings: {
      dayStart: '09:00',
      dayEnd: '18:00',
      workDays: [1, 2, 3, 4, 5],
      wakeUp: '07:00',
      bedtime: '23:00',
    },
  };
}
