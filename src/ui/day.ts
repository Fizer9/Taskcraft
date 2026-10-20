// Ритм дня, раздел 5: утреннее планирование и итоги дня перед отбоем.

import { BALANCE, DEMONS, UNITS } from '../state/config';
import { demonBaseId, demonRank, gameDay, isDemon, isOpen, weekStart } from '../state/economy';
import type { Store } from '../state/store';
import type { Task } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function label(t: Task): string {
  const unit = t.level ? UNITS[t.level].name : 'свиток';
  const demon = isDemon(t) ? ` · ☠ ${DEMONS[demonRank(t)].name}` : t.due ? ` · срок ${t.due.slice(8)}.${t.due.slice(5, 7)}` : '';
  return `${t.title} (${unit}${demon})`;
}

/**
 * Утреннее планирование: что пришло ночью и выбор задач на день, по одной на проект.
 * По умолчанию предлагается задача в работе, потом сильнейший демон, потом первый нанятый юнит.
 */
export function openPlanning(store: Store, onLater: () => void = () => {}) {
  const s = store.state;
  const day = gameDay(s);
  const planned = new Set(s.dayPlan?.day === day ? s.dayPlan.taskIds : []);
  const report = s.nightReport?.day === day ? s.nightReport.lines : [];

  const rows = s.projects
    .filter((p) => !p.frozen)
    .map((p) => {
      const open = s.tasks.filter((t) => isOpen(t) && t.level && demonBaseId(t) === p.id);
      if (!open.length) return '';
      const rank = (t: Task) => (planned.has(t.id) ? 0 : t.status === 'active' ? 1 : isDemon(t) ? 2 + (4 - demonRank(t)) / 10 : 3);
      open.sort((a, b) => rank(a) - rank(b));
      const preselect = planned.size ? open.find((t) => planned.has(t.id)) : open[0];
      const options = open.map((t) => `<option value="${t.id}"${t === preselect ? ' selected' : ''}>${esc(label(t))}</option>`).join('');
      return `<div class="plan-row"><span>${esc(p.name)}</span><select data-project="${p.id}"><option value="">— ничего</option>${options}</select></div>`;
    })
    .join('');

  const { root, close } = openModal(
    `<h3>Утреннее планирование</h3>` +
      `<div class="plan-report">${report.length ? report.map((l) => `<div>☠ ${esc(l)}</div>`).join('') : '<div>Ночь прошла спокойно, Легион не приходил.</div>'}</div>` +
      `<label>Задачи на сегодня, по одной на проект</label>` +
      (rows ? `<div class="plan-list">${rows}</div>` : '<div class="hint">Нанятых юнитов пока нет. Запиши свитки и назначь им проект и уровень.</div>') +
      `<div class="hint">Каждая новая задача в плане даёт +${BALANCE.planLumberPerTask} дерева: дерево платит за план.</div>` +
      `<div class="actions"><button class="btn" data-a="later">Позже</button><button class="btn" data-a="ok">Утвердить план</button></div>`,
    'wide',
  );
  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
    const ids = [...root.querySelectorAll<HTMLSelectElement>('select[data-project]')].map((x) => x.value).filter(Boolean);
    close();
    store.planDay(ids);
  });
}

function clock(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

/** Итоги дня, как экран статистики в конце партии WC3, и решение по незаконченным задачам. */
export function openSummary(store: Store, onLater: () => void = () => {}) {
  const s = store.state;
  const st = store.stats();
  const day = gameDay(s);
  const plan = s.dayPlan?.day === day ? s.dayPlan.taskIds.map((id) => store.task(id)).filter((t): t is Task => !!t) : [];
  const planDone = plan.filter((t) => t.status === 'done').length;
  const active = s.tasks.filter((t) => t.status === 'active');
  const cells: [string, string][] = [
    ['Добыто золота', String(Math.floor(st.gold))],
    ['Добыто дерева', String(Math.floor(st.lumber))],
    ['Закрыто задач', String(st.done)],
    ['Урон крепостям', String(st.damage)],
    ['Повержено демонов', String(st.demons)],
    ['Время в работе', clock(st.workedMs)],
    ['План дня', plan.length ? `${planDone} из ${plan.length}` : 'не составлен'],
  ];
  const { root, close } = openModal(
    `<h3>Итоги дня</h3>` +
      `<table class="stats">${cells.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>` +
      (active.length
        ? `<label>Незаконченные задачи: оставить в работе на завтра?</label>` +
          active
            .map(
              (t) =>
                `<label class="check"><input type="checkbox" data-id="${t.id}" checked> ${esc(t.title)} <span class="hint">· ${esc(store.project(t.projectId ?? '')?.name ?? '')}</span></label>`,
            )
            .join('') +
          `<div class="hint">Без галочки задача вернётся в план, а её место в еде освободится.</div>`
        : '') +
      `<div class="actions"><button class="btn" data-a="later">Ещё работаю</button><button class="btn" data-a="ok">Завершить день</button></div>`,
    'wide',
  );
  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
    const keep = [...root.querySelectorAll<HTMLInputElement>('input[data-id]:checked')].map((x) => x.dataset.id!);
    close();
    store.endDay(keep);
  });
}

/**
 * Планирование главы недели: 2–3 главные цели. Если прошлая глава ещё открыта,
 * сначала отмечаем, что из неё выполнено: за каждую цель приходит золото.
 */
export function openWeek(store: Store, onLater: () => void = () => {}) {
  const s = store.state;
  const start = weekStart(s);
  const old = s.week && s.week.start !== start ? s.week : null;
  const current = s.week?.start === start ? s.week.goals.map((g) => g.text) : [];
  const { root, close } = openModal(
    `<h3>Глава недели</h3>` +
      (old && old.goals.length
        ? `<label>Прошлая глава с ${old.start.slice(8)}.${old.start.slice(5, 7)}: что выполнено?</label>` +
          old.goals.map((g, i) => `<label class="check"><input type="checkbox" data-old="${i}"${g.done ? ' checked' : ''}> ${esc(g.text)}</label>`).join('') +
          `<div class="hint">За каждую выполненную цель +${BALANCE.weekGoalGold} золота.</div>`
        : '') +
      `<label>Главные цели этой недели, две или три</label>` +
      [0, 1, 2].map((i) => `<input name="goal" value="${esc(current[i] ?? '')}" placeholder="${['Например: сдать модуль React', 'Вторая цель', 'Третья, если нужна'][i]}" style="margin-top:6px">`).join('') +
      `<div class="actions"><button class="btn" data-a="later">Позже</button><button class="btn" data-a="ok">Начать главу</button></div>`,
    'wide',
  );
  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
    if (old) root.querySelectorAll<HTMLInputElement>('input[data-old]').forEach((x) => (old.goals[Number(x.dataset.old)].done = x.checked));
    const goals = [...root.querySelectorAll<HTMLInputElement>('input[name="goal"]')].map((x) => x.value);
    close();
    store.planWeek(goals);
  });
}
