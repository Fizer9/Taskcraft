// Иконки команд WC3 (replaceabletextures/commandbuttons/btn<имя>), собранные в один атлас
// ui/btn-atlas.png по 8 в ряд в этом порядке. Порядок читает и scripts/build-art.py, поэтому
// новые иконки добавляются в конец списка, а атлас пересобирается.

export const BTN_ICONS = [
  'scroll', 'move', 'sleep', 'backtowork', 'calltoarms', 'farm', 'humanbuild', 'townhall', 'repair', 'tome',
  'crystalball', 'elunesblessing', 'replenishmana', 'glyph', 'humanlumbermill', 'keep', 'workshop',
  'blacksmith', 'guardtower', 'castle', 'gryphonaviary', 'arcanevault', 'humanarmorupone', 'humanarmoruptwo',
  'humanarmorupthree', 'steelmelee', 'thoriummelee', 'arcanitemelee', 'cancel', 'stormbolt', 'thunderclap',
  'bash', 'avatar', 'holybolt', 'divineintervention', 'devotion', 'resurrection', 'blizzard',
  'summonwaterelemental', 'brilliance', 'massteleport', 'walloffire', 'banish', 'manadrain', 'markoffire',
  'skillz', 'altarofkings', 'heromountainking', 'heropaladin', 'heroarchmage', 'herobloodelfprince', 'peasant',
  'herodreadlord', 'chestofgold', 'attack', 'stop', 'footman', 'rifleman', 'knight', 'gryphonrider', 'slow',
  'defend',
] as const;

export type BtnIcon = (typeof BTN_ICONS)[number];

/** Иконок в ряду атласа. */
export const BTN_COLUMNS = 8;

/**
 * Иконка из атласа поверх кнопки. Она видна, только когда атлас загружен (body.art-btn-atlas),
 * а до этого и без пароля на кнопке остаётся значок-символ.
 */
export function btnArt(name: BtnIcon): string {
  const i = BTN_ICONS.indexOf(name);
  const rows = Math.ceil(BTN_ICONS.length / BTN_COLUMNS);
  const x = ((i % BTN_COLUMNS) / (BTN_COLUMNS - 1)) * 100;
  const y = (Math.floor(i / BTN_COLUMNS) / (rows - 1)) * 100;
  return `<i class="btn-art" style="background-position:${x.toFixed(2)}% ${y.toFixed(2)}%;background-size:${BTN_COLUMNS * 100}% ${rows * 100}%"></i>`;
}
