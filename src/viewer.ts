// Просмотр сконвертированных моделей: viewer.html?model=путь/к/модели.glb
// Показывает анимации и проверяет, что кости, текстуры и видимость геосетов перенеслись.

import { ArcRotateCamera, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';
import { loadModel } from './scene/models';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.14, 0.1, 1);
const cam = new ArcRotateCamera('cam', -Math.PI / 2 + 0.6, 1.1, 260, new Vector3(0, 60, 0), scene);
cam.attachControl(canvas, true);
cam.wheelPrecision = 2;
new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.7;
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.7), scene);
sun.intensity = 2.2;

const url = new URLSearchParams(location.search).get('model') ?? 'assets-src/models/peasant.glb';
const panel = document.getElementById('panel')!;

loadModel(scene, url).then((model) => {
  // Подгоняем камеру под размер модели: здания в WC3 в несколько раз больше юнитов.
  const { min, max } = model.root.getHierarchyBoundingVectors(true);
  const size = max.subtract(min).length();
  cam.target = min.add(max).scale(0.5);
  cam.radius = size * 1.3;
  const play = (name: string) => {
    model.play(name);
    panel.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === name));
  };
  for (const name of model.animations) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => play(name);
    panel.appendChild(b);
  }
  const first = ['Walk', 'Stand'].map((p) => model.animations.find((n) => n.startsWith(p))).find(Boolean);
  play(first ?? model.animations[0]);
  Object.assign(window, { model, cam });
});

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
