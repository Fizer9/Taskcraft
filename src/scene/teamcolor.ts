// Цвет базы на моделях WC3. Синий игрока 1 запечён в текстуры при конвертации, а маска
// командного цвета осталась в альфе ORM-текстуры (у HD-моделей она там и лежит). Шейдер
// по этой маске заменяет синий цветом базы: яркость берётся из синего канала, где
// исходный серый сохранился без потерь (синий WC3 умножает его на 1).

import { Color3, MaterialPluginBase, PBRMaterial, ShaderLanguage, type AbstractMesh, type Material, type MaterialDefines, type UniformBuffer } from '@babylonjs/core';
import type { ModelInstance } from './models';

/** Цвет, запечённый в текстуры (scripts/mdx2gltf.py, --team-color). */
const BAKED = '#0042ff';

class TeamColorPlugin extends MaterialPluginBase {
  private readonly color: Color3;

  constructor(material: Material, hex: string) {
    super(material, 'TeamColor', 200, { TEAMCOLOR: false }, true, true);
    // Шейдер работает с цветом в линейном пространстве.
    this.color = Color3.FromHexString(hex).toLinearSpace();
  }

  getClassName() {
    return 'TeamColorPlugin';
  }

  isCompatible(shaderLanguage: ShaderLanguage) {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  prepareDefines(defines: MaterialDefines) {
    defines.TEAMCOLOR = true;
  }

  getUniforms() {
    return { ubo: [{ name: 'teamColor', size: 3, type: 'vec3' }], fragment: '#ifdef TEAMCOLOR\nuniform vec3 teamColor;\n#endif' };
  }

  bindForSubMesh(ubo: UniformBuffer) {
    ubo.updateColor3('teamColor', this.color);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#if defined(TEAMCOLOR) && defined(REFLECTIVITY)
{
  float teamMask = texture2D(reflectivitySampler, vReflectivityUV + uvOffset).a;
  surfaceAlbedo = mix(surfaceAlbedo, vec3(surfaceAlbedo.b) * teamColor, teamMask);
}
#endif
`,
    };
  }
}

/** Копии материалов под каждый цвет: экземпляры одной модели одного цвета делят их. */
const tinted = new Map<string, PBRMaterial>();
/** Исходный материал окрашенного меша: портрет перекрашивает одну модель под разные базы. */
const original = new WeakMap<AbstractMesh, Material>();

/** Окрашивает командные части модели в цвет базы; без цвета возвращает синий. */
export function applyTeamColor(model: ModelInstance, hex: string | undefined) {
  const baked = !hex || hex.toLowerCase() === BAKED;
  for (const mesh of model.root.getChildMeshes()) {
    const was = original.get(mesh);
    if (baked) {
      if (was) mesh.material = was;
      continue;
    }
    const mat = was ?? mesh.material;
    // Маска лежит в ORM-текстуре; у моделей без неё (деревья, камни) красить нечего.
    if (!(mat instanceof PBRMaterial) || !mat.metallicTexture) continue;
    original.set(mesh, mat);
    const key = `${mat.uniqueId}:${hex}`;
    let own = tinted.get(key);
    if (!own) {
      own = mat.clone(`${mat.name}-team-${hex}`);
      new TeamColorPlugin(own, hex);
      tinted.set(key, own);
    }
    mesh.material = own;
  }
}
