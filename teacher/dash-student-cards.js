/* dash-student-cards.js — Dashboard student card rendering helpers */
window.DashStudentCards = (function () {
  'use strict';

  var trendIcon = {
    up: '<span style="color:var(--score-3);font-size:0.85rem">&#x2191;</span>',
    down: '<span style="color:var(--score-1);font-size:0.85rem">&#x2193;</span>',
    flat: '<span style="color:var(--text-3);font-size:0.85rem">&#x2192;</span>',
  };

  function standardLabel(sec) {
    var tag = sec && sec.tags && sec.tags[0];
    return (tag && (tag.code || tag.label || tag.shortName || tag.name)) || (sec && (sec.shortName || sec.name)) || '';
  }

  function renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags) {
    var html = '<div class="dash-section">';
    if (students.length === 0 && allStudents.length === 0) {
      html +=
        '<div class="dash-empty">' +
        '<div class="dash-empty-icon">\uD83D\uDC69\u200D\uD83C\uDFEB</div>' +
        '<div class="dash-empty-title">No students yet</div>' +
        '<div class="dash-empty-text">Add your first student or import a class roster to get started.</div>' +
        '</div>';
    } else if (students.length === 0) {
      html +=
        '<div class="dash-empty">' +
        '<div class="dash-empty-icon">\uD83D\uDD0D</div>' +
        '<div class="dash-empty-title">No matches</div>' +
        '<div class="dash-empty-text">Try adjusting your search or filters.</div>' +
        '</div>';
    } else {
      html += '<div class="dash-grid">';
      students.forEach(function (st) {
        var overall = getOverallProficiency(cid, st.id);
        var op = Math.round(overall);
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
              return a + b.score;
            }, 0) / mid;
          var lateAvg =
            allSc.slice(mid).reduce(function (a, b) {
              return a + b.score;
            }, 0) /
            (allSc.length - mid);
          if (lateAvg > earlyAvg + 0.2) trend = 'up';
          else if (lateAvg < earlyAvg - 0.2) trend = 'down';
        }

        var obs = getStudentQuickObs(cid, st.id);
        var lastObs = obs.length > 0 ? obs[0] : null;
        var obsText = '';
        if (lastObs) {
          var snippet = lastObs.text.length > 45 ? lastObs.text.slice(0, 45) + '\u2026' : lastObs.text;
          obsText = '\uD83D\uDCDD "' + esc(snippet) + '"';
        } else {
          obsText = '<span style="color:var(--text-3)">No observations</span>';
        }

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
          (flagged ? 'var(--priority)' : 'var(--border-2)') +
          '">' +
          (flagged ? '\u2691' : '\u2690') +
          '</button>' +
          '<div class="dash-card-info">' +
          '<a class="dash-card-name" href="#/student?id=' +
          st.id +
          '&course=' +
          cid +
          '" data-stop-prop="true">' +
          esc(displayName(st)) +
          '</a>' +
          (st.pronouns ? '<div class="dash-card-pronouns">' + esc(st.pronouns) + '</div>' : '') +
          (st.studentNumber
            ? '<div style="font-size:0.6rem;color:var(--text-3);font-family:\'SF Mono\',ui-monospace,monospace">#' +
              esc(st.studentNumber) +
              '</div>'
            : '') +
          ((st.designations || []).length > 0
            ? (function () {
                var dh = '<div class="dash-desig-wrap">';
                var hasIep = false;
                var hasMod = false;
                (st.designations || []).forEach(function (code) {
                  var d = BC_DESIGNATIONS[code];
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
          '<div class="dash-card-badge" style="background:' +
          PROF_TINT[op] +
          '">' +
          '<div class="dash-card-badge-num" style="color:' +
          PROF_COLORS[op] +
          '">' +
          (overall > 0 ? overall.toFixed(1) : '\u2014') +
          '</div>' +
          '<div class="dash-card-badge-label" style="color:' +
          PROF_COLORS[op] +
          '">' +
          (overall > 0 ? PROF_LABELS[op] : '') +
          '</div>' +
          '</div>' +
          (missingCount > 0
            ? '<span class="dash-card-missing" title="' +
              missingCount +
              ' past-due unscored">\u26A0' +
              missingCount +
              '</span>'
            : '') +
          '</div>';

        html += '<div class="dash-card-sections">';
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
              (groupVal > 0 ? groupVal.toFixed(1) : '\u2014') +
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
              (secVal > 0 ? secVal.toFixed(1) : '\u2014') +
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
              (secVal > 0 ? secVal.toFixed(1) : '\u2014') +
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
  };
})();
