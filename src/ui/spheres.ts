// Редактор сфер жизни: названия, оценки и цели (раздел 3 дизайна). Сфера это земля
// на карте, оценка показывает, насколько земля под контролем, цель это граница,
// до которой её надо отвоевать.

import type { Store } from '../state/store';
import type { Sphere } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const SCORES = Array.from({ length: 10 }, (_, i) => i + 1);

function scoreSelect(name: string, value: number): string {
  return `<select data-f="${name}">${SCORES.map((n) => `<option${n === value ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
}

export function openSpheres(store: Store) {
  const s = store.state;
  const projectsOf = (id: string) => s.projects.filter((p) => p.sphereId === id && p.id !== 'main');

  const row = (sp: Partial<Sphere>) => {
    const projects = sp.id ? projectsOf(sp.id) : [];
    const used = projects.length > 0;
    return (
      `<div class="sphere-row" data-id="${sp.id ?? ''}">` +
      `<input data-f="name" maxlength="40" value="${esc(sp.name ?? '')}" placeholder="Название сферы">` +
      `<span class="sphere-score">${scoreSelect('score', sp.score ?? 5)}<b>→</b>${scoreSelect('target', sp.target ?? 7)}</span>` +
      `<button class="btn sphere-del" data-a="del" title="${used ? 'В сфере есть проекты: сначала перенеси их в другую сферу' : 'Удалить сферу'}"${used ? ' disabled' : ''}>✕</button>` +
      `<div class="sphere-projects">${used ? projects.map((p) => esc(p.name)).join(', ') : 'Проектов нет: здесь будет аванпост с привычками'}</div>` +
      `</div>`
    );
  };

  const { root, close } = openModal(
    `<h3>Сферы жизни</h3>` +
      `<div class="hint">Оценка от 1 до 10: насколько земля под контролем. Цель: до какой оценки её отвоевать. Когда все сферы дойдут до цели, придёт битва у Хиджала.</div>` +
      `<div class="sphere-list">${s.spheres.map(row).join('')}</div>` +
      `<button class="btn" data-a="add">+ Новая сфера</button>` +
      `<div class="err"></div>` +
      `<div class="actions"><button class="btn" data-a="cancel">Закрыть</button><button class="btn" data-a="save">Сохранить</button></div>`,
    'wide',
  );
  const list = root.querySelector('.sphere-list')!;
  const err = root.querySelector('.err') as HTMLElement;

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-a="del"]');
    if (btn && !btn.disabled) btn.closest('.sphere-row')!.remove();
  });
  root.querySelector('[data-a="add"]')!.addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', row({}));
    (list.lastElementChild!.querySelector('[data-f="name"]') as HTMLInputElement).focus();
  });
  root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
  root.querySelector('[data-a="save"]')!.addEventListener('click', () => {
    const rows = [...list.querySelectorAll<HTMLElement>('.sphere-row')].map((r) => {
      const f = (n: string) => (r.querySelector(`[data-f="${n}"]`) as HTMLInputElement).value;
      return { id: r.dataset.id || undefined, name: f('name').trim(), score: Number(f('score')), target: Number(f('target')) };
    });
    if (rows.some((r) => !r.name)) {
      err.textContent = 'У каждой сферы должно быть название.';
      return;
    }
    if (!rows.length) {
      err.textContent = 'Нужна хотя бы одна сфера.';
      return;
    }
    close();
    store.saveSpheres(rows);
  });
}
