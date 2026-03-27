/* ═══════════════════════════════════════════════════════════════
   TEAMS-IMPORT.JS — Microsoft Teams CSV/Excel grade import wizard
   5-step wizard: Upload → Match Students → Select Assignments →
                  Preview → Results
   ═══════════════════════════════════════════════════════════════ */
window.TeamsImport = (function() {
  'use strict';

  /* ── Module state ──────────────────────────────────────────── */
  var tiStep = 1;
  var tiCourseId = null;
  var tiParsedFile = null;     // { students:[], assignments:[] }
  var tiStudentMap = {};       // teamsIdx → { matchType, existingId, action }
  var tiSelectedAssigns = {};  // assignIdx → boolean
  var tiAssignDupes = {};      // assignIdx → existingAssessmentId | null
  var tiImportResult = null;   // { students, assessments, scores, feedback }
  var tiFileName = '';
  var _renderPageFn = null;
  var _overlayEl = null;
  var _triggerEl = null;       // element that opened wizard (for focus restore)

  function _resetState() {
    tiStep = 1;
    tiCourseId = null;
    tiParsedFile = null;
    tiStudentMap = {};
    tiSelectedAssigns = {};
    tiAssignDupes = {};
    tiImportResult = null;
    tiFileName = '';
  }

  /* ── Helpers ───────────────────────────────────────────────── */
  function _esc(s) { return esc(s); }  // reuse global esc() from data.js

  function _norm(s) { return (s || '').trim().toLowerCase(); }

  function _stepLabels() {
    return ['Upload', 'Match Students', 'Assignments', 'Preview', 'Done'];
  }

  /* ── Open / Close ──────────────────────────────────────────── */
  function open(courseId, renderFn) {
    if (_overlayEl) return;
    _triggerEl = document.activeElement; // save for focus restore
    _resetState();
    tiCourseId = courseId;
    _renderPageFn = renderFn || null;
    _createOverlay();
    _render();
  }

  function close() {
    if (!_overlayEl) return;
    document.removeEventListener('keydown', _escHandler);
    document.removeEventListener('keydown', _focusTrapHandler);
    _overlayEl.remove();
    _overlayEl = null;
    if (tiImportResult && _renderPageFn) _renderPageFn();
    // Restore focus to trigger element
    if (_triggerEl && _triggerEl.focus) _triggerEl.focus();
    _triggerEl = null;
  }

  function _escHandler(e) {
    if (e.key === 'Escape') {
      if (tiStep === 5 || !tiParsedFile) { close(); return; }
      // If data loaded, confirm before closing
      if (confirm('Discard import progress?')) close();
    }
  }

  /* ── Focus trap ─────────────────────────────────────────────── */
  function _focusTrapHandler(e) {
    if (e.key !== 'Tab' || !_overlayEl) return;
    var focusable = _overlayEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function _setInitialFocus() {
    if (!_overlayEl) return;
    var target = _overlayEl.querySelector('.ti-close');
    if (target) target.focus();
  }

  /* ── Overlay scaffolding ───────────────────────────────────── */
  function _createOverlay() {
    _overlayEl = document.createElement('div');
    _overlayEl.className = 'ti-overlay';
    _overlayEl.setAttribute('role', 'dialog');
    _overlayEl.setAttribute('aria-modal', 'true');
    _overlayEl.setAttribute('aria-labelledby', 'ti-title');
    document.body.appendChild(_overlayEl);
    document.addEventListener('keydown', _escHandler);
    document.addEventListener('keydown', _focusTrapHandler);

    // Delegated click handler
    _overlayEl.addEventListener('click', function(e) {
      var el = e.target.closest('[data-ti]');
      if (!el) return;
      var action = el.dataset.ti;
      if (_actions[action]) { e.preventDefault(); _actions[action](el); }
    });

    // Delegated change handler
    _overlayEl.addEventListener('change', function(e) {
      var el = e.target;
      if (el.dataset.tiChange) {
        var handler = _changeActions[el.dataset.tiChange];
        if (handler) handler(el);
      }
    });
  }

  /* ── Render dispatcher ─────────────────────────────────────── */
  function _render() {
    if (!_overlayEl) return;
    var labels = _stepLabels();
    var html = '<div class="ti-card">' +
      '<div class="ti-header">' +
        '<div class="ti-title" id="ti-title">Import from Teams</div>' +
        '<button class="ti-close" data-ti="close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ti-steps" role="list" aria-label="Import progress">' + labels.map(function(_, i) {
        var cls = i + 1 < tiStep ? 'done' : (i + 1 === tiStep ? 'active' : '');
        var state = i + 1 < tiStep ? 'completed' : (i + 1 === tiStep ? 'current' : 'upcoming');
        return '<div class="ti-step-pill ' + cls + '" role="listitem" aria-label="Step ' + (i+1) + ': ' + _esc(labels[i]) + ', ' + state + '"></div>';
      }).join('') + '</div>' +
      '<div class="ti-step-label" tabindex="-1" id="ti-step-label">Step ' + tiStep + ' of ' + labels.length + ': ' + _esc(labels[tiStep - 1]) + '</div>' +
      '<div class="ti-body" id="ti-body">' + _renderStep() + '</div>' +
      _renderFooter() +
    '</div>';
    _overlayEl.innerHTML = html;

    // Post-render hooks
    if (tiStep === 1) _setupDropzone();
    // Set focus after render — to step label for step transitions, close button on first open
    requestAnimationFrame(function() {
      var label = _overlayEl && _overlayEl.querySelector('#ti-step-label');
      if (label && tiStep > 1) label.focus();
      else _setInitialFocus();
    });
  }

  function _renderStep() {
    if (tiStep === 1) return _renderStep1();
    if (tiStep === 2) return _renderStep2();
    if (tiStep === 3) return _renderStep3();
    if (tiStep === 4) return _renderStep4();
    if (tiStep === 5) return _renderStep5();
    return '';
  }

  function _renderFooter() {
    if (tiStep === 1) return '<div class="ti-footer"></div>';
    if (tiStep === 5) return '<div class="ti-footer"><button class="btn btn-primary" data-ti="viewAssignments">View Assignments</button></div>';
    var backBtn = '<button class="btn btn-ghost" data-ti="back">Back</button>';
    var nextBtn = '';
    if (tiStep === 2) nextBtn = '<button class="btn btn-primary" data-ti="toStep3">Next</button>';
    if (tiStep === 3) nextBtn = '<button class="btn btn-primary" data-ti="toStep4">Next</button>';
    if (tiStep === 4) nextBtn = '<button class="btn btn-primary" data-ti="commitImport">Import</button>';
    return '<div class="ti-footer">' + backBtn + nextBtn + '</div>';
  }

  /* ── STEP 1: File Upload ───────────────────────────────────── */
  function _renderStep1() {
    var html = '<div class="ti-dropzone" id="ti-dropzone" data-ti="triggerFile" tabindex="0" role="button" aria-label="Upload Teams grade export file">' +
      '<div class="ti-dropzone-icon" aria-hidden="true">&#128196;</div>' +
      '<div class="ti-dropzone-text">Drop a Teams grade export here, or click to browse</div>' +
      '<div class="ti-dropzone-hint">Accepts .csv, .xlsx</div>' +
    '</div>' +
    '<input type="file" class="ti-file-input" id="ti-file-input" accept=".csv,.xlsx" data-ti-change="fileSelected">';
    if (tiFileName) {
      html += '<div class="ti-file-info"><span class="ti-file-info-icon">&#9989;</span>' +
        '<span class="ti-file-info-text">' + _esc(tiFileName) + '</span></div>';
    }
    return html;
  }

  function _setupDropzone() {
    var dz = document.getElementById('ti-dropzone');
    if (!dz) return;
    dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function(e) {
      e.preventDefault();
      dz.classList.remove('drag-over');
      var file = e.dataTransfer.files[0];
      if (file) _handleFile(file);
    });
    // Keyboard activation (Enter/Space)
    dz.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var f = document.getElementById('ti-file-input');
        if (f) f.click();
      }
    });
  }

  function _handleFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) {
      _showError('Unsupported file type. Please use .csv or .xlsx');
      return;
    }
    tiFileName = file.name;

    // Show loading
    var body = document.getElementById('ti-body');
    if (body) body.innerHTML = '<div class="ti-loading" role="status" aria-live="polite"><div class="ti-spinner"></div>Parsing file...</div>';

    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        _parseTeamsFile(new Uint8Array(e.target.result));
        _runStudentMatching();
        _runDuplicateDetection();
        // Pre-select all non-duplicate assignments
        tiParsedFile.assignments.forEach(function(a) {
          tiSelectedAssigns[a.idx] = !tiAssignDupes[a.idx];
        });
        tiStep = 2;
        _render();
      } catch (err) {
        _showError('Could not parse file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function _showError(msg) {
    var body = document.getElementById('ti-body');
    if (body) body.innerHTML = _renderStep1() + '<div class="ti-error" role="alert">' + _esc(msg) + '</div>';
    if (tiStep === 1) _setupDropzone();
  }

  /* ── Parsing engine ────────────────────────────────────────── */
  function _parseTeamsFile(data) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS library not loaded');
    var wb = XLSX.read(data, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    if (rows.length < 2) throw new Error('File appears to be empty');
    var header = rows[0].map(function(h) { return String(h || '').trim(); });

    // Find identity columns
    var fnIdx = -1, lnIdx = -1, emIdx = -1;
    header.forEach(function(h, i) {
      var hl = h.toLowerCase();
      if (hl === 'first name') fnIdx = i;
      else if (hl === 'last name') lnIdx = i;
      else if (hl === 'email address' || hl === 'email') emIdx = i;
    });
    if (fnIdx < 0 || lnIdx < 0) throw new Error('Missing "First Name" or "Last Name" columns');

    // Find first assignment column (first column after identity block that isn't Points/Feedback)
    var identityCols = Math.max(fnIdx, lnIdx, emIdx) + 1;

    // Detect triplets: [AssignmentTitle, "Points", "Feedback"]
    var assignments = [];
    var i = identityCols;
    while (i < header.length) {
      var title = header[i];
      // Check if next column is "Points" (case-insensitive)
      var nextH = (header[i + 1] || '').toLowerCase();
      if (nextH === 'points') {
        // This is an assignment triplet
        assignments.push({
          idx: assignments.length,
          title: title,
          colEarned: i,
          colMax: i + 1,
          colFeedback: (header[i + 2] || '').toLowerCase() === 'feedback' ? i + 2 : -1,
          maxPoints: 0,
          scores: {}
        });
        i += (assignments[assignments.length - 1].colFeedback >= 0) ? 3 : 2;
      } else {
        i++; // skip unrecognized column
      }
    }

    if (assignments.length === 0) throw new Error('No assignment data found. Check that this is a Teams grade export.');

    // Parse student rows
    var students = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var fn = String(row[fnIdx] || '').trim();
      var ln = String(row[lnIdx] || '').trim();
      if (!fn && !ln) continue; // skip empty rows

      var student = {
        idx: students.length,
        firstName: fn,
        lastName: ln,
        email: emIdx >= 0 ? String(row[emIdx] || '').trim() : ''
      };
      students.push(student);

      // Extract scores for each assignment
      assignments.forEach(function(a) {
        var earnedRaw = row[a.colEarned];
        var maxRaw = row[a.colMax];
        var feedbackRaw = a.colFeedback >= 0 ? row[a.colFeedback] : '';

        var earned = _parseNum(earnedRaw);
        var max = _parseNum(maxRaw);
        var feedback = String(feedbackRaw || '').trim();

        if (max > a.maxPoints) a.maxPoints = max;

        // Only store if there's any data for this student/assignment
        if (earned !== null || feedback) {
          a.scores[student.idx] = {
            earned: earned,
            feedback: feedback
          };
        }
      });
    }

    // Default maxPoints for assignments where we couldn't detect it
    assignments.forEach(function(a) {
      if (a.maxPoints <= 0) a.maxPoints = 100;
    });

    tiParsedFile = { students: students, assignments: assignments };
  }

  function _parseNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  /* ── Student matching ──────────────────────────────────────── */
  function _runStudentMatching() {
    var existing = getStudents(tiCourseId) || [];
    tiStudentMap = {};

    tiParsedFile.students.forEach(function(ts) {
      var match = null;
      var matchType = 'none';

      // Priority 1: email match
      if (ts.email) {
        var teamsEmail = _norm(ts.email);
        for (var i = 0; i < existing.length; i++) {
          if (_norm(existing[i].email) === teamsEmail) {
            match = existing[i];
            matchType = 'email';
            break;
          }
        }
      }

      // Priority 2: name match
      if (!match) {
        var tfn = _norm(ts.firstName);
        var tln = _norm(ts.lastName);
        for (var j = 0; j < existing.length; j++) {
          var efn = _norm(existing[j].firstName);
          var eln = _norm(existing[j].lastName);
          // Also check preferred name
          var epf = _norm(existing[j].preferred);
          if ((efn === tfn || epf === tfn) && eln === tln) {
            match = existing[j];
            matchType = 'name';
            break;
          }
        }
      }

      tiStudentMap[ts.idx] = {
        matchType: matchType,
        existingId: match ? match.id : null,
        existingName: match ? (match.firstName + ' ' + match.lastName) : '',
        action: match ? 'match' : 'new'  // default: matched students link, unmatched create new
      };
    });
  }

  /* ── Duplicate assignment detection ────────────────────────── */
  function _runDuplicateDetection() {
    var existing = getAssessments(tiCourseId) || [];
    tiAssignDupes = {};
    tiParsedFile.assignments.forEach(function(a) {
      var normTitle = _norm(a.title);
      var dupe = existing.find(function(ea) { return _norm(ea.title) === normTitle; });
      tiAssignDupes[a.idx] = dupe ? dupe.id : null;
    });
  }

  /* ── STEP 2: Match Students ────────────────────────────────── */
  function _renderStep2() {
    var sts = tiParsedFile.students;
    var matched = 0, newCount = 0, skipped = 0;
    sts.forEach(function(s) {
      var m = tiStudentMap[s.idx];
      if (m.action === 'match') matched++;
      else if (m.action === 'new') newCount++;
      else skipped++;
    });

    var html = '<div class="ti-match-summary">' +
      '<span><b>' + matched + '</b> matched</span>' +
      '<span><b>' + newCount + '</b> new</span>' +
      '<span><b>' + skipped + '</b> skipped</span>' +
    '</div>' +
    '<div class="ti-quick-actions">' +
      '<button class="btn btn-ghost" data-ti="createAllNew" style="font-size:var(--text-xs)">Create All Unmatched</button>' +
      '<button class="btn btn-ghost" data-ti="skipAllNew" style="font-size:var(--text-xs)">Skip All Unmatched</button>' +
    '</div>' +
    '<table class="ti-match-table"><thead><tr>' +
      '<th>Teams Student</th><th>Status</th><th>Action</th>' +
    '</tr></thead><tbody>';

    sts.forEach(function(s) {
      var m = tiStudentMap[s.idx];
      var badge = '';
      if (m.action === 'match') badge = '<span class="ti-badge ti-badge-matched">Matched</span>';
      else if (m.action === 'new') badge = '<span class="ti-badge ti-badge-new">New</span>';
      else badge = '<span class="ti-badge ti-badge-skip">Skip</span>';

      var detail = '';
      if (m.action === 'match') {
        detail = '<span style="font-size:var(--text-xs);color:var(--text-3)">' +
          (m.matchType === 'email' ? 'by email' : 'by name') +
          ' &rarr; ' + _esc(m.existingName) + '</span>';
      }

      // Action dropdown for unmatched students
      var studentLabel = _esc(s.firstName + ' ' + s.lastName);
      var actionHtml = '';
      if (m.matchType === 'none') {
        actionHtml = '<select class="ti-action-select" data-ti-change="studentAction" data-idx="' + s.idx + '" aria-label="Action for ' + studentLabel + '">' +
          '<option value="new"' + (m.action === 'new' ? ' selected' : '') + '>Create new</option>' +
          '<option value="skip"' + (m.action === 'skip' ? ' selected' : '') + '>Skip</option>' +
        '</select>';
      } else {
        actionHtml = '<select class="ti-action-select" data-ti-change="studentAction" data-idx="' + s.idx + '" aria-label="Action for ' + studentLabel + '">' +
          '<option value="match" selected>Use match</option>' +
          '<option value="new">Create new</option>' +
          '<option value="skip">Skip</option>' +
        '</select>';
      }

      html += '<tr>' +
        '<td><div>' + _esc(s.firstName + ' ' + s.lastName) + '</div>' +
          (s.email ? '<div class="ti-match-email">' + _esc(s.email) + '</div>' : '') +
        '</td>' +
        '<td>' + badge + ' ' + detail + '</td>' +
        '<td>' + actionHtml + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  /* ── STEP 3: Select Assignments ────────────────────────────── */
  function _renderStep3() {
    var assigns = tiParsedFile.assignments;
    var allSelected = assigns.every(function(a) { return tiSelectedAssigns[a.idx]; });

    var html = '<label class="ti-select-all">' +
      '<input type="checkbox" data-ti-change="toggleAll"' + (allSelected ? ' checked' : '') + '>' +
      'Select All (' + assigns.length + ' assignments)' +
    '</label>' +
    '<ul class="ti-assign-list">';

    assigns.forEach(function(a) {
      var scoredCount = Object.keys(a.scores).filter(function(k) {
        return a.scores[k].earned !== null;
      }).length;
      var isDupe = !!tiAssignDupes[a.idx];

      html += '<li class="ti-assign-item">' +
        '<label style="display:contents"><input type="checkbox" data-ti-change="toggleAssign" data-idx="' + a.idx + '"' +
          (tiSelectedAssigns[a.idx] ? ' checked' : '') + '>' +
        '<span class="ti-assign-title">' + _esc(a.title) +
          (isDupe ? ' <span class="ti-badge ti-badge-dupe">Already exists</span>' : '') +
        '</span>' +
        '<span class="ti-assign-meta">' + a.maxPoints + ' pts &middot; ' + scoredCount + ' scored</span>' +
      '</label></li>';
    });

    html += '</ul>';
    return html;
  }

  /* ── STEP 4: Preview & Confirm ─────────────────────────────── */
  function _renderStep4() {
    var selected = tiParsedFile.assignments.filter(function(a) { return tiSelectedAssigns[a.idx]; });
    var activeStudents = tiParsedFile.students.filter(function(s) { return tiStudentMap[s.idx].action !== 'skip'; });
    var newStudents = activeStudents.filter(function(s) { return tiStudentMap[s.idx].action === 'new'; });
    var totalScores = 0;
    var totalFeedback = 0;

    selected.forEach(function(a) {
      activeStudents.forEach(function(s) {
        var sc = a.scores[s.idx];
        if (sc && sc.earned !== null) totalScores++;
        if (sc && sc.feedback) totalFeedback++;
      });
    });

    var html = '<div class="ti-preview-summary">' +
      '<div class="ti-preview-stat"><b>' + activeStudents.length + '</b>students' +
        (newStudents.length ? ' (' + newStudents.length + ' new)' : '') + '</div>' +
      '<div class="ti-preview-stat"><b>' + selected.length + '</b>assignments</div>' +
      '<div class="ti-preview-stat"><b>' + totalScores + '</b>scores</div>' +
      '<div class="ti-preview-stat"><b>' + totalFeedback + '</b>feedback notes</div>' +
    '</div>';

    // Preview table
    html += '<div class="ti-preview-wrap"><table class="ti-preview-table"><thead><tr><th>Student</th>';
    selected.forEach(function(a) {
      html += '<th title="' + _esc(a.title) + '">' + _esc(a.title.length > 18 ? a.title.slice(0, 16) + '..' : a.title) + '</th>';
    });
    html += '</tr></thead><tbody>';

    activeStudents.forEach(function(s) {
      html += '<tr><td style="white-space:nowrap;font-weight:500">' +
        _esc(s.firstName + ' ' + s.lastName) + '</td>';
      selected.forEach(function(a) {
        var sc = a.scores[s.idx];
        if (!sc || sc.earned === null) {
          html += '<td class="ti-cell-empty">&mdash;</td>';
        } else {
          var cls = sc.feedback ? 'ti-cell-feedback' : 'ti-cell-score';
          html += '<td class="' + cls + '" title="' + (sc.feedback ? _esc(sc.feedback.slice(0, 100)) : '') + '">' +
            sc.earned + '/' + a.maxPoints +
            (sc.feedback ? ' *' : '') +
          '</td>';
        }
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  /* ── STEP 5: Results ───────────────────────────────────────── */
  function _renderStep5() {
    var r = tiImportResult;
    if (!r) return '<div class="ti-error">No results available</div>';

    return '<div class="ti-results-card">' +
      '<div class="ti-results-icon" aria-hidden="true">&#9989;</div>' +
      '<div class="ti-results-title">Import Complete</div>' +
      '<div class="ti-results-stats">' +
        '<div class="ti-results-stat"><b>' + r.studentsCreated + '</b>students created</div>' +
        '<div class="ti-results-stat"><b>' + r.assessmentsCreated + '</b>assignments imported</div>' +
        '<div class="ti-results-stat"><b>' + r.scoresWritten + '</b>scores recorded</div>' +
        '<div class="ti-results-stat"><b>' + r.feedbackSaved + '</b>feedback notes</div>' +
      '</div>' +
      (r.errors.length ? '<div class="ti-error">' + r.errors.length + ' error(s): ' + _esc(r.errors.join('; ')) + '</div>' : '') +
    '</div>';
  }

  /* ── Commit import ─────────────────────────────────────────── */
  function _commitImport() {
    var cid = tiCourseId;
    var result = { studentsCreated: 0, assessmentsCreated: 0, scoresWritten: 0, feedbackSaved: 0, errors: [] };
    var today = new Date().toISOString().slice(0, 10);
    var now = new Date().toISOString();

    try {
      // 1. Create new students
      var students = getStudents(cid) || [];
      var idLookup = {}; // teamsIdx → FullVision student ID

      tiParsedFile.students.forEach(function(ts) {
        var m = tiStudentMap[ts.idx];
        if (m.action === 'skip') return;

        if (m.action === 'match') {
          idLookup[ts.idx] = m.existingId;
        } else if (m.action === 'new') {
          var newId = uid();
          students.push({
            id: newId,
            firstName: ts.firstName,
            lastName: ts.lastName,
            preferred: '',
            pronouns: '',
            studentNumber: '',
            dateOfBirth: '',
            email: ts.email,
            designations: [],
            attendance: [],
            sortName: ts.lastName + ' ' + ts.firstName,
            enrolledDate: today
          });
          idLookup[ts.idx] = newId;
          result.studentsCreated++;
        }
      });
      saveStudents(cid, students);

      // 2. Create assessments
      var assessments = getAssessments(cid) || [];
      var assignIdLookup = {}; // assignIdx → new assessment ID

      var selected = tiParsedFile.assignments.filter(function(a) { return tiSelectedAssigns[a.idx]; });
      selected.forEach(function(a) {
        var newId = uid();
        assessments.push({
          id: newId,
          title: a.title,
          date: today,
          type: 'summative',
          tagIds: [],
          evidenceType: '',
          notes: 'Imported from Teams (' + tiFileName + ')',
          coreCompetencyIds: [],
          rubricId: '',
          scoreMode: 'points',
          maxPoints: a.maxPoints,
          weight: 1,
          dueDate: '',
          collaboration: 'individual',
          pairs: [],
          groups: [],
          excludedStudents: [],
          moduleId: '',
          created: now
        });
        assignIdLookup[a.idx] = newId;
        result.assessmentsCreated++;
      });
      saveAssessments(cid, assessments);

      // 3. Write scores (batch — one saveScores call)
      var scores = getScores(cid) || {};

      selected.forEach(function(a) {
        var assessId = assignIdLookup[a.idx];
        tiParsedFile.students.forEach(function(ts) {
          var sid = idLookup[ts.idx];
          if (!sid) return; // skipped student

          var sc = a.scores[ts.idx];
          if (!sc || sc.earned === null) return; // no score data

          if (!scores[sid]) scores[sid] = [];
          scores[sid].push({
            id: uid(),
            assessmentId: assessId,
            tagId: '',
            score: sc.earned,
            date: today,
            type: 'summative',
            note: sc.feedback || '',
            created: now
          });
          result.scoresWritten++;
          if (sc.feedback) result.feedbackSaved++;
        });
      });
      saveScores(cid, scores);

    } catch (err) {
      result.errors.push(err.message);
    }

    tiImportResult = result;
    tiStep = 5;
    _render();
    showSyncToast('Import complete: ' + result.scoresWritten + ' scores', 'success');
  }

  /* ── Action handlers ───────────────────────────────────────── */
  var _actions = {
    close: function() {
      if (tiStep === 5 || !tiParsedFile) { close(); return; }
      if (confirm('Discard import progress?')) close();
    },
    triggerFile: function() {
      var f = document.getElementById('ti-file-input');
      if (f) f.click();
    },
    back: function() {
      if (tiStep > 1) { tiStep--; _render(); }
    },
    toStep3: function() { tiStep = 3; _render(); },
    toStep4: function() {
      var anySelected = tiParsedFile.assignments.some(function(a) { return tiSelectedAssigns[a.idx]; });
      if (!anySelected) { alert('Select at least one assignment to import.'); return; }
      tiStep = 4; _render();
    },
    commitImport: function() { _commitImport(); },
    viewAssignments: function() { close(); },
    createAllNew: function() {
      tiParsedFile.students.forEach(function(s) {
        if (tiStudentMap[s.idx].matchType === 'none') tiStudentMap[s.idx].action = 'new';
      });
      _render();
    },
    skipAllNew: function() {
      tiParsedFile.students.forEach(function(s) {
        if (tiStudentMap[s.idx].matchType === 'none') tiStudentMap[s.idx].action = 'skip';
      });
      _render();
    }
  };

  var _changeActions = {
    fileSelected: function(el) {
      if (el.files[0]) _handleFile(el.files[0]);
    },
    studentAction: function(el) {
      var idx = Number(el.dataset.idx);
      tiStudentMap[idx].action = el.value;
      // Re-render to update summary counts
      var summary = _overlayEl.querySelector('.ti-match-summary');
      if (summary) {
        var matched = 0, newCount = 0, skipped = 0;
        tiParsedFile.students.forEach(function(s) {
          var m = tiStudentMap[s.idx];
          if (m.action === 'match') matched++;
          else if (m.action === 'new') newCount++;
          else skipped++;
        });
        summary.innerHTML = '<span><b>' + matched + '</b> matched</span>' +
          '<span><b>' + newCount + '</b> new</span>' +
          '<span><b>' + skipped + '</b> skipped</span>';
      }
      // Update badge
      var row = el.closest('tr');
      if (row) {
        var badgeEl = row.querySelector('.ti-badge');
        if (badgeEl) {
          var act = el.value;
          badgeEl.className = 'ti-badge ' + (act === 'match' ? 'ti-badge-matched' : act === 'new' ? 'ti-badge-new' : 'ti-badge-skip');
          badgeEl.textContent = act === 'match' ? 'Matched' : act === 'new' ? 'New' : 'Skip';
        }
      }
    },
    toggleAssign: function(el) {
      var idx = Number(el.dataset.idx);
      tiSelectedAssigns[idx] = el.checked;
    },
    toggleAll: function(el) {
      var checked = el.checked;
      tiParsedFile.assignments.forEach(function(a) {
        tiSelectedAssigns[a.idx] = checked;
      });
      // Update all checkboxes without full re-render
      var items = _overlayEl.querySelectorAll('[data-ti-change="toggleAssign"]');
      items.forEach(function(cb) { cb.checked = checked; });
    }
  };

  /* ── Public API ────────────────────────────────────────────── */
  return {
    open: open,
    close: close
  };
})();
