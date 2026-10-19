// Простое модальное окно в стиле игрового диалога.

export function openModal(html: string): { root: HTMLElement; close: () => void } {
  const host = document.getElementById('modal-root')!;
  host.innerHTML = `<div class="modal">${html}</div>`;
  const root = host.firstElementChild as HTMLElement;
  const close = () => {
    host.innerHTML = '';
  };
  return { root, close };
}

export function ask(title: string, text: string, buttons: { label: string; value: string }[]): Promise<string> {
  return new Promise((resolve) => {
    const { root, close } = openModal(
      `<h3>${title}</h3><div>${text}</div><div class="actions">${buttons
        .map((b, i) => `<button class="btn" data-i="${i}">${b.label}</button>`)
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
