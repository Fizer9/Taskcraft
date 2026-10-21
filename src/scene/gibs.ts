// Юнит разлетается на куски, как в WC3 от выстрела катапульты: вспышка, и в стороны летят
// руки, ноги, рёбра и требуха из модели игры Objects/SpawnModels/Human/HumanLargeDeathExplode.
// Куски падают, лежат и уходят в землю, на земле остаётся лужа крови. Пока модель не
// загружена, вместо неё летят простые клочья мяса и доспехов.

import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { bloodSplash } from './fx';
import type { ModelLibrary } from './library';

interface Gib {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  rest: boolean;
}

const mats = new WeakMap<Scene, Record<string, StandardMaterial>>();

function mat(scene: Scene, color: string, glow = 0): StandardMaterial {
  let set = mats.get(scene);
  if (!set) mats.set(scene, (set = {}));
  const key = color + glow;
  if (!set[key]) {
    const m = new StandardMaterial('gib' + key, scene);
    m.diffuseColor = Color3.FromHexString(color);
    m.emissiveColor = Color3.FromHexString(color).scale(glow);
    m.specularColor = Color3.Black();
    set[key] = m;
  }
  return set[key].clone('gibInst');
}

/** Куски: мясо, кровь и цвет доспехов юнита (сталь и синий цвет игрока). */
const FLESH = ['#8a1010', '#6a0c0c', '#b02020', '#5a2a1a'];

/** Секунда Birth, к которой куски тела долетают до земли. */
const LANDED = 0.8;

/**
 * Взрыв в точке at (в координатах parent). armor: цвета доспехов для простых клочьев,
 * если модели взрыва нет. Всё убирает за собой само.
 */
export function explode(scene: Scene, parent: TransformNode, at: Vector3, lib: ModelLibrary | null, armor: string[] = ['#9aa3ad', '#2b52d9']) {
  const root = new TransformNode('gibs', scene);
  root.parent = parent;
  root.position.copyFrom(at);
  const ground = -at.y + 0.15;

  // Вспышка: оранжевый шар быстро раздувается и тает.
  const flash = MeshBuilder.CreateSphere('gibFlash', { diameter: 1, segments: 8 }, scene);
  const flashMat = mat(scene, '#ffb040', 1);
  flashMat.disableLighting = true;
  flash.material = flashMat;
  flash.parent = root;
  flash.position.y = 1.2;
  flash.isPickable = false;

  // Лужа крови на земле.
  const pool = MeshBuilder.CreateDisc('gibPool', { radius: 1.6, tessellation: 18 }, scene);
  const poolMat = mat(scene, '#4a0606');
  pool.material = poolMat;
  pool.parent = root;
  pool.rotation.x = Math.PI / 2;
  pool.position.y = ground - 0.1;
  pool.scaling.setAll(0.2);
  pool.isPickable = false;

  // Куски тела из игры. В WC3 их ловит земля, а в модели они падают дальше, до конца
  // двухсекундной Birth, поэтому анимация замирает, когда куски долетают до земли: дальше
  // они лежат и уходят в землю.
  const body = lib?.create('humanlargedeathexplode', 1.4) ?? null;
  if (body) {
    body.root.parent = root;
    body.root.position.y = -at.y;
    body.root.rotation.y = Math.random() * Math.PI * 2;
    body.root.getChildMeshes().forEach((m) => (m.isPickable = false));
    body.play('Birth', false);
    bloodSplash(scene, Vector3.TransformCoordinates(new Vector3(0, 1.2, 0), root.computeWorldMatrix(true)));
  }

  const gibs: Gib[] = [];
  const colors = [...FLESH, ...FLESH, ...armor];
  for (let i = 0; i < (body ? 0 : 18); i++) {
    const size = 0.25 + Math.random() * 0.45;
    const mesh =
      i % 3 === 0
        ? MeshBuilder.CreateBox('gib', { width: size, height: size * 0.6, depth: size * 1.3 }, scene)
        : MeshBuilder.CreateIcoSphere('gib', { radius: size * 0.55, subdivisions: 1 }, scene);
    mesh.material = mat(scene, colors[i % colors.length]);
    mesh.parent = root;
    mesh.position.set((Math.random() - 0.5) * 0.8, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8);
    mesh.isPickable = false;
    const a = Math.random() * Math.PI * 2;
    const out = 4 + Math.random() * 7;
    gibs.push({
      mesh,
      vel: new Vector3(Math.cos(a) * out, 7 + Math.random() * 9, Math.sin(a) * out),
      spin: new Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7),
      rest: false,
    });
  }

  let t = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
    t += dt;
    flash.scaling.setAll(1 + t * 14);
    flashMat.alpha = Math.max(0, 1 - t * 4);
    flash.isVisible = flashMat.alpha > 0;
    pool.scaling.setAll(Math.min(1, 0.2 + t * 2.5));
    for (const g of gibs) {
      if (g.rest) continue;
      g.vel.y -= 30 * dt;
      g.mesh.position.addInPlace(g.vel.scale(dt));
      g.mesh.rotation.addInPlace(g.spin.scale(dt));
      if (g.mesh.position.y <= ground) {
        g.mesh.position.y = ground;
        // Отскок с потерей скорости, потом кусок лежит.
        if (Math.abs(g.vel.y) < 3) g.rest = true;
        g.vel.set(g.vel.x * 0.4, -g.vel.y * 0.3, g.vel.z * 0.4);
        g.spin.scaleInPlace(0.4);
      }
    }
    // Куски лежат пару секунд и тают (части тела уходят в землю, как трупы в WC3), лужа держится дольше.
    const fade = Math.max(0, 1 - Math.max(0, t - 3) / 1.5);
    for (const g of gibs) (g.mesh.material as StandardMaterial).alpha = fade;
    if (body) body.root.position.y = -at.y - Math.max(0, t - 5) * 0.5;
    if (body && t >= LANDED) body.setSpeed(0);
    poolMat.alpha = Math.max(0, 1 - Math.max(0, t - 5) / 3);
    if (t > 8) {
      scene.onBeforeRenderObservable.remove(observer);
      body?.dispose();
      for (const m of root.getChildMeshes()) m.material?.dispose();
      root.dispose();
    }
  });
}
