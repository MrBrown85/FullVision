// @ts-check
/* report-student-page.js — the Student Page on a printed report: a QR code
   in the letterhead, or a part of its own with the code and how to sign
   in (DECISIONS, "The Student Page on a printed report", 2026-11-27).

   The code opens the student page's address only. It carries no card
   code: the database cannot read one back, a report goes home and further,
   and a code beside the Student No. would be a whole sign-in on paper. The
   student still signs in with their own card.

   The code is fixed, so it is drawn from a matrix kept here rather than
   made on every print: HTTPS://FULLVISION.CA/S in capitals, which QR codes
   hold in their smaller alphanumeric form, is a 21 by 21 code (version 1,
   low error correction), about an inch square at the printed card's own
   size of square (0.045 in). tests/report-student-page.test.js makes it
   again with vendor/qrcode.js and checks it is the same; netlify.toml
   sends /S to /s/.

   Both show only for a class whose Student Page is on: with it off no card
   opens. report-blocks.js draws the letterhead through header() and the
   part through box(); report-one.js reads PART and HEADER_OPTIONS. Loaded
   with report-blocks.js, before report-one.js. */
window.ReportStudentPage = (function () {
  'use strict';

  var ADDRESS = 'fullvision.ca/s';
  var MATRIX = [
    '111111100101101111111',
    '100000100100001000001',
    '101110101011001011101',
    '101110100101101011101',
    '101110100101001011101',
    '100000100110001000001',
    '111111101010101111111',
    '000000001011000000000',
    '111011111011011000100',
    '001110010000011011111',
    '100100101001001110000',
    '010010010101101000000',
    '001011110101011010001',
    '000000001110100100001',
    '111111101001000101100',
    '100000101011010110001',
    '101110101001111010100',
    '101110100101000000010',
    '101110101011100100001',
    '100000101110100001011',
    '111111101001010101001',
  ];
  // A module of white round the code, inside its own square.
  var QUIET = 1;

  /** True when the class's Student Page is on. @param {string} cid */
  function on(cid) {
    return !!cid && typeof getReturnSettings === 'function' && getReturnSettings(cid).student_page === true;
  }

  /* The code as an SVG: one path of squares, black on white. */
  function svg() {
    var n = MATRIX.length + QUIET * 2;
    var d = '';
    MATRIX.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++)
        if (row.charAt(x) === '1') d += 'M' + (x + QUIET) + ',' + (y + QUIET) + 'h1v1h-1z';
    });
    return (
      '<svg viewBox="0 0 ' +
      n +
      ' ' +
      n +
      '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">' +
      '<rect width="' +
      n +
      '" height="' +
      n +
      '" fill="#fff"/><path fill="#000" d="' +
      d +
      '"/></svg>'
    );
  }
  function _code() {
    return '<div class="report-code-qr" role="img" aria-label="QR code for the Student Page">' + svg() + '</div>';
  }

  /* The letterhead with the code: the class on the code's top line, the
     name, then the term, teacher and student number down to its foot; the
     code at the right with what it opens beside it. title and name are
     escaped text; meta is the letterhead's own key and value spans. */
  // html-safe: title and name escaped here; meta is renderBlockHeader's spans, each value escaped there
  function header(title, name, meta) {
    return (
      '<div class="report-header report-header-code"><div class="report-header-main">' +
      '<div class="report-course-title">' +
      esc(title) +
      '</div><div class="report-student-name">' +
      esc(name) +
      '</div>' +
      (meta ? '<div class="report-header-code-meta">' + meta + '</div>' : '') +
      '</div><div class="report-header-code-qr"><div class="report-header-code-label">' +
      '<div class="report-header-code-k">Student Page</div><div>' +
      ADDRESS +
      '</div></div>' +
      _code() +
      '</div></div>'
    );
  }

  /* "Jun 30, 2027" from 'YYYY-MM-DD', in any time zone. */
  function _day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  /* The part: the code, three steps in the student page's own words, and
     the card's last day. A student with no birthday and no student number
     signs in with the password on their card, so their third step says
     so. */
  // html-safe: fixed words; the date is built from digits; no student text is printed
  function box(cid, student) {
    if (!on(cid)) return '';
    var st = student || {};
    var check =
      st.dateOfBirth || st.studentNumber
        ? 'Enter your birthday or your student number.'
        : 'Enter the password on your Student Card.';
    var until = _day(typeof getCardsWorkUntil === 'function' ? getCardsWorkUntil(cid).date : '');
    return (
      '<div class="report-block-box report-student-page"><div class="report-block-title">Your Student Page</div>' +
      '<div class="report-sp-body">' +
      _code() +
      '<ol class="report-sp-steps">' +
      '<li>Scan this code with a phone camera, or go to <strong>' +
      ADDRESS +
      '</strong>.</li>' +
      '<li>Scan or type the code on your Student Card.</li>' +
      '<li>' +
      check +
      '</li></ol>' +
      '<div class="report-sp-card"><div class="report-sp-card-k">Student Card</div>' +
      (until ? '<div>Works until ' + until + '</div>' : '') +
      '<div class="report-sp-lost">Lost your card? Ask your teacher for a new one.</div></div>' +
      '</div></div>'
    );
  }

  /* One Report's part, and the letterhead's switch: offered only where
     the class's Student Page is on. */
  var PART = { label: 'Student Page', group: 3, offered: on };
  var HEADER_OPTIONS = [{ key: 'studentPage', label: 'Student Page Code', def: false, offered: on }];

  return { MATRIX: MATRIX, on: on, svg: svg, header: header, box: box, PART: PART, HEADER_OPTIONS: HEADER_OPTIONS };
})();
