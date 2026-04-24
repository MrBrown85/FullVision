/* m-grade.js — Feature 3: Speed Grader */

window.MGrade = (function () {
  'use strict';

  var MC = window.MComponents;
  var _currentIdx = 0;
  var _undoStack = [];
  var _scrollRAF = null;

  /* ── Filter state ─────────────────────────────────────────────
   * Per-course, persisted to localStorage under gb-grade-filters-<cid>.
   * `category` / `module` are inclusive allowlists (empty = no filter).
   * '__none' sentinel in either array matches assessments with no
   * categoryId / moduleId. `dateRange` and `gradedStatus` are single-
   * value selectors. Defaults are the "no filter applied" state. */
  var _FILTER_DEFAULTS = {
    category: [],
    module: [],
    dateRange: 'all', //  'all' | 'week' | '30d' | 'term'
    gradedStatus: 'all', //  'all' | 'has-ungraded' | 'fully-graded'
  };
  var _filters = _cloneFilters(_FILTER_DEFAULTS);
  var _segmentMode = 'recent';
  // Sheet-local staging copy: changes made in the filter sheet only commit
  // to _filters on Apply. Cancel/swipe-dismiss discards pending changes.
  var _sheetStaged = null;
  var _FILTER_ICON_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';

  function _cloneFilters(f) {
    return {
      category: (f.category || []).slice(),
      module: (f.module || []).slice(),
      dateRange: f.dateRange || 'all',
      gradedStatus: f.gradedStatus || 'all',
    };
  }

  function _loadFilters(cid) {
    var raw = typeof _safeParseLS === 'function' ? _safeParseLS('gb-grade-filters-' + cid, null) : null;
    if (!raw || typeof raw !== 'object') return _cloneFilters(_FILTER_DEFAULTS);
    return {
      category: Array.isArray(raw.category) ? raw.category.slice() : [],
      module: Array.isArray(raw.module) ? raw.module.slice() : [],
      dateRange: ['all', 'week', '30d', 'term'].indexOf(raw.dateRange) >= 0 ? raw.dateRange : 'all',
      gradedStatus: ['all', 'has-ungraded', 'fully-graded'].indexOf(raw.gradedStatus) >= 0 ? raw.gradedStatus : 'all',
    };
  }

  function _saveFilters(cid) {
    if (typeof _safeLSSet === 'function') {
      _safeLSSet('gb-grade-filters-' + cid, JSON.stringify(_filters));
    }
  }

  function _activeFilterCount() {
    var n = 0;
    if (_filters.category.length > 0) n++;
    if (_filters.module.length > 0) n++;
    if (_filters.dateRange !== 'all') n++;
    if (_filters.gradedStatus !== 'all') n++;
    return n;
  }

  function _updateFilterBadge() {
    var badge = document.querySelector('.m-grade-filter-badge');
    if (!badge) return;
    var n = _activeFilterCount();
    if (n > 0) {
      badge.textContent = String(n);
      badge.hidden = false;
    } else {
      badge.textContent = '';
      badge.hidden = true;
    }
  }

  function _assessmentBadgeData(cid, assessment) {
    var categoryId = getAssessmentCategoryId(assessment);
    return {
      label: getAssessmentCategoryName(cid, assessment),
      className:
        categoryId || (assessment && assessment.type === 'summative') ? 'm-type-summative' : 'm-type-formative',
    };
  }

  /* ── Assessment Picker Screen ───────────────────────────────── */
  function renderPicker(cid) {
    var nav = MC.navBar({ id: 'grade-picker', title: 'Grade' });

    var assessments = getAssessments(cid);
    var students = getStudents(cid);
    var allScores = getScores(cid);

    // Load persisted filters for this course.
    _filters = _loadFilters(cid);
    _segmentMode = 'recent';

    // Sort by date, newest first
    var sorted = assessments.slice().sort(function (a, b) {
      return b.date.localeCompare(a.date);
    });

    // Filter bar: quick segments + a "more filters" icon button that opens
    // the multi-dimension bottom sheet. Ungraded moved into the sheet as
    // gradedStatus='has-ungraded' (richer: also supports fully-graded).
    var activeN = _activeFilterCount();
    var segmented =
      '<div class="m-grade-filter-bar">' +
      '<div class="m-segmented">' +
      '<button class="m-seg-btn m-seg-active" data-action="m-grade-seg" data-val="recent">Recent</button>' +
      '<button class="m-seg-btn" data-action="m-grade-seg" data-val="all">All</button>' +
      '</div>' +
      '<button class="m-grade-filter-btn" data-action="m-grade-filter-open" aria-label="Filter assessments">' +
      _FILTER_ICON_SVG +
      '<span class="m-grade-filter-badge"' +
      (activeN > 0 ? '' : ' hidden') +
      '>' +
      (activeN > 0 ? activeN : '') +
      '</span>' +
      '</button>' +
      '</div>';

    var cells = '';
    if (!sorted.length) {
      cells =
        '<div class="m-empty"><div class="m-empty-icon">📋</div><div class="m-empty-title">No Assessments</div><div class="m-empty-subtitle">Create assessments on the desktop app</div></div>';
    } else {
      cells = '<div class="m-list" id="m-grade-list">';
      sorted.forEach(function (a) {
        var dateStr = new Date(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        var badge = _assessmentBadgeData(cid, a);
        var tagCount = (a.tagIds || []).length;

        // Count graded students
        var gradedCount = 0;
        students.forEach(function (st) {
          var stScores = allScores[st.id] || [];
          var hasScore = stScores.some(function (s) {
            return s.assessmentId === a.id && s.score > 0;
          });
          if (hasScore) gradedCount++;
        });
        var total = students.length;
        var pct = total > 0 ? Math.min(100, Math.max(0, Math.round((gradedCount / total) * 100))) : 0;

        cells +=
          '<div class="m-cell" data-action="m-grade-assess" data-aid="' +
          a.id +
          '">' +
          '<div class="m-cell-body">' +
          '<div class="m-cell-title">' +
          '<span class="m-type-badge ' +
          badge.className +
          '" style="margin-right:6px">' +
          MC.esc(badge.label) +
          '</span>' +
          MC.esc(a.title) +
          '</div>' +
          '<div class="m-cell-subtitle">' +
          '<span>' +
          dateStr +
          '</span>' +
          '<span>' +
          tagCount +
          ' tag' +
          (tagCount !== 1 ? 's' : '') +
          '</span>' +
          '<span>' +
          gradedCount +
          '/' +
          total +
          ' graded</span>' +
          '</div>' +
          '<div class="m-progress-bar"><div class="m-progress-fill" style="width:' +
          pct +
          '%"></div></div>' +
          '</div>' +
          MC.ICONS.chevronRight +
          '</div>';
      });
      cells += '</div>';
    }

    return (
      '<div class="m-screen" id="m-screen-grade-picker">' +
      nav +
      '<div class="m-screen-content">' +
      MC.largeTitleHTML('Grade') +
      segmented +
      cells +
      '</div></div>'
    );
  }

  /* ── Filter evaluation ──────────────────────────────────────── */

  function _gradedCountFor(a, students, allScores) {
    var n = 0;
    students.forEach(function (st) {
      var stScores = allScores[st.id] || [];
      if (
        stScores.some(function (s) {
          return s.assessmentId === a.id && s.score > 0;
        })
      )
        n++;
    });
    return n;
  }

  /* Returns true if the assessment passes every active filter dimension
   * plus the current segment mode. `ctx` pre-computes shared values so
   * we're not rebuilding dates/counts in a hot loop. */
  function _matchesAllFilters(a, ctx) {
    // Segment: 'recent' narrows to last 30 days regardless of sheet state.
    if (_segmentMode === 'recent') {
      if (ctx.recentCutoff && new Date(a.date) < ctx.recentCutoff) return false;
    }
    // Category: '__none' sentinel matches assessments with no categoryId.
    if (_filters.category.length > 0) {
      var cat = a.categoryId || '__none';
      if (_filters.category.indexOf(cat) === -1) return false;
    }
    // Module: same sentinel pattern.
    if (_filters.module.length > 0) {
      var mod = a.moduleId || '__none';
      if (_filters.module.indexOf(mod) === -1) return false;
    }
    // Date range: segment === 'recent' already applied above, don't double-cut.
    if (_segmentMode !== 'recent' && _filters.dateRange !== 'all') {
      var cutoff = ctx.dateCutoffs[_filters.dateRange];
      if (cutoff && new Date(a.date) < cutoff) return false;
    }
    // Graded status.
    if (_filters.gradedStatus !== 'all') {
      var graded = _gradedCountFor(a, ctx.students, ctx.allScores);
      var total = ctx.students.length;
      if (_filters.gradedStatus === 'has-ungraded' && graded >= total) return false;
      if (_filters.gradedStatus === 'fully-graded' && graded < total) return false;
    }
    return true;
  }

  /* ── Filter assessment list ─────────────────────────────────── */
  function filterAssessments(cid, mode) {
    if (mode) _segmentMode = mode;

    var assessments = getAssessments(cid);
    var students = getStudents(cid);
    var allScores = getScores(cid);
    var now = new Date();
    var ctx = {
      students: students,
      allScores: allScores,
      recentCutoff: new Date(now.getTime() - 30 * 86400000),
      dateCutoffs: {
        week: new Date(now.getTime() - 7 * 86400000),
        '30d': new Date(now.getTime() - 30 * 86400000),
        term: new Date(now.getTime() - 90 * 86400000),
      },
    };

    // Update segmented control active state
    document.querySelectorAll('.m-seg-btn[data-action="m-grade-seg"]').forEach(function (btn) {
      btn.classList.toggle('m-seg-active', btn.getAttribute('data-val') === _segmentMode);
    });

    document.querySelectorAll('#m-grade-list .m-cell').forEach(function (cell) {
      var aid = cell.getAttribute('data-aid');
      var a = assessments.find(function (x) {
        return x.id === aid;
      });
      if (!a) {
        cell.style.display = 'none';
        return;
      }
      cell.style.display = _matchesAllFilters(a, ctx) ? '' : 'none';
    });

    _updateFilterBadge();
  }

  /* ── Filter sheet ───────────────────────────────────────────── */

  function _renderFilterSheet(cid) {
    _sheetStaged = _cloneFilters(_filters);

    var categories = typeof getCategories === 'function' ? getCategories(cid) : [];
    var modules = typeof getModules === 'function' ? getModules(cid) : [];

    function pill(kind, value, label, active) {
      return (
        '<button class="m-filter-pill' +
        (active ? ' m-filter-active' : '') +
        '" data-action="m-grade-filter-toggle" data-kind="' +
        MC.esc(kind) +
        '" data-val="' +
        MC.esc(value) +
        '">' +
        MC.esc(label) +
        '</button>'
      );
    }

    function seg(kind, options, currentValue) {
      return (
        '<div class="m-segmented">' +
        options
          .map(function (o) {
            return (
              '<button class="m-seg-btn' +
              (o.val === currentValue ? ' m-seg-active' : '') +
              '" data-action="m-grade-filter-seg" data-kind="' +
              MC.esc(kind) +
              '" data-val="' +
              MC.esc(o.val) +
              '">' +
              MC.esc(o.label) +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    var catPills = categories
      .map(function (c) {
        return pill('category', c.id, c.name, _sheetStaged.category.indexOf(c.id) >= 0);
      })
      .join('');
    catPills += pill('category', '__none', 'No Category', _sheetStaged.category.indexOf('__none') >= 0);

    var modSection = '';
    if (modules.length > 0) {
      var modPills = modules
        .map(function (m) {
          return pill('module', m.id, m.name, _sheetStaged.module.indexOf(m.id) >= 0);
        })
        .join('');
      modPills += pill('module', '__none', 'No Module', _sheetStaged.module.indexOf('__none') >= 0);
      modSection =
        '<div class="m-filter-sheet-section">' +
        '<div class="m-filter-sheet-title">Module</div>' +
        '<div class="m-filter-strip m-filter-strip-wrap">' +
        modPills +
        '</div>' +
        '</div>';
    }

    var dateSeg = seg(
      'dateRange',
      [
        { val: 'all', label: 'All time' },
        { val: 'week', label: 'This week' },
        { val: '30d', label: 'Last 30 days' },
        { val: 'term', label: 'Last term' },
      ],
      _sheetStaged.dateRange,
    );

    var statusSeg = seg(
      'gradedStatus',
      [
        { val: 'all', label: 'All' },
        { val: 'has-ungraded', label: 'Has ungraded' },
        { val: 'fully-graded', label: 'Fully graded' },
      ],
      _sheetStaged.gradedStatus,
    );

    return (
      '<div class="m-filter-sheet">' +
      '<div class="m-filter-sheet-heading">Filter assessments</div>' +
      '<div class="m-filter-sheet-section">' +
      '<div class="m-filter-sheet-title">Category</div>' +
      '<div class="m-filter-strip m-filter-strip-wrap">' +
      catPills +
      '</div>' +
      '</div>' +
      modSection +
      '<div class="m-filter-sheet-section">' +
      '<div class="m-filter-sheet-title">Date range</div>' +
      dateSeg +
      '</div>' +
      '<div class="m-filter-sheet-section">' +
      '<div class="m-filter-sheet-title">Graded status</div>' +
      statusSeg +
      '</div>' +
      '<div class="m-filter-sheet-footer">' +
      '<button class="m-btn-ghost" data-action="m-grade-filter-clear">Clear all</button>' +
      '<button class="m-btn-primary" data-action="m-grade-filter-apply">Apply</button>' +
      '</div>' +
      '</div>'
    );
  }

  function openFilterSheet(cid) {
    MC.presentSheet(_renderFilterSheet(cid), {
      onClose: function () {
        _sheetStaged = null;
      },
    });
  }

  /* ── Action dispatch from shell.js ──────────────────────────── */

  function onFilterTogglePill(kind, value) {
    if (!_sheetStaged) return;
    var arr = _sheetStaged[kind];
    if (!Array.isArray(arr)) return;
    var idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(value);
    // Reflect the toggle in the sheet DOM without re-rendering the whole sheet
    var sel = '.m-filter-pill[data-kind="' + kind + '"][data-val="' + value.replace(/"/g, '\\"') + '"]';
    var btn = document.querySelector('#m-sheet-container ' + sel);
    if (btn) btn.classList.toggle('m-filter-active', idx < 0);
  }

  function onFilterSegChange(kind, value) {
    if (!_sheetStaged) return;
    _sheetStaged[kind] = value;
    // Update the segmented control inside the sheet
    var container = document.querySelector('#m-sheet-container');
    if (!container) return;
    container
      .querySelectorAll('.m-seg-btn[data-action="m-grade-filter-seg"][data-kind="' + kind + '"]')
      .forEach(function (btn) {
        btn.classList.toggle('m-seg-active', btn.getAttribute('data-val') === value);
      });
  }

  function applyFilterSheet(cid) {
    if (_sheetStaged) _filters = _cloneFilters(_sheetStaged);
    _sheetStaged = null;
    _saveFilters(cid);
    MC.dismissSheet();
    filterAssessments(cid);
  }

  function clearFilterSheet(cid) {
    _filters = _cloneFilters(_FILTER_DEFAULTS);
    _sheetStaged = null;
    _saveFilters(cid);
    MC.dismissSheet();
    filterAssessments(cid);
  }

  /* ── Student Card Swiper Screen ─────────────────────────────── */
  function renderSwiper(cid, aid) {
    var assessments = getAssessments(cid);
    var assessment = assessments.find(function (a) {
      return a.id === aid;
    });
    if (!assessment) return '<div class="m-screen"><div class="m-empty">Assessment not found</div></div>';

    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var allScores = getScores(cid);
    _currentIdx = 0;

    var nav = MC.navBar({
      id: 'grade-swiper',
      title: assessment.title,
      subtitle: '1 of ' + students.length,
      backLabel: 'Grade',
    });

    // Student thumbnail strip
    var thumbs = '<div class="m-thumb-strip" id="m-thumb-strip">';
    students.forEach(function (st, idx) {
      var color = MC.avatarColor(st.id);
      var initials = MC.avatarInitials(st);
      var stScores = allScores[st.id] || [];
      var isGraded = stScores.some(function (s) {
        return s.assessmentId === aid && s.score > 0;
      });
      var currentClass = idx === 0 ? ' m-thumb-current' : '';
      var gradedClass = isGraded ? ' m-thumb-graded' : '';
      thumbs +=
        '<div class="m-thumb' +
        currentClass +
        gradedClass +
        '" style="background:' +
        color +
        '" data-action="m-grade-jump" data-idx="' +
        idx +
        '">' +
        initials +
        '</div>';
    });
    thumbs += '</div>';

    // Swiper cards
    var allStatuses = getAssignmentStatuses(cid);
    var swiper = '<div class="m-swiper" id="m-swiper">';
    students.forEach(function (st) {
      swiper += _renderStudentCard(cid, st, assessment, allScores, allStatuses);
    });
    swiper += '</div>';

    return '<div class="m-screen m-screen-hidden" id="m-screen-grade-swiper">' + nav + thumbs + swiper + '</div>';
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
      st.designations.forEach(function (code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += ' <span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += ' <span class="m-badge m-badge-mod">MOD</span>';
      });
    }

    var header =
      '<div class="m-grade-student-header">' +
      '<div class="m-grade-avatar" style="background:' +
      color +
      '">' +
      initials +
      '</div>' +
      '<div><div class="m-grade-student-name">' +
      MC.esc(name) +
      badges +
      '</div>' +
      '</div></div>';

    // Score selectors for each tag
    var tagGroups = '';
    (assessment.tagIds || []).forEach(function (tid) {
      var tag = getTagById(cid, tid);
      var sec = getSectionForTag(cid, tid);
      var tagLabel = tag ? tag.label || tag.name || tag.id : tid;
      var tagColor = sec ? sec.color : '#888';

      // Current score for this tag
      var existing = stScores.filter(function (s) {
        return s.assessmentId === assessment.id && s.tagId === tid;
      });
      var current = existing.length ? existing[existing.length - 1].score : null;

      if (isPoints && assessment.maxPoints) {
        // Points mode
        var rawScore = getPointsScore(cid, st.id, assessment.id);
        tagGroups +=
          '<div class="m-score-group" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-tid="' +
          tid +
          '">' +
          '<div class="m-score-tag-label"><span class="m-score-tag-dot" style="background:' +
          tagColor +
          '"></span>' +
          MC.esc(tagLabel) +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:12px">' +
          '<button class="m-score-btn" data-action="m-grade-points-dec" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-max="' +
          assessment.maxPoints +
          '" style="width:44px;height:44px;font-size:20px">−</button>' +
          '<div style="text-align:center"><span style="font-size:28px;font-weight:700" id="m-pts-' +
          st.id +
          '-' +
          assessment.id +
          '">' +
          (rawScore != null ? rawScore : '0') +
          '</span>' +
          '<span style="font-size:15px;color:var(--text-3)"> / ' +
          assessment.maxPoints +
          '</span></div>' +
          '<button class="m-score-btn" data-action="m-grade-points-inc" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-max="' +
          assessment.maxPoints +
          '" style="width:44px;height:44px;font-size:20px">+</button>' +
          '</div></div>';
      } else {
        // Proficiency mode — levels 1-4 only. 'No Evidence' (stored as 0) is
        // reachable by tapping the currently-active level to toggle it off;
        // that state renders as "no button active," matching both the fresh
        // ungraded state AND a deliberate No-Evidence choice, which the
        // graded-count / calc / report layers already treat identically
        // (all use `score > 0`).
        var btns = '';
        for (var level = 1; level <= 4; level++) {
          var active = current !== null && Math.round(current) === level ? ' m-score-active' : '';
          btns +=
            '<button class="m-score-btn' +
            active +
            '" data-action="m-grade-score" data-score="' +
            level +
            '" data-sid="' +
            st.id +
            '" data-aid="' +
            assessment.id +
            '" data-tid="' +
            tid +
            '">' +
            level +
            '</button>';
        }
        tagGroups +=
          '<div class="m-score-group">' +
          '<div class="m-score-tag-label"><span class="m-score-tag-dot" style="background:' +
          tagColor +
          '"></span>' +
          MC.esc(tagLabel) +
          '</div>' +
          '<div class="m-score-btns" role="radiogroup" aria-label="Score for ' +
          MC.esc(tagLabel) +
          '">' +
          btns +
          '</div>' +
          '</div>';
      }
    });

    // Status toggles
    var statusRow =
      '<div class="m-status-row">' +
      '<button class="m-status-pill' +
      (status === 'NS' ? ' m-status-active' : '') +
      '" data-action="m-grade-status" data-val="NS" data-sid="' +
      st.id +
      '" data-aid="' +
      assessment.id +
      '">NS</button>' +
      '<button class="m-status-pill' +
      (status === 'EXC' ? ' m-status-active' : '') +
      '" data-action="m-grade-status" data-val="EXC" data-sid="' +
      st.id +
      '" data-aid="' +
      assessment.id +
      '">EXC</button>' +
      '<button class="m-status-pill' +
      (status === 'LATE' ? ' m-status-active' : '') +
      '" data-action="m-grade-status" data-val="LATE" data-sid="' +
      st.id +
      '" data-aid="' +
      assessment.id +
      '">LATE</button>' +
      '</div>';

    return (
      '<div class="m-swiper-card" data-sid="' +
      st.id +
      '">' +
      '<div class="m-grade-card-surface' +
      (status === 'NS' || status === 'EXC' ? ' m-card-status-disabled' : '') +
      '">' +
      header +
      tagGroups +
      statusRow +
      '</div></div>'
    );
  }

  /* ── Score a student (auto-save) ────────────────────────────── */
  function setScore(cid, sid, aid, tid, score) {
    var allScores = getScores(cid);
    var stScores = allScores[sid] || [];

    // Save previous state for undo
    var prevEntries = stScores.filter(function (s) {
      return s.assessmentId === aid && s.tagId === tid;
    });
    _undoStack.push({ cid: cid, sid: sid, aid: aid, tid: tid, prev: JSON.parse(JSON.stringify(prevEntries)) });
    if (_undoStack.length > 20) _undoStack.shift();

    // Toggle off: tapping the already-active level clears the score.
    // Score stored as 0 ('no score' to calculators; all level buttons become
    // inactive because none of them has data-score="0"). The existing
    // undo entry (captured above) restores the prior score on undo.
    var existing = prevEntries[prevEntries.length - 1];
    var cleared = existing && existing.score === score;
    if (cleared) score = 0;

    // Find assessment for metadata
    var assessment = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var type = assessment
      ? getAssessmentCategoryId(assessment)
        ? 'summative'
        : assessment.type || 'formative'
      : 'summative';

    upsertScore(cid, sid, aid, tid, score, assessment ? assessment.date : getTodayStr(), type, '');
    clearProfCache();
    MC.haptic();

    // Update button states. When cleared (score=0), no btn matches so all
    // buttons become inactive — which is exactly what we want visually.
    var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    if (card) {
      var btns = card.querySelectorAll('.m-score-btn[data-tid="' + tid + '"]');
      btns.forEach(function (btn) {
        btn.classList.toggle('m-score-active', parseInt(btn.getAttribute('data-score')) === score);
      });
    }

    // Update thumbnail graded state
    _updateThumbGraded(cid, aid);

    // Feedback. Routine saves are silent — the button filling with the
    // score-level color plus haptic is enough confirmation, and toasting
    // on every tap turns 100+ grading actions into a flashing noise bar.
    // Only the toggle-off "cleared" path gets a toast, because that's the
    // one case where the teacher might want an immediate undo.
    if (cleared) {
      MC.showToast('Score cleared', {
        onUndo: function () {
          undoLastScore();
        },
        duration: 5000,
      });
    }
  }

  function setStatus(cid, sid, aid, status) {
    var current = getAssignmentStatus(cid, sid, aid);
    var newStatus = current === status ? null : status;
    setAssignmentStatus(cid, sid, aid, newStatus);
    MC.haptic();

    // NS auto-zero: match desktop behaviour (page-assignments.js
    // toggleStudentStatus). Setting NS on an assessment zeroes every tag
    // score under it, because "not submitted" means the student scored 0
    // on every demonstrated outcome. Clearing NS does NOT auto-restore —
    // the teacher has to re-score.
    var assess = null;
    if (newStatus === 'NS') {
      assess = getAssessments(cid).find(function (a) {
        return a.id === aid;
      });
      if (assess) {
        (assess.tagIds || []).forEach(function (tagId) {
          upsertScore(
            cid,
            sid,
            aid,
            tagId,
            0,
            assess.date || (typeof courseToday === 'function' ? courseToday(cid) : ''),
            assess.type || 'summative',
            '',
          );
        });
        clearProfCache();
      }
    }

    // Update pill states
    var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    if (card) {
      card.querySelectorAll('.m-status-pill').forEach(function (pill) {
        pill.classList.toggle('m-status-active', pill.getAttribute('data-val') === newStatus);
      });
      // After auto-zero, deactivate every score button under this (sid, aid)
      // so the UI reflects the zeroed state (no button matches score=0).
      if (newStatus === 'NS') {
        card.querySelectorAll('.m-score-btn[data-aid="' + aid + '"]').forEach(function (btn) {
          btn.classList.remove('m-score-active');
        });
      }
      // Dim the score rows when the assessment is flagged NS or EXC (not
      // LATE, which doesn't disable grading). Mirrors desktop .has-status.
      var surface = card.querySelector('.m-grade-card-surface');
      if (surface) {
        var disabled = newStatus === 'NS' || newStatus === 'EXC';
        surface.classList.toggle('m-card-status-disabled', disabled);
      }
    }

    // Update thumbnail graded state so the per-student dot reflects the new
    // zero-scored (i.e., no longer "graded") state.
    if (newStatus === 'NS') {
      _updateThumbGraded(cid, aid);
    }
  }

  function undoLastScore() {
    var entry = _undoStack.pop();
    if (!entry) return;
    var allScores = getScores(entry.cid);
    var stScores = (allScores[entry.sid] || []).filter(function (s) {
      return !(s.assessmentId === entry.aid && s.tagId === entry.tid);
    });
    // Restore previous entries
    entry.prev.forEach(function (p) {
      stScores.push(p);
    });
    allScores[entry.sid] = stScores;
    saveScores(entry.cid, allScores);
    clearProfCache();

    // Update UI
    var card = document.querySelector('.m-swiper-card[data-sid="' + entry.sid + '"]');
    if (card) {
      var btns = card.querySelectorAll('.m-score-btn[data-tid="' + entry.tid + '"]');
      var lastScore = entry.prev.length ? entry.prev[entry.prev.length - 1].score : null;
      btns.forEach(function (btn) {
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

    swiper.addEventListener(
      'scroll',
      function () {
        if (_scrollRAF) return;
        _scrollRAF = requestAnimationFrame(function () {
          _scrollRAF = null;
          var idx = Math.round(swiper.scrollLeft / swiper.clientWidth);
          if (idx !== _currentIdx && idx >= 0 && idx < students.length) {
            _currentIdx = idx;
            _updateCurrentThumb(idx);
            _updateSubtitle(idx, students.length);
          }
        });
      },
      { passive: true },
    );
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
    thumbs.forEach(function (t, i) {
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
      if (sub) sub.textContent = idx + 1 + ' of ' + total;
    }
  }

  function _updateThumbGraded(cid, aid) {
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var allScores = getScores(cid);
    var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
    thumbs.forEach(function (t, i) {
      if (i >= students.length) return;
      var st = students[i];
      var stScores = allScores[st.id] || [];
      var isGraded = stScores.some(function (s) {
        return s.assessmentId === aid && s.score > 0;
      });
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
    openFilterSheet: openFilterSheet,
    onFilterTogglePill: onFilterTogglePill,
    onFilterSegChange: onFilterSegChange,
    applyFilterSheet: applyFilterSheet,
    clearFilterSheet: clearFilterSheet,
    renderSwiper: renderSwiper,
    setScore: setScore,
    setStatus: setStatus,
    adjustPointsScore: adjustPointsScore,
    undoLastScore: undoLastScore,
    setupSwiper: setupSwiper,
    jumpToStudent: jumpToStudent,
  };
})();
