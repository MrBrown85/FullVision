// @ts-check
/* dash-inbox-roll.js — the Inbox's Roll Call view (D8 of
   docs/plans/dashboard-inbox-plan.md; board C4). The whole class in class-list
   order for one piece of work, like taking attendance.

   A tile under 380 px tall draws each student as a name chip: solid when work
   is in, dashed when not, a tick when returned, bold when it waits to be
   graded. A taller tile draws small pages, each at least 80 px tall, in nine
   or seven columns, and the grid scrolls inside the tile when they cannot all
   fit. A click on a student with work in opens the grader on them; a click on
   one with nothing in opens a one-item menu, Add Work, which opens the
   grader on that student, where the grader's own Add Work is. There is no
   Mark Missing: setting Missing can change a grade, and this view changes none.

   Every state and count is GraderWork's: workStateOf, workCounts, workInIds.
   This file writes nothing and decides no rule of its own.

   The piece comes from the assessment switch (DashInboxPick, built apart)
   when it is on the page; without it, the first piece the Inbox lists.
   What must outlast a draw (the piece when there is no switch, the open menu,
   the form last drawn) is kept here, because the Dashboard draws its whole
   page as one string. */
window.DashInboxRoll = (function () {
  'use strict';

  // The tile height where names give way to pages.
  var TALL = 380;
  // A page is never under this tall.
  var MIN_PAGE = 80;
  var GAP = 8;
  // A page chip's name line under the picture, in pixels.
  var LABEL = 20;
  var COLS = [9, 7];

  /** @type {{ sid: string, aid: string } | null} */
  var _menu = null;
  /** The form last drawn, and the piece when there is no switch.
   * @type {'names' | 'pages' | null} */
  var _form = null;
  /** @type {string | null} */
  var _own = null;
  /** @type {any} */
  var _watch = null;
  /** @type {any} */
  var _off = null;
  var _openedAt = 0;

  /** @returns {any} */
  function _pick() {
    return /** @type {any} */ (window).DashInboxPick || null;
  }
  /** @returns {any} */
  function _gw() {
    return /** @type {any} */ (window).GraderWork || null;
  }

  /* ── The model ─────────────────────────────────────────── */
  /** @param {number} h the tile's height
   * @returns {'names' | 'pages'} */
  function formFor(h) {
    return h >= TALL ? 'pages' : 'names';
  }

  /** The pages grid for `n` students in a box `w` by `h`: nine across or
   * seven, whichever fills it with the taller pages, never under MIN_PAGE
   * (then the grid scrolls).
   * @param {number} n @param {number} w @param {number} h
   * @returns {{ cols: number, pageH: number, scrolls: boolean }} */
  function layoutFor(n, w, h) {
    /** @type {{ cols: number, pageH: number, scrolls: boolean } | null} */
    var best = null;
    COLS.forEach(function (cols) {
      var rows = Math.max(1, Math.ceil(n / cols));
      var each = Math.floor((h - (rows - 1) * GAP) / rows) - LABEL;
      // A page is about three quarters as wide as it is tall.
      var cell = (w - (cols - 1) * GAP) / cols;
      var pageH = Math.min(each, Math.floor((cell * 4) / 3));
      if (pageH >= MIN_PAGE && (!best || pageH > best.pageH)) best = { cols: cols, pageH: pageH, scrolls: false };
    });
    return best || { cols: COLS[0], pageH: MIN_PAGE, scrolls: true };
  }

  /** @param {string} cid */
  function _students(cid) {
    var all = getStudents(cid) || [];
    var I = /** @type {any} */ (window).DashInsights;
    return I && I.sortStudents ? I.sortStudents(cid, all, 'last-asc', {}) : sortStudents(all, 'lastName');
  }

  /** The names a chip shows: the first name, with the last initial when two
   * students share one.
   * @param {any[]} students
   * @returns {Record<string, string>} */
  function shortNames(students) {
    /** @type {Record<string, number>} */
    var seen = {};
    students.forEach(function (s) {
      var k = displayNameFirst(s).toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
    });
    /** @type {Record<string, string>} */
    var out = {};
    students.forEach(function (s) {
      var first = displayNameFirst(s);
      var last = String(s.lastName || '').trim();
      out[s.id] = seen[first.toLowerCase()] > 1 && last ? first + ' ' + last.charAt(0).toUpperCase() + '.' : first;
    });
    return out;
  }

  /** @param {string} cid @param {string} aid */
  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).filter(function (a) {
        return a && a.id === aid;
      })[0] || null
    );
  }

  /** One chip's accessible name and tooltip: "Ethan Dubois: Returned, On Paper".
   * @param {{ full: string, in: boolean, state: string | null, paper: boolean, late: boolean, mates: string[] }} c */
  function _said(c) {
    if (!c.in) return c.full + ': Not in';
    var bits = [c.state === 'returned' ? 'Returned' : c.state === 'toreturn' ? 'Graded, not returned' : 'To grade'];
    if (c.paper) bits.push('On Paper');
    if (c.late) bits.push('Late');
    if (c.mates.length) bits.push('with ' + c.mates.join(' and '));
    return c.full + ': ' + bits.join(', ');
  }

  /** The Roll Call for one piece: the whole class in class-list order, and
   * the foot line's counts. Each state is GraderWork's.
   * @param {string} cid @param {string} aid
   * @returns {any} */
  function model(cid, aid) {
    var GW = _gw();
    /** @type {any} */
    var out = { aid: aid, title: '', students: [], counts: null, foot: '', order: [], notIn: [] };
    var a = _piece(cid, aid);
    if (!GW || !a) return out;
    out.title = String(a.title || 'Untitled');
    var roster = _students(cid);
    var ids = roster.map(function (s) {
      return s.id;
    });
    var inIds = GW.workInIds(cid, aid, ids);
    var inSet = /** @type {Record<string, boolean>} */ ({});
    inIds.forEach(function (/** @type {string} */ id) {
      inSet[id] = true;
    });
    var counts = GW.workCounts(cid, aid, ids);
    var names = shortNames(roster);
    /** @type {Record<string, any>} */
    var byId = {};
    roster.forEach(function (s) {
      byId[s.id] = s;
    });
    var late = 0;
    /** @type {string[]} */
    var paper = [];
    roster.forEach(function (s) {
      var isIn = !!inSet[s.id];
      var subs = isIn && typeof getGroupSubmissions === 'function' ? getGroupSubmissions(cid, s.id, aid) : [];
      var own = subs.filter(function (/** @type {any} */ x) {
        return x.enrollment_id === s.id;
      })[0];
      var mine = own || subs[0] || null;
      var file = null;
      [own].concat(subs).forEach(function (/** @type {any} */ x) {
        if (file || !x) return;
        file =
          (Array.isArray(x.files) ? x.files : [])
            .filter(function (/** @type {any} */ f) {
              return !!f;
            })
            .slice()
            .sort(function (/** @type {any} */ p, /** @type {any} */ q) {
              return (p.page || 0) - (q.page || 0);
            })[0] || null;
      });
      var group =
        isIn && !own && typeof getStudentWorkGroup === 'function' ? getStudentWorkGroup(cid, s.id, aid) : null;
      var mates = group
        ? group.members
            .filter(function (/** @type {string} */ m) {
              return m !== s.id && byId[m];
            })
            .map(function (/** @type {string} */ m) {
              return displayName(byId[m]);
            })
        : [];
      var c = {
        sid: s.id,
        name: names[s.id],
        full: displayName(s),
        in: isIn,
        state: isIn ? GW.workStateOf(cid, aid, s.id) : null,
        paper: !!(mine && mine.on_paper),
        late: !!(mine && mine.is_late),
        file: file,
        mates: mates,
        said: '',
      };
      if (c.in && !c.state) c.state = 'tograde';
      c.said = _said(c);
      if (c.in && c.late) late++;
      if (c.in && c.paper) paper.push(c.full);
      out.students.push(c);
    });
    out.order = inIds.slice();
    out.notIn = ids.filter(function (/** @type {string} */ id) {
      return !inSet[id];
    });
    out.counts = { in: inIds.length, notin: counts.notin, late: late, paper: paper.length, all: ids.length };
    out.paperNames = paper;
    out.foot = footText(out.counts, paper);
    return out;
  }

  /** "10 in · 17 not in · 2 Late · Ethan Dubois on paper".
   * @param {{ in: number, notin: number, late: number }} c @param {string[]} paper */
  function footText(c, paper) {
    var s = [c.in + ' in', c.notin + ' not in'];
    if (c.late) s.push(c.late + ' Late');
    if (paper.length === 1) s.push(paper[0] + ' on paper');
    else if (paper.length === 2) s.push(paper[0] + ' and ' + paper[1] + ' on paper');
    else if (paper.length) s.push(paper.length + ' on paper');
    return s.join(' · ');
  }

  /* ── Drawing ───────────────────────────────────────────── */
  var TICK =
    '<svg class="dash-inbox-roll-tick" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.2 6.4 4.9 9 9.8 3.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PAPER =
    '<svg class="dash-inbox-roll-paper" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 1.5h4.2L9.5 3.8V10.5H3z M7 1.5v2.5h2.5 M4.6 6h3.4 M4.6 8h3.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';

  /** @param {any} c */
  function _stateClass(c) {
    if (!c.in) return ' is-out';
    var k = ' is-in';
    if (c.state === 'returned') k += ' is-returned';
    else if (c.state === 'tograde') k += ' is-tograde';
    if (c.late) k += ' is-late';
    return k;
  }

  /** @param {any} c @param {string} aid @param {string} form
   * @param {(key: string, file: any) => void} give */
  function chipHtml(c, aid, form, give) {
    var attrs =
      ' data-dash-roll="chip" data-sid="' +
      esc(c.sid) +
      '" data-in="' +
      (c.in ? '1' : '0') +
      '" aria-label="' +
      esc(c.said) +
      '" title="' +
      esc(c.said) +
      '"';
    var mark = (c.state === 'returned' && c.in ? TICK : '') + (c.paper ? PAPER : '');
    if (form === 'names') {
      return (
        '<button type="button" class="dash-inbox-roll-chip' +
        _stateClass(c) +
        '"' +
        attrs +
        '><span class="dash-inbox-roll-name">' +
        esc(c.name) +
        '</span>' +
        (mark ? '<span class="dash-inbox-roll-marks">' + mark + '</span>' : '') +
        '</button>'
      );
    }
    var page = '';
    if (c.in) {
      if (c.file) {
        var key = aid + '|' + c.sid + '|' + c.file.id;
        give(key, c.file);
        page =
          '<img class="dash-inbox-roll-img" data-work-pic data-dash-pic="' + esc(key) + '" alt="" decoding="async">';
      } else {
        page = '<span class="dash-inbox-roll-sheet"></span>';
      }
    }
    return (
      '<button type="button" class="dash-inbox-roll-chip is-page' +
      _stateClass(c) +
      '"' +
      attrs +
      '><span class="dash-inbox-roll-pg">' +
      page +
      (mark ? '<span class="dash-inbox-roll-marks">' + mark + '</span>' : '') +
      '</span><span class="dash-inbox-roll-name">' +
      esc(c.name) +
      '</span></button>'
    );
  }

  /** What the tile's height most likely is before the page is laid out: the
   * row's rule (the window less 290, never under 510), 60% beside Bulletins.
   * mount measures it, and draws again if the guess was wrong.
   * @returns {{ w: number, h: number }} */
  function _guess() {
    var row = Math.max(510, (window.innerHeight || 800) - 278 - 12);
    var bulletins = !!(window.BuildFlags && BuildFlags.on('bulletins') && /** @type {any} */ (window).DashBulletins);
    return { w: 629, h: bulletins ? Math.round((row - 12) * 0.6) : row };
  }

  /** The grid's room inside a tile of this height: the head, the switch and
   * the foot take about 150 px.
   * @param {number} tileH */
  function _room(tileH) {
    return Math.max(120, tileH - 150);
  }

  /** @param {string} cid
   * @returns {string | null} */
  function _aid(cid) {
    var P = _pick();
    var aid = P && P.current ? P.current(cid) : null;
    return aid || null;
  }

  /** @param {string} cid @param {any} inbox the Inbox's own model */
  function _chosen(cid, inbox) {
    var P = _pick();
    if (P) return _aid(cid);
    var list = (inbox && inbox.rows && inbox.rows.length ? inbox.rows : inbox && inbox.pieces) || [];
    var own = list.filter(function (/** @type {any} */ p) {
      return p.aid === _own;
    })[0];
    return (own || list[0] || {}).aid || null;
  }

  /** @param {string} cid @param {any} inbox */
  function html(cid, inbox) {
    var aid = _chosen(cid, inbox);
    if (!aid) {
      return '<div class="dash-inbox-roll"><p class="dash-inbox-roll-empty">Nothing is taking work yet.</p></div>';
    }
    var m = model(cid, aid);
    var P = _pick();
    var head = P
      ? '<div class="dash-inbox-roll-pick" id="dash-inbox-roll-pick">' + P.html(cid) + '</div>'
      : '<div class="dash-inbox-roll-pick"><span class="dash-inbox-roll-piece">' + esc(m.title) + '</span></div>';
    var g = _guess();
    var form = _form || formFor(g.h);
    var chips = m.students
      .map(function (/** @type {any} */ c) {
        return chipHtml(c, aid, form, function (key, file) {
          /** @type {any} */ (window).DashInbox.pic(key, file);
        });
      })
      .join('');
    var lay = layoutFor(m.students.length, g.w, _room(g.h));
    var a = _piece(cid, aid);
    var all =
      window.AddWorkClass && a && AddWorkClass.offered(cid, a)
        ? '<button type="button" class="dash-inbox-roll-all" data-dash-roll="all" data-aid="' +
          esc(aid) +
          '">Add Work for the Class</button>'
        : '';
    return (
      '<div class="dash-inbox-roll is-' +
      form +
      '" data-aid="' +
      esc(aid) +
      '">' +
      head +
      '<div class="dash-inbox-roll-grid" id="dash-inbox-roll-grid" role="group" aria-label="' +
      esc(m.title + ': the whole class') +
      '" style="--dash-inbox-roll-cols:' +
      lay.cols +
      ';--dash-inbox-roll-pg:' +
      lay.pageH +
      'px">' +
      chips +
      '</div><div class="dash-inbox-roll-foot"><span class="dash-inbox-roll-count" role="status">' +
      esc(m.foot) +
      '</span>' +
      all +
      '</div></div>'
    );
  }

  /* ── The one-item menu ─────────────────────────────────── */
  /** @param {HTMLElement} root */
  function _closeMenu(root) {
    var el = root && root.querySelector('.dash-inbox-roll-menu');
    if (el) el.remove();
    root.querySelectorAll('.dash-inbox-roll-chip.is-menu').forEach(function (c) {
      c.classList.remove('is-menu');
      c.removeAttribute('aria-expanded');
    });
    if (_off) {
      document.removeEventListener('click', _off, true);
      document.removeEventListener('keydown', _off, true);
      _off = null;
    }
  }

  /** Opens the menu under a chip, or above it when there is no room. The item
   * never sits where the click was: the menu starts below the chip.
   * @param {HTMLElement} root @param {string} cid @param {boolean} focus */
  function _showMenu(root, cid, focus) {
    _closeMenu(root);
    if (!_menu) return;
    var menu = _menu;
    var chip = /** @type {HTMLElement | null} */ (
      root.querySelector('.dash-inbox-roll-chip[data-sid="' + CSS.escape(menu.sid) + '"]')
    );
    if (!chip || chip.getAttribute('data-in') === '1') {
      _menu = null;
      return;
    }
    chip.classList.add('is-menu');
    chip.setAttribute('aria-expanded', 'true');
    var m = document.createElement('div');
    m.className = 'dash-inbox-roll-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML =
      '<button type="button" role="menuitem" class="dash-inbox-roll-item" data-dash-roll="add" data-sid="' +
      esc(menu.sid) +
      '">Add Work</button>';
    root.appendChild(m);
    var o = root.getBoundingClientRect();
    var r = chip.getBoundingClientRect();
    var top = r.bottom - o.top + 4;
    if (top + m.offsetHeight > o.height) top = r.top - o.top - m.offsetHeight - 4;
    var left = Math.min(Math.max(0, r.left - o.left), Math.max(0, o.width - m.offsetWidth));
    m.style.top = Math.max(0, top) + 'px';
    m.style.left = left + 'px';
    _openedAt = Date.now();
    if (focus) {
      var item = /** @type {HTMLElement | null} */ (m.querySelector('.dash-inbox-roll-item'));
      if (item) item.focus();
    }
    _off = function (/** @type {Event} */ e) {
      if (e.type === 'keydown') {
        if (/** @type {KeyboardEvent} */ (e).key !== 'Escape') return;
        e.stopPropagation();
        _menu = null;
        _closeMenu(root);
        if (chip) chip.focus();
        return;
      }
      var t = /** @type {any} */ (e.target);
      if (t && t.closest && (t.closest('.dash-inbox-roll-menu') || t.closest('.dash-inbox-roll-chip.is-menu'))) return;
      _menu = null;
      _closeMenu(root);
    };
    document.addEventListener('click', _off, true);
    document.addEventListener('keydown', _off, true);
  }

  /* ── Clicks and keys ───────────────────────────────────── */
  /** @param {string} cid @param {string} aid @param {string} sid @param {string[]} order @param {() => void} redraw */
  function _grader(cid, aid, sid, order, redraw) {
    if (!window.PageAssignments || !PageAssignments.openGrader) return;
    PageAssignments.openGrader(cid, aid, sid, { studentIds: order, onClose: redraw });
  }

  function _redraw() {
    var D = /** @type {any} */ (window).PageDashboard;
    if (D && D.render) D.render();
  }

  /** @param {HTMLElement} root @param {string} cid */
  function _bind(root, cid) {
    var aid = root.getAttribute('data-aid') || '';
    root.addEventListener('click', function (e) {
      var t = /** @type {any} */ (e.target);
      var el = t && t.closest && t.closest('[data-dash-roll]');
      if (!el || !root.contains(el)) return;
      var what = el.getAttribute('data-dash-roll');
      if (what === 'all') {
        var a = _piece(cid, aid);
        if (window.AddWorkClass && a && AddWorkClass.offered(cid, a)) AddWorkClass.open(cid, aid, { onClose: _redraw });
        return;
      }
      var sid = el.getAttribute('data-sid') || '';
      if (what === 'chip') {
        if (el.getAttribute('data-in') === '1') {
          _menu = null;
          _closeMenu(root);
          _grader(cid, aid, sid, model(cid, aid).order, _redraw);
        } else if (!(_menu && _menu.sid === sid)) {
          _menu = { sid: sid, aid: aid };
          _showMenu(root, cid, el.detail === 0);
        }
        return;
      }
      if (what === 'add') {
        // A second click of a double click lands here only if it was fast and
        // on the item; the menu opens below the chip, so it does not.
        if (el.detail > 0 && Date.now() - _openedAt < 250) return;
        var notIn = model(cid, aid).notIn;
        _menu = null;
        _closeMenu(root);
        _grader(cid, aid, sid, notIn.indexOf(sid) >= 0 ? notIn : [sid], _redraw);
      }
    });
    root.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
      var t = /** @type {any} */ (e.target);
      if (!t || !t.matches || !t.matches('.dash-inbox-roll-chip')) return;
      var chips = Array.prototype.slice.call(root.querySelectorAll('.dash-inbox-roll-chip'));
      var at = chips.indexOf(t);
      var to = at;
      if (k === 'ArrowLeft') to = at - 1;
      else if (k === 'ArrowRight') to = at + 1;
      else {
        // Up and down: the chip nearest above or below, by position.
        var r = t.getBoundingClientRect();
        var best = Infinity;
        chips.forEach(function (/** @type {HTMLElement} */ c, /** @type {number} */ i) {
          var q = c.getBoundingClientRect();
          var dy = k === 'ArrowDown' ? q.top - r.top : r.top - q.top;
          if (dy < r.height / 2) return;
          var cost = dy * 1000 + Math.abs(q.left - r.left);
          if (cost < best) {
            best = cost;
            to = i;
          }
        });
      }
      if (to < 0 || to >= chips.length || to === at) return;
      e.preventDefault();
      chips[to].focus();
    });
  }

  /* ── Mount ─────────────────────────────────────────────── */
  /** The tile is laid out only after the page is set, so the form is read
   * here; when it is not the one drawn, the page is drawn once more.
   * @param {HTMLElement} root */
  function _measure(root) {
    var tile = document.getElementById('dash-inbox');
    var grid = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-roll-grid'));
    if (!tile || !grid) return;
    var h = tile.getBoundingClientRect().height;
    if (!h) return;
    var form = formFor(h);
    var drawn = root.classList.contains('is-pages') ? 'pages' : 'names';
    if (form !== drawn) {
      _form = form;
      _redraw();
      return;
    }
    _form = form;
    if (form === 'pages') {
      var m = root.getBoundingClientRect();
      var top = grid.getBoundingClientRect().top - m.top;
      var foot = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-roll-foot'));
      var room = m.height - top - (foot ? foot.offsetHeight : 0) - 8;
      var n = root.querySelectorAll('.dash-inbox-roll-chip').length;
      var lay = layoutFor(n, grid.clientWidth || 629, room > 0 ? room : _room(h));
      grid.style.setProperty('--dash-inbox-roll-cols', String(lay.cols));
      grid.style.setProperty('--dash-inbox-roll-pg', lay.pageH + 'px');
    }
  }

  /** @param {HTMLElement} tile @param {string} cid @param {any} inbox */
  function mount(tile, cid, inbox) {
    var found = /** @type {HTMLElement | null} */ (tile.querySelector('.dash-inbox-roll[data-aid]'));
    if (!found) return;
    var root = found;
    var aid = root.getAttribute('data-aid') || '';
    _own = aid;
    _bind(root, cid);
    var P = _pick();
    var pick = root.querySelector('#dash-inbox-roll-pick');
    if (P && P.mount && pick) P.mount(pick, cid, _redraw);
    if (_menu && _menu.aid === aid) _showMenu(root, cid, false);
    else _menu = null;
    _measure(root);
    if (window.ResizeObserver) {
      var tick = 0;
      _watch = new ResizeObserver(function () {
        clearTimeout(tick);
        tick = window.setTimeout(function () {
          if (document.getElementById('dash-inbox') === tile && tile.contains(root)) _measure(root);
        }, 60);
      });
      _watch.observe(tile);
    }
  }

  function unmount() {
    if (_watch) {
      _watch.disconnect();
      _watch = null;
    }
    var root = document.querySelector('.dash-inbox-roll');
    if (_off) {
      document.removeEventListener('click', _off, true);
      document.removeEventListener('keydown', _off, true);
      _off = null;
    }
    var P = _pick();
    var pick = document.getElementById('dash-inbox-roll-pick');
    if (P && P.unmount && pick) P.unmount(pick);
    void root;
  }

  var inbox = /** @type {any} */ (window).DashInbox;
  if (inbox) {
    inbox.addView({
      key: 'roll',
      label: 'Roll Call',
      hint: "The whole class: who has sent work, and who hasn't.",
      html: html,
      mount: mount,
      unmount: unmount,
    });
  }

  return {
    model: model,
    formFor: formFor,
    layoutFor: layoutFor,
    shortNames: shortNames,
    footText: footText,
    html: html,
    TALL: TALL,
    /** Test hook: forget the module's state. */
    reset: function () {
      _menu = null;
      _form = null;
      _own = null;
    },
  };
})();
