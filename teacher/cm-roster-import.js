// @ts-check
/* cm-roster-import.js — Class Settings: Import Roster and its Done panel. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmRosterImport = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var _cmGuardians, state, _cmJoinWords, _cmPlural, _cmRenderAndFocus, _cmTabShown, renderClassManager;
  function configure(h) {
    if ('_cmGuardians' in h) _cmGuardians = h._cmGuardians;
    if ('state' in h) state = h.state;
    if ('_cmJoinWords' in h) _cmJoinWords = h._cmJoinWords;
    if ('_cmPlural' in h) _cmPlural = h._cmPlural;
    if ('_cmRenderAndFocus' in h) _cmRenderAndFocus = h._cmRenderAndFocus;
    if ('_cmTabShown' in h) _cmTabShown = h._cmTabShown;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
  }

  /* ── Import Roster ───────────────────────────────────────────
     Board: Import Roster (canvas, Nov 11 2026). An empty class's Students
     tab is the place to drop a class list; a class with students opens a
     one-line strip from Import Roster. Choose File reads the file on this
     computer (nothing is uploaded), then:
       - a file whose every column is recognised (a MyEd class list, the
         template) goes straight to Ready to Add, with no matching;
       - any other file opens Check How Your File Was Read: FullVision's
         choice above each column's first rows, best guesses marked, and the
         rows that need a look;
       - a class with students sees What This File Will Change.
     Problems never block: a student is added with that field blank and the
     Done panel names who to fill in. A row with no name stays out until a
     name is typed. Nothing changes until the teacher adds or saves. */
  function cmImportRoster() {
    if (state.cmPendingImport || !state.cmSelectedCourse || !getStudents(state.cmSelectedCourse).length) {
      cmChooseRosterFile();
      return;
    }
    state.cmImportFormatOpen = true;
    state.cmImportError = null;
    renderClassManager();
    var choose = document.querySelector('[data-action="cmChooseRosterFile"]');
    _cmFocus(choose);
  }

  function _cmFocus(el) {
    if (el && typeof el.focus === 'function') el.focus();
  }

  function cmChooseRosterFile() {
    var el = document.getElementById('cm-csv-input');
    if (el) el.click();
  }

  function cmCloseImportFormat() {
    state.cmImportFormatOpen = false;
    state.cmImportError = null;
    renderClassManager();
    var btn = document.querySelector('[data-action="cmImportRoster"]');
    _cmFocus(btn);
  }

  var _CM_FILE_ICON =
    '<svg class="cm-import-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M12 17v-6"></path><path d="M9.5 13.5 12 11l2.5 2.5"></path></svg>';

  /* The empty class: drop the class list here, with MyEd's three steps. */
  function cmImportEmptyHtml() {
    return (
      '<div class="cm-section cm-import-empty" role="region" aria-labelledby="cm-import-empty-title">' +
      '<div class="cm-import-drop cm-import-drop-big">' +
      _CM_FILE_ICON +
      '<h2 class="cm-import-drop-title" id="cm-import-empty-title">Add Your Students</h2>' +
      '<p class="cm-import-drop-text">Drop your class list here. A class list from MyEducation BC goes in as it is, and so does any spreadsheet saved as CSV.</p>' +
      '<button type="button" class="btn btn-primary" data-action="cmChooseRosterFile">Choose File</button>' +
      '<p class="cm-hint">The file isn\'t uploaded. FullVision reads it on this computer and saves only the students you add.</p>' +
      '</div>' +
      '<div class="cm-import-side">' +
      '<div class="cm-import-side-part">' +
      '<h3>Get the List From MyEducation BC</h3>' +
      '<ol class="cm-import-steps">' +
      '<li>In MyEd, open <strong>Gradebook</strong> and choose this class.</li>' +
      '<li>Choose <strong>Roster</strong> on the left.</li>' +
      '<li>Select the printer icon, then <strong>CSV</strong>. It goes to your Downloads folder.</li>' +
      '</ol>' +
      '<a href="/help/get-a-class-list-from-myeducation-bc" data-action="openHelpArticle" data-slug="get-a-class-list-from-myeducation-bc">Show Me With Pictures</a>' +
      '</div>' +
      '<div class="cm-import-side-part">' +
      '<h3>No Class List?</h3>' +
      '<p>Start from the template: a blank spreadsheet with a column for everything FullVision keeps.</p>' +
      '<a class="cm-action-btn" href="/roster-template.csv" download="roster-template.csv">Download Template</a>' +
      '</div>' +
      '<div class="cm-import-side-part cm-import-side-row">' +
      '<span>Only a few students? Type them in.</span>' +
      '<button type="button" class="cm-action-btn cm-roster-add" data-action="cmShowAddStudent">Add Student</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* A class with students: Import Roster opens this strip. */
  function cmImportFormatHtml() {
    return (
      '<div class="cm-section cm-import-drop cm-import-strip" role="region" aria-label="Import Roster">' +
      _CM_FILE_ICON +
      '<div class="cm-import-strip-text"><strong>Drop a class list here to update this class</strong>' +
      '<span class="cm-hint">Students already here are matched by student number, so no one is added twice. You\'ll see every change before anything is saved. ' +
      '<a href="/help/get-a-class-list-from-myeducation-bc" data-action="openHelpArticle" data-slug="get-a-class-list-from-myeducation-bc">Get a Class List From MyEducation BC</a></span></div>' +
      '<a class="cm-import-link" href="/roster-template.csv" download="roster-template.csv">Download Template</a>' +
      '<button type="button" class="cm-action-btn" data-action="cmCloseImportFormat">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmChooseRosterFile">Choose File</button>' +
      '</div>'
    );
  }

  /* An Excel file, or a file with nothing in it. */
  function _cmImportErrorHtml(err) {
    var title, text, hint;
    if (err.kind === 'excel') {
      title = 'This Is an Excel File';
      text =
        '<strong>' +
        esc(err.fileName) +
        '</strong> needs to be saved as CSV first. In Excel, choose File, then Save As, and pick CSV.';
      hint = 'Downloading from MyEd? Choose CSV, not Excel, after the printer icon.';
    } else {
      title = 'This File Is Empty';
      text = '<strong>' + esc(err.fileName) + '</strong> has no rows to read.';
      hint = 'Choose the class list again, or another file.';
    }
    return (
      '<div class="cm-section cm-import-card" role="alert">' +
      '<div class="cm-import-card-head"><span class="cm-import-card-mark" aria-hidden="true">!</span><h2>' +
      title +
      '</h2></div>' +
      '<p class="cm-import-card-text">' +
      text +
      '</p><p class="cm-hint">' +
      esc(hint) +
      '</p>' +
      '<div class="cm-import-buttons"><button type="button" class="btn btn-primary" data-action="cmChooseRosterFile">Choose Another File</button>' +
      '<button type="button" class="cm-action-btn" data-action="cmCloseImportFormat">Cancel</button></div>' +
      '</div>'
    );
  }

  /* ── Import Roster: reading the file: teacher/cm-roster-file.js ── */
  var ROSTER_IMPORT_FIELDS = CmRosterFile.ROSTER_IMPORT_FIELDS;
  var ROSTER_FIELD_MENU = CmRosterFile.ROSTER_FIELD_MENU;
  var ROSTER_SKIPPED_HEADERS = CmRosterFile.ROSTER_SKIPPED_HEADERS;
  var _ROSTER_NUM_DATE = CmRosterFile._ROSTER_NUM_DATE;
  var _rosterHeaderKey = CmRosterFile._rosterHeaderKey;
  var parseRosterCsv = CmRosterFile.parseRosterCsv;
  var _rosterDate = CmRosterFile._rosterDate;
  var rosterDateOrder = CmRosterFile.rosterDateOrder;
  var _rosterCodes = CmRosterFile._rosterCodes;
  var rosterImportTable = CmRosterFile.rosterImportTable;
  var _rosterColumn = CmRosterFile._rosterColumn;
  var rosterImportReady = CmRosterFile.rosterImportReady;
  var rosterRowsFromTable = CmRosterFile.rosterRowsFromTable;

  /* ── After an import: the Done panel ────────────────────────
     It says what happened, names the students left with a blank (Show Them
     filters the roster to them), offers the next step, and marks the new
     rows New until the teacher leaves Class Settings or the class. Undo This
     Import deletes the students it added, for good: only while this panel
     is open, and only students with nothing recorded yet (no scores,
     observations, notes, goals, reflections or ratings). Renames and
     updated details stay as they are. */
  function _cmStudentIdNow(id) {
    return typeof _resolveKnownId === 'function' ? _resolveKnownId('student', id) || id : id;
  }

  function _cmImportNewIds(cid) {
    var done = state.cmImportDone;
    var ids = {};
    if (!done || done.cid !== cid || done.undone) return ids;
    done.added.forEach(function (id) {
      ids[id] = true;
      ids[_cmStudentIdNow(id)] = true;
    });
    return ids;
  }

  function _cmRosterOnlyIds() {
    if (!state.cmRosterOnly) return null;
    var ids = {};
    state.cmRosterOnly.forEach(function (id) {
      ids[id] = true;
      ids[_cmStudentIdNow(id)] = true;
    });
    return ids;
  }

  var _CM_RECORD_GETTERS = [
    'getScores',
    'getQuickObs',
    'getNotes',
    'getGoals',
    'getReflections',
    'getFlags',
    'getTermRatings',
    'getOverrides',
    'getStudentProfileSummaries',
  ];

  /* Anything recorded for this student in this class yet. */
  function _cmStudentHasWork(cid, sid) {
    var has = _CM_RECORD_GETTERS.some(function (name) {
      var get = typeof globalThis !== 'undefined' ? globalThis[name] : undefined;
      if (typeof get !== 'function') return false;
      var v = (get(cid) || {})[sid];
      if (v === undefined || v === null || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });
    if (has) return true;
    var statuses = typeof getAssignmentStatuses === 'function' ? getAssignmentStatuses(cid) || {} : {};
    return Object.keys(statuses).some(function (k) {
      return k.indexOf(sid + ':') === 0;
    });
  }

  function _cmImportDoneHtml(cid) {
    var done = state.cmImportDone;
    if (!done || done.cid !== cid) return '';
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var c = done.counts;
    var title,
      lines = '';
    if (done.undone) {
      title = 'Import Undone';
      lines =
        '<p>' +
        esc(
          _cmPlural(done.undone.removed, 'student was', 'students were') +
            ' removed.' +
            (done.undone.kept.length
              ? ' ' +
                _cmJoinWords(done.undone.kept) +
                (done.undone.kept.length === 1 ? ' stays: they already have' : ' stay: they already have') +
                ' scores or observations.'
              : ''),
        ) +
        '</p>';
    } else {
      var only = c.added && !c.renamed && !c.updated && !c.withdrawn;
      if (only) title = _cmPlural(c.added, 'Student', 'Students') + ' Added to ' + (course.name || 'This Class');
      else {
        title = 'Roster Updated';
        var said = [];
        if (c.added) said.push(c.added + ' added');
        if (c.renamed) said.push(c.renamed + ' renamed');
        if (c.updated) said.push(c.updated + ' updated');
        if (c.withdrawn) said.push(c.withdrawn + ' withdrawn');
        lines += '<p>' + esc(said.length ? said.join(', ') + '.' : 'Nothing changed.') + '</p>';
      }
      var roster = getStudents(cid);
      var here = {};
      roster.forEach(function (s) {
        here[s.id] = true;
      });
      var blanks = done.blanks.filter(function (b) {
        return here[_cmStudentIdNow(b.sid)] || here[b.sid];
      });
      if (blanks.length) {
        var who = {};
        blanks.forEach(function (b) {
          who[b.sid] = true;
        });
        var n = Object.keys(who).length;
        var detail =
          blanks.length <= 3
            ? ': ' +
              _cmJoinWords(
                blanks.map(function (b) {
                  return b.name + "'s " + b.what;
                }),
              ) +
              '.'
            : '.';
        lines +=
          '<p>' +
          esc((n === 1 ? '1 has a blank' : n + ' have a blank') + ' to fill in' + detail) +
          ' <button type="button" class="cm-import-link" data-action="cmImportShowBlanks">' +
          (state.cmRosterOnly ? 'Show All Students' : 'Show Them') +
          '</button></p>';
      }
      var next = [];
      if (_cmTabShown('student-page', cid))
        next.push(
          '<button type="button" class="cm-import-next" data-action="cmSetTab" data-tab="student-page">Print Student Cards</button>',
        );
      next.push(
        '<button type="button" class="cm-import-next" data-action="cmSetTab" data-tab="grading">Set Up Grading</button>',
      );
      lines += '<div class="cm-import-next-row"><span class="cm-hint">Next:</span>' + next.join('') + '</div>';
    }
    return (
      '<div class="cm-section cm-import-done" role="region" aria-labelledby="cm-import-done-title">' +
      '<span class="cm-import-band-mark" aria-hidden="true">✓</span>' +
      '<div class="cm-import-done-body"><h2 id="cm-import-done-title" tabindex="-1">' +
      esc(title) +
      '</h2>' +
      lines +
      '</div>' +
      '<div class="cm-import-done-actions">' +
      (!done.undone && done.added.length
        ? '<button type="button" class="cm-import-link" data-action="cmUndoImport">Undo This Import</button>'
        : '') +
      '<button type="button" class="cm-import-close" data-action="cmCloseImportDone" aria-label="Close">×</button>' +
      '</div></div>'
    );
  }

  function cmImportShowBlanks() {
    var done = state.cmImportDone;
    if (!done) return;
    state.cmRosterOnly = state.cmRosterOnly
      ? null
      : done.blanks.map(function (b) {
          return b.sid;
        });
    _cmRenderAndFocus('[data-action="cmImportShowBlanks"]');
  }

  function cmCloseImportDone() {
    state.cmImportDone = null;
    state.cmRosterOnly = null;
    renderClassManager();
    var btn = document.querySelector('[data-action="cmImportRoster"]');
    _cmFocus(btn);
  }

  /* Delete the students this import added, for good, unless something has
     been recorded for them. Renames and details stay. */
  function cmUndoImport() {
    var done = state.cmImportDone;
    var cid = state.cmSelectedCourse;
    if (!done || done.cid !== cid || done.undone) return;
    var removed = 0;
    var kept = [];
    done.added.forEach(function (id) {
      var sid = _cmStudentIdNow(id);
      var st = getStudents(cid).find(function (s) {
        return s.id === sid || s.id === id;
      });
      if (!st) return;
      if (_cmStudentHasWork(cid, st.id)) {
        kept.push(fullName(st));
        return;
      }
      if (withdrawStudent(cid, st.id) && deleteWithdrawnStudent(cid, st.id)) {
        removed++;
        if (_cmGuardians[cid]) delete _cmGuardians[cid][st.id];
      }
    });
    done.undone = { removed: removed, kept: kept };
    state.cmRosterOnly = null;
    renderClassManager();
    var head = document.getElementById('cm-import-done-title');
    _cmFocus(head);
  }

  return {
    configure: configure,
    ROSTER_FIELD_MENU: ROSTER_FIELD_MENU,
    ROSTER_IMPORT_FIELDS: ROSTER_IMPORT_FIELDS,
    ROSTER_SKIPPED_HEADERS: ROSTER_SKIPPED_HEADERS,
    _ROSTER_NUM_DATE: _ROSTER_NUM_DATE,
    _cmFocus: _cmFocus,
    _cmImportDoneHtml: _cmImportDoneHtml,
    _cmImportErrorHtml: _cmImportErrorHtml,
    _cmImportNewIds: _cmImportNewIds,
    _cmRosterOnlyIds: _cmRosterOnlyIds,
    _rosterCodes: _rosterCodes,
    _rosterColumn: _rosterColumn,
    _rosterDate: _rosterDate,
    _rosterHeaderKey: _rosterHeaderKey,
    cmChooseRosterFile: cmChooseRosterFile,
    cmCloseImportDone: cmCloseImportDone,
    cmCloseImportFormat: cmCloseImportFormat,
    cmImportEmptyHtml: cmImportEmptyHtml,
    cmImportFormatHtml: cmImportFormatHtml,
    cmImportRoster: cmImportRoster,
    cmImportShowBlanks: cmImportShowBlanks,
    cmUndoImport: cmUndoImport,
    parseRosterCsv: parseRosterCsv,
    rosterDateOrder: rosterDateOrder,
    rosterImportReady: rosterImportReady,
    rosterImportTable: rosterImportTable,
    rosterRowsFromTable: rosterRowsFromTable,
  };
})();
