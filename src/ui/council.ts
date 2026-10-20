// Совет земель раз в месяц (раздел 3 дизайна). Оценки сфер ставит сам игрок, а игра
// показывает основания: что сделано в каждой земле, сколько пало крепостей и отбито демонов.

import { BALANCE } from '../state/config';
import { councilSince, gameMonth, sphereReport, type SphereReport } from '../state/economy';
import type { Store } from '../state/store';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function scoreSelect(name: string, value: number): string {
  return `<select data-f="${name}">${Array.from({ length: 10 }, (_, i) => i + 1)
    .map((n) => `<option${n === value ? ' selected' : ''}>${n}</option>`)
    .join('')}</select>`;
}

/** Основания одной строкой: только то, что было. */
function basis(r: SphereReport): string {
  if (!r.bases) return '<span class="muted">Проектов нет: только привычки и бытовое</span>';
  const parts = [
    `задач ${r.done}`,
    r.fortresses ? `<b class="win">крепостей пало ${r.fortresses}</b>` : '',
    r.demonsBeaten ? `демонов повержено ${r.demonsBeaten}` : '',
    r.demonsBanished ? `изгнано ${r.demonsBanished}` : '',
    r.demonsNow ? `<span class="legion">☠ у стен ${r.demonsNow}</span>` : '',
    r.blighted ? `<span class="legion">скверна на ${r.blighted}</span>` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

export function openCouncil(store: Store, onLater: () => void = () => {}) {
  const s = store.state;
  const month = gameMonth(s);
  const held = s.councilMonth === month;
  const since = councilSince(s);
  const prev = s.councilHistory?.filter((h) => h.month !== month).slice(-1)[0];
  // Сверху земли, которым дальше всего до цели: о них совет говорит первым.
  const spheres = [...s.spheres].sort((a, b) => b.target - b.score - (a.target - a.score));
  const rows = spheres
    .map((sp) => {
      const r = sphereReport(s, sp.id);
      const was = prev?.scores[sp.id];
      return (
        `<div class="council-row" data-id="${sp.id}">` +
        `<div class="council-name"><b>${esc(sp.name)}</b>${was !== undefined && was !== sp.score ? ` <span class="muted">на прошлом совете ${was}</span>` : ''}</div>` +
        `<div class="council-basis">${basis(r)}</div>` +
        `<div class="council-score">${scoreSelect('score', sp.score)}<b>→</b>${scoreSelect('target', sp.target)}</div>` +
        `</div>`
      );
    })
    .join('');
  const sinceText = s.councilAt
    ? `с прошлого совета ${new Date(since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
    : 'за последние 30 дней';

  const { root, close } = openModal(
    `<h3>Совет земель · ${monthName(month)}</h3>` +
      `<div class="hint">Оцени каждую землю от 1 до 10: насколько она под контролем. Справа цель. Основания ${sinceText}. ${held ? 'Совет этого месяца уже был, оценки можно поправить.' : `За совет +${BALANCE.councilGold} золота.`}</div>` +
      `<div class="council-list">${rows}</div>` +
      `<div class="actions"><button class="btn" data-a="later">Позже</button><button class="btn" data-a="ok">${held ? 'Сохранить' : 'Завершить совет'}</button></div>`,
    'wide',
  );
  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
    const items = [...root.querySelectorAll<HTMLElement>('.council-row')].map((row) => {
      const f = (n: string) => Number((row.querySelector(`[data-f="${n}"]`) as HTMLSelectElement).value);
      return { id: row.dataset.id!, score: f('score'), target: f('target') };
    });
    close();
    store.holdCouncil(items);
  });
}
