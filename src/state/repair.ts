// Починка сохранения перед запуском: недостающие поля берутся из новой игры, битые
// задачи и проекты отбрасываются. Так обрезанный файл, чужой JSON или сохранение
// старой версии не роняют игру на каждом тике, а дают играть дальше.

import { createInitialState } from './seed';
import { MAIN_HALL_ID, type GameState, type Hero, type Project, type Task } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const str = (v: unknown, def: string) => (typeof v === 'string' && v ? v : def);
const time = (v: unknown, def: string) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : def);
const STATUSES = ['inbox', 'hired', 'active', 'done', 'cancelled'];
/** id попадают в разметку (data-id): из чужого файла принимаются только простые. */
const okId = (v: unknown): v is string => typeof v === 'string' && /^[\w.:-]{1,80}$/.test(v);

function repairHero(h: unknown, def: Hero): Hero {
  const x = (isObj(h) ? h : {}) as Partial<Hero>;
  return {
    ...x,
    id: str(x.id, def.id),
    name: str(x.name, def.name),
    level: Math.max(1, Math.round(num(x.level, 1))),
    xp: Math.max(0, num(x.xp, 0)),
    maxMana: Math.max(1, num(x.maxMana, def.maxMana)),
    mana: Math.max(0, num(x.mana, num(x.maxMana, def.maxMana))),
    baseId: str(x.baseId, MAIN_HALL_ID),
  };
}

/** Чинит сохранение на месте и возвращает его. Пустой или не объект: новая игра. */
export function repairState(input: unknown, now = Date.now()): GameState {
  const def = createInitialState(now);
  if (!isObj(input)) return def;
  const s = input as unknown as GameState;
  const raw = input as Record<string, unknown>;
  s.schema = 1;
  s.rev = Math.max(0, Math.round(num(raw.rev, 0)));
  s.updatedAt = num(raw.updatedAt, now);
  const res = isObj(raw.resources) ? raw.resources : {};
  s.resources = { gold: num(res.gold, def.resources.gold), lumber: num(res.lumber, def.resources.lumber) };

  const set = isObj(raw.settings) ? raw.settings : {};
  s.settings = {
    ...(set as object),
    dayStart: time(set.dayStart, def.settings.dayStart),
    dayEnd: time(set.dayEnd, def.settings.dayEnd),
    wakeUp: time(set.wakeUp, def.settings.wakeUp),
    bedtime: time(set.bedtime, def.settings.bedtime),
    workDays: Array.isArray(set.workDays) ? set.workDays.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 7) : def.settings.workDays,
  };

  s.spheres = Array.isArray(raw.spheres)
    ? (raw.spheres as unknown[]).filter((x): x is GameState['spheres'][number] => isObj(x) && okId(x.id)).map((sp) => ({
        ...sp,
        name: str(sp.name, 'Земля'),
        score: num(sp.score, 5),
        target: num(sp.target, 8),
      }))
    : def.spheres;

  const projects = Array.isArray(raw.projects) ? (raw.projects as unknown[]).filter((x): x is Project => isObj(x) && okId(x.id)) : [];
  for (const p of projects) {
    p.name = str(p.name, 'Проект');
    p.sphereId = str(p.sphereId, 'home');
    p.kind ??= 'any';
    p.fortressMaxHp = Math.max(0, num(p.fortressMaxHp, 0));
    p.fortressHp = Math.min(p.fortressMaxHp, Math.max(0, num(p.fortressHp, p.fortressMaxHp)));
    p.slot = isObj(p.slot) ? { x: num(p.slot.x, 0), z: num(p.slot.z, 0) } : { x: 0, z: 0 };
    p.frozen = !!p.frozen;
  }
  // Главная ратуша есть всегда: на ней стоят герой, стройки и входящие.
  if (!projects.some((p) => p.id === MAIN_HALL_ID)) projects.unshift(def.projects[0]);
  s.projects = projects;

  s.tasks = Array.isArray(raw.tasks)
    ? (raw.tasks as unknown[]).filter((x): x is Task => isObj(x) && okId(x.id) && typeof x.title === 'string')
    : [];
  for (const t of s.tasks) {
    if (!STATUSES.includes(t.status)) t.status = 'inbox';
    t.createdAt = num(t.createdAt, now);
    t.spentMs = Math.max(0, num(t.spentMs, 0));
    if (t.level != null && ![1, 2, 3, 4].includes(t.level)) t.level = null;
    // Открытая задача без проекта уходит во входящие; сделанные помнят базу из зала славы.
    const open = t.status === 'inbox' || t.status === 'hired' || t.status === 'active';
    if (t.projectId && (open || !okId(t.projectId)) && !s.projects.some((p) => p.id === t.projectId)) t.projectId = null;
    if (t.due != null && !(typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due))) delete t.due;
  }
  if (raw.dreadlord !== undefined && !(isObj(raw.dreadlord) && typeof raw.dreadlord.name === 'string')) delete s.dreadlord;

  s.hero = repairHero(raw.hero, def.hero);
  if (raw.reserve !== undefined) s.reserve = Array.isArray(raw.reserve) ? raw.reserve.filter(isObj).map((h) => repairHero(h, def.hero)) : [];
  s.farms = Math.max(0, Math.round(num(raw.farms, 0)));
  s.onBreak = !!raw.onBreak;
  s.lastConfirmAt = num(raw.lastConfirmAt, now);
  s.lastTick = num(raw.lastTick, now);
  s.lastDawn = typeof raw.lastDawn === 'string' ? raw.lastDawn : def.lastDawn;
  return s;
}

/**
 * Проверка файла перед загрузкой: похоже ли это на игру вообще. Пустые герой, ресурсы
 * и настройки чинятся, но без задач, проектов и героя это не сохранение Taskcraft.
 */
export function looksLikeSave(v: unknown): boolean {
  if (!isObj(v)) return false;
  return Array.isArray(v.tasks) && Array.isArray(v.projects) && isObj(v.hero) && isObj(v.settings);
}
