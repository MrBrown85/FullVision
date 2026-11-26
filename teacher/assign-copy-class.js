// @ts-check
/* assign-copy-class.js — Assignments: Copy From Another Class and choosing a rubric. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCopyClass = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _blankState,
    _focusRubricCard,
    _renderRubricView,
    _rubricCodes,
    onRubricSelect,
    openStart,
    pageState,
    _askBeforeScoredChange,
    _formDialog,
    _holdFormRubric,
    _pastClassName,
    _scoredStudentCount,
    editRubricCopyForForm,
    editRubricUI;
  function configure(h) {
    if ('_blankState' in h) _blankState = h._blankState;
    if ('_focusRubricCard' in h) _focusRubricCard = h._focusRubricCard;
    if ('_renderRubricView' in h) _renderRubricView = h._renderRubricView;
    if ('_rubricCodes' in h) _rubricCodes = h._rubricCodes;
    if ('onRubricSelect' in h) onRubricSelect = h.onRubricSelect;
    if ('openStart' in h) openStart = h.openStart;
    if ('pageState' in h) pageState = h.pageState;
    if ('_askBeforeScoredChange' in h) _askBeforeScoredChange = h._askBeforeScoredChange;
    if ('_formDialog' in h) _formDialog = h._formDialog;
    if ('_holdFormRubric' in h) _holdFormRubric = h._holdFormRubric;
    if ('_pastClassName' in h) _pastClassName = h._pastClassName;
    if ('_scoredStudentCount' in h) _scoredStudentCount = h._scoredStudentCount;
    if ('editRubricCopyForForm' in h) editRubricCopyForForm = h.editRubricCopyForForm;
    if ('editRubricUI' in h) editRubricUI = h.editRubricUI;
  }

  function _copySources(cid) {
    if (!window.AssessmentCopy) return [];
    var t = AssessmentCopy.copyTargets(cid);
    return t.sameCourse.concat(t.other);
  }

  // Linked to the same curriculum: the same set of BC course codes, not empty.
  function _sameCurriculum(a, b) {
    var x = ((COURSES[a] || {}).curriculumTags || []).slice().sort().join(' ');
    var y = ((COURSES[b] || {}).curriculumTags || []).slice().sort().join(' ');
    return !!x && x === y;
  }

  function _copyLoad() {
    var from = pageState._copy.from;
    if (!from || !window.RubricLibrary) return;
    pageState._copy.loading = true;
    RubricLibrary.loadClass(from).then(function () {
      if (pageState._startOpen !== 'copy' || pageState._copy.from !== from) return;
      pageState._copy.loading = false;
      var list = getRubrics(from) || [];
      if (
        !list.some(function (r) {
          return r.id === pageState._copy.selected;
        })
      )
        pageState._copy.selected = list[0] ? list[0].id : null;
      // Keep the teacher's place: the From menu (or a row) stays focused.
      var had = document.activeElement;
      var hadId = had && had.id;
      var inCard = had && had.closest && had.closest('.af-start-card');
      _renderRubricView();
      var back = hadId ? document.getElementById(hadId) : null;
      if (!back && inCard) back = document.getElementById('af-copy-from');
      if (back) back.focus({ preventScroll: true });
    });
  }

  function _copyFromChanged(cidFrom) {
    pageState._copy = { from: cidFrom, selected: null };
    _copyLoad();
    _renderRubricView();
    var sel = document.getElementById('af-copy-from');
    if (sel) sel.focus();
  }

  // The rubric as it would arrive: without the other class's competencies
  // when the curricula differ.
  function _copyPreviewRubric(from, r) {
    if (_sameCurriculum(pageState.activeCourse, from)) return r;
    var bare = structuredClone(r);
    bare.tagIds = [];
    bare.criteria = (bare.criteria || []).map(function (c) {
      return Object.assign({}, c, { tagIds: [] });
    });
    return bare;
  }

  function _copyCardHtml(cid) {
    var from = pageState._copy.from;
    var sources = _copySources(cid);
    var same = from && _sameCurriculum(cid, from);
    var list = from && !pageState._copy.loading ? getRubrics(from) || [] : [];
    var r = pageState._copy.selected && from ? getRubricById(from, pageState._copy.selected) : null;
    var fromName = from ? _pastClassName(from) : '';
    var head =
      '<div class="af-rubric-card-head">' +
      '<span class="af-rubric-card-name">' +
      esc(r ? r.name : 'Copy From Another Class') +
      '</span><span class="af-gap"></span>' +
      '<button type="button" class="btn btn-ghost" data-action="closeStart">Close</button>' +
      '<button type="button" class="btn btn-primary" data-action="startPickUse"' +
      (r ? '' : ' disabled') +
      '>Copy and Use</button></div>';
    var rows = pageState._copy.loading
      ? '<p class="af-start-empty">Loading…</p>'
      : list.length
        ? '<div class="af-start-group">' +
          esc(list.length + (list.length === 1 ? ' rubric' : ' rubrics')) +
          '</div>' +
          list
            .map(function (x) {
              var codes = same ? _rubricCodes(from, x) : [];
              return (
                '<button type="button" class="af-start-row' +
                (x.id === pageState._copy.selected ? ' is-on' : '') +
                '" role="option" aria-selected="' +
                (x.id === pageState._copy.selected) +
                '" data-action="startPickRow" data-rid="' +
                esc(x.id) +
                '"><b>' +
                esc(x.name) +
                '</b>' +
                (codes.length ? '<span class="af-start-codes">' + esc(codes.join(' ')) + '</span>' : '') +
                '</button>'
              );
            })
            .join('')
        : '<p class="af-start-empty">' + esc(fromName + ' has no rubrics.') + '</p>';
    var body =
      '<div class="af-start-pick">' +
      '<div class="af-start-side">' +
      '<label class="af-copy-from"><span>From</span><select class="af-input" id="af-copy-from" data-action-change="copyFrom">' +
      sources
        .map(function (c) {
          return (
            '<option value="' + esc(c.id) + '"' + (c.id === from ? ' selected' : '') + '>' + esc(c.name) + '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<div class="af-start-list" role="listbox" aria-label="Rubrics">' +
      rows +
      '</div></div>' +
      '<div class="af-start-preview" tabindex="0" aria-label="Preview">' +
      // html-safe: RubricBank.gridHtml escapes every name and descriptor
      (r && window.RubricBank ? RubricBank.gridHtml(from, _copyPreviewRubric(from, r)) : '') +
      '</div></div>';
    var foot =
      '<div class="af-tag-rubric-note">' +
      esc(
        !from
          ? ''
          : same
            ? fromName + ' is linked to the same curriculum, so its competencies come with the copy.'
            : fromName +
              ' is linked to a different curriculum, so the copy brings its criteria and wording. Connect this class’s competencies with Edit Rubric after.',
      ) +
      '</div>';
    return (
      '<div class="af-rubric-card af-start-card" data-start="copy" role="region" aria-label="Copy From Another Class">' +
      head +
      body +
      foot +
      '</div>'
    );
  }

  function _copyUse() {
    var from = pageState._copy.from;
    var r = from && pageState._copy.selected ? getRubricById(from, pageState._copy.selected) : null;
    if (!r || !window.RubricLibrary) return;
    var cid = pageState.activeCourse;
    var go = function () {
      var held = RubricLibrary.cloneRubric(from, cid, r);
      if (!_sameCurriculum(cid, from)) {
        held.tagIds = [];
        held.criteria = held.criteria.map(function (c) {
          return Object.assign({}, c, { tagIds: [] });
        });
      }
      delete held.copyGroup;
      held.name = RubricLibrary.uniqueName(r.name, getRubrics(cid) || []);
      pageState._startOpen = null;
      _holdFormRubric(held);
      _renderRubricView();
    };
    // Scored work asks first, as any rubric change does, with or without a
    // rubric chosen now.
    _askBeforeScoredChange('rubric', go);
  }

  // The rubric on this class's most recent assessment (by date), for Use It Again.
  function _lastUsedRubric(cid) {
    var editingId = pageState._editingAssessId;
    var latest = getAssessments(cid)
      .filter(function (a) {
        return a && a.id !== editingId && a.rubricId && getRubricById(cid, a.rubricId);
      })
      .sort(function (a, b) {
        return String(b.dateAssigned || b.date || '').localeCompare(String(a.dateAssigned || a.date || ''));
      })[0];
    return latest ? getRubricById(cid, latest.rubricId) : null;
  }
  function rubricsListCount(cid) {
    return getRubrics(cid).length;
  }

  /* Choose a Rubric (redesign PR 7): the Rubric Bank's window in pick mode,
     suggestions from the competencies chosen. Without it, the select. */
  function chooseRubric() {
    openStart('choose');
  }
  // The form's rubric list, rebuilt when a rubric is copied in from the picker.
  function _refreshRubricOptions() {
    var dd = /** @type {any} */ (document.getElementById('af-rubric'));
    if (!dd) return;
    var keep = dd.value;
    dd.innerHTML =
      '<option value="">None</option>' +
      getRubrics(pageState.activeCourse)
        .map(function (r) {
          return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + r.criteria.length + ' criteria)</option>';
        })
        .join('');
    dd.value = keep;
  }
  function _useRubricInForm(rid, confirmed) {
    var dd = /** @type {any} */ (document.getElementById('af-rubric'));
    if (!dd) return;
    if ((dd.value || '') !== (rid || '') && confirmed !== true) {
      _askBeforeScoredChange('rubric', function () {
        _useRubricInForm(rid, true);
      });
      return;
    }
    if (rid) {
      pageState._startOpen = null;
      pageState._blank = null;
    }
    if (!rid) {
      dd.value = '';
      onRubricSelect('');
      return;
    }
    if (!dd.querySelector('option[value="' + rid + '"]')) _refreshRubricOptions();
    dd.value = rid;
    onRubricSelect(rid);
    _focusRubricCard('chooseRubric');
  }

  function cancelRubricPick() {
    var pick = document.getElementById('af-rubric-pick');
    if (pick) pick.hidden = true;
    _renderRubricView();
  }

  /* Edit Rubric from the form. A rubric made for this assessment edits in
     place; one used only here opens in the editor. One other assessments
     also use asks first: Edit a Copy for this assessment (the default,
     Colin 2026-11-02) or edit it for all of them. */
  function editRubricFromForm() {
    var sel = /** @type {any} */ (document.getElementById('af-rubric'));
    if (!sel || !sel.value) return;
    var cid = pageState.activeCourse;
    if (pageState._pendingFormRubric && pageState._pendingFormRubric.id === sel.value) {
      // A rubric made on this form is edited in place (rubric starts PR 5).
      pageState._startOpen = 'blank';
      pageState._blank = _blankState(structuredClone(pageState._pendingFormRubric), true);
      pageState._blank.focusName = true;
      _renderRubricView();
      return;
    }
    var rubric = getRubricById(cid, sel.value);
    if (!rubric) return;
    var editingId = pageState._editingAssessId;
    var others = getAssessments(cid).filter(function (a) {
      return a.rubricId === rubric.id && a.id !== editingId;
    }).length;
    if (!others) {
      editRubricUI(rubric.id);
      return;
    }
    var scored = editingId ? _scoredStudentCount(cid, editingId) : 0;
    var title = ((document.getElementById('af-title') || /**@type {*}*/ ({})).value || '').trim() || 'This Assessment';
    _formDialog(
      'Edit ' + rubric.name,
      'It is also on ' +
        others +
        (others === 1 ? ' other assessment' : ' other assessments') +
        '. Changing it changes the rubric on ' +
        (others === 1 ? 'both.' : 'all ' + (others + 1) + '.') +
        (scored
          ? ' This one has scores for ' +
            scored +
            (scored === 1 ? ' student' : ' students') +
            '. A copy takes them with it; the other assessments keep theirs.'
          : ''),
      [
        { label: 'Cancel', style: 'cancel' },
        {
          label: 'Edit All ' + (others + 1) + ' Assessments',
          style: 'secondary',
          run: function () {
            editRubricUI(rubric.id);
          },
        },
        {
          label: 'Edit a Copy for ' + title,
          style: 'primary',
          run: function () {
            editRubricCopyForForm(rubric.id);
          },
        },
      ],
    );
  }

  return {
    configure: configure,
    _copyCardHtml: _copyCardHtml,
    _copyFromChanged: _copyFromChanged,
    _copyLoad: _copyLoad,
    _copySources: _copySources,
    _copyUse: _copyUse,
    _lastUsedRubric: _lastUsedRubric,
    _useRubricInForm: _useRubricInForm,
    cancelRubricPick: cancelRubricPick,
    chooseRubric: chooseRubric,
    editRubricFromForm: editRubricFromForm,
    rubricsListCount: rubricsListCount,
  };
})();
