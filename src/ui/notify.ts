// Уведомления браузера, пока игра открыта, хоть в фоновой вкладке или свёрнутом
// приложении: «Ты ещё работаешь?», метеор Инфернала и утреннее планирование.
// Закрытая игра прислать ничего не может: для этого нужен сервер push-уведомлений.
// Настройки свои у каждого устройства, поэтому лежат в localStorage, а не в сохранении.

import { BALANCE } from '../state/config';
import { activeTaskOf, gameDay, idleGuardTripped, isOpen, localDay, meteorOf } from '../state/economy';
import { plural, type Store } from '../state/store';

export type NotifyKind = 'guard' | 'meteor' | 'morning';

export const NOTIFY_KINDS: { id: NotifyKind; name: string }[] = [
  { id: 'guard', name: '«Ты ещё работаешь?», когда рабочие сели отдыхать' },
  { id: 'meteor', name: 'Метеор Инфернала над базой' },
  { id: 'morning', name: 'Утреннее планирование' },
];

const PREFS = 'taskcraft.notify';
const SENT = 'taskcraft.notified';

function load<T extends object>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим */
  }
}

export function notifySupported(): boolean {
  return 'Notification' in window;
}

export function notifyPrefs(): Record<NotifyKind, boolean> {
  return load(PREFS, { guard: false, meteor: false, morning: false });
}

/** Включает или выключает вид уведомлений; при первом включении браузер спрашивает разрешение. */
export async function setNotify(kind: NotifyKind, on: boolean): Promise<NotificationPermission> {
  save(PREFS, { ...notifyPrefs(), [kind]: on });
  if (on && Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

/** Через сервис-воркер, если он есть (на Android иначе нельзя, и там работают кнопки), иначе напрямую. */
async function show(title: string, body: string, tag: string, actions: { action: string; title: string }[] = []) {
  const options = { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png', renotify: true, actions };
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) return reg.showNotification(title, options as NotificationOptions);
  const n = new Notification(title, options as NotificationOptions);
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

type Sent = { guard: number; morning: string; meteors: Record<string, string> };

export class Notifier {
  private sent: Sent = load(SENT, { guard: 0, morning: '', meteors: {} });

  constructor(private store: Store) {
    window.setInterval(() => this.check(), 15_000);
    document.addEventListener('visibilitychange', () => this.check());
    // Кнопка «Да, работаю» в самом уведомлении: сервис-воркер передаёт нажатие сюда.
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data?.type === 'confirm-working') store.confirmWorking();
    });
    this.check();
  }

  /**
   * Каждое событие отмечается отправленным, даже если игра на виду: тогда его и так
   * видно на экране, а потом, в фоне, оно не должно прийти запоздало.
   */
  check() {
    const s = this.store.state;
    const prefs = notifyPrefs();
    const away = document.visibilityState === 'hidden' || !document.hasFocus();
    const allowed = notifySupported() && Notification.permission === 'granted' && away;
    let changed = false;

    // Рабочие сели отдыхать: одно уведомление на каждую отметку «я ещё работаю».
    const heroBase = s.hero.fallenAt ? null : s.hero.baseId;
    if (heroBase && activeTaskOf(s, heroBase) && !s.onBreak && idleGuardTripped(s) && this.sent.guard !== s.lastConfirmAt) {
      this.sent.guard = s.lastConfirmAt;
      changed = true;
      if (allowed && prefs.guard)
        void show('Ты ещё работаешь?', `${BALANCE.idleGuardMinutes} минут без отметок, рабочие сели отдыхать и добыча стоит.`, 'guard', [
          { action: 'confirm', title: 'Да, работаю' },
        ]);
    }

    // Утро: игровой день начался, а план на него ещё не составлен.
    const day = gameDay(s);
    if (s.lastLegionDay && s.dayPlan?.day !== day && this.sent.morning !== day) {
      this.sent.morning = day;
      changed = true;
      if (allowed && prefs.morning) void show('Доброе утро!', 'Время планирования: выбери задачи на сегодня, за план дают дерево.', 'morning');
    }

    // Метеор: раз в день по каждой задаче, над которой он висит.
    const today = localDay();
    for (const p of s.projects) {
      const m = meteorOf(s, p.id, today);
      if (!m || this.sent.meteors[m.task.id] === today) continue;
      this.sent.meteors[m.task.id] = today;
      changed = true;
      const left = m.daysLeft === 0 ? 'срок сегодня' : `до срока ${m.daysLeft} ${plural(m.daysLeft, 'день', 'дня', 'дней')}`;
      if (allowed && prefs.meteor)
        void show(`☄ Метеор над базой «${p.name}»`, `«${m.task.title}»: ${left}. Сделай её, и метеор сгорит в воздухе.`, `meteor-${m.task.id}`);
    }
    for (const id of Object.keys(this.sent.meteors)) {
      const t = this.store.task(id);
      if (!t || !isOpen(t)) {
        delete this.sent.meteors[id];
        changed = true;
      }
    }
    if (changed) save(SENT, this.sent);
  }
}
