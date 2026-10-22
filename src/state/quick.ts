// Быстрая запись свитка одной строкой: «Купить продукты #cook !1 @завтра».
// #слово ищет проект по началу названия, !1–4 это уровень, @дата это срок.

import { addDays, localDay } from './economy';
import type { GameState, Level } from './types';

export interface QuickScroll {
  title: string;
  projectId: string | null;
  level: Level | null;
  due: string | null;
  /** Слова с @, похожие на дату, но такой даты нет или она прошла: они остаются в названии. */
  bad: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');

/** Дни недели по номеру getDay(): сокращение и полные формы («в пятницу» пишут и «пятницу»). */
const WEEKDAYS: string[][] = [
  ['вс', 'воскресенье'],
  ['пн', 'понедельник'],
  ['вт', 'вторник'],
  ['ср', 'среда', 'среду'],
  ['чт', 'четверг'],
  ['пт', 'пятница', 'пятницу'],
  ['сб', 'суббота', 'субботу'],
];

/** Есть ли такой день в календаре (31.02 и 99.99 нет). */
function realDate(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return localDay(date);
}

/** Срок из слова после @: дата, null (не дата) или 'bad' (похоже на дату, но её нет или она прошла). */
function parseDue(word: string, today: string): string | null | 'bad' {
  const w = word.toLowerCase();
  if (w === 'сегодня') return today;
  if (w === 'завтра') return addDays(today, 1);
  if (w === 'послезавтра') return addDays(today, 2);
  const wd = WEEKDAYS.findIndex((forms) => forms.includes(w));
  if (wd >= 0) {
    const [y, m, d] = today.split('-').map(Number);
    const now = new Date(y, m - 1, d).getDay();
    return addDays(today, ((wd - now + 7) % 7) || 7);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
  if (iso) {
    const date = realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date && date >= today ? date : 'bad';
  }
  const dm = /^(\d{1,2})\.(\d{1,2})$/.exec(w);
  if (dm) {
    const year = Number(today.slice(0, 4));
    const date = realDate(year, Number(dm[2]), Number(dm[1]));
    if (!date) {
      // 29.02 в невисокосный год: ближайший такой день в следующем году.
      return realDate(year + 1, Number(dm[2]), Number(dm[1])) ?? 'bad';
    }
    return date < today ? (realDate(year + 1, Number(dm[2]), Number(dm[1])) ?? 'bad') : date;
  }
  return null;
}

export function parseQuick(state: GameState, line: string, today = localDay()): QuickScroll {
  let projectId: string | null = null;
  let level: Level | null = null;
  let due: string | null = null;
  const bad: string[] = [];
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
      if (d === 'bad') bad.push(word);
      else if (d) {
        due = d;
        continue;
      }
    }
    words.push(word);
  }
  return { title: words.join(' '), projectId, level, due, bad };
}
