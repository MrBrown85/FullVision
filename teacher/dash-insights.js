/* dash-insights.js — the dashboard's class insights: the proficiency mix on
   each competency, Who Needs Help, Missing and Late, and the student grid. */
window.DashInsights = (function () {
  'use strict';

  var GLYPHS = { 1: '○', 2: '◐', 3: '●', 4: '◆' };
  var DEFAULT_RULE = { below: 3, min: 3 };

  /* The class's competencies as the dashboard lists them: each group, then
     the sections outside a group; every section when there are no groups.
     Each has `which` for competencyDistribution, its short `label`, its
     full `title`, and `sectionIds`. */
  function columns(cid) {
    var grouped = getGroupedSections(cid);
    var hasGroups = grouped.groups.some(function (g) {
      return g.sections.length > 0;
    });
    var secCol = function (sec) {
      var tag = sec.tags && sec.tags[0];
      return {
        key: 's:' + sec.id,
        which: { sectionId: sec.id },
        label: sec.shortName || (tag && (tag.label || tag.code || tag.name)) || sec.name || '',
        title: sec.name || '',
        color: sec.color,
        sectionIds: [sec.id],
      };
    };
    if (!hasGroups) return getSections(cid).map(secCol);
    var out = [];
    grouped.groups.forEach(function (gi) {
      if (!gi.sections.length) return;
      out.push({
        key: 'g:' + gi.group.id,
        which: { groupId: gi.group.id },
        label: gi.group.name,
        title: gi.group.name,
        color: gi.group.color,
        sectionIds: gi.sections.map(function (s) {
          return s.id;
        }),
      });
    });
    grouped.ungrouped.forEach(function (sec) {
      out.push(secCol(sec));
    });
    return out;
  }

  function showsProficiency(cid) {
    return courseGradeMode(cid) !== 'letter';
  }

  function _ids(students) {
    return students.map(function (s) {
      return s.id;
    });
  }

  function _byId(students) {
    var m = {};
    students.forEach(function (s) {
      m[s.id] = s;
    });
    return m;
  }

  function _studentHref(cid, sid, tab) {
    return '#/student?id=' + sid + '&course=' + cid + (tab ? '&tab=' + tab : '');
  }

  // A student's name with their proficiency on one competency, tinted by it.
  function _personChip(cid, st, value) {
    var level = value > 0 ? Math.max(1, Math.min(4, Math.round(value))) : 0;
    return (
      '<a class="dash-ins-person" role="link" tabindex="0" data-href="' +
      _studentHref(cid, st.id, 'comps') +
      '" style="' +
      (level ? 'background:var(--score-' + level + '-bg);color:var(--score-' + level + '-text)' : '') +
      '"><span class="dash-ins-name">' +
      esc(DashObservations.rowName(st)) +
      '</span>' +
      (value > 0 ? '<span class="dash-ins-val">' + esc(formatLevel(cid, value)) + '</span>' : '') +
      '</a>'
    );
  }

  /* ── Proficiency mix (Curricular Competencies) ─────────────
     One bar per competency, a segment per proficiency with its count. A
     segment opens the list of its students (popHtml). */
  function mixListHtml(cid, allStudents, pop) {
    var ids = _ids(allStudents);
    var html = '<div class="dash-outcome-list dash-mix-list" tabindex="0" aria-label="Curricular competencies">';
    columns(cid).forEach(function (col) {
      var dist = competencyDistribution(cid, ids, col.which);
      var scored = dist.bands.reduce(function (n, b) {
        return n + b.ids.length;
      }, 0);
      html +=
        '<div class="dash-mix-row">' +
        '<span class="dash-outcome-label" title="' +
        esc(col.title) +
        '" style="color:' +
        tintText(col.color) +
        '">' +
        esc(col.label) +
        '</span>' +
        '<div class="dash-mix-bar">';
      if (!scored) html += '<span class="dash-mix-empty">Not Scored</span>';
      dist.bands.forEach(function (b) {
        if (!b.ids.length) return;
        var on = pop && pop.key === col.key && pop.level === b.level;
        html +=
          '<button type="button" class="dash-mix-seg' +
          (on ? ' active' : '') +
          '" data-action="mixSeg" data-key="' +
          esc(col.key) +
          '" data-level="' +
          b.level +
          '" aria-expanded="' +
          on +
          '" aria-label="' +
          esc(col.title + ': ' + b.ids.length + ' ' + b.label) +
          '" style="flex:' +
          b.ids.length +
          ' 1 0;background:var(--score-' +
          b.level +
          '-bg);color:var(--score-' +
          b.level +
          '-text)">' +
          b.ids.length +
          '</button>';
      });
      html +=
        '</div>' +
        '<span class="dash-outcome-val" style="color:' +
        (dist.avg > 0 ? PROF_COLORS[Math.round(dist.avg)] : 'var(--text-3)') +
        '">' +
        esc(formatLevel(cid, dist.avg)) +
        '</span>' +
        '</div>';
    });
    return html + '</div>';
  }

  function mixLegendHtml(cid) {
    return (
      '<div class="dash-mix-legend">' +
      levelOrderFor(cid)
        .map(function (l) {
          return '<span><i style="background:var(--score-' + l + ')"></i>' + esc(PROF_LABELS[l]) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  /* The students on one segment, for the popover page-dashboard.js places
     under it. '' when the segment is gone (another term, a removed score). */
  function popHtml(cid, allStudents, pop) {
    if (!pop) return '';
    var col = columns(cid).find(function (c) {
      return c.key === pop.key;
    });
    if (!col) return '';
    var dist = competencyDistribution(cid, _ids(allStudents), col.which);
    var band = dist.bands[pop.level - 1];
    if (!band || !band.ids.length) return '';
    var byId = _byId(allStudents);
    var people = band.ids
      .slice()
      .sort(function (a, b) {
        return dist.values[a] - dist.values[b];
      })
      .map(function (sid) {
        return _personChip(cid, byId[sid], dist.values[sid]);
      })
      .join('');
    return (
      '<div class="dash-mix-pop-head"><span>' +
      esc(col.label + ' · ' + band.label + ' · ' + band.ids.length) +
      '</span><button type="button" class="dash-mix-pop-close" data-action="mixClose" aria-label="Close">×</button></div>' +
      '<div class="dash-ins-people">' +
      people +
      '</div>' +
      '<a class="dash-ins-link" role="link" tabindex="0" data-href="' +
      _gradebookHref(cid, band.ids, col) +
      '">Open These Students in Gradebook →</a>'
    );
  }

  function _gradebookHref(cid, ids, col) {
    return (
      '#/gradebook?course=' +
      cid +
      '&students=' +
      ids.join(',') +
      (col && col.sectionIds.length === 1 ? '&section=' + col.sectionIds[0] : '')
    );
  }

  /* ── Who Needs Help ─────────────────────────────────────── */
  // The saved rule ({ below, min }) with anything missing or out of range
  // set to the default: below Proficient, at least 3 scores.
  function readRule(saved) {
    var r = saved && typeof saved === 'object' ? saved : {};
    return {
      below: r.below === 2 ? 2 : DEFAULT_RULE.below,
      min: r.min >= 1 && r.min <= 5 ? Math.round(r.min) : DEFAULT_RULE.min,
    };
  }

  function _ruleText(rule) {
    return 'Below ' + PROF_LABELS[rule.below] + ' · At Least ' + rule.min + ' Score' + (rule.min === 1 ? '' : 's');
  }

  /* Competencies with students under the rule, those with the same students
     together, most students first. Each: { cols, ids, values }. Also the
     students under it on most competencies (`wide`, at least `wideMin`). */
  function helpGroups(cid, allStudents, rule) {
    var ids = _ids(allStudents);
    var cols = columns(cid);
    var perStudent = {};
    var groups = [];
    cols.forEach(function (col) {
      var dist = competencyDistribution(cid, ids, col.which);
      var below = ids.filter(function (sid) {
        var v = dist.values[sid];
        if (!(v > 0) || Math.round(v) >= rule.below) return false;
        var evidence = col.sectionIds.reduce(function (n, secId) {
          return n + getSectionEvidenceCount(cid, sid, secId);
        }, 0);
        return evidence >= rule.min;
      });
      below.forEach(function (sid) {
        perStudent[sid] = (perStudent[sid] || 0) + 1;
      });
      if (!below.length) return;
      var key = below.slice().sort().join(',');
      var g = groups.find(function (x) {
        return x.key === key;
      });
      if (g) g.cols.push(col);
      else groups.push({ key: key, cols: [col], ids: below, values: dist.values });
    });
    groups.sort(function (a, b) {
      return b.ids.length - a.ids.length || a.cols.length - b.cols.length;
    });
    var wideMin = Math.max(2, Math.ceil((cols.length * 2) / 3));
    var wide =
      cols.length >= 3
        ? ids.filter(function (sid) {
            return (perStudent[sid] || 0) >= wideMin;
          })
        : [];
    return { groups: groups, wide: wide, wideMin: wideMin };
  }

  function helpCardHtml(cid, allStudents, rule, ruleOpen) {
    rule = rule || readRule(null);
    var res = helpGroups(cid, allStudents, rule);
    var byId = _byId(allStudents);
    var html =
      '<section class="dash-overview-section dash-help-card" aria-labelledby="dash-help-title">' +
      '<div class="dash-section-title"><span id="dash-help-title">Who Needs Help</span>' +
      '<span class="dash-help-rule">' +
      esc(_ruleText(rule)) +
      '</span>' +
      '<button type="button" class="dash-help-rule-btn" data-action="helpRule" aria-expanded="' +
      !!ruleOpen +
      '">Change Rule</button></div>';
    if (ruleOpen) {
      html +=
        '<div class="dash-help-rule-edit">' +
        '<label>Below <select data-action="helpRuleBelow" aria-label="Below">' +
        [3, 2]
          .map(function (l) {
            return (
              '<option value="' + l + '"' + (rule.below === l ? ' selected' : '') + '>' + PROF_LABELS[l] + '</option>'
            );
          })
          .join('') +
        '</select></label>' +
        '<label>At Least <select data-action="helpRuleMin" aria-label="At least">' +
        [1, 2, 3, 4, 5]
          .map(function (n) {
            return '<option value="' + n + '"' + (rule.min === n ? ' selected' : '') + '>' + n + '</option>';
          })
          .join('') +
        '</select> Scores on the Competency</label>' +
        '<button type="button" class="dash-help-rule-btn" data-action="helpRule">Done</button>' +
        '</div>';
    }
    if (!res.groups.length) {
      return (
        html +
        '<div class="dash-ins-empty">Every scored student is at ' +
        esc(PROF_LABELS[rule.below]) +
        ' or above.</div></section>'
      );
    }
    html += '<div class="dash-help-list">';
    res.groups.forEach(function (g) {
      var single = g.cols.length === 1;
      var people = g.ids
        .slice()
        .sort(function (a, b) {
          return single ? g.values[a] - g.values[b] : 0;
        })
        .map(function (sid) {
          return _personChip(cid, byId[sid], single ? g.values[sid] : 0);
        })
        .join('');
      html +=
        '<div class="dash-help-item">' +
        '<div class="dash-help-comps"><strong>' +
        esc(
          g.cols
            .map(function (c) {
              return c.title;
            })
            .join(', '),
        ) +
        '</strong><span class="dash-help-count">' +
        g.ids.length +
        ' Below ' +
        esc(PROF_LABELS[rule.below]) +
        (single ? '' : ' on Each') +
        '</span></div>' +
        '<div class="dash-ins-people">' +
        people +
        '</div>' +
        '<a class="dash-ins-link" role="link" tabindex="0" data-href="' +
        _gradebookHref(cid, g.ids, single ? g.cols[0] : null) +
        '">Open in Gradebook →</a>' +
        '</div>';
    });
    html += '</div>';
    if (res.wide.length) {
      html +=
        '<div class="dash-help-wide"><span class="dash-help-wide-label">Below ' +
        esc(PROF_LABELS[rule.below]) +
        ' on ' +
        res.wideMin +
        ' or More Competencies</span>' +
        res.wide
          .map(function (sid) {
            return (
              '<a class="dash-ins-name" role="link" tabindex="0" data-href="' +
              _studentHref(cid, sid, 'comps') +
              '">' +
              esc(DashObservations.rowName(byId[sid])) +
              '</a>'
            );
          })
          .join('') +
        '</div>';
    }
    return html + '</section>';
  }

  /* ── Missing and Late ───────────────────────────────────── */
  var MISSING_KINDS = {
    ns: { label: 'Not Submitted', cls: 'is-ns' },
    late: { label: 'Late', cls: 'is-late' },
    due: { label: 'Past Due', cls: 'is-due' },
  };

  /* Work marked Not Submitted or Late, and work past its due date with no
     score, in the active term. Newest assessment first. */
  function missingItems(cid, allStudents, todayStr) {
    var assessments = getAssessments(cid)
      .filter(function (a) {
        return assessmentInActiveTerm(cid, a);
      })
      .sort(function (a, b) {
        return (b.dueDate || b.date || '').localeCompare(a.dueDate || a.date || '');
      });
    var items = [];
    assessments.forEach(function (a) {
      allStudents.forEach(function (st) {
        var status = getAssignmentStatus(cid, st.id, a.id);
        var kind = status === 'NS' ? 'ns' : status === 'LATE' ? 'late' : null;
        if (!kind && !status && a.dueDate && a.dueDate < todayStr) {
          if (assessmentCellValue(cid, st.id, a, todayStr).kind === 'missing') kind = 'due';
        }
        if (kind) items.push({ kind: kind, student: st, assessment: a });
      });
    });
    return items;
  }

  function missingCardHtml(cid, allStudents, todayStr) {
    var items = missingItems(cid, allStudents, todayStr);
    var counts = { ns: 0, late: 0, due: 0 };
    items.forEach(function (it) {
      counts[it.kind]++;
    });
    var html =
      '<section class="dash-overview-section dash-missing-card" aria-labelledby="dash-missing-title">' +
      '<div class="dash-section-title"><span id="dash-missing-title">Missing and Late</span></div>' +
      '<div class="dash-quick-stats">' +
      ['ns', 'late', 'due']
        .map(function (k) {
          return (
            '<div class="dash-mini-stat"><div class="dash-mini-stat-val dash-missing-num ' +
            MISSING_KINDS[k].cls +
            '">' +
            counts[k] +
            '</div><div class="dash-mini-stat-label">' +
            (k === 'due' ? 'Past Due, No Score' : MISSING_KINDS[k].label) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>';
    if (!items.length) return html + '<div class="dash-ins-empty">Nothing is missing or late.</div></section>';
    html += '<div class="dash-missing-list">';
    items.forEach(function (it) {
      html +=
        '<div class="dash-missing-row">' +
        '<a class="dash-ins-name" role="link" tabindex="0" data-href="' +
        _studentHref(cid, it.student.id, 'assess') +
        '">' +
        esc(DashObservations.rowName(it.student)) +
        '</a>' +
        '<span class="dash-missing-title" title="' +
        esc(it.assessment.title || '') +
        '">' +
        esc(it.assessment.title || 'Untitled') +
        '</span>' +
        '<span class="dash-missing-tag ' +
        MISSING_KINDS[it.kind].cls +
        '">' +
        MISSING_KINDS[it.kind].label +
        '</span>' +
        '</div>';
    });
    return html + '</div></section>';
  }

  /* ── Students: Cards | Grid ─────────────────────────────── */
  function studentsHeaderHtml(view, namesHidden) {
    var seg = function (id, label) {
      var on = view === id;
      return (
        '<button type="button" class="seg-btn" data-action="studentView" data-view="' +
        id +
        '" aria-pressed="' +
        on +
        '">' +
        label +
        '</button>'
      );
    };
    return (
      '<div class="dash-students-head">' +
      '<h2 class="dash-students-title">Students</h2>' +
      '<div class="seg seg-sm dash-view-toggle" role="group" aria-label="Show students as">' +
      seg('cards', 'Cards') +
      seg('grid', 'Grid') +
      '</div>' +
      '<button type="button" class="dash-ob2-tool" data-action="studentNames" aria-pressed="' +
      !!namesHidden +
      '">' +
      (namesHidden ? 'Show Names' : 'Hide Names') +
      '</button>' +
      '</div>'
    );
  }

  function _obsWhen(daysSince) {
    if (daysSince == null) return 'None Yet';
    if (daysSince === 0) return 'Today';
    if (daysSince === 1) return 'Yesterday';
    return daysSince + ' days ago';
  }

  // A competency cell: the value as the class shows it, tinted by its
  // proficiency, with the proficiency's shape unless the class is Letter.
  function _cellHtml(cid, value, title, prof) {
    var level = value > 0 ? Math.max(1, Math.min(4, Math.round(value))) : 0;
    if (!level) return '<td class="dash-sg-cell"><span class="dash-sg-none" title="' + esc(title) + '">—</span></td>';
    return (
      '<td class="dash-sg-cell"><span class="dash-sg-val" title="' +
      esc(title + ': ' + formatLevel(cid, value) + (prof ? ' ' + PROF_LABELS[level] : '')) +
      '" style="background:var(--score-' +
      level +
      '-bg);color:var(--score-' +
      level +
      '-text)">' +
      (prof ? '<span aria-hidden="true">' + GLYPHS[level] + '</span> ' : '') +
      esc(formatLevel(cid, value)) +
      '</span></td>'
    );
  }

  /* A row per student (the filtered, sorted list), a column per competency
     with a count of students at each proficiency over it, and the class
     average under it. */
  function studentGridHtml(cid, students, allStudents) {
    var cols = columns(cid);
    var allIds = _ids(allStudents);
    var prof = showsProficiency(cid);
    var dists = cols.map(function (col) {
      return competencyDistribution(cid, allIds, col.which);
    });
    var today = getTodayStr();
    var term = getActiveTerm(cid);
    var html = '<div class="dash-section"><div class="dash-sg-wrap"><table class="dash-sg"><thead><tr>';
    html += '<th scope="col" class="dash-sg-name-h">Student</th><th scope="col">Overall</th>';
    cols.forEach(function (col, i) {
      var d = dists[i];
      var max = Math.max.apply(
        null,
        d.bands.map(function (b) {
          return b.ids.length;
        }),
      );
      html += '<th scope="col" title="' + esc(col.title) + '">';
      if (prof) {
        html +=
          '<span class="dash-sg-hist" role="img" aria-label="' +
          esc(
            col.title +
              ': ' +
              d.bands
                .map(function (b) {
                  return b.ids.length + ' ' + b.label;
                })
                .join(', '),
          ) +
          '">' +
          d.bands
            .map(function (b) {
              return (
                '<span class="dash-sg-hbar"><span class="dash-sg-hn">' +
                b.ids.length +
                '</span><span class="dash-sg-hfill" style="height:' +
                (max ? Math.round((b.ids.length / max) * 28) + 2 : 2) +
                'px;background:var(--score-' +
                b.level +
                ')"></span></span>'
              );
            })
            .join('') +
          '</span>';
      }
      html += '<span class="dash-sg-col">' + esc(col.label) + '</span></th>';
    });
    html += '<th scope="col" class="dash-sg-obs-h">Last Observed</th></tr></thead><tbody>';
    students.forEach(function (st) {
      var grade = studentGradeSummary(cid, st.id);
      var sum = DashStudentCards.obsSummary(getStudentQuickObs(cid, st.id), today, term);
      html +=
        '<tr><th scope="row" class="dash-sg-name"><a class="dash-ins-name" role="link" tabindex="0" data-href="' +
        _studentHref(cid, st.id) +
        '">' +
        esc(DashObservations.rowName(st)) +
        '</a></th>' +
        '<td class="dash-sg-cell">' +
        (grade.text
          ? '<span class="dash-sg-val dash-sg-overall" style="background:var(--score-' +
            grade.level +
            '-bg);color:var(--score-' +
            grade.level +
            '-text)">' +
            (prof && GLYPHS[grade.level] ? '<span aria-hidden="true">' + GLYPHS[grade.level] + '</span> ' : '') +
            esc(grade.text) +
            '</span>'
          : '<span class="dash-sg-none">—</span>') +
        '</td>';
      cols.forEach(function (col, i) {
        html += _cellHtml(cid, dists[i].values[st.id] || 0, col.title, prof);
      });
      html +=
        '<td class="dash-sg-obs' +
        (sum.overdue || sum.daysSince == null ? ' is-overdue' : '') +
        '">' +
        esc(_obsWhen(sum.daysSince)) +
        '</td></tr>';
    });
    html +=
      '</tbody><tfoot><tr><th scope="row">Class Avg</th><td class="dash-sg-cell">' +
      esc(classGradeSummary(cid, allIds).text || '—') +
      '</td>';
    dists.forEach(function (d) {
      html += '<td class="dash-sg-cell">' + esc(formatLevel(cid, d.avg)) + '</td>';
    });
    html += '<td></td></tr></tfoot></table></div>';
    if (prof) {
      html +=
        '<div class="dash-sg-legend">' +
        levelOrderFor(cid)
          .map(function (l) {
            return '<span><span aria-hidden="true">' + GLYPHS[l] + '</span> ' + esc(PROF_LABELS[l]) + '</span>';
          })
          .join('') +
        '</div>';
    }
    return html + '</div>';
  }

  return {
    columns: columns,
    showsProficiency: showsProficiency,
    mixListHtml: mixListHtml,
    mixLegendHtml: mixLegendHtml,
    popHtml: popHtml,
    readRule: readRule,
    helpGroups: helpGroups,
    helpCardHtml: helpCardHtml,
    missingItems: missingItems,
    missingCardHtml: missingCardHtml,
    studentsHeaderHtml: studentsHeaderHtml,
    studentGridHtml: studentGridHtml,
  };
})();
