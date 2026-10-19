// scripts/build.sh replaces this with a name built from the deploy's commit,
// so every deploy starts a fresh cache. This value only applies when the
// source is served directly (local development).
const CACHE_NAME = 'fullvision-dev';

// Every file the sign-in page, desktop app and mobile app load, exactly as
// they request it (query strings included). tests/sw-precache.test.js fails
// if a page loads something that isn't listed here.
const PRECACHE_URLS = [
  '/',
  '/login.html',
  '/login.css',
  '/login-auth.js',
  '/manifest.json',
  '/vendor/supabase.min.js',
  '/curriculum_by_course.json',
  // Shared modules
  '/shared/sentry-init.js',
  '/shared/supabase.js',
  '/shared/constants.js',
  '/shared/reporting-term-presets.js',
  '/shared/data.js',
  '/shared/offline-queue.js',
  '/shared/auto-update.js',
  '/shared/calc.js',
  '/shared/rubric-draft.js',
  // Teacher desktop
  '/teacher/app.html',
  '/teacher/styles.css?v=3',
  '/teacher/dashboard.css',
  '/teacher/assignments.css',
  '/teacher/student.css',
  '/teacher/gradebook.css',
  '/teacher/observations.css',
  '/teacher/obs-capture.css',
  '/teacher/reports.css',
  '/teacher/rubric-print.css',
  '/teacher/ui.js',
  '/teacher/report-blocks.js',
  '/teacher/report-questionnaire.js',
  '/teacher/report-builder-ui.js',
  '/teacher/report-preview.js',
  '/teacher/dash-class-manager.js',
  '/teacher/dash-overview.js',
  '/teacher/dash-student-cards.js',
  '/teacher/assign-collab.js',
  '/teacher/assessment-copy.js',
  '/teacher/rubric-guard.js',
  '/teacher/obs-capture.js',
  '/teacher/obs-card.js',
  '/teacher/student-evidence.js',
  '/teacher/student-overrides.js',
  '/teacher/rubric-print.js',
  '/teacher/rubric-library.js',
  '/teacher/page-dashboard.js',
  '/teacher/page-assignments.js',
  '/teacher/page-student.js',
  '/teacher/page-gradebook.js',
  '/teacher/page-observations.js',
  '/teacher/page-reports.js',
  '/teacher/router.js',
  // Teacher mobile
  '/teacher-mobile/index.html',
  '/teacher-mobile/styles.css',
  '/teacher-mobile/components.js',
  '/teacher-mobile/card-widgets.js',
  '/teacher-mobile/card-widget-editor.js',
  '/teacher-mobile/card-stack.js',
  '/teacher-mobile/students-list.js',
  '/teacher-mobile/student-detail.js',
  '/teacher-mobile/tab-students.js',
  '/teacher-mobile/tab-observe.js',
  '/teacher-mobile/tab-grade.js',
  '/teacher-mobile/shell.js',
];

// Install: pre-cache all app files
self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Store a fresh copy only if it's a real success from this site. Caching an
// error page (a Netlify 503, a 404) would replace the good copy and serve the
// error offline, or until the next deploy.
function cacheIfGood(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  const clone = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
}

// Fetch strategy:
// - HTML pages: Network first, fall back to cache (always get latest)
// - JS/CSS files: Network first, fall back to cache (always get latest)
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
  if (
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          cacheIfGood(event.request, response);
          return response;
        })
        .catch(() => {
          // Network failed — serve from cache
          return caches.match(event.request).then(
            cached =>
              cached ||
              new Response('Offline — please check your connection.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' },
              }),
          );
        }),
    );
    return;
  }

  // JS, CSS, and other assets: network first, cache fallback
  // This ensures users always get the latest code on deploy
  event.respondWith(
    fetch(event.request)
      .then(response => {
        cacheIfGood(event.request, response);
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => cached || new Response('', { status: 503 }));
      }),
  );
});

// Listen for version update messages
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
