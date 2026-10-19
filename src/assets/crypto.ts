// Шифрование паролем: PBKDF2 (SHA-256) → AES-GCM.
// Тот же формат пишет scripts/encrypt-assets.mjs, поэтому менять синхронно.
// Формат блоба: [16 байт соль][12 байт IV][шифротекст с тегом].

const ITERATIONS = 200_000;
const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const cacheKey = password + ':' + Array.from(salt).join(',');
  let k = keyCache.get(cacheKey);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
        'deriveKey',
      ]);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(cacheKey, k);
  }
  return k;
}

export async function encrypt(password: string, data: Uint8Array, salt?: Uint8Array): Promise<Uint8Array> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, s);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource));
  const out = new Uint8Array(16 + 12 + ct.length);
  out.set(s, 0);
  out.set(iv, 16);
  out.set(ct, 28);
  return out;
}

/** Бросает ошибку при неверном пароле (AES-GCM проверяет целостность). */
export async function decrypt(password: string, blob: Uint8Array): Promise<Uint8Array> {
  const salt = blob.slice(0, 16);
  const iv = blob.subarray(16, 28);
  const key = await deriveKey(password, salt);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, blob.subarray(28) as BufferSource));
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
