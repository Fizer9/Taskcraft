// Заглушки вместо моделей WC3. Каждая функция возвращает узел с нужными пропорциями;
// когда появятся оригинальные модели, их загрузка заменит именно эти функции.

import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

export const TEAM_BLUE = new Color3(0.1, 0.35, 1);

const matCache = new Map<string, StandardMaterial>();

export function mat(scene: Scene, hex: string, emissive = 0): StandardMaterial {
  const key = hex + emissive;
  let m = matCache.get(key);
  if (!m) {
    m = new StandardMaterial('m' + key, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    if (emissive) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
    matCache.set(key, m);
  }
  return m;
}

function part(mesh: Mesh, parent: TransformNode, material: StandardMaterial, pos: Vector3): Mesh {
  mesh.material = material;
  mesh.parent = parent;
  mesh.position.copyFrom(pos);
  return mesh;
}

/** Ратуша людей: каменное основание, синяя крыша, знамя с цветом типа базы. */
export function townHall(scene: Scene, bannerHex: string, main = false): TransformNode {
  const root = new TransformNode('townHall', scene);
  const s = main ? 1.25 : 1;
  part(MeshBuilder.CreateBox('hallBase', { width: 9 * s, depth: 9 * s, height: 3.5 * s }, scene), root, mat(scene, '#9a8f7d'), new Vector3(0, 1.75 * s, 0));
  part(MeshBuilder.CreateBox('hallWall', { width: 7 * s, depth: 7 * s, height: 3 * s }, scene), root, mat(scene, '#c9b48a'), new Vector3(0, 5 * s, 0));
  const roof = part(MeshBuilder.CreateCylinder('hallRoof', { diameterTop: 0, diameterBottom: 11 * s, height: 5 * s, tessellation: 4 }, scene), root, mat(scene, '#2f4f9e'), new Vector3(0, 9 * s, 0));
  roof.rotation.y = Math.PI / 4;
  const tower = part(MeshBuilder.CreateCylinder('hallTower', { diameter: 2.4 * s, height: 6 * s, tessellation: 8 }, scene), root, mat(scene, '#c9b48a'), new Vector3(3 * s, 6 * s, -3 * s));
  part(MeshBuilder.CreateCylinder('towerRoof', { diameterTop: 0, diameterBottom: 3.2 * s, height: 3 * s, tessellation: 8 }, scene), tower, mat(scene, '#2f4f9e'), new Vector3(0, 4.5 * s, 0));
  part(MeshBuilder.CreateCylinder('pole', { diameter: 0.25, height: 6 }, scene), root, mat(scene, '#5a4630'), new Vector3(0, 13.5 * s, 0));
  const flag = part(MeshBuilder.CreateBox('banner', { width: 2.6, height: 1.6, depth: 0.1 }, scene), root, mat(scene, bannerHex, 0.25), new Vector3(1.3, 15.5 * s, 0));
  flag.metadata = { banner: true };
  part(MeshBuilder.CreateBox('door', { width: 2.2, height: 2.6, depth: 0.3 }, scene), root, mat(scene, '#4a3320'), new Vector3(0, 1.3, 4.55 * s));
  return root;
}

export function goldMine(scene: Scene): TransformNode {
  const root = new TransformNode('goldMine', scene);
  const rock = part(MeshBuilder.CreateIcoSphere('mineRock', { radius: 5, subdivisions: 2 }, scene), root, mat(scene, '#6d6255'), new Vector3(0, 1.8, 0));
  rock.scaling.y = 0.6;
  part(MeshBuilder.CreateBox('mineEntrance', { width: 3, height: 2.6, depth: 2 }, scene), root, mat(scene, '#2a2018'), new Vector3(0, 1.3, 4));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = part(MeshBuilder.CreateBox('gold' + i, { size: 0.9 }, scene), root, mat(scene, '#f2c230', 0.35), new Vector3(Math.cos(a) * 3.6, 3.2 + (i % 2) * 0.6, Math.sin(a) * 3.6));
    c.rotation.set(a, a * 2, 0.5);
  }
  return root;
}

/** Сосна Лордерона: ствол и два конуса хвои. */
export function tree(scene: Scene, scale = 1): TransformNode {
  const root = new TransformNode('tree', scene);
  part(MeshBuilder.CreateCylinder('trunk', { diameter: 0.7, height: 2.5 }, scene), root, mat(scene, '#5a3d22'), new Vector3(0, 1.25, 0));
  part(MeshBuilder.CreateCylinder('leaves1', { diameterTop: 0, diameterBottom: 4.4, height: 4.5, tessellation: 7 }, scene), root, mat(scene, '#22502a'), new Vector3(0, 4, 0));
  part(MeshBuilder.CreateCylinder('leaves2', { diameterTop: 0, diameterBottom: 3.2, height: 3.5, tessellation: 7 }, scene), root, mat(scene, '#2d6534'), new Vector3(0, 6.2, 0));
  root.scaling.setAll(scale);
  return root;
}

export function farm(scene: Scene): TransformNode {
  const root = new TransformNode('farm', scene);
  part(MeshBuilder.CreateBox('farmBase', { width: 4, depth: 4, height: 2.2 }, scene), root, mat(scene, '#c9b48a'), new Vector3(0, 1.1, 0));
  const roof = part(MeshBuilder.CreateCylinder('farmRoof', { diameterTop: 0, diameterBottom: 5.6, height: 2.4, tessellation: 4 }, scene), root, mat(scene, '#8f3b25'), new Vector3(0, 3.4, 0));
  roof.rotation.y = Math.PI / 4;
  return root;
}

export function barracks(scene: Scene): TransformNode {
  const root = new TransformNode('barracks', scene);
  part(MeshBuilder.CreateBox('barBase', { width: 7, depth: 5, height: 3.2 }, scene), root, mat(scene, '#9a8f7d'), new Vector3(0, 1.6, 0));
  const roof = part(MeshBuilder.CreateCylinder('barRoof', { diameter: 5.4, height: 7.4, tessellation: 3 }, scene), root, mat(scene, '#2f4f9e'), new Vector3(0, 3.9, 0));
  roof.rotation.z = Math.PI / 2;
  roof.scaling.y = 1;
  roof.scaling.x = 0.6;
  return root;
}

export function altar(scene: Scene): TransformNode {
  const root = new TransformNode('altar', scene);
  part(MeshBuilder.CreateCylinder('altarBase', { diameter: 5, height: 1, tessellation: 8 }, scene), root, mat(scene, '#d8d2c4'), new Vector3(0, 0.5, 0));
  part(MeshBuilder.CreateCylinder('altarStone', { diameter: 2, height: 2.2, tessellation: 8 }, scene), root, mat(scene, '#d8d2c4'), new Vector3(0, 2, 0));
  part(MeshBuilder.CreateSphere('altarLight', { diameter: 1.4 }, scene), root, mat(scene, '#ffe9a0', 0.8), new Vector3(0, 3.8, 0));
  return root;
}

/** Вражеская крепость проекта: тёмная башня с шипами. */
export function fortress(scene: Scene): TransformNode {
  const root = new TransformNode('fortress', scene);
  part(MeshBuilder.CreateCylinder('fortBase', { diameterTop: 5, diameterBottom: 8, height: 4, tessellation: 6 }, scene), root, mat(scene, '#3a2a2a'), new Vector3(0, 2, 0));
  part(MeshBuilder.CreateCylinder('fortTower', { diameterTop: 2, diameterBottom: 4, height: 8, tessellation: 6 }, scene), root, mat(scene, '#4b2020'), new Vector3(0, 8, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = part(MeshBuilder.CreateCylinder('spike' + i, { diameterTop: 0, diameterBottom: 0.8, height: 3 }, scene), root, mat(scene, '#1c1414'), new Vector3(Math.cos(a) * 3.2, 4.5, Math.sin(a) * 3.2));
    spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  part(MeshBuilder.CreateSphere('fortEye', { diameter: 1.4 }, scene), root, mat(scene, '#ff3b1f', 0.9), new Vector3(0, 12.6, 0));
  return root;
}

/** Крестьянин: тельце с цветом команды и мешок, который виден, когда он несёт золото. */
export function peasant(scene: Scene): { root: TransformNode; load: Mesh } {
  const root = new TransformNode('peasant', scene);
  part(MeshBuilder.CreateCapsule('pBody', { radius: 0.45, height: 1.6 }, scene), root, mat(scene, '#8a6a45'), new Vector3(0, 0.8, 0));
  part(MeshBuilder.CreateSphere('pHead', { diameter: 0.6 }, scene), root, mat(scene, '#e0b48c'), new Vector3(0, 1.85, 0));
  part(MeshBuilder.CreateBox('pTeam', { width: 0.95, height: 0.3, depth: 0.95 }, scene), root, mat(scene, '#1a59ff', 0.3), new Vector3(0, 1.1, 0));
  const load = part(MeshBuilder.CreateSphere('pLoad', { diameter: 0.6 }, scene), root, mat(scene, '#f2c230', 0.4), new Vector3(0, 1.3, -0.5));
  load.isVisible = false;
  return { root, load };
}

/** Горный король: крупнее, с золотым кольцом героя под ногами. */
export function hero(scene: Scene): TransformNode {
  const root = new TransformNode('hero', scene);
  part(MeshBuilder.CreateCapsule('hBody', { radius: 0.9, height: 2.8 }, scene), root, mat(scene, '#7d7f86'), new Vector3(0, 1.4, 0));
  part(MeshBuilder.CreateSphere('hHead', { diameter: 1 }, scene), root, mat(scene, '#d9a37a'), new Vector3(0, 3.1, 0));
  part(MeshBuilder.CreateCylinder('hBeard', { diameterTop: 0.9, diameterBottom: 0.2, height: 1.1 }, scene), root, mat(scene, '#b5562a'), new Vector3(0, 2.4, 0.45));
  part(MeshBuilder.CreateTorus('hRing', { diameter: 3, thickness: 0.15, tessellation: 32 }, scene), root, mat(scene, '#ffd84a', 0.9), new Vector3(0, 0.08, 0));
  return root;
}
