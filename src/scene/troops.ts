// Юниты задач на базе. Нанятый юнит (задача в казарме) стоит строем у казармы,
// юнит задачи в работе уходит к крепости врага и бьётся у её стен, а когда задача
// выполнена, он бросается на крепость, наносит удар и празднует победу.

import { MeshBuilder, Scene, TransformNode, Vector3, type AbstractMesh } from '@babylonjs/core';
import type { Level, Task } from '../state/types';
import type { ModelLibrary, ModelName } from './library';
import { turnTowards, type ModelInstance } from './models';
import * as P from './placeholders';

const MODEL: Record<Level, ModelName> = { 1: 'footman', 2: 'rifleman', 3: 'knight', 4: 'gryphonrider' };
/**
 * Скорость шага по уровню, как в WC3 (единицы игры × 0,025): пехотинец и стрелок 270,
 * рыцарь 350, грифон 250. Под эти скорости сделаны анимации ходьбы, ноги не скользят.
 */
const SPEED: Record<Level, number> = { 1: 6.75, 2: 6.75, 3: 8.75, 4: 6.25 };
/** Грифон летит над землёй (высота полёта WC3 240 единиц). */
const FLY = 4.5;
/** Больше юнитов на одной базе не рисуем, чтобы не загромождать карту. */
const MAX_TROOPS = 12;

type State = 'rally' | 'march' | 'fight' | 'charge' | 'victory';

interface Troop {
  taskId: string;
  level: Level;
  root: TransformNode;
  model: ModelInstance | null;
  state: State;
  /** Точки пути, по которым юнит сейчас идёт. */
  path: Vector3[];
  /** Где юнит стоит, когда дошёл. */
  spot: Vector3;
  timer: number;
}

export interface TroopLayout {
  /** Строй нанятых юнитов (у казармы или у ратуши главной базы). */
  rally: Vector3;
  /** Крепость врага; у главной базы её нет, тогда юниты в работе стоят в дозоре. */
  fortress: Vector3 | null;
  /** Промежуточные точки от строя к крепости в обход шахты и ратуши. */
  route: Vector3[];
}

export class Troops {
  private troops = new Map<string, Troop>();
  private lib: ModelLibrary | null = null;
  private onMesh: (m: AbstractMesh) => void = () => {};

  constructor(
    private scene: Scene,
    private parent: TransformNode,
    private layout: TroopLayout,
    private baseId: string,
  ) {}

  setLibrary(lib: ModelLibrary, onMesh: (m: AbstractMesh) => void) {
    this.lib = lib;
    this.onMesh = onMesh;
    for (const t of this.troops.values()) this.dress(t);
  }

  /** Сверяет юнитов с задачами этой базы. */
  sync(tasks: Task[]) {
    const live = tasks.filter((t) => t.level && (t.status === 'hired' || t.status === 'active')).slice(0, MAX_TROOPS);
    const ids = new Set(live.map((t) => t.id));

    for (const tr of this.troops.values()) {
      if (ids.has(tr.taskId) || tr.state === 'charge' || tr.state === 'victory') continue;
      const task = tasks.find((t) => t.id === tr.taskId);
      if (task?.status !== 'done') this.remove(tr);
      else if (this.layout.fortress) this.charge(tr);
      else {
        tr.state = 'victory';
        tr.path = [];
        tr.timer = 2.5;
      }
    }

    // Места в строю раздаются по порядку, чтобы юниты не толпились в одной точке.
    let rallyIdx = 0;
    let fightIdx = 0;
    for (const task of live) {
      let tr = this.troops.get(task.id);
      if (!tr) tr = this.spawn(task);
      const want: State = task.status === 'active' ? 'fight' : 'rally';
      const spot = want === 'rally' ? this.rallySpot(rallyIdx++) : this.fightSpot(fightIdx++);
      const goingThere = tr.state === want || (want === 'fight' && tr.state === 'march');
      if (!goingThere) {
        tr.state = want === 'fight' ? 'march' : 'rally';
        tr.path = want === 'fight' ? [...this.layout.route, spot] : [...this.layout.route].reverse().concat(spot);
      } else if (!tr.spot.equals(spot)) {
        tr.path = [spot];
      }
      tr.spot = spot;
    }
  }

  private rallySpot(i: number): Vector3 {
    const r = this.layout.rally;
    return new Vector3(r.x + (i % 4) * 2.6, 0, r.z + Math.floor(i / 4) * 2.6);
  }

  private fightSpot(i: number): Vector3 {
    const f = this.layout.fortress;
    if (!f) return new Vector3(-6 + (i % 6) * 2.4, 0, 20 + Math.floor(i / 6) * 2.4);
    // Полукругом перед крепостью, со стороны своей базы.
    const a = ((i % 7) - 3) * 0.32;
    const r = 13 + Math.floor(i / 7) * 2.5;
    return new Vector3(f.x + Math.sin(a) * r, 0, f.z + Math.cos(a) * r);
  }

  private spawn(task: Task): Troop {
    const level = task.level!;
    const root = new TransformNode('troop-' + task.id, this.scene);
    root.parent = this.parent;
    const start = this.rallySpot(this.troops.size);
    root.position.copyFrom(start);
    const tr: Troop = { taskId: task.id, level, root, model: null, state: 'rally', path: [], spot: start, timer: 0 };
    this.dress(tr);
    this.troops.set(task.id, tr);
    return tr;
  }

  /** Модель WC3, если она загружена, иначе простая фигурка цвета игрока. */
  private dress(tr: Troop) {
    if (tr.model) return;
    const model = this.lib?.create(MODEL[tr.level]) ?? null;
    for (const c of tr.root.getChildren()) c.dispose();
    if (model) {
      model.root.parent = tr.root;
      model.root.getChildMeshes().forEach((m) => {
        m.metadata = { ...(m.metadata ?? {}), baseId: this.baseId, taskId: tr.taskId };
        this.onMesh(m);
      });
      tr.model = model;
    } else {
      const body = MeshBuilder.CreateCapsule('troopBody', { radius: 0.6, height: 1.6 + tr.level * 0.3 }, this.scene);
      body.material = P.mat(this.scene, '#2b52d9');
      body.parent = tr.root;
      body.position.y = 0.9;
      body.metadata = { baseId: this.baseId, taskId: tr.taskId };
    }
    if (tr.level === 4) tr.root.position.y = FLY;
  }

  private charge(tr: Troop) {
    const f = this.layout.fortress!;
    const from = tr.root.position;
    const d = new Vector3(from.x - f.x, 0, from.z - f.z).normalize().scale(10);
    tr.state = 'charge';
    tr.spot = f.add(d);
    tr.path = (from.z - f.z) ** 2 + (from.x - f.x) ** 2 > 400 ? [...this.layout.route, tr.spot] : [tr.spot];
    tr.timer = 2.4;
  }

  private remove(tr: Troop) {
    tr.model?.dispose();
    tr.root.dispose();
    this.troops.delete(tr.taskId);
  }

  /** Есть ли юниты, которые сейчас бьются у крепости. */
  inBattle(): boolean {
    for (const tr of this.troops.values()) if (!tr.path.length && (tr.state === 'fight' || tr.state === 'charge')) return true;
    return false;
  }

  update(dt: number) {
    for (const tr of [...this.troops.values()]) {
      const m = tr.model;
      if (tr.path.length) {
        if (this.walk(tr, tr.path[0], dt)) tr.path.shift();
        m?.play('Walk 1');
        continue;
      }
      switch (tr.state) {
        case 'rally':
          this.face(tr, tr.root.position.add(new Vector3(0, 0, 1)));
          m?.play('Stand 1');
          break;
        case 'march':
          tr.state = 'fight';
          break;
        case 'fight':
          if (this.layout.fortress) {
            this.face(tr, this.layout.fortress);
            m?.play('Attack 1');
          } else this.playAny(m, 'Stand Ready', 'Stand 1');
          break;
        case 'charge':
          this.face(tr, this.layout.fortress!);
          m?.play('Attack 1');
          tr.timer -= dt;
          if (tr.timer <= 0) {
            tr.state = 'victory';
            tr.timer = 2.5;
          }
          break;
        case 'victory':
          this.playAny(m, 'Stand Victory', 'Stand 1');
          tr.timer -= dt;
          // Юнит растворяется, как в WC3 тает погибший или ушедший с карты.
          tr.root.getChildMeshes().forEach((x) => (x.visibility = Math.min(1, tr.timer)));
          if (tr.timer <= 0) this.remove(tr);
          break;
      }
    }
  }

  /** Анимация по началу имени, а если у модели такой нет, запасная (у грифона нет победы). */
  private playAny(m: ModelInstance | null, prefix: string, fallback: string) {
    if (!m) return;
    if (m.animations.some((a) => a.startsWith(prefix))) m.playLike(prefix);
    else m.play(fallback);
  }

  private face(tr: Troop, target: Vector3) {
    const d = target.subtract(tr.root.position);
    if (d.x * d.x + d.z * d.z > 0.01) tr.root.rotation.y = Math.atan2(d.x, d.z);
  }

  private walk(tr: Troop, target: Vector3, dt: number): boolean {
    const pos = tr.root.position;
    const d = new Vector3(target.x - pos.x, 0, target.z - pos.z);
    const dist = d.length();
    if (dist < 0.3) return true;
    const step = Math.min(dist, SPEED[tr.level] * dt);
    pos.x += (d.x / dist) * step;
    pos.z += (d.z / dist) * step;
    turnTowards(tr.root, Math.atan2(d.x, d.z), dt);
    return false;
  }
}
