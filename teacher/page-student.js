/* ── page-student.js — Student Dashboard page module ───────── */
window.PageStudent = (function () {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  var studentId;
  var activeCourse;
  var activeSectionFilters = new Set();
  var _expandedGroups = new Set();
  var _overrideSelectedLevel = 0;
  var _profileData = null;
  var Notes = StudentNotes;
  var Overrides = StudentOverrides;

  function _assessmentCategoryLabel(cid, assessment) {
    return getAssessmentCategoryName(cid, assessment);
  }

  function _assessmentCategoryBadge(cid, assessment) {
    var label = _assessmentCategoryLabel(cid, assessment);
    var categoryId = getAssessmentCategoryId(assessment);
    var hasCategory = !!(categoryId || (assessment && assessment.type === 'summative'));
    var idx = categoryId
      ? (getCategories(cid) || []).findIndex(function (c) {
          return c.id === categoryId;
        })
      : -1;
    var t = typeof categoryTintByIndex === 'function' ? categoryTintByIndex(idx, label) : { bg: '', fg: '' };
    return (
      '<span class="type-badge ' +
      (hasCategory ? 'type-badge-s' : 'type-badge-f') +
      '" style="background:' +
      t.bg +
      ';color:' +
      t.fg +
      '">' +
      esc(label) +
      '</span>'
    );
  }

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    setActiveCourse(cid);
    await initData(cid);
    Router.navigate('#/dashboard');
  }

  function switchStudent(sid) {
    studentId = sid;
    _profileData = null;
    activeSectionFilters.clear();
    Router.navigate('#/student?id=' + sid + '&course=' + activeCourse);
  }

  /* ── Grade toggle ───────────────────────────────────────── */
  function toggleGradesView() {
    var wrap = document.getElementById('grades-table-wrap');
    var text = document.getElementById('grades-toggle-text');
    var arrow = document.getElementById('grades-toggle-arrow');
    if (!wrap) return;
    var isCollapsed = wrap.classList.toggle('collapsed');
    if (text) text.textContent = isCollapsed ? 'Show All Assignments' : 'Show Less';
    if (arrow) arrow.textContent = isCollapsed ? '▼' : '▲';
  }

  function toggleSectionFilter(secId) {
    if (activeSectionFilters.has(secId)) {
      activeSectionFilters.delete(secId);
    } else {
      activeSectionFilters.add(secId);
    }
    render();
  }

  function toggleGroupExpand(groupId) {
    if (_expandedGroups.has(groupId)) {
      _expandedGroups.delete(groupId);
    } else {
      _expandedGroups.add(groupId);
    }
    render();
  }

  /* ── Override UI ─────────────────────────────────────────── */
  function toggleOverridePanel(secId) {
    Overrides.toggleOverridePanel({
      activeCourse: activeCourse,
      studentId: studentId,
      secId: secId,
      setSelectedLevel: function (level) {
        _overrideSelectedLevel = level;
      },
      getSelectedLevel: function () {
        return _overrideSelectedLevel;
      },
    });
  }

  function selectOverrideLevel(level) {
    Overrides.selectOverrideLevel(
      level,
      _overrideSelectedLevel,
      function (levelValue) {
        _overrideSelectedLevel = levelValue;
      },
      function () {
        return _overrideSelectedLevel;
      },
    );
  }

  function saveOverride(secId) {
    Overrides.saveOverride(activeCourse, studentId, secId, _overrideSelectedLevel, render);
  }

  function clearOverride(secId) {
    Overrides.clearOverride(activeCourse, studentId, secId, render);
  }

  function closeOverridePanel(secId) {
    Overrides.closeOverridePanel(secId);
  }

  /* ── Tag detail toggle ──────────────────────────────────── */
  function toggleTag(row) {
    row.classList.toggle('open');
  }

  /* ── Notes & Observations ───────────────────────────────── */
  function renderNotes() {
    Notes.renderNotes(activeCourse, studentId);
  }

  function filterNotes(query) {
    Notes.filterNotes(query);
  }

  function addNote() {
    Notes.addNote(activeCourse, studentId);
  }

  /* ── Goal editing ───────────────────────────────────────── */
  function editGoal(secId) {
    document.getElementById('goal-edit-' + secId).style.display = '';
    document.getElementById('goal-text-' + secId).style.display = 'none';
    document.getElementById('goal-input-' + secId).focus();
  }
  function cancelGoalEdit(secId) {
    document.getElementById('goal-edit-' + secId).style.display = 'none';
    document.getElementById('goal-text-' + secId).style.display = '';
  }
  async function saveGoalField(secId) {
    var text = (document.getElementById('goal-input-' + secId).value || '').trim();
    var cid = activeCourse;
    var goals = getGoals(cid);
    if (!goals[studentId]) goals[studentId] = {};
    goals[studentId][secId] = text;
    saveGoals(cid, goals);
    if (typeof _setEchoGuard === 'function') _setEchoGuard('student-records', cid);
    if (window.v2 && _isUuid && _isUuid(studentId)) {
      await window.v2.saveGoal(studentId, secId, text);
    }
    render();
  }

  /* ── Reflection editing ─────────────────────────────────── */
  function editReflection(secId) {
    document.getElementById('refl-edit-' + secId).style.display = '';
    document.getElementById('refl-text-' + secId).style.display = 'none';
  }
  function cancelReflEdit(secId) {
    document.getElementById('refl-edit-' + secId).style.display = 'none';
    document.getElementById('refl-text-' + secId).style.display = '';
  }
  async function saveReflField(secId) {
    var text = (document.getElementById('refl-input-' + secId).value || '').trim();
    var conf = parseInt(document.getElementById('refl-conf-' + secId).value, 10) || 0;
    var cid = activeCourse;
    var reflections = getReflections(cid);
    if (!reflections[studentId]) reflections[studentId] = {};
    reflections[studentId][secId] = { confidence: conf, text: text, date: new Date().toISOString() };
    saveReflections(cid, reflections);
    if (typeof _setEchoGuard === 'function') _setEchoGuard('student-records', cid);
    if (window.v2 && _isUuid && _isUuid(studentId)) {
      await window.v2.saveReflection(studentId, secId, text, conf || null);
    }
    render();
  }

  function deleteNote(noteId) {
    Notes.deleteNote(activeCourse, studentId, noteId);
  }

  /* ── Edit Student Modal ─────────────────────────────────── */
  function openEditStudent() {
    var cid = activeCourse;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === studentId;
    });
    if (!st) return;

    var overlay = document.createElement('div');
    overlay.className = 'edit-modal-overlay';
    overlay.id = 'edit-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'edit-modal-heading');
    overlay.onclick = function (e) {
      if (e.target === overlay) closeEditStudent();
    };

    overlay.innerHTML =
      '<div class="edit-modal">' +
      '<h2 class="edit-modal-title" id="edit-modal-heading">Edit Student</h2>' +
      '<div class="edit-modal-form">' +
      '<div class="cm-field"><label class="cm-label" for="edit-first">First Name *</label><input class="cm-input" id="edit-first" value="' +
      esc(st.firstName || '') +
      '" aria-required="true" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-last">Last Name</label><input class="cm-input" id="edit-last" value="' +
      esc(st.lastName || '') +
      '" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-pref">Preferred Name</label><input class="cm-input" id="edit-pref" value="' +
      esc(st.preferred || '') +
      '" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-pro">Pronouns</label>' +
      pronounsSelect('edit-pro', st.pronouns || '') +
      '</div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-num">Student Number</label><input class="cm-input" id="edit-num" value="' +
      esc(st.studentNumber || '') +
      '" placeholder="e.g. STU-101" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-email">Email</label><input class="cm-input" id="edit-email" type="email" value="' +
      esc(st.email || '') +
      '" placeholder="student@school.edu" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-dob">Date of Birth</label><input class="cm-input" id="edit-dob" type="date" value="' +
      (st.dateOfBirth || '') +
      '" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Designations</label><div class="desig-check-grid">' +
      Object.entries(BC_DESIGNATIONS)
        .map(function (e) {
          var checked = (st.designations || []).indexOf(e[0]) >= 0 ? ' checked' : '';
          return (
            '<label class="desig-check-item" title="' +
            esc(e[1].desc || '') +
            '"><input type="checkbox" class="desig-check" value="' +
            e[0] +
            '"' +
            checked +
            '><span class="desig-check-code">' +
            e[0] +
            '</span><span class="desig-check-name">' +
            esc(e[1].name) +
            '</span></label>'
          );
        })
        .join('') +
      '</div></div>' +
      '</div>' +
      '<div class="edit-modal-actions">' +
      '<button class="btn-ghost" data-action="closeEditStudent">Cancel</button>' +
      '<button class="btn-primary" data-action="saveEditStudent">Update</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.getElementById('edit-first').focus();
    overlay._escHandler = function (e) {
      if (e.key === 'Escape') closeEditStudent();
    };
    document.addEventListener('keydown', overlay._escHandler);
  }

  function closeEditStudent() {
    var overlay = document.getElementById('edit-modal-overlay');
    if (overlay) {
      if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
      overlay.remove();
    }
  }

  function saveEditStudent() {
    var cid = activeCourse;
    var firstEl = document.getElementById('edit-first');
    var firstName = (firstEl.value || '').trim();
    if (!firstName) {
      firstEl.style.border = '2px solid var(--score-1)';
      firstEl.placeholder = 'First name is required';
      firstEl.oninput = function () {
        this.style.border = '';
      };
      firstEl.focus();
      return;
    }
    var lastName = (document.getElementById('edit-last').value || '').trim();
    var preferred = (document.getElementById('edit-pref').value || '').trim();
    var pronouns = (document.getElementById('edit-pro').value || '').trim();
    var studentNumber = (document.getElementById('edit-num').value || '').trim();
    var email = (document.getElementById('edit-email').value || '').trim();
    var dateOfBirth = (document.getElementById('edit-dob').value || '').trim();
    var designations = Array.from(document.querySelectorAll('.desig-check:checked')).map(function (cb) {
      return cb.value;
    });

    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === studentId;
    });
    if (!st) return;

    st.firstName = firstName;
    st.lastName = lastName;
    st.preferred = preferred;
    st.pronouns = pronouns;
    st.studentNumber = studentNumber;
    st.email = email;
    st.dateOfBirth = dateOfBirth;
    st.designations = designations;
    delete st.designation;
    st.sortName = ((lastName || '') + ' ' + firstName).trim();

    saveStudents(cid, students);
    closeEditStudent();
    // Re-render sidebar with updated name
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      studentId,
      'PageStudent.switchStudent',
    );
    render();
  }

  /* ── Competency tree renderer ───────────────────────────── */
  function _renderCompetencyTree(tree) {
    if (!tree) return '';
    var subjects = tree.subjects || [];
    if (subjects.length === 0) return '';
    var out = '<div class="ct-wrap"><div class="ct-title">Competency Profile</div>';
    subjects.forEach(function (subj) {
      var sections = subj.sections || [];
      if (sections.length === 0) return;
      out += '<div class="ct-subject"><div class="ct-subject-name">' + esc(subj.name) + '</div>';
      sections.forEach(function (sec) {
        var prof = sec.proficiency;
        var profRounded = prof != null ? Math.round(prof) : 0;
        var tags = sec.tags || [];
        out +=
          '<div class="ct-section">' +
          '<div class="ct-section-header">' +
          profLabelBadge(prof != null ? prof : 0) +
          '<span class="ct-section-name">' +
          esc(sec.name) +
          '</span>' +
          (sec.override ? '<span class="override-label">Overridden</span>' : '') +
          '</div>';
        if (tags.length > 0) {
          out += '<div class="ct-tags">';
          tags.forEach(function (tag) {
            var lv = tag.latest_value;
            var lvRounded = lv != null ? Math.round(lv) : 0;
            var lvColor = lv != null ? PROF_COLORS[lvRounded] || PROF_COLORS[0] : 'var(--text-3)';
            out +=
              '<div class="ct-tag-row">' +
              '<span class="ct-tag-code">' +
              esc(tag.code || '') +
              '</span>' +
              '<span class="ct-tag-label">' +
              esc(tag.label || '') +
              '</span>' +
              '<span class="ct-tag-val" style="color:' +
              lvColor +
              '">' +
              (lv != null ? lv.toFixed(1) : '\u2014') +
              '</span>' +
              '<span class="ct-tag-cov" title="' +
              (tag.coverage_count || 0) +
              ' assessment(s)">' +
              (tag.coverage_count || 0) +
              '</span>' +
              '</div>';
          });
          out += '</div>';
        }
        out += '</div>';
      });
      out += '</div>';
    });
    out += '</div>';
    return out;
  }

  /* ── Main render ────────────────────────────────────────── */
  function render() {
    var cid = activeCourse;
    var course = COURSES[cid];
    var students = getStudents(cid);
    var student = students.find(function (s) {
      return s.id === studentId;
    });
    if (!student) {
      document.getElementById('main').innerHTML =
        '<div style="text-align:center;padding:60px 20px">' +
        '<div style="font-size:2rem;margin-bottom:12px;opacity:0.5">?</div>' +
        '<div style="font-weight:600;font-size:1.1rem;margin-bottom:6px">Student not found</div>' +
        '<div style="color:var(--text-3);margin-bottom:16px">This student may have been removed or the link is outdated.</div>' +
        '<a href="#/dashboard" class="btn btn-primary">Back to Dashboard</a></div>';
      return;
    }

    var sections = getSections(cid);
    var allTags = getAllTags(cid);
    var assessments = getAssessments(cid);
    var assessMap = {};
    assessments.forEach(function (a) {
      assessMap[a.id] = a;
    });
    var overall = getOverallProficiency(cid, studentId);
    var overallRounded = Math.round(overall);
    var profColor = PROF_COLORS[overallRounded] || PROF_COLORS[0];

    // Completion stats
    var coveredTags = allTags.filter(function (t) {
      var sc = getTagScores(cid, studentId, t.id);
      return sc.some(function (s) {
        return s.score > 0;
      });
    }).length;
    var scoredAssessments = new Set();
    var allScores = getScores(cid)[studentId] || [];
    allScores.forEach(function (s) {
      if (s.score > 0) scoredAssessments.add(s.assessmentId);
    });
    var completionPct = getCompletionPct(cid, studentId);

    var statuses = getAssignmentStatuses(cid);

    // ── Toolbar ──
    var html =
      '<div class="student-toolbar">' +
      '<a class="tb-back-btn" href="#/dashboard">&larr; Dashboard</a>' +
      '<button class="tb-edit-btn" data-action="openEditStudent">Edit Student</button>' +
      '</div>';

    html += '<div class="student-scroll"><div style="padding:16px 20px">';

    // ── Header ──
    html += renderStudentHeader(cid, studentId, {
      buttonLabel: 'Term Questionnaire',
      buttonHref: '#/reports?course=' + cid + '&tab=questionnaire&student=' + studentId,
    });

    var obs = getStudentQuickObs(cid, studentId);
    var att = student.attendance || [];

    // ── Stats bar ──
    html += '<div class="student-stats-bar">';
    html +=
      '<div class="completion-card">' +
      completionRing(completionPct, profColor) +
      '<div class="completion-stats">' +
      '<div class="completion-stat"><strong>' +
      scoredAssessments.size +
      '/' +
      assessments.length +
      '</strong> assessed</div>' +
      '<div class="completion-stat"><strong>' +
      coveredTags +
      '/' +
      allTags.length +
      '</strong> tags covered</div>' +
      '</div>' +
      '</div>';
    var _stGrouped = getGroupedSections(cid);
    var _renderSecMini = function (sec) {
      var sp = getSectionProficiency(cid, studentId, sec.id);
      var isActive = activeSectionFilters.has(sec.id);
      var isDimmed = activeSectionFilters.size > 0 && !isActive;
      return (
        '<div class="section-mini-card' +
        (isActive ? ' active-filter' : '') +
        (isDimmed ? ' dimmed' : '') +
        '" data-action="toggleSectionFilter" data-secid="' +
        sec.id +
        '">' +
        '<div class="section-mini-stripe" style="background:' +
        sec.color +
        '"></div>' +
        '<div class="section-mini-val" style="color:' +
        (sp > 0 ? sec.color : 'var(--text-3)') +
        '">' +
        (sp > 0 ? sp.toFixed(1) : '\u2014') +
        '</div>' +
        '<div class="section-mini-label">' +
        esc(sec.name) +
        '</div>' +
        '</div>'
      );
    };
    if (
      _stGrouped.groups.some(function (g) {
        return g.sections.length > 0;
      })
    ) {
      // Group-aware: one card per group (averaged) + accordion + ungrouped
      _stGrouped.groups.forEach(function (gi) {
        if (gi.sections.length === 0) return;
        var gp = getGroupProficiency(cid, studentId, gi.group.id);
        var isExpanded = _expandedGroups.has(gi.group.id);
        var anyActive = gi.sections.some(function (s) {
          return activeSectionFilters.has(s.id);
        });
        var isDimmed = activeSectionFilters.size > 0 && !anyActive;
        html +=
          '<div class="section-mini-card' +
          (anyActive ? ' active-filter' : '') +
          (isDimmed ? ' dimmed' : '') +
          '" data-action="toggleGroupExpand" data-groupid="' +
          gi.group.id +
          '">' +
          '<div class="section-mini-stripe" style="background:' +
          gi.group.color +
          '"></div>' +
          '<div class="section-mini-val" style="color:' +
          (gp > 0 ? gi.group.color : 'var(--text-3)') +
          '">' +
          (gp > 0 ? gp.toFixed(1) : '\u2014') +
          '</div>' +
          '<div class="section-mini-label">' +
          esc(gi.group.name) +
          '</div>' +
          '</div>';
        // Accordion: show individual sections when expanded
        if (isExpanded) {
          html += '<div class="stu-group-accordion">';
          gi.sections.forEach(function (sec) {
            html += _renderSecMini(sec);
          });
          html += '</div>';
        }
      });
      // Ungrouped sections as individual cards
      _stGrouped.ungrouped.forEach(function (sec) {
        html += _renderSecMini(sec);
      });
    } else {
      // No groups — flat section cards
      sections.forEach(function (sec) {
        html += _renderSecMini(sec);
      });
    }
    html += '</div>';

    // ── Assessment Grades Table ──
    var sortedAssessments = assessments.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    if (activeSectionFilters.size > 0) {
      var filterTagIds = new Set();
      sections.forEach(function (sec) {
        if (activeSectionFilters.has(sec.id)) {
          sec.tags.forEach(function (t) {
            filterTagIds.add(t.id);
          });
        }
      });
      sortedAssessments = sortedAssessments.filter(function (a) {
        return (a.tagIds || []).some(function (tid) {
          return filterTagIds.has(tid);
        });
      });
    }

    html +=
      '<div class="grades-section">' +
      '<div class="grades-header">' +
      '<div class="insight-title" style="margin-bottom:0">Assessment Grades' +
      (activeSectionFilters.size > 0
        ? ' <span style="font-family:var(--font-base);font-size:0.72rem;font-weight:500;color:var(--text-3);text-transform:none;letter-spacing:0">(filtered — <a href="#" data-action="clearSectionFilters" style="color:var(--active);text-decoration:none">show all</a>)</span>'
        : '') +
      '</div>' +
      '<div class="grades-legend">' +
      '<span class="grades-legend-item"><span class="grades-legend-dot" style="background:' +
      PROF_COLORS[4] +
      '"></span>Ext</span>' +
      '<span class="grades-legend-item"><span class="grades-legend-dot" style="background:' +
      PROF_COLORS[3] +
      '"></span>Pro</span>' +
      '<span class="grades-legend-item"><span class="grades-legend-dot" style="background:' +
      PROF_COLORS[2] +
      '"></span>Dev</span>' +
      '<span class="grades-legend-item"><span class="grades-legend-dot" style="background:' +
      PROF_COLORS[1] +
      '"></span>Emg</span>' +
      '<span class="grades-legend-item"><span class="grades-legend-dot" style="background:var(--surface-2);border:1px solid var(--border)"></span>—</span>' +
      '</div>' +
      '</div>' +
      '<div class="grades-table-wrap' +
      (sortedAssessments.length > 8 ? ' collapsed' : '') +
      '" id="grades-table-wrap">' +
      '<table class="grades-table">' +
      '<thead><tr>' +
      '<th class="gt-col-status"></th>' +
      '<th class="gt-col-title">Assignment</th>' +
      '<th class="gt-col-date">Date</th>' +
      '<th class="gt-col-type">Category</th>';

    var allAssessTagIds = [];
    sortedAssessments.forEach(function (a) {
      (a.tagIds || []).forEach(function (tid) {
        if (!allAssessTagIds.includes(tid)) allAssessTagIds.push(tid);
      });
    });
    var tagColGroups = [];
    sections.forEach(function (sec) {
      var secTags = sec.tags.filter(function (t) {
        return allAssessTagIds.includes(t.id);
      });
      if (secTags.length > 0) tagColGroups.push({ sec: sec, tags: secTags });
    });

    tagColGroups.forEach(function (g) {
      var tag = g.tags[0];
      if (tag)
        html +=
          '<th class="gt-col-score" style="color:' +
          g.sec.color +
          '" title="' +
          esc(tag.text || tag.label) +
          '">' +
          esc(tag.code || tag.shortName || '') +
          '</th>';
    });
    html += '<th class="gt-col-avg">Avg</th></tr></thead><tbody>';

    sortedAssessments.forEach(function (assess) {
      var assessScores = allScores.filter(function (s) {
        return s.assessmentId === assess.id;
      });
      var scoredCount = assessScores.filter(function (s) {
        return s.score > 0;
      }).length;
      var totalTags = (assess.tagIds || []).length;
      var allScored = totalTags > 0 && scoredCount >= totalTags;
      var noneScored = scoredCount === 0;
      var isLate = assess.dueDate && new Date(assess.dueDate) < new Date() && noneScored;

      var statusColor = isLate
        ? 'var(--priority)'
        : noneScored
          ? 'var(--text-3)'
          : allScored
            ? 'var(--score-3)'
            : '#e65100';
      var statusIcon = isLate ? '⚠' : noneScored ? '○' : allScored ? '●' : '◐';
      var statusTitle = isLate
        ? 'Past due — not scored'
        : noneScored
          ? 'Not scored'
          : allScored
            ? 'Complete'
            : scoredCount + '/' + totalTags + ' scored';

      var scoredEntries = assessScores.filter(function (s) {
        return s.score > 0;
      });
      var rowAvg =
        scoredEntries.length > 0
          ? scoredEntries.reduce(function (sum, s) {
              return sum + s.score;
            }, 0) / scoredEntries.length
          : 0;
      var rowAvgR = Math.round(rowAvg);

      var mod = assess.moduleId ? getModuleById(cid, assess.moduleId) : null;
      var assessStatus = statuses[studentId + ':' + assess.id];

      html +=
        '<tr class="gt-row' +
        (noneScored ? ' gt-row-empty' : '') +
        (assessStatus ? ' gt-row-status' : '') +
        '">' +
        '<td class="gt-cell-status" title="' +
        statusTitle +
        '"><span style="color:' +
        statusColor +
        '">' +
        statusIcon +
        '</span></td>' +
        '<td class="gt-cell-title">' +
        '<a class="gt-title-text" href="#/assignments?course=' +
        cid +
        '&open=' +
        assess.id +
        '&student=' +
        studentId +
        '" title="Open in Assignments">' +
        esc(assess.title) +
        '</a>' +
        (mod
          ? '<span class="gt-module-dot" style="background:' +
            cssColor(mod.color) +
            '" title="' +
            esc(mod.name) +
            '"></span>'
          : '') +
        (assessStatus === 'NS'
          ? '<span class="gt-status-tag gt-tag-ns">NS</span>'
          : assessStatus === 'EXC'
            ? '<span class="gt-status-tag gt-tag-exc">EXC</span>'
            : assessStatus === 'LATE'
              ? '<span class="gt-status-tag gt-tag-late">LATE</span>'
              : '') +
        '</td>' +
        '<td class="gt-cell-date">' +
        formatDate(assess.date) +
        '</td>' +
        '<td class="gt-cell-type">' +
        _assessmentCategoryBadge(cid, assess) +
        '</td>';

      tagColGroups.forEach(function (g) {
        var tag = g.tags[0];
        if (!tag) return;
        var included = (assess.tagIds || []).includes(tag.id);
        if (!included) {
          html += '<td class="gt-cell-score gt-cell-na"></td>';
        } else {
          var entry = assessScores.find(function (s) {
            return s.tagId === tag.id;
          });
          var score = entry ? entry.score : 0;
          if (score > 0) {
            html +=
              '<td class="gt-cell-score"><span class="gt-score-pip" style="background:' +
              PROF_COLORS[score] +
              '">' +
              score +
              '</span></td>';
          } else {
            html += '<td class="gt-cell-score"><span class="gt-score-empty">—</span></td>';
          }
        }
      });

      html +=
        '<td class="gt-cell-avg">' +
        (rowAvg > 0
          ? '<span style="color:' + PROF_COLORS[rowAvgR] + ';font-weight:700">' + rowAvg.toFixed(1) + '</span>'
          : '<span style="color:var(--text-3)">—</span>') +
        '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    if (sortedAssessments.length > 8) {
      html +=
        '<div style="text-align:center"><button class="grades-toggle-btn" data-action="toggleGradesView">' +
        '<span id="grades-toggle-text">Show All ' +
        sortedAssessments.length +
        ' Assignments</span>' +
        '<span id="grades-toggle-arrow">▼</span>' +
        '</button></div>';
    }

    if (scoredAssessments.size === 0) {
      html +=
        '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">No scores yet</div><div class="empty-state-text">Grade assignments in the Assignments tab to see results here.</div></div>';
    }

    html += '</div>';

    // ── Section cards grid ──
    var goals = getGoals(cid);
    var reflections = getReflections(cid);
    var studentGoals = goals[studentId] || {};
    var studentReflections = reflections[studentId] || {};

    html += '<div class="dash-grid">';
    sections.forEach(function (sec) {
      var sp = getSectionProficiency(cid, studentId, sec.id);
      var spRounded = Math.round(sp);
      var subj = getSubjects(cid).find(function (su) {
        return su.id === sec.subject;
      });
      var growthData = getSectionGrowthData(cid, studentId, sec.id);
      var override = getSectionOverride(cid, studentId, sec.id);
      var rawProf = getSectionProficiencyRaw(cid, studentId, sec.id);

      html +=
        '<div class="dash-section">' +
        '<div class="dash-section-stripe" style="background:' +
        sec.color +
        '"></div>' +
        '<div class="dash-section-header">' +
        '<div>' +
        '<div class="dash-section-title">' +
        esc(sec.name) +
        '</div>' +
        (subj ? '<div class="dash-section-subject">' + esc(subj.name) + '</div>' : '') +
        (override ? '<div class="override-label">Overridden</div>' : '') +
        '</div>' +
        profLabelBadge(sp) +
        '<button class="override-btn' +
        (override ? ' active' : '') +
        '" data-action="toggleOverridePanel" data-secid="' +
        sec.id +
        '" data-stop-prop="true" title="' +
        (override ? 'Edit override' : 'Override proficiency') +
        '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>' +
        '</button>' +
        '</div>' +
        '<div class="override-panel" id="override-panel-' +
        sec.id +
        '" style="display:none"></div>';

      if (growthData.length > 0) {
        html +=
          '<div style="margin-bottom:8px;">' +
          "<span style=\"font-family:'SF Mono', ui-monospace, 'Menlo', monospace;font-size:0.5rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:6px;\">Growth</span>" +
          renderGrowthSparkline(growthData) +
          '</div>';
      }

      var tag = sec.tags[0];
      if (tag) {
        var tp = getTagProficiency(cid, studentId, tag.id);
        var tagScores = getTagScores(cid, studentId, tag.id).filter(function (s) {
          return s.score > 0;
        });
        var evidenceCount = tagScores.length;
        html +=
          '<div class="dash-tag-row" data-action="toggleTag">' +
          profLabelBadge(tp) +
          '<span class="dash-tag-label">' +
          esc(tag.label) +
          '</span>' +
          '<span class="dash-tag-bar">' +
          profBar(tp, 4, sec.color) +
          '</span>' +
          '<span class="dash-tag-evidence">' +
          evidenceCount +
          '</span>' +
          '<span class="dash-tag-chevron">&#9654;</span>' +
          '</div>' +
          '<div class="tag-detail">';

        tagScores.sort(function (a, b) {
          return (b.date || '').localeCompare(a.date || '');
        });
        if (tagScores.length === 0) {
          html += '<div style="font-size:0.75rem;color:var(--text-3);padding:4px 0;">No evidence yet</div>';
        } else {
          tagScores.forEach(function (sc) {
            var assess = assessMap[sc.assessmentId];
            var sColor = PROF_COLORS[sc.score] || PROF_COLORS[0];
            var href = assess ? '#/assignments?course=' + cid + '&open=' + assess.id + '&student=' + studentId : '';
            var title = assess ? esc(assess.title) : 'Unknown';
            html +=
              '<a class="tag-assess-row"' +
              (href ? ' href="' + href + '"' : '') +
              ' title="Open in Assignments">' +
              '<span class="tag-assess-pip" style="background:' +
              sColor +
              '">' +
              (sc.score || '\u2014') +
              '</span>' +
              '<span class="tag-assess-title">' +
              title +
              '</span>' +
              '<span class="tag-assess-date">' +
              formatDate(sc.date) +
              '</span>' +
              '</a>';
          });
        }
        html += '</div>';
      }

      // Goal section
      var goalText = studentGoals[sec.id] || '';
      html +=
        '<div class="section-goal" id="goal-' +
        sec.id +
        '">' +
        '<div class="section-goal-label">Goal <button class="edit-btn-inline" data-action="editGoal" data-secid="' +
        sec.id +
        '">✎ Edit</button></div>' +
        '<div class="section-goal-text" id="goal-text-' +
        sec.id +
        '">' +
        (goalText ? esc(goalText) : '') +
        '</div>' +
        '<div class="inline-edit-area" id="goal-edit-' +
        sec.id +
        '" style="display:none">' +
        '<textarea id="goal-input-' +
        sec.id +
        '" placeholder="Set a learning goal for this section…">' +
        esc(goalText) +
        '</textarea>' +
        '<div class="inline-edit-actions">' +
        '<button class="btn btn-primary" data-action="saveGoalField" data-secid="' +
        sec.id +
        '">Save</button>' +
        '<button class="btn" data-action="cancelGoalEdit" data-secid="' +
        sec.id +
        '">Cancel</button>' +
        '</div>' +
        '</div>' +
        '</div>';

      // Reflection section
      var refl = studentReflections[sec.id] || {};
      var confLabel = refl.confidence ? CONFIDENCE_LABELS[refl.confidence] || '' : '';
      var confColor = refl.confidence ? CONFIDENCE_COLORS[refl.confidence] || '#bbb' : '';
      html +=
        '<div class="section-reflection" id="refl-' +
        sec.id +
        '">' +
        '<div class="section-reflection-label">Self-Reflection' +
        (confLabel
          ? ' <span class="confidence-badge" style="background:' + confColor + '">' + confLabel + '</span>'
          : '') +
        ' <button class="edit-btn-inline" data-action="editReflection" data-secid="' +
        sec.id +
        '">✎ Edit</button>' +
        '</div>' +
        '<div class="section-reflection-text" id="refl-text-' +
        sec.id +
        '">' +
        (refl.text ? esc(refl.text) : '') +
        '</div>' +
        (refl.date
          ? "<div style=\"font-family:'SF Mono', ui-monospace, 'Menlo', monospace;font-size:0.5rem;color:var(--text-3);margin-top:2px;\">" +
            formatDate(refl.date) +
            '</div>'
          : '') +
        '<div class="inline-edit-area" id="refl-edit-' +
        sec.id +
        '" style="display:none">' +
        '<select id="refl-conf-' +
        sec.id +
        '">' +
        '<option value="">Confidence level…</option>' +
        '<option value="1"' +
        (refl.confidence === 1 ? ' selected' : '') +
        '>Beginning</option>' +
        '<option value="2"' +
        (refl.confidence === 2 ? ' selected' : '') +
        '>Growing</option>' +
        '<option value="3"' +
        (refl.confidence === 3 ? ' selected' : '') +
        '>Confident</option>' +
        '<option value="4"' +
        (refl.confidence === 4 ? ' selected' : '') +
        '>Leading</option>' +
        '</select>' +
        '<textarea id="refl-input-' +
        sec.id +
        '" placeholder="Student\'s own words about their learning…">' +
        esc(refl.text || '') +
        '</textarea>' +
        '<div class="inline-edit-actions">' +
        '<button class="btn btn-primary" data-action="saveReflField" data-secid="' +
        sec.id +
        '">Save</button>' +
        '<button class="btn" data-action="cancelReflEdit" data-secid="' +
        sec.id +
        '">Cancel</button>' +
        '</div>' +
        '</div>' +
        '</div>';

      html += '</div>';
    });
    html += '</div>';

    // ── Insights grid ──
    // (Growth Profile, Needs Attention, Assignment Feedback, Notes & Observations, Focus Areas, Core Competencies)
    // This is large but identical to student.html render logic — included inline
    html += '<div class="insights-grid">';

    // 1. Growth Profile
    html += '<div class="insight-card"><div class="insight-title">Growth Profile</div>';
    var gpSections = getSections(cid);
    gpSections.forEach(function (sec) {
      var prof = getSectionProficiency(cid, studentId, sec.id);
      var trend = getSectionTrend(cid, studentId, sec.id);
      var pct = prof > 0 ? (prof / 4) * 100 : 0;
      var color = prof > 0 ? PROF_COLORS[Math.round(prof)] : 'var(--text-3)';
      var tIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '';
      var tColor = trend === 'up' ? 'var(--score-3)' : trend === 'down' ? 'var(--priority)' : '';
      var shortLabel = sec.name.length > 14 ? sec.name.slice(0, 13) + '…' : sec.name;
      html +=
        '<div class="gp-section-row">' +
        '<span class="gp-section-label" title="' +
        esc(sec.name) +
        '">' +
        esc(shortLabel) +
        '</span>' +
        '<div class="gp-section-bar-track"><div class="gp-section-bar-fill" style="width:' +
        pct +
        '%;background:' +
        color +
        '"></div></div>' +
        '<span class="gp-section-val" style="color:' +
        color +
        '">' +
        (prof > 0 ? prof.toFixed(1) : '—') +
        '</span>' +
        '<span class="gp-section-trend" style="color:' +
        tColor +
        '">' +
        tIcon +
        '</span>' +
        '</div>';
    });
    html += '<div class="gp-divider"></div>';
    var gpObs = getStudentQuickObs(cid, studentId);
    var obsDims = {};
    gpObs.forEach(function (o) {
      (o.dims || []).forEach(function (d) {
        obsDims[d] = (obsDims[d] || 0) + 1;
      });
    });
    var gpAllDims = OBS_DIMS.map(function (d) {
      return { key: d, label: OBS_SHORT[d] };
    });
    html += '<div class="gp-dims">';
    gpAllDims.forEach(function (d) {
      var count = obsDims[d.key] || 0;
      html +=
        '<span class="gp-dim-pip ' +
        (count > 0 ? 'active' : 'inactive') +
        '">' +
        d.label +
        (count > 0 ? ' ' + count : '') +
        '</span>';
    });
    html += '</div>';
    var gpStrengths = gpObs.filter(function (o) {
      return o.sentiment === 'strength';
    }).length;
    var gpGrowth = gpObs.filter(function (o) {
      return o.sentiment === 'growth';
    }).length;
    var gpConcerns = gpObs.filter(function (o) {
      return o.sentiment === 'concern';
    }).length;
    if (gpObs.length > 0) {
      var parts = [gpObs.length + ' observation' + (gpObs.length !== 1 ? 's' : '')];
      if (gpStrengths) parts.push(gpStrengths + ' strength' + (gpStrengths !== 1 ? 's' : ''));
      if (gpGrowth) parts.push(gpGrowth + ' growth');
      if (gpConcerns) parts.push(gpConcerns + ' concern' + (gpConcerns !== 1 ? 's' : ''));
      html += '<div class="gp-obs-stat">' + parts.join(' · ') + '</div>';
    } else {
      html += '<div class="gp-obs-stat">No observations yet</div>';
    }
    html += '<div class="gp-divider"></div>';
    var gpCompPct = getCompletionPct(cid, studentId);
    var gpAllTags = getAllTags(cid);
    var gpCoveredTags = gpAllTags.filter(function (t) {
      var sc = getTagScores(cid, studentId, t.id);
      return sc.some(function (s) {
        return s.score > 0;
      });
    }).length;
    html +=
      '<div class="gp-coverage-row"><div class="gp-coverage-bar"><div class="gp-coverage-fill" style="width:' +
      gpCompPct +
      '%"></div></div><span class="gp-coverage-label">' +
      gpCoveredTags +
      '/' +
      gpAllTags.length +
      ' tags · ' +
      gpCompPct +
      '%</span></div>';
    html += '</div>';

    // 2. Needs Attention
    html += '<div class="insight-card"><div class="insight-title">Needs Attention</div>';
    var attentionItems = [];
    sortedAssessments.forEach(function (assess) {
      var aScores = allScores.filter(function (s) {
        return s.assessmentId === assess.id && s.score > 0;
      });
      var totalT = (assess.tagIds || []).length;
      if (totalT === 0) return;
      if (aScores.length === 0) attentionItems.push({ type: 'missing', assess: assess, detail: 'No scores entered' });
      else if (aScores.length < totalT)
        attentionItems.push({
          type: 'partial',
          assess: assess,
          detail: aScores.length + '/' + totalT + ' tags scored',
        });
    });
    sortedAssessments.forEach(function (assess) {
      var aScores = allScores.filter(function (s) {
        return s.assessmentId === assess.id && s.score > 0;
      });
      if (aScores.length === 0) return;
      var avg =
        aScores.reduce(function (sum, s) {
          return sum + s.score;
        }, 0) / aScores.length;
      if (avg < 2)
        attentionItems.push({ type: 'low', assess: assess, detail: 'Avg ' + avg.toFixed(1) + ' — needs support' });
    });
    if (attentionItems.length === 0) {
      html += '<div class="attention-empty">✓ All caught up — no issues flagged.</div>';
    } else {
      attentionItems.slice(0, 6).forEach(function (item) {
        var icon = item.type === 'missing' ? '○' : item.type === 'partial' ? '◐' : '▼';
        var iconBg = item.type === 'missing' ? 'var(--surface-2)' : item.type === 'partial' ? '#fff3e0' : '#fce4ec';
        var iconColor = item.type === 'missing' ? 'var(--text-3)' : item.type === 'partial' ? '#e65100' : '#c62828';
        html +=
          '<div class="attention-item">' +
          '<div class="attention-icon" style="background:' +
          iconBg +
          ';color:' +
          iconColor +
          '">' +
          icon +
          '</div>' +
          '<div class="attention-info">' +
          '<div class="attention-title">' +
          esc(item.assess.title) +
          '</div>' +
          '<div class="attention-detail">' +
          item.detail +
          ' · ' +
          formatDate(item.assess.date) +
          '</div>' +
          '</div>' +
          '</div>';
      });
    }
    html += '</div>';

    // 2b. Assignment Feedback
    var assignFeedback = getStudentAssignmentFeedback(cid, studentId);
    if (assignFeedback.length > 0) {
      html += '<div class="insight-card"><div class="insight-title">Assignment Feedback</div><div class="notes-list">';
      assignFeedback.slice(0, 5).forEach(function (fb) {
        var d = new Date(fb.created);
        var ds = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        html +=
          '<div class="note-inline"><div class="note-inline-left"><span class="note-inline-date">' +
          ds +
          '</span></div><div class="note-inline-body"><span class="note-assign-badge">' +
          esc(fb.assignmentContext.assessmentTitle) +
          (fb.assignmentContext.proficiencyLevel ? ' · ' + fb.assignmentContext.proficiencyLevel : '') +
          '</span><div class="note-inline-text">' +
          esc(fb.text) +
          '</div></div></div>';
      });
      html += '</div></div>';
    }

    // 3. Notes & Observations
    html +=
      '<div class="insight-card notes-panel"><div class="insight-title">Notes & Observations</div>' +
      '<input type="text" class="note-search-input" id="note-search" placeholder="Search…" aria-label="Search notes">' +
      '<div class="notes-scroll"><div class="notes-list" id="notes-list"></div></div>' +
      '<div class="note-add-row"><input class="note-add-input" id="note-input" placeholder="Add a note\u2026" aria-label="Add a note"><button class="note-add-btn" data-action="addNote">Add</button></div>' +
      '</div>';

    html += '</div>'; // end insights-grid

    if (_profileData && _profileData.competency_tree) {
      html += _renderCompetencyTree(_profileData.competency_tree);
    }

    // ── Core Competencies ──
    var ccTally = {};
    CORE_COMPETENCIES.forEach(function (cc) {
      ccTally[cc.id] = 0;
    });
    assessments.forEach(function (assess) {
      if (!(assess.coreCompetencyIds && assess.coreCompetencyIds.length > 0)) return;
      var hasScore = allScores.some(function (s) {
        return s.assessmentId === assess.id && s.score > 0;
      });
      if (!hasScore) return;
      assess.coreCompetencyIds.forEach(function (ccId) {
        if (ccTally[ccId] !== undefined) ccTally[ccId]++;
      });
    });
    var maxCC = Math.max(1, Math.max.apply(null, Object.values(ccTally)));
    var anyCC = Object.values(ccTally).some(function (v) {
      return v > 0;
    });

    if (anyCC) {
      html +=
        '<div class="cc-profile"><div class="cc-profile-title">Core Competencies</div><div class="cc-profile-grid">';
      var groups = {};
      CORE_COMPETENCIES.forEach(function (cc) {
        if (!groups[cc.group]) groups[cc.group] = [];
        groups[cc.group].push(cc);
      });
      Object.entries(groups).forEach(function (entry) {
        var group = entry[0],
          ccs = entry[1];
        html +=
          '<div class="cc-group"><div class="cc-group-label" style="color:' +
          ccs[0].color +
          '">' +
          esc(group) +
          '</div>';
        ccs.forEach(function (cc) {
          var count = ccTally[cc.id];
          var pctV = Math.round((count / maxCC) * 100);
          html +=
            '<div class="cc-bar-row"><span class="cc-bar-label">' +
            esc(cc.label) +
            '</span><div class="cc-bar-track"><div class="cc-bar-fill" style="width:' +
            (count > 0 ? Math.max(pctV, 6) : 0) +
            '%;background:' +
            cc.color +
            '"></div></div><span class="cc-bar-count" style="color:' +
            (count > 0 ? cc.color : 'var(--text-3)') +
            '">' +
            count +
            '</span></div>';
        });
        html += '</div>';
      });
      html += '</div></div>';
    }

    html += '</div></div>'; // close padding wrapper + scroll wrapper
    document.getElementById('main').innerHTML = html;
    renderNotes();

    // Wire note search
    var noteSearchEl = document.getElementById('note-search');
    if (noteSearchEl) {
      noteSearchEl.addEventListener('input', function () {
        filterNotes(this.value);
      });
    }

    // Wire note input Enter key
    var noteInputEl = document.getElementById('note-input');
    if (noteInputEl) {
      noteInputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          addNote();
          e.preventDefault();
        }
      });
    }
  }

  /* ── Delegated click handler ──────────────────────────────── */
  function _handleClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();
    var handlers = {
      openEditStudent: function () {
        openEditStudent();
      },
      toggleSectionFilter: function () {
        toggleSectionFilter(el.dataset.secid);
      },
      toggleGroupExpand: function () {
        toggleGroupExpand(el.dataset.groupid);
      },
      clearSectionFilters: function () {
        e.preventDefault();
        activeSectionFilters.clear();
        _expandedGroups.clear();
        render();
      },
      toggleGradesView: function () {
        toggleGradesView();
      },
      toggleOverridePanel: function () {
        toggleOverridePanel(el.dataset.secid);
      },
      toggleTag: function () {
        toggleTag(el);
      },
      editGoal: function () {
        editGoal(el.dataset.secid);
      },
      saveGoalField: function () {
        saveGoalField(el.dataset.secid);
      },
      cancelGoalEdit: function () {
        cancelGoalEdit(el.dataset.secid);
      },
      editReflection: function () {
        editReflection(el.dataset.secid);
      },
      saveReflField: function () {
        saveReflField(el.dataset.secid);
      },
      cancelReflEdit: function () {
        cancelReflEdit(el.dataset.secid);
      },
      addNote: function () {
        addNote();
      },
      closeOverridePanel: function () {
        closeOverridePanel(el.dataset.secid);
      },
      selectOverrideLevel: function () {
        selectOverrideLevel(parseInt(el.dataset.value, 10));
      },
      clearOverride: function () {
        clearOverride(el.dataset.secid);
      },
      saveOverride: function () {
        saveOverride(el.dataset.secid);
      },
      deleteNote: function () {
        deleteNote(el.dataset.noteid);
      },
      closeEditStudent: function () {
        closeEditStudent();
      },
      saveEditStudent: function () {
        saveEditStudent();
      },
    };
    if (handlers[action]) {
      if (el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    studentId = params.id;
    activeSectionFilters = new Set();
    _overrideSelectedLevel = 0;

    // Show sidebar with student roster
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      studentId,
      'PageStudent.switchStudent',
    );
    initSidebarToggle();

    // Expose switchCourse for dock
    window._pageSwitchCourse = switchCourse;

    // Add delegated listeners
    _addDocListener('click', _handleClick);

    _profileData = null;
    render();

    if (window.v2 && window.v2.getStudentProfile) {
      window.v2.getStudentProfile(studentId).then(function (res) {
        if (res && res.data) {
          _profileData = res.data;
          render();
        }
      });
    }

    requestAnimationFrame(function () {
      document.getElementById('main').scrollTop = 0;
    });
  }

  function destroy() {
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    // Clean up any open edit modal
    closeEditStudent();
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    switchStudent: switchStudent,
    switchCourse: switchCourse,
  };
})();
