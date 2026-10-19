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
}

# Консоль людей: четыре тайла по ширине образуют центр экрана 4:3, их высота — вся высота экрана.
# Боковые части для широких экранов (стена со знамёнами) есть только на эталонной картинке
# «human console.jpg», поэтому края берём с неё, а прозрачность восстанавливаем по яркости.
CONSOLE_TILES = ['humanuitile01', 'humanuitile02', 'humanuitile03', 'humanuitile04']
REF_CORE = (542, 3698)  # где центр 4:3 лежит на эталонной картинке (подобрано сравнением)
CONSOLE_HEIGHT = 768


def load(root, rel):
    for mod in ('_de.w3mod', '_hd.w3mod', ''):
        for ext in ('.dds', '.png', '.jpg'):
            p = os.path.join(root, mod, rel + ext)
            if os.path.exists(p):
                im = Image.open(p)
                im.load()
                return im.convert('RGBA')
    sys.exit('Нет файла %s (проверь выгрузку CascView)' % rel)


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='work/war3.w3mod')
    ap.add_argument('--out', default='assets-src')
    args = ap.parse_args()

    for name in TERRAIN:
        im = load(args.root, 'terrainart/lordaeronsummer/%s_diffuse' % name)
        save(im.resize((1024, 512), Image.LANCZOS), os.path.join(args.out, 'terrain', name + '.png'))
    for rel, (name, size) in UI_FILES.items():
        im = load(args.root, rel)
        if max(im.size) > size:
            k = size / max(im.size)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        save(im, os.path.join(args.out, 'ui', name + '.png'))
    for rel, name in FRAMES.items():
        save(build_frame(load(args.root, rel)), os.path.join(args.out, 'ui', name + '.png'))
    build_console(args.root, args.out)


if __name__ == '__main__':
    main()
