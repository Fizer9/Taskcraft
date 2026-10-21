// Мелкие эффекты боя, как в WC3: брызги крови от ударов, искры от врат, снаряды стрелков
// и грифонов, Молот бури и волна Удара грома. Частицы эффектов HD-версии игры записаны в
// формате PopcornFX (.pkb), которого браузер не читает, поэтому брызги и искры рисуются
// своими частицами, а молоты летят настоящими моделями WC3, если они загружены.

import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Texture,
} from '@babylonjs/core';
import type { ModelLibrary, ModelName } from './library';

const dots = new WeakMap<Scene, Texture>();

/** Круглая мягкая точка для частиц, одна на сцену. */
function dot(scene: Scene): Texture {
  let t = dots.get(scene) as DynamicTexture | undefined;
  if (!t) {
    t = new DynamicTexture('fxDot', { width: 64, height: 64 }, scene, false);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    t.hasAlpha = true;
    t.update();
    dots.set(scene, t);
  }
  return t;
}

interface Burst {
  count: number;
  color1: string;
  color2: string;
  size: [number, number];
  speed: [number, number];
  life: [number, number];
  gravity: number;
  /** Сложение цветов: искры и вспышки светятся, кровь нет. */
  glow: boolean;
  /** Разлёт: 1 во все стороны, меньше — конусом вверх. */
  spread: number;
}

/** Один выброс частиц в точке мира; система сама себя убирает. */
function burst(scene: Scene, at: Vector3, b: Burst) {
  const ps = new ParticleSystem('fxBurst', b.count, scene);
  ps.particleTexture = dot(scene);
  ps.emitter = at.clone();
  ps.minEmitBox = ps.maxEmitBox = Vector3.Zero();
  ps.direction1 = new Vector3(-b.spread, 1, -b.spread);
  ps.direction2 = new Vector3(b.spread, 1 - b.spread * 0.6, b.spread);
  ps.color1 = Color4.FromHexString(b.color1 + 'ff');
  ps.color2 = Color4.FromHexString(b.color2 + 'ff');
  ps.colorDead = new Color4(ps.color2.r * 0.4, ps.color2.g * 0.4, ps.color2.b * 0.4, 0);
  [ps.minSize, ps.maxSize] = b.size;
  [ps.minEmitPower, ps.maxEmitPower] = b.speed;
  [ps.minLifeTime, ps.maxLifeTime] = b.life;
  ps.gravity = new Vector3(0, -b.gravity, 0);
  ps.blendMode = b.glow ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
  ps.manualEmitCount = b.count;
  ps.targetStopDuration = b.life[1] + 0.1;
  ps.disposeOnStop = true;
  ps.start();
}

/** Брызги крови: удар по юниту. */
export function bloodSplash(scene: Scene, at: Vector3) {
  burst(scene, at, { count: 30, color1: '#c41a1a', color2: '#6a0808', size: [0.3, 0.75], speed: [3, 7], life: [0.4, 0.8], gravity: 22, glow: false, spread: 0.9 });
}

/** Искры: меч, пуля или молот бьют по камню врат. */
export function sparks(scene: Scene, at: Vector3, big = false) {
  burst(scene, at, {
    count: big ? 40 : 18,
    color1: '#ffe9a0',
    color2: '#ff9a20',
    size: big ? [0.25, 0.6] : [0.12, 0.3],
    speed: big ? [6, 12] : [4, 9],
    life: [0.2, 0.5],
    gravity: 18,
    glow: true,
    spread: 1,
  });
}

/** Синие молнии вокруг цели Молота бури. */
export function stormFlash(scene: Scene, at: Vector3) {
  burst(scene, at, { count: 50, color1: '#c8e4ff', color2: '#3a7cff', size: [0.4, 1.1], speed: [5, 11], life: [0.3, 0.7], gravity: 0, glow: true, spread: 1 });
}

/**
 * Удар грома: по земле от героя расходится светлое кольцо, поднимается пыль.
 * at: точка мира, radius: докуда доходит волна.
 */
export function shockwave(scene: Scene, at: Vector3, radius = 14) {
  const ring = MeshBuilder.CreateTorus('clapRing', { diameter: 2, thickness: 0.35, tessellation: 48 }, scene);
  const mat = new StandardMaterial('clapRingMat', scene);
  mat.emissiveColor = Color3.FromHexString('#d8ecff');
  mat.diffuseColor = Color3.Black();
  mat.disableLighting = true;
  ring.material = mat;
  ring.position.copyFrom(at);
  ring.position.y += 0.3;
  ring.isPickable = false;
  burst(scene, at.add(new Vector3(0, 0.5, 0)), { count: 60, color1: '#b9a27e', color2: '#6a5a44', size: [0.8, 2], speed: [6, 14], life: [0.5, 1.1], gravity: 2, glow: false, spread: 1 });
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = Math.min(1, t / 0.6);
    const d = 1 + (radius - 1) * (1 - (1 - k) ** 2);
    ring.scaling.set(d, 1 + k * 2, d);
    mat.alpha = 1 - k;
    if (k >= 1) {
      scene.onBeforeRenderObservable.remove(obs);
      ring.dispose();
      mat.dispose();
    }
  });
}

export interface Shot {
  /** Модель снаряда; без неё (или пока не загружена) летит светлый трассер. */
  model?: ModelName;
  scale?: number;
  /** Скорость в единицах мира в секунду. */
  speed: number;
  /** Высота дуги в долях пути: молот грифона летит навесом, пуля по прямой. */
  arc?: number;
  /** Вращается в полёте (молоты). */
  spin?: boolean;
}

/**
 * Снаряд из from в to (координаты мира). Когда долетит, вызывается hit. Возвращает
 * функцию, которая убирает снаряд досрочно (база снесена).
 */
export function launch(scene: Scene, lib: ModelLibrary | null, from: Vector3, to: Vector3, shot: Shot, hit: () => void): () => void {
  const root = new TransformNode('shot', scene);
  root.position.copyFrom(from);
  const model = shot.model ? (lib?.create(shot.model, shot.scale ?? 1) ?? null) : null;
  let tracer: Mesh | null = null;
  if (model) {
    model.root.parent = root;
    model.root.getChildMeshes().forEach((m) => (m.isPickable = false));
    model.playLike('Stand');
  } else {
    tracer = MeshBuilder.CreateBox('tracer', { width: 0.08, height: 0.08, depth: 1.6 }, scene);
    const mat = new StandardMaterial('tracerMat', scene);
    mat.emissiveColor = Color3.FromHexString('#fff2b0');
    mat.disableLighting = true;
    tracer.material = mat;
    tracer.parent = root;
    tracer.isPickable = false;
  }
  const length = Vector3.Distance(from, to);
  const time = Math.max(0.05, length / shot.speed);
  const arc = (shot.arc ?? 0) * length;
  let t = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    scene.onBeforeRenderObservable.remove(obs);
    model?.dispose();
    tracer?.material?.dispose();
    root.dispose();
  };
  const prev = from.clone();
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = Math.min(1, t / time);
    prev.copyFrom(root.position);
    Vector3.LerpToRef(from, to, k, root.position);
    root.position.y += arc * 4 * k * (1 - k);
    // Носом по ходу полёта.
    const d = root.position.subtract(prev);
    if (d.lengthSquared() > 1e-6) {
      root.rotation.y = Math.atan2(d.x, d.z);
      root.rotation.x = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    if (shot.spin && model) model.root.rotation.x += 0.4;
    if (k >= 1) {
      finish();
      hit();
    }
  });
  return finish;
}
