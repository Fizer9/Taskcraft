// Юнит разлетается на куски, как в WC3 от выстрела катапульты: вспышка, клочья мяса и доспехов
// летят в стороны, падают и гаснут, на земле остаётся лужа крови. Модели взрыва из игры
// (Objects/SpawnModels/Human/HumanLargeDeathExplode) в выгрузке пока нет, поэтому куски простые.

import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';

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

/**
 * Взрыв в точке at (в координатах parent). armor: цвета доспехов. Всё убирает за собой само.
 */
export function explode(scene: Scene, parent: TransformNode, at: Vector3, armor: string[] = ['#9aa3ad', '#2b52d9']) {
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

  const gibs: Gib[] = [];
  const colors = [...FLESH, ...FLESH, ...armor];
  for (let i = 0; i < 18; i++) {
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
    // Куски лежат пару секунд и тают, лужа держится дольше.
    const fade = Math.max(0, 1 - Math.max(0, t - 3) / 1.5);
    for (const g of gibs) (g.mesh.material as StandardMaterial).alpha = fade;
    poolMat.alpha = Math.max(0, 1 - Math.max(0, t - 5) / 3);
    if (t > 8) {
      scene.onBeforeRenderObservable.remove(observer);
      for (const m of root.getChildMeshes()) m.material?.dispose();
      root.dispose();
    }
  });
}
