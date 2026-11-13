/**
 * The service worker answers from its saved copy first, behind a guard
 * (sw.js, "The saved copy first"; docs/plans/caching-plan.md, option (a)).
 *
 * A file the install saved is answered without the network only for a page
 * the worker handed over that names the worker's own release. Every other
 * case takes the network first, as before: a page from another release, a
 * page with no release name, a page the worker does not know, a file the
 * install did not save, a copy that is missing, and the source served
 * directly. e2e/sw-saved-copy-first.spec.js proves the same in a browser.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';
import { cacheName, releaseIn, releasePages, withRelease } from '../scripts/sw-release-pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(resolve(root, rel), 'utf-8');
const swSource = read('sw.js');
const ORIGIN = 'https://example.test';
const THIS = 'fullvision-r1';
const NEXT = 'fullvision-r2';

// sw.js as scripts/build.sh leaves it: a cache name, and a fingerprint for
// each file the install saves (two files here, one with a query string).
const built = swSource
  .replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = '${THIS}';`)
  .replace(
    /const PRECACHE_URLS = \[[\s\S]*?\n\];/,
    "const PRECACHE_URLS = ['/teacher/app.html', '/a.js', '/b.css?v=3'];",
  )
  .replace('const PRECACHE_FINGERPRINTS = null;', "const PRECACHE_FINGERPRINTS = { '/a.js': 'x', '/b.css?v=3': 'y' };");

const absolute = key => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href;

// A fake cache storage: name -> Map of absolute address -> response.
function fakeCaches(initial = {}) {
  const stores = new Map();
  for (const [name, entries] of Object.entries(initial)) {
    stores.set(name, new Map(Object.entries(entries).map(([key, response]) => [absolute(key), response])));
  }
  const cachesApi = {
    stores,
    broken: false,
    opened: [],
    open: async name => {
      cachesApi.opened.push(name);
      if (cachesApi.broken) throw new Error('storage');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        put: async (key, response) => void store.set(absolute(key), response),
        match: async key => {
          const found = store.get(absolute(key));
          return found ? found.clone() : undefined;
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async () => {
      throw new Error('the worker must read only its own cache');
    },
  };
  return cachesApi;
}

// A response as the network gives one for this site.
function fromSite(body, type, address) {
  const response = new Response(body, { headers: type ? { 'Content-Type': type } : {} });
  const describe = r =>
    Object.defineProperties(r, { type: { value: 'basic' }, url: { value: address ? ORIGIN + address : '' } });
  const clone = response.clone.bind(response);
  response.clone = () => describe(clone());
  return describe(response);
}
const page = (release, address) =>
  fromSite(
    '<!doctype html><html><head><meta charset="UTF-8" />' +
      (release ? `<meta name="fv-release" content="${release}" />` : '') +
      '</head><body></body></html>',
    'text/html; charset=utf-8',
    address,
  );

function loadWorker({ source = built, saved = {}, network = {} } = {}) {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name, fn) => (listeners[name] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const caches = fakeCaches({ [THIS]: saved });
  const asked = [];
  const state = { offline: false, network };
  const fetch = async request => {
    const address = request.url.replace(ORIGIN, '');
    asked.push(address);
    if (state.offline) throw new TypeError('Failed to fetch');
    const answer = state.network[address];
    if (!answer) return fromSite('not found', 'text/plain', address).constructor.error();
    return typeof answer === 'function' ? answer() : answer;
  };
  const run = new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'crypto',
    'btoa',
    'console',
    source + '\nreturn { pageReleases, rememberPage, releaseNamedBy, PAGES_REMEMBERED, CACHE_NAME };',
  );
  const inner = run(self, caches, fetch, Request, webcrypto, btoa, { warn: () => {} });

  // Send a request through the worker's fetch listener. Returns the
  // response, or undefined when the worker left it to the browser.
  async function ask(address, { client = '', navigate = false, method = 'GET', accept } = {}) {
    let answer;
    const url = /^https?:/.test(address) ? address : ORIGIN + address;
    listeners.fetch({
      request: {
        url,
        method,
        mode: navigate ? 'navigate' : 'no-cors',
        headers: { get: name => (name.toLowerCase() === 'accept' ? accept || (navigate ? 'text/html' : '*/*') : null) },
      },
      clientId: navigate ? '' : client,
      resultingClientId: navigate ? client : '',
      respondWith: promise => (answer = promise),
    });
    const response = await answer;
    // Let a run-time cache write finish.
    await new Promise(done => setTimeout(done, 0));
    return response;
  }
  const savedText = async address => {
    const kept = caches.stores.get(THIS).get(absolute(address));
    return kept ? kept.clone().text() : null;
  };
  return { ...inner, ask, asked, caches, state, savedText };
}

// The cache as the install leaves it for release r1, and the network
// serving release r1 too.
const installed = () => ({
  '/teacher/app.html': page(THIS, '/teacher/app.html'),
  '/a.js': fromSite('a-r1', 'text/javascript', '/a.js'),
  '/b.css?v=3': fromSite('b-r1', 'text/css', '/b.css?v=3'),
});
const serving = (release, tag) => ({
  '/dashboard': () => page(release, '/dashboard'),
  '/a.js': () => fromSite('a-' + tag, 'text/javascript', '/a.js'),
  '/b.css?v=3': () => fromSite('b-' + tag, 'text/css', '/b.css?v=3'),
  '/c.js': () => fromSite('c-' + tag, 'text/javascript', '/c.js'),
});

describe('the saved copy first', () => {
  it('answers a saved file without the network for a page that names this release', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    const html = await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(await html.text()).toContain(THIS);
    expect(worker.asked).toEqual(['/dashboard']);

    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-r1');
    expect(await (await worker.ask('/b.css?v=3', { client: 'tab1' })).text()).toBe('b-r1');
    expect(worker.asked).toEqual(['/dashboard']);
  });

  it('always asks the network for the page itself, known tab or not', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    await worker.ask('/teacher/app.html', { client: 'tab1', accept: 'text/html,*/*' });
    expect(worker.asked).toEqual(['/dashboard', '/dashboard', '/teacher/app.html']);
  });

  it('matches the whole address: another query string is not the saved file', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    worker.state.network['/b.css'] = () => fromSite('b-plain', 'text/css', '/b.css');
    expect(await (await worker.ask('/b.css', { client: 'tab1' })).text()).toBe('b-plain');
    expect(worker.asked).toEqual(['/dashboard', '/b.css']);
  });
});

describe('the guard: a page from another release', () => {
  it('gets every file from the network, and nothing of it is kept', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(NEXT, 'r2') });
    const html = await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(await html.text()).toContain(NEXT);
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-r2');
    expect(await (await worker.ask('/b.css?v=3', { client: 'tab1' })).text()).toBe('b-r2');
    expect(worker.asked).toEqual(['/dashboard', '/a.js', '/b.css?v=3']);
    // The cache is still exactly release r1: its files and its page.
    expect(await worker.savedText('/a.js')).toBe('a-r1');
    expect(await worker.savedText('/b.css?v=3')).toBe('b-r1');
    expect(await worker.savedText('/teacher/app.html')).toContain(THIS);
  });

  it('is refused the saved copy even when the network fails: a missing file, not a mix', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(NEXT, 'r2') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    worker.state.offline = true;
    const answer = await worker.ask('/a.js', { client: 'tab1' });
    expect(answer.status).toBe(503);
    expect(await answer.text()).toBe('');
  });

  it('does not change what another tab on this release gets', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'r1net') });
    await worker.ask('/dashboard', { client: 'old-tab', navigate: true });
    worker.state.network = serving(NEXT, 'r2');
    await worker.ask('/dashboard', { client: 'new-tab', navigate: true });
    expect(await (await worker.ask('/a.js', { client: 'new-tab' })).text()).toBe('a-r2');
    expect(await (await worker.ask('/a.js', { client: 'old-tab' })).text()).toBe('a-r1');
  });

  it('a later load of the same tab is judged afresh', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    worker.state.network = serving(NEXT, 'r2');
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-r2');
  });
});

describe('the guard: a page the worker cannot vouch for', () => {
  it('a tab it never handed a page to uses the network, and the saved copy is not replaced', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(NEXT, 'r2') });
    expect(await (await worker.ask('/a.js', { client: 'unknown-tab' })).text()).toBe('a-r2');
    expect(await (await worker.ask('/a.js', { client: '' })).text()).toBe('a-r2');
    expect(worker.asked).toEqual(['/a.js', '/a.js']);
    expect(await worker.savedText('/a.js')).toBe('a-r1');
  });

  it('a tab it does not know still gets the saved copy when the network fails, as before', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    worker.state.offline = true;
    expect(await (await worker.ask('/a.js', { client: 'unknown-tab' })).text()).toBe('a-r1');
    expect((await worker.ask('/c.js', { client: 'unknown-tab' })).status).toBe(503);
  });

  it('a page with no release name uses the network', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(null, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-net');
    expect(worker.pageReleases.has('tab1')).toBe(false);
  });

  it('a page that answered with an error, another type or an unreadable body uses the network', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    const cases = {
      error: () => new Response(`<meta name="fv-release" content="${THIS}" />`, { status: 503 }),
      type: () => fromSite(`<meta name="fv-release" content="${THIS}" />`, 'text/plain', '/dashboard'),
      empty: () => fromSite(`<meta name="fv-release" content="" />`, 'text/html', '/dashboard'),
      unreadable: () => {
        const response = page(THIS, '/dashboard');
        response.clone = () => {
          throw new Error('body used');
        };
        return response;
      },
    };
    for (const [name, answer] of Object.entries(cases)) {
      // A tab known a moment ago is forgotten when its next page cannot be judged.
      worker.state.network['/dashboard'] = () => page(THIS, '/dashboard');
      await worker.ask('/dashboard', { client: name, navigate: true });
      expect(worker.pageReleases.get(name)).toBe(THIS);
      worker.state.network['/dashboard'] = answer;
      await worker.ask('/dashboard', { client: name, navigate: true });
      expect(worker.pageReleases.has(name), name).toBe(false);
      expect(await (await worker.ask('/a.js', { client: name })).text(), name).toBe('a-net');
    }
  });

  it('a saved copy that is missing, or a cache that cannot be read, goes to the network', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    worker.caches.stores.get(THIS).delete(ORIGIN + '/a.js');
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-net');
    worker.caches.broken = true;
    expect(await (await worker.ask('/b.css?v=3', { client: 'tab1' })).text()).toBe('b-net');
  });

  it('remembers a hundred pages and forgets the oldest, which then uses the network', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    for (let i = 0; i <= worker.PAGES_REMEMBERED; i++) worker.rememberPage('tab' + i, THIS);
    expect(worker.pageReleases.size).toBe(worker.PAGES_REMEMBERED);
    expect(await (await worker.ask('/a.js', { client: 'tab0' })).text()).toBe('a-net');
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-r1');
    worker.rememberPage('', THIS);
    expect(worker.pageReleases.has('')).toBe(false);
  });
});

describe('what is not answered from the saved copy', () => {
  it('a file the install did not save: network first, kept when first used, for the network failing', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(await (await worker.ask('/c.js', { client: 'tab1' })).text()).toBe('c-net');
    worker.state.network['/c.js'] = () => fromSite('c-later', 'text/javascript', '/c.js');
    expect(await (await worker.ask('/c.js', { client: 'tab1' })).text()).toBe('c-later');
    expect(worker.asked).toEqual(['/dashboard', '/c.js', '/c.js']);
    worker.state.offline = true;
    expect(await (await worker.ask('/c.js', { client: 'tab1' })).text()).toBe('c-later');
  });

  it('Supabase and anything but a GET are left to the browser', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(await worker.ask('https://abc.supabase.co/rest/v1/rpc/x', { client: 'tab1' })).toBeUndefined();
    expect(await worker.ask('/a.js', { client: 'tab1', method: 'POST' })).toBeUndefined();
    expect(worker.asked).toEqual(['/dashboard']);
    expect(worker.caches.stores.get(THIS).size).toBe(3);
  });

  it('another site with the same path is never the saved file, and is not kept', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    worker.state.network['https://cdn.example/a.js'] = () => new Response('theirs');
    expect(await (await worker.ask('https://cdn.example/a.js', { client: 'tab1' })).text()).toBe('theirs');
    expect(worker.caches.stores.get(THIS).size).toBe(3);
  });

  it('the source served directly has no fingerprints: every file takes the network first, as before', async () => {
    const dev = swSource.replace(
      /const PRECACHE_URLS = \[[\s\S]*?\n\];/,
      "const PRECACHE_URLS = ['/teacher/app.html', '/a.js'];",
    );
    const name = cacheName(swSource);
    const worker = loadWorker({ source: dev, network: serving(name, 'edited') });
    worker.caches.stores.set(name, new Map([[ORIGIN + '/a.js', fromSite('a-stale', 'text/javascript', '/a.js')]]));
    await worker.ask('/dashboard', { client: 'tab1', navigate: true });
    expect(worker.pageReleases.get('tab1')).toBe(name);
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-edited');
    // And, as before, the fresh answer replaces the copy.
    expect(
      await worker.caches.stores
        .get(name)
        .get(ORIGIN + '/a.js')
        .clone()
        .text(),
    ).toBe('a-edited');
  });
});

describe('with the network off', () => {
  it('the saved page opens with its saved files', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    worker.state.offline = true;
    const html = await worker.ask('/dashboard?course=x', { client: 'tab1', navigate: true });
    expect(await html.text()).toContain(THIS);
    expect(await (await worker.ask('/a.js', { client: 'tab1' })).text()).toBe('a-r1');
    // Only the page was tried on the network.
    expect(worker.asked).toEqual(['/dashboard?course=x']);
  });

  it('a page that was never saved gets the Offline answer, and its tab is not known', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    worker.state.offline = true;
    const answer = await worker.ask('/help/some-page', { client: 'tab1', navigate: true });
    expect(answer.status).toBe(503);
    expect(await answer.text()).toContain('Offline');
    expect(worker.pageReleases.has('tab1')).toBe(false);
  });
});

describe('the page kept for offline', () => {
  it('a page naming this release, or none, is kept; one naming another release is not', async () => {
    const worker = loadWorker({ saved: installed(), network: serving(THIS, 'net') });
    worker.state.network['/help/a'] = () => fromSite('<html>help</html>', 'text/html', '/help/a');
    await worker.ask('/help/a', { client: 'tab1', navigate: true });
    expect(await worker.savedText('/help/a')).toBe('<html>help</html>');

    worker.state.network['/login.html?demo=1'] = () => page(THIS, '/login.html');
    await worker.ask('/login.html?demo=1', { client: 'tab2', navigate: true });
    expect(await worker.savedText('/login.html')).toContain(THIS);

    worker.state.network['/login.html'] = () => page(NEXT, '/login.html');
    await worker.ask('/login.html', { client: 'tab3', navigate: true });
    expect(await worker.savedText('/login.html')).toContain(THIS);
  });
});

describe('the release name in the pages', () => {
  const pages = releasePages(swSource);

  it('is carried by every page the worker saves, and by no other page', () => {
    expect(pages).toEqual(['login.html', 'launch.html', 'teacher/app.html', 'teacher-mobile/index.html']);
    for (const rel of pages) expect(releaseIn(read(rel)), rel).toBe(cacheName(swSource));
    for (const rel of ['s/index.html', 'index.html', 'privacy.html']) expect(releaseIn(read(rel)), rel).toBeNull();
  });

  it('every page that registers the worker or loads the updater carries it', () => {
    for (const rel of ['login.html', 'launch.html', 'teacher/app.html', 'teacher-mobile/index.html', 's/index.html']) {
      const html = read(rel);
      if (/serviceWorker\.register|auto-update\.js/.test(html)) expect(pages, rel).toContain(rel);
    }
    // The student page has no worker and no updater (the plan, section 1).
    expect(read('s/index.html')).not.toMatch(/serviceWorker|auto-update\.js/);
  });

  it('the worker reads the name the build wrote, after the edge function has rewritten the page', async () => {
    globalThis.Netlify = {
      env: { get: name => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' })[name] || '' },
    };
    const edge = await import(
      'data:text/javascript;base64,' + Buffer.from(read('netlify/edge-functions/inject-env.js')).toString('base64')
    );
    const worker = loadWorker();
    for (const rel of pages) {
      const stamped = withRelease(read(rel), THIS);
      expect(releaseIn(stamped)).toBe(THIS);
      const served = await edge.default(new Request('https://fullvision.ca/' + rel), {
        next: async () => new Response(stamped, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      });
      expect(await worker.releaseNamedBy(served), rel).toBe(THIS);
    }
  });

  it('a page with no tag, or two, fails the build instead of quietly using the network', () => {
    expect(() => withRelease('<html><head></head></html>', THIS)).toThrow('found 0');
    const two = '<meta name="fv-release" content="a" /><meta name="fv-release" content="b" />';
    expect(() => withRelease(two, THIS)).toThrow('found 2');
    expect(releaseIn(two)).toBeNull();
    expect(() => withRelease(read('login.html'), 'not a "name"')).toThrow('not a release name');
  });

  it('build.sh writes it after naming the cache, from the name in dist/sw.js, and checks each page', () => {
    const build = read('scripts/build.sh');
    const named = build.indexOf('const CACHE_NAME');
    const written = build.indexOf('node scripts/sw-release-pages.mjs dist');
    expect(named).toBeGreaterThan(-1);
    expect(written).toBeGreaterThan(named);
    const checked = build.match(/for page in ([^;]+); do\n\s+grep -q "<meta name=\\"fv-release\\"/);
    expect(checked).not.toBeNull();
    expect(checked[1].split(' ')).toEqual(pages);
  });

  it('the content policy file is not part of this: the edge function still sets it alone', () => {
    expect(read('_headers')).not.toMatch(/Content-Security-Policy:/);
    expect(read('netlify.toml')).not.toMatch(/Content-Security-Policy/);
  });
});
