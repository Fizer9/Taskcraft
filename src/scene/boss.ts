// Командиры Легиона на карте: Повелитель ужаса в отстающей земле и Архимонд у горы
// Хиджал. Стоят лицом к главной ратуше, с именем и полоской здоровья. Своих моделей
// пока нет: это увеличенный Страж Скверны в свечении своего цвета.

import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, TransformNode, type AbstractMesh } from '@babylonjs/core';
import { textPlane } from './legion';
import type { ModelLibrary } from './library';
import type { ModelInstance } from './models';
import * as P from './placeholders';

export interface BossView {
  title: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
}

/** Как выглядит командир: размер и цвета модели, подписи и полоски здоровья. */
export interface BossLook {
  scale: number;
  albedo: string;
  emissive: string;
  label: string;
  bar: string;
  /** Цвет заглушки, пока модели не загружены. */
  body: string;
}

export const DREADLORD_LOOK: BossLook = { scale: 1.7, albedo: '#9a6bd6', emissive: '#4a1f7a', label: '#c9a0ff', bar: '#b04ae0', body: '#4a2a6a' };
export const ARCHIMONDE_LOOK: BossLook = { scale: 2.5, albedo: '#7aa0ff', emissive: '#1f3a8a', label: '#9fd0ff', bar: '#3fa0ff', body: '#2a3a7a' };

const BAR_W = 10;

export class BossFx {
  private root: TransformNode | null = null;
  private model: ModelInstance | null = null;
  private fill: Mesh | null = null;
  private own: StandardMaterial[] = [];
  private key = '';
  private lib: ModelLibrary | null = null;
  private onMesh: (m: AbstractMesh) => void = () => {};

  constructor(
    private scene: Scene,
    private look: BossLook,
  ) {}

  setLibrary(lib: ModelLibrary, onMesh: (m: AbstractMesh) => void) {
    this.lib = lib;
    this.onMesh = onMesh;
    this.key = '';
  }

  sync(view: BossView | null) {
    const key = view ? `${view.title}|${view.x}|${view.z}|${this.lib ? 1 : 0}` : '';
    if (key !== this.key) {
      this.key = key;
      this.clear();
      if (view) this.build(view);
    }
    if (view && this.fill) {
      const k = Math.max(0.001, view.hp / view.maxHp);
      this.fill.scaling.x = k;
      this.fill.position.x = (-BAR_W / 2) * (1 - k);
    }
  }

  update() {
    // Заглушка медленно парит; модель сама играет анимацию.
    if (this.root && !this.model) this.root.position.y = 0.4 + Math.sin(performance.now() / 500) * 0.3;
  }

  private build(v: BossView) {
    const look = this.look;
    const root = (this.root = new TransformNode('boss', this.scene));
    root.position.set(v.x, 0, v.z);
    root.rotation.y = Math.atan2(-v.x, -v.z);
    const model = this.lib?.create('felgaurd', look.scale) ?? null;
    if (model) {
      model.root.parent = root;
      for (const m of model.root.getChildMeshes()) {
        this.onMesh(m);
        if (m.material instanceof PBRMaterial) {
          const own = m.material.clone(m.material.name + '-boss');
          own.albedoColor = Color3.FromHexString(look.albedo);
          own.emissiveColor = Color3.FromHexString(look.emissive);
          m.material = own;
        }
      }
      model.playLike('Stand Ready');
      this.model = model;
    } else {
      const k = look.scale / 1.7;
      const body = MeshBuilder.CreateCapsule('bossBody', { radius: 1.6 * k, height: 6 * k }, this.scene);
      body.material = P.mat(this.scene, look.body, 0.3);
      body.parent = root;
      body.position.y = 3 * k;
      body.isPickable = false;
      for (const side of [-1, 1]) {
        const wing = MeshBuilder.CreateBox('dreadWing', { width: 3.2, height: 4, depth: 0.2 }, this.scene);
        wing.material = P.mat(this.scene, '#2a1a3a');
        wing.parent = root;
        wing.position.set(side * 2.6, 4.2, -0.8);
        wing.rotation.y = side * 0.5;
        wing.isPickable = false;
      }
    }
    const top = 9 * (look.scale / 1.7);
    const label = textPlane(this.scene, v.title, look.label);
    label.parent = root;
    label.position.y = top + 6;
    this.own.push(label.material as StandardMaterial);
    const bg = MeshBuilder.CreatePlane('dreadHpBg', { width: BAR_W + 0.4, height: 0.9 }, this.scene);
    bg.material = P.mat(this.scene, '#111111', 1);
    bg.parent = root;
    bg.position.y = top + 4.2;
    bg.billboardMode = Mesh.BILLBOARDMODE_ALL;
    bg.isPickable = false;
    const fill = MeshBuilder.CreatePlane('dreadHpFill', { width: BAR_W, height: 0.6 }, this.scene);
    const fm = new StandardMaterial('dreadHpMat', this.scene);
    fm.emissiveColor = Color3.FromHexString(look.bar);
    fm.disableLighting = true;
    fill.material = fm;
    this.own.push(fm);
    fill.parent = bg;
    fill.position.z = -0.01;
    fill.isPickable = false;
    this.fill = fill;
  }

  private clear() {
    this.model?.dispose();
    this.model = null;
    // Свои материалы (подпись, полоска) убираем вместе с узлом, общие из кэша заглушек не трогаем.
    for (const m of this.own) m.dispose(true, true);
    this.own = [];
    this.root?.dispose();
    this.root = null;
    this.fill = null;
  }
}
