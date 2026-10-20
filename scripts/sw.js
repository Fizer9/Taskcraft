// Сервис-воркер Taskcraft: игра открывается и без сети. Файлы сборки кладутся в кэш
// при установке, графика WC3 (зашифрованные .bin) при первой загрузке. В кэше она
// так и лежит зашифрованной. Список файлов и версию подставляет vite.config.ts.

const VERSION = '__VERSION__';
const SHELL = __FILES__;
const CACHE = 'taskcraft-' + VERSION;
const ART = 'taskcraft-art';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

// Новая версия сразу берёт страницы на себя, кэши старых версий удаляются.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('taskcraft-') && k !== CACHE && k !== ART).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(name)).put(req, res.clone());
  return res;
}

async function networkFirst(req, name, fallback = req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(name)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(fallback, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

/** HEAD к графике без сети: отвечаем заголовками из кэша, чтобы игра знала, что графика есть. */
async function headFromCache(req) {
  try {
    return await fetch(req);
  } catch (err) {
    const hit = await caches.match(req.url);
    if (hit) return new Response(null, { status: 200, headers: hit.headers });
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Gist и прочие чужие адреса идут мимо: сохранение без сети живёт в localStorage.
  if (url.origin !== self.location.origin) return;
  const art = url.pathname.includes('/assets-enc/');
  if (req.method === 'HEAD' && art) return e.respondWith(headFromCache(req));
  if (req.method !== 'GET') return;
  // Страница: сначала сеть, чтобы новая версия приходила сразу, без сети из кэша.
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, CACHE, './'));
  // Имена зашифрованных файлов по содержимому, только manifest.bin меняется на месте.
  if (art) return e.respondWith(url.pathname.endsWith('/manifest.bin') ? networkFirst(req, ART) : cacheFirst(req, ART));
  e.respondWith(cacheFirst(req, CACHE));
});

// Нажатие на уведомление открывает игру. Кнопка «Да, работаю» отмечается прямо в открытой
// игре, не отрывая от работы.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (e.action === 'confirm' && client) return client.postMessage({ type: 'confirm-working' });
      if (client) return client.focus();
      return self.clients.openWindow('./');
    })(),
  );
});
