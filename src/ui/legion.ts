// Экран возвращения: после долгого отсутствия вся армия Легиона на одном экране.
// Каждого демона можно сделать, перенести или изгнать разом, оставленные ждут дальше.
// Открывается сам, если игры не было пару дней, и вручную из группы Легиона в свитках.

import { DEMONS } from '../state/config';
import { addDays, allDemons, daysBetween, demonBaseId, demonRank, localDay, rescheduleCost } from '../state/economy';
import type { Store } from '../state/store';
import type { Task } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

type Act = 'keep' | 'done' | 'move' | 'banish';

const ACTS: { id: Act; label: string; title: string }[] = [
  { id: 'keep', label: 'Оставить', title: 'Демон ждёт дальше и растёт.' },
  { id: 'done', label: '⚔ Сделано', title: 'Задача сделана: опыт по её уровню и караван с золотом.' },
  { id: 'move', label: '↻ Перенести', title: 'Новый срок, это стоит дерева.' },
  { id: 'banish', label: '✖ Изгнать', title: 'Отказаться от задачи: бесплатно, но без опыта.' },
];

/** Сделать можно только нанятый юнит с уровнем; свиток без проекта сначала разбирают. */
const canDo = (t: Task) => (t.status === 'hired' || t.status === 'active') && !!t.level;

export function openLegion(store: Store, awayDays = 0, onLater: () => void = () => {}) {
  const s = store.state;
  const today = localDay();
  const demons = allDemons(s);
  const groups = [...new Set(demons.map(demonBaseId))]
    .map((id) => ({
      p: store.project(id),
      list: demons
        .filter((t) => demonBaseId(t) === id)
        .sort((a, b) => demonRank(b) - demonRank(a) || (a.demonSince ?? '').localeCompare(b.demonSince ?? '')),
    }))
    .sort((a, b) => Number(!!b.p?.capturedAt) - Number(!!a.p?.capturedAt) || b.list.length - a.list.length);

  const row = (t: Task) => {
    const rank = demonRank(t);
    const late = t.demonSince ? daysBetween(t.demonSince, today) : 0;
    const acts = ACTS.map(
      (a) =>
        `<label class="legion-act${a.id === 'done' && !canDo(t) ? ' off' : ''}" title="${a.id === 'done' && !canDo(t) ? 'Свиток без проекта: сначала разбери его во входящих.' : a.title}">` +
        `<input type="radio" name="act-${t.id}" value="${a.id}"${a.id === 'keep' ? ' checked' : ''}${a.id === 'done' && !canDo(t) ? ' disabled' : ''}>${a.label}</label>`,
    ).join('');
    return (
      `<div class="triage-row legion-row" data-id="${t.id}" data-cost="${rescheduleCost(t)}">` +
      `<div class="triage-title"><span><span class="legion-rank r${rank}" title="${DEMONS[rank].name}">☠${rank}</span> ${esc(t.title)}</span>` +
      `<span class="triage-age">${DEMONS[rank].name}${late ? ` · ${late} дн.` : ''}</span></div>` +
      `<div class="legion-acts">${acts}<input type="date" data-f="due" value="${addDays(today, 7)}" min="${today}" disabled title="Новый срок"></div>` +
      `</div>`
    );
  };

  const captured = groups.filter((g) => g.p?.capturedAt).map((g) => `«${esc(g.p!.name)}»`);
  const baseWord = groups.length === 1 ? 'базы' : 'баз';
  const lead = awayDays
    ? `Тебя не было ${awayDays} дн. Легион не ждал: демонов ${demons.length} у ${groups.length} ${baseWord}.`
    : `Демонов ${demons.length} у ${groups.length} ${baseWord}.`;

  const { root, close } = openModal(
    `<h3>${awayDays ? 'Возвращение' : 'Армия Легиона'}</h3>` +
      `<div class="hint">${lead} Реши судьбу каждого: сделанная задача приносит опыт и золото, перенос стоит дерева, изгнание бесплатно, но без опыта.</div>` +
      (captured.length ? `<div class="hint legion">В руках Легиона: ${captured.join(', ')}. Разберись со всеми демонами базы, чтобы её отбить.</div>` : '') +
      `<div class="legion-bulk">Всех: <span class="group-btn" data-bulk="done">сделано</span> · <span class="group-btn" data-bulk="move">на неделю</span> · <span class="group-btn" data-bulk="banish">изгнать</span> · <span class="group-btn" data-bulk="keep">сбросить</span></div>` +
      `<div class="triage-list">${groups
        .map((g) => `<div class="bases-sphere">${esc(g.p?.name ?? 'Без проекта')}${g.p?.capturedAt ? ' <span class="legion">в руках Легиона</span>' : ''} · ${g.list.length}</div>${g.list.map(row).join('')}`)
        .join('')}</div>` +
      `<div class="legion-sum"></div>` +
      `<div class="actions"><button class="btn" data-a="later">Позже</button><button class="btn" data-a="ok">В бой</button></div>`,
    'wide',
  );

  const rows = [...root.querySelectorAll<HTMLElement>('.legion-row')];
  const sum = root.querySelector('.legion-sum') as HTMLElement;
  const ok = root.querySelector('[data-a="ok"]') as HTMLButtonElement;
  const actOf = (r: HTMLElement) => (r.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? 'keep') as Act;
  const update = () => {
    const n = { keep: 0, done: 0, move: 0, banish: 0 };
    let lumber = 0;
    for (const r of rows) {
      const act = actOf(r);
      n[act]++;
      if (act === 'move') lumber += Number(r.dataset.cost);
      r.querySelector<HTMLInputElement>('[data-f="due"]')!.disabled = act !== 'move';
      r.dataset.act = act;
    }
    const parts = [n.done ? `сделано ${n.done}` : '', n.move ? `перенос ${n.move}, −${lumber} дерева` : '', n.banish ? `изгнать ${n.banish}` : '', n.keep ? `остаются ${n.keep}` : ''].filter(Boolean);
    const debt = lumber > Math.floor(s.resources.lumber) ? ' <span class="legion">Дерева не хватает: недостающее уйдёт в долг.</span>' : '';
    sum.innerHTML = parts.join(' · ') + debt;
    ok.disabled = n.keep === rows.length;
  };
  root.querySelector('.triage-list')!.addEventListener('change', update);
  root.querySelectorAll<HTMLElement>('[data-bulk]').forEach((b) =>
    b.addEventListener('click', () => {
      for (const r of rows) {
        const want = b.dataset.bulk === 'done' && r.querySelector<HTMLInputElement>('input[value="done"]')!.disabled ? 'keep' : b.dataset.bulk;
        r.querySelector<HTMLInputElement>(`input[value="${want}"]`)!.checked = true;
      }
      update();
    }),
  );
  update();

  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  ok.addEventListener('click', () => {
    const items = rows
      .map((r) => ({ id: r.dataset.id!, act: actOf(r), due: r.querySelector<HTMLInputElement>('[data-f="due"]')!.value || undefined }))
      .filter((it): it is { id: string; act: Exclude<Act, 'keep'>; due: string | undefined } => it.act !== 'keep');
    close();
    store.repelLegion(items);
  });
}
