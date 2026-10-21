// Модель данных Taskcraft. Всё состояние игры это один JSON, который
// сохраняется в браузере и (если настроено) в секретном Gist.

export type Level = 1 | 2 | 3 | 4;

/** Путь задачи из дизайн-документа, раздел 6. */
export type TaskStatus = 'inbox' | 'hired' | 'active' | 'done' | 'cancelled';

/** Тип базы, раздел 5: рабочая, личная или в любое время. */
export type BaseKind = 'work' | 'personal' | 'any';

/** Повторяющаяся задача или привычка (Мастерская, раздел 9). */
export type Repeat = 'daily' | 'weekdays' | 'weekly';

export interface Sphere {
  id: string;
  name: string;
  score: number;
  target: number;
}

export interface Project {
  id: string;
  name: string;
  sphereId: string;
  kind: BaseKind;
  /** Здоровье вражеской крепости: финальная цель проекта. */
  fortressHp: number;
  fortressMaxHp: number;
  /** Позиция базы на карте (клетка сетки). */
  slot: { x: number; z: number };
  /** Законсервирована: проект на паузе, база не добывает, не гниёт и не зовёт Легион. */
  frozen: boolean;
  /** День расконсервации: сроки, прошедшие за время паузы, считаются просроченными с этого дня. */
  thawedOn?: string;
  /** Когда в проекте последний раз что-то двигалось: найм, работа, выполнение. */
  lastActivityAt?: number;
  /** База захвачена Легионом: законсервирована, пока у её стен есть демоны. */
  capturedAt?: number;
  /** Когда пала вражеская крепость: миссия выиграна. */
  wonAt?: number;
  /** Когда база заложена. У старых проектов нет: берётся первая задача. */
  createdAt?: number;
  /** Насколько скверна повредила здания базы, 0–100. Чинится за золото. */
  damage?: number;
}

export interface Task {
  id: string;
  title: string;
  projectId: string | null;
  level: Level | null;
  status: TaskStatus;
  createdAt: number;
  /** Сколько миллисекунд задача провела в работе (для калибровки уровня). */
  spentMs: number;
  doneAt?: number;
  /** Когда задачу отменили или изгнали демона. */
  cancelledAt?: number;
  /** Срок задачи, "2026-10-20" по местному времени. */
  due?: string;
  /** С какого дня задача стала демоном Легиона (день после просроченного срока). */
  demonSince?: string;
  /** Последняя ступень демона, о которой игрок уже знает: рост объявляется один раз. */
  demonRank?: number;
  /** Командир отряда: большая задача, частью которой эта задача является. */
  parentId?: string;
  /** Повтор: после выполнения появляется следующая такая же задача со следующим сроком. */
  repeat?: Repeat;
  /** Серия: сколько раз подряд повторяющаяся задача сделана в срок. */
  streak?: number;
}

export type HeroKind = 'mountainking' | 'paladin' | 'archmage' | 'bloodmage';

export interface Hero {
  id: string;
  name: string;
  /** Класс героя; у старых сохранений это Горный король. */
  kind?: HeroKind;
  /** Место на алтаре: 0 рабочая смена, 1 вечер, 2 выходные (раздел 7). */
  slot?: number;
  level: number;
  xp: number;
  mana: number;
  maxMana: number;
  /** На какой базе стоит герой: там добыча идёт в полную силу. */
  baseId: string;
  /** Изученные способности: ступень 1–3, у ультимейта 1. */
  skills?: Partial<Record<AbilityId, number>>;
  /** С какого дня способность снова готова, "2026-10-21". */
  cooldowns?: Partial<Record<AbilityId, string>>;
  /** Молот бури: лягушка дня. */
  frog?: { taskId: string; day: string };
  /** Удар грома: до какого момента идёт серия мелочей и сколько в ней уже задач. */
  clap?: { until: number; count: number };
  /** Аватар: до какого момента и на какой базе удвоена добыча. */
  avatar?: { until: number; baseId: string };
  /** Когда герой пал от истощения; пока задано, героя нет на карте. */
  fallenAt?: number;
}

export type AbilityId = 'stormbolt' | 'thunderclap' | 'bash' | 'avatar';

export interface Settings {
  dayStart: string; // "09:00"
  dayEnd: string; // "18:00"
  workDays: number[]; // 1 = пн ... 7 = вс
  wakeUp: string;
  bedtime: string;
  /** Множители баланса из настроек, по умолчанию 1: добыча и награды, цены, опыт. */
  balance?: Partial<Tuning>;
  /** Режим Легиона из лобби: мирный без демонов, обычный, пылающий (захват с трёх демонов, без тихих дней). */
  legion?: LegionMode;
}

export type LegionMode = 'peace' | 'normal' | 'burning';

export interface Tuning {
  mining: number;
  prices: number;
  xp: number;
}

/** Итоги игрового дня (от подъёма до отбоя) для экрана статистики. */
export interface DayStats {
  day: string;
  gold: number;
  lumber: number;
  done: number;
  /** Урон по вражеским крепостям. */
  damage: number;
  /** Повержено демонов Легиона. */
  demons: number;
  /** Сколько времени шёл таймер героя. */
  workedMs: number;
}

export interface GameState {
  schema: 1;
  /** Номер ревизии: растёт при каждом сохранении в Gist, нужен для защиты от перезаписи. */
  rev: number;
  updatedAt: number;
  resources: { gold: number; lumber: number };
  spheres: Sphere[];
  projects: Project[];
  tasks: Task[];
  /** Герой на дежурстве: работает в текущей смене. */
  hero: Hero;
  /** Остальные герои на алтаре: отдыхают до своей смены. */
  reserve?: Hero[];
  /** Тир главной ратуши: 1 ратуша, 2 крепость, 3 замок (раздел 9). */
  tier?: number;
  farms: number;
  onBreak: boolean;
  /** Когда игрок последний раз подтвердил, что работает (защита от забытого таймера). */
  lastConfirmAt: number;
  lastTick: number;
  /** День последнего рассвета, "2026-10-19": по нему восстанавливается мана. */
  lastDawn: string;
  /** День, когда Легион последний раз считал свои волны (ночью, к рассвету). */
  lastLegionDay?: string;
  /** Долг по дереву за переносы сроков: следующее дерево от планирования идёт на погашение. */
  lumberDebt?: number;
  /** Утреннее планирование: задачи на день, из любых проектов. */
  dayPlan?: { day: string; taskIds: string[] };
  /** Что случилось ночью: показывается на утреннем планировании. */
  nightReport?: { day: string; lines: string[] };
  stats?: DayStats;
  /** Статистика прошлых дней для хранилища тайн, последние 120 дней. */
  statsHistory?: DayStats[];
  /** День, за который итоги уже подведены. */
  summaryDay?: string;
  /** В какой игровой день уже было второе дыхание. */
  secondWindDay?: string;
  /** Глава недели: 2–3 главные цели, отмечаются к концу недели. */
  week?: { start: string; goals: { text: string; done: boolean }[] };
  /** Итоги прошлых глав: сколько целей выполнено. */
  weekHistory?: { start: string; done: number; total: number }[];
  /** Месяц последнего совета земель, "2026-10". */
  councilMonth?: string;
  /** Когда был последний совет: основания для оценок считаются с этого момента. */
  councilAt?: number;
  /** Оценки сфер на каждом совете: как менялись земли. */
  councilHistory?: { month: string; scores: Record<string, number> }[];
  dreadlord?: Dreadlord;
  /** Битва у горы Хиджал: Архимонд пришёл, когда все земли дошли до цели. hp 0 значит повержен. */
  hyjal?: { hp: number; maxHp: number; since: number };
  /** Номер главы кампании: растёт после каждой победы у Хиджала. */
  chapter?: number;
  /** Построенные здания дерева технологий. */
  buildings?: Partial<Record<BuildingId, boolean>>;
  /** Ступени улучшений кузницы, 0–3. */
  smith?: Partial<Record<SmithId, number>>;
  /** Стройка или улучшение в процессе: идёт только пока тикает таймер работы. */
  construction?: { id: TechId; leftMs: number; totalMs: number; gold?: number; lumber?: number };
  /** Зал славы: выигранные миссии, ушедшие с карты. */
  hallOfFame?: Glory[];
  /** Сколько Повелителей ужаса повержено за всё время. */
  dreadlordsSlain?: number;
  /** Когда обучение пройдено или пропущено: после этого само оно не открывается. */
  tutorialDone?: number;
  /** Когда игра настроена в лобби. Пока не задано, вместо карты открыто лобби новой игры. */
  setupDone?: number;
  /** Когда началась игра из лобби: первые дни Легион спит. У старых сохранений нет. */
  startedAt?: number;
  settings: Settings;
}

/** Здания дерева технологий на главной ратуше (раздел 9 дизайна). */
export type BuildingId = 'lumbermill' | 'workshop' | 'blacksmith' | 'towers' | 'aviary' | 'vault';
/** Улучшения кузницы. */
export type SmithId = 'armor' | 'weapons';
/** Всё, что строится или изучается: здания, улучшение ратуши, улучшения кузницы. */
export type TechId = BuildingId | 'keep' | 'castle' | SmithId;

/** Выигранная миссия в зале славы: база ушла с карты, память осталась. */
export interface Glory {
  id: string;
  name: string;
  sphereId: string;
  /** Название сферы на момент победы: сферу могут потом переименовать или удалить. */
  sphereName: string;
  startedAt: number;
  wonAt: number;
  /** Сколько задач сделано в проекте. */
  done: number;
  /** Здоровье павшей крепости. */
  hp: number;
}

/** Повелитель ужаса: командир Легиона, которого совет земель зовёт в отстающую сферу на месяц. */
export interface Dreadlord {
  name: string;
  sphereId: string;
  /** Месяц, до конца которого его надо одолеть, "2026-10". */
  month: string;
  hp: number;
  maxHp: number;
}

/** id главной ратуши: бытовые дела без финала, её нельзя выиграть или потерять. */
export const MAIN_HALL_ID = 'main';
