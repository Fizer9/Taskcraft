// Экономия батареи: сколько кадров рисуется и когда 3D переходит на меньшее разрешение.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FPS, MAX_SCALE, Pacer } from '../src/scene/pacer';

function host(covered = false) {
  const h = { covered: () => covered, scales: [] as number[], setScale: (l: number) => h.scales.push(l), cover: (c: boolean) => (covered = c) };
  return h;
}

/** Гоняет экран 60 Гц ms миллисекунд; render: сколько мс уходит на кадр (медленный телефон). */
function run(p: Pacer, from: number, ms: number, render = 0) {
  const tick = 1000 / 60;
  const busy = Math.max(1, Math.ceil(render / tick)); // столько кадров экрана занимает отрисовка
  let drawn = 0;
  for (let i = 0; i < Math.round(ms / tick); ) {
    const dt = p.frame(from + i * tick);
    if (dt !== null) drawn++;
    i += dt !== null ? busy : 1;
  }
  return drawn;
}

describe('частота кадров', () => {
  test('на телефоне в покое 30, после касания 60, под окном 15', () => {
    const h = host();
    const p = new Pacer(h, true, false);
    assert.equal(run(p, 0, 1000), FPS.idlePhone);
    p.poke(1000);
    assert.equal(run(p, 1000, 1000), FPS.active);
    h.cover(true);
    assert.equal(run(p, 2000, 1000), FPS.covered);
  });

  test('на компьютере всегда 60, кроме окна поверх карты', () => {
    const h = host();
    const p = new Pacer(h, false, false);
    assert.equal(run(p, 0, 1000), 60);
    h.cover(true);
    assert.equal(run(p, 1000, 1000), 15);
  });

  test('шаг времени для игры равен паузе между нарисованными кадрами', () => {
    const p = new Pacer(host(), true, false);
    p.frame(0);
    assert.equal(p.frame(1000 / 60), null);
    assert.ok(Math.abs(p.frame(2000 / 60)! - 1 / 30) < 1e-9);
  });
});

describe('разрешение 3D', () => {
  test('медленный телефон рисует 3D в меньшем разрешении, но не меньше половины', () => {
    const h = host();
    const p = new Pacer(h, true, true);
    // Кадр рисуется 60 мс: вместо 30 кадров выходит меньше 17.
    run(p, 0, 60_000, 60);
    assert.deepEqual(h.scales, [1.25, 1.5, 1.75, 2]);
    assert.equal(p.scale, MAX_SCALE);
  });

  test('быстрый телефон разрешение не трогает', () => {
    const h = host();
    run(new Pacer(h, true, true), 0, 30_000, 10);
    assert.deepEqual(h.scales, []);
  });

  test('пока грузится, карту трогают или она под окном, скорость не меряется', () => {
    const h = host(true);
    const p = new Pacer(h, true, true);
    run(p, 0, 20_000, 120);
    h.cover(false);
    for (let t = 20_000; t < 40_000; t += 500) p.poke(t);
    run(p, 20_000, 20_000, 60);
    assert.deepEqual(h.scales, []);
  });
});
