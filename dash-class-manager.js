/* ── dash-class-manager.js — Class manager UI ─────────────── */
window.DashClassManager = (function() {
  'use strict';

  /* ── State (module-local) ────────────────────────────────── */
  var cmSelectedCourse = null;
  var cmMode = 'edit';
  var cmEditingStudentId = null;
  var cmBulkMode = false;
  var cmBulkSelected = new Set();
  var cmPendingImport = null;
  var cmRelinkCid = null;
  var cmRelinkStep = 0;

  /* ── State accessors for external use ────────────────────── */
  function getState() {
    return {
      cmSelectedCourse: cmSelectedCourse,
      cmMode: cmMode,
      cmEditingStudentId: cmEditingStudentId,
      cmBulkMode: cmBulkMode,
      cmBulkSelected: cmBulkSelected,
      cmPendingImport: cmPendingImport,
      cmRelinkCid: cmRelinkCid,
      cmRelinkStep: cmRelinkStep
    };
  }

  function resetState(activeCourse) {
    cmSelectedCourse = activeCourse;
    cmMode = 'edit';
    cmEditingStudentId = null;
    cmBulkMode = false;
    cmBulkSelected = new Set();
    cmPendingImport = null;
    cmRelinkCid = null;
    cmRelinkStep = 0;
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  // renderFn: callback to trigger full page render (provided by page-dashboard)
  var _renderFn = null;
  function setRenderFn(fn) { _renderFn = fn; }
  function _render() { if (_renderFn) _renderFn(); }

  /* ── Student Management ─────────────────────────────────── */
  function deleteStudentUI(sid, activeCourse) {
    var students = getStudents(activeCourse);
    var st = students.find(function(s) { return s.id === sid; });
    if (!st) return;
    var dname = displayName(st);
    showConfirm('Delete Student', 'Delete ' + dname + '? This removes all their scores, goals, and notes.', 'Delete', 'danger', function() {
      var snapshot = deleteStudent(activeCourse, sid);
      _render();
      showUndoToast('Student deleted', function() {
        var cid = activeCourse;
        var sts = getStudents(cid); sts.push(snapshot.student); saveStudents(cid, sts);
        var sc = getScores(cid); sc[sid] = snapshot.scores; saveScores(cid, sc);
        if (snapshot.goals !== undefined) { var g = getGoals(cid); g[sid] = snapshot.goals; saveGoals(cid, g); }
        if (snapshot.reflections !== undefined) { var r = getReflections(cid); r[sid] = snapshot.reflections; saveReflections(cid, r); }
        if (snapshot.notes !== undefined) { var n = getNotes(cid); n[sid] = snapshot.notes; saveNotes(cid, n); }
        if (snapshot.flagged) { var f = getFlags(cid); f[sid] = true; saveFlags(cid, f); }
        if (snapshot.statuses) { var s = getAssignmentStatuses(cid); Object.assign(s, snapshot.statuses); saveAssignmentStatuses(cid, s); }
        _render();
      });
    });
  }

  /* ── Class Manager Student Functions ────────────────────── */
  function cmShowAddStudent() {
    var form = document.getElementById('cm-add-student-form');
    if (form) { form.style.display = 'block'; var el = document.getElementById('cm-add-first'); if (el) el.focus(); }
  }

  function cmCancelStudent() {
    cmEditingStudentId = null;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'none';
    var btn = document.getElementById('cm-save-btn');
    if (btn) btn.textContent = 'Save';
    ['cm-add-first','cm-add-last','cm-add-pref','cm-add-num','cm-add-dob','cm-add-email'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var proEl = document.getElementById('cm-add-pro');
    if (proEl) proEl.value = '';
    document.querySelectorAll('.cm-desig-check').forEach(function(cb) { cb.checked = false; });
  }

  function cmSaveStudent() {
    if (!cmSelectedCourse) return;
    var firstName = (document.getElementById('cm-add-first')?.value||'').trim();
    var lastName = (document.getElementById('cm-add-last')?.value||'').trim();
    if (!firstName) {
      var el = document.getElementById('cm-add-first');
      if (el) { el.style.border = '2px solid var(--score-1)'; el.placeholder = 'First name is required'; el.oninput = function() { this.style.border = ''; }; el.focus(); }
      return;
    }
    var preferred = (document.getElementById('cm-add-pref')?.value||'').trim();
    var pronouns = (document.getElementById('cm-add-pro')?.value||'').trim();
    var studentNumber = (document.getElementById('cm-add-num')?.value||'').trim();
    var dateOfBirth = (document.getElementById('cm-add-dob')?.value||'').trim();
    var email = (document.getElementById('cm-add-email')?.value||'').trim();
    var designations = Array.from(document.querySelectorAll('.cm-desig-check:checked')).map(function(cb) { return cb.value; });
    var students = getStudents(cmSelectedCourse);
    var sortName = ((lastName||'') + ' ' + firstName).trim();

    if (cmEditingStudentId) {
      var st = students.find(function(s) { return s.id === cmEditingStudentId; });
      if (st) {
        st.firstName = firstName; st.lastName = lastName; st.preferred = preferred;
        st.pronouns = pronouns; st.sortName = sortName;
        st.studentNumber = studentNumber; st.dateOfBirth = dateOfBirth; st.email = email;
        st.designations = designations; delete st.designation;
        if (!st.attendance) st.attendance = [];
      }
      cmEditingStudentId = null;
    } else {
      students.push({ id: uid(), firstName: firstName, lastName: lastName, preferred: preferred, pronouns: pronouns, studentNumber: studentNumber, dateOfBirth: dateOfBirth, email: email, designations: designations, attendance:[], sortName: sortName, enrolledDate: new Date().toISOString().slice(0,10) });
    }
    saveStudents(cmSelectedCourse, students);
    cmCancelStudent();
    _render();
    requestAnimationFrame(function() {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    });
  }

  function cmEditStudent(sid) {
    if (!cmSelectedCourse) return;
    var students = getStudents(cmSelectedCourse);
    var st = students.find(function(s) { return s.id === sid; });
    if (!st) return;
    cmEditingStudentId = sid;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'block';
    var el = function(id) { return document.getElementById(id); };
    if (el('cm-add-first')) el('cm-add-first').value = st.firstName || '';
    if (el('cm-add-last')) el('cm-add-last').value = st.lastName || '';
    if (el('cm-add-pref')) el('cm-add-pref').value = st.preferred || '';
    if (el('cm-add-pro')) el('cm-add-pro').value = st.pronouns || '';
    if (el('cm-add-num')) el('cm-add-num').value = st.studentNumber || '';
    if (el('cm-add-dob')) el('cm-add-dob').value = st.dateOfBirth || '';
    if (el('cm-add-email')) el('cm-add-email').value = st.email || '';
    var desigs = st.designations || [];
    document.querySelectorAll('.cm-desig-check').forEach(function(cb) { cb.checked = desigs.indexOf(cb.value) >= 0; });
    var btn = el('cm-save-btn');
    if (btn) btn.textContent = 'Update';
    if (el('cm-add-first')) el('cm-add-first').focus();
  }

  function cmRemoveStudent(sid) {
    if (!cmSelectedCourse) return;
    deleteStudentUI(sid, cmSelectedCourse);
  }

  /* ── Bulk Edit Mode ─────────────────────────────────────── */
  function cmToggleBulk() {
    cmBulkMode = !cmBulkMode;
    cmBulkSelected.clear();
    _render();
  }

  function cmBulkToggle(sid) {
    if (cmBulkSelected.has(sid)) cmBulkSelected.delete(sid);
    else cmBulkSelected.add(sid);
    _render();
  }

  function cmBulkSelectAll() {
    var students = getStudents(cmSelectedCourse);
    students.forEach(function(s) { cmBulkSelected.add(s.id); });
    _render();
  }

  function cmBulkDeselectAll() {
    cmBulkSelected.clear();
    _render();
  }

  function cmApplyBulk() {
    if (!cmSelectedCourse || cmBulkSelected.size === 0) return;
    var pronouns = (document.getElementById('cm-bulk-pro')?.value||'').trim();
    var attDate = (document.getElementById('cm-bulk-att-date')?.value||'').trim();
    var attStatus = (document.getElementById('cm-bulk-att-status')?.value||'').trim();
    var students = getStudents(cmSelectedCourse);
    students.forEach(function(st) {
      if (!cmBulkSelected.has(st.id)) return;
      if (pronouns) st.pronouns = pronouns;
      if (attDate && attStatus) {
        if (!st.attendance) st.attendance = [];
        st.attendance.push({ date: attDate, status: attStatus, note: '' });
        st.attendance.sort(function(a,b) { return b.date.localeCompare(a.date); });
      }
    });
    saveStudents(cmSelectedCourse, students);
    cmBulkMode = false;
    cmBulkSelected.clear();
    _render();
  }

  function cmImportRoster() {
    var el = document.getElementById('cm-csv-input');
    if (el) el.click();
  }

  function cmHandleCSV(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var lines = e.target.result.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
      var hdr = (lines[0]||'').toLowerCase();
      var hasHeader = hdr.includes('first') || hdr.includes('name') || hdr.includes('last');
      var start = hasHeader ? 1 : 0;
      var parsed = [];
      for (var i = start; i < lines.length; i++) {
        var parts = lines[i].split(',').map(function(p) { return p.trim(); });
        if (!parts[0]) continue;
        if (hdr.includes('first') || parts.length >= 4) {
          parsed.push({ firstName: parts[0], lastName: parts[1]||'', preferred: parts[2]||'', pronouns: parts[3]||'', studentNumber: parts[4]||'', dateOfBirth: parts[5]||'', email: parts[6]||'' });
        } else {
          var np = parts[0].split(/\s+/);
          parsed.push({ firstName: np[0]||'', lastName: np.slice(1).join(' ')||'', preferred: parts[1]||'', pronouns: parts[2]||'' });
        }
      }
      cmShowImportPreview(parsed);
    };
    reader.readAsText(file);
    input.value = '';
  }

  function cmShowImportPreview(parsed) {
    cmPendingImport = parsed;
    var cid = cmSelectedCourse;
    var existing = getStudents(cid).map(function(s) { return fullName(s).toLowerCase(); });
    var html = '<div style="border:1px solid var(--active);border-radius:var(--radius-sm);padding:10px 12px;margin-top:8px;background:rgba(0,122,255,0.02)">' +
      '<div class="cm-label" style="margin-bottom:6px">Import Preview \u2014 ' + parsed.length + ' student' + (parsed.length !== 1 ? 's' : '') + ' found</div>' +
      '<div style="max-height:180px;overflow-y:auto;margin-bottom:8px">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
          '<thead><tr style="border-bottom:1px solid var(--border)">' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">First</th>' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">Last</th>' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">Pronouns</th>' +
            '<th style="text-align:left;padding:3px 6px" class="cm-label">Status</th>' +
          '</tr></thead><tbody>';
    parsed.forEach(function(p) {
      var fn = ((p.firstName||'')+' '+(p.lastName||'')).trim().toLowerCase();
      var dupe = existing.includes(fn);
      html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.04)' + (dupe ? ';opacity:0.5' : '') + '">' +
        '<td style="padding:3px 6px">' + esc(p.firstName||'') + '</td>' +
        '<td style="padding:3px 6px">' + esc(p.lastName||'') + '</td>' +
        '<td style="padding:3px 6px">' + esc(p.pronouns||'') + '</td>' +
        '<td style="padding:3px 6px;font-size:0.65rem;font-weight:600;color:' + (dupe ? 'var(--priority)' : 'var(--score-3)') + '">' + (dupe ? 'SKIP' : 'NEW') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 14px" data-action="cmConfirmImport">Import</button>' +
        '<button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 10px" data-action="cmCancelImport">Cancel</button>' +
      '</div>' +
    '</div>';
    var el = document.getElementById('cm-import-preview');
    if (el) el.innerHTML = html;
  }

  function cmConfirmImport() {
    if (!cmPendingImport || !cmSelectedCourse) return;
    var students = getStudents(cmSelectedCourse);
    var existingNames = students.map(function(s) { return fullName(s).toLowerCase(); });
    cmPendingImport.forEach(function(p) {
      var fn = ((p.firstName||'')+' '+(p.lastName||'')).trim().toLowerCase();
      if (existingNames.includes(fn)) return;
      var sortName = ((p.lastName||'') + ' ' + (p.firstName||'')).trim();
      students.push({ id: uid(), firstName: p.firstName||'', lastName: p.lastName||'', preferred: p.preferred||'', pronouns: p.pronouns||'', studentNumber: p.studentNumber||'', dateOfBirth: p.dateOfBirth||'', email: p.email||'', attendance:[], sortName: sortName, enrolledDate: new Date().toISOString().slice(0,10) });
    });
    saveStudents(cmSelectedCourse, students);
    cmPendingImport = null;
    _render();
  }

  function cmCancelImport() {
    cmPendingImport = null;
    var el = document.getElementById('cm-import-preview');
    if (el) el.innerHTML = '';
  }

  /* ── Class Manager Open/Close ───────────────────────────── */
  function openClassManager(activeCourse) {
    cmSelectedCourse = activeCourse;
    cmMode = 'edit';
    return true; // signals classManagerOpen = true
  }

  function closeClassManager() {
    return false; // signals classManagerOpen = false
  }

  /* ── Class Manager Rendering ────────────────────────────── */
  function renderClassManager() {
    var courseIds = Object.keys(COURSES);
    var html = '';

    // Top bar
    var detailTitle = cmMode === 'create' ? 'New Class' :
      (cmSelectedCourse && COURSES[cmSelectedCourse] ? COURSES[cmSelectedCourse].name : 'Class Management');
    html += '<div class="cm-topbar">' +
      '<button class="cm-back-btn" data-action="closeClassManager">\u2190 Dashboard</button>' +
      '<span class="cm-topbar-title">Class Management</span>' +
      '<span class="cm-topbar-spacer"></span>' +
      '<span style="font-size:0.75rem;color:var(--text-3)">' + esc(detailTitle) + '</span>' +
    '</div>';

    // Empty state
    if (courseIds.length === 0 && cmMode !== 'create') {
      html += '<div class="cm-empty">' +
        '<div class="cm-empty-icon">\uD83D\uDCDA</div>' +
        '<div class="cm-empty-title">No classes yet</div>' +
        '<div class="cm-empty-text">Create your first class to get started with your gradebook.</div>' +
        '<button class="btn btn-primary" data-action="cmStartCreate" style="margin-top:16px">Create a Class</button>' +
      '</div>';
      document.getElementById('main').innerHTML = html;
      return;
    }

    html += '<div class="cm-layout">';
    html += renderCmSidebar(courseIds);
    html += '<div class="cm-detail">';

    if (cmMode === 'create') {
      html += DashCurriculumWizard.renderCmCreateForm();
    } else if (cmRelinkStep > 0 && cmRelinkCid && COURSES[cmRelinkCid]) {
      html += renderCmRelinkPanel(cmRelinkCid);
    } else if (cmSelectedCourse && COURSES[cmSelectedCourse]) {
      html += renderCmDetail(cmSelectedCourse);
    }

    html += '</div></div>';
    document.getElementById('main').innerHTML = html;
  }

  function renderCmSidebar(courseIds) {
    var html = '<div class="cm-sidebar">' +
      '<div class="cm-sidebar-header">' +
        '<span class="cm-sidebar-label">' + courseIds.length + ' Class' + (courseIds.length!==1?'es':'') + '</span>' +
        '<button class="cm-new-btn" data-action="cmStartCreate">+ New</button>' +
      '</div>' +
      '<div class="cm-class-list">';
    if (cmMode === 'create') {
      html += '<div class="cm-class-item cm-create-active">' +
        '<div class="cm-class-name" style="color:var(--active)">New Class</div>' +
        '<div class="cm-class-meta">Setting up\u2026</div>' +
      '</div>';
    }
    var activeCids = courseIds.filter(function(cid) { return !getCourseConfig(cid).archived; });
    var archivedCids = courseIds.filter(function(cid) { return getCourseConfig(cid).archived; });
    activeCids.forEach(function(cid) {
      var c = COURSES[cid];
      var sc = getStudents(cid).length;
      var sel = (cid === cmSelectedCourse && cmMode === 'edit') ? ' selected' : '';
      var gs = c.gradingSystem === 'proficiency' ? 'Proficiency' : c.gradingSystem === 'letter' ? 'Letter' : 'Points';
      html += '<div class="cm-class-item' + sel + '" data-action="cmSelectClass" data-cid="' + cid + '">' +
        '<div class="cm-class-name">' + esc(c.name) + '</div>' +
        '<div class="cm-class-meta">' + gs + ' \u00B7 ' + sc + ' student' + (sc!==1?'s':'') + '</div>' +
      '</div>';
    });
    if (archivedCids.length > 0) {
      html += '<div style="padding:8px 12px 4px;font-size:0.6rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-top:8px;border-top:1px solid var(--border)">Archived</div>';
      archivedCids.forEach(function(cid) {
        var c = COURSES[cid];
        var sc = getStudents(cid).length;
        var sel = (cid === cmSelectedCourse && cmMode === 'edit') ? ' selected' : '';
        html += '<div class="cm-class-item' + sel + '" data-action="cmSelectClass" data-cid="' + cid + '" style="opacity:0.5">' +
          '<div class="cm-class-name">' + esc(c.name) + '</div>' +
          '<div class="cm-class-meta">' + sc + ' student' + (sc!==1?'s':'') + ' \u00B7 archived</div>' +
        '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  function renderCmDetail(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var method = cc.calcMethod || course.calcMethod || 'mostRecent';
    var dw = cc.decayWeight != null ? cc.decayWeight : (course.decayWeight || 0.65);
    var cw = cc.categoryWeights || { summative:1.0, formative:0.0 };
    var cwEnabled = cw.formative > 0;
    var lm = getLearningMap(cid);
    var studentCount = getStudents(cid).length;
    var assessCount = getAssessments(cid).length;
    var tagCount = getAllTags(cid).length;

    var html = '<div class="cm-detail-inner">';

    // LEFT COLUMN: Class Details + Students
    html += '<div class="cm-col">';

    // Section 1: Class Details
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Class Name</label>' +
        '<input class="cm-input" id="cm-name" value="' + esc(course.name) + '" data-action-blur="cmUpdateName">' +
      '</div>' +
      '<div class="cm-row">' +
        '<div class="cm-field">' +
          '<label class="cm-label">Grade Level</label>' +
          '<input class="cm-input" id="cm-grade" value="' + esc(course.gradeLevel||'') + '" placeholder="e.g. 8, 10-12" data-action-blur="cmUpdateGrade">' +
        '</div>' +
        '<div class="cm-field">' +
          '<label class="cm-label">Stats</label>' +
          '<div style="display:flex;gap:12px;padding:7px 0;font-size:0.78rem;color:var(--text-2)">' +
            '<span><strong>' + studentCount + '</strong> student' + (studentCount!==1?'s':'') + '</span>' +
            '<span><strong>' + assessCount + '</strong> assessment' + (assessCount!==1?'s':'') + '</span>' +
            '<span><strong>' + tagCount + '</strong> standard' + (tagCount!==1?'s':'') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Description</label>' +
        '<textarea class="cm-textarea" id="cm-desc" placeholder="Optional course description\u2026" data-action-blur="cmUpdateDesc">' + esc(course.description||'') + '</textarea>' +
      '</div>' +
    '</div>';

    // Section 2: Students (Roster)
    var students = getStudents(cid);
    html += '<div class="cm-section">' +
      '<div class="cm-section-title" style="display:flex;align-items:center;justify-content:space-between">' +
        '<span>Students <span style="font-weight:400;color:var(--text-3);text-transform:none;letter-spacing:0">(' + students.length + ')</span></span>' +
        (students.length > 1 ? '<button class="cm-add-link" data-action="cmToggleBulk" style="font-size:0.7rem;padding:2px 8px;border-radius:4px;' + (cmBulkMode?'background:var(--active);color:white':'') + '">' + (cmBulkMode?'Exit Bulk Edit':'Bulk Edit') + '</button>' : '') +
      '</div>';
    if (students.length > 0) {
      html += '<div class="cm-student-list">';
      var sorted = sortStudents(students, 'lastName');
      sorted.forEach(function(st) {
        var pref = st.preferred && st.preferred !== st.firstName ? st.preferred : '';
        html += '<div class="cm-student-row">' +
          (cmBulkMode ? '<input type="checkbox" class="cm-bulk-check" ' + (cmBulkSelected.has(st.id)?'checked':'') + ' data-action="cmBulkToggleCheck" data-sid="' + st.id + '">' : '') +
          '<span class="cm-student-name">' + esc(fullName(st)) + '</span>' +
          (pref ? '<span class="cm-student-pref">"' + esc(pref) + '"</span>' : '') +
          (st.designations || []).map(function(code) { var d = BC_DESIGNATIONS[code]; if (!d) return ''; return '<span class="cm-desig-badge' + (d.level > 0 ? ' low-inc' : '') + '" title="' + code + ' \u2014 ' + esc(d.name) + '">' + esc(code) + '</span>'; }).join('') +
          (function() { var ds = st.designations || []; var hasIep = ds.some(function(c) { return BC_DESIGNATIONS[c]?.iep; }); var hasMod = ds.some(function(c) { return BC_DESIGNATIONS[c]?.modified; }); return (hasIep ? '<span class="cm-iep-tag">IEP</span>' : '') + (hasMod ? '<span class="cm-mod-tag">MOD</span>' : ''); })() +
          (st.pronouns ? '<span class="cm-student-pronouns">' + esc(st.pronouns) + '</span>' : '') +
          (st.studentNumber ? '<span style="font-size:0.65rem;color:var(--text-3);font-family:\'SF Mono\',monospace">#' + esc(st.studentNumber) + '</span>' : '') +
          '<div class="cm-student-actions">' +
            '<button class="cm-delete-mini" data-action="cmEditStudent" data-sid="' + st.id + '" title="Edit" style="font-size:0.65rem">\u270E</button>' +
            '<button class="cm-delete-mini" data-action="cmRemoveStudent" data-sid="' + st.id + '" title="Remove">\u2715</button>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:16px;color:var(--text-3);font-size:0.82rem;border:1.5px dashed var(--border);border-radius:var(--radius-sm)">' +
        'No students yet. Add students individually or import a CSV roster.' +
      '</div>';
    }
    // Bulk edit panel
    if (cmBulkMode && students.length > 0) {
      html += '<div class="cm-bulk-panel">' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
          '<button class="cm-add-link" data-action="cmBulkSelectAll" style="font-size:0.7rem">Select All</button>' +
          '<button class="cm-add-link" data-action="cmBulkDeselectAll" style="font-size:0.7rem">Deselect All</button>' +
          '<span style="font-size:0.7rem;color:var(--text-3);margin-left:auto">' + cmBulkSelected.size + ' selected</span>' +
        '</div>' +
        '<div class="cm-student-form" style="gap:8px 12px">' +
          '<div class="cm-field">' +
            '<label class="cm-label">Set Pronouns</label>' +
            pronounsSelect('cm-bulk-pro', '') +
          '</div>' +
          '<div class="cm-field">' +
            '<label class="cm-label">Add Attendance</label>' +
            '<div style="display:flex;gap:6px">' +
              '<input type="date" class="cm-input" id="cm-bulk-att-date" value="' + getTodayStr() + '" style="font-size:0.78rem;flex:1">' +
              '<select class="cm-input" id="cm-bulk-att-status" style="font-size:0.78rem;flex:1">' +
                '<option value="present">Present</option>' +
                '<option value="absent">Absent</option>' +
                '<option value="late">Late</option>' +
                '<option value="excused">Excused</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button class="btn btn-primary" data-action="cmApplyBulk" style="font-size:0.78rem;padding:6px 14px" ' + (cmBulkSelected.size===0?'disabled':'') + '>Apply to Selected</button>' +
        '</div>' +
      '</div>';
    }
    // Add/Edit student form
    html += '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
        '<div class="cm-field"><label class="cm-label">First Name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Last Name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Preferred Name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Pronouns</label>' + pronounsSelect('cm-add-pro', '') + '</div>' +
        '<div class="cm-field"><label class="cm-label">Student Number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field"><label class="cm-label">Date of Birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.82rem;padding:6px 10px"></div>' +
        '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Designations</label>' +
          '<div class="desig-check-grid">' +
            Object.entries(BC_DESIGNATIONS).map(function(entry) { var k = entry[0], v = entry[1]; return '<label class="desig-check-item" title="' + esc(v.desc) + '"><input type="checkbox" class="cm-desig-check" value="' + k + '"><span class="desig-check-code">' + k + '</span><span class="desig-check-name">' + esc(v.name) + '</span></label>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div class="cm-field" style="grid-column:1/-1;display:flex;align-items:flex-end;gap:8px;justify-content:flex-end">' +
          '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.78rem">Cancel</button>' +
          '<button class="btn btn-primary" id="cm-save-btn" data-action="cmSaveStudent" style="padding:6px 14px;font-size:0.78rem">Save</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cm-roster-actions">' +
      '<button class="cm-add-link" data-action="cmShowAddStudent" style="padding:4px 0">+ Add Student</button>' +
      '<span style="color:var(--border)">|</span>' +
      '<button class="cm-add-link" data-action="cmImportRoster" style="padding:4px 0">Import Roster</button>' +
      '<input type="file" id="cm-csv-input" accept=".csv,.txt" style="display:none" data-action-change="cmCSV">' +
    '</div>' +
    '<div id="cm-import-preview"></div>' +
    '</div>';

    html += '</div>'; // close left column

    // RIGHT COLUMN: Grading + Curriculum
    html += '<div class="cm-col">';

    // Section 3: Grading & Calculation
    var gs = course.gradingSystem || 'proficiency';
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Grading System</label>' +
        '<div class="cm-seg">' +
          '<button class="cm-seg-btn' + (gs==='proficiency'?' active':'') + '" data-action="cmSetGradingSystem" data-value="proficiency">Proficiency (1\u20134)</button>' +
          '<button class="cm-seg-btn' + (gs==='letter'?' active':'') + '" data-action="cmSetGradingSystem" data-value="letter">Letter (A\u2013F)</button>' +
          '<button class="cm-seg-btn' + (gs==='points'?' active':'') + '" data-action="cmSetGradingSystem" data-value="points">Points</button>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Calculation Method</label>' +
        '<div class="cm-seg">' +
          '<button class="cm-seg-btn' + (method==='mostRecent'?' active':'') + '" data-action="cmSetCalcMethod" data-value="mostRecent">Most Recent</button>' +
          '<button class="cm-seg-btn' + (method==='highest'?' active':'') + '" data-action="cmSetCalcMethod" data-value="highest">Highest</button>' +
          '<button class="cm-seg-btn' + (method==='mode'?' active':'') + '" data-action="cmSetCalcMethod" data-value="mode">Mode</button>' +
          '<button class="cm-seg-btn' + (method==='decayingAvg'?' active':'') + '" data-action="cmSetCalcMethod" data-value="decayingAvg">Decaying Avg</button>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field" style="' + (method==='decayingAvg'?'':'display:none') + '">' +
        '<label class="cm-label">Decay Weight</label>' +
        '<div class="cm-slider-row">' +
          '<input type="range" min="10" max="95" value="' + Math.round(dw*100) + '" id="cm-decay-slider" data-action-input="cmDecaySlider" style="flex:1">' +
          '<span class="cm-slider-label" id="cm-decay-val">' + Math.round(dw*100) + '%</span>' +
        '</div>' +
        '<div class="cm-hint">Higher values weight recent scores more heavily.</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Category Weights</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;margin-bottom:8px">' +
          '<input type="checkbox" id="cm-cw-enabled" ' + (cwEnabled?'checked':'') + ' data-action-change="cmCwEnabled" style="width:16px;height:16px;accent-color:var(--active)">' +
          'Weight formative assessments separately' +
        '</label>' +
        '<div id="cm-cw-sliders" style="' + (cwEnabled?'':'display:none') + '">' +
          '<div style="display:flex;gap:20px;align-items:center">' +
            '<div style="flex:1">' +
              '<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-2);margin-bottom:4px">' +
                '<span>Summative</span><span>Formative</span>' +
              '</div>' +
              '<input type="range" id="cm-cw-range" min="0" max="100" value="' + Math.round(cw.summative*100) + '" data-action-input="cmCwRange" style="width:100%">' +
              '<div style="display:flex;justify-content:space-between;font-size:0.78rem;font-weight:600;margin-top:2px">' +
                '<span id="cm-cw-summ">' + Math.round(cw.summative*100) + '%</span>' +
                '<span id="cm-cw-form">' + Math.round(cw.formative*100) + '%</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Report Card Format</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer">' +
          '<input type="checkbox" id="cm-report-pct" ' + (cc.reportAsPercentage?'checked':'') + ' data-action-change="cmReportPct" style="width:16px;height:16px;accent-color:var(--active)">' +
          'Report final grade as percentage (recommended for grades 10\u201312)' +
        '</label>' +
        '<div class="cm-hint">When enabled, the overall grade on reports displays as a percentage instead of a proficiency level.</div>' +
      '</div>' +
    '</div>';

    // Section 3: Curriculum -- Subjects
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">Curriculum</div>' +
      '<div class="cm-field">' +
        '<label class="cm-label">Subjects</label>';
    (lm.subjects||[]).forEach(function(sub) {
      html += '<div class="cm-subject-row">' +
        '<div class="cm-subject-color" style="background:' + sub.color + '">' +
          '<input type="color" value="' + sub.color + '" data-action-change="cmSubjectColor" data-subid="' + sub.id + '">' +
        '</div>' +
        '<input class="cm-input" value="' + esc(sub.name) + '" style="flex:1" data-action-blur="cmSubjectName" data-subid="' + sub.id + '">' +
        '<button class="cm-delete-mini" data-action="cmDeleteSubject" data-subid="' + sub.id + '" title="Delete subject" aria-label="Delete subject">\u2715</button>' +
      '</div>';
    });
    html += '<button class="cm-add-link" data-action="cmAddSubject">+ Add Subject</button></div>';

    // Sections & Standards
    html += '<div class="cm-field">' +
      '<label class="cm-label">Sections &amp; Learning Standards</label>';
    if ((lm.sections||[]).length === 0) {
      html += '<div class="cm-curriculum-empty">' +
        '<div class="cm-curriculum-empty-icon">\uD83D\uDCD0</div>' +
        '<div class="cm-curriculum-empty-text">No sections yet. Add a section to start defining your learning standards.</div>' +
      '</div>';
    }
    (lm.sections||[]).forEach(function(sec) {
      var sub = (lm.subjects||[]).find(function(s) { return s.id === sec.subject; });
      var subName = sub ? sub.name : '';
      var subColor = sub ? sub.color : '#999';
      html += '<div class="cm-sec-group" id="cm-sec-' + sec.id + '">' +
        '<div class="cm-sec-header" data-action="cmToggleSec">' +
          '<div class="cm-sec-header-top">' +
            '<span class="cm-sec-chevron">\u25B6</span>' +
            '<div class="cm-sec-color-bar" style="background:' + sec.color + '"></div>' +
            '<span class="cm-sec-name-display">' + esc(sec.name) + '</span>' +
            '<span class="cm-sec-count">' + sec.tags.length + ' standard' + (sec.tags.length!==1?'s':'') + '</span>' +
          '</div>' +
          '<div class="cm-sec-header-meta">' +
            '<span class="cm-sec-subject-badge"><span class="cm-sec-subject-dot" style="background:' + subColor + '"></span>' + esc(subName) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cm-sec-body">' +
          '<div class="cm-sec-edit-row">' +
            '<div class="cm-sec-edit-name">' +
              '<label class="cm-label">Section Name</label>' +
              '<input class="cm-input" value="' + esc(sec.name) + '" style="font-weight:600;font-size:0.82rem" data-stop-prop="true" data-action-blur="cmSecName" data-secid="' + sec.id + '">' +
            '</div>' +
            '<div class="cm-sec-edit-subject">' +
              '<label class="cm-label">Subject</label>' +
              '<select class="cm-input" style="font-size:0.78rem" data-stop-prop="true" data-action-change="cmSecSubject" data-secid="' + sec.id + '">' +
                (lm.subjects||[]).map(function(s) { return '<option value="' + s.id + '"' + (s.id===sec.subject?' selected':'') + '>' + esc(s.name) + '</option>'; }).join('') +
              '</select>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:flex-end">' +
              '<div>' +
                '<label class="cm-label">Color</label>' +
                '<div class="cm-sec-color-dot" style="background:' + sec.color + ';width:32px;height:32px;border-radius:8px;margin-top:2px">' +
                  '<input type="color" value="' + sec.color + '" data-stop-prop="true" data-action-change="cmSecColor" data-secid="' + sec.id + '">' +
                '</div>' +
              '</div>' +
              '<button class="cm-delete-mini" data-action="cmDeleteSec" data-stop-prop="true" data-secid="' + sec.id + '" title="Delete section" style="width:32px;height:32px;margin-bottom:2px">\u2715</button>' +
            '</div>' +
          '</div>';
      sec.tags.forEach(function(tag) {
        html += '<div class="cm-tag-row">' +
          '<span class="cm-tag-id" style="color:' + sec.color + '">' + esc(tag.id) + '</span>' +
          '<div class="cm-tag-fields">' +
            '<input class="cm-input" value="' + esc(tag.label) + '" placeholder="Standard label" style="padding:5px 8px;font-size:0.82rem;font-weight:500" data-action-blur="cmTagLabel" data-secid="' + sec.id + '" data-tagid="' + tag.id + '">' +
            '<textarea class="cm-textarea" placeholder="I can\u2026 statement" style="min-height:34px;padding:5px 8px;font-size:0.78rem" data-action-blur="cmTagText" data-secid="' + sec.id + '" data-tagid="' + tag.id + '">' + esc(tag.text||'') + '</textarea>' +
          '</div>' +
          '<button class="cm-delete-mini" data-action="cmDeleteTag" data-secid="' + sec.id + '" data-tagid="' + tag.id + '" title="Delete tag" aria-label="Delete tag" style="margin-top:4px">\u2715</button>' +
        '</div>';
      });
      html += '<button class="cm-add-link" data-action="cmAddTag" data-secid="' + sec.id + '">+ Add Standard</button>' +
        '</div></div>';
    });
    html += '<button class="cm-add-link" data-action="cmAddSec">+ Add Section</button></div></div>';

    // Section 4: BC Curriculum Link
    var linkedTags = course.curriculumTags || [];
    html += '<div class="cm-section">' +
      '<div class="cm-section-title">BC Curriculum Link</div>';
    if (linkedTags.length > 0) {
      linkedTags.forEach(function(tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        var courseName = courseData ? courseData.course_name : tag;
        html += '<div class="cm-curric-link">' +
          '<span class="cm-curric-tag">' + esc(tag) + '</span>' +
          '<span class="cm-curric-name">' + esc(courseName) + '</span>' +
        '</div>';
      });
      html += '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' + cid + '">Re-link Curriculum</button>';
    } else {
      html += '<div class="cm-curric-unlinked">Not linked to BC Curriculum</div>' +
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' + cid + '">Link to BC Curriculum</button>';
    }
    html += '</div>';

    html += '</div>'; // close right column

    // Actions row
    var isArchived = cc.archived || false;
    html += '<div class="cm-actions-row">' +
      '<button class="cm-action-btn" data-action="cmDuplicateCourse" data-cid="' + cid + '">\u29C9 Duplicate Class</button>' +
      '<button class="cm-action-btn" data-action="cmToggleArchive" data-cid="' + cid + '">' + (isArchived ? '\uD83D\uDCE6 Unarchive Class' : '\uD83D\uDCE6 Archive Class') + '</button>' +
    '</div>';

    // Danger Zone
    html += '<div class="cm-danger-zone">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<button class="cm-danger-btn" data-action="cmDeleteCourse">Delete "' + esc(course.name) + '"</button>' +
        '<span class="cm-hint" style="margin:0">Permanently removes all data for this class.</span>' +
      '</div>' +
    '</div>';

    html += '</div>'; // close cm-detail-inner
    return html;
  }

  /* ── CM Actions ─────────────────────────────────────────── */
  function cmSelectClass(cid) {
    cmSelectedCourse = cid;
    cmMode = 'edit';
    _render();
  }

  function cmStartCreate() {
    cmMode = 'create';
    cmSelectedCourse = null;
    DashCurriculumWizard.resetState();
    loadCurriculumIndex().then(function(idx) {
      DashCurriculumWizard.setCurriculumLoaded(!!idx, !idx);
      if (cmMode === 'create' && DashCurriculumWizard.getState().cwStep === 1) renderClassManager();
    });
    _render();
  }

  function cmCancelCreate(activeCourse) {
    cmMode = 'edit';
    cmSelectedCourse = activeCourse;
    _render();
  }

  function cmCreateToggle(btn, containerId) {
    document.querySelectorAll('#'+containerId+' .cm-seg-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }

  /* ── CM Edit Actions ────────────────────────────────────── */
  function cmUpdateField(field, value, inputEl) {
    if (!cmSelectedCourse) return;
    if (field === 'name' && !value.trim()) {
      if (inputEl) { inputEl.style.border = '2px solid var(--score-1)'; inputEl.placeholder = 'Class name is required'; inputEl.oninput = function() { this.style.border = ''; }; inputEl.focus(); }
      return;
    }
    updateCourse(cmSelectedCourse, { [field]: value.trim() });
    var nameEl = document.querySelector('.cm-class-item.selected .cm-class-name');
    if (field === 'name' && nameEl) nameEl.textContent = value.trim();
  }

  function cmSetGradingSystem(val) {
    if (!cmSelectedCourse) return;
    updateCourse(cmSelectedCourse, { gradingSystem: val });
    _render();
  }

  function cmSetCalcMethod(val) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.calcMethod = val;
    saveCourseConfig(cmSelectedCourse, cc);
    updateCourse(cmSelectedCourse, { calcMethod: val });
    _render();
  }

  function cmUpdateDecay(val) {
    if (!cmSelectedCourse) return;
    document.getElementById('cm-decay-val').textContent = val + '%';
    var cc = getCourseConfig(cmSelectedCourse);
    cc.decayWeight = parseInt(val) / 100;
    saveCourseConfig(cmSelectedCourse, cc);
    updateCourse(cmSelectedCourse, { decayWeight: parseInt(val) / 100 });
  }

  function cmToggleReportPct(on) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.reportAsPercentage = on;
    saveCourseConfig(cmSelectedCourse, cc);
  }

  function cmToggleCatWeights(on) {
    document.getElementById('cm-cw-sliders').style.display = on ? '' : 'none';
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    if (!on) { cc.categoryWeights = { summative:1.0, formative:0.0 }; }
    saveCourseConfig(cmSelectedCourse, cc);
  }

  function cmUpdateCatWeights(val) {
    var summ = parseInt(val);
    var form = 100 - summ;
    document.getElementById('cm-cw-summ').textContent = summ + '%';
    document.getElementById('cm-cw-form').textContent = form + '%';
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.categoryWeights = { summative: summ/100, formative: form/100 };
    saveCourseConfig(cmSelectedCourse, cc);
  }

  /* ── Re-link Curriculum ─────────────────────────────────── */
  function cmStartRelink(cid) {
    cmRelinkCid = cid;
    cmRelinkStep = 1;
    var cwState = DashCurriculumWizard.getState();
    DashCurriculumWizard.setGrade(null);
    DashCurriculumWizard.setSubject(null);
    var course = COURSES[cid];
    DashCurriculumWizard.setSelectedTags(course && course.curriculumTags ? course.curriculumTags.slice() : []);
    DashCurriculumWizard.setCurriculumLoaded(false, false);
    loadCurriculumIndex().then(function(idx) {
      DashCurriculumWizard.setCurriculumLoaded(!!idx, !idx);
      renderClassManager();
    });
    renderClassManager();
  }

  function cmRelinkCancel() {
    cmRelinkCid = null;
    cmRelinkStep = 0;
    DashCurriculumWizard.setSelectedTags([]);
    renderClassManager();
  }

  function cmRelinkNext() {
    if (DashCurriculumWizard.getState().cwSelectedTags.length === 0) return;
    cmRelinkStep = 2;
    renderClassManager();
  }

  function cmRelinkConfirm(mode) {
    var cwSelectedTags = DashCurriculumWizard.getState().cwSelectedTags;
    if (!cmRelinkCid || cwSelectedTags.length === 0) return;
    var cid = cmRelinkCid;

    if (mode === 'replace') {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        saveLearningMap(cid, map);
        updateCourse(cid, { curriculumTags: cwSelectedTags.slice() });
      }
    } else if (mode === 'merge') {
      var existing = getLearningMap(cid);
      var newMap = buildLearningMapFromTags(cwSelectedTags);
      if (newMap) {
        var existingSubIds = new Set((existing.subjects || []).map(function(s) { return s.id; }));
        (newMap.subjects || []).forEach(function(s) {
          if (!existingSubIds.has(s.id)) existing.subjects.push(s);
        });
        var existingSecIds = new Set((existing.sections || []).map(function(s) { return s.id; }));
        (newMap.sections || []).forEach(function(s) {
          if (!existingSecIds.has(s.id)) {
            existing.sections.push(s);
          } else {
            var existingSec = existing.sections.find(function(es) { return es.id === s.id; });
            var existingTagIds = new Set(existingSec.tags.map(function(t) { return t.id; }));
            s.tags.forEach(function(t) {
              if (!existingTagIds.has(t.id)) existingSec.tags.push(t);
            });
          }
        });
        existing._customized = true;
        saveLearningMap(cid, existing);
        var allTags = new Set((COURSES[cid].curriculumTags || []).concat(cwSelectedTags));
        updateCourse(cid, { curriculumTags: Array.from(allTags) });
      }
    }

    cmRelinkCid = null;
    cmRelinkStep = 0;
    DashCurriculumWizard.setSelectedTags([]);
    renderClassManager();
  }

  function renderCmRelinkPanel(cid) {
    var cwState = DashCurriculumWizard.getState();
    var cwSelectedGrade = cwState.cwSelectedGrade;
    var cwSelectedSubject = cwState.cwSelectedSubject;
    var cwSelectedTags = cwState.cwSelectedTags;
    var cwCurriculumLoaded = cwState.cwCurriculumLoaded;
    var cwLoadError = cwState.cwLoadError;
    var html = '';

    if (cmRelinkStep === 1) {
      html += '<div class="cm-section"><div class="cm-section-title">Re-link to BC Curriculum</div>';

      if (!cwCurriculumLoaded && !cwLoadError) {
        html += '<div class="cw-empty-msg">Loading BC Curriculum data\u2026</div>';
      } else if (cwLoadError) {
        html += '<div class="cw-empty-msg">Could not load BC Curriculum data.</div>';
      } else {
        html += '<div class="cm-field"><label class="cm-label">Grade</label><div class="cw-grade-row">';
        [8, 9, 10, 11, 12].forEach(function(g) {
          html += '<button class="cw-grade-btn' + (cwSelectedGrade === g ? ' active' : '') + '" data-action="cwSelectGrade" data-grade="' + g + '">Grade ' + g + '</button>';
        });
        html += '</div></div>';

        if (cwSelectedGrade) {
          var subjects = getSubjectsByGrade(cwSelectedGrade);
          html += '<div class="cm-field"><label class="cm-label">Subject</label><div class="cw-subject-row">';
          subjects.forEach(function(s) {
            html += '<button class="cw-subject-btn' + (cwSelectedSubject === s ? ' active' : '') + '" data-action="cwSelectSubject" data-subject="' + esc(s) + '">' + esc(s) + '</button>';
          });
          html += '</div></div>';

          var courses = getCoursesByGrade(cwSelectedGrade);
          if (cwSelectedSubject) courses = courses.filter(function(c) { return c.subject === cwSelectedSubject; });

          if (courses.length > 0) {
            html += '<div class="cm-field"><label class="cm-label">Courses</label><div class="cw-course-list">';
            courses.forEach(function(c) {
              var sel = cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
              var fullCourse = CURRICULUM_INDEX[c.short_tag];
              var compCount = 0, catCount = 0;
              if (fullCourse && fullCourse.categories) {
                catCount = fullCourse.categories.length;
                fullCourse.categories.forEach(function(cat) { compCount += (cat.competencies || []).length; });
              }
              html += '<div class="cw-course-item' + sel + '" data-action="cwToggleCourse" data-tag="' + esc(c.short_tag) + '">' +
                '<span class="cw-course-check">' + (sel ? '\u2713' : '') + '</span>' +
                '<span class="cw-course-name">' + esc(c.course_name) + '</span>' +
                '<span class="cw-course-tag">' + esc(c.short_tag) + '</span>' +
                '<span class="cw-course-count">' + catCount + ' categories \u00B7 ' + compCount + ' standards</span>' +
              '</div>';
            });
            html += '</div></div>';
          }
        }

        if (cwSelectedTags.length > 0) {
          var totalComps = 0;
          cwSelectedTags.forEach(function(tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function(cat) { totalComps += (cat.competencies || []).length; });
            }
          });
          html += '<div class="cw-selection-summary"><strong>' + cwSelectedTags.length + '</strong> course' + (cwSelectedTags.length !== 1 ? 's' : '') + ' selected \u00B7 <strong>' + totalComps + '</strong> competencies</div>';
        }
      }

      html += '<div class="cm-relink-actions">' +
        '<button class="btn btn-ghost" data-action="cmRelinkCancel">Cancel</button>' +
        '<button class="btn btn-primary" data-action="cmRelinkNext"' + (cwSelectedTags.length === 0 ? ' disabled style="opacity:0.5;pointer-events:none"' : '') + '>Next</button>' +
      '</div></div>';

    } else if (cmRelinkStep === 2) {
      var course = COURSES[cid];
      var existingTags = course.curriculumTags || [];
      var tagCount = getAllTags(cid).length;

      html += '<div class="cm-section"><div class="cm-section-title">Confirm Curriculum Change</div>';

      html += '<div class="cm-field"><label class="cm-label">New Curriculum Link</label>';
      cwSelectedTags.forEach(function(tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        html += '<div class="cm-curric-link"><span class="cm-curric-tag">' + esc(tag) + '</span><span class="cm-curric-name">' + esc(courseData ? courseData.course_name : tag) + '</span></div>';
      });
      html += '</div>';

      if (tagCount > 0) {
        html += '<div class="cm-relink-warning">This class currently has <strong>' + tagCount + '</strong> learning standards with existing score data. Choose how to handle the change:</div>';
      }

      html += '<div class="cm-relink-actions" style="flex-direction:column;gap:8px">';
      if (tagCount > 0) {
        html += '<button class="btn btn-primary" data-action="cmRelinkConfirm" data-mode="merge" style="width:100%;text-align:left;padding:12px 16px"><strong>Merge</strong> \u2014 Add new standards, keep existing ones and all scores</button>' +
          '<button class="cm-relink-btn" data-action="cmRelinkConfirm" data-mode="replace" style="width:100%;text-align:left;padding:12px 16px;border-color:var(--score-2);color:var(--score-2)"><strong>Replace</strong> \u2014 Remove current standards and replace with curriculum. Existing scores may be orphaned.</button>';
      } else {
        html += '<button class="btn btn-primary" data-action="cmRelinkConfirm" data-mode="replace">Apply Curriculum</button>';
      }
      html += '<button class="btn btn-ghost" data-action="cmRelinkBack">Back</button></div></div>';
    }

    return html;
  }

  /* ── CM Delete / Archive / Duplicate ────────────────────── */
  function cmDeleteCourse(activeCourse, setActiveCourse) {
    if (!cmSelectedCourse) return;
    var name = COURSES[cmSelectedCourse].name;
    showConfirm('Delete "' + name + '"',
      'This permanently removes all students, assessments, scores, and settings. This cannot be undone.',
      'Delete Class', 'danger', function() {
        var wasActive = (cmSelectedCourse === activeCourse);
        deleteCourseData(cmSelectedCourse);
        var remaining = Object.keys(COURSES);
        var newActive = null;
        if (remaining.length > 0) {
          cmSelectedCourse = remaining[0];
          if (wasActive) { newActive = remaining[0]; }
        } else {
          cmSelectedCourse = null;
          if (wasActive) { newActive = null; }
        }
        cmMode = 'edit';
        if (wasActive && setActiveCourse) setActiveCourse(newActive);
        _render();
      }
    );
  }

  function cmToggleArchive(cid) {
    var cc = getCourseConfig(cid);
    cc.archived = !cc.archived;
    saveCourseConfig(cid, cc);
    renderClassManager();
  }

  function cmDuplicateCourse(sourceCid) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var newCourse = createCourse({
      name: src.name + ' (Copy)',
      gradeLevel: src.gradeLevel || '',
      description: src.description || '',
      gradingSystem: src.gradingSystem || 'proficiency',
      calcMethod: src.calcMethod || 'mostRecent',
      decayWeight: src.decayWeight || 0.65
    });
    var srcCC = getCourseConfig(sourceCid);
    if (Object.keys(srcCC).length > 0) {
      saveCourseConfig(newCourse.id, structuredClone(srcCC));
    }
    var srcMap = getLearningMap(sourceCid);
    if (srcMap && (srcMap.subjects?.length || srcMap.sections?.length)) {
      var clone = structuredClone(srcMap);
      clone._customized = true;
      clone._version = 1;
      saveLearningMap(newCourse.id, clone);
    }
    cmSelectedCourse = newCourse.id;
    cmMode = 'edit';
    _render();
  }

  /* ── CM Curriculum Editing ──────────────────────────────── */
  function cmAddSubject() {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var id = 'subj' + Date.now().toString(36);
    map.subjects.push({ id: id, name:'New Subject', color:'#6366f1' });
    saveLearningMap(cmSelectedCourse, map);
    _render();
  }

  function cmUpdateSubjectName(subId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sub = map.subjects.find(function(s) { return s.id === subId; });
    if (sub) { sub.name = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateSubjectColor(subId, color) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sub = map.subjects.find(function(s) { return s.id === subId; });
    if (sub) { sub.color = color; saveLearningMap(cmSelectedCourse, map); _render(); }
  }

  function cmDeleteSubject(subId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sectionCount = map.sections.filter(function(s) { return s.subject === subId; }).length;
    if (sectionCount > 0) {
      showConfirm('Delete Subject', 'This subject has ' + sectionCount + ' section(s). Delete them too?',
        'Delete All', 'danger', function() {
          map.subjects = map.subjects.filter(function(s) { return s.id !== subId; });
          map.sections = map.sections.filter(function(s) { return s.subject !== subId; });
          saveLearningMap(cmSelectedCourse, map);
          _render();
        });
    } else {
      map.subjects = map.subjects.filter(function(s) { return s.id !== subId; });
      saveLearningMap(cmSelectedCourse, map);
      _render();
    }
  }

  function cmAddSec() {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (map.subjects.length === 0) {
      map.subjects.push({ id:'subj1', name:'General', color:'#6366f1' });
    }
    var subId = map.subjects[0].id;
    var secId = 'S' + Date.now().toString(36).slice(-4).toUpperCase();
    map.sections.push({
      id: secId, subject: subId, name:'New Section', shortName:'New',
      color: map.subjects.find(function(s) { return s.id===subId; })?.color || '#6366f1',
      tags: [{ id: secId+'1', label:'New Standard', text:'' }]
    });
    saveLearningMap(cmSelectedCourse, map);
    _render();
    requestAnimationFrame(function() {
      var el = document.getElementById('cm-sec-'+secId);
      if (el) { el.classList.add('open'); el.scrollIntoView({behavior:'smooth',block:'center'}); }
    });
  }

  function cmUpdateSecName(secId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (sec) { sec.name = val.trim(); sec.shortName = val.trim().split(' ')[0]; saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateSecSubject(secId, subId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (sec) { sec.subject = subId; saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateSecColor(secId, color) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (sec) { sec.color = color; saveLearningMap(cmSelectedCourse, map); _render(); }
  }

  function cmDeleteSec(secId) {
    showConfirm('Delete Section', 'Delete this section and all its tags? Existing scores are preserved.',
      'Delete', 'danger', function() {
        var map = ensureCustomLearningMap(cmSelectedCourse);
        map.sections = map.sections.filter(function(s) { return s.id !== secId; });
        saveLearningMap(cmSelectedCourse, map);
        _render();
      });
  }

  function cmToggleSec(headerEl) {
    var group = headerEl.closest('.cm-sec-group');
    group.classList.toggle('open');
  }

  function cmAddTag(secId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (!sec) return;
    sec.tags.push({ id: uid(), label:'New Standard', text:'' });
    saveLearningMap(cmSelectedCourse, map);
    _render();
    requestAnimationFrame(function() {
      var el = document.getElementById('cm-sec-'+secId);
      if (el) el.classList.add('open');
    });
  }

  function cmUpdateTagLabel(secId, tagId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    var tag = sec?.tags.find(function(t) { return t.id === tagId; });
    if (tag) { tag.label = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmUpdateTagText(secId, tagId, val) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    var tag = sec?.tags.find(function(t) { return t.id === tagId; });
    if (tag) { tag.text = val.trim(); saveLearningMap(cmSelectedCourse, map); }
  }

  function cmDeleteTag(secId, tagId) {
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function(s) { return s.id === secId; });
    if (sec) {
      sec.tags = sec.tags.filter(function(t) { return t.id !== tagId; });
      saveLearningMap(cmSelectedCourse, map);
      _render();
      requestAnimationFrame(function() {
        var el = document.getElementById('cm-sec-'+secId);
        if (el) el.classList.add('open');
      });
    }
  }

  function cmRelinkBack() {
    cmRelinkStep = 1;
    renderClassManager();
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    getState: getState,
    resetState: resetState,
    setRenderFn: setRenderFn,
    deleteStudentUI: deleteStudentUI,
    cmShowAddStudent: cmShowAddStudent,
    cmCancelStudent: cmCancelStudent,
    cmSaveStudent: cmSaveStudent,
    cmEditStudent: cmEditStudent,
    cmRemoveStudent: cmRemoveStudent,
    cmToggleBulk: cmToggleBulk,
    cmBulkToggle: cmBulkToggle,
    cmBulkSelectAll: cmBulkSelectAll,
    cmBulkDeselectAll: cmBulkDeselectAll,
    cmApplyBulk: cmApplyBulk,
    cmImportRoster: cmImportRoster,
    cmHandleCSV: cmHandleCSV,
    cmShowImportPreview: cmShowImportPreview,
    cmConfirmImport: cmConfirmImport,
    cmCancelImport: cmCancelImport,
    openClassManager: openClassManager,
    closeClassManager: closeClassManager,
    renderClassManager: renderClassManager,
    renderCmSidebar: renderCmSidebar,
    renderCmDetail: renderCmDetail,
    renderCmRelinkPanel: renderCmRelinkPanel,
    cmSelectClass: cmSelectClass,
    cmStartCreate: cmStartCreate,
    cmCancelCreate: cmCancelCreate,
    cmCreateToggle: cmCreateToggle,
    cmUpdateField: cmUpdateField,
    cmSetGradingSystem: cmSetGradingSystem,
    cmSetCalcMethod: cmSetCalcMethod,
    cmUpdateDecay: cmUpdateDecay,
    cmToggleReportPct: cmToggleReportPct,
    cmToggleCatWeights: cmToggleCatWeights,
    cmUpdateCatWeights: cmUpdateCatWeights,
    cmStartRelink: cmStartRelink,
    cmRelinkCancel: cmRelinkCancel,
    cmRelinkNext: cmRelinkNext,
    cmRelinkConfirm: cmRelinkConfirm,
    cmRelinkBack: cmRelinkBack,
    cmDeleteCourse: cmDeleteCourse,
    cmToggleArchive: cmToggleArchive,
    cmDuplicateCourse: cmDuplicateCourse,
    cmAddSubject: cmAddSubject,
    cmUpdateSubjectName: cmUpdateSubjectName,
    cmUpdateSubjectColor: cmUpdateSubjectColor,
    cmDeleteSubject: cmDeleteSubject,
    cmAddSec: cmAddSec,
    cmUpdateSecName: cmUpdateSecName,
    cmUpdateSecSubject: cmUpdateSecSubject,
    cmUpdateSecColor: cmUpdateSecColor,
    cmDeleteSec: cmDeleteSec,
    cmToggleSec: cmToggleSec,
    cmAddTag: cmAddTag,
    cmUpdateTagLabel: cmUpdateTagLabel,
    cmUpdateTagText: cmUpdateTagText,
    cmDeleteTag: cmDeleteTag
  };
})();
