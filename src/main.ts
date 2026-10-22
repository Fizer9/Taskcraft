// Точка входа: состояние → сохранение → сцена → интерфейс → часы игры.

import { Store } from './state/store';
import { loadBackup, loadLocal, Sync } from './storage/sync';
import { claimTab } from './storage/tabs';
import { World } from './scene/world';
import { Hud } from './ui/hud';
import { chooseForeignGame, unlockOnStart } from './ui/modals';
import { Notifier } from './ui/notify';
import { applySkin } from './ui/skin';
import { watchKeyboard } from './ui/keyboard';
import { showLoading } from './ui/loading';
import { bindClickSound, sounds } from './audio/sound';
import { currentShift } from './state/economy';
import { watchSounds } from './audio/watch';
import { watchOutcomes } from './ui/outcome';
import { watchLobby } from './ui/lobby';

async function main() {
  // Две вкладки затирали бы сохранения друг друга: играет только одна.
  let sync: Sync | null = null;
  await claimTab(() => sync?.pause());
  const store = new Store(loadLocal() ?? undefined);
  sync = new Sync(store);
  sync.chooseForeign = (remote) => chooseForeignGame(store.state, remote);
  watchKeyboard();

  // На сайте игра не запускается без пароля: до входа на странице только окно ввода.
  // При разработке (npm run dev) можно войти и без него.
  const gate = import.meta.env.PROD;
  if (gate) document.body.classList.add('locked');
  await unlockOnStart(sync, gate);
  document.body.classList.remove('locked');

  const world = new World(document.getElementById('scene') as HTMLCanvasElement, store);
  const hud = new Hud(store, world, sync);
  const notifier = new Notifier(store);

  store.subscribe(() => world.sync());
  store.onEvent((e) => e.cue && sounds.cue(e.cue, e.unit));
  bindClickSound();
  watchSounds(store, world);
  watchOutcomes(store, (id) => world.fortressShown(id));
  // Новая игра начинается с лобби: сферы, проекты, герой.
  watchLobby(store, sync, () => world.minimapArt());
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
    .finally(() => {
      loading.done();
      hud.enter();
    })
    .then(() => Promise.all([world.loadLateModels(), sounds.startMusic(), sounds.startAmbient()]));

  // Для отладки из консоли браузера.
  Object.assign(window, { taskcraft: { store, world, sync, sounds, notifier } });
}

/**
 * Запасной выход, если игра не запустилась: сохранение можно скачать, вернуть прежнюю
 * игру из резервной копии (она пишется перед загрузкой файла и новой игрой) или начать заново.
 */
function rescue(error: unknown) {
  console.error(error);
  const raw = localStorage.getItem('taskcraft.state');
  const backup = loadBackup();
  const box = document.createElement('div');
  box.className = 'rescue';
  box.innerHTML =
    '<h3>Игра не запустилась</h3><p>Похоже, сохранение повреждено. Его можно скачать файлом, вернуть прежнюю игру или начать заново.</p>' +
    `<p class="hint">${String((error as Error)?.message ?? error).replace(/[<>&]/g, '')}</p>` +
    '<div class="actions"><button class="btn" data-a="save">Скачать сохранение</button>' +
    (backup ? '<button class="btn" data-a="backup">Вернуть прежнюю игру</button>' : '') +
    '<button class="btn" data-a="new">Начать новую игру</button></div>';
  document.body.append(box);
  box.querySelector('[data-a="save"]')!.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw ?? '{}'], { type: 'application/json' }));
    a.download = 'taskcraft-damaged.json';
    a.click();
  });
  box.querySelector('[data-a="backup"]')?.addEventListener('click', () => {
    localStorage.setItem('taskcraft.state', JSON.stringify(backup));
    location.reload();
  });
  box.querySelector('[data-a="new"]')!.addEventListener('click', () => {
    if (!confirm('Начать новую игру? Повреждённое сохранение будет удалено (скачай его сначала, если нужно).')) return;
    localStorage.removeItem('taskcraft.state');
    location.reload();
  });
}

main().catch(rescue);

// Сайт открывается и без сети: сервис-воркер (vite.config.ts, scripts/sw.js) держит в
// кэше файлы игры и уже загруженную графику. В режиме разработки он не нужен.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
