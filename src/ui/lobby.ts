// Лобби новой игры, как меню карты в кастомке WC3: слева настройки, справа превью карты,
// где земли и базы появляются, пока вписываешь сферы и проекты. Всё можно поменять
// потом: сферы, проекты и героя в меню, распорядок, сложность и Легион в настройках.
// Открывается само, пока игра не настроена (новая игра или первый запуск).

import { BALANCE, HERO_KINDS, LEGION_MODES } from '../state/config';
import { fortressSpot, freeSlot } from '../state/economy';
import { createInitialState } from '../state/seed';
import { plural, type Store } from '../state/store';
import type { BaseKind, GameState, HeroKind, LegionMode, Project, Settings, Tuning } from '../state/types';
import { MAIN_HALL_ID } from '../state/types';
import type { Sync } from '../storage/sync';
import { assignColors, projectColor } from '../state/colors';
import { landSpots } from '../scene/lands';
import { importSave } from './backup';
import { btnArt, type BtnIcon } from './btn-icons';
import { openSettings } from './modals';

const MAP_HALF = 200;

const SPHERE_NAMES = ['Здоровье', 'Карьера и навыки', 'Отношения', 'Финансы', 'Отдых', 'Таланты и хобби', 'Друзья', 'Духовное развитие'];

/** Размер миссии: здоровье вражеской крепости, то есть сколько уровней задач нужно сделать. */
const SIZES: { hp: number; name: string }[] = [
  { hp: 10, name: 'Малая' },
  { hp: BALANCE.fortressHp, name: 'Средняя' },
  { hp: 40, name: 'Большая' },
  { hp: 80, name: 'Огромная' },
];

const KINDS: { id: BaseKind; name: string }[] = [
  { id: 'work', name: 'Работа' },
  { id: 'personal', name: 'Личное' },
  { id: 'any', name: 'Любое время' },
];

const HERO_BTN: Record<HeroKind, BtnIcon> = {
  mountainking: 'heromountainking',
  paladin: 'heropaladin',
  archmage: 'heroarchmage',
  bloodmage: 'herobloodelfprince',
};

type Difficulty = 'easy' | 'normal' | 'hard';
const DIFFICULTY: Record<Difficulty, { name: string; hint: string; balance: Tuning }> = {
  easy: { name: 'Лёгкая', hint: 'добычи и опыта ×1,5, цены ×0,75', balance: { mining: 1.5, prices: 0.75, xp: 1.5 } },
  normal: { name: 'Обычная', hint: 'баланс как задуман', balance: { mining: 1, prices: 1, xp: 1 } },
  hard: { name: 'Тяжёлая', hint: 'добычи и опыта ×0,75, цены ×1,5', balance: { mining: 0.75, prices: 1.5, xp: 0.75 } },
};

const LEGION = LEGION_MODES;

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Цвета земель на превью, по порядку сфер. */
const LAND_COLORS = ['#e2b63c', '#3fae4a', '#2f6bff', '#d9534f', '#9b59b6', '#1abc9c', '#e67e22', '#7f8c8d'];

interface SphereRow {
  name: string;
  score: number;
  target: number;
}
interface ProjectRow {
  name: string;
  sphere: number;
  kind: BaseKind;
  hp: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function options(n: number, selected: number): string {
  return Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${i + 1 === selected ? ' selected' : ''}>${i + 1}</option>`).join('');
}

/** Открывает лобби, пока игра не настроена, и убирает, когда настроена (в том числе загрузкой из Gist). */
export function watchLobby(store: Store, sync: Sync, mapArt: () => HTMLCanvasElement | null) {
  let lobby: { remove: () => void } | null = null;
  const check = () => {
    if (!store.state.setupDone && !lobby) lobby = openLobby(store, sync, mapArt);
    else if (store.state.setupDone && lobby) {
      lobby.remove();
      lobby = null;
    }
  };
  store.subscribe(check);
  check();
}

function openLobby(store: Store, sync: Sync, mapArt: () => HTMLCanvasElement | null) {
  const spheres: SphereRow[] = SPHERE_NAMES.slice(0, 6).map((name) => ({ name, score: 5, target: 8 }));
  const projects: ProjectRow[] = Array.from({ length: 3 }, (_, i) => ({ name: '', sphere: i % spheres.length, kind: 'any', hp: BALANCE.fortressHp }));
  let hero: HeroKind = 'mountainking';
  let difficulty: Difficulty = 'normal';
  let legion: LegionMode = 'normal';
  const st: Settings = { ...store.state.settings, workDays: [...store.state.settings.workDays] };

  document.body.classList.add('lobby');
  const host = document.createElement('div');
  host.id = 'lobby';
  host.innerHTML = `
    <div class="modal lobby-panel">
      <h3>Новая игра</h3>
      <div class="lobby-grid">
        <div class="lobby-left">
          <div class="lobby-race"><span>Раса</span><b>Люди</b><em>другие расы позже</em></div>

          <h4>1. Сферы жизни</h4>
          <div class="hint">Земли на карте. Оцени, где ты сейчас и где хочешь быть, от 1 до 10.</div>
          <div class="lobby-count" data-count="spheres"></div>
          <div class="lobby-rows" data-rows="spheres"></div>

          <h4>2. Проекты</h4>
          <div class="hint">Каждый проект это база, а за лесом вражеская крепость: финальная цель. Размер миссии это сколько ударов задачами выдержат её врата.</div>
          <div class="lobby-count" data-count="projects"></div>
          <div class="lobby-rows" data-rows="projects"></div>

          <h4>3. Герой</h4>
          <div class="lobby-heroes"></div>
          <div class="hint lobby-hero-hint"></div>

          <details class="lobby-more">
            <summary>Дополнительно</summary>
            <label>Распорядок</label>
            <div class="grid2">
              <div><label>Подъём</label><input type="time" name="wakeUp" value="${st.wakeUp}"></div>
              <div><label>Отбой</label><input type="time" name="bedtime" value="${st.bedtime}"></div>
              <div><label>Начало рабочего дня</label><input type="time" name="dayStart" value="${st.dayStart}"></div>
              <div><label>Конец рабочего дня</label><input type="time" name="dayEnd" value="${st.dayEnd}"></div>
            </div>
            <label>Рабочие дни</label>
            <div class="lobby-days">${DAYS.map(
              (d, i) => `<label class="check"><input type="checkbox" name="day" value="${i + 1}"${st.workDays.includes(i + 1) ? ' checked' : ''}> ${d}</label>`,
            ).join('')}</div>
            <label>Сложность</label>
            <div class="levels" data-pick="difficulty">${(Object.keys(DIFFICULTY) as Difficulty[])
              .map((k) => `<button class="btn" data-v="${k}">${DIFFICULTY[k].name}</button>`)
              .join('')}</div>
            <div class="hint" data-hint="difficulty"></div>
            <label>Пылающий Легион</label>
            <div class="levels" data-pick="legion">${(Object.keys(LEGION) as LegionMode[])
              .map((k) => `<button class="btn" data-v="${k}">${LEGION[k].name}</button>`)
              .join('')}</div>
            <div class="hint" data-hint="legion"></div>
          </details>
        </div>
        <div class="lobby-right">
          <canvas class="lobby-map" width="360" height="360"></canvas>
          <div class="lobby-brief"></div>
        </div>
      </div>
      <div class="err"></div>
      <div class="actions">
        <button class="btn" data-a="load" style="margin-right:auto">Загрузить сохранение</button>
        <input type="file" name="import" accept=".json,application/json" hidden>
        <button class="btn lobby-go" data-a="go">В бой!</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const q = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T;
  const err = q('.err');
  const canvas = q<HTMLCanvasElement>('.lobby-map');

  // ---------- Число сфер и проектов: кнопки 1–6 и своё значение ----------

  const countRow = (kind: 'spheres' | 'projects') => {
    const list = kind === 'spheres' ? spheres : projects;
    const from = kind === 'spheres' ? 1 : 0;
    const max = kind === 'spheres' ? 12 : 20;
    const n = list.length;
    const custom = n > 6;
    q(`[data-count="${kind}"]`).innerHTML =
      Array.from({ length: 7 - from }, (_, i) => i + from)
        .map((i) => `<button class="btn${i === n ? ' on' : ''}" data-n="${i}">${i}</button>`)
        .join('') +
      `<label class="lobby-custom${custom ? ' on' : ''}">Своё <input type="number" min="${from}" max="${max}" step="1" value="${custom ? n : ''}" placeholder="${n}"></label>`;
  };

  const resize = (kind: 'spheres' | 'projects', n: number) => {
    // Дробное число в поле «Своё» (1,5) округляется: строк столько, сколько видно.
    n = Math.round(n);
    if (kind === 'spheres') {
      n = Math.min(12, Math.max(1, n));
      while (spheres.length < n) spheres.push({ name: SPHERE_NAMES[spheres.length] ?? '', score: 5, target: 8 });
      spheres.length = n;
      for (const p of projects) if (p.sphere >= n) p.sphere = 0;
    } else {
      n = Math.min(20, Math.max(0, n));
      while (projects.length < n) projects.push({ name: '', sphere: projects.length % spheres.length, kind: 'any', hp: BALANCE.fortressHp });
      projects.length = n;
    }
    renderRows();
  };

  for (const kind of ['spheres', 'projects'] as const) {
    const box = q(`[data-count="${kind}"]`);
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n]');
      if (b) resize(kind, Number(b.dataset.n));
    });
    box.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      // 0 тоже число: проектов может не быть совсем (сфер не меньше одной, поле покажет 1).
      if (raw !== '' && Number.isFinite(Number(raw))) resize(kind, Number(raw));
    });
  }

  // ---------- Строки сфер и проектов ----------

  const renderRows = () => {
    countRow('spheres');
    countRow('projects');
    q('[data-rows="spheres"]').innerHTML = spheres
      .map(
        (sp, i) =>
          `<div class="lobby-row lobby-sphere" data-i="${i}">` +
          `<i class="lobby-dot" style="background:${LAND_COLORS[i % LAND_COLORS.length]}"></i>` +
          `<input name="name" value="${esc(sp.name)}" maxlength="40" placeholder="Сфера ${i + 1}">` +
          `<select name="score" title="Сейчас">${options(10, sp.score)}</select><span>→</span>` +
          `<select name="target" title="Цель">${options(10, sp.target)}</select></div>`,
      )
      .join('');
    q('[data-rows="projects"]').innerHTML =
      projects
        .map(
          (p, i) =>
            `<div class="lobby-row lobby-project" data-i="${i}">` +
            `<input name="name" value="${esc(p.name)}" maxlength="40" placeholder="Например, ${['Английский B1', 'Ремонт кухни', 'Марафон', 'Свой сайт', 'Права', 'Книга'][i % 6]}">` +
            `<select name="sphere" title="Сфера">${spheres.map((sp, j) => `<option value="${j}"${j === p.sphere ? ' selected' : ''}>${esc(sp.name || `Сфера ${j + 1}`)}</option>`).join('')}</select>` +
            `<select name="kind" title="Когда работать">${KINDS.map((k) => `<option value="${k.id}"${k.id === p.kind ? ' selected' : ''}>${k.name}</option>`).join('')}</select>` +
            `<select name="hp" title="Размер миссии">${SIZES.map((z) => `<option value="${z.hp}"${z.hp === p.hp ? ' selected' : ''}>${z.name} (${z.hp})</option>`).join('')}</select></div>`,
        )
        .join('') +
      (projects.length > BALANCE.activeBasesLimit
        ? `<div class="hint">В игре одновременно до ${BALANCE.activeBasesLimit} баз, остальные заложатся законсервированными.</div>`
        : projects.length
          ? ''
          : '<div class="hint">Без проектов на карте будет только главная ратуша. Базы можно заложить потом: Меню → Проекты.</div>');
    redraw();
  };

  // Ввод в строку сразу меняет модель и превью, не перерисовывая поля (иначе сбивается фокус).
  host.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const row = el.closest<HTMLElement>('.lobby-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (row.classList.contains('lobby-sphere')) {
      const sp = spheres[i];
      if (el.name === 'name') {
        sp.name = el.value;
        // Названия сфер в выпадающих списках проектов.
        host.querySelectorAll<HTMLSelectElement>('.lobby-project select[name="sphere"]').forEach((s) => (s.options[i].text = el.value || `Сфера ${i + 1}`));
      }
      if (el.name === 'score') sp.score = Number(el.value);
      if (el.name === 'target') sp.target = Number(el.value);
    } else {
      const p = projects[i];
      if (el.name === 'name') p.name = el.value;
      if (el.name === 'sphere') p.sphere = Number(el.value);
      if (el.name === 'kind') p.kind = el.value as BaseKind;
      if (el.name === 'hp') p.hp = Number(el.value);
    }
    err.textContent = '';
    redraw();
  });

  // ---------- Герой, сложность, Легион ----------

  const renderHeroes = () => {
    q('.lobby-heroes').innerHTML = (Object.keys(HERO_KINDS) as HeroKind[])
      .map(
        (k) =>
          `<button class="btn lobby-hero${k === hero ? ' on' : ''}" data-k="${k}" title="${esc(HERO_KINDS[k].spells.join(', '))}"><i class="lobby-hero-icon">${btnArt(HERO_BTN[k])}<span>${HERO_KINDS[k].short}</span></i>` +
          `<b style="color:${HERO_KINDS[k].tint}">${HERO_KINDS[k].name}</b><span>${esc(HERO_KINDS[k].about)}</span></button>`,
      )
      .join('');
    q('.lobby-hero-hint').textContent =
      hero === 'mountainking'
        ? `Способности: ${HERO_KINDS[hero].spells.join(', ')}. Остальных героев можно призвать на алтарь позже.`
        : `Способности: ${HERO_KINDS[hero].spells.join(', ')}. Пока он выглядит как перекрашенный Горный король, а способности ещё в разработке.`;
  };
  q('.lobby-heroes').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (!b) return;
    hero = b.dataset.k as HeroKind;
    renderHeroes();
    redraw();
  });

  const renderPicks = () => {
    for (const [kind, value, table] of [
      ['difficulty', difficulty, DIFFICULTY],
      ['legion', legion, LEGION],
    ] as const) {
      host.querySelectorAll<HTMLElement>(`[data-pick="${kind}"] [data-v]`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
      q(`[data-hint="${kind}"]`).textContent = (table as Record<string, { hint: string }>)[value].hint;
    }
  };
  host.querySelectorAll<HTMLElement>('[data-pick]').forEach((box) =>
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (!b) return;
      if (box.dataset.pick === 'difficulty') difficulty = b.dataset.v as Difficulty;
      else legion = b.dataset.v as LegionMode;
      renderPicks();
      redraw();
    }),
  );

  // ---------- Превью карты ----------

  /** Состояние, каким его заложит «В бой!»: по нему считаются места баз и подписи земель. */
  const preview = (): GameState => {
    const s = createInitialState();
    s.spheres = spheres.map((sp, i) => ({ id: `s${i}`, name: sp.name || `Сфера ${i + 1}`, score: sp.score, target: sp.target }));
    for (const [i, p] of projects.entries()) {
      const sphereId = `s${p.sphere}`;
      s.projects.push({ id: `p${i}`, name: p.name, sphereId, kind: p.kind, fortressHp: p.hp, fortressMaxHp: p.hp, slot: freeSlot(s, sphereId), frozen: false } as Project);
    }
    assignColors(s);
    return s;
  };

  const redraw = () => {
    const s = preview();
    const W = Math.round(canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1)) || 360;
    if (canvas.width !== W) canvas.width = canvas.height = W;
    const ctx = canvas.getContext('2d')!;
    const k = W / (MAP_HALF * 2);
    const X = (x: number) => (x + MAP_HALF) * k;
    const Y = (z: number) => (MAP_HALF - z) * k;
    const art = mapArt();
    if (art) ctx.drawImage(art, 0, 0, W, W);
    else {
      ctx.fillStyle = '#3c5a24';
      ctx.fillRect(0, 0, W, W);
    }
    // Земли сфер: светлое пятно вокруг баз своей сферы.
    s.spheres.forEach((sp, i) => {
      for (const p of s.projects.filter((x) => x.sphereId === sp.id)) {
        const g = ctx.createRadialGradient(X(p.slot.x), Y(p.slot.z), 0, X(p.slot.x), Y(p.slot.z), 44 * k);
        g.addColorStop(0, LAND_COLORS[i % LAND_COLORS.length] + '88');
        g.addColorStop(1, LAND_COLORS[i % LAND_COLORS.length] + '00');
        ctx.fillStyle = g;
        ctx.fillRect(X(p.slot.x) - 44 * k, Y(p.slot.z) - 44 * k, 88 * k, 88 * k);
      }
    });
    const u = W / 360;
    for (const p of s.projects) {
      const main = p.id === MAIN_HALL_ID;
      if (!main) {
        const f = fortressSpot(p.slot);
        ctx.strokeStyle = 'rgba(212,58,42,0.5)';
        ctx.setLineDash([3 * u, 3 * u]);
        ctx.beginPath();
        ctx.moveTo(X(p.slot.x), Y(p.slot.z));
        ctx.lineTo(X(f.x), Y(f.z));
        ctx.stroke();
        ctx.setLineDash([]);
        const r = (3 + Math.sqrt(p.fortressMaxHp) * 0.8) * u;
        ctx.fillStyle = '#d43a2a';
        ctx.fillRect(X(f.x) - r, Y(f.z) - r, r * 2, r * 2);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(X(f.x) - r, Y(f.z) - r, r * 2, r * 2);
      }
      const size = (main ? 14 : 10) * u;
      ctx.fillStyle = projectColor(p);
      ctx.fillRect(X(p.slot.x) - size / 2, Y(p.slot.z) - size / 2, size, size);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5 * u;
      ctx.strokeRect(X(p.slot.x) - size / 2, Y(p.slot.z) - size / 2, size, size);
      const label = main ? 'Ратуша' : p.name || '…';
      ctx.font = `${11 * u}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(label, X(p.slot.x), Y(p.slot.z) + size / 2 + 12 * u);
      ctx.fillStyle = main ? '#ffd34d' : '#f4e7c5';
      ctx.fillText(label, X(p.slot.x), Y(p.slot.z) + size / 2 + 12 * u);
    }
    // Подписи земель, как на карте.
    ctx.font = `bold ${12 * u}px Georgia, serif`;
    for (const spot of landSpots(s)) {
      const i = s.spheres.findIndex((sp) => sp.id === spot.sphereId);
      const text = `${spot.name} ${spot.score}→${spot.target}`;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(text, X(spot.x), Y(spot.z));
      ctx.fillStyle = LAND_COLORS[i % LAND_COLORS.length];
      ctx.fillText(text, X(spot.x), Y(spot.z));
    }
    // Герой у ратуши.
    ctx.fillStyle = HERO_KINDS[hero].tint === '#ffffff' ? '#ffd34d' : HERO_KINDS[hero].tint;
    ctx.beginPath();
    ctx.arc(X(0) + 11 * u, Y(0) + 9 * u, 4 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1 * u;
    ctx.stroke();

    const named = projects.filter((p) => p.name.trim());
    const total = projects.reduce((n, p) => n + p.hp, 0);
    const gap = spheres.filter((sp) => sp.score < sp.target).length;
    q('.lobby-brief').innerHTML =
      `<b>Цель игры</b>` +
      `<div>Разрушить ${projects.length ? `${projects.length} ${plural(projects.length, 'вражескую крепость', 'вражеские крепости', 'вражеских крепостей')} (${total} ударов задачами)` : 'вражеские крепости проектов, когда заложишь базы'}.</div>` +
      `<div>Поднять ${gap ? `${gap} ${plural(gap, 'землю', 'земли', 'земель')} до цели` : 'земли'} на совете земель: когда все у цели, у горы Хиджал появится Архимонд.</div>` +
      `<div>Не пускать Легион: ${LEGION[legion].hint}.</div>` +
      (projects.length && named.length < projects.length ? `<div class="lobby-todo">Осталось назвать проектов: ${projects.length - named.length}.</div>` : '');
  };

  // Земля карты догружается после пароля: превью перерисовывается, когда она появится.
  const artWait = window.setInterval(() => {
    if (!host.isConnected) return window.clearInterval(artWait);
    if (mapArt()) {
      window.clearInterval(artWait);
      redraw();
    }
  }, 1000);

  // ---------- Загрузка и старт ----------

  const picker = q<HTMLInputElement>('input[name="import"]');
  q('[data-a="load"]').addEventListener('click', async () => {
    const how = await chooseLoad(host);
    if (how === 'file') picker.click();
    if (how === 'gist') openSettings(store, sync);
  });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    try {
      if (!(await importSave(store, file))) return;
      // Загруженная игра уже настроена: лобби закрывается.
      store.state.setupDone ??= Date.now();
      store.replace(store.state);
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });

  q('[data-a="go"]').addEventListener('click', () => {
    const val = (n: string) => (host.querySelector(`[name="${n}"]`) as HTMLInputElement).value || (st as unknown as Record<string, string>)[n];
    const unnamedSphere = spheres.findIndex((sp) => !sp.name.trim());
    const unnamed = projects.findIndex((p) => !p.name.trim());
    if (unnamedSphere >= 0 || unnamed >= 0) {
      err.textContent = unnamedSphere >= 0 ? `Назови сферу ${unnamedSphere + 1}.` : `Назови проект ${unnamed + 1}: так он будет подписан на карте.`;
      const row = host.querySelector<HTMLInputElement>(`[data-rows="${unnamedSphere >= 0 ? 'spheres' : 'projects'}"] [data-i="${unnamedSphere >= 0 ? unnamedSphere : unnamed}"] input`);
      row?.focus();
      return;
    }
    const workDays = [...host.querySelectorAll<HTMLInputElement>('input[name="day"]:checked')].map((i) => Number(i.value));
    const settings: Settings = {
      wakeUp: val('wakeUp'),
      bedtime: val('bedtime'),
      dayStart: val('dayStart'),
      dayEnd: val('dayEnd'),
      workDays,
      balance: { ...DIFFICULTY[difficulty].balance },
      legion,
    };
    host.classList.add('gone');
    store.startGame({ spheres, projects, hero, settings });
  });

  renderRows();
  renderHeroes();
  renderPicks();

  return {
    remove() {
      document.body.classList.remove('lobby');
      window.clearInterval(artWait);
      host.classList.add('gone');
      window.setTimeout(() => host.remove(), 400);
    },
  };
}

/** Откуда загрузить: файл сохранения или Gist (окно настроек). */
function chooseLoad(host: HTMLElement): Promise<'file' | 'gist' | null> {
  host.querySelector('.lobby-load')?.remove();
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'lobby-load';
    box.innerHTML =
      `<div class="hint">Продолжить прежнюю игру вместо новой.</div>` +
      `<button class="btn" data-v="file">Из файла</button><button class="btn" data-v="gist">Из Gist</button><button class="btn" data-v="">Отмена</button>`;
    host.querySelector('.actions')!.after(box);
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (!b) return;
      box.remove();
      resolve((b.dataset.v || null) as 'file' | 'gist' | null);
    });
  });
}
