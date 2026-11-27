// @ts-check
/* cm-pts-pointer.js — Points and Proficiency: what the pointer does.

   Editing: a press on a marker or handle that moves drags it (a marker snaps
   to 0.1 and a handle to 1, between its neighbours) and takes the value into
   the draft when let go; a press that doesn't move is a click. Locked: the
   same press makes a marker give up to 8px and spring back, and Edit pulses
   twice (with Reduce Motion, a still ring and no movement), so a teacher who
   reaches for a marker is shown where the lock is. Pointing at or focusing a
   preset button previews it on the ruler (CmPtsEdit.previewPreset).
   DashClassManager hands over its document listener function. */
window.CmPtsPointer = (function () {
  'use strict';

  var E = CmPtsEdit;
  /** @type {any} */
  var _drag = null;
  /** @type {any} */
  var _pull = null;

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Edit pulses twice: a ring that grows and fades, or, with Reduce Motion, a still ring.
  function nudgeEdit() {
    var btn = document.getElementById('cm-pts-edit-btn');
    if (!btn) return;
    btn.classList.remove('is-nudge');
    void btn.offsetWidth;
    btn.classList.add('is-nudge');
  }

  function startPull(e, t) {
    var pill = t.classList.contains('cm-pts-pill') && !reduced();
    _pull = { pointer: e.pointerId, x0: e.clientX, el: pill ? t : null };
    if (_pull.el) _pull.el.classList.add('is-pulling');
  }
  function movePull(e) {
    if (!_pull || e.pointerId !== _pull.pointer || !_pull.el) return;
    var dx = Math.max(-8, Math.min(8, (e.clientX - _pull.x0) * 0.35));
    _pull.el.style.transform = 'translateX(' + dx + 'px)';
  }
  function endPull() {
    var p = _pull;
    _pull = null;
    if (!p) return;
    if (p.el) {
      p.el.classList.remove('is-pulling');
      p.el.style.transform = '';
    }
    nudgeEdit();
  }

  function startDrag(e, btn, cid) {
    var ruler = btn.closest('.cm-pts-ruler');
    var p = E.fromEl(cid, btn);
    if (!p || !ruler) return;
    var range = E.rangeOf(cid, p);
    _drag = {
      cid: cid,
      pick: p,
      pointer: e.pointerId,
      rect: ruler.getBoundingClientRect(),
      x0: e.clientX,
      moved: false,
      value: E.valueOf(cid, p),
      lo: range[0],
      hi: range[1],
    };
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      // No capture: the drag still follows the document's pointer events.
    }
  }
  function moveDrag(e) {
    var d = _drag;
    if (!d || e.pointerId !== d.pointer || !d.rect.width) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    d.moved = true;
    e.preventDefault();
    var snap = d.pick.kind === 'edge' ? 1 : 0.1;
    var v = Math.round(((e.clientX - d.rect.left) / d.rect.width) * 100 * (1 / snap)) / (1 / snap);
    d.value = Math.max(d.lo, Math.min(d.hi, v));
    E.show(d.cid, E.trial(d.cid, d.pick, d.value), false, false);
  }
  function endDrag(e) {
    var d = _drag;
    if (!d || e.pointerId !== d.pointer) return;
    _drag = null;
    if (!d.moved) return;
    E.noteDragEnd();
    if (e.type === 'pointercancel' || d.cid !== E.selected()) return E.host().render();
    E.focusOn('#' + E.pickId(d.pick));
    E.apply(d.cid, d.pick, String(d.value));
  }

  // The preset button an event is on, as 'bc' | 'match' | 'reset', or null.
  function presetAt(el) {
    var b = el && el.closest && el.closest('.cm-pts-actions [data-action]');
    return b ? E.presetOf(b.dataset.action) : null;
  }

  function init(addDocListener) {
    addDocListener('pointerdown', function (e) {
      var cid = E.selected();
      var t =
        e.button === 0 &&
        cid &&
        e.target.closest &&
        e.target.closest('.cm-pts-ruler .cm-pts-pill, .cm-pts-ruler .cm-pts-handle');
      if (!t || t.closest('.cm-pts-ghost')) return;
      if (!E.editing(cid)) return startPull(e, t);
      if (t.dataset.action === 'cmPtsPick') startDrag(e, t, cid);
    });
    addDocListener('pointermove', function (e) {
      movePull(e);
      moveDrag(e);
    });
    function up(e) {
      if (_pull && e.pointerId === _pull.pointer) endPull();
      endDrag(e);
    }
    addDocListener('pointerup', up);
    addDocListener('pointercancel', up);
    // Pointing at or focusing a preset previews it; leaving puts the markers back.
    ['pointerover', 'focusin'].forEach(function (type) {
      addDocListener(type, function (e) {
        var name = presetAt(e.target);
        if (name && !_drag) E.previewPreset(name);
      });
    });
    ['pointerout', 'focusout'].forEach(function (type) {
      addDocListener(type, function (e) {
        var from = presetAt(e.target);
        if (from && presetAt(e.relatedTarget) !== from) E.previewPreset(presetAt(e.relatedTarget));
      });
    });
  }

  return { init: init };
})();
