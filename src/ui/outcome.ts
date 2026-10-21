// Итог битвы во весь экран, как в конце миссии WC3: пала вражеская крепость — «Победа!»
// с героем людей (ui/score-victory.png), Легион захватил базу — «Поражение» со сломанным
// оружием (ui/score-defeat.png). Музыку победы и поражения играют звуки события
// (audio/sound.ts, cue 'fortress' и 'defeat'). Щелчок в любом месте закрывает экран.

import { artUrl } from '../assets/loader';
import type { Store } from '../state/store';

/** Экран показывается только про свежие события: открытая через неделю игра старое не празднует. */
const FRESH_MS = 10 * 60_000;

export function watchOutcomes(store: Store) {
  const seen = new Set<string>();
  const queue: { kind: 'victory' | 'defeat'; name: string }[] = [];
  let open = false;

  const next = () => {
    const item = queue.shift();
    if (!item) return;
    open = true;
    void show(item.kind, item.name).then(() => {
      open = false;
      next();
    });
  };

  const check = () => {
    const now = Date.now();
    for (const p of store.state.projects) {
      for (const [kind, at] of [['victory', p.wonAt], ['defeat', p.capturedAt]] as const) {
        const key = `${kind}:${p.id}:${at ?? ''}`;
        if (!at || seen.has(key)) continue;
        seen.add(key);
        if (now - at < FRESH_MS) queue.push({ kind, name: p.name });
      }
    }
    if (!open) next();
  };
  store.subscribe(check);
  check();
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function show(kind: 'victory' | 'defeat', name: string): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'outcome';
    el.className = kind;
    el.innerHTML =
      `<div class="outcome-art"></div>` +
      `<div class="outcome-title">${kind === 'victory' ? 'Победа!' : 'Поражение'}</div>` +
      `<div class="outcome-text">${
        kind === 'victory'
          ? `Вражеская крепость проекта «${esc(name)}» пала. Миссия выиграна.`
          : `Пылающий Легион захватил базу «${esc(name)}». Разберись с её демонами, чтобы отбить её.`
      }</div>` +
      `<div class="outcome-hint">Щёлкни, чтобы продолжить</div>`;
    document.body.appendChild(el);
    void artUrl(kind === 'victory' ? 'ui/score-victory.png' : 'ui/score-defeat.png').then((url) => {
      if (url) (el.querySelector('.outcome-art') as HTMLElement).style.backgroundImage = `url(${url})`;
    });
    // Первый щелчок не должен случайно закрыть экран сразу после появления.
    const shownAt = performance.now();
    const close = () => {
      if (performance.now() - shownAt < 600) return;
      el.classList.add('gone');
      window.removeEventListener('keydown', onKey, true);
      setTimeout(() => (el.remove(), resolve()), 400);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    el.addEventListener('click', close);
    window.addEventListener('keydown', onKey, true);
  });
}
