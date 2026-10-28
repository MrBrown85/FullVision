/* student-detail.js — Mobile student detail rendering helpers */
window.MStudentDetail = (function () {
  'use strict';

  var MC = window.MComponents;

  function _assessmentBadgeData(cid, assessment) {
    var categoryId = getAssessmentCategoryId(assessment);
    return {
      label: getAssessmentCategoryName(cid, assessment),
      className:
        categoryId || (assessment && assessment.type === 'summative') ? 'm-type-summative' : 'm-type-formative',
    };
  }

  function _renderSectionCard(cid, sid, sec) {
    var prof = getSectionProficiency(cid, sid, sec.id);
    var profRounded = Math.round(prof);
    var trend = getSectionTrend(cid, sid, sec.id);
    var trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';
    var trendColor = trend === 'up' ? 'var(--score-3)' : trend === 'down' ? 'var(--score-1)' : 'var(--text-3)';
    var growthData = getSectionGrowthData(cid, sid, sec.id);
    var sparkline = renderGrowthSparkline(growthData);
    var allAssessments = getAssessments(cid);
    var allEvidenceScores = [];
    sec.tags.forEach(function (tag) {
      getTagScores(cid, sid, tag.id).forEach(function (s) {
        if (s.score > 0) allEvidenceScores.push(s);
      });
    });
    allEvidenceScores.sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });
    var recentScores = allEvidenceScores.slice(-5);

    var timelineHtml = '';
    if (recentScores.length === 0) {
      timelineHtml = '<div class="m-sec-empty">No evidence scored yet</div>';
    } else {
      timelineHtml = '<div class="m-sec-timeline">';
      recentScores.forEach(function (s) {
        var assess = allAssessments.find(function (a) {
          return a.id === s.assessmentId;
        });
        var assessName = assess ? MC.esc(assess.title) : '';
        var shortDate = new Date(s.date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        timelineHtml +=
          '<div class="m-sec-tl-item">' +
          '<div class="m-sec-tl-dot" style="background:' +
          MC.profBg(s.level || s.score) +
          '">' +
          (s.level ? formatScoreLevel(s.level, s.mod) : s.score) +
          '</div>' +
          '<div class="m-sec-tl-info">' +
          '<div class="m-sec-tl-name">' +
          assessName +
          '</div>' +
          '<div class="m-sec-tl-date">' +
          shortDate +
          ' · ' +
          PROF_LABELS[Math.round(s.score)] +
          '</div>' +
          '</div>' +
          '</div>';
      });
      timelineHtml += '</div>';
    }

    var insightHtml = '';
    if (allEvidenceScores.length >= 2) {
      var first = allEvidenceScores[0].score;
      var last = allEvidenceScores[allEvidenceScores.length - 1].score;
      var allSame = allEvidenceScores.every(function (s) {
        return s.score === first;
      });
      if (allSame) {
        insightHtml =
          '<div class="m-sec-insight">Consistently <strong>' +
          PROF_LABELS[Math.round(first)] +
          '</strong> across ' +
          allEvidenceScores.length +
          ' assessments</div>';
      } else if (last > first) {
        insightHtml =
          '<div class="m-sec-insight m-sec-insight-up">Improving from <strong>' +
          PROF_LABELS[Math.round(first)] +
          '</strong> → <strong>' +
          PROF_LABELS[Math.round(last)] +
          '</strong></div>';
      } else if (last < first) {
        insightHtml =
          '<div class="m-sec-insight m-sec-insight-down">Dropped from <strong>' +
          PROF_LABELS[Math.round(first)] +
          '</strong> → <strong>' +
          PROF_LABELS[Math.round(last)] +
          '</strong></div>';
      }
    } else if (allEvidenceScores.length === 0) {
      var secTagIds = new Set(
        sec.tags.map(function (t) {
          return t.id;
        }),
      );
      var secAssessments = allAssessments.filter(function (a) {
        return (a.tagIds || []).some(function (tid) {
          return secTagIds.has(tid);
        });
      });
      if (secAssessments.length > 0) {
        insightHtml =
          '<div class="m-sec-insight m-sec-insight-alert">' +
          secAssessments.length +
          ' assessment' +
          (secAssessments.length !== 1 ? 's' : '') +
          ' assigned but not yet scored</div>';
      }
    }

    return (
      '<div class="m-section-card" role="button" tabindex="0" aria-expanded="false" data-action="m-toggle-section" data-sec="' +
      sec.id +
      '">' +
      '<div class="m-section-header">' +
      '<div class="m-section-dot" style="background:' +
      (sec.color || '#888') +
      '"></div>' +
      '<div class="m-section-name">' +
      MC.esc(sec.shortName || sec.name) +
      '</div>' +
      sparkline +
      '<span class="m-section-trend" style="color:' +
      trendColor +
      '">' +
      trendIcon +
      '</span>' +
      '<span class="m-section-prof" style="color:' +
      MC.profBg(profRounded) +
      '">' +
      formatLevel(cid, prof) +
      '</span>' +
      '</div>' +
      '<div class="m-section-detail">' +
      timelineHtml +
      insightHtml +
      '</div>' +
      '</div>'
    );
  }

  /* ── Tabs: the same five as the desktop student page ──────── */
  var TABS = [
    { id: 'comps', label: 'Competencies' },
    { id: 'assess', label: 'Assessments' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'goals', label: 'Goals' },
    { id: 'profile', label: 'Learner Profile' },
  ];
  // Shared with the desktop page: the tab last opened on this device.
  var TAB_KEY = 'gb-student-tab';

  function _isTab(id) {
    return TABS.some(function (t) {
      return t.id === id;
    });
  }

  function savedTab() {
    try {
      var t = localStorage.getItem(TAB_KEY);
      return _isTab(t) ? t : 'comps';
    } catch (e) {
      return 'comps';
    }
  }

  function _obDay(ob) {
    return (ob && (ob.date || (ob.created || '').slice(0, 10))) || '';
  }

  function _obsInTerm(ob, term) {
    if (!term || !term.startsOn || !term.endsOn) return true;
    var d = _obDay(ob).slice(0, 10);
    return !!d && d >= term.startsOn && d <= term.endsOn;
  }

  function _shortDay(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  /* One assessment's score as the gradebook shows it: 65/80 · 81%, 3.3. */
  function _cellText(cell, a) {
    if (cell.kind === 'points') {
      var max = a.maxPoints || 100;
      return formatPoints(cell.value) + '/' + formatPoints(max) + ' · ' + formatPointsPercent(cell.value, max);
    }
    return cell.text;
  }

  function _tabBar(tabs, active) {
    return (
      '<div class="m-st-tabs" role="tablist" aria-label="Student details">' +
      tabs
        .map(function (t) {
          var on = t.id === active;
          return (
            '<button type="button" role="tab" class="m-st-tab' +
            (on ? ' active' : '') +
            '" data-action="m-student-tab" data-tab="' +
            t.id +
            '" aria-selected="' +
            on +
            '" aria-controls="m-st-panel-' +
            t.id +
            '"><span class="m-st-tab-label">' +
            MC.esc(t.label) +
            '</span><span class="m-st-tab-stat">' +
            MC.esc(t.stat) +
            '</span></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function _panel(id, active, html) {
    return (
      '<div class="m-st-panel" id="m-st-panel-' +
      id +
      '" role="tabpanel" data-tab="' +
      id +
      '"' +
      (id === active ? '' : ' hidden') +
      '>' +
      html +
      '</div>'
    );
  }

  /* Show one tab of the student screen that holds `el`. */
  function selectTab(el, id) {
    if (!_isTab(id)) return;
    var screen = el && el.closest ? el.closest('.m-screen') : null;
    if (!screen) return;
    screen.querySelectorAll('.m-st-tab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    screen.querySelectorAll('.m-st-panel').forEach(function (p) {
      p.hidden = p.getAttribute('data-tab') !== id;
    });
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch (e) {
      /* not remembered */
    }
  }

  function renderDetail(opts) {
    var cid = opts.cid;
    var sid = opts.sid;
    var renderBadges = opts.renderBadges;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return '<div class="m-screen"><div class="m-empty">Student not found</div></div>';

    var name = displayName(st);
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var overall = getOverallProficiency(cid, sid);
    var rounded = Math.round(overall);
    // The overall grade as the class is set to grade (level, letter, or both).
    var grade = studentGradeSummary(cid, sid);
    var gradeText = grade.text || '—';
    var nav = MC.navBar({ id: 'student-detail', title: name, backLabel: 'Students' });
    var badges = renderBadges(st);

    var hero =
      '<div class="m-hero">' +
      '<div class="m-hero-avatar" style="background:' +
      color +
      '">' +
      initials +
      '</div>' +
      '<div class="m-hero-name">' +
      MC.esc(name) +
      '</div>' +
      (st.pronouns ? '<div class="m-hero-pronouns">' + MC.esc(st.pronouns) + '</div>' : '') +
      (badges ? '<div class="m-hero-badges">' + badges + '</div>' : '') +
      '<div class="m-hero-prof' +
      (gradeText.length > 4 ? ' m-hero-grade-pill' : '') +
      '" style="background:' +
      MC.profBg(grade.level) +
      '">' +
      MC.esc(gradeText) +
      '</div>' +
      '<div class="m-hero-prof-label">' +
      (courseGradeMode(cid) === 'letter' ? 'Course grade' : PROF_LABELS[rounded] || 'No Evidence') +
      '</div>' +
      '</div>';

    var focusAreas = getFocusAreas(cid, sid, 3);
    var focusHTML = '';
    var hasFocus =
      focusAreas.some(function (f) {
        return f.prof > 0 && f.prof < 3;
      }) ||
      focusAreas.some(function (f) {
        return f.prof === 0;
      });
    if (hasFocus) {
      focusHTML = '<div class="m-list-inset-header">Focus Areas</div>';
      focusAreas.forEach(function (f) {
        var secColor = f.section ? f.section.color : '#888';
        var label = f.tag.label || f.tag.name || f.tag.shortName || f.tag.code || '';
        focusHTML +=
          '<div class="m-focus-row">' +
          '<span class="m-section-dot" style="background:' +
          secColor +
          '"></span>' +
          '<span class="m-focus-name">' +
          MC.esc(label) +
          '</span>' +
          '<span class="m-focus-prof" style="color:' +
          MC.profBg(Math.round(f.prof)) +
          '">' +
          formatLevel(cid, f.prof, 'No evidence') +
          '</span>' +
          '</div>';
      });
    }

    var grouped = getGroupedSections(cid);
    var sectionCards = '';
    if (grouped.groups.length) {
      grouped.groups.forEach(function (gi) {
        if (!gi.sections.length) return;
        var groupProf = getGroupProficiency(cid, sid, gi.group.id);
        var groupRounded = Math.round(groupProf);
        sectionCards +=
          '<div class="m-group-header">' +
          '<span class="m-group-name">' +
          MC.esc(gi.group.label || gi.group.name) +
          '</span>' +
          '<span class="m-group-prof" style="color:' +
          MC.profBg(groupRounded) +
          '">' +
          formatLevel(cid, groupProf) +
          '</span>' +
          '</div>';
        gi.sections.forEach(function (sec) {
          sectionCards += _renderSectionCard(cid, sid, sec);
        });
      });
      if (grouped.ungrouped.length) {
        grouped.ungrouped.forEach(function (sec) {
          sectionCards += _renderSectionCard(cid, sid, sec);
        });
      }
    } else {
      getSections(cid).forEach(function (sec) {
        sectionCards += _renderSectionCard(cid, sid, sec);
      });
    }

    // Everything below follows the class's chosen reporting term.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var inTerm = function (a) {
      return typeof assessmentInActiveTerm !== 'function' || assessmentInActiveTerm(cid, a);
    };
    var sections = getSections(cid);
    var statuses = getAssignmentStatuses(cid);
    var termAssess = getAssessments(cid)
      .filter(inTerm)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    var cells = termAssess.map(function (a) {
      return { a: a, cell: assessmentCellValue(cid, sid, a) };
    });
    var obs = getStudentQuickObs(cid, sid).filter(function (o) {
      return _obsInTerm(o, term);
    });

    // Assessments
    var scoredN = cells.filter(function (c) {
      return c.cell.kind === 'points' || c.cell.kind === 'level' || c.cell.kind === 'complete';
    }).length;
    var nsN = termAssess.filter(function (a) {
      return statuses[sid + ':' + a.id] === 'NS';
    }).length;
    var assessHtml = '';
    if (nsN) assessHtml += '<div class="m-st-note m-st-note-warn">' + nsN + ' missing</div>';
    if (!cells.length) {
      assessHtml +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No assessments yet</div></div>';
    }
    cells.forEach(function (c) {
      var a = c.a;
      var badge = _assessmentBadgeData(cid, a);
      var status = statuses[sid + ':' + a.id];
      var toward = [];
      (a.tagIds || []).forEach(function (tid) {
        var tag = getTagById(cid, tid);
        var name = tag ? tag.label || tag.shortName || tag.code || '' : '';
        if (name && toward.indexOf(name) < 0) toward.push(name);
      });
      assessHtml +=
        '<div class="m-assess-compact">' +
        '<div class="m-assess-top">' +
        '<span class="m-assess-date">' +
        MC.esc(_shortDay(a.date)) +
        '</span>' +
        '<span class="m-assess-title">' +
        MC.esc(a.title) +
        (status === 'NS'
          ? ' <span class="m-badge" style="background:var(--priority-light);color:var(--priority)">M</span>'
          : status === 'EXC'
            ? ' <span class="m-badge" style="background:var(--active-light);color:var(--link)">EXC</span>'
            : '') +
        '</span>' +
        '<span class="m-st-score m-st-level-' +
        (c.cell.level > 0 ? c.cell.level : 0) +
        '">' +
        MC.esc(_cellText(c.cell, a)) +
        '</span>' +
        '</div>' +
        '<div class="m-st-assess-sub"><span class="m-type-badge ' +
        badge.className +
        '">' +
        MC.esc(badge.label) +
        '</span>' +
        (toward.length ? '<span class="m-st-toward">' + MC.esc(toward.join(', ')) + '</span>' : '') +
        '</div>' +
        '</div>';
    });

    // Evidence
    var evidenceHtml =
      '<div class="m-scard-actions" style="padding:12px 16px 4px"><button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' +
      sid +
      '">Observe</button></div>';
    if (!obs.length) {
      evidenceHtml +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No observations yet</div></div>';
    } else {
      var obsCtx = ObsCard.context(cid);
      obs.forEach(function (ob) {
        evidenceHtml += MObserve.cardHtml(cid, Object.assign({ studentId: sid }, ob), obsCtx, {
          showStudent: false,
          when: 'date',
          editable: false,
        });
      });
    }

    // Goals and Reflections
    var goals = (typeof getGoals === 'function' && getGoals(cid)[sid]) || {};
    var refl = (typeof getReflections === 'function' && getReflections(cid)[sid]) || {};
    var goalCount = 0;
    var first = MC.esc(displayNameFirst(st));
    var goalsHtml = '';
    sections.forEach(function (sec) {
      var g = (goals[sec.id] || '').trim();
      var r = refl[sec.id] || {};
      if (g) goalCount++;
      var conf = r.confidence && typeof CONFIDENCE_LABELS !== 'undefined' ? CONFIDENCE_LABELS[r.confidence] : '';
      goalsHtml +=
        '<div class="m-st-goal">' +
        '<div class="m-st-goal-name">' +
        MC.esc(sec.name) +
        '</div>' +
        '<div class="m-st-goal-label">Goal</div>' +
        '<div class="m-st-goal-text">' +
        (g ? MC.esc(g) : '<span class="m-st-muted">No goal set.</span>') +
        '</div>' +
        '<div class="m-st-goal-label">In ' +
        first +
        '’s Words' +
        (conf ? ' · ' + MC.esc(conf) : '') +
        '</div>' +
        '<div class="m-st-goal-text">' +
        (r.text ? MC.esc(r.text) : '<span class="m-st-muted">No self-reflection yet.</span>') +
        '</div>' +
        '</div>';
    });

    // Learner Profile
    var dimGroups = [
      { name: 'Learning Dispositions', dims: typeof LEARNING_DIMS !== 'undefined' ? LEARNING_DIMS : [] },
      { name: 'Relational and Identity', dims: typeof RELATIONAL_DIMS !== 'undefined' ? RELATIONAL_DIMS : [] },
    ];
    var seen = 0;
    var allDims = 0;
    var profileHtml = '';
    dimGroups.forEach(function (gp) {
      profileHtml += '<div class="m-list-inset-header">' + MC.esc(gp.name) + '</div><div class="m-st-list">';
      gp.dims.forEach(function (d) {
        allDims++;
        var tagged = obs.filter(function (o) {
          return (o.dims || []).indexOf(d) >= 0;
        });
        if (tagged.length) seen++;
        var latest = tagged[0];
        profileHtml +=
          '<div class="m-st-dim' +
          (tagged.length ? '' : ' unseen') +
          '"><div class="m-st-dim-text"><span class="m-st-dim-name">' +
          MC.esc(OBS_LABELS[d] || d) +
          '</span><span class="m-st-dim-latest">' +
          (latest
            ? MC.esc(_shortDay(_obDay(latest)) + ', ' + String(latest.text || '').split('\n')[0])
            : 'Not seen yet') +
          '</span></div><span class="m-st-dim-count">' +
          tagged.length +
          '</span></div>';
      });
      profileHtml += '</div>';
    });

    var profs = sections
      .map(function (sec) {
        return getSectionProficiency(cid, sid, sec.id);
      })
      .filter(function (v) {
        return v > 0;
      });
    var atProf = profs.filter(function (v) {
      return Math.round(v) >= 3;
    }).length;
    var tabs = [
      {
        id: 'comps',
        label: 'Competencies',
        stat: !profs.length
          ? 'Not Scored'
          : courseGradeMode(cid) === 'letter'
            ? profs.length + ' of ' + sections.length + ' Scored'
            : atProf + ' of ' + sections.length + ' Proficient',
      },
      { id: 'assess', label: 'Assessments', stat: scoredN + ' Scored' },
      { id: 'evidence', label: 'Evidence', stat: obs.length + (obs.length === 1 ? ' Observation' : ' Observations') },
      { id: 'goals', label: 'Goals', stat: goalCount + ' of ' + sections.length + ' Set' },
      { id: 'profile', label: 'Learner Profile', stat: seen + ' of ' + allDims + ' Seen' },
    ];
    var activeTab = savedTab();
    var tabsBlock =
      _tabBar(tabs, activeTab) +
      _panel('comps', activeTab, focusHTML + '<div class="m-list-inset-header">Competencies</div>' + sectionCards) +
      _panel('assess', activeTab, '<div class="m-st-list">' + assessHtml + '</div>') +
      _panel('evidence', activeTab, evidenceHtml) +
      _panel('goals', activeTab, '<div class="m-st-list">' + goalsHtml + '</div>') +
      _panel('profile', activeTab, profileHtml);

    return (
      '<div class="m-screen m-screen-hidden" id="m-screen-student-detail">' +
      nav +
      '<div class="m-screen-content">' +
      hero +
      tabsBlock +
      '<div class="m-scard-actions" style="padding:16px">' +
      '<button class="m-scard-btn m-scard-btn-view" data-action="m-student-grade" data-sid="' +
      sid +
      '">Grade</button>' +
      '</div>' +
      '<div style="height:32px"></div>' +
      '</div></div>'
    );
  }

  return {
    renderDetail: renderDetail,
    selectTab: selectTab,
  };
})();
