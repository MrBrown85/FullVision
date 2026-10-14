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

  /* Reports go to Sentry's EU region, so student data must not ride along.
     Console breadcrumbs are dropped: the app's warnings log whole records
     (names, notes, observation text). What's left keeps only the error and
     where it happened, with email addresses masked. */
  var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  function mask(text) {
    return typeof text === 'string' ? text.replace(EMAIL_RE, '[email]') : text;
  }

  function scrubBreadcrumb(crumb) {
    if (!crumb || crumb.category === 'console') return null;
    crumb.message = mask(crumb.message);
    if (crumb.data) {
      // Keep the request's method, URL and status; drop anything else.
      var keep = {};
      ['method', 'url', 'status_code'].forEach(function (k) {
        if (crumb.data[k] !== undefined) keep[k] = k === 'url' ? mask(crumb.data[k]) : crumb.data[k];
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
