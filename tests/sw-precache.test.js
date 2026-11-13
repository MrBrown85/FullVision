/**
 * Service worker precache list — sw.js.
 *
 * The offline app can only start from files the service worker cached at
 * install. The list is maintained by hand, so it drifted: ten scripts the
 * pages load (offline-queue.js among them) were missing, and the stylesheet
 * was cached as /teacher/styles.css while the pages request
 * /teacher/styles.css?v=3. These tests fail when a page loads something the
 * list doesn't cover, or the list names a file that doesn't exist.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, dirname, posix } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(resolve(root, 'sw.js'), 'utf-8');

function precacheUrls() {
  const match = swSource.match(/const PRECACHE_URLS = (\[[\s\S]*?\]);/);
  expect(match).not.toBeNull();
  return new Function('return ' + match[1])();
}

// Local files a page loads through src= or href=, as absolute URL paths.
function pageAssets(page) {
  const html = readFileSync(resolve(root, page), 'utf-8');
  const dir = posix.dirname('/' + page);
  const refs = [];
  const re = /<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('#') || ref.startsWith('data:')) continue;
    refs.push(ref.startsWith('/') ? ref : posix.normalize(posix.join(dir, ref)));
  }
  return refs;
}

describe('service worker precache list', () => {
  const urls = precacheUrls();

  for (const page of ['login.html', 'teacher/app.html', 'teacher-mobile/index.html']) {
    it('covers every local file ' + page + ' loads', () => {
      const missing = pageAssets(page).filter(ref => !urls.includes(ref));
      expect(missing).toEqual([]);
    });
  }

  /* Demo Mode's sample class is read from shared/seed-data.js on every
     start (shared/data.js _loadSeedScript), not from the saved classes.
     Without it cached, an offline reload in Demo Mode opened with no class
     and Reports threw. The cached address must be the one data.js asks. */
  it('covers the Demo Mode class file at the address shared/data.js loads it from', () => {
    const data = readFileSync(resolve(root, 'shared/data-demo.js'), 'utf-8');
    const m = data.match(/function _loadSeedScript\(\)[\s\S]*?\.src = '([^']+)'/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/^\/shared\/seed-data\.js/);
    expect(urls).toContain(m[1]);
  });

  it('names only files that exist', () => {
    const absent = urls.filter(url => url !== '/' && !existsSync(resolve(root, url.slice(1).split('?')[0])));
    expect(absent).toEqual([]);
  });

  it('caches only successful same-origin responses', () => {
    expect(swSource).toMatch(/!response\.ok \|\| response\.type !== 'basic'/);
    expect(swSource).not.toMatch(/\.then\(response => \{\s*const clone = response\.clone\(\);/);
  });
  /* Scripts and styles the apps load on demand (a loader that sets a
     script's src, the router's _onDemand list) are not tags in a page, so
     the tests above cannot see them. Offline, one that is not precached
     answers 503: shared/bank-sets.js, shared/bank-proficiency.js and
     vendor/exceljs.min.js did, and Generate, printed Tag Rubrics and the
     Excel export quietly fell back or failed. Every address the desktop and
     phone code names is listed, or excused here with its reason. */
  it('covers every script and stylesheet the app code loads on demand', () => {
    const excused = {
      // Read only when the precached /curriculum_by_course.json fails to load.
      '/curriculum_data.js': 'fallback',
    };
    const named = new Set();
    for (const dir of ['teacher', 'teacher-mobile', 'shared']) {
      for (const file of readdirSync(resolve(root, dir)).filter(f => f.endsWith('.js'))) {
        const source = readFileSync(resolve(root, dir, file), 'utf-8');
        for (const m of source.matchAll(/'(\/[\w./-]+\.(?:js|css)(?:\?[^']*)?)'/g)) named.add(m[1]);
      }
    }
    const missing = [...named].filter(url => !urls.includes(url) && !excused[url]);
    expect(missing).toEqual([]);
  });
});

/* sw.js pageKey: the address a page is cached under, which must be the one
   PRECACHE_URLS names whatever address the page is opened by. */
describe('service worker page addresses', () => {
  const origin = 'https://fullvision.ca';
  const source = ['APP_SHELL', 'APP_ROUTES', 'isAppRoute', 'pageKey']
    .map(
      name =>
        swSource.match(
          new RegExp('^(const ' + name + ' = [\\s\\S]*?;|function ' + name + '\\([\\s\\S]*?\\n\\})$', 'm'),
        )[0],
    )
    .join('\n');
  const pageKey = new Function('self', source + '\nreturn pageKey;')({ location: { origin } });
  const key = address => pageKey(new URL(address, origin));
  const urls = precacheUrls();

  it('opens the phone app by its folder address', () => {
    expect(key('/teacher-mobile/')).toBe('/teacher-mobile/index.html');
    expect(key('/teacher-mobile/index.html')).toBe('/teacher-mobile/index.html');
  });

  it('drops the query string, which never changes the page', () => {
    expect(key('/login.html?demo=1')).toBe('/login.html');
    expect(key('/teacher-mobile/?tab=grade')).toBe('/teacher-mobile/index.html');
    expect(key('/?demo=1')).toBe('/');
  });

  it("keeps the desktop app's routes on app.html", () => {
    for (const route of ['/dashboard', '/gradebook?course=sci8', '/reports/', '/observations/starters']) {
      expect(key(route)).toBe('/teacher/app.html');
    }
  });

  it('gives every way into the apps an address the precache holds', () => {
    for (const address of ['/', '/login.html?demo=1', '/launch.html', '/teacher-mobile/', '/dashboard']) {
      expect(urls).toContain(key(address));
    }
  });

  it('leaves another site alone', () => {
    expect(key('https://example.com/a/?b=1')).toBe('https://example.com/a/?b=1');
  });
});
