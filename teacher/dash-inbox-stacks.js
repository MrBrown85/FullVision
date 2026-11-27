// @ts-check
/* dash-inbox-stacks.js — the redrawn Inbox's To Grade view (slice I1 of
   docs/plans/inbox-redesign-plan.md; board R1, R2 and R4). Behind the build
   switch inboxStacks: DashInbox draws this view only with the switch on.

   One stack per assessment with work to grade (newest work first): the top
   page, layers behind it that grow with the count (four at most), the count,
   a dot when a student sent work since the last look, Late when any waiting
   work is late, and the title under it. A click spreads the stack in place
   (R2): its pages with name and time, then Not In names, the other stacks
   pushed along. A click on a page opens the grader on that student with the
   whole queue. A graded pile lies face down with Return N (R1, R4).

   Every count and name is DashInboxQueue's, which is GraderWork's. The
   Dashboard draws its whole page as one string, so what must outlast a draw
   (the open stack, the scroll) is kept here. Motion: opening, closing and
   the stacks moving along glide in 200 ms (none under reduced motion);
   nothing fades in. */
window.DashInboxStacks = (function () {
  'use strict';

  // A stack's width is this much of its height; a page's is this much of its own.
  var STACK_H = 216;
  var MIN_SH = 110;
  var MIN_PH = 80;
  var MAX_LAYERS = 4;
  var MS = 200;

  /** What outlasts a draw: the open stack, where the scrolls stood, what to
   * focus and where things stood before the click that is being drawn.
   * @type {{ cid: string, open: string | null, row: number, pages: number, focus: string | null,
   *   flip: Record<string, { x: number, y: number }> | null, opened: string | null }} */
  var _st = { cid: '', open: null, row: 0, pages: 0, focus: null, flip: null, opened: null };
  /** @type {Record<string, any>} */
  var _files = {};
  /** @type {any} */
  var _queue = null;
  /** @type {(() => void) | null} */
  var _undo = null;

  var TICK =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.4 8.3 6.9 10.7 11.6 5.6" fill="none" stroke="var(--surface)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLOSE =
    '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /** @param {string} cid @param {string} iso */
  function _when(cid, iso) {
    return window.DashInbox && iso ? DashInbox.whenText(cid, iso) : '';
  }

  /** "Aiden Wong" → "Aiden W." for a name chip; the full name stays in its title.
   * @param {string} name */
  function _short(name) {
    var p = String(name || '')
      .trim()
      .split(/\s+/);
    return p.length > 1 ? p[0] + ' ' + p[p.length - 1].charAt(0).toUpperCase() + '.' : p[0] || '';
  }

  /** @param {string} cid @param {string} aid @param {string} sid @param {any} file */
  function _keep(cid, aid, sid, file) {
    var key = cid + '|' + aid + '|' + sid + '|' + file.id;
    _files[key] = file;
    return key;
  }

  /* ── Drawing ───────────────────────────────────────────── */
  /** What a stack's top sheet shows: the page, a paper hand-in, or a lined sheet.
   * @param {string} cid @param {string} aid @param {any} top */
  function _sheetInner(cid, aid, top) {
    if (top && top.file)
      return (
        '<img class="dash-inbox-stack-img" draggable="false" data-work-pic data-dash-stack-pic="' +
        esc(_keep(cid, aid, top.sid, top.file)) +
        '" alt="" decoding="async">'
      );
    if (top && top.paper)
      return '<span class="dash-inbox-stack-note">' + esc(top.name) + '<span>Handed In on Paper</span></span>';
    return '<span class="dash-inbox-stack-lines" aria-hidden="true"></span>';
  }

  /** @param {string} cid @param {any} s */
  function _stackHtml(cid, s) {
    var layers = Math.min(MAX_LAYERS, Math.max(0, s.tograde - 1));
    var back = '';
    for (var k = layers; k >= 1; k--) back += '<span class="dash-inbox-stack-layer" style="--k:' + k + '"></span>';
    var label =
      s.title +
      ', ' +
      s.tograde +
      ' to grade' +
      (s.isNew ? ', new work' : '') +
      (s.late ? ', late' : '') +
      '. Open this stack.';
    return (
      '<div class="dash-inbox-stack-group" data-flip="' +
      esc(s.aid) +
      '"><button type="button" class="dash-inbox-stack" style="--n:' +
      layers +
      '" data-dash-inbox="stack-open" data-aid="' +
      esc(s.aid) +
      '" aria-expanded="false" aria-label="' +
      esc(label) +
      '">' +
      back +
      '<span class="dash-inbox-stack-sheet">' +
      _sheetInner(cid, s.aid, s.top) +
      (s.late ? '<span class="dash-inbox-stack-late">Late</span>' : '') +
      '</span><span class="dash-inbox-stack-count" aria-hidden="true">' +
      s.tograde +
      '</span></button><div class="dash-inbox-stack-cap">' +
      (s.isNew ? '<span class="dash-inbox-stack-dot" role="img" aria-label="New work"></span>' : '') +
      '<button type="button" class="dash-inbox-stack-title" data-dash-inbox="wall" data-aid="' +
      esc(s.aid) +
      '">' +
      esc(s.title) +
      '</button></div></div>'
    );
  }

  /** @param {string} cid @param {string} aid @param {any} it */
  function _pageHtml(cid, aid, it) {
    var label =
      it.name + (it.pages > 1 ? ', ' + it.pages + ' pages' : '') + (it.late ? ', late' : '') + '. Open in the grader.';
    var face = it.file
      ? '<img class="dash-inbox-stack-img" draggable="false" data-work-pic data-dash-stack-pic="' +
        esc(_keep(cid, aid, it.sid, it.file)) +
        '" alt="" decoding="async">'
      : it.paper
        ? '<span class="dash-inbox-stack-note">' + esc(it.name) + '<span>Handed In on Paper</span></span>'
        : '<span class="dash-inbox-stack-lines" aria-hidden="true"></span>';
    var when = _when(cid, it.at);
    return (
      '<li><button type="button" class="dash-inbox-page" data-dash-inbox="stack-page" data-aid="' +
      esc(aid) +
      '" data-sid="' +
      esc(it.sid) +
      '" aria-label="' +
      esc(label) +
      '"><span class="dash-inbox-page-sheet">' +
      face +
      (it.pages > 1 ? '<span class="dash-inbox-page-count">' + it.pages + ' pages</span>' : '') +
      '</span><span class="dash-inbox-page-name">' +
      esc(it.name) +
      '</span><span class="dash-inbox-page-when">' +
      esc(when) +
      (it.late ? (when ? ' · ' : '') + '<span class="dash-inbox-late">Late</span>' : '') +
      '</span></button></li>'
    );
  }

  /** The stack opened: its pages, then Not In.
   * @param {string} cid @param {any} s */
  function _spreadHtml(cid, s) {
    var o = DashInboxQueue.open(cid, s.aid);
    var rc = !!(/** @type {any} */ (window).DashInboxRollCall);
    var notIn = o.notIn.length
      ? '<div class="dash-inbox-notin"><h3 class="dash-inbox-notin-head">' +
        (rc
          ? '<button type="button" class="dash-inbox-notin-link" data-dash-inbox="stack-notin" data-aid="' +
            esc(s.aid) +
            '">Not In</button>'
          : 'Not In') +
        ' <span class="dash-inbox-notin-n">' +
        o.notIn.length +
        '</span></h3><div class="dash-inbox-notin-chips">' +
        o.notIn
          .map(function (/** @type {any} */ n) {
            return (
              '<button type="button" class="dash-inbox-notin-chip" data-dash-inbox="' +
              (rc ? 'stack-notin-st' : 'stack-notin') +
              '" data-aid="' +
              esc(s.aid) +
              '" data-sid="' +
              esc(n.sid) +
              '" aria-haspopup="menu" title="' +
              esc(n.name) +
              '">' +
              esc(_short(n.name)) +
              '</button>'
            );
          })
          .join('') +
        '</div></div>'
      : '';
    return (
      '<section class="dash-inbox-spread" data-flip="' +
      esc(s.aid) +
      '" aria-label="' +
      esc(s.title + ': work to grade') +
      '"><div class="dash-inbox-spread-head"><button type="button" class="dash-inbox-spread-title" data-dash-inbox="wall" data-aid="' +
      esc(s.aid) +
      '">' +
      esc(s.title) +
      '</button><button type="button" class="dash-inbox-spread-close" data-dash-inbox="stack-close" data-aid="' +
      esc(s.aid) +
      '" aria-label="Close this stack">' +
      CLOSE +
      '</button></div><div class="dash-inbox-spread-body"><ul class="dash-inbox-pages" id="dash-inbox-pages">' +
      o.items
        .map(function (/** @type {any} */ it) {
          return _pageHtml(cid, s.aid, it);
        })
        .join('') +
      '</ul>' +
      notIn +
      '</div></section>'
    );
  }

  /** A graded pile, face down, with its count and Return N.
   * @param {any} r @param {boolean} solid */
  function _returnHtml(r, solid) {
    return (
      '<div class="dash-inbox-return"><div class="dash-inbox-return-back" role="img" aria-label="' +
      esc(r.toreturn + ' graded, to return') +
      '"><span class="dash-inbox-stack-layer" style="--k:2"></span><span class="dash-inbox-stack-layer" style="--k:1"></span><span class="dash-inbox-return-face">' +
      TICK +
      '</span><span class="dash-inbox-return-count" aria-hidden="true">' +
      r.toreturn +
      '</span></div><button type="button" class="dash-inbox-stack-title" data-dash-inbox="wall" data-aid="' +
      esc(r.aid) +
      '">' +
      esc(r.title) +
      '</button><button type="button" class="dash-inbox-return-btn' +
      (solid ? ' is-solid' : '') +
      '" data-dash-inbox="stack-return" data-aid="' +
      esc(r.aid) +
      '">Return ' +
      r.toreturn +
      '</button></div>'
    );
  }

  /** The view's header button: Start Grading while work waits, else Return All N
   * when more than one assessment has graded work.
   * @param {string} cid @param {any} model @param {any} queue */
  function headerHtml(cid, model, queue) {
    var q = queue || DashInboxQueue.build(cid, {});
    if (!q.on) return '';
    if (q.stacks.length)
      return '<button type="button" class="btn dash-inbox-action is-start" data-dash-inbox="start">Start Grading</button>';
    if (q.returns.length > 1)
      return (
        '<button type="button" class="btn dash-inbox-action is-return" data-dash-inbox="returnall">Return All ' +
        q.toReturn +
        '</button>'
      );
    return '';
  }

  /** @param {string} cid @param {any} model @param {any} queue
   * @returns {string} */
  function html(cid, model, queue) {
    _files = {};
    var q = (_queue = queue || DashInboxQueue.build(cid, {}));
    if (_st.cid !== cid) _st = { cid: cid, open: null, row: 0, pages: 0, focus: null, flip: null, opened: null };
    if (!q.on) return '';
    if (!q.stacks.length && !q.returns.length)
      return '<ul class="dash-inbox-list" id="dash-inbox-list">' + DashInbox.emptyHtml(cid, model) + '</ul>';
    // An open stack whose work is all graded is let go.
    if (
      _st.open &&
      !q.stacks.some(function (/** @type {any} */ s) {
        return s.aid === _st.open;
      })
    )
      _st.open = null;
    var open = _st.open;
    var cards = q.stacks
      .map(function (/** @type {any} */ s) {
        return s.aid === open ? _spreadHtml(cid, s) : _stackHtml(cid, s);
      })
      .join('');
    var solo = !q.stacks.length;
    var returns = q.returns.length
      ? '<div class="dash-inbox-returns' +
        (solo ? ' is-solo' : '') +
        '">' +
        q.returns
          .map(function (/** @type {any} */ r) {
            return _returnHtml(r, !solo);
          })
          .join('') +
        '</div>'
      : '';
    return (
      '<div class="dash-inbox-stacks' +
      (open ? ' has-open' : '') +
      '" id="dash-inbox-stacks"><div class="dash-inbox-stacks-row" id="dash-inbox-stacks-row">' +
      ('<div class="dash-inbox-stacks-cards">' + cards + '</div>') +
      returns +
      '</div></div>'
    );
  }

  /* ── Mounted: sizes, pictures, motion, keys ────────────── */
  /** @returns {boolean} */
  function _reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Closed: one steady size, one row in the tile's share of the column, whatever the count (Colin, Nov 26). Opened: as tall as the tile allows, shrinking to fit across. @param {HTMLElement} el */
  function _size(el) {
    var avail = el.clientHeight;
    if (!avail) return;
    var solo = !!el.querySelector('.dash-inbox-returns.is-solo'),
      open = el.classList.contains('has-open');
    var col = /** @type {HTMLElement} */ (el.closest('.dash-row-left') || el);
    var sh = open ? avail - 76 : (col.clientHeight - 12) * (col.classList.contains('has-bulletins') ? 0.6 : 1) - 192;
    if (open && el.querySelector('.dash-inbox-return'))
      sh = Math.min(sh, (avail - (solo ? 120 : 140)) / (solo ? 0.9 : 0.8));
    sh = Math.max(open ? MIN_SH : 96, Math.min(STACK_H, Math.floor(sh)));
    var ph = Math.max(MIN_PH, Math.min(Math.round(STACK_H * 0.8), Math.floor(avail - 140)));
    el.style.setProperty('--dash-inbox-ph', ph + 'px');
    el.style.setProperty('--dash-inbox-sh', sh + 'px');
    var row = /** @type {HTMLElement} */ (el.querySelector('#dash-inbox-stacks-row'));
    while (open && row && sh > MIN_SH && row.scrollWidth - row.clientWidth > 1) {
      sh = Math.max(MIN_SH, sh - 8);
      el.style.setProperty('--dash-inbox-sh', sh + 'px');
    }
    var cards = row && row.firstElementChild; // closed, the stacks scroll by themselves; Return stays put
    if (cards) row.classList.toggle('is-more', !open && cards.scrollHeight - cards.clientHeight > 12);
  }

  /** Whether a picture is wanted now: a stack's top page, or an opened page
   * in or near the pages' view.
   * @param {HTMLElement} scroller @param {HTMLElement} img */
  function _wanted(scroller, img) {
    var inPages = img.closest('.dash-inbox-pages');
    if (!inPages) return true;
    var a = scroller.getBoundingClientRect();
    var b = img.getBoundingClientRect();
    return b.right > a.left - 400 && b.left < a.right + 400;
  }

  /** @param {Element} root @param {string} cid */
  function _fill(root, cid) {
    var pics = window.DashInbox && DashInbox.pics();
    var el = /** @type {HTMLElement | null} */ (root.querySelector('#dash-inbox-stacks'));
    if (!pics || !el) return;
    el.querySelectorAll('img[data-dash-stack-pic]:not([src])').forEach(function (img) {
      img.setAttribute('data-work-which', 'page');
      img.setAttribute('data-work-first', 'thumb');
    });
    var scroller = /** @type {HTMLElement} */ (el.querySelector('#dash-inbox-pages') || el);
    pics.fill(el, cid, function (/** @type {HTMLElement} */ img) {
      var f = _files[img.getAttribute('data-dash-stack-pic') || ''];
      if (!f) return null;
      if (img.getAttribute('data-dash-asked')) return f;
      if (!_wanted(scroller, img)) return null;
      img.setAttribute('data-dash-asked', '1');
      return f;
    });
  }

  /** Where each stack and the opened box stand, from the tile's own corner.
   * @param {Element} root
   * @returns {Record<string, { x: number, y: number }>} */
  function _positions(root) {
    /** @type {Record<string, { x: number, y: number }>} */
    var at = {};
    var o = root.getBoundingClientRect();
    root.querySelectorAll('[data-flip]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      at[el.getAttribute('data-flip') || ''] = { x: r.left - o.left, y: r.top - o.top };
    });
    return at;
  }

  /** What stood where before the click being drawn glides from there.
   * @param {Element} root */
  function _glide(root) {
    var was = _st.flip;
    var opened = _st.opened;
    _st.flip = null;
    _st.opened = null;
    if (!was || _reduced()) return;
    var o = root.getBoundingClientRect();
    root.querySelectorAll('[data-flip]').forEach(function (/** @type {any} */ el) {
      var key = el.getAttribute('data-flip') || '';
      var from = was && was[key];
      if (!from || !el.animate) return;
      var r = el.getBoundingClientRect();
      var dx = from.x - (r.left - o.left);
      var dy = from.y - (r.top - o.top);
      var opts = { duration: MS, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' };
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)
        el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], opts);
      // The stack spreads where it stood: a reveal from its own edge, not a fade.
      if (opened && key === opened && el.classList.contains('dash-inbox-spread'))
        el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], opts);
    });
  }

  function _redrawNow() {
    var PD = /** @type {any} */ (window).PageDashboard;
    if (document.querySelector('#main .dash-glance') && PD) PD.render();
  }

  /** Open a stack (or close the one open) and draw again, gliding.
   * @param {string} cid @param {string | null} aid @param {() => void} redraw */
  function _set(cid, aid, redraw) {
    var tile = document.getElementById('dash-inbox');
    var was = _st.open;
    _st.flip = tile ? _positions(tile) : null;
    _st.open = aid;
    _st.opened = aid;
    _st.pages = 0;
    // Opening puts the focus on the first page; closing puts it back on the stack.
    _st.focus = aid ? 'page' : was ? 'stack:' + was : null;
    redraw();
  }

  /** @param {Element} root @param {string} cid */
  function mount(root, cid) {
    unmount();
    var el = /** @type {HTMLElement | null} */ (root.querySelector('#dash-inbox-stacks'));
    if (!el) return;
    var row = /** @type {HTMLElement | null} */ (el.querySelector('#dash-inbox-stacks-row'));
    var pages = /** @type {HTMLElement | null} */ (el.querySelector('#dash-inbox-pages'));
    _size(el);
    if (row) row.scrollLeft = _st.row;
    if (pages) pages.scrollLeft = _st.pages;
    // A stack just opened is brought into view whole.
    var spread = /** @type {HTMLElement | null} */ (el.querySelector('.dash-inbox-spread'));
    if (row && spread && _st.opened === _st.open) {
      var edge = parseFloat(getComputedStyle(row).paddingRight) || 0;
      var over = spread.offsetLeft + spread.offsetWidth + edge - (row.scrollLeft + row.clientWidth);
      // Where it does not fit beside the stacks before it, those scroll off whole.
      if (over > 0 || spread.offsetLeft < row.scrollLeft) row.scrollLeft = Math.max(0, spread.offsetLeft - 4);
    }
    _fill(root, cid);
    _glide(root);

    var focus = _st.focus;
    var tiles = el;
    _st.focus = null;
    if (focus === 'page') {
      var first = /** @type {HTMLElement | null} */ (el.querySelector('.dash-inbox-page'));
      if (first) first.focus({ preventScroll: true });
    } else if (focus && focus.indexOf('stack:') === 0) {
      var back = Array.prototype.filter.call(
        el.querySelectorAll('.dash-inbox-stack'),
        function (/** @type {Element} */ b) {
          return b.getAttribute('data-aid') === String(focus).slice(6);
        },
      )[0];
      if (back) /** @type {HTMLElement} */ (back).focus({ preventScroll: true });
    }

    var frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        _fill(root, cid);
      });
    }
    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented || !_st.open || document.getElementById('grader-overlay')) return;
      if (!tiles.isConnected) return;
      e.preventDefault();
      e.stopPropagation();
      _set(cid, null, _redrawNow);
    }
    if (pages) pages.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', /** @type {EventListener} */ (onKey));
    /** @type {ResizeObserver | null} */
    var watch = null;
    if (typeof ResizeObserver !== 'undefined') {
      var was = -1; // the first report sizes it again once it is on the page and the column can be measured
      watch = new ResizeObserver(function () {
        if (Math.abs(tiles.clientHeight - was) < 1) return;
        was = tiles.clientHeight;
        _size(tiles);
      });
      watch.observe(tiles);
    }
    _undo = function () {
      // The scrolls as they stand, before the page is drawn again.
      if (row && row.isConnected) _st.row = row.scrollLeft;
      if (pages && pages.isConnected) _st.pages = pages.scrollLeft;
      if (pages) pages.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', /** @type {EventListener} */ (onKey));
      if (watch) watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }

  function unmount() {
    if (_undo) _undo();
    _undo = null;
  }

  /* ── Clicks ────────────────────────────────────────────── */
  /** Open the grader on one piece's student, with the whole queue behind it.
   * @param {string} cid @param {string} aid @param {string} sid @param {() => void} redraw */
  function _grade(cid, aid, sid, redraw) {
    var PA = /** @type {any} */ (window).PageAssignments;
    if (!PA || !PA.openGrader) return;
    var queue = DashInboxQueue.order(cid);
    var mine = queue.filter(function (q) {
      return q.aid === aid;
    })[0];
    var ids = mine && mine.studentIds.length ? mine.studentIds : [sid];
    // The grader carries on from the piece clicked, then round to the stacks
    // before it, so it reaches All Caught Up only when nothing is left.
    var at = queue.indexOf(mine);
    if (at > 0) queue = queue.slice(at).concat(queue.slice(0, at));
    PA.openGrader(cid, aid, sid, { studentIds: ids, show: 'tograde', onClose: redraw, queue: queue });
  }

  /** Start Grading, and the top bar's To Grade: the grader on the first work
   * waiting, with the whole Inbox behind it. False when nothing waits.
   * @param {string} cid @param {() => void} redraw
   * @returns {boolean} */
  function start(cid, redraw) {
    var first = DashInboxQueue.order(cid)[0];
    if (!first || !first.studentIds.length) return false;
    _grade(cid, first.aid, first.studentIds[0], redraw);
    return true;
  }

  /** A click on one of the view's controls. el carries data-dash-inbox;
   * ctx is { cid, redraw }. True when it was this view's.
   * @param {Element} el @param {{ cid: string, redraw: () => void, redrawTile?: () => void }} ctx
   * @returns {boolean} */
  function click(el, ctx) {
    var kind = el.getAttribute('data-dash-inbox') || '';
    var aid = el.getAttribute('data-aid') || '';
    var cid = ctx.cid;
    var RC = /** @type {any} */ (window).DashInboxRollCall;
    var PA = /** @type {any} */ (window).PageAssignments;
    if (kind === 'stack-open') {
      _set(cid, _st.open === aid ? null : aid, ctx.redrawTile || ctx.redraw);
      return true;
    }
    if (kind === 'stack-close') {
      _set(cid, null, ctx.redrawTile || ctx.redraw);
      return true;
    }
    if (kind === 'stack-page') {
      _grade(cid, aid, el.getAttribute('data-sid') || '', ctx.redraw);
      return true;
    }
    // A name in Not In: Roll Call's menu for that student, in place.
    if (kind === 'stack-notin-st') {
      var host = /** @type {HTMLElement | null} */ (el.closest('.dash-inbox-spread'));
      if (!host || !RC || !RC.menuOn) return true;
      var ids = DashInboxQueue.open(cid, aid).notIn.map(function (/** @type {any} */ n) {
        return n.sid;
      });
      RC.menuOn(host, /** @type {HTMLElement} */ (el), cid, aid, el.getAttribute('data-sid') || '', ids, ctx.redraw);
      return true;
    }
    if (kind === 'stack-notin') {
      if (RC && RC.show) RC.show(cid, aid);
      return true;
    }
    if (kind === 'start') {
      start(cid, ctx.redraw);
      return true;
    }
    if (kind === 'stack-return' || kind === 'returnall') {
      var q = DashInboxQueue.build(cid, {});
      var aids = kind === 'returnall' ? q.returns.map((/** @type {any} */ r) => r.aid) : [aid];
      if (PA && PA.askReturn && aids.length) PA.askReturn(cid, aids, el, ctx.redraw);
      return true;
    }
    return false;
  }

  if (window.DashInbox) {
    DashInbox.addView({
      key: 'stacks',
      label: 'To Grade',
      hint: 'One stack per assessment with work to grade.',
      html: html,
      header: headerHtml,
      mount: mount,
      unmount: unmount,
    });
  }

  return {
    html: html,
    headerHtml: headerHtml,
    mount: mount,
    start: start,
    unmount: unmount,
    click: click,
    state: function () {
      return { cid: _st.cid, open: _st.open };
    },
    reset: function () {
      _st = { cid: '', open: null, row: 0, pages: 0, focus: null, flip: null, opened: null };
    },
  };
})();
