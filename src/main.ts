// Точка входа: состояние → сохранение → сцена → интерфейс → часы игры.

import { Store } from './state/store';
import { loadLocal, Sync } from './storage/sync';
import { World } from './scene/world';
import { Hud } from './ui/hud';
import { unlockOnStart } from './ui/modals';
import { applySkin } from './ui/skin';

const store = new Store(loadLocal() ?? undefined);
const sync = new Sync(store);
const world = new World(document.getElementById('scene') as HTMLCanvasElement, store);
new Hud(store, world, sync);

store.subscribe(() => world.sync());
world.sync();

// Время идёт раз в секунду; первый тик догоняет время, пока вкладка была закрыта.
store.tick();
window.setInterval(() => store.tick(), 1000);
window.setInterval(() => world.applyLighting(), 60_000);

// Модели WC3 грузятся после пароля: без него зашифрованные модели не прочитать.
void unlockOnStart(sync).then(() => Promise.all([applySkin(), world.loadTerrain(), world.loadModels()]));

// Для отладки из консоли браузера.
Object.assign(window, { taskcraft: { store, world, sync } });
