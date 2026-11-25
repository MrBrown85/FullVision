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

  /* Class insights (dash-insights.js): Cards or Grid and the Who Needs Help
     rule follow the teacher to any device (getDashboardPrefs). The rule has no editor since the Needs
     Attention card went (plan F.8): it stays at its saved value or the
     default. */
  var studentView = 'cards';
  // The page's competency filter (a Curricular Competencies row). Not
  // remembered. The name is the old Needs Attention one; other code and
  // the data-action use it.
  // The column whose chips are lit on every student card while the pointer
  // is on its Curricular Competencies row (plan F.7a).

  // The next render slides the student cards to their new places (the
  // filter was set or cleared, or the sort changed).
  var _slideCards = false;

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
      renderStudents();
      requestAnimationFrame(function () {
        var inp = document.querySelector('.dash-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(pos, pos);
        }
      });
    }, 150);
  }

  /* ── Sorting by a grid column (DashInsights.sortStudents) ── */
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
    if (window.DashInbox && activeCourse && activeCourse !== cid) DashInbox.leave(activeCourse);
    activeCourse = cid;
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

  /* Class Settings sets two classes for dashboard.css (renderClassManager):
     cm-open on the body and cm-listing on #main. The dashboard clears them. */
  function _clearClassSettingsClasses() {
    if (document.body && document.body.classList) document.body.classList.remove('cm-open');
    var main = document.getElementById('main');
    if (main && main.classList) main.classList.remove('cm-listing');
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
    _clearClassSettingsClasses();
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
    var flags = getFlags(cid);
    var assessments = getAssignedAssessments(cid);
    var allScores = getScores(cid);
    var list = _shownStudents(cid, flags);
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

    _toolbar(list.students);

    /* -- Overview Panel -- */
    // Photos in a class about to go a year unopened (shared/photo-expiry.js): rarely anything.
    var html = PhotoExpiry.mount('dash');
    html += Overview.renderOverviewPanel({
      cid: cid,
      sections: sections,
      allStudents: allStudents,
      assessments: assessments,
      classAvg: classAvg,
      classR: classR,
      // The Competencies tile's open page, per class on this device.
      compPage: DashCompetencies.pageOf(_readPref(DashCompetencies.PREF_KEY + cid)),
      // What the tile counts over (this term or the year), per class on this device.
      compSpan: DashCompetencies.spanOf(_readPref(DashCompetencies.SPAN_KEY + cid)),
      classChange: classGradeChange(
        cid,
        allStudents.map(function (s) {
          return s.id;
        }),
      ),
    });

    // Questions From Students (S10-F4): only while a class has one waiting.
    html += Overview.questionsCardHtml(cid);

    // The students, cards or the grid, in a box of their own (renderStudents).
    html +=
      '<div id="dash-students" style="display:contents">' +
      _studentsHtml(cid, list, allStudents, flags, sections, assessments, allScores) +
      '</div>';

    var before = _slideCards && !_reducedMotion() ? StudentCards.cardsBefore() : null;
    _slideCards = false;
    // html-safe: checked builders in dash-overview, dash-insights and dash-student-cards escape every name, title and label; colours are fixed score variables.
    if (window.DashInbox) DashInbox.beforeRender();
    document.getElementById('main').innerHTML = html;
    if (before) StudentCards.slideFrom(before);
    if (window.DashInbox) DashInbox.afterRender(cid);
    DashOverview.sizeRow();
    _watchAboveRow();

    // Restore sort dropdown
    var sortSelect = document.querySelector('.dash-sort-select');
    if (sortSelect) sortSelect.value = sortMode;
  }

  /* ── The students alone ─────────────────────────────────── */
  /* The students the cards or the grid show, in order: the sort, the
     search and Flagged. */
  function _shownStudents(cid, flags) {
    var shownSort = sortMode;
    var students = DashInsights.sortStudents(cid, getStudents(cid), sortMode, flags);
    if (searchQuery) students = DashInsights.searchStudents(students, searchQuery);
    if (showFlaggedOnly)
      students = students.filter(function (s) {
        return flags[s.id];
      });
    return { students: students, shownSort: shownSort };
  }

  function _studentsHtml(cid, list, allStudents, flags, sections, assessments, allScores) {
    var html = '';
    if (allStudents.length)
      html += DashInsights.studentsHeaderHtml(
        studentView,
        Overview.studentControlsHtml({
          sortMode: sortMode,
          extraSort: _gridSortOption(cid),
          searchQuery: searchQuery,
          showFlaggedOnly: showFlaggedOnly,
          flagCount: Object.values(flags).filter(Boolean).length,
        }),
        allStudents.length,
      );
    if (studentView === 'grid' && list.students.length)
      return html + DashInsights.studentGridHtml(cid, list.students, allStudents, list.shownSort);
    return (
      html + StudentCards.renderStudentCards(cid, list.students, allStudents, sections, assessments, allScores, flags)
    );
  }

  function _toolbar(students) {
    // html-safe: DashOverview.renderDashToolbar escapes class names; the rest is a count.
    document.getElementById('page-toolbar-mount').innerHTML = Overview.renderDashToolbar({
      activeCourse: activeCourse,
      students: students,
    });
  }

  /* A search, a sort, Flagged, a flag or Cards | Grid changes only the
     students: they are drawn again alone, with the toolbar's count. The
     rest of the page stays as it is. */
  function renderStudents() {
    var host = document.getElementById('dash-students');
    if (!host || CM.classManagerOpen) return render();
    var cid = activeCourse;
    if (typeof setActiveTerm === 'function') setActiveTerm(cid, null);
    var flags = getFlags(cid);
    var list = _shownStudents(cid, flags);
    _toolbar(list.students);
    var before = _slideCards && !_reducedMotion() ? StudentCards.cardsBefore() : null;
    _slideCards = false;
    // html-safe: dash-overview, dash-insights and dash-student-cards escape every name, title and label.
    host.innerHTML = _studentsHtml(
      cid,
      list,
      getStudents(cid),
      flags,
      getSections(cid),
      getAssignedAssessments(cid),
      getScores(cid),
    );
    if (before) StudentCards.slideFrom(before);
    var sortSelect = host.querySelector('.dash-sort-select');
    if (sortSelect) sortSelect.value = sortMode;
  }

  function _onMouseover(e) {
    var seg = e.target.closest && e.target.closest('.dash-glance-dist .dist-seg');
    if (seg) _keepTipInside(seg);
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
  /* The middle row is as tall as the window leaves below where it starts, so
     it is measured again whenever what sits above it changes height (the
     photo-expiry line arriving after the first draw). */
  var _aboveRowWatch = null;
  function _watchAboveRow() {
    if (_aboveRowWatch) _aboveRowWatch.disconnect();
    _aboveRowWatch = null;
    if (typeof ResizeObserver === 'undefined' || !document.querySelector('.dash-row')) return;
    _aboveRowWatch = new ResizeObserver(function () {
      DashOverview.sizeRow();
    });
    document.querySelectorAll('.page-dashboard .photo-expiry, .page-dashboard .dash-glance').forEach(function (el) {
      _aboveRowWatch.observe(el);
    });
  }

  function _onResize() {
    DashOverview.sizeRow();
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
    if (window.DashInbox && DashInbox.click(e, { cid: activeCourse, redraw: render })) return;
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();

    // Delegate cm/cw actions to class manager submodule
    if (CM.handleAction(action, el, e)) return;

    // Dashboard-only actions
    var handlers = {
      // Open Class on a photo warning: an archived class opens in Class Settings.
      photoExpiryOpen: function () {
        var on = el.dataset.cid;
        if (!on || !COURSES[on]) return;
        if (isCourseArchived(on)) openClassManager(null, on);
        else switchCourse(on);
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
        renderStudents();
      },
      toggleFlaggedFilter: function () {
        showFlaggedOnly = !showFlaggedOnly;
        renderStudents();
      },
      compPage: function () {
        _setCompPage(el.dataset.page, false);
      },
      // This term | Year on the Competencies tile: kept per class on this device.
      compSpan: function () {
        _setCompSpan(el.dataset.span, el.id);
      },
      // A grid heading: its column, or the other way round if it is already
      // the sort. Names start A→Z, Last Observed with the longest ago, the
      // rest High→Low.
      gridSort: function () {
        var key = el.dataset.key;
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
        renderStudents();
        var again = document.querySelector('.dash-sg-sort[data-key="' + CSS.escape(key) + '"]');
        if (again) again.focus();
      },
      studentView: function () {
        studentView = el.dataset.view === 'grid' ? 'grid' : 'cards';
        saveDashboardPrefs({ studentView: studentView });
        renderStudents();
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
      sortMode = el.value;
      _slideCards = true;
      renderStudents();
      return;
    }
    // Delegate cm/cw change handlers
    CM.handleChange(el);
  }

  function _handleBlur(e) {
    CM.handleBlur(e.target);
  }

  /* The Competencies tile's Curricular | Core: arrow keys, Home and End move
     between the two tabs and open the page, as a click does. */
  function _compTabKeydown(e) {
    var t = e.target;
    var tab = t && t.closest && t.closest('.dash-comp-seg [role="tab"]');
    if (!tab) return false;
    var next = DashCompetencies.pageForKey(tab.dataset.page, e.key);
    if (!next) return false;
    e.preventDefault();
    _setCompPage(next, true);
    return true;
  }
  function _setCompPage(page, focus) {
    var key = DashCompetencies.pageOf(page);
    _writePref(DashCompetencies.PREF_KEY + activeCourse, key);
    var tab = DashCompetencies.show(document, key);
    if (tab && focus) tab.focus();
  }
  /* This term | Year: the Dashboard draws again with the new count, and focus
     stays on the control that was used. */
  function _setCompSpan(span, id) {
    _writePref(DashCompetencies.SPAN_KEY + activeCourse, DashCompetencies.spanOf(span));
    render();
    _focusSel(id ? '#' + id : '');
  }

  function _handleKeydown(e) {
    if (_compTabKeydown(e)) return;
    CM.handleKeydown(e);
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset state
    activeCourse = getActiveCourse();
    showFlaggedOnly = false;
    sortMode = 'last-asc';
    searchQuery = '';
    var dashPrefs = getDashboardPrefs();
    studentView = dashPrefs.studentView === 'grid' ? 'grid' : 'cards';
    CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse });
    CM.resetState();
    if (window.DashInbox) DashInbox.configure({ read: _readPref, write: _writePref });

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
    if (window.DashInbox) DashInbox.leave(activeCourse);
    if (typeof ObsCapture !== 'undefined') ObsCapture.closeDialog();
    window.removeEventListener('resize', _onResize);
    if (_aboveRowWatch) _aboveRowWatch.disconnect();
    _aboveRowWatch = null;
    CM.destroy();
    if (window.DashBulletins && typeof DashBulletins.destroy === 'function') DashBulletins.destroy();
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    if (_dashSearchTimer) clearTimeout(_dashSearchTimer);
    document.getElementById('main').classList.remove('page-dashboard');
    _clearClassSettingsClasses();
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
  };
})();
