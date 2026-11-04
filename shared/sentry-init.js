/* ── shared/sentry-init.js — error reporting bootstrap ─────────
 *
 * Loads Sentry's CDN loader script asynchronously and initializes
 * the SDK once it arrives. Captures uncaught errors and unhandled
 * promise rejections automatically.
 *
 * To enable: paste your Sentry DSN into SENTRY_DSN below. The DSN
 * is a public key by design (Sentry's threat model assumes it ships
 * to clients), so committing it is fine.
 *
 * Skipped on localhost and 127.* to avoid drowning the project in
 * dev-mode noise. Flip ENABLE_ON_LOCALHOST to true when actively
 * testing the Sentry pipeline. */

(function () {
  var SENTRY_DSN = 'https://9f39b499781faa1a39607f208edb2cb8@o4511109636685824.ingest.de.sentry.io/4511300618747984';
  var ENABLE_ON_LOCALHOST = false;

  if (!SENTRY_DSN) return;
  if (!ENABLE_ON_LOCALHOST && /^(localhost|127\.)/.test(location.hostname)) return;

  var keyMatch = SENTRY_DSN.match(/^https:\/\/([^@]+)@/);
  if (!keyMatch) {
    console.warn('Sentry: malformed DSN, skipping init');
    return;
  }

  var loader = document.createElement('script');
  loader.src = 'https://js.sentry-cdn.com/' + keyMatch[1] + '.min.js';
  loader.crossOrigin = 'anonymous';
  loader.async = true;
  (document.head || document.documentElement).appendChild(loader);

  // Sentry's loader fires sentryOnLoad once the full SDK is fetched.
  window.sentryOnLoad = function () {
    var releaseMeta = document.querySelector('meta[name="sentry-release"]');
    Sentry.init({
      release: releaseMeta && releaseMeta.content ? releaseMeta.content : undefined,
      environment:
        location.hostname === 'fullvision.ca' || location.hostname === 'www.fullvision.ca'
          ? 'production'
          : /\.netlify\.app$/.test(location.hostname)
            ? 'preview'
            : 'development',
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      sendDefaultPii: false,
      beforeBreadcrumb: scrubBreadcrumb,
      beforeSend: scrubEvent,
    });
  };

  /* Reports go to Sentry's EU region, and student data must stay in Canada,
     so nothing personal may ride along. tests/sentry-scrub.test.js feeds
     these functions every kind of student and teacher data and checks none
     comes out. */
  var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  var UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

  function mask(text) {
    return typeof text === 'string' ? text.replace(EMAIL_RE, '[email]') : text;
  }

  /* A URL keeps its address and path only. The query and the #fragment hold
     student and class ids (/student?id=…&course=…), Supabase filters
     (?id=eq.…), sign-in tokens (#access_token=…) and slip codes (/s/#…). */
  function scrubUrl(url) {
    if (typeof url !== 'string') return url;
    return mask(url.split(/[?#]/)[0]).replace(UUID_RE, '[id]');
  }

  /* A click or key press is recorded as the element's CSS path. Sentry adds
     the element's id and its aria-label, title, name and alt, and those
     carry student names ("Remove Maya Okafor" on an observation's student
     chip). Keep the tag and classes only. */
  function scrubSelector(sel) {
    if (typeof sel !== 'string') return sel;
    return scrubUrl(sel.replace(/\[(?:[^\]"']|"[^"]*"|'[^']*')*\]/g, '').replace(/#[^\s.>[:#]+/g, ''));
  }

  function scrubBreadcrumb(crumb) {
    // Console breadcrumbs go: the app's warnings log whole records (names,
    // notes, observation text).
    if (!crumb || crumb.category === 'console') return null;
    crumb.message = /^ui\./.test(crumb.category || '') ? scrubSelector(crumb.message) : mask(crumb.message);
    if (crumb.data) {
      // A request keeps its method, path and status; a page change its from
      // and to paths. Anything else goes.
      var data = crumb.data;
      var keep = {};
      if (data.method !== undefined) keep.method = data.method;
      if (data.status_code !== undefined) keep.status_code = data.status_code;
      ['url', 'from', 'to'].forEach(function (k) {
        if (typeof data[k] === 'string') keep[k] = scrubUrl(data[k]);
      });
      crumb.data = keep;
    }
    return crumb;
  }
  function scrubEvent(event) {
    if (!event) return event;
    delete event.user;
    delete event.extra;
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      // Keep the page; drop the query, including the student id in the hash.
      if (event.request.url) event.request.url = mask(event.request.url.split('?')[0]);
      delete event.request.query_string;
    }
    event.message = mask(event.message);
    if (event.exception && event.exception.values) {
      event.exception.values.forEach(function (ex) {
        ex.value = mask(ex.value);
      });
    }
    return event;
  }
})();
