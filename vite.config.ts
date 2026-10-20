import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Файлы public/, которые сервис-воркер кладёт в кэш сразу (графику WC3 он кэширует по ходу игры). */
function publicFiles(dir = 'public', prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('.') || name === 'assets-enc') return [];
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? publicFiles(path, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

/**
 * Сервис-воркер для игры без сети: после сборки кладёт рядом с index.html sw.js из
 * шаблона scripts/sw.js со списком файлов сборки и версией, которая меняется вместе с ними.
 */
function serviceWorker(): Plugin {
  return {
    name: 'taskcraft-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const extra = publicFiles();
      const files = [...new Set(['./', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...extra])].sort();
      const sizes = extra.map((f) => statSync(`public/${f}`).size).join();
      const version = createHash('sha256').update(files.join('\n') + sizes).digest('hex').slice(0, 12);
      const source = readFileSync('scripts/sw.js', 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// base: './' — чтобы сборка работала на GitHub Pages по адресу /<repo>/
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 7000 },
  plugins: [serviceWorker()],
});
