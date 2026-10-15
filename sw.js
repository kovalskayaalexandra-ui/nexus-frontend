// sw.js — локальное кэширование медиафайлов (голосовые, видео, кружочки,
// файлы, фото) прямо в браузере. Как в Telegram: скачали один раз —
// дальше показываем из локального хранилища, пока файл не изменился.
// Не трогает API-запросы к нашему бэкенду и не трогает сам сайт (HTML/JS/CSS) —
// только файлы из Supabase Storage.

const MEDIA_CACHE = 'nexus-media-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Тап по системному уведомлению о новом сообщении (см. notifyRealMessage()
// в index.html). 8 окт 2026: открывается ИМЕННО его чат — в уже открытом
// окне приложения (странице уходит {type:'open-chat'}), а если окна нет —
// новое окно в области приложения с ?open=<id> (раньше openWindow('/')
// открывал корень сайта github.io, а не приложение).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const chatId = data.chatId;
  const scope = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (!String(client.url || '').startsWith(scope)) continue;   // чужие страницы того же сайта
        if ('focus' in client) {
          if (chatId != null) client.postMessage({ type: 'open-chat', chatId, owner: data.owner });
          return client.focus();
        }
      }
      if (!self.clients.openWindow) return;
      if (chatId == null) return self.clients.openWindow(scope);
      return self.clients.openWindow(scope + '?open=' + encodeURIComponent(chatId) + (data.owner ? '&u=' + encodeURIComponent(data.owner) : ''));
    })
  );
});

// 14 окт 2026: Web Push — сервер присылает новое сообщение (заголовок, короткий
// текст, чат), когда приложение свёрнуто или закрыто. Окно приложения на экране —
// системное уведомление не нужно (страница покажет своё); свёрнуто, даже с этим же
// чатом, — показываем. Тег — чат: следующее сообщение того же чата заменяет
// уведомление и звучит снова.
// Safari (WebKit) не допускает push без уведомления — отзывает подписку; там
// уведомление показывается всегда (тег чата заменяет уведомление страницы).
const WEBKIT = /Safari\//.test(self.navigator && self.navigator.userAgent || '') && !/Chrome\/|Chromium\/|Android/.test(self.navigator && self.navigator.userAgent || '');
// Обрезка по символам Unicode и по границе графемы: эмодзи (суррогатные пары,
// ZWJ-последовательности, флаги, оттенки кожи) не разрезаются.
const GRAPHEMES = typeof Intl === 'object' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function clipText(s, n) {
  const cps = Array.from(s);
  if (cps.length <= n) return s;
  let out = '', len = 0;
  for (const g of GRAPHEMES ? Array.from(GRAPHEMES.segment(s), (x) => x.segment) : cps) {
    const l = Array.from(g).length;
    if (len + l > n) break;
    out += g; len += l;
  }
  return out || cps.slice(0, n).join('');
}
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  const scope = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const onScreen = clients.some((c) => String(c.url || '').startsWith(scope) && c.visibilityState === 'visible');
      if (onScreen && d.chatId != null && !WEBKIT) return;
      const title = typeof d.title === 'string' && d.title ? clipText(d.title, 120) : 'Монохром';
      const body = typeof d.body === 'string' && d.body ? clipText(d.body, 300) : 'Новое сообщение';
      const chatId = d.chatId != null ? d.chatId : null;
      return self.registration.showNotification(title, {
        body,
        tag: chatId != null ? 'chat-' + chatId : 'monochrome',
        renotify: true,
        silent: d.silent === true,
        icon: 'icon-192.png',
        badge: 'icon-monochrome-96.png',
        data: { chatId, owner: typeof d.owner === 'string' ? d.owner : '', messageId: typeof d.messageId === 'string' ? d.messageId : null },
      });
    })
  );
});

// Служба push сменила подписку (истекла, ключи обновились) — подписываемся заново
// теми же параметрами и просим открытые окна передать новую серверу; иначе сервер
// узнает её при следующем открытии приложения (pushSync в index.html), старая
// отпадёт сама (служба ответит 410).
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options || !options.applicationServerKey) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: options.applicationServerKey })
    .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .then((clients) => clients.forEach((c) => c.postMessage({ type: 'push-resync' })))
    .catch(() => {}));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Кэшируем только GET-запросы к файлам в Supabase Storage — не трогаем
  // ничего остального (API, сам сайт, сторонние ресурсы)
  const isStorageMedia = url.pathname.includes('/storage/v1/object/public/');
  if (event.request.method !== 'GET' || !isStorageMedia) {
    return; // пропускаем как обычно, браузер сам решит, что делать
  }

  event.respondWith(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached; // уже есть локально — сеть вообще не трогаем

      const response = await fetch(event.request);
      // Кэшируем только успешные ответы, ошибки сохранять смысла нет
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
  );
});
