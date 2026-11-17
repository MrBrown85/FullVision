// @ts-check
/* shared/scan-label-read.js — finding a FullVision sticker on a scanned page
 * (docs/plans/add-work-for-class-plan.md, B4).
 *
 * A sticker is a QR code holding FVS + a 12-character sticker code
 * (shared/data-scan-labels.js). It names one student's piece of a scanned
 * pile. Nothing here reads handwriting or calls any service: the picture is
 * looked at in the browser, by jsQR (vendor/jsqr/, Apache-2.0), fetched the
 * first time read() is called and never on page load.
 *
 *   ScanLabelRead.read(picture) → Promise of { code, upsideDown, turn } or null
 *     picture: a page from PhotoShrink.prepare ({ blob, width, height }), a
 *     Blob, raw pixels { width, height, data } (RGBA), or anything a canvas
 *     can draw. jsQR finds one code at a time, and none at all when two
 *     codes confuse it, so the page is looked at whole, then in nine
 *     overlapping parts, then in sixteen smaller parts drawn twice as big.
 *     A code that is not a sticker (a handout's own QR, say) is blanked out
 *     and that part looked at again, MAX_LOOKS times at most. A page with
 *     two different stickers names no one (null). Only a read of exactly FVS + 12
 *     characters of the sticker alphabet is a sticker; anything else is
 *     null, never a guess. `turn` is how far the code is turned (0, 90, 180
 *     or 270 degrees, clockwise) worked out from where jsQR says its corners
 *     are; a sticker is stuck on the right way up, so 180 is a page scanned
 *     upside down (`upsideDown`). Rejects only when jsQR could not be
 *     fetched (reason 'no_reader').
 *
 *   ScanLabelRead.resolve(reads, labels, students) → pure
 *     reads: one entry per piece, null or { code } (as read() answers).
 *     labels: the class's codes, live and retired (listScanLabels).
 *     students: the page's student list ({ id }).
 *     → { pieces: [{ sid, why, code, upsideDown }], bySticker, toType }
 *     A piece is named (sid set, why null) only when its code is a live code
 *     of a student on the list and no other piece of the pile carries the
 *     same code. Otherwise sid is null and why says what was found:
 *       'none'     no sticker read
 *       'twice'    the same code on two or more pieces (none of them named)
 *       'retired'  a code from a sheet that was replaced
 *       'other'    a code that is not this class's
 *       'gone'     a live code of a student no longer on the list
 *     bySticker counts the named pieces, toType the rest.
 *
 * Everything here is window.ScanLabelRead.*; no other globals. */
/** @type {any} */ (window).ScanLabelRead = (function () {
  'use strict';

  var LIBRARY_URL = '/vendor/jsqr/jsQR.js';
  var STICKER_RE = /^FVS([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12})$/;
  var MAX_LOOKS = 4; // pictures looked at per page: the first, and after each code that was not a sticker
  var TILES = 3; // the page is looked at whole, then in TILES × TILES overlapping parts
  var SMALL = 4; // then in SMALL × SMALL smaller parts, drawn twice as big
  var BLANK_GROW = 0.25; // a code that is not a sticker is blanked this much beyond its corners

  var WHY = { NONE: 'none', TWICE: 'twice', RETIRED: 'retired', OTHER: 'other', GONE: 'gone' };

  /* ── jsQR, fetched once ── */

  function _scriptLoad() {
    return new Promise(function (resolve, reject) {
      var w = /** @type {any} */ (window);
      if (typeof w.jsQR === 'function') return resolve(w.jsQR);
      var el = document.createElement('script');
      el.src = LIBRARY_URL;
      el.onload = function () {
        if (typeof w.jsQR === 'function') resolve(w.jsQR);
        else reject(new Error('jsQR did not load'));
      };
      el.onerror = function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        reject(new Error('Could not load ' + LIBRARY_URL));
      };
      document.head.appendChild(el);
    });
  }
  /** @type {() => Promise<any>} */
  var _load = _scriptLoad;
  /** @type {Promise<any> | null} */
  var _lib = null;

  /* The library, fetched once. A failed fetch is forgotten, so the next read tries again. */
  function library() {
    if (_lib) return _lib;
    _lib = Promise.resolve()
      .then(function () {
        return _load();
      })
      .then(function (mod) {
        var fn = typeof mod === 'function' ? mod : mod && typeof mod.default === 'function' ? mod.default : null;
        if (!fn) throw new Error('jsQR did not load');
        return fn;
      })
      .catch(function (err) {
        _lib = null;
        var e = /** @type {any} */ (new Error('The sticker reader could not load: ' + (err && err.message)));
        e.reason = 'no_reader';
        throw e;
      });
    return _lib;
  }

  /* A pause between two jsQR looks: a macrotask, so the page stays live (a
     teacher typing names while stickers are read in the background). It
     changes nothing about what is found. */
  function _pause() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  /* ── The picture as pixels ── */

  /** @param {number} w @param {number} h */
  function _canvas(w, h) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    var el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return el;
  }
  /** @param {any} source @param {number} w @param {number} h */
  function _drawn(source, w, h) {
    var c = _canvas(w, h);
    var ctx = /** @type {any} */ (c.getContext('2d', { willReadFrequently: true }));
    ctx.drawImage(source, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: img.data };
  }
  /** @param {any} picture @returns {Promise<{ width: number, height: number, data: Uint8ClampedArray }>} */
  async function _pixels(picture) {
    if (!picture) throw new Error('nothing to read');
    if (picture.data && picture.width > 0 && picture.height > 0) return picture;
    var blob = typeof Blob !== 'undefined' && picture instanceof Blob ? picture : picture.blob;
    if (typeof Blob !== 'undefined' && blob instanceof Blob) {
      var bitmap = await createImageBitmap(blob);
      try {
        return _drawn(bitmap, bitmap.width, bitmap.height);
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    }
    var w = picture.naturalWidth || picture.width;
    var h = picture.naturalHeight || picture.height;
    if (w > 0 && h > 0) return _drawn(picture, w, h);
    throw new Error('nothing to read');
  }

  /* ── Where a code is, and which way up ── */

  /* 0, 90, 180 or 270: how far the code is turned clockwise, from its top
     edge (top-left corner to top-right corner) as the picture shows it. */
  /** @param {any} loc */
  function turnOf(loc) {
    if (!loc || !loc.topLeftCorner || !loc.topRightCorner) return 0;
    var dx = loc.topRightCorner.x - loc.topLeftCorner.x;
    var dy = loc.topRightCorner.y - loc.topLeftCorner.y;
    var deg = (Math.atan2(dy, dx) * 180) / Math.PI; // y grows downward: 90 is turned clockwise
    return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  }

  /* Paint a found code white, a little beyond its corners, so the next look finds another. */
  /** @param {{ width: number, height: number, data: Uint8ClampedArray }} px @param {any} loc */
  function _blank(px, loc) {
    var pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
    var cx = 0;
    var cy = 0;
    pts.forEach(function (p) {
      cx += p.x / 4;
      cy += p.y / 4;
    });
    var grown = pts.map(function (p) {
      return { x: cx + (p.x - cx) * (1 + BLANK_GROW), y: cy + (p.y - cy) * (1 + BLANK_GROW) };
    });
    var xs = grown.map(function (p) {
      return p.x;
    });
    var ys = grown.map(function (p) {
      return p.y;
    });
    var x0 = Math.max(0, Math.floor(Math.min.apply(null, xs)));
    var x1 = Math.min(px.width - 1, Math.ceil(Math.max.apply(null, xs)));
    var y0 = Math.max(0, Math.floor(Math.min.apply(null, ys)));
    var y1 = Math.min(px.height - 1, Math.ceil(Math.max.apply(null, ys)));
    /** @param {number} x @param {number} y */
    function inside(x, y) {
      var sign = 0;
      for (var i = 0; i < 4; i++) {
        var a = grown[i];
        var b = grown[(i + 1) % 4];
        var cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (cross === 0) continue;
        var s = cross > 0 ? 1 : -1;
        if (sign && s !== sign) return false;
        sign = s;
      }
      return true;
    }
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        var i = (y * px.width + x) * 4;
        px.data[i] = px.data[i + 1] = px.data[i + 2] = 255;
      }
    }
  }

  /* A sticker's code from a QR read, or '' when it is not one. */
  /** @param {unknown} text */
  function stickerCode(text) {
    var m = typeof text === 'string' ? STICKER_RE.exec(text) : null;
    return m ? m[1] : '';
  }

  /* The parts of the picture looked at, in order: the whole page; then
     TILES × TILES overlapping parts each half its width and height; then
     SMALL × SMALL overlapping parts each a third of its width and height,
     drawn twice as big. jsQR finds one code per look and can find none when
     a page holds two (a handout's QR and a sticker), so a part with only one
     in it is looked at too. A sticker's squares are only three or four
     pixels wide on a page of about 2000 pixels, and jsQR misses some at
     that size; drawn twice as big it finds more of them (the read trial,
     scripts/sticker-read-trial.mjs). */
  /** @param {number} w @param {number} h */
  function _regions(w, h) {
    var out = [{ x: 0, y: 0, w: w, h: h, s: 1 }];
    /** @param {number} n @param {number} part @param {number} scale */
    function grid(n, part, scale) {
      var tw = Math.ceil(w / part);
      var th = Math.ceil(h / part);
      for (var j = 0; j < n; j++) {
        for (var i = 0; i < n; i++) {
          out.push({
            x: Math.round((i * (w - tw)) / (n - 1)),
            y: Math.round((j * (h - th)) / (n - 1)),
            w: tw,
            h: th,
            s: scale,
          });
        }
      }
    }
    grid(TILES, 2, 1);
    grid(SMALL, 3, 2);
    return out;
  }
  /* A part of the picture drawn r.s times as big, smoothly (in grey, which is all jsQR reads). */
  /** @param {{ width: number, height: number, data: Uint8ClampedArray }} px @param {{ x: number, y: number, w: number, h: number, s: number }} r */
  function _enlarged(px, r) {
    var W = r.w * r.s;
    var H = r.h * r.s;
    var src = px.data;
    var pw = px.width;
    var grey = new Float32Array(r.w * r.h);
    for (var y = 0; y < r.h; y++) {
      for (var x = 0; x < r.w; x++) {
        var i = ((r.y + y) * pw + r.x + x) * 4;
        grey[y * r.w + x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      }
    }
    var out = new Uint8ClampedArray(W * H * 4);
    for (var Y = 0; Y < H; Y++) {
      var sy = Math.min(r.h - 1, Math.max(0, (Y + 0.5) / r.s - 0.5));
      var y0 = Math.floor(sy);
      var y1 = Math.min(r.h - 1, y0 + 1);
      var fy = sy - y0;
      for (var X = 0; X < W; X++) {
        var sx = Math.min(r.w - 1, Math.max(0, (X + 0.5) / r.s - 0.5));
        var x0 = Math.floor(sx);
        var x1 = Math.min(r.w - 1, x0 + 1);
        var fx = sx - x0;
        var top = grey[y0 * r.w + x0] * (1 - fx) + grey[y0 * r.w + x1] * fx;
        var bottom = grey[y1 * r.w + x0] * (1 - fx) + grey[y1 * r.w + x1] * fx;
        var o = (Y * W + X) * 4;
        out[o] = out[o + 1] = out[o + 2] = top * (1 - fy) + bottom * fy;
        out[o + 3] = 255;
      }
    }
    return { width: W, height: H, data: out };
  }
  /** @param {{ width: number, height: number, data: Uint8ClampedArray }} px @param {{ x: number, y: number, w: number, h: number, s: number }} r */
  function _crop(px, r) {
    if (r.s !== 1) return _enlarged(px, r);
    if (r.x === 0 && r.y === 0 && r.w === px.width && r.h === px.height) return px;
    var data = new Uint8ClampedArray(r.w * r.h * 4);
    for (var y = 0; y < r.h; y++) {
      var from = ((r.y + y) * px.width + r.x) * 4;
      data.set(px.data.subarray(from, from + r.w * 4), y * r.w * 4);
    }
    return { width: r.w, height: r.h, data: data };
  }
  /* A found code no wider than a third of the part it was found in: a real
     code on a page, not one made of two codes' corner squares. */
  /** @param {any} loc @param {{ width: number, height: number }} part */
  function _plausible(loc, part) {
    var most = Math.min(part.width, part.height) / 3;
    var a = loc.topLeftCorner;
    var b = loc.topRightCorner;
    var c = loc.bottomLeftCorner;
    var top = Math.hypot(b.x - a.x, b.y - a.y);
    var left = Math.hypot(c.x - a.x, c.y - a.y);
    return top <= most && left <= most && top >= left / 2 && left >= top / 2;
  }
  /* A code's corners in a part, as places on the whole picture. */
  /** @param {any} loc @param {{ x: number, y: number, s: number }} r */
  function _moved(loc, r) {
    /** @type {any} */
    var out = {};
    ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'].forEach(function (k) {
      out[k] = { x: loc[k].x / r.s + r.x, y: loc[k].y / r.s + r.y };
    });
    return out;
  }

  /** @param {any} picture */
  async function read(picture) {
    var jsQR = await library();
    /** @type {{ width: number, height: number, data: Uint8ClampedArray }} */
    var px;
    try {
      px = await _pixels(picture);
    } catch (e) {
      return null;
    }
    var copied = false;
    function own() {
      // Never paint over the caller's own pixels.
      if (!copied) {
        px = { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data) };
        copied = true;
      }
    }
    /** @type {any} */
    var found = null;
    var regions = _regions(px.width, px.height);
    for (var g = 0; g < regions.length && !found; g++) {
      var r = regions[g];
      for (var look = 0; look < MAX_LOOKS; look++) {
        var part = _crop(px, r);
        await _pause();
        var got = jsQR(part.data, part.width, part.height, { inversionAttempts: 'dontInvert' });
        if (!got || !got.location) break;
        var loc = _moved(got.location, r);
        var code = stickerCode(got.data);
        if (code) {
          found = { code: code, location: loc };
          break;
        }
        // jsQR can make one "code" out of the corner squares of two (a handout's and a
        // sticker's), and answers it with no text. Blanking that would paint over the
        // sticker: the next part is looked at instead.
        if (!got.data || !_plausible(got.location, part)) break;
        own();
        _blank(px, loc);
      }
    }
    if (!found) return null;
    // A second, different sticker on the same page names no one.
    own();
    _blank(px, found.location);
    await _pause();
    var other = jsQR(px.data, px.width, px.height, { inversionAttempts: 'dontInvert' });
    var otherCode = other ? stickerCode(other.data) : '';
    if (otherCode && otherCode !== found.code) return null;
    var turn = turnOf(found.location);
    return { code: found.code, upsideDown: turn === 180, turn: turn };
  }

  /* ── Which student each piece names ── */

  /** @param {any[]} reads @param {any[]} labels @param {any[]} students */
  function resolve(reads, labels, students) {
    /** @type {Record<string, boolean>} */
    var listed = {};
    (students || []).forEach(function (st) {
      var id = st && typeof st === 'object' ? st.id : st;
      if (typeof id === 'string' && id) listed[id] = true;
    });
    /* code → { sid, retired } from the class's labels; a code listed for two
       students, or both live and retired, is not trusted. */
    /** @type {Record<string, { sid: string, retired: boolean, bad?: boolean }>} */
    var byCode = {};
    (labels || []).forEach(function (l) {
      if (!l || typeof l.code !== 'string' || typeof l.enrollment_id !== 'string') return;
      var had = byCode[l.code];
      var mine = { sid: l.enrollment_id, retired: l.retired === true };
      if (!had) byCode[l.code] = mine;
      else if (had.sid !== mine.sid || had.retired !== mine.retired) had.bad = true;
    });
    var codes = (reads || []).map(function (r) {
      var c = r && typeof r === 'object' ? r.code : r;
      return typeof c === 'string' && stickerCode('FVS' + c) ? c : '';
    });
    /** @type {Record<string, number>} */
    var seen = {};
    codes.forEach(function (c) {
      if (c) seen[c] = (seen[c] || 0) + 1;
    });
    var bySticker = 0;
    var pieces = codes.map(function (code, i) {
      var r = reads[i];
      var out = {
        sid: /** @type {string | null} */ (null),
        why: /** @type {string | null} */ (WHY.NONE),
        code: code || null,
        upsideDown: !!(code && r && r.upsideDown === true),
      };
      if (!code) return out;
      var label = byCode[code];
      if (seen[code] > 1) out.why = WHY.TWICE;
      else if (!label || label.bad) out.why = WHY.OTHER;
      else if (label.retired) out.why = WHY.RETIRED;
      else if (!listed[label.sid]) out.why = WHY.GONE;
      else {
        out.sid = label.sid;
        out.why = null;
        bySticker++;
      }
      return out;
    });
    return { pieces: pieces, bySticker: bySticker, toType: pieces.length - bySticker };
  }

  /* Swap how jsQR is fetched (tests, the read trial). */
  /** @param {{ load?: () => Promise<any> }} opts */
  function configure(opts) {
    if (opts && 'load' in opts) {
      _load = opts.load || _scriptLoad;
      _lib = null;
    }
  }

  return {
    read: read,
    resolve: resolve,
    stickerCode: stickerCode,
    turnOf: turnOf,
    library: library,
    loaded: function () {
      return !!_lib;
    },
    configure: configure,
    WHY: WHY,
    MAX_LOOKS: MAX_LOOKS,
    // The most times jsQR looks at one page.
    MAX_JSQR_CALLS: MAX_LOOKS * (1 + TILES * TILES + SMALL * SMALL) + 1,
  };
})();
