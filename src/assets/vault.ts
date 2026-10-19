// Один пароль открывает всё: зашифрованные ассеты WC3 и токен от Gist.
// Сам пароль нигде не хранится, только в памяти вкладки.

import { decrypt, encrypt, fromBase64, toBase64 } from './crypto';

const TOKEN_KEY = 'taskcraft.vault.token';
const GIST_KEY = 'taskcraft.gistId';

let password: string | null = null;

export function setPassword(p: string) {
  password = p;
}

export function getPassword(): string | null {
  return password;
}

export function hasStoredToken(): boolean {
  return safeGet(TOKEN_KEY) !== null;
}

export function getGistId(): string | null {
  return safeGet(GIST_KEY);
}

export function setGistId(id: string | null) {
  safeSet(GIST_KEY, id);
}

export async function saveToken(token: string, pass: string) {
  const blob = await encrypt(pass, new TextEncoder().encode(token));
  safeSet(TOKEN_KEY, toBase64(blob));
}

/** Возвращает токен или null; бросает ошибку при неверном пароле. */
export async function loadToken(pass: string): Promise<string | null> {
  const raw = safeGet(TOKEN_KEY);
  if (!raw) return null;
  const bytes = await decrypt(pass, fromBase64(raw));
  return new TextDecoder().decode(bytes);
}

export function forgetToken() {
  safeSet(TOKEN_KEY, null);
  safeSet(GIST_KEY, null);
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* приватный режим: просто не запоминаем */
  }
}
