/**
 * The desktop app's addresses (/dashboard, /gradebook?course=…).
 *
 * The list of pages lives in teacher/router.js and is repeated wherever the
 * page must be served as app.html: netlify.toml, the service worker, the e2e
 * and local dev servers, and serve.json. A page missing from one of them 404s
 * on refresh there, or fails offline.
 *
 * Links are plain paths. A "#/…" link left in the app would go through the
 * old-link redirect instead of the router.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf-8');

function routerRoutes() {
  const block = read('teacher/router.js').match(/var _routes = \{([\s\S]*?)\};/);
  expect(block).not.toBeNull();
  return [...block[1].matchAll(/'(\/[^']*)':/g)].map(m => m[1]).sort();
}

function listIn(file, name) {
  const match = read(file).match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'));
  expect(match).not.toBeNull();
  return new Function('return ' + match[1])().sort();
}

describe('app routes are served everywhere the router knows them', () => {
  const routes = routerRoutes();

  it('the router has the pages', () => {
    expect(routes).toContain('/dashboard');
    expect(routes.length).toBeGreaterThan(5);
  });

  it('netlify.toml serves each page as app.html, with no-cache', () => {
    const toml = read('netlify.toml');
    const rewrites = [
      ...toml.matchAll(/\[\[redirects\]\]\s+from = "([^"]+)"\s+to = "\/teacher\/app\.html"\s+status = 200/g),
    ].map(m => m[1]);
    expect(rewrites.sort()).toEqual(routes);
    const noCache = [
      ...toml.matchAll(/\[\[headers\]\]\s+for = "([^"]+)"\s+\[headers\.values\]\s+Cache-Control = "no-cache"/g),
    ]
      .map(m => m[1])
      .filter(p => !p.includes('*'));
    expect(noCache.sort()).toEqual(routes);
  });

  it('the service worker, e2e server and local server know each page', () => {
    expect(listIn('sw.js', 'APP_ROUTES')).toEqual(routes);
    expect(listIn('scripts/e2e-server.mjs', 'APP_ROUTES')).toEqual(routes);
    expect(listIn('scripts/dev-local.mjs', 'APP_ROUTES')).toEqual(routes);
  });

  it('serve.json (npm run dev) rewrites each page to app.html', () => {
    const rewrites = JSON.parse(read('serve.json')).rewrites;
    expect(rewrites.every(r => r.destination === '/teacher/app.html')).toBe(true);
    expect(rewrites.map(r => r.source).sort()).toEqual(routes);
  });
});

describe('app links are plain paths', () => {
  it('no "#/" route links in teacher/ or shared/ scripts', () => {
    const offenders = [];
    for (const dir of ['teacher', 'shared']) {
      for (const file of readdirSync(join(root, dir))) {
        if (!file.endsWith('.js') || (dir === 'teacher' && file === 'router.js')) continue;
        read(join(dir, file))
          .split('\n')
          .forEach((line, i) => {
            if (/['"`]#\//.test(line) || /location\.hash\s*=/.test(line))
              offenders.push(dir + '/' + file + ':' + (i + 1));
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
