// Новая глава кампании после победы у горы Хиджал: игрок поднимает цели земель.
// Оценки остаются, цель каждой земли по умолчанию на единицу выше.

import { BALANCE } from '../state/config';
import type { Store } from '../state/store';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function openChapter(store: Store, onLater: () => void = () => {}) {
  const s = store.state;
  const next = (s.chapter ?? 1) + 1;
  const rows = s.spheres
    .map((sp) => {
      const suggest = Math.min(10, sp.target + 1);
      const options = Array.from({ length: 10 - sp.score + 1 }, (_, i) => sp.score + i)
        .map((n) => `<option${n === suggest ? ' selected' : ''}>${n}</option>`)
        .join('');
      return (
        `<div class="council-row" data-id="${sp.id}"><div class="council-name"><b>${esc(sp.name)}</b></div>` +
        `<div class="council-basis">сейчас ${sp.score}, была цель ${sp.target}</div>` +
        `<div class="council-score"><span class="muted">новая цель</span><select data-f="target">${options}</select></div></div>`
      );
    })
    .join('');
  const { root, close } = openModal(
    `<h3>Глава ${next}</h3>` +
      `<div class="hint">Архимонд повержен, все земли под контролем. Подними цели: куда каждая земля должна дойти в новой главе. Награда: ${BALANCE.hyjalXp} опыта и ${BALANCE.hyjalGold} золота.</div>` +
      `<div class="council-list">${rows}</div>` +
      `<div class="actions"><button class="btn" data-a="later">Позже</button><button class="btn" data-a="ok">Начать главу ${next}</button></div>`,
    'wide',
  );
  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
    const targets = [...root.querySelectorAll<HTMLElement>('.council-row')].map((row) => ({
      id: row.dataset.id!,
      target: Number((row.querySelector('[data-f="target"]') as HTMLSelectElement).value),
    }));
    close();
    store.newChapter(targets);
  });
}
