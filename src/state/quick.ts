// Быстрая запись свитка одной строкой: «Купить продукты #cook !1 @завтра».
// #слово ищет проект по началу названия, !1–4 это уровень, @дата это срок.

import { addDays, localDay } from './economy';
import type { GameState, Level } from './types';

export interface QuickScroll {
  title: string;
  projectId: string | null;
  level: Level | null;
  due: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function parseDue(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === 'сегодня') return today;
  if (w === 'завтра') return addDays(today, 1);
  if (w === 'послезавтра') return addDays(today, 2);
  const wd = WEEKDAYS.indexOf(w.slice(0, 2));
  if (wd >= 0) {
    const [y, m, d] = today.split('-').map(Number);
    const now = new Date(y, m - 1, d).getDay();
    return addDays(today, ((wd - now + 7) % 7) || 7);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  const dm = /^(\d{1,2})\.(\d{1,2})$/.exec(w);
  if (dm) {
    const year = Number(today.slice(0, 4));
    let date = `${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    if (date < today) date = `${year + 1}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    return date;
  }
  return null;
}

export function parseQuick(state: GameState, line: string, today = localDay()): QuickScroll {
  let projectId: string | null = null;
  let level: Level | null = null;
  let due: string | null = null;
  const words: string[] = [];
  for (const word of line.trim().split(/\s+/)) {
    if (word.length > 1 && word[0] === '#') {
      const key = norm(word.slice(1));
      const p = key ? state.projects.find((x) => norm(x.name).startsWith(key) || norm(x.id).startsWith(key)) : undefined;
      if (p) {
        projectId = p.id;
        continue;
      }
    }
    if (/^![1-4]$/.test(word)) {
      level = Number(word[1]) as Level;
      continue;
    }
    if (word.length > 1 && word[0] === '@') {
      const d = parseDue(word.slice(1), today);
      if (d) {
        due = d;
        continue;
      }
    }
    words.push(word);
  }
  return { title: words.join(' '), projectId, level, due };
}
