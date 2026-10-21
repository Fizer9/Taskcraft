// Звуки, которые следуют за состоянием игры, а не за отдельным событием: фон Лордерона по
// солнечным часам, стройка и обрушение, трофеи и «золото заканчивается» на базе.

import { activeBases } from '../state/economy';
import type { Store } from '../state/store';
import { MAIN_HALL_ID, type GameState } from '../state/types';
import type { World } from '../scene/world';
import { daylight, sounds } from './sound';

interface Snapshot {
  captured: number;
  projects: number;
  construction: string | null;
  trophies: number;
  queued: Map<string, number>;
  heroFallen: boolean;
}

function snapshot(s: GameState): Snapshot {
  const queued = new Map<string, number>();
  for (const p of activeBases(s)) if (!p.capturedAt) queued.set(p.id, 0);
  for (const t of s.tasks)
    if ((t.status === 'hired' || t.status === 'active') && t.projectId && queued.has(t.projectId)) queued.set(t.projectId, queued.get(t.projectId)! + 1);
  const wins = (s.hallOfFame?.length ?? 0) + s.projects.filter((p) => p.id !== MAIN_HALL_ID && p.fortressMaxHp > 0 && p.fortressHp === 0).length;
  return {
    captured: s.projects.filter((p) => p.capturedAt).length,
    projects: s.projects.length,
    construction: s.construction?.id ?? null,
    trophies: wins + (s.dreadlordsSlain ?? 0),
    queued,
    heroFallen: !!s.hero.fallenAt,
  };
}

export function watchSounds(store: Store, world: World) {
  let prev = snapshot(store.state);
  store.subscribe((s) => {
    const now = snapshot(s);
    // База пала перед Легионом: ратуша рушится.
    if (now.captured > prev.captured) void sounds.play('collapse');
    // Проект удалён, база ушла с карты.
    else if (now.projects < prev.projects) void sounds.play('collapseSmall');
    // Заложено здание: крестьянин ставит фундамент.
    if (now.construction && now.construction !== prev.construction) {
      void sounds.play('place');
      void sounds.play('hammer', 0.5);
    }
    // Новый трофей в инвентаре героя, после фанфар победы.
    if (now.trophies > prev.trophies) void sounds.play('item', 2.5);
    // В шахте базы осталась последняя задача: как «Шахта истощается» в WC3.
    for (const [id, n] of now.queued) {
      const was = prev.queued.get(id) ?? 0;
      if (n === 1 && was >= 2) {
        const p = store.project(id);
        store.say(`Золото на базе «${p?.name ?? ''}» заканчивается: осталась последняя задача. Найми новых юнитов.`);
        void sounds.play('goldlow');
        void sounds.warning('goldminelow');
        break;
      }
    }
    // «Наш герой пал»: мана кончилась, герой ушёл на алтарь.
    if (now.heroFallen && !prev.heroFallen) void sounds.warning('herodies');
    prev = now;
  });

  // Фон окружения раз в секунду: день и ночь по часам, дождь, мельница и ручей у камеры.
  const ambient = () => {
    const d = new Date();
    const day = daylight(d.getHours() + d.getMinutes() / 60);
    sounds.setAmbient({ day, night: 1 - day, rain: world.raining ? 1 : 0, ...world.ambientNear() });
  };
  ambient();
  window.setInterval(ambient, 1000);
}
