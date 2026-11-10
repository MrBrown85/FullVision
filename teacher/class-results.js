/* ── class-results.js — the Class Results panel and the Class Average card ──
   How the class did on one assessment, and who needs follow-up
   (docs/plans/class-results-plan.md; Colin, 2026-11-05). The panel opens
   beside the page in #page-layout, as the Help panel does, from the
   gradebook's Class Average (a click, Enter or Space, or View Class Results
   in the column's menu) and from the Assignments page. Any element with
   data-action="classResults" data-cid data-aid opens it; the page in view
   says what Grade This Assessment does there and what to redraw after a
   change (setPage).

   Every number comes from calc.js (classColumnSpread and the helpers beside
   it) and every grade is written through its formatters. Colour means a
   proficiency level and nothing else. No statistic compares a group of
   students (ELL or any designation) with the class: a designation is only a
   tag beside a name (Colin, 2026-11-05). */
window.ClassResults = (function () {
  'use strict';

  var _state = null; // { cid, aid, opts, from, sel, view, chart, showAll, showWithout, showDone }
  var _page = null; // the page's options: function (cid, aid) → { grade, onChange, markBlank, beforeOpen }
  var _otherToken = 0;
  var SHOWN = 6; // rows a list shows before Show All

  // A drawing coordinate to a tenth of a pixel (SVG and CSS positions, never a grade).
  function _n(x) {
    return String(Math.round(Number(x) * 10) / 10);
  }

  /* ── Lookups ─────────────────────────────────────────────── */
  function _assessment(cid, aid) {
    return (getAssessments(cid) || []).find(function (a) {
      return a.id === aid;
    });
  }
  function _roster(cid) {
    return sortStudents(getStudents(cid), 'lastName');
  }
  function _byId(cid) {
    var out = {};
    getStudents(cid).forEach(function (s) {
      out[s.id] = s;
    });
    return out;
  }
  function _mode(a) {
    if (isDibelsScored(a)) return 'dibels';
    if (isCompletionScored(a)) return 'complete';
    if (isPointsScored(a)) return 'points';
    return 'level';
  }
  function _bandLabels(cid) {
    var out = {};
    levelBands(cid).forEach(function (b) {
      out[b.level] = b.label;
    });
    return out;
  }

  /* The observations linked to an assessment, newest first:
     [{ id, studentId, text, sentiment, date }]. Here, not in calc.js:
     observations never count toward a grade, and calc.js doesn't read
     them. */
  function assessmentObservations(cid, assessment) {
    if (!assessment || typeof getAllQuickObs !== 'function') return [];
    return getAllQuickObs(cid)
      .filter(function (o) {
        return o && o.assignmentContext && o.assignmentContext.assessmentId === assessment.id;
      })
      .map(function (o) {
        return {
          id: o.id,
          studentId: o.studentId,
          text: o.text || '',
          sentiment: o.sentiment || null,
          date: o.date || String(o.created || '').slice(0, 10),
        };
      });
  }

  /* The same assessment in the teacher's other classes: its linked copies
     (copy_group, AssessmentCopy.findCopies), each class loaded and its Class
     Average worked out as that class reads it. [{ cid, className, text,
     pct }] in the classes' order; [] for work that was never copied. */
  function otherClassesResults(cid, assessment) {
    if (!assessment || !assessment.copyGroup || !window.AssessmentCopy) return Promise.resolve([]);
    return AssessmentCopy.findCopies(cid, assessment)
      .then(function (copies) {
        return Promise.all(
          (copies || []).map(function (copy) {
            return Promise.resolve(typeof loadClass === 'function' ? loadClass(copy.cid) : null).then(function () {
              var other = _assessment(copy.cid, copy.assessmentId);
              if (!other) return null;
              var avg = classColumnAverage(copy.cid, getStudents(copy.cid), { assessment: other });
              if (!avg) return null;
              return {
                cid: copy.cid,
                className: copy.className || (COURSES[copy.cid] && COURSES[copy.cid].name) || '',
                text: classColumnAverageText(copy.cid, other, avg),
                pct: _avgPercent(copy.cid, other, avg),
              };
            });
          }),
        );
      })
      .then(function (rows) {
        var order = Object.keys(COURSES || {});
        return rows.filter(Boolean).sort(function (x, y) {
          var dx = Number((COURSES[x.cid] || {}).displayOrder);
          var dy = Number((COURSES[y.cid] || {}).displayOrder);
          if (isFinite(dx) && isFinite(dy) && dx !== dy) return dx - dy;
          return order.indexOf(x.cid) - order.indexOf(y.cid);
        });
      })
      .catch(function () {
        return [];
      });
  }

  // How full a neutral bar for a Class Average is, 0–100.
  function _avgPercent(cid, a, avg) {
    if (!avg) return 0;
    if (avg.pct != null) return Math.max(0, Math.min(100, avg.pct));
    return levelBarPercent(cid, avg.avg);
  }

  /* ── Small pieces of markup ──────────────────────────────── */
  function _statusChip(kind) {
    if (kind === 'NS') return '<span class="gb-status gb-status-ns">M</span>';
    if (kind === 'EXC') return '<span class="gb-status gb-status-exc">EXC</span>';
    return '<span class="gb-late cr-late">L</span>';
  }
  function _statusChips(st, lower) {
    var parts = [];
    if (st.missing.length) parts.push([_statusChip('NS'), st.missing.length, 'Missing']);
    if (st.excused.length) parts.push([_statusChip('EXC'), st.excused.length, 'Excused']);
    if (st.late.length) parts.push([_statusChip('LATE'), st.late.length, 'Late']);
    return parts.map(function (p) {
      return '<span class="cr-chip">' + p[0] + p[1] + ' ' + (lower ? p[2].toLowerCase() : p[2]) + '</span>';
    });
  }
  function _desTags(s) {
    return (s.designations || [])
      .map(function (code) {
        var d = typeof designationInfo === 'function' ? designationInfo(code) : null;
        if (!d) return '';
        return '<span class="gb-des-tag" title="' + esc(code + ' — ' + d.name) + '">' + esc(code) + '</span>';
      })
      .join('');
  }
  function _studentLink(cid, s, cls) {
    return (
      '<a class="cr-stu' +
      (cls ? ' ' + cls : '') +
      '" role="link" tabindex="0" data-href="/student?id=' +
      encodeURIComponent(s.id) +
      '&course=' +
      encodeURIComponent(cid) +
      '">' +
      esc(displayName(s)) +
      '</a>'
    );
  }
  function _levelDot(level) {
    return '<span class="cr-dot" style="background:var(--score-' + level + ')"></span>';
  }
  function _section(title, n, body, extra) {
    return (
      '<section class="cr-sec">' +
      '<div class="cr-sh"><h3>' +
      esc(title) +
      (n != null ? ' <span>· ' + esc(String(n)) + '</span>' : '') +
      '</h3>' +
      (extra || '') +
      '</div>' +
      body +
      '</section>'
    );
  }
  function _obsButton(ids, label) {
    if (!ids.length) return '';
    return (
      '<button type="button" class="cr-act" data-cr="observe" data-ids="' +
      esc(ids.join(',')) +
      '">' +
      esc(label || 'Record an Observation for These ' + ids.length) +
      '</button>'
    );
  }
  function _nameChips(cid, ids, byId) {
    return (
      '<div class="cr-names">' +
      ids
        .map(function (sid) {
          return byId[sid] ? _studentLink(cid, byId[sid], 'cr-name-chip') : '';
        })
        .join('') +
      '</div>'
    );
  }
  // A track bar with no level colour: for comparisons that are not a level.
  function _track(pct) {
    return (
      '<span class="cr-track"><span style="width:' + Math.max(0, Math.min(100, Math.round(pct))) + '%"></span></span>'
    );
  }
  // The level bar: one segment per level, in the class's order.
  function _levelBar(cid, counts, cls) {
    var total = 0;
    var bands = levelBands(cid);
    bands.forEach(function (b) {
      total += counts[b.level] || 0;
    });
    if (!total) return '';
    var aria = bands
      .map(function (b) {
        return (counts[b.level] || 0) + ' ' + b.label;
      })
      .join(', ');
    return (
      '<div class="' +
      (cls || 'cr-bar') +
      '" role="img" aria-label="' +
      esc(aria) +
      '">' +
      bands
        .filter(function (b) {
          return counts[b.level];
        })
        .map(function (b) {
          return '<span style="flex:' + counts[b.level] + ' 1 0;background:var(--score-' + b.level + ')"></span>';
        })
        .join('') +
      '</div>'
    );
  }
  function _levelCounts(cid, counts, cls) {
    return (
      '<div class="' +
      (cls || 'cr-cnt') +
      '">' +
      levelBands(cid)
        .map(function (b) {
          return (
            '<div><b style="color:var(--score-' +
            b.level +
            '-text)">' +
            (counts[b.level] || 0) +
            '</b><span>' +
            esc(b.label) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── The Class Average card (gradebook hover) ────────────── */
  /* The card a Class Average cell shows on hover or focus: the Class
     Average and how many are scored, the level bar and counts, the median
     and range (points: median, lowest, highest), the Missing, Excused and
     Late counts, and "View Class Results". '' for DIBELS work, whose cell
     has no average. Every string is escaped; figures come from calc.js. */
  function cardHtml(cid, students, a) {
    if (!a || isDibelsScored(a)) return '';
    var mode = _mode(a);
    var col = { assessment: a };
    var avg = classColumnAverage(cid, students, col);
    var st = classColumnStatusCounts(cid, students, a);
    var html = '<div class="gb-tip-head">Class Average</div>';
    var level = avg ? (mode === 'level' ? Math.round(avg.avg) : pointsToProf(avg.pct, 100, getGradingScale(cid))) : 0;
    var word = mode === 'level' && avg && courseGradeMode(cid) === 'proficiency' ? levelWord(cid, avg.avg) : '';
    html +=
      '<div class="gb-tip-avg-line"><span class="gb-tip-grade" style="color:' +
      (avg ? PROF_COLORS[level] || PROF_COLORS[0] : 'var(--text-3)') +
      '">' +
      esc(classColumnAverageText(cid, a, avg)) +
      (word ? ' <small>' + esc(word) + '</small>' : '') +
      '</span><span class="gb-tip-note">' +
      esc(st.scored + ' of ' + st.total + ' scored') +
      '</span></div>';
    if (mode === 'complete') {
      var cc = completionCounts(cid, students, a);
      html +=
        '<div class="gb-tip-stats gb-tip-stats-3">' +
        [
          ['Complete', cc.complete.length],
          ['Incomplete', cc.incomplete.length],
          ['Unmarked', cc.unmarked.length],
        ]
          .map(function (p) {
            return '<div><span>' + p[0] + '</span><b>' + p[1] + '</b></div>';
          })
          .join('') +
        '</div>';
    } else {
      var counts = classColumnLevelCounts(cid, students, col);
      if (counts.scored) {
        html +=
          '<div class="gb-tip-head">Proficiency</div>' +
          _levelBar(cid, counts.counts, 'gb-tip-bar') +
          _levelCounts(cid, counts.counts, 'gb-tip-levels');
      }
      var spread = classColumnSpread(cid, students, col);
      if (spread) {
        var pts = spread.points;
        var cells = pts
          ? [
              ['Median', classSpreadText(cid, a, spread.median, true)],
              ['Lowest', classSpreadText(cid, a, spread.low, true)],
              ['Highest', classSpreadText(cid, a, spread.high, true)],
            ]
          : [
              ['Median', classSpreadText(cid, a, spread.median)],
              ['Range', classSpreadRangeText(cid, a, spread)],
            ];
        html +=
          '<div class="gb-tip-stats gb-tip-stats-' +
          cells.length +
          '">' +
          cells
            .map(function (c) {
              return '<div><span>' + c[0] + '</span><b>' + esc(c[1]) + '</b></div>';
            })
            .join('') +
          '</div>';
      }
    }
    var chips = _statusChips(st, true);
    if (chips.length)
      html += '<div class="gb-tip-head">Completion</div><div class="gb-tip-chips">' + chips.join('') + '</div>';
    html += '<div class="gb-tip-foot gb-tip-open">View Class Results<span aria-hidden="true">›</span></div>';
    return html;
  }

  /* ── The panel ───────────────────────────────────────────── */
  function _subtitle(cid, a) {
    var parts = [];
    var cat = getCategoryById(cid, a.categoryId || a.category_id);
    if (cat && cat.name) parts.push(cat.name);
    var mode = _mode(a);
    if (mode === 'points') parts.push('Out of ' + formatPoints(Number(a.maxPoints) || 100));
    if (mode === 'complete') parts.push('Complete/Incomplete');
    if (mode === 'dibels') {
      var res = dibelsClassResults(cid, _roster(cid), a);
      if (res.latest) parts.push(DIBELS_PERIOD_NAMES[res.latest] + ' window');
    }
    var share = assessmentCourseShare(cid, a);
    if (share != null) parts.push(share + '% of the course grade');
    var due = a.dueDate || a.due_date || a.date;
    if (due && mode !== 'dibels') parts.push('Due ' + formatShortDate(due));
    return parts.join(' · ');
  }

  function _header(cid, a) {
    return (
      '<div class="cr-head">' +
      '<div class="cr-head-row"><div class="cr-head-text">' +
      '<h2 id="cr-title" tabindex="-1">' +
      esc(a.title || 'Assessment') +
      '</h2>' +
      '<span class="cr-sub">' +
      esc(_subtitle(cid, a)) +
      '</span></div>' +
      '<button type="button" class="cr-close" data-cr="close" aria-label="Close Class Results" aria-keyshortcuts="Escape">×</button>' +
      '</div>' +
      '<div class="cr-head-btns">' +
      '<button type="button" class="cr-btn cr-btn-primary" data-cr="grade">Grade This Assessment</button>' +
      '<button type="button" class="cr-btn" data-cr="edit">Edit Assessment Details</button>' +
      _printButton(cid, a) +
      '</div></div>'
    );
  }

  // The same print the grader offers (RubricPrint): none on DIBELS.
  // html-safe: printLabel is a fixed label
  function _printButton(cid, a) {
    var label = window.RubricPrint ? RubricPrint.printLabel(cid, a) : '';
    return label ? '<button type="button" class="cr-btn" data-cr="print">' + label + '</button>' : '';
  }

  function _stat(label, value, color) {
    return (
      '<div class="cr-stat"><span>' +
      esc(label) +
      '</span><b' +
      (color ? ' style="color:' + color + '"' : '') +
      '>' +
      value +
      '</b></div>'
    );
  }

  // Other Classes (filled in when the copies load) and Earlier in <Category>.
  function _compareRow(cid, a, avg) {
    var earlier = earlierInCategory(cid, a);
    var html = '<div class="cr-compare">';
    html += '<div class="cr-others" id="cr-others" hidden></div>';
    if (earlier) {
      var cat = getCategoryById(cid, a.categoryId || a.category_id);
      var label = cat && cat.name ? 'Earlier in ' + cat.name : 'Earlier Work';
      var points = earlier
        .slice()
        .reverse()
        .map(function (e) {
          return {
            name: formatShortDate(_dateOf(e.assessment)).replace(/, \d{4}$/, '') || e.assessment.title || '',
            title: e.assessment.title || '',
            text: _shortAvgText(cid, e.assessment, e.average),
            pct: _avgPercent(cid, e.assessment, e.average),
          };
        });
      if (avg)
        points.push({
          name: 'This One',
          title: a.title || '',
          text: _shortAvgText(cid, a, avg),
          pct: _avgPercent(cid, a, avg),
          now: true,
        });
      var lo = Math.min.apply(
        null,
        points.map(function (p) {
          return p.pct;
        }),
      );
      var hi = Math.max.apply(
        null,
        points.map(function (p) {
          return p.pct;
        }),
      );
      if (hi - lo < 10) {
        var mid = (hi + lo) / 2;
        lo = mid - 5;
        hi = mid + 5;
      }
      var w = 286;
      var step = w / points.length;
      var xy = points.map(function (p, i) {
        return {
          x: Math.round((step / 2 + i * step) * 10) / 10,
          y: Math.round((38 - ((p.pct - lo) / (hi - lo)) * 32) * 10) / 10,
        };
      });
      var aria =
        label +
        ': ' +
        points
          .map(function (p) {
            return (p.now ? 'this one' : p.title) + ' ' + p.text;
          })
          .join(', ');
      html +=
        '<div class="cr-earlier"><span class="cr-cl">' +
        esc(label) +
        '</span>' +
        '<svg class="cr-trend" width="100%" height="44" viewBox="0 0 ' +
        w +
        ' 44" preserveAspectRatio="none" role="img" aria-label="' +
        esc(aria) +
        '"><polyline points="' +
        xy
          .map(function (p) {
            return p.x + ',' + p.y;
          })
          .join(' ') +
        '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline></svg>' +
        '<div class="cr-trend-dots" style="grid-template-columns:repeat(' +
        points.length +
        ',minmax(0,1fr))">' +
        points
          .map(function (p, i) {
            return (
              '<span title="' +
              esc(p.title) +
              '"><i class="cr-trend-dot' +
              (p.now ? ' is-now' : '') +
              '" style="top:' +
              xy[i].y +
              'px"></i>' +
              esc(p.name) +
              '<b>' +
              esc(p.text) +
              '</b></span>'
            );
          })
          .join('') +
        '</div></div>';
    }
    return html + '</div>';
  }
  // A Class Average short enough for the Earlier row: points work as its %.
  function _shortAvgText(cid, a, avg) {
    if (isPointsScored(a) && !isCompletionScored(a)) return formatPointsPercent(avg.avg, a.maxPoints);
    return classColumnAverageText(cid, a, avg);
  }
  function _dateOf(a) {
    return (a && (a.date || a.dateAssigned || a.date_assigned)) || '';
  }

  function _otherClassesHtml(cid, a, avg, rows) {
    return (
      '<span class="cr-cl">Other Classes</span>' +
      '<div class="cr-cmpr"><span class="cr-this">This Class</span>' +
      _track(_avgPercent(cid, a, avg)) +
      '<b>' +
      esc(classColumnAverageText(cid, a, avg)) +
      '</b></div>' +
      rows
        .map(function (r) {
          return (
            '<div class="cr-cmpr"><a class="cr-stu" role="link" tabindex="0" data-href="/gradebook?course=' +
            encodeURIComponent(r.cid) +
            '">' +
            esc(r.className) +
            '</a>' +
            _track(r.pct) +
            '<b>' +
            esc(r.text) +
            '</b></div>'
          );
        })
        .join('')
    );
  }

  function _fillOtherClasses(cid, a) {
    var token = ++_otherToken;
    otherClassesResults(cid, a).then(function (rows) {
      if (token !== _otherToken || !_state || _state.cid !== cid || _state.aid !== a.id) return;
      var box = document.getElementById('cr-others');
      var avg = classColumnAverage(cid, _roster(cid), { assessment: a });
      if (!box || !rows.length || !avg) return;
      // html-safe: class names and figures go through esc; figures come from calc.js
      box.innerHTML = _otherClassesHtml(cid, a, avg, rows);
      box.hidden = false;
    });
  }

  /* ── Summary bands ──────────────────────────────────────── */
  function _summaryLevel(cid, a, students, avg, st) {
    var col = { assessment: a };
    var spread = classColumnSpread(cid, students, col);
    var counts = classColumnLevelCounts(cid, students, col);
    var lvl = avg ? Math.round(avg.avg) : 0;
    return (
      '<div class="cr-band">' +
      '<div class="cr-stats cr-stats-4">' +
      _stat('Class Average', esc(classColumnAverageText(cid, a, avg)), avg ? PROF_COLORS[lvl] : '') +
      _stat('Median', esc(spread ? classSpreadText(cid, a, spread.median) : '—')) +
      _stat('Range', esc(classSpreadRangeText(cid, a, spread))) +
      _stat('Scored', esc(st.scored + ' of ' + st.total)) +
      '</div>' +
      (counts.scored
        ? '<div class="cr-dist">' + _levelBar(cid, counts.counts) + _levelCounts(cid, counts.counts) + '</div>'
        : '') +
      _chipsRow(st) +
      _compareRow(cid, a, avg) +
      '</div>'
    );
  }
  function _chipsRow(st, lead) {
    var chips = _statusChips(st);
    if (!chips.length && !lead) return '';
    return '<div class="cr-chips">' + (lead || '') + chips.join('') + '</div>';
  }
  function _summaryPoints(cid, a, students, avg, st) {
    var spread = classColumnSpread(cid, students, { assessment: a });
    var lvl = avg ? pointsToProf(avg.pct, 100, getGradingScale(cid)) : 0;
    var avgText = avg
      ? esc(classSpreadText(cid, a, avg.avg, true)) + ' <small>· ' + esc(Math.round(avg.pct) + '%') + '</small>'
      : '—';
    return (
      '<div class="cr-band">' +
      '<div class="cr-stats cr-stats-pts">' +
      _stat('Class Average', avgText, avg ? PROF_COLORS[lvl] : '') +
      _stat('Median', esc(spread ? classSpreadText(cid, a, spread.median, true) : '—')) +
      _stat('Lowest', esc(spread ? classSpreadText(cid, a, spread.low, true) : '—')) +
      _stat('Highest', esc(spread ? classSpreadText(cid, a, spread.high, true) : '—')) +
      '</div>' +
      _chipsRow(
        st,
        '<span class="cr-chip cr-chip-lead">' + esc(st.scored + ' of ' + st.total + ' Scored') + '</span>',
      ) +
      _compareRow(cid, a, avg) +
      '</div>'
    );
  }
  function _summaryComplete(cid, a, students, avg, cc) {
    var total = students.length || 1;
    var parts = [
      [cc.complete.length, 'var(--score-3)'],
      [cc.incomplete.length, 'var(--score-1)'],
      [cc.unmarked.length, 'var(--text-3)'],
      [cc.missing.length, 'var(--score-1-dark)'],
      [cc.excused.length, 'var(--accent-purple)'],
    ];
    var C = 2 * Math.PI * 52;
    var start = 0;
    var arcs = parts
      .map(function (p) {
        var len = (p[0] / total) * C;
        var dash = Math.max(len - 2, 0);
        var out = p[0]
          ? '<circle cx="66" cy="66" r="52" fill="none" stroke="' +
            p[1] +
            '" stroke-width="16" stroke-dasharray="' +
            _n(dash) +
            ' ' +
            _n(C - dash) +
            '" stroke-dashoffset="' +
            _n(-start) +
            '"></circle>'
          : '';
        start += len;
        return out;
      })
      .join('');
    var aria =
      cc.complete.length +
      ' Complete, ' +
      cc.incomplete.length +
      ' Incomplete, ' +
      cc.unmarked.length +
      ' Unmarked, ' +
      cc.missing.length +
      ' Missing, ' +
      cc.excused.length +
      ' Excused';
    var lvl = cc.pct != null ? pointsToProf(cc.pct, 100, getGradingScale(cid)) : 0;
    function row(mark, label, n) {
      return '<div class="cr-crow">' + mark + '<span>' + label + '</span><b>' + n + '</b></div>';
    }
    return (
      '<div class="cr-band">' +
      '<div class="cr-ring-row"><div class="cr-ring">' +
      '<svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label="' +
      esc(aria) +
      '"><circle cx="66" cy="66" r="52" fill="none" stroke="var(--divider-medium)" stroke-width="16"></circle>' +
      arcs +
      '</svg><div class="cr-ring-mid"><b style="color:' +
      (cc.pct != null ? PROF_COLORS[lvl] : 'var(--text-3)') +
      '">' +
      esc(classColumnAverageText(cid, a, avg)) +
      '</b><span>Class Average</span></div></div>' +
      '<div class="cr-crows">' +
      row('<span class="cr-mk cr-mk-done" aria-hidden="true">✓</span>', 'Complete', cc.complete.length) +
      row(_statusChip('NS'), 'Missing', cc.missing.length) +
      row('<span class="cr-mk cr-mk-not" aria-hidden="true">✗</span>', 'Incomplete', cc.incomplete.length) +
      row(_statusChip('EXC'), 'Excused', cc.excused.length) +
      row('<span class="cr-mk cr-mk-blank" aria-hidden="true"></span>', 'Unmarked', cc.unmarked.length) +
      '</div></div>' +
      _compareRow(cid, a, avg) +
      '</div>'
    );
  }

  /* ── Student lists ──────────────────────────────────────── */
  // The list on the left: the cell, band or slice picked, else Below Proficient.
  function _studentList(cid, a, students, byId, rowsFor) {
    var labels = _bandLabels(cid);
    var sel = _state.sel;
    var title;
    var ids;
    var rowHtml;
    if (sel) {
      title = sel.title;
      ids = sel.ids;
      rowHtml = function (sid) {
        return '<div class="cr-li">' + _nameCell(cid, byId[sid]) + '</div>';
      };
    } else {
      var col = { assessment: a };
      var spread = classColumnSpread(cid, students, col);
      var counts = classColumnLevelCounts(cid, students, col);
      var below = counts.ids[1].concat(counts.ids[2]);
      // Weakest first, in the spread's order.
      ids = ((spread && spread.values) || [])
        .map(function (v) {
          return v.sid;
        })
        .filter(function (sid) {
          return below.indexOf(sid) >= 0;
        });
      title = 'Below Proficient';
      var bandOf = {};
      [1, 2].forEach(function (l) {
        counts.ids[l].forEach(function (sid) {
          bandOf[sid] = l;
        });
      });
      rowHtml = function (sid) {
        var cell = assessmentCellValue(cid, sid, a);
        var fig =
          cell.kind === 'status'
            ? _statusChip(cell.status)
            : esc(cell.kind === 'points' ? classSpreadText(cid, a, cell.value, true) : cell.text);
        return (
          '<div class="cr-li cr-li-3">' +
          _nameCell(cid, byId[sid]) +
          '<b style="color:var(--score-' +
          bandOf[sid] +
          '-text)">' +
          fig +
          '</b><span class="cr-lvl">' +
          _levelDot(bandOf[sid]) +
          esc(labels[bandOf[sid]]) +
          '</span></div>'
        );
      };
    }
    if (rowsFor) rowHtml = rowsFor;
    ids = ids.filter(function (sid) {
      return byId[sid];
    });
    if (!ids.length && !sel) return '';
    var all = _state.showAll === (sel ? sel.key : 'below');
    var shown = all ? ids : ids.slice(0, SHOWN);
    var body =
      '<div class="cr-list">' +
      shown.map(rowHtml).join('') +
      '</div>' +
      (ids.length > shown.length
        ? '<button type="button" class="cr-link" data-cr="showAll" data-key="' +
          esc(sel ? sel.key : 'below') +
          '">Show All ' +
          ids.length +
          '</button>'
        : '') +
      _obsButton(ids);
    return _section(
      title,
      ids.length,
      body,
      sel ? '<button type="button" class="cr-link" data-cr="clear">Clear</button>' : '',
    );
  }
  function _nameCell(cid, s) {
    return '<span class="cr-name">' + _studentLink(cid, s) + _desTags(s) + '</span>';
  }
  function _missingList(cid, st, byId, title) {
    var ids = st.missing.concat(title ? st.excused : []);
    if (!ids.length) return '';
    return _section(
      title || 'Missing',
      ids.length,
      '<div class="cr-list">' +
        ids
          .map(function (sid) {
            return (
              '<div class="cr-li">' +
              _nameCell(cid, byId[sid]) +
              _statusChip(st.missing.indexOf(sid) >= 0 ? 'NS' : 'EXC') +
              '</div>'
            );
          })
          .join('') +
        '</div>',
    );
  }
  function _feedbackSection(cid, a, students, byId) {
    var fb = classFeedbackCounts(cid, students, a);
    var n = fb.withComment.length + fb.without.length;
    if (!n) return '';
    var body = _track((fb.withComment.length / n) * 100);
    if (fb.without.length) {
      body +=
        '<button type="button" class="cr-link" data-cr="toggleWithout" aria-expanded="' +
        !!_state.showWithout +
        '">' +
        (_state.showWithout ? 'Hide the ' : 'Show the ') +
        fb.without.length +
        ' Without Comments</button>';
      if (_state.showWithout) body += _nameChips(cid, fb.without, byId);
    }
    return _section('Feedback Written', fb.withComment.length + ' of ' + n, body);
  }
  var OBS_ICONS = {
    strength: ['+', 'Strength'],
    growth: ['↗', 'Growth'],
    concern: ['!', 'Concern'],
  };
  function _obsSection(cid, a, byId) {
    var list = assessmentObservations(cid, a).filter(function (o) {
      return byId[o.studentId];
    });
    if (!list.length) return '';
    var link =
      '<a class="cr-link" role="link" tabindex="0" data-href="/observations?course=' +
      encodeURIComponent(cid) +
      '">See All</a>';
    // The newest three; See All opens the Observations page.
    return _section(
      'Observations',
      list.length,
      list
        .slice(0, 3)
        .map(function (o) {
          var ic = OBS_ICONS[o.sentiment] || ['·', 'Note'];
          return (
            '<div class="cr-obs"><span class="cr-ico" role="img" aria-label="' +
            ic[1] +
            '">' +
            ic[0] +
            '</span><span>' +
            _studentLink(cid, byId[o.studentId], 'cr-obs-name') +
            ' ' +
            esc(o.text) +
            '</span></div>'
          );
        })
        .join(''),
      link,
    );
  }
  function _columns(left, right) {
    left = left.filter(Boolean);
    right = right.filter(Boolean);
    if (!left.length && !right.length) return '';
    return (
      '<div class="cr-cols"><div class="cr-col">' +
      left.join('') +
      '</div><div class="cr-col">' +
      right.join('') +
      '</div></div>'
    );
  }

  /* ── Results grid (rubric and competency work) ───────────── */
  function _gridRowName(cid, row) {
    if (row.kind === 'criterion') return row.name || 'Criterion';
    var tag = getTagById(cid, row.id);
    if (!tag) return row.id;
    var code = tag.code || (typeof _isUuid === 'function' && !_isUuid(tag.id) ? tag.id : '');
    var name = tag.shortName || tag.label || tag.text || '';
    return code && name && code !== name ? code + ' ' + name : code || name;
  }
  function _resultsGrid(cid, a, students) {
    var rubricGrid = classRubricGrid(cid, students, a);
    var compGrid = classCompetencyGrid(cid, students, a);
    if (!rubricGrid && !compGrid) return '';
    var view = _state.view === 'competency' || !rubricGrid ? 'competency' : 'rubric';
    var grid = view === 'rubric' ? rubricGrid : compGrid;
    if (!grid || !grid.rows.length) return '';
    var bands = levelBands(cid);
    var max = 1;
    grid.rows.forEach(function (r) {
      bands.forEach(function (b) {
        if (r.counts[b.level] > max) max = r.counts[b.level];
      });
    });
    var switcher = '';
    if (rubricGrid && compGrid) {
      switcher =
        '<span class="cr-vmw"><button type="button" class="cr-vm" data-cr="viewMenu" aria-haspopup="menu" aria-expanded="false">' +
        (view === 'rubric' ? 'by Rubric' : 'by Competency') +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"></path></svg></button></span>';
    } else {
      switcher = '<span class="cr-vm-static">' + (view === 'rubric' ? 'by Rubric' : 'by Competency') + '</span>';
    }
    var sel = _state.sel;
    var html =
      '<section class="cr-sec"><div class="cr-sh"><h3>Results ' +
      switcher +
      '</h3></div><div class="cr-grid" role="table" aria-label="Results ' +
      (view === 'rubric' ? 'by rubric criterion' : 'by competency') +
      '"><span role="columnheader"></span>' +
      bands
        .map(function (b) {
          return (
            '<span class="cr-gh" role="columnheader" title="' +
            esc(b.label) +
            '">' +
            _levelDot(b.level) +
            '<span class="cr-gh-word">' +
            esc(b.label) +
            '</span></span>'
          );
        })
        .join('') +
      '<span class="cr-gh cr-gh-avg" role="columnheader">Average</span>';
    grid.rows.forEach(function (r) {
      var name = _gridRowName(cid, r);
      html += '<span class="cr-gl" role="rowheader" title="' + esc(name) + '">' + esc(name) + '</span>';
      bands.forEach(function (b) {
        var n = r.counts[b.level];
        if (!n) {
          html += '<span class="cr-cell cr-cell-empty" role="cell"></span>';
          return;
        }
        var key = view + '|' + r.id + '|' + b.level;
        var on = sel && sel.key === key;
        var mix = Math.round(12 + 28 * (n / max));
        html +=
          '<button type="button" class="cr-cell' +
          (on ? ' is-on' : '') +
          '" role="cell" data-cr="pick" data-key="' +
          esc(key) +
          '" aria-pressed="' +
          !!on +
          '" style="background:color-mix(in srgb, var(--score-' +
          b.level +
          ') ' +
          mix +
          '%, var(--score-' +
          b.level +
          '-bg));color:var(--score-' +
          b.level +
          '-text)" aria-label="' +
          esc(n + ' ' + b.label + ' on ' + name) +
          '">' +
          n +
          '</button>';
      });
      var avgLevel = r.avg ? Math.max(1, Math.min(4, Math.round(r.avg))) : 0;
      html +=
        '<strong class="cr-gavg" role="cell" style="color:' +
        (avgLevel ? 'var(--score-' + avgLevel + '-text)' : 'var(--text-3)') +
        '">' +
        esc(r.avg ? formatColumnAverageLevel(cid, r.avg) : '—') +
        '</strong>';
    });
    return html + '</div></section>';
  }
  // What a picked grid cell holds: { key, title, ids }, or null.
  function _gridPick(cid, a, students, key) {
    var parts = String(key).split('|');
    var view = parts[0];
    var grid = view === 'rubric' ? classRubricGrid(cid, students, a) : classCompetencyGrid(cid, students, a);
    if (!grid) return null;
    var row = grid.rows.find(function (r) {
      return r.id === parts[1];
    });
    var level = Number(parts[2]);
    if (!row || !row.ids[level] || !row.ids[level].length) return null;
    return { key: key, title: _bandLabels(cid)[level] + ' on ' + _gridRowName(cid, row), ids: row.ids[level].slice() };
  }

  /* ── Points: Score Spread ───────────────────────────────── */
  var CHARTS = [
    ['bars', 'as Bars'],
    ['donut', 'as a Donut'],
    ['dots', 'as Dots'],
  ];
  function _scoreSpread(cid, a, students) {
    var pb = pointsBands(cid, students, a);
    var spread = classColumnSpread(cid, students, { assessment: a });
    if (!pb || !spread) return '';
    var chart = _state.chart || 'bars';
    var bands = levelBands(cid);
    var desc = bands[0].level === 4;
    var sel = _state.sel;
    var max = pb.max;
    var label = (CHARTS.find(function (c) {
      return c[0] === chart;
    }) || CHARTS[0])[1];
    var html =
      '<section class="cr-sec"><div class="cr-sh"><h3>Score Spread <span class="cr-vmw"><button type="button" class="cr-vm" data-cr="chartMenu" aria-haspopup="menu" aria-expanded="false">' +
      esc(label) +
      '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"></path></svg></button></span></h3>' +
      '<div class="cr-key">' +
      bands
        .map(function (b) {
          return '<span>' + _levelDot(b.level) + esc(b.label) + '</span>';
        })
        .join('') +
      '</div></div>';
    var medianX = (Math.min(max, spread.median) / max) * 100;
    if (desc) medianX = 100 - medianX;
    var medianLabel = 'Median ' + formatPoints(Math.round(spread.median * 10) / 10);
    if (chart === 'bars') {
      var list = desc ? pb.bands.slice().reverse() : pb.bands;
      var tallest = 1;
      list.forEach(function (b) {
        if (b.ids.length > tallest) tallest = b.ids.length;
      });
      var unit = Math.min(14, Math.floor(128 / tallest));
      html +=
        '<div class="cr-bars-wrap"><div class="cr-median-label" style="left:' +
        _n(medianX) +
        '%">' +
        esc(medianLabel) +
        '</div><div class="cr-bars">' +
        list
          .map(function (b) {
            var key = 'band|' + b.lo;
            var on = sel && sel.key === key;
            var segs = [1, 2, 3, 4]
              .filter(function (l) {
                return b.byLevel[l].length;
              })
              .map(function (l) {
                return '<i style="height:' + b.byLevel[l].length * unit + 'px;background:var(--score-' + l + ')"></i>';
              });
            if (desc) segs.reverse();
            var range = _bandRange(b);
            return b.ids.length
              ? '<button type="button" class="cr-bin' +
                  (on ? ' is-on' : '') +
                  '" data-cr="pick" data-key="' +
                  esc(key) +
                  '" aria-pressed="' +
                  !!on +
                  '" aria-label="' +
                  esc(b.ids.length + (b.ids.length === 1 ? ' student' : ' students') + ' scored ' + range) +
                  '"><b>' +
                  b.ids.length +
                  '</b><span class="cr-stack">' +
                  segs.join('') +
                  '</span></button>'
              : '<span class="cr-bin cr-bin-empty"></span>';
          })
          .join('') +
        '<span class="cr-median-line" style="left:' +
        _n(medianX) +
        '%" aria-hidden="true"></span></div><div class="cr-bin-labels">' +
        list
          .map(function (b) {
            return '<span>' + esc(_bandRange(b)) + '</span>';
          })
          .join('') +
        '</div></div>';
    } else if (chart === 'donut') {
      var lc = classColumnLevelCounts(cid, students, { assessment: a });
      var total = lc.scored || 1;
      var C = 2 * Math.PI * 64;
      var start = 0;
      var slices = '';
      var legend = '';
      bands.forEach(function (b) {
        var n = lc.counts[b.level];
        var key = 'level|' + b.level;
        var on = sel && sel.key === key;
        var len = (n / total) * C;
        var dash = Math.max(len - 3, 0);
        if (n)
          slices +=
            '<circle cx="84" cy="84" r="64" fill="none" stroke="var(--score-' +
            b.level +
            ')" stroke-width="' +
            (on ? 30 : 24) +
            '" stroke-dasharray="' +
            _n(dash) +
            ' ' +
            _n(C - dash) +
            '" stroke-dashoffset="' +
            _n(-start) +
            '" opacity="' +
            (sel && String(sel.key).indexOf('level|') === 0 && !on ? 0.35 : 1) +
            '"></circle>';
        start += len;
        legend +=
          '<button type="button" class="cr-lg' +
          (on ? ' is-on' : '') +
          '" data-cr="pick" data-key="' +
          esc(key) +
          '" aria-pressed="' +
          !!on +
          '"' +
          (n ? '' : ' disabled') +
          '>' +
          _levelDot(b.level) +
          '<span>' +
          esc(b.label) +
          (pb.levelRanges[b.level] ? ' <span class="cr-muted">· ' + esc(pb.levelRanges[b.level]) + '</span>' : '') +
          '</span><b style="color:var(--score-' +
          b.level +
          '-text)">' +
          n +
          '</b><span class="cr-muted">' +
          Math.round((n / total) * 100) +
          '%</span></button>';
      });
      html +=
        '<div class="cr-donut-row"><div class="cr-donut"><svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label="' +
        esc(
          bands
            .map(function (b) {
              return lc.counts[b.level] + ' ' + b.label;
            })
            .join(', '),
        ) +
        '">' +
        slices +
        '</svg><div class="cr-ring-mid"><b>' +
        lc.scored +
        '</b><span>Scored</span></div></div><div class="cr-legend">' +
        legend +
        '</div></div>';
    } else {
      var seen = {};
      var dots = spread.values
        .map(function (v) {
          var x = (Math.min(max, v.value) / max) * 100;
          if (desc) x = 100 - x;
          var k = String(Math.round(v.value * 10));
          var stack = seen[k] || 0;
          seen[k] = stack + 1;
          var s = getStudents(cid).find(function (st) {
            return st.id === v.sid;
          });
          var lvl = pointsToProf(v.value, v.possible, getGradingScale(cid)) || 1;
          var t = (s ? displayName(s) : '') + ', ' + classSpreadText(cid, a, v.value, true);
          return (
            '<a class="cr-dotp" role="link" tabindex="0" data-href="/student?id=' +
            encodeURIComponent(v.sid) +
            '&course=' +
            encodeURIComponent(cid) +
            '" style="left:' +
            _n(x) +
            '%;bottom:' +
            Math.min(136, 4 + stack * 15) +
            'px;background:var(--score-' +
            lvl +
            ')" title="' +
            esc(t) +
            '" aria-label="' +
            esc(t) +
            '"></a>'
          );
        })
        .join('');
      var ticks = [0, 0.2, 0.4, 0.6, 0.8, 1]
        .map(function (f) {
          var v = Math.round(max * f);
          var x = desc ? 100 - (v / max) * 100 : (v / max) * 100;
          return '<span style="left:' + _n(x) + '%">' + esc(formatPoints(v)) + '</span>';
        })
        .join('');
      html +=
        '<div class="cr-dots-wrap"><div class="cr-median-label" style="left:' +
        _n(medianX) +
        '%">' +
        esc(medianLabel) +
        '</div><div class="cr-dots"><span class="cr-median-line" style="left:' +
        _n(medianX) +
        '%" aria-hidden="true"></span>' +
        dots +
        '</div><div class="cr-ticks">' +
        ticks +
        '</div></div>';
    }
    return html + '</section>';
  }
  // A band's points, "25–29", or "8" for a one-point band.
  function _bandRange(b) {
    return b.lo === b.hi ? formatPoints(b.lo) : formatPoints(b.lo) + '\u2013' + formatPoints(b.hi);
  }
  function _pointsPick(cid, a, students, key) {
    var parts = String(key).split('|');
    if (parts[0] === 'band') {
      var pb = pointsBands(cid, students, a);
      var band =
        pb &&
        pb.bands.find(function (b) {
          return String(b.lo) === parts[1];
        });
      if (!band || !band.ids.length) return null;
      return {
        key: key,
        title: 'Scored ' + _bandRange(band),
        ids: band.ids.slice(),
      };
    }
    if (parts[0] === 'level') {
      var lc = classColumnLevelCounts(cid, students, { assessment: a });
      var ids = lc.ids[Number(parts[1])] || [];
      if (!ids.length) return null;
      return { key: key, title: _bandLabels(cid)[Number(parts[1])], ids: ids.slice() };
    }
    return null;
  }

  /* ── DIBELS ─────────────────────────────────────────────── */
  var DIBELS_ORDER = ['intensive', 'strategic', 'core', 'above'];
  function _dibelsLevels(cid) {
    // The four reading levels in the class's level order: Intensive is
    // drawn where Emerging is.
    var asc = levelOrderFor(cid)[0] === 1;
    return asc ? DIBELS_ORDER.slice() : DIBELS_ORDER.slice().reverse();
  }
  function _dibelsTone(level) {
    return String(DIBELS_LEVELS[level].tone).replace('l', '');
  }
  function _dibelsBar(cid, counts, cls) {
    var total = 0;
    DIBELS_ORDER.forEach(function (l) {
      total += counts[l];
    });
    if (!total) return '';
    var order = _dibelsLevels(cid);
    return (
      '<div class="' +
      (cls || 'cr-bar') +
      '" role="img" aria-label="' +
      esc(
        order
          .map(function (l) {
            return counts[l] + ' ' + DIBELS_LEVELS[l].label;
          })
          .join(', '),
      ) +
      '">' +
      order
        .filter(function (l) {
          return counts[l];
        })
        .map(function (l) {
          return '<span style="flex:' + counts[l] + ' 1 0;background:var(--score-' + _dibelsTone(l) + ')"></span>';
        })
        .join('') +
      '</div><div class="cr-cnt">' +
      order
        .map(function (l) {
          return (
            '<div><b style="color:var(--score-' +
            _dibelsTone(l) +
            '-text)">' +
            counts[l] +
            '</b><span>' +
            esc(DIBELS_LEVELS[l].label) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function _dibelsBody(cid, a, students, byId) {
    var res = dibelsClassResults(cid, students, a);
    var latest = res.latest ? res.periods[res.latest] : null;
    var html =
      '<div class="cr-band"><div class="cr-stats cr-stats-' + (latest && latest.medianAccuracy != null ? 3 : 2) + '">';
    html += _stat(
      'Median Words Correct',
      esc(latest && latest.medianWrc != null ? formatPoints(latest.medianWrc) : '—'),
    );
    if (latest && latest.medianAccuracy != null)
      html += _stat('Median Accuracy', esc(formatPoints(latest.medianAccuracy) + '%'));
    html += _stat('Tested', esc((latest ? latest.tested : 0) + ' of ' + students.length));
    html += '</div>';
    if (latest) html += '<div class="cr-dist">' + _dibelsBar(cid, latest.counts) + '</div>';
    html += '</div>';
    if (!res.latest) return html;
    var order = _dibelsLevels(cid);
    var sel = _state.sel;
    var win = DIBELS_PERIODS.map(function (p) {
      var per = res.periods[p];
      var body;
      if (!per.tested) body = '<div class="cr-win-empty">Not Tested Yet</div>';
      else
        body =
          '<div class="cr-segs">' +
          order
            .filter(function (l) {
              return per.counts[l];
            })
            .map(function (l) {
              var key = 'dibels|' + p + '|' + l;
              var on = sel && sel.key === key;
              var tone = _dibelsTone(l);
              return (
                '<button type="button" class="cr-seg' +
                (on ? ' is-on' : '') +
                '" data-cr="pick" data-key="' +
                esc(key) +
                '" aria-pressed="' +
                !!on +
                '" style="flex:' +
                per.counts[l] +
                ' 1 0;background:var(--score-' +
                tone +
                '-bg);color:var(--score-' +
                tone +
                '-text)" aria-label="' +
                esc(per.counts[l] + ' ' + DIBELS_LEVELS[l].label + ' at ' + DIBELS_PERIOD_NAMES[p]) +
                '">' +
                per.counts[l] +
                '</button>'
              );
            })
            .join('') +
          '</div>';
      return '<div class="cr-win"><span>' + esc(DIBELS_PERIOD_NAMES[p]) + '</span>' + body + '</div>';
    }).join('');
    if (res.previous)
      win +=
        '<div class="cr-moved"><span><b style="color:var(--score-3-text)">↑ ' +
        res.moved.up.length +
        '</b>Moved Up</span><span><b>' +
        res.moved.same.length +
        '</b>Same</span><span><b style="color:var(--score-1-text)">↓ ' +
        res.moved.down.length +
        '</b>Moved Down</span></div>';
    html += _section('By Window', null, win);
    function wordsFor(sid, period) {
      var r = res.rows[sid] && res.rows[sid][period || res.latest];
      if (!r) return '';
      return formatPoints(r.wrc) + ' words' + (r.accuracy != null ? ' · ' + formatPoints(r.accuracy) + '%' : '');
    }
    var left;
    if (sel) {
      var parts = String(sel.key).split('|');
      var tone = _dibelsTone(parts[2]);
      left = _studentList(cid, a, students, byId, function (sid) {
        return (
          '<div class="cr-li">' +
          _nameCell(cid, byId[sid]) +
          '<b style="color:var(--score-' +
          tone +
          '-text)">' +
          esc(wordsFor(sid, parts[1])) +
          '</b></div>'
        );
      });
    } else {
      var intensive = latest.ids.intensive.slice().sort(function (x, y) {
        return res.rows[x][res.latest].wrc - res.rows[y][res.latest].wrc;
      });
      left = intensive.length
        ? _section(
            'Intensive',
            intensive.length,
            '<div class="cr-list">' +
              intensive
                .map(function (sid) {
                  return (
                    '<div class="cr-li">' +
                    _nameCell(cid, byId[sid]) +
                    '<b style="color:var(--score-1-text)">' +
                    esc(wordsFor(sid)) +
                    '</b></div>'
                  );
                })
                .join('') +
              '</div>' +
              _obsButton(intensive),
          )
        : '';
    }
    var down = res.moved.down.filter(function (m) {
      return byId[m.sid];
    });
    var right = down.length
      ? _section(
          'Moved Down',
          down.length,
          '<div class="cr-list">' +
            down
              .map(function (m) {
                return (
                  '<div class="cr-li">' +
                  _nameCell(cid, byId[m.sid]) +
                  '<span class="cr-move"><span style="color:var(--score-' +
                  _dibelsTone(m.from) +
                  '-text)">' +
                  esc(DIBELS_LEVELS[m.from].label) +
                  '</span>→<span style="color:var(--score-' +
                  _dibelsTone(m.to) +
                  '-text)">' +
                  esc(DIBELS_LEVELS[m.to].label) +
                  '</span></span></div>'
                );
              })
              .join('') +
            '</div>' +
            _obsButton(
              down.map(function (m) {
                return m.sid;
              }),
            ),
        )
      : '';
    return html + _columns([left], [right, _obsSection(cid, a, byId)]);
  }
  function _dibelsPick(cid, a, students, key) {
    var parts = String(key).split('|');
    var res = dibelsClassResults(cid, students, a);
    var per = res.periods[parts[1]];
    var ids = per && per.ids[parts[2]];
    if (!ids || !ids.length) return null;
    return {
      key: key,
      title: DIBELS_LEVELS[parts[2]].label + ' at ' + DIBELS_PERIOD_NAMES[parts[1]],
      ids: ids.slice(),
    };
  }

  /* ── Complete/Incomplete lists ──────────────────────────── */
  function _completeBody(cid, a, students, byId, cc) {
    function names(ids, chip) {
      return (
        '<div class="cr-list">' +
        ids
          .map(function (sid) {
            return '<div class="cr-li">' + _nameCell(cid, byId[sid]) + (chip ? chip(sid) : '') + '</div>';
          })
          .join('') +
        '</div>'
      );
    }
    var cols = [];
    if (cc.incomplete.length)
      cols.push(
        _section(
          'Incomplete',
          cc.incomplete.length,
          names(cc.incomplete) + _obsButton(cc.incomplete, 'Record an Observation'),
        ),
      );
    if (cc.unmarked.length)
      cols.push(
        _section(
          'Unmarked',
          cc.unmarked.length,
          names(cc.unmarked) +
            '<button type="button" class="cr-act" data-cr="markBlank" data-status="NS">Mark Missing</button>' +
            '<button type="button" class="cr-act cr-act-plain" data-cr="markBlank" data-status="EXC">Mark Excused</button>',
        ),
      );
    var gone = cc.missing.concat(cc.excused);
    if (gone.length)
      cols.push(
        _section(
          'Missing or Excused',
          gone.length,
          names(gone, function (sid) {
            return _statusChip(cc.missing.indexOf(sid) >= 0 ? 'NS' : 'EXC');
          }),
        ),
      );
    var html = cols.length
      ? '<div class="cr-cols cr-cols-' +
        cols.length +
        '">' +
        cols
          .map(function (c) {
            return '<div class="cr-col">' + c + '</div>';
          })
          .join('') +
        '</div>'
      : '';
    if (cc.complete.length) {
      html +=
        '<div class="cr-rule">' +
        _section(
          'Complete',
          cc.complete.length,
          _state.showDone ? _nameChips(cid, cc.complete, byId) : '',
          '<button type="button" class="cr-link" data-cr="toggleDone" aria-expanded="' +
            !!_state.showDone +
            '">' +
            (_state.showDone ? 'Hide Names' : 'Show Names') +
            '</button>',
        ) +
        '</div>';
    }
    var obs = _obsSection(cid, a, byId);
    if (obs) html += '<div class="cr-rule">' + obs + '</div>';
    return html;
  }

  /* ── Drawing ────────────────────────────────────────────── */
  function _bodyHtml(cid, a) {
    var students = _roster(cid);
    var byId = _byId(cid);
    var mode = _mode(a);
    var html = _header(cid, a);
    if (mode === 'dibels') return html + _dibelsBody(cid, a, students, byId);
    var avg = classColumnAverage(cid, students, { assessment: a });
    var st = classColumnStatusCounts(cid, students, a);
    if (mode === 'complete') {
      var cc = completionCounts(cid, students, a);
      return html + _summaryComplete(cid, a, students, avg, cc) + _completeBody(cid, a, students, byId, cc);
    }
    if (mode === 'points') {
      html += _summaryPoints(cid, a, students, avg, st) + _scoreSpread(cid, a, students);
    } else {
      html += _summaryLevel(cid, a, students, avg, st) + _resultsGrid(cid, a, students);
    }
    return (
      html +
      _columns(
        [_studentList(cid, a, students, byId), _missingList(cid, st, byId)],
        [_feedbackSection(cid, a, students, byId), _obsSection(cid, a, byId)],
      )
    );
  }

  function _panel() {
    return document.getElementById('class-results');
  }

  function _draw(keepScroll) {
    var panel = _panel();
    if (!panel || !_state) return;
    var a = _assessment(_state.cid, _state.aid);
    if (!a) {
      close();
      return;
    }
    // A picked cell, band or window that no longer holds anyone lets go.
    if (_state.sel) _state.sel = _pick(_state.sel.key);
    var top = keepScroll ? panel.scrollTop : 0;
    var focusKey =
      document.activeElement && panel.contains(document.activeElement) ? _focusKey(document.activeElement) : null;
    // html-safe: every string goes through esc; figures come from calc.js
    panel.innerHTML = _bodyHtml(_state.cid, a);
    panel.scrollTop = top;
    if (focusKey) {
      var again = panel.querySelector(focusKey);
      if (again) again.focus({ preventScroll: true });
    }
    _markOpener();
    _fillOtherClasses(_state.cid, a);
  }
  function _focusKey(el) {
    var cr = el.getAttribute && el.getAttribute('data-cr');
    if (!cr) return null;
    var key = el.getAttribute('data-key');
    var status = el.getAttribute('data-status');
    return (
      '[data-cr="' +
      cr +
      '"]' +
      (key ? '[data-key="' + CSS.escape(key) + '"]' : '') +
      (status ? '[data-status="' + status + '"]' : '')
    );
  }
  function _pick(key) {
    if (!_state || !key) return null;
    var a = _assessment(_state.cid, _state.aid);
    if (!a) return null;
    var students = _roster(_state.cid);
    var kind = String(key).split('|')[0];
    if (kind === 'band' || kind === 'level') return _pointsPick(_state.cid, a, students, key);
    if (kind === 'dibels') return _dibelsPick(_state.cid, a, students, key);
    return _gridPick(_state.cid, a, students, key);
  }
  // The Class Average cell (or button) for the open assessment is marked.
  function _markOpener() {
    document.querySelectorAll('.cr-is-open').forEach(function (el) {
      el.classList.remove('cr-is-open');
    });
    if (!_state) return;
    document
      .querySelectorAll('[data-action="classResults"][data-aid="' + CSS.escape(_state.aid) + '"]')
      .forEach(function (el) {
        el.classList.add('cr-is-open');
      });
  }

  /* ── Opening and closing ────────────────────────────────── */
  function open(cid, aid, opts) {
    opts = opts || {};
    var a = _assessment(cid, aid);
    var layout = document.getElementById('page-layout');
    if (!a || !layout) return;
    var pageOpts = _page ? _page(cid, aid) || {} : {};
    opts = Object.assign({}, pageOpts, opts);
    if (typeof opts.beforeOpen === 'function') opts.beforeOpen();
    if (typeof _helpOpen !== 'undefined' && _helpOpen && typeof setHelpOpen === 'function') setHelpOpen(false);
    var same = _state && _state.cid === cid && _state.aid === aid;
    var from = opts.from || (same ? _state.from : document.activeElement);
    _state = {
      cid: cid,
      aid: aid,
      opts: opts,
      from: from,
      sel: null,
      view: same ? _state.view : null,
      chart: same ? _state.chart : null,
      showAll: null,
      showWithout: false,
      showDone: false,
    };
    var panel = _panel();
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'class-results';
      panel.className = 'cr-panel';
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-labelledby', 'cr-title');
      panel.addEventListener('click', _onPanelClick);
      layout.appendChild(panel);
    }
    _draw(false);
    var title = document.getElementById('cr-title');
    if (title) title.focus({ preventScroll: true });
  }

  function close(restoreFocus) {
    _dismissMenu();
    var panel = _panel();
    var from = _state && _state.from;
    var aid = _state && _state.aid;
    _state = null;
    _otherToken++;
    if (panel) panel.remove();
    _markOpener();
    // A redraw replaces the cell that opened the panel: its new copy takes the focus.
    if (restoreFocus && from && !from.isConnected && aid)
      from = document.querySelector('[data-action="classResults"][data-aid="' + CSS.escape(aid) + '"]');
    if (restoreFocus && from && from.isConnected && typeof from.focus === 'function')
      from.focus({ preventScroll: true });
  }

  function refresh() {
    if (!_state || !_panel()) return;
    _draw(true);
  }

  function isOpen() {
    return !!_state && !!_panel();
  }

  /* The page in view says what the panel's buttons do there:
     fn(cid, aid) → { grade(aid), onChange(), markBlank(aid, status, sids),
     beforeOpen() }. A page that leaves calls setPage(null), which closes
     the panel. */
  function setPage(fn) {
    _page = typeof fn === 'function' ? fn : null;
    if (!_page) close();
  }

  // After the panel changes data: the page redraws (and refreshes the panel).
  function _changed() {
    if (!_state) return;
    if (typeof _state.opts.onChange === 'function') _state.opts.onChange();
    else {
      if (typeof clearProfCache === 'function') clearProfCache();
      refresh();
    }
  }

  /* Mark Missing / Mark Excused on the Unmarked list, where the page has no
     shared version of its own: the same rule as the gradebook's Mark Blank
     Cells (only cells with nothing in them), with an Undo toast. */
  function _markBlankHere(cid, aid, status, sids) {
    var a = _assessment(cid, aid);
    if (!a) return;
    var statuses = getAssignmentStatuses(cid);
    var marked = [];
    sids.forEach(function (sid) {
      var cell = assessmentCellValue(cid, sid, a);
      if (cell.kind === 'none' && !cell.status && canSetAssignmentStatus(cid, sid, aid, status)) {
        statuses[sid + ':' + aid] = status;
        marked.push(sid);
      }
    });
    if (!marked.length) return;
    Grader.markBlankCells(cid, aid, statuses);
    _changed();
    showUndoToast(
      marked.length +
        (marked.length === 1 ? ' blank cell' : ' blank cells') +
        ' marked ' +
        (status === 'NS' ? 'Missing' : 'Excused'),
      function () {
        var st = getAssignmentStatuses(cid);
        marked.forEach(function (sid) {
          if (st[sid + ':' + aid] === status) delete st[sid + ':' + aid];
        });
        Grader.undoMarkBlankCells(cid, aid, st);
        _changed();
      },
      null,
      10000,
    );
  }

  /* ── The view menus (Results by…, Score Spread as…) ──────── */
  var _menu = null;
  function _dismissMenu(focusBack) {
    if (!_menu) return;
    var m = _menu;
    _menu = null;
    document.removeEventListener('click', _menuAway, true);
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    if (m.btn && m.btn.isConnected) {
      m.btn.setAttribute('aria-expanded', 'false');
      if (focusBack) m.btn.focus();
    }
  }
  function _menuAway(e) {
    if (_menu && !_menu.el.contains(e.target) && e.target !== _menu.btn && !_menu.btn.contains(e.target))
      _dismissMenu();
  }
  function _openMenu(btn, items, onPick) {
    _dismissMenu();
    var el = document.createElement('div');
    el.className = 'cr-menu';
    el.setAttribute('role', 'menu');
    // html-safe: the items are fixed labels
    el.innerHTML = items
      .map(function (it) {
        return (
          '<button type="button" role="menuitemradio" aria-checked="' +
          !!it.on +
          '" data-v="' +
          esc(it.value) +
          '">' +
          esc(it.label) +
          '<span aria-hidden="true">' +
          (it.on ? '✓' : '') +
          '</span></button>'
        );
      })
      .join('');
    btn.parentNode.appendChild(el);
    btn.setAttribute('aria-expanded', 'true');
    _menu = { el: el, btn: btn };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      e.stopPropagation();
      _dismissMenu();
      onPick(b.getAttribute('data-v'));
    });
    el.addEventListener('keydown', function (e) {
      var list = Array.prototype.slice.call(el.querySelectorAll('[data-v]'));
      var at = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? (at + 1) % list.length : at <= 0 ? list.length - 1 : at - 1;
        list[next].focus();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        _dismissMenu(true);
      }
    });
    setTimeout(function () {
      document.addEventListener('click', _menuAway, true);
    }, 0);
    var first = el.querySelector('[aria-checked="true"]') || el.querySelector('[data-v]');
    if (first) first.focus();
  }

  /* ── Clicks in the panel ────────────────────────────────── */
  function _onPanelClick(e) {
    var el = e.target.closest('[data-cr]');
    if (!el || !_state) return;
    var what = el.getAttribute('data-cr');
    var cid = _state.cid;
    var aid = _state.aid;
    var a = _assessment(cid, aid);
    if (!a) return;
    if (what === 'close') close(true);
    else if (what === 'grade') {
      var grade = _state.opts.grade;
      if (typeof grade === 'function') grade(aid);
      else if (window.Router) Router.navigate('/assignments?course=' + cid + '&edit=' + aid);
    } else if (what === 'edit') {
      if (window.Router)
        Router.navigate('/assignments?course=' + encodeURIComponent(cid) + '&edit=' + encodeURIComponent(aid));
    } else if (what === 'print') {
      if (window.RubricPrint) RubricPrint.open(cid, aid);
    } else if (what === 'pick') {
      var key = el.getAttribute('data-key');
      _state.sel = _state.sel && _state.sel.key === key ? null : _pick(key);
      _state.showAll = null;
      _draw(true);
    } else if (what === 'clear') {
      _state.sel = null;
      _state.showAll = null;
      _draw(true);
    } else if (what === 'showAll') {
      _state.showAll = el.getAttribute('data-key');
      _draw(true);
    } else if (what === 'toggleWithout') {
      _state.showWithout = !_state.showWithout;
      _draw(true);
    } else if (what === 'toggleDone') {
      _state.showDone = !_state.showDone;
      _draw(true);
    } else if (what === 'observe') {
      var ids = String(el.getAttribute('data-ids') || '')
        .split(',')
        .filter(Boolean);
      if (!ids.length || !window.ObsCapture) return;
      ObsCapture.openDialog({
        cid: cid,
        title: 'Add Observation',
        subtitle: (a.title || 'Assessment') + ' · ' + ids.length + (ids.length === 1 ? ' student' : ' students'),
        students: ids,
        assessmentId: aid,
        lockAssessment: true,
        draftKey: 'class-results|' + aid,
        onAdd: _changed,
        onFlag: _changed,
      });
    } else if (what === 'markBlank') {
      var status = el.getAttribute('data-status') === 'EXC' ? 'EXC' : 'NS';
      var unmarked = completionCounts(cid, _roster(cid), a).unmarked;
      if (typeof _state.opts.markBlank === 'function') _state.opts.markBlank(aid, status, unmarked);
      else _markBlankHere(cid, aid, status, unmarked);
    } else if (what === 'viewMenu') {
      if (_menu && _menu.btn === el) return _dismissMenu();
      var view = _state.view === 'competency' ? 'competency' : 'rubric';
      _openMenu(
        el,
        [
          { value: 'rubric', label: 'by Rubric', on: view === 'rubric' },
          { value: 'competency', label: 'by Competency', on: view === 'competency' },
        ],
        function (v) {
          _state.view = v;
          _state.sel = null;
          _draw(true);
          var b = _panel() && _panel().querySelector('[data-cr="viewMenu"]');
          if (b) b.focus();
        },
      );
    } else if (what === 'chartMenu') {
      if (_menu && _menu.btn === el) return _dismissMenu();
      var chart = _state.chart || 'bars';
      _openMenu(
        el,
        CHARTS.map(function (c) {
          return { value: c[0], label: c[1].replace(/^as (a )?/, ''), on: c[0] === chart };
        }),
        function (v) {
          _state.chart = v;
          _state.sel = null;
          _draw(true);
          var b = _panel() && _panel().querySelector('[data-cr="chartMenu"]');
          if (b) b.focus();
        },
      );
    }
  }

  /* ── Anywhere in the app: data-action="classResults" ─────── */
  function _opener(e) {
    var el = e.target && e.target.closest && e.target.closest('[data-action="classResults"][data-aid]');
    if (!el) return null;
    var cid = el.getAttribute('data-cid');
    var aid = el.getAttribute('data-aid');
    return cid && aid ? { el: el, cid: cid, aid: aid } : null;
  }
  document.addEventListener('click', function (e) {
    var hit = _opener(e);
    if (!hit) return;
    e.preventDefault();
    if (_state && _state.cid === hit.cid && _state.aid === hit.aid && _panel()) {
      close(true);
      return;
    }
    open(hit.cid, hit.aid, { from: hit.el });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      var hit = _opener(e);
      // A real button already clicks on Enter and Space.
      if (!hit || hit.el.tagName === 'BUTTON' || hit.el.tagName === 'A') return;
      e.preventDefault();
      open(hit.cid, hit.aid, { from: hit.el });
      return;
    }
    // Escape closes the panel when the focus is in it (or on nothing, or on
    // what opened it), and no dialog or menu is open over the page.
    if (e.key !== 'Escape' || !_state || !_panel()) return;
    if (_menu) return;
    if (
      document.querySelector(
        '.confirm-overlay, [aria-modal="true"], .gb-ctx-menu, .tb-demo-menu.open, .tb-user-menu.open',
      )
    )
      return;
    var panel = _panel();
    var active = document.activeElement;
    var inPanel = active && panel.contains(active);
    var onOpener = active && active.matches && active.matches('[data-action="classResults"]');
    if (!inPanel && !onOpener && active && active !== document.body) return;
    e.preventDefault();
    close(true);
  });

  return {
    open: open,
    close: close,
    refresh: refresh,
    isOpen: isOpen,
    setPage: setPage,
    cardHtml: cardHtml,
    assessmentObservations: assessmentObservations,
    otherClassesResults: otherClassesResults,
  };
})();
