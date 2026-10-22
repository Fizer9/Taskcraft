// Экспорт и импорт всей игры одним файлом: резервная копия, переезд на другой браузер
// без Gist. В файл идёт только сохранение игры; токен Gist и пароль туда не попадают.

import { Store } from '../state/store';
import { looksLikeSave, repairState } from '../state/repair';
import { saveBackup } from '../storage/sync';
import { MAIN_HALL_ID, type GameState } from '../state/types';

type SaveFile = { app: 'taskcraft'; version: 1; exportedAt: number; state: GameState };

export function exportSave(store: Store) {
  const file: SaveFile = { app: 'taskcraft', version: 1, exportedAt: Date.now(), state: store.state };
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taskcraft-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  store.say(`Сохранение выгружено в файл ${a.download}.`);
}

/** Похоже ли на сохранение игры: файл экспорта или голое состояние (как в localStorage и Gist). */
function readState(text: string): { state: GameState; at: number | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Это не файл сохранения: внутри не JSON.');
  }
  const wrapped = data as Partial<SaveFile>;
  const raw = wrapped?.app === 'taskcraft' ? wrapped.state : data;
  if (!looksLikeSave(raw)) throw new Error('Это не сохранение Taskcraft: нет задач, проектов или героя.');
  const at = wrapped?.app === 'taskcraft' ? (wrapped.exportedAt ?? null) : ((raw as GameState).updatedAt ?? null);
  // Недостающие поля берутся из новой игры, битые задачи отбрасываются.
  const state = repairState(raw);
  // Пробный запуск на копии: если игра с этим файлом падает, текущую не трогаем.
  try {
    new Store(JSON.parse(JSON.stringify(state)) as GameState).tick();
  } catch {
    throw new Error('Файл сохранения повреждён: игра с ним не запускается. Текущая игра не тронута.');
  }
  return { state, at };
}

/**
 * Загружает сохранение из файла вместо текущей игры (после подтверждения). Ревизия
 * берётся текущая, чтобы Gist принял загруженную игру как следующую версию, а не
 * вернул свою.
 */
export async function importSave(store: Store, file: File): Promise<boolean> {
  const { state, at } = readState(await file.text());
  const when = at ? new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'без даты';
  const open = state.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length;
  // Главная ратуша не проект; в лобби игры ещё нет, и заменять нечего.
  const projects = state.projects.filter((p) => p.id !== MAIN_HALL_ID).length;
  const replacing = !!store.state.setupDone || store.state.tasks.length > 0;
  if (!confirm(`Загрузить сохранение (${when}): проектов ${projects}, открытых задач ${open}?` + (replacing ? ' Текущая игра в этом браузере будет заменена.' : ''))) return false;
  state.rev = store.state.rev;
  // Прежняя игра остаётся резервной копией: если файл оказался не тот, её можно вернуть.
  saveBackup(store.state);
  store.replace(state);
  store.say(`Сохранение загружено из файла ${file.name}.`, 'win');
  return true;
}
