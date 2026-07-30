/* Service worker PGR Compras Públicas.
   Estrategia: la API (/api) siempre va a la red; los recursos estáticos se
   cachean al vuelo (cache-first tras la primera carga) con respaldo offline
   al shell de la aplicación. Cambiar CACHE para forzar actualización. */
const CACHE = 'pgr-compras-v1';
const SHELL = '/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                 // no cachear mutaciones
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // solo mismo origen
  if (url.pathname.startsWith('/api')) return;          // la API siempre a la red

  // Navegaciones (HTML): red primero, respaldo al shell cacheado (offline).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(SHELL))
    );
    return;
  }

  // Recursos estáticos: cache primero, y si no, red (y se guarda copia).
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
    )
  );
});
