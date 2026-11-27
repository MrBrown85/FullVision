// @ts-check
/* ── work-viewer.js — a student's pages, one at a time, over the screen ──────
   Opened from the Work tab's Flip Through Work, from a Work Wall card where
   there is no grader, and from a page on the student page's Overview where
   there is no grader (shared/work-wall.js). Dark, like Add Work's page view
   (teacher/add-work-page-view.js): the page fills the height of the window,
   in its own proportions, never wider, with the arrows beside it and Page
   1 of 2 just under it. A piece of three pages or more has a strip of its pages
   to jump to. Left and right (and a swipe on an iPad) turn the page; the
   arrows by the title move to the next piece (on the Work tab) or the next
   student on the same piece (on the Work Wall). Escape or Close closes it.

   Turning a page draws nothing again: every page of the piece is in the
   view and only the one shown is visible. Whole pages are asked for only
   here, for the page shown and the ones either side of it, through
   WorkThumbs; the thumbnail stands in until its page is in.

   WorkViewer.open(items, at, { step, page, onGrade })
     items: [{ cid, sid, aid }], each with pages in; step: 'Student' or
     'Piece', what the arrows by the title move to; onGrade(item) adds Open in
     Grader and is called with the item shown, after the view closes.
   WorkViewer.close(quiet)  quiet: focus stays where it is.
   WorkViewer.isOpen() */
/** @type {any} */ (window).WorkViewer = (function () {
  'use strict';

  /** @type {any} */
  var _v = null;
  /** @type {any} */
  var _pics = null;

  var PREV =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>';
  var NEXT =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  var STRIP_FROM = 3; // pages in a piece before the strip of its pages shows

  /** @param {any} it */
  function _read(it) {
    if (!it) return null;
    var st = (getStudents(it.cid) || []).find(function (/** @type {any} */ s) {
      return s.id === it.sid;
    });
    var a = (getAssessments(it.cid) || []).find(function (/** @type {any} */ x) {
      return x && x.id === it.aid;
    });
    var sub = getStudentSubmission(it.cid, it.sid, it.aid);
    if (!st || !a || !sub) return null;
    var pages = (sub.files || []).slice().sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      return (x.page || 0) - (y.page || 0);
    });
    return { it: it, st: st, a: a, sub: sub, pages: pages };
  }

  /** The page's width over its height: its own size, or a letter page until it is known. @param {any} f */
  function _ratio(f) {
    return f && f.width > 0 && f.height > 0 ? f.width / f.height : 8.5 / 11;
  }

  /** @param {string} what @param {number} dir @param {string} label @param {boolean} off @param {string} cls */
  function _arrow(what, dir, label, off, cls) {
    return (
      '<button type="button" class="' +
      cls +
      '" data-wv="' +
      what +
      '" data-dir="' +
      dir +
      '" aria-label="' +
      esc(label) +
      '"' +
      (off ? ' disabled' : '') +
      '>' +
      (dir < 0 ? PREV : NEXT) +
      '</button>'
    );
  }

  /** @param {any} r */
  function _barHtml(r) {
    var many = _v.items.length > 1;
    var name = displayName(r.st);
    var byPiece = _v.step === 'Piece';
    // The arrows sit by what they move to: the piece on the Work tab, the student on the wall.
    var title = byPiece ? r.a.title || '' : name;
    var sub = byPiece ? name : r.a.title || '';
    return (
      '<div class="wv-bar">' +
      (many ? _arrow('item', -1, 'Previous ' + _v.step, _v.at === 0, 'wv-step') : '') +
      '<div class="wv-titles"><h2 class="wv-title" id="wv-title">' +
      esc(title) +
      '</h2><span class="wv-sub">' +
      esc(sub) +
      '</span></div>' +
      (many ? _arrow('item', 1, 'Next ' + _v.step, _v.at === _v.items.length - 1, 'wv-step') : '') +
      '<span class="wv-gap"></span>' +
      (_v.onGrade
        ? '<button type="button" class="btn btn-primary wv-grade" data-wv="grade">Open in Grader</button>'
        : '') +
      '<button type="button" class="wv-close" data-wv="close">Close</button>' +
      '</div>'
    );
  }

  /** @param {any} r */
  function _stageHtml(r) {
    var n = r.pages.length;
    var who = displayName(r.st);
    var imgs = r.pages
      .map(function (/** @type {any} */ f, /** @type {number} */ i) {
        return (
          '<img class="wv-img" data-work-pic data-work-which="page" data-work-first="thumb" data-page="' +
          i +
          '" alt="' +
          esc(who + "'s page " + (i + 1)) +
          '">'
        );
      })
      .join('');
    return (
      '<div class="wv-stage" data-wv-stage>' +
      (n > 1 ? _arrow('page', -1, 'Previous Page', false, 'wv-turn') : '') +
      '<div class="wv-sheet">' +
      imgs +
      (n > 1 ? '<span class="wv-at" aria-live="polite"></span>' : '') +
      '</div>' +
      (n > 1 ? _arrow('page', 1, 'Next Page', false, 'wv-turn') : '') +
      '</div>'
    );
  }

  /** @param {any} r */
  function _footHtml(r) {
    var n = r.pages.length;
    var strip =
      n >= STRIP_FROM
        ? '<div class="wv-strip">' +
          r.pages
            .map(function (/** @type {any} */ f, /** @type {number} */ i) {
              return (
                '<button type="button" class="wv-thumb" data-wv="to" data-page="' +
                i +
                '" aria-label="Page ' +
                (i + 1) +
                '"><span>' +
                (i + 1) +
                '</span><img data-work-pic data-page="' +
                i +
                '" alt=""></button>'
              );
            })
            .join('') +
          '</div>'
        : '';
    var note = r.sub.note
      ? '<p class="wv-note"><strong>' +
        esc(displayNameFirst(r.st) + "'s Note, Sent With the Work") +
        '</strong> ' +
        esc(r.sub.note) +
        '</p>'
      : '';
    return strip || note ? '<div class="wv-foot">' + strip + note + '</div>' : '';
  }

  /* The piece shown, drawn whole: on opening and on moving to another piece or student. */
  function _draw() {
    var r = _read(_v.items[_v.at]);
    if (!r || !r.pages.length) return close();
    _v.shown = r;
    _v.page = Math.max(0, Math.min(_v.page, r.pages.length - 1));
    _pics.releaseAll();
    // html-safe: every name, title and note goes through esc; the rest is fixed markup and numbers
    _v.box.innerHTML = _barHtml(r) + _stageHtml(r) + _footHtml(r);
    var pages = r.pages;
    Array.prototype.forEach.call(
      _v.box.querySelectorAll('.wv-img'),
      function (/** @type {any} */ img, /** @type {number} */ i) {
        img.style.setProperty('--wv-ratio', String(_ratio(pages[i])));
        img.addEventListener('load', _measured);
      },
    );
    _turn();
  }

  /* Once a page is in, its own proportions. @param {Event} e */
  function _measured(e) {
    var img = /** @type {HTMLImageElement} */ (e.target);
    if (img.naturalWidth > 0 && img.naturalHeight > 0)
      img.style.setProperty('--wv-ratio', String(img.naturalWidth / img.naturalHeight));
  }

  /* Shows _v.page: its picture, the counter, the arrows and the strip. Nothing is drawn again. */
  function _turn() {
    var r = _v.shown;
    var n = r.pages.length;
    var p = _v.page;
    var box = _v.box;
    Array.prototype.forEach.call(
      box.querySelectorAll('.wv-img'),
      function (/** @type {any} */ img, /** @type {number} */ i) {
        img.hidden = i !== p;
      },
    );
    Array.prototype.forEach.call(
      box.querySelectorAll('.wv-thumb'),
      function (/** @type {any} */ b, /** @type {number} */ i) {
        b.classList.toggle('is-on', i === p);
        b.setAttribute('aria-current', i === p ? 'page' : 'false');
      },
    );
    var prev = box.querySelector('[data-wv="page"][data-dir="-1"]');
    var next = box.querySelector('[data-wv="page"][data-dir="1"]');
    if (prev) prev.disabled = p === 0;
    if (next) next.disabled = p === n - 1;
    var at = box.querySelector('.wv-at');
    if (at) at.textContent = 'Page ' + (p + 1) + ' of ' + n;
    var it = r.it;
    // The page shown and the ones either side; every page's thumbnail for the strip.
    _pics.fill(box, it.cid, function (/** @type {any} */ img) {
      if (!_v || _v.shown !== r) return null;
      var i = Number(img.getAttribute('data-page'));
      var whole = img.getAttribute('data-work-which') === 'page';
      return !whole || Math.abs(i - _v.page) <= 1 ? r.pages[i] || null : null;
    });
  }

  /** @param {number} dir */
  function _page(dir) {
    var to = _v.page + dir;
    if (to < 0 || to >= _v.shown.pages.length) return;
    _v.page = to;
    _turn();
  }

  /** @param {number} dir */
  function _item(dir) {
    var to = _v.at + dir;
    if (to < 0 || to >= _v.items.length) return;
    _v.at = to;
    _v.page = 0;
    _draw();
    var same = _v && _v.box.querySelector('[data-wv="item"][data-dir="' + dir + '"]');
    if (same && !same.disabled) same.focus();
    else if (_v) _v.box.querySelector('[data-wv="close"]').focus();
  }

  /** @param {MouseEvent} e */
  function _click(e) {
    var t = /** @type {any} */ (e.target);
    var btn = t && t.closest ? t.closest('[data-wv]') : null;
    if (!btn) {
      // The dark around the page closes the view.
      if (t === _v.el || (t && t.hasAttribute && t.hasAttribute('data-wv-stage'))) close();
      return;
    }
    if (btn.disabled) return;
    var what = btn.getAttribute('data-wv');
    var dir = Number(btn.getAttribute('data-dir')) || 0;
    if (what === 'close') return close();
    if (what === 'page') return _page(dir);
    if (what === 'to') return _page(Number(btn.getAttribute('data-page')) - _v.page);
    if (what === 'item') return _item(dir);
    if (what === 'grade') {
      var it = _v.items[_v.at];
      var go = _v.onGrade;
      close(true);
      if (go && it) go(it);
    }
  }

  // First, before the page's own keys (the document, capturing): this view's keys are its own.
  /** @param {KeyboardEvent} e */
  function _key(e) {
    if (!_v || document.querySelector('.confirm-overlay')) return;
    var k = e.key;
    if (k !== 'Escape' && k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'Escape') return close();
    if (k === 'ArrowLeft' || k === 'ArrowRight') return _page(k === 'ArrowLeft' ? -1 : 1);
    // Focus stays in the view.
    var btns = Array.prototype.slice.call(_v.el.querySelectorAll('button:not(:disabled)'));
    var i = btns.indexOf(document.activeElement);
    var to = btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length];
    if (to) to.focus();
  }

  /* A swipe across the page turns it (an iPad). @param {PointerEvent} e */
  function _down(e) {
    if (e.pointerType === 'mouse') return;
    _v.swipe = { x: e.clientX, y: e.clientY };
  }
  /** @param {PointerEvent} e */
  function _up(e) {
    var s = _v && _v.swipe;
    if (!s) return;
    _v.swipe = null;
    var dx = e.clientX - s.x;
    var dy = e.clientY - s.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) _page(dx < 0 ? 1 : -1);
  }

  /** @param {any[]} items @param {number} at @param {any} [opts] */
  function open(items, at, opts) {
    close(true);
    if (!items || !items.length) return;
    opts = opts || {};
    var el = document.createElement('div');
    el.id = 'work-viewer-overlay';
    el.className = 'wv-overlay';
    el.innerHTML = '<div class="wv-box" role="dialog" aria-modal="true" aria-labelledby="wv-title"></div>';
    document.body.appendChild(el);
    _v = {
      el: el,
      box: el.firstChild,
      items: items,
      at: Math.max(0, Math.min(at || 0, items.length - 1)),
      page: opts.page || 0,
      step: opts.step === 'Piece' ? 'Piece' : 'Student',
      onGrade: opts.onGrade || null,
      opener: document.activeElement,
      shown: null,
      swipe: null,
    };
    _pics = WorkThumbs.holder();
    el.addEventListener('click', _click);
    el.addEventListener('pointerdown', _down);
    el.addEventListener('pointerup', _up);
    el.addEventListener('pointercancel', function () {
      if (_v) _v.swipe = null;
    });
    document.addEventListener('keydown', _key, true);
    _draw();
    var first = _v && _v.box.querySelector('[data-wv="close"]');
    if (first) first.focus();
  }

  /** @param {boolean} [quiet] */
  function close(quiet) {
    var v = _v;
    if (!v) return;
    _v = null;
    document.removeEventListener('keydown', _key, true);
    if (_pics) _pics.releaseAll();
    _pics = null;
    v.el.remove();
    if (!quiet && v.opener && v.opener.isConnected && v.opener.focus) v.opener.focus();
  }

  return {
    open: open,
    close: close,
    isOpen: function () {
      return !!_v;
    },
  };
})();
