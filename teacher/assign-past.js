// @ts-check
/* assign-past.js — Assignments: Start From a Past Assessment. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignPast = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var AC,
    _commitOpenBlank,
    _formAssessWeight,
    _formCategoryChosen,
    _formChanges,
    _formCompetencyTagged,
    _formMaxPoints,
    _formMaxPointsOk,
    _formModeOf,
    _formResBusy,
    _markFormStart,
    _persistPendingFormRubric,
    _refreshCategoryHint,
    _refreshCountsToward,
    _refreshDueHint,
    _saveFormRes,
    _saveFormWork,
    _syncCodes,
    _syncMaxPointsPicks,
    _tickExactly,
    _useRubricInForm,
    autoSetDueDate,
    hideNewForm,
    onRubricSelect,
    pageState,
    render,
    renderAssessForm,
    setScoreMode,
    showNewForm,
    _getAssessmentCategoryId,
    loadCollabData,
    renderCollabPanel;
  function configure(h) {
    if ('AC' in h) AC = h.AC;
    if ('_commitOpenBlank' in h) _commitOpenBlank = h._commitOpenBlank;
    if ('_formAssessWeight' in h) _formAssessWeight = h._formAssessWeight;
    if ('_formCategoryChosen' in h) _formCategoryChosen = h._formCategoryChosen;
    if ('_formChanges' in h) _formChanges = h._formChanges;
    if ('_formCompetencyTagged' in h) _formCompetencyTagged = h._formCompetencyTagged;
    if ('_formMaxPoints' in h) _formMaxPoints = h._formMaxPoints;
    if ('_formMaxPointsOk' in h) _formMaxPointsOk = h._formMaxPointsOk;
    if ('_formModeOf' in h) _formModeOf = h._formModeOf;
    if ('_formResBusy' in h) _formResBusy = h._formResBusy;
    if ('_markFormStart' in h) _markFormStart = h._markFormStart;
    if ('_persistPendingFormRubric' in h) _persistPendingFormRubric = h._persistPendingFormRubric;
    if ('_refreshCategoryHint' in h) _refreshCategoryHint = h._refreshCategoryHint;
    if ('_refreshCountsToward' in h) _refreshCountsToward = h._refreshCountsToward;
    if ('_refreshDueHint' in h) _refreshDueHint = h._refreshDueHint;
    if ('_saveFormRes' in h) _saveFormRes = h._saveFormRes;
    if ('_saveFormWork' in h) _saveFormWork = h._saveFormWork;
    if ('_syncCodes' in h) _syncCodes = h._syncCodes;
    if ('_syncMaxPointsPicks' in h) _syncMaxPointsPicks = h._syncMaxPointsPicks;
    if ('_tickExactly' in h) _tickExactly = h._tickExactly;
    if ('_useRubricInForm' in h) _useRubricInForm = h._useRubricInForm;
    if ('autoSetDueDate' in h) autoSetDueDate = h.autoSetDueDate;
    if ('hideNewForm' in h) hideNewForm = h.hideNewForm;
    if ('onRubricSelect' in h) onRubricSelect = h.onRubricSelect;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('renderAssessForm' in h) renderAssessForm = h.renderAssessForm;
    if ('setScoreMode' in h) setScoreMode = h.setScoreMode;
    if ('showNewForm' in h) showNewForm = h.showNewForm;
    if ('_getAssessmentCategoryId' in h) _getAssessmentCategoryId = h._getAssessmentCategoryId;
    if ('loadCollabData' in h) loadCollabData = h.loadCollabData;
    if ('renderCollabPanel' in h) renderCollabPanel = h.renderCollabPanel;
  }

  /* ── Start From a Past Assessment (redesign PR 12) ──────────────
     A picker of the teacher's assessments in every class, this one first,
     searched by title. Picking one fills the form: title, scoring, Max
     Points, Factor, competencies (matched by name from another class, as
     copying does), Core Competencies and the rubric (from another class, a
     copy held until Create). Dates reset to today; the title is selected.
     Nothing is saved until Create Assessment. */
  function startFromPast() {
    var cid = pageState.activeCourse;
    var trigger = /** @type {any} */ (document.activeElement);
    var others = Object.keys(COURSES || {}).filter(function (id) {
      return id !== cid;
    });
    var overlay = /** @type {any} */ (document.createElement('div'));
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'af-past-title');
    // html-safe: static markup; rows are built with esc() below
    overlay.innerHTML =
      '<div class="confirm-card af-past-card">' +
      '<div class="confirm-title" id="af-past-title">Start From a Past Assessment</div>' +
      '<input class="af-input af-past-find" id="af-past-find" type="search" placeholder="Search by title" aria-label="Search by title" autocomplete="off">' +
      '<div class="af-past-list" id="af-past-list" role="listbox" aria-label="Past assessments">Loading\u2026</div>' +
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-past="cancel">Cancel</button></div>' +
      '</div>';
    var rows = [];
    var close = function () {
      overlay.remove();
      if (trigger && document.body.contains(trigger) && trigger.focus) trigger.focus();
    };
    var draw = function () {
      var list = /** @type {any} */ (overlay.querySelector('#af-past-list'));
      var q = /** @type {any} */ (overlay.querySelector('#af-past-find').value || '').trim().toLowerCase();
      var shown = rows.filter(function (r) {
        return !q || r.a.title.toLowerCase().indexOf(q) >= 0;
      });
      if (!shown.length) {
        list.textContent = rows.length ? 'No assessment matches.' : 'You have no assessments yet.';
        return;
      }
      var lastClass = null;
      // html-safe: every value goes through esc()
      list.innerHTML = shown
        .slice(0, 200)
        .map(function (r, i) {
          var head = '';
          if (r.cid !== lastClass) {
            lastClass = r.cid;
            head = '<div class="af-past-group">' + esc(r.cid === cid ? 'This Class' : r.className) + '</div>';
          }
          return (
            head +
            '<button type="button" class="af-past-row" role="option" aria-selected="false" data-past-i="' +
            r.i +
            '" data-past-key="' +
            esc(r.cid + ':' + r.a.id) +
            '"' +
            (i === 0 ? ' tabindex="0"' : ' tabindex="-1"') +
            '><span class="af-past-name">' +
            esc(r.a.title) +
            '</span><span class="af-past-meta">' +
            esc(r.meta) +
            '</span></button>'
          );
        })
        .join('');
    };
    var pick = function (r) {
      close();
      _fillFromPast(r.cid, r.a);
    };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || /** @type {any} */ (e.target).closest('[data-past="cancel"]')) return close();
      var row = /** @type {any} */ (e.target).closest('[data-past-i]');
      if (row) pick(rows[Number(row.dataset.pastI)]);
    });
    overlay.addEventListener('input', draw);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        return close();
      }
      var all = /** @type {any[]} */ (Array.from(overlay.querySelectorAll('.af-past-row')));
      var at = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = all[Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) next.focus();
      } else if (e.key === 'Enter' && /** @type {any} */ (e.target).id === 'af-past-find' && all[0]) {
        e.preventDefault();
        all[0].click();
      }
    });
    document.body.appendChild(overlay);
    /** @type {any} */ (overlay.querySelector('#af-past-find')).focus();
    // Each class's assessments appear as it loads (this one at once).
    var classes = [cid].concat(
      others.sort(function (x, y) {
        return _pastClassName(x).localeCompare(_pastClassName(y));
      }),
    );
    var byDate = function (x, y) {
      return String(y.dateAssigned || y.date || '').localeCompare(String(x.dateAssigned || x.date || ''));
    };
    var collect = function () {
      if (!document.body.contains(overlay)) return;
      rows = [];
      classes.forEach(function (id) {
        (getAssessments(id) || [])
          .slice()
          .sort(byDate)
          .forEach(function (a) {
            if (!a || !a.title) return;
            rows.push({
              i: rows.length,
              cid: id,
              a: a,
              className: _pastClassName(id),
              meta: [a.dateAssigned || a.date || '', _pastModeLabel(a)].filter(Boolean).join(' \u00b7 '),
            });
          });
      });
      var active = /** @type {any} */ (overlay.contains(document.activeElement) ? document.activeElement : null);
      var key = active && active.dataset ? active.dataset.pastKey : null;
      draw();
      if (!active) return;
      // Back to the same row if it's still listed, else the search box, so
      // Enter and Escape keep working.
      var row = key ? overlay.querySelector('[data-past-key="' + CSS.escape(key) + '"]') : null;
      /** @type {any} */ (row || overlay.querySelector('#af-past-find')).focus();
    };
    collect();
    // Other classes load once per session, one at a time.
    if (window.AssessmentCopy)
      others
        .filter(function (id) {
          return !_pastLoaded[id];
        })
        .reduce(function (chain, id) {
          return chain.then(function () {
            if (!document.body.contains(overlay)) return;
            return AssessmentCopy.loadClass(id).then(function () {
              _pastLoaded[id] = true;
              collect();
            });
          });
        }, Promise.resolve());
  }
  var _pastLoaded = {};
  function _pastClassName(id) {
    return (COURSES[id] && courseDisplayName(COURSES[id])) || 'Another Class';
  }
  function _pastModeLabel(a) {
    var m = a.scoreMode || 'proficiency';
    if (m === 'points') return (a.maxPoints || 100) + ' Points';
    if (m === 'complete') return 'Complete/Incomplete';
    if (m === 'dibels') return 'DIBELS';
    return a.rubricId ? 'Rubric' : 'Competencies';
  }

  function _fillFromPast(srcCid, a) {
    var cid = pageState.activeCourse;
    var title = /** @type {any} */ (document.getElementById('af-title'));
    if (!title) return;
    title.value = a.title || '';
    title.removeAttribute('aria-invalid');
    var mode = _formModeOf(a, srcCid);
    if (!document.querySelector('.af-scoremode-btn[data-mode="' + mode + '"]')) mode = 'proficiency';
    setScoreMode(mode);
    var mp = /** @type {any} */ (document.getElementById('af-maxpoints'));
    if (mp && mode === 'points') mp.value = a.maxPoints || 100;
    FactorField.set(document.getElementById('af-weight'), getAssessmentWeight(a));
    FactorField.setFactored(document, a.studentsSeeFactored);
    // Rubric first: it decides the competencies while it's chosen.
    _useRubricInForm('');
    var rubric = mode === 'proficiency' && a.rubricId ? getRubricById(srcCid, a.rubricId) : null;
    if (rubric && srcCid === cid) {
      _useRubricInForm(rubric.id);
    } else if (rubric && window.RubricLibrary) {
      _holdFormRubric(RubricLibrary.cloneRubric(srcCid, cid, rubric));
    } else rubric = null;
    if (!rubric) {
      var ids = srcCid === cid ? a.tagIds || [] : AssessmentCopy.mapTags(srcCid, cid, a.tagIds).ids;
      _tickExactly(ids.join(','));
    }
    var cc = a.coreCompetencyIds || [];
    document.querySelectorAll('.af-cc-chip').forEach(function (chip) {
      var on = cc.indexOf(/** @type {any} */ (chip).dataset.cc) >= 0;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
    // From this class, its Category, Module and Description too (their ids
    // mean nothing in another class).
    if (srcCid === cid) {
      var pick = function (id, v) {
        var el = /** @type {any} */ (document.getElementById(id));
        if (el && v && el.querySelector('option[value="' + CSS.escape(v) + '"]')) el.value = v;
      };
      pick('af-category', _getAssessmentCategoryId(a));
      pick('af-module', a.moduleId || '');
      var desc = /** @type {any} */ (document.getElementById('af-desc'));
      if (desc && a.description) desc.value = a.description;
      _refreshCategoryHint();
    }
    var assigned = /** @type {any} */ (document.getElementById('af-date-assigned'));
    if (assigned) assigned.value = courseToday(cid);
    autoSetDueDate();
    _refreshCountsToward();
    title.focus();
    title.select();
  }

  /* Hold a rubric made for this form (saved only on Create, PR 8) and
     choose it. */
  function _holdFormRubric(held) {
    // A chosen rubric closes whichever start was open.
    pageState._startOpen = null;
    pageState._blank = null;
    pageState._pendingFormRubric = held;
    var dd = /** @type {any} */ (document.getElementById('af-rubric'));
    if (dd) {
      var opt = /** @type {any} */ (dd.querySelector('option[value="' + held.id + '"]'));
      if (!opt) {
        opt = document.createElement('option');
        opt.value = held.id;
        dd.appendChild(opt);
      }
      opt.textContent = held.name + ' (' + held.criteria.length + ' criteria)';
      dd.value = held.id;
    }
    onRubricSelect(held.id);
  }

  /* Create and Add Another keeps what a run of similar work shares: Classes
     (remembered as always), Module, Scoring, Max Points, Factor and dates.
     Not the Category, title, competencies or rubric. */
  function _formKeepForNext() {
    var val = function (id) {
      return (document.getElementById(id) || /** @type {any} */ ({})).value || '';
    };
    return {
      module: val('af-module'),
      mode: val('af-scoremode') || 'proficiency',
      maxPoints: val('af-maxpoints'),
      weight: String(_formAssessWeight()),
      assigned: val('af-date-assigned'),
      due: val('af-due'),
    };
  }
  function _reopenWith(keep) {
    showNewForm();
    var set = function (id, v) {
      var el = /** @type {any} */ (document.getElementById(id));
      if (!el || !v) return;
      if (el.tagName === 'SELECT' && !el.querySelector('option[value="' + CSS.escape(v) + '"]')) return;
      el.value = v;
    };
    set('af-module', keep.module);
    set('af-maxpoints', keep.maxPoints);
    _syncMaxPointsPicks();
    FactorField.set(document.getElementById('af-weight'), keep.weight);
    set('af-date-assigned', keep.assigned);
    set('af-due', keep.due);
    var assignedEl = /** @type {any} */ (document.getElementById('af-date-assigned'));
    if (assignedEl) assignedEl.dataset.was = assignedEl.value;
    _refreshDueHint();
    if (
      keep.mode &&
      keep.mode !== 'proficiency' &&
      document.querySelector('.af-scoremode-btn[data-mode="' + keep.mode + '"]')
    )
      setScoreMode(keep.mode);
    _refreshCountsToward();
    _markFormStart();
    var title = document.getElementById('af-title');
    if (title) title.focus({ preventScroll: true });
  }

  function editAssess(aid) {
    var cid = pageState.activeCourse;
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    if (!assess) return;
    AC.collaboration = assess.collaboration || 'individual';
    loadCollabData(assess);
    pageState._showingNewForm = true;
    pageState._editingAssessId = aid;
    var form = document.getElementById('new-assess-form');
    if (form) {
      form.style.display = 'block';
      form.innerHTML = renderAssessForm(cid, assess);
      form.scrollIntoView({ behavior: 'smooth' });
      renderCollabPanel();
      _refreshCountsToward();
      _syncCodes();
      _markFormStart();
      if (window.AssessmentCopy) AssessmentCopy.markExistingCopies(cid, assess);
    }
  }

  function saveEditAssess(aid) {
    if (_formResBusy()) return;
    var titleEl = /** @type {any} */ (document.getElementById('af-title'));
    var title = (titleEl ? titleEl.value : '').trim();
    if (!title) {
      if (titleEl) {
        titleEl.setAttribute('aria-invalid', 'true');
        titleEl.placeholder = 'Title is required';
        titleEl.focus();
      }
      return;
    }
    if (!_formCategoryChosen()) return;
    // Everything is checked before anything is written: a stopped save
    // leaves the stored assessment as it was.
    if (window.QuizBuilder && !QuizBuilder.formOk()) return;
    if (!_formMaxPointsOk()) return;
    // Older untagged work saves as it was; a change to its scoring or its
    // competencies needs one tagged.
    var compChange = _formChanges().some(function (k) {
      return k === 'mode' || k === 'tags';
    });
    if (compChange && !_formCompetencyTagged()) return;
    if (
      _commitOpenBlank(function () {
        saveEditAssess(aid);
      })
    )
      return;
    if (
      _persistPendingFormRubric(function () {
        saveEditAssess(aid);
      })
    )
      return;
    var assessments = getAssessments(pageState.activeCourse);
    var idx = assessments.findIndex(function (a) {
      return a.id === aid;
    });
    if (idx < 0) return;
    var before = structuredClone(assessments[idx]);
    // Only the fields the teacher changed are written; the rest keep their
    // stored value, so Save Changes with no edits changes nothing.
    var changes = _formChanges();
    var changed = function (k) {
      return !pageState._formStart || changes.indexOf(k) >= 0;
    };
    var val = function (id) {
      return (document.getElementById(id) || /** @type {any} */ ({})).value || '';
    };
    var next = structuredClone(before);
    if (changed('title')) next.title = title;
    if (changed('assigned')) {
      var dateAssigned = val('af-date-assigned') || courseToday(pageState.activeCourse);
      next.date = dateAssigned;
      next.dateAssigned = dateAssigned;
    }
    if (changed('desc')) next.description = val('af-desc').trim();
    if (changed('tags'))
      next.tagIds = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
        return /** @type {any} */ (cb).value;
      });
    if (changed('evidence')) next.evidenceType = val('af-evidence');
    if (changed('category')) {
      next.categoryId = val('af-category') || undefined;
      next.category_id = val('af-category') || undefined;
    }
    if (changed('due')) next.dueDate = val('af-due') || undefined;
    if (changed('module')) next.moduleId = val('af-module') || undefined;
    var scoreModeVal = val('af-scoremode') || 'proficiency';
    if (changed('rubric') || changed('mode'))
      next.rubricId = scoreModeVal === 'proficiency' ? val('af-rubric') || undefined : undefined;
    if (changed('cc')) {
      var ccIds = Array.from(document.querySelectorAll('.af-cc-chip.active')).map(function (el) {
        return /** @type {any} */ (el).dataset.cc;
      });
      next.coreCompetencyIds = ccIds.length > 0 ? ccIds : undefined;
    }
    if (changed('collab')) {
      next.collaboration = pageState.newCollaboration !== 'individual' ? pageState.newCollaboration : undefined;
      next.excludedStudents = pageState.collabExcluded.size > 0 ? Array.from(pageState.collabExcluded) : undefined;
      next.pairs =
        pageState.newCollaboration === 'pair' && pageState.collabPairs.length > 0 ? pageState.collabPairs : undefined;
      next.groups =
        pageState.newCollaboration === 'group' && pageState.collabGroups.length > 0
          ? pageState.collabGroups
          : undefined;
      next.groupCount = pageState.newCollaboration === 'group' ? pageState.collabGroupCount : undefined;
    }
    if (changed('mode') || changed('maxPoints')) {
      if (scoreModeVal === 'points') {
        next.scoreMode = 'points';
        next.maxPoints = _formMaxPoints();
      } else if (scoreModeVal === 'complete') {
        next.scoreMode = 'complete';
        next.maxPoints = COMPLETE_MAX_POINTS;
      } else if (scoreModeVal === 'dibels') {
        next.scoreMode = 'dibels';
        next.maxPoints = undefined;
      } else {
        next.scoreMode = undefined;
        next.maxPoints = undefined;
      }
    }
    if (changed('weight')) {
      var assessWeight = _formAssessWeight();
      next.weight = assessWeight !== 1 ? assessWeight : undefined;
    }
    if (changed('factored')) next.studentsSeeFactored = FactorField.factoredOn(document) || undefined;
    if (AssignDraft.assigning === aid && next.isDraft) AssignDraft.assignInto(pageState.activeCourse, next);
    // A change that moves grades asks first (grade-change.js).
    if (
      GradeChange.askFirst(pageState.activeCourse, before, next, function () {
        saveEditAssess(aid);
      })
    )
      return;
    var edited = JSON.stringify(next) !== JSON.stringify(before);
    if (edited) next.successCriteria = undefined;
    // Read before hideNewForm()/render() replace the form.
    var copyTargets = window.AssessmentCopy ? AssessmentCopy.readTargets(pageState.activeCourse) : [];
    if (copyTargets.length && !next.copyGroup) next.copyGroup = AssessmentCopy.newCopyGroup();
    if (!edited && !copyTargets.length) {
      // Only the Student Work card or Handouts and Links changed, or nothing: they are kept apart.
      _saveFormWork(pageState.activeCourse, aid, pageState._formWork);
      if (window.QuizBuilder) QuizBuilder.save(pageState.activeCourse, aid);
      _saveFormRes(pageState.activeCourse, aid, pageState._formRes);
      hideNewForm();
      render();
      return;
    }
    // Written back in place now that the save goes ahead.
    var cur = assessments[idx];
    Object.keys(cur).forEach(function (k) {
      if (!(k in next)) delete cur[k];
    });
    Object.assign(cur, next);
    var after = structuredClone(cur);
    var formWork = pageState._formWork;
    var formRes = pageState._formRes;
    var srcCid = pageState.activeCourse;
    saveAssessments(pageState.activeCourse, assessments);
    _saveFormWork(pageState.activeCourse, aid, formWork);
    if (window.QuizBuilder) QuizBuilder.save(pageState.activeCourse, aid);
    _saveFormRes(pageState.activeCourse, aid, formRes);
    var move = pageState._scoreMoveAfterSave;
    pageState._scoreMoveAfterSave = null;
    if (move && move.aid === aid && after.rubricId === move.rubricId)
      Grader.moveToRubric(pageState.activeCourse, aid, move);
    var carried = _carryOverallToCompetencies(pageState.activeCourse, before, after);
    pageState.openAssessIds.add(aid);
    hideNewForm();
    render();
    GradeChange.offerUndo(pageState.activeCourse, before, after, render);
    if (carried) refreshSidebarGrades();
    if (window.AssessmentCopy && (before.copyGroup || copyTargets.length)) {
      // One dialog at a time: the edit offer first, then any new copies.
      Promise.resolve(before.copyGroup ? AssessmentCopy.offerLinkedEdit(srcCid, before, after) : null)
        .then(function () {
          if (copyTargets.length) return AssessmentCopy.copyToClasses(srcCid, after, copyTargets);
        })
        .then(render);
    }
  }

  /* Work scored with one Overall level before any competency was ticked:
     once competencies are ticked that Overall no longer counts (calc.js
     drops a leftover overall), so each student's level is copied onto every
     competency the work is now scored on, unless one already has a score.
     The Overall entry stays, so unticking them all brings it back. Rubric,
     points, Complete/Incomplete and DIBELS work score their own way. */
  function _carryOverallToCompetencies(cid, before, after) {
    if (after.rubricId || isPointsScored(after) || after.scoreMode === 'dibels') return 0;
    if (!isUnlinkedTag(scoreTagIds(before, cid)[0])) return 0;
    var tagIds = scoreTagIds(after, cid);
    if (!tagIds.length || isUnlinkedTag(tagIds[0])) return 0;
    var copied = 0;
    var scores = getScores(cid);
    Object.keys(scores).forEach(function (sid) {
      var entries = scores[sid] || [];
      var overall = entries.find(function (e) {
        return e.assessmentId === after.id && isUnlinkedTag(e.tagId) && Number(e.score) > 0;
      });
      if (!overall) return;
      tagIds.forEach(function (tid) {
        var scored = entries.some(function (e) {
          return e.assessmentId === after.id && e.tagId === tid;
        });
        if (scored) return;
        Grader.carryOverall(cid, sid, after.id, tid, overall);
        copied++;
      });
    });
    return copied;
  }

  function dupeAssess(aid) {
    var cid = pageState.activeCourse;
    var assessments = getAssessments(cid);
    var orig = assessments.find(function (a) {
      return a.id === aid;
    });
    if (!orig) return;
    var dupe = structuredClone(orig);
    var id = (dupe.id = uid());
    // A duplicate in the same class is new work, not a linked copy.
    delete dupe.copyGroup;
    dupe.title = orig.title + ' (Copy)';
    dupe.created = new Date().toISOString();
    assessments.push(dupe);
    saveAssessments(cid, assessments);
    if (window.AssessmentCopy) AssessmentCopy.carryQuiz(cid, orig, cid, dupe); // its quiz too (Q7)
    pageState.openAssessIds.add(id);
    render();
  }

  /* Said only when students have sent photos for it (Colin, ruling 102):
     the photos go with the assessment. Counts students, not pages. Demo
     Mode's sample work only until S5-W1. */
  function _photosGoNote(cid, aid, maybe) {
    if (typeof getCourseSubmissions !== 'function') return '';
    var who = {};
    (getCourseSubmissions(cid).submissions || []).forEach(function (sub) {
      if (sub.assessment_id === aid && sub.files && sub.files.length) who[sub.enrollment_id] = true;
    });
    var n = Object.keys(who).length;
    // The class's work could not be read: photos may go, so it says so rather than miss them.
    if (!n && maybe) return " Any photos students sent for it are deleted too. Deleted photos can't come back.";
    if (!n) return '';
    return (
      ' The photos ' +
      n +
      (n === 1 ? ' student' : ' students') +
      " sent for it are deleted too. Deleted photos can't come back."
    );
  }

  /* A signed-in class whose work this session has not read is read first
     (readStudentWorkForDelete; Send Work off reads nothing else), then
     the dialog: if that read failed it says photos may go. At once when
     nothing needs reading. */
  function deleteAssess(aid) {
    var cid0 = pageState.activeCourse;
    var read = typeof readStudentWorkForDelete === 'function' ? readStudentWorkForDelete(cid0) : null;
    if (!read) return _confirmDeleteAssess(aid, false);
    return read.then(function (res) {
      if (pageState.activeCourse === cid0) _confirmDeleteAssess(aid, !(res && res.known));
    });
  }

  function _confirmDeleteAssess(aid, maybe) {
    var target = getAssessments(pageState.activeCourse).find(function (a) {
      return a.id === aid;
    });
    var note = window.AssessmentCopy && target ? AssessmentCopy.deleteNote(pageState.activeCourse, target) : '';
    showConfirm(
      'Delete Assessment',
      'Delete this assessment and all its scores?' + _photosGoNote(pageState.activeCourse, aid, maybe) + note,
      'Delete',
      'danger',
      function () {
        var cid = pageState.activeCourse;
        saveAssessments(
          cid,
          getAssessments(cid).filter(function (a) {
            return a.id !== aid;
          }),
        );
        var scores = getScores(cid);
        Object.keys(scores).forEach(function (sid) {
          scores[sid] = (scores[sid] || []).filter(function (s) {
            return s.assessmentId !== aid;
          });
        });
        Grader.deleteAssessmentScores(cid, aid, scores);
        var statuses = getAssignmentStatuses(cid);
        var statusChanged = false;
        Object.keys(statuses).forEach(function (k) {
          if (k.endsWith(':' + aid)) {
            delete statuses[k];
            statusChanged = true;
          }
        });
        if (statusChanged) Grader.deleteAssessmentStatuses(cid, aid, statuses);
        // P6.5: dispatch delete_observation RPC for each linked observation
        // before clearing LS. Replaces a bare saveQuickObs call that left
        // server rows orphaned with stale assignmentContext.assessmentId.
        deleteAssessmentObservations(cid, aid);
        // Its quiz goes with it (Demo Mode's store; signed in, the server's own cascade).
        if (window.QuizData) QuizData.forget(cid, aid);
        pageState.openAssessIds.delete(aid);
        pageState._collapsedIds.delete(aid);
        render();
        refreshSidebarGrades();
      },
    );
  }

  return {
    configure: configure,
    _formKeepForNext: _formKeepForNext,
    _holdFormRubric: _holdFormRubric,
    _pastClassName: _pastClassName,
    _reopenWith: _reopenWith,
    deleteAssess: deleteAssess,
    dupeAssess: dupeAssess,
    editAssess: editAssess,
    saveEditAssess: saveEditAssess,
    startFromPast: startFromPast,
  };
})();
