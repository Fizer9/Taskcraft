// Земля Лордерона по правилам WC3: карта — сетка углов, в каждом углу свой тип земли,
// а клетка рисуется слоями. Нижний тип кладётся целиком, каждый следующий — плиткой из
// атласа, выбранной по тому, в каких углах клетки он лежит (16 вариантов перехода).
// Поэтому трава наползает на землю неровным краем, как в игре.
//
// Атлас тайла 8×4 клетки: левая половина — 16 переходов (номер = маска углов),
// правая — 16 вариантов сплошной клетки (с цветами, камешками, проплешинами).

import {
  Constants,
  MaterialPluginBase,
  RawTexture,
  RawTexture2DArray,
  StandardMaterial,
  type AbstractEngine,
  type Material,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from '@babylonjs/core';
import { loadArt } from '../assets/loader';

/** Клетка WC3 (128 единиц игры) в единицах мира. */
export const TILE = 3.2;

/** Порядок важен: тип с большим номером рисуется поверх меньших. */
export const TILESET = ['lords_dirt', 'lords_dirtrough', 'lords_dirtgrass', 'lords_rock', 'lords_grass', 'lords_grassdark'] as const;
export const enum Ground {
  Dirt = 0,
  Rough = 1,
  DirtGrass = 2,
  Rock = 3,
  Grass = 4,
  DarkGrass = 5,
}

const ATLAS_W = 1024;
const ATLAS_H = 512;

/** Плавный шум для неровных краёв пятен. */
function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class TerrainMap {
  /** Число клеток по стороне; углов на одну больше. */
  readonly n: number;
  readonly corners: Uint8Array;

  constructor(readonly half: number) {
    this.n = Math.ceil((half * 2) / TILE);
    this.corners = new Uint8Array((this.n + 1) * (this.n + 1)).fill(Ground.Grass);
  }

  /** Координаты угла в мире. */
  private pos(i: number, j: number): [number, number] {
    return [-this.half + i * TILE, -this.half + j * TILE];
  }

  /** Красит углы, для которых test(x, z) верно. */
  paint(type: Ground, test: (x: number, z: number) => boolean) {
    const m = this.n + 1;
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const [x, z] = this.pos(i, j);
        if (test(x, z)) this.corners[j * m + i] = type;
      }
    }
  }

  /** Круглое пятно с неровным краем. */
  disc(type: Ground, cx: number, cz: number, r: number, wobble = 0.25) {
    this.paint(type, (x, z) => Math.hypot(x - cx, z - cz) < r * (1 - wobble / 2 + wobble * noise(x / 6 + cx, z / 6 + cz)));
  }

  /** Дорога от точки к точке. */
  path(type: Ground, ax: number, az: number, bx: number, bz: number, w: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    this.paint(type, (x, z) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      return d < w * (0.75 + 0.5 * noise(x / 5, z / 5));
    });
  }

  /** Тёмная трава пятнами по всей карте, как на картах Лордерона. */
  meadows() {
    this.paint(Ground.DarkGrass, (x, z) => noise(x / 22 + 40, z / 22 + 40) * 0.7 + noise(x / 7, z / 7) * 0.3 > 0.62);
  }

  /** Для каждой клетки до четырёх слоёв: байт = тип·32 + номер плитки в атласе, 255 — пусто. */
  cells(): Uint8Array {
    const { n } = this;
    const m = n + 1;
    const out = new Uint8Array(n * n * 4).fill(255);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const bl = this.corners[j * m + i];
        const br = this.corners[j * m + i + 1];
        const tl = this.corners[(j + 1) * m + i];
        const tr = this.corners[(j + 1) * m + i + 1];
        const types = [...new Set([bl, br, tl, tr])].sort((a, b) => a - b);
        types.forEach((t, k) => {
          let tile: number;
          if (k === 0) {
            // Нижний слой целиком. Сплошные клетки иногда берут вариант с узором, как в игре.
            const r = hash(i * 1.37, j * 2.11);
            tile = types.length === 1 && r < 0.22 ? 16 + Math.floor(hash(i + 7.7, j + 3.3) * 16) : r < 0.6 ? 15 : 0;
          } else {
            tile = (br === t ? 1 : 0) | (bl === t ? 2 : 0) | (tr === t ? 4 : 0) | (tl === t ? 8 : 0);
          }
          out[(j * n + i) * 4 + k] = t * 32 + tile;
        });
      }
    }
    return out;
  }
}

/** Встраивает выборку плиток в стандартный материал, чтобы земля получала свет и тени сцены. */
class TerrainPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private atlas: RawTexture2DArray,
    private cellTex: RawTexture,
    private grid: [number, number, number, number],
  ) {
    super(material, 'WC3Terrain', 200, { WC3TERRAIN: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>) {
    defines.WC3TERRAIN = true;
  }

  override getClassName() {
    return 'TerrainPlugin';
  }

  override getSamplers(samplers: string[]) {
    samplers.push('wc3Atlas', 'wc3Cells');
  }

  override getUniforms() {
    return {
      ubo: [{ name: 'wc3Grid', size: 4, type: 'vec4' }],
      fragment: '#ifdef WC3TERRAIN\nuniform vec4 wc3Grid;\n#endif',
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh) {
    ubo.updateFloat4('wc3Grid', ...this.grid);
    ubo.setTexture('wc3Atlas', this.atlas);
    ubo.setTexture('wc3Cells', this.cellTex);
  }

  override getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #ifdef WC3TERRAIN
        uniform highp sampler2DArray wc3Atlas;
        uniform highp sampler2D wc3Cells;
        // Атлас хранится с умноженной на альфу краской: прозрачные соседние плитки при
        // фильтрации не дают тёмных швов. lod считаем сами и отступаем от краёв плитки
        // на полтекселя выбранного уровня.
        vec4 wc3Layer(float v, vec2 g, vec2 gx, vec2 gy) {
          float type = floor(v / 32.0);
          float idx = v - type * 32.0;
          float j = idx < 16.0 ? idx : idx - 16.0;
          vec2 tile = vec2(mod(j, 4.0) + (idx < 16.0 ? 0.0 : 4.0), floor(j / 4.0));
          vec2 px = vec2(${ATLAS_W / 8}.0);
          float lod = max(0.0, 0.5 * log2(max(dot(gx * px, gx * px), dot(gy * px, gy * px))));
          float m = min(0.25, 0.5 * exp2(lod) / px.x);
          vec2 f = clamp(g, vec2(m), vec2(1.0 - m));
          vec2 uv = (tile + vec2(f.x, 1.0 - f.y)) / vec2(8.0, 4.0);
          return textureLod(wc3Atlas, vec3(uv, type), lod);
        }
        #endif
      `,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
        #ifdef WC3TERRAIN
        {
          vec2 g = (vPositionW.xz - wc3Grid.xy) / wc3Grid.z;
          vec2 cell = clamp(floor(g), vec2(0.0), vec2(wc3Grid.w - 1.0));
          vec2 f = g - cell;
          vec2 gx = dFdx(g);
          vec2 gy = dFdy(g);
          vec4 layers = floor(texelFetch(wc3Cells, ivec2(cell), 0) * 255.0 + 0.5);
          // Нижний слой сплошной: делим на альфу, чтобы край плитки не темнел.
          vec4 s = wc3Layer(layers.x, f, gx, gy);
          vec3 c = s.rgb / max(s.a, 0.01);
          if (layers.y < 255.0) { s = wc3Layer(layers.y, f, gx, gy); c = c * (1.0 - s.a) + s.rgb; }
          if (layers.z < 255.0) { s = wc3Layer(layers.z, f, gx, gy); c = c * (1.0 - s.a) + s.rgb; }
          if (layers.w < 255.0) { s = wc3Layer(layers.w, f, gx, gy); c = c * (1.0 - s.a) + s.rgb; }
          baseColor.rgb = c;
        }
        #endif
      `,
    };
  }
}

async function decode(bytes: Uint8Array): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(ATLAS_W, ATLAS_H);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, ATLAS_W, ATLAS_H);
  const px = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    px[i] *= a;
    px[i + 1] *= a;
    px[i + 2] *= a;
  }
  return px;
}

/** Материал земли из тайлов WC3, или null, если текстур земли нет (без пароля). */
export async function terrainMaterial(scene: Scene, map: TerrainMap): Promise<StandardMaterial | null> {
  const files = await Promise.all(TILESET.map((t) => loadArt(`terrain/${t}.png`)));
  if (files.some((f) => !f)) return null;
  const layers = await Promise.all(files.map((f) => decode(f!)));
  const data = new Uint8Array(ATLAS_W * ATLAS_H * 4 * layers.length);
  layers.forEach((l, i) => data.set(l, i * ATLAS_W * ATLAS_H * 4));

  const atlas = new RawTexture2DArray(data, ATLAS_W, ATLAS_H, layers.length, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
  atlas.anisotropicFilteringLevel = 8;
  const cells = new RawTexture(map.cells(), map.n, map.n, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);

  const mat = new StandardMaterial('terrain', scene);
  mat.specularColor.set(0, 0, 0);
  new TerrainPlugin(mat, atlas, cells, [-map.half, -map.half, TILE, map.n]);
  return mat;
}
