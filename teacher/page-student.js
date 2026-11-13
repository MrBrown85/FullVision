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
  var _tab = 'overview'; // the open tab: overview, comps, grades, work, evidence, profile
  var _ovOpen = ''; // Overview: the assessment open in All Your Work ('' = none)
  var _ovFilter = 'all'; // Overview, All Your Work: all, marked, missing
  var _ovShowAll = false; // Overview: every missing piece, not the first three
  var _ovCrit = ''; // Overview: '<assessment id>:<criterion index>' whose next step shows
  var _coreTerm = null; // Learner Profile: the term ordinal whose self-assessments show
  var _coreEditing = ''; // Learner Profile: the Core Competency being self-assessed
  var _openTags = new Set(); // competency cards whose evidence drawer is open
  var _compSort = 'map'; // Competencies tab: 'map' (learning-map order) or 'lowest'
  var _grGroup = 'category'; // Grades tab: Group By
  var _grFilter = 'all'; // Grades tab: all, marked or missing
  var _grClass = false; // Grades tab: show the class average (off by default)
  var _overrideSelectedLevel = 0;
  var Evidence = StudentEvidence;
  var Overrides = StudentOverrides;

  function _assessmentCategoryLabel(cid, assessment) {
    return getAssessmentCategoryName(cid, assessment);
  }

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    if (!(await switchActiveCourse(cid))) return;
    Router.navigate('/dashboard');
  }

  /* Another student keeps the open tab, so a teacher can go down the class
     on one tab. */
  function switchStudent(sid) {
    studentId = sid;
    _shareWithEditStudent();
    Router.navigate('/student?id=' + sid + '&course=' + activeCourse + '&tab=' + _tab);
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
    // The Competencies tab lays an open row out in two columns.
    if (row.parentElement && row.parentElement.classList.contains('stu-comp'))
      row.parentElement.classList.toggle('open', open);
    var tagId = row.dataset.tagid;
    if (tagId) {
      if (open) _openTags.add(tagId);
      else _openTags.delete(tagId);
    }
  }

  /* ── Goal editing ───────────────────────────────────────── */
  /* An open editor in a No Goal Yet row takes the row's whole width, so a
     one-sentence goal fits without scrolling. */
  function _markEditing(editId, on) {
    var area = document.getElementById(editId);
    if (!area) return;
    var part = area.closest('.stu-goal-part');
    var row = area.closest('.gl-row');
    if (part) part.classList.toggle('is-editing', on);
    if (row) row.classList.toggle('gl-editing', on || !!row.querySelector('.stu-goal-part.is-editing'));
  }
  function editGoal(secId) {
    document.getElementById('goal-edit-' + secId).style.display = '';
    document.getElementById('goal-text-' + secId).style.display = 'none';
    _markEditing('goal-edit-' + secId, true);
    document.getElementById('goal-input-' + secId).focus();
  }
  function cancelGoalEdit(secId) {
    document.getElementById('goal-edit-' + secId).style.display = 'none';
    document.getElementById('goal-text-' + secId).style.display = '';
    _markEditing('goal-edit-' + secId, false);
    _focusEditButton('editGoal', secId);
  }
  // Back on the + Goal / Edit button the editor came from.
  function _focusEditButton(action, secId) {
    var btn = document.querySelector('[data-action="' + action + '"][data-secid="' + secId + '"]');
    if (btn) btn.focus();
  }
  async function saveGoalField(secId) {
    var text = (document.getElementById('goal-input-' + secId).value || '').trim();
    var cid = activeCourse;
    var sid = studentId;
    var was = (getGoals(cid)[sid] || {})[secId] || '';
    var wasDate = (typeof getGoalDates === 'function' ? (getGoalDates(cid)[sid] || {})[secId] : null) || null;
    var saving = _writeGoal(cid, sid, secId, text, text ? new Date().toISOString() : null);
    render();
    // A goal taken away (Remove Goal, or its text cleared) can be put back.
    if (was && !text && typeof showUndoToast === 'function') {
      showUndoToast('Goal removed', function () {
        _writeGoal(cid, sid, secId, was, wasDate);
        if (activeCourse === cid && studentId === sid) render();
      });
    }
    await saving;
  }
  function _writeGoal(cid, sid, secId, text, date) {
    var goals = getGoals(cid);
    if (!goals[sid]) goals[sid] = {};
    goals[sid][secId] = text;
    saveGoals(cid, goals);
    if (typeof setGoalDate === 'function') setGoalDate(cid, sid, secId, text ? date : null);
    if (window.v2 && _isUuid && _isUuid(sid)) return window.v2.saveGoal(sid, secId, text);
    return Promise.resolve();
  }
  function removeGoal(secId) {
    var box = document.getElementById('goal-input-' + secId);
    if (box) box.value = '';
    return saveGoalField(secId);
  }

  /* ── Reflection editing ─────────────────────────────────── */
  function editReflection(secId) {
    document.getElementById('refl-edit-' + secId).style.display = '';
    document.getElementById('refl-text-' + secId).style.display = 'none';
    _markEditing('refl-edit-' + secId, true);
    // Typing goes straight into the box, as it does for + Goal.
    document.getElementById('refl-input-' + secId).focus();
  }
  function cancelReflEdit(secId) {
    document.getElementById('refl-edit-' + secId).style.display = 'none';
    document.getElementById('refl-text-' + secId).style.display = '';
    _markEditing('refl-edit-' + secId, false);
    _focusEditButton('editReflection', secId);
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

  /* ── Edit Student: the dialog is teacher/student-edit-dialog.js ── */
  function openEditStudent(cidArg, sidArg, onSaved) {
    return StudentEditDialog.openEditStudent(cidArg, sidArg, onSaved);
  }
  function closeEditStudent() {
    return StudentEditDialog.closeEditStudent();
  }
  function _shareWithEditStudent() {
    StudentEditDialog.configure({ activeCourse: activeCourse, studentId: studentId, render: render });
  }

  /* ── Tabs ───────────────────────────────────────────────── */
  var TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'comps', label: 'Competencies' },
    // Grades (redesign R4, R5): Assessments and Grade Breakdown in one tab.
    { id: 'grades', label: 'Grades' },
    // Work (S14-F2): only while the class's student page and Send Work are on.
    { id: 'work', label: 'Work' },
    { id: 'evidence', label: 'Observations' },
    { id: 'profile', label: 'Learner Profile' },
  ];

  /* The tabs Grades replaced (R5): old links and a saved tab open Grades. */
  function _tabAlias(id) {
    if (id === 'goals') return 'profile';
    if (id === 'assess' || id === 'breakdown') return 'grades';
    return id;
  }

  // The tabs this class shows: Work is drawn by shared/work-wall.js.
  function _shownTabs() {
    var work = !!window.WorkWall && WorkWall.tabOn(activeCourse);
    return TABS.filter(function (t) {
      return t.id !== 'work' || work;
    });
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _shortDay(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  /* A level as the class shows it, with its proficiency word unless the
     class is Letter, tinted by its level. */
  function _levelPill(cid, v) {
    var lvl = v > 0 ? roundLevel(v) : 0;
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

  /* The Observations tab's figure: the observations shown, less any deleted
     one still waiting on its Undo. */
  function _evidenceSummary(obs) {
    var shown = obs.filter(function (o) {
      return !Evidence.isPending(o.id);
    });
    return { stat: _plural(shown.length, 'Note', 'Notes') };
  }

  /* After an observation is added, deleted or put back on this page, the
     tab counts it at once (not at the next full redraw). */
  function _refreshEvidenceTile() {
    var tile = document.getElementById('stu-tab-evidence');
    if (!tile) return;
    var cid = activeCourse;
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var obs = getStudentQuickObs(cid, studentId).filter(function (o) {
      return CompetencyEvidence._helpers.obsInTerm(o, term);
    });
    var stat = tile.querySelector('.stu-tab-stat');
    if (stat) stat.textContent = _evidenceSummary(obs).stat;
  }

  /* Each tab's one figure under its name (canvas "Student Page Tabs", option
     2, Colin 2026-11-11). A badge takes the figure's place only when
     something needs the teacher: work missing (orange), work to grade or a
     question to answer (blue). The grade itself is in the header's pill. */
  function _tabSummaries(ctx) {
    var cid = ctx.cid;
    var out = {};
    // The Missing count only (the Overview's own list, without its grades).
    var nMiss = ctx.assessments.filter(function (a) {
      return countsTowardGrades(cid, a) && ctx.statuses[studentId + ':' + a.id] === 'NS';
    }).length;
    out.overview = nMiss ? { badge: nMiss + ' Missing', tone: 'miss' } : { stat: '0 Missing' };
    var profs = ctx.sections
      .map(function (sec) {
        return getSectionProficiency(cid, studentId, sec.id);
      })
      .filter(function (v) {
        return v > 0;
      });
    var atProf = profs.filter(function (v) {
      return roundLevel(v) >= 3;
    }).length;
    out.comps = {
      stat: !profs.length
        ? 'Not Scored'
        : courseGradeMode(cid) === 'letter'
          ? profs.length + ' of ' + ctx.sections.length + ' Scored'
          : atProf + ' of ' + ctx.sections.length + ' Proficient',
    };
    out.grades = { stat: _plural(ctx.assessments.length, 'Piece', 'Pieces') };
    if (window.WorkWall && WorkWall.tabOn(cid)) out.work = WorkWall.tabSummary(cid, studentId);
    out.evidence = _evidenceSummary(ctx.obs);
    // The Learner Profile: goals set (the student's own and the competency
    // goals), or the feedback reflections once there are any (S10-F4).
    var goals = getGoals(cid)[studentId] || {};
    var goalCount =
      LearnerProfile.goalCount(ctx.voice) +
      ctx.sections.filter(function (sec) {
        return !!(goals[sec.id] || '').trim();
      }).length;
    out.profile = { stat: _plural(goalCount, 'Goal', 'Goals') };
    // The Learner Profile's own feedback when it is the tab drawn; the two counts otherwise.
    var fb = _tab === 'profile' ? _feedbackOf(ctx) : LearnerProfile.feedbackCounts(cid, studentId);
    if (fb && fb.count) out.profile = { stat: _plural(fb.count, 'Reflection', 'Reflections') };
    if (fb && fb.waiting) out.profile = { badge: fb.waiting + ' to Answer', tone: 'todo' };
    return out;
  }

  function _tabBarHtml(sums) {
    return (
      '<div class="stu-tabs" role="tablist" aria-label="Student details">' +
      TABS.map(function (t) {
        if (!sums[t.id]) return ''; // Work, while the class has it off
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
          '</span>' +
          (sm.badge
            ? '<span class="stu-tab-badge ' + (sm.tone === 'miss' ? 'miss' : 'todo') + '">' + esc(sm.badge) + '</span>'
            : '<span class="stu-tab-stat">' + esc(sm.stat) + '</span>') +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  /* ── Overview tab ───────────────────────────────────────── */
  /* What a student at the teacher's desk asks: "How am I doing?" The teacher
     holds the mouse and the student reads the screen, so what the student
     reads is large and plain, and the teacher's controls are small. It shows
     grades and missing work only: no notes, observations, designations or
     other students. Every grade comes from calc.js; the grade "if handed in"
     is the same calculation with this student's Missing work left out
     (withMissingLeftOut), so it carries the category weights. It is shown
     only for a class with a % and only when at least a third of the work
     is marked: a guess from two scores misleads. */
  var OV_THIN = 1 / 3;

  function _ovPctText(lg) {
    return (lg.S ? lg.S + ' ' : '') + lg.R + '%';
  }

  // Worked out once a draw (the Overview and Grades tabs both read it), and only on those tabs.
  function _overviewModel(ctx) {
    if (ctx.ov) return ctx.ov;
    var cid = ctx.cid;
    var course = COURSES[cid] || {};
    var letterOnly = courseGradeMode(cid) === 'letter';
    var overall = getOverallProficiency(cid, studentId);
    var lg = courseShowsLetterGrades(course) ? getCourseLetterData(cid, studentId) : null;
    var hasPct = !!(lg && lg.R != null);
    var statusOf = function (a) {
      return ctx.statuses[studentId + ':' + a.id] || '';
    };
    var cellOf = {};
    ctx.cells.forEach(function (c) {
      cellOf[c.a.id] = c.cell;
    });
    var counted = ctx.assessments.filter(function (a) {
      return countsTowardGrades(cid, a);
    });
    var assigned = counted.filter(function (a) {
      return statusOf(a) !== 'EXC';
    });
    var missing = counted.filter(function (a) {
      return statusOf(a) === 'NS';
    });
    var marked = assigned.filter(function (a) {
      var c = cellOf[a.id];
      return statusOf(a) !== 'NS' && c && (c.kind === 'points' || c.kind === 'level' || c.kind === 'complete');
    });
    var thin = missing.length > 0 && assigned.length > 0 && marked.length / assigned.length < OV_THIN;

    var now = { hasPct: hasPct, lg: lg, level: overall, showLevel: !letterOnly && overall > 0 };
    now.text = hasPct ? _ovPctText(lg) : overall > 0 ? formatLevel(cid, overall) : 'No Grade Yet';

    var proj = null;
    var gains = {};
    if (hasPct && missing.length && !thin) {
      var p = withMissingLeftOut(studentId, null, function () {
        return getCourseLetterData(cid, studentId);
      });
      if (p && p.R != null && p.R > lg.R) {
        proj = { lg: p, text: _ovPctText(p), cost: Math.round(p.R - lg.R) };
        missing.forEach(function (a) {
          var one = withMissingLeftOut(studentId, [a.id], function () {
            return getCourseLetterData(cid, studentId);
          });
          gains[a.id] = one && one.R != null ? Math.max(0, Math.round(one.R - lg.R)) : 0;
        });
      }
    }
    var dueOf = function (a) {
      return a.dueDate || a.date || '';
    };
    missing = missing.slice().sort(function (x, y) {
      return (gains[y.id] || 0) - (gains[x.id] || 0) || dueOf(x).localeCompare(dueOf(y));
    });

    // To Get Better: the lowest competency, and the teacher's latest words
    // on work that scored it.
    // Next to Work On: the same pick as the Competencies tab's summary, so
    // the two never name different competencies, and never one that rests
    // on too few scores.
    var cands = [];
    ctx.sections.forEach(function (sec) {
      var v = getSectionProficiency(cid, studentId, sec.id);
      if (!(v > 0)) return;
      var es = _compEntries(cid, sec);
      cands.push({ sec: sec, v: v, n: es.length, enough: _cpTrend(cid, es).dir !== 'none' });
    });
    var picked = _cpPick(cands);
    var better = picked.lo || picked.hi;
    if (better) better = { sec: better.sec, v: better.v };
    if (better) {
      var tag = better.sec.tags[0];
      better.name = (tag && tag.label) || better.sec.name;
      better.what = (tag && (tag.ican || tag.text)) || '';
      var ids = _compEntries(cid, better.sec).map(function (e) {
        return e.assessmentId;
      });
      var noted = ctx.allScores
        .filter(function (s) {
          return s.note && ids.indexOf(s.assessmentId) >= 0;
        })
        .map(function (s) {
          return { s: s, a: ctx.assessMap[s.assessmentId] };
        })
        .filter(function (x) {
          return x.a;
        })
        .sort(function (x, y) {
          return (y.a.date || '').localeCompare(x.a.date || '');
        })[0];
      if (noted) better.comment = { text: String(noted.s.note), a: noted.a };
    }

    return (ctx.ov = {
      cid: cid,
      course: course,
      now: now,
      proj: proj,
      thin: thin,
      gains: gains,
      missing: missing,
      assigned: assigned,
      marked: marked,
      handedIn: assigned.length - missing.length,
      better: better,
      cellOf: cellOf,
      statusOf: statusOf,
      dueOf: dueOf,
    });
  }

  /* The letter bands from C− to A as a strip, with where the student is
     now and, when it shows, where handing everything in would put them.
     Zoomed to 50–100%: below 50 is one band. */
  function _ovStripHtml(ov) {
    var bands = BC_LETTER_BANDS.filter(function (b) {
      return b.min >= 50;
    }).sort(function (x, y) {
      return x.min - y.min;
    });
    var at = function (p) {
      return Math.max(0, Math.min(100, (p - 50) * 2));
    };
    var nowP = ov.now.lg.R;
    var projP = ov.proj ? ov.proj.lg.R : null;
    var track = '';
    var names = '';
    bands.forEach(function (b, i) {
      var top = i < bands.length - 1 ? bands[i + 1].min : 100;
      var w = top - b.min;
      var isNow = nowP >= b.min && nowP < (i < bands.length - 1 ? top : 101);
      var isProj = projP != null && projP >= b.min && projP < (i < bands.length - 1 ? top : 101);
      track +=
        '<span class="stu-ov-band' +
        (isNow ? ' now' + (ov.now.level > 0 ? ' stu-ov-lv-' + roundLevel(ov.now.level) : '') : '') +
        '" style="flex:' +
        w +
        ' 1 0"></span>';
      names +=
        '<span class="stu-ov-band-name' +
        (isNow ? ' now' : isProj ? ' proj' : '') +
        '" style="flex:' +
        w +
        ' 1 0">' +
        esc(b.label) +
        '</span>';
    });
    var html = '<div class="stu-ov-strip" aria-hidden="true"><div class="stu-ov-track">' + track + '</div>';
    if (projP != null)
      html +=
        '<span class="stu-ov-gap" style="left:' +
        at(nowP) +
        '%;width:' +
        Math.max(0, at(projP) - at(nowP)) +
        '%"></span><span class="stu-ov-pin proj" style="left:' +
        at(projP) +
        '%"></span>';
    html += '<span class="stu-ov-pin" style="left:' + at(nowP) + '%"></span>';
    return html + '<div class="stu-ov-names">' + names + '</div></div>';
  }

  function _ovGradeHtml(ov) {
    var cid = ov.cid;
    var now = ov.now;
    var big = now.hasPct
      ? '<span class="stu-ov-letter">' +
        esc(now.lg.S || '') +
        '</span><span class="stu-ov-pct">' +
        esc(now.lg.R + '%') +
        '</span>'
      : now.level > 0
        ? '<span class="stu-ov-letter">' +
          esc(formatLevel(cid, now.level)) +
          '</span><span class="stu-ov-pct">' +
          esc(levelWord(cid, now.level) || '') +
          '</span>'
        : '<span class="stu-ov-pct">No grade yet</span>';
    var html =
      '<div class="stu-ov-card stu-ov-grade"><div class="stu-ov-pair">' +
      '<div class="stu-ov-now"><div class="stu-ov-label">Your Grade Right Now</div>' +
      '<div class="stu-ov-big' +
      (now.level > 0 ? ' stu-ov-lv-' + roundLevel(now.level) : '') +
      '">' +
      big +
      '</div>' +
      (now.hasPct && now.showLevel ? '<div class="stu-ov-level">' + _levelPill(cid, now.level) + '</div>' : '') +
      '</div>';
    if (ov.proj) {
      html +=
        '<div class="stu-ov-proj"><div class="stu-ov-label">If You Hand In Your Missing Work</div>' +
        '<div class="stu-ov-big"><span class="stu-ov-letter">' +
        esc(ov.proj.lg.S || '') +
        '</span><span class="stu-ov-pct">' +
        esc(ov.proj.lg.R + '%') +
        '</span></div>' +
        '<div class="stu-ov-proj-note">' +
        (ov.proj.lg.S && ov.proj.lg.S !== now.lg.S
          ? '<strong>' + esc(now.lg.S + ' → ' + ov.proj.lg.S) + '</strong> at your usual level'
          : 'At your usual level') +
        '</div></div>';
    } else if (ov.thin) {
      html +=
        '<div class="stu-ov-proj stu-ov-thin"><div class="stu-ov-label">Where You’re Headed</div>' +
        '<div class="stu-ov-thin-lede">Hand in more work to see where you’re headed.</div>' +
        '<div class="stu-ov-sub">Only ' +
        ov.marked.length +
        ' of ' +
        ov.assigned.length +
        ' pieces are assessed so far.</div></div>';
    }
    html += '</div>';
    if (now.hasPct) html += _ovStripHtml(ov);
    return html + '</div>';
  }

  function _ovMissingTileHtml(ov) {
    return (
      '<div class="stu-ov-card stu-ov-miss' +
      (ov.missing.length ? '' : ' none') +
      '"><div class="stu-ov-label">Missing</div>' +
      '<div class="stu-ov-miss-n">' +
      ov.missing.length +
      '</div>' +
      (ov.proj ? '<div class="stu-ov-miss-cost">Costing you ' + ov.proj.cost + '%</div>' : '') +
      // Missing counts as 0 (D7): said where it applies, as the student page says it.
      (ov.now.hasPct && ov.missing.length
        ? '<div class="stu-ov-sub">' +
          (ov.missing.length === 1 ? 'It counts as 0 until it’s in.' : 'Each counts as 0 until it’s in.') +
          '</div>'
        : '') +
      '<div class="stu-ov-sub">' +
      ov.handedIn +
      ' of ' +
      ov.assigned.length +
      ' handed in</div></div>'
    );
  }

  function _ovTodoHtml(ov) {
    var n = ov.missing.length;
    // Nothing missing: the Missing tile above already says so.
    if (!n) return '';
    var shown = _ovShowAll ? ov.missing : ov.missing.slice(0, 3);
    var html =
      '<div class="stu-ov-todo"><h3 class="stu-ov-h3">' +
      (n > 3 && !_ovShowAll ? 'Start With These Three' : 'Missing Work') +
      '</h3><ul class="stu-ov-list">';
    shown.forEach(function (a, i) {
      var gain = ov.gains[a.id];
      html +=
        '<li class="stu-ov-todo-item">' +
        '<div class="stu-ov-todo-main"><div class="stu-ov-todo-head"><span class="stu-ov-todo-title">' +
        esc(a.title) +
        '</span>' +
        (i === 0 ? '<span class="stu-ov-start">Start Here</span>' : '') +
        '</div><div class="stu-ov-todo-meta"><span>Was due ' +
        esc(_shortDay(ov.dueOf(a))) +
        '</span><button type="button" class="stu-ov-tc" data-action="stuOvShow" data-aid="' +
        esc(a.id) +
        '">Details</button></div></div>' +
        (ov.proj && gain > 0 ? '<span class="stu-ov-gain">+' + gain + '%</span>' : '') +
        '</li>';
    });
    html += '</ul>';
    if (n > 3)
      html +=
        '<button type="button" class="stu-ov-btn stu-ov-more" data-action="stuOvShowAll">' +
        (_ovShowAll ? 'Show Fewer' : 'Show All ' + n + ' Missing') +
        '</button>';
    return html + '</div>';
  }

  function _ovBetterHtml(ov) {
    var b = ov.better;
    if (!b) return '';
    return (
      '<div class="stu-ov-card stu-ov-better"><div class="stu-ov-label">Next to Work On</div>' +
      '<div class="stu-ov-better-name">' +
      esc(b.name) +
      ' ' +
      _levelPill(ov.cid, b.v) +
      '</div>' +
      (b.what ? '<div class="stu-ov-read">' + esc(b.what) + '</div>' : '') +
      (b.comment
        ? '<div class="stu-ov-better-note"><div class="stu-ov-label">From your teacher · ' +
          esc(_shortDay(b.comment.a.date)) +
          '</div><div class="stu-ov-read stu-ov-pre">' +
          esc(b.comment.text) +
          '</div></div>'
        : '') +
      '</div>'
    );
  }

  /* One piece's score as the row shows it: { main, sub }. */
  function _ovScore(ov, a) {
    var st = ov.statusOf(a);
    var cell = ov.cellOf[a.id];
    if (st === 'NS') return { main: ov.now.hasPct ? '0%' : 'Missing', sub: 'Not in yet', cls: 'miss' };
    if (st === 'EXC') return { main: 'Doesn’t count', sub: '', cls: 'quiet' };
    if (!cell || cell.kind === 'none') return { main: 'Not assessed yet', sub: '', cls: 'quiet' };
    // A marked score wears its level's colour (calc.js gives the level).
    var lv = cell.level > 0 ? roundLevel(cell.level) : 0;
    if (cell.kind === 'points') {
      var max = a.maxPoints || 100;
      return {
        main: formatPointsPercent(cell.value, max),
        sub: formatPoints(cell.value) + ' / ' + formatPoints(max),
        lv: lv,
      };
    }
    return { main: cell.text, sub: '', lv: lv };
  }

  /* An open piece's rubric: one 1–4 scale per criterion, and one next
     step, for the lowest criterion unless the teacher picks another. */
  function _ovRubricHtml(ov, a) {
    if (isPointsScored(a)) return '';
    var rid = a.rubricId || a.rubric_id;
    var rubric = rid ? getRubricById(ov.cid, rid) : null;
    if (!rubric || !(rubric.criteria || []).length) return '';
    var rows = [];
    rubric.criteria.forEach(function (crit, k) {
      var v = rubricCriterionLevel(ov.cid, studentId, a, crit);
      if (v == null) return;
      rows.push({ crit: crit, k: k, near: nearestScoreLevel(v) });
    });
    if (!rows.length) return '';
    var lowest = rows.reduce(function (m, r) {
      return r.near.level < m.near.level ? r : m;
    }, rows[0]);
    var sel =
      rows.find(function (r) {
        return _ovCrit === a.id + ':' + r.k;
      }) || lowest;
    var html =
      '<div class="stu-ov-rubric"><div class="stu-ov-rub-row stu-ov-rub-head" aria-hidden="true"><span>Rubric</span>' +
      '<span class="stu-ov-cells"><span>1</span><span>2</span><span>3</span><span>4</span></span><span></span></div>';
    rows.forEach(function (r) {
      var on = r === sel;
      var cells = '';
      // Filled in the level's colour, as every 1–4 scale (design rule 5).
      var fill = PROF_COLORS[r.near.level] || PROF_COLORS[0];
      for (var n = 1; n <= 4; n++)
        cells += '<span class="stu-ov-cell' + (n <= r.near.level ? ' on" style="background:' + fill : '') + '"></span>';
      html +=
        '<button type="button" class="stu-ov-rub-row' +
        (on ? ' sel' : '') +
        '" data-action="stuOvCrit" data-key="' +
        esc(a.id + ':' + r.k) +
        '" aria-pressed="' +
        on +
        '"><span class="stu-ov-rub-name">' +
        esc(r.crit.name || '') +
        '</span><span class="stu-ov-cells" aria-hidden="true">' +
        cells +
        '</span><span class="stu-ov-rub-lv">' +
        esc(r.near.text || String(r.near.level)) +
        '</span></button>';
    });
    html += '</div>';
    var nextLv = sel.near.level + 1;
    var nextText = sel.near.level >= 4 ? '' : (sel.crit.levels && sel.crit.levels[nextLv]) || '';
    if (sel.near.level >= 4)
      html +=
        '<div class="stu-ov-next"><div class="stu-ov-label">Next Step · ' +
        esc(sel.crit.name || '') +
        '</div><div class="stu-ov-next-text"><strong>Top level.</strong> Keep doing what you did here.</div></div>';
    else if (nextText)
      html +=
        '<div class="stu-ov-next"><div class="stu-ov-label">Next Step · ' +
        esc(sel.crit.name || '') +
        '</div><div class="stu-ov-next-text"><strong>To get a ' +
        nextLv +
        ':</strong> ' +
        esc(nextText) +
        '</div></div>';
    return html;
  }

  function _ovOpenHtml(ov, ctx, a) {
    var cid = ov.cid;
    var st = ov.statusOf(a);
    var withNote = ctx.allScores.find(function (s) {
      return s.assessmentId === a.id && s.note;
    });
    var left = '';
    if (withNote && st !== 'NS' && st !== 'EXC')
      left +=
        '<div><div class="stu-ov-label">From your teacher</div><div class="stu-ov-read stu-ov-pre">' +
        esc(String(withNote.note)) +
        '</div></div>';
    if (st !== 'NS' && st !== 'EXC') left += _ovRubricHtml(ov, a);
    if (st === 'NS' && a.description)
      left +=
        '<div><div class="stu-ov-label">The Task</div><div class="stu-ov-read stu-ov-pre">' +
        esc(a.description) +
        '</div></div>';
    if (st === 'EXC') left += '<div class="stu-ov-read">Excused. It doesn’t count toward your grade, up or down.</div>';
    var facts = [];
    if (st === 'NS') facts.push(['Was Due', _shortDay(ov.dueOf(a))]);
    else if (a.dueDate) facts.push(['Due', _shortDay(a.dueDate)]);
    else if (a.date) facts.push(['Date', _shortDay(a.date)]);
    if (st === 'LATE') facts.push(['Handed In', 'Late']);
    if (st === 'NS' && ov.proj && ov.gains[a.id] > 0)
      facts.push(['Adds About', '+' + ov.gains[a.id] + '% to your grade', 'proj']);
    var cat = showsCategoryBadge(cid, a) ? _assessmentCategoryLabel(cid, a) : '';
    if (cat) facts.push(['Category', cat]);
    var factsHtml = facts.length
      ? '<dl class="stu-ov-facts">' +
        facts
          .map(function (f) {
            return (
              '<div class="stu-ov-fact"><dt>' +
              esc(f[0]) +
              '</dt><dd' +
              (f[2] ? ' class="' + f[2] + '"' : '') +
              '>' +
              esc(f[1]) +
              '</dd></div>'
            );
          })
          .join('') +
        '</dl>'
      : '';
    return (
      '<div class="stu-ov-open"><div class="stu-ov-open-cols"><div class="stu-ov-open-main">' +
      (left || '<div class="stu-ov-sub">No comment or rubric on this one yet.</div>') +
      '</div>' +
      (window.WorkWall ? WorkWall.pieceHtml(cid, studentId, a.id) : '') +
      factsHtml +
      // What only the teacher acts on, marked as theirs.
      '</div><div class="stu-ov-teacher"><span class="stu-ov-only">' +
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5"/></svg>' +
      'Only You</span><a class="stu-link" role="link" tabindex="0" data-href="/assignments?course=' +
      cid +
      '&open=' +
      a.id +
      '&student=' +
      studentId +
      '">' +
      (st === 'NS' ? 'Enter a Score in Assignments' : 'Open in Assignments') +
      '</a></div></div>'
    );
  }

  /* One piece of work as a row that opens in place (design rule 7): the
     Overview's All Your Work and the Grades tab share it. */
  function _ovRowHtml(ov, ctx, a) {
    var st = ov.statusOf(a);
    var open = _ovOpen === a.id;
    var sc = _ovScore(ov, a);
    var pill =
      st === 'NS'
        ? '<span class="stu-ov-pill miss">Missing</span>'
        : st === 'LATE'
          ? '<span class="stu-ov-pill late">Late</span>'
          : st === 'EXC'
            ? '<span class="stu-ov-pill exc">Excused</span>'
            : '';
    return (
      '<div class="stu-ov-row' +
      (open ? ' open' : '') +
      '" id="stu-ov-row-' +
      esc(a.id) +
      '"><button type="button" class="stu-ov-row-btn" data-action="stuOvOpen" data-aid="' +
      esc(a.id) +
      '" aria-expanded="' +
      open +
      '"><span class="stu-ov-row-main"><span class="stu-ov-row-title">' +
      esc(a.title) +
      pill +
      '</span><span class="stu-ov-row-date">' +
      esc(_shortDay(a.date)) +
      '</span></span><span class="stu-ov-row-score' +
      (sc.cls ? ' ' + sc.cls : '') +
      '"><span class="stu-ov-row-main-score' +
      (sc.lv ? ' stu-ov-chip-lv stu-level-' + sc.lv : '') +
      '">' +
      esc(sc.main) +
      '</span>' +
      (sc.sub ? '<span class="stu-ov-row-sub">' + esc(sc.sub) + '</span>' : '') +
      '</span><span class="stu-ov-chev" aria-hidden="true">›</span></button>' +
      (open ? _ovOpenHtml(ov, ctx, a) : '') +
      '</div>'
    );
  }

  function _ovAllHtml(ov, ctx) {
    var list = ctx.assessments
      .slice()
      .sort(function (x, y) {
        return (y.date || '').localeCompare(x.date || '');
      })
      .filter(function (a) {
        var st = ov.statusOf(a);
        if (_ovFilter === 'missing') return st === 'NS';
        if (_ovFilter === 'marked') {
          var c = ov.cellOf[a.id];
          return st !== 'NS' && st !== 'EXC' && c && c.kind !== 'none';
        }
        return true;
      });
    var seg =
      // Filters narrow the list, so they are chips, not a view switch.
      '<div class="stu-ov-chips" role="group" aria-label="Show">' +
      [
        ['all', 'All'],
        ['marked', 'Assessed'],
        ['missing', 'Missing'],
      ]
        .map(function (f) {
          var on = _ovFilter === f[0];
          return (
            '<button type="button" class="stu-ov-chip" data-action="stuOvFilter" data-filter="' +
            f[0] +
            '" aria-pressed="' +
            on +
            '">' +
            f[1] +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    var html =
      '<div class="stu-ov-all"><div class="stu-ov-all-head"><h3 class="stu-ov-h3">All Your Work</h3>' + seg + '</div>';
    if (!list.length) return html + '<div class="stu-ov-card stu-ov-none">Nothing here.</div></div>';
    html += '<div class="stu-ov-rows">';
    list.forEach(function (a) {
      html += _ovRowHtml(ov, ctx, a);
    });
    return html + '</div></div>';
  }

  function _overviewTabHtml(ctx) {
    var ov = _overviewModel(ctx);
    var first = displayNameFirst(ctx.student);
    return (
      '<div class="stu-ov">' +
      '<div class="stu-ov-head"><div><h2 class="stu-ov-title">' +
      esc(first + '’s Overview') +
      '</h2></div><button type="button" class="stu-ov-btn" data-action="stuOvFull">Full Screen</button></div>' +
      '<div class="stu-ov-top">' +
      _ovGradeHtml(ov) +
      _ovMissingTileHtml(ov) +
      '</div><div class="stu-ov-mid">' +
      _ovTodoHtml(ov) +
      _ovBetterHtml(ov) +
      '</div>' +
      _ovAllHtml(ov, ctx) +
      '<p class="stu-ov-foot">Shows grades and missing work only: no notes, observations, designations or other students.</p>' +
      '</div>'
    );
  }

  /* ── Competencies tab ───────────────────────────────────── */
  /* One 1–4 scale (design rule 5): four cells filled to the level in its
     colour, and a ring where the first scores started (startAndNow). */
  function _cpScaleHtml(v, start) {
    var lvl = v > 0 ? Math.max(1, Math.min(4, roundLevel(v))) : 0;
    var html = '<span class="stu-cp-scale" aria-hidden="true">';
    for (var n = 1; n <= 4; n++) {
      var share = Math.max(0, Math.min(1, (v || 0) - (n - 1)));
      html +=
        '<span class="stu-cp-cell"><span style="width:' +
        share * 100 +
        '%;background:' +
        (PROF_COLORS[lvl] || PROF_COLORS[0]) +
        '"></span></span>';
    }
    if (start > 0) html += '<span class="stu-cp-ring" style="left:' + (Math.min(start, 4) / 4) * 100 + '%"></span>';
    return html + '</span>';
  }

  /* Since the start: where a run of scores started and where it is now
     (startAndNow), as the class shows levels. */
  function _cpTrend(cid, entries) {
    var sn = startAndNow(
      entries.map(function (e) {
        return { t: _dayNum(e.date), v: e.score };
      }),
    );
    if (!sn) return { dir: 'none', text: 'Too few to tell', start: 0, title: '' };
    var a = formatLevel(cid, sn.start);
    var b = formatLevel(cid, sn.now);
    var dir = a === b ? 'flat' : sn.now > sn.start ? 'up' : 'down';
    return {
      dir: dir,
      start: sn.start,
      from: a,
      to: b,
      text: dir === 'flat' ? 'Steady at ' + b : (dir === 'up' ? '↑ Up from ' : '↓ Down from ') + a,
      title: 'First four weeks ' + a + ', last four weeks ' + b,
    };
  }

  /* The open row's facts (design rule 7): the level and how it is worked
     out, the latest score, since the start, and any override. */
  function _cpFactsHtml(ctx, sec, sp, entries, tr, override) {
    var cid = ctx.cid;
    var word = sp > 0 ? levelWord(cid, sp) : '';
    var rows = [
      {
        label: 'Level',
        value: sp > 0 ? formatLevel(cid, sp) + (word ? ' · ' + word : '') : 'Not yet assessed',
        sub: describeCalcMethod(cid) + ' · ' + _plural(entries.length, 'score', 'scores'),
      },
      {
        label: 'Latest',
        value: '<span class="stu-comp-latest">' + esc(_latestLine(cid, sec, ctx.assessMap)) + '</span>',
        raw: true,
      },
      {
        label: 'Since the Start',
        value: tr.dir === 'none' ? 'Too few to tell' : tr.from + ' → ' + tr.to,
        sub: tr.dir === 'none' ? 'Needs scores at least two weeks apart' : 'The first four weeks to the last four',
      },
      {
        label: 'Override',
        value: override ? 'Set by you' : 'None',
        sub: override ? 'The calculated level is set aside' : 'The level is calculated',
      },
    ];
    return (
      '<dl class="stu-comp-facts">' +
      rows
        .map(function (r) {
          return (
            '<div class="stu-cp-fact"><dt>' +
            esc(r.label) +
            '</dt><dd><span class="stu-cp-fact-v">' +
            (r.raw ? r.value : esc(r.value)) +
            '</span>' +
            (r.sub ? '<span class="stu-cp-fact-sub">' + esc(r.sub) + '</span>' : '') +
            '</dd></div>'
          );
        })
        .join('') +
      '</dl>'
    );
  }

  function _compRowHtml(ctx, sec) {
    var cid = ctx.cid;
    var tag = sec.tags[0];
    var sp = getSectionProficiency(cid, studentId, sec.id);
    var override = getSectionOverride(cid, studentId, sec.id);
    var entries = _compEntries(cid, sec);
    var tr = _cpTrend(cid, entries);
    if (!tag) {
      return (
        '<div class="stu-comp"><div class="stu-comp-row stu-comp-row-static"><span class="stu-comp-name"><strong>' +
        esc(sec.name) +
        '</strong></span>' +
        _cpScaleHtml(sp, 0) +
        '<span class="stu-comp-level">' +
        _levelPill(cid, sp) +
        '</span></div></div>'
      );
    }
    var drawerId = 'ced-' + sec.id;
    var open = _openTags.has(tag.id);
    var ev = CompetencyEvidence.evidenceFor(cid, studentId, tag.id); // once; a closed drawer is built when it opens
    var sub = tag.ican || (tag.label && tag.label !== sec.name ? tag.label : '');
    return (
      '<div class="stu-comp' +
      (open ? ' open' : '') +
      '">' +
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
      (sub ? '<span class="stu-cp-ican">' + esc(sub) + '</span>' : '') +
      (override ? '<span class="override-label">Overridden</span>' : '') +
      '</span>' +
      _cpScaleHtml(sp, tr.start) +
      '<span class="stu-comp-level">' +
      (sp > 0 ? _levelPill(cid, sp) : '<span class="stu-sub">Not yet</span>') +
      '</span>' +
      '<span class="stu-cp-trend stu-cp-' +
      tr.dir +
      '"' +
      (tr.title ? ' title="' + esc(tr.title) + '"' : '') +
      '>' +
      esc(tr.text) +
      '</span>' +
      '<span class="stu-cp-ev dash-tag-evidence">' +
      esc(CompetencyEvidence.rowCount(cid, studentId, tag.id, ev)) +
      '</span>' +
      '<span class="dash-tag-chevron" aria-hidden="true">&#9654;</span>' +
      '</button>' +
      _compNowHtml(cid, tag, sp) +
      _compWhereHtml(ctx, entries) +
      CompetencyEvidence.drawerHtml(cid, studentId, sec, tag, drawerId, { later: !open, ev: ev, map: ctx.assessMap }) +
      _cpFactsHtml(ctx, sec, sp, entries, tr, override) +
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
  /* The open drawer's header (Nov 2 mockup): where the student is now, the
     level's descriptor (CompetencyWording), and the next step toward the
     level above. The level word follows the class's grading style
     (levelWord: none in a Letter class). A bank competency's wording loads
     the first time, and the page draws again once it is here. */
  var _bankAsked = false;
  function _compNowHtml(cid, tag, sp) {
    if (!(sp > 0) || !window.CompetencyWording) return '';
    var l = CompetencyWording.lines(tag, Math.max(1, Math.min(4, roundLevel(sp))));
    if (!l || (!l.descriptor && !l.next)) return '';
    if (!l.ready && !_bankAsked && window.RubricPrint && RubricPrint.loadBankLevels) {
      _bankAsked = true;
      RubricPrint.loadBankLevels().then(function (ok) {
        // Offline: ask again on the next draw.
        if (!ok) _bankAsked = false;
        else if (activeCourse === cid) _refreshNowHeaders(cid);
      });
    }
    var word = levelWord(cid, sp);
    return (
      '<div class="stu-comp-now">' +
      (l.descriptor
        ? '<div><b>Now' + (word ? ' \u00b7 ' + esc(word) : '') + ':</b> ' + esc(l.descriptor) + '</div>'
        : '') +
      (l.next ? '<div><b>Next step:</b> ' + esc(l.next) + '</div>' : '') +
      '</div>'
    );
  }

  /* The headers drawn again in place once the bank's wording is here, so
     the page keeps its scroll and focus. */
  function _refreshNowHeaders(cid) {
    document.querySelectorAll('.stu-comp-row[data-tagid]').forEach(function (row) {
      var tag = getTagById(cid, row.dataset.tagid);
      var sec = tag && getSectionForTag(cid, tag.id);
      if (!sec) return;
      var old =
        row.nextElementSibling && row.nextElementSibling.classList.contains('stu-comp-now')
          ? row.nextElementSibling
          : null;
      var html = _compNowHtml(cid, tag, getSectionProficiency(cid, studentId, sec.id));
      if (old) old.remove();
      // html-safe: _compNowHtml escapes the level word, descriptor and step
      if (html) row.insertAdjacentHTML('afterend', html);
    });
  }

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
      var lvl = Math.max(1, Math.min(4, roundLevel(r.v)));
      html +=
        '<div class="stu-comp-where-row"><span><strong>' +
        esc(r.name) +
        '</strong> <span class="stu-comp-where-n">· ' +
        r.n +
        '</span></span><span class="stu-comp-where-track" role="img" aria-label="' +
        esc(r.name + ': ' + formatLevel(cid, r.v) + ' across ' + _plural(r.n, 'score', 'scores')) +
        '"><span style="width:' +
        Math.round(levelBarPercent(cid, r.v)) +
        '%;background:' +
        (PROF_COLORS[lvl] || PROF_COLORS[0]) +
        '"></span></span><strong class="stu-comp-where-v">' +
        esc(formatLevel(cid, r.v)) +
        '</strong></div>';
    });
    return html + '</div>';
  }

  /* One quiet line over the list: how many are assessed, the strongest and
     the one to work on next, each with its level as the app shows levels,
     and where the class's calculation is set. */
  /* Strongest and Next to Work On, chosen only among competencies with
     enough evidence for the table's own Since the Start reading (fewer
     prints "Too few to tell"), so neither rests on one score. On a tie,
     the one with more scores. A missing pick is left out of the line.
       items  [{ v: level, n: scores, enough: true|false, ... }] */
  function _cpPick(items) {
    var ok = (items || []).filter(function (x) {
      return x.enough && x.v > 0;
    });
    if (!ok.length) return { hi: null, lo: null };
    var hi = ok.reduce(function (m, x) {
      return x.v > m.v || (x.v === m.v && x.n > m.n) ? x : m;
    }, ok[0]);
    var lo = ok.reduce(function (m, x) {
      return x.v < m.v || (x.v === m.v && x.n > m.n) ? x : m;
    }, ok[0]);
    return { hi: hi, lo: lo === hi ? null : lo };
  }

  function _cpSummaryHtml(ctx) {
    var cid = ctx.cid;
    var scored = [];
    ctx.sections.forEach(function (sec) {
      var v = getSectionProficiency(cid, studentId, sec.id);
      if (!(v > 0)) return;
      var entries = _compEntries(cid, sec);
      scored.push({ sec: sec, v: v, n: entries.length, enough: _cpTrend(cid, entries).dir !== 'none' });
    });
    var parts = [
      '<span class="stu-cp-sum-item"><strong>' +
        scored.length +
        ' of ' +
        ctx.sections.length +
        '</strong> ' +
        (ctx.sections.length === 1 ? 'Competency' : 'Competencies') +
        ' Assessed</span>',
    ];
    var pick = _cpPick(scored);
    var hi = pick.hi;
    var lo = pick.lo;
    if (hi)
      parts.push(
        '<span class="stu-cp-sum-item"><span class="stu-cp-sum-label">Strongest</span> ' +
          esc(hi.sec.name) +
          ' ' +
          _levelPill(cid, hi.v) +
          '</span>',
      );
    if (lo)
      parts.push(
        '<span class="stu-cp-sum-item"><span class="stu-cp-sum-label">Next to Work On</span> ' +
          esc(lo.sec.name) +
          ' ' +
          _levelPill(cid, lo.v) +
          '</span>',
      );
    return (
      '<div class="stu-cp-summary">' +
      parts.join('') +
      '<a class="stu-cp-how" role="link" tabindex="0" data-href="/dashboard?course=' +
      esc(encodeURIComponent(cid)) +
      '&amp;manage=grading" title="' +
      esc(describeCalcMethod(cid)) +
      '">How Levels Are Worked Out</a></div>'
    );
  }

  var CP_FOOT =
    '<p class="stu-cp-foot">Levels compare the student to the competency, not to classmates. Private observations show only to you.</p>';

  function _compsTabHtml(ctx) {
    var cid = ctx.cid;
    var sorts = [
      ['map', 'Curriculum Order'],
      ['lowest', 'Lowest First'],
    ];
    var html =
      '<div class="stu-cp">' +
      '<div class="stu-cp-head"><div class="stu-cp-head-text"><h2 class="stu-cp-title">Competencies</h2></div>' +
      '<div class="stu-cp-sortbox"><span class="stu-cp-sort-label" id="stu-cp-sort-label">Sort</span>' +
      '<div class="seg seg-sm stu-cp-sort" role="radiogroup" aria-labelledby="stu-cp-sort-label">' +
      sorts
        .map(function (s) {
          var on = _compSort === s[0];
          return (
            '<button type="button" class="seg-btn' +
            (on ? ' active' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" data-action="stuCompSort" data-sort="' +
            s[0] +
            '">' +
            esc(s[1]) +
            '</button>'
          );
        })
        .join('') +
      '</div></div></div>';
    if (!ctx.sections.length) return html + '<div class="stu-empty">This class has no competencies yet.</div></div>';
    html += _cpSummaryHtml(ctx);
    html +=
      '<div class="stu-cp-list"><div class="stu-cp-colhead" aria-hidden="true"><span>Competency</span>' +
      '<span class="stu-cp-colscale"><span>1</span><span>2</span><span>3</span><span>4</span></span>' +
      '<span>Level</span><span class="stu-cp-ringkey"><i></i>Since the Start</span><span>Evidence</span><span></span></div>';
    if (_compSort === 'lowest') {
      ctx.sections
        .map(function (sec, i) {
          return { sec: sec, i: i, v: getSectionProficiency(cid, studentId, sec.id) || 0 };
        })
        .sort(function (x, y) {
          // Not yet assessed last; otherwise lowest first, map order on a tie.
          if (!x.v !== !y.v) return x.v ? -1 : 1;
          return x.v - y.v || x.i - y.i;
        })
        .forEach(function (x) {
          html += _compRowHtml(ctx, x.sec);
        });
      return html + '</div>' + CP_FOOT + '</div>';
    }
    var grouped = getGroupedSections(cid);
    var hasGroups = grouped.groups.some(function (g) {
      return g.sections.length > 0;
    });
    if (hasGroups) {
      grouped.groups.forEach(function (gi) {
        if (!gi.sections.length) return;
        var note = folderAverageNote(cid, gi.group);
        html +=
          '<h3 class="stu-group-head"><span class="stu-group-name">' +
          esc(gi.group.name) +
          (note ? '<span class="stu-group-note">' + esc(note) + '</span>' : '') +
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
    return html + '</div>' + CP_FOOT + '</div>';
  }

  /* ── Groups of assessments: teacher/student-groups.js ── */
  function _typeLabel(t) {
    return StudentGroups.typeLabel(t);
  }
  function _groupCalcMode(g) {
    return StudentGroups.groupCalcMode(g);
  }
  function _assessGroups(cid, assessments, by) {
    return StudentGroups.assessGroups(cid, assessments, by);
  }
  function _gradePill(g) {
    return StudentGroups.gradePill(g);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function _dayNum(date) {
    var d = new Date(String(date || '').slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : Math.round(d.getTime() / 864e5);
  }

  /* ── Grades (redesign R4) ─────────────────────────────────
     Assessments and Grade Breakdown in one tab, for every class (R5):
     how the course grade is built (one bar, a segment per category as wide
     as its weight, filled to its grade), Group By (Category, Unit, Type,
     Rubric, Date), and every piece as a row that opens in place (the
     Overview's row). All grades through calc.js: assessmentGroupGrade,
     studentGradeSummary, and the Overview's _ovScore. */
  var GR_GROUPS = [
    { id: 'category', label: 'Category' },
    { id: 'module', label: 'Unit' },
    { id: 'type', label: 'Type' },
    { id: 'rubric', label: 'Rubric' },
    { id: 'date', label: 'Date' },
  ];

  function _grFiltered(ov, list) {
    return list.filter(function (a) {
      var st = ov.statusOf(a);
      if (_grFilter === 'missing') return st === 'NS';
      if (_grFilter === 'marked') {
        var c = ov.cellOf[a.id];
        return st !== 'NS' && st !== 'EXC' && c && c.kind !== 'none';
      }
      return true;
    });
  }

  function _grNewestFirst(list) {
    return list.slice().sort(function (x, y) {
      return (y.date || '').localeCompare(x.date || '');
    });
  }

  function _grCourseHtml(ctx) {
    var cid = ctx.cid;
    var summary = studentGradeSummary(cid, studentId);
    var cats = _assessGroups(cid, ctx.assessments, 'category').filter(function (g) {
      return !!g.key && g.category && Number(g.category.weight || 0) > 0;
    });
    var html =
      '<div class="stu-gr-course"><div class="stu-gr-course-now"><div class="stu-gr-label">Course Grade</div>' +
      '<div class="stu-gr-course-v">' +
      (courseGradeMode(cid) === 'letter'
        ? _gradePill(summary)
        : _levelPill(cid, getOverallProficiency(cid, studentId))) +
      '</div></div>';
    if (!cats.length) return html + '</div>';
    var label = [];
    html += '<div class="stu-gr-bar">';
    cats.forEach(function (g) {
      var mine = assessmentGroupGrade(cid, studentId, g.assessments, _groupCalcMode(g));
      var w = Number(g.category.weight || 0);
      var fill = mine ? (mine.pct != null ? mine.pct : mine.prof != null ? (mine.prof / 4) * 100 : 0) : 0;
      label.push(g.name + ' ' + (mine ? mine.text : 'not yet graded') + ', ' + w + '% of the grade');
      html +=
        '<div class="stu-gr-seg" style="flex:' +
        w +
        ' 1 0">' +
        '<div class="stu-gr-track"><div class="stu-gr-fill" style="width:' +
        Math.max(0, Math.min(100, fill)) +
        '%;background:' +
        (PROF_COLORS[mine ? mine.level : 0] || PROF_COLORS[0]) +
        '"></div></div>' +
        '<div class="stu-gr-seg-head"><span class="stu-gr-seg-name">' +
        esc(g.name) +
        '</span><span class="stu-gr-seg-v">' +
        esc(mine ? mine.text : '—') +
        '</span></div>' +
        '<div class="stu-gr-seg-w">' +
        esc(w + '% of the grade') +
        '</div></div>';
    });
    return (
      html.replace(
        '<div class="stu-gr-bar">',
        '<div class="stu-gr-bar" role="img" aria-label="' + esc(label.join('; ')) + '">',
      ) + '</div></div>'
    );
  }

  function _grControlsHtml(ov, ctx) {
    var counts = {
      all: ctx.assessments.length,
      marked: 0,
      missing: 0,
    };
    ctx.assessments.forEach(function (a) {
      var st = ov.statusOf(a);
      var c = ov.cellOf[a.id];
      if (st === 'NS') counts.missing++;
      else if (st !== 'EXC' && c && c.kind !== 'none') counts.marked++;
    });
    return (
      '<div class="stu-gr-controls"><span class="stu-gr-label" id="stu-gr-group-label">Group By</span>' +
      '<div class="seg seg-sm" role="radiogroup" aria-labelledby="stu-gr-group-label">' +
      GR_GROUPS.map(function (g) {
        var on = _grGroup === g.id;
        return (
          '<button type="button" class="seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="stuGrGroup" data-group="' +
          g.id +
          '">' +
          esc(g.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="stu-ov-chips" role="group" aria-label="Show">' +
      [
        ['all', 'All'],
        ['marked', 'Assessed'],
        ['missing', 'Missing'],
      ]
        .map(function (f) {
          return (
            '<button type="button" class="stu-ov-chip" data-action="stuGrFilter" data-filter="' +
            f[0] +
            '" aria-pressed="' +
            (_grFilter === f[0]) +
            '">' +
            f[1] +
            ' <span class="stu-gr-count">' +
            counts[f[0]] +
            '</span></button>'
          );
        })
        .join('') +
      '</div><span class="stu-gr-grow"></span>' +
      '<label class="stu-gr-classavg"><input type="checkbox" data-action="stuGrClass"' +
      (_grClass ? ' checked' : '') +
      '> Show Class Average</label></div>'
    );
  }

  function _grRowsHtml(ov, ctx, list) {
    var rows = _grNewestFirst(_grFiltered(ov, list));
    if (!rows.length) return '<div class="stu-gr-none">Nothing here with this filter.</div>';
    return (
      '<div class="stu-ov-rows">' +
      rows
        .map(function (a) {
          return _ovRowHtml(ov, ctx, a);
        })
        .join('') +
      '</div>'
    );
  }

  function _grGroupsHtml(ov, ctx) {
    var cid = ctx.cid;
    if (_grGroup === 'date') {
      var months = [];
      var byKey = {};
      _grNewestFirst(_grFiltered(ov, ctx.assessments)).forEach(function (a) {
        var key = String(a.date || '').slice(0, 7);
        if (!byKey[key]) {
          var d = key ? new Date(key + '-01T00:00:00') : null;
          byKey[key] = {
            name: d && !isNaN(d) ? d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }) : 'No Date',
            list: [],
          };
          months.push(byKey[key]);
        }
        byKey[key].list.push(a);
      });
      if (!months.length) return '<div class="stu-gr-none">Nothing here with this filter.</div>';
      return months
        .map(function (m) {
          return (
            '<section class="stu-gr-group"><div class="stu-gr-group-head"><h3 class="stu-gr-group-name">' +
            esc(m.name) +
            '</h3></div>' +
            _grRowsHtml(ov, ctx, m.list) +
            '</section>'
          );
        })
        .join('');
    }
    var groups = _assessGroups(cid, ctx.assessments, _grGroup).filter(function (g) {
      // The Rubric view shows each rubric's table; work with no rubric has none.
      return _grGroup !== 'rubric' || !!g.rubric;
    });
    if (!groups.length)
      return (
        '<div class="stu-gr-none">' +
        (_grGroup === 'rubric' ? 'No work uses a rubric yet.' : 'No assessments yet.') +
        '</div>'
      );
    if (_grGroup === 'rubric')
      return groups
        .map(function (g) {
          return (
            '<section class="stu-gr-group stu-gr-rubric-group"><div class="stu-gr-group-head"><h3 class="stu-gr-group-name">' +
            esc(g.name) +
            '</h3></div><div class="stu-gr-rubric">' +
            _rubricTableHtml(ctx, g) +
            '</div></section>'
          );
        })
        .join('');
    return groups
      .map(function (g) {
        var mine = assessmentGroupGrade(cid, studentId, g.assessments, _groupCalcMode(g));
        var missing = g.assessments.filter(function (a) {
          return ov.statusOf(a) === 'NS';
        }).length;
        return (
          '<section class="stu-gr-group"><div class="stu-gr-group-head"><div><h3 class="stu-gr-group-name">' +
          esc(g.name) +
          '</h3><div class="stu-gr-group-meta">' +
          esc(_plural(g.assessments.length, 'piece', 'pieces')) +
          (g.category && Number(g.category.weight || 0) > 0
            ? ' · ' + esc(Number(g.category.weight) + '% of the grade')
            : '') +
          (missing ? ' · <span class="stu-gr-miss">' + esc(missing + ' missing') + '</span>' : '') +
          '</div></div>' +
          (_grClass ? _grClassHtml(cid, g) : '') +
          _gradePill(mine) +
          '</div>' +
          _grRowsHtml(ov, ctx, g.assessments) +
          '</section>'
        );
      })
      .join('');
  }

  /* A group's class average, only while Show Class Average is on: a grade
     compares a student to the criteria, not to classmates. */
  function _grClassHtml(cid, g) {
    var ids = (getStudents(cid) || []).map(function (st) {
      return st.id;
    });
    var cls = classAssessmentGroupGrade(cid, ids, g.assessments, _groupCalcMode(g));
    return '<span class="stu-gr-class">Class ' + esc(cls ? cls.text : '—') + '</span>';
  }

  function _gradesTabHtml(ctx) {
    var ov = _overviewModel(ctx);
    return (
      '<div class="stu-gr">' +
      '<div class="stu-gr-head"><div class="stu-gr-head-text"><h2 class="stu-gr-title">Grades</h2>' +
      '</div>' +
      '<a class="stu-gr-open" role="link" tabindex="0" data-href="/gradebook?course=' +
      ctx.cid +
      '">Open in Gradebook</a></div>' +
      _grCourseHtml(ctx) +
      _grControlsHtml(ov, ctx) +
      '<div class="stu-gr-list">' +
      _grGroupsHtml(ov, ctx) +
      '</div><p class="stu-gr-foot">Class averages are off unless you turn them on: a grade compares a student to the criteria, not to classmates.</p></div>'
    );
  }

  /* A shared rubric as a table: a criterion per row, an assessment per
     column (oldest first), each cell the level as scored, then Start to
     Now and the average. */
  function _rubricTableHtml(ctx, g) {
    var cid = ctx.cid;
    var list = g.assessments.slice().sort(function (x, y) {
      return (x.date || '').localeCompare(y.date || '');
    });
    var cols = 'grid-template-columns:minmax(150px,1.2fr) repeat(' + list.length + ',minmax(72px,1fr)) 110px 90px';
    // A criterion's average over the scored assessments, each counted its
    // Factor times, as every level average is (DECISIONS "Assessment Factor").
    var factors = list.map(getAssessmentWeight);
    var mean = function (vals) {
      var sum = 0;
      var total = 0;
      vals.forEach(function (v, i) {
        if (v == null) return;
        sum += factors[i] * v;
        total += factors[i];
      });
      return total > 0 ? sum / total : null;
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
    html += '<span role="columnheader" class="stu-rt-center">Start to Now</span>';
    html += '<span role="columnheader" class="stu-rt-right">Average</span></div>';
    (g.rubric.criteria || []).filter(Boolean).forEach(function (crit) {
      var vals = list.map(function (a) {
        return rubricCriterionLevel(cid, studentId, a, crit);
      });
      var points = [];
      vals.forEach(function (v, i) {
        var t = _dayNum(list[i].date);
        if (v != null && t != null) points.push({ t: t, v: v });
      });
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
      html += '<span role="cell" class="stu-rt-center">' + _startNowHtml(cid, points) + '</span>';
      html +=
        '<span role="cell" class="stu-rt-avg"><strong>' + esc(formatLevel(cid, mean(vals))) + '</strong></span></div>';
    });
    html += '</div></div>';
    return html;
  }

  /* A competency's goal: what it is, when it was set, and its editor (ids are
     what editGoal / saveGoalField use). `compact` leaves only the button. */
  function _goalBlockHtml(ctx, sec, goalText, setOn, compact) {
    var first = displayNameFirst(ctx.student);
    return (
      '<div class="section-goal stu-goal-part' +
      (compact ? ' compact' : '') +
      '" id="goal-' +
      sec.id +
      '">' +
      (compact
        ? ''
        : '<div class="stu-goal-label"><span>Goal' +
          (setOn ? ' · Set ' + esc(_shortDay(setOn)) : '') +
          '</span><button type="button" class="stu-chip" data-action="editGoal" data-secid="' +
          sec.id +
          '">Edit</button></div>') +
      '<div class="section-goal-text" id="goal-text-' +
      sec.id +
      '">' +
      (compact
        ? '<button type="button" class="stu-chip" data-action="editGoal" data-secid="' + sec.id + '">+ Goal</button>'
        : esc(goalText)) +
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
      '</div></div></div>'
    );
  }

  /* The student's own words on a competency, and their editor. */
  function _reflBlockHtml(ctx, sec, refl, compact) {
    var first = displayNameFirst(ctx.student);
    var confLabel = refl.confidence ? CONFIDENCE_LABELS[refl.confidence] || '' : '';
    var confColor = refl.confidence ? CONFIDENCE_COLORS[refl.confidence] || '#bbb' : '';
    var hasRefl = !!(refl.text || refl.confidence);
    return (
      '<div class="section-reflection stu-goal-part' +
      (compact ? ' compact' : '') +
      '" id="refl-' +
      sec.id +
      '">' +
      (compact
        ? ''
        : '<div class="stu-goal-label"><span>In ' +
          esc(first) +
          '’s Words' +
          (confLabel
            ? ' <span class="confidence-badge" style="background:' + confColor + '">' + confLabel + '</span>'
            : '') +
          '</span><button type="button" class="stu-chip" data-action="editReflection" data-secid="' +
          sec.id +
          '">' +
          (hasRefl ? 'Edit' : '+ Self-Reflection') +
          '</button></div>') +
      '<div class="section-reflection-text" id="refl-text-' +
      sec.id +
      '">' +
      (compact
        ? '<button type="button" class="stu-chip" data-action="editReflection" data-secid="' +
          sec.id +
          '">+ Reflection</button>'
        : (refl.text ? esc(refl.text) : '<span class="stu-muted">No self-reflection yet.</span>') +
          (refl.date ? '<div class="stu-sub">' + formatDate(refl.date) + '</div>' : '')) +
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
      '’s own words about this competency…">' +
      esc(refl.text || '') +
      '</textarea>' +
      '<div class="inline-edit-actions">' +
      '<button class="btn btn-primary" data-action="saveReflField" data-secid="' +
      sec.id +
      '">Save</button>' +
      '<button class="btn" data-action="cancelReflEdit" data-secid="' +
      sec.id +
      '">Cancel</button>' +
      '</div></div></div>'
    );
  }

  /* The student's answers as the Learner Profile reads them, once the class's
     questionnaires and responses are in (a redraw follows when they arrive). */
  var _EMPTY_VOICE = { about: null, checkin: null, reflections: [], last: null };
  var VOICE_FRESH_MS = 15000;
  function _voiceModel(cid) {
    if (typeof StudentVoice === 'undefined') return _EMPTY_VOICE;
    var redraw = function (loadedCid) {
      if (loadedCid === activeCourse) render();
    };
    if (!StudentVoice.loaded(cid)) {
      StudentVoice.load(cid, redraw);
      if (!StudentVoice.loaded(cid)) return _EMPTY_VOICE;
    } else if (StudentVoice.refreshIfStale) {
      // Answers sent since the last read show when the page opens again:
      // redrawn only when this student's answers changed, and never under
      // a box being typed in.
      var sid = studentId;
      var sig = function () {
        return StudentVoice.entries(cid, sid)
          .map(function (e) {
            return e.rid + '@' + e.at;
          })
          .join('|');
      };
      var was = sig();
      StudentVoice.refreshIfStale(cid, VOICE_FRESH_MS, function (loadedCid) {
        if (loadedCid !== activeCourse || sid !== studentId || sig() === was) return;
        var a = document.activeElement;
        if (a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) return;
        render();
      });
    }
    return StudentVoice.profile(StudentVoice.entries(cid, studentId));
  }

  // Reflect on Feedback as the Learner Profile shows it, once a draw (null while it is off).
  function _feedbackOf(ctx) {
    if (!('fb' in ctx)) ctx.fb = LearnerProfile.feedbackOf(ctx.cid, studentId);
    return ctx.fb;
  }

  /* A competency goal's editor (ids are what editGoal / saveGoalField use). */
  function _goalEditorHtml(ctx, sec, goalText) {
    return (
      '<div class="inline-edit-area" id="goal-edit-' +
      sec.id +
      '" style="display:none"><textarea id="goal-input-' +
      sec.id +
      '" aria-label="Goal for ' +
      esc(sec.name) +
      '" placeholder="What will ' +
      esc(displayNameFirst(ctx.student)) +
      ' work on next?">' +
      esc(goalText) +
      '</textarea><div class="inline-edit-actions"><button class="btn btn-primary" data-action="saveGoalField" data-secid="' +
      sec.id +
      '">Save</button><button class="btn" data-action="cancelGoalEdit" data-secid="' +
      sec.id +
      '">Cancel</button>' +
      (goalText
        ? '<button type="button" class="btn btn-danger stu-goal-remove" data-action="removeGoal" data-secid="' +
          sec.id +
          '">Remove Goal</button>'
        : '') +
      '</div></div>'
    );
  }

  function _reflEditorHtml(ctx, sec, refl) {
    var first = displayNameFirst(ctx.student);
    return (
      '<div class="inline-edit-area" id="refl-edit-' +
      sec.id +
      '" style="display:none"><select id="refl-conf-' +
      sec.id +
      '" aria-label="Confidence level"><option value="">Confidence level…</option>' +
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
      '</select><textarea id="refl-input-' +
      sec.id +
      '" aria-label="Self-reflection for ' +
      esc(sec.name) +
      '" placeholder="' +
      esc(first) +
      '’s own words about this competency…">' +
      esc(refl.text || '') +
      '</textarea><div class="inline-edit-actions"><button class="btn btn-primary" data-action="saveReflField" data-secid="' +
      sec.id +
      '">Save</button><button class="btn" data-action="cancelReflEdit" data-secid="' +
      sec.id +
      '">Cancel</button></div></div>'
    );
  }

  /* Competency goals (canvas 9d): a card for each competency with your goal
     or the student's words side by side; the rest in one No Goal Yet list. */
  function _compGoalsHtml(ctx, showEmpty) {
    var cid = ctx.cid;
    var first = displayNameFirst(ctx.student);
    var goals = getGoals(cid)[studentId] || {};
    var reflections = getReflections(cid)[studentId] || {};
    var dates = (typeof getGoalDates === 'function' ? getGoalDates(cid)[studentId] : null) || {};
    var full = [];
    var rest = [];
    ctx.sections.forEach(function (sec) {
      var refl = reflections[sec.id] || {};
      (goals[sec.id] || refl.text || refl.confidence ? full : rest).push(sec);
    });
    var html = '';
    full.forEach(function (sec) {
      var goalText = goals[sec.id] || '';
      var refl = reflections[sec.id] || {};
      var setOn = goalText ? dates[sec.id] : null;
      var conf = refl.confidence ? CONFIDENCE_LABELS[refl.confidence] || '' : '';
      html +=
        '<div class="gl-card lp2-goal lp2-compgoal"><div class="gl-top"><div class="gl-title">' +
        esc(sec.name) +
        '</div>' +
        _levelPill(cid, getSectionProficiency(cid, studentId, sec.id)) +
        '</div><div class="gl-pair"><div id="goal-' +
        sec.id +
        '">' +
        (goalText
          ? '<div class="qw-q qw-q-flush">' +
            LearnerProfile.src('you', first) +
            ' Goal' +
            (setOn ? ' · ' + esc(_shortDay(setOn)) : '') +
            ' <button type="button" class="stu-chip" data-action="editGoal" data-secid="' +
            sec.id +
            '">Edit</button></div><div class="gl-answer" id="goal-text-' +
            sec.id +
            '">' +
            esc(goalText) +
            '</div>'
          : '<div id="goal-text-' +
            sec.id +
            '"><button type="button" class="stu-chip" data-action="editGoal" data-secid="' +
            sec.id +
            '">+ Goal</button></div>') +
        _goalEditorHtml(ctx, sec, goalText) +
        '</div><div id="refl-' +
        sec.id +
        '">' +
        (refl.text || refl.confidence
          ? '<figure class="qw"><figcaption class="qw-q qw-q-flush">' +
            LearnerProfile.src('them', first) +
            ' How confident?' +
            (conf ? ' · ' + esc(conf) : '') +
            ' <button type="button" class="stu-chip" data-action="editReflection" data-secid="' +
            sec.id +
            '">Edit</button></figcaption><div id="refl-text-' +
            sec.id +
            '">' +
            (refl.text ? LearnerProfile.bubble(refl.text) : '<div class="gl-none">No answer</div>') +
            '</div></figure>'
          : '<div id="refl-text-' +
            sec.id +
            '"><button type="button" class="stu-chip" data-action="editReflection" data-secid="' +
            sec.id +
            '">+ Reflection</button></div>') +
        _reflEditorHtml(ctx, sec, refl) +
        '</div></div></div>';
    });
    if (rest.length) {
      // The competencies with no goal or reflection fold into one line, so
      // the goals that exist lead (the redesign's Goals list).
      html +=
        (full.length || !showEmpty ? '' : '<div class="lp-none">No goals yet.</div>') +
        '<details class="gl-card gl-rest"><summary class="gl-top"><span class="gl-title">Add a Goal or Reflection</span><span class="gl-meta">' +
        esc(_plural(rest.length, 'competency', 'competencies') + ' with none yet') +
        '</span></summary><div class="gl-rows">';
      rest.forEach(function (sec) {
        html +=
          '<div class="gl-row"><strong>' +
          esc(sec.name) +
          '</strong>' +
          _levelPill(cid, getSectionProficiency(cid, studentId, sec.id)) +
          '<span class="gl-adds">' +
          _goalBlockHtml(ctx, sec, '', null, true) +
          _reflBlockHtml(ctx, sec, {}, true) +
          '</span></div>';
      });
      html += '</div></details>';
    }
    if (!ctx.sections.length) html += '<div class="lp-none">This class has no competencies yet.</div>';
    return html;
  }

  /* Each learning disposition on one timeline, a dot per observation tagged
     with it (it opens the observation); the ones not seen yet in one row. */
  /* One 1–4 scale (design rule 5): the teacher's level filled in its
     colour, or the student's own rating as the outline variant. */
  function _lpScaleHtml(level, own, label) {
    var lvl = Math.max(0, Math.min(4, level || 0));
    var html = '<span class="lp-scale' + (own ? ' own' : '') + '" role="img" aria-label="' + esc(label) + '">';
    for (var n = 1; n <= 4; n++) {
      var on = n <= lvl;
      html +=
        '<span class="lp-scale-cell' +
        (on ? ' on' : '') +
        '"' +
        (on && !own ? ' style="background:' + (PROF_COLORS[lvl] || PROF_COLORS[0]) + '"' : '') +
        '></span>';
    }
    return html + '</span>';
  }

  /* How the student sees their learning (redesign R6): each competency the
     student rated in a reflection, their rating beside the teacher's level.
     A step apart is something to talk about. */
  function _calibrationHtml(ctx) {
    var cid = ctx.cid;
    var first = displayNameFirst(ctx.student);
    var mine = getReflections(cid)[studentId] || {};
    var rows = [];
    ctx.sections.forEach(function (sec) {
      var r = mine[sec.id];
      var self = r && Number(r.confidence);
      if (!(self >= 1 && self <= 4)) return;
      var v = getSectionProficiency(cid, studentId, sec.id);
      var teach = v > 0 ? Math.max(1, Math.min(4, roundLevel(v))) : 0;
      var d = teach ? self - teach : 0;
      rows.push({
        sec: sec,
        self: self,
        teach: teach,
        v: v,
        note: !teach
          ? 'No level from you yet.'
          : d >= 1
            ? 'Rates themselves higher. Ask what they’d point to.'
            : d <= -1
              ? 'Rates themselves lower. Show them the evidence.'
              : 'You agree.',
        talk: !!teach && d !== 0,
      });
    });
    var html =
      '<section class="qw-sec" id="lp-calib" aria-labelledby="lp-calib-h"><div class="qw-head"><h2 id="lp-calib-h">How ' +
      esc(first) +
      ' Sees Their Learning</h2></div>' +
      '<p class="lp-calib-lede">' +
      esc(first) +
      '’s own rating beside your level. A gap is something to talk about.</p>';
    // Not rated yet: every other competency, with your level, so the table
    // shows in any class; folded away when there are many.
    var unrated = [];
    ctx.sections.forEach(function (sec) {
      var r = mine[sec.id];
      var self = r && Number(r.confidence);
      if (self >= 1 && self <= 4) return;
      unrated.push({ sec: sec, v: getSectionProficiency(cid, studentId, sec.id) });
    });
    html +=
      '<div class="lp-calib" role="table" aria-label="' +
      esc(first + '’s rating beside your level') +
      '"><div class="lp-calib-row lp-calib-head" role="row"><span role="columnheader">Competency</span><span role="columnheader">' +
      esc(first) +
      ' Says</span><span role="columnheader">Your Level</span><span role="columnheader"><span class="help-sr-only">Note</span></span></div>';
    rows.forEach(function (x) {
      html +=
        '<div class="lp-calib-row" role="row"><span class="lp-calib-name" role="cell">' +
        esc(x.sec.name) +
        '</span><span role="cell">' +
        _lpScaleHtml(x.self, true, first + ' says ' + (CONFIDENCE_LABELS[x.self] || x.self)) +
        '<span class="lp-calib-word">' +
        esc(CONFIDENCE_LABELS[x.self] || '') +
        '</span></span><span role="cell">' +
        (x.teach
          ? _lpScaleHtml(x.teach, false, 'Your level ' + formatLevel(cid, x.v)) +
            '<span class="lp-calib-word">' +
            esc(formatLevel(cid, x.v)) +
            '</span>'
          : '<span class="lp-calib-word">Not yet</span>') +
        '</span><span class="lp-calib-note' +
        (x.talk ? ' talk' : '') +
        '" role="cell">' +
        esc(x.note) +
        '</span></div>';
    });
    var unratedHtml = unrated
      .map(function (x) {
        var teach = x.v > 0 ? Math.max(1, Math.min(4, roundLevel(x.v))) : 0;
        return (
          '<div class="lp-calib-row lp-calib-unrated" role="row"><span class="lp-calib-name" role="cell">' +
          esc(x.sec.name) +
          '</span><span role="cell">' +
          _lpScaleHtml(0, true, first + ' has not rated this yet') +
          '<span class="lp-calib-word">Not rated yet</span></span><span role="cell">' +
          (teach
            ? _lpScaleHtml(teach, false, 'Your level ' + formatLevel(cid, x.v)) +
              '<span class="lp-calib-word">' +
              esc(formatLevel(cid, x.v)) +
              '</span>'
            : '<span class="lp-calib-word">Not yet</span>') +
          '</span><span class="lp-calib-note" role="cell">Ask ' +
          esc(first) +
          ' to rate it in a reflection.</span></div>'
        );
      })
      .join('');
    if (unrated.length && (rows.length || unrated.length > 8))
      html +=
        '<details class="lp-calib-more"><summary>' +
        esc(_plural(unrated.length, 'competency', 'competencies') + ' not rated yet') +
        '</summary>' +
        unratedHtml +
        '</details>';
    else html += unratedHtml;
    return html + '</div></section>';
  }

  /* ── Learner Profile tab (canvas 9d) ────────────────────── */
  /* The ID card beside the student's own words: About Me, Goals (theirs and
     the competency goals), Reflections; then what observations show and the
     Core Competency self-assessments by term. */
  /* ── Learner Profile, as the redesign's board draws it (R6) ──────
     Who: the student's card and their private note. In their words beside
     their goals. How they see their learning. The Core Competencies, term
     by term. How they learn. Then their reflections. */

  function _lpWhoHtml(ctx, o) {
    var a = o.model.about;
    var say = a && LearnerProfile.text(a.say && a.say.v);
    var meta = [o.pronouns, o.grade ? 'Grade ' + o.grade : '', o.classLabel].filter(Boolean);
    var answered = [];
    if (a && a.at) answered.push('Answered About Me ' + LearnerProfile.day(a.at));
    if (o.model.checkin && o.model.checkin.at) answered.push('Goal Check-In ' + LearnerProfile.day(o.model.checkin.at));
    var note = LearnerProfile.privateNote(o);
    return (
      '<div class="lp2-who"><div class="lp2-card"><div class="lp2-av" aria-hidden="true">' +
      esc(o.initials) +
      '</div><div class="lp2-id"><h2 class="lp2-name" id="lp-title">' +
      esc(displayNameWithLast(ctx.student)) +
      '</h2>' +
      (meta.length ? '<div class="lp2-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
      (say ? '<div class="lp2-meta id-say">Say it ' + LearnerProfile.sayHtml(say) + '</div>' : '') +
      (answered.length ? '<div class="lp2-sub">' + esc(answered.join(' · ')) + '</div>' : '') +
      '</div></div>' +
      '<div class="lp2-note"><div class="lp2-note-head">' +
      (typeof LINE_ICONS !== 'undefined' ? LINE_ICONS.lock : '') +
      'Private Note · only you see it</div>' +
      (note
        ? '<div class="lp2-note-text id-private-text">' + esc(note) + '</div>'
        : '<div class="lp2-note-text lp2-quiet">' +
          esc(_lpFirst(ctx) + ' hasn’t left you a note. A note comes from the About Me questionnaire.') +
          '</div>') +
      '</div></div>'
    );
  }

  function _lpFirst(ctx) {
    return displayNameFirst(ctx.student);
  }

  function _lpWordsHtml(o) {
    var a = o.model.about;
    var items = LearnerProfile.wordsItems(o);
    var html =
      '<section class="qw-sec lp2-sec" id="lp-about" aria-labelledby="lp-about-h"><h3 class="lp2-h3" id="lp-about-h">In ' +
      esc(o.first) +
      '’s Words</h3>';
    if (!a)
      return (
        html +
        '<p class="lp2-lede">' +
        (o.aboutOn
          ? esc(o.first) + ' hasn’t answered About Me yet.'
          : 'About Me isn’t turned on for this class. Turn it on in ' +
            '<a class="lp-link" role="link" tabindex="0" data-href="/dashboard?course=' +
            esc(encodeURIComponent(o.cid)) +
            '&amp;manage=questionnaires">Class Settings › Questionnaires</a>.') +
        '</p></section>'
      );
    html += '<p class="lp2-lede">From the About Me questionnaire, ' + esc(LearnerProfile.day(a.at)) + '.</p>';
    if (!items.length) return html + '<p class="lp2-quiet">No answers written yet.</p></section>';
    html += '<div class="lp2-words">';
    items.forEach(function (it) {
      html +=
        '<div class="lp2-word"><div class="lp2-q">' +
        esc(it.q) +
        '</div><div class="lp2-bubble">' +
        esc(it.t) +
        '</div></div>';
    });
    return html + '</div></section>';
  }

  function _lpGoalsHtml(ctx, o) {
    var own = LearnerProfile.studentGoals(o);
    var html =
      '<section class="qw-sec lp2-sec" id="lp-goals" aria-labelledby="lp-goals-h"><div class="lp2-head"><h3 class="lp2-h3" id="lp-goals-h">Goals</h3>' +
      '<button type="button" class="btn btn-primary lp2-add" data-action="lpAddGoal">Add Goal</button></div>' +
      '<div class="lp2-goals">';
    own.forEach(function (g) {
      html +=
        '<div class="gl-card lp2-goal"><div class="lp2-goal-top">' +
        LearnerProfile.src('them', o.first) +
        '<span class="lp2-goal-comp">' +
        esc(g.comp) +
        '</span></div><div class="lp2-goal-text">' +
        esc(g.text) +
        '</div><div class="lp2-goal-foot">' +
        LearnerProfile.statusHtml(g.status) +
        (g.when ? '<span class="lp2-when">' + esc(g.when) + '</span>' : '') +
        '</div></div>';
    });
    html += _compGoalsHtml(ctx, !own.length);
    return html + '</div></section>';
  }

  /* How they learn: each disposition seen in observations, with how often;
     the ones not seen yet in orange. */
  function _lpLearnsHtml(ctx) {
    var name = _lpFirst(ctx);
    var groups = [
      { name: 'Learning Dispositions', dims: LEARNING_DIMS },
      { name: 'Relational and Identity', dims: RELATIONAL_DIMS },
    ];
    var html =
      '<section class="qw-sec lp2-sec" id="lp-dispositions" aria-labelledby="lp-disp-h"><h3 class="lp2-h3" id="lp-disp-h">How ' +
      esc(name) +
      ' Learns</h3><p class="lp2-lede">Counted from your ' +
      _plural(ctx.obs.length, 'observation', 'observations') +
      (ctx.term ? ' this term' : '') +
      '. <a class="lp-link" role="link" tabindex="0" data-action="stuTab" data-tab="evidence">See them on Observations</a></p>' +
      '<div class="lp2-learns">';
    groups.forEach(function (g) {
      html += '<div class="stu-profile-group lp2-learn-group"><h3>' + esc(g.name) + '</h3><div class="lp2-chips">';
      g.dims.forEach(function (d) {
        var n = ctx.obs.filter(function (o) {
          return (o.dims || []).indexOf(d) >= 0;
        }).length;
        html +=
          '<span class="lp2-chip' +
          (n ? '' : ' none') +
          '">' +
          esc(OBS_LABELS[d] || d) +
          ' <strong>' +
          (n ? esc(_plural(n, 'time', 'times')) : 'Not seen yet') +
          '</strong></span>';
      });
      html += '</div></div>';
    });
    return html + '</div></section>';
  }

  function _profileTabHtml(ctx) {
    var cid = ctx.cid;
    var course = COURSES[cid] || {};
    var first = displayNameFirst(ctx.student);
    var model = ctx.voice;
    var goals = getGoals(cid)[studentId] || {};
    var block = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    var o = {
      cid: cid,
      model: model,
      first: first,
      initials: initials(ctx.student),
      classLabel: (course.name || '') + (block ? ' · ' + block : ''),
      grade: course.gradeLevel || '',
      pronouns: ctx.student.pronouns || '',
      courseName: course.name || 'Course',
      compRefl: LearnerProfile.compReflections(cid, studentId, ctx.sections),
      aboutOn:
        typeof Questionnaires !== 'undefined' &&
        Questionnaires.list(cid).some(function (q) {
          return q.kind === 'about_me' && q.is_on;
        }),
      goalCount:
        LearnerProfile.goalCount(model) +
        ctx.sections.filter(function (sec) {
          return !!(goals[sec.id] || '').trim();
        }).length,
      // Reflect on Feedback (S10-F4), or null while it is off.
      feedback: _feedbackOf(ctx),
    };
    var waiting = !!(o.feedback && o.feedback.waiting > 0);
    return (
      '<div class="lp2 lp-layout">' +
      _lpWhoHtml(ctx, o) +
      // A question from the student waiting for an answer leads (S10-F4).
      (waiting ? LearnerProfile.feedbackAsideHtml(o) + LearnerProfile.feedbackHtml(o) : '') +
      '<div class="lp2-pair">' +
      _lpWordsHtml(o) +
      _lpGoalsHtml(ctx, o) +
      '</div>' +
      _calibrationHtml(ctx) +
      '<section class="qw-sec lp2-sec" id="lp-core" aria-labelledby="lp-core-h">' +
      _coreSelfHtml(ctx, true) +
      '</section>' +
      _lpLearnsHtml(ctx) +
      // Reflect on Feedback (S10-F4): Working On and the reflections, while it is on.
      (waiting ? '' : LearnerProfile.feedbackAsideHtml(o) + LearnerProfile.feedbackHtml(o)) +
      LearnerProfile.reflectionsHtml(o) +
      '<p class="lp-foot">' +
      esc(first) +
      '’s own words and your private note never appear on the Overview or in Full Screen.</p>' +
      '</div>'
    );
  }

  /* Answer in the Grader: the grader on this student's piece, this student
     only. Closing it draws the profile again, so an answered question
     clears here, if this student's Learner Profile is still the page shown. */
  function _answerInGrader(aid) {
    var cid = activeCourse;
    var sid = studentId;
    if (!aid || !window.PageAssignments || !PageAssignments.openGrader) return;
    PageAssignments.openGrader(cid, aid, sid, {
      studentIds: [sid],
      onClose: function () {
        if (
          activeCourse === cid &&
          studentId === sid &&
          _tab === 'profile' &&
          document.querySelector('#main .lp-layout')
        )
          render();
      },
    });
  }

  function _saveCoreSelf(coreId, clear) {
    var picked = document.querySelector('input[name="core-level-' + coreId + '"]:checked');
    var text = document.getElementById('core-text-' + coreId);
    var goal = document.getElementById('core-goal-' + coreId);
    var tk = coreSelfTerm(
      activeCourse,
      _coreTerm,
      typeof getActiveTerm === 'function' ? getActiveTerm(activeCourse) : null,
    );
    saveCoreSelfAssessment(
      activeCourse,
      studentId,
      tk.key,
      coreId,
      clear
        ? null
        : { level: picked ? Number(picked.value) : null, text: text ? text.value : '', goal: goal ? goal.value : '' },
    );
    _coreEditing = '';
    render();
  }

  /* The Core Competencies in the student's own words: their step on
     Beginning / Growing / Confident / Leading, what they say, and their goal,
     by reporting term. Never a teacher's grade (BC: students self-assess the
     Core Competencies). The work tagged with each is evidence to point to. */
  var CORE_STEPS = [1, 2, 3, 4];

  function _coreSelfHtml(ctx, inSection) {
    var cid = ctx.cid;
    var first = displayNameFirst(ctx.student);
    // The term picked here, else the term in view, else today's
    // (shared/core-self.js; the dashboard's Core Competencies card reads the same).
    var tk = coreSelfTerm(cid, _coreTerm, ctx.term);
    var mine = ((typeof getCoreSelf === 'function' ? getCoreSelf(cid)[studentId] : null) || {})[tk.key] || {};
    // What the student gave in that term's questionnaire, where you haven't
    // entered anything yourself.
    var theirs =
      tk.pick && typeof StudentVoice !== 'undefined' && StudentVoice.coreSelf && StudentVoice.loaded(cid)
        ? StudentVoice.coreSelf(StudentVoice.entries(cid, studentId), tk.pick.ordinal)
        : {};
    // Scored work tagged with each Core Competency: evidence to point to.
    var tally = {};
    ctx.assessments.forEach(function (a) {
      if (!(a.coreCompetencyIds && a.coreCompetencyIds.length)) return;
      var hasScore = ctx.allScores.some(function (s) {
        return s.assessmentId === a.id && s.score > 0;
      });
      if (!hasScore) return;
      a.coreCompetencyIds.forEach(function (id) {
        tally[id] = (tally[id] || 0) + 1;
      });
    });
    // In the Learner Profile the section heading names it; the term's status
    // (how many the student has answered, or when it is due) and the picker stay.
    var answered = CORE_COMPETENCIES.filter(function (cc) {
      var e = mine[cc.id] || theirs[cc.id];
      return !!(e && e.level);
    }).length;
    var termName = tk.pick ? tk.pick.label || 'Term ' + tk.pick.ordinal : '';
    var due = tk.pick && (tk.pick.ends_on || tk.pick.endsOn);
    var status = !termName
      ? ''
      : answered === CORE_COMPETENCIES.length
        ? termName + ': all ' + answered + ' answered.'
        : answered
          ? termName + ': ' + answered + ' of ' + CORE_COMPETENCIES.length + ' answered.'
          : termName + ': not answered yet.' + (due ? ' Due with reports on ' + _shortDay(due) + '.' : '');
    var html =
      '<div class="stu-core-head">' +
      (inSection
        ? '<div><h3 class="lp2-h3" id="lp-core-h">Core Competencies</h3><p class="lp2-lede">' +
          esc(first) +
          '’s self-assessment, as BC reporting asks each term. <span class="stu-core-status' +
          (answered ? '' : ' none') +
          '">' +
          esc(status) +
          '</span></p></div>'
        : '<h3>Core Competencies · In ' + esc(first) + '’s Words</h3>');
    if (tk.terms.length) {
      html += '<div class="seg seg-sm" role="radiogroup" aria-label="Term">';
      tk.terms.forEach(function (t) {
        var on = t === tk.pick;
        html +=
          '<button type="button" class="seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="stuCoreTerm" data-ordinal="' +
          t.ordinal +
          '">' +
          esc(t.label || 'Term ' + t.ordinal) +
          '</button>';
      });
      html += '</div>';
    }
    if (inSection) {
      html +=
        '</div><div class="stu-core-table lp2-core"><div class="lp2-core-row lp2-core-thead" aria-hidden="true"><span>Core Competency</span>' +
        CORE_STEPS.map(function (lv) {
          return '<span class="lp2-core-col">' + esc(CONFIDENCE_LABELS[lv]) + '</span>';
        }).join('') +
        '<span>Work to Point To</span></div>';
      CORE_COMPETENCIES.forEach(function (cc) {
        var e = mine[cc.id] || theirs[cc.id];
        var editing = _coreEditing === cc.id;
        var n = tally[cc.id] || 0;
        html +=
          '<div class="stu-core-trow lp2-core-item"><div class="lp2-core-row"><span class="stu-core-cname"><strong>' +
          esc(cc.label) +
          '</strong><span class="stu-sub">' +
          esc(cc.group) +
          '</span></span>';
        CORE_STEPS.forEach(function (lv) {
          var on = !!(e && !editing && e.level === lv);
          html +=
            '<span class="lp2-core-col">' +
            (on
              ? '<span class="stu-core-step on lp2-core-chip" data-step="' +
                esc(CONFIDENCE_LABELS[lv]) +
                '" aria-label="' +
                esc(first + ' chose ' + CONFIDENCE_LABELS[lv]) +
                '">' +
                esc(first) +
                '</span>'
              : '<span class="lp2-core-dot" aria-hidden="true"></span>') +
            '</span>';
        });
        html +=
          '<span class="stu-core-work' +
          (n ? '' : ' none') +
          '">' +
          (n ? esc(_plural(n, 'assessment', 'assessments')) : 'None tagged yet') +
          (editing
            ? ''
            : ' <button type="button" class="stu-chip" data-action="stuCoreEdit" data-core="' +
              cc.id +
              '">' +
              (e ? 'Edit' : '+ Self-Assessment') +
              '</button>') +
          '</span></div>';
        if (e && !editing && (e.text || e.goal || e.fromStudent))
          html +=
            '<div class="lp2-core-words">' +
            (e.text ? '<div class="lp2-bubble stu-core-words">' + esc(e.text) + '</div>' : '') +
            (e.goal ? '<div class="lp2-core-goal"><strong>Goal:</strong> ' + esc(e.goal) + '</div>' : '') +
            (e.fromStudent
              ? '<span class="stu-core-from">' +
                LearnerProfile.src('them', first) +
                ' ' +
                esc(_shortDay(e.at)) +
                '</span>'
              : '') +
            '</div>';
        if (editing) html += _coreEditHtml(first, cc, e || {});
        html += '</div>';
      });
      return html + '</div>';
    }
    html +=
      '</div><div class="stu-core-table"><div class="stu-core-trow stu-core-thead" aria-hidden="true"><span>Core Competency</span><span>' +
      esc(first) +
      '’s Self-Assessment</span><span>' +
      esc(first) +
      '’s Goal</span><span>Work to Point To</span></div>';
    CORE_COMPETENCIES.forEach(function (cc) {
      var e = mine[cc.id] || theirs[cc.id];
      var editing = _coreEditing === cc.id;
      var n = tally[cc.id] || 0;
      html +=
        '<div class="stu-core-trow"><span class="stu-core-cname"><strong>' +
        esc(cc.label) +
        '</strong><span class="stu-sub">' +
        esc(cc.group) +
        '</span></span>';
      if (e && !editing) {
        html +=
          '<span class="stu-core-self"><span class="stu-core-steps" role="img" aria-label="' +
          esc(first + ' chose ' + (CONFIDENCE_LABELS[e.level] || 'no step')) +
          '">';
        CORE_STEPS.forEach(function (lv) {
          html +=
            '<span class="stu-core-step' +
            (e.level === lv ? ' on lv-' + lv : '') +
            '">' +
            esc(CONFIDENCE_LABELS[lv]) +
            '</span>';
        });
        html +=
          '</span>' +
          (e.text ? '<span class="stu-core-words">' + esc(e.text) + '</span>' : '') +
          (e.fromStudent
            ? '<span class="stu-core-from">' +
              LearnerProfile.src('them', first) +
              ' ' +
              esc(_shortDay(e.at)) +
              '</span>'
            : '') +
          '</span><span class="stu-core-goal">' +
          (e.goal ? esc(e.goal) : '<span class="stu-muted">—</span>') +
          '</span>';
      } else if (!editing) {
        html +=
          '<span><button type="button" class="stu-chip" data-action="stuCoreEdit" data-core="' +
          cc.id +
          '">+ Self-Assessment</button></span><span class="stu-muted">—</span>';
      } else {
        html += '<span></span><span></span>';
      }
      html +=
        '<span class="stu-core-work' +
        (n ? '' : ' none') +
        '">' +
        (n ? esc(_plural(n, 'assessment', 'assessments')) : 'None tagged yet') +
        (e && !editing
          ? ' <button type="button" class="stu-chip" data-action="stuCoreEdit" data-core="' + cc.id + '">Edit</button>'
          : '') +
        '</span></div>';
      if (editing) html += _coreEditHtml(first, cc, e || {});
    });
    return html + '</div>';
  }

  function _coreEditHtml(first, cc, e) {
    var html =
      '<div class="stu-core-edit" data-core="' +
      cc.id +
      '"><fieldset class="stu-core-scale"><legend>' +
      esc(first) +
      '’s step on ' +
      esc(cc.label) +
      '</legend>';
    CORE_STEPS.forEach(function (lv) {
      html +=
        '<label class="stu-core-pick"><input type="radio" name="core-level-' +
        cc.id +
        '" value="' +
        lv +
        '"' +
        (e.level === lv ? ' checked' : '') +
        '><span>' +
        esc(CONFIDENCE_LABELS[lv]) +
        '</span></label>';
    });
    return (
      html +
      '</fieldset><label class="stu-core-field"><span>In ' +
      esc(first) +
      '’s words</span><textarea id="core-text-' +
      cc.id +
      '" placeholder="What ' +
      esc(first) +
      ' says about this">' +
      esc(e.text || '') +
      '</textarea></label><label class="stu-core-field"><span>' +
      esc(first) +
      '’s goal</span><input type="text" id="core-goal-' +
      cc.id +
      '" value="' +
      esc(e.goal || '') +
      '" placeholder="What ' +
      esc(first) +
      ' will work on"></label><div class="inline-edit-actions"><button type="button" class="btn btn-primary" data-action="stuCoreSave" data-core="' +
      cc.id +
      '">Save</button><button type="button" class="btn" data-action="stuCoreCancel">Cancel</button>' +
      (!e.fromStudent && (e.level || e.text || e.goal)
        ? '<button type="button" class="btn" data-action="stuCoreClear" data-core="' + cc.id + '">Clear</button>'
        : '') +
      '</div></div>'
    );
  }

  function _isTab(id) {
    return _shownTabs().some(function (t) {
      return t.id === id;
    });
  }

  /* The last tab a teacher opened, on this device. */
  var TAB_KEY = 'gb-student-tab';
  function _savedTab() {
    try {
      var t = _tabAlias(localStorage.getItem(TAB_KEY));
      return _isTab(t) ? t : null;
    } catch (e) {
      return null;
    }
  }

  /* The address names the open tab, so a link or a reload opens it. Set in
     place: navigating would re-render the page. */
  function _syncTabToUrl() {
    Router.setUrl(
      '/student?id=' + encodeURIComponent(studentId) + '&course=' + encodeURIComponent(activeCourse) + '&tab=' + _tab,
    );
  }

  /* The students in the sidebar's order (sorted once a draw), and this one's neighbours as ‹ and ›. */
  function _stepButtonsHtml() {
    var list = sortStudents(getStudents(activeCourse), 'lastName');
    var i = list.findIndex(function (s) {
      return s.id === studentId;
    });
    return _stepButtonHtml('prev', i > 0 ? list[i - 1] : null) + _stepButtonHtml('next', i >= 0 ? list[i + 1] : null);
  }

  function _stepButtonHtml(dir, st) {
    var label = dir === 'prev' ? 'Previous student' : 'Next student';
    return (
      '<button type="button" class="stu-step-btn" data-action="stuStep" data-sid="' +
      (st ? esc(st.id) : '') +
      '"' +
      (st ? ' title="' + esc(label + ': ' + displayName(st)) + '"' : ' disabled') +
      ' aria-label="' +
      esc(st ? label + ': ' + displayName(st) : label) +
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
    if (typeof refreshStudentWork === 'function') refreshStudentWork(cid); // read now and then, as Assignments does
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
        '<a role="link" tabindex="0" data-href="/dashboard" class="btn btn-primary">Back to Dashboard</a></div>';
      return;
    }

    // Send Work turned off while the Work tab was open.
    if (!_isTab(_tab)) _tab = 'overview';
    // Every grade on this page is the year so far (Colin, 2026-11-03).
    if (typeof setActiveTerm === 'function') setActiveTerm(cid, null);
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
      renderBreadcrumb('Dashboard', '/dashboard', displayName(student)) +
      '<span class="stu-step">' +
      _stepButtonsHtml() +
      '</span>' +
      '<button class="tb-edit-btn" data-action="openEditStudent">Edit Student</button>' +
      '</div>';

    // 12px from the page's edges and between boxes, 20px at the foot.
    html += '<div class="student-scroll"><div style="padding:12px 12px 20px">';

    // ── Header ──
    html += renderStudentHeader(cid, studentId, {
      buttonLabel: 'Term Questionnaire',
      buttonHref: '/reports?course=' + cid + '&tab=questionnaire&student=' + studentId,
    });

    // ── Tabs ──
    // Every count and list below is the year so far: no report is in view
    // on this page, so term is null.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var termAssessments = assessments.filter(function (a) {
      return assessmentInYearToDate(cid, a);
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
      voice: _voiceModel(cid), // the tab's count and the Learner Profile both read it
    };
    html += _tabBarHtml(_tabSummaries(ctx));
    // Grade Breakdown's sections are cards of their own on the page.
    html += '<div class="stu-panel' + '" id="stu-panel" role="tabpanel" aria-labelledby="stu-tab-' + _tab + '">';
    if (_tab === 'overview') html += _overviewTabHtml(ctx);
    else if (_tab === 'grades') html += _gradesTabHtml(ctx);
    else if (_tab === 'work') html += WorkWall.tabHtml(cid, studentId);
    else if (_tab === 'evidence') html += Evidence.panelHtml();
    else if (_tab === 'profile') html += _profileTabHtml(ctx);
    else html += _compsTabHtml(ctx);
    html += '</div>';

    html += '</div></div>'; // close padding wrapper + scroll wrapper
    var main = document.getElementById('main');
    // A redraw on the same student and tab (a view switch, a chip, a fold)
    // keeps the page where it was and the focus on the control clicked.
    var place = _placeBefore(main);
    main.innerHTML = html;
    _placeAfter(main, place);
    // The Evidence panel and the competency drawers show the same
    // observations; a change in one redraws the other.
    Evidence.mount(activeCourse, studentId, {
      onChange: function () {
        CompetencyEvidence.refresh();
        _refreshEvidenceTile();
      },
    });
    if (_tab === 'work') WorkWall.mountTab(document.getElementById('stu-panel'), cid, studentId, { onChange: render });
    else if (window.WorkWall) WorkWall.unmountTab();
    if (window.WorkWall) WorkWall.mountPiece(document.getElementById('main'), cid, studentId);
    CompetencyEvidence.mount(activeCourse, studentId, main, {
      onAdd: function () {
        Evidence.refresh();
        _refreshEvidenceTile();
      },
    });
  }

  var _drawnFor = ''; // student and tab the page was last drawn for

  function _placeBefore(main) {
    var key = studentId + '|' + _tab;
    var same = key === _drawnFor;
    _drawnFor = key;
    if (!same) return null;
    var scroller = main.querySelector('.student-scroll');
    var active = document.activeElement;
    var ctl = active && main.contains(active) && active.dataset ? active.dataset : null;
    return {
      top: scroller ? scroller.scrollTop : 0,
      action: ctl && ctl.action ? ctl.action : '',
      data: ctl ? Object.assign({}, ctl) : null,
    };
  }

  function _placeAfter(main, place) {
    if (!place) return;
    var scroller = main.querySelector('.student-scroll');
    if (scroller) scroller.scrollTop = place.top;
    if (!place.action) return;
    var match = Array.prototype.find.call(main.querySelectorAll('[data-action="' + place.action + '"]'), function (n) {
      return Object.keys(place.data).every(function (k) {
        return n.dataset[k] === place.data[k];
      });
    });
    if (match) match.focus({ preventScroll: true });
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
      // Learner Profile, Add Goal: open the competencies with none yet.
      lpAddGoal: function () {
        var more = document.querySelector('#lp-goals details.gl-rest');
        if (!more) return;
        more.open = true;
        var btn = more.querySelector('[data-action="editGoal"]');
        if (btn) btn.focus();
      },
      stuStep: function () {
        if (el.dataset.sid) switchStudent(el.dataset.sid);
      },
      // Overview: open or close one piece of work in All Your Work.
      stuOvOpen: function () {
        var aid = el.dataset.aid || '';
        _ovOpen = _ovOpen === aid ? '' : aid;
        _ovCrit = '';
        render();
      },
      // Overview: a missing piece's Details opens its row in All Your Work.
      stuOvShow: function () {
        _ovOpen = el.dataset.aid || '';
        _ovFilter = 'all';
        _ovCrit = '';
        render();
        var row = document.getElementById('stu-ov-row-' + _ovOpen);
        if (row) {
          row.scrollIntoView({ block: 'center' });
          var btn = row.querySelector('.stu-ov-row-btn');
          if (btn) btn.focus({ preventScroll: true });
        }
      },
      stuOvFilter: function () {
        _ovFilter = el.dataset.filter || 'all';
        render();
      },
      stuCompSort: function () {
        _compSort = el.dataset.sort === 'lowest' ? 'lowest' : 'map';
        render();
        var btn = document.querySelector('.stu-cp-sort [data-sort="' + _compSort + '"]');
        if (btn) btn.focus({ preventScroll: true });
      },
      stuGrGroup: function () {
        var g = el.dataset.group;
        _grGroup = GR_GROUPS.some(function (x) {
          return x.id === g;
        })
          ? g
          : 'category';
        render();
        var btn = document.querySelector('[data-action="stuGrGroup"][data-group="' + _grGroup + '"]');
        if (btn) btn.focus({ preventScroll: true });
      },
      stuGrClass: function () {
        _grClass = !_grClass;
        render();
        var box = document.querySelector('[data-action="stuGrClass"]');
        if (box) box.focus({ preventScroll: true });
      },
      stuGrFilter: function () {
        _grFilter = el.dataset.filter || 'all';
        render();
        var btn = document.querySelector('[data-action="stuGrFilter"][data-filter="' + _grFilter + '"]');
        if (btn) btn.focus({ preventScroll: true });
      },
      stuOvShowAll: function () {
        _ovShowAll = !_ovShowAll;
        render();
      },
      stuOvCrit: function () {
        _ovCrit = el.dataset.key || '';
        render();
      },
      // Full Screen: the Overview alone, for turning the screen to the student.
      stuOvFull: function () {
        var panel = document.querySelector('.stu-ov');
        if (!panel) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else if (panel.requestFullscreen) panel.requestFullscreen();
      },
      stuCoreTerm: function () {
        _coreTerm = Number(el.dataset.ordinal);
        _coreEditing = '';
        render();
      },
      stuCoreEdit: function () {
        _coreEditing = el.dataset.core || '';
        render();
        var box = document.getElementById('core-text-' + _coreEditing);
        if (box) box.focus();
      },
      stuCoreCancel: function () {
        _coreEditing = '';
        render();
      },
      stuCoreSave: function () {
        _saveCoreSelf(el.dataset.core, false);
      },
      stuCoreClear: function () {
        _saveCoreSelf(el.dataset.core, true);
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
      // Reflections on Feedback (S10-F4): its filter, and the grader on a question.
      lpFeedbackFilter: function () {
        LearnerProfile.setFeedbackFilter(el.dataset.filter);
        render();
      },
      lpAnswerInGrader: function () {
        _answerInGrader(el.dataset.aid);
      },
      lpJump: function () {
        var to = document.getElementById(el.dataset.target);
        if (to) to.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
      saveGoalField: function () {
        saveGoalField(el.dataset.secid);
      },
      cancelGoalEdit: function () {
        cancelGoalEdit(el.dataset.secid);
      },
      removeGoal: function () {
        removeGoal(el.dataset.secid);
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
    };
    if (handlers[action]) {
      if (el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  /* In a goal or reflection box, Enter saves and Shift+Enter adds a line;
     Escape leaves it as it was, as in the observation box. */
  function _editorKeys(e) {
    var box = e.target;
    var m = box && box.tagName === 'TEXTAREA' && /^(goal|refl)-input-(.+)$/.exec(box.id || '');
    if (!m || e.isComposing) return false;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (m[1] === 'goal') saveGoalField(m[2]);
      else saveReflField(m[2]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      box.value = box.defaultValue;
      if (m[1] === 'goal') cancelGoalEdit(m[2]);
      else cancelReflEdit(m[2]);
      return true;
    }
    return false;
  }

  /* Arrow keys, Home and End move between the tabs. */
  function _handleKeydown(e) {
    if (_editorKeys(e)) return;
    var tab = e.target && e.target.closest && e.target.closest('.stu-tab');
    if (!tab) return;
    var ids = _shownTabs().map(function (t) {
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
    _shareWithEditStudent();
    _openTags = new Set();
    _coreTerm = null;
    _coreEditing = '';
    _drawnFor = '';
    // The tab the link names; a link to one observation opens Observations;
    // otherwise the tab last opened on this device.
    // Goals and Reflections is part of the Learner Profile now; old links open it.
    var asked = _tabAlias(params.tab);
    _tab = _isTab(asked) ? asked : params.ob ? 'evidence' : _savedTab() || 'overview';
    _ovOpen = '';
    _ovFilter = 'all';
    _ovShowAll = false;
    _ovCrit = '';
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
    if (window.WorkWall) WorkWall.unmountTab(true);
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    _helpers: { cpPick: _cpPick },
    init: init,
    destroy: destroy,
    render: render,
    switchStudent: switchStudent,
    openEditStudent: openEditStudent,
  };
})();
