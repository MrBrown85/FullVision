/**
 * A scan shared from the phone's mail (Add Work for the Class, B7; sw.js,
 * "A scan shared from the phone's mail"). The share target's POST keeps one
 * PDF in the worker's memory, without its file name, and opens the phone
 * app; the phone app takes it once; a drop (not signed in, Cancel, Sign
 * Out) lets it go; anything else keeps nothing. Nothing is written to a
 * cache. e2e/phone-split-scan.spec.js does the same through a browser.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(resolve(root, 'sw.js'), 'utf-8');
const ORIGIN = 'https://example.test';
const PDF = '%PDF-1.4 made-up pages';

function loadWorker() {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name, fn) => (listeners[name] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const opened = [];
  const caches = {
    open: async name => {
      opened.push(name);
      return { put: async () => {}, match: async () => undefined };
    },
    keys: async () => [],
    delete: async () => true,
    match: async () => undefined,
  };
  const network = [];
  const fetch = async request => {
    network.push(request.url);
    return new Response('not found', { status: 404 });
  };
  const run = new Function(
    'self',
    'caches',
    'fetch',
    'crypto',
    'console',
    swSource + '\nreturn { held: () => sharedScan };',
  );
  const inner = run(self, caches, fetch, webcrypto, { warn: () => {} });

  // A request through the worker's fetch listener: its answer, or undefined.
  async function ask(address, { method = 'GET', form = null, navigate = false } = {}) {
    let answer;
    listeners.fetch({
      request: {
        url: ORIGIN + address,
        method,
        mode: navigate ? 'navigate' : 'cors',
        headers: { get: () => (navigate ? 'text/html' : '*/*') },
        formData: async () => {
          if (!form) throw new TypeError('not a form');
          return form;
        },
      },
      clientId: 'page',
      resultingClientId: 'page',
      respondWith: p => (answer = Promise.resolve(p)),
      waitUntil: () => {},
    });
    return answer ? await answer : undefined;
  }

  function message(data) {
    const replies = [];
    listeners.message({ data, ports: [{ postMessage: r => replies.push(r) }] });
    return replies;
  }

  return { ask, message, held: inner.held, opened, network };
}

const pdfForm = (...files) => {
  const form = new FormData();
  files.forEach(f => form.append('scan', f));
  return form;
};
const pdf = (name = 'Block C 2026-11-17 0832.pdf', body = PDF) => new File([body], name, { type: 'application/pdf' });

const scanParam = res => new URL(res.headers.get('Location')).searchParams.get('scan');

describe('the share target', () => {
  it('keeps one PDF in memory, without its name, and opens the phone app with its id', async () => {
    const w = loadWorker();
    const res = await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form: pdfForm(pdf()) });
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get('Location'));
    expect(url.origin + url.pathname).toBe(ORIGIN + '/teacher-mobile/');
    const id = scanParam(res);
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.headers.get('Location')).not.toContain('Block');
    const held = w.held();
    expect(held.id).toBe(id);
    expect(held.blob.name).toBeUndefined();
    expect(held.blob.type).toBe('application/pdf');
    // Nothing went to a cache or the network.
    expect(w.opened).toEqual([]);
    expect(w.network).toEqual([]);
  });

  it('hands it over once, to the id it named, and lets it go', async () => {
    const w = loadWorker();
    const id = scanParam(
      await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form: pdfForm(pdf()) }),
    );
    const res = await w.ask('/teacher-mobile/shared-scan?take=' + id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe(PDF);
    expect(w.held()).toBe(null);
    expect((await w.ask('/teacher-mobile/shared-scan?take=' + id)).status).toBe(404);
    expect(w.network).toEqual([]);
  });

  it('lets it go when asked with another id', async () => {
    const w = loadWorker();
    await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form: pdfForm(pdf()) });
    expect((await w.ask('/teacher-mobile/shared-scan?take=000000000000000000000000')).status).toBe(404);
    expect(w.held()).toBe(null);
  });

  it('lets it go on a drop (not signed in, Cancel, Sign Out), and says whether one waits', async () => {
    const w = loadWorker();
    await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form: pdfForm(pdf()) });
    expect(w.message({ type: 'FV_SHARED_SCAN_HELD' })).toEqual([{ held: true }]);
    w.message({ type: 'FV_SHARED_SCAN_DROP' });
    expect(w.held()).toBe(null);
    expect(w.message({ type: 'FV_SHARED_SCAN_HELD' })).toEqual([{ held: false }]);
  });

  it('a newer share replaces the older one', async () => {
    const w = loadWorker();
    const first = scanParam(
      await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form: pdfForm(pdf()) }),
    );
    const second = scanParam(
      await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form: pdfForm(pdf('b.pdf', 'two')) }),
    );
    expect(second).not.toBe(first);
    expect((await w.ask('/teacher-mobile/shared-scan?take=' + first)).status).toBe(404);
    expect(w.held()).toBe(null);
  });

  it('keeps nothing for no file, two files, a file that is not a PDF, one over 20 MB, or a broken form', async () => {
    const cases = [
      [pdfForm(), 'none'],
      [pdfForm(pdf(), pdf('b.pdf')), 'many'],
      [pdfForm(new File(['x'], 'photo.jpg', { type: 'image/jpeg' })), 'not_pdf'],
      [pdfForm(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })), 'too_big'],
      [null, 'unreadable'],
    ];
    for (const [form, why] of cases) {
      const w = loadWorker();
      const res = await w.ask('/teacher-mobile/share-scan', { method: 'POST', navigate: true, form });
      expect(scanParam(res)).toBe(why);
      expect(w.held()).toBe(null);
    }
  });

  it('leaves every other POST to the browser, as before', async () => {
    const w = loadWorker();
    expect(await w.ask('/teacher-mobile/other', { method: 'POST', form: pdfForm(pdf()) })).toBeUndefined();
    expect(w.held()).toBe(null);
  });
});
