// Экранная клавиатура на телефоне. Одни браузеры уменьшают под неё окно, и раскладка сжимается
// сама. Другие (Safari на iPhone, Chrome на Android по умолчанию) уменьшают только видимую часть
// поверх прежнего окна, и низ игры уходит под клавиатуру. Тогда body получает класс kb, а
// перекрытые полосы снизу и сверху пишутся в --kb и --kb-top: стили (style.css) прячут консоль
// и укорачивают свитки и окна, а поле с курсором прокручивается в видимую часть.

const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]), textarea';
/** Насколько должна уменьшиться видимая высота, чтобы считать, что выехала клавиатура. */
const KEYBOARD_MIN = 120;

export function watchKeyboard() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const root = document.documentElement;
  // Самая большая высота при этой ширине: так выглядит экран без клавиатуры.
  // Ширина своя у каждого положения телефона, поэтому поворот ничего не путает.
  const tall = new Map<number, number>();
  let open = false;

  const editing = () => {
    const el = document.activeElement;
    return el instanceof HTMLElement && el.matches(EDITABLE) ? el : null;
  };
  // Класс kb уже стоит, а scrollIntoView сам пересчитает раскладку, так что ждать кадра не нужно.
  const reveal = () => editing()?.scrollIntoView({ block: 'nearest' });

  const update = () => {
    const vv = window.visualViewport;
    const width = window.innerWidth;
    const visible = vv?.height ?? window.innerHeight;
    const full = Math.max(tall.get(width) ?? 0, window.innerHeight, visible);
    tall.set(width, full);
    const now = !!editing() && full - visible > KEYBOARD_MIN;
    const top = vv && now ? Math.max(0, vv.offsetTop) : 0;
    const bottom = vv && now ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--kb', `${Math.round(bottom)}px`);
    root.style.setProperty('--kb-top', `${Math.round(top)}px`);
    document.body.classList.toggle('kb', now);
    if (now && !open) reveal();
    open = now;
  };

  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  // Клавиатура выезжает после фокуса, а уезжает после blur; resize придёт сам,
  // но поле, на которое перешли внутри открытой клавиатуры, тоже надо показать.
  document.addEventListener('focusin', () => {
    update();
    if (open) reveal();
  });
  document.addEventListener('focusout', () => setTimeout(update, 0));
  update();
}
