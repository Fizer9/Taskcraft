// Портрет в консоли, как в WC3: в маленьком окне то, что сейчас выбрано. У юнитов, героев,
// демонов и зданий это модель портрета (models/<имя>_portrait.glb): голова моргает и
// оглядывается (Portrait 1–N), а когда юнит говорит, шевелит губами (Portrait Talk). Камера
// стоит там же, где камера Portrait_Camera в исходной модели (scripts/mdx2gltf.py кладёт её в
// extras сцены). Если портрета нет (руины ратуши), показываем само здание, кадр по габаритам.

import { Color3, Color4, DirectionalLight, Engine, HemisphericLight, PBRMaterial, Scene, TargetCamera, TransformNode, Vector3 } from '@babylonjs/core';
import { loadArt } from '../assets/loader';
import { instantiate, loadContainer, type ModelInstance } from '../scene/models';
import { applyTeamColor } from '../scene/teamcolor';

export interface PortraitLook {
  /** Модель: models/<model>.glb. */
  model: string;
  /** Анимация здания («Stand 1», «Stand Upgrade Second»); у моделей портрета не нужна. */
  anim?: string;
  /** Голос, на реплики которого портрет шевелит губами. */
  voice?: string;
  /** Цвет базы для командных частей (state/colors.ts). */
  team?: string;
}

interface Camera {
  pos: Vector3;
  target: Vector3;
  fov: number;
  near: number;
}

interface Entry {
  model: ModelInstance;
  camera: Camera;
  idle: string[];
  talk: string[];
}

/** Камера Portrait_Camera из extras сцены glb (координаты MDX), если конвертер её записал. */
function glbCamera(bytes: Uint8Array): { pos: number[]; target: number[]; fov: number; near: number } | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    return json.scenes?.[0]?.extras?.camera ?? null;
  } catch {
    return null;
  }
}

export class Portrait3D {
  private canvas: HTMLCanvasElement;
  private scene: Scene | null = null;
  private camera: TargetCamera | null = null;
  private entries = new Map<string, Promise<Entry | null>>();
  private current: { look: PortraitLook; entry: Entry } | null = null;
  /** Что просили показать последним: пока модель грузится, выбор мог смениться. */
  private wanted = '';
  private talkUntil = 0;
  private nextIdle = 0;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait3d';
    this.canvas.style.display = 'none';
  }

  private ensureScene(): Scene {
    if (this.scene) return this.scene;
    this.host.prepend(this.canvas);
    const engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    const sky = new HemisphericLight('portraitSky', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.9;
    sky.groundColor = new Color3(0.25, 0.22, 0.2);
    const sun = new DirectionalLight('portraitSun', new Vector3(-0.4, -0.6, 0.7), scene);
    sun.intensity = 1.6;
    this.camera = new TargetCamera('portraitCam', new Vector3(0, 0, -10), scene);
    this.scene = scene;
    new ResizeObserver(() => engine.resize()).observe(this.canvas);
    engine.runRenderLoop(() => this.frame());
    return scene;
  }

  private load(model: string): Promise<Entry | null> {
    let e = this.entries.get(model);
    if (!e) {
      e = this.build(model).catch((err) => {
        console.warn('Не загрузился портрет', model, err);
        return null;
      });
      this.entries.set(model, e);
    }
    return e;
  }

  private async build(name: string): Promise<Entry | null> {
    const bytes = await loadArt(`models/${name}.glb`);
    if (!bytes) return null;
    const scene = this.ensureScene();
    const container = await loadContainer(scene, 'portrait:' + name, bytes);
    const model = instantiate(container);
    for (const m of container.materials) if (m instanceof PBRMaterial) m.directIntensity = 2.4;
    const idle = model.animations.filter((a) => /^Portrait \d/.test(a)).sort();
    const talk = model.animations.filter((a) => a.startsWith('Portrait Talk'));
    const cam = glbCamera(bytes);
    let camera: Camera;
    if (cam && name.endsWith('_portrait')) {
      // Узлы модели лежат в координатах MDX под wc3_root: через его матрицу переводим камеру.
      const wc3 = model.root.getChildren((n) => n.name.includes('wc3_root'), false)[0] as TransformNode | undefined;
      const matrix = (wc3 ?? model.root).computeWorldMatrix(true);
      camera = {
        pos: Vector3.TransformCoordinates(Vector3.FromArray(cam.pos), matrix),
        target: Vector3.TransformCoordinates(Vector3.FromArray(cam.target), matrix),
        fov: cam.fov,
        near: cam.near,
      };
    } else {
      // Здание целиком, спереди и сверху, как его портрет в игре. Модели WC3 смотрят вдоль
      // своей +X, после загрузчика glTF это −X сцены.
      model.playLike('Stand');
      const { min, max } = model.root.getHierarchyBoundingVectors(true, (m) => m.isEnabled() && (m.getTotalVertices?.() ?? 0) > 0);
      const size = max.subtract(min);
      const target = new Vector3((min.x + max.x) / 2, min.y + size.y * 0.42, (min.z + max.z) / 2);
      const radius = Math.max(size.x, size.y, size.z) * 0.5;
      const fov = 0.7;
      const pos = target.add(new Vector3(-1, 0.55, 0.5).normalize().scale((radius / Math.sin(fov / 2)) * 1.05));
      camera = { pos, target, fov, near: radius * 0.05 };
    }
    model.root.setEnabled(false);
    return { model, camera, idle, talk };
  }

  /** Показать модель выбранного; null или модели нет — окно пустеет, видны буквы. */
  async show(look: PortraitLook | null) {
    const key = look ? `${look.model}|${look.anim ?? ''}|${look.voice ?? ''}|${look.team ?? ''}` : '';
    if (key === this.wanted) return;
    this.wanted = key;
    const entry = look ? await this.load(look.model) : null;
    if (this.wanted !== key) return;
    if (this.current && this.current.entry !== entry) this.current.entry.model.root.setEnabled(false);
    if (!look || !entry) {
      this.current = null;
      this.canvas.style.display = 'none';
      this.host.classList.remove('has-3d');
      return;
    }
    const { model, camera } = entry;
    // Одна модель портрета на всех: цвет меняется под базу выбранного.
    applyTeamColor(model, look.team);
    model.root.setEnabled(true);
    const cam = this.camera!;
    cam.position.copyFrom(camera.pos);
    cam.setTarget(camera.target);
    cam.fov = camera.fov;
    cam.minZ = camera.near;
    cam.maxZ = camera.near * 2000;
    this.current = { look, entry };
    this.talkUntil = 0;
    this.nextIdle = 0;
    if (look.anim) model.play(look.anim);
    else if (!entry.idle.length) model.playLike('Stand');
    this.canvas.style.display = '';
    this.host.classList.add('has-3d');
  }

  /** Кто-то заговорил: если это выбранный, губы шевелятся, пока звучит реплика. */
  talk(voice: string, seconds: number) {
    const c = this.current;
    if (!c || c.look.voice !== voice || !c.entry.talk.length) return;
    this.talkUntil = performance.now() + seconds * 1000;
    c.entry.model.play(c.entry.talk[Math.floor(Math.random() * c.entry.talk.length)]);
  }

  private frame() {
    const c = this.current;
    if (!c || !this.scene || document.hidden) return;
    const now = performance.now();
    if (this.talkUntil && now > this.talkUntil) {
      this.talkUntil = 0;
      this.nextIdle = 0;
    }
    // В тишине раз в несколько секунд другой взгляд, но чаще всего спокойный Portrait 1.
    // Здание с заданной анимацией (ратуша-крепость-замок, сторожевая башня) так и стоит.
    const idle = c.entry.idle;
    if (idle.length && !c.look.anim && !this.talkUntil && now > this.nextIdle) {
      this.nextIdle = now + 5000 + Math.random() * 5000;
      c.entry.model.play(Math.random() < 0.55 || idle.length < 2 ? idle[0] : idle[1 + Math.floor(Math.random() * (idle.length - 1))]);
    }
    this.scene.render();
  }
}
