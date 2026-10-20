# Иконка Taskcraft: синий щит альянса с золотой каймой и мечом на тёмном камне.
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
S = 1024
def shield(d, cx, top, w, h, fill):
    pts = [(cx - w/2, top), (cx + w/2, top), (cx + w/2, top + h*0.55), (cx, top + h), (cx - w/2, top + h*0.55)]
    d.polygon(pts, fill=fill)
def icon(scale):
    im = Image.new('RGB', (S, S), '#15130f')
    d = ImageDraw.Draw(im)
    # Камень: лёгкие полосы.
    for i in range(0, S, 32):
        d.line([(i, 0), (0, i)], fill='#1d1913', width=6)
        d.line([(S, S - i), (S - i, S)], fill='#1d1913', width=6)
    cx, w, h = S/2, S*0.62*scale, S*0.72*scale
    top = (S - h)/2
    shield(d, cx, top, w, h, '#6e5422')
    shield(d, cx, top + 18*scale, w - 36*scale, h - 40*scale, '#ffd34d')
    shield(d, cx, top + 40*scale, w - 80*scale, h - 88*scale, '#2f4f9e')
    # Меч: клинок, гарда, рукоять, навершие.
    bw = 44*scale
    d.polygon([(cx - bw/2, top + 120*scale), (cx + bw/2, top + 120*scale), (cx + bw/2, top + h*0.72), (cx, top + h*0.8), (cx - bw/2, top + h*0.72)], fill='#e8e4dc')
    d.rectangle([cx - 4*scale, top + 130*scale, cx + 4*scale, top + h*0.72], fill='#b9b3a6')
    d.rectangle([cx - 150*scale, top + 210*scale, cx + 150*scale, top + 250*scale], fill='#ffd34d')
    d.rectangle([cx - 20*scale, top + 60*scale, cx + 20*scale, top + 210*scale], fill='#8a5a2a')
    d.ellipse([cx - 34*scale, top + 34*scale, cx + 34*scale, top + 100*scale], fill='#ffd34d')
    return im
for name, size, scale in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.78), ('apple-touch-icon.png', 180, 0.9)]:
    icon(scale).resize((size, size), Image.LANCZOS).save(f'{out}/{name}')
print('ok')
