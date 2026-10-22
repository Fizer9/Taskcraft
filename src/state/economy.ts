// Живая база, раздел 4: добыча идёт, только пока задача в работе.
// Здесь только чистые функции, состояние меняет store.ts.

import { BALANCE, DEMONS } from './config';
import { SKILL } from './abilities';
import { MAIN_HALL_ID, type Dreadlord, type GameState, type Hero, type Level, type Project, type Repeat, type Sphere, type Task, type Tuning } from './types';

/** Множители баланса из настроек: добыча и награды, цены, опыт. */
export function tuning(state: GameState): Tuning {
  return { mining: 1, prices: 1, xp: 1, ...state.settings.balance };
}

/** Цена с учётом множителя цен. */
export function price(state: GameState, amount: number): number {
  return Math.round(amount * tuning(state).prices);
}

/** Награда (караван, опыт) с учётом множителя. */
export function reward(state: GameState, amount: number, kind: 'mining' | 'xp'): number {
  return Math.round(amount * tuning(state)[kind]);
}

export type Shift = 'day' | 'evening' | 'night' | 'weekend';

export const SHIFT_NAMES: Record<Shift, string> = {
  day: 'Дневная смена',
  evening: 'Вечерняя смена',
  night: 'Ночь',
  weekend: 'Выходной',
};

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Попадает ли минута суток в отрезок [from, to): отрезок может переходить через полночь. */
export function inWindow(mins: number, from: number, to: number): boolean {
  from = ((from % 1440) + 1440) % 1440;
  to = ((to % 1440) + 1440) % 1440;
  return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
}

export function currentShift(state: GameState, now = new Date()): Shift {
  const s = state.settings;
  const mins = now.getHours() * 60 + now.getMinutes();
  const isoDay = now.getDay() === 0 ? 7 : now.getDay();
  // Отбой может быть и после полуночи (сова: подъём 09:00, отбой 01:00).
  const awake = inWindow(mins, minutesOf(s.wakeUp), minutesOf(s.bedtime));
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

// ---------- Отряды: подзадачи большой задачи ----------

export function squadOf(state: GameState, parentId: string): Task[] {
  return state.tasks.filter((t) => t.parentId === parentId && t.status !== 'cancelled');
}

/** Порядок в списке: командир, сразу за ним его отряд. */
export function withSquads(list: Task[]): Task[] {
  const ids = new Set(list.map((t) => t.id));
  const out: Task[] = [];
  for (const t of list) {
    if (t.parentId && ids.has(t.parentId)) continue;
    out.push(t);
    for (const c of list) if (c.parentId === t.id) out.push(c);
  }
  return out;
}

// ---------- Повторяющиеся задачи и привычки ----------

export const REPEAT_NAMES: Record<Repeat, string> = { daily: 'каждый день', weekdays: 'по будням', weekly: 'раз в неделю' };

/** Следующий срок повторяющейся задачи после дня from. */
export function nextDue(from: string, repeat: Repeat): string {
  if (repeat === 'weekly') return addDays(from, 7);
  let d = addDays(from, 1);
  if (repeat === 'weekdays') {
    const dow = (x: string) => {
      const [y, m, dd] = x.split('-').map(Number);
      return new Date(y, m - 1, dd).getDay();
    };
    while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
  }
  return d;
}

// ---------- Ритм дня, раздел 5 ----------

/** Игровой день: начинается с подъёма, а не в полночь. */
export function gameDay(state: GameState, now = new Date()): string {
  return state.lastLegionDay ?? localDay(now);
}

/** Игровой день момента at: до подъёма это ещё вчерашний день. */
export function gameDayAt(state: GameState, at: number): string {
  const d = new Date(at);
  const day = localDay(d);
  return d.getHours() * 60 + d.getMinutes() < minutesOf(state.settings.wakeUp) ? addDays(day, -1) : day;
}

/** Пора подводить итоги: до отбоя осталось совсем немного или он уже прошёл. */
export function summaryDue(state: GameState, now = new Date()): boolean {
  if (state.summaryDay === gameDay(state, now)) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const bed = minutesOf(state.settings.bedtime) - BALANCE.summaryBeforeBedMinutes;
  const wake = minutesOf(state.settings.wakeUp);
  // От получаса до отбоя до подъёма; после полуночи это ещё вечер прошлого игрового дня.
  return inWindow(mins, bed, wake);
}

/** Понедельник недели, к которой относится игровой день. */
export function weekStart(state: GameState, now = new Date()): string {
  const day = gameDay(state, now);
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return addDays(day, -((dow + 6) % 7));
}

export function isPlanned(state: GameState, t: Task, now = new Date()): boolean {
  return state.dayPlan?.day === gameDay(state, now) && state.dayPlan.taskIds.includes(t.id);
}

// ---------- Пылающий Легион, раздел 8 ----------

/** День по местному времени, "2026-10-20": сроки и рассвет считаются по нему. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Сдвиг дня "2026-10-20" на n дней. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function isOpen(t: Task): boolean {
  return t.status === 'inbox' || t.status === 'hired' || t.status === 'active';
}

/** Задача перешла к Легиону: срок прошёл, и ночной подсчёт волн её уже забрал. */
export function isDemon(t: Task): boolean {
  return isOpen(t) && !!t.demonSince;
}

/** База, у которой стоит демон: база проекта, а у свитка без проекта главная ратуша. */
export function demonBaseId(t: Task): string {
  return t.projectId ?? MAIN_HALL_ID;
}

/**
 * Легион спит: мирный режим из лобби или первые тихие дни новой игры. Демоны не
 * приходят, портал не открывается, скверна не ползёт. У старых сохранений нет начала
 * игры, и для них Легион не спит.
 */
export function legionAsleep(state: GameState, now = Date.now()): boolean {
  const mode = state.settings.legion ?? 'normal';
  if (mode === 'peace') return true;
  if (mode === 'burning' || !state.startedAt) return false;
  // Три полных дня тишины по календарю: игра, начатая в понедельник днём, просыпается в четверг утром.
  return localDay(new Date(now)) < addDays(localDay(new Date(state.startedAt)), BALANCE.quietDays);
}

/** Сколько демонов у стен захватывают базу: в пылающем режиме меньше. */
export function demonsToCapture(state: GameState): number {
  return state.settings.legion === 'burning' ? BALANCE.demonsToCaptureBurning : BALANCE.demonsToCapture;
}

/**
 * Ступень демона 1–4. Без armor отдаётся ступень, посчитанная Легионом этой ночью
 * (с учётом «Доспехов» кузницы); armor пересчитывает её заново: каждая ступень
 * наступает на armor × (ступень − 1) дней позже.
 */
export function demonRank(t: Task, today = localDay(), armor?: number): Level {
  if (armor === undefined && t.demonRank) return t.demonRank as Level;
  const days = t.demonSince ? Math.max(0, daysBetween(t.demonSince, today)) : 0;
  let rank: Level = 1;
  for (const l of [1, 2, 3, 4] as Level[]) if (days >= DEMONS[l].fromDays + (armor ?? 0) * (l - 1)) rank = l;
  return rank;
}

/** Демоны у базы, сильнейшие первыми. */
export function demonsAt(state: GameState, baseId: string, today = localDay()): Task[] {
  return state.tasks
    .filter((t) => isDemon(t) && demonBaseId(t) === baseId)
    .sort((a, b) => demonRank(b, today) - demonRank(a, today) || (a.demonSince ?? '').localeCompare(b.demonSince ?? ''));
}

export function allDemons(state: GameState): Task[] {
  return state.tasks.filter(isDemon);
}

/** Демонов столько, что рабочие базы прячутся в ратушу. */
export function workersHiding(state: GameState, baseId: string): boolean {
  return demonsAt(state, baseId).length >= BALANCE.demonsToHide;
}

/** Цена переноса срока в дереве. */
export function rescheduleCost(t: Task): number {
  return BALANCE.rescheduleLumberPerLevel * (t.level ?? 1);
}

/** Перенос стоит дерева, только если срок отодвигается дальше или задача уже стала демоном. */
export function isPostpone(t: Task, due: string | null): boolean {
  if (isDemon(t)) return true;
  if (!t.due) return false;
  return due === null || due > t.due;
}

/** Неразобранные свитки старше нескольких дней: из них растёт портал Легиона. */
export function staleScrolls(state: GameState, now = Date.now()): Task[] {
  const limit = now - BALANCE.portalScrollDays * 86_400_000;
  return state.tasks.filter((t) => t.status === 'inbox' && !isDemon(t) && t.createdAt <= limit);
}

/** Размер портала у главной ратуши: число брошенных свитков, 0 если портал закрыт. */
export function portalSize(state: GameState, now = Date.now()): number {
  if (legionAsleep(state, now)) return 0;
  const n = staleScrolls(state, now).length;
  return n >= BALANCE.portalMinScrolls ? n : 0;
}

/** Когда в проекте последний раз что-то двигалось. */
export function projectActivity(state: GameState, p: Project): number {
  let last = p.lastActivityAt ?? 0;
  for (const t of state.tasks) {
    if (t.projectId !== p.id) continue;
    last = Math.max(last, t.createdAt, t.doneAt ?? 0);
  }
  return last;
}

/** Дней без движения в проекте. */
export function idleDays(state: GameState, p: Project, now = Date.now()): number {
  return Math.floor((now - projectActivity(state, p)) / 86_400_000);
}

/** Месяц игрового дня, "2026-10". */
export function gameMonth(state: GameState, now = new Date()): string {
  return gameDay(state, now).slice(0, 7);
}

/** Основания для оценки сферы на совете земель: что случилось в её земле с прошлого совета. */
export interface SphereReport {
  done: number;
  demonsBeaten: number;
  demonsBanished: number;
  fortresses: number;
  demonsNow: number;
  blighted: number;
  bases: number;
}

/** С какого момента совет считает основания: с прошлого совета или за последние 30 дней. */
export function councilSince(state: GameState, now = Date.now()): number {
  return state.councilAt ?? now - 30 * 86_400_000;
}

export function sphereReport(state: GameState, sphereId: string, now = Date.now()): SphereReport {
  const since = councilSince(state, now);
  const projects = state.projects.filter((p) => p.sphereId === sphereId && p.id !== MAIN_HALL_ID);
  // Базы, ушедшие в зал славы с прошлого совета, тоже основания: их задачи и взятая крепость.
  const glory = (state.hallOfFame ?? []).filter((g) => g.sphereId === sphereId && g.wonAt >= since);
  const ids = new Set([...projects.map((p) => p.id), ...glory.map((g) => g.id)]);
  const r: SphereReport = { done: 0, demonsBeaten: 0, demonsBanished: 0, fortresses: glory.length, demonsNow: 0, blighted: 0, bases: projects.length + glory.length };
  for (const t of state.tasks) {
    if (!t.projectId || !ids.has(t.projectId)) continue;
    if (isDemon(t)) r.demonsNow++;
    const at = t.doneAt ?? 0;
    if (t.status === 'done' && at >= since) {
      r.done++;
      if (t.demonSince) r.demonsBeaten++;
    }
    if (t.status === 'cancelled' && t.demonSince && (t.cancelledAt ?? 0) >= since) r.demonsBanished++;
  }
  for (const p of projects) {
    if (p.wonAt && p.wonAt >= since) r.fortresses++;
    if (isBlighted(state, p, now)) r.blighted++;
  }
  return r;
}

/**
 * Куда Легион шлёт Повелителя ужаса: в сферу с самым большим разрывом между оценкой
 * и целью, где есть базы в игре. При равенстве в ту, где оценка ниже. null, если все у цели.
 */
export function dreadlordSphere(state: GameState): Sphere | null {
  let best: Sphere | null = null;
  for (const sp of state.spheres) {
    const gap = sp.target - sp.score;
    if (gap <= 0) continue;
    if (!state.projects.some((p) => p.sphereId === sp.id && p.id !== MAIN_HALL_ID && !p.frozen)) continue;
    const bestGap = best ? best.target - best.score : 0;
    if (!best || gap > bestGap || (gap === bestGap && sp.score < best.score)) best = sp;
  }
  return best;
}

/** Повелитель ужаса этого месяца, если он ещё жив. */
export function activeDreadlord(state: GameState): Dreadlord | null {
  const d = state.dreadlord;
  return d && d.hp > 0 && d.month === gameMonth(state) ? d : null;
}

/** Проекты в игре: все, кроме законсервированных и главной ратуши. */
export function activeBases(state: GameState): Project[] {
  return state.projects.filter((p) => !p.frozen && p.id !== MAIN_HALL_ID);
}

/**
 * База стоит на карте: законсервированные проекты карту не загромождают, их видно только в
 * окне «Проекты». Захваченная Легионом база остаётся, чтобы её можно было отбить.
 */
export function onMap(p: Project): boolean {
  return !p.frozen || !!p.capturedAt;
}

/** Множитель добычи, когда баз в игре больше лимита: армия растянута. */
export function overLimitFactor(state: GameState): number {
  const over = activeBases(state).length - BALANCE.activeBasesLimit;
  return over > 0 ? 1 - Math.min(0.5, BALANCE.overLimitPenalty * over) : 1;
}

/** Можно ли вернуть в игру ещё одну базу. */
export function canThaw(state: GameState): boolean {
  return activeBases(state).length < BALANCE.activeBasesLimit;
}

/** По земле проекта ползёт скверна: долго ничего не двигалось. Замороженные и главная ратуша не гниют. */
export function isBlighted(state: GameState, p: Project, now = Date.now()): boolean {
  if (p.frozen || p.id === MAIN_HALL_ID || legionAsleep(state, now)) return false;
  return idleDays(state, p, now) >= BALANCE.blightDays;
}

export function repairCost(p: Project): number {
  return Math.ceil((p.damage ?? 0) * BALANCE.repairGoldPerDamage);
}

/** Ближайшая большая задача базы, над которой висит метеор Инфернала. */
export function meteorOf(state: GameState, baseId: string, today = localDay()): { task: Task; daysLeft: number } | null {
  // Метеоры видны со сторожевых башен.
  if (!state.buildings?.towers) return null;
  if (state.projects.find((p) => p.id === baseId)?.frozen) return null;
  let best: { task: Task; daysLeft: number } | null = null;
  for (const t of state.tasks) {
    if (!isOpen(t) || isDemon(t) || !t.due || (t.level ?? 0) < 3 || demonBaseId(t) !== baseId) continue;
    const left = daysBetween(today, t.due);
    if (left < 0 || left > BALANCE.meteorDays) continue;
    if (!best || left < best.daysLeft) best = { task: t, daysLeft: left };
  }
  return best;
}

/** Множитель добычи базы прямо сейчас, 0 если база стоит. */
export function miningFactor(state: GameState, project: Project, now = new Date()): number {
  if (project.frozen || state.onBreak) return 0;
  if (!activeTaskOf(state, project.id)) return 0;
  if (idleGuardTripped(state, now.getTime())) return 0;
  const demons = demonsAt(state, project.id).length;
  if (demons >= BALANCE.demonsToHide) return 0;
  // Павший герой не стоит ни на одной базе: все добывают как без героя.
  const heroHere = state.hero.baseId === project.id && !state.hero.fallenAt;
  let f = heroHere ? 1 : BALANCE.remoteBaseFactor;
  f *= shiftFactor(project.kind, currentShift(state, now));
  f *= upkeep(state).factor;
  f *= overLimitFactor(state);
  f *= 1 - BALANCE.demonMiningPenalty * demons;
  // Горящие здания работают хуже: до половины добычи при полном разрушении.
  f *= 1 - (project.damage ?? 0) / 200;
  if (heroHere && isTired(state)) f *= 0.5;
  if (heroHere && state.hero.mana <= 0) f = 0;
  // Аватар: глубокий фокус удваивает добычу на базе героя.
  const av = state.hero.avatar;
  if (heroHere && av && av.baseId === project.id && av.until > now.getTime()) f *= SKILL.avatarFactor;
  return f;
}

// ---------- Места баз на карте ----------

/** Крепость врага стоит в 48 единицах от базы, наружу от центра карты. */
export function fortressSpot(slot: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(slot.x, slot.z) || 1;
  return { x: slot.x + (slot.x / len) * 48, z: slot.z + (slot.z / len) * 48 };
}

/**
 * Свободное место под новую базу: не ближе 60 к другим базам, крепость внутри карты и
 * не на чужой базе. Из подходящих выбирается ближайшее к базам той же сферы, а если
 * их нет, к кольцу вокруг главной ратуши.
 */
export function freeSlot(state: GameState, sphereId: string, mapHalf = 200): { x: number; z: number } {
  const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const others = state.projects;
  const kin = others.filter((p) => p.sphereId === sphereId && p.id !== MAIN_HALL_ID);
  let best: { x: number; z: number } | null = null;
  let bestScore = Infinity;
  for (let x = -mapHalf + 25; x <= mapHalf - 25; x += 8) {
    for (let z = -mapHalf + 25; z <= mapHalf - 25; z += 8) {
      const here = { x, z };
      const f = fortressSpot(here);
      if (Math.abs(f.x) > mapHalf - 10 || Math.abs(f.z) > mapHalf - 10) continue;
      const free = others.every((p) => {
        const main = p.id === MAIN_HALL_ID;
        if (d(p.slot, here) < (main ? 85 : 60)) return false;
        if (d(p.slot, f) < 35) return false;
        return main || d(fortressSpot(p.slot), here) >= 35;
      });
      if (!free) continue;
      const score = kin.length ? Math.min(...kin.map((p) => d(p.slot, here))) : Math.abs(Math.hypot(x, z) - 120);
      if (score < bestScore) {
        bestScore = score;
        best = here;
      }
    }
  }
  return best ?? { x: Math.round(mapHalf * 0.6), z: Math.round(mapHalf * 0.6) };
}

// ---------- Герои по сменам ----------

/** Смены дежурства героев по местам на алтаре. */
export const DUTY_NAMES = ['рабочая смена', 'вечер', 'выходные'];

/** Сколько героев может стоять на алтаре: один в ратуше, два в крепости, три в замке. */
export function heroSlots(state: GameState): number {
  return Math.min(3, Math.max(1, state.tier ?? 1));
}

export function allHeroes(state: GameState): Hero[] {
  return [state.hero, ...(state.reserve ?? [])];
}

/**
 * Чьё место дежурит в смену. Один герой работает во всех сменах. Двое делят день и
 * всё остальное. Трое: день, вечер (и ночь), выходные.
 */
export function dutySlot(state: GameState, shift: Shift): number {
  const n = allHeroes(state).length;
  if (n <= 1 || shift === 'day') return 0;
  if (n === 2 || shift !== 'weekend') return 1;
  return 2;
}

/** Какие смены держит место при нынешнем числе героев. */
export function dutyOf(state: GameState, slot: number): string {
  const n = allHeroes(state).length;
  if (n <= 1) return 'все смены';
  if (slot === 0) return DUTY_NAMES[0];
  if (n === 2) return 'вечер и выходные';
  return DUTY_NAMES[slot];
}

/** Цена воскрешения героя на алтаре. */
export function reviveCost(hero: Hero): number {
  return BALANCE.reviveGoldBase + BALANCE.reviveGoldPerLevel * hero.level;
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

/**
 * Здоровье юнита задачи для полосок над ним и в консоли (0..1): без срока юнит цел,
 * со сроком тает по мере приближения дня, неделя и больше в запасе даёт полную полоску.
 */
export function unitHealth(t: Pick<Task, 'due'>, today = localDay()): number {
  if (!t.due) return 1;
  const left = daysBetween(today, t.due);
  return Math.max(0.05, Math.min(1, (left + 1) / 8));
}
