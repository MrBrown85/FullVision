// IMPORTANT: Increment the version number when deploying new app code
// This ensures users get the latest files
const CACHE_NAME = 'teacherdashboard-v4';

// All app files to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/app.html',
  '/index.html',
  '/settings.html',
  '/student.html',
  '/spreadsheet.html',
  '/observations.html',
  '/reports.html',
  '/login.html',
  '/gb-styles.css',
  '/dashboard.css',
  '/assignments.css',
  '/student.css',
  '/gradebook.css',
  '/observations.css',
  '/reports.css',
  '/login.css',
  '/gb-constants.js',
  '/gb-data.js',
  '/gb-calc.js',
  '/gb-ui.js',
  '/gb-supabase.js',
  '/gb-seed-data.js',
  '/gb-router.js',
  '/page-dashboard.js',
  '/page-assignments.js',
  '/page-student.js',
  '/page-gradebook.js',
  '/page-observations.js',
  '/page-reports.js',
  '/curriculum_data.js',
  '/vendor/supabase.min.js',
  '/manifest.json',
  '/dash-overview.js',
  '/dash-class-manager.js',
  '/dash-curriculum-wizard.js',
  '/assign-form.js',
  '/assign-scoring.js',
  '/assign-rubric-editor.js',
  '/report-blocks.js',
  '/report-builder.js',
  '/report-narrative.js'
];

// Install: pre-cache all app files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - HTML pages: Network first, fall back to cache (always get latest)
// - JS/CSS files: Cache first, fall back to network (fast loads)
// - Supabase API calls: Network only (never cache data)
// - Curriculum JSON: Cache first (rarely changes)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls — these are live data
  if (url.hostname.includes('supabase.co')) {
    return; // Let the browser handle it normally
  }

  // Never cache POST/PUT/DELETE requests
  if (event.request.method !== 'GET') {
    return;
  }

  // HTML pages: network first, cache fallback
  if (event.request.mode === 'navigate' ||
      (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the fresh copy
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Network failed — serve from cache
          return caches.match(event.request).then(cached =>
            cached || new Response('Offline — please check your connection.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            })
          );
        })
    );
    return;
  }

  // JS, CSS, and other assets: network first, cache fallback
  // This ensures users always get the latest code on deploy
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached =>
          cached || new Response('', { status: 503 })
        );
      })
  );
});

// Listen for version update messages
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
