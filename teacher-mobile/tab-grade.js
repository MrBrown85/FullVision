/* m-grade.js — Feature 3: Speed Grader */

window.MGrade = (function() {
  'use strict';

  var MC = window.MComponents;
  var _currentIdx = 0;
  var _undoStack = [];
  var _scrollRAF = null;

  /* ── Assessment Picker Screen ───────────────────────────────── */
  function renderPicker(cid) {
    var nav = MC.navBar({ id: 'grade-picker', title: 'Grade' });

    var assessments = getAssessments(cid);
    var students = getStudents(cid);
    var allScores = getScores(cid);

    // Sort by date, newest first
    var sorted = assessments.slice().sort(function(a, b) { return b.date.localeCompare(a.date); });

    // Segmented control
    var segmented = '<div class="m-segmented">' +
      '<button class="m-seg-btn m-seg-active" data-action="m-grade-seg" data-val="recent">Recent</button>' +
      '<button class="m-seg-btn" data-action="m-grade-seg" data-val="all">All</button>' +
      '<button class="m-seg-btn" data-action="m-grade-seg" data-val="ungraded">Ungraded</button>' +
    '</div>';

    var cells = '';
    if (!sorted.length) {
      cells = '<div class="m-empty"><div class="m-empty-icon">📋</div><div class="m-empty-title">No Assessments</div><div class="m-empty-subtitle">Create assessments on the desktop app</div></div>';
    } else {
      cells = '<div class="m-list" id="m-grade-list">';
      sorted.forEach(function(a) {
        var dateStr = new Date(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        var typeClass = a.type === 'summative' ? 'm-type-summative' : 'm-type-formative';
        var typeLabel = a.type === 'summative' ? 'S' : 'F';
        var tagCount = (a.tagIds || []).length;

        // Count graded students
        var gradedCount = 0;
        students.forEach(function(st) {
          var stScores = allScores[st.id] || [];
          var hasScore = stScores.some(function(s) { return s.assessmentId === a.id && s.score > 0; });
          if (hasScore) gradedCount++;
        });
        var total = students.length;
        var pct = total > 0 ? Math.min(100, Math.max(0, Math.round((gradedCount / total) * 100))) : 0;

        cells += '<div class="m-cell" data-action="m-grade-assess" data-aid="' + a.id + '">' +
          '<div class="m-cell-body">' +
            '<div class="m-cell-title">' +
              '<span class="m-type-badge ' + typeClass + '" style="margin-right:6px">' + typeLabel + '</span>' +
              MC.esc(a.title) +
            '</div>' +
            '<div class="m-cell-subtitle">' +
              '<span>' + dateStr + '</span>' +
              '<span>' + tagCount + ' tag' + (tagCount !== 1 ? 's' : '') + '</span>' +
              '<span>' + gradedCount + '/' + total + ' graded</span>' +
            '</div>' +
            '<div class="m-progress-bar"><div class="m-progress-fill" style="width:' + pct + '%"></div></div>' +
          '</div>' +
          MC.ICONS.chevronRight +
        '</div>';
      });
      cells += '</div>';
    }

    return '<div class="m-screen" id="m-screen-grade-picker">' +
      nav +
      '<div class="m-screen-content">' +
        MC.largeTitleHTML('Grade') +
        segmented + cells +
      '</div></div>';
  }

  /* ── Filter assessment list ─────────────────────────────────── */
  function filterAssessments(cid, mode) {
    var assessments = getAssessments(cid);
    var students = getStudents(cid);
    var allScores = getScores(cid);

    // Update segmented control
    document.querySelectorAll('.m-seg-btn').forEach(function(btn) {
      btn.classList.toggle('m-seg-active', btn.getAttribute('data-val') === mode);
    });

    var cells = document.querySelectorAll('#m-grade-list .m-cell');
    var now = new Date();
    var thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    cells.forEach(function(cell) {
      var aid = cell.getAttribute('data-aid');
      var a = assessments.find(function(x) { return x.id === aid; });
      if (!a) { cell.style.display = 'none'; return; }

      if (mode === 'recent') {
        cell.style.display = new Date(a.date) >= thirtyDaysAgo ? '' : 'none';
      } else if (mode === 'ungraded') {
        var gradedCount = 0;
        students.forEach(function(st) {
          var stScores = allScores[st.id] || [];
          if (stScores.some(function(s) { return s.assessmentId === a.id && s.score > 0; })) gradedCount++;
        });
        cell.style.display = gradedCount < students.length ? '' : 'none';
      } else {
        cell.style.display = '';
      }
    });
  }

  /* ── Student Card Swiper Screen ─────────────────────────────── */
  function renderSwiper(cid, aid) {
    var assessments = getAssessments(cid);
    var assessment = assessments.find(function(a) { return a.id === aid; });
    if (!assessment) return '<div class="m-screen"><div class="m-empty">Assessment not found</div></div>';

    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var allScores = getScores(cid);
    _currentIdx = 0;

    var nav = MC.navBar({
      id: 'grade-swiper',
      title: assessment.title,
      subtitle: '1 of ' + students.length,
      backLabel: 'Grade'
    });

    // Student thumbnail strip
    var thumbs = '<div class="m-thumb-strip" id="m-thumb-strip">';
    students.forEach(function(st, idx) {
      var color = MC.avatarColor(st.id);
      var initials = MC.avatarInitials(st);
      var stScores = allScores[st.id] || [];
      var isGraded = stScores.some(function(s) { return s.assessmentId === aid && s.score > 0; });
      var currentClass = idx === 0 ? ' m-thumb-current' : '';
      var gradedClass = isGraded ? ' m-thumb-graded' : '';
      thumbs += '<div class="m-thumb' + currentClass + gradedClass + '" style="background:' + color + '" data-action="m-grade-jump" data-idx="' + idx + '">' + initials + '</div>';
    });
    thumbs += '</div>';

    // Swiper cards
    var allStatuses = getAssignmentStatuses(cid);
    var swiper = '<div class="m-swiper" id="m-swiper">';
    students.forEach(function(st) {
      swiper += _renderStudentCard(cid, st, assessment, allScores, allStatuses);
    });
    swiper += '</div>';

    return '<div class="m-screen m-screen-hidden" id="m-screen-grade-swiper">' +
      nav + thumbs + swiper + '</div>';
  }

  function _renderStudentCard(cid, st, assessment, allScores, allStatuses) {
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    var stScores = allScores[st.id] || [];
    var status = allStatuses[st.id + ':' + assessment.id] || null;
    var course = typeof COURSES !== 'undefined' ? COURSES[cid] : null;
    var isPoints = course && course.gradingSystem === 'points';

    // Badges
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function(code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += ' <span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += ' <span class="m-badge m-badge-mod">MOD</span>';
      });
    }

    var header = '<div class="m-grade-student-header">' +
      '<div class="m-grade-avatar" style="background:' + color + '">' + initials + '</div>' +
      '<div><div class="m-grade-student-name">' + MC.esc(name) + badges + '</div>' +
      (st.pronouns ? '<div class="m-grade-student-sub">' + MC.esc(st.pronouns) + '</div>' : '') +
      '</div></div>';

    // Score selectors for each tag
    var tagGroups = '';
    (assessment.tagIds || []).forEach(function(tid) {
      var tag = getTagById(cid, tid);
      var sec = getSectionForTag(cid, tid);
      var tagLabel = tag ? (tag.label || tag.name || tag.id) : tid;
      var tagColor = sec ? sec.color : '#888';

      // Current score for this tag
      var existing = stScores.filter(function(s) { return s.assessmentId === assessment.id && s.tagId === tid; });
      var current = existing.length ? existing[existing.length - 1].score : null;

      if (isPoints && assessment.maxPoints) {
        // Points mode
        var rawScore = getPointsScore(cid, st.id, assessment.id);
        tagGroups += '<div class="m-score-group" data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-tid="' + tid + '">' +
          '<div class="m-score-tag-label"><span class="m-score-tag-dot" style="background:' + tagColor + '"></span>' + MC.esc(tagLabel) + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:12px">' +
            '<button class="m-score-btn" data-action="m-grade-points-dec" data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-max="' + assessment.maxPoints + '" style="width:44px;height:44px;font-size:20px">−</button>' +
            '<div style="text-align:center"><span style="font-size:28px;font-weight:700" id="m-pts-' + st.id + '-' + assessment.id + '">' + (rawScore != null ? rawScore : '0') + '</span>' +
            '<span style="font-size:15px;color:var(--text-3)"> / ' + assessment.maxPoints + '</span></div>' +
            '<button class="m-score-btn" data-action="m-grade-points-inc" data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-max="' + assessment.maxPoints + '" style="width:44px;height:44px;font-size:20px">+</button>' +
          '</div></div>';
      } else {
        // Proficiency mode
        var btns = '';
        for (var level = 0; level <= 4; level++) {
          var active = current !== null && Math.round(current) === level ? ' m-score-active' : '';
          btns += '<button class="m-score-btn' + active + '" data-action="m-grade-score" data-score="' + level + '" data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-tid="' + tid + '">' + level + '</button>';
        }
        tagGroups += '<div class="m-score-group">' +
          '<div class="m-score-tag-label"><span class="m-score-tag-dot" style="background:' + tagColor + '"></span>' + MC.esc(tagLabel) + '</div>' +
          '<div class="m-score-btns" role="radiogroup" aria-label="Score for ' + MC.esc(tagLabel) + '">' + btns + '</div>' +
        '</div>';
      }
    });

    // Status toggles
    var statusRow = '<div class="m-status-row">' +
      '<button class="m-status-pill' + (status === 'NS' ? ' m-status-active' : '') + '" data-action="m-grade-status" data-val="NS" data-sid="' + st.id + '" data-aid="' + assessment.id + '">NS</button>' +
      '<button class="m-status-pill' + (status === 'EXC' ? ' m-status-active' : '') + '" data-action="m-grade-status" data-val="EXC" data-sid="' + st.id + '" data-aid="' + assessment.id + '">EXC</button>' +
      '<button class="m-status-pill' + (status === 'LATE' ? ' m-status-active' : '') + '" data-action="m-grade-status" data-val="LATE" data-sid="' + st.id + '" data-aid="' + assessment.id + '">LATE</button>' +
    '</div>';

    return '<div class="m-swiper-card" data-sid="' + st.id + '">' +
      '<div class="m-grade-card-surface">' + header + tagGroups + statusRow + '</div></div>';
  }

  /* ── Score a student (auto-save) ────────────────────────────── */
  function setScore(cid, sid, aid, tid, score) {
    var allScores = getScores(cid);
    var stScores = allScores[sid] || [];

    // Save previous state for undo
    var prevEntries = stScores.filter(function(s) { return s.assessmentId === aid && s.tagId === tid; });
    _undoStack.push({ cid: cid, sid: sid, aid: aid, tid: tid, prev: JSON.parse(JSON.stringify(prevEntries)) });
    if (_undoStack.length > 20) _undoStack.shift();

    // Find assessment for metadata
    var assessment = getAssessments(cid).find(function(a) { return a.id === aid; });
    var type = assessment ? assessment.type : 'summative';

    // Remove old entries for this assessment+tag
    stScores = stScores.filter(function(s) { return !(s.assessmentId === aid && s.tagId === tid); });

    // Add new score
    stScores.push({
      id: 'ms_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      assessmentId: aid,
      tagId: tid,
      score: score,
      date: assessment ? assessment.date : getTodayStr(),
      type: type,
      created: new Date().toISOString()
    });

    allScores[sid] = stScores;
    saveScores(cid, allScores);
    clearProfCache();
    MC.haptic();

    // Update button states
    var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    if (card) {
      var btns = card.querySelectorAll('.m-score-btn[data-tid="' + tid + '"]');
      btns.forEach(function(btn) {
        btn.classList.toggle('m-score-active', parseInt(btn.getAttribute('data-score')) === score);
      });
    }

    // Update thumbnail graded state
    _updateThumbGraded(cid, aid);

    // Show undo toast
    MC.showToast('Score saved', {
      onUndo: function() { undoLastScore(); },
      duration: 5000
    });
  }

  function setStatus(cid, sid, aid, status) {
    var current = getAssignmentStatus(cid, sid, aid);
    var newStatus = current === status ? null : status;
    setAssignmentStatus(cid, sid, aid, newStatus);
    MC.haptic();

    // Update pill states
    var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    if (card) {
      card.querySelectorAll('.m-status-pill').forEach(function(pill) {
        pill.classList.toggle('m-status-active', pill.getAttribute('data-val') === newStatus);
      });
    }
  }

  function undoLastScore() {
    var entry = _undoStack.pop();
    if (!entry) return;
    var allScores = getScores(entry.cid);
    var stScores = (allScores[entry.sid] || []).filter(function(s) {
      return !(s.assessmentId === entry.aid && s.tagId === entry.tid);
    });
    // Restore previous entries
    entry.prev.forEach(function(p) { stScores.push(p); });
    allScores[entry.sid] = stScores;
    saveScores(entry.cid, allScores);
    clearProfCache();

    // Update UI
    var card = document.querySelector('.m-swiper-card[data-sid="' + entry.sid + '"]');
    if (card) {
      var btns = card.querySelectorAll('.m-score-btn[data-tid="' + entry.tid + '"]');
      var lastScore = entry.prev.length ? entry.prev[entry.prev.length - 1].score : null;
      btns.forEach(function(btn) {
        var lvl = parseInt(btn.getAttribute('data-score'));
        btn.classList.toggle('m-score-active', lastScore !== null && Math.round(lastScore) === lvl);
      });
    }
    _updateThumbGraded(entry.cid, entry.aid);
    MC.showToast('Score reverted');
  }

  /* ── Swiper scroll tracking ─────────────────────────────────── */
  function setupSwiper(cid, aid) {
    var swiper = document.getElementById('m-swiper');
    if (!swiper) return;
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');

    swiper.addEventListener('scroll', function() {
      if (_scrollRAF) return;
      _scrollRAF = requestAnimationFrame(function() {
        _scrollRAF = null;
        var idx = Math.round(swiper.scrollLeft / swiper.clientWidth);
        if (idx !== _currentIdx && idx >= 0 && idx < students.length) {
          _currentIdx = idx;
          _updateCurrentThumb(idx);
          _updateSubtitle(idx, students.length);
        }
      });
    }, { passive: true });
  }

  function jumpToStudent(idx) {
    var swiper = document.getElementById('m-swiper');
    if (!swiper) return;
    swiper.scrollTo({ left: idx * swiper.clientWidth, behavior: 'smooth' });
    _currentIdx = idx;
    _updateCurrentThumb(idx);
  }

  function _updateCurrentThumb(idx) {
    var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
    thumbs.forEach(function(t, i) {
      t.classList.toggle('m-thumb-current', i === idx);
    });
    // Scroll thumb into view
    var current = thumbs[idx];
    if (current) current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  function _updateSubtitle(idx, total) {
    var titleInline = document.querySelector('#m-nav-bar-grade-swiper .m-nav-bar-title-inline');
    if (titleInline) {
      var assessment = titleInline.textContent.split('\n')[0];
      // Keep just the number part
      var sub = titleInline.querySelector('div');
      if (sub) sub.textContent = (idx + 1) + ' of ' + total;
    }
  }

  function _updateThumbGraded(cid, aid) {
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var allScores = getScores(cid);
    var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
    thumbs.forEach(function(t, i) {
      if (i >= students.length) return;
      var st = students[i];
      var stScores = allScores[st.id] || [];
      var isGraded = stScores.some(function(s) { return s.assessmentId === aid && s.score > 0; });
      t.classList.toggle('m-thumb-graded', isGraded);
    });
  }

  function adjustPointsScore(cid, sid, aid, delta, maxPts) {
    var current = getPointsScore(cid, sid, aid) || 0;
    var next = Math.max(0, Math.min(maxPts, current + delta));
    setPointsScore(cid, sid, aid, next);
    clearProfCache();
    MC.haptic();
    // Update display
    var el = document.getElementById('m-pts-' + sid + '-' + aid);
    if (el) el.textContent = next;
    _updateThumbGraded(cid, aid);
  }

  return {
    renderPicker: renderPicker,
    filterAssessments: filterAssessments,
    renderSwiper: renderSwiper,
    setScore: setScore,
    setStatus: setStatus,
    adjustPointsScore: adjustPointsScore,
    undoLastScore: undoLastScore,
    setupSwiper: setupSwiper,
    jumpToStudent: jumpToStudent
  };
})();
