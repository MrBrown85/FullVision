/* ── assign-form.js — Assessment form submodule ──────────────── */
window.AssignForm = (function() {
  'use strict';

  /* ── State used only by the form ──────────────────────────── */
  var newType = 'summative';
  var newCollaboration = 'individual';
  var collabExcluded = new Set();
  var collabPairs = [];
  var collabGroups = [];
  var collabGroupCount = 4;
  var collabPairMode = 'random';
  var collabGroupMode = 'random';
  var _dragSid = null;
  var _dragFromGroup = null;
  var _rubricAutoTags = [];

  /* ── Getters for state (used by page-assignments) ─────────── */
  function getNewType() { return newType; }
  function setNewType(t) { newType = t; }
  function getNewCollaboration() { return newCollaboration; }
  function setNewCollaboration(c) { newCollaboration = c; }
  function getCollabExcluded() { return collabExcluded; }
  function getCollabPairs() { return collabPairs; }
  function getCollabGroups() { return collabGroups; }
  function getCollabGroupCount() { return collabGroupCount; }

  /* ── Reset form state (called from showNewForm / init) ────── */
  function resetFormState() {
    newType = 'summative';
    newCollaboration = 'individual';
    collabExcluded = new Set();
    collabPairs = [];
    collabGroups = [];
    collabGroupCount = 4;
    collabPairMode = 'random';
    collabGroupMode = 'random';
    _rubricAutoTags = [];
  }

  /* ── Assessment Form ──────────────────────────────────────── */
  function renderAssessForm(cid, assess) {
    var sections = getSections(cid);
    var isEdit = !!assess;
    var title = assess ? assess.title : '';
    var dateAssigned = assess ? (assess.dateAssigned || assess.date || '') : new Date().toISOString().slice(0,10);
    var dateDue = assess ? (assess.date || '') : new Date().toISOString().slice(0,10);
    var dueDate = assess ? (assess.dueDate || '') : '';
    var type = assess ? assess.type : 'summative';
    var selTags = assess ? (assess.tagIds||[]) : [];
    var evidence = assess ? assess.evidenceType : 'written';
    var description = assess ? (assess.description || '') : '';
    var moduleId = assess ? (assess.moduleId || '') : '';
    var collaboration = assess ? (assess.collaboration || 'individual') : 'individual';
    newCollaboration = collaboration;
    var allModules = getModules(cid);
    var scoreMode = assess ? (assess.scoreMode || 'proficiency') : 'proficiency';
    var maxPoints = assess ? (assess.maxPoints || 100) : 100;
    var weight = assess ? (assess.weight || 1) : 1;

    var html = '';

    // Title
    html += '<div class="af-field">' +
      '<label class="af-label">Assignment Title</label>' +
      '<input class="af-input" id="af-title" type="text" value="' + esc(title) + '" placeholder="e.g. Persuasive Essay \u2014 Rights & Freedoms">' +
    '</div>';

    // Description
    html += '<div class="af-field">' +
      '<label class="af-label">Description</label>' +
      '<textarea class="af-textarea" id="af-desc" rows="1" placeholder="Describe the assignment, expectations, and criteria\u2026">' + esc(description) + '</textarea>' +
    '</div>';

    // Rubric selector
    var rubricsList = getRubrics(cid);
    var selRubricId = assess ? (assess.rubricId || '') : '';
    html += '<div class="af-field">' +
      '<label class="af-label">Rubric</label>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<select class="af-rubric-select" id="af-rubric" data-action-change="onRubricSelect" style="flex:1">' +
          '<option value="">None</option>' +
          rubricsList.map(function(r) { return '<option value="' + r.id + '"' + (r.id===selRubricId?' selected':'') + '>' + esc(r.name) + ' (' + r.criteria.length + ' criteria)</option>'; }).join('') +
        '</select>' +
        '<button type="button" class="btn btn-ghost" data-action="newRubricFromForm" style="white-space:nowrap;font-size:0.78rem;padding:7px 12px">+ New Rubric</button>' +
      '</div>' +
      (selRubricId ? '<div class="af-rubric-info">Rubric tags are auto-selected below. You can add additional tags.</div>' : '') +
    '</div>';

    // Dates
    var today = new Date().toISOString().slice(0,10);
    var defaultDue = dueDate || (function() { var d = new Date((dateAssigned || today) + 'T12:00:00'); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10); })();
    var todayFormatted = new Date(today+'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
    html += '<div class="af-row" style="align-items:end">' +
      '<div class="af-field" style="flex:0 0 auto">' +
        '<label class="af-label">Today\'s Date</label>' +
        '<div style="font-family:var(--font-base);font-size:0.88rem;font-weight:500;color:var(--text);padding:8px 0;white-space:nowrap">' + todayFormatted + '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:1;max-width:200px">' +
        '<label class="af-label">Date Assigned</label>' +
        '<input class="af-input" id="af-date-assigned" type="date" value="' + dateAssigned + '" data-action-change="autoSetDueDate">' +
      '</div>' +
      '<div class="af-field" style="flex:1;max-width:200px">' +
        '<label class="af-label">Due Date (optional)</label>' +
        '<input class="af-input" id="af-due" type="date" value="' + defaultDue + '">' +
      '</div>' +
    '</div>';

    // Type, Evidence, Collaboration, Module
    html += '<div class="af-row">' +
      '<div class="af-field" style="flex:1">' +
        '<label class="af-label">Type</label>' +
        '<div class="af-type-toggle">' +
          '<button class="af-type-btn' + (type==='summative'?' active':'') + '" id="af-type-sum" data-action="setType" data-type="summative">Summative</button>' +
          '<button class="af-type-btn' + (type==='formative'?' active':'') + '" id="af-type-form" data-action="setType" data-type="formative">Formative</button>' +
        '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:1">' +
        '<label class="af-label">Evidence Type</label>' +
        '<select class="af-input" id="af-evidence">' + ['written','observation','audio','video','photo','conversation'].map(function(t) { return '<option value="' + t + '"' + (t===evidence?' selected':'') + '>' + t[0].toUpperCase()+t.slice(1) + '</option>'; }).join('') + '</select>' +
      '</div>' +
      '<div class="af-field" style="flex:1.3;min-width:210px">' +
        '<label class="af-label">Collaboration</label>' +
        '<div class="af-type-toggle">' +
          '<button class="af-type-btn af-collab-btn' + (collaboration==='individual'?' active':'') + '" data-collab="individual" data-action="setCollaboration">Individual</button>' +
          '<button class="af-type-btn af-collab-btn' + (collaboration==='pair'?' active':'') + '" data-collab="pair" data-action="setCollaboration">Pair</button>' +
          '<button class="af-type-btn af-collab-btn' + (collaboration==='group'?' active':'') + '" data-collab="group" data-action="setCollaboration">Group</button>' +
        '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:1">' +
        '<label class="af-label">Module</label>' +
        '<select class="af-input" id="af-module">' +
          '<option value="">No Module</option>' +
          allModules.map(function(u) { return '<option value="' + u.id + '"' + (u.id===moduleId?' selected':'') + '>' + esc(u.name) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div id="collab-panel-mount"></div>';

    // Scoring mode & weight
    html += '<div class="af-row" style="align-items:end">' +
      '<div class="af-field" style="flex:0 0 auto">' +
        '<label class="af-label">Scoring Mode</label>' +
        '<input type="hidden" id="af-scoremode" value="' + scoreMode + '">' +
        '<div class="af-type-toggle">' +
          '<button type="button" class="af-type-btn af-scoremode-btn' + (scoreMode==='proficiency'?' active':'') + '" data-mode="proficiency" data-action="setScoreMode">Proficiency</button>' +
          '<button type="button" class="af-type-btn af-scoremode-btn' + (scoreMode==='points'?' active':'') + '" data-mode="points" data-action="setScoreMode">Points</button>' +
        '</div>' +
      '</div>' +
      '<div class="af-field" id="af-maxpoints-wrap" style="flex:0 0 auto;' + (scoreMode==='points'?'':'display:none') + '">' +
        '<label class="af-label">Max Points</label>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<input class="af-input" id="af-maxpoints" type="number" min="1" max="9999" value="' + maxPoints + '" style="width:80px;text-align:center">' +
          '<div id="af-maxpoints-wrap" style="display:flex;gap:4px">' + [10,25,50,100].map(function(v) { return '<button type="button" class="af-chip' + (maxPoints===v?' active':'') + '" data-action="setMaxPoints" data-value="' + v + '" style="padding:4px 8px;font-size:0.72rem;border-radius:6px;border:1px solid var(--border);background:' + (maxPoints===v?'var(--primary)':'var(--bg-2)') + ';color:' + (maxPoints===v?'#fff':'var(--text-2)') + ';cursor:pointer">' + v + '</button>'; }).join('') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="af-field" style="flex:0 0 auto">' +
        '<label class="af-label">Weight</label>' +
        '<select class="af-input" id="af-weight" style="width:80px">' +
          [0.5,1,1.5,2,3].map(function(w) { return '<option value="' + w + '"' + (w===weight?' selected':'') + '>' + w + 'x</option>'; }).join('') +
        '</select>' +
      '</div>' +
    '</div>';

    // Tags
    html += '<div class="af-field">' +
      '<label class="af-label">Learning Outcomes</label>' +
      '<div class="af-tags-container">';
    sections.forEach(function(sec) {
      var checkedCount = sec.tags.filter(function(t) { return selTags.includes(t.id); }).length;
      var hasChecked = checkedCount > 0;
      html += '<div class="af-section-group' + (hasChecked ? ' af-section-open' : '') + '">' +
        '<div class="af-section-header" style="border-left-color:' + sec.color + '" data-action="toggleSectionOpen">' +
          '<span class="af-section-chevron">\u25B6</span>' +
          '<span class="af-section-name" style="color:' + sec.color + '">' + esc(sec.name) + '</span>' +
          (checkedCount > 0 ? '<span class="af-section-badge" style="background:' + sec.color + '">' + checkedCount + '</span>' : '') +
          '<button class="af-select-all" data-action="toggleSectionTags" data-secid="' + sec.id + '" data-stop-prop="true">Select All</button>' +
        '</div>' +
        '<div class="af-section-tags">';
      sec.tags.forEach(function(tag) {
        var checked = selTags.includes(tag.id);
        html += '<label class="af-tag-item' + (checked?' checked':'') + '" data-section="' + sec.id + '">' +
          '<input type="checkbox" value="' + tag.id + '" class="af-tag-cb" data-section="' + sec.id + '"' + (checked?' checked':'') + ' data-action-change="tagCheckbox">' +
          '<span class="af-tag-id" style="color:' + sec.color + '">' + esc(tag.id) + '</span>' +
          '<span class="af-tag-name">' + esc(tag.label) + '</span>' +
        '</label>';
      });
      html += '</div></div>';
    });
    html += '</div></div>';

    // Core Competencies
    var selCC = assess ? (assess.coreCompetencyIds || []) : [];
    html += '<div class="af-field">' +
      '<label class="af-label">Core Competencies</label>' +
      '<div class="af-cc-chips">';
    CORE_COMPETENCIES.forEach(function(cc) {
      var sel = selCC.includes(cc.id);
      html += '<button type="button" class="af-cc-chip' + (sel?' active':'') + '" data-cc="' + cc.id + '"' +
        ' style="--cc-color:' + cc.color + '" data-action="toggleActive">' +
        '<span class="af-cc-dot" style="background:' + cc.color + '"></span>' + esc(cc.label) +
      '</button>';
    });
    html += '</div></div>';

    // Actions
    html += '<div class="af-actions">' +
      '<button class="btn btn-ghost" data-action="hideNewForm">Cancel</button>' +
      '<button class="btn btn-primary" data-action="' + (isEdit ? 'saveEditAssess' : 'saveNewAssess') + '" data-aid="' + (isEdit ? assess.id : '') + '">' + (isEdit ? 'Save Changes' : 'Create Assessment') + '</button>' +
    '</div>';

    return html;
  }

  /* ── Form helpers ─────────────────────────────────────────── */
  function autoSetDueDate() {
    var assigned = document.getElementById('af-date-assigned');
    if (!assigned || !assigned.value) return;
    var d = new Date(assigned.value + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    var dueEl = document.getElementById('af-due');
    if (dueEl) dueEl.value = d.toISOString().slice(0,10);
  }

  function setType(t) {
    newType = t;
    var s = document.getElementById('af-type-sum');
    var f = document.getElementById('af-type-form');
    if (s) s.className = 'af-type-btn' + (t==='summative'?' active':'');
    if (f) f.className = 'af-type-btn' + (t==='formative'?' active':'');
  }

  function setScoreMode(mode) {
    document.querySelectorAll('.af-scoremode-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
    var el = document.getElementById('af-scoremode');
    if (el) el.value = mode;
    var wrap = document.getElementById('af-maxpoints-wrap');
    if (wrap) wrap.style.display = mode === 'points' ? '' : 'none';
  }

  /* ── Tag section helpers ──────────────────────────────────── */
  function toggleSectionTags(secId) {
    var cbs = document.querySelectorAll('.af-tag-cb[data-section="' + secId + '"]');
    var allChecked = Array.from(cbs).every(function(cb) { return cb.checked; });
    cbs.forEach(function(cb) { cb.checked = !allChecked; cb.parentElement.classList.toggle('checked', !allChecked); });
    updateSectionBadge(secId);
  }

  function onTagChange(cb, secId) {
    cb.parentElement.classList.toggle('checked', cb.checked);
    var tc = document.querySelector('.af-tags-container');
    if (tc) tc.style.border = '';
    updateSectionBadge(secId);
  }

  function updateSectionBadge(secId) {
    var cbs = document.querySelectorAll('.af-tag-cb[data-section="' + secId + '"]');
    var count = Array.from(cbs).filter(function(cb) { return cb.checked; }).length;
    var group = cbs[0] ? cbs[0].closest('.af-section-group') : null;
    if (!group) return;
    var badge = group.querySelector('.af-section-badge');
    if (count > 0) {
      if (badge) { badge.textContent = count; }
      else {
        var header = group.querySelector('.af-section-header');
        var selectAll = header.querySelector('.af-select-all');
        var sections = getSections(window.PageAssignments._getActiveCourse ? window.PageAssignments._getActiveCourse() : getActiveCourse());
        var sec = sections.find(function(s) { return s.id === secId; });
        var b = document.createElement('span');
        b.className = 'af-section-badge';
        b.style.background = sec ? sec.color : 'var(--text-3)';
        b.textContent = count;
        header.insertBefore(b, selectAll);
      }
    } else {
      if (badge) badge.remove();
    }
  }

  /* ── Rubric select in form ────────────────────────────────── */
  function onRubricSelect(rubricId, activeCourse) {
    if (!rubricId) return;
    var rubric = getRubricById(activeCourse, rubricId); if (!rubric) return;
    _rubricAutoTags.forEach(function(tagId) {
      var cb = document.querySelector('.af-tag-cb[value="' + tagId + '"]');
      if (cb && cb.checked) { cb.checked = false; cb.parentElement.classList.remove('checked'); var secId = cb.dataset.section; if (secId) updateSectionBadge(secId); }
    });
    _rubricAutoTags = [];
    var rubricTagIds = new Set(); rubric.criteria.forEach(function(c) { (c.tagIds||[]).forEach(function(t) { rubricTagIds.add(t); }); });
    document.querySelectorAll('.af-tag-cb').forEach(function(cb) {
      if (rubricTagIds.has(cb.value) && !cb.checked) {
        cb.checked = true; cb.parentElement.classList.add('checked'); _rubricAutoTags.push(cb.value);
        var secId = cb.dataset.section; if (secId) updateSectionBadge(secId);
        var group = cb.closest('.af-section-group');
        if (group && !group.classList.contains('af-section-open')) group.classList.add('af-section-open');
      }
    });
  }

  /* ── Collaboration ────────────────────────────────────────── */
  function setCollaboration(mode) {
    newCollaboration = mode;
    document.querySelectorAll('.af-collab-btn').forEach(function(b) {
      b.className = 'af-type-btn af-collab-btn' + (b.dataset.collab === mode ? ' active' : '');
    });
    renderCollabPanel();
  }

  function getCollabStudents(activeCourse) {
    return sortStudents(getStudents(activeCourse), 'lastName');
  }

  function renderCollabPanel(activeCourse) {
    var cid = activeCourse || getActiveCourse();
    var mount = document.getElementById('collab-panel-mount');
    if (!mount) return;
    var students = getCollabStudents(cid);

    if (newCollaboration === 'individual') {
      var html = '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
          '<span class="collab-panel-title">Assign to Students</span>' +
          '<div class="collab-panel-actions">' +
            '<button class="collab-panel-btn" data-action="collabCheckAll">Check All</button>' +
            '<button class="collab-panel-btn" data-action="collabCheckNone">Check None</button>' +
          '</div>' +
        '</div>' +
        '<div class="collab-student-grid">';
      students.forEach(function(s) {
        var checked = !collabExcluded.has(s.id);
        html += '<label class="collab-student-item' + (checked ? '' : ' excluded') + '">' +
          '<input type="checkbox" ' + (checked ? 'checked' : '') + ' data-action-change="collabToggleStudent" data-sid="' + s.id + '">' +
          '<span>' + esc(displayName(s)) + '</span>' +
        '</label>';
      });
      html += '</div>' +
        '<div style="margin-top:8px;font-family:\'SF Mono\',monospace;font-size:0.6rem;color:var(--text-3)">' +
          (students.length - collabExcluded.size) + ' of ' + students.length + ' students assigned' +
        '</div>' +
      '</div>';
      mount.innerHTML = html;

    } else if (newCollaboration === 'pair') {
      var html = '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
          '<span class="collab-panel-title">Pair Students</span>' +
          '<div class="collab-panel-actions">' +
            '<button class="collab-panel-btn' + (collabPairMode==='random'?' active':'') + '" data-action="collabRandomPairs">Random Pairs</button>' +
            '<button class="collab-panel-btn' + (collabPairMode==='manual'?' active':'') + '" data-action="collabManualPairs">Manual</button>' +
          '</div>' +
        '</div>';
      if (collabPairs.length === 0) {
        html += '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:0.82rem">' +
          'Click <strong>Random Pairs</strong> to auto-pair, or <strong>Manual</strong> to drag students into pairs.' +
        '</div>';
      } else {
        html += '<div class="collab-groups-container">';
        collabPairs.forEach(function(pair, gi) {
          html += '<div class="collab-group-card" data-group="' + gi + '" data-collab-drop="' + gi + '">' +
            '<div class="collab-group-header"><span>Pair ' + (gi + 1) + '</span><span>' + pair.length + ' student' + (pair.length !== 1 ? 's' : '') + '</span></div>';
          pair.forEach(function(sid) {
            var st = students.find(function(s) { return s.id === sid; });
            if (!st) return;
            html += '<div class="collab-group-member" draggable="true" data-collab-drag-sid="' + sid + '" data-collab-drag-group="' + gi + '">' +
              '<span class="member-avatar">' + initials(st) + '</span>' +
              '<span>' + esc(displayName(st)) + '</span>' +
            '</div>';
          });
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      mount.innerHTML = html;

    } else if (newCollaboration === 'group') {
      var total = students.length;
      var perGroup = Math.floor(total / collabGroupCount);
      var remainder = total % collabGroupCount;
      var sizeDesc = remainder > 0
        ? (collabGroupCount - remainder) + ' groups of ' + perGroup + ', ' + remainder + ' of ' + (perGroup + 1)
        : collabGroupCount + ' groups of ' + perGroup;
      var html = '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
          '<span class="collab-panel-title">Group Students</span>' +
          '<div class="collab-panel-actions">' +
            '<button class="collab-panel-btn' + (collabGroupMode==='random'?' active':'') + '" data-action="collabRandomGroups">Randomize</button>' +
            '<button class="collab-panel-btn' + (collabGroupMode==='manual'?' active':'') + '" data-action="collabManualGroups">Manual</button>' +
          '</div>' +
        '</div>' +
        '<div class="collab-stepper">' +
          '<span class="collab-stepper-label">Number of groups</span>' +
          '<div class="collab-stepper-controls">' +
            '<button class="collab-stepper-btn" data-action="collabSetGroupCount" data-delta="-1">\u2212</button>' +
            '<div class="collab-stepper-val">' + collabGroupCount + '</div>' +
            '<button class="collab-stepper-btn" data-action="collabSetGroupCount" data-delta="1">+</button>' +
          '</div>' +
          '<span class="collab-stepper-info">' + sizeDesc + ' \u00B7 ' + total + ' students</span>' +
        '</div>';
      if (collabGroups.length === 0) {
        html += '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:0.82rem">' +
          'Click <strong>Randomize</strong> to auto-assign groups, or <strong>Manual</strong> to drag students.' +
        '</div>';
      } else {
        html += '<div class="collab-groups-container">';
        collabGroups.forEach(function(group, gi) {
          html += '<div class="collab-group-card" data-group="' + gi + '" data-collab-drop="' + gi + '">' +
            '<div class="collab-group-header"><span>Group ' + (gi + 1) + '</span><span>' + group.length + ' student' + (group.length !== 1 ? 's' : '') + '</span></div>';
          group.forEach(function(sid) {
            var st = students.find(function(s) { return s.id === sid; });
            if (!st) return;
            html += '<div class="collab-group-member" draggable="true" data-collab-drag-sid="' + sid + '" data-collab-drag-group="' + gi + '">' +
              '<span class="member-avatar">' + initials(st) + '</span>' +
              '<span>' + esc(displayName(st)) + '</span>' +
            '</div>';
          });
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      mount.innerHTML = html;
    }
  }

  function collabToggleStudent(sid, checked) {
    if (checked) collabExcluded.delete(sid);
    else collabExcluded.add(sid);
    renderCollabPanel();
  }
  function collabCheckAll() { collabExcluded.clear(); renderCollabPanel(); }
  function collabCheckNone() {
    getCollabStudents(getActiveCourse()).forEach(function(s) { collabExcluded.add(s.id); });
    renderCollabPanel();
  }
  function collabRandomPairs() {
    var students = getCollabStudents(getActiveCourse());
    var shuffled = students.slice().sort(function() { return Math.random() - 0.5; });
    collabPairs = [];
    for (var i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        collabPairs.push([shuffled[i].id, shuffled[i + 1].id]);
      } else {
        if (collabPairs.length > 0) collabPairs[collabPairs.length - 1].push(shuffled[i].id);
        else collabPairs.push([shuffled[i].id]);
      }
    }
    collabPairMode = 'random';
    renderCollabPanel();
  }
  function collabRandomGroups() {
    var students = getCollabStudents(getActiveCourse());
    var shuffled = students.slice().sort(function() { return Math.random() - 0.5; });
    collabGroups = Array.from({ length: collabGroupCount }, function() { return []; });
    shuffled.forEach(function(s, i) { collabGroups[i % collabGroupCount].push(s.id); });
    collabGroupMode = 'random';
    renderCollabPanel();
  }
  function collabSetGroupCount(delta) {
    var students = getCollabStudents(getActiveCourse());
    collabGroupCount = Math.max(2, Math.min(students.length, collabGroupCount + delta));
    if (collabGroups.length > 0) collabRandomGroups();
    else renderCollabPanel();
  }
  function collabDragStart(e, sid, fromGroup) {
    _dragSid = sid;
    _dragFromGroup = fromGroup;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sid);
  }
  function collabDrop(e, toGroup) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (_dragSid == null || _dragFromGroup === toGroup) return;
    var arr = newCollaboration === 'pair' ? collabPairs : collabGroups;
    if (!arr[_dragFromGroup] || !arr[toGroup]) return;
    var idx = arr[_dragFromGroup].indexOf(_dragSid);
    if (idx >= 0) arr[_dragFromGroup].splice(idx, 1);
    arr[toGroup].push(_dragSid);
    if (newCollaboration === 'pair') collabPairs = collabPairs.filter(function(g) { return g.length > 0; });
    else collabGroups = collabGroups.filter(function(g) { return g.length > 0; });
    _dragSid = null;
    _dragFromGroup = null;
    renderCollabPanel();
  }
  function loadCollabData(assess) {
    collabExcluded = new Set(assess && assess.excludedStudents ? assess.excludedStudents : []);
    collabPairs = assess && assess.pairs ? structuredClone(assess.pairs) : [];
    collabGroups = assess && assess.groups ? structuredClone(assess.groups) : [];
    collabGroupCount = assess && assess.groupCount ? assess.groupCount : 4;
    collabPairMode = collabPairs.length > 0 ? 'manual' : 'random';
    collabGroupMode = collabGroups.length > 0 ? 'manual' : 'random';
  }

  /* ── Assessment CRUD ──────────────────────────────────────── */
  function saveNewAssess(activeCourse, callbacks) {
    var titleEl = document.getElementById('af-title');
    var title = (titleEl ? titleEl.value : '').trim();
    if (!title) {
      if (titleEl) { titleEl.style.border = '2px solid var(--score-1)'; titleEl.placeholder = 'Title is required'; titleEl.focus(); }
      return;
    }
    var dateAssigned = (document.getElementById('af-date-assigned') || {}).value || new Date().toISOString().slice(0,10);
    var date = dateAssigned;
    var description = (document.getElementById('af-desc') ? document.getElementById('af-desc').value : '').trim();
    var tagIds = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function(cb) { return cb.value; });
    if (tagIds.length === 0) {
      var tagsContainer = document.querySelector('.af-tags-container');
      if (tagsContainer) { tagsContainer.style.border = '2px solid var(--score-1)'; tagsContainer.scrollIntoView({behavior:'smooth'}); }
      return;
    }
    var evidence = (document.getElementById('af-evidence') || {}).value;
    var moduleId = (document.getElementById('af-module') || {}).value || '';
    var coreCompetencyIds = Array.from(document.querySelectorAll('.af-cc-chip.active')).map(function(el) { return el.dataset.cc; });
    var assessments = getAssessments(activeCourse);
    var id = uid();
    var rubricId = (document.getElementById('af-rubric') || {}).value || '';
    var dueDate = (document.getElementById('af-due') || {}).value || '';
    var newAssess = { id: id, title: title, date: date, dateAssigned: dateAssigned, type: newType, tagIds: tagIds, evidenceType: evidence, description: description, notes:'', created: new Date().toISOString() };
    if (dueDate) newAssess.dueDate = dueDate;
    if (moduleId) newAssess.moduleId = moduleId;
    if (rubricId) newAssess.rubricId = rubricId;
    if (coreCompetencyIds.length > 0) newAssess.coreCompetencyIds = coreCompetencyIds;
    if (newCollaboration !== 'individual') newAssess.collaboration = newCollaboration;
    if (collabExcluded.size > 0) newAssess.excludedStudents = Array.from(collabExcluded);
    if (newCollaboration === 'pair' && collabPairs.length > 0) newAssess.pairs = collabPairs;
    if (newCollaboration === 'group' && collabGroups.length > 0) { newAssess.groups = collabGroups; newAssess.groupCount = collabGroupCount; }
    var scoreModeVal = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (scoreModeVal === 'points') {
      var mpEl = document.getElementById('af-maxpoints');
      var mp = parseInt(mpEl ? mpEl.value : 0);
      if (!mp || mp <= 0 || isNaN(mp)) { if (mpEl) { mpEl.style.border = '2px solid var(--score-1)'; mpEl.focus(); } return; }
      newAssess.scoreMode = 'points'; newAssess.maxPoints = mp;
    }
    var assessWeight = parseFloat((document.getElementById('af-weight') || {}).value) || 1;
    if (assessWeight !== 1) newAssess.weight = assessWeight;
    assessments.push(newAssess);
    saveAssessments(activeCourse, assessments);
    if (callbacks && callbacks.onSaved) callbacks.onSaved(id);
  }

  function editAssess(aid, activeCourse, callbacks) {
    var cid = activeCourse;
    var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    if (!assess) return;
    newType = assess.type;
    newCollaboration = assess.collaboration || 'individual';
    loadCollabData(assess);
    if (callbacks && callbacks.onEdit) callbacks.onEdit(aid, assess);
  }

  function saveEditAssess(aid, activeCourse, callbacks) {
    var titleEl = document.getElementById('af-title');
    var title = (titleEl ? titleEl.value : '').trim();
    if (!title) { if (titleEl) { titleEl.style.border = '2px solid var(--score-1)'; titleEl.placeholder = 'Title is required'; titleEl.focus(); } return; }
    var dateAssigned = (document.getElementById('af-date-assigned') || {}).value || new Date().toISOString().slice(0,10);
    var date = dateAssigned;
    var description = (document.getElementById('af-desc') ? document.getElementById('af-desc').value : '').trim();
    var tagIds = Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function(cb) { return cb.value; });
    if (tagIds.length === 0) { var tc = document.querySelector('.af-tags-container'); if (tc) { tc.style.border = '2px solid var(--score-1)'; tc.scrollIntoView({behavior:'smooth'}); } return; }
    var evidence = (document.getElementById('af-evidence') || {}).value;
    var assessments = getAssessments(activeCourse);
    var idx = assessments.findIndex(function(a) { return a.id === aid; });
    if (idx < 0) return;
    assessments[idx].title = title; assessments[idx].date = date; assessments[idx].dateAssigned = dateAssigned;
    assessments[idx].type = newType; assessments[idx].tagIds = tagIds; assessments[idx].evidenceType = evidence; assessments[idx].description = description;
    assessments[idx].dueDate = (document.getElementById('af-due') || {}).value || undefined;
    assessments[idx].moduleId = (document.getElementById('af-module') || {}).value || undefined;
    assessments[idx].rubricId = (document.getElementById('af-rubric') || {}).value || undefined;
    var ccIds = Array.from(document.querySelectorAll('.af-cc-chip.active')).map(function(el) { return el.dataset.cc; });
    assessments[idx].coreCompetencyIds = ccIds.length > 0 ? ccIds : undefined;
    assessments[idx].collaboration = newCollaboration !== 'individual' ? newCollaboration : undefined;
    assessments[idx].excludedStudents = collabExcluded.size > 0 ? Array.from(collabExcluded) : undefined;
    assessments[idx].pairs = (newCollaboration === 'pair' && collabPairs.length > 0) ? collabPairs : undefined;
    assessments[idx].groups = (newCollaboration === 'group' && collabGroups.length > 0) ? collabGroups : undefined;
    assessments[idx].groupCount = (newCollaboration === 'group') ? collabGroupCount : undefined;
    assessments[idx].successCriteria = undefined;
    var scoreModeVal = (document.getElementById('af-scoremode') || {}).value || 'proficiency';
    if (scoreModeVal === 'points') {
      var mpEl = document.getElementById('af-maxpoints'); var mp = parseInt(mpEl ? mpEl.value : 0);
      if (!mp || mp <= 0 || isNaN(mp)) { if (mpEl) { mpEl.style.border = '2px solid var(--score-1)'; mpEl.focus(); } return; }
      assessments[idx].scoreMode = 'points'; assessments[idx].maxPoints = mp;
    } else { assessments[idx].scoreMode = undefined; assessments[idx].maxPoints = undefined; }
    var assessWeight = parseFloat((document.getElementById('af-weight') || {}).value) || 1;
    assessments[idx].weight = assessWeight !== 1 ? assessWeight : undefined;
    saveAssessments(activeCourse, assessments);
    if (callbacks && callbacks.onSaved) callbacks.onSaved(aid);
  }

  function dupeAssess(aid, activeCourse, callbacks) {
    var cid = activeCourse;
    var assessments = getAssessments(cid);
    var orig = assessments.find(function(a) { return a.id === aid; });
    if (!orig) return;
    var id = uid();
    var dupe = structuredClone(orig);
    dupe.id = id; dupe.title = orig.title + ' (Copy)'; dupe.created = new Date().toISOString();
    assessments.push(dupe);
    saveAssessments(cid, assessments);
    if (callbacks && callbacks.onDuped) callbacks.onDuped(id);
  }

  function deleteAssess(aid, activeCourse, callbacks) {
    showConfirm('Delete Assessment', 'Delete this assessment and all its scores?', 'Delete', 'danger', function() {
      var cid = activeCourse;
      saveAssessments(cid, getAssessments(cid).filter(function(a) { return a.id !== aid; }));
      var scores = getScores(cid);
      Object.keys(scores).forEach(function(sid) { scores[sid] = (scores[sid]||[]).filter(function(s) { return s.assessmentId !== aid; }); });
      saveScores(cid, scores);
      var statuses = getAssignmentStatuses(cid); var statusChanged = false;
      Object.keys(statuses).forEach(function(k) { if (k.endsWith(':' + aid)) { delete statuses[k]; statusChanged = true; } });
      if (statusChanged) saveAssignmentStatuses(cid, statuses);
      var obs = getQuickObs(cid); var obsChanged = false;
      Object.keys(obs).forEach(function(sid) {
        var before = obs[sid].length;
        obs[sid] = obs[sid].filter(function(o) { return !(o.assignmentContext && o.assignmentContext.assessmentId === aid); });
        if (obs[sid].length !== before) obsChanged = true;
      });
      if (obsChanged) saveQuickObs(cid, obs);
      if (callbacks && callbacks.onDeleted) callbacks.onDeleted(aid);
    });
  }

  /* ── Public API ───────────────────────────────────────────── */
  return {
    renderAssessForm: renderAssessForm,
    autoSetDueDate: autoSetDueDate,
    setType: setType,
    setScoreMode: setScoreMode,
    toggleSectionTags: toggleSectionTags,
    onTagChange: onTagChange,
    updateSectionBadge: updateSectionBadge,
    onRubricSelect: onRubricSelect,
    setCollaboration: setCollaboration,
    renderCollabPanel: renderCollabPanel,
    collabToggleStudent: collabToggleStudent,
    collabCheckAll: collabCheckAll,
    collabCheckNone: collabCheckNone,
    collabRandomPairs: collabRandomPairs,
    collabRandomGroups: collabRandomGroups,
    collabSetGroupCount: collabSetGroupCount,
    collabDragStart: collabDragStart,
    collabDrop: collabDrop,
    loadCollabData: loadCollabData,
    saveNewAssess: saveNewAssess,
    editAssess: editAssess,
    saveEditAssess: saveEditAssess,
    dupeAssess: dupeAssess,
    deleteAssess: deleteAssess,
    resetFormState: resetFormState,
    getNewType: getNewType,
    setNewType: setNewType,
    getNewCollaboration: getNewCollaboration,
    setNewCollaboration: setNewCollaboration,
    getCollabExcluded: getCollabExcluded,
    getCollabPairs: getCollabPairs,
    getCollabGroups: getCollabGroups,
    getCollabGroupCount: getCollabGroupCount
  };
})();
