const CACHE_NAME = 'stock-trader-v2';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.log('Cache addAll error (non-fatal):', err);
            });
        }).then(() => {
            return self.skipWaiting();
        })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch event - network first, then cache
self.addEventListener('fetch', (event) => {
    // Skip non-HTTP requests (chrome-extension, etc.)
    if (!event.request.url.startsWith('http')) {
        return;
    }

    // Skip WebSocket connections
    if (event.request.url.includes('ws')) {
        return;
    }

    // Skip API calls - let them go directly to network
    if (event.request.url.includes('/api/')) {
        return;
    }

    // For everything else: network first, fallback to cache
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response.status === 200 && event.request.method === 'GET') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone).catch(() => {
                            // Ignore cache put errors
                        });
                    });
                }
                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Return a simple offline page for navigation requests
                    if (event.request.mode === 'navigate') {
                        return new Response(
                            '<html><body style="background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><div style="text-align:center"><h1>📱</h1><p>You are offline</p></div></body></html>',
                            { headers: { 'Content-Type': 'text/html' } }
                        );
                    }
                    return new Response('', { status: 408 });
                });
            })
    );
});