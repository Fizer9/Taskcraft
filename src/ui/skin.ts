// Оформление интерфейса оригинальными текстурами WC3: каменная консоль людей, рамки окон,
// иконки ресурсов. Текстуры зашифрованы, как и модели, поэтому без пароля интерфейс остаётся
// нарисованным средствами CSS (style.css), а с текстурами включается класс body.wc3.

import { artUrl } from '../assets/loader';

const ART = {
  console: 'ui/console.png',
  gold: 'ui/gold.png',
  lumber: 'ui/lumber.png',
  supply: 'ui/supply.png',
  'menu-bg': 'ui/menu-bg.png',
  'menu-frame': 'ui/menu-frame.png',
  'tooltip-bg': 'ui/tooltip-bg.png',
  'tooltip-frame': 'ui/tooltip-frame.png',
  'button-bg': 'ui/button-bg.png',
  'button-frame': 'ui/button-frame.png',
  'button-frame-down': 'ui/button-frame-down.png',
  'button-highlight': 'ui/button-highlight.png',
  'editbox-frame': 'ui/editbox-frame.png',
  'cmd-active': 'ui/cmd-active.png',
  timeindicator: 'ui/timeindicator.png',
  cursor: 'ui/cursor.png',
  'cursor-enemy': 'ui/cursor-enemy.png',
  'cursor-own': 'ui/cursor-own.png',
  'ic-attack-melee': 'ui/ic-attack-melee.png',
  'ic-attack-piercing': 'ui/ic-attack-piercing.png',
  'ic-attack-hero': 'ui/ic-attack-hero.png',
  'ic-attack-chaos': 'ui/ic-attack-chaos.png',
  'ic-armor-medium': 'ui/ic-armor-medium.png',
  'ic-armor-large': 'ui/ic-armor-large.png',
  'ic-armor-hero': 'ui/ic-armor-hero.png',
  'ic-armor-fortified': 'ui/ic-armor-fortified.png',
  'ic-str': 'ui/ic-str.png',
  'ic-agi': 'ui/ic-agi.png',
  'ic-int': 'ui/ic-int.png',
  'ic-gold': 'ui/ic-gold.png',
  'ic-supply': 'ui/ic-supply.png',
  'slot-filler': 'ui/slot-filler.png',
  'queue-border': 'ui/queue-border.png',
  'mm-ping': 'ui/mm-ping.png',
  'mm-ally': 'ui/mm-ally.png',
  'mm-formation': 'ui/mm-formation.png',
  'mm-creep': 'ui/mm-creep.png',
  'mm-terrain': 'ui/mm-terrain.png',
  'mm-terrain-off': 'ui/mm-terrain-off.png',
  'progress-border': 'ui/progress-border.png',
  'progress-fill': 'ui/progress-fill.png',
  checkbox: 'ui/checkbox.png',
  'checkbox-check': 'ui/checkbox-check.png',
  'checkbox-down': 'ui/checkbox-down.png',
  'slider-knob': 'ui/slider-knob.png',
  'quest-normal': 'ui/quest-normal.png',
  'quest-done': 'ui/quest-done.png',
  'quest-failed': 'ui/quest-failed.png',
  'quest-icon': 'ui/quest-icon.png',
};

/** Размеры картинки консоли в единицах исходника (высота 1024): вся ширина и центр 4:3. */
const FULL_W = 4316;
const CORE_W = 3200;
/** Видимая часть консоли снизу (от зубцов стены до низа) и доля высоты экрана под неё. */
const CONSOLE_H = 644;
const CONSOLE_SHARE = 0.28;

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Масштаб: центр 4:3 помещается по ширине, а консоль занимает не больше ~28% высоты, как в игре.
  const s = Math.min(w / CORE_W, (h * CONSOLE_SHARE) / CONSOLE_H);
  const root = document.documentElement.style;
  root.setProperty('--s', s.toFixed(5));
  root.setProperty('--x0', `${((w - FULL_W * s) / 2).toFixed(1)}px`);
}

/** Подгружает текстуры интерфейса; true, если консоль WC3 включена. */
export async function applySkin(): Promise<boolean> {
  const entries = Object.entries(ART);
  const urls = await Promise.all(entries.map(([, path]) => artUrl(path)));
  if (!urls[0]) return false;
  const root = document.documentElement.style;
  // Класс art-<имя> на body: CSS включает оформление, только если эта текстура есть.
  entries.forEach(([name], i) => {
    if (urls[i]) root.setProperty(`--art-${name}`, `url("${urls[i]}")`);
    document.body.classList.toggle(`art-${name}`, !!urls[i]);
  });
  layout();
  window.addEventListener('resize', layout);
  document.body.classList.add('wc3');
  return true;
}
