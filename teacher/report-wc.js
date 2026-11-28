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
    ReportWcHabits.configure(host, env, redraw);
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

  /* Keeping the teacher's place. A row that jumps into the In the Comment group (or back out) and the
     heading that comes with the first one change the box's height above what the teacher is looking
     at. The row just below the one under the pointer stays where it is on screen: the page scrolls
     by the change, before the glide is measured, so the glide and the scroll are one motion. */
  var _ptr = /** @type {any} */ (null);
  function notePointer(/** @type {any} */ e) {
    var t = e.target;
    var y = e.clientY;
    if (!e.detail && t && t.getBoundingClientRect) {
      // Pressed from the keyboard: the button's own place.
      var r = t.getBoundingClientRect();
      y = r.top + r.height / 2;
    }
    _ptr = { y: y, at: Date.now() };
  }
  function scroller(/** @type {any} */ el) {
    for (var p = el && el.parentElement; p; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  /* The element after the row under the pointer, as a way to find it again once the boxes are drawn:
     { bk, fact } or { bk, foot }. */
  function placeMark(/** @type {any} */ host) {
    var at = _ptr;
    _ptr = null; // one press, one redraw: a drag's redraws do not use an old press
    if (!at || Date.now() - at.at > 1500) return null;
    var wraps = host.querySelectorAll('.wc-body > .wc-fact-wrap');
    for (var i = 0; i < wraps.length; i++) {
      var r = wraps[i].getBoundingClientRect();
      if (at.y < r.top || at.y > r.bottom) continue;
      var next = wraps[i].nextElementSibling;
      var box = wraps[i].closest('[data-bk]');
      if (!next || !box) return null;
      var mark = { bk: box.getAttribute('data-bk'), fact: next.getAttribute('data-fact'), foot: false, top: 0 };
      if (!mark.fact && next.classList.contains('wc-foot')) mark.foot = true;
      else if (!mark.fact) return null;
      mark.top = next.getBoundingClientRect().top;
      return mark;
    }
    return null;
  }
  function holdPlace(/** @type {any} */ host, /** @type {any} */ mark) {
    if (!mark) return 0;
    var box = host.querySelector('[data-bk="' + mark.bk + '"]');
    var el = box
      ? mark.foot
        ? box.querySelector('.wc-foot')
        : Array.prototype.find.call(box.querySelectorAll('.wc-fact-wrap'), function (/** @type {any} */ w) {
            return w.getAttribute('data-fact') === mark.fact;
          })
      : null;
    if (!el) return 0;
    var by = el.getBoundingClientRect().top - mark.top;
    if (Math.abs(by) < 0.5) return 0;
    var sc = scroller(host);
    var was = sc.scrollTop;
    sc.scrollTop += by;
    var kept = sc.scrollTop;
    // The press may move focus to a link after this draw, which scrolls to it; the place is kept.
    Promise.resolve().then(function () {
      if (Math.abs(sc.scrollTop - kept) > 0.5) sc.scrollTop = kept;
    });
    return kept - was;
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
    // The handle in focus is found again by its sentence: a move changes the row numbers.
    var gripLine =
      active && active.hasAttribute && active.hasAttribute('data-wc-grip') ? active.closest('.wc-line') : null;
    var grip = gripLine ? gripLine.getAttribute('data-rk') : null;
    var before = ReportQnMotion.measure(host);
    var mark = placeMark(host);
    // html-safe: boxes drawn by ReportWcDraw with esc()
    host.innerHTML = D.boxes(mapped(B.build(env(st, H.facts(st)))), ui);
    syncReading();
    hot(ui.hot);
    // Whatever those two change is in place before the page is held and the glide measured.
    var scrolled = holdPlace(host, mark);
    // The scroll is not a glide: every place measured before is seen from where the page now stands.
    if (scrolled)
      Object.keys(before.pos).forEach(function (k) {
        before.pos[k].top -= scrolled;
      });
    ReportQnMotion.play(host, before, ReportQnMotion.dragKey());
    var habit =
      active && active.classList && active.classList.contains('qn-hs') ? active.getAttribute('data-habit') : null;
    var g = grip != null ? host.querySelector('.wc-line[data-rk="' + grip + '"] .wc-grip') : null;
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
    // A habit's row is lit with each sentence that names it.
    document.querySelectorAll('.wc [data-rks]').forEach(function (el) {
      var on = !!rk && (' ' + el.getAttribute('data-rks') + ' ').indexOf(' ' + rk + ' ') >= 0;
      el.classList.toggle('hot', on);
    });
    document.querySelectorAll('.wc-box').forEach(function (b) {
      b.classList.toggle('lit', !!rk && !!b.querySelector('.wc-line.hot'));
    });
  }
  /* Clicking or tabbing into a box picks it; a click in the left column
     outside every box lets go. */
  function wirePick() {
    document.addEventListener('click', notePointer, true);
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
      wcHabit: () => ReportWcHabits.toggle(ds.habit, !!(el && /** @type {any} */ (el).checked)),
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
