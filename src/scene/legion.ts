// Демоны Пылающего Легиона у базы: просроченные задачи стоят у ратуши и бьют по ней.
// Сильнейшие видны по отдельности, остальные сведены в лагерь с числом над ним.

import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AbstractMesh,
} from '@babylonjs/core';
import type { Level } from '../state/types';
import type { ModelLibrary, ModelName } from './library';
import type { ModelInstance } from './models';
import * as P from './placeholders';

/** Модель по ступени демона. Стражника Рока и Инфернала пока нет: их заменяют
 * увеличенный Страж Скверны и каменная заглушка, пока модели не выгружены из игры. */
const LOOK: Record<Level, { model: ModelName | null; scale: number }> = {
  1: { model: 'felhound', scale: 0.75 },
  2: { model: 'felgaurd', scale: 0.75 },
  3: { model: 'felgaurd', scale: 1.1 },
  4: { model: null, scale: 1 },
};

/** Места демонов у ратуши, со стороны врат (врата в 48 единицах за базой). */
const SPOTS = [new Vector3(0, 0, -11), new Vector3(-9.5, 0, -6), new Vector3(9.5, 0, -6)];
const CAMP = new Vector3(0, 0, -20);

export interface DemonView {
  taskId: string;
  rank: Level;
}

interface Demon extends DemonView {
  root: TransformNode;
  model: ModelInstance | null;
}

export class Demons {
  private demons = new Map<string, Demon>();
  private camp: TransformNode | null = null;
  private campCount = -1;
  private lib: ModelLibrary | null = null;
  private onMesh: (m: AbstractMesh) => void = () => {};

  constructor(
    private scene: Scene,
    private parent: TransformNode,
    private baseId: string,
  ) {}

  setLibrary(lib: ModelLibrary, onMesh: (m: AbstractMesh) => void) {
    this.lib = lib;
    this.onMesh = onMesh;
    for (const d of [...this.demons.values()]) this.dress(d, true);
  }

  /** shown: сильнейшие демоны по порядку; extra: сколько ещё ушло в лагерь. */
  sync(shown: DemonView[], extra: number) {
    const ids = new Set(shown.map((d) => d.taskId));
    for (const d of [...this.demons.values()]) if (!ids.has(d.taskId)) this.remove(d);
    shown.forEach((v, i) => {
      let d = this.demons.get(v.taskId);
      if (!d) {
        const root = new TransformNode('demon-' + v.taskId, this.scene);
        root.parent = this.parent;
        d = { ...v, root, model: null };
        this.demons.set(v.taskId, d);
        this.dress(d, true);
      } else if (d.rank !== v.rank) {
        d.rank = v.rank;
        this.dress(d, true);
      }
      d.root.position.copyFrom(SPOTS[i % SPOTS.length]);
      // Лицом к ратуше.
      d.root.rotation.y = Math.atan2(-d.root.position.x, -d.root.position.z);
    });
    this.setCamp(extra);
  }

  private dress(d: Demon, fresh: boolean) {
    if (!fresh && d.model) return;
    d.model?.dispose();
    d.model = null;
    for (const c of d.root.getChildren()) c.dispose();
    const look = LOOK[d.rank];
    const model = look.model ? (this.lib?.create(look.model, look.scale) ?? null) : null;
    if (model) {
      model.root.parent = d.root;
      model.root.getChildMeshes().forEach((m) => {
        m.metadata = { ...(m.metadata ?? {}), baseId: this.baseId, taskId: d.taskId };
        this.onMesh(m);
      });
      model.play('Attack 1');
      d.model = model;
    } else {
      const body = d.rank === 4 ? infernal(this.scene) : felBeast(this.scene, d.rank);
      body.parent = d.root;
      body.getChildMeshes().forEach((m) => (m.metadata = { baseId: this.baseId, taskId: d.taskId }));
    }
  }

  private remove(d: Demon) {
    d.model?.dispose();
    d.root.dispose();
    this.demons.delete(d.taskId);
  }

  /** Лагерь Легиона: костёр Скверны и число демонов над ним. */
  private setCamp(extra: number) {
    if (extra === this.campCount) return;
    this.campCount = extra;
    this.camp?.dispose();
    this.camp = null;
    if (extra <= 0) return;
    const camp = new TransformNode('legionCamp', this.scene);
    camp.parent = this.parent;
    camp.position.copyFrom(CAMP);
    const fire = MeshBuilder.CreateCylinder('campFire', { diameterTop: 0, diameterBottom: 2.4, height: 2.6, tessellation: 7 }, this.scene);
    fire.material = P.mat(this.scene, '#5dff3a', 0.9);
    fire.parent = camp;
    fire.position.y = 1.3;
    fire.isPickable = false;
    const ring = MeshBuilder.CreateTorus('campRing', { diameter: 4.2, thickness: 0.7, tessellation: 12 }, this.scene);
    ring.material = P.mat(this.scene, '#3b2f28');
    ring.parent = camp;
    ring.position.y = 0.3;
    ring.isPickable = false;
    const label = textPlane(this.scene, `Лагерь Легиона +${extra}`, '#7dff5a');
    label.parent = camp;
    label.position.y = 7;
  }

  update() {
    // Модели демонов сами крутят анимацию атаки; заглушки чуть покачиваются.
    const t = performance.now() / 300;
    for (const d of this.demons.values()) if (!d.model) d.root.position.y = Math.abs(Math.sin(t + d.root.position.x)) * 0.2;
  }
}

/** Заглушка гончей или стража: тёмное тело с зелёными глазами, больше на старших ступенях. */
function felBeast(scene: Scene, rank: Level): TransformNode {
  const root = new TransformNode('felBeast', scene);
  const s = 0.8 + rank * 0.25;
  const body = MeshBuilder.CreateCapsule('felBody', { radius: 0.7 * s, height: 2.2 * s }, scene);
  body.material = P.mat(scene, rank === 1 ? '#5a2a1a' : '#3a2a4a');
  body.parent = root;
  body.position.y = 1.2 * s;
  const eyes = MeshBuilder.CreateBox('felEyes', { width: 0.8 * s, height: 0.15 * s, depth: 0.1 }, scene);
  eyes.material = P.mat(scene, '#7dff3a', 1);
  eyes.parent = root;
  eyes.position.set(0, 1.9 * s, 0.7 * s);
  return root;
}

/** Заглушка Инфернала: каменный великан с зелёным пламенем внутри. */
function infernal(scene: Scene): TransformNode {
  const root = new TransformNode('infernal', scene);
  const rock = P.mat(scene, '#6a5e52', 0.15);
  const fire = P.mat(scene, '#5dff3a', 1);
  const parts: [string, number, Vector3, StandardMaterial][] = [
    ['infLegs', 2.4, new Vector3(0, 1.4, 0), rock],
    ['infChest', 3.4, new Vector3(0, 4, 0), rock],
    ['infHead', 1.6, new Vector3(0, 6.4, 0.3), rock],
    ['infArmL', 1.5, new Vector3(-2.4, 3.8, 0.4), rock],
    ['infArmR', 1.5, new Vector3(2.4, 3.8, 0.4), rock],
    ['infCore', 1.4, new Vector3(0, 4.1, 1.5), fire],
    ['infEyeL', 0.3, new Vector3(-0.5, 6.6, 1.6), fire],
    ['infEyeR', 0.3, new Vector3(0.5, 6.6, 1.6), fire],
    ['infFistL', 0.7, new Vector3(-2.8, 2, 1), fire],
    ['infFistR', 0.7, new Vector3(2.8, 2, 1), fire],
  ];
  for (const [name, r, pos, m] of parts) {
    const mesh = MeshBuilder.CreateIcoSphere(name, { radius: r, subdivisions: 1 }, scene);
    mesh.material = m;
    mesh.parent = root;
    mesh.position.copyFrom(pos);
  }
  return root;
}

export function textPlane(scene: Scene, text: string, color: string): Mesh {
  const tex = new DynamicTexture('campLabel', { width: 512, height: 80 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 80);
  ctx.font = 'bold 38px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 256, 52);
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 52);
  tex.update();
  const m = new StandardMaterial('campLabelMat', scene);
  m.diffuseTexture = tex;
  m.emissiveColor = Color3.White();
  m.useAlphaFromDiffuseTexture = true;
  m.disableLighting = true;
  m.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane('campLabelPlane', { width: 14, height: 2.2 }, scene);
  plane.material = m;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  return plane;
}
