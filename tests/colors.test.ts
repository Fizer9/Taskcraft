// Цвет базы: у каждой базы проекта свой цвет игрока WC3, главная ратуша синяя.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignColors, projectColor, TEAM_COLORS } from '../src/state/colors';
import { MAIN_HALL_ID } from '../src/state/types';
import { newGame } from './helpers';

const colorsOf = (store: ReturnType<typeof newGame>) => store.state.projects.map((p) => p.color);

test('у каждой базы свой цвет, у главной синий', () => {
  const store = newGame();
  const sphere = store.state.spheres[0].id;
  for (let i = 0; i < 5; i++) store.createProject(`Проект ${i}`, sphere, 'any');
  const colors = colorsOf(store);
  assert.equal(new Set(colors).size, colors.length);
  assert.equal(store.state.projects.find((p) => p.id === MAIN_HALL_ID)!.color, 0);
  assert.equal(projectColor(store.state.projects.find((p) => p.id === MAIN_HALL_ID)!), TEAM_COLORS[0]);
});

test('цвет базы не меняется, освободившийся цвет достаётся новой базе', () => {
  const store = newGame();
  const sphere = store.state.spheres[0].id;
  const a = store.createProject('А', sphere, 'any');
  const b = store.createProject('Б', sphere, 'any');
  const before = b.color;
  store.deleteProject(a.id);
  assert.equal(b.color, before);
  const c = store.createProject('В', sphere, 'any');
  assert.equal(c.color, a.color);
});

test('повторившийся цвет (слияние с другого устройства) переназначается', () => {
  const store = newGame();
  const sphere = store.state.spheres[0].id;
  const a = store.createProject('А', sphere, 'any');
  const b = store.createProject('Б', sphere, 'any');
  b.color = a.color;
  store.state.projects.find((p) => p.id === MAIN_HALL_ID)!.color = 5;
  assignColors(store.state);
  const colors = colorsOf(store);
  assert.equal(new Set(colors).size, colors.length);
  assert.equal(store.state.projects.find((p) => p.id === MAIN_HALL_ID)!.color, 0);
});

test('старое сохранение без цветов получает их при загрузке', () => {
  const store = newGame((s) => s.projects.forEach((p) => delete p.color));
  const colors = colorsOf(store);
  assert.ok(colors.every((c) => typeof c === 'number'));
  assert.equal(new Set(colors).size, colors.length);
});
