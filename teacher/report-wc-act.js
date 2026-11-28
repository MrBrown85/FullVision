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
    // Typed here, so it stays in this box; no step, so Generate keeps it like any typed sentence.
    if (w.box !== 'cls' && P.BOX_STEPS[w.box]) row.inBox = w.box;
    ui.write = null;
    insert(st, mk(st, H.facts(st)), row, w.box);
  }

  /* ── The drag handle ─────────────────────────────────────── */

  /* A sentence moves only where its box shows it move: see ReportWcBoxesMore.arrange. A line with
     nowhere to go has no handle. */
  function lineEl(i) {
    return document.querySelector('#wc-boxes .wc-line[data-row="' + i + '"]');
  }
  function rowOf(el) {
    return el ? Number(el.getAttribute('data-row')) : -1;
  }
  /* The rows of the lines a sentence can pass: { prev, next }, -1 for none.
     prev is the row to go in front of, next the row to go after. */
  function reach(i) {
    var none = { prev: -1, next: -1 };
    var el = lineEl(i);
    var box = el && el.closest('.wc-box');
    if (!el || !box) return none;
    var wrap = el.closest('.wc-fact-wrap');
    var own = Array.prototype.slice.call(
      wrap ? wrap.querySelectorAll('.wc-line') : box.querySelectorAll('.wc-body > .wc-line'),
    );
    var k = own.indexOf(el);
    if (box.getAttribute('data-float') !== '1' || own.length > 1)
      return { prev: rowOf(own[k - 1]), next: rowOf(own[k + 1]) };
    // A sentence alone on its skill passes the whole of the next skill's.
    var units = Array.prototype.slice.call(box.querySelectorAll('.wc-fact-wrap')).filter(function (w) {
      return w.querySelector('.wc-line');
    });
    var u = units.indexOf(wrap);
    var before = units[u - 1] ? units[u - 1].querySelector('.wc-line') : null;
    var after = units[u + 1] ? units[u + 1].querySelectorAll('.wc-line') : [];
    return { prev: rowOf(before), next: rowOf(after[after.length - 1]) };
  }
  function sameOrder(a, b) {
    return (
      a.length === b.length &&
      a.every(function (r, i) {
        return String(r.id) + '|' + r.text === String(b[i].id) + '|' + b[i].text;
      })
    );
  }
  /* Row i one place on in the comment, in front of or after the row the box
     shows it passing; draws the boxes again. Returns its new index, -1 when
     it has nowhere to go. */
  function step(i, dir) {
    var st = H.current();
    if (!st) return -1;
    var n = reach(i);
    var to = dir < 0 ? n.prev : n.next;
    var rows = H.rows(st, H.facts(st));
    var row = rows[i];
    var target = rows[to];
    if (!row || !target || to < 0) return -1;
    var out = rows.filter(function (r) {
      return r !== row;
    });
    var at = out.indexOf(target);
    out.splice(dir < 0 ? at : at + 1, 0, row);
    H.moveRows(st, out);
    redraw();
    return out.indexOf(row);
  }
  /* The comment as it was when the move began; the toast waits for the drop. */
  function toastIf(st, snap) {
    var now = H.rows(st, H.facts(st));
    if (!snap || sameOrder(snap.rows, now)) return;
    H.undoToast(st, 'Moved.', snap);
  }
  function nudge(i, by) {
    var st = H.current();
    if (!st) return;
    var snap = H.snapshot(st);
    if (step(i, by) < 0) return;
    toastIf(st, snap);
  }

  var _snap = /** @type {any} */ (null);
  function dragHost() {
    return {
      card: function () {
        return document.getElementById('wc-boxes');
      },
      neighbors: reach,
      step: function (i, dir) {
        var st = H.current();
        if (st && !_snap) _snap = H.snapshot(st);
        return step(i, dir);
      },
      bounds: function (rk) {
        var el = document.querySelector('#wc-boxes .wc-line[data-rk="' + rk + '"]');
        var box = el && el.closest('.wc-box');
        var card = document.getElementById('wc-boxes');
        if (!box || !card) return null;
        var c = card.getBoundingClientRect();
        var b = box.getBoundingClientRect();
        return { top: b.top - c.top, bottom: b.bottom - c.top };
      },
      commit: function () {
        var st = H.current();
        var snap = _snap;
        _snap = null;
        if (st) toastIf(st, snap);
      },
      cancel: function () {
        var st = H.current();
        var snap = _snap;
        _snap = null;
        if (st && snap) {
          H.restore(st, snap);
          redraw();
        }
      },
    };
  }
  function dragStart(e) {
    var g = e.target && e.target.closest && e.target.closest('.wc-grip');
    if (!g || e.button !== 0) return;
    var st = H.current();
    _snap = st ? H.snapshot(st) : null;
    ReportQnMotion.begin(e, g);
  }
  function gripKey(e) {
    var g = e.target && e.target.closest && e.target.closest('.wc-grip');
    if (g && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      nudge(Number(g.closest('.wc-line').getAttribute('data-row')), e.key === 'ArrowUp' ? -1 : 1);
    }
  }
  function wireDrag() {
    ReportQnMotion.configure(dragHost());
    document.addEventListener('pointerdown', dragStart);
    document.addEventListener('keydown', gripKey);
  }

  /* ── The comment, typed ──────────────────────────────────── */

  function startTyping() {
    var el = H.box();
    var st = H.current();
    if (!el || !st || ui.typing) return;
    var at = clickedAt();
    ui.typing = true;
    ui.snap = H.snapshot(st);
    var read = document.getElementById('tq-read');
    if (read) read.hidden = true;
    el.hidden = false;
    H.fitBox();
    el.focus();
    var c = at == null ? el.value.length : Math.min(at, el.value.length);
    el.setSelectionRange(c, c);
  }
  /* The text typed is read back into sentences (a sentence left as it was
     keeps its fact, one reworded stays in its box as Yours, a new one goes
     in Your Sentences), and Undo puts the comment back. */
  function endTyping() {
    var el = H.box();
    var st = H.current();
    if (!ui.typing || !el) return;
    ui.typing = false;
    ui.caret = el.selectionStart;
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

  /* ── Comment Bank, at a place in the comment ─────────────── */

  /* Where a click fell in the comment as it reads, in characters, so the
     box to type in opens with its cursor there. */
  function clickedAt() {
    var read = document.getElementById('tq-read');
    var sel = window.getSelection && window.getSelection();
    if (!read || read.hidden || !sel || !sel.rangeCount || !read.contains(sel.anchorNode)) return null;
    var r = document.createRange();
    r.setStart(read, 0);
    r.setEnd(/** @type {Node} */ (sel.anchorNode), sel.anchorOffset);
    return r.toString().length;
  }
  /* The gap a place in the text falls at: before the sentence it starts,
     else after the sentence it is in. */
  function gapOf(rows, at) {
    var pos = 0;
    for (var i = 0; i < rows.length; i++) {
      if (at <= pos) return i;
      pos += String(rows[i].text || '').length + 1;
      if (at < pos) return i + 1;
    }
    return rows.length;
  }
  /* Comment Bank: the sheet of sentences, each put in where the teacher
     last clicked in the comment, else at its end; each next one after it.
     It opens on the box the teacher is in, else on the sentence before. */
  function bank() {
    var st = H.current();
    if (!st) return;
    if (ui.typing) endTyping();
    var rows = H.rows(st, H.facts(st));
    var gap = ui.caret == null ? rows.length : gapOf(rows, ui.caret);
    ui.caret = null;
    var near = rows[gap - 1] || rows[gap];
    var part = B.browsePart(ui.pick) || (near ? B.browsePart(P.boxOf(near)) : '');
    H.openBrowse(part || 'grade', gap);
  }

  return {
    configure: configure,
    bank: bank,
    gapOf: gapOf,
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
