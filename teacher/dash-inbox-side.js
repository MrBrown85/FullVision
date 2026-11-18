// @ts-check
/* dash-inbox-side.js — the Inbox's Side by Side view (D6 of
   docs/plans/dashboard-inbox-plan.md; board C2). One piece's work in a row
   that scrolls sideways: every student with work in, to grade first and then
   assessed, each a page picture as tall as the tile allows (never under 80
   px) with the name and one quiet line under it. A student who sent several
   pages is a pile: the first page on top with the count on its corner;
   pointing at it, focusing it or tapping it spreads the pages sideways in
   200 ms, pushing the others along, and leaving it gathers it.

   "Compare 2" and picking two pages are not built (the plan's "Not in this
   plan"): the app has no Compare view.

   Every state and count is GraderWork's (workInIds, workStateOf, workCounts);
   this file sorts the lists it made and reads the work's own marks (who sent
   it, paper, late, pages, when). Pictures come through the tile's picture
   holder (DashInbox.pics()), asked for only when in or near view, and a
   closed pile asks for its top page alone.

   The Dashboard draws its whole page as one string, so what must outlast a
   draw (the open pile, the scroll) is kept here. */
window.DashInboxSide = (function () {
  'use strict';

  // A page is this much taller than wide; the gap is between a pile's pages.
  var RATIO = 0.75;
  var GAP = 8;
  var MIN_H = 80;
  var MAX_H = 320;
  // What the name and the line under a page take, and the row's padding.
  var CAPTION = 60;
  var PAD = 4;

  /** The pile open, the scroll, and the piece they belong to.
   * @type {{ key: string, open: string | null, scroll: number, refocus: string | null }} */
  var _st = { key: '', open: null, scroll: 0, refocus: null };
  /** @type {any} */
  var _model = null;
  /** @type {Record<string, any>} */
  var _files = {};
  var _h = 120;
  /** @type {(() => void) | null} */
  var _undo = null;

  /** @returns {any} */
  function _gw() {
    return /** @type {any} */ (window).GraderWork || null;
  }

  /** @param {any} s */
  function _at(s) {
    return String((s && (s.sent_at || s.created_at)) || '');
  }

  /** Fri 10:41 am, in the class's own zone.
   * @param {string} cid @param {string} iso */
  function _when(cid, iso) {
    var t = window.DashInbox ? DashInbox.whenText(cid, iso) : '';
    return t.replace(', ', ' ');
  }

  /** What the row shows for one piece, in order: to grade first, then
   * assessed, each in the order work came in.
   * @param {string} cid @param {string | null} aid
   * @returns {any} */
  function model(cid, aid) {
    var GW = _gw();
    /** @type {any} */
    var out = { aid: aid, title: '', items: [], order: [], notIn: 0 };
    if (!cid || !aid || !GW) return out;
    var piece = (getAssessments(cid) || []).filter(function (/** @type {any} */ a) {
      return a && a.id === aid;
    })[0];
    if (!piece) return out;
    out.title = String(piece.title || 'Untitled');
    var students = getStudents(cid) || [];
    var ids = students.map(function (s) {
      return s.id;
    });
    /** @type {Record<string, any>} */
    var byId = {};
    students.forEach(function (s) {
      byId[s.id] = s;
    });
    var counts = GW.workCounts(cid, aid, ids);
    out.notIn = counts.notin;
    var inIds = GW.workInIds(cid, aid, ids);
    /** @type {Record<string, boolean>} */
    var isIn = {};
    inIds.forEach(function (/** @type {string} */ sid) {
      isIn[sid] = true;
    });
    // One item for a pair or group handed in together (a student graded apart
    // stands alone), shown as the sender's page.
    /** @type {Record<string, boolean>} */
    var done = {};
    /** @type {any[]} */
    var items = [];
    inIds.forEach(function (/** @type {string} */ sid) {
      var g = getStudentWorkGroup(cid, sid, aid);
      var members =
        g && !g.separate
          ? g.members.filter(function (/** @type {string} */ m) {
              return isIn[m];
            })
          : [sid];
      if (!members.length) members = [sid];
      var key = members.slice().sort().join(',');
      if (done[key]) return;
      done[key] = true;
      var subs = (getGroupSubmissions(cid, members[0], aid) || []).filter(function (/** @type {any} */ s) {
        return members.indexOf(s.enrollment_id) >= 0;
      });
      subs.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return (Date.parse(_at(x)) || 0) - (Date.parse(_at(y)) || 0);
      });
      var own = subs[0];
      var sender = own ? own.enrollment_id : members[0];
      var mates = members.filter(function (/** @type {string} */ m) {
        return m !== sender;
      });
      var names = [displayName(byId[sender])].concat(
        mates.map(function (/** @type {string} */ m) {
          return displayName(byId[m]);
        }),
      );
      var name =
        names.length === 1
          ? names[0]
          : names.length === 2
            ? names[0] + ' and ' + names[1]
            : names[0] + ' and ' + (names.length - 1) + ' more';
      var tograde = members.some(function (/** @type {string} */ m) {
        return GW.workStateOf(cid, aid, m) === 'tograde';
      });
      var state = tograde ? 'tograde' : GW.workStateOf(cid, aid, sender);
      var files = (Array.isArray(own && own.files) ? own.files : [])
        .filter(function (/** @type {any} */ f) {
          return !!f;
        })
        .slice()
        .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
          return (x.page || 0) - (y.page || 0);
        });
      var at = _at(own);
      var late = !!(own && own.is_late);
      var added = !!(own && own.sent_by === 'teacher');
      var paper = !!(own && own.on_paper);
      var parts = [];
      if (late) parts.push('Late');
      if (added) parts.push('Added by You');
      if (paper) parts.push('On Paper');
      if (at) parts.push(_when(cid, at));
      parts.push(tograde ? 'To Grade' : 'Assessed');
      items.push({
        sid: sender,
        members: members,
        name: name,
        fullName: names.join(', '),
        state: state,
        tograde: tograde,
        returned: state === 'returned',
        at: at,
        late: late,
        added: added,
        paper: paper,
        pages: files,
        // A hand-in on paper with no scan is a lined sheet.
        sheet: !files.length,
        line: parts.join(' · '),
      });
    });
    items.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      if (x.tograde !== y.tograde) return x.tograde ? -1 : 1;
      var p = Date.parse(x.at) || 0;
      var q = Date.parse(y.at) || 0;
      return p - q || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
    });
    out.items = items;
    out.order = items.map(function (/** @type {any} */ i) {
      return i.sid;
    });
    return out;
  }

  /** The line under the row.
   * @param {any} m */
  function footText(m) {
    return 'To grade first, then assessed.' + (m.notIn ? ' ' + m.notIn + ' not in yet.' : '');
  }

  /* ── Drawing ───────────────────────────────────────────── */
  /** @param {string} cid @param {any} m @param {any} it @param {any} pg @param {number} i */
  function _pageHtml(cid, m, it, pg, i) {
    var n = it.sheet ? 1 : it.pages.length;
    var label =
      it.fullName +
      (n > 1 ? ', page ' + (i + 1) + ' of ' + n : '') +
      ': ' +
      it.line +
      (it.returned ? ', returned' : '') +
      '. Open in the grader.';
    var inner;
    if (it.sheet) {
      inner =
        '<span class="dash-inbox-side-sheet"><span class="dash-inbox-side-sheet-name">' +
        esc(it.name) +
        '</span><span class="dash-inbox-side-sheet-note">' +
        (it.paper ? 'Handed In on Paper' : 'No Pages') +
        '</span></span>';
    } else {
      var key = cid + '|' + m.aid + '|' + it.sid + '|' + pg.id;
      _files[key] = pg;
      inner =
        '<img class="dash-inbox-side-img" data-work-pic data-dash-side-pic="' + esc(key) + '" alt="" decoding="async">';
    }
    var badge = '';
    if (i === 0) {
      if (n > 1) badge += '<span class="dash-inbox-side-count" aria-hidden="true">' + n + ' pages</span>';
      if (it.returned) badge += '<span class="dash-inbox-side-tick" aria-hidden="true">✓</span>';
    }
    return (
      '<button type="button" class="dash-inbox-side-page" style="--i:' +
      i +
      '" data-dash-inbox-side-page="' +
      esc(it.sid) +
      '" data-pg="' +
      i +
      '" aria-label="' +
      esc(label) +
      '">' +
      inner +
      badge +
      '</button>'
    );
  }

  /** @param {string} cid @param {any} m @param {any} it */
  function _itemHtml(cid, m, it) {
    var pages = it.sheet ? [null] : it.pages;
    var open = pages.length > 1 && _st.open === it.sid;
    return (
      '<li class="dash-inbox-side-item" data-sid="' +
      esc(it.sid) +
      '"><div class="dash-inbox-side-pile' +
      (pages.length > 1 ? ' is-pile' : '') +
      (open ? ' is-open' : '') +
      '" style="--n:' +
      pages.length +
      '">' +
      pages
        .map(function (/** @type {any} */ pg, /** @type {number} */ i) {
          return _pageHtml(cid, m, it, pg, i);
        })
        .join('') +
      '</div><p class="dash-inbox-side-name" title="' +
      esc(it.name) +
      '">' +
      esc(it.name) +
      '</p><p class="dash-inbox-side-line" title="' +
      esc(it.line) +
      '">' +
      // Late is said in a word, and only the word is amber.
      (it.late ? '<span class="dash-inbox-late">Late</span>' + esc(it.line.slice(4)) : esc(it.line)) +
      '</p></li>'
    );
  }

  /** @param {string} cid
   * @returns {string} */
  function html(cid) {
    _files = {};
    var aid = DashInboxPick.current(cid);
    var key = cid + '|' + aid;
    if (_st.key !== key) _st = { key: key, open: null, scroll: 0, refocus: null };
    var sw = DashInboxPick.html(cid);
    if (!aid) {
      _model = null;
      return '<div class="dash-inbox-side"><p class="dash-inbox-side-empty">No work is in yet.</p></div>';
    }
    var m = (_model = model(cid, aid));
    // An open pile whose student no longer has several pages is let go.
    if (_st.open) {
      var open = _st.open;
      var still = m.items.some(function (/** @type {any} */ i) {
        return i.sid === open && i.pages.length > 1;
      });
      if (!still) _st.open = null;
    }
    return (
      '<div class="dash-inbox-side" data-aid="' +
      esc(aid) +
      '">' +
      sw +
      '<ul class="dash-inbox-side-row" id="dash-inbox-side-row" aria-label="' +
      esc('Work in for ' + m.title) +
      '">' +
      m.items
        .map(function (/** @type {any} */ it) {
          return _itemHtml(cid, m, it);
        })
        .join('') +
      '</ul><p class="dash-inbox-side-foot">' +
      esc(footText(m)) +
      '</p></div>'
    );
  }

  /* ── Mounted: the pile, the pictures, the clicks ───────── */
  /** @param {Element} root */
  function _row(root) {
    return /** @type {HTMLElement | null} */ (root.querySelector('#dash-inbox-side-row'));
  }

  /** The page's height from the room the tile gives the row.
   * @param {HTMLElement} row */
  function _size(row) {
    var h = Math.max(MIN_H, Math.min(MAX_H, Math.floor(row.clientHeight - PAD - CAPTION)));
    _h = h;
    row.style.setProperty('--dash-inbox-side-h', h + 'px');
  }

  /** Whether the page's picture is wanted now: a closed pile's top page,
   * an open pile's pages, in or near the row's view.
   * @param {HTMLElement} row @param {HTMLElement} img */
  function _wanted(row, img) {
    var page = img.closest('.dash-inbox-side-page');
    var pile = img.closest('.dash-inbox-side-pile');
    var item = /** @type {HTMLElement | null} */ (img.closest('.dash-inbox-side-item'));
    if (!page || !pile || !item) return false;
    var pg = Number(page.getAttribute('data-pg')) || 0;
    if (pg > 0 && !pile.classList.contains('is-open')) return false;
    // Where the page stands once the pile is spread, from layout that does
    // not move while it spreads.
    var left = item.offsetLeft + pg * (_h * RATIO + GAP);
    var w = row.clientWidth;
    return left + _h * RATIO > row.scrollLeft - w / 2 && left < row.scrollLeft + w * 1.5;
  }

  /** @param {Element} root @param {string} cid */
  function _fill(root, cid) {
    var row = _row(root);
    var pics = window.DashInbox && DashInbox.pics();
    if (!row || !pics) return;
    pics.fill(row, cid, function (/** @type {HTMLElement} */ img) {
      var f = _files[img.getAttribute('data-dash-side-pic') || ''];
      if (!f) return null;
      if (img.getAttribute('data-dash-asked')) return f;
      if (!_wanted(/** @type {HTMLElement} */ (row), img)) return null;
      img.setAttribute('data-dash-asked', '1');
      return f;
    });
  }

  /** @param {Element} root */
  function _itemOf(root, /** @type {any} */ t) {
    var li = t && t.closest ? t.closest('.dash-inbox-side-item') : null;
    return li && root.contains(li) ? /** @type {HTMLElement} */ (li) : null;
  }

  /** @param {HTMLElement | null} li */
  function _isPile(li) {
    return !!li && !!li.querySelector('.dash-inbox-side-pile.is-pile');
  }

  /** @param {Element} root @param {string | null} sid @param {string} cid */
  function _setOpen(root, sid, cid) {
    if (_st.open === sid) return;
    _st.open = sid;
    root.querySelectorAll('.dash-inbox-side-pile.is-pile').forEach(function (p) {
      var li = p.closest('.dash-inbox-side-item');
      p.classList.toggle('is-open', !!sid && !!li && li.getAttribute('data-sid') === sid);
    });
    _fill(root, cid);
  }

  /** The grader is over the tile: what happens under it (the pointer leaving, a
   * key meant for it) must not gather the pile the teacher came from. */
  function _graderOpen() {
    return !!document.getElementById('grader-overlay');
  }

  /** @param {Element} root @param {string} cid @param {() => void} redraw */
  function _bind(root, cid, redraw) {
    var row = _row(root);
    if (!row) return function () {};
    var rowEl = row;
    var ignoreFocus = false;
    /** @type {{ type: string, sid: string, open: boolean } | null} */
    var down = null;
    var frame = 0;

    /** @param {Event} e */
    function over(e) {
      if (/** @type {PointerEvent} */ (e).pointerType === 'touch') return;
      var li = _itemOf(root, e.target);
      if (_isPile(li) && li) _setOpen(root, li.getAttribute('data-sid'), cid);
    }
    /** @param {Event} e */
    function out(e) {
      if (_graderOpen()) return;
      if (/** @type {PointerEvent} */ (e).pointerType === 'touch') return;
      var li = _itemOf(root, e.target);
      if (!li || li.getAttribute('data-sid') !== _st.open) return;
      var to = /** @type {any} */ (e).relatedTarget;
      if (to && li.contains(to)) return;
      // A pile opened from the keyboard stays while the focus is in it.
      if (li.querySelector(':focus-visible')) return;
      _setOpen(root, null, cid);
    }
    /** @param {Event} e */
    function focusin(e) {
      if (ignoreFocus) return;
      var li = _itemOf(root, e.target);
      if (_isPile(li) && li) _setOpen(root, li.getAttribute('data-sid'), cid);
    }
    /** @param {Event} e */
    function focusout(e) {
      if (_graderOpen()) return;
      var li = _itemOf(root, e.target);
      if (!li || li.getAttribute('data-sid') !== _st.open) return;
      var to = /** @type {any} */ (e).relatedTarget;
      if (to && li.contains(to)) return;
      if (li.matches(':hover')) return;
      _setOpen(root, null, cid);
    }
    /** @param {Event} e */
    function pdown(e) {
      var li = _itemOf(root, e.target);
      down = li
        ? {
            type: /** @type {PointerEvent} */ (e).pointerType,
            sid: String(li.getAttribute('data-sid')),
            open: _st.open === li.getAttribute('data-sid'),
          }
        : null;
    }
    /** @param {Event} e */
    function click(e) {
      var t = /** @type {any} */ (e.target);
      var btn = t && t.closest ? t.closest('[data-dash-inbox-side-page]') : null;
      if (!btn || !rowEl.contains(btn)) return;
      var sid = btn.getAttribute('data-dash-inbox-side-page');
      var li = _itemOf(root, btn);
      var was = down;
      down = null;
      // On touch the first tap spreads a pile; a tap on a page acts.
      if (was && was.type === 'touch' && was.sid === sid && !was.open && _isPile(li)) {
        _setOpen(root, sid, cid);
        return;
      }
      if (!_model || !window.PageAssignments || !PageAssignments.openGrader) return;
      _st.refocus = sid + '|' + (btn.getAttribute('data-pg') || '0');
      PageAssignments.openGrader(cid, _model.aid, sid, { studentIds: _model.order, onClose: redraw });
    }
    function scroll() {
      _st.scroll = rowEl.scrollLeft;
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        _fill(root, cid);
      });
    }
    /** A tap or click elsewhere gathers the pile.
     * @param {Event} e */
    function docClick(e) {
      if (!_st.open || _graderOpen()) return;
      // A click on something the click itself removed (the grader's Done) is not a tap elsewhere.
      if (!(e.target instanceof Node) || !e.target.isConnected) return;
      var li = _itemOf(root, e.target);
      if (li && li.getAttribute('data-sid') === _st.open) return;
      _setOpen(root, null, cid);
    }
    /** @param {KeyboardEvent} e */
    function docKey(e) {
      if (e.key !== 'Escape' || !_st.open || _graderOpen()) return;
      // The focus goes to the pile's top page before the rest hide.
      var li = rowEl.querySelector('.dash-inbox-side-item[data-sid="' + _st.open + '"]');
      var top = li && /** @type {HTMLElement | null} */ (li.querySelector('.dash-inbox-side-page'));
      if (top && li && li.contains(document.activeElement) && document.activeElement !== top) {
        ignoreFocus = true;
        top.focus({ preventScroll: true });
        ignoreFocus = false;
      }
      _setOpen(root, null, cid);
    }
    var ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(function () {
            _size(rowEl);
            _fill(root, cid);
          })
        : null;
    if (ro) ro.observe(rowEl);

    rowEl.addEventListener('pointerover', over);
    rowEl.addEventListener('pointerout', out);
    rowEl.addEventListener('focusin', focusin);
    rowEl.addEventListener('focusout', focusout);
    rowEl.addEventListener('pointerdown', pdown);
    rowEl.addEventListener('click', click);
    rowEl.addEventListener('scroll', scroll, { passive: true });
    document.addEventListener('click', docClick);
    document.addEventListener('keydown', docKey);
    return function () {
      if (ro) ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      rowEl.removeEventListener('pointerover', over);
      rowEl.removeEventListener('pointerout', out);
      rowEl.removeEventListener('focusin', focusin);
      rowEl.removeEventListener('focusout', focusout);
      rowEl.removeEventListener('pointerdown', pdown);
      rowEl.removeEventListener('click', click);
      rowEl.removeEventListener('scroll', scroll);
      document.removeEventListener('click', docClick);
      document.removeEventListener('keydown', docKey);
    };
  }

  /** A dialog opened from here closed: draw again if the Dashboard is shown. */
  function _redraw() {
    if (document.querySelector('#main .dash-glance') && window.PageDashboard) PageDashboard.render();
  }

  /** @param {Element} root @param {string} cid */
  function mount(root, cid) {
    unmount(root);
    DashInboxPick.mount(root, cid, _redraw);
    var row = _row(root);
    /** @type {(() => void) | null} */
    var undoBind = null;
    if (row) {
      _size(row);
      row.scrollLeft = _st.scroll;
      undoBind = _bind(root, cid, _redraw);
      _fill(root, cid);
      if (_st.refocus) {
        var at = _st.refocus.split('|');
        _st.refocus = null;
        var back = /** @type {HTMLElement | null} */ (
          row.querySelector('[data-dash-inbox-side-page="' + at[0] + '"][data-pg="' + (at[1] || '0') + '"]')
        );
        // The page that was clicked takes the focus back. A pile left open
        // by the click gathers unless the pointer is on it or the keyboard is
        // in it: no pointerout comes after a redraw to do it.
        if (back) back.focus({ preventScroll: true });
        var rowRef = row;
        requestAnimationFrame(function () {
          var open = _st.open;
          if (!open || !rowRef.isConnected) return;
          var li = rowRef.querySelector('.dash-inbox-side-item[data-sid="' + open + '"]');
          if (!li || li.matches(':hover') || li.querySelector(':focus-visible')) return;
          var top = /** @type {HTMLElement | null} */ (li.querySelector('.dash-inbox-side-page'));
          if (top && li.contains(document.activeElement) && document.activeElement !== top) {
            top.focus({ preventScroll: true });
          }
          _setOpen(root, null, cid);
        });
      }
    }
    var mine = _st.key;
    _undo = function () {
      // The scroll as it stands, before the page is drawn again (its event may not have come).
      if (row && row.isConnected && _st.key === mine) _st.scroll = row.scrollLeft;
      DashInboxPick.unmount(root);
      if (undoBind) undoBind();
    };
  }

  /** @param {Element} [root] */
  function unmount(root) {
    if (_undo) _undo();
    _undo = null;
  }

  if (window.DashInbox) {
    DashInbox.addView({
      key: 'side',
      label: 'Side by Side',
      hint: "Each student's pages in a row, to compare.",
      html: html,
      mount: mount,
      unmount: unmount,
    });
  }

  return {
    model: model,
    footText: footText,
    html: html,
    mount: mount,
    unmount: unmount,
    state: function () {
      return { open: _st.open, scroll: _st.scroll, key: _st.key };
    },
  };
})();
