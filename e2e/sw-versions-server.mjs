/**
 * A server for service-worker update tests: it serves the built dist/ the
 * way scripts/e2e-server.mjs does (through the production edge function, so
 * pages carry the live nonce CSP), on its own port so each test starts with
 * no worker, and lets a test release a new version without rebuilding.
 *
 * A version is a set of files that differ from dist/: always sw.js with its
 * own cache name and the fingerprints scripts/sw-fingerprints.mjs computes
 * for that version's files, the pages naming that release as scripts/build.sh
 * writes them (scripts/sw-release-pages.mjs), plus any changed files. Every
 * request is logged.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fingerprintsIn, withFingerprints } from '../scripts/sw-fingerprints.mjs';
import { releasePages, withRelease } from '../scripts/sw-release-pages.mjs';

// Playwright runs from the repository root (playwright.config.js).
const ROOT = resolve(process.cwd());
export const DIST = join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
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

globalThis.Netlify = globalThis.Netlify || {
  env: {
    get: name => ({ SUPABASE_URL: 'https://e2e-test.supabase.co', SUPABASE_KEY: 'e2e-test-anon-key' })[name] || '',
  },
};
const edgeSource = readFileSync(join(ROOT, 'netlify/edge-functions/inject-env.js'), 'utf-8');
const injectEnvReady = import('data:text/javascript,' + encodeURIComponent(edgeSource)).then(m => m.default);

export const distSw = () => readFileSync(join(DIST, 'sw.js'), 'utf-8');

/**
 * The sw.js of a version named `name` whose files differ from dist/ by
 * `changed` ({ 'shared/calc.js': Buffer|string }). fingerprints: false gives
 * a worker without fingerprints, which installs as sw.js did before them.
 */
export function versionSw(name, changed = {}, { fingerprints = true } = {}) {
  let sw = distSw().replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'fullvision-${name}';`);
  const read = rel => (rel in changed ? Buffer.from(changed[rel]) : readFileSync(join(DIST, rel)));
  sw = fingerprints
    ? withFingerprints(sw, read)
    : sw.replace(/^const PRECACHE_FINGERPRINTS = .*;$/m, 'const PRECACHE_FINGERPRINTS = null;');
  if (fingerprints && !fingerprintsIn(sw)) throw new Error('no fingerprints');
  return sw;
}

export async function startServer() {
  const injectEnv = await injectEnvReady;
  const state = {
    files: {}, // '/path' -> Buffer, overriding dist/
    fail: new Set(), // '/path?query' answered with a 503
    log: [], // every request's path and query, in order
  };

  async function staticResponse(urlPath) {
    const bare = urlPath.length > 1 ? urlPath.replace(/\/$/, '') : urlPath;
    let path = REWRITES[bare] || urlPath;
    if (path.endsWith('/')) path += 'index.html';
    const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
    if (state.files[path]) return new Response(state.files[path], { headers: { 'Content-Type': type } });
    const file = join(DIST, path);
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    try {
      return new Response(readFileSync(file), { headers: { 'Content-Type': type } });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      state.log.push(url.pathname + url.search);
      if (state.fail.has(url.pathname + url.search)) {
        res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Unavailable');
        return;
      }
      const response = await injectEnv(new Request(url), {
        next: () => staticResponse(decodeURIComponent(url.pathname)),
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise(r => server.listen(0, r));
  const origin = 'http://localhost:' + server.address().port;

  return {
    origin,
    state,
    /* Serve version `name`: its sw.js, its pages and changed files
       ({ rel: content }). */
    release(name, changed = {}, options) {
      const sw = versionSw(name, changed, options);
      state.files = { '/sw.js': Buffer.from(sw) };
      for (const rel of releasePages(sw)) {
        state.files['/' + rel] = Buffer.from(withRelease(readFileSync(join(DIST, rel), 'utf-8'), 'fullvision-' + name));
      }
      for (const [rel, body] of Object.entries(changed)) state.files['/' + rel] = Buffer.from(body);
    },
    /* The requests since the last call. */
    takeLog() {
      return state.log.splice(0);
    },
    close: () => new Promise(r => server.close(r)),
  };
}
