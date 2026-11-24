// @ts-check
/* shared/handout-pdf.js — one PDF file from a handout's JPEG pages

   A handout's pages are JPEGs (shared/photo-shrink.js turned the teacher's
   PDF into them). A PDF can hold a JPEG as it is (/Filter /DCTDecode), so
   this writes a small PDF around the pictures: the bytes of each picture
   go in untouched, one page per picture, the page the picture's own shape
   with its long side 792 points (US Letter's long side at 72 points to the
   inch). No library, nothing sent anywhere.

   HandoutPdf.jpegInfo(bytes) → { width, height, components } or null
   HandoutPdf.build([{ bytes, width, height, components }]) → Uint8Array
*/
/** @type {any} */ (window).HandoutPdf = (function () {
  'use strict';

  var LONG_SIDE = 792;

  /* The size of a JPEG, read from its start-of-frame marker; null when
     these bytes are not a JPEG this writer can hold as it is (1 or 3
     colour parts). */
  function jpegInfo(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    var i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      var m = bytes[i + 1];
      if (m === 0xff) {
        i += 1;
        continue;
      }
      // A marker with no length: a stuffed zero, restart marks, start of picture.
      if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        i += 2;
        continue;
      }
      if (m === 0xd9 || m === 0xda) return null;
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      var isFrame = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (isFrame) {
        if (i + 9 >= bytes.length) return null;
        var height = (bytes[i + 5] << 8) | bytes[i + 6];
        var width = (bytes[i + 7] << 8) | bytes[i + 8];
        var components = bytes[i + 9];
        if (!width || !height || (components !== 1 && components !== 3)) return null;
        return { width: width, height: height, components: components };
      }
      i += 2 + len;
    }
    return null;
  }

  function ascii(text) {
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  // The page's size in points: the picture's shape, its long side 792.
  function pageSize(width, height) {
    var long = Math.max(width, height);
    var w = Math.max(1, Math.round((width * LONG_SIDE) / long));
    var h = Math.max(1, Math.round((height * LONG_SIDE) / long));
    return { w: w, h: h };
  }

  function build(pages) {
    if (!Array.isArray(pages) || !pages.length) throw new Error('no pages');
    var chunks = [];
    var size = 0;
    var offsets = [];
    function put(part) {
      var b = typeof part === 'string' ? ascii(part) : part;
      chunks.push(b);
      size += b.length;
    }
    function begin(num) {
      offsets[num] = size;
    }
    var n = pages.length;
    // Objects: 1 catalog, 2 page tree, then for page k (from 0): 3+3k the page, 4+3k its drawing, 5+3k its picture.
    var kids = [];
    for (var k = 0; k < n; k++) kids.push(3 + 3 * k + ' 0 R');
    // Four bytes above 127 after the header tell a program this file is binary.
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    begin(1);
    put('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    begin(2);
    put('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');
    for (var p = 0; p < n; p++) {
      var pg = pages[p];
      var info = pg && pg.bytes ? jpegInfo(pg.bytes) : null;
      var width = (pg && pg.width) || (info && info.width) || 0;
      var height = (pg && pg.height) || (info && info.height) || 0;
      var comps = (pg && pg.components) || (info && info.components) || 0;
      if (!width || !height || (comps !== 1 && comps !== 3) || !pg.bytes)
        throw new Error('page ' + (p + 1) + ' is not a JPEG');
      var sz = pageSize(width, height);
      var pageNum = 3 + 3 * p;
      var drawNum = pageNum + 1;
      var imgNum = pageNum + 2;
      var draw = 'q ' + sz.w + ' 0 0 ' + sz.h + ' 0 0 cm /Im0 Do Q';
      begin(pageNum);
      put(
        pageNum +
          ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
          sz.w +
          ' ' +
          sz.h +
          '] /Resources << /XObject << /Im0 ' +
          imgNum +
          ' 0 R >> >> /Contents ' +
          drawNum +
          ' 0 R >>\nendobj\n',
      );
      begin(drawNum);
      put(drawNum + ' 0 obj\n<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream\nendobj\n');
      begin(imgNum);
      put(
        imgNum +
          ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' +
          width +
          ' /Height ' +
          height +
          ' /ColorSpace /' +
          (comps === 1 ? 'DeviceGray' : 'DeviceRGB') +
          ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
          pg.bytes.length +
          ' >>\nstream\n',
      );
      put(pg.bytes);
      put('\nendstream\nendobj\n');
    }
    var total = 3 + 3 * n;
    var xref = size;
    var table = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var o = 1; o < total; o++) table += ('0000000000' + offsets[o]).slice(-10) + ' 00000 n \n';
    put(table);
    put('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(size);
    var at = 0;
    chunks.forEach(function (c) {
      out.set(c, at);
      at += c.length;
    });
    return out;
  }

  return { jpegInfo: jpegInfo, build: build, LONG_SIDE: LONG_SIDE };
})();
