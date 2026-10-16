/**
 * Netlify Edge Function: inject-env
 * Replaces __SUPABASE_URL__ and __SUPABASE_KEY__ placeholders in HTML responses
 * with values from Netlify environment variables.
 */
// Blocked scripts and inline handlers are reported to Sentry's security
// endpoint, so a CSP break shows up the day it happens. Same project and key
// as the DSN in shared/sentry-init.js.
const CSP_REPORT_URL =
  'https://o4511109636685824.ingest.de.sentry.io/api/4511300618747984/security/?sentry_key=9f39b499781faa1a39607f208edb2cb8';

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();

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
  // Sentry: js.sentry-cdn.com hosts the loader, browser.sentry-cdn.com hosts
  // the SDK bundle the loader lazy-fetches. *.sentry.io covers ingest endpoints
  // across all regions (including EU's ingest.de.sentry.io).
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://js.sentry-cdn.com https://browser.sentry-cdn.com`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.nsvcs.net https://*.sentry.io",
    "worker-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_URL}`,
    'report-to csp-endpoint',
  ].join('; ');
  headers.set('Content-Security-Policy', csp);
  headers.set('Reporting-Endpoints', `csp-endpoint="${CSP_REPORT_URL}"`);

  return new Response(html, {
    status: response.status,
    headers,
  });
}
