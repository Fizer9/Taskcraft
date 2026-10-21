// Скверна на заброшенной базе: зелёное пятно на земле, языки пламени Скверны вокруг
// и огонь на зданиях, который разгорается с повреждениями. Когда есть тайлы скверны WC3,
// землю рисует terrain.ts, а пятно прячется; огонь это частицы с нарисованной на лету текстурой.

import {
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Color3,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
// Шейдеры частиц Babylon грузит лениво; подключаем их сразу, чтобы огонь не ждал.
import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';

let flameTexture: DynamicTexture | null = null;

/** Мягкое круглое пятно для частиц огня. */
function flame(scene: Scene): DynamicTexture {
  if (flameTexture) return flameTexture;
  const t = new DynamicTexture('flameTex', { width: 64, height: 64 }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  t.hasAlpha = true;
  t.update();
  flameTexture = t;
  return t;
}

/** Огонь в точке: fel = зелёное пламя Скверны, иначе обычный пожар. */
export function fire(scene: Scene, parent: TransformNode, pos: Vector3, size: number, fel: boolean): ParticleSystem {
  // Излучатель частиц должен быть мешем: невидимая точка на месте огня.
  const anchor = MeshBuilder.CreateBox('fireAnchor', { size: 0.01 }, scene);
  anchor.isVisible = false;
  anchor.isPickable = false;
  anchor.parent = parent;
  anchor.position.copyFrom(pos);
  const ps = new ParticleSystem('fire', 120, scene);
  ps.particleTexture = flame(scene);
  ps.emitter = anchor;
  ps.onDisposeObservable.add(() => anchor.dispose());
  ps.minEmitBox = new Vector3(-size, 0, -size);
  ps.maxEmitBox = new Vector3(size, 0.5, size);
  if (fel) {
    ps.color1 = new Color4(0.45, 1, 0.2, 1);
    ps.color2 = new Color4(0.15, 0.8, 0.1, 1);
  } else {
    ps.color1 = new Color4(1, 0.75, 0.2, 1);
    ps.color2 = new Color4(1, 0.35, 0.05, 1);
  }
  ps.colorDead = new Color4(0.1, 0.1, 0.1, 0);
  ps.minSize = 0.6 * size;
  ps.maxSize = 1.6 * size;
  ps.minLifeTime = 0.35;
  ps.maxLifeTime = 0.9;
  ps.emitRate = 40;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.gravity = new Vector3(0, 6, 0);
  ps.direction1 = new Vector3(-0.4, 3, -0.4);
  ps.direction2 = new Vector3(0.4, 5, 0.4);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.2;
  ps.updateSpeed = 0.02;
  ps.start();
  return ps;
}

/** Места огня на зданиях базы: ратуша, казарма, алтарь (в координатах базы). */
const BUILDING_FIRES = [
  new Vector3(2, 6, 0),
  new Vector3(-2.5, 4, 2),
  new Vector3(-13, 4, 9),
  new Vector3(13, 3, 10),
];

/** Языки пламени Скверны на земле вокруг базы. */
const FEL_FIRES = [new Vector3(-20, 0, 8), new Vector3(19, 0, 13), new Vector3(-8, 0, -20), new Vector3(10, 0, -19), new Vector3(23, 0, -4)];

export class BlightFx {
  private ground: Mesh | null = null;
  /** Земля уже в тайлах скверны WC3 (terrain.ts): зелёное пятно не нужно. */
  private tiles = false;
  private felFires: ParticleSystem[] = [];
  private fires: ParticleSystem[] = [];
  private state = { blighted: false, burning: 0 };

  constructor(
    private scene: Scene,
    private parent: TransformNode,
  ) {}

  useTiles(on: boolean) {
    this.tiles = on;
    this.ground?.setEnabled(!on);
  }

  /** blighted: по земле ползёт скверна; damage 0–100: насколько горят здания. */
  set(blighted: boolean, damage: number) {
    // Огонь меняем ступенями, чтобы не пересоздавать частицы каждый тик.
    const burning = damage <= 0 ? 0 : Math.min(BUILDING_FIRES.length, Math.ceil(damage / 25));
    if (blighted === this.state.blighted && burning === this.state.burning) return;

    if (blighted !== this.state.blighted) {
      this.ground?.dispose();
      this.ground = null;
      for (const f of this.felFires) f.dispose(false); // общую текстуру пламени не трогаем
      this.felFires = [];
      if (blighted) {
        const g = MeshBuilder.CreateDisc('blight', { radius: 27, tessellation: 40 }, this.scene);
        g.rotation.x = Math.PI / 2;
        g.position.y = 0.06;
        g.parent = this.parent;
        g.isPickable = false;
        const m = new StandardMaterial('blightMat', this.scene);
        m.diffuseColor = Color3.FromHexString('#1c2a0c');
        m.emissiveColor = Color3.FromHexString('#0d2a04');
        m.alpha = 0.5;
        m.specularColor = Color3.Black();
        g.material = m;
        g.setEnabled(!this.tiles);
        this.ground = g;
        this.felFires = FEL_FIRES.map((p) => fire(this.scene, this.parent, p, 0.9, true));
      }
    }

    if (burning !== this.state.burning) {
      for (const f of this.fires) f.dispose(false);
      this.fires = BUILDING_FIRES.slice(0, burning).map((p) => fire(this.scene, this.parent, p, 1.3, false));
    }
    this.state = { blighted, burning };
  }
}
