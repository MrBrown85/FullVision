// @ts-check
/* ── crit-bank.js — the Comment Bank in the grader ───────────────────
   docs/plans/comment-bank-plan.md, "The screens > Grader". Behind the
   commentBank switch. Under an open criterion comment (teacher/
   crit-comment.js) and under the Overall Comment while it has focus:
   Last Time above the box, a Bank row of the comments kept for this
   criterion (at the level picked), Add to Bank, and the whole bank in one
   soft panel. Same As is not touched. The data is shared/rubric-comments.js;
   this file only draws it and wires its clicks, hovers and keys. */
/** @type {any} */ (window).CritBank = (function () {
  'use strict';

  // What the page lends (CritComment.configure forwards it): the class on
  // screen, a group's row, a criterion by id, and the level picked.
  /** @type {any} */
  var _deps = {
    course: function () {
      return null;
    },
    groupRow: function () {
      return null;
    },
    criterion: function () {
      return null;
    },
    level: function () {
      return 0;
    },
  };
  var CHIPS = 3;
  var ADD_MIN = 3;
  var ADD_LEVEL = 3; // no level picked: the rubric's "meets" level

  /** @returns {any} */
  function _RC() {
    return /** @type {any} */ (window).RubricComments;
  }
  function enabled() {
    var w = /** @type {any} */ (window);
    return !!(w.BuildFlags && w.BuildFlags.on('commentBank') && w.RubricComments);
  }

  // The open Bank: one on a criterion's editor, one under the Overall Comment.
  /** @type {any} */
  var _crit = null;
  /** @type {any} */
  var _overall = null;
  /** @type {any} */
  var _doc = null;

  /* ── What the bank holds ────────────────────────────────── */
  /** @returns {any} */
  function _rubricOf(ctx) {
    var a = (getAssessments(ctx.cid) || []).find(function (x) {
      return x && x.id === ctx.aid;
    });
    return a && a.rubricId ? getRubricById(ctx.cid, a.rubricId) : null;
  }
  // The criterion is read again each time: Add to Bank replaces the cached rubric.
  function _bank(ctx) {
    var rubric = _rubricOf(ctx);
    if (ctx.kind === 'overall') {
      var list = rubric && Array.isArray(rubric.overallComments) ? rubric.overallComments : [];
      return {
        rubric: rubric,
        crit: null,
        list: list
          .filter(function (t) {
            return typeof t === 'string' && t !== '';
          })
          .map(function (t) {
            return { level: 0, text: t };
          }),
      };
    }
    var crit = _deps.criterion(ctx.aid, ctx.critId);
    return { rubric: rubric, crit: crit, list: crit ? _RC().all(crit) : [] };
  }
  function _uses(ctx) {
    var rubric = _rubricOf(ctx);
    if (!rubric) return {};
    if (ctx.kind === 'overall') return _RC().overallUses(ctx.cid, rubric.id);
    var crit = _deps.criterion(ctx.aid, ctx.critId);
    return crit ? _RC().uses(ctx.cid, rubric.id, crit) : {};
  }
  function _count(inst, e) {
    return inst.uses[inst.ctx.kind === 'overall' ? e.text : e.level + '|' + e.text] || 0;
  }
  // Same text at two levels is one chip; it keeps the larger count.
  function _once(inst, list) {
    /** @type {any[]} */
    var out = [];
    list.forEach(function (e) {
      var n = _count(inst, e);
      var seen = out.find(function (o) {
        return o.text === e.text;
      });
      if (!seen) out.push({ level: e.level, text: e.text, n: n });
      else if (n > seen.n) seen.n = n;
    });
    return out;
  }
  function _byUse(list) {
    return list
      .map(function (e, i) {
        return { e: e, i: i };
      })
      .sort(function (a, b) {
        return b.e.n - a.e.n || a.i - b.i;
      })
      .map(function (x) {
        return x.e;
      });
  }

  /* What the row shows now: the chips (this level, most used first; while
     typing, those that contain the part being typed), and whether Add to
     Bank or In the Bank shows. */
  function _view(inst) {
    var ctx = inst.ctx;
    var text = inst.input.value;
    var b = _bank(ctx);
    var level = ctx.kind === 'overall' ? 0 : Number(_deps.level(ctx.cid, ctx.sid, ctx.aid, b.crit)) || 0;
    var part = _RC().newPart(
      text,
      b.list.map(function (e) {
        return e.text;
      }),
      ctx.first,
    );
    var q = part.toLowerCase();
    var empty = !text.trim();
    var pool = [];
    if (empty) {
      pool = level
        ? b.list.filter(function (e) {
            return e.level === level;
          })
        : b.list;
    } else if (q) {
      pool = b.list.filter(function (e) {
        return _RC().fill(e.text, ctx.first).toLowerCase().indexOf(q) >= 0;
      });
    }
    pool = _byUse(_once(inst, pool));
    var add = !empty && part.length >= ADD_MIN && !pool.length;
    var kept = !add && !empty && !part && inst.kept;
    return {
      b: b,
      level: level,
      part: part,
      chips: inst.open ? [] : pool.slice(0, CHIPS),
      add: add,
      kept: kept,
      show: b.list.length > 0 || add || kept,
    };
  }

  /* ── Drawing ────────────────────────────────────────────── */
  var PLUS =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var TICK =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  var CHEVRON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  // html-safe: the comment, filled with the student's name, through esc; the index is a number
  function _chipHtml(inst, e) {
    var full = _RC().fill(e.text, inst.ctx.first);
    var i = inst.items.length;
    inst.items.push(e.text);
    return (
      '<button type="button" class="rsg-crit-bank-chip" data-bank-i="' +
      i +
      '" title="' +
      esc(full) +
      '"><span class="rsg-crit-bank-ct">' +
      esc(full) +
      '</span>' +
      (e.n ? '<span class="rsg-crit-bank-cx">' + e.n + '×</span>' : '') +
      '</button>'
    );
  }
  // html-safe: built by _chipHtml; the rest is ours
  function _chipsHtml(inst, v) {
    return (
      v.chips
        .map(function (e) {
          return _chipHtml(inst, e);
        })
        .join('') +
      (v.add ? '<button type="button" class="rsg-crit-bank-add">' + PLUS + 'Add to Bank</button>' : '') +
      (v.kept ? '<span class="rsg-crit-bank-kept">' + TICK + 'In the Bank</span>' : '')
    );
  }
  function _levelKeys(ctx, rubric) {
    var order = levelOrderFor(ctx.cid);
    var RS = /** @type {any} */ (window).RubricScale;
    return RS && rubric ? RS.keys(rubric, order) : order;
  }
  function _levelName(rubric, k) {
    var RS = /** @type {any} */ (window).RubricScale;
    return RS && rubric ? RS.name(rubric, k) : 'Level ' + k;
  }
  function _levelTone(rubric, k) {
    var RS = /** @type {any} */ (window).RubricScale;
    return RS && rubric ? RS.tone(rubric, k) : k;
  }
  // html-safe: level names and comments through esc; the rubric id through esc; tones are numbers
  function _panelHtml(inst, v) {
    var ctx = inst.ctx;
    var rubric = v.b.rubric;
    var html = '';
    var seen = {};
    var rows = [];
    if (ctx.kind === 'overall') {
      rows.push({ label: '', tone: 0, list: _byUse(_once(inst, v.b.list)) });
    } else {
      var keys = _levelKeys(ctx, rubric);
      var order = v.level && keys.indexOf(v.level) >= 0 ? [v.level].concat(keys.filter(l => l !== v.level)) : keys;
      order.forEach(function (l) {
        var here = _byUse(
          _once(
            inst,
            v.b.list.filter(function (e) {
              return e.level === Number(l) && !seen[e.text];
            }),
          ),
        );
        here.forEach(function (e) {
          seen[e.text] = true;
        });
        if (here.length)
          rows.push({ label: _levelName(rubric, l), tone: Number(_levelTone(rubric, l)) || 0, list: here });
      });
    }
    rows.forEach(function (r) {
      html +=
        '<div class="rsg-crit-bank-line">' +
        (r.label
          ? '<span class="rsg-crit-bank-lv t' + r.tone + '">' + esc(r.label) + '</span>'
          : '<span class="rsg-crit-bank-lv"></span>') +
        '<div class="rsg-crit-bank-chips is-wrap">' +
        r.list
          .map(function (e) {
            return _chipHtml(inst, e);
          })
          .join('') +
        '</div></div>';
    });
    if (rubric)
      html +=
        '<div class="rsg-crit-bank-line is-edit"><button type="button" class="rsg-crit-bank-edit" data-action="editRubricUI" data-rid="' +
        esc(rubric.id) +
        '">Edit Comments</button></div>';
    return html;
  }

  // html-safe: built by _chipsHtml; the label and chevron are ours
  function _render(inst) {
    var v = _view(inst);
    inst.items = [];
    inst.box.hidden = !v.show;
    inst.chips.innerHTML = _chipsHtml(inst, v);
    inst.panel.hidden = !inst.open;
    // html-safe: built by _panelHtml
    inst.panel.innerHTML = inst.open ? _panelHtml(inst, v) : '';
    inst.label.setAttribute('aria-expanded', String(inst.open));
    inst.label.classList.toggle('is-on', inst.open);
    if (inst.host && inst.host.classList) inst.host.classList.toggle('is-bank-open', inst.open);
    return v;
  }

  /* The Bank row and its panel, as the editor draws them. */
  // html-safe: ours; built empty and filled by _render once wired
  function rowHtml(ctx) {
    if (!enabled()) return '';
    var inst = { ctx: ctx, input: { value: '' }, items: [], uses: {}, open: false, kept: false };
    var v = _view(inst);
    return (
      '<div class="rsg-crit-bank-box"' +
      (v.show ? '' : ' hidden') +
      '><div class="rsg-crit-bank"><button type="button" class="rsg-crit-bank-label" aria-expanded="false" aria-label="Open the whole bank">Bank' +
      CHEVRON +
      '</button><div class="rsg-crit-bank-chips"></div></div><div class="rsg-crit-bank-panel" hidden></div></div>'
    );
  }

  // html-safe: the assessment's title and the comment through esc
  function lastHtml(ctx) {
    if (!enabled() || ctx.group) return '';
    var crit = _deps.criterion(ctx.aid, ctx.critId);
    var last = crit ? _RC().lastTime(ctx.cid, ctx.sid, ctx.aid, crit) : null;
    if (!last) return '';
    return (
      '<div class="rsg-crit-last"><b>' +
      esc('Last Time' + (last.title ? ', ' + last.title : '') + ':') +
      '</b><span class="rsg-crit-last-text">' +
      esc(last.text) +
      '</span></div>'
    );
  }

  /* ── Preview: the whole comment in the empty box, in grey ─ */
  function _grow(inp, full) {
    var was = inp.value;
    if (full != null) inp.value = full;
    inp.style.height = 'auto';
    if (inp.scrollHeight) inp.style.height = Math.min(inp.scrollHeight + 2, 220) + 'px';
    inp.value = was;
  }
  function _peek(inst, full) {
    if (!inst.input || inst.input.value.trim()) return;
    inst.input.setAttribute('placeholder', full);
    if (inst.ctx.kind === 'crit') _grow(inst.input, full);
  }
  function _unpeek(inst) {
    if (!inst.input) return;
    inst.input.setAttribute('placeholder', inst.placeholder);
    if (inst.ctx.kind === 'crit') _grow(inst.input, null);
  }
  /** @returns {any[]} */
  function _steps(inst) {
    /** @type {any[]} */
    var out = [];
    if (inst.ctx.kind === 'crit') {
      Array.prototype.forEach.call(inst.host.querySelectorAll('.rsg-crit-reuse'), function (r) {
        if (r.hidden || inst.open) return;
        Array.prototype.forEach.call(r.querySelectorAll('.rsg-crit-reuse-chip'), function (c) {
          out.push(c);
        });
      });
    }
    Array.prototype.forEach.call(inst.box.querySelectorAll('.rsg-crit-bank .rsg-crit-bank-chip'), function (c) {
      out.push(c);
    });
    return out;
  }
  function _mark(inst) {
    var steps = _steps(inst);
    Array.prototype.forEach.call(inst.host.querySelectorAll('.is-hi'), function (c) {
      c.classList.remove('is-hi');
    });
    var on = steps[inst.hi];
    if (on) {
      on.classList.add('is-hi');
      _peek(inst, on.getAttribute('title') || '');
    } else _unpeek(inst);
  }

  /* ── Picking ────────────────────────────────────────────── */
  // After what is written, one space between; in place of the part being
  // typed when that narrowed the row.
  function _joined(inst, raw) {
    var filled = _RC().fill(raw, inst.ctx.first);
    var cur = inst.input.value;
    if (!cur.trim()) return filled;
    var part = _view(inst).part;
    var at = !inst.open && part ? cur.lastIndexOf(part) : -1;
    var next =
      at >= 0
        ? cur.slice(0, at).replace(/\s+$/, '') +
          (cur.slice(0, at).trim() ? ' ' : '') +
          filled +
          cur.slice(at + part.length)
        : cur.replace(/\s+$/, '') + ' ' + filled;
    return next;
  }
  function _pick(inst, raw) {
    var next = _joined(inst, raw).slice(0, _RC().MAX_TEXT);
    inst.open = false;
    inst.hi = -1;
    _unpeek(inst);
    inst.host_.set(next);
  }
  function _add(inst) {
    var v = _view(inst);
    if (!v.add) return;
    var ctx = inst.ctx;
    var rubric = v.b.rubric;
    if (!rubric) return;
    var text = _RC().slot(v.part, ctx.first);
    var ok =
      ctx.kind === 'overall'
        ? _RC().addOverallComment(ctx.cid, rubric.id, text)
        : _RC().addCriterionComment(ctx.cid, rubric.id, ctx.critId, v.level || ADD_LEVEL, text);
    if (!ok) return;
    inst.kept = true;
    inst.host_.save();
    inst.uses = _uses(ctx);
    _render(inst);
    inst.host_.focus();
  }
  function _toggle(inst) {
    inst.open = !inst.open;
    inst.hi = -1;
    _unpeek(inst);
    _render(inst);
    inst.host_.focus();
  }

  /* ── One bank on one text box ───────────────────────────── */
  // host: the editor (or the Overall Comment's box) the bank sits in;
  // hostFns: set(text) writes and saves, save(), focus().
  function _make(ctx, input, box, host, hostFns) {
    /** @type {any} */
    var inst = {
      ctx: ctx,
      input: input,
      box: box,
      host: host,
      host_: hostFns,
      label: box.querySelector('.rsg-crit-bank-label'),
      chips: box.querySelector('.rsg-crit-bank-chips'),
      panel: box.querySelector('.rsg-crit-bank-panel'),
      placeholder: input.getAttribute('placeholder') || '',
      items: [],
      uses: _uses(ctx),
      open: false,
      kept: false,
      hi: -1,
    };
    _render(inst);
    return inst;
  }
  /* The box's own clicks, hovers and keys. `get` returns the live bank. */
  function _listen(host, box, get) {
    box.addEventListener('mousedown', function (e) {
      // Keeps the focus in the text box through a click on the bank.
      if (e.target && e.target.closest && e.target.closest('.rsg-crit-bank-box')) e.preventDefault();
    });
    box.addEventListener('click', function (e) {
      var inst = get();
      var t = e.target && e.target.closest ? e.target : null;
      if (!inst || !t) return;
      var edit = t.closest('.rsg-crit-bank-edit');
      if (edit) {
        inst.host_.save();
        return; // the page opens Edit Rubric from its data-action
      }
      var chip = t.closest('.rsg-crit-bank-chip');
      var label = t.closest('.rsg-crit-bank-label');
      var add = t.closest('.rsg-crit-bank-add');
      if (!chip && !label && !add) return;
      e.stopPropagation();
      if (chip) _pick(inst, inst.items[Number(chip.getAttribute('data-bank-i'))]);
      else if (label) _toggle(inst);
      else _add(inst);
    });
    // The preview makes the box grow, which moves the chips down from under
    // the pointer. So the chip's place before the move still counts as the
    // chip: the preview stays while the pointer is there, and a click there
    // picks the comment the preview shows.
    function chipOf(e) {
      return e.target && e.target.closest ? e.target.closest('.rsg-crit-reuse-chip, .rsg-crit-bank-chip') : null;
    }
    function within(r, e) {
      return (
        !!r &&
        typeof e.clientX === 'number' &&
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      );
    }
    function holds(inst, e) {
      var h = inst.hover;
      return !!h && (within(h.r, e) || within(h.chip.getBoundingClientRect(), e));
    }
    function clear(inst) {
      inst.hover = null;
      _mark(inst);
    }
    function on(type, fn) {
      host.addEventListener(type, function (e) {
        var inst = get();
        var chip = inst && chipOf(e);
        if (chip) fn(inst, chip, e);
      });
    }
    function peek(inst, chip) {
      _peek(inst, chip.getAttribute('title') || '');
    }
    on('mouseover', function (inst, chip) {
      var r = chip.getBoundingClientRect();
      inst.hover = { chip: chip, r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
      peek(inst, chip);
    });
    on('mouseout', function (inst, chip, e) {
      if (e.relatedTarget && chip.contains(e.relatedTarget)) return;
      if (!holds(inst, e)) clear(inst);
    });
    on('focusin', peek);
    on('focusout', function (inst, chip, e) {
      if (!(e.relatedTarget && chip.contains(e.relatedTarget))) _mark(inst);
    });
    host.addEventListener('mousemove', function (e) {
      var inst = get();
      if (inst && inst.hover && !holds(inst, e)) clear(inst);
    });
    host.addEventListener('mouseleave', function () {
      var inst = get();
      if (inst && inst.hover) clear(inst);
    });
    host.addEventListener('click', function (e) {
      var inst = get();
      if (!inst || !inst.hover || chipOf(e) || !within(inst.hover.r, e)) return;
      var chip = inst.hover.chip;
      inst.hover = null;
      chip.click();
    });
  }

  /* ── The criterion's editor ─────────────────────────────── */
  /* Wire the bank on the editor just drawn. ctx: { kind: 'crit', cid, aid,
     sid, critId, first, group }; hostFns: { set(text), save(), focus() }. */
  function wire(edit, ctx, hostFns) {
    if (!enabled() || !edit) return;
    var input = edit.querySelector('.rsg-crit-input');
    var box = edit.querySelector('.rsg-crit-bank-box');
    if (!input || !box) return;
    var wired = edit._bankWired;
    _crit = _make(ctx, input, box, edit, hostFns);
    if (wired) return;
    edit._bankWired = true;
    _listen(edit, box, function () {
      return _crit && _crit.host === edit ? _crit : null;
    });
  }
  // What was typed: the chips follow it.
  function typed() {
    var inst = _crit;
    if (!inst || !inst.input.isConnected) return;
    inst.hi = -1;
    var v = _view(inst);
    if (v.part) inst.kept = false;
    _unpeek(inst);
    _render(inst);
  }
  function drop() {
    _crit = null;
  }
  // Down, Up and Enter on the criterion's box. True when the key was the bank's.
  function key(e) {
    var inst = _crit;
    if (!inst || !inst.input.isConnected || document.activeElement !== inst.input) return false;
    return _key(inst, e);
  }
  function _key(inst, e) {
    var steps = _steps(inst);
    if (e.key === 'ArrowDown' && !inst.input.value.trim() && steps.length) {
      e.preventDefault();
      inst.hi = Math.min(inst.hi + 1, steps.length - 1);
      _mark(inst);
      return true;
    }
    if (e.key === 'ArrowUp' && inst.hi >= 0) {
      e.preventDefault();
      inst.hi--;
      _mark(inst);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && inst.hi >= 0 && steps[inst.hi]) {
      e.preventDefault();
      steps[inst.hi].click();
      return true;
    }
    return false;
  }

  /* ── The Overall Comment ────────────────────────────────── */
  function _fire(input, type) {
    var W = (input.ownerDocument && input.ownerDocument.defaultView) || window;
    input.dispatchEvent(new W.Event(type, { bubbles: true }));
  }
  function _overallFocus(input) {
    if (!enabled() || !input.dataset || !input.dataset.aid || !input.dataset.sid) return;
    var cid = _deps.course();
    var aid = input.dataset.aid;
    var sid = input.dataset.sid;
    var group = _deps.groupRow(aid, sid);
    var isGroup = !!(group && group.view);
    var stu = isGroup
      ? null
      : (getStudents(cid) || []).find(function (s) {
          return s.id === sid;
        });
    /** @type {any} */
    var ctx = {
      kind: 'overall',
      cid: cid,
      aid: aid,
      sid: sid,
      first: stu ? displayNameFirst(stu) : '',
      group: isGroup,
    };
    if (!_rubricOf(ctx)) return;
    if (_overall && _overall.input === input && _overall.box.isConnected) return;
    _overallLeave();
    var wrap = document.createElement('div');
    // html-safe: built by rowHtml
    wrap.innerHTML = rowHtml(ctx);
    var box = wrap.firstChild;
    var parent = input.parentNode;
    if (!box || !parent) return;
    parent.appendChild(box);
    _overall = _make(ctx, input, box, box, {
      set: function (text) {
        input.value = text;
        _fire(input, 'input');
        _fire(input, 'blur');
        input.focus({ preventScroll: true });
      },
      save: function () {
        _fire(input, 'input');
        _fire(input, 'blur');
      },
      focus: function () {
        input.focus({ preventScroll: true });
      },
    });
    _listen(box, box, function () {
      return _overall && _overall.box === box ? _overall : null;
    });
    if (!input._bankWired) {
      input._bankWired = true;
      input.addEventListener('input', function () {
        var inst = _overall;
        if (!inst || inst.input !== input) return;
        inst.hi = -1;
        if (_view(inst).part) inst.kept = false;
        _unpeek(inst);
        _render(inst);
      });
      input.addEventListener('keydown', function (e) {
        var inst = _overall;
        if (inst && inst.input === input && _key(inst, e)) e.stopPropagation();
      });
    }
  }
  function _overallLeave() {
    var inst = _overall;
    _overall = null;
    if (inst && inst.box && inst.box.parentNode) {
      _unpeek(inst);
      inst.box.parentNode.removeChild(inst.box);
    }
  }
  function _isOverall(el) {
    return !!(el && el.classList && el.classList.contains('rsg-overall-comment'));
  }
  // The row shows while the field has the focus, and goes when it goes
  // anywhere outside the row.
  function _install() {
    if (_doc === document) return;
    _doc = document;
    document.addEventListener('focusin', function (e) {
      if (_isOverall(e.target)) _overallFocus(e.target);
    });
    document.addEventListener('focusout', function (e) {
      var inst = _overall;
      if (!inst || e.target !== inst.input) return;
      if (e.relatedTarget && inst.box.contains(e.relatedTarget)) return;
      _overallLeave();
    });
  }

  function configure(deps) {
    Object.keys(deps || {}).forEach(function (k) {
      _deps[k] = deps[k];
    });
    _install();
  }

  return {
    configure: configure,
    enabled: enabled,
    lastHtml: lastHtml,
    rowHtml: rowHtml,
    wire: wire,
    typed: typed,
    key: key,
    drop: drop,
  };
})();
