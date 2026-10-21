#!/usr/bin/env python3
"""
Конвертер моделей Warcraft III (MDX, в том числе HD-версий 1000–1800) в glTF (.glb) для Babylon.js.

    python3 scripts/mdx2gltf.py <model.mdx> <out.glb> --root <папка war3.w3mod> [--tex-size 512]

Что переносится: геометрия, кости со скиннингом, анимации (по glTF-анимации на каждую
последовательность MDX: Stand, Walk, Attack, Walk Gold и т.д.) и PBR-материалы
(diffuse → baseColor, ORM → occlusion + metallicRoughness, normal → normal).
В extras каждой меши лежит список последовательностей, где геосет виден (мешок с золотом,
бревно и т.п.), а в extras сцены список последовательностей с длительностью.

Формат MDX 1800 (Definitive Edition, патч 3.0) не документирован. Отличия от 1100,
найденные на крестьянине: SKIN хранит по 8 uint16 на вершину (4 индекса костей + 4 веса 0..255),
у слоя материала вместо одного textureId список пар (textureId, слот).

Нужны Pillow (чтение DDS) и numpy: python3 -m pip install pillow numpy
"""

import argparse
import io
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image

# ---------- Чтение MDX ----------

TRACK_SIZES = {
    b'KGTR': 3, b'KGRT': 4, b'KGSC': 3,  # узлы: перенос, поворот, масштаб
    b'KGAO': 1, b'KGAC': 3,  # анимация геосета: прозрачность, цвет
    b'KATV': 1,  # видимость точки крепления
}

SKIP_SEQUENCES = ('decay', 'cinematic', 'portrait')


class Reader:
    def __init__(self, data, pos=0):
        self.d = data
        self.p = pos

    def u32(self):
        v = struct.unpack_from('<I', self.d, self.p)[0]
        self.p += 4
        return v

    def i32(self):
        v = struct.unpack_from('<i', self.d, self.p)[0]
        self.p += 4
        return v

    def f32s(self, n):
        v = struct.unpack_from('<%df' % n, self.d, self.p)
        self.p += 4 * n
        return list(v)

    def tag(self):
        t = self.d[self.p:self.p + 4]
        self.p += 4
        return t

    def peek(self):
        return self.d[self.p:self.p + 4]

    def string(self, n):
        s = self.d[self.p:self.p + n].split(b'\0')[0].decode('utf-8', 'replace')
        self.p += n
        return s


def read_track(r):
    tag = r.tag()
    n = TRACK_SIZES[tag]
    count, interp, gseq = r.u32(), r.u32(), r.i32()
    keys = []
    for _ in range(count):
        frame = r.i32()
        value = r.f32s(n)
        if interp > 1:
            r.f32s(2 * n)  # касательные Hermite/Bezier: упрощаем до линейной интерполяции
        keys.append((frame, value))
    return tag, {'interp': interp, 'gseq': gseq, 'keys': keys}


def read_node(r):
    start = r.p
    size = r.u32()
    node = {'name': r.string(80), 'id': r.i32(), 'parent': r.i32(), 'flags': r.u32(), 'tracks': {}}
    while r.p < start + size:
        tag, track = read_track(r)
        node['tracks'][tag] = track
    r.p = start + size
    return node


def parse_mdx(data):
    if data[:4] != b'MDLX':
        raise ValueError('не MDX файл')
    chunks = {}
    p = 4
    while p < len(data):
        tag = data[p:p + 4].decode('ascii', 'replace')
        size = struct.unpack_from('<I', data, p + 4)[0]
        chunks[tag] = (p + 8, size)
        p += 8 + size

    m = {'version': struct.unpack_from('<I', data, chunks['VERS'][0])[0]}
    v = m['version']

    m['sequences'] = []
    if 'SEQS' in chunks:
        o, n = chunks['SEQS']
        for k in range(n // 132):
            r = Reader(data, o + k * 132)
            name = r.string(80)
            start, end = r.u32(), r.u32()
            r.f32s(1)
            flags = r.u32()
            m['sequences'].append({'name': name, 'start': start, 'end': end, 'loop': flags & 1 == 0})

    m['globalSequences'] = []
    if 'GLBS' in chunks:
        o, n = chunks['GLBS']
        m['globalSequences'] = list(struct.unpack_from('<%dI' % (n // 4), data, o))

    m['textures'] = []
    if 'TEXS' in chunks:
        o, n = chunks['TEXS']
        for k in range(n // 268):
            r = Reader(data, o + k * 268)
            rid = r.u32()
            path = r.string(260)
            m['textures'].append({'replaceable': rid, 'path': path})

    m['materials'] = []
    if 'MTLS' in chunks:
        o, n = chunks['MTLS']
        r = Reader(data, o)
        while r.p < o + n:
            mstart = r.p
            msize = r.u32()
            r.u32()  # priority plane
            r.u32()  # flags
            if v > 800 and v < 1200 and r.peek() != b'LAYS':
                r.string(80)  # имя шейдера в 900–1100
            assert r.tag() == b'LAYS', 'ожидался LAYS'
            layers = []
            for _ in range(r.u32()):
                lstart = r.p
                lsize = r.u32()
                filt, shading, tex_id, _tex_anim, _coord = r.u32(), r.u32(), r.u32(), r.i32(), r.u32()
                alpha = r.f32s(1)[0]
                slots = {0: tex_id}
                if v >= 1800:
                    r.f32s(5)  # emissiveGain, fresnelColor[3], fresnelOpacity
                    r.f32s(1)  # fresnelTeamColor
                    r.u32()  # неизвестное поле
                    for _ in range(r.u32()):
                        tid, slot = r.u32(), r.u32()
                        slots[slot] = tid
                layers.append({'filter': filt, 'shading': shading, 'alpha': alpha, 'slots': slots})
                r.p = lstart + lsize
            m['materials'].append({'layers': layers})
            r.p = mstart + msize

    m['geosets'] = []
    if 'GEOS' in chunks:
        o, n = chunks['GEOS']
        r = Reader(data, o)
        while r.p < o + n:
            gstart = r.p
            gsize = r.u32()
            g = {'uvs': []}
            while r.p < gstart + gsize:
                tag = r.tag()
                if tag == b'VRTX':
                    c = r.u32()
                    g['positions'] = r.f32s(3 * c)
                elif tag == b'NRMS':
                    c = r.u32()
                    g['normals'] = r.f32s(3 * c)
                elif tag in (b'PTYP', b'PCNT', b'MTGC'):
                    c = r.u32()
                    g[tag.decode()] = list(struct.unpack_from('<%dI' % c, data, r.p))
                    r.p += 4 * c
                elif tag == b'PVTX':
                    c = r.u32()
                    g['faces'] = list(struct.unpack_from('<%dH' % c, data, r.p))
                    r.p += 2 * c
                elif tag == b'GNDX':
                    c = r.u32()
                    g['groups'] = list(data[r.p:r.p + c])
                    r.p += c
                elif tag == b'MATS':
                    c = r.u32()
                    g['matrices'] = list(struct.unpack_from('<%dI' % c, data, r.p))
                    r.p += 4 * c
                    g['material'] = r.u32()
                    r.u32()  # selection group
                    r.u32()  # selection flags
                    if v > 800:
                        g['lod'] = r.u32()
                        g['name'] = r.string(80)
                    r.f32s(7)  # extent
                    extents = r.u32()
                    r.p += 28 * extents
                elif tag == b'TANG':
                    c = r.u32()
                    g['tangents'] = r.f32s(4 * c)
                elif tag == b'SKIN':
                    c = r.u32()
                    if v >= 1800:
                        g['skin'] = list(struct.unpack_from('<%dH' % c, data, r.p))
                        r.p += 2 * c
                    else:
                        g['skin'] = list(data[r.p:r.p + c])
                        r.p += c
                elif tag == b'UVAS':
                    r.u32()
                elif tag == b'UVBS':
                    c = r.u32()
                    g['uvs'].append(r.f32s(2 * c))
                else:
                    raise ValueError('неизвестный блок геосета %r' % tag)
            r.p = gstart + gsize
            m['geosets'].append(g)

    m['geosetAnims'] = []
    if 'GEOA' in chunks:
        o, n = chunks['GEOA']
        r = Reader(data, o)
        while r.p < o + n:
            start = r.p
            size = r.u32()
            alpha = r.f32s(1)[0]
            r.u32()
            r.f32s(3)
            geoset = r.u32()
            tracks = {}
            while r.p < start + size:
                tag, track = read_track(r)
                tracks[tag] = track
            m['geosetAnims'].append({'geoset': geoset, 'alpha': alpha, 'tracks': tracks})
            r.p = start + size

    m['nodes'] = {}
    for tag in ('BONE', 'HELP'):
        if tag in chunks:
            o, n = chunks[tag]
            r = Reader(data, o)
            while r.p < o + n:
                node = read_node(r)
                if tag == 'BONE':
                    r.p += 8  # geosetId, geosetAnimId
                node['kind'] = tag
                m['nodes'][node['id']] = node
    if 'ATCH' in chunks:
        o, n = chunks['ATCH']
        r = Reader(data, o)
        while r.p < o + n:
            start = r.p
            size = r.u32()
            node = read_node(r)
            node['kind'] = 'ATCH'
            m['nodes'][node['id']] = node
            r.p = start + size

    m['pivots'] = []
    if 'PIVT' in chunks:
        o, n = chunks['PIVT']
        f = struct.unpack_from('<%df' % (n // 4), data, o)
        m['pivots'] = [f[i:i + 3] for i in range(0, len(f), 3)]
    return m


# ---------- Анимация ----------

def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = [-x for x in b]
        dot = -dot
    if dot > 0.9995:
        r = [x + (y - x) * t for x, y in zip(a, b)]
    else:
        th = math.acos(dot)
        s = math.sin(th)
        wa, wb = math.sin((1 - t) * th) / s, math.sin(t * th) / s
        r = [x * wa + y * wb for x, y in zip(a, b)]
    n = math.sqrt(sum(x * x for x in r)) or 1
    return [x / n for x in r]


def sample(track, frame, is_quat, default):
    keys = track['keys']
    if not keys:
        return default
    if frame <= keys[0][0]:
        return keys[0][1]
    if frame >= keys[-1][0]:
        return keys[-1][1]
    lo, hi = 0, len(keys) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if keys[mid][0] <= frame:
            lo = mid
        else:
            hi = mid
    (f0, v0), (f1, v1) = keys[lo], keys[hi]
    if track['interp'] == 0:
        return v0
    t = (frame - f0) / (f1 - f0)
    return slerp(v0, v1, t) if is_quat else [x + (y - x) * t for x, y in zip(v0, v1)]


def track_frames(track, seq, gseqs):
    """Кадры трека внутри последовательности (в мс), включая её начало и конец."""
    s, e = seq['start'], seq['end']
    if track['gseq'] >= 0:
        # Глобальная последовательность крутится независимо: просто сэмплируем каждые 33 мс.
        return list(range(s, e + 1, 33)) or [s]
    frames = {s, e}
    frames.update(f for f, _ in track['keys'] if s <= f <= e)
    return sorted(frames)


def local_frame(track, frame, seq, gseqs):
    if track['gseq'] >= 0 and track['gseq'] < len(gseqs) and gseqs[track['gseq']] > 0:
        return (frame - seq['start']) % gseqs[track['gseq']]
    return frame


# ---------- Текстуры ----------

def find_texture(path, roots):
    base = os.path.splitext(path.replace('\\', '/'))[0].lower()
    for root in roots:
        for ext in ('.dds', '.png', '.tga', '.blp'):
            p = os.path.join(root, base + ext)
            if os.path.exists(p):
                return p
    return None


def open_image(path):
    try:
        im = Image.open(path)
        im.load()
        return im
    except Exception as e:  # BLP и прочие экзотические форматы пропускаем
        print('  не прочитал текстуру %s: %s' % (path, e), file=sys.stderr)
        return None


def to_png(im, size):
    if size and max(im.size) > size:
        im = im.resize((size, size * im.size[1] // im.size[0]), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def load_png(path, kind, size, team_color=None, mask_path=None):
    im = open_image(path)
    if im is None:
        return None
    if kind == 'normal':
        # BC5 хранит только X и Y, Z восстанавливаем. Зелёный канал переворачиваем:
        # в WC3 нормали в стиле DirectX, glTF ждёт OpenGL.
        a = np.asarray(im.convert('RGB'), dtype=np.float32) / 127.5 - 1
        x, y = a[..., 0], a[..., 1]
        z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
        out = np.stack([x, -y, z], -1) * 127.5 + 127.5
        im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB')
    else:
        im = im.convert('RGBA')
        if kind == 'color' and team_color and mask_path:
            # Цвет команды: в HD-моделях маска лежит в альфе ORM. Запекаем синий игрока сразу
            # в текстуру, как это делает шейдер игры (умножение цвета на цвет команды).
            mask_im = open_image(mask_path)
            if mask_im is not None:
                mask = np.asarray(mask_im.convert('RGBA').resize(im.size), dtype=np.float32)[..., 3:4] / 255
                c = np.asarray(im, dtype=np.float32)
                tc = np.array(team_color, dtype=np.float32) / 255
                c[..., :3] = c[..., :3] * (1 - mask) + c[..., :3] * tc * mask
                im = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'RGBA')
    return to_png(im, size)


# ---------- Запись glTF ----------

def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def translate(x, y, z):
    return [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]


# WC3 смотрит вверх по Z, glTF по Y: (x, y, z) → (x, z, -y), то есть поворот на −90° вокруг X.
Z_TO_Y = [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]]
Y_TO_Z = [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]
ROOT_ROTATION = [-math.sqrt(0.5), 0, 0, math.sqrt(0.5)]


class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.j = {
            'asset': {'version': '2.0', 'generator': 'taskcraft mdx2gltf'},
            'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [], 'accessors': [],
            'bufferViews': [], 'buffers': [], 'materials': [], 'textures': [], 'images': [],
            'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
            'skins': [], 'animations': [],
        }

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, values, ctype, typ, target=None, minmax=False, normalized=False):
        fmt = {5126: 'f', 5123: 'H', 5121: 'B', 5125: 'I'}[ctype]
        comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[typ]
        data = struct.pack('<%d%s' % (len(values), fmt), *values)
        acc = {'bufferView': self.view(data, target), 'componentType': ctype, 'count': len(values) // comps, 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [min(values[i::comps]) for i in range(comps)]
            acc['max'] = [max(values[i::comps]) for i in range(comps)]
        self.j['accessors'].append(acc)
        return len(self.j['accessors']) - 1

    def image(self, png):
        self.j['images'].append({'bufferView': self.view(png), 'mimeType': 'image/png'})
        self.j['textures'].append({'source': len(self.j['images']) - 1, 'sampler': 0})
        return len(self.j['textures']) - 1

    def write(self, path):
        for k in [k for k, v in self.j.items() if v == []]:
            del self.j[k]
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.j, separators=(',', ':'), ensure_ascii=False).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942) + self.bin)


def convert(mdx_path, out_path, roots, tex_size, team_color=(0, 66, 255), replaceable=None, portrait=False):
    replaceable = replaceable or {}
    m = parse_mdx(open(mdx_path, 'rb').read())
    gl = Gltf()
    J = gl.j
    if portrait:
        # Модель портрета (*_portrait.mdx): только обычные «Portrait N» и «Portrait Talk N»,
        # без вариантов аватара; задник портрета не нужен, его рисует консоль.
        seqs = [s for s in m['sequences'] if 'portrait' in s['name'].lower() and 'alternate' not in s['name'].lower()]
    else:
        seqs = [s for s in m['sequences'] if not any(w in s['name'].lower() for w in SKIP_SEQUENCES)]

    # Узлы: корень с поворотом Z→Y, под ним иерархия костей. Локальный перенос узла
    # = pivot − pivot родителя, так что поворот кости идёт вокруг её pivot, как в WC3.
    root = {'name': 'wc3_root', 'rotation': ROOT_ROTATION, 'children': []}
    J['nodes'].append(root)
    J['scenes'][0]['nodes'].append(0)
    ids = sorted(m['nodes'])
    node_index = {oid: 1 + i for i, oid in enumerate(ids)}
    pivots = m['pivots']

    def pivot(oid):
        return list(pivots[oid]) if oid < len(pivots) else [0, 0, 0]

    for oid in ids:
        n = m['nodes'][oid]
        p = pivot(oid)
        pp = pivot(n['parent']) if n['parent'] in m['nodes'] else [0, 0, 0]
        J['nodes'].append({'name': n['name'], 'translation': [a - b for a, b in zip(p, pp)]})
    for oid in ids:
        n = m['nodes'][oid]
        parent = J['nodes'][node_index[n['parent']]] if n['parent'] in m['nodes'] else root
        parent.setdefault('children', []).append(node_index[oid])

    # Скин: обратная матрица привязки = (R_root · T(pivot))⁻¹ = T(−pivot) · R_root⁻¹.
    ibm = []
    for oid in ids:
        mtx = mat_mul(translate(*[-x for x in pivot(oid)]), Y_TO_Z)
        ibm += [mtx[r][c] for c in range(4) for r in range(4)]  # glTF хранит по столбцам
    skin_index = None
    if ids:
        J['skins'].append({'joints': [node_index[o] for o in ids], 'inverseBindMatrices': gl.accessor(ibm, 5126, 'MAT4'), 'skeleton': 0})
        skin_index = 0
    joint_of = {oid: i for i, oid in enumerate(ids)}

    # Материалы.
    tex_cache = {}

    suffix = {'color': '_Diffuse', 'normal': '_Normal', 'orm': '_ORM', 'emissive': '_Emissive'}

    def source(tid, kind):
        """Путь текстуры в архиве. Заменяемые текстуры (деревья = 31) берутся из --replaceable."""
        if tid is None or tid >= len(m['textures']):
            return None
        t = m['textures'][tid]
        if t['replaceable']:
            base = replaceable.get(t['replaceable'])
            return base + suffix[kind] if base else None
        return t['path'] or None

    def tex_path(tid, kind='orm'):
        src = source(tid, kind)
        return find_texture(src, roots) if src else None

    def texture(tid, kind, mask_tid=None):
        src = source(tid, kind)
        if not src:
            return None
        key = (tid, kind, mask_tid)
        if key not in tex_cache:
            path = find_texture(src, roots)
            png = load_png(path, kind, tex_size, team_color, tex_path(mask_tid)) if path else None
            if not path:
                print('  нет текстуры: %s' % src, file=sys.stderr)
            tex_cache[key] = gl.image(png) if png else None
        return tex_cache[key]

    for i, mat in enumerate(m['materials']):
        layer = mat['layers'][0] if mat['layers'] else {'slots': {}, 'filter': 0}
        s = layer['slots']
        out = {'name': 'material%d' % i, 'pbrMetallicRoughness': {'metallicFactor': 1, 'roughnessFactor': 1}}
        hd = len(s) > 1
        base = texture(s.get(0), 'color', s.get(2) if hd else None)
        if base is not None:
            out['pbrMetallicRoughness']['baseColorTexture'] = {'index': base}
        if hd:
            nrm = texture(s.get(1), 'normal')
            orm = texture(s.get(2), 'orm')
            if nrm is not None:
                out['normalTexture'] = {'index': nrm}
            if orm is not None:
                out['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': orm}
                out['occlusionTexture'] = {'index': orm}
            emi = texture(s.get(3), 'emissive')
            if emi is not None:
                out['emissiveTexture'] = {'index': emi}
                out['emissiveFactor'] = [1, 1, 1]
        else:
            out['pbrMetallicRoughness']['metallicFactor'] = 0
        if layer['filter'] == 1:
            out['alphaMode'] = 'MASK'
            out['alphaCutoff'] = 0.75
        elif layer['filter'] >= 2:
            out['alphaMode'] = 'BLEND'
        J['materials'].append(out)

    def material_texture(mi):
        if mi >= len(m['materials']) or not m['materials'][mi]['layers']:
            return ''
        return (source(m['materials'][mi]['layers'][0]['slots'].get(0), 'color') or '').lower()

    # Видимость геосетов по последовательностям (мешок с золотом, бревно, кишки при смерти).
    visible = {}
    # Геосеты, которые появляются или пропадают посреди анимации (леса и стены в модели
    # постройки): моменты смены видимости в секундах от начала последовательности.
    switches = {}
    for ga in m['geosetAnims']:
        track = ga['tracks'].get(b'KGAO')
        names = []
        for s in seqs:
            mid = (s['start'] + s['end']) // 2
            a = sample(track, mid, False, [ga['alpha']])[0] if track else ga['alpha']
            if a > 0.5:
                names.append(s['name'])
            if track and track['gseq'] < 0:
                keys = [[0, sample(track, s['start'], False, [1])[0] > 0.5]]
                for f, v in track['keys']:
                    if s['start'] < f <= s['end'] and (v[0] > 0.5) != keys[-1][1]:
                        keys.append([round((f - s['start']) / 1000, 3), v[0] > 0.5])
                if len(keys) > 1:
                    switches.setdefault(ga['geoset'], {})[s['name']] = keys
        visible[ga['geoset']] = names

    # Геосеты → меши со скиннингом.
    for gi, g in enumerate(m['geosets']):
        if g.get('lod', 0) != 0:
            continue  # только самый детальный уровень
        if portrait and (visible.get(gi) == [] or 'portrait_bg' in material_texture(g['material'])):
            continue
        pos = g['positions']
        count = len(pos) // 3
        p = []
        for k in range(count):
            x, y, z = pos[3 * k:3 * k + 3]
            p += [x, z, -y]
        nr = []
        for k in range(count):
            x, y, z = g['normals'][3 * k:3 * k + 3]
            nr += [x, z, -y]
        attrs = {'POSITION': gl.accessor(p, 5126, 'VEC3', 34962, True), 'NORMAL': gl.accessor(nr, 5126, 'VEC3', 34962)}
        if g.get('tangents'):
            tg = []
            for k in range(count):
                x, y, z, w = g['tangents'][4 * k:4 * k + 4]
                tg += [x, z, -y, 1.0 if w >= 0 else -1.0]
            attrs['TANGENT'] = gl.accessor(tg, 5126, 'VEC4', 34962)
        if g['uvs']:
            attrs['TEXCOORD_0'] = gl.accessor(g['uvs'][0], 5126, 'VEC2', 34962)
        if skin_index is not None:
            joints, weights = [], []
            mats = g.get('matrices', [])
            if 'skin' in g and len(g['skin']) >= count * 8:
                sk = g['skin']
                for k in range(count):
                    b = sk[8 * k:8 * k + 4]
                    w = sk[8 * k + 4:8 * k + 8]
                    joints += [joint_of.get(mats[x] if x < len(mats) else 0, 0) for x in b]
                    tot = sum(w) or 1
                    weights += [x / tot for x in w]
            else:
                # Классические модели: вершина привязана к группе костей с равными весами.
                groups, sizes = g.get('groups', []), g.get('MTGC', [])
                starts = [sum(sizes[:i]) for i in range(len(sizes))]
                for k in range(count):
                    gidx = groups[k] if k < len(groups) else 0
                    bones = mats[starts[gidx]:starts[gidx] + sizes[gidx]][:4] if sizes else [0]
                    js = [joint_of.get(b, 0) for b in bones] + [0] * (4 - len(bones))
                    ws = [1 / len(bones)] * len(bones) + [0] * (4 - len(bones))
                    joints += js
                    weights += ws
            attrs['JOINTS_0'] = gl.accessor(joints, 5123, 'VEC4', 34962)
            attrs['WEIGHTS_0'] = gl.accessor(weights, 5126, 'VEC4', 34962)
        faces = g['faces']
        indices = gl.accessor(faces, 5125 if count > 65535 else 5123, 'SCALAR', 34963)
        prim = {'attributes': attrs, 'indices': indices, 'mode': 4}
        if g['material'] < len(J['materials']):
            prim['material'] = g['material']
        name = g.get('name') or 'geoset%d' % gi
        J['meshes'].append({'name': name, 'primitives': [prim]})
        node = {'name': name, 'mesh': len(J['meshes']) - 1, 'extras': {'geoset': gi}}
        if gi in visible:
            node['extras']['visibleIn'] = visible[gi]
        if gi in switches:
            node['extras']['visibleSwitch'] = switches[gi]
        if skin_index is not None:
            node['skin'] = skin_index
        J['nodes'].append(node)
        J['scenes'][0]['nodes'].append(len(J['nodes']) - 1)

    # Анимации: по одной на последовательность, время с нуля в секундах.
    gseqs = m['globalSequences']
    for s in seqs:
        anim = {'name': s['name'], 'channels': [], 'samplers': []}
        for oid in ids:
            n = m['nodes'][oid]
            base_t = J['nodes'][node_index[oid]]['translation']
            for tag, path, comps, default in ((b'KGTR', 'translation', 3, [0, 0, 0]), (b'KGRT', 'rotation', 4, [0, 0, 0, 1]), (b'KGSC', 'scale', 3, [1, 1, 1])):
                track = n['tracks'].get(tag)
                if not track or not track['keys']:
                    continue
                frames = track_frames(track, s, gseqs)
                times, values = [], []
                for f in frames:
                    v = sample(track, local_frame(track, f, s, gseqs), tag == b'KGRT', default)
                    if tag == b'KGTR':
                        v = [a + b for a, b in zip(v, base_t)]
                    times.append((f - s['start']) / 1000)
                    values += v
                inp = gl.accessor(times, 5126, 'SCALAR', minmax=True)
                outp = gl.accessor(values, 5126, 'VEC%d' % comps)
                anim['samplers'].append({'input': inp, 'output': outp, 'interpolation': 'LINEAR'})
                anim['channels'].append({'sampler': len(anim['samplers']) - 1, 'target': {'node': node_index[oid], 'path': path}})
        if not anim['channels'] and any(s['name'] in sw for sw in switches.values()):
            # Модель постройки (farmbirth.mdx) без костей: в ней только появляются леса и стены.
            # Пустая дорожка на корне задаёт длину анимации, чтобы по ней шли visibleSwitch.
            inp = gl.accessor([0.0, max((s['end'] - s['start']) / 1000, 0.001)], 5126, 'SCALAR', minmax=True)
            outp = gl.accessor(ROOT_ROTATION * 2, 5126, 'VEC4')
            anim['samplers'].append({'input': inp, 'output': outp, 'interpolation': 'STEP'})
            anim['channels'].append({'sampler': 0, 'target': {'node': 0, 'path': 'rotation'}})
        if anim['channels']:
            J['animations'].append(anim)

    J['scenes'][0]['extras'] = {
        'source': os.path.basename(mdx_path),
        'mdxVersion': m['version'],
        'sequences': [{'name': s['name'], 'duration': (s['end'] - s['start']) / 1000, 'loop': s['loop']} for s in seqs],
    }
    gl.write(out_path)
    return m, seqs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mdx')
    ap.add_argument('out')
    ap.add_argument('--root', action='append', default=[], help='папка war3.w3mod; можно несколько, по порядку поиска')
    ap.add_argument('--tex-size', type=int, default=512, help='максимальный размер текстур, 0 — без уменьшения')
    ap.add_argument('--replaceable', action='append', default=[], metavar='ID=ПУТЬ',
                    help='текстура для заменяемого id, например 31=Doodads/Terrain/LordaeronTree/LordaeronTree (без _Diffuse)')
    ap.add_argument('--portrait', action='store_true', help='модель портрета: анимации Portrait и Portrait Talk без задника')
    ap.add_argument('--team-color', default='0,66,255', help='цвет команды R,G,B (по умолчанию синий игрока 1), "none" — не запекать')
    a = ap.parse_args()
    roots = []
    for r in a.root:
        # Слои как в игре: сначала Definitive Edition, потом Reforged, потом классика.
        roots += [os.path.join(r, '_de.w3mod'), os.path.join(r, '_hd.w3mod'), r]
    team = None if a.team_color == 'none' else tuple(int(x) for x in a.team_color.split(','))
    repl = {int(k): v for k, v in (x.split('=', 1) for x in a.replaceable)}
    m, seqs = convert(a.mdx, a.out, roots, a.tex_size, team, repl, a.portrait)
    print('%s: MDX %d, %d геосетов, %d костей, %d анимаций → %s (%.1f МБ)' % (
        os.path.basename(a.mdx), m['version'], len(m['geosets']), len(m['nodes']), len(seqs), a.out, os.path.getsize(a.out) / 1e6))


if __name__ == '__main__':
    main()
