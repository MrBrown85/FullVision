// @ts-check
/* Sticker Sheets for Scanning (docs/plans/add-work-for-class-plan.md, B4;
   boards "Surprise: Sticker Sheets That Sort the Pile" and "Handing Out
   Stickers").

   One sheet per student: 80 small stickers, each carrying a QR code of FVS +
   the student's sticker code (shared/data-scan-labels.js), their first name
   and last initial, and the class. A student sticks one on the first page
   of each paper; when a scanned pile is split, a sticker names that piece.
   The code says nothing about the student and signs nobody in.

   ScanLabels.open(cid) puts the screen over Class Settings. It asks for the
   class's codes (issueScanLabels: a live code for every student who has
   none), then offers:

   - Print On: Sticker Sheets (Avery 5167: 4 across, 20 down, 1.75 by 0.5
     inches) or Plain Paper (the same page with light cut lines).
   - Sheets For: Every Student, or Choose Students.
   - A preview of one student's sheet, with arrows.
   - New Code (Lost a Sheet?): asks first, in plain words, that the old
     stickers stop working, then reissueScanLabel and the new sheet.
   - Print N Sheets: one sheet per student, a page break between students,
     through the browser's print dialog as the student cards print
     (setPrintMode, printThen in teacher/ui.js; vendor/qrcode.js through
     Router.withScripts).

   Opened from the Student Cards card in Class Settings › Student Page
   (teacher/student-cards.js, Print Sticker Sheets). sheetHtml and
   stickerHtml are pure and exposed for tests.

   The Avery 5167 page: top and bottom margins 0.5 inch, side margins
   0.28125 inch, labels every 2.0625 inches across and 0.5 inch down. */
var ScanLabels = (function () {
  'use strict';

  var ACROSS = 4;
  var DOWN = 20;
  var PER_SHEET = ACROSS * DOWN;
  var LABEL_W = 1.75; // inches
  var LABEL_H = 0.5;
  var TOP = 0.5; // inches from the page's top edge to the first row
  var SIDE = 0.28125; // inches from the page's left edge to the first column
  var PITCH_X = 2.0625; // inches from one column's left edge to the next
  var PITCH_Y = 0.5;
  var QR_IN = 0.44; // the QR's side, inches: as tall as the label allows, leaving a thin edge
  var ROOT_ID = 'scan-labels-root';
  var STYLE_ID = 'scan-labels-page';
  var ACTIVE = 'scan-labels-active';

  /** @type {any} */
  var _s = null;
  // The app's globals this screen uses (vendor/qrcode.js, teacher/ui.js), which this check does not see.
  /** @type {any} */
  var G = typeof window !== 'undefined' ? window : globalThis;

  /* ── The sheet (pure) ── */

  /* The QR's dark modules as one SVG path: version 1 (21 modules),
     alphanumeric, error correction Q, no quiet zone (the label's white edge
     and the paper around a stuck sticker are the quiet zone). */
  // html-safe: numbers and fixed markup only
  function qrSvg(code) {
    if (typeof G.qrcode !== 'function') return '';
    var qr = G.qrcode(1, 'Q');
    qr.addData('FVS' + code, 'Alphanumeric');
    qr.make();
    var n = qr.getModuleCount();
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    }
    return (
      '<svg class="sl-qr" viewBox="0 0 ' +
      n +
      ' ' +
      n +
      '" shape-rendering="crispEdges" aria-hidden="true"><path fill="#000" d="' +
      d +
      '"/></svg>'
    );
  }

  /** @param {any} st */
  function stickerName(st) {
    var first = String((st && (st.preferred || st.firstName)) || '').trim();
    var last = String((st && st.lastName) || '').trim();
    return (first + (last ? ' ' + last.charAt(0).toUpperCase() + '.' : '')).trim();
  }

  /* The class as a sticker says it: "Socials 10 · C". */
  /** @param {any} course */
  function shortClass(course) {
    if (!course) return '';
    var name = String(course.name || '').trim();
    var block = typeof normalizeCourseBlock === 'function' ? normalizeCourseBlock(course.block) : '';
    block = String(block || '').trim();
    // A name that already says its block ("Block C Socials 10") keeps it once.
    var words = ' ' + name.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (
      !block ||
      words.indexOf(
        ' ' +
          block
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim() +
          ' ',
      ) >= 0
    )
      return name;
    return name + ' · ' + block;
  }

  // html-safe: name and class through esc(); the QR is numbers only (qrSvg)
  function stickerHtml(name, className, svg) {
    return (
      '<div class="sl-sticker">' +
      svg +
      '<div class="sl-words"><div class="sl-name">' +
      esc(name) +
      '</div><div class="sl-class">' +
      esc(className) +
      '</div></div></div>'
    );
  }

  /* One student's letter page of 80 stickers, each placed where Avery 5167
     puts its labels. `plain` draws light cut lines for plain paper. */
  // html-safe: fixed markup and numbers around stickerHtml, which escapes
  function sheetHtml(name, className, code, plain) {
    var one = stickerHtml(name, className, qrSvg(code));
    var cells = '';
    for (var row = 0; row < DOWN; row++) {
      for (var col = 0; col < ACROSS; col++) {
        cells +=
          '<div class="sl-cell" style="left:' +
          (SIDE + col * PITCH_X) +
          'in;top:' +
          (TOP + row * PITCH_Y) +
          'in;width:' +
          LABEL_W +
          'in;height:' +
          LABEL_H +
          'in">' +
          one +
          '</div>';
      }
    }
    return '<div class="sl-sheet' + (plain ? ' sl-plain' : '') + '">' + cells + '</div>';
  }

  /* ── The screen ── */

  function _course(cid) {
    return typeof COURSES !== 'undefined' ? COURSES[cid] : null;
  }
  function _roster(cid) {
    var list = (typeof getStudents === 'function' ? getStudents(cid) : []) || [];
    return typeof sortStudents === 'function' ? sortStudents(list.slice(), 'lastName') : list.slice();
  }
  function _full(st) {
    return ((st.preferred || st.firstName || '') + ' ' + (st.lastName || '')).trim();
  }
  function _first(st) {
    return String(st.preferred || st.firstName || '').trim() || 'this student';
  }

  // The students the sheets are for, in class-list order, who have a code.
  function _printing(s) {
    return s.students.filter(function (st) {
      return s.codes[st.id] && (s.sheetsFor === 'all' || s.chosen[st.id]);
    });
  }
  function _shown(s) {
    var list = s.students.filter(function (st) {
      return s.codes[st.id];
    });
    if (!list.length) return null;
    if (s.at >= list.length) s.at = list.length - 1;
    if (s.at < 0) s.at = 0;
    return { st: list[s.at], at: s.at, of: list.length };
  }

  // html-safe: every value through esc(); the sheet from sheetHtml
  function _html(s) {
    var course = _course(s.cid);
    var n = _printing(s).length;
    var count = s.students.length;
    var sub = [
      course && typeof courseDisplayName === 'function' ? courseDisplayName(course) : (course && course.name) || '',
      count === 1 ? '1 student' : count + ' students',
      'one sheet per student lasts the term',
    ]
      .filter(Boolean)
      .join(' · ');
    var shown = _shown(s);
    var ready = !s.busy && !s.refused;
    var bar =
      '<div class="sl-bar">' +
      '<div class="sl-titles"><h1 class="sl-title" id="sl-title">Sticker Sheets for Scanning</h1>' +
      '<div class="sl-sub">' +
      esc(sub) +
      '</div></div><div class="sl-gap"></div>' +
      '<button type="button" class="btn btn-secondary" data-sl="close">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-sl="print"' +
      (ready && n ? '' : ' disabled') +
      '>' +
      esc(n === 1 ? 'Print 1 Sheet' : 'Print ' + n + ' Sheets') +
      '</button></div>';

    var note = s.msg ? '<div class="sl-note" role="status">' + esc(s.msg) + '</div>' : '';
    if (s.refused || (!s.loaded && !s.busy)) {
      return (
        bar +
        '<div class="sl-body"><div class="sl-note" role="status">' +
        esc(s.refused || 'Could not get the sticker codes.') +
        '</div><button type="button" class="btn btn-secondary" data-sl="retry">Try Again</button></div>'
      );
    }
    if (!s.loaded) return bar + '<div class="sl-body"><div class="sl-note" role="status">Getting codes…</div></div>';

    var choice = function (group, value, title, hint, on) {
      return (
        '<label class="sl-choice' +
        (on ? ' is-on' : '') +
        '"><input type="radio" name="sl-' +
        group +
        '" data-sl-change="' +
        group +
        '" value="' +
        value +
        '"' +
        (on ? ' checked' : '') +
        '><span class="sl-choice-words"><span class="sl-choice-title">' +
        esc(title) +
        '</span>' +
        (hint ? '<span class="sl-choice-hint">' + esc(hint) + '</span>' : '') +
        '</span></label>'
      );
    };
    var chooseList =
      s.sheetsFor === 'choose'
        ? '<div class="sl-pick">' +
          s.students
            .map(function (st) {
              return (
                '<label class="sl-pick-row"><input type="checkbox" data-sl-change="pick" value="' +
                esc(st.id) +
                '"' +
                (s.chosen[st.id] ? ' checked' : '') +
                (s.codes[st.id] ? '' : ' disabled') +
                '><span>' +
                esc(_full(st)) +
                '</span></label>'
              );
            })
            .join('') +
          '</div>'
        : '';
    var side =
      '<div class="sl-side">' +
      '<section class="sl-group"><h2 class="sl-h">Print On</h2>' +
      choice(
        'on',
        'stickers',
        'Sticker Sheets',
        '80 small stickers per student, Avery 5167 size',
        s.printOn === 'stickers',
      ) +
      choice(
        'on',
        'plain',
        'Plain Paper',
        'The same page; students cut a strip and tape it on',
        s.printOn === 'plain',
      ) +
      '<p class="sl-hint">Print at 100%, not Fit to Page, so the stickers line up with the labels.</p>' +
      '</section>' +
      '<section class="sl-group"><h2 class="sl-h">Sheets For</h2>' +
      choice('for', 'all', 'Every Student (' + count + ')', '', s.sheetsFor === 'all') +
      choice('for', 'choose', 'Choose Students', '', s.sheetsFor === 'choose') +
      chooseList +
      '</section>' +
      '<section class="sl-group"><h2 class="sl-h">What the Code Holds</h2>' +
      '<p class="sl-p">A random code that only means something in this class, this term. It is not the student’s card code and can’t be used to sign in.</p>' +
      '<p class="sl-p">The name is printed for you and the student to read. FullVision reads only the code, on this computer.</p>' +
      '</section>' +
      '<section class="sl-group"><h2 class="sl-h">No Assignment on the Sticker</h2>' +
      '<p class="sl-p">One sheet works for every assignment this term. You choose the assignment when you drop the scan.</p>' +
      '</section>' +
      '</div>';

    var preview = '';
    if (shown) {
      var name = _full(shown.st);
      preview =
        '<div class="sl-preview">' +
        '<div class="sl-nav">' +
        '<button type="button" class="sl-arrow" data-sl="prev" aria-label="Previous Sheet"' +
        (shown.at > 0 ? '' : ' disabled') +
        '>‹</button>' +
        '<div class="sl-nav-words" aria-live="polite">' +
        esc('Sheet ' + (shown.at + 1) + ' of ' + shown.of + ' · ' + name) +
        '</div>' +
        '<button type="button" class="sl-arrow" data-sl="next" aria-label="Next Sheet"' +
        (shown.at < shown.of - 1 ? '' : ' disabled') +
        '>›</button></div>' +
        '<div class="sl-paper" role="img" aria-label="' +
        esc('Sticker sheet for ' + name) +
        '"><div class="sl-paper-scale">' +
        sheetHtml(stickerName(shown.st), shortClass(_course(s.cid)), s.codes[shown.st.id], s.printOn === 'plain') +
        '</div></div>' +
        '<div class="sl-lost"><div class="sl-lost-words"><div class="sl-lost-title">Lost a Sheet?</div>' +
        '<div class="sl-hint">' +
        esc('Give ' + _first(shown.st) + ' a new code and print their sheet. Their old stickers stop working.') +
        '</div></div>' +
        '<button type="button" class="btn btn-secondary" data-sl="newcode" data-sid="' +
        esc(shown.st.id) +
        '"' +
        (s.busy ? ' disabled' : '') +
        '>' +
        esc('New Code for ' + _first(shown.st)) +
        '</button>' +
        (s.renewed === shown.st.id
          ? '<button type="button" class="btn btn-primary" data-sl="printone" data-sid="' +
            esc(shown.st.id) +
            '">' +
            esc('Print ' + _first(shown.st) + '’s Sheet') +
            '</button>'
          : '') +
        '</div>' +
        '<p class="sl-hint">80 stickers covers several papers a week for a whole term, with spares. Test one scan on your school’s copier before printing the class set.</p>' +
        '</div>';
    } else {
      preview = '<div class="sl-preview"><div class="sl-note">No students to make sheets for.</div></div>';
    }
    return bar + note + '<div class="sl-body">' + side + preview + '</div>';
  }

  function _draw() {
    var s = _s;
    if (!s) return;
    var focused = document.activeElement;
    var key = focused && s.overlay.contains(focused) ? _keyOf(focused) : '';
    // html-safe: _html escapes every value
    s.page.innerHTML = _html(s);
    if (key) {
      var again = /** @type {HTMLElement | null} */ (s.page.querySelector(key));
      if (again) again.focus();
    }
  }
  /** @param {Element} el */
  function _keyOf(el) {
    var d = /** @type {HTMLElement} */ (el).dataset || {};
    if (d.sl) return '[data-sl="' + d.sl + '"]';
    if (d.slChange) {
      var v = /** @type {HTMLInputElement} */ (el).value;
      return '[data-sl-change="' + d.slChange + '"][value="' + (window.CSS && CSS.escape ? CSS.escape(v) : v) + '"]';
    }
    return '';
  }

  // The codes: a live one for every student still in the class.
  function _load(s) {
    s.busy = true;
    s.refused = '';
    s.msg = '';
    _draw();
    return Promise.resolve(issueScanLabels(s.cid)).then(function (res) {
      if (_s !== s) return; // the screen closed, or another class's opened
      s.busy = false;
      if (!res || res.refused || !res.data) {
        s.refused = (res && res.refused) || 'Could not get the sticker codes.';
        _draw();
        return;
      }
      s.codes = {};
      (res.data.labels || []).forEach(function (l) {
        s.codes[l.enrollment_id] = l.code;
      });
      s.loaded = true;
      _draw();
    });
  }

  function _askNewCode(s, sid) {
    var st = s.students.filter(function (x) {
      return x.id === sid;
    })[0];
    if (!st) return;
    var first = _first(st);
    showConfirm(
      'New Code for ' + first + '?',
      first +
        '’s old stickers stop working as soon as the new code is made. A paper with an old sticker on it will need ' +
        first +
        '’s name typed when you split the scan. Print the new sheet and hand it out.',
      'Make New Code',
      'danger',
      function () {
        if (_s !== s) return;
        s.busy = true;
        s.msg = '';
        _draw();
        Promise.resolve(reissueScanLabel(s.cid, sid)).then(function (res) {
          if (_s !== s) return;
          s.busy = false;
          var label = res && res.data && res.data.label;
          if (!label) {
            s.msg = (res && res.refused) || 'Could not make a new code for ' + first + '. Nothing changed.';
            _draw();
            return;
          }
          s.codes[sid] = label.code;
          s.renewed = sid;
          s.msg = first + ' has a new code. Their old stickers no longer work.';
          _draw();
        });
      },
    );
  }

  function _print(s, list) {
    if (!list.length) return;
    var className = shortClass(_course(s.cid));
    var plain = s.printOn === 'plain';
    var course = _course(s.cid);
    var title = [
      list.length === 1 ? 'Sticker Sheet' : 'Sticker Sheets',
      list.length === 1 ? _full(list[0]) : '',
      typeof G.printClassName === 'function' ? G.printClassName(course) : (course && course.name) || '',
    ];
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    // html-safe: sheetHtml escapes every name and class; codes are the sticker alphabet only
    root.innerHTML = list
      .map(function (st) {
        return sheetHtml(stickerName(st), className, s.codes[st.id], plain);
      })
      .join('');
    // The page's own margins are the labels': nothing added by the browser.
    G.setPrintMode(STYLE_ID, ACTIVE, 'letter portrait', '0');
    G.printThen(function () {
      G.clearPrintMode(STYLE_ID, ACTIVE);
      var r = document.getElementById(ROOT_ID);
      if (r) r.innerHTML = '';
    }, title);
  }

  /** @param {Event} e */
  function _click(e) {
    var s = _s;
    /** @type {any} */
    var t = e.target && /** @type {Element} */ (e.target).closest('[data-sl]');
    if (!s || !t || t.disabled) return;
    var what = t.dataset.sl;
    if (what === 'close') close();
    else if (what === 'retry') _load(s);
    else if (what === 'prev' || what === 'next') {
      s.at += what === 'next' ? 1 : -1;
      _draw();
    } else if (what === 'newcode') _askNewCode(s, t.dataset.sid || '');
    else if (what === 'print') _print(s, _printing(s));
    else if (what === 'printone') {
      _print(
        s,
        s.students.filter(function (st) {
          return st.id === t.dataset.sid && s.codes[st.id];
        }),
      );
    }
  }

  /** @param {Event} e */
  function _change(e) {
    var s = _s;
    var t = /** @type {HTMLInputElement} */ (e.target);
    if (!s || !t || !t.dataset) return;
    var what = t.dataset.slChange;
    if (what === 'on') s.printOn = t.value === 'plain' ? 'plain' : 'stickers';
    else if (what === 'for') s.sheetsFor = t.value === 'choose' ? 'choose' : 'all';
    else if (what === 'pick') {
      if (t.checked) s.chosen[t.value] = true;
      else delete s.chosen[t.value];
      // The preview follows the student just ticked.
      var withCode = s.students.filter(function (st) {
        return s.codes[st.id];
      });
      var at = withCode.findIndex(function (st) {
        return st.id === t.value;
      });
      if (t.checked && at >= 0) s.at = at;
    } else return;
    _draw();
  }

  /** @param {KeyboardEvent} e */
  function _keydown(e) {
    if (!_s || e.key !== 'Escape') return;
    // A question over the screen closes first.
    if (document.querySelector('.confirm-overlay')) return;
    e.preventDefault();
    close();
  }

  /** @param {string} cid */
  function open(cid) {
    if (!cid || typeof COURSES === 'undefined' || !COURSES[cid]) return false;
    close(true);
    var overlay = document.createElement('div');
    overlay.id = 'scan-labels-overlay';
    overlay.className = 'sl-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sl-title');
    var pageEl = document.createElement('div');
    pageEl.className = 'sl-page';
    overlay.appendChild(pageEl);
    document.body.appendChild(overlay);
    var s = {
      cid: cid,
      overlay: overlay,
      page: pageEl,
      opener: document.activeElement,
      students: _roster(cid),
      codes: /** @type {Record<string, string>} */ ({}),
      loaded: false,
      busy: false,
      refused: '',
      msg: '',
      printOn: 'stickers',
      sheetsFor: 'all',
      chosen: /** @type {Record<string, boolean>} */ ({}),
      at: 0,
      renewed: '',
    };
    _s = s;
    overlay.addEventListener('click', _click);
    overlay.addEventListener('change', _change);
    document.addEventListener('keydown', _keydown, true);
    // The QR maker loads with the screen (router.js _onDemand), as a card sheet's does.
    var router = /** @type {any} */ (window).Router;
    var ready =
      typeof G.qrcode === 'function' || !router || typeof router.withScripts !== 'function'
        ? Promise.resolve()
        : new Promise(function (done) {
            router.withScripts('qrcode', done);
          });
    _draw();
    var cancel = /** @type {HTMLElement | null} */ (pageEl.querySelector('[data-sl="close"]'));
    if (cancel) cancel.focus();
    ready.then(function () {
      if (_s === s) _load(s);
    });
    return true;
  }

  function close(quiet) {
    var s = _s;
    if (!s) return;
    _s = null;
    document.removeEventListener('keydown', _keydown, true);
    s.overlay.remove();
    if (quiet) return;
    if (s.opener && s.opener.isConnected && typeof s.opener.focus === 'function') s.opener.focus();
  }

  return {
    open: open,
    close: close,
    isOpen: function () {
      return !!_s;
    },
    sheetHtml: sheetHtml,
    stickerHtml: stickerHtml,
    stickerName: stickerName,
    shortClass: shortClass,
    qrSvg: qrSvg,
    PER_SHEET: PER_SHEET,
    QR_IN: QR_IN,
  };
})();
if (typeof window !== 'undefined') window.ScanLabels = ScanLabels;
