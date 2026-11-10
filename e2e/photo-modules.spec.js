/**
 * shared/photo-shrink.js and shared/photo-queue.js in a real browser.
 *
 * The unit tests (tests/photo-shrink.test.js, tests/photo-queue.test.js) run
 * both modules against fakes. These check what only a browser can: a real
 * decode and redraw, real JPEG sizes, the browser's own handling of a
 * sideways photo, and a real IndexedDB with Web Locks across two tabs.
 *
 * Nothing in the app loads these modules yet, so each test opens a blank
 * page on the app's origin (answered here, with no app code and no CSP) and
 * adds the two files to it.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const SHRINK = path.resolve(__dirname, '../shared/photo-shrink.js');
const QUEUE = path.resolve(__dirname, '../shared/photo-queue.js');

const COURSE = '11111111-1111-4111-8111-111111111111';
const ASSESSMENT = '22222222-2222-4222-8222-222222222222';
const ENROLLMENT = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = '44444444-4444-4444-8444-444444444444';
const FOLDER = `${COURSE}/${ASSESSMENT}/${ENROLLMENT}/${SUBMISSION}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* Helpers that run in the page: build photos the way a phone would. */
function pageHelpers() {
  const u16 = n => [(n >> 8) & 0xff, n & 0xff];
  const u32 = n => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

  // An EXIF segment with an orientation and a GPS block (latitude ref "N").
  function exifSegment(orientation, gps) {
    const entries = [[...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0]];
    if (gps) entries.push([...u16(0x8825), ...u16(4), ...u32(1), ...u32(8 + 2 + 24 + 4)]);
    const tiff = [0x4d, 0x4d, ...u16(42), ...u32(8), ...u16(entries.length), ...entries.flat(), ...u32(0)];
    if (gps) tiff.push(...u16(1), ...u16(1), ...u16(2), ...u32(2), 0x4e, 0, 0, 0, ...u32(0));
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    return new Uint8Array([0xff, 0xe1, ...u16(body.length + 2), ...body]);
  }

  async function withExif(blob, orientation, gps, name) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const seg = exifSegment(orientation, gps);
    const out = new Uint8Array(bytes.length + seg.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(seg, 2);
    out.set(bytes.subarray(2), 2 + seg.length);
    return new File([out], name || 'IMG_2041.jpg', { type: 'image/jpeg' });
  }

  const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

  // A page of handwriting-sized lines on paper, with a camera's grain.
  function worksheet(w, h, grain) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#23262b';
    const size = Math.round(h / 48);
    ctx.font = size + 'px sans-serif';
    for (let y = size * 3; y < h - size * 2; y += size * 2) {
      ctx.fillText('The cell membrane controls what enters and leaves the cell. 1234567890 '.repeat(4), size * 2, y);
    }
    if (grain) {
      const img = ctx.getImageData(0, 0, w, h);
      let seed = 12345;
      for (let i = 0; i < img.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const n = ((seed >> 16) % (grain * 2 + 1)) - grain;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    }
    return canvas;
  }

  // 40 × 30, each quarter its own colour: red, green / blue, yellow.
  function quarters() {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    [
      ['#ff0000', 0, 0],
      ['#00ff00', 20, 0],
      ['#0000ff', 0, 15],
      ['#ffff00', 20, 15],
    ].forEach(([colour, x, y]) => {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 20, 15);
    });
    return canvas;
  }

  // The colour name at the middle of each quarter of a JPEG: [TL, TR, BL, BR].
  async function corners(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const name = ([r, g, b]) =>
      r > 128 && g > 128 ? 'yellow' : r > 128 ? 'red' : g > 128 ? 'green' : b > 128 ? 'blue' : 'dark';
    const at = (fx, fy) =>
      name(ctx.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data);
    return {
      size: [bitmap.width, bitmap.height],
      corners: [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)],
    };
  }

  window.T = { exifSegment, withExif, toBlob, worksheet, quarters, corners };
}

async function openBlank(page) {
  await page.route('**/photo-modules-blank', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Photo modules</title>' }),
  );
  await page.goto('/photo-modules-blank');
  await page.addScriptTag({ path: SHRINK });
  await page.addScriptTag({ path: QUEUE });
  await page.evaluate(pageHelpers);
}

test.describe('PhotoShrink in a browser', () => {
  test('a 12-megapixel photo with GPS comes out near 2000 px, under the limit, with no location', async ({ page }) => {
    await openBlank(page);
    const out = await page.evaluate(async () => {
      const shot = await T.toBlob(T.worksheet(4000, 3000, 6), 'image/jpeg', 0.92);
      const file = await T.withExif(shot, 1, true);
      const before = PhotoShrink.readExif(new Uint8Array(await file.arrayBuffer()));
      const res = await PhotoShrink.prepare(file);
      const p = res.pages[0];
      const bytes = new Uint8Array(await p.blob.arrayBuffer());
      const thumbBytes = new Uint8Array(await p.thumb.arrayBuffer());
      const decoded = await createImageBitmap(p.blob);
      const thumb = await createImageBitmap(p.thumb);
      const text = Array.from(bytes.subarray(0, 4096), b => String.fromCharCode(b)).join('');
      return {
        inputBytes: file.size,
        before,
        ok: res.ok,
        kind: res.kind,
        width: p.width,
        height: p.height,
        bytes: p.bytes,
        blobSize: p.blob.size,
        type: p.blob.type,
        quality: p.quality,
        name: p.name,
        hash: p.hash,
        blurry: p.blurry,
        decoded: [decoded.width, decoded.height],
        thumb: [thumb.width, thumb.height],
        thumbSize: p.thumb.size,
        after: PhotoShrink.readExif(bytes),
        thumbAfter: PhotoShrink.readExif(thumbBytes),
        sniffed: PhotoShrink.sniff(bytes),
        hasExifText: text.includes('Exif'),
        limits: { aim: PhotoShrink.AIM_BYTES, max: PhotoShrink.MAX_BYTES },
      };
    });
    test.info().annotations.push({ type: 'sizes', description: JSON.stringify(out) });

    // The photo going in really does carry a location.
    expect(out.before).toMatchObject({ exif: true, gps: true });
    expect(out.inputBytes).toBeGreaterThan(1000 * 1000);

    expect(out.ok).toBe(true);
    expect(out.kind).toBe('jpeg');
    expect([out.width, out.height]).toEqual([2000, 1500]);
    expect(out.decoded).toEqual([2000, 1500]);
    expect(out.type).toBe('image/jpeg');
    expect(out.sniffed).toBe('jpeg');
    expect(out.bytes).toBe(out.blobSize);
    expect(out.bytes).toBeLessThan(out.limits.max);
    expect(out.bytes).toBeLessThanOrEqual(out.limits.aim);
    expect(out.name).toBe('IMG_2041.jpg');
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.blurry).toBe(false);

    // No EXIF, no GPS, nothing personal, in the page or its thumbnail.
    expect(out.after).toEqual({ exif: false, orientation: 1, gps: false, metadata: false });
    expect(out.thumbAfter).toEqual({ exif: false, orientation: 1, gps: false, metadata: false });
    expect(out.hasExifText).toBe(false);

    expect(out.thumb).toEqual([400, 300]);
    expect(out.thumbSize).toBeLessThan(100 * 1000);
  });

  test('a sideways phone photo comes out upright, the same whether the browser turns it or the module does', async ({
    page,
  }) => {
    await openBlank(page);
    const out = await page.evaluate(async () => {
      const shot = await T.toBlob(T.quarters(), 'image/jpeg', 1);
      const base = PhotoShrink.browserSurface();
      // A browser that does not turn photos: it never sees the EXIF.
      const plain = Object.assign({}, base, {
        decode: async blob =>
          base.decode(
            new Blob([PhotoShrink.stripMetadata(new Uint8Array(await blob.arrayBuffer()))], { type: blob.type }),
          ),
      });
      const rows = [];
      for (let o = 1; o <= 8; o++) {
        const file = await T.withExif(shot, o, false);
        const byBrowser = (await PhotoShrink.prepare(file)).pages[0];
        const byModule = (await PhotoShrink.prepare(file, { surface: plain })).pages[0];
        rows.push({ o, browser: await T.corners(byBrowser.blob), module: await T.corners(byModule.blob) });
      }
      return rows;
    });
    out.forEach(row => {
      expect(row.module, 'orientation ' + row.o).toEqual(row.browser);
      expect(row.module.size).toEqual(row.o >= 5 ? [30, 40] : [40, 30]);
    });
    // Stored top-left is red. Unturned it stays there; a quarter turn puts it top-right.
    expect(out[0].module.corners).toEqual(['red', 'green', 'blue', 'yellow']);
    expect(out[5].module.corners).toEqual(['blue', 'red', 'yellow', 'green']);
    expect(out[2].module.corners).toEqual(['yellow', 'blue', 'green', 'red']);
  });

  test('a sideways 12-megapixel photo comes out 1500 × 2000', async ({ page }) => {
    await openBlank(page);
    const out = await page.evaluate(async () => {
      const shot = await T.toBlob(T.worksheet(4000, 3000, 0), 'image/jpeg', 0.9);
      const page = (await PhotoShrink.prepare(await T.withExif(shot, 6, true))).pages[0];
      return { width: page.width, height: page.height, bytes: page.bytes, max: PhotoShrink.MAX_BYTES };
    });
    expect([out.width, out.height]).toEqual([1500, 2000]);
    expect(out.bytes).toBeLessThan(out.max);
  });

  test('a sharp page passes the blurry check and a blurred one does not', async ({ page }) => {
    await openBlank(page);
    const out = await page.evaluate(async () => {
      const sharp = T.worksheet(3200, 2400, 4);
      const soft = document.createElement('canvas');
      soft.width = sharp.width;
      soft.height = sharp.height;
      const ctx = soft.getContext('2d');
      ctx.filter = 'blur(12px)';
      ctx.drawImage(sharp, 0, 0);
      const run = async canvas => {
        const file = new File([await T.toBlob(canvas, 'image/jpeg', 0.9)], 'p.jpg', { type: 'image/jpeg' });
        const p = (await PhotoShrink.prepare(file)).pages[0];
        return { sharpness: p.sharpness, blurry: p.blurry };
      };
      return { sharp: await run(sharp), soft: await run(soft), below: PhotoShrink.BLURRY_BELOW };
    });
    test.info().annotations.push({ type: 'sharpness', description: JSON.stringify(out) });
    expect(out.sharp.blurry).toBe(false);
    expect(out.soft.blurry).toBe(true);
    expect(out.sharp.sharpness).toBeGreaterThan(out.below);
    expect(out.soft.sharpness).toBeLessThan(out.below);
  });

  test('a see-through PNG gets a white background, and a WebP is taken', async ({ page }) => {
    await openBlank(page);
    const out = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 200;
      const png = new File([await T.toBlob(canvas, 'image/png')], 'drawing.png', { type: 'image/png' });
      const res = await PhotoShrink.prepare(png);
      const bitmap = await createImageBitmap(res.pages[0].blob);
      const check = document.createElement('canvas');
      check.width = 300;
      check.height = 200;
      const ctx = check.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const webp = new File([await T.toBlob(T.quarters(), 'image/webp', 0.9)], 'photo.webp', { type: 'image/webp' });
      const second = await PhotoShrink.prepare(webp);
      const word = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Essay.docx', { type: '' });
      return {
        png: { kind: res.kind, name: res.pages[0].name, pixel: Array.from(ctx.getImageData(150, 100, 1, 1).data) },
        webp: { ok: second.ok, kind: second.kind, type: second.pages[0].blob.type },
        word: await PhotoShrink.prepare(word),
        pdf: await PhotoShrink.prepare(new File(['%PDF-1.7\n'], 'Essay.pdf', { type: 'application/pdf' })),
      };
    });
    expect(out.png.kind).toBe('png');
    expect(out.png.name).toBe('drawing.jpg');
    out.png.pixel.slice(0, 3).forEach(v => expect(v).toBeGreaterThan(250));
    expect(out.webp).toEqual({ ok: true, kind: 'webp', type: 'image/jpeg' });
    expect(out.word).toEqual({ ok: false, reason: 'office', office: 'word' });
    // No PDF decoder ships yet: the seam says so.
    expect(out.pdf).toMatchObject({ ok: false, reason: 'no_decoder', kind: 'pdf' });
  });
});

test.describe('PhotoQueue in a browser', () => {
  /* Shrink two real pages and queue them for a submission that has no server id yet. */
  async function queueTwoPages(page) {
    return page.evaluate(
      async ([course, assessment, enrollment]) => {
        const pages = [];
        for (const grain of [2, 5]) {
          const shot = await T.toBlob(T.worksheet(1600, 1200, grain), 'image/jpeg', 0.9);
          const res = await PhotoShrink.prepare(new File([shot], 'page.jpg', { type: 'image/jpeg' }));
          pages.push(res.pages[0]);
        }
        const added = await PhotoQueue.add({ course, assessment, enrollment, submission: 'sm3x9k2local' }, pages);
        return { added, sizes: pages.map(p => p.blob.size), thumbs: pages.map(p => p.thumb.size) };
      },
      [COURSE, ASSESSMENT, ENROLLMENT],
    );
  }

  /* Give the submission and each page a server id, then send with an uploader that records. */
  async function sendAll(page, firstFile = 1) {
    return page.evaluate(
      async ([submission, firstFile]) => {
        await PhotoQueue.ready();
        const map = { sm3x9k2local: submission };
        PhotoQueue.pages().forEach((p, i) => {
          if (PhotoQueue.isLocalId(p.ids.file)) {
            map[p.ids.file] = 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(firstFile + i).padStart(12, '0');
          }
        });
        await PhotoQueue.rekey(map);
        const uploads = [];
        PhotoQueue.configure({
          upload: async (path, blob, info) => {
            const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
            uploads.push({ path, size: blob.size, part: info.part, order: info.order, jpeg: head[0] === 0xff });
            return { error: null };
          },
        });
        const result = await PhotoQueue.send();
        return { result, uploads, left: PhotoQueue.pages().length, stats: PhotoQueue.stats() };
      },
      [SUBMISSION, firstFile],
    );
  }

  test('photos wait in IndexedDB through a reload, then send in order to paths built from server ids', async ({
    page,
  }) => {
    await openBlank(page);
    const queued = await queueTwoPages(page);
    expect(queued.added.ok).toBe(true);
    expect(queued.added.ids).toHaveLength(2);

    // Nothing can go yet: the submission has only a local id.
    const early = await page.evaluate(async () => {
      let calls = 0;
      PhotoQueue.configure({ upload: async () => (calls++, { error: null }) });
      const result = await PhotoQueue.send();
      return { result, calls, states: PhotoQueue.pages().map(p => p.state) };
    });
    expect(early.calls).toBe(0);
    expect(early.states).toEqual(['blocked', 'blocked']);

    await openBlank(page); // reload
    const after = await page.evaluate(async () => {
      await PhotoQueue.ready();
      const rows = PhotoQueue.pages('sm3x9k2local');
      const kept = await PhotoQueue.blobs(rows[0].id);
      return {
        ids: rows.map(r => r.id),
        orders: rows.map(r => r.order),
        photo: kept.photo.size,
        type: kept.photo.type,
      };
    });
    expect(after.ids).toEqual(queued.added.ids);
    expect(after.orders).toEqual([0, 1]);
    expect(after.photo).toBe(queued.sizes[0]);
    expect(after.type).toBe('image/jpeg');

    const sent = await sendAll(page);
    expect(sent.result).toMatchObject({ sent: 2, failed: 0, note: null });
    expect(sent.uploads.map(u => [u.order, u.part])).toEqual([
      [0, 'photo'],
      [0, 'thumb'],
      [1, 'photo'],
      [1, 'thumb'],
    ]);
    expect(sent.uploads.map(u => u.size)).toEqual([
      queued.sizes[0],
      queued.thumbs[0],
      queued.sizes[1],
      queued.thumbs[1],
    ]);
    expect(sent.uploads.every(u => u.jpeg)).toBe(true);
    sent.uploads.forEach(u => {
      const parts = u.path.replace(/(-thumb)?\.jpg$/, '').split('/');
      expect(parts).toHaveLength(5);
      parts.forEach(part => expect(part).toMatch(UUID));
      expect(u.path.startsWith(FOLDER + '/')).toBe(true);
    });
    expect(sent.left).toBe(0);

    await openBlank(page); // and they are gone for good
    expect(await page.evaluate(async () => (await PhotoQueue.ready(), PhotoQueue.stats().queued))).toBe(0);
  });

  test('wipe() empties IndexedDB', async ({ page }) => {
    await openBlank(page);
    await queueTwoPages(page);
    expect(await page.evaluate(() => PhotoQueue.stats().queued)).toBe(2);
    expect(await page.evaluate(() => PhotoQueue.wipe())).toEqual({ ok: true, error: null });
    await openBlank(page);
    const left = await page.evaluate(async () => {
      await PhotoQueue.ready();
      const store = PhotoQueue.indexedDbStore();
      return { queued: PhotoQueue.stats().queued, rows: (await store.list()).length };
    });
    expect(left).toEqual({ queued: 0, rows: 0 });
  });

  test('two tabs sending at once upload each file once', async ({ context, page }) => {
    await openBlank(page);
    const queued = await queueTwoPages(page);
    const other = await context.newPage();
    await openBlank(other);

    const [a, b] = await Promise.all([sendAll(page), sendAll(other)]);
    const paths = [...a.uploads, ...b.uploads].map(u => u.path);
    expect(paths).toHaveLength(4);
    expect(new Set(paths).size).toBe(4);
    expect(a.result.sent + b.result.sent).toBe(2);
    expect(queued.added.ids).toHaveLength(2);

    // Both tabs see an empty queue.
    for (const tab of [page, other]) {
      expect(await tab.evaluate(async () => (await PhotoQueue.ready(), PhotoQueue.pages().length))).toBe(0);
    }
  });
});
