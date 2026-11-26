// @ts-check
/* dash-inbox.js — the Dashboard's Inbox tile (D4 of
   docs/plans/dashboard-inbox-plan.md, redrawn by
   docs/plans/inbox-redesign-plan.md). It fills the left slot of the middle
   row in a class whose student page and Send Work are on. DashOverview calls
   DashInbox.html(cid); what it shows is DashInboxQueue's.

   Two views, To Grade (key stacks, dash-inbox-stacks.js) and Roll Call (key
   rollcall, dash-inbox-rollcall.js), picked by the switch in the header;
   DashInbox.addView({ key, label, hint, html, header, mount, unmount }) is
   how each registers, so a view is a file and never an edit here. html(cid,
   model, queue) gives the view's body; header(cid, model, queue) the one
   button beside Assignments →; mount(root, cid, model, queue) runs once the
   page is drawn; unmount() before it is drawn again or left. `model` is the
   queue too (the name is kept for DashInboxDrop's sake).

   The Dashboard draws its whole page as one string, so what must outlast a
   draw is kept here, in module state: the view, the list's scroll, and the
   pictures' holder (an address asked for once is kept until the page is
   left).

   page-dashboard.js calls beforeRender, afterRender, click, leave and
   configure; DashOverview's To Grade cell calls jump through click. */
window.DashInbox = (function () {
  'use strict';

  var VIEW_KEY = 'fv-dash-inbox-view:';
  // The switch's order. A view not listed goes last, in the order it was added.
  var VIEW_ORDER = ['stacks', 'rollcall'];
  // How long the ring stays on the tile after To Grade is clicked.
  var RING_MS = 220;

  /** @type {{ read: (k: string) => string | null, write: (k: string, v: string | null) => void }} */
  var _cfg = {
    read: function (k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    write: function (k, v) {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch (e) {
        /* blocked storage: the choice lasts this visit */
      }
    },
  };

  /** @type {any[]} */
  var _views = [];
  /** The queue the tile drew (DashInboxQueue), or null. */
  /** @type {any} */
  var _queue = null;
  /** @type {string | null} */
  var _cid = null;
  /** @type {any} */
  var _pics = null;
  // The list's scroll, kept across a draw.
  var _scroll = 0;
  /** @type {any} */
  var _mounted = null;
  // The class whose tile is on the page now.
  /** @type {string | null} */
  var _drawn = null;
  /** @type {any} */
  var _ringTimer = null;

  /** @param {{ read?: any, write?: any }} o */
  function configure(o) {
    if (o && typeof o.read === 'function') _cfg.read = o.read;
    if (o && typeof o.write === 'function') _cfg.write = o.write;
  }

  /* ── Views ─────────────────────────────────────────────── */
  /** @param {{ key: string, label: string, hint?: string, html: Function, header?: Function, mount?: Function, unmount?: Function }} v */
  function addView(v) {
    if (!v || !v.key) return;
    var at = _views.findIndex(function (x) {
      return x.key === v.key;
    });
    if (at >= 0) _views[at] = v;
    else _views.push(v);
    // The pill's order is fixed, whatever order the scripts load in.
    _views.sort(function (a, b) {
      return _rank(a.key) - _rank(b.key);
    });
  }

  /** @param {string} key */
  function _rank(key) {
    var i = VIEW_ORDER.indexOf(key);
    return i < 0 ? VIEW_ORDER.length : i;
  }

  /** The views the tile offers now.
   * @returns {any[]} */
  function _offered() {
    return _views;
  }

  /** @param {string} cid */
  function viewOf(cid) {
    var saved = _cfg.read(VIEW_KEY + cid);
    var list = _offered();
    return (
      list.filter(function (v) {
        return v.key === saved;
      })[0] || list[0]
    );
  }

  /** @param {string} cid @param {string} key */
  function setView(cid, key) {
    var v = _offered().filter(function (x) {
      return x.key === key;
    })[0];
    if (v) _cfg.write(VIEW_KEY + cid, v.key);
  }

  /* ── Words ─────────────────────────────────────────────── */
  /** Thu 1:05 pm, in the class's own time zone; a month and day past a week.
   * @param {string} cid @param {string} iso */
  function whenText(cid, iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var tz = 'America/Vancouver';
    try {
      var c = /** @type {any} */ (COURSES)[cid];
      if (c && typeof c.timezone === 'string' && c.timezone) tz = c.timezone;
    } catch (e) {
      /* the default zone */
    }
    var parts = /** @type {Record<string, string>} */ ({});
    try {
      var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      fmt.formatToParts(d).forEach(function (p) {
        parts[p.type] = p.value;
      });
    } catch (e) {
      return '';
    }
    var time =
      (parts.hour || '') +
      ':' +
      (parts.minute || '') +
      ' ' +
      String(parts.dayPeriod || '')
        .replace(/\./g, '')
        .toLowerCase();
    var old = Date.now() - d.getTime() > 6 * 86400000;
    // "Thu 1:05 pm"; past a week "Nov 3, 1:05 pm".
    return old ? (parts.month || '') + ' ' + (parts.day || '') + ', ' + time : (parts.weekday || '') + ' ' + time;
  }

  /** A class with nothing to grade: DashInboxDrop's drop area (D5), else one line.
   * @param {string} cid @param {any} model */
  function emptyHtml(cid, model) {
    var drop = /** @type {any} */ (window).DashInboxDrop;
    if (drop) return drop.emptyHtml(cid, model);
    return '<li class="dash-inbox-caught" id="dash-inbox-caught">All Caught Up</li>';
  }

  /* ── The tile ──────────────────────────────────────────── */
  /** Whether the tile takes the slot: the class's student page and Send Work.
   * @param {string} cid */
  function shows(cid) {
    return !!(/** @type {any} */ (window.GraderWork && /** @type {any} */ (window).GraderWork.workOnInClass(cid)));
  }

  /** @param {string} cid */
  function seenOf(cid) {
    return _cfg.read(DashInboxModel.SEEN_KEY + cid);
  }

  /** @param {string} cid
   * @param {{ classCounts?: (cid: string, ids: string[]) => any, bulletins?: boolean }} [ctx] the draw's shared count of the class's work, and whether Bulletins is drawn under the tile
   * @returns {string} */
  function html(cid, ctx) {
    _quiet = false;
    _cid = cid;
    var seen = seenOf(cid);
    var view = viewOf(cid);
    if (!view || !window.DashInboxQueue) return '';
    var queue = (_queue = DashInboxQueue.build(cid, { seen: seen, classCounts: ctx && ctx.classCounts }));
    if (!queue.on) return '';
    // A first look on this device starts the kept time: nothing is new until then.
    if (!seen) _cfg.write(DashInboxModel.SEEN_KEY + cid, new Date().toISOString());
    return _tileHtml(cid, view, queue, ctx);
  }

  /* Nothing waiting (board R5): To Grade, nothing to grade and nothing to
     return. The tile is one 64 px line and Bulletins takes the room; where
     Bulletins is not drawn the tile keeps the column and its body is the
     targets a scan can be dropped on. */
  /** @type {boolean} */
  var _quiet = false;

  /** The targets file, when it is loaded.
   * @returns {any} */
  function _T() {
    return /** @type {any} */ (window).DashInboxTargets;
  }

  /** @param {any} view @param {any} queue */
  function _quietNow(view, queue) {
    return !!(view.key === 'stacks' && queue.on && queue.caughtUp && !(queue.returns && queue.returns.length) && _T());
  }

  /** The one-line tile.
   * @param {string} cid @param {string} swtch @param {any} queue @param {boolean} rest the targets are the body */
  function _quietHtml(cid, swtch, queue, rest) {
    var tick =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.4 8.3 6.9 10.7 11.6 5.6" fill="none" stroke="var(--surface)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var chips = (queue.taking || [])
      .slice(0, 2)
      .map(function (/** @type {any} */ t) {
        return (
          '<button type="button" class="dash-inbox-chip" data-dash-inbox="chip" data-aid="' +
          esc(t.aid) +
          '" aria-label="' +
          esc(t.title + ', ' + t.notin + ' Not In. See Who.') +
          '"><span class="dash-inbox-chip-title">' +
          esc(t.title) +
          '</span><b>' +
          t.notin +
          ' Not In</b></button>'
        );
      })
      .join('');
    return (
      '<section class="dash-inbox is-stacks is-quiet' +
      (rest ? ' is-rest' : '') +
      '" id="dash-inbox" tabindex="-1" aria-labelledby="dash-inbox-title">' +
      '<div class="dash-section-title dash-inbox-head"><h2 class="dash-inbox-title" id="dash-inbox-title">Inbox</h2>' +
      swtch +
      '<span class="dash-inbox-caught-up">' +
      tick +
      'All Caught Up</span>' +
      '<span class="dash-inbox-chips">' +
      chips +
      '</span>' +
      '<button type="button" class="btn dash-inbox-action" data-dash-inbox="targets-open">Add Work</button>' +
      '<a role="link" tabindex="0" data-href="' +
      esc('/assignments?course=' + encodeURIComponent(cid)) +
      '">Assignments →</a></div>' +
      '<div class="dash-inbox-body">' +
      (rest ? _T().html(cid) : '') +
      '</div></section>'
    );
  }

  /** Whether the last draw was the one-line tile (the column sizes itself to it).
   * @returns {boolean} */
  function quiet() {
    return _quiet;
  }

  /** The column's rows as laid out now ('' with no layout, as in a test).
   * @param {Element} col */
  function _rowsOf(col) {
    return typeof getComputedStyle === 'function' ? getComputedStyle(col).gridTemplateRows : '';
  }

  /** The left column glides to the split `change` gives it, in 200 ms (none
   * under reduced motion).
   * @param {() => void} change */
  function glideColumn(change) {
    var col = document.querySelector('.dash-row-left');
    if (!col || _reduced() || !(/** @type {any} */ (col).animate)) return change();
    var from = _rowsOf(col);
    change();
    var to = _rowsOf(col);
    if (from === to) return;
    /** @type {any} */ (col).animate([{ gridTemplateRows: from }, { gridTemplateRows: to }], {
      duration: 200,
      easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    });
  }

  /** The tile: the title, the two-way switch, the link, and the view's one
   * header button.
   * @param {string} cid @param {any} view @param {any} queue
   * @param {{ classCounts?: (cid: string, ids: string[]) => any, bulletins?: boolean } | undefined} ctx
   * @returns {string} */
  function _tileHtml(cid, view, queue, ctx) {
    var list = _offered();
    var swtch =
      '<div class="seg seg-sm dash-inbox-switch" role="group" aria-label="Inbox shows">' +
      list
        .map(function (v) {
          return (
            '<button type="button" class="seg-btn" data-dash-inbox="mode" data-mode="' +
            esc(v.key) +
            '" aria-pressed="' +
            (v.key === view.key) +
            '">' +
            esc(v.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    var quiet = _quietNow(view, queue);
    _quiet = quiet;
    if (quiet) return _quietHtml(cid, swtch, queue, !(ctx && ctx.bulletins));
    var action = view.header ? view.header(cid, queue, queue) : '';
    return (
      '<section class="dash-inbox is-stacks" id="dash-inbox" tabindex="-1" aria-labelledby="dash-inbox-title">' +
      '<div class="dash-section-title dash-inbox-head"><h2 class="dash-inbox-title" id="dash-inbox-title">Inbox</h2>' +
      swtch +
      '<a role="link" tabindex="0" data-href="' +
      esc('/assignments?course=' + encodeURIComponent(cid)) +
      '">Assignments →</a>' +
      action +
      '</div>' +
      '<div class="dash-inbox-body">' +
      view.html(cid, queue, queue) +
      '</div></section>'
    );
  }

  /* ── Drawing: before, after ────────────────────────────── */
  function _reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** @type {ResizeObserver | null} */
  var _fitWatch = null;

  /* The one-line tile's chips: at the window's narrow widths not all fit
     beside the switch, All Caught Up, Add Work and the link. The last chip
     goes first (two, then one, then none); the rest never go. */
  /** @param {HTMLElement} tile */
  function fitChips(tile) {
    if (!tile.classList.contains('is-quiet')) return;
    var head = /** @type {HTMLElement | null} */ (tile.querySelector('.dash-inbox-head'));
    if (!head) return;
    var chips = Array.prototype.slice.call(head.querySelectorAll('.dash-inbox-chip'));
    chips.forEach(function (/** @type {HTMLElement} */ c) {
      c.classList.remove('is-cut');
    });
    var box = head.querySelector('.dash-inbox-chips');
    if (box) box.classList.remove('is-cut');
    var shown = chips.length;
    for (var i = chips.length - 1; i >= 0 && head.scrollWidth > head.clientWidth + 0.5; i--) {
      chips[i].classList.add('is-cut');
      shown--;
      // The empty box has no width but still takes a gap.
      if (!shown && box) box.classList.add('is-cut');
    }
  }

  /** @param {HTMLElement} tile */
  function _watchFit(tile) {
    if (_fitWatch) _fitWatch.disconnect();
    _fitWatch = null;
    fitChips(tile);
    // Only the one-line tile has chips to cut; another draw needs no watch.
    if (typeof ResizeObserver === 'undefined' || !tile.querySelector('.dash-inbox-chip')) return;
    var was = tile.getBoundingClientRect();
    _fitWatch = new ResizeObserver(function () {
      var now = tile.getBoundingClientRect();
      if (Math.abs(now.width - was.width) < 0.5 && Math.abs(now.height - was.height) < 0.5) return;
      was = now;
      fitChips(tile);
    });
    _fitWatch.observe(tile);
  }

  /* Called just before the page is set: what the draw would lose. */
  function beforeRender() {
    if (_fitWatch) _fitWatch.disconnect();
    _fitWatch = null;
    if (_mounted && _mounted.unmount) {
      try {
        _mounted.unmount();
      } catch (e) {
        /* a view's own fault stays its own */
      }
    }
    _mounted = null;
    if (window.DashInboxDrop) DashInboxDrop.unmount();
    if (_T()) _T().unmount();
    var col = document.querySelector('.dash-row-left');
    _colWas = col && document.getElementById('dash-inbox') ? { cid: _drawn, rows: _rowsOf(col) } : null;
    var list = document.getElementById('dash-inbox-list');
    _scroll = list ? list.scrollTop : 0;
  }

  /** The left column's rows as they stood before the draw: the column glides from them.
   * @type {{ cid: string | null, rows: string } | null} */
  var _colWas = null;

  /** The column, drawn with another split (work came in, or went), glides from the old one.
   * @param {string} cid */
  function _glideColumn(cid) {
    var was = _colWas;
    _colWas = null;
    var col = document.querySelector('.dash-row-left');
    if (!was || was.cid !== cid || !col || _reduced() || !(/** @type {any} */ (col).animate)) return;
    var to = _rowsOf(col);
    if (was.rows === to) return;
    /** @type {any} */ (col).animate([{ gridTemplateRows: was.rows }, { gridTemplateRows: to }], {
      duration: 200,
      easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    });
  }

  /* Called once the page is set. */
  /** @param {string} cid */
  function afterRender(cid) {
    var tile = document.getElementById('dash-inbox');
    if (!tile) {
      // No Inbox on this draw: nothing of an earlier one is held.
      if (_pics) _pics.releaseAll();
      _drawn = null;
      return;
    }
    var list = document.getElementById('dash-inbox-list');
    if (list && _drawn === cid) list.scrollTop = _scroll;
    _drawn = cid;
    if (!_pics && window.WorkThumbs) _pics = WorkThumbs.holder();
    _watchFit(tile);
    _glideColumn(cid);
    var view = viewOf(cid);
    _mounted = view;
    if (view.mount) view.mount(tile, cid, _queue, _queue);
    // The new page's pictures are in, the view's own included (it fills them
    // from mount, through pics()); let go of any the old page held alone.
    if (_pics) _pics.sweep();
    // A drop of files anywhere on the tile, in both views (D5).
    // In To Grade the targets take the tile's drag and clicks; D5's page-wide refusal stays.
    var targets = !!(view.key === 'stacks' && _T());
    if (window.DashInboxDrop) DashInboxDrop.mount(tile, cid, _queue, { own: targets });
    if (targets)
      _T().mount(tile, cid, {
        quiet: _quiet && !tile.classList.contains('is-rest'),
        rest: _quiet && tile.classList.contains('is-rest'),
      });
    _fresh(cid);
  }

  /* What came in since the class was read. refreshStudentWork is throttled to
     once in 30 seconds, and when something changed the data layer draws the
     current page again (_invalidateAndRerender), so the Dashboard draws once
     more with the new work. An answer for another class draws nothing of
     its own here, and the next draw is by the class then showing. */
  /** @param {string} cid */
  function _fresh(cid) {
    if (typeof refreshStudentWork === 'function') refreshStudentWork(cid);
  }

  /* ── Leaving ───────────────────────────────────────────── */
  /* The Dashboard is left, or the class changes: the time of this look is
     kept, and the pictures held are let go. */
  /** @param {string} cid */
  function leave(cid) {
    if (cid && shows(cid)) _cfg.write(DashInboxModel.SEEN_KEY + cid, new Date().toISOString());
    if (_mounted && _mounted.unmount) {
      try {
        _mounted.unmount();
      } catch (e) {
        /* its own */
      }
    }
    _mounted = null;
    if (window.DashInboxDrop) DashInboxDrop.leave(cid);
    if (_T()) _T().leave();
    _colWas = null;
    if (_pics) _pics.releaseAll();
    _scroll = 0;
    _drawn = null;
    _queue = null;
    clearTimeout(_ringTimer);
    if (_fitWatch) _fitWatch.disconnect();
    _fitWatch = null;
  }

  /* ── Clicks ────────────────────────────────────────────── */
  /** The Inbox into view, with a ring.
   * @returns {boolean} */
  function jump() {
    var found = document.getElementById('dash-inbox');
    if (!found) return false;
    var tile = found;
    tile.scrollIntoView({ block: 'nearest', behavior: _reduced() ? 'auto' : 'smooth' });
    tile.focus({ preventScroll: true });
    tile.classList.add('is-ring');
    clearTimeout(_ringTimer);
    _ringTimer = setTimeout(function () {
      tile.classList.remove('is-ring');
    }, RING_MS);
    return true;
  }

  /* A click on the tile, or on the top bar's To Grade cell. ctx: { cid,
     redraw }. True when it was the Inbox's. */
  /** @param {MouseEvent} e @param {{ cid: string, redraw: () => void, redrawTile?: () => void }} ctx */
  function click(e, ctx) {
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest) return false;
    var cell = t.closest('[data-dash-inbox-jump]');
    if (cell) {
      // A new tab, as for any link, is the link's own.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return false;
      if (!document.getElementById('dash-inbox')) return false;
      e.preventDefault();
      // To Grade starts the grading: the grader on the first work waiting,
      // carrying on through every assessment (Colin, Nov 25). With nothing
      // to grade it shows the Inbox, where what is left to return sits.
      var S = /** @type {any} */ (window).DashInboxStacks;
      var after = function () {
        if (document.querySelector('#main .dash-glance')) ctx.redraw();
      };
      if (S && S.start && S.start(ctx.cid, after)) return true;
      return jump();
    }
    var el = t.closest('[data-dash-inbox]');
    if (!el || !document.getElementById('dash-inbox')) return false;
    var cid = ctx.cid;
    var aid = el.getAttribute('data-aid');
    // A dialog from the tile closed: draw again if the Dashboard is still the page shown.
    var redraw = function () {
      if (document.querySelector('#main .dash-glance')) ctx.redraw();
    };
    var kind = el.getAttribute('data-dash-inbox') || '';
    if (kind === 'mode') {
      setView(cid, el.getAttribute('data-mode') || '');
      (ctx.redrawTile || redraw)();
      return true;
    }
    if (kind === 'targets-open' || kind === 'targets-close' || kind === 'target' || kind === 'target-other') {
      var T = /** @type {any} */ (window).DashInboxTargets;
      return !!T && T.click(el, { cid: cid, redraw: redraw });
    }
    if (kind === 'chip') {
      var RC = /** @type {any} */ (window).DashInboxRollCall;
      if (RC && RC.show) RC.show(cid, aid);
      return true;
    }
    if (kind === 'start' || kind === 'returnall' || kind.indexOf('stack-') === 0) {
      var S = /** @type {any} */ (window).DashInboxStacks;
      return !!S && S.click(el, { cid: cid, redraw: redraw, redrawTile: ctx.redrawTile || redraw });
    }
    if (el.getAttribute('data-dash-inbox') === 'wall') {
      if (window.WorkWall) WorkWall.open(cid, aid, { onClose: redraw });
      return true;
    }
    return false;
  }

  var api = {
    configure: configure,
    addView: addView,
    setView: setView,
    viewOf: viewOf,
    shows: shows,
    html: html,
    emptyHtml: emptyHtml,
    beforeRender: beforeRender,
    afterRender: afterRender,
    leave: leave,
    jump: jump,
    click: click,
    quiet: quiet,
    glideColumn: glideColumn,
    whenText: whenText,
    /* The tile's picture holder, for a view that shows pictures (D6). The
       contract every view follows:
       - Fill your pictures synchronously inside mount(): afterRender sweeps
         the holder right after mount, and anything no img on the page shows
         by then is let go (and asked for again later).
       - Key your pictures so another class's keys cannot match (the To
         Grade stacks key theirs by assessment; an aid is unique to its
         class).
       - Never keep a holder of your own: this one lives across the
         Dashboard's redraws, which is what stops a picture being asked for
         twice. It is null until the tile has drawn once. */
    pics: function () {
      return _pics;
    },
    model: function () {
      return _queue;
    },
  };
  return api;
})();
