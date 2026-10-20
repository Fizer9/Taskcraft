// Автотесты экономики и действий игрока: npm test.
// Тесты лежат в tests/*.test.ts. esbuild (он и так ставится вместе с vite) собирает каждый
// в один файл без типов, а запускает их встроенный в Node раннер (node --test). Часовой
// пояс фиксирован, а время внутри тестов подменяется, так что результат не зависит от того,
// когда и где их запускают.

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Не в node_modules: оттуда node --test файлы не берёт.
const out = join(tmpdir(), 'taskcraft-tests');
const names = readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !process.argv[2] || f.includes(process.argv[2]));
rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: names.map((f) => `tests/${f}`),
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});
const files = names.map((f) => join(out, f.replace(/\.ts$/, '.mjs')));
const res = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=spec', ...files], { stdio: 'inherit', env: { ...process.env, TZ: 'UTC' } });
process.exit(res.status ?? 1);
