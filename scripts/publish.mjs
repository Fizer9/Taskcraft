// Выкладка на сайт одной командой: npm run publish -- "что поменялось"
// Спрашивает пароль (не показывая его), проверяет его на уже зашифрованных ассетах,
// шифрует assets-src/ заново, затем git add, commit и push.

import { execFileSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const message = process.argv.slice(2).join(' ') || 'Обновление Taskcraft';
const MANIFEST = 'public/assets-enc/manifest.bin';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** Тот же формат, что в encrypt-assets.mjs и src/assets/crypto.ts: [16 соль][12 IV][шифр + 16 тег]. */
function passwordFits(password) {
  if (!existsSync(MANIFEST)) return true;
  const blob = readFileSync(MANIFEST);
  const key = pbkdf2Sync(password, blob.subarray(0, 16), 200_000, 32, 'sha256');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(16, 28));
  d.setAuthTag(blob.subarray(blob.length - 16));
  try {
    d.update(blob.subarray(28, blob.length - 16));
    d.final();
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args) {
  console.log('> ' + [cmd, ...args].join(' '));
  try {
    execFileSync(cmd, args, { stdio: 'inherit' });
  } catch {
    console.error(`Команда «${cmd} ${args[0]}» не прошла, остальное не делаю. Сообщение git выше.`);
    process.exit(1);
  }
}

const password = await askHidden('Пароль от графики: ');
if (!password) process.exit(1);
if (!passwordFits(password)) {
  console.error('Пароль не подходит к тому, чем уже зашифрован сайт. Ничего не менял.');
  process.exit(1);
}
console.log('> шифрую assets-src/');
execFileSync(process.execPath, ['scripts/encrypt-assets.mjs', password], { stdio: 'inherit' });
run('git', ['add', '-A']);
const staged = execFileSync('git', ['diff', '--cached', '--name-only']).toString().trim();
if (staged) run('git', ['commit', '-m', message]);
else console.log('Новых изменений нет, просто отправляю.');
run('git', ['push']);
console.log('Готово. Сайт обновится, когда GitHub закончит сборку (вкладка Actions).');
