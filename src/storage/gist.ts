// Хранение состояния в секретном Gist через GitHub API.
// Токену нужно только право "gist". Весь прогресс это один файл taskcraft.json.

import type { GameState } from '../state/types';

const FILE = 'taskcraft.json';
const API = 'https://api.github.com/gists';

export class GistError extends Error {}

export class GistStorage {
  constructor(
    private token: string,
    public gistId: string | null,
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async load(): Promise<GameState | null> {
    if (!this.gistId) return null;
    const res = await fetch(`${API}/${this.gistId}`, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) throw new GistError('Gist не найден. Проверь id или токен.');
    if (!res.ok) throw new GistError(`GitHub ответил ${res.status}`);
    const json = await res.json();
    const file = json.files?.[FILE];
    if (!file) return null;
    // Большие файлы GitHub отдаёт обрезанными, тогда читаем по raw_url.
    const content: string = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
    return JSON.parse(content) as GameState;
  }

  /** Создаёт новый секретный Gist и возвращает его id. */
  async create(state: GameState): Promise<string> {
    const res = await fetch(API, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        description: 'Taskcraft: сохранение игры',
        public: false,
        files: { [FILE]: { content: JSON.stringify(state) } },
      }),
    });
    if (!res.ok) throw new GistError(`Не удалось создать Gist: ${res.status}`);
    const json = await res.json();
    this.gistId = json.id;
    return json.id;
  }

  /**
   * Сохраняет состояние с защитой от перезаписи: если в Gist уже лежит ревизия новее,
   * чем та, от которой мы начинали, возвращает её вместо записи.
   */
  async save(state: GameState, baseRev: number): Promise<{ ok: true; rev: number } | { ok: false; remote: GameState }> {
    if (!this.gistId) {
      state.rev = baseRev + 1;
      await this.create(state);
      return { ok: true, rev: state.rev };
    }
    const remote = await this.load();
    if (remote && remote.rev > baseRev) return { ok: false, remote };
    const next = { ...state, rev: baseRev + 1 };
    const res = await fetch(`${API}/${this.gistId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(next) } } }),
    });
    if (!res.ok) throw new GistError(`Не удалось сохранить в Gist: ${res.status}`);
    return { ok: true, rev: next.rev };
  }
}
