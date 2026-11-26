// @ts-check
/* assign-card-list.js — Assignments: drawing the list of cards. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignCardList = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var pageState,
    _checklistAdvice,
    _checklistKey,
    _completeCardHtml,
    _dibelsCardHtml,
    _dibelsGridHtml,
    _graderOverallCommentHtml,
    _graderPickHtml,
    _isAdvancedRubric,
    _isChecklistOpen,
    _levelCardsHtml,
    _pointsCardHtml,
    _singlePointHtml,
    _sixButtonsHtml,
    _sixChecklistAdvice,
    _sixChecklistColsHtml,
    renderCompletionGrid,
    renderPointsGrid,
    renderRubricGradingView,
    renderTagGrid;
  function configure(h) {
    if ('pageState' in h) pageState = h.pageState;
    if ('_checklistAdvice' in h) _checklistAdvice = h._checklistAdvice;
    if ('_checklistKey' in h) _checklistKey = h._checklistKey;
    if ('_completeCardHtml' in h) _completeCardHtml = h._completeCardHtml;
    if ('_dibelsCardHtml' in h) _dibelsCardHtml = h._dibelsCardHtml;
    if ('_dibelsGridHtml' in h) _dibelsGridHtml = h._dibelsGridHtml;
    if ('_graderOverallCommentHtml' in h) _graderOverallCommentHtml = h._graderOverallCommentHtml;
    if ('_graderPickHtml' in h) _graderPickHtml = h._graderPickHtml;
    if ('_isAdvancedRubric' in h) _isAdvancedRubric = h._isAdvancedRubric;
    if ('_isChecklistOpen' in h) _isChecklistOpen = h._isChecklistOpen;
    if ('_levelCardsHtml' in h) _levelCardsHtml = h._levelCardsHtml;
    if ('_pointsCardHtml' in h) _pointsCardHtml = h._pointsCardHtml;
    if ('_singlePointHtml' in h) _singlePointHtml = h._singlePointHtml;
    if ('_sixButtonsHtml' in h) _sixButtonsHtml = h._sixButtonsHtml;
    if ('_sixChecklistAdvice' in h) _sixChecklistAdvice = h._sixChecklistAdvice;
    if ('_sixChecklistColsHtml' in h) _sixChecklistColsHtml = h._sixChecklistColsHtml;
    if ('renderCompletionGrid' in h) renderCompletionGrid = h.renderCompletionGrid;
    if ('renderPointsGrid' in h) renderPointsGrid = h.renderPointsGrid;
    if ('renderRubricGradingView' in h) renderRubricGradingView = h.renderRubricGradingView;
    if ('renderTagGrid' in h) renderTagGrid = h.renderTagGrid;
  }

  /* ── Assessment List ────────────────────────────────────── */
  // Competencies, rubric criteria with none, or one overall score. Rubric
  // work lists the competencies its criteria feed, scored through them
  // (_tagState, _setTagScore), then any criterion that feeds none. A
  // whole-rubric competency has no row: its level is worked out from the
  // criteria, so setting it would overwrite them.
  function _scoreTagObjs(cid, a) {
    var keys = rubricCompetencyRowKeys(cid, a);
    var tagObjs = keys
      .map(function (key) {
        return scoreKeyInfo(cid, a, key);
      })
      .filter(Boolean);
    return tagObjs.length ? tagObjs : [{ id: UNLINKED_TAG_ID, label: 'Overall', text: 'Not linked to a competency' }];
  }

  /* The grading controls for one assessment, for the students given: the
     Complete/Incomplete grid, the points grid, the rubric or the
     competency grid, as the assessment is scored. */
  // html-safe: every grading builder it calls escapes names, labels and comments; levels and points are numbers
  function _graderHtml(cid, a, tagObjs, students, scores, oneStudent) {
    var one = oneStudent && students.length === 1 ? students[0] : null;
    if (isDibelsScored(a)) return one ? _dibelsCardHtml(cid, a, one) : _dibelsGridHtml(cid, a, students);
    if (isCompletionScored(a))
      return one
        ? _completeCardHtml(cid, a, one) + _graderOverallCommentHtml(cid, a, one)
        : renderCompletionGrid(cid, a, students);
    if (a.scoreMode === 'points')
      return one
        ? _pointsCardHtml(cid, a, one) + _graderOverallCommentHtml(cid, a, one)
        : renderPointsGrid(cid, a, students, scores);
    if (a.rubricId && getRubricById(cid, a.rubricId)) {
      var showRubric = pageState.rubricViewStates[a.id] !== undefined ? pageState.rubricViewStates[a.id] : true;
      var rubric = getRubricById(cid, a.rubricId);
      if (showRubric && oneStudent && students.length === 1)
        return (
          (rubricStyle(rubric) === 'single_point'
            ? _singlePointHtml(cid, a, rubric, students[0])
            : _rubricTilesHtml(cid, a, rubric, students[0], _isAdvancedRubric(rubric))) +
          _graderOverallCommentHtml(cid, a, students[0])
        );
      if (showRubric) return renderRubricGradingView(cid, a, students, scores);
    }
    if (one) return _levelCardsHtml(cid, a, tagObjs, one) + _graderOverallCommentHtml(cid, a, one);
    return renderTagGrid(cid, a, tagObjs, students, scores);
  }

  /* ── A rubric for one student: the board's compact rows ──
     Each criterion is a card (Main, MainRevised, TGroupGrade, as the
     Assignments page's rows): its name, a Checklist chip with the ticks
     and a Comment chip, Suggested at the right, and the four levels as one
     bar in the course's level order, the chosen level holding its − | +.
     Descriptors stay off the scoring grid (DECISIONS): a level's wording
     is its hover. The checklist folds under its chip, a column of boxes
     under each level; the criterion's comment (rubric_score.comment,
     printed on the graded rubric) shows under the levels, a box while the
     Comment chip is open. Clicking a level, − | + or pressing 1–4 / + / −
     on a focused card goes through _handleClick / _graderKeydown. */
  function _criterionState(cid, sid, aid, crit) {
    var entries = getScores(cid)[sid] || [];
    // A criterion is saved under one key (rubricCriterionScoreKeys), so it is never mixed.
    var tid = rubricCriterionScoreKeys(crit)[0];
    var e =
      tid &&
      entries.find(function (x) {
        return x.assessmentId === aid && x.tagId === tid;
      });
    var level = e ? Number(e.score) || 0 : 0;
    return { level: level, mod: level ? e.mod || 0 : 0, mixed: false };
  }
  // A criterion's comment box is open while the teacher writes in it.
  var _graderNotesOpen = new Set();
  var _CHECK_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>';
  var _COMMENT_ICON =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
  // html-safe: names, words, check labels and comments through esc; ids are ours; levels are numbers
  function _rubricTilesHtml(cid, a, rubric, st, advanced) {
    var order = levelOrderFor(cid);
    // A Six-Point rubric's six scores take the four levels' place (no ± of their own).
    var six = !!window.RubricScale && RubricScale.has(rubric) ? rubric : null;
    var ticked = advanced ? getRubricCheckIds(cid, st.id, a.id) : [];
    var html = '';
    (rubric.criteria || []).forEach(function (crit) {
      if (!crit) return;
      var state = _criterionState(cid, st.id, a.id, crit);
      var cur = six && state.level ? RubricScale.fromStored(six, state.level, state.mod) : state.level;
      var hasChecks = advanced && RubricChecks.hasChecks(crit);
      var advice = hasChecks
        ? six
          ? _sixChecklistAdvice(six, crit, ticked, cur)
          : _checklistAdvice(crit, ticked, state.level)
        : null;
      var open = hasChecks && _isChecklistOpen(a.id, st.id, crit.id);
      var note = getRubricCriterionComment(cid, st.id, a.id, crit);
      var noteKey = _checklistKey(a.id, st.id, crit.id);
      var writing = _graderNotesOpen.has(noteKey);
      var name = esc(crit.name || 'Criterion');
      var seg = six
        ? _sixButtonsHtml(cid, six, crit, cur, 'grdl-level', function () {
            return 'data-action="graderSix" data-critid="' + crit.id + '"';
          })
        : order
            .map(function (lv) {
              var on = state.level === lv;
              var words = (crit.levels && (crit.levels[lv] || crit.levels[String(lv)])) || '';
              var btn =
                '<button type="button" class="grdl-level' +
                (on ? ' is-on l' + lv + (state.mixed ? ' mixed' : '') : '') +
                '" data-action="graderLevel" data-critid="' +
                crit.id +
                '" data-level="' +
                lv +
                '" aria-pressed="' +
                on +
                '"' +
                (words ? ' title="' + esc(PROF_LABELS[lv] + ': ' + words) + '"' : '') +
                '>' +
                PROF_LABELS[lv] +
                '</button>';
              return on
                ? _graderPickHtml(
                    btn,
                    lv,
                    state.mixed ? 0 : state.level,
                    state.mod,
                    'data-action="graderMod" data-critid="' + crit.id + '"',
                    state.mixed,
                  )
                : btn;
            })
            .join('');
      var count = hasChecks ? RubricChecks.tickedCount(crit, ticked) : null;
      var chips =
        (hasChecks
          ? '<button type="button" class="rsg-checks-btn grdr-chip' +
            (open ? ' is-open' : '') +
            (count.ticked ? ' has-ticks' : '') +
            '" data-action="graderChecks" data-critid="' +
            crit.id +
            '" aria-expanded="' +
            open +
            '" aria-label="Checklist for ' +
            name +
            ', ' +
            count.ticked +
            ' ticked">' +
            _CHECK_ICON +
            (count.ticked ? count.ticked : 'Checklist') +
            '</button>'
          : '') +
        '<button type="button" class="rsg-crit-comment grdr-chip' +
        (note ? ' has-comment' : '') +
        (writing ? ' is-open' : '') +
        '" data-action="graderNote" data-critid="' +
        crit.id +
        '" aria-expanded="' +
        writing +
        '" aria-label="Comment on ' +
        name +
        '">' +
        _COMMENT_ICON +
        'Comment</button>';
      var checklist = '';
      if (open && six) {
        checklist =
          '<div class="rsg-checklist grdr-checklist">' +
          _sixChecklistColsHtml(cid, six, crit, ticked, cur, 'data-action="graderTick"') +
          '</div>';
      } else if (open) {
        checklist = '<div class="rsg-checklist grdr-checklist">';
        order.forEach(function (lv) {
          checklist +=
            '<div class="rsg-checklist-col l' +
            lv +
            (state.level === lv ? ' is-chosen' : '') +
            '" data-level="' +
            lv +
            '" data-level-name="' +
            PROF_LABELS[lv] +
            '">';
          RubricChecks.checksAt(crit, lv).forEach(function (check) {
            checklist +=
              '<label class="rsg-check grdt-check"><input type="checkbox" data-action="graderTick" data-critid="' +
              crit.id +
              '" data-checkid="' +
              check.id +
              '"' +
              (ticked.indexOf(check.id) >= 0 ? ' checked' : '') +
              '><span>' +
              esc(check.label) +
              '</span></label>';
          });
          checklist += '</div>';
        });
        checklist += '</div>';
      }
      var id = 'grdt-note-' + a.id + '-' + crit.id;
      var comment = writing
        ? '<textarea id="' +
          id +
          '" class="grdt-note' +
          (note ? ' has-text' : '') +
          '" rows="1" aria-label="Comment on ' +
          name +
          '" placeholder="Add a comment on ' +
          name +
          '" data-action-blur="graderCritNote" data-critid="' +
          crit.id +
          '">' +
          esc(note) +
          '</textarea>'
        : note
          ? '<button type="button" class="grdr-note" data-action="graderNote" data-critid="' +
            crit.id +
            '">' +
            _COMMENT_ICON +
            '<span>' +
            esc(note) +
            '</span></button>'
          : '';
      // On pair or group work, the line for this student alone (written on
      // the Assignments page, under the group's comment).
      var own = getRubricCriterionOwn(cid, st.id, a.id, crit);
      if (own)
        comment +=
          '<div class="rsg-crit-own-note"><b>' + esc(displayNameFirst(st) + ' Only:') + '</b> ' + esc(own) + '</div>';
      html +=
        '<section class="grdt-crit grdr-crit' +
        (six ? ' is-six' : '') +
        (open ? ' is-open' : '') +
        '" tabindex="0" data-critid="' +
        crit.id +
        '" aria-label="' +
        name +
        '">' +
        '<div class="grdr-head"><h3 class="grdt-crit-name">' +
        name +
        '</h3>' +
        chips +
        (advice && advice.suggested
          ? // A level picked by hand stays; the hover says so (nothing moves).
            '<span class="grdr-suggested l' +
            (six ? advice.tone : advice.suggested) +
            '"' +
            (advice.hint ? ' title="' + esc(advice.hint) + '"' : '') +
            '>' +
            esc(advice.head) +
            '</span>'
          : '') +
        '</div>' +
        '<div class="grdl-controls grdr-levels"><div class="grdl-seg' +
        (six ? ' sp6-levels' : '') +
        '" role="group" aria-label="' +
        (six ? 'Score' : 'Level') +
        '">' +
        seg +
        '</div></div>' +
        checklist +
        comment +
        '</section>';
    });
    return '<div class="grdt-tiles grdr-rows">' + html + '</div>';
  }

  return {
    configure: configure,
    _criterionState: _criterionState,
    _graderHtml: _graderHtml,
    _graderNotesOpen: _graderNotesOpen,
    _scoreTagObjs: _scoreTagObjs,
  };
})();
