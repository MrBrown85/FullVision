// @ts-check
/* dash-inbox-roll.js — the Inbox's Roll Call view (D8 of
   docs/plans/dashboard-inbox-plan.md; board C4). The whole class in class-list
   order for one piece of work, like taking attendance.

   A tile under 380 px tall draws each student as a name chip: solid when work
   is in (or has been assessed), dashed when not, a tick when returned, bold
   when it waits to be graded. A taller tile draws small pages, each at least
   80 px tall, in nine or seven columns, and the grid scrolls inside the tile
   when they cannot all fit. A click on a solid chip opens the grader on that
   student; a click on a dashed one opens a one-item menu, Add Work, which
   opens the grader on that student, where the grader's own Add Work is. There
   is no Mark Missing: setting Missing can change a grade, and this view
   changes none.

   Every state is GraderWork's (workStateOf, workInIds) and the app's own
   Missing and Excused reading (getAssignmentStatus). When workStateOf says
   nothing for work that is in, the chip reads as Side by Side words it. The
   foot line counts the chips as drawn. This file writes nothing.

   The piece is the teacher's one choice, from DashInboxPick, shared with Side
   by Side and Flip Through. The form (names or pages) is read from the tile's
   real height in mount; when it differs from the one drawn, this view alone
   is drawn again in place, never the whole page. What must outlast a draw
   (the open menu, the scroll, the focused student) is kept here. */
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
  /** The form last drawn.
   * @type {'names' | 'pages' | null} */
  var _form = null;
  /** The files of the pictures drawn: data-dash-pic key (class id first) → file.
   * @type {Record<string, any>} */
  var _files = {};
  /** The grid's scroll; the student to focus once the grader closes (refocus);
   * the student focused when a draw began (keep, with its time); the one Tab stop (cur).
   * @type {{ key: string, scroll: number, refocus: string | null, keep: string | null, keepAt: number, cur: string | null }} */
  var _st = { key: '', scroll: 0, refocus: null, keep: null, keepAt: 0, cur: null };
  /** @type {(() => void) | null} */
  var _undo = null;
  /** @type {any} */
  var _watch = null;
  /** @type {any} */
  var _off = null;
  var _openedAt = 0;
  // How many times this view has been drawn in place, for tests.
  var _swaps = 0;

  /** The grader is over the tile: what happens under it is not ours.
   * @returns {boolean} */
  function _graderOpen() {
    return !!document.getElementById('grader-overlay');
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

  /** The words for a student whose work is in, as Side by Side writes them:
   * "To Grade" when GraderWork says it waits, else "Assessed".
   * @param {string | null} state */
  function _inWord(state) {
    var S = /** @type {any} */ (window).DashInboxSide;
    if (S && S.stateWord) return S.stateWord(state === 'tograde');
    return state === 'tograde' ? 'To Grade' : 'Assessed';
  }

  /** One chip's accessible name and tooltip, "Ethan Dubois: Assessed, returned, On Paper".
   * @param {any} c */
  function _said(c) {
    var bits = [c.word];
    if (c.state === 'returned' && c.status !== 'excused') bits[0] += ', returned';
    if (c.paper) bits.push('On Paper');
    if (c.late) bits.push('Late');
    if (c.mates.length) bits.push('with ' + c.mates.join(' and '));
    return c.full + ': ' + bits.join(', ');
  }

  /** The Roll Call for one piece: the whole class in class-list order. Each
   * chip's kind is worked from GraderWork's state and the student's status:
   * solid is work in or assessed; excused is quiet; the rest are dashed.
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
    var inSet = /** @type {Record<string, boolean>} */ ({});
    GW.workInIds(cid, aid, ids).forEach(function (/** @type {string} */ id) {
      inSet[id] = true;
    });
    var names = shortNames(roster);
    /** @type {Record<string, any>} */
    var byId = {};
    roster.forEach(function (s) {
      byId[s.id] = s;
    });
    var late = 0;
    var excused = 0;
    /** @type {string[]} */
    var paper = [];
    roster.forEach(function (s) {
      var isIn = !!inSet[s.id];
      var state = GW.workStateOf(cid, aid, s.id);
      var st = typeof getAssignmentStatus === 'function' ? getAssignmentStatus(cid, s.id, aid) : '';
      var status = st === 'EXC' ? 'excused' : st === 'NS' && !isIn ? 'missing' : '';
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
      // Solid: work is in, or the piece was assessed with none (to return or returned).
      var solid = isIn || state === 'toreturn' || state === 'returned';
      var kind = solid ? 'in' : status === 'excused' ? 'excused' : 'out';
      var word =
        status === 'excused' ? 'Excused' : solid ? _inWord(state) : status === 'missing' ? 'Missing' : 'Not In Yet';
      var c = {
        sid: s.id,
        name: names[s.id],
        full: displayName(s),
        in: isIn,
        kind: kind,
        status: status,
        state: state,
        word: word,
        paper: !!(mine && mine.on_paper),
        late: !!(mine && mine.is_late),
        file: file,
        mates: mates,
        said: '',
      };
      c.said = _said(c);
      if (kind === 'in' && c.late) late++;
      if (kind === 'in' && c.paper) paper.push(c.full);
      if (status === 'excused') excused++;
      out.students.push(c);
    });
    out.order = out.students
      .filter(function (/** @type {any} */ c) {
        return c.kind === 'in';
      })
      .map(function (/** @type {any} */ c) {
        return c.sid;
      });
    out.notIn = out.students
      .filter(function (/** @type {any} */ c) {
        return c.kind === 'out';
      })
      .map(function (/** @type {any} */ c) {
        return c.sid;
      });
    out.counts = {
      in: out.order.length,
      notin: out.notIn.length,
      late: late,
      excused: excused,
      paper: paper.length,
      all: ids.length,
    };
    out.paperNames = paper;
    out.foot = footText(out.counts, paper);
    return out;
  }

  /** "10 in · 17 not in · 2 Late · Ethan Dubois on paper".
   * @param {{ in: number, notin: number, late: number, excused?: number }} c @param {string[]} paper */
  function footText(c, paper) {
    var s = [c.in + ' in', c.notin + ' not in'];
    if (c.late) s.push(c.late + ' Late');
    if (c.excused) s.push(c.excused + ' Excused');
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
    if (c.kind === 'excused') return ' is-excused';
    if (c.kind === 'out') return c.status === 'missing' ? ' is-out is-missing' : ' is-out';
    var k = ' is-in';
    if (c.state === 'returned') k += ' is-returned';
    else if (c.state === 'tograde' && c.status !== 'excused') k += ' is-tograde';
    if (c.status === 'excused') k += ' is-excused-in';
    if (c.late) k += ' is-late';
    return k;
  }

  /** The word shown in the chip itself where a colour or a line is not enough.
   * @param {any} c */
  function _tag(c) {
    if (c.status === 'excused') return 'Excused';
    if (c.status === 'missing') return 'Missing';
    if (c.late && c.kind === 'in') return 'Late';
    return '';
  }

  /** @param {any} c @param {string} cid @param {string} aid @param {string} form @param {boolean} stop */
  function chipHtml(c, cid, aid, form, stop) {
    var attrs =
      ' data-dash-roll="chip" data-sid="' +
      esc(c.sid) +
      '" data-kind="' +
      c.kind +
      '" aria-label="' +
      esc(c.said) +
      '" title="' +
      esc(c.said) +
      '" tabindex="' +
      (stop ? '0' : '-1') +
      '"';
    var mark = (c.state === 'returned' && c.kind === 'in' ? TICK : '') + (c.paper ? PAPER : '');
    var tag = _tag(c);
    var tagHtml = tag
      ? '<span class="dash-inbox-roll-tag is-' + tag.toLowerCase() + '" aria-hidden="true">' + tag + '</span>'
      : '';
    if (form === 'names') {
      return (
        '<button type="button" class="dash-inbox-roll-chip' +
        _stateClass(c) +
        '"' +
        attrs +
        '><span class="dash-inbox-roll-name">' +
        esc(c.name) +
        '</span>' +
        tagHtml +
        (mark ? '<span class="dash-inbox-roll-marks">' + mark + '</span>' : '') +
        '</button>'
      );
    }
    var page = '';
    if (c.kind === 'in') {
      if (c.file) {
        var key = cid + '|' + aid + '|' + c.sid + '|' + c.file.id;
        _files[key] = c.file;
        page =
          '<img class="dash-inbox-roll-img" draggable="false" data-work-pic data-dash-pic="' +
          esc(key) +
          '" alt="" decoding="async">';
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
      tagHtml +
      (mark ? '<span class="dash-inbox-roll-marks">' + mark + '</span>' : '') +
      '</span><span class="dash-inbox-roll-name">' +
      esc(c.name) +
      '</span></button>'
    );
  }

  /** @param {string} cid */
  function html(cid) {
    _files = {};
    // The piece is the teacher's one choice, shared with Side by Side and Flip Through.
    var drawn = DashInboxPick.draw(cid);
    var aid = drawn.current ? drawn.current.aid : null;
    var key = cid + '|' + aid;
    if (_st.key !== key) _st = { key: key, scroll: 0, refocus: null, keep: null, keepAt: 0, cur: null };
    if (!aid) {
      return '<div class="dash-inbox-roll"><p class="dash-inbox-roll-empty">Nothing is taking work yet.</p></div>';
    }
    var m = model(cid, aid);
    var head = '<div class="dash-inbox-roll-pick" id="dash-inbox-roll-pick">' + DashInboxPick.html(cid) + '</div>';
    var form = _form || 'names';
    // The one Tab stop: the student last focused, else the first.
    var cur = m.students.some(function (/** @type {any} */ c) {
      return c.sid === _st.cur;
    })
      ? _st.cur
      : m.students.length
        ? m.students[0].sid
        : null;
    var chips = m.students
      .map(function (/** @type {any} */ c) {
        return chipHtml(c, cid, aid, form, c.sid === cur);
      })
      .join('');
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
      '">' +
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
    if (!chip || chip.getAttribute('data-kind') !== 'out') {
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
      if (_graderOpen()) return;
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
    // Draw again only if the Dashboard is what is shown.
    var D = /** @type {any} */ (window).PageDashboard;
    if (document.querySelector('#main .dash-glance') && D && D.render) D.render();
  }

  /** Makes `chip` the grid's one Tab stop.
   * @param {HTMLElement} root @param {Element | null} chip */
  function _rove(root, chip) {
    root.querySelectorAll('.dash-inbox-roll-chip').forEach(function (c) {
      c.setAttribute('tabindex', c === chip ? '0' : '-1');
    });
    if (chip) _st.cur = chip.getAttribute('data-sid');
  }

  /** @param {HTMLElement} root @param {string} cid */
  function _bind(root, cid) {
    var aid = root.getAttribute('data-aid') || '';
    root.addEventListener('focusin', function (e) {
      var t = /** @type {any} */ (e.target);
      if (t && t.matches && t.matches('.dash-inbox-roll-chip')) _rove(root, t);
    });
    root.addEventListener('click', function (e) {
      var t = /** @type {any} */ (e.target);
      var el = t && t.closest && t.closest('[data-dash-roll]');
      if (!el || !root.contains(el) || _graderOpen()) return;
      var what = el.getAttribute('data-dash-roll');
      if (what === 'all') {
        var a = _piece(cid, aid);
        if (window.AddWorkClass && a && AddWorkClass.offered(cid, a)) AddWorkClass.open(cid, aid, { onClose: _redraw });
        return;
      }
      var sid = el.getAttribute('data-sid') || '';
      if (what === 'chip') {
        if (el.getAttribute('data-kind') !== 'out') {
          // Work in, assessed or excused: the grader, on that student.
          _menu = null;
          _closeMenu(root);
          _st.refocus = sid;
          _grader(cid, aid, sid, model(cid, aid).order.indexOf(sid) >= 0 ? model(cid, aid).order : [sid], _redraw);
        } else if (_menu && _menu.sid === sid) {
          // The open menu's own chip again closes it.
          _menu = null;
          _closeMenu(root);
        } else {
          _menu = { sid: sid, aid: aid };
          _showMenu(root, cid, el.detail === 0);
        }
        return;
      }
      if (what === 'add') {
        // The menu opens below the chip, so a double click lands on the chip,
        // never on the item; a fast mouse click on the item is still refused.
        if (el.detail > 0 && Date.now() - _openedAt < 250) return;
        var notIn = model(cid, aid).notIn;
        _menu = null;
        _closeMenu(root);
        _st.refocus = sid;
        _grader(cid, aid, sid, notIn.indexOf(sid) >= 0 ? notIn : [sid], _redraw);
      }
    });
    root.addEventListener('keydown', function (e) {
      var k = e.key;
      if (_graderOpen()) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(k) < 0) return;
      var t = /** @type {any} */ (e.target);
      if (!t || !t.matches || !t.matches('.dash-inbox-roll-chip')) return;
      var chips = Array.prototype.slice.call(root.querySelectorAll('.dash-inbox-roll-chip'));
      var at = chips.indexOf(t);
      var to = at;
      if (k === 'ArrowLeft') to = at - 1;
      else if (k === 'ArrowRight') to = at + 1;
      else if (k === 'Home') to = 0;
      else if (k === 'End') to = chips.length - 1;
      else {
        // Up and down: the chip in the nearest row above or below, nearest across.
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
      _rove(root, chips[to]);
      chips[to].focus();
    });
  }

  /* ── Mount ─────────────────────────────────────────────── */
  /** Reads the tile's real height. When it is not the form drawn, this view
   * alone is drawn again in place and true comes back: the caller carries on
   * with nothing more. Otherwise the pages grid is sized.
   * @param {HTMLElement} root @param {HTMLElement} tile @param {string} cid
   * @returns {boolean} */
  function _measure(root, tile, cid) {
    var grid = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-roll-grid'));
    if (!grid) return false;
    var h = tile.getBoundingClientRect().height;
    if (!h) return false;
    var form = formFor(h);
    var drawn = root.classList.contains('is-pages') ? 'pages' : 'names';
    if (form !== drawn) {
      _form = form;
      _swap(root, tile, cid);
      return true;
    }
    _form = form;
    if (form === 'pages') {
      var m = root.getBoundingClientRect();
      var top = grid.getBoundingClientRect().top - m.top;
      var foot = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-roll-foot'));
      var room = m.height - top - (foot ? foot.offsetHeight : 0) - 8;
      var n = root.querySelectorAll('.dash-inbox-roll-chip').length;
      var lay = layoutFor(n, grid.clientWidth || 629, room > 0 ? room : 120);
      grid.style.setProperty('--dash-inbox-roll-cols', String(lay.cols));
      grid.style.setProperty('--dash-inbox-roll-pg', lay.pageH + 'px');
    }
    return false;
  }

  /** Draws this view again where it stands, in the other form.
   * @param {HTMLElement} root @param {HTMLElement} tile @param {string} cid */
  function _swap(root, tile, cid) {
    _swaps++;
    if (_undo) _undo();
    _undo = null;
    _closeMenu(root);
    var fresh = document.createElement('div');
    // html-safe: html() builds the view; every name and title goes through esc
    fresh.innerHTML = html(cid);
    var next = /** @type {HTMLElement | null} */ (fresh.querySelector('.dash-inbox-roll[data-aid]'));
    if (!next) return;
    root.replaceWith(next);
    _attach(next, tile, cid);
    // Pictures the old form held and this one does not show are let go.
    var pics = window.DashInbox && DashInbox.pics();
    if (pics) pics.sweep();
  }

  /** Fills the pictures through the tile's holder, inside mount: the sweep
   * runs right after it. Keys start with the class id.
   * @param {HTMLElement} root @param {string} cid */
  function _fill(root, cid) {
    var pics = window.DashInbox && DashInbox.pics();
    if (!pics) return;
    pics.fill(root, cid, function (/** @type {HTMLElement} */ img) {
      return _files[img.getAttribute('data-dash-pic') || ''] || null;
    });
  }

  /** Everything a drawn root needs: its listeners, the switch, the scroll,
   * the menu, the form, the pictures, the focus.
   * @param {HTMLElement} root @param {HTMLElement} tile @param {string} cid */
  function _attach(root, tile, cid) {
    var aid = root.getAttribute('data-aid') || '';
    _bind(root, cid);
    // A pick calls set, redraws, and the pressed button keeps the focus.
    DashInboxPick.mount(root, cid, _redraw);
    if (_measure(root, tile, cid)) return;
    var grid = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-roll-grid'));
    if (grid) grid.scrollTop = _st.scroll;
    if (_menu && _menu.aid === aid) _showMenu(root, cid, false);
    else _menu = null;
    _fill(root, cid);
    // The student who opened the grader, or who had the focus when the draw began.
    var want = _st.refocus || (Date.now() - _st.keepAt < 2000 ? _st.keep : null);
    _st.refocus = null;
    _st.keep = null;
    if (want) {
      var back = /** @type {HTMLElement | null} */ (
        root.querySelector('.dash-inbox-roll-chip[data-sid="' + CSS.escape(want) + '"]')
      );
      if (back) {
        _rove(root, back);
        back.focus({ preventScroll: true });
      }
    }
    var mine = _st.key;
    _undo = function () {
      // The scroll and the focus as they stand, before the page is drawn again.
      if (grid && grid.isConnected && _st.key === mine) _st.scroll = grid.scrollTop;
      var on = document.activeElement;
      if (on && root.contains(on) && on.classList && on.classList.contains('dash-inbox-roll-chip')) {
        _st.keep = on.getAttribute('data-sid');
        _st.keepAt = Date.now();
      }
      DashInboxPick.unmount(root);
    };
  }

  /** @param {HTMLElement} tile @param {string} cid */
  function mount(tile, cid) {
    unmount();
    var found = /** @type {HTMLElement | null} */ (tile.querySelector('.dash-inbox-roll[data-aid]'));
    if (!found) return;
    _attach(found, tile, cid);
    if (window.ResizeObserver) {
      var tick = 0;
      _watch = new ResizeObserver(function () {
        clearTimeout(tick);
        tick = window.setTimeout(function () {
          var root = /** @type {HTMLElement | null} */ (tile.querySelector('.dash-inbox-roll[data-aid]'));
          if (root && document.getElementById('dash-inbox') === tile) _measure(root, tile, cid);
        }, 60);
      });
      _watch.observe(tile);
    }
  }

  function unmount() {
    if (_undo) _undo();
    _undo = null;
    if (_watch) {
      _watch.disconnect();
      _watch = null;
    }
    if (_off) {
      document.removeEventListener('click', _off, true);
      document.removeEventListener('keydown', _off, true);
      _off = null;
    }
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
    /** Test hooks: what is live, and how often this view was drawn in place. */
    live: function () {
      return { observer: !!_watch, undo: !!_undo, menuListener: !!_off, swaps: _swaps };
    },
    /** Test hook: the form the next draw starts in. @param {'names' | 'pages' | null} f */
    setForm: function (f) {
      _form = f;
    },
    /** Test hook: forget the module's state. */
    reset: function () {
      _menu = null;
      _form = null;
      _swaps = 0;
      _st = { key: '', scroll: 0, refocus: null, keep: null, keepAt: 0, cur: null };
    },
  };
})();
