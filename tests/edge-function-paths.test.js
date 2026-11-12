/**
 * The page-protection edge function (netlify/edge-functions/inject-env.js)
 * runs on every page and on no other file (docs/plans/caching-plan.md,
 * step 2).
 *
 * netlify.toml's [[edge_functions]] entry is read and matched by
 * scripts/edge-function-paths.mjs with the URLPattern standard that Netlify's
 * declarations page names for `path` and `excludedPath`. The shipped files
 * are the ones scripts/build.sh copies into dist/, plus the help pages
 * scripts/build-help.mjs writes. A new page under an excluded path, or a new
 * kind of file the list misses, fails here.
 *
 * This proves the file says what we mean. Only a release proves Netlify reads
 * it the same way: run `node scripts/check-live-caching.mjs --expect-304
 * --expect-pages-ok` straight after.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { edgeDeclarations, edgeFunctionRuns } from '../scripts/edge-function-paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf-8');
const decls = edgeDeclarations(read('netlify.toml'));
const runs = path => edgeFunctionRuns(decls, 'inject-env', path);

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Site paths of every file scripts/build.sh puts in dist/, from its cp lines. */
function shippedFiles() {
  const out = new Set();
  const add = (abs, destDir, srcBase) => {
    const rel = abs.slice(srcBase.length).replace(/^\//, '');
    out.add('/' + [destDir, rel].filter(Boolean).join('/'));
  };
  for (const line of read('scripts/build.sh').split('\n')) {
    const m = line.match(/^\s*cp\s+(?:-r\s+)?(.+?)\s+dist\/(\S*)\s*$/);
    if (!m) continue;
    const destDir = m[2].replace(/\/$/, '');
    for (const src of m[1].split(/\s+/)) {
      const parent = dirname(src);
      const matchesGlob = src.includes('*')
        ? readdirSync(join(root, parent))
            .filter(n => new RegExp('^' + basename(src).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$').test(n))
            .map(n => join(parent, n))
        : [src];
      for (const one of matchesGlob) {
        const abs = join(root, one);
        if (!existsSync(abs)) continue; // built by build-help.mjs; added below
        if (statSync(abs).isDirectory()) for (const f of walk(abs)) add(f, destDir, join(root, parent));
        else add(abs, destDir, join(root, parent));
      }
    }
  }
  // scripts/build-help.mjs writes these into help/ before build.sh copies them.
  out.add('/help/index.html');
  out.add('/help/index.json');
  for (const slug of helpSlugs()) {
    out.add('/help/' + slug + '.html');
    out.add('/help/fragments/' + slug + '.html');
  }
  out.delete('/_headers'); // Netlify reads it; it is never served
  return [...out].sort();
}

function helpSlugs() {
  return readdirSync(join(root, 'help/articles'))
    .filter(n => n.endsWith('.md'))
    .map(n => n.replace(/\.md$/, ''));
}

function routerRoutes() {
  const block = read('teacher/router.js').match(/var _routes = \{([\s\S]*?)\};/);
  return [...block[1].matchAll(/'(\/[^']*)':/g)].map(m => m[1]);
}

/** Every address that returns a page: clean routes, rewrites and the HTML files' own addresses. */
function pageAddresses() {
  const pages = ['/', '/s/', '/teacher-mobile/', '/help', '/help/'];
  for (const route of routerRoutes()) pages.push(route, route + '/');
  for (const slug of helpSlugs()) pages.push('/help/' + slug);
  const toml = read('netlify.toml');
  for (const m of toml.matchAll(/\[\[redirects\]\]\s+from = "([^"]+)"/g)) {
    if (!m[1].includes(':') && !m[1].includes('*')) pages.push(m[1]);
  }
  for (const file of shippedFiles()) if (file.endsWith('.html')) pages.push(file);
  return [...new Set(pages)];
}

describe('the edge function runs on pages only', () => {
  it('netlify.toml has one inject-env entry on "/*" with exclusions', () => {
    const entries = decls.filter(d => d.function === 'inject-env');
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('/*');
    expect(entries[0].excludedPath.length).toBeGreaterThan(5);
    for (const x of entries[0].excludedPath) expect(x.startsWith('/')).toBe(true);
  });

  it('reads build.sh into the files the site ships', () => {
    const files = shippedFiles();
    for (const f of [
      '/login.html',
      '/teacher/app.html',
      '/s/index.html',
      '/teacher-mobile/index.html',
      '/shared/data.js',
      '/sw.js',
      '/manifest.json',
      '/vendor/supabase.min.js',
      '/assets/icons/icon-192.png',
      '/help/index.html',
    ])
      expect(files).toContain(f);
    expect(files.length).toBeGreaterThan(300);
  });

  it('every page address still runs it', () => {
    const pages = pageAddresses();
    for (const p of ['/', '/login.html', '/dashboard', '/reports', '/s/', '/teacher-mobile/', '/help/'])
      expect(pages).toContain(p);
    if (existsSync(join(root, 'launch.html'))) expect(pages).toContain('/launch.html');
    const missed = pages.filter(p => !runs(p));
    expect(missed, 'pages that would lose their policy and Supabase address').toEqual([]);
  });

  it('no HTML file anywhere in the shipped site is excluded', () => {
    const html = shippedFiles().filter(f => f.endsWith('.html'));
    expect(html.length).toBeGreaterThan(10);
    expect(html.filter(f => !runs(f))).toEqual([]);
  });

  it('no shipped file that is not HTML runs it', () => {
    const others = shippedFiles().filter(f => !f.endsWith('.html'));
    expect(
      others.filter(f => runs(f)),
      'files the function would still run on',
    ).toEqual([]);
  });

  it('"*" in an excluded path crosses folders (URLPattern), and an exclusion never swallows a page', () => {
    expect(runs('/shared/data.js')).toBe(false);
    expect(runs('/vendor/pdfjs/cmaps/H.bcmap')).toBe(false);
    expect(runs('/sw.js')).toBe(false);
    expect(runs('/help/img/create-a-class.jpg')).toBe(false);
    expect(runs('/js/page')).toBe(true);
    expect(runs('/assets/new-page.html')).toBe(false); // why the HTML test above walks every file
  });

  it('a missing file is still outside the function, as Netlify 404s it either way', () => {
    // No catch-all rewrite: a missing /shared/nope.js is Netlify's own 404, never the app's HTML.
    expect(read('netlify.toml')).not.toMatch(/from = "\/\*"/);
    expect(runs('/shared/nope.js')).toBe(false);
  });
});

describe('the function still passes a non-HTML response through untouched', () => {
  async function run(contentType, body) {
    globalThis.Netlify = { env: { get: () => 'https://x.supabase.co' } };
    const src = read('netlify/edge-functions/inject-env.js');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const original = new Response(body, { headers: { 'content-type': contentType, etag: '"abc"' } });
    const res = await mod.default(new Request('https://fullvision.ca/x'), { next: async () => original });
    return { original, res };
  }

  it('a script comes back as the same response, with no policy', async () => {
    const { original, res } = await run('application/javascript', 'var a = "__SUPABASE_URL__"; <script>');
    expect(res).toBe(original);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(await res.text()).toBe('var a = "__SUPABASE_URL__"; <script>');
  });

  it('a page gets its policy and nonce', async () => {
    const { res } = await run('text/html; charset=utf-8', '<script src="/a.js"></script>');
    const csp = res.headers.get('content-security-policy');
    const nonce = csp.match(/'nonce-([^']+)'/)[1];
    expect(await res.text()).toContain('<script nonce="' + nonce + '"');
  });
});
