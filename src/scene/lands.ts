// Земли сфер на карте (раздел 3 дизайна): название сферы и её оценка написаны прямо
// на земле между главной ратушей и базами этой сферы, как подписи областей на карте.

import { Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial } from '@babylonjs/core';
import type { GameState } from '../state/types';
import { MAIN_HALL_ID } from '../state/types';
import { onMap } from '../state/economy';

export interface LandSpot {
  sphereId: string;
  name: string;
  score: number;
  target: number;
  x: number;
  z: number;
}

/** Размер подписи на земле. */
export const LAND_W = 44;
export const LAND_H = 11;

/**
 * Где подписать каждую землю: по среднему направлению на её базы, ближе к центру,
 * чем сами базы. Подписи, которые наехали друг на друга, сдвигаются к центру.
 */
export function landSpots(state: GameState): LandSpot[] {
  const spots: LandSpot[] = [];
  for (const sp of state.spheres) {
    const bases = state.projects.filter((p) => p.sphereId === sp.id && p.id !== MAIN_HALL_ID && onMap(p));
    if (!bases.length) continue;
    let sx = 0;
    let sz = 0;
    let r = 0;
    for (const p of bases) {
      const len = Math.hypot(p.slot.x, p.slot.z) || 1;
      sx += p.slot.x / len;
      sz += p.slot.z / len;
      r += len;
    }
    const angle = Math.atan2(sz, sx);
    let radius = Math.min(70, r / bases.length - 50);
    const at = () => ({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
    const overlaps = (p: { x: number; z: number }) => spots.some((o) => Math.abs(o.x - p.x) < LAND_W && Math.abs(o.z - p.z) < LAND_H + 2);
    while (overlaps(at()) && radius > 40) radius -= 8;
    spots.push({ sphereId: sp.id, name: sp.name, score: sp.score, target: sp.target, ...at() });
  }
  return spots;
}

export class Lands {
  private meshes: Mesh[] = [];
  private sig = '';

  constructor(private scene: Scene) {}

  /** Перерисовывает подписи, если земли изменились. Возвращает true, если перерисовал. */
  sync(spots: LandSpot[]): boolean {
    const sig = JSON.stringify(spots);
    if (sig === this.sig) return false;
    this.sig = sig;
    for (const m of this.meshes) {
      m.material?.dispose(true, true);
      m.dispose();
    }
    this.meshes = spots.map((s) => this.label(s));
    return true;
  }

  private label(s: LandSpot): Mesh {
    const tex = new DynamicTexture('land-' + s.sphereId, { width: 1024, height: 256 }, this.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const line = (text: string, y: number, size: number, color: string) => {
      ctx.font = `bold ${size}px Georgia, serif`;
      // Длинные названия сжимаются по ширине, чтобы не вылезать за подпись.
      const w = ctx.measureText(text).width;
      ctx.save();
      ctx.translate(512, y);
      if (w > 980) ctx.scale(980 / w, 1);
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(20,14,6,0.85)';
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    line(s.name.toUpperCase(), 120, 96, '#f3dfa2');
    const reached = s.score >= s.target;
    line(reached ? `${s.score} из ${s.target} · земля под контролем` : `${s.score} → ${s.target}`, 215, 64, reached ? '#9be37a' : '#e8c66a');
    tex.update();

    const m = new StandardMaterial('landMat-' + s.sphereId, this.scene);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.emissiveColor = new Color3(0.55, 0.5, 0.4);
    m.specularColor = Color3.Black();
    m.alpha = 0.85;
    m.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane('land-' + s.sphereId, { width: LAND_W, height: LAND_H }, this.scene);
    plane.material = m;
    // Лежит на земле, верх надписи на север, к верхнему краю экрана.
    plane.rotation.x = Math.PI / 2;
    plane.position.set(s.x, 0.25, s.z);
    plane.isPickable = false;
    return plane;
  }
}
