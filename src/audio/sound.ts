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
} as const;
type Sfx = keyof typeof SFX;

const MUSIC = ['sound/human1.mp3', 'sound/human2.mp3', 'sound/human3.mp3'];

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
};

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
    if (!url) return;
    window.setTimeout(() => {
      this.voice?.pause();
      const a = new Audio(url);
      a.volume = this.volume.sfx;
      this.voice = a;
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
    if (this.music) {
      this.music.volume = this.volume.music;
      if (this.volume.music <= 0) this.music.pause();
      else if (this.music.paused) void this.music.play().catch(() => {});
    }
  }
}

export const sounds = new SoundBoard();

/** Щелчок на любой кнопке интерфейса, как в WC3. */
export function bindClickSound() {
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('button, .btn, .cmd')) void sounds.play('click');
    },
    true,
  );
}
