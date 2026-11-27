// @ts-check
/* obs-follow-ups.js — Follow-ups under an observation (docs/DECISIONS.md,
   "Observation follow-ups"), as the Observations page's cards, its edit
   window and the phone's Observe tab show them.

   A follow-up is a dated entry under one observation: a quick choice
   (OBS_FOLLOW_UP_KINDS: Called Home, Spoke With Student, Still Happening,
   Resolved) the teacher can type after, or words alone. A Concern with a
   Resolved follow-up is closed. Follow-ups are teacher-only: they never
   print, never feed a grade and never reach the student page, and they are
   never cards of their own. The data is in shared/data-observations.js.

   The pieces:
     cardHtml(cid, ob)    the strip at the foot of a log card: "2 follow-ups ·
                          last Nov 15" (opens the timeline in place) and
                          + Follow Up
     panelHtml(cid, ob)   the timeline and + Follow Up in the edit window
                          and the phone's edit sheet
     confirmDelete(cid, obId, proceed)  "Delete this observation and its 2
                          follow-ups?" before an observation with follow-ups
                          is deleted; straight through when it has none
     reveal(obId)         a card opens with its timeline (a link to the
                          Observations page with ?ob=)

   Every control carries data-fu-action and is handled here, in the capture
   phase, so a click on the strip never also opens the card beneath it. The
   editor is a small window on a computer and the edit sheet's second page
   on the phone (the way its pickers open). Motion: the timeline glides open
   and shut in about 200 ms; nothing fades. */
/** @type {any} */ (window).ObsFollowUps = (function () {
  'use strict';

  var W = /** @type {any} */ (window);
  /** @param {string} id @returns {any} */
  function _el(id) {
    return document.getElementById(id);
  }
  /** @param {string} sel @returns {any} */
  function _q(sel) {
    return document.querySelector(sel);
  }
  /** @param {string} sel @returns {any[]} */
  function _qa(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  var GLIDE_MS = 200;
  // The same bin as the observation card's (shared/obs-card.js).
  function _trash() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>';
  }
  var _open = {}; // obId → true while its card shows the timeline
  /** @type {any} */
  var _ed = null; // the open editor: { cid, obId, fuId, kind, from, phone }

  /* ── Pure helpers (exported for tests) ──────────────────── */

  function kindLabel(kind) {
    var k = kind && OBS_FOLLOW_UP_KINDS[kind];
    return k ? k.label : '';
  }

  function _day(f) {
    return f.date || (f.created || '').slice(0, 10);
  }

  /* "Nov 15", or "Nov 15, 2025" in another year. */
  function shortDate(f, now) {
    var ymd = _day(f);
    if (!ymd) return '';
    var d = new Date(ymd + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    /** @type {Intl.DateTimeFormatOptions} */
    var o = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== (now || new Date()).getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('en-CA', o);
  }

  /* "1 follow-up · last Nov 15", "2 follow-ups · last Nov 15"; '' for none. */
  function summaryText(list, now) {
    list = list || [];
    if (!list.length) return '';
    var last = list[list.length - 1];
    return list.length + (list.length === 1 ? ' follow-up' : ' follow-ups') + ' · last ' + shortDate(last, now);
  }

  /* ── HTML ───────────────────────────────────────────────── */

  var CHEVRON =
    '<svg class="obs-fu-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function _ids(ob) {
    return ' data-fu-parent="' + esc(ob.id) + '"';
  }

  // html-safe: dates, kind labels (constants) and the teacher's words go through esc; ids are escaped.
  function timelineHtml(ob, list) {
    var out = '<ol class="obs-fu-list" aria-label="Follow-ups">';
    list.forEach(function (f) {
      out +=
        '<li class="obs-fu-item"' +
        (f.kind ? ' data-kind="' + esc(f.kind) + '"' : '') +
        '><button type="button" class="obs-fu-entry" data-fu-action="edit"' +
        _ids(ob) +
        ' data-fu-id="' +
        esc(f.id) +
        '" aria-label="Edit follow-up from ' +
        esc(shortDate(f)) +
        '"><span class="obs-fu-date">' +
        esc(shortDate(f)) +
        '</span>' +
        (f.kind ? '<span class="obs-fu-kind">' + esc(kindLabel(f.kind)) + '</span>' : '') +
        (f.text ? '<span class="obs-fu-text">' + esc(f.text) + '</span>' : '') +
        '</button></li>';
    });
    return out + '</ol>';
  }

  function _addBtn(ob, cls) {
    return (
      '<button type="button" class="obs-add obs-fu-add' +
      (cls ? ' ' + cls : '') +
      '" data-fu-action="add"' +
      _ids(ob) +
      '>+ Follow Up</button>'
    );
  }

  function _closedHtml(ob) {
    return isObservationResolved(ob) && ob.sentiment === 'concern'
      ? '<span class="obs-fu-closed" title="This concern has a Resolved follow-up">Resolved</span>'
      : '';
  }

  // html-safe: summaryText is numbers and a date; timelineHtml escapes; the rest is fixed markup.
  function _cardInner(cid, ob) {
    var list = getObservationFollowUps(cid, ob.id);
    var open = !!(list.length && _open[ob.id]);
    var bar =
      '<div class="obs-fu-bar">' +
      (list.length
        ? '<button type="button" class="obs-fu-toggle" data-fu-action="toggle"' +
          _ids(ob) +
          ' aria-expanded="' +
          open +
          '">' +
          CHEVRON +
          esc(summaryText(list)) +
          '</button>'
        : '') +
      _closedHtml(ob) +
      _addBtn(ob) +
      '</div>';
    return bar + (open ? '<div class="obs-fu-tl">' + timelineHtml(ob, list) + '</div>' : '');
  }

  /* The strip at the foot of a log card. ob: a card's observation (with
     studentId). */
  function cardHtml(cid, ob) {
    if (!ob || !ob.id) return '';
    return (
      '<div class="obs-fu" data-fu-block="card"' +
      _ids(ob) +
      ' data-fu-sid="' +
      esc(ob.studentId || '') +
      '">' +
      _cardInner(cid, ob) +
      '</div>'
    );
  }

  // html-safe: timelineHtml escapes; the rest is fixed markup.
  function _panelInner(cid, ob) {
    var list = getObservationFollowUps(cid, ob.id);
    return (
      '<div class="obs-fu-head"><span class="obs-row-label">Follow-Ups</span>' +
      _closedHtml(ob) +
      _addBtn(ob) +
      '</div>' +
      (list.length ? timelineHtml(ob, list) : '<div class="obs-fu-none">None yet.</div>')
    );
  }

  /* The timeline in the edit window (desktop) or edit sheet (phone). */
  function panelHtml(cid, ob) {
    if (!ob || !ob.id) return '';
    return (
      '<div class="obs-fu obs-fu-panel" data-fu-block="panel"' +
      _ids(ob) +
      ' data-fu-sid="' +
      esc(ob.studentId || '') +
      '">' +
      _panelInner(cid, ob) +
      '</div>'
    );
  }

  /* ── Drawing in place ───────────────────────────────────── */

  function _cssEsc(s) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
  }

  function _obOf(cid, obId, sid) {
    var all = getQuickObs(cid) || {};
    var lists =
      sid && all[sid]
        ? [all[sid]]
        : Object.keys(all).map(function (k) {
            return all[k];
          });
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < (lists[i] || []).length; j++) {
        if (lists[i][j] && lists[i][j].id === obId) return Object.assign({ studentId: sid }, lists[i][j]);
      }
    }
    return null;
  }

  function _reduced() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Height from `from` to `to` px, about 200 ms, then done(). */
  function _glide(el, from, to, done) {
    if (!el || from === to || _reduced() || typeof el.animate !== 'function') {
      if (done) done();
      return;
    }
    el.style.overflow = 'hidden';
    var a = el.animate([{ height: from + 'px' }, { height: to + 'px' }], {
      duration: GLIDE_MS,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
    a.onfinish = a.oncancel = function () {
      el.style.overflow = '';
      if (done) done();
    };
  }

  // html-safe: _cardInner and _panelInner escape what they draw.
  function _redraw(block, cid) {
    var obId = block.getAttribute('data-fu-parent');
    var ob = _obOf(cid, obId, block.getAttribute('data-fu-sid'));
    if (!ob) return;
    block.innerHTML = block.getAttribute('data-fu-block') === 'panel' ? _panelInner(cid, ob) : _cardInner(cid, ob);
  }

  /* Every strip and panel of one observation, drawn again from the data;
     each glides from its old height to its new one. */
  function refresh(cid, obId) {
    if (typeof document === 'undefined') return;
    _qa('[data-fu-block][data-fu-parent="' + _cssEsc(obId) + '"]').forEach(function (b) {
      var from = b.offsetHeight;
      _redraw(b, cid);
      _glide(b, from, b.offsetHeight);
    });
    // The Observations page's Open Concerns count listens.
    document.dispatchEvent(new CustomEvent('fv:follow-ups-changed', { detail: { cid: cid, obId: obId } }));
  }

  function _setOpen(cid, block, open) {
    var obId = block.getAttribute('data-fu-parent');
    var tl = block.querySelector('.obs-fu-tl');
    if (!open) {
      delete _open[obId];
      if (!tl) return _redraw(block, cid);
      _glide(tl, tl.offsetHeight, 0, function () {
        _redraw(block, cid);
      });
      return;
    }
    _open[obId] = true;
    _redraw(block, cid);
    var fresh = block.querySelector('.obs-fu-tl');
    if (fresh) _glide(fresh, 0, fresh.scrollHeight);
  }

  /* The card for obId opens with its timeline, and is brought into view
     once the page has drawn it. */
  function reveal(obId) {
    if (!obId) return;
    _open[obId] = true;
    var tries = 0;
    (function look() {
      var card = _q('.obs-card[data-obid="' + _cssEsc(obId) + '"]');
      if (card) {
        card.scrollIntoView({ block: 'center' });
        card.classList.add('obs-fu-revealed');
        return;
      }
      if (++tries < 20) setTimeout(look, 50);
    })();
  }

  /* ── The editor ─────────────────────────────────────────── */

  function _phone() {
    return !!(W.MComponents && _el('m-obs-edit-picker'));
  }

  // html-safe: kind labels are constants; the teacher's words go through esc.
  function _formHtml(f) {
    var kind = f ? f.kind : null;
    var chips = '<div class="obs-fu-chips" role="group" aria-label="What happened">';
    Object.keys(OBS_FOLLOW_UP_KINDS).forEach(function (k) {
      chips +=
        '<button type="button" class="obs-fu-chip' +
        (kind === k ? ' on' : '') +
        '" data-fu-action="kind" data-fu-kind="' +
        k +
        '" aria-pressed="' +
        (kind === k) +
        '">' +
        esc(OBS_FOLLOW_UP_KINDS[k].label) +
        '</button>';
    });
    return (
      chips +
      '</div><textarea class="obs-note-box obs-fu-textarea" id="obs-fu-text" rows="3" aria-label="Follow-up" placeholder="What happened?">' +
      esc(f ? f.text || '' : '') +
      '</textarea>'
    );
  }

  // html-safe: name and type labels and the observation's words go through esc.
  function _contextHtml(cid, ob) {
    var st = (getStudents(cid) || []).find(function (s) {
      return s.id === ob.studentId;
    });
    var type = ob.sentiment && OBS_SENTIMENTS[ob.sentiment] ? OBS_SENTIMENTS[ob.sentiment].label : 'Observation';
    var line = String(ob.text || '').split('\n')[0];
    if (line.length > 140) line = line.slice(0, 139) + '…';
    return (
      '<div class="obs-fu-of"><b>' +
      esc(st ? displayName(st) : '') +
      '</b> · ' +
      esc(type) +
      ' · ' +
      esc(ObsCard.cardWhen(ob, true)) +
      (isPrivateObservation(ob) ? ' ' + obsPrivateLabelHtml(ob) : '') +
      '<div class="obs-fu-of-text">' +
      esc(line) +
      '</div></div>'
    );
  }

  function _canSave() {
    var ta = _el('obs-fu-text');
    return !!(_ed && (_ed.kind || (ta && ta.value.trim())));
  }
  function _syncSave() {
    var b = _q('[data-fu-action="save"]');
    if (b) b.disabled = !_canSave();
  }

  // html-safe: _contextHtml and _formHtml escape; the rest is fixed markup.
  function open(cid, obId, sid, fuId, from) {
    var ob = _obOf(cid, obId, sid);
    if (!ob) return;
    /** @type {any} */ var f = null;
    if (fuId) {
      f = getObservationFollowUps(cid, obId).find(function (x) {
        return x.id === fuId;
      });
      if (!f) return;
    }
    close(true);
    _ed = { cid: cid, obId: obId, sid: sid, fuId: fuId || null, kind: f ? f.kind : null, from: from || null };
    var title = fuId ? 'Edit Follow-Up' : 'Follow Up';
    if (_phone()) {
      var form = _q('#m-obs-edit .m-edit-form');
      var pick = _el('m-obs-edit-picker');
      _ed.phone = true;
      pick.setAttribute('data-kind', 'follow-up');
      pick.innerHTML =
        '<div class="m-edit-top"><button type="button" class="m-edit-cancel" data-fu-action="cancel">‹ Back</button>' +
        '<div class="m-edit-title">' +
        esc(title) +
        '</div><span class="m-edit-top-sp" aria-hidden="true"></span></div>' +
        '<div class="m-edit-body obs-fu-form">' +
        _contextHtml(cid, ob) +
        _formHtml(f) +
        (fuId
          ? '<button type="button" class="m-obs-sheet-delete" data-fu-action="delete">Delete Follow-Up</button>'
          : '') +
        '<button type="button" class="m-btn-primary m-edit-primary" data-fu-action="save">Save</button>' +
        '</div>';
      if (form) form.hidden = true;
      pick.hidden = false;
    } else {
      var bd = document.createElement('div');
      bd.className = 'obs-fu-backdrop';
      bd.id = 'obs-fu-backdrop';
      bd.innerHTML =
        '<div class="obs-fu-dialog" role="dialog" aria-modal="true" aria-labelledby="obs-fu-title">' +
        '<div class="obs-fu-dialog-title" id="obs-fu-title">' +
        esc(title) +
        '</div>' +
        _contextHtml(cid, ob) +
        _formHtml(f) +
        '<div class="obs-focus-foot">' +
        (fuId
          ? '<button type="button" class="obs-focus-delete" data-fu-action="delete">' + _trash() + 'Delete</button>'
          : '') +
        '<span class="obs-focus-hint">Enter saves · Esc cancels</span><span class="obs-focus-spacer"></span>' +
        '<button type="button" class="btn btn-ghost" data-fu-action="cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-fu-action="save">Save</button>' +
        '</div></div>';
      document.body.appendChild(bd);
    }
    _syncSave();
    var ta = _el('obs-fu-text');
    var first = fuId ? ta : _q('.obs-fu-chip');
    if (first) first.focus();
  }

  /* Closes without saving. quiet: another editor opens next. */
  function close(quiet) {
    if (!_ed) return;
    var ed = _ed;
    _ed = null;
    if (ed.phone) {
      var form = _q('#m-obs-edit .m-edit-form');
      var pick = _el('m-obs-edit-picker');
      if (pick) {
        pick.hidden = true;
        pick.innerHTML = '';
        pick.removeAttribute('data-kind');
      }
      if (form) form.hidden = false;
    } else {
      var bd = _el('obs-fu-backdrop');
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
    }
    if (quiet) return;
    // The control that opened it, or the + Follow Up of the same
    // observation, the edit window's first.
    var sel = '[data-fu-action="add"][data-fu-parent="' + _cssEsc(ed.obId) + '"]';
    var back =
      (ed.from && document.body.contains(ed.from) && ed.from) ||
      _q('#obs-focus-backdrop ' + sel + ', #m-obs-edit ' + sel) ||
      _q(sel);
    if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  function save() {
    if (!_ed || !_canSave()) return;
    var ed = _ed;
    var text = _el('obs-fu-text').value;
    var ok = ed.fuId
      ? updateObservationFollowUp(ed.cid, ed.obId, ed.fuId, ed.kind, text)
      : addObservationFollowUp(ed.cid, ed.obId, ed.kind, text);
    if (!ok) return;
    _open[ed.obId] = true;
    refresh(ed.cid, ed.obId);
    close();
  }

  function _ask(title, message, onOk) {
    if (W.MComponents && W.MComponents.confirmSheet) W.MComponents.confirmSheet(title, message, 'Delete', onOk);
    else if (typeof W.showConfirm === 'function') W.showConfirm(title, message, 'Delete', 'danger', onOk);
    else onOk();
  }

  function _deleteFollowUp() {
    if (!_ed || !_ed.fuId) return;
    var ed = _ed;
    var go = function () {
      deleteObservationFollowUp(ed.cid, ed.obId, ed.fuId);
      refresh(ed.cid, ed.obId);
    };
    if (ed.phone) {
      // The question takes the sheet; the observation's page goes with it.
      _ed = null;
      if (W.MObserve && W.MObserve.resetSheetState) W.MObserve.resetSheetState();
      _ask('Delete this follow-up?', 'It is taken off the observation for good.', go);
      return;
    }
    close(true);
    _ask('Delete this follow-up?', 'It is taken off the observation for good.', go);
  }

  /* Before an observation is deleted: proceed() at once when it has no
     follow-ups, else after "Delete this observation and its 2 follow-ups?". */
  function confirmDelete(cid, obId, proceed) {
    var n = getObservationFollowUps(cid, obId).length;
    if (!n) return proceed();
    _ask(
      'Delete this observation and its ' + (n === 1 ? 'follow-up' : n + ' follow-ups') + '?',
      (n === 1 ? 'Its follow-up is' : 'Its follow-ups are') + ' deleted with it.',
      proceed,
    );
  }

  /* ── Events ─────────────────────────────────────────────── */

  function _cid() {
    return typeof getActiveCourse === 'function' ? getActiveCourse() : null;
  }

  function _onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var inBlock = t.closest('[data-fu-block]');
    var el = t.closest('[data-fu-action]');
    if (!el && !inBlock) return;
    // Nothing in the strip opens the card under it.
    e.stopPropagation();
    if (!el) return;
    e.preventDefault();
    var a = el.getAttribute('data-fu-action');
    var block = el.closest('[data-fu-block]');
    var cid = (_ed && _ed.cid) || _cid();
    if (a === 'toggle' && block) _setOpen(cid, block, !_open[block.getAttribute('data-fu-parent')]);
    else if (a === 'add' || a === 'edit') {
      var obId = el.getAttribute('data-fu-parent');
      var sid = block ? block.getAttribute('data-fu-sid') : null;
      // On the phone a card's + Follow Up opens the observation's sheet
      // first; the follow-up is its second page, as its pickers are.
      if (W.MObserve && W.MComponents && !_el('m-obs-edit-picker')) W.MObserve.presentEditObsSheet(cid, sid, obId);
      open(cid, obId, sid, el.getAttribute('data-fu-id'), el);
    } else if (a === 'kind' && _ed) {
      var k = el.getAttribute('data-fu-kind');
      _ed.kind = _ed.kind === k ? null : k;
      _qa('.obs-fu-chip').forEach(function (c) {
        var on = c.getAttribute('data-fu-kind') === _ed.kind;
        c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', String(on));
      });
      _syncSave();
      var ta = _el('obs-fu-text');
      if (ta) ta.focus();
    } else if (a === 'save') save();
    else if (a === 'cancel') close();
    else if (a === 'delete') _deleteFollowUp();
  }

  function _onKey(e) {
    if (!_ed || _ed.phone) return;
    var bd = _el('obs-fu-backdrop');
    if (!bd) return;
    // The window under it (the edit window) hears none of these keys.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.id === 'obs-fu-text') {
      e.preventDefault();
      save();
    } else if (e.key === 'Tab') {
      var items = Array.prototype.slice.call(bd.querySelectorAll('button:not([disabled]), textarea'));
      var i = items.indexOf(document.activeElement);
      var next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      e.preventDefault();
      if (items[next]) items[next].focus();
    }
  }

  function _onInput(e) {
    if (_ed && e.target && e.target.id === 'obs-fu-text') _syncSave();
  }

  function _onBackdrop(e) {
    if (_ed && !_ed.phone && e.target && e.target.id === 'obs-fu-backdrop') {
      e.stopPropagation();
      close();
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', _onBackdrop, true);
    document.addEventListener('click', _onClick, true);
    document.addEventListener('keydown', _onKey, true);
    document.addEventListener('input', _onInput, true);
  }

  return {
    cardHtml: cardHtml,
    panelHtml: panelHtml,
    timelineHtml: timelineHtml,
    refresh: refresh,
    reveal: reveal,
    open: open,
    close: close,
    confirmDelete: confirmDelete,
    kindLabel: kindLabel,
    shortDate: shortDate,
    summaryText: summaryText,
    isOpen: function (obId) {
      return !!_open[obId];
    },
  };
})();
