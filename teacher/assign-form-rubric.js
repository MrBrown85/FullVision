// @ts-check
/* assign-form-rubric.js — Assignments: the rubric in the form. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignFormRubric = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var pageState,
    _blankCardHtml,
    _blankPickerKey,
    _blankRender,
    _blankSizeCells,
    _blankState,
    _blankWritten,
    _copyCardHtml,
    _copyLoad,
    _copySources,
    _copyUse,
    _lastUsedRubric,
    _newBlankDraft,
    _scrollIntoViewIfNeeded,
    _useRubricInForm,
    rubricsListCount;
  function configure(h) {
    if ('pageState' in h) pageState = h.pageState;
    if ('_blankCardHtml' in h) _blankCardHtml = h._blankCardHtml;
    if ('_blankPickerKey' in h) _blankPickerKey = h._blankPickerKey;
    if ('_blankRender' in h) _blankRender = h._blankRender;
    if ('_blankSizeCells' in h) _blankSizeCells = h._blankSizeCells;
    if ('_blankState' in h) _blankState = h._blankState;
    if ('_blankWritten' in h) _blankWritten = h._blankWritten;
    if ('_copyCardHtml' in h) _copyCardHtml = h._copyCardHtml;
    if ('_copyLoad' in h) _copyLoad = h._copyLoad;
    if ('_copySources' in h) _copySources = h._copySources;
    if ('_copyUse' in h) _copyUse = h._copyUse;
    if ('_lastUsedRubric' in h) _lastUsedRubric = h._lastUsedRubric;
    if ('_newBlankDraft' in h) _newBlankDraft = h._newBlankDraft;
    if ('_scrollIntoViewIfNeeded' in h) _scrollIntoViewIfNeeded = h._scrollIntoViewIfNeeded;
    if ('_useRubricInForm' in h) _useRubricInForm = h._useRubricInForm;
    if ('rubricsListCount' in h) rubricsListCount = h.rubricsListCount;
  }

  /* ── The rubric in the form (redesign PR 6, 2026-11-02) ─────
     A chosen rubric shows as a card: its name, how many other assessments
     use it, and the Rubric Bank's own grid with every level's wording. With
     none: four ways to start one. Graded on competencies with no rubric,
     the Competency Rubric shows the chosen competencies' level wording, the
     same the handout prints (RubricPrint's rule, CompetencyWording). */
  function _renderRubricView() {
    var view = document.getElementById('af-rubric-view');
    var sel = /** @type {any} */ (document.getElementById('af-rubric'));
    if (!view || !sel) return;
    var cid = pageState.activeCourse;
    var pending =
      pageState._pendingFormRubric && sel.value === pageState._pendingFormRubric.id
        ? pageState._pendingFormRubric
        : null;
    var rubric = pending || (sel.value ? getRubricById(cid, sel.value) : null);
    var picking = !(/** @type {any} */ (document.getElementById('af-rubric-pick')).hidden);
    // Pick Another Rubric opens Choose in the chosen rubric's place.
    if (rubric && (pageState._startOpen === 'choose' || pageState._startOpen === 'blank')) {
      // html-safe: _startCardHtml escapes every name, code and title; the grid is RubricBank.gridHtml
      view.innerHTML = _startCardHtml(cid, pageState._startOpen, true);
      _afterStartRender();
      return;
    }
    if (rubric) {
      var editingId = pageState._editingAssessId;
      var others = getAssessments(cid).filter(function (a) {
        return a.rubricId === rubric.id && a.id !== editingId;
      }).length;
      var n = (rubric.criteria || []).length;
      view.innerHTML =
        '<div class="af-rubric-card">' +
        '<div class="af-rubric-card-head"><span class="af-rubric-card-name" tabindex="0" data-af-tip="rubric">' +
        esc(rubric.name) +
        '</span><span class="af-rubric-card-meta">' +
        esc(
          n +
            (n === 1 ? ' criterion' : ' criteria') +
            ' · ' +
            (pending
              ? 'new, saved when the assessment is created'
              : others
                ? 'also on ' + others + (others === 1 ? ' other assessment' : ' other assessments')
                : 'used only here'),
        ) +
        '</span><span class="af-gap"></span>' +
        '<button type="button" class="btn btn-ghost" data-action="editRubricFromForm">Edit Rubric</button>' +
        '<button type="button" class="btn btn-ghost" data-action="chooseRubric">Pick Another Rubric</button>' +
        '</div>' +
        // html-safe: RubricBank.gridHtml escapes every name and descriptor
        (window.RubricBank ? RubricBank.gridHtml(cid, rubric) : '') +
        '</div>';
      return;
    }
    if (picking) {
      view.innerHTML = '';
      return;
    }
    var count = rubricsListCount(cid);
    var last = _lastUsedRubric(cid);
    var canCopy = _copySources(cid).length > 0;
    // Blank first (Colin, Nov 2), then Choose and Copy. A tab list (PR 7):
    // one Tab stop, ← → Home End between the starts, Enter or Space opens.
    var starts = [
      { name: 'blank', action: 'newRubricFromForm', label: 'Blank Rubric', short: 'Blank', sub: 'Start from nothing.' },
      {
        name: 'choose',
        action: 'chooseRubric',
        label: 'Choose a Rubric',
        short: 'Choose',
        sub: count
          ? 'From this class’s ' + count + (count === 1 ? ' rubric.' : ' rubrics.')
          : 'This class has no rubrics yet.',
        off: !count,
      },
      {
        name: 'copy',
        action: 'rubricFromClass',
        label: 'Copy From Another Class',
        short: 'Copy',
        sub: canCopy ? 'Any of your classes.' : 'You have no other classes.',
        off: !canCopy,
      },
    ];
    var stop = pageState._startOpen || 'blank';
    // html-safe: fixed labels, counts, _startCardHtml (escapes its values) and esc() on the last-used name and id
    view.innerHTML =
      '<div class="af-rubric-starts" role="tablist" aria-label="Start a Rubric">' +
      starts
        .map(function (st) {
          var open = pageState._startOpen === st.name;
          return (
            '<button type="button" class="af-rubric-start' +
            (open ? ' is-open' : '') +
            '" role="tab" id="af-start-tab-' +
            st.name +
            '" aria-selected="' +
            open +
            '"' +
            (open ? ' aria-controls="af-start-panel"' : '') +
            ' tabindex="' +
            (st.name === stop ? '0' : '-1') +
            '" data-action="' +
            st.action +
            '" data-start="' +
            st.name +
            '"' +
            (st.off ? ' disabled' : '') +
            '><b class="af-start-name">' +
            st.label +
            '</b><b class="af-start-short">' +
            st.short +
            '</b><span>' +
            esc(st.sub) +
            '</span></button>'
          );
        })
        .join('') +
      '</div>' +
      (pageState._startOpen ? _startCardHtml(cid, pageState._startOpen, false) : '') +
      (last && (!pageState._startOpen || pageState._startOpen === 'blank')
        ? '<p class="af-rubric-last">Last used <b>' +
          esc(last.name) +
          '</b><button type="button" class="af-link-btn" data-action="useLastRubric" data-rid="' +
          esc(last.id) +
          '">Use It Again</button></p>'
        : '');
    var row = view.querySelector('.af-rubric-starts');
    if (row) row.classList.toggle('has-open', !!pageState._startOpen);
    _afterStartRender();
  }

  function openStart(name) {
    if (pageState._startOpen === name) return closeStart();
    pageState._startOpen = name;
    if (name === 'choose') {
      var sel = /** @type {any} */ (document.getElementById('af-rubric'));
      var current = sel && sel.value ? sel.value : null;
      var g = _chooseGroups('');
      var top = g.suggested[0] || g.recent[0] || g.rest[0];
      pageState._choose = { query: '', selected: current || (top ? top.id : null), focusSearch: true };
    }
    // A Blank draft the teacher has written in is kept while another start
    // is open, and shows again when Blank reopens; Cancel on it asks first.
    if (name === 'blank') {
      if (_blankWritten()) {
        pageState._blank.focusName = true;
        pageState._blank.picker = null;
        pageState._blank.menu = null;
      } else pageState._blank = _blankState(_newBlankDraft(), false);
      pageState._blank.focusName = true;
    } else if (!_blankWritten()) pageState._blank = null;
    if (name === 'copy') {
      var first = _copySources(pageState.activeCourse)[0];
      pageState._copy = { from: first ? first.id : null, selected: null, focusFrom: true };
      _copyLoad();
    }
    _renderRubricView();
  }
  /* Closes the open start. A written Blank draft is kept (the Blank tab
     opens it again) unless `discard`. */
  function closeStart(discard) {
    if (!pageState._startOpen) return;
    var was = pageState._startOpen;
    pageState._startOpen = null;
    if (was === 'blank' && (discard === true || !_blankWritten())) pageState._blank = null;
    if (pageState._blank) {
      pageState._blank.picker = null;
      pageState._blank.menu = null;
    }
    _renderRubricView();
    var back = /** @type {any} */ (document.querySelector('.af-rubric-start[data-start="' + was + '"]'));
    if (back) back.focus();
    // Opened in the chosen rubric's place: back to Pick Another Rubric.
    else _focusRubricCard(was === 'blank' ? 'editRubricFromForm' : 'chooseRubric');
  }

  function _chooseGroups(query) {
    var ticked = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
      return /** @type {any} */ (cb).value;
    });
    return window.RubricBank && RubricBank.pickGroups
      ? RubricBank.pickGroups(pageState.activeCourse, query, ticked)
      : { suggested: [], recent: [], rest: getRubrics(pageState.activeCourse) };
  }

  // The codes of the competencies a rubric scores, in order.
  function _rubricCodes(cid, r) {
    return rubricScoredTagIds(r).map(function (t) {
      var tag = getTagById(cid, t);
      return (tag && tag.code) || t;
    });
  }

  function _startCardHtml(cid, name, inPlace) {
    if (name === 'copy') return _copyCardHtml(cid);
    if (name === 'blank') return _blankCardHtml(cid, inPlace);
    if (name !== 'choose') return '';
    var r = pageState._choose.selected ? getRubricById(cid, pageState._choose.selected) : null;
    var sel = /** @type {any} */ (document.getElementById('af-rubric'));
    var current = sel && sel.value ? sel.value : '';
    var codes = r ? _rubricCodes(cid, r) : [];
    var uses = r && window.RubricBank ? RubricBank.usesOf(cid, r.id) : [];
    var head =
      '<div class="af-rubric-card-head">' +
      (r
        ? '<span class="af-rubric-card-name">' +
          esc(r.name) +
          '</span><span class="af-rubric-card-meta">' +
          esc((r.criteria || []).length + ((r.criteria || []).length === 1 ? ' criterion' : ' criteria')) +
          (codes.length ? ' · <span class="af-start-codes">' + esc(codes.join(' ')) + '</span>' : '') +
          '</span>'
        : '<span class="af-rubric-card-name">Choose a Rubric</span>') +
      '<span class="af-gap"></span>' +
      (inPlace && current
        ? '<button type="button" class="btn btn-ghost" data-action="startPickNone">Use No Rubric</button>'
        : '') +
      '<button type="button" class="btn btn-ghost" data-action="closeStart">Close</button>' +
      '<button type="button" class="btn btn-primary" data-action="startPickUse"' +
      (r ? '' : ' disabled') +
      '>Use This Rubric</button></div>';
    var body =
      '<div class="af-start-pick">' +
      '<div class="af-start-side">' +
      '<input class="af-input af-start-search" id="af-start-search" type="search" autocomplete="off" placeholder="Search this class’s rubrics" aria-label="Search this class’s rubrics" value="' +
      esc(pageState._choose.query) +
      '">' +
      '<div class="af-start-list" id="af-start-list" role="listbox" aria-label="Rubrics">' +
      _chooseListHtml(cid) +
      '</div></div>' +
      '<div class="af-start-preview" tabindex="0" aria-label="Preview">' +
      // html-safe: RubricBank.gridHtml escapes every name and descriptor
      (r && window.RubricBank ? RubricBank.gridHtml(cid, r) : '') +
      '</div></div>';
    var foot =
      '<div class="af-tag-rubric-note">' +
      esc(
        (uses.length
          ? 'Used in ' +
            uses
              .slice(0, 3)
              .map(function (a) {
                return a.title;
              })
              .join(', ') +
            (uses.length > 3 ? ' and ' + (uses.length - 3) + ' more.' : '.')
          : r
            ? 'Not used yet.'
            : '') + ' ↑ ↓ to move, Enter to use, Esc to close.',
      ) +
      '</div>';
    return (
      '<div class="af-rubric-card af-start-card" data-start="' +
      name +
      '"' +
      (inPlace ? ' data-in-place="true"' : '') +
      ' role="region" aria-label="Choose a Rubric">' +
      head +
      body +
      foot +
      '</div>'
    );
  }

  function _chooseListHtml(cid) {
    var g = _chooseGroups(pageState._choose.query);
    if (!g.suggested.length && !g.recent.length && !g.rest.length) {
      return (
        '<p class="af-start-empty">' + (getRubrics(cid).length ? 'No rubric matches.' : 'No rubrics yet.') + '</p>'
      );
    }
    var row = function (r) {
      var codes = _rubricCodes(cid, r);
      var use = window.RubricBank ? RubricBank.usesOf(cid, r.id)[0] : null;
      var meta = [
        window.RubricBank && RubricBank.isAdvanced(r) ? 'Advanced' : '',
        use ? use.title + (use.date ? ', ' + formatShortDate(use.dateAssigned || use.date) : '') : 'not used yet',
      ]
        .filter(Boolean)
        .join(' · ');
      return (
        '<button type="button" class="af-start-row' +
        (r.id === pageState._choose.selected ? ' is-on' : '') +
        '" role="option" aria-selected="' +
        (r.id === pageState._choose.selected) +
        '" data-action="startPickRow" data-rid="' +
        esc(r.id) +
        '"><b>' +
        esc(r.name) +
        '</b>' +
        (codes.length ? '<span class="af-start-codes">' + esc(codes.join(' ')) + '</span>' : '') +
        '<small>' +
        esc(meta) +
        '</small></button>'
      );
    };
    var html = '';
    [
      ['Suggested · they score what you ticked', g.suggested],
      ['Recently Used', g.recent],
      ['Everything Else', g.rest],
    ].forEach(function (grp) {
      if (!grp[1].length) return;
      html += '<div class="af-start-group">' + esc(grp[0]) + '</div>' + grp[1].map(row).join('');
    });
    return html;
  }

  // After the view is drawn: the open start's card joins its button.
  function _afterStartRender() {
    var card = /** @type {any} */ (document.querySelector('#af-rubric-view .af-start-card'));
    if (!card) return;
    // Under the starts, the open card is the tab's panel.
    if (card.dataset.inPlace !== 'true' && document.getElementById('af-start-tab-' + card.dataset.start)) {
      card.id = 'af-start-panel';
      card.setAttribute('role', 'tabpanel');
      card.removeAttribute('aria-label');
      card.setAttribute('aria-labelledby', 'af-start-tab-' + card.dataset.start);
    }
    if (card.dataset.start === 'blank') {
      _blankSizeCells();
      if (pageState._blank && pageState._blank.focusName) {
        pageState._blank.focusName = false;
        var nm = document.getElementById('af-ge-name');
        if (nm) nm.focus({ preventScroll: true });
      }
    }
    var btn = document.querySelector('#af-rubric-view .af-rubric-start.is-open');
    if (btn) {
      var b = btn.getBoundingClientRect();
      var c = card.getBoundingClientRect();
      card.classList.toggle('joins-left', Math.abs(b.left - c.left) < 2);
      card.classList.toggle('joins-right', Math.abs(b.right - c.right) < 2);
    }
    var on = card.querySelector('.af-start-row.is-on');
    _scrollIntoViewIfNeeded(on, { block: 'nearest' });
    if (pageState._copy.focusFrom && pageState._startOpen === 'copy') {
      pageState._copy.focusFrom = false;
      var from = document.getElementById('af-copy-from');
      if (from) from.focus({ preventScroll: true });
    }
    if (pageState._choose.focusSearch) {
      pageState._choose.focusSearch = false;
      var search = document.getElementById('af-start-search');
      if (search) search.focus({ preventScroll: true });
    }
  }

  /* Focus a control on the rubric card when the control that had focus
     was drawn away (Use This Rubric, Esc from Pick Another Rubric). */
  function _focusRubricCard(action) {
    var a = document.activeElement;
    if (a && a !== document.body && document.body.contains(a)) return;
    var el = /** @type {any} */ (document.querySelector('#af-rubric-view [data-action="' + action + '"]'));
    if (el) el.focus({ preventScroll: true });
  }

  function _startPickRow(rid, focusRow) {
    if (pageState._startOpen === 'copy') pageState._copy.selected = rid;
    else pageState._choose.selected = rid;
    _renderRubricView();
    if (focusRow) {
      var row = /** @type {any} */ (document.querySelector('.af-start-row[data-rid="' + CSS.escape(rid) + '"]'));
      if (row) row.focus();
    }
  }
  function _startPickUse() {
    if (pageState._startOpen === 'copy') return _copyUse();
    var rid = pageState._choose.selected;
    if (!rid) return;
    pageState._startOpen = null;
    var sel = /** @type {any} */ (document.getElementById('af-rubric'));
    if (sel && sel.value === rid) {
      _renderRubricView();
      _focusRubricCard('chooseRubric');
      return;
    }
    _useRubricInForm(rid);
    _renderRubricView();
    _focusRubricCard('chooseRubric');
  }
  function _startPickNone() {
    pageState._startOpen = null;
    _useRubricInForm('');
    _renderRubricView();
  }
  // Typing in the search narrows the list; the selection stays when it can.
  function _startSearch(e) {
    var t = /** @type {any} */ (e.target);
    if (!t || t.id !== 'af-start-search') return;
    pageState._choose.query = t.value;
    var g = _chooseGroups(pageState._choose.query);
    var all = g.suggested.concat(g.recent, g.rest);
    if (
      !all.some(function (r) {
        return r.id === pageState._choose.selected;
      })
    )
      pageState._choose.selected = all[0] ? all[0].id : null;
    var pos = t.selectionStart;
    _renderRubricView();
    var again = /** @type {any} */ (document.getElementById('af-start-search'));
    if (again) {
      again.focus({ preventScroll: true });
      try {
        again.setSelectionRange(pos, pos);
      } catch (err) {}
    }
  }
  // ↑ ↓ move, Enter uses, Esc closes.
  // ← → Home End move between the starts that can open (a tab list).
  function _startTabKey(e, tab) {
    var keys = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    var tabs = /** @type {any[]} */ (
      Array.from(document.querySelectorAll('#af-rubric-view .af-rubric-start[role="tab"]'))
    ).filter(function (t) {
      return !t.disabled;
    });
    if (!tabs.length) return;
    e.preventDefault();
    var at = tabs.indexOf(tab);
    var step = keys[e.key];
    var next =
      step === 'first'
        ? tabs[0]
        : step === 'last'
          ? tabs[tabs.length - 1]
          : tabs[(at + step + tabs.length) % tabs.length];
    tabs.forEach(function (t) {
      t.tabIndex = t === next ? 0 : -1;
    });
    /** @type {any} */ (next).focus();
    _scrollIntoViewIfNeeded(next, { block: 'nearest', inline: 'nearest' });
  }

  function _startKeydown(e) {
    if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('af-ge-crit-name')) {
      e.preventDefault();
      var cell = e.target.closest('tr') && e.target.closest('tr').querySelector('.af-ge-text');
      if (cell) cell.focus();
      return;
    }
    var tab = e.target && e.target.closest ? e.target.closest('.af-rubric-start[role="tab"]') : null;
    if (tab) return _startTabKey(e, tab);
    var card = e.target && e.target.closest ? e.target.closest('.af-start-card') : null;
    if (!card) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // In the editor, Esc closes its picker or menu; it never throws away
      // what the teacher wrote (Cancel does that).
      if (card.dataset.start === 'blank') {
        if (pageState._blank && (pageState._blank.picker || pageState._blank.menu != null)) {
          // Back to the button that opened it.
          var back = pageState._blank.picker
            ? '[data-action="gePicker"][data-i="' + pageState._blank.picker.i + '"]'
            : '[data-action="geMenu"][data-i="' + pageState._blank.menu + '"]';
          pageState._blank.picker = null;
          pageState._blank.menu = null;
          _blankRender(back);
        }
        return;
      }
      closeStart();
      return;
    }
    if (card.dataset.start === 'blank' && e.target.closest('.af-ge-picker')) return _blankPickerKey(e);
    if (card.dataset.start !== 'choose' && card.dataset.start !== 'copy') return;
    var picked = card.dataset.start === 'copy' ? pageState._copy.selected : pageState._choose.selected;
    var rows = Array.from(card.querySelectorAll('.af-start-row'));
    var at = rows.findIndex(function (r) {
      return r.dataset.rid === picked;
    });
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      var next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      var inSearch = e.target.id === 'af-start-search';
      _startPickRow(next.dataset.rid, !inSearch);
      if (inSearch) {
        var s2 = document.getElementById('af-start-search');
        if (s2) s2.focus({ preventScroll: true });
      }
    } else if (
      e.key === 'Enter' &&
      (e.target.id === 'af-start-search' || e.target.classList.contains('af-start-row'))
    ) {
      e.preventDefault();
      _startPickUse();
    }
  }

  return {
    configure: configure,
    _focusRubricCard: _focusRubricCard,
    _renderRubricView: _renderRubricView,
    _rubricCodes: _rubricCodes,
    _startKeydown: _startKeydown,
    _startPickNone: _startPickNone,
    _startPickRow: _startPickRow,
    _startPickUse: _startPickUse,
    _startSearch: _startSearch,
    closeStart: closeStart,
    openStart: openStart,
  };
})();
