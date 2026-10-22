// Сохранение: всегда в localStorage (быстро, работает офлайн) и, если настроен токен,
// в секретный Gist, чтобы ПК и телефон видели одну и ту же игру.
//
// Два устройства меняют игру независимо, поэтому каждое помнит base: версию, с которой
// оно последний раз совпадало с Gist. Если с тех пор Gist обновило другое устройство,
// а здесь тоже что-то сделали, версии сливаются (merge.ts), а не затирают друг друга.
// Если здесь ничего не делали, просто берётся версия из Gist. В Gist пишется только
// когда здесь были действия игрока: тики добычи сами по себе Gist не трогают.

import type { Store } from '../state/store';
import type { GameState } from '../state/types';
import { GistStorage } from './gist';
import { gameIdOf, mergeGames } from './merge';

const LOCAL_KEY = 'taskcraft.state';
/** Версия из Gist, с которой это устройство совпадало последний раз, и id этого Gist. */
const BASE_KEY = 'taskcraft.base';
/** Игру заменили здесь (файл, новая игра): при следующем сохранении она идёт в Gist как есть. */
const FORCE_KEY = 'taskcraft.force';
/** Прежняя игра перед заменой: из неё можно восстановиться, если новая оказалась не та. */
const BACKUP_KEY = 'taskcraft.backup';

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';
/** В Gist другая игра: взять её, записать туда эту или ничего не делать. */
export type ForeignChoice = 'remote' | 'local' | 'cancel';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* переполнение или приватный режим */
  }
}

export function loadLocal(): GameState | null {
  try {
    const raw = read(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

function saveLocal(state: GameState) {
  write(LOCAL_KEY, JSON.stringify(state));
}

/** Запомнить игру перед заменой (загрузка файла, новая игра, игра из Gist). */
export function saveBackup(state: GameState) {
  write(BACKUP_KEY, JSON.stringify(state));
}

export function loadBackup(): GameState | null {
  try {
    const raw = read(BACKUP_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** fetch без сети бросает TypeError с английским текстом: показываем по-русски. */
const errorText = (e: unknown) => (e instanceof TypeError ? 'Нет связи с GitHub.' : (e as Error).message);

export class Sync {
  status: SyncStatus = 'local';
  error = '';
  /** Что делать, если в Gist другая игра. Интерфейс подменяет окном с тремя кнопками. */
  chooseForeign: (remote: GameState) => Promise<ForeignChoice> = async () =>
    confirm('В Gist лежит другая игра. Загрузить её вместо игры в этом браузере?') ? 'remote' : 'cancel';
  private gist: GistStorage | null = null;
  private base: GameState | null = null;
  private baseGist: string | null = null;
  /** Были действия игрока с прошлой синхронизации. */
  private dirty = false;
  /** Игру заменили здесь: в Gist она пойдёт как есть, без слияния. */
  private forced = read(FORCE_KEY) === '1';
  /** Какой объект игры сейчас в Store: по смене объекта видно, что игру заменили. */
  private known: GameState;
  private installing = false;
  private paused = false;
  private gistTimer: number | undefined;
  private localTimer: number | undefined;
  private saving = false;
  private pending = false;
  private listeners = new Set<() => void>();

  constructor(private store: Store) {
    this.known = store.state;
    try {
      const saved = JSON.parse(read(BASE_KEY) ?? 'null') as { gistId: string; state: GameState } | null;
      if (saved?.state) {
        this.base = saved.state;
        this.baseGist = saved.gistId;
      }
    } catch {
      /* без base первая синхронизация просто объединит обе версии */
    }
    store.subscribe((state, changed) => {
      if (this.paused) return;
      if (state !== this.known && !this.installing) this.markReplaced();
      this.known = state;
      if (this.localTimer === undefined) {
        this.localTimer = window.setTimeout(() => {
          this.localTimer = undefined;
          if (!this.paused) saveLocal(this.store.state);
        }, changed ? 300 : 5000);
      }
      if (changed && !this.installing) {
        this.dirty = true;
        this.scheduleGist(3000);
      }
    });
    // Раз в 5 минут смотрим, не сохранило ли что-то другое устройство.
    window.setInterval(() => this.scheduleGist(0), 5 * 60_000);
    // Сеть вернулась: догоняем Gist тем, что накопилось без неё.
    window.addEventListener('online', () => this.scheduleGist(0));
    window.addEventListener('offline', () => this.gist && this.set('error', 'Нет сети'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && !this.paused) {
        saveLocal(this.store.state);
        if (this.dirty || this.forced) this.scheduleGist(0);
      }
    });
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private set(status: SyncStatus, error = '') {
    // Новую ошибку показываем сообщением: во всплывающей подсказке её легко не заметить.
    if (status === 'error' && error && error !== this.error) this.store.say(`Gist: ${error.replace(/\.?$/, '.')} Игра сохраняется в этом браузере.`, 'warn');
    this.status = status;
    this.error = error;
    for (const l of this.listeners) l();
  }

  /** Показать ошибку синхронизации, не подключаясь (например, токен не открылся паролем). */
  report(message: string) {
    this.set('error', message);
  }

  private markReplaced() {
    this.forced = true;
    write(FORCE_KEY, '1');
  }

  /** Игра открыта в другой вкладке: эта больше ничего не сохраняет. */
  pause() {
    if (this.paused) return;
    saveLocal(this.store.state);
    this.paused = true;
    window.clearTimeout(this.gistTimer);
  }

  /**
   * Подключает Gist: если в нём та же игра, версии сливаются; если другая, игрок
   * выбирает, какую оставить. Ошибка подключения пробрасывается (окно настроек её покажет).
   */
  async connect(token: string, gistId: string | null): Promise<string> {
    this.gist = new GistStorage(token, gistId);
    if (gistId !== this.baseGist) {
      this.base = null;
      this.baseGist = gistId;
    }
    try {
      await this.sync();
    } catch (e) {
      this.set('error', errorText(e));
      throw e;
    }
    return this.gist.gistId!;
  }

  disconnect() {
    this.gist = null;
    this.set('local');
  }

  private scheduleGist(delay: number) {
    if (!this.gist || this.paused) return;
    window.clearTimeout(this.gistTimer);
    this.gistTimer = window.setTimeout(() => void this.flush(), delay);
  }

  async flush() {
    try {
      await this.sync();
    } catch (e) {
      this.set('error', errorText(e));
    }
  }

  /** Поставить в Store версию, пришедшую из Gist или слияния, не считая это действием игрока. */
  private install(next: GameState) {
    this.installing = true;
    try {
      this.store.replace(next);
    } finally {
      this.installing = false;
      this.known = this.store.state;
    }
  }

  private async sync() {
    if (!this.gist || this.paused) return;
    if (this.saving) {
      this.pending = true;
      return;
    }
    this.saving = true;
    this.set('syncing');
    try {
      const remote = this.gist.gistId ? await this.gist.load() : null;
      if (this.paused) return;
      const local = this.store.state;
      let next = local;
      let push = true;
      if (!remote) {
        // Пустой или новый Gist: пишем свою игру.
      } else if (this.forced) {
        // Игру заменили здесь (файл, новая игра): она и идёт в Gist.
      } else if (gameIdOf(remote) !== gameIdOf(local)) {
        // В Gist другая игра. Пустую игру из лобби молча меняем на неё, иначе спрашиваем.
        const fresh = !local.setupDone && !local.tasks.length;
        const choice = fresh ? 'remote' : await this.chooseForeign(remote);
        if (choice === 'cancel') {
          this.gist = null;
          throw new Error('В Gist другая игра, синхронизация не включена.');
        }
        if (choice === 'remote') {
          if (!fresh) saveBackup(local);
          next = remote;
          push = false;
        }
      } else if (this.base && remote.rev <= this.base.rev) {
        // В Gist ничего нового: пишем, только если здесь что-то делали.
        push = this.dirty;
      } else if (this.base && !this.dirty) {
        // В Gist новее, а здесь ничего не делали: просто берём ту версию.
        next = remote;
        push = false;
      } else {
        // Менялись обе стороны (или общей версии ещё нет): сливаем.
        next = mergeGames(this.base, local, remote);
        if (this.base || this.dirty) this.store.say('Игра обновлена с другого устройства, изменения объединены.');
      }
      const rev = Math.max(remote?.rev ?? 0, local.rev) + (push ? 1 : 0);
      next.rev = push ? rev : (remote?.rev ?? rev);
      if (next !== local) this.install(next);
      // С этого момента новые действия игрока снова «грязные».
      this.dirty = false;
      const sent = this.store.state;
      const snapshot = clone(sent);
      if (push) await this.gist.write(snapshot);
      // Пока шла запись, игру могли заменить ещё раз: тогда она уйдёт следующим сохранением.
      if (this.store.state === sent) {
        this.forced = false;
        write(FORCE_KEY, null);
      } else this.pending = true;
      this.base = snapshot;
      this.baseGist = this.gist?.gistId ?? null;
      write(BASE_KEY, JSON.stringify({ gistId: this.baseGist, state: snapshot }));
      if (!this.paused) saveLocal(this.store.state);
      this.set('synced');
    } finally {
      this.saving = false;
      if (this.pending) {
        this.pending = false;
        this.scheduleGist(1000);
      }
    }
  }
}
