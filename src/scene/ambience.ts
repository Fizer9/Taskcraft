// Окружение карты из текстур WC3 (assets-src/fx): тени-пятна под юнитами, свечение героя
// и луч нового уровня, дождь, озеро с водой и тёмная граница по краю карты.
// Без текстур (до пароля) всё это просто не появляется.

import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
  type InstancedMesh,
} from '@babylonjs/core';
import { loadArt } from '../assets/loader';

const textures = new Map<string, Promise<Texture | null>>();

/** Текстура эффекта fx/<name>.png, одна на сцену. */
export function fxTexture(scene: Scene, name: string): Promise<Texture | null> {
  let t = textures.get(name);
  if (!t) {
    t = loadArt(`fx/${name}.png`).then((bytes) => {
      if (!bytes) return null;
      const tex = new Texture(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.hasAlpha = true;
      return tex;
    });
    textures.set(name, t);
  }
  return t;
}

/** Что отбрасывает тень-пятно: узел и радиус пятна. */
export interface Caster {
  node: TransformNode;
  size: number;
}

/**
 * Тени WC3: мягкое тёмное пятно под каждым юнитом, как в игре. Они дешёвые (копии одного
 * квадрата), поэтому видны и на телефоне, где карта теней грубая.
 */
export class Blobs {
  private base: Mesh | null = null;
  private pool: InstancedMesh[] = [];

  constructor(scene: Scene) {
    void fxTexture(scene, 'shadow').then((tex) => {
      if (!tex) return;
      const m = new StandardMaterial('blobMat', scene);
      m.diffuseTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.disableLighting = true;
      m.alpha = 0.55;
      m.zOffset = -2;
      const plane = MeshBuilder.CreateGround('blob', { width: 1, height: 1 }, scene);
      plane.material = m;
      plane.isPickable = false;
      plane.position.y = -1000;
      plane.alwaysSelectAsActiveMesh = true;
      this.base = plane;
    });
  }

  draw(casters: Caster[]) {
    const base = this.base;
    if (!base) return;
    while (this.pool.length < casters.length) {
      const c = base.createInstance('blob' + this.pool.length);
      c.isPickable = false;
      this.pool.push(c);
    }
    this.pool.forEach((b, i) => {
      const c = casters[i];
      if (!c || !c.node.isEnabled()) return void b.setEnabled(false);
      b.setEnabled(true);
      const p = c.node.getAbsolutePosition();
      b.position.set(p.x, 0.07, p.z);
      // Летающий грифон отбрасывает тень меньше и бледнее.
      const k = Math.max(0.5, 1 - p.y / 12);
      b.scaling.set(c.size * k, 1, c.size * k);
    });
  }
}

/**
 * Свечение под героем цветом команды, как у героев в WC3, и столб света при новом уровне.
 */
export class HeroGlow {
  private glow: Mesh | null = null;
  private shaft: Mesh | null = null;
  private shaftAge = -1;

  constructor(
    scene: Scene,
    private hero: TransformNode,
  ) {
    void fxTexture(scene, 'teamglow').then((tex) => {
      if (!tex) return;
      const m = new StandardMaterial('heroGlowMat', scene);
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.diffuseColor = Color3.Black();
      m.disableLighting = true;
      m.alphaMode = 1; // сложение: тёмные края текстуры пропадают
      m.emissiveColor = Color3.FromHexString('#ffd34d');
      const g = MeshBuilder.CreateGround('heroGlow', { width: 6, height: 6 }, scene);
      g.material = m;
      g.isPickable = false;
      g.position.y = 0.09;
      this.glow = g;
    });
    void fxTexture(scene, 'holyshaft').then((tex) => {
      if (!tex) return;
      const m = new StandardMaterial('levelShaftMat', scene);
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.diffuseColor = Color3.Black();
      m.disableLighting = true;
      m.alphaMode = 1;
      m.backFaceCulling = false;
      m.emissiveColor = Color3.FromHexString('#ffe9a8');
      const c = MeshBuilder.CreateCylinder('levelShaft', { diameter: 5, height: 18, tessellation: 24, cap: Mesh.NO_CAP }, scene);
      c.material = m;
      c.isPickable = false;
      c.setEnabled(false);
      this.shaft = c;
    });
  }

  /** Цвет свечения: золотой у Горного короля, у остальных цвет их класса. */
  setColor(hex: string) {
    const m = this.glow?.material as StandardMaterial | undefined;
    if (m) m.emissiveColor = Color3.FromHexString(hex);
  }

  /** Столб света над героем на пару секунд. */
  levelUp() {
    this.shaftAge = 0;
  }

  update(dt: number, visible: boolean) {
    const p = this.hero.getAbsolutePosition();
    if (this.glow) {
      this.glow.setEnabled(visible);
      this.glow.position.x = p.x;
      this.glow.position.z = p.z;
      const pulse = 1 + Math.sin(performance.now() / 500) * 0.06;
      this.glow.scaling.set(pulse * this.hero.scaling.x, 1, pulse * this.hero.scaling.x);
    }
    if (this.shaft && this.shaftAge >= 0) {
      this.shaftAge += dt;
      const life = 2.2;
      const k = this.shaftAge / life;
      this.shaft.setEnabled(k < 1);
      this.shaft.position.set(p.x, 9, p.z);
      this.shaft.visibility = Math.sin(Math.min(1, k) * Math.PI);
      this.shaft.scaling.set(1 + k * 0.4, 1, 1 + k * 0.4);
      ((this.shaft.material as StandardMaterial).emissiveTexture as Texture).vOffset = -this.shaftAge * 0.6;
      if (k >= 1) this.shaftAge = -1;
    }
  }
}

/** Дождь: капли WC3 летят наискосок вокруг камеры. */
export class Rain {
  private ps: ParticleSystem | null = null;
  private anchor: Mesh;
  private on = false;

  constructor(scene: Scene) {
    this.anchor = MeshBuilder.CreateBox('rainAnchor', { size: 0.01 }, scene);
    this.anchor.isVisible = false;
    this.anchor.isPickable = false;
    void fxTexture(scene, 'raintail').then((tex) => {
      if (!tex) return;
      const ps = new ParticleSystem('rain', 1500, scene);
      ps.particleTexture = tex;
      ps.emitter = this.anchor;
      // Капли рождаются ниже камеры (она на высоте ~34), иначе у самого объектива они
      // растягиваются в длинные полосы через весь экран.
      ps.minEmitBox = new Vector3(-45, 16, -35);
      ps.maxEmitBox = new Vector3(45, 20, 35);
      ps.direction1 = new Vector3(-3, -40, -2);
      ps.direction2 = new Vector3(-2, -46, -1);
      ps.minEmitPower = 1;
      ps.maxEmitPower = 1;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.45;
      ps.minSize = 0.5;
      ps.maxSize = 0.8;
      ps.minScaleX = 0.25;
      ps.maxScaleX = 0.3;
      ps.minScaleY = 2.2;
      ps.maxScaleY = 2.6;
      ps.color1 = new Color4(0.75, 0.85, 1, 0.7);
      ps.color2 = new Color4(0.6, 0.75, 0.95, 0.55);
      ps.colorDead = new Color4(0.6, 0.75, 0.95, 0);
      ps.emitRate = 1400;
      ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      this.ps = ps;
      if (this.on) ps.start();
    });
  }

  get raining(): boolean {
    return this.on;
  }

  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) this.ps?.start();
    else this.ps?.stop();
  }

  follow(target: Vector3) {
    this.anchor.position.set(target.x, 0, target.z);
  }
}

/** Озеро: неровный край, вода WC3 с бегущей рябью и камыш по берегу. */
export class Lake {
  readonly root: TransformNode;
  private water: Mesh;
  private bump: Texture | null = null;

  constructor(
    scene: Scene,
    readonly x: number,
    readonly z: number,
    readonly r: number,
  ) {
    this.root = new TransformNode('lake', scene);
    this.root.position.set(x, 0, z);
    this.water = lakeMesh(scene, r);
    this.water.parent = this.root;
    this.water.position.y = 0.12;
    this.water.isPickable = false;
    const m = new StandardMaterial('waterMat', scene);
    m.diffuseColor = Color3.FromHexString('#1d4a63');
    m.emissiveColor = Color3.FromHexString('#0a2230');
    m.specularColor = Color3.FromHexString('#9fc6d8');
    m.specularPower = 48;
    m.alpha = 0.82;
    m.backFaceCulling = false;
    this.water.material = m;
    void fxTexture(scene, 'water-normal').then((tex) => {
      if (!tex) return;
      const t = tex.clone();
      t.uScale = t.vScale = r / 3;
      m.bumpTexture = t;
      this.bump = t;
    });
  }

  update(dt: number) {
    if (this.bump) {
      this.bump.uOffset += dt * 0.02;
      this.bump.vOffset += dt * 0.013;
    }
  }

  /** Места камыша по берегу (в мире). */
  shore(n: number): Vector3[] {
    const out: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.sin(i * 7.3) * 0.2;
      const rr = this.r * (0.92 + 0.08 * Math.sin(a * 3 + 1));
      out.push(new Vector3(this.x + Math.cos(a) * rr, 0, this.z + Math.sin(a) * rr));
    }
    return out;
  }

  dispose() {
    this.root.dispose(false, true);
  }
}

/** Диск с волнистым краем (тот же край, что у shore). */
function lakeMesh(scene: Scene, r: number): Mesh {
  const seg = 48;
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const rr = r * (1 + 0.1 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 7));
    positions.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    if (i > 0) indices.push(0, i + 1, i);
  }
  const mesh = new Mesh('water', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * Край карты, как в WC3: за границей игрового поля чернота, а у самого края земля
 * темнеет полосой, чтобы карта не обрывалась резко.
 */
export function mapEdge(scene: Scene, half: number) {
  const band = 14;
  const tex = new DynamicTexture('edgeTex', { width: 4, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  tex.hasAlpha = true;
  tex.update();
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const fade = new StandardMaterial('edgeFade', scene);
  fade.diffuseTexture = tex;
  fade.useAlphaFromDiffuseTexture = true;
  fade.diffuseColor = Color3.Black();
  fade.specularColor = Color3.Black();
  fade.disableLighting = true;
  const black = new StandardMaterial('edgeBlack', scene);
  black.diffuseColor = Color3.Black();
  black.specularColor = Color3.Black();
  black.disableLighting = true;
  const far = 400;
  for (let i = 0; i < 4; i++) {
    const side = new TransformNode('edge' + i, scene);
    side.rotation.y = (i * Math.PI) / 2;
    const strip = MeshBuilder.CreateGround('edgeStrip' + i, { width: half * 2, height: band }, scene);
    strip.material = fade;
    strip.parent = side;
    strip.position.set(0, 0.2, half - band / 2);
    strip.isPickable = false;
    const out = MeshBuilder.CreateGround('edgeOut' + i, { width: half * 2 + far * 2, height: far }, scene);
    out.material = black;
    out.parent = side;
    out.position.set(0, 0.19, half + far / 2);
    out.isPickable = false;
  }
}

/**
 * Зелёные стрелки приказа, как в WC3 после правого клика: четыре уголка сходятся к точке
 * и гаснут. Рисуются сами, без текстур, поэтому работают и до пароля.
 */
export class Confirm {
  private root: TransformNode;
  private arrows: Mesh[] = [];
  private mat: StandardMaterial;
  private age = -1;
  private static readonly LIFE = 0.6;

  constructor(scene: Scene) {
    const tex = new DynamicTexture('confirmTex', { width: 64, height: 64 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = '#3cff3c';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(12, 14);
    ctx.lineTo(32, 46);
    ctx.lineTo(52, 14);
    ctx.stroke();
    tex.hasAlpha = true;
    tex.update();
    this.mat = new StandardMaterial('confirmMat', scene);
    this.mat.diffuseTexture = tex;
    this.mat.useAlphaFromDiffuseTexture = true;
    this.mat.emissiveColor = new Color3(0.25, 1, 0.25);
    this.mat.disableLighting = true;
    this.mat.backFaceCulling = false;
    this.root = new TransformNode('confirm', scene);
    for (let i = 0; i < 4; i++) {
      const pivot = new TransformNode('confirmPivot' + i, scene);
      pivot.parent = this.root;
      pivot.rotation.y = (i * Math.PI) / 2;
      const a = MeshBuilder.CreateGround('confirmArrow' + i, { width: 1.4, height: 1.4 }, scene);
      a.material = this.mat;
      a.parent = pivot;
      a.isPickable = false;
      this.arrows.push(a);
    }
    this.root.setEnabled(false);
  }

  show(pos: Vector3) {
    this.root.position.set(pos.x, 0.25, pos.z);
    this.age = 0;
    this.root.setEnabled(true);
    this.update(0);
  }

  update(dt: number) {
    if (this.age < 0) return;
    this.age += dt;
    const t = this.age / Confirm.LIFE;
    if (t >= 1) {
      this.age = -1;
      this.root.setEnabled(false);
      return;
    }
    // Уголок смотрит остриём к центру: стоит на оси +z и съезжает внутрь.
    const d = 2.6 * (1 - t) + 0.7;
    for (const a of this.arrows) a.position.set(0, 0, d);
    this.mat.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  }
}

/**
 * Маркер цели, как пинг на мини-карте в WC3: золотое кольцо на земле расходится волнами,
 * над ним качается стрелка. Ставится при входе в игру и по щелчку в панели целей.
 */
export class GoalMarker {
  private root: TransformNode;
  private rings: Mesh[] = [];
  private arrow: Mesh;
  private ringMat: StandardMaterial;
  private arrowMat: StandardMaterial;
  private age = -1;
  private static readonly LIFE = 8;

  constructor(scene: Scene) {
    const tex = new DynamicTexture('goalRingTex', { width: 128, height: 128 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.stroke();
    tex.hasAlpha = true;
    tex.update();
    this.ringMat = new StandardMaterial('goalRingMat', scene);
    this.ringMat.diffuseTexture = tex;
    this.ringMat.useAlphaFromDiffuseTexture = true;
    this.ringMat.emissiveColor = new Color3(1, 0.83, 0.3);
    this.ringMat.disableLighting = true;
    this.ringMat.backFaceCulling = false;
    this.root = new TransformNode('goal', scene);
    for (let i = 0; i < 3; i++) {
      const r = MeshBuilder.CreateGround('goalRing' + i, { width: 1, height: 1 }, scene);
      r.material = this.ringMat;
      r.parent = this.root;
      r.isPickable = false;
      r.position.y = 0.3 + i * 0.01;
      this.rings.push(r);
    }
    this.arrowMat = new StandardMaterial('goalArrowMat', scene);
    this.arrowMat.emissiveColor = new Color3(1, 0.8, 0.2);
    this.arrowMat.diffuseColor = new Color3(1, 0.8, 0.2);
    this.arrow = MeshBuilder.CreateCylinder('goalArrow', { height: 3, diameterTop: 2, diameterBottom: 0, tessellation: 4 }, scene);
    this.arrow.material = this.arrowMat;
    this.arrow.parent = this.root;
    this.arrow.isPickable = false;
    this.root.setEnabled(false);
  }

  show(x: number, z: number) {
    this.root.position.set(x, 0, z);
    this.age = 0;
    this.root.setEnabled(true);
    this.update(0);
  }

  get active(): boolean {
    return this.age >= 0;
  }

  update(dt: number) {
    if (this.age < 0) return;
    this.age += dt;
    if (this.age >= GoalMarker.LIFE) {
      this.age = -1;
      this.root.setEnabled(false);
      return;
    }
    const fade = Math.min(1, (GoalMarker.LIFE - this.age) / 1.2);
    // Три волны расходятся от центра одна за другой.
    this.rings.forEach((r, i) => {
      const t = (this.age / 1.5 + i / 3) % 1;
      const size = 16 + t * 16;
      r.scaling.set(size, 1, size);
      r.visibility = (1 - t) * fade;
    });
    this.arrow.position.y = 9 + Math.sin(this.age * 4) * 0.8;
    this.arrow.rotation.y = this.age * 1.5;
    this.arrow.visibility = fade;
  }
}
