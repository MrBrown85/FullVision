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
      (getAssignedAssessments(cid) || []).find(function (a) {
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
      return getAssignedAssessments(cid)
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
      return getAssignedAssessments(cid)
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

    /* One piece on the list: its name and ⋯ (in a class that takes work), what
       waits ("3 to Grade" strong, "20 Not In" a chip) and the bar. The line of
       category, date and count stays on a piece with nothing waiting, where
       it tells one piece from another. */
    // html-safe: the title and category go through MC.esc; ids are ours; counts are numbers; dateStr is a date
    function _rowHtml(cid, a, shown) {
      var students = getStudents(cid);
      var dateStr = a.date
        ? parseLocalDate(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
        : 'No Date';
      var gradedCount = _gradedCountFor(a, students, getScores(cid));
      var total = students.length;
      var pct = total > 0 ? Math.min(100, Math.max(0, Math.round((gradedCount / total) * 100))) : 0;
      var takes = MGradePhotos.on(cid);
      // GraderWork's counts (grade-photos.js): a group graded together is one to grade.
      var waiting = takes ? MGradePhotos.toGradeCount(cid, a) : 0;
      var out = takes ? MGradePhotos.notIn(cid, a).length : 0;
      var counts = '';
      if (waiting) counts += '<span class="m-tg-pill">' + _CAMERA_ICON + waiting + ' to Grade</span>';
      if (out) counts += '<span class="m-tg-notin">' + out + ' Not In</span>';
      if (!counts && takes && MGradePhotos.takes(cid, a) && gradedCount >= total && total > 0)
        counts = '<span class="m-tg-done">All Graded</span>';
      var line = '';
      if (!waiting) {
        var tagCount = (a.tagIds || []).length;
        var badge = _assessmentBadgeData(cid, a);
        line =
          '<div class="m-tg-line">' +
          // A class with no categories shows no "No Category" chip.
          (showsCategoryBadge(cid, a)
            ? '<span class="m-type-badge ' + badge.className + '">' + MC.esc(badge.label) + '</span>'
            : '') +
          '<span>' +
          dateStr +
          '</span>' +
          (takes ? '' : '<span>' + tagCount + (tagCount !== 1 ? ' competencies' : ' competency') + '</span>') +
          '<span>' +
          gradedCount +
          '/' +
          total +
          ' graded</span></div>';
      }
      return (
        '<div class="m-tg-row" data-action="m-grade-assess" data-aid="' +
        a.id +
        '" data-tg="' +
        waiting +
        '"' +
        (shown ? '' : ' hidden') +
        '><div class="m-tg-body"><div class="m-tg-title">' +
        MC.esc(a.title) +
        '</div>' +
        (counts ? '<div class="m-tg-counts">' + counts + '</div>' : '') +
        line +
        '<div class="m-progress-bar"><div class="m-progress-fill" style="width:' +
        pct +
        '%"></div></div></div>' +
        (takes
          ? '<button type="button" class="m-tg-more" data-action="m-grade-row-menu" data-aid="' +
            a.id +
            '" aria-label="' +
            MC.esc('More for ' + a.title) +
            '">' +
            _MORE_ROW_ICON +
            '</button>'
          : MC.ICONS.chevronRight) +
        '</div>'
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
        (_segmentMode === 'tograde' && !any ? '' : ' hidden') +
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
      scan: '<path d="M7 3h7l4 4v14H7z"/><path d="M4 12h16"/>',
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
          // Split a Scan (B7): where the desktop offers Add Work for the Class.
          (window.MSplitScan && window.AddWorkClass && AddWorkClass.offered(cid, a)
            ? item('', 'Split a Scan', 'One PDF of everyone’s pages', 'm-split-scan', 'scan')
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
      var nav = MC.tabBar(cid, { id: 'grade-picker' });

      var assessments = getAssignedAssessments(cid);

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
        cells = '<div class="m-tg-list" id="m-grade-list">';
        sorted.forEach(function (a) {
          cells += _rowHtml(cid, a, _matchesAllFilters(a, ctx));
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

      var assessments = getAssignedAssessments(cid);
      var ctx = _filterCtx(cid);

      // Update segmented control active state
      document.querySelectorAll('.m-seg-btn[data-action="m-grade-seg"]').forEach(function (btn) {
        btn.classList.toggle('m-seg-active', btn.getAttribute('data-val') === _segmentMode);
        if (btn.hasAttribute('aria-pressed'))
          btn.setAttribute('aria-pressed', btn.getAttribute('data-val') === _segmentMode ? 'true' : 'false');
      });
      _showSegment(cid);

      document.querySelectorAll('#m-grade-list .m-tg-row').forEach(function (row) {
        var aid = row.getAttribute('data-aid');
        var a = assessments.find(function (x) {
          return x.id === aid;
        });
        _setHidden(row, !a || !_matchesAllFilters(a, ctx));
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
      if (caught) _setHidden(caught, !(_segmentMode === 'tograde' && !shown));
      var count = document.querySelector('#m-sheet-container .m-live-filter-count');
      if (count) count.textContent = 'Showing ' + shown + ' of ' + assessments.length;
    }

    /* ── Filter sheet ───────────────────────────────────────────── */

    /* The filter that applies as it is tapped (S7-F1): Status, Date,
       Category and Module as short lists, a check on each row picked (not
       outlined capsules: Colin, 2026-11-25), "Showing 6 of 18", Clear All
       and Done. Each tap changes the list under the sheet at once. */

    // html-safe: labels go through MC.esc; values are ours or category ids through MC.esc
    function _renderLiveFilterSheet(cid) {
      var categories = typeof getCategories === 'function' ? getCategories(cid) : [];
      var modules = typeof getModules === 'function' ? getModules(cid) : [];
      var chip = function (action, kind, value, label, on) {
        return (
          '<button type="button" class="m-filter-row' +
          (on ? ' m-filter-active' : '') +
          '" data-action="' +
          action +
          '" data-kind="' +
          kind +
          '" data-val="' +
          MC.esc(value) +
          '" aria-pressed="' +
          (on ? 'true' : 'false') +
          '"><span class="m-filter-row-label">' +
          MC.esc(label) +
          '</span></button>'
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
          '<div class="m-filter-sheet-section" role="group" aria-label="' +
          title +
          '"><div class="m-filter-sheet-title" aria-hidden="true">' +
          title +
          '</div><div class="m-filter-list">' +
          chips +
          '</div></div>'
        );
      };
      var assessments = getAssignedAssessments(cid);
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

    function _syncLiveChips() {
      document.querySelectorAll('#m-sheet-container .m-live-filter .m-filter-row').forEach(function (btn) {
        var kind = btn.getAttribute('data-kind');
        var val = btn.getAttribute('data-val');
        var on = Array.isArray(_filters[kind]) ? _filters[kind].indexOf(val) >= 0 : _filters[kind] === val;
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
    // The card a jump is sliding to: the cards it passes on the way never
    // become the one on screen. A second after the jump the cards rule again,
    // so a finger that stops the slide is followed.
    var _jumpTo = null;
    var _jumpTimer = null;
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
      var a = (getAssignedAssessments(cid) || []).find(function (x) {
        return x.id === aid;
      });
      if (!a) return -1;
      return _swiperUnits(cid, a).findIndex(function (u) {
        if (u.view) return u.view.members.indexOf(sid) !== -1 && !isGradedSeparately(a, sid);
        return u.st.id === sid;
      });
    }

    /* What is out of the ordinary on a card, as chips above the paper: IEP, MOD or ELL; a
       status (Late, Missing, Excused; set from ⋯, a tap on its chip takes it off) and, on a
       pair's or group's card, whose it is; Graded Separately. Nothing when there is nothing to say. */
    // html-safe: names go through MC.esc; classes and labels are fixed words
    function _chipsHtml(cid, assessment, unit, allStatuses) {
      var members = unit.view ? unit.view.members : [unit.st.id];
      var students = getStudents(cid);
      var seen = {};
      var html = '';
      var add = function (cls, text) {
        html += '<span class="' + cls + '">' + MC.esc(text) + '</span>';
      };
      members.forEach(function (m) {
        var st = students.find(function (x) {
          return x.id === m;
        });
        if (!st) return;
        (st.designations || []).forEach(function (code) {
          var des = BC_DESIGNATIONS[code];
          var kind = des && des.iep ? 'iep' : des && des.modified ? 'mod' : code === 'ELL' ? 'ell' : '';
          if (!kind || seen[kind]) return;
          seen[kind] = true;
          add('m-badge m-badge-' + kind, kind.toUpperCase());
        });
      });
      members.forEach(function (m) {
        var st = students.find(function (x) {
          return x.id === m;
        });
        // A pair's or group's chip says whose it is.
        var who = unit.view && st ? (displayNameFirst(st) || displayName(st)) + ': ' : '';
        if (unit.view && isGradedSeparately(assessment, m)) return add('m-grade-chip', who + 'Graded Separately');
        var status = allStatuses[m + ':' + assessment.id] || null;
        if (status) html += MGradeLook.statusChip(m, assessment.id, status, who + _STATUS_WORDS[status]);
      });
      if (unit.separateFrom) add('m-grade-chip', 'Graded Separately');
      return html ? '<div class="m-grade-chips">' + html + '</div>' : '';
    }
    var _STATUS_WORDS = { NS: 'Missing', EXC: 'Excused', LATE: 'Late' };

    // Draw the swiper's cards and the progress line again in place, on the same card.
    function _redrawSwiper(cid, aid) {
      var swiper = document.getElementById('m-swiper');
      var strip = document.getElementById('m-grade-progress');
      if (!swiper || !strip) return;
      var idx = _currentIdx;
      var tmp = document.createElement('div');
      // html-safe: renderSwiper escapes its text (see _renderStudentCard)
      tmp.innerHTML = renderSwiper(cid, aid, { keep: true });
      // html-safe: copied from the checked renderSwiper markup above
      swiper.innerHTML = tmp.querySelector('#m-swiper').innerHTML;
      // html-safe: copied from the checked renderSwiper markup above
      strip.innerHTML = tmp.querySelector('#m-grade-progress').innerHTML;
      _fitCritComments(swiper);
      var total = strip.querySelectorAll('.m-prog-seg').length;
      jumpToStudent(Math.min(idx, total - 1), true);
      MGradePhotos.hydrate(swiper, cid); // after the jump: the cards round the one on screen
    }

    function gradeSeparately(cid, aid, sid) {
      MC.dismissSheet();
      Grader.gradeSeparately(cid, aid, sid);
      MC.haptic();
      _redrawSwiper(cid, aid);
    }
    // Back to Group Grade asks first: it replaces the member's own grade.
    function confirmBackToGroup(cid, aid, sid) {
      var a = getAssignedAssessments(cid).find(function (x) {
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
      var assessments = getAssignedAssessments(cid);
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
      if (!(opts && (opts.keep || opts.pinned))) _paperOpen = {};
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
        // Drawn again (opts.pinned): the students it had, though one graded since no longer waits.
        var waiting = opts.pinned || MGradePhotos.toGrade(cid, assessment);
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
      _drawn = { cid: cid, aid: aid, units: units };
      var students = units.map(function (u) {
        return u.st;
      });
      var allScores = getScores(cid);
      _currentIdx = 0;
      _caughtUp = false;

      var stuSt = _student ? students[0] : null;
      // The top bar names the card on screen, its name opens the class list,
      // and ⋯ holds what a card rarely needs (teacher-mobile/grade-look.js).
      var bar = MGradeLook.bar(cid, aid, units, !!stuSt);
      var nav = MC.navBar({
        id: 'grade-swiper',
        title: stuSt ? displayName(stuSt) : bar.title || assessment.title,
        titleAction: bar.titleAction,
        backLabel: stuSt ? displayNameFirst(stuSt) || displayName(stuSt) : 'Grade',
        backIconOnly: true,
        // The sync dot is the only place sync problems show, so the grading
        // screen carries it too.
        rightHTML: MC.syncDot() + bar.more,
      });

      // The progress line: a segment for each card, dark once graded, blue for
      // the one on screen. Nothing in it is a control; the class list (the
      // name in the bar) is how a teacher goes to a student. One student's
      // work has a tab for each piece instead, and keeps the line hidden for
      // the card count.
      var progress =
        '<div class="m-grade-progress" id="m-grade-progress" aria-hidden="true"' + (stuSt ? ' hidden' : '') + '>';
      students.forEach(function (st, idx) {
        var isGraded = (allScores[st.id] || []).some(function (s) {
          return s.assessmentId === aid && isScoreEntered(assessment, s);
        });
        progress +=
          '<span class="m-prog-seg' +
          (idx === 0 ? ' is-current' : '') +
          (isGraded ? ' is-graded' : '') +
          '" data-sid="' +
          st.id +
          '"></span>';
      });
      progress += '</div>';
      if (stuSt) progress += _studentTabsHtml(cid, stuSt);

      var allStatuses = getAssignmentStatuses(cid);
      var swiper = '<div class="m-swiper" id="m-swiper">';
      students.forEach(function (st, idx) {
        swiper += _renderStudentCard(cid, st, assessment, allScores, allStatuses, units[idx]);
      });
      swiper += '</div>';

      return (
        '<div class="m-screen m-screen-hidden" id="m-screen-grade-swiper">' +
        nav +
        progress +
        swiper +
        _returnBarHtml(cid, assessment, units, 0) +
        '</div>'
      );
    }

    /* ── The grading screen's bottom bar ────────────────────────────
       Under the cards, above the tab bar, for the card on screen: For
       Revision beside Return and Next (Return and Finish on the last card)
       while its grade waits; "Returned Nov 3" once it is given; the button
       greyed out with nothing in. In a class that returns as soon as it
       saves (or has no student page) there is nothing to return, so the
       button is Next Student. It is the desktop grader's row
       (_graderReturnHtml, teacher/page-assignments.js) and follows its
       rules: a change to a returned grade adds what the student still sees;
       a status alone is not a grade, so a piece with a status and nothing
       in shows no Return; a DIBELS benchmark is not returned; a group's
       card returns every member still graded with the group. It is drawn
       again only when it changes. */
    var _swiperAid = null;
    // Set while the next card slides in after Return and Next.
    var _returnSliding = null;
    var RETURN_SLIDE_MS = 500;

    // The students a card's Return returns: the group's linked members, or the one student.
    function _cardReturnIds(unit) {
      return unit.view ? (unit.view.linked || []).slice() : [unit.st.id];
    }

    // { state, act }: the line that says where the grade stands, and the buttons.
    // html-safe: fixed labels; the name and the date go through MC.esc
    function _returnBarParts(cid, a, unit, last) {
      var parts = _returnBarOwn(cid, a, unit, last);
      // For Revision or Take Back, then the blue button.
      return { state: parts.state, act: (parts.lead || '') + parts.act };
    }

    // The blue button of a class that returns as it saves: on to the next card.
    function _nextStudentBtn(last) {
      return (
        '<button type="button" class="m-grade-return-btn" data-action="m-grade-next-student">' +
        (last ? 'Finish' : 'Next Student') +
        '</button>'
      );
    }

    function _returnBarOwn(cid, a, unit, last) {
      var none = { state: '', act: '' };
      if (!unit) return none;
      // A return held for Undo already reads as returned.
      if (MGradeLook.held(cid, a.id, unit.st.id))
        return { state: '<span class="m-returned-mark">Returned</span>', act: '' };
      // What the bar says is worked out once for both layouts (S11-T1),
      // revisions with it (S11-F1, the board "Phone: Return for Revision").
      var area = GraderWork.returnArea(cid, a, unit.st.id, _cardReturnIds(unit), { revisions: true });
      var holds = _holdsGrades(cid);
      var base = holds
        ? area
          ? _returnBarArea(cid, a, unit, last, area)
          : none
        : { state: '', act: _nextStudentBtn(last) };
      return area ? _revisionBarParts(cid, a, unit, area, base) : base;
    }

    // html-safe: fixed labels; the name and the date go through MC.esc
    function _returnBarArea(cid, a, unit, last, area) {
      var label = last ? 'Return and Finish' : 'Return and Next';
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
        state: still,
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

    function openRevisionSheet(cid, aid, sid) {
      var a = _assessmentById(cid, aid);
      var st = (getStudents(cid) || []).find(function (x) {
        return x.id === sid;
      });
      if (!a || !st || _revisionBusy || !_stillOn(cid, aid, sid)) return;
      _saveTyped(cid, sid);
      MC.presentSheet(MRevisionSheet.html(cid, a, st));
      MRevisionSheet.wire();
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

    // The cards' units as renderSwiper drew them: a save does not sort the class again.
    var _drawn = null;
    function _drawnUnits(cid, a) {
      return _drawn && _drawn.cid === cid && _drawn.aid === a.id ? _drawn.units : _swiperUnits(cid, a);
    }

    // The card on screen's parts.
    function _returnBarNow(cid, a) {
      var units = _drawnUnits(cid, a);
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
       changes. When the
       button under the focus goes or changes, the focus stays on the bar.
       `scrolled` says the cards moved under a finger or a slide: while
       Return and Next's own slide runs, the bar already shows the card it is
       going to and stays on it. */
    function _syncReturnBar(scrolled) {
      var cid = _swiperCid;
      var a = _assessmentById(cid, _swiperAid);
      if (!a) return;
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
      if (!a) return;
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
      card.querySelectorAll('.m-crit-own-input').forEach(function (el) {
        MCritOwn.save(cid, el);
      });
      card.querySelectorAll('.m-overall-comment').forEach(function (el) {
        _saveOverallComment(cid, el);
      });
    }

    /* Return and Next: the grade on screen is returned (a group's, to every
       member still graded with it, held seven seconds for Undo,
       grade-look.js) and the next card comes up. One tap: the card names who
       it is and shows the grade. On the last card, Return and Finish, and
       All Caught Up. */
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
      MGradeLook.hold(cid, a.id, unit, function (late) {
        Grader.returnGrades(cid, a.id, ids);
        clearProfCache();
        if (late) _syncReturnBar();
      });
      MC.haptic();
      _moveOn(cid, a, units);
    }

    /* Next Student: in a class that returns as it saves there is nothing to
       return, so the button only moves on. */
    function nextStudent() {
      var cid = _swiperCid;
      if (_returnSliding) return;
      var a = _assessmentById(cid, _swiperAid);
      var units = a ? _swiperUnits(cid, a) : [];
      if (!units[_currentIdx]) return;
      _saveTyped(cid, units[_currentIdx].st.id);
      _moveOn(cid, a, units);
    }

    // On to the next card, or the student's next piece; after the last, All Caught Up.
    function _moveOn(cid, a, units) {
      if (_student) {
        var at = _student.aids.indexOf(a.id);
        if (at >= 0 && at < _student.aids.length - 1) return showStudentPiece(cid, _student.aids[at + 1]);
        return _showCaughtUp(cid, a);
      }
      if (_currentIdx >= units.length - 1) return _showCaughtUp(cid, a);
      jumpToStudent(_currentIdx + 1);
      _returnSliding = setTimeout(function () {
        _returnSliding = null;
        _syncReturnBar();
      }, RETURN_SLIDE_MS);
    }

    /* All Caught Up: the last card is done. What was returned (or graded, in a
       class that returns nothing), what is not handed in, and the next piece
       with work waiting. Undo on the held return takes the grader back. */
    var _caughtUp = false;
    function _showCaughtUp(cid, a) {
      var screen = document.getElementById('m-screen-grade-swiper');
      if (!screen || _caughtUp) return _syncReturnBar();
      var students = getStudents(cid);
      var scores = getScores(cid);
      var holds = _holdsGrades(cid);
      var done = students.filter(function (st) {
        return holds
          ? GradeState.stateOf(cid, st.id, a.id) === GradeState.RETURNED
          : (scores[st.id] || []).some(function (s) {
              return s.assessmentId === a.id && isScoreEntered(a, s);
            });
      }).length;
      var next = getAssignedAssessments(cid)
        .slice()
        .sort(function (x, y) {
          return (y.date || '').localeCompare(x.date || '');
        })
        .find(function (b) {
          return b.id !== a.id && MGradePhotos.toGradeCount(cid, b) > 0;
        });
      _caughtUp = true;
      var tmp = document.createElement('div');
      // html-safe: MGradeLook.caughtUp escapes the titles; counts are numbers
      tmp.innerHTML = MGradeLook.caughtUp({
        done: done,
        verb: holds ? 'returned' : 'graded',
        notIn: MGradePhotos.notIn(cid, a).length,
        next: next ? { id: next.id, title: next.title } : null,
      });
      screen.appendChild(tmp.firstElementChild);
      var btn = screen.querySelector('.m-grade-done button');
      if (btn) btn.focus({ preventScroll: true });
    }

    // Undo takes the grader back from All Caught Up.
    function hideCaughtUp() {
      var el = document.getElementById('m-grade-done');
      if (el) el.remove();
      _caughtUp = false;
    }

    // All Caught Up's next piece: the grading screen in place, on the work waiting.
    function gradeNextPiece(aid) {
      var cid = _swiperCid;
      var screen = document.getElementById('m-screen-grade-swiper');
      if (!screen || !_assessmentById(cid, aid)) return;
      var tmp = document.createElement('div');
      // html-safe: renderSwiper escapes its text (see _renderStudentCard)
      tmp.innerHTML = renderSwiper(cid, aid, { only: 'tograde' });
      var next = tmp.firstElementChild;
      next.classList.remove('m-screen-hidden');
      if (screen.hasAttribute('data-restore'))
        next.setAttribute('data-restore', JSON.stringify({ kind: 'swiper', aid: aid, only: 'tograde' }));
      screen.parentNode.replaceChild(next, screen);
      MGradePhotos.releaseUnused();
      setupSwiper(cid, aid);
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

    /* A competency row's level and ±: its own entry, or on rubric work the
       level of the criteria that feed it. Levels 1-4 only: 'No Evidence'
       (stored as 0) is reached by tapping the chosen level off, and reads as
       no level chosen, as a fresh card does (every layer treats `score > 0`
       alike). */
    function _tagState(cid, sid, assessment, tid, stScores) {
      var rowState = _rubricRowState(cid, sid, assessment, tid);
      if (rowState)
        return { level: rowState.level ? roundLevel(rowState.level) : 0, mod: rowState.mod, mixed: !!rowState.mixed };
      var existing = (stScores || getScores(cid)[sid] || []).filter(function (s) {
        return s.assessmentId === assessment.id && s.tagId === tid;
      });
      if (!existing.length) return { level: 0, mod: 0, mixed: false };
      var last = existing[existing.length - 1];
      return {
        level: last.score ? roundLevel(last.score) : 0,
        mod: normalizeScoreMod(last.score, last.mod),
        mixed: false,
      };
    }

    /* Missing and Excused, as one track on a card with nothing handed in
       (the board "Add Work for a Student"); Late waits for ⋯, where a status
       is set on work that is in. */
    // html-safe: fixed labels; ids are ours
    function _statusTrackHtml(cid, st, assessment, status) {
      return (
        '<div class="m-status-row" role="group" aria-label="Status">' +
        [
          ['NS', 'Missing'],
          ['EXC', 'Excused'],
        ]
          .map(function (pair) {
            return (
              '<button type="button" class="m-status-pill' +
              (status === pair[0] ? ' m-status-active' : '') +
              '" data-action="m-grade-status" data-val="' +
              pair[0] +
              '" data-sid="' +
              st.id +
              '" data-aid="' +
              assessment.id +
              '"' +
              (canSetAssignmentStatus(cid, st.id, assessment.id, pair[0]) ? '' : ' disabled') +
              ' aria-pressed="' +
              (status === pair[0]) +
              '">' +
              pair[1] +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    /* A competency's row (work scored by competency, not by rubric
       criterion): its name over a track, with − and + beside the name once a
       level is chosen. */
    // html-safe: labels go through MC.esc; colours through cssColor; ids and levels are ours or numbers
    function _tagGroupHtml(cid, st, assessment, tid, tagLabel, tagColor, level, mod, mixed) {
      var rowIds = ' data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-tid="' + tid + '"';
      return (
        '<div class="m-score-group" data-level="' +
        (mixed ? 0 : level) +
        '"><div class="m-crit-head"><span class="m-crit-name"><span class="m-score-tag-dot" style="background:' +
        cssColor(tagColor) +
        '"></span>' +
        MC.esc(tagLabel) +
        '</span><div class="m-crit-tools">' +
        _fineTuneHtml(rowIds, mixed ? 0 : level, mod, tagLabel) +
        '</div></div>' +
        '<div class="m-score-btns" role="radiogroup" aria-label="Level for ' +
        MC.esc(tagLabel) +
        '">' +
        MC.levelButtonsHTML({
          order: levelOrderFor(cid),
          level: level,
          mod: mod,
          mixed: mixed,
          action: 'm-grade-score',
          attrs: rowIds,
        }) +
        '</div></div>'
      );
    }

    // The points control: − 17.5 / 24 +, and the percent under it.
    // html-safe: names go through MC.esc; ids and numbers are ours
    function _pointsHtml(cid, st, assessment, unit, tagLines, tid) {
      var ids = ' data-sid="' + st.id + '" data-aid="' + assessment.id + '" data-max="' + assessment.maxPoints + '"';
      var rawScore = getPointsScore(cid, st.id, assessment.id);
      return (
        '<div class="m-score-group m-pts-group" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '" data-tid="' +
        tid +
        '">' +
        tagLines +
        '<div class="m-pts-row"><button type="button" class="m-pts-step" data-action="m-grade-points-dec"' +
        ids +
        ' aria-label="Minus 1">\u2212</button>' +
        '<input class="m-pts-input" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="\u2014" aria-label="Points for ' +
        MC.esc(unit && unit.view ? unit.view.label : displayNameWithLast(st)) +
        ', out of ' +
        assessment.maxPoints +
        '" id="m-pts-' +
        st.id +
        '-' +
        assessment.id +
        '"' +
        ids +
        ' value="' +
        (rawScore != null ? formatPoints(rawScore) : '') +
        '"><span class="m-pts-of">/ ' +
        assessment.maxPoints +
        '</span><button type="button" class="m-pts-step" data-action="m-grade-points-inc"' +
        ids +
        ' aria-label="Plus 1">+</button></div>' +
        '<div class="m-pts-result"><span class="m-pts-pct" id="m-pts-pct-' +
        st.id +
        '-' +
        assessment.id +
        '">' +
        pointsPctHtml(rawScore, assessment.maxPoints, 0) +
        '</span>' +
        _factoredHtml(assessment, rawScore, 'm-pts-fac-' + st.id + '-' + assessment.id) +
        '</div></div>'
      );
    }

    // html-safe: names, labels and criterion text go through MC.esc; colours through cssColor; ids, levels and points are ours or numbers; _criterionGroupHtml, _completionBtnsHtml, _tagGroupHtml, _pointsHtml, _chipsHtml, MC.levelButtonsHTML and pointsPctHtml are checked.
    function _renderStudentCard(cid, st, assessment, allScores, allStatuses, unit) {
      var stScores = allScores[st.id] || [];
      var status = allStatuses[st.id + ':' + assessment.id] || null;
      // Points and Complete/Incomplete are one value per assessment, so they get
      // one control rather than one per competency.
      var isPoints = assessment.scoreMode === 'points';
      // A card with nothing in has Add Work, its own status track and Grade
      // From Paper (the board "Add Work for a Student").
      var notInCard = MGradePhotos.notInCard(cid, assessment, st, unit);
      var chips = _chipsHtml(cid, assessment, unit, allStatuses);

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
      // A rubric of the assessment's own is scored by criterion (Competencies | Rubric, under ⋯).
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
        function (tid) {
          var tag = getTagById(cid, tid);
          var sec = getSectionForTag(cid, tid);
          var key = tag ? null : scoreKeyInfo(cid, assessment, tid);
          var tagLabel = tag
            ? tag.label || tag.name || tag.shortName || tag.code || ''
            : key
              ? key.label
              : 'No longer in the learning map';
          var tagColor = sec ? sec.color : '#888';

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
            return;
          }
          var now = _tagState(cid, st.id, assessment, tid, stScores);
          tagGroups += _tagGroupHtml(cid, st, assessment, tid, tagLabel, tagColor, now.level, now.mod, now.mixed);
        },
      );
      if (ptsTid !== null) tagGroups += _pointsHtml(cid, st, assessment, unit, ptsTagLines, ptsTid);

      // The Overall Comment: the one feedback box on the work, as on the
      // desktop (score.comment; it prints on the rubric handout).
      var commentText = getScoreComment(cid, st.id, assessment.id);
      var commentId = 'm-overall-' + st.id + '-' + assessment.id;
      var commentRow =
        '<div class="m-overall">' +
        '<label class="m-overall-label" for="' +
        commentId +
        '">' +
        MC.esc(MGradeLook.commentLabel(cid, st, unit)) +
        '</label>' +
        '<textarea class="m-overall-comment" id="' +
        commentId +
        '" rows="2" data-sid="' +
        st.id +
        '" data-aid="' +
        assessment.id +
        '">' +
        MC.esc(commentText) +
        '</textarea></div>';

      // The paper, then the marks, each a card; chips ride on the first.
      var work = MGradePhotos.cardHtml(cid, assessment, st, unit, {
        status: notInCard ? _statusTrackHtml(cid, st, assessment, status) : '',
        chips: chips,
      });
      return (
        '<div class="m-swiper-card" data-sid="' +
        st.id +
        '">' +
        '<div class="m-grade-card-surface' +
        (status === 'NS' || status === 'EXC' ? ' m-card-status-disabled' : '') +
        '">' +
        MGradePhotos.pinHtml(cid, assessment, st, unit) +
        work +
        '<div class="m-grade-marks">' +
        (work ? '' : chips) +
        tagGroups +
        commentRow +
        '</div></div></div>'
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

    /* A Six-Point rubric (shared/rubric-scale.js): six scores and no ±, each
       stored as the level and ± it counts as, so these read and write the
       stored pair. Its checklist works as an Advanced Rubric's. */
    // The rubric when it has level columns of its own, else null.
    function _isSix(rubric) {
      return !!window.RubricScale && RubricScale.has(rubric) ? rubric : null;
    }
    function _sixOf(cid, aid) {
      return _isSix(_ownRubric(cid, _assessmentById(cid, aid)));
    }
    // A criterion's six-point score from its _critState, 0 for none.
    function _sixNow(rubric, state) {
      return state.level ? RubricScale.fromStored(rubric, state.level, state.mod) : 0;
    }
    // Write a six-point score (0 clears) under every key of the criterion.
    function _writeSix(cid, sid, found, key) {
      var s = key ? RubricScale.toStored(found.rubric, key) : null;
      _writeCriterion(cid, sid, found, s ? s.level : 0, s ? s.mod : 0);
    }
    // The six score buttons, number over word, in the class's order.
    // html-safe: score names are fixed words; ids are ours; scores are numbers
    function _sixBtnsHtml(cid, st, assessment, crit, current) {
      var rubric = _ownRubric(cid, assessment);
      return RubricScale.keys(rubric, levelOrderFor(cid))
        .map(function (k) {
          var on = current === k;
          var s = RubricScale.toStored(rubric, k);
          return (
            '<button class="m-score-btn m-level-btn m-six-btn' +
            (on ? ' m-score-active' : '') +
            '" data-action="m-grade-crit" data-score="' +
            k +
            '" data-tone="' +
            RubricScale.tone(rubric, k) +
            '" data-sid="' +
            st.id +
            '" data-aid="' +
            assessment.id +
            '" data-critid="' +
            crit.id +
            '" aria-pressed="' +
            on +
            '" aria-label="' +
            MC.esc(RubricScale.label(rubric, k) + ', counts as ' + scoreLevelText(s.level, s.mod)) +
            '"><span class="m-level-fig">' +
            k +
            '</span></button>'
          );
        })
        .join('');
    }
    function _paintSix(group, current, rubric) {
      group.setAttribute('data-level', current ? RubricScale.toStored(rubric, current).level : 0);
      group.querySelectorAll('.m-six-btn').forEach(function (btn) {
        var on = Number(btn.getAttribute('data-score')) === current;
        btn.classList.toggle('m-score-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var now = group.querySelector('.m-six-now');
      if (now) now.textContent = current ? RubricScale.label(rubric, current) : '';
    }

    function _findCriterion(cid, aid, critId) {
      var a = _assessmentById(cid, aid);
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

    function _checklistHtml(cid, sid, aid, crit, state) {
      var ticked = getRubricCheckIds(cid, sid, aid);
      var suggested = RubricChecks.suggestedLevel(crit, ticked);
      // On a Six-Point rubric the levels are its six scores, in their words.
      var six = _sixOf(cid, aid);
      var cur = six ? _sixNow(six, state) : state.level;
      var word = 'level';
      var name = function (lv) {
        return six ? RubricScale.label(six, lv) : PROF_LABELS[lv];
      };
      var head = suggested ? 'Suggested: ' + name(suggested) : 'No Level Suggested Yet';
      var hint = !suggested
        ? 'Tick what you saw. A ' + word + ' is suggested when all of its boxes are ticked.'
        : cur && cur !== suggested
          ? 'You picked ' + name(cur) + '. Ticks keep your choice until you clear the ' + word + '.'
          : // The level already matches the ticks: nothing to explain.
            '';
      var html =
        '<div class="m-checklist"><div class="m-checklist-head">' +
        MC.esc(head) +
        '</div>' +
        (hint ? '<div class="m-checklist-hint">' + MC.esc(hint) + '</div>' : '');
      (six ? RubricScale.keys(six, levelOrderFor(cid)) : levelOrderFor(cid)).forEach(function (lv) {
        var boxes = RubricChecks.checksAt(crit, lv);
        if (!boxes.length) return;
        html +=
          '<div class="m-checklist-level"><div class="m-checklist-level-name l' +
          (six ? RubricScale.tone(six, lv) : lv) +
          '">' +
          name(lv) +
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
            var now = !state.level
              ? 'Not scored'
              : _isSix(rubric)
                ? RubricScale.label(rubric, _sixNow(rubric, state))
                : scoreLevelText(state.level);
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

    /* The words behind a Standard rubric's chevron: what each level looks
       like for this criterion, in the order of the track. */
    // html-safe: titles and descriptors go through MC.esc; tones and levels are numbers
    function _levelWordsHtml(cid, rubric, crit) {
      var six = _isSix(rubric);
      var keys = six ? RubricScale.keys(six, levelOrderFor(cid)) : levelOrderFor(cid);
      var items = keys
        .map(function (k) {
          var text = String((crit.levels && crit.levels[k]) || '').trim();
          if (!text) return '';
          return (
            '<div class="m-level-words-item l' +
            (six ? RubricScale.tone(six, k) : k) +
            '"><div class="m-level-words-name">' +
            MC.esc(six ? RubricScale.label(six, k) : _levelName(k)) +
            '</div><div class="m-level-words-text">' +
            MC.esc(text) +
            '</div></div>'
          );
        })
        .join('');
      return items ? '<div class="m-level-words">' + items + '</div>' : '';
    }

    function _hasLevelWords(crit) {
      return Object.keys(crit.levels || {}).some(function (k) {
        return !!String(crit.levels[k] || '').trim();
      });
    }

    /* One criterion: its name (a button with a chevron when there is more
       behind it: an Advanced Rubric's checklist, a Standard rubric's level
       words), − and + and the comment beside it, then the track. */
    // html-safe: names and descriptors go through MC.esc; ids and levels are ours or numbers; _checklistHtml, _levelWordsHtml, MCritOwn.html and MC.levelButtonsHTML are checked
    function _criterionGroupHtml(cid, st, assessment, rubric, crit) {
      var state = _critState(cid, st.id, assessment.id, crit);
      // A Six-Point criterion: six scores, no ±, an Advanced checklist.
      var six = _isSix(rubric);
      var btns = six
        ? _sixBtnsHtml(cid, st, assessment, crit, _sixNow(six, state))
        : _critLevelBtnsHtml(cid, st, assessment, crit, state);
      var advanced = _isAdvanced(rubric) && RubricChecks.hasChecks(crit);
      var detail = advanced || _hasLevelWords(crit);
      var open = detail && !!_openChecks[st.id + ':' + assessment.id + ':' + crit.id];
      var name = MC.esc(crit.name || 'Criterion');
      var nameEl = '<span class="m-crit-name">' + name + '</span>';
      if (detail) {
        var count = advanced ? RubricChecks.tickedCount(crit, getRubricCheckIds(cid, st.id, assessment.id)) : null;
        nameEl =
          '<button type="button" class="m-crit-name m-crit-toggle" data-action="m-grade-checks" data-sid="' +
          st.id +
          '" data-aid="' +
          assessment.id +
          '" data-critid="' +
          crit.id +
          '" aria-expanded="' +
          open +
          '" aria-label="' +
          name +
          (advanced ? ', checklist, ' + count.ticked + ' ticked' : ', what each level looks like') +
          '"><span>' +
          name +
          '</span><svg class="m-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>';
      }
      // The board's "Suggested: Proficient" over the levels, from the ticks;
      // an open checklist says it in its own head.
      var suggested =
        advanced && !open ? RubricChecks.suggestedLevel(crit, getRubricCheckIds(cid, st.id, assessment.id)) : 0;
      var suggestedLine = suggested
        ? '<div class="m-crit-suggested l' +
          (six ? RubricScale.tone(six, suggested) : suggested) +
          '">' +
          MC.esc('Suggested: ' + (six ? RubricScale.label(six, suggested) : scoreLevelText(suggested))) +
          '</div>'
        : '';
      var sixNow = six ? _sixNow(six, state) : 0;
      return (
        '<div class="m-score-group m-crit-group" data-critid="' +
        crit.id +
        '" data-level="' +
        (six ? (sixNow ? RubricScale.toStored(six, sixNow).level : 0) : state.mixed ? 0 : state.level || 0) +
        '"><div class="m-crit-head">' +
        nameEl +
        '<div class="m-crit-tools">' +
        (six ? '' : _critFineTuneHtml(st, assessment, crit, state)) +
        _critCommentBtnHtml(cid, st.id, assessment.id, crit) +
        '</div></div>' +
        suggestedLine +
        '<div class="m-score-btns' +
        (six ? ' m-six-btns' : '') +
        '" role="radiogroup" aria-label="' +
        (six ? 'Score' : 'Level') +
        ' for ' +
        name +
        '">' +
        btns +
        '</div>' +
        (six ? '<div class="m-six-now">' + (sixNow ? MC.esc(RubricScale.label(six, sixNow)) : '') + '</div>' : '') +
        (open
          ? advanced
            ? _checklistHtml(cid, st.id, assessment.id, crit, state)
            : _levelWordsHtml(cid, rubric, crit)
          : '') +
        _critCommentHtml(cid, st.id, assessment.id, crit) +
        MCritOwn.html(cid, st.id, assessment, crit) +
        '</div>'
      );
    }

    /* The criterion's comment (rubric_score.comment), as the desktop's speech
       bubble: it prints under the criterion on the rubric handout. Hidden
       behind the Comment button until there is one, so a rubric with many
       criteria doesn't fill with empty boxes. One line that grows as the
       teacher types; it saves like the Overall Comment. Under an empty box
       that is open, the last comment the teacher wrote on this criterion
       waits as a suggestion (MGradeLook.suggestion); a tap fills it in. */
    function _critCommentHtml(cid, sid, aid, crit) {
      var text = getRubricCriterionComment(cid, sid, aid, crit);
      return (
        '<textarea class="m-crit-comment" rows="1" maxlength="500" placeholder="Comment" aria-label="Comment on ' +
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
        '</textarea>' +
        // Filled from what was last written when the box opens (openCritComment).
        '<button type="button" class="m-crit-suggest" data-action="m-grade-suggest" data-sid="' +
        sid +
        '" data-aid="' +
        aid +
        '" data-critid="' +
        crit.id +
        '" hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5"/></svg><span></span></button>'
      );
    }

    /* The criterion's Comment button (the board): a round icon beside its
       name. Filled once there is a comment, which then reads as a note under
       the levels. */
    // html-safe: the name goes through MC.esc; sid, aid and critId are ids; the rest is fixed markup.
    function _critCommentBtnHtml(cid, sid, aid, crit) {
      var has = !!getRubricCriterionComment(cid, sid, aid, crit) || MCritOwn.lines(cid, sid, aid, crit).length > 0;
      var name = crit.name || 'criterion';
      return (
        '<button type="button" class="m-crit-comment-btn' +
        (has ? ' is-on' : '') +
        '" data-action="m-grade-crit-comment" data-sid="' +
        sid +
        '" data-aid="' +
        aid +
        '" data-critid="' +
        crit.id +
        '" aria-label="' +
        MC.esc((has ? 'Edit the comment on ' : 'Comment on ') + name) +
        '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg></button>'
      );
    }

    // Comment tapped: show the criterion's box and put the cursor in it.
    function openCritComment(btn) {
      var group = btn.closest('.m-crit-group');
      var box = group && group.querySelector('.m-crit-comment');
      if (!box) return;
      box.hidden = false;
      var own = group.querySelector('.m-crit-own-wrap');
      if (own) own.hidden = false;
      // The last comment written on this criterion waits under an empty box.
      var suggest = group.querySelector('.m-crit-suggest');
      if (suggest) {
        var last = MGradeLook.suggestion(_swiperCid, _swiperAid, suggest.dataset.critid);
        suggest.querySelector('span').textContent = last;
        suggest.hidden = !!box.value || !last;
      }
      box.focus();
    }

    // The suggestion tapped: it becomes this student's comment.
    function useSuggestion(btn) {
      var group = btn.closest('.m-crit-group');
      var box = group && group.querySelector('.m-crit-comment');
      if (!box) return;
      box.hidden = false;
      box.value = btn.querySelector('span').textContent.trim();
      btn.hidden = true;
      _fitCritComment(box);
      _saveCritComment(_swiperCid, box);
      box.focus();
    }

    // Left empty: back behind its button. On a group's card it stays while
    // the names under it show: hiding it would move them as one is tapped,
    // and the tap would land on what moved into its place.
    function _closeEmptyCritComment(el) {
      if (el.value.trim()) return;
      var group = el.closest && el.closest('.m-crit-group');
      var own = group && group.querySelector('.m-crit-own-wrap');
      if (own && !own.hidden) return;
      // A tap on the suggestion is not leaving: it ends the box's focus first.
      var suggest = group && group.querySelector('.m-crit-suggest');
      if (suggest && !suggest.hidden) return;
      el.hidden = true;
    }

    function _fitCritComment(el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    function _fitCritComments(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('.m-crit-comment, .m-crit-own-input').forEach(function (el) {
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
      if (text) MGradeLook.rememberComment(cid, el.dataset.aid, el.dataset.critid, text);
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
      var assessment = _assessmentById(cid, aid);
      var st = getStudents(cid).find(function (s) {
        return s.id === sid;
      });
      if (!card || !assessment || !st) return;
      var unit = _drawnUnits(cid, assessment).find(function (u) {
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

    /* A card's levels after a level or ± on it, without drawing the card
       again (as _syncModBtns does for one row): each criterion's buttons, ±
       and open checklist, and each competency row on rubric work, whose
       level comes from its criteria. The button tapped keeps the focus. */
    function _paintCard(cid, sid, a) {
      var card = document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
      if (card && card.querySelector('.m-paper-crits')) return _refreshCard(cid, sid, a.id);
      var crits = (card && (_ownRubric(cid, a) || {}).criteria) || [];
      crits.forEach(function (crit) {
        var group = card.querySelector('.m-crit-group[data-critid="' + crit.id + '"]');
        if (!group) return;
        var state = _critState(cid, sid, a.id, crit);
        var own = _isSix(_ownRubric(cid, a));
        if (own) _paintSix(group, _sixNow(own, state), own);
        else _paintRow(group, state.level || 0, state);
        var list = group.querySelector('.m-checklist');
        // html-safe: _checklistHtml escapes its labels; ids are ours
        if (list) list.outerHTML = _checklistHtml(cid, sid, a.id, crit, state);
      });
      (card ? card.querySelectorAll('.m-score-mods[data-tid]') : []).forEach(function (box) {
        var state = _rubricRowState(cid, sid, a, box.getAttribute('data-tid'));
        if (state) _paintRow(box.closest('.m-score-group'), state.level ? roundLevel(state.level) : 0, state);
      });
    }

    function _paintRow(row, level, state) {
      // − and + show once a level is chosen, in that level's colour.
      row.setAttribute('data-level', state.mixed ? 0 : level);
      MC.paintLevelButtons(row.querySelectorAll('.m-score-btns .m-score-btn'), level, state.mod, state.mixed);
      var box = row.querySelector('.m-score-mods');
      if (!box) return;
      var tune = state.mixed ? 0 : level;
      var held = box.contains(document.activeElement) ? document.activeElement.getAttribute('data-mod') : null;
      box.setAttribute('aria-label', MC.fineTuneLabel(tune, box.getAttribute('data-name')));
      // html-safe: MC.fineTuneButtonsHTML is fixed markup
      box.innerHTML = MC.fineTuneButtonsHTML(tune, state.mod);
      var again = held && box.querySelector('[data-mod="' + held + '"]');
      if (again) again.focus({ preventScroll: true });
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
      var a = getAssignedAssessments(cid).find(function (x) {
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
      _updateGraded(cid, aid, sid);
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
              _updateGraded(cid, aid, sid);
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
      _paintCard(cid, sid, assessment);
      _updateGraded(cid, assessment.id, sid);
      _syncReturnBar();
    }

    // Tapping the active + or − again clears it.
    function _setRubricRowMod(cid, sid, assessment, tid, state, mod) {
      if (!(state.level > 0) || state.mixed) return;
      var next = state.mod === mod ? 0 : mod;
      if (normalizeScoreMod(state.level, next) !== next) return;
      _writeKeys(cid, sid, assessment, rubricRowScoreKeys(cid, assessment, tid), state.level, next, true);
      MC.haptic();
      _paintCard(cid, sid, assessment);
      _syncReturnBar();
    }

    /* A level tapped on a criterion; tapping the active one clears it. */
    function setCriterionScore(cid, sid, aid, critId, level) {
      var found = _findCriterion(cid, aid, critId);
      if (!found) return;
      var state = _critState(cid, sid, aid, found.crit);
      // On a Six-Point rubric `level` is the score, 1 to 6.
      if (_isSix(found.rubric)) {
        if (!RubricScale.isKey(found.rubric, level)) return;
        _writeSix(cid, sid, found, _sixNow(found.rubric, state) === level ? 0 : level);
        MC.haptic();
        _paintCard(cid, sid, found.assessment);
        _updateGraded(cid, aid, sid);
        _syncReturnBar();
        return;
      }
      var cleared = state.level === level && !state.mixed;
      _writeCriterion(cid, sid, found, cleared ? 0 : level, 0);
      MC.haptic();
      _paintCard(cid, sid, found.assessment);
      _updateGraded(cid, aid, sid);
      _syncReturnBar();
    }

    // Tapping the active + or − again clears it.
    function setCriterionMod(cid, sid, aid, critId, mod) {
      var found = _findCriterion(cid, aid, critId);
      if (!found || _isSix(found.rubric)) return;
      var state = _critState(cid, sid, aid, found.crit);
      if (!(state.level > 0) || state.mixed) return;
      var next = state.mod === mod ? 0 : mod;
      if (normalizeScoreMod(state.level, next) !== next) return;
      _writeCriterion(cid, sid, found, state.level, next, true);
      MC.haptic();
      _paintCard(cid, sid, found.assessment);
      _syncReturnBar();
    }

    function setGradeView(cid, aid, view) {
      _rubricView[aid] = view !== 'tags';
      var assessment = getAssignedAssessments(cid).find(function (a) {
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
      if (_isSix(found.rubric)) {
        var nowSix = _sixNow(found.rubric, state);
        var nextSix = RubricChecks.levelAfterTick(found.crit, nowSix, before, after);
        if (nextSix !== nowSix) _writeSix(cid, sid, found, nextSix);
      } else {
        var next = RubricChecks.levelAfterTick(found.crit, state.level, before, after);
        if (next !== state.level) _writeCriterion(cid, sid, found, next, 0);
      }
      MC.haptic();
      _refreshCard(cid, sid, aid);
      _updateGraded(cid, aid, sid);
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
      box.closest('.m-score-group').setAttribute('data-level', level);
      box.setAttribute('aria-label', MC.fineTuneLabel(level, box.getAttribute('data-name')));
      // html-safe: MC.fineTuneButtonsHTML is fixed markup
      box.innerHTML = MC.fineTuneButtonsHTML(level, mod);
    }

    // Tapping the active + or − again clears it.
    function setScoreMod(cid, sid, aid, tid, mod) {
      var rowAssessment = _assessmentById(cid, aid);
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
      var rowAssessment = _assessmentById(cid, aid);
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
      _updateGraded(cid, aid, sid);
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

      // The card draws again: its chip, and the levels dimmed (or cleared, as
      // the desktop's rule does on Missing). Late does not disable grading.
      _refreshCard(cid, sid, aid);
      if (newStatus === 'NS' && clearsScores) _updateGraded(cid, aid);
      // Group work: a member's status can change whose grade the card shows.
      var a = getAssignedAssessments(cid).find(function (x) {
        return x.id === aid;
      });
      if (groupGradingUnits(cid, a, [])) _redrawSwiper(cid, aid);
      _syncReturnBar();
      // Undo is the same tap again: it sets back the status that was, or takes this one off.
      MGradeLook.statusUndo(cid, sid, aid, current, newStatus, () => setStatus(cid, sid, aid, current || newStatus));
    }

    /* The entries an undo puts back. Missing or Excused work takes no score
       (isScoreLocked), so none with a level or points goes back under it. */
    function _undoEntries(entry, prev) {
      if (!isScoreLocked(entry.cid, entry.sid, entry.aid)) return prev;
      var a = getAssignedAssessments(entry.cid).find(function (x) {
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
      _updateGraded(entry.cid, entry.aid, entry.sid);
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
      _updateGraded(entry.cid, entry.aid, entry.sid);
      MC.showToast('Score reverted');
    }

    /* ── Swiper scroll tracking ─────────────────────────────────── */
    function setupSwiper(cid, aid) {
      var swiper = document.getElementById('m-swiper');
      if (!swiper) return;
      // A bank competency's wording, ready for the level sheet.
      var assess = (getAssignedAssessments(cid) || []).find(function (a) {
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
        if (e.target.classList.contains('m-crit-own-input')) {
          MCritOwn.save(cid, e.target);
          return MCritOwn.closeEmpty(e.target);
        }
        if (!e.target.classList.contains('m-pts-input')) return;
        selectOnUp = null;
        commitPointsInput(cid, e.target);
      });
      // The Overall Comment saves as the teacher types and when they leave it.
      swiper.addEventListener('input', function (e) {
        if (e.target.classList.contains('m-crit-own-input')) return MCritOwn.input(cid, e.target);
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
            _noteScroll(swiper);
          });
        },
        { passive: true },
      );
    }

    // The card the cards have scrolled to becomes the one on screen.
    function _noteScroll(swiper) {
      var idx = Math.round(swiper.scrollLeft / swiper.clientWidth);
      if (_jumpTo !== null) {
        if (idx === _jumpTo) _jumpTo = null;
        return;
      }
      var total = document.querySelectorAll('#m-grade-progress .m-prog-seg').length;
      if (idx !== _currentIdx && idx >= 0 && idx < total) {
        _currentIdx = idx;
        _updateCurrentSeg(idx);
        _noteCard(idx);
        _syncReturnBar(true);
      }
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
        var total = document.querySelectorAll('#m-grade-progress .m-prog-seg').length;
        var next = _currentIdx + (e.key === 'ArrowRight' ? 1 : -1);
        if (next < 0 || next >= total) return;
        e.preventDefault();
        jumpToStudent(next);
      });
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
    // The Line for One Student (teacher-mobile/crit-own.js) borrows these.
    MCritOwn.configure({
      findCriterion: _findCriterion,
      assessmentById: _assessmentById,
      syncReturnBar: _syncReturnBar,
      fit: _fitCritComment,
      timers: _commentTimers,
    });
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
      clearTimeout(_jumpTimer);
      _jumpTo = instant ? null : idx;
      if (!instant)
        _jumpTimer = setTimeout(function () {
          _jumpTo = null;
          _noteScroll(swiper);
        }, 1000);
      swiper.scrollTo({ left: idx * swiper.clientWidth, behavior: instant ? 'auto' : 'smooth' });
      _currentIdx = idx;
      _updateCurrentSeg(idx);
      _noteCard(idx);
      _syncReturnBar();
    }

    function _updateCurrentSeg(idx) {
      document.querySelectorAll('#m-grade-progress .m-prog-seg').forEach(function (seg, i) {
        seg.classList.toggle('is-current', i === idx);
      });
    }

    function _noteCard(idx) {
      MGradeLook.show(idx);
    }

    // `sid`: only that student's segment of the progress line, after a score of theirs changed.
    function _updateGraded(cid, aid, sid) {
      var allScores = getScores(cid);
      var assessment = _assessmentById(cid, aid);
      var segs = document.querySelectorAll('#m-grade-progress .m-prog-seg' + (sid ? '[data-sid="' + sid + '"]' : ''));
      segs.forEach(function (seg) {
        var stScores = allScores[seg.dataset.sid] || [];
        seg.classList.toggle(
          'is-graded',
          stScores.some(function (s) {
            return s.assessmentId === aid && isScoreEntered(assessment, s);
          }),
        );
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
      _updateGraded(cid, aid, sid);
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
      _updateGraded(cid, aid, sid);
      _syncReturnBar();
    }

    /* The % beside the points field, as the desktop shows it: "bonus" under
       it above the maximum, nothing with no score. */
    function _updatePointsPct(sid, aid, value, max) {
      var el = document.getElementById('m-pts-pct-' + sid + '-' + aid);
      if (el) el.innerHTML = pointsPctHtml(value, max, 0);
      var fac = document.getElementById('m-pts-fac-' + sid + '-' + aid);
      if (fac && fac.dataset)
        fac.textContent = _factoredText({ scoreMode: 'points', weight: fac.dataset.factor }, value, max);
    }

    /* Under the %, the score times its Factor, as the desktop grader shows it: "= 20 / 24"
       for 5 / 6 at 4× (constants.js's factoredPoints). Read-only; points work not at 1× only. */
    function _factoredText(a, value, max) {
      var fp = factoredPoints(a, value, max);
      return fp ? '= ' + formatPoints(fp.points) + ' / ' + formatPoints(fp.outOf) : '';
    }
    // html-safe: the id is ours, the factor a number and the text esc'd
    function _factoredHtml(a, value, id) {
      if (!factoredPoints(a, 0)) return '';
      var attrs = ' id="' + id + '" data-factor="' + MC.esc(String(a.weight)) + '"';
      return '<span class="m-pts-factored"' + attrs + '>' + MC.esc(_factoredText(a, value)) + '</span>';
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
      _updateGraded(cid, aid, sid);
      _syncReturnBar();
    }

    var _swiperCid = null;

    /* What Full Screen scores while the paper is read (grade-reader.js): the
       card's marks as a list, one for each criterion (or competency), with
       the buttons of the track. Points and Complete or Incomplete have none:
       the paper alone is shown. */
    function readerModel(cid, sid, aid) {
      var a = _assessmentById(cid, aid);
      if (!a) return null;
      var rubric = _rubricViewOn(cid, a) ? _ownRubric(cid, a) : null;
      var six = rubric ? _isSix(rubric) : null;
      var keys = six ? RubricScale.keys(six, levelOrderFor(cid)) : levelOrderFor(cid);
      var items = [];
      if (rubric) {
        items = (rubric.criteria || []).map(function (crit) {
          var st = _critState(cid, sid, aid, crit);
          var value = six ? _sixNow(six, st) : st.level ? roundLevel(st.level) : 0;
          return {
            kind: 'crit',
            id: crit.id,
            name: crit.name || 'Criterion',
            value: value,
            mod: six ? 0 : st.mod,
            level: st.level ? roundLevel(st.level) : 0,
          };
        });
      } else if (!isPointsScored(a) && !isCompletionScored(a)) {
        items = rubricCompetencyRowKeys(cid, a).map(function (tid) {
          var tag = getTagById(cid, tid);
          var key = tag ? null : scoreKeyInfo(cid, a, tid);
          var now = _tagState(cid, sid, a, tid);
          return {
            kind: 'tag',
            id: tid,
            name: tag
              ? tag.label || tag.name || tag.shortName || tag.code || ''
              : key
                ? key.label
                : 'No longer in the learning map',
            value: now.level,
            mod: now.mixed ? 0 : now.mod,
            level: now.level,
          };
        });
      }
      var unit = _drawnUnits(cid, a).find(function (u) {
        return u.st.id === sid;
      });
      return {
        name: unit ? MGradeLook.unitName(cid, unit) : '',
        items: items,
        buttons: keys.map(function (k) {
          return {
            value: k,
            code: six ? String(k) : levelCode(k),
            tone: six ? RubricScale.tone(six, k) : k,
            six: !!six,
          };
        }),
        // The bar's buttons for the card on screen (For Revision, Return and Next).
        act: function () {
          var units = _drawnUnits(cid, a);
          return _returnBarParts(cid, a, units[_currentIdx], _lastCard(units, _currentIdx)).act;
        },
      };
    }

    // A tap on Full Screen's track or its − and +: the card's own writes.
    function readerScore(cid, sid, aid, item, value) {
      if (item.kind === 'crit') setCriterionScore(cid, sid, aid, item.id, value);
      else setScore(cid, sid, aid, item.id, value);
    }
    function readerMod(cid, sid, aid, item, mod) {
      if (item.kind === 'crit') setCriterionMod(cid, sid, aid, item.id, mod);
      else setScoreMod(cid, sid, aid, item.id, mod);
    }

    /* What ⋯ draws its sheet from (grade-look.js): the card on screen's
       piece and unit, and how the piece is scored. Null when no card is up. */
    function moreContext() {
      var cid = _swiperCid;
      var a = _assessmentById(cid, _swiperAid);
      var unit = a ? _drawnUnits(cid, a)[_currentIdx] : null;
      if (!a || !unit || !document.getElementById('m-screen-grade-swiper')) return null;
      return {
        cid: cid,
        a: a,
        unit: unit,
        // 'rubric' or 'tags' on work with a rubric of its own, else null.
        scoredBy: _ownRubric(cid, a) ? (_rubricViewOn(cid, a) ? 'rubric' : 'tags') : null,
        canUnsubmit: MGradePhotos.canUnsubmit(cid, a, unit.st, unit),
      };
    }

    return {
      readerModel: readerModel,
      readerScore: readerScore,
      readerMod: readerMod,
      moreContext: moreContext,
      nextStudent: nextStudent,
      hideCaughtUp: hideCaughtUp,
      gradeNextPiece: gradeNextPiece,
      useSuggestion: useSuggestion,
      renderSwiper: renderSwiper,
      setScore: setScore,
      setScoreMod: setScoreMod,
      setCriterionScore: setCriterionScore,
      setCriterionMod: setCriterionMod,
      setGradeView: setGradeView,
      toggleChecklist: toggleChecklist,
      openCritComment: openCritComment,
      openCritOwn: MCritOwn.open,
      tickCheck: tickCheck,
      setStatus: setStatus,
      adjustPointsScore: adjustPointsScore,
      setCompletion: setCompletion,
      undoLastScore: undoLastScore,
      setupSwiper: setupSwiper,
      jumpToStudent: jumpToStudent,
      studentCardIndex: studentCardIndex,
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
    openCritOwn: Speed.openCritOwn,
    tickCheck: Speed.tickCheck,
    setStatus: Speed.setStatus,
    adjustPointsScore: Speed.adjustPointsScore,
    setCompletion: Speed.setCompletion,
    undoLastScore: Speed.undoLastScore,
    setupSwiper: Speed.setupSwiper,
    jumpToStudent: Speed.jumpToStudent,
    studentCardIndex: Speed.studentCardIndex,
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
    nextStudent: Speed.nextStudent,
    hideCaughtUp: Speed.hideCaughtUp,
    gradeNextPiece: Speed.gradeNextPiece,
    useSuggestion: Speed.useSuggestion,
    moreContext: Speed.moreContext,
    readerModel: Speed.readerModel,
    readerScore: Speed.readerScore,
    readerMod: Speed.readerMod,
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
