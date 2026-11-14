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
  '/shared/data-rpc-wrappers.js',
  '/shared/data-learning-map.js',
  '/shared/data-categories.js',
  '/shared/data-rubrics.js',
  '/shared/data-assessments.js',
  '/shared/data-config-settings.js',
  '/shared/data-observations.js',
  '/shared/data-term-ratings.js',
  '/shared/data-student-records.js',
  '/shared/data-student-cards.js',
  '/shared/data-student-work.js',
  '/shared/data-feedback-live.js',
  '/shared/data-markup.js',
  '/shared/data-reflect.js',
  '/shared/data-revisions.js',
  '/shared/data-roster.js',
  '/shared/data-withdrawn.js',
  '/shared/data-overrides.js',
  '/shared/data-profile-summaries.js',
  '/shared/data-courses-terms.js',
  '/shared/data-demo.js',
  '/shared/data-curriculum-index.js',
  '/shared/offline-queue.js',
  '/shared/overwrite-count.js',
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
  '/teacher/report-qn-browse-cases.js',
  '/teacher/report-qn-voice-observations.js',
  '/teacher/report-questionnaire.js',
  '/teacher/grade-report.js',
  '/teacher/report-preview.js',
  '/vendor/qrcode.js',
  '/shared/questionnaire-templates.js',
  '/shared/questionnaires.js',
  '/teacher/qr-slips.js',
  '/teacher/export-all.js',
  '/teacher/cm-questionnaires.js',
  '/teacher/student-cards.js',
  '/teacher/preview-student.js',
  '/teacher/cm-student-page.js',
  '/shared/student-voice.js',
  '/teacher/learner-profile.js',
  '/shared/phone-report-view.js',
  '/shared/backup-restore.js',
  '/teacher/cm-roster-file.js',
  '/teacher/cm-block-picker.js',
  '/teacher/cm-std-help.js',
  '/teacher/cm-terms.js',
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
  '/shared/obs-capture.js',
  '/shared/obs-card.js',
  '/teacher/student-evidence.js',
  '/teacher/competency-evidence.js',
  '/shared/work-wall.js',
  '/teacher/student-overrides.js',
  '/teacher/rubric-print.js',
  '/teacher/work-rubric-card.js',
  '/shared/competency-wording.js',
  '/teacher/report-feedback.js',
  '/teacher/report-feedback-cards.js',
  '/teacher/report-one.js',
  '/teacher/report-one-panel.js',
  '/teacher/report-one-page.js',
  '/teacher/report-one-comment.js',
  '/teacher/report-one-zoom.js',
  '/teacher/report-one-head.js',
  '/teacher/report-print-paper.js',
  '/teacher/report-one-zoom.css',
  '/teacher/report-one-panel.css',
  '/teacher/report-one-page.css',
  '/teacher/grades-print.js',
  '/teacher/rubric-library.js',
  '/teacher/rubric-bank.js',
  '/teacher/grading-setup-copy.js',
  '/teacher/page-dashboard.js',
  '/teacher/markup.js',
  '/teacher/expand-motion.js',
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
  '/teacher-mobile/tab-bar.js',
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

// Whether a response's Content-Type fits the address it answered. The host
// can answer a script's address with an HTML error, sign-in or quota page and
// status 200; keeping that would break the app until the next release. Only
// the media type is compared (no "; charset="), in any case. A missing type is
// refused for scripts, stylesheets and pages, and accepted for the rest. An
// address of a kind not listed here is accepted.
function typeFitsAddress(address, contentType) {
  const url = new URL(address, self.location.origin);
  const ext = (url.pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ext === undefined) {
    // A page route (the app shell's addresses, "/" or a folder) is a page.
    return isAppRoute(url) || url.pathname.endsWith('/') ? type === 'text/html' : true;
  }
  switch (ext.toLowerCase()) {
    case 'js':
    case 'mjs':
      return /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
    case 'css':
      return type === 'text/css';
    case 'html':
      return type === 'text/html';
    case 'json':
      return !type || /^application\/(.+\+)?json$/.test(type);
    case 'svg':
      return !type || type === 'image/svg+xml';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
    case 'avif':
    case 'ico':
      return !type || type.startsWith('image/');
    case 'woff':
    case 'woff2':
    case 'ttf':
    case 'otf':
      return (
        !type ||
        /^(font\/|application\/(x-)?font|application\/vnd\.ms-fontobject$|application\/octet-stream$)/.test(type)
      );
    default:
      return true;
  }
}

// A response fit to keep for this address: OK, and a type that fits it. Logs
// one warning naming the address and the type received when it does not.
function isFitToKeep(response, address) {
  if (!response || !response.ok) return false;
  const type = response.headers.get('Content-Type');
  if (typeFitsAddress(address, type)) return true;
  console.warn('Service worker: not keeping ' + address + '. It answered with ' + (type || 'no type') + '.');
  return false;
}

async function sha256(buffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Whether a response's bytes are the ones a fingerprint names. The response
// itself is left unread, to be stored or handed on.
async function hasFingerprint(response, want) {
  return (await sha256(await response.clone().arrayBuffer())) === want;
}

// One file for an install, or an error. The answer must be OK, of a type that
// fits the address and, for a file with a fingerprint, the bytes this release
// was built with. Status 200 and a script's type do not make it this
// release's file: a server or a cache on the way can answer with the previous
// release's bytes while a release goes out, and that copy would then be
// served on every load until the next release. A file whose bytes do not
// match is asked for once more under an address no cache has seen; still
// wrong, it fails the install. A page has no fingerprint (each answer carries
// its own nonce); one that names another release fails the install too.
async function downloadForInstall(url) {
  const want = PRECACHE_FINGERPRINTS ? PRECACHE_FINGERPRINTS[url] : null;
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!isFitToKeep(response, url)) throw new Error('Service worker: ' + url + ' is not the file it should be.');
  if (!want) {
    const release = await releaseNamedBy(response);
    if (release && release !== CACHE_NAME) throw new Error('Service worker: ' + url + ' is from another release.');
    return response;
  }
  if (await hasFingerprint(response, want)) return response;
  const again = await fetch(
    new Request(url + (url.includes('?') ? '&' : '?') + 'sw=' + encodeURIComponent(want), { cache: 'reload' }),
  );
  if (isFitToKeep(again, url) && (await hasFingerprint(again, want))) return again;
  console.warn('Service worker: not keeping ' + url + ". Its bytes are not this release's.");
  throw new Error('Service worker: ' + url + " is not this release's file.");
}

async function downloadAll(cache, urls) {
  // Like addAll, nothing is stored if any download fails, is not a 200, has a
  // type that does not fit or is not this release's bytes. So this version
  // never takes over with a page where a script should be, or with another
  // release's file among its own, and the previous one keeps working.
  const responses = await Promise.all(urls.map(downloadForInstall));
  await Promise.all(responses.map((response, i) => cache.put(urls[i], response)));
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
      if (!isWholeCopy(stored, url) || !isFitToKeep(stored, url)) continue;
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
  // The page still gets what the host sent; the cache does not keep a type
  // that does not fit the address.
  if (!isFitToKeep(response, response.url || (typeof request === 'string' ? request : request.url))) return;
  // Keeping a copy must never cost the page its answer.
  try {
    const clone = response.clone();
    caches
      .open(CACHE_NAME)
      .then(cache => cache.put(request, clone))
      .catch(() => {});
  } catch {
    // Not kept.
  }
}

// ── The saved copy first, with a guard (docs/plans/caching-plan.md, (a)) ──
//
// A file this release's install saved is answered from that copy without
// asking the network, but only for a page known to belong to this release.
// Pages are always asked of the network first, and each names its release in
// a tag scripts/build.sh fills in with this worker's cache name:
//   <meta name="fv-release" content="fullvision-…" />
// The worker reads that tag from the page it hands to the browser and
// remembers it under the browser's id for that page. A file is answered from
// the saved copy only when all of these hold; anything else takes the network
// first, as every request did before:
//   - the address has a fingerprint: the install saved it and it is not a
//     page (the source, served directly, has none, so nothing changes there);
//   - the page asking is one this worker handed over, and it named this
//     release;
//   - the copy is in this release's cache.
// Every copy of an installed file in that cache has this release's bytes:
// the install, the install done again and the one write at run time
// (keepIfThisRelease) each check the fingerprint first, and nothing else
// writes under an installed file's address.
// So a page from a newer release, a page with no tag, and a page the worker
// has lost track of (the browser stops an idle worker, and it starts again
// with nothing remembered) all get their files from the network. No page runs
// new HTML beside this release's saved files: a page that named another
// release is never given this release's copy of an installed file, not even
// when the network fails.
const RELEASE_TAG = /<meta name="fv-release" content="([^"]*)"/;

// The release each open page named: the browser's id for the page -> name.
// Kept in memory only. A page that is not here uses the network.
const pageReleases = new Map();
const PAGES_REMEMBERED = 100;

function rememberPage(clientId, release) {
  if (!clientId) return;
  pageReleases.delete(clientId);
  if (!release) return;
  pageReleases.set(clientId, release);
  // The oldest page is forgotten first.
  while (pageReleases.size > PAGES_REMEMBERED) pageReleases.delete(pageReleases.keys().next().value);
}

// The release a page names, or null: not a good HTML answer, no tag, or it
// could not be read.
async function releaseNamedBy(response) {
  try {
    if (!response || !response.ok) return null;
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'text/html') return null;
    const named = (await response.clone().text()).match(RELEASE_TAG);
    return named && named[1] ? named[1] : null;
  } catch {
    return null;
  }
}

// This release's saved copy of an address, or null. Only this release's cache
// is read, never a newer one still being filled. The address is the whole
// key, query string included; the host's Vary header is not part of it.
async function savedCopy(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request, { ignoreVary: true })) || null;
  } catch {
    return null;
  }
}

// A file the install saved for this release: its address has a fingerprint.
function isInstalledFile(url) {
  return (
    !!PRECACHE_FINGERPRINTS &&
    url.origin === self.location.origin &&
    Object.prototype.hasOwnProperty.call(PRECACHE_FINGERPRINTS, url.pathname + url.search)
  );
}

// ── An install that is gone ──
//
// Sign Out and Leave Demo Mode delete every cache on the device
// (shared/supabase.js signOut), this release's install with them, and the
// browser does not run an install again until the next release. So the worker
// does. When a page of this release asks for an installed file and the copy
// is missing, it looks for the record a finished install writes last and,
// finding none, installs again behind the page. It is the same install: a
// file is copied from another finished cache or downloaded, every one is
// checked against its fingerprint, nothing is stored unless every one is
// right, and the record is written last. Until it is done, a missing file
// comes from the network and is kept when its bytes are this release's.
// One try each time the browser starts the worker: a try that fails (the
// network is down, or already serving the next release) is left for the next
// start, or for the next release's own install.
let reinstall = null;
let reinstallFailed = false;

// Keep the worker running until work behind a request is done.
function stayAwakeFor(event, work) {
  try {
    event.waitUntil(work);
  } catch {
    // The work goes on for as long as the worker runs.
  }
}

function reinstallIfGone(event) {
  if (!PRECACHE_FINGERPRINTS || reinstall || reinstallFailed) return;
  reinstall = (async () => {
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match(FINGERPRINTS_KEY)) return;
    await precacheKeepingUnchanged();
  })()
    .catch(() => {
      reinstallFailed = true;
    })
    .then(() => {
      reinstall = null;
    });
  stayAwakeFor(event, reinstall);
}

// The network's answer for an installed file whose copy is missing, kept when
// its bytes are this release's. Any other bytes go to the page and are not
// kept: the network may already be serving the next release.
function keepIfThisRelease(event, url, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  const address = url.pathname + url.search;
  if (!isFitToKeep(response, address)) return;
  try {
    const copy = response.clone();
    stayAwakeFor(
      event,
      (async () => {
        if (!(await hasFingerprint(copy, PRECACHE_FINGERPRINTS[address]))) return;
        await (await caches.open(CACHE_NAME)).put(address, copy);
      })().catch(() => {}),
    );
  } catch {
    // Not kept.
  }
}

// A page: the network first, the saved page when the network fails.
async function answerPage(event, url, cacheKey) {
  const isNavigation = event.request.mode === 'navigate';
  let response;
  try {
    response = await fetch(event.request);
  } catch {
    // Network failed: the saved page, and the saved files with it when it
    // names this release.
    const saved = await savedCopy(cacheKey);
    if (isNavigation) rememberPage(event.resultingClientId, await releaseNamedBy(saved));
    return (
      saved ||
      new Response('Offline — please check your connection.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
  const release = await releaseNamedBy(response);
  if (isNavigation) rememberPage(event.resultingClientId, release);
  // An installed file opened as a page (its address typed into a tab) is not
  // kept: the network may be serving the next release's file, and the
  // install's copy is never written over. The key here has no query string,
  // so the address asked for and the key are both checked.
  if (isInstalledFile(url) || isInstalledFile(new URL(cacheKey, self.location.origin))) return response;
  // A page from another release is not kept: offline, the saved page must be
  // the one the saved files belong to. One of this release's own pages that
  // arrives with no tag is from a release without tags (an undo of this
  // build): not kept either, or offline it would run this release's files.
  // Pages no release tags ("/", help, s/) are kept as before.
  const tagged = !!PRECACHE_FINGERPRINTS && cacheKey !== '/' && PRECACHE_URLS.includes(cacheKey);
  if (release === CACHE_NAME || (!release && !tagged)) cacheIfGood(cacheKey, response);
  return response;
}

// Anything else: the saved copy first when the guard allows it, otherwise the
// network first with the saved copy as the fallback.
async function answerFile(event, url) {
  const installed = isInstalledFile(url);
  const named = pageReleases.get(event.clientId);
  let missing = false;
  if (installed && named === CACHE_NAME) {
    const saved = await savedCopy(event.request);
    if (saved) return saved;
    missing = true;
    reinstallIfGone(event);
  }
  try {
    const response = await fetch(event.request);
    // The install's copies are never replaced at run time: the network may
    // already be serving the next release, and this cache must stay exactly
    // this one. A missing copy is put back only when the answer's bytes are
    // this release's. A file the install did not save is kept when first used.
    if (!installed) cacheIfGood(event.request, response);
    else if (missing) keepIfThisRelease(event, url, response);
    return response;
  } catch {
    // A page that named another release never gets this release's copy of an
    // installed file, even when the network fails: a missing file is loud, a
    // mix of releases is not.
    const saved = installed && named && named !== CACHE_NAME ? null : await savedCopy(event.request);
    return saved || new Response('', { status: 503 });
  }
}

// Fetch strategy:
// - Supabase API calls, and anything but a GET: left to the browser, never
//   cached
// - HTML pages: network first, fall back to the saved page
// - Files the install saved, asked for by a page of this release: the saved
//   copy, no network (the guard above)
// - Everything else: network first, fall back to the saved copy
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

  if (
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))
  ) {
    event.respondWith(answerPage(event, url, pageKey(url)));
    return;
  }

  event.respondWith(answerFile(event, url));
});

// Listen for version update messages
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
