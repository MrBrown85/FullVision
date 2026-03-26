/* ── dash-curriculum-wizard.js — Curriculum wizard steps ──── */
window.DashCurriculumWizard = (function() {
  'use strict';

  /* ── State (module-local) ────────────────────────────────── */
  var cwStep = 1;
  var cwSelectedGrade = null;
  var cwSelectedSubject = null;
  var cwSelectedTags = [];
  var cwCurriculumLoaded = false;
  var cwLoadError = false;

  // Step 2 stash
  var cwStep2Name = '', cwStep2Grade = '', cwStep2Desc = '';
  var cwStep2Grading = 'proficiency', cwStep2Calc = 'mostRecent', cwStep2Decay = '65';

  // Step 3 (Customize) state
  var cwCompetencyGroups = [];     // [{id, name, color, sortOrder}]
  var cwSectionGroupMap = {};      // sectionId -> groupId
  var cwCustomSections = [];       // [{id, label, text, color}]
  var cwCollapsedGroups = {};      // groupId -> bool
  var CW_GROUP_COLORS = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b'];

  /* ── State accessors ─────────────────────────────────────── */
  function getState() {
    return {
      cwStep: cwStep,
      cwSelectedGrade: cwSelectedGrade,
      cwSelectedSubject: cwSelectedSubject,
      cwSelectedTags: cwSelectedTags,
      cwCurriculumLoaded: cwCurriculumLoaded,
      cwLoadError: cwLoadError,
      cwStep2Name: cwStep2Name,
      cwStep2Grade: cwStep2Grade,
      cwStep2Desc: cwStep2Desc,
      cwStep2Grading: cwStep2Grading,
      cwStep2Calc: cwStep2Calc,
      cwStep2Decay: cwStep2Decay
    };
  }

  function resetState() {
    cwStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    cwCurriculumLoaded = false;
    cwLoadError = false;
    cwStep2Name = ''; cwStep2Grade = ''; cwStep2Desc = '';
    cwStep2Grading = 'proficiency'; cwStep2Calc = 'mostRecent'; cwStep2Decay = '65';
    cwCompetencyGroups = []; cwSectionGroupMap = {}; cwCustomSections = []; cwCollapsedGroups = {};
  }

  function setCurriculumLoaded(loaded, error) {
    cwCurriculumLoaded = loaded;
    cwLoadError = error;
  }

  function setGrade(g) { cwSelectedGrade = g; }
  function setSubject(s) { cwSelectedSubject = s; }
  function setSelectedTags(tags) { cwSelectedTags = tags; }

  /* ── Helpers ─────────────────────────────────────────────── */
  // renderFn: callback to trigger renderClassManager (provided by page-dashboard)
  var _renderClassManagerFn = null;
  function setRenderClassManagerFn(fn) { _renderClassManagerFn = fn; }
  function _renderClassManager() { if (_renderClassManagerFn) _renderClassManagerFn(); }

  // renderFn for full page render
  var _renderFn = null;
  function setRenderFn(fn) { _renderFn = fn; }
  function _render() { if (_renderFn) _renderFn(); }

  // setActiveCourse callback
  var _setActiveFn = null;
  function setActiveFn(fn) { _setActiveFn = fn; }

  /* ── Curriculum Wizard ──────────────────────────────────── */
  function renderCmCreateForm() {
    if (cwStep === 1) return renderCwStep1();
    if (cwStep === 2) return renderCwStep2();
    if (cwStep === 3) return renderCwStep3Customize();
    if (cwStep === 4) return renderCwStep4Review();
    return '';
  }

  function renderCwStepBar() {
    var labels = ['Choose Courses', 'Class Details', 'Customize', 'Review'];
    return '<div class="cw-steps">' + labels.map(function(l, i) {
      var n = i + 1;
      var cls = n < cwStep ? 'done' : n === cwStep ? 'active' : '';
      return (i > 0 ? '<span class="cw-step-arrow">\u203A</span>' : '') +
        '<div class="cw-step ' + cls + '">' +
          '<span class="cw-step-num">' + (n < cwStep ? '\u2713' : n) + '</span>' +
          '<span>' + l + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderCwStep1() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    if (!cwCurriculumLoaded && !cwLoadError) {
      html += '<div class="cm-section"><div class="cw-empty-msg">Loading BC Curriculum data\u2026</div></div>';
      html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button></div>';
      html += '</div>';
      return html;
    }

    if (cwLoadError) {
      html += '<div class="cm-section"><div class="cw-empty-msg">Could not load BC Curriculum data.<br>You can still create a class with a custom learning map.</div></div>';
      html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button><button class="btn btn-primary" data-action="cwSkipToCustom">Custom Class</button></div>';
      html += '</div>';
      return html;
    }

    // Grade selection
    html += '<div class="cm-section"><div class="cm-section-title">Grade</div><div class="cw-grade-row">';
    [8, 9, 10, 11, 12].forEach(function(g) {
      var active = cwSelectedGrade === g ? ' active' : '';
      html += '<button class="cw-grade-btn' + active + '" data-action="cwSelectGrade" data-grade="' + g + '">Grade ' + g + '</button>';
    });
    html += '</div></div>';

    // Subject selection
    if (cwSelectedGrade !== null) {
      var allCourses = getCoursesByGrade(cwSelectedGrade);
      var bySubject = {};
      allCourses.forEach(function(c) {
        if (!bySubject[c.subject]) bySubject[c.subject] = [];
        bySubject[c.subject].push(c);
      });
      var subjectNames = Object.keys(bySubject).sort();

      html += '<div class="cm-section"><div class="cm-section-title">Subject</div><div class="cw-subject-row">';
      subjectNames.forEach(function(subj) {
        var active = cwSelectedSubject === subj ? ' active' : '';
        var color = SUBJECT_COLOURS[subj] || '#6366f1';
        html += '<button class="cw-subject-btn' + active + '" data-action="cwSelectSubject" data-subject="' + esc(subj) + '">' +
          '<span class="cw-subject-dot" style="background:' + color + '"></span>' + esc(subj) + '</button>';
      });
      html += '</div></div>';

      // Course checklist
      if (cwSelectedSubject && bySubject[cwSelectedSubject]) {
        var courses = bySubject[cwSelectedSubject];
        html += '<div class="cm-section"><div class="cm-section-title">Courses</div>' +
          '<div class="cm-hint" style="margin-bottom:8px">Select one or more courses. Multiple selections create a combined class.</div>' +
          '<div class="cw-course-list">';
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
        html += '</div>';

        if (cwSelectedTags.length > 0) {
          var totalComps = 0;
          cwSelectedTags.forEach(function(tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function(cat) { totalComps += (cat.competencies || []).length; });
            }
          });
          html += '<div class="cw-selection-summary"><strong>' + cwSelectedTags.length + '</strong> course' + (cwSelectedTags.length !== 1 ? 's' : '') + ' selected \u00B7 <strong>' + totalComps + '</strong> competencies will become gradebook standards</div>';
        }
        html += '</div>';
      }
    }

    html += '<button class="cw-custom-btn" data-action="cwSkipToCustom">\u270E Create a custom class without BC Curriculum</button>';
    html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cwGoToStep2" ' + (cwSelectedTags.length === 0 ? 'disabled style="opacity:0.4;pointer-events:none"' : '') + '>Next</button></div>';
    html += '</div>';
    return html;
  }

  function renderCwStep2() {
    var preName = '';
    var preGrade = '';
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var names = cwSelectedTags.map(function(tag) { return CURRICULUM_INDEX[tag]; }).filter(Boolean).map(function(c) { return c.course_name; });
      preName = names.join(' / ');
      preGrade = cwSelectedGrade ? String(cwSelectedGrade) : '';
    }

    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    html += '<div class="cm-section"><div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><input class="cm-input" id="cm-new-name" value="' + esc(preName) + '" placeholder="e.g. English 10" autofocus></div>' +
      '<div style="display:flex;gap:16px"><div class="cm-field" style="flex:1"><label class="cm-label">Grade Level</label><input class="cm-input" id="cm-new-grade" value="' + esc(preGrade) + '" placeholder="e.g. 8, 10-12"></div></div>' +
      '<div class="cm-field"><label class="cm-label">Description</label><textarea class="cm-textarea" id="cm-new-desc" placeholder="Optional"></textarea></div></div>';

    html += '<div class="cm-section"><div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field"><label class="cm-label">Grading System</label>' +
        '<div class="cm-seg" id="cm-cg-grading">' +
          '<button class="cm-seg-btn active" data-val="proficiency" data-action="cmCreateToggle" data-group="cm-cg-grading">Proficiency (1\u20134)</button>' +
          '<button class="cm-seg-btn" data-val="letter" data-action="cmCreateToggle" data-group="cm-cg-grading">Letter (A\u2013F)</button>' +
          '<button class="cm-seg-btn" data-val="points" data-action="cmCreateToggle" data-group="cm-cg-grading">Points</button>' +
        '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Calculation Method</label>' +
        '<div class="cm-seg" id="cm-cg-calc">' +
          '<button class="cm-seg-btn active" data-val="mostRecent" data-action="cmCreateToggle" data-group="cm-cg-calc">Most Recent</button>' +
          '<button class="cm-seg-btn" data-val="highest" data-action="cmCreateToggle" data-group="cm-cg-calc">Highest</button>' +
          '<button class="cm-seg-btn" data-val="mode" data-action="cmCreateToggle" data-group="cm-cg-calc">Mode</button>' +
          '<button class="cm-seg-btn" data-val="decayingAvg" data-action="cmCreateToggleDecay" data-group="cm-cg-calc">Decaying Avg</button>' +
        '</div></div>' +
      '<div id="cm-cg-decay" class="cm-field" style="display:none"><label class="cm-label">Decay Weight</label>' +
        '<div class="cm-slider-row"><input type="range" min="10" max="95" value="65" id="cm-cg-decay-slider" style="flex:1"><span class="cm-slider-label">65%</span></div>' +
        '<div class="cm-hint">Higher values weight recent scores more heavily.</div></div>' +
    '</div>';

    html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwGoToStep3">Next</button></div>';
    html += '</div>';
    return html;
  }

  /* ── Step 3: Customize Competencies ────────────────────────── */
  function _cwBuildSectionList() {
    var sections = [];
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      cwSelectedTags.forEach(function(courseTag) {
        var courseData = CURRICULUM_INDEX[courseTag];
        if (!courseData) return;
        (courseData.categories || []).forEach(function(cat) {
          (cat.competencies || []).forEach(function(comp) {
            sections.push({ id: comp.id || comp.tag, label: comp.short_label || comp.tag, tag: comp.tag, catName: cat.name, courseTag: courseTag });
          });
        });
      });
    }
    cwCustomSections.forEach(function(cs) {
      sections.push({ id: cs.id, label: cs.label, tag: cs.id, catName: 'Custom', courseTag: '', _custom: true });
    });
    return sections;
  }

  function renderCwStep3Customize() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    var allSections = _cwBuildSectionList();

    html += '<div class="cm-section"><div class="cm-section-title">Customize Competencies</div>' +
      '<div class="cm-hint" style="margin-bottom:12px">Organize your competencies into groups, or leave them ungrouped. This step is optional.</div>';

    // Render groups (uses .mod-folder pattern from assignments page)
    cwCompetencyGroups.sort(function(a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    cwCompetencyGroups.forEach(function(grp, gi) {
      var groupSections = allSections.filter(function(s) { return cwSectionGroupMap[s.id] === grp.id; });
      var collapsed = cwCollapsedGroups[grp.id];
      html += '<div class="mod-folder' + (collapsed ? '' : ' open') + '" data-group-id="' + grp.id + '" data-folder-drop="' + grp.id + '">' +
        '<div class="mod-folder-header" data-action="cwToggleGroup" data-gid="' + grp.id + '">' +
          '<span class="mod-folder-grip">\u2807</span>' +
          '<span class="mod-folder-chevron">\u25B6</span>' +
          '<span class="mod-folder-color" style="background:' + grp.color + '" title="Change color" data-action="openColorPicker" data-stop-prop="true">' +
            '<input type="color" value="' + grp.color + '" data-action-change="cwGroupColor" data-gid="' + grp.id + '">' +
          '</span>' +
          '<input class="mod-folder-name-input" value="' + esc(grp.name) + '" draggable="false" data-stop-prop="true" data-action-blur="cwGroupName" data-gid="' + grp.id + '">' +
          '<span class="mod-folder-meta">' + groupSections.length + ' standard' + (groupSections.length !== 1 ? 's' : '') + '</span>' +
          '<div class="mod-folder-actions" data-stop-prop="true">' +
            '<button class="mod-folder-action delete" data-action="cwDeleteGroup" data-gid="' + grp.id + '" title="Delete group">\u2715</button>' +
          '</div>' +
        '</div>' +
        '<div class="mod-folder-body">';
      if (groupSections.length === 0) {
        html += '<div class="mod-folder-empty">Drag competencies here or use the dropdown on each competency</div>';
      }
      groupSections.forEach(function(sec) {
        html += _cwRenderCompItem(sec, grp.id);
      });
      html += '</div></div>';
    });

    // Ungrouped
    var ungrouped = allSections.filter(function(s) { return !cwSectionGroupMap[s.id]; });
    html += '<div class="mod-folder no-module' + (cwCollapsedGroups['__none__'] ? '' : ' open') + '" data-group-id="__none__" data-folder-drop="__none__">' +
      '<div class="mod-folder-header" data-action="cwToggleGroup" data-gid="__none__">' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<span style="font-size:0.88rem;color:var(--text-3)">\uD83D\uDCC1</span>' +
        '<span class="mod-folder-name" style="font-size:0.95rem;font-weight:500;color:var(--text-3)">Ungrouped</span>' +
        '<span class="mod-folder-meta">' + ungrouped.length + ' standard' + (ungrouped.length !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      '<div class="mod-folder-body">';
    ungrouped.forEach(function(sec) {
      html += _cwRenderCompItem(sec, null);
    });
    html += '</div></div>';

    // Action buttons
    html += '<button class="add-module-btn" data-action="cwAddGroup">+ Add Group</button>' +
      '<button class="cm-add-link" data-action="cwAddCustomComp" style="margin-top:4px">+ Add Custom Competency</button>';

    html += '</div>'; // close cm-section

    html += '<div class="cw-footer">' +
      '<button class="btn btn-ghost" data-action="cwGoBack">Back</button>' +
      '<button class="btn btn-ghost" data-action="cwGoToStep4">Skip</button>' +
      '<button class="btn btn-primary" data-action="cwGoToStep4">Next</button>' +
    '</div>';
    html += '</div>';
    return html;
  }

  function _cwRenderCompItem(sec, currentGroupId) {
    var groupOptions = '<option value=""' + (!currentGroupId ? ' selected' : '') + '>None</option>';
    cwCompetencyGroups.forEach(function(g) {
      groupOptions += '<option value="' + g.id + '"' + (currentGroupId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
    });
    return '<div class="cm-std-card" draggable="true" data-comp-drag="' + esc(sec.id) + '">' +
      '<div class="cm-std-header">' +
        '<span class="cm-std-tag">' + esc(sec.tag) + '</span>' +
        '<span class="cm-std-label">' + esc(sec.label) + '</span>' +
        '<select class="cm-std-group-select" data-action-change="cwCompGroupChange" data-secid="' + esc(sec.id) + '" data-stop-prop="true" style="font-size:var(--text-xs);padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text-2);max-width:120px">' + groupOptions + '</select>' +
        (sec._custom ? '<button class="cm-delete-mini" data-action="cwRemoveCustomComp" data-secid="' + esc(sec.id) + '" data-stop-prop="true" title="Remove" style="width:20px;height:20px;font-size:11px">\u2715</button>' : '') +
      '</div></div>';
  }

  /* ── Step 3 actions ──────────────────────────────────────── */
  function cwAddGroup() {
    var idx = cwCompetencyGroups.length;
    cwCompetencyGroups.push({
      id: 'grp_' + Date.now() + Math.random().toString(36).slice(2,5),
      name: 'Group ' + (idx + 1),
      color: CW_GROUP_COLORS[idx % CW_GROUP_COLORS.length],
      sortOrder: idx
    });
    _renderClassManager();
    setTimeout(function() {
      var inputs = document.querySelectorAll('.cw-comp-name-input');
      var last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    }, 50);
  }

  function cwDeleteGroup(gid) {
    cwCompetencyGroups = cwCompetencyGroups.filter(function(g) { return g.id !== gid; });
    Object.keys(cwSectionGroupMap).forEach(function(secId) {
      if (cwSectionGroupMap[secId] === gid) delete cwSectionGroupMap[secId];
    });
    _renderClassManager();
  }

  function cwToggleGroup(gid) {
    cwCollapsedGroups[gid] = !cwCollapsedGroups[gid];
    var folder = document.querySelector('.mod-folder[data-group-id="' + gid + '"]');
    if (folder) {
      folder.classList.toggle('open', !cwCollapsedGroups[gid]);
    }
  }

  function cwUpdateGroupName(gid, name) {
    var g = cwCompetencyGroups.find(function(x) { return x.id === gid; });
    if (g && name.trim()) g.name = name.trim();
  }

  function cwUpdateGroupColor(gid, color) {
    var g = cwCompetencyGroups.find(function(x) { return x.id === gid; });
    if (g) { g.color = color; _renderClassManager(); }
  }

  function cwCompGroupChange(secId, groupId) {
    if (groupId) cwSectionGroupMap[secId] = groupId;
    else delete cwSectionGroupMap[secId];
    _renderClassManager();
  }

  function cwAddCustomComp() {
    var id = 'custom_' + Date.now() + Math.random().toString(36).slice(2,5);
    cwCustomSections.push({ id: id, label: 'Custom ' + (cwCustomSections.length + 1), text: '' });
    _renderClassManager();
    setTimeout(function() {
      var items = document.querySelectorAll('.cw-comp-item[data-comp-drag="' + id + '"] .cw-comp-label');
      // Focus won't work on span, but the item is visible
    }, 50);
  }

  function cwRemoveCustomComp(secId) {
    cwCustomSections = cwCustomSections.filter(function(s) { return s.id !== secId; });
    delete cwSectionGroupMap[secId];
    _renderClassManager();
  }

  /* ── Step 4: Review ──────────────────────────────────────── */
  function renderCwStep4Review() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    var className = cwStep2Name || cwGetPreName();
    var gradeLevel = cwStep2Grade || (cwSelectedGrade ? String(cwSelectedGrade) : '');

    html += '<div class="cm-section"><div class="cm-section-title">Review</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><div style="font-size:var(--text-lg);font-weight:600;color:var(--text)">' + esc(className || 'Untitled') + '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Grade</label><div style="font-size:var(--text-md);color:var(--text-2)">' + esc(gradeLevel || '\u2014') + '</div></div></div>';

    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var subjectColors = ['#0891b2','#7c3aed','#059669','#d97706','#dc2626','#2563eb','#db2777','#4f46e5'];
      var colorIdx = 0;
      cwSelectedTags.forEach(function(tag) {
        var courseData = CURRICULUM_INDEX[tag];
        if (!courseData) return;
        var color = subjectColors[colorIdx % subjectColors.length];
        colorIdx++;
        var cats = courseData.categories || [];
        var totalComps = 0;
        cats.forEach(function(c) { totalComps += (c.competencies || []).length; });
        html += '<div class="cw-review-card">' +
          '<div class="cw-review-title" style="color:' + color + '">' + esc(courseData.course_name) + '</div>' +
          '<div class="cw-review-meta">' + esc(tag) + ' \u00B7 ' + totalComps + ' competencies across ' + cats.length + ' categories</div>' +
          '<div class="cw-review-sections">';
        cats.forEach(function(cat) {
          var compCount = (cat.competencies || []).length;
          html += '<div class="cw-review-sec"><span class="cw-review-sec-dot" style="background:' + color + '"></span>' + esc(cat.name) + '<span class="cw-review-sec-count">' + compCount + ' standard' + (compCount !== 1 ? 's' : '') + '</span></div>';
        });
        html += '</div></div>';
      });
    } else {
      html += '<div class="cm-section"><div class="cw-empty-msg">Custom class \u2014 no curriculum data. You can add sections and tags manually after creation.</div></div>';
    }

    // Show competency groups summary if any
    if (cwCompetencyGroups.length > 0) {
      html += '<div class="cm-section"><div class="cm-section-title">Competency Groups</div>';
      cwCompetencyGroups.forEach(function(grp) {
        var count = Object.values(cwSectionGroupMap).filter(function(gid) { return gid === grp.id; }).length;
        html += '<div class="cw-review-sec"><span class="cw-review-sec-dot" style="background:' + grp.color + '"></span>' + esc(grp.name) + '<span class="cw-review-sec-count">' + count + ' competenc' + (count !== 1 ? 'ies' : 'y') + '</span></div>';
      });
      html += '</div>';
    }

    html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwFinishCreate">Create Class</button></div>';
    html += '</div>';
    return html;
  }

  /* ── Wizard navigation ──────────────────────────────────── */
  function cwSelectGrade(g) {
    cwSelectedGrade = g;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    _renderClassManager();
  }

  function cwSelectSubject(subj) {
    cwSelectedSubject = subj;
    _renderClassManager();
  }

  function cwToggleCourse(tag) {
    var idx = cwSelectedTags.indexOf(tag);
    if (idx >= 0) cwSelectedTags.splice(idx, 1);
    else cwSelectedTags.push(tag);
    _renderClassManager();
  }

  function cwSkipToCustom() {
    cwSelectedTags = [];
    cwStep = 2;
    _renderClassManager();
  }

  function cwGoToStep2() {
    if (cwSelectedTags.length === 0) return;
    cwStep = 2;
    _renderClassManager();
  }

  function cwGoToStep3() {
    cwStep2Name = document.getElementById('cm-new-name')?.value || '';
    cwStep2Grade = document.getElementById('cm-new-grade')?.value || '';
    cwStep2Desc = document.getElementById('cm-new-desc')?.value || '';
    cwStep2Grading = (document.querySelector('#cm-cg-grading .cm-seg-btn.active') || {}).dataset?.val || 'proficiency';
    cwStep2Calc = (document.querySelector('#cm-cg-calc .cm-seg-btn.active') || {}).dataset?.val || 'mostRecent';
    cwStep2Decay = document.getElementById('cm-cg-decay-slider')?.value || '65';
    cwStep = 3;
    _renderClassManager();
  }

  function cwGoToStep4() {
    cwStep = 4;
    _renderClassManager();
  }

  function cwGoBack() {
    if (cwStep === 4) cwStep = 3;
    else if (cwStep === 3) cwStep = 2;
    else if (cwStep === 2) cwStep = 1;
    _renderClassManager();
  }

  function cwGetPreName() {
    if (cwStep2Name) return cwStep2Name;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      return cwSelectedTags.map(function(tag) { return CURRICULUM_INDEX[tag]; }).filter(Boolean).map(function(c) { return c.course_name; }).join(' / ');
    }
    return '';
  }

  function cwFinishCreate() {
    var name = cwStep2Name || cwGetPreName();
    if (!name.trim()) {
      cwStep = 2; _renderClassManager();
      requestAnimationFrame(function() {
        var el = document.getElementById('cm-new-name');
        if (el) { el.style.border = '2px solid var(--score-1)'; el.placeholder = 'Class name is required'; el.oninput = function() { this.style.border = ''; }; el.focus(); }
      });
      return;
    }

    var course = createCourse({
      name: name.trim(),
      gradeLevel: (cwStep2Grade || (cwSelectedGrade ? String(cwSelectedGrade) : '')).trim(),
      description: (cwStep2Desc || '').trim(),
      gradingSystem: cwStep2Grading,
      calcMethod: cwStep2Calc,
      decayWeight: parseInt(cwStep2Decay, 10) / 100
    });

    var cc = getCourseConfig(course.id);
    cc.calcMethod = cwStep2Calc;
    cc.decayWeight = parseInt(cwStep2Decay, 10) / 100;
    saveCourseConfig(course.id, cc);

    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        // Apply competency groups from step 3
        if (cwCompetencyGroups.length > 0) {
          map.competencyGroups = cwCompetencyGroups.slice();
          (map.sections || []).forEach(function(sec) {
            if (cwSectionGroupMap[sec.id]) sec.groupId = cwSectionGroupMap[sec.id];
          });
        }
        // Add custom sections from step 3
        cwCustomSections.forEach(function(cs) {
          var sub = (map.subjects && map.subjects[0]) ? map.subjects[0].id : '';
          var color = (map.subjects && map.subjects[0]) ? map.subjects[0].color : '#6366f1';
          var sec = {
            id: cs.id, subject: sub, name: cs.label, shortName: cs.label,
            color: color, _custom: true,
            tags: [{ id: cs.id, label: cs.label, text: cs.text || '', color: color, subject: sub, name: cs.label, shortName: cs.label, i_can_statements: [] }]
          };
          if (cwSectionGroupMap[cs.id]) sec.groupId = cwSectionGroupMap[cs.id];
          map.sections.push(sec);
        });
        saveLearningMap(course.id, map);
        updateCourse(course.id, { curriculumTags: cwSelectedTags.slice() });
      }
    }

    // Notify class manager and page about the new course
    var cmState = DashClassManager.getState();
    // Update class manager state via its public methods would be ideal,
    // but for simplicity we use the setActive callback
    if (_setActiveFn) _setActiveFn(course.id);
    _render();
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    getState: getState,
    resetState: resetState,
    setCurriculumLoaded: setCurriculumLoaded,
    setGrade: setGrade,
    setSubject: setSubject,
    setSelectedTags: setSelectedTags,
    setRenderClassManagerFn: setRenderClassManagerFn,
    setRenderFn: setRenderFn,
    setActiveFn: setActiveFn,
    renderCmCreateForm: renderCmCreateForm,
    renderCwStepBar: renderCwStepBar,
    renderCwStep1: renderCwStep1,
    renderCwStep2: renderCwStep2,
    renderCwStep3Customize: renderCwStep3Customize,
    renderCwStep4Review: renderCwStep4Review,
    cwSelectGrade: cwSelectGrade,
    cwSelectSubject: cwSelectSubject,
    cwToggleCourse: cwToggleCourse,
    cwSkipToCustom: cwSkipToCustom,
    cwGoToStep2: cwGoToStep2,
    cwGoToStep3: cwGoToStep3,
    cwGoToStep4: cwGoToStep4,
    cwGoBack: cwGoBack,
    cwGetPreName: cwGetPreName,
    cwFinishCreate: cwFinishCreate,
    cwAddGroup: cwAddGroup,
    cwDeleteGroup: cwDeleteGroup,
    cwToggleGroup: cwToggleGroup,
    cwUpdateGroupName: cwUpdateGroupName,
    cwUpdateGroupColor: cwUpdateGroupColor,
    cwCompGroupChange: cwCompGroupChange,
    cwAddCustomComp: cwAddCustomComp,
    cwRemoveCustomComp: cwRemoveCustomComp
  };
})();
