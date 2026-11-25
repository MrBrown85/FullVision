// @ts-check
/* dash-inbox-targets.js — the redrawn Inbox when nothing is waiting, and a
   scan held over it (slice I4 of docs/plans/inbox-redesign-plan.md; boards R5
   and R6). Behind the build switch inboxStacks: DashInbox calls this only
   with the switch on and the To Grade view showing.

   Targets: one dashed box a piece Add Work for the Class offers (the list
   and order of DashInboxDrop.choices, which is D5's "Add Work For"), then
   Another Assessment. They show while files are dragged over the tile, after
   Add Work is clicked on the one-line tile, and at rest when Bulletins is not
   drawn under the Inbox (the tile then keeps the column). A drop on a target
   calls AddWorkClass.open inside the drop handler with the drop's own
   DataTransfer, as D5's drop does, so folders are walked the same way. A
   click opens Add Work for the Class with no files.

   The one-line tile opens to its usual share of the column while the targets
   show and closes after, gliding in 200 ms (none under reduced motion).
   This file matches, names and saves nothing: Add Work for the Class does.

   DashInbox calls html (the rest state's body), mount after each draw,
   unmount before the next, leave when the Dashboard is left, and click for
   the buttons here (data-dash-inbox="targets-open", "targets-close",
   "target", "target-other"). */
/** @type {any} */ (window).DashInboxTargets = (function () {
  'use strict';

  var MAX_PIECES = 7;
  // A piece that stopped taking work between the targets being drawn and the press or the drop.
  var STOPPED_DROP = 'That assessment stopped taking work, so the files were not added.';
  var STOPPED_PICK = 'That assessment stopped taking work. Choose another.';
  var PLUS =
    '<svg width="22" height="22" viewBox="0 0 30 30" aria-hidden="true" focusable="false"><path d="M15 6v18M6 15h18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var CLOSE =
    '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /** Why the targets show: files held over the tile (they go when the drag
   * does) or the Add Work button (they stay until closed).
   * @type {null | 'drag' | 'add'} */
  var _open = null;
  /** @type {HTMLElement | null} */
  var _tile = null;
  /** @type {HTMLElement | null} */
  var _panel = null;
  /** @type {string | null} */
  var _cid = null;
  // The tile is the one-line one: it grows while the targets show.
  var _quiet = false;
  // The targets are the tile's body at rest: they never close.
  var _rest = false;
  var _depth = 0;
  // A sentence owed to the panel after a drop found the list changed.
  var _note = '';

  function _drop() {
    return /** @type {any} */ (window).DashInboxDrop;
  }

  /** @param {string} cid */
  function _redraw(cid) {
    var PD = /** @type {any} */ (window).PageDashboard;
    if (document.querySelector('#main .dash-glance') && PD && PD.render && _cid === cid) PD.render();
  }

  /** The pieces Add Work for the Class offers, as the tile's own box lists them.
   * @param {string} cid
   * @returns {any[]} */
  function pieces(cid) {
    var D = _drop();
    return D ? D.choices(cid, MAX_PIECES) : [];
  }

  /** The targets: a list of buttons, a piece each and Another Assessment.
   * @param {string} cid @param {{ close?: boolean }} [opts]
   * @returns {string} */
  // html-safe: every title goes through esc; the rest is fixed markup and numbers
  function panelHtml(cid, opts) {
    var D = _drop();
    var list = pieces(cid);
    var notin = D ? D.notInBy(cid) : {};
    var items = list
      .map(function (c) {
        var n = notin[c.aid] || 0;
        return (
          '<li><button type="button" class="dash-inbox-target" data-dash-inbox="target" data-aid="' +
          esc(c.aid) +
          '" aria-label="' +
          esc('Add Work For ' + c.label + (n ? ', ' + n + ' Not In' : '')) +
          '"><span class="dash-inbox-target-title">' +
          esc(c.label) +
          '</span>' +
          (n ? '<span class="dash-inbox-target-count">' + n + ' Not In</span>' : '') +
          '</button></li>'
        );
      })
      .join('');
    items +=
      '<li><button type="button" class="dash-inbox-target is-other" data-dash-inbox="target-other">' +
      PLUS +
      '<span class="dash-inbox-target-title">Another Assessment</span></button></li>';
    return (
      '<div class="dash-inbox-targets-head"><span class="dash-inbox-targets-label">Add Work For</span>' +
      (_note ? '<span class="dash-inbox-targets-note" role="status">' + esc(_note) + '</span>' : '') +
      (opts && opts.close
        ? '<button type="button" class="btn btn-ghost dash-inbox-targets-close" data-dash-inbox="targets-close" aria-label="Close">' +
          CLOSE +
          '</button>'
        : '') +
      '</div><ul class="dash-inbox-targets-list" aria-label="Add Work For">' +
      items +
      '</ul>'
    );
  }

  /** The body of a tile with nothing waiting and no Bulletins under it.
   * @param {string} cid
   * @returns {string} */
  function html(cid) {
    return '<div class="dash-inbox-targets is-rest">' + panelHtml(cid) + '</div>';
  }

  /* ── Showing and hiding ────────────────────────────────── */
  /** The tile's column glides to its new split when `change` is done.
   * @param {() => void} change */
  function _glide(change) {
    var DI = /** @type {any} */ (window).DashInbox;
    if (DI && DI.glideColumn) DI.glideColumn(change);
    else change();
  }

  /** @param {boolean} grown */
  function _size(grown) {
    var col = document.querySelector('.dash-row-left');
    if (col) col.classList.toggle('has-quiet-inbox', !grown);
    if (_tile) _tile.classList.toggle('is-targets', grown);
  }

  /** @param {'drag' | 'add'} why @param {boolean} [now] no glide (a draw that kept it open) */
  function _show(why, now) {
    if (!_tile || !_cid) return;
    if (_open) {
      // Held files over targets the button opened: they stay open.
      return;
    }
    _open = why;
    // Another Assessment cannot take files, so it is not offered to a drag.
    if (_panel) _panel.classList.toggle('is-drag', why === 'drag');
    if (_rest) return;
    if (_panel) {
      // html-safe: panelHtml escapes every title and note
      _panel.innerHTML = panelHtml(_cid, { close: why === 'add' });
      _panel.hidden = false;
    }
    if (_quiet) {
      if (now) _size(true);
      else
        _glide(function () {
          _size(true);
        });
    } else if (_tile) _tile.classList.add('is-targets');
    if (why === 'add' && !now && _panel) {
      var first = /** @type {HTMLElement | null} */ (_panel.querySelector('.dash-inbox-target'));
      if (first) first.focus();
    }
  }

  /** @param {boolean} [toButton] focus goes back to Add Work */
  function _hide(toButton) {
    _depth = 0;
    _note = '';
    var was = _open;
    _open = null;
    if (_panel) _panel.classList.remove('is-drag');
    if (!was || _rest) return;
    var tile = _tile;
    if (_panel) _panel.hidden = true;
    if (_quiet) {
      _glide(function () {
        _size(false);
      });
    } else if (tile) tile.classList.remove('is-targets');
    if (toButton && tile) {
      var b = /** @type {HTMLElement | null} */ (tile.querySelector('[data-dash-inbox="targets-open"]'));
      if (b) b.focus();
    }
  }

  /** The target under a drag event, or null.
   * @param {any} e
   * @returns {HTMLElement | null} */
  function _under(e) {
    var t = e && e.target;
    return t && t.closest ? /** @type {HTMLElement | null} */ (t.closest('.dash-inbox-target')) : null;
  }

  /** @param {HTMLElement | null} on */
  function _lit(on) {
    if (!_tile) return;
    _tile.querySelectorAll('.dash-inbox-target.is-over').forEach(function (el) {
      if (el !== on) el.classList.remove('is-over');
    });
    if (on) on.classList.add('is-over');
  }

  /* ── The drag ──────────────────────────────────────────── */
  /** @param {DragEvent} e */
  function _enter(e) {
    var D = _drop();
    if (!D || !D.fromOutside(e)) return;
    e.preventDefault();
    _depth++;
    _show('drag');
  }

  /** @param {DragEvent} e */
  function _over(e) {
    var D = _drop();
    if (!D || !D.fromOutside(e)) return;
    e.preventDefault();
    if (_depth < 1) _depth = 1;
    if (!_open) _show('drag');
    var on = _under(e);
    _lit(on);
    if (e.dataTransfer) e.dataTransfer.dropEffect = on ? 'copy' : 'none';
  }

  /** @param {DragEvent} e */
  function _leave(e) {
    var D = _drop();
    if (!D || !D.fromOutside(e)) return;
    _depth--;
    if (_depth > 0) return;
    _depth = 0;
    _lit(null);
    if (_open === 'drag') _hide();
  }

  /* On the drop: AddWorkClass.open now, inside this handler, with the drop's
     own DataTransfer (a dropped folder is readable only now). */
  /** @param {DragEvent} e */
  function _dropped(e) {
    var D = _drop();
    if (!D || !D.fromOutside(e)) return;
    e.preventDefault();
    var cid = _cid;
    var on = _under(e);
    _lit(null);
    _depth = 0;
    if (!cid || !on) {
      if (_open === 'drag') _hide();
      return;
    }
    if (on.getAttribute('data-dash-inbox') === 'target-other') {
      _hide();
      _another(cid);
      return;
    }
    var aid = on.getAttribute('data-aid') || '';
    var AW = /** @type {any} */ (window).AddWorkClass;
    if (!AW) return;
    // Asked of the same list the targets were drawn from (seven, not the box's three).
    if (!D.stillOffered(cid, aid, MAX_PIECES)) {
      // The piece stopped taking work: nothing is opened in its place.
      _note = STOPPED_DROP;
      if (_rest) {
        _redraw(cid);
        return;
      }
      _open = null;
      _show('add', true);
      return;
    }
    var again = cid;
    var opened = AW.open(cid, aid, {
      drop: e.dataTransfer,
      onClose: function () {
        _redraw(again);
      },
    });
    if (opened && !_rest) _hide();
  }

  /** The drag ended, was given up, or the page did something else (D5's page listeners tell us). */
  function _ended() {
    if (_open === 'drag') _hide();
  }

  /* ── Another Assessment ────────────────────────────────── */
  /* Add Work for the Class opens on one piece (AddWorkClass.open takes an
     assessment), so a piece that is not in the list is chosen on the
     Assignments page, whose cards carry Add Work for the Class. */
  /** @param {string} cid */
  function _another(cid) {
    var R = /** @type {any} */ (window).Router;
    var path = '/assignments?course=' + encodeURIComponent(cid);
    if (R && R.isRoute && R.isRoute('/assignments')) R.navigate(path);
    else location.assign(path);
  }

  /* ── Clicks ────────────────────────────────────────────── */
  /** A click on one of this file's buttons. ctx: { cid, redraw }. True when it was ours.
   * @param {HTMLElement} el @param {{ cid: string, redraw: () => void }} ctx */
  function click(el, ctx) {
    var kind = el.getAttribute('data-dash-inbox') || '';
    if (kind === 'targets-open') {
      if (_open) {
        var first = /** @type {HTMLElement | null} */ (_tile && _tile.querySelector('.dash-inbox-target'));
        if (first) first.focus();
      } else _show('add');
      return true;
    }
    if (kind === 'targets-close') {
      _hide(true);
      return true;
    }
    if (kind === 'target-other') {
      _hide();
      _another(ctx.cid);
      return true;
    }
    if (kind === 'target') {
      var D = _drop();
      var AW = /** @type {any} */ (window).AddWorkClass;
      var aid = el.getAttribute('data-aid') || '';
      if (!D || !AW) return true;
      if (!D.stillOffered(ctx.cid, aid, MAX_PIECES)) {
        _note = STOPPED_PICK;
        // html-safe: panelHtml escapes every title and note
        if (_panel && !_rest) _panel.innerHTML = panelHtml(ctx.cid, { close: true });
        else ctx.redraw();
        return true;
      }
      if (!_rest) _hide();
      AW.open(ctx.cid, aid, { onClose: ctx.redraw });
      return true;
    }
    return false;
  }

  /** @param {KeyboardEvent} e */
  function _key(e) {
    if (e.key === 'Escape' && _open === 'add' && !_rest) {
      e.preventDefault();
      _hide(true);
    }
  }

  /* ── Mount ─────────────────────────────────────────────── */
  /** Once the page is drawn. state: { quiet: the tile is the one-line one,
   * rest: the targets are its body at rest }.
   * @param {HTMLElement} tile @param {string} cid @param {{ quiet?: boolean, rest?: boolean }} state */
  function mount(tile, cid, state) {
    unmount();
    if (!tile) return;
    _tile = tile;
    _cid = cid;
    _quiet = !!(state && state.quiet);
    _rest = !!(state && state.rest);
    var body = tile.querySelector('.dash-inbox-body');
    if (body && !_rest) {
      var panel = document.createElement('div');
      panel.className = 'dash-inbox-targets';
      panel.hidden = true;
      body.appendChild(panel);
      _panel = panel;
    }
    var D = _drop();
    if (D && D.onEnd) D.onEnd(_ended);
    tile.addEventListener('dragenter', _enter);
    tile.addEventListener('dragover', _over);
    tile.addEventListener('dragleave', _leave);
    tile.addEventListener('drop', _dropped);
    tile.addEventListener('keydown', _key);
    // A draw while the targets were open from the button keeps them open.
    var keep = _open;
    _open = null;
    if (keep === 'add' && !_rest) _show('add', true);
  }

  function unmount() {
    if (_tile) {
      _tile.removeEventListener('dragenter', _enter);
      _tile.removeEventListener('dragover', _over);
      _tile.removeEventListener('dragleave', _leave);
      _tile.removeEventListener('drop', _dropped);
      _tile.removeEventListener('keydown', _key);
    }
    var D = _drop();
    if (D && D.onEnd) D.onEnd(null);
    if (_panel && _panel.parentNode) _panel.parentNode.removeChild(_panel);
    _panel = null;
    _tile = null;
    _depth = 0;
  }

  /** The Dashboard is left or the class changes: nothing is kept open. */
  function leave() {
    unmount();
    _open = null;
    _cid = null;
    _note = '';
  }

  return {
    html: html,
    panelHtml: panelHtml,
    pieces: pieces,
    click: click,
    mount: mount,
    unmount: unmount,
    leave: leave,
    state: function () {
      return _open;
    },
  };
})();
