/**
 * shared/photo-readers.js: the PDF reader behind PhotoShrink's openPdf seam.
 *
 * The real pdf.js from vendor/pdfjs/ runs here (in Node, on the main thread)
 * against small real PDFs made by tests/fixtures/pdf-fixtures.mjs: page
 * counts, the 21-page refusal, a locked PDF, a damaged one and a file that
 * is not a PDF. Drawing a page needs a real canvas, so the page sizes come
 * from a stand-in library here, and a real two-page PDF becoming two real
 * JPEG pages under the live CSP is in e2e/pdf-pages.spec.js.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pagesPdf, lockedPdf, damagedPdf } from './fixtures/pdf-fixtures.mjs';

const source = readFileSync(new URL('../shared/photo-readers.js', import.meta.url), 'utf-8');
runInThisContext(source, { filename: 'shared/photo-readers.js' });
const PR = window.PhotoReaders;
const PS = window.PhotoShrink;

let pdfjs;
beforeAll(async () => {
  // In Node pdf.js runs its worker on the main thread when it finds it here.
  globalThis.pdfjsWorker = await import('../vendor/pdfjs/pdf.worker.min.js');
  pdfjs = await import('../vendor/pdfjs/pdf.min.js');
}, 60_000);

const asFile = (bytes, name = 'Lab Report.pdf') => new File([bytes], name, { type: 'application/pdf' });

/* A surface for PhotoShrink that is never asked to draw: every case here
   is refused, or counted, before a page is drawn. */
const noSurface = {
  decode() {
    throw new Error('not asked');
  },
  canvas() {
    throw new Error('not asked');
  },
};

let loads;
beforeEach(() => {
  loads = 0;
  PR.configure({
    load: url => {
      loads++;
      expect(url).toBe('/vendor/pdfjs/pdf.min.js');
      return Promise.resolve(pdfjs);
    },
  });
});

describe('loading', () => {
  it('fetches nothing when the file loads; the library is fetched on the first PDF, once', async () => {
    // A fresh copy, as a page that has just loaded it.
    const fresh = new Function('window', source.replace('window.PhotoReaders =', 'return'))({});
    expect(fresh.loaded()).toBe(false);
    expect(loads).toBe(0);
    await PR.openPdf(asFile(pagesPdf(2))).then(doc => doc.close());
    await PR.openPdf(asFile(pagesPdf(2))).then(doc => doc.close());
    expect(loads).toBe(1);
    expect(PR.loaded()).toBe(true);
  });

  it('a library that cannot be fetched is refused as no_decoder, and the next PDF tries again', async () => {
    let tries = 0;
    PR.configure({
      load: () => {
        tries++;
        return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
      },
    });
    const res = await PS.prepare(asFile(pagesPdf(2)), { openPdf: PR.openPdf, surface: noSurface });
    expect(res).toMatchObject({ ok: false, reason: 'no_decoder', kind: 'pdf' });
    await PS.prepare(asFile(pagesPdf(2)), { openPdf: PR.openPdf, surface: noSurface });
    expect(tries).toBe(2);
  });

  it('something that is not pdf.js is refused as no_decoder', async () => {
    PR.configure({ load: () => Promise.resolve({ default: {} }) });
    const res = await PS.prepare(asFile(pagesPdf(2)), { openPdf: PR.openPdf, surface: noSurface });
    expect(res).toMatchObject({ ok: false, reason: 'no_decoder' });
  });

  it('points pdf.js at the worker beside it', () => {
    expect(PR.WORKER_URL).toBe('/vendor/pdfjs/pdf.worker.min.js');
    expect(readFileSync(new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url)).length).toBeGreaterThan(0);
  });
});

describe('the real pdf.js', () => {
  it('opens a two-page PDF as two pages', async () => {
    const doc = await PR.openPdf(asFile(pagesPdf(2)), { longSide: 2000 });
    expect(doc.pages).toBe(2);
    expect(typeof doc.page).toBe('function');
    doc.close();
    await expect(doc.page(1)).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('a 21-page PDF is refused before any page is drawn', async () => {
    const res = await PS.prepare(asFile(pagesPdf(21)), { openPdf: PR.openPdf, surface: noSurface });
    expect(res).toMatchObject({ ok: false, reason: 'too_many_pages', pageCount: 21, limit: 20 });
  });

  it('a 20-page PDF is not refused for its length', async () => {
    const doc = await PR.openPdf(asFile(pagesPdf(20)));
    expect(doc.pages).toBe(20);
    doc.close();
  });

  it('a PDF locked with a password is refused plainly, and says it is locked', async () => {
    const res = await PS.prepare(asFile(lockedPdf()), { openPdf: PR.openPdf, surface: noSurface });
    expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf', locked: true });
  });

  it('a damaged PDF is refused plainly', async () => {
    const res = await PS.prepare(asFile(damagedPdf()), { openPdf: PR.openPdf, surface: noSurface });
    expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf' });
    expect(res.locked).toBeUndefined();
  });

  it('a file named .pdf that is not one is refused plainly', async () => {
    const res = await PS.prepare(asFile(new TextEncoder().encode('Just a note.'), 'notes.pdf'), {
      openPdf: PR.openPdf,
      surface: noSurface,
    });
    expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf' });
  });

  it('the fixtures are real PDFs: the locked one opens with its password', async () => {
    const task = pdfjs.getDocument({ data: lockedPdf(), password: 'secret', verbosity: 0 });
    const doc = await task.promise;
    const text = await (await doc.getPage(2)).getTextContent();
    expect(text.items.map(i => i.str).join('')).toBe('Page 2');
    await task.destroy();
  });
});

/* A stand-in pdf.js for drawing: pages of given sizes in points, and a
   record of what was rendered and destroyed. */
function standIn(sizes, { failPage } = {}) {
  const log = { rendered: [], destroyed: 0, cleaned: 0, released: [] };
  const lib = {
    GlobalWorkerOptions: { workerSrc: '' },
    AnnotationMode: { ENABLE_STORAGE: 3 },
    getDocument(opts) {
      log.options = opts;
      return {
        promise: Promise.resolve({
          numPages: sizes.length,
          getPage: n =>
            Promise.resolve({
              getViewport: ({ scale }) => ({ width: sizes[n - 1][0] * scale, height: sizes[n - 1][1] * scale }),
              render: params => {
                log.rendered.push({ n, w: params.canvas.width, h: params.canvas.height, intent: params.intent });
                return { promise: n === failPage ? Promise.reject(new Error('bad stream')) : Promise.resolve() };
              },
              cleanup: () => log.cleaned++,
            }),
        }),
        destroy: () => {
          log.destroyed++;
          return Promise.resolve();
        },
      };
    },
  };
  const canvas = (w, h) => {
    const el = {
      width: w,
      height: h,
      getContext: () => ({ fillRect() {}, fillStyle: '' }),
    };
    log.released.push(el);
    return el;
  };
  return { lib, log, canvas };
}

describe('drawing a page', () => {
  it('draws each page with its long side at longSide, white first, as it would print', async () => {
    const { lib, log, canvas } = standIn([
      [612, 792],
      [842, 595],
    ]);
    PR.configure({ load: () => Promise.resolve(lib), canvas });
    const doc = await PR.openPdf(asFile(pagesPdf(2)), { longSide: 2000 });
    const one = await doc.page(1);
    const two = await doc.page(2);
    expect([one.width, one.height]).toEqual([1545, 2000]);
    expect([two.width, two.height]).toEqual([2000, 1413]);
    expect(one.source.width).toBe(1545);
    expect(log.rendered.map(r => r.intent)).toEqual(['print', 'print']);
    expect(log.cleaned).toBe(2);
    expect(lib.GlobalWorkerOptions.workerSrc).toBe('/vendor/pdfjs/pdf.worker.min.js');
    // The page's fonts are drawn as shapes, and no form script runs.
    expect(log.options).toMatchObject({ disableFontFace: true, enableXfa: false, wasmUrl: '/vendor/pdfjs/wasm/' });
    one.close();
    expect(one.source.width).toBe(0);
    doc.close();
    doc.close();
    expect(log.destroyed).toBe(1);
  });

  it('a tiny page is enlarged at most MAX_SCALE times', async () => {
    const { lib, canvas } = standIn([[100, 50]]);
    PR.configure({ load: () => Promise.resolve(lib), canvas });
    const doc = await PR.openPdf(asFile(pagesPdf(1)), { longSide: 2000 });
    const page = await doc.page(1);
    expect([page.width, page.height]).toEqual([100 * PR.MAX_SCALE, 50 * PR.MAX_SCALE]);
  });

  it('a page that fails to draw is refused as unreadable, and its canvas is freed', async () => {
    const { lib, log, canvas } = standIn(
      [
        [612, 792],
        [612, 792],
      ],
      { failPage: 2 },
    );
    PR.configure({ load: () => Promise.resolve(lib), canvas });
    const doc = await PR.openPdf(asFile(pagesPdf(2)));
    await expect(doc.page(2)).rejects.toMatchObject({ reason: 'unreadable' });
    expect(log.released[0].width).toBe(0);
  });
});
