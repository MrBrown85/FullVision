// @ts-check
/* cm-class-actions.js — Class Settings: delete, archive and duplicate. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmClassActions = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var blockChipSelect,
    blockOtherInput,
    blockPickerHtml,
    readBlockPicker,
    renderClassManager,
    state,
    _cmPhotosBeforeDelete;
  function configure(h) {
    if ('blockChipSelect' in h) blockChipSelect = h.blockChipSelect;
    if ('blockOtherInput' in h) blockOtherInput = h.blockOtherInput;
    if ('blockPickerHtml' in h) blockPickerHtml = h.blockPickerHtml;
    if ('readBlockPicker' in h) readBlockPicker = h.readBlockPicker;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmPhotosBeforeDelete' in h) _cmPhotosBeforeDelete = h._cmPhotosBeforeDelete;
  }

  /* ── CM Delete / Archive / Duplicate ────────────────────── */
  function cmToggleArchive(cid) {
    var nextArchived = !isCourseArchived(cid);
    updateCourse(cid, { archived: nextArchived });
    if (nextArchived && state._activeCourse === cid) {
      var nextActive = Object.keys(COURSES).find(function (courseId) {
        return courseId !== cid && !isCourseArchived(courseId);
      });
      if (nextActive) {
        state._activeCourse = nextActive;
        state._activeCourseChanged = true;
        setActiveCourse(nextActive);
      }
    }
    renderClassManager();
  }

  // Only archived classes can be deleted, so a class is always archived (and
  // out of every class menu) before it can go. delete_course hides it now and
  // fv_retention_cleanup erases it 30 days later.
  function cmDeleteCourse(cid) {
    var course = COURSES[cid];
    if (!course || !isCourseArchived(cid)) return;
    // Photos of student work go too (S8-F1, Colin's ruling 102).
    return _cmPhotosBeforeDelete(cid, function (who, maybe) {
      if (!COURSES[cid] || !isCourseArchived(cid)) return;
      _cmConfirmDeleteCourse(cid, COURSES[cid], maybe || Object.keys(who).length > 0);
    });
  }

  function _cmConfirmDeleteCourse(cid, course, photos) {
    showConfirm(
      'Delete Class',
      photos
        ? 'Permanently delete ' +
            course.name +
            " with all its students, assessments, scores and photos of student work? It disappears now and is erased for good after 30 days. Deleted photos can't come back."
        : 'Permanently delete ' +
            course.name +
            ' with all its students, assessments, and scores? It disappears now and is erased for good after 30 days.',
      'Delete Class',
      'danger',
      async function () {
        try {
          await deleteCourseData(cid);
        } catch (err) {
          console.error('deleteCourseData failed:', err);
          showSyncToast('Delete class failed. Try again.', 'error');
          return;
        }
        if (state._activeCourse === cid) {
          var nextActive = getActiveCourse();
          state._activeCourse = nextActive;
          if (nextActive) state._activeCourseChanged = true;
        }
        if (state.cmSelectedCourse === cid) state.cmSelectedCourse = state._activeCourse;
        renderClassManager();
      },
    );
  }

  // Duplicate Class asks which block the copy is for. With a block, the copy
  // keeps the class name ("Philosophy 12", Block B); without one it is
  // "Philosophy 12 (Copy)" as before.
  /* Everything the class holds, as one JSON file the teacher keeps.
     Restore Class from Backup (shared/backup-restore.js) reads it back.
     courseInfo and rubricChecks are in backups from Nov 2026 on. */
  function cmDownloadBackup(cid) {
    if (!COURSES[cid]) return;
    var data = {
      course: cid,
      savedAt: new Date().toISOString(),
      // "Photos of student work are not in this file." once the class's student page is on (S8-F2).
      photos: typeof FVBackupRestore !== 'undefined' ? FVBackupRestore.photosNote(cid) : undefined,
      bulletins: typeof FVBackupRestore !== 'undefined' ? FVBackupRestore.BULLETINS_NOTE : undefined,
      quizzes: typeof FVBackupRestore !== 'undefined' ? FVBackupRestore.QUIZZES_NOTE : undefined,
      courseInfo: structuredClone(COURSES[cid]),
      students: getStudents(cid),
      categories: getCategories(cid),
      assessments: getAssessments(cid),
      scores: getScores(cid),
      overrides: getOverrides(cid),
      notes: getNotes(cid),
      config: getCourseConfig(cid),
      learningMap: getLearningMap(cid),
      modules: getModules(cid),
      rubrics: getRubrics(cid),
      rubricChecks: getRubricChecks(cid),
      statuses: getAssignmentStatuses(cid),
      flags: getFlags(cid),
      goals: getGoals(cid),
      reflections: getReflections(cid),
      observations: getQuickObs(cid),
      termRatings: getTermRatings(cid),
      customTags: getCustomTags(cid),
      reportConfig: getReportConfig(cid),
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gradebook-' + cid + '-' + courseToday(cid) + '.json';
    a.click();
  }

  /* Restore Class from Backup: a backup file becomes a new class. Nothing
     in another class changes (shared/backup-restore.js). */
  // html-safe: fixed markup; the backup's class name and counts go in through esc().
  function cmRestoreBackup() {
    var focusBack = FocusBack.from(document.activeElement);
    var backup = null;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cm-restore-title');
    overlay.innerHTML =
      '<div class="confirm-card cm-restore-card">' +
      '<div class="confirm-title" id="cm-restore-title">Restore Class from Backup</div>' +
      '<div class="confirm-message">Choose a file saved by Download Class Backup. It becomes a new class with its students, competencies, assessments, scores and reports. ' +
      (typeof FVBackupRestore !== 'undefined' ? esc(FVBackupRestore.BULLETINS_NOT_IN_BACKUP) + ' ' : '') +
      (typeof FVBackupRestore !== 'undefined' ? esc(FVBackupRestore.QUIZZES_NOT_IN_BACKUP) + ' ' : '') +
      // Fixed text, said once any class takes work (S8-F2; wording approved, ruling 102).
      (typeof FVBackupRestore !== 'undefined' && FVBackupRestore.anyClassTakesWork()
        ? esc(FVBackupRestore.PHOTOS_NOT_IN_BACKUP) + ' '
        : '') +
      'Your other classes are not changed.</div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-restore-file">Backup File</label>' +
      '<input type="file" id="cm-restore-file" accept=".json,application/json"></div>' +
      '<div class="cm-restore-summary" id="cm-restore-summary" role="status"></div>' +
      '<div class="cm-field" id="cm-restore-name-field" hidden><label class="cm-label" for="cm-restore-name">Class Name</label>' +
      '<input type="text" class="cm-input" id="cm-restore-name" maxlength="120"></div>' +
      '<div class="confirm-actions">' +
      '<button class="confirm-cancel" id="cm-restore-cancel">Cancel</button>' +
      '<button class="confirm-ok primary" id="cm-restore-ok" disabled>Restore</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    var fileInput = overlay.querySelector('#cm-restore-file');
    var summary = overlay.querySelector('#cm-restore-summary');
    var nameField = overlay.querySelector('#cm-restore-name-field');
    var nameInput = overlay.querySelector('#cm-restore-name');
    var okBtn = overlay.querySelector('#cm-restore-ok');
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      focusBack();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    function plural(n, word) {
      return n + ' ' + word + (n === 1 ? '' : 's');
    }
    function showFile(text) {
      try {
        backup = FVBackupRestore.parseBackup(text);
      } catch (err) {
        backup = null;
        /** @type {any} */ (summary).textContent = err.message;
        /** @type {any} */ (nameField).hidden = true;
        /** @type {any} */ (okBtn).disabled = true;
        return;
      }
      var info = /** @type {any} */ (backup).courseInfo || {};
      var students = /** @type {any} */ (/** @type {any} */ (/** @type {any} */ (backup).students || [])).length;
      var assessments = /** @type {any} */ (/** @type {any} */ (/** @type {any} */ (backup).assessments || [])).length;
      var saved = /** @type {any} */ (backup).savedAt ? new Date(/** @type {any} */ (backup).savedAt) : null;
      var line = plural(students, 'Student') + ' · ' + plural(assessments, 'Assessment');
      if (saved && !isNaN(saved.getTime()))
        line += ' · Saved ' + saved.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      /** @type {any} */ (summary).innerHTML =
        '<div>' +
        esc(line) +
        '</div>' +
        /** @type {any} */ (
          /** @type {any} */ (backup).courseInfo
            ? ''
            : '<div class="cm-restore-note">This backup is from before November 2026 and has no class settings. Set the grade and grading style in Class Details after restoring.</div>'
        );
      /** @type {any} */ (nameInput).value = info.name || '';
      /** @type {any} */ (nameField).hidden = false;
      /** @type {any} */ (okBtn).disabled = false;
      /** @type {any} */ (nameInput).focus();
    }
    function restore() {
      if (!backup) return;
      var name = /** @type {any} */ (nameInput).value.trim() || 'Restored Class';
      var restored;
      try {
        restored = FVBackupRestore.restoreClassFromBackup(backup, { name: name });
      } catch (err) {
        console.error('Restore from backup failed:', err);
        /** @type {any} */ (summary).textContent = "This backup couldn't be restored.";
        return;
      }
      close();
      state.cmSelectedCourse = restored.cid;
      state.cmMode = 'edit';
      renderClassManager();
      showSyncToast('Restored ' + name + '.', 'success');
      restored.sent.catch(function (err) {
        console.error('import_json_restore failed:', err);
        if (window.Sentry && typeof (/** @type {any} */ (window.Sentry).captureException) === 'function')
          /** @type {any} */ (window.Sentry).captureException(err);
        if (state.cmSelectedCourse === restored.cid) state.cmSelectedCourse = getActiveCourse();
        renderClassManager();
        showSyncToast("Couldn't restore " + name + '. The backup file is unchanged; try again.', 'info');
      });
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || /** @type {any} */ (e.target).id === 'cm-restore-cancel') return close();
      if (/** @type {any} */ (e.target).id === 'cm-restore-ok') restore();
    });
    /** @type {any} */ (nameInput).addEventListener('keydown', function (e) {
      if (/** @type {any} */ (e).key === 'Enter') restore();
    });
    /** @type {any} */ (fileInput).addEventListener('change', function () {
      var file = /** @type {any} */ (fileInput).files && /** @type {any} */ (fileInput).files[0];
      if (!file) return;
      file.text().then(showFile, function () {
        showFile('');
      });
    });
    /** @type {any} */ (fileInput).focus();
  }

  function cmDuplicateCourse(sourceCid) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var focusBack = FocusBack.from(document.activeElement);
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cm-dup-title');
    overlay.innerHTML =
      '<div class="confirm-card cm-dup-card">' +
      '<div class="confirm-title" id="cm-dup-title">Duplicate ' +
      esc(courseDisplayName(src)) +
      '</div>' +
      '<div class="confirm-message">Settings, curriculum and categories are copied. Students, assessments and rubrics are not.</div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-dup-block-label">Block for the New Class</label>' +
      blockPickerHtml('cm-dup-block', '') +
      '</div>' +
      '<div class="confirm-actions">' +
      '<button class="confirm-cancel" id="cm-dup-cancel">Cancel</button>' +
      '<button class="confirm-ok primary" id="cm-dup-ok">Duplicate</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      focusBack();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || /** @type {any} */ (e.target).id === 'cm-dup-cancel') return close();
      var chip = /** @type {any} */ (e.target).closest('[data-action="cmBlockChip"]');
      if (chip) {
        e.stopPropagation();
        blockChipSelect(chip);
        return;
      }
      if (/** @type {any} */ (e.target).id === 'cm-dup-ok') {
        var block = readBlockPicker('cm-dup-block');
        close();
        _cmDuplicateCourse(sourceCid, block);
      }
    });
    overlay.addEventListener('input', function (e) {
      if (/** @type {any} */ (e.target).classList.contains('cm-block-other')) blockOtherInput(e.target);
    });
    var first = overlay.querySelector('.cm-block-picker .seg-btn');
    if (first) /** @type {any} */ (first).focus();
  }

  function _cmDuplicateCourse(sourceCid, block) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var newCourse = createCourse({
      block: block,
      name: block ? src.name : src.name + ' (Copy)',
      gradeLevel: src.gradeLevel || '',
      description: src.description || '',
      gradingSystem: src.gradingSystem || 'proficiency',
      calcMethod: src.calcMethod || 'average',
      decayWeight: src.decayWeight || 0.65,
    });
    // Reporting terms stay behind: their dates belong to one school year
    // (DECISIONS, Reporting periods 6).
    var cc = structuredClone(getCourseConfig(sourceCid));
    delete cc.reportingTerms;
    // The copy's Student Page starts off; its Return Grades choice
    // (return_grades) comes along (DECISIONS, Student page build rulings 12).
    delete cc.student_page_enabled;
    if (Object.keys(cc).length > 0) saveCourseConfig(newCourse.id, cc);
    // Categories and weights, as new rows. They go up through save_categories
    // once the class has its server id.
    var cats = getCategories(sourceCid)
      .filter(Boolean)
      .slice()
      .sort(function (a, b) {
        return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
      })
      .map(function (c, i) {
        return { id: uid(), name: c.name, weight: c.weight, displayOrder: i, calcMode: categoryCalcMode(c) };
      });
    if (cats.length) saveCategories(newCourse.id, cats);
    var srcMap = getLearningMap(sourceCid);
    if (srcMap && (srcMap.subjects?.length || srcMap.sections?.length)) {
      // Fresh local ids: the copy is new rows for the new class, not an
      // update of the source class's rows.
      var clone = withFreshLearningMapIds(srcMap);
      clone._customized = true;
      clone._version = 1;
      saveLearningMap(newCourse.id, clone);
    }
    state.cmSelectedCourse = newCourse.id;
    state.cmMode = 'edit';
    renderClassManager();
  }

  return {
    configure: configure,
    _cmDuplicateCourse: _cmDuplicateCourse,
    cmDeleteCourse: cmDeleteCourse,
    cmDownloadBackup: cmDownloadBackup,
    cmDuplicateCourse: cmDuplicateCourse,
    cmRestoreBackup: cmRestoreBackup,
    cmToggleArchive: cmToggleArchive,
  };
})();
