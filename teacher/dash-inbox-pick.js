// @ts-check
/* dash-inbox-pick.js — the assessment switch the Inbox's views share (D6 of
   docs/plans/dashboard-inbox-plan.md; board C2's "Light Refraction Lab · 6 In"
   row). Side by Side, Flip Through and Roll Call all use it.

   THE CONTRACT. The piece list is worked out once per draw and shared:
   - draw(cid) → { pieces, current }. pieces: [{ aid, title, inCount,
     toGrade }], the class's pieces whose work the teacher's screens show
     (GraderWork.workShown) and that have work in, newest work first. current:
     the chosen piece of that list, { aid, title, inCount, toGrade }, or null
     with nothing in. A view takes both from here and counts nothing again.
   - pieces(cid) → the same list; current(cid) → current's aid or null. The
     chosen piece is the one kept for this class on this device; with none
     kept (or the kept one gone), the first piece with work to grade, newest
     first, and only then the first piece with work in.
   - set(cid, aid) keeps the choice. html(cid) is the switch: one button a
     piece, the current one pressed (aria-pressed), scrolling sideways inside
     itself. mount(root, cid, onChange) / unmount(root): one delegated click
     and key listener; a pick calls set, then onChange(aid); the left and
     right arrows move between the buttons; after the redraw the pressed
     button has the focus if the switch had it.

   COUNTING. The class is counted once per draw, by DashOverview's shared
   classWorkCounts (the same answer the top bar's To Grade and the Inbox
   use): toGrade comes from its pieces[]. inCount is the students whose work
   is in (sent work from enrolled students), read from the class's work in
   one pass; only a piece worked as pairs or groups asks
   GraderWork.workInIds, because a group-mate's work is theirs too. Nothing
   here calls GraderWork.workCounts per piece. The list is kept only while
   the draw's shared answer is the same object, so a new send or score shows
   on the next draw; outside a draw every call counts afresh. */
window.DashInboxPick = (function () {
  'use strict';

  var KEY = 'fv-dash-inbox-piece:';

  /** @returns {any} */
  function _gw() {
    return /** @type {any} */ (window).GraderWork || null;
  }

  /** @param {any} s */
  function _at(s) {
    return Date.parse(String((s && (s.sent_at || s.created_at)) || '')) || 0;
  }

  /** @typedef {{ aid: string, title: string, inCount: number, toGrade: number }} Piece */
  /** @type {{ cid: string, cc: any, list: Piece[] } | null} */
  var _memo = null;

  /** The class's pieces with work in, newest work first, counted once for
   * the draw. @param {string} cid
   * @returns {Piece[]} */
  function _list(cid) {
    var GW = _gw();
    if (!cid || !GW || typeof getAssessments !== 'function') return [];
    var students = getStudents(cid) || [];
    var ids = students.map(function (s) {
      return s.id;
    });
    var cc =
      window.DashOverview && DashOverview.classWorkCounts
        ? DashOverview.classWorkCounts(cid, ids)
        : GW.classWorkCounts(cid, ids);
    if (_memo && _memo.cid === cid && _memo.cc === cc) return _memo.list;
    /** @type {Record<string, boolean>} */
    var enrolled = {};
    ids.forEach(function (/** @type {string} */ sid) {
      enrolled[sid] = true;
    });
    // Who has work in on each piece, and when the newest came.
    /** @type {Record<string, Record<string, boolean>>} */
    var who = {};
    /** @type {Record<string, number>} */
    var newest = {};
    (getCourseSubmissions(cid).submissions || []).forEach(function (/** @type {any} */ s) {
      if (!s || s.state !== 'sent' || !s.assessment_id || !enrolled[s.enrollment_id]) return;
      (who[s.assessment_id] = who[s.assessment_id] || {})[s.enrollment_id] = true;
      var t = _at(s);
      if (t > (newest[s.assessment_id] || 0)) newest[s.assessment_id] = t;
    });
    /** @type {Record<string, number>} */
    var toGrade = {};
    (cc.pieces || []).forEach(function (/** @type {any} */ c) {
      toGrade[c.aid] = c.tograde || 0;
    });
    /** @type {(Piece & { at: number })[]} */
    var out = [];
    (getAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (!a || !a.id || !who[a.id] || !GW.workShown(cid, a)) return;
      var n = Object.keys(who[a.id]).length;
      // A pair's or group's work is each member's: GraderWork says who is in.
      if (getAssessmentStudentWork(cid, a.id).group_work === 'group') n = GW.workInIds(cid, a.id, ids).length;
      if (n > 0)
        out.push({
          aid: a.id,
          title: String(a.title || 'Untitled'),
          inCount: n,
          toGrade: toGrade[a.id] || 0,
          at: newest[a.id] || 0,
        });
    });
    out.sort(function (x, y) {
      return y.at - x.at || (x.title < y.title ? -1 : x.title > y.title ? 1 : 0);
    });
    var list = out.map(function (p) {
      return { aid: p.aid, title: p.title, inCount: p.inCount, toGrade: p.toGrade };
    });
    _memo = { cid: cid, cc: cc, list: list };
    return list;
  }

  /** @param {string} cid
   * @returns {Piece[]} */
  function pieces(cid) {
    return _list(cid);
  }

  /** @param {string} cid */
  function _kept(cid) {
    try {
      return localStorage.getItem(KEY + cid);
    } catch (e) {
      return null;
    }
  }

  /** @param {string} cid
   * @returns {Piece | null} */
  function _chosen(cid) {
    var list = _list(cid);
    if (!list.length) return null;
    var kept = _kept(cid);
    var found = kept
      ? list.filter(function (p) {
          return p.aid === kept;
        })[0]
      : null;
    if (found) return found;
    return (
      list.filter(function (p) {
        return p.toGrade > 0;
      })[0] || list[0]
    );
  }

  /** @param {string} cid
   * @returns {string | null} */
  function current(cid) {
    var p = _chosen(cid);
    return p ? p.aid : null;
  }

  /** The piece list and the chosen piece, for this draw.
   * @param {string} cid
   * @returns {{ pieces: Piece[], current: Piece | null }} */
  function draw(cid) {
    return { pieces: _list(cid), current: _chosen(cid) };
  }

  /** @param {string} cid @param {string} aid */
  function set(cid, aid) {
    try {
      localStorage.setItem(KEY + cid, aid);
    } catch (e) {
      /* blocked storage: the choice lasts this visit */
    }
  }

  /** @param {string} cid
   * @returns {string} */
  function html(cid) {
    var d = draw(cid);
    var list = d.pieces;
    if (!list.length) return '';
    var now = d.current ? d.current.aid : null;
    return (
      '<div class="dash-inbox-pick" role="group" aria-label="Assessment">' +
      list
        .map(function (p) {
          return (
            '<button type="button" class="dash-inbox-pick-btn" data-dash-inbox-pick="' +
            esc(p.aid) +
            '" aria-pressed="' +
            (p.aid === now ? 'true' : 'false') +
            '">' +
            esc(p.title) +
            ' · ' +
            p.inCount +
            ' In</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // The switch had the focus when a piece was picked: the redraw gives it back
  // to the pressed button (the whole Dashboard is drawn again).
  var _refocus = false;

  /** @type {WeakMap<Element, { click: any, key: any, box: HTMLElement | null, wheel: any, edges: any }>} */
  var _bound = new WeakMap();

  /** Where the switch's buttons are, with the pressed one in view.
   * @param {Element} root */
  function _showCurrent(root) {
    var box = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-pick'));
    var on = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-pick-btn[aria-pressed="true"]'));
    if (!box || !on) return;
    // Scrolls the switch only, never the page.
    var left = on.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + on.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, left - 8);
    }
  }

  /** @param {Element} root @param {string} cid @param {(aid: string) => void} onChange */
  function mount(root, cid, onChange) {
    if (!root) return;
    unmount(root);
    /** @param {Event} e */
    var click = function (e) {
      var t = /** @type {any} */ (e.target);
      var btn = t && t.closest ? t.closest('[data-dash-inbox-pick]') : null;
      if (!btn || !root.contains(btn)) return;
      var aid = btn.getAttribute('data-dash-inbox-pick');
      if (!aid) return;
      set(cid, aid);
      var inSwitch = btn.closest('.dash-inbox-pick');
      _refocus = !!inSwitch && inSwitch.contains(document.activeElement);
      if (typeof onChange === 'function') onChange(aid);
    };
    /** @param {KeyboardEvent} e */
    var key = function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var t = /** @type {any} */ (e.target);
      var btn = t && t.closest ? t.closest('[data-dash-inbox-pick]') : null;
      if (!btn || !root.contains(btn)) return;
      var all = Array.prototype.slice.call(root.querySelectorAll('[data-dash-inbox-pick]'));
      var at = all.indexOf(btn);
      var next = all[at + (e.key === 'ArrowRight' ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      next.focus();
    };
    var box = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-pick'));
    /* A mouse wheel turned over the switch scrolls it sideways: most mice
       have no sideways wheel, and the pieces past the edge are reached. A
       wheel at either end, or one the switch cannot use, scrolls the page. */
    /** @param {WheelEvent} e */
    var wheel = function (e) {
      if (!box || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      var max = box.scrollWidth - box.clientWidth;
      if (max <= 0) return;
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * box.clientWidth : e.deltaY;
      var to = Math.max(0, Math.min(max, box.scrollLeft + dy));
      if (to === box.scrollLeft) return;
      e.preventDefault();
      box.scrollLeft = to;
    };
    // The edges fade where more pieces are out of sight.
    var edges = function () {
      if (!box) return;
      var max = box.scrollWidth - box.clientWidth;
      box.classList.toggle('is-more-before', max > 1 && box.scrollLeft > 1);
      box.classList.toggle('is-more-after', max > 1 && box.scrollLeft < max - 1);
    };
    root.addEventListener('click', click);
    root.addEventListener('keydown', /** @type {any} */ (key));
    if (box) {
      box.addEventListener('wheel', wheel, { passive: false });
      box.addEventListener('scroll', edges, { passive: true });
    }
    _bound.set(root, { click: click, key: key, box: box, wheel: wheel, edges: edges });
    _showCurrent(root);
    edges();
    if (_refocus) {
      _refocus = false;
      var on = /** @type {HTMLElement | null} */ (root.querySelector('.dash-inbox-pick-btn[aria-pressed="true"]'));
      if (on) on.focus({ preventScroll: true });
    }
  }

  /** @param {Element} root */
  function unmount(root) {
    var h = root && _bound.get(root);
    if (!h) return;
    root.removeEventListener('click', h.click);
    root.removeEventListener('keydown', h.key);
    if (h.box) {
      h.box.removeEventListener('wheel', h.wheel);
      h.box.removeEventListener('scroll', h.edges);
    }
    _bound.delete(root);
  }

  return {
    pieces: pieces,
    current: current,
    draw: draw,
    set: set,
    html: html,
    mount: mount,
    unmount: unmount,
    KEY: KEY,
  };
})();
