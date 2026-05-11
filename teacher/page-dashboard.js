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
    setActiveCourse(cid);
    // Reset class manager state for new course
    CM.configure({ activeCourse: cid, onRender: render, onCourseChange: switchCourse });
    CM.resetState();
    await withSwitchingLock(() => initData(cid));
    render();
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
    var cid = activeCourse;
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
        students.sort(function (a, b) {
          return getOverallProficiency(cid, b.id) - getOverallProficiency(cid, a.id);
        });
        break;
      case 'overall-asc':
        students.sort(function (a, b) {
          var pa = getOverallProficiency(cid, a.id);
          var pb = getOverallProficiency(cid, b.id);
          if (pa === 0 && pb === 0) return 0;
          if (pa === 0) return 1;
          if (pb === 0) return -1;
          return pa - pb;
        });
        break;
      case 'flagged':
        students.sort(function (a, b) {
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
        icon: '\uD83D\uDCCB',
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
        icon: '\uD83C\uDFAF',
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
        icon: '\u26A0\uFE0F',
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
        icon: '\uD83D\uDCDD',
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
        icon: '\uD83D\uDC64',
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
      recentObsCount: recentObsCount,
      flagCount: flagCount,
      actionItems: actionItems,
    });

    // Birthday Widget
    html += '</div>'; // close dash-section

    /* -- Student Card Grid -- */
    html += StudentCards.renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags);

    document.getElementById('main').innerHTML = html;

    // Restore sort dropdown
    var sortSelect = document.querySelector('.dash-sort-select');
    if (sortSelect) sortSelect.value = sortMode;
  }

  /* ── Student Management ─────────────────────────────────── */

  /* ── Delegated click handler ────────────────────────────── */
  function _handleClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();

    // Delegate cm/cw actions to class manager submodule
    if (CM.handleAction(action, el, e)) return;

    // Dashboard-only actions
    var handlers = {
      goToStudent: function () {
        Router.navigate('/student?id=' + el.dataset.sid + '&course=' + el.dataset.course);
      },
      toggleFlag: function () {
        toggleFlag(el.dataset.cid, el.dataset.sid);
        render();
      },
      toggleFlaggedFilter: function () {
        showFlaggedOnly = !showFlaggedOnly;
        render();
      },
      dashSort: function () {
        sortMode = el.value;
        render();
      },
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
    // Delegate cm/cw change handlers
    CM.handleChange(el);
  }

  function _handleBlur(e) {
    CM.handleBlur(e.target);
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    // Reset state
    activeCourse = getActiveCourse();
    showFlaggedOnly = false;
    sortMode = 'last-asc';
    searchQuery = '';
    CM.configure({ activeCourse: activeCourse, onRender: render, onCourseChange: switchCourse });
    CM.resetState();

    // Dashboard has no sidebar
    document.getElementById('page-layout').classList.add('sidebar-hidden');
    document.getElementById('sidebar-mount').style.display = 'none';

    // Add page-specific class for scoped CSS
    document.getElementById('main').classList.add('page-dashboard');

    // Hide sidebar toggle in dock
    var sidebarBtn = document.querySelector('.tb-btn');
    if (sidebarBtn) sidebarBtn.style.display = 'none';

    // Expose switchCourse globally for dock course selector
    window._pageSwitchCourse = switchCourse;

    // Add delegated listeners
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('blur', _handleBlur, true); // blur doesn't bubble, use capture
    CM.initDrag();

    render();

    // Ensure page starts at top
    requestAnimationFrame(function () {
      document.getElementById('main').scrollTop = 0;
    });
  }

  function destroy() {
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
