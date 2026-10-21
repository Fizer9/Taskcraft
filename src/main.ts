// Точка входа: состояние → сохранение → сцена → интерфейс → часы игры.

import { Store } from './state/store';
import { loadLocal, Sync } from './storage/sync';
import { World } from './scene/world';
import { Hud } from './ui/hud';
import { unlockOnStart } from './ui/modals';
import { Notifier } from './ui/notify';
import { applySkin } from './ui/skin';
import { watchKeyboard } from './ui/keyboard';
import { showLoading } from './ui/loading';
import { bindClickSound, sounds } from './audio/sound';
import { currentShift } from './state/economy';
import { watchSounds } from './audio/watch';
import { watchOutcomes } from './ui/outcome';

async function main() {
  const store = new Store(loadLocal() ?? undefined);
  const sync = new Sync(store);
  watchKeyboard();

  // На сайте игра не запускается без пароля: до входа на странице только окно ввода.
  // При разработке (npm run dev) можно войти и без него.
  const gate = import.meta.env.PROD;
  if (gate) document.body.classList.add('locked');
  await unlockOnStart(sync, gate);
  document.body.classList.remove('locked');

  const world = new World(document.getElementById('scene') as HTMLCanvasElement, store);
  new Hud(store, world, sync);
  const notifier = new Notifier(store);

  store.subscribe(() => world.sync());
  store.onEvent((e) => e.cue && sounds.cue(e.cue, e.unit));
  bindClickSound();
  watchSounds(store, world);
  watchOutcomes(store);
  world.sync();

  // Время идёт раз в секунду; первый тик догоняет время, пока вкладка была закрыта.
  store.tick();
  window.setInterval(() => store.tick(), 1000);
  // Смена суток: свет меняется, а с вечером, как в WC3, воет волк.
  let shift = currentShift(store.state);
  window.setInterval(() => {
    world.applyLighting();
    const now = currentShift(store.state);
    if (now !== shift && now === 'evening') void sounds.play('wolf');
    shift = now;
  }, 60_000);

  // Графика WC3 зашифрована, поэтому грузится только после пароля. Сначала интерфейс, земля
  // и база на экране, а юниты, Легион, музыка и фон окружения догружаются следом.
  const loading = showLoading();
  void Promise.all([applySkin(), world.loadTerrain(), world.loadModels()])
    .finally(() => loading.done())
    .then(() => Promise.all([world.loadLateModels(), sounds.startMusic(), sounds.startAmbient()]));

  // Для отладки из консоли браузера.
  Object.assign(window, { taskcraft: { store, world, sync, sounds, notifier } });
}

void main();

// Сайт открывается и без сети: сервис-воркер (vite.config.ts, scripts/sw.js) держит в
// кэше файлы игры и уже загруженную графику. В режиме разработки он не нужен.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
