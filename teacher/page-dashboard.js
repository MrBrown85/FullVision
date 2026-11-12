/* ── page-dashboard.js — Dashboard page module ───────────── */
window.PageDashboard = (function () {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  var activeCourse;
  var showFlaggedOnly = false;
  var sortMode = 'last-asc';
  var searchQuery = '';
  var _dashSearchTimer = null;

  /* The Observations card (dash-observations.js): its tab is remembered on
     this device; a highlight is not. */
  var OBS_TAB_KEY = 'fv-dash-obs-tab';
  var obsTab = 'week';
  var obsHighlight = null;
  var _obsWidth = 0;
  var _obsNavKey = null;
  var _resizeTimer = null;
  var _popFor = null;

  /* Class insights (dash-insights.js): Cards or Grid and the Who Needs Help
     rule follow the teacher to any device (getDashboardPrefs); an open
     segment list does not. The rule has no editor since the Needs
     Attention card went (plan F.8): it stays at its saved value or the
     default. */
  var studentView = 'cards';
  var helpRule = null;
  var mixPop = null; // { key, level } of the open proficiency segment
  // The page's competency filter (a Curricular Competencies row). Not
  // remembered. The name is the old Needs Attention one; other code and
  // the data-action use it.
  var naComp = null;
  // The column whose chips are lit on every student card while the pointer
  // is on its Curricular Competencies row (plan F.7a).
  var _litKey = null;

  /* The cards' view menus (DashOverview.viewMenuHtml): the one open, by its
     id, and each menu's setter, which records the pick before the page
     re-renders. Core Competencies registers 'core'; Curricular Competencies
     registers 'comp'. */
  var openMenu = null;
  var _viewSetters = {};
  // Core Competencies: Self-Assessment or Evidence, per class on this device.
  var CORE_VIEW_KEY = 'fv-dash-core-view:';
  _viewSetters.core = function (key) {
    _writePref(CORE_VIEW_KEY + activeCourse, key === 'evidence' ? 'evidence' : 'self');
  };
  // Curricular Competencies: Class Average, Level Mix, Needs Support or
  // Change, per class on this device (DashOverview.compView has the
  // default). A new view's rows fade in.
  var COMP_VIEW_KEY = 'fv-dash-comp-view:';
  var _compFade = false;
  _viewSetters.comp = function (key) {
    var view = DashOverview.compView(activeCourse, key);
    if (view !== DashOverview.compView(activeCourse, _readPref(COMP_VIEW_KEY + activeCourse))) _compFade = true;
    _writePref(COMP_VIEW_KEY + activeCourse, view);
    mixPop = null;
  };
  // The next render slides the student cards to their new places (the
  // filter was set or cleared, or the sort changed).
  var _slideCards = false;
  // Classes whose questionnaire answers have been asked for (StudentVoice),
  // so the card asks once and re-renders once when they arrive.
  var _voiceAsked = {};

  function _readPref(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function _writePref(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      /* private window or blocked storage: the choice lasts this visit */
    }
  }

  /* ── Class Manager delegation (now in dash-class-manager.js) ── */
  var CM = DashClassManager;
  var Overview = DashOverview;
  var StudentCards = DashStudentCards;
  function openClassManager(tab, cid) {
    CM.classManagerOpen = true;
    CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse });
    CM.openClassManager(tab, cid);
  }
  function renderClassManager() {
    CM.renderClassManager();
  }

  /* ── Search ─────────────────────────────────────────────── */
  function dashSearchInput(el) {
    var val = el.value.toLowerCase();
    var pos = el.selectionStart;
    clearTimeout(_dashSearchTimer);
    _dashSearchTimer = setTimeout(function () {
      searchQuery = val;
      render();
      requestAnimationFrame(function () {
        var inp = document.querySelector('.dash-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(pos, pos);
        }
      });
    }, 150);
  }

  /* ── Sorting by a grid column ───────────────────────────── */
  /* A competency (col:KEY:dir) by its proficiency, or Last Observed
     (obs:dir) by days since. Ties and unscored students keep last-name
     order; unscored students and the never-observed go last, except that
     Longest Ago First puts the never-observed first. */
  function _gridSorted(cid, students, mode) {
    var sort = DashInsights.gridSortOf(mode || sortMode);
    var byLast = sortStudents(students, 'lastName');
    if (!sort) return byLast;
    var sign = sort.dir === 'asc' ? 1 : -1;
    var val = {};
    if (sort.key === 'obs') {
      var today = getTodayStr();
      var term = getActiveTerm(cid);
      byLast.forEach(function (st) {
        var d = DashStudentCards.obsSummary(getStudentQuickObs(cid, st.id), today, term).daysSince;
        val[st.id] = d == null ? Infinity : d;
      });
    } else {
      var col = _gridColumn(cid, sort.key.slice(4));
      if (!col) return byLast;
      byLast.forEach(function (st) {
        var v = col.which.groupId
          ? getGroupProficiency(cid, st.id, col.which.groupId)
          : getSectionProficiency(cid, st.id, col.which.sectionId);
        val[st.id] = v > 0 ? v : null;
      });
    }
    return byLast.sort(function (a, b) {
      var va = val[a.id];
      var vb = val[b.id];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sign;
    });
  }
  function _gridColumn(cid, key) {
    return (
      DashInsights.columns(cid).filter(function (c) {
        return c.key === key;
      })[0] || null
    );
  }
  // The sort menu's line for a column sort the menu has no option for.
  function _gridSortOption(cid) {
    var sort = DashInsights.gridSortOf(sortMode);
    if (!sort || (sort.key !== 'obs' && sort.key.indexOf('col:') !== 0)) return null;
    if (sort.key === 'obs')
      return {
        value: sortMode,
        label: sort.dir === 'desc' ? 'Last Observed, Longest Ago First' : 'Last Observed, Most Recent First',
      };
    var col = _gridColumn(cid, sort.key.slice(4));
    if (!col) return null;
    return { value: sortMode, label: col.label + (sort.dir === 'desc' ? ' High\u2192Low' : ' Low\u2192High') };
  }

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    obsHighlight = null;
    mixPop = null;
    naComp = null;
    _litKey = null;
    _obsNavKey = null;
    // Reset class manager state for new course
    CM.configure({ activeCourse: cid, onRender: render, onCourseChange: switchCourse });
    CM.resetState();
    if (!(await switchActiveCourse(cid))) return;
    render();
  }

  /* The student list beside the dashboard. It is rebuilt only when the
     class or its roster changed, so its search and scroll survive the
     dashboard's own re-renders. Class Settings hides it (dashboard.css). */
  function _syncSidebar() {
    var mount = document.getElementById('sidebar-mount');
    if (!mount) return;
    if (!activeCourse || !COURSES[activeCourse]) {
      mount.style.display = 'none';
      return;
    }
    mount.style.display = '';
    // The list's own picker already shows the new class when it made the
    // switch, so the class the list was built for is kept on the mount.
    var rows = document.querySelectorAll('#gb-roster-list .student-row').length;
    if (mount.dataset.cid === activeCourse && rows === getStudents(activeCourse).length) return;
    mount.innerHTML = renderSidebar(activeCourse, null);
    mount.dataset.cid = activeCourse;
  }

  /* ── Main render ────────────────────────────────────────── */
  function render() {
    // Every grade on this page, Class Settings' included, is the year so
    // far: a report's term from the Reports page never carries over (Colin,
    // 2026-11-03).
    if (activeCourse && typeof setActiveTerm === 'function') setActiveTerm(activeCourse, null);
    if (CM.classManagerOpen) {
      renderClassManager();
      return;
    }
    // If active course is archived, switch to first non-archived
    if (activeCourse && isCourseArchived(activeCourse)) {
      var nonArchived = Object.keys(COURSES).find(function (c) {
        return !isCourseArchived(c);
      });
      if (nonArchived) {
        activeCourse = nonArchived;
        setActiveCourse(nonArchived);
      }
    }
    _syncSidebar();
    var cid = activeCourse;
    if (typeof setActiveTerm === 'function') setActiveTerm(cid, null);
    var sections = getSections(cid);
    var students = getStudents(cid);
    var flags = getFlags(cid);
    var assessments = getAssessments(cid);
    var allScores = getScores(cid);

    // Sort
    switch (sortMode) {
      case 'last-asc':
        students = sortStudents(students, 'lastName');
        break;
      case 'last-desc':
        students = sortStudents(students, 'lastName').reverse();
        break;
      case 'first-asc':
        students = sortStudents(students, 'firstName');
        break;
      case 'first-desc':
        students = sortStudents(students, 'firstName').reverse();
        break;
      case 'overall-desc':
      case 'overall-asc':
        // By the grade Overall shows (the course % in a Letter class);
        // students with none go last either way.
        var dir = sortMode === 'overall-asc' ? 1 : -1;
        students = students.slice().sort(function (a, b) {
          var pa = studentOverallSortValue(cid, a.id);
          var pb = studentOverallSortValue(cid, b.id);
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return (pa - pb) * dir;
        });
        break;
      case 'flagged':
        students = students.slice().sort(function (a, b) {
          var fa = flags[a.id] ? 0 : 1;
          var fb = flags[b.id] ? 0 : 1;
          if (fa !== fb) return fa - fb;
          return (
            (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || '')
          );
        });
        break;
      default:
        students = _gridSorted(cid, students);
    }

    // The competency filter (naComp, from Curricular Competencies): weakest
    // first on it. The teacher's sort stays as it was
    // for when the filter is cleared; choosing a sort (the sort menu or a
    // grid heading) clears the filter, so the sort always wins and is
    // never silently ignored.
    var focusCol = naComp ? _gridColumn(cid, naComp) : null;
    if (naComp && !focusCol) naComp = null;
    var shownSort = focusCol ? 'col:' + focusCol.key + ':asc' : sortMode;
    if (focusCol) students = _gridSorted(cid, students, shownSort);

    // Search filter
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      students = students.filter(function (s) {
        return (
          displayName(s).toLowerCase().includes(q) ||
          (s.firstName || '').toLowerCase().includes(q) ||
          (s.lastName || '').toLowerCase().includes(q) ||
          (s.studentNumber || '').toLowerCase().includes(q)
        );
      });
    }

    if (showFlaggedOnly) {
      students = students.filter(function (s) {
        return flags[s.id];
      });
    }

    var flagCount = Object.values(flags).filter(Boolean).length;
    var allStudents = getStudents(cid);

    /* -- Compute class-level data -- */
    var overallVals = allStudents
      .map(function (s) {
        return getOverallProficiency(cid, s.id);
      })
      .filter(function (v) {
        return v > 0;
      });
    var classAvg =
      overallVals.length > 0
        ? overallVals.reduce(function (a, b) {
            return a + b;
          }, 0) / overallVals.length
        : 0;
    var classR = roundLevel(classAvg);

    var ccCounts = {};
    var ccAssessments = {};
    assessments.forEach(function (a) {
      (a.coreCompetencyIds || []).forEach(function (ccId) {
        ccCounts[ccId] = (ccCounts[ccId] || 0) + 1;
        if (!ccAssessments[ccId]) ccAssessments[ccId] = [];
        ccAssessments[ccId].push(a.title || 'Untitled');
      });
    });

    // Observations tagged with each Core Competency (an observation's dims
    // hold 'cc:<id>').
    var ccObs = {};
    allStudents.forEach(function (s) {
      var obs = getStudentQuickObs(cid, s.id);
      obs.forEach(function (o) {
        (o.dims || []).forEach(function (d) {
          if (typeof d === 'string' && d.indexOf('cc:') === 0) ccObs[d.slice(3)] = (ccObs[d.slice(3)] || 0) + 1;
        });
      });
    });

    // Core Competency self-assessments this term (shared/core-self.js). The
    // students' own come with the questionnaire answers: ask for them once
    // and draw again when they arrive.
    if (typeof StudentVoice !== 'undefined' && StudentVoice.load && !StudentVoice.loaded(cid) && !_voiceAsked[cid]) {
      _voiceAsked[cid] = true;
      StudentVoice.load(cid).then(
        function () {
          if (activeCourse === cid && document.querySelector('.dash-core-card')) render();
        },
        function () {
          /* no answers: the teacher-entered steps still show */
        },
      );
    }
    var coreSelf = coreSelfRatings(
      cid,
      allStudents.map(function (s) {
        return s.id;
      }),
    );

    /* -- Toolbar (rendered to separate mount) -- */
    // html-safe: DashOverview.renderDashToolbar escapes class names; the rest is a count.
    document.getElementById('page-toolbar-mount').innerHTML = Overview.renderDashToolbar({
      activeCourse: activeCourse,
      students: students,
    });

    /* -- Overview Panel -- */
    // The photo reminder (S8-F1) first: only in the week before the class's
    // photos are deleted.
    var html = Overview.photoReminderHtml(cid);
    html += Overview.renderOverviewPanel({
      cid: cid,
      sections: sections,
      allStudents: allStudents,
      assessments: assessments,
      classAvg: classAvg,
      classR: classR,
      ccCounts: ccCounts,
      ccAssessments: ccAssessments,
      ccObs: ccObs,
      coreSelf: coreSelf,
      coreView: _readPref(CORE_VIEW_KEY + cid) === 'evidence' ? 'evidence' : 'self',
      compView: DashOverview.compView(cid, _readPref(COMP_VIEW_KEY + cid)),
      obs: _obsState(),
      classChange: classGradeChange(
        cid,
        allStudents.map(function (s) {
          return s.id;
        }),
      ),
      mixPop: mixPop,
      helpRule: helpRule,
      naComp: naComp,
    });
    obsHighlight = _lastObsState.highlight;

    // Questions From Students (S10-F4): only while a class has one waiting.
    html += Overview.questionsCardHtml(cid);

    /* -- Students: cards or the grid -- */
    if (focusCol && allStudents.length)
      html += Overview.compFilterHtml(cid, focusCol, _belowIds(cid, allStudents, focusCol));
    if (allStudents.length)
      html += DashInsights.studentsHeaderHtml(
        studentView,
        Overview.studentControlsHtml({
          sortMode: sortMode,
          extraSort: _gridSortOption(cid),
          searchQuery: searchQuery,
          showFlaggedOnly: showFlaggedOnly,
          flagCount: flagCount,
        }),
        allStudents.length,
      );
    if (studentView === 'grid' && students.length)
      html += DashInsights.studentGridHtml(cid, students, allStudents, shownSort);
    else
      html += StudentCards.renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags, {
        focusKey: focusCol ? focusCol.key : null,
        rule: helpRule,
      });

    // Observations goes last, under the students (Colin, Nov 5).
    html += Overview.obsCardHtml({ cid: cid, allStudents: allStudents, obs: _lastObsState });

    // The open segment's students, placed under it once it is drawn.
    var popHtml = DashInsights.popHtml(cid, allStudents, mixPop);
    if (!popHtml) mixPop = null;
    html +=
      '<div class="dash-mix-pop" id="dash-mix-pop" role="dialog" aria-label="Students"' +
      (popHtml ? '' : ' hidden') +
      '>' +
      popHtml +
      '</div>';

    _hidePop();
    openMenu = null;
    var before = _slideCards ? _cardsBefore() : null;
    _slideCards = false;
    // html-safe: checked builders in dash-overview, dash-insights, dash-student-cards and dash-observations escape every name, title and label; colours are fixed score variables.
    document.getElementById('main').innerHTML = html;
    if (before) _slideCardsFrom(before);
    if (_compFade) _fadeCompRows();
    _compFade = false;
    _afterObsRender(null, 0);
    _placeMixPop();
    _syncCompScroll();
    // A re-render drew the cards anew: light them again if the pointer is
    // still on a competency.
    if (_litKey && !naComp) _setLit(_litKey);
    else _litKey = null;

    // Restore sort dropdown
    var sortSelect = document.querySelector('.dash-sort-select');
    if (sortSelect) sortSelect.value = sortMode;
  }

  /* ── Observations card ──────────────────────────────────── */
  var _lastObsState = null;
  function _obsState() {
    _lastObsState = {
      tab: obsTab,
      highlight: obsHighlight,
      width: _obsWidth || _estimateObsWidth(),
    };
    return _lastObsState;
  }

  // Before the card exists: the width of #main, less the page and card padding.
  function _estimateObsWidth() {
    var main = document.getElementById('main');
    var w = main ? main.clientWidth - 24 : 0;
    if (!(w > 0)) return 0;
    return Math.max(0, Math.floor(w - 42));
  }

  /* The width the student columns get: the grid pane's inner width, so a
     scrollbar in the pane is taken off; the card's inner width when there
     is no grid (empty states). */
  function _measureObsWidth(card) {
    var pane = card.querySelector('.dash-ob2-pane');
    if (pane && pane.clientWidth > 0) return Math.floor(pane.clientWidth);
    var cs = window.getComputedStyle(card);
    return Math.floor(card.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
  }

  function _obsCard() {
    return document.getElementById('dash-obs-card');
  }

  /* Re-render only the Observations card (tabs, flags). */
  function renderObsCard(focusKey, depth) {
    var card = _obsCard();
    if (!card) return;
    _hidePop();
    var st = _obsState();
    // html-safe: DashObservations.renderCard escapes names, labels and notes; types and flags are fixed keys.
    card.innerHTML = DashObservations.renderCard(activeCourse, getStudents(activeCourse), st);
    obsHighlight = st.highlight;
    _afterObsRender(focusKey, (depth || 0) + 1);
  }

  /* After the card is drawn: measure it, redraw if the number of student
     columns or the sideways scroll should change, then set the roving tab
     stop. A redraw can add or remove the pane's scrollbar and so change the
     width again: a second corrective pass is allowed, never more. */
  var OBS_MAX_PASSES = 2;
  function _afterObsRender(focusKey, depth) {
    var card = _obsCard();
    if (!card) return;
    var m = DashObservations.lastModel();
    var w = _measureObsWidth(card);
    if (m && w > 0) {
      _obsWidth = w;
      var layout =
        m.tab === 'competency' && m.sections.length > 7
          ? { cols: 1, compact: false }
          : DashObservations.obsGridLayout({
              tab: m.tab,
              n: m.rows.length,
              cells: m.cells,
              minCell: m.baseMinCell || m.minCell,
              width: w,
              fixed: m.fixed,
            });
      var cols = layout.cols;
      var scrollX = cols === 1 && m.blockMin > w;
      if (
        (depth || 0) < OBS_MAX_PASSES &&
        (cols !== m.cols || scrollX !== m.scrollX || !!layout.compact !== !!m.compact)
      ) {
        renderObsCard(focusKey, depth);
        return;
      }
    }
    _applyRoving(card);
    if (focusKey) _focusKey(focusKey);
  }

  function _byFocusKey(key) {
    var all = document.querySelectorAll('#dash-obs-card [data-focus-key]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-focus-key') === key) return all[i];
    }
    return null;
  }

  function _focusKey(key) {
    var el = _byFocusKey(key);
    if (!el) return;
    if (el.hasAttribute('data-ob2-nav')) _setRoving(el);
    el.focus();
  }

  // Each grid is one tab stop: the last item used, else the first name.
  function _applyRoving(card) {
    var items = card.querySelectorAll('[data-ob2-nav]');
    if (!items.length) return;
    var target = _obsNavKey ? _byFocusKey(_obsNavKey) : null;
    if (!target) target = card.querySelector('.dash-ob2-name[data-ob2-nav]') || items[0];
    _setRoving(target);
  }

  function _setRoving(el) {
    var card = _obsCard();
    if (!card) return;
    Array.prototype.forEach.call(card.querySelectorAll('[data-ob2-nav][tabindex="0"]'), function (x) {
      x.setAttribute('tabindex', '-1');
    });
    el.setAttribute('tabindex', '0');
    _obsNavKey = el.getAttribute('data-focus-key');
  }

  function _navRows(card) {
    return Array.prototype.filter.call(card.querySelectorAll('[data-ob2-navrow]'), function (r) {
      return !!r.querySelector('[data-ob2-nav]');
    });
  }

  function _navItems(row) {
    return Array.prototype.slice.call(row.querySelectorAll('[data-ob2-nav]'));
  }

  function _nearestByCol(items, col) {
    var best = null;
    var bestD = Infinity;
    items.forEach(function (el) {
      var d = Math.abs(Number(el.getAttribute('data-ob2-col')) - col);
      if (d < bestD) {
        best = el;
        bestD = d;
      }
    });
    return best;
  }

  /* Arrow keys across a row and down the roster (into the next column of
     students after the last row); Home and End go to the row's ends, with
     Ctrl to the first and last student. Enter follows the link or button. */
  function _navMove(el, e) {
    var card = _obsCard();
    var row = el.closest('[data-ob2-navrow]');
    if (!card || !row) return false;
    var items = _navItems(row);
    var i = items.indexOf(el);
    var col = Number(el.getAttribute('data-ob2-col'));
    var rows = _navRows(card);
    var r = rows.indexOf(row);
    var next = null;
    if (e.key === 'ArrowRight') next = items[i + 1];
    else if (e.key === 'ArrowLeft') next = items[i - 1];
    else if (e.key === 'Home') next = e.ctrlKey || e.metaKey ? _navItems(rows[0])[0] : items[0];
    else if (e.key === 'End') {
      var lastItems = e.ctrlKey || e.metaKey ? _navItems(rows[rows.length - 1]) : items;
      next = lastItems[lastItems.length - 1];
    } else if (e.key === 'ArrowDown') next = rows[r + 1] ? _nearestByCol(_navItems(rows[r + 1]), col) : null;
    else if (e.key === 'ArrowUp') next = rows[r - 1] ? _nearestByCol(_navItems(rows[r - 1]), col) : null;
    else return false;
    e.preventDefault();
    if (next) {
      _setRoving(next);
      next.focus();
    }
    return true;
  }

  var OBS_TABS = ['week', 'competency'];
  function _setObsTab(tab) {
    if (OBS_TABS.indexOf(tab) < 0) return;
    if (tab !== obsTab) {
      obsTab = tab;
      obsHighlight = null;
      _obsNavKey = null;
      _writePref(OBS_TAB_KEY, tab);
    }
    renderObsCard('tab-' + tab);
  }

  /* The open proficiency segment's list sits under the segment, inside the
     window. */
  function _placeMixPop() {
    var pop = document.getElementById('dash-mix-pop');
    if (!pop || pop.hidden) return;
    var seg = document.querySelector('.dash-mix-seg.active');
    if (!seg) {
      pop.hidden = true;
      return;
    }
    var r = seg.getBoundingClientRect();
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function _closeMixPop() {
    if (!mixPop) return;
    var key = mixPop.key;
    var level = mixPop.level;
    mixPop = null;
    var pop = document.getElementById('dash-mix-pop');
    if (pop) pop.hidden = true;
    var seg = document.querySelector('.dash-mix-seg.active');
    if (seg) {
      seg.classList.remove('active');
      seg.setAttribute('aria-expanded', 'false');
    }
    return { key: key, level: level };
  }

  function _obsKeydown(e) {
    var t = e.target;
    var inCard = t && t.closest && t.closest('#dash-obs-card');
    if (e.key === 'Escape' && _popFor) {
      _hidePop();
      return !!inCard;
    }
    if (!inCard) return false;
    var tab = t.closest('.dash-ob2-tab');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
      var i = OBS_TABS.indexOf(tab.getAttribute('data-tab'));
      if (e.key === 'ArrowRight') i = (i + 1) % OBS_TABS.length;
      else if (e.key === 'ArrowLeft') i = (i - 1 + OBS_TABS.length) % OBS_TABS.length;
      else if (e.key === 'Home') i = 0;
      else i = OBS_TABS.length - 1;
      e.preventDefault();
      _setObsTab(OBS_TABS[i]);
      return true;
    }
    if (t.hasAttribute && t.hasAttribute('data-ob2-nav')) return _navMove(t, e);
    return false;
  }

  /* The week popover and the competency header tooltip. */
  var POP_TARGET = '#dash-obs-card .dash-ob2-cell.has, #dash-obs-card .dash-ob2-ch[data-ob2-nav]';

  function _showPop(t) {
    var pop = document.getElementById('dash-ob2-pop');
    if (!pop) return;
    var isCell = t.classList.contains('dash-ob2-cell');
    var html = isCell
      ? DashObservations.popoverHtml(t.getAttribute('data-sid'), Number(t.getAttribute('data-wi')))
      : '<div>' + esc(t.getAttribute('aria-label') || '') + '</div>';
    if (!html) return;
    if (_popFor && _popFor !== t) _popFor.removeAttribute('aria-describedby');
    pop.innerHTML = html;
    pop.classList.toggle('is-tip', !isCell);
    pop.hidden = false;
    _popFor = t;
    if (isCell) t.setAttribute('aria-describedby', 'dash-ob2-pop');
    var r = t.getBoundingClientRect();
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function _hidePop() {
    var pop = document.getElementById('dash-ob2-pop');
    if (pop) pop.hidden = true;
    if (_popFor) _popFor.removeAttribute('aria-describedby');
    _popFor = null;
  }

  function _onMouseover(e) {
    var t = e.target.closest && e.target.closest(POP_TARGET);
    if (t && t !== _popFor) _showPop(t);
    var seg = e.target.closest && e.target.closest('.dash-glance-dist .dist-seg');
    if (seg) _keepTipInside(seg);
    _litFrom(e.target);
    var row = e.target.closest && e.target.closest('.dash-comp-rows.is-scroll .dash-comp-row');
    if (row) _placeScrollTip(row);
  }

  /* ── Pointing at a competency (plan F.7a) ───────────────── */
  /* A Curricular Competencies row (or a Needs Support code) under the
     pointer lights its chip on every student card: an outline only, no
     re-sort and no faded chips. Nothing while the competency filter is
     set: the filter already shows one column. */
  var LIT_SOURCE = '.dash-comp-card [data-key]';
  function _litKeyOf(target) {
    var el = target && target.closest && target.closest(LIT_SOURCE);
    var key = el ? el.getAttribute('data-key') : '';
    return key || null;
  }
  function _litFrom(target) {
    var key = naComp ? null : _litKeyOf(target);
    if (key === _litKey) return;
    _setLit(key);
  }
  function _setLit(key) {
    _litKey = key;
    var main = document.getElementById('main');
    if (!main) return;
    Array.prototype.forEach.call(main.querySelectorAll('.dash-card-seg.is-lit'), function (el) {
      el.classList.remove('is-lit');
    });
    if (!key) return;
    Array.prototype.forEach.call(
      main.querySelectorAll('.dash-grid .dash-card-seg[data-key="' + _cssKey(key) + '"]'),
      function (el) {
        el.classList.add('is-lit');
      },
    );
  }

  /* ── The scrolling competency list (plan F.1) ────────────── */
  /* Past 12 rows the Curricular Competencies list scrolls inside the card:
     the fade at its foot goes at the end, and "+N more" counts the rows
     still below. A row's pop-up hangs from the card, not the list, so the
     list doesn't cut it off. */
  function _syncCompScroll(list) {
    list = list || document.querySelector('.dash-comp-rows.is-scroll');
    if (!list) return;
    var wrap = list.parentNode;
    var more = document.querySelector('.dash-comp-moreline');
    var bottom = list.scrollTop + list.clientHeight;
    var below = 0;
    Array.prototype.forEach.call(list.children, function (row) {
      if (row.offsetTop + row.offsetHeight / 2 > bottom) below++;
    });
    var atEnd = bottom >= list.scrollHeight - 1;
    if (wrap && wrap.classList) wrap.classList.toggle('is-end', atEnd);
    if (more) {
      more.hidden = below === 0;
      more.textContent = '+' + below + ' more';
      more.setAttribute('aria-label', 'Scroll to the other ' + below + ' competencies');
    }
  }
  function _placeScrollTip(row) {
    var tip = row.querySelector('.dash-comp-tip');
    // The tip hangs from the list's wrapper, outside the part that scrolls.
    var box = row.closest('.dash-comp-scroll');
    if (!tip || !box) return;
    var r = row.getBoundingClientRect();
    var c = box.getBoundingClientRect();
    var name = row.querySelector('.dash-comp-name');
    var left = name ? name.getBoundingClientRect().right + 8 : r.left;
    tip.style.left = Math.round(left - c.left) + 'px';
    tip.style.top = Math.round(r.bottom - c.top + 2) + 'px';
  }
  function _compMore() {
    var list = document.querySelector('.dash-comp-rows.is-scroll');
    if (!list) return;
    var by = Math.max(22, list.clientHeight - 22);
    if (typeof list.scrollBy === 'function') list.scrollBy({ top: by, behavior: _reducedMotion() ? 'auto' : 'smooth' });
    else list.scrollTop += by;
  }
  /* A proficiency segment's list sits centred under it; near either end of
     the bar that runs past the card (and under the sidebar or off the page),
     so it moves sideways to stay inside the Class at a Glance card. */
  function _keepTipInside(seg) {
    var tip = seg.querySelector('.dist-tip');
    var card = seg.closest('.dash-glance');
    if (!tip || !card) return;
    tip.style.removeProperty('--tip-shift');
    var r = tip.getBoundingClientRect();
    var box = card.getBoundingClientRect();
    var shift = r.left < box.left ? box.left - r.left : r.right > box.right ? box.right - r.right : 0;
    if (shift) tip.style.setProperty('--tip-shift', Math.round(shift) + 'px');
  }
  function _onMouseout(e) {
    // Off the competency the chips were lit for.
    if (_litKey && _litKeyOf(e.relatedTarget) !== _litKey) _setLit(null);
    var t = e.target.closest && e.target.closest(POP_TARGET);
    if (!t || t !== _popFor) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    if (document.activeElement === t) return;
    _hidePop();
  }
  function _onFocusin(e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#dash-obs-card')) return;
    if (t.hasAttribute('data-ob2-nav')) _setRoving(t);
    var p = t.closest(POP_TARGET);
    if (p) _showPop(p);
    else if (_popFor) _hidePop();
  }
  function _onFocusout(e) {
    if (_popFor && e.target === _popFor) _hidePop();
  }

  function _onScrollClose(e) {
    if (e.target && e.target.classList && e.target.classList.contains('dash-comp-rows')) _syncCompScroll(e.target);
    if (!mixPop) return;
    var pop = document.getElementById('dash-mix-pop');
    if (pop && e.target && pop.contains && pop.contains(e.target)) return;
    _closeMixPop();
  }

  function _onResize() {
    _placeMixPop();
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      var card = _obsCard();
      if (!card) return;
      var active = document.activeElement;
      var key = active && card.contains(active) ? active.getAttribute('data-focus-key') : null;
      _afterObsRender(key, 0);
    }, 150);
  }

  /* "+" on a row: the capture strip in a dialog, the student fixed. */
  function openObsDialog(sid) {
    var cid = activeCourse;
    var st = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!st || typeof ObsCapture === 'undefined') return;
    _hidePop();
    var refresh = function () {
      // After the dialog has closed: redraw the card and the student cards
      // (their "Last observed" line), then put focus back on this row's "+".
      setTimeout(function () {
        if (!_obsCard()) return;
        render();
        if (!document.querySelector('.obsc-dialog-overlay')) _focusKey('nav:' + sid + ':0');
      }, 0);
    };
    ObsCapture.openDialog({
      cid: cid,
      title: 'Add observation',
      subtitle: displayName(st),
      students: [sid],
      lockStudents: true,
      draftKey: 'dash|' + sid,
      onAdd: refresh,
      onFlag: refresh,
      // Closed without Add or Flag (Escape, ✕ or the backdrop), e.g. after
      // "Not Now" on the concern flag offer. A save may have redrawn the
      // card behind the dialog, so the "+" it would refocus is gone: put
      // focus back on this row's new "+".
      onClose: function () {
        setTimeout(function () {
          if (_obsCard()) _focusKey('nav:' + sid + ':0');
        }, 0);
      },
    });
  }

  /* ── The competency filter ──────────────────────────────── */
  /* The students below the Who Needs Help rule on one column, weakest
     first: the filter bar's "Record an Observation for the N Below". */
  function _belowIds(cid, allStudents, col) {
    var ids = allStudents.map(function (s) {
      return s.id;
    });
    var rule = DashInsights.readRule(helpRule);
    var dist = competencyDistribution(cid, ids, col.which);
    return ids
      .filter(function (sid) {
        return DashInsights.isBelowRule(cid, col, sid, dist.values[sid], rule);
      })
      .sort(function (a, b) {
        return dist.values[a] - dist.values[b];
      });
  }

  /* "Record an Observation for the N Below": the capture strip in a dialog
     with those students picked (any can be taken off before Add). */
  function openCompObsDialog(key) {
    var cid = activeCourse;
    var col = _gridColumn(cid, key);
    if (!col || typeof ObsCapture === 'undefined') return;
    var ids = _belowIds(cid, getStudents(cid), col);
    if (!ids.length) return;
    _hidePop();
    var refocus = function () {
      var btn = document.querySelector('.dash-comp-record');
      if (btn) btn.focus();
    };
    var refresh = function () {
      setTimeout(function () {
        if (!document.querySelector('.dash-comp-card')) return;
        render();
        if (!document.querySelector('.obsc-dialog-overlay')) refocus();
      }, 0);
    };
    ObsCapture.openDialog({
      cid: cid,
      title: 'Add observation',
      subtitle: col.title + ' · ' + ids.length + ' student' + (ids.length === 1 ? '' : 's'),
      students: ids,
      draftKey: 'dash-comp|' + col.key,
      onAdd: refresh,
      onFlag: refresh,
      onClose: function () {
        setTimeout(refocus, 0);
      },
    });
  }

  function _cssKey(key) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : String(key).replace(/["\\]/g, '\\$&');
  }

  /* ── Motion (plan B.5) ──────────────────────────────────── */
  /* Nothing moves when the teacher has asked for less motion; the CSS
     turns its transitions off under the same media query. */
  function _reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function _cardEls() {
    return Array.prototype.slice.call(document.querySelectorAll('#main .dash-grid > .dash-card[data-sid]'));
  }

  /* Before a re-render that may move the student cards: where each card is,
     which competency the chips were focused on, and which cards had the
     amber border. */
  function _cardsBefore() {
    if (_reducedMotion()) return null;
    var cards = _cardEls();
    if (!cards.length || typeof cards[0].getBoundingClientRect !== 'function') return null;
    var seg = document.querySelector('#main .dash-card-strip.has-focus .dash-card-seg.is-focus');
    var out = { rects: {}, below: {}, focus: seg ? seg.getAttribute('data-key') : null };
    cards.forEach(function (el) {
      var sid = el.getAttribute('data-sid');
      out.rects[sid] = el.getBoundingClientRect();
      if (el.classList.contains('is-focus-below')) out.below[sid] = true;
    });
    return out;
  }

  /* FLIP: each card that was on screen starts where it was, in the look it
     had (chips, border), then slides to its new place as the chips and the
     border change (dashboard.css .is-sliding). New cards just appear. */
  function _slideCardsFrom(before) {
    var placed = [];
    _cardEls().forEach(function (el) {
      var sid = el.getAttribute('data-sid');
      var a = before.rects[sid];
      if (!a) return;
      var b = el.getBoundingClientRect();
      var strip = el.querySelector('.dash-card-strip');
      var segs = strip ? Array.prototype.slice.call(strip.querySelectorAll('.dash-card-seg')) : [];
      var now = {
        el: el,
        below: el.classList.contains('is-focus-below'),
        strip: strip,
        stripFocus: strip ? strip.classList.contains('has-focus') : false,
        segs: segs.map(function (g) {
          return g.classList.contains('is-focus');
        }),
        dx: a.left - b.left,
        dy: a.top - b.top,
      };
      el.classList.add('is-placing');
      el.classList.toggle('is-focus-below', !!before.below[sid]);
      if (strip) strip.classList.toggle('has-focus', !!before.focus);
      segs.forEach(function (g) {
        g.classList.toggle('is-focus', !!before.focus && g.getAttribute('data-key') === before.focus);
      });
      if (now.dx || now.dy) el.style.transform = 'translate(' + now.dx + 'px, ' + now.dy + 'px)';
      now.segEls = segs;
      placed.push(now);
    });
    if (!placed.length) return;
    // One layout read, so the old places and looks take before the change.
    void document.body.offsetHeight;
    placed.forEach(function (p) {
      var el = p.el;
      el.classList.remove('is-placing');
      el.classList.add('is-sliding');
      el.classList.toggle('is-focus-below', p.below);
      if (p.strip) p.strip.classList.toggle('has-focus', p.stripFocus);
      p.segEls.forEach(function (g, i) {
        g.classList.toggle('is-focus', p.segs[i]);
      });
      el.style.transform = '';
    });
    setTimeout(function () {
      placed.forEach(function (p) {
        p.el.classList.remove('is-sliding');
      });
    }, 300);
  }

  // A new view on the Curricular Competencies card: its rows fade in.
  function _fadeCompRows() {
    if (_reducedMotion()) return;
    var body = document.querySelector('.dash-comp-card .dash-comp-body');
    if (body) body.classList.add('is-fade-in');
  }

  /* ── Student Management ─────────────────────────────────── */

  // Focus back on the control used, when it is drawn again.
  function _focusSel(selector) {
    var el = selector ? document.querySelector(selector) : null;
    if (el) el.focus();
  }

  /* ── Delegated click handler ────────────────────────────── */
  /* Answer in the Grader: the grader on the student's piece, that student
     only. Closing it draws the dashboard again, so an answered question
     leaves the card, if the dashboard is still the page shown. */
  function _answerInGrader(cid, aid, sid) {
    if (!cid || !aid || !sid || !window.PageAssignments || !PageAssignments.openGrader) return;
    PageAssignments.openGrader(cid, aid, sid, {
      studentIds: [sid],
      onClose: function () {
        if (document.querySelector('#main .dash-glance')) render();
      },
    });
  }

  function _handleClick(e) {
    // A click outside the open segment list closes it.
    if (mixPop && !e.target.closest('#dash-mix-pop, .dash-mix-seg')) _closeMixPop();
    // A click outside the open view menu (and not on its pill) closes it.
    if (openMenu && !e.target.closest('.dash-view-menu, .dash-view-btn')) _closeViewMenu();
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();

    // Delegate cm/cw actions to class manager submodule
    if (CM.handleAction(action, el, e)) return;

    // Dashboard-only actions
    var handlers = {
      // The photo reminder (S8-F1): Class Settings › Student Page at Keep
      // Photos Until, or Dismiss for this class and date.
      dashPhotoReminderChange: function () {
        var cid = el.dataset.cid;
        if (!cid || cid !== activeCourse) return;
        openClassManager('student-page', cid);
        CmStudentPage.focusKeepPhotos(cid);
        // Class Settings draws again as the classes finish loading, which
        // drops the focus: give it back once, if Class Settings is still on
        // this class and nothing else has taken the focus.
        setTimeout(function () {
          var lost = !document.activeElement || document.activeElement === document.body;
          var here = CM.classManagerOpen && document.querySelector('.sp-card[data-cid="' + CSS.escape(cid) + '"]');
          if (lost && here) CmStudentPage.focusKeepPhotos(cid);
        }, 0);
      },
      dashPhotoReminderDismiss: function () {
        var cid = el.dataset.cid;
        if (!cid || cid !== activeCourse) return;
        CmStudentPage.dismissPhotoReminder(cid, el.dataset.date);
        render();
      },
      // Questions From Students (S10-F4): the grader on that student's piece.
      dashAnswerQuestion: function () {
        _answerInGrader(el.dataset.cid, el.dataset.aid, el.dataset.sid);
      },
      goToStudent: function () {
        // The competency tiles open Competencies, the observation line Evidence.
        var part = e.target.closest('[data-student-tab]');
        Router.navigate(
          '/student?id=' +
            el.dataset.sid +
            '&course=' +
            el.dataset.course +
            (part ? '&tab=' + part.dataset.studentTab : ''),
        );
      },
      toggleFlag: function () {
        toggleFlag(el.dataset.cid, el.dataset.sid);
        render();
      },
      toggleFlaggedFilter: function () {
        showFlaggedOnly = !showFlaggedOnly;
        render();
      },
      obsTab: function () {
        _setObsTab(el.dataset.tab);
      },
      obsFlag: function () {
        var key = el.dataset.flag;
        obsHighlight = obsHighlight === key ? null : key;
        renderObsCard('flag-' + key);
      },
      obsAdd: function () {
        openObsDialog(el.dataset.sid);
      },
      mixSeg: function () {
        var key = el.dataset.key;
        var level = Number(el.dataset.level);
        var was = _closeMixPop();
        if (was && was.key === key && was.level === level) return;
        mixPop = { key: key, level: level };
        render();
        var pop = document.getElementById('dash-mix-pop');
        var first = pop && pop.querySelector('a, button');
        if (first) first.focus();
      },
      viewMenu: function () {
        var id = el.dataset.menu;
        if (openMenu === id) _closeViewMenu();
        else _openViewMenu(id);
      },
      viewPick: function () {
        _pickView(el.dataset.menu, el.dataset.view);
      },
      mixClose: function () {
        var was = _closeMixPop();
        var seg =
          was && document.querySelector('.dash-mix-seg[data-key="' + was.key + '"][data-level="' + was.level + '"]');
        if (seg) seg.focus();
      },
      // A competency picked on Curricular Competencies (a row, or a Needs
      // Support column code), or cleared there or by the filter chip. Focus
      // goes back to the control used, or after the filter chip to the
      // competency's control on the card.
      naComp: function () {
        var key = el.dataset.key || null;
        var was = naComp;
        naComp = key && key !== naComp ? key : null;
        if (naComp !== was) _slideCards = true;
        var inCard = !!el.closest('.dash-comp-card');
        var fromBar = !!el.closest('.dash-comp-filter');
        var ctl = el.classList.contains('dash-comp-code')
          ? '.dash-comp-code'
          : el.classList.contains('dash-comp-row') && !el.classList.contains('is-mix')
            ? '.dash-comp-row'
            : '.dash-comp-pick';
        render();
        if (inCard) _focusSel('.dash-comp-card ' + ctl + '[data-key="' + _cssKey(key) + '"]');
        else if (fromBar && was) _focusComp(was);
      },
      compRecord: function () {
        openCompObsDialog(el.dataset.key);
      },
      compMore: function () {
        _compMore();
      },
      // A grid heading: its column, or the other way round if it is already
      // the sort. Names start A→Z, Last Observed with the longest ago, the
      // rest High→Low.
      gridSort: function () {
        var key = el.dataset.key;
        // A sort clears the competency filter, so it is never ignored.
        naComp = null;
        var cur = DashInsights.gridSortOf(sortMode);
        var dir = cur && cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc';
        _slideCards = true;
        sortMode =
          key === 'name'
            ? 'last-' + dir
            : key === 'overall'
              ? 'overall-' + dir
              : key === 'obs'
                ? 'obs:' + dir
                : key + ':' + dir;
        render();
        var again = document.querySelector('.dash-sg-sort[data-key="' + CSS.escape(key) + '"]');
        if (again) again.focus();
      },
      studentView: function () {
        studentView = el.dataset.view === 'grid' ? 'grid' : 'cards';
        saveDashboardPrefs({ studentView: studentView });
        render();
      },
      // The sort menu is handled on change (_handleChange). Handling it on
      // click too re-rendered the toolbar as the menu opened, which closed it
      // before an option could be picked.
    };
    if (handlers[action]) {
      if (el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  /* ── Input/change/blur handler for non-click events ─────── */
  function _handleInput(e) {
    var el = e.target;
    if (el.dataset.actionInput === 'dashSearch') {
      dashSearchInput(el);
      return;
    }
    CM.handleInput(el);
  }

  function _handleChange(e) {
    var el = e.target;
    // Dashboard-specific change handlers
    if (el.dataset.action === 'dashSwitchCourse') {
      switchCourse(el.value);
      return;
    }
    if (el.dataset.action === 'dashSort') {
      // A sort clears the competency filter, so it is never ignored.
      naComp = null;
      sortMode = el.value;
      _slideCards = true;
      render();
      return;
    }
    // Delegate cm/cw change handlers
    CM.handleChange(el);
  }

  function _handleBlur(e) {
    CM.handleBlur(e.target);
  }

  function _handleKeydown(e) {
    if (_viewMenuKeydown(e)) return;
    if (e.key === 'Escape' && mixPop) {
      var was = _closeMixPop();
      var seg = document.querySelector('.dash-mix-seg[data-key="' + was.key + '"][data-level="' + was.level + '"]');
      if (seg) seg.focus();
      return;
    }
    var popOpen = !!_popFor;
    if (_obsKeydown(e)) return;
    // Escape with nothing else open clears the competency filter.
    if (e.key === 'Escape' && naComp && !popOpen && !CM.classManagerOpen && _escapeIsFree(e)) {
      var key = naComp;
      e.preventDefault();
      naComp = null;
      _slideCards = true;
      render();
      _focusComp(key);
      return;
    }
    CM.handleKeydown(e);
  }

  // Whether an Escape is the page's to use: nothing handled it first (the
  // account menu, the Demo Mode menu and the Help panel listen on the
  // document and call preventDefault), it comes from the page itself and
  // not from a menu, dialog, open control, text field or the observation
  // box, and no menu in the top bar is open.
  var ESC_BUSY = '[role="menu"], [role="dialog"], [aria-expanded="true"], textarea, input, .obsc, [id$="obs-capture"]';
  function _escapeIsFree(e) {
    if (e.defaultPrevented) return false;
    var t = e.target;
    var main = document.getElementById('main');
    if (!main || !t || !t.closest || !main.contains(t)) return false;
    if (t.closest(ESC_BUSY)) return false;
    return !document.querySelector('#page-toolbar-mount [aria-expanded="true"], .tb-right [aria-expanded="true"]');
  }

  // Focus on a competency's control on the Curricular Competencies card,
  // else on the card's view menu.
  function _focusComp(key) {
    var el =
      document.querySelector('.dash-comp-card [data-key="' + _cssKey(key) + '"][aria-pressed]') ||
      document.getElementById('dash-view-btn-comp');
    if (el) el.focus();
  }

  /* ── View menus (DashOverview.viewMenuHtml) ─────────────── */
  function _menuEl(id) {
    return document.getElementById('dash-view-menu-' + id);
  }
  function _menuBtn(id) {
    return document.getElementById('dash-view-btn-' + id);
  }
  function _menuItems(id) {
    var menu = _menuEl(id);
    return menu ? Array.prototype.slice.call(menu.querySelectorAll('[role="menuitemradio"]')) : [];
  }

  // Opens a menu (closing any other) with focus on the view in use.
  function _openViewMenu(id) {
    if (openMenu && openMenu !== id) _closeViewMenu();
    var menu = _menuEl(id);
    var btn = _menuBtn(id);
    if (!menu || !btn) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openMenu = id;
    var items = _menuItems(id);
    var on = items.filter(function (it) {
      return it.getAttribute('aria-checked') === 'true';
    })[0];
    if (on || items[0]) (on || items[0]).focus();
  }

  // Closes the open menu; with refocus, focus goes back to its pill.
  function _closeViewMenu(refocus) {
    var id = openMenu;
    openMenu = null;
    if (!id) return;
    var menu = _menuEl(id);
    var btn = _menuBtn(id);
    if (menu) menu.hidden = true;
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
  }

  // A pick: the menu's setter records it, the page draws it, focus returns
  // to the pill (drawn anew, now naming the view).
  function _pickView(id, key) {
    openMenu = null;
    if (_viewSetters[id]) _viewSetters[id](key);
    render();
    var btn = _menuBtn(id);
    if (btn) btn.focus();
  }

  /* Escape closes the open menu; arrow keys, Home and End move between its
     items; Enter picks. Down or Up on a closed pill opens it. */
  function _viewMenuKeydown(e) {
    var t = e.target;
    if (!openMenu) {
      var pill = t && t.closest && t.closest('.dash-view-btn');
      if (pill && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        _openViewMenu(pill.dataset.menu);
        return true;
      }
      return false;
    }
    var id = openMenu;
    if (e.key === 'Escape') {
      e.preventDefault();
      _closeViewMenu(true);
      return true;
    }
    if (e.key === 'Tab') {
      _closeViewMenu();
      return false;
    }
    var items = _menuItems(id);
    var i = items.indexOf(document.activeElement);
    var next = null;
    if (e.key === 'ArrowDown') next = items[i < 0 ? 0 : (i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
      e.preventDefault();
      _pickView(id, items[i].dataset.view);
      return true;
    } else return false;
    e.preventDefault();
    if (next) next.focus();
    return true;
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset state
    activeCourse = getActiveCourse();
    showFlaggedOnly = false;
    sortMode = 'last-asc';
    searchQuery = '';
    obsTab = _readPref(OBS_TAB_KEY) === 'competency' ? 'competency' : 'week';
    obsHighlight = null;
    _obsWidth = 0;
    _obsNavKey = null;
    var dashPrefs = getDashboardPrefs();
    studentView = dashPrefs.studentView === 'grid' ? 'grid' : 'cards';
    helpRule = DashInsights.readRule(dashPrefs.helpRule);
    mixPop = null;
    naComp = null;
    _litKey = null;
    openMenu = null;
    CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse });
    CM.resetState();

    // The student list, as on the other pages (_syncSidebar in render)
    document.getElementById('sidebar-mount').innerHTML = '';
    delete document.getElementById('sidebar-mount').dataset.cid;
    initSidebarToggle();

    // Add page-specific class for scoped CSS
    document.getElementById('main').classList.add('page-dashboard');

    // Show the sidebar toggle in the dock
    var sidebarBtn = document.querySelector('.tb-btn');
    if (sidebarBtn) sidebarBtn.style.display = '';

    // Expose switchCourse globally for dock course selector
    window._pageSwitchCourse = switchCourse;

    // Add delegated listeners
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('blur', _handleBlur, true); // blur doesn't bubble, use capture
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('mouseover', _onMouseover);
    _addDocListener('mouseout', _onMouseout);
    _addDocListener('focusin', _onFocusin);
    _addDocListener('focusout', _onFocusout);
    // Scrolling moves the segment the open list belongs to: close it.
    _addDocListener('scroll', _onScrollClose, true);
    window.addEventListener('resize', _onResize);
    CM.initDrag();

    render();
    // A teacher with no classes yet starts in the class manager's
    // "Create a Class" screen.
    if (!activeCourse && Object.keys(COURSES).length === 0) CM.openClassManager();
    // An old "Edit starters…" link: starters are on My Sentence Starters now.
    else if (params && params.manage === 'starters') {
      Router.navigate('/observations/starters');
      return;
    }
    // A "manage" link (the Term Questionnaire's "Questionnaires ›", the
    // gradebook's Add Students): Class Settings open on that tab.
    else if (params && params.manage) openClassManager(params.manage, params.class);

    // Ensure page starts at top
    requestAnimationFrame(function () {
      document.getElementById('main').scrollTop = 0;
    });
  }

  function destroy() {
    if (typeof ObsCapture !== 'undefined') ObsCapture.closeDialog();
    _hidePop();
    window.removeEventListener('resize', _onResize);
    clearTimeout(_resizeTimer);
    CM.destroy();
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    if (_dashSearchTimer) clearTimeout(_dashSearchTimer);
    document.getElementById('main').classList.remove('page-dashboard');
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
  };
})();
