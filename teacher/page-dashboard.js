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

  /* The Observations card (dash-observations.js): its tab and Hide names
     are remembered on this device; a highlight is not. */
  var OBS_TAB_KEY = 'fv-dash-obs-tab';
  var HIDE_NAMES_KEY = 'fv-dash-hide-names';
  var obsTab = 'week';
  var obsHighlight = null;
  var namesHidden = false;
  var _obsWidth = 0;
  var _obsNavKey = null;
  var _resizeTimer = null;
  var _popFor = null;

  /* Class insights (dash-insights.js): Cards or Grid and the Who Needs Help
     rule follow the teacher to any device (getDashboardPrefs); an open
     segment list does not. */
  var studentView = 'cards';
  var helpRule = null;
  var helpRuleOpen = false;
  var mixPop = null; // { key, level } of the open proficiency segment
  // Needs Attention: the filter and the competency picked from "N Below".
  // Neither is remembered.
  var naFilter = 'all';
  var naComp = null;

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
  function openClassManager() {
    CM.classManagerOpen = true;
    CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse });
    CM.openClassManager();
  }
  function closeClassManager() {
    CM.closeClassManager();
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

  /* ── switchCourse ───────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    obsHighlight = null;
    mixPop = null;
    naFilter = 'all';
    naComp = null;
    _obsNavKey = null;
    // Reset class manager state for new course
    CM.configure({ activeCourse: cid, onRender: render, onCourseChange: switchCourse });
    CM.resetState();
    if (!(await switchActiveCourse(cid))) return;
    render();
  }

  /* The student list beside the dashboard. It is rebuilt only when the
     class or its roster changed, so its search and scroll survive the
     dashboard's own re-renders. Class Management hides it (dashboard.css). */
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
    // Every grade on this page follows the class's chosen reporting term.
    if (typeof activateSavedTerm === 'function') activateSavedTerm(cid);
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
        students = students.slice().sort(function (a, b) {
          return getOverallProficiency(cid, b.id) - getOverallProficiency(cid, a.id);
        });
        break;
      case 'overall-asc':
        students = students.slice().sort(function (a, b) {
          var pa = getOverallProficiency(cid, a.id);
          var pb = getOverallProficiency(cid, b.id);
          if (pa === 0 && pb === 0) return 0;
          if (pa === 0) return 1;
          if (pb === 0) return -1;
          return pa - pb;
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
    }

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
    var classR = Math.round(classAvg);

    // Section/group-level class averages for overview bars
    var _overviewGrouped = getGroupedSections(cid);
    var _hasOverviewGroups = _overviewGrouped.groups.some(function (g) {
      return g.sections.length > 0;
    });
    var sectionClassAvgs;
    if (_hasOverviewGroups) {
      sectionClassAvgs = [];
      _overviewGrouped.groups.forEach(function (gi) {
        if (gi.sections.length === 0) return;
        var vals = allStudents
          .map(function (s) {
            return getGroupProficiency(cid, s.id, gi.group.id);
          })
          .filter(function (v) {
            return v > 0;
          });
        var avg =
          vals.length > 0
            ? vals.reduce(function (a, b) {
                return a + b;
              }, 0) / vals.length
            : 0;
        sectionClassAvgs.push({
          section: { shortName: gi.group.name, name: gi.group.name, color: gi.group.color },
          avg: avg,
          count: vals.length,
        });
      });
      _overviewGrouped.ungrouped.forEach(function (sec) {
        var vals = allStudents
          .map(function (s) {
            return getSectionProficiency(cid, s.id, sec.id);
          })
          .filter(function (v) {
            return v > 0;
          });
        var avg =
          vals.length > 0
            ? vals.reduce(function (a, b) {
                return a + b;
              }, 0) / vals.length
            : 0;
        sectionClassAvgs.push({ section: sec, avg: avg, count: vals.length });
      });
    } else {
      sectionClassAvgs = sections.map(function (sec) {
        var vals = allStudents
          .map(function (s) {
            return getSectionProficiency(cid, s.id, sec.id);
          })
          .filter(function (v) {
            return v > 0;
          });
        var avg =
          vals.length > 0
            ? vals.reduce(function (a, b) {
                return a + b;
              }, 0) / vals.length
            : 0;
        return { section: sec, avg: avg, count: vals.length };
      });
    }

    // Tag coverage
    var allTags = getAllTags(cid);
    var tagsWithEvidence = 0;
    var tagCoverageMap = {};
    allTags.forEach(function (tag) {
      var hasEvidence = allStudents.some(function (s) {
        var scores = getTagScores(cid, s.id, tag.id);
        return scores.some(function (sc) {
          return sc.score > 0;
        });
      });
      tagCoverageMap[tag.id] = hasEvidence;
      if (hasEvidence) tagsWithEvidence++;
    });
    var tagCoveragePct = allTags.length > 0 ? Math.round((tagsWithEvidence / allTags.length) * 100) : 0;

    // Core competency coverage
    var assessedCCs = new Set();
    assessments.forEach(function (a) {
      (a.coreCompetencyIds || []).forEach(function (ccId) {
        assessedCCs.add(ccId);
      });
    });
    var ccCounts = {};
    var ccAssessments = {};
    assessments.forEach(function (a) {
      (a.coreCompetencyIds || []).forEach(function (ccId) {
        ccCounts[ccId] = (ccCounts[ccId] || 0) + 1;
        if (!ccAssessments[ccId]) ccAssessments[ccId] = [];
        ccAssessments[ccId].push(a.title || 'Untitled');
      });
    });

    // Recent observations
    var weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    var weekAgoStr = weekAgo.toISOString().slice(0, 10);
    var recentObsCount = 0;
    allStudents.forEach(function (s) {
      var obs = getStudentQuickObs(cid, s.id);
      recentObsCount += obs.filter(function (o) {
        return o.date >= weekAgoStr;
      }).length;
    });

    // Action items
    var actionItems = [];

    var uncoveredTags = allTags.filter(function (t) {
      return !tagCoverageMap[t.id];
    });
    if (uncoveredTags.length > 0) {
      var secNames = [];
      var secNameSet = new Set();
      uncoveredTags.forEach(function (t) {
        var sec = getSectionForTag(cid, t.id);
        var name = sec ? sec.shortName || sec.name : '';
        if (name && !secNameSet.has(name)) {
          secNameSet.add(name);
          secNames.push(name);
        }
      });
      actionItems.push({
        text:
          uncoveredTags.length +
          ' learning standard' +
          (uncoveredTags.length !== 1 ? 's' : '') +
          ' not yet assessed (' +
          secNames.join(', ') +
          ')',
        link: '#/assignments?course=' + cid,
        linkText: 'Plan',
      });
    }

    var uncoveredCCs = CORE_COMPETENCIES.filter(function (cc) {
      return !assessedCCs.has(cc.id);
    });
    if (uncoveredCCs.length > 0) {
      actionItems.push({
        text:
          uncoveredCCs.length +
          ' core competenc' +
          (uncoveredCCs.length !== 1 ? 'ies' : 'y') +
          ' not yet tagged: ' +
          uncoveredCCs
            .map(function (cc) {
              return cc.label;
            })
            .join(', '),
        link: '#/assignments?course=' + cid,
        linkText: 'Tag',
      });
    }

    var lowCoverageStudents = allStudents.filter(function (s) {
      return getCompletionPct(cid, s.id) < 50;
    });
    if (lowCoverageStudents.length > 0) {
      actionItems.push({
        text:
          lowCoverageStudents.length +
          ' student' +
          (lowCoverageStudents.length !== 1 ? 's' : '') +
          ' below 50% evidence coverage',
        link: '',
        linkText: '',
      });
    }

    if (recentObsCount === 0) {
      actionItems.push({
        text: 'No observations recorded this week',
        link: '#/observations',
        linkText: 'Observe',
      });
    }

    var unobservedStudents = allStudents.filter(function (s) {
      return getStudentQuickObs(cid, s.id).length === 0;
    });
    if (unobservedStudents.length > 0) {
      actionItems.push({
        text:
          unobservedStudents.length +
          ' student' +
          (unobservedStudents.length !== 1 ? 's have' : ' has') +
          ' no observations yet',
        link: '#/observations',
        linkText: 'Observe',
      });
    }

    /* -- Toolbar (rendered to separate mount) -- */
    document.getElementById('page-toolbar-mount').innerHTML = Overview.renderDashToolbar({
      activeCourse: activeCourse,
      sortMode: sortMode,
      searchQuery: searchQuery,
      showFlaggedOnly: showFlaggedOnly,
      students: students,
      flagCount: flagCount,
    });

    /* -- Overview Panel -- */
    var html = '';
    html += Overview.renderOverviewPanel({
      cid: cid,
      sections: sections,
      allStudents: allStudents,
      assessments: assessments,
      classAvg: classAvg,
      classR: classR,
      tagCoveragePct: tagCoveragePct,
      sectionClassAvgs: sectionClassAvgs,
      tagsWithEvidence: tagsWithEvidence,
      allTags: allTags,
      tagCoverageMap: tagCoverageMap,
      assessedCCs: assessedCCs,
      ccCounts: ccCounts,
      ccAssessments: ccAssessments,
      actionItems: actionItems,
      obs: _obsState(),
      classChange: classGradeChange(
        cid,
        allStudents.map(function (s) {
          return s.id;
        }),
      ),
      mixPop: mixPop,
      helpRule: helpRule,
      helpRuleOpen: helpRuleOpen,
      naFilter: naFilter,
      naComp: naComp,
    });
    obsHighlight = _lastObsState.highlight;

    /* -- Students: cards or the grid -- */
    if (allStudents.length) html += DashInsights.studentsHeaderHtml(studentView, namesHidden);
    if (studentView === 'grid' && students.length) html += DashInsights.studentGridHtml(cid, students, allStudents);
    else html += StudentCards.renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags);

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
    document.getElementById('main').innerHTML = html;
    _afterObsRender(null, 0);
    _placeMixPop();

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
      namesHidden: namesHidden,
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

  /* Re-render only the Observations card (tabs, flags, Hide names). */
  function renderObsCard(focusKey, depth) {
    var card = _obsCard();
    if (!card) return;
    _hidePop();
    var st = _obsState();
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

  function _setNamesHidden(hidden) {
    namesHidden = !!hidden;
    _writePref(HIDE_NAMES_KEY, namesHidden ? '1' : null);
    document.body.classList.toggle('fv-names-hidden', namesHidden);
    _hidePop();
    // The Students heading has its own Hide Names button.
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="studentNames"]'), function (b) {
      b.setAttribute('aria-pressed', String(namesHidden));
      b.textContent = namesHidden ? 'Show Names' : 'Hide Names';
    });
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
    // While names are hidden the notes stay closed; they can name students.
    if (isCell && namesHidden) return;
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
  }
  function _onMouseout(e) {
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

  /* ── Student Management ─────────────────────────────────── */

  /* After a Needs Attention change: focus back on the control used, or, from
     the top bar, bring the card into view and focus its list. */
  function _focusNa(selector) {
    var el = selector ? document.querySelector(selector) : null;
    if (el) {
      el.focus();
      return;
    }
    var card = document.getElementById('dash-na-card');
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
    var list = card.querySelector('.dash-na-list');
    if (list) list.focus({ preventScroll: true });
  }

  /* ── Delegated click handler ────────────────────────────── */
  function _handleClick(e) {
    // A click outside the open segment list closes it.
    if (mixPop && !e.target.closest('#dash-mix-pop, .dash-mix-seg')) _closeMixPop();
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();

    // Delegate cm/cw actions to class manager submodule
    if (CM.handleAction(action, el, e)) return;

    // Dashboard-only actions
    var handlers = {
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
      obsNames: function () {
        _setNamesHidden(!namesHidden);
        renderObsCard('names');
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
      mixClose: function () {
        var was = _closeMixPop();
        var seg =
          was && document.querySelector('.dash-mix-seg[data-key="' + was.key + '"][data-level="' + was.level + '"]');
        if (seg) seg.focus();
      },
      helpRule: function () {
        helpRuleOpen = !helpRuleOpen;
        render();
      },
      naFilter: function () {
        naFilter = el.dataset.filter || 'all';
        naComp = null;
        var fromTop = !!el.closest('.dash-glance');
        render();
        _focusNa(fromTop ? null : '[data-action="naFilter"][data-filter="' + naFilter + '"]');
      },
      naComp: function () {
        var key = el.dataset.key || null;
        naComp = key && key !== naComp ? key : null;
        render();
        _focusNa(
          naComp
            ? '.dash-mix-below[data-key="' + naComp + '"]'
            : key
              ? '.dash-mix-below[data-key="' + key + '"]'
              : '[data-action="naFilter"][data-filter="' + naFilter + '"]',
        );
      },
      studentView: function () {
        studentView = el.dataset.view === 'grid' ? 'grid' : 'cards';
        saveDashboardPrefs({ studentView: studentView });
        render();
      },
      studentNames: function () {
        _setNamesHidden(!namesHidden);
        renderObsCard(null);
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
      render();
      return;
    }
    if (el.dataset.action === 'helpRuleBelow' || el.dataset.action === 'helpRuleMin') {
      if (el.dataset.action === 'helpRuleBelow') helpRule.below = Number(el.value);
      else helpRule.min = Number(el.value);
      saveDashboardPrefs({ helpRule: { below: helpRule.below, min: helpRule.min } });
      render();
      var again = document.querySelector('[data-action="' + el.dataset.action + '"]');
      if (again) again.focus();
      return;
    }
    // Delegate cm/cw change handlers
    CM.handleChange(el);
  }

  function _handleBlur(e) {
    CM.handleBlur(e.target);
  }

  function _handleKeydown(e) {
    if (e.key === 'Escape' && mixPop) {
      var was = _closeMixPop();
      var seg = document.querySelector('.dash-mix-seg[data-key="' + was.key + '"][data-level="' + was.level + '"]');
      if (seg) seg.focus();
      return;
    }
    if (_obsKeydown(e)) return;
    CM.handleKeydown(e);
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
    namesHidden = _readPref(HIDE_NAMES_KEY) === '1';
    document.body.classList.toggle('fv-names-hidden', namesHidden);
    var dashPrefs = getDashboardPrefs();
    studentView = dashPrefs.studentView === 'grid' ? 'grid' : 'cards';
    helpRule = DashInsights.readRule(dashPrefs.helpRule);
    helpRuleOpen = false;
    mixPop = null;
    naFilter = 'all';
    naComp = null;
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
    document.body.classList.remove('fv-names-hidden');
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
    switchCourse: switchCourse,
  };
})();
