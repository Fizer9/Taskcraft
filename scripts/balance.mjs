// Симуляция баланса (tests/balance.sim.ts): npm run balance [дней].
// Собирается тем же esbuild, что и тесты, и запускается обычным node.

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(tmpdir(), 'taskcraft-balance.mjs');
await build({ entryPoints: ['tests/balance.sim.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });
const res = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, TZ: 'UTC' } });
process.exit(res.status ?? 1);
