// @ts-check
/* dash-inbox.js — the Dashboard's Inbox tile (D4 of
   docs/plans/dashboard-inbox-plan.md; boards C0, C1 and E2). It fills the
   left slot of the middle row in a class whose student page and Send Work
   are on, behind the dashRow build switch. DashOverview calls
   DashInbox.html(cid); everything it shows is DashInboxModel's.

   Views: DashInbox.addView({ key, label, hint, html, mount, unmount }), so a
   later slice adds a file and never edits this one. This slice registers
   By Assessment only. html(cid, model) gives the view's body; mount(root,
   cid, model) runs once the page is drawn; unmount() before it is drawn
   again or left.

   The Dashboard draws its whole page as one string, so what must outlast a
   draw is kept here, in module state: the view, the list's scroll, where
   each row and picture stood (rows glide from there), and the pictures'
   holder (an address asked for once is kept until the page is left).

   page-dashboard.js calls beforeRender, afterRender, click, leave and
   configure; DashOverview's To Grade cell calls jump through click. */
window.DashInbox = (function () {
  'use strict';

  var VIEW_KEY = 'fv-dash-inbox-view:';
  var MAX_NAMES = 2;
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
  /** @type {any} */
  var _model = null;
  /** @type {string | null} */
  var _cid = null;
  // The picture lookups for the page last drawn: data-dash-pic → file.
  /** @type {Record<string, any>} */
  var _files = {};
  /** @type {any} */
  var _pics = null;
  // The list's scroll and where rows and pictures stood, kept across a draw.
  var _scroll = 0;
  /** @type {{ cid: string, at: Record<string, { x: number, y: number }> } | null} */
  var _snap = null;
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
  /** @param {{ key: string, label: string, hint?: string, html: Function, mount?: Function, unmount?: Function }} v */
  function addView(v) {
    if (!v || !v.key) return;
    var at = _views.findIndex(function (x) {
      return x.key === v.key;
    });
    if (at >= 0) _views[at] = v;
    else _views.push(v);
  }

  /** @param {string} cid */
  function viewOf(cid) {
    var saved = _cfg.read(VIEW_KEY + cid);
    return (
      _views.filter(function (v) {
        return v.key === saved;
      })[0] || _views[0]
    );
  }

  /** @param {string} cid @param {string} key */
  function setView(cid, key) {
    var v = _views.filter(function (x) {
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

  /** "closes Fri" for a day, or ''.
   * @param {string} day */
  function untilText(day) {
    var d = new Date(day + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return 'open until ' + d.toLocaleDateString('en-CA', { weekday: 'short' });
  }

  /** The counts line: "6 in · 4 to grade · 20 not in · 2 to return".
   * @param {any} p */
  function countsHtml(p) {
    var parts = [
      '<span class="dash-inbox-n">' + p.in + '</span> in',
      '<span class="dash-inbox-n">' + p.tograde + '</span> to grade',
      '<span class="dash-inbox-n">' + p.notin + '</span> not in',
    ];
    if (p.toreturn) parts.push('<span class="dash-inbox-n">' + p.toreturn + '</span> to return');
    var line = parts.join(' · ');
    var quiet = [];
    if (p.addedByTeacher) quiet.push('You Added ' + p.addedByTeacher);
    if (p.onPaper) quiet.push(p.onPaper + ' on paper');
    // Late comes straight after the counts, before the quiet words, so a
    // line too long for its box loses the quiet words first, never Late.
    var out = '<span class="dash-inbox-main">' + line + '</span>';
    // html-safe: numbers and fixed words
    if (p.late) out += '<span class="dash-inbox-late">· Late ' + p.late + '</span>';
    if (quiet.length) out += '<span class="dash-inbox-quiet">· ' + quiet.join(' · ') + '</span>';
    return out;
  }

  /** The text form of the counts line, for the row's name and tests.
   * @param {any} p */
  function countsText(p) {
    var s = p.in + ' in · ' + p.tograde + ' to grade · ' + p.notin + ' not in';
    if (p.toreturn) s += ' · ' + p.toreturn + ' to return';
    return s;
  }

  /* ── One picture ───────────────────────────────────────── */
  /** @param {string} cid @param {string} aid @param {any} pg */
  function picHtml(cid, aid, pg) {
    if (pg.paper) {
      return (
        '<span class="dash-inbox-pic dash-inbox-sheet" role="img" aria-label="' +
        esc(pg.name + ': Handed In on Paper') +
        '"><span class="dash-inbox-sheet-name">' +
        esc(pg.name) +
        '</span><span class="dash-inbox-sheet-note">Handed In on Paper</span></span>'
      );
    }
    var key = aid + '|' + pg.sid + '|' + pg.file.id;
    _files[key] = pg.file;
    return (
      '<span class="dash-inbox-pic" data-pic-key="' +
      esc(key) +
      '"><img class="dash-inbox-img" draggable="false" data-work-pic data-dash-pic="' +
      esc(key) +
      '" alt="' +
      esc(pg.name + "'s first page") +
      '" decoding="async"></span>'
    );
  }

  /** @param {string} cid @param {any} p */
  function rowHtml(cid, p) {
    if (!p.in && !p.tograde) return slimRowHtml(cid, p);
    var pics = p.pages.length
      ? p.pages
          .map(function (/** @type {any} */ pg) {
            return picHtml(cid, p.aid, pg);
          })
          .join('')
      : '<span class="dash-inbox-pic dash-inbox-sheet"><span class="dash-inbox-sheet-note">No Pages</span></span>';
    var first = p.newest[0];
    return (
      '<li class="dash-inbox-row" data-aid="' +
      esc(p.aid) +
      '"><div class="dash-inbox-pics">' +
      pics +
      (p.newCount ? '<span class="dash-inbox-new">+' + p.newCount + '</span>' : '') +
      '</div><div class="dash-inbox-info"><button type="button" class="dash-inbox-name" data-dash-inbox="wall" data-aid="' +
      esc(p.aid) +
      '" aria-label="' +
      esc(p.title + ': open the Work Wall. ' + countsText(p)) +
      '">' +
      esc(p.title) +
      '</button><p class="dash-inbox-counts">' +
      countsHtml(p) +
      '</p>' +
      (first
        ? '<p class="dash-inbox-newest">Newest: ' + esc(first.name) + ', ' + esc(whenText(cid, first.at)) + '</p>'
        : '') +
      '</div><button type="button" class="dash-inbox-grade" data-dash-inbox="grade" data-aid="' +
      esc(p.aid) +
      '">Grade Submissions</button></li>'
    );
  }

  /** A piece taking work with nothing in yet: two lines.
   * @param {string} cid @param {any} p */
  function slimRowHtml(cid, p) {
    var until = p.closesOn ? untilText(p.closesOn) : '';
    return (
      '<li class="dash-inbox-row is-slim" data-aid="' +
      esc(p.aid) +
      '"><div class="dash-inbox-info"><button type="button" class="dash-inbox-name" data-dash-inbox="wall" data-aid="' +
      esc(p.aid) +
      '">' +
      esc(p.title) +
      '</button><p class="dash-inbox-counts"><span class="dash-inbox-main">Nothing in yet' +
      (until ? ' · ' + esc(until) : '') +
      '</span></p></div></li>'
    );
  }

  /** The busy day's line (board E2).
   * @param {string} cid @param {any} f */
  function foldHtml(cid, f) {
    var s = [];
    var names = f.withStudents;
    if (names.length) {
      var shown = names.slice(0, MAX_NAMES).map(function (/** @type {any} */ n) {
        return esc(n.title) + ' (' + n.tograde + ' to grade)';
      });
      var more = names.length - shown.length;
      s.push(
        names.length + ' more with work: ' + shown.join(' and ') + (more > 0 ? ' and ' + more + ' more' : '') + '.',
      );
    }
    if (f.youAdded.work) {
      s.push(
        'You added ' +
          f.youAdded.work +
          ' pieces of work with Add Work for the Class, in ' +
          f.youAdded.pieces +
          ' more assessments.',
      );
    }
    if (!s.length && f.pieces) s.push(f.pieces + ' more pieces with work (' + f.work + ' pieces of work).');
    return (
      '<li class="dash-inbox-fold"><span class="dash-inbox-fold-text">' +
      s.join(' ') +
      '</span> <a role="link" tabindex="0" data-href="' +
      esc('/assignments?course=' + encodeURIComponent(cid) + '&show=tograde') +
      '">Open in Assignments →</a></li>'
    );
  }

  /** A class with nothing to grade: DashInboxDrop's drop area (D5), else one line.
   * @param {string} cid @param {any} model */
  function emptyHtml(cid, model) {
    var drop = /** @type {any} */ (window).DashInboxDrop;
    if (drop) return drop.emptyHtml(cid, model);
    return '<li class="dash-inbox-caught" id="dash-inbox-caught">All Caught Up</li>';
  }

  /* ── The By Assessment view ────────────────────────────── */
  /** @param {string} cid @param {any} m */
  function byAssessmentHtml(cid, m) {
    var rows = '';
    // All Caught Up with D5: the drop area is the list's whole space.
    if (m.caughtUp && /** @type {any} */ (window).DashInboxDrop)
      return '<ul class="dash-inbox-list" id="dash-inbox-list">' + api.emptyHtml(cid, m) + '</ul>';
    if (m.caughtUp) rows += api.emptyHtml(cid, m);
    m.rows.forEach(function (/** @type {any} */ p) {
      rows += rowHtml(cid, p);
    });
    if (m.fold) rows += foldHtml(cid, m.fold);
    return '<ul class="dash-inbox-list" id="dash-inbox-list">' + rows + '</ul>';
  }

  addView({
    key: 'assessment',
    label: 'By Assessment',
    hint: 'One row per assessment, newest work first.',
    html: byAssessmentHtml,
  });

  /* ── The tile ──────────────────────────────────────────── */
  /** Whether the tile takes the slot: the build switch, and the class's student page and Send Work.
   * @param {string} cid */
  function shows(cid) {
    return !!(
      window.BuildFlags &&
      BuildFlags.on('dashRow') &&
      /** @type {any} */ (window).GraderWork &&
      /** @type {any} */ (window).GraderWork.workOnInClass(cid)
    );
  }

  /** @param {string} cid */
  function seenOf(cid) {
    return _cfg.read(DashInboxModel.SEEN_KEY + cid);
  }

  /** @param {string} cid
   * @param {{ classCounts?: (cid: string, ids: string[]) => any }} [ctx] the draw's shared count of the class's work
   * @returns {string} */
  function html(cid, ctx) {
    _files = {};
    _cid = cid;
    var seen = seenOf(cid);
    _model = DashInboxModel.build(cid, { seen: seen, classCounts: ctx && ctx.classCounts });
    if (!_model.on) return '';
    // A first look on this device starts the kept time: nothing is new until then.
    if (!seen) _cfg.write(DashInboxModel.SEEN_KEY + cid, new Date().toISOString());
    var view = viewOf(cid);
    var menu = DashOverview.viewMenuHtml({
      id: 'inbox',
      label: 'Inbox view',
      views: _views.map(function (v) {
        return { key: v.key, label: v.label, hint: v.hint };
      }),
      current: view.key,
    });
    return (
      '<section class="dash-inbox" id="dash-inbox" tabindex="-1" aria-labelledby="dash-inbox-title">' +
      '<div class="dash-section-title dash-inbox-head"><h2 class="dash-inbox-title" id="dash-inbox-title">Inbox</h2>' +
      menu +
      '<a role="link" tabindex="0" data-href="' +
      esc('/assignments?course=' + encodeURIComponent(cid)) +
      '">Assignments →</a></div>' +
      '<div class="dash-inbox-body">' +
      view.html(cid, _model) +
      '</div></section>'
    );
  }

  /* ── Drawing: before, after ────────────────────────────── */
  function _reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Where each row and picture stands, from the tile's own corner.
   * @returns {Record<string, { x: number, y: number }>} */
  function _positions() {
    var tile = document.getElementById('dash-inbox');
    /** @type {Record<string, { x: number, y: number }>} */
    var at = {};
    if (!tile) return at;
    var o = tile.getBoundingClientRect();
    tile.querySelectorAll('.dash-inbox-row[data-aid], [data-pic-key]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      var id = el.classList.contains('dash-inbox-row')
        ? 'row:' + el.getAttribute('data-aid')
        : 'pic:' + el.getAttribute('data-pic-key');
      at[id] = { x: r.left - o.left, y: r.top - o.top };
    });
    return at;
  }

  /* Called just before the page is set: what the draw would lose. */
  function beforeRender() {
    if (_mounted && _mounted.unmount) {
      try {
        _mounted.unmount();
      } catch (e) {
        /* a view's own fault stays its own */
      }
    }
    _mounted = null;
    if (window.DashInboxDrop) DashInboxDrop.unmount();
    var list = document.getElementById('dash-inbox-list');
    _scroll = list ? list.scrollTop : 0;
    _snap = _drawn && document.getElementById('dash-inbox') ? { cid: _drawn, at: _positions() } : null;
  }

  /** Rows and pictures that stand elsewhere than they did glide from there.
   * @param {string} cid */
  function _glide(cid) {
    var was = _snap;
    _snap = null;
    if (!was || was.cid !== cid || _reduced()) return;
    var tile = document.getElementById('dash-inbox');
    if (!tile) return;
    var o = tile.getBoundingClientRect();
    tile.querySelectorAll('.dash-inbox-row[data-aid], [data-pic-key]').forEach(function (/** @type {any} */ el) {
      var id = el.classList.contains('dash-inbox-row')
        ? 'row:' + el.getAttribute('data-aid')
        : 'pic:' + el.getAttribute('data-pic-key');
      var from = was && was.at[id];
      if (!from || !el.animate) return;
      var r = el.getBoundingClientRect();
      var dx = from.x - (r.left - o.left);
      var dy = from.y - (r.top - o.top);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], {
        duration: 200,
        easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      });
    });
  }

  /* Called once the page is set. */
  /** @param {string} cid */
  function afterRender(cid) {
    var tile = document.getElementById('dash-inbox');
    if (!tile) {
      // No Inbox on this draw: nothing of an earlier one is held.
      if (_pics) _pics.releaseAll();
      _snap = null;
      _drawn = null;
      return;
    }
    var list = document.getElementById('dash-inbox-list');
    if (list && _drawn === cid) list.scrollTop = _scroll;
    _drawn = cid;
    if (!_pics && window.WorkThumbs) _pics = WorkThumbs.holder();
    if (_pics) {
      _pics.fill(tile, cid, function (/** @type {HTMLElement} */ img) {
        if (_cid !== cid) return null;
        return _files[img.getAttribute('data-dash-pic') || ''] || null;
      });
    }
    _glide(cid);
    var view = viewOf(cid);
    _mounted = view;
    if (view.mount) view.mount(tile, cid, _model);
    // The new page's pictures are in, the view's own included (it fills them
    // from mount, through pics()); let go of any the old page held alone.
    if (_pics) _pics.sweep();
    // A drop of files anywhere on the tile, in every view (D5).
    if (window.DashInboxDrop) DashInboxDrop.mount(tile, cid, _model);
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
    if (_pics) _pics.releaseAll();
    _snap = null;
    _scroll = 0;
    _drawn = null;
    _files = {};
    _model = null;
    clearTimeout(_ringTimer);
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
  /** @param {MouseEvent} e @param {{ cid: string, redraw: () => void }} ctx */
  function click(e, ctx) {
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest) return false;
    var cell = t.closest('[data-dash-inbox-jump]');
    if (cell) {
      // A new tab, as for any link, is the link's own.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return false;
      if (!document.getElementById('dash-inbox')) return false;
      e.preventDefault();
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
    if (el.getAttribute('data-dash-inbox') === 'wall') {
      if (window.WorkWall) WorkWall.open(cid, aid, { onClose: redraw });
      return true;
    }
    if (el.getAttribute('data-dash-inbox') === 'grade') {
      var order = DashInboxModel.gradeOrder(cid, aid);
      if (!order.length || !window.PageAssignments || !PageAssignments.openGrader) return true;
      PageAssignments.openGrader(cid, aid, order[0], { studentIds: order, show: 'tograde', onClose: redraw });
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
    countsText: countsText,
    countsHtml: countsHtml,
    whenText: whenText,
    /* The tile's picture holder, for a view that shows pictures (D6). The
       contract every view follows:
       - Fill your pictures synchronously inside mount(): afterRender sweeps
         the holder right after mount, and anything no img on the page shows
         by then is let go (and asked for again later).
       - Key your pictures so another class's keys cannot match (the By
         Assessment view's key is aid|student|file id; an aid is unique to
         its class).
       - Never keep a holder of your own: this one lives across the
         Dashboard's redraws, which is what stops a picture being asked for
         twice. It is null until the tile has drawn once. */
    pics: function () {
      return _pics;
    },
    model: function () {
      return _model;
    },
  };
  return api;
})();
