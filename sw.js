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
// в index.html) — переводим фокус на уже открытую вкладку, если она есть,
// иначе открываем новую. Полноценный переход сразу в нужный чат по chatId —
// отдельная задача на потом (там, где появится настоящий push с сервера).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
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
