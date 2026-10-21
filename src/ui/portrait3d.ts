// Говорящий портрет героя в консоли, как в WC3: голова Горного короля из модели портрета
// (models/heromountainking_portrait.glb) в своём маленьком окне. Пока молчит, моргает и
// оглядывается (Portrait 1–4), а когда герой говорит, шевелит губами (Portrait Talk).
// Камера стоит там же, где камера Portrait_Camera в исходной модели.

import { Color3, Color4, DirectionalLight, Engine, HemisphericLight, PBRMaterial, Scene, TargetCamera, TransformNode, Vector3 } from '@babylonjs/core';
import { loadArt } from '../assets/loader';
import { instantiate, loadContainer, type ModelInstance } from '../scene/models';

/** Камера портрета в координатах MDX (из блока CAMS heromountainking_portrait.mdx). */
const CAMERA = { pos: new Vector3(54.63, 17.34, 77.82), target: new Vector3(45.56, 13.45, 76.18), fov: 0.725, near: 8 };
const IDLE = ['Portrait 1', 'Portrait 2', 'Portrait 3', 'Portrait 4'];
const TALK = ['Portrait Talk 1', 'Portrait Talk 2'];

export class Portrait3D {
  private canvas: HTMLCanvasElement;
  private scene: Scene | null = null;
  private model: ModelInstance | null = null;
  private talkUntil = 0;
  private nextIdle = 0;
  private visible = true;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait3d';
  }

  /** Грузит модель; false, если её нет (тогда в окне остаются буквы героя). */
  async load(): Promise<boolean> {
    const bytes = await loadArt('models/heromountainking_portrait.glb');
    if (!bytes) return false;
    this.host.prepend(this.canvas);
    const engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    const sky = new HemisphericLight('portraitSky', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.9;
    sky.groundColor = new Color3(0.25, 0.22, 0.2);
    const sun = new DirectionalLight('portraitSun', new Vector3(-0.4, -0.6, 0.7), scene);
    sun.intensity = 1.6;
    const container = await loadContainer(scene, 'portrait:heromountainking', bytes);
    const model = instantiate(container);
    for (const m of scene.materials) if (m instanceof PBRMaterial) m.directIntensity = 2.4;
    // Узлы модели лежат в координатах MDX под wc3_root: через его матрицу переводим камеру.
    const wc3 = model.root.getChildren((n) => n.name.includes('wc3_root'), false)[0] as TransformNode | undefined;
    const matrix = (wc3 ?? model.root).computeWorldMatrix(true);
    const camera = new TargetCamera('portraitCam', Vector3.TransformCoordinates(CAMERA.pos, matrix), scene);
    camera.setTarget(Vector3.TransformCoordinates(CAMERA.target, matrix));
    camera.fov = CAMERA.fov;
    camera.minZ = CAMERA.near;
    camera.maxZ = 2000;
    model.play(IDLE[0]);
    this.scene = scene;
    this.model = model;
    this.host.classList.add('has-3d');
    new ResizeObserver(() => engine.resize()).observe(this.canvas);
    engine.runRenderLoop(() => this.frame());
    return true;
  }

  /** Портрет виден только у Горного короля: у других героев своей модели портрета нет. */
  setVisible(on: boolean) {
    if (on === this.visible) return;
    this.visible = on;
    this.canvas.style.display = on ? '' : 'none';
    this.host.classList.toggle('has-3d', on && !!this.model);
  }

  /** Герой заговорил: губы шевелятся, пока звучит реплика. */
  talk(seconds: number) {
    if (!this.model) return;
    this.talkUntil = performance.now() + seconds * 1000;
    this.model.play(TALK[Math.floor(Math.random() * TALK.length)]);
  }

  private frame() {
    const model = this.model;
    if (!model || !this.scene || !this.visible || document.hidden) return;
    const now = performance.now();
    if (this.talkUntil && now > this.talkUntil) {
      this.talkUntil = 0;
      this.nextIdle = 0;
    }
    // В тишине раз в несколько секунд другой взгляд, но чаще всего спокойный Portrait 1.
    if (!this.talkUntil && now > this.nextIdle) {
      this.nextIdle = now + 5000 + Math.random() * 5000;
      model.play(Math.random() < 0.55 ? IDLE[0] : IDLE[1 + Math.floor(Math.random() * 3)]);
    }
    this.scene.render();
  }
}
