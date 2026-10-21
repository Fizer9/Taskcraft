// Звуки, голоса юнитов и музыка WC3. Файлы зашифрованы вместе с графикой (sound/*.mp3),
// поэтому играют только после пароля; без них игра просто молчит.
// Громкость музыки и эффектов хранится в браузере и меняется в настройках.

import { artUrl } from '../assets/loader';
import type { Cue } from '../state/store';
import type { Level } from '../state/types';

const SFX = {
  click: 'sound/click.mp3',
  error: 'sound/error.mp3',
  quest: 'sound/quest.mp3',
  gold: 'sound/gold.mp3',
  hit: 'sound/hit.mp3',
  bash: 'sound/bash.mp3',
  gatefall: 'sound/gatefall.mp3',
  build: 'sound/build.mp3',
  goodjob: 'sound/goodjob.mp3',
  rooster: 'sound/rooster.mp3',
  wolf: 'sound/wolf.mp3',
  victory: 'sound/victory.mp3',
  hover: 'sound/hover.mp3',
  hint: 'sound/hint.mp3',
  goldlow: 'sound/goldlow.mp3',
  bigclick: 'sound/bigclick.mp3',
  bling: 'sound/bling.mp3',
  item: 'sound/item.mp3',
  collapse: 'sound/collapse.mp3',
  collapseSmall: 'sound/collapse-small.mp3',
  place: 'sound/place.mp3',
  hammer: 'sound/hammer.mp3',
} as const;
type Sfx = keyof typeof SFX;

const MUSIC = ['sound/human1.mp3', 'sound/human2.mp3', 'sound/human3.mp3'];

/**
 * Фон окружения Лордерона летом, как в WC3: днём птицы и ветер, ночью сверчки, плавный
 * переход на рассвете и закате. Дождь, мельница у лесопилки и ручей у озера поверх.
 */
const AMBIENT = {
  day: 'sound/amb-day.mp3',
  night: 'sound/amb-night.mp3',
  rain: 'sound/amb-rain.mp3',
  mill: 'sound/amb-windmill.mp3',
  stream: 'sound/amb-stream.mp3',
} as const;
type Ambient = keyof typeof AMBIENT;
/** Громкость фона относительно эффектов: он тихий, чтобы не спорить с музыкой. */
const AMBIENT_LEVEL = { day: 0.35, night: 0.35, rain: 0.5, mill: 0.45, stream: 0.4 } as const;

/** Доля дня по часу: 1 с 7 до 19, 0 с 21 до 5, между ними плавный переход. */
export function daylight(h: number): number {
  if (h >= 7 && h <= 19) return 1;
  if (h <= 5 || h >= 21) return 0;
  return h < 7 ? (h - 5) / 2 : (21 - h) / 2;
}

/** Какие звуки играют на событие игры; задержка в секундах, чтобы удар шёл после рывка юнита. */
const CUES: Record<Cue, [Sfx, number][]> = {
  hire: [['gold', 0]],
  start: [['bash', 0]],
  complete: [['hit', 0.6], ['hit', 1.3], ['quest', 1.8]],
  fortress: [['gatefall', 1.5], ['victory', 2.5]],
  level: [['goodjob', 0]],
  farm: [['build', 0]],
  dawn: [['rooster', 0]],
  move: [],
  warn: [['error', 0]],
  legion: [['wolf', 0]],
  spell: [['bash', 0]],
  jobdone: [['build', 0]],
  nogold: [['error', 0]],
  nolumber: [['error', 0]],
  nofood: [['error', 0]],
};

/**
 * Голосовые предупреждения людей из WC3: «Работа завершена», «Недостаточно золота».
 * Пока файлов нет среди ассетов, вместо них играет запасная реплика или просто звук ошибки.
 */
const WARNINGS: Partial<Record<Cue, { path: string; fallback?: [Voice, Line, number] }>> = {
  jobdone: { path: 'sound/warning/jobdone.mp3', fallback: ['peasant', 'yes', 0.3] },
  nogold: { path: 'sound/warning/nogold.mp3' },
  nolumber: { path: 'sound/warning/nolumber.mp3' },
  nofood: { path: 'sound/warning/nofood.mp3' },
  // «Наш город атакован!»: ночью пришёл Легион.
  legion: { path: 'sound/warning/townattack.mp3' },
};

/** Звук выбора здания: sound/buildings/<здание>what.mp3; без файла звучит щелчок интерфейса. */
const buildingWhat = (building: string) => `sound/buildings/${building}what.mp3`;

/** Сколько реплик каждого вида в русской озвучке: sound/voice/<юнит><вид><номер>.mp3. */
const VOICES = {
  peasant: { ready: 1, yes: 4, yesattack: 4, what: 4, warcry: 1, pissed: 5 },
  footman: { ready: 1, yes: 4, yesattack: 3, what: 4, warcry: 1, pissed: 4 },
  rifleman: { ready: 1, yes: 4, yesattack: 4, what: 4, warcry: 1, pissed: 8 },
  knight: { ready: 1, yes: 4, yesattack: 3, what: 4, warcry: 1, pissed: 6 },
  gryphonrider: { ready: 1, yes: 5, yesattack: 3, what: 5, warcry: 1, pissed: 5 },
  heromountainking: { ready: 1, yes: 4, yesattack: 4, what: 4, warcry: 1, pissed: 7 },
} as const;
export type Voice = keyof typeof VOICES;
type Line = keyof (typeof VOICES)['peasant'];

/** Голос юнита задачи по её уровню. */
export const UNIT_VOICE: Record<Level, Voice> = { 1: 'footman', 2: 'rifleman', 3: 'knight', 4: 'gryphonrider' };

/** Кто что говорит на событие; 'unit' означает юнита задачи, к которой относится событие. */
const VOICE_CUES: Partial<Record<Cue, [Voice | 'unit', Line, number]>> = {
  hire: ['unit', 'ready', 0.2],
  start: ['unit', 'yesattack', 0],
  complete: ['unit', 'warcry', 0],
  farm: ['peasant', 'yes', 0.3],
  level: ['heromountainking', 'warcry', 0.8],
  move: ['heromountainking', 'yes', 0],
  spell: ['heromountainking', 'yesattack', 0.1],
};

/** Столько быстрых щелчков подряд по одному юниту, и он начинает ворчать. */
const PISSED_AFTER = 4;

interface Volume {
  music: number;
  sfx: number;
}

const KEY = 'taskcraft.volume';

function loadVolume(): Volume {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '') as Volume;
    if (typeof v.music === 'number' && typeof v.sfx === 'number') return v;
  } catch {
    /* по умолчанию */
  }
  return { music: 0.35, sfx: 0.7 };
}

class SoundBoard {
  readonly volume = loadVolume();
  private urls = new Map<string, Promise<string | null>>();
  private music: HTMLAudioElement | null = null;
  private track = Math.floor(Math.random() * MUSIC.length);
  private started = false;
  private voice: HTMLAudioElement | null = null;
  private clicks = { key: '', count: 0, at: 0, pissed: 0 };
  private ambient = new Map<Ambient, HTMLAudioElement>();
  /** Сколько каждого фона сейчас нужно, 0..1 (без общей громкости). */
  private ambientMix: Record<Ambient, number> = { day: 0, night: 0, rain: 0, mill: 0, stream: 0 };
  private starting = new Set<HTMLAudioElement>();
  private lastHover = 0;
  /** Кто-то заговорил: портрет героя в консоли шевелит губами (ui/portrait3d.ts). */
  onTalk: (voice: Voice, seconds: number) => void = () => {};

  private url(path: string): Promise<string | null> {
    let u = this.urls.get(path);
    if (!u) {
      u = artUrl(path).catch(() => null);
      this.urls.set(path, u);
    }
    return u;
  }

  async play(name: Sfx, delay = 0) {
    if (this.volume.sfx <= 0) return;
    const url = await this.url(SFX[name]);
    if (!url) return;
    const a = new Audio(url);
    a.volume = this.volume.sfx;
    window.setTimeout(() => void a.play().catch(() => {}), delay * 1000);
  }

  /** Реплика юнита. Говорит один голос за раз: новая реплика обрывает прежнюю, как в игре. */
  async say(voice: Voice, line: Line, delay = 0, n = 1 + Math.floor(Math.random() * VOICES[voice][line])) {
    if (this.volume.sfx <= 0) return;
    const url = await this.url(`sound/voice/${voice}${line}${n}.mp3`);
    if (url) this.speak(url, delay, voice);
  }

  /** Предупреждение голосом советника; true, если файл нашёлся. */
  private async warn(path: string): Promise<boolean> {
    const url = await this.url(path);
    if (url && this.volume.sfx > 0) this.speak(url, 0);
    return !!url;
  }

  /**
   * Голосовое предупреждение не по событию игры, а по состоянию: «Золотая шахта истощается»,
   * «Наш герой пал». Без файла звучит запасной звук, если он есть.
   */
  async warning(name: 'goldminelow' | 'herodies', fallback?: Sfx) {
    if (!(await this.warn(`sound/warning/${name}.mp3`)) && fallback) void this.play(fallback);
  }

  /** Щелчок по зданию на карте: ратуша, ферма, казарма, кузница и другие отвечают своим звуком. */
  async selectBuilding(building = 'townhall') {
    if (this.volume.sfx <= 0) return;
    const url = (await this.url(buildingWhat(building))) ?? (await this.url(buildingWhat('townhall')));
    if (!url) return void this.play('click');
    const a = new Audio(url);
    a.volume = this.volume.sfx;
    void a.play().catch(() => {});
  }

  private speak(url: string, delay: number, voice?: Voice) {
    window.setTimeout(() => {
      this.voice?.pause();
      const a = new Audio(url);
      a.volume = this.volume.sfx;
      this.voice = a;
      if (voice) a.addEventListener('playing', () => this.onTalk(voice, a.duration || 2), { once: true });
      void a.play().catch(() => {});
    }, delay * 1000);
  }

  /** Отклик на выбор юнита. Если быстро щёлкать по одному и тому же, он ворчит по очереди всеми репликами. */
  select(voice: Voice, key: string) {
    const c = this.clicks;
    const now = performance.now();
    c.count = c.key === key && now - c.at < 1500 ? c.count + 1 : 1;
    c.key = key;
    c.at = now;
    if (c.count >= PISSED_AFTER) void this.say(voice, 'pissed', 0, (c.pissed++ % VOICES[voice].pissed) + 1);
    else void this.say(voice, 'what');
  }

  cue(cue: Cue, unit?: Level) {
    for (const [name, delay] of CUES[cue]) void this.play(name, delay);
    const v = VOICE_CUES[cue];
    if (v && (v[0] !== 'unit' || unit)) void this.say(v[0] === 'unit' ? UNIT_VOICE[unit!] : v[0], v[1], v[2]);
    const w = WARNINGS[cue];
    if (w)
      void this.warn(w.path).then((found) => {
        if (!found && w.fallback) void this.say(...w.fallback);
      });
    // Победный марш перекрывает музыку, она стихает и потом возвращается.
    if (cue === 'fortress' && this.music) this.duck(12);
  }

  /** Музыка людей по кругу, начиная со случайной темы. Браузер разрешает её только после клика. */
  async startMusic() {
    if (this.started) return;
    this.started = true;
    const next = async (tries = MUSIC.length): Promise<void> => {
      const url = await this.url(MUSIC[this.track % MUSIC.length]);
      this.track++;
      // Каких-то тем может не быть среди ассетов: берём следующую.
      if (!url) return tries > 1 ? next(tries - 1) : undefined;
      const a = new Audio(url);
      a.volume = this.volume.music;
      a.onended = () => void next();
      this.music = a;
      if (this.volume.music > 0) await a.play().catch(() => this.waitForClick(a));
    };
    await next();
  }

  /** Если браузер не дал начать музыку сразу, начнём её с первого клика по странице. */
  private waitForClick(a: HTMLAudioElement) {
    const go = () => void a.play().catch(() => {});
    window.addEventListener('pointerdown', go, { once: true });
  }

  /** Фон окружения: заводит петли и дальше только меняет их громкость (setAmbient). */
  async startAmbient() {
    await Promise.all(
      (Object.keys(AMBIENT) as Ambient[]).map(async (k) => {
        const url = await this.url(AMBIENT[k]);
        if (!url || this.ambient.has(k)) return;
        const a = new Audio(url);
        a.loop = true;
        a.volume = 0;
        this.ambient.set(k, a);
      }),
    );
    this.applyAmbient();
  }

  /** Новая смесь фона: часть задаётся, остальное остаётся как было. */
  setAmbient(mix: Partial<Record<Ambient, number>>) {
    Object.assign(this.ambientMix, mix);
    this.applyAmbient();
  }

  private applyAmbient() {
    for (const [k, a] of this.ambient) {
      const v = Math.min(1, Math.max(0, this.ambientMix[k] * AMBIENT_LEVEL[k] * this.volume.sfx));
      a.volume = v;
      if (v > 0.001 && a.paused && !this.starting.has(a)) {
        // Пока браузер не дал звук без клика, пробуем снова только после первого клика.
        this.starting.add(a);
        a.play()
          .then(() => this.starting.delete(a))
          .catch(() => window.addEventListener('pointerdown', () => (this.starting.delete(a), this.applyAmbient()), { once: true }));
      } else if (v <= 0.001 && !a.paused) a.pause();
    }
  }

  /** Тихий звук наведения на кнопку, не чаще раза в 80 мс. */
  hover() {
    const now = performance.now();
    if (now - this.lastHover < 80) return;
    this.lastHover = now;
    void this.play('hover');
  }

  private duck(seconds: number) {
    const a = this.music!;
    a.volume = this.volume.music * 0.15;
    window.setTimeout(() => (a.volume = this.volume.music), seconds * 1000);
  }

  setVolume(v: Partial<Volume>) {
    Object.assign(this.volume, v);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.volume));
    } catch {
      /* без сохранения */
    }
    this.applyAmbient();
    if (this.music) {
      this.music.volume = this.volume.music;
      if (this.volume.music <= 0) this.music.pause();
      else if (this.music.paused) void this.music.play().catch(() => {});
    }
  }
}

export const sounds = new SoundBoard();

/** Щелчок на любой кнопке интерфейса и тихий звук при наведении, как в WC3. */
export function bindClickSound() {
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('button, .btn, .cmd')) void sounds.play('click');
    },
    true,
  );
  let over: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = (e.target as HTMLElement).closest?.('button:not(:disabled), .cmd:not(.off)') ?? null;
    if (b && b !== over) sounds.hover();
    over = b;
  });
}
