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
  var JWT_RE = /\beyJ[\w-]*\.[\w-]+(?:\.[\w-]+)?/g;
  var SECRET_RE = /\b(\w*(?:token|code|key|secret|pass)\w*)=[^&\s]+/gi;
  // Slip codes: three and three from the slip alphabet (K7P-3QX).
  var SLIP_RE = /\b[A-HJKMNP-RT-Z2-46-9]{3}-[A-HJKMNP-RT-Z2-46-9]{3}\b/g;
  var DATE_RE = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
  // Long letter-and-digit runs are tokens; long digit runs are student numbers.
  var TOKEN_RE = /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{24,}\b/g;
  var NUMBER_RE = /\b\d{5,}\b/g;
  var URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>()]+/gi;

  /* Ids, emails, tokens, slip codes, dates and student numbers, wherever
     they appear. */
  function mask(text) {
    if (typeof text !== 'string') return text;
    return text
      .replace(EMAIL_RE, '[email]')
      .replace(JWT_RE, '[token]')
      .replace(SECRET_RE, '$1=[value]')
      .replace(UUID_RE, '[id]')
      .replace(SLIP_RE, '[code]')
      .replace(DATE_RE, '[date]')
      .replace(TOKEN_RE, '[token]')
      .replace(NUMBER_RE, '[number]');
  }

  // A quoted word that reads like code (a property, column or constraint
  // name) stays; anything else quoted could be a value someone typed.
  function quoted(q, inner) {
    return /^[a-z_$][\w$]*$/.test(inner) ? q + inner + q : q + '[value]' + q;
  }

  /* An error message or a breadcrumb's text. Engine and Postgres messages
     quote the value that failed (invalid input syntax for type date:
     "2012-04-17", Unexpected token 'M', "Maya" is not valid JSON, Key
     (email)=(…)), and a rejected plain value is printed whole. */
  function scrubText(text) {
    if (typeof text !== 'string') return text;
    return mask(
      text
        .replace(URL_RE, scrubUrl)
        .replace(/^(Non-Error (?:promise rejection|exception) captured with value: )[\s\S]*$/, '$1[value]')
        .replace(/(captured as [a-z ]*with keys: )([\s\S]*)$/, function (m, lead, keys) {
          return (
            lead +
            keys
              .split(/,\s*/)
              .map(function (k) {
                return /^[a-z_$][\w$]*$/.test(k) ? k : '[key]';
              })
              .join(', ')
          );
        })
        .replace(/(, )[\s\S]*( is not valid JSON)/, '$1"[value]"$2')
        .replace(/\)=\([^)]*\)/g, ')=([value])')
        .replace(/(Failing row contains )\([\s\S]*\)/, '$1([value])')
        .replace(/: "[^"]*"/g, ': "[value]"')
        .replace(/"([^"]*)"/g, function (m, inner) {
          return quoted('"', inner);
        })
        .replace(/(^|[^\w])'([^']*)'(?!\w)/g, function (m, lead, inner) {
          return lead + quoted("'", inner);
        }),
    );
  }

  /* A URL keeps its address and path only. The query and the #fragment hold
     student and class ids (/student?id=…&course=…), Supabase filters
     (?id=eq.…), sign-in tokens (#access_token=…) and slip codes (/s/#…). */
  function scrubUrl(url) {
    if (typeof url !== 'string') return url;
    return mask(url.split(/[?#]/)[0]);
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
    crumb.message = /^ui\./.test(crumb.category || '') ? scrubSelector(crumb.message) : scrubText(crumb.message);
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
  // The trace context is two random ids. The browser, OS and device contexts
  // come from the user agent. Any other context (an error's extra fields,
  // say a Postgres error's details quoting a row) goes.
  var CONTEXTS_KEPT = ['browser', 'os', 'device', 'runtime'];
  var MECHANISM_KEPT = ['type', 'handled', 'synthetic', 'source', 'exception_id', 'parent_id', 'is_exception_group'];

  function scrubFrame(frame) {
    frame.filename = scrubUrl(frame.filename);
    frame.abs_path = scrubUrl(frame.abs_path);
    // Source lines of an inline script are read from the live page, which
    // shows student names; the browser SDK has no local variables, but drop
    // them in case one ever does.
    delete frame.vars;
    delete frame.context_line;
    delete frame.pre_context;
    delete frame.post_context;
  }

  function scrubEvent(event) {
    if (!event) return event;
    delete event.user;
    delete event.extra;
    delete event.tags;
    if (event.contexts) {
      var contexts = {};
      if (event.contexts.trace) {
        contexts.trace = { trace_id: event.contexts.trace.trace_id, span_id: event.contexts.trace.span_id };
      }
      CONTEXTS_KEPT.forEach(function (k) {
        if (event.contexts[k]) contexts[k] = event.contexts[k];
      });
      event.contexts = contexts;
    }
    if (event.request) {
      // The page address without its query or #fragment, and the browser.
      // Cookies, the referrer and the request body go.
      var headers = event.request.headers || {};
      var ua = headers['User-Agent'] || headers['user-agent'];
      event.request = { url: scrubUrl(event.request.url) };
      if (ua) event.request.headers = { 'User-Agent': ua };
    }
    if (event.transaction) event.transaction = scrubUrl(event.transaction);
    event.message = scrubText(event.message);
    if (event.logentry) event.logentry = { message: scrubText(event.logentry.message) };
    if (event.exception && event.exception.values) {
      event.exception.values.forEach(function (ex) {
        ex.value = scrubText(ex.value);
        if (ex.mechanism) {
          var mechanism = {};
          MECHANISM_KEPT.forEach(function (k) {
            if (ex.mechanism[k] !== undefined) mechanism[k] = ex.mechanism[k];
          });
          ex.mechanism = mechanism;
        }
        if (ex.stacktrace && ex.stacktrace.frames) ex.stacktrace.frames.forEach(scrubFrame);
      });
    }
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
    }
    // No IP address: Sentry would otherwise take it from the connection.
    event.sdk = event.sdk || {};
    event.sdk.settings = Object.assign({}, event.sdk.settings, { infer_ip: 'never' });
    return event;
  }
})();
