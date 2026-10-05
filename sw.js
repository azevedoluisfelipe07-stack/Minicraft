/* MiniCraft - Service Worker
 * Para publicar uma atualização do jogo, mude o número em CACHE_VERSION.
 * O cache antigo do MiniCraft é apagado automaticamente na ativação. */
const CACHE_VERSION = 'v9.89-1';
const CACHE_NAME = 'minicraft-under-construction-' + CACHE_VERSION;

// Arquivos do próprio app (index.html é obrigatório; o resto é opcional)
const APP_SHELL = ['./manifest.json'];
const OPTIONAL = ['./favicon.jpeg'];

// Biblioteca externa usada pelo jogo (three.js r128)
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

async function putFromNetwork(cache, url) {
  let res;
  try {
    res = await fetch(new Request(url, { cache: 'reload' }));
  } catch (e) {
    // Se o CDN não responder com CORS, guarda a resposta opaca (funciona para <script>)
    res = await fetch(new Request(url, { mode: 'no-cors' }));
  }
  if (res && (res.ok || res.type === 'opaque')) {
    await cache.put(url, res.clone());
    return true;
  }
  throw new Error('Falha ao baixar ' + url);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Obrigatório: se falhar, o SW não instala e tenta de novo depois
    await cache.add(new Request('./index.html', { cache: 'reload' }));
    await Promise.all([
      ...APP_SHELL.map(u => putFromNetwork(cache, u).catch(() => {})),
      ...OPTIONAL.map(u => putFromNetwork(cache, u).catch(() => {})),
      putFromNetwork(cache, THREE_URL).catch(() => {})
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('minicraft-') && k !== CACHE_NAME).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isThree = req.url === THREE_URL;
  if (!sameOrigin && !isThree) return; // qualquer outro pedido segue normalmente pela rede

  // Abertura do app / navegação: usa o index.html do cache (funciona offline)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./index.html');
      const update = fetch(new Request('./index.html', { cache: 'reload' }))
        .then(res => { if (res && res.ok) cache.put('./index.html', res.clone()); return res; })
        .catch(() => null);
      if (cached) { event.waitUntil(update); return cached; }
      const fresh = await update;
      return fresh || new Response('MiniCraft offline: abra o jogo uma vez com internet.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })());
    return;
  }

  // three.js (versão fixa): cache primeiro
  if (isThree) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req.url);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
      return res;
    })());
    return;
  }

  // Demais arquivos do app: cache primeiro, atualizando em segundo plano
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    const update = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(update); return cached; }
    const fresh = await update;
    return fresh || new Response('', { status: 504 });
  })());
});
