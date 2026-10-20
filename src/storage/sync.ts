// Сохранение: всегда в localStorage (быстро, работает офлайн) и, если настроен токен,
// в секретный Gist, чтобы ПК и телефон видели одну и ту же игру.

import type { Store } from '../state/store';
import type { GameState } from '../state/types';
import { GistStorage } from './gist';

const LOCAL_KEY = 'taskcraft.state';

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';

export function loadLocal(): GameState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

function saveLocal(state: GameState) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    /* переполнение или приватный режим */
  }
}

export class Sync {
  status: SyncStatus = 'local';
  error = '';
  private gist: GistStorage | null = null;
  private gistTimer: number | undefined;
  private localTimer: number | undefined;
  private saving = false;
  private pending = false;
  private listeners = new Set<() => void>();

  constructor(private store: Store) {
    store.subscribe((_state, changed) => {
      if (this.localTimer === undefined) {
        this.localTimer = window.setTimeout(() => {
          this.localTimer = undefined;
          saveLocal(this.store.state);
        }, changed ? 300 : 5000);
      }
      if (changed) this.scheduleGist(3000);
    });
    // Добыча идёт тиками без действий игрока, поэтому раз в 5 минут сохраняем и её.
    window.setInterval(() => this.scheduleGist(0), 5 * 60_000);
    // Сеть вернулась: догоняем Gist тем, что накопилось без неё.
    window.addEventListener('online', () => this.scheduleGist(0));
    window.addEventListener('offline', () => this.gist && this.set('error', 'Нет сети'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        saveLocal(this.store.state);
        this.scheduleGist(0);
      }
    });
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private set(status: SyncStatus, error = '') {
    this.status = status;
    this.error = error;
    for (const l of this.listeners) l();
  }

  /** Подключает Gist. Если в нём ревизия новее локальной, берём её. */
  async connect(token: string, gistId: string | null): Promise<string> {
    this.gist = new GistStorage(token, gistId);
    this.set('syncing');
    try {
      const remote = gistId ? await this.gist.load() : null;
      if (remote && remote.rev > this.store.state.rev) {
        this.store.replace(remote);
        this.store.say('Загружено сохранение из Gist.');
      }
      await this.flush();
      return this.gist.gistId!;
    } catch (e) {
      this.set('error', (e as Error).message);
      throw e;
    }
  }

  disconnect() {
    this.gist = null;
    this.set('local');
  }

  private scheduleGist(delay: number) {
    if (!this.gist) return;
    window.clearTimeout(this.gistTimer);
    this.gistTimer = window.setTimeout(() => void this.flush(), delay);
  }

  async flush() {
    if (!this.gist) return;
    if (this.saving) {
      this.pending = true;
      return;
    }
    this.saving = true;
    this.set('syncing');
    try {
      const state = this.store.state;
      const result = await this.gist.save(state, state.rev);
      if (result.ok) {
        state.rev = result.rev;
        saveLocal(state);
        this.set('synced');
      } else {
        // На другом устройстве сохранили позже: берём ту версию, чтобы ничего не перетереть.
        this.store.replace(result.remote);
        saveLocal(result.remote);
        this.store.say('В Gist была версия новее, с другого устройства. Загружаю её.', 'warn');
        this.set('synced');
      }
    } catch (e) {
      this.set('error', (e as Error).message);
    } finally {
      this.saving = false;
      if (this.pending) {
        this.pending = false;
        this.scheduleGist(1000);
      }
    }
  }
}
