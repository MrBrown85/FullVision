/* dash-insights.js — the dashboard's class insights: the proficiency mix on
   each competency, Needs Attention (the Who Needs Help rule, observation
   gaps and missing work, one row per student), Missing and Late, and the
   student grid. */
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
    return '/student?id=' + sid + '&course=' + cid + (tab ? '&tab=' + tab : '');
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
     One thin bar per competency, a segment per proficiency. A segment opens
     the list of its students (popHtml). "N Below" shows the competency's
     students under the Needs Attention rule in that list (data-action
     naComp); `below` maps a column key to that count. */
  function mixListHtml(cid, allStudents, pop, below, comp) {
    var ids = _ids(allStudents);
    below = below || {};
    var html = '<div class="dash-mix-list" aria-label="Curricular competencies">';
    columns(cid).forEach(function (col) {
      var dist = competencyDistribution(cid, ids, col.which);
      var scored = dist.bands.reduce(function (n, b) {
        return n + b.ids.length;
      }, 0);
      var n = below[col.key] || 0;
      html +=
        '<div class="dash-mix-row' +
        (comp === col.key ? ' is-picked' : '') +
        '">' +
        '<span class="dash-mix-label" title="' +
        esc(col.title) +
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
          ' 1 0;--seg:var(--score-' +
          b.level +
          ')"></button>';
      });
      html +=
        '</div>' +
        '<span class="dash-mix-avg">' +
        esc(scored ? formatLevel(cid, dist.avg) : '\u2014') +
        '</span>' +
        (n
          ? '<button type="button" class="dash-mix-below" data-action="naComp" data-key="' +
            esc(col.key) +
            '" aria-pressed="' +
            (comp === col.key) +
            '" aria-label="' +
            esc(n + ' below on ' + col.title) +
            '"><b>' +
            n +
            '</b> Below</button>'
          : '<span class="dash-mix-below is-none">None Below</span>') +
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
      '/gradebook?course=' +
      cid +
      '&students=' +
      ids.join(',') +
      (col && col.sectionIds.length === 1 ? '&section=' + col.sectionIds[0] : '')
    );
  }

  /* ── Who Needs Help rule ────────────────────────────────── */
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

  /* Each competency with the students under the rule on it: their value is
     below the rule's proficiency and rests on at least `min` scores.
     → [{ col, ids, values }] in column order */
  function belowLists(cid, allStudents, rule) {
    var ids = _ids(allStudents);
    return columns(cid).map(function (col) {
      var dist = competencyDistribution(cid, ids, col.which);
      var below = ids.filter(function (sid) {
        var v = dist.values[sid];
        if (!(v > 0) || Math.round(v) >= rule.below) return false;
        var evidence = col.sectionIds.reduce(function (n, secId) {
          return n + getSectionEvidenceCount(cid, sid, secId);
        }, 0);
        return evidence >= rule.min;
      });
      return { col: col, ids: below, values: dist.values };
    });
  }

  /* Competencies with students under the rule, those with the same students
     together, most students first. Each: { cols, ids, values }. Also the
     students under it on most competencies (`wide`, at least `wideMin`). */
  function helpGroups(cid, allStudents, rule) {
    var ids = _ids(allStudents);
    var lists = belowLists(cid, allStudents, rule);
    var perStudent = {};
    var groups = [];
    lists.forEach(function (l) {
      l.ids.forEach(function (sid) {
        perStudent[sid] = (perStudent[sid] || 0) + 1;
      });
      if (!l.ids.length) return;
      var key = l.ids.slice().sort().join(',');
      var g = groups.find(function (x) {
        return x.key === key;
      });
      if (g) g.cols.push(l.col);
      else groups.push({ key: key, cols: [l.col], ids: l.ids, values: l.values });
    });
    groups.sort(function (a, b) {
      return b.ids.length - a.ids.length || a.cols.length - b.cols.length;
    });
    var wideMin = Math.max(2, Math.ceil((lists.length * 2) / 3));
    var wide =
      lists.length >= 3
        ? ids.filter(function (sid) {
            return (perStudent[sid] || 0) >= wideMin;
          })
        : [];
    return { groups: groups, wide: wide, wideMin: wideMin };
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

  function missingCounts(items) {
    var counts = { ns: 0, late: 0, due: 0, total: items.length };
    items.forEach(function (it) {
      counts[it.kind]++;
    });
    return counts;
  }

  /* The top bar's Missing and Late cell. Zero says so in a line; otherwise
     the three counts, and a click shows those students in Needs Attention. */
  function missingGlanceHtml(items) {
    var c = missingCounts(items);
    var html =
      '<button type="button" class="dash-glance-cell dash-glance-missing" data-action="naFilter" data-filter="missing"' +
      (c.total ? '' : ' disabled') +
      '>' +
      '<span class="dash-glance-label">Missing and Late</span>' +
      '<span class="dash-glance-value">' +
      c.total +
      '</span>';
    if (!c.total) return html + '<span class="dash-glance-sub">Nothing is missing or late.</span></button>';
    return (
      html +
      '<span class="dash-glance-sub">' +
      ['ns', 'late', 'due']
        .map(function (k) {
          return '<b>' + c[k] + '</b> ' + MISSING_KINDS[k].label;
        })
        .join(' · ') +
      '</span></button>'
    );
  }

  /* ── Needs Attention ────────────────────────────────────── */
  /* One entry per student who needs something: competencies under the rule
     (not in a Letter class), no observation in 3+ weeks, no strength
     recorded in the Observations card's By week window, and missing or late
     work. Worst first.
       opts: { rule, todayStr }
     → { prof, rule, lists, people: [{ student, below, overdue, daysSince,
         noStrength, missing }], counts } */
  function attentionModel(cid, allStudents, opts) {
    opts = opts || {};
    var today = opts.todayStr || getTodayStr();
    var prof = showsProficiency(cid);
    var rule = readRule(opts.rule);
    var lists = prof ? belowLists(cid, allStudents, rule) : [];
    var belowBy = {};
    lists.forEach(function (l) {
      l.ids.forEach(function (sid) {
        (belowBy[sid] = belowBy[sid] || []).push({ col: l.col, value: l.values[sid] });
      });
    });
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var win = DashObservations.weekWindow(today, term);
    var rows = allStudents.map(function (st) {
      return DashObservations.weekRow(st, getStudentQuickObs(cid, st.id).slice(), win, today);
    });
    // As on the Observations card: a class with no observations at all has
    // nobody overdue yet.
    var classObserved = rows.some(function (r) {
      return r.observed;
    });
    var missingBy = {};
    missingItems(cid, allStudents, today).forEach(function (it) {
      (missingBy[it.student.id] = missingBy[it.student.id] || []).push(it);
    });
    var people = [];
    allStudents.forEach(function (st, i) {
      var r = rows[i];
      var p = {
        student: st,
        below: belowBy[st.id] || [],
        overdue: classObserved && r.overdue,
        daysSince: r.daysSince,
        noStrength: r.noStrength,
        missing: missingBy[st.id] || [],
      };
      if (p.below.length || p.overdue || p.noStrength || p.missing.length) people.push(p);
    });
    var weight = function (p) {
      return p.below.length * 2 + (p.overdue ? 3 : 0) + (p.noStrength ? 2 : 0) + p.missing.length * 2;
    };
    people.sort(function (a, b) {
      return (
        weight(b) - weight(a) ||
        (getOverallProficiency(cid, a.student.id) || 9) - (getOverallProficiency(cid, b.student.id) || 9) ||
        (a.student.lastName || '').localeCompare(b.student.lastName || '') ||
        (a.student.firstName || '').localeCompare(b.student.firstName || '')
      );
    });
    var count = function (fn) {
      return people.filter(fn).length;
    };
    return {
      prof: prof,
      rule: rule,
      lists: lists,
      people: people,
      counts: {
        all: people.length,
        below: count(function (p) {
          return p.below.length > 0;
        }),
        notobs: count(function (p) {
          return p.overdue;
        }),
        nostr: count(function (p) {
          return p.noStrength;
        }),
        missing: count(function (p) {
          return p.missing.length > 0;
        }),
      },
    };
  }

  /** Each competency's count of students under the rule, by column key. */
  function belowCounts(model) {
    var out = {};
    (model.lists || []).forEach(function (l) {
      out[l.col.key] = l.ids.length;
    });
    return out;
  }

  var DIAMOND =
    '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="M6 1.2 10.8 6 6 10.8 1.2 6Z"/></svg>';

  // A competency value with its proficiency's shape and colour.
  function _compFact(cid, col, value, prefix) {
    var level = value > 0 ? Math.max(1, Math.min(4, Math.round(value))) : 0;
    return (
      (prefix ? prefix + ' ' : '') +
      (level
        ? '<span class="dash-na-glyph" style="color:var(--score-' +
          level +
          ')" aria-hidden="true">' +
          GLYPHS[level] +
          '</span>'
        : '') +
      esc(col.label) +
      ' <b>' +
      esc(formatLevel(cid, value)) +
      '</b>'
    );
  }

  function _facts(cid, m, p, comp) {
    var f = [];
    if (comp) {
      var hit = p.below.find(function (b) {
        return b.col.key === comp;
      });
      if (hit) f.push(_compFact(cid, hit.col, hit.value));
    } else if (p.below.length === 1) {
      f.push(_compFact(cid, p.below[0].col, p.below[0].value));
    } else if (p.below.length > 1) {
      var low = p.below.reduce(function (a, b) {
        return b.value < a.value ? b : a;
      });
      f.push('Below ' + esc(PROF_LABELS[m.rule.below]) + ' on <b>' + p.below.length + '</b> of ' + m.lists.length);
      f.push(_compFact(cid, low.col, low.value, 'Lowest'));
    }
    if (p.overdue) {
      f.push(
        '<span class="is-late">' +
          (p.daysSince == null ? 'No observations yet' : 'Not observed in <b>' + p.daysSince + '</b> days') +
          '</span>',
      );
    }
    if (p.noStrength) f.push('<span class="dash-na-diamond">' + DIAMOND + '</span>No strength recorded');
    p.missing.slice(0, 2).forEach(function (it) {
      f.push(
        '<span class="is-late">' + MISSING_KINDS[it.kind].label + ':</span> ' + esc(it.assessment.title || 'Untitled'),
      );
    });
    if (p.missing.length > 2) f.push(p.missing.length - 2 + ' more missing or late');
    return f
      .map(function (x) {
        return '<span class="dash-na-fact">' + x + '</span>';
      })
      .join(' <span class="dash-na-sep" aria-hidden="true">·</span> ');
  }

  var NA_FILTERS = ['all', 'below', 'notobs', 'nostr', 'missing'];
  var NA_EMPTY = {
    all: 'No one needs attention right now.',
    below: '',
    notobs: 'Everyone has an observation in the last 3 weeks.',
    nostr: 'Every observed student has a strength recorded.',
    missing: 'Nothing is missing or late.',
  };

  function _matches(p, filter, comp) {
    if (comp) {
      return p.below.some(function (b) {
        return b.col.key === comp;
      });
    }
    if (filter === 'below') return p.below.length > 0;
    if (filter === 'notobs') return p.overdue;
    if (filter === 'nostr') return p.noStrength;
    if (filter === 'missing') return p.missing.length > 0;
    return true;
  }

  /* The Needs Attention card.
       view: { filter, comp, ruleOpen, classItems: [{ text, link, linkText }] } */
  function attentionCardHtml(cid, m, view) {
    view = view || {};
    var filter = NA_FILTERS.indexOf(view.filter) >= 0 ? view.filter : 'all';
    if (!m.prof && filter === 'below') filter = 'all';
    var comp = m.prof && view.comp ? view.comp : null;
    var compCol = comp
      ? (
          m.lists.find(function (l) {
            return l.col.key === comp;
          }) || {}
        ).col
      : null;
    if (comp && !compCol) comp = null;
    var shown = m.people.filter(function (p) {
      return _matches(p, filter, comp);
    });
    if (comp) {
      shown.sort(function (a, b) {
        var va = a.below.find(function (x) {
          return x.col.key === comp;
        }).value;
        var vb = b.below.find(function (x) {
          return x.col.key === comp;
        }).value;
        return va - vb;
      });
    }
    var html =
      '<section class="dash-overview-section dash-na-card" id="dash-na-card" aria-labelledby="dash-na-title">' +
      '<div class="dash-na-head">' +
      '<h2 class="dash-na-title" id="dash-na-title">Needs Attention</h2>' +
      '<span class="dash-na-count">' +
      shown.length +
      ' student' +
      (shown.length === 1 ? '' : 's') +
      '</span>';
    if (m.prof) {
      html +=
        '<span class="dash-help-rule">' +
        esc(_ruleText(m.rule)) +
        '</span>' +
        '<button type="button" class="dash-help-rule-btn" data-action="helpRule" aria-expanded="' +
        !!view.ruleOpen +
        '">Change Rule</button>';
    }
    html += '</div>';
    if (m.prof && view.ruleOpen) {
      html +=
        '<div class="dash-help-rule-edit">' +
        '<label>Below <select data-action="helpRuleBelow" aria-label="Below">' +
        [3, 2]
          .map(function (l) {
            return (
              '<option value="' + l + '"' + (m.rule.below === l ? ' selected' : '') + '>' + PROF_LABELS[l] + '</option>'
            );
          })
          .join('') +
        '</select></label>' +
        '<label>At Least <select data-action="helpRuleMin" aria-label="At least">' +
        [1, 2, 3, 4, 5]
          .map(function (n) {
            return '<option value="' + n + '"' + (m.rule.min === n ? ' selected' : '') + '>' + n + '</option>';
          })
          .join('') +
        '</select> Scores on the Competency</label>' +
        '<button type="button" class="dash-help-rule-btn" data-action="helpRule">Done</button>' +
        '</div>';
    }
    var labels = {
      all: 'All',
      below: 'Below ' + PROF_LABELS[m.rule.below],
      notobs: 'Not Observed 3+ Weeks',
      nostr: 'No Strength',
      missing: 'Missing',
    };
    html += '<div class="dash-na-filters"><div class="seg seg-sm dash-na-seg" role="group" aria-label="Show students">';
    NA_FILTERS.forEach(function (k) {
      if (k === 'below' && !m.prof) return;
      var on = !comp && filter === k;
      html +=
        '<button type="button" class="seg-btn" data-action="naFilter" data-filter="' +
        k +
        '" aria-pressed="' +
        on +
        '">' +
        esc(labels[k]) +
        '<span class="dash-na-n">' +
        m.counts[k] +
        '</span></button>';
    });
    html += '</div>';
    if (compCol) {
      html +=
        '<button type="button" class="dash-na-compchip" data-action="naComp" data-key="" aria-label="' +
        esc('Show everyone again, not only ' + compCol.title) +
        '">' +
        esc(compCol.label) +
        ' <span aria-hidden="true">×</span></button>';
    }
    html += '</div><div class="dash-na-list" tabindex="-1">';
    var classItems = !comp && filter === 'all' ? view.classItems || [] : [];
    classItems.forEach(function (item) {
      html +=
        '<div class="dash-na-row is-class">' +
        '<span class="dash-na-rank" aria-hidden="true">•</span>' +
        '<span class="dash-na-classtext">' +
        esc(item.text) +
        '</span>' +
        (item.link
          ? '<a class="dash-na-classlink" role="link" tabindex="0" data-href="' +
            item.link +
            '">' +
            esc(item.linkText) +
            ' →</a>'
          : '') +
        '</div>';
    });
    if (!shown.length) {
      var empty = comp
        ? 'No one is below the rule on ' + compCol.title + '.'
        : filter === 'below'
          ? 'Every scored student is at ' + PROF_LABELS[m.rule.below] + ' or above.'
          : NA_EMPTY[filter];
      html += '<div class="dash-ins-empty dash-na-empty">' + esc(empty) + '</div>';
    }
    shown.forEach(function (p, i) {
      var st = p.student;
      var grade = studentGradeSummary(cid, st.id);
      var word = levelWord(cid, getOverallProficiency(cid, st.id));
      html +=
        '<div class="dash-na-row" data-sid="' +
        esc(st.id) +
        '">' +
        '<span class="dash-na-rank">' +
        (i + 1) +
        '</span>' +
        '<a class="dash-ins-name dash-na-name" role="link" tabindex="0" data-href="' +
        _studentHref(cid, st.id, p.below.length ? 'comps' : '') +
        '">' +
        esc(displayNameWithLast(st)) +
        '</a>' +
        (grade.text
          ? '<span class="dash-na-grade" style="background:var(--score-' +
            grade.level +
            '-bg);color:var(--score-' +
            grade.level +
            '-text)">' +
            esc(grade.text) +
            (word ? ' <span class="dash-na-word">' + esc(word) + '</span>' : '') +
            '</span>'
          : '<span class="dash-na-grade is-none">\u2014</span>') +
        '<span class="dash-na-facts">' +
        _facts(cid, m, p, comp) +
        '</span>' +
        '<span class="dash-na-act">' +
        '<button type="button" class="dash-na-btn" data-action="obsAdd" data-sid="' +
        esc(st.id) +
        '">+ Observation</button>' +
        '<a class="dash-na-btn" role="link" tabindex="0" data-href="' +
        _gradebookHref(cid, [st.id], compCol) +
        '">Gradebook →</a>' +
        '</span>' +
        '</div>';
    });
    return html + '</div></section>';
  }

  /* ── Students: Cards | Grid ─────────────────────────────── */
  function studentsHeaderHtml(view) {
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
    belowLists: belowLists,
    helpGroups: helpGroups,
    missingItems: missingItems,
    missingCounts: missingCounts,
    missingGlanceHtml: missingGlanceHtml,
    attentionModel: attentionModel,
    attentionCardHtml: attentionCardHtml,
    belowCounts: belowCounts,
    studentsHeaderHtml: studentsHeaderHtml,
    studentGridHtml: studentGridHtml,
  };
})();
