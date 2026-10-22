// Синхронизация через Gist между двумя устройствами: GitHub подменён в памяти, у каждого
// устройства свой localStorage. Ничего не теряется, когда обе стороны что-то делали.

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { Store } from '../src/state/store';
import { createInitialState } from '../src/state/seed';
import type { GameState } from '../src/state/types';
import { mergeGames } from '../src/storage/merge';
import { NOON, newGame } from './helpers';

afterEach(() => mock.timers.reset());

type G = Record<string, unknown>;
const g = globalThis as G;
g.window = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, addEventListener: () => {} };
g.document = { addEventListener: () => {}, visibilityState: 'visible' };
g.confirm = () => true;

/** Gist в памяти: одна ревизия файла taskcraft.json. */
function fakeGitHub() {
  const gh = { content: '', writes: 0 };
  g.fetch = async (_url: string, init: { method?: string; body?: string } = {}) => {
    const res = (o: unknown, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) });
    if (init.method === 'POST' || init.method === 'PATCH') {
      gh.content = JSON.parse(init.body!).files['taskcraft.json'].content;
      gh.writes++;
      return res({ id: 'g1' }, init.method === 'POST' ? 201 : 200);
    }
    return res({ files: { 'taskcraft.json': { content: gh.content, truncated: false } } });
  };
  return gh;
}

/** Устройство: своя игра и свой localStorage, который подставляется на время каждого вызова. */
async function device(state?: GameState) {
  const { Sync } = await import('../src/storage/sync');
  const ls = new Map<string, string>();
  const storage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) };
  g.localStorage = storage;
  const store = new Store(state ?? createInitialState(NOON, true));
  const sync = new Sync(store);
  const on = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    g.localStorage = storage;
    return fn();
  };
  return { store, sync, on, titles: () => store.state.tasks.map((t) => t.title).sort() };
}

test('два устройства: задачи обоих сохраняются, а не затираются версией из Gist', async () => {
  newGame();
  const gh = fakeGitHub();
  const pc = await device();
  await pc.on(() => pc.sync.connect('tok', null));
  await pc.on(() => pc.store.addTask('ПК: первая', 'main', 1));
  await pc.on(() => pc.sync.flush());

  const phone = await device(createInitialState(NOON, true));
  await phone.on(() => phone.sync.connect('tok', 'g1'));
  assert.deepEqual(phone.titles(), ['ПК: первая'], 'новое устройство забирает игру из Gist');

  await phone.on(() => phone.store.addTask('Телефон: вторая', 'main', 1));
  await phone.on(() => phone.sync.flush());
  // ПК не знает о записи телефона и записывает своё.
  await pc.on(() => pc.store.addTask('ПК: третья', 'main', 1));
  await pc.on(() => pc.sync.flush());
  assert.deepEqual(pc.titles(), ['ПК: первая', 'ПК: третья', 'Телефон: вторая']);
  const inGist = (JSON.parse(gh.content) as GameState).tasks.map((t) => t.title).sort();
  assert.deepEqual(inGist, ['ПК: первая', 'ПК: третья', 'Телефон: вторая']);
});

test('без действий игрока Gist не переписывается, а новая версия оттуда просто берётся', async () => {
  newGame();
  const gh = fakeGitHub();
  const pc = await device();
  await pc.on(() => pc.sync.connect('tok', null));
  const phone = await device(createInitialState(NOON, true));
  await phone.on(() => phone.sync.connect('tok', 'g1'));
  const writes = gh.writes;
  await phone.on(() => phone.sync.flush());
  await phone.on(() => phone.sync.flush());
  assert.equal(gh.writes, writes, 'таймер без изменений ничего не пишет');
  await pc.on(() => pc.store.addTask('ПК: новая', 'main', 1));
  await pc.on(() => pc.sync.flush());
  await phone.on(() => phone.sync.flush());
  assert.deepEqual(phone.titles(), ['ПК: новая']);
});

test('в Gist другая игра: без выбора игрока она не затирается', async () => {
  newGame();
  const gh = fakeGitHub();
  const pc = await device();
  await pc.on(() => pc.store.addTask('Игра ПК', 'main', 1));
  await pc.on(() => pc.sync.connect('tok', null));
  const laptop = await device(createInitialState(NOON, true));
  laptop.store.state.rev = 40;
  await laptop.on(() => laptop.store.addTask('Старая игра ноутбука', 'main', 1));
  laptop.sync.chooseForeign = async () => 'cancel';
  await assert.rejects(laptop.on(() => laptop.sync.connect('tok', 'g1')));
  assert.deepEqual((JSON.parse(gh.content) as GameState).tasks.map((t) => t.title), ['Игра ПК']);
  assert.equal(laptop.sync.status, 'error');
  laptop.sync.chooseForeign = async () => 'remote';
  await laptop.on(() => laptop.sync.connect('tok', 'g1'));
  assert.deepEqual(laptop.titles(), ['Игра ПК'], 'по выбору игрока игра берётся из Gist');
});

test('игра, загруженная из файла во время сохранения, уходит в Gist, а не откатывается', async () => {
  newGame();
  const gh = fakeGitHub();
  const pc = await device();
  await pc.on(() => pc.store.addTask('Старая игра', 'main', 1));
  await pc.on(() => pc.sync.connect('tok', null));
  const fresh = createInitialState(NOON, true);
  fresh.tasks.push({ ...pc.store.state.tasks[0], id: 'x1', title: 'Из файла' });
  // Загрузка файла посреди сохранения: подменяем игру, пока идёт запрос к GitHub.
  const fetch0 = g.fetch as (u: string, i?: object) => Promise<unknown>;
  g.fetch = async (u: string, i?: { method?: string }) => {
    if (!i?.method) pc.store.replace(fresh);
    return fetch0(u, i);
  };
  await pc.on(() => pc.store.addTask('Ещё', 'main', 1));
  await pc.on(() => pc.sync.flush());
  g.fetch = fetch0;
  await pc.on(() => pc.sync.flush());
  assert.deepEqual(pc.titles(), ['Из файла']);
  assert.deepEqual((JSON.parse(gh.content) as GameState).tasks.map((t) => t.title), ['Из файла']);
});

test('слияние: ресурсы складываются приростами, удалённое здесь не возвращается', () => {
  const base = createInitialState(NOON, true);
  base.tasks.push({ id: 'a', title: 'A', projectId: null, level: null, status: 'inbox', createdAt: NOON, spentMs: 0 });
  const local: GameState = JSON.parse(JSON.stringify(base));
  const remote: GameState = JSON.parse(JSON.stringify(base));
  local.resources.gold += 30;
  remote.resources.gold += 50;
  local.tasks = [];
  remote.tasks.push({ id: 'b', title: 'B', projectId: null, level: null, status: 'inbox', createdAt: NOON, spentMs: 0 });
  remote.hero.xp = 40;
  const m = mergeGames(base, local, remote);
  assert.equal(m.resources.gold, base.resources.gold + 80);
  assert.deepEqual(m.tasks.map((t) => t.title), ['B']);
  assert.equal(m.hero.xp, 40);
});
