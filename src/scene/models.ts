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
  /** Один раз проигрывает name (speed: во сколько раз быстрее) и переходит к next по кругу («Birth» → «Stand 1»). */
  playThen(name: string, next: string, speed?: number): void;
  /** Скорость текущей анимации: шаг подстраивается под скорость движения, чтобы ноги не скользили. */
  setSpeed(ratio: number): void;
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

  // А некоторые появляются посреди анимации: леса и стены в модели постройки здания.
  type Switch = Record<string, [number, boolean][]>;
  const switching = meshes.filter((m) => extras(m)?.visibleSwitch);
  let clock = 0;
  let looped = false;
  const scene = root.getScene();
  const observer = switching.length
    ? scene.onBeforeRenderObservable.add(() => {
        if (!current) return;
        const anim = current.name;
        const length = (current.to - current.from) / 60;
        clock += (scene.getEngine().getDeltaTime() / 1000) * current.speedRatio;
        const t = looped && length > 0 ? clock % length : clock;
        for (const m of switching) {
          const keys = (extras(m)!.visibleSwitch as Switch)[anim];
          if (!keys) continue;
          let on = keys[0][1];
          for (const [at, vis] of keys) if (at <= t) on = vis;
          if (m.isEnabled(false) !== on) m.setEnabled(on);
        }
      })
    : null;

  const play = (name: string, loop = true, speed = 1) => {
    const g = groups.get(name);
    if (!g || g === current) return;
    current?.stop();
    current = g;
    clock = 0;
    looped = loop;
    applyVisibility(name);
    g.start(loop, speed, g.from, g.to);
  };

  return {
    root,
    animations: [...groups.keys()],
    play,
    playLike(prefix, loop = true) {
      const name = [...groups.keys()].find((n) => n.toLowerCase().startsWith(prefix.toLowerCase()));
      if (name) play(name, loop);
    },
    setSpeed(ratio) {
      if (current && Math.abs(current.speedRatio - ratio) > 0.01) current.speedRatio = ratio;
    },
    playThen(name, next, speed = 1) {
      const g = groups.get(name);
      if (!g) return play(next);
      play(name, false, speed);
      g.onAnimationGroupEndObservable.addOnce(() => {
        if (current === g) play(next);
      });
    },
    dispose() {
      if (observer) scene.onBeforeRenderObservable.remove(observer);
      entries.dispose();
    },
  };
}

/**
 * Плавный поворот к углу target (рад/с rate) по кратчайшей дуге: юниты WC3 не
 * разворачиваются мгновенно.
 */
export function turnTowards(node: TransformNode, target: number, dt: number, rate = 12) {
  let d = target - node.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const step = rate * dt;
  node.rotation.y = Math.abs(d) <= step ? target : node.rotation.y + Math.sign(d) * step;
}

export async function loadModel(scene: Scene, url: string): Promise<ModelInstance> {
  return instantiate(await loadContainer(scene, url, url));
}
