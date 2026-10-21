// Разбор входящих пачкой: все неразобранные свитки в одном окне. Каждому сразу
// проект, уровень и срок, ненужные в огонь. Старые свитки сверху: из них растёт портал.

import { BALANCE, UNITS } from '../state/config';
import { isDemon, rescheduleCost } from '../state/economy';
import type { Store } from '../state/store';
import { maxLevel } from '../state/tech';
import type { Level, Task } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function age(t: Task, now: number): string {
  const days = Math.floor((now - t.createdAt) / 86_400_000);
  if (days <= 0) return 'сегодня';
  return `${days} дн.`;
}

export function openTriage(store: Store) {
  const s = store.state;
  const now = Date.now();
  const inbox = s.tasks.filter((t) => t.status === 'inbox').sort((a, b) => a.createdAt - b.createdAt);
  const projects = s.projects.filter((p) => !p.frozen);

  const rows = inbox
    .map((t) => {
      const stale = now - t.createdAt >= BALANCE.portalScrollDays * 86_400_000;
      const proj = `<select data-f="project"><option value="">— проект</option>${projects
        .map((p) => `<option value="${p.id}"${p.id === t.projectId ? ' selected' : ''}>${esc(p.name)}</option>`)
        .join('')}</select>`;
      const level = `<select data-f="level"><option value="">— уровень</option>${([1, 2, 3, 4] as Level[])
        .map((l) => `<option value="${l}"${l === t.level ? ' selected' : ''}${l > maxLevel(s) && l !== t.level ? ' disabled' : ''}>${l}. ${UNITS[l].name}</option>`)
        .join('')}</select>`;
      const due = `<input type="date" data-f="due" value="${t.due ?? ''}" title="${t.due ? `Отодвинуть срок стоит ${rescheduleCost(t)} дерева` : 'Срок можно не ставить'}">`;
      return (
        `<div class="triage-row" data-id="${t.id}">` +
        `<div class="triage-title"><span>${isDemon(t) ? '☠ ' : ''}${esc(t.title)}</span><span class="triage-age${stale ? ' stale' : ''}">${age(t, now)}</span></div>` +
        `<div class="triage-fields">${proj}${level}${due}<label class="check" title="Сжечь задачу: дело не нужно"><input type="checkbox" data-f="drop"> в огонь</label></div>` +
        `</div>`
      );
    })
    .join('');

  const { root, close } = openModal(
    `<h3>Разбор входящих · ${inbox.length}</h3>` +
      (inbox.length
        ? `<div class="hint">Задача с проектом и уровнем становится юнитом в казарме, +${BALANCE.hireLumber} дерева за каждого. Задачи старше ${BALANCE.portalScrollDays} дней кормят портал Легиона.</div>` +
          `<div class="triage-list">${rows}</div>`
        : '<div class="hint">Входящие пусты. Новые дела пиши в поле над списком.</div>') +
      `<div class="actions"><button class="btn" data-a="cancel">Закрыть</button>${inbox.length ? '<button class="btn" data-a="ok">Разобрать</button>' : ''}</div>`,
    'wide',
  );

  // Выбор проекта в первой строке предлагается следующим пустым строкам: обычно
  // свитки разбирают подряд по одному проекту.
  root.querySelectorAll<HTMLSelectElement>('select[data-f="project"]').forEach((sel, i, all) =>
    sel.addEventListener('change', () => {
      for (let j = i + 1; j < all.length; j++) if (!all[j].value && !all[j].dataset.touched) all[j].value = sel.value;
      sel.dataset.touched = '1';
    }),
  );
  root.querySelectorAll<HTMLInputElement>('input[data-f="drop"]').forEach((box) =>
    box.addEventListener('change', () => box.closest('.triage-row')!.classList.toggle('dropped', box.checked)),
  );

  root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
  root.querySelector('[data-a="ok"]')?.addEventListener('click', () => {
    const items = [...root.querySelectorAll<HTMLElement>('.triage-row')].map((row) => {
      const f = (name: string) => row.querySelector<HTMLInputElement>(`[data-f="${name}"]`)!;
      return {
        id: row.dataset.id!,
        projectId: f('project').value || null,
        level: f('level').value ? (Number(f('level').value) as Level) : null,
        due: f('due').value || null,
        drop: f('drop').checked,
      };
    });
    close();
    store.triage(items);
  });
}
