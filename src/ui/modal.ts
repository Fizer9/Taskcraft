// Модальное окно в стиле меню WC3: каменная панель выезжает со звуком и так же уезжает.
// Esc закрывает окно так, как его закрыла бы кнопка «Отмена», «Закрыть» или «Позже».

import { sounds } from '../audio/sound';

/** Кнопки, которые нажимает Esc, по порядку предпочтения. */
const ESCAPE_BUTTONS = ['cancel', 'close', 'later', 'skip'].map((a) => `[data-a="${a}"]`).join(',');
/** Сколько длится анимация закрытия (style.css, .modal.closing). */
const CLOSE_MS = 160;

let current: { root: HTMLElement; close: () => void } | null = null;
let escBound = false;

function host(): HTMLElement {
  return document.getElementById('modal-root')!;
}

/** Окно, которое открыто и не закрывается прямо сейчас. */
function openRoot(): HTMLElement | null {
  const root = host().firstElementChild as HTMLElement | null;
  return root && !root.classList.contains('closing') ? root : null;
}

function bindEscape() {
  if (escBound) return;
  escBound = true;
  // В фазе захвата: раньше клавиш игры и обработчиков полей ввода внутри окна.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || document.body.classList.contains('locked')) return;
      const root = openRoot();
      if (!root) return;
      e.preventDefault();
      e.stopPropagation();
      const button = [...root.querySelectorAll<HTMLButtonElement>(ESCAPE_BUTTONS)].find((b) => !b.disabled);
      if (button) button.click();
      else if (current?.root === root) current.close();
    },
    true,
  );
}

export function openModal(html: string, cls = ''): { root: HTMLElement; close: () => void } {
  bindEscape();
  const el = host();
  // Окно сменяет другое (из меню открыли журнал заданий): панель не уезжает и не звучит заново.
  const fresh = !el.firstElementChild;
  el.innerHTML = `<div class="modal ${cls}${fresh ? ' opening' : ''}">${html}</div>`;
  el.classList.remove('closing');
  const root = el.firstElementChild as HTMLElement;
  if (fresh) void sounds.play('menuopen');
  const close = () => {
    if (el.firstElementChild !== root || root.classList.contains('closing')) return;
    root.classList.add('closing');
    el.classList.add('closing');
    window.setTimeout(() => {
      // За это время могло открыться следующее окно: тогда его не трогаем.
      if (el.firstElementChild !== root) return;
      el.innerHTML = '';
      el.classList.remove('closing');
      void sounds.play('menuclose');
    }, CLOSE_MS);
  };
  current = { root, close };
  return current;
}

/** Закрыть открытое окно, как кнопкой (F9 закрывает журнал заданий). */
export function closeModal() {
  if (current && openRoot() === current.root) current.close();
}

/** Вопрос с кнопками. Esc выбирает «нет» или «отмену», а если их нет, последнюю кнопку. */
export function ask(title: string, text: string, buttons: { label: string; value: string }[]): Promise<string> {
  const no = buttons.findIndex((b) => b.value === 'no' || b.value === 'cancel');
  const escape = no >= 0 ? no : buttons.length - 1;
  return new Promise((resolve) => {
    const { root, close } = openModal(
      `<h3>${title}</h3><div>${text}</div><div class="actions">${buttons
        .map((b, i) => `<button class="btn" data-i="${i}"${i === escape ? ' data-a="cancel"' : ''}>${b.label}</button>`)
        .join('')}</div>`,
    );
    root.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((btn) =>
      btn.addEventListener('click', () => {
        close();
        resolve(buttons[Number(btn.dataset.i)].value);
      }),
    );
  });
}
