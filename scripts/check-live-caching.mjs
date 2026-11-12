// A read-only check of how a FullVision site caches files and protects pages
// (docs/plans/caching-plan.md, step 1).
//
//   node scripts/check-live-caching.mjs                    # https://fullvision.ca
//   node scripts/check-live-caching.mjs http://localhost:8347
//   node scripts/check-live-caching.mjs --expect-304 --expect-pages-ok
//
// Files: a plain GET, then a second GET with If-None-Match set to the first
// answer's ETag. A server that honours it answers 304 with no body.
// Pages: two GETs each, to see the Content-Security-Policy nonce, whether it
// changes per request, whether the HTML's script tags carry it, whether the
// Supabase placeholders were replaced, and the four security headers.
//
// Safe to run any time: GET only, a generic User-Agent, no cookies, no
// sign-in. It never prints page content or the injected Supabase values.
// Exit code 0, unless --expect-304 (every file must answer 304) or
// --expect-pages-ok (every page must have its policy, nonce and address)
// is passed and that check fails.
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const USER_AGENT = 'Mozilla/5.0 (compatible; cache-check/1.0)';

export const FILES = [
  '/shared/calc.js',
  '/shared/data.js',
  '/teacher/styles.css',
  '/sw.js',
  '/manifest.json',
  '/curriculum_by_course.json',
  '/favicon.svg',
  '/assets/icons/icon-192.png',
];

export const SECURITY_HEADERS = [
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Strict-Transport-Security',
];

export const PLACEHOLDERS = ['__SUPABASE_URL__', '__SUPABASE_KEY__'];

/** The desktop app's clean routes, from teacher/router.js (as tests/app-routes.test.js reads them). */
export function routerRoutes(routerSource) {
  const block = routerSource.match(/var _routes = \{([\s\S]*?)\};/);
  if (!block) return [];
  return [...block[1].matchAll(/'(\/[^']*)':/g)].map(m => m[1]);
}

/** Every page address the app serves: the clean routes plus the HTML pages. */
export function pageAddresses(routerSource, hasFile) {
  const pages = ['/', '/login.html', ...routerRoutes(routerSource), '/s/', '/teacher-mobile/'];
  if (hasFile('launch.html')) pages.push('/launch.html');
  if (hasFile('privacy.html')) pages.push('/privacy.html');
  pages.push('/help/');
  return pages;
}

/** The nonce in a Content-Security-Policy's script-src, or null. */
export function cspNonce(csp) {
  if (!csp) return null;
  const m = csp.match(/'nonce-([^']+)'/);
  return m ? m[1] : null;
}

/** How many <script> tags the HTML has, and how many carry exactly this nonce. */
export function scriptNonces(html, nonce) {
  const tags = html.match(/<script(?=[\s>])[^>]*>/gi) || [];
  const withNonce = nonce ? tags.filter(t => t.includes('nonce="' + nonce + '"')).length : 0;
  return { scripts: tags.length, withNonce };
}

/** True when none of the Supabase placeholders is left in the HTML. */
export function placeholdersGone(html) {
  return PLACEHOLDERS.every(p => !html.includes(p));
}

/** Is a page's answer complete? Returns a list of what is missing (empty when fine). */
export function pageProblems(p) {
  const problems = [];
  if (p.status !== 200) problems.push('status ' + p.status);
  if (!p.csp) problems.push('no policy');
  else if (!p.nonce) problems.push('policy has no nonce');
  if (p.nonce && !p.nonceChanges) problems.push('nonce repeats');
  if (p.scripts > 0 && p.withNonce < p.scripts) problems.push('script tags without the nonce');
  if (!p.placeholdersGone) problems.push('Supabase address not injected');
  const missing = SECURITY_HEADERS.filter(h => !p.security[h]);
  if (missing.length) problems.push('missing ' + missing.join(', '));
  return problems;
}

export function parseArgs(argv) {
  const opts = { base: 'https://fullvision.ca', expect304: false, expectPagesOk: false };
  for (const arg of argv) {
    if (arg === '--expect-304') opts.expect304 = true;
    else if (arg === '--expect-pages-ok') opts.expectPagesOk = true;
    else if (arg.startsWith('--base=')) opts.base = arg.slice(7);
    else if (!arg.startsWith('--')) opts.base = arg;
    else throw new Error('Unknown option ' + arg);
  }
  opts.base = opts.base.replace(/\/+$/, '');
  return opts;
}

async function get(url, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...extraHeaders },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}

async function checkFile(base, path) {
  const first = await get(base + path);
  const etag = first.headers.get('etag');
  const second = etag ? await get(base + path, { 'If-None-Match': etag }) : null;
  return {
    path,
    status: first.status,
    cacheControl: first.headers.get('cache-control'),
    etag,
    bytes: first.body.length,
    conditionalStatus: second ? second.status : null,
    conditionalBytes: second ? second.body.length : null,
  };
}

async function checkPage(base, path) {
  const a = await get(base + path);
  const b = await get(base + path);
  const csp = a.headers.get('content-security-policy');
  const nonce = cspNonce(csp);
  const nonceB = cspNonce(b.headers.get('content-security-policy'));
  const html = a.body.toString('utf8');
  const { scripts, withNonce } = scriptNonces(html, nonce);
  const security = {};
  for (const h of SECURITY_HEADERS) security[h] = a.headers.get(h);
  return {
    path,
    status: a.status,
    csp: !!csp,
    nonce: !!nonce,
    nonceChanges: !!nonce && !!nonceB && nonce !== nonceB,
    scripts,
    withNonce,
    placeholdersGone: placeholdersGone(html),
    security,
  };
}

const yn = v => (v ? 'yes' : 'no');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const router = readFileSync(REPO + 'teacher/router.js', 'utf8');
  const hasFile = name => {
    try {
      readFileSync(REPO + name);
      return true;
    } catch {
      return false;
    }
  };
  const pages = pageAddresses(router, hasFile);

  console.log('Caching and page protection on ' + opts.base + ' (' + new Date().toISOString() + ')');
  console.log('');
  console.log('Files: plain GET, then GET with If-None-Match: <its ETag> (bytes after decompression)');
  const files = [];
  for (const path of FILES) {
    const f = await checkFile(opts.base, path);
    files.push(f);
    console.log(
      '  ' +
        path.padEnd(28) +
        ' ' +
        f.status +
        ' ' +
        String(f.bytes).padStart(9) +
        ' B  cache-control: ' +
        (f.cacheControl || '(none)') +
        '  etag: ' +
        (f.etag || '(none)') +
        '  ->  ' +
        (f.conditionalStatus === null ? 'no ETag, not asked' : f.conditionalStatus + ' ' + f.conditionalBytes + ' B'),
    );
  }
  const answered304 = files.filter(f => f.conditionalStatus === 304).length;
  const filesOk = answered304 === files.length;
  console.log(
    'Files verdict: ' +
      answered304 +
      ' of ' +
      files.length +
      ' answered 304 Not Modified' +
      (filesOk ? '.' : '; the rest sent the whole file again.'),
  );

  console.log('');
  console.log('Pages: two GETs each');
  const results = [];
  for (const path of pages) {
    const p = await checkPage(opts.base, path);
    results.push(p);
    const sec = SECURITY_HEADERS.map(h => h + '=' + yn(p.security[h])).join(' ');
    console.log(
      '  ' +
        path.padEnd(24) +
        ' ' +
        p.status +
        '  policy ' +
        yn(p.csp) +
        '  nonce ' +
        yn(p.nonce) +
        '  new nonce each time ' +
        yn(p.nonceChanges) +
        '  scripts with nonce ' +
        p.withNonce +
        '/' +
        p.scripts +
        '  placeholders gone ' +
        yn(p.placeholdersGone) +
        '  ' +
        sec,
    );
  }
  const bad = results.map(p => ({ path: p.path, problems: pageProblems(p) })).filter(p => p.problems.length);
  const pagesOk = bad.length === 0;
  console.log(
    'Pages verdict: ' +
      (pagesOk
        ? 'all ' + results.length + ' pages have their policy, a fresh nonce on every script and the Supabase address.'
        : bad.length +
          ' of ' +
          results.length +
          ' pages fall short: ' +
          bad.map(p => p.path + ' (' + p.problems.join('; ') + ')').join(', ')),
  );

  let code = 0;
  if (opts.expect304 && !filesOk) code = 1;
  if (opts.expectPagesOk && !pagesOk) code = 1;
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('check-live-caching: ' + err.message);
    const strict = process.argv.includes('--expect-304') || process.argv.includes('--expect-pages-ok');
    process.exitCode = strict ? 1 : 0;
  });
}
