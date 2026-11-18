// @ts-check
/* dash-inbox-pick.js — the assessment switch the Inbox's views share (D6 of
   docs/plans/dashboard-inbox-plan.md; board C2's "Light Refraction Lab · 6 In"
   row). Side by Side, Flip Through and the others all call:

     pieces(cid)   [{ aid, title, inCount }] — the class's pieces whose work
                   the teacher's screens show (GraderWork.workShown) and that
                   have work in, the newest work first. inCount is
                   GraderWork.workInIds(cid, aid, studentIds).length.
     current(cid)  the aid kept for this class on this device, or the first
                   of pieces(cid) when none is kept or the kept one is gone;
                   null with nothing in.
     set(cid, aid) keeps the choice.
     html(cid)     the switch: one button a piece, the current one pressed.
     mount(root, cid, onChange) / unmount(root)
                   one delegated click and key listener; a pick calls set,
                   then onChange(aid). The left and right arrows move
                   between the buttons.

   The count is GraderWork's; nothing here counts for itself. */
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

  /** @param {string} cid
   * @returns {{ aid: string, title: string, inCount: number }[]} */
  function pieces(cid) {
    var GW = _gw();
    if (!cid || !GW || typeof getAssessments !== 'function') return [];
    var ids = (getStudents(cid) || []).map(function (s) {
      return s.id;
    });
    // When the newest work on each piece came in.
    /** @type {Record<string, number>} */
    var newest = {};
    var subs = getCourseSubmissions(cid).submissions || [];
    subs.forEach(function (/** @type {any} */ s) {
      if (!s || s.state !== 'sent' || !s.assessment_id) return;
      var t = _at(s);
      if (t > (newest[s.assessment_id] || 0)) newest[s.assessment_id] = t;
    });
    /** @type {{ aid: string, title: string, inCount: number, at: number }[]} */
    var out = [];
    (getAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (!a || !a.id || !GW.workShown(cid, a)) return;
      var n = GW.workInIds(cid, a.id, ids).length;
      if (n > 0) out.push({ aid: a.id, title: String(a.title || 'Untitled'), inCount: n, at: newest[a.id] || 0 });
    });
    out.sort(function (x, y) {
      return y.at - x.at || (x.title < y.title ? -1 : x.title > y.title ? 1 : 0);
    });
    return out.map(function (p) {
      return { aid: p.aid, title: p.title, inCount: p.inCount };
    });
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
   * @returns {string | null} */
  function current(cid) {
    var list = pieces(cid);
    if (!list.length) return null;
    var kept = _kept(cid);
    var found = kept
      ? list.filter(function (p) {
          return p.aid === kept;
        })[0]
      : null;
    return (found || list[0]).aid;
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
    var list = pieces(cid);
    if (!list.length) return '';
    var now = current(cid);
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

  /** @type {WeakMap<Element, { click: any, key: any }>} */
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
    root.addEventListener('click', click);
    root.addEventListener('keydown', /** @type {any} */ (key));
    _bound.set(root, { click: click, key: key });
    _showCurrent(root);
  }

  /** @param {Element} root */
  function unmount(root) {
    var h = root && _bound.get(root);
    if (!h) return;
    root.removeEventListener('click', h.click);
    root.removeEventListener('keydown', h.key);
    _bound.delete(root);
  }

  return { pieces: pieces, current: current, set: set, html: html, mount: mount, unmount: unmount, KEY: KEY };
})();
