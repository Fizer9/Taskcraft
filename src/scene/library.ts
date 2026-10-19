// Библиотека моделей WC3. Модели ищутся в двух местах:
// 1) зашифрованные ассеты на сайте (models/<имя>.glb внутри manifest.bin), нужен пароль;
// 2) в режиме разработки — открытые файлы assets-src/models/<имя>.glb (папка в .gitignore).
// Если модели нет нигде, сцена остаётся на заглушках.

import { TransformNode, type AssetContainer, type Scene } from '@babylonjs/core';
import { loadArt } from '../assets/loader';
import { instantiate, loadContainer, type ModelInstance } from './models';

export const MODEL_NAMES = [
  'townhall',
  'farm',
  'humanbarracks',
  'altarofkings',
  'goldmine',
  'peasant',
  'heromountainking',
  'lordaerontree0',
  'lordaerontree1',
  'lordaerontree2',
  'lordaerontree3',
] as const;

export type ModelName = (typeof MODEL_NAMES)[number];

/** Масштаб WC3 → мир игры: ратуша WC3 шириной ~450 единиц становится ~11. */
export const WC3_SCALE = 0.025;

export class ModelLibrary {
  private containers = new Map<ModelName, AssetContainer>();

  constructor(private scene: Scene) {}

  /** Загружает всё, что найдётся. Возвращает число загруженных моделей. */
  async loadAll(): Promise<number> {
    await Promise.all(
      MODEL_NAMES.map(async (name) => {
        try {
          const bytes = await loadArt(`models/${name}.glb`);
          if (!bytes) return;
          this.containers.set(name, await loadContainer(this.scene, name, bytes));
        } catch (e) {
          console.warn('Не загрузилась модель', name, e);
        }
      }),
    );
    return this.containers.size;
  }

  has(name: ModelName): boolean {
    return this.containers.has(name);
  }

  /** Новый экземпляр модели в масштабе мира, или null если модели нет. */
  create(name: ModelName, scale = 1): ModelInstance | null {
    const c = this.containers.get(name);
    if (!c) return null;
    const inst = instantiate(c);
    inst.root.scaling.scaleInPlace(WC3_SCALE * scale);
    // Корень glTF уже повёрнут загрузчиком (правая система координат → левая), поэтому
    // ставим и вращаем модель через отдельный узел-держатель.
    const holder = new TransformNode(name, this.scene);
    // Модели WC3 смотрят вдоль своей +X, после загрузчика glTF это −X сцены,
    // а сцена считает «вперёд» осью +Z: поворачиваем на четверть оборота.
    const facing = new TransformNode(name + '-facing', this.scene);
    facing.parent = holder;
    facing.rotation.y = Math.PI / 2;
    inst.root.parent = facing;
    return { ...inst, root: holder, dispose: () => (inst.dispose(), holder.dispose()) };
  }
}
