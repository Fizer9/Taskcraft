// Экономия батареи. Сцена рисуется не на каждый кадр экрана, а с частотой по обстановке:
// 60 кадров в секунду, пока карту двигают; на телефоне в покое 30; когда карту закрывает окно,
// экранная клавиатура или список свитков во весь экран, 15. Анимации моделей идут по часам,
// а не по кадрам, поэтому от пропусков не замедляются. Если телефон не вытягивает свою частоту
// даже в покое, 3D рисуется в меньшем разрешении, шагами по 0,25: на телефоне до половины,
// на компьютере только до пикселя страницы, иначе картинка мылится рядом с чётким интерфейсом.

export const FPS = { active: 60, idlePhone: 30, covered: 15 };
/** Столько после касания или прокрутки карта считается «в руках». */
const ACTIVE_MS = 2500;
/** Окно, за которое считается настоящая частота кадров. */
const WINDOW_MS = 2000;
/** Первые секунды грузятся модели и собираются шейдеры, их не меряем. */
const WARMUP_MS = 8000;
/** Уровень 2 значит пиксель картинки на два пикселя экрана по каждой стороне. */
export const MAX_SCALE = 2;

export interface PacerHost {
  /** Карту сейчас почти не видно. */
  covered(): boolean;
  setScale(level: number): void;
}

export class Pacer {
  private last = -Infinity;
  private activeUntil = 0;
  private started = -1;
  private win = { start: 0, frames: 0 };
  private lagging = 0;

  constructor(
    private host: PacerHost,
    private phone: boolean,
    /** Подстраивать разрешение под скорость (в автотестах браузера выключено). */
    private adapt: boolean,
    public scale = 1,
    /** Ниже этого разрешения не опускаемся (на компьютере 1: не мельче пикселя страницы). */
    private maxScale = MAX_SCALE,
  ) {
    if (scale !== 1) host.setScale(scale);
  }

  poke(now: number) {
    this.activeUntil = now + ACTIVE_MS;
  }

  target(now: number): number {
    if (this.host.covered()) return FPS.covered;
    if (now < this.activeUntil || !this.phone) return FPS.active;
    return FPS.idlePhone;
  }

  /** Зовётся на каждый кадр экрана. Секунды с прошлого нарисованного кадра или null: этот пропустить. */
  frame(now: number): number | null {
    if (this.started < 0) this.started = now;
    const fps = this.target(now);
    const gap = now - this.last;
    // Допуск 4 мс на дрожание: при экране 60 Гц цель 30 даёт ровно каждый второй кадр.
    if (gap < 1000 / fps - 4) return null;
    this.last = now;
    if (this.adapt) this.measure(now, gap, fps);
    return Math.min(gap, 250) / 1000;
  }

  private measure(now: number, gap: number, fps: number) {
    const idle = fps === (this.phone ? FPS.idlePhone : FPS.active) && now >= this.activeUntil;
    // Меряем только спокойную карту: без касаний, окон и пауз (вкладка в фоне, подгрузка).
    if (now - this.started < WARMUP_MS || !idle || gap > 500) {
      this.win.frames = 0;
      return;
    }
    if (!this.win.frames) this.win.start = now;
    this.win.frames++;
    const span = now - this.win.start;
    if (span < WINDOW_MS) return;
    const achieved = ((this.win.frames - 1) * 1000) / span;
    this.win.frames = 0;
    // Два окна подряд меньше трёх четвертей цели: картинку попроще. Обратно не поднимаем,
    // иначе разрешение прыгало бы туда-сюда.
    this.lagging = achieved < fps * 0.75 ? this.lagging + 1 : 0;
    if (this.lagging >= 2 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, this.scale + 0.25);
      this.host.setScale(this.scale);
      this.lagging = 0;
    }
  }
}
