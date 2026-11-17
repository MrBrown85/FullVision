/**
 * ScanLabelRead (shared/scan-label-read.js): a FullVision sticker found on a
 * page picture, and which student each piece of a pile names (B4). The worst
 * fault is a page under the wrong student, so every refusal is pinned: no
 * sticker, a retired code, another class's code, a student no longer in the
 * class, and the same code on two pieces (neither named).
 */
import './setup.js';
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve as resolvePath } from 'path';
import { runInThisContext } from 'vm';

const root = resolvePath(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
runInThisContext(readFileSync(resolvePath(root, 'shared/scan-label-read.js'), 'utf-8'), {
  filename: 'shared/scan-label-read.js',
});
const R = window.ScanLabelRead;

/* A white page with QR codes drawn on it, as RGBA pixels. Each code is
   { text, x, y, scale } in pixels; `level` and `version` as printed. */
function page(width, height, codes) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const c of codes) {
    const qr = qrcode(c.version || 0, c.level || 'Q');
    qr.addData(c.text, c.mode || 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    for (let r = 0; r < n; r++) {
      for (let col = 0; col < n; col++) {
        if (!qr.isDark(r, col)) continue;
        for (let dy = 0; dy < c.scale; dy++) {
          for (let dx = 0; dx < c.scale; dx++) {
            const x = c.x + col * c.scale + dx;
            const y = c.y + r * c.scale + dy;
            const i = (y * width + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
        }
      }
    }
  }
  return { width, height, data };
}
// The page turned half round, as a pile fed in upside down.
function upsideDown(px) {
  const out = new Uint8ClampedArray(px.data.length);
  const n = px.width * px.height;
  for (let i = 0; i < n; i++) out.set(px.data.subarray(i * 4, i * 4 + 4), (n - 1 - i) * 4);
  return { width: px.width, height: px.height, data: out };
}
const sticker = (code, x = 40, y = 40, scale = 6) => ({
  text: 'FVS' + code,
  mode: 'Alphanumeric',
  version: 1,
  level: 'Q',
  x,
  y,
  scale,
});

beforeAll(() => {
  R.configure({ load: () => Promise.resolve(require('../vendor/jsqr/jsQR.js')) });
});

// Every test here runs jsQR over whole pictures, which is slow on a busy two-core runner:
// each gets 30 s, far over what it takes (see the PR for the timing).
describe('ScanLabelRead.read', { timeout: 30000 }, () => {
  it('reads a sticker the right way up', async () => {
    const got = await R.read(page(400, 300, [sticker('K7M4QX2PABCD')])); // 12 characters of the alphabet
    expect(got).toEqual({ code: 'K7M4QX2PABCD', upsideDown: false, turn: 0 });
  });

  it('says a sticker on a page scanned upside down is upside down', async () => {
    const got = await R.read(upsideDown(page(400, 300, [sticker('23456789ABCD', 250, 150)])));
    expect(got).toEqual({ code: '23456789ABCD', upsideDown: true, turn: 180 });
  });

  it('answers null for a page with no code', async () => {
    expect(await R.read(page(200, 200, []))).toBeNull();
  });

  it('blanks out a handout’s own QR code and finds the sticker beside it', async () => {
    // A small letter-shaped page: the handout's QR at the top left, the sticker at the top right.
    const px = page(400, 520, [
      { text: 'https://example.com/handout', x: 20, y: 20, scale: 3 },
      sticker('ZZZZYYYYXXXX', 310, 25, 3),
    ]);
    const before = px.data.slice();
    expect(await R.read(px)).toEqual({ code: 'ZZZZYYYYXXXX', upsideDown: false, turn: 0 });
    // The caller's pixels are never painted over.
    expect(px.data).toEqual(before);
  });

  it('gives up after a few codes that are not stickers', async () => {
    const real = require('../vendor/jsqr/jsQR.js');
    let looks = 0;
    R.configure({
      load: () =>
        Promise.resolve((...args) => {
          looks++;
          return real(...args);
        }),
    });
    const codes = [];
    for (let i = 0; i < R.MAX_LOOKS + 2; i++)
      codes.push({ text: 'NOT A STICKER ' + i, x: 15 + i * 90, y: 15, scale: 3 });
    expect(await R.read(page(15 + (R.MAX_LOOKS + 2) * 90, 95, codes))).toBeNull();
    expect(looks).toBeGreaterThan(1);
    expect(looks).toBeLessThanOrEqual(R.MAX_JSQR_CALLS);
    R.configure({ load: () => Promise.resolve(real) });
  });

  it('answers null for a page with two different stickers', async () => {
    const one = sticker('ZZZZYYYYXXXX', 25, 25, 3);
    const two = sticker('AAAABBBBCCCC', 310, 430, 3);
    expect(await R.read(page(400, 520, [one]))).toMatchObject({ code: 'ZZZZYYYYXXXX' });
    expect(await R.read(page(400, 520, [two]))).toMatchObject({ code: 'AAAABBBBCCCC' });
    expect(await R.read(page(400, 520, [one, two]))).toBeNull();
    // The same sticker twice on one page still names its student.
    expect(await R.read(page(400, 520, [one, sticker('ZZZZYYYYXXXX', 310, 430, 3)]))).toMatchObject({
      code: 'ZZZZYYYYXXXX',
    });
  });

  it('never takes a read that is not exactly FVS and 12 characters of the alphabet', async () => {
    for (const text of [
      'FVSABCDEFGHJKL', // 11
      'FVSABCDEFGHJKLMN', // 13
      'FVSABCDEFGHIJKLM', // I is not in the alphabet
      'FVSABCDEFGH0JKLM', // nor is 0
      'XVSABCDEFGHJKLM',
      'K7M4-QX2P', // a student card's code
    ]) {
      const got = await R.read(page(400, 300, [{ text, x: 40, y: 40, scale: 6 }]));
      expect(got, text).toBeNull();
    }
  });

  it('answers null for something that is not a picture', async () => {
    expect(await R.read(null)).toBeNull();
    expect(await R.read({})).toBeNull();
  });

  it('fetches jsQR only when first asked', async () => {
    let fetched = 0;
    R.configure({
      load: () => {
        fetched++;
        return Promise.resolve(require('../vendor/jsqr/jsQR.js'));
      },
    });
    expect(R.loaded()).toBe(false);
    expect(fetched).toBe(0);
    await R.read(page(100, 100, []));
    await R.read(page(100, 100, []));
    expect(fetched).toBe(1);
  });

  it('rejects with no_reader when jsQR cannot be fetched, and tries again next time', async () => {
    R.configure({ load: () => Promise.reject(new Error('offline')) });
    await expect(R.read(page(100, 100, []))).rejects.toMatchObject({ reason: 'no_reader' });
    R.configure({ load: () => Promise.resolve(require('../vendor/jsqr/jsQR.js')) });
    expect(await R.read(page(100, 100, []))).toBeNull();
  });
});

describe('ScanLabelRead.turnOf', () => {
  const at = (tl, tr) => ({ topLeftCorner: { x: tl[0], y: tl[1] }, topRightCorner: { x: tr[0], y: tr[1] } });
  it('works out the turn from the top edge', () => {
    expect(R.turnOf(at([0, 0], [10, 1]))).toBe(0);
    expect(R.turnOf(at([10, 0], [10, 10]))).toBe(90);
    expect(R.turnOf(at([10, 10], [0, 9]))).toBe(180);
    expect(R.turnOf(at([0, 10], [0, 0]))).toBe(270);
    expect(R.turnOf(null)).toBe(0);
  });
});

describe('ScanLabelRead.resolve', () => {
  const students = [{ id: 'e-jas' }, { id: 'e-noor' }, { id: 'e-sam' }];
  const labels = [
    { enrollment_id: 'e-jas', code: 'JASJASJASJAS', retired: false },
    { enrollment_id: 'e-jas', code: 'JASXLDJASXLD', retired: true },
    { enrollment_id: 'e-noor', code: 'NRNRNRNRNRNR', retired: false },
    { enrollment_id: 'e-sam', code: 'SAMSAMSAMSAM', retired: false },
    { enrollment_id: 'e-left', code: 'LEFTLEFTLEFT', retired: false },
  ];
  const read = code => ({ code, upsideDown: false });

  it('names each piece whose sticker is a live code of a student on the list', () => {
    const got = R.resolve([read('NRNRNRNRNRNR'), read('JASJASJASJAS')], labels, students);
    expect(got.pieces.map(p => p.sid)).toEqual(['e-noor', 'e-jas']);
    expect(got.pieces.every(p => p.why === null)).toBe(true);
    expect(got.bySticker).toBe(2);
    expect(got.toType).toBe(0);
  });

  it('gives every refusal its reason and names no one for it', () => {
    const got = R.resolve(
      [
        null, // no sticker
        read('JASXLDJASXLD'), // a sheet that was replaced
        read('THERECLASSXY'), // not this class's
        read('LEFTLEFTLEFT'), // a student no longer on the list
        read('SAMSAMSAMSAM'),
      ],
      labels,
      students,
    );
    expect(got.pieces.map(p => [p.sid, p.why])).toEqual([
      [null, 'none'],
      [null, 'retired'],
      [null, 'other'],
      [null, 'gone'],
      ['e-sam', null],
    ]);
    expect(got.bySticker).toBe(1);
    expect(got.toType).toBe(4);
  });

  it('names neither piece when the same code is on two pieces', () => {
    const got = R.resolve([read('JASJASJASJAS'), read('NRNRNRNRNRNR'), read('JASJASJASJAS')], labels, students);
    expect(got.pieces.map(p => [p.sid, p.why])).toEqual([
      [null, 'twice'],
      ['e-noor', null],
      [null, 'twice'],
    ]);
    expect(got.bySticker).toBe(1);
    expect(got.toType).toBe(2);
  });

  it('a retired code read twice is still never taken', () => {
    const got = R.resolve([read('JASXLDJASXLD'), read('JASXLDJASXLD')], labels, students);
    expect(got.pieces.map(p => p.sid)).toEqual([null, null]);
    expect(got.bySticker).toBe(0);
  });

  it('takes no code that is not 12 characters of the alphabet, whatever the labels say', () => {
    const odd = labels.concat([{ enrollment_id: 'e-sam', code: 'abc', retired: false }]);
    const got = R.resolve([read('abc'), { code: 'SAMSAMSAMSA1' }], odd, students);
    expect(got.pieces.map(p => [p.sid, p.why])).toEqual([
      [null, 'none'],
      [null, 'none'],
    ]);
  });

  it('does not trust a code the labels give to two students', () => {
    const odd = labels.concat([{ enrollment_id: 'e-sam', code: 'NRNRNRNRNRNR', retired: false }]);
    const got = R.resolve([read('NRNRNRNRNRNR')], odd, students);
    expect(got.pieces[0]).toMatchObject({ sid: null, why: 'other' });
  });

  it('keeps upside down with the piece it was read on', () => {
    const got = R.resolve([{ code: 'SAMSAMSAMSAM', upsideDown: true }, null], labels, students);
    expect(got.pieces.map(p => p.upsideDown)).toEqual([true, false]);
  });

  it('an empty pile names nothing', () => {
    expect(R.resolve([], labels, students)).toEqual({ pieces: [], bySticker: 0, toType: 0 });
  });
});
