// @ts-check
/* dash-inbox-drop.js — the Inbox's All Caught Up space and a file drop on the
   tile (D5 of docs/plans/dashboard-inbox-plan.md; boards E1 and E1b), behind
   the dashRow build switch with the rest of the Inbox.

   All Caught Up: "Add Work For" with up to three pieces taking work, the
   drop area in Add Work for the Class's own words and look, and two quiet
   lines (work assessed but not returned; the next piece taking work).

   A drop anywhere on the tile, in any view: while files are held over it one
   cover hides the tile's body and names where they go. On the drop,
   AddWorkClass.open is called inside the drop handler itself, with the
   drop's own DataTransfer, so the files go into the same tray, by the same
   call, as a drop on the Add Work page. This file matches, names and places
   nothing, and saves nothing: Add Work on that page does.

   DashInbox calls emptyHtml (its hook), mount after each draw and unmount
   before the next draw and when the Dashboard is left. */
window.DashInboxDrop = (function () {
  'use strict';

  var MAX_CHOICES = 3;
  var HINT = 'Photos or PDFs. Files are matched to students by name.';
  var UP_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5"></path><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"></path></svg>';

  // The piece chosen in "Add Work For", per class, for this visit.
  /** @type {Record<string, string>} */
  var _chosen = {};
  /** @type {any} */
  var _m = null;
  /** @type {HTMLElement | null} */
  var _tile = null;
  /** @type {HTMLElement | null} */
  var _cover = null;
  /** @type {string | null} */
  var _cid = null;
  // dragenter less dragleave on the tile: crossing a child is +1 then -1.
  var _depth = 0;

  /* ── Which pieces ──────────────────────────────────────── */
  /** @param {string} cid @param {any} a */
  function _window(cid, a) {
    var win = /** @type {any} */ (window)._studentWorkWindow;
    if (typeof win !== 'function' || typeof getAssessmentStudentWork !== 'function') return null;
    return win(cid, a, getAssessmentStudentWork(cid, a.id));
  }

  /** The pieces Add Work can take files for that take work now, most recently
   * assigned first, three at most.
   * @param {string} cid
   * @returns {any[]} */
  function choices(cid) {
    var GW = /** @type {any} */ (window).GraderWork;
    var AW = /** @type {any} */ (window).AddWorkClass;
    if (!cid || !GW || !AW) return [];
    var list = (getAssessments(cid) || [])
      .map(function (/** @type {any} */ a, /** @type {number} */ i) {
        return { a: a, i: i };
      })
      .filter(function (/** @type {any} */ x) {
        var a = x.a;
        if (!a || !a.id || !AW.offered(cid, a) || !GW.workOn(cid, a)) return false;
        var w = _window(cid, a);
        return !!w && w.open && w.listed;
      });
    list.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      var p = String(x.a.dateAssigned || x.a.date || '');
      var q = String(y.a.dateAssigned || y.a.date || '');
      if (p !== q) return p < q ? 1 : -1;
      return y.i - x.i;
    });
    return list.slice(0, MAX_CHOICES).map(function (/** @type {any} */ x) {
      var w = _window(cid, x.a) || {};
      return {
        aid: x.a.id,
        title: String(x.a.title || 'Untitled'),
        due: x.a.dueDate || x.a.due_date ? String(x.a.dueDate || x.a.due_date).slice(0, 10) : '',
        closes: w.closes_on || '',
      };
    });
  }

  /** The next one due: the soonest due date from today on, else the newest.
   * @param {string} cid @param {any[]} list */
  function nextDue(cid, list) {
    var today = typeof courseToday === 'function' ? courseToday(cid) : '';
    var due = list
      .filter(function (c) {
        return c.due && c.due >= today;
      })
      .sort(function (x, y) {
        return x.due < y.due ? -1 : x.due > y.due ? 1 : 0;
      });
    return due[0] || list[0] || null;
  }

  /** The piece chosen in "Add Work For": the teacher's pick this visit, else the next one due.
   * @param {string} cid @param {any[]} [list] */
  function chosen(cid, list) {
    list = list || choices(cid);
    var picked = list.filter(function (c) {
      return c.aid === _chosen[cid];
    })[0];
    return picked || nextDue(cid, list);
  }

  /** Where a drop on the tile goes: in All Caught Up the piece chosen there,
   * otherwise the newest piece taking work. Null when there is none.
   * @param {string} cid @param {any} model */
  function target(cid, model) {
    var list = choices(cid);
    if (model && model.caughtUp) return chosen(cid, list);
    return list[0] || null;
  }

  /* ── The two quiet lines ───────────────────────────────── */
  /** Work assessed and not returned: the piece with the newest work. Counts are GraderWork's (model.pieces).
   * @param {any} model */
  function notReturned(model) {
    var list = ((model && model.pieces) || []).filter(function (/** @type {any} */ p) {
      return p.toreturn > 0;
    });
    list.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      return x.at < y.at ? 1 : x.at > y.at ? -1 : 0;
    });
    if (!list.length) return null;
    return { aid: list[0].aid, title: list[0].title, n: list[0].toreturn, more: list.length - 1 };
  }

  /** "open until Fri", or ''.
   * @param {string} day */
  function untilText(day) {
    var d = new Date(day + 'T12:00:00');
    if (!day || isNaN(d.getTime())) return '';
    return 'open until ' + d.toLocaleDateString('en-CA', { weekday: 'short' });
  }

  /** The next piece taking work and how many are not in (GraderWork's, through the model).
   * @param {string} cid @param {any} model */
  function nextTaking(cid, model) {
    var c = nextDue(cid, choices(cid));
    if (!c) return null;
    var p = ((model && model.pieces) || []).filter(function (/** @type {any} */ x) {
      return x.aid === c.aid;
    })[0];
    return { aid: c.aid, title: c.title, until: untilText(c.closes), notin: p ? p.notin : null };
  }

  /* ── All Caught Up ─────────────────────────────────────── */
  /** @param {string} what @param {string} label */
  function _pick(what, label) {
    return (
      '<button type="button" class="awt-pick-btn dash-inbox-drop-pick" data-dash-inbox-pick="' +
      what +
      '">' +
      esc(label) +
      '</button>'
    );
  }

  /** @param {string} cid @param {any[]} list @param {any} c */
  function _forHtml(cid, list, c) {
    if (list.length === 1) {
      return (
        '<span class="dash-inbox-drop-for"><span class="dash-inbox-drop-for-label">Add Work For</span> <span class="dash-inbox-drop-for-one">' +
        esc(list[0].title) +
        '</span></span>'
      );
    }
    return (
      '<label class="dash-inbox-drop-for"><span class="dash-inbox-drop-for-label">Add Work For</span> <select class="dash-inbox-drop-select" data-dash-inbox-for>' +
      list
        .map(function (x) {
          return (
            '<option value="' +
            esc(x.aid) +
            '"' +
            (c && x.aid === c.aid ? ' selected' : '') +
            '>' +
            esc(x.title) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>'
    );
  }

  /** The caught-up space (DashInbox's hook): one list item.
   * @param {string} cid @param {any} model
   * @returns {string} */
  // html-safe: every title goes through esc; the rest is fixed markup and numbers
  function emptyHtml(cid, model) {
    var list = choices(cid);
    var c = chosen(cid, list);
    var split = /** @type {any} */ (window).AddWorkSplit;
    var out =
      '<li class="dash-inbox-drop-home" id="dash-inbox-caught"><div class="dash-inbox-drop-top"><span class="dash-inbox-drop-caught">All Caught Up</span>' +
      (list.length ? _forHtml(cid, list, c) : '') +
      '</div>';
    if (list.length) {
      out +=
        '<div class="awt-drop dash-inbox-drop-area" data-dash-inbox-area>' +
        UP_ICON +
        '<span class="awt-drop-title">Drop the Scan, a Folder or Files</span>' +
        '<span class="awt-drop-hint">' +
        esc(HINT) +
        '</span><div class="awt-pick">' +
        _pick('files', 'Choose Files…') +
        _pick('folder', 'Choose a Folder…') +
        (split && typeof split.open === 'function' ? _pick('scan', 'Split a Scan…') : '') +
        '</div></div>';
    } else {
      out += '<p class="dash-inbox-drop-line">No assessment is taking work.</p>';
    }
    var back = notReturned(model);
    if (back) {
      out +=
        '<p class="dash-inbox-drop-line">' +
        esc(back.title) +
        ': ' +
        back.n +
        ' assessed, not returned' +
        (back.more ? ' (and ' + back.more + (back.more === 1 ? ' more assessment' : ' more assessments') + ')' : '') +
        ' <a role="link" tabindex="0" data-href="' +
        esc('/assignments?course=' + encodeURIComponent(cid) + '&open=' + encodeURIComponent(back.aid)) +
        '">Return Them →</a></p>';
    }
    var next = nextTaking(cid, model);
    if (next) {
      out +=
        '<p class="dash-inbox-drop-line">Next taking work: ' +
        esc(next.title) +
        (next.until ? ', ' + esc(next.until) : '') +
        (next.notin ? ' · ' + next.notin + ' not in yet' : '') +
        ' <button type="button" class="dash-inbox-drop-wall" data-dash-inbox-wall="' +
        esc(next.aid) +
        '">Work Wall →</button></p>';
    }
    return out + '</li>';
  }

  /* ── Opening Add Work ──────────────────────────────────── */
  function _redraw() {
    var PD = /** @type {any} */ (window).PageDashboard;
    if (document.querySelector('#main .dash-glance') && PD && PD.render) PD.render();
  }

  /** Add Work for the piece chosen, then the page's own chooser, in the
   * click's own turn (a browser opens a file chooser only then).
   * @param {string} cid @param {string} what */
  function choose(cid, what) {
    var c = chosen(cid);
    var AW = /** @type {any} */ (window).AddWorkClass;
    if (!c || !AW || !AW.open(cid, c.aid, { onClose: _redraw })) return false;
    var btn = /** @type {HTMLElement | null} */ (
      document.querySelector('#add-work-class-overlay [data-awt="' + what + '"]')
    );
    if (btn) btn.click();
    return true;
  }

  /* ── A drop on the tile ────────────────────────────────── */
  /** A drag that carries files from the computer.
   * @param {any} e */
  function hasFiles(e) {
    var types = e && e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  }

  /** What the cover says: [title, hint].
   * @param {any} t */
  function coverText(t) {
    if (!t) return ['No assessment is taking work, so these files have nowhere to go.', ''];
    return ['Drop to Add to ' + t.title, HINT];
  }

  function _showCover() {
    if (!_cover || !_cid) return;
    var t = target(_cid, _m);
    var words = coverText(t);
    var title = _cover.querySelector('.dash-inbox-drop-cover-title');
    var hint = _cover.querySelector('.dash-inbox-drop-cover-hint');
    if (title) title.textContent = words[0];
    if (hint) hint.textContent = words[1];
    _cover.classList.toggle('is-none', !t);
    _cover.hidden = false;
    var area = _tile && _tile.querySelector('[data-dash-inbox-area]');
    if (area) area.classList.add('is-over');
  }

  function _hideCover() {
    _depth = 0;
    if (_cover) _cover.hidden = true;
    var area = _tile && _tile.querySelector('[data-dash-inbox-area]');
    if (area) area.classList.remove('is-over');
  }

  /** @param {DragEvent} e */
  function _enter(e) {
    if (!hasFiles(e)) return;
    _depth++;
    _showCover();
  }

  /** @param {DragEvent} e */
  function _over(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    var none = !target(/** @type {string} */ (_cid), _m);
    if (e.dataTransfer) e.dataTransfer.dropEffect = none ? 'none' : 'copy';
    // A draw mid-drag gives a new tile that heard no dragenter.
    if (_depth < 1) _depth = 1;
    if (_cover && _cover.hidden) _showCover();
  }

  /** @param {DragEvent} e */
  function _leave(e) {
    if (!hasFiles(e)) return;
    _depth--;
    if (_depth <= 0) _hideCover();
  }

  /* On the drop: AddWorkClass.open now, inside this handler, with the drop's
     own DataTransfer (a dropped folder is readable only now). */
  /** @param {DragEvent} e */
  function _drop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    _hideCover();
    var cid = _cid;
    var t = cid ? target(cid, _m) : null;
    var AW = /** @type {any} */ (window).AddWorkClass;
    if (!cid || !t || !AW) return;
    AW.open(cid, t.aid, { drop: e.dataTransfer, onClose: _redraw });
  }

  // The drag ended elsewhere, or was given up.
  function _ended() {
    if (_cover && !_cover.hidden) _hideCover();
  }

  /** @param {KeyboardEvent} e */
  function _key(e) {
    if (e.key === 'Escape') _ended();
  }

  /** @param {MouseEvent} e */
  function _click(e) {
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest || !_cid) return;
    var pick = t.closest('[data-dash-inbox-pick]');
    if (pick) {
      e.preventDefault();
      choose(_cid, pick.getAttribute('data-dash-inbox-pick'));
      return;
    }
    var wall = t.closest('[data-dash-inbox-wall]');
    if (wall) {
      e.preventDefault();
      var WW = /** @type {any} */ (window).WorkWall;
      if (WW) WW.open(_cid, wall.getAttribute('data-dash-inbox-wall'), { onClose: _redraw });
      return;
    }
    // A click on the drop area itself, off its buttons: Choose Files….
    if (t.closest('[data-dash-inbox-area]') && !t.closest('button, select, a')) choose(_cid, 'files');
  }

  /** @param {Event} e */
  function _change(e) {
    var t = /** @type {any} */ (e.target);
    if (!t || !t.hasAttribute || !t.hasAttribute('data-dash-inbox-for') || !_cid) return;
    _chosen[_cid] = t.value;
  }

  /** Once the page is drawn: the cover and the listeners on this tile.
   * @param {HTMLElement} tile @param {string} cid @param {any} model */
  function mount(tile, cid, model) {
    unmount();
    if (!tile) return;
    _tile = tile;
    _cid = cid;
    _m = model;
    var body = tile.querySelector('.dash-inbox-body');
    if (body) {
      var cover = document.createElement('div');
      cover.className = 'dash-inbox-drop-cover';
      cover.hidden = true;
      cover.setAttribute('aria-hidden', 'true');
      var inner = document.createElement('div');
      inner.className = 'dash-inbox-drop-cover-in';
      var title = document.createElement('span');
      title.className = 'awt-drop-title dash-inbox-drop-cover-title';
      var hint = document.createElement('span');
      hint.className = 'awt-drop-hint dash-inbox-drop-cover-hint';
      inner.appendChild(title);
      inner.appendChild(hint);
      cover.appendChild(inner);
      body.appendChild(cover);
      _cover = cover;
    }
    tile.addEventListener('dragenter', _enter);
    tile.addEventListener('dragover', _over);
    tile.addEventListener('dragleave', _leave);
    tile.addEventListener('drop', _drop);
    tile.addEventListener('click', _click);
    tile.addEventListener('change', _change);
    document.addEventListener('dragend', _ended, true);
    document.addEventListener('drop', _ended, true);
    document.addEventListener('keydown', _key, true);
  }

  /* Before the next draw, and when the Dashboard is left. */
  function unmount() {
    if (_tile) {
      _tile.removeEventListener('dragenter', _enter);
      _tile.removeEventListener('dragover', _over);
      _tile.removeEventListener('dragleave', _leave);
      _tile.removeEventListener('drop', _drop);
      _tile.removeEventListener('click', _click);
      _tile.removeEventListener('change', _change);
    }
    document.removeEventListener('dragend', _ended, true);
    document.removeEventListener('drop', _ended, true);
    document.removeEventListener('keydown', _key, true);
    if (_cover && _cover.parentNode) _cover.parentNode.removeChild(_cover);
    _cover = null;
    _tile = null;
    _depth = 0;
  }

  /** Leaving the Dashboard: the listeners and this visit's choice go.
   * @param {string} [cid] */
  function leave(cid) {
    unmount();
    _m = null;
    _cid = null;
    if (cid) delete _chosen[cid];
  }

  return {
    emptyHtml: emptyHtml,
    choices: choices,
    chosen: chosen,
    target: target,
    notReturned: notReturned,
    nextTaking: nextTaking,
    coverText: coverText,
    hasFiles: hasFiles,
    choose: choose,
    mount: mount,
    unmount: unmount,
    leave: leave,
  };
})();
