/* The print sheet student cards are printed on (teacher/student-cards.js).

   Eight cells to a letter page, two across and four down, black and white,
   cut along dashed grey lines like the rubric handouts. A card carries a QR
   code for <site>/s/#<code> (the code sits after # so it never reaches a
   server log). The QR is drawn in the browser by vendor/qrcode.js
   (qrcode-generator 1.4.4, MIT); nothing leaves the page to make it. The
   file once printed questionnaire slips too; they are gone (migration
   2026112414), and the name stays.

   sheetPages is pure and exposed for tests; printSheet() is the only part
   that touches the page. */
var QrSlips = (function () {
  'use strict';

  /* ── The print sheet ──────────────────────────────────────── */

  var ROOT_ID = 'qr-slips-root';
  var STYLE_ID = 'qr-slips-page';
  var PER_PAGE = 8;

  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  /* `items` as letter pages of eight cells, in the order given: a .qs-page
     for every eight, a .qs-slip cell for each item (teacher/qr-slips.css
     sizes the page, places the cells and draws the cut lines).
     renderCell(item) returns the HTML that goes inside one cell; it must
     escape every value it prints. */
  // html-safe: fixed page and cell wrappers around renderCell's HTML, which the caller escapes (_slipHtml)
  function sheetPages(items, renderCell) {
    var pages = [];
    for (var i = 0; i < items.length; i += PER_PAGE) {
      pages.push(
        '<div class="qs-page">' +
          items
            .slice(i, i + PER_PAGE)
            .map(function (item) {
              return '<div class="qs-slip">' + renderCell(item) + '</div>';
            })
            .join('') +
          '</div>',
      );
    }
    return pages.join('');
  }

  /* Prints `items` eight to a letter page, each cell drawn by
     renderCell(item), and takes the sheet off the page when the print dialog
     closes. `titleParts` names the saved PDF (ui.js printFileName). The
     caller checks there is something to print. */
  function printSheet(items, renderCell, titleParts) {
    // The QR maker (vendor/qrcode.js) loads the first time a sheet is printed (router.js _onDemand).
    window.Router.withScripts('qrcode', function () {
      var root = document.getElementById(ROOT_ID);
      if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.appendChild(root);
      }
      root.innerHTML = sheetPages(items, renderCell);
      // Every page the same margin; the cells are cut apart (ui.js setPrintMode).
      setPrintMode(STYLE_ID, 'qr-slips-active', 'letter portrait', '0.25in');
      printThen(function () {
        clearPrintMode(STYLE_ID, 'qr-slips-active');
        var r = document.getElementById(ROOT_ID);
        if (r) r.innerHTML = '';
      }, titleParts);
    });
  }

  /* A sheet's file name: the plural for many ("Student Cards – Science 8"),
     the student's name with the singular for one. `extra` follows the noun. */
  function sheetTitle(noun, items, extra, className) {
    var one = items.length === 1;
    return [one ? noun : noun + 's', one ? items[0].name : '', extra, className];
  }

  /* ── The card's address ───────────────────────────────────── */

  function slipUrl(code, origin) {
    var base = origin || (typeof location !== 'undefined' ? location.origin : 'https://fullvision.ca');
    return base.replace(/\/$/, '') + '/s/#' + encodeURIComponent(code);
  }

  return {
    qrSvg: qrSvg,
    sheetPages: sheetPages,
    printSheet: printSheet,
    sheetTitle: sheetTitle,
    slipUrl: slipUrl,
  };
})();
if (typeof window !== 'undefined') window.QrSlips = QrSlips;
