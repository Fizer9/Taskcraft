// Экран загрузки, как в WC3: картинка во весь экран, полоска загрузки и совет снизу.
// Полоска идёт по файлам графики (assets/loader.ts), экран уходит, когда стоит база:
// юниты, Легион и музыка догружаются уже в игре.

import { onArtProgress } from '../assets/loader';

const TIPS = [
  'Любое дело сначала записывается свитком: «Купить продукты #cook !1 @пт» сразу с проектом, уровнем и сроком.',
  'Там, где стоит герой, добыча идёт в полную силу. Переход героя на другую базу стоит маны: это цена переключения контекста.',
  'Просроченные задачи становятся демонами Пылающего Легиона. Чем дольше висит задача, тем сильнее демон.',
  'Молот бури: объяви лягушку дня и сделай её первой из серьёзных задач, чтобы получить награду.',
  'Привал (E) честно останавливает таймер. Если работать, пока мана не кончится, герой падает от истощения.',
  'Ферма даёт место ещё для нескольких юнитов. Без запаса провизии новых не нанять.',
  'Законсервированная база не добывает и не гниёт, а Легион к её задачам не приходит.',
  'Стройка в ратуше идёт только под таймером работы героя: здания растут, пока ты работаешь.',
  'Каждая задача в плане на день даёт дерево. Дерево платит за план.',
  'Утром планирование, вечером итоги дня. Раз в неделю глава с главными целями, раз в месяц совет земель.',
];

// Картинка экрана: щит Альянса с мечом и пером, рисуем сами, чтобы не ждать файлов.
const CREST = `<svg class="loading-art" viewBox="0 0 200 240" aria-hidden="true">
  <defs>
    <linearGradient id="ld-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".5" stop-color="#d9a234"/><stop offset="1" stop-color="#6d4310"/></linearGradient>
    <linearGradient id="ld-blue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f5fb8"/><stop offset="1" stop-color="#0c1f4a"/></linearGradient>
    <linearGradient id="ld-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d96a3"/><stop offset=".5" stop-color="#f3f6fa"/><stop offset="1" stop-color="#6c7480"/></linearGradient>
  </defs>
  <path d="M100 8 L186 30 Q188 150 100 232 Q12 150 14 30 Z" fill="url(#ld-gold)"/>
  <path d="M100 22 L172 40 Q172 142 100 214 Q28 142 28 40 Z" fill="url(#ld-blue)"/>
  <path d="M100 22 L172 40 Q172 142 100 214 Q28 142 28 40 Z" fill="none" stroke="#0a1430" stroke-width="2"/>
  <g transform="rotate(-32 100 118)">
    <path d="M96 40 L104 40 L104 150 L100 160 L96 150 Z" fill="url(#ld-steel)"/>
    <rect x="80" y="150" width="40" height="8" rx="3" fill="url(#ld-gold)"/>
    <rect x="96" y="158" width="8" height="26" fill="#4a2c12"/>
    <circle cx="100" cy="188" r="6" fill="url(#ld-gold)"/>
  </g>
  <g transform="rotate(32 100 118)">
    <path d="M100 44 Q120 80 106 150 L100 176 L94 150 Q80 80 100 44 Z" fill="#f2ead2"/>
    <path d="M100 52 L100 176" stroke="#9c8a62" stroke-width="2"/>
  </g>
  <path d="M70 18 L80 4 L90 14 L100 0 L110 14 L120 4 L130 18 Z" fill="url(#ld-gold)"/>
</svg>`;

export function showLoading(): { done: () => void } {
  const el = document.createElement('div');
  el.id = 'loading';
  el.innerHTML = `
    <div class="loading-title">Taskcraft</div>
    <div class="loading-sub">Повелитель задач</div>
    ${CREST}
    <div class="loading-bottom">
      <div class="loading-tip"><b>Совет.</b> ${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
      <div class="loading-bar"><span></span></div>
      <div class="loading-text">Загрузка…</div>
    </div>`;
  document.body.appendChild(el);
  const fill = el.querySelector('.loading-bar span') as HTMLElement;
  const text = el.querySelector('.loading-text') as HTMLElement;
  // Полоска только растёт: новые файлы в списке не должны откатывать её назад.
  let shown = 0;
  const stop = onArtProgress(({ started, finished }) => {
    if (!started) return;
    shown = Math.max(shown, finished / started);
    fill.style.width = `${Math.round(shown * 100)}%`;
    text.textContent = `Загрузка… ${Math.round(shown * 100)}%`;
  });
  return {
    done() {
      stop();
      fill.style.width = '100%';
      text.textContent = 'Готово';
      el.classList.add('gone');
      setTimeout(() => el.remove(), 700);
    },
  };
}
