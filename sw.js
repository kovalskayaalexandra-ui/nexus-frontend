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
