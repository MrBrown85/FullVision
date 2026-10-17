/* student-detail.js — Mobile student detail rendering helpers */
window.MStudentDetail = (function () {
  'use strict';

  var MC = window.MComponents;

  function _statCard(value, label, style) {
    return (
      '<div class="m-stat-card">' +
      '<div class="m-stat-value"' +
      (style ? ' style="' + style + '"' : '') +
      '>' +
      value +
      '</div>' +
      '<div class="m-stat-label">' +
      label +
      '</div></div>'
    );
  }

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

    var completionPct = getCompletionPct(cid, sid);
    var allTags = getAllTags(cid);
    var assessments = getAssessments(cid);
    var scores = getScores(cid)[sid] || [];
    var assessed = allTags.filter(function (t) {
      return scores.some(function (s) {
        return s.tagId === t.id && s.score > 0;
      });
    }).length;
    var statuses = getAssignmentStatuses(cid);
    var missingCount = assessments.filter(function (a) {
      return statuses[sid + ':' + a.id] === 'NS';
    }).length;
    var obsCount = getStudentQuickObs(cid, sid).length;

    var stats =
      '<div class="m-stats-strip">' +
      _statCard(MC.esc(gradeText), 'Overall') +
      _statCard(Math.round(completionPct) + '%', 'Complete') +
      _statCard(assessed + '/' + allTags.length, 'Assessed') +
      (missingCount > 0 ? _statCard(missingCount, 'Missing', 'color:var(--priority)') : '') +
      _statCard(obsCount, 'Notes') +
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

    var recentAssess = assessments
      .slice()
      .sort(function (a, b) {
        return b.date.localeCompare(a.date);
      })
      .slice(0, 5);

    var assessCards = '<div class="m-list-inset-header">Recent Assessments</div>';
    if (!recentAssess.length) {
      assessCards +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No assessments yet</div></div>';
    } else {
      recentAssess.forEach(function (a) {
        var dateStr = new Date(a.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        var badge = _assessmentBadgeData(cid, a);
        var status = statuses[sid + ':' + a.id];
        var statusBadge = '';
        if (status === 'NS')
          statusBadge =
            ' <span class="m-badge" style="background:var(--priority-light);color:var(--priority)">NS</span>';
        if (status === 'EXC')
          statusBadge = ' <span class="m-badge" style="background:var(--active-light);color:var(--active)">EXC</span>';

        var scoreChips = '';
        (a.tagIds || []).forEach(function (tid) {
          var tag = getTagById(cid, tid);
          var tagScores = scores.filter(function (s) {
            return s.assessmentId === a.id && s.tagId === tid;
          });
          var latest = tagScores.length ? tagScores[tagScores.length - 1] : null;
          var val = latest ? latest.score : null;
          var label = tag ? tag.shortName || tag.label || tag.code || '' : '?';
          scoreChips +=
            '<span class="m-assess-score-chip">' +
            '<span style="font-size:11px;color:var(--text-3)">' +
            MC.esc(label.substring(0, 8)) +
            '</span>' +
            '<span class="m-assess-score-val" style="color:' +
            MC.profBg(Math.round(val || 0)) +
            '">' +
            formatLevel(cid, val) +
            '</span>' +
            '</span>';
        });

        assessCards +=
          '<div class="m-assess-compact">' +
          '<div class="m-assess-top">' +
          '<span class="m-type-badge ' +
          badge.className +
          '">' +
          MC.esc(badge.label) +
          '</span>' +
          '<span class="m-assess-title">' +
          MC.esc(a.title) +
          statusBadge +
          '</span>' +
          '<span class="m-assess-date">' +
          dateStr +
          '</span>' +
          '</div>' +
          (scoreChips ? '<div class="m-assess-scores">' + scoreChips + '</div>' : '') +
          '</div>';
      });
    }

    var obs = getStudentQuickObs(cid, sid).slice(-3).reverse();
    var obsCards = '<div class="m-list-inset-header">Recent Observations</div>';
    if (!obs.length) {
      obsCards +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No observations yet</div></div>';
    } else {
      obs.forEach(function (ob) {
        var sentiment = OBS_SENTIMENTS[ob.sentiment] || {};
        var context = OBS_CONTEXTS[ob.context] || {};
        var tagChips = '';
        if (ob.dims && ob.dims.length) {
          ob.dims.forEach(function (dim) {
            var label = OBS_LABELS[dim] || dim;
            var icon = OBS_ICONS[dim] || '';
            tagChips += '<span class="m-obs-tag-chip">' + icon + ' ' + MC.esc(label) + '</span>';
          });
        }
        obsCards +=
          '<div class="m-obs-card" data-sentiment="' +
          (ob.sentiment || '') +
          '">' +
          '<div class="m-obs-header">' +
          '<span class="m-obs-sentiment-icon">' +
          (sentiment.icon || '') +
          '</span>' +
          (context.label
            ? '<span class="m-obs-context">' + (context.icon || '') + ' ' + context.label + '</span>'
            : '') +
          '<span class="m-obs-time">' +
          MC.relativeTime(ob.created) +
          '</span>' +
          '</div>' +
          '<div class="m-obs-text">' +
          MC.esc(ob.text) +
          '</div>' +
          (tagChips ? '<div class="m-obs-tags">' + tagChips + '</div>' : '') +
          '</div>';
      });
    }

    return (
      '<div class="m-screen m-screen-hidden" id="m-screen-student-detail">' +
      nav +
      '<div class="m-screen-content">' +
      hero +
      stats +
      focusHTML +
      '<div class="m-list-inset-header">Sections</div>' +
      sectionCards +
      assessCards +
      obsCards +
      '<div class="m-scard-actions" style="padding:0 16px 16px">' +
      '<button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' +
      sid +
      '">Observe</button>' +
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
  };
})();
