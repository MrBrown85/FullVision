// @ts-check
/* dash-inbox-flip.js — Flip Through, a view of the Dashboard's Inbox (D7 of
   docs/plans/dashboard-inbox-plan.md; board C3). One piece at a time. The
   centre page faces the teacher at the stage's full height with a caption
   under it; the other students' pages stand to each side, turned and
   stepping back, each a button with the student's name. To grade first, in
   the order the work came in, then the work already assessed.

   Registered through DashInbox.addView. Every state and every count is
   GraderWork's (workCounts, workInIds); this file sorts the lists it made.

   Moving: Left and Right while the stage has focus, a click on a side page,
   a sideways scroll or swipe (one page a gesture), and the slider. Up and
   Down, or the page control under the centre page, turn through one
   student's pages in place. A click or Enter on the centre page, or the
   caption's button, opens the grader.

   The page's places are CSS (custom properties --s, the side, and --k, the
   steps from the centre); a page glides there by a transition on transform.
   What must outlast the Dashboard's whole-page redraws (the piece, the
   centred student, the page within their work) is kept here, in state,
   and the centred student is held by id so new work arriving moves nobody.

   Pictures: the centre page's whole page (its thumbnail while that loads)
   and thumbnails for the pages on or next to the stage, through the tile's
   own WorkThumbs holder (DashInbox.fillPics).

   DashInboxPick (the assessment switch, D6) is used when it is there; when
   it is not, the first piece with work in is shown with no switch. */
/** @type {any} */ (window).DashInboxFlip = (function () {
  'use strict';

  // Pages drawn each side of the centre; further ones are out of sight.
  var WINDOW = 5;
  var GAP = 150; // a sideways gesture counts once, then waits for this much quiet
  var SWIPE = 50;

  /** @typedef {{ aid: string, sid: string | null, idx: number, pages: Record<string, number> }} State */
  /** @type {Record<string, State>} */
  var _states = {};
  /** @type {any} */
  var _live = null;
  /** @type {{ cid: string, token: string, at: number } | null} */
  var _refocus = null;

  /** @returns {any} */
  function _inbox() {
    return /** @type {any} */ (window).DashInbox || null;
  }

  /** @returns {any} */
  function _pick() {
    var p = /** @type {any} */ (window).DashInboxPick;
    return p && typeof p.html === 'function' && typeof p.current === 'function' ? p : null;
  }

  /** @param {string} cid @param {any} model
   * @returns {string} */
  function chosen(cid, model) {
    var pieces = (model && model.pieces) || [];
    var P = _pick();
    var want = null;
    if (P) {
      try {
        want = P.current(cid);
      } catch (e) {
        want = null;
      }
    }
    if (
      want &&
      pieces.some(function (/** @type {any} */ p) {
        return p.aid === want;
      })
    )
      return want;
    // Work to grade first, else any work in.
    var first =
      pieces.filter(function (/** @type {any} */ p) {
        return p.tograde > 0 && p.in > 0;
      })[0] ||
      pieces.filter(function (/** @type {any} */ p) {
        return p.in > 0;
      })[0];
    return first ? first.aid : '';
  }

  /** @param {string} cid @param {string} aid
   * @returns {State} */
  function stateOf(cid, aid) {
    var st = _states[cid];
    if (!st || st.aid !== aid) st = _states[cid] = { aid: aid, sid: null, idx: 0, pages: {} };
    return st;
  }

  /** @param {any} s */
  function _pagesOf(s) {
    return (Array.isArray(s && s.files) ? s.files : [])
      .filter(function (/** @type {any} */ f) {
        return !!f;
      })
      .slice()
      .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return (x.page || 0) - (y.page || 0);
      });
  }

  /** @param {any} s */
  function _at(s) {
    return String((s && (s.sent_at || s.created_at)) || '');
  }

  /** The students with work in on a piece, in the order the stage shows them:
   * work to grade first, then the rest, each in the order the work came in.
   * @param {string} cid @param {string} aid
   * @returns {any[]} */
  function entries(cid, aid) {
    var GW = /** @type {any} */ (window).GraderWork;
    if (!GW || !cid || !aid) return [];
    var students = getStudents(cid) || [];
    var ids = students.map(function (s) {
      return s.id;
    });
    /** @type {Record<string, any>} */
    var by = {};
    students.forEach(function (s) {
      by[s.id] = s;
    });
    var counts = GW.workCounts(cid, aid, ids);
    /** @type {Record<string, boolean>} */
    var inn = {};
    GW.workInIds(cid, aid, ids).forEach(function (/** @type {string} */ id) {
      inn[id] = true;
    });
    /** @type {Record<string, string>} */
    var state = {};
    ['tograde', 'toreturn', 'returned'].forEach(function (k) {
      counts.ids[k].forEach(function (/** @type {string} */ id) {
        state[id] = k;
      });
    });
    var out = [];
    ids.forEach(function (sid) {
      if (!inn[sid]) return;
      // One page-set per student who sent; a group-mate who did not has the group's.
      var s = getStudentSubmission(cid, sid, aid);
      if (!s) return;
      var group = typeof getStudentWorkGroup === 'function' ? getStudentWorkGroup(cid, sid, aid) : null;
      var mates = group
        ? group.members
            .filter(function (/** @type {string} */ m) {
              return m !== sid && by[m];
            })
            .map(function (/** @type {string} */ m) {
              return displayName(by[m]);
            })
        : [];
      var pages = _pagesOf(s);
      out.push({
        aid: aid,
        sid: sid,
        name: displayName(by[sid]),
        state: state[sid] || 'started',
        waiting: state[sid] === 'tograde',
        at: _at(s),
        files: pages,
        pages: pages.length,
        onPaper: !!s.on_paper,
        late: !!s.is_late,
        added: s.sent_by === 'teacher',
        with: mates,
      });
    });
    return out.sort(function (x, y) {
      if (x.waiting !== y.waiting) return x.waiting ? -1 : 1;
      var p = Date.parse(x.at) || 0;
      var q = Date.parse(y.at) || 0;
      if (p !== q) return p - q;
      return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
    });
  }

  /** @param {number} i @param {number} n */
  function clamp(i, n) {
    return Math.max(0, Math.min(n - 1, i));
  }

  /** Where the centre is in the list now: the student held by id, else the
   * place held, kept in range.
   * @param {State} st @param {any[]} list */
  function centreOf(st, list) {
    if (!list.length) return 0;
    var at = st.sid
      ? list.findIndex(function (e) {
          return e.sid === st.sid;
        })
      : -1;
    return at >= 0 ? at : clamp(st.idx, list.length);
  }

  /** The centre moves to place `i`, kept in range.
   * @param {State} st @param {any[]} list @param {number} i */
  function moveTo(st, list, i) {
    if (!list.length) return 0;
    var at = clamp(i, list.length);
    st.idx = at;
    st.sid = list[at].sid;
    return at;
  }

  /** @param {State} st @param {any[]} list @param {number} delta */
  function move(st, list, delta) {
    return moveTo(st, list, centreOf(st, list) + delta);
  }

  /** Which of a student's pages shows, kept in range.
   * @param {State} st @param {any} entry */
  function pageShown(st, entry) {
    return entry && entry.pages ? clamp(st.pages[entry.sid] || 0, entry.pages) : 0;
  }

  /** Turn within one student's pages, stopping at the first and the last.
   * @param {State} st @param {any} entry @param {number} delta */
  function turn(st, entry, delta) {
    if (!entry || entry.pages < 2) return 0;
    var at = clamp(pageShown(st, entry) + delta, entry.pages);
    st.pages[entry.sid] = at;
    return at;
  }

  /** What the caption says about the centre student, in parts.
   * @param {string} cid @param {any} entry @param {number} page */
  function caption(cid, entry, page) {
    var n = entry.pages;
    return {
      name: entry.name,
      when: _inbox() ? _inbox().whenText(cid, entry.at) : '',
      // One page, or none: said as words. Several: the page control.
      pagesText: n === 1 ? '1 page' : n === 0 && !entry.onPaper ? 'No Pages' : '',
      pager: n > 1 ? { page: page + 1, of: n } : null,
      late: entry.late,
      added: entry.added,
      onPaper: entry.onPaper,
      with: entry.with,
      label: entry.waiting ? 'Grade Submissions' : 'Open',
    };
  }

  /* ── Drawing ───────────────────────────────────────────── */
  /** The face of one page: its picture, or a lined sheet.
   * @param {string} aid @param {any} e @param {boolean} centre @param {State} st
   * @param {Record<string, any>} files filled with the file the img asks for
   * @returns {string} */
  function faceHtml(aid, e, centre, st, files) {
    var f = e.files[pageShown(st, e)];
    if (!f) {
      return (
        '<span class="dash-inbox-flip-sheet"><span class="dash-inbox-flip-sheet-name">' +
        esc(e.name) +
        '</span><span class="dash-inbox-flip-sheet-note">' +
        (e.onPaper ? 'Handed In on Paper' : 'No Pages') +
        '</span></span>'
      );
    }
    var key = 'flip|' + aid + '|' + e.sid + '|' + f.id;
    files[key] = f;
    var which = centre ? 'page' : 'thumb';
    return (
      '<img class="dash-inbox-flip-img" data-work-pic data-dash-pic="' +
      esc(key) +
      '" data-flip-want="' +
      esc(key + '|' + which) +
      '"' +
      (centre ? ' data-work-which="page" data-work-first="thumb"' : '') +
      ' alt="" decoding="async" draggable="false">'
    );
  }

  /** The side a page stands on (-1, 0, 1), the steps back from the centre,
   * and whether it is on the stage at all.
   * @param {number} i @param {number} c */
  function _place(i, c) {
    var d = i - c;
    var a = Math.abs(d);
    return { s: d < 0 ? -1 : d > 0 ? 1 : 0, k: Math.min(a, WINDOW + 1), on: a <= WINDOW, centre: d === 0, a: a };
  }

  /** @param {any} p @param {any} e @param {string} label */
  function _pgAttrs(p, e, label) {
    return (
      ' class="dash-inbox-flip-pg' +
      (p.centre ? ' is-centre' : '') +
      (p.on ? '' : ' is-off') +
      '" style="--s:' +
      p.s +
      ';--k:' +
      p.k +
      ';z-index:' +
      (100 - p.a) +
      '" aria-label="' +
      esc(label) +
      '"'
    );
  }

  /** @param {string} cid @param {string} aid @param {any[]} list @param {State} st
   * @param {Record<string, any>} files
   * @returns {string} */
  function mainHtml(cid, aid, list, st, files) {
    if (!list.length) return '<p class="dash-inbox-flip-empty">No work in yet for this piece.</p>';
    var c = centreOf(st, list);
    var pgs = list
      .map(function (e, i) {
        var p = _place(i, c);
        var cap = caption(cid, e, pageShown(st, e));
        return (
          '<button type="button" tabindex="-1" data-flip-i="' +
          i +
          '"' +
          _pgAttrs(p, e, p.centre ? e.name + ', ' + cap.label : e.name) +
          '><span class="dash-inbox-flip-face">' +
          (p.on ? faceHtml(aid, e, p.centre, st, files) : '') +
          '</span></button>'
        );
      })
      .join('');
    return (
      '<div class="dash-inbox-flip-stage" id="dash-inbox-flip-stage" tabindex="0" role="group" ' +
      'aria-roledescription="carousel" aria-label="' +
      esc(
        'Work handed in, one student at a time. Left and right arrows change student; up and down arrows turn a student’s pages.',
      ) +
      '">' +
      pgs +
      '</div><div class="dash-inbox-flip-cap" id="dash-inbox-flip-cap" aria-live="polite">' +
      capHtml(cid, list[c], pageShown(st, list[c])) +
      '</div><div class="dash-inbox-flip-range"><input type="range" class="dash-inbox-flip-slider" id="dash-inbox-flip-slider" min="0" max="' +
      (list.length - 1) +
      '" step="1" value="' +
      c +
      '"' +
      (list.length < 2 ? ' disabled' : '') +
      ' aria-label="' +
      esc('Student ' + (c + 1) + ' of ' + list.length) +
      '" aria-valuetext="' +
      esc(list[c].name) +
      '" data-flip-focus="slider"></div>'
    );
  }

  /** @param {string} cid @param {any} e @param {number} page */
  function capHtml(cid, e, page) {
    var c = caption(cid, e, page);
    var bits = [];
    if (c.when) bits.push('<span class="dash-inbox-flip-when">' + esc(c.when) + '</span>');
    if (c.pager) {
      bits.push(
        '<span class="dash-inbox-flip-pager"><button type="button" class="dash-inbox-flip-turn" data-flip-turn="-1" data-flip-focus="prev" aria-label="Previous Page"' +
          (c.pager.page <= 1 ? ' aria-disabled="true"' : '') +
          '>‹</button><span class="dash-inbox-flip-pagetext">Page ' +
          c.pager.page +
          ' of ' +
          c.pager.of +
          '</span><button type="button" class="dash-inbox-flip-turn" data-flip-turn="1" data-flip-focus="next" aria-label="Next Page"' +
          (c.pager.page >= c.pager.of ? ' aria-disabled="true"' : '') +
          '>›</button></span>',
      );
    } else if (c.pagesText) bits.push('<span class="dash-inbox-flip-pages">' + esc(c.pagesText) + '</span>');
    if (c.late) bits.push('<span class="dash-inbox-flip-late">Late</span>');
    if (c.added) bits.push('<span class="dash-inbox-flip-quiet">Added by You</span>');
    if (c.onPaper) bits.push('<span class="dash-inbox-flip-quiet">On Paper</span>');
    if (c.with.length)
      bits.push('<span class="dash-inbox-flip-quiet">' + esc('With ' + c.with.join(' and ')) + '</span>');
    return (
      '<strong class="dash-inbox-flip-name">' +
      esc(c.name) +
      '</strong><span class="dash-inbox-flip-meta">' +
      bits.join('') +
      '</span><button type="button" class="dash-inbox-flip-open" data-flip-open data-flip-focus="open">' +
      esc(c.label) +
      '</button>'
    );
  }

  /** @param {string} cid
   * @param {any} model
   * @returns {string} */
  function html(cid, model) {
    var aid = chosen(cid, model);
    var st = stateOf(cid, aid);
    var list = entries(cid, aid);
    /** @type {Record<string, any>} */
    var files = {};
    var P = _pick();
    var pick = '';
    if (P) {
      try {
        pick = '<div class="dash-inbox-flip-pick" id="dash-inbox-flip-pick">' + P.html(cid) + '</div>';
      } catch (e) {
        pick = '';
      }
    }
    var body = mainHtml(cid, aid, list, st, files);
    // The tile's holder looks these up when the page is set.
    if (_inbox()) _inbox().fillPics(null, files);
    return (
      '<div class="dash-inbox-flip" id="dash-inbox-flip">' +
      pick +
      '<div class="dash-inbox-flip-main" id="dash-inbox-flip-main">' +
      body +
      '</div></div>'
    );
  }

  /* ── Mounted: moving ───────────────────────────────────── */
  /** @param {any} L */
  function _list(L) {
    return L.list;
  }

  /** Put every page where the centre says, and keep pictures to the pages on
   * the stage, the centre's whole. */
  /** @param {any} L */
  function place(L) {
    var list = _list(L);
    if (!list.length) return;
    var st = L.st;
    var c = centreOf(st, list);
    var stage = L.main.querySelector('.dash-inbox-flip-stage');
    if (!stage) return;
    /** @type {Record<string, any>} */
    var files = {};
    var pgs = stage.querySelectorAll('.dash-inbox-flip-pg');
    pgs.forEach(function (/** @type {HTMLElement} */ b, /** @type {number} */ i) {
      var e = list[i];
      var p = _place(i, c);
      var cap = caption(L.cid, e, pageShown(st, e));
      b.classList.toggle('is-centre', p.centre);
      b.classList.toggle('is-off', !p.on);
      b.style.setProperty('--s', String(p.s));
      b.style.setProperty('--k', String(p.k));
      b.style.zIndex = String(100 - p.a);
      b.setAttribute('aria-label', p.centre ? e.name + ', ' + cap.label : e.name);
      var face = b.querySelector('.dash-inbox-flip-face');
      if (!face) return;
      if (!p.on) {
        if (face.firstChild) face.textContent = '';
        return;
      }
      var f = e.files[pageShown(st, e)];
      var want = f ? 'flip|' + L.aid + '|' + e.sid + '|' + f.id + '|' + (p.centre ? 'page' : 'thumb') : '';
      var img = face.querySelector('img');
      if (!face.firstChild || (img ? img.getAttribute('data-flip-want') : '') !== want) {
        var tmp = document.createElement('div');
        tmp.innerHTML = faceHtml(L.aid, e, p.centre, st, files);
        face.textContent = '';
        while (tmp.firstChild) face.appendChild(tmp.firstChild);
      }
    });
    var cp = L.main.querySelector('.dash-inbox-flip-cap');
    if (cp) {
      var held = _focusToken(cp);
      // html-safe: capHtml escapes every name and time with esc
      cp.innerHTML = capHtml(L.cid, list[c], pageShown(st, list[c]));
      if (held) _focusToken(cp, held);
    }
    var range = /** @type {HTMLInputElement | null} */ (L.main.querySelector('.dash-inbox-flip-slider'));
    if (range) {
      range.value = String(c);
      range.setAttribute('aria-label', 'Student ' + (c + 1) + ' of ' + list.length);
      range.setAttribute('aria-valuetext', list[c].name);
    }
    if (_inbox()) _inbox().fillPics(stage, files);
  }

  /** The data-flip-focus token of the focused control inside `root`; given a
   * token as well, puts focus on that control.
   * @param {Element} root @param {string} [to]
   * @returns {string} */
  function _focusToken(root, to) {
    if (to) {
      var el = /** @type {HTMLElement | null} */ (root.querySelector('[data-flip-focus="' + to + '"]'));
      if (el) el.focus({ preventScroll: true });
      return to;
    }
    var a = document.activeElement;
    return a && root.contains(a) ? a.getAttribute('data-flip-focus') || '' : '';
  }

  /** @param {any} L @param {number} i */
  function go(L, i) {
    var before = centreOf(L.st, L.list);
    var at = moveTo(L.st, L.list, i);
    if (at !== before) place(L);
  }

  /** @param {any} L @param {number} delta */
  function flip(L, delta) {
    var e = L.list[centreOf(L.st, L.list)];
    if (!e || e.pages < 2) return false;
    var was = pageShown(L.st, e);
    if (turn(L.st, e, delta) !== was) place(L);
    return true;
  }

  function _redraw() {
    if (document.querySelector('#main .dash-glance') && /** @type {any} */ (window).PageDashboard)
      /** @type {any} */ (window).PageDashboard.render();
  }

  /** The grader on the centre student, in this order. @param {any} L */
  function openGrader(L) {
    var e = L.list[centreOf(L.st, L.list)];
    if (!e || !window.PageAssignments || !PageAssignments.openGrader) return;
    PageAssignments.openGrader(L.cid, L.aid, e.sid, {
      studentIds: L.list.map(function (/** @type {any} */ x) {
        return x.sid;
      }),
      onClose: _redraw,
    });
  }

  /** Redraw the stage for another piece (the switch changed it). @param {any} L */
  function _switched(L) {
    var model = _inbox() ? _inbox().model() : null;
    var aid = chosen(L.cid, model);
    if (aid === L.aid) return;
    var st = stateOf(L.cid, aid);
    st.sid = null;
    st.idx = 0;
    st.pages = {};
    L.aid = aid;
    L.st = st;
    L.list = entries(L.cid, aid);
    /** @type {Record<string, any>} */
    var files = {};
    // The first student to grade is the centre.
    if (L.list.length) moveTo(st, L.list, 0);
    // html-safe: mainHtml escapes every name and key with esc
    L.main.innerHTML = mainHtml(L.cid, aid, L.list, st, files);
    if (_inbox()) {
      _inbox().fillPics(null, files);
      _inbox().fillPics(L.main, null);
    }
  }

  /** @param {HTMLElement} tile @param {string} cid @param {any} model */
  function mount(tile, cid, model) {
    unmount();
    var root = /** @type {HTMLElement | null} */ (tile.querySelector('#dash-inbox-flip'));
    if (!root) return;
    var main = /** @type {HTMLElement} */ (root.querySelector('#dash-inbox-flip-main'));
    var aid = chosen(cid, model);
    var st = stateOf(cid, aid);
    /** @type {any} */
    var L = {
      root: root,
      main: main,
      cid: cid,
      aid: aid,
      st: st,
      list: entries(cid, aid),
      pickEl: root.querySelector('#dash-inbox-flip-pick'),
      acc: 0,
      lastWheel: 0,
      locked: false,
      downX: null,
      downY: null,
      swiped: false,
      moved: false,
      movedTimer: 0,
      onUp: null,
    };
    _live = L;
    if (L.list.length) {
      var c = centreOf(st, L.list);
      // Hold the centre by id from the first look.
      st.sid = L.list[c].sid;
      st.idx = c;
    }
    var P = _pick();
    if (P && L.pickEl && typeof P.mount === 'function') {
      try {
        P.mount(L.pickEl, cid, function () {
          _switched(L);
        });
      } catch (e) {
        /* the switch's own fault stays its own */
      }
    }

    root.addEventListener('click', (L.onClick = onClick.bind(null, L)));
    root.addEventListener('keydown', (L.onKey = onKey.bind(null, L)));
    // On the stage only, and passive: it never stops a scroll, vertical or not.
    L.stage = root.querySelector('.dash-inbox-flip-stage');
    if (L.stage) L.stage.addEventListener('wheel', (L.onWheel = onWheel.bind(null, L)), { passive: true });
    root.addEventListener('pointerdown', (L.onDown = onDown.bind(null, L)));
    root.addEventListener('pointermove', (L.onMove = onMove.bind(null, L)));
    root.addEventListener('input', (L.onInput = onInput.bind(null, L)));
    L.onUp = function () {
      L.downX = null;
      L.downY = null;
      L.swiped = false;
      clearTimeout(L.movedTimer);
      L.movedTimer = setTimeout(function () {
        L.moved = false;
      }, 60);
    };
    window.addEventListener('pointerup', L.onUp);
    window.addEventListener('pointercancel', L.onUp);

    // Focus comes back to the control that had it, when a draw was not the teacher's doing.
    if (_refocus && _refocus.cid === cid && Date.now() - _refocus.at < 2000) {
      var stage = root.querySelector('.dash-inbox-flip-stage');
      if (_refocus.token === 'stage' && stage) /** @type {HTMLElement} */ (stage).focus({ preventScroll: true });
      else _focusToken(root, _refocus.token);
    }
    _refocus = null;
  }

  function unmount() {
    var L = _live;
    if (!L) return;
    _live = null;
    var a = document.activeElement;
    if (a && L.root.contains(a)) {
      var token = a.getAttribute('data-flip-focus') || (a.classList.contains('dash-inbox-flip-stage') ? 'stage' : '');
      _refocus = token ? { cid: L.cid, token: token, at: Date.now() } : null;
    }
    L.root.removeEventListener('click', L.onClick);
    L.root.removeEventListener('keydown', L.onKey);
    if (L.stage) L.stage.removeEventListener('wheel', L.onWheel);
    L.root.removeEventListener('pointerdown', L.onDown);
    L.root.removeEventListener('pointermove', L.onMove);
    L.root.removeEventListener('input', L.onInput);
    window.removeEventListener('pointerup', L.onUp);
    window.removeEventListener('pointercancel', L.onUp);
    clearTimeout(L.movedTimer);
    var P = _pick();
    if (P && L.pickEl && typeof P.unmount === 'function') {
      try {
        P.unmount(L.pickEl);
      } catch (e) {
        /* its own */
      }
    }
  }

  /* ── Mounted: events ───────────────────────────────────── */
  /** @param {any} L @param {MouseEvent} e */
  function onClick(L, e) {
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest) return;
    var turnBtn = t.closest('[data-flip-turn]');
    if (turnBtn) {
      if (turnBtn.getAttribute('aria-disabled') !== 'true') flip(L, Number(turnBtn.getAttribute('data-flip-turn')));
      return;
    }
    if (t.closest('[data-flip-open]')) {
      openGrader(L);
      return;
    }
    var pg = t.closest('.dash-inbox-flip-pg');
    if (!pg || L.moved) return;
    var i = Number(pg.getAttribute('data-flip-i'));
    if (i === centreOf(L.st, L.list)) openGrader(L);
    else go(L, i);
  }

  /** @param {any} L @param {KeyboardEvent} e */
  function onKey(L, e) {
    var stage = L.main.querySelector('.dash-inbox-flip-stage');
    if (!stage || e.target !== stage || e.altKey || e.ctrlKey || e.metaKey) return;
    var c = centreOf(L.st, L.list);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(L, c + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(L, c - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(L, 0);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(L, L.list.length - 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Only a student with several pages takes these; otherwise the page scrolls.
      var en = L.list[c];
      if (en && en.pages > 1) {
        e.preventDefault();
        flip(L, e.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openGrader(L);
    }
  }

  /* A sideways gesture moves one page, then waits until the wheel has been
     quiet, so a trackpad's long tail is not a flurry. A mostly vertical one
     is the page's own and is never stopped. */
  /** @param {any} L @param {WheelEvent} e */
  function onWheel(L, e) {
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest || !t.closest('.dash-inbox-flip-stage')) return;
    var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    var now = Date.now();
    if (L.locked && now - L.lastWheel > GAP) {
      L.locked = false;
      L.acc = 0;
    }
    L.lastWheel = now;
    if (L.locked) return;
    L.acc += dx;
    if (Math.abs(L.acc) >= 40) {
      go(L, centreOf(L.st, L.list) + (L.acc > 0 ? 1 : -1));
      L.acc = 0;
      L.locked = true;
    }
  }

  /** @param {any} L @param {PointerEvent} e */
  function onDown(L, e) {
    var t = /** @type {any} */ (e.target);
    if (e.button || !t.closest || !t.closest('.dash-inbox-flip-stage')) return;
    L.downX = e.clientX;
    L.downY = e.clientY;
    L.swiped = false;
    L.moved = false;
  }

  /** @param {any} L @param {PointerEvent} e */
  function onMove(L, e) {
    if (L.downX == null || L.swiped) return;
    var dx = e.clientX - L.downX;
    var dy = e.clientY - L.downY;
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) {
      go(L, centreOf(L.st, L.list) + (dx < 0 ? 1 : -1));
      L.swiped = true;
      L.moved = true;
    }
  }

  /** @param {any} L @param {Event} e */
  function onInput(L, e) {
    var t = /** @type {any} */ (e.target);
    if (t && t.classList && t.classList.contains('dash-inbox-flip-slider')) go(L, Number(t.value));
  }

  function _register() {
    if (!_inbox()) return;
    _inbox().addView({
      key: 'flip',
      label: 'Flip Through',
      hint: "One student's work at a time, large.",
      html: html,
      mount: mount,
      unmount: unmount,
    });
  }
  _register();

  return {
    WINDOW: WINDOW,
    entries: entries,
    chosen: chosen,
    stateOf: stateOf,
    centreOf: centreOf,
    moveTo: moveTo,
    move: move,
    pageShown: pageShown,
    turn: turn,
    caption: caption,
    html: html,
    mount: mount,
    unmount: unmount,
    reset: function () {
      _states = {};
      _live = null;
      _refocus = null;
    },
  };
})();
