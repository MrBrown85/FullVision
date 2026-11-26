// @ts-check
/* assign-rubric-grading.js — Assignments: grading with a rubric. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignRubricGrading = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var CHECKLIST_MODE_KEY,
    _GRADER_MORE_ICON,
    _closedChecklists,
    _levelInnerHtml,
    _offerClearUndo,
    _openChecklists,
    _showFillUndo,
    _sixCriterionRowHtml,
    _sixRubricOf,
    _sixScoreNow,
    _syncTagRows,
    _tagState,
    _writeSixScore,
    fillScores,
    kbFocusCell,
    ledgerStatusHtml,
    pageState,
    render,
    rowScoreState,
    syncModRow,
    syncModRows,
    _graderStatusButtons,
    _graderUnits,
    _gradingScope,
    _returnMarkHtml,
    _returnsAfterEvent,
    _syncStatusLocks,
    _unitIds,
    _workIconHtml;
  function configure(h) {
    if ('CHECKLIST_MODE_KEY' in h) CHECKLIST_MODE_KEY = h.CHECKLIST_MODE_KEY;
    if ('_GRADER_MORE_ICON' in h) _GRADER_MORE_ICON = h._GRADER_MORE_ICON;
    if ('_closedChecklists' in h) _closedChecklists = h._closedChecklists;
    if ('_levelInnerHtml' in h) _levelInnerHtml = h._levelInnerHtml;
    if ('_offerClearUndo' in h) _offerClearUndo = h._offerClearUndo;
    if ('_openChecklists' in h) _openChecklists = h._openChecklists;
    if ('_showFillUndo' in h) _showFillUndo = h._showFillUndo;
    if ('_sixCriterionRowHtml' in h) _sixCriterionRowHtml = h._sixCriterionRowHtml;
    if ('_sixRubricOf' in h) _sixRubricOf = h._sixRubricOf;
    if ('_sixScoreNow' in h) _sixScoreNow = h._sixScoreNow;
    if ('_syncTagRows' in h) _syncTagRows = h._syncTagRows;
    if ('_tagState' in h) _tagState = h._tagState;
    if ('_writeSixScore' in h) _writeSixScore = h._writeSixScore;
    if ('fillScores' in h) fillScores = h.fillScores;
    if ('kbFocusCell' in h) kbFocusCell = h.kbFocusCell;
    if ('ledgerStatusHtml' in h) ledgerStatusHtml = h.ledgerStatusHtml;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('rowScoreState' in h) rowScoreState = h.rowScoreState;
    if ('syncModRow' in h) syncModRow = h.syncModRow;
    if ('syncModRows' in h) syncModRows = h.syncModRows;
    if ('_graderStatusButtons' in h) _graderStatusButtons = h._graderStatusButtons;
    if ('_graderUnits' in h) _graderUnits = h._graderUnits;
    if ('_gradingScope' in h) _gradingScope = h._gradingScope;
    if ('_returnMarkHtml' in h) _returnMarkHtml = h._returnMarkHtml;
    if ('_returnsAfterEvent' in h) _returnsAfterEvent = h._returnsAfterEvent;
    if ('_syncStatusLocks' in h) _syncStatusLocks = h._syncStatusLocks;
    if ('_unitIds' in h) _unitIds = h._unitIds;
    if ('_workIconHtml' in h) _workIconHtml = h._workIconHtml;
  }

  /* ── Rubric Grading ─────────────────────────────────────── */
  function getRubricCriterion(aid, critId) {
    var assess = getAssessments(pageState.activeCourse).find(function (a) {
      return a.id === aid;
    });
    if (!assess || !assess.rubricId) return null;
    var rubric = getRubricById(pageState.activeCourse, assess.rubricId);
    if (!rubric) return null;
    return rubric.criteria.find(function (c) {
      return c.id === critId;
    });
  }
  function selectRubricScore(el, value, aid, sid, critId) {
    var crit = getRubricCriterion(aid, critId);
    if (!crit) return;
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    // Missing and Excused work takes no level (isScoreLocked); 1–4 reach here by key.
    if (next && isScoreLocked(pageState.activeCourse, sid, aid)) return;
    var before = wasActive ? structuredClone(getScores(pageState.activeCourse)) : null;
    rubricCriterionScoreKeys(crit).forEach(function (tagId) {
      Grader.setLevel(pageState.activeCourse, sid, aid, tagId, next);
    });
    el.parentElement.querySelectorAll('.rsg-level').forEach(function (o) {
      o.classList.remove('active', 'mixed');
    });
    if (!wasActive) el.classList.add('active');
    syncModRow(el.closest('.rsg-criterion-row'));
    refreshSidebarGrades(sid);
    // An open checklist's hint says whether the level is the boxes' or picked.
    if (RubricChecks.hasChecks(crit) && _isChecklistOpen(aid, sid, critId))
      _refreshChecklistRow(aid, sid, critId, false);
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }
  function updateRubricRowUI(row, value) {
    row.querySelectorAll('.rsg-level').forEach(function (l) {
      l.classList.remove('active', 'mixed');
    });
    if (value > 0) {
      // The row's − | + carry the level's class too.
      var lvl = row.querySelector('.rsg-level.l' + value);
      if (lvl) lvl.classList.add('active');
    }
  }
  function fillRubricScores(aid, critId, value, scope, label) {
    var cid = pageState.activeCourse;
    var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid);
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var statuses = getAssignmentStatuses(cid);
    var selector, toastMsg;
    if (scope === 'col') {
      var crit = getRubricCriterion(aid, critId);
      if (!crit) return;
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        rubricCriterionScoreKeys(crit).forEach(function (tagId) {
          Grader.setLevel(cid, st.id, aid, tagId, value);
        });
      });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-criterion="' + critId + '"]';
      toastMsg = value ? 'Criterion filled' : 'Criterion cleared';
    } else if (scope === 'row') {
      if (!assess || !assess.rubricId) return;
      var rubric = getRubricById(cid, assess.rubricId);
      if (!rubric) return;
      var sid = critId;
      if (!statuses[sid + ':' + aid])
        rubric.criteria.forEach(function (crit) {
          rubricCriterionScoreKeys(crit).forEach(function (tagId) {
            Grader.setLevel(cid, sid, aid, tagId, value);
          });
        });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"]';
      toastMsg = value ? 'Row filled' : 'Row cleared';
    } else {
      if (!assess || !assess.rubricId) return;
      var plan = _setEveryonePlan(cid, aid);
      plan.cells.forEach(function (cell) {
        cell.keys.forEach(function (tagId) {
          Grader.setLevel(cid, cell.sid, aid, tagId, value);
        });
      });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"]';
      toastMsg = _setEveryoneCount(plan, plan.cells.length) + ' set to ' + label;
    }
    // Each row shows what it now holds, drawn from the saved scores, so a
    // skipped student or a criterion already scored keeps what it had.
    document.querySelectorAll(selector).forEach(function (row) {
      var st = rowScoreState(row);
      updateRubricRowUI(row, st.mixed ? 0 : st.level);
    });
    syncModRows('.rsg-criterion-row[data-assess="' + aid + '"]');
    students.forEach(function (st) {
      _syncTagRows(aid, st.id);
    });
    refreshSidebarGrades();
    var filled = structuredClone(getScores(cid));
    _showFillUndo(toastMsg, function () {
      Grader.undo(cid, prevScores, filled);
      render();
      refreshSidebarGrades();
    });
  }
  /* Set Everyone To (Colin, 2026-11-03, DECISIONS): only cells with no
     score yet are set, a rubric criterion at a time, and students marked
     Missing or Excused are skipped. The cells to set, and the counts the
     dialog and the toast name. */
  function _setEveryonePlan(cid, aid) {
    /** @type {any} */ var plan = { cells: [], students: 0, scored: 0, locked: 0, perStudent: 0, rubric: false };
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return plan;
    var groups;
    if (assess.rubricId) {
      var rubric = getRubricById(cid, assess.rubricId);
      if (!rubric) return plan;
      plan.rubric = true;
      groups = (rubric.criteria || []).map(rubricCriterionScoreKeys);
    } else {
      groups = scoreTagIds(assess, cid).map(function (tid) {
        return [tid];
      });
    }
    plan.perStudent = groups.length;
    var scores = getScores(cid);
    getStudents(cid).forEach(function (st) {
      if (isScoreLocked(cid, st.id, aid)) {
        plan.locked++;
        return;
      }
      var entries = scores[st.id] || [];
      var open = 0;
      groups.forEach(function (keys) {
        var scored = keys.some(function (k) {
          return isScoreEntered(
            assess,
            entries.find(function (e) {
              return e.assessmentId === aid && e.tagId === k;
            }),
          );
        });
        if (scored) plan.scored++;
        else {
          plan.cells.push({ sid: st.id, keys: keys });
          open++;
        }
      });
      if (open) plan.students++;
    });
    return plan;
  }
  // "5 students" when each student has one score to set, else "13 criteria"
  // or "13 competencies".
  function _setEveryoneCount(plan, n) {
    var words =
      plan.perStudent === 1
        ? ['student', 'students']
        : plan.rubric
          ? ['criterion', 'criteria']
          : ['competency', 'competencies'];
    return n + ' ' + words[n === 1 ? 0 : 1];
  }
  function _confirmSetEveryone(aid, value, label, fill) {
    var plan = _setEveryonePlan(pageState.activeCourse, aid);
    var n = plan.cells.length;
    var title = 'Set Everyone To ' + label;
    var skipped = plan.locked
      ? ' ' +
        (plan.locked === 1 ? '1 student is' : plan.locked + ' students are') +
        ' marked Missing or Excused and left out.'
      : '';
    if (!n) {
      showConfirm(
        title,
        'Every student already has a score or is marked Missing or Excused.',
        'OK',
        'primary',
        function () {},
      );
      return;
    }
    var what = _setEveryoneCount(plan, n);
    var message =
      plan.perStudent === 1
        ? 'Set ' + what + ' with no score yet to ' + label + '? Students already scored stay as they are.'
        : 'Set ' +
          what +
          ' with no score yet, for ' +
          (plan.students === 1 ? '1 student' : plan.students + ' students') +
          ', to ' +
          label +
          '? ' +
          (plan.rubric ? 'Criteria' : 'Competencies') +
          ' already scored stay as they are.';
    var button =
      'Set ' +
      what.replace(/ (\w)/, function (m, c) {
        return ' ' + c.toUpperCase();
      });
    showConfirm(title, message + skipped, button, 'primary', fill);
  }
  function confirmFillAll(aid, value, label) {
    _confirmSetEveryone(aid, value, label, function () {
      fillScores(aid, null, value, 'all', label);
    });
  }
  function confirmFillRubricAll(aid, value, label) {
    _confirmSetEveryone(aid, value, label, function () {
      fillRubricScores(aid, null, value, 'all', label);
    });
  }

  /* The four levels of a scoring card, in the class's Rubric Levels order
     (levelOrderFor). The `lN` / `hlN` classes and data-level stay on the
     level itself, so the 1–4 keys and the fill actions mean the same level
     wherever the button sits. */
  function _levelButtonsHtml(cid, activeClass, attrs, modLevel, mod) {
    return levelOrderFor(cid)
      .map(function (l) {
        return (
          '<div class="rsg-level l' +
          l +
          activeClass(l) +
          (modLevel && l === modLevel ? ' has-mods' : '') +
          '" ' +
          attrs(l) +
          ' role="button" tabindex="0">' +
          _levelInnerHtml(l, modLevel, mod) +
          '</div>'
        );
      })
      .join('<span class="rsg-level-sep" aria-hidden="true"></span>');
  }
  /* A single-point rubric's Proficient standard, once above the class:
     a tinted card per criterion. */
  function _singlePointStripHtml(rubric) {
    return (
      '<div class="rsg-sp-strip"><span class="rsg-sp-strip-label"><span class="grsp-dot" aria-hidden="true"></span>Proficient Standard</span>' +
      '<div class="rsg-sp-cards">' +
      (rubric.criteria || [])
        .map(function (crit) {
          return (
            '<div class="rsg-sp-card"><span class="rsg-sp-card-name">' +
            esc(crit.name || '') +
            '</span><span class="rsg-sp-card-words">' +
            esc((crit.levels && (crit.levels[3] || crit.levels['3'])) || '') +
            '</span></div>'
          );
        })
        .join('') +
      '</div></div>'
    );
  }
  /* Work On and Went Beyond under a single-point criterion's level control:
     white fields, label above, saved when they lose focus. */
  function _rsgSinglePointNotesHtml(cid, aid, sid, crit) {
    var st = getStudents(cid).find(function (x) {
      return x.id === sid;
    });
    var name = esc((crit.name || '') + (st ? ', ' + displayNameWithLast(st) : ''));
    function field(kind, label, text) {
      return (
        '<label class="rsg-sp-field is-' +
        kind +
        '"><span class="rsg-sp-label"><span class="grsp-dot" aria-hidden="true"></span>' +
        label +
        '</span><input type="text" class="rsg-sp-input" value="' +
        esc(text) +
        '" aria-label="' +
        label +
        ', ' +
        name +
        '" data-action-blur="' +
        (kind === 'work' ? 'rsgWorkOn' : 'rsgBeyond') +
        '" data-aid="' +
        aid +
        '" data-sid="' +
        sid +
        '" data-critid="' +
        crit.id +
        '"></label>'
      );
    }
    return (
      '<div class="rsg-sp-notes">' +
      field('work', 'Work On', getRubricCriterionComment(cid, sid, aid, crit)) +
      field('beyond', 'Went Beyond', getRubricCriterionBeyond(cid, sid, aid, crit)) +
      '</div>'
    );
  }
  /* ── Group work on the page (Group grading, shared/data.js) ──
     The list grades Pair and Group work one group at a time, as the dialog
     does: a block named for the group, a strip of its members (each with
     Missing | Excused | Late and a ⋯ menu with Grade Separately), and the
     grading rows of the member the group's grade is copied from. A member
     graded separately follows their group as their own block, with Graded
     Separately From and Back to Group Grade. DIBELS stays per student. */
  var _groupRows = {};

  // The students the list shows for `a`: one per group (the member its
  // grade comes from), members graded separately and students in no group,
  // in the dialog's order. Only groups with someone the search shows.
  function _groupRowStudents(cid, a, students) {
    var units = _graderUnits(cid, a);
    delete _groupRows[a.id];
    if (!units) return students;
    var shown = {};
    var byId = {};
    students.forEach(function (st) {
      shown[st.id] = true;
      byId[st.id] = st;
    });
    getStudents(cid).forEach(function (st) {
      if (!byId[st.id]) byId[st.id] = st;
    });
    var rows = {};
    var list = [];
    units.forEach(function (unit) {
      if (
        !_unitIds(unit).some(function (m) {
          return shown[m];
        })
      )
        return;
      if (unit.linked) {
        rows[unit.source] = { view: Object.assign({ label: collabGroupLabel(unit.group) }, unit) };
        list.push(byId[unit.source]);
        return;
      }
      if (unit.separateFrom) rows[unit.sid] = { separateFrom: unit.separateFrom };
      list.push(byId[unit.sid]);
    });
    _groupRows[a.id] = rows;
    return list.filter(Boolean);
  }
  function _groupRowFor(aid, sid) {
    return (_groupRows[aid] && _groupRows[aid][sid]) || null;
  }

  // html-safe: names go through esc(); ids are ours; labels are constants
  function _groupMembersStripHtml(cid, aid, view) {
    var a = _assessmentById(cid, aid);
    var byId = {};
    getStudents(cid).forEach(function (st) {
      byId[st.id] = st;
    });
    return (
      '<div class="rsg-group-members" data-stop-prop="true">' +
      view.members
        .map(function (m) {
          var st = byId[m];
          var name = esc(displayNameWithLast(st));
          if (isGradedSeparately(a, m))
            return (
              '<div class="rsg-group-member is-separate"><span class="rsg-group-member-name">' +
              name +
              '</span><span class="rsg-group-member-note">Graded Separately</span></div>'
            );
          return (
            '<div class="rsg-group-member"><span class="rsg-group-member-name">' +
            name +
            '</span><div class="grader-status rsg-status" role="group" aria-label="Status for ' +
            name +
            '">' +
            _graderStatusButtons(aid, m, getAssignmentStatus(cid, m, aid), ['NS', 'EXC', 'LATE']) +
            '</div><button type="button" class="grader-member-more" data-action="groupMemberMenu" data-aid="' +
            aid +
            '" data-sid="' +
            m +
            '" aria-label="More for ' +
            name +
            '" aria-haspopup="menu" aria-expanded="false">' +
            _GRADER_MORE_ICON +
            '</button><div class="grader-member-menu" role="menu" hidden><button type="button" role="menuitem" data-action="groupGradeSeparately" data-aid="' +
            aid +
            '" data-sid="' +
            m +
            '">Grade Separately</button></div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // html-safe: the label goes through esc(); ids are ours
  function _groupSeparateNoteHtml(aid, sid, group) {
    return (
      '<span class="rsg-separate-note">' +
      esc('Graded Separately From ' + collabGroupLabel(group)) +
      '</span><button type="button" class="grader-member-back" data-action="groupBackToGroup" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '">Back to Group Grade</button>'
    );
  }

  // A ledger row's status cell, or an empty cell on a group's row (its
  // members' statuses are in the strip under it).
  function _ledgerStatusOrNoteHtml(aid, sid, stStatus) {
    var row = _groupRowFor(aid, sid);
    return row && row.view ? '<div class="ldg-status"></div>' : ledgerStatusHtml(aid, sid, stStatus);
  }
  // Under a ledger row: a group's members, or a separated member's note.
  function _ledgerMembersHtml(cid, aid, sid) {
    var row = _groupRowFor(aid, sid);
    if (row && row.view) return _groupMembersStripHtml(cid, aid, row.view);
    if (row && row.separateFrom)
      return '<div class="rsg-group-members">' + _groupSeparateNoteHtml(aid, sid, row.separateFrom) + '</div>';
    return '';
  }

  // The strip's ⋯ menu: one open at a time; a click elsewhere closes it.
  function _closeGroupMenus(except) {
    document.querySelectorAll('.rsg-group-members .grader-member-menu').forEach(function (menu) {
      if (menu === except) return;
      /** @type {any} */ (menu).hidden = true;
      var more = /** @type {any} */ (menu.parentNode).querySelector('.grader-member-more');
      if (more) more.setAttribute('aria-expanded', 'false');
    });
  }
  function _toggleGroupMenu(btn) {
    var menu = btn.parentNode.querySelector('.grader-member-menu');
    if (!menu) return;
    _closeGroupMenus(menu);
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('button').focus();
  }

  /* The small Printed / Changed Since Printed marker beside a name, once the
     student's completed rubric has been printed (teacher/rubric-print.js). */
  function _printMarkHtml(cid, aid, sid) {
    return window.RubricPrint && RubricPrint.markHtml ? RubricPrint.markHtml(cid, aid, sid) : '';
  }
  // A level, comment or status may have changed what the sheet would show.
  function _refreshPrintMarks() {
    if (window.RubricPrint && RubricPrint.refreshMarks && pageState.activeCourse)
      RubricPrint.refreshMarks(pageState.activeCourse);
  }
  function _queuePrintMarks() {
    setTimeout(_refreshPrintMarks, 0);
  }

  /* A student's row in the whole-class grid: the name, Missing | Excused |
     Late, and the row's fill menu. */
  function _rsgStudentHeadHtml(cid, aid, st, status, fillAction) {
    var row = _groupRowFor(aid, st.id);
    return (
      '<div class="rsg-student-head">' +
      '<span class="rsg-student-name">' +
      esc(row && row.view ? row.view.label : displayNameWithLast(st)) +
      '</span>' +
      (row && row.view ? '' : _printMarkHtml(cid, aid, st.id)) +
      // Draft or Returned (S1-F2). A rubric's second grid, Competencies Not
      // in the Rubric, repeats the head: the mark is drawn once, above.
      (pageState._groupStripOff ? '' : _returnMarkHtml(cid, aid, st.id)) +
      (row && row.view
        ? ''
        : '<div class="grader-status rsg-status" role="group" aria-label="Status" data-stop-prop="true">' +
          _graderStatusButtons(aid, st.id, status, ['NS', 'EXC', 'LATE']) +
          '</div>' +
          (row && row.separateFrom ? _groupSeparateNoteHtml(aid, st.id, row.separateFrom) : '')) +
      (row && row.view ? '' : _workIconHtml(cid, aid, st)) +
      '<div class="score-row-action"><div class="row-fill-btn" data-action="toggleScoreMenu" title="Set this student\'s levels" aria-label="Set this student\'s levels">' +
      _ROW_FILL_ICON +
      '<div class="col-fill-menu" data-stop-prop="true">' +
      _rowFillOptionsHtml(cid, fillAction, aid, st.id) +
      '<div class="col-fill-option" data-action="' +
      fillAction +
      '" data-aid="' +
      aid +
      '" data-sid="' +
      st.id +
      '" data-score="0" data-scope="row"><div class="col-fill-dot" style="background:var(--surface-2);color:var(--text-3)">0</div> Clear</div>' +
      '</div></div></div>' +
      '</div>' +
      (row && row.view && !pageState._groupStripOff ? _groupMembersStripHtml(cid, aid, row.view) : '')
    );
  }
  /* The student's Overall Comment under their criteria (score.comment, the
     comment on the work; it prints on the rubric handout). One line until
     clicked, three while it holds text; it saves as the teacher types and
     when they leave it, level or not. */
  function _overallCommentFieldHtml(cid, aid, st, cls) {
    var row = _groupRowFor(aid, st.id);
    var first = row && row.view ? row.view.label : displayNameFirst(st);
    var text = getScoreComment(cid, st.id, aid);
    return (
      '<textarea class="' +
      cls +
      (text ? ' has-text' : '') +
      '" rows="1" placeholder="Add an overall comment' +
      (first ? ' for ' + esc(first) : '') +
      '" aria-label="Overall comment, ' +
      esc(displayNameWithLast(st)) +
      '" data-action-blur="rsgOverallComment" data-action-input="rsgOverallComment" data-aid="' +
      aid +
      '" data-sid="' +
      st.id +
      '">' +
      esc(text) +
      '</textarea>'
    );
  }
  function _rsgOverallCommentHtml(cid, aid, st) {
    return '<div class="rsg-overall">' + _overallCommentFieldHtml(cid, aid, st, 'rsg-overall-comment') + '</div>';
  }
  /* The one-student views' Overall Comment: a row under the tiles, cards
     or single-point rows, the same field and saving as the grid's. */
  function _graderOverallCommentHtml(cid, a, st) {
    var text = getScoreComment(cid, st.id, a.id);
    return (
      '<div class="grdt-tiles grdt-overall"><section class="grdt-crit" aria-label="Overall Comment">' +
      '<div class="grdt-note-row"><label class="grdt-note-label" for="grdt-overall-' +
      a.id +
      '">Overall Comment</label>' +
      '<textarea id="grdt-overall-' +
      a.id +
      '" class="grdt-note' +
      (text ? ' has-text' : '') +
      '" rows="1" placeholder="Add an overall comment for ' +
      esc(displayNameFirst(st)) +
      '" data-action-blur="rsgOverallComment" data-action-input="rsgOverallComment" data-aid="' +
      a.id +
      '" data-sid="' +
      st.id +
      '">' +
      esc(text) +
      '</textarea></div></section></div>'
    );
  }
  var _overallCommentTimers = {};
  function _saveOverallComment(el) {
    var key = el.dataset.sid + ':' + el.dataset.aid;
    clearTimeout(_overallCommentTimers[key]);
    delete _overallCommentTimers[key];
    var text = el.value.trim();
    el.classList.toggle('has-text', !!text);
    if (text === getScoreComment(pageState.activeCourse, el.dataset.sid, el.dataset.aid)) return;
    Grader.setOverallComment(pageState.activeCourse, el.dataset.sid, el.dataset.aid, text);
    // A comment saved off its timer follows no click: the status locks and
    // the Draft marks do (the locks followed the next key typed).
    var scope = _gradingScope(el.dataset.aid, el.dataset.sid);
    _syncStatusLocks(scope);
    _returnsAfterEvent(scope);
  }
  function _queueOverallComment(el) {
    el.classList.toggle('has-text', !!el.value.trim());
    var key = el.dataset.sid + ':' + el.dataset.aid;
    clearTimeout(_overallCommentTimers[key]);
    _overallCommentTimers[key] = setTimeout(function () {
      _saveOverallComment(el);
    }, 800);
  }
  var _ROW_FILL_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  function _rowFillOptionsHtml(cid, action, aid, sid) {
    return levelOrderFor(cid)
      .map(function (l) {
        return (
          '<div class="col-fill-option" data-action="' +
          action +
          '" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-score="' +
          l +
          '" data-scope="row"><div class="col-fill-dot" style="background:var(--score-' +
          l +
          ')">' +
          l +
          '</div> ' +
          PROF_LABELS[l] +
          '</div>'
        );
      })
      .join('');
  }

  function renderTagGrid(cid, a, tagObjs, students, scores) {
    var html = '<div class="rsg-grid">';
    var statuses = getAssignmentStatuses(cid);
    students.forEach(function (st) {
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'LATE';
      html +=
        '<div class="rsg-student' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'LATE' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        _rsgStudentHeadHtml(cid, a.id, st, stStatus, 'fillScoresAndClose') +
        '<div class="rsg-criteria">';
      tagObjs.forEach(function (tag) {
        var state = _tagState(cid, st.id, a.id, tag.id);
        var score = state.level;
        var mod = normalizeScoreMod(score, state.mod);
        html +=
          '<div class="rsg-criterion-row is-tag" data-student="' +
          st.id +
          '" data-assess="' +
          a.id +
          '" data-tag="' +
          tag.id +
          '">' +
          '<div class="rsg-criterion-side">' +
          '<div class="rsg-criterion-label" data-chip-tip-name="' +
          esc(tag.label) +
          (tag.text && tag.text !== tag.label ? '" data-name-tip-text="' + esc(tag.text) : '') +
          '"><svg class="rsg-tag-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 9.5V2.5a1 1 0 0 1 1-1h7l5 5v3"/><path d="M14.5 9.5l-5 5-4-4 5-5"/><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none"/></svg>' +
          '<span class="rsg-criterion-name">' +
          esc(tag.label) +
          '</span></div></div>' +
          '<div class="rsg-levels">' +
          _levelButtonsHtml(
            cid,
            function (l) {
              return score === l ? (state.mixed ? ' active mixed' : ' active') : '';
            },
            function (l) {
              return (
                'data-action="selectTagLevel" data-level="' +
                l +
                '" data-aid="' +
                a.id +
                '" data-sid="' +
                st.id +
                '" data-tagid="' +
                tag.id +
                '"'
              );
            },
            state.mixed ? 0 : score,
            mod,
          ) +
          '</div></div>';
      });
      html += '</div>' + _rsgOverallCommentHtml(cid, a.id, st) + '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ── Advanced Rubric checklists (plan §5, PR 8; mockup C10) ──
     A criterion row gets a Checks button ("3/8"); it opens the criterion's
     checkboxes under the row, one column under each level button. Ticking
     a box saves the tick and writes the level the boxes suggest, unless the
     teacher picked a different level by hand (RubricChecks.levelAfterTick). */
  function _isAdvancedRubric(rubric) {
    return (
      !!rubric &&
      typeof rubricStyle === 'function' &&
      rubricStyle(rubric) === 'advanced' &&
      (rubric.criteria || []).some(function (c) {
        return RubricChecks.hasChecks(c);
      })
    );
  }
  function _checklistMode() {
    try {
      return localStorage.getItem(CHECKLIST_MODE_KEY) === 'hide' ? 'hide' : 'show';
    } catch (e) {
      return 'show';
    }
  }
  function _checklistKey(aid, sid, critId) {
    return aid + ':' + sid + ':' + critId;
  }
  function _isChecklistOpen(aid, sid, critId) {
    var key = _checklistKey(aid, sid, critId);
    return _checklistMode() === 'show' ? !_closedChecklists.has(key) : _openChecklists.has(key);
  }
  function _checksButtonHtml(cid, aid, sid, crit) {
    if (!RubricChecks.hasChecks(crit)) return '';
    var count = RubricChecks.tickedCount(crit, getRubricCheckIds(cid, sid, aid));
    var open = _isChecklistOpen(aid, sid, crit.id);
    return (
      '<button type="button" class="rsg-checks-btn' +
      (open ? ' is-open' : '') +
      (count.ticked ? ' has-ticks' : '') +
      '" data-action="toggleChecklist" data-aid="' +
      aid +
      '" data-sid="' +
      sid +
      '" data-critid="' +
      crit.id +
      '" aria-expanded="' +
      open +
      '" aria-label="Checklist for ' +
      esc(crit.name) +
      ', ' +
      count.ticked +
      ' ticked" title="Checklist (K)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>' +
      // Only the ticks: teachers tick what the student showed at the level
      // they reached, never every box, so a total reads as work left undone.
      (count.ticked ? count.ticked : 'Checklist') +
      '</button>'
    );
  }
  /* The checkboxes under a criterion row, in the class's level order, with
     the level they suggest at the left. */
  /* What the ticked boxes say about a criterion's level, in the words the
     checklist and the grader both show. */
  function _checklistAdvice(crit, ticked, currentLevel) {
    var suggested = RubricChecks.suggestedLevel(crit, ticked);
    var current = Number(currentLevel) || 0;
    return {
      suggested: suggested,
      head: suggested ? 'Suggested: ' + PROF_LABELS[suggested] : 'No Level Suggested Yet',
      hint: !suggested
        ? 'Tick what you saw. A level is suggested when all of its boxes are ticked.'
        : current && current !== suggested
          ? 'You picked ' + PROF_LABELS[current] + '. Ticks keep your choice until you clear the level.'
          : // The level already matches the ticks: nothing to explain.
            '',
    };
  }
  function _checklistPanelHtml(cid, aid, sid, crit, currentLevel) {
    var ticked = getRubricCheckIds(cid, sid, aid);
    var html =
      '<div class="rsg-checklist" data-aid="' + aid + '" data-sid="' + sid + '" data-critid="' + crit.id + '">';
    levelOrderFor(cid).forEach(function (lv) {
      html +=
        '<div class="rsg-checklist-col l' +
        lv +
        (Number(currentLevel) === lv ? ' is-chosen' : '') +
        '" data-level="' +
        lv +
        '">';
      RubricChecks.checksAt(crit, lv).forEach(function (check) {
        html +=
          '<label class="rsg-check"><input type="checkbox" data-action="tickRubricCheck" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-critid="' +
          crit.id +
          '" data-checkid="' +
          check.id +
          '"' +
          (ticked.indexOf(check.id) >= 0 ? ' checked' : '') +
          '><span>' +
          esc(check.label) +
          '</span></label>';
      });
      html += '</div>';
    });
    return html + '</div>';
  }
  /* The level a criterion row shows now: the grid's rule (lowest when its
     competencies disagree). */
  function _criterionLevelNow(cid, aid, sid, crit) {
    return RubricPrint.criterionLevel(getScores(cid)[sid] || [], aid, crit).level;
  }
  function _criterionRow(aid, sid, critId) {
    return document.querySelector(
      '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"][data-criterion="' + critId + '"]',
    );
  }
  function toggleChecklist(el) {
    var aid = el.dataset.aid,
      sid = el.dataset.sid,
      critId = el.dataset.critid;
    var key = _checklistKey(aid, sid, critId);
    var open = _isChecklistOpen(aid, sid, critId);
    var set = _checklistMode() === 'show' ? _closedChecklists : _openChecklists;
    if (open === (set === _closedChecklists)) set.add(key);
    else set.delete(key);
    _refreshChecklistRow(aid, sid, critId, true);
  }
  function setChecklistMode(mode) {
    try {
      localStorage.setItem(CHECKLIST_MODE_KEY, mode === 'hide' ? 'hide' : 'show');
    } catch (e) {
      /* storage blocked: Show */
    }
    _openChecklists.clear();
    _closedChecklists.clear();
    render();
  }
  /* Redraw one criterion row after its checklist opens, closes or ticks,
     keeping keyboard focus on it. */
  function _refreshChecklistRow(aid, sid, critId, focusButton) {
    var cid = pageState.activeCourse;
    var crit = getRubricCriterion(aid, critId);
    var row = _criterionRow(aid, sid, critId);
    if (!crit || !row) return;
    var hadKb = pageState._kbFocusEl === row;
    row.outerHTML = _rubricCriterionRowHtml(cid, aid, sid, crit, getScores(cid)[sid] || [], true);
    var fresh = _criterionRow(aid, sid, critId);
    if (hadKb && fresh) kbFocusCell(fresh);
    if (focusButton && fresh) {
      var btn = /** @type {any} */ (fresh.querySelector('.rsg-checks-btn'));
      if (btn) btn.focus();
    }
  }
  function tickRubricCheck(el) {
    var cid = pageState.activeCourse;
    var aid = el.dataset.aid,
      sid = el.dataset.sid,
      critId = el.dataset.critid,
      checkId = el.dataset.checkid;
    var crit = getRubricCriterion(aid, critId);
    if (!crit) return;
    // Missing and Excused work takes no score (isScoreLocked): the box goes back.
    if (el.checked && isScoreLocked(cid, sid, aid)) {
      el.checked = false;
      return;
    }
    var before = getRubricCheckIds(cid, sid, aid);
    var after = Grader.setTick(cid, sid, aid, checkId, el.checked);
    if (_sixRubricOf(cid, aid)) {
      var nowSix = _sixScoreNow(cid, sid, aid, crit);
      var nextSix = RubricChecks.levelAfterTick(crit, nowSix, before, after);
      if (nextSix !== nowSix) {
        _writeSixScore(cid, sid, aid, crit, nextSix);
        refreshSidebarGrades(sid);
      }
      _refreshChecklistRow(aid, sid, critId, false);
      var box = document.querySelector(
        '.rsg-checklist input[data-sid="' + sid + '"][data-aid="' + aid + '"][data-checkid="' + checkId + '"]',
      );
      if (box) /** @type {any} */ (box).focus();
      return;
    }
    var current = _criterionLevelNow(cid, aid, sid, crit);
    var next = RubricChecks.levelAfterTick(crit, current, before, after);
    if (next !== current) {
      rubricCriterionScoreKeys(crit).forEach(function (tagId) {
        Grader.setLevel(cid, sid, aid, tagId, next);
      });
      var row = _criterionRow(aid, sid, critId);
      if (row) {
        updateRubricRowUI(row, next);
        syncModRow(row);
      }
      refreshSidebarGrades(sid);
    }
    _refreshChecklistRow(aid, sid, critId, false);
    var again = document.querySelector(
      '.rsg-checklist input[data-sid="' + sid + '"][data-aid="' + aid + '"][data-checkid="' + checkId + '"]',
    );
    if (again) /** @type {any} */ (again).focus();
  }

  function renderRubricGradingView(cid, a, students, scores) {
    var rubric = getRubricById(cid, a.rubricId);
    if (!rubric) return '';
    var criteria = rubric.criteria || [];
    var rubricTagIds = new Set(rubricScoredTagIds(rubric));
    var extraTagIds = (a.tagIds || []).filter(function (tid) {
      return !rubricTagIds.has(tid);
    });
    var extraTagObjs = extraTagIds
      .map(function (tid) {
        return getTagById(cid, tid);
      })
      .filter(Boolean);

    var advanced = _isAdvancedRubric(rubric);
    var single = rubricStyle(rubric) === 'single_point';
    var html = '<div class="rsg-grid' + (advanced ? ' is-advanced' : '') + (single ? ' is-single-point' : '') + '">';
    if (single) html += _singlePointStripHtml(rubric);

    var statuses = getAssignmentStatuses(cid);
    students.forEach(function (st) {
      var studentScores = scores[st.id] || [];
      var stStatus = statuses[st.id + ':' + a.id] || null;
      var disableRow = stStatus && stStatus !== 'LATE';
      html +=
        '<div class="rsg-student' +
        (disableRow ? ' has-status' : '') +
        (stStatus === 'LATE' ? ' has-late' : '') +
        '" data-status-student="' +
        st.id +
        '" data-status-assess="' +
        a.id +
        '">' +
        _rsgStudentHeadHtml(cid, a.id, st, stStatus, 'fillRubricScoresAndClose') +
        '<div class="rsg-criteria">';
      criteria.forEach(function (crit) {
        html += _rubricCriterionRowHtml(cid, a.id, st.id, crit, studentScores, advanced, single);
      });
      html += '</div>' + _rsgOverallCommentHtml(cid, a.id, st) + '</div>';
    });
    html += '</div>';

    if (extraTagObjs.length > 0) {
      html +=
        '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' +
        '<div style="font-size:0.75rem;color:var(--text-3);font-weight:600;margin-bottom:6px">Competencies Not in the Rubric</div>';
      // The group's name and members strip are drawn once, above.
      pageState._groupStripOff = true;
      try {
        html += renderTagGrid(cid, a, extraTagObjs, students, scores);
      } finally {
        pageState._groupStripOff = false;
      }
      html += '</div>';
    }
    return html;
  }

  /* One criterion for one student in the whole-class grid. On an Advanced
     rubric with its checklist open, the suggestion sits under the tools and
     a column of boxes under each level button, inside the row. */
  // html-safe: criterion names, check labels and comments through esc; levels are numbers; ids are ours
  function _rubricCriterionRowHtml(cid, aid, sid, crit, studentScores, advanced, single) {
    if (_sixRubricOf(cid, aid)) return _sixCriterionRowHtml(cid, aid, sid, crit);
    var tagMods = [];
    var tagScores = rubricCriterionScoreKeys(crit).map(function (tid) {
      var entry = studentScores.find(function (s) {
        return s.assessmentId === aid && s.tagId === tid;
      });
      if (entry && entry.score > 0) tagMods.push(normalizeScoreMod(entry.score, entry.mod));
      return entry ? entry.score : 0;
    });
    var nonZero = tagScores.filter(function (s) {
      return s > 0;
    });
    var allSame =
      nonZero.length > 0 &&
      nonZero.every(function (s) {
        return s === nonZero[0];
      });
    var displayScore = nonZero.length === 0 ? 0 : allSame ? nonZero[0] : Math.min.apply(null, nonZero);
    var isMixed = nonZero.length > 0 && !allSame;
    var critMod =
      !isMixed &&
      tagMods.every(function (m) {
        return m === tagMods[0];
      })
        ? tagMods[0] || 0
        : 0;
    var modLevel =
      isMixed ||
      tagMods.some(function (m) {
        return m !== tagMods[0];
      })
        ? 0
        : displayScore;
    var open = advanced && RubricChecks.hasChecks(crit) && _isChecklistOpen(aid, sid, crit.id);
    var advice = open ? _checklistAdvice(crit, getRubricCheckIds(cid, sid, aid), displayScore) : null;
    // A single-point criterion's comment is its Work On field.
    var commentBtn = single ? '' : CritComment.buttonHtml(aid, sid, crit);
    var note = single ? '' : getRubricCriterionComment(cid, sid, aid, crit);
    return (
      '<div class="rsg-criterion-row' +
      (open ? ' has-checklist' : '') +
      '" data-student="' +
      sid +
      '" data-assess="' +
      aid +
      '" data-criterion="' +
      crit.id +
      '">' +
      '<div class="rsg-criterion-side">' +
      '<div class="rsg-criterion-label" data-chip-tip-name="' +
      esc(crit.name) +
      '"><span class="rsg-criterion-name">' +
      esc(crit.name) +
      '</span></div>' +
      (advanced || commentBtn
        ? '<div class="rsg-crit-tools">' +
          (advanced ? '<div class="rsg-checks-cell">' + _checksButtonHtml(cid, aid, sid, crit) + '</div>' : '') +
          commentBtn +
          '</div>'
        : '') +
      (advice
        ? '<div class="rsg-checklist-advice' +
          (advice.suggested ? ' l' + advice.suggested : '') +
          '"><span class="rsg-checklist-head">' +
          esc(advice.head) +
          '</span>' +
          (advice.hint ? '<span class="rsg-checklist-hint">' + esc(advice.hint) + '</span>' : '') +
          '</div>'
        : '') +
      '</div>' +
      '<div class="rsg-criterion-main">' +
      '<div class="rsg-levels">' +
      _levelButtonsHtml(
        cid,
        function (l) {
          return displayScore === l ? (isMixed ? ' active mixed' : ' active') : '';
        },
        function (l) {
          return (
            'data-action="selectRubricScore" data-level="' +
            l +
            '" data-aid="' +
            aid +
            '" data-sid="' +
            sid +
            '" data-critid="' +
            crit.id +
            '"'
          );
        },
        modLevel,
        critMod,
      ) +
      '</div>' +
      (advanced || single ? '' : RubricWords.panelHtml(crit, levelOrderFor(cid), displayScore)) +
      CritComment.noteHtml(cid, aid, sid, crit, note) +
      (open ? _checklistPanelHtml(cid, aid, sid, crit, displayScore) : '') +
      (single ? _rsgSinglePointNotesHtml(cid, aid, sid, crit) : '') +
      '</div></div>'
    );
  }

  return {
    configure: configure,
    _checklistAdvice: _checklistAdvice,
    _checklistKey: _checklistKey,
    _checklistMode: _checklistMode,
    _checksButtonHtml: _checksButtonHtml,
    _closeGroupMenus: _closeGroupMenus,
    _criterionLevelNow: _criterionLevelNow,
    _graderOverallCommentHtml: _graderOverallCommentHtml,
    _groupRowFor: _groupRowFor,
    _groupRowStudents: _groupRowStudents,
    _groupRows: _groupRows,
    _isAdvancedRubric: _isAdvancedRubric,
    _isChecklistOpen: _isChecklistOpen,
    _ledgerMembersHtml: _ledgerMembersHtml,
    _ledgerStatusOrNoteHtml: _ledgerStatusOrNoteHtml,
    _overallCommentFieldHtml: _overallCommentFieldHtml,
    _printMarkHtml: _printMarkHtml,
    _queueOverallComment: _queueOverallComment,
    _queuePrintMarks: _queuePrintMarks,
    _refreshChecklistRow: _refreshChecklistRow,
    _rowFillOptionsHtml: _rowFillOptionsHtml,
    _saveOverallComment: _saveOverallComment,
    _setEveryoneCount: _setEveryoneCount,
    _setEveryonePlan: _setEveryonePlan,
    _toggleGroupMenu: _toggleGroupMenu,
    confirmFillAll: confirmFillAll,
    confirmFillRubricAll: confirmFillRubricAll,
    fillRubricScores: fillRubricScores,
    getRubricCriterion: getRubricCriterion,
    renderRubricGradingView: renderRubricGradingView,
    renderTagGrid: renderTagGrid,
    selectRubricScore: selectRubricScore,
    setChecklistMode: setChecklistMode,
    tickRubricCheck: tickRubricCheck,
    toggleChecklist: toggleChecklist,
    updateRubricRowUI: updateRubricRowUI,
  };
})();
