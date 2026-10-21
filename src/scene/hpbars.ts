// Полоски здоровья над юнитами и зданиями, как в WC3: все сразу, пока зажат Alt, и одна
// над тем, что под курсором. Полоски рисуются поверх 3D обычными блоками страницы,
// поэтому всегда чёткие.

import type { TransformNode, Vector3 } from '@babylonjs/core';

export interface Bar {
  /** Узел, над которым висит полоска, или точка на земле. */
  node: TransformNode | null;
  at?: Vector3;
  /** Высота полоски над узлом в единицах мира. */
  lift: number;
  /** Здоровье 0..1. */
  health: number;
  /** Ширина в пикселях при обычном зуме: у зданий шире, чем у юнитов. */
  width: number;
}

export class HpBars {
  private root: HTMLElement;
  private pool: HTMLElement[] = [];

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hpbars';
    document.body.appendChild(this.root);
  }

  /** zoom: во сколько раз камера ближе обычного, полоски растут и уменьшаются вместе с картой. */
  draw(bars: Bar[], toScreen: (p: Vector3) => { x: number; y: number } | null, zoom: number) {
    let used = 0;
    for (const b of bars) {
      const base = b.node ? (b.node.isEnabled() ? b.node.getAbsolutePosition() : null) : b.at;
      if (!base) continue;
      const top = base.clone();
      top.y += b.lift;
      const p = toScreen(top);
      if (!p) continue;
      const el = this.pool[used] ?? this.make();
      used++;
      const w = Math.round(b.width * zoom);
      const k = Math.max(0, Math.min(1, b.health));
      el.style.transform = `translate(${Math.round(p.x - w / 2)}px, ${Math.round(p.y)}px)`;
      el.style.width = `${w}px`;
      el.className = k > 0.5 ? 'ok' : k > 0.25 ? 'mid' : 'low';
      (el.firstElementChild as HTMLElement).style.width = `${(k * 100).toFixed(1)}%`;
      el.style.display = 'block';
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }

  private make(): HTMLElement {
    const el = document.createElement('div');
    el.appendChild(document.createElement('i'));
    this.root.appendChild(el);
    this.pool.push(el);
    return el;
  }
}

/** Название базы над ратушей: только у выбранной и у той, что под курсором. */
export class NameTags {
  private pool: HTMLElement[] = [];

  draw(tags: { at: Vector3; text: string; color: string }[], toScreen: (p: Vector3) => { x: number; y: number } | null) {
    let used = 0;
    for (const t of tags) {
      const p = toScreen(t.at);
      if (!p) continue;
      let el = this.pool[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'nametag';
        document.body.appendChild(el);
        this.pool.push(el);
      }
      used++;
      if (el.textContent !== t.text) el.textContent = t.text;
      el.style.color = t.color;
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      el.style.display = 'block';
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }
}
