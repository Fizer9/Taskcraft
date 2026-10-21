// Одна база на карте: ратуша, шахта, лес, фермы, крепость врага и рабочие,
// которые бегают, только пока на базе идёт задача.

import {
  AbstractMesh,
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { loadArt } from '../assets/loader';
import type { BuildingId, Project, Task, TechId } from '../state/types';
import { BUILDING_SPOTS, MainBuildings, Riser } from './buildings';
import type { ModelLibrary, ModelName } from './library';
import { turnTowards, type ModelInstance } from './models';
import * as P from './placeholders';
import { Ground, type TerrainMap } from './terrain';
import { Troops } from './troops';
import { Demons, type DemonView } from './legion';
import { BlightFx } from './blight';
import { Meteor } from './meteor';
import type { UnitNode } from './selection';

export const BANNER_COLORS: Record<Project['kind'], string> = {
  work: '#2f6bff',
  personal: '#3fae4a',
  any: '#e2b63c',
};

type WorkerState = 'toWork' | 'waiting' | 'working' | 'toHall' | 'dropping' | 'idle';

interface Worker {
  root: TransformNode;
  load: Mesh;
  model?: ModelInstance;
  job: 'gold' | 'lumber';
  state: WorkerState;
  timer: number;
  idleSpot: Vector3;
  phase: number;
  /** Путь к текущей цели в обход зданий: точки поворота, последняя это сама цель. */
  route: Vector3[];
  routeGoal: Vector3 | null;
  /** Дерево, которое лесоруб рубит в этот заход (номер в trees). */
  tree: number;
  /** Время в текущем взмахе топора: дерево вздрагивает в момент удара. */
  swing: number;
  trips: number;
}

interface Tree {
  pos: Vector3;
  swap: Swap;
  model: ModelInstance | null;
  /** Лесоруб, который идёт к дереву или рубит его. */
  busy: Worker | null;
}

type Swap = { node: TransformNode; model: ModelName; scale: number; anim?: string };

/** Препятствие на пути рабочих: круг в координатах базы. */
interface Obstacle {
  c: Vector3;
  r: number;
}

/** «+N» над местом сдачи: всплывает и тает, как в WC3. */
interface Floater {
  mesh: Mesh;
  age: number;
}

const FLOAT_LIFE = 2;
/** Сколько секунд строится новая ферма (в WC3 35, здесь короче: ферму покупают за раз). */
const FARM_BIRTH = 6;
/** Казарма в координатах базы и её дверь: новые юниты выходят оттуда к флагу сбора. */
const BARRACKS = new Vector3(-13, 0, 9);
/** Какой звук отклика у модели здания при щелчке (sound/buildings/<имя>what.mp3). */
const SELECT_SOUND: Partial<Record<ModelName, string>> = { townhall: 'townhall', farm: 'farm', humanbarracks: 'barracks', altarofkings: 'altar' };
/**
 * Скорость, под которую сделан шаг крестьянина: 190 единиц WC3 в секунду. Идёт быстрее
 * или медленнее, и анимация ускоряется или замедляется вместе с ним.
 */
const PEASANT_WALK = 190 * 0.025;
/** Ближе этого рабочие друг к другу не подходят, а расходятся. */
const PERSONAL_SPACE = 1.3;
/** Сетка для поиска пути вокруг ратуши: клетка 1×1, от −36 до 36 по обеим осям. */
const GRID_HALF = 36;
const GRID_N = GRID_HALF * 2;
/** Насколько рабочий держится от стен: его собственный радиус. */
const BODY = 0.5;

export class Base {
  readonly root: TransformNode;
  /** Название базы и его цвет: показывается над ратушей при наведении и выборе (world.ts). */
  label = { text: '', color: '#ffd34d' };
  private frozen = false;
  private captured = false;
  /** Модель ратуши: на главной базе её анимация показывает тир (ратуша, крепость, замок). */
  private hall: ModelInstance | null = null;
  private hallAnim = 'Stand 1';
  /** Ферм по прошлой синхронизации; новые вырастают из земли. */
  private farmsKnown = -1;
  private riser = new Riser();
  private tech: MainBuildings | null = null;
  private workers: Worker[] = [];
  private minePos: Vector3;
  private mineModel: ModelInstance | null = null;
  /** Крестьянин внутри шахты: как в WC3, заходят по одному, остальные ждут у входа. */
  private inMine: Worker | null = null;
  private treePos: Vector3;
  private farms: TransformNode[] = [];
  /** Радиус ратуши (её стена почти круглая): рабочие сдают добычу у края, а не в середине. */
  private hallR: number;
  private obstacles: Obstacle[] = [];
  /** Занятые клетки сетки и уже найденные пути; сбрасываются, когда появляется здание. */
  private grid: Uint8Array | null = null;
  private routes = new Map<string, Vector3[]>();
  /** Добыто с последней сдачи; целая часть всплывает над ратушей. */
  private pending = { gold: 0, lumber: 0 };
  private floaters: Floater[] = [];
  private hpFill: Mesh | null = null;
  private fortressNode: TransformNode | null = null;
  private selection: Mesh;
  private dirt: Mesh;
  /** Заглушки, которые заменяются моделями WC3, когда те загружены. */
  private swaps: Swap[] = [];
  private trees: Tree[] = [];
  /** Построена лесопилка (только у главной ратуши): дерево носят туда, если ближе. */
  private mill = false;
  /** Стройка у главной ратуши и крестьянин, который стучит по ней молотком. */
  private site: Vector3 | null = null;
  private builder: Worker | null = null;
  /** Тикает таймер работы: только тогда стройка идёт и строитель работает. */
  private buildTimer = false;
  private lib: ModelLibrary | null = null;
  private onModelMesh: (m: AbstractMesh) => void = () => {};
  private troops: Troops;
  private demons: Demons;
  private blight: BlightFx;
  private meteor: Meteor;
  /** Стража врат: гончие Скверны по бокам и страж Скверны в середине. */
  private guards: ModelInstance[] = [];
  private gate: ModelInstance | null = null;
  /** Портал Легиона у главной ратуши, растёт с числом брошенных свитков. */
  private portal: { node: TransformNode; model: ModelInstance | null; size: number } | null = null;

  constructor(
    private scene: Scene,
    readonly project: Project,
  ) {
    const main = project.fortressMaxHp === 0;
    this.root = new TransformNode('base-' + project.id, scene);
    this.root.position.set(project.slot.x, 0, project.slot.z);
    // Базы смотрят наружу от центра карты, шахта и лес позади ратуши.
    const outward = Math.atan2(project.slot.x, project.slot.z);
    if (project.slot.x !== 0 || project.slot.z !== 0) this.root.rotation.y = outward + Math.PI;

    const dirt = (this.dirt = MeshBuilder.CreateDisc('dirt', { radius: 24, tessellation: 40 }, scene));
    dirt.rotation.x = Math.PI / 2;
    dirt.position.y = 0.03;
    dirt.material = P.mat(scene, '#6b5a3a');
    dirt.material.alpha = 0.55;
    dirt.parent = this.root;
    dirt.isPickable = false;

    const hall = P.townHall(scene, BANNER_COLORS[project.kind], main);
    hall.parent = this.root;
    // Главная база — замок (вторая ступень улучшения ратуши), остальные — ратуши.
    this.swaps.push({ node: hall, model: 'townhall', scale: main ? 1.15 : 1, anim: 'Stand 1' });
    if (main) this.tech = new MainBuildings(scene, this.root, project.id);
    this.hallR = main ? 5.6 : 4.9;
    this.obstacles.push({ c: Vector3.Zero(), r: this.hallR });

    this.minePos = new Vector3(-16, 0, -12);
    const mine = P.goldMine(scene);
    mine.parent = this.root;
    mine.position.copyFrom(this.minePos);
    this.swaps.push({ node: mine, model: 'goldmine', scale: 1 });
    this.obstacles.push({ c: this.minePos.clone(), r: 3.6 });

    this.treePos = new Vector3(16, 0, -14);
    for (let i = 0; i < 14; i++) {
      const t = P.tree(scene, 0.8 + ((i * 37) % 10) / 20);
      t.parent = this.root;
      t.position.set(14 + (i % 5) * 3.2 + ((i * 13) % 3), 0, -12 - Math.floor(i / 5) * 3.4 - ((i * 7) % 2));
      t.rotation.y = i * 1.7;
      const swap: Swap = { node: t, model: `lordaerontree${i % 4}` as ModelName, scale: 1 + ((i * 37) % 10) / 40 };
      this.swaps.push(swap);
      this.trees.push({ pos: t.position.clone(), swap, model: null, busy: null });
    }

    if (!main) {
      const bar = P.barracks(scene);
      bar.parent = this.root;
      bar.position.copyFrom(BARRACKS);
      const alt = P.altar(scene);
      alt.parent = this.root;
      alt.position.set(13, 0, 10);
      this.swaps.push({ node: bar, model: 'humanbarracks', scale: 0.85 }, { node: alt, model: 'altarofkings', scale: 0.85 });
      this.obstacles.push({ c: bar.position.clone(), r: 4.6 }, { c: alt.position.clone(), r: 3.4 });

      // Крепость врага: Врата демонов Пылающего Легиона, за шахтой и лесом, дальше от центра.
      this.fortressNode = new TransformNode('fortress', scene);
      this.fortressNode.parent = this.root;
      this.fortressNode.position.set(0, 0, -48);
      const gate = P.fortress(scene);
      gate.parent = this.fortressNode;
      gate.rotation.y = -Math.PI / 2; // порталом к базе
      this.swaps.push({ node: gate, model: 'demongate', scale: 0.9, anim: 'Stand 1' });
      this.hpFill = this.makeHpBar(this.fortressNode);
    }

    this.selection = MeshBuilder.CreateTorus('sel', { diameter: 15, thickness: 0.35, tessellation: 48 }, scene);
    this.selection.material = P.mat(scene, '#3dff3d', 0.9);
    this.selection.parent = this.root;
    this.selection.position.y = 0.15;
    this.selection.isVisible = false;
    this.selection.isPickable = false;

    this.label = { text: project.name, color: '#ffd34d' };

    // Нанятые юниты строятся у казармы, а у главной базы у ратуши. К крепости идут
    // между шахтой и ратушей, чтобы не проходить сквозь здания.
    this.troops = new Troops(
      scene,
      this.root,
      main
        ? { rally: new Vector3(9, 0, 14), door: new Vector3(3, 0, 7), fortress: null, route: [] }
        : { rally: new Vector3(-18, 0, 15), door: BARRACKS.add(new Vector3(1.5, 0, 4.2)), fortress: new Vector3(0, 0, -48), route: [new Vector3(-8, 0, 4), new Vector3(-7, 0, -28)] },
      project.id,
    );

    this.demons = new Demons(scene, this.root, project.id);
    this.blight = new BlightFx(scene, this.root);
    this.meteor = new Meteor(scene, this.root);

    for (let i = 0; i < 5; i++) {
      const { root, load } = P.peasant(scene);
      root.parent = this.root;
      const idleSpot = new Vector3(-4 + i * 2, 0, 9 + (i % 2));
      root.position.copyFrom(idleSpot);
      this.workers.push({ root, load, job: i >= 3 ? 'lumber' : 'gold', state: 'idle', timer: 0, idleSpot, phase: i * 0.7, route: [], routeGoal: null, tree: -1, trips: 0, swing: 0 });
    }
    // Ящики и колодец у ратуши (см. decor()) и места зданий главной базы тоже обходятся.
    this.obstacles.push({ c: new Vector3(6.5, 0, 5), r: 1.3 }, { c: new Vector3(-6.5, 0, 4.5), r: 1.3 });
    this.obstacles.push({ c: main ? new Vector3(-2, 0, 20) : new Vector3(5, 0, 19), r: 1.6 });
    if (main) for (const spot of Object.values(BUILDING_SPOTS)) this.obstacles.push({ c: spot.clone(), r: 3.8 });

    // По этой метке клик по любой части базы выбирает её.
    this.root.getChildMeshes().forEach((m) => {
      if (m.isPickable) m.metadata = { ...(m.metadata ?? {}), baseId: project.id };
    });
  }

  private makeHpBar(parent: TransformNode): Mesh {
    const holder = new TransformNode('hp', this.scene);
    holder.parent = parent;
    holder.position.y = 15;
    const bg = MeshBuilder.CreatePlane('hpBg', { width: 8.4, height: 1 }, this.scene);
    bg.material = P.mat(this.scene, '#111111', 1);
    bg.parent = holder;
    bg.billboardMode = Mesh.BILLBOARDMODE_ALL;
    bg.isPickable = false;
    const fill = MeshBuilder.CreatePlane('hpFill', { width: 8, height: 0.7 }, this.scene);
    // Свой материал у каждой полоски: цвет меняется по здоровью именно этой крепости.
    fill.material = P.mat(this.scene, '#2fd13a', 1).clone('hpFillMat-' + this.project.id);
    fill.parent = bg;
    fill.position.z = -0.01;
    fill.isPickable = false;
    return fill;
  }

  /** Заменяет заглушки моделями WC3 из библиотеки (то, что в ней нашлось). */
  applyModels(lib: ModelLibrary, onMesh: (m: AbstractMesh) => void) {
    this.lib = lib;
    this.onModelMesh = onMesh;
    this.troops.setLibrary(lib, onMesh);
    this.tech?.setLibrary(lib, onMesh);
    this.demons.setLibrary(lib, onMesh);
    if (this.portal) this.dressPortal();
    for (const s of [...this.swaps]) this.swap(s);
    this.placeGuards();
    for (const w of this.workers) {
      const model = lib.create('peasant');
      if (!model) continue;
      for (const c of w.root.getChildren()) c.dispose();
      model.root.parent = w.root;
      model.root.getChildMeshes().forEach(onMesh);
      model.play('Stand 1');
      w.model = model;
    }
  }

  /** Догрузились юниты, демоны и врата (LATE_MODELS): меняем их заглушки на модели. */
  upgradeModels() {
    if (!this.lib) return;
    this.troops.setLibrary(this.lib, this.onModelMesh);
    this.tech?.setLibrary(this.lib, this.onModelMesh);
    this.demons.setLibrary(this.lib, this.onModelMesh);
    if (this.portal && !this.portal.model) this.dressPortal();
    this.placeGuards();
  }

  /** Стража у вражеской крепости: две гончие и страж Скверны, если их модели уже есть. */
  private placeGuards() {
    const lib = this.lib;
    if (!lib || this.guards.length) return;
    const onMesh = this.onModelMesh;
    if (this.fortressNode) {
      const posts: [ModelName, number, number][] = [
        ['felhound', -5.5, 8],
        ['felhound', 5.5, 8],
        ['felgaurd', 0, 9],
      ];
      for (const [name, x, z] of posts) {
        const g = lib.create(name, 0.75);
        if (!g) continue;
        g.root.parent = this.fortressNode;
        g.root.position.set(x, 0, z);
        g.root.getChildMeshes().forEach((m) => {
          m.metadata = { ...(m.metadata ?? {}), baseId: this.project.id };
          onMesh(m);
        });
        g.play('Stand 1');
        this.guards.push(g);
      }
    }
  }

  private swap(s: Swap): ModelInstance | null {
    const inst = this.lib?.create(s.model, s.scale);
    if (!inst) return null;
    inst.root.parent = s.node.parent;
    inst.root.position.copyFrom(s.node.position);
    inst.root.rotation.copyFrom(s.node.rotation);
    const building = SELECT_SOUND[s.model];
    inst.root.getChildMeshes().forEach((m) => {
      m.metadata = { ...(m.metadata ?? {}), baseId: this.project.id, ...(building ? { building } : {}) };
      this.onModelMesh(m);
    });
    if (s.model === 'townhall') {
      this.hall = inst;
      if (this.captured) inst.play('Death 1', false);
      else inst.play(this.hallAnim);
    } else if (s.anim) inst.play(s.anim);
    else inst.playLike('Stand 1');
    if (s.model === 'demongate') this.gate = inst;
    if (s.model === 'goldmine') this.mineModel = inst;
    const tree = this.trees.find((t) => t.swap === s);
    if (tree) tree.model = inst;
    s.node.dispose();
    s.node = inst.root;
    this.swaps = this.swaps.filter((x) => x !== s);
    return inst;
  }

  /** Рисует землю базы на карте тайлов: утоптанная земля, дорожка к шахте, камень под крепостью. */
  paintGround(map: TerrainMap) {
    const w = (x: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, 0, z), this.root.computeWorldMatrix(true));
    const c = w(0, 0);
    map.disc(Ground.DirtGrass, c.x, c.z, 25, 0.3);
    map.disc(Ground.Dirt, c.x, c.z, 19, 0.3);
    const mine = w(this.minePos.x, this.minePos.z);
    map.disc(Ground.Rough, mine.x, mine.z, 8, 0.4);
    map.path(Ground.Rough, mine.x, mine.z, c.x, c.z, 2.2);
    const wood = w(this.treePos.x - 2, this.treePos.z + 3);
    map.path(Ground.DirtGrass, wood.x, wood.z, c.x, c.z, 2);
    if (this.fortressNode) {
      const f = w(0, -48);
      map.disc(Ground.Rough, f.x, f.z, 11, 0.4);
      map.disc(Ground.Rock, f.x, f.z, 7, 0.4);
    }
    // Старый круг-заглушка больше не нужен.
    this.dirt.setEnabled(false);
  }

  /**
   * Мелочи вокруг базы в мировых координатах: ящики и факелы у ратуши, сено за забором,
   * колодец, стойки с оружием у казармы, а у врат демонов черепа на кольях и зелёные жаровни.
   */
  decor(): { model: ModelName; pos: Vector3; rot: number; scale: number }[] {
    const main = !this.fortressNode;
    const items: [ModelName, number, number, number, number?][] = [
      ['crates0', 6.5, 5, 0.4],
      ['crates1', -6.5, 4.5, 2.1],
      ['torchhuman0', 3.4, 8.2, 0],
      ['torchhuman0', -3.4, 8.2, 0],
      ['well', main ? -2 : 5, main ? 20 : 19, 0.6],
      ['hay0', 20, 4, 0.3, 0.8],
      ['haycart', 23.5, -1, 2.4],
      ['village_fencelong', 20.5, 8.2, Math.PI / 2],
      ['village_fenceshort', 24.2, 5, 0],
      ['bannerhuman0', -5.5, 16, 0],
      ['wheelbarrel', -22, -4, 1.1],
      ['lords_rock0', -27, 1, 0.5],
      ['lords_rock2', 27, 14, 2],
      // Фонари у дороги к ратуше, указатель на развилке и трава по краю утоптанной земли.
      ['lanternpost0', -4.5, main ? 26 : 24, Math.PI],
      ['lanternpost0', 4.5, main ? 26 : 24, Math.PI],
      ['signpost0', 8, main ? 31 : 28, -0.5],
      ['summergrass0', -26, 12, 0.4],
      ['summergrass1', 26, -9, 1.3],
      ['summergrass0', -18, -20, 2.2],
      ['summergrass1', 3, -24, 0.9],
      ['summergrass0', 28, 22, 0.1],
      ['summergrass1', -28, -10, 2.8],
    ];
    if (!main) {
      items.push(
        ['armorrack', -8, 12.5, -0.4],
        ['weapons', -21, 9, 1.2],
        // Флажок сбора у угла строя: новые юниты выходят из казарм и бегут к нему.
        ['rallypoint', -19.8, 13.2, 0],
        // Логово демонов: всё вокруг крепости (она в 48 единицах от ратуши).
        ['skullonstick0', -10, -41, 0.3],
        ['skullonstick1', 10, -41, -0.3],
        ['braziergreen', -7.5, -52, 0],
        ['braziergreen', 7.5, -52, 0],
        ['skullpile0', 11, -54, 1],
        ['lords_rock1', -13, -55, 0.8],
      );
    }
    const m = this.root.computeWorldMatrix(true);
    return items.map(([model, x, z, rot, scale = 1]) => ({
      model,
      pos: Vector3.TransformCoordinates(new Vector3(x, 0, z), m),
      rot: rot + this.root.rotation.y,
      scale,
    }));
  }

  /** Круг выделения из игры вместо простого кольца. */
  useSelectionTexture(mat: StandardMaterial) {
    const visible = this.selection.isVisible;
    this.selection.dispose();
    this.selection = MeshBuilder.CreateGround('sel', { width: 17, height: 17 }, this.scene);
    this.selection.material = mat;
    this.selection.parent = this.root;
    this.selection.position.y = 0.12;
    this.selection.isVisible = visible;
    this.selection.isPickable = false;
  }

  /** Юниты задач этой базы: нанятые у казармы, задачи в работе у крепости. */
  setTasks(tasks: Task[]) {
    this.troops.sync(tasks);
  }

  /** Демоны Легиона у ратуши: сильнейшие по отдельности, остальные в лагере. */
  setDemons(shown: DemonView[], extra: number) {
    this.demons.sync(shown, extra);
  }

  /** Метеор Инфернала над базой; если его задача выполнена, он сгорает в воздухе. */
  setMeteor(next: { taskId: string; daysLeft: number } | null, done: Set<string>) {
    this.meteor.set(next, done);
  }

  /** Скверна на земле базы и огонь на зданиях. */
  /**
   * Тир главной ратуши и здания дерева технологий. Во время улучшения ратуши
   * рабочие стучат по ней (рабочая анимация текущего тира).
   */
  setTech(tier: number, built: BuildingId[], constructing: TechId | null) {
    if (!this.tech) return;
    const suffix = ['1', 'Upgrade First', 'Upgrade Second'][Math.min(3, Math.max(1, tier)) - 1];
    const upgrading = constructing === 'keep' || constructing === 'castle';
    const anim = upgrading ? `Stand Work ${suffix}` : `Stand ${suffix}`;
    if (anim !== this.hallAnim) {
      this.hallAnim = anim;
      this.hall?.play(anim);
    }
    this.mill = built.includes('lumbermill');
    const building = constructing && !upgrading && constructing !== 'armor' && constructing !== 'weapons' ? constructing : null;
    this.site = building ? BUILDING_SPOTS[building] : null;
    this.tech.sync(built, building);
  }

  /**
   * Законсервированная база: подпись со снежинкой, земля под инеем, рабочие сидят в ратуше.
   * Захваченная Легионом: подпись с черепом, ратуша в руинах (анимация гибели), рабочих нет.
   */
  setFrozen(on: boolean, captured = false) {
    if (on === this.frozen && captured === this.captured) return;
    if (captured !== this.captured) {
      this.captured = captured;
      if (captured) this.hall?.play('Death 1', false);
      else this.hall?.play(this.hallAnim);
    }
    this.frozen = on;
    this.label = captured
      ? { text: `☠ ${this.project.name}`, color: '#7dff5a' }
      : on
        ? { text: `❄ ${this.project.name}`, color: '#a8dcff' }
        : { text: this.project.name, color: '#ffd34d' };
    // Материалы общие для всех баз: меняем материал диска, а не его цвет.
    const m = P.mat(this.scene, on ? '#cfe8f7' : '#6b5a3a');
    m.alpha = on ? 0.7 : 0.55;
    this.dirt.material = m;
    for (const w of this.workers) {
      w.root.setEnabled(!on);
      if (on) this.releaseTree(w);
    }
    if (on && this.inMine) this.leaveMine();
  }

  /** Тикает ли таймер работы (по нему идёт стройка у главной ратуши). */
  setBuildTimer(on: boolean) {
    this.buildTimer = on;
  }

  setBlight(blighted: boolean, damage: number) {
    this.blight.set(blighted, damage);
  }

  /** Земля под скверной нарисована тайлами WC3. */
  useBlightTiles(on: boolean) {
    this.blight.useTiles(on);
  }

  /** size: число брошенных свитков, 0 закрывает портал. */
  setPortal(size: number) {
    if ((this.portal?.size ?? 0) === size) return;
    if (!size) {
      this.portal?.model?.dispose();
      this.portal?.node.dispose();
      this.portal = null;
      return;
    }
    if (!this.portal) {
      const node = new TransformNode('legionPortal', this.scene);
      node.parent = this.root;
      // У главной ратуши север карты на виду у камеры, поэтому портал справа за сеном.
      node.position.set(27, 0, 22);
      node.rotation.y = Math.atan2(-27, -22); // лицом к ратуше
      this.portal = { node, model: null, size };
      this.dressPortal();
    }
    this.portal.size = size;
    // Портал растёт от трети размера врат до почти полного.
    const k = Math.min(0.85, 0.3 + size * 0.06);
    this.portal.node.scaling.setAll(k / 0.85);
  }

  private dressPortal() {
    const p = this.portal;
    if (!p) return;
    for (const c of p.node.getChildren()) c.dispose();
    const model = this.lib?.create('demongate', 0.85) ?? null;
    if (model) {
      model.root.parent = p.node;
      model.root.rotation.y = -Math.PI / 2;
      model.root.getChildMeshes().forEach((m) => {
        m.metadata = { ...(m.metadata ?? {}), baseId: this.project.id };
        this.onModelMesh(m);
      });
      model.play('Stand Work 1');
      p.model = model;
    } else {
      const gate = P.fortress(this.scene);
      gate.parent = p.node;
    }
  }

  /** Здания дерева технологий у главной ратуши. */
  structures(): { node: TransformNode; scaffold: boolean }[] {
    return this.tech?.structures() ?? [];
  }

  /** Рабочие на виду (для теней-пятен). */
  workerNodes(): TransformNode[] {
    return this.frozen ? [] : this.workers.map((w) => w.root);
  }

  /** Юниты задач и демоны этой базы. */
  units(): UnitNode[] {
    return [...this.troops.units(), ...this.demons.units()];
  }

  setSelected(on: boolean) {
    this.selection.isVisible = on;
  }

  setFarms(count: number) {
    const fresh = this.farmsKnown >= 0;
    this.farmsKnown = count;
    while (this.farms.length < Math.min(count, 12)) {
      const f = P.farm(this.scene);
      f.parent = this.root;
      const i = this.farms.length;
      f.position.set(-24 + (i % 4) * 5.5, 0, 2 + Math.floor(i / 4) * 5.5);
      this.farms.push(f);
      this.obstacles.push({ c: f.position.clone(), r: 2.6 });
      this.grid = null;
      this.routes.clear();
      const swap = { node: f as TransformNode, model: 'farm' as ModelName, scale: 0.85 };
      this.swaps.push(swap);
      const inst = this.lib ? this.swap(swap) : null;
      if (fresh && !this.raise(inst?.root ?? f)) this.riser.add(inst?.root ?? f);
    }
  }

  /**
   * Новая ферма строится, как в WC3: леса, стены и крыша появляются по очереди (модель
   * постройки farmbirth, её минута ужата до FARM_BIRTH секунд), потом на её месте ферма.
   * false, если модели постройки нет: тогда ферма просто вырастает из земли.
   */
  private raise(node: TransformNode): boolean {
    const birth = this.lib?.create('farmbirth', 0.85);
    if (!birth) return false;
    birth.root.parent = node.parent;
    birth.root.position.copyFrom(node.position);
    birth.root.rotation.copyFrom(node.rotation);
    birth.root.getChildMeshes().forEach((m) => {
      m.isPickable = false;
      this.onModelMesh(m);
    });
    node.setEnabled(false);
    birth.playThen('Birth', 'Stand 1', 60 / FARM_BIRTH);
    window.setTimeout(() => {
      birth.dispose();
      node.setEnabled(true);
    }, FARM_BIRTH * 1000);
    return true;
  }

  setFortressHp(hp: number, max: number) {
    if (!this.hpFill || max <= 0) return;
    const k = Math.max(0.001, hp / max);
    this.hpFill.scaling.x = k;
    this.hpFill.position.x = -4 * (1 - k);
    (this.hpFill.material as StandardMaterial).emissiveColor = Color3.FromHexString(k > 0.5 ? '#2fd13a' : k > 0.25 ? '#e3c22b' : '#e33b2b');
    if (this.fortressNode) this.fortressNode.setEnabled(hp > 0);
  }

  /** Точка, где стоит герой на этой базе, в мировых координатах. */
  /** Снести базу со сцены: проект удалён или перестроен. */
  dispose() {
    this.blight.set(false, 0);
    this.meteor.set(null, new Set());
    // Анимации и скелеты моделей живут в сцене отдельно от узлов: убираем их вместе с базой.
    const nodes = new Set<unknown>([this.root, ...this.root.getDescendants(false)]);
    for (const g of [...this.scene.animationGroups]) if (g.targetedAnimations.some((t) => nodes.has(t.target))) g.dispose();
    const meshes = this.root.getChildMeshes(false);
    for (const sk of [...this.scene.skeletons]) if (meshes.some((m) => m.skeleton === sk)) sk.dispose();
    this.root.dispose();
  }

  /** Точка в координатах базы в мировых координатах. */
  spot(local: Vector3): Vector3 {
    return Vector3.TransformCoordinates(local, this.root.computeWorldMatrix(true));
  }

  heroSpot(): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(5, 0, 10), this.root.computeWorldMatrix(true));
  }

  /**
   * factor: множитель добычи из экономики, 0 значит база стоит.
   * rate: добыча в минуту при factor 1, из неё складываются всплывающие «+N».
   */
  update(dt: number, factor: number, rate: { gold: number; lumber: number }) {
    this.updateFloaters(dt);
    this.tech?.update(dt);
    this.riser.update(dt);
    if (factor > 0 && !this.frozen) {
      this.pending.gold += (rate.gold * factor * dt) / 60;
      this.pending.lumber += (rate.lumber * factor * dt) / 60;
    }
    this.troops.update(dt);
    this.demons.update();
    this.meteor.update(dt);
    // Пока у стен идёт бой, стража отбивается, а портал врат крутится быстрее.
    const battle = this.troops.inBattle();
    for (const g of this.guards) g.play(battle ? 'Attack 1' : 'Stand Ready 1');
    this.gate?.play(battle ? 'Stand Work 1' : 'Stand 1');
    // Слабая добыча видна по походке: рабочие плетутся.
    const speed = 5.5 * Math.max(0.35, factor);
    this.assignBuilder();
    for (const w of this.workers) {
      if (this.frozen) continue;
      if (w === this.builder) {
        this.build(w, dt);
        continue;
      }
      if (factor <= 0) {
        w.load.isVisible = false;
        w.state = 'idle';
        this.releaseTree(w);
        if (this.inMine === w) this.leaveMine();
        const arrived = this.walk(w, w.idleSpot, 4, dt);
        w.model?.playLike(arrived ? 'Stand 1' : 'Walk 1');
        if (!arrived) w.model?.setSpeed(4 / PEASANT_WALK);
        w.root.setEnabled(true);
        continue;
      }
      this.animateWorker(w, speed);
      if (w.job === 'lumber' && w.tree < 0) this.pickTree(w);
      const workPos = w.job === 'gold' ? this.mineDoor(w) : this.treeStand(w);
      switch (w.state) {
        case 'idle':
          w.state = 'toWork';
          if (w.job === 'lumber') this.pickTree(w);
          break;
        case 'toWork':
          if (this.walk(w, workPos, speed, dt)) {
            w.state = w.job === 'gold' && !this.enterMine(w) ? 'waiting' : 'working';
            w.timer = w.job === 'gold' ? 1.2 : 2.5;
            const tree = this.trees[w.tree];
            if (w.job === 'lumber' && tree) {
              // Лицом к стволу, а дерево вздрагивает от каждого удара.
              w.root.rotation.y = Math.atan2(tree.pos.x - w.root.position.x, tree.pos.z - w.root.position.z);
              w.swing = 0;
            }
          }
          break;
        case 'waiting':
          w.root.rotation.y = Math.atan2(this.minePos.x - w.root.position.x, this.minePos.z - w.root.position.z);
          if (this.enterMine(w)) w.state = 'working';
          break;
        case 'working':
          w.timer -= dt * Math.max(0.35, factor);
          if (w.job === 'lumber') {
            // Взмах топора длится секунду, удар приходится на его середину.
            const before = w.swing;
            w.swing = (w.swing + dt) % 1;
            if (before < 0.5 && w.swing >= 0.5) this.trees[w.tree]?.model?.playThen('Stand Hit 1', 'Stand 1');
          }
          if (!w.model) w.root.position.y = Math.abs(Math.sin(performance.now() / 120)) * 0.15;
          if (w.timer <= 0) {
            w.state = 'toHall';
            this.releaseTree(w);
            if (this.inMine === w) this.leaveMine();
            if (!w.model) {
              w.load.isVisible = true;
              w.load.material = P.mat(this.scene, w.job === 'gold' ? '#f2c230' : '#7a5228', 0.3);
            }
          }
          break;
        case 'toHall':
          const drop = this.dropFor(w, workPos);
          if (this.walk(w, drop.spot, speed, dt)) {
            w.state = 'dropping';
            w.timer = 0.3;
            w.root.rotation.y = Math.atan2(drop.center.x - w.root.position.x, drop.center.z - w.root.position.z);
            w.trips++;
            this.deliver(w);
          }
          break;
        case 'dropping':
          w.timer -= dt;
          if (w.timer <= 0) {
            w.load.isVisible = false;
            w.state = 'toWork';
            if (w.job === 'lumber') this.pickTree(w);
          }
          break;
      }
    }
  }

  /** Анимация крестьянина по его состоянию: идёт, рубит, несёт золото или дерево. */
  private animateWorker(w: Worker, speed: number) {
    // В шахту крестьянин заходит и пропадает, как в WC3; у дерева машет топором.
    w.root.setEnabled(!(w.state === 'working' && w.job === 'gold'));
    const m = w.model;
    if (!m) return;
    const load = w.job === 'gold' ? 'Gold' : 'Lumber';
    if (w.state === 'toWork') m.play('Walk 1');
    else if (w.state === 'waiting') m.play('Stand Ready 1');
    else if (w.state === 'working') m.play('Attack 1');
    else if (w.state === 'toHall') m.play(`Walk ${load} 1`);
    else m.play(`Stand ${load} 1`);
    if (w.state === 'toWork' || w.state === 'toHall') m.setSpeed(speed / PEASANT_WALK);
  }

  /** Двигает рабочего к цели в обход зданий, возвращает true, когда дошёл. */
  private walk(w: Worker, target: Vector3, speed: number, dt: number): boolean {
    const pos = w.root.position;
    if (!w.routeGoal || Math.hypot(w.routeGoal.x - target.x, w.routeGoal.z - target.z) > 0.5) {
      w.route = this.route(pos, target);
      w.routeGoal = target.clone();
    }
    // Точку поворота можно срезать, как только до неё рукой подать.
    while (w.route.length > 1 && Math.hypot(w.route[0].x - pos.x, w.route[0].z - pos.z) < 0.6) w.route.shift();
    const next = w.route[0] ?? target;
    const d = new Vector3(next.x - pos.x, 0, next.z - pos.z);
    const dist = d.length();
    const last = w.route.length <= 1;
    if (last && dist < 0.3) {
      pos.y = 0;
      w.route = [];
      w.routeGoal = null;
      return true;
    }
    const step = Math.min(dist, speed * dt);
    const dir = d.scale(1 / Math.max(dist, 1e-6));
    if (!last || dist > 1.5) this.keepApart(w, dir);
    pos.x += dir.x * step;
    pos.z += dir.z * step;
    pos.y = w.model ? 0 : Math.abs(Math.sin(performance.now() / 90 + w.phase)) * 0.25;
    turnTowards(w.root, Math.atan2(dir.x, dir.z), dt);
    return false;
  }

  /**
   * Путь от from к to в обход препятствий: поиск A* по сетке 1×1, потом лишние точки
   * выбрасываются, если между соседними видно напрямую. Пути одни и те же (вход в шахту,
   * край ратуши, деревья), поэтому найденные запоминаются.
   */
  private route(from: Vector3, to: Vector3): Vector3[] {
    if (this.clear(from, to)) return [to.clone()];
    const key = `${Math.round(from.x)},${Math.round(from.z)}>${to.x.toFixed(1)},${to.z.toFixed(1)}`;
    const cached = this.routes.get(key);
    if (cached) return cached.map((v) => v.clone());
    const grid = this.blockedGrid();
    const cell = (v: Vector3) => {
      const x = Math.max(0, Math.min(GRID_N - 1, Math.floor(v.x + GRID_HALF)));
      const z = Math.max(0, Math.min(GRID_N - 1, Math.floor(v.z + GRID_HALF)));
      return z * GRID_N + x;
    };
    const start = cell(from);
    const goal = cell(to);
    const gx = goal % GRID_N;
    const gz = Math.floor(goal / GRID_N);
    const h = (i: number) => {
      const dx = Math.abs((i % GRID_N) - gx);
      const dz = Math.abs(Math.floor(i / GRID_N) - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const cost = new Float32Array(GRID_N * GRID_N).fill(Infinity);
    const prev = new Int32Array(GRID_N * GRID_N).fill(-1);
    const open: number[] = [start];
    cost[start] = 0;
    while (open.length) {
      // Открытых клеток немного: простой поиск минимума быстрее кучи.
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (cost[open[k]] + h(open[k]) < cost[open[bi]] + h(open[bi])) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) break;
      const cx = cur % GRID_N;
      const cz = Math.floor(cur / GRID_N);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= GRID_N || nz >= GRID_N) continue;
          const ni = nz * GRID_N + nx;
          if (grid[ni] && ni !== goal) continue;
          // По диагонали только если не срезаем угол занятой клетки.
          if (dx && dz && (grid[cz * GRID_N + nx] || grid[nz * GRID_N + cx])) continue;
          const nc = cost[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (nc >= cost[ni]) continue;
          if (cost[ni] === Infinity) open.push(ni);
          cost[ni] = nc;
          prev[ni] = cur;
        }
    }
    if (prev[goal] < 0) return [to.clone()];
    const cells: Vector3[] = [];
    for (let i = prev[goal]; i >= 0 && i !== start; i = prev[i]) cells.push(new Vector3((i % GRID_N) - GRID_HALF + 0.5, 0, Math.floor(i / GRID_N) - GRID_HALF + 0.5));
    cells.reverse();
    cells.push(to.clone());
    // Срезаем углы: от каждой точки идём сразу к самой дальней, что видна напрямую.
    const path: Vector3[] = [];
    let at = from;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.clear(at, cells[j])) j--;
      path.push(cells[j]);
      at = cells[j];
      i = j + 1;
    }
    this.routes.set(key, path.map((v) => v.clone()));
    return path;
  }

  /** Виден ли отрезок напрямую: не задевает ни одного препятствия с запасом на тело рабочего. */
  private clear(a: Vector3, b: Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-9;
    for (const o of this.obstacles) {
      const t = Math.max(0, Math.min(1, ((o.c.x - a.x) * dx + (o.c.z - a.z) * dz) / len2));
      const r = o.r + BODY - 0.05;
      if (Math.hypot(a.x + dx * t - o.c.x, a.z + dz * t - o.c.z) < r) return false;
    }
    return true;
  }

  private blockedGrid(): Uint8Array {
    if (this.grid) return this.grid;
    const g = new Uint8Array(GRID_N * GRID_N);
    for (const o of this.obstacles) {
      const r = o.r + BODY;
      for (let z = Math.floor(o.c.z - r - 1); z <= Math.ceil(o.c.z + r + 1); z++)
        for (let x = Math.floor(o.c.x - r - 1); x <= Math.ceil(o.c.x + r + 1); x++) {
          const gx = x + GRID_HALF;
          const gz = z + GRID_HALF;
          if (gx < 0 || gz < 0 || gx >= GRID_N || gz >= GRID_N) continue;
          if (Math.hypot(x + 0.5 - o.c.x, z + 0.5 - o.c.z) < r) g[gz * GRID_N + gx] = 1;
        }
    }
    this.grid = g;
    return g;
  }

  /**
   * Рабочие не проходят друг сквозь друга: от соседа ближе PERSONAL_SPACE шаг
   * отклоняется в сторону. У самой цели не мешает, иначе двое у входа в шахту толкались бы.
   */
  private keepApart(w: Worker, dir: Vector3) {
    let px = 0;
    let pz = 0;
    for (const o of this.workers) {
      if (o === w || !o.root.isEnabled()) continue;
      const dx = w.root.position.x - o.root.position.x;
      const dz = w.root.position.z - o.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) continue;
      // Сосед на дорожке впереди: заранее берём правее, и встречные расходятся, а не
      // проходят друг сквозь друга.
      const ahead = -(dx * dir.x + dz * dir.z);
      const lateral = Math.abs(dx * dir.z - dz * dir.x);
      if (ahead > 0 && ahead < 3 && lateral < 1.1) {
        const k = 1 - ahead / 3;
        px += dir.z * k;
        pz -= dir.x * k;
      }
      if (d >= PERSONAL_SPACE) continue;
      const k = (PERSONAL_SPACE - d) / PERSONAL_SPACE;
      px += (dx / d) * k;
      pz += (dz / d) * k;
    }
    if (!px && !pz) return;
    dir.x += px * 0.8;
    dir.z += pz * 0.8;
    dir.normalize();
  }

  /**
   * На время стройки один крестьянин с шахты (не тот, что внутри) уходит к лесам и
   * стучит молотком; стройка кончилась или таймер встал, и он возвращается к добыче.
   */
  private assignBuilder() {
    const wanted = !!this.site && this.buildTimer && !this.frozen;
    if (wanted && !this.builder) {
      const w = this.workers.find((x) => x.job === 'gold' && this.inMine !== x) ?? this.workers[0];
      this.releaseTree(w);
      w.load.isVisible = false;
      w.root.setEnabled(true);
      this.builder = w;
    } else if (!wanted && this.builder) {
      this.builder.state = 'idle';
      this.builder = null;
    }
  }

  private build(w: Worker, dt: number) {
    const site = this.site!;
    // Со стороны ратуши, у края лесов.
    const a = Math.atan2(-site.x, -site.z) + 0.5;
    const stand = site.add(new Vector3(Math.sin(a) * 4.6, 0, Math.cos(a) * 4.6));
    if (this.walk(w, stand, 5.5, dt)) {
      w.root.rotation.y = Math.atan2(site.x - w.root.position.x, site.z - w.root.position.z);
      w.model?.play('Stand Work 1');
      if (!w.model) w.root.position.y = Math.abs(Math.sin(performance.now() / 120)) * 0.15;
    } else {
      w.model?.play('Walk 1');
      w.model?.setSpeed(5.5 / PEASANT_WALK);
    }
  }

  /** Зайти в шахту, если она свободна; пока внутри кто-то есть, шахта «работает». */
  private enterMine(w: Worker): boolean {
    if (this.inMine && this.inMine !== w) return false;
    this.inMine = w;
    this.mineModel?.play('Stand Work 1');
    return true;
  }

  private leaveMine() {
    this.inMine = null;
    this.mineModel?.play('Stand 1');
  }

  /** Вход в шахту: деревянный навес между её осями +x и +z, лицом к ратуше. */
  private mineDoor(w: Worker): Vector3 {
    const spread = (w.phase - 1.4) * 0.6;
    return this.minePos.add(new Vector3(3.6 + spread, 0, 3.6 - spread));
  }

  /**
   * Куда сдавать добычу: к краю ратуши со стороны добычи, а дерево к лесопилке, если
   * она построена и ближе. Рабочие сдают рядом, но не в одну точку.
   */
  private dropFor(w: Worker, from: Vector3): { spot: Vector3; center: Vector3 } {
    let center = Vector3.Zero();
    let r = this.hallR + 0.6;
    const mill = BUILDING_SPOTS.lumbermill;
    if (w.job === 'lumber' && this.mill && Vector3.Distance(from, mill) - 3.8 < from.length() - this.hallR) {
      center = mill;
      r = 3.8 + BODY + 0.15;
    }
    const a = Math.atan2(from.x - center.x, from.z - center.z) + (w.phase - 1.4) * 0.25;
    return { spot: new Vector3(center.x + Math.sin(a) * r, 0, center.z + Math.cos(a) * r), center };
  }

  /**
   * Следующее дерево для лесоруба: с опушки (первый ряд и крайний столбец рощи, чтобы
   * не продираться сквозь лес), из четырёх ближайших к месту сдачи, по очереди, и не
   * то, к которому уже идёт другой лесоруб.
   */
  private pickTree(w: Worker) {
    this.releaseTree(w);
    const drop = this.dropFor(w, this.treePos).center;
    const near = this.trees
      .map((t, i) => ({ i, d: Vector3.Distance(t.pos, drop) }))
      .filter((t) => t.i < 5 || t.i % 5 === 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (let k = 0; k < near.length; k++) {
      const c = near[(w.trips + Math.round(w.phase) + k) % near.length];
      if (this.trees[c.i].busy) continue;
      w.tree = c.i;
      this.trees[c.i].busy = w;
      return;
    }
    w.tree = near[0].i;
  }

  private releaseTree(w: Worker) {
    const t = this.trees[w.tree];
    if (t?.busy === w) {
      t.busy = null;
      t.model?.play('Stand 1');
    }
  }

  /** Где встать у дерева: со стороны места сдачи, вплотную к стволу. */
  private treeStand(w: Worker): Vector3 {
    const t = this.trees[w.tree];
    const drop = this.dropFor(w, t.pos).center;
    const d = drop.subtract(t.pos);
    d.y = 0;
    return t.pos.add(d.normalize().scale(1.4));
  }

  /** Рабочий сдал добычу: над ним всплывает целая часть накопленного с прошлого раза. */
  private deliver(w: Worker) {
    const n = Math.floor(this.pending[w.job]);
    if (n < 1) return;
    this.pending[w.job] -= n;
    const plane = MeshBuilder.CreatePlane('float', { width: 4, height: 1.5 }, this.scene);
    plane.material = floatMaterial(this.scene, `+${n}`, w.job === 'gold' ? '#ffd84a' : '#5adf4a', w.job === 'gold' ? coinImage() : null);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.parent = this.root;
    plane.position.set(w.root.position.x, 4, w.root.position.z);
    this.floaters.push({ mesh: plane, age: 0 });
  }

  private updateFloaters(dt: number) {
    for (const f of this.floaters) {
      f.age += dt;
      f.mesh.position.y += dt * 1.6;
      f.mesh.visibility = Math.min(1, 2 * (1 - f.age / FLOAT_LIFE));
      if (f.age >= FLOAT_LIFE) f.mesh.dispose();
    }
    this.floaters = this.floaters.filter((f) => f.age < FLOAT_LIFE);
  }
}

/** Монета WC3 для «+N» золота (ui/coin.png); пока её нет, надпись без монеты. */
let coin: HTMLImageElement | null = null;
let coinAsked = false;
function coinImage(): HTMLImageElement | null {
  if (!coinAsked) {
    coinAsked = true;
    void loadArt('ui/coin.png').then((bytes) => {
      if (!bytes) return;
      const img = new Image();
      img.onload = () => (coin = img);
      img.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    });
  }
  return coin;
}

/** Материалы надписей «+N» общие: таких надписей немного разных, а всплывают они часто. */
const floatMats = new Map<string, StandardMaterial>();

function floatMaterial(scene: Scene, text: string, color: string, icon: HTMLImageElement | null = null): StandardMaterial {
  const key = text + color + (icon ? 'i' : '');
  let m = floatMats.get(key);
  if (m && m.getScene() === scene) return m;
  const tex = new DynamicTexture('floatText', { width: 256, height: 96 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 96);
  ctx.font = 'bold 64px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  // Монета слева от числа, как над ратушей в WC3.
  const x = icon ? 150 : 128;
  if (icon) ctx.drawImage(icon, x - ctx.measureText(text).width / 2 - 70, 14, 64, 64);
  ctx.strokeText(text, x, 70);
  ctx.fillStyle = color;
  ctx.fillText(text, x, 70);
  tex.update();
  m = new StandardMaterial('floatMat', scene);
  m.diffuseTexture = tex;
  m.emissiveColor = Color3.White();
  m.useAlphaFromDiffuseTexture = true;
  m.disableLighting = true;
  m.backFaceCulling = false;
  floatMats.set(key, m);
  return m;
}
