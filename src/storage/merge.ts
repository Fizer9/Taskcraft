// Слияние двух версий одной игры, когда ПК и телефон менялись независимо (Gist).
// Трёхстороннее: base — версия, с которой устройство последний раз совпадало с Gist,
// local — что стало здесь, remote — что лежит в Gist. Что здесь не менялось с base,
// берётся из Gist; что менялось, остаётся отсюда. Задачи, проекты и сферы сливаются
// поштучно по id, золото и дерево складываются приростами обеих сторон.

import type { GameState } from '../state/types';

type Json = unknown;
type Obj = Record<string, Json>;

const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: Json): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const hasIds = (v: Json): v is Obj[] => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && typeof x.id === 'string');

/** Служебные поля, которые выставляет само сохранение. */
const SKIP = new Set(['rev', 'updatedAt']);

/** Ресурсы: прирост здесь плюс прирост там, от общей точки. */
function mergeAmounts(base: Json, local: Json, remote: Json): Json {
  if (!isObj(local) || !isObj(remote)) return remote ?? local;
  const b = isObj(base) ? base : {};
  const out: Obj = { ...remote };
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = Number(local[k] ?? 0);
    const r = Number(remote[k] ?? 0);
    const o = Number(b[k] ?? l);
    const v = r + (l - o);
    out[k] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : r;
  }
  return out;
}

/** Списки с id: каждый элемент сливается сам по себе, добавленные с обеих сторон остаются. */
function mergeById(base: Json, local: Obj[], remote: Obj[]): Obj[] {
  const b = new Map((Array.isArray(base) ? (base as Obj[]) : []).filter(isObj).map((x) => [x.id as string, x]));
  const l = new Map(local.map((x) => [x.id as string, x]));
  const out: Obj[] = [];
  for (const r of remote) {
    const id = r.id as string;
    const o = b.get(id);
    const mine = l.get(id);
    if (!o) out.push(mine && !same(mine, r) ? (merge3(r, mine, r) as Obj) : r);
    else if (!mine) {
      // Здесь удалили: удаляем, если там его с тех пор не трогали.
      if (!same(r, o)) out.push(r);
    } else out.push(merge3(o, mine, r) as Obj);
  }
  for (const mine of local) {
    const id = mine.id as string;
    if (remote.some((r) => r.id === id)) continue;
    const o = b.get(id);
    // Добавлен здесь, или там удалён, а здесь с тех пор менялся.
    if (!o || !same(mine, o)) out.push(mine);
  }
  return out;
}

/** Без общей версии (первая синхронизация после обновления): всё из Gist, плюс то, чего там нет. */
function unionById(local: Obj[], remote: Obj[]): Obj[] {
  return [...remote, ...local.filter((x) => !remote.some((r) => r.id === x.id))];
}

export function merge3(base: Json, local: Json, remote: Json): Json {
  if (same(local, remote)) return local;
  if (base !== undefined && same(local, base)) return remote;
  if (base !== undefined && same(remote, base)) return local;
  if (hasIds(local) || hasIds(remote)) {
    const l = Array.isArray(local) ? (local as Obj[]) : [];
    const r = Array.isArray(remote) ? (remote as Obj[]) : [];
    return base === undefined ? unionById(l, r) : mergeById(base, l, r);
  }
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : undefined;
    const out: Obj = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      if (SKIP.has(k)) out[k] = remote[k] ?? local[k];
      else if (k === 'resources') out[k] = mergeAmounts(b?.[k], local[k], remote[k]);
      else if (!(k in local) && b && k in b) {
        // Здесь поле убрали (например, ушёл Повелитель ужаса): убираем, если там не менялось.
        if (!same(remote[k], b[k])) out[k] = remote[k];
      } else if (!(k in remote) && b && k in b) {
        if (!same(local[k], b[k])) out[k] = local[k];
      } else out[k] = merge3(b ? b[k] : undefined, local[k], remote[k]);
    }
    return out;
  }
  // Простое значение поменялось с обеих сторон или общей версии нет: побеждает Gist,
  // если здесь с base ничего не менялось, иначе своё.
  return base === undefined ? remote : local;
}

export function mergeGames(base: GameState | null, local: GameState, remote: GameState): GameState {
  return merge3(base ?? undefined, local, remote) as GameState;
}

/** Какая это игра: у новых сохранений свой id, у старых он выводится из даты начала. */
export function gameIdOf(s: Pick<GameState, 'gameId' | 'startedAt' | 'tutorialDone' | 'setupDone'>): string {
  return s.gameId ?? `g-${s.startedAt ?? s.tutorialDone ?? s.setupDone ?? 0}`;
}
