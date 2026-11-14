/**
 * shared/photo-shrink.js: every photo is made smaller before it uploads.
 *
 * The browser's picture calls sit behind a surface, so these tests run the
 * module with a fake one: pictures are grids of numbers, a "JPEG" is a few
 * real JPEG header segments around them, and its size is whatever the test
 * says a page of that size and quality weighs. What only a real browser can
 * show (a real decode, a real canvas, real JPEG sizes) is in
 * e2e/photo-modules.spec.js.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../shared/photo-shrink.js', import.meta.url), 'utf-8');
runInThisContext(source, { filename: 'shared/photo-shrink.js' });
const PS = window.PhotoShrink;

/* ── Fake pictures ──────────────────────────────────────────────────────── */

const u16 = n => [(n >> 8) & 0xff, n & 0xff];
const u32 = n => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const flip = (bytes, little) => (little ? bytes.slice().reverse() : bytes);

/* An EXIF segment with an orientation and, when asked, a GPS block. */
function exifSegment({ orientation = 1, gps = false, little = false } = {}) {
  const s = n => flip(u16(n), little);
  const l = n => flip(u32(n), little);
  const entries = [[...s(0x0112), ...s(3), ...l(1), ...s(orientation), 0, 0]];
  if (gps) entries.push([...s(0x8825), ...s(4), ...l(1), ...l(8 + 2 + 24 + 4)]);
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...s(42),
    ...l(8),
    ...s(entries.length),
    ...entries.flat(),
    ...l(0),
  ];
  // The GPS block: one entry, GPSLatitudeRef = "N".
  if (gps) tiff.push(...s(1), ...s(1), ...s(2), ...l(2), 0x4e, 0, 0, 0, ...l(0));
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return [0xff, 0xe1, ...u16(body.length + 2), ...body];
}

const APP0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];

/* A fake JPEG: real header segments (so the module's own JPEG reading runs),
   the size in a frame header, then the pixels and padding up to `size`. */
function jpegBytes({ width, height, pixels = null, segments = [], size = 0 }) {
  const head = [0xff, 0xd8, ...APP0, ...segments.flat()];
  head.push(0xff, 0xc0, 0x00, 0x0b, 8, ...u16(height), ...u16(width), 1, 1, 0x11, 0);
  head.push(0xff, 0xda, pixels ? 1 : 0);
  const body = pixels ? pixels.length : 0;
  const out = new Uint8Array(Math.max(size, head.length + body + 2));
  out.set(head, 0);
  if (pixels) out.set(pixels, head.length);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

function readJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let at = 2;
  let width = 0;
  let height = 0;
  while (bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
    if (bytes[at + 1] === 0xc0) {
      height = (bytes[at + 5] << 8) | bytes[at + 6];
      width = (bytes[at + 7] << 8) | bytes[at + 8];
    }
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  const pixels = bytes[at + 2] === 1 ? bytes.slice(at + 3, at + 3 + width * height * 4) : null;
  return { width, height, pixels };
}

const blobBytes = async blob => new Uint8Array(await blob.arrayBuffer());

/* A picture is { width, height, at(x, y) → [r, g, b] }. */
function grid(width, height, pixels) {
  return {
    width,
    height,
    at: (x, y) => {
      if (!pixels) return [(x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256];
      const i = (y * width + x) * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2]];
    },
  };
}

/* What a stored picture looks like upright, straight from what each EXIF
   orientation means (which visual side row 0 and column 0 are). Worked out
   apart from the module's canvas transforms, to check them. */
function upright(img, orientation) {
  const W = img.width;
  const H = img.height;
  const from = {
    1: (X, Y) => [X, Y],
    2: (X, Y) => [W - 1 - X, Y],
    3: (X, Y) => [W - 1 - X, H - 1 - Y],
    4: (X, Y) => [X, H - 1 - Y],
    5: (X, Y) => [Y, X],
    6: (X, Y) => [Y, H - 1 - X],
    7: (X, Y) => [W - 1 - Y, H - 1 - X],
    8: (X, Y) => [W - 1 - Y, X],
  }[orientation];
  const sideways = orientation >= 5;
  return { width: sideways ? H : W, height: sideways ? W : H, at: (X, Y) => img.at(...from(X, Y)) };
}

function rgba(img) {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = img.at(x, y);
      out.set([r, g, b, 255], (y * img.width + x) * 4);
    }
  }
  return out;
}

/* The surface the module draws on. opts:
     rotates   the decoder turns a photo upright itself (default true)
     sizeFor   (w, h, quality) → bytes of that JPEG
     leak      every JPEG it makes carries EXIF with GPS (to prove the strip)
     reads     kinds beyond JPEG the decoder can read (e.g. ['heic'])
     resizes   the decoder honours a size hint, as createImageBitmap's
               resizeWidth / resizeHeight do (each hint is logged either way) */
function fakeSurface(opts = {}) {
  const rotates = opts.rotates !== false;
  const sizeFor = opts.sizeFor || ((w, h, q) => Math.round(w * h * q * 0.15));
  const log = { decodes: [], hints: [], encodes: [], canvases: 0, released: 0, closed: 0 };
  const surface = {
    log,
    async decode(blob, hint) {
      const bytes = await blobBytes(blob);
      const kind = PS.sniff(bytes);
      log.decodes.push(kind);
      log.hints.push(hint || null);
      if (kind !== 'jpeg') {
        if (!(opts.reads || []).includes(kind)) throw new Error('The picture could not be read');
        return { ...grid(40, 30), source: grid(40, 30), close: () => log.closed++ };
      }
      const jpeg = readJpeg(bytes);
      let img = grid(jpeg.width, jpeg.height, jpeg.pixels);
      if (rotates) img = upright(img, PS.readExif(bytes).orientation);
      if (hint && opts.resizes) {
        const s = (hint.resizeWidth || hint.resizeHeight) / (hint.resizeWidth ? img.width : img.height);
        const src = img;
        img = { width: Math.round(src.width * s), height: Math.round(src.height * s) };
        img.at = (x, y) => src.at(Math.floor(x / s), Math.floor(y / s));
      }
      return { width: img.width, height: img.height, source: img, close: () => log.closed++ };
    },
    canvas(w, h) {
      log.canvases++;
      let img = { width: w, height: h, at: () => [0, 0, 0] };
      const canvas = {
        width: w,
        height: h,
        at: (x, y) => img.at(x, y),
        draw(src, m, dw, dh) {
          const [a, b, c, d, e, f] = m;
          const det = a * d - b * c;
          img = {
            width: w,
            height: h,
            at(X, Y) {
              const px = X + 0.5 - e;
              const py = Y + 0.5 - f;
              const x = (d * px - c * py) / det;
              const y = (-b * px + a * py) / det;
              if (x < 0 || y < 0 || x >= dw || y >= dh) return [255, 255, 255];
              return src.at(Math.floor((x * src.width) / dw), Math.floor((y * src.height) / dh));
            },
          };
        },
        pixels: () => rgba({ width: w, height: h, at: (x, y) => img.at(x, y) }),
        toJpeg(quality) {
          log.encodes.push({ w, h, quality });
          const bytes = jpegBytes({
            width: w,
            height: h,
            pixels: w * h <= 64 ? canvas.pixels() : null,
            segments: opts.leak ? [exifSegment({ orientation: 1, gps: true })] : [],
            size: sizeFor(w, h, quality),
          });
          return Promise.resolve(new Blob([bytes], { type: 'image/jpeg' }));
        },
        release: () => log.released++,
      };
      canvas.source = canvas;
      return canvas;
    },
    fromPixels(px) {
      const img = grid(px.width, px.height, px.data);
      return { width: px.width, height: px.height, source: img, close: () => log.closed++ };
    },
  };
  return surface;
}

function photo({ width = 4000, height = 3000, name = 'IMG_2041.jpg', type = 'image/jpeg', ...rest } = {}) {
  const segments = rest.exif ? [exifSegment(rest.exif)] : [];
  return new File([jpegBytes({ width, height, pixels: rest.pixels, segments })], name, { type });
}

const heicFile = (name = 'IMG_2041.HEIC', type = 'image/heic') =>
  new File([new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map(c => c.charCodeAt(0)), 0, 0, 0, 0])], name, { type });

const pdfFile = (name = 'Essay.pdf', extra = 64) =>
  new File([new TextEncoder().encode('%PDF-1.7\n'), new Uint8Array(extra)], name, { type: 'application/pdf' });

const fileLike = (name, type, size = 1000) => ({ name, type, size });

beforeEach(() => {
  PS.configure({ surface: null, decodeHeic: null, openPdf: null });
});

/* ── File types ─────────────────────────────────────────────────────────── */

describe('which files are taken', () => {
  it('takes JPEG, PNG, HEIC, HEIF, WebP and PDF by type', () => {
    expect(PS.classify(fileLike('a', 'image/jpeg'))).toEqual({ ok: true, kind: 'jpeg' });
    expect(PS.classify(fileLike('a', 'image/png'))).toEqual({ ok: true, kind: 'png' });
    expect(PS.classify(fileLike('a', 'image/heic'))).toEqual({ ok: true, kind: 'heic' });
    expect(PS.classify(fileLike('a', 'image/heif'))).toEqual({ ok: true, kind: 'heic' });
    expect(PS.classify(fileLike('a', 'image/webp'))).toEqual({ ok: true, kind: 'webp' });
    expect(PS.classify(fileLike('a', 'application/pdf'))).toEqual({ ok: true, kind: 'pdf' });
  });

  it('takes them by name when the browser gives no type, as a Chromebook does for HEIC', () => {
    expect(PS.classify(fileLike('IMG_2041.HEIC', ''))).toEqual({ ok: true, kind: 'heic' });
    expect(PS.classify(fileLike('scan.JPG', ''))).toEqual({ ok: true, kind: 'jpeg' });
    expect(PS.classify(fileLike('Lab Report.pdf', 'application/octet-stream'))).toEqual({ ok: true, kind: 'pdf' });
  });

  it('refuses a Word file as office, by type and by name', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(PS.classify(fileLike('Essay.docx', docx))).toEqual({ ok: false, reason: 'office', office: 'word' });
    expect(PS.classify(fileLike('Essay', 'application/msword'))).toEqual({
      ok: false,
      reason: 'office',
      office: 'word',
    });
    expect(PS.classify(fileLike('Essay.DOC', ''))).toEqual({ ok: false, reason: 'office', office: 'word' });
    expect(PS.classify(fileLike('Essay.docx', 'application/octet-stream')).reason).toBe('office');
  });

  it('refuses a PowerPoint file as office, by type and by name', () => {
    const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    expect(PS.classify(fileLike('Slides.pptx', pptx))).toEqual({ ok: false, reason: 'office', office: 'powerpoint' });
    expect(PS.classify(fileLike('Slides', 'application/vnd.ms-powerpoint')).office).toBe('powerpoint');
    expect(PS.classify(fileLike('Slides.ppt', '')).office).toBe('powerpoint');
  });

  it('refuses anything else plainly', () => {
    ['notes.txt', 'marks.xlsx', 'clip.mp4', 'song.mp3', 'page.html', 'archive.zip', 'noextension'].forEach(name => {
      expect(PS.classify(fileLike(name, ''))).toEqual({ ok: false, reason: 'unsupported' });
    });
    expect(PS.classify(fileLike('a.gif', 'image/gif')).reason).toBe('unsupported');
    expect(PS.classify(null).reason).toBe('unsupported');
  });

  it('refuses a PDF over 20 MB, and takes one at the limit', () => {
    expect(PS.MAX_PDF_BYTES).toBe(20 * 1024 * 1024);
    expect(PS.classify(fileLike('Big.pdf', 'application/pdf', PS.MAX_PDF_BYTES + 1))).toEqual({
      ok: false,
      reason: 'pdf_too_large',
      kind: 'pdf',
      limit: PS.MAX_PDF_BYTES,
    });
    expect(PS.classify(fileLike('Big.pdf', 'application/pdf', PS.MAX_PDF_BYTES)).ok).toBe(true);
    // A photo has no such limit: it is shrunk, whatever it weighs.
    expect(PS.classify(fileLike('Huge.jpg', 'image/jpeg', 40 * 1024 * 1024)).ok).toBe(true);
  });

  it('refuses an empty file', () => {
    expect(PS.classify(fileLike('a.jpg', 'image/jpeg', 0)).reason).toBe('empty');
  });

  it('knows a file by its first bytes', () => {
    const text = s => [...s].map(c => c.charCodeAt(0));
    expect(PS.sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(PS.sniff(new Uint8Array([0x89, ...text('PNG'), 13, 10, 26, 10]))).toBe('png');
    expect(PS.sniff(new Uint8Array([...text('RIFF'), 1, 2, 3, 4, ...text('WEBP')]))).toBe('webp');
    expect(PS.sniff(new Uint8Array(text('%PDF-1.7')))).toBe('pdf');
    expect(PS.sniff(new Uint8Array([0, 0, 0, 24, ...text('ftypheic')]))).toBe('heic');
    expect(PS.sniff(new Uint8Array([0, 0, 0, 24, ...text('ftypmif1')]))).toBe('heic');
    expect(PS.sniff(new Uint8Array([...text('PK'), 3, 4]))).toBe('zip');
    expect(PS.sniff(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('ole');
    expect(PS.sniff(new Uint8Array(text('hello there')))).toBe(null);
  });
});

describe('prepare() refusals', () => {
  it('refuses a Word file before reading it, so the screen can say "Save it as a PDF first"', async () => {
    const surface = fakeSurface();
    const word = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], 'Essay.docx', { type: '' });
    expect(await PS.prepare(word, { surface })).toEqual({ ok: false, reason: 'office', office: 'word' });
    expect(surface.log.decodes).toEqual([]);
    expect(surface.log.canvases).toBe(0);
  });

  it('refuses a PowerPoint file the same way', async () => {
    const slides = new File([new Uint8Array(8)], 'Slides.pptx', { type: '' });
    expect(await PS.prepare(slides, { surface: fakeSurface() })).toEqual({
      ok: false,
      reason: 'office',
      office: 'powerpoint',
    });
  });

  it('refuses a Word file renamed to look like a photo', async () => {
    const disguised = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], 'Essay.jpg', { type: 'image/jpeg' });
    expect(await PS.prepare(disguised, { surface: fakeSurface() })).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('refuses a text file and an empty file', async () => {
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    expect(await PS.prepare(text, { surface: fakeSurface() })).toEqual({ ok: false, reason: 'unsupported' });
    const empty = new File([], 'IMG_1.jpg', { type: 'image/jpeg' });
    expect(await PS.prepare(empty, { surface: fakeSurface() })).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses a PDF over 20 MB without opening it', async () => {
    let opened = 0;
    const openPdf = async () => {
      opened++;
      return { pages: 1, page: async () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16) }) };
    };
    const res = await PS.prepare(pdfFile('Big.pdf', PS.MAX_PDF_BYTES), { surface: fakeSurface(), openPdf });
    expect(res).toEqual({ ok: false, reason: 'pdf_too_large', kind: 'pdf', limit: PS.MAX_PDF_BYTES });
    expect(opened).toBe(0);
  });

  it('calls a photo that cannot be decoded unreadable', async () => {
    // Named and typed PNG, with bytes nothing recognises.
    const broken = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'scan.png', { type: 'image/png' });
    const res = await PS.prepare(broken, { surface: fakeSurface() });
    expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'png' });
  });

  it('answers failed, not unreadable, when the browser itself gives out', async () => {
    const surface = fakeSurface();
    surface.canvas = () => {
      throw new Error('out of memory');
    };
    const res = await PS.prepare(photo(), { surface });
    expect(res).toMatchObject({ ok: false, reason: 'failed', kind: 'jpeg', error: 'out of memory' });
  });
});

/* ── Shrink ─────────────────────────────────────────────────────────────── */

describe('shrinking a photo', () => {
  it('turns a 12-megapixel photo into a 2000 px JPEG at or under 500 KB', async () => {
    const surface = fakeSurface();
    const res = await PS.prepare(photo({ width: 4000, height: 3000 }), { surface });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('jpeg');
    expect(res.pages).toHaveLength(1);
    const page = res.pages[0];
    expect([page.width, page.height]).toEqual([2000, 1500]);
    expect(Math.max(page.width, page.height)).toBe(PS.LONG_SIDE);
    expect(page.blob.type).toBe('image/jpeg');
    expect(page.bytes).toBe(page.blob.size);
    expect(page.bytes).toBeLessThanOrEqual(PS.AIM_BYTES);
    expect(page.bytes).toBeLessThan(PS.MAX_BYTES);
    expect(page.quality).toBe(PS.QUALITY_STEPS[0]);
    expect(page).toMatchObject({ name: 'IMG_2041.jpg', page: 1, pages: 1 });
    // One encode was enough, and every canvas was let go.
    expect(surface.log.encodes.filter(e => e.w === 2000)).toEqual([{ w: 2000, h: 1500, quality: 0.82 }]);
    expect(surface.log.released).toBe(surface.log.canvases);
    expect(surface.log.closed).toBeGreaterThan(0);
  });

  it('keeps a tall photo tall', async () => {
    const res = await PS.prepare(photo({ width: 3000, height: 4000 }), { surface: fakeSurface() });
    expect([res.pages[0].width, res.pages[0].height]).toEqual([1500, 2000]);
  });

  it('never enlarges a small photo', async () => {
    const res = await PS.prepare(photo({ width: 800, height: 600 }), { surface: fakeSurface() });
    expect([res.pages[0].width, res.pages[0].height]).toEqual([800, 600]);
  });

  it('makes a thumbnail at the same time', async () => {
    const surface = fakeSurface();
    const page = (await PS.prepare(photo({ width: 4000, height: 3000 }), { surface })).pages[0];
    const thumb = readJpeg(await blobBytes(page.thumb));
    expect([thumb.width, thumb.height]).toEqual([400, 300]);
    expect(Math.max(thumb.width, thumb.height)).toBe(PS.THUMB_LONG_SIDE);
    expect(page.thumb.type).toBe('image/jpeg');
    expect(page.thumb.size).toBeLessThan(page.blob.size);
  });

  it('does not enlarge a small photo to make its thumbnail', async () => {
    const page = (await PS.prepare(photo({ width: 200, height: 150 }), { surface: fakeSurface() })).pages[0];
    const thumb = readJpeg(await blobBytes(page.thumb));
    expect([thumb.width, thumb.height]).toEqual([200, 150]);
  });

  it('steps the quality down until the page is at or under 500 KB', async () => {
    // A busy page: 760 KB at the first quality, lighter with each step.
    const weights = { 0.82: 760, 0.74: 640, 0.66: 540, 0.58: 470, 0.5: 400 };
    const surface = fakeSurface({ sizeFor: (w, h, q) => (w === 2000 ? weights[q] * 1000 : 20000) });
    const page = (await PS.prepare(photo(), { surface })).pages[0];
    expect(surface.log.encodes.filter(e => e.w === 2000).map(e => e.quality)).toEqual([0.82, 0.74, 0.66, 0.58]);
    expect(page.quality).toBe(0.58);
    expect(page.bytes).toBe(470000);
    expect([page.width, page.height]).toEqual([2000, 1500]);
  });

  it('keeps the full size at the lowest quality when that is still under the 2 MB limit', async () => {
    const surface = fakeSurface({ sizeFor: (w, h, q) => (w === 2000 ? Math.round(1500000 * q) : 20000) });
    const page = (await PS.prepare(photo(), { surface })).pages[0];
    expect(page.quality).toBe(0.5);
    expect(page.bytes).toBe(750000);
    expect([page.width, page.height]).toEqual([2000, 1500]);
  });

  it('redraws smaller until the page is under the 2 MB limit', async () => {
    // Two bytes a pixel whatever the quality: 6 MB at 2000 px.
    const surface = fakeSurface({ sizeFor: (w, h) => w * h * 2 });
    const page = (await PS.prepare(photo(), { surface })).pages[0];
    expect(page.bytes).toBeLessThan(PS.MAX_BYTES);
    expect(page.blob.size).toBeLessThan(PS.MAX_BYTES);
    expect([page.width, page.height]).toEqual([1024, 768]);
    // 2000 at every quality, then 1600, 1280 and 1024 at the lowest only.
    const big = surface.log.encodes.filter(e => e.w > PS.THUMB_LONG_SIDE);
    expect(big.map(e => e.w)).toEqual([2000, 2000, 2000, 2000, 2000, 1600, 1280, 1024]);
    expect(big.slice(5).every(e => e.quality === 0.5)).toBe(true);
  });

  it('refuses a page it cannot get under the limit, and never returns one over it', async () => {
    const surface = fakeSurface({ sizeFor: () => PS.MAX_BYTES });
    const res = await PS.prepare(photo(), { surface });
    expect(res).toMatchObject({ ok: false, reason: 'too_large', kind: 'jpeg' });
    expect(res.pages).toBeUndefined();
  });

  it('hashes the output with SHA-256, the same for the same photo and different for another', async () => {
    const one = (await PS.prepare(photo({ width: 400, height: 300 }), { surface: fakeSurface() })).pages[0];
    const again = (await PS.prepare(photo({ width: 400, height: 300 }), { surface: fakeSurface() })).pages[0];
    const other = (await PS.prepare(photo({ width: 400, height: 301 }), { surface: fakeSurface() })).pages[0];
    const expected = createHash('sha256')
      .update(await blobBytes(one.blob))
      .digest('hex');
    expect(one.hash).toBe(expected);
    expect(one.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(again.hash).toBe(one.hash);
    expect(other.hash).not.toBe(one.hash);
  });

  it('takes a JPEG whatever it is named, because its bytes say so', async () => {
    const misnamed = photo({ name: 'photo.png', type: 'image/png', width: 400, height: 300 });
    expect(await PS.prepare(misnamed, { surface: fakeSurface() })).toMatchObject({ ok: true, kind: 'jpeg' });
    const nameless = new Blob([jpegBytes({ width: 400, height: 300 })]);
    const res = await PS.prepare(nameless, { surface: fakeSurface() });
    expect(res).toMatchObject({ ok: true, kind: 'jpeg' });
    expect(res.pages[0].name).toBe('page.jpg');
  });

  it('uses the surface and decoders set once with configure()', async () => {
    const surface = fakeSurface();
    PS.configure({ surface });
    expect((await PS.prepare(photo({ width: 400, height: 300 }))).ok).toBe(true);
    expect(surface.log.decodes).toContain('jpeg');
  });

  it('names pages after the file', () => {
    expect(PS.outputName('IMG_2041.HEIC', 1, 1)).toBe('IMG_2041.jpg');
    expect(PS.outputName('Lab Report.final.pdf', 2, 3)).toBe('Lab Report.final-page-2.jpg');
    expect(PS.outputName('C:\\Users\\me\\scan.PNG', 1, 1)).toBe('scan.jpg');
    expect(PS.outputName('', 1, 1)).toBe('page.jpg');
    expect(PS.outputName(undefined, 3, 4)).toBe('page-page-3.jpg');
  });
});

/* ── Speed: decoded at the size wanted, and the quality found sooner ─────────
   (docs/plans/speed-assessment.md, section 7, B3). Counted, not timed. */

describe('a photo is decoded at the size wanted, not whole', () => {
  it('asks for a 12-megapixel photo at 2000 px on its long side, and the page is the same', async () => {
    const surface = fakeSurface({ resizes: true });
    const page = (await PS.prepare(photo({ width: 4000, height: 3000 }), { surface })).pages[0];
    // No decode of the whole photo (there was one).
    expect(surface.log.hints).toEqual([{ resizeWidth: 2000 }]);
    expect([page.width, page.height]).toEqual([2000, 1500]);
    const thumb = readJpeg(await blobBytes(page.thumb));
    expect([thumb.width, thumb.height]).toEqual([400, 300]);
    expect(page.bytes).toBeLessThanOrEqual(PS.AIM_BYTES);
    expect(page.hash).toBe(
      createHash('sha256')
        .update(await blobBytes(page.blob))
        .digest('hex'),
    );
    // The same page as a decoder that ignores the hint gives.
    const whole = (await PS.prepare(photo({ width: 4000, height: 3000 }), { surface: fakeSurface() })).pages[0];
    expect([whole.width, whole.height, whole.bytes, whole.quality]).toEqual([
      page.width,
      page.height,
      page.bytes,
      page.quality,
    ]);
  });

  it('names the long side: tall by height, wide by width, a sideways photo as the browser turns it', async () => {
    const hintFor = async (file, o) => {
      const surface = fakeSurface(o);
      await PS.prepare(file, { surface });
      return surface.log.hints.filter(Boolean);
    };
    expect(await hintFor(photo({ width: 3000, height: 4000 }))).toEqual([{ resizeHeight: 2000 }]);
    expect(await hintFor(photo({ width: 4000, height: 3000 }))).toEqual([{ resizeWidth: 2000 }]);
    // Stored 4000 × 3000 on its side: upright it is tall. A browser that turns it decodes it tall.
    const sideways = () => photo({ width: 4000, height: 3000, exif: { orientation: 6 } });
    expect(await hintFor(sideways(), { rotates: true })).toEqual([{ resizeHeight: 2000 }]);
    expect(await hintFor(sideways(), { rotates: false })).toEqual([{ resizeWidth: 2000 }]);
    for (const o of [{ rotates: true }, { rotates: false }]) {
      const page = (await PS.prepare(sideways(), { surface: fakeSurface({ ...o, resizes: true }) })).pages[0];
      expect([page.width, page.height]).toEqual([1500, 2000]);
    }
  });

  it('decodes a photo already small enough whole, and one it cannot size whole', async () => {
    const small = fakeSurface();
    await PS.prepare(photo({ width: 2000, height: 1500 }), { surface: small });
    expect(small.log.hints).toEqual([null]);
    expect(PS.storedSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(PS.storedSize(jpegBytes({ width: 4032, height: 3024 }))).toEqual({ width: 4032, height: 3024 });
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(3000), ...u32(2000)]);
    expect(PS.storedSize(png)).toEqual({ width: 3000, height: 2000 });
  });
});

describe('the quality search starts where the last page ended', () => {
  // KB at each quality. A busy page: 0.58 is the first at or under 500 KB.
  const BUSY = { 0.82: 760, 0.74: 640, 0.66: 540, 0.58: 470, 0.5: 400 };
  const LIGHT = { 0.82: 760, 0.74: 480, 0.66: 450, 0.58: 420, 0.5: 400 };
  const HEAVY = { 0.82: 900, 0.74: 800, 0.66: 700, 0.58: 600, 0.5: 520 };
  let kb = BUSY;
  const sizeFor = (w, h, q) => (w === 2000 ? kb[q] * 1000 : 20000);
  const full = s => s.log.encodes.filter(e => e.w === 2000).map(e => e.quality);
  const next = async (surface, weights) => {
    kb = weights;
    surface.log.encodes.length = 0;
    return (await PS.prepare(photo(), { surface })).pages[0];
  };

  it('finds the same quality in two encodes on the next page, not four', async () => {
    const surface = fakeSurface({ sizeFor });
    const first = await next(surface, BUSY);
    expect(full(surface)).toEqual([0.82, 0.74, 0.66, 0.58]);
    const second = await next(surface, BUSY);
    expect(full(surface)).toEqual([0.58, 0.66]);
    expect([second.quality, second.bytes]).toEqual([first.quality, first.bytes]);
  });

  it('still takes the highest quality that fits, up or down from there, as stepping down from the top does', async () => {
    const surface = fakeSurface({ sizeFor });
    await next(surface, BUSY); // ends at 0.58
    const lighter = await next(surface, LIGHT);
    expect(full(surface)).toEqual([0.58, 0.66, 0.74, 0.82]);
    expect(lighter.quality).toBe(0.74);
    const heavier = await next(surface, HEAVY); // starts at 0.74
    expect(full(surface)).toEqual([0.74, 0.66, 0.58, 0.5]);
    expect([heavier.quality, heavier.bytes]).toEqual([0.5, 520000]);
    // The same answers a fresh search from the top gives.
    for (const [w, q] of [
      [LIGHT, 0.74],
      [HEAVY, 0.5],
    ]) {
      expect((await next(fakeSurface({ sizeFor }), w)).quality).toBe(q);
    }
  });
});

/* ── Orientation ────────────────────────────────────────────────────────── */

describe('a sideways photo comes out upright', () => {
  // 3 × 2, every pixel its own colour.
  const stored = new Uint8ClampedArray(
    [10, 20, 30, 40, 50, 60].flatMap(v => [v, v + 100, 255 - v, 255]), // rows: 10 20 30 / 40 50 60
  );
  const want = o => Array.from(rgba(upright(grid(3, 2, stored), o)));

  for (let o = 1; o <= 8; o++) {
    it(`orientation ${o}, on a browser that does not turn photos itself`, async () => {
      const surface = fakeSurface({ rotates: false });
      const file = photo({ width: 3, height: 2, pixels: stored, exif: { orientation: o } });
      const page = (await PS.prepare(file, { surface })).pages[0];
      const out = readJpeg(await blobBytes(page.blob));
      expect([page.width, page.height]).toEqual(o >= 5 ? [2, 3] : [3, 2]);
      expect([out.width, out.height]).toEqual([page.width, page.height]);
      expect(Array.from(out.pixels)).toEqual(want(o));
    });

    it(`orientation ${o}, on a browser that turns photos itself: not turned twice`, async () => {
      const surface = fakeSurface({ rotates: true });
      const file = photo({ width: 3, height: 2, pixels: stored, exif: { orientation: o, little: true } });
      const page = (await PS.prepare(file, { surface })).pages[0];
      const out = readJpeg(await blobBytes(page.blob));
      expect([page.width, page.height]).toEqual(o >= 5 ? [2, 3] : [3, 2]);
      expect(Array.from(out.pixels)).toEqual(want(o));
    });
  }

  it('scales a sideways 12-megapixel photo to 1500 × 2000', async () => {
    const file = photo({ width: 4000, height: 3000, exif: { orientation: 6 } });
    const turnedHere = (await PS.prepare(file, { surface: fakeSurface({ rotates: false }) })).pages[0];
    const turnedByBrowser = (await PS.prepare(file, { surface: fakeSurface({ rotates: true }) })).pages[0];
    expect([turnedHere.width, turnedHere.height]).toEqual([1500, 2000]);
    expect([turnedByBrowser.width, turnedByBrowser.height]).toEqual([1500, 2000]);
  });

  it('asks a surface only once whether it turns photos', async () => {
    const surface = fakeSurface({ rotates: false });
    const file = () => photo({ width: 30, height: 20, exif: { orientation: 6 } });
    await PS.prepare(file(), { surface });
    const probes = surface.log.encodes.filter(e => e.w === 2 && e.h === 1).length;
    await PS.prepare(file(), { surface });
    expect(probes).toBe(1);
    expect(surface.log.encodes.filter(e => e.w === 2 && e.h === 1)).toHaveLength(1);
  });

  it('reads orientation and GPS from EXIF in either byte order', () => {
    [false, true].forEach(little => {
      const bytes = jpegBytes({
        width: 4,
        height: 4,
        segments: [exifSegment({ orientation: 8, gps: true, little })],
      });
      expect(PS.readExif(bytes)).toEqual({ exif: true, orientation: 8, gps: true, metadata: true });
    });
    const plain = jpegBytes({ width: 4, height: 4 });
    expect(PS.readExif(plain)).toEqual({ exif: false, orientation: 1, gps: false, metadata: false });
    expect(PS.readExif(new Uint8Array([1, 2, 3]))).toEqual({
      exif: false,
      orientation: 1,
      gps: false,
      metadata: false,
    });
  });

  it('survives EXIF that is cut short or points nowhere', () => {
    const seg = exifSegment({ orientation: 6, gps: true });
    const cut = jpegBytes({ width: 4, height: 4 }).slice(0, 20);
    const short = new Uint8Array([...cut, ...seg.slice(0, 18)]);
    expect(PS.readExif(short).orientation).toBe(1);
    const wild = seg.slice();
    wild.splice(14, 4, 0xff, 0xff, 0xff, 0xf0); // the first directory "starts" far past the end
    expect(PS.readExif(jpegBytes({ width: 4, height: 4, segments: [wild] })).orientation).toBe(1);
  });
});

/* ── Privacy ────────────────────────────────────────────────────────────── */

describe('location and camera details are dropped', () => {
  it('a photo with GPS in its EXIF comes out with no EXIF or GPS segment', async () => {
    const file = photo({ width: 4000, height: 3000, exif: { orientation: 1, gps: true } });
    expect(PS.readExif(await blobBytes(file))).toMatchObject({ exif: true, gps: true });
    const page = (await PS.prepare(file, { surface: fakeSurface() })).pages[0];
    for (const blob of [page.blob, page.thumb]) {
      expect(PS.readExif(await blobBytes(blob))).toEqual({ exif: false, orientation: 1, gps: false, metadata: false });
    }
  });

  it('cuts EXIF out even if the browser were to write it into the redraw', async () => {
    const surface = fakeSurface({ leak: true });
    const page = (await PS.prepare(photo({ width: 400, height: 300 }), { surface })).pages[0];
    const bytes = await blobBytes(page.blob);
    expect(PS.readExif(bytes)).toEqual({ exif: false, orientation: 1, gps: false, metadata: false });
    expect(PS.readExif(await blobBytes(page.thumb)).metadata).toBe(false);
    expect(page.blob.type).toBe('image/jpeg');
    expect(page.bytes).toBe(bytes.length);
    // The hash is of what is uploaded: the cleaned bytes.
    expect(page.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    // Still a JPEG with its size and picture data.
    expect(readJpeg(bytes)).toMatchObject({ width: 400, height: 300 });
  });

  it('stripMetadata removes EXIF, XMP, IPTC and comments, and nothing else', () => {
    const xmp = [0xff, 0xe1, 0x00, 0x08, 0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f];
    const iptc = [0xff, 0xed, 0x00, 0x06, 1, 2, 3, 4];
    const comment = [0xff, 0xfe, 0x00, 0x05, 0x68, 0x69, 0x21];
    const icc = [0xff, 0xe2, 0x00, 0x06, 9, 9, 9, 9];
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(7);
    const clean = jpegBytes({ width: 4, height: 4, pixels, segments: [icc] });
    const dirty = jpegBytes({
      width: 4,
      height: 4,
      pixels,
      segments: [exifSegment({ orientation: 6, gps: true }), xmp, icc, iptc, comment],
    });
    expect(Array.from(PS.stripMetadata(dirty))).toEqual(Array.from(clean));
    // Nothing to cut: the same array comes back.
    expect(PS.stripMetadata(clean)).toBe(clean);
    const notJpeg = new Uint8Array([1, 2, 3, 4]);
    expect(PS.stripMetadata(notJpeg)).toBe(notJpeg);
  });
});

/* ── Blurry ─────────────────────────────────────────────────────────────── */

describe('the blurry check', () => {
  const picture = (w, h, at) => rgba({ width: w, height: h, at });
  const stripes = (x, y) => (Math.floor(x / 2) % 2 ? [20, 20, 20] : [240, 240, 240]);
  const smooth = (x, y) => [x / 2 + 60, x / 2 + 60, x / 2 + 60];

  it('scores crisp edges high and a soft gradient low', () => {
    const sharp = PS.sharpness(picture(240, 180, stripes), 240, 180);
    const soft = PS.sharpness(picture(240, 180, smooth), 240, 180);
    expect(sharp).toBeGreaterThan(PS.BLURRY_BELOW);
    expect(soft).toBeLessThan(PS.BLURRY_BELOW);
    expect(PS.isBlurry(sharp)).toBe(false);
    expect(PS.isBlurry(soft)).toBe(true);
  });

  it('judges a mostly blank page by its writing', () => {
    // White paper with faint crisp marks in one corner only: averaged over
    // the whole page they would vanish; the sharpest tiles still show them.
    const faint = 250 - Math.round(Math.sqrt(PS.BLURRY_BELOW * 18));
    const marks = x => (Math.floor(x / 2) % 2 ? [faint, faint, faint] : [250, 250, 250]);
    const page = picture(240, 180, (x, y) => (x < 40 && y < 30 ? marks(x) : [250, 250, 250]));
    const score = PS.sharpness(page, 240, 180);
    expect(score).toBeGreaterThan(PS.BLURRY_BELOW);
    expect(PS.isBlurry(score)).toBe(false);
    // A blank page has nothing sharp on it.
    expect(
      PS.sharpness(
        picture(240, 180, () => [250, 250, 250]),
        240,
        180,
      ),
    ).toBe(0);
  });

  it('uses the named threshold', () => {
    expect(PS.isBlurry(PS.BLURRY_BELOW - 0.1)).toBe(true);
    expect(PS.isBlurry(PS.BLURRY_BELOW)).toBe(false);
    expect(PS.isBlurry(null)).toBe(false);
    expect(PS.sharpness(null, 0, 0)).toBe(0);
    expect(PS.sharpness(new Uint8ClampedArray(16), 2, 2)).toBe(0);
  });

  it('prepare() returns the number and the yes or no for a photo', async () => {
    const crisp = picture(60, 40, stripes);
    const soft = picture(60, 40, smooth);
    const sharpPage = (
      await PS.prepare(photo({ width: 60, height: 40, pixels: crisp }), { surface: fakeSurface({ rotates: false }) })
    ).pages[0];
    const softPage = (
      await PS.prepare(photo({ width: 60, height: 40, pixels: soft }), { surface: fakeSurface({ rotates: false }) })
    ).pages[0];
    expect(sharpPage.sharpness).toBeGreaterThan(PS.BLURRY_BELOW);
    expect(sharpPage.blurry).toBe(false);
    expect(softPage.sharpness).toBeLessThan(PS.BLURRY_BELOW);
    expect(softPage.blurry).toBe(true);
  });
});

/* ── HEIC ───────────────────────────────────────────────────────────────── */

describe('the HEIC seam', () => {
  const pixels = { width: 40, height: 30, data: rgba(grid(40, 30)) };

  it('a HEIC the browser cannot read goes to the supplied decoder and becomes a JPEG', async () => {
    const surface = fakeSurface();
    const seen = [];
    const decodeHeic = async blob => {
      seen.push(blob);
      return pixels;
    };
    const file = heicFile();
    const res = await PS.prepare(file, { surface, decodeHeic });
    expect(res).toMatchObject({ ok: true, kind: 'heic' });
    expect(res.pages).toHaveLength(1);
    const page = res.pages[0];
    expect(page.name).toBe('IMG_2041.jpg');
    expect(page.blob.type).toBe('image/jpeg');
    expect(PS.sniff(await blobBytes(page.blob))).toBe('jpeg');
    expect([page.width, page.height]).toEqual([40, 30]);
    expect(page.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(seen).toEqual([file]);
  });

  it('takes a HEIC by name alone, as a Chromebook hands it over', async () => {
    const res = await PS.prepare(heicFile('IMG_2041.heic', ''), {
      surface: fakeSurface(),
      decodeHeic: async () => pixels,
    });
    expect(res).toMatchObject({ ok: true, kind: 'heic' });
  });

  it('a decoder may hand back a JPEG or PNG blob instead of pixels', async () => {
    const decodeHeic = async () => new Blob([jpegBytes({ width: 800, height: 600 })], { type: 'image/jpeg' });
    const res = await PS.prepare(heicFile(), { surface: fakeSurface(), decodeHeic });
    expect(res.ok).toBe(true);
    expect([res.pages[0].width, res.pages[0].height]).toEqual([800, 600]);
  });

  it('a decoder may hand back something a canvas can draw', async () => {
    const bitmap = { ...grid(80, 60), close() {} };
    const res = await PS.prepare(heicFile(), { surface: fakeSurface(), decodeHeic: async () => bitmap });
    expect([res.pages[0].width, res.pages[0].height]).toEqual([80, 60]);
  });

  it('is not used where the browser reads HEIC itself (Safari)', async () => {
    let called = 0;
    const decodeHeic = async () => {
      called++;
      return pixels;
    };
    const res = await PS.prepare(heicFile(), { surface: fakeSurface({ reads: ['heic'] }), decodeHeic });
    expect(res).toMatchObject({ ok: true, kind: 'heic' });
    expect(called).toBe(0);
  });

  it('answers no_decoder when none is supplied', async () => {
    const res = await PS.prepare(heicFile(), { surface: fakeSurface() });
    expect(res).toMatchObject({ ok: false, reason: 'no_decoder', kind: 'heic' });
  });

  it('answers unreadable when the decoder fails', async () => {
    const decodeHeic = async () => {
      throw new Error('bad HEIC');
    };
    const res = await PS.prepare(heicFile(), { surface: fakeSurface(), decodeHeic });
    expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'heic', error: 'bad HEIC' });
  });
});

/* ── PDF ────────────────────────────────────────────────────────────────── */

describe('the PDF seam', () => {
  function fakePdf(pageCount, log = {}) {
    return async (blob, opts) => {
      log.opened = { blob, opts };
      log.rendered = [];
      return {
        pages: pageCount,
        async page(n) {
          log.rendered.push(n);
          // Each page its own picture, drawn at the size asked for.
          const w = 1545 + n;
          return { width: w, height: 2000, data: null, source: grid(w, 2000) };
        },
        close() {
          log.closed = true;
        },
      };
    };
  }

  it('a two-page PDF becomes two JPEG pages, and the PDF is not kept', async () => {
    const log = {};
    const file = pdfFile('Essay.pdf');
    const progress = [];
    const res = await PS.prepare(file, {
      surface: fakeSurface(),
      openPdf: fakePdf(2, log),
      onProgress: p => progress.push(p),
    });
    expect(res).toMatchObject({ ok: true, kind: 'pdf' });
    expect(res.pages).toHaveLength(2);
    expect(res.pages.map(p => p.name)).toEqual(['Essay-page-1.jpg', 'Essay-page-2.jpg']);
    expect(res.pages.map(p => [p.page, p.pages])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    for (const page of res.pages) {
      expect(page.blob.type).toBe('image/jpeg');
      expect(PS.sniff(await blobBytes(page.blob))).toBe('jpeg');
      expect(page.height).toBe(2000);
      expect(page.bytes).toBeLessThan(PS.MAX_BYTES);
      expect(page.thumb.size).toBeGreaterThan(0);
      expect(page.hash).toMatch(/^[0-9a-f]{64}$/);
      // The blurry check is for camera photos.
      expect(page.sharpness).toBe(null);
      expect(page.blurry).toBe(false);
    }
    expect(res.pages[0].hash).not.toBe(res.pages[1].hash);
    // The decoder was given the file and the size to draw at, one page at a time, then closed.
    expect(log.opened.blob).toBe(file);
    expect(log.opened.opts).toEqual({ longSide: PS.LONG_SIDE });
    expect(log.rendered).toEqual([1, 2]);
    expect(log.closed).toBe(true);
    expect(progress).toEqual([
      { page: 1, pages: 2 },
      { page: 2, pages: 2 },
    ]);
    // Nothing of the PDF itself is in the answer.
    expect(JSON.stringify(Object.keys(res))).toBe('["ok","kind","pages"]');
  });

  it('a one-page PDF is named like a photo', async () => {
    const res = await PS.prepare(pdfFile('Lab.pdf'), { surface: fakeSurface(), openPdf: fakePdf(1) });
    expect(res.pages.map(p => p.name)).toEqual(['Lab.jpg']);
  });

  it('shrinks a page the decoder drew too large', async () => {
    const openPdf = async () => ({ pages: 1, page: async () => grid(3000, 4000) });
    const res = await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf });
    expect([res.pages[0].width, res.pages[0].height]).toEqual([1500, 2000]);
  });

  it('answers no_decoder when none is supplied', async () => {
    const res = await PS.prepare(pdfFile(), { surface: fakeSurface() });
    expect(res).toMatchObject({ ok: false, reason: 'no_decoder', kind: 'pdf' });
  });

  it('answers unreadable for a PDF that will not open, and for a page that will not draw', async () => {
    const locked = async () => {
      throw new Error('password needed');
    };
    expect(await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf: locked })).toMatchObject({
      ok: false,
      reason: 'unreadable',
      kind: 'pdf',
      error: 'password needed',
    });
    const log = {};
    const openPdf = async () => ({
      pages: 3,
      page: async n => {
        if (n === 2) throw new Error('page 2 is damaged');
        return grid(100, 100);
      },
      close: () => (log.closed = true),
    });
    const res = await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf });
    expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf', page: 2 });
    expect(log.closed).toBe(true);
    const none = async () => ({ pages: 0, page: async () => null });
    expect((await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf: none })).reason).toBe('unreadable');
  });

  it('refuses a PDF with more pages than the caller allows', async () => {
    const log = {};
    const res = await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf: fakePdf(12, log), maxPages: 10 });
    expect(res).toMatchObject({ ok: false, reason: 'too_many_pages', kind: 'pdf', pageCount: 12, limit: 10 });
    expect(log.rendered).toEqual([]);
    expect(log.closed).toBe(true);
  });

  it('takes a 20-page PDF and refuses a 21-page one when the caller sets no limit', async () => {
    expect(PS.MAX_PDF_PAGES).toBe(20);
    const twenty = await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf: fakePdf(20) });
    expect(twenty.ok).toBe(true);
    expect(twenty.pages).toHaveLength(20);
    const log = {};
    const over = await PS.prepare(pdfFile(), { surface: fakeSurface(), openPdf: fakePdf(21, log) });
    expect(over).toMatchObject({ ok: false, reason: 'too_many_pages', kind: 'pdf', pageCount: 21, limit: 20 });
    expect(log.rendered).toEqual([]);
    expect(log.closed).toBe(true);
  });
});

/* ── What the file must not do ──────────────────────────────────────────── */

describe('the module itself', () => {
  it('builds no HTML and makes no network call', () => {
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|getSupabase|\.rpc\(/);
  });

  it('adds one global', () => {
    expect(source.match(/window\.[A-Za-z]+ =(?!=)/g)).toEqual(['window.PhotoShrink =']);
  });

  it('brings no decoder with it: pdf.js and the HEIC decoder come later, through the seams', () => {
    expect(source).not.toMatch(/pdfjs|libheif|heic2any|wasm|importScripts|createElement\('script'\)/i);
  });
});
