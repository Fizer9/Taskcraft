// Хранилище состояния и все действия игрока. Интерфейс и сцена только
// читают состояние и подписываются на изменения.

import { BALANCE, DEMONS, DREADLORDS, HERO_KINDS, UNITS } from './config';
import {
  activeTaskOf,
  addDays,
  currentShift,
  demonBaseId,
  demonRank,
  demonsAt,
  gameDay,
  nextDue,
  squadOf,
  weekStart,
  isDemon,
  isOpen,
  isPostpone,
  isBlighted,
  idleDays,
  localDay,
  meteorOf,
  portalSize,
  repairCost,
  rescheduleCost,
  reviveCost,
  foodCap,
  foodUsed,
  idleGuardTripped,
  manaDrainFactor,
  miningFactor,
  xpForLevel,
  allHeroes,
  freeSlot,
  dutyOf,
  dutySlot,
  heroSlots,
  activeBases,
  canThaw,
  gameMonth,
  activeDreadlord,
  dreadlordSphere,
  price,
  reward,
  tuning,
  legionAsleep,
  demonsToCapture,
} from './economy';
import { ABILITIES, SKILL, canLearn, castBlock, clapActive, manaCost, rankOf } from './abilities';
import { createInitialState } from './seed';
import { TECH, armorDelay, canRepeat, canSubtasks, maxLevel, squadLimit, techBlock, techOf, weaponBonus } from './tech';
import { MAIN_HALL_ID, type TechId, type AbilityId, type DayStats, type GameState, type Hero, type HeroKind, type Level, type Project, type BaseKind, type Repeat, type Settings, type Sphere, type Task } from './types';

/** Звук события: сцена и интерфейс подбирают к нему звук из WC3. */
export type Cue = 'hire' | 'start' | 'complete' | 'fortress' | 'level' | 'farm' | 'dawn' | 'move' | 'warn' | 'legion' | 'defeat' | 'spell' | 'jobdone' | 'nogold' | 'nolumber' | 'nofood';
/** unit: уровень юнита задачи, чтобы событие озвучил его голос. */
export type GameEvent = { id: number; text: string; kind: 'info' | 'gold' | 'warn' | 'win'; cue?: Cue; unit?: Level };

/** changed = true для действий игрока, false для тиков времени. */
type Listener = (state: GameState, changed: boolean) => void;

let eventSeq = 0;

/** Здоровье вражеской крепости: от маленькой миссии до огромной. */
function clampHp(hp: number): number {
  return Math.min(500, Math.max(5, Math.round(hp) || BALANCE.fortressHp));
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export class Store {
  state: GameState;
  /** Сообщения как текст поверх консоли в WC3, не сохраняются. */
  events: GameEvent[] = [];
  /** Пока идёт ночной подсчёт Легиона, сообщения копятся в отчёт для утра. */
  private collecting: string[] | null = null;
  /** Пока идёт пакетное действие, мелкие сообщения глушатся ради одной сводки. */
  private muffled: GameEvent[] | null = null;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: GameEvent) => void>();

  constructor(initial?: GameState) {
    this.state = initial ?? createInitialState();
    this.migrate();
  }

  /** Старые сохранения: проекты без отметки активности считаем живыми с этого момента. */
  private migrate() {
    const now = Date.now();
    const s = this.state;
    // Игра, начатая до лобби, уже настроена: обучение пройдено, есть проекты или задачи.
    if (!s.setupDone && (s.tutorialDone || s.projects.length > 1 || s.tasks.length)) s.setupDone = s.tutorialDone ?? now;
    for (const p of this.state.projects) p.lastActivityAt ??= now;
    this.state.hero.kind ??= 'mountainking';
    this.state.hero.slot ??= 0;
  }

  /**
   * Новая игра из лобби: сферы, герой, распорядок и базы проектов разом. Совет земель
   * в этом месяце считается проведённым, обучение пройденным, а Легион первые дни спит.
   */
  startGame(setup: {
    spheres: { name: string; score: number; target: number }[];
    projects: { name: string; sphere: number; kind: BaseKind; hp: number }[];
    hero: HeroKind;
    settings: Settings;
  }) {
    const now = Date.now();
    const s = createInitialState(now);
    const clamp = (n: number) => Math.min(10, Math.max(1, Math.round(n) || 1));
    s.rev = this.state.rev; // чтобы Gist принял новую игру как следующую ревизию
    s.spheres = setup.spheres.map((r) => ({ id: 'sphere-' + uid(), name: r.name.trim().slice(0, 40), score: clamp(r.score), target: clamp(r.target) }));
    if (setup.hero !== 'mountainking') s.hero = { ...s.hero, id: `${setup.hero}-${uid()}`, name: HERO_KINDS[setup.hero].name, kind: setup.hero };
    s.settings = setup.settings;
    s.councilMonth = gameMonth(s, new Date(now));
    s.setupDone = s.startedAt = s.tutorialDone = now;
    for (const r of setup.projects) {
      const sphereId = s.spheres[r.sphere]?.id ?? s.spheres[0]?.id ?? 'home';
      const max = clampHp(r.hp);
      s.projects.push({
        id: 'p-' + uid(),
        name: r.name.trim().slice(0, 40),
        sphereId,
        kind: r.kind,
        fortressHp: max,
        fortressMaxHp: max,
        slot: freeSlot(s, sphereId),
        // Сверх лимита база закладывается законсервированной, как в окне «Проекты».
        frozen: !canThaw(s),
        lastActivityAt: now,
        createdAt: now,
      });
    }
    this.state = s;
    this.events = [];
    this.migrate();
    const n = setup.projects.length;
    this.say(
      n
        ? `Игра началась. Заложено баз: ${n}. Запиши первую задачу (Q) и найми юнита в проект: каждая сделанная задача бьёт по вражеской крепости.`
        : 'Игра началась. Заложи первую базу проекта (Меню → Проекты) и запиши первую задачу (Q).',
      'win',
      'farm',
    );
    this.emit();
  }

  /** В проекте что-то сдвинулось: скверна перестаёт ползти. */
  private touch(projectId: string | null | undefined, now = Date.now()) {
    const p = projectId ? this.project(projectId) : undefined;
    if (p) p.lastActivityAt = now;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEvent(fn: (e: GameEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  replace(state: GameState) {
    this.state = state;
    this.migrate();
    this.emit();
  }

  private emit(changed = true) {
    if (changed) this.state.updatedAt = Date.now();
    for (const l of this.listeners) l(this.state, changed);
  }

  say(text: string, kind: GameEvent['kind'] = 'info', cue: Cue | undefined = kind === 'warn' ? 'warn' : undefined, unit?: Level) {
    const e: GameEvent = { id: ++eventSeq, text, kind, cue, unit };
    if (this.muffled) return void this.muffled.push(e);
    this.collecting?.push(text);
    this.events.push(e);
    if (this.events.length > 30) this.events.shift();
    for (const l of this.eventListeners) l(e);
  }

  task(id: string): Task | undefined {
    return this.state.tasks.find((t) => t.id === id);
  }

  project(id: string) {
    return this.state.projects.find((p) => p.id === id);
  }

  // ---------- Задачи ----------

  /** Новый свиток. Если сразу указаны проект и уровень, юнит сразу нанят. */
  addTask(title: string, projectId: string | null = null, level: Level | null = null): Task {
    if (level && level > maxLevel(this.state)) {
      this.say('Задачи 4 уровня ведут грифоны: нужно грифонье гнездо (замок). Задача легла во входящие без уровня.', 'warn');
      level = null;
    }
    const t: Task = {
      id: uid(),
      title: title.trim(),
      projectId,
      level,
      status: 'inbox',
      createdAt: Date.now(),
      spentMs: 0,
    };
    this.state.tasks.push(t);
    if (projectId && level) this.hire(t.id, projectId, level, false);
    this.emit();
    return t;
  }

  hire(id: string, projectId: string, level: Level, emit = true) {
    const t = this.task(id);
    if (!t) return;
    if (level > maxLevel(this.state) && t.level !== level) {
      this.say('Задачи 4 уровня ведут грифоны: нужно грифонье гнездо (замок).', 'warn');
      return;
    }
    const wasInbox = t.status === 'inbox';
    t.projectId = projectId;
    this.touch(projectId);
    t.level = level;
    if (wasInbox) {
      t.status = 'hired';
      const repaid = this.gainPlanLumber(BALANCE.hireLumber);
      this.say(
        `${UNITS[level].name} готов к бою. +${BALANCE.hireLumber} дерева за план` + (repaid ? `, из них ${repaid} в счёт долга` : ''),
        'gold',
        'hire',
        level,
      );
    }
    if (emit) this.emit();
  }

  /** В работу: юнит идёт к крепости и занимает еду. Одна задача на проект. */
  start(id: string): boolean {
    const t = this.task(id);
    if (!t || !t.projectId || !t.level) return false;
    if (t.status !== 'hired') return false;
    if (this.project(t.projectId)?.frozen) {
      this.say('База законсервирована. Расконсервируй её, чтобы снова вести там бой.', 'warn');
      return false;
    }
    const busy = activeTaskOf(this.state, t.projectId);
    if (busy) {
      this.say(`На этой базе уже идёт «${busy.title}». Одна задача в работе на проект.`, 'warn');
      return false;
    }
    if (foodUsed(this.state) >= foodCap(this.state)) {
      this.say('Нужно построить больше ферм.', 'warn', 'nofood');
      return false;
    }
    t.status = 'active';
    this.touch(t.projectId);
    this.state.lastConfirmAt = Date.now();
    this.state.onBreak = false;
    this.say(`${UNITS[t.level].name} выступил к крепости.`, 'info', 'start', t.level);
    this.emit();
    return true;
  }

  /** Вернуть задачу из работы в план. */
  stop(id: string) {
    const t = this.task(id);
    if (!t || t.status !== 'active') return;
    t.status = 'hired';
    this.emit();
  }

  complete(id: string, correctedLevel?: Level) {
    const t = this.task(id);
    if (!t || (t.status !== 'active' && t.status !== 'hired') || !t.level) return;
    const wasDemon = isDemon(t);
    const hadMeteor = meteorOf(this.state, demonBaseId(t))?.task.id === t.id;
    const level = correctedLevel ?? t.level;
    t.level = level;
    t.status = 'done';
    this.touch(t.projectId);
    const st = this.stats();
    st.done += 1;
    if (wasDemon) st.demons += 1;
    if (hadMeteor) this.say('Метеор Инфернала сгорел в воздухе!', 'win');
    if (t.repeat) this.repeatNext(t, wasDemon);
    if (t.parentId) {
      const squad = squadOf(this.state, t.parentId);
      const parent = this.task(t.parentId);
      if (parent && isOpen(parent) && squad.every((x) => x.status === 'done'))
        this.say(`Отряд «${parent.title}» выполнил все задачи. Командиру остался последний удар.`, 'win');
    }
    if (wasDemon) {
      const d = DEMONS[demonRank(t)];
      this.say(`${d.name} ${d.fem ? 'повержена' : 'повержен'}!`, 'win');
    }
    const xpMult = this.frogMultiplier(t, level);
    t.doneAt = Date.now();
    const bashRank = rankOf(this.state.hero, 'bash');
    const bashed = bashRank > 0 && Math.random() < SKILL.bashChance[bashRank - 1];
    const gold = reward(this.state, BALANCE.caravanGoldPerLevel * level * (bashed ? 2 : 1), 'mining');
    this.state.resources.gold += gold;
    this.say(bashed ? `Оглушение! Караван привёз вдвое больше: ${gold} золота` : `Караван привёз ${gold} золота`, 'gold', 'complete', level);
    this.thunderStep(level);
    this.gainXp(Math.round(UNITS[level].xp * xpMult));
    const p = t.projectId ? this.project(t.projectId) : undefined;
    // «Оружие» кузницы добавляет урона по крепостям и командирам Легиона.
    const damage = level + weaponBonus(this.state);
    if (p && p.fortressMaxHp > 0 && p.fortressHp > 0) {
      st.damage += Math.min(damage, p.fortressHp);
      p.fortressHp = Math.max(0, p.fortressHp - damage);
      if (p.fortressHp === 0) {
        p.wonAt = Date.now();
        // Марш победы играет экран победы, когда врата рухнут на карте (ui/outcome.ts).
        this.say(`Вражеская крепость проекта «${p.name}» пала! Миссия выиграна. Проект можно оставить, отправить в зал славы или поставить новую крепость (✎).`, 'win');
      }
    }
    if (p) this.hitDreadlord(p, damage);
    this.hitArchimonde(damage);
    this.emit();
  }

  cancel(id: string) {
    const t = this.task(id);
    if (!t) return;
    const wasDemon = isDemon(t);
    const wasScroll = t.status === 'inbox';
    t.status = 'cancelled';
    t.cancelledAt = Date.now();
    if (t.repeat) this.say(`Серия «${t.title}» остановлена.`);
    const d = DEMONS[demonRank(t)];
    this.say(wasDemon ? `${d.name} ${d.fem ? 'изгнана' : 'изгнан'}. Честный отказ лучше висящего долга.` : wasScroll ? 'Задача сожжена.' : 'Юнит распущен.');
    this.emit();
  }

  /**
   * Разбор входящих пачкой: свиткам сразу проект, уровень и срок, ненужные в огонь.
   * Свиток с проектом и уровнем становится юнитом, как при обычном найме, но
   * вместо сообщения на каждого выходит одна сводка.
   */
  triage(items: { id: string; projectId: string | null; level: Level | null; due: string | null; drop: boolean }[]) {
    let hired = 0;
    let dropped = 0;
    let dated = 0;
    let postponeCost = 0;
    let lastLevel: Level | null = null;
    for (const it of items) {
      const t = this.task(it.id);
      if (!t || t.status !== 'inbox') continue;
      if (it.drop) {
        t.status = 'cancelled';
        dropped++;
        continue;
      }
      if (it.due !== (t.due ?? null)) {
        if (isPostpone(t, it.due)) postponeCost += rescheduleCost(t);
        if (it.due) t.due = it.due;
        else delete t.due;
        if (isDemon(t) && (!it.due || it.due >= localDay())) {
          delete t.demonSince;
          delete t.demonRank;
        }
        dated++;
      }
      if (it.projectId) {
        t.projectId = it.projectId;
        this.touch(it.projectId);
      }
      if (t.projectId && it.level) {
        t.level = it.level;
        t.status = 'hired';
        hired++;
        lastLevel = it.level;
      }
    }
    if (!items.length) return;
    const parts: string[] = [];
    if (hired) {
      const repaid = this.gainPlanLumber(BALANCE.hireLumber * hired);
      parts.push(`нанято ${hired} ${plural(hired, 'юнит', 'юнита', 'юнитов')}, +${BALANCE.hireLumber * hired} дерева за план` + (repaid ? ` (${repaid} в счёт долга)` : ''));
    }
    if (dated) parts.push(`сроки у ${dated}`);
    if (dropped) parts.push(`сожжено ${dropped}`);
    const debt = postponeCost ? this.payLumber(postponeCost) : 0;
    if (postponeCost) parts.push(`переносы −${postponeCost} дерева` + (debt ? `, ${debt} в долг` : ''));
    this.say(parts.length ? `Входящие разобраны: ${parts.join(', ')}.` : 'Во входящих ничего не поменялось.', hired ? 'gold' : 'info', hired ? 'hire' : undefined, lastLevel ?? undefined);
    this.emit();
  }

  /** Обучение пройдено или пропущено: само больше не откроется. */
  finishTutorial() {
    this.state.tutorialDone = Date.now();
    this.emit();
  }

  /**
   * Ответ Легиону с экрана возвращения: каждого демона сделать, перенести или изгнать
   * разом. Вместо сообщения на каждого выходит одна сводка, а громкие события
   * (новый уровень героя, павшая крепость, отбитая база) звучат отдельно.
   */
  repelLegion(items: { id: string; act: 'done' | 'move' | 'banish'; due?: string }[]) {
    const s = this.state;
    const gold = s.resources.gold;
    const lumber = s.resources.lumber - (s.lumberDebt ?? 0);
    let done = 0;
    let moved = 0;
    let banished = 0;
    const muffled: GameEvent[] = (this.muffled = []);
    try {
      for (const it of items) {
        const t = this.task(it.id);
        if (!t || !isDemon(t)) continue;
        if (it.act === 'done' && (t.status === 'hired' || t.status === 'active') && t.level) {
          this.complete(t.id);
          done++;
        } else if (it.act === 'move' && it.due && it.due >= localDay()) {
          this.setDue(t.id, it.due);
          moved++;
        } else if (it.act === 'banish') {
          this.cancel(t.id);
          banished++;
        }
      }
    } finally {
      this.muffled = null;
    }
    if (!done && !moved && !banished) return;
    const spent = lumber - (s.resources.lumber - (s.lumberDebt ?? 0));
    const parts = [
      done ? `повержено ${done}` : '',
      moved ? `перенесено ${moved}` : '',
      banished ? `изгнано ${banished}` : '',
    ].filter(Boolean);
    const gain = [s.resources.gold > gold ? `+${Math.round(s.resources.gold - gold)} золота` : '', spent > 0 ? `−${spent} дерева` : ''].filter(Boolean);
    this.say(`Легион отброшен: ${parts.join(', ')}.${gain.length ? ` ${gain.join(', ')}.` : ''}`, 'win', done ? 'complete' : undefined);
    for (const e of muffled) if (e.cue === 'level' || e.cue === 'fortress') this.say(e.text, e.kind, e.cue, e.unit);
    this.retake();
    this.emit();
  }

  /**
   * Срок задачи. Поставить срок или приблизить его бесплатно; отодвинуть срок или
   * отбиться переносом от демона стоит дерева (это перепланирование). Если дерева
   * не хватает, перенос идёт в долг.
   */
  setDue(id: string, due: string | null) {
    const t = this.task(id);
    if (!t || !isOpen(t)) return;
    if ((t.due ?? null) === due) return;
    const wasDemon = isDemon(t);
    if (isPostpone(t, due)) {
      const debt = this.payLumber(rescheduleCost(t));
      this.say(
        `Срок перенесён. −${rescheduleCost(t)} дерева` + (debt ? `, ${debt} из них в долг` : ''),
        debt ? 'warn' : 'info',
        debt ? 'warn' : undefined,
      );
    }
    if (due) t.due = due;
    else delete t.due;
    if (wasDemon && (!due || due >= localDay())) {
      delete t.demonSince;
      delete t.demonRank;
      this.say('Демон отступил к вратам.');
    }
    this.emit();
  }

  /** Списывает дерево, недостающее записывает в долг. Возвращает, сколько ушло в долг. */
  private payLumber(cost: number): number {
    const r = this.state.resources;
    const paid = Math.min(cost, Math.max(0, Math.floor(r.lumber)));
    r.lumber -= paid;
    const debt = cost - paid;
    if (debt > 0) this.state.lumberDebt = (this.state.lumberDebt ?? 0) + debt;
    return debt;
  }

  /** Дерево за планирование: сначала гасит долг. Возвращает, сколько ушло на долг. */
  private gainPlanLumber(amount: number): number {
    const debt = this.state.lumberDebt ?? 0;
    const repaid = Math.min(debt, amount);
    this.state.lumberDebt = debt - repaid;
    this.state.resources.lumber += amount - repaid;
    return repaid;
  }

  /** Новый юнит в отряд большой задачи: та же база, сразу нанят. */
  addSubtask(parentId: string, title: string, level: Level): Task | undefined {
    const parent = this.task(parentId);
    if (!parent || !parent.projectId || !title.trim()) return;
    if (!canSubtasks(this.state)) {
      this.say('Отряды собираются на лесопилке: построй её на главной ратуше.', 'warn');
      return;
    }
    if (squadOf(this.state, parent.id).length >= squadLimit(this.state)) {
      this.say(`Без грифоньего гнезда в отряде не больше ${squadLimit(this.state)} юнитов.`, 'warn');
      return;
    }
    const t = this.addTask(title, parent.projectId, level);
    t.parentId = parent.id;
    this.say(`Отряд «${parent.title}»: ${squadOf(this.state, parent.id).length} ${plural(squadOf(this.state, parent.id).length, 'юнит', 'юнита', 'юнитов')}.`);
    this.emit();
    return t;
  }

  /** Повтор задачи. Повторяющейся задаче нужен срок: если его нет, это сегодня. */
  setRepeat(id: string, repeat: Repeat | null) {
    const t = this.task(id);
    if (!t || !isOpen(t)) return;
    if (repeat && !t.repeat && !canRepeat(this.state)) {
      this.say('Повторяющиеся задачи и привычки делает мастерская: нужна крепость и мастерская.', 'warn');
      return;
    }
    if (repeat) {
      t.repeat = repeat;
      t.streak ??= 0;
      if (!t.due) t.due = localDay();
    } else {
      delete t.repeat;
      delete t.streak;
    }
    this.emit();
  }

  /** Следующая задача серии: та же база и уровень, новый срок, серия растёт, если успел в срок. */
  private repeatNext(done: Task, wasDemon: boolean) {
    const repeat = done.repeat!;
    const from = done.due && done.due > localDay() ? done.due : localDay();
    const next: Task = {
      id: uid(),
      title: done.title,
      projectId: done.projectId,
      level: done.level,
      status: done.projectId && done.level ? 'hired' : 'inbox',
      createdAt: Date.now(),
      spentMs: 0,
      due: nextDue(from, repeat),
      repeat,
      streak: wasDemon ? 0 : (done.streak ?? 0) + 1,
    };
    this.state.tasks.push(next);
    if (next.streak && next.streak > 1) this.say(`Серия «${done.title}»: ${next.streak} ${plural(next.streak, 'раз', 'раза', 'раз')} подряд!`, 'gold');
  }

  rename(id: string, title: string) {
    const t = this.task(id);
    if (!t || !title.trim()) return;
    t.title = title.trim();
    this.emit();
  }

  // ---------- Герой и база ----------

  private gainXp(xp: number) {
    const h = this.state.hero;
    h.xp += reward(this.state, xp, 'xp');
    while (h.level < 10 && h.xp >= xpForLevel(h.level)) {
      h.level += 1;
      this.say(`${h.name} достиг ${h.level} уровня! Есть очко навыка: выбери героя и изучи способность (O).`, 'win', 'level');
    }
  }

  // ---------- Сферы и проекты ----------

  /** Редактор сфер: новые получают id, сфера с проектами не удаляется. */
  saveSpheres(rows: { id?: string; name: string; score: number; target: number }[]) {
    const s = this.state;
    const clamp = (n: number) => Math.min(10, Math.max(1, Math.round(n) || 1));
    const next: Sphere[] = rows.map((r) => ({
      id: r.id && s.spheres.some((x) => x.id === r.id) ? r.id : 'sphere-' + uid(),
      name: r.name.trim().slice(0, 40),
      score: clamp(r.score),
      target: clamp(r.target),
    }));
    for (const sp of s.spheres)
      if (!next.some((x) => x.id === sp.id) && s.projects.some((p) => p.sphereId === sp.id && p.id !== MAIN_HALL_ID)) next.push(sp);
    s.spheres = next;
    this.say('Сферы жизни обновлены.');
    this.emit();
  }

  /** Новый проект: база на свободном месте рядом с землёй своей сферы. */
  createProject(name: string, sphereId: string, kind: BaseKind, hp: number = BALANCE.fortressHp): Project {
    const s = this.state;
    const max = clampHp(hp);
    // Сверх лимита база закладывается законсервированной: место в игре нужно освободить.
    const frozen = !canThaw(s);
    const p: Project = {
      id: 'p-' + uid(),
      name: name.trim().slice(0, 40),
      sphereId,
      kind,
      fortressHp: max,
      fortressMaxHp: max,
      slot: freeSlot(s, sphereId),
      frozen,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    };
    s.projects.push(p);
    if (frozen)
      this.say(
        `Заложена база «${p.name}», но в игре уже ${BALANCE.activeBasesLimit} баз: она законсервирована. Расконсервируй её, когда освободится место.`,
        'warn',
      );
    else this.say(`Заложена база «${p.name}». Вражеская крепость уже видна за лесом.`, 'win', 'farm');
    this.emit();
    return p;
  }

  /** Переименовать проект, сменить сферу или тип базы. */
  updateProject(id: string, patch: { name?: string; sphereId?: string; kind?: BaseKind; hp?: number }) {
    const p = this.project(id);
    if (!p || p.id === MAIN_HALL_ID) return;
    if (patch.name?.trim()) p.name = patch.name.trim().slice(0, 40);
    if (patch.sphereId && patch.sphereId !== p.sphereId) {
      // База переезжает в свою новую землю, к базам той же сферы.
      p.sphereId = patch.sphereId;
      p.slot = freeSlot({ ...this.state, projects: this.state.projects.filter((x) => x !== p) }, p.sphereId);
    }
    if (patch.kind) p.kind = patch.kind;
    if (patch.hp !== undefined && clampHp(patch.hp) !== p.fortressMaxHp) {
      // Нанесённый урон сохраняется: меняется только то, сколько ещё осталось до победы.
      const dealt = p.fortressMaxHp - p.fortressHp;
      p.fortressMaxHp = clampHp(patch.hp);
      p.fortressHp = Math.max(0, p.fortressMaxHp - dealt);
    }
    this.say(`Проект «${p.name}» обновлён.`);
    this.emit();
  }

  /**
   * Удалить проект. Его открытые задачи возвращаются свитками во входящие (уровень
   * остаётся подсказкой для разбора), герои уходят в главную ратушу.
   */
  deleteProject(id: string) {
    const s = this.state;
    const p = this.project(id);
    if (!p || p.id === MAIN_HALL_ID) return;
    let returned = 0;
    for (const t of s.tasks) {
      if (t.projectId !== id || !isOpen(t)) continue;
      t.projectId = null;
      t.status = 'inbox';
      returned++;
    }
    for (const h of allHeroes(s)) {
      if (h.baseId === id) h.baseId = MAIN_HALL_ID;
      if (h.avatar?.baseId === id) delete h.avatar;
    }
    s.projects = s.projects.filter((x) => x.id !== id);
    this.say(`Проект «${p.name}» удалён.` + (returned ? ` ${returned} ${plural(returned, 'задача вернулась', 'задачи вернулись', 'задач вернулись')} во входящие.` : ''));
    this.emit();
  }

  /**
   * Миссия выиграна, база уходит в зал славы: с карты она исчезает, открытые задачи
   * возвращаются свитками во входящие, в зале остаются имя, сроки и число сделанных задач.
   */
  enshrine(id: string) {
    const s = this.state;
    const p = this.project(id);
    if (!p || p.id === MAIN_HALL_ID || p.fortressHp > 0) return;
    const tasks = s.tasks.filter((t) => t.projectId === id);
    const started = p.createdAt ?? Math.min(p.wonAt ?? Date.now(), ...tasks.map((t) => t.createdAt));
    const glory = {
      id: p.id,
      name: p.name,
      sphereId: p.sphereId,
      sphereName: s.spheres.find((x) => x.id === p.sphereId)?.name ?? '',
      startedAt: started,
      wonAt: p.wonAt ?? Date.now(),
      done: tasks.filter((t) => t.status === 'done').length,
      hp: p.fortressMaxHp,
    };
    s.hallOfFame = [...(s.hallOfFame ?? []), glory];
    let returned = 0;
    for (const t of tasks) {
      if (!isOpen(t)) continue;
      t.projectId = null;
      t.status = 'inbox';
      returned++;
    }
    for (const h of allHeroes(s)) {
      if (h.baseId === id) h.baseId = MAIN_HALL_ID;
      if (h.avatar?.baseId === id) delete h.avatar;
    }
    s.projects = s.projects.filter((x) => x.id !== id);
    this.say(
      `База «${p.name}» ушла в зал славы. Миссий в зале: ${s.hallOfFame.length}.` +
        (returned ? ` ${returned} ${plural(returned, 'задача вернулась', 'задачи вернулись', 'задач вернулись')} во входящие.` : ''),
      'win',
      'fortress',
    );
    this.emit();
  }

  /**
   * Законсервировать базу: проект на паузе. Задача в работе возвращается в казарму,
   * герои уходят в главную ратушу. База не добывает, не гниёт, Легион к её задачам не приходит.
   */
  freezeProject(id: string) {
    const s = this.state;
    const p = this.project(id);
    if (!p || p.id === MAIN_HALL_ID || p.frozen) return;
    this.freezeQuiet(p);
    const demons = demonsAt(s, id).length;
    this.say(
      `База «${p.name}» законсервирована. Активных баз ${activeBases(s).length} из ${BALANCE.activeBasesLimit}.` +
        (demons ? ' Демоны у стен остаются: заморозка не прогоняет Легион.' : ''),
    );
    this.emit();
  }

  private freezeQuiet(p: Project) {
    const s = this.state;
    const active = activeTaskOf(s, p.id);
    if (active) active.status = 'hired';
    for (const h of allHeroes(s)) {
      if (h.baseId === p.id) h.baseId = MAIN_HALL_ID;
      if (h.avatar?.baseId === p.id) delete h.avatar;
    }
    p.frozen = true;
  }

  private thawQuiet(p: Project) {
    p.frozen = false;
    p.thawedOn = localDay();
    p.lastActivityAt = Date.now();
  }

  /** Выбрать базы в игре разом: отмеченные в игре, остальные законсервированы. */
  setActiveBases(ids: string[]) {
    const s = this.state;
    const keep = new Set(ids.slice(0, BALANCE.activeBasesLimit));
    let frozen = 0;
    let thawed = 0;
    for (const p of s.projects) {
      if (p.id === MAIN_HALL_ID || p.capturedAt) continue;
      if (keep.has(p.id) && p.frozen) {
        this.thawQuiet(p);
        thawed++;
      } else if (!keep.has(p.id) && !p.frozen) {
        this.freezeQuiet(p);
        frozen++;
      }
    }
    if (frozen || thawed)
      this.say(
        `Базы в игре: ${activeBases(s).length} из ${BALANCE.activeBasesLimit}.` +
          (frozen ? ` Законсервировано ${frozen}.` : '') +
          (thawed ? ` Вернулось в игру ${thawed}.` : ''),
      );
    this.emit();
  }

  /** Вернуть базу в игру, если есть место. Скверна считает дни заново. */
  unfreezeProject(id: string): boolean {
    const s = this.state;
    const p = this.project(id);
    if (!p || !p.frozen) return false;
    if (p.capturedAt) {
      this.say(`База «${p.name}» в руках Легиона: сначала разберись со всеми демонами у её стен.`, 'warn');
      return false;
    }
    if (!canThaw(s)) {
      this.say(`В игре уже ${BALANCE.activeBasesLimit} баз. Сначала законсервируй другую.`, 'warn');
      return false;
    }
    this.thawQuiet(p);
    const late = s.tasks.filter((t) => t.projectId === id && isOpen(t) && t.due && t.due < p.thawedOn! && !t.demonSince).length;
    this.say(
      `База «${p.name}» снова в игре.` +
        (late ? ` У ${late} ${plural(late, 'задачи', 'задач', 'задач')} срок прошёл за время паузы: передвинь, иначе ночью придёт Легион.` : ''),
      'info',
      'farm',
    );
    this.emit();
    return true;
  }

  // ---------- Способности героя ----------

  /** Изучить следующую ступень способности за очко навыка. */
  learn(id: AbilityId) {
    const h = this.state.hero;
    if (!canLearn(h, id)) return;
    const rank = rankOf(h, id) + 1;
    h.skills = { ...h.skills, [id]: rank };
    this.say(`${h.name} изучил «${ABILITIES[id].name}»${ABILITIES[id].ult ? '' : `, ступень ${rank}`}.`, 'win', 'level');
    this.emit();
  }

  /** Плата за способность: мана и перезарядка. false, если применить нельзя. */
  private cast(id: AbilityId): boolean {
    const day = gameDay(this.state);
    const block = castBlock(this.state, id, day);
    if (block) {
      this.say(block, 'warn');
      return false;
    }
    const h = this.state.hero;
    h.mana -= manaCost(h, id);
    h.cooldowns = { ...h.cooldowns, [id]: addDays(day, ABILITIES[id].cooldownDays) };
    return true;
  }

  /** Сделана ли сегодня уже задача, которая могла бы быть лягушкой. */
  private bigDoneToday(day: string): boolean {
    return this.state.tasks.some(
      (t) => t.status === 'done' && (t.level ?? 0) >= SKILL.frogMinLevel && !!t.doneAt && localDay(new Date(t.doneAt)) === day,
    );
  }

  /** Молот бури: задача становится лягушкой дня. */
  stormBolt(taskId: string) {
    const t = this.task(taskId);
    const day = gameDay(this.state);
    if (!t || (t.status !== 'hired' && t.status !== 'active') || !t.level) return;
    if (t.level < SKILL.frogMinLevel) {
      this.say(`Лягушка это тяжёлая задача: ${SKILL.frogMinLevel} уровня и выше.`, 'warn');
      return;
    }
    if (this.bigDoneToday(day)) {
      this.say('Сегодня первая серьёзная задача уже сделана. Лягушку едят первой, попробуй завтра.', 'warn');
      return;
    }
    if (!this.cast('stormbolt')) return;
    this.state.hero.frog = { taskId, day };
    const mult = SKILL.frogXp[rankOf(this.state.hero, 'stormbolt') - 1];
    this.say(`Молот бури! «${t.title}» это лягушка дня: сделай её первой, и опыт ×${mult}.`, 'info', 'spell');
    this.emit();
  }

  /** Множитель опыта за задачу: лягушка, съеденная первой, или 1. Снимает лягушку. */
  private frogMultiplier(t: Task, level: Level): number {
    const h = this.state.hero;
    const frog = h.frog;
    if (!frog || level < SKILL.frogMinLevel) return 1;
    const day = gameDay(this.state);
    if (frog.day !== day) {
      delete h.frog;
      return 1;
    }
    delete h.frog;
    if (frog.taskId !== t.id) {
      this.say('Лягушка ускользнула: первой сделана другая серьёзная задача.', 'warn');
      return 1;
    }
    const mult = SKILL.frogXp[Math.max(0, rankOf(h, 'stormbolt') - 1)];
    this.say(`Лягушка съедена! Опыт ×${mult}.`, 'win');
    return mult;
  }

  /** Удар грома: серия мелочей. */
  thunderClap() {
    if (!this.cast('thunderclap')) return;
    const r = rankOf(this.state.hero, 'thunderclap');
    this.state.hero.clap = { until: Date.now() + SKILL.clapMinutes[r - 1] * 60_000, count: 0 };
    this.say(`Удар грома! ${SKILL.clapMinutes[r - 1]} минут на мелочи: каждая задача 1 уровня подряд приносит всё больше золота.`, 'info', 'spell');
    this.emit();
  }

  /** Шаг серии Удара грома при закрытии задачи. */
  private thunderStep(level: Level) {
    const h = this.state.hero;
    if (!h.clap) return;
    if (!clapActive(this.state)) {
      delete h.clap;
      return;
    }
    if (level > 1) {
      this.say(`Серия мелочей прервана на ${h.clap.count}: задача уровнем выше.`);
      delete h.clap;
      return;
    }
    h.clap.count = Math.min(SKILL.clapMaxSeries, h.clap.count + 1);
    const bonus = SKILL.clapGoldStep[rankOf(h, 'thunderclap') - 1] * h.clap.count;
    this.state.resources.gold += bonus;
    this.stats().gold += bonus;
    this.say(`Удар грома: серия ${h.clap.count}, +${bonus} золота`, 'gold');
  }

  /** Аватар: глубокий фокус на базе героя. */
  avatar() {
    const h = this.state.hero;
    if (!activeTaskOf(this.state, h.baseId)) {
      this.say('Аватару нужна задача в работе на базе героя.', 'warn');
      return;
    }
    if (!this.cast('avatar')) return;
    h.avatar = { until: Date.now() + SKILL.avatarMinutes * 60_000, baseId: h.baseId };
    this.say(`Аватар! ${SKILL.avatarMinutes} минут глубокого фокуса: добыча на этой базе ×${SKILL.avatarFactor}. Не переключайся.`, 'win', 'spell');
    this.emit();
  }

  /** Истёкшие Удар грома и Аватар снимаются с сообщением. */
  private expireSpells(now: number) {
    const h = this.state.hero;
    if (h.clap && h.clap.until <= now) {
      this.say(`Удар грома стих. Мелочей в серии: ${h.clap.count}.`);
      delete h.clap;
    }
    if (h.avatar && h.avatar.until <= now) {
      this.say('Аватар рассеялся: фокус выдержан до конца.', 'win');
      delete h.avatar;
    }
  }

  /** Призвать на алтарь второго или третьего героя (места открывают тиры ратуши). */
  hireHero(kind: HeroKind) {
    const s = this.state;
    const heroes = allHeroes(s);
    if (heroes.length >= heroSlots(s)) {
      this.say('На алтаре нет свободного места: второй герой откроется в крепости, третий в замке.', 'warn');
      return;
    }
    if (heroes.some((h) => h.kind === kind)) return;
    const cost = price(s, BALANCE.heroHireGold[heroes.length] ?? 0);
    if (s.resources.gold < cost) {
      this.say(`Нужно ${cost} золота, чтобы призвать героя.`, 'warn', 'nogold');
      return;
    }
    s.resources.gold -= cost;
    const hero: Hero = {
      id: `${kind}-${uid()}`,
      name: HERO_KINDS[kind].name,
      kind,
      slot: heroes.length,
      level: 1,
      xp: 0,
      mana: BALANCE.heroMaxMana,
      maxMana: BALANCE.heroMaxMana,
      baseId: MAIN_HALL_ID,
    };
    s.reserve = [...(s.reserve ?? []), hero];
    this.say(`${hero.name} встал на алтарь. Его смена: ${dutyOf(s, hero.slot!)}.`, 'win', 'level');
    this.rotateDuty(new Date());
    this.emit();
  }

  /** Новая смена: на дежурство заступает её герой, прежний уходит отдыхать на алтарь. */
  private rotateDuty(now: Date) {
    const s = this.state;
    if (!s.reserve?.length) return;
    const want = dutySlot(s, currentShift(s, now));
    if ((s.hero.slot ?? 0) === want) return;
    const next = s.reserve.find((h) => (h.slot ?? 0) === want);
    if (!next) return;
    const prev = s.hero;
    s.reserve = [...s.reserve.filter((h) => h !== next), prev];
    s.hero = next;
    this.say(`Смена: на дежурство заступил ${next.name}, ${prev.name} отдыхает на алтаре.`, 'info', 'move');
  }

  /** Работа при нулевой мане роняет героя от истощения. */
  private heroFalls(now: number) {
    const h = this.state.hero;
    h.fallenAt = now;
    h.mana = 0;
    delete h.avatar;
    delete h.clap;
    this.say(
      `${h.name} пал от истощения! Базы добывают как без героя. Воскреси его на алтаре за ${reviveCost(h)} золота или он вернётся сам на рассвете.`,
      'warn',
    );
  }

  /** Воскрешение на алтаре главной ратуши за золото. */
  revive() {
    const h = this.state.hero;
    if (!h.fallenAt) return;
    const cost = reviveCost(h);
    if (this.state.resources.gold < cost) {
      this.say(`Нужно ${cost} золота, чтобы воскресить героя.`, 'warn', 'nogold');
      return;
    }
    this.state.resources.gold -= cost;
    delete h.fallenAt;
    h.mana = Math.round(h.maxMana * BALANCE.reviveMana);
    h.baseId = MAIN_HALL_ID;
    this.say(`${h.name} воскрешён на алтаре. −${cost} золота. Не гони его до нуля снова: привал возвращает ману.`, 'win', 'level');
    this.emit();
  }

  moveHero(baseId: string) {
    const h = this.state.hero;
    if (h.baseId === baseId) return;
    if (h.fallenAt) {
      this.say('Герой пал. Сначала воскреси его на алтаре.', 'warn');
      return;
    }
    if (this.project(baseId)?.frozen) {
      this.say('База законсервирована: герою там нечего делать.', 'warn');
      return;
    }
    if (h.mana < BALANCE.heroMoveCost) {
      this.say('Не хватает маны.', 'warn');
      return;
    }
    h.mana -= BALANCE.heroMoveCost;
    if (h.avatar) {
      this.say('Аватар рассеялся: герой сменил базу.', 'warn');
      delete h.avatar;
    }
    h.baseId = baseId;
    this.say(`${h.name} перешёл на базу «${this.project(baseId)?.name}». −${BALANCE.heroMoveCost} маны`, 'info', 'move');
    this.emit();
  }

  toggleBreak() {
    this.state.onBreak = !this.state.onBreak;
    if (!this.state.onBreak) this.state.lastConfirmAt = Date.now();
    this.say(this.state.onBreak ? 'Привал. Рабочие отдыхают, мана восстанавливается.' : 'Снова за работу!');
    this.emit();
  }

  confirmWorking() {
    this.state.lastConfirmAt = Date.now();
    this.say('Работа продолжается.');
    this.emit();
  }

  /** Стройка идёт только во время работы, пока на базе героя идёт таймер. */
  buildFarm() {
    const gold = price(this.state, BALANCE.farmCost.gold);
    const lumber = price(this.state, BALANCE.farmCost.lumber);
    const r = this.state.resources;
    const heroBase = this.project(this.state.hero.baseId);
    if (!heroBase || miningFactor(this.state, heroBase) === 0) {
      this.say('Строить можно только во время работы.', 'warn');
      return;
    }
    if (r.gold < gold) return this.say('Недостаточно золота.', 'warn', 'nogold');
    if (r.lumber < lumber) return this.say('Недостаточно дерева.', 'warn', 'nolumber');
    r.gold -= gold;
    r.lumber -= lumber;
    this.state.farms += 1;
    this.say('Ферма построена. +1 место под задачу в работе', 'info', 'jobdone');
    this.emit();
  }

  // ---------- Дерево технологий ----------

  /** Заложить здание, улучшить ратушу или начать улучшение кузницы. Платится сразу. */
  build(id: TechId) {
    const s = this.state;
    const block = techBlock(s, id);
    const t = techOf(s, id);
    if (block || !t) {
      if (block) this.say(block, 'warn');
      return;
    }
    s.resources.gold -= t.gold;
    s.resources.lumber -= t.lumber;
    s.construction = { id, leftMs: t.minutes * 60_000, totalMs: t.minutes * 60_000, gold: t.gold, lumber: t.lumber };
    this.say(`${id === 'keep' || id === 'castle' ? 'Улучшение' : 'Стройка'}: ${t.name}. Рабочие трудятся, пока идёт таймер: ещё ${t.minutes} мин. работы.`, 'info', 'farm');
    this.emit();
  }

  /**
   * Захваченная база отбита, когда у её стен не осталось демонов: она возвращается
   * в игру (если есть место), но стоит в руинах, пока её не отремонтируют за золото.
   */
  private retake() {
    const s = this.state;
    for (const p of s.projects) {
      if (!p.capturedAt || demonsAt(s, p.id).length) continue;
      delete p.capturedAt;
      const back = canThaw(s);
      if (back) this.thawQuiet(p);
      this.say(
        `База «${p.name}» отбита у Легиона!` +
          (back ? ' Она снова в игре.' : ` Мест в игре нет, она законсервирована: верни её, когда освободится место.`) +
          ` Руины чинятся за ${repairCost(p)} золота (H на базе).`,
        'win',
        'fortress',
      );
      this.emit();
    }
  }

  /** Отменить стройку: золото и дерево возвращаются полностью. */
  cancelBuild() {
    const s = this.state;
    const c = s.construction;
    if (!c) return;
    // Возвращается ровно уплаченное, даже если цены в настройках с тех пор поменялись.
    const t = techOf(s, c.id);
    s.resources.gold += c.gold ?? t?.gold ?? 0;
    s.resources.lumber += c.lumber ?? t?.lumber ?? 0;
    delete s.construction;
    this.say(`Стройка отменена${t ? `: ${t.name}` : ''}. Золото и дерево вернулись.`);
    this.emit();
  }

  private finishBuild() {
    const s = this.state;
    const c = s.construction;
    if (!c) return;
    const t = techOf(s, c.id);
    delete s.construction;
    if (c.id === 'keep' || c.id === 'castle') {
      s.tier = c.id === 'keep' ? 2 : 3;
      this.say(`Ратуша стала ${c.id === 'keep' ? 'крепостью' : 'замком'}! ${TECH[c.id].gives}`, 'win', 'fortress');
    } else if (c.id === 'armor' || c.id === 'weapons') {
      s.smith = { ...s.smith, [c.id]: (s.smith?.[c.id] ?? 0) + 1 };
      this.say(`Кузница: ${t?.name ?? ''} готово. ${t?.gives ?? ''}`, 'win', 'jobdone');
    } else {
      s.buildings = { ...s.buildings, [c.id]: true };
      this.say(`Построено: ${TECH[c.id].name}. ${TECH[c.id].gives}`, 'win', 'jobdone');
    }
  }

  // ---------- Ритм дня ----------

  /** Статистика текущего игрового дня, создаётся при первом обращении. */
  stats(): DayStats {
    const day = gameDay(this.state);
    let st = this.state.stats;
    if (st?.day !== day) {
      // Прошлый день уходит в историю хранилища тайн.
      if (st) this.state.statsHistory = [...(this.state.statsHistory ?? []).filter((h) => h.day !== st!.day), st].slice(-120);
      st = this.state.stats = { day, gold: 0, lumber: 0, done: 0, damage: 0, demons: 0, workedMs: 0 };
    }
    return st;
  }

  /**
   * Утреннее планирование: задачи на день, по одной на проект. За каждую новую
   * задачу в плане даётся дерево (сначала гасит долг).
   */
  planDay(taskIds: string[]) {
    const s = this.state;
    const day = gameDay(s);
    const seen = new Set<string>();
    const ids = taskIds.filter((id) => {
      const t = this.task(id);
      if (!t || !isOpen(t)) return false;
      const base = demonBaseId(t);
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    });
    const before = new Set(s.dayPlan?.day === day ? s.dayPlan.taskIds : []);
    const added = ids.filter((id) => !before.has(id)).length;
    s.dayPlan = { day, taskIds: ids };
    const lumber = added * BALANCE.planLumberPerTask;
    const repaid = lumber ? this.gainPlanLumber(lumber) : 0;
    this.say(
      `План на день: ${ids.length} ${plural(ids.length, 'задача', 'задачи', 'задач')}.` + (lumber ? ` +${lumber} дерева за план` : '') + (repaid ? `, из них ${repaid} в счёт долга` : ''),
      'gold',
      lumber ? 'hire' : undefined,
    );
    this.emit();
  }

  /** Второе дыхание: после работы ужин или прогулка возвращают часть маны, раз в день. */
  secondWind() {
    const s = this.state;
    const day = gameDay(s);
    const shift = currentShift(s);
    if (shift === 'day') return this.say('Второе дыхание бывает после работы.', 'warn');
    if (s.secondWindDay === day) return this.say('Второе дыхание уже было сегодня.', 'warn');
    s.secondWindDay = day;
    const before = s.hero.mana;
    s.hero.mana = Math.min(s.hero.maxMana, s.hero.mana + BALANCE.secondWindMana);
    this.say(`Второе дыхание: +${Math.round(s.hero.mana - before)} маны`, 'info');
    this.emit();
  }

  /**
   * Глава недели: 2–3 главные цели. Если прошлая глава не закрыта, она закрывается:
   * за каждую выполненную цель золото, итог уходит в историю.
   */
  planWeek(goals: string[]) {
    const s = this.state;
    const start = weekStart(s);
    if (s.week && s.week.start !== start) this.closeWeek();
    const old = s.week?.start === start ? s.week.goals : [];
    s.week = {
      start,
      goals: goals
        .map((g) => g.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((text) => ({ text, done: old.find((o) => o.text === text)?.done ?? false })),
    };
    this.say(`Глава недели: ${s.week.goals.length} ${plural(s.week.goals.length, 'цель', 'цели', 'целей')}.`, 'info', 'hire');
    this.emit();
  }

  /**
   * Совет земель: игрок сам ставит оценки сферам, глядя на основания за месяц.
   * Оценки уходят в историю, за совет платится золото.
   */
  holdCouncil(rows: { id: string; score: number; target: number }[]) {
    const s = this.state;
    const clamp = (n: number) => Math.min(10, Math.max(1, Math.round(n) || 1));
    let up = 0;
    let down = 0;
    for (const r of rows) {
      const sp = s.spheres.find((x) => x.id === r.id);
      if (!sp) continue;
      const score = clamp(r.score);
      if (score > sp.score) up++;
      if (score < sp.score) down++;
      sp.score = score;
      sp.target = clamp(r.target);
    }
    const month = gameMonth(s);
    s.councilHistory = [...(s.councilHistory ?? []).filter((h) => h.month !== month), { month, scores: Object.fromEntries(s.spheres.map((sp) => [sp.id, sp.score])) }].slice(-24);
    const paid = s.councilMonth !== month;
    s.councilMonth = month;
    s.councilAt = Date.now();
    if (paid) s.resources.gold += BALANCE.councilGold;
    const reached = s.spheres.filter((sp) => sp.score >= sp.target).length;
    this.say(
      `Совет земель окончен.` +
        (up ? ` Отвоёвано земель: ${up}.` : '') +
        (down ? ` Сдали позиции: ${down}.` : '') +
        ` У цели ${reached} из ${s.spheres.length}.` +
        (paid ? ` +${BALANCE.councilGold} золота` : ''),
      'gold',
      'hire',
    );
    if (paid && s.settings.legion !== 'peace') this.summonDreadlord(month);
    this.summonArchimonde();
    this.emit();
  }

  /** Все земли у цели: к горе Хиджал идёт Архимонд, финал главы кампании. */
  private summonArchimonde() {
    const s = this.state;
    if (s.hyjal || !s.spheres.length || s.spheres.some((sp) => sp.score < sp.target)) return;
    s.hyjal = { hp: BALANCE.hyjalHp, maxHp: BALANCE.hyjalHp, since: Date.now() };
    this.say(
      `Все земли у цели. Архимонд идёт к горе Хиджал: ${BALANCE.hyjalHp} здоровья. Любая сделанная задача бьёт по нему уроном своего уровня. Победа закроет ${s.chapter ?? 1} главу кампании.`,
      'warn',
      'legion',
    );
  }

  private hitArchimonde(level: number) {
    const h = this.state.hyjal;
    if (!h || h.hp <= 0) return;
    h.hp = Math.max(0, h.hp - level);
    if (h.hp === 0) this.say('Архимонд повержен у горы Хиджал! Пора поднять цели и начать новую главу.', 'win', 'fortress');
  }

  /**
   * Новая глава после Хиджала: игрок поднимает цели земель, герой получает награду,
   * номер главы растёт. Оценки остаются: земля под контролем, цель стала выше.
   */
  newChapter(targets: { id: string; target: number }[]) {
    const s = this.state;
    if (!s.hyjal || s.hyjal.hp > 0) return;
    for (const r of targets) {
      const sp = s.spheres.find((x) => x.id === r.id);
      if (sp) sp.target = Math.min(10, Math.max(sp.score, Math.round(r.target) || sp.target));
    }
    const done = s.chapter ?? 1;
    s.chapter = done + 1;
    delete s.hyjal;
    s.resources.gold += BALANCE.hyjalGold;
    this.say(`Глава ${done} закрыта. Начинается глава ${s.chapter}: новые цели земель. +${BALANCE.hyjalXp} опыта, +${BALANCE.hyjalGold} золота`, 'win', 'fortress');
    this.gainXp(BALANCE.hyjalXp);
    this.emit();
  }

  /** На совете Легион шлёт Повелителя ужаса в отстающую землю: одолеть до конца месяца. */
  private summonDreadlord(month: string) {
    const s = this.state;
    if (s.dreadlord?.month === month) return;
    const sp = dreadlordSphere(s);
    if (!sp) {
      delete s.dreadlord;
      this.say('Легион не нашёл слабой земли: все сферы у цели. Повелитель ужаса в этом месяце не придёт.', 'win');
      return;
    }
    const gap = sp.target - sp.score;
    const hp = Math.min(BALANCE.dreadlordHpMax, BALANCE.dreadlordHpBase + BALANCE.dreadlordHpPerGap * gap);
    const [y, m] = month.split('-').map(Number);
    const name = DREADLORDS[(y * 12 + m) % DREADLORDS.length];
    s.dreadlord = { name, sphereId: sp.id, month, hp, maxHp: hp };
    this.say(
      `Повелитель ужаса ${name} пришёл в землю «${sp.name}»: ${hp} здоровья. Каждая задача этой земли бьёт по нему уроном своего уровня. ` +
        `Одолей до конца месяца: ${BALANCE.dreadlordXp} опыта и ${BALANCE.dreadlordGold} золота.`,
      'warn',
      'legion',
    );
  }

  private hitDreadlord(p: Project, level: number) {
    const s = this.state;
    const d = activeDreadlord(s);
    if (!d || p.sphereId !== d.sphereId) return;
    d.hp = Math.max(0, d.hp - level);
    if (d.hp > 0) return;
    s.dreadlordsSlain = (s.dreadlordsSlain ?? 0) + 1;
    s.resources.gold += BALANCE.dreadlordGold;
    this.say(`Повелитель ужаса ${d.name} повержен! +${BALANCE.dreadlordXp} опыта, +${BALANCE.dreadlordGold} золота`, 'win', 'fortress');
    this.gainXp(BALANCE.dreadlordXp);
    delete s.dreadlord;
  }

  toggleWeekGoal(i: number) {
    const g = this.state.week?.goals[i];
    if (!g) return;
    g.done = !g.done;
    if (g.done) this.say(`Цель недели выполнена: «${g.text}»`, 'win', 'complete');
    this.emit();
  }

  /** Закрывает прошлую главу: награда за выполненные цели и запись в историю. */
  private closeWeek() {
    const s = this.state;
    const w = s.week;
    if (!w) return;
    const done = w.goals.filter((g) => g.done).length;
    if (done) {
      s.resources.gold += done * BALANCE.weekGoalGold;
      this.say(`Глава закрыта: ${done} из ${w.goals.length} целей. +${done * BALANCE.weekGoalGold} золота`, 'gold');
    }
    (s.weekHistory ??= []).push({ start: w.start, done, total: w.goals.length });
    s.week = undefined;
  }

  /** Итоги дня: незаконченные задачи либо остаются в работе, либо возвращаются в план. */
  endDay(keepActiveIds: string[]) {
    const keep = new Set(keepActiveIds);
    for (const t of this.state.tasks) if (t.status === 'active' && !keep.has(t.id)) t.status = 'hired';
    this.state.summaryDay = gameDay(this.state);
    this.state.onBreak = false;
    this.say('День окончен. Доброй ночи!');
    this.emit();
  }

  /** Ремонт зданий, обожжённых скверной. */
  repair(projectId: string) {
    const p = this.project(projectId);
    if (!p || !p.damage) return;
    if (p.capturedAt) return this.say('Руины не отстроить, пока база в руках Легиона. Сначала отбей её.', 'warn');
    const cost = repairCost(p);
    if (this.state.resources.gold < cost) return this.say('Недостаточно золота.', 'warn', 'nogold');
    this.state.resources.gold -= cost;
    p.damage = 0;
    this.say(`База «${p.name}» отремонтирована. −${cost} золота`, 'info', 'jobdone');
    this.emit();
  }

  // ---------- Время ----------

  /** Вызывается раз в секунду. Начисляет добычу, тратит ману, считает время задач. */
  tick(now = Date.now()) {
    const s = this.state;
    let dt = Math.max(0, now - s.lastTick);
    // После долгого отсутствия добыча не копится дальше защиты от забытого таймера.
    const guardEnd = s.lastConfirmAt + BALANCE.idleGuardMinutes * 60_000;
    if (now > guardEnd) dt = Math.max(0, Math.min(dt, guardEnd - s.lastTick));
    // Отрезок до срабатывания защиты считается так, как было на его конце: иначе после
    // долгого отсутствия пропадали и те полтора часа, что таймер честно шёл.
    const at = Math.min(now, guardEnd - 1);
    s.lastTick = now;

    this.dawn(now);
    this.legion(now);
    this.retake();
    this.expireSpells(now);
    this.rotateDuty(new Date(now));

    const date = new Date(at);
    const minutes = dt / 60_000;
    let gold = 0;
    let lumber = 0;
    const k = tuning(s).mining;
    for (const p of s.projects) {
      const f = miningFactor(s, p, date) * k;
      if (f <= 0) continue;
      gold += BALANCE.goldPerMinute * f * minutes;
      lumber += BALANCE.lumberPerMinute * f * minutes;
    }
    s.resources.gold += gold;
    s.resources.lumber += lumber;
    if (gold || lumber) {
      const st = this.stats();
      st.gold += gold;
      st.lumber += lumber;
    }

    // Работа над задачей это движение в проекте.
    for (const t of s.tasks) if (t.status === 'active' && !s.onBreak && !idleGuardTripped(s, now)) this.touch(t.projectId, now);

    const heroBase = this.project(s.hero.baseId);
    const heroTask = heroBase ? activeTaskOf(s, heroBase.id) : undefined;
    if (heroBase && heroTask && !s.onBreak && !idleGuardTripped(s, at)) {
      heroTask.spentMs += dt;
      this.stats().workedMs += dt;
      // Стройка идёт только пока тикает таймер работы.
      if (s.construction) {
        s.construction.leftMs -= dt;
        if (s.construction.leftMs <= 0) this.finishBuild();
      }
      if (!s.hero.fallenAt) {
        const drain = BALANCE.manaDrainPerHour * manaDrainFactor(heroBase.kind, currentShift(s, date));
        s.hero.mana = Math.max(0, s.hero.mana - (drain * dt) / 3_600_000);
        if (s.hero.mana <= 0) this.heroFalls(now);
      }
    } else if (s.onBreak && !s.hero.fallenAt) {
      s.hero.mana = Math.min(s.hero.maxMana, s.hero.mana + (BALANCE.manaBreakRegenPerHour * dt) / 3_600_000);
    }

    // Герои в запасе отдыхают на алтаре и восстанавливают ману, как на привале.
    for (const r of s.reserve ?? []) if (!r.fallenAt) r.mana = Math.min(r.maxMana, r.mana + (BALANCE.manaBreakRegenPerHour * dt) / 3_600_000);

    // Тик не считается действием игрока: Gist по нему не пишется, интерфейс перерисовывается.
    this.emit(false);
  }

  /**
   * Подсчёт волн Легиона. Идёт ночью, а игрок видит итог утром: в первый тик после
   * подъёма каждого нового дня. Задачи с прошедшим сроком становятся демонами,
   * старые демоны вырастают в следующую ступень.
   */
  private legion(now: number) {
    const s = this.state;
    const d = new Date(now);
    const today = localDay(d);
    const [wh, wm] = s.settings.wakeUp.split(':').map(Number);
    const firstTime = !s.lastLegionDay;
    if (s.lastLegionDay === today) return;
    if (!firstTime && d.getHours() * 60 + d.getMinutes() < wh * 60 + wm) return;
    s.lastLegionDay = today;
    this.collecting = [];

    let fresh = 0;
    const grown: string[] = [];
    // Первые дни новой игры и мирный режим: Легион спит. Сроки, прошедшие во сне, считаются с пробуждения.
    const asleep = legionAsleep(s, now);
    const woke = s.startedAt && s.settings.legion !== 'burning' ? localDay(new Date(s.startedAt + BALANCE.quietDays * 86_400_000)) : '';
    for (const t of s.tasks) {
      if (!isOpen(t) || !t.due || t.due >= today) continue;
      // Законсервированный проект Легион не трогает. Сроки, прошедшие за паузу, считаются со дня расконсервации.
      const p = t.projectId ? this.project(t.projectId) : undefined;
      if (p?.frozen) continue;
      if (!t.demonSince) {
        if (asleep) continue;
        const since = [addDays(t.due, 1), p?.thawedOn ?? '', woke].sort().pop()!;
        t.demonSince = since > today ? today : since;
        fresh++;
      }
      const rank = demonRank(t, today, armorDelay(s));
      if (t.demonRank && rank > t.demonRank) grown.push(`«${t.title}» стала: ${DEMONS[rank].name}`);
      t.demonRank = rank;
    }
    const portal = portalSize(s, now);
    if (portal) this.say(`У главной ратуши открыт портал Легиона: ${portal} неразобранных задач старше ${BALANCE.portalScrollDays} дней. Разбери входящие.`, 'warn', fresh ? undefined : 'legion');
    if (fresh) this.say(`Ночью пришёл Пылающий Легион: ${fresh} ${plural(fresh, 'новый демон', 'новых демона', 'новых демонов')}.`, 'warn', 'legion');
    for (const g of grown) this.say(`Демон вырос. ${g}`, 'warn');
    // Метеоры: предупреждение о сроке большой задачи.
    for (const p of s.projects) {
      const m = meteorOf(s, p.id, today);
      if (m) this.say(`Над базой «${p.name}» метеор Инфернала: до срока «${m.task.title}» ${m.daysLeft === 0 ? 'сегодня последний день' : `${m.daysLeft} дн.`}`, 'warn');
    }
    // Скверна: заброшенные проекты гниют, их здания каждую ночь горят сильнее.
    for (const p of s.projects) {
      if (!isBlighted(s, p, now)) continue;
      const before = p.damage ?? 0;
      p.damage = Math.min(100, before + BALANCE.blightDamagePerDay);
      if (before === 0) this.say(`По земле проекта «${p.name}» ползёт скверна: ${idleDays(s, p, now)} дней без движения. Здания загорелись.`, 'warn');
    }
    if (fresh || grown.length || s.projects.some((p) => isBlighted(s, p, now))) {
      for (const p of s.projects) {
        const n = demonsAt(s, p.id, today).length;
        if (n >= BALANCE.demonsToHide) this.say(`База «${p.name}»: демонов ${n}, рабочие прячутся в ратушу.`, 'warn');
      }
    }
    // Захват баз: пять демонов у стен или Инфернал, и база переходит к Легиону.
    for (const p of s.projects) {
      if (p.id === MAIN_HALL_ID || p.capturedAt || p.frozen || asleep) continue;
      const demons = demonsAt(s, p.id, today);
      if (demons.length < demonsToCapture(s) && !demons.some((t) => demonRank(t, today) === 4)) continue;
      this.freezeQuiet(p);
      p.capturedAt = now;
      p.damage = 100;
      this.say(
        `Легион захватил базу «${p.name}»: ${demons.some((t) => demonRank(t, today) === 4) ? 'пришёл Инфернал' : `${demons.length} демонов у стен`}. Рабочие бежали в главную ратушу, здания в руинах. Разберись со всеми её демонами, чтобы отбить базу.`,
        'warn',
        'defeat',
      );
    }
    // Повелитель ужаса не дождался боя до конца месяца и уходит: без наказания и без награды.
    if (s.dreadlord && s.dreadlord.month !== gameMonth(s, d)) {
      if (s.dreadlord.hp > 0) this.say(`Повелитель ужаса ${s.dreadlord.name} ушёл, так и не дождавшись боя. Наказания нет, но и награды тоже.`);
      delete s.dreadlord;
    }
    s.nightReport = { day: today, lines: this.collecting };
    this.collecting = null;
    this.emit();
  }

  /** Рассвет: каждое утро мана героя полностью восстанавливается. */
  private dawn(now: number) {
    const d = new Date(now);
    const today = d.toISOString().slice(0, 10);
    const [wh, wm] = this.state.settings.wakeUp.split(':').map(Number);
    if (today !== this.state.lastDawn && d.getHours() * 60 + d.getMinutes() >= wh * 60 + wm) {
      this.state.lastDawn = today;
      const risen: string[] = [];
      for (const h of allHeroes(this.state)) {
        h.mana = h.maxMana;
        if (h.fallenAt) {
          delete h.fallenAt;
          h.baseId = MAIN_HALL_ID;
          risen.push(h.name);
        }
      }
      const one = !this.state.reserve?.length;
      this.say(
        `Рассвет. ${one ? 'Мана героя полностью восстановлена' : 'Мана героев полностью восстановлена'}.` + (risen.length ? ` У алтаря встали: ${risen.join(', ')}.` : ''),
        'info',
        'dawn',
      );
    }
  }
}
