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
  entries.forEach(([name], i) => {
    if (urls[i]) root.setProperty(`--art-${name}`, `url("${urls[i]}")`);
  });
  layout();
  window.addEventListener('resize', layout);
  document.body.classList.add('wc3');
  return true;
}
