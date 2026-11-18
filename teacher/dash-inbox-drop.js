// @ts-check
/* dash-inbox-drop.js — the Inbox's space when nothing is to grade, and a file
   drop on the tile (D5 of docs/plans/dashboard-inbox-plan.md; boards E1 and
   E1b).

   Nothing to grade: "Add Work For" with up to three pieces taking work, the
   drop area in Add Work for the Class's own words and look, and under it two
   quiet lines (work assessed but not returned; the next piece taking work).
   "All Caught Up" is said only when nothing is to return either, as the top
   bar's To Grade cell says it.

   A drop anywhere on the tile, in any view: while files are held over it one
   cover hides the tile's body and names where they go. On the drop,
   AddWorkClass.open is called inside the drop handler itself, with the
   drop's own DataTransfer, so the files go into the same tray, by the same
   call, as a drop on the Add Work page. This file matches, names and places
   nothing, and saves nothing: Add Work on that page does.

   Every action goes to the piece the tile shows: the one in the "Add Work
   For" box, or the one the cover names. If that piece is no longer taking
   work when the teacher acts, nothing is opened in its place: the tile is
   drawn again and says the list changed.

   While the tile is on the page a file dropped elsewhere on the Dashboard
   is refused (the browser would open it in the tab). A drag that started on
   the page (a picture) is never taken as files from the computer.

   DashInbox calls emptyHtml (its hook), mount after each draw and unmount
   before the next draw and when the Dashboard is left. */
window.DashInboxDrop = (function () {
  'use strict';

  var MAX_CHOICES = 3;
  var HINT = 'Photos or PDFs. Files are matched to students by name.';
  var CHANGED = {
    drop: 'The list of assessments changed, so those files were not added. Drop them again.',
    pick: 'The list of assessments changed. Choose again.',
  };
  var UP_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5"></path><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"></path></svg>';

  // The piece chosen in "Add Work For", per class, for this visit.
  /** @type {Record<string, string>} */
  var _chosen = {};
  // A sentence owed to the tile after an action found the list changed.
  /** @type {Record<string, string>} */
  var _notice = {};
  /** @type {any} */
  var _m = null;
  /** @type {HTMLElement | null} */
  var _tile = null;
  /** @type {HTMLElement | null} */
  var _cover = null;
  /** @type {string | null} */
  var _cid = null;
  // Where a drop goes, as drawn when the tile has no "Add Work For" box.
  /** @type {{ aid: string, label: string } | null} */
  var _drawn = null;
  // dragenter less dragleave on the tile: crossing a child is +1 then -1.
  var _depth = 0;
  /* A drag that began on this page (a picture, a card): never files. The
     browser sends `drag` to its source all through such a drag, so one not
     heard from for INNER_MS is over even if its end was never heard. */
  var _inner = false;
  var _innerAt = 0;
  var INNER_MS = 500;
  // Watches #main so a page drawn without the tile (Class Settings) lets go of the listeners.
  /** @type {MutationObserver | null} */
  var _watch = null;

  /* ── Which pieces ──────────────────────────────────────── */
  /** @param {string} cid @param {any} a */
  function _window(cid, a) {
    var win = /** @type {any} */ (window)._studentWorkWindow;
    if (typeof win !== 'function' || typeof getAssessmentStudentWork !== 'function') return null;
    return win(cid, a, getAssessmentStudentWork(cid, a.id));
  }

  /** @param {any} t */
  function _norm(t) {
    return String(t || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /** A piece's name as the tile shows it: its title, and its date when
   * another piece of the class has the same title (as the gradebook's
   * column headers date a piece).
   * @param {string} cid @param {any} a */
  function label(cid, a) {
    var title = String((a && a.title) || 'Untitled');
    var same = (getAssessments(cid) || []).filter(function (/** @type {any} */ x) {
      return x && !x.isDraft && _norm(x.title || 'Untitled') === _norm(title);
    }).length;
    var day = a && (a.dateAssigned || a.date);
    if (same < 2 || !day || typeof formatShortDate !== 'function') return title;
    var d = formatShortDate(String(day).slice(0, 10));
    return d ? title + ' (' + d + ')' : title;
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
        label: label(cid, x.a),
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

  /** The piece to show chosen in "Add Work For" when the tile is drawn: the
   * teacher's pick this visit, else the next one due.
   * @param {string} cid @param {any[]} [list] */
  function chosen(cid, list) {
    list = list || choices(cid);
    var picked = list.filter(function (c) {
      return c.aid === _chosen[cid];
    })[0];
    return picked || nextDue(cid, list);
  }

  /** Where a drop on the tile goes when it is drawn: with nothing to grade
   * the piece chosen there, otherwise the newest piece taking work.
   * @param {string} cid @param {any} model */
  function target(cid, model) {
    var list = choices(cid);
    if (model && model.caughtUp) return chosen(cid, list);
    return list[0] || null;
  }

  /** Whether the piece is still one the tile may add to, now.
   * @param {string} cid @param {string} aid */
  function stillOffered(cid, aid) {
    return choices(cid).some(function (c) {
      return c.aid === aid;
    });
  }

  /* ── The two quiet lines ───────────────────────────────── */
  /** The class's work counted per piece: the draw's own count (shared with
   * the top bar) when there is one, else GraderWork's.
   * @param {string} cid */
  function _counts(cid) {
    var ids = (getStudents(cid) || []).map(function (/** @type {any} */ s) {
      return s.id;
    });
    var DO = /** @type {any} */ (window).DashOverview;
    if (DO && typeof DO.classWorkCounts === 'function') return DO.classWorkCounts(cid, ids);
    return /** @type {any} */ (window).GraderWork.classWorkCounts(cid, ids);
  }

  /** Work assessed and not returned: the piece with the most, by GraderWork's count.
   * @param {string} cid */
  function notReturned(cid) {
    var GW = /** @type {any} */ (window).GraderWork;
    if (!cid || !GW) return null;
    var list = (_counts(cid).pieces || []).filter(function (/** @type {any} */ p) {
      return p.toreturn > 0;
    });
    if (!list.length) return null;
    list.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      return y.toreturn - x.toreturn;
    });
    var a = (getAssessments(cid) || []).filter(function (/** @type {any} */ x) {
      return x && x.id === list[0].aid;
    })[0];
    return { aid: list[0].aid, title: label(cid, a), n: list[0].toreturn, more: list.length - 1 };
  }

  /** "open until Fri", or ''.
   * @param {string} day */
  function untilText(day) {
    var d = new Date(day + 'T12:00:00');
    if (!day || isNaN(d.getTime())) return '';
    return 'open until ' + d.toLocaleDateString('en-CA', { weekday: 'short' });
  }

  /** The next piece taking work and how many are not in (GraderWork's count).
   * @param {string} cid */
  function nextTaking(cid) {
    var c = nextDue(cid, choices(cid));
    if (!c) return null;
    var p = (_counts(cid).pieces || []).filter(function (/** @type {any} */ x) {
      return x.aid === c.aid;
    })[0];
    return { aid: c.aid, title: c.label, until: untilText(c.closes), notin: p ? p.notin : null };
  }

  /* ── Nothing to grade ──────────────────────────────────── */
  /** @param {string} what @param {string} text */
  function _pick(what, text) {
    return (
      '<button type="button" class="awt-pick-btn dash-inbox-drop-pick" data-dash-inbox-pick="' +
      what +
      '">' +
      esc(text) +
      '</button>'
    );
  }

  /** @param {any[]} list @param {any} c */
  function _forHtml(list, c) {
    if (list.length === 1) {
      return (
        '<span class="dash-inbox-drop-for"><span class="dash-inbox-drop-for-label">Add Work For</span> <span class="dash-inbox-drop-for-one" data-dash-inbox-for-aid="' +
        esc(list[0].aid) +
        '">' +
        esc(list[0].label) +
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
            esc(x.label) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>'
    );
  }

  /** The space when nothing is to grade (DashInbox's hook): one list item.
   * @param {string} cid @param {any} model
   * @returns {string} */
  // html-safe: every title goes through esc; the rest is fixed markup and numbers
  function emptyHtml(cid, model) {
    var list = choices(cid);
    var c = chosen(cid, list);
    var split = /** @type {any} */ (window).AddWorkSplit;
    var back = notReturned(cid);
    var out =
      '<li class="dash-inbox-drop-home" id="dash-inbox-caught"><div class="dash-inbox-drop-top">' +
      // As the top bar's To Grade cell: caught up only with nothing to return either.
      (back ? '' : '<span class="dash-inbox-drop-caught">All Caught Up</span>') +
      (list.length ? _forHtml(list, c) : '') +
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
    // Under the drop area, as on the board: what is not returned, then what is next.
    if (back) {
      out +=
        '<p class="dash-inbox-drop-line dash-inbox-drop-back">' +
        esc(back.title) +
        ': <b>' +
        back.n +
        '</b> Not Returned' +
        (back.more ? ' (and ' + back.more + (back.more === 1 ? ' more assessment' : ' more assessments') + ')' : '') +
        ' <a role="link" tabindex="0" data-href="' +
        esc('/assignments?course=' + encodeURIComponent(cid) + '&open=' + encodeURIComponent(back.aid)) +
        '">Return Them →</a></p>';
    }
    var next = nextTaking(cid);
    if (next) {
      out +=
        '<p class="dash-inbox-drop-line">Next taking work: ' +
        esc(next.title) +
        (next.until ? ', ' + esc(next.until) : '') +
        (next.notin ? ' · <b>' + next.notin + '</b> not in yet' : '') +
        ' <button type="button" class="dash-inbox-drop-wall" data-dash-inbox-wall="' +
        esc(next.aid) +
        '">Work Wall →</button></p>';
    }
    return out + '</li>';
  }

  /* ── The piece shown ───────────────────────────────────── */
  /** The piece the tile shows now: the "Add Work For" box as it reads, else
   * the piece named when the tile was drawn. → { aid, label } or null. */
  function shown() {
    var tile = _tile;
    if (tile) {
      var sel = /** @type {HTMLSelectElement | null} */ (tile.querySelector('[data-dash-inbox-for]'));
      if (sel) {
        var opt = sel.querySelector('option[value="' + sel.value + '"]') || sel.querySelector('option[selected]');
        return sel.value ? { aid: sel.value, label: opt ? String(opt.textContent || '') : '' } : null;
      }
      var one = tile.querySelector('[data-dash-inbox-for-aid]');
      if (one) return { aid: one.getAttribute('data-dash-inbox-for-aid') || '', label: String(one.textContent || '') };
    }
    return _drawn;
  }

  function _redraw() {
    var PD = /** @type {any} */ (window).PageDashboard;
    if (document.querySelector('#main .dash-glance') && PD && PD.render) PD.render();
  }

  /** The piece shown is gone: no other is used in its place. The tile is
   * drawn again and says why nothing happened.
   * @param {string} cid @param {'drop' | 'pick'} why */
  function _changed(cid, why) {
    _notice[cid] = CHANGED[why];
    _redraw();
    // With no page to draw (a test, or the page gone), the tile says it now.
    if (_tile && _tile.isConnected && !_tile.querySelector('.dash-inbox-drop-notice')) _showNotice();
  }

  function _showNotice() {
    if (!_tile || !_cid || !_notice[_cid]) return;
    var body = _tile.querySelector('.dash-inbox-body');
    if (!body) return;
    var old = body.querySelector('.dash-inbox-drop-notice');
    if (old) old.remove();
    var p = document.createElement('p');
    p.className = 'dash-inbox-drop-notice';
    p.setAttribute('role', 'status');
    p.textContent = _notice[_cid];
    body.insertBefore(p, body.firstChild);
  }

  function _clearNotice() {
    if (_cid) delete _notice[_cid];
    var old = _tile && _tile.querySelector('.dash-inbox-drop-notice');
    if (old) old.remove();
  }

  /** Add Work for the piece shown, then the page's own chooser, in the
   * click's own turn (a browser opens a file chooser only then).
   * @param {string} cid @param {string} what */
  function choose(cid, what) {
    _clearNotice();
    var t = shown();
    var AW = /** @type {any} */ (window).AddWorkClass;
    if (!t || !AW) return false;
    if (!stillOffered(cid, t.aid)) {
      _changed(cid, 'pick');
      return false;
    }
    if (!AW.open(cid, t.aid, { onClose: _redraw })) return false;
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

  /** Files from the computer, not a picture dragged from this page.
   * @param {any} e */
  function _fromOutside(e) {
    if (_inner && Date.now() - _innerAt > INNER_MS) _inner = false;
    return !_inner && hasFiles(e);
  }

  /** What the cover says: [title, hint].
   * @param {any} t */
  function coverText(t) {
    if (!t) return ['No assessment is taking work, so these files have nowhere to go.', ''];
    return ['Drop to Add to ' + (t.label || t.title), HINT];
  }

  function _showCover() {
    if (!_cover || !_cid) return;
    var t = shown();
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
  function _accept(e) {
    // Accepted from the first moment, so a release at once still drops.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = shown() ? 'copy' : 'none';
  }

  /** @param {DragEvent} e */
  function _enter(e) {
    if (!_fromOutside(e)) return;
    _accept(e);
    if (_depth === 0) _clearNotice();
    _depth++;
    _showCover();
  }

  /** @param {DragEvent} e */
  function _over(e) {
    if (!_fromOutside(e)) return;
    _accept(e);
    // A draw mid-drag gives a new tile that heard no dragenter.
    if (_depth < 1) _depth = 1;
    if (_cover && _cover.hidden) _showCover();
  }

  /** @param {DragEvent} e */
  function _leave(e) {
    if (!_fromOutside(e)) return;
    _depth--;
    if (_depth <= 0) _hideCover();
  }

  /* On the drop: AddWorkClass.open now, inside this handler, with the drop's
     own DataTransfer (a dropped folder is readable only now). */
  /** @param {DragEvent} e */
  function _drop(e) {
    if (!_fromOutside(e)) return;
    e.preventDefault();
    _hideCover();
    var cid = _cid;
    var t = shown();
    var AW = /** @type {any} */ (window).AddWorkClass;
    if (!cid || !t || !AW) return;
    if (!stillOffered(cid, t.aid)) return _changed(cid, 'drop');
    AW.open(cid, t.aid, { drop: e.dataTransfer, onClose: _redraw });
  }

  /* Elsewhere on the Dashboard's own page: a file let go near the tile is
     refused rather than opened by the browser in place of the app. Only the
     page's surface (#main) and the class list beside it (#sidebar-mount,
     about 13 px left of the tile, so a near miss lands there), behind
     everything else: a file box, its label, a dialog or an overlay (the
     grader, Add Work, the Work Wall, Restore from Backup) is never touched,
     and neither is a place that took the drag itself first
     (preventDefault). The dock across the top is left as it is. Only while
     the tile is on screen. */
  var LEAVE_ALONE =
    'input[type="file"], label, dialog, [role="dialog"], [aria-modal="true"], .confirm-overlay, [class*="-overlay"]';
  /** @param {DragEvent} e */
  function _refuses(e) {
    if (!_fromOutside(e) || e.defaultPrevented || !_live() || _inTile(e)) return false;
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest) return false;
    var main = document.getElementById('main');
    var list = document.getElementById('sidebar-mount');
    if (!(main && main.contains(t)) && !(list && list.contains(t))) return false;
    return !t.closest(LEAVE_ALONE);
  }
  /** @param {DragEvent} e */
  function _pageOver(e) {
    if (!_refuses(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  }
  /** @param {DragEvent} e */
  function _pageDrop(e) {
    if (_refuses(e)) e.preventDefault();
  }
  /* The tile is in the page and on screen. Gone from the page (another
     screen drew over #main): the listeners go now. */
  function _live() {
    if (!_tile) return false;
    if (!_tile.isConnected) {
      unmount();
      return false;
    }
    return typeof _tile.getClientRects !== 'function' || _tile.getClientRects().length > 0;
  }
  /** @param {Event} e */
  function _inTile(e) {
    return !!_tile && !!e.target && _tile.contains(/** @type {any} */ (e.target));
  }

  // The drag ended, or was given up, or something else happened: the cover goes.
  function _ended() {
    if (_cover && !_cover.hidden) _hideCover();
  }
  /** @param {DragEvent} e */
  function _pageLeave(e) {
    // Out of the window: the pointer is at or past its edge.
    var w = window.innerWidth || 0;
    var h = window.innerHeight || 0;
    if (e.clientX <= 0 || e.clientY <= 0 || (w && e.clientX >= w) || (h && e.clientY >= h)) _ended();
  }
  function _dragStart() {
    _inner = true;
    _innerAt = Date.now();
    _ended();
  }
  // A page drag still going: its source hears `drag` all the while.
  function _dragging() {
    if (_inner) _innerAt = Date.now();
  }
  function _dragDone() {
    _inner = false;
    _ended();
  }
  // A mouse move or a press: no drag is going on, of any kind.
  function _still() {
    _inner = false;
    _ended();
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

  // The listeners on the document and window while a tile is mounted: one set.
  /** @type {[EventTarget, string, any, boolean][]} */
  var PAGE = [
    [document, 'dragover', _pageOver, false],
    [document, 'drop', _pageDrop, false],
    [document, 'dragstart', _dragStart, true],
    [document, 'drag', _dragging, true],
    [document, 'dragend', _dragDone, true],
    [document, 'drop', _ended, true],
    // After the tile's own drop has looked at it: a drag from the page ends.
    [document, 'drop', _dragDone, false],
    [document, 'dragleave', _pageLeave, true],
    [window, 'mousemove', _still, true],
    [window, 'pointerdown', _still, true],
    [window, 'click', _ended, true],
    [window, 'keydown', _ended, true],
    [window, 'blur', _ended, false],
  ];
  /** @param {boolean} on */
  function _page(on) {
    PAGE.forEach(function (l) {
      // The document of the day (tests swap it); window stays.
      var where = l[0] === window ? window : document;
      if (!where) return;
      if (on && typeof where.addEventListener === 'function') where.addEventListener(l[1], l[2], l[3]);
      if (!on && typeof where.removeEventListener === 'function') where.removeEventListener(l[1], l[2], l[3]);
    });
  }

  /** Once the page is drawn: the cover and the listeners on this tile.
   * @param {HTMLElement} tile @param {string} cid @param {any} model */
  function mount(tile, cid, model) {
    unmount();
    if (!tile) return;
    _tile = tile;
    _cid = cid;
    _m = model;
    var t = target(cid, model);
    _drawn = t ? { aid: t.aid, label: t.label } : null;
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
    _showNotice();
    tile.addEventListener('dragenter', _enter);
    tile.addEventListener('dragover', _over);
    tile.addEventListener('dragleave', _leave);
    tile.addEventListener('drop', _drop);
    tile.addEventListener('click', _click);
    tile.addEventListener('change', _change);
    _page(true);
    // A new draw: no page drag is going on.
    _inner = false;
    var main = document.getElementById('main');
    var MO = /** @type {any} */ (window).MutationObserver;
    if (main && typeof MO === 'function') {
      _watch = new MO(function () {
        if (_tile && !_tile.isConnected) unmount();
      });
      /** @type {MutationObserver} */ (_watch).observe(main, { childList: true });
    }
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
    _page(false);
    if (_watch) _watch.disconnect();
    _watch = null;
    if (_cover && _cover.parentNode) _cover.parentNode.removeChild(_cover);
    _cover = null;
    _tile = null;
    _drawn = null;
    _depth = 0;
  }

  /** Leaving the Dashboard: the listeners and this visit's choice go.
   * @param {string} [cid] */
  function leave(cid) {
    unmount();
    _m = null;
    _cid = null;
    _inner = false;
    if (cid) {
      delete _chosen[cid];
      delete _notice[cid];
    }
  }

  return {
    emptyHtml: emptyHtml,
    choices: choices,
    chosen: chosen,
    target: target,
    shown: shown,
    stillOffered: stillOffered,
    label: label,
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
