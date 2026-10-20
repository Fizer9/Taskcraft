// Зал славы: выигранные миссии. Когда крепость пала, базу можно отправить сюда:
// с карты она уходит, а здесь остаются её имя, земля, сроки и сделанные задачи.

import type { Store } from '../state/store';
import { MAIN_HALL_ID } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const date = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const days = (from: number, to: number) => Math.max(1, Math.round((to - from) / 86_400_000));

export function openHall(store: Store) {
  const s = store.state;
  const hall = [...(s.hallOfFame ?? [])].sort((a, b) => b.wonAt - a.wonAt);
  // Крепость пала, а база ещё на карте: её можно отправить в зал прямо отсюда.
  const waiting = s.projects.filter((p) => p.id !== MAIN_HALL_ID && p.fortressMaxHp > 0 && p.fortressHp === 0);
  const weeks = (s.weekHistory ?? []).filter((w) => w.total && w.done === w.total).length;
  const stats = [
    `Миссий выиграно: <b>${hall.length + waiting.length}</b>`,
    `Повелителей ужаса повержено: <b>${s.dreadlordsSlain ?? 0}</b>`,
    `Глав недели закрыто полностью: <b>${weeks}</b>`,
    ...(s.chapter && s.chapter > 1 ? [`Глав кампании пройдено: <b>${s.chapter - 1}</b>`] : []),
  ];

  const { root, close } = openModal(
    `<h3>Зал славы</h3>` +
      `<div class="hall-stats">${stats.join(' · ')}</div>` +
      (waiting.length
        ? `<div class="group-title">Крепость пала, база ещё на карте</div>` +
          waiting
            .map(
              (p) =>
                `<div class="hall-row waiting"><div><b>${esc(p.name)}</b> <span class="muted">${p.wonAt ? date(p.wonAt) : ''}</span></div>` +
                `<button class="btn" data-a="enshrine" data-id="${p.id}">В зал славы</button></div>`,
            )
            .join('')
        : '') +
      (hall.length
        ? `<div class="hall-list">${hall
            .map(
              (g) =>
                `<div class="hall-row"><div class="hall-trophy">🏆</div><div><b>${esc(g.name)}</b>` +
                `<div class="muted">${esc(g.sphereName)} · взята ${date(g.wonAt)} · за ${days(g.startedAt, g.wonAt)} дн. · задач ${g.done} · крепость ${g.hp}</div></div></div>`,
            )
            .join('')}</div>`
        : `<div class="hint">Здесь будут миссии, чьи крепости пали. Когда крепость проекта падёт, отправь базу сюда из её панели.</div>`) +
      `<div class="actions"><button class="btn" data-a="close">Закрыть</button></div>`,
    'wide',
  );
  root.querySelector('[data-a="close"]')!.addEventListener('click', close);
  root.querySelectorAll<HTMLButtonElement>('[data-a="enshrine"]').forEach((b) =>
    b.addEventListener('click', () => {
      close();
      store.enshrine(b.dataset.id!);
      openHall(store);
    }),
  );
}
