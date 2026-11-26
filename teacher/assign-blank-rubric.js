// @ts-check
/* assign-blank-rubric.js — Assignments: the Blank Rubric editor in the form. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignBlankRubric = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _RUBRIC_STYLE_NAMES,
    _renderRubricView,
    closeStart,
    pageState,
    _askBeforeScoredChange,
    _closeRubricModal,
    _dropBlankChecks,
    _formDialog,
    _holdFormRubric,
    _renderRubricModal,
    _saveModalRubric;
  function configure(h) {
    if ('_RUBRIC_STYLE_NAMES' in h) _RUBRIC_STYLE_NAMES = h._RUBRIC_STYLE_NAMES;
    if ('_renderRubricView' in h) _renderRubricView = h._renderRubricView;
    if ('closeStart' in h) closeStart = h.closeStart;
    if ('pageState' in h) pageState = h.pageState;
    if ('_askBeforeScoredChange' in h) _askBeforeScoredChange = h._askBeforeScoredChange;
    if ('_closeRubricModal' in h) _closeRubricModal = h._closeRubricModal;
    if ('_dropBlankChecks' in h) _dropBlankChecks = h._dropBlankChecks;
    if ('_formDialog' in h) _formDialog = h._formDialog;
    if ('_holdFormRubric' in h) _holdFormRubric = h._holdFormRubric;
    if ('_renderRubricModal' in h) _renderRubricModal = h._renderRubricModal;
    if ('_saveModalRubric' in h) _saveModalRubric = h._saveModalRubric;
  }

  // The editor's state: the draft, whether it was typed in, and the draft
  // as it opened (to tell a real edit from a click).
  function _blankState(draft, touched) {
    return { draft: draft, touched: touched, orig: JSON.stringify(draft) };
  }
  // True when the open or kept Blank draft differs from how it opened.
  function _blankWritten() {
    return !!(
      pageState._blank &&
      pageState._blank.touched &&
      JSON.stringify(pageState._blank.draft) !== pageState._blank.orig
    );
  }
  /* The editor's Cancel: a draft with writing in it asks first. Editing a
     rubric made on the form leaves that rubric as it was. */
  function _cancelBlank() {
    var inModal = pageState._blank && pageState._blank.host === 'modal';
    var done = function () {
      if (inModal) _closeRubricModal();
      else closeStart(true);
    };
    if (!_blankWritten()) return done();
    var name = String((pageState._blank && pageState._blank.draft.name) || '').trim();
    _formDialog('Discard This Rubric?', (name || 'This rubric') + ' isn\u2019t saved. What you wrote in it is lost.', [
      { label: 'Keep Editing', style: 'cancel' },
      {
        label: 'Discard',
        style: 'danger',
        run: done,
      },
    ]);
  }

  function _newBlankDraft() {
    return {
      id: uid(),
      name: '',
      style: 'standard',
      tagIds: [],
      criteria: [_newBlankCriterion(1)],
    };
  }
  function _newBlankCriterion(n) {
    return {
      id: uid(),
      name: 'Criterion ' + n,
      tagIds: [],
      levels: { 4: '', 3: '', 2: '', 1: '' },
      weight: 1,
      levelValues: null,
      checks: [],
    };
  }
  function _blankLevels(cid, draft) {
    if (rubricStyle(draft) === 'single_point') return [3];
    // Its own level columns (shared/rubric-scale.js), in the class's order.
    if (window.RubricScale && RubricScale.has(draft)) return RubricScale.keys(draft, levelOrderFor(cid));
    return levelOrderFor(cid);
  }
  /* One level's header: its name typed in place, its number, a ▾ menu
     (Counts As, Insert Before, Insert After, Remove Level) and, on a rubric
     with its own columns, what it counts as. As other gradebooks do. */
  // html-safe: names through esc; numbers and ids are ours
  function _blankLevelHeadHtml(d, lv) {
    var own = window.RubricScale && RubricScale.has(d);
    var name = own ? RubricScale.name(d, lv) : PROF_LABELS[lv];
    var tone = own ? RubricScale.tone(d, lv) : lv;
    var open = pageState._blank.colMenu === lv;
    var cols = own ? RubricScale.columns(d).length : 4;
    var menu = '';
    if (open) {
      var steps = own ? RubricScale.stepsFor(d, lv) : [];
      var now = own ? RubricScale.toStored(d, lv) : { level: lv, mod: 0 };
      menu =
        '<div class="af-ge-colmenu" role="group" aria-label="' +
        esc(name + ' settings') +
        '">' +
        (own
          ? '<label class="af-ge-counts">Counts As <select class="af-input" data-ge="colcounts" data-k="' +
            lv +
            '">' +
            steps
              .map(function (st) {
                var on = st.level === now.level && st.mod === now.mod;
                return (
                  '<option value="' +
                  st.level +
                  ':' +
                  st.mod +
                  '"' +
                  (on ? ' selected' : '') +
                  '>' +
                  esc(st.text) +
                  '</option>'
                );
              })
              .join('') +
            '</select></label>'
          : '<p class="af-ge-colnote">Counts as ' + esc(PROF_LABELS[lv]) + '. Add or rename a level to choose.</p>') +
        (cols < RubricScale.MAX
          ? '<button type="button" class="af-ge-menu-item" data-action="geColInsert" data-k="' +
            lv +
            '" data-side="before">Insert Level Before</button>' +
            '<button type="button" class="af-ge-menu-item" data-action="geColInsert" data-k="' +
            lv +
            '" data-side="after">Insert Level After</button>'
          : '') +
        (cols > RubricScale.MIN
          ? '<button type="button" class="af-ge-menu-item is-danger" data-action="geColRemove" data-k="' +
            lv +
            '">Remove Level</button>'
          : '') +
        '</div>';
    }
    return (
      '<th scope="col" class="rb-level-head af-ge-level-head l' +
      tone +
      (open ? ' is-open' : '') +
      '"><div class="af-ge-level-top"><input class="af-ge-colname" type="text" data-ge="colname" data-k="' +
      lv +
      '" value="' +
      esc(name) +
      '" aria-label="Level name" maxlength="40"><span class="rb-level-value">' +
      lv +
      '</span><button type="button" class="af-ge-colmore" data-action="geColMenu" data-k="' +
      lv +
      '" aria-expanded="' +
      open +
      '" aria-label="' +
      esc(name + ' options') +
      '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></div>' +
      (own ? '<span class="af-ge-counts-line">Counts as ' + esc(RubricScale.countsAs(d, lv)) + '</span>' : '') +
      menu +
      '</th>'
    );
  }

  function _blankCardHtml(cid, inPlace) {
    if (!pageState._blank) pageState._blank = _blankState(_newBlankDraft(), false);
    var d = pageState._blank.draft;
    var style = rubricStyle(d);
    var levels = _blankLevels(cid, d);
    var own = !!window.RubricScale && RubricScale.has(d);
    var canAddCol = style !== 'single_point' && !!window.RubricScale && levels.length < RubricScale.MAX;
    var head =
      '<div class="af-rubric-card-head">' +
      '<input class="af-input af-ge-name" id="af-ge-name" type="text" autocomplete="off" placeholder="Name This Rubric" aria-label="Rubric name" value="' +
      esc(d.name || '') +
      '">' +
      '<span class="seg af-ge-style" role="radiogroup" aria-label="Rubric Style">' +
      RUBRIC_STYLES.map(function (st) {
        return (
          '<button type="button" class="seg-btn' +
          (st === style ? ' active' : '') +
          '" role="radio" aria-checked="' +
          (st === style) +
          '" data-action="geStyle" data-style="' +
          st +
          '">' +
          _RUBRIC_STYLE_NAMES[st] +
          '</button>'
        );
      }).join('') +
      '</span><span class="af-gap"></span>' +
      '<button type="button" class="btn btn-ghost" data-action="closeStart">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="geSave">Save Rubric</button></div>';
    // Competencies scored by the whole rubric: one combined score each.
    var whole =
      '<div class="af-ge-whole"><span class="af-ge-whole-label">Whole Rubric Scores</span>' +
      _blankChipsHtml(cid, d.tagIds || [], -2) +
      '<button type="button" class="af-link-btn" data-action="gePicker" data-i="-2">+ Competency</button>' +
      (pageState._blank.picker && pageState._blank.picker.i === -2 ? _blankPickerHtml(cid, -2) : '') +
      '</div>';
    var grid =
      '<table class="rb-grid af-ge-grid' +
      (style === 'single_point' ? ' is-single-point' : '') +
      (canAddCol ? ' has-addcol' : '') +
      ' cols-' +
      levels.length +
      '"><thead><tr><th class="rb-crit-head" scope="col">Criterion</th>' +
      levels
        .map(function (lv) {
          if (style !== 'single_point') return _blankLevelHeadHtml(d, lv);
          return '<th scope="col" class="rb-level-head l3"><span>Proficient Standard</span></th>';
        })
        .join('') +
      (canAddCol
        ? '<th scope="col" class="af-ge-addcol-head"><button type="button" class="af-ge-addcol" data-action="geColAdd" title="Add a level" aria-label="Add a level"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></th>'
        : '') +
      '</tr></thead><tbody>' +
      d.criteria
        .map(function (c, i) {
          return _blankRowHtml(cid, d, c, i, levels, style) + '';
        })
        .join('') +
      _cm('overallRow', levels.length + (canAddCol ? 1 : 0)) +
      '</tbody></table>';
    var foot =
      '<div class="af-tag-rubric-note af-ge-foot">' +
      '<button type="button" class="af-link-btn" data-action="geAddCrit">+ Add Criterion</button>' +
      (own
        ? ''
        : '<button type="button" class="af-link-btn" data-action="gePicker" data-i="-1">+ From Competency</button>') +
      _cm('foot') +
      (pageState._blank.picker && pageState._blank.picker.i === -1 ? _blankPickerHtml(cid, -1) : '') +
      '</div>';
    return (
      '<div class="af-rubric-card af-start-card af-ge-card" data-start="blank"' +
      (inPlace ? ' data-in-place="true"' : '') +
      ' role="region" aria-label="' +
      (inPlace ? 'Edit Rubric' : 'Blank Rubric') +
      '">' +
      head +
      whole +
      '<div class="af-ge-body">' +
      grid +
      '</div>' +
      foot +
      '</div>'
    );
  }

  // Competency chips with ×; i is the criterion, or -2 for the whole rubric.
  function _blankChipsHtml(cid, tagIds, i) {
    return tagIds
      .map(function (t) {
        var tag = getTagById(cid, t);
        return (
          '<span class="af-ge-chip"><b>' +
          esc((tag && tag.code) || t) +
          '</b>' +
          esc((tag && (tag.label || tag.shortName)) || '') +
          '<button type="button" class="af-ge-x" data-action="geRemoveTag" data-i="' +
          i +
          '" data-tag="' +
          esc(t) +
          '" aria-label="' +
          esc('Remove ' + ((tag && tag.code) || t)) +
          '">×</button></span>'
        );
      })
      .join('');
  }

  // Comments in the editor (teacher/rubric-comment-lines.js): '' while its switch is off.
  function _cm(what, a, b, c) {
    return window.RubricCommentLines ? RubricCommentLines[what](pageState._blank, pageState.activeCourse, a, b, c) : '';
  }
  function _blankRowHtml(cid, d, c, i, levels, style) {
    var chips = _blankChipsHtml(cid, c.tagIds || [], i);
    var menuOpen = pageState._blank.menu === i;
    var menu = menuOpen
      ? '<div class="af-ge-menu" role="group" aria-label="Criterion settings">' +
        '<label>Weight <input class="af-input" type="number" min="0" step="0.5" data-ge="weight" data-i="' +
        i +
        '" value="' +
        esc(String(c.weight != null ? c.weight : 1)) +
        '"></label>' +
        (style === 'single_point' || (window.RubricScale && RubricScale.has(d))
          ? ''
          : '<div class="af-ge-points"><span>Points</span>' +
            // In the grid's order (Emerging first unless the class says otherwise).
            levelOrderFor(cid)
              .map(function (lv) {
                var v = c.levelValues && c.levelValues[lv] != null ? c.levelValues[lv] : lv;
                return (
                  '<label>' +
                  esc(PROF_LABELS[lv]) +
                  ' <input class="af-input" type="number" min="0" step="0.5" data-ge="value" data-i="' +
                  i +
                  '" data-level="' +
                  lv +
                  '" value="' +
                  esc(String(v)) +
                  '"></label>'
                );
              })
              .join('') +
            '</div>') +
        '<div class="af-ge-menu-row">' +
        '<button type="button" class="af-ge-menu-item" data-action="geDupCrit" data-i="' +
        i +
        '">Duplicate</button>' +
        '<button type="button" class="af-ge-menu-item" data-action="geMoveCrit" data-dir="-1" data-i="' +
        i +
        '"' +
        (i > 0 ? '' : ' disabled') +
        '>Move Up</button>' +
        '<button type="button" class="af-ge-menu-item" data-action="geMoveCrit" data-dir="1" data-i="' +
        i +
        '"' +
        (i < d.criteria.length - 1 ? '' : ' disabled') +
        '>Move Down</button></div>' +
        '<button type="button" class="af-link-btn af-ge-remove" data-action="geRemoveCrit" data-i="' +
        i +
        '"' +
        (d.criteria.length > 1 ? '' : ' disabled') +
        '>Remove Criterion</button></div>'
      : '';
    var cells = levels
      .map(function (lv) {
        var lvName = window.RubricScale && RubricScale.has(d) ? RubricScale.name(d, lv) : PROF_LABELS[lv];
        var checks =
          style === 'advanced' && window.RubricChecks
            ? '<div class="af-ge-checks">' +
              RubricChecks.checksAt(c, lv)
                .map(function (k, ki) {
                  return (
                    '<label class="af-ge-check"><span class="rb-box" aria-hidden="true"></span><input type="text" class="af-ge-check-input" data-ge="check" data-i="' +
                    i +
                    '" data-level="' +
                    lv +
                    '" data-k="' +
                    ki +
                    '" value="' +
                    esc(k.label || '') +
                    '" placeholder="Something to look for" aria-label="Checkbox"></label>'
                  );
                })
                .join('') +
              '<button type="button" class="af-link-btn" data-action="geAddCheck" data-i="' +
              i +
              '" data-level="' +
              lv +
              '">+ Checkbox</button></div>'
            : '';
        return (
          '<td class="rb-cell af-ge-cell"><textarea class="af-ge-text" rows="2" data-ge="level" data-i="' +
          i +
          '" data-level="' +
          lv +
          '" placeholder="' +
          esc('What does ' + String(lvName).toLowerCase() + ' look like?') +
          '" aria-label="' +
          esc((c.name || 'Criterion') + ', ' + lvName) +
          '">' +
          esc((c.levels && c.levels[lv]) || '') +
          '</textarea>' +
          checks +
          _cm('cell', c, i, lv) +
          '</td>'
        );
      })
      .join('');
    return (
      '<tr><th scope="row" class="rb-crit af-ge-crit">' +
      '<textarea class="af-ge-crit-name" rows="1" data-ge="name" data-i="' +
      i +
      '" placeholder="Name this criterion" aria-label="Criterion name">' +
      esc(c.name || '') +
      '</textarea>' +
      (chips ? '<div class="af-ge-chips">' + chips + '</div>' : '') +
      '<div class="af-ge-tools"><button type="button" class="af-link-btn" data-action="gePicker" data-i="' +
      i +
      '">+ Competency</button><button type="button" class="af-ge-more" data-action="geMenu" data-i="' +
      i +
      '" aria-expanded="' +
      menuOpen +
      '" aria-label="Weight and points">···</button>' +
      _cm('tools', i) +
      '</div>' +
      menu +
      (pageState._blank.picker && pageState._blank.picker.i === i ? _blankPickerHtml(cid, i) : '') +
      '</th>' +
      cells +
      // The + column's empty cell, so the rows line up under it.
      (style !== 'single_point' && window.RubricScale && levels.length < RubricScale.MAX
        ? '<td class="af-ge-addcol-cell" aria-hidden="true"></td>'
        : '') +
      '</tr>'
    );
  }

  // A competency picker: the class's competencies by folder, typed to narrow.
  function _blankPickerHtml(cid, i) {
    return (
      '<div class="af-ge-picker" role="dialog" aria-label="' +
      (i === -1
        ? 'Add a criterion from a competency'
        : i === -2
          ? 'Add a competency the whole rubric scores'
          : 'Add a competency') +
      '"><input class="af-input" id="af-ge-pick-search" type="search" autocomplete="off" placeholder="Type a code or words" aria-label="Find a competency" value="' +
      esc((pageState._blank.picker && pageState._blank.picker.query) || '') +
      '"><div class="af-ge-pick-list" id="af-ge-pick-list">' +
      _blankPickListHtml(cid, i) +
      '</div></div>'
    );
  }
  function _blankPickListHtml(cid, i) {
    var q = String((pageState._blank.picker && pageState._blank.picker.query) || '')
      .trim()
      .toLowerCase();
    // A competency is on the whole rubric or on criteria, never both: the
    // whole rubric's picker leaves out every criterion's, and a criterion's
    // leaves out the whole rubric's.
    var d = pageState._blank.draft;
    var have = (d.tagIds || []).slice();
    if (i >= 0) have = have.concat((d.criteria[i] || {}).tagIds || []);
    if (i === -2)
      d.criteria.forEach(function (c) {
        have = have.concat((c && c.tagIds) || []);
      });
    var groups = {};
    (getCompetencyGroups(cid) || []).forEach(function (g) {
      groups[g.id] = g.name;
    });
    var lastGroup = null;
    var html = '';
    (getSections(cid) || []).forEach(function (sec) {
      var tag = sec.tags && sec.tags[0];
      if (!tag || have.indexOf(tag.id) >= 0) return;
      var hay = [tag.code, tag.label, tag.shortName, tag.text].join(' ').toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      var g = groups[sec.groupId] || '';
      if (g !== lastGroup) {
        lastGroup = g;
        if (g) html += '<div class="af-start-group">' + esc(g) + '</div>';
      }
      html +=
        '<button type="button" class="af-ge-pick" data-action="gePick" data-i="' +
        i +
        '" data-tag="' +
        esc(tag.id) +
        '"><b>' +
        esc(tag.code || tag.id) +
        '</b>' +
        esc(tag.label || tag.shortName || sec.name || '') +
        '</button>';
    });
    return html || '<p class="af-start-empty">No competency matches.</p>';
  }

  /* An open ··· menu or competency picker is scrolled clear of the form's
     sticky footer, which would otherwise sit over its lower part. */
  function _blankClearFooter() {
    var pop = /** @type {any} */ (document.querySelector('.af-ge-card .af-ge-menu, .af-ge-card .af-ge-picker'));
    var foot = /** @type {any} */ (document.querySelector('#new-assess-form > .af-actions'));
    if (!pop || !foot) return;
    var overBy = function () {
      return pop.getBoundingClientRect().bottom - (foot.getBoundingClientRect().top - 8);
    };
    var over = overBy();
    if (over <= 0) return;
    var scrolled = false;
    for (var el = pop.parentElement; el && el !== document.body; el = el.parentElement) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
        el.scrollTop += over;
        scrolled = true;
        break;
      }
    }
    if (!scrolled) window.scrollBy(0, over);
    // Near the end of the form the footer moves up with the page, so no
    // scroll clears it: the picker opens above its button instead.
    if (overBy() > 0 && pop.classList.contains('af-ge-picker')) pop.classList.add('is-up');
  }
  // A click outside an open ··· menu or picker closes it, as Esc does.
  function _blankOutside(e) {
    if (!pageState._blank || (pageState._blank.menu == null && !pageState._blank.picker)) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.af-ge-menu, .af-ge-picker, [data-action="geMenu"], [data-action="gePicker"]')) return;
    pageState._blank.menu = null;
    pageState._blank.picker = null;
    document.querySelectorAll('.af-ge-card .af-ge-menu, .af-ge-card .af-ge-picker').forEach(function (el) {
      el.remove();
    });
    document.querySelectorAll('.af-ge-card .af-ge-more[aria-expanded="true"]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
  }
  /* In the competency picker: ↓ ↑ move between the search and the
     matches, Enter in the search picks the first match. */
  function _blankPickerKey(e) {
    var picker = e.target.closest('.af-ge-picker');
    var picks = Array.from(picker.querySelectorAll('.af-ge-pick'));
    var search = picker.querySelector('#af-ge-pick-search');
    var at = picks.indexOf(e.target);
    if (e.key === 'Enter' && e.target === search) {
      e.preventDefault();
      if (picks[0]) _blankAct('gePick', picks[0]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      var down = picks[Math.min(picks.length - 1, at + 1)];
      if (down) down.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (at <= 0) {
        if (search) search.focus();
      } else picks[at - 1].focus();
    }
  }

  // Redraw the editor and put the cursor back where it was.
  function _blankRender(focusSel) {
    var a = /** @type {any} */ (document.activeElement);
    var keep =
      focusSel ||
      (window.RubricCommentLines && RubricCommentLines.keep(a)) ||
      (a && a.dataset && a.dataset.ge && a.dataset.k
        ? '[data-ge="' + a.dataset.ge + '"][data-k="' + a.dataset.k + '"]'
        : a && a.dataset && a.dataset.ge
          ? '[data-ge="' +
            a.dataset.ge +
            '"][data-i="' +
            a.dataset.i +
            '"]' +
            (a.dataset.level ? '[data-level="' + a.dataset.level + '"]' : '') +
            (a.dataset.k ? '[data-k="' + a.dataset.k + '"]' : '')
          : a && a.id
            ? '#' + a.id
            : null);
    var inModal = pageState._blank && pageState._blank.host === 'modal';
    if (inModal) _renderRubricModal();
    else _renderRubricView();
    var back = /** @type {any} */ (
      keep ? document.querySelector((inModal ? '#rubric-modal ' : '') + '.af-ge-card ' + keep) : null
    );
    if (back) back.focus({ preventScroll: true });
    // A text box drawn again keeps its cursor at the end of what was typed.
    if (back && back.type === 'text' && typeof back.setSelectionRange === 'function')
      back.setSelectionRange(back.value.length, back.value.length);
    _blankSizeCells();
  }
  // Each row's level cells take the height of its longest one, so the
  // row reads as one band; the criterion name grows with its words. Every
  // row is done in three passes (each height to auto, each read, each
  // written), so the page is laid out once, not once a row.
  function _blankSizeCells() {
    _blankSizeRows(document.querySelectorAll('.af-ge-grid tbody tr'));
  }
  function _blankSizeRow(tr) {
    if (tr) _blankSizeRows([tr]);
  }
  function _blankSizeRows(trs) {
    var rows = Array.prototype.map.call(trs, function (tr) {
      var name = tr.querySelector('.af-ge-crit-name');
      return { boxes: (name ? [name] : []).concat(Array.from(tr.querySelectorAll('.af-ge-text'))), name: !!name };
    });
    rows.forEach(function (r) {
      r.boxes.forEach(function (t) {
        t.style.height = 'auto';
      });
    });
    rows.forEach(function (r) {
      r.heights = r.boxes.map(function (t) {
        return t.scrollHeight;
      });
    });
    rows.forEach(function (r) {
      var tallest = Math.max.apply(null, [88].concat(r.heights.slice(r.name ? 1 : 0)));
      r.boxes.forEach(function (t, i) {
        t.style.height = (r.name && !i ? r.heights[0] : tallest) + 'px';
      });
    });
    if (window.RubricCommentLines) RubricCommentLines.size(trs);
  }

  // Typing: the draft follows each field; nothing redraws.
  function _blankInput(e) {
    var t = e.target;
    if (!pageState._blank || !t || !t.closest || !t.closest('.af-ge-card')) return;
    var d = pageState._blank.draft;
    if (t.id === 'af-ge-name') {
      d.name = t.value;
      pageState._blank.touched = true;
      return;
    }
    if (t.id === 'af-ge-pick-search') {
      pageState._blank.picker.query = t.value;
      var list = document.getElementById('af-ge-pick-list');
      // html-safe: _blankPickListHtml escapes every code and name
      if (list) list.innerHTML = _blankPickListHtml(pageState.activeCourse, pageState._blank.picker.i);
      return;
    }
    var kind = t.dataset && t.dataset.ge;
    if (!kind) return;
    // A level's name, typed in its header; Counts As, picked in its menu.
    if (kind === 'colname' || kind === 'colcounts') {
      pageState._blank.touched = true;
      var k = /** @type {any} */ (Number(t.dataset.k));
      if (kind === 'colname') {
        var was = window.RubricScale && RubricScale.has(d);
        RubricScale.renameLevel(d, k, t.value);
        // The first rename gives the rubric its own columns: redraw so
        // each header says what it counts as.
        if (!was && RubricScale.has(d)) _blankRender();
        return;
      }
      var parts = String(t.value).split(':');
      RubricScale.setLevelCounts(d, k, Number(parts[0]), Number(parts[1]));
      _blankRender('[data-ge="colcounts"][data-k="' + k + '"]');
      return;
    }
    var c = d.criteria[Number(t.dataset.i)];
    if (!c) return;
    pageState._blank.touched = true;
    var lv = Number(t.dataset.level);
    if (kind === 'name') {
      c.name = t.value.replace(/\n/g, ' ');
      _blankSizeRow(t.closest('tr'));
    } else if (kind === 'level') {
      c.levels = Object.assign({}, c.levels);
      c.levels[lv] = t.value;
      _blankSizeRow(t.closest('tr'));
    } else if (kind === 'weight') {
      var w = parseFloat(t.value);
      c.weight = isNaN(w) || w < 0 ? 1 : w;
    } else if (kind === 'value') {
      var v = parseFloat(t.value);
      c.levelValues = Object.assign({ 4: 4, 3: 3, 2: 2, 1: 1 }, c.levelValues || {});
      c.levelValues[lv] = isNaN(v) ? lv : v;
    } else if (kind === 'check') {
      var list2 = RubricChecks.checksAt(c, lv);
      var k = list2[Number(t.dataset.k)];
      if (k) k.label = t.value;
    }
  }

  function _blankAct(action, el) {
    if (!pageState._blank) return;
    var d = pageState._blank.draft;
    var i = Number(el.dataset.i);
    var cid = pageState.activeCourse;
    if (action === 'geStyle') {
      d.style = el.dataset.style;
      // A Single-Point rubric states one standard: its own columns go.
      if (d.style === 'single_point' && d.scale) d.scale = null;
      pageState._blank.colMenu = null;
      pageState._blank.touched = true;
    } else if (action === 'geAddCrit') {
      d.criteria.push(_newBlankCriterion(d.criteria.length + 1));
      pageState._blank.touched = true;
      _blankRender('[data-ge="name"][data-i="' + (d.criteria.length - 1) + '"]');
      return;
    } else if (action === 'geRemoveCrit') {
      var gone = d.criteria[i];
      var scoredOn = gone && pageState._blank.host === 'modal' ? pageState._rubricScored[gone.id] || 0 : 0;
      if (scoredOn && !el.dataset.confirmed) {
        showConfirm(
          'Remove a scored criterion?',
          RubricGuard.removeMessage(gone, scoredOn),
          'Remove and drop scores',
          'danger',
          function () {
            el.dataset.confirmed = '1';
            _blankAct('geRemoveCrit', el);
          },
        );
        return;
      }
      if (d.criteria.length > 1) d.criteria.splice(i, 1);
      pageState._blank.menu = null;
      pageState._blank.touched = true;
    } else if (action === 'geMenu') {
      pageState._blank.menu = pageState._blank.menu === i ? null : i;
      pageState._blank.picker = null;
      // Open: the cursor goes to its Weight; closed: back to the ··· button.
      _blankRender(
        pageState._blank.menu != null
          ? '[data-ge="weight"][data-i="' + i + '"]'
          : '[data-action="geMenu"][data-i="' + i + '"]',
      );
      _blankClearFooter();
      return;
    } else if (action === 'gePicker') {
      pageState._blank.picker = pageState._blank.picker && pageState._blank.picker.i === i ? null : { i: i, query: '' };
      pageState._blank.menu = null;
      _blankRender(pageState._blank.picker ? '#af-ge-pick-search' : null);
      _blankClearFooter();
      return;
    } else if (action === 'geRemoveTag') {
      var c = i === -2 ? d : d.criteria[i];
      if (c)
        c.tagIds = (c.tagIds || []).filter(function (t) {
          return t !== el.dataset.tag;
        });
      pageState._blank.touched = true;
    } else if (action === 'gePick') {
      var tag = getTagById(cid, el.dataset.tag);
      pageState._blank.picker = null;
      pageState._blank.touched = true;
      if (!tag) return _blankRender();
      if (i === -2) {
        if ((d.tagIds || []).indexOf(tag.id) < 0) d.tagIds = (d.tagIds || []).concat([tag.id]);
        return _blankRender();
      }
      if (i >= 0) {
        var crit = d.criteria[i];
        if (crit && crit.tagIds.indexOf(tag.id) < 0) crit.tagIds = crit.tagIds.concat([tag.id]);
        return _blankRender();
      }
      // + From Competency: a criterion with the competency's wording, in
      // place of an untouched first row.
      var make = function () {
        var levels = {};
        [1, 2, 3, 4].forEach(function (l) {
          levels[l] = window.CompetencyWording ? CompetencyWording.levelWording(tag, l).text : '';
        });
        var row = Object.assign(_newBlankCriterion(d.criteria.length + 1), {
          name: tag.label || tag.shortName || tag.code || 'Criterion',
          tagIds: [tag.id],
          levels: levels,
        });
        var first = d.criteria[0];
        var untouched =
          d.criteria.length === 1 &&
          !first.tagIds.length &&
          /^Criterion 1$/.test(first.name || '') &&
          ![1, 2, 3, 4].some(function (l) {
            return String((first.levels || {})[l] || '').trim();
          });
        if (untouched) d.criteria = [row];
        else d.criteria.push(row);
        _blankRender();
      };
      if (window.CompetencyWording) CompetencyWording.loadBank().then(make);
      else make();
      return;
    } else if (action === 'geAddCheck') {
      var cc = d.criteria[i];
      var lv = Number(el.dataset.level);
      if (cc) {
        cc.checks = (cc.checks || []).concat([
          { id: uid(), level: lv, label: '', displayOrder: RubricChecks.checksAt(cc, lv).length },
        ]);
        pageState._blank.touched = true;
        var k = RubricChecks.checksAt(cc, lv).length - 1;
        _blankRender('[data-ge="check"][data-i="' + i + '"][data-level="' + lv + '"][data-k="' + k + '"]');
        return;
      }
    } else if (action === 'geColMenu') {
      var mk = Number(el.dataset.k);
      pageState._blank.colMenu = pageState._blank.colMenu === mk ? null : mk;
      pageState._blank.menu = null;
      pageState._blank.picker = null;
      _blankRender('[data-action="geColMenu"][data-k="' + mk + '"]');
      return;
    } else if (action === 'geColAdd' || action === 'geColInsert' || action === 'geColRemove') {
      // Levels are kept low to high; the + adds one at the grid's far end.
      var asc = Number(levelOrderFor(cid)[0]) === 1;
      var cols = RubricScale.columns(d);
      var pos = cols.findIndex(function (cc) {
        return cc.k === Number(el.dataset.k);
      });
      var done;
      if (action === 'geColRemove') done = RubricScale.removeLevel(d, Number(el.dataset.k));
      else {
        var at =
          action === 'geColAdd'
            ? asc
              ? cols.length
              : 0
            : // Before and After are as the teacher sees the grid.
              (el.dataset.side === 'after') === asc
              ? pos + 1
              : pos;
        done = RubricScale.insertLevel(d, at, 'New Level');
      }
      if (!done) return;
      pageState._blank.colMenu = null;
      pageState._blank.touched = true;
      if (action === 'geColRemove') return _blankRender();
      var made = RubricScale.columns(d).filter(function (cc) {
        return cc.name === 'New Level';
      })[0];
      _blankRender(made ? '[data-ge="colname"][data-k="' + made.k + '"]' : null);
      var box = made && document.querySelector('.af-ge-card [data-ge="colname"][data-k="' + made.k + '"]');
      if (box) box.select();
      return;
    } else if (action === 'geSave') {
      if (pageState._blank.host === 'modal') _saveModalRubric();
      else _blankSave(false);
      return;
    } else if (action === 'geDupCrit' || action === 'geMoveCrit') {
      // ··· Duplicate puts a copy (new ids, no scores) under the criterion;
      // Move Up and Move Down swap it with its neighbour.
      var src = d.criteria[i];
      if (!src) return;
      if (action === 'geDupCrit') {
        var copy = structuredClone(src);
        copy.id = uid();
        copy.name = (src.name || 'Criterion') + ' (Copy)';
        copy.checks = (copy.checks || []).map(function (k) {
          return Object.assign({}, k, { id: uid() });
        });
        d.criteria.splice(i + 1, 0, copy);
        pageState._blank.menu = null;
        pageState._blank.touched = true;
        _blankRender('[data-ge="name"][data-i="' + (i + 1) + '"]');
        return;
      }
      var to = i + Number(el.dataset.dir);
      if (to < 0 || to >= d.criteria.length) return;
      d.criteria.splice(i, 1);
      d.criteria.splice(to, 0, src);
      pageState._blank.menu = to;
      pageState._blank.touched = true;
      _blankRender('[data-action="geMoveCrit"][data-i="' + to + '"][data-dir="' + el.dataset.dir + '"]');
      return;
    }
    _blankRender();
  }

  /* Save Rubric (or Create with a touched blank open): hold the rubric on
     the form. Without a name, Save asks for one; Create names it after the
     assessment. On scored work a new rubric asks first, as any rubric change
     does; `then` runs once it is held. */
  function _blankSave(auto, then) {
    if (!pageState._blank) return false;
    var d = pageState._blank.draft;
    var name = String(d.name || '').trim();
    if (!name) {
      if (!auto) {
        var input = /** @type {any} */ (document.getElementById('af-ge-name'));
        if (input) {
          input.classList.add('is-invalid');
          input.placeholder = 'Name this rubric to save it';
          input.focus();
        }
        return false;
      }
      var title = ((document.getElementById('af-title') || /** @type {any} */ ({})).value || '').trim();
      name = _rubricNameFrom(title, 'New Rubric');
    }
    var held = structuredClone(d);
    held.name = name;
    held.style = rubricStyle(held);
    held.criteria = held.criteria.map(function (c, n) {
      return Object.assign(c, { name: String(c.name || '').trim() || 'Criterion ' + (n + 1) });
    });
    _dropBlankChecks(held);
    var hold = function () {
      pageState._startOpen = null;
      pageState._blank = null;
      _holdFormRubric(held);
      _renderRubricView();
      if (then) then();
    };
    // A rubric made on this form, opened again from Edit Rubric, is already
    // this assessment's rubric.
    var sel = /** @type {any} */ (document.getElementById('af-rubric'));
    if (sel && sel.value === held.id) hold();
    else _askBeforeScoredChange('rubric', hold);
    return true;
  }
  // A rubric named after its assessment; a title that already ends in
  // "Rubric" isn't given a second one.
  function _rubricNameFrom(title, fallback) {
    if (!title) return fallback;
    return /\brubric$/i.test(title) ? title : title + ' Rubric';
  }
  /* Create / Save Changes with a blank the teacher has written in: keep it,
     open or folded away (its tab clicked again, or another start opened).
     True while scored work asks first; `resume` runs the save again once the
     teacher changes the rubric. */
  function _commitOpenBlank(resume) {
    var mode = (document.getElementById('af-scoremode') || /** @type {any} */ ({})).value || 'proficiency';
    var written = pageState._blank && (pageState._startOpen === 'blank' ? pageState._blank.touched : _blankWritten());
    if (!(written && mode === 'proficiency')) return false;
    var asking = true;
    var held = false;
    _blankSave(true, function () {
      held = true;
      if (!asking) resume();
    });
    asking = false;
    return !held;
  }

  return {
    configure: configure,
    _blankAct: _blankAct,
    _blankCardHtml: _blankCardHtml,
    _blankInput: _blankInput,
    _blankOutside: _blankOutside,
    _blankPickerKey: _blankPickerKey,
    _blankRender: _blankRender,
    _blankSizeCells: _blankSizeCells,
    _blankState: _blankState,
    _blankWritten: _blankWritten,
    _cancelBlank: _cancelBlank,
    _commitOpenBlank: _commitOpenBlank,
    _newBlankDraft: _newBlankDraft,
    _rubricNameFrom: _rubricNameFrom,
  };
})();
