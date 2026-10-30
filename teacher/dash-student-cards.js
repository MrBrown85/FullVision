/* dash-student-cards.js — Dashboard student card rendering helpers */
window.DashStudentCards = (function () {
  'use strict';

  var trendIcon = {
    up: '<span style="color:var(--score-3);font-size:0.9375rem">&#x2191;</span>',
    down: '<span style="color:var(--score-1);font-size:0.9375rem">&#x2193;</span>',
    flat: '<span style="color:var(--text-3);font-size:0.9375rem">&#x2192;</span>',
  };

  var GLYPHS = { 1: '○', 2: '◐', 3: '●', 4: '◆' };

  // A competency's full name for its segment's tooltip.
  function standardTitle(sec) {
    var tag = sec && sec.tags && sec.tags[0];
    var name = (sec && sec.name) || '';
    var label = tag && tag.label && tag.label !== name ? tag.label : '';
    return label ? name + ' \u2014 ' + label : name;
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

        // Work labelled Missing, whatever its due date.
        var missingCount = assessments.filter(function (a) {
          return getAssignmentStatus(cid, st.id, a.id) === 'NS';
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

        var prof = courseGradeMode(cid) !== 'letter';
        var word = levelWord(cid, overall);
        html +=
          '<div class="dash-card-header">' +
          '<span class="dash-card-avatar" aria-hidden="true" style="background:' +
          _avatarColor(st.id) +
          '">' +
          esc(initials(st)) +
          '</span>' +
          '<div class="dash-card-info">' +
          '<div class="dash-card-name-row">' +
          '<a class="dash-card-name" role="link" tabindex="0" data-href="/student?id=' +
          st.id +
          '&course=' +
          cid +
          '" data-stop-prop="true">' +
          esc(displayNameWithLast(st)) +
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
          (st.pronouns || st.studentNumber
            ? '<div class="dash-card-sub">' +
              (st.pronouns ? '<span class="dash-card-pronouns">' + esc(st.pronouns) + '</span>' : '') +
              (st.studentNumber ? '<span class="dash-card-stunum">#' + esc(st.studentNumber) + '</span>' : '') +
              '</div>'
            : '') +
          '</div>' +
          '<span class="dash-card-badge' +
          (op ? '' : ' is-none') +
          '"' +
          (op ? ' style="background:var(--score-' + op + '-bg);color:var(--score-' + op + '-text)"' : '') +
          ' role="img" aria-label="' +
          esc('Overall ' + (grade.text || 'not yet graded') + (word ? ' ' + word : '')) +
          '"' +
          (word ? ' title="' + esc(word) + '"' : '') +
          '>' +
          (prof && GLYPHS[op] ? GLYPHS[op] + ' ' : '') +
          esc(grade.text || '\u2014') +
          '</span>' +
          (missingCount > 0
            ? '<span class="dash-card-missing" title="' +
              missingCount +
              ' labelled Missing">\u26A0\uFE0E' +
              missingCount +
              '</span>'
            : '') +
          '<button class="dash-flag-btn' +
          (flagged ? ' is-on' : '') +
          '" data-action="toggleFlag" data-cid="' +
          cid +
          '" data-sid="' +
          st.id +
          '" data-stop-prop="true" title="Flag student" aria-label="Flag student" aria-pressed="' +
          flagged +
          '">' +
          (flagged ? '\u2691' : '\u2690') +
          '</button>' +
          '</div>';

        // One segment per competency (or group), tinted by its proficiency;
        // its name and value are the tooltip. Evidence coverage and the trend
        // close the line. data-student-tab: the student page tab a click here
        // opens.
        var parts = [];
        var grouped = getGroupedSections(cid);
        if (grouped.groups.length > 0) {
          grouped.groups.forEach(function (gi) {
            if (gi.sections.length === 0) return;
            parts.push({ title: gi.group.name, value: getGroupProficiency(cid, st.id, gi.group.id) });
          });
          grouped.ungrouped.forEach(function (sec) {
            parts.push({ title: standardTitle(sec), value: getSectionProficiency(cid, st.id, sec.id) });
          });
        } else {
          sections.forEach(function (sec) {
            parts.push({ title: standardTitle(sec), value: getSectionProficiency(cid, st.id, sec.id) });
          });
        }
        html += '<div class="dash-card-strip" data-student-tab="comps">';
        parts.forEach(function (part) {
          var r = part.value > 0 ? Math.max(1, Math.min(4, Math.round(part.value))) : 0;
          var tip =
            part.title +
            ': ' +
            (r ? formatLevel(cid, part.value) + (prof ? ' ' + PROF_LABELS[r] : '') : 'not yet assessed');
          html +=
            '<span class="dash-card-seg" role="img" aria-label="' +
            esc(tip) +
            '" title="' +
            esc(tip) +
            '" style="background:' +
            (r ? 'var(--score-' + r + ')' : 'var(--divider-medium)') +
            '"></span>';
        });
        html +=
          '<span class="dash-card-meta" title="Evidence coverage">' +
          pct +
          '%' +
          trendIcon[trend] +
          '</span>' +
          '</div>';

        html +=
          '<div class="dash-card-footer">' +
          '<div class="dash-card-obs" data-student-tab="evidence">' +
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
