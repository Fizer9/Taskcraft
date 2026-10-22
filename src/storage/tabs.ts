// Игра открыта только в одной вкладке: две вкладки держат по своей копии игры и
// затирали бы сохранения друг друга. Вкладка, которая играет, раз в 2 секунды отмечается
// в localStorage. Новая вкладка, увидев живую отметку, предлагает «Играть здесь»: тогда
// старая сохраняется, замирает и показывает то же предложение, а новая перезагружается
// с её свежим сохранением.

const LOCK = 'taskcraft.tab';
/** Эта вкладка сама попросила перехватить игру: после перезагрузки она играет сразу. */
const TAKEOVER = 'taskcraft.takeover';
const BEAT_MS = 2000;
const ALIVE_MS = 6000;

type Lock = { id: string; at: number };

const tabId = Math.random().toString(36).slice(2, 10);

function readLock(): Lock | null {
  try {
    return JSON.parse(localStorage.getItem(LOCK) ?? 'null') as Lock | null;
  } catch {
    return null;
  }
}

function writeLock() {
  try {
    localStorage.setItem(LOCK, JSON.stringify({ id: tabId, at: Date.now() }));
  } catch {
    /* без localStorage вкладки и так не делят сохранение */
  }
}

const alive = (l: Lock | null) => !!l && l.id !== tabId && Date.now() - l.at < ALIVE_MS;

/** Окно поверх игры: «Играть здесь» перехватывает игру и перезагружает вкладку. */
function showBusy() {
  if (document.querySelector('.tab-busy')) return;
  const box = document.createElement('div');
  box.className = 'rescue tab-busy';
  box.innerHTML =
    '<h3>Игра открыта в другой вкладке</h3><p>Играть можно только в одной вкладке или окне, иначе они затирают сохранения друг друга.</p>' +
    '<div class="actions"><button class="btn" data-a="here">Играть здесь</button></div>';
  document.body.append(box);
  box.querySelector('button')!.addEventListener('click', () => {
    try {
      sessionStorage.setItem(TAKEOVER, '1');
    } catch {
      /* без sessionStorage просто перехватим отметку ниже */
    }
    writeLock();
    // Старая вкладка за это время сохраняет игру и замирает.
    window.setTimeout(() => location.reload(), 500);
  });
}

/**
 * Занять игру за этой вкладкой. Если она уже открыта в другой живой вкладке, показывает
 * предложение «Играть здесь» и не возвращается (вкладка перезагрузится по кнопке).
 * onLost вызывается, когда игру перехватила другая вкладка: сохраниться и замереть.
 */
export async function claimTab(onLost: () => void): Promise<void> {
  let takeover = false;
  try {
    takeover = sessionStorage.getItem(TAKEOVER) === '1';
    sessionStorage.removeItem(TAKEOVER);
  } catch {
    /* нет sessionStorage */
  }
  if (!takeover && alive(readLock())) {
    showBusy();
    await new Promise<never>(() => {});
  }
  writeLock();
  let lost = false;
  const lose = () => {
    if (lost) return;
    lost = true;
    window.clearInterval(beat);
    onLost();
    showBusy();
  };
  const beat = window.setInterval(() => {
    // Вкладку могли усыпить (телефон), а другая за это время заняла игру.
    if (alive(readLock())) lose();
    else writeLock();
  }, BEAT_MS);
  window.addEventListener('storage', (e) => {
    if (e.key === LOCK && alive(readLock())) lose();
  });
  window.addEventListener('pagehide', () => {
    if (!lost && readLock()?.id === tabId) {
      try {
        localStorage.removeItem(LOCK);
      } catch {
        /* ничего */
      }
    }
  });
}
