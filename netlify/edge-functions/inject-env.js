/**
 * Netlify Edge Function: inject-env
 * Replaces __SUPABASE_URL__ and __SUPABASE_KEY__ placeholders in HTML responses
 * with values from Netlify environment variables.
 */
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
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.nsvcs.net",
    "worker-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  headers.set('Content-Security-Policy', csp);

  return new Response(html, {
    status: response.status,
    headers,
  });
}
