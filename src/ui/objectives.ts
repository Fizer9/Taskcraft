// Панель целей, как «Главные задачи» миссии в WC3: всегда на экране справа сверху.
// Лестница целей день → неделя → жизнь и проекты рядом как фронты: здоровье вражеской
// крепости и демоны у стен. Щелчок по строке открывает нужное окно или ведёт камеру к базе.

import { activeDreadlord, activeTaskOf, demonsAt, gameDay, onMap, portalSize, weekStart } from '../state/economy';
import { plural, type Store } from '../state/store';
import { MAIN_HALL_ID, type Project } from '../state/types';
import type { World } from '../scene/world';
import { openPlanning, openWeek } from './day';
import { openCouncil } from './council';
import { openBases } from './bases';

const FOLD_KEY = 'taskcraft.objectives.folded';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function folded(): boolean {
  try {
    const v = localStorage.getItem(FOLD_KEY);
    if (v !== null) return v === '1';
  } catch {
    /* хранилище недоступно: решаем по экрану */
  }
  return window.matchMedia('(max-width: 700px), (max-height: 500px)').matches;
}

export class Objectives {
  private el: HTMLElement;
  private html = '';

  constructor(
    private store: Store,
    private world: World,
    /** Щелчок по фронту: выбрать базу. */
    private onFront: (id: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'objectives';
    this.el.classList.toggle('folded', folded());
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.click(e));
    store.subscribe(() => this.render());
    this.render();
  }

  private click(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (!el) return;
    const go = el.dataset.go!;
    if (go === 'fold') {
      const now = !this.el.classList.contains('folded');
      this.el.classList.toggle('folded', now);
      try {
        localStorage.setItem(FOLD_KEY, now ? '1' : '0');
      } catch {
        /* не запомнится, не страшно */
      }
      return;
    }
    if (go === 'task') {
      document.getElementById('side')?.classList.remove('hidden');
      (document.querySelector('#new-scroll input') as HTMLInputElement | null)?.focus();
    } else if (go === 'day') openPlanning(this.store);
    else if (go === 'week') openWeek(this.store);
    else if (go === 'life') openCouncil(this.store);
    else if (go === 'bases') openBases(this.store);
    else if (go.startsWith('base:')) {
      const id = go.slice(5);
      this.onFront(id);
      this.world.ping(id);
    }
  }

  render() {
    const s = this.store.state;
    if (!s.setupDone) return this.set('');
    const day = gameDay(s);
    const rows: string[] = [];
    const row = (go: string, icon: string, name: string, value: string, done = false, warn = false) =>
      rows.push(
        `<button class="obj-row${done ? ' done' : ''}${warn ? ' warn' : ''}" data-go="${go}"><i>${icon}</i><span>${name}</span><b>${value}</b></button>`,
      );

    // ---------- Лестница: сегодня, неделя, жизнь ----------
    const open = s.tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled');
    const plan = s.dayPlan?.day === day ? s.dayPlan.taskIds : [];
    if (plan.length) {
      const done = plan.filter((id) => this.store.task(id)?.status === 'done').length;
      row('day', '☀', 'Сегодня', `${done}/${plan.length} ${plural(plan.length, 'задача', 'задачи', 'задач')}`, done === plan.length);
    } else if (!open) row('task', '☀', 'Сегодня', 'запиши задачу (Q)');
    else row('day', '☀', 'Сегодня', 'составь план');

    const goals = s.week?.start === weekStart(s) ? s.week.goals : [];
    if (goals.length) {
      const done = goals.filter((g) => g.done).length;
      row('week', '🎯', 'Неделя', `${done}/${goals.length} ${plural(goals.length, 'цель', 'цели', 'целей')}`, done === goals.length);
    } else row('week', '🎯', 'Неделя', 'поставь цели');

    if (s.hyjal && s.hyjal.hp > 0) row('life', '⛰', 'Хиджал', `Архимонд ${s.hyjal.hp}/${s.hyjal.maxHp}`, false, true);
    else {
      const reached = s.spheres.filter((sp) => sp.score >= sp.target).length;
      row('life', '⛰', 'Жизнь', `${reached}/${s.spheres.length} ${plural(s.spheres.length, 'земля', 'земли', 'земель')} у цели`, !!s.spheres.length && reached === s.spheres.length);
    }
    const dl = activeDreadlord(s);
    if (dl) {
      const sp = s.spheres.find((x) => x.id === dl.sphereId);
      row('life', '☠', dl.name, `${dl.hp}/${dl.maxHp}${sp ? `, ${esc(sp.name)}` : ''}`, false, true);
    }

    // ---------- Фронты: базы проектов и их крепости ----------
    const fronts: string[] = [];
    const bases = s.projects.filter((p) => p.id !== MAIN_HALL_ID && onMap(p) && p.fortressMaxHp > 0);
    const weight = (p: Project) => (activeTaskOf(s, p.id) ? 1000 : 0) + demonsAt(s, p.id, day).length * 10 + (1 - this.world.fortressShown(p.id) / p.fortressMaxHp);
    for (const p of bases.sort((a, b) => weight(b) - weight(a)).slice(0, 6)) {
      const shown = this.world.fortressShown(p.id);
      const demons = demonsAt(s, p.id, day).length;
      const fight = !!activeTaskOf(s, p.id);
      const state = p.capturedAt ? 'захвачена' : shown <= 0 ? 'крепость пала' : `${shown}/${p.fortressMaxHp}`;
      fronts.push(
        `<button class="obj-front${p.capturedAt ? ' lost' : ''}${shown <= 0 ? ' won' : ''}" data-go="base:${p.id}" title="${esc(p.name)}: здоровье вражеской крепости${demons ? `, демонов у стен ${demons}` : ''}">` +
          `<span>${fight ? '⚔ ' : ''}${esc(p.name)}</span>` +
          `<i class="obj-bar"><i style="width:${((Math.max(0, shown) / p.fortressMaxHp) * 100).toFixed(0)}%"></i></i>` +
          `<b>${state}</b>${demons ? `<em>☠${demons}</em>` : ''}</button>`,
      );
    }
    const hallDemons = demonsAt(s, MAIN_HALL_ID, day).length;
    const portal = portalSize(s);
    if (hallDemons || portal)
      fronts.push(
        `<button class="obj-front lost" data-go="base:${MAIN_HALL_ID}"><span>Главная ратуша</span><b>${portal ? 'портал Легиона' : ''}</b>${hallDemons ? `<em>☠${hallDemons}</em>` : ''}</button>`,
      );
    if (!bases.length) fronts.push(`<button class="obj-row warn" data-go="bases"><i>🏰</i><span>Заложи первую базу</span><b>Проекты</b></button>`);

    this.set(
      `<button class="obj-head" data-go="fold" title="Свернуть или развернуть"><span>Цели</span><i>▾</i></button>` +
        `<div class="obj-body"><div class="obj-ladder">${rows.join('')}</div>` +
        `<div class="obj-title">Фронты</div><div class="obj-fronts">${fronts.join('')}</div></div>`,
    );
  }

  private set(html: string) {
    if (html === this.html) return;
    this.html = html;
    this.el.innerHTML = html;
    this.el.hidden = !html;
  }
}
