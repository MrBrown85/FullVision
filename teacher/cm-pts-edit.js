// @ts-check
/* cm-pts-edit.js — Points and Proficiency stays locked until the teacher
   presses Edit (docs/DECISIONS.md, "Points and Proficiency locks until Edit").

   Colin, 2026-11-27: "Users are accidentally dragging things and then
   forgetting where they had set them." Editing works on a draft held in
   memory: a drag, an arrow key, a typed value and the three presets change
   the draft with the rules the ruler always had, and nothing is saved until
   Save. Cancel, leaving the Grading tab or switching class drops the draft.
   Save asks first when any student's course % would change, names what moved,
   saves through saveCourseConfig as before, and offers Undo.

   CmPtsModel holds the numbers, CmPtsRuler draws, CmPtsPointer follows the
   pointer (drag, the pull on a locked marker, previewing a preset). This
   file keeps the draft and answers the buttons. DashClassManager hands it,
   through configure(), the state object, how to redraw, how to redraw the
   Check With a Student card, and the course's ended term. */
window.CmPtsEdit = (function () {
  'use strict';

  var M = CmPtsModel;
  /** @type {any} */
  var _host = null;
  /** @type {{ cid: string, scale: any, opened: any } | null} */
  var _draft = null;
  // What the teacher typed over a scale that changed on another device first: { cid, typed: [lines] }.
  /** @type {{ cid: string, typed: string[] } | null} */
  var _notice = null;
  /** @type {{ name: string, scale: any } | null} */
  var _preview = null;
  // The scale on the ruler while a drag, a typed value or a preset pointed at is not yet in the draft.
  var _live = null;
  // A notice has just appeared: bring it into view once it is drawn.
  var _reveal = false;
  // While a draft is open, a scale arriving from another device is looked for twice a second.
  var _watch = 0;
  /** @type {{ pick: any, typed: string | null, error: string | null, dragEnd: number }} */
  var _ui = { pick: null, typed: null, error: null, dragEnd: 0 };

  function configure(h) {
    _host = h;
  }
  function selected() {
    return _host.state.cmSelectedCourse;
  }
  function editing(cid) {
    return !!_draft && _draft.cid === cid;
  }
  function draftOf(cid) {
    return editing(cid) && _draft ? _draft.scale : null;
  }
  // Whether the draft differs from what is saved, as a teacher would see it.
  function dirty(cid) {
    var d = draftOf(cid);
    return !!d && M.differs(getGradingScale(cid), d);
  }
  // The scale Check With a Student reads: the preset in view, else the draft; null at rest.
  function shownScale(cid) {
    return editing(cid) ? _live || draftOf(cid) : null;
  }
  function noteDragEnd() {
    _ui.dragEnd = Date.now();
  }
  function justDragged() {
    return Date.now() - _ui.dragEnd < 500;
  }
  function clearUi() {
    _ui.pick = null;
    _ui.typed = null;
    _ui.error = null;
  }
  function focusOn(sel) {
    _host.state._cmKeepFocusSel = sel;
  }

  /* The Points and Proficiency section, for the Grading tab. */
  function render(cid) {
    reconcile(cid);
    if (_reveal) setTimeout(revealNotice, 0);
    _reveal = false;
    var saved = getGradingScale(cid);
    var ed = editing(cid);
    _preview = null;
    _live = null;
    return CmPtsRuler.render({
      cid: cid,
      editing: ed,
      shown: ed ? draftOf(cid) : saved,
      saved: saved,
      pick: ed && _ui.pick && _ui.pick.cid === cid ? _ui.pick : null,
      typed: _ui.typed,
      error: _ui.error,
      previewing: false,
      dirty: ed && dirty(cid),
      notice: _notice && _notice.cid === cid ? noticeHtml(_notice) : '',
      preview: ed ? CmPtsSave.previewHtml(cid) : '',
    });
  }

  /* ── The draft ───────────────────────────────────────────── */
  function start() {
    var cid = selected();
    if (!cid) return;
    clearUi();
    _preview = null;
    _notice = null;
    startWatch();
    _draft = { cid: cid, scale: structuredClone(getGradingScale(cid)), opened: structuredClone(getGradingScale(cid)) };
    focusOn('#cm-pts-step-1');
    _host.render();
  }
  function cancel() {
    var cid = selected();
    drop();
    focusOn('#cm-pts-edit-btn');
    if (cid) _host.render();
  }
  /* A scale that arrived from another device while the draft was open is
     never written over (Class Settings keeps categories the same way, DECISIONS
     "Class settings on two computers"). Nothing typed yet: the draft starts
     again from the new scale. Something typed: the ruler shows the saved
     markers and the line says what was typed, until Dismiss. True when the
     draft was let go. */
  function reconcile(cid) {
    var d = draftOf(cid) && _draft;
    if (!d || M.stored(getGradingScale(cid)) === M.stored(d.opened)) return false;
    if (M.differs(d.opened, d.scale)) {
      _notice = { cid: cid, typed: M.lines(d.opened, d.scale) };
      _reveal = true;
      drop();
      return true;
    }
    d.opened = structuredClone(getGradingScale(cid));
    d.scale = structuredClone(d.opened);
    return false;
  }
  /* Brings the notice into view (smooth; at once with Reduce Motion) and puts the
     focus on it, so a screen reader reads it once: it has no live-region role. */
  function revealNotice() {
    var el = /** @type {HTMLElement | null} */ (document.querySelector('.cm-pts-scale .cm-cat-notice'));
    if (!el) return;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }
  function startWatch() {
    if (_watch) return;
    _watch = setInterval(function () {
      var cid = _draft && _draft.cid;
      if (!cid) return stopWatch();
      if (reconcile(cid)) _host.render();
    }, 500);
  }
  function stopWatch() {
    clearInterval(_watch);
    _watch = 0;
  }
  // The line the categories use, with its What You Typed list and Dismiss (cm-cat-notice).
  // html-safe: the sentence is a constant; each typed line through esc
  function noticeHtml(n) {
    return (
      '<div class="cm-cat-notice" tabindex="-1"><div class="cm-cat-notice-text">' +
      'Points and Proficiency changed on another device, so nothing was saved. These are the current ones. What you typed is below.' +
      '</div><div class="cm-cat-typed"><div class="cm-cat-typed-label">What You Typed</div><ul>' +
      n.typed
        .map(function (l) {
          return '<li>' + esc(l) + '</li>';
        })
        .join('') +
      '</ul></div><button class="cm-add-link" data-action="cmPtsNoticeDone">Dismiss</button></div>'
    );
  }

  // Let the draft go, without a redraw (leaving the tab, or the class).
  function drop() {
    stopWatch();
    _draft = null;
    _live = null;
    _preview = null;
    clearUi();
  }
  // The class whose Grading tab is on screen, or null: a draft for any other is dropped.
  function keep(cid) {
    if (_draft && _draft.cid !== cid) drop();
  }
  function reset() {
    drop();
    _notice = null;
    _ui.dragEnd = 0;
  }

  /* ── Picking and moving ──────────────────────────────────── */
  function pickedOf(cid) {
    return _ui.pick && _ui.pick.cid === cid ? _ui.pick : null;
  }
  function samePick(a, b) {
    return !!a && !!b && a.kind === b.kind && (a.kind === 'step' ? a.key === b.key : a.level === b.level);
  }
  function pickId(p) {
    return p.kind === 'step' ? 'cm-pts-step-' + M.stepId(p.key) : 'cm-pts-edge-' + p.level;
  }
  // The marker or handle a button stands for, or null.
  function fromEl(cid, el) {
    var d = (el && el.dataset) || {};
    if (d.kind === 'step') {
      var ok = COUNTS_AS_STEPS.some(function (s) {
        return s.key === d.key;
      });
      return ok ? { cid: cid, kind: 'step', key: d.key } : null;
    }
    var level = parseInt(d.level, 10);
    return d.kind === 'edge' && level >= 2 && level <= 4 ? { cid: cid, kind: 'edge', level: level } : null;
  }
  function valueOf(cid, p) {
    var d = draftOf(cid);
    if (!d) return NaN;
    return p.kind === 'step' ? M.stepValues(d)[p.key] : M.starts(d)[p.level];
  }
  function rangeOf(cid, p) {
    return M.range(draftOf(cid), p);
  }

  /* A marker's or handle's percent, typed, nudged or dragged, into the draft. */
  function apply(cid, p, raw) {
    var d = draftOf(cid);
    if (!d || !_draft) return;
    _ui.pick = Object.assign({}, p, { cid: cid });
    var res = M.edit(d, p, raw);
    _ui.error = res.error || null;
    _ui.typed = res.error ? String(raw == null ? '' : raw).trim() : null;
    if (res.scale) _draft.scale = res.scale;
    _host.render();
  }
  // The draft as a drag would leave it, to show before it lands.
  function trial(cid, p, v) {
    var d = draftOf(cid);
    var res = d && M.edit(d, p, String(v));
    return res && res.scale ? res.scale : d;
  }

  function pick(el) {
    var cid = selected();
    if (!cid || !editing(cid) || justDragged()) return;
    var p = fromEl(cid, el);
    if (!p) return;
    _ui.pick = samePick(pickedOf(cid), p) ? null : p;
    _ui.error = null;
    _ui.typed = null;
    focusOn('#' + pickId(p));
    _host.render();
  }

  // Clicking a ghost puts that marker, or that band start, back where it was saved.
  function ghost(el) {
    var cid = selected();
    var d = draftOf(cid);
    var p = cid && d && fromEl(cid, el);
    if (!cid || !d || !p || !_draft) return;
    var saved = getGradingScale(cid);
    var at = M.starts(d);
    var own = M.ownPercents(d);
    if (p.kind === 'edge') at[p.level] = M.starts(saved)[p.level];
    else {
      var was = M.ownPercents(saved);
      if (p.key in was) own[p.key] = was[p.key];
      else {
        delete own[p.key];
        var want = M.stepValues(saved)[p.key];
        if (Math.abs(M.stepValues(M.build(at, own, d.labels))[p.key] - want) > 0.049)
          own[p.key] = Math.round(want * 10) / 10;
      }
    }
    var back = M.build(at, own, d.labels);
    _ui.error = M.invalid(back);
    _ui.typed = null;
    if (!_ui.error) _draft.scale = back;
    _host.render();
  }

  // The box under the scale changed (typed, then Enter or leaving it).
  function savePointsScale(el) {
    var cid = selected();
    var p = cid && pickedOf(cid);
    if (cid && p && el && editing(cid)) apply(cid, p, el.value);
  }

  /* Keys on the scale: Left and Right nudge a marker by 0.1 (Shift: 1) and
     a handle by 1 (Shift: 5); Enter in the box takes the typed value; Escape
     lets go and puts the focus back on what was picked. */
  function keydown(e) {
    var el = e.target;
    var cid = selected();
    if (!cid || !editing(cid) || !el || !el.closest || !el.closest('.cm-pts-scale')) return false;
    var picked = pickedOf(cid);
    if (e.key === 'Escape' && picked) {
      e.preventDefault();
      clearUi();
      focusOn('#' + pickId(picked));
      _host.render();
      return true;
    }
    if (el.id === 'cm-pts-input' && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!picked) return true;
      focusOn('#cm-pts-input');
      apply(cid, picked, el.value);
      return true;
    }
    var btn = el.closest('[data-action="cmPtsPick"]');
    if (!btn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey) return false;
    var p = fromEl(cid, btn);
    if (!p) return false;
    e.preventDefault();
    var by = p.kind === 'edge' ? (e.shiftKey ? 5 : 1) : e.shiftKey ? 1 : 0.1;
    var next = Math.round((valueOf(cid, p) + (e.key === 'ArrowRight' ? by : -by)) * 10) / 10;
    focusOn('#' + pickId(p));
    apply(cid, p, String(next));
    return true;
  }

  // While typing, the marker or handle moves before the box is taken.
  function live(el) {
    var cid = selected();
    var p = cid && editing(cid) && pickedOf(cid);
    var v = parseFloat(el.value);
    if (!cid || !p || !isFinite(v)) return;
    show(cid, trial(cid, p, Math.max(0, Math.min(100, v))), false, false);
  }

  /* ── What is on the ruler, without a redraw ──────────────── */
  var _checkTimer = 0;
  function refreshSoon(cid) {
    if (_checkTimer) return;
    _checkTimer = setTimeout(function () {
      _checkTimer = 0;
      if (!editing(cid)) return;
      if (_host.refreshCheck) _host.refreshCheck(cid);
      var line = document.getElementById('cm-pts-preview');
      // html-safe: previewHtml escapes the student's name and every grade
      if (line) line.innerHTML = CmPtsSave.previewHtml(cid);
    }, 90);
  }
  function show(cid, scale, glide, previewing) {
    _live = scale === draftOf(cid) ? null : scale;
    CmPtsRuler.sync(document, { shown: scale, saved: getGradingScale(cid), previewing: previewing }, glide);
    refreshSoon(cid);
  }

  /* ── Presets ─────────────────────────────────────────────── */
  var PRESET_OF = { cmPointsScaleBc: 'bc', cmPointsScaleMatch: 'match', cmPointsScaleReset: 'reset' };
  function takePreset(name) {
    var cid = selected();
    var d = draftOf(cid);
    if (!cid || !d || !_draft) return;
    clearUi();
    _preview = null;
    _draft.scale = M.preset(name, d);
    _host.render();
  }
  // Pointing at a preset shows where the markers would land; leaving puts them back.
  function previewPreset(name) {
    var cid = selected();
    var d = cid && draftOf(cid);
    if (!cid || !d) return;
    _preview = name ? { name: name, scale: M.preset(name, d) } : null;
    show(cid, _preview ? _preview.scale : d, true, !!name);
  }

  function dismiss() {
    _notice = null;
    _host.render();
  }

  /* Every cmPts* press from the dispatcher; true when it was one of these. */
  function handleAction(action, el) {
    if (action === 'cmPtsEdit') start();
    else if (action === 'cmPtsCancel') cancel();
    else if (action === 'cmPtsSave') CmPtsSave.save();
    else if (action === 'cmPtsNoticeDone') dismiss();
    else if (action === 'cmPtsUse') _host.openCopy({ only: 'gradingScale' });
    else if (action === 'cmPtsPick') pick(el);
    else if (action === 'cmPtsGhost') ghost(el);
    else return false;
    return true;
  }

  return {
    configure: configure,
    render: render,
    editing: editing,
    draft: draftOf,
    dirty: dirty,
    shownScale: shownScale,
    keep: keep,
    drop: drop,
    reconcile: reconcile,
    clearNotice: function () {
      _notice = null;
    },
    reset: reset,
    handleAction: handleAction,
    keydown: keydown,
    live: live,
    savePointsScale: savePointsScale,
    takePreset: takePreset,
    previewPreset: previewPreset,
    presetOf: function (action) {
      return PRESET_OF[action] || null;
    },
    // For CmPtsPointer
    fromEl: fromEl,
    valueOf: valueOf,
    rangeOf: rangeOf,
    trial: trial,
    apply: apply,
    show: show,
    noteDragEnd: noteDragEnd,
    pickId: pickId,
    focusOn: focusOn,
    selected: selected,
    host: function () {
      return _host;
    },
  };
})();
