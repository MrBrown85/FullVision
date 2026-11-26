/**
 * Netlify Edge Function: inject-env
 * Replaces __SUPABASE_URL__ and __SUPABASE_KEY__ placeholders in HTML responses
 * with values from Netlify environment variables.
 */
// No report-uri or report-to: a browser's CSP report carries the page's
// address with its query (/student?id=<student id>&course=<class id>), and
// it goes to the endpoint directly, past the Sentry scrubber in
// shared/sentry-init.js. Sentry is in the EU; student data stays in Canada.

// The sealed frame a teacher's web page or EPUB handout opens in
// (shared/handout-frame.html, shared/handout-viewer.js; Colin's call of Nov
// 17 2026). Its scripts must run, so it gets a policy of its own, and
// `sandbox` without allow-same-origin gives it an origin of its own even if
// the address is opened alone: nothing in it reaches a page's storage,
// cookies or sign-in. Nothing in it loads from the internet: no script,
// style, font, picture, media, fetch or frame from any other address, so no
// third party sees a student's address or what they type (Colin's privacy
// call, Nov 17 2026); inline content and data: still work. With no
// allow-popups it opens no window: a web link a student clicks is opened by
// the viewer, after the student confirms. Only FullVision
// may frame it (this overrides
// X-Frame-Options: DENY from _headers, which browsers ignore when
// frame-ancestors is set; it is dropped here as well).
const HANDOUT_FRAME_PATH = '/shared/handout-frame.html';
const HANDOUT_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts allow-forms allow-modals',
].join('; ');

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();

  if (new URL(request.url).pathname === HANDOUT_FRAME_PATH) {
    const frameHeaders = new Headers(response.headers);
    frameHeaders.delete('content-length');
    frameHeaders.delete('x-frame-options');
    frameHeaders.set('Content-Security-Policy', HANDOUT_FRAME_CSP);
    frameHeaders.set('Referrer-Policy', 'no-referrer');
    frameHeaders.set('Cache-Control', 'no-cache');
    return new Response(html, { status: response.status, headers: frameHeaders });
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL') || '';
  const supabaseKey = Netlify.env.get('SUPABASE_KEY') || '';

  html = html.replaceAll('__SUPABASE_URL__', supabaseUrl);
  html = html.replaceAll('__SUPABASE_KEY__', supabaseKey);

  // Generate a per-request nonce and inject into all script/style tags
  const nonce = crypto.randomUUID();
  html = html.replace(/<(script|style)(?=[\s>])/gi, `<$1 nonce="${nonce}"`);

  // Build new headers without Content-Length (it changed after replacement)
  const headers = new Headers(response.headers);
  headers.delete('content-length');

  // Set CSP with nonce (replaces static unsafe-inline headers)
  // Sentry: js-de.sentry-cdn.com hosts the loader for FullVision's EU project
  // (shared/sentry-init.js picks the DSN's region), browser.sentry-cdn.com hosts
  // the SDK bundle the loader fetches. *.sentry.io covers ingest endpoints
  // across all regions (including EU's ingest.de.sentry.io).
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://js-de.sentry-cdn.com https://browser.sentry-cdn.com`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.nsvcs.net https://*.sentry.io",
    "worker-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // No page uses <base>, <object> or <embed>; injected markup can't either.
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  headers.set('Content-Security-Policy', csp);

  return new Response(html, {
    status: response.status,
    headers,
  });
}
