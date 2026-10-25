/* Printable QR slips for a student questionnaire (docs/STUDENT-VOICE-PLAN.md,
   PR 5; canvas screen 7).

   Eight slips to a letter page, two across and four down, black and white,
   cut along dashed grey lines like the rubric handouts. Each slip carries
   the student's name, the class, the questionnaire and its dates, a QR code
   for <site>/s/#<code> (the code sits after # so it never reaches a server
   log) and the code typed out for a phone with no camera. The QR is drawn
   in the browser by vendor/qrcode.js (qrcode-generator 1.4.4, MIT); nothing
   leaves the page to make it.

   buildSlips / buildPages are pure and exposed for tests; print() is the
   only part that touches the page. */
var QrSlips = (function () {
  'use strict';

  var ROOT_ID = 'qr-slips-root';
  var STYLE_ID = 'qr-slips-page';
  var PER_PAGE = 8;

  function slipUrl(code, origin) {
    var base = origin || (typeof location !== 'undefined' ? location.origin : 'https://fullvision.ca');
    return base.replace(/\/$/, '') + '/s/#' + encodeURIComponent(code);
  }

  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    var t = new Date(iso + 'T12:00:00');
    return isNaN(t) ? iso : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _dates(q) {
    if (q.opens_on && q.closes_on) return 'Open ' + _fmtDate(q.opens_on) + ' – ' + _fmtDate(q.closes_on);
    if (q.closes_on) return 'Open until ' + _fmtDate(q.closes_on);
    if (q.opens_on) return 'Opens ' + _fmtDate(q.opens_on);
    return '';
  }

  /* One slip per code, in roster order: { name, code, url }. */
  function buildSlips(students, codes, origin) {
    var byId = {};
    (students || []).forEach(function (s) {
      byId[s.id] = s;
    });
    return (codes || [])
      .filter(function (c) {
        return c && c.code && byId[c.enrollment_id];
      })
      .map(function (c) {
        var st = byId[c.enrollment_id];
        var first = (st.preferred || st.firstName || '').trim();
        return {
          name: (first + ' ' + (st.lastName || '')).trim(),
          sortName: ((st.lastName || '') + ' ' + first).toLowerCase(),
          code: c.code,
          url: slipUrl(c.code, origin),
        };
      })
      .sort(function (a, b) {
        return a.sortName.localeCompare(b.sortName);
      });
  }

  function _slipHtml(slip, q, className, svg) {
    var dates = _dates(q);
    return (
      '<div class="qs-slip">' +
      '<div class="qs-head"><div class="qs-who"><div class="qs-name">' +
      esc(slip.name) +
      '</div><div class="qs-class">' +
      esc(className) +
      '</div></div><div class="qs-what"><div class="qs-title">' +
      esc(q.title || 'Questionnaire') +
      '</div>' +
      (dates ? '<div class="qs-dates">' + esc(dates) + '</div>' : '') +
      '</div></div>' +
      '<div class="qs-body"><div class="qs-qr" role="img" aria-label="QR code for ' +
      esc(slip.name) +
      '">' +
      svg +
      '</div><div class="qs-how"><div class="qs-scan">Scan with your phone camera.</div>' +
      '<div class="qs-type"><span>No camera? Go to ' +
      esc(
        slip.url
          .replace(/^https?:\/\//, '')
          .replace(/#.*$/, '')
          .replace(/\/$/, ''),
      ) +
      ' and type</span><strong>' +
      esc(slip.code) +
      '</strong></div><div class="qs-once">This code works once and only for you.</div></div></div>' +
      '</div>'
    );
  }

  /* The slips as letter pages of eight. */
  function buildPages(slips, q, className, draw) {
    var make = draw || qrSvg;
    var pages = [];
    for (var i = 0; i < slips.length; i += PER_PAGE) {
      pages.push(
        '<div class="qs-page">' +
          slips
            .slice(i, i + PER_PAGE)
            .map(function (s) {
              return _slipHtml(s, q, className, make(s.url));
            })
            .join('') +
          '</div>',
      );
    }
    return pages.join('');
  }

  function _className(cid) {
    var c = typeof COURSES !== 'undefined' ? COURSES[cid] : null;
    if (!c) return '';
    var block = typeof courseBlockLabel === 'function' ? courseBlockLabel(c) : '';
    return (c.name || '') + (block ? ' · ' + block : '');
  }

  /* Prints the slips for these codes. Returns the number of slips. */
  function print(cid, q, codes) {
    var slips = buildSlips(getStudents(cid), codes);
    if (!slips.length) return 0;
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    root.innerHTML = buildPages(slips, q, _className(cid));
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    // Every page the same margin; the slips are cut apart.
    style.textContent =
      '@page { size: letter portrait; margin: 0.25in; }\n@page :left { margin: 0.25in; }\n@page :right { margin: 0.25in; }';
    document.body.classList.add('qr-slips-active');
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('qr-slips-active');
      var s = document.getElementById(STYLE_ID);
      if (s) s.remove();
      var r = document.getElementById(ROOT_ID);
      if (r) r.innerHTML = '';
    }
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 0);
    return slips.length;
  }

  return { slipUrl: slipUrl, qrSvg: qrSvg, buildSlips: buildSlips, buildPages: buildPages, print: print };
})();
if (typeof window !== 'undefined') window.QrSlips = QrSlips;
