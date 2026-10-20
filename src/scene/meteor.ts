// Метеор Инфернала над базой: за несколько дней до срока большой задачи в небе
// висит падающий камень, и с каждым днём он ниже. Задача сделана вовремя, и метеор
// сгорает в воздухе; срок прошёл, и он падает Инферналом (это уже демон Легиона).

import { MeshBuilder, Scene, TransformNode, Vector3, type ParticleSystem } from '@babylonjs/core';
import { fire } from './blight';
import * as P from './placeholders';

/** Высота метеора по дням до срока: в день срока он почти у земли. */
function height(daysLeft: number): number {
  return 11 + daysLeft * 5;
}

export class Meteor {
  private node: TransformNode | null = null;
  private trail: ParticleSystem | null = null;
  private taskId: string | null = null;
  private target = 0;
  /** Сгорание в воздухе: сколько секунд осталось вспышке. */
  private burning = 0;

  constructor(
    private scene: Scene,
    private parent: TransformNode,
  ) {}

  /** Ближайшая большая задача с подходящим сроком, или null. done: задача уже выполнена. */
  set(next: { taskId: string; daysLeft: number } | null, doneTaskIds: Set<string>) {
    if (this.taskId && (!next || next.taskId !== this.taskId)) {
      if (doneTaskIds.has(this.taskId)) this.burnUp();
      else this.clear();
    }
    if (!next || this.burning > 0) return;
    if (!this.node) this.spawn(next.taskId);
    this.target = height(next.daysLeft);
  }

  private spawn(taskId: string) {
    const node = new TransformNode('meteor', this.scene);
    // Без вращения базы: метеор всегда чуть ближе к камере, чем ратуша, чтобы был на виду.
    const c = this.parent.getAbsolutePosition();
    node.position.set(c.x + 7, height(3) + 8, c.z - 10);
    const rock = MeshBuilder.CreateIcoSphere('meteorRock', { radius: 1.8, subdivisions: 1 }, this.scene);
    rock.material = P.mat(this.scene, '#5a4a3a', 0.25);
    rock.parent = node;
    rock.isPickable = false;
    const glow = MeshBuilder.CreateIcoSphere('meteorGlow', { radius: 1.1, subdivisions: 1 }, this.scene);
    glow.material = P.mat(this.scene, '#5dff3a', 1);
    glow.parent = node;
    glow.position.y = -0.9;
    glow.isPickable = false;
    this.trail = fire(this.scene, node, new Vector3(0, 0.8, 0), 1.4, true);
    this.trail.gravity = new Vector3(0, 14, 0);
    this.node = node;
    this.taskId = taskId;
  }

  private clear() {
    this.trail?.dispose(false);
    this.trail = null;
    this.node?.dispose();
    this.node = null;
    this.taskId = null;
    this.burning = 0;
  }

  /** Вспышка: метеор раздувается и тает за секунду. */
  private burnUp() {
    if (!this.node) return this.clear();
    this.burning = 1.2;
    this.taskId = null;
    if (this.trail) this.trail.emitRate = 200;
  }

  update(dt: number) {
    const n = this.node;
    if (!n) return;
    if (this.burning > 0) {
      this.burning -= dt;
      n.scaling.setAll(1 + (1.2 - this.burning) * 1.5);
      n.getChildMeshes().forEach((m) => (m.visibility = Math.max(0, this.burning / 1.2)));
      if (this.burning <= 0) this.clear();
      return;
    }
    // Медленно опускается к высоте своего дня и крутится.
    n.position.y += (this.target - n.position.y) * Math.min(1, dt * 0.8);
    n.rotation.x += dt * 0.7;
    n.rotation.z += dt * 0.4;
  }
}
