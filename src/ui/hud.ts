// Интерфейс поверх сцены: верхняя панель ресурсов, свитки, нижняя консоль
// с миникартой, портретом, информацией и сеткой команд 4×3.

import { sounds, UNIT_VOICE } from '../audio/sound';
import { BALANCE, DEMONS, HERO_KINDS, UNITS } from '../state/config';
import {
  activeTaskOf,
  addDays,
  price,
  reward,
  allDemons,
  currentShift,
  daysBetween,
  demonBaseId,
  demonRank,
  demonsAt,
  gameDay,
  idleDays,
  isBlighted,
  isDemon,
  isPlanned,
  isPostpone,
  localDay,
  meteorOf,
  portalSize,
  repairCost,
  rescheduleCost,
  workersHiding,
  foodCap,
  foodUsed,
  idleGuardTripped,
  levelBySpentTime,
  miningFactor,
  REPEAT_NAMES,
  SHIFT_NAMES,
  squadOf,
  summaryDue,
  withSquads,
  weekStart,
  upkeep,
  reviveCost,
  xpForLevel,
  allHeroes,
  dutyOf,
  heroSlots,
  activeBases,
  canThaw,
  overLimitFactor,
  gameMonth,
  activeDreadlord,
  unitHealth,
} from '../state/economy';
import { plural, type GameEvent, type Store } from '../state/store';
import { MAIN_HALL_ID, type AbilityId, type HeroKind, type Level, type Project, type Repeat, type Task } from '../state/types';
import { BANNER_COLORS } from '../scene/base';
import { MAP_HALF, type World } from '../scene/world';
import type { Sync } from '../storage/sync';
import { openSettings } from './modals';
import { ask, openModal } from './modal';
import { openPlanning, openSummary, openWeek } from './day';
import { DEFAULT_FILTER, STATUS_NAMES, filterTasks, isDefaultFilter, type StatusFilter, type TaskFilter } from '../state/filter';
import { ABILITIES, ABILITY_ORDER, SKILL, isMountainKing, avatarActive, canLearn, castBlock, clapActive, cooldownUntil, levelForNextRank, manaCost, rankOf, skillPoints } from '../state/abilities';
import { parseQuick } from '../state/quick';
import { openTriage } from './triage';
import { openSpheres } from './spheres';
import { openBases } from './bases';
import { openCouncil } from './council';
import { openHall } from './hall';
import { openChapter } from './chapter';
import { openVault } from './vault';
import { openLegion } from './legion';
import { openTutorial } from './tutorial';
import {
  BUILDING_ORDER,
  SMITH,
  TECH,
  armorDelay,
  canRepeat,
  canSubtasks,
  hasBuilding,
  isDone,
  maxLevel,
  smithLevel,
  squadLimit,
  techBlock,
  techOf,
  tierOf,
  type TechId,
} from '../state/tech';
import { openProject } from './project';
import { openQuests } from './quests';
import { Portrait3D } from './portrait3d';
import { btnArt, type BtnIcon } from './btn-icons';

type Selection = { kind: 'base'; id: string } | { kind: 'task'; id: string } | { kind: 'hero' } | { kind: 'group'; ids: string[]; hero: boolean };

interface Command {
  icon: string;
  /** Иконка команды из WC3; пока атлас не загружен, на кнопке виден icon. */
  btn?: BtnIcon;
  hotkey: string;
  title: string;
  cost?: string;
  text: string;
  enabled?: boolean;
  run: () => void;
}

/** Иконки зданий и улучшений строительства; у кузницы своя на каждую ступень. */
const TECH_BTN: Record<TechId, BtnIcon | BtnIcon[]> = {
  lumbermill: 'humanlumbermill',
  keep: 'keep',
  workshop: 'workshop',
  blacksmith: 'blacksmith',
  towers: 'guardtower',
  castle: 'castle',
  aviary: 'gryphonaviary',
  vault: 'arcanevault',
  armor: ['humanarmorupone', 'humanarmoruptwo', 'humanarmorupthree'],
  weapons: ['steelmelee', 'thoriummelee', 'arcanitemelee'],
};
/** Способности героев по классам, в порядке клавиш Q W E R. */
const SPELL_BTN: Record<HeroKind, BtnIcon[]> = {
  mountainking: ['stormbolt', 'thunderclap', 'bash', 'avatar'],
  paladin: ['holybolt', 'divineintervention', 'devotion', 'resurrection'],
  archmage: ['blizzard', 'summonwaterelemental', 'brilliance', 'massteleport'],
  bloodmage: ['walloffire', 'banish', 'manadrain', 'markoffire'],
};
const HERO_BTN: Record<HeroKind, BtnIcon> = { mountainking: 'heromountainking', paladin: 'heropaladin', archmage: 'heroarchmage', bloodmage: 'herobloodelfprince' };
const UNIT_BTN: Record<Level, BtnIcon> = { 1: 'footman', 2: 'rifleman', 3: 'knight', 4: 'gryphonrider' };

function techBtn(id: TechId, level = 0): BtnIcon {
  const b = TECH_BTN[id];
  return Array.isArray(b) ? b[Math.min(level, b.length - 1)] : b;
}

/** Содержимое кнопки: иконка WC3 и символ под ней на случай, когда атласа нет. */
function face(icon: string, btn?: BtnIcon): string {
  return btn ? `${btnArt(btn)}<span class="glyph">${icon}</span>` : icon;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Меняет innerHTML только если разметка изменилась: так не сбивается фокус и наведение. */
function setHtml(el: HTMLElement, html: string) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Короткие подписи портретов юнитов в сетке выбранных. */
const UNIT_SHORT: Record<Level, string> = { 1: 'Пх', 2: 'Ст', 3: 'Рц', 4: 'Гр' };

function groupCell(attrs: string, short: string, title: string, health: number): string {
  const k = Math.max(0, Math.min(1, health));
  const color = k > 0.5 ? 'ok' : k > 0.25 ? 'mid' : 'low';
  return `<div class="group-cell" ${attrs} title="${esc(title)}"><span>${short}</span><i class="${color}" style="width:${(k * 100).toFixed(0)}%"></i></div>`;
}

function bar(kind: string, value: number, max: number, label: string): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="bar ${kind}"><span style="width:${pct.toFixed(1)}%"></span><em>${label}</em></div>`;
}

/** Тип атаки и брони юнита по уровню задачи, как на карточке WC3 (иконки ui/ic-*.png). */
const UNIT_COMBAT: Record<Level, { attack: string; armor: string }> = {
  1: { attack: 'melee', armor: 'large' },
  2: { attack: 'piercing', armor: 'medium' },
  3: { attack: 'melee', armor: 'large' },
  4: { attack: 'hero', armor: 'medium' },
};
const ATTACK_NAMES: Record<string, string> = { melee: 'обычная', piercing: 'колющая', hero: 'магическая', chaos: 'хаос' };
const ARMOR_NAMES: Record<string, string> = { medium: 'средняя', large: 'тяжёлая', hero: 'героя', fortified: 'укреплённая' };

/** Сила, ловкость и разум героев людей из WC3: на первом уровне и прибавка за уровень. */
const HERO_STATS: Record<HeroKind, [number, number, number, number, number, number]> = {
  mountainking: [24, 11, 15, 3, 1.5, 1.5],
  paladin: [22, 13, 17, 2.7, 1.5, 1.8],
  archmage: [14, 17, 19, 1.8, 1, 3.2],
  bloodmage: [18, 14, 19, 2, 1, 3],
};

function stat(icon: string, value: string | number, title: string): string {
  return `<span class="stat" title="${esc(title)}"><i class="ic ic-${icon}"></i>${value}</span>`;
}

/** Строка цены подсказки: золото, дерево и мана с иконками, остальное как есть. */
function costHtml(cost: string): string {
  return cost
    .split(', ')
    .map((part) => {
      const m = part.match(/^([+−-]?\d+) (золота|дерева|маны)(.*)$/);
      if (!m) return esc(part);
      const icon = { золота: 'gold', дерева: 'lumber', маны: 'mana' }[m[2]]!;
      return `<span class="price"><i class="ic ic-${icon}"></i>${m[1]}${esc(m[3])}</span>`;
    })
    .join(' ');
}

export class Hud {
  private sel: Selection;
  /** Предметы в инвентаре героя и кнопки у мини-карты (renderConsoleSlots). */
  private slotItems: Command[] = [];
  private mapButtons: Command[] = [];
  /** Мини-карта без рельефа, только значки. */
  private plainMap = false;
  /** Фильтр панели свитков; живёт только в этой вкладке. */
  private filter: TaskFilter = { ...DEFAULT_FILTER };
  private filterProjects = '';
  /** Карточка героя в режиме изучения способностей (O). */
  private learning = false;
  private commands: Command[] = [];
  /** «Позже» на планировании: до следующего игрового дня окно само не откроется. */
  private planLaterDay = '';
  private basesLaterDay = '';
  private councilLaterDay = '';
  private chapterLaterDay = '';
  /** Открыта ли карточка строительства на главной ратуше. */
  private building = false;
  /** «Ещё работаю» на итогах: напомнить снова через полчаса. */
  private summaryLaterUntil = 0;
  private weekLaterStart = '';
  /** Сколько не было игры к моменту загрузки и отметка последнего тика тогда же. */
  private awayMs: number;
  private bootTick: number;
  private legionShown = false;
  /** Долгое нажатие на команду показало подсказку: следующий клик не выполняет её. */
  private longPress = false;
  /** Группы Ctrl+1…9, как в WC3, и последнее нажатие цифры (двойное ведёт камеру). */
  private groups = new Map<number, Selection>();
  private lastGroupKey = { n: 0, at: 0 };
  /** Какая простаивающая база показана последней (F8 перебирает их по кругу). */
  private idleIndex = 0;
  /** Сколько целей недели было выполнено: новая выполненная показывает «Задание выполнено». */
  private weekDone: { start: string; done: number } | null = null;
  private questTimer = 0;
  private heroTap = { i: -1, at: 0 };
  private portrait3d: Portrait3D;

  constructor(
    private store: Store,
    private world: World,
    private sync: Sync,
  ) {
    this.sel = { kind: 'base', id: store.state.hero.baseId };
    this.awayMs = Date.now() - store.state.lastTick;
    this.bootTick = store.state.lastTick;
    world.onSelectBase = (id, building) => {
      if (!id) return;
      this.select({ kind: 'base', id });
      // Ратуша главной базы отвечает голосом своего тира: крепость, замок.
      const hall = id === MAIN_HALL_ID ? (['townhall', 'keep', 'castle'] as const)[tierOf(store.state) - 1] : 'townhall';
      void sounds.selectBuilding(building === 'townhall' || !building ? hall : building);
    };
    world.onSelectTask = (id) => this.pick({ kind: 'task', id });
    world.onSelectHero = () => this.pick({ kind: 'hero' });
    world.onSelectGroup = (ids, hero) => this.pickUnits(ids, hero);
    world.onOrderHero = (id) => store.moveHero(id);
    world.onSelectSame = (ids) => this.pickUnits(ids, false);
    // Shift-клик добавляет юнит к выбору или убирает его, как в WC3.
    world.onToggleUnit = (id) => {
      const sel = this.sel;
      const ids = sel.kind === 'task' ? [sel.id] : sel.kind === 'group' ? [...sel.ids] : [];
      const hero = sel.kind === 'hero' || (sel.kind === 'group' && sel.hero);
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1);
      else ids.push(id);
      if (!ids.length && !hero) this.select({ kind: 'base', id: this.contextBase()?.id ?? MAIN_HALL_ID });
      else this.pickUnits(ids, hero);
    };

    // Говорящая голова героя поверх букв портрета; буквы остаются, пока модели нет.
    $('portrait').innerHTML = '<div id="portrait-face"></div>';
    this.portrait3d = new Portrait3D($('portrait'));
    void this.portrait3d.load().then(() => this.render());
    sounds.onTalk = (voice, seconds) => {
      if (voice === 'heromountainking') this.portrait3d.talk(seconds);
    };

    store.subscribe(() => this.render());
    store.onEvent((e) => this.message(e));
    sync.onChange(() => this.render());

    this.bindStatic();
    this.render();
    window.setInterval(() => this.drawMinimap(), 200);
    world.select(this.sel.kind === 'base' ? this.sel.id : null);
    world.focusBase(store.state.hero.baseId);
  }

  private select(sel: Selection) {
    this.sel = sel;
    this.learning = false;
    this.building = false;
    this.world.select(sel.kind === 'base' ? sel.id : null);
    this.world.selectUnits(sel.kind === 'task' ? [sel.id] : sel.kind === 'group' ? sel.ids : [], sel.kind === 'hero' || (sel.kind === 'group' && sel.hero));
    this.render();
  }

  /** Несколько юнитов (и, может быть, герой): один становится обычным выбором, больше группой. */
  private pickUnits(ids: string[], hero: boolean) {
    if (ids.length + (hero ? 1 : 0) === 1) this.pick(hero ? { kind: 'hero' } : { kind: 'task', id: ids[0] });
    else if (ids.length || hero) this.pick({ kind: 'group', ids, hero });
  }

  /** Камера к выбору: база, герой или первый юнит группы. */
  private focusSelection(sel: Selection) {
    if (sel.kind === 'base') this.world.focusBase(sel.id);
    else if (sel.kind === 'hero' || (sel.kind === 'group' && sel.hero && !sel.ids.length)) this.world.focusHero();
    else this.world.focusUnit(sel.kind === 'task' ? sel.id : sel.ids[0]);
  }

  /** Группа N: Ctrl (или Shift) с цифрой запоминает выбор, цифра вызывает, двойное нажатие ведёт камеру. */
  private groupKey(n: number, save: boolean) {
    if (save) {
      this.groups.set(n, this.sel);
      this.store.say(`Группа ${n} запомнена.`);
      return;
    }
    const g = this.groups.get(n);
    if (!g) return;
    // Сделанные и отменённые задачи из группы выпадают.
    const alive = (id: string) => ['hired', 'active'].includes(this.store.task(id)?.status ?? '');
    let sel: Selection = g;
    if (g.kind === 'task' && !alive(g.id)) return;
    if (g.kind === 'group') {
      const ids = g.ids.filter(alive);
      if (!ids.length && !g.hero) return;
      sel = ids.length + (g.hero ? 1 : 0) === 1 ? (g.hero ? { kind: 'hero' } : { kind: 'task', id: ids[0] }) : { ...g, ids };
    }
    if (g.kind === 'base' && !this.store.project(g.id)) return;
    const now = performance.now();
    const double = this.lastGroupKey.n === n && now - this.lastGroupKey.at < 400;
    this.lastGroupKey = { n, at: now };
    if (double) this.focusSelection(sel);
    else this.pick(sel);
  }

  /** Простаивающие базы: в игре, не захвачены, а в казарме и в бою никого. */
  private idleBases(): Project[] {
    const s = this.store.state;
    const busy = new Set(s.tasks.filter((t) => (t.status === 'hired' || t.status === 'active') && t.projectId).map((t) => t.projectId));
    return activeBases(s).filter((p) => !p.capturedAt && !busy.has(p.id));
  }

  private nextIdleBase() {
    const idle = this.idleBases();
    if (!idle.length) return;
    const p = idle[this.idleIndex++ % idle.length];
    this.select({ kind: 'base', id: p.id });
    this.world.focusBase(p.id);
  }

  /** Кнопки героев слева сверху: F1 герой на дежурстве, F2 и F3 отдыхающие на алтаре. */
  private renderHeroButtons() {
    const s = this.store.state;
    const heroes = [s.hero, ...(s.reserve ?? [])];
    setHtml(
      $('hero-buttons'),
      heroes
        .map((h, i) => {
          const kind = HERO_KINDS[h.kind ?? 'mountainking'];
          const where = i ? `на алтаре, смена: ${dutyOf(s, h.slot ?? 0)}` : `на базе «${this.store.project(h.baseId)?.name ?? ''}»`;
          return (
            `<button class="hero-btn${h.fallenAt ? ' fallen' : ''}${i ? ' resting' : ''}${i === 0 && (this.sel.kind === 'hero' || (this.sel.kind === 'group' && this.sel.hero)) ? ' on' : ''}" data-action="hero-btn" data-id="${i}" ` +
            `title="${esc(`${h.name}, уровень ${h.level}, ${h.fallenAt ? 'пал' : where} (F${i + 1})`)}">` +
            `${btnArt(HERO_BTN[h.kind ?? 'mountainking'])}<span class="face"${h.kind && h.kind !== 'mountainking' ? ` style="color:${kind.tint}"` : ''}>${h.fallenAt ? '☠' : kind.short}</span><b>${h.level}</b>` +
            `<i class="hp" style="width:${h.fallenAt ? 0 : 100}%"></i><i class="mp" style="width:${((h.mana / Math.max(1, h.maxMana)) * 100).toFixed(0)}%"></i></button>`
          );
        })
        .join(''),
    );
    const idle = this.idleBases();
    const btn = $<HTMLButtonElement>('idle-bases');
    btn.hidden = !idle.length;
    const label = `${btnArt('peasant')}<span class="glyph">⛏</span><b>${idle.length}</b>`;
    if (btn.dataset.html !== label) {
      btn.innerHTML = label;
      btn.dataset.html = label;
    }
    btn.title = `Простаивающие базы (F8): ${idle.map((p) => p.name).join(', ')}. В казарме и в бою никого.`;
  }

  private heroButton(i: number) {
    const s = this.store.state;
    const now = performance.now();
    const double = this.heroTap.i === i && now - this.heroTap.at < 400;
    this.heroTap = { i, at: now };
    if (i === 0) {
      if (double) this.world.focusHero();
      else this.pick({ kind: 'hero' });
      return;
    }
    const r = s.reserve?.[i - 1];
    if (!r) return;
    // Отдыхающий герой стоит на алтаре у главной ратуши.
    this.select({ kind: 'base', id: MAIN_HALL_ID });
    this.world.focusBase(MAIN_HALL_ID);
    this.store.say(`${r.name} отдыхает на алтаре. Его смена: ${dutyOf(s, r.slot ?? 0)}.`);
  }

  /** «Задание выполнено» посреди экрана со звуком WC3, когда закрыта цель недели. */
  private checkQuestDone() {
    const s = this.store.state;
    const start = weekStart(s);
    const goals = s.week?.start === start ? s.week.goals : [];
    const done = goals.filter((g) => g.done).length;
    const prev = this.weekDone;
    this.weekDone = { start, done };
    if (!prev || prev.start !== start || done <= prev.done) return;
    const goal = goals.filter((g) => g.done).at(-1);
    const box = $('quest-done');
    box.innerHTML = `<b>Задание выполнено</b><span>${esc(goal?.text ?? '')}</span>`;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    void sounds.play('quest');
    window.clearTimeout(this.questTimer);
    this.questTimer = window.setTimeout(() => box.classList.remove('show'), 4500);
  }

  /** Выбор кликом игрока: юнит или герой откликается голосом, свиток без юнита молчит. */
  private pick(sel: Selection) {
    this.select(sel);
    if (sel.kind === 'hero' || (sel.kind === 'group' && sel.hero)) sounds.select('heromountainking', 'hero');
    else if (sel.kind === 'group') {
      const t = this.store.task(sel.ids[0]);
      if (t?.level) sounds.select(UNIT_VOICE[t.level], t.id);
    } else if (sel.kind === 'task') {
      const t = this.store.task(sel.id);
      if (t?.level && (t.status === 'hired' || t.status === 'active')) sounds.select(UNIT_VOICE[t.level], t.id);
    }
  }

  /** База, к которой относится текущий выбор. */
  private contextBase(): Project | undefined {
    const s = this.sel;
    if (s.kind === 'base') return this.store.project(s.id);
    if (s.kind === 'task' || (s.kind === 'group' && s.ids.length)) {
      const t = this.store.task(s.kind === 'task' ? s.id : s.ids[0]);
      if (t?.projectId) return this.store.project(t.projectId);
    }
    return this.store.project(this.store.state.hero.baseId);
  }

  // ---------- Обработчики ----------

  private bindStatic() {
    const form = $<HTMLFormElement>('new-scroll');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.elements.namedItem('title') as HTMLInputElement;
      const q = parseQuick(this.store.state, input.value);
      if (!q.title) return;
      const t = this.store.addTask(q.title, q.projectId, q.projectId ? q.level : null);
      if (q.due) this.store.setDue(t.id, q.due);
      if (q.projectId && !q.level) t.projectId = q.projectId;
      input.value = '';
      if (t.status === 'inbox') this.store.say('Новый свиток у ратуши. Укажи проект и уровень, чтобы нанять юнита.');
      this.select({ kind: 'task', id: t.id });
    });

    const q = $<HTMLInputElement>('filter-q');
    const level = $<HTMLSelectElement>('filter-level');
    const status = $<HTMLSelectElement>('filter-status');
    level.innerHTML =
      '<option value="">Ур. все</option>' +
      ([1, 2, 3, 4] as Level[]).map((l) => `<option value="${l}">Ур. ${l}</option>`).join('') +
      '<option value="0">Без ур.</option>';
    status.innerHTML = (Object.keys(STATUS_NAMES) as StatusFilter[]).map((k) => `<option value="${k}">${STATUS_NAMES[k]}</option>`).join('');
    const readFilter = () => {
      this.filter = {
        q: q.value,
        projectId: $<HTMLSelectElement>('filter-project').value,
        level: level.value,
        status: status.value as StatusFilter,
      };
      this.renderSide();
    };
    q.addEventListener('input', readFilter);
    $('side-filter').addEventListener('change', readFilter);

    document.body.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el) return;
      const a = el.dataset.action!;
      const id = el.dataset.id ?? '';
      if (a === 'open-settings') openSettings(this.store, this.sync);
      else if (a === 'open-quests') openQuests(this.store);
      else if (a === 'idle-base') this.nextIdleBase();
      else if (a === 'hero-btn') this.heroButton(Number(id));
      else if (a === 'toggle-side') $('side').classList.toggle('hidden');
      else if (a === 'select-task') this.pick({ kind: 'task', id });
      else if (a === 'select-hero') this.pick({ kind: 'hero' });
      else if (a === 'slot') this.slotItems[Number(id)]?.run();
      else if (a === 'map-btn' && this.mapButtons[Number(id)]?.enabled !== false) this.mapButtons[Number(id)]?.run();
      else if (a === 'confirm') this.store.confirmWorking();
      else if (a === 'cmd') {
        if (this.longPress) this.longPress = false;
        else if (this.commands[Number(id)]?.enabled !== false) this.commands[Number(id)]?.run();
      }
      else if (a === 'hire-level') this.hireSelected(Number(el.dataset.level) as Level);
      else if (a === 'week-goal') this.store.toggleWeekGoal(Number(el.dataset.i));
      else if (a === 'triage') openTriage(this.store);
      else if (a === 'open-legion') openLegion(this.store);
      else if (a === 'open-tutorial') openTutorial(this.store);
      else if (a === 'reset-filter') this.resetFilter();
      else if (a === 'revive') this.store.revive();
      else if (a === 'open-spheres') openSpheres(this.store);
      else if (a === 'open-bases') openBases(this.store);
      else if (a === 'open-council') openCouncil(this.store);
      else if (a === 'open-hall') openHall(this.store);
      else if (a === 'open-chapter') openChapter(this.store);
      else if (a === 'open-vault') {
        if (hasBuilding(this.store.state, 'vault')) openVault(this.store);
        else this.store.say('Статистика хранится в хранилище тайн: его можно построить в замке.', 'warn');
      }
      else if (a === 'focus-hyjal') {
        this.select({ kind: 'base', id: MAIN_HALL_ID });
        this.world.focusBase(MAIN_HALL_ID);
      }
      else if (a === 'enshrine') {
        this.store.enshrine(id);
        this.select({ kind: 'base', id: MAIN_HALL_ID });
        openHall(this.store);
      }
      else if (a === 'focus-dread') {
        const d = activeDreadlord(this.store.state);
        const p = d && this.store.state.projects.find((x) => x.sphereId === d.sphereId && x.id !== MAIN_HALL_ID && !x.frozen);
        if (p) {
          this.select({ kind: 'base', id: p.id });
          this.world.focusBase(p.id);
        }
      }
      else if (a === 'edit-project' || a === 'new-project')
        openProject(this.store, a === 'edit-project' ? id : null, (pid) => {
          this.select({ kind: 'base', id: pid ?? MAIN_HALL_ID });
          if (pid) this.world.focusBase(pid);
        });
      else if (a === 'learn') {
        this.select({ kind: 'hero' });
        this.learning = true;
        this.render();
      }
    });

    document.body.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === 'task-due' && this.sel.kind === 'task') {
        const t = this.store.task(this.sel.id);
        if (t) void this.changeDue(t, el.value || null);
      }
      if (el.id === 'task-repeat' && this.sel.kind === 'task') this.store.setRepeat(this.sel.id, (el.value || null) as Repeat | null);
    });

    $('command-card').addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.cmd[data-id]');
      this.tooltip(el ? this.commands[Number(el.dataset.id)] : undefined);
    });
    $('command-card').addEventListener('mouseleave', () => this.tooltip(undefined));
    for (const [box, sel, list] of [
      ['inventory', '.inv-slot[data-id]', () => this.slotItems],
      ['minimap-buttons', '.map-btn[data-id]', () => this.mapButtons],
    ] as const) {
      $(box).addEventListener('mouseover', (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
        this.tooltip(el ? list()[Number(el.dataset.id)] : undefined);
      });
      $(box).addEventListener('mouseleave', () => this.tooltip(undefined));
    }
    // На телефоне подсказка по долгому нажатию, и тогда команда не срабатывает.
    let press: number | undefined;
    $('command-card').addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.cmd[data-id]');
      if (e.pointerType !== 'touch' || !el) return;
      this.longPress = false;
      press = window.setTimeout(() => {
        this.longPress = true;
        this.tooltip(this.commands[Number(el.dataset.id)]);
      }, 450);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
      $('command-card').addEventListener(ev, () => window.clearTimeout(press));
    $('command-card').addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const modal = document.getElementById('modal-root')!;
      // F9 открывает и закрывает журнал заданий, как в WC3.
      if (e.key === 'F9') {
        e.preventDefault();
        if (modal.querySelector('.quests')) modal.innerHTML = '';
        else if (!modal.childElementCount) openQuests(this.store);
        return;
      }
      if (modal.childElementCount) return;
      // Свитки: клавиша Ё (слева от единицы), где бы ни стояла раскладка.
      if (e.code === 'Backquote') {
        e.preventDefault();
        $('side').classList.toggle('hidden');
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        this.nextIdleBase();
        return;
      }
      if (e.key === 'F2' || e.key === 'F3') {
        e.preventDefault();
        this.heroButton(Number(e.key[1]) - 1);
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        e.preventDefault();
        this.groupKey(Number(digit[1]), true);
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        $('side').classList.remove('hidden');
        $('filter-q').focus();
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        openSettings(this.store, this.sync);
        return;
      }
      // Пробел и F1, как в WC3: камера к герою, F1 заодно выбирает его.
      if (e.key === ' ' || e.key === 'F1') {
        e.preventDefault();
        if (e.key === 'F1') this.pick({ kind: 'hero' });
        this.world.focusHero();
        return;
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const cmd = this.commands.find((c) => c.hotkey === key || (key === 'Escape' && c.hotkey === 'Esc'));
      if (cmd && cmd.enabled !== false) {
        e.preventDefault();
        cmd.run();
      } else if (digit && !cmd && !e.altKey) {
        // Цифра без команды с такой клавишей вызывает группу.
        e.preventDefault();
        this.groupKey(Number(digit[1]), false);
      }
    });

    // Двойной щелчок (или двойное касание) по портрету ведёт камеру к герою.
    let portraitTap = 0;
    $('portrait').addEventListener('pointerup', () => {
      const now = performance.now();
      if (now - portraitTap < 350) {
        this.world.focusHero();
        portraitTap = 0;
      } else portraitTap = now;
    });

    // Мини-карта, как в WC3: щелчок ставит камеру в точку, протяжка ведёт её следом за мышью.
    const mini = $<HTMLCanvasElement>('minimap');
    const jump = (e: PointerEvent) => {
      const r = mini.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 * MAP_HALF - MAP_HALF;
      const z = MAP_HALF - ((e.clientY - r.top) / r.height) * 2 * MAP_HALF;
      this.world.lookAt(x, z);
      this.drawMinimap();
    };
    mini.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      mini.setPointerCapture(e.pointerId);
      jump(e);
    });
    mini.addEventListener('pointermove', (e) => {
      if (mini.hasPointerCapture(e.pointerId)) jump(e);
    });
  }

  private hireSelected(level: Level) {
    if (this.sel.kind !== 'task') return;
    const t = this.store.task(this.sel.id);
    const select = document.getElementById('hire-project') as HTMLSelectElement | null;
    const projectId = select?.value || t?.projectId;
    if (!t || !projectId) return;
    this.store.hire(t.id, projectId, level);
  }

  private async completeTask(t: Task) {
    let corrected: Level | undefined;
    // Калибровка: если по таймеру задача шла заметно дольше уровня, спрашиваем.
    const byTime = levelBySpentTime(t.spentMs);
    if (t.level && byTime > t.level) {
      const answer = await ask(
        'Калибровка',
        `Задача шла ${clock(t.spentMs)}. Это был ${UNITS[byTime].name.toLowerCase()}?`,
        [
          { label: `Да, ${UNITS[byTime].name}`, value: 'yes' },
          { label: `Нет, ${UNITS[t.level].name}`, value: 'no' },
        ],
      );
      if (answer === 'yes') corrected = byTime;
    }
    this.store.complete(t.id, corrected);
  }

  /** Новый срок. Если это перенос, сначала спрашиваем, ведь он стоит дерева. */
  private async changeDue(t: Task, due: string | null) {
    if (isPostpone(t, due)) {
      const cost = rescheduleCost(t);
      const s = this.store.state;
      const short = cost > Math.floor(s.resources.lumber) ? ` Дерева не хватает: недостающее уйдёт в долг, его погасит следующее дерево за план.` : '';
      const answer = await ask(
        'Перенос срока',
        `Перенос это перепланирование, он стоит ${cost} дерева.${short}`,
        [
          { label: 'Перенести', value: 'yes' },
          { label: 'Отмена', value: 'no' },
        ],
      );
      if (answer !== 'yes') return this.render();
    }
    this.store.setDue(t.id, due);
  }

  /** Новый юнит в отряд: название и уровень. */
  private subtaskDialog(parent: Task) {
    let level: Level = 1;
    const { root, close } = openModal(
      `<h3>Отряд: ${esc(parent.title)}</h3>` +
        `<label>Подзадача</label><input name="title" maxlength="200" placeholder="Например: прочитать главу 1">` +
        `<label>Уровень</label><div class="levels">${([1, 2, 3, 4] as Level[])
          .map((l) => {
            const locked = l > maxLevel(this.store.state);
            return `<button class="btn${l === 1 ? ' on' : ''}" data-l="${l}" title="${locked ? 'Нужно грифонье гнездо' : UNITS[l].hint}"${locked ? ' disabled' : ''}>${l}. ${UNITS[l].name}</button>`;
          })
          .join('')}</div>` +
        `<div class="actions"><button class="btn" data-a="cancel">Закрыть</button><button class="btn" data-a="more">Ещё один</button><button class="btn" data-a="ok">В отряд</button></div>`,
    );
    const input = root.querySelector('[name="title"]') as HTMLInputElement;
    input.focus();
    root.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) =>
      b.addEventListener('click', () => {
        level = Number(b.dataset.l) as Level;
        root.querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    const add = () => {
      if (!input.value.trim()) return false;
      this.store.addSubtask(parent.id, input.value, level);
      input.value = '';
      input.focus();
      return true;
    };
    root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    root.querySelector('[data-a="more"]')!.addEventListener('click', add);
    root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
      add();
      close();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
      if (e.key === 'Escape') close();
    });
  }

  /** Окно переноса срока с выбором даты. */
  private rescheduleDialog(t: Task) {
    const tomorrow = localDay(new Date(Date.now() + 86_400_000));
    const demon = isDemon(t);
    const { root, close } = openModal(
      `<h3>${demon ? 'Отбиться переносом' : 'Срок задачи'}</h3>` +
        `<div>${esc(t.title)}</div>` +
        `<label>Новый срок</label><input type="date" name="due" value="${t.due && t.due >= tomorrow ? t.due : tomorrow}">` +
        `<div class="hint">${demon || t.due ? `Перенос стоит ${rescheduleCost(t)} дерева.` : 'Поставить срок бесплатно.'} Без срока задача не станет демоном.</div>` +
        `<div class="actions">${t.due ? '<button class="btn" data-a="clear" style="margin-right:auto">Убрать срок</button>' : ''}` +
        `<button class="btn" data-a="cancel">Отмена</button><button class="btn" data-a="ok">Готово</button></div>`,
    );
    root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    root.querySelector('[data-a="clear"]')?.addEventListener('click', () => {
      close();
      void this.changeDue(t, null);
    });
    root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
      const v = (root.querySelector('[name="due"]') as HTMLInputElement).value;
      close();
      if (v) void this.changeDue(t, v);
    });
  }

  // ---------- Отрисовка ----------

  render() {
    this.renderTop();
    this.renderSide();
    this.renderPortrait();
    this.renderInfo();
    this.renderCard();
    this.renderConsoleSlots();
    this.renderHeroButtons();
    this.renderGuard();
    this.checkQuestDone();
    this.autoDialogs();
  }

  /**
   * Пустые клетки консоли WC3 получают дело. Инвентарь героя: то, что он сейчас несёт
   * (лягушка дня, план, цели недели, действующая способность) и добытые трофеи.
   * Кнопки у мини-карты ведут камеру к герою, ратуше, бою и Легиону, последняя
   * переключает мини-карту между рельефом и простой схемой.
   */
  private renderConsoleSlots() {
    const s = this.store.state;
    const now = Date.now();
    const items: Command[] = [];
    const frog = s.hero.frog?.day === gameDay(s) ? this.store.task(s.hero.frog.taskId) : undefined;
    if (frog && frog.status !== 'done' && frog.status !== 'cancelled')
      items.push({ icon: '🐸', btn: 'stormbolt', hotkey: '', title: 'Лягушка дня', text: `«${frog.title}». Сделай её первой из серьёзных задач.`, run: () => this.pick({ kind: 'task', id: frog.id }) });
    const plan = s.dayPlan?.day === gameDay(s) ? s.dayPlan.taskIds : [];
    if (plan.length) {
      const done = plan.filter((id) => this.store.task(id)?.status === 'done').length;
      items.push({ icon: '📜', btn: 'scroll', hotkey: `${done}/${plan.length}`, title: 'План на день', text: `Сделано ${done} из ${plan.length}. Открыть планирование.`, run: () => openPlanning(this.store) });
    }
    const goals = s.week?.start === weekStart(s) ? s.week.goals : [];
    if (goals.length) {
      const done = goals.filter((g) => g.done).length;
      items.push({ icon: '🎯', btn: 'glyph', hotkey: `${done}/${goals.length}`, title: 'Цели недели', text: goals.map((g) => `${g.done ? '✓' : '·'} ${g.text}`).join('\n'), run: () => openWeek(this.store) });
    }
    if (avatarActive(s, s.hero.baseId, now))
      items.push({ icon: '⚡', btn: 'avatar', hotkey: `${Math.ceil((s.hero.avatar!.until - now) / 60_000)}м`, title: 'Аватар', text: 'Глубокий фокус: добыча на базе героя удвоена.', run: () => this.pick({ kind: 'hero' }) });
    else if (clapActive(s, now))
      items.push({ icon: '🔨', btn: 'thunderclap', hotkey: `×${s.hero.clap!.count}`, title: 'Удар грома', text: `Серия мелочей, ещё ${Math.ceil((s.hero.clap!.until - now) / 60_000)} мин.`, run: () => this.pick({ kind: 'hero' }) });
    const wins = (s.hallOfFame?.length ?? 0) + s.projects.filter((p) => p.id !== MAIN_HALL_ID && p.fortressMaxHp > 0 && p.fortressHp === 0).length;
    if (wins) items.push({ icon: '🏆', btn: 'chestofgold', hotkey: String(wins), title: 'Трофеи', text: `Выигранных миссий: ${wins}. Открыть зал славы.`, run: () => openHall(this.store) });
    if (s.dreadlordsSlain) items.push({ icon: '💀', btn: 'herodreadlord', hotkey: String(s.dreadlordsSlain), title: 'Черепа повелителей ужаса', text: `Повержено повелителей ужаса: ${s.dreadlordsSlain}.`, run: () => openHall(this.store) });
    this.slotItems = items.slice(0, 6);
    let html = '';
    for (let i = 0; i < 6; i++) {
      const c = this.slotItems[i];
      html += c ? `<button class="inv-slot" data-action="slot" data-id="${i}" aria-label="${esc(c.title)}">${face(c.icon, c.btn)}${c.hotkey ? `<b>${esc(c.hotkey)}</b>` : ''}</button>` : '<div class="inv-slot empty"></div>';
    }
    setHtml($('inventory'), html);

    const demons = new Map<string, number>();
    for (const t of allDemons(s)) demons.set(demonBaseId(t), (demons.get(demonBaseId(t)) ?? 0) + 1);
    const demonBase = [...demons.entries()].sort((a, b) => b[1] - a[1])[0];
    const fight = s.projects.find((p) => activeTaskOf(s, p.id));
    this.mapButtons = [
      { icon: '♔', hotkey: 'F1', title: 'Герой', text: 'Камера к герою (пробел или F1).', run: () => this.world.focusHero() },
      { icon: '⌂', hotkey: '', title: 'Главная ратуша', text: 'Камера к главной ратуше.', run: () => this.world.focusBase(MAIN_HALL_ID) },
      { icon: '⚔', hotkey: '', title: 'Бой', text: fight ? `Камера к базе «${fight.name}», где идёт задача.` : 'Сейчас ни одна задача не в работе.', enabled: !!fight, run: () => fight && this.world.focusBase(fight.id) },
      { icon: '☠', hotkey: '', title: 'Легион', text: demonBase ? `Камера к базе, где больше всего демонов (${demonBase[1]}).` : 'Демонов Легиона на карте нет.', enabled: !!demonBase, run: () => demonBase && this.world.focusBase(demonBase[0]) },
      { icon: '◐', hotkey: '', title: this.plainMap ? 'Мини-карта: рельеф' : 'Мини-карта: схема', text: this.plainMap ? 'Показать на мини-карте землю и лес.' : 'Показать только базы, героя и демонов, без рельефа.', run: () => ((this.plainMap = !this.plainMap), this.render()) },
    ];
    setHtml(
      $('minimap-buttons'),
      this.mapButtons
        .map((c, i) => {
          // Иконки кнопок мини-карты людей; без текстур остаются значки.
          const art = ['ping', 'ally', 'formation', 'creep', this.plainMap ? 'terrain-off' : 'terrain'][i];
          return `<button class="map-btn mm-${art}${i === 4 ? ' round' : ''}${c.enabled === false ? ' off' : ''}" data-action="map-btn" data-id="${i}" aria-label="${esc(c.title)}"><span>${c.icon}</span></button>`;
        })
        .join(''),
    );
  }

  /** Утром само открывается планирование, а перед отбоем итоги дня. */
  private autoDialogs() {
    if (document.getElementById('modal-root')!.childElementCount) return;
    const s = this.store.state;
    const day = gameDay(s);
    const week = weekStart(s);
    // До первого тика окна не открываются: он догоняет время, пока игры не было,
    // и ночной подсчёт приводит демонов.
    if (s.lastTick === this.bootTick) return;
    // Первый запуск: сначала короткое обучение.
    if (!s.tutorialDone) {
      openTutorial(this.store);
    } else if (!this.legionShown && this.awayMs >= BALANCE.returnScreenDays * 86_400_000 && allDemons(s).length) {
      this.legionShown = true;
      openLegion(this.store, Math.floor(this.awayMs / 86_400_000));
    } else if (s.hyjal && s.hyjal.hp === 0 && this.chapterLaterDay !== day) {
      openChapter(this.store, () => (this.chapterLaterDay = day));
    } else if (activeBases(s).length > BALANCE.activeBasesLimit && this.basesLaterDay !== day) {
      // Баз в игре больше лимита: раз в день предлагаем выбрать, какие вести.
      openBases(this.store, () => (this.basesLaterDay = day));
    } else if (s.lastLegionDay && s.councilMonth !== gameMonth(s) && this.councilLaterDay !== day && !summaryDue(s)) {
      // Совет земель в начале месяца, «позже» откладывает его до завтра.
      openCouncil(this.store, () => (this.councilLaterDay = day));
    } else if (s.lastLegionDay && s.week?.start !== week && this.weekLaterStart !== week && !summaryDue(s)) {
      openWeek(this.store, () => (this.weekLaterStart = week));
    } else if (s.lastLegionDay && s.dayPlan?.day !== day && this.planLaterDay !== day && !summaryDue(s)) {
      openPlanning(this.store, () => (this.planLaterDay = day));
    } else if (summaryDue(s) && Date.now() > this.summaryLaterUntil) {
      openSummary(this.store, () => (this.summaryLaterUntil = Date.now() + 30 * 60_000));
    }
  }

  /**
   * Окошко содержания. Когда баз в игре больше лимита, армия растянута, и вместо
   * содержания здесь счётчик баз красным. Клик открывает выбор баз в игре.
   */
  private upkeepBadge(label: string, cls: string): string {
    const s = this.store.state;
    const n = activeBases(s).length;
    const limit = BALANCE.activeBasesLimit;
    const f = overLimitFactor(s);
    return f < 1
      ? `<span class="upkeep high link" data-action="open-bases" title="Армия растянута: добыча −${Math.round((1 - f) * 100)}%. Законсервируй лишние базы.">Баз ${n} из ${limit}</span>`
      : `<span class="upkeep ${cls} link" data-action="open-bases" title="${label}. Баз в игре ${n} из ${limit}: нажми, чтобы выбрать.">${label}</span>`;
  }

  private renderTop() {
    const s = this.store.state;
    const up = upkeep(s);
    const used = foodUsed(s);
    const cap = foodCap(s);
    const upClass = up.factor === 1 ? '' : up.factor >= 0.7 ? 'low' : 'high';
    const syncLabel = { local: 'Сохранено в браузере', syncing: 'Синхронизация…', synced: 'Сохранено в Gist', error: navigator.onLine ? 'Ошибка Gist' : 'Без сети' }[this.sync.status];
    // Короткая подпись для узкого окошка верхней полосы (планшет стоя).
    const syncShort = { local: 'В браузере', syncing: 'Синхр…', synced: 'В Gist', error: navigator.onLine ? 'Ошибка' : 'Без сети' }[this.sync.status];
    setHtml(
      $('resources'),
      `<span class="res" title="Золото"><i class="gold"></i>${Math.floor(s.resources.gold)}</span>` +
        `<span class="res" title="Дерево"><i class="lumber"></i>${Math.floor(s.resources.lumber)}${s.lumberDebt ? ` <em class="debt" title="Долг за переносы сроков">долг ${s.lumberDebt}</em>` : ''}</span>` +
        `<span class="res${used >= cap ? ' over' : ''}" title="Еда: задачи в работе"><i class="food"></i>${used}/${cap}</span>` +
        this.upkeepBadge(up.label, upClass) +
        `<span class="res sync" title="${esc(this.sync.error || syncLabel)}"><span class="long">${syncLabel}</span><span class="short">${syncShort}</span></span>`,
    );
    // На консоли WC3 окошка для сохранения нет: оно точкой на кнопке «Меню» и в её подсказке.
    const menu = $('menu-btn');
    menu.dataset.sync = this.sync.status;
    menu.title = `Настройки (F10) · ${this.sync.error || syncLabel}`;
    const now = new Date();
    setHtml($('clock'), `<b>${now.toTimeString().slice(0, 5)}</b><span class="shift"> · ${SHIFT_NAMES[currentShift(s, now)]}</span>`);
    this.renderDial(now, SHIFT_NAMES[currentShift(s, now)]);
  }

  /**
   * Солнечные часы в центре верхней полосы, как в WC3: колесо с солнцем и луной
   * поворачивается по времени суток (солнце наверху в полдень), небо в окошке
   * светлеет к утру и темнеет к ночи.
   */
  private renderDial(now: Date, shift: string) {
    const dial = $('daydial');
    const h = now.getHours() + now.getMinutes() / 60;
    const turn = `rotate(${(((h - 12) / 24) * 360).toFixed(1)}deg)`;
    const wheel = dial.firstElementChild as HTMLElement;
    if (wheel.style.transform !== turn) wheel.style.transform = turn;
    // С текстурой индикатора людей полоса «солнце, луна, солнце» едет за окошком: в полдень
    // в центре солнце, в полночь луна.
    dial.style.setProperty('--dial-u', (((h - 12 + 24) % 24) / 24).toFixed(4));
    dial.style.setProperty('--sky', skyAt(h));
    const title = `${shift} · ${now.toTimeString().slice(0, 5)}`;
    if (dial.title !== title) dial.title = title;
  }

  private taskRow(t: Task, withProject = false): string {
    const selected = this.sel.kind === 'task' && this.sel.id === t.id ? ' selected' : '';
    const closed = t.status === 'done' ? ' closed' : t.status === 'cancelled' ? ' closed cancelled' : '';
    const where = withProject && t.projectId && t.status !== 'active' ? ` <span class="proj-tag">${esc(this.store.project(t.projectId)?.name ?? '')}</span>` : '';
    const lvl = t.level ? `<span class="lvl">${t.level}</span>` : '<span class="lvl none">?</span>';
    const proj = t.projectId && t.status === 'active' ? ` <span class="active">⚔ ${esc(this.store.project(t.projectId)?.name ?? '')}</span>` : '';
    const demon = isDemon(t) ? ` <span class="demon-tag" title="${DEMONS[demonRank(t)].name}">☠${demonRank(t)}</span>` : '';
    const due = !isDemon(t) && t.due ? ` <span class="due${t.due < localDay() ? ' late' : ''}">${t.due.slice(8)}.${t.due.slice(5, 7)}</span>` : '';
    const plan = isPlanned(this.store.state, t) ? '<span class="plan-mark" title="В плане на сегодня">★</span>' : '';
    const squad = squadOf(this.store.state, t.id);
    const sq = squad.length ? ` <span class="squad-tag" title="Отряд: выполнено ${squad.filter((x) => x.status === 'done').length} из ${squad.length}">⚑${squad.filter((x) => x.status === 'done').length}/${squad.length}</span>` : '';
    const child = t.parentId ? '<span class="sub">↳</span>' : '';
    const rep = t.repeat ? ` <span class="repeat-tag" title="Повтор ${REPEAT_NAMES[t.repeat]}, серия ${t.streak ?? 0}">🔁${t.streak ? t.streak : ''}</span>` : '';
    return `<div class="task${selected}${closed}${isDemon(t) ? ' demon' : ''}" data-action="select-task" data-id="${t.id}">${child}${lvl}${plan}<span class="t">${esc(t.title)}</span>${rep}${sq}${proj}${where}${demon}${due}</div>`;
  }

  private resetFilter() {
    this.filter = { ...DEFAULT_FILTER };
    $<HTMLInputElement>('filter-q').value = '';
    $<HTMLSelectElement>('filter-level').value = '';
    $<HTMLSelectElement>('filter-status').value = 'open';
    $<HTMLSelectElement>('filter-project').value = '';
    this.renderSide();
  }

  /** Список проектов в фильтре пересобирается, только когда проекты поменялись. */
  private syncFilterProjects() {
    const s = this.store.state;
    const sig = s.projects.map((p) => p.id + ':' + p.name).join('|');
    if (sig === this.filterProjects) return;
    this.filterProjects = sig;
    const sel = $<HTMLSelectElement>('filter-project');
    sel.innerHTML =
      '<option value="">Все проекты</option>' +
      s.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') +
      '<option value="-">Без проекта</option>';
    sel.value = s.projects.some((p) => p.id === this.filter.projectId) || this.filter.projectId === '-' ? this.filter.projectId : '';
  }

  private renderSide() {
    this.syncFilterProjects();
    if (!isDefaultFilter(this.filter)) return this.renderSearch();
    const s = this.store.state;
    const base = this.contextBase();
    // Свиток, ставший демоном, виден только в Легионе, чтобы не двоился.
    const inbox = s.tasks.filter((t) => t.status === 'inbox' && !isDemon(t));
    const active = s.tasks.filter((t) => t.status === 'active');
    const hired = base ? withSquads(s.tasks.filter((t) => t.status === 'hired' && t.projectId === base.id)) : [];
    const doneHere = base ? s.tasks.filter((t) => t.status === 'done' && t.projectId === base.id).length : 0;
    const list = (ts: Task[], empty: string) => (ts.length ? ts.map((t) => this.taskRow(t)).join('') : `<div class="empty">${empty}</div>`);
    const today = localDay();
    const demons = allDemons(s).sort((a, b) => demonRank(b, today) - demonRank(a, today));
    const planned = s.dayPlan?.day === gameDay(s) ? s.dayPlan.taskIds.map((id) => this.store.task(id)).filter((t): t is Task => !!t && t.status !== 'cancelled') : [];
    setHtml(
      $('side-list'),
      this.hyjalCard() +
      this.dreadlordCard() +
      (demons.length
        ? `<div class="group-title legion">Пылающий Легион · ${demons.length}<span class="group-btn" data-action="open-legion" title="Вся армия Легиона в одном окне: каждого сделать, перенести или изгнать">к бою</span></div>${list(demons, '')}`
        : '') +
      (s.week?.goals.length
        ? `<div class="group-title">Глава недели · ${s.week.goals.filter((g) => g.done).length}/${s.week.goals.length}</div>` +
          s.week.goals
            .map((g, i) => `<div class="task week-goal${g.done ? ' done' : ''}" data-action="week-goal" data-i="${i}" title="Щёлкни, чтобы отметить"><span class="lvl">${g.done ? '✔' : '❖'}</span><span class="t">${esc(g.text)}</span></div>`)
            .join('')
        : '') +
      (planned.length ? `<div class="group-title">План на сегодня · ${planned.filter((t) => t.status === 'done').length}/${planned.length}</div>${list(planned, '')}` : '') +
        `<div class="group-title">Входящие · ${inbox.length}${portalSize(s) ? ' <span class="portal-tag" title="Неразобранные свитки старше ' + BALANCE.portalScrollDays + ' дней открыли портал у главной ратуши">· портал Легиона</span>' : ''}${inbox.length ? '<span class="group-btn" data-action="triage" title="Разобрать все свитки разом (J на базе)">разобрать</span>' : ''}</div>${list(inbox, 'Пусто. Новые дела пиши в поле выше.')}` +
        `<div class="group-title">В работе · ${active.length}</div>${list(active, 'Ни один юнит не в бою.')}` +
        (base
          ? `<div class="group-title">Казарма: ${esc(base.name)} · ${hired.length}</div>${list(hired, 'Нет нанятых юнитов.')}` +
            `<div class="empty" style="margin-top:6px">Выполнено на базе: ${doneHere}</div>`
          : ''),
    );
  }

  /** Битва у Хиджала в панели свитков: Архимонд и его здоровье. */
  private hyjalCard(): string {
    const h = this.store.state.hyjal;
    if (!h) return '';
    return (
      `<div class="group-title hyjal">Битва у горы Хиджал</div>` +
      `<div class="dread-card hyjal" data-action="${h.hp > 0 ? 'focus-hyjal' : 'open-chapter'}" title="Любая сделанная задача бьёт по Архимонду уроном своего уровня.">` +
      (h.hp > 0
        ? `<div><b>Архимонд</b> у главной ратуши</div>${bar('hyjal', h.hp, h.maxHp, `${h.hp} / ${h.maxHp}`)}<div class="dread-left">бей любыми задачами</div>`
        : `<div><b>Архимонд повержен!</b></div><div class="dread-left">Щёлкни, чтобы начать новую главу</div>`) +
      `</div>`
    );
  }

  /** Повелитель ужаса месяца в панели свитков: где он, сколько здоровья, сколько дней осталось. */
  private dreadlordCard(): string {
    const s = this.store.state;
    const d = activeDreadlord(s);
    if (!d) return '';
    const sphere = s.spheres.find((x) => x.id === d.sphereId);
    const [y, m] = d.month.split('-').map(Number);
    const left = daysBetween(gameDay(s), localDay(new Date(y, m, 0)));
    return (
      `<div class="group-title dread">Повелитель ужаса</div>` +
      `<div class="dread-card" data-action="focus-dread" title="Каждая задача земли «${esc(sphere?.name ?? '')}» бьёт по нему уроном своего уровня. Награда: ${BALANCE.dreadlordXp} опыта и ${BALANCE.dreadlordGold} золота.">` +
      `<div><b>${esc(d.name)}</b> в земле «${esc(sphere?.name ?? '?')}»</div>` +
      bar('dread', d.hp, d.maxHp, `${d.hp} / ${d.maxHp}`) +
      `<div class="dread-left">${left > 0 ? `уйдёт через ${left} ${plural(left, 'день', 'дня', 'дней')}` : 'уйдёт этой ночью'}</div>` +
      `</div>`
    );
  }

  /** Выдача поиска вместо обычных групп, пока фильтр не сброшен. */
  private renderSearch() {
    const found = filterTasks(this.store.state, this.filter);
    const shown = found.slice(0, 100);
    setHtml(
      $('side-list'),
      `<div class="group-title">Найдено · ${found.length}<span class="group-btn" data-action="reset-filter" title="Сбросить поиск и фильтры">сбросить</span></div>` +
        (shown.length ? shown.map((t) => this.taskRow(t, true)).join('') : '<div class="empty">Ничего не найдено.</div>') +
        (found.length > shown.length ? `<div class="empty">Показаны первые ${shown.length}. Уточни поиск.</div>` : ''),
    );
  }

  private renderPortrait() {
    const h = this.store.state.hero;
    const points = skillPoints(h);
    this.portrait3d.setVisible(isMountainKing(h) && !h.fallenAt);
    setHtml(
      $('portrait-face'),
      `<span data-action="select-hero" class="${h.fallenAt ? 'fallen' : ''}" ${isMountainKing(h) ? '' : ` style="color:${HERO_KINDS[h.kind!].tint}"`} title="${esc(h.name)}${h.fallenAt ? ': пал' : ''}">${h.fallenAt ? '☠' : HERO_KINDS[h.kind ?? 'mountainking'].short}</span>` +
        (points ? `<b class="skill-badge" data-action="learn" title="Очков навыка: ${points}">+</b>` : ''),
    );
    setHtml(
      $('hero-bars'),
      bar('mana', h.mana, h.maxMana, `${Math.floor(h.mana)} / ${h.maxMana}`) +
        bar('xp', h.xp - xpForLevel(h.level - 1), xpForLevel(h.level) - xpForLevel(h.level - 1), `Ур. ${h.level}`),
    );
  }

  private renderInfo() {
    const s = this.store.state;
    const sel = this.sel;
    let html = '';
    if (sel.kind === 'hero') {
      const h = s.hero;
      const [str, agi, int, ds, da, di] = HERO_STATS[h.kind ?? 'mountainking'];
      const at = (base: number, d: number) => base + Math.floor(d * (h.level - 1));
      html =
        `<h3>${esc(h.name)} · уровень ${h.level}</h3>` +
        `<div class="row stats">${stat('attack-hero', h.level * 2 + 20, 'Атака героя')}${stat('armor-hero', smithLevel(s, 'armor') + 3, 'Броня героя')}` +
        `${stat('str', at(str, ds), 'Сила')}${stat('agi', at(agi, da), 'Ловкость')}${stat('int', at(int, di), 'Разум')}</div>` +
        bar('xp', h.xp, xpForLevel(h.level), `Опыт ${h.xp} / ${xpForLevel(h.level)}`) +
        bar('mana', h.mana, h.maxMana, `Мана ${Math.floor(h.mana)} / ${h.maxMana}`) +
        (h.fallenAt
          ? `<div class="row stopped">Пал от истощения. Вернётся на рассвете или воскреси на алтаре за ${reviveCost(h)} золота (A).</div>`
          : `<div class="row">Стоит на базе <b>${esc(this.store.project(h.baseId)?.name ?? '')}</b></div>`) +
        `<div class="row">Смена: ${dutyOf(s, h.slot ?? 0)}</div>` +
        (isMountainKing(h) ? this.heroSpells() : '') +
        this.heroRoster();
    } else if (sel.kind === 'base') {
      const p = this.store.project(sel.id);
      if (p) html = this.baseInfo(p);
    } else if (sel.kind === 'group') {
      html = this.groupInfo(sel.ids, sel.hero);
    } else {
      const t = this.store.task(sel.id);
      if (t) html = this.taskInfo(t);
    }
    setHtml($('info'), `<div class="info">${html}</div>`);
  }

  /**
   * Несколько выбранных рамкой, как в WC3: сетка портретов с полосками здоровья.
   * Щелчок по портрету оставляет выбранным только этого юнита.
   */
  private groupInfo(ids: string[], hero: boolean): string {
    const s = this.store.state;
    const cells: string[] = [];
    if (hero) {
      const h = s.hero;
      cells.push(groupCell('data-action="select-hero" data-hero', HERO_KINDS[h.kind ?? 'mountainking'].short, h.name, h.mana / h.maxMana));
    }
    for (const id of ids) {
      const t = this.store.task(id);
      if (!t?.level) continue;
      cells.push(groupCell(`data-action="select-task" data-id="${t.id}"`, UNIT_SHORT[t.level], `${UNITS[t.level].name}: ${t.title}`, unitHealth(t)));
    }
    return `<h3>Выбрано: ${cells.length}</h3><div class="group-grid">${cells.join('')}</div>`;
  }

  /** Остальные герои на алтаре: уровень, мана и смена. */
  private heroRoster(): string {
    const s = this.store.state;
    if (!s.reserve?.length) return '';
    return (
      `<div class="row roster">На алтаре: ` +
      s.reserve
        .map((r) => `${esc(r.name)} (${dutyOf(s, r.slot ?? 0)}, ур. ${r.level}, ${r.fallenAt ? 'пал' : `мана ${Math.floor(r.mana)}`})`)
        .join(', ') +
      `</div>`
    );
  }

  /** Способности и действующие эффекты в панели героя. */
  private heroSpells(): string {
    const s = this.store.state;
    const h = s.hero;
    const now = Date.now();
    const day = gameDay(s);
    const left = (until: number) => `${Math.max(1, Math.ceil((until - now) / 60_000))} мин`;
    const icons = ABILITY_ORDER.map((id) => {
      const a = ABILITIES[id];
      const rank = rankOf(h, id);
      const cd = cooldownUntil(s, id, day);
      const cls = !rank ? ' locked' : cd ? ' cooldown' : '';
      return `<span class="spell${cls}" title="${esc(a.name)}: ${esc(a.trick)}">${face(a.icon, id)}<em>${a.ult ? (rank ? '★' : '') : rank || ''}</em></span>`;
    }).join('');
    const effects: string[] = [];
    const frog = h.frog?.day === day ? this.store.task(h.frog.taskId) : undefined;
    if (frog && frog.status !== 'done') effects.push(`${ABILITIES.stormbolt.icon} Лягушка дня: «${esc(frog.title)}»`);
    if (h.clap && clapActive(s, now)) effects.push(`${ABILITIES.thunderclap.icon} Серия мелочей: ${h.clap.count}, ещё ${left(h.clap.until)}`);
    if (h.avatar && avatarActive(s, h.avatar.baseId, now)) effects.push(`${ABILITIES.avatar.icon} Аватар: добыча ×${SKILL.avatarFactor}, ещё ${left(h.avatar.until)}`);
    const points = skillPoints(h);
    return (
      `<div class="row spells">${icons}${points ? `<span class="skill-points" data-action="learn" title="Изучить способность (O)">+${points}</span>` : ''}</div>` +
      effects.map((e) => `<div class="row effect">${e}</div>`).join('')
    );
  }

  private baseInfo(p: Project): string {
    const s = this.store.state;
    const sphere = s.spheres.find((x) => x.id === p.sphereId);
    const kind = { work: 'рабочая', personal: 'личная', any: 'в любое время' }[p.kind];
    const task = activeTaskOf(s, p.id);
    const f = miningFactor(s, p);
    const heroHere = s.hero.baseId === p.id && !s.hero.fallenAt;
    const demons = demonsAt(s, p.id);
    let status: string;
    if (p.capturedAt)
      status = `<span class="legion">☠ База в руках Легиона: рабочие бежали, здания в руинах. Сделай, перенеси или изгони всех демонов у её стен (${demons.length}), чтобы отбить её.</span>`;
    else if (p.frozen)
      status = `<span class="frozen">❄ Законсервирована: не добывает, не гниёт, Легион к её задачам не приходит. Активных баз ${activeBases(s).length} из ${BALANCE.activeBasesLimit}.</span>`;
    else if (workersHiding(s, p.id)) status = '<span class="stopped">Рабочие прячутся в ратушу от Легиона</span>';
    else if (!task) status = '<span class="stopped">Рабочие ждут: нет задачи в работе</span>';
    else if (s.onBreak) status = '<span class="stopped">Привал</span>';
    else if (idleGuardTripped(s)) status = '<span class="stopped">Рабочие сели отдыхать</span>';
    else status = `<span class="working">Добыча ${Math.round(f * 100)}%${heroHere ? (avatarActive(s, p.id) ? ` (${ABILITIES.avatar.icon} Аватар)` : '') : ' (без героя)'}</span>`;
    return (
      `<h3><span style="color:${BANNER_COLORS[p.kind]}">⚑</span> ${esc(p.name)}${p.id === MAIN_HALL_ID ? '' : ` <span class="link edit" data-action="edit-project" data-id="${p.id}" title="Переименовать, сменить сферу или тип, удалить">✎</span>`}</h3>` +
      `<div class="row">${sphere ? `Земля: <b class="link" data-action="open-spheres" title="Редактор сфер">${esc(sphere.name)}</b> ${sphere.score} → ${sphere.target}` : '<b>Бытовые и повторяющиеся дела</b>'} · база ${kind}</div>` +
      (p.fortressMaxHp > 0 ? bar('hp', p.fortressHp, p.fortressMaxHp, `Крепость врага ${p.fortressHp} / ${p.fortressMaxHp}`) : '') +
      (task
        ? `<div class="row">В бою: <b>${esc(task.title)}</b></div><div class="timer">${clock(task.spentMs)}</div>`
        : '') +
      (meteorOf(s, p.id) ? `<div class="row legion">☄ Метеор: «${esc(meteorOf(s, p.id)!.task.title)}», до срока ${meteorOf(s, p.id)!.daysLeft} дн.</div>` : '') +
      (p.fortressMaxHp > 0 && p.fortressHp === 0
        ? `<div class="row won">🏆 Крепость пала${p.wonAt ? ` ${new Date(p.wonAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : ''}: миссия выиграна. <span class="link" data-action="enshrine" data-id="${p.id}">В зал славы</span> или ✎ новая крепость.</div>`
        : '') +
      (activeDreadlord(s)?.sphereId === p.sphereId && p.id !== MAIN_HALL_ID
        ? `<div class="row dread">♛ Повелитель ужаса ${esc(activeDreadlord(s)!.name)} в этой земле: ${activeDreadlord(s)!.hp} / ${activeDreadlord(s)!.maxHp}. Задачи базы бьют и по нему.</div>`
        : '') +
      (isBlighted(s, p) ? `<div class="row legion">☠ Скверна: ${idleDays(s, p)} дней без движения. Сдвинь любую задачу проекта.</div>` : '') +
      (p.damage && !p.capturedAt
        ? `<div class="row stopped">🔥 ${p.frozen ? `Здания в руинах: повреждения ${p.damage}%, ремонт H` : `Здания горят: повреждения ${p.damage}%, добыча −${Math.round(p.damage / 2)}%`}</div>`
        : '') +
      (p.id === MAIN_HALL_ID ? this.techInfo() : '') +
      (p.id === 'main' && portalSize(s)
        ? `<div class="row legion">☠ Портал Легиона: ${portalSize(s)} неразобранных свитков старше ${BALANCE.portalScrollDays} дней</div>`
        : '') +
      (demons.length && !p.capturedAt
        ? `<div class="row legion">☠ Легион у базы: ${demons.length} · добыча −${Math.min(100, Math.round(BALANCE.demonMiningPenalty * demons.length * 100))}%${demons.length >= BALANCE.demonsToHide ? ', рабочие спрятались' : ''}</div>`
        : '') +
      `<div class="row">${status}</div>`
    );
  }

  /** Тир ратуши, построенные здания и ход стройки в панели главной ратуши. */
  private techInfo(): string {
    const s = this.store.state;
    const tier = ['Ратуша', 'Крепость', 'Замок'][tierOf(s) - 1];
    const built = BUILDING_ORDER.filter((b) => hasBuilding(s, b));
    const smith = (['armor', 'weapons'] as const).filter((x) => smithLevel(s, x)).map((x) => `${SMITH[x].icon}${smithLevel(s, x)}`);
    let html =
      `<div class="row">${tier}${built.length ? ` · ${built.map((b) => `<span title="${TECH[b].name}: ${TECH[b].gives}">${TECH[b].icon}</span>`).join(' ')}` : ' · зданий пока нет'}${smith.length ? ` · ${smith.join(' ')}` : ''}</div>`;
    const c = s.construction;
    if (c) {
      const t = techOf(s, c.id);
      const doneMin = Math.floor((c.totalMs - c.leftMs) / 60_000);
      const totalMin = Math.round(c.totalMs / 60_000);
      const heroBase = this.store.project(s.hero.baseId);
      const running = !!heroBase && !!activeTaskOf(s, heroBase.id) && !s.onBreak && !idleGuardTripped(s);
      html +=
        `<div class="queue"><span class="queue-slot" title="${esc(t?.name ?? '')}">${t ? face(t.icon, techBtn(c.id, smithLevel(s, c.id as 'armor'))) : ''}</span>` +
        bar('build', c.totalMs - c.leftMs, c.totalMs, `${t?.name ?? ''}: ${doneMin} / ${totalMin} мин`) +
        `</div>` +
        `<div class="row ${running ? 'working' : 'stopped'}">${running ? 'Рабочие строят, пока идёт таймер' : 'Стройка стоит: запусти задачу, и рабочие возьмутся за дело'}</div>`;
    }
    return html;
  }

  private taskInfo(t: Task): string {
    const s = this.store.state;
    const status = { inbox: 'Свиток во входящих', hired: 'В казарме', active: 'В бою', done: 'Выполнена', cancelled: 'Отменена' }[t.status];
    const unit = t.level ? `${UNITS[t.level].name} · ${UNITS[t.level].hint} · ${reward(this.store.state, UNITS[t.level].xp, 'xp')} опыта` : 'Уровень не выбран';
    let html = `<h3>${esc(t.title)}</h3><div class="row"><b>${status}</b> · ${unit}</div>`;
    if (isDemon(t)) {
      const r = demonRank(t);
      html += `<div class="row stats">${stat('attack-chaos', r, `Атака: ${ATTACK_NAMES.chaos}, урон ${r}`)}${stat('armor-fortified', r, `Броня: ${ARMOR_NAMES.fortified}`)}</div>`;
    } else if (t.level && (t.status === 'hired' || t.status === 'active')) {
      const c = UNIT_COMBAT[t.level];
      const armor = smithLevel(s, 'armor');
      const weapons = smithLevel(s, 'weapons');
      html +=
        `<div class="row stats">${stat('attack-' + c.attack, t.level + weapons, `Атака: ${ATTACK_NAMES[c.attack]}, урон по крепости ${t.level}${weapons ? ` +${weapons} от кузницы` : ''}`)}` +
        `${stat('armor-' + c.armor, armor, `Броня: ${ARMOR_NAMES[c.armor]}${armor ? `, +${armor} от кузницы` : ''}`)}` +
        `${stat('supply', 1, 'Еда: одна задача в работе')}</div>`;
    }
    if (t.projectId) html += `<div class="row">База: <b>${esc(this.store.project(t.projectId)?.name ?? '')}</b></div>`;
    const squad = squadOf(s, t.id);
    if (squad.length)
      html += `<div class="row">Отряд: ${squad
        .map((x) => `<span class="squad-unit${x.status === 'done' ? ' done' : ''}" data-action="select-task" data-id="${x.id}">${x.level ?? '?'}·${esc(x.title)}</span>`)
        .join(' ')}</div>`;
    if (t.parentId) {
      const parent = this.store.task(t.parentId);
      if (parent) html += `<div class="row">В отряде: <span class="squad-unit" data-action="select-task" data-id="${parent.id}">${esc(parent.title)}</span></div>`;
    }
    if (isDemon(t)) {
      const rank = demonRank(t);
      const days = daysBetween(t.due!, localDay());
      const next = rank < 4 ? DEMONS[(rank + 1) as Level] : null;
      const grows = next ? daysBetween(localDay(), addDays(t.demonSince!, next.fromDays + armorDelay(s) * rank)) : 0;
      html += `<div class="row legion">☠ <b>${DEMONS[rank].name}</b> · просрочка ${days} дн.${next ? ` · через ${grows} дн. ${next.name}` : ''}</div>`;
    }
    const open = t.status === 'inbox' || t.status === 'hired' || t.status === 'active';
    if (open) {
      const late = !isDemon(t) && t.due && t.due < localDay() ? ' <span class="stopped">срок прошёл, ночью придёт Легион</span>' : '';
      html += `<div class="row">Срок: <input type="date" id="task-due" value="${t.due ?? ''}">${late}</div>`;
      const reps = (['', 'daily', 'weekdays', 'weekly'] as const)
        .map((r) => `<option value="${r}"${(t.repeat ?? '') === r ? ' selected' : ''}>${r ? REPEAT_NAMES[r] : 'не повторять'}</option>`)
        .join('');
      const lockRepeat = !t.repeat && !canRepeat(s);
      html += `<div class="row">Повтор: <select id="task-repeat"${lockRepeat ? ' disabled title="Повторы делает мастерская: нужна крепость и мастерская"' : ''}>${reps}</select>${t.repeat ? ` серия ${t.streak ?? 0}` : ''}${lockRepeat ? ' <span class="stopped">нужна мастерская</span>' : ''}</div>`;
    } else if (t.due) html += `<div class="row">Срок: <b>${t.due}</b></div>`;
    if (t.spentMs > 0) html += `<div class="timer">${clock(t.spentMs)}</div>`;
    if (t.status === 'inbox' || t.status === 'hired') {
      const current = t.projectId ?? this.contextBase()?.id ?? '';
      const options = s.projects
        .filter((p) => !p.frozen)
        .map((p) => `<option value="${p.id}"${p.id === current ? ' selected' : ''}>${esc(p.name)}</option>`)
        .join('');
      const levels = ([1, 2, 3, 4] as Level[])
        .map((l) => {
          const locked = l > maxLevel(s) && t.level !== l;
          return `<button class="btn${t.level === l ? ' on' : ''}" data-action="hire-level" data-level="${l}" title="${locked ? 'Задачи 4 уровня ведут грифоны: нужно грифонье гнездо' : UNITS[l].hint}"${locked ? ' disabled' : ''}>${l}. ${UNITS[l].name}</button>`;
        })
        .join('');
      html +=
        `<div class="row" style="margin-top:6px"><select id="hire-project">${options}</select></div>` +
        `<div class="levels">${levels}</div>` +
        (t.status === 'inbox' ? `<div class="row">Найм даёт +${BALANCE.hireLumber} дерева за план.</div>` : '');
    }
    return html;
  }

  private baseCommands(p: Project): Command[] {
    const s = this.store.state;
    const heroHere = s.hero.baseId === p.id && !s.hero.fallenAt;
    const thaw: Command = {
      icon: '❄',
      hotkey: 'W',
      title: 'Расконсервировать',
      text: p.capturedAt
        ? 'База в руках Легиона: сначала разберись со всеми демонами у её стен.'
        : canThaw(s)
          ? `Вернуть проект в игру. Активных баз станет ${activeBases(s).length + 1} из ${BALANCE.activeBasesLimit}.`
          : `В игре уже ${BALANCE.activeBasesLimit} баз. Сначала законсервируй другую: ✎ в её описании.`,
      enabled: canThaw(s) && !p.capturedAt,
      run: () => this.store.unfreezeProject(p.id),
    };
    const cmds: (Command | null)[] = [
      { icon: '✚', btn: 'scroll', hotkey: 'Q', title: 'Новый свиток', text: 'Записать новое дело во входящие.', run: () => this.focusNewScroll() },
      p.frozen ? thaw : {
        icon: '⚑',
        btn: 'move',
        hotkey: 'W',
        title: 'Перевести героя сюда',
        cost: `${BALANCE.heroMoveCost} маны`,
        text: 'Там, где стоит герой, добыча идёт в полную силу. Переход это цена переключения контекста.',
        enabled: !heroHere && !s.hero.fallenAt,
        run: () => this.store.moveHero(p.id),
      },
      {
        icon: s.onBreak ? '⚒' : '☕',
        btn: s.onBreak ? 'backtowork' : 'sleep',
        hotkey: 'E',
        title: s.onBreak ? 'Закончить привал' : 'Привал',
        text: s.onBreak ? 'Рабочие вернутся к добыче.' : 'Рабочие отдыхают, добыча стоит, мана героя восстанавливается.',
        run: () => this.store.toggleBreak(),
      },
      {
        icon: '✔',
        btn: 'calltoarms',
        hotkey: 'R',
        title: 'Я ещё работаю',
        text: `Через ${BALANCE.idleGuardMinutes} минут без отметок рабочие садятся отдыхать. Эта кнопка их поднимает.`,
        run: () => this.store.confirmWorking(),
      },
      {
        icon: '⌂',
        btn: 'farm',
        hotkey: 'F',
        title: 'Построить ферму',
        cost: `${price(s, BALANCE.farmCost.gold)} золота, ${price(s, BALANCE.farmCost.lumber)} дерева`,
        text: 'Каждая ферма даёт ещё одно место под задачу в работе. Строить можно только во время работы.',
        run: () => this.store.buildFarm(),
      },
      p.id === MAIN_HALL_ID
        ? {
            icon: '⚒',
            btn: 'humanbuild',
            hotkey: 'G',
            title: 'Строительство',
            cost: s.construction ? `строится: ${techOf(s, s.construction.id)?.name ?? ''}` : undefined,
            text: 'Здания дерева технологий и улучшение ратуши до крепости и замка. Каждое здание открывает новую возможность. Стройка идёт, только пока тикает таймер работы.',
            run: () => {
              this.building = true;
              this.render();
            },
          }
        : { icon: '◎', btn: 'townhall', hotkey: 'G', title: 'Камера на базу', text: 'Показать эту базу.', run: () => this.world.focusBase(p.id) },
      {
        icon: '⚒',
        btn: 'repair',
        hotkey: 'H',
        title: 'Починить базу',
        cost: p.damage ? `${repairCost(p)} золота` : undefined,
        text: p.capturedAt
          ? 'Руины не отстроить, пока база в руках Легиона. Сначала отбей её.'
          : p.damage
            ? 'Потушить огонь и отстроить здания, обожжённые скверной. Пока по земле ползёт скверна, огонь вернётся следующей ночью.'
            : 'Здания целы.',
        enabled: !!p.damage && !p.capturedAt,
        run: () => this.store.repair(p.id),
      },
      {
        icon: '✉',
        btn: 'tome',
        hotkey: 'J',
        title: 'Разобрать входящие',
        text: 'Все неразобранные свитки в одном окне: проект, уровень и срок сразу, ненужные в огонь.',
        enabled: s.tasks.some((t) => t.status === 'inbox'),
        run: () => openTriage(this.store),
      },
      {
        icon: '☀',
        btn: 'crystalball',
        hotkey: 'Z',
        title: 'Планирование дня',
        text: 'Что пришло ночью и задачи на сегодня, по одной на проект. Новая задача в плане даёт дерево.',
        run: () => openPlanning(this.store),
      },
      {
        icon: '☾',
        btn: 'elunesblessing',
        hotkey: 'X',
        title: 'Итоги дня',
        text: 'Статистика дня, как в конце партии, и что делать с незаконченными задачами. Перед отбоем открывается сама.',
        run: () => openSummary(this.store),
      },
      {
        icon: '♨',
        btn: 'replenishmana',
        hotkey: 'C',
        title: 'Второе дыхание',
        cost: `+${BALANCE.secondWindMana} маны, раз в день`,
        text: 'После работы ужин или прогулка возвращают часть маны.',
        enabled: s.secondWindDay !== gameDay(s) && currentShift(s) !== 'day',
        run: () => this.store.secondWind(),
      },
      {
        icon: '❖',
        btn: 'glyph',
        hotkey: 'V',
        title: 'Глава недели',
        text: 'Две или три главные цели недели. В начале новой недели прошлая глава закрывается: золото за каждую выполненную цель.',
        run: () => openWeek(this.store),
      },
    ];
    return cmds.map((c) => c ?? { icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} });
  }

  /** Карточка строительства на главной ратуше: здания, улучшение ратуши, кузница. */
  private buildCommands(): Command[] {
    const s = this.store.state;
    const tech = (id: TechId, hotkey: string): Command => {
      const t = techOf(s, id);
      if (!t) {
        const smith = SMITH[id as 'armor' | 'weapons'];
        return { icon: smith.icon, btn: techBtn(id, 2), hotkey, title: `${smith.name}: изучено полностью`, text: smith.effect(3), enabled: false, run: () => {} };
      }
      const done = isDone(s, id);
      const now = s.construction?.id === id;
      const block = techBlock(s, id);
      const upgrade = id === 'keep' || id === 'castle';
      const smith = id === 'armor' || id === 'weapons';
      return {
        icon: t.icon,
        btn: techBtn(id, smith ? smithLevel(s, id) : 0),
        hotkey,
        title: done ? `${t.name}: ${upgrade ? 'есть' : 'построено'}` : now ? `${t.name}: строится` : upgrade ? `Улучшить до: ${t.name}` : smith ? `Изучить: ${t.name}` : `Построить: ${t.name}`,
        cost: done || now ? undefined : `${t.gold} золота, ${t.lumber} дерева, ${t.minutes} мин. работы`,
        text: t.gives + (block && !done && !now ? ` ${block}` : '') + (smith && smithLevel(s, id) ? ` Сейчас ступень ${smithLevel(s, id)}.` : ''),
        enabled: !block,
        run: () => {
          this.store.build(id);
          this.render();
        },
      };
    };
    const c = s.construction;
    const cancel: Command = {
      icon: '✖',
      btn: 'cancel',
      hotkey: 'J',
      title: c ? `Отменить стройку: ${techOf(s, c.id)?.name ?? ''}` : 'Отменить стройку',
      text: 'Золото и дерево вернутся полностью.',
      enabled: !!c,
      run: () => this.store.cancelBuild(),
    };
    const back: Command = {
      icon: '↩',
      btn: 'cancel',
      hotkey: 'Esc',
      title: 'Назад',
      text: 'Вернуться к командам базы.',
      run: () => {
        this.building = false;
        this.render();
      },
    };
    const empty = { icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} };
    const [q, w, e, r, f, g] = BUILDING_ORDER;
    return [
      tech(q, 'Q'),
      tech(w, 'W'),
      tech(e, 'E'),
      tech(r, 'R'),
      tech(f, 'F'),
      tech(g, 'G'),
      tech(tierOf(s) < 2 ? 'keep' : 'castle', 'H'),
      cancel,
      tech('armor', 'Z'),
      tech('weapons', 'X'),
      hasBuilding(s, 'vault')
        ? { icon: '📜', btn: 'arcanevault', hotkey: 'C', title: 'Открыть хранилище тайн', text: 'Статистика по дням, землям и проектам.', run: () => openVault(this.store) }
        : empty,
      back,
    ];
  }

  /** Описание способности для подсказки: что даёт текущая ступень или первая. */
  private abilityText(id: AbilityId): string {
    const h = this.store.state.hero;
    const a = ABILITIES[id];
    const rank = rankOf(h, id);
    return `«${a.trick}». ${a.effect(Math.max(1, rank))}` + (a.cooldownDays ? ` Перезарядка ${a.cooldownDays} ${a.cooldownDays === 1 ? 'день' : 'дня'}.` : '');
  }

  private abilityCost(id: AbilityId): string | undefined {
    const h = this.store.state.hero;
    if (ABILITIES[id].passive) return 'пассивная';
    const cd = cooldownUntil(this.store.state, id, gameDay(this.store.state));
    return `${manaCost(h, id)} маны` + (cd ? `, готова ${cd.slice(8)}.${cd.slice(5, 7)}` : '');
  }

  private heroCommands(): Command[] {
    const s = this.store.state;
    const h = s.hero;
    const day = gameDay(s);
    const spell = (id: AbilityId, hotkey: string, run: () => void): Command => {
      const a = ABILITIES[id];
      const rank = rankOf(h, id);
      return {
        icon: a.icon,
        btn: id,
        hotkey,
        title: rank ? `${a.name}${a.ult ? '' : ` (ступень ${rank})`}` : `${a.name}: не изучена`,
        cost: rank ? this.abilityCost(id) : undefined,
        text: this.abilityText(id),
        enabled: !!rank && !a.passive && !castBlock(s, id, day),
        run,
      };
    };
    const points = skillPoints(h);
    const kind = HERO_KINDS[h.kind ?? 'mountainking'];
    const soon = (i: number, hotkey: string): Command => ({
      icon: '◇',
      btn: SPELL_BTN[h.kind ?? 'mountainking'][i],
      hotkey,
      title: `${kind.spells[i]}: скоро`,
      text: `Способность героя «${kind.name}» ещё в разработке. Пока он дежурит в своей смене со своей маной и уровнем.`,
      enabled: false,
      run: () => {},
    });
    const mk = isMountainKing(h);
    const heroes = allHeroes(s);
    const slots = heroSlots(s);
    const hireCost = price(s, BALANCE.heroHireGold[heroes.length] ?? 0);
    const cmds: (Command | null)[] = [
      mk ? spell('stormbolt', 'Q', () => this.frogDialog()) : soon(0, 'Q'),
      mk ? spell('thunderclap', 'W', () => this.store.thunderClap()) : soon(1, 'W'),
      mk ? spell('bash', 'E', () => {}) : soon(2, 'E'),
      mk ? spell('avatar', 'R', () => this.store.avatar()) : soon(3, 'R'),
      h.fallenAt
        ? {
            icon: '✟',
            btn: 'resurrection',
            hotkey: 'A',
            title: 'Воскресить на алтаре',
            cost: `${reviveCost(h)} золота`,
            text: `Герой встанет у алтаря главной ратуши с ${Math.round(BALANCE.reviveMana * 100)}% маны. Иначе он вернётся сам на рассвете.`,
            enabled: s.resources.gold >= reviveCost(h),
            run: () => this.store.revive(),
          }
        : null,
      null,
      null,
      {
        icon: '✦',
        btn: 'skillz',
        hotkey: 'O',
        title: points ? `Изучить способность (очков: ${points})` : 'Изучить способность',
        text: 'Очко навыка за каждый уровень героя. Обычные способности растут на 1, 3 и 5 уровне, ультимейт открывается на 6.',
        enabled: points > 0,
        run: () => {
          this.learning = true;
          this.render();
        },
      },
      {
        icon: '⚜',
        btn: 'altarofkings',
        hotkey: 'Z',
        title: 'Призвать героя на алтарь',
        cost: heroes.length < slots ? `${hireCost} золота` : undefined,
        text:
          heroes.length >= 3
            ? 'На алтаре все три места заняты.'
            : heroes.length < slots
              ? 'Свой герой на каждую смену: у каждого своя мана и свой уровень, а работа не в свою смену не выжигает дневного героя.'
              : heroes.length === 1
                ? 'Второй герой откроется, когда ратуша станет крепостью.'
                : 'Третий герой откроется, когда крепость станет замком.',
        enabled: heroes.length < slots && s.resources.gold >= hireCost,
        run: () => this.hireDialog(),
      },
      null,
      null,
      {
        icon: '↩',
        btn: 'cancel',
        hotkey: 'Esc',
        title: 'Назад',
        text: 'Вернуться к базе героя.',
        run: () => this.select({ kind: 'base', id: h.baseId }),
      },
    ];
    return cmds.map((c) => c ?? { icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} });
  }

  private learnCommands(): Command[] {
    const h = this.store.state.hero;
    const learn = (id: AbilityId, hotkey: string): Command => {
      const a = ABILITIES[id];
      const need = levelForNextRank(h, id);
      const next = rankOf(h, id) + 1;
      return {
        icon: a.icon,
        btn: id,
        hotkey,
        title: need === null ? `${a.name}: изучена полностью` : `Изучить «${a.name}»${a.ult ? '' : `, ступень ${next}`}`,
        cost: need !== null && h.level < need ? `нужен ${need} уровень героя` : undefined,
        text: `«${a.trick}». ${a.effect(Math.min(next, a.mana.length))}`,
        enabled: canLearn(h, id),
        run: () => {
          this.store.learn(id);
          if (!skillPoints(this.store.state.hero)) this.learning = false;
          this.render();
        },
      };
    };
    const back: Command = {
      icon: '↩',
      btn: 'cancel',
      hotkey: 'Esc',
      title: 'Отмена',
      text: 'Вернуться к способностям героя.',
      run: () => {
        this.learning = false;
        this.render();
      },
    };
    const empty = { icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} };
    return [learn('stormbolt', 'Q'), learn('thunderclap', 'W'), learn('bash', 'E'), learn('avatar', 'R'), empty, empty, empty, empty, empty, empty, empty, back];
  }

  /** Выбор класса для нового героя на алтаре. */
  private hireDialog() {
    const s = this.store.state;
    const taken = new Set(allHeroes(s).map((h) => h.kind ?? 'mountainking'));
    const kinds = (Object.keys(HERO_KINDS) as HeroKind[]).filter((k) => !taken.has(k));
    const { root, close } = openModal(
      `<h3>Призвать героя</h3>` +
        `<div class="hint">У людей четыре героя, а мест на алтаре три. Новый герой займёт смену: ${dutyOf({ ...s, reserve: [...(s.reserve ?? []), s.hero] }, allHeroes(s).length)}. Пока он выглядит как перекрашенный Горный король, а его способности ещё в разработке.</div>` +
        `<div class="hero-pick">${kinds
          .map(
            (k) =>
              `<button class="btn" data-k="${k}"><b style="color:${HERO_KINDS[k].tint}">${HERO_KINDS[k].name}</b><span>${esc(HERO_KINDS[k].about)}</span><em>${HERO_KINDS[k].spells.join(', ')}</em></button>`,
          )
          .join('')}</div>` +
        `<div class="actions"><button class="btn" data-a="cancel">Отмена</button></div>`,
      'wide',
    );
    root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        close();
        this.store.hireHero(b.dataset.k as HeroKind);
      }),
    );
  }

  /** Молот бури прямо с карточки задачи. */
  private frogCommand(t: Task): Command {
    const s = this.store.state;
    const block = castBlock(s, 'stormbolt', gameDay(s));
    const fit = (t.status === 'hired' || t.status === 'active') && (t.level ?? 0) >= SKILL.frogMinLevel;
    return {
      icon: ABILITIES.stormbolt.icon,
      btn: 'stormbolt',
      hotkey: 'V',
      title: s.hero.frog?.taskId === t.id ? 'Это лягушка дня' : 'Съесть лягушку (Молот бури)',
      cost: this.abilityCost('stormbolt'),
      text: this.abilityText('stormbolt'),
      enabled: fit && !block && s.hero.frog?.taskId !== t.id,
      run: () => this.store.stormBolt(t.id),
    };
  }

  /** Выбор лягушки: самая тяжёлая из нанятых и задач в работе предлагается первой. */
  private frogDialog() {
    const s = this.store.state;
    const options = s.tasks
      .filter((t) => (t.status === 'hired' || t.status === 'active') && (t.level ?? 0) >= SKILL.frogMinLevel)
      .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.createdAt - b.createdAt);
    if (!options.length) {
      this.store.say(`Лягушкой может стать задача ${SKILL.frogMinLevel}+ уровня в казарме или в работе. Таких нет.`, 'warn');
      return;
    }
    const { root, close } = openModal(
      `<h3>${ABILITIES.stormbolt.icon} Молот бури: съесть лягушку</h3>` +
        `<div class="hint">${esc(ABILITIES.stormbolt.effect(rankOf(s.hero, 'stormbolt')))}</div>` +
        `<label>Лягушка дня</label><select name="frog">${options
          .map((t) => `<option value="${t.id}">${esc(t.title)} · ${UNITS[t.level!].name} · ${esc(this.store.project(t.projectId ?? '')?.name ?? '')}</option>`)
          .join('')}</select>` +
        `<div class="actions"><button class="btn" data-a="cancel">Отмена</button><button class="btn" data-a="ok">Метнуть молот (${manaCost(s.hero, 'stormbolt')} маны)</button></div>`,
    );
    root.querySelector('[data-a="cancel"]')!.addEventListener('click', close);
    root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
      const id = (root.querySelector('[name="frog"]') as HTMLSelectElement).value;
      close();
      this.store.stormBolt(id);
    });
  }

  private taskCommands(t: Task): Command[] {
    const back = () => {
      const b = this.contextBase();
      if (b) this.select({ kind: 'base', id: b.id });
    };
    const open = t.status === 'inbox' || t.status === 'hired' || t.status === 'active';
    const cmds: (Command | null)[] = [
      {
        icon: '▶',
        btn: 'move',
        hotkey: 'A',
        title: 'В работу',
        text: 'Юнит идёт к вражеской крепости и занимает еду. На базе оживают рабочие. Одна задача в работе на проект.',
        enabled: t.status === 'hired',
        run: () => {
          if (this.store.start(t.id) && t.projectId && t.projectId !== this.store.state.hero.baseId) {
            this.store.say('Герой на другой базе, здесь добыча пойдёт медленно. Переведи его клавишей W на базе.');
          }
        },
      },
      { icon: '⏸', btn: 'stop', hotkey: 'S', title: 'Вернуть в план', text: 'Остановить работу, юнит вернётся в казарму.', enabled: t.status === 'active', run: () => this.store.stop(t.id) },
      {
        icon: '⚔',
        btn: 'attack',
        hotkey: 'D',
        title: 'Готово',
        cost: t.level ? `+${reward(this.store.state, UNITS[t.level].xp, 'xp')} опыта, +${reward(this.store.state, BALANCE.caravanGoldPerLevel * t.level, 'mining')} золота` : undefined,
        text: isDemon(t)
          ? 'Полная победа над демоном: удар по крепости, опыт по исходному уровню задачи и караван с золотом.'
          : 'Удар по крепости с уроном, равным уровню. Герой получает опыт, приходит караван с золотом.',
        enabled: (t.status === 'active' || t.status === 'hired') && !!t.level,
        run: () => void this.completeTask(t),
      },
      {
        icon: '✖',
        btn: 'cancel',
        hotkey: 'X',
        title: isDemon(t) ? 'Изгнать демона' : 'Отменить',
        text: isDemon(t) ? 'Отказаться от задачи: бесплатно, но без опыта. Честный отказ лучше висящего долга.' : 'Юнит распущен, еда освобождена, без штрафа.',
        enabled: open,
        run: () => this.store.cancel(t.id),
      },
    ];
    for (const l of [1, 2, 3, 4] as Level[]) {
      cmds.push({
        icon: String(l),
        btn: UNIT_BTN[l],
        hotkey: String(l),
        title: `${UNITS[l].name}`,
        cost: UNITS[l].hint,
        text: `Уровень ${l}: ${reward(this.store.state, UNITS[l].xp, 'xp')} опыта, урон по крепости ${l}.`,
        enabled: open && t.status !== 'active',
        run: () => this.hireSelected(l),
      });
    }
    cmds.push(
      {
        icon: '⌛',
        btn: 'slow',
        hotkey: 'Z',
        title: isDemon(t) ? 'Отбиться переносом' : t.due ? 'Перенести срок' : 'Поставить срок',
        cost: isDemon(t) || t.due ? `${rescheduleCost(t)} дерева` : 'бесплатно',
        text: isDemon(t)
          ? 'Быстрый отход: демон отступит к вратам, а задача получит новый срок. Перенос стоит дерева, а если его не хватает, идёт в долг.'
          : 'Без срока задача не станет демоном. Отодвинуть срок стоит дерева, поставить или приблизить бесплатно.',
        enabled: open,
        run: () => this.rescheduleDialog(t),
      },
      {
        icon: '⚑',
        btn: 'defend',
        hotkey: 'C',
        title: 'Добавить в отряд',
        cost: !canSubtasks(this.store.state) ? 'нужна лесопилка' : squadOf(this.store.state, t.id).length >= squadLimit(this.store.state) ? 'отряд полон' : undefined,
        text:
          'Разбить большую задачу на юнитов: подзадача встаёт в отряд этой задачи на той же базе. Командир отряда наносит последний удар.' +
          (canSubtasks(this.store.state) ? (Number.isFinite(squadLimit(this.store.state)) ? ` Без грифоньего гнезда в отряде до ${squadLimit(this.store.state)} юнитов.` : '') : ' Отряды собираются на лесопилке.'),
        enabled: open && !!t.projectId && !!t.level && !t.parentId && canSubtasks(this.store.state) && squadOf(this.store.state, t.id).length < squadLimit(this.store.state),
        run: () => this.subtaskDialog(t),
      },
      rankOf(this.store.state.hero, 'stormbolt') ? this.frogCommand(t) : null,
    );
    cmds.push({ icon: '↩', btn: 'cancel', hotkey: 'Esc', title: 'Назад', text: 'Вернуться к базе.', run: back });
    return cmds.map((c) => c ?? { icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} });
  }

  private renderCard() {
    const sel = this.sel;
    let cmds: Command[] = [];
    if (sel.kind === 'group') {
      // У отряда из разных задач общих приказов нет: только снять выделение.
      cmds = Array.from({ length: 11 }, () => ({ icon: '', hotkey: '', title: '', text: '', enabled: false, run: () => {} }));
      cmds.push({ icon: '↩', btn: 'cancel', hotkey: 'Esc', title: 'Назад', text: 'Снять выделение и вернуться к базе.', run: () => this.select({ kind: 'base', id: this.contextBase()?.id ?? MAIN_HALL_ID }) });
    } else if (sel.kind === 'task') {
      const t = this.store.task(sel.id);
      if (t) cmds = this.taskCommands(t);
    } else if (sel.kind === 'hero') {
      cmds = this.learning ? this.learnCommands() : this.heroCommands();
    } else {
      const p = this.contextBase();
      if (p) cmds = this.building && p.id === MAIN_HALL_ID ? this.buildCommands() : this.baseCommands(p);
    }
    this.commands = cmds;
    let html = '';
    for (let i = 0; i < 12; i++) {
      const c = cmds[i];
      if (!c || !c.title) html += '<div class="cmd empty"></div>';
      else
        html += `<button class="cmd${c.enabled === false ? ' off' : ''}" data-action="cmd" data-id="${i}" aria-label="${esc(c.title)}"><span class="hk">${c.hotkey}</span>${face(c.icon, c.btn)}</button>`;
    }
    setHtml($('command-card'), html);
  }

  private renderGuard() {
    const s = this.store.state;
    const heroBase = this.store.project(s.hero.baseId);
    const show = heroBase && activeTaskOf(s, heroBase.id) && !s.onBreak && idleGuardTripped(s);
    if (s.hero.fallenAt) {
      const cost = reviveCost(s.hero);
      setHtml(
        $('guard'),
        `<div class="banner">${esc(s.hero.name)} пал от истощения. Базы добывают как без героя. ` +
          `<button class="btn" data-action="revive"${s.resources.gold < cost ? ' disabled' : ''}>Воскресить за ${cost} золота</button></div>`,
      );
      return;
    }
    setHtml(
      $('guard'),
      show
        ? `<div class="banner">Рабочие сели отдыхать: ${BALANCE.idleGuardMinutes} минут без отметок. Ты ещё работаешь? <button class="btn" data-action="confirm">Да, работаю</button></div>`
        : '',
    );
  }

  private tooltip(c: Command | undefined) {
    const el = $('tooltip');
    if (!c || !c.title) {
      el.style.display = 'none';
      return;
    }
    el.innerHTML =
      `<div class="title">${esc(c.title)}${c.hotkey ? ` (<span class="hotkey">${c.hotkey}</span>)` : ''}</div>` +
      (c.cost ? `<div class="cost">${costHtml(c.cost)}</div>` : '') +
      `<div>${esc(c.text).replace(/\n/g, '<br>')}</div>`;
    el.style.display = 'block';
  }

  private focusNewScroll() {
    $('side').classList.remove('hidden');
    ($('new-scroll').querySelector('input') as HTMLInputElement).focus();
  }

  private message(e: GameEvent) {
    const box = $('messages');
    const div = document.createElement('div');
    div.className = 'msg ' + e.kind;
    div.textContent = e.text;
    box.appendChild(div);
    window.setTimeout(() => div.remove(), 7000);
    while (box.childElementCount > 6) box.firstElementChild?.remove();
  }

  private drawMinimap() {
    const c = $<HTMLCanvasElement>('minimap');
    // Вкладка в фоне или мини-карта спрятана (телефон стоя): рисовать некому.
    if (document.hidden || !c.offsetParent) return;
    // Холст в настоящих пикселях экрана, иначе значки и рамка мыльные.
    const want = Math.max(180, Math.min(512, Math.round(c.clientWidth * Math.min(2, window.devicePixelRatio || 1))));
    if (c.width !== want) c.width = c.height = want;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const u = W / 180;
    const k = W / (MAP_HALF * 2);
    const toX = (x: number) => (x + MAP_HALF) * k;
    const toY = (z: number) => (MAP_HALF - z) * k;
    const art = this.plainMap ? null : this.world.minimapArt();
    if (art) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(art, 0, 0, W, W);
    } else {
      ctx.fillStyle = '#3c5a24';
      ctx.fillRect(0, 0, W, W);
    }
    ctx.save();
    ctx.scale(u, u);
    const toXu = (x: number) => toX(x) / u;
    const toYu = (z: number) => toY(z) / u;
    const s = this.store.state;
    for (const p of s.projects) {
      const x = toXu(p.slot.x);
      const y = toYu(p.slot.z);
      if (p.fortressMaxHp > 0 && p.fortressHp > 0) {
        const len = Math.hypot(p.slot.x, p.slot.z) || 1;
        ctx.fillStyle = '#d43a2a';
        ctx.fillRect(toXu(p.slot.x + (p.slot.x / len) * 48) - 2, toYu(p.slot.z + (p.slot.z / len) * 48) - 2, 4, 4);
      }
      ctx.fillStyle = BANNER_COLORS[p.kind];
      const size = p.id === 'main' ? 9 : 6;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      // Тёмная кайма, чтобы значок читался на траве и на земле.
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      if (activeTaskOf(s, p.id)) {
        ctx.strokeStyle = '#7dff7d';
        ctx.strokeRect(x - size / 2 - 2, y - size / 2 - 2, size + 4, size + 4);
      }
    }
    // Демоны Легиона: ярко-зелёные точки у своих баз.
    const perBase = new Map<string, number>();
    for (const t of allDemons(s)) {
      const id = demonBaseId(t);
      const i = perBase.get(id) ?? 0;
      perBase.set(id, i + 1);
      const p = this.store.project(id);
      if (!p || i >= 6) continue;
      ctx.fillStyle = '#000';
      ctx.fillRect(toXu(p.slot.x) - 7.5 + (i % 3) * 5, toYu(p.slot.z) + 6.5 + Math.floor(i / 3) * 4, 4, 4);
      ctx.fillStyle = '#5dff3a';
      ctx.fillRect(toXu(p.slot.x) - 7 + (i % 3) * 5, toYu(p.slot.z) + 7 + Math.floor(i / 3) * 4, 3, 3);
    }
    const hero = this.store.project(s.hero.baseId);
    if (hero) {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(toXu(hero.slot.x) + 6, toYu(hero.slot.z) + 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Рамка камеры: то, что видно на экране, опущенное на землю, поэтому трапеция.
    const f = this.world.cameraFootprint();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, u * 0.9);
    ctx.beginPath();
    f.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z))));
    ctx.closePath();
    ctx.stroke();
  }
}

/** Цвет неба в окошке часов по часу суток: ночь, рассвет, день, закат. */
const SKY: [number, [number, number, number]][] = [
  [0, [10, 16, 40]],
  [4.5, [12, 20, 50]],
  [6.5, [214, 128, 70]],
  [8.5, [78, 142, 214]],
  [17, [78, 142, 214]],
  [19.5, [206, 96, 56]],
  [21.5, [14, 22, 56]],
  [24, [10, 16, 40]],
];

function skyAt(h: number): string {
  const i = SKY.findIndex(([t]) => t > h);
  const [t0, a] = SKY[i - 1];
  const [t1, b] = SKY[i];
  const k = (h - t0) / (t1 - t0);
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(',')})`;
}
