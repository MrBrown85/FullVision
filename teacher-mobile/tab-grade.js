/* tab-grade.js — the phone's Grade tab: the list of assessments and the speed grader */

window.MGrade = (function () {
  'use strict';

  var MC = window.MComponents;

  /* The tab is two parts, which share only the two helpers below:
     - the list (List): the assessments under Recent, To Return and All,
       the filter sheet, and the To Return lists, the tab's and the
       student card's;
     - the grader (Speed): one assessment's cards, the strip of students,
       every write, and Return and Next. The place on a card where the
       student's work shows is teacher-mobile/grade-photos.js's.
     MGrade is the two together, as shell.js and the card widgets use it. */

  /* ── Draft and Returned (S1-F3) ───────────────────────────────
     In a class whose student page is on (the build switch) and that returns
     grades When I Return Them, a grade is a draft until it is returned
     (shared/grade-state.js). The phone then has three more things:
     - the grading screen's bar above the tab bar: the Draft mark, "Saved.
       Not returned yet." and Return and Next, or "Returned Nov 3";
     - the Grade tab's To Return list: each assessment with drafts, who is
       waiting, and Return N, which asks first;
     - the student card's To Return list (teacher-mobile/card-widgets.js).
     In any other class none of it is drawn and nothing here runs past
     _holdsGrades: the phone's HTML is what it was
     (tests/phone-return.test.js).

     Every count is GradeState.draftsIn, which asks GradeState.stateOf, as
     the desktop's grader, gradebook and Class Settings do: a Missing or
     Excused piece is never a draft, a DIBELS benchmark has no state, and
     the To Return list's rows add up to GradeState.draftsWaiting. Every
     return goes through Grader.returnGrades.

     Who a Return returns (pair and group partners included), the line of
     names and the question's words are shared/grade-state.js's, as they
     are the gradebook's (S1-T5). */
  function _holdsGrades(cid) {
    if (!cid || typeof getReturnSettings !== 'function' || !window.GradeState) return false;
    var klass = getReturnSettings(cid);
    return !!klass.student_page && GradeState.holds(klass);
  }

  function _assessmentById(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a.id === aid;
      }) || null
    );
  }

  /* ══ The list ════════════════════════════════════════════════ */
  var List = (function () {
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

    // Every student in the class: the phone's lists hide nobody.
    function _rosterIds(cid) {
      return sortStudents(getStudents(cid), 'lastName').map(function (s) {
        return s.id;
      });
    }

    /* Return the drafts `sids` hold on `aid`, and their partners': the
       grader is handed each one's whole pair or group, as the desktop's
       Return hands it, and returns the drafts among them. The drafts are
       counted again here, so a question answered late returns what is
       waiting now. True when any was returned. */
    function _returnDrafts(cid, aid, sids) {
      if (!_holdsGrades(cid)) return false;
      var waiting = GraderWork.draftsIn(cid, aid, sids);
      if (!waiting.length) return false;
      Grader.returnGrades(cid, aid, GradeState.returnTogether(cid, aid, waiting));
      clearProfCache();
      return true;
    }

    /* A Return that returns more than the one grade on screen, or names
       nobody, asks first (Colin, 2026-11-10), in the desktop's words: "Return
       3 Grades Now?", who is waiting, Return 3 Graded and Cancel. `then` runs
       once the drafts are returned. */
    function _askReturn(cid, aid, waiting, sids, from, then) {
      var n = waiting.length;
      MC.confirmSheet(
        GradeState.returnQuestion(n),
        GradeState.draftsSentence(cid, waiting),
        GradeState.returnNGraded(n),
        function () {
          if (_returnDrafts(cid, aid, sids)) MC.haptic();
          then();
        },
        from,
      );
    }

    /* ── The Grade tab's To Return list ──────────────────────────── */

    // The assessments with a draft, newest first, each with who is waiting.
    function _toReturnRows(cid) {
      var ids = _rosterIds(cid);
      return getAssessments(cid)
        .slice()
        .sort(function (a, b) {
          return (b.date || '').localeCompare(a.date || '');
        })
        .map(function (a) {
          return { a: a, waiting: GraderWork.draftsReturned(cid, a.id, ids) };
        })
        .filter(function (row) {
          return row.waiting.length > 0;
        });
    }

    // html-safe: n is a number
    function _toReturnSegHtml(n) {
      return 'To Return' + (n ? '<span class="m-seg-count" aria-hidden="true">' + n + '</span>' : '');
    }

    function _toReturnSegLabel(n) {
      return n ? 'To Return, ' + n + (n === 1 ? ' draft' : ' drafts') : '';
    }

    // html-safe: titles, names, the category and the class name go through MC.esc; ids are ours; counts are numbers
    function _toReturnHtml(cid, rows) {
      if (!rows.length) {
        var course = COURSES[cid];
        return (
          '<div class="m-empty m-to-return-empty"><div class="m-empty-title">Nothing to Return</div>' +
          '<div class="m-empty-subtitle">' +
          MC.esc('No grades are waiting as drafts in ' + ((course && course.name) || 'this class') + '.') +
          '</div>' +
          '<button type="button" class="m-btn-ghost" data-action="m-grade-seg" data-val="all">See All Assessments</button>' +
          '</div>'
        );
      }
      return (
        '<div class="m-list m-to-return-list">' +
        rows
          .map(function (row) {
            var a = row.a;
            var n = row.waiting.length;
            var meta = [];
            if (showsCategoryBadge(cid, a)) meta.push(getAssessmentCategoryName(cid, a));
            meta.push(
              a.date
                ? parseLocalDate(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
                : 'No Date',
            );
            return (
              '<div class="m-to-return-row" data-aid="' +
              a.id +
              '">' +
              // Opens the grading screen on the first draft.
              '<button type="button" class="m-to-return-open" data-action="m-grade-assess" data-open="draft" data-aid="' +
              a.id +
              '">' +
              '<span class="m-to-return-title">' +
              MC.esc(a.title) +
              '</span>' +
              '<span class="m-to-return-who"><span class="m-draft-mark">' +
              n +
              (n === 1 ? ' draft' : ' drafts') +
              '</span><span class="m-to-return-names">' +
              MC.esc(GradeState.draftNames(cid, row.waiting).join(', ')) +
              '</span></span>' +
              '<span class="m-to-return-meta">' +
              MC.esc(meta.join(' · ')) +
              '</span>' +
              '</button>' +
              '<button type="button" class="m-return-btn" data-action="m-grade-return-all" data-aid="' +
              a.id +
              '" aria-label="' +
              MC.esc(GradeState.returnNGraded(n) + ', ' + a.title) +
              '"><span>Return ' +
              n +
              '</span></button>' +
              '</div>'
            );
          })
          .join('') +
        '</div>' +
        '<p class="m-to-return-note">Graded but not returned. Students see these after you return them.</p>'
      );
    }

    /* The To Return list and its count, drawn again from the class as it is
       now: after a return, and when the Grade tab comes back from a grading
       screen (shell.js). Nothing is drawn in a class that holds no grades. */
    function refreshToReturn(cid) {
      if (!_holdsGrades(cid)) return;
      var panel = document.getElementById('m-grade-to-return');
      if (!panel) return;
      var rows = _toReturnRows(cid);
      var n = rows.reduce(function (sum, row) {
        return sum + row.waiting.length;
      }, 0);
      // html-safe: built by _toReturnHtml
      panel.innerHTML = _toReturnHtml(cid, rows);
      var seg = document.querySelector('.m-seg-btn[data-action="m-grade-seg"][data-val="toreturn"]');
      if (!seg) return;
      // html-safe: built by _toReturnSegHtml
      seg.innerHTML = _toReturnSegHtml(n);
      if (n) seg.setAttribute('aria-label', _toReturnSegLabel(n));
      else seg.removeAttribute('aria-label');
    }

    /* Return N on a To Return row. The button shows a count and no names,
       so it asks first, for one draft too. Afterwards the list is drawn
       again; the row is gone, so the next row, or the To Return tab, takes
       the focus. */
    function askReturnAll(cid, aid, button) {
      if (!_holdsGrades(cid)) return;
      var ids = _rosterIds(cid);
      var waiting = GraderWork.draftsReturned(cid, aid, ids);
      if (!waiting.length) return refreshToReturn(cid);
      _askReturn(cid, aid, waiting, ids, button, function () {
        var rows = Array.prototype.slice.call(document.querySelectorAll('#m-grade-to-return .m-to-return-row'));
        var at = rows.findIndex(function (r) {
          return r.getAttribute('data-aid') === aid;
        });
        refreshToReturn(cid);
        var left = document.querySelectorAll('#m-grade-to-return .m-to-return-open');
        var next =
          left[Math.min(Math.max(at, 0), left.length - 1)] ||
          document.querySelector('.m-seg-btn[data-action="m-grade-seg"][data-val="toreturn"]');
        if (next) next.focus({ preventScroll: true });
      });
    }

    /* ── The student card's To Return list ───────────────────────── */

    /* The assessments on which `sid` has a draft, newest first: the rows of
       the card's To Return list (teacher-mobile/card-widgets.js). Empty in a
       class that holds no grades. */
    function studentDrafts(cid, sid) {
      if (!_holdsGrades(cid)) return [];
      return getAssessments(cid)
        .filter(function (a) {
          return GraderWork.draftsIn(cid, a.id, [sid]).length > 0;
        })
        .sort(function (a, b) {
          return (b.date || '').localeCompare(a.date || '');
        });
    }

    /* Return on a row of the card's To Return list. The row names the
       student and shows the grade, so returning that one grade is one tap.
       On pair or group work a partner's draft is returned with it, so it
       asks first and names everyone. `then` runs once the return is done. */
    function returnFromCard(cid, aid, sid, button, then) {
      if (!_holdsGrades(cid)) return;
      var waiting = GraderWork.draftsReturned(cid, aid, [sid]);
      if (!waiting.length) return then();
      if (waiting.length > 1) return _askReturn(cid, aid, waiting, [sid], button, then);
      if (_returnDrafts(cid, aid, [sid])) MC.haptic();
      then();
    }

    /* ── Student work on the list (S7-F1) ────────────────────────
       In a class whose students send work (MGradePhotos.on: the build
       switch and Send Work), the list opens on To Grade: the pieces with
       work waiting, each saying how many are waiting and how many are not
       in, with a ⋯ menu. With nothing waiting it says All Caught Up. The
       filter sheet applies as it is tapped. In any other class none of
       this is drawn. */
    var _MORE_ROW_ICON =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
    var _CAMERA_ICON =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

    // html-safe: n is a number
    function _toGradeSegHtml(cid, active, holds) {
      var n = MGradePhotos.classToGrade(cid);
      return (
        '<button class="m-seg-btn' +
        (active ? ' m-seg-active' : '') +
        '" data-action="m-grade-seg" data-val="tograde"' +
        (holds ? ' aria-pressed="' + active + '"' : '') +
        ' aria-label="To Grade, ' +
        n +
        '">To Grade<span class="m-seg-count m-seg-count-tograde" aria-hidden="true">' +
        n +
        '</span></button>'
      );
    }

    // html-safe: the title and category go through MC.esc; ids are ours; counts are numbers; dateStr is a date
    function _workRowHtml(cid, a, dateStr, graded, total, pct, shown) {
      // GraderWork's counts (grade-photos.js): a group graded together is one to grade.
      var waiting = MGradePhotos.toGradeCount(cid, a);
      var out = MGradePhotos.notIn(cid, a).length;
      var takes = MGradePhotos.takes(cid, a);
      var meta = [];
      if (showsCategoryBadge(cid, a)) meta.push(getAssessmentCategoryName(cid, a));
      meta.push(dateStr, graded + '/' + total + ' graded');
      var counts = '';
      if (waiting) counts += '<span class="m-tg-pill">' + _CAMERA_ICON + waiting + ' to grade</span>';
      if (out) counts += '<span class="m-tg-notin">' + out + ' not in</span>';
      if (!counts && takes && graded >= total && total > 0) counts = '<span class="m-tg-done">All graded</span>';
      return (
        '<div class="m-cell m-tg-row" data-action="m-grade-assess" data-aid="' +
        a.id +
        '" data-tg="' +
        waiting +
        '"' +
        (shown ? '' : ' style="display:none"') +
        '>' +
        '<div class="m-cell-body">' +
        '<div class="m-cell-title m-grade-title">' +
        MC.esc(a.title) +
        '</div>' +
        (counts ? '<div class="m-tg-counts">' + counts + '</div>' : '') +
        '<div class="m-cell-subtitle"><span>' +
        MC.esc(meta.join(' · ')) +
        '</span></div>' +
        '<div class="m-progress-bar"><div class="m-progress-fill" style="width:' +
        pct +
        '%"></div></div>' +
        '</div>' +
        '<button type="button" class="m-tg-more" data-action="m-grade-row-menu" data-aid="' +
        a.id +
        '" aria-label="' +
        MC.esc('More for ' + a.title) +
        '">' +
        _MORE_ROW_ICON +
        '</button></div>'
      );
    }

    // html-safe: the class name goes through MC.esc
    function _caughtUpHtml(cid, sorted, ctx) {
      var any = sorted.some(function (a) {
        return _matchesAllFilters(a, ctx);
      });
      var course = COURSES[cid];
      return (
        '<div class="m-empty m-tg-caught" id="m-grade-caught"' +
        (_segmentMode === 'tograde' && !any ? '' : ' style="display:none"') +
        '><div class="m-tg-caught-icon" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        '<div class="m-empty-title">All Caught Up</div>' +
        '<div class="m-empty-subtitle">' +
        MC.esc('Nothing is waiting to grade in ' + ((course && course.name) || 'this class') + '.') +
        '</div>' +
        '<button type="button" class="m-tg-caught-btn" data-action="m-grade-seg" data-val="all">See All Assessments</button>' +
        '</div>'
      );
    }

    // "Logan F., Olivia M."
    function _shortNames(cid, sids) {
      var byId = {};
      getStudents(cid).forEach(function (st) {
        byId[st.id] = st;
      });
      return sids
        .map(function (sid) {
          var st = byId[sid];
          if (!st) return '';
          var last = String(st.lastName || '');
          return (displayNameFirst(st) || '') + (last ? ' ' + last.charAt(0) + '.' : '');
        })
        .filter(Boolean)
        .join(', ');
    }

    /* The ⋯ on a row: Grade the N Waiting (from the first waiting), Add
       Work for the N Not In (the not-in pile, S7-F3), Work Wall (S14-F1,
       shared/work-wall.js) and Grade Everyone (the whole class, in roster
       order). */
    // The row menu's icons (paths inside a 24-unit box).
    var _MENU_ICONS = {
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
      grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
      pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    };

    function openRowMenu(cid, aid, from) {
      var a = _assessmentById(cid, aid);
      if (!a) return;
      var waiting = MGradePhotos.toGrade(cid, a);
      var students = getStudents(cid);
      var graded = _gradedCountFor(a, students, getScores(cid));
      var dateStr = a.date
        ? parseLocalDate(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
        : 'No Date';
      var meta = [];
      if (showsCategoryBadge(cid, a)) meta.push(getAssessmentCategoryName(cid, a));
      meta.push(dateStr, graded + '/' + students.length + ' graded');
      var firstSt = waiting.length
        ? students.find(function (st) {
            return st.id === waiting[0];
          })
        : null;
      var notIn = MGradePhotos.notIn(cid, a);
      var wall = !!(window.WorkWall && window.GraderWork && GraderWork.workOn(cid, a));
      var item = function (attrs, title, sub, action, icon) {
        return (
          '<button type="button" class="m-tg-menu-item" data-action="' +
          (action || 'm-grade-assess') +
          '" data-aid="' +
          a.id +
          '"' +
          attrs +
          '><span class="m-tg-menu-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          _MENU_ICONS[icon] +
          '</svg></span><span class="m-tg-menu-text"><span class="m-tg-menu-title">' +
          MC.esc(title) +
          '</span><span class="m-tg-menu-sub">' +
          MC.esc(sub) +
          '</span></span></button>'
        );
      };
      // html-safe: every text goes through MC.esc in item() or here; ids are ours
      MC.presentSheet(
        '<div class="m-tg-menu m-tg-action" role="dialog" aria-label="' +
          MC.esc(a.title) +
          '"><div class="m-tg-action-card"><div class="m-tg-menu-head"><div class="m-tg-menu-name">' +
          MC.esc(a.title) +
          '</div><div class="m-tg-menu-sub">' +
          MC.esc(meta.join(' · ')) +
          '</div></div>' +
          (waiting.length
            ? item(
                ' data-only="tograde"',
                'Grade the ' + MGradePhotos.toGradeCount(cid, a) + ' Waiting',
                firstSt ? 'Starts with ' + displayNameWithLast(firstSt) : '',
                null,
                'check',
              )
            : '') +
          (notIn.length
            ? item(
                ' data-sid="' + notIn[0] + '"',
                'Add Work for the ' + notIn.length + ' Not In',
                _shortNames(cid, notIn),
                'm-add-work',
                'camera',
              )
            : '') +
          (wall ? item('', 'Work Wall', 'Everyone’s work side by side', 'm-work-wall', 'grid') : '') +
          item('', 'Grade Everyone', 'All ' + students.length + ', in roster order', null, 'pencil') +
          // Cancel is a card of its own (the board "Grade Tab, Row Menu").
          '</div><button type="button" class="m-tg-menu-cancel" data-action="m-sheet-cancel">Cancel</button>' +
          '</div>',
        { action: true },
      );
    }

    /* ── Assessment Picker Screen ───────────────────────────────── */
    var _pickerCid = null;
    function renderPicker(cid) {
      var nav = MC.navBar({
        id: 'grade-picker',
        title: 'Grade',
        compact: true,
        classId: cid,
        rightHTML:
          '<div class="m-sync" role="status"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>' +
          '<button class="m-nav-bar-action" data-action="m-settings" title="Settings">' +
          MC.ICONS.settings +
          '</button>',
      });

      var assessments = getAssessments(cid);
      var students = getStudents(cid);
      var allScores = getScores(cid);

      // Load persisted filters for this course. Cells that don't match are
      // drawn hidden, so the list never flashes unfiltered.
      _filters = _loadFilters(cid);
      // To Return (S1-F3) is offered only in a class that holds grades. The
      // list stays on it when the tab is drawn again for the same class.
      var holds = _holdsGrades(cid);
      var onToReturn = holds && _segmentMode === 'toreturn' && _pickerCid === cid;
      _pickerCid = cid;
      // Saved filters cover the whole list; with none, the list opens on
      // Recent, or on To Grade in a class whose students send work (S7-F1).
      var work = MGradePhotos.on(cid);
      var first = work ? 'tograde' : 'recent';
      _segmentMode = onToReturn ? 'toreturn' : _activeFilterCount() > 0 ? 'all' : first;
      var ctx = _filterCtx(cid);

      // Sort by date, newest first
      var sorted = assessments.slice().sort(function (a, b) {
        return b.date.localeCompare(a.date);
      });

      // Filter bar: quick segments + a "more filters" icon button that opens
      // the multi-dimension bottom sheet. Ungraded moved into the sheet as
      // gradedStatus='has-ungraded' (richer: also supports fully-graded).
      var activeN = _activeFilterCount();
      var toReturnRows = holds ? _toReturnRows(cid) : [];
      var toReturnN = toReturnRows.reduce(function (sum, row) {
        return sum + row.waiting.length;
      }, 0);
      // In a class that holds grades each segment also says whether it is
      // the one chosen (aria-pressed), and To Return sits between the two.
      var pressed = function (mode) {
        return holds ? ' aria-pressed="' + (_segmentMode === mode) + '"' : '';
      };
      var segmented =
        '<div class="m-grade-filter-bar">' +
        '<div class="m-segmented' +
        (holds ? ' m-seg-three' : '') +
        '">' +
        (work
          ? _toGradeSegHtml(cid, _segmentMode === 'tograde', holds)
          : '<button class="m-seg-btn' +
            (_segmentMode === 'recent' ? ' m-seg-active' : '') +
            '" data-action="m-grade-seg" data-val="recent"' +
            pressed('recent') +
            '>Recent</button>') +
        (holds
          ? '<button class="m-seg-btn' +
            (onToReturn ? ' m-seg-active' : '') +
            '" data-action="m-grade-seg" data-val="toreturn"' +
            pressed('toreturn') +
            (toReturnN ? ' aria-label="' + _toReturnSegLabel(toReturnN) + '"' : '') +
            '>' +
            _toReturnSegHtml(toReturnN) +
            '</button>'
          : '') +
        '<button class="m-seg-btn' +
        (_segmentMode === 'all' ? ' m-seg-active' : '') +
        '" data-action="m-grade-seg" data-val="all"' +
        pressed('all') +
        '>All</button>' +
        '</div>' +
        '<button class="m-grade-filter-btn" data-action="m-grade-filter-open" aria-label="Filter assessments"' +
        ' aria-haspopup="dialog"' +
        '>' +
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
          var dateStr = a.date
            ? parseLocalDate(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
            : 'No Date';
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

          if (work) {
            cells += _workRowHtml(cid, a, dateStr, gradedCount, total, pct, _matchesAllFilters(a, ctx));
            return;
          }
          cells +=
            '<div class="m-cell" data-action="m-grade-assess" data-aid="' +
            a.id +
            '"' +
            (_matchesAllFilters(a, ctx) ? '' : ' style="display:none"') +
            '>' +
            '<div class="m-cell-body">' +
            // The title has its own line (up to two); the category goes on
            // the line under it, so a long category can't squeeze the title.
            '<div class="m-cell-title m-grade-title">' +
            MC.esc(a.title) +
            '</div>' +
            '<div class="m-cell-subtitle">' +
            // A class with no categories shows no "No Category" chip.
            (showsCategoryBadge(cid, a)
              ? '<span class="m-type-badge ' + badge.className + '">' + MC.esc(badge.label) + '</span>'
              : '') +
            '<span>' +
            dateStr +
            '</span>' +
            '<span>' +
            tagCount +
            (tagCount !== 1 ? ' competencies' : ' competency') +
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
      // To Grade with nothing waiting (S7-F1).
      if (work) cells += _caughtUpHtml(cid, sorted, ctx);
      // The To Return list has its own box beside the list of assessments;
      // the segment shows one or the other (_showSegment).
      if (holds)
        cells =
          '<div id="m-grade-main"' +
          (onToReturn ? ' hidden' : '') +
          '>' +
          cells +
          '</div><div id="m-grade-to-return"' +
          (onToReturn ? '' : ' hidden') +
          '>' +
          _toReturnHtml(cid, toReturnRows) +
          '</div>';

      return (
        '<div class="m-screen" id="m-screen-grade-picker">' +
        nav +
        '<div class="m-screen-content">' +
        segmented +
        cells +
        '</div></div>'
      );
    }

    // The list of assessments or the To Return list, whichever the segment says.
    function _showSegment(cid) {
      if (!_holdsGrades(cid)) return;
      var main = document.getElementById('m-grade-main');
      var panel = document.getElementById('m-grade-to-return');
      if (!main || !panel) return;
      var onToReturn = _segmentMode === 'toreturn';
      if (onToReturn) refreshToReturn(cid);
      // See All Assessments is in the box it hides: the chosen segment takes
      // the focus it had.
      var hiding = onToReturn ? main : panel;
      var held = !!document.activeElement && hiding.contains(document.activeElement);
      _setHidden(main, onToReturn);
      _setHidden(panel, !onToReturn);
      if (!held) return;
      var seg = document.querySelector('.m-seg-btn[data-action="m-grade-seg"][data-val="' + _segmentMode + '"]');
      if (seg) seg.focus({ preventScroll: true });
    }

    function _setHidden(el, hidden) {
      if (hidden) el.setAttribute('hidden', '');
      else el.removeAttribute('hidden');
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
      // An undated assessment is in no date range, as in no term.
      if (_segmentMode === 'recent') {
        if (ctx.recentCutoff && (!a.date || parseLocalDate(a.date) < ctx.recentCutoff)) return false;
      }
      // To Grade: only the pieces with work waiting (S7-F1).
      if (_segmentMode === 'tograde' && !MGradePhotos.toGrade(ctx.cid, a).length) return false;
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
          if (!a.date) return false;
          var day = parseLocalDate(a.date);
          if (day < parseLocalDate(ctx.term.starts_on) || day > parseLocalDate(ctx.term.ends_on)) return false;
        } else {
          var cutoff = ctx.dateCutoffs[_filters.dateRange];
          if (cutoff && (!a.date || parseLocalDate(a.date) < cutoff)) return false;
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
    function _filterCtx(cid) {
      var now = new Date();
      return {
        cid: cid,
        students: getStudents(cid),
        allScores: getScores(cid),
        recentCutoff: new Date(now.getTime() - 30 * 86400000),
        dateCutoffs: {
          week: new Date(now.getTime() - 7 * 86400000),
          '30d': new Date(now.getTime() - 30 * 86400000),
        },
        term: _termForValue(cid, _filters.dateRange),
      };
    }

    function filterAssessments(cid, mode) {
      // To Return is a segment only in a class that holds grades (S1-F3).
      if (mode === 'toreturn' && !_holdsGrades(cid)) mode = null;
      // To Grade is a segment only in a class whose students send work (S7-F1).
      if (mode === 'tograde' && !MGradePhotos.on(cid)) mode = 'recent';
      if (mode) _segmentMode = mode;
      // Recent is itself a date range, so it replaces the sheet's.
      if (mode === 'recent' && _filters.dateRange !== 'all') {
        _filters.dateRange = 'all';
        _saveFilters(cid);
      }

      var assessments = getAssessments(cid);
      var ctx = _filterCtx(cid);

      // Update segmented control active state
      document.querySelectorAll('.m-seg-btn[data-action="m-grade-seg"]').forEach(function (btn) {
        btn.classList.toggle('m-seg-active', btn.getAttribute('data-val') === _segmentMode);
        if (btn.hasAttribute('aria-pressed'))
          btn.setAttribute('aria-pressed', btn.getAttribute('data-val') === _segmentMode ? 'true' : 'false');
      });
      _showSegment(cid);

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
      _syncWorkList(cid, assessments, ctx);

      _updateFilterBadge();
    }

    /* The filter sheet's "Showing 6 of 18", and All Caught Up (a class
       whose students send work), for the list as it is now. */
    function _syncWorkList(cid, assessments, ctx) {
      var shown = assessments.filter(function (a) {
        return _matchesAllFilters(a, ctx);
      }).length;
      var caught = MGradePhotos.on(cid) ? document.getElementById('m-grade-caught') : null;
      if (caught) caught.style.display = _segmentMode === 'tograde' && !shown ? '' : 'none';
      var count = document.querySelector('#m-sheet-container .m-live-filter-count');
      if (count) count.textContent = 'Showing ' + shown + ' of ' + assessments.length;
    }

    /* ── Filter sheet ───────────────────────────────────────────── */

    /* The filter that applies as it is tapped (S7-F1, the board "Grade
       Tab, Filter That Applies As You Tap"), in every class: Status, Date,
       Category and Module chips, "Showing 6 of 18", Clear All and Done.
       Each tap changes the list under the sheet at once and is kept. */

    // html-safe: labels go through MC.esc; values are ours or category ids through MC.esc
    function _renderLiveFilterSheet(cid) {
      var categories = typeof getCategories === 'function' ? getCategories(cid) : [];
      var modules = typeof getModules === 'function' ? getModules(cid) : [];
      var chip = function (action, kind, value, label, on) {
        return (
          '<button type="button" class="m-filter-pill' +
          (on ? ' m-filter-active' : '') +
          '" data-action="' +
          action +
          '" data-kind="' +
          kind +
          '" data-val="' +
          MC.esc(value) +
          '" aria-pressed="' +
          (on ? 'true' : 'false') +
          '">' +
          MC.esc(label) +
          '</button>'
        );
      };
      var one = function (kind, value, label) {
        return chip('m-grade-filter-seg', kind, value, label, _filters[kind] === value);
      };
      // Category and Module: any number of chips, and their None.
      var many = function (kind, list, none) {
        return (
          list
            .map(function (x) {
              return chip('m-grade-filter-toggle', kind, x.id, x.name, _filters[kind].indexOf(x.id) >= 0);
            })
            .join('') + chip('m-grade-filter-toggle', kind, '__none', none, _filters[kind].indexOf('__none') >= 0)
        );
      };
      var section = function (title, chips) {
        return (
          '<div class="m-filter-sheet-section"><div class="m-filter-sheet-title">' +
          title +
          '</div><div class="m-filter-strip m-filter-strip-wrap">' +
          chips +
          '</div></div>'
        );
      };
      var assessments = getAssessments(cid);
      var ctx = _filterCtx(cid);
      var shown = assessments.filter(function (a) {
        return _matchesAllFilters(a, ctx);
      }).length;
      return (
        '<div class="m-filter-sheet m-live-filter" role="dialog" aria-label="Filter">' +
        '<div class="m-live-filter-head">' +
        '<div class="m-filter-sheet-heading">Filter</div>' +
        '<button type="button" class="m-btn-ghost m-live-filter-clear" data-action="m-grade-filter-clear">Clear All</button>' +
        '<button type="button" class="m-btn-ghost m-live-filter-done" data-action="m-grade-filter-done">Done</button>' +
        '</div>' +
        '<div class="m-live-filter-count" role="status">' +
        MC.esc('Showing ' + shown + ' of ' + assessments.length) +
        '</div>' +
        section(
          'Status',
          one('gradedStatus', 'has-ungraded', 'Needs Grading') + one('gradedStatus', 'fully-graded', 'All Graded'),
        ) +
        section(
          'Date',
          one('dateRange', 'week', 'This Week') +
            one('dateRange', '30d', 'Last 30 Days') +
            _terms(cid)
              .map(function (t) {
                return one('dateRange', _termValue(t), t.label);
              })
              .join(''),
        ) +
        ((categories || []).length ? section('Category', many('category', categories, 'No Category')) : '') +
        ((modules || []).length ? section('Module', many('module', modules, 'No Module')) : '') +
        '</div>'
      );
    }

    // The live sheet's chips, drawn again from the filters as they are.
    function _syncLiveChips() {
      document.querySelectorAll('#m-sheet-container .m-live-filter .m-filter-pill').forEach(function (btn) {
        var kind = btn.getAttribute('data-kind');
        var val = btn.getAttribute('data-val');
        var on = kind === 'category' ? _filters.category.indexOf(val) >= 0 : _filters[kind] === val;
        btn.classList.toggle('m-filter-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    // The filters apply to the whole list: Recent would otherwise keep
    // hiding older work under them without a word.
    function _liveChanged() {
      _saveFilters(_pickerCid);
      _syncLiveChips();
      filterAssessments(_pickerCid, _segmentMode === 'recent' && _activeFilterCount() > 0 ? 'all' : null);
    }

    function doneFilterSheet() {
      MC.dismissSheet();
    }

    function openFilterSheet(cid) {
      MC.presentSheet(_renderLiveFilterSheet(cid));
    }

    /* ── Action dispatch from shell.js ──────────────────────────── */

    function onFilterTogglePill(kind, value) {
      var list = _filters[kind];
      if (!Array.isArray(list)) return;
      var at = list.indexOf(value);
      if (at >= 0) list.splice(at, 1);
      else list.push(value);
      _liveChanged();
    }

    // A chip tapped again lets go of it.
    function onFilterSegChange(kind, value) {
      _filters[kind] = _filters[kind] === value ? 'all' : value;
      _liveChanged();
    }

    function clearFilterSheet(cid) {
      _filters = _cloneFilters(_FILTER_DEFAULTS);
      _saveFilters(cid);
      _liveChanged();
    }

    return {
      renderPicker: renderPicker,
      filterAssessments: filterAssessments,
      openFilterSheet: openFilterSheet,
      onFilterTogglePill: onFilterTogglePill,
      onFilterSegChange: onFilterSegChange,
      clearFilterSheet: clearFilterSheet,
      refreshToReturn: refreshToReturn,
      askReturnAll: askReturnAll,
      studentDrafts: studentDrafts,
      returnFromCard: returnFromCard,
      openRowMenu: openRowMenu,
      doneFilterSheet: doneFilterSheet,
      segment: function () {
        return _segmentMode;
      },
    };
  })();

  /* ══ The grader ══════════════════════════════════════════════ */
  var Speed = (function () {
    var _currentIdx = 0;
    var _undoStack = [];
    var _scrollRAF = null;
    // Rubric view per assessment (true unless Tags is chosen) and the
    // Advanced Rubric checklists open, keyed sid:aid:critId.
    var _rubricView = {};
    var _openChecks = {};

    /* ── Student Card Swiper Screen ─────────────────────────────── */
    /* ── Group work (Group grading, shared/data.js) ─────────────────
       Pair and Group work is graded one group at a time, as on the desktop.
       The strip shows a circle per group (G1, G2 …); a group's card lists its
       members, each with their own M | EXC | LATE and a ⋯ button whose sheet
       has Grade Separately; its levels are those of the member the group's
       grade is copied from, and saving them fills every member. A member
       graded separately gets a card of their own after their group, with
       Graded Separately From and Back to Group Grade (which asks first). */
    var _GROUP_THUMB_COLOR = '#6e7b87';
    var _swiperLabels = null;
    var _MORE_ICON =
      '<svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true"><circle cx="2" cy="2" r="1.8" fill="currentColor"/><circle cx="8" cy="2" r="1.8" fill="currentColor"/><circle cx="14" cy="2" r="1.8" fill="currentColor"/></svg>';

    // The swiper's cards in order: on group work a card per group (drawn from
    // the member its grade comes from), each followed by its members graded
    // separately, then the students in no group (groupGradingUnits, shared
    // with the desktop); on other work a card per student.
    /* Grading only the work waiting (S7-F2: the row menu's Grade the N
       Waiting, a To Grade row): the students are fixed when the screen
       opens, so a card graded on the way stays in the strip and Return and
       Next goes to the next student in it. */
    var _onlyAid = null;
    var _onlyIds = null;
    var _onlyOrdered = false; // _onlyIds is an order to keep (the Work Wall's), not a filter
    /* The grader on one student's work (S7-F4: Grade on a To Grade row):
       { cid, sid, aids, kinds } with the student's pieces fixed when it
       opens, a tab for each, one card at a time. Null otherwise. */
    var _student = null;

    // "1 of 2 for Jordan"
    function _studentSubtitle() {
      var st =
        _student &&
        getStudents(_student.cid).find(function (x) {
          return x.id === _student.sid;
        });
      var i = _student ? _student.aids.indexOf(_swiperAid) : -1;
      if (!st || i < 0) return '';
      return i + 1 + ' of ' + _student.aids.length + ' for ' + (displayNameFirst(st) || displayName(st));
    }

    // Is this the last card: in one student's work, the last piece.
    function _lastCard(units, idx) {
      if (_student) return _student.aids.indexOf(_swiperAid) >= _student.aids.length - 1;
      return idx >= units.length - 1;
    }

    // html-safe: titles go through MC.esc; ids are ours
    function _studentTabsHtml(cid, st) {
      var first = displayNameFirst(st) || displayName(st);
      return (
        '<div class="m-work-tabs" role="tablist" aria-label="' +
        MC.esc(first + '\u2019s work to grade') +
        '">' +
        _student.aids
          .map(function (aid, i) {
            var a = _assessmentById(cid, aid);
            if (!a) return '';
            var on = aid === _swiperAid;
            var tail = '';
            if (_student.kinds[i] === 'notin')
              tail = ' \u00b7 ' + (getAssignmentStatus(cid, st.id, aid) === 'NS' ? 'Missing' : 'Not In');
            return (
              '<button type="button" role="tab" class="m-work-tab' +
              (on ? ' m-work-tab-on' : '') +
              '" aria-selected="' +
              on +
              '" data-action="m-grade-student-piece" data-aid="' +
              aid +
              '">' +
              MC.esc(a.title + tail) +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    function _swiperUnits(cid, a) {
      var all = _allUnits(cid, a);
      if (!_onlyIds || !a || a.id !== _onlyAid) return all;
      // Where a unit (a group shows once) falls in the list: its first member's place.
      var at = function (u) {
        var ids = u.view ? u.view.members : [u.st.id];
        var best = -1;
        ids.forEach(function (m) {
          var i = _onlyIds.indexOf(m);
          if (i !== -1 && (best === -1 || i < best)) best = i;
        });
        return best;
      };
      var kept = all.filter(function (u) {
        return at(u) !== -1;
      });
      if (_onlyOrdered)
        kept.sort(function (x, y) {
          return at(x) - at(y);
        });
      return kept;
    }

    function _allUnits(cid, a) {
      var students = sortStudents(getStudents(cid).slice(), 'alpha');
      var byId = {};
      students.forEach(function (st) {
        byId[st.id] = st;
      });
      var units = groupGradingUnits(
        cid,
        a,
        students.map(function (st) {
          return st.id;
        }),
      );
      if (!units)
        return students.map(function (st) {
          return { st: st, label: displayName(st) };
        });
      return units.map(function (u) {
        if (u.linked)
          return {
            st: byId[u.source],
            label: collabGroupLabel(u.group),
            thumb: (u.group.kind === 'pair' ? 'P' : 'G') + (u.group.index + 1),
            view: { group: u.group, members: u.members, linked: u.linked },
          };
        return { st: byId[u.sid], label: displayNameWithLast(byId[u.sid]), separateFrom: u.separateFrom || null };
      });
    }

    // Which card a student is graded on: their own, or their group's.
    function studentCardIndex(cid, aid, sid) {
      var a = (getAssessments(cid) || []).find(function (x) {
        return x.id === aid;
      });
      if (!a) return -1;
      return _swiperUnits(cid, a).findIndex(function (u) {
        if (u.view) return u.view.members.indexOf(sid) !== -1 && !isGradedSeparately(a, sid);
        return u.st.id === sid;
      });
    }

    // "3 of 27"; on group work the card's name first: "Group 2 · 2 of 9".
    function _subtitleText(idx, total) {
      if (_student) return _studentSubtitle();
      var label = _swiperLabels && _swiperLabels[idx];
      return (label ? label + ' · ' : '') + (idx + 1) + ' of ' + total + (_onlyIds && !_onlyOrdered ? ' to grade' : '');
    }

    // html-safe: names go through MC.esc; ids are ours; labels are constants
    function _groupCardHeadHtml(cid, a, view) {
      return (
        '<div class="m-group-title">' +
        MC.esc(collabGroupLabel(view.group)) +
        '</div>' +
        '<div class="m-group-members">' +
        view.members
          .map(function (m) {
            var st = getStudents(cid).find(function (x) {
              return x.id === m;
            });
            var name = MC.esc(displayNameWithLast(st));
            if (isGradedSeparately(a, m))
              return (
                '<div class="m-group-member"><span class="m-group-member-name">' +
                name +
                '</span><span class="m-group-member-note">Graded Separately</span></div>'
              );
            var status = getAssignmentStatus(cid, m, a.id);
            var pill = function (val, label) {
              return (
                '<button class="m-status-pill m-group-pill' +
                (status === val ? ' m-status-active' : '') +
                '" data-action="m-grade-status" data-val="' +
                val +
                '" data-sid="' +
                m +
                '" data-aid="' +
                a.id +
                '" aria-label="' +
                label +
                ', ' +
                name +
                '">' +
                label +
                '</button>'
              );
            };
            return (
              '<div class="m-group-member"><span class="m-group-member-name">' +
              name +
              '</span>' +
              pill('NS', 'Missing') +
              pill('EXC', 'Excused') +
              pill('LATE', 'Late') +
              '<button class="m-group-more" data-action="m-grade-group-more" data-sid="' +
              m +
              '" data-aid="' +
              a.id +
              '" aria-label="More for ' +
              name +
              '">' +
              _MORE_ICON +
              '</button></div>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    // html-safe: the label goes through MC.esc; ids are ours
    function _separateLineHtml(aid, sid, group) {
      return (
        '<div class="m-group-separate">' +
        '<div class="m-group-separate-text">' +
        MC.esc('Graded Separately From ' + collabGroupLabel(group)) +
        '</div>' +
        '<button class="m-group-back" data-action="m-grade-rejoin" data-sid="' +
        sid +
        '" data-aid="' +
        aid +
        '">Back to Group Grade</button>' +
        '</div>'
      );
    }

    // Draw the swiper's cards and strip again in place, on the same card.
    function _redrawSwiper(cid, aid) {
      var swiper = document.getElementById('m-swiper');
      var strip = document.getElementById('m-thumb-strip');
      if (!swiper || !strip) return;
      var idx = _currentIdx;
      var tmp = document.createElement('div');
      // html-safe: renderSwiper escapes its text (see _renderStudentCard)
      tmp.innerHTML = renderSwiper(cid, aid, { keep: true });
      // html-safe: copied from the checked renderSwiper markup above
      swiper.innerHTML = tmp.querySelector('#m-swiper').innerHTML;
      // html-safe: copied from the checked renderSwiper markup above
      strip.innerHTML = tmp.querySelector('#m-thumb-strip').innerHTML;
      _fitCritComments(swiper);
      var total = strip.querySelectorAll('.m-thumb').length;
      jumpToStudent(Math.min(idx, total - 1), true);
      MGradePhotos.hydrate(swiper, cid); // after the jump: the cards round the one on screen
    }

    // ⋯ on a member: a sheet with their name, Grade Separately and Cancel.
    function openMemberSheet(cid, aid, sid) {
      var st = getStudents(cid).find(function (x) {
        return x.id === sid;
      });
      if (!st) return;
      MC.presentSheet(
        '<div class="m-group-sheet">' +
          '<div class="m-group-sheet-title">' +
          MC.esc(displayNameWithLast(st)) +
          '</div>' +
          '<button class="m-group-sheet-btn" data-action="m-grade-separate" data-sid="' +
          sid +
          '" data-aid="' +
          aid +
          '">Grade Separately</button>' +
          '<button class="m-group-sheet-btn m-group-sheet-cancel" data-action="m-sheet-cancel">Cancel</button>' +
          '</div>',
        { half: true },
      );
    }
    function gradeSeparately(cid, aid, sid) {
      MC.dismissSheet();
      Grader.gradeSeparately(cid, aid, sid);
      MC.haptic();
      _redrawSwiper(cid, aid);
    }
    // Back to Group Grade asks first: it replaces the member's own grade.
    function confirmBackToGroup(cid, aid, sid) {
      var a = getAssessments(cid).find(function (x) {
        return x.id === aid;
      });
      var st = getStudents(cid).find(function (x) {
        return x.id === sid;
      });
      var group = getCollabGroupOf(a, sid);
      if (!st || !group) return;
      // Nobody to copy from: nothing is replaced, so nothing to ask.
      if (!backToGroupGradeSource(cid, aid, sid)) return backToGroup(cid, aid, sid);
      MC.presentSheet(
        '<div class="m-group-sheet">' +
          '<div class="m-group-sheet-title is-question">Back to Group Grade?</div>' +
          '<p class="m-group-sheet-text">' +
          MC.esc(
            displayNameFirst(st) +
              '’s own levels, comments and Overall Comment will be replaced by ' +
              collabGroupLabel(group) +
              '’s.',
          ) +
          '</p>' +
          '<button class="m-group-sheet-btn" data-action="m-grade-rejoin-yes" data-sid="' +
          sid +
          '" data-aid="' +
          aid +
          '">Back to Group Grade</button>' +
          '<button class="m-group-sheet-btn m-group-sheet-cancel" data-action="m-sheet-cancel">Cancel</button>' +
          '</div>',
        { half: true },
      );
    }
    function backToGroup(cid, aid, sid) {
      MC.dismissSheet();
      Grader.backToGroupGrade(cid, aid, sid);
      MC.haptic();
      _redrawSwiper(cid, aid);
    }

    // opts.only 'tograde': the students whose work waits, as it is now (S7-F2).
    function renderSwiper(cid, aid, opts) {
      _swiperCid = cid;
      _swiperAid = aid;
      var assessments = getAssessments(cid);
      var assessment = assessments.find(function (a) {
        return a.id === aid;
      });
      if (!assessment) return '<div class="m-screen"><div class="m-empty">Assessment not found</div></div>';
      // A redraw in place (opts.keep) keeps the students it had.
      if (!(opts && opts.keep && _onlyAid === aid)) {
        _onlyAid = null;
        _onlyIds = null;
        _onlyOrdered = false;
        _student = null;
      }
      // A grading screen opened afresh shows each not-in card's criteria collapsed.
      if (!(opts && opts.keep)) _paperOpen = {};
      if (opts && opts.student) {
        // The student's pieces: the list given (a piece shown after another),
        // or their To Grade list now. A piece no longer on it opens as usual.
        var stuSid = opts.student;
        var aids = opts.aids;
        var kinds = opts.kinds;
        if (!Array.isArray(aids) || !Array.isArray(kinds) || aids.length !== kinds.length) {
          var rows = MGradePhotos.studentList(cid, stuSid);
          aids = rows.map(function (r) {
            return r.a.id;
          });
          kinds = rows.map(function (r) {
            return r.kind;
          });
        }
        var known = getStudents(cid).some(function (x) {
          return x.id === stuSid;
        });
        if (known && aids.indexOf(aid) !== -1) {
          _student = { cid: cid, sid: stuSid, aids: aids.slice(), kinds: kinds.slice() };
          _onlyAid = aid;
          _onlyIds = [stuSid];
        }
      }
      if (opts && opts.only === 'tograde') {
        var waiting = MGradePhotos.toGrade(cid, assessment);
        if (waiting.length) {
          _onlyAid = aid;
          _onlyIds = waiting;
        }
      }
      // The Work Wall's Grade in This Order (S14): these students, in this order.
      if (opts && Array.isArray(opts.ids) && !opts.student && opts.only !== 'tograde') {
        var inClass = {};
        getStudents(cid).forEach(function (x) {
          inClass[x.id] = true;
        });
        var ordered = opts.ids.filter(function (id, i) {
          return inClass[id] && opts.ids.indexOf(id) === i;
        });
        if (ordered.length) {
          _onlyAid = aid;
          _onlyIds = ordered;
          _onlyOrdered = true;
        }
      }

      var units = _swiperUnits(cid, assessment);
      var students = units.map(function (u) {
        return u.st;
      });
      _swiperLabels = groupGradingUnits(cid, assessment, [])
        ? units.map(function (u) {
            return u.label;
          })
        : null;
      var allScores = getScores(cid);
      _currentIdx = 0;

      var stuSt = _student ? students[0] : null;
      var nav = MC.navBar({
        id: 'grade-swiper',
        title: stuSt ? displayName(stuSt) : assessment.title,
        subtitle: _subtitleText(0, students.length),
        backLabel: stuSt ? displayNameFirst(stuSt) || displayName(stuSt) : 'Grade',
        // The sync dot is the only place sync problems show, so the grading
        // screen carries it too.
        rightHTML:
          '<div class="m-sync" role="status"><div class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"></div></div>',
      });

      // Student thumbnail strip: a group's circle says G1, G2 … (P1 … for pairs).
      var chipText = _thumbTexts(students, units);
      // One student's work has no strip of students (it is kept, hidden, for
      // the card count), and a tab for each piece instead.
      var thumbs = '<div class="m-thumb-strip' + (stuSt ? ' m-thumb-strip-off' : '') + '" id="m-thumb-strip">';
      students.forEach(function (st, idx) {
        var unit = units[idx];
        var color = unit.view ? _GROUP_THUMB_COLOR : MC.avatarColor(st.id);
        var initials = chipText[idx];
        var stScores = allScores[st.id] || [];
        var isGraded = stScores.some(function (s) {
          return s.assessmentId === aid && isScoreEntered(assessment, s);
        });
        var currentClass = idx === 0 ? ' m-thumb-current' : '';
        var gradedClass = isGraded ? ' m-thumb-graded' : '';
        // Work sent: a camera on the student's circle (S7-F2).
        if (MGradePhotos.hasWork(cid, assessment, st, unit)) gradedClass += ' m-thumb-work';
        // A real button with the student's (or group's) name, so it can be
        // reached with Tab and read aloud.
        var thumbName = unit.view ? unit.view.label : displayNameWithLast(st);
        thumbs +=
          '<button type="button" class="m-thumb' +
          (initials.length > 3 ? ' m-thumb-long' : '') +
          currentClass +
          gradedClass +
          '" style="background:' +
          color +
          '" data-action="m-grade-jump" data-idx="' +
          idx +
          '" data-sid="' +
          st.id +
          '" aria-label="' +
          MC.esc(thumbName) +
          '" title="' +
          MC.esc(thumbName) +
          '"' +
          (idx === 0 ? ' aria-current="true"' : '') +
          '>' +
          MC.esc(initials) +
          '</button>';
      });
      thumbs += '</div>';
      if (stuSt) thumbs += _studentTabsHtml(cid, stuSt);

      // Swiper cards. In a class that holds grades the Draft and Return bar
      // sits under them, above the tab bar (S1-F3); on an Advanced Rubric a
      // criterion at a time, it carries Next: <criterion> in every class.
      var holds = _holdsGrades(cid);
      var allStatuses = getAssignmentStatuses(cid);
      var swiper = '<div class="m-swiper' + (holds ? ' m-has-return' : '') + '" id="m-swiper">';
      students.forEach(function (st, idx) {
        swiper += _renderStudentCard(cid, st, assessment, allScores, allStatuses, units[idx]);
      });
      swiper += '</div>';

      return (
        '<div class="m-screen m-screen-hidden" id="m-screen-grade-swiper">' +
        nav +
        thumbs +
        _viewSwitchHtml(cid, assessment) +
        swiper +
        (holds ? _returnBarHtml(cid, assessment, units, 0) : '') +
        '</div>'
      );
    }

    /* ── The grading screen's Draft and Return bar (S1-F3) ──────────
       Under the cards, above the tab bar, for the card on screen: the Draft
       mark, "Saved. Not returned yet." and Return and Next while its grade
       waits; "Returned Nov 3" once it is given; Return and Next greyed out
       with nothing in. It is the desktop grader's row (_graderReturnHtml,
       teacher/page-assignments.js) and follows its rules: a change to a
       returned grade adds what the student still sees; a status alone is not
       a grade, so a piece with a status and nothing in shows nothing; a
       DIBELS benchmark is not returned; a group's card returns every member
       still graded with the group. It is drawn only in a class that holds
       grades (renderSwiper), and again only when it changes. */
    var _swiperAid = null;
    // Set while the next card slides in after Return and Next.
    var _returnSliding = null;
    var RETURN_SLIDE_MS = 500;

    // The students a card's Return returns: the group's linked members, or the one student.
    function _cardReturnIds(unit) {
      return unit.view ? (unit.view.linked || []).slice() : [unit.st.id];
    }

    // { state, act }: the line that says where the grade stands, and the button.
    // html-safe: fixed labels; the name and the date go through MC.esc
    function _returnBarParts(cid, a, unit, last) {
      var parts = _returnBarOwn(cid, a, unit, last);
      // For Revision or Take Back, then the blue button.
      return { state: parts.state, act: (parts.lead || '') + parts.act };
    }

    function _returnBarOwn(cid, a, unit, last) {
      var none = { state: '', act: '' };
      if (!unit) return none;
      // What the bar says is worked out once for both layouts (S11-T1),
      // revisions with it (S11-F1, the board "Phone: Return for Revision").
      var area = GraderWork.returnArea(cid, a, unit.st.id, _cardReturnIds(unit), { revisions: true });
      if (!area) return none;
      return _revisionBarParts(cid, a, unit, area, _returnBarArea(cid, a, unit, last, area));
    }

    // html-safe: fixed labels; the name and the date go through MC.esc
    function _returnBarArea(cid, a, unit, last, area) {
      var label = last ? 'Return' : 'Return and Next';
      // Out for revision: no Return until the revision is in.
      if (area.kind === 'none' || area.kind === 'revising') return { state: '', act: '' };
      if (area.kind === 'empty' || area.kind === 'revised') {
        return {
          state: '',
          act:
            '<button type="button" class="m-grade-return-btn" data-action="m-grade-return-next" disabled>' +
            label +
            '</button>',
        };
      }
      if (area.kind === 'returned') {
        var on = area.returnedAt ? formatShortDate(area.returnedAt) : '';
        return {
          state: '<span class="m-returned-mark">' + MC.esc(on ? 'Returned ' + on : 'Returned') + '</span>',
          act: '',
        };
      }
      var given = area.given;
      var still = '';
      if (given) {
        var who = unit.view ? collabGroupLabel(unit.view.group) : displayNameFirst(unit.st) || 'The student';
        var when = given.returnedAt ? ' ' + formatShortDate(given.returnedAt) : '';
        still =
          '<span class="m-grade-return-still">' +
          MC.esc(who + ' still sees the grade you returned' + when + '.') +
          '</span>';
      }
      return {
        state:
          '<span class="m-draft-mark">Draft</span><span class="m-grade-return-text">Saved. Not returned yet.</span>' +
          still,
        act:
          '<button type="button" class="m-grade-return-btn" data-action="m-grade-return-next">' + label + '</button>',
      };
    }

    /* ── Revisions on the phone (S11-F1, the board "Phone: Return for
       Revision") ──────────────────────────────────────────────────────
       In a class whose revisions are on (Demo Mode, the build switch and
       Send Work), on one student's own card: For Revision beside Return and
       Next opens the Return for Revision sheet (What to Fix, Revise By,
       which criterion, and the grade kept until the new version replaces
       it; the board's Hide is left out, Colin, Nov 11). While the revision
       is out the bar says so, with Take Back. Each answer acts only while
       the grading screen still shows the same class, piece and student, and
       the sheet's only while that sheet is still up. */
    var _revisionBusy = false;
    var _revisionMsg = null;

    // "Tue, Nov 10" for a 'YYYY-MM-DD'.
    function _reviseByText(day) {
      var d = parseLocalDate(String(day || ''));
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    // html-safe: fixed labels; dates through MC.esc; ids are ours or escaped
    function _revisionBarParts(cid, a, unit, area, parts) {
      var ids = ' data-sid="' + unit.st.id + '" data-aid="' + a.id + '"';
      if (area.revise) {
        return {
          state: parts.state,
          lead:
            '<button type="button" class="m-grade-revise-btn" data-action="m-grade-revision"' +
            ids +
            (_revisionBusy ? ' disabled' : '') +
            '>For Revision</button>',
          act: parts.act,
        };
      }
      var r = area.revision;
      if (!r) return parts;
      var state = parts.state;
      if (area.kind === 'revising') {
        state =
          '<span class="m-revising-mark">Revising</span><span class="m-grade-return-text">' +
          MC.esc('Returned for Revision' + (r.revise_by ? ' · Revise by ' + _reviseByText(r.revise_by) : '')) +
          '</span>';
      }
      if (_revisionMsg) state += '<span class="m-grade-return-still">' + MC.esc(_revisionMsg) + '</span>';
      return {
        state: state,
        lead:
          '<button type="button" class="m-grade-revise-btn" data-action="m-grade-revision-takeback"' +
          ids +
          ' data-id="' +
          MC.esc(r.id) +
          '"' +
          (_revisionBusy ? ' disabled' : '') +
          '>' +
          (_revisionBusy ? 'Taking Back…' : 'Take Back') +
          '</button>',
        act: parts.act,
      };
    }

    // The grading screen still shows `sid`'s card on `aid` in `cid`.
    function _stillOn(cid, aid, sid) {
      if (_swiperCid !== cid || _swiperAid !== aid || !document.getElementById('m-screen-grade-swiper')) return false;
      var a = _assessmentById(cid, aid);
      var unit = a ? _swiperUnits(cid, a)[_currentIdx] : null;
      return !!unit && unit.st.id === sid;
    }

    function _revisionKey(prefix) {
      return window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    // html-safe: names, titles and criterion names go through MC.esc; ids are ours or escaped; labels are fixed words
    function _revisionSheetHtml(cid, a, st) {
      var rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
      var criteria = ((rubric && rubric.criteria) || []).filter(Boolean);
      return (
        '<div class="m-revision-sheet" role="dialog" aria-labelledby="m-revision-title">' +
        // Cancel on the left and the title in the middle, in one row (the
        // board "Phone: Return for Revision"); the sheet's grabber is over it.
        '<div class="m-revision-head"><button type="button" class="m-revision-cancel" data-action="m-sheet-cancel">Cancel</button>' +
        '<h2 class="m-revision-title" id="m-revision-title">Return for Revision</h2><span aria-hidden="true"></span></div>' +
        '<p class="m-revision-sub">' +
        MC.esc(displayNameWithLast(st) + ' · ' + (a.title || 'Assessment')) +
        '</p>' +
        '<label class="m-revision-label" for="m-revision-fix">What to Fix</label>' +
        '<textarea id="m-revision-fix" class="m-revision-fix" rows="3" maxlength="2000"></textarea>' +
        // Revise By and Revise side by side.
        '<div class="m-revision-row"><div class="m-revision-field">' +
        '<label class="m-revision-label" for="m-revision-by">Revise By</label>' +
        '<input type="date" id="m-revision-by" class="m-revision-by"></div>' +
        (criteria.length > 1
          ? '<div class="m-revision-field"><label class="m-revision-label" for="m-revision-crit">Revise</label>' +
            '<select id="m-revision-crit" class="m-revision-crit"><option value="">The Whole Assignment</option>' +
            criteria
              .map(function (c) {
                return (
                  '<option value="' + MC.esc(c.id) + '">' + MC.esc((c.name || 'Criterion') + ' only') + '</option>'
                );
              })
              .join('') +
            '</select></div>'
          : '') +
        '</div>' +
        // The grade until then: kept. The board's Hide is left out (Colin, Nov 11).
        '<h3 class="m-revision-label">Until the New Version Is Graded</h3>' +
        '<p class="m-revision-keep">Keep this grade. The new version replaces it.</p>' +
        '<p class="m-revision-msg" role="status"></p>' +
        '<button type="button" class="m-revision-send" data-action="m-grade-revision-send" data-sid="' +
        st.id +
        '" data-aid="' +
        a.id +
        '">Return for Revision</button>' +
        '</div>'
      );
    }

    function openRevisionSheet(cid, aid, sid) {
      var a = _assessmentById(cid, aid);
      var st = (getStudents(cid) || []).find(function (x) {
        return x.id === sid;
      });
      if (!a || !st || _revisionBusy || !_stillOn(cid, aid, sid)) return;
      _saveTyped(cid, sid);
      MC.presentSheet(_revisionSheetHtml(cid, a, st));
      var fix = document.getElementById('m-revision-fix');
      if (fix) fix.focus();
    }

    function sendRevision(cid, aid, sid, btn) {
      var sheet = btn && btn.closest('.m-revision-sheet');
      if (!sheet || sheet._fvBusy) return;
      var say = function (text) {
        sheet.querySelector('.m-revision-msg').textContent = text;
      };
      var fix = sheet.querySelector('.m-revision-fix');
      if (!fix.value.trim()) {
        say('Write what to fix first.');
        fix.focus();
        return;
      }
      var crit = sheet.querySelector('.m-revision-crit');
      var request = {
        what_to_fix: fix.value.slice(0, 2000),
        revise_by: sheet.querySelector('.m-revision-by').value || null,
        criterion_ids: crit && crit.value ? [crit.value] : [],
      };
      sheet._fvBusy = true;
      btn.disabled = true;
      btn.textContent = 'Returning…';
      Grader.returnForRevision(cid, sid, aid, request, _revisionKey('rv')).then(function (res) {
        sheet._fvBusy = false;
        // The sheet went, or the screen moved on: nothing more happens here.
        if (!sheet.isConnected || !_stillOn(cid, aid, sid)) return;
        var result = res && res.result;
        if (result === 'made' || result === 'already_open') {
          MC.dismissSheet();
          MC.haptic();
          _revisionMsg = null;
          _redrawSwiper(cid, aid);
          return;
        }
        btn.disabled = false;
        btn.textContent = 'Return for Revision';
        say(
          result === 'invalid'
            ? 'Check What to Fix and the date, then try again.'
            : 'This couldn’t be returned for revision. Try again.',
        );
      });
    }

    function takeBackRevision(cid, aid, sid, requestId) {
      if (_revisionBusy || !_stillOn(cid, aid, sid)) return;
      var r = getRevisionRequest(cid, sid, aid);
      if (!r || r.id !== requestId) return;
      _revisionBusy = true;
      _revisionMsg = null;
      _syncReturnBar();
      Grader.cancelRevision(cid, sid, aid, r.id, _revisionKey('rc')).then(function (res) {
        _revisionBusy = false;
        var ok = res && (res.result === 'cancelled' || res.result === 'not_open');
        if (!_stillOn(cid, aid, sid)) return;
        _revisionMsg = ok ? null : 'This couldn’t be taken back. Try again.';
        _redrawSwiper(cid, aid);
      });
    }

    // The card on screen's parts.
    function _returnBarNow(cid, a) {
      var units = _swiperUnits(cid, a);
      return _returnBarParts(cid, a, units[_currentIdx], _lastCard(units, _currentIdx));
    }

    // html-safe: built by _returnBarParts
    function _returnBarHtml(cid, a, units, idx) {
      var parts = _returnBarParts(cid, a, units[idx], _lastCard(units, idx));
      return (
        '<div class="m-grade-return' +
        (parts.state || parts.act ? '' : ' is-empty') +
        (parts.act ? '' : ' is-alone') +
        '" id="m-grade-return" tabindex="-1">' +
        '<div class="m-grade-return-state" id="m-grade-return-state" role="status">' +
        parts.state +
        '</div>' +
        '<div class="m-grade-return-act" id="m-grade-return-act">' +
        parts.act +
        '</div></div>'
      );
    }

    /* The bar, for the card on screen now: after a save, and when the card
       changes. Nothing happens in a class that holds no grades. When the
       button under the focus goes or changes, the focus stays on the bar.
       `scrolled` says the cards moved under a finger or a slide: while
       Return and Next's own slide runs, the bar already shows the card it is
       going to and stays on it. */
    function _syncReturnBar(scrolled) {
      var cid = _swiperCid;
      var a = _assessmentById(cid, _swiperAid);
      if (!a || !_holdsGrades(cid)) return;
      if (scrolled && _returnSliding) return;
      var bar = document.getElementById('m-grade-return');
      if (!bar) return;
      var parts = _returnBarNow(cid, a);
      var shown = bar._fvShown || {};
      if (shown.state === parts.state && shown.act === parts.act) return;
      bar._fvShown = parts;
      var state = document.getElementById('m-grade-return-state');
      var act = document.getElementById('m-grade-return-act');
      // Each part is drawn again only when it changes: the line is read out
      // when it does, and a button swapped out under a finger loses its tap.
      if (shown.state !== parts.state) {
        // html-safe: built by _returnBarParts
        state.innerHTML = parts.state;
      }
      if (shown.act !== parts.act) {
        var held = !!document.activeElement && act.contains(document.activeElement);
        // html-safe: built by _returnBarParts
        act.innerHTML = parts.act;
        if (held) (act.querySelector('button:not([disabled])') || bar).focus({ preventScroll: true });
      }
      bar.classList.toggle('is-empty', !parts.state && !parts.act);
      // "Returned Nov 3" stands alone, with no button under it.
      bar.classList.toggle('is-alone', !parts.act);
    }

    /* A grading screen just drawn (renderSwiper) shows its first card's bar:
       the bar is told so, and is not drawn a second time. */
    function _noteReturnBar(cid, aid) {
      var a = _assessmentById(cid, aid);
      if (!a || !_holdsGrades(cid)) return;
      var bar = document.getElementById('m-grade-return');
      if (bar) bar._fvShown = _returnBarNow(cid, a);
    }

    /* What is typed on the card but not saved yet: a comment saves a moment
       after the last key, and points when the field is left. A phone's button
       does not take the focus from a field, so Return saves them first:
       nothing typed is left behind as a new draft on a grade just returned. */
    function _saveTyped(cid, sid) {
      var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
      if (!card) return;
      card.querySelectorAll('.m-pts-input').forEach(function (inp) {
        commitPointsInput(cid, inp);
      });
      card.querySelectorAll('.m-crit-comment').forEach(function (el) {
        _saveCritComment(cid, el);
      });
      card.querySelectorAll('.m-overall-comment').forEach(function (el) {
        _saveOverallComment(cid, el);
      });
    }

    /* Return and Next: the grade on screen is returned (a group's, to every
       member still graded with it) and the next card comes up. One tap: the
       card names who it is and shows the grade. On the last card it returns
       and stays. */
    function returnAndNext() {
      var cid = _swiperCid;
      if (!_holdsGrades(cid)) return;
      // A second tap while the next card slides in returns nothing: a grade
      // is returned only once its card is on screen.
      if (_returnSliding) return;
      var a = _assessmentById(cid, _swiperAid);
      if (!a) return;
      var units = _swiperUnits(cid, a);
      var unit = units[_currentIdx];
      if (!unit) return;
      _saveTyped(cid, unit.st.id);
      var ids = _cardReturnIds(unit);
      if (!GraderWork.draftsIn(cid, a.id, ids).length) return _syncReturnBar();
      Grader.returnGrades(cid, a.id, ids);
      clearProfCache();
      MC.haptic();
      // One student's work: on to their next piece.
      if (_student) {
        var at = _student.aids.indexOf(a.id);
        if (at >= 0 && at < _student.aids.length - 1) return showStudentPiece(cid, _student.aids[at + 1]);
        return _syncReturnBar();
      }
      if (_currentIdx >= units.length - 1) return _syncReturnBar();
      jumpToStudent(_currentIdx + 1);
      _returnSliding = setTimeout(function () {
        _returnSliding = null;
        _syncReturnBar();
      }, RETURN_SLIDE_MS);
    }

    /* One student's work: show another of their pieces in place (a tab, or
       Return and Next). What was typed is saved first; the screen keeps its
       place in the stack, and its restore entry names the new piece. */
    function showStudentPiece(cid, aid) {
      if (!_student || _student.cid !== cid || _student.aids.indexOf(aid) === -1) return false;
      var screen = document.getElementById('m-screen-grade-swiper');
      if (!screen) return false;
      if (aid === _swiperAid) return true;
      var sid = _student.sid;
      _saveTyped(cid, sid);
      var desc = { kind: 'swiper', aid: aid, student: sid, aids: _student.aids, kinds: _student.kinds };
      var tmp = document.createElement('div');
      // html-safe: renderSwiper escapes its text (see _renderStudentCard)
      tmp.innerHTML = renderSwiper(cid, aid, { student: sid, aids: _student.aids, kinds: _student.kinds });
      var next = tmp.firstElementChild;
      next.classList.remove('m-screen-hidden');
      if (screen.hasAttribute('data-restore')) next.setAttribute('data-restore', JSON.stringify(desc));
      screen.parentNode.replaceChild(next, screen);
      MGradePhotos.releaseUnused();
      var navBar = next.querySelector('.m-nav-bar');
      if (navBar && MC.setupScrollTitle) MC.setupScrollTitle(next, navBar.id);
      setupSwiper(cid, aid);
      var tab = next.querySelector('.m-work-tab-on');
      if (tab) tab.focus({ preventScroll: true });
      return true;
    }

    /* The card to open a To Return row on: the first with a draft. */
    function jumpToFirstDraft(cid, aid) {
      if (!_holdsGrades(cid)) return;
      var a = _assessmentById(cid, aid);
      if (!a) return;
      var idx = _swiperUnits(cid, a).findIndex(function (unit) {
        return GraderWork.draftsIn(cid, aid, _cardReturnIds(unit)).length > 0;
      });
      if (idx > 0) jumpToStudent(idx, true);
    }

    // html-safe: names, labels and criterion text go through MC.esc; colours through cssColor or avatarColor's constants; ids, levels and points are ours or numbers; _criterionGroupHtml, _completionBtnsHtml, _fineTuneHtml, MC.levelButtonsHTML and pointsPctHtml are checked.
    function _renderStudentCard(cid, st, assessment, allScores, allStatuses, unit) {
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

      // Missing, Excused and Late: one segmented control under the name (the board).
      var statusRow =
        '<div class="m-status-row" role="group" aria-label="Status">' +
        '<button class="m-status-pill' +
        (status === 'NS' ? ' m-status-active' : '') +
        '" data-action="m-grade-status" data-val="NS" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '"' +
        (canSetAssignmentStatus(cid, st.id, assessment.id, 'NS') ? '' : ' disabled') +
        '>Missing</button>' +
        '<button class="m-status-pill' +
        (status === 'EXC' ? ' m-status-active' : '') +
        '" data-action="m-grade-status" data-val="EXC" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '"' +
        (canSetAssignmentStatus(cid, st.id, assessment.id, 'EXC') ? '' : ' disabled') +
        '>Excused</button>' +
        '<button class="m-status-pill' +
        (status === 'LATE' ? ' m-status-active' : '') +
        '" data-action="m-grade-status" data-val="LATE" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '">Late</button>' +
        '</div>' +
        // Why Missing and Excused can't be picked, where they can't.
        '<div class="m-status-hint" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '"' +
        (canSetAssignmentStatus(cid, st.id, assessment.id, 'NS') ? ' hidden' : '') +
        '>Clear the score and comment to mark Missing or Excused.</div>';

      // A group's members each have their own status, in the list above.
      if (unit && unit.view) statusRow = '';
      // Under the name: when the work came, then the status (the board
      // "Phone Speed Grader With Photos").
      var sent = MGradePhotos.sentHtml(cid, assessment, st, unit);
      // A card with nothing in has the status under Add Work instead (the
      // board "Add Work for a Student").
      var notInCard = MGradePhotos.notInCard(cid, assessment, st, unit);
      var headStatus = notInCard ? '' : statusRow;

      var header =
        '<div class="m-grade-student-header">' +
        '<div class="m-grade-avatar" style="background:' +
        color +
        '">' +
        MC.esc(initials) +
        '</div>' +
        '<div class="m-grade-student-main"><div class="m-grade-student-name">' +
        MC.esc(name) +
        badges +
        '</div>' +
        sent +
        headStatus +
        '</div></div>';
      // One student's work: the card is named by the piece (the bar names the student).
      if (_student && _student.sid === st.id && !(unit && unit.view))
        header =
          '<div class="m-grade-student-header"><div class="m-grade-student-main"><div class="m-grade-student-name">' +
          MC.esc(assessment.title) +
          '</div>' +
          sent +
          headStatus +
          '</div></div>';
      if (unit && unit.view) header = _groupCardHeadHtml(cid, assessment, unit.view) + sent;
      else if (unit && unit.separateFrom) header += _separateLineHtml(assessment.id, st.id, unit.separateFrom);

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
      // Nothing in: the criteria under Grade From Paper, each "Not scored ›"
      // (or its level), until one is tapped (the board "Add Work for a Student").
      if (notInCard && rubric && !_paperOpen[st.id + ':' + assessment.id])
        tagGroups = _notScoredHtml(cid, st, assessment, rubric);
      var ptsTagLines = '';
      var ptsTid = null;
      // Rubric work lists the competencies its criteria feed, as the desktop's
      // Competencies view does (rubricCompetencyRowKeys).
      (isCompletionScored(assessment) || rubric ? [] : rubricCompetencyRowKeys(cid, assessment)).forEach(
        function (tid, tagIdx) {
          var tag = getTagById(cid, tid);
          var sec = getSectionForTag(cid, tid);
          var key = tag ? null : scoreKeyInfo(cid, assessment, tid);
          var tagLabel = tag
            ? tag.label || tag.name || tag.shortName || tag.code || ''
            : key
              ? key.label
              : 'No longer in the learning map';
          var tagColor = sec ? sec.color : '#888';

          // Current score for this tag; on rubric work, a competency shows the
          // level of the criteria that feed it.
          var rowState = _rubricRowState(cid, st.id, assessment, tid);
          var existing = rowState
            ? []
            : stScores.filter(function (s) {
                return s.assessmentId === assessment.id && s.tagId === tid;
              });
          var current = rowState
            ? rowState.level || null
            : existing.length
              ? existing[existing.length - 1].score
              : null;
          var currentMod = rowState
            ? rowState.mod
            : existing.length
              ? normalizeScoreMod(current, existing[existing.length - 1].mod)
              : 0;
          var currentMixed = !!(rowState && rowState.mixed);

          if (isPoints && assessment.maxPoints) {
            // Points mode: one score for the assessment, drawn after the loop
            // under every competency it assesses.
            ptsTagLines +=
              '<div class="m-score-tag-label"><span class="m-score-tag-dot" style="background:' +
              cssColor(tagColor) +
              '"></span>' +
              MC.esc(tagLabel) +
              '</div>';
            if (ptsTid === null) ptsTid = tid;
          } else {
            // Proficiency mode — levels 1-4 only. 'No Evidence' (stored as 0) is
            // reachable by tapping the currently-active level to toggle it off;
            // that state renders as "no button active," matching both the fresh
            // ungraded state AND a deliberate No-Evidence choice, which the
            // graded-count / calc / report layers already treat identically
            // (all use `score > 0`).
            // The board's level buttons, in the class's level order (MC.levelButtonsHTML).
            var lvNow = current !== null ? roundLevel(current) : 0;
            var rowIds = ' data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-tid="' + tid + '"';
            tagGroups +=
              '<div class="m-score-group">' +
              '<div class="m-score-tag-label"><span class="m-score-tag-dot" style="background:' +
              cssColor(tagColor) +
              '"></span>' +
              MC.esc(tagLabel) +
              '</div>' +
              '<div class="m-score-btns" role="radiogroup" aria-label="Level for ' +
              MC.esc(tagLabel) +
              '">' +
              MC.levelButtonsHTML({
                order: levelOrderFor(cid),
                level: lvNow,
                mod: currentMod,
                mixed: currentMixed,
                action: 'm-grade-score',
                attrs: rowIds,
              }) +
              '</div>' +
              _fineTuneHtml(rowIds, currentMixed ? 0 : lvNow, currentMod, tagLabel) +
              '</div>';
          }
        },
      );

      if (ptsTid !== null) {
        var rawScore = getPointsScore(cid, st.id, assessment.id);
        tagGroups +=
          '<div class="m-score-group" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-tid="' +
          ptsTid +
          '">' +
          ptsTagLines +
          '<div style="display:flex;align-items:center;justify-content:center;gap:12px">' +
          '<button class="m-score-btn" data-action="m-grade-points-dec" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-max="' +
          assessment.maxPoints +
          '" style="width:44px;height:44px;font-size:20px">−</button>' +
          '<div style="display:flex;align-items:center;gap:6px"><input class="m-pts-input" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="\u2014" aria-label="Points for ' +
          MC.esc(unit && unit.view ? unit.view.label : displayNameWithLast(st)) +
          ', out of ' +
          assessment.maxPoints +
          '" id="m-pts-' +
          st.id +
          '-' +
          assessment.id +
          '" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-max="' +
          assessment.maxPoints +
          '" value="' +
          (rawScore != null ? formatPoints(rawScore) : '') +
          '">' +
          '<div class="m-pts-of"><span style="font-size:15px;color:var(--text-3)">/ ' +
          assessment.maxPoints +
          '</span><span class="m-pts-pct" id="m-pts-pct-' +
          st.id +
          '-' +
          assessment.id +
          '">' +
          pointsPctHtml(rawScore, assessment.maxPoints, 0) +
          '</span></div></div>' +
          '<button class="m-score-btn" data-action="m-grade-points-inc" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-max="' +
          assessment.maxPoints +
          '" style="width:44px;height:44px;font-size:20px">+</button>' +
          '</div></div>';
      }

      // The Overall Comment: the one feedback box on the work, as on the
      // desktop (score.comment; it prints on the rubric handout).
      var commentText = getScoreComment(cid, st.id, assessment.id);
      var commentId = 'm-overall-' + st.id + '-' + assessment.id;
      var commentRow =
        '<div class="m-overall">' +
        '<label class="m-overall-label" for="' +
        commentId +
        '">Overall Comment</label>' +
        '<textarea class="m-overall-comment" id="' +
        commentId +
        '" rows="2" placeholder="Add an overall comment for ' +
        MC.esc(unit && unit.view ? unit.view.label : displayNameFirst(st)) +
        '" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '">' +
        MC.esc(commentText) +
        '</textarea></div>';

      return (
        '<div class="m-swiper-card" data-sid="' +
        st.id +
        '">' +
        '<div class="m-grade-card-surface' +
        (status === 'NS' || status === 'EXC' ? ' m-card-status-disabled' : '') +
        '">' +
        MGradePhotos.pinHtml(cid, assessment, st, unit) +
        header +
        // The student's work, under who it is (teacher-mobile/grade-photos.js).
        MGradePhotos.cardHtml(cid, assessment, st, unit, { status: notInCard ? statusRow : '' }) +
        tagGroups +
        commentRow +
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

    /* A criterion's level and ±. It is saved under one key
       (rubricCriterionScoreKeys), so it is never mixed. */
    function _critState(cid, sid, aid, crit) {
      var entries = getScores(cid)[sid] || [];
      var tid = rubricCriterionScoreKeys(crit)[0];
      var e =
        tid &&
        entries.find(function (s) {
          return s.assessmentId === aid && s.tagId === tid;
        });
      if (!e || !(e.score > 0)) return { level: 0, mod: 0, mixed: false };
      return { level: e.score, mod: normalizeScoreMod(e.score, e.mod), mixed: false };
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
        '">Competencies</button>' +
        '<button class="m-seg-btn' +
        (rubricOn ? ' m-seg-active' : '') +
        '" data-action="m-grade-view" data-view="rubric" data-aid="' +
        assessment.id +
        '" aria-pressed="' +
        rubricOn +
        '">Rubric</button></div>' +
        '<div class="m-grade-view-hint">' +
        (rubricOn ? 'One score for each rubric criterion.' : 'One score for each competency the work assesses.') +
        '</div></div>'
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
          : // The level already matches the ticks: nothing to explain.
            '';
      var html =
        '<div class="m-checklist"><div class="m-checklist-head">' +
        MC.esc(head) +
        '</div>' +
        (hint ? '<div class="m-checklist-hint">' + MC.esc(hint) + '</div>' : '');
      levelOrderFor(cid).forEach(function (lv) {
        var boxes = RubricChecks.checksAt(crit, lv);
        if (!boxes.length) return;
        html +=
          '<div class="m-checklist-level"><div class="m-checklist-level-name l' +
          lv +
          '">' +
          PROF_LABELS[lv] +
          '</div>';
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

    // Not-in cards whose criteria were opened from Grade From Paper, by "sid:aid".
    var _paperOpen = {};

    // html-safe: criterion names go through MC.esc; level words are constants; ids are ours; indexes are numbers
    function _notScoredHtml(cid, st, assessment, rubric) {
      return (
        '<div class="m-paper-crits">' +
        (rubric.criteria || [])
          .map(function (crit, i) {
            var state = _critState(cid, st.id, assessment.id, crit);
            var now = state.level ? scoreLevelText(state.level) : 'Not scored';
            return (
              '<button type="button" class="m-paper-crit" data-action="m-paper-crit" data-sid="' +
              st.id +
              '" data-aid="' +
              assessment.id +
              '" data-idx="' +
              i +
              '"><span class="m-paper-crit-name">' +
              MC.esc(crit.name || 'Criterion') +
              '</span><span class="m-paper-crit-now">' +
              MC.esc(now) +
              '</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></button>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    // A "Not scored ›" row tapped: the card's criteria open, that one in view.
    function openPaperCriterion(cid, sid, aid, idx) {
      _paperOpen[sid + ':' + aid] = true;
      _refreshCard(cid, sid, aid);
      var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
      var group = card && card.querySelectorAll('.m-crit-group')[idx];
      if (group && group.scrollIntoView) group.scrollIntoView({ block: 'nearest' });
    }

    // A level's name, for a group of boxes and the ± row: a word, not a grade.
    function _levelName(lv) {
      return PROF_LABELS[lv] || '';
    }

    // A criterion's four level buttons (MC.levelButtonsHTML).
    function _critLevelBtnsHtml(cid, st, assessment, crit, state) {
      return MC.levelButtonsHTML({
        order: levelOrderFor(cid),
        level: state.level || 0,
        mod: state.mod,
        mixed: state.mixed,
        action: 'm-grade-crit',
        attrs: ' data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-critid="' + crit.id + '"',
      });
    }

    // A criterion's Fine-tune row.
    function _critFineTuneHtml(st, assessment, crit, state) {
      return _fineTuneHtml(
        ' data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-critid="' + crit.id + '"',
        state.mixed ? 0 : state.level,
        state.mod,
        crit.name || 'Criterion',
      );
    }

    /* One criterion: its name, the four levels, ± and, on an Advanced
       Rubric, the Checks button and its open checklist. */
    function _criterionGroupHtml(cid, st, assessment, rubric, crit) {
      var state = _critState(cid, st.id, assessment.id, crit);
      var btns = _critLevelBtnsHtml(cid, st, assessment, crit, state);
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
          ' ticked"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>' +
          // Only the ticks, as on the board's chip: no box total.
          count.ticked +
          '</button>';
      }
      // The board's "Suggested: Proficient" over the levels, from the ticks;
      // an open checklist says it in its own head.
      var suggested =
        advanced && !open ? RubricChecks.suggestedLevel(crit, getRubricCheckIds(cid, st.id, assessment.id)) : 0;
      var suggestedLine = suggested
        ? '<div class="m-crit-suggested l' +
          suggested +
          '">' +
          MC.esc('Suggested: ' + scoreLevelText(suggested)) +
          '</div>'
        : '';
      return (
        '<div class="m-score-group m-crit-group" data-critid="' +
        crit.id +
        '">' +
        '<div class="m-score-tag-label m-crit-label"><span class="m-crit-name">' +
        MC.esc(crit.name || 'Criterion') +
        '</span>' +
        '<span class="m-crit-tools">' +
        checksBtn +
        _critCommentBtnHtml(cid, st.id, assessment.id, crit) +
        '</span>' +
        '</div>' +
        suggestedLine +
        '<div class="m-score-btns" role="radiogroup" aria-label="Level for ' +
        MC.esc(crit.name || 'Criterion') +
        '">' +
        btns +
        '</div>' +
        _critFineTuneHtml(st, assessment, crit, state) +
        (open ? _checklistHtml(cid, st.id, assessment.id, crit, state) : '') +
        _critCommentHtml(cid, st.id, assessment.id, crit) +
        '</div>'
      );
    }

    /* The criterion's comment (rubric_score.comment), as the desktop's speech
       bubble: it prints under the criterion on the rubric handout. Hidden
       behind a Comment button until there is one, so a rubric with many
       criteria doesn't fill with empty boxes. One line that grows as the
       teacher types; it saves like the Overall Comment. */
    function _critCommentHtml(cid, sid, aid, crit) {
      var text = getRubricCriterionComment(cid, sid, aid, crit);
      return (
        '<textarea class="m-crit-comment" rows="1" maxlength="500" placeholder="Type a comment" aria-label="Comment on ' +
        MC.esc(crit.name || 'criterion') +
        '" data-sid="' +
        sid +
        '" data-aid="' +
        aid +
        '" data-critid="' +
        crit.id +
        '"' +
        (text ? '' : ' hidden') +
        '>' +
        MC.esc(text) +
        '</textarea>'
      );
    }

    /* The criterion's Comment button (the board): a round icon beside its
       name, or "Comment" in the pager's ± row. Filled once there is a
       comment, which then reads as a note under the levels. */
    // html-safe: the name goes through MC.esc; sid, aid and critId are ids; the rest is fixed markup.
    function _critCommentBtnHtml(cid, sid, aid, crit, labelled) {
      var has = !!getRubricCriterionComment(cid, sid, aid, crit);
      var name = crit.name || 'criterion';
      return (
        '<button type="button" class="m-crit-comment-btn' +
        (labelled ? ' is-labelled' : '') +
        (has ? ' is-on' : '') +
        '" data-action="m-grade-crit-comment" data-sid="' +
        sid +
        '" data-aid="' +
        aid +
        '" data-critid="' +
        crit.id +
        '" aria-label="' +
        MC.esc((has ? 'Edit the comment on ' : 'Comment on ') + name) +
        '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>' +
        (labelled ? '<span aria-hidden="true">Comment</span>' : '') +
        '</button>'
      );
    }

    // Comment tapped: show the criterion's box and put the cursor in it.
    function openCritComment(btn) {
      var group = btn.closest('.m-crit-group');
      var box = group && group.querySelector('.m-crit-comment');
      if (!box) return;
      box.hidden = false;
      box.focus();
    }

    // Left empty: back behind its button.
    function _closeEmptyCritComment(el) {
      if (el.value.trim()) return;
      el.hidden = true;
    }

    function _fitCritComment(el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    function _fitCritComments(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('.m-crit-comment').forEach(function (el) {
        if (el.value) _fitCritComment(el);
      });
    }

    function _saveCritComment(cid, el) {
      var key = el.dataset.sid + ':' + el.dataset.aid + ':' + el.dataset.critid;
      clearTimeout(_commentTimers[key]);
      delete _commentTimers[key];
      var found = _findCriterion(cid, el.dataset.aid, el.dataset.critid);
      if (!found) return;
      var text = el.value.trim();
      if (text === getRubricCriterionComment(cid, el.dataset.sid, el.dataset.aid, found.crit)) return;
      Grader.setCriterionComment(cid, el.dataset.sid, el.dataset.aid, el.dataset.critid, text);
      _markCritCommentBtn(el, found.crit, !!text);
      _syncReturnBar();
    }

    // The Comment button filled, or not, as the comment now is.
    function _markCritCommentBtn(el, crit, has) {
      var group = el.closest && el.closest('.m-crit-group');
      var btn = group && group.querySelector('.m-crit-comment-btn');
      if (!btn) return;
      btn.classList.toggle('is-on', has);
      btn.setAttribute('aria-label', (has ? 'Edit the comment on ' : 'Comment on ') + (crit.name || 'criterion'));
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
      var unit = _swiperUnits(cid, assessment).find(function (u) {
        return u.st.id === sid;
      });
      // The card is its own vertical scroller: keep its place, or every tap on
      // a lower criterion jumps back to the top.
      var top = card.scrollTop;
      card.outerHTML = _renderStudentCard(cid, st, assessment, getScores(cid), getAssignmentStatuses(cid), unit);
      var fresh = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
      if (!fresh) return;
      _fitCritComments(fresh);
      MGradePhotos.hydrate(fresh, cid);
      fresh.scrollTop = top;
    }

    /* ── Grade From Paper: Set Logan To (S7-F3 follow-up) ──────────
       The not-in card's Set Logan To opens a sheet of the four levels, in
       the class's order. A level sets every criterion (or competency) the
       student has no level for and records the work as handed in on paper:
       GraderWork.setToFromPaper in shared/grader.js, the desktop's rule.
       The toast's Undo puts the levels back, as on the desktop. */
    function _onScreen(cid, aid, sid) {
      return (
        _swiperCid === cid &&
        _swiperAid === aid &&
        !!document.getElementById('m-screen-grade-swiper') &&
        !!document.querySelector('#m-swiper .m-swiper-card[data-sid="' + sid + '"]')
      );
    }

    // html-safe: the name and title go through MC.esc; ids are ours; levels are numbers
    function openSetTo(cid, aid, sid) {
      var a = getAssessments(cid).find(function (x) {
        return x.id === aid;
      });
      var st = getStudents(cid).find(function (s) {
        return s.id === sid;
      });
      if (!a || !st || !MGradePhotos.takes(cid, a) || !MGradePhotos.paperLevels(cid, a)) return;
      if (isScoreLocked(cid, sid, aid) || !_onScreen(cid, aid, sid)) return;
      var title = 'Set ' + (displayNameFirst(st) || displayName(st)) + ' To';
      MC.presentSheet(
        '<div class="m-tg-menu m-setto-menu" role="dialog" aria-label="' +
          MC.esc(title) +
          '"><div class="m-tg-menu-head"><div class="m-tg-menu-name">' +
          MC.esc(title) +
          '</div><div class="m-tg-menu-sub">' +
          MC.esc(a.title) +
          '</div></div>' +
          levelOrderFor(cid)
            .map(function (lv) {
              return (
                '<button type="button" class="m-tg-menu-item m-setto-item" data-action="m-work-setto" data-level="' +
                lv +
                '" data-sid="' +
                sid +
                '" data-aid="' +
                aid +
                '"><span class="m-setto-dot" data-score="' +
                lv +
                '" aria-hidden="true">' +
                lv +
                '</span><span class="m-tg-menu-title">' +
                MC.esc(_levelName(lv)) +
                '</span></button>'
              );
            })
            .join('') +
          '<button type="button" class="m-tg-menu-cancel" data-action="m-sheet-cancel">Cancel</button>' +
          '</div>',
        { half: true },
      );
    }

    function setToFromPaper(cid, aid, sid, level) {
      MC.dismissSheet();
      // The grader moved on (another piece, another screen) while the sheet was up.
      if (!_onScreen(cid, aid, sid)) return null;
      var before = structuredClone(getScores(cid));
      var done = GraderWork.setToFromPaper(cid, aid, sid, level);
      var after = structuredClone(getScores(cid));
      clearProfCache();
      _refreshCard(cid, sid, aid);
      _updateThumbGraded(cid, aid);
      _syncReturnBar();
      // Once the paper mark is kept, the card says Handed in on paper.
      done.paper.then(function () {
        if (_onScreen(cid, aid, sid)) _redrawSwiper(cid, aid);
      });
      if (done.set) {
        var st = getStudents(cid).find(function (s) {
          return s.id === sid;
        });
        MC.showToast((st ? displayNameFirst(st) || displayName(st) : 'Student') + ' set to ' + _levelName(level), {
          onUndo: function () {
            Grader.undo(cid, before, after);
            clearProfCache();
            if (_onScreen(cid, aid, sid)) {
              _refreshCard(cid, sid, aid);
              _updateThumbGraded(cid, aid);
              _syncReturnBar();
            }
          },
        });
      }
      return done;
    }

    /* Write one level (and ±) under every key of a criterion, undoable as one. */
    function _writeCriterion(cid, sid, found, level, mod, plusMinus) {
      _writeKeys(cid, sid, found.assessment, rubricCriterionScoreKeys(found.crit), level, mod, plusMinus);
    }

    /* Write one level (and ±) under several score keys, undoable as one.
       `plusMinus` says the tap was a + or −, not a level. */
    function _writeKeys(cid, sid, assessment, keys, level, mod, plusMinus) {
      var aid = assessment.id;
      var prev = keys.map(function (tid) {
        var e = _currentEntry(cid, sid, aid, tid);
        return { tid: tid, prev: e ? [JSON.parse(JSON.stringify(e))] : [] };
      });
      _undoStack.push({ cid: cid, sid: sid, aid: aid, multi: prev });
      if (_undoStack.length > 20) _undoStack.shift();
      keys.forEach(function (tid) {
        if (plusMinus) Grader.setPlusMinusOnPhone(cid, sid, aid, tid, level, mod || 0, '');
        else Grader.setLevelOnPhone(cid, sid, aid, tid, level, mod || 0);
      });
      clearProfCache();
    }

    /* A competency row on rubric work is scored through the criteria that
       feed it, as on the desktop: it shows their level (one level, or the
       lowest marked mixed, with no ±), and a level set on it goes to each of
       them. Null for any other row, which is scored on its own. */
    function _rubricRowState(cid, sid, assessment, tid) {
      if (!_ownRubric(cid, assessment)) return null;
      var crits = rubricCriteriaForTag(cid, assessment, tid);
      if (!crits.length) return null;
      var lv = competencyLevelFromCriteria(cid, sid, assessment, tid, crits);
      if (!lv) return { level: 0, mod: 0, mixed: false };
      return { level: lv.score, mod: lv.mixed ? 0 : lv.mod, mixed: !!lv.mixed };
    }

    function _setRubricRowScore(cid, sid, assessment, tid, state, level) {
      var cleared = state.level === level && !state.mixed;
      _writeKeys(cid, sid, assessment, rubricRowScoreKeys(cid, assessment, tid), cleared ? 0 : level, 0);
      MC.haptic();
      _refreshCard(cid, sid, assessment.id);
      _updateThumbGraded(cid, assessment.id);
      _syncReturnBar();
    }

    // Tapping the active + or − again clears it.
    function _setRubricRowMod(cid, sid, assessment, tid, state, mod) {
      if (!(state.level > 0) || state.mixed) return;
      var next = state.mod === mod ? 0 : mod;
      if (normalizeScoreMod(state.level, next) !== next) return;
      _writeKeys(cid, sid, assessment, rubricRowScoreKeys(cid, assessment, tid), state.level, next, true);
      MC.haptic();
      _refreshCard(cid, sid, assessment.id);
      _syncReturnBar();
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
      _syncReturnBar();
    }

    // Tapping the active + or − again clears it.
    function setCriterionMod(cid, sid, aid, critId, mod) {
      var found = _findCriterion(cid, aid, critId);
      if (!found) return;
      var state = _critState(cid, sid, aid, found.crit);
      if (!(state.level > 0) || state.mixed) return;
      var next = state.mod === mod ? 0 : mod;
      if (normalizeScoreMod(state.level, next) !== next) return;
      _writeCriterion(cid, sid, found, state.level, next, true);
      MC.haptic();
      _refreshCard(cid, sid, aid);
      _syncReturnBar();
    }

    function setGradeView(cid, aid, view) {
      _rubricView[aid] = view !== 'tags';
      document.querySelectorAll('.m-grade-view-row .m-seg-btn').forEach(function (btn) {
        var on = btn.getAttribute('data-view') === view;
        btn.classList.toggle('m-seg-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      document.querySelectorAll('.m-grade-view-hint').forEach(function (hint) {
        hint.textContent =
          view === 'tags' ? 'One score for each competency the work assesses.' : 'One score for each rubric criterion.';
      });
      var assessment = getAssessments(cid).find(function (a) {
        return a.id === aid;
      });
      var swiper = document.getElementById('m-swiper');
      if (!swiper || !assessment) return;
      var left = swiper.scrollLeft;
      var scores = getScores(cid);
      var statuses = getAssignmentStatuses(cid);
      swiper.innerHTML = _swiperUnits(cid, assessment)
        .map(function (u) {
          return _renderStudentCard(cid, u.st, assessment, scores, statuses, u);
        })
        .join('');
      _fitCritComments(swiper);
      swiper.scrollLeft = left;
      MGradePhotos.hydrate(swiper, cid);
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
      var after = Grader.setTick(cid, sid, aid, checkId, on);
      var state = _critState(cid, sid, aid, found.crit);
      var next = RubricChecks.levelAfterTick(found.crit, state.level, before, after);
      if (next !== state.level) _writeCriterion(cid, sid, found, next, 0);
      MC.haptic();
      _refreshCard(cid, sid, aid);
      _updateThumbGraded(cid, aid);
      _syncReturnBar();
    }

    /* ── + / − on a level: Fine-tune <level>, − Minus and + Plus ── */
    // html-safe: attrs are our ids; the label goes through MC.esc; the buttons are MC.fineTuneButtonsHTML's fixed markup
    function _fineTuneHtml(attrs, level, mod, name) {
      return (
        '<div class="m-score-mods"' +
        attrs +
        ' data-name="' +
        MC.esc(name) +
        '" role="group" aria-label="' +
        MC.esc(MC.fineTuneLabel(level, name)) +
        '">' +
        MC.fineTuneButtonsHTML(level, mod) +
        '</div>'
      );
    }

    function _currentEntry(cid, sid, aid, tid) {
      var matches = (getScores(cid)[sid] || []).filter(function (s) {
        return s.assessmentId === aid && s.tagId === tid;
      });
      return matches.length ? matches[matches.length - 1] : null;
    }

    // A competency row after a save or an undo: its levels and Fine-tune.
    function _syncModBtns(cid, sid, aid, tid) {
      var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
      if (!card) return;
      var e = _currentEntry(cid, sid, aid, tid);
      var level = e && e.score > 0 ? roundLevel(e.score) : 0;
      var mod = level ? normalizeScoreMod(level, e.mod) : 0;
      MC.paintLevelButtons(
        card.querySelectorAll('.m-score-btn[data-aid="' + aid + '"][data-tid="' + tid + '"]'),
        level,
        mod,
      );
      var box = card.querySelector('.m-score-mods[data-aid="' + aid + '"][data-tid="' + tid + '"]');
      if (!box) return;
      box.setAttribute('aria-label', MC.fineTuneLabel(level, box.getAttribute('data-name')));
      // html-safe: MC.fineTuneButtonsHTML is fixed markup
      box.innerHTML = MC.fineTuneButtonsHTML(level, mod);
    }

    // Tapping the active + or − again clears it.
    function setScoreMod(cid, sid, aid, tid, mod) {
      var rowAssessment = getAssessments(cid).find(function (a) {
        return a.id === aid;
      });
      var rowState = rowAssessment ? _rubricRowState(cid, sid, rowAssessment, tid) : null;
      if (rowState) return _setRubricRowMod(cid, sid, rowAssessment, tid, rowState, mod);
      var e = _currentEntry(cid, sid, aid, tid);
      if (!e || !(e.score > 0)) return;
      var next = normalizeScoreMod(e.score, e.mod) === mod ? 0 : mod;
      if (normalizeScoreMod(e.score, next) !== next) return;
      _undoStack.push({ cid: cid, sid: sid, aid: aid, tid: tid, prev: [JSON.parse(JSON.stringify(e))] });
      if (_undoStack.length > 20) _undoStack.shift();
      Grader.setPlusMinusOnPhone(cid, sid, aid, tid, e.score, next, e.note || '');
      clearProfCache();
      MC.haptic();
      _syncModBtns(cid, sid, aid, tid);
      _syncReturnBar();
    }

    /* ── Score a student (auto-save) ────────────────────────────── */
    function setScore(cid, sid, aid, tid, score) {
      var rowAssessment = getAssessments(cid).find(function (a) {
        return a.id === aid;
      });
      var rowState = rowAssessment ? _rubricRowState(cid, sid, rowAssessment, tid) : null;
      if (rowState) return _setRubricRowScore(cid, sid, rowAssessment, tid, rowState, score);
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
      // inactive because none of them has data-score="0"). Tapping the level
      // again puts it back.
      var existing = prevEntries[prevEntries.length - 1];
      var cleared = existing && existing.score === score;
      if (cleared) score = 0;

      Grader.setLevelOnPhone(cid, sid, aid, tid, score);
      clearProfCache();
      MC.haptic();

      // The row's buttons; when cleared (score=0) none is chosen.
      _syncModBtns(cid, sid, aid, tid);

      // Update thumbnail graded state
      _updateThumbGraded(cid, aid);
      _syncReturnBar();

      // Saves are silent, clearing included: the buttons show the result and
      // a toast over the card got in the way (Colin, 2026-11-05).
    }

    function setStatus(cid, sid, aid, status) {
      var current = getAssignmentStatus(cid, sid, aid);
      var newStatus = current === status ? null : status;
      // Missing and Excused never go on work with a score or feedback.
      if (!canSetAssignmentStatus(cid, sid, aid, newStatus)) return;
      // The desktop's rule (data.js applyAssignmentStatus): NS on proficiency
      // work zeroes every score under it; clearing NS restores nothing.
      var clearsScores = Grader.setStatus(cid, sid, aid, newStatus);
      if (clearsScores) clearProfCache();
      MC.haptic();

      // Update pill states
      var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
      if (card) {
        card.querySelectorAll('.m-status-pill').forEach(function (pill) {
          pill.classList.toggle('m-status-active', pill.getAttribute('data-val') === newStatus);
        });
        // After auto-zero, deactivate every score button under this (sid, aid)
        // so the UI reflects the zeroed state (no button matches score=0).
        if (newStatus === 'NS' && clearsScores) {
          MC.paintLevelButtons(card.querySelectorAll('.m-score-btn[data-aid="' + aid + '"]'), 0, 0);
          card.querySelectorAll('.m-score-mods[data-aid="' + aid + '"]').forEach(function (box) {
            box.setAttribute('aria-label', MC.fineTuneLabel(0, box.getAttribute('data-name')));
            // html-safe: MC.fineTuneButtonsHTML is fixed markup
            box.innerHTML = MC.fineTuneButtonsHTML(0, 0);
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
      // Group work: a member's status can change whose grade the card shows.
      var a = getAssessments(cid).find(function (x) {
        return x.id === aid;
      });
      if (groupGradingUnits(cid, a, [])) _redrawSwiper(cid, aid);
      _syncReturnBar();
    }

    /* The entries an undo puts back. Missing or Excused work takes no score
       (isScoreLocked), so none with a level or points goes back under it. */
    function _undoEntries(entry, prev) {
      if (!isScoreLocked(entry.cid, entry.sid, entry.aid)) return prev;
      var a = getAssessments(entry.cid).find(function (x) {
        return x.id === entry.aid;
      });
      return prev.filter(function (p) {
        return !isScoreEntered(a, p);
      });
    }

    function undoLastScore() {
      var entry = _undoStack.pop();
      if (!entry) return;
      if (entry.multi) return _undoCriterion(entry);
      var prev = _undoEntries(entry, entry.prev);
      var allScores = getScores(entry.cid);
      var beforeScores = structuredClone(allScores);
      var stScores = (allScores[entry.sid] || []).filter(function (s) {
        return !(s.assessmentId === entry.aid && s.tagId === entry.tid);
      });
      // Restore previous entries
      prev.forEach(function (p) {
        stScores.push(p);
      });
      allScores[entry.sid] = stScores;
      Grader.undoOnPhone(entry.cid, entry.sid, entry.aid, beforeScores, allScores);
      clearProfCache();

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
        _undoEntries(entry, m.prev).forEach(function (p) {
          stScores.push(p);
        });
      });
      allScores[entry.sid] = stScores;
      Grader.undoOnPhone(entry.cid, entry.sid, entry.aid, beforeScores, allScores);
      clearProfCache();
      _refreshCard(entry.cid, entry.sid, entry.aid);
      _updateThumbGraded(entry.cid, entry.aid);
      MC.showToast('Score reverted');
    }

    /* ── Swiper scroll tracking ─────────────────────────────────── */
    function setupSwiper(cid, aid) {
      var swiper = document.getElementById('m-swiper');
      if (!swiper) return;
      // A bank competency's wording, ready for the level sheet.
      var assess = (getAssessments(cid) || []).find(function (a) {
        return a.id === aid;
      });
      var hasBank = ((assess && assess.tagIds) || []).some(function (t) {
        var tag = getTagById(cid, t);
        return tag && tag.bank_id;
      });
      if (hasBank && window.CompetencyWording) CompetencyWording.loadBank();
      _fitCritComments(swiper);
      _noteReturnBar(cid, aid);
      // The work's pages, the pinned strip and the page dots (S7-F2).
      MGradePhotos.wire(swiper, cid);

      // Points field: tapping selects the number so typing replaces it; Done
      // or tapping away saves. The tap's mouseup would put the caret back, so
      // that one mouseup is cancelled.
      var selectOnUp = null;
      swiper.addEventListener('focusin', function (e) {
        if (!e.target.classList.contains('m-pts-input')) return;
        e.target.setSelectionRange(0, e.target.value.length);
        selectOnUp = e.target;
      });
      swiper.addEventListener('mouseup', function (e) {
        if (e.target === selectOnUp) e.preventDefault();
        selectOnUp = null;
      });
      // An avatar tap moves on the finger lifting, not only on the click the
      // browser may swallow while the strip or the screen is still moving
      // (the first tap after opening was often lost). A drag along the strip
      // is not a tap. Jumping twice to the same student is harmless.
      var strip = document.getElementById('m-thumb-strip');
      if (strip) {
        var down = null;
        strip.addEventListener('pointerdown', function (e) {
          down = { x: e.clientX, y: e.clientY };
        });
        strip.addEventListener('pointerup', function (e) {
          var thumb = e.target.closest('.m-thumb');
          var moved = down ? Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) : 99;
          down = null;
          if (!thumb || moved > 10) return;
          jumpToStudent(parseInt(thumb.getAttribute('data-idx'), 10));
        });
      }
      _installArrowKeys();
      var lastCard =
        typeof swiper.querySelector === 'function'
          ? swiper.querySelector('.m-swiper-card:last-child .m-pts-input')
          : null;
      if (lastCard) lastCard.setAttribute('enterkeyhint', 'done');
      // Enter saves and moves to the next student's points, as Enter does in
      // the desktop grader; on the last student it just saves. Escape puts
      // the score back.
      swiper.addEventListener('keydown', function (e) {
        if (!e.target.classList.contains('m-pts-input')) return;
        if (e.key === 'Escape') {
          e.target.dataset.revert = '1';
          e.target.blur();
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          var inp = e.target;
          inp.blur();
          _nextStudentPoints(swiper, inp);
        }
      });
      // The % follows the typing, as on the desktop.
      swiper.addEventListener('input', function (e) {
        var inp = e.target;
        if (!inp.classList.contains('m-pts-input')) return;
        var max = parseFloat(inp.dataset.max) || 100;
        _updatePointsPct(inp.dataset.sid, inp.dataset.aid, parsePointsInput(inp.value, max), max);
      });
      swiper.addEventListener('focusout', function (e) {
        if (e.target.classList.contains('m-overall-comment')) return _saveOverallComment(cid, e.target);
        if (e.target.classList.contains('m-crit-comment')) {
          _saveCritComment(cid, e.target);
          return _closeEmptyCritComment(e.target);
        }
        if (!e.target.classList.contains('m-pts-input')) return;
        selectOnUp = null;
        commitPointsInput(cid, e.target);
      });
      // The Overall Comment saves as the teacher types and when they leave it.
      swiper.addEventListener('input', function (e) {
        if (e.target.classList.contains('m-crit-comment')) {
          var box = e.target;
          _fitCritComment(box);
          var ckey = box.dataset.sid + ':' + box.dataset.aid + ':' + box.dataset.critid;
          clearTimeout(_commentTimers[ckey]);
          _commentTimers[ckey] = setTimeout(function () {
            _saveCritComment(cid, box);
          }, 800);
          return;
        }
        if (!e.target.classList.contains('m-overall-comment')) return;
        var el = e.target;
        var key = el.dataset.sid + ':' + el.dataset.aid;
        clearTimeout(_commentTimers[key]);
        _commentTimers[key] = setTimeout(function () {
          _saveOverallComment(cid, el);
        }, 800);
      });

      swiper.addEventListener(
        'scroll',
        function () {
          if (_scrollRAF) return;
          _scrollRAF = requestAnimationFrame(function () {
            _scrollRAF = null;
            var idx = Math.round(swiper.scrollLeft / swiper.clientWidth);
            var total = document.querySelectorAll('#m-thumb-strip .m-thumb').length;
            if (idx !== _currentIdx && idx >= 0 && idx < total) {
              _currentIdx = idx;
              _updateCurrentThumb(idx);
              _updateSubtitle(idx, total);
              _syncReturnBar(true);
            }
          });
        },
        { passive: true },
      );
    }

    // ← and → move between students on the grading screen, unless the
    // cursor is in a text field. Installed once; it acts only while the
    // grading screen is the open one and no sheet is up.
    var _arrowKeysOn = false;
    function _installArrowKeys() {
      if (_arrowKeysOn) return;
      _arrowKeysOn = true;
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var screen = document.getElementById('m-screen-grade-swiper');
        if (!screen || screen.offsetParent === null || screen.nextElementSibling) return;
        var backdrop = document.getElementById('m-sheet-backdrop');
        if (backdrop && !backdrop.classList.contains('u-hidden')) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
        var total = document.querySelectorAll('#m-thumb-strip .m-thumb').length;
        var next = _currentIdx + (e.key === 'ArrowRight' ? 1 : -1);
        if (next < 0 || next >= total) return;
        e.preventDefault();
        jumpToStudent(next);
      });
    }

    /* Each chip's letters: the initials, or, where students share them (two
       JC), the shortest start of the first name, with the last initial, that
       tells them apart ("JaC" and "JoC"; "JasC" and "JaqC"), else of the last
       name ("JCha" and "JChe"). A group's chip keeps its G1 / P1. */
    function _thumbTexts(students, units) {
      var first = function (st) {
        return String(st.preferred || st.firstName || '');
      };
      var last = function (st) {
        return String(st.lastName || '');
      };
      var cap = function (s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
      };
      var out = students.map(function (st, i) {
        return units[i] && units[i].view ? units[i].thumb : MC.avatarInitials(st);
      });
      var groups = {};
      out.forEach(function (txt, i) {
        if (units[i] && units[i].view) return;
        (groups[txt] = groups[txt] || []).push(i);
      });
      Object.keys(groups).forEach(function (key) {
        var idxs = groups[key];
        if (idxs.length < 2) return;
        var ways = [];
        for (var k = 2; k <= 5; k++) {
          ways.push(
            (function (n) {
              return function (st) {
                return cap(first(st).slice(0, n)) + last(st).charAt(0).toUpperCase();
              };
            })(k),
          );
        }
        for (var m = 2; m <= 5; m++) {
          ways.push(
            (function (n) {
              return function (st) {
                return first(st).charAt(0).toUpperCase() + cap(last(st).slice(0, n));
              };
            })(m),
          );
        }
        idxs.forEach(function (i) {
          var st = students[i];
          var mine = null;
          for (var w = 0; w < ways.length && !mine; w++) {
            var t = ways[w](st);
            var clash = idxs.some(function (j) {
              return j !== i && ways[w](students[j]) === t;
            });
            if (!clash) mine = t;
          }
          out[i] = mine || key;
        });
      });
      return out;
    }

    function _nextStudentPoints(swiper, inp) {
      var cards = Array.prototype.slice.call(swiper.querySelectorAll('.m-swiper-card'));
      var idx = cards.indexOf(inp.closest('.m-swiper-card'));
      if (idx < 0 || idx >= cards.length - 1) return;
      jumpToStudent(idx + 1);
      var next = cards[idx + 1].querySelector('.m-pts-input');
      if (next) next.focus({ preventScroll: true });
    }

    var _commentTimers = {};
    function _saveOverallComment(cid, el) {
      var key = el.dataset.sid + ':' + el.dataset.aid;
      clearTimeout(_commentTimers[key]);
      delete _commentTimers[key];
      var text = el.value.trim();
      if (text === getScoreComment(cid, el.dataset.sid, el.dataset.aid)) return;
      Grader.setOverallComment(cid, el.dataset.sid, el.dataset.aid, text);
      _syncReturnBar();
    }

    // `instant` lands on the student with no scroll animation.
    function jumpToStudent(idx, instant) {
      var swiper = document.getElementById('m-swiper');
      if (!swiper) return;
      swiper.scrollTo({ left: idx * swiper.clientWidth, behavior: instant ? 'auto' : 'smooth' });
      _currentIdx = idx;
      _updateCurrentThumb(idx);
      _updateSubtitle(idx, document.querySelectorAll('#m-thumb-strip .m-thumb').length);
      _syncReturnBar();
    }

    function _updateCurrentThumb(idx) {
      var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
      thumbs.forEach(function (t, i) {
        t.classList.toggle('m-thumb-current', i === idx);
        if (i === idx) t.setAttribute('aria-current', 'true');
        else t.removeAttribute('aria-current');
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
        if (sub) sub.textContent = _subtitleText(idx, total);
      }
    }

    function _updateThumbGraded(cid, aid) {
      // A score just changed: M and EXC grey out once the work has one.
      document.querySelectorAll('.m-status-pill[data-aid="' + aid + '"]').forEach(function (pill) {
        pill.disabled = !canSetAssignmentStatus(cid, pill.dataset.sid, aid, pill.dataset.val);
      });
      document.querySelectorAll('.m-status-hint[data-aid="' + aid + '"]').forEach(function (hint) {
        hint.hidden = canSetAssignmentStatus(cid, hint.dataset.sid, aid, 'NS');
      });
      var allScores = getScores(cid);
      var assessment = getAssessments(cid).find(function (a) {
        return a.id === aid;
      });
      var thumbs = document.querySelectorAll('#m-thumb-strip .m-thumb');
      thumbs.forEach(function (t) {
        var stScores = allScores[t.dataset.sid] || [];
        var isGraded = stScores.some(function (s) {
          return s.assessmentId === aid && isScoreEntered(assessment, s);
        });
        t.classList.toggle('m-thumb-graded', isGraded);
      });
    }

    /* ── Complete / Incomplete ──────────────────────────────── */
    // html-safe: fixed markup; m is 'complete' or 'incomplete'.
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
      Grader.setMark(cid, sid, aid, next);
      clearProfCache();
      MC.haptic();
      var group = document.querySelector('.m-cmp-group[data-sid="' + sid + '"][data-aid="' + aid + '"]');
      if (group) group.innerHTML = _completionBtnsHtml(next);
      _updateThumbGraded(cid, aid);
      _syncReturnBar();
    }

    // + and − step within the same limit as typing: 0 up to the bonus cap.
    function adjustPointsScore(cid, sid, aid, delta, maxPts) {
      var current = getPointsScore(cid, sid, aid) || 0;
      var next = Math.max(0, Math.min(maxPts * POINTS_EXTRA_CREDIT_FACTOR, current + delta));
      Grader.setPoints(cid, sid, aid, next);
      clearProfCache();
      MC.haptic();
      // Update display
      var el = document.getElementById('m-pts-' + sid + '-' + aid);
      if (el) el.value = formatPoints(next);
      _updatePointsPct(sid, aid, next, maxPts);
      _updateThumbGraded(cid, aid);
      _syncReturnBar();
    }

    /* The % beside the points field, as the desktop shows it: "bonus" under
       it above the maximum, nothing with no score. */
    function _updatePointsPct(sid, aid, value, max) {
      var el = document.getElementById('m-pts-pct-' + sid + '-' + aid);
      if (el) el.innerHTML = pointsPctHtml(value, max, 0);
    }

    /* Typed points save like the desktop points box: the same clamp
       (parsePointsInput), blank clears, a typed 0 is a score, a typo ("abc")
       puts back the saved score, and leaving the field unchanged saves
       nothing. */
    function commitPointsInput(cid, inp) {
      var sid = inp.dataset.sid;
      var aid = inp.dataset.aid;
      var max = parseFloat(inp.dataset.max) || 100;
      var prev = getPointsScore(cid, sid, aid);
      // Escape puts the saved score back without saving.
      var raw = inp.dataset.revert ? prev : parsePointsInput(inp.value, max, prev);
      delete inp.dataset.revert;
      inp.value = raw != null ? formatPoints(raw) : '';
      _updatePointsPct(sid, aid, raw, max);
      if (raw === prev) return;
      Grader.setPoints(cid, sid, aid, raw);
      clearProfCache();
      _updateThumbGraded(cid, aid);
      _syncReturnBar();
    }

    /* ── Press and hold a level (Nov 2 mockup, batch 2) ──────────────
       Holding a competency's 1–4 button for about half a second opens a
       sheet: the competency, the level, its descriptor, what Proficient
       means (the I Can statements) and the next step (CompetencyWording).
       Letting go doesn't score; a quick tap still does, and a finger that
       moves first cancels the hold. */
    var HOLD_MS = 450;
    var _hold = null;
    var _swiperCid = null;

    function _levelSheetHtml(cid, tag, level) {
      var l = CompetencyWording.lines(tag, level);
      if (!l) return '';
      var word = typeof levelWord === 'function' ? levelWord(cid, level) : l.word;
      return (
        '<div class="m-level-sheet">' +
        '<h2 class="m-level-sheet-title">' +
        MC.esc(tag.label || tag.code || '') +
        '</h2>' +
        '<div class="m-level-sheet-level">' +
        level +
        (word ? ' \u00b7 ' + MC.esc(word) : '') +
        '</div>' +
        (l.descriptor ? '<p>' + MC.esc(l.descriptor) + '</p>' : '') +
        (l.iCans.length
          ? '<p><b>Proficient means:</b></p><ul>' +
            l.iCans
              .map(function (x) {
                return '<li>' + MC.esc(x) + '</li>';
              })
              .join('') +
            '</ul>'
          : '') +
        (l.next ? '<p><b>Next step:</b> ' + MC.esc(l.next) + '</p>' : '') +
        '</div>'
      );
    }

    function showLevelSheet(btn) {
      var cid = _swiperCid;
      var tag = cid && typeof getTagById === 'function' ? getTagById(cid, btn.getAttribute('data-tid')) : null;
      var level = parseInt(btn.getAttribute('data-score'), 10);
      if (!tag || !window.CompetencyWording) return;
      var html = _levelSheetHtml(cid, tag, level);
      if (!html) return;
      MC.presentSheet(html, { half: true });
      var l = CompetencyWording.lines(tag, level);
      if (l && !l.ready)
        CompetencyWording.loadBank().then(function (ok) {
          var box = document.querySelector('#m-sheet-container .m-level-sheet');
          // html-safe: _levelSheetHtml escapes the label, level word, descriptor, I Can statements and step (MC.esc)
          if (ok && box) box.outerHTML = _levelSheetHtml(cid, tag, level);
        });
    }

    function _holdDown(e) {
      // A finger or pen: a mouse's slow click still scores.
      if (e.pointerType === 'mouse') return;
      var btn = e.target.closest && e.target.closest('.m-score-btn[data-tid]');
      if (!btn) return;
      if (_hold) clearTimeout(_hold.timer);
      _hold = {
        btn: btn,
        x: e.clientX,
        y: e.clientY,
        shown: false,
        timer: setTimeout(function () {
          _hold.shown = true;
          showLevelSheet(btn);
        }, HOLD_MS),
      };
    }
    function _holdMove(e) {
      if (!_hold || _hold.shown) return;
      if (Math.abs(e.clientX - _hold.x) + Math.abs(e.clientY - _hold.y) > 10) {
        clearTimeout(_hold.timer);
        _hold = null;
      }
    }
    function _holdUp() {
      if (!_hold) return;
      clearTimeout(_hold.timer);
      if (!_hold.shown) _hold = null;
    }
    // The click that ends a hold is swallowed, so the level isn't scored.
    function _holdClick(e) {
      if (!_hold) return;
      var held = _hold.shown && _hold.btn.contains(e.target);
      _hold = null;
      if (!held) return;
      e.preventDefault();
      e.stopPropagation();
    }
    document.addEventListener('pointerdown', _holdDown);
    document.addEventListener('pointermove', _holdMove);
    document.addEventListener('pointerup', _holdUp);
    document.addEventListener('pointercancel', _holdUp);
    document.addEventListener('click', _holdClick, true);

    return {
      renderSwiper: renderSwiper,
      setScore: setScore,
      setScoreMod: setScoreMod,
      setCriterionScore: setCriterionScore,
      setCriterionMod: setCriterionMod,
      setGradeView: setGradeView,
      toggleChecklist: toggleChecklist,
      openCritComment: openCritComment,
      tickCheck: tickCheck,
      setStatus: setStatus,
      adjustPointsScore: adjustPointsScore,
      setCompletion: setCompletion,
      undoLastScore: undoLastScore,
      setupSwiper: setupSwiper,
      jumpToStudent: jumpToStudent,
      studentCardIndex: studentCardIndex,
      openMemberSheet: openMemberSheet,
      gradeSeparately: gradeSeparately,
      confirmBackToGroup: confirmBackToGroup,
      backToGroup: backToGroup,
      returnAndNext: returnAndNext,
      openRevisionSheet: openRevisionSheet,
      sendRevision: sendRevision,
      takeBackRevision: takeBackRevision,
      showStudentPiece: showStudentPiece,
      openPaperCriterion: openPaperCriterion,
      openSetTo: openSetTo,
      setToFromPaper: setToFromPaper,
      studentWork: function () {
        return _student ? { sid: _student.sid, aids: _student.aids.slice(), kinds: _student.kinds.slice() } : null;
      },
      jumpToFirstDraft: jumpToFirstDraft,
      // Draw the grading screen again in place, if it shows this piece (Add Work, S7-F3).
      refreshSwiper: function (cid, aid) {
        if (_swiperCid === cid && _swiperAid === aid && document.getElementById('m-screen-grade-swiper')) {
          _redrawSwiper(cid, aid);
        }
      },
      getCurrentIndex: function () {
        return _currentIdx;
      },
      // 'tograde' while the screen grades only the work waiting.
      gradingOnly: function () {
        return _onlyIds && !_onlyOrdered ? 'tograde' : null;
      },
      // Each student card scrolls on its own; a redraw puts them back.
      getCardScrolls: function () {
        var tops = {};
        document.querySelectorAll('#m-swiper .m-swiper-card').forEach(function (c) {
          if (c.scrollTop) tops[c.getAttribute('data-sid')] = c.scrollTop;
        });
        return tops;
      },
      setCardScrolls: function (tops) {
        document.querySelectorAll('#m-swiper .m-swiper-card').forEach(function (c) {
          var top = tops && tops[c.getAttribute('data-sid')];
          if (top) c.scrollTop = top;
        });
      },
    };
  })();

  return {
    renderPicker: List.renderPicker,
    filterAssessments: List.filterAssessments,
    openFilterSheet: List.openFilterSheet,
    onFilterTogglePill: List.onFilterTogglePill,
    onFilterSegChange: List.onFilterSegChange,
    clearFilterSheet: List.clearFilterSheet,
    renderSwiper: Speed.renderSwiper,
    setScore: Speed.setScore,
    setScoreMod: Speed.setScoreMod,
    setCriterionScore: Speed.setCriterionScore,
    setCriterionMod: Speed.setCriterionMod,
    setGradeView: Speed.setGradeView,
    toggleChecklist: Speed.toggleChecklist,
    openCritComment: Speed.openCritComment,
    tickCheck: Speed.tickCheck,
    setStatus: Speed.setStatus,
    adjustPointsScore: Speed.adjustPointsScore,
    setCompletion: Speed.setCompletion,
    undoLastScore: Speed.undoLastScore,
    setupSwiper: Speed.setupSwiper,
    jumpToStudent: Speed.jumpToStudent,
    studentCardIndex: Speed.studentCardIndex,
    openMemberSheet: Speed.openMemberSheet,
    gradeSeparately: Speed.gradeSeparately,
    confirmBackToGroup: Speed.confirmBackToGroup,
    backToGroup: Speed.backToGroup,
    // Draft and Returned (S1-F3)
    holdsGrades: _holdsGrades,
    draftsSentence: function (cid, sids) {
      return GradeState.draftsSentence(cid, sids);
    },
    refreshToReturn: List.refreshToReturn,
    askReturnAll: List.askReturnAll,
    returnAndNext: Speed.returnAndNext,
    // Revisions (S11-F1)
    openRevisionSheet: Speed.openRevisionSheet,
    sendRevision: Speed.sendRevision,
    takeBackRevision: Speed.takeBackRevision,
    showStudentPiece: Speed.showStudentPiece,
    openPaperCriterion: Speed.openPaperCriterion,
    openSetTo: Speed.openSetTo,
    setToFromPaper: Speed.setToFromPaper,
    studentWork: Speed.studentWork,
    jumpToFirstDraft: Speed.jumpToFirstDraft,
    studentDrafts: List.studentDrafts,
    returnFromCard: List.returnFromCard,
    // Student work (S7)
    segment: List.segment,
    openRowMenu: List.openRowMenu,
    doneFilterSheet: List.doneFilterSheet,
    getCurrentIndex: Speed.getCurrentIndex,
    getCardScrolls: Speed.getCardScrolls,
    gradingOnly: Speed.gradingOnly,
    setCardScrolls: Speed.setCardScrolls,
    refreshSwiper: Speed.refreshSwiper,
  };
})();
