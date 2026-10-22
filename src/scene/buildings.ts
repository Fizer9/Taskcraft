// Здания дерева технологий у главной ратуши: модели WC3 (лесопилка, кузница, мастерская,
// сторожевая башня, гнездо грифонов, хранилище тайн) с мелочами рядом (стойка с доспехами
// у кузницы, грифон у гнезда). Пока модели не загрузились, стоят заглушки из простых фигур.

import { MeshBuilder, Scene, TransformNode, Vector3, type AbstractMesh, type Mesh } from '@babylonjs/core';
import type { BuildingId } from '../state/types';
import type { ModelLibrary, ModelName } from './library';
import type { ModelInstance } from './models';
import * as P from './placeholders';

/** Места зданий вокруг главной ратуши, в координатах базы (главная стоит в центре карты без поворота). */
export const BUILDING_SPOTS: Record<BuildingId, Vector3> = {
  lumbermill: new Vector3(8, 0, -20),
  workshop: new Vector3(10, 0, 22),
  blacksmith: new Vector3(21, 0, 19),
  towers: new Vector3(-13, 0, 23),
  aviary: new Vector3(-25, 0, 21),
  vault: new Vector3(25, 0, 28),
};

/** Модель здания: [имя, размер, анимация]. Башня в WC3 одна на все виды, сторожевая это первое улучшение. */
const MODELS: Record<BuildingId, [ModelName, number, string]> = {
  lumbermill: ['humanlumbermill', 1.2, 'Stand 1'],
  workshop: ['workshop', 1.2, 'Stand 1'],
  blacksmith: ['blacksmith', 1.2, 'Stand 1'],
  towers: ['humantower', 1.1, 'Stand Upgrade First Ready Attack'],
  aviary: ['gryphonaviary', 1.2, 'Stand 1'],
  vault: ['arcanevault', 1.2, 'Stand 1'],
};

/** Мелочь из настоящих моделей рядом со зданием: [модель, смещение, поворот, размер]. */
const DECOR: Partial<Record<BuildingId, [ModelName, Vector3, number, number][]>> = {
  lumbermill: [['wheelbarrel', new Vector3(4.5, 0, 2), 0.8, 1], ['crates1', new Vector3(-4.5, 0, 1.5), 0.3, 1]],
  blacksmith: [['armorrack', new Vector3(-4.5, 0, -1), 0.4, 1], ['weapons', new Vector3(4.5, 0, -1.5), -0.6, 1]],
  aviary: [['gryphonrider', new Vector3(0, 0, -6), Math.PI, 0.8]],
  workshop: [['crates0', new Vector3(4.5, 0, -1), 0.2, 1]],
};

function part(mesh: Mesh, parent: TransformNode, hex: string, pos: Vector3, emissive = 0): Mesh {
  mesh.material = P.mat(mesh.getScene(), hex, emissive);
  mesh.parent = parent;
  mesh.position.copyFrom(pos);
  return mesh;
}

/** Заглушка здания: у каждого своя форма и цвет крыши. */
function makeBuilding(scene: Scene, id: BuildingId): TransformNode {
  const root = new TransformNode('bld-' + id, scene);
  const stone = '#9a8f7d';
  const blue = '#2f4f9e';
  const box = (w: number, d: number, h: number, hex: string, y = h / 2) => part(MeshBuilder.CreateBox('b', { width: w, depth: d, height: h }, scene), root, hex, new Vector3(0, y, 0));
  const gable = (w: number, d: number, y: number, hex: string) => {
    const roof = part(MeshBuilder.CreateCylinder('r', { diameter: d * 1.1, height: w * 1.05, tessellation: 3 }, scene), root, hex, new Vector3(0, y, 0));
    roof.rotation.z = Math.PI / 2;
    roof.scaling.x = 0.6;
  };
  switch (id) {
    case 'lumbermill':
      box(6, 4.5, 3, '#8a6a3a');
      gable(6, 4.5, 3.8, '#6b4a24');
      part(MeshBuilder.CreateCylinder('saw', { diameter: 2.4, height: 0.2, tessellation: 16 }, scene), root, '#c8c8c8', new Vector3(3.2, 1.6, 0)).rotation.z = Math.PI / 2;
      break;
    case 'workshop':
      box(6.5, 5, 3.2, stone);
      gable(6.5, 5, 4, blue);
      part(MeshBuilder.CreateCylinder('chimney', { diameter: 1, height: 3 }, scene), root, '#5a5048', new Vector3(2, 5, 1));
      break;
    case 'blacksmith':
      box(6, 5, 3, '#7d7468');
      gable(6, 5, 3.8, blue);
      part(MeshBuilder.CreateCylinder('forge', { diameter: 1.3, height: 3.4 }, scene), root, '#4a3a30', new Vector3(-2, 5, -1));
      part(MeshBuilder.CreateSphere('fire', { diameter: 0.9 }, scene), root, '#ff8a2a', new Vector3(-2, 6.9, -1), 1);
      break;
    case 'towers':
      part(MeshBuilder.CreateCylinder('tower', { diameterTop: 2.2, diameterBottom: 3, height: 8, tessellation: 10 }, scene), root, stone, new Vector3(0, 4, 0));
      part(MeshBuilder.CreateCylinder('towerTop', { diameterTop: 0, diameterBottom: 3.4, height: 2.6, tessellation: 10 }, scene), root, blue, new Vector3(0, 9.3, 0));
      break;
    case 'aviary':
      part(MeshBuilder.CreateCylinder('aviBase', { diameter: 8, height: 2, tessellation: 12 }, scene), root, stone, new Vector3(0, 1, 0));
      part(MeshBuilder.CreateSphere('aviDome', { diameter: 7.4, slice: 0.5 }, scene), root, '#d8d2c4', new Vector3(0, 2, 0));
      part(MeshBuilder.CreateCylinder('aviFlag', { diameter: 0.25, height: 3 }, scene), root, '#5a5048', new Vector3(0, 6.5, 0));
      break;
    case 'vault':
      box(5.5, 5.5, 3.4, '#6a5a7a');
      part(MeshBuilder.CreateSphere('vaultDome', { diameter: 5, slice: 0.5 }, scene), root, '#8a6ad8', new Vector3(0, 3.4, 0), 0.2);
      part(MeshBuilder.CreateSphere('vaultOrb', { diameter: 0.9 }, scene), root, '#c9a0ff', new Vector3(0, 6.3, 0), 0.9);
      break;
  }
  return root;
}

/** Стройка: деревянный настил и столбы лесов. */
function makeScaffold(scene: Scene): TransformNode {
  const root = new TransformNode('scaffold', scene);
  part(MeshBuilder.CreateBox('deck', { width: 6, depth: 5, height: 0.5 }, scene), root, '#8a6a3a', new Vector3(0, 0.25, 0));
  for (const [x, z] of [[-2.7, -2.2], [2.7, -2.2], [-2.7, 2.2], [2.7, 2.2]])
    part(MeshBuilder.CreateBox('post', { width: 0.3, depth: 0.3, height: 4 }, scene), root, '#6b4a24', new Vector3(x, 2, z));
  part(MeshBuilder.CreateBox('beam', { width: 6, depth: 0.3, height: 0.3 }, scene), root, '#6b4a24', new Vector3(0, 3.8, -2.2));
  part(MeshBuilder.CreateBox('beam', { width: 6, depth: 0.3, height: 0.3 }, scene), root, '#6b4a24', new Vector3(0, 3.8, 2.2));
  return root;
}

const RISE_SECONDS = 1.8;

/**
 * Новые здания вырастают из земли за пару секунд. Анимация постройки из моделей WC3
 * (Birth) не годится: в ней сами стены здания скрыты, видны только леса.
 */
export class Riser {
  private rising: { node: TransformNode; t: number }[] = [];

  add(node: TransformNode) {
    node.scaling.y = 0.02;
    this.rising.push({ node, t: 0 });
  }

  update(dt: number) {
    if (!this.rising.length) return;
    for (const r of this.rising) {
      r.t = Math.min(1, r.t + dt / RISE_SECONDS);
      // Быстро вверх и мягкая остановка, с лёгким перехлёстом в конце.
      const k = 1 - Math.pow(1 - r.t, 3);
      r.node.scaling.y = Math.max(0.02, k + Math.sin(r.t * Math.PI) * 0.06);
    }
    this.rising = this.rising.filter((r) => {
      if (r.t < 1) return true;
      r.node.scaling.y = 1;
      return false;
    });
  }
}

export class MainBuildings {
  private nodes = new Map<BuildingId, TransformNode>();
  private decor = new Map<BuildingId, ModelInstance[]>();
  private models = new Map<BuildingId, ModelInstance>();
  private scaffold: { id: BuildingId; node: TransformNode } | null = null;
  /** Только что достроенные здания вырастают из земли; при загрузке игры они уже стоят. */
  private riser = new Riser();
  private loaded = false;
  private lib: ModelLibrary | null = null;
  private onMesh: (m: AbstractMesh) => void = () => {};

  constructor(
    private scene: Scene,
    private parent: TransformNode,
    private baseId: string,
    private team: string,
  ) {}

  setLibrary(lib: ModelLibrary, onMesh: (m: AbstractMesh) => void) {
    this.lib = lib;
    this.onMesh = onMesh;
    for (const id of this.nodes.keys()) this.dress(id);
  }

  /** built: построенные здания; constructing: здание, которое сейчас строится. */
  sync(built: BuildingId[], constructing: BuildingId | null) {
    for (const id of built) {
      if (this.nodes.has(id)) continue;
      const node = makeBuilding(this.scene, id);
      this.place(node, id);
      this.nodes.set(id, node);
      this.dress(id);
      if (this.loaded) this.riser.add(node);
    }
    this.loaded = true;
    if (this.scaffold && this.scaffold.id !== constructing) {
      this.scaffold.node.dispose();
      this.scaffold = null;
    }
    if (constructing && !this.scaffold && !this.nodes.has(constructing)) {
      const node = makeScaffold(this.scene);
      this.place(node, constructing);
      this.scaffold = { id: constructing, node };
    }
  }

  update(dt: number) {
    this.riser.update(dt);
  }

  /** Здания на сцене и строящееся (в лесах) для полосок здоровья. */
  structures(): { node: TransformNode; scaffold: boolean }[] {
    const list = [...this.nodes.values()].map((node) => ({ node, scaffold: false }));
    if (this.scaffold) list.push({ node: this.scaffold.node, scaffold: true });
    return list;
  }

  private place(node: TransformNode, id: BuildingId) {
    node.parent = this.parent;
    node.position.copyFrom(BUILDING_SPOTS[id]);
    // Фасадом к ратуше.
    node.rotation.y = Math.atan2(-BUILDING_SPOTS[id].x, -BUILDING_SPOTS[id].z);
    node.getChildMeshes().forEach((m) => (m.metadata = { ...(m.metadata ?? {}), baseId: this.baseId, building: id }));
  }

  private dress(id: BuildingId) {
    const node = this.nodes.get(id);
    if (!this.lib || !node) return;
    // Модель здания вместо заглушки: фигуры прячутся, их место занимает WC3.
    if (!this.models.has(id)) {
      const [name, size, anim] = MODELS[id];
      const inst = this.lib.create(name, size, this.team);
      if (inst) {
        for (const m of node.getChildMeshes(true)) m.setEnabled(false);
        inst.root.parent = node;
        inst.root.getChildMeshes().forEach((m) => {
          m.metadata = { ...(m.metadata ?? {}), baseId: this.baseId, building: id };
          this.onMesh(m);
        });
        inst.play(anim);
        this.models.set(id, inst);
      }
    }
    const items = DECOR[id];
    if (this.decor.has(id) || !items) return;
    const made: ModelInstance[] = [];
    for (const [model, at, rot, scale] of items) {
      const inst = this.lib.create(model, scale, this.team);
      if (!inst) continue;
      inst.root.parent = node;
      inst.root.position.copyFrom(at);
      inst.root.rotation.y = rot;
      inst.root.getChildMeshes().forEach((m) => {
        m.metadata = { ...(m.metadata ?? {}), baseId: this.baseId };
        this.onMesh(m);
      });
      inst.playLike('Stand');
      made.push(inst);
    }
    this.decor.set(id, made);
  }
}
