const CACHE = 'point-bloom-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
	e.waitUntil(
		(async () => {
			for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (e) => {
	const r = e.request;
	if (r.method !== 'GET' || r.headers.has('range')) return;
	const u = new URL(r.url);
	if (u.origin !== location.origin || u.pathname.startsWith('/vendor/mediapipe/')) return;
	e.respondWith(
		(async () => {
			try {
				const res = await fetch(r);
				if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(r, res.clone());
				return res;
			} catch (err) {
				const hit = await caches.match(r);
				if (hit) return hit;
				if (r.mode === 'navigate') {
					const idx = await caches.match('/');
					if (idx) return idx;
				}
				throw err;
			}
		})()
	);
});
