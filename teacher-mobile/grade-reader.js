// @ts-check
/* grade-reader.js — Full Screen scoring on the phone grader
   (docs/plans/phone-look-plan.md, L4).

   The paper on a black page, read as large as it will go, with one white bar
   under it: one criterion, its track and − and +, and a dot for each
   criterion. A level scored moves the bar on to the next criterion still
   unscored. Once every criterion is scored the dots become a strip of the
   levels given, each a tap to go back to, and the bar takes For Revision and
   Return and Next (Next Student where nothing is returned).

   Everything it writes is the card's own write (MGrade.readerScore and
   readerMod: setCriterionScore, setScore and the ± of each), so the card
   under it, the progress line and the counts stay as they are. */
/** @type {any} */ (window).MGradeReader = (function () {
  'use strict';

  /** @type {any} */
  var W = window;
  var MC = W.MComponents;

  /** @type {{ cid: string, sid: string, aid: string, at: number, opener: Element | null, model: any } | null} */
  var _s = null;
  /** @type {any} */
  var _advance = null;

  var PENCIL =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg>';
  var CLOSE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /** @param {any} m */
  function _allScored(m) {
    return (
      m.items.length > 0 &&
      m.items.every(function (/** @type {any} */ it) {
        return it.value > 0;
      })
    );
  }

  // The chosen level's code, with its ±: "PRF +".
  /** @param {any} m @param {any} it @param {any} b */
  function _code(m, it, b) {
    if (it.value !== b.value) return b.code;
    return b.six || !it.mod ? b.code : b.code + ' ' + scoreModSuffix(it.mod);
  }

  /** @param {any} m @param {any} it */
  function _chipText(m, it) {
    var b = m.buttons.find(function (/** @type {any} */ x) {
      return x.value === it.value;
    });
    return b ? _code(m, it, b) : '';
  }

  // The bar: the criterion on view, its track, then the dots (or the strip) and the buttons.
  // html-safe: names go through esc; ids are ours; codes are fixed words
  /** @param {any} m @param {number} at */
  function _barHtml(m, at) {
    var it = m.items[at];
    if (!it) return m.act() ? '<div class="m-reader-act">' + m.act() + '</div>' : '';
    var six = !!(m.buttons[0] && m.buttons[0].six);
    var mods = it.value && !six ? [-1, 1] : [];
    var tune = mods
      .map(function (/** @type {number} */ d) {
        var allowed = normalizeScoreMod(it.level, d) === d;
        var on = allowed && it.mod === d;
        return (
          '<button type="button" class="m-mod-btn' +
          (on ? ' m-mod-active' : '') +
          '" data-action="m-reader-mod" data-mod="' +
          d +
          '" aria-pressed="' +
          on +
          '"' +
          (allowed ? '' : ' disabled') +
          '><span class="m-mod-sign" aria-hidden="true">' +
          scoreModSuffix(d) +
          '</span><span class="m-sr">' +
          (d > 0 ? 'Plus' : 'Minus') +
          '</span></button>'
        );
      })
      .join('');
    var track = m.buttons
      .map(function (/** @type {any} */ b) {
        var on = it.value === b.value;
        return (
          '<button type="button" class="m-score-btn' +
          (b.six ? ' m-six-btn' : '') +
          (on ? ' m-score-active' : '') +
          '" data-action="m-reader-score" data-score="' +
          b.value +
          '" data-tone="' +
          b.tone +
          '" aria-pressed="' +
          on +
          '"><span>' +
          _esc(_code(m, it, b)) +
          '</span></button>'
        );
      })
      .join('');
    var done = _allScored(m);
    var marks = m.items
      .map(function (/** @type {any} */ x, /** @type {number} */ i) {
        var cur = i === at;
        if (done)
          return (
            '<button type="button" class="m-reader-chip' +
            (cur ? ' is-current' : '') +
            '" data-action="m-reader-go" data-idx="' +
            i +
            '" data-level="' +
            x.level +
            '" aria-label="' +
            _esc(x.name + ', ' + _chipText(m, x)) +
            '"' +
            (cur ? ' aria-current="true"' : '') +
            '>' +
            _esc(_chipText(m, x)) +
            '</button>'
          );
        return (
          '<button type="button" class="m-reader-dot' +
          (cur ? ' is-current' : '') +
          '" data-action="m-reader-go" data-idx="' +
          i +
          '" data-level="' +
          x.level +
          '" aria-label="' +
          _esc(x.name + (x.value ? ', ' + _chipText(m, x) : ', not scored')) +
          '"' +
          (cur ? ' aria-current="true"' : '') +
          '><span class="m-reader-dot-mark"></span></button>'
        );
      })
      .join('');
    return (
      '<div class="m-score-group" data-level="' +
      it.level +
      '"><div class="m-crit-head"><span class="m-crit-name">' +
      _esc(it.name) +
      '</span><div class="m-crit-tools">' +
      tune +
      '</div></div><div class="m-score-btns" role="radiogroup" aria-label="Level for ' +
      _esc(it.name) +
      '">' +
      track +
      '</div></div>' +
      '<div class="' +
      (done ? 'm-reader-chips' : 'm-reader-dots') +
      '">' +
      marks +
      '</div>' +
      (done && m.act() ? '<div class="m-reader-act">' + m.act() + '</div>' : '')
    );
  }

  /** @param {string} t */
  function _esc(t) {
    return MC.esc(t);
  }

  function _draw() {
    var s = _s;
    var root = document.getElementById('m-reader');
    var bar = root && root.querySelector('.m-reader-bar');
    if (!s || !bar) return;
    s.model = W.MGrade.readerModel(s.cid, s.sid, s.aid);
    if (!s.model) return;
    s.at = Math.max(0, Math.min(s.at, s.model.items.length - 1));
    // html-safe: _barHtml escapes every name; the buttons are MGrade's checked bar
    bar.innerHTML = _barHtml(s.model, s.at);
    /** @type {any} */ (bar).hidden = !s.model.items.length;
  }

  /* Open Full Screen on a student's work: the pages, one under another, and
     the bar of the piece's marks. */
  /** @param {string} cid @param {string} sid @param {string} aid */
  function open(cid, sid, aid) {
    var sub = W.MGradePhotos.work(cid, sid, aid);
    var files = (sub && sub.files) || [];
    var model = W.MGrade.readerModel(cid, sid, aid);
    var st = getStudents(cid).find(function (/** @type {any} */ x) {
      return x.id === sid;
    });
    if (!files.length || !model || !st) return;
    close();
    var name = model.name || displayName(st);
    var first = displayNameFirst(st) || displayName(st);
    // The first criterion not yet scored, else the first.
    var at = Math.max(
      0,
      model.items.findIndex(function (/** @type {any} */ it) {
        return !it.value;
      }),
    );
    _s = { cid: cid, sid: sid, aid: aid, at: at, opener: document.activeElement, model: model };
    var root = document.createElement('div');
    root.className = 'm-reader';
    root.id = 'm-reader';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Full Screen: ' + name);
    var ids = ' data-sid="' + sid + '" data-aid="' + aid + '"';
    // html-safe: names go through esc; ids are ours; the pictures are filled by MGradePhotos.hydrate
    root.innerHTML =
      '<div class="m-reader-top"><button type="button" class="m-reader-round" data-action="m-reader-close" aria-label="Close">' +
      CLOSE +
      '</button><div class="m-reader-name">' +
      _esc(name) +
      '</div>' +
      MC.syncDot() +
      (W.MMarkUp && W.MMarkUp.can(cid, aid, sid, 0)
        ? '<button type="button" class="m-reader-round" data-action="m-markup-open"' +
          ids +
          ' data-page="0" aria-label="Mark Up">' +
          PENCIL +
          '</button>'
        : '<span class="m-reader-round-gap"></span>') +
      '</div><div class="m-reader-stage"><div class="m-reader-paper" data-work-box' +
      ids +
      '>' +
      files
        .map(function (/** @type {any} */ f, /** @type {number} */ i) {
          return (
            '<img class="m-reader-page" alt="' +
            _esc('Page ' + (i + 1) + ' of ' + first + '’s work') +
            '" data-work-pic data-work-which="page" data-fv-page="' +
            i +
            '">'
          );
        })
        .join('') +
      '</div>' +
      (files.length > 1 ? '<span class="m-work-count m-reader-count">1 of ' + files.length + '</span>' : '') +
      '</div><div class="m-reader-bar"></div>';
    document.body.appendChild(root);
    _draw();
    W.MGradePhotos.hydrate(root, cid);
    var close_ = root.querySelector('[data-action="m-reader-close"]');
    if (close_ && typeof (/** @type {any} */ (close_).focus) === 'function')
      /** @type {any} */ (close_).focus({ preventScroll: true });
    var paper = /** @type {HTMLElement} */ (root.querySelector('.m-reader-paper'));
    if (paper)
      paper.addEventListener(
        'scroll',
        function () {
          var pages = paper.querySelectorAll('.m-reader-page');
          var mid = paper.getBoundingClientRect().top + paper.clientHeight / 2;
          var idx = 0;
          pages.forEach(function (p, i) {
            if (p.getBoundingClientRect().top <= mid) idx = i;
          });
          var count = root.querySelector('.m-reader-count');
          if (count) count.textContent = idx + 1 + ' of ' + pages.length;
          var mark = root.querySelector('[data-action="m-markup-open"]');
          if (mark) mark.setAttribute('data-page', String(idx));
        },
        { passive: true },
      );
  }

  function close() {
    clearTimeout(_advance);
    var root = document.getElementById('m-reader');
    var back = _s && _s.opener;
    if (root) root.remove();
    _s = null;
    if (back && back.isConnected && typeof (/** @type {any} */ (back).focus) === 'function')
      /** @type {any} */ (back).focus({ preventScroll: true });
    if (W.MGradePhotos) W.MGradePhotos.releaseUnused();
  }

  function onClick(e) {
    if (!_s || !e.target || typeof (/** @type {any} */ (e.target).closest) !== 'function') return;
    var root = document.getElementById('m-reader');
    var target = e.target.closest('[data-action]');
    if (!root || !target || !root.contains(target)) return;
    var s = _s;
    var action = target.getAttribute('data-action');
    if (action === 'm-reader-close') return close();
    if (action === 'm-reader-go') {
      clearTimeout(_advance);
      s.at = Number(target.getAttribute('data-idx')) || 0;
      return _draw();
    }
    var it = s.model.items[s.at];
    if (action === 'm-reader-score' && it) {
      var value = Number(target.getAttribute('data-score'));
      var was = it.value;
      W.MGrade.readerScore(s.cid, s.sid, s.aid, it, value);
      _draw();
      // A level newly scored moves the bar on to the next criterion still unscored.
      if (!was && !_allScored(s.model)) {
        var from = s.at;
        clearTimeout(_advance);
        _advance = setTimeout(function () {
          if (!_s || _s !== s) return;
          var n = s.model.items.length;
          for (var k = 1; k <= n; k++) {
            var j = (from + k) % n;
            if (!s.model.items[j].value) {
              s.at = j;
              break;
            }
          }
          _draw();
        }, 220);
      }
      return;
    }
    if (action === 'm-reader-mod' && it) {
      W.MGrade.readerMod(s.cid, s.sid, s.aid, it, Number(target.getAttribute('data-mod')));
      return _draw();
    }
    // For Revision and Return and Next are the grading screen's own (shell.js):
    // Full Screen goes first, so the card and its toast are what is seen.
    if (action === 'm-grade-return-next' || action === 'm-grade-next-student' || action === 'm-grade-revision') close();
  }
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _s && !document.getElementById('m-markup')) close();
  });

  return { open: open, close: close, onClick: onClick };
})();
