// Шифрует оригинальные файлы WC3 из assets-src/ в public/assets-enc/.
//
//   npm run encrypt-assets -- "твой пароль"
//
// assets-src/ в .gitignore, в репозиторий попадают только зашифрованные .bin.
// Имена файлов тоже скрыты: путь → хеш, а таблица соответствий лежит в зашифрованном manifest.bin.
// Шифрование детерминированное (соль и IV выводятся из пароля и содержимого),
// поэтому повторный запуск не меняет уже зашифрованные файлы и не раздувает git.
// Формат совпадает с src/assets/crypto.ts: [16 соль][12 IV][AES-GCM].

import { createHash, createHmac, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const password = process.argv[2];
if (!password) {
  console.error('Использование: npm run encrypt-assets -- "пароль"');
  process.exit(1);
}

const SRC = 'assets-src';
const OUT = join('public', 'assets-enc');
const ITERATIONS = 200_000; // как в crypto.ts

if (!existsSync(SRC)) {
  console.error(`Нет папки ${SRC}/. Положи туда файлы, вытащенные из WC3, сохраняя пути архива.`);
  process.exit(1);
}

const salt = createHash('sha256').update('taskcraft-salt:' + password).digest().subarray(0, 16);
const key = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');

function encrypt(data, ivSeed) {
  const iv = createHmac('sha256', key).update(ivSeed).update(data).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([salt, iv, ct]);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

mkdirSync(OUT, { recursive: true });
const manifest = {};
let written = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split(sep).join('/').toLowerCase();
  const name = createHmac('sha256', key).update('name:' + rel).digest('hex').slice(0, 24) + '.bin';
  manifest[rel] = name;
  const out = join(OUT, name);
  const blob = encrypt(readFileSync(file), rel);
  if (!existsSync(out) || !readFileSync(out).equals(blob)) {
    writeFileSync(out, blob);
    written++;
  }
}

// Удаляем зашифрованные файлы, которых больше нет в исходниках.
const keep = new Set([...Object.values(manifest), 'manifest.bin']);
for (const f of readdirSync(OUT)) if (!keep.has(f)) unlinkSync(join(OUT, f));

writeFileSync(join(OUT, 'manifest.bin'), encrypt(Buffer.from(JSON.stringify(manifest)), 'manifest'));
console.log(`Готово: ${Object.keys(manifest).length} файлов в манифесте, перезаписано ${written}.`);
