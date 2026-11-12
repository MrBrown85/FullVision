/* dash-student-cards.js — Dashboard student card rendering helpers */
window.DashStudentCards = (function () {
  'use strict';

  // The trend arrow beside the grade badge, with what it means.
  var TREND = {
    up: { glyph: '&#x2191;', color: 'var(--score-3)', label: 'Rising: later work scores higher than earlier work' },
    down: { glyph: '&#x2193;', color: 'var(--score-1)', label: 'Falling: later work scores lower than earlier work' },
    flat: { glyph: '&#x2192;', color: 'var(--text-3)', label: 'Steady' },
  };
  function trendHtml(trend) {
    var t = TREND[trend] || TREND.flat;
    return (
      '<span class="dash-card-trend" data-trend="' +
      (TREND[trend] ? trend : 'flat') +
      '" role="img" aria-label="' +
      esc(t.label) +
      '" title="' +
      esc(t.label) +
      '" style="color:' +
      t.color +
      '">' +
      t.glyph +
      '</span>'
    );
  }

  // With this many columns or fewer the strip draws labelled chips; with
  // more, thin bars.
  var CHIP_MAX = 8;

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

  /* One column's value for one student, as the Curricular Competencies card
     reads it (competencyDistribution). */
  function _colValue(cid, sid, col) {
    return col.which.groupId
      ? getGroupProficiency(cid, sid, col.which.groupId)
      : getSectionProficiency(cid, sid, col.which.sectionId);
  }

  /* What a chip's pop-up says: the column's full name, the level (with its
     word in a Proficiency or Both class) or "Not assessed yet", and for a
     folder how many of its competencies have evidence and, when it isn't
     counted as one, folderAverageNote. */
  function stripTipLines(cid, sid, col, value, secById) {
    var sec = !col.which.groupId && secById[col.which.sectionId];
    var lines = [sec ? standardTitle(sec) : col.title];
    if (value > 0) {
      var word = levelWord(cid, value);
      lines.push(formatLevel(cid, value) + (word ? ' ' + word : ''));
    } else {
      lines.push('Not assessed yet');
    }
    if (col.which.groupId) {
      var withEvidence = col.sectionIds.filter(function (secId) {
        return getSectionEvidenceCount(cid, sid, secId) > 0;
      }).length;
      lines.push(withEvidence + ' of ' + col.sectionIds.length + ' competencies with evidence');
      // How the folder counts (folderAverageNote), when it isn't counted as one.
      if (col.note) lines.push(col.note);
    }
    return lines;
  }

  function _tipHtml(lines) {
    return (
      '<span class="dist-tip" aria-hidden="true"><span class="dist-tip-title">' +
      esc(lines[0]) +
      '</span>' +
      lines
        .slice(1)
        .map(function (l) {
          return '<span class="dist-tip-name">' + esc(l) + '</span>';
        })
        .join('') +
      '</span>'
    );
  }

  /* The strip: one segment per column of DashInsights.columns, tinted by the
     student's level on it. Up to CHIP_MAX columns each is a chip with its
     code; more are thin bars. `focusKey` outlines one column and dims the
     rest. data-student-tab: the student page tab a click here opens. */
  function stripHtml(cid, sid, cols, focusKey, secById) {
    var chips = cols.length <= CHIP_MAX;
    var html =
      '<div class="dash-card-strip' +
      (chips ? ' is-chips' : '') +
      (focusKey ? ' has-focus' : '') +
      '" data-student-tab="comps">';
    cols.forEach(function (col) {
      var value = _colValue(cid, sid, col);
      var r = value > 0 ? Math.max(1, Math.min(4, roundLevel(value))) : 0;
      var lines = stripTipLines(cid, sid, col, value, secById);
      var label = lines[0] + ': ' + lines.slice(1).join('. ');
      // The level's colours (and a text colour that reads on it in each
      // theme) come from .dash-card-seg.lv-N in dashboard.css.
      var cls = 'dash-card-seg' + (r ? ' lv-' + r : ' is-none') + (focusKey === col.key ? ' is-focus' : '');
      if (chips) {
        html +=
          '<button type="button" class="' +
          cls +
          '" data-key="' +
          esc(col.key) +
          '" aria-label="' +
          esc(label) +
          '">' +
          esc(DashInsights.columnCode(cid, col)) +
          _tipHtml(lines) +
          '</button>';
      } else {
        html +=
          '<span class="' +
          cls +
          '" data-key="' +
          esc(col.key) +
          '" role="img" aria-label="' +
          esc(label) +
          '">' +
          _tipHtml(lines) +
          '</span>';
      }
    });
    return html + '</div>';
  }

  /* How many of the student's competencies (tags) have no scored work, as
     getCompletionPct counts them. */
  function unassessedCount(cid, sid) {
    return getAllTags(cid).filter(function (t) {
      return !getTagScores(cid, sid, t.id).some(function (sc) {
        return sc && Number(sc.score) > 0;
      });
    }).length;
  }

  /* The footer's right side: with a column in focus, the student's level on
     it; otherwise "N not assessed" when some competency has no scored work. */
  function footerRightHtml(cid, sid, focusCol) {
    if (focusCol) {
      var value = _colValue(cid, sid, focusCol);
      var r = value > 0 ? Math.max(1, Math.min(4, roundLevel(value))) : 0;
      return (
        '<span class="dash-card-focus"' +
        (r ? ' style="color:var(--score-' + r + '-text)"' : '') +
        '>' +
        esc(focusCol.label + ': ' + levelText(cid, value, 'Not assessed yet')) +
        '</span>'
      );
    }
    var n = unassessedCount(cid, sid);
    if (!n) return '';
    return (
      '<span class="dash-card-unassessed" title="' +
      esc(n + (n === 1 ? ' competency has' : ' competencies have') + ' no scored work yet') +
      '">' +
      n +
      ' not assessed</span>'
    );
  }

  /* opts.focusKey: a column key (DashInsights.columns) the page is focused
     on; opts.rule: the saved Who Needs Help rule, for the focus border. */
  function renderStudentCards(cid, students, allStudents, sections, assessments, allScores, flags, opts) {
    opts = opts || {};
    var cols = DashInsights.columns(cid);
    var secById = {};
    getSections(cid).forEach(function (sec) {
      secById[sec.id] = sec;
    });
    var focusCol =
      (opts.focusKey &&
        cols.filter(function (c) {
          return c.key === opts.focusKey;
        })[0]) ||
      null;
    var focusKey = focusCol ? focusCol.key : '';
    var rule = DashInsights.readRule(opts.rule);
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

        // Work labelled Missing, whatever its due date.
        var missingCount = assessments.filter(function (a) {
          return getAssignmentStatus(cid, st.id, a.id) === 'NS';
        }).length;

        // Every piece of competency evidence as calc.js counts it: points
        // work as its level (18/20 is 4, not 18), Excused and 0% category
        // work left out, inside the term in view.
        var allSc = getAllTags(cid)
          .reduce(function (list, t) {
            return list.concat(getCountedTagScores(cid, st.id, t.id));
          }, [])
          .filter(function (sc) {
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

        var focusBelow =
          focusCol && DashInsights.isBelowRule(cid, focusCol, st.id, _colValue(cid, st.id, focusCol), rule);
        html +=
          '<div class="dash-card' +
          (flagged ? ' flagged' : '') +
          (focusBelow ? ' is-focus-below' : '') +
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
          '" data-stop-prop="true" title="' +
          esc(displayNameWithLast(st)) +
          '">' +
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
          // No pronouns or student number here (Colin, Nov 5): the card is
          // the name, and a long name wraps to a second line instead of
          // being cut off.
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
          trendHtml(trend) +
          '</div>';

        html += stripHtml(cid, st.id, cols, focusKey, secById);

        // The footer: the flag at the bottom left (plan F.6), the
        // observation line, then Missing and the right-hand note.
        var flagLabel = flagged ? 'Unflag student' : 'Flag student';
        html +=
          '<div class="dash-card-footer">' +
          '<button type="button" class="dash-flag-btn' +
          (flagged ? ' is-on' : '') +
          '" data-action="toggleFlag" data-cid="' +
          cid +
          '" data-sid="' +
          st.id +
          '" data-stop-prop="true" title="' +
          flagLabel +
          '" aria-label="' +
          flagLabel +
          '" aria-pressed="' +
          flagged +
          '">' +
          (flagged ? '\u2691' : '\u2690') +
          '</button>' +
          '<div class="dash-card-obs" data-student-tab="evidence">' +
          obsText +
          '</div>' +
          (missingCount > 0
            ? '<span class="dash-card-missing" title="' +
              missingCount +
              ' labelled Missing">\u26A0\uFE0E' +
              missingCount +
              '</span>'
            : '') +
          footerRightHtml(cid, st.id, focusCol) +
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
