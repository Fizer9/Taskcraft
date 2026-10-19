// Загрузка зашифрованных ассетов WC3 с сайта.
// В репозитории лежат только public/assets-enc/*.bin и зашифрованный manifest.bin,
// поэтому без пароля не видно ни файлов, ни даже их имён.
// Пока оригинальных моделей нет, сцена рисует заглушки (scene/placeholders.ts).

import { decrypt } from './crypto';
import { getPassword } from './vault';

type Manifest = Record<string, string>; // "units/human/Footman/Footman.mdx" → "a1b2c3.bin"

let manifest: Promise<Manifest | null> | null = null;
const base = import.meta.env.BASE_URL + 'assets-enc/';

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!isBinary(res)) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export function loadManifest(): Promise<Manifest | null> {
  if (!manifest) {
    manifest = (async () => {
      const pass = getPassword();
      const blob = await fetchBytes(base + 'manifest.bin').catch(() => null);
      if (!pass || !blob) return null;
      const json = new TextDecoder().decode(await decrypt(pass, blob));
      return JSON.parse(json) as Manifest;
    })();
  }
  return manifest;
}

/** Есть ли на сайте зашифрованные ассеты вообще (до ввода пароля). */
export async function encryptedAssetsAvailable(): Promise<boolean> {
  const res = await fetch(base + 'manifest.bin', { method: 'HEAD' }).catch(() => null);
  return !!res && isBinary(res);
}

/** Dev-сервер и Pages на несуществующий файл могут отдать HTML-страницу. */
function isBinary(res: Response): boolean {
  return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
}

/** Проверка пароля на манифесте; true если пароль подошёл. */
export async function checkAssetPassword(pass: string): Promise<boolean> {
  const blob = await fetchBytes(base + 'manifest.bin').catch(() => null);
  if (!blob) return true;
  try {
    await decrypt(pass, blob);
    return true;
  } catch {
    return false;
  }
}

/** Байты оригинального файла по его пути внутри архива WC3, или null если его нет. */
export async function loadAsset(path: string): Promise<Uint8Array | null> {
  const m = await loadManifest();
  const pass = getPassword();
  const file = m?.[path.replace(/\\/g, '/').toLowerCase()];
  if (!m || !file || !pass) return null;
  const blob = await fetchBytes(base + file);
  return blob ? decrypt(pass, blob) : null;
}

/**
 * Файл WC3 из зашифрованных ассетов, а в режиме разработки ещё и открытый из assets-src/
 * (vite отдаёт его напрямую, в сборку для сайта эта папка не попадает).
 */
export async function loadArt(path: string): Promise<Uint8Array | null> {
  const bytes = await loadAsset(path).catch(() => null);
  if (bytes || !import.meta.env.DEV) return bytes;
  const res = await fetch(`${import.meta.env.BASE_URL}assets-src/${path}`).catch(() => null);
  return res && isBinary(res) ? new Uint8Array(await res.arrayBuffer()) : null;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', glb: 'model/gltf-binary' };

/** То же, что loadArt, но в виде адреса blob:, который можно поставить в CSS или <img>. */
export async function artUrl(path: string): Promise<string | null> {
  const bytes = await loadArt(path);
  if (!bytes) return null;
  const type = MIME[path.split('.').pop() ?? ''] ?? 'application/octet-stream';
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
}
