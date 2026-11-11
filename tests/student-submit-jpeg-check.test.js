/**
 * The server's check of a page a student sent
 * (supabase/functions/_shared/jpeg-check.ts): is it a JPEG, within the size
 * and the pixels allowed, and what is cut out of it before it is stored.
 * Real files are the Demo Mode sample pages in assets/sample-work/; the
 * rest are built here, segment by segment.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectJpeg, sha256Hex } from '../supabase/functions/_shared/jpeg-check.ts';

const PAGE = new Uint8Array(fs.readFileSync('assets/sample-work/cell-lab-cece-1.jpg'));
const THUMB = new Uint8Array(fs.readFileSync('assets/sample-work/cell-lab-cece-1-thumb.jpg'));
const LIMITS = { maxBytes: 2_000_000, maxSide: 20_000 };

// ── Building a JPEG ─────────────────────────────────────────────────────────
const seg = (marker, body) => [0xff, marker, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body];
const text = s => [...s].map(c => c.charCodeAt(0));
const JFIF = seg(0xe0, [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const DQT = seg(0xdb, [0, ...Array(64).fill(1)]);
const DHT = seg(0xc4, [0, ...Array(16).fill(0)]);
const sof = (marker, w, h, channels = 3, precision = 8) =>
  seg(marker, [precision, h >> 8, h & 255, w >> 8, w & 255, channels, ...Array(channels).fill([1, 0x11, 0]).flat()]);
const SOS = seg(0xda, [1, 1, 0, 0, 63, 0]);
// Picture data with a stuffed FF00, a restart marker and fill bytes in it.
const DATA = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];
const EOI = [0xff, 0xd9];
const jpeg = (...parts) => Uint8Array.from([0xff, 0xd8, ...parts.flat()]);
const plain = (w = 640, h = 480) => jpeg(JFIF, DQT, sof(0xc0, w, h), DHT, SOS, DATA, EOI);

// An EXIF segment with a GPS block (tag 0x8825), as a phone writes one.
const GPS_EXIF = seg(0xe1, [
  ...text('Exif\0\0'),
  ...text('MM'),
  0,
  0x2a,
  0,
  0,
  0,
  8,
  0,
  1,
  0x88,
  0x25,
  0,
  4,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0x1a,
  0,
  0,
  0,
  0,
]);
const XMP = seg(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude="49,10.5N"/>'));
const IPTC = seg(0xed, text('Photoshop 3.0\0 8BIM city=Surrey'));
const MPF = seg(0xe2, text('MPF\0 second picture'));
const ICC = seg(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 0, 0, 0, 0]);
const ADOBE = seg(0xee, [...text('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
const COMMENT = seg(0xfe, text('Taken at 123 Main St'));

describe('a JPEG that passes', () => {
  it('the sample pages and thumbnails: their size, and nothing cut from a page', () => {
    const page = inspectJpeg(PAGE, LIMITS);
    expect(page).toMatchObject({ ok: true, width: 900, height: 1200, stripped: false });
    expect(page.clean).toBe(PAGE);
    const thumb = inspectJpeg(THUMB, { maxBytes: 2_000_000, maxSide: 400 });
    expect(thumb).toMatchObject({ ok: true, width: 150, height: 200, stripped: true });
    // The thumbnail's EXIF and Photoshop segments are cut; its JFIF header and colour profile kept.
    const kept = Buffer.from(thumb.clean);
    expect(kept.includes(Buffer.from('Exif'))).toBe(false);
    expect(kept.includes(Buffer.from('Photoshop'))).toBe(false);
    expect(kept.includes(Buffer.from('JFIF'))).toBe(true);
    expect(kept.includes(Buffer.from('ICC_PROFILE'))).toBe(true);
    // And the cut file is itself a JPEG with nothing more to cut.
    expect(inspectJpeg(thumb.clean, LIMITS)).toMatchObject({ ok: true, stripped: false, width: 150 });
  });

  it('a built baseline, extended and progressive JPEG, grey or colour', () => {
    for (const marker of [0xc0, 0xc1, 0xc2]) {
      for (const channels of [1, 3]) {
        const r = inspectJpeg(jpeg(JFIF, DQT, sof(marker, 30, 20, channels), DHT, SOS, DATA, EOI), LIMITS);
        expect(r, `${marker} ${channels}`).toMatchObject({ ok: true, width: 30, height: 20, stripped: false });
      }
    }
    // A progressive file: tables between its scans.
    const r = inspectJpeg(jpeg(DQT, sof(0xc2, 8, 8), DHT, SOS, DATA, DHT, SOS, DATA, EOI), LIMITS);
    expect(r.ok).toBe(true);
  });

  it('the limits are inclusive', () => {
    expect(inspectJpeg(plain(20000, 1), LIMITS).ok).toBe(true);
    expect(inspectJpeg(plain(400, 300), { maxBytes: 2e6, maxSide: 400 }).ok).toBe(true);
    const exact = plain();
    expect(inspectJpeg(exact, { maxBytes: exact.length, maxSide: 20000 }).ok).toBe(true);
  });
});

describe('what is cut out before a page is stored', () => {
  it.each([
    ['an EXIF block with GPS', GPS_EXIF],
    ['XMP with a place in it', XMP],
    ['IPTC', IPTC],
    ['a second picture (MPF)', MPF],
    ['a comment', COMMENT],
    ['an APP0 that is not JFIF', seg(0xe0, text('JFXX\0 thumbnail'))],
    ['an application segment of any other number', seg(0xe7, text('maker notes'))],
  ])('%s', (_, segment) => {
    const dirty = jpeg(JFIF, segment, DQT, sof(0xc0, 64, 48), DHT, SOS, DATA, EOI);
    const r = inspectJpeg(dirty, LIMITS);
    expect(r.ok).toBe(true);
    expect(r.stripped).toBe(true);
    expect([...r.clean]).toEqual([...plain(64, 48)]);
  });

  it('bytes after the end of the picture', () => {
    const r = inspectJpeg(Uint8Array.from([...plain(), ...text('PK\u0003\u0004 a zip file')]), LIMITS);
    expect(r).toMatchObject({ ok: true, stripped: true });
    expect([...r.clean]).toEqual([...plain()]);
  });

  it('kept: a JFIF header, a colour profile, Adobe’s colour flag', () => {
    const r = inspectJpeg(jpeg(JFIF, ICC, ADOBE, DQT, sof(0xc0, 9, 9), DHT, SOS, DATA, EOI), LIMITS);
    expect(r).toMatchObject({ ok: true, stripped: false });
  });

  describe('a kept segment is kept only at its fixed shape: anything more is cut (review L2)', () => {
    const html = text('<html><script>alert(1)</script></html>');
    const gps = text('GPS 49.1913N 122.8490W');
    const JFIF_BODY = [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
    it.each([
      ['a JFIF header with HTML after it', seg(0xe0, [...JFIF_BODY, ...html])],
      ['a JFIF header with a place after it', seg(0xe0, [...JFIF_BODY, ...gps])],
      ['a JFIF header carrying its own thumbnail', seg(0xe0, [...JFIF_BODY.slice(0, -2), 1, 1, 9, 9, 9])],
      ['a JFIF header cut short', seg(0xe0, JFIF_BODY.slice(0, 7))],
      ['a JFIF header that says it has a thumbnail but is 16 bytes', seg(0xe0, [...JFIF_BODY.slice(0, -2), 1, 1])],
      ['a JFIF header of version 2', seg(0xe0, [...text('JFIF\0'), 2, 0, 0, 0, 1, 0, 1, 0, 0])],
      ['a JFIF header of unknown units', seg(0xe0, [...text('JFIF\0'), 1, 2, 7, 0, 1, 0, 1, 0, 0])],
      ['an Adobe segment with more after it', seg(0xee, [...text('Adobe'), 0, 100, 0, 0, 0, 0, 1, ...gps])],
      ['an Adobe segment cut short', seg(0xee, text('Adobe'))],
    ])('%s', (_, segment) => {
      const r = inspectJpeg(jpeg(segment, DQT, sof(0xc0, 64, 48), DHT, SOS, DATA, EOI), LIMITS);
      expect(r).toMatchObject({ ok: true, stripped: true });
      expect([...r.clean]).toEqual([...jpeg(DQT, sof(0xc0, 64, 48), DHT, SOS, DATA, EOI)]);
    });

    it('a colour profile is kept whole, text in it included: ICC profiles carry text tags by design', () => {
      const icc = seg(0xe2, [...text('ICC_PROFILE\0'), 1, 1, ...text('desc sRGB')]);
      const r = inspectJpeg(jpeg(JFIF, icc, DQT, sof(0xc0, 64, 48), DHT, SOS, DATA, EOI), LIMITS);
      expect(r).toMatchObject({ ok: true, stripped: false });
    });

    it('the sample thumbnails’ JFIF header and colour profile are of the kept shape', () => {
      const kept = Buffer.from(inspectJpeg(THUMB, { maxBytes: 2_000_000, maxSide: 400 }).clean);
      expect(kept.includes(Buffer.from('JFIF'))).toBe(true);
      expect(kept.includes(Buffer.from('ICC_PROFILE'))).toBe(true);
    });
  });

  it('several at once, the picture data untouched', () => {
    const dirty = jpeg(GPS_EXIF, JFIF, XMP, DQT, COMMENT, sof(0xc0, 64, 48), IPTC, DHT, SOS, DATA, EOI, [1, 2, 3]);
    const r = inspectJpeg(dirty, LIMITS);
    expect([...r.clean]).toEqual([...jpeg(JFIF, DQT, sof(0xc0, 64, 48), DHT, SOS, DATA, EOI)]);
  });
});

describe('a file that is refused', () => {
  const cases = {
    'nothing at all': [new Uint8Array(0), 'not_jpeg'],
    'a PNG': [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), 'not_jpeg'],
    'FF D8 and no third FF': [Uint8Array.from([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]), 'not_jpeg'],
    'over the byte limit': [new Uint8Array(2_000_001).fill(0xff), 'too_large'],
    'cut short in the header': [plain().slice(0, 30), 'bad_length'],
    'cut short in the picture data': [plain().slice(0, -3), 'no_end'],
    'no end marker': [jpeg(JFIF, DQT, sof(0xc0, 8, 8), DHT, SOS, DATA), 'no_end'],
    'no picture data': [jpeg(JFIF, DQT, sof(0xc0, 8, 8), DHT, EOI), 'no_picture'],
    'picture data before the frame': [jpeg(DQT, DHT, SOS, DATA, sof(0xc0, 8, 8), EOI), 'scan_first'],
    'picture data with no quantisation table': [jpeg(sof(0xc0, 8, 8), DHT, SOS, DATA, EOI), 'scan_first'],
    'picture data with no Huffman table': [jpeg(DQT, sof(0xc0, 8, 8), SOS, DATA, EOI), 'scan_first'],
    'two frames': [jpeg(DQT, sof(0xc0, 8, 8), sof(0xc0, 8, 8), DHT, SOS, DATA, EOI), 'two_frames'],
    'a lossless frame': [jpeg(DQT, sof(0xc3, 8, 8), DHT, SOS, DATA, EOI), 'frame_kind'],
    'arithmetic coding': [jpeg(DQT, sof(0xc9, 8, 8), DHT, SOS, DATA, EOI), 'frame_kind'],
    '12-bit samples': [jpeg(DQT, sof(0xc0, 8, 8, 3, 12), DHT, SOS, DATA, EOI), 'bad_frame'],
    'four channels (CMYK)': [jpeg(DQT, sof(0xc0, 8, 8, 4), DHT, SOS, DATA, EOI), 'bad_frame'],
    'a height of 0 (set later by DNL)': [jpeg(DQT, sof(0xc0, 8, 0), DHT, SOS, DATA, EOI), 'bad_size'],
    'a width of 0': [jpeg(DQT, sof(0xc0, 0, 8), DHT, SOS, DATA, EOI), 'bad_size'],
    'wider than allowed': [plain(20001, 10), 'too_big'],
    'a frame whose length disagrees with its channels': [
      jpeg(DQT, seg(0xc0, [8, 0, 8, 0, 8, 3, 1, 0x11, 0]), DHT, SOS, DATA, EOI),
      'bad_frame',
    ],
    'a scan whose length disagrees with its parts': [
      jpeg(DQT, sof(0xc0, 8, 8), DHT, seg(0xda, [2, 1, 0, 0, 63, 0]), DATA, EOI),
      'bad_scan',
    ],
    'a segment longer than the file': [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0]), 'bad_length'],
    'a segment length under 2': [Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0, 0]), 'bad_length'],
    'a second start of image': [jpeg([0xff, 0xd8], DQT, sof(0xc0, 8, 8), DHT, SOS, DATA, EOI), 'bad_marker'],
    'a restart marker outside the picture data': [
      jpeg(DQT, [0xff, 0xd3], sof(0xc0, 8, 8), DHT, SOS, DATA, EOI),
      'bad_marker',
    ],
    'bytes between segments': [jpeg(DQT, [0x00], sof(0xc0, 8, 8), DHT, SOS, DATA, EOI), 'bad_marker'],
    'a DNL marker': [jpeg(DQT, seg(0xdc, [0, 8]), sof(0xc0, 8, 8), DHT, SOS, DATA, EOI), 'marker_kind'],
    'a restart interval of the wrong length': [
      jpeg(DQT, seg(0xdd, [0, 4, 0]), sof(0xc0, 8, 8), DHT, SOS, DATA, EOI),
      'bad_length',
    ],
  };
  it.each(Object.keys(cases))('%s', which => {
    const [bytes, reason] = cases[which];
    expect(inspectJpeg(bytes, LIMITS)).toEqual({ ok: false, reason });
  });

  it('a thumbnail larger than the phone makes one', () => {
    expect(inspectJpeg(PAGE, { maxBytes: 2e6, maxSide: 400 })).toEqual({ ok: false, reason: 'too_big' });
    expect(inspectJpeg(plain(401, 10), { maxBytes: 2e6, maxSide: 400 })).toEqual({ ok: false, reason: 'too_big' });
  });

  it('a real page with its picture data damaged at the end is refused; damage inside a scan is not seen', () => {
    const cut = PAGE.slice(0, PAGE.length - 2);
    expect(inspectJpeg(cut, LIMITS).ok).toBe(false);
    // The pixels are not decoded: changed bytes in the middle of the picture data still pass (see the PR).
    const changed = PAGE.slice();
    changed[Math.floor(PAGE.length / 2)] ^= 0x01;
    if (changed[Math.floor(PAGE.length / 2)] !== 0xff && changed[Math.floor(PAGE.length / 2) - 1] !== 0xff) {
      expect(inspectJpeg(changed, LIMITS).ok).toBe(true);
    }
  });

  it('never throws, whatever the bytes', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
    for (let i = 0; i < 2000; i++) {
      const n = rand() * 4;
      const b = Uint8Array.from({ length: n }, rand);
      if (i % 3 === 0 && n > 3) b.set([0xff, 0xd8, 0xff]);
      if (i % 5 === 0) b.set(plain().slice(0, Math.min(n, 40)));
      expect(() => inspectJpeg(b, LIMITS)).not.toThrow();
    }
  });
});

it('sha256Hex is SHA-256, as 64 lower-case hex characters', async () => {
  expect(await sha256Hex(PAGE)).toBe(createHash('sha256').update(PAGE).digest('hex'));
  expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
