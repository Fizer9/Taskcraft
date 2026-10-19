// Загрузка моделей WC3, сконвертированных scripts/mdx2gltf.py в .glb.
// Одна загрузка → контейнер, из которого делаются экземпляры со своими костями и анимациями.

import { AbstractMesh, AnimationGroup, AssetContainer, LoadAssetContainerAsync, Scene, TransformNode } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export interface ModelInstance {
  root: TransformNode;
  animations: string[];
  /** Включает анимацию по имени последовательности MDX ("Walk", "Stand Work Gold 1"…). */
  play(name: string, loop?: boolean): void;
  /** Ищет первую анимацию, имя которой начинается с prefix ("Walk Gold"). */
  playLike(prefix: string, loop?: boolean): void;
  dispose(): void;
}

const containers = new Map<string, Promise<AssetContainer>>();

/** source: адрес .glb или уже расшифрованные байты. */
export function loadContainer(scene: Scene, key: string, source: string | Uint8Array): Promise<AssetContainer> {
  let c = containers.get(key);
  if (!c) {
    c = LoadAssetContainerAsync(source, scene, { pluginExtension: '.glb' });
    containers.set(key, c);
  }
  return c;
}

function extras(node: { metadata?: unknown }): Record<string, unknown> | undefined {
  return (node.metadata as { gltf?: { extras?: Record<string, unknown> } } | undefined)?.gltf?.extras;
}

export function instantiate(container: AssetContainer): ModelInstance {
  const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const root = entries.rootNodes[0] as TransformNode;
  const groups = new Map<string, AnimationGroup>(entries.animationGroups.map((g) => [g.name, g]));
  const meshes = root.getChildMeshes(false) as AbstractMesh[];
  let current: AnimationGroup | null = null;

  // Геосеты вроде мешка с золотом видны только в своих анимациях (это записано в extras).
  const applyVisibility = (anim: string) => {
    for (const m of meshes) {
      const vis = extras(m)?.visibleIn as string[] | undefined;
      if (vis) m.setEnabled(vis.includes(anim));
    }
  };

  const play = (name: string, loop = true) => {
    const g = groups.get(name);
    if (!g || g === current) return;
    current?.stop();
    current = g;
    applyVisibility(name);
    g.start(loop, 1, g.from, g.to);
  };

  return {
    root,
    animations: [...groups.keys()],
    play,
    playLike(prefix, loop = true) {
      const name = [...groups.keys()].find((n) => n.toLowerCase().startsWith(prefix.toLowerCase()));
      if (name) play(name, loop);
    },
    dispose() {
      entries.dispose();
    },
  };
}

export async function loadModel(scene: Scene, url: string): Promise<ModelInstance> {
  return instantiate(await loadContainer(scene, url, url));
}
