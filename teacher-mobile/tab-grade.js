/* m-grade.js — Feature 3: Speed Grader */

window.MGrade = (function () {
  'use strict';

  var MC = window.MComponents;
  var _currentIdx = 0;
  var _undoStack = [];
  var _scrollRAF = null;
  // Rubric view per assessment (true unless Tags is chosen) and the
  // Advanced Rubric checklists open, keyed sid:aid:critId.
  var _rubricView = {};
  var _openChecks = {};

  /* ── Filter state ─────────────────────────────────────────────
   * Per-course, persisted to localStorage under gb-grade-filters-<cid>.
   * `category` / `module` are inclusive allowlists (empty = no filter).
   * '__none' sentinel in either array matches assessments with no
   * categoryId / moduleId. `dateRange` and `gradedStatus` are single-
   * value selectors. Defaults are the "no filter applied" state. */
  var _FILTER_DEFAULTS = {
    category: [],
    module: [],
    dateRange: 'all', //  'all' | 'week' | '30d' | 'term:<ordinal>' (a reporting term)
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

  /* The class's reporting terms (shared/data.js). Empty when it has none. */
  function _terms(cid) {
    return typeof getReportingTerms === 'function' ? getReportingTerms(cid) || [] : [];
  }

  /* The dateRange value for a term: 'term:<ordinal>'. */
  function _termValue(term) {
    return 'term:' + term.ordinal;
  }

  /* The term a dateRange value names, or null for the fixed ranges. */
  function _termForValue(cid, value) {
    if (typeof value !== 'string' || value.indexOf('term:') !== 0) return null;
    var ordinal = Number(value.slice(5));
    return (
      _terms(cid).find(function (t) {
        return t.ordinal === ordinal;
      }) || null
    );
  }

  /* A saved dateRange is kept only if it is still an option. The old
   * 'term' value (last 90 days) and a term the class no longer has fall
   * back to all time. */
  function _validDateRange(cid, value) {
    if (['all', 'week', '30d'].indexOf(value) >= 0) return value;
    return _termForValue(cid, value) ? value : 'all';
  }

  function _loadFilters(cid) {
    var raw = typeof _safeParseLS === 'function' ? _safeParseLS('gb-grade-filters-' + cid, null) : null;
    if (!raw || typeof raw !== 'object') return _cloneFilters(_FILTER_DEFAULTS);
    return {
      category: Array.isArray(raw.category) ? raw.category.slice() : [],
      module: Array.isArray(raw.module) ? raw.module.slice() : [],
      dateRange: _validDateRange(cid, raw.dateRange),
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
        '<div class="m-empty"><div class="m-empty-title">No Assessments</div><div class="m-empty-subtitle">Create assessments on the desktop app</div></div>';
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
            return s.assessmentId === a.id && isScoreEntered(a, s);
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
          return s.assessmentId === a.id && isScoreEntered(a, s);
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
      if (ctx.term) {
        // A reporting term keeps the assessments dated inside it. An
        // undated assessment is in no term (docs/DECISIONS.md, "Reporting
        // periods" item 2).
        if (!a.date || a.date < ctx.term.starts_on || a.date > ctx.term.ends_on) return false;
      } else {
        var cutoff = ctx.dateCutoffs[_filters.dateRange];
        if (cutoff && new Date(a.date) < cutoff) return false;
      }
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
      },
      term: _termForValue(cid, _filters.dateRange),
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

    // One option per reporting term, after the fixed ranges. The list on
    // this screen follows the term; grades on mobile stay all-time.
    var dateOptions = [
      { val: 'all', label: 'All time' },
      { val: 'week', label: 'This week' },
      { val: '30d', label: 'Last 30 days' },
    ].concat(
      _terms(cid).map(function (t) {
        return { val: _termValue(t), label: t.label };
      }),
    );
    var dateSeg = seg('dateRange', dateOptions, _sheetStaged.dateRange);

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
      '<div class="m-filter-sheet-title">Date Range</div>' +
      dateSeg +
      '</div>' +
      '<div class="m-filter-sheet-section">' +
      '<div class="m-filter-sheet-title">Graded Status</div>' +
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
        return s.assessmentId === aid && isScoreEntered(assessment, s);
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

    return (
      '<div class="m-screen m-screen-hidden" id="m-screen-grade-swiper">' +
      nav +
      thumbs +
      _viewSwitchHtml(cid, assessment) +
      swiper +
      '</div>'
    );
  }

  function _renderStudentCard(cid, st, assessment, allScores, allStatuses) {
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    var stScores = allScores[st.id] || [];
    var status = allStatuses[st.id + ':' + assessment.id] || null;
    // Points and Complete/Incomplete are one value per assessment, so they get
    // one control rather than one per competency.
    var isPoints = assessment.scoreMode === 'points';

    // Badges
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function (code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += ' <span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += ' <span class="m-badge m-badge-mod">MOD</span>';
        if (code === 'ELL') badges += ' <span class="m-badge m-badge-ell">ELL</span>';
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
    if (isCompletionScored(assessment)) {
      tagGroups =
        '<div class="m-score-group m-cmp-group" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '">' +
        _completionBtnsHtml(getCompletionMark(cid, st.id, assessment.id)) +
        '</div>';
    }
    // A rubric of the assessment's own is scored by criterion (Tags | Rubric).
    var rubric = _rubricViewOn(cid, assessment) ? _ownRubric(cid, assessment) : null;
    if (rubric) {
      tagGroups = (rubric.criteria || [])
        .map(function (crit) {
          return _criterionGroupHtml(cid, st, assessment, rubric, crit);
        })
        .join('');
    }
    (isCompletionScored(assessment) || rubric ? [] : scoreTagIds(assessment, cid)).forEach(function (tid, tagIdx) {
      var tag = getTagById(cid, tid);
      var sec = getSectionForTag(cid, tid);
      var key = tag ? null : scoreKeyInfo(cid, assessment, tid);
      var tagLabel = tag
        ? tag.label || tag.name || tag.shortName || tag.code || ''
        : key
          ? key.label
          : 'No longer in the learning map';
      var tagColor = sec ? sec.color : '#888';

      // Current score for this tag
      var existing = stScores.filter(function (s) {
        return s.assessmentId === assessment.id && s.tagId === tid;
      });
      var current = existing.length ? existing[existing.length - 1].score : null;
      var currentMod = existing.length ? normalizeScoreMod(current, existing[existing.length - 1].mod) : 0;

      if (isPoints && assessment.maxPoints) {
        // Points mode
        if (tagIdx > 0) return;
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
          (rawScore != null ? rawScore : '\u2014') +
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
        // In the class's Rubric Levels order, like the desktop card.
        levelOrderFor(cid).forEach(function (level) {
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
        });
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
          '<div class="m-score-mods" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-tid="' +
          tid +
          '">' +
          _modBtnsHtml(current, currentMod) +
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
      '"' +
      (canSetAssignmentStatus(cid, st.id, assessment.id, 'NS') ? '' : ' disabled') +
      '>M</button>' +
      '<button class="m-status-pill' +
      (status === 'EXC' ? ' m-status-active' : '') +
      '" data-action="m-grade-status" data-val="EXC" data-sid="' +
      st.id +
      '" data-aid="' +
      assessment.id +
      '"' +
      (canSetAssignmentStatus(cid, st.id, assessment.id, 'EXC') ? '' : ' disabled') +
      '>EXC</button>' +
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

  /* ── Rubric view (Rubric Bank plan §5, PR 10) ──────────────────
     An assessment with a rubric of its own is scored by criterion, as the
     desktop's Rubric view does: one row per criterion whose level is saved
     under each of its competencies (rubricCriterionScoreKeys). Tags | Rubric
     switches back to one row per competency. An Advanced Rubric's criterion
     also has a Checks button that opens its checkboxes under the row;
     ticking writes the level they suggest unless the teacher picked one by
     hand (RubricChecks.levelAfterTick). */
  function _ownRubric(cid, assessment) {
    if (!assessment || !assessment.rubricId) return null;
    if (isPointsScored(assessment) || isCompletionScored(assessment)) return null;
    return getRubricById(cid, assessment.rubricId) || null;
  }

  function _rubricViewOn(cid, assessment) {
    return !!_ownRubric(cid, assessment) && _rubricView[assessment.id] !== false;
  }

  function _isAdvanced(rubric) {
    return !!rubric && typeof rubricStyle === 'function' && rubricStyle(rubric) === 'advanced';
  }

  function _findCriterion(cid, aid, critId) {
    var a = getAssessments(cid).find(function (x) {
      return x.id === aid;
    });
    var rubric = _ownRubric(cid, a);
    var crit = rubric
      ? (rubric.criteria || []).find(function (c) {
          return c.id === critId;
        })
      : null;
    return crit ? { assessment: a, rubric: rubric, crit: crit } : null;
  }

  /* A criterion's level, the desktop grid's rule: one level when its
     competencies agree (with their ±), else the lowest, marked mixed. */
  function _critState(cid, sid, aid, crit) {
    var entries = getScores(cid)[sid] || [];
    var levels = [];
    var mods = [];
    rubricCriterionScoreKeys(crit).forEach(function (tid) {
      var e = entries.find(function (s) {
        return s.assessmentId === aid && s.tagId === tid;
      });
      if (e && e.score > 0) {
        levels.push(e.score);
        mods.push(normalizeScoreMod(e.score, e.mod));
      }
    });
    if (!levels.length) return { level: 0, mod: 0, mixed: false };
    var same = levels.every(function (l) {
      return l === levels[0];
    });
    var modsAgree = mods.every(function (m) {
      return m === mods[0];
    });
    if (same) return { level: levels[0], mod: modsAgree ? mods[0] : 0, mixed: false };
    return { level: Math.min.apply(null, levels), mod: 0, mixed: true };
  }

  function _viewSwitchHtml(cid, assessment) {
    if (!_ownRubric(cid, assessment)) return '';
    var rubricOn = _rubricViewOn(cid, assessment);
    return (
      '<div class="m-grade-view-row"><div class="m-segmented" role="group" aria-label="Score by">' +
      '<button class="m-seg-btn' +
      (rubricOn ? '' : ' m-seg-active') +
      '" data-action="m-grade-view" data-view="tags" data-aid="' +
      assessment.id +
      '" aria-pressed="' +
      !rubricOn +
      '">Tags</button>' +
      '<button class="m-seg-btn' +
      (rubricOn ? ' m-seg-active' : '') +
      '" data-action="m-grade-view" data-view="rubric" data-aid="' +
      assessment.id +
      '" aria-pressed="' +
      rubricOn +
      '">Rubric</button></div></div>'
    );
  }

  function _checklistHtml(cid, sid, aid, crit, state) {
    var ticked = getRubricCheckIds(cid, sid, aid);
    var suggested = RubricChecks.suggestedLevel(crit, ticked);
    var head = suggested ? 'Suggested: ' + PROF_LABELS[suggested] : 'No Level Suggested Yet';
    var hint = !suggested
      ? 'Tick what you saw. A level is suggested when all of its boxes are ticked.'
      : state.level && state.level !== suggested
        ? 'You picked ' + PROF_LABELS[state.level] + '. Ticks keep your choice until you clear the level.'
        : 'Every ' + PROF_LABELS[suggested] + ' box is ticked. Pick another level to override.';
    var html =
      '<div class="m-checklist"><div class="m-checklist-head">' +
      MC.esc(head) +
      '</div><div class="m-checklist-hint">' +
      MC.esc(hint) +
      '</div>';
    levelOrderFor(cid).forEach(function (lv) {
      var boxes = RubricChecks.checksAt(crit, lv);
      if (!boxes.length) return;
      html +=
        '<div class="m-checklist-level"><div class="m-checklist-level-name l' + lv + '">' + PROF_LABELS[lv] + '</div>';
      boxes.forEach(function (check) {
        html +=
          '<label class="m-check"><input type="checkbox" data-action="m-grade-tick" data-sid="' +
          sid +
          '" data-aid="' +
          aid +
          '" data-critid="' +
          crit.id +
          '" data-checkid="' +
          check.id +
          '"' +
          (ticked.indexOf(check.id) >= 0 ? ' checked' : '') +
          '><span>' +
          MC.esc(check.label) +
          '</span></label>';
      });
      html += '</div>';
    });
    return html + '</div>';
  }

  /* One criterion: its name, the four levels, ± and, on an Advanced
     Rubric, the Checks button and its open checklist. */
  function _criterionGroupHtml(cid, st, assessment, rubric, crit) {
    var state = _critState(cid, st.id, assessment.id, crit);
    var btns = '';
    levelOrderFor(cid).forEach(function (level) {
      btns +=
        '<button class="m-score-btn' +
        (state.level === level ? ' m-score-active' : '') +
        (state.level === level && state.mixed ? ' m-score-mixed' : '') +
        '" data-action="m-grade-crit" data-score="' +
        level +
        '" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '" data-critid="' +
        crit.id +
        '">' +
        level +
        '</button>';
    });
    var advanced = _isAdvanced(rubric) && RubricChecks.hasChecks(crit);
    var open = advanced && !!_openChecks[st.id + ':' + assessment.id + ':' + crit.id];
    var checksBtn = '';
    if (advanced) {
      var count = RubricChecks.tickedCount(crit, getRubricCheckIds(cid, st.id, assessment.id));
      checksBtn =
        '<button class="m-checks-btn' +
        (open ? ' m-checks-open' : '') +
        '" data-action="m-grade-checks" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '" data-critid="' +
        crit.id +
        '" aria-expanded="' +
        open +
        '" aria-label="Checklist, ' +
        count.ticked +
        ' of ' +
        count.total +
        ' ticked"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>' +
        count.ticked +
        '/' +
        count.total +
        '</button>';
    }
    return (
      '<div class="m-score-group m-crit-group" data-critid="' +
      crit.id +
      '">' +
      '<div class="m-score-tag-label m-crit-label"><span class="m-crit-name">' +
      MC.esc(crit.name || 'Criterion') +
      '</span>' +
      checksBtn +
      '</div>' +
      '<div class="m-score-btns" role="radiogroup" aria-label="Score for ' +
      MC.esc(crit.name || 'criterion') +
      '">' +
      btns +
      '</div>' +
      '<div class="m-score-mods" data-sid="' +
      st.id +
      '" data-aid="' +
      assessment.id +
      '" data-critid="' +
      crit.id +
      '">' +
      _modBtnsHtml(state.mixed ? 0 : state.level, state.mod) +
      '</div>' +
      (open ? _checklistHtml(cid, st.id, assessment.id, crit, state) : '') +
      '</div>'
    );
  }

  /* Redraw one student's card in place after a criterion change. */
  function _refreshCard(cid, sid, aid) {
    var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    var assessment = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var st = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!card || !assessment || !st) return;
    card.outerHTML = _renderStudentCard(cid, st, assessment, getScores(cid), getAssignmentStatuses(cid));
  }

  function _scoreType(assessment) {
    return assessment
      ? getAssessmentCategoryId(assessment)
        ? 'summative'
        : assessment.type || 'formative'
      : 'summative';
  }

  /* Write one level (and ±) under every key of a criterion, undoable as one. */
  function _writeCriterion(cid, sid, found, level, mod) {
    var aid = found.assessment.id;
    var keys = rubricCriterionScoreKeys(found.crit);
    var prev = keys.map(function (tid) {
      var e = _currentEntry(cid, sid, aid, tid);
      return { tid: tid, prev: e ? [JSON.parse(JSON.stringify(e))] : [] };
    });
    _undoStack.push({ cid: cid, sid: sid, aid: aid, multi: prev });
    if (_undoStack.length > 20) _undoStack.shift();
    keys.forEach(function (tid) {
      upsertScore(
        cid,
        sid,
        aid,
        tid,
        level,
        found.assessment.date || getTodayStr(),
        _scoreType(found.assessment),
        '',
        mod || 0,
      );
    });
    clearProfCache();
  }

  /* A level tapped on a criterion; tapping the active one clears it. */
  function setCriterionScore(cid, sid, aid, critId, level) {
    var found = _findCriterion(cid, aid, critId);
    if (!found) return;
    var state = _critState(cid, sid, aid, found.crit);
    var cleared = state.level === level && !state.mixed;
    _writeCriterion(cid, sid, found, cleared ? 0 : level, 0);
    MC.haptic();
    _refreshCard(cid, sid, aid);
    _updateThumbGraded(cid, aid);
    if (cleared) {
      MC.showToast('Score cleared', {
        onUndo: function () {
          undoLastScore();
        },
        duration: 5000,
      });
    }
  }

  // Tapping the active + or − again clears it.
  function setCriterionMod(cid, sid, aid, critId, mod) {
    var found = _findCriterion(cid, aid, critId);
    if (!found) return;
    var state = _critState(cid, sid, aid, found.crit);
    if (!(state.level > 0) || state.mixed) return;
    var next = state.mod === mod ? 0 : mod;
    if (normalizeScoreMod(state.level, next) !== next) return;
    _writeCriterion(cid, sid, found, state.level, next);
    MC.haptic();
    _refreshCard(cid, sid, aid);
  }

  function setGradeView(cid, aid, view) {
    _rubricView[aid] = view !== 'tags';
    document.querySelectorAll('.m-grade-view-row .m-seg-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-view') === view;
      btn.classList.toggle('m-seg-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var assessment = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var swiper = document.getElementById('m-swiper');
    if (!swiper || !assessment) return;
    var left = swiper.scrollLeft;
    var scores = getScores(cid);
    var statuses = getAssignmentStatuses(cid);
    swiper.innerHTML = sortStudents(getStudents(cid).slice(), 'alpha')
      .map(function (st) {
        return _renderStudentCard(cid, st, assessment, scores, statuses);
      })
      .join('');
    swiper.scrollLeft = left;
  }

  function toggleChecklist(cid, sid, aid, critId) {
    var key = sid + ':' + aid + ':' + critId;
    if (_openChecks[key]) delete _openChecks[key];
    else _openChecks[key] = true;
    _refreshCard(cid, sid, aid);
  }

  /* A box ticked or cleared: save it, then write the level the boxes suggest
     unless the teacher picked a different one by hand. */
  function tickCheck(cid, sid, aid, critId, checkId, on) {
    var found = _findCriterion(cid, aid, critId);
    if (!found) return;
    var before = getRubricCheckIds(cid, sid, aid);
    var after = setRubricCheck(cid, sid, aid, checkId, on);
    var state = _critState(cid, sid, aid, found.crit);
    var next = RubricChecks.levelAfterTick(found.crit, state.level, before, after);
    if (next !== state.level) _writeCriterion(cid, sid, found, next, 0);
    MC.haptic();
    _refreshCard(cid, sid, aid);
    _updateThumbGraded(cid, aid);
  }

  /* ── + / − on a level ──────────────────────────────────────── */
  function _modBtnsHtml(level, mod) {
    return [-1, 1]
      .map(function (m) {
        var allowed = level > 0 && normalizeScoreMod(level, m) === m;
        return (
          '<button class="m-mod-btn' +
          (allowed && mod === m ? ' m-mod-active' : '') +
          '" data-action="m-grade-mod" data-mod="' +
          m +
          '" aria-label="' +
          (m > 0 ? 'Plus' : 'Minus') +
          '"' +
          (allowed ? '' : ' disabled') +
          '>' +
          scoreModSuffix(m) +
          '</button>'
        );
      })
      .join('');
  }

  function _currentEntry(cid, sid, aid, tid) {
    var matches = (getScores(cid)[sid] || []).filter(function (s) {
      return s.assessmentId === aid && s.tagId === tid;
    });
    return matches.length ? matches[matches.length - 1] : null;
  }

  function _syncModBtns(cid, sid, aid, tid) {
    var box = document.querySelector(
      '.m-swiper-card[data-sid="' + sid + '"] .m-score-mods[data-aid="' + aid + '"][data-tid="' + tid + '"]',
    );
    if (!box) return;
    var e = _currentEntry(cid, sid, aid, tid);
    var level = e ? e.score : 0;
    box.innerHTML = _modBtnsHtml(level, e ? normalizeScoreMod(level, e.mod) : 0);
  }

  // Tapping the active + or − again clears it.
  function setScoreMod(cid, sid, aid, tid, mod) {
    var e = _currentEntry(cid, sid, aid, tid);
    if (!e || !(e.score > 0)) return;
    var next = normalizeScoreMod(e.score, e.mod) === mod ? 0 : mod;
    if (normalizeScoreMod(e.score, next) !== next) return;
    _undoStack.push({ cid: cid, sid: sid, aid: aid, tid: tid, prev: [JSON.parse(JSON.stringify(e))] });
    if (_undoStack.length > 20) _undoStack.shift();
    var assessment = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var type = assessment
      ? getAssessmentCategoryId(assessment)
        ? 'summative'
        : assessment.type || 'formative'
      : 'summative';
    upsertScore(cid, sid, aid, tid, e.score, assessment ? assessment.date : getTodayStr(), type, e.note || '', next);
    clearProfCache();
    MC.haptic();
    _syncModBtns(cid, sid, aid, tid);
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
    _syncModBtns(cid, sid, aid, tid);

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
    // Missing and Excused never go on work with a score or feedback.
    if (!canSetAssignmentStatus(cid, sid, aid, newStatus)) return;
    setAssignmentStatus(cid, sid, aid, newStatus);
    MC.haptic();

    // NS auto-zero: match desktop behaviour (page-assignments.js
    // toggleStudentStatus). Setting NS on proficiency work zeroes every tag
    // score under it (0 deletes a tag score). Clearing NS does NOT
    // auto-restore — the teacher has to re-score. On points and
    // Complete/Incomplete work 0 is a real score that would outlive the NS,
    // and calc.js already counts NS as 0, so the score is left alone.
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var clearsScores = !!assess && !isPointsScored(assess);
    if (newStatus === 'NS' && clearsScores) {
      scoreTagIds(assess, cid).forEach(function (tagId) {
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

    // Update pill states
    var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    if (card) {
      card.querySelectorAll('.m-status-pill').forEach(function (pill) {
        pill.classList.toggle('m-status-active', pill.getAttribute('data-val') === newStatus);
      });
      // After auto-zero, deactivate every score button under this (sid, aid)
      // so the UI reflects the zeroed state (no button matches score=0).
      if (newStatus === 'NS' && clearsScores) {
        card.querySelectorAll('.m-score-btn[data-aid="' + aid + '"]').forEach(function (btn) {
          btn.classList.remove('m-score-active');
        });
        card.querySelectorAll('.m-score-mods[data-aid="' + aid + '"]').forEach(function (box) {
          box.innerHTML = _modBtnsHtml(0, 0);
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
    if (newStatus === 'NS' && clearsScores) {
      _updateThumbGraded(cid, aid);
    }
  }

  function undoLastScore() {
    var entry = _undoStack.pop();
    if (!entry) return;
    if (entry.multi) return _undoCriterion(entry);
    var allScores = getScores(entry.cid);
    var beforeScores = structuredClone(allScores);
    var stScores = (allScores[entry.sid] || []).filter(function (s) {
      return !(s.assessmentId === entry.aid && s.tagId === entry.tid);
    });
    // Restore previous entries
    entry.prev.forEach(function (p) {
      stScores.push(p);
    });
    allScores[entry.sid] = stScores;
    saveScores(entry.cid, allScores);
    persistScoreDiffToCanonical(entry.cid, beforeScores, allScores);
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
    _syncModBtns(entry.cid, entry.sid, entry.aid, entry.tid);
    _updateThumbGraded(entry.cid, entry.aid);
    MC.showToast('Score reverted');
  }

  /* A criterion's change, put back on every key it wrote. */
  function _undoCriterion(entry) {
    var allScores = getScores(entry.cid);
    var beforeScores = structuredClone(allScores);
    var tids = entry.multi.map(function (m) {
      return m.tid;
    });
    var stScores = (allScores[entry.sid] || []).filter(function (s) {
      return !(s.assessmentId === entry.aid && tids.indexOf(s.tagId) >= 0);
    });
    entry.multi.forEach(function (m) {
      m.prev.forEach(function (p) {
        stScores.push(p);
      });
    });
    allScores[entry.sid] = stScores;
    saveScores(entry.cid, allScores);
    persistScoreDiffToCanonical(entry.cid, beforeScores, allScores);
    clearProfCache();
    _refreshCard(entry.cid, entry.sid, entry.aid);
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
    _updateSubtitle(idx, document.querySelectorAll('#m-thumb-strip .m-thumb').length);
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
    // A score just changed: M and EXC grey out once the work has one.
    document.querySelectorAll('.m-status-pill[data-aid="' + aid + '"]').forEach(function (pill) {
      pill.disabled = !canSetAssignmentStatus(cid, pill.dataset.sid, aid, pill.dataset.val);
    });
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var allScores = getScores(cid);
    var assessment = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
    thumbs.forEach(function (t, i) {
      if (i >= students.length) return;
      var st = students[i];
      var stScores = allScores[st.id] || [];
      var isGraded = stScores.some(function (s) {
        return s.assessmentId === aid && isScoreEntered(assessment, s);
      });
      t.classList.toggle('m-thumb-graded', isGraded);
    });
  }

  /* ── Complete / Incomplete ──────────────────────────────── */
  function _completionBtnsHtml(mark) {
    return (
      '<div class="m-cmp-btns">' +
      ['complete', 'incomplete']
        .map(function (m) {
          return (
            '<button class="m-cmp-btn m-cmp-' +
            m +
            (mark === m ? ' m-cmp-active' : '') +
            '" data-action="m-grade-completion" data-mark="' +
            m +
            '">' +
            (m === 'complete' ? '\u2713 Complete' : '\u2717 Incomplete') +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // Tapping the active mark again clears it.
  function setCompletion(cid, sid, aid, mark) {
    var next = getCompletionMark(cid, sid, aid) === mark ? null : mark;
    setCompletionMark(cid, sid, aid, next);
    clearProfCache();
    MC.haptic();
    var group = document.querySelector('.m-cmp-group[data-sid="' + sid + '"][data-aid="' + aid + '"]');
    if (group) group.innerHTML = _completionBtnsHtml(next);
    _updateThumbGraded(cid, aid);
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
    setScoreMod: setScoreMod,
    setCriterionScore: setCriterionScore,
    setCriterionMod: setCriterionMod,
    setGradeView: setGradeView,
    toggleChecklist: toggleChecklist,
    tickCheck: tickCheck,
    setStatus: setStatus,
    adjustPointsScore: adjustPointsScore,
    setCompletion: setCompletion,
    undoLastScore: undoLastScore,
    setupSwiper: setupSwiper,
    jumpToStudent: jumpToStudent,
  };
})();
