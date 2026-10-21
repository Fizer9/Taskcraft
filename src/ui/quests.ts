// Журнал заданий (F9), как в WC3: основные задания (глава кампании, Хиджал, цели недели)
// и дополнительные (повелитель ужаса, план и лягушка дня). У каждого отметка: в работе,
// выполнено или провалено, на фоне заданий людей.

import { activeDreadlord, gameDay, gameMonth, weekStart } from '../state/economy';
import type { Store } from '../state/store';
import { openModal } from './modal';
import { openWeek } from './day';

type QuestState = 'normal' | 'done' | 'failed';
interface Quest {
  title: string;
  text: string;
  state: QuestState;
  action?: () => void;
}

const STATE_NAMES: Record<QuestState, string> = { normal: '', done: 'Выполнено', failed: 'Провалено' };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function quests(store: Store): { main: Quest[]; extra: Quest[] } {
  const s = store.state;
  const main: Quest[] = [];
  const extra: Quest[] = [];

  const lands = s.spheres.filter((x) => x.target > 0);
  const reached = lands.filter((x) => x.score >= x.target);
  main.push({
    title: `Глава ${s.chapter ?? 1}: все земли под контролем`,
    text: lands.length ? lands.map((x) => `${x.score >= x.target ? '✓' : '·'} ${x.name}: ${x.score} из ${x.target}`).join('\n') : 'Задай цели землям на совете.',
    state: lands.length && reached.length === lands.length ? 'done' : 'normal',
  });
  if (s.hyjal)
    main.push({
      title: 'Битва у горы Хиджал',
      text: s.hyjal.hp > 0 ? `Архимонд у главной ратуши: ${s.hyjal.hp} из ${s.hyjal.maxHp}. Бей любыми задачами.` : 'Архимонд повержен.',
      state: s.hyjal.hp > 0 ? 'normal' : 'done',
    });
  const week = s.week?.start === weekStart(s) ? s.week : null;
  for (const g of week?.goals ?? [])
    main.push({ title: g.text, text: 'Цель главы недели. Щёлкни, чтобы открыть главу.', state: g.done ? 'done' : 'normal', action: () => openWeek(store) });
  const last = s.weekHistory?.at(-1);
  if (last && last.total && last.done < last.total)
    main.push({ title: 'Прошлая глава недели', text: `Выполнено ${last.done} из ${last.total} целей.`, state: 'failed' });

  const d = s.dreadlord;
  if (d) {
    const sphere = s.spheres.find((x) => x.id === d.sphereId)?.name ?? '';
    const live = activeDreadlord(s);
    const escaped = !live && d.hp > 0 && d.month < gameMonth(s);
    extra.push({
      title: `Повелитель ужаса ${d.name}`,
      text: live ? `В земле «${sphere}»: ${d.hp} из ${d.maxHp}. Уйдёт в конце месяца.` : escaped ? `Ушёл из земли «${sphere}» непобеждённым.` : `Повержен в земле «${sphere}».`,
      state: live ? 'normal' : escaped ? 'failed' : 'done',
    });
  }
  const day = gameDay(s);
  const plan = s.dayPlan?.day === day ? s.dayPlan.taskIds : [];
  if (plan.length) {
    const done = plan.filter((id) => store.task(id)?.status === 'done').length;
    extra.push({ title: 'План на день', text: `Сделано ${done} из ${plan.length}.`, state: done === plan.length ? 'done' : 'normal' });
  }
  const frog = s.hero.frog?.day === day ? store.task(s.hero.frog.taskId) : undefined;
  if (frog && frog.status !== 'done' && frog.status !== 'cancelled')
    extra.push({ title: 'Лягушка дня', text: `«${frog.title}»: сделай её первой из серьёзных задач.`, state: 'normal' });
  return { main, extra };
}

export function openQuests(store: Store) {
  const { main, extra } = quests(store);
  const all = [...main, ...extra];
  const row = (q: Quest, i: number) =>
    `<div class="quest ${q.state}${q.action ? ' link' : ''}" data-i="${i}">` +
    `<i class="quest-icon"></i><div><b>${esc(q.title)}</b>${q.state !== 'normal' ? ` <em>${STATE_NAMES[q.state]}</em>` : ''}` +
    `<div class="muted">${esc(q.text).replace(/\n/g, '<br>')}</div></div></div>`;
  const { root, close } = openModal(
    `<h3>Задания</h3>` +
      `<div class="group-title">Основные задания</div>${main.map((q) => row(q, all.indexOf(q))).join('')}` +
      (extra.length ? `<div class="group-title">Дополнительные задания</div>${extra.map((q) => row(q, all.indexOf(q))).join('')}` : '') +
      `<div class="actions"><button class="btn" data-a="close">Закрыть (F9)</button></div>`,
    'wide quests',
  );
  root.querySelector('[data-a="close"]')!.addEventListener('click', close);
  root.querySelectorAll<HTMLElement>('.quest.link').forEach((el) =>
    el.addEventListener('click', () => {
      close();
      all[Number(el.dataset.i)].action?.();
    }),
  );
}
