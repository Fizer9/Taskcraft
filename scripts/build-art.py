#!/usr/bin/env python3
"""Готовит текстуры земли и интерфейса WC3 (Definitive Edition) для игры.

    python scripts/build-art.py --root work/war3.w3mod

Берёт файлы из выгрузки CascView и пишет PNG в assets-src/ (папка в .gitignore):
  assets-src/terrain/<тайл>.png  — атласы земли Лордерона 1024×512 (8×4 клетки по 128 px);
  assets-src/ui/console.png      — рамка интерфейса людей целиком (верхняя полоса и консоль);
  assets-src/ui/*.png            — иконки ресурсов, фоны и рамки окон, подсказок и кнопок.
Дальше их, как и модели, шифрует npm run encrypt-assets.

Нужны Pillow и numpy: python -m pip install pillow numpy
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

TERRAIN = ['lords_dirt', 'lords_dirtrough', 'lords_dirtgrass', 'lords_rock', 'lords_grass', 'lords_grassdark']

# Иконки и фоны интерфейса: имя в игре → имя в assets-src/ui и размер.
UI_FILES = {
    'ui/widgets/tooltips/human/tooltipgoldicon': ('gold', 64),
    'ui/widgets/tooltips/human/tooltiplumbericon': ('lumber', 64),
    'ui/widgets/tooltips/human/tooltipsupplyicon': ('supply', 64),
    'ui/widgets/tooltips/human/human-tooltip-background': ('tooltip-bg', 256),
    'ui/widgets/escmenu/human/human-options-menu-background': ('menu-bg', 512),
    'ui/widgets/escmenu/human/human-options-button-highlight': ('button-highlight', 512),
    'ui/widgets/escmenu/human/human-options-button-background-disabled': ('button-bg', 256),
    'ui/widgets/console/human/human-activebutton': ('cmd-active', 128),
    # Солнечные часы: лента «солнце — луна — солнце», она едет за круглым окошком консоли.
    'ui/console/human/humanuitile-timeindicator': ('timeindicator', 256),
    # Карточка выбранного: атака, броня, характеристики героя, золото и еда.
    'ui/widgets/console/human/infocard-attack-melee': ('ic-attack-melee', 64),
    'ui/widgets/console/human/infocard-attack-piercing': ('ic-attack-piercing', 64),
    'ui/widgets/console/human/infocard-attack-hero': ('ic-attack-hero', 64),
    'ui/widgets/console/human/infocard-attack-chaos': ('ic-attack-chaos', 64),
    'ui/widgets/console/human/infocard-armor-medium': ('ic-armor-medium', 64),
    'ui/widgets/console/human/infocard-armor-large': ('ic-armor-large', 64),
    'ui/widgets/console/human/infocard-armor-hero': ('ic-armor-hero', 64),
    'ui/widgets/console/human/infocard-armor-fortified': ('ic-armor-fortified', 64),
    'ui/widgets/console/human/infocard-heroattributes-str': ('ic-str', 64),
    'ui/widgets/console/human/infocard-heroattributes-agi': ('ic-agi', 64),
    'ui/widgets/console/human/infocard-heroattributes-int': ('ic-int', 64),
    'ui/widgets/console/human/infocard-gold': ('ic-gold', 64),
    'ui/widgets/console/human/infocard-supply': ('ic-supply', 64),
    # Ячейки инвентаря, очередь найма и кнопки у мини-карты.
    'ui/widgets/console/human/human-inventory-slotfiller': ('slot-filler', 128),
    'ui/widgets/console/human/human-unitqueue-border': ('queue-border', 256),
    'ui/widgets/console/human/human-minimap-ping-active': ('mm-ping', 32),
    'ui/widgets/console/human/human-minimap-terrain-active': ('mm-terrain', 32),
    'ui/widgets/console/human/human-minimap-terrain-inactive': ('mm-terrain-off', 32),
    'ui/widgets/console/human/human-minimap-ally-active': ('mm-ally', 32),
    'ui/widgets/console/human/human-minimap-creep-active': ('mm-creep', 32),
    'ui/widgets/console/human/human-formation-on': ('mm-formation', 32),
    # Полоска стройки и найма.
    'ui/feedback/buildprogressbar/human-buildprogressbar-border': ('progress-border', 256),
    'ui/feedback/buildprogressbar/human-buildprogressbar-fill': ('progress-fill', 256),
    # Меню: галочки, ползунки, журнал заданий.
    'ui/widgets/escmenu/human/checkbox-background': ('checkbox', 64),
    'ui/widgets/escmenu/human/checkbox-check': ('checkbox-check', 64),
    'ui/widgets/escmenu/human/checkbox-depressed': ('checkbox-down', 64),
    'ui/widgets/escmenu/human/slider-knob': ('slider-knob', 64),
    'ui/widgets/escmenu/human/quest-normal-background': ('quest-normal', 512),
    'ui/widgets/escmenu/human/quest-completed-background': ('quest-done', 512),
    'ui/widgets/escmenu/human/quest-failed-background': ('quest-failed', 512),
    'ui/widgets/escmenu/human/quest-unknown': ('quest-icon', 128),
    # Монета над ратушей при добыче.
    'ui/feedback/resources/resourcegold': ('coin', 64),
}

# Текстуры эффектов сцены: тени, свечение героя, луч нового уровня, капли дождя, вода, скверна.
FX_FILES = {
    'textures/shadow': ('shadow', 128),
    'textures/teamglow0000': ('teamglow', 64),
    'textures/holyshaft': ('holyshaft', 256),
    'textures/raintail': ('raintail', 64),
    'textures/water/war3_waterintense_0000_normal': ('water-normal', 256),
    'terrainart/blight/lords_blight_diffuse': ('lords_blight', 1024),
}

# Консоль людей: четыре тайла по ширине образуют центр экрана 4:3, их высота — вся высота экрана.
# Боковые части для широких экранов (стена со знамёнами) есть только на эталонной картинке
# «human console.jpg», поэтому края берём с неё, а прозрачность восстанавливаем по яркости.
CONSOLE_TILES = ['humanuitile01', 'humanuitile02', 'humanuitile03', 'humanuitile04']
REF_CORE = (542, 3698)  # где центр 4:3 лежит на эталонной картинке (подобрано сравнением)
CONSOLE_HEIGHT = 768


MISSING = []


class Missing(Exception):
    pass


def load(root, rel):
    for mod in ('_de.w3mod', '_hd.w3mod', ''):
        for ext in ('.dds', '.png', '.jpg'):
            p = os.path.join(root, mod, rel + ext)
            if os.path.exists(p):
                im = Image.open(p)
                im.load()
                return im.convert('RGBA')
    MISSING.append(rel)
    raise Missing(rel)


def fit(im, size):
    if max(im.size) > size:
        k = size / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    return im


def fix_normal(im):
    """Карты нормалей HD хранят только X и Y (синий канал пуст): восстанавливаем Z для Babylon."""
    a = np.asarray(im).astype(np.float32) / 127.5 - 1
    z = np.sqrt(np.clip(1 - a[..., 0] ** 2 - a[..., 1] ** 2, 0, 1))
    out = np.asarray(im).copy()
    out[..., 2] = ((z + 1) * 127.5).astype(np.uint8)
    out[..., 3] = 255
    return Image.fromarray(out, 'RGBA')


def glow_alpha(im):
    """Свечение героя в WC3 хранится яркостью в красном канале при сплошной альфе:
    делаем белую текстуру с прозрачностью по этой яркости, цвет задаёт материал."""
    r = np.asarray(im.convert('RGBA'))[..., 0].astype(np.float32)
    a = np.clip(r / max(1.0, r.max()) * 255, 0, 255).astype(np.uint8)
    out = np.full(a.shape + (4,), 255, np.uint8)
    out[..., 3] = a
    return Image.fromarray(out, 'RGBA')


def fx_image(name, im):
    if name.endswith('normal'):
        return fix_normal(im)
    if name == 'teamglow':
        return glow_alpha(im)
    return im


def build_cursor(root, out):
    """Курсор WC3: перчатка (первая клетка листа 8×4) обычная, красная над врагом и зелёная над своим."""
    sheet = load(root, 'ui/cursor/humancursor')
    cell = sheet.width // 8
    hand = sheet.crop((0, 0, cell, cell)).resize((40, 40), Image.LANCZOS)
    save(hand, os.path.join(out, 'ui', 'cursor.png'))
    a = np.asarray(hand).astype(np.float32)
    for name, tint in (('cursor-enemy', (1.0, 0.35, 0.3)), ('cursor-own', (0.45, 1.0, 0.4))):
        b = a.copy()
        lum = b[..., :3].mean(-1, keepdims=True)
        b[..., :3] = np.clip(lum * np.array(tint) * 1.25, 0, 255)
        save(Image.fromarray(b.astype(np.uint8), 'RGBA'), os.path.join(out, 'ui', name + '.png'))


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, optimize=True)
    print('  %s %dx%d' % (path, im.width, im.height))


# Рамки окон в WC3 хранятся лентой из 8 квадратов: левый край, правый, верхний и нижний
# (повёрнуты на 90°), затем углы: верхний левый, верхний правый, нижний левый, нижний правый.
# Собираем из них картинку 3×3 для CSS border-image.
FRAMES = {
    'ui/widgets/escmenu/human/human-options-menu-border': 'menu-frame',
    'ui/widgets/tooltips/human/human-tooltip-border': 'tooltip-frame',
    'ui/widgets/escmenu/human/editbox-border': 'editbox-frame',
    'ui/widgets/escmenu/human/human-options-button-border-up': 'button-frame',
    'ui/widgets/escmenu/human/human-options-button-border-down': 'button-frame-down',
}


def build_frame(im):
    """Возвращает картинку (k+c+k)² для border-image со срезом k: камень рамки занимает
    только внешние ~3/8 квадрата, остальное прозрачно, его обрезаем."""
    c = im.height
    k = round(c * 0.375)
    seg = [im.crop((i * c, 0, (i + 1) * c, c)) for i in range(8)]
    left, right, top, bottom, tl, tr, bl, br = seg
    top = top.transpose(Image.ROTATE_270)
    bottom = bottom.transpose(Image.ROTATE_270)
    n = c + 2 * k
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(tl.crop((0, 0, k, k)), (0, 0))
    out.paste(tr.crop((c - k, 0, c, k)), (n - k, 0))
    out.paste(bl.crop((0, c - k, k, c)), (0, n - k))
    out.paste(br.crop((c - k, c - k, c, c)), (n - k, n - k))
    out.paste(top.crop((0, 0, c, k)), (k, 0))
    out.paste(bottom.crop((0, c - k, c, c)), (k, n - k))
    out.paste(left.crop((0, 0, k, c)), (0, k))
    out.paste(right.crop((c - k, 0, c, c)), (n - k, k))
    return out


def build_console(root, out):
    tiles = [load(root, 'ui/console/human/' + n) for n in CONSOLE_TILES]
    core_w = sum(t.width for t in tiles)
    ref = load(root, 'ui/console/human/human console')
    k = core_w / (REF_CORE[1] - REF_CORE[0])
    ref = ref.resize((round(ref.width * k), 1024), Image.LANCZOS)
    left = round(REF_CORE[0] * k)
    right = ref.width - left - core_w

    a = np.asarray(ref).copy()
    lum = a[..., :3].max(-1).astype(np.float32)
    alpha = np.zeros(lum.shape, np.float32)
    alpha[:96] = 1  # верхняя полоса
    band = slice(360, 440)  # зубцы стены: прозрачно там, где чёрный фон
    alpha[band] = np.clip((lum[band] - 8) / 20, 0, 1)
    alpha[440:] = 1
    a[..., 3] = (alpha * 255).astype(np.uint8)
    full = Image.fromarray(a, 'RGBA')

    x = left
    for t in tiles:
        full.paste(Image.new('RGBA', t.size, (0, 0, 0, 0)), (x, 0))
        full.alpha_composite(t, (x, 0))
        x += t.width
    full = full.resize((round(full.width * CONSOLE_HEIGHT / 1024), CONSOLE_HEIGHT), Image.LANCZOS)
    save(full, os.path.join(out, 'ui', 'console.png'))
    print('  консоль: слева %d, центр %d, справа %d (px исходника 1024 в высоту)' % (left, core_w, right))


def build_selection(root, out):
    """Круг выделения: в игре он хранится четвертью кольца, собираем целый, белый (цвет задаёт сцена)."""
    q = load(root, 'ui/feedback/selectioncircleunit/selectioncircleunit_basecolor')
    w, h = q.size
    full = Image.new('RGBA', (w * 2, h * 2))
    full.paste(q, (0, 0))
    full.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    full.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    full.paste(q.transpose(Image.ROTATE_180), (w, h))
    save(full, os.path.join(out, 'ui', 'selection.png'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='work/war3.w3mod')
    ap.add_argument('--out', default='assets-src')
    args = ap.parse_args()

    # Чего нет в выгрузке, пропускаем с предупреждением в конце: остальное соберётся.
    def step(fn):
        try:
            fn()
        except Missing:
            pass

    for name in TERRAIN:
        step(lambda: save(load(args.root, 'terrainart/lordaeronsummer/%s_diffuse' % name).resize((1024, 512), Image.LANCZOS),
                          os.path.join(args.out, 'terrain', name + '.png')))
    for rel, (name, size) in UI_FILES.items():
        step(lambda: save(fit(load(args.root, rel), size), os.path.join(args.out, 'ui', name + '.png')))
    for rel, (name, size) in FX_FILES.items():
        step(lambda: save(fx_image(name, fit(load(args.root, rel), size)),
                          os.path.join(args.out, 'terrain' if name.endswith('blight') else 'fx', name + '.png')))
    for rel, name in FRAMES.items():
        step(lambda: save(build_frame(load(args.root, rel)), os.path.join(args.out, 'ui', name + '.png')))
    step(lambda: build_console(args.root, args.out))
    step(lambda: build_selection(args.root, args.out))
    step(lambda: build_cursor(args.root, args.out))
    if MISSING:
        print('Нет в выгрузке (пропущено): ' + ', '.join(MISSING), file=sys.stderr)


if __name__ == '__main__':
    main()
