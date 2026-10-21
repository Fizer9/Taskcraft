// Сцена карты: камера как в WC3, земля, свет по времени суток, базы и герой.

import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  PBRMaterial,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { loadArt } from '../assets/loader';
import { avatarActive } from '../state/abilities';
import { BALANCE, HERO_KINDS } from '../state/config';
import { allDemons, unitHealth, activeDreadlord, activeTaskOf, currentShift, fortressSpot, demonRank, demonsAt, idleGuardTripped, isBlighted, localDay, meteorOf, miningFactor, portalSize, tuning, type Shift } from '../state/economy';
import type { Store } from '../state/store';
import { MAIN_HALL_ID, type BuildingId, type HeroKind, type Project } from '../state/types';
import { Base } from './base';
import { LAND_H, LAND_W, Lands, landSpots, type LandSpot } from './lands';
import { ARCHIMONDE_LOOK, BossFx, DREADLORD_LOOK } from './boss';
import { BUILDING_SPOTS } from './buildings';
import { LATE_MODELS, MODEL_NAMES, ModelLibrary, type ModelName } from './library';
import { MAX_SCALE, Pacer } from './pacer';
import { SelectionFx, type Target, type UnitNode } from './selection';
import { HpBars, NameTags, type Bar } from './hpbars';
import { turnTowards, type ModelInstance } from './models';
import * as P from './placeholders';
import { Ground, TerrainMap, hasBlightTiles, minimapArt, terrainMaterial } from './terrain';
import { Blobs, Confirm, HeroGlow, Lake, Rain, mapEdge, type Caster } from './ambience';

export const MAP_HALF = 200;

// Камера WC3 по умолчанию: угол атаки 304° (56° вниз от горизонта), дистанция 1650,
// поле зрения 70° по ширине экрана 4:3 (по высоте это 55°). Колесом WC3 приближает и отдаляет
// в разумных пределах, вращать камеру нельзя.
const CAMERA_BETA = (34 * Math.PI) / 180;
const CAMERA_ALPHA = -Math.PI / 2;
const CAMERA_FOV = 2 * Math.atan(Math.tan((35 * Math.PI) / 180) * 0.75);
const CAMERA_DISTANCE = 1650 * 0.025;
const CAMERA_NEAR = 26;
const CAMERA_FAR = 80;

/** Скорость шага героя, под которую сделана его анимация ходьбы: 270 единиц WC3. */
const HERO_WALK = 270 * 0.025;

const LIGHTING: Record<Shift, { sun: number; sky: number; tint: string; clear: string }> = {
  day: { sun: 1.0, sky: 0.65, tint: '#fff4dc', clear: '#0d1117' },
  weekend: { sun: 1.0, sky: 0.65, tint: '#fff4dc', clear: '#0d1117' },
  evening: { sun: 0.75, sky: 0.5, tint: '#ffc58a', clear: '#120c0a' },
  night: { sun: 0.35, sky: 0.35, tint: '#8fa4ff', clear: '#05070d' },
};

/** Алтарь главной ратуши в координатах базы, место выхода героя на смену и места запаса. */
const ALTAR = new Vector3(13, 0, 10);
const ALTAR_EXIT = new Vector3(13, 0, 5);
const RESERVE_SPOTS = [new Vector3(17.5, 0, 6), new Vector3(8.5, 0, 6)];

/** Модель героя по классу; пока она не загружена, вместо неё перекрашенный Горный король. */
const HERO_MODEL: Record<HeroKind, ModelName> = {
  mountainking: 'heromountainking',
  paladin: 'heropaladin',
  archmage: 'heroarchmage',
  bloodmage: 'herobloodelf',
};
/** Свечение под героем цветом класса, как командный цвет героев в WC3. */
const HERO_GLOW: Record<HeroKind, string> = { mountainking: '#ffd34d', paladin: '#ffe9a0', archmage: '#7fb2ff', bloodmage: '#ff6a4a' };
/** Дождь идёт, когда у стен столько демонов или больше: плохие дни. */
const RAIN_DEMONS = 3;

/** Перекраска модели Горного короля под класс героя, пока своей модели нет. */
function tint(model: ModelInstance, hex: string) {
  if (hex.toLowerCase() === '#ffffff') return;
  const color = Color3.FromHexString(hex);
  for (const m of model.root.getChildMeshes()) {
    const mat = m.material;
    if (!(mat instanceof PBRMaterial)) continue;
    const own = mat.clone(mat.name + '-tint');
    own.albedoColor = color;
    // Лёгкое свечение цветом класса, чтобы героя было видно издалека.
    own.emissiveColor = color.scale(0.35);
    m.material = own;
  }
}

export class World {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private bases = new Map<string, Base>();
  private heroNode: TransformNode;
  private heroTarget = new Vector3();
  private heroModel: ModelInstance | null = null;
  private heroFallen = false;
  private heroId = '';
  private lib: ModelLibrary | null = null;
  private caster: (m: AbstractMesh) => void = () => {};
  /** Герои в запасе стоят у алтаря главной ратуши. */
  private reserve = new Map<string, { node: TransformNode; model: ModelInstance | null; fallen: boolean }>();
  /** Разовая анимация героя (бросок молота, удар грома) и до какого момента она идёт. */
  private heroAction = 0;
  private spellSeen = '';
  private forest: { node: TransformNode; scale: number }[] = [];
  /** Деревья-модели после загрузки (на месте заглушек из forest). */
  private trees: TransformNode[] = [];
  /** Сетка земли последней раскраски и картинка мини-карты по ней. */
  private groundMap: TerrainMap | null = null;
  private miniArt: HTMLCanvasElement | null = null;
  private miniDirty = true;
  /** Какие базы под скверной на нарисованной земле: при смене земля перерисовывается. */
  private blightSig = '';
  /** Образцы моделей для копий-инстансов, один на вид. */
  private samples = new Map<ModelName, { mesh: Mesh; local: Matrix }[]>();
  /** Деревья и камни из копий: прячутся, когда на их месте закладывают новую базу. */
  private scenery: TransformNode[] = [];
  /** Мелочи у каждой базы, чтобы убрать их вместе с базой. */
  private decorOf = new Map<string, TransformNode[]>();
  /** Подпись базы на сцене: при её смене база перестраивается. */
  private baseSig = new Map<string, string>();
  private lands: Lands;
  private dreadlord: BossFx;
  private archimonde: BossFx;
  private landsAt: LandSpot[] = [];
  private selMat: StandardMaterial | null = null;
  private sun: DirectionalLight;
  private sky: HemisphericLight;
  private shadows: ShadowGenerator;
  private keys = new Set<string>();
  private pacer: Pacer;
  /** Секунды с прошлого нарисованного кадра: их считает pacer, а не движок. */
  private dt = 0;
  private mouse = { x: -1, y: -1, inside: false };
  /** Куда доедет зум колесом: камера догоняет его плавно, с инерцией. */
  private zoomGoal = CAMERA_DISTANCE;
  /** Куда плавно летит камера (пробел, F1, «Камера на базу»); null, когда стоит. */
  private flyGoal: Vector3 | null = null;
  /** Палец двигал карту: такое касание не выбирает базу. */
  private touchDragged = false;
  private selected: string | null = null;
  private selFx: SelectionFx;
  private hpBars = new HpBars();
  private nameTags = new NameTags();
  private barsShown = false;
  /** Выбранные юниты задач и герой: под ними зелёные круги. */
  private selTasks: string[] = [];
  private selHero = false;
  /** Что под курсором мыши; ищется заново, только когда мышь сдвинулась. */
  private hovered: Target | null = null;
  private hoverDirty = false;
  private blobs: Blobs;
  private glow: HeroGlow;
  private rain: Rain;
  private confirm: Confirm;
  private lake: Lake | null = null;
  private lakeDecor: TransformNode[] = [];
  /** Уровень героя по прошлой синхронизации: новый уровень зажигает столб света. */
  private heroLevel = 0;
  onSelectBase: (id: string | null) => void = () => {};
  onSelectTask: (id: string) => void = () => {};
  onSelectHero: () => void = () => {};
  /** Рамка мышью захватила несколько своих юнитов (и, может быть, героя). */
  onSelectGroup: (taskIds: string[], hero: boolean) => void = () => {};
  /** Правый клик по базе при выбранном герое: приказ идти туда. */
  onOrderHero: (baseId: string) => void = () => {};
  /** Shift-клик: добавить юнит к выбору или убрать из него. Двойной клик: все такие же на экране. */
  onToggleUnit: (taskId: string) => void = () => {};
  onSelectSame: (taskIds: string[]) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
  ) {
    // Телефон: тени помельче и мягче размытие, иначе видеочип греется и сажает батарею.
    const phone = matchMedia('(pointer: coarse)').matches;
    this.engine = new Engine(canvas, true, { stencil: true });
    this.scene = new Scene(this.engine);

    this.camera = new ArcRotateCamera('cam', CAMERA_ALPHA, CAMERA_BETA, CAMERA_DISTANCE, Vector3.Zero(), this.scene);
    this.camera.fov = CAMERA_FOV;
    this.camera.lowerRadiusLimit = CAMERA_NEAR;
    this.camera.upperRadiusLimit = CAMERA_FAR;
    this.camera.inputs.clear(); // вращение камеры в WC3 недоступно, только сдвиг и зум

    this.sky = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    this.sky.groundColor = new Color3(0.25, 0.22, 0.2);
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.6), this.scene);
    this.sun.position = new Vector3(100, 150, -100);
    this.shadows = new ShadowGenerator(phone ? 1024 : 2048, this.sun);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = phone ? 8 : 16;
    this.shadows.darkness = 0.45;

    this.makeGround();
    mapEdge(this.scene, MAP_HALF);
    this.scatterTrees();
    this.lands = new Lands(this.scene);
    this.selFx = new SelectionFx(this.scene);
    this.dreadlord = new BossFx(this.scene, DREADLORD_LOOK);
    this.archimonde = new BossFx(this.scene, ARCHIMONDE_LOOK);
    this.blobs = new Blobs(this.scene);
    this.rain = new Rain(this.scene);
    this.confirm = new Confirm(this.scene);

    for (const p of store.state.projects) this.bases.set(p.id, new Base(this.scene, p));
    this.heroNode = P.hero(this.scene);
    this.heroNode.getChildMeshes().forEach((m) => (m.metadata = { hero: true }));
    this.heroNode.position.copyFrom(this.bases.get(store.state.hero.baseId)!.heroSpot());
    this.heroTarget.copyFrom(this.heroNode.position);
    this.camera.target.copyFrom(this.heroNode.position);
    this.glow = new HeroGlow(this.scene, this.heroNode);

    for (const m of this.scene.meshes) {
      if (m.name !== 'ground' && m.name !== 'dirt' && !m.name.startsWith('label') && !m.name.startsWith('hp')) this.shadows.addShadowCaster(m, false);
    }

    this.bindInput();
    this.applyLighting();

    // Частота кадров по обстановке (pacer.ts). Слабым телефонам (4 ядра и меньше или мало
    // памяти) 3D сразу рисуется чуть мельче, дальше pacer подстроит сам.
    const weak = navigator.hardwareConcurrency <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
    this.pacer = new Pacer(
      {
        covered: () => {
          if (document.body.classList.contains('kb') || document.getElementById('modal-root')?.childElementCount) return true;
          // Телефон стоя: открытые свитки закрывают почти всю карту.
          return phone && window.innerWidth <= 700 && !document.getElementById('side')?.classList.contains('hidden');
        },
        setScale: (level) => this.engine.setHardwareScalingLevel(level),
      },
      phone,
      !navigator.webdriver,
      // На компьютере 3D рисуется в настоящих пикселях экрана (при масштабе Windows 125–150%
      // иначе картинка и надписи мыльные), но не больше чем вдвое.
      phone ? (weak ? 1.25 : 1) : 1 / Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      phone ? MAX_SCALE : 1,
    );
    const poke = () => this.pacer.poke(performance.now());
    for (const ev of ['pointerdown', 'wheel', 'touchmove'] as const) canvas.addEventListener(ev, poke, { passive: true });
    canvas.addEventListener('pointermove', (e) => e.buttons && poke(), { passive: true });
    this.scene.onBeforeRenderObservable.add(() => this.frame(this.dt));
    this.engine.runRenderLoop(() => {
      const dt = this.pacer.frame(performance.now());
      if (dt === null) return;
      this.dt = dt;
      this.scene.render();
    });
    window.addEventListener('resize', () => this.engine.resize());
  }

  /** Трава Лордерона: зелёная земля с пятнами, нарисованная в текстуре. */
  private makeGround() {
    const ground = MeshBuilder.CreateGround('ground', { width: MAP_HALF * 2, height: MAP_HALF * 2 }, this.scene);
    const tex = new DynamicTexture('grass', 1024, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#4c6b2c';
    ctx.fillRect(0, 0, 1024, 1024);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tones = ['#577a33', '#41602a', '#5d7f38', '#6b7a3a', '#4a5f2a'];
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
      ctx.globalAlpha = 0.25 + rnd() * 0.35;
      ctx.beginPath();
      ctx.arc(rnd() * 1024, rnd() * 1024, 2 + rnd() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    tex.update();
    tex.uScale = tex.vScale = 6;
    const m = new StandardMaterial('groundMat', this.scene);
    m.diffuseTexture = tex;
    m.specularColor = Color3.Black();
    ground.material = m;
    ground.receiveShadows = true;
    ground.isPickable = true;
  }

  /** Лес по краям карты и между базами, чтобы карта не выглядела пустой. */
  private scatterTrees() {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const slots = this.store.state.projects.map((p) => p.slot);
    for (let i = 0; i < 420; i++) {
      const x = (rnd() * 2 - 1) * (MAP_HALF - 4);
      const z = (rnd() * 2 - 1) * (MAP_HALF - 4);
      // Не сажаем деревья на базы и на крепости (крепость в 48 единицах наружу от базы).
      const blocked = slots.some((s) => {
        const len = Math.hypot(s.x, s.z) || 1;
        const fx = s.x + (s.x / len) * 48;
        const fz = s.z + (s.z / len) * 48;
        return Math.hypot(x - s.x, z - s.z) < 34 || (len > 1 && Math.hypot(x - fx, z - fz) < 12);
      });
      if (blocked) continue;
      const scale = 0.8 + rnd() * 0.6;
      const t = P.tree(this.scene, scale);
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * Math.PI;
      this.forest.push({ node: t, scale });
    }
  }

  /** Земля Лордерона из тайлов WC3: базы на утоптанной земле, дороги к главной ратуше. */
  async loadTerrain(): Promise<boolean> {
    const map = new TerrainMap(MAP_HALF);
    map.meadows();
    for (const p of this.store.state.projects) {
      if (p.slot.x || p.slot.z) map.path(Ground.Rough, 0, 0, p.slot.x, p.slot.z, 2.6);
    }
    for (const b of this.bases.values()) b.paintGround(map);
    // Скверна WC3 на заброшенных и захваченных базах, поверх всей остальной земли.
    const s = this.store.state;
    const blighted = s.projects.filter((p) => isBlighted(s, p) || !!p.capturedAt);
    this.blightSig = blighted.map((p) => p.id).join();
    for (const p of blighted) map.disc(Ground.Blight, p.slot.x, p.slot.z, 27, 0.35);
    // Озеро у главной ратуши: берег из земли и камня под водой.
    const lake = this.placeLake();
    if (lake) {
      map.disc(Ground.Rough, lake.x, lake.z, lake.r + 3.5, 0.3);
      map.disc(Ground.Dirt, lake.x, lake.z, lake.r + 1.5, 0.2);
    }
    const mat = await terrainMaterial(this.scene, map);
    if (!mat) return false;
    for (const b of this.bases.values()) b.useBlightTiles(hasBlightTiles());
    this.groundMap = map;
    this.miniDirty = true;
    const ground = this.scene.getMeshByName('ground')!;
    ground.material?.dispose(true, true);
    ground.material = mat;
    return true;
  }

  /**
   * Место озера: ближайшее к главной ратуше свободное место, где нет баз, крепостей,
   * подписей земель и зданий. Озеро переезжает, если на его месте заложили базу.
   */
  private placeLake(): Lake | null {
    const s = this.store.state;
    const R = 11;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let x = -MAP_HALF + 30; x <= MAP_HALF - 30; x += 10)
      for (let z = -MAP_HALF + 30; z <= MAP_HALF - 30; z += 10) {
        const d = Math.hypot(x, z);
        if (d < 60 || d >= bestD) continue;
        const free =
          s.projects.every((p) => {
            const f = fortressSpot(p.slot);
            return Math.hypot(x - p.slot.x, z - p.slot.z) > 48 && Math.hypot(x - f.x, z - f.z) > 28;
          }) &&
          this.landsAt.every((l) => Math.abs(x - l.x) > LAND_W / 2 + R + 4 || Math.abs(z - l.z) > LAND_H / 2 + R + 4) &&
          Math.hypot(x, z - 40) > 30;
        if (free) {
          best = { x, z };
          bestD = d;
        }
      }
    if (this.lake && best && this.lake.x === best.x && this.lake.z === best.z) return this.lake;
    this.lake?.dispose();
    for (const h of this.lakeDecor) h.dispose();
    this.lakeDecor = [];
    this.lake = best ? new Lake(this.scene, best.x, best.z, R) : null;
    if (this.lake) {
      this.clearCircle(this.lake.x, this.lake.z, R + 4);
      if (this.lib) this.dressLake(this.lib);
    }
    return this.lake;
  }

  /** Камыш по берегу озера и кувшинки на воде. */
  private dressLake(lib: ModelLibrary) {
    const lake = this.lake;
    if (!lake || this.lakeDecor.length || !lib.has('riverrushes0')) return;
    const items = lake.shore(14).map((pos, i) => ({ model: 'riverrushes0' as ModelName, pos, rot: i * 1.9, scale: 0.9 + (i % 3) * 0.15 }));
    if (lib.has('lilypad0'))
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4 + 0.5;
        const d = lake.r * (0.35 + 0.4 * ((i * 0.618) % 1));
        items.push({ model: 'lilypad0', pos: new Vector3(lake.x + Math.cos(a) * d, 0.14, lake.z + Math.sin(a) * d), rot: i * 1.3, scale: 0.8 + (i % 2) * 0.3 });
      }
    this.lakeDecor = this.placeCopies(lib, items);
  }

  /** Деревья и камни в круге убираются (под озером). */
  private clearCircle(x: number, z: number, r: number) {
    const inside = (v: Vector3) => Math.hypot(v.x - x, v.z - z) < r;
    for (const t of this.forest) if (inside(t.node.position)) t.node.setEnabled(false);
    for (const h of this.scenery) if (inside(h.position)) h.setEnabled(false);
    this.miniDirty = true;
  }

  /** Насколько камера у озера и у лесопилки, 0..1: по этому звучат ручей и мельница. */
  ambientNear(): { stream: number; mill: number } {
    const t = this.camera.target;
    const near = (x: number, z: number, r: number) => Math.max(0, Math.min(1, 1.4 - Math.hypot(t.x - x, t.z - z) / r));
    const s = this.store.state;
    const mill = s.buildings?.lumbermill ? near(BUILDING_SPOTS.lumbermill.x, BUILDING_SPOTS.lumbermill.z, 40) : 0;
    return { stream: this.lake ? near(this.lake.x, this.lake.z, this.lake.r + 30) : 0, mill };
  }

  /** Идёт ли дождь (по нему играет шум дождя). */
  get raining(): boolean {
    return this.rain.raining;
  }

  /**
   * Подгружает модели WC3 и ставит их вместо заглушек. Вызывается после ввода пароля,
   * потому что зашифрованные модели без него не прочитать.
   */
  async loadModels(): Promise<number> {
    const lib = new ModelLibrary(this.scene);
    // Сначала то, из чего состоит база на экране; юниты и Легион догружает loadLateModels.
    const count = await lib.loadAll(MODEL_NAMES.filter((n) => !LATE_MODELS.includes(n)));
    if (!count) return 0;
    // PBR-материалам моделей нужно больше света, чем простым материалам земли и заглушек.
    for (const m of this.scene.materials) if (m instanceof PBRMaterial) m.directIntensity = 2.4;
    const caster = (m: AbstractMesh) => {
      this.shadows.addShadowCaster(m, false);
      m.receiveShadows = true;
    };
    for (const b of this.bases.values()) b.applyModels(lib, caster);

    this.lib = lib;
    this.caster = caster;
    this.dressHero();
    this.syncReserve();
    this.plantForest(lib);
    this.placeDecor(lib);
    this.dressLake(lib);
    this.dreadlord.setLibrary(lib, caster);
    this.archimonde.setLibrary(lib, caster);
    void this.loadSelection();
    return count;
  }

  /** Вторая очередь моделей (LATE_MODELS): юниты, демоны и врата заменяют свои заглушки. */
  async loadLateModels(): Promise<number> {
    const lib = this.lib;
    if (!lib) return 0;
    const count = await lib.loadAll(LATE_MODELS);
    if (!count) return 0;
    for (const m of this.scene.materials) if (m instanceof PBRMaterial) m.directIntensity = 2.4;
    for (const b of this.bases.values()) b.upgradeModels();
    this.dreadlord.setLibrary(lib, this.caster);
    this.archimonde.setLibrary(lib, this.caster);
    // Догрузились свои модели других героев: меняем перекрашенного Горного короля на них.
    if ((this.store.state.hero.kind ?? 'mountainking') !== 'mountainking') this.dressHero();
    for (const r of this.reserve.values()) {
      r.model?.dispose();
      r.model = null;
    }
    this.syncReserve();
    return count;
  }

  /**
   * Сотни деревьев как отдельные модели со своими костями слишком тяжелы, поэтому на каждый вид
   * дерева делается один образец, а лес состоит из его копий-инстансов (качаются они вместе).
   */
  private plantForest(lib: ModelLibrary) {
    const kinds = [0, 1, 2, 3].map((v) => `lordaerontree${v}` as ModelName);
    if (!kinds.every((k) => lib.has(k))) return;
    this.trees = this.placeCopies(
      lib,
      this.forest.filter(({ node }) => node.isEnabled()).map(({ node, scale }, i) => ({ model: kinds[i % 4], pos: node.position, rot: node.rotation.y, scale: scale * 0.85 })),
    );
    this.scenery.push(...this.trees);
    for (const { node } of this.forest) node.dispose();
    this.forest = [];
    this.miniDirty = true;
  }

  /** Мелочи у баз и камни по всей карте. */
  private placeDecor(lib: ModelLibrary) {
    for (const b of this.bases.values()) this.decorOf.set(b.project.id, this.placeCopies(lib, b.decor().filter((it) => lib.has(it.model))));
    const items: { model: ModelName; pos: Vector3; rot: number; scale: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const slots = this.store.state.projects.map((p) => p.slot);
    for (let i = 0; i < 70; i++) {
      const x = (rnd() * 2 - 1) * (MAP_HALF - 6);
      const z = (rnd() * 2 - 1) * (MAP_HALF - 6);
      const rot = rnd() * Math.PI * 2;
      const scale = 0.7 + rnd() * 0.7;
      const kind = `lords_rock${Math.floor(rnd() * 4)}` as ModelName;
      if (slots.some((s) => Math.hypot(x - s.x, z - s.z) < 30)) continue;
      items.push({ model: kind, pos: new Vector3(x, 0, z), rot, scale });
    }
    // Кусты летней травы по всей карте, как на картах Лордерона.
    for (let i = 0; i < 160; i++) {
      const x = (rnd() * 2 - 1) * (MAP_HALF - 6);
      const z = (rnd() * 2 - 1) * (MAP_HALF - 6);
      const kind = `summergrass${Math.floor(rnd() * 2)}` as ModelName;
      if (slots.some((s) => Math.hypot(x - s.x, z - s.z) < 28)) continue;
      items.push({ model: kind, pos: new Vector3(x, 0, z), rot: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.6 });
    }
    this.scenery.push(
      ...this.placeCopies(
        lib,
        items.filter((it) => lib.has(it.model)),
      ),
    );
    this.clearLands();
  }

  /**
   * Сотни моделей со своими костями слишком тяжелы, поэтому для неподвижных вещей (деревья, камни,
   * ящики) делается один образец на вид, а на карте стоят его копии-инстансы.
   */
  private placeCopies(lib: ModelLibrary, items: { model: ModelName; pos: Vector3; rot: number; scale: number }[]): TransformNode[] {
    const samples = this.samples;
    const sample = (name: ModelName) => {
      let parts = samples.get(name);
      if (parts) return parts;
      const inst = lib.create(name)!;
      inst.playLike('Stand');
      // Положение каждой части относительно корня модели (с масштабом и поворотом из glTF).
      const inv = inst.root.computeWorldMatrix(true).clone().invert();
      const meshes = inst.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0 && m.isEnabled());
      parts = meshes.map((mesh) => ({ mesh, local: mesh.computeWorldMatrix(true).multiply(inv) }));
      inst.root.position.y = -1000; // сам образец прячем под землю, видны только его копии
      samples.set(name, parts);
      return parts;
    };
    return items.map(({ model, pos, rot, scale }, i) => {
      const holder = new TransformNode(model + 'Copy', this.scene);
      holder.position.copyFrom(pos);
      holder.rotation.y = rot;
      holder.scaling.setAll(scale);
      for (const { mesh, local } of sample(model)) {
        const copy = mesh.createInstance(`${model}${i}`);
        copy.parent = holder;
        local.decompose(copy.scaling, (copy.rotationQuaternion = new Quaternion()), copy.position);
        copy.isPickable = false;
        this.shadows.addShadowCaster(copy, false);
      }
      return holder;
    });
  }

  /** Круг выделения WC3: зелёный у баз, как у своих зданий в игре. */
  private async loadSelection() {
    const bytes = await loadArt('ui/selection.png');
    if (!bytes) return;
    const tex = new Texture(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })), this.scene);
    tex.hasAlpha = true;
    const mat = new StandardMaterial('selMat', this.scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.emissiveColor = Color3.FromHexString('#2bff2b');
    mat.backFaceCulling = false;
    this.selMat = mat;
    for (const b of this.bases.values()) b.useSelectionTexture(mat);
    this.selFx.useTexture(tex);
  }

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      // Alt держат ради полосок здоровья: браузер не должен уводить фокус в своё меню.
      if (e.key === 'Alt') e.preventDefault();
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') e.preventDefault();
      this.keys.delete(e.key.toLowerCase());
    });
    // Щипок на тачпаде браузер понимает как Ctrl+колесо и увеличивает всю страницу,
    // а интерфейс уезжает за края окна. В игре масштаб меняет только камера.
    window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY, inside: true };
      this.hoverDirty = true;
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouse.inside = false;
      this.hovered = null;
      document.body.dataset.cursor = '';
    });
    this.bindBox();
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Мышь даёт шаги по ~100, тачпад мелкие доли: зум пропорционален сдвигу колеса.
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        this.zoomGoal = clampZoom(this.zoomGoal * Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0013));
      },
      { passive: false },
    );
    this.bindTouch();
    // Правый клик, как в WC3: выбранный герой идёт к базе под курсором, на земле
    // вспыхивают зелёные стрелки приказа.
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 2 || !this.selHero) return;
      const pick = this.scene.pick(e.offsetX, e.offsetY);
      const meta = pick?.pickedMesh?.metadata as { baseId?: string; taskId?: string } | null;
      const p = meta?.baseId ? this.store.project(meta.baseId) : null;
      if (!p || meta?.taskId) return;
      this.confirm.show(this.bases.get(p.id)!.heroSpot());
      this.onOrderHero(p.id);
    });
    let lastClick = { id: '', at: 0 };
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || this.touchDragged) return;
      const pick = this.scene.pick(e.offsetX, e.offsetY);
      const meta = pick?.pickedMesh?.metadata as { baseId?: string; taskId?: string; hero?: boolean } | null;
      if (meta?.hero) return this.onSelectHero();
      if (meta?.taskId) {
        // Shift добавляет юнит к выбору, двойной клик выбирает всех того же уровня на экране.
        if (e.shiftKey) return this.onToggleUnit(meta.taskId);
        const now = performance.now();
        const double = lastClick.id === meta.taskId && now - lastClick.at < 400;
        lastClick = { id: meta.taskId, at: now };
        if (double) return this.onSelectSame(this.sameOnScreen(meta.taskId));
        return this.onSelectTask(meta.taskId);
      }
      const id = meta?.baseId ?? null;
      if (id) {
        this.select(id);
        this.onSelectBase(id);
      }
    });
  }

  /**
   * Телефон: карта тянется пальцем, щипок двумя пальцами меняет масштаб. Короткое
   * касание без сдвига остаётся выбором, как щелчок мышью.
   */
  private bindTouch() {
    const touches = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0 };
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return void (this.touchDragged = false);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        this.touchDragged = false;
      }
      if (touches.size === 2) pinch = spread();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const prev = touches.get(e.pointerId);
      if (!prev) return;
      const now = { x: e.clientX, y: e.clientY };
      touches.set(e.pointerId, now);
      const c = this.camera;
      if (touches.size === 1) {
        if (Math.hypot(now.x - start.x, now.y - start.y) > 8) this.touchDragged = true;
        if (!this.touchDragged) return;
        this.flyGoal = null;
        // Сколько земли в одном пикселе на расстоянии камеры; по глубине земля под наклоном растянута.
        const k = (2 * c.radius * Math.tan(c.fov / 2)) / this.canvas.clientHeight;
        const t = c.target;
        t.x = Math.max(-MAP_HALF, Math.min(MAP_HALF, t.x - (now.x - prev.x) * k));
        t.z = Math.max(-MAP_HALF, Math.min(MAP_HALF, t.z + ((now.y - prev.y) * k) / Math.sin(CAMERA_BETA + 0.6)));
      } else if (touches.size === 2) {
        this.touchDragged = true;
        const d = spread();
        if (pinch > 0 && d > 0) c.radius = this.zoomGoal = clampZoom((c.radius * pinch) / d);
        pinch = d;
      }
    });
    const end = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      pinch = touches.size === 2 ? spread() : 0;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  select(id: string | null) {
    if (this.selected) this.bases.get(this.selected)?.setSelected(false);
    this.selected = id;
    if (id) this.bases.get(id)?.setSelected(true);
  }

  /** Круги под выбранными юнитами задач и героем. */
  selectUnits(taskIds: string[], hero: boolean) {
    this.selTasks = taskIds;
    this.selHero = hero;
  }

  /** Все юниты задач на сцене. */
  private units(): UnitNode[] {
    return [...this.bases.values()].flatMap((b) => b.units());
  }

  /**
   * Рамка мышью, как в WC3: зажал левую кнопку на карте и потянул, отпустил, и выбраны
   * все свои юниты внутри. Демоны Легиона в рамку не попадают.
   */
  private bindBox() {
    const box = document.createElement('div');
    box.id = 'selbox';
    document.body.appendChild(box);
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    const rect = (e: PointerEvent) => ({
      x0: Math.min(start!.x, e.clientX),
      y0: Math.min(start!.y, e.clientY),
      x1: Math.max(start!.x, e.clientX),
      y1: Math.max(start!.y, e.clientY),
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!start || !(e.buttons & 1)) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      dragging = true;
      this.touchDragged = true;
      const r = rect(e);
      Object.assign(box.style, { display: 'block', left: `${r.x0}px`, top: `${r.y0}px`, width: `${r.x1 - r.x0}px`, height: `${r.y1 - r.y0}px` });
    });
    window.addEventListener('pointerup', (e) => {
      if (!start) return;
      if (dragging) {
        const r = rect(e);
        const inside = (n: TransformNode) => {
          const p = this.toScreen(n.getAbsolutePosition());
          return !!p && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
        };
        const ids = this.units()
          .filter((u) => !u.enemy && u.node.isEnabled() && inside(u.node))
          .map((u) => u.taskId);
        const hero = this.heroNode.isEnabled() && !this.heroFallen && inside(this.heroNode);
        if (ids.length || hero) this.onSelectGroup(ids, hero);
      }
      start = null;
      dragging = false;
      box.style.display = 'none';
    });
  }

  /** Свои юниты того же уровня, что у юнита taskId, которые сейчас видны на экране. */
  private sameOnScreen(taskId: string): string[] {
    const level = this.store.task(taskId)?.level;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return this.units()
      .filter((u) => !u.enemy && u.node.isEnabled() && this.store.task(u.taskId)?.level === level)
      .filter((u) => {
        const p = this.toScreen(u.node.getAbsolutePosition());
        return !!p && p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
      })
      .map((u) => u.taskId);
  }

  /** Камера к юниту задачи (вызов группы двойным нажатием цифры). */
  focusUnit(taskId: string) {
    const u = this.units().find((x) => x.taskId === taskId);
    if (!u) return false;
    const p = u.node.getAbsolutePosition();
    this.flyTo(p.x, p.z);
    return true;
  }

  /** Точка мира в пикселях окна; null, если она за камерой. */
  toScreen(p: Vector3): { x: number; y: number } | null {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const v = Vector3.Project(p, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    if (v.z < 0 || v.z > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x / w) * r.width, y: r.top + (v.y / h) * r.height };
  }

  /** Что под курсором: юнит, герой или база. */
  private pickHover(): Target | null {
    const r = this.canvas.getBoundingClientRect();
    const pick = this.scene.pick(this.mouse.x - r.left, this.mouse.y - r.top);
    const meta = pick?.pickedMesh?.metadata as { baseId?: string; taskId?: string; hero?: boolean } | null;
    const u = meta?.taskId ? this.units().find((x) => x.taskId === meta.taskId) : undefined;
    const p = meta?.baseId ? this.store.project(meta.baseId) : null;
    // Курсор WC3: красная перчатка над врагом (демоны, база в руках Легиона), зелёная над своим.
    const cursor = u?.enemy || (!u && p?.capturedAt) ? 'enemy' : meta?.hero || u || p ? 'own' : '';
    if (document.body.dataset.cursor !== cursor) document.body.dataset.cursor = cursor;
    if (meta?.hero) return { key: 'hero', node: this.heroNode, size: 3.6 };
    if (meta?.taskId) return u ? { key: u.taskId, node: u.node, size: u.size } : null;
    if (p && p.id !== this.selected) return { key: 'base:' + p.id, node: null, at: new Vector3(p.slot.x, 0, p.slot.z), size: 17 };
    return null;
  }

  /**
   * Полоски здоровья: с зажатым Alt над всеми юнитами, героем и зданиями, без него
   * только над тем, что под курсором, как в WC3.
   */
  private drawBars() {
    const all = this.keys.has('alt');
    const s = this.store.state;
    const bars: Bar[] = [];
    const unitBar = (u: { taskId: string; node: TransformNode; size: number; enemy?: boolean }) => {
      const t = this.store.task(u.taskId);
      bars.push({ node: u.node, lift: u.size + 0.8, health: u.enemy || !t ? 1 : unitHealth(t), width: 34 });
    };
    const heroBar = () => bars.push({ node: this.heroNode, lift: 5, health: s.hero.mana / Math.max(1, s.hero.maxMana), width: 46 });
    const hallBar = (p: Project) => bars.push({ node: null, at: new Vector3(p.slot.x, 0, p.slot.z), lift: 11, health: 1 - (p.damage ?? 0) / 100, width: 90 });
    if (all) {
      for (const u of this.units()) unitBar(u);
      if (this.heroNode.isEnabled() && !this.heroFallen) heroBar();
      for (const p of s.projects) {
        hallBar(p);
        const c = s.construction;
        for (const b of this.bases.get(p.id)?.structures() ?? [])
          bars.push({ node: b.node, lift: 7, health: b.scaffold && c ? 1 - c.leftMs / Math.max(1, c.totalMs) : 1 - (p.damage ?? 0) / 100, width: 64 });
      }
    } else if (this.hovered) {
      const h = this.hovered;
      if (h.key === 'hero') heroBar();
      else if (h.key.startsWith('base:')) {
        const p = this.store.project(h.key.slice(5));
        if (p) hallBar(p);
      } else {
        const u = this.units().find((x) => x.taskId === h.key);
        if (u) unitBar(u);
      }
    }
    // Названия баз не висят над ратушами всё время, как в WC3: только у выбранной и под курсором.
    const tagged = new Set([this.selected, this.hovered?.key.startsWith('base:') ? this.hovered.key.slice(5) : null]);
    const tags = [...tagged].flatMap((id) => {
      const p = id ? this.store.project(id) : null;
      const b = id ? this.bases.get(id) : null;
      return p && b ? [{ at: new Vector3(p.slot.x, 11.6, p.slot.z), ...b.label }] : [];
    });
    this.nameTags.draw(tags, (p) => this.toScreen(p));
    if (!bars.length && !this.barsShown) return;
    this.barsShown = bars.length > 0;
    this.hpBars.draw(bars, (p) => this.toScreen(p), CAMERA_DISTANCE / this.camera.radius);
  }

  /** Тени-пятна под юнитами, героями и рабочими. */
  private drawBlobs() {
    const casters: Caster[] = this.units().map((u) => ({ node: u.node, size: u.size * 1.1 }));
    if (!this.heroFallen) casters.push({ node: this.heroNode, size: 3.6 * this.heroNode.scaling.x });
    for (const r of this.reserve.values()) if (!r.fallen) casters.push({ node: r.node, size: 3.4 });
    for (const b of this.bases.values()) for (const w of b.workerNodes()) casters.push({ node: w, size: 1.9 });
    this.blobs.draw(casters);
  }

  /** Круги выделения и подсветки за кадр. */
  private drawSelection() {
    if (this.hoverDirty && this.mouse.inside) {
      this.hoverDirty = false;
      this.hovered = this.pickHover();
    }
    const targets: Target[] = [];
    if (this.selTasks.length) {
      const want = new Set(this.selTasks);
      for (const u of this.units()) if (want.has(u.taskId)) targets.push({ key: u.taskId, node: u.node, size: u.size });
    }
    if (this.selHero) targets.push({ key: 'hero', node: this.heroNode, size: 3.6 });
    this.selFx.draw(targets, this.hovered);
  }

  /** Сразу ставит камеру на точку, как клик по миникарте. */
  lookAt(x: number, z: number) {
    this.flyGoal = null;
    this.camera.target.set(clampMap(x), 0, clampMap(z));
  }

  /** Плавно ведёт камеру к точке. */
  flyTo(x: number, z: number) {
    this.flyGoal = new Vector3(clampMap(x), 0, clampMap(z));
    this.pacer.poke(performance.now());
  }

  focusBase(id: string) {
    const p = this.store.project(id);
    if (p) this.flyTo(p.slot.x, p.slot.z + 3);
  }

  /** Пробел и F1 в WC3: камера к герою. */
  focusHero() {
    const h = this.heroNode.position;
    this.flyTo(h.x, h.z);
  }

  /** Земля и лес для мини-карты; null, пока нет текстур земли. */
  minimapArt(): HTMLCanvasElement | null {
    if (this.miniDirty && this.groundMap) {
      const trees = (this.trees.length ? this.trees : this.forest.map((f) => f.node)).filter((n) => n.isEnabled());
      this.miniArt = minimapArt(this.groundMap, trees.map((n) => ({ x: n.position.x, z: n.position.z })));
      this.miniDirty = false;
    }
    return this.miniArt;
  }

  /** Что видит камера: четыре угла экрана, опущенные на землю (для рамки на мини-карте). */
  cameraFootprint(): { x: number; z: number }[] {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([x, y]) => {
      const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
      const t = ray.direction.y < -1e-3 ? -ray.origin.y / ray.direction.y : 1e4;
      return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
    });
  }

  cameraTarget(): { x: number; z: number } {
    return { x: this.camera.target.x, z: this.camera.target.z };
  }

  applyLighting() {
    const l = LIGHTING[currentShift(this.store.state)];
    this.sun.intensity = l.sun;
    this.sun.diffuse = Color3.FromHexString(l.tint);
    this.sky.intensity = l.sky;
    this.scene.clearColor = Color4.FromHexString(l.clear + 'ff');
  }

  /** Синхронизирует сцену с состоянием: фермы, крепости, герой. */
  sync() {
    this.syncBases();
    const s = this.store.state;
    this.landsAt = landSpots(s);
    if (this.lands.sync(this.landsAt)) this.clearLands();
    // Повелитель ужаса стоит за подписью своей земли, чуть дальше от центра.
    const dl = activeDreadlord(s);
    const land = dl && this.landsAt.find((l) => l.sphereId === dl.sphereId);
    if (dl && land) {
      const len = Math.hypot(land.x, land.z) || 1;
      this.dreadlord.sync({ title: `Повелитель ужаса ${dl.name}`, hp: dl.hp, maxHp: dl.maxHp, x: land.x + (land.x / len) * 16, z: land.z + (land.z / len) * 16 });
    } else this.dreadlord.sync(null);
    // Архимонд стоит к северу от главной ратуши, пока не повержен.
    const hy = s.hyjal;
    this.archimonde.sync(hy && hy.hp > 0 ? { title: 'Архимонд', hp: hy.hp, maxHp: hy.maxHp, x: 0, z: 40 } : null);
    const today = localDay();
    const done = new Set(s.tasks.filter((t) => t.status === 'done').map((t) => t.id));
    for (const p of s.projects) {
      const b = this.bases.get(p.id);
      if (!b) continue;
      b.setFortressHp(p.fortressHp, p.fortressMaxHp);
      b.setTasks(s.tasks.filter((t) => t.projectId === p.id));
      // Захваченная база стоит на земле Легиона, в руинах.
      b.setBlight(isBlighted(s, p) || !!p.capturedAt, p.damage ?? 0);
      b.setFrozen(p.frozen, !!p.capturedAt);
      const m = meteorOf(s, p.id, today);
      b.setMeteor(m ? { taskId: m.task.id, daysLeft: m.daysLeft } : null, done);
      const demons = demonsAt(s, p.id, today);
      b.setDemons(
        demons.slice(0, BALANCE.demonsShown).map((t) => ({ taskId: t.id, rank: demonRank(t, today) })),
        Math.max(0, demons.length - BALANCE.demonsShown),
      );
    }
    if (this.groundMap) {
      const sig = s.projects.filter((p) => isBlighted(s, p) || !!p.capturedAt).map((p) => p.id).join();
      if (sig !== this.blightSig) {
        this.blightSig = sig;
        void this.loadTerrain();
      }
    }
    this.bases.get('main')?.setFarms(s.farms);
    this.bases
      .get(MAIN_HALL_ID)
      ?.setTech(s.tier ?? 1, (Object.keys(s.buildings ?? {}) as BuildingId[]).filter((b) => s.buildings?.[b]), s.construction?.id ?? null);
    this.bases.get('main')?.setPortal(portalSize(s));
    const heroBase = this.bases.get(s.hero.baseId);
    if (heroBase) this.heroTarget.copyFrom(heroBase.heroSpot());
    this.rain.set(allDemons(s).length >= RAIN_DEMONS);
    if (s.hero.id === this.heroId && this.heroLevel && s.hero.level > this.heroLevel) this.glow.levelUp();
    this.heroLevel = s.hero.level;
    this.glow.setColor(HERO_GLOW[s.hero.kind ?? 'mountainking']);
    // Новая смена: заступивший герой выходит от алтаря главной ратуши.
    if (s.hero.id !== this.heroId) {
      const first = !this.heroId;
      this.heroId = s.hero.id;
      this.heroFallen = !!s.hero.fallenAt;
      this.heroNode.setEnabled(true);
      this.dressHero();
      const main = this.bases.get(MAIN_HALL_ID);
      if (!first && main) this.heroNode.position.copyFrom(main.spot(ALTAR_EXIT));
      this.spellSeen = '';
    }
    this.syncReserve();

    // Применённая способность: герой бросает молот, бьёт по земле или превращается в Аватара.
    const h = s.hero;
    const spells = `${h.frog?.taskId ?? ''}|${h.clap?.until ?? ''}|${h.avatar?.until ?? ''}`;
    if (this.spellSeen && spells !== this.spellSeen && this.heroModel) {
      const [frog, clap, avatar] = this.spellSeen.split('|');
      let anim = h.avatar && String(h.avatar.until) !== avatar ? 'Morph Alternate' : h.clap && String(h.clap.until) !== clap ? 'Spell Slam 1' : h.frog && h.frog.taskId !== frog ? 'Spell Throw 1' : '';
      // У других героев своих бросков нет: они колдуют обычным заклинанием.
      if (anim && !this.heroModel.animations.includes(anim)) anim = 'Spell 1';
      if (anim) {
        this.heroModel.play(anim, false);
        this.heroAction = performance.now() + 1600;
      }
    }
    this.spellSeen = spells;
    // Павший герой лежит там, где упал; воскрешённый встаёт у алтаря главной ратуши.
    const fallen = !!s.hero.fallenAt;
    if (fallen !== this.heroFallen) {
      this.heroFallen = fallen;
      if (fallen) {
        this.heroModel?.play('Death 1', false);
        if (!this.heroModel) this.heroNode.setEnabled(false);
      } else {
        this.heroNode.setEnabled(true);
        this.heroNode.position.copyFrom(this.heroTarget);
      }
    }
  }

  /** Новые, удалённые и изменённые проекты: базы закладываются и сносятся на ходу. */
  private syncBases() {
    const s = this.store.state;
    const ids = new Set(s.projects.map((p) => p.id));
    let changed = false;
    for (const id of [...this.bases.keys()])
      if (!ids.has(id)) {
        this.dropBase(id);
        changed = true;
      }
    for (const p of s.projects) {
      const sig = `${p.name}|${p.kind}|${p.slot.x},${p.slot.z}`;
      const old = this.baseSig.get(p.id);
      this.baseSig.set(p.id, sig);
      // Базы из конструктора уже стоят: первый проход только запоминает их подписи.
      if (this.bases.has(p.id) && (old === undefined || old === sig)) continue;
      if (this.bases.has(p.id)) this.dropBase(p.id, false);
      this.addBase(p);
      changed = true;
    }
    if (changed) void this.loadTerrain();
  }

  private addBase(p: Project) {
    const b = new Base(this.scene, p);
    this.bases.set(p.id, b);
    b.root.getChildMeshes().forEach((m) => this.shadows.addShadowCaster(m, false));
    this.clearScenery(p.slot);
    if (this.lib) {
      const lib = this.lib;
      b.applyModels(lib, this.caster);
      this.decorOf.set(p.id, this.placeCopies(lib, b.decor().filter((it) => lib.has(it.model))));
    }
    if (this.selMat) b.useSelectionTexture(this.selMat);
  }

  private dropBase(id: string, forget = true) {
    this.bases.get(id)?.dispose();
    this.bases.delete(id);
    for (const h of this.decorOf.get(id) ?? []) h.dispose();
    this.decorOf.delete(id);
    if (forget) this.baseSig.delete(id);
  }

  /** Деревья и камни на месте новой базы и её вражеской крепости убираются. */
  private clearScenery(slot: { x: number; z: number }) {
    const f = fortressSpot(slot);
    const blocked = (v: Vector3) => Math.hypot(v.x - slot.x, v.z - slot.z) < 34 || Math.hypot(v.x - f.x, v.z - f.z) < 12;
    for (const t of this.forest) if (blocked(t.node.position)) t.node.setEnabled(false);
    for (const h of this.scenery) if (blocked(h.position)) h.setEnabled(false);
    this.miniDirty = true;
  }

  /**
   * Деревья и камни на подписях земель убираются, чтобы надписи читались. К югу место
   * шире: камера смотрит на север, и высокие деревья перед надписью её закрывают.
   */
  private clearLands() {
    // Там же место Архимонда к северу от главной ратуши.
    // И места зданий дерева технологий у главной ратуши.
    const blocked = (v: Vector3) =>
      Math.hypot(v.x, v.z - 40) < 9 ||
      Object.values(BUILDING_SPOTS).some((b) => Math.hypot(v.x - b.x, v.z - b.z) < 7) ||
      this.landsAt.some((s) => Math.abs(v.x - s.x) < LAND_W / 2 + 3 && v.z > s.z - LAND_H / 2 - 10 && v.z < s.z + LAND_H / 2 + 3);
    for (const t of this.forest) if (blocked(t.node.position)) t.node.setEnabled(false);
    for (const h of this.scenery) if (blocked(h.position)) h.setEnabled(false);
    this.miniDirty = true;
  }

  /** Модель героя его класса; пока её нет, перекрашенный под класс Горный король. */
  private heroInstance(kind: HeroKind): ModelInstance | null {
    const lib = this.lib;
    const own = lib?.has(HERO_MODEL[kind]) ? lib.create(HERO_MODEL[kind], kind === 'mountainking' ? 1.1 : 1) : null;
    if (own) return own;
    const mk = lib?.create('heromountainking', 1.1) ?? null;
    if (mk) tint(mk, HERO_KINDS[kind].tint);
    return mk;
  }

  /** Модель героя на дежурстве. */
  private dressHero() {
    const s = this.store.state;
    const hero = this.heroInstance(s.hero.kind ?? 'mountainking');
    if (!hero) return;
    this.heroModel?.dispose();
    // Золотое кольцо заглушки уходит вместе с ней: в WC3 под героем круг только при выборе.
    for (const c of this.heroNode.getChildren()) c.dispose();
    hero.root.parent = this.heroNode;
    hero.root.getChildMeshes().forEach((m) => {
      this.caster(m);
      m.metadata = { hero: true };
    });
    hero.play(this.heroFallen ? 'Death 1' : 'Stand 1', !this.heroFallen);
    this.heroNode.setEnabled(true);
    this.heroModel = hero;
  }

  /** Герои в запасе: стоят у алтаря, павшие лежат. */
  private syncReserve() {
    const s = this.store.state;
    const list = s.reserve ?? [];
    const ids = new Set(list.map((h) => h.id));
    for (const [id, r] of this.reserve)
      if (!ids.has(id)) {
        r.model?.dispose();
        r.node.dispose();
        this.reserve.delete(id);
      }
    const main = this.bases.get(MAIN_HALL_ID);
    list.forEach((h, i) => {
      let r = this.reserve.get(h.id);
      if (!r) {
        r = { node: new TransformNode('reserve-' + h.id, this.scene), model: null, fallen: false };
        this.reserve.set(h.id, r);
      }
      if (!r.model && this.lib) {
        for (const c of r.node.getChildren()) c.dispose();
        r.model = this.heroInstance(h.kind ?? 'mountainking');
        if (r.model) {
          r.model.root.parent = r.node;
          r.model.root.getChildMeshes().forEach((m) => {
            this.caster(m);
            m.isPickable = false;
          });
          r.fallen = !h.fallenAt; // заставит выбрать позу ниже
        }
      }
      if (!r.model && !r.node.getChildren().length) {
        const ph = P.hero(this.scene);
        for (const c of ph.getChildren()) if (c.name.startsWith('hRing')) c.dispose();
        ph.getChildMeshes().forEach((m) => (m.isPickable = false));
        ph.parent = r.node;
      }
      if (main) {
        r.node.position.copyFrom(main.spot(RESERVE_SPOTS[i % RESERVE_SPOTS.length]));
        const alt = main.spot(ALTAR);
        r.node.rotation.y = Math.atan2(alt.x - r.node.position.x, alt.z - r.node.position.z) + Math.PI;
      }
      const fallen = !!h.fallenAt;
      if (fallen !== r.fallen) {
        r.fallen = fallen;
        r.model?.play(fallen ? 'Death 1' : 'Stand 1', !fallen);
      }
    });
  }

  private frame(dt: number) {
    dt = Math.min(dt, 0.1);
    // Сдвиг камеры стрелками и краем экрана, как в WC3 (буквы заняты горячими клавишами команд).
    const pan = new Vector3(0, 0, 0);
    const k = this.keys;
    if (k.has('arrowleft')) pan.x -= 1;
    if (k.has('arrowright')) pan.x += 1;
    if (k.has('arrowup')) pan.z += 1;
    if (k.has('arrowdown')) pan.z -= 1;
    if (this.mouse.inside) {
      const edge = 6;
      if (this.mouse.x <= edge) pan.x -= 1;
      if (this.mouse.x >= window.innerWidth - edge) pan.x += 1;
      if (this.mouse.y <= edge) pan.z += 1;
    }
    const cam = this.camera;
    if (pan.lengthSquared() > 0) {
      this.pacer.poke(performance.now());
      this.flyGoal = null;
      // Около полуэкрана в секунду при любом зуме.
      pan.normalize().scaleInPlace(0.95 * dt * cam.radius);
      const t = cam.target;
      t.x = clampMap(t.x + pan.x);
      t.z = clampMap(t.z + pan.z);
    }
    // Зум и перелёт камеры догоняют цель с затуханием: быстро в начале, мягко в конце.
    if (Math.abs(cam.radius - this.zoomGoal) > 0.01) {
      this.pacer.poke(performance.now());
      cam.radius += (this.zoomGoal - cam.radius) * Math.min(1, dt * 9);
    }
    if (this.flyGoal) {
      this.pacer.poke(performance.now());
      const d = this.flyGoal.subtract(cam.target);
      if (d.length() < 0.05) {
        cam.target.copyFrom(this.flyGoal);
        this.flyGoal = null;
      } else cam.target.addInPlace(d.scale(Math.min(1, dt * 7)));
    }

    this.drawSelection();
    this.drawBars();
    this.drawBlobs();
    this.glow.update(dt, this.heroNode.isEnabled() && !this.heroFallen);
    this.rain.follow(cam.target);
    this.confirm.update(dt);
    this.lake?.update(dt);

    const s = this.store.state;
    const now = new Date();
    // Добыча в минуту при полной силе: по ней рабочие показывают «+N» у ратуши.
    const mining = tuning(s).mining;
    const rate = { gold: BALANCE.goldPerMinute * mining, lumber: BALANCE.lumberPerMinute * mining };
    // Стройка у главной ратуши идёт, пока тикает таймер работы героя (как в store.tick).
    const timer = !!activeTaskOf(s, s.hero.baseId) && !s.onBreak && !idleGuardTripped(s, now.getTime());
    this.bases.get(MAIN_HALL_ID)?.setBuildTimer(timer);
    for (const p of s.projects) this.bases.get(p.id)?.update(dt, miningFactor(s, p, now), rate);
    this.dreadlord.update();
    this.archimonde.update();

    // Герой идёт к своей базе.
    if (this.heroFallen) return;
    const h = this.heroNode.position;
    const d = this.heroTarget.subtract(h);
    const dist = d.length();
    const avatar = avatarActive(s, s.hero.baseId, now.getTime());
    const form = avatar && this.heroModel?.animations.includes('Walk Alternate 1') ? ' Alternate' : '';
    if (dist > 0.2) {
      // Горный король ходит со скоростью 270 (6,75 в мире); на дальний переход он
      // бежит до 2,5 раза быстрее, и шаг ускоряется вместе с ним.
      const speed = Math.min(HERO_WALK * 2.5, Math.max(HERO_WALK, dist * 0.4));
      const step = Math.min(dist, speed * dt);
      h.addInPlace(d.scale(step / dist));
      turnTowards(this.heroNode, Math.atan2(d.x, d.z), dt);
      this.heroModel?.play(`Walk${form} 1`);
      this.heroModel?.setSpeed(speed / HERO_WALK / (avatar ? 1.6 : 1));
    } else if (performance.now() > this.heroAction) this.heroModel?.play(`Stand${form} 1`);

    // Аватар: герой вырастает, как Горный король в WC3.
    const size = avatar ? 1.6 : 1;
    const cur = this.heroNode.scaling.x;
    if (Math.abs(cur - size) > 0.005) this.heroNode.scaling.setAll(cur + (size - cur) * Math.min(1, dt * 3));
  }
}

const clampZoom = (r: number) => Math.min(CAMERA_FAR, Math.max(CAMERA_NEAR, r));
const clampMap = (v: number) => Math.max(-MAP_HALF, Math.min(MAP_HALF, v));
