// Симуляция баланса: обычные будни игрока по настоящему коду игры. Печатает, сколько
// золота и дерева приходит за день, на какой день растёт герой и встаёт каждое здание.
// Запуск: npm run balance (можно указать число дней: npm run balance 90).
// Профиль дня ниже: поменяй его, если день устроен иначе, и смотри, как меняется темп.

import { BALANCE } from '../src/state/config';
import { createInitialState } from '../src/state/seed';
import { Store } from '../src/state/store';
import { BUILDING_ORDER, isDone, techBlock, TECH, type TechId } from '../src/state/tech';
import { MAIN_HALL_ID, type Level } from '../src/state/types';

const PROFILE = {
  /** Часы под таймером днём на рабочей базе, где стоит герой. */
  workHours: 6,
  /** Сколько задач каждого уровня закрывается за два рабочих дня. */
  doneEvery2Days: { 1: 6, 2: 2, 3: 1 } as Record<1 | 2 | 3, number>,
  /** Вечером час на личной базе: переход героя и одна мелкая задача. */
  eveningHours: 1,
  /** Переносов срока за неделю (задача 2 уровня). */
  reschedulesPerWeek: 2,
  /** Работает по выходным? */
  weekends: false,
};

const DAYS = Number(process.argv[2]) || 60;
/** Множители как в настройках игры: npm run balance 60 mining=1.5 prices=0.75 xp=1. */
const TUNE = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
const START = Date.UTC(2026, 10, 2, 6, 0, 0); // понедельник, 6 утра

// Остановленные часы: игра видит время, которое двигает симуляция.
let now = START;
const RealDate = Date;
class SimDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length) super(...(args as [number]));
    else super(now);
  }
  static now() {
    return now;
  }
}
globalThis.Date = SimDate as DateConstructor;

const WORK = 'fullstack-sertification';
const HOME = 'cooking';
const state = createInitialState(now, true);
state.tutorialDone = now;
state.settings.balance = TUNE;
for (const p of state.projects) if (p.id !== MAIN_HALL_ID) p.frozen = ![WORK, HOME, 'dating', 'friends'].includes(p.id);
const store = new Store(state);
const s = store.state;

const ORDER: TechId[] = ['lumbermill', 'keep', 'blacksmith', 'workshop', 'towers', 'castle', 'aviary', 'vault', 'armor', 'weapons', 'armor', 'weapons', 'armor', 'weapons'];
const built: { id: string; day: number }[] = [];
const levels: { level: number; day: number }[] = [];

/** Играть минуту за минутой: тик, отметка «я работаю» раз в час, стройка, когда хватает. */
function play(minutes: number) {
  for (let m = 0; m < minutes; m++) {
    now += 60_000;
    if (m % 60 === 0) store.confirmWorking();
    store.tick(now);
    if (!s.construction) {
      const next = ORDER.find((id) => !isDone(s, id) && !techBlock(s, id)) ?? null;
      const wanted = ORDER.find((id) => !isDone(s, id));
      if (next && next === wanted) store.build(next);
    }
  }
}

function workOn(base: string, level: Level, hours: number) {
  if (s.hero.baseId !== base) store.moveHero(base);
  const t = store.addTask(`Задача ${level}`, base, level);
  store.start(t.id);
  play(Math.round(hours * 60));
  store.complete(t.id);
}

let debt = 0;
const rows: string[] = [];
for (let day = 1; day <= DAYS; day++) {
  const weekday = new RealDate(now).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  now = START + (day - 1) * 86_400_000 + 60 * 60_000; // 07:00 подъём
  store.tick(now);
  const gold0 = s.resources.gold;
  const lumber0 = s.resources.lumber;
  if (!weekend || PROFILE.weekends) {
    // Утро: план на день из трёх задач с разных баз.
    const planned = [WORK, HOME, 'dating'].map((b) => store.addTask('План', b, 1).id);
    store.planDay(planned);
    now = START + (day - 1) * 86_400_000 + 3 * 60 * 60_000; // 09:00
    // Днём: задачи по профилю, их время делит рабочие часы.
    const todo: Level[] = [];
    for (const [l, n] of Object.entries(PROFILE.doneEvery2Days)) {
      const count = Math.floor(n / 2) + (day % 2 === 0 ? n % 2 : 0);
      for (let i = 0; i < count; i++) todo.push(Number(l) as Level);
    }
    for (const l of todo) workOn(WORK, l, PROFILE.workHours / todo.length);
    for (let i = 0; i < Math.round(PROFILE.reschedulesPerWeek / 5); i++) {
      const t = store.addTask('Перенос', WORK, 2);
      t.due = store.state.lastLegionDay!;
      store.setDue(t.id, '2099-01-01');
    }
    if (day % 3 === 0) {
      const t = store.addTask('Перенос', WORK, 2);
      t.due = store.state.lastLegionDay!;
      store.setDue(t.id, '2099-01-01');
    }
    // Вечер: одна мелкая задача на личной базе.
    now = START + (day - 1) * 86_400_000 + 13 * 60 * 60_000; // 19:00
    if (PROFILE.eveningHours) workOn(HOME, 1, PROFILE.eveningHours);
    // План на завтра закрыт: оставшиеся задачи плана сделаны или отменены.
    for (const id of planned) store.cancel(id);
  }
  debt = s.lumberDebt ?? 0;
  for (const id of BUILDING_ORDER.concat()) if (s.buildings?.[id] && !built.some((b) => b.id === id)) built.push({ id, day });
  if ((s.tier ?? 1) >= 2 && !built.some((b) => b.id === 'keep')) built.push({ id: 'keep', day });
  if ((s.tier ?? 1) >= 3 && !built.some((b) => b.id === 'castle')) built.push({ id: 'castle', day });
  for (const k of ['armor', 'weapons'] as const) {
    const lvl = s.smith?.[k] ?? 0;
    for (let l = 1; l <= lvl; l++) if (!built.some((b) => b.id === `${k}${l}`)) built.push({ id: `${k}${l}`, day });
  }
  while (levels.length < s.hero.level - 1) levels.push({ level: levels.length + 2, day });
  rows.push(
    `${String(day).padStart(3)} ${weekend ? 'вых' : '   '} золото ${String(Math.round(s.resources.gold)).padStart(6)} (${(s.resources.gold - gold0 >= 0 ? '+' : '') + Math.round(s.resources.gold - gold0)})` +
      `  дерево ${String(Math.round(s.resources.lumber)).padStart(5)} (${(s.resources.lumber - lumber0 >= 0 ? '+' : '') + Math.round(s.resources.lumber - lumber0)})${debt ? ` долг ${debt}` : ''}` +
      `  герой ${s.hero.level} (${s.hero.xp} оп.)` +
      (s.construction ? `  строится ${s.construction.id} ${Math.round((s.construction.totalMs - s.construction.leftMs) / 60_000)}/${Math.round(s.construction.totalMs / 60_000)} мин` : ''),
  );
}

const name = (id: string) => (id in TECH ? TECH[id as keyof typeof TECH].name : id.replace('armor', 'Доспехи ').replace('weapons', 'Оружие '));
console.log(`Профиль: ${JSON.stringify(PROFILE)}${process.argv.length > 3 ? `, множители ${JSON.stringify(TUNE)}` : ''}`);
console.log(`Цены и скорость: золото ${BALANCE.goldPerMinute}/мин, дерево ${BALANCE.lumberPerMinute}/мин, караван ${BALANCE.caravanGoldPerLevel} за уровень, опыт до уровней ${BALANCE.heroXpTable.join(', ')}\n`);
console.log(rows.join('\n'));
console.log('\nЗдания по дням: ' + built.map((b) => `${name(b.id)} ${b.day}`).join(', '));
console.log('Герой по дням: ' + levels.map((l) => `ур. ${l.level} на ${l.day}`).join(', '));
