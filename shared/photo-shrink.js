/* shared/photo-shrink.js — every photo is made smaller before it uploads
 *
 * One path for every upload: a student's phone camera, a file chosen on a
 * Chromebook, a teacher's Add Work on desktop and phone (DECISIONS, "Grades,
 * photos and sign-in on the student page" 8 and "Student page build answers"
 * 2). prepare(file) answers with JPEG pages ready to queue, or with a refusal
 * the screen turns into words. It builds no HTML and sends nothing.
 *
 * What it does:
 *   Type check   JPEG, PNG, HEIC/HEIF, WebP and PDF are taken. A Word or
 *                PowerPoint file is refused as 'office' (the screen says
 *                "Save it as a PDF first"); anything else as 'unsupported'.
 *                A PDF over 20 MB is refused. The file's first bytes decide
 *                when they are recognised; its type and name decide otherwise.
 *   Shrink       Redrawn to a JPEG about 2000 px on the long side. Quality
 *                steps down until the page is at or under 500 KB; if the
 *                lowest quality is still over the 2 MB bucket limit the page
 *                is redrawn smaller until it is under. Never enlarged.
 *   Orientation  A sideways phone photo comes out upright. Browsers that
 *                turn a photo themselves are left to; for one that doesn't,
 *                the EXIF orientation is read here and applied in the redraw.
 *   Privacy      The redraw drops GPS and camera details. The output's bytes
 *                are then checked, and any EXIF, XMP, IPTC or comment segment
 *                is cut out before the page is returned.
 *   Thumbnail    A small JPEG made from the same redraw.
 *   Hash         SHA-256 of the output's bytes, for the exact-duplicate check.
 *   Blurry       A sharpness number and a yes/no against BLURRY_BELOW.
 *   PDF, HEIC    Seams. The caller supplies openPdf and decodeHeic (later
 *                backed by pdf.js and a HEIC decoder in vendor/, loaded only
 *                when needed). Each PDF page becomes a JPEG page; the PDF is
 *                not kept. HEIC is tried in the browser first (Safari reads
 *                it) and goes to decodeHeic only when that fails.
 *
 * The browser calls (createImageBitmap, canvas, toBlob) sit behind a small
 * surface, browserSurface(), so everything else here runs under the unit
 * tests with a fake one.
 *
 * Seams (pass in prepare's opts, or once through configure):
 *   decodeHeic(blob) → Promise of the upright picture
 *   openPdf(blob, { longSide }) → Promise of
 *       { pages: n, page(i) → Promise of page i's picture (1-based), close() }
 *   A picture is a Blob the browser can read (JPEG, PNG), raw pixels
 *   { width, height, data } (RGBA), or something a canvas can draw
 *   { width, height, source } / an ImageBitmap / a canvas.
 *
 * Everything here is a window.PhotoShrink.* public surface; no other globals.
 */
window.PhotoShrink = (function () {
  'use strict';

  var LONG_SIDE = 2000; // px, the long side of a page
  var THUMB_LONG_SIDE = 400; // px, the long side of a thumbnail
  var AIM_BYTES = 500 * 1000; // quality steps down until a page is at or under this
  var MAX_BYTES = 2 * 1000 * 1000; // a page is always under the bucket's 2 MB limit
  var MAX_PDF_BYTES = 20 * 1024 * 1024; // a PDF over this is refused
  var MAX_PDF_PAGES = 20; // a PDF with more pages is refused (DECISIONS, Student page build rulings 18)
  var QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5];
  var THUMB_QUALITY = 0.7;
  var SIZE_STEP = 0.8; // each redraw-smaller step, when the lowest quality is still too big
  var MIN_LONG_SIDE = 640; // below this a page is unreadable; refuse instead
  var BLUR_LONG_SIDE = 512; // the grey copy the blurry check measures
  var BLUR_TILES = 6; // the copy is cut into BLUR_TILES × BLUR_TILES tiles
  var BLURRY_BELOW = 120; // sharpness under this is called blurry
  var EXIF_SCAN_BYTES = 256 * 1024; // EXIF sits at the start of a JPEG

  /* Why a file was refused. The screen picks its words from these. */
  var REASONS = {
    OFFICE: 'office', // Word or PowerPoint: "Save it as a PDF first"
    UNSUPPORTED: 'unsupported', // not a photo or a PDF
    EMPTY: 'empty', // no bytes
    PDF_TOO_LARGE: 'pdf_too_large', // over MAX_PDF_BYTES
    TOO_MANY_PAGES: 'too_many_pages', // over MAX_PDF_PAGES, or over opts.maxPages when a caller sets one
    NO_DECODER: 'no_decoder', // a PDF or HEIC with nothing to read it
    UNREADABLE: 'unreadable', // damaged, locked, or not what its name says
    TOO_LARGE: 'too_large', // could not get a page under MAX_BYTES
    FAILED: 'failed', // the browser failed (out of memory, no canvas)
  };

  var TYPE_KINDS = {
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/pjpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'image/heic-sequence': 'heic',
    'image/heif-sequence': 'heic',
    'application/pdf': 'pdf',
    'application/x-pdf': 'pdf',
  };
  var EXT_KINDS = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', heic: 'heic', heif: 'heic', pdf: 'pdf' };
  var OFFICE_EXT = {
    doc: 'word',
    docx: 'word',
    docm: 'word',
    dot: 'word',
    dotx: 'word',
    ppt: 'powerpoint',
    pptx: 'powerpoint',
    pptm: 'powerpoint',
    pps: 'powerpoint',
    ppsx: 'powerpoint',
    pot: 'powerpoint',
    potx: 'powerpoint',
  };
  var HEIC_BRANDS = { heic: 1, heix: 1, hevc: 1, hevx: 1, heim: 1, heis: 1, hevm: 1, hevs: 1, mif1: 1, msf1: 1 };

  var _defaults = { surface: null, decodeHeic: null, openPdf: null };

  /* Set the decoders (and, in tests, the surface) once for every prepare(). */
  function configure(opts) {
    opts = opts || {};
    ['surface', 'decodeHeic', 'openPdf'].forEach(function (k) {
      if (k in opts) _defaults[k] = opts[k] || null;
    });
  }

  function _refuse(reason, extra) {
    var out = { ok: false, reason: reason };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  function _fail(reason, message) {
    var err = new Error(message || reason);
    err.reason = reason;
    return err;
  }

  function _ext(name) {
    var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function _officeKind(file) {
    var type = String((file && file.type) || '').toLowerCase();
    if (/msword|wordprocessingml|ms-word/.test(type)) return 'word';
    if (/ms-powerpoint|presentationml/.test(type)) return 'powerpoint';
    return OFFICE_EXT[_ext(file && file.name)] || null;
  }

  /* What a file is, from its type and its name alone. Sync, so a file input
     can answer at once; prepare() also looks at the file's first bytes. */
  function classify(file) {
    if (!file) return _refuse(REASONS.UNSUPPORTED);
    var office = _officeKind(file);
    if (office) return _refuse(REASONS.OFFICE, { office: office });
    var type = String(file.type || '')
      .toLowerCase()
      .split(';')[0]
      .trim();
    var kind = TYPE_KINDS[type] || EXT_KINDS[_ext(file.name)] || null;
    if (!kind) return _refuse(REASONS.UNSUPPORTED);
    if (!file.size) return _refuse(REASONS.EMPTY, { kind: kind });
    if (kind === 'pdf' && file.size > MAX_PDF_BYTES) {
      return _refuse(REASONS.PDF_TOO_LARGE, { kind: kind, limit: MAX_PDF_BYTES });
    }
    return { ok: true, kind: kind };
  }

  function _ascii(bytes, from, to) {
    var s = '';
    for (var i = from; i < to && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  /* What a file's first bytes say it is: one of the kinds taken, 'zip' (a
     .docx or .pptx inside), 'ole' (an old .doc or .ppt), or null. */
  function sniff(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytes[0] === 0x89 && _ascii(bytes, 1, 4) === 'PNG') return 'png';
    if (_ascii(bytes, 0, 4) === 'RIFF' && _ascii(bytes, 8, 12) === 'WEBP') return 'webp';
    if (_ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
    if (_ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS[_ascii(bytes, 8, 12)]) return 'heic';
    if (_ascii(bytes, 0, 2) === 'PK' && bytes[2] === 3 && bytes[3] === 4) return 'zip';
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'ole';
    return null;
  }

  function _bytes(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(new Uint8Array(reader.result));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('The file could not be read'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  /* ── JPEG segments ────────────────────────────────────────────────────── */

  /* The header segments of a JPEG, up to the picture data: [{ marker, start,
     end }], start at the FF, end past the segment. null when not a JPEG. */
  function _segments(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    var out = [];
    var at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) break;
      var marker = bytes[at + 1];
      if (marker === 0xff) {
        at += 1; // padding
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break; // picture data, or the end
      var len = (bytes[at + 2] << 8) | bytes[at + 3];
      if (len < 2 || at + 2 + len > bytes.length) break;
      out.push({ marker: marker, start: at, end: at + 2 + len });
      at += 2 + len;
    }
    return out;
  }

  // Segments that can say who took a photo, where and with what:
  // APP1 (EXIF, XMP), APP13 (IPTC) and comments.
  function _isPersonal(marker) {
    return marker === 0xe1 || marker === 0xed || marker === 0xfe;
  }

  /* What a JPEG's header says about the photo: { exif, orientation (1–8),
     gps, metadata }. metadata is true for any segment stripMetadata removes. */
  function readExif(bytes) {
    var out = { exif: false, orientation: 1, gps: false, metadata: false };
    var segs = _segments(bytes);
    if (!segs) return out;
    segs.forEach(function (seg) {
      if (_isPersonal(seg.marker)) out.metadata = true;
      if (seg.marker !== 0xe1 || out.exif) return;
      var at = seg.start + 4;
      if (_ascii(bytes, at, at + 4) !== 'Exif') return;
      out.exif = true;
      var tiff = at + 6;
      var order = _ascii(bytes, tiff, tiff + 2);
      if (order !== 'II' && order !== 'MM') return;
      var little = order === 'II';
      function u16(p) {
        if (p + 2 > seg.end) return 0;
        return little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1];
      }
      function u32(p) {
        if (p + 4 > seg.end) return 0;
        return little
          ? (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0
          : ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
      }
      var ifd = tiff + u32(tiff + 4);
      var count = u16(ifd);
      for (var i = 0; i < count; i++) {
        var entry = ifd + 2 + i * 12;
        if (entry + 12 > seg.end) break;
        var tag = u16(entry);
        if (tag === 0x0112) {
          var o = u16(entry + 8);
          if (o >= 1 && o <= 8) out.orientation = o;
        } else if (tag === 0x8825) {
          out.gps = true;
        }
      }
    });
    return out;
  }

  /* A JPEG without its EXIF, XMP, IPTC and comment segments. Returns the
     same array when there was nothing to cut. */
  function stripMetadata(bytes) {
    var segs = _segments(bytes);
    if (!segs) return bytes;
    var cut = segs.filter(function (seg) {
      return _isPersonal(seg.marker);
    });
    if (!cut.length) return bytes;
    var removed = cut.reduce(function (n, seg) {
      return n + (seg.end - seg.start);
    }, 0);
    var out = new Uint8Array(bytes.length - removed);
    var from = 0;
    var to = 0;
    cut.forEach(function (seg) {
      out.set(bytes.subarray(from, seg.start), to);
      to += seg.start - from;
      from = seg.end;
    });
    out.set(bytes.subarray(from), to);
    return out;
  }

  /* An EXIF segment holding only an orientation, for the probe below. */
  function _orientationSegment(orientation) {
    return new Uint8Array(
      [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]
        .concat([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00])
        .concat([0x00, 0x00, 0x00, 0x00]),
    );
  }

  /* ── Orientation ──────────────────────────────────────────────────────── */

  /* The canvas transform [a, b, c, d, e, f] that turns a picture stored with
     an EXIF orientation upright, when it is drawn w × h at the origin. For
     5 to 8 the upright picture is h wide and w tall. */
  function turnMatrix(orientation, w, h) {
    switch (orientation) {
      case 2:
        return [-1, 0, 0, 1, w, 0]; // mirrored
      case 3:
        return [-1, 0, 0, -1, w, h]; // upside down
      case 4:
        return [1, 0, 0, -1, 0, h]; // flipped top to bottom
      case 5:
        return [0, 1, 1, 0, 0, 0]; // mirrored, then on its side
      case 6:
        return [0, 1, -1, 0, h, 0]; // a quarter turn clockwise
      case 7:
        return [0, -1, -1, 0, h, w]; // mirrored, then on its other side
      case 8:
        return [0, -1, 1, 0, 0, w]; // a quarter turn counter-clockwise
      default:
        return [1, 0, 0, 1, 0, 0];
    }
  }

  /* Does this surface turn a photo upright by itself when it decodes one?
     Current browsers do; an old one may not. Asked once per surface: a tiny
     JPEG marked "quarter turn" is decoded, and its shape tells. */
  function _rotatesItself(surface) {
    if (!surface._fvRotates) {
      surface._fvRotates = Promise.resolve()
        .then(function () {
          var canvas = surface.canvas(2, 1);
          return canvas.toJpeg(0.5).then(function (blob) {
            canvas.release();
            return _bytes(blob);
          });
        })
        .then(function (jpeg) {
          var seg = _orientationSegment(6);
          var marked = new Uint8Array(jpeg.length + seg.length);
          marked.set(jpeg.subarray(0, 2), 0);
          marked.set(seg, 2);
          marked.set(jpeg.subarray(2), 2 + seg.length);
          return surface.decode(new Blob([marked], { type: 'image/jpeg' }));
        })
        .then(function (img) {
          var turned = img.width === 1 && img.height === 2;
          if (img.close) img.close();
          return turned;
        })
        .catch(function () {
          return true;
        });
    }
    return surface._fvRotates;
  }

  /* ── The browser surface ──────────────────────────────────────────────── */

  /* The only browser picture calls in this file. A surface has:
       decode(blob)       → Promise of { width, height, source, close() }
       canvas(w, h)       → { width, height, source, draw(source, matrix, w, h),
                              pixels(), toJpeg(quality), release() }
       fromPixels(pixels) → { width, height, source, close() } */
  function browserSurface() {
    function makeCanvas(w, h) {
      var el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      var ctx = el.getContext('2d');
      if (!ctx) throw _fail(REASONS.FAILED, 'The browser could not open a canvas');
      return { el: el, ctx: ctx };
    }
    function decodeWithImg(blob) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          resolve({
            width: img.naturalWidth,
            height: img.naturalHeight,
            source: img,
            close: function () {
              URL.revokeObjectURL(url);
            },
          });
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('The picture could not be read'));
        };
        img.src = url;
      });
    }
    return {
      decode: function (blob) {
        if (typeof createImageBitmap !== 'function') return decodeWithImg(blob);
        return createImageBitmap(blob).then(function (bitmap) {
          return {
            width: bitmap.width,
            height: bitmap.height,
            source: bitmap,
            close: function () {
              if (typeof bitmap.close === 'function') bitmap.close();
            },
          };
        });
      },
      canvas: function (w, h) {
        var c = makeCanvas(w, h);
        return {
          width: w,
          height: h,
          source: c.el,
          draw: function (source, m, dw, dh) {
            // White first: a see-through PNG would turn black as a JPEG.
            c.ctx.setTransform(1, 0, 0, 1, 0, 0);
            c.ctx.fillStyle = '#fff';
            c.ctx.fillRect(0, 0, w, h);
            c.ctx.imageSmoothingEnabled = true;
            c.ctx.imageSmoothingQuality = 'high';
            c.ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
            c.ctx.drawImage(source, 0, 0, dw, dh);
            c.ctx.setTransform(1, 0, 0, 1, 0, 0);
          },
          pixels: function () {
            return c.ctx.getImageData(0, 0, w, h).data;
          },
          toJpeg: function (quality) {
            return new Promise(function (resolve, reject) {
              c.el.toBlob(
                function (blob) {
                  if (blob) resolve(blob);
                  else reject(_fail(REASONS.FAILED, 'The browser could not save the page as a JPEG'));
                },
                'image/jpeg',
                quality,
              );
            });
          },
          release: function () {
            // Frees the canvas's memory now; a phone runs out fast.
            c.el.width = 0;
            c.el.height = 0;
          },
        };
      },
      fromPixels: function (px) {
        var c = makeCanvas(px.width, px.height);
        var data = px.data instanceof Uint8ClampedArray ? px.data : new Uint8ClampedArray(px.data);
        c.ctx.putImageData(new ImageData(data, px.width, px.height), 0, 0);
        return {
          width: px.width,
          height: px.height,
          source: c.el,
          close: function () {
            c.el.width = 0;
            c.el.height = 0;
          },
        };
      },
    };
  }

  var _browser = null;
  function _surface(o) {
    if (o.surface) return o.surface;
    if (!_browser) _browser = browserSurface();
    return _browser;
  }

  /* ── Shrink ───────────────────────────────────────────────────────────── */

  /* A file's name as a page's: "IMG_2041.HEIC" → "IMG_2041.jpg", and page 2
     of a three-page "Essay.pdf" → "Essay-page-2.jpg". */
  function outputName(name, page, pages) {
    var base =
      String(name || '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.[A-Za-z0-9]{1,5}$/, '')
        .trim() || 'page';
    return pages > 1 ? base + '-page-' + page + '.jpg' : base + '.jpg';
  }

  /* How sharp a picture is, from its RGBA pixels: a grey copy, a Laplacian
     (each pixel against its four neighbours), and that Laplacian's variance
     in each tile. The answer is the mean of the sharpest quarter of the
     tiles, so a page that is mostly blank paper is judged by its writing. */
  function sharpness(px, w, h) {
    if (!px || w < 3 || h < 3) return 0;
    var grey = new Float32Array(w * h);
    for (var i = 0, p = 0; i < grey.length; i++, p += 4) {
      grey[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    }
    var tiles = BLUR_TILES * BLUR_TILES;
    var sum = new Float64Array(tiles);
    var squares = new Float64Array(tiles);
    var counts = new Float64Array(tiles);
    for (var y = 1; y < h - 1; y++) {
      var row = Math.floor((y * BLUR_TILES) / h) * BLUR_TILES;
      for (var x = 1; x < w - 1; x++) {
        var at = y * w + x;
        var lap = grey[at - w] + grey[at + w] + grey[at - 1] + grey[at + 1] - 4 * grey[at];
        var tile = row + Math.floor((x * BLUR_TILES) / w);
        sum[tile] += lap;
        squares[tile] += lap * lap;
        counts[tile] += 1;
      }
    }
    var variances = [];
    for (var t = 0; t < tiles; t++) {
      if (!counts[t]) continue;
      var mean = sum[t] / counts[t];
      variances.push(squares[t] / counts[t] - mean * mean);
    }
    if (!variances.length) return 0;
    variances.sort(function (a, b) {
      return b - a;
    });
    var top = Math.max(1, Math.ceil(variances.length / 4));
    var total = 0;
    for (var k = 0; k < top; k++) total += variances[k];
    return Math.round((total / top) * 10) / 10;
  }

  function isBlurry(score) {
    return typeof score === 'number' && score < BLURRY_BELOW;
  }

  function sha256Hex(bytes) {
    var subtle = typeof crypto !== 'undefined' && crypto && crypto.subtle;
    if (!subtle) return Promise.reject(_fail(REASONS.FAILED, 'This page cannot hash a photo'));
    return subtle.digest('SHA-256', bytes).then(function (digest) {
      return Array.prototype.map
        .call(new Uint8Array(digest), function (b) {
          return (b < 16 ? '0' : '') + b.toString(16);
        })
        .join('');
    });
  }

  function _fit(w, h, longSide) {
    var scale = Math.min(1, longSide / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  /* A JPEG's bytes with nothing personal in them, as a Blob typed JPEG. */
  function _clean(blob) {
    return _bytes(blob).then(function (bytes) {
      if (sniff(bytes) !== 'jpeg') throw _fail(REASONS.FAILED, 'The browser did not make a JPEG');
      var clean = stripMetadata(bytes);
      if (clean === bytes && blob.type === 'image/jpeg') return { blob: blob, bytes: bytes };
      return { blob: new Blob([clean], { type: 'image/jpeg' }), bytes: clean };
    });
  }

  /* Redraw one decoded picture as a page: the JPEG, its thumbnail, its hash
     and its sharpness. turn is the EXIF orientation still to apply (1 when
     the picture is already upright). */
  async function _page(img, turn, surface, checkBlur) {
    var sideways = turn >= 5;
    var upW = sideways ? img.height : img.width;
    var upH = sideways ? img.width : img.height;
    if (!(upW > 0 && upH > 0)) throw _fail(REASONS.UNREADABLE, 'The picture has no size');
    var longSide = Math.min(LONG_SIDE, Math.max(upW, upH));
    var steps = QUALITY_STEPS;
    var canvas, size, blob, quality;
    for (;;) {
      size = _fit(upW, upH, longSide);
      canvas = surface.canvas(size.w, size.h);
      var dw = sideways ? size.h : size.w;
      var dh = sideways ? size.w : size.h;
      canvas.draw(img.source, turnMatrix(turn, dw, dh), dw, dh);
      for (var i = 0; i < steps.length; i++) {
        quality = steps[i];
        blob = await canvas.toJpeg(quality);
        if (blob.size <= AIM_BYTES) break;
      }
      if (blob.size < MAX_BYTES) break;
      canvas.release();
      if (longSide <= MIN_LONG_SIDE) throw _fail(REASONS.TOO_LARGE, 'The page could not be made small enough');
      longSide = Math.max(MIN_LONG_SIDE, Math.round(longSide * SIZE_STEP));
      steps = [QUALITY_STEPS[QUALITY_STEPS.length - 1]];
    }

    var identity = [1, 0, 0, 1, 0, 0];
    var small = _fit(size.w, size.h, THUMB_LONG_SIDE);
    var thumbCanvas = surface.canvas(small.w, small.h);
    thumbCanvas.draw(canvas.source, identity, small.w, small.h);
    var thumbBlob = await thumbCanvas.toJpeg(THUMB_QUALITY);
    thumbCanvas.release();

    var score = null;
    if (checkBlur) {
      var grey = _fit(size.w, size.h, BLUR_LONG_SIDE);
      var greyCanvas = surface.canvas(grey.w, grey.h);
      greyCanvas.draw(canvas.source, identity, grey.w, grey.h);
      score = sharpness(greyCanvas.pixels(), grey.w, grey.h);
      greyCanvas.release();
    }
    canvas.release();

    var photo = await _clean(blob);
    var thumb = await _clean(thumbBlob);
    return {
      blob: photo.blob,
      thumb: thumb.blob,
      hash: await sha256Hex(photo.bytes),
      width: size.w,
      height: size.h,
      bytes: photo.blob.size,
      quality: quality,
      sharpness: score,
      blurry: checkBlur ? isBlurry(score) : false,
    };
  }

  /* Decode a Blob, and say which EXIF orientation is still to apply. */
  async function _decode(blob, surface) {
    var turn = 1;
    var head = await _bytes(blob.slice(0, EXIF_SCAN_BYTES));
    if (sniff(head) === 'jpeg') {
      var orientation = readExif(head).orientation;
      if (orientation > 1 && !(await _rotatesItself(surface))) turn = orientation;
    }
    return { img: await surface.decode(blob), turn: turn };
  }

  /* A decoder's picture, in any of the shapes the seams allow, as something
     to draw. */
  async function _picture(raw, surface) {
    if (!raw) throw _fail(REASONS.UNREADABLE, 'The decoder gave nothing back');
    if (typeof Blob !== 'undefined' && raw instanceof Blob) return _decode(raw, surface);
    if (raw.data && raw.width && raw.height) return { img: surface.fromPixels(raw), turn: 1 };
    if (raw.source && raw.width && raw.height) return { img: raw, turn: 1 };
    if (raw.width && raw.height) {
      return {
        img: {
          width: raw.width,
          height: raw.height,
          source: raw,
          close: function () {
            if (typeof raw.close === 'function') raw.close();
          },
        },
        turn: 1,
      };
    }
    throw _fail(REASONS.UNREADABLE, 'The decoder gave back something that is not a picture');
  }

  async function _pageOf(picture, surface, checkBlur) {
    try {
      return await _page(picture.img, picture.turn, surface, checkBlur);
    } finally {
      if (picture.img && typeof picture.img.close === 'function') picture.img.close();
    }
  }

  // A decode that fails means the file is damaged or not what it says; any
  // other failure keeps the reason it was thrown with.
  function _unreadable(err) {
    if (err && err.reason) return err;
    return _fail(REASONS.UNREADABLE, err && err.message ? err.message : String(err));
  }

  async function _photoPages(file, kind, surface, o) {
    var picture;
    try {
      picture = await _decode(file, surface);
    } catch (err) {
      if (kind !== 'heic') throw _unreadable(err);
      // Chrome and Firefox cannot read HEIC; Safari can and never gets here.
      if (typeof o.decodeHeic !== 'function') throw _fail(REASONS.NO_DECODER, 'Nothing here can read a HEIC photo');
      try {
        picture = await _picture(await o.decodeHeic(file), surface);
      } catch (err2) {
        throw _unreadable(err2);
      }
    }
    return [await _pageOf(picture, surface, true)];
  }

  async function _pdfPages(file, surface, o) {
    if (typeof o.openPdf !== 'function') throw _fail(REASONS.NO_DECODER, 'Nothing here can read a PDF');
    var doc;
    try {
      doc = await o.openPdf(file, { longSide: LONG_SIDE });
    } catch (err) {
      throw _unreadable(err);
    }
    try {
      var count = Number(doc && doc.pages) || 0;
      if (count < 1) throw _fail(REASONS.UNREADABLE, 'The PDF has no pages');
      var maxPages = o.maxPages || MAX_PDF_PAGES;
      if (count > maxPages) {
        var over = _fail(REASONS.TOO_MANY_PAGES, 'The PDF has too many pages');
        over.extra = { pageCount: count, limit: maxPages };
        throw over;
      }
      var pages = [];
      // One page at a time: a Chromebook cannot hold a whole PDF as pictures.
      for (var n = 1; n <= count; n++) {
        var picture;
        try {
          picture = await _picture(await doc.page(n), surface);
        } catch (err) {
          var bad = _unreadable(err);
          bad.extra = { page: n };
          throw bad;
        }
        pages.push(await _pageOf(picture, surface, false));
        if (typeof o.onProgress === 'function') o.onProgress({ page: n, pages: count });
      }
      return pages;
    } finally {
      if (doc && typeof doc.close === 'function') doc.close();
    }
  }

  /* One chosen file in, pages ready to queue out:
       { ok: true, kind, pages: [{ blob, thumb, hash, width, height, bytes,
         quality, sharpness, blurry, name, page, pages }] }
     or a refusal:
       { ok: false, reason, ... }   (REASONS; 'office' also says which: office)
     opts: surface, decodeHeic, openPdf (see the top of this file),
     maxPages (refuse a longer PDF; MAX_PDF_PAGES when not given),
     onProgress({ page, pages }) per PDF page. */
  async function prepare(file, opts) {
    var o = {};
    [_defaults, opts || {}].forEach(function (src) {
      for (var k in src) if (src[k] != null) o[k] = src[k];
    });
    if (!file) return _refuse(REASONS.UNSUPPORTED);
    var office = _officeKind(file);
    if (office) return _refuse(REASONS.OFFICE, { office: office });
    if (!file.size) return _refuse(REASONS.EMPTY);

    var kind = null;
    try {
      var seen = sniff(await _bytes(file.slice(0, 32)));
      var named = classify(file);
      if (seen === 'zip' || seen === 'ole') return _refuse(REASONS.UNSUPPORTED);
      kind = seen || (named.ok ? named.kind : null);
      if (!kind) return named;
      if (kind === 'pdf' && file.size > MAX_PDF_BYTES) {
        return _refuse(REASONS.PDF_TOO_LARGE, { kind: kind, limit: MAX_PDF_BYTES });
      }
      var surface = _surface(o);
      var pages = kind === 'pdf' ? await _pdfPages(file, surface, o) : await _photoPages(file, kind, surface, o);
      pages.forEach(function (page, i) {
        page.page = i + 1;
        page.pages = pages.length;
        page.name = outputName(file.name, i + 1, pages.length);
      });
      return { ok: true, kind: kind, pages: pages };
    } catch (err) {
      var extra = { error: err && err.message ? err.message : String(err) };
      if (kind) extra.kind = kind;
      if (err && err.extra) for (var k in err.extra) extra[k] = err.extra[k];
      return _refuse((err && err.reason) || REASONS.FAILED, extra);
    }
  }

  return {
    configure: configure,
    classify: classify,
    sniff: sniff,
    prepare: prepare,
    outputName: outputName,
    readExif: readExif,
    stripMetadata: stripMetadata,
    sharpness: sharpness,
    isBlurry: isBlurry,
    browserSurface: browserSurface,
    REASONS: REASONS,
    LONG_SIDE: LONG_SIDE,
    THUMB_LONG_SIDE: THUMB_LONG_SIDE,
    AIM_BYTES: AIM_BYTES,
    MAX_BYTES: MAX_BYTES,
    MAX_PDF_BYTES: MAX_PDF_BYTES,
    MAX_PDF_PAGES: MAX_PDF_PAGES,
    QUALITY_STEPS: QUALITY_STEPS,
    BLURRY_BELOW: BLURRY_BELOW,
  };
})();
