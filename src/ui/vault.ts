// Хранилище тайн: статистика по дням, сферам и проектам (раздел 9 дизайна).
// Сделанные задачи считаются по отметкам времени задач, поэтому видны и дни до
// постройки хранилища; часы работы, золото и урон берутся из истории дней.

import { addDays, demonsAt, gameDay, idleDays, isOpen } from '../state/economy';
import type { Store } from '../state/store';
import { MAIN_HALL_ID, type DayStats, type GameState, type Task } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DAYS = 14;

/** Игровой день отметки времени: до подъёма это ещё вчерашний день. */
function dayOf(state: GameState, ms: number): string {
  const d = new Date(ms);
  const [wh, wm] = state.settings.wakeUp.split(':').map(Number);
  if (d.getHours() * 60 + d.getMinutes() < wh * 60 + wm) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const hours = (ms: number) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1).replace('.0', '').replace('.', ',')} ч` : `${Math.round(ms / 60_000)} мин`);

function byDays(state: GameState): string {
  const today = gameDay(state);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i - DAYS + 1));
  const history = new Map<string, DayStats>((state.statsHistory ?? []).map((h) => [h.day, h]));
  if (state.stats) history.set(state.stats.day, state.stats);
  const done = new Map<string, Task[]>();
  for (const t of state.tasks) {
    if (t.status !== 'done' || !t.doneAt) continue;
    const d = dayOf(state, t.doneAt);
    done.set(d, [...(done.get(d) ?? []), t]);
  }
  const rows = days.map((d) => {
    const ts = done.get(d) ?? [];
    const st = history.get(d);
    const [y, m, dd] = d.split('-').map(Number);
    const wd = WEEKDAYS[new Date(y, m - 1, dd).getDay()];
    const mm = String(m).padStart(2, '0');
    return { d, wd, dd, mm, label: `${wd} ${dd}.${mm}`, done: ts.length, xp: ts.reduce((n, t) => n + (t.level ?? 0), 0), st };
  });
  const max = Math.max(1, ...rows.map((r) => r.done));
  const total = rows.reduce((n, r) => n + r.done, 0);
  const worked = rows.reduce((n, r) => n + (r.st?.workedMs ?? 0), 0);
  const best = rows.reduce((a, b) => (b.done > a.done ? b : a), rows[0]);
  return (
    `<div class="vault-sum">За ${DAYS} дней: задач <b>${total}</b>, в среднем <b>${(total / DAYS).toFixed(1).replace('.', ',')}</b> в день` +
    (worked ? `, под таймером <b>${hours(worked)}</b>` : '') +
    (best.done ? `. Лучший день: <b>${best.label}</b>, ${best.done}` : '') +
    `</div>` +
    `<div class="vault-days">${rows
      .map(
        (r) =>
          `<div class="vault-day${r.d === today ? ' today' : ''}" title="${r.label}: задач ${r.done}, сумма уровней ${r.xp}${r.st ? `, таймер ${hours(r.st.workedMs)}, золото ${Math.round(r.st.gold)}, урон ${r.st.damage}, демонов ${r.st.demons}` : ''}">` +
          `<span class="vault-n">${r.done || ''}</span><span class="vault-col" style="height:${Math.round((r.done / max) * 100)}%"></span><span class="vault-l">${r.wd}<br>${r.dd}<span class="vault-m">.${r.mm}</span></span></div>`,
      )
      .join('')}</div>` +
    `<div class="hint">Высота столбца: сделанные задачи. Наведи на день, чтобы увидеть таймер, золото и урон.</div>`
  );
}

function bySpheres(state: GameState): string {
  const since = Date.now() - 30 * 86_400_000;
  const rows = state.spheres.map((sp) => {
    const ids = new Set(state.projects.filter((p) => p.sphereId === sp.id).map((p) => p.id));
    const tasks = state.tasks.filter((t) => t.projectId && ids.has(t.projectId));
    const done = tasks.filter((t) => t.status === 'done');
    const month = done.filter((t) => (t.doneAt ?? 0) >= since).length;
    const open = tasks.filter(isOpen).length;
    const demons = [...ids].reduce((n, id) => n + demonsAt(state, id).length, 0);
    const won = state.projects.filter((p) => ids.has(p.id) && p.wonAt).length + (state.hallOfFame ?? []).filter((g) => g.sphereId === sp.id).length;
    return { sp, done: done.length, month, open, demons, won, bases: ids.size };
  });
  const max = Math.max(1, ...rows.map((r) => r.month));
  return (
    `<table class="vault-table"><tr><th>Земля</th><th>Оценка</th><th>За 30 дней</th><th>Всего</th><th>Открыто</th><th>Демоны</th><th>Крепостей</th></tr>` +
    rows
      .sort((a, b) => b.month - a.month)
      .map(
        (r) =>
          `<tr><td>${esc(r.sp.name)}${r.bases ? '' : ' <span class="muted">без баз</span>'}</td><td>${r.sp.score} → ${r.sp.target}</td>` +
          `<td><span class="vault-bar" style="width:${Math.round((r.month / max) * 60)}px"></span> ${r.month}</td><td>${r.done}</td><td>${r.open}</td>` +
          `<td>${r.demons ? `<span class="legion">☠ ${r.demons}</span>` : '—'}</td><td>${r.won || '—'}</td></tr>`,
      )
      .join('') +
    `</table>`
  );
}

function byProjects(state: GameState): string {
  const rows = state.projects
    .filter((p) => p.id !== MAIN_HALL_ID)
    .map((p) => {
      const tasks = state.tasks.filter((t) => t.projectId === p.id);
      const spent = tasks.reduce((n, t) => n + t.spentMs, 0);
      return {
        p,
        done: tasks.filter((t) => t.status === 'done').length,
        open: tasks.filter(isOpen).length,
        spent,
        idle: idleDays(state, p),
        pct: p.fortressMaxHp ? Math.round(((p.fortressMaxHp - p.fortressHp) / p.fortressMaxHp) * 100) : 0,
      };
    })
    .sort((a, b) => Number(a.p.frozen) - Number(b.p.frozen) || b.pct - a.pct);
  return (
    `<table class="vault-table"><tr><th>Проект</th><th>Крепость</th><th>Сделано</th><th>Открыто</th><th>Таймер</th><th>Тишина</th></tr>` +
    rows
      .map(
        (r) =>
          `<tr${r.p.frozen ? ' class="frozen"' : ''}><td>${r.p.frozen ? '❄ ' : ''}${esc(r.p.name)}</td>` +
          `<td><span class="vault-bar hp" style="width:${Math.round(r.pct * 0.6)}px"></span> ${r.p.fortressHp === 0 ? '🏆' : `${r.pct}%`}</td>` +
          `<td>${r.done}</td><td>${r.open}</td><td>${r.spent ? hours(r.spent) : '—'}</td><td>${r.idle >= 1 ? `${r.idle} дн.` : 'сегодня'}</td></tr>`,
      )
      .join('') +
    `</table>`
  );
}

const TABS = [
  { id: 'days', name: 'По дням', render: byDays },
  { id: 'spheres', name: 'По землям', render: bySpheres },
  { id: 'projects', name: 'По проектам', render: byProjects },
];

export function openVault(store: Store) {
  const s = store.state;
  const { root, close } = openModal(
    `<h3>Хранилище тайн</h3>` +
      `<div class="vault-tabs">${TABS.map((t, i) => `<button class="btn${i ? '' : ' on'}" data-tab="${t.id}">${t.name}</button>`).join('')}</div>` +
      `<div class="vault-body">${TABS[0].render(s)}</div>` +
      `<div class="actions"><button class="btn" data-a="close">Закрыть</button></div>`,
    'wide',
  );
  const body = root.querySelector('.vault-body') as HTMLElement;
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      body.innerHTML = TABS.find((t) => t.id === b.dataset.tab)!.render(store.state);
    }),
  );
  root.querySelector('[data-a="close"]')!.addEventListener('click', close);
}
