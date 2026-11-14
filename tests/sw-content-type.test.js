/**
 * Service worker Content-Type check — sw.js.
 *
 * When the host answers a file's address with something else (an HTML error,
 * sign-in or quota page with status 200 for a .js address), the worker must
 * not keep it. At install the whole install fails, so the old worker and its
 * cache stay in charge. At run time the page still gets the response, but the
 * cache does not keep it.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(resolve(root, 'sw.js'), 'utf-8');
const ORIGIN = 'https://example.test';

// Runs sw.js against fakes and returns its listeners and functions.
function loadWorker({ source = swSource, caches, fetch, warn = () => {} } = {}) {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name, fn) => (listeners[name] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  class FakeRequest {
    constructor(url) {
      this.url = url;
    }
  }
  const run = new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'crypto',
    'btoa',
    'console',
    source + '\nreturn { typeFitsAddress, isFitToKeep, cacheIfGood };',
  );
  const fns = run(self, caches, fetch, FakeRequest, webcrypto, btoa, { warn });
  return { listeners, ...fns };
}

function fits(address, type) {
  return loadWorker({}).typeFitsAddress(address, type);
}

describe('typeFitsAddress', () => {
  it('accepts a JavaScript type for .js and .mjs, whichever it is called', () => {
    for (const type of ['text/javascript', 'application/javascript', 'application/x-javascript', 'text/ecmascript']) {
      expect(fits('/shared/calc.js', type)).toBe(true);
      expect(fits('/shared/calc.mjs', type)).toBe(true);
    }
  });

  it('ignores a charset suffix and letter case', () => {
    expect(fits('/a.js', 'application/javascript; charset=UTF-8')).toBe(true);
    expect(fits('/a.css', 'Text/CSS;charset=utf-8')).toBe(true);
    expect(fits('/a.html', 'TEXT/HTML; charset=utf-8')).toBe(true);
  });

  it('refuses HTML for a script, a stylesheet and JSON', () => {
    expect(fits('/shared/calc.js', 'text/html; charset=utf-8')).toBe(false);
    expect(fits('/login.css', 'text/html')).toBe(false);
    expect(fits('/manifest.json', 'text/html')).toBe(false);
    expect(fits('/vendor/pdfjs/pdf.min.js', 'text/plain')).toBe(false);
  });

  it('accepts text/css, JSON, SVG and the image types where they belong', () => {
    expect(fits('/login.css', 'text/css')).toBe(true);
    expect(fits('/teacher/styles.css?v=3', 'text/css; charset=utf-8')).toBe(true);
    expect(fits('/manifest.json', 'application/json')).toBe(true);
    expect(fits('/manifest.json', 'application/manifest+json')).toBe(true);
    expect(fits('/favicon.svg', 'image/svg+xml')).toBe(true);
    expect(fits('/a.png', 'image/png')).toBe(true);
    expect(fits('/a.jpg', 'image/jpeg')).toBe(true);
    expect(fits('/a.webp', 'image/webp')).toBe(true);
    expect(fits('/favicon.ico', 'image/x-icon')).toBe(true);
    expect(fits('/favicon.ico', 'image/vnd.microsoft.icon')).toBe(true);
  });

  it('refuses a page for an image, SVG or font', () => {
    expect(fits('/a.png', 'text/html')).toBe(false);
    expect(fits('/favicon.svg', 'text/html')).toBe(false);
    expect(fits('/a.woff2', 'text/html')).toBe(false);
  });

  it('accepts a font type or octet-stream for a font', () => {
    expect(fits('/a.woff2', 'font/woff2')).toBe(true);
    expect(fits('/a.woff', 'application/font-woff')).toBe(true);
    expect(fits('/a.ttf', 'application/x-font-ttf')).toBe(true);
    expect(fits('/a.woff2', 'application/octet-stream')).toBe(true);
  });

  it('wants text/html for a page, a page route and a folder', () => {
    expect(fits('/teacher/app.html', 'text/html; charset=utf-8')).toBe(true);
    expect(fits('/teacher/app.html', 'application/javascript')).toBe(false);
    expect(fits('/', 'text/html')).toBe(true);
    expect(fits('/', 'application/json')).toBe(false);
    expect(fits('/gradebook?course=x', 'text/html')).toBe(true);
    expect(fits('/gradebook', 'text/plain')).toBe(false);
    expect(fits('/teacher-mobile/', 'text/html')).toBe(true);
  });

  it('accepts any type for an address of a kind it does not know', () => {
    expect(fits('/vendor/pdfjs/wasm/a.wasm', 'application/wasm')).toBe(true);
    expect(fits('/vendor/pdfjs/cmaps/a.bcmap', 'text/html')).toBe(true);
    expect(fits('/help/some-page', 'text/html')).toBe(true);
    expect(fits('/vendor/LICENSE', null)).toBe(true);
  });

  it('refuses a missing type for scripts, stylesheets and pages, and accepts it elsewhere', () => {
    for (const address of ['/a.js', '/a.mjs', '/a.css', '/a.html', '/', '/dashboard']) {
      expect(fits(address, null)).toBe(false);
      expect(fits(address, '')).toBe(false);
    }
    for (const address of ['/a.json', '/a.svg', '/a.png', '/a.woff2', '/a.wasm']) {
      expect(fits(address, null)).toBe(true);
    }
  });
});

// A fake cache storage: name -> Map of address -> response.
function fakeCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const open = async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put: async (key, response) => void store.set(typeof key === 'string' ? key : key.url, response),
      match: async key => store.get(typeof key === 'string' ? key : key.url),
    };
  };
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async () => undefined,
  };
}

const answers = table => async request => {
  const [status, type, body] = table[request.url] || [200, 'text/plain', ''];
  return new Response(body, { status, headers: type ? { 'Content-Type': type } : {} });
};

// A source whose precache list is three files, for driving install.
const small = swSource.replace(
  /const PRECACHE_URLS = \[[\s\S]*?\n\];/,
  "const PRECACHE_URLS = ['/', '/a.js', '/b.css'];",
);

function install(worker) {
  let done;
  worker.listeners.install({ waitUntil: promise => (done = promise) });
  return done;
}

const good = {
  '/': [200, 'text/html; charset=utf-8', '<html>'],
  '/a.js': [200, 'application/javascript; charset=UTF-8', 'a()'],
  '/b.css': [200, 'text/css', 'b{}'],
};

describe('install', () => {
  it('keeps every file when each arrives as the file it should be', async () => {
    const caches = fakeCaches();
    const worker = loadWorker({ source: small, caches, fetch: answers(good) });
    await install(worker);
    expect([...caches.stores.get('fullvision-dev').keys()].sort()).toEqual(['/', '/a.js', '/b.css']);
  });

  it('fails, keeps nothing new and warns once when a .js address answers text/html with status 200', async () => {
    const caches = fakeCaches({ 'fullvision-old': { '/a.js': new Response('old()') } });
    const warn = vi.fn();
    const bad = { ...good, '/a.js': [200, 'text/html; charset=utf-8', '<html>sign in</html>'] };
    const worker = loadWorker({ source: small, caches, fetch: answers(bad), warn });
    await expect(install(worker)).rejects.toThrow('/a.js');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('/a.js');
    expect(warn.mock.calls[0][0]).toContain('text/html');
    expect([...(caches.stores.get('fullvision-dev') || new Map()).keys()]).toEqual([]);
    expect(caches.stores.has('fullvision-old')).toBe(true);
  });

  it('fails on a missing type for a .css address', async () => {
    const caches = fakeCaches();
    const worker = loadWorker({ source: small, caches, fetch: answers({ ...good, '/b.css': [200, null, 'b{}'] }) });
    await expect(install(worker)).rejects.toThrow('/b.css');
  });

  it('still fails on a download that is not OK', async () => {
    const caches = fakeCaches();
    const worker = loadWorker({ source: small, caches, fetch: answers({ ...good, '/a.js': [503, 'text/html', 'x'] }) });
    await expect(install(worker)).rejects.toThrow();
    expect([...(caches.stores.get('fullvision-dev') || new Map()).keys()]).toEqual([]);
  });
});

describe('install that copies unchanged files from the old cache', () => {
  // A stored copy the way the old cache holds one.
  function stored(address, type) {
    const response = new Response('same bytes', { headers: type ? { 'Content-Type': type } : {} });
    return {
      status: 200,
      type: 'basic',
      redirected: false,
      url: ORIGIN + address,
      headers: response.headers,
      ok: true,
      arrayBuffer: () => response.clone().arrayBuffer(),
      clone: () => response.clone(),
    };
  }
  const hashOfSameBytes = async () => {
    const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('same bytes')));
    return btoa(String.fromCharCode(...digest));
  };

  it('does not copy a stored page for a .js address; it downloads that file instead', async () => {
    const hash = await hashOfSameBytes();
    const source = small.replace(
      'const PRECACHE_FINGERPRINTS = null;',
      `const PRECACHE_FINGERPRINTS = ${JSON.stringify({ '/a.js': hash, '/b.css': hash })};`,
    );
    const old = {
      '/__sw-precache-fingerprints.json': new Response(JSON.stringify({ files: { '/a.js': hash, '/b.css': hash } })),
      '/a.js': stored('/a.js', 'text/html'),
      '/b.css': stored('/b.css', 'text/css'),
    };
    const caches = fakeCaches({ 'fullvision-old': old });
    const fetched = [];
    // The download is this release's file: a script with the bytes its
    // fingerprint names.
    const network = { ...good, '/a.js': [200, 'application/javascript', 'same bytes'] };
    const fetch = async request => (fetched.push(request.url), answers(network)(request));
    await install(loadWorker({ source, caches, fetch, warn: () => {} }));
    // b.css was copied; a.js was downloaded because its stored copy was a page.
    expect(fetched.sort()).toEqual(['/', '/a.js']);
    const kept = caches.stores.get('fullvision-dev');
    const copy = await kept.get('/a.js');
    expect(copy.headers.get('Content-Type')).toBe('application/javascript');
    expect(await copy.text()).toBe('same bytes');
  });

  it('fails the install when the stored copy is refused and the download is a page too', async () => {
    const hash = await hashOfSameBytes();
    const source = small.replace(
      'const PRECACHE_FINGERPRINTS = null;',
      `const PRECACHE_FINGERPRINTS = ${JSON.stringify({ '/a.js': hash, '/b.css': hash })};`,
    );
    const old = {
      '/__sw-precache-fingerprints.json': new Response(JSON.stringify({ files: { '/a.js': hash, '/b.css': hash } })),
      '/a.js': stored('/a.js', 'text/html'),
      '/b.css': stored('/b.css', 'text/css'),
    };
    const caches = fakeCaches({ 'fullvision-old': old });
    const bad = { ...good, '/a.js': [200, 'text/html', '<html>'] };
    const worker = loadWorker({ source, caches, fetch: answers(bad), warn: () => {} });
    await expect(install(worker)).rejects.toThrow('/a.js');
    expect(caches.stores.get('fullvision-dev').has('/__sw-precache-fingerprints.json')).toBe(false);
  });
});

describe('run time', () => {
  function cachedAfter(response, request) {
    const caches = fakeCaches();
    const worker = loadWorker({ caches, fetch: async () => response, warn: () => {} });
    worker.cacheIfGood(request, response);
    return new Promise(done => setTimeout(() => done(caches.stores.get('fullvision-dev')), 0));
  }
  const basic = (type, url) => {
    const response = new Response('x', { headers: { 'Content-Type': type } });
    return Object.defineProperties(response, { type: { value: 'basic' }, url: { value: url } });
  };

  it('keeps a script that is a script', async () => {
    const store = await cachedAfter(basic('application/javascript', ORIGIN + '/a.js'), { url: ORIGIN + '/a.js' });
    expect([...store.keys()]).toEqual([ORIGIN + '/a.js']);
  });

  it('does not keep a page that answered a script address', async () => {
    const store = await cachedAfter(basic('text/html', ORIGIN + '/a.js'), { url: ORIGIN + '/a.js' });
    expect(store).toBeUndefined();
  });
});
