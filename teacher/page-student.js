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
  var _tab = 'comps'; // the open tab: comps, assess, evidence, breakdown, goals, profile
  var _assessFilter = 'all'; // Assessments tab: all, prof, points, unscored
  var _assessCat = ''; // Assessments tab: a category id, or '' for all
  var _assessGroup = 'date'; // Assessments tab: date, category, module, type, rubric
  var _assessClosed = {}; // Assessments tab: '<group by>:<key>' of groups folded shut
  var _bdOpen = {}; // Grade Breakdown tab: categories whose assessments show
  var _bdRubric = ''; // Grade Breakdown tab: the shared rubric shown ('' = the first)
  var _typeView = 'strengths'; // Grade Breakdown tab: strengths, growth, month, timeline
  var _typeFocus = ''; // Grade Breakdown tab, Timeline: the type brought forward ('' = all)
  var _openTags = new Set(); // competency cards whose evidence drawer is open
  var _overrideSelectedLevel = 0;
  var Evidence = StudentEvidence;
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
    if (!(await switchActiveCourse(cid))) return;
    Router.navigate('#/dashboard');
  }

  /* Another student keeps the open tab, so a teacher can go down the class
     on one tab. */
  function switchStudent(sid) {
    studentId = sid;
    Router.navigate('#/student?id=' + sid + '&course=' + activeCourse + '&tab=' + _tab);
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
    var open = row.classList.toggle('open');
    row.setAttribute('aria-expanded', String(open));
    var tagId = row.dataset.tagid;
    if (tagId) {
      if (open) _openTags.add(tagId);
      else _openTags.delete(tagId);
    }
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
    if (window.v2 && _isUuid && _isUuid(studentId)) {
      await window.v2.saveReflection(studentId, secId, text, conf || null);
    }
    render();
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
      '" aria-required="true" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-last">Last Name</label><input class="cm-input" id="edit-last" value="' +
      esc(st.lastName || '') +
      '" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-pref">Preferred Name</label><input class="cm-input" id="edit-pref" value="' +
      esc(st.preferred || '') +
      '" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-pro">Pronouns</label>' +
      pronounsSelect('edit-pro', st.pronouns || '') +
      '</div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-num">Student Number</label><input class="cm-input" id="edit-num" value="' +
      esc(st.studentNumber || '') +
      '" placeholder="e.g. STU-101" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-email">Email</label><input class="cm-input" id="edit-email" type="email" value="' +
      esc(st.email || '') +
      '" placeholder="student@school.edu" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="edit-dob">Date of Birth</label><input class="cm-input" id="edit-dob" type="date" value="' +
      (st.dateOfBirth || '') +
      '" style="font-size:0.875rem;padding:6px 10px"></div>' +
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
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Language Support</label><div class="desig-check-grid">' +
      Object.entries(SUPPORT_FLAGS)
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

  /* ── Tabs ───────────────────────────────────────────────── */
  var TABS = [
    { id: 'comps', label: 'Competencies' },
    { id: 'assess', label: 'Assessments' },
    { id: 'evidence', label: 'Observations' },
    { id: 'breakdown', label: 'Grade Breakdown' },
    { id: 'goals', label: 'Goals and Reflections' },
    { id: 'profile', label: 'Learner Profile' },
  ];

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _shortDay(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _daysAgo(dateStr) {
    var today = typeof getTodayStr === 'function' ? getTodayStr() : new Date().toISOString().slice(0, 10);
    var n = Math.round((new Date(today + 'T00:00:00') - new Date(String(dateStr).slice(0, 10) + 'T00:00:00')) / 864e5);
    if (!(n >= 0)) return _shortDay(dateStr);
    return n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
  }

  function _obDay(ob) {
    return (ob && (ob.date || (ob.created || '').slice(0, 10))) || '';
  }

  /* A level as the class shows it, with its proficiency word unless the
     class is Letter, tinted by its level. */
  function _levelPill(cid, v) {
    var lvl = v > 0 ? Math.round(v) : 0;
    var word = typeof levelWord === 'function' ? levelWord(cid, v) : '';
    return (
      '<span class="stu-level stu-level-' +
      lvl +
      '">' +
      esc(formatLevel(cid, v)) +
      (word ? ' ' + esc(word) : '') +
      '</span>'
    );
  }

  /* A score entry from getTagScores as teachers write it: 3+, or 8/10. */
  function _entryText(entry, assess) {
    if (assess && isPointsScored(assess) && !isCompletionScored(assess) && entry.rawPoints != null) {
      return formatPoints(entry.rawPoints) + '/' + formatPoints(assess.maxPoints || 100);
    }
    var level = entry.level != null ? entry.level : entry.score;
    return formatScoreLevel(level, entry.mod) || String(level);
  }

  /* One assessment's score as the gradebook shows it. */
  function _cellText(cell, assess) {
    if (cell.kind === 'points') {
      var max = assess.maxPoints || 100;
      return formatPoints(cell.value) + '/' + formatPoints(max) + ' · ' + formatPointsPercent(cell.value, max);
    }
    return cell.text;
  }

  /* A competency's scored entries in the current term, oldest first. */
  function _compEntries(cid, sec) {
    var tag = sec.tags[0];
    if (!tag) return [];
    return getTagScores(cid, studentId, tag.id)
      .filter(function (s) {
        return s.score > 0;
      })
      .slice()
      .sort(function (a, b) {
        return (a.date || '').localeCompare(b.date || '');
      });
  }

  function _latestLine(cid, sec, assessMap) {
    var entries = _compEntries(cid, sec);
    var last = entries[entries.length - 1];
    if (!last) return 'No scores yet';
    var a = assessMap[last.assessmentId];
    return _entryText(last, a) + (a ? ' on ' + a.title : '') + ', ' + _shortDay(last.date);
  }

  function _tabSummaries(ctx) {
    var cid = ctx.cid;
    var out = {};
    var profs = ctx.sections
      .map(function (sec) {
        return getSectionProficiency(cid, studentId, sec.id);
      })
      .filter(function (v) {
        return v > 0;
      });
    if (!profs.length)
      out.comps = { stat: 'Not Scored', sub: _plural(ctx.sections.length, 'competency', 'competencies') };
    else {
      var lo = Math.min.apply(null, profs);
      var hi = Math.max.apply(null, profs);
      var atProf = profs.filter(function (v) {
        return Math.round(v) >= 3;
      }).length;
      out.comps = {
        stat:
          courseGradeMode(cid) === 'letter'
            ? profs.length + ' of ' + ctx.sections.length + ' Scored'
            : atProf + ' of ' + ctx.sections.length + ' Proficient',
        sub:
          lo === hi
            ? 'All at ' + formatLevel(cid, lo)
            : 'Range: ' + formatLevel(cid, lo) + ' to ' + formatLevel(cid, hi),
      };
    }
    var scope = ctx.term ? ctx.term.label || 'This term' : 'All time';
    var scored = ctx.cells.filter(function (c) {
      return c.cell.kind === 'points' || c.cell.kind === 'level' || c.cell.kind === 'complete';
    });
    var unscored = ctx.cells.filter(function (c) {
      return c.cell.kind === 'none' || c.cell.kind === 'missing';
    }).length;
    var latestA = scored.reduce(function (m, c) {
      return (c.a.date || '') > m ? c.a.date : m;
    }, '');
    out.assess = {
      stat: scored.length + ' Scored',
      sub:
        scope + (latestA ? ' · Latest ' + _shortDay(latestA) : '') + (unscored ? ' · ' + unscored + ' not scored' : ''),
    };
    var lastOb = ctx.obs[0];
    out.evidence = {
      stat: _plural(ctx.obs.length, 'Note', 'Notes'),
      sub: scope + (lastOb ? ' · Latest ' + _daysAgo(_obDay(lastOb)) : ' · None yet'),
    };
    out.breakdown = _breakdownSummary(ctx);
    var goals = getGoals(cid)[studentId] || {};
    var refl = getReflections(cid)[studentId] || {};
    var goalCount = ctx.sections.filter(function (sec) {
      return !!(goals[sec.id] || '').trim();
    }).length;
    var reflCount = ctx.sections.filter(function (sec) {
      return !!(refl[sec.id] && (refl[sec.id].text || refl[sec.id].confidence));
    }).length;
    out.goals = {
      stat: goalCount + ' of ' + ctx.sections.length + ' Set',
      sub: reflCount ? _plural(reflCount, 'self-reflection', 'self-reflections') : 'No self-reflections yet',
    };
    var seen = OBS_DIMS.filter(function (d) {
      return ctx.obs.some(function (o) {
        return (o.dims || []).indexOf(d) >= 0;
      });
    }).length;
    out.profile = {
      stat: seen + ' of ' + OBS_DIMS.length + ' Seen',
      sub: seen < OBS_DIMS.length ? OBS_DIMS.length - seen + ' not seen yet' : 'All seen',
    };
    return out;
  }

  function _tabBarHtml(sums) {
    return (
      '<div class="stu-tabs" role="tablist" aria-label="Student details">' +
      TABS.map(function (t) {
        var on = t.id === _tab;
        var sm = sums[t.id];
        return (
          '<button type="button" role="tab" class="stu-tab' +
          (on ? ' active' : '') +
          '" id="stu-tab-' +
          t.id +
          '" data-action="stuTab" data-tab="' +
          t.id +
          '" aria-selected="' +
          on +
          '" aria-controls="stu-panel" tabindex="' +
          (on ? '0' : '-1') +
          '"><span class="stu-tab-label">' +
          esc(t.label) +
          '</span><span class="stu-tab-stat">' +
          esc(sm.stat) +
          '</span><span class="stu-tab-sub">' +
          esc(sm.sub) +
          '</span></button>'
        );
      }).join('') +
      '</div>'
    );
  }

  /* ── Competencies tab ───────────────────────────────────── */
  function _compRowHtml(ctx, sec) {
    var cid = ctx.cid;
    var tag = sec.tags[0];
    var sp = getSectionProficiency(cid, studentId, sec.id);
    var override = getSectionOverride(cid, studentId, sec.id);
    var entries = _compEntries(cid, sec);
    var bars = entries
      .map(function (e) {
        var lvl = e.level != null ? e.level : Math.round(e.score);
        var a = ctx.assessMap[e.assessmentId];
        return (
          '<span class="stu-bar" style="height:' +
          Math.max(4, Math.round((Math.min(e.score, 4) / 4) * 28)) +
          'px;background:' +
          (PROF_COLORS[lvl] || PROF_COLORS[0]) +
          '" title="' +
          esc(_shortDay(e.date) + ': ' + _entryText(e, a) + (a ? ' on ' + a.title : '')) +
          '"></span>'
        );
      })
      .join('');
    if (!tag) {
      return (
        '<div class="stu-comp"><div class="stu-comp-row stu-comp-row-static"><span class="stu-comp-name"><strong>' +
        esc(sec.name) +
        '</strong></span>' +
        _levelPill(cid, sp) +
        '</div></div>'
      );
    }
    var drawerId = 'ced-' + sec.id;
    var open = _openTags.has(tag.id);
    return (
      '<div class="stu-comp">' +
      '<button type="button" class="dash-tag-row stu-comp-row' +
      (open ? ' open' : '') +
      '" data-action="toggleTag" data-tagid="' +
      esc(tag.id) +
      '" aria-expanded="' +
      open +
      '" aria-controls="' +
      esc(drawerId) +
      '">' +
      '<span class="stu-comp-name"><strong>' +
      esc(sec.name) +
      '</strong>' +
      (tag.label && tag.label !== sec.name ? '<span class="stu-sub">' + esc(tag.label) + '</span>' : '') +
      (override ? '<span class="override-label">Overridden</span>' : '') +
      '</span>' +
      '<span class="stu-comp-level">' +
      _levelPill(cid, sp) +
      '</span>' +
      '<span class="stu-comp-bars" aria-hidden="true">' +
      (bars || '<span class="stu-sub">No scores yet</span>') +
      '</span>' +
      '<span class="stu-comp-class">' +
      _startNowHtml(
        cid,
        entries.map(function (e) {
          return { t: _dayNum(e.date), v: e.score };
        }),
      ) +
      '</span>' +
      '<span class="stu-comp-latest"><span>' +
      esc(_latestLine(cid, sec, ctx.assessMap)) +
      '</span><span class="stu-sub dash-tag-evidence">' +
      esc(CompetencyEvidence.rowCount(cid, studentId, tag.id)) +
      '</span></span>' +
      '<span class="dash-tag-chevron" aria-hidden="true">&#9654;</span>' +
      '</button>' +
      _compWhereHtml(ctx, entries) +
      CompetencyEvidence.drawerHtml(cid, studentId, sec, tag, drawerId) +
      '<div class="stu-comp-override">' +
      '<button type="button" class="override-btn' +
      (override ? ' active' : '') +
      '" data-action="toggleOverridePanel" data-secid="' +
      sec.id +
      '">' +
      (override ? 'Edit Override' : 'Override Proficiency') +
      '</button>' +
      '<div class="override-panel" id="override-panel-' +
      sec.id +
      '" style="display:none"></div>' +
      '</div>' +
      '</div>'
    );
  }

  /* Where a run of scores started and where it is now (startAndNow), as
     the class shows levels; a dash when the run is too short to say. */
  function _startNowHtml(cid, points) {
    var sn = startAndNow(points);
    if (!sn) return '<span class="stu-rt-change"><span class="stu-rt-none">—</span></span>';
    var a = formatLevel(cid, sn.start);
    var b = formatLevel(cid, sn.now);
    var dir = a === b ? 'flat' : sn.now > sn.start ? 'up' : 'down';
    return (
      '<span class="stu-rt-change stu-rt-' +
      dir +
      '" title="' +
      esc('First four weeks ' + a + ', last four weeks ' + b) +
      '"><span class="stu-sn">' +
      esc(a) +
      '</span><svg width="18" height="10" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="' +
      (dir === 'up' ? 'up to' : dir === 'down' ? 'down to' : 'still') +
      '"><path d="M1 5h15M12 1l4 4-4 4"/></svg><span class="stu-sn">' +
      esc(b) +
      '</span></span>'
    );
  }

  /* A competency's scores split by the kind of work they came from, so a
     teacher sees where the skill shows best. Shown in the open row. */
  function _compWhereHtml(ctx, entries) {
    var cid = ctx.cid;
    var byType = {};
    entries.forEach(function (e) {
      var a = ctx.assessMap[e.assessmentId];
      var t = (a && a.evidenceType) || '';
      (byType[t] = byType[t] || []).push(e);
    });
    var rows = Object.keys(byType)
      .map(function (t) {
        return { name: _typeLabel(t), n: byType[t].length, v: averageLevels(byType[t]) };
      })
      .filter(function (r) {
        return r.v != null;
      })
      .sort(function (x, y) {
        return y.v - x.v;
      });
    if (rows.length < 2) return '';
    var html = '<div class="stu-comp-where"><div class="stu-comp-where-title">Where It Shows</div>';
    rows.forEach(function (r) {
      var lvl = Math.max(1, Math.min(4, Math.round(r.v)));
      html +=
        '<div class="stu-comp-where-row"><span><strong>' +
        esc(r.name) +
        '</strong> <span class="stu-comp-where-n">· ' +
        r.n +
        '</span></span><span class="stu-comp-where-track" role="img" aria-label="' +
        esc(r.name + ': ' + formatLevel(cid, r.v) + ' across ' + _plural(r.n, 'score', 'scores')) +
        '"><span style="width:' +
        Math.round((Math.min(4, r.v) / 4) * 100) +
        '%;background:' +
        (PROF_COLORS[lvl] || PROF_COLORS[0]) +
        '"></span></span><strong class="stu-comp-where-v">' +
        esc(formatLevel(cid, r.v)) +
        '</strong></div>';
    });
    return html + '</div>';
  }

  /* The teacher's own words on a piece of work: the comments left on it in
     Assignments (observations linked to it), else the note on its score;
     otherwise a way to add one. */
  function _assessNoteHtml(ctx, a) {
    var linked = typeof getAssignmentObs === 'function' ? getAssignmentObs(ctx.cid, studentId, a.id) : [];
    var text = linked.length ? String(linked[0].text || '').split('\n')[0] : '';
    if (!text) {
      var withNote = ctx.allScores.find(function (s) {
        return s.assessmentId === a.id && s.note;
      });
      text = withNote ? withNote.note : '';
    }
    var href = '#/assignments?course=' + ctx.cid + '&open=' + a.id + '&student=' + studentId;
    if (!text)
      return (
        '<a class="stu-note-add" role="link" tabindex="0" data-href="' +
        href +
        '" title="Open in Assignments">+ Note</a>'
      );
    return (
      '<span class="stu-note">' +
      esc(text) +
      (linked.length > 1 ? ' <span class="stu-sub-inline">+' + (linked.length - 1) + ' more</span>' : '') +
      '</span>'
    );
  }

  function _compsTabHtml(ctx) {
    var cid = ctx.cid;
    var html =
      '<div class="stu-panel-note">Competency levels: ' +
      esc(describeCalcMethod(cid)) +
      '. Bars show ' +
      (ctx.term ? 'this term’s' : 'all') +
      ' scores, oldest to newest. Select a competency to see the evidence behind it.</div>';
    var grouped = getGroupedSections(cid);
    var hasGroups = grouped.groups.some(function (g) {
      return g.sections.length > 0;
    });
    if (hasGroups) {
      grouped.groups.forEach(function (gi) {
        if (!gi.sections.length) return;
        html +=
          '<h3 class="stu-group-head"><span>' +
          esc(gi.group.name) +
          '</span>' +
          _levelPill(cid, getGroupProficiency(cid, studentId, gi.group.id)) +
          '</h3>';
        gi.sections.forEach(function (sec) {
          html += _compRowHtml(ctx, sec);
        });
      });
      if (grouped.ungrouped.length) {
        html += '<h3 class="stu-group-head"><span>Other Competencies</span></h3>';
        grouped.ungrouped.forEach(function (sec) {
          html += _compRowHtml(ctx, sec);
        });
      }
    } else {
      ctx.sections.forEach(function (sec) {
        html += _compRowHtml(ctx, sec);
      });
    }
    if (!ctx.sections.length) html += '<div class="stu-empty">This class has no competencies yet.</div>';
    return html;
  }

  /* ── Groups of assessments (Assessments tab, Grade Breakdown) ── */
  var GROUP_BYS = [
    { id: 'date', label: 'Date' },
    { id: 'category', label: 'Category' },
    { id: 'module', label: 'Module' },
    { id: 'type', label: 'Type' },
    { id: 'rubric', label: 'Rubric' },
  ];
  var TYPE_ORDER = ['written', 'observation', 'audio', 'video', 'photo', 'conversation'];
  var GROUP_KEY = 'gb-student-assess-group';

  function _savedGroupBy() {
    try {
      var g = localStorage.getItem(GROUP_KEY);
      return GROUP_BYS.some(function (b) {
        return b.id === g;
      })
        ? g
        : 'date';
    } catch (e) {
      return 'date';
    }
  }

  function _typeLabel(t) {
    return t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : 'No Type';
  }

  function _rubricIdOf(a) {
    return isPointsScored(a) ? '' : a.rubricId || a.rubric_id || '';
  }

  /* Assessments sorted into groups by category, module, assignment type or
     rubric, in the class's own order, with the ones in no group last. Each
     group is { key, name, assessments, category?, rubric? }; empty groups
     are left out. */
  function _assessGroups(cid, assessments, by) {
    var groups = [];
    var add = function (key, name, extra) {
      var list = assessments.filter(function (a) {
        return _groupKeyOf(cid, a, by) === key;
      });
      if (list.length) groups.push(Object.assign({ key: key, name: name, assessments: list }, extra || {}));
    };
    if (by === 'category') {
      (getCategories(cid) || []).forEach(function (cat) {
        add(cat.id, cat.name, { category: cat });
      });
      add('', 'No Category');
    } else if (by === 'module') {
      (getModules(cid) || []).forEach(function (m) {
        add(m.id, m.name || 'Untitled Module');
      });
      add('', 'No Module');
    } else if (by === 'type') {
      var seen = [];
      assessments.forEach(function (a) {
        var t = a.evidenceType || '';
        if (t && seen.indexOf(t) < 0) seen.push(t);
      });
      seen.sort(function (x, y) {
        var ix = TYPE_ORDER.indexOf(x);
        var iy = TYPE_ORDER.indexOf(y);
        if (ix < 0 && iy < 0) return x.localeCompare(y);
        if (ix < 0) return 1;
        if (iy < 0) return -1;
        return ix - iy;
      });
      seen.forEach(function (t) {
        add(t, _typeLabel(t));
      });
      add('', 'No Type');
    } else if (by === 'rubric') {
      var ids = [];
      assessments.forEach(function (a) {
        var r = _rubricIdOf(a);
        if (r && ids.indexOf(r) < 0) ids.push(r);
      });
      ids.forEach(function (rid) {
        var rubric = getRubricById(cid, rid);
        add(rid, (rubric && rubric.name) || 'Rubric', { rubric: rubric });
      });
      add('', 'No Rubric');
    }
    return groups;
  }

  function _groupKeyOf(cid, a, by) {
    if (by === 'category') return getAssessmentCategoryId(a) || '';
    if (by === 'module') {
      var mid = a.moduleId || '';
      return mid &&
        (getModules(cid) || []).some(function (m) {
          return m.id === mid;
        })
        ? mid
        : '';
    }
    if (by === 'type') return a.evidenceType || '';
    if (by === 'rubric') return _rubricIdOf(a);
    return '';
  }

  /* A group grade as a tinted pill, as the class shows grades. */
  function _gradePill(g) {
    return '<span class="stu-level stu-level-' + (g ? g.level : 0) + '">' + esc(g ? g.text : '\u2014') + '</span>';
  }

  /* One bar per scored assessment, oldest to newest, as the competency rows
     draw them. */
  function _groupBars(cid, assessments) {
    return assessments
      .slice()
      .sort(function (x, y) {
        return (x.date || '').localeCompare(y.date || '');
      })
      .map(function (a) {
        var g = assessmentGroupGrade(cid, studentId, [a]);
        if (!g) return '';
        var share = g.pct != null ? g.pct / 100 : g.prof / 4;
        return (
          '<span class="stu-bar" style="height:' +
          Math.max(4, Math.round(Math.min(1, share) * 28)) +
          'px;background:' +
          (PROF_COLORS[g.level] || PROF_COLORS[0]) +
          '" title="' +
          esc(_shortDay(a.date) + ': ' + a.title + ', ' + g.text) +
          '"></span>'
        );
      })
      .join('');
  }

  function _groupMeta(cid, g) {
    var n = _plural(g.assessments.length, 'assessment', 'assessments');
    var w = g.category ? Number(g.category.weight || 0) : 0;
    return w > 0 ? w + '% of the grade \u00B7 ' + n : n;
  }

  /* ── Assessments tab ────────────────────────────────────── */
  function _assessTabHtml(ctx) {
    var cid = ctx.cid;
    var secByTag = {};
    ctx.sections.forEach(function (sec) {
      sec.tags.forEach(function (t) {
        secByTag[t.id] = sec;
      });
    });
    var isPts = function (a) {
      return isPointsScored(a);
    };
    var unscored = function (c) {
      return c.cell.kind === 'none' || c.cell.kind === 'missing';
    };
    var cells = ctx.cells.slice().sort(function (x, y) {
      return (y.a.date || '').localeCompare(x.a.date || '');
    });
    var counts = {
      all: cells.length,
      prof: cells.filter(function (c) {
        return !isPts(c.a);
      }).length,
      points: cells.filter(function (c) {
        return isPts(c.a);
      }).length,
      unscored: cells.filter(unscored).length,
    };
    var shown = cells.filter(function (c) {
      if (_assessCat && getAssessmentCategoryId(c.a) !== _assessCat) return false;
      if (_assessFilter === 'prof') return !isPts(c.a);
      if (_assessFilter === 'points') return isPts(c.a);
      if (_assessFilter === 'unscored') return unscored(c);
      return true;
    });
    var chip = function (key, label) {
      var on = _assessFilter === key;
      return (
        '<button type="button" class="stu-chip' +
        (on ? ' active' : '') +
        '" data-action="stuAssessFilter" data-filter="' +
        key +
        '" aria-pressed="' +
        on +
        '">' +
        esc(label) +
        ' ' +
        counts[key] +
        '</button>'
      );
    };
    var cats = (getCategories(cid) || []).filter(function (cat) {
      return cells.some(function (c) {
        return getAssessmentCategoryId(c.a) === cat.id;
      });
    });
    var groupSeg =
      '<span class="stu-group-label" id="stu-group-label">Group By</span>' +
      '<div class="seg seg-sm stu-group-seg" role="radiogroup" aria-labelledby="stu-group-label">' +
      GROUP_BYS.map(function (b) {
        var on = _assessGroup === b.id;
        return (
          '<button type="button" class="seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="stuAssessGroup" data-group="' +
          b.id +
          '">' +
          esc(b.label) +
          '</button>'
        );
      }).join('') +
      '</div>';
    var html =
      '<div class="stu-toolbar">' +
      groupSeg +
      chip('all', 'All') +
      chip('prof', 'Proficiency') +
      chip('points', 'Points') +
      (counts.unscored ? chip('unscored', 'Not Scored') : '') +
      (cats.length
        ? '<select class="stu-select" data-action-change="stuAssessCat" aria-label="Category"><option value="">All Categories</option>' +
          cats
            .map(function (cat) {
              return (
                '<option value="' +
                esc(cat.id) +
                '"' +
                (_assessCat === cat.id ? ' selected' : '') +
                '>' +
                esc(cat.name) +
                '</option>'
              );
            })
            .join('') +
          '</select>'
        : '') +
      '<a class="stu-link" role="link" tabindex="0" data-href="#/gradebook?course=' +
      cid +
      '">Open in Gradebook</a>' +
      '</div>';
    if (!shown.length) {
      return (
        html + '<div class="stu-empty">' + (cells.length ? 'No assessments match.' : 'No assessments yet.') + '</div>'
      );
    }
    var rowHtml = function (c) {
      var a = c.a;
      // Each competency by its short title (the tag's label), as the cards show it.
      var toward = [];
      (a.tagIds || []).forEach(function (tid) {
        var sec = secByTag[tid];
        if (!sec) return;
        var tag = getTagById(cid, tid);
        var name = (tag && tag.label) || sec.name;
        if (toward.indexOf(name) < 0) toward.push(name);
      });
      var towardText =
        toward.length && toward.length === ctx.sections.length && toward.length > 2
          ? 'All competencies'
          : toward.join(', ');
      var status = ctx.statuses[studentId + ':' + a.id];
      var cell = c.cell;
      return (
        '<div class="stu-assess-row">' +
        '<span class="stu-assess-date">' +
        esc(_shortDay(a.date)) +
        '</span>' +
        '<span class="stu-assess-title"><a role="link" tabindex="0" data-href="#/assignments?course=' +
        cid +
        '&open=' +
        a.id +
        '&student=' +
        studentId +
        '" title="Open in Assignments">' +
        esc(a.title) +
        '</a>' +
        (status === 'NS'
          ? '<span class="gt-status-tag gt-tag-ns">NS</span>'
          : status === 'EXC'
            ? '<span class="gt-status-tag gt-tag-exc">EXC</span>'
            : status === 'LATE'
              ? '<span class="gt-status-tag gt-tag-late">LATE</span>'
              : '') +
        '</span>' +
        '<span class="stu-assess-cat">' +
        _assessmentCategoryBadge(cid, a) +
        '</span>' +
        '<span class="stu-assess-score"><span class="stu-level stu-level-' +
        (cell.level > 0 ? cell.level : 0) +
        '">' +
        esc(_cellText(cell, a)) +
        '</span></span>' +
        '<span class="stu-assess-class stu-assess-note">' +
        _assessNoteHtml(ctx, a) +
        '</span>' +
        '<span class="stu-assess-toward">' +
        esc(towardText) +
        '</span>' +
        '</div>'
      );
    };
    if (_assessGroup === 'date') {
      var month = '';
      shown.forEach(function (c) {
        var m = (c.a.date || '').slice(0, 7);
        if (m !== month) {
          month = m;
          var md = m ? new Date(m + '-01T00:00:00') : null;
          html +=
            '<h3 class="stu-month">' +
            (md && !isNaN(md) ? md.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }) : 'No Date') +
            '</h3>';
        }
        html += rowHtml(c);
      });
      return html;
    }
    // Grouped: each group's grade and the class's on what is listed.
    var byId = {};
    shown.forEach(function (c) {
      byId[c.a.id] = c;
    });
    _assessGroups(
      cid,
      shown.map(function (c) {
        return c.a;
      }),
      _assessGroup,
    ).forEach(function (g) {
      var fold = _assessGroup + ':' + g.key;
      var open = !_assessClosed[fold];
      var mine = assessmentGroupGrade(cid, studentId, g.assessments);
      html +=
        '<div class="stu-agroup">' +
        '<button type="button" class="stu-agroup-head" data-action="stuAssessFold" data-fold="' +
        esc(fold) +
        '" aria-expanded="' +
        open +
        '">' +
        '<span class="stu-agroup-chev" aria-hidden="true">' +
        (open ? '\u25BE' : '\u25B8') +
        '</span>' +
        '<span class="stu-agroup-name">' +
        esc(g.name) +
        '</span>' +
        '<span class="stu-agroup-meta">' +
        esc(_groupMeta(cid, g)) +
        '</span>' +
        '<span class="stu-agroup-grades">' +
        _startNowHtml(cid, _scoredPoints(cid, g.assessments)) +
        _gradePill(mine) +
        '</span>' +
        '</button>';
      if (open)
        g.assessments.forEach(function (a) {
          html += rowHtml(byId[a.id]);
        });
      html += '</div>';
    });
    return html;
  }

  /* ── Grade Breakdown tab ────────────────────────────────── */
  function _breakdownSummary(ctx) {
    var cid = ctx.cid;
    var cats = _assessGroups(cid, ctx.assessments, 'category').filter(function (g) {
      return g.category;
    });
    var mods = _assessGroups(cid, ctx.assessments, 'module').filter(function (g) {
      return g.key;
    });
    var parts = [];
    if (cats.length) parts.push(_plural(cats.length, 'Category', 'Categories'));
    if (mods.length) parts.push(_plural(mods.length, 'Module', 'Modules'));
    var lowest = null;
    cats.forEach(function (g) {
      var gr = assessmentGroupGrade(cid, studentId, g.assessments);
      if (!gr) return;
      var v = courseGradeMode(cid) === 'letter' ? gr.pct : gr.prof;
      if (v != null && (!lowest || v < lowest.v)) lowest = { v: v, name: g.name };
    });
    return {
      stat: parts.length ? parts.join(' \u00B7 ') : 'By Type and Rubric',
      sub: lowest && cats.length > 1 ? 'Lowest: ' + lowest.name : cats.length ? 'One category' : 'No categories yet',
    };
  }

  function _bdHeadRow(cells) {
    return (
      '<div class="stu-bd-row stu-bd-head" aria-hidden="true">' +
      cells
        .map(function (c) {
          return '<span>' + esc(c) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  /* One group as a table row: name and count, grade, bars, class. */
  function _bdGroupCells(ctx, g, mine) {
    var scored = g.assessments.filter(function (a) {
      return assessmentGroupGrade(ctx.cid, studentId, [a]);
    }).length;
    var count =
      _plural(g.assessments.length, 'assessment', 'assessments') +
      (scored === g.assessments.length ? '' : ', ' + scored + ' scored');
    return {
      name:
        '<span class="stu-bd-name"><strong>' +
        esc(g.name) +
        '</strong><span class="stu-sub">' +
        esc(count) +
        '</span></span>',
      grade: '<span>' + _gradePill(mine) + '</span>',
      bars:
        '<span class="stu-comp-bars" aria-hidden="true">' +
        (_groupBars(ctx.cid, g.assessments) || '<span class="stu-sub">No scores yet</span>') +
        '</span>',
      change: _startNowHtml(ctx.cid, _scoredPoints(ctx.cid, g.assessments)),
    };
  }

  function _bdAssessList(ctx, assessments) {
    return (
      '<div class="stu-bd-items">' +
      assessments
        .slice()
        .sort(function (x, y) {
          return (y.date || '').localeCompare(x.date || '');
        })
        .map(function (a) {
          return (
            '<div class="stu-bd-item"><span class="stu-assess-date">' +
            esc(_shortDay(a.date)) +
            '</span><span class="stu-assess-title"><a role="link" tabindex="0" data-href="#/assignments?course=' +
            ctx.cid +
            '&open=' +
            a.id +
            '&student=' +
            studentId +
            '" title="Open in Assignments">' +
            esc(a.title) +
            '</a></span>' +
            _gradePill(assessmentGroupGrade(ctx.cid, studentId, [a])) +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── Grade Breakdown: assignment type views ─────────────── */
  var TYPE_VIEWS = [
    { id: 'strengths', label: 'Strengths' },
    { id: 'growth', label: 'Growth' },
    { id: 'month', label: 'By Month' },
    { id: 'timeline', label: 'Timeline' },
  ];
  var TYPE_VIEW_KEY = 'gb-student-type-view';
  var TYPE_COLORS = ['#1565c0', '#c2410c', '#6d28d9', '#0f766e', '#64748b', '#a21caf', '#4d7c0f'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function _savedTypeView() {
    try {
      var v = localStorage.getItem(TYPE_VIEW_KEY);
      return TYPE_VIEWS.some(function (t) {
        return t.id === v;
      })
        ? v
        : 'strengths';
    } catch (e) {
      return 'strengths';
    }
  }

  function _dayNum(date) {
    var d = new Date(String(date || '').slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : Math.round(d.getTime() / 864e5);
  }

  /* A group's scored assessments, oldest first, each with its grade and its
     place on the 0–4 scale. */
  function _scoredPoints(cid, assessments) {
    return assessments
      .slice()
      .sort(function (x, y) {
        return (x.date || '').localeCompare(y.date || '');
      })
      .map(function (a) {
        var g = assessmentGroupGrade(cid, studentId, [a]);
        var v = groupGradeValue(cid, g);
        var t = _dayNum(a.date);
        return v == null || t == null ? null : { a: a, g: g, v: v, t: t };
      })
      .filter(Boolean);
  }

  /* One scale for every chart in the section: dates across, 0–4 up, with
     the axis labelled as the class shows grades. */
  function _chartScale(cid, pointLists) {
    var all = [].concat.apply([], pointLists);
    var t0 = Math.min.apply(
      null,
      all.map(function (p) {
        return p.t;
      }),
    );
    var t1 = Math.max.apply(
      null,
      all.map(function (p) {
        return p.t;
      }),
    );
    if (t1 - t0 < 14) {
      t0 -= 7;
      t1 += 7;
    }
    var vmin = Math.min.apply(
      null,
      all.map(function (p) {
        return p.v;
      }),
    );
    var lo = Math.max(0, Math.min(2, Math.floor((vmin - 0.25) * 2) / 2));
    var x = function (t) {
      return 3 + ((t - t0) / (t1 - t0)) * 94;
    };
    var y = function (v) {
      return (1 - (Math.min(4, v) - lo) / (4 - lo)) * 100;
    };
    var ticks = [];
    for (var k = Math.ceil(lo); k <= 4; k++) ticks.push({ y: y(k), text: formatLevel(cid, k) });
    var months = [];
    var d = new Date(t0 * 864e5);
    var m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    // The first month's name, unless the next month starts right after it.
    if (x(m.getTime() / 864e5) - x(t0) > 8) months.push({ x: x(t0), text: MONTHS[d.getUTCMonth()] });
    while (m.getTime() / 864e5 <= t1) {
      months.push({ x: x(m.getTime() / 864e5), text: MONTHS[m.getUTCMonth()] });
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    return { x: x, y: y, ticks: ticks, months: months };
  }

  /* A line chart: each series a line through its points, the latest point
     larger. series: [{ points, color, dim, wide }]. */
  function _lineChartHtml(scale, series, height, label) {
    var html = '<div class="stu-chart" style="height:' + height + 'px" role="img" aria-label="' + esc(label) + '">';
    scale.ticks.forEach(function (t) {
      html +=
        '<span class="stu-chart-grid" style="top:' +
        t.y.toFixed(2) +
        '%"></span><span class="stu-chart-tick" style="top:' +
        t.y.toFixed(2) +
        '%" aria-hidden="true">' +
        esc(t.text) +
        '</span>';
    });
    series.forEach(function (s) {
      if (s.points.length > 1)
        html +=
          '<svg class="stu-chart-line' +
          (s.dim ? ' dim' : '') +
          '" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="' +
          s.points
            .map(function (p) {
              return scale.x(p.t).toFixed(2) + ',' + scale.y(p.v).toFixed(2);
            })
            .join(' ') +
          '" fill="none" stroke="' +
          s.color +
          '" stroke-width="' +
          (s.wide ? 2.6 : 1.6) +
          '" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
    });
    series.forEach(function (s) {
      s.points.forEach(function (p, i) {
        html +=
          '<span class="stu-chart-dot' +
          (i === s.points.length - 1 ? ' last' : '') +
          (s.dim ? ' dim' : '') +
          '" style="left:' +
          scale.x(p.t).toFixed(2) +
          '%;top:' +
          scale.y(p.v).toFixed(2) +
          '%;background:' +
          (s.dotColor ? PROF_COLORS[p.g.level] || PROF_COLORS[0] : s.color) +
          '" title="' +
          esc(_shortDay(p.a.date) + ': ' + p.a.title + ', ' + p.g.text) +
          '"></span>';
      });
    });
    html += '</div><div class="stu-chart-x" aria-hidden="true">';
    scale.months.forEach(function (m) {
      html += '<span style="left:' + m.x.toFixed(2) + '%">' + esc(m.text) + '</span>';
    });
    return html + '</div>';
  }

  function _firstLatestHtml(points) {
    if (points.length < 2) return '<span class="stu-rt-change"><span class="stu-rt-none">\u2014</span></span>';
    var first = points[0];
    var last = points[points.length - 1];
    var dir = last.v > first.v ? 'up' : last.v < first.v ? 'down' : 'flat';
    return (
      '<span class="stu-rt-change stu-rt-' +
      dir +
      '">' +
      _gradePill(first.g) +
      '<svg width="18" height="10" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="' +
      (dir === 'up' ? 'up to' : dir === 'down' ? 'down to' : 'still') +
      '"><path d="M1 5h15M12 1l4 4-4 4"/></svg>' +
      _gradePill(last.g) +
      '</span>'
    );
  }

  /* Strengths: each type against all of the student's work. */
  function _typeStrengthsHtml(ctx, types) {
    var cid = ctx.cid;
    var own = assessmentGroupGrade(cid, studentId, ctx.assessments);
    var rows = types
      .map(function (g) {
        var mine = assessmentGroupGrade(cid, studentId, g.assessments);
        return { g: g, mine: mine, diff: groupGradeDiff(cid, mine, own) };
      })
      .sort(function (a, b) {
        return (b.diff ? b.diff.value : -Infinity) - (a.diff ? a.diff.value : -Infinity);
      });
    var span = rows.reduce(
      function (m, r) {
        return r.diff ? Math.max(m, Math.abs(r.diff.value)) : m;
      },
      courseGradeMode(cid) === 'letter' ? 10 : 0.5,
    );
    var html =
      '<div class="stu-ts"><div class="stu-ts-row stu-ts-head"><span></span><span class="stu-ts-axis" aria-hidden="true"><span class="stu-ts-weaker">Weaker</span><span class="stu-ts-own">All Work ' +
      _gradePill(own) +
      '</span><span class="stu-ts-stronger">Stronger</span></span><span></span></div>';
    rows.forEach(function (r) {
      var w = r.diff ? (Math.abs(r.diff.value) / span) * 50 : 0;
      var below = r.diff && r.diff.dir < 0;
      html +=
        '<div class="stu-ts-row"><span class="stu-bd-name"><strong>' +
        esc(r.g.name) +
        '</strong><span class="stu-sub">' +
        esc(_plural(r.g.assessments.length, 'assessment', 'assessments')) +
        '</span></span><span class="stu-ts-track" role="img" aria-label="' +
        esc(
          r.g.name +
            ': ' +
            (r.mine ? r.mine.text : 'not scored') +
            (r.diff ? ', ' + r.diff.text + ' against all work' : ''),
        ) +
        '"><span class="stu-ts-bar ' +
        (below ? 'weaker' : 'stronger') +
        '" style="left:' +
        (below ? 50 - w : 50).toFixed(2) +
        '%;width:' +
        Math.max(w, 0.6).toFixed(2) +
        '%"></span>' +
        (r.diff
          ? '<span class="stu-ts-num ' +
            (below ? 'weaker' : 'stronger') +
            '" style="left:' +
            (below ? 50 - w : 50 + w).toFixed(2) +
            '%">' +
            esc(r.diff.text) +
            '</span>'
          : '') +
        '</span><span class="stu-ts-grade">' +
        _gradePill(r.mine) +
        '</span></div>';
    });
    return html + '</div>';
  }

  /* Growth: a small chart per type, all on one timeline. */
  function _typeGrowthHtml(ctx, types) {
    var cid = ctx.cid;
    var lists = types.map(function (g) {
      return _scoredPoints(cid, g.assessments);
    });
    var any = lists.some(function (l) {
      return l.length;
    });
    if (!any) return '<div class="stu-empty">No scores yet.</div>';
    var scale = _chartScale(
      cid,
      lists.filter(function (l) {
        return l.length;
      }),
    );
    var html = '<div class="stu-tg">';
    types.forEach(function (g, i) {
      var pts = lists[i];
      html +=
        '<div class="stu-tg-card"><div class="stu-tg-head"><span class="stu-bd-name"><strong>' +
        esc(g.name) +
        '</strong><span class="stu-sub">' +
        esc(_plural(g.assessments.length, 'assessment', 'assessments')) +
        '</span></span>' +
        _firstLatestHtml(pts) +
        '</div>' +
        (pts.length
          ? _lineChartHtml(scale, [{ points: pts, color: '#3a3a3c', dotColor: true }], 110, g.name + ' over time')
          : '<div class="stu-empty">No scores yet.</div>') +
        '</div>';
    });
    return html + '</div>';
  }

  /* By Month: a row per type, a column per month, as the rubric table. */
  function _typeMonthHtml(ctx, types) {
    var cid = ctx.cid;
    var keys = [];
    ctx.assessments.forEach(function (a) {
      var m = (a.date || '').slice(0, 7);
      if (m && keys.indexOf(m) < 0) keys.push(m);
    });
    keys.sort();
    if (!keys.length) return '<div class="stu-empty">No dated assessments yet.</div>';
    var cols = 'grid-template-columns:minmax(140px,1.2fr) repeat(' + keys.length + ',minmax(60px,1fr)) 190px 110px';
    var html =
      '<div class="stu-rt-scroll"><div class="stu-rt" role="table" aria-label="Assignment types by month"><div class="stu-rt-row stu-rt-head" role="row" style="' +
      cols +
      '"><span role="columnheader">Type</span>';
    keys.forEach(function (k) {
      html += '<span role="columnheader" class="stu-rt-center">' + esc(MONTHS[Number(k.slice(5)) - 1]) + '</span>';
    });
    html +=
      '<span role="columnheader" class="stu-rt-center">First to Latest</span><span role="columnheader" class="stu-rt-right">All</span></div>';
    types.forEach(function (g) {
      html +=
        '<div class="stu-rt-row" role="row" style="' +
        cols +
        '"><span role="rowheader" class="stu-bd-name"><strong>' +
        esc(g.name) +
        '</strong><span class="stu-sub">' +
        esc(_plural(g.assessments.length, 'assessment', 'assessments')) +
        '</span></span>';
      keys.forEach(function (k) {
        var inMonth = g.assessments.filter(function (a) {
          return (a.date || '').slice(0, 7) === k;
        });
        var mg = inMonth.length ? assessmentGroupGrade(cid, studentId, inMonth) : null;
        html +=
          '<span role="cell" class="stu-rt-center">' +
          (mg ? _gradePill(mg) : '<span class="stu-rt-none">\u2014</span>') +
          '</span>';
      });
      html +=
        '<span role="cell">' +
        _firstLatestHtml(_scoredPoints(cid, g.assessments)) +
        '</span><span role="cell" class="stu-rt-right">' +
        _gradePill(assessmentGroupGrade(cid, studentId, g.assessments)) +
        '</span></div>';
    });
    return html + '</div></div>';
  }

  /* Timeline: every assessment on one chart, a line per type; a type's
     chip brings it forward. */
  function _typeTimelineHtml(ctx, types) {
    var cid = ctx.cid;
    var lists = types.map(function (g) {
      return _scoredPoints(cid, g.assessments);
    });
    var withPts = lists.filter(function (l) {
      return l.length;
    });
    if (!withPts.length) return '<div class="stu-empty">No scores yet.</div>';
    var focus = types.some(function (g) {
      return g.key === _typeFocus;
    })
      ? _typeFocus
      : '';
    var chip = function (key, label, color) {
      var on = focus === key;
      return (
        '<button type="button" class="stu-chip' +
        (on ? ' active' : '') +
        '" data-action="stuTypeFocus" data-key="' +
        esc(key) +
        '" aria-pressed="' +
        on +
        '">' +
        (color ? '<span class="stu-chip-dot" style="background:' + color + '" aria-hidden="true"></span>' : '') +
        esc(label) +
        '</button>'
      );
    };
    var html = '<div class="stu-rt-picker" role="group" aria-label="Show">' + chip('', 'All Types', '');
    types.forEach(function (g, i) {
      html += chip(g.key, g.name, TYPE_COLORS[i % TYPE_COLORS.length]);
    });
    html += '</div>';
    var series = types.map(function (g, i) {
      return {
        points: lists[i],
        color: TYPE_COLORS[i % TYPE_COLORS.length],
        dim: !!focus && g.key !== focus,
        wide: focus === g.key,
      };
    });
    // The type brought forward draws last, on top.
    series.sort(function (a, b) {
      return (a.wide ? 1 : 0) - (b.wide ? 1 : 0);
    });
    return html + _lineChartHtml(_chartScale(cid, withPts), series, 320, 'Every assessment over time, a line per type');
  }

  function _breakdownTabHtml(ctx) {
    var cid = ctx.cid;
    var mode = courseGradeMode(cid);
    var showShares = mode !== 'proficiency';
    var html =
      '<div class="stu-panel-note">Each group’s grade is worked out the way the course grade is: ' +
      (mode === 'proficiency' ? 'the average of its scored assessments.' : 'points earned out of points possible.') +
      ' Bars show each assessment, oldest to newest.</div>';

    // Categories
    var cats = _assessGroups(cid, ctx.assessments, 'category');
    html += '<section class="stu-bd-section" aria-labelledby="stu-bd-cats"><div class="stu-bd-title">';
    html += '<h3 id="stu-bd-cats">Categories</h3>';
    if (cats.length)
      html +=
        '<span class="stu-sub">' +
        (showShares ? 'The course grade is these, weighted' : 'Weighted in the course grade') +
        '</span>';
    html += '</div>';
    if (!cats.length) {
      html += '<div class="stu-empty">No assessments in a category yet.</div>';
    } else {
      var shares = showShares ? categoryCourseShares(cid, studentId) : {};
      html +=
        '<div class="stu-bd-table' +
        (showShares ? ' stu-bd-cats-shares' : ' stu-bd-cats') +
        '">' +
        _bdHeadRow(
          ['Category', 'Weight', 'Grade', 'Assessments', 'Start to Now'].concat(showShares ? ['Adds to Course %'] : []),
        );
      cats.forEach(function (g) {
        var mine = assessmentGroupGrade(cid, studentId, g.assessments);
        var c = _bdGroupCells(ctx, g, mine);
        var open = !!_bdOpen[g.key || '-'];
        html +=
          '<div class="stu-bd-group"><button type="button" class="stu-bd-row" data-action="stuBdToggle" data-key="' +
          esc(g.key || '-') +
          '" aria-expanded="' +
          open +
          '">' +
          c.name +
          '<span class="stu-bd-weight">' +
          (g.category ? esc(Number(g.category.weight || 0) + '%') : '\u2014') +
          '</span>' +
          c.grade +
          c.bars +
          c.change +
          (showShares
            ? '<span class="stu-bd-share">' +
              (g.category && shares[g.key] ? esc(shares[g.key].text) : '\u2014') +
              '</span>'
            : '') +
          '</button>' +
          (open ? _bdAssessList(ctx, g.assessments) : '') +
          '</div>';
      });
      if (showShares) {
        var course = getCourseLetterData(cid, studentId);
        if (course && course.R != null)
          html +=
            '<div class="stu-bd-row stu-bd-total"><span class="stu-bd-name"><strong>Course</strong></span><span class="stu-bd-weight">100%</span><span>' +
            _gradePill(studentGradeSummary(cid, studentId)) +
            '</span><span></span><span></span><span class="stu-bd-share">' +
            esc(formatCoursePercent(cid, course.R).replace('%', '')) +
            '</span></div>';
      }
      html += '</div>';
    }
    html += '</section>';

    // Modules
    var mods = _assessGroups(cid, ctx.assessments, 'module');
    var hasModules = mods.some(function (g) {
      return g.key;
    });
    html +=
      '<section class="stu-bd-section" aria-labelledby="stu-bd-mods"><div class="stu-bd-title"><h3 id="stu-bd-mods">Modules</h3><span class="stu-sub">The folders on the Assignments page. They don’t change the course grade.</span></div>';
    if (!hasModules) {
      html += '<div class="stu-empty">No modules yet. Group assessments into modules on the Assignments page.</div>';
    } else {
      html +=
        '<div class="stu-bd-table stu-bd-mods">' +
        _bdHeadRow(['Module', 'Grade', 'Assessments', 'Start to Now', 'Latest']);
      mods.forEach(function (g) {
        var mine = assessmentGroupGrade(cid, studentId, g.assessments);
        var c = _bdGroupCells(ctx, g, mine);
        var latest = g.assessments.reduce(function (m, a) {
          return (a.date || '') > m ? a.date : m;
        }, '');
        html +=
          '<div class="stu-bd-row' +
          (g.key ? '' : ' stu-bd-none') +
          '">' +
          c.name +
          c.grade +
          c.bars +
          c.change +
          '<span class="stu-bd-latest">' +
          esc(_shortDay(latest)) +
          '</span></div>';
      });
      html += '</div>';
    }
    html += '</section>';

    // Assignment types: four ways to look at this student's work by type.
    var types = _assessGroups(cid, ctx.assessments, 'type');
    html +=
      '<section class="stu-bd-section" aria-labelledby="stu-bd-types"><div class="stu-bd-title"><h3 id="stu-bd-types">Assignment Types</h3>';
    if (types.length) {
      html += '<div class="seg seg-sm" role="radiogroup" aria-label="Assignment types view">';
      TYPE_VIEWS.forEach(function (v) {
        var on = _typeView === v.id;
        html +=
          '<button type="button" class="seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="stuTypeView" data-view="' +
          v.id +
          '">' +
          esc(v.label) +
          '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    if (!types.length) html += '<div class="stu-empty">No assessments yet.</div>';
    else if (_typeView === 'growth') html += _typeGrowthHtml(ctx, types);
    else if (_typeView === 'month') html += _typeMonthHtml(ctx, types);
    else if (_typeView === 'timeline') html += _typeTimelineHtml(ctx, types);
    else html += _typeStrengthsHtml(ctx, types);
    html += '</section>';

    // Rubrics used on more than one assessment: one picked at a time, its
    // criteria down the side and its assessments across, oldest first.
    var rubrics = _assessGroups(cid, ctx.assessments, 'rubric').filter(function (g) {
      return g.key && g.rubric && g.assessments.length > 1;
    });
    html +=
      '<section class="stu-bd-section" aria-labelledby="stu-bd-rubrics"><div class="stu-bd-title"><h3 id="stu-bd-rubrics">Shared Rubrics</h3></div>';
    if (!rubrics.length) html += '<div class="stu-empty">No rubric is used on more than one assessment yet.</div>';
    else {
      var pick =
        rubrics.find(function (g) {
          return g.key === _bdRubric;
        }) || rubrics[0];
      html += '<div class="stu-rt-picker" role="group" aria-label="Rubric">';
      rubrics.forEach(function (g) {
        var on = g === pick;
        html +=
          '<button type="button" class="stu-chip' +
          (on ? ' active' : '') +
          '" data-action="stuBdRubric" data-key="' +
          esc(g.key) +
          '" aria-pressed="' +
          on +
          '">' +
          esc(g.name) +
          ' \u00B7 ' +
          g.assessments.length +
          '</button>';
      });
      html += '</div>';
      html += _rubricTableHtml(ctx, pick);
    }
    html += '</section>';
    return html;
  }

  /* A shared rubric as a table: a criterion per row, an assessment per
     column (oldest first), each cell the level as scored, then the first
     and latest scores and the average beside the class's. */
  function _rubricTableHtml(ctx, g) {
    var cid = ctx.cid;
    var list = g.assessments.slice().sort(function (x, y) {
      return (x.date || '').localeCompare(y.date || '');
    });
    var cols = 'grid-template-columns:minmax(150px,1.2fr) repeat(' + list.length + ',minmax(64px,1fr)) 110px 110px';
    var mean = function (vs) {
      return vs.length
        ? vs.reduce(function (s, v) {
            return s + v;
          }, 0) / vs.length
        : null;
    };
    var chip = function (v) {
      if (v == null) return '<span class="stu-rt-none">\u2014</span>';
      var near = nearestScoreLevel(v);
      return '<span class="stu-rt-score stu-level-' + near.level + '">' + esc(near.text) + '</span>';
    };
    var html =
      '<div class="stu-rt-scroll"><div class="stu-rt" role="table" aria-label="' +
      esc(g.name) +
      '"><div class="stu-rt-row stu-rt-head" role="row" style="' +
      cols +
      '"><span role="columnheader">Criterion</span>';
    list.forEach(function (a) {
      html +=
        '<span role="columnheader" class="stu-rt-assess" title="' +
        esc(a.title) +
        '"><span class="stu-rt-assess-title">' +
        esc(a.title) +
        '</span><span class="stu-rt-assess-date">' +
        esc(_shortDay(a.date)) +
        '</span></span>';
    });
    html += '<span role="columnheader" class="stu-rt-center">First to Latest</span>';
    html += '<span role="columnheader" class="stu-rt-right">Average</span></div>';
    (g.rubric.criteria || []).filter(Boolean).forEach(function (crit) {
      var vals = list.map(function (a) {
        return rubricCriterionLevel(cid, studentId, a, crit);
      });
      var scored = vals.filter(function (v) {
        return v != null;
      });
      var first = scored[0];
      var latest = scored[scored.length - 1];
      var dir = scored.length > 1 ? (latest > first ? 'up' : latest < first ? 'down' : 'flat') : '';
      html += '<div class="stu-rt-row" role="row" style="' + cols + '">';
      html += '<span role="rowheader" class="stu-rt-crit">' + esc(crit.name || 'Criterion') + '</span>';
      vals.forEach(function (v, i) {
        html +=
          '<span role="cell" class="stu-rt-center" title="' +
          esc(
            list[i].title + ', ' + _shortDay(list[i].date) + (v == null ? ': not scored' : ': ' + formatLevel(cid, v)),
          ) +
          '">' +
          chip(v) +
          '</span>';
      });
      html +=
        '<span role="cell" class="stu-rt-change stu-rt-' +
        (dir || 'flat') +
        '">' +
        (dir
          ? chip(first) +
            '<svg width="18" height="10" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="' +
            (dir === 'up' ? 'up to' : dir === 'down' ? 'down to' : 'still') +
            '"><path d="M1 5h15M12 1l4 4-4 4"/></svg>' +
            chip(latest)
          : '<span class="stu-rt-none">\u2014</span>') +
        '</span>';
      html +=
        '<span role="cell" class="stu-rt-avg"><strong>' +
        esc(formatLevel(cid, mean(scored))) +
        '</strong></span></div>';
    });
    html += '</div></div>';
    return html;
  }

  /* ── Goals and Reflections tab ──────────────────────────── */
  function _goalsTabHtml(ctx) {
    var cid = ctx.cid;
    var first = displayNameFirst(ctx.student);
    var goals = getGoals(cid)[studentId] || {};
    var reflections = getReflections(cid)[studentId] || {};
    var html = '<div class="stu-goal-grid">';
    ctx.sections.forEach(function (sec) {
      var tag = sec.tags[0];
      var goalText = goals[sec.id] || '';
      var refl = reflections[sec.id] || {};
      var confLabel = refl.confidence ? CONFIDENCE_LABELS[refl.confidence] || '' : '';
      var confColor = refl.confidence ? CONFIDENCE_COLORS[refl.confidence] || '#bbb' : '';
      var hasRefl = !!(refl.text || refl.confidence);
      html +=
        '<div class="stu-goal-card">' +
        '<div class="stu-goal-head"><span class="stu-comp-name"><strong>' +
        esc(sec.name) +
        '</strong>' +
        (tag && tag.label && tag.label !== sec.name ? '<span class="stu-sub">' + esc(tag.label) + '</span>' : '') +
        '</span>' +
        _levelPill(cid, getSectionProficiency(cid, studentId, sec.id)) +
        '</div>' +
        '<div class="stu-sub">Latest: ' +
        esc(_latestLine(cid, sec, ctx.assessMap)) +
        '</div>' +
        // Goal (ids are what editGoal / saveGoalField use)
        '<div class="section-goal stu-goal-part" id="goal-' +
        sec.id +
        '">' +
        '<div class="stu-goal-label"><span>Goal</span><button type="button" class="stu-chip" data-action="editGoal" data-secid="' +
        sec.id +
        '">' +
        (goalText ? 'Edit' : '+ Goal') +
        '</button></div>' +
        '<div class="section-goal-text" id="goal-text-' +
        sec.id +
        '">' +
        (goalText ? esc(goalText) : '<span class="stu-muted">No goal set.</span>') +
        '</div>' +
        '<div class="inline-edit-area" id="goal-edit-' +
        sec.id +
        '" style="display:none">' +
        '<textarea id="goal-input-' +
        sec.id +
        '" aria-label="Goal for ' +
        esc(sec.name) +
        '" placeholder="What will ' +
        esc(first) +
        ' work on next?">' +
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
        '</div>' +
        // Self-reflection
        '<div class="section-reflection stu-goal-part" id="refl-' +
        sec.id +
        '">' +
        '<div class="stu-goal-label"><span>In ' +
        esc(first) +
        '’s Words' +
        (confLabel
          ? ' <span class="confidence-badge" style="background:' + confColor + '">' + confLabel + '</span>'
          : '') +
        '</span><button type="button" class="stu-chip" data-action="editReflection" data-secid="' +
        sec.id +
        '">' +
        (hasRefl ? 'Edit' : '+ Self-Reflection') +
        '</button></div>' +
        '<div class="section-reflection-text" id="refl-text-' +
        sec.id +
        '">' +
        (refl.text ? esc(refl.text) : '<span class="stu-muted">No self-reflection yet.</span>') +
        (refl.date ? '<div class="stu-sub">' + formatDate(refl.date) + '</div>' : '') +
        '</div>' +
        '<div class="inline-edit-area" id="refl-edit-' +
        sec.id +
        '" style="display:none">' +
        '<select id="refl-conf-' +
        sec.id +
        '" aria-label="Confidence level">' +
        '<option value="">Confidence level…</option>' +
        [1, 2, 3, 4]
          .map(function (n) {
            return (
              '<option value="' +
              n +
              '"' +
              (refl.confidence === n ? ' selected' : '') +
              '>' +
              CONFIDENCE_LABELS[n] +
              '</option>'
            );
          })
          .join('') +
        '</select>' +
        '<textarea id="refl-input-' +
        sec.id +
        '" aria-label="Self-reflection for ' +
        esc(sec.name) +
        '" placeholder="' +
        esc(first) +
        '’s own words about their learning…">' +
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
        '</div>' +
        '</div>';
    });
    html += '</div>';
    if (!ctx.sections.length) html += '<div class="stu-empty">This class has no competencies yet.</div>';
    return html;
  }

  /* ── Learner Profile tab ────────────────────────────────── */
  function _profileTabHtml(ctx) {
    var cid = ctx.cid;
    var first = displayNameFirst(ctx.student);
    var groups = [
      { name: 'Learning Dispositions', sub: 'How ' + first + ' learns', dims: LEARNING_DIMS },
      { name: 'Relational and Identity', sub: 'Who ' + first + ' is with others', dims: RELATIONAL_DIMS },
    ];
    var html =
      '<div class="stu-panel-note">From the tags on ' +
      esc(first) +
      '’s ' +
      _plural(ctx.obs.length, 'observation', 'observations') +
      (ctx.term ? ' this term' : '') +
      '. Each dot is one observation.</div><div class="stu-profile-grid">';
    // Each disposition on one timeline, a dot per observation (it opens the
    // observation); the ones not seen yet gather in one row.
    var times = ctx.obs
      .map(function (o) {
        return _dayNum(_obDay(o));
      })
      .filter(function (t) {
        return t != null;
      });
    var t0 = times.length ? Math.min.apply(null, times) : 0;
    var t1 = times.length ? Math.max.apply(null, times) : 0;
    if (t1 - t0 < 28) {
      t0 -= 14;
      t1 += 14;
    }
    var xAt = function (t) {
      return 3 + ((t - t0) / (t1 - t0)) * 94;
    };
    var axis = '<div class="stu-lane-axis" aria-hidden="true"><span></span><span class="stu-lane-months">';
    var md = new Date(t0 * 864e5);
    var m = new Date(Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 1));
    while (m.getTime() / 864e5 <= t1) {
      axis +=
        '<span style="left:' + xAt(m.getTime() / 864e5).toFixed(2) + '%">' + esc(MONTHS[m.getUTCMonth()]) + '</span>';
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    axis += '</span></div>';
    groups.forEach(function (g) {
      var seen = [];
      var unseen = [];
      g.dims.forEach(function (d) {
        var tagged = ctx.obs.filter(function (o) {
          return (o.dims || []).indexOf(d) >= 0;
        });
        (tagged.length ? seen : unseen).push({ d: d, obs: tagged });
      });
      html +=
        '<div class="stu-profile-group"><h3>' + esc(g.name) + '</h3><div class="stu-sub">' + esc(g.sub) + '</div>';
      if (seen.length) html += axis;
      seen.forEach(function (r) {
        html +=
          '<div class="stu-lane"><span class="stu-lane-name"><strong>' +
          esc(OBS_LABELS[r.d]) +
          '</strong><span class="stu-sub">' +
          esc(_plural(r.obs.length, 'time', 'times')) +
          '</span></span><span class="stu-lane-track" role="group" aria-label="' +
          esc(OBS_LABELS[r.d] + ', ' + _plural(r.obs.length, 'observation', 'observations')) +
          '">';
        r.obs.forEach(function (o) {
          var t = _dayNum(_obDay(o));
          if (t == null) return;
          html +=
            '<button type="button" class="stu-lane-dot" data-ced="jump" data-obid="' +
            esc(o.id) +
            '" style="left:' +
            xAt(t).toFixed(2) +
            '%" title="' +
            esc(_shortDay(_obDay(o)) + ': ' + String(o.text || '').split('\n')[0]) +
            '" aria-label="' +
            esc(_shortDay(_obDay(o)) + ': ' + String(o.text || '').split('\n')[0]) +
            '"></button>';
        });
        html += '</span></div>';
      });
      if (unseen.length) {
        html += '<div class="stu-unseen"><span class="stu-unseen-label">Not Seen Yet</span>';
        unseen.forEach(function (r) {
          html += '<span class="stu-unseen-chip">' + esc(OBS_LABELS[r.d]) + '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // Core competencies tagged on the student's scored assessments.
    var tally = {};
    CORE_COMPETENCIES.forEach(function (cc) {
      tally[cc.id] = 0;
    });
    ctx.assessments.forEach(function (a) {
      if (!(a.coreCompetencyIds && a.coreCompetencyIds.length)) return;
      var hasScore = ctx.allScores.some(function (s) {
        return s.assessmentId === a.id && s.score > 0;
      });
      if (!hasScore) return;
      a.coreCompetencyIds.forEach(function (id) {
        if (tally[id] !== undefined) tally[id]++;
      });
    });
    var max = Math.max(1, Math.max.apply(null, Object.values(tally)));
    var byGroup = {};
    CORE_COMPETENCIES.forEach(function (cc) {
      (byGroup[cc.group] = byGroup[cc.group] || []).push(cc);
    });
    html +=
      '<div class="stu-core-head"><h3>Core Competencies</h3><span class="stu-sub">How often each was tagged on ' +
      esc(first) +
      '’s scored assessments' +
      (ctx.term ? ' this term' : '') +
      '.</span></div><div class="stu-core-grid">';
    Object.keys(byGroup).forEach(function (group) {
      var ccs = byGroup[group];
      html +=
        '<div class="stu-core-group" style="--cc:' +
        ccs[0].color +
        '"><div class="stu-core-name" style="color:' +
        tintText(ccs[0].color) +
        '">' +
        esc(group) +
        '</div>';
      ccs.forEach(function (cc) {
        var n = tally[cc.id];
        html +=
          '<div class="stu-core-row' +
          (n ? '' : ' unseen') +
          '"><span>' +
          esc(cc.label) +
          '</span><strong>' +
          n +
          '</strong><span class="stu-core-track"><span class="stu-core-fill" style="width:' +
          (n ? Math.max(6, Math.round((n / max) * 100)) : 0) +
          '%;background:' +
          cc.color +
          '"></span></span></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function _isTab(id) {
    return TABS.some(function (t) {
      return t.id === id;
    });
  }

  /* The last tab a teacher opened, on this device. */
  var TAB_KEY = 'gb-student-tab';
  function _savedTab() {
    try {
      var t = localStorage.getItem(TAB_KEY);
      return _isTab(t) ? t : null;
    } catch (e) {
      return null;
    }
  }

  /* The address names the open tab, so a link or a reload opens it. Set in
     place: changing the hash would reload the page. */
  function _syncTabToUrl() {
    var hash =
      '#/student?id=' + encodeURIComponent(studentId) + '&course=' + encodeURIComponent(activeCourse) + '&tab=' + _tab;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  /* The students in the sidebar's order, and this one's neighbours. */
  function _neighbours() {
    var list = sortStudents(getStudents(activeCourse), 'lastName');
    var i = list.findIndex(function (s) {
      return s.id === studentId;
    });
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  }

  function _stepButtonHtml(dir, st) {
    var label = dir === 'prev' ? 'Previous student' : 'Next student';
    return (
      '<button type="button" class="stu-step-btn" data-action="stuStep" data-sid="' +
      (st ? esc(st.id) : '') +
      '"' +
      (st ? ' title="' + esc(label + ': ' + fullName(st)) + '"' : ' disabled') +
      ' aria-label="' +
      esc(st ? label + ': ' + fullName(st) : label) +
      '">' +
      (dir === 'prev' ? '‹' : '›') +
      '</button>'
    );
  }

  function setTab(id) {
    if (!_isTab(id)) return;
    _tab = id;
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch (e) {
      /* private mode: the tab just isn't remembered */
    }
    _syncTabToUrl();
    render();
    var btn = document.getElementById('stu-tab-' + id);
    if (btn) btn.focus();
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
        '<a role="link" tabindex="0" data-href="#/dashboard" class="btn btn-primary">Back to Dashboard</a></div>';
      return;
    }

    // Every grade on this page follows the class's chosen reporting term.
    if (typeof activateSavedTerm === 'function') activateSavedTerm(cid);
    var sections = getSections(cid);
    var assessments = getAssessments(cid);
    var assessMap = {};
    assessments.forEach(function (a) {
      assessMap[a.id] = a;
    });
    var allScores = getScores(cid)[studentId] || [];
    var statuses = getAssignmentStatuses(cid);

    // ── Toolbar ──
    var html =
      '<div class="student-toolbar">' +
      renderBreadcrumb('Dashboard', '#/dashboard', fullName(student) || displayName(student)) +
      '<span class="stu-step">' +
      _stepButtonHtml('prev', _neighbours().prev) +
      _stepButtonHtml('next', _neighbours().next) +
      '</span>' +
      '<button class="tb-edit-btn" data-action="openEditStudent">Edit Student</button>' +
      (typeof renderTermPicker === 'function' ? renderTermPicker(cid) : '') +
      '</div>';

    html += '<div class="student-scroll"><div style="padding:16px 20px">';

    // ── Header ──
    html += renderStudentHeader(cid, studentId, {
      buttonLabel: 'Term Questionnaire',
      buttonHref: '#/reports?course=' + cid + '&tab=questionnaire&student=' + studentId,
      hideCounts: true,
    });

    // ── Tabs ──
    // Every count and list below follows the class's chosen reporting term.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var termAssessments = assessments.filter(function (a) {
      return assessmentInActiveTerm(cid, a);
    });
    var classStudents = getStudents(cid);
    var ctx = {
      cid: cid,
      student: student,
      classStudents: classStudents,
      classIds: classStudents.map(function (s) {
        return s.id;
      }),
      sections: sections,
      assessments: termAssessments,
      assessMap: assessMap,
      allScores: allScores,
      statuses: statuses,
      term: term,
      obs: getStudentQuickObs(cid, studentId).filter(function (o) {
        return CompetencyEvidence._helpers.obsInTerm(o, term);
      }),
      cells: termAssessments.map(function (a) {
        return { a: a, cell: assessmentCellValue(cid, studentId, a) };
      }),
    };
    html += _tabBarHtml(_tabSummaries(ctx));
    html += '<div class="stu-panel" id="stu-panel" role="tabpanel" aria-labelledby="stu-tab-' + _tab + '">';
    if (_tab === 'assess') html += _assessTabHtml(ctx);
    else if (_tab === 'evidence') html += Evidence.panelHtml();
    else if (_tab === 'breakdown') html += _breakdownTabHtml(ctx);
    else if (_tab === 'goals') html += _goalsTabHtml(ctx);
    else if (_tab === 'profile') html += _profileTabHtml(ctx);
    else html += _compsTabHtml(ctx);
    html += '</div>';

    html += '</div></div>'; // close padding wrapper + scroll wrapper
    var main = document.getElementById('main');
    main.innerHTML = html;
    // The Evidence panel and the competency drawers show the same
    // observations; a change in one redraws the other.
    Evidence.mount(activeCourse, studentId, { onChange: CompetencyEvidence.refresh });
    CompetencyEvidence.mount(activeCourse, studentId, main, { onAdd: Evidence.refresh });
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
      stuTab: function () {
        setTab(el.dataset.tab);
      },
      stuStep: function () {
        if (el.dataset.sid) switchStudent(el.dataset.sid);
      },
      stuAssessFilter: function () {
        _assessFilter = el.dataset.filter || 'all';
        render();
      },
      stuAssessGroup: function () {
        _assessGroup = el.dataset.group || 'date';
        try {
          localStorage.setItem(GROUP_KEY, _assessGroup);
        } catch (err) {
          /* private mode: the choice lasts this visit */
        }
        render();
      },
      stuAssessFold: function () {
        var k = el.dataset.fold;
        if (_assessClosed[k]) delete _assessClosed[k];
        else _assessClosed[k] = true;
        render();
      },
      stuBdToggle: function () {
        var k = el.dataset.key;
        if (_bdOpen[k]) delete _bdOpen[k];
        else _bdOpen[k] = true;
        render();
      },
      stuBdRubric: function () {
        _bdRubric = el.dataset.key || '';
        render();
      },
      stuTypeView: function () {
        _typeView = el.dataset.view || 'strengths';
        try {
          localStorage.setItem(TYPE_VIEW_KEY, _typeView);
        } catch (err) {
          /* private mode: the choice lasts this visit */
        }
        render();
      },
      stuTypeFocus: function () {
        _typeFocus = el.dataset.key || '';
        render();
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

  function _handleChange(e) {
    var el = e.target;
    if (el && el.dataset && el.dataset.actionChange === 'stuAssessCat') {
      _assessCat = el.value || '';
      render();
    }
  }

  /* Arrow keys, Home and End move between the tabs. */
  function _handleKeydown(e) {
    var tab = e.target && e.target.closest && e.target.closest('.stu-tab');
    if (!tab) return;
    var ids = TABS.map(function (t) {
      return t.id;
    });
    var i = ids.indexOf(tab.dataset.tab);
    var next =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? ids.length - 1
              : null;
    if (next == null) return;
    e.preventDefault();
    setTab(ids[(next + ids.length) % ids.length]);
  }

  /* A drawer's observation link opens it in the Observations tab. */
  function _handleJump(e) {
    var el = e.target && e.target.closest && e.target.closest('[data-ced="jump"]');
    if (!el) return;
    var obId = el.getAttribute('data-obid');
    _tab = 'evidence';
    render();
    Evidence.jumpTo(obId);
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    studentId = params.id;
    _openTags = new Set();
    _assessFilter = 'all';
    _assessCat = '';
    _assessGroup = _savedGroupBy();
    _assessClosed = {};
    _bdOpen = {};
    _bdRubric = '';
    _typeView = _savedTypeView();
    _typeFocus = '';
    // The tab the link names; a link to one observation opens Observations;
    // otherwise the tab last opened on this device.
    _tab = _isTab(params.tab) ? params.tab : params.ob ? 'evidence' : _savedTab() || 'comps';
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
    _addDocListener('click', _handleJump);
    _addDocListener('change', _handleChange);
    _addDocListener('keydown', _handleKeydown);

    render();

    // "&ob=<id>" (a week on the dashboard's Observations card): show that
    // observation in the Evidence panel once the page has settled.
    var jumpOb = params.ob ? resolveObservationId(activeCourse, params.ob) : null;

    requestAnimationFrame(function () {
      document.getElementById('main').scrollTop = 0;
      if (jumpOb) Evidence.jumpTo(jumpOb);
    });
  }

  function destroy() {
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    // Clean up any open edit modal
    closeEditStudent();
    Evidence.destroy();
    CompetencyEvidence.destroy();
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
