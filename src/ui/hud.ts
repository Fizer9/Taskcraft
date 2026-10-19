// Интерфейс поверх сцены: верхняя панель ресурсов, свитки, нижняя консоль
// с миникартой, портретом, информацией и сеткой команд 4×3.

import { BALANCE, UNITS } from '../state/config';
import {
  activeTaskOf,
  currentShift,
  foodCap,
  foodUsed,
  idleGuardTripped,
  levelBySpentTime,
  miningFactor,
  SHIFT_NAMES,
  upkeep,
  xpForLevel,
} from '../state/economy';
import type { GameEvent, Store } from '../state/store';
import type { Level, Project, Task } from '../state/types';
import { BANNER_COLORS } from '../scene/base';
import { MAP_HALF, type World } from '../scene/world';
import type { Sync } from '../storage/sync';
import { openSettings } from './modals';
import { ask } from './modal';

type Selection = { kind: 'base'; id: string } | { kind: 'task'; id: string } | { kind: 'hero' };

interface Command {
  icon: string;
  hotkey: string;
  title: string;
  cost?: string;
  text: string;
  enabled?: boolean;
  run: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Меняет innerHTML только если разметка изменилась: так не сбивается фокус и наведение. */
function setHtml(el: HTMLElement, html: string) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function bar(kind: string, value: number, max: number, label: string): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="bar ${kind}"><span style="width:${pct.toFixed(1)}%"></span><em>${label}</em></div>`;
}

export class Hud {
  private sel: Selection;
  private commands: Command[] = [];

  constructor(
    private store: Store,
    private world: World,
    private sync: Sync,
  ) {
    this.sel = { kind: 'base', id: store.state.hero.baseId };
    world.onSelectBase = (id) => {
      if (id) this.select({ kind: 'base', id });
    };

    store.subscribe(() => this.render());
    store.onEvent((e) => this.message(e));
    sync.onChange(() => this.render());

    this.bindStatic();
    this.render();
    window.setInterval(() => this.drawMinimap(), 200);
    world.select(this.sel.kind === 'base' ? this.sel.id : null);
    world.focusBase(store.state.hero.baseId);
  }

  private select(sel: Selection) {
    this.sel = sel;
    if (sel.kind === 'base') this.world.select(sel.id);
    this.render();
  }

  /** База, к которой относится текущий выбор. */
  private contextBase(): Project | undefined {
    const s = this.sel;
    if (s.kind === 'base') return this.store.project(s.id);
    if (s.kind === 'task') {
      const t = this.store.task(s.id);
      if (t?.projectId) return this.store.project(t.projectId);
    }
    return this.store.project(this.store.state.hero.baseId);
  }

  // ---------- Обработчики ----------

  private bindStatic() {
    const form = $<HTMLFormElement>('new-scroll');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.elements.namedItem('title') as HTMLInputElement;
      const title = input.value.trim();
      if (!title) return;
      const t = this.store.addTask(title);
      input.value = '';
      this.store.say('Новый свиток у ратуши. Укажи проект и уровень, чтобы нанять юнита.');
      this.select({ kind: 'task', id: t.id });
    });

    document.body.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el) return;
      const a = el.dataset.action!;
      const id = el.dataset.id ?? '';
      if (a === 'open-settings') openSettings(this.store, this.sync);
      else if (a === 'toggle-side') $('side').classList.toggle('hidden');
      else if (a === 'select-task') this.select({ kind: 'task', id });
      else if (a === 'select-hero') this.select({ kind: 'hero' });
      else if (a === 'confirm') this.store.confirmWorking();
      else if (a === 'cmd') this.commands[Number(id)]?.enabled !== false && this.commands[Number(id)]?.run();
      else if (a === 'hire-level') this.hireSelected(Number(el.dataset.level) as Level);
    });

    $('command-card').addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.cmd[data-id]');
      this.tooltip(el ? this.commands[Number(el.dataset.id)] : undefined);
    });
    $('command-card').addEventListener('mouseleave', () => this.tooltip(undefined));

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (document.getElementById('modal-root')!.childElementCount) return;
      if (e.key === 'F9') {
        e.preventDefault();
        $('side').classList.toggle('hidden');
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        openSettings(this.store, this.sync);
        return;
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const cmd = this.commands.find((c) => c.hotkey === key || (key === 'Escape' && c.hotkey === 'Esc'));
      if (cmd && cmd.enabled !== false) {
        e.preventDefault();
        cmd.run();
      }
    });

    $('minimap').addEventListener('pointerdown', (e) => {
      const c = e.currentTarget as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 * MAP_HALF - MAP_HALF;
      const z = MAP_HALF - ((e.clientY - r.top) / r.height) * 2 * MAP_HALF;
      this.world.lookAt(x, z);
    });
  }

  private hireSelected(level: Level) {
    if (this.sel.kind !== 'task') return;
    const t = this.store.task(this.sel.id);
    const select = document.getElementById('hire-project') as HTMLSelectElement | null;
    const projectId = select?.value || t?.projectId;
    if (!t || !projectId) return;
    this.store.hire(t.id, projectId, level);
  }

  private async completeTask(t: Task) {
    let corrected: Level | undefined;
    // Калибровка: если по таймеру задача шла заметно дольше уровня, спрашиваем.
    const byTime = levelBySpentTime(t.spentMs);
    if (t.level && byTime > t.level) {
      const answer = await ask(
        'Калибровка',
        `Задача шла ${clock(t.spentMs)}. Это был ${UNITS[byTime].name.toLowerCase()}?`,
        [
          { label: `Да, ${UNITS[byTime].name}`, value: 'yes' },
          { label: `Нет, ${UNITS[t.level].name}`, value: 'no' },
        ],
      );
      if (answer === 'yes') corrected = byTime;
    }
    this.store.complete(t.id, corrected);
  }

  // ---------- Отрисовка ----------

  render() {
    this.renderTop();
    this.renderSide();
    this.renderPortrait();
    this.renderInfo();
    this.renderCard();
    this.renderGuard();
  }

  private renderTop() {
    const s = this.store.state;
    const up = upkeep(s);
    const used = foodUsed(s);
    const cap = foodCap(s);
    const upClass = up.factor === 1 ? '' : up.factor >= 0.7 ? 'low' : 'high';
    const syncLabel = { local: 'Сохранено в браузере', syncing: 'Синхронизация…', synced: 'Сохранено в Gist', error: 'Ошибка Gist' }[this.sync.status];
    setHtml(
      $('resources'),
      `<span class="res" title="Золото"><i class="gold"></i>${Math.floor(s.resources.gold)}</span>` +
        `<span class="res" title="Дерево"><i class="lumber"></i>${Math.floor(s.resources.lumber)}</span>` +
        `<span class="res${used >= cap ? ' over' : ''}" title="Еда: задачи в работе"><i class="food"></i>${used}/${cap}</span>` +
        `<span class="upkeep ${upClass}">${up.label}</span>` +
        `<span class="res sync" title="${esc(this.sync.error)}">${syncLabel}</span>`,
    );
    const now = new Date();
    setHtml($('clock'), `<b>${now.toTimeString().slice(0, 5)}</b> · ${SHIFT_NAMES[currentShift(s, now)]}`);
  }

  private taskRow(t: Task): string {
    const selected = this.sel.kind === 'task' && this.sel.id === t.id ? ' selected' : '';
    const lvl = t.level ? `<span class="lvl">${t.level}</span>` : '<span class="lvl none">?</span>';
    const proj = t.projectId && t.status === 'active' ? ` <span class="active">⚔ ${esc(this.store.project(t.projectId)?.name ?? '')}</span>` : '';
    return `<div class="task${selected}" data-action="select-task" data-id="${t.id}">${lvl}<span class="t">${esc(t.title)}</span>${proj}</div>`;
  }

  private renderSide() {
    const s = this.store.state;
    const base = this.contextBase();
    const inbox = s.tasks.filter((t) => t.status === 'inbox');
    const active = s.tasks.filter((t) => t.status === 'active');
    const hired = base ? s.tasks.filter((t) => t.status === 'hired' && t.projectId === base.id) : [];
    const doneHere = base ? s.tasks.filter((t) => t.status === 'done' && t.projectId === base.id).length : 0;
    const list = (ts: Task[], empty: string) => (ts.length ? ts.map((t) => this.taskRow(t)).join('') : `<div class="empty">${empty}</div>`);
    setHtml(
      $('side-list'),
      `<div class="group-title">Входящие · ${inbox.length}</div>${list(inbox, 'Пусто. Новые дела пиши в поле выше.')}` +
        `<div class="group-title">В работе · ${active.length}</div>${list(active, 'Ни один юнит не в бою.')}` +
        (base
          ? `<div class="group-title">Казарма: ${esc(base.name)} · ${hired.length}</div>${list(hired, 'Нет нанятых юнитов.')}` +
            `<div class="empty" style="margin-top:6px">Выполнено на базе: ${doneHere}</div>`
          : ''),
    );
  }

  private renderPortrait() {
    const h = this.store.state.hero;
    setHtml($('portrait'), `<span data-action="select-hero" title="${esc(h.name)}">ГК</span>`);
    setHtml(
      $('hero-bars'),
      bar('mana', h.mana, h.maxMana, `${Math.floor(h.mana)} / ${h.maxMana}`) +
        bar('xp', h.xp - xpForLevel(h.level - 1), xpForLevel(h.level) - xpForLevel(h.level - 1), `Ур. ${h.level}`),
    );
  }

  private renderInfo() {
    const s = this.store.state;
    const sel = this.sel;
    let html = '';
    if (sel.kind === 'hero') {
      const h = s.hero;
      html =
        `<h3>${esc(h.name)} · уровень ${h.level}</h3>` +
        bar('xp', h.xp, xpForLevel(h.level), `Опыт ${h.xp} / ${xpForLevel(h.level)}`) +
        bar('mana', h.mana, h.maxMana, `Мана ${Math.floor(h.mana)} / ${h.maxMana}`) +
        `<div class="row">Стоит на базе <b>${esc(this.store.project(h.baseId)?.name ?? '')}</b></div>` +
        `<div class="row">Способности откроются в следующих версиях: Молот бури, Удар грома, Оглушение, Аватар.</div>`;
    } else if (sel.kind === 'base') {
      const p = this.store.project(sel.id);
      if (p) html = this.baseInfo(p);
    } else {
      const t = this.store.task(sel.id);
      if (t) html = this.taskInfo(t);
    }
    setHtml($('info'), `<div class="info">${html}</div>`);
  }

  private baseInfo(p: Project): string {
    const s = this.store.state;
    const sphere = s.spheres.find((x) => x.id === p.sphereId);
    const kind = { work: 'рабочая', personal: 'личная', any: 'в любое время' }[p.kind];
    const task = activeTaskOf(s, p.id);
    const f = miningFactor(s, p);
    const heroHere = s.hero.baseId === p.id;
    let status: string;
    if (!task) status = '<span class="stopped">Рабочие ждут: нет задачи в работе</span>';
    else if (s.onBreak) status = '<span class="stopped">Привал</span>';
    else if (idleGuardTripped(s)) status = '<span class="stopped">Рабочие сели отдыхать</span>';
    else status = `<span class="working">Добыча ${Math.round(f * 100)}%${heroHere ? '' : ' (без героя)'}</span>`;
    return (
      `<h3><span style="color:${BANNER_COLORS[p.kind]}">⚑</span> ${esc(p.name)}</h3>` +
      `<div class="row">${sphere ? `Земля: <b>${esc(sphere.name)}</b> ${sphere.score} → ${sphere.target}` : '<b>Бытовые и повторяющиеся дела</b>'} · база ${kind}</div>` +
      (p.fortressMaxHp > 0 ? bar('hp', p.fortressHp, p.fortressMaxHp, `Крепость врага ${p.fortressHp} / ${p.fortressMaxHp}`) : '') +
      (task
        ? `<div class="row">В бою: <b>${esc(task.title)}</b></div><div class="timer">${clock(task.spentMs)}</div>`
        : '') +
      `<div class="row">${status}</div>`
    );
  }

  private taskInfo(t: Task): string {
    const s = this.store.state;
    const status = { inbox: 'Свиток во входящих', hired: 'В казарме', active: 'В бою', done: 'Выполнена', cancelled: 'Отменена' }[t.status];
    const unit = t.level ? `${UNITS[t.level].name} · ${UNITS[t.level].hint} · ${UNITS[t.level].xp} опыта` : 'Уровень не выбран';
    let html = `<h3>${esc(t.title)}</h3><div class="row"><b>${status}</b> · ${unit}</div>`;
    if (t.projectId) html += `<div class="row">База: <b>${esc(this.store.project(t.projectId)?.name ?? '')}</b></div>`;
    if (t.spentMs > 0) html += `<div class="timer">${clock(t.spentMs)}</div>`;
    if (t.status === 'inbox' || t.status === 'hired') {
      const current = t.projectId ?? this.contextBase()?.id ?? '';
      const options = s.projects
        .filter((p) => !p.frozen)
        .map((p) => `<option value="${p.id}"${p.id === current ? ' selected' : ''}>${esc(p.name)}</option>`)
        .join('');
      const levels = ([1, 2, 3, 4] as Level[])
        .map((l) => `<button class="btn${t.level === l ? ' on' : ''}" data-action="hire-level" data-level="${l}" title="${UNITS[l].hint}">${l}. ${UNITS[l].name}</button>`)
        .join('');
      html +=
        `<div class="row" style="margin-top:6px"><select id="hire-project">${options}</select></div>` +
        `<div class="levels">${levels}</div>` +
        (t.status === 'inbox' ? `<div class="row">Найм даёт +${BALANCE.hireLumber} дерева за план.</div>` : '');
    }
    return html;
  }

  private baseCommands(p: Project): Command[] {
    const s = this.store.state;
    const heroHere = s.hero.baseId === p.id;
    return [
      { icon: '✚', hotkey: 'Q', title: 'Новый свиток', text: 'Записать новое дело во входящие.', run: () => this.focusNewScroll() },
      {
        icon: '⚑',
        hotkey: 'W',
        title: 'Перевести героя сюда',
        cost: `${BALANCE.heroMoveCost} маны`,
        text: 'Там, где стоит герой, добыча идёт в полную силу. Переход это цена переключения контекста.',
        enabled: !heroHere,
        run: () => this.store.moveHero(p.id),
      },
      {
        icon: s.onBreak ? '⚒' : '☕',
        hotkey: 'E',
        title: s.onBreak ? 'Закончить привал' : 'Привал',
        text: s.onBreak ? 'Рабочие вернутся к добыче.' : 'Рабочие отдыхают, добыча стоит, мана героя восстанавливается.',
        run: () => this.store.toggleBreak(),
      },
      {
        icon: '✔',
        hotkey: 'R',
        title: 'Я ещё работаю',
        text: `Через ${BALANCE.idleGuardMinutes} минут без отметок рабочие садятся отдыхать. Эта кнопка их поднимает.`,
        run: () => this.store.confirmWorking(),
      },
      {
        icon: '⌂',
        hotkey: 'F',
        title: 'Построить ферму',
        cost: `${BALANCE.farmCost.gold} золота, ${BALANCE.farmCost.lumber} дерева`,
        text: 'Каждая ферма даёт ещё одно место под задачу в работе. Строить можно только во время работы.',
        run: () => this.store.buildFarm(),
      },
      { icon: '◎', hotkey: 'G', title: 'Камера на базу', text: 'Показать эту базу.', run: () => this.world.focusBase(p.id) },
    ];
  }

  private taskCommands(t: Task): Command[] {
    const back = () => {
      const b = this.contextBase();
      if (b) this.select({ kind: 'base', id: b.id });
    };
    const open = t.status === 'inbox' || t.status === 'hired' || t.status === 'active';
    const cmds: (Command | null)[] = [
      {
        icon: '▶',
        hotkey: 'A',
        title: 'В работу',
        text: 'Юнит идёт к вражеской крепости и занимает еду. На базе оживают рабочие. Одна задача в работе на проект.',
        enabled: t.status === 'hired',
        run: () => {
          if (this.store.start(t.id) && t.projectId && t.projectId !== this.store.state.hero.baseId) {
            this.store.say('Герой на другой базе, здесь добыча пойдёт медленно. Переведи его клавишей W на базе.');
          }
        },
      },
      { icon: '⏸', hotkey: 'S', title: 'Вернуть в план', text: 'Остановить работу, юнит вернётся в казарму.', enabled: t.status === 'active', run: () => this.store.stop(t.id) },
      {
        icon: '⚔',
        hotkey: 'D',
        title: 'Готово',
        cost: t.level ? `+${UNITS[t.level].xp} опыта, +${BALANCE.caravanGoldPerLevel * t.level} золота` : undefined,
        text: 'Удар по крепости с уроном, равным уровню. Герой получает опыт, приходит караван с золотом.',
        enabled: (t.status === 'active' || t.status === 'hired') && !!t.level,
        run: () => void this.completeTask(t),
      },
      { icon: '✖', hotkey: 'X', title: 'Отменить', text: 'Юнит распущен, еда освобождена, без штрафа.', enabled: open, run: () => this.store.cancel(t.id) },
    ];
    for (const l of [1, 2, 3, 4] as Level[]) {
      cmds.push({
        icon: String(l),
        hotkey: String(l),
        title: `${UNITS[l].name}`,
        cost: UNITS[l].hint,
        text: `Уровень ${l}: ${UNITS[l].xp} опыта, урон по крепости ${l}.`,
        enabled: open && t.status !== 'active',
        run: () => this.hireSelected(l),
      });
    }
    cmds.push(null, null, null);
    cmds.push({ icon: '↩', hotkey: 'Esc', title: 'Назад', text: 'Вернуться к базе.', run: back });
    return cmds.map((c) => c ?? { icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} });
  }

  private renderCard() {
    const sel = this.sel;
    let cmds: Command[] = [];
    if (sel.kind === 'task') {
      const t = this.store.task(sel.id);
      if (t) cmds = this.taskCommands(t);
    } else {
      const p = this.contextBase();
      if (p) cmds = this.baseCommands(p);
    }
    this.commands = cmds;
    let html = '';
    for (let i = 0; i < 12; i++) {
      const c = cmds[i];
      if (!c || !c.title) html += '<div class="cmd empty"></div>';
      else
        html += `<button class="cmd${c.enabled === false ? ' off' : ''}" data-action="cmd" data-id="${i}" aria-label="${esc(c.title)}"><span class="hk">${c.hotkey}</span>${c.icon}</button>`;
    }
    setHtml($('command-card'), html);
  }

  private renderGuard() {
    const s = this.store.state;
    const heroBase = this.store.project(s.hero.baseId);
    const show = heroBase && activeTaskOf(s, heroBase.id) && !s.onBreak && idleGuardTripped(s);
    setHtml(
      $('guard'),
      show
        ? `<div class="banner">Рабочие сели отдыхать: ${BALANCE.idleGuardMinutes} минут без отметок. Ты ещё работаешь? <button class="btn" data-action="confirm">Да, работаю</button></div>`
        : '',
    );
  }

  private tooltip(c: Command | undefined) {
    const el = $('tooltip');
    if (!c || !c.title) {
      el.style.display = 'none';
      return;
    }
    el.innerHTML =
      `<div class="title">${esc(c.title)} (<span class="hotkey">${c.hotkey}</span>)</div>` +
      (c.cost ? `<div class="cost">${esc(c.cost)}</div>` : '') +
      `<div>${esc(c.text)}</div>`;
    el.style.display = 'block';
  }

  private focusNewScroll() {
    $('side').classList.remove('hidden');
    ($('new-scroll').querySelector('input') as HTMLInputElement).focus();
  }

  private message(e: GameEvent) {
    const box = $('messages');
    const div = document.createElement('div');
    div.className = 'msg ' + e.kind;
    div.textContent = e.text;
    box.appendChild(div);
    window.setTimeout(() => div.remove(), 7000);
    while (box.childElementCount > 6) box.firstElementChild?.remove();
  }

  private drawMinimap() {
    const c = $<HTMLCanvasElement>('minimap');
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const k = W / (MAP_HALF * 2);
    const toX = (x: number) => (x + MAP_HALF) * k;
    const toY = (z: number) => (MAP_HALF - z) * k;
    ctx.fillStyle = '#3c5a24';
    ctx.fillRect(0, 0, W, W);
    const s = this.store.state;
    for (const p of s.projects) {
      const x = toX(p.slot.x);
      const y = toY(p.slot.z);
      if (p.fortressMaxHp > 0 && p.fortressHp > 0) {
        const len = Math.hypot(p.slot.x, p.slot.z) || 1;
        ctx.fillStyle = '#d43a2a';
        ctx.fillRect(toX(p.slot.x + (p.slot.x / len) * 48) - 2, toY(p.slot.z + (p.slot.z / len) * 48) - 2, 4, 4);
      }
      ctx.fillStyle = BANNER_COLORS[p.kind];
      const size = p.id === 'main' ? 9 : 6;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (activeTaskOf(s, p.id)) {
        ctx.strokeStyle = '#7dff7d';
        ctx.strokeRect(x - size / 2 - 2, y - size / 2 - 2, size + 4, size + 4);
      }
    }
    const hero = this.store.project(s.hero.baseId);
    if (hero) {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(toX(hero.slot.x) + 6, toY(hero.slot.z) + 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Рамка видимой области камеры.
    const t = this.world.cameraTarget();
    const r = this.world.camera.radius;
    const halfW = r * 0.75;
    const halfH = r * 0.45;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(toX(t.x - halfW), toY(t.z + halfH), halfW * 2 * k, halfH * 2 * k);
  }
}
