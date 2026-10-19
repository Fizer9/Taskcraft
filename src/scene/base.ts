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
import type { Project } from '../state/types';
import type { ModelLibrary, ModelName } from './library';
import type { ModelInstance } from './models';
import * as P from './placeholders';

export const BANNER_COLORS: Record<Project['kind'], string> = {
  work: '#2f6bff',
  personal: '#3fae4a',
  any: '#e2b63c',
};

type WorkerState = 'toWork' | 'working' | 'toHall' | 'dropping' | 'idle';

interface Worker {
  root: TransformNode;
  load: Mesh;
  model?: ModelInstance;
  job: 'gold' | 'lumber';
  state: WorkerState;
  timer: number;
  idleSpot: Vector3;
  phase: number;
}

const HALL_DOOR = new Vector3(0, 0, 6.5);

export class Base {
  readonly root: TransformNode;
  private workers: Worker[] = [];
  private minePos: Vector3;
  private treePos: Vector3;
  private farms: TransformNode[] = [];
  private hpFill: Mesh | null = null;
  private fortressNode: TransformNode | null = null;
  private selection: Mesh;
  /** Заглушки, которые заменяются моделями WC3, когда те загружены. */
  private swaps: { node: TransformNode; model: ModelName; scale: number; anim?: string }[] = [];
  private lib: ModelLibrary | null = null;
  private onModelMesh: (m: AbstractMesh) => void = () => {};

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

    const dirt = MeshBuilder.CreateDisc('dirt', { radius: 24, tessellation: 40 }, scene);
    dirt.rotation.x = Math.PI / 2;
    dirt.position.y = 0.03;
    dirt.material = P.mat(scene, '#6b5a3a');
    dirt.material.alpha = 0.55;
    dirt.parent = this.root;
    dirt.isPickable = false;

    const hall = P.townHall(scene, BANNER_COLORS[project.kind], main);
    hall.parent = this.root;
    // Главная база — замок (вторая ступень улучшения ратуши), остальные — ратуши.
    this.swaps.push({ node: hall, model: 'townhall', scale: main ? 1.15 : 1, anim: main ? 'Stand Upgrade Second' : 'Stand 1' });

    this.minePos = new Vector3(-16, 0, -12);
    const mine = P.goldMine(scene);
    mine.parent = this.root;
    mine.position.copyFrom(this.minePos);
    this.swaps.push({ node: mine, model: 'goldmine', scale: 1 });

    this.treePos = new Vector3(16, 0, -14);
    for (let i = 0; i < 14; i++) {
      const t = P.tree(scene, 0.8 + ((i * 37) % 10) / 20);
      t.parent = this.root;
      t.position.set(14 + (i % 5) * 3.2 + ((i * 13) % 3), 0, -12 - Math.floor(i / 5) * 3.4 - ((i * 7) % 2));
      t.rotation.y = i * 1.7;
      this.swaps.push({ node: t, model: `lordaerontree${i % 4}` as ModelName, scale: 1 + ((i * 37) % 10) / 40 });
    }

    if (!main) {
      const bar = P.barracks(scene);
      bar.parent = this.root;
      bar.position.set(-13, 0, 9);
      const alt = P.altar(scene);
      alt.parent = this.root;
      alt.position.set(13, 0, 10);
      this.swaps.push({ node: bar, model: 'humanbarracks', scale: 0.85 }, { node: alt, model: 'altarofkings', scale: 0.85 });

      this.fortressNode = P.fortress(scene);
      this.fortressNode.parent = this.root;
      this.fortressNode.position.set(0, 0, -48); // за шахтой и лесом, дальше от центра
      this.hpFill = this.makeHpBar(this.fortressNode);
    }

    this.selection = MeshBuilder.CreateTorus('sel', { diameter: 15, thickness: 0.35, tessellation: 48 }, scene);
    this.selection.material = P.mat(scene, '#3dff3d', 0.9);
    this.selection.parent = this.root;
    this.selection.position.y = 0.15;
    this.selection.isVisible = false;
    this.selection.isPickable = false;

    this.makeLabel(project.name);

    for (let i = 0; i < 5; i++) {
      const { root, load } = P.peasant(scene);
      root.parent = this.root;
      const idleSpot = new Vector3(-4 + i * 2, 0, 9 + (i % 2));
      root.position.copyFrom(idleSpot);
      this.workers.push({ root, load, job: i === 4 ? 'lumber' : 'gold', state: 'idle', timer: 0, idleSpot, phase: i * 0.7 });
    }

    // По этой метке клик по любой части базы выбирает её.
    this.root.getChildMeshes().forEach((m) => {
      if (m.isPickable) m.metadata = { ...(m.metadata ?? {}), baseId: project.id };
    });
  }

  private makeLabel(text: string): Mesh {
    const tex = new DynamicTexture('label', { width: 512, height: 96 }, this.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 96);
    ctx.font = 'bold 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 256, 62);
    ctx.fillStyle = '#ffd34d';
    ctx.fillText(text, 256, 62);
    tex.update();
    const m = new StandardMaterial('labelMat', this.scene);
    m.diffuseTexture = tex;
    m.emissiveColor = Color3.White();
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane('labelPlane', { width: 20, height: 3.75 }, this.scene);
    plane.material = m;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position.set(this.project.slot.x, 21, this.project.slot.z);
    plane.isPickable = false;
    return plane;
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
    fill.material = P.mat(this.scene, '#2fd13a', 1);
    fill.parent = bg;
    fill.position.z = -0.01;
    fill.isPickable = false;
    return fill;
  }

  /** Заменяет заглушки моделями WC3 из библиотеки (то, что в ней нашлось). */
  applyModels(lib: ModelLibrary, onMesh: (m: AbstractMesh) => void) {
    this.lib = lib;
    this.onModelMesh = onMesh;
    for (const s of [...this.swaps]) this.swap(s);
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

  private swap(s: { node: TransformNode; model: ModelName; scale: number; anim?: string }) {
    const inst = this.lib?.create(s.model, s.scale);
    if (!inst) return;
    inst.root.parent = s.node.parent;
    inst.root.position.copyFrom(s.node.position);
    inst.root.rotation.copyFrom(s.node.rotation);
    inst.root.getChildMeshes().forEach((m) => {
      m.metadata = { ...(m.metadata ?? {}), baseId: this.project.id };
      this.onModelMesh(m);
    });
    if (s.anim) inst.play(s.anim);
    else inst.playLike('Stand 1');
    s.node.dispose();
    s.node = inst.root;
    this.swaps = this.swaps.filter((x) => x !== s);
  }

  setSelected(on: boolean) {
    this.selection.isVisible = on;
  }

  setFarms(count: number) {
    while (this.farms.length < Math.min(count, 12)) {
      const f = P.farm(this.scene);
      f.parent = this.root;
      const i = this.farms.length;
      f.position.set(-24 + (i % 4) * 5.5, 0, 2 + Math.floor(i / 4) * 5.5);
      this.farms.push(f);
      const swap = { node: f as TransformNode, model: 'farm' as ModelName, scale: 0.85 };
      this.swaps.push(swap);
      if (this.lib) this.swap(swap);
    }
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
  heroSpot(): Vector3 {
    return Vector3.TransformCoordinates(new Vector3(5, 0, 10), this.root.computeWorldMatrix(true));
  }

  /** factor: множитель добычи из экономики, 0 значит база стоит. */
  update(dt: number, factor: number) {
    const speed = 7 * Math.max(0.35, factor);
    for (const w of this.workers) {
      if (factor <= 0) {
        w.load.isVisible = false;
        w.state = 'idle';
        const arrived = this.walk(w, w.idleSpot, 4, dt);
        w.model?.playLike(arrived ? 'Stand 1' : 'Walk 1');
        w.root.setEnabled(true);
        continue;
      }
      this.animateWorker(w);
      const workPos = w.job === 'gold' ? this.minePos.add(new Vector3(2 + w.phase, 0, 5)) : this.treePos.add(new Vector3(-2, 0, 3 + w.phase));
      switch (w.state) {
        case 'idle':
          w.state = 'toWork';
          break;
        case 'toWork':
          if (this.walk(w, workPos, speed, dt)) {
            w.state = 'working';
            w.timer = w.job === 'gold' ? 1.2 : 2.5;
          }
          break;
        case 'working':
          w.timer -= dt * Math.max(0.35, factor);
          if (!w.model) w.root.position.y = Math.abs(Math.sin(performance.now() / 120)) * 0.15;
          if (w.timer <= 0) {
            w.state = 'toHall';
            if (!w.model) {
              w.load.isVisible = true;
              w.load.material = P.mat(this.scene, w.job === 'gold' ? '#f2c230' : '#7a5228', 0.3);
            }
          }
          break;
        case 'toHall':
          if (this.walk(w, HALL_DOOR.add(new Vector3(w.phase - 1.5, 0, 0)), speed, dt)) {
            w.state = 'dropping';
            w.timer = 0.3;
          }
          break;
        case 'dropping':
          w.timer -= dt;
          if (w.timer <= 0) {
            w.load.isVisible = false;
            w.state = 'toWork';
          }
          break;
      }
    }
  }

  /** Анимация крестьянина по его состоянию: идёт, рубит, несёт золото или дерево. */
  private animateWorker(w: Worker) {
    const m = w.model;
    if (!m) return;
    const load = w.job === 'gold' ? 'Gold' : 'Lumber';
    // В шахту крестьянин заходит и пропадает, как в WC3; у дерева машет топором.
    w.root.setEnabled(!(w.state === 'working' && w.job === 'gold'));
    if (w.state === 'toWork') m.play('Walk 1');
    else if (w.state === 'working') m.play('Attack 1');
    else if (w.state === 'toHall') m.play(`Walk ${load} 1`);
    else m.play(`Stand ${load} 1`);
  }

  /** Двигает рабочего к цели, возвращает true, когда дошёл. */
  private walk(w: Worker, target: Vector3, speed: number, dt: number): boolean {
    const pos = w.root.position;
    const d = target.subtract(new Vector3(pos.x, 0, pos.z));
    const dist = d.length();
    if (dist < 0.3) {
      pos.y = 0;
      return true;
    }
    const step = Math.min(dist, speed * dt);
    pos.x += (d.x / dist) * step;
    pos.z += (d.z / dist) * step;
    pos.y = w.model ? 0 : Math.abs(Math.sin(performance.now() / 90 + w.phase)) * 0.25;
    w.root.rotation.y = Math.atan2(d.x, d.z);
    return false;
  }
}
