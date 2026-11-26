// @ts-check
/* assign-levels.js — Assignments: plus and minus, bulk scoring and six-point rubrics. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignLevels = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _criterionState,
    _setTagScore,
    _tagScoreKeys,
    _tagState,
    pageState,
    render,
    _checksButtonHtml,
    _isAdvancedRubric,
    _isChecklistOpen,
    _refreshChecklistRow,
    _setEveryoneCount,
    _setEveryonePlan,
    getRubricCriterion,
    updateRubricRowUI;
  function configure(h) {
    if ('_criterionState' in h) _criterionState = h._criterionState;
    if ('_setTagScore' in h) _setTagScore = h._setTagScore;
    if ('_tagScoreKeys' in h) _tagScoreKeys = h._tagScoreKeys;
    if ('_tagState' in h) _tagState = h._tagState;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_checksButtonHtml' in h) _checksButtonHtml = h._checksButtonHtml;
    if ('_isAdvancedRubric' in h) _isAdvancedRubric = h._isAdvancedRubric;
    if ('_isChecklistOpen' in h) _isChecklistOpen = h._isChecklistOpen;
    if ('_refreshChecklistRow' in h) _refreshChecklistRow = h._refreshChecklistRow;
    if ('_setEveryoneCount' in h) _setEveryoneCount = h._setEveryoneCount;
    if ('_setEveryonePlan' in h) _setEveryonePlan = h._setEveryonePlan;
    if ('getRubricCriterion' in h) getRubricCriterion = h.getRubricCriterion;
    if ('updateRubricRowUI' in h) updateRubricRowUI = h.updateRubricRowUI;
  }

  /* ── + / − on a proficiency level ───────────────────────── */
  // The level and modifier a grading row's entries share. A rubric criterion
  // whose tags disagree is mixed and takes no +/−.
  function rowScoreState(row) {
    var aid = row.dataset.assess;
    var tagIds = [];
    if (row.dataset.tag) tagIds = _tagScoreKeys(pageState.activeCourse, aid, row.dataset.tag);
    else {
      var crit = getRubricCriterion(aid, row.dataset.criterion);
      if (crit) tagIds = rubricCriterionScoreKeys(crit);
    }
    var entries = getScores(pageState.activeCourse)[row.dataset.student] || [];
    var states = [];
    tagIds.forEach(function (tid) {
      var e = entries.find(function (s) {
        return s.assessmentId === aid && s.tagId === tid;
      });
      if (e && e.score > 0) states.push({ level: e.score, mod: normalizeScoreMod(e.score, e.mod) });
    });
    var mixed = states.some(function (st) {
      return st.level !== states[0].level || st.mod !== states[0].mod;
    });
    var shared = states.length && !mixed ? states[0] : { level: 0, mod: 0 };
    return { level: shared.level, mod: shared.mod, mixed: mixed, tagIds: tagIds };
  }

  function scoreModButtonsHtml(level, mod) {
    return [-1, 1]
      .map(function (m) {
        var allowed = level > 0 && normalizeScoreMod(level, m) === m;
        return (
          '<button type="button" class="rsg-mod' +
          (level > 0 ? ' l' + level : '') +
          (allowed && mod === m ? ' active' : '') +
          '" data-action="setScoreMod" data-stop-prop="true" tabindex="-1" data-mod="' +
          m +
          '" aria-label="' +
          (m > 0 ? 'Plus' : 'Minus') +
          '" aria-pressed="' +
          (allowed && mod === m) +
          '" title="' +
          (m > 0 ? 'Plus (+)' : 'Minus (\u2212)') +
          '"' +
          (allowed ? '' : ' disabled') +
          '>' +
          scoreModSuffix(m) +
          '</button>'
        );
      })
      .join('<span class="rsg-mod-sep" aria-hidden="true"></span>');
  }

  /* A level button's contents. The chosen level carries its − | + inside
     it, as an Advanced rubric's chosen tile does; a click on the level
     around them still clears it. */
  // html-safe: level names and +/- buttons are constants for numeric levels
  function _levelInnerHtml(l, modLevel, mod) {
    if (!modLevel || l !== modLevel) return PROF_LABELS[l];
    var m = normalizeScoreMod(l, mod);
    return (
      '<span class="rsg-level-name">' +
      scoreLevelText(l, m) +
      '</span><span class="rsg-mods" role="group" aria-label="Fine-tune ' +
      PROF_LABELS[l] +
      '">' +
      scoreModButtonsHtml(l, m) +
      '</span>'
    );
  }

  function syncModRow(row) {
    if (!row) return;
    var st = rowScoreState(row);
    var modLevel = st.mixed ? 0 : st.level;
    row.querySelectorAll('.rsg-level').forEach(function (el) {
      var l = Number(el.dataset.level);
      var on = modLevel > 0 && l === modLevel && el.classList.contains('active');
      el.innerHTML = _levelInnerHtml(l, on ? modLevel : 0, st.mod);
      el.classList.toggle('has-mods', on);
    });
  }

  function syncModRows(selector) {
    document.querySelectorAll(selector).forEach(syncModRow);
  }

  function setScoreMod(el, mod) {
    var row = /** @type {any} */ (el.closest('.rsg-criterion-row'));
    if (!row) return;
    var st = rowScoreState(row);
    if (!st.level) return;
    var next = st.mod === mod ? 0 : mod;
    if (normalizeScoreMod(st.level, next) !== next) return;
    st.tagIds.forEach(function (tid) {
      Grader.setPlusMinus(pageState.activeCourse, row.dataset.student, row.dataset.assess, tid, st.level, next);
    });
    if (row.dataset.tag) _syncTagRows(row.dataset.assess, row.dataset.student);
    else syncModRow(row);
    refreshSidebarGrades(row.dataset.student);
  }

  function selectTagLevel(el, value, aid, sid, tagId) {
    // A mixed level is the lowest of disagreeing criteria: a click sets
    // them all to it rather than clearing.
    var wasActive = el.classList.contains('active') && !el.classList.contains('mixed');
    var next = wasActive ? 0 : value;
    var before = wasActive ? structuredClone(getScores(pageState.activeCourse)) : null;
    _setTagScore(pageState.activeCourse, sid, aid, tagId, next);
    _syncTagRows(aid, sid);
    refreshSidebarGrades(sid);
    if (before) _offerClearUndo(pageState.activeCourse, before);
  }

  /* A click on the chosen level clears it. A misclick is put right from the
     toast (or Cmd+Z while it is up): Undo puts back the level and its + or
     −, unless it was scored again since (Nov 3 sweep). The phone clears
     with no toast (Nov 5). */
  function _offerClearUndo(cid, before) {
    var after = structuredClone(getScores(cid));
    _showFillUndo('Score cleared', function () {
      Grader.undo(cid, before, after);
      render();
      refreshSidebarGrades();
    });
  }

  // A criterion can feed several competencies, so a level set on one
  // competency's row can change the student's other rows: redraw them all.
  function _syncTagRows(aid, sid) {
    var selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"][data-student="' + sid + '"]';
    /** @type {NodeListOf<any>} */ (document.querySelectorAll(selector)).forEach(function (row) {
      var st = _tagState(pageState.activeCourse, sid, aid, row.dataset.tag);
      updateRubricRowUI(row, st.level);
      var active = st.mixed && row.querySelector('.rsg-level.active');
      if (active) active.classList.add('mixed');
      syncModRow(row);
    });
  }

  /* ── Bulk scoring ───────────────────────────────────────── */
  function closeMenus() {
    document.querySelectorAll('.col-fill-menu').forEach(function (m) {
      m.classList.remove('open');
    });
  }
  /* The menu opens under its own row. Near the foot of the window it used
     to open upward over the row above, so one student's menu (with Clear)
     looked like the student's above (Nov 3 sweep): the page scrolls up to
     make room first, and only a window too short for it opens it above. */
  function positionMenu(trigger, menu) {
    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    var menuH = menu.offsetHeight || 180;
    menu.classList.remove('open');
    menu.style.visibility = '';
    var rect = trigger.getBoundingClientRect();
    var short = menuH + 8 - (window.innerHeight - rect.bottom);
    if (short > 0) {
      var scroller = _scrollParent(trigger);
      if (scroller) {
        scroller.scrollTop += Math.min(short, Math.max(0, rect.top - 8));
        rect = trigger.getBoundingClientRect();
      }
    }
    var spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < menuH + 4) {
      menu.style.bottom = window.innerHeight - rect.top + 4 + 'px';
      menu.style.top = 'auto';
    } else {
      menu.style.top = rect.bottom + 4 + 'px';
      menu.style.bottom = 'auto';
    }
    var menuW = 150;
    var left = rect.left + rect.width / 2 - menuW / 2;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
  }
  function _scrollParent(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement;
  }
  function toggleScoreMenu(trigger) {
    var menu = trigger.querySelector('.col-fill-menu');
    var wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) {
      positionMenu(trigger, menu);
      menu.classList.add('open');
    }
  }

  function _showFillUndo(message, undo) {
    showUndoToast(
      message,
      function () {
        pageState._fillUndoOpen = false;
        undo();
      },
      function () {
        pageState._fillUndoOpen = false;
      },
    );
    pageState._fillUndoOpen = true;
  }
  // label: the level's name, for Set Everyone To's toast (scope 'all').
  function fillScores(aid, tagId, value, scope, label) {
    var cid = pageState.activeCourse;
    var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid);
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var statuses = getAssignmentStatuses(cid);
    var selector, toastMsg;
    if (scope === 'col') {
      students.forEach(function (st) {
        if (statuses[st.id + ':' + aid]) return;
        _setTagScore(cid, st.id, aid, tagId, value);
      });
      selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"][data-tag="' + tagId + '"]';
      toastMsg = value ? 'Column filled' : 'Column cleared';
    } else if (scope === 'row') {
      if (!assess) return;
      var sid = tagId;
      if (!statuses[sid + ':' + aid])
        scoreTagIds(assess, cid).forEach(function (tid) {
          Grader.setLevel(cid, sid, aid, tid, value);
        });
      selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"][data-student="' + sid + '"]';
      toastMsg = value ? 'Row filled' : 'Row cleared';
    } else {
      if (!assess) return;
      var plan = _setEveryonePlan(cid, aid);
      plan.cells.forEach(function (cell) {
        cell.keys.forEach(function (tid) {
          Grader.setLevel(cid, cell.sid, aid, tid, value);
        });
      });
      selector = '.rsg-criterion-row.is-tag[data-assess="' + aid + '"]';
      toastMsg = _setEveryoneCount(plan, plan.cells.length) + ' set to ' + label;
    }
    // Each filled row shows its new level at once, drawn from the saved
    // scores, so a student with a status (skipped) keeps what it had.
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

  /* ── Six-Point rubrics (shared/rubric-scale.js) ──────────────
     A Six-Point criterion is scored 6 to 1 and stored as the level and ±
     the score counts as, so these read and write through the score's
     stored pair. No ± of its own: the six scores are the grain. */
  /* The assessment's rubric when it has level columns of its own
     (shared/rubric-scale.js), else null. */
  function _sixRubricOf(cid, aid) {
    if (!window.RubricScale) return null;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var rubric = assess && assess.rubricId ? getRubricById(cid, assess.rubricId) : null;
    return RubricScale.has(rubric) ? rubric : null;
  }
  // The criterion's six-point score for one student, 0 for none.
  function _sixScoreNow(cid, sid, aid, crit) {
    var state = _criterionState(cid, sid, aid, crit);
    var rubric = _sixRubricOf(cid, aid);
    return state.level && rubric ? RubricScale.fromStored(rubric, state.level, state.mod) : 0;
  }
  // Writes a six-point score (0 clears) under every key the criterion uses.
  function _writeSixScore(cid, sid, aid, crit, key) {
    var stored = key ? RubricScale.toStored(_sixRubricOf(cid, aid), key) : null;
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      Grader.setLevel(cid, sid, aid, tid, stored ? stored.level : 0, stored ? stored.mod : 0);
    });
  }
  /* What the ticks say on a Six-Point criterion, in its scores' words. */
  function _sixChecklistAdvice(rubric, crit, ticked, current) {
    var suggested = RubricChecks.suggestedLevel(crit, ticked);
    return {
      suggested: suggested,
      tone: RubricScale.tone(rubric, suggested),
      head: suggested ? 'Suggested: ' + RubricScale.label(rubric, suggested) : 'No Level Suggested Yet',
      hint: !suggested
        ? 'Tick what you saw. A level is suggested when all of its boxes are ticked.'
        : current && current !== suggested
          ? 'You picked ' + RubricScale.label(rubric, current) + '. Ticks keep your choice until you clear the level.'
          : '',
    };
  }
  // html-safe: check labels through esc; ids are ours; scores are numbers
  function _sixChecklistColsHtml(cid, rubric, crit, ticked, current, inputAttrs) {
    return RubricScale.keys(rubric, levelOrderFor(cid))
      .map(function (k) {
        return (
          '<div class="rsg-checklist-col l' +
          RubricScale.tone(rubric, k) +
          (current === k ? ' is-chosen' : '') +
          '" data-level="' +
          k +
          '" data-level-name="' +
          esc(RubricScale.label(rubric, k)) +
          '">' +
          RubricChecks.checksAt(crit, k)
            .map(function (check) {
              return (
                '<label class="rsg-check grdt-check"><input type="checkbox" ' +
                inputAttrs +
                ' data-critid="' +
                crit.id +
                '" data-checkid="' +
                check.id +
                '"' +
                (ticked.indexOf(check.id) >= 0 ? ' checked' : '') +
                '><span>' +
                esc(check.label) +
                '</span></label>'
              );
            })
            .join('') +
          '</div>'
        );
      })
      .join('');
  }
  // The six score buttons. `attrs(k)` gives each its action.
  // html-safe: score names are fixed words; attrs are ids and numbers
  function _sixButtonsHtml(cid, rubric, crit, current, cls, attrs) {
    return RubricScale.keys(rubric, levelOrderFor(cid))
      .map(function (k) {
        var on = current === k;
        var stored = RubricScale.toStored(rubric, k);
        var words = (crit.levels && (crit.levels[k] || crit.levels[String(k)])) || '';
        return (
          '<button type="button" class="' +
          cls +
          ' sp6-btn l' +
          RubricScale.tone(rubric, k) +
          (on ? ' is-on active' : '') +
          '" data-six="' +
          k +
          '" ' +
          attrs(k) +
          ' aria-pressed="' +
          on +
          '" title="' +
          esc(
            RubricScale.label(rubric, k) +
              ' (counts as ' +
              scoreLevelText(stored.level, stored.mod) +
              ')' +
              (words ? ': ' + words : ''),
          ) +
          '"><span class="sp6-num">' +
          k +
          '</span><span class="sp6-word">' +
          esc(RubricScale.name(rubric, k)) +
          '</span></button>'
        );
      })
      .join('');
  }

  /* One Six-Point criterion for one student in the whole-class grid. */
  // html-safe: names, labels and comments through esc; ids are ours
  function _sixCriterionRowHtml(cid, aid, sid, crit) {
    var rubric = _sixRubricOf(cid, aid);
    var current = _sixScoreNow(cid, sid, aid, crit);
    var hasChecks = _isAdvancedRubric(rubric) && RubricChecks.hasChecks(crit);
    var open = hasChecks && _isChecklistOpen(aid, sid, crit.id);
    var ticked = hasChecks ? getRubricCheckIds(cid, sid, aid) : [];
    var advice = open ? _sixChecklistAdvice(rubric, crit, ticked, current) : null;
    var commentBtn = CritComment.buttonHtml(aid, sid, crit);
    var note = getRubricCriterionComment(cid, sid, aid, crit);
    return (
      '<div class="rsg-criterion-row is-six' +
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
      '<div class="rsg-crit-tools">' +
      (hasChecks ? '<div class="rsg-checks-cell">' + _checksButtonHtml(cid, aid, sid, crit) + '</div>' : '') +
      commentBtn +
      '</div>' +
      (advice
        ? '<div class="rsg-checklist-advice' +
          (advice.suggested ? ' l' + advice.tone : '') +
          '"><span class="rsg-checklist-head">' +
          esc(advice.head) +
          '</span>' +
          (advice.hint ? '<span class="rsg-checklist-hint">' + esc(advice.hint) + '</span>' : '') +
          '</div>'
        : '') +
      '</div>' +
      '<div class="rsg-criterion-main">' +
      '<div class="rsg-levels sp6-levels" role="group" aria-label="Score">' +
      _sixButtonsHtml(cid, rubric, crit, current, 'rsg-level', function (k) {
        return (
          'data-action="selectSixScore" data-aid="' + aid + '" data-sid="' + sid + '" data-critid="' + crit.id + '"'
        );
      }) +
      '</div>' +
      CritComment.noteHtml(cid, aid, sid, crit, note) +
      (open
        ? '<div class="rsg-checklist" data-aid="' +
          aid +
          '" data-sid="' +
          sid +
          '" data-critid="' +
          crit.id +
          '">' +
          _sixChecklistColsHtml(
            cid,
            rubric,
            crit,
            ticked,
            current,
            'data-action="tickRubricCheck" data-aid="' + aid + '" data-sid="' + sid + '"',
          ) +
          '</div>'
        : '') +
      '</div></div>'
    );
  }
  /* Picking a score sets it; picking the chosen one again clears it. */
  function selectSixScore(aid, sid, critId, key) {
    var cid = pageState.activeCourse;
    var crit = getRubricCriterion(aid, critId);
    if (!crit || !RubricScale.isKey(_sixRubricOf(cid, aid), key)) return;
    var current = _sixScoreNow(cid, sid, aid, crit);
    var next = current === key ? 0 : key;
    if (next && isScoreLocked(cid, sid, aid)) return;
    var before = next ? null : structuredClone(getScores(cid));
    _writeSixScore(cid, sid, aid, crit, next);
    refreshSidebarGrades(sid);
    _refreshChecklistRow(aid, sid, critId, false);
    if (before) _offerClearUndo(cid, before);
  }

  return {
    configure: configure,
    _levelInnerHtml: _levelInnerHtml,
    _offerClearUndo: _offerClearUndo,
    _showFillUndo: _showFillUndo,
    _sixButtonsHtml: _sixButtonsHtml,
    _sixChecklistAdvice: _sixChecklistAdvice,
    _sixChecklistColsHtml: _sixChecklistColsHtml,
    _sixCriterionRowHtml: _sixCriterionRowHtml,
    _sixRubricOf: _sixRubricOf,
    _sixScoreNow: _sixScoreNow,
    _syncTagRows: _syncTagRows,
    _writeSixScore: _writeSixScore,
    closeMenus: closeMenus,
    fillScores: fillScores,
    rowScoreState: rowScoreState,
    selectSixScore: selectSixScore,
    selectTagLevel: selectTagLevel,
    setScoreMod: setScoreMod,
    syncModRow: syncModRow,
    syncModRows: syncModRows,
    toggleScoreMenu: toggleScoreMenu,
  };
})();
