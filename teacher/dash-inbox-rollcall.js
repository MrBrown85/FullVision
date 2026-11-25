// @ts-check
/* dash-inbox-rollcall.js — the Inbox's Roll Call (slice I2 of
   docs/plans/inbox-redesign-plan.md; board Rev-RollCall). The whole class for
   one assessment, read down four columns in class-list order. Drawn only when
   BuildFlags.on('inboxStacks'); the tile's header is another slice's.

   Row 1: arrows around a menu button that is the assessment's title (a
   listbox of every piece whose work the teacher's screens show, newest dated
   first, pieces with nothing in yet among them), and three toggle buttons
   that are also the legend: To Grade, Returned, Not In. Below: one button per
   student, 38 px tall, with the mark and the name.

   Every state is GraderWork's (workStateOf, workInIds) and the app's own
   Missing and Excused reading (getAssignmentStatus). Work that is in but
   neither to grade nor returned is drawn solid with no tick. This file
   writes no grade: its one write is Handed In on Paper, the existing
   markStudentWorkOnPaper, and Add a Scan or Photo opens the grader.

   What must outlast a Dashboard redraw (the open menu, the filter, the
   focused student, the grid's scroll) is kept in this module. */
window.DashInboxRollCall = (function () {
  'use strict';

  var PIECE_KEY = 'fv-dash-inbox-rollpiece:';
  // A column is never narrower than this, so no name is cut to nothing.
  var COL_MIN = 132;
  var COL_GAP = 10;
  var ROW_H = 38;
  var ROW_GAP = 3;

  /** What is open over the tile: the piece list, or one student's menu.
   * @type {{ kind: 'list' } | { kind: 'menu', sid: string, aid: string } | null} */
  var _open = null;
  /** The filter: one of the three states, kept for one piece of one class.
   * @type {{ key: string, state: 'tograde' | 'returned' | 'notin' } | null} */
  var _filter = null;
  /** The grid's scroll; what to focus once a draw or the grader is over; the one Tab stop.
   * @type {{ key: string, scroll: number, refocus: string | null, cur: string | null }} */
  var _st = { key: '', scroll: 0, refocus: null, cur: null };
  /** @type {(() => void) | null} */
  var _undo = null;
  /** @type {any} */
  var _watch = null;
  /** @type {any} */
  var _off = null;

  /** @returns {any} */
  function _gw() {
    return /** @type {any} */ (window).GraderWork || null;
  }
  /** The grader is over the tile: what happens under it is not ours.
   * @returns {boolean} */
  function _graderOpen() {
    return !!document.getElementById('grader-overlay');
  }

  /* ── The choice of piece, kept per class ───────────────── */
  /** @param {string} cid @returns {string | null} */
  function _kept(cid) {
    try {
      return localStorage.getItem(PIECE_KEY + cid);
    } catch (e) {
      return null;
    }
  }
  /** @param {string} cid @param {string} aid */
  function _keep(cid, aid) {
    try {
      localStorage.setItem(PIECE_KEY + cid, aid);
    } catch (e) {
      /* blocked storage: the choice lasts this visit */
    }
  }

  /* ── The model ─────────────────────────────────────────── */
  /** @param {string} cid */
  function _students(cid) {
    var all = getStudents(cid) || [];
    var I = /** @type {any} */ (window).DashInsights;
    return I && I.sortStudents ? I.sortStudents(cid, all, 'last-asc', {}) : sortStudents(all, 'lastName');
  }

  /** Every piece whose work the teacher's screens show, newest dated first,
   * each with the students waiting on the teacher.
   * @param {string} cid
   * @returns {{ aid: string, title: string, toGrade: number, when: string }[]} */
  function pieces(cid) {
    var GW = _gw();
    if (!cid || !GW || typeof getAssessments !== 'function') return [];
    var ids = (getStudents(cid) || []).map(function (s) {
      return s.id;
    });
    var cc =
      window.DashOverview && DashOverview.classWorkCounts
        ? DashOverview.classWorkCounts(cid, ids)
        : GW.classWorkCounts(cid, ids);
    /** @type {Record<string, number>} */
    var waiting = {};
    ((cc && cc.pieces) || []).forEach(function (/** @type {any} */ c) {
      waiting[c.aid] = c.tograde || 0;
    });
    var out = [];
    (getAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (!a || !a.id || !GW.workShown(cid, a)) return;
      out.push({
        aid: String(a.id),
        title: String(a.title || 'Untitled'),
        toGrade: waiting[a.id] || 0,
        when: String(a.date || a.dueDate || ''),
      });
    });
    out.sort(function (x, y) {
      return x.when < y.when ? 1 : x.when > y.when ? -1 : x.title < y.title ? -1 : x.title > y.title ? 1 : 0;
    });
    return out;
  }

  /** The chosen piece: the one kept for this class, else the first with work
   * to grade, else the newest.
   * @param {string} cid
   * @param {{ aid: string, toGrade: number }[]} [list]
   * @returns {string | null} */
  function current(cid, list) {
    var all = list || pieces(cid);
    if (!all.length) return null;
    var kept = _kept(cid);
    var found = all.filter(function (p) {
      return p.aid === kept;
    })[0];
    if (found) return found.aid;
    return (
      all.filter(function (p) {
        return p.toGrade > 0;
      })[0] || all[0]
    ).aid;
  }

  /** One student's words, as the old Roll Call words them.
   * @param {any} c */
  function _said(c) {
    var bits = [c.word];
    if (c.state === 'returned' && c.status !== 'excused' && c.in) bits[0] += ', returned';
    if (c.paper) bits.push('On Paper');
    if (c.late) bits.push('Late');
    if (c.mates.length) bits.push('with ' + c.mates.join(' and '));
    return c.full + ': ' + bits.join(', ');
  }

  /** The class for one piece, in class-list order. Each student's `mark` is
   * 'tograde', 'returned', 'notin', or 'in' (work in, or assessed, or
   * excused: solid, no tick).
   * @param {string} cid @param {string} aid
   * @returns {{ aid: string, title: string, students: any[], counts: { tograde: number, returned: number, notin: number, all: number }, order: string[], notIn: string[] }} */
  function model(cid, aid) {
    var GW = _gw();
    var out = {
      aid: aid,
      title: '',
      students: /** @type {any[]} */ ([]),
      counts: { tograde: 0, returned: 0, notin: 0, all: 0 },
      order: /** @type {string[]} */ ([]),
      notIn: /** @type {string[]} */ ([]),
    };
    var a = (getAssessments(cid) || []).filter(function (/** @type {any} */ x) {
      return x && x.id === aid;
    })[0];
    if (!GW || !a) return out;
    out.title = String(a.title || 'Untitled');
    var roster = _students(cid);
    var ids = roster.map(function (s) {
      return s.id;
    });
    /** @type {Record<string, boolean>} */
    var inSet = {};
    GW.workInIds(cid, aid, ids).forEach(function (/** @type {string} */ id) {
      inSet[id] = true;
    });
    /** @type {Record<string, any>} */
    var byId = {};
    roster.forEach(function (s) {
      byId[s.id] = s;
    });
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
      var solid = isIn || state === 'toreturn' || state === 'returned';
      var excused = status === 'excused';
      /** @type {'tograde' | 'returned' | 'notin' | 'in'} */
      var mark = 'in';
      if (!solid && !excused) mark = 'notin';
      else if (!excused && state === 'tograde') mark = 'tograde';
      else if (!excused && state === 'returned') mark = 'returned';
      var word = excused
        ? 'Excused'
        : solid
          ? state === 'tograde'
            ? 'To Grade'
            : 'Assessed'
          : status === 'missing'
            ? 'Missing'
            : 'Not In Yet';
      var c = {
        sid: s.id,
        name: displayNameWithLast(s) || displayName(s),
        full: displayName(s),
        in: isIn,
        mark: mark,
        state: state,
        status: status,
        word: word,
        paper: !!(mine && mine.on_paper),
        late: !!(mine && mine.is_late),
        mates: mates,
        said: '',
      };
      c.said = _said(c);
      out.students.push(c);
    });
    out.counts = {
      tograde: out.students.filter(function (c) {
        return c.mark === 'tograde';
      }).length,
      returned: out.students.filter(function (c) {
        return c.mark === 'returned';
      }).length,
      notin: out.students.filter(function (c) {
        return c.mark === 'notin';
      }).length,
      all: out.students.length,
    };
    out.order = out.students
      .filter(function (c) {
        return c.mark !== 'notin' && c.status !== 'excused';
      })
      .map(function (c) {
        return c.sid;
      });
    out.notIn = out.students
      .filter(function (c) {
        return c.mark === 'notin';
      })
      .map(function (c) {
        return c.sid;
      });
    return out;
  }

  /** The columns a tile this wide holds, at least COL_MIN each.
   * @param {number} w
   * @returns {number} */
  function colsFor(w) {
    for (var c = 4; c > 2; c--) {
      if ((w - (c - 1) * COL_GAP) / c >= COL_MIN) return c;
    }
    return 2;
  }

  /* ── Drawing ───────────────────────────────────────────── */
  var TICK =
    '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 6.3 5 8.6 9.5 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ARROW_L =
    '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ARROW_R =
    '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M5 2l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CARET =
    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** @param {'tograde' | 'returned' | 'notin' | 'in'} mark */
  function _glyph(mark) {
    return (
      '<span class="dash-inbox-rc-g is-' +
      mark +
      '" aria-hidden="true">' +
      (mark === 'returned' ? TICK : '') +
      '</span>'
    );
  }

  /** @param {string} cid @param {string} aid */
  function _filterOf(cid, aid) {
    return _filter && _filter.key === cid + '|' + aid ? _filter.state : null;
  }

  /** @param {string} cid */
  function html(cid) {
    var list = pieces(cid);
    var aid = current(cid, list);
    if (!aid) {
      return '<div class="dash-inbox-rollcall"><p class="dash-inbox-rc-empty">Nothing is taking work yet.</p></div>';
    }
    var key = cid + '|' + aid;
    if (_st.key !== key) _st = { key: key, scroll: 0, refocus: null, cur: null };
    var m = model(cid, aid);
    var at = list.findIndex(function (p) {
      return p.aid === aid;
    });
    var want = _filterOf(cid, aid);
    if (want && !m.counts[want]) {
      _filter = null;
      want = null;
    }
    var cur = m.students.some(function (c) {
      return c.sid === _st.cur;
    })
      ? _st.cur
      : m.students.length
        ? m.students[0].sid
        : null;
    var cols = 4;
    var rows = Math.max(1, Math.ceil(m.students.length / cols));
    /** @param {'tograde' | 'returned' | 'notin'} k @param {string} label */
    var keyBtn = function (k, label) {
      if (!m.counts[k]) return '';
      return (
        '<button type="button" class="dash-inbox-rc-key" data-dash-rc="key" data-state="' +
        k +
        '" aria-pressed="' +
        (want === k ? 'true' : 'false') +
        '">' +
        _glyph(k) +
        m.counts[k] +
        ' ' +
        label +
        '</button>'
      );
    };
    var rowOne =
      '<div class="dash-inbox-rc-bar">' +
      '<button type="button" class="dash-inbox-rc-nav" data-dash-rc="prev" aria-label="Previous assessment"' +
      (at <= 0 ? ' aria-disabled="true"' : '') +
      '>' +
      ARROW_L +
      '</button>' +
      '<button type="button" class="dash-inbox-rc-title" data-dash-rc="title" aria-haspopup="listbox" aria-expanded="' +
      (_open && _open.kind === 'list' ? 'true' : 'false') +
      '"><span class="dash-inbox-rc-title-text">' +
      esc(m.title) +
      '</span>' +
      CARET +
      '</button>' +
      '<button type="button" class="dash-inbox-rc-nav" data-dash-rc="next" aria-label="Next assessment"' +
      (at >= list.length - 1 ? ' aria-disabled="true"' : '') +
      '>' +
      ARROW_R +
      '</button>' +
      '<div class="dash-inbox-rc-keys" role="group" aria-label="Pick out students">' +
      keyBtn('tograde', 'To Grade') +
      keyBtn('returned', 'Returned') +
      keyBtn('notin', 'Not In') +
      '</div></div>';
    var students = m.students
      .map(function (c) {
        var plain = want && c.mark !== want ? ' is-plain' : '';
        return (
          '<li class="dash-inbox-rc-li"><button type="button" class="dash-inbox-rc-st is-' +
          c.mark +
          plain +
          '" data-dash-rc="st" data-sid="' +
          esc(c.sid) +
          '" data-mark="' +
          c.mark +
          '" aria-label="' +
          esc(c.said) +
          '" title="' +
          esc(c.said) +
          '" tabindex="' +
          (c.sid === cur ? '0' : '-1') +
          '">' +
          _glyph(c.mark) +
          '<span class="dash-inbox-rc-nm">' +
          esc(c.name) +
          '</span></button></li>'
        );
      })
      .join('');
    return (
      '<div class="dash-inbox-rollcall" data-aid="' +
      esc(aid) +
      '">' +
      rowOne +
      '<ul class="dash-inbox-rc-grid" id="dash-inbox-rc-grid" aria-label="' +
      esc(m.title + ': the class, in class-list order') +
      '" style="--dash-inbox-rc-cols:' +
      cols +
      ';--dash-inbox-rc-rows:' +
      rows +
      '">' +
      students +
      '</ul></div>'
    );
  }

  /* ── Popups: the piece list and the not-in menu ───────── */
  /** @param {HTMLElement} root */
  function _closePop(root) {
    root.querySelectorAll('.dash-inbox-rc-pop').forEach(function (p) {
      p.remove();
    });
    root.querySelectorAll('.dash-inbox-rc-st.is-open').forEach(function (c) {
      c.classList.remove('is-open');
      c.removeAttribute('aria-expanded');
    });
    var t = root.querySelector('.dash-inbox-rc-title');
    if (t) t.setAttribute('aria-expanded', 'false');
    if (_off) {
      document.removeEventListener('click', _off, true);
      document.removeEventListener('keydown', _off, true);
      _off = null;
    }
  }

  /** Puts a popup under `anchor` (above when there is no room).
   * @param {HTMLElement} root @param {HTMLElement} pop @param {HTMLElement} anchor @param {boolean} left */
  function _place(root, pop, anchor, left) {
    var o = root.getBoundingClientRect();
    var r = anchor.getBoundingClientRect();
    var top = r.bottom - o.top + 4;
    if (top + pop.offsetHeight > o.height && r.top - o.top - pop.offsetHeight - 4 >= 0) {
      top = r.top - o.top - pop.offsetHeight - 4;
    }
    var x = left ? r.left - o.left : r.left - o.left + Math.min(24, r.width / 2);
    x = Math.min(Math.max(0, x), Math.max(0, o.width - pop.offsetWidth));
    pop.style.top = Math.max(0, top) + 'px';
    pop.style.left = x + 'px';
  }

  /** Escape and a click outside close the popup; the focus goes back to its opener.
   * @param {HTMLElement} root @param {HTMLElement} opener */
  function _listenOff(root, opener) {
    _off = function (/** @type {Event} */ e) {
      if (_graderOpen()) return;
      if (e.type === 'keydown') {
        if (/** @type {KeyboardEvent} */ (e).key !== 'Escape') return;
        e.stopPropagation();
        _open = null;
        _closePop(root);
        opener.focus();
        return;
      }
      var t = /** @type {any} */ (e.target);
      if (t && t.closest && (t.closest('.dash-inbox-rc-pop') || opener.contains(t))) return;
      _open = null;
      _closePop(root);
    };
    document.addEventListener('click', _off, true);
    document.addEventListener('keydown', _off, true);
  }

  /** @param {HTMLElement} root @param {string} cid @param {boolean} focus */
  function _showList(root, cid, focus) {
    _closePop(root);
    var btn = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-rc-title'));
    if (!btn || !_open || _open.kind !== 'list') return;
    var list = pieces(cid);
    var now = current(cid, list);
    var pop = document.createElement('div');
    pop.className = 'dash-inbox-rc-pop is-list';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-label', 'Assessment');
    // html-safe: each title goes through esc
    pop.innerHTML = list
      .map(function (p) {
        return (
          '<button type="button" role="option" class="dash-inbox-rc-opt" data-dash-rc="opt" data-aid="' +
          esc(p.aid) +
          '" aria-selected="' +
          (p.aid === now ? 'true' : 'false') +
          '" tabindex="-1"><span class="dash-inbox-rc-opt-t">' +
          esc(p.title) +
          '</span>' +
          (p.toGrade ? '<span class="dash-inbox-rc-opt-n">' + p.toGrade + ' To Grade</span>' : '') +
          '</button>'
        );
      })
      .join('');
    root.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    _place(root, pop, btn, true);
    var sel = /** @type {HTMLElement | null} */ (pop.querySelector('[aria-selected="true"]'));
    if (focus && sel) sel.focus({ preventScroll: true });
    if (sel) pop.scrollTop = Math.max(0, sel.offsetTop - 40);
    _listenOff(root, btn);
  }

  /** @param {HTMLElement} root @param {boolean} focus */
  function _showMenu(root, focus) {
    _closePop(root);
    if (!_open || _open.kind !== 'menu') return;
    var chip = /** @type {HTMLElement | null} */ (
      root.querySelector('.dash-inbox-rc-st[data-sid="' + CSS.escape(_open.sid) + '"]')
    );
    if (!chip || chip.getAttribute('data-mark') !== 'notin') {
      _open = null;
      return;
    }
    chip.classList.add('is-open');
    chip.setAttribute('aria-expanded', 'true');
    var pop = document.createElement('div');
    pop.className = 'dash-inbox-rc-pop is-menu';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', chip.getAttribute('title') || 'Not in');
    pop.innerHTML =
      '<button type="button" role="menuitem" class="dash-inbox-rc-item" data-dash-rc="paper" data-sid="' +
      esc(_open.sid) +
      '">Handed In on Paper</button>' +
      '<button type="button" role="menuitem" class="dash-inbox-rc-item" data-dash-rc="scan" data-sid="' +
      esc(_open.sid) +
      '">Add a Scan or Photo</button>';
    root.appendChild(pop);
    _place(root, pop, chip, false);
    if (focus) {
      var first = /** @type {HTMLElement | null} */ (pop.querySelector('.dash-inbox-rc-item'));
      if (first) first.focus({ preventScroll: true });
    }
    _listenOff(root, chip);
  }

  /* ── Acting ────────────────────────────────────────────── */
  function _redraw() {
    // Draw again only if the Dashboard is what is shown.
    var D = /** @type {any} */ (window).PageDashboard;
    if (document.querySelector('#main .dash-glance') && D && D.render) D.render();
  }

  /** Draws this view again where it stands, without the rest of the page.
   * @param {string} cid @param {string | null} focus
   * @returns {boolean} */
  function _here(cid, focus) {
    var root = /** @type {HTMLElement | null} */ (document.querySelector('#dash-inbox .dash-inbox-rollcall[data-aid]'));
    var tile = document.getElementById('dash-inbox');
    if (!root || !tile) return false;
    if (_undo) _undo();
    _undo = null;
    _closePop(root);
    var fresh = document.createElement('div');
    // html-safe: html() builds the view; every name and title goes through esc
    fresh.innerHTML = html(cid);
    var next = /** @type {HTMLElement | null} */ (fresh.querySelector('.dash-inbox-rollcall'));
    if (!next) return false;
    root.replaceWith(next);
    if (focus) _st.refocus = focus;
    _attach(next, cid);
    return true;
  }

  /** @param {string} cid @param {string} aid @param {string | null} focus */
  function _choose(cid, aid, focus) {
    _keep(cid, aid);
    _filter = null;
    _open = null;
    if (!_here(cid, focus)) _redraw();
  }

  /** @param {string} cid @param {number} by @param {string} focus */
  function _step(cid, by, focus) {
    var list = pieces(cid);
    var at = list.findIndex(function (p) {
      return p.aid === current(cid, list);
    });
    var to = list[at + by];
    if (to) _choose(cid, to.aid, focus);
  }

  /** Handed In on Paper: the existing write, then the Dashboard draws again. A
   * failed write shows on the sync dot alone.
   * @param {string} cid @param {string} aid @param {string} sid
   * @returns {Promise<any>} */
  function paper(cid, aid, sid) {
    var done = function () {
      _redraw();
    };
    var p = Promise.resolve(markStudentWorkOnPaper(cid, aid, [sid]));
    p.then(done, done);
    return p.catch(function () {
      return null;
    });
  }

  /** The students a state picks out.
   * @param {string} cid @param {string} aid @param {string} state
   * @returns {string[]} */
  function picked(cid, aid, state) {
    return model(cid, aid)
      .students.filter(function (c) {
        return c.mark === state;
      })
      .map(function (c) {
        return c.sid;
      });
  }

  /** @param {string} cid @param {string} aid @param {string} sid @param {string[]} order */
  function _grader(cid, aid, sid, order) {
    if (!window.PageAssignments || !PageAssignments.openGrader) return;
    _st.refocus = 'sid:' + sid;
    PageAssignments.openGrader(cid, aid, sid, { studentIds: order, onClose: _redraw });
  }

  /** @param {HTMLElement} root @param {Element | null} chip */
  function _rove(root, chip) {
    root.querySelectorAll('.dash-inbox-rc-st').forEach(function (c) {
      c.setAttribute('tabindex', c === chip ? '0' : '-1');
    });
    if (chip) _st.cur = chip.getAttribute('data-sid');
  }

  /** Picks out one state's students, or clears the pick. No redraw.
   * @param {HTMLElement} root @param {string} cid @param {string} aid @param {'tograde' | 'returned' | 'notin'} state */
  function _toggle(root, cid, aid, state) {
    var on = _filterOf(cid, aid) === state;
    _filter = on ? null : { key: cid + '|' + aid, state: state };
    var want = on ? null : state;
    root.querySelectorAll('.dash-inbox-rc-key').forEach(function (b) {
      b.setAttribute('aria-pressed', want && b.getAttribute('data-state') === want ? 'true' : 'false');
    });
    root.querySelectorAll('.dash-inbox-rc-st').forEach(function (c) {
      c.classList.toggle('is-plain', !!want && c.getAttribute('data-mark') !== want);
    });
  }

  /** @param {HTMLElement} root @param {string} cid */
  function _bind(root, cid) {
    var aid = root.getAttribute('data-aid') || '';
    root.addEventListener('focusin', function (e) {
      var t = /** @type {any} */ (e.target);
      if (t && t.matches && t.matches('.dash-inbox-rc-st')) _rove(root, t);
    });
    root.addEventListener('click', function (e) {
      var t = /** @type {any} */ (e.target);
      var el = t && t.closest && t.closest('[data-dash-rc]');
      if (!el || !root.contains(el) || _graderOpen()) return;
      var what = el.getAttribute('data-dash-rc');
      var sid = el.getAttribute('data-sid') || '';
      if (what === 'prev' || what === 'next') {
        if (el.getAttribute('aria-disabled') !== 'true') _step(cid, what === 'next' ? 1 : -1, what);
        return;
      }
      if (what === 'title') {
        if (_open && _open.kind === 'list') {
          _open = null;
          _closePop(root);
        } else {
          _open = { kind: 'list' };
          _showList(root, cid, true);
        }
        return;
      }
      if (what === 'opt') {
        _choose(cid, el.getAttribute('data-aid') || '', 'title');
        return;
      }
      if (what === 'key') {
        _toggle(root, cid, aid, /** @type {any} */ (el.getAttribute('data-state')));
        return;
      }
      if (what === 'st') {
        if (el.getAttribute('data-mark') !== 'notin') {
          _open = null;
          _closePop(root);
          var order = model(cid, aid).order;
          _grader(cid, aid, sid, order.indexOf(sid) >= 0 ? order : [sid]);
        } else if (_open && _open.kind === 'menu' && _open.sid === sid) {
          _open = null;
          _closePop(root);
        } else {
          _open = { kind: 'menu', sid: sid, aid: aid };
          _showMenu(root, true);
        }
        return;
      }
      if (what === 'scan') {
        var notIn = model(cid, aid).notIn;
        _open = null;
        _closePop(root);
        _grader(cid, aid, sid, notIn.indexOf(sid) >= 0 ? notIn : [sid]);
        return;
      }
      if (what === 'paper') {
        _open = null;
        _closePop(root);
        _st.refocus = 'sid:' + sid;
        paper(cid, aid, sid);
      }
    });
    root.addEventListener('keydown', function (e) {
      if (_graderOpen()) return;
      var k = e.key;
      var t = /** @type {any} */ (e.target);
      if (!t || !t.closest) return;
      // The piece button opens its list on Down; inside a popup the arrows move between its items.
      var pop = t.closest('.dash-inbox-rc-pop');
      if (pop) {
        var items = Array.prototype.slice.call(pop.querySelectorAll('[role="option"], [role="menuitem"]'));
        var at = items.indexOf(t);
        var to = -1;
        if (k === 'ArrowDown') to = Math.min(items.length - 1, at + 1);
        else if (k === 'ArrowUp') to = Math.max(0, at - 1);
        else if (k === 'Home') to = 0;
        else if (k === 'End') to = items.length - 1;
        else if (k === 'Tab') {
          var op = _open;
          _open = null;
          _closePop(root);
          if (op && op.kind === 'menu') {
            var back = root.querySelector('.dash-inbox-rc-st[data-sid="' + CSS.escape(op.sid) + '"]');
            if (back) /** @type {HTMLElement} */ (back).focus();
          }
          return;
        }
        if (to < 0) return;
        e.preventDefault();
        if (items[to]) items[to].focus({ preventScroll: true });
        return;
      }
      if (t.matches('.dash-inbox-rc-title') && (k === 'ArrowDown' || k === 'ArrowUp')) {
        e.preventDefault();
        _open = { kind: 'list' };
        _showList(root, cid, true);
        return;
      }
      if (!t.matches('.dash-inbox-rc-st')) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(k) < 0) return;
      var chips = Array.prototype.slice.call(root.querySelectorAll('.dash-inbox-rc-st'));
      var here = chips.indexOf(t);
      var grid = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-rc-grid'));
      var rows = grid ? parseInt(grid.style.getPropertyValue('--dash-inbox-rc-rows'), 10) || 1 : 1;
      // The grid is read down its columns: Down is the next student, Right is a column over.
      var go = here;
      if (k === 'ArrowDown') go = here + 1;
      else if (k === 'ArrowUp') go = here - 1;
      else if (k === 'ArrowRight') go = here + rows;
      else if (k === 'ArrowLeft') go = here - rows;
      else if (k === 'Home') go = 0;
      else go = chips.length - 1;
      if (go < 0 || go >= chips.length || go === here) return;
      e.preventDefault();
      _rove(root, chips[go]);
      chips[go].focus();
    });
  }

  /* ── Mount ─────────────────────────────────────────────── */
  /** Sets the columns the tile's width holds, and the rows the class needs.
   * @param {HTMLElement} root */
  function _layout(root) {
    var grid = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-rc-grid'));
    if (!grid) return;
    var w = grid.clientWidth || root.clientWidth;
    if (!w) return;
    var n = grid.querySelectorAll('.dash-inbox-rc-st').length;
    var cols = colsFor(w);
    grid.style.setProperty('--dash-inbox-rc-cols', String(cols));
    grid.style.setProperty('--dash-inbox-rc-rows', String(Math.max(1, Math.ceil(n / cols))));
  }

  /** @param {HTMLElement} root @param {string} cid */
  function _attach(root, cid) {
    _bind(root, cid);
    _layout(root);
    var grid = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-rc-grid'));
    if (grid) grid.scrollTop = _st.scroll;
    if (_open && _open.kind === 'menu' && _open.aid === root.getAttribute('data-aid')) _showMenu(root, false);
    else if (_open && _open.kind === 'list') _showList(root, cid, false);
    else _open = null;
    var want = _st.refocus;
    _st.refocus = null;
    if (want) {
      /** @type {HTMLElement | null} */
      var back = null;
      if (want.indexOf('sid:') === 0) {
        back = root.querySelector('.dash-inbox-rc-st[data-sid="' + CSS.escape(want.slice(4)) + '"]');
        if (back) _rove(root, back);
      } else back = root.querySelector('[data-dash-rc="' + want + '"]');
      if (back) back.focus({ preventScroll: true });
    }
    var mine = _st.key;
    _undo = function () {
      if (grid && grid.isConnected && _st.key === mine) _st.scroll = grid.scrollTop;
    };
  }

  /** @param {HTMLElement} tile @param {string} cid */
  function mount(tile, cid) {
    unmount();
    var found = /** @type {HTMLElement | null} */ (tile.querySelector('.dash-inbox-rollcall[data-aid]'));
    if (!found) return;
    _attach(found, cid);
    if (window.ResizeObserver) {
      var tick = 0;
      _watch = new ResizeObserver(function () {
        clearTimeout(tick);
        tick = window.setTimeout(function () {
          var root = /** @type {HTMLElement | null} */ (tile.querySelector('.dash-inbox-rollcall[data-aid]'));
          if (root && document.getElementById('dash-inbox') === tile) _layout(root);
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

  /** Roll Call on this piece: kept for the class, the tile switched to this
   * view, and drawn.
   * @param {string} cid @param {string} aid */
  function show(cid, aid) {
    _keep(cid, aid);
    _filter = null;
    _open = null;
    var inbox = /** @type {any} */ (window).DashInbox;
    if (inbox && inbox.setView) inbox.setView(cid, 'rollcall');
    _redraw();
  }

  var bf = /** @type {any} */ (window).BuildFlags;
  var inbox = /** @type {any} */ (window).DashInbox;
  if (inbox && bf && bf.on('inboxStacks')) {
    inbox.addView({ key: 'rollcall', label: 'Roll Call', html: html, mount: mount, unmount: unmount });
  }

  return {
    model: model,
    pieces: pieces,
    current: current,
    colsFor: colsFor,
    html: html,
    show: show,
    paper: paper,
    picked: picked,
    mount: mount,
    unmount: unmount,
    PIECE_KEY: PIECE_KEY,
    ROW_H: ROW_H,
    ROW_GAP: ROW_GAP,
    /** Test hook: forget the module's state. */
    reset: function () {
      _open = null;
      _filter = null;
      _st = { key: '', scroll: 0, refocus: null, cur: null };
    },
  };
})();
