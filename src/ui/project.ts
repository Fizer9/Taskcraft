// Проект в игре: заложить новую базу, переименовать, сменить сферу и тип базы,
// законсервировать на паузу или удалить.

import { BALANCE } from '../state/config';
import { activeBases, canThaw, isOpen } from '../state/economy';
import type { Store } from '../state/store';
import type { BaseKind } from '../state/types';
import { ask, openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Размер миссии: здоровье вражеской крепости. */
const HP_PRESETS = [
  { hp: 10, name: 'Малая', hint: 'несколько вечеров' },
  { hp: 20, name: 'Средняя', hint: 'пара недель' },
  { hp: 40, name: 'Большая', hint: 'месяц-другой' },
  { hp: 80, name: 'Огромная', hint: 'полгода и больше' },
];

const KINDS: { kind: BaseKind; name: string; hint: string }[] = [
  { kind: 'work', name: 'Рабочая', hint: 'в полную силу днём, вечером и в выходные медленнее' },
  { kind: 'personal', name: 'Личная', hint: 'в полную силу вечером и в выходные, днём вполсилы' },
  { kind: 'any', name: 'В любое время', hint: 'одинаково в любую смену' },
];

/**
 * id null: новый проект. onDone получает id проекта или null, если он удалён; onCancel
 * зовётся, если окно закрыли без изменений (из списка проектов возвращаемся в список).
 */
export function openProject(store: Store, id: string | null, onDone: (id: string | null) => void = () => {}, onCancel: () => void = () => {}) {
  const s = store.state;
  const p = id ? store.project(id) : undefined;
  const open = p ? s.tasks.filter((t) => t.projectId === p.id && isOpen(t)).length : 0;
  const sphereId = p?.sphereId ?? s.spheres[0]?.id;
  const hp = p?.fortressMaxHp ?? BALANCE.fortressHp;
  const active = activeBases(s).length;
  const limit = BALANCE.activeBasesLimit;
  // Подсказка о лимите: заморозка освобождает место, разморозка его занимает.
  const freezeHint = !p
    ? active >= limit
      ? `В игре уже ${active} баз из ${limit}: новая будет законсервирована, пока не освободится место.`
      : ''
    : p.capturedAt
      ? 'База в руках Легиона: её не вернуть в игру, пока у стен есть демоны.'
      : p.frozen
        ? `База законсервирована. ${canThaw(s) ? `Вернуть её в игру: активных станет ${active + 1} из ${limit}.` : `В игре уже ${active} баз из ${limit}: сначала законсервируй другую.`}`
        : `Проект на паузе лучше законсервировать: база перестанет добывать и гнить, Легион не придёт к её задачам. Активных баз ${active} из ${limit}.`;
  const { root, close } = openModal(
    `<h3>${p ? 'Проект' : 'Новый проект'}</h3>` +
      (p ? '' : '<div class="hint">Проект это миссия: база в земле своей сферы и вражеская крепость, которую нужно взять.</div>') +
      `<label>Название</label><input name="name" maxlength="40" value="${esc(p?.name ?? '')}" placeholder="Например: Испанский до B1">` +
      `<label>Сфера жизни</label><select name="sphere">${s.spheres
        .map((sp) => `<option value="${sp.id}"${sp.id === sphereId ? ' selected' : ''}>${esc(sp.name)}</option>`)
        .join('')}</select>` +
      `<label>Крепость врага: сколько урона до победы</label>` +
      `<div class="hp-pick">${HP_PRESETS.map((h) => `<button class="btn${h.hp === hp ? ' on' : ''}" data-hp="${h.hp}" title="${h.hint}">${h.name} · ${h.hp}</button>`).join('')}` +
      `<input type="number" name="hp" min="5" max="500" step="1" value="${hp}"></div>` +
      `<div class="hint">Каждая сделанная задача бьёт по крепости уроном, равным своему уровню. 20 это примерно десять задач 2 уровня.${p && p.fortressMaxHp !== p.fortressHp ? ` Уже нанесено ${p.fortressMaxHp - p.fortressHp} урона, он сохранится.` : ''}</div>` +
      `<label>Тип базы</label><div class="kind-pick">${KINDS.map(
        (k) =>
          `<label class="check"><input type="radio" name="kind" value="${k.kind}"${k.kind === (p?.kind ?? 'personal') ? ' checked' : ''}> <b>${k.name}</b> <span>${k.hint}</span></label>`,
      ).join('')}</div>` +
      (freezeHint ? `<div class="hint freeze-hint">❄ ${freezeHint}</div>` : '') +
      `<div class="err"></div>` +
      `<div class="actions">` +
      (p ? '<button class="btn" data-a="delete">Удалить</button>' : '') +
      (p
        ? `<button class="btn" data-a="freeze" style="margin-right:auto"${p.capturedAt || (p.frozen && !canThaw(s)) ? ' disabled' : ''}>${p.frozen ? 'Расконсервировать' : 'Законсервировать'}</button>`
        : '') +
      `<button class="btn" data-a="cancel">Отмена</button><button class="btn" data-a="ok">${p ? 'Сохранить' : 'Заложить базу'}</button></div>`,
  );
  const name = root.querySelector('[name="name"]') as HTMLInputElement;
  name.focus();
  const hpInput = root.querySelector('[name="hp"]') as HTMLInputElement;
  const markHp = () => root.querySelectorAll<HTMLButtonElement>('[data-hp]').forEach((b) => b.classList.toggle('on', b.dataset.hp === hpInput.value));
  root.querySelectorAll<HTMLButtonElement>('[data-hp]').forEach((b) =>
    b.addEventListener('click', () => {
      hpInput.value = b.dataset.hp!;
      markHp();
    }),
  );
  hpInput.addEventListener('input', markHp);
  const err = root.querySelector('.err') as HTMLElement;
  root.querySelector('[data-a="cancel"]')!.addEventListener('click', () => {
    close();
    onCancel();
  });
  root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
    if (!name.value.trim()) {
      err.textContent = 'Нужно название.';
      return;
    }
    const sphere = (root.querySelector('[name="sphere"]') as HTMLSelectElement).value;
    const kind = (root.querySelector('[name="kind"]:checked') as HTMLInputElement).value as BaseKind;
    close();
    const max = Number(hpInput.value) || BALANCE.fortressHp;
    if (p) {
      store.updateProject(p.id, { name: name.value, sphereId: sphere, kind, hp: max });
      onDone(p.id);
    } else onDone(store.createProject(name.value, sphere, kind, max).id);
  });
  root.querySelector('[data-a="freeze"]')?.addEventListener('click', () => {
    close();
    if (p!.frozen) store.unfreezeProject(p!.id);
    else store.freezeProject(p!.id);
    onDone(p!.id);
  });
  root.querySelector('[data-a="delete"]')?.addEventListener('click', async () => {
    const answer = await ask(
      'Удалить проект?',
      `База «${esc(p!.name)}» исчезнет с карты.` +
        (open ? ` Открытые задачи (${open}) вернутся во входящие.` : '') +
        (p!.frozen ? '' : ' Если проект просто на паузе, лучше законсервировать базу.'),
      [
        { label: 'Отмена', value: 'no' },
        { label: 'Удалить', value: 'yes' },
      ],
    );
    if (answer !== 'yes') return onCancel();
    store.deleteProject(p!.id);
    onDone(null);
  });
}
