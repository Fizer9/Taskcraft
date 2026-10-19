// Сцена карты: камера как в WC3, земля, свет по времени суток, базы и герой.

import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  PBRMaterial,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { currentShift, miningFactor, type Shift } from '../state/economy';
import type { Store } from '../state/store';
import { Base } from './base';
import { ModelLibrary, type ModelName } from './library';
import type { ModelInstance } from './models';
import * as P from './placeholders';

export const MAP_HALF = 200;

// Камера WC3 по умолчанию: угол атаки 304° (56° вниз от горизонта), узкое поле зрения.
const CAMERA_BETA = (34 * Math.PI) / 180;
const CAMERA_ALPHA = -Math.PI / 2;

const LIGHTING: Record<Shift, { sun: number; sky: number; tint: string; clear: string }> = {
  day: { sun: 1.0, sky: 0.65, tint: '#fff4dc', clear: '#0d1117' },
  weekend: { sun: 1.0, sky: 0.65, tint: '#fff4dc', clear: '#0d1117' },
  evening: { sun: 0.75, sky: 0.5, tint: '#ffc58a', clear: '#120c0a' },
  night: { sun: 0.35, sky: 0.35, tint: '#8fa4ff', clear: '#05070d' },
};

export class World {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private bases = new Map<string, Base>();
  private heroNode: TransformNode;
  private heroTarget = new Vector3();
  private heroModel: ModelInstance | null = null;
  private forest: { node: TransformNode; scale: number }[] = [];
  private sun: DirectionalLight;
  private sky: HemisphericLight;
  private shadows: ShadowGenerator;
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private selected: string | null = null;
  onSelectBase: (id: string | null) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
  ) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);

    this.camera = new ArcRotateCamera('cam', CAMERA_ALPHA, CAMERA_BETA, 85, Vector3.Zero(), this.scene);
    this.camera.fov = 0.72;
    this.camera.lowerRadiusLimit = 45;
    this.camera.upperRadiusLimit = 120;
    this.camera.inputs.clear(); // вращение камеры в WC3 недоступно, только сдвиг и зум

    this.sky = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    this.sky.groundColor = new Color3(0.25, 0.22, 0.2);
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.6), this.scene);
    this.sun.position = new Vector3(100, 150, -100);
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 16;
    this.shadows.darkness = 0.45;

    this.makeGround();
    this.scatterTrees();

    for (const p of store.state.projects) this.bases.set(p.id, new Base(this.scene, p));
    this.heroNode = P.hero(this.scene);
    this.heroNode.position.copyFrom(this.bases.get(store.state.hero.baseId)!.heroSpot());
    this.heroTarget.copyFrom(this.heroNode.position);
    this.camera.target.copyFrom(this.heroNode.position);

    for (const m of this.scene.meshes) {
      if (m.name !== 'ground' && m.name !== 'dirt' && !m.name.startsWith('label') && !m.name.startsWith('hp')) this.shadows.addShadowCaster(m, false);
    }

    this.bindInput();
    this.applyLighting();

    this.scene.onBeforeRenderObservable.add(() => this.frame(this.engine.getDeltaTime() / 1000));
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', () => this.engine.resize());
  }

  /** Трава Лордерона: зелёная земля с пятнами, нарисованная в текстуре. */
  private makeGround() {
    const ground = MeshBuilder.CreateGround('ground', { width: MAP_HALF * 2, height: MAP_HALF * 2 }, this.scene);
    const tex = new DynamicTexture('grass', 1024, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#4c6b2c';
    ctx.fillRect(0, 0, 1024, 1024);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tones = ['#577a33', '#41602a', '#5d7f38', '#6b7a3a', '#4a5f2a'];
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
      ctx.globalAlpha = 0.25 + rnd() * 0.35;
      ctx.beginPath();
      ctx.arc(rnd() * 1024, rnd() * 1024, 2 + rnd() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    tex.update();
    tex.uScale = tex.vScale = 6;
    const m = new StandardMaterial('groundMat', this.scene);
    m.diffuseTexture = tex;
    m.specularColor = Color3.Black();
    ground.material = m;
    ground.receiveShadows = true;
    ground.isPickable = true;
  }

  /** Лес по краям карты и между базами, чтобы карта не выглядела пустой. */
  private scatterTrees() {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const slots = this.store.state.projects.map((p) => p.slot);
    for (let i = 0; i < 420; i++) {
      const x = (rnd() * 2 - 1) * (MAP_HALF - 4);
      const z = (rnd() * 2 - 1) * (MAP_HALF - 4);
      // Не сажаем деревья на базы и на крепости (крепость в 48 единицах наружу от базы).
      const blocked = slots.some((s) => {
        const len = Math.hypot(s.x, s.z) || 1;
        const fx = s.x + (s.x / len) * 48;
        const fz = s.z + (s.z / len) * 48;
        return Math.hypot(x - s.x, z - s.z) < 34 || (len > 1 && Math.hypot(x - fx, z - fz) < 12);
      });
      if (blocked) continue;
      const scale = 0.8 + rnd() * 0.6;
      const t = P.tree(this.scene, scale);
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * Math.PI;
      this.forest.push({ node: t, scale });
    }
  }

  /**
   * Подгружает модели WC3 и ставит их вместо заглушек. Вызывается после ввода пароля,
   * потому что зашифрованные модели без него не прочитать.
   */
  async loadModels(): Promise<number> {
    const lib = new ModelLibrary(this.scene);
    const count = await lib.loadAll();
    if (!count) return 0;
    // PBR-материалам моделей нужно больше света, чем простым материалам земли и заглушек.
    for (const m of this.scene.materials) if (m instanceof PBRMaterial) m.directIntensity = 2.4;
    const caster = (m: AbstractMesh) => {
      this.shadows.addShadowCaster(m, false);
      m.receiveShadows = true;
    };
    for (const b of this.bases.values()) b.applyModels(lib, caster);

    const hero = lib.create('heromountainking', 1.1);
    if (hero) {
      for (const c of this.heroNode.getChildren()) if (!c.name.startsWith('hRing')) c.dispose();
      hero.root.parent = this.heroNode;
      hero.root.getChildMeshes().forEach(caster);
      hero.play('Stand 1');
      this.heroModel = hero;
    }
    this.plantForest(lib);
    return count;
  }

  /**
   * Сотни деревьев как отдельные модели со своими костями слишком тяжелы, поэтому на каждый вид
   * дерева делается один образец, а лес состоит из его копий-инстансов (качаются они вместе).
   */
  private plantForest(lib: ModelLibrary) {
    const samples: { mesh: Mesh; local: Matrix }[][] = [];
    for (let v = 0; v < 4; v++) {
      const inst = lib.create(`lordaerontree${v}` as ModelName);
      if (!inst) return;
      inst.play('Stand 1');
      // Положение каждой части относительно корня модели (с масштабом и поворотом из glTF).
      const inv = inst.root.computeWorldMatrix(true).clone().invert();
      const parts = inst.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      samples.push(parts.map((mesh) => ({ mesh, local: mesh.computeWorldMatrix(true).multiply(inv) })));
      inst.root.position.y = -1000; // сам образец прячем под землю, видны только его копии
    }
    this.forest.forEach(({ node, scale }, i) => {
      const holder = new TransformNode('treeHolder', this.scene);
      holder.position.copyFrom(node.position);
      holder.rotation.y = node.rotation.y;
      holder.scaling.setAll(scale * 0.85);
      for (const { mesh, local } of samples[i % 4]) {
        const copy = mesh.createInstance(`tree${i}`);
        copy.parent = holder;
        local.decompose(copy.scaling, (copy.rotationQuaternion = new Quaternion()), copy.position);
        copy.isPickable = false;
        this.shadows.addShadowCaster(copy, false);
      }
      node.dispose();
    });
  }

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY, inside: true };
    });
    this.canvas.addEventListener('mouseleave', () => (this.mouse.inside = false));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const c = this.camera;
        c.radius = Math.min(c.upperRadiusLimit!, Math.max(c.lowerRadiusLimit!, c.radius + Math.sign(e.deltaY) * 6));
      },
      { passive: false },
    );
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      const pick = this.scene.pick(e.offsetX, e.offsetY);
      const id = (pick?.pickedMesh?.metadata as { baseId?: string } | null)?.baseId ?? null;
      if (id) {
        this.select(id);
        this.onSelectBase(id);
      }
    });
  }

  select(id: string | null) {
    if (this.selected) this.bases.get(this.selected)?.setSelected(false);
    this.selected = id;
    if (id) this.bases.get(id)?.setSelected(true);
  }

  /** Плавно переводит камеру на точку, как клик по миникарте. */
  lookAt(x: number, z: number) {
    this.camera.target.set(x, 0, z);
  }

  focusBase(id: string) {
    const p = this.store.project(id);
    if (p) this.lookAt(p.slot.x, p.slot.z + 6);
  }

  cameraTarget(): { x: number; z: number } {
    return { x: this.camera.target.x, z: this.camera.target.z };
  }

  applyLighting() {
    const l = LIGHTING[currentShift(this.store.state)];
    this.sun.intensity = l.sun;
    this.sun.diffuse = Color3.FromHexString(l.tint);
    this.sky.intensity = l.sky;
    this.scene.clearColor = Color4.FromHexString(l.clear + 'ff');
  }

  /** Синхронизирует сцену с состоянием: фермы, крепости, герой. */
  sync() {
    const s = this.store.state;
    for (const p of s.projects) {
      const b = this.bases.get(p.id);
      if (!b) continue;
      b.setFortressHp(p.fortressHp, p.fortressMaxHp);
    }
    this.bases.get('main')?.setFarms(s.farms);
    const heroBase = this.bases.get(s.hero.baseId);
    if (heroBase) this.heroTarget.copyFrom(heroBase.heroSpot());
  }

  private frame(dt: number) {
    dt = Math.min(dt, 0.1);
    // Сдвиг камеры стрелками и краем экрана, как в WC3 (буквы заняты горячими клавишами команд).
    const pan = new Vector3(0, 0, 0);
    const k = this.keys;
    if (k.has('arrowleft')) pan.x -= 1;
    if (k.has('arrowright')) pan.x += 1;
    if (k.has('arrowup')) pan.z += 1;
    if (k.has('arrowdown')) pan.z -= 1;
    if (this.mouse.inside) {
      const edge = 6;
      if (this.mouse.x <= edge) pan.x -= 1;
      if (this.mouse.x >= window.innerWidth - edge) pan.x += 1;
      if (this.mouse.y <= edge) pan.z += 1;
    }
    if (pan.lengthSquared() > 0) {
      pan.normalize().scaleInPlace(60 * dt * (this.camera.radius / 85));
      const t = this.camera.target;
      t.x = Math.max(-MAP_HALF, Math.min(MAP_HALF, t.x + pan.x));
      t.z = Math.max(-MAP_HALF, Math.min(MAP_HALF, t.z + pan.z));
    }

    const s = this.store.state;
    const now = new Date();
    for (const p of s.projects) this.bases.get(p.id)?.update(dt, miningFactor(s, p, now));

    // Герой идёт к своей базе.
    const h = this.heroNode.position;
    const d = this.heroTarget.subtract(h);
    const dist = d.length();
    if (dist > 0.2) {
      const step = Math.min(dist, Math.max(25, dist * 1.5) * dt);
      h.addInPlace(d.scale(step / dist));
      this.heroNode.rotation.y = Math.atan2(d.x, d.z);
      this.heroModel?.play('Walk 1');
    } else this.heroModel?.play('Stand 1');
  }
}
