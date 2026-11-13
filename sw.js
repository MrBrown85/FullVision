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
  '/favicon.svg',
  '/assets/icons/apple-touch-icon.png',
  '/vendor/supabase.min.js',
  '/curriculum_by_course.json',
  '/curriculum_crosswalk.json',
  // Shared modules
  '/shared/sentry-init.js',
  '/shared/html.js',
  '/shared/link-nav.js',
  '/shared/supabase.js',
  '/shared/sign-in.js',
  '/shared/device.js',
  '/launch.html',
  '/shared/constants.js',
  '/shared/reporting-term-presets.js',
  '/shared/data-utilities.js',
  '/shared/data.js',
  '/shared/data-learning-map.js',
  '/shared/data-categories.js',
  '/shared/data-rubrics.js',
  '/shared/data-observations.js',
  '/shared/data-term-ratings.js',
  '/shared/data-student-records.js',
  '/shared/data-student-cards.js',
  '/shared/data-demo.js',
  '/shared/data-curriculum-index.js',
  '/shared/offline-queue.js',
  '/shared/photo-shrink.js',
  '/shared/photo-queue.js',
  '/shared/photo-readers.js',
  // The PDF reader's library and worker (vendor/pdfjs/README.md), so a PDF
  // chosen offline still becomes pages. Fetched only when a PDF is opened,
  // but cached here at install like the other vendor files. The scan
  // decoders, fonts and character maps beside them are cached when first
  // used.
  '/vendor/pdfjs/pdf.min.js',
  '/vendor/pdfjs/pdf.worker.min.js',
  '/shared/work-thumbs.js',
  '/shared/markup-draw.js',
  '/shared/auto-update.js',
  '/shared/calc.js',
  '/shared/grade-state.js',
  '/shared/grader.js',
  '/shared/rubric-draft.js',
  '/shared/rubric-checks.js',
  '/shared/core-self.js',
  '/shared/student-view.js',
  '/s/page-view.js',
  '/s/send.js',
  '/s/feedback.js',
  '/s/handouts.js',
  '/s/reflect.js',
  '/s/page-view.css',
  '/shared/loading-screen.js',
  '/shared/loading-screen.css',
  // Teacher desktop
  '/teacher/app.html',
  '/teacher/styles.css?v=3',
  '/teacher/dashboard.css',
  '/teacher/assignments.css',
  '/teacher/student.css',
  '/teacher/work-wall.css',
  '/teacher/gradebook.css',
  '/teacher/class-results.css',
  '/teacher/observations.css',
  '/teacher/obs-capture.css',
  '/teacher/reports.css',
  '/teacher/rubric-print.css',
  '/teacher/qr-slips.css',
  '/teacher/preview-student.css',
  '/shared/phone-report.css',
  '/teacher/grades-print.css',
  '/teacher/ui.js',
  '/teacher/report-scores.js',
  '/teacher/drafts-before-print.js',
  '/teacher/report-blocks.js',
  '/teacher/report-sheets.js',
  '/teacher/report-issues.js',
  '/shared/comment-bank.js',
  // Demo Mode's sample class (DEFAULT_COURSES) is read from this file on
  // every start, never from the saved classes, so an offline start needs
  // it. The address is exactly the one shared/data-demo.js _loadSeedScript asks.
  '/shared/seed-data.js?v=46',
  '/teacher/comment-realiser.js',
  '/teacher/comment-lint.js',
  '/shared/bank-comment.js',
  '/shared/bank-core-competencies.js',
  // Loaded on demand, never by a page's tags, and needed offline: without
  // them an offline teacher gets other words, not an error. Generate drafts
  // from each course set's wording (comment-bank.js loadSets); printed Tag
  // Rubrics and the level hovers on both apps use the bank's four
  // descriptors (competency-wording.js loadBank); the class's Excel export
  // needs its library (export-all.js).
  '/shared/bank-sets.js',
  '/shared/bank-proficiency.js',
  '/vendor/exceljs.min.js',
  '/teacher/comment-bank.js',
  '/teacher/comment-personal.js',
  '/teacher/report-questionnaire.js',
  '/teacher/report-studio.js',
  '/teacher/grade-report.js',
  '/teacher/report-preview.js',
  '/vendor/qrcode.js',
  '/shared/questionnaire-templates.js',
  '/teacher/questionnaires.js',
  '/teacher/qr-slips.js',
  '/teacher/export-all.js',
  '/teacher/cm-questionnaires.js',
  '/teacher/student-cards.js',
  '/teacher/preview-student.js',
  '/teacher/cm-student-page.js',
  '/teacher/student-voice.js',
  '/teacher/learner-profile.js',
  '/shared/phone-report-view.js',
  '/teacher/phone-reports.js',
  '/shared/backup-restore.js',
  '/teacher/cm-roster-file.js',
  '/teacher/cm-block-picker.js',
  '/teacher/dash-class-manager.js',
  '/teacher/dash-overview.js',
  '/teacher/dash-observations.js',
  '/teacher/dash-student-cards.js',
  '/teacher/dash-insights.js',
  '/teacher/assign-collab.js',
  '/teacher/assessment-copy.js',
  '/teacher/factor-field.js',
  '/teacher/class-results.js',
  '/teacher/rubric-guard.js',
  '/teacher/obs-capture.js',
  '/teacher/obs-card.js',
  '/teacher/student-evidence.js',
  '/teacher/competency-evidence.js',
  '/teacher/work-wall.js',
  '/teacher/student-overrides.js',
  '/teacher/rubric-print.js',
  '/teacher/competency-wording.js',
  '/teacher/report-feedback.js',
  '/teacher/report-feedback-cards.js',
  '/teacher/report-one.js',
  '/teacher/report-one-panel.js',
  '/teacher/report-one-page.js',
  '/teacher/report-one-comment.js',
  '/teacher/report-one-panel.css',
  '/teacher/report-one-page.css',
  '/teacher/grades-print.js',
  '/teacher/rubric-library.js',
  '/teacher/rubric-bank.js',
  '/teacher/grading-setup-copy.js',
  '/teacher/page-dashboard.js',
  '/teacher/markup.js',
  '/teacher/page-assignments.js',
  '/teacher/assign-descriptor-bar.js',
  '/teacher/assign-competency-picker.js',
  '/teacher/page-student.js',
  '/teacher/student-edit-dialog.js',
  '/teacher/student-groups.js',
  '/teacher/page-gradebook.js',
  '/teacher/gradebook-chrome.js',
  '/teacher/gradebook-csv.js',
  '/teacher/page-observations.js',
  '/teacher/page-starters.js',
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
  '/teacher-mobile/sweep.js',
  '/teacher-mobile/grade-photos.js',
  '/teacher-mobile/add-work.js',
  '/teacher-mobile/markup.js',
  '/teacher-mobile/tab-grade.js',
  '/teacher-mobile/shell.js',
];

// The desktop app's pages (teacher/router.js _routes). Each is app.html under
// another address, so one cached copy serves them all: the copy is stored as
// /teacher/app.html, and an offline reload of /gradebook?course=… gets it.
const APP_SHELL = '/teacher/app.html';
const APP_ROUTES = [
  '/dashboard',
  '/assignments',
  '/student',
  '/gradebook',
  '/observations',
  '/observations/starters',
  '/reports',
];

function isAppRoute(url) {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  return url.origin === self.location.origin && APP_ROUTES.includes(path);
}

// The address a page of this site is cached under, the one PRECACHE_URLS
// names: the desktop app's routes share app.html; a folder is its
// index.html (/teacher-mobile/ is /teacher-mobile/index.html, as the server
// serves it); the query string is dropped, since the server sends the same
// page for any query (/login.html?demo=1 is /login.html). Without this, the
// phone app, opened as /teacher-mobile/, and Demo Mode, opened as
// /login.html?demo=1, missed the precached copies offline.
function pageKey(url) {
  if (url.origin !== self.location.origin) return url.href;
  if (isAppRoute(url)) return APP_SHELL;
  return url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
}

// scripts/build.sh replaces this line in dist/sw.js with each precached
// file's fingerprint (scripts/sw-fingerprints.mjs): { address: SHA-256 of the
// file in base64 }. HTML pages have none. null (the source, served directly
// in development and by tests) installs exactly as before fingerprints.
const PRECACHE_FINGERPRINTS = null;

// Where a finished install records the fingerprints it was built with, inside
// its own cache, for the next version's install to read. Written last, so a
// cache that has it is complete.
const FINGERPRINTS_KEY = '/__sw-precache-fingerprints.json';

function downloadAll(cache, urls) {
  // addAll fails, and stores nothing, if any download fails or is not a 200.
  return cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
}

async function sha256(buffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// The other versions' caches that finished an install with fingerprints,
// newest first. A cache from a worker without fingerprints, or one whose
// install never finished, has no record and is never copied from.
async function previousCaches() {
  const found = [];
  for (const name of (await caches.keys()).filter(key => key !== CACHE_NAME).reverse()) {
    try {
      const cache = await caches.open(name);
      const record = await cache.match(FINGERPRINTS_KEY);
      const files = record && (await record.json()).files;
      if (files && typeof files === 'object') found.push({ cache, files });
    } catch {
      // An unreadable record: that cache is not used.
    }
  }
  return found;
}

// A stored copy fit to keep: a complete 200 from this site for exactly this
// address (query string included), not opaque, partial or redirected.
function isWholeCopy(response, url) {
  return (
    !!response &&
    response.status === 200 &&
    response.type === 'basic' &&
    !response.redirected &&
    response.url === new URL(url, self.location.origin).href
  );
}

// Copy url from a previous cache when the old version recorded the same
// fingerprint and the stored bytes themselves hash to it. True when copied;
// false sends the address to the download list.
async function keepUnchanged(cache, sources, url) {
  const want = PRECACHE_FINGERPRINTS[url];
  if (!want) return false;
  for (const source of sources) {
    if (source.files[url] !== want) continue;
    try {
      const stored = await source.cache.match(url);
      if (!isWholeCopy(stored, url)) continue;
      // The copy put in the cache is the same stream as the bytes hashed.
      const copy = stored.clone();
      if ((await sha256(await stored.arrayBuffer())) !== want) continue;
      await cache.put(url, copy);
      return true;
    } catch {
      // Any error: download it instead.
    }
  }
  return false;
}

async function precacheKeepingUnchanged() {
  const cache = await caches.open(CACHE_NAME);
  const sources = await previousCaches();
  const kept = await Promise.all(PRECACHE_URLS.map(url => keepUnchanged(cache, sources, url)));
  await downloadAll(
    cache,
    PRECACHE_URLS.filter((url, i) => !kept[i]),
  );
  await cache.put(
    FINGERPRINTS_KEY,
    new Response(JSON.stringify({ files: PRECACHE_FINGERPRINTS }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// Install: pre-cache all app files. Built, it copies the files that did not
// change from the previous version's cache and downloads the rest; any failed
// download fails the install, so this version never takes over with a partial
// cache and the previous one keeps working.
self.addEventListener('install', event => {
  event.waitUntil(
    (PRECACHE_FINGERPRINTS
      ? precacheKeepingUnchanged()
      : caches.open(CACHE_NAME).then(cache => downloadAll(cache, PRECACHE_URLS))
    ).then(() => self.skipWaiting()),
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
    const cacheKey = pageKey(url);
    event.respondWith(
      fetch(event.request)
        .then(response => {
          cacheIfGood(cacheKey, response);
          return response;
        })
        .catch(() => {
          // Network failed — serve from cache
          return caches.match(cacheKey).then(
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
