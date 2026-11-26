// @ts-check
/* rubric-comment-lines.js: comments in the rubric editor (docs/plans/comment-bank-plan.md).
 *
 * The rubric editor (teacher/page-assignments.js, _blankCardHtml and _blankRowHtml) serves both
 * the Edit Rubric window and the assessment form. It calls the five draw functions below from
 * short hook lines; each returns '' while the commentBank switch is off, so the editor's markup
 * is then exactly what it was.
 *
 * A criterion keeps its comments on the draft as criterion.comments = [{ level, text }] and the
 * rubric keeps rubric.overallComments = [text]. Which criterion is open lives on the editor's
 * state object (cmOpen: the criterion's id, or 'overall'), never on the draft.
 *
 * Open, a level's comments are lines typed in place, plus one empty line. Typing in the empty
 * line makes a comment and adds the next empty line to the page without a redraw. Shut, each
 * comment is a bubble under the level's description; a click opens the criterion with the caret
 * in that line. A line left empty is dropped on save (dropBlank).
 */
// A script loaded twice (the tests do) takes its earlier listeners off first.
if (window.RubricCommentLines && window.RubricCommentLines.off) window.RubricCommentLines.off();
window.RubricCommentLines = (function () {
  'use strict';

  /** @type {{ render: (sel?: string | null) => void, get: () => any, courseId: () => string } | null} */
  var _api = null;
  /** @type {Record<string, Record<string, number>> | null} */
  var _usesMemo = null;

  function on() {
    return typeof BuildFlags !== 'undefined' && BuildFlags.on('commentBank');
  }
  var LIMITS = {
    text: function () {
      return (window.RubricComments && window.RubricComments.MAX_TEXT) || 500;
    },
    count: function () {
      return (window.RubricComments && window.RubricComments.MAX_COMMENTS) || 40;
    },
  };

  /** @param {any} c @param {number} lv */
  function _entriesAt(c, lv) {
    return ((c && c.comments) || []).filter(function (/** @type {any} */ x) {
      return x && Number(x.level) === Number(lv);
    });
  }
  /** @param {any} d */
  function _overallOf(d) {
    return Array.isArray(d && d.overallComments) ? d.overallComments : [];
  }

  /* How often each saved comment has been used, once per card draw. None for a rubric not saved yet. */
  /** @param {any} b @param {string} cid @param {any} c */
  function _usesFor(b, cid, c) {
    if (!_usesMemo) _usesMemo = {};
    var key = c ? String(c.id) : 'overall';
    if (_usesMemo[key]) return _usesMemo[key];
    var out = {};
    try {
      if (window.RubricComments && getRubricById(cid, b.draft.id)) {
        out = c ? window.RubricComments.uses(cid, b.draft.id, c) : window.RubricComments.overallUses(cid, b.draft.id);
      }
    } catch (e) {
      out = {};
    }
    _usesMemo[key] = out;
    return out;
  }
  /** @param {number} n */
  function _countHtml(n) {
    return n > 0 ? '<span class="af-cm-n">' + n + '×</span>' : '';
  }

  /* One comment as a line to type in. `text` is '' for the empty line. */
  // html-safe: text through esc; indexes are numbers
  /** @param {{ i: number, level?: number, c: number, text: string, n: number }} o */
  function _fieldHtml(o) {
    return (
      '<div class="af-cm-wrap"><textarea class="af-cm-field' +
      (o.text ? '' : ' is-new') +
      '" rows="1" data-ge="comment" data-i="' +
      o.i +
      (o.level != null ? '" data-level="' + o.level : '') +
      '" data-c="' +
      o.c +
      '" maxlength="' +
      LIMITS.text() +
      '" placeholder="Add a comment" aria-label="' +
      (o.level != null ? 'Comment to give at this level' : 'Overall comment to give') +
      '">' +
      esc(o.text) +
      '</textarea>' +
      _countHtml(o.n) +
      '</div>'
    );
  }
  /* One comment, shut: a bubble. */
  // html-safe: text through esc; indexes are numbers
  /** @param {{ i: number, level?: number, c: number, text: string, n: number }} o */
  function _bubbleHtml(o) {
    return (
      '<button type="button" class="af-cm" data-cm="open" data-i="' +
      o.i +
      (o.level != null ? '" data-level="' + o.level : '') +
      '" data-c="' +
      o.c +
      '" title="' +
      esc(o.text) +
      '"><span class="af-cm-t">' +
      esc(o.text) +
      '</span>' +
      _countHtml(o.n) +
      '</button>'
    );
  }

  /* The lines (open) or bubbles (shut) for a list of texts, with the empty line last when open. */
  /** @param {{ texts: string[], open: boolean, room: boolean, i: number, level?: number, uses: Record<string, number>, keyOf: (t: string) => string }} o */
  function _linesHtml(o) {
    var list = o.texts.slice();
    if (o.open && o.room && !(list.length && !String(list[list.length - 1]).trim())) list.push('');
    var html = list
      .map(function (t, c) {
        if (!o.open && !String(t).trim()) return '';
        var args = { i: o.i, level: o.level, c: c, text: t, n: (t && o.uses[o.keyOf(t)]) || 0 };
        return o.open ? _fieldHtml(args) : _bubbleHtml(args);
      })
      .join('');
    return html ? '<div class="af-cm-lines">' + html + '</div>' : '';
  }

  /* ── The draw functions the editor calls ─────────────────────── */

  /* + Comments, in a criterion's tools, while that criterion is not the open one. */
  /** @param {any} b @param {string} _cid @param {number} i */
  function tools(b, _cid, i) {
    if (!on()) return '';
    var c = b.draft.criteria[i];
    if (!c || b.cmOpen === c.id) return '';
    return '<button type="button" class="af-link-btn af-cm-link" data-cm="open" data-i="' + i + '">+ Comments</button>';
  }

  /* A level cell's comments, under its description (and its checkboxes). */
  /** @param {any} b @param {string} cid @param {any} c @param {number} i @param {number} lv */
  function cell(b, cid, c, i, lv) {
    if (!on()) return '';
    var uses = _usesFor(b, cid, c);
    var open = b.cmOpen === c.id;
    return _linesHtml({
      texts: _entriesAt(c, lv).map(function (x) {
        return String(x.text == null ? '' : x.text);
      }),
      open: open,
      room: open && ((c && c.comments) || []).length < LIMITS.count(),
      i: i,
      level: lv,
      uses: uses,
      keyOf: function (t) {
        return lv + '|' + t;
      },
    });
  }

  /* + Overall Comments in the foot, while that row is not the open one. */
  /** @param {any} b */
  function foot(b) {
    if (!on() || b.cmOpen === 'overall') return '';
    return '<button type="button" class="af-link-btn" data-cm="open" data-i="-1">+ Overall Comments</button>';
  }

  /* The last table row, "Overall Comment": open, or shut with bubbles when it has comments. */
  /** @param {any} b @param {string} cid @param {number} cols */
  function overallRow(b, cid, cols) {
    var uses = on() ? _usesFor(b, cid, null) : {};
    _usesMemo = null;
    if (!on()) return '';
    var open = b.cmOpen === 'overall';
    var texts = _overallOf(b.draft).map(String);
    if (
      !open &&
      !texts.some(function (t) {
        return t.trim();
      })
    )
      return '';
    return (
      '<tr class="af-cm-overall"><th scope="row" class="rb-crit af-ge-crit"><span class="af-cm-overall-name">Overall Comment</span></th>' +
      '<td class="rb-cell af-ge-cell" colspan="' +
      cols +
      '">' +
      _linesHtml({
        texts: texts,
        open: open,
        room: open && texts.length < LIMITS.count(),
        i: -1,
        uses: uses,
        keyOf: function (t) {
          return t;
        },
      }) +
      '</td></tr>'
    );
  }

  /* ── Keeping the caret ───────────────────────────────────────── */

  /* The selector that finds a comment line again after the editor redraws. */
  /** @param {Element | null} a */
  function keep(a) {
    var ds = a && /** @type {HTMLElement} */ (a).dataset;
    if (!ds || ds.ge !== 'comment') return null;
    return (
      '[data-ge="comment"][data-i="' +
      ds.i +
      '"]' +
      (ds.level ? '[data-level="' + ds.level + '"]' : '') +
      '[data-c="' +
      ds.c +
      '"]'
    );
  }

  /* ── Sizing: each line grows with its words ─────────────────── */

  /** @param {HTMLTextAreaElement} t */
  function _fit(t) {
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
  }
  /* Three passes over every line in the given rows, so the page is laid out once, not once a line. */
  /** @param {ArrayLike<Element>} trs */
  function size(trs) {
    var boxes = [];
    Array.prototype.forEach.call(trs, function (/** @type {Element} */ tr) {
      boxes = boxes.concat(Array.from(tr.querySelectorAll('.af-cm-field')));
    });
    boxes.forEach(function (t) {
      t.style.height = 'auto';
    });
    var heights = boxes.map(function (t) {
      return t.scrollHeight;
    });
    boxes.forEach(function (t, k) {
      t.style.height = heights[k] + 'px';
    });
  }

  /* ── Draft changes ───────────────────────────────────────────── */

  /* A line left empty is nothing to save. Works on a held copy of the rubric. */
  /** @param {any} rubric */
  function dropBlank(rubric) {
    if (!rubric) return;
    (rubric.criteria || []).forEach(function (/** @type {any} */ c) {
      if (c && Array.isArray(c.comments)) {
        c.comments = c.comments.filter(function (/** @type {any} */ x) {
          return x && String(x.text == null ? '' : x.text).trim();
        });
      }
    });
    if (Array.isArray(rubric.overallComments)) {
      rubric.overallComments = rubric.overallComments.filter(function (/** @type {any} */ t) {
        return String(t == null ? '' : t).trim();
      });
    }
  }

  /* The comment a line stands for: its entry on the draft, or null for the empty line. */
  /** @param {any} b @param {HTMLElement} t @returns {any} */
  function _target(b, t) {
    var i = Number(t.dataset.i);
    var c = Number(t.dataset.c);
    if (i < 0) return { list: 'overall', c: c };
    var crit = b.draft.criteria[i];
    if (!crit) return null;
    return { crit: crit, level: Number(t.dataset.level), c: c };
  }

  /* Open one criterion (or the overall row): the one open before it loses its empty lines. */
  /** @param {any} b @param {number} i */
  function _open(b, i) {
    var d = b.draft;
    var next = i < 0 ? 'overall' : d.criteria[i] && d.criteria[i].id;
    if (!next) return false;
    // Only the one open before can hold an empty line.
    if (b.cmOpen && b.cmOpen !== next) dropBlank(d);
    b.cmOpen = next;
    return true;
  }

  /** @param {HTMLTextAreaElement} t */
  function _onInput(t) {
    var b = _api && _api.get();
    if (!b) return;
    var at = _target(b, t);
    if (!at) return;
    var value = t.value.replace(/\n/g, ' ');
    if (value !== t.value) t.value = value;
    b.touched = true;
    var wrap = t.closest('.af-cm-wrap');
    var host = wrap && wrap.parentElement;
    var last = !!(wrap && host && wrap === host.lastElementChild);
    if (at.list === 'overall') {
      var all = _overallOf(b.draft);
      if (!Array.isArray(b.draft.overallComments)) b.draft.overallComments = all;
      b.draft.overallComments[at.c] = value;
      t.classList.toggle('is-new', !value);
      _growAfter(b, t, last, value, b.draft.overallComments.length);
    } else {
      var crit = at.crit;
      var mine = _entriesAt(crit, at.level);
      if (!Array.isArray(crit.comments)) crit.comments = [];
      if (at.c >= mine.length) crit.comments.push({ level: at.level, text: value });
      else mine[at.c].text = value;
      t.classList.toggle('is-new', !value);
      _growAfter(b, t, last, value, crit.comments.length);
    }
    _fit(/** @type {HTMLTextAreaElement} */ (t));
  }
  /* Typing in the last line adds the next empty line, without a redraw. */
  /** @param {any} b @param {HTMLElement} t @param {boolean} last @param {string} value @param {number} total */
  function _growAfter(b, t, last, value, total) {
    if (!last || !value || total >= LIMITS.count()) return;
    var wrap = t.closest('.af-cm-wrap');
    if (!wrap) return;
    var ds = t.dataset;
    var holder = document.createElement('div');
    // html-safe: _fieldHtml escapes its text, which is empty here; the rest are numbers
    holder.innerHTML = _fieldHtml({
      i: Number(ds.i),
      level: ds.level != null ? Number(ds.level) : undefined,
      c: Number(ds.c) + 1,
      text: '',
      n: 0,
    });
    if (holder.firstElementChild) wrap.insertAdjacentElement('afterend', holder.firstElementChild);
  }

  /** @param {Event} e */
  function _onClick(e) {
    var el = e.target instanceof Element ? e.target.closest('[data-cm="open"]') : null;
    var b = _api && _api.get();
    if (!el || !b || !el.closest('.af-ge-card')) return;
    var ds = /** @type {HTMLElement} */ (el).dataset;
    var i = Number(ds.i);
    if (!_open(b, i)) return;
    var sel =
      ds.c != null
        ? '[data-ge="comment"][data-i="' +
          i +
          '"]' +
          (ds.level ? '[data-level="' + ds.level + '"]' : '') +
          '[data-c="' +
          ds.c +
          '"]'
        : null;
    /** @type {any} */ (_api).render(sel);
    var to = sel ? document.querySelector('.af-ge-card ' + sel) : _firstEmpty(i);
    if (to instanceof HTMLTextAreaElement) {
      to.focus({ preventScroll: true });
      to.setSelectionRange(to.value.length, to.value.length);
    }
  }
  /** @param {number} i */
  function _firstEmpty(i) {
    var scope = document.querySelector(
      i < 0 ? '.af-ge-card .af-cm-overall' : '.af-ge-card .af-ge-grid tbody tr:nth-child(' + (i + 1) + ')',
    );
    return scope ? scope.querySelector('.af-cm-field.is-new') : null;
  }
  /* Enter ends the line, as it does in a comment box: it goes to the next line, never makes a second. */
  /** @param {KeyboardEvent} e */
  function _onKey(e) {
    var t = e.target;
    if (e.key !== 'Enter' || !(t instanceof HTMLTextAreaElement) || t.dataset.ge !== 'comment') return;
    e.preventDefault();
    var next = t.closest('.af-cm-wrap');
    next = next && next.nextElementSibling;
    var field = next && next.querySelector('.af-cm-field');
    if (field instanceof HTMLElement) field.focus();
  }

  /** @param {{ render: (sel?: string | null) => void, get: () => any, courseId: () => string }} api */
  function init(api) {
    _api = api;
  }

  /** @param {Event} e */
  function _onInputEvent(e) {
    var t = e.target;
    if (t instanceof HTMLTextAreaElement && t.dataset.ge === 'comment' && t.closest('.af-ge-card')) _onInput(t);
  }
  document.addEventListener('input', _onInputEvent);
  document.addEventListener('click', _onClick);
  document.addEventListener('keydown', _onKey);
  function off() {
    document.removeEventListener('input', _onInputEvent);
    document.removeEventListener('click', _onClick);
    document.removeEventListener('keydown', _onKey);
  }

  return {
    on: on,
    init: init,
    tools: tools,
    cell: cell,
    foot: foot,
    overallRow: overallRow,
    keep: keep,
    size: size,
    dropBlank: dropBlank,
    off: off,
  };
})();
