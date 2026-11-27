// @ts-check
/* report-wc.js — Write Comments: the page (docs/plans/write-comments-plan.md).
   Left, what happened in class, one box per part; right, the Teacher
   Comment. This file holds what is open, the search and the sentence lit in
   both places, draws the page and sends each press to ReportWcAct. What the
   boxes hold is ReportWcBoxes (from ReportWcEnv), how they draw is
   ReportWcDraw, the comment card is ReportWcComment. The main file
   (report-questionnaire.js) keeps the rows of the comment and saves them;
   it hands this file what it needs through configure(). */
window.ReportWc = (function () {
  'use strict';

  var B = ReportWcBoxes;
  var D = ReportWcDraw;
  var A = ReportWcAct;
  var H = /** @type {any} */ (null);

  /* What is open and being done, kept as the teacher moves between students
     (the boxes stay as they were left). */
  var ui = {
    open: { habits: true },
    q: '',
    ways: null, // the row whose Other Ways are open
    seeMissing: false,
    piecesAll: false,
    write: /** @type {{ box: string, text: string } | null} */ (null),
    hot: '', // the data-rk lit in both places
    pick: '', // the box the teacher is in: its sentences are lit in the comment
    rkBox: /** @type {Record<string, string>} */ ({}), // each sentence's box
    typing: false,
    caret: /** @type {number | null} */ (null), // where the teacher last was in the comment
    snap: null,
    dirty: false,
  };

  function env(st, f) {
    return ReportWcEnv.make(st, f, A.canSay);
  }

  function configure(host) {
    H = host;
    D.configure(host);
    ReportWcEnv.configure(host, ui);
    ReportWcComment.configure(host, ui);
    A.configure(host, ui, env, redraw);
  }

  /* ── Drawing ─────────────────────────────────────────────── */

  /* The page: the boxes at the left, the comment at the right. */
  // html-safe: the header, the boxes and the comment card are drawn with esc() by their own modules
  function render(cid, student, f) {
    var boxes = D.boxes(mapped(B.build(env(student, f))), ui);
    return `<div class="qn wc" data-sid="${esc(student.id)}">
      <div class="qn-left wc-left">
        ${H.headerHtml(student, f, ui.q)}
        <div class="wc-boxes" id="wc-boxes">${boxes}</div>
      </div>
      <div class="qn-right wc-right">${ReportWcComment.card(cid, student, f)}</div>
    </div>`;
  }

  /* The boxes redrawn in place, gliding what moved; the comment's own
     sentences follow. Nothing redraws while the teacher types in the box. */
  function redraw() {
    var st = H.current();
    var host = document.getElementById('wc-boxes');
    if (!st || !host) return;
    if (ui.typing) {
      ui.dirty = true;
      return;
    }
    ui.dirty = false;
    var active = document.activeElement;
    var grip = active && active.getAttribute ? active.getAttribute('data-wc-grip') : null;
    var before = ReportQnMotion.measure(host);
    // html-safe: boxes drawn by ReportWcDraw with esc()
    host.innerHTML = D.boxes(mapped(B.build(env(st, H.facts(st)))), ui);
    ReportQnMotion.play(host, before);
    syncReading();
    hot(ui.hot);
    var habit =
      active && active.classList && active.classList.contains('qn-hs') ? active.getAttribute('data-habit') : null;
    var g = grip != null ? host.querySelector('.wc-grip[data-wc-grip="' + grip + '"]') : null;
    if (!g && habit) g = host.querySelector('.qn-hs[data-habit="' + habit + '"]');
    if (g) /** @type {HTMLElement} */ (g).focus();
  }
  function syncReading() {
    var read = document.getElementById('tq-read');
    var st = H.current();
    if (!read || !st) return;
    // html-safe: ReportWcComment.readingHtml esc()s every sentence
    read.innerHTML = ReportWcComment.readingHtml(H.rows(st, H.facts(st)), H.box() ? H.box().value : '');
    ReportWcComment.syncNotes();
    pick(ui.pick);
  }

  /* Which box each sentence of the comment sits in, read from the boxes as
     they are built (closed boxes too). */
  function mapped(model) {
    var map = {};
    (model || []).forEach(function (/** @type {any} */ b) {
      var take = function (/** @type {any} */ l) {
        if (l && l.rk) map[l.rk] = b.key;
      };
      (b.top || []).forEach(take);
      (b.facts || []).forEach(function (/** @type {any} */ f) {
        (f.lines || []).forEach(take);
      });
    });
    ui.rkBox = map;
    return model;
  }

  /* The box the teacher clicks in, or opens, lights its sentences in the
     comment in the box's own colour, so the comment can be followed from it.
     Closing that box, or clicking outside the boxes, lets go. */
  function pick(key) {
    ui.pick = key || '';
    var tint = '';
    document.querySelectorAll('.wc-box').forEach(function (b) {
      var on = !!ui.pick && b.getAttribute('data-bk') === ui.pick;
      b.classList.toggle('picked', on);
      if (on) tint = /** @type {HTMLElement} */ (b).style.getPropertyValue('--tint');
    });
    var read = document.getElementById('tq-read');
    if (read) read.style.setProperty('--wc-pick', tint || 'transparent');
    document.querySelectorAll('#tq-read .wc-sent').forEach(function (s) {
      s.classList.toggle('picked', !!ui.pick && ui.rkBox[s.getAttribute('data-rk') || ''] === ui.pick);
    });
  }

  /* A sentence in the comment and its line in its box light together. */
  function hot(rk) {
    ui.hot = rk;
    document.querySelectorAll('.wc [data-rk]').forEach(function (el) {
      el.classList.toggle('hot', !!rk && el.getAttribute('data-rk') === rk);
    });
    document.querySelectorAll('.wc-box').forEach(function (b) {
      b.classList.toggle('lit', !!rk && !!b.querySelector('.wc-line.hot'));
    });
  }
  /* Clicking or tabbing into a box picks it; a click in the left column
     outside every box lets go. */
  function wirePick() {
    document.addEventListener('focusin', function (e) {
      var t = /** @type {any} */ (e.target);
      var box = t && t.closest && t.closest('.wc-box');
      if (box && box.getAttribute('data-bk') !== ui.pick && !t.closest('.wc-head')) pick(box.getAttribute('data-bk'));
    });
    document.addEventListener('click', function (e) {
      var t = /** @type {any} */ (e.target);
      if (!t || !t.closest || !t.closest('.wc-left')) return;
      var inBox = t.closest('.wc-box');
      if (!inBox && ui.pick) pick('');
      else if (inBox && !t.closest('.wc-head') && inBox.getAttribute('data-bk') !== ui.pick)
        pick(inBox.getAttribute('data-bk'));
    });
  }
  function wireHot() {
    var rkOf = function (e, sel) {
      var el = e.target && e.target.closest && e.target.closest(sel);
      return el ? el.getAttribute('data-rk') : '';
    };
    document.addEventListener('mouseover', function (e) {
      var rk = rkOf(e, '[data-rk]');
      if (rk !== ui.hot) hot(rk);
    });
    document.addEventListener('focusin', function (e) {
      var rk = rkOf(e, '.wc-line[data-rk]');
      if (rk && rk !== ui.hot) hot(rk);
    });
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget && ui.hot) hot('');
    });
    document.addEventListener('focusout', function (e) {
      if (/** @type {HTMLElement} */ (e.target).id === 'tq-narrative') A.endTyping();
    });
    // "No comment yet" is the box to type in until there is a sentence.
    document.addEventListener('click', function (e) {
      var t = /** @type {HTMLElement | null} */ (e.target);
      if (t && t.closest && t.closest('#tq-empty')) {
        e.preventDefault();
        A.startTyping();
      }
    });
    document.addEventListener('keydown', function (e) {
      var t = /** @type {HTMLElement | null} */ (e.target);
      if (t && t.id === 'tq-read' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        A.startTyping();
      } else if (t && t.id === 'tq-wc-write' && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        if (e.key === 'Enter') A.writeAdd();
        else write('');
      } else if (t && t.id === 'tq-narrative' && e.key === 'Escape' && ui.typing) {
        e.stopPropagation();
        A.cancelTyping();
      }
    });
  }

  var _wired = false;
  function after() {
    if (!_wired && typeof document !== 'undefined') {
      _wired = true;
      A.wireDrag();
      wireHot();
      wirePick();
    }
    if (H.current() && !ui.typing) ReportWcComment.syncNotes();
  }

  /* ── The presses ─────────────────────────────────────────── */

  function toggle(key) {
    ui.open[key] = !ui.open[key];
    ui.ways = null;
    if (ui.open[key]) ui.pick = key;
    else if (ui.pick === key) ui.pick = '';
    redraw();
    var b = document.getElementById('wc-head-' + key);
    if (b) b.focus();
  }
  function flip(name) {
    ui[name] = !ui[name];
    redraw();
  }
  function ways(row) {
    ui.ways = ui.ways === row ? null : row;
    redraw();
    var b = document.querySelector('.wc-line[data-row="' + row + '"] [data-do="wcWays"]');
    if (b) /** @type {HTMLElement} */ (b).focus();
  }
  function write(box) {
    ui.write = box ? { box: box, text: '' } : null;
    redraw();
    var w = document.getElementById('tq-wc-write');
    if (w) w.focus();
  }

  function act(what, el) {
    var ds = (el && el.dataset) || {};
    var table = {
      wcToggle: () => toggle(ds.box),
      wcSay: () => A.say(ds),
      wcSayClass: () => A.sayClass(ds),
      wcWays: () => ways(Number(ds.row)),
      wcUse: () => A.use(ds),
      wcEdit: () => A.edit(el),
      wcPieces: () => flip('piecesAll'),
      wcSee: () => flip('seeMissing'),
      wcWrite: () => write(ds.box),
      wcWriteCancel: () => write(''),
      wcWriteAdd: () => A.writeAdd(),
      wcBrowse: () => H.openBrowse(ds.part),
      wcBank: () => A.bank(),
      wcVary: () => ReportWcComment.vary(),
      wcType: () => A.startTyping(),
    };
    if (table[what]) table[what]();
  }

  /* The search box: the boxes that match open. */
  function search(value) {
    ui.q = String(value || '');
    redraw();
  }
  function closeWays() {
    if (ui.ways == null) return false;
    ui.ways = null;
    redraw();
    return true;
  }
  function reset() {
    ui.ways = null;
    ui.write = null;
    ui.q = '';
    ui.typing = false;
    ui.caret = null;
    ui.snap = null;
    ui.seeMissing = false;
    ui.piecesAll = false;
  }

  return {
    configure: configure,
    render: render,
    redraw: redraw,
    syncReading: syncReading,
    after: after,
    act: act,
    search: search,
    closeWays: closeWays,
    endTyping: A.endTyping,
    ways: function () {
      return ui.ways;
    },
    reset: reset,
    typing: function () {
      return ui.typing;
    },
    ui: ui,
  };
})();
