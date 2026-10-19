/* dash-student-cards.js — Dashboard student card rendering helpers */
window.DashStudentCards = (function () {
  'use strict';

  var trendIcon = {
    up: '<span style="color:var(--score-3);font-size:0.85rem">&#x2191;</span>',
    down: '<span style="color:var(--score-1);font-size:0.85rem">&#x2193;</span>',
    flat: '<span style="color:var(--text-3);font-size:0.85rem">&#x2192;</span>',
  };

  // A competency or group value in a small tile, as the class shows grades
  // (formatLevel). The % sign is set smaller so "100%" fits where "4.0" did.
  function _tileValue(cid, value) {
    return esc(formatLevel(cid, value)).replace(/%/g, '<span class="dash-pct">%</span>');
  }

  function standardLabel(sec) {
    var tag = sec && sec.tags && sec.tags[0];
    return (tag && (tag.code || tag.label || tag.shortName || tag.name)) || (sec && (sec.shortName || sec.name)) || '';
  }

  var DAY_MS = 86400000;
  function _dayNum(dateStr) {
    return Math.floor(Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
  }
  function _obDay(o) {
    return (o && (o.date || (o.created || '').slice(0, 10))) || '';
  }

  /* The card's observation line: the three newest types, days since the
     last one (amber at 3+ weeks, the dashboard's overdue rule), and how many
     this term, or in all, when no term is active.
       obs    the student's observations, newest first
       term   getActiveTerm(cid): { startsOn, endsOn } or null */
  function obsSummary(obs, todayStr, term) {
    obs = obs || [];
    var dated = obs.map(function (o) {
      return Object.assign({}, o, { date: _obDay(o) });
    });
    var last = DashOverview.obsLastDate(dated);
    var inTerm =
      term && term.startsOn && term.endsOn
        ? dated.filter(function (o) {
            return o.date >= term.startsOn && o.date <= term.endsOn;
          })
        : dated;
    return {
      dots: obs.slice(0, 3).map(function (o) {
        return o.sentiment && OBS_SENTIMENTS[o.sentiment] ? o.sentiment : 'none';
      }),
      daysSince: last ? Math.max(0, _dayNum(todayStr) - _dayNum(last)) : null,
      overdue: obs.length > 0 && DashOverview.obsIsOverdue(dated, todayStr),
      count: inTerm.length,
      inTerm: !!(term && term.startsOn && term.endsOn),
    };
  }

  function obsWhenText(daysSince) {
    if (daysSince == null) return 'No observations yet';
    if (daysSince === 0) return 'Last observed today';
    if (daysSince === 1) return 'Last observed yesterday';
    return 'Last observed ' + daysSince + ' days ago';
  }

  function obsLineHtml(sum) {
    if (sum.daysSince == null) return '<span class="dash-obs-when">No observations yet</span>';
    var label = sum.dots
      .map(function (t) {
        return t === 'none' ? 'no type' : OBS_SENTIMENTS[t].label.toLowerCase();
      })
      .join(', ');
    return (
      '<span class="dash-obs-dots" role="img" aria-label="Newest: ' +
      esc(label) +
      '">' +
      sum.dots
        .map(function (t) {
          return '<span class="dash-obs-dot" data-type="' + t + '"></span>';
        })
        .join('') +
      '</span>' +
      '<span class="dash-obs-when' +
      (sum.overdue ? ' is-overdue' : '') +
      '">' +
      esc(obsWhenText(sum.daysSince)) +
      '</span>' +
      '<span class="dash-obs-count">\u00b7 ' +
      sum.count +
      (sum.inTerm ? ' this term' : ' in all') +
      '</span>'
    );
  }

  function renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags) {
    var html = '<div class="dash-section">';
    if (students.length === 0 && allStudents.length === 0) {
      html +=
        '<div class="dash-empty">' +
        '<div class="dash-empty-title">No students yet</div>' +
        '<div class="dash-empty-text">Add your first student or import a class roster to get started.</div>' +
        '</div>';
    } else if (students.length === 0) {
      html +=
        '<div class="dash-empty">' +
        '<div class="dash-empty-title">No matches</div>' +
        '<div class="dash-empty-text">Try adjusting your search or filters.</div>' +
        '</div>';
    } else {
      html += '<div class="dash-grid">';
      students.forEach(function (st) {
        var overall = getOverallProficiency(cid, st.id);
        // The badge shows the grade as the class is set to grade.
        var grade = studentGradeSummary(cid, st.id);
        var op = grade.level;
        var flagged = isStudentFlagged(cid, st.id);
        var pct = getCompletionPct(cid, st.id);

        var missingCount = assessments.filter(function (a) {
          if (!a.dueDate || new Date(a.dueDate) >= new Date()) return false;
          var sc = allScores[st.id] || [];
          return !sc.some(function (x) {
            return x.assessmentId === a.id && x.score > 0;
          });
        }).length;

        var allSc = (allScores[st.id] || []).filter(function (sc) {
          return sc.score > 0;
        });
        var trend = 'flat';
        if (allSc.length >= 4) {
          allSc.sort(function (a, b) {
            return (a.date || '').localeCompare(b.date || '');
          });
          var mid = Math.floor(allSc.length / 2);
          var earlyAvg =
            allSc.slice(0, mid).reduce(function (a, b) {
              return a + scoreModValue(b);
            }, 0) / mid;
          var lateAvg =
            allSc.slice(mid).reduce(function (a, b) {
              return a + scoreModValue(b);
            }, 0) /
            (allSc.length - mid);
          if (lateAvg > earlyAvg + 0.2) trend = 'up';
          else if (lateAvg < earlyAvg - 0.2) trend = 'down';
        }

        var obsText = obsLineHtml(obsSummary(getStudentQuickObs(cid, st.id), getTodayStr(), getActiveTerm(cid)));

        html +=
          '<div class="dash-card' +
          (flagged ? ' flagged' : '') +
          '" data-action="goToStudent" data-sid="' +
          st.id +
          '" data-course="' +
          cid +
          '">';

        html +=
          '<div class="dash-card-header">' +
          '<button class="dash-flag-btn" data-action="toggleFlag" data-cid="' +
          cid +
          '" data-sid="' +
          st.id +
          '" data-stop-prop="true" title="Flag student" aria-label="Flag student" style="color:' +
          (flagged ? 'var(--priority)' : 'var(--text-2)') +
          '">' +
          (flagged ? '\u2691' : '\u2690') +
          '</button>' +
          '<div class="dash-card-info">' +
          '<div class="dash-card-name-row">' +
          '<a class="dash-card-name" href="#/student?id=' +
          st.id +
          '&course=' +
          cid +
          '" data-stop-prop="true">' +
          esc(displayName(st)) +
          '</a>' +
          ((st.designations || []).length > 0
            ? (function () {
                var dh = '<div class="dash-desig-wrap">';
                var hasIep = false;
                var hasMod = false;
                (st.designations || []).forEach(function (code) {
                  var d = designationInfo(code);
                  if (!d) return;
                  dh +=
                    '<span class="dash-desig-badge' +
                    (d.level > 0 ? ' low-inc' : '') +
                    '" title="' +
                    code +
                    ' \u2014 ' +
                    d.name +
                    '">' +
                    code +
                    '</span>';
                  if (d.iep) hasIep = true;
                  if (d.modified) hasMod = true;
                });
                if (hasIep) dh += '<span class="dash-iep-tag">IEP</span>';
                if (hasMod) dh += '<span class="dash-mod-tag">MOD</span>';
                dh += '</div>';
                return dh;
              })()
            : '') +
          '</div>' +
          (st.pronouns ? '<div class="dash-card-pronouns">' + esc(st.pronouns) + '</div>' : '') +
          (st.studentNumber
            ? '<div class="dash-card-stunum" style="font-size:0.6rem;color:var(--text-3);font-family:\'SF Mono\',ui-monospace,monospace">#' +
              esc(st.studentNumber) +
              '</div>'
            : '') +
          '</div>' +
          '<div class="dash-card-badge" style="background:' +
          PROF_TINT[op] +
          '">' +
          '<div class="dash-card-badge-num" style="color:' +
          PROF_COLORS[op] +
          '">' +
          (grade.text || '\u2014') +
          '</div>' +
          '<div class="dash-card-badge-label" style="color:' +
          PROF_COLORS[op] +
          '">' +
          levelWord(cid, overall) +
          '</div>' +
          '</div>' +
          (missingCount > 0
            ? '<span class="dash-card-missing" title="' +
              missingCount +
              ' past-due unscored">\u26A0\uFE0E' +
              missingCount +
              '</span>'
            : '') +
          '</div>';

        html +=
          '<div class="dash-card-sections' +
          (courseGradeMode(cid) === 'proficiency' ? '' : ' dash-card-sections-pct') +
          '">';
        var grouped = getGroupedSections(cid);
        if (grouped.groups.length > 0) {
          grouped.groups.forEach(function (gi) {
            if (gi.sections.length === 0) return;
            var groupVal = getGroupProficiency(cid, st.id, gi.group.id);
            var gr = Math.round(groupVal);
            html +=
              '<div class="dash-section-mini" style="background:' +
              PROF_TINT[gr] +
              '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' +
              gi.group.color +
              '"></div>' +
              '<div class="dash-section-name">' +
              esc(gi.group.name) +
              '</div>' +
              '<div class="dash-section-val" style="color:' +
              PROF_COLORS[gr] +
              '">' +
              _tileValue(cid, groupVal) +
              '</div>' +
              '</div>';
          });
          grouped.ungrouped.forEach(function (sec) {
            var secVal = getSectionProficiency(cid, st.id, sec.id);
            var sr = Math.round(secVal);
            var secLabel = standardLabel(sec);
            html +=
              '<div class="dash-section-mini" style="background:' +
              PROF_TINT[sr] +
              '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' +
              sec.color +
              '"></div>' +
              '<div class="dash-section-name">' +
              esc(secLabel) +
              '</div>' +
              '<div class="dash-section-val" style="color:' +
              PROF_COLORS[sr] +
              '">' +
              _tileValue(cid, secVal) +
              '</div>' +
              '</div>';
          });
        } else {
          sections.forEach(function (sec) {
            var secVal = getSectionProficiency(cid, st.id, sec.id);
            var secRounded = Math.round(secVal);
            var secLabel = standardLabel(sec);
            html +=
              '<div class="dash-section-mini" style="background:' +
              PROF_TINT[secRounded] +
              '">' +
              '<div style="position:absolute;top:0;left:4px;right:4px;height:3px;border-radius:2px;background:' +
              sec.color +
              '"></div>' +
              '<div class="dash-section-name">' +
              esc(secLabel) +
              '</div>' +
              '<div class="dash-section-val" style="color:' +
              PROF_COLORS[secRounded] +
              '">' +
              _tileValue(cid, secVal) +
              '</div>' +
              '</div>';
          });
        }
        html += '</div>';

        html +=
          '<div class="dash-card-footer">' +
          '<div class="dash-card-meta">' +
          '<span style="color:' +
          (pct >= 75 ? 'var(--score-3)' : pct >= 50 ? 'var(--score-2)' : 'var(--score-1)') +
          '">' +
          pct +
          '%</span>' +
          trendIcon[trend] +
          '</div>' +
          '<div class="dash-card-obs">' +
          obsText +
          '</div>' +
          '</div>';

        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  return {
    renderStudentCards: renderStudentCards,
    obsSummary: obsSummary,
    obsWhenText: obsWhenText,
  };
})();
