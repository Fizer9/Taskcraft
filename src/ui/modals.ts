// Окна настроек (как опции лобби WC3) и ввода пароля при запуске.

import { checkAssetPassword, encryptedAssetsAvailable } from '../assets/loader';
import { forgetToken, getGistId, getPassword, hasStoredToken, loadToken, saveToken, setGistId, setPassword } from '../assets/vault';
import { BALANCE, LEGION_MODES, TUNING_STEPS, UNITS } from '../state/config';
import { reward, tuning } from '../state/economy';
import { createInitialState } from '../state/seed';
import { techOf } from '../state/tech';
import type { LegionMode, Tuning } from '../state/types';
import type { Store } from '../state/store';
import type { Sync } from '../storage/sync';
import { openModal } from './modal';
import { sounds } from '../audio/sound';
import { exportSave, importSave } from './backup';
import { NOTIFY_KINDS, notifyPrefs, notifySupported, setNotify, type NotifyKind } from './notify';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const TUNING_KNOBS: { id: keyof Tuning; name: string }[] = [
  { id: 'mining', name: 'Добыча и караваны' },
  { id: 'prices', name: 'Цены' },
  { id: 'xp', name: 'Опыт героя' },
];

/** Что значат множители сейчас: часовая добыча, цена крепости, путь до ультимейта. */
function balanceHint(store: Store): string {
  const s = store.state;
  const keep = techOf(s, 'keep')!;
  const tasks = Math.ceil(BALANCE.heroXpTable[5] / reward(s, UNITS[2].xp, 'xp'));
  return (
    `Сейчас: ${Math.round(BALANCE.goldPerMinute * 60 * tuning(s).mining)} золота в час работы на базе героя, крепость стоит ${keep.gold} золота и ${keep.lumber} дерева, ` +
    `до ультимейта героя (6 уровень) около ${tasks} задач 2 уровня. Если стройка тянется, подними добычу или снизь цены, если всё даётся слишком легко, наоборот. ` +
    'Темп при обычном дне показывает npm run balance.'
  );
}

function notifyHint(permission: NotificationPermission): string {
  return permission === 'denied'
    ? 'Браузер запретил уведомления для этого сайта: разреши их в настройках сайта, и отметки заработают.'
    : 'Приходят, пока игра открыта, даже в фоновой вкладке или свёрнутом приложении, и только когда ты не смотришь на игру. Закрытая игра ничего не пришлёт. Настройка своя у каждого устройства.';
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

    <h3 style="margin-top:18px">Звук</h3>
    <div class="grid2">
      <div><label>Музыка</label><input type="range" name="music" min="0" max="1" step="0.05" value="${sounds.volume.music}"></div>
      <div><label>Эффекты</label><input type="range" name="sfx" min="0" max="1" step="0.05" value="${sounds.volume.sfx}"></div>
    </div>

    <h3 style="margin-top:18px">Баланс</h3>
    <div class="grid3">${TUNING_KNOBS.map(
      (k) =>
        `<div><label>${k.name}</label><select name="tune-${k.id}">${TUNING_STEPS.map(
          (v) => `<option value="${v}"${tuning(store.state)[k.id] === v ? ' selected' : ''}>×${String(v).replace('.', ',')}</option>`,
        ).join('')}</select></div>`,
    ).join('')}</div>
    <div class="hint">${balanceHint(store)}</div>
    <label>Пылающий Легион</label>
    <select name="legion">${(Object.keys(LEGION_MODES) as LegionMode[])
      .map((k) => `<option value="${k}"${(st.legion ?? 'normal') === k ? ' selected' : ''}>${LEGION_MODES[k].name}: ${LEGION_MODES[k].hint}</option>`)
      .join('')}</select>

    <h3 style="margin-top:18px">Уведомления</h3>
    ${
      notifySupported()
        ? NOTIFY_KINDS.map(
            (k) =>
              `<label style="margin:4px 0;color:var(--text)"><input type="checkbox" name="notify" value="${k.id}" style="width:auto"${notifyPrefs()[k.id] && Notification.permission === 'granted' ? ' checked' : ''}> ${k.name}</label>`,
          ).join('') +
          `<div class="hint notify-hint">${notifyHint(Notification.permission)}</div>`
        : '<div class="hint">Этот браузер не умеет показывать уведомления.</div>'
    }

    <h3 style="margin-top:18px">Файл сохранения</h3>
    <div class="hint">Вся игра одним файлом: резервная копия или переезд в другой браузер без Gist. Токен и пароль в файл не попадают.</div>
    <div class="actions" style="justify-content:flex-start;margin-top:8px">
      <button class="btn" data-a="export">Скачать файл</button>
      <button class="btn" data-a="import">Загрузить из файла</button>
      <input type="file" name="import" accept=".json,application/json" hidden>
    </div>
    <div class="err import-err"></div>

    <h3 style="margin-top:18px">Сохранение в Gist</h3>
    <div class="hint">${connected ? `Подключено. Gist: ${esc(getGistId() ?? 'создаётся')}` : 'Сейчас игра хранится только в этом браузере.'}</div>
    <label>Токен GitHub (право gist)</label>
    <input type="password" name="token" placeholder="${connected ? 'Оставь пустым, чтобы не менять' : 'github_pat_…'}">
    <label>Id гиста</label>
    <input name="gistId" value="${esc(getGistId() ?? '')}" placeholder="Пусто: создать новый секретный гист">
    <label>Пароль</label>
    <input type="password" name="password" placeholder="Шифрует токен и открывает ассеты WC3">
    <div class="hint">${rememberedPassword() ? 'Пароль запомнен в этом браузере, вход без ввода. <span class="group-btn" data-a="forget">Забыть</span>' : 'Пароль не сохраняется. Его нужно вводить при запуске, если не поставить «Запомнить» на входе.'}</div>
    <div class="err"></div>
    <div class="actions">
      <button class="btn" data-a="reset" style="margin-right:auto">Новая игра</button>
      <button class="btn" data-action="open-spheres">Сферы жизни</button>
      <button class="btn" data-action="open-bases">Проекты</button>
      <button class="btn" data-action="open-council">Совет земель</button>
      <button class="btn" data-action="open-quests">Задания</button>
      <button class="btn" data-action="open-hall">Зал славы</button>
      <button class="btn" data-action="open-vault">Хранилище тайн</button>
      <button class="btn" data-action="open-tutorial">Как играть</button>
      ${connected ? '<button class="btn" data-a="disconnect">Отключить Gist</button>' : ''}
      <button class="btn" data-a="cancel">Закрыть</button>
      <button class="btn" data-a="save">Сохранить</button>
    </div>`);

  const val = (n: string) => (root.querySelector(`[name="${n}"]`) as HTMLInputElement).value.trim();
  const err = root.querySelector('.err') as HTMLElement;

  for (const n of ['music', 'sfx'] as const) {
    root.querySelector(`[name="${n}"]`)!.addEventListener('input', (e) => sounds.setVolume({ [n]: Number((e.target as HTMLInputElement).value) }));
  }
  root.querySelectorAll<HTMLInputElement>('input[name="notify"]').forEach((box) =>
    box.addEventListener('change', async () => {
      const permission = await setNotify(box.value as NotifyKind, box.checked);
      if (permission !== 'granted') box.checked = false;
      root.querySelector('.notify-hint')!.textContent = notifyHint(permission);
    }),
  );
  root.querySelector('[data-a="export"]')!.addEventListener('click', () => exportSave(store));
  const picker = root.querySelector('input[name="import"]') as HTMLInputElement;
  root.querySelector('[data-a="import"]')!.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    try {
      if (await importSave(store, file)) close();
    } catch (e) {
      root.querySelector('.import-err')!.textContent = (e as Error).message;
    }
  });
  root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
  root.querySelector('[data-a="forget"]')?.addEventListener('click', (e) => {
    forgetPassword();
    (e.target as HTMLElement).parentElement!.textContent = 'Забыл. При следующем запуске игра спросит пароль.';
  });
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
    st.balance = Object.fromEntries(TUNING_KNOBS.map((k) => [k.id, Number(val(`tune-${k.id}`)) || 1]));
    st.legion = (val('legion') || 'normal') as LegionMode;
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
 * Возвращается, когда игра готова. required: без верного пароля дальше не пустить
 * (так работает опубликованный сайт; при разработке можно войти и без пароля).
 */
/** «Запомнить» на входе: пароль лежит открытым текстом в localStorage этого браузера. */
const REMEMBER_KEY = 'taskcraft-remember';

export function rememberedPassword(): string | null {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

export function forgetPassword() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* хранилище недоступно: и так ничего не запомнено */
  }
}

function rememberPassword(pass: string) {
  try {
    localStorage.setItem(REMEMBER_KEY, pass);
  } catch {
    /* приватное окно: просто спросим в следующий раз */
  }
}

export async function unlockOnStart(sync: Sync, required = false): Promise<void> {
  const needToken = hasStoredToken();
  const needAssets = await encryptedAssetsAvailable();
  if (!needToken && !needAssets) return;
  const what = [needToken && 'сохранение из Gist', needAssets && 'графику WC3'].filter(Boolean).join(' и ');

  // Проверяет пароль, открывает токен и подключает Gist. Ошибка значит «не пустили».
  const unlock = async (pass: string) => {
    if (needAssets && !(await checkAssetPassword(pass))) throw new Error('Неверный пароль.');
    const token = needToken
      ? await loadToken(pass).catch(() => {
          throw new Error('Неверный пароль.');
        })
      : null;
    setPassword(pass);
    // Без сети Gist недоступен: игра идёт из локального сохранения, а синхронизация
    // догонит, когда сеть вернётся. Неверный токен или чужой Gist по-прежнему ошибка.
    if (token)
      await sync
        .connect(token, getGistId())
        .then(setGistId)
        .catch((ex) => {
          if (navigator.onLine && !(ex instanceof TypeError)) throw ex;
        });
  };

  // Запомненный пароль пробуем молча. Если его сменили, забываем и спрашиваем как обычно.
  const saved = rememberedPassword();
  if (saved) {
    try {
      await unlock(saved);
      return;
    } catch {
      forgetPassword();
    }
  }

  await new Promise<void>((resolve) => {
    const { root, close } = openModal(`
      <h3>Taskcraft</h3>
      <div>${required ? 'Вход только по паролю.' : `Введи пароль, чтобы открыть ${what}.`}</div>
      <form><label>Пароль</label><input type="password" name="password" autocomplete="current-password" autofocus>
      <label class="check"><input type="checkbox" name="remember" checked> Запомнить на этом устройстве</label>
      <div class="err"></div>
      <div class="actions">
        ${required ? '' : '<button type="button" class="btn" data-a="skip">Без пароля</button>'}
        <button class="btn">Войти</button>
      </div></form>`);
    const form = root.querySelector('form')!;
    const err = root.querySelector('.err') as HTMLElement;
    (form.querySelector('input') as HTMLInputElement).focus();
    root.querySelector('[data-a="skip"]')?.addEventListener('click', () => {
      close();
      resolve();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = (form.elements.namedItem('password') as HTMLInputElement).value;
      err.textContent = 'Проверяю…';
      try {
        await unlock(pass);
        if ((form.elements.namedItem('remember') as HTMLInputElement).checked) rememberPassword(pass);
        close();
        resolve();
      } catch (ex) {
        err.textContent = (ex as Error).message;
      }
    });
  });
}
