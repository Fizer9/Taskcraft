// Базы в игре: какие проекты сейчас ведутся, какие законсервированы. В игре около
// шести баз (раздел 3 дизайна), остальные ждут своей очереди и не тратят сил.

import { BALANCE } from '../state/config';
import { demonsAt, idleDays, isOpen } from '../state/economy';
import type { Store } from '../state/store';
import { MAIN_HALL_ID } from '../state/types';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function openBases(store: Store, onLater: () => void = () => {}) {
  const s = store.state;
  const limit = BALANCE.activeBasesLimit;
  const projects = s.projects.filter((p) => p.id !== MAIN_HALL_ID);

  const groups = s.spheres
    .map((sp) => ({ sp, list: projects.filter((p) => p.sphereId === sp.id) }))
    .filter((g) => g.list.length);
  const rows = groups
    .map(
      ({ sp, list }) =>
        `<div class="bases-sphere">${esc(sp.name)}</div>` +
        list
          .map((p) => {
            const open = s.tasks.filter((t) => t.projectId === p.id && isOpen(t)).length;
            const demons = demonsAt(s, p.id).length;
            const idle = idleDays(s, p);
            const facts = [
              open ? `задач ${open}` : 'задач нет',
              demons ? `<span class="legion">☠ ${demons}</span>` : '',
              !p.frozen && idle >= 3 ? `без движения ${idle} дн.` : '',
            ].filter(Boolean);
            if (p.capturedAt) facts.unshift('<span class="legion">в руках Легиона</span>');
            return (
              `<label class="check bases-row"><input type="checkbox" data-id="${p.id}"${p.frozen ? '' : ' checked'}${p.capturedAt ? ' disabled' : ''}>` +
              ` <b>${esc(p.name)}</b> <span>${facts.join(' · ')}</span></label>`
            );
          })
          .join(''),
    )
    .join('');

  const { root, close } = openModal(
    `<h3>Базы в игре</h3>` +
      `<div class="hint">Отметь до ${limit} проектов, которые ведёшь сейчас. Остальные законсервируются: не добывают, не гниют и не зовут Легион. Вернуть базу в игру можно в любой момент, если есть место.</div>` +
      `<div class="bases-count"></div>` +
      `<div class="bases-list">${rows}</div>` +
      `<div class="actions"><button class="btn" data-a="later">Позже</button><button class="btn" data-a="save">Сохранить</button></div>`,
    'wide',
  );
  const boxes = [...root.querySelectorAll<HTMLInputElement>('.bases-list input')];
  const count = root.querySelector('.bases-count') as HTMLElement;
  const save = root.querySelector('[data-a="save"]') as HTMLButtonElement;
  const update = () => {
    const n = boxes.filter((b) => b.checked).length;
    const over = n - limit;
    count.innerHTML =
      over > 0
        ? `<span class="legion">В игре ${n} из ${limit}: сними отметку ещё с ${over}.</span>`
        : `В игре ${n} из ${limit}.`;
    save.disabled = over > 0;
  };
  boxes.forEach((b) => b.addEventListener('change', update));
  update();
  root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
    close();
    onLater();
  });
  save.addEventListener('click', () => {
    close();
    store.setActiveBases(boxes.filter((b) => b.checked).map((b) => b.dataset.id!));
  });
}
