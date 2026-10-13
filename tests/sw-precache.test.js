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
import { existsSync, readFileSync } from 'fs';
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

  it('names only files that exist', () => {
    const absent = urls.filter(url => url !== '/' && !existsSync(resolve(root, url.slice(1).split('?')[0])));
    expect(absent).toEqual([]);
  });

  it('caches only successful same-origin responses', () => {
    expect(swSource).toMatch(/!response\.ok \|\| response\.type !== 'basic'/);
    expect(swSource).not.toMatch(/\.then\(response => \{\s*const clone = response\.clone\(\);/);
  });
});
