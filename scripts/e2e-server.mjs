#!/usr/bin/env node
/**
 * Serves dist/ for the Playwright suite through the production edge function
 * (netlify/edge-functions/inject-env.js), so pages get the same per-request
 * nonce CSP the live site sends. A script or inline handler the CSP blocks in
 * production is blocked in the tests too.
 *
 * The CSP's report-uri and report-to are removed: they post violations to
 * Sentry, and test runs shouldn't. Enforcement is unchanged.
 *
 * Run by playwright.config.js after scripts/build-e2e.sh.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8347;

// The edge function reads its credentials from Netlify.env.
globalThis.Netlify = {
  env: {
    get: name => ({ SUPABASE_URL: 'https://e2e-test.supabase.co', SUPABASE_KEY: 'e2e-test-anon-key' })[name] || '',
  },
};

// The repo isn't an ES-module package, so load the function's source as one.
const edgeSource = await readFile(join(ROOT, 'netlify/edge-functions/inject-env.js'), 'utf-8');
const { default: injectEnv } = await import('data:text/javascript,' + encodeURIComponent(edgeSource));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.woff2': 'font/woff2',
};

// netlify.toml's rewrites the tests use, including the desktop app's pages.
const APP_ROUTES = [
  '/dashboard',
  '/assignments',
  '/student',
  '/gradebook',
  '/observations',
  '/observations/starters',
  '/reports',
];
const REWRITES = { '/': '/login.html', '/app.html': '/teacher/app.html' };
for (const route of APP_ROUTES) REWRITES[route] = '/teacher/app.html';

async function staticResponse(urlPath) {
  const bare = urlPath.length > 1 ? urlPath.replace(/\/$/, '') : urlPath;
  let path = REWRITES[bare] || urlPath;
  if (path.endsWith('/')) path += 'index.html';
  const file = join(DIST, path);
  if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
  try {
    if ((await stat(file)).isDirectory()) return Response.redirect('http://localhost:' + PORT + path + '/', 301);
    const body = await readFile(file);
    return new Response(body, {
      headers: { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' },
    });
  } catch {
    return new Response('Not found: ' + path, { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
}

function withoutReporting(csp) {
  return csp
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !/^report-(uri|to)\b/.test(d))
    .join('; ');
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    const request = new Request(url);
    const response = await injectEnv(request, { next: () => staticResponse(decodeURIComponent(url.pathname)) });
    const headers = Object.fromEntries(response.headers);
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = withoutReporting(headers['content-security-policy']);
    }
    delete headers['reporting-endpoints'];
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('500:', error);
    res.writeHead(500).end('Internal server error');
  }
}).listen(PORT, () => {
  console.log('E2E server on http://localhost:' + PORT + ' with the production CSP');
});
