// Выделение, как в WC3: зелёный круг под каждым выбранным своим, красный под врагом, бледный
// круг под тем, что под курсором. Круги плоские и лежат на земле, у летунов тоже.

import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';

/** То, что можно обвести: юнит задачи, герой или база. */
export interface Target {
  key: string;
  node: TransformNode | null;
  /** Точка на земле, если у цели нет своего узла (база). */
  at?: Vector3;
  size: number;
  /** Враг: круг красный. */
  enemy?: boolean;
}

/** Враги у крепости, на которых можно щёлкнуть: врата демонов и их стража. */
export type Foe = 'gate' | 'hound1' | 'hound2' | 'felguard';

/** Юнит на сцене для выделения рамкой и кругов. */
export interface UnitNode {
  taskId: string;
  node: TransformNode;
  size: number;
  /** Демоны Легиона: рамкой их не выделить, как чужих юнитов в игре. */
  enemy?: boolean;
  /** Здоровье в бою у стен 0..1 (раны от стражи врат), у остальных его нет. */
  hp?: number;
}

export class SelectionFx {
  private rings: Mesh[] = [];
  private hover: Mesh;
  private mat: StandardMaterial;
  private hoverMat: StandardMaterial;
  private enemyMat: StandardMaterial;
  private enemyHoverMat: StandardMaterial;

  constructor(private scene: Scene) {
    this.mat = ringMaterial(scene, 'selRing', 1);
    this.hoverMat = ringMaterial(scene, 'hoverRing', 0.45);
    this.enemyMat = ringMaterial(scene, 'enemyRing', 1, '#ff2b2b');
    this.enemyHoverMat = ringMaterial(scene, 'enemyHoverRing', 0.45, '#ff2b2b');
    this.hover = this.ring(this.hoverMat);
  }

  /** Круг выделения из файлов игры, когда он загрузится. */
  useTexture(tex: Texture) {
    for (const m of [this.mat, this.hoverMat, this.enemyMat, this.enemyHoverMat]) m.diffuseTexture = tex;
  }

  draw(selected: Target[], hover: Target | null) {
    while (this.rings.length < selected.length) this.rings.push(this.ring(this.mat));
    this.rings.forEach((r, i) => {
      const t = selected[i];
      if (t) r.material = t.enemy ? this.enemyMat : this.mat;
      r.isVisible = !!t && this.place(r, t);
    });
    const dup = hover && selected.some((t) => t.key === hover.key);
    if (hover) this.hover.material = hover.enemy ? this.enemyHoverMat : this.hoverMat;
    this.hover.isVisible = !!hover && !dup && this.place(this.hover, hover);
  }

  private place(r: Mesh, t: Target): boolean {
    const p = t.node ? t.node.getAbsolutePosition() : t.at;
    if (!p || (t.node && !t.node.isEnabled())) return false;
    r.position.set(p.x, 0.14, p.z);
    r.scaling.set(t.size, 1, t.size);
    return true;
  }

  private ring(mat: StandardMaterial): Mesh {
    const r = MeshBuilder.CreateGround('selfx', { width: 1, height: 1 }, this.scene);
    r.material = mat;
    r.isPickable = false;
    r.isVisible = false;
    return r;
  }
}

/** Кольцо, нарисованное на холсте: пока не загружен круг из игры. */
function ringMaterial(scene: Scene, name: string, alpha: number, color = '#2bff2b'): StandardMaterial {
  const tex = new DynamicTexture(name + 'Tex', 128, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.stroke();
  tex.update();
  tex.hasAlpha = true;
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = tex;
  m.useAlphaFromDiffuseTexture = true;
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = Color3.FromHexString(color);
  m.alpha = alpha;
  m.backFaceCulling = false;
  return m;
}
