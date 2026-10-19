// Окна настроек (как опции лобби WC3) и ввода пароля при запуске.

import { checkAssetPassword, encryptedAssetsAvailable } from '../assets/loader';
import { forgetToken, getGistId, getPassword, hasStoredToken, loadToken, saveToken, setGistId, setPassword } from '../assets/vault';
import { createInitialState } from '../state/seed';
import type { Store } from '../state/store';
import type { Sync } from '../storage/sync';
import { openModal } from './modal';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function openSettings(store: Store, sync: Sync) {
  const st = store.state.settings;
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const connected = sync.status !== 'local';
  const { root, close } = openModal(`
    <h3>Настройки</h3>
    <div class="grid2">
      <div><label>Начало рабочего дня</label><input type="time" name="dayStart" value="${st.dayStart}"></div>
      <div><label>Конец рабочего дня</label><input type="time" name="dayEnd" value="${st.dayEnd}"></div>
      <div><label>Подъём</label><input type="time" name="wakeUp" value="${st.wakeUp}"></div>
      <div><label>Отбой</label><input type="time" name="bedtime" value="${st.bedtime}"></div>
    </div>
    <label>Рабочие дни</label>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${days
      .map((d, i) => `<label style="margin:0;color:var(--text)"><input type="checkbox" name="day" value="${i + 1}" style="width:auto"${st.workDays.includes(i + 1) ? ' checked' : ''}> ${d}</label>`)
      .join('')}</div>

    <h3 style="margin-top:18px">Сохранение в Gist</h3>
    <div class="hint">${connected ? `Подключено. Gist: ${esc(getGistId() ?? 'создаётся')}` : 'Сейчас игра хранится только в этом браузере.'}</div>
    <label>Токен GitHub (право gist)</label>
    <input type="password" name="token" placeholder="${connected ? 'Оставь пустым, чтобы не менять' : 'github_pat_…'}">
    <label>Id гиста</label>
    <input name="gistId" value="${esc(getGistId() ?? '')}" placeholder="Пусто: создать новый секретный гист">
    <label>Пароль</label>
    <input type="password" name="password" placeholder="Шифрует токен и открывает ассеты WC3">
    <div class="hint">Пароль нигде не сохраняется. Его нужно будет вводить при каждом запуске.</div>
    <div class="err"></div>
    <div class="actions">
      <button class="btn" data-a="reset" style="margin-right:auto">Новая игра</button>
      ${connected ? '<button class="btn" data-a="disconnect">Отключить Gist</button>' : ''}
      <button class="btn" data-a="cancel">Закрыть</button>
      <button class="btn" data-a="save">Сохранить</button>
    </div>`);

  const val = (n: string) => (root.querySelector(`[name="${n}"]`) as HTMLInputElement).value.trim();
  const err = root.querySelector('.err') as HTMLElement;

  root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
  root.querySelector('[data-a="disconnect"]')?.addEventListener('click', () => {
    forgetToken();
    sync.disconnect();
    close();
  });
  root.querySelector('[data-a="reset"]')!.addEventListener('click', () => {
    if (!confirm('Начать новую игру? Весь прогресс в этом браузере будет стёрт.')) return;
    const fresh = createInitialState();
    fresh.rev = store.state.rev; // чтобы Gist принял новую игру как следующую ревизию
    store.replace(fresh);
    close();
  });
  root.querySelector('[data-a="save"]')!.addEventListener('click', async () => {
    st.dayStart = val('dayStart') || st.dayStart;
    st.dayEnd = val('dayEnd') || st.dayEnd;
    st.wakeUp = val('wakeUp') || st.wakeUp;
    st.bedtime = val('bedtime') || st.bedtime;
    st.workDays = [...root.querySelectorAll<HTMLInputElement>('input[name="day"]:checked')].map((i) => Number(i.value));
    store.replace(store.state);

    const token = val('token');
    const password = val('password') || getPassword() || '';
    if (token) {
      if (!password) {
        err.textContent = 'Придумай пароль: им шифруется токен.';
        return;
      }
      err.textContent = 'Подключаюсь…';
      try {
        setPassword(password);
        await saveToken(token, password);
        const id = await sync.connect(token, val('gistId') || null);
        setGistId(id);
      } catch (e) {
        err.textContent = (e as Error).message;
        return;
      }
    }
    close();
  });
}

/**
 * При запуске: если сохранён токен или на сайте есть зашифрованные ассеты, спрашиваем пароль.
 * Возвращается, когда игра готова (с паролем или без).
 */
export async function unlockOnStart(sync: Sync): Promise<void> {
  const needToken = hasStoredToken();
  const needAssets = await encryptedAssetsAvailable();
  if (!needToken && !needAssets) return;

  await new Promise<void>((resolve) => {
    const { root, close } = openModal(`
      <h3>Taskcraft</h3>
      <div>Введи пароль, чтобы открыть ${needToken ? 'сохранение из Gist' : ''}${needToken && needAssets ? ' и ' : ''}${needAssets ? 'графику WC3' : ''}.</div>
      <form><label>Пароль</label><input type="password" name="password" autofocus>
      <div class="err"></div>
      <div class="actions">
        <button type="button" class="btn" data-a="skip">Без пароля</button>
        <button class="btn">Войти</button>
      </div></form>`);
    const form = root.querySelector('form')!;
    const err = root.querySelector('.err') as HTMLElement;
    (form.querySelector('input') as HTMLInputElement).focus();
    root.querySelector('[data-a="skip"]')!.addEventListener('click', () => {
      close();
      resolve();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = (form.elements.namedItem('password') as HTMLInputElement).value;
      err.textContent = 'Проверяю…';
      try {
        if (needAssets && !(await checkAssetPassword(pass))) throw new Error('Неверный пароль.');
        const token = needToken ? await loadToken(pass).catch(() => {
          throw new Error('Неверный пароль.');
        }) : null;
        setPassword(pass);
        if (token) await sync.connect(token, getGistId()).then(setGistId);
        close();
        resolve();
      } catch (ex) {
        err.textContent = (ex as Error).message;
      }
    });
  });
}
