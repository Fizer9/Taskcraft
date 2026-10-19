// Хранилище состояния и все действия игрока. Интерфейс и сцена только
// читают состояние и подписываются на изменения.

import { BALANCE, UNITS } from './config';
import {
  activeTaskOf,
  currentShift,
  foodCap,
  foodUsed,
  idleGuardTripped,
  manaDrainFactor,
  miningFactor,
  xpForLevel,
} from './economy';
import { createInitialState } from './seed';
import type { GameState, Level, Task } from './types';

export type GameEvent = { id: number; text: string; kind: 'info' | 'gold' | 'warn' | 'win' };

/** changed = true для действий игрока, false для тиков времени. */
type Listener = (state: GameState, changed: boolean) => void;

let eventSeq = 0;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export class Store {
  state: GameState;
  /** Сообщения как текст поверх консоли в WC3, не сохраняются. */
  events: GameEvent[] = [];
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: GameEvent) => void>();

  constructor(initial?: GameState) {
    this.state = initial ?? createInitialState();
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
    this.emit();
  }

  private emit(changed = true) {
    if (changed) this.state.updatedAt = Date.now();
    for (const l of this.listeners) l(this.state, changed);
  }

  say(text: string, kind: GameEvent['kind'] = 'info') {
    const e = { id: ++eventSeq, text, kind };
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
    const wasInbox = t.status === 'inbox';
    t.projectId = projectId;
    t.level = level;
    if (wasInbox) {
      t.status = 'hired';
      this.state.resources.lumber += BALANCE.hireLumber;
      this.say(`${UNITS[level].name} готов к бою. +${BALANCE.hireLumber} дерева за план`, 'gold');
    }
    if (emit) this.emit();
  }

  /** В работу: юнит идёт к крепости и занимает еду. Одна задача на проект. */
  start(id: string): boolean {
    const t = this.task(id);
    if (!t || !t.projectId || !t.level) return false;
    if (t.status !== 'hired') return false;
    const busy = activeTaskOf(this.state, t.projectId);
    if (busy) {
      this.say(`На этой базе уже идёт «${busy.title}». Одна задача в работе на проект.`, 'warn');
      return false;
    }
    if (foodUsed(this.state) >= foodCap(this.state)) {
      this.say('Нужно построить больше ферм.', 'warn');
      return false;
    }
    t.status = 'active';
    this.state.lastConfirmAt = Date.now();
    this.state.onBreak = false;
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
    const level = correctedLevel ?? t.level;
    t.level = level;
    t.status = 'done';
    t.doneAt = Date.now();
    const gold = BALANCE.caravanGoldPerLevel * level;
    this.state.resources.gold += gold;
    this.say(`Караван привёз ${gold} золота`, 'gold');
    this.gainXp(UNITS[level].xp);
    const p = t.projectId ? this.project(t.projectId) : undefined;
    if (p && p.fortressMaxHp > 0 && p.fortressHp > 0) {
      p.fortressHp = Math.max(0, p.fortressHp - level);
      if (p.fortressHp === 0) this.say(`Вражеская крепость проекта «${p.name}» пала! Миссия выиграна.`, 'win');
    }
    this.emit();
  }

  cancel(id: string) {
    const t = this.task(id);
    if (!t) return;
    t.status = 'cancelled';
    this.say('Юнит распущен.');
    this.emit();
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
    h.xp += xp;
    while (h.level < 10 && h.xp >= xpForLevel(h.level)) {
      h.level += 1;
      this.say(`${h.name} достиг ${h.level} уровня!`, 'win');
    }
  }

  moveHero(baseId: string) {
    const h = this.state.hero;
    if (h.baseId === baseId) return;
    if (h.mana < BALANCE.heroMoveCost) {
      this.say('Не хватает маны.', 'warn');
      return;
    }
    h.mana -= BALANCE.heroMoveCost;
    h.baseId = baseId;
    this.say(`${h.name} перешёл на базу «${this.project(baseId)?.name}». −${BALANCE.heroMoveCost} маны`);
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
    const { gold, lumber } = BALANCE.farmCost;
    const r = this.state.resources;
    const heroBase = this.project(this.state.hero.baseId);
    if (!heroBase || miningFactor(this.state, heroBase) === 0) {
      this.say('Строить можно только во время работы.', 'warn');
      return;
    }
    if (r.gold < gold) return this.say('Нужно больше золота.', 'warn');
    if (r.lumber < lumber) return this.say('Нужно больше дерева.', 'warn');
    r.gold -= gold;
    r.lumber -= lumber;
    this.state.farms += 1;
    this.say('Ферма построена. +1 место под задачу в работе');
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
    s.lastTick = now;

    this.dawn(now);

    const date = new Date(now);
    const minutes = dt / 60_000;
    let gold = 0;
    let lumber = 0;
    for (const p of s.projects) {
      const f = miningFactor(s, p, date);
      if (f <= 0) continue;
      gold += BALANCE.goldPerMinute * f * minutes;
      lumber += BALANCE.lumberPerMinute * f * minutes;
    }
    s.resources.gold += gold;
    s.resources.lumber += lumber;

    const heroBase = this.project(s.hero.baseId);
    const heroTask = heroBase ? activeTaskOf(s, heroBase.id) : undefined;
    if (heroBase && heroTask && !s.onBreak && !idleGuardTripped(s, now)) {
      heroTask.spentMs += dt;
      const drain = BALANCE.manaDrainPerHour * manaDrainFactor(heroBase.kind, currentShift(s, date));
      s.hero.mana = Math.max(0, s.hero.mana - (drain * dt) / 3_600_000);
    } else if (s.onBreak) {
      s.hero.mana = Math.min(s.hero.maxMana, s.hero.mana + (BALANCE.manaBreakRegenPerHour * dt) / 3_600_000);
    }

    // Тик не считается действием игрока: Gist по нему не пишется, интерфейс перерисовывается.
    this.emit(false);
  }

  /** Рассвет: каждое утро мана героя полностью восстанавливается. */
  private dawn(now: number) {
    const d = new Date(now);
    const today = d.toISOString().slice(0, 10);
    const [wh, wm] = this.state.settings.wakeUp.split(':').map(Number);
    if (today !== this.state.lastDawn && d.getHours() * 60 + d.getMinutes() >= wh * 60 + wm) {
      this.state.lastDawn = today;
      this.state.hero.mana = this.state.hero.maxMana;
      this.say('Рассвет. Мана героя полностью восстановлена.');
    }
  }
}
