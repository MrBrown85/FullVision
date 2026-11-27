// @ts-check
/* report-wc-act.js — Write Comments: what a press on the page does to the
   comment (docs/plans/write-comments-plan.md, decisions 5 to 8): Say This
   puts a sentence in after the last one of its box, Other Ways words one
   another way, a click edits a sentence in place, the handle moves one,
   and a click in the comment makes it a box to type in. The rows are the
   main file's; it saves them (through the host). */
window.ReportWcAct = (function () {
  'use strict';

  var P = ReportWcParts;
  var B = ReportWcBoxes;
  var H = /** @type {any} */ (null);
  var ui = /** @type {any} */ (null);
  var mk = /** @type {any} */ (null);
  var redraw = /** @type {any} */ (null);
  function configure(host, state, makeEnv, draw) {
    H = host;
    ui = state;
    mk = makeEnv;
    redraw = draw;
  }

  /* ── Say This ────────────────────────────────────────────── */

  function sayCtx(env, d) {
    var kind = d.box === 'strength' ? 'strength' : d.box === 'next' ? 'next' : d.box === 'best' ? 'best' : '';
    if (!kind) return env.ctx;
    var id = String(d.fact || '').replace(/^(comp|work):/, '');
    var c = kind === 'best' ? { id: id } : ReportWcEnv.comp(env.f, id);
    return c ? B.ctxFor(env, kind, c) : null;
  }
  var _kept = {};
  function canSay(env, d) {
    if (d.box === 'voice' || d.fact === 'close') return true;
    if (d.box === 'best' && env.rows.some(env.isBest)) return true;
    var ids = env.rows.map(function (r) {
      return r.id;
    });
    var marks = (env.f.comps || [])
      .map(function (c) {
        return c.id + ':' + c.level + ':' + (c.scores || []).length;
      })
      .join(',');
    var key = [env.student.id, d.box, d.fact, ids.join(','), H.factsKey(), marks, (env.f.work || []).length].join('|');
    if (!(key in _kept)) {
      var ctx = sayCtx(env, d);
      if (Object.keys(_kept).length > 400) _kept = {};
      _kept[key] = !!ctx && !!B.candidate(env, d.box, d.fact, ctx);
    }
    return _kept[key];
  }

  /* A new row in the comment after the last sentence of its box. */
  function insert(st, env, row, box) {
    var boxes = env.rows.map(function (r) {
      return P.boxOf(r, env.isBest(r));
    });
    H.setRows(st, H.insertRow(env.rows, row, P.insertAt(boxes, box)), row);
  }

  function sayVoice(st, env, key) {
    var a = H.wordsAnswers(env.f).find(function (x) {
      return x.key === key;
    });
    if (a) insert(st, env, H.wordsRow(st, a, 0), 'voice');
  }

  function say(ds) {
    var st = H.current();
    if (!st) return;
    var f = H.facts(st, true);
    var env = mk(st, f);
    if (ds.box === 'voice') return sayVoice(st, env, ds.fact);
    if (ds.fact === 'close') return H.addClose(st);
    if (ds.box === 'best' && ds.aid) {
      var at = env.rows.findIndex(env.isBest);
      if (at >= 0) return H.pickPiece(st, at, ds.aid);
      H.savePick({ mentionAssessments: [ds.aid] });
      env = mk(st, H.facts(st, true));
    }
    var ctx = sayCtx(env, ds);
    var c = ctx ? B.candidate(env, ds.box, ds.fact, ctx) : null;
    if (!c) return H.nothingFits();
    insert(st, env, H.rowFromSentence(c.s, c.ctx, c.step, env.rows.length === 0), ds.box);
  }

  /* A class line (support, closing, late work) put in the comment. */
  function sayClass(ds) {
    var st = H.current();
    if (!st) return;
    var f = H.facts(st, true);
    var made = H.classLineRow(st, f, ds.kind);
    if (made) insert(st, mk(st, f), made, 'cls');
  }

  /* ── Other Ways, edit in place, Write Your Own ───────────── */

  function use(ds) {
    var st = H.current();
    var env = mk(st, H.facts(st));
    var row = env.rows[Number(ds.row)];
    ui.ways = null;
    if (row) H.useWording(st, Number(ds.row), ds.sentence, env.ctxForRow(row));
  }

  function editField(orig) {
    var field = document.createElement('input');
    field.type = 'text';
    field.className = 'wc-edit';
    field.value = orig;
    field.setAttribute('aria-label', 'Edit this sentence');
    return field;
  }
  function edit(el) {
    var st = H.current();
    var line = el.closest('.wc-line');
    if (!st || !line || line.classList.contains('editing')) return;
    var orig = el.textContent;
    var field = editField(orig);
    var done = false;
    var close = function (keep) {
      if (done) return;
      done = true;
      var next = field.value.replace(/\s+/g, ' ').trim();
      if (keep && next && next !== orig) {
        H.applyEdit(st, orig, /[.!?…]["”]?$/.test(next) ? next : next + '.');
        return;
      }
      field.remove();
      el.hidden = false;
      line.classList.remove('editing');
    };
    field.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      close(e.key === 'Enter');
      if (e.key === 'Escape') el.focus();
    });
    field.addEventListener('blur', function () {
      close(true);
    });
    el.hidden = true;
    el.after(field);
    line.classList.add('editing');
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  function writeAdd() {
    var st = H.current();
    var w = ui.write;
    var input = /** @type {HTMLInputElement | null} */ (document.getElementById('tq-wc-write'));
    var text = String((input && input.value) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!st || !w || !text) return;
    if (!/[.!?…]["”]?$/.test(text)) text += '.';
    var row = H.typedRow(text);
    var step = (P.BOX_STEPS[w.box] || [])[0];
    if (step && w.box !== 'cls') row.step = step;
    ui.write = null;
    insert(st, mk(st, H.facts(st)), row, w.box);
  }

  /* ── The drag handle ─────────────────────────────────────── */

  /* A sentence goes in front of the one it is dropped on, in the comment. */
  function place(from, before) {
    var st = H.current();
    if (!st) return;
    var rows = H.rows(st, H.facts(st));
    var row = rows[from];
    var target = rows[before];
    if (!row || !target || row === target) return;
    var out = rows.filter(function (r) {
      return r !== row;
    });
    out.splice(out.indexOf(target), 0, row);
    H.setRows(st, out, null, 'Moved.');
  }
  function nudge(i, by) {
    var st = H.current();
    var rows = st ? H.rows(st, H.facts(st)).slice() : [];
    var j = i + by;
    if (j < 0 || j >= rows.length) return;
    var r = rows.splice(i, 1)[0];
    rows.splice(j, 0, r);
    H.setRows(st, rows, null, '');
    var g = document.querySelector('.wc-line[data-row="' + j + '"] .wc-grip');
    if (g) /** @type {HTMLElement} */ (g).focus();
  }

  var _drag = /** @type {any} */ (null);
  function lineUnder(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('.wc-line') : null;
  }
  function clearDrop() {
    document.querySelectorAll('.wc-line.drop').forEach(function (el) {
      el.classList.remove('drop');
    });
  }
  function dragStart(e) {
    var g = e.target && e.target.closest && e.target.closest('.wc-grip');
    if (!g || e.button !== 0) return;
    _drag = { from: Number(g.dataset.wcGrip), line: g.closest('.wc-line'), moved: false, x: e.clientX, y: e.clientY };
    e.preventDefault();
  }
  function dragMove(e) {
    if (!_drag) return;
    if (!_drag.moved && Math.abs(e.clientX - _drag.x) + Math.abs(e.clientY - _drag.y) < 4) return;
    if (!_drag.moved) {
      _drag.moved = true;
      _drag.line.classList.add('lift');
    }
    clearDrop();
    var t = lineUnder(e.clientX, e.clientY);
    if (t && t !== _drag.line) t.classList.add('drop');
  }
  function dragEnd(e, cancel) {
    if (!_drag) return;
    var d = _drag;
    _drag = null;
    d.line.classList.remove('lift');
    var t = e && !cancel ? lineUnder(e.clientX, e.clientY) : null;
    clearDrop();
    if (d.moved && t && t !== d.line) place(d.from, Number(/** @type {HTMLElement} */ (t).dataset.row));
  }
  function gripKey(e) {
    var g = e.target && e.target.closest && e.target.closest('.wc-grip');
    if (g && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      nudge(Number(g.dataset.wcGrip), e.key === 'ArrowUp' ? -1 : 1);
    } else if (_drag && e.key === 'Escape') {
      dragEnd(null, true);
    }
  }
  function wireDrag() {
    document.addEventListener('pointerdown', dragStart);
    document.addEventListener('pointermove', dragMove);
    document.addEventListener('pointerup', function (e) {
      dragEnd(e, false);
    });
    document.addEventListener('pointercancel', function () {
      dragEnd(null, true);
    });
    document.addEventListener('keydown', gripKey);
  }

  /* ── The comment, typed ──────────────────────────────────── */

  function startTyping() {
    var el = H.box();
    var st = H.current();
    if (!el || !st || ui.typing) return;
    ui.typing = true;
    ui.snap = H.snapshot(st);
    var read = document.getElementById('tq-read');
    if (read) read.hidden = true;
    el.hidden = false;
    H.fitBox();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
  /* The text typed is read back into sentences (a sentence left as it was
     keeps its fact, one reworded stays in its box as Yours, a new one goes
     in Your Sentences), and Undo puts the comment back. */
  function endTyping() {
    var el = H.box();
    var st = H.current();
    if (!ui.typing || !el) return;
    ui.typing = false;
    el.hidden = true;
    var read = document.getElementById('tq-read');
    if (read) read.hidden = false;
    H.alignNow();
    H.saveNarrative();
    var snap = ui.snap;
    ui.snap = null;
    if (st && snap && String(snap.text).trim() !== el.value.trim()) H.undoToast(st, 'Comment changed.', snap);
    redraw();
  }
  function cancelTyping() {
    var el = H.box();
    if (!ui.typing || !el || !ui.snap) return;
    el.value = ui.snap.text;
    endTyping();
  }

  return {
    configure: configure,
    canSay: canSay,
    say: say,
    sayClass: sayClass,
    use: use,
    edit: edit,
    writeAdd: writeAdd,
    wireDrag: wireDrag,
    startTyping: startTyping,
    endTyping: endTyping,
    cancelTyping: cancelTyping,
  };
})();
