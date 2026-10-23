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
  var _tab = 'comps'; // the open tab: comps, assess, evidence, goals, profile
  var _assessFilter = 'all'; // Assessments tab: all, prof, points, unscored
  var _assessCat = ''; // Assessments tab: a category id, or '' for all
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
    { id: 'evidence', label: 'Evidence' },
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
      stat: _plural(ctx.obs.length, 'Observation', 'Observations'),
      sub: scope + (lastOb ? ' · Latest ' + _daysAgo(_obDay(lastOb)) : ' · None yet'),
    };
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
      '<span class="stu-comp-latest"><span>' +
      esc(_latestLine(cid, sec, ctx.assessMap)) +
      '</span><span class="stu-sub dash-tag-evidence">' +
      esc(CompetencyEvidence.rowCount(cid, studentId, tag.id)) +
      '</span></span>' +
      '<span class="dash-tag-chevron" aria-hidden="true">&#9654;</span>' +
      '</button>' +
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
    var html =
      '<div class="stu-toolbar">' +
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
    var month = '';
    shown.forEach(function (c) {
      var a = c.a;
      var m = (a.date || '').slice(0, 7);
      if (m !== month) {
        month = m;
        var md = m ? new Date(m + '-01T00:00:00') : null;
        html +=
          '<h3 class="stu-month">' +
          (md && !isNaN(md) ? md.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }) : 'No Date') +
          '</h3>';
      }
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
      html +=
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
        '<span class="stu-assess-toward">' +
        esc(towardText) +
        '</span>' +
        '</div>';
    });
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
    var desc = (typeof ReportBlocks !== 'undefined' && ReportBlocks.OBS_DESCRIPTORS) || {};
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
    groups.forEach(function (g) {
      html +=
        '<div class="stu-profile-group"><h3>' + esc(g.name) + '</h3><div class="stu-sub">' + esc(g.sub) + '</div>';
      g.dims.forEach(function (d) {
        var tagged = ctx.obs.filter(function (o) {
          return (o.dims || []).indexOf(d) >= 0;
        });
        var latest = tagged[0];
        var dots = '';
        for (var i = 0; i < Math.min(tagged.length, 5); i++) dots += '<span class="stu-dot on"></span>';
        if (!tagged.length) dots = '<span class="stu-dot"></span>';
        html +=
          '<div class="stu-dim' +
          (tagged.length ? '' : ' unseen') +
          '">' +
          '<div class="stu-dim-text"><strong>' +
          esc(OBS_LABELS[d]) +
          '</strong>' +
          (desc[d] ? '<span class="stu-sub">' + esc(desc[d].desc) + '</span>' : '') +
          '<span class="stu-dim-latest">' +
          (latest
            ? 'Latest: ' + esc(_shortDay(_obDay(latest))) + ', ' + esc(String(latest.text || '').split('\n')[0])
            : 'Not seen yet') +
          '</span></div>' +
          '<span class="stu-dots" aria-label="' +
          _plural(tagged.length, 'observation', 'observations') +
          '">' +
          dots +
          (tagged.length > 5 ? '<span class="stu-sub">' + tagged.length + '</span>' : '') +
          '</span></div>';
      });
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
    var ctx = {
      cid: cid,
      student: student,
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

  /* A drawer's observation link opens it in the Evidence tab. */
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
    // The tab the link names; a link to one observation opens Evidence;
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
