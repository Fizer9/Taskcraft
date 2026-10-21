// Итог битвы во весь экран, как в конце миссии WC3: пала вражеская крепость — «Победа!»
// с героем людей (ui/score-victory.png), Легион захватил базу — «Поражение» со сломанным
// оружием (ui/score-defeat.png). Победа приходит, когда врата рухнули на карте (юнит
// последней задачи пал у стен), и спрашивает, что делать с проектом: врата могли пасть
// раньше, чем кончились задачи, тогда проект остаётся и база работает дальше. Марш победы
// играет этот экран (cue 'fortress'), музыку поражения — событие захвата (cue 'defeat').

import { artUrl } from '../assets/loader';
import { sounds } from '../audio/sound';
import type { Store } from '../state/store';

/** Экран показывается только про свежие события: открытая через неделю игра старое не празднует. */
const FRESH_MS = 10 * 60_000;
/** Сколько видно, как рушатся врата, прежде чем выйдет экран победы. */
const GATE_FALL_MS = 2500;

type Outcome = { kind: 'victory' | 'defeat'; id: string; name: string };

/** gateHp: здоровье врат проекта, которое сейчас видно на карте. */
export function watchOutcomes(store: Store, gateHp: (id: string) => number) {
  const seen = new Set<string>();
  const queue: Outcome[] = [];
  let open = false;
  let retry = 0;

  const next = () => {
    const item = queue.shift();
    if (!item) return;
    open = true;
    // Сначала врата рушатся на глазах под марш победы, потом экран.
    if (item.kind === 'victory') sounds.cue('fortress');
    window.setTimeout(
      () =>
        void show(store, item).then(() => {
          open = false;
          next();
        }),
      item.kind === 'victory' ? GATE_FALL_MS : 0,
    );
  };

  const check = () => {
    const now = Date.now();
    let waiting = false;
    for (const p of store.state.projects) {
      for (const [kind, at] of [['victory', p.wonAt], ['defeat', p.capturedAt]] as const) {
        const key = `${kind}:${p.id}:${at ?? ''}`;
        if (!at || seen.has(key)) continue;
        // Врата ещё стоят на карте: юнит последней задачи пока бьётся у стен.
        if (kind === 'victory' && now - at < FRESH_MS && gateHp(p.id) > 0) {
          waiting = true;
          continue;
        }
        seen.add(key);
        if (now - at < FRESH_MS) queue.push({ kind, id: p.id, name: p.name });
      }
    }
    if (!open) next();
    window.clearTimeout(retry);
    if (waiting) retry = window.setTimeout(check, 500);
  };
  store.subscribe(check);
  check();
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function show(store: Store, { kind, id, name }: Outcome): Promise<void> {
  return new Promise((resolve) => {
    const victory = kind === 'victory';
    const el = document.createElement('div');
    el.id = 'outcome';
    el.className = kind;
    el.innerHTML =
      `<div class="outcome-art"></div>` +
      `<div class="outcome-title">${victory ? 'Победа!' : 'Поражение'}</div>` +
      `<div class="outcome-text">${
        victory
          ? `Вражеская крепость проекта «${esc(name)}» пала. Миссия выиграна. Если у проекта ещё есть задачи, оставь его: база будет работать дальше без врат. Или отправь её в зал славы, тогда открытые задачи вернутся во входящие.`
          : `Пылающий Легион захватил базу «${esc(name)}». Разберись с её демонами, чтобы отбить её.`
      }</div>` +
      (victory
        ? `<div class="outcome-actions"><button class="btn" data-a="keep">Оставить проект</button><button class="btn" data-a="enshrine">В зал славы</button></div>`
        : `<div class="outcome-hint">Щёлкни, чтобы продолжить</div>`);
    document.body.appendChild(el);
    void artUrl(victory ? 'ui/score-victory.png' : 'ui/score-defeat.png').then((url) => {
      if (url) (el.querySelector('.outcome-art') as HTMLElement).style.backgroundImage = `url(${url})`;
    });
    // Первый щелчок не должен случайно закрыть экран сразу после появления.
    const shownAt = performance.now();
    const close = () => {
      if (performance.now() - shownAt < 600) return false;
      el.classList.add('gone');
      window.removeEventListener('keydown', onKey, true);
      setTimeout(() => (el.remove(), resolve()), 400);
      return true;
    };
    // Esc у победы значит «оставить проект»: ничего не теряется.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (!victory && (e.key === 'Enter' || e.key === ' '))) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    if (victory) {
      el.querySelector('[data-a="keep"]')!.addEventListener('click', close);
      el.querySelector('[data-a="enshrine"]')!.addEventListener('click', () => {
        if (close()) store.enshrine(id);
      });
    } else el.addEventListener('click', close);
    window.addEventListener('keydown', onKey, true);
  });
}
