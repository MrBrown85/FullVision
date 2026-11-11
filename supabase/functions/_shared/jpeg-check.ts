// What the server checks about a page a student sent, before it is handed
// in (Batch B's contract, "What the edge function must do", 1).
//
// A page reaches storage through an upload link. The Storage service checks
// only the upload's Content-Type and its size, never its bytes, so a file
// stored as image/jpeg can hold anything. Before send-finish hands a page in,
// the function reads the file back and this decides whether it is a JPEG:
//
//   - it starts FF D8 FF and is no more than the limit (2,000,000 bytes);
//   - its markers are read from the start to the end-of-image marker, each
//     segment's length inside the file, the picture data scanned through to
//     the marker after it. One frame of a kind a browser draws (baseline,
//     extended or progressive Huffman, 8 bits, 1 or 3 colour channels), its
//     tables before its picture data, and at least one scan;
//   - its width and height are within what the caller allows (send-routes.ts:
//     a page 1 to 4,096 pixels each way, stricter than the database's
//     20,000; a thumbnail no larger than the phone is told to make it).
//
// This reads the file's structure; it does not decode the pixels (no image
// library runs here). A file that passes is one a JPEG decoder will start
// on; a file whose compressed data is damaged inside a scan can still pass.
//
// Location data. The phone redraws every photo, which leaves no EXIF behind,
// but the server does not rely on it. Every segment that can carry who took
// a photo, where, or with what is cut: APP1 to APP15 (EXIF and its GPS
// block, XMP, IPTC, a second picture in an MPF segment, maker notes) and
// comments, and any bytes after the end-of-image marker. Kept, because a
// browser draws colours from them:
//   - APP0 only as a JFIF header of its fixed 16 bytes (version 1, units 0
//     to 2, no thumbnail of its own): every byte of it is a fixed field, so
//     it carries nothing else;
//   - APP14 only as Adobe's colour flag of its fixed 14 bytes: the same;
//   - APP2 as an ICC colour profile, whole. A profile can hold any bytes:
//     its description and copyright tags are text, and a writer could put
//     anything there. Cameras and phones do not write a place or a person
//     in it, and the phone's redraw writes none; the file is only ever
//     given back as image/jpeg, which a browser does not read as a page.
// A JFIF or Adobe segment of any other length or shape is cut. The
// picture data is not touched. `clean` is the file as it must be stored,
// and `stripped` says whether that differs from what was read.
//
// No Deno and no Node imports, so the tests run it under Node.

export type JpegLimits = {
  /** The most bytes the file may hold. */
  maxBytes: number;
  /** The most pixels each way. */
  maxSide: number;
};

export type JpegOk = {
  ok: true;
  width: number;
  height: number;
  /** The file as it must be stored: the same bytes when nothing was cut. */
  clean: Uint8Array;
  stripped: boolean;
};
export type JpegRefused = { ok: false; reason: string };

// The frames a browser decodes: SOF0 baseline, SOF1 extended, SOF2 progressive (Huffman coding).
const FRAMES = new Set([0xc0, 0xc1, 0xc2]);
// Every other start-of-frame: lossless, hierarchical, arithmetic coding. Refused.
const OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const ascii = (b: Uint8Array, from: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n && from + i < b.length; i++) s += String.fromCharCode(b[from + i]);
  return s;
};

/* Whether an application segment is one of the three kept. `body` is where
   its data starts (after the length); `len` counts the two length bytes.
   JFIF: "JFIF\0", version 1.x, units 0 to 2, two densities, and a thumbnail
   of 0 x 0, 16 bytes in all. Adobe: "Adobe", version, two flags and the
   colour transform, 14 bytes in all. */
function kept(bytes: Uint8Array, marker: number, body: number, len: number): boolean {
  if (marker === 0xe0) {
    return (
      len === 16 &&
      ascii(bytes, body, 5) === 'JFIF\0' &&
      bytes[body + 5] === 1 &&
      bytes[body + 7] <= 2 &&
      bytes[body + 12] === 0 &&
      bytes[body + 13] === 0
    );
  }
  if (marker === 0xe2) return len >= 14 && ascii(bytes, body, 12) === 'ICC_PROFILE\0';
  if (marker === 0xee) return len === 14 && ascii(bytes, body, 5) === 'Adobe';
  return false;
}

/* Reads a JPEG as described above. Never throws for what a file holds: any
   file that is not one is { ok: false, reason }. `reason` names the rule
   (for tests and for counting), never a value from the file. */
export function inspectJpeg(input: Uint8Array, limits: JpegLimits): JpegOk | JpegRefused {
  const no = (reason: string): JpegRefused => ({ ok: false, reason });
  const bytes = input;
  const n = bytes.length;
  if (n > limits.maxBytes) return no('too_large');
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return no('not_jpeg');

  const cuts: [number, number][] = [];
  let at = 2;
  let width = 0;
  let height = 0;
  let frame = false;
  let tables = false;
  let huffman = false;
  let scans = 0;
  let end = -1;

  while (end < 0) {
    if (at >= n) return no('no_end');
    if (bytes[at] !== 0xff) return no('bad_marker');
    // Fill bytes: any number of FF before a marker.
    while (at < n && bytes[at] === 0xff) at++;
    if (at >= n) return no('no_end');
    const marker = bytes[at];
    const start = at - 1;
    at++;
    if (marker === 0xd9) {
      if (!scans) return no('no_picture');
      end = at;
      break;
    }
    // A marker with no length where none may stand: SOI again, RSTn outside a scan, TEM, or FF00.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0x00) {
      return no('bad_marker');
    }
    if (at + 2 > n) return no('no_end');
    const len = (bytes[at] << 8) | bytes[at + 1];
    if (len < 2 || at + len > n) return no('bad_length');
    const body = at + 2;
    const next = at + len;

    if (FRAMES.has(marker)) {
      if (frame) return no('two_frames');
      if (len < 8) return no('bad_frame');
      const precision = bytes[body];
      height = (bytes[body + 1] << 8) | bytes[body + 2];
      width = (bytes[body + 3] << 8) | bytes[body + 4];
      const channels = bytes[body + 5];
      if (precision !== 8) return no('bad_frame');
      if (channels !== 1 && channels !== 3) return no('bad_frame');
      if (len !== 8 + 3 * channels) return no('bad_frame');
      if (width < 1 || height < 1) return no('bad_size');
      if (width > limits.maxSide || height > limits.maxSide) return no('too_big');
      frame = true;
    } else if (OTHER_FRAMES.has(marker)) {
      return no('frame_kind');
    } else if (marker === 0xdb) {
      tables = true;
    } else if (marker === 0xc4) {
      huffman = true;
    } else if (marker === 0xdd) {
      if (len !== 4) return no('bad_length');
    } else if (marker >= 0xe0 && marker <= 0xef) {
      if (!kept(bytes, marker, body, len)) cuts.push([start, next]);
    } else if (marker === 0xfe) {
      cuts.push([start, next]);
    } else if (marker === 0xda) {
      if (!frame || !tables || !huffman) return no('scan_first');
      const parts = bytes[body];
      if (parts < 1 || parts > 4 || len !== 6 + 2 * parts) return no('bad_scan');
      scans++;
      // The picture data: up to the next marker that is not a stuffed FF00 or a restart marker.
      let p = next;
      for (;;) {
        if (p + 1 >= n) return no('no_end');
        if (bytes[p] !== 0xff) {
          p++;
          continue;
        }
        const b = bytes[p + 1];
        if (b === 0x00 || (b >= 0xd0 && b <= 0xd7)) {
          p += 2;
          continue;
        }
        if (b === 0xff) {
          p++;
          continue;
        }
        break;
      }
      at = p;
      continue;
    } else {
      // DNL, DHP, EXP, DAC, JPGn and the reserved markers: nothing a browser's photo holds.
      return no('marker_kind');
    }
    at = next;
  }

  if (end < n) cuts.push([end, n]);
  if (!cuts.length) return { ok: true, width, height, clean: bytes, stripped: false };
  let size = n;
  for (const [a, b] of cuts) size -= b - a;
  const clean = new Uint8Array(size);
  let from = 0;
  let to = 0;
  for (const [a, b] of cuts) {
    clean.set(bytes.subarray(from, a), to);
    to += a - from;
    from = b;
  }
  clean.set(bytes.subarray(from, n), to);
  return { ok: true, width, height, clean, stripped: true };
}

/** The SHA-256 of some bytes, as 64 lower-case hex characters (Web Crypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
