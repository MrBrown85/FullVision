// @ts-check
/* report-qn-motion.js — how the Sentences card moves (term-questionnaire-
   redesign-plan, slices 4 and 5): boxes and sentences glide to their new
   places when the card is drawn again (measured before and after, FLIP), a
   new sentence opens downward, a menu grows from its button, and a sentence
   is lifted and dragged by its handle with the pointer. It keeps no
   comment state: the caller hands in what a drag needs (configure) and
   decides what a drop saves. Prefers-reduced-motion turns every glide off. */
window.ReportQnMotion = (function () {
  'use strict';

  var EASE = 'cubic-bezier(.2,.8,.2,1)';
  var GLIDE = 200;
  var GROW = 140;

  function still() {
    try {
      return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /* Where every box and sentence of the card is now: { key: { top, rel,
     box } } (rel: its top within its box), and which menus are open. */
  function measure(card) {
    var pos = {};
    var menus = {};
    if (!card || typeof card.querySelectorAll !== 'function') return { pos: pos, menus: menus };
    var boxTop = {};
    card.querySelectorAll('[data-bk]').forEach(function (el) {
      var k = 'b:' + el.getAttribute('data-bk');
      boxTop[k] = el.getBoundingClientRect().top;
      pos[k] = { top: boxTop[k], rel: 0, box: '' };
    });
    card.querySelectorAll('[data-rk]').forEach(function (el) {
      var b = el.closest('[data-bk]');
      var bk = b ? 'b:' + b.getAttribute('data-bk') : '';
      var top = el.getBoundingClientRect().top;
      pos['r:' + el.getAttribute('data-rk')] = { top: top, rel: top - (boxTop[bk] || 0), box: bk };
    });
    card.querySelectorAll('.qn-menu, .qn-cal').forEach(function (el) {
      menus[el.id || el.className] = true;
    });
    return { pos: pos, menus: menus };
  }

  /* After the card is drawn again: whatever moved glides from where it was;
     a sentence that is new opens downward; a menu that is new grows from
     its button. skip: a key that must not glide (the sentence being
     dragged). */
  function play(card, before, skip) {
    if (!card || !before || still() || !card.animate || typeof card.querySelectorAll !== 'function') return;
    var now = measure(card);
    var fresh = [];
    var ease = { duration: GLIDE, easing: EASE };
    var live = function (k) {
      return k in before.pos && k in now.pos;
    };
    card.querySelectorAll('[data-bk],[data-rk]').forEach(function (el) {
      var isBox = el.hasAttribute('data-bk');
      var key = isBox ? 'b:' + el.getAttribute('data-bk') : 'r:' + el.getAttribute('data-rk');
      if (skip && key === 'r:' + skip) return;
      var was = before.pos[key];
      var cur = now.pos[key];
      if (!was) {
        if (!isBox) fresh.push(el);
        return;
      }
      // A sentence inside a box that also glides moves with it: only what
      // it moved within the box is its own.
      var d = !isBox && cur.box && live(cur.box) && was.box === cur.box ? was.rel - cur.rel : was.top - cur.top;
      if (Math.abs(d) > 0.5) el.animate([{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], ease);
    });
    // A new sentence or two opens downward; a whole card redrawn does not.
    if (fresh.length && fresh.length <= 2)
      fresh.forEach(function (el) {
        el.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], ease);
      });
    card.querySelectorAll('.qn-menu, .qn-cal').forEach(function (el) {
      var id = el.id || el.className;
      if (before.menus[id]) return;
      var up = el.classList.contains('up');
      /** @type {HTMLElement} */ (el).style.transformOrigin = 'right ' + (up ? 'bottom' : 'top');
      el.animate([{ transform: 'scale(.95)' }, { transform: 'none' }], { duration: GROW, easing: EASE });
    });
  }

  /* ── Dragging a sentence by its handle ───────────────────── */

  /** @type {any} */
  var host = null;
  /** @type {any} */
  var d = null;

  /* What a drag needs from the page: card() the Sentences card; neighbors(i)
     the lead rows { prev, next } of the units around row i (-1 for none);
     step(i, dir) moves row i one place in memory and draws the card again,
     returning its new index (-1 when it cannot move); commit() saves the
     order; cancel() puts the order back. */
  function configure(h) {
    host = h;
  }

  function layoutTop(el, card) {
    var t = 0;
    for (var n = el; n && n !== card; n = /** @type {HTMLElement} */ (n.offsetParent)) t += n.offsetTop;
    return t;
  }
  function rowEl(card, rk) {
    return card.querySelector('[data-rk="' + rk + '"]');
  }
  function cardY(e, card) {
    return e.clientY - card.getBoundingClientRect().top;
  }

  /* The lifted sentence follows the pointer; the slot marks where it lands. */
  function apply() {
    var card = host.card();
    var el = card && d && rowEl(card, d.rk);
    if (!el) return;
    var natural = layoutTop(el, card);
    var ty = d.y - d.grab - natural;
    var lo = -natural + 8;
    var hi = card.offsetHeight - natural - el.offsetHeight - 8;
    ty = Math.max(lo, Math.min(hi, ty));
    d.ty = ty;
    var bg = getComputedStyle(el.closest('.qn-box') || el).backgroundColor;
    el.classList.add('lifted');
    el.style.setProperty('--lift-bg', bg);
    el.style.transform = 'translateY(' + ty + 'px) scale(1.012)';
    var slot = card.querySelector('.qn-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'qn-slot';
      slot.setAttribute('aria-hidden', 'true');
      card.appendChild(slot);
    }
    var s = /** @type {HTMLElement} */ (slot);
    s.style.top = natural - 4 + 'px';
    s.style.height = el.offsetHeight + 8 + 'px';
  }

  /* The card was drawn again during a drag: lift the sentence again. */
  function afterDraw() {
    if (d) {
      var card = host.card();
      if (card) card.classList.add('dragging');
      apply();
    }
  }

  function move(e) {
    if (!d) return;
    var card = host.card();
    if (!card) return;
    d.y = cardY(e, card);
    if (!d.on) {
      if (Math.abs(e.clientY - d.startY) < 3) return;
      d.on = true;
      card.classList.add('dragging');
    }
    apply();
    var n = host.neighbors(d.idx);
    var mid = function (i) {
      var el = card.querySelector('[data-row="' + i + '"]');
      return el ? layoutTop(el, card) + el.offsetHeight / 2 : null;
    };
    var m;
    if (n.prev >= 0 && (m = mid(n.prev)) != null && d.y < m) d.idx = host.step(d.idx, -1);
    else if (n.next >= 0 && (m = mid(n.next)) != null && d.y > m) d.idx = host.step(d.idx, 1);
    else return;
    var cur = host.card();
    var again = cur && cur.querySelector('[data-row="' + d.idx + '"]');
    if (again) d.rk = again.getAttribute('data-rk');
    afterDraw();
  }

  function stop() {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
  }
  /* Let go: the sentence glides into its slot, and the order is saved. */
  function up() {
    if (!d) return;
    var rk = d.rk;
    var ty = d.ty || 0;
    var on = d.on;
    d = null;
    stop();
    var card = host.card();
    if (card) card.classList.remove('dragging');
    if (!on) return;
    host.commit(rk);
    var after = host.card();
    var el = after && rowEl(after, rk);
    if (el) {
      el.classList.remove('lifted');
      el.style.transform = '';
      if (el.animate && !still())
        el.animate([{ transform: 'translateY(' + ty + 'px) scale(1.012)' }, { transform: 'none' }], {
          duration: GLIDE,
          easing: EASE,
        });
    }
  }
  /* Escape (or the system) ends the drag: the order goes back. */
  function cancel() {
    if (!d) return;
    var on = d.on;
    d = null;
    stop();
    if (on) host.cancel();
    var card = host.card();
    if (card) card.classList.remove('dragging');
  }
  function key(e) {
    if (e.key === 'Escape' && d) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  /* A press on a sentence's six-dot handle (pointer events, so a touch
     drags too). */
  function begin(e, handle) {
    if (!host || (e.button != null && e.button !== 0)) return;
    var card = host.card();
    var row = handle.closest('[data-row]');
    if (!card || !row) return;
    e.preventDefault();
    var natural = layoutTop(row, card);
    var y = cardY(e, card);
    d = {
      rk: row.getAttribute('data-rk'),
      idx: Number(row.getAttribute('data-row')),
      startY: e.clientY,
      y: y,
      grab: y - natural,
      ty: 0,
      on: false,
    };
    try {
      handle.focus({ preventScroll: true });
    } catch (x) {
      /* not focusable */
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key, true);
  }

  return {
    still: still,
    measure: measure,
    play: play,
    configure: configure,
    begin: begin,
    afterDraw: afterDraw,
    dragging: function () {
      return !!d && !!d.on;
    },
    dragKey: function () {
      return d && d.on ? d.rk : null;
    },
  };
})();
