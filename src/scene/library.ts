// Библиотека моделей WC3. Модели ищутся в двух местах:
// 1) зашифрованные ассеты на сайте (models/<имя>.glb внутри manifest.bin), нужен пароль;
// 2) в режиме разработки — открытые файлы assets-src/models/<имя>.glb (папка в .gitignore).
// Если модели нет нигде, сцена остаётся на заглушках.

import { PBRMaterial, TransformNode, type AssetContainer, type Scene } from '@babylonjs/core';
import { loadArt } from '../assets/loader';
import { instantiate, loadContainer, type ModelInstance } from './models';

export const MODEL_NAMES = [
  'townhall',
  'farm',
  'farmbirth',
  'humanbarracks',
  'altarofkings',
  'goldmine',
  'peasant',
  'heromountainking',
  'footman',
  'rifleman',
  'knight',
  'gryphonrider',
  'demongate',
  'felhound',
  'felgaurd',
  'doomguard',
  'infernal',
  'heropaladin',
  'heroarchmage',
  'herobloodelf',
  'rallypoint',
  // Здания дерева технологий у главной ратуши.
  'humanlumbermill',
  'blacksmith',
  'workshop',
  'humantower',
  'gryphonaviary',
  'arcanevault',
  // Эффекты боя: тело, разорванное на куски, молот грифона и Молот бури.
  'humanlargedeathexplode',
  'gryphonridermissile',
  'stormboltmissile',
  // Мелочи на карте.
  'crates0',
  'crates1',
  'hay0',
  'haycart',
  'wheelbarrel',
  'torchhuman0',
  'bannerhuman0',
  'well',
  'armorrack',
  'weapons',
  'lords_rock0',
  'lords_rock1',
  'lords_rock2',
  'lords_rock3',
  'skullonstick0',
  'skullonstick1',
  'skullpile0',
  'braziergreen',
  'village_fencelong',
  'village_fenceshort',
  'lordaerontree0',
  'lordaerontree1',
  'lordaerontree2',
  'lordaerontree3',
  'lanternpost0',
  'signpost0',
  'summergrass0',
  'summergrass1',
  'riverrushes0',
  'lilypad0',
] as const;

export type ModelName = (typeof MODEL_NAMES)[number];

/**
 * Эти модели грузятся вторыми, когда база уже стоит в моделях WC3: юниты, демоны, врата
 * Легиона, герои других классов и постройка фермы. До их загрузки на их месте видны заглушки.
 */
export const LATE_MODELS: readonly ModelName[] = [
  'footman',
  'rifleman',
  'knight',
  'gryphonrider',
  'demongate',
  'felhound',
  'felgaurd',
  'doomguard',
  'infernal',
  'heropaladin',
  'heroarchmage',
  'herobloodelf',
  'farmbirth',
  'humanlumbermill',
  'blacksmith',
  'workshop',
  'humantower',
  'gryphonaviary',
  'arcanevault',
  'humanlargedeathexplode',
  'gryphonridermissile',
  'stormboltmissile',
];

/** Масштаб WC3 → мир игры: ратуша WC3 шириной ~450 единиц становится ~11. */
export const WC3_SCALE = 0.025;

export class ModelLibrary {
  private containers = new Map<ModelName, AssetContainer>();

  constructor(private scene: Scene) {}

  /** Загружает то, что найдётся из списка (по умолчанию все). Возвращает число загруженных моделей. */
  async loadAll(names: readonly ModelName[] = MODEL_NAMES): Promise<number> {
    await Promise.all(
      names.map(async (name) => {
        try {
          const bytes = await loadArt(`models/${name}.glb`);
          if (!bytes) return;
          const c = await loadContainer(this.scene, name, bytes);
          // Хвоя ёлок по ORM-текстуре выходила металлической и гладкой и блестела белыми
          // полосами. Делаем её матовой: без металла, шероховатость полная.
          if (name.startsWith('lordaerontree')) {
            for (const m of c.materials) {
              if (m instanceof PBRMaterial) {
                m.metallicTexture = null;
                m.metallic = 0;
                m.roughness = 1;
              }
            }
          }
          this.containers.set(name, c);
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
