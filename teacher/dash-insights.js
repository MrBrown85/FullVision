/* dash-insights.js — the dashboard's class insights: the students at one
   proficiency on a competency (the Level Mix pop-up), the Who Needs Help
   rule (the Needs Support view, the cards' amber border and the competency
   filter use it; the Needs Attention card is gone, plan F.8), Missing and
   Late, and the student grid. */
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
        note: folderAverageNote(cid, gi.group),
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

  /* A column's short code for a chip or a column head, 2–3 letters: a
     folder's common letter prefix of its competencies' codes (QP1, QP2 →
     QP), a competency's code without digits (QP1 → QP), else the initials of
     the first two words of its name (Continuity & Change → CC). */
  function _codeLetters(code) {
    return String(code || '')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 3);
  }
  function _nameInitials(name) {
    var words = String(name || '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  // A column's code on its own: a folder's common prefix of its
  // competencies' codes, a competency's code without digits, else the
  // initials of its name.
  function _baseCode(col, byId) {
    var codes = (col.sectionIds || []).map(function (id) {
      var sec = byId[id];
      var tag = sec && sec.tags && sec.tags[0];
      return (tag && tag.code) || '';
    });
    var code = '';
    if (codes.length && codes.every(Boolean)) {
      var prefix = codes.reduce(function (common, c) {
        var i = 0;
        while (i < common.length && i < c.length && common.charAt(i) === c.charAt(i)) i++;
        return common.slice(0, i);
      });
      // A folder's shared prefix, letters only; a competency's own code.
      code = _codeLetters(col.which && col.which.groupId ? prefix.replace(/[^A-Za-z].*$/, '') : prefix);
    }
    return code || _nameInitials(col.title || col.label);
  }

  // The initials of a short name, 2–3 letters, small joining words left
  // out: Self-Assessment → SA, Perspectives on Work → PW, Significance →
  // SIG, Purpose & Community → PC.
  var JOIN_WORDS = ['and', 'or', 'of', 'on', 'the', 'a', 'an', 'to', 'in', 'for', 'with', 'by', 'at'];
  function _shortInitials(name) {
    var words = String(name || '')
      .split(/[^A-Za-z0-9]+/)
      .filter(function (w) {
        return w && JOIN_WORDS.indexOf(w.toLowerCase()) < 0;
      });
    if (!words.length) return '';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words
      .slice(0, 3)
      .map(function (w) {
        return w.charAt(0);
      })
      .join('')
      .toUpperCase();
  }

  // The number in a column's code (CE12 → 12), or '' with none.
  function _codeNumber(col, byId) {
    var sec = byId[(col.sectionIds || [])[0]];
    var tag = sec && sec.tags && sec.tags[0];
    var m = String((tag && tag.code) || '').match(/(\d+)(?!.*\d)/);
    return m ? m[1] : '';
  }

  function _dupes(codes) {
    var seen = {};
    codes.forEach(function (c) {
      seen[c] = (seen[c] || 0) + 1;
    });
    return seen;
  }

  /* Every column's code, unique in the class (plan F.3): where two columns
     would share a code, each of them takes the initials of its short name
     instead; where those still collide, the column's number from its code
     goes on the end (CE1, CE2), or its place in the class when it has none.
     → { [col.key]: code } */
  function columnCodes(cid, cols) {
    cols = cols || columns(cid);
    var byId = {};
    getSections(cid).forEach(function (sec) {
      byId[sec.id] = sec;
    });
    var codes = cols.map(function (col) {
      return _baseCode(col, byId);
    });
    var count = _dupes(codes);
    codes = codes.map(function (c, i) {
      return count[c] > 1 ? _shortInitials(cols[i].label || cols[i].title) || c : c;
    });
    count = _dupes(codes);
    codes = codes.map(function (c, i) {
      return count[c] > 1 ? c + (_codeNumber(cols[i], byId) || String(i + 1)) : c;
    });
    var out = {};
    cols.forEach(function (col, i) {
      out[col.key] = codes[i];
    });
    return out;
  }

  /* One column's code, as columnCodes gives it for the class. */
  function columnCode(cid, col) {
    if (!col) return '';
    var code = columnCodes(cid)[col.key];
    if (code != null) return code;
    var byId = {};
    getSections(cid).forEach(function (sec) {
      byId[sec.id] = sec;
    });
    return _baseCode(col, byId);
  }

  /* One student on one column under the Who Needs Help rule: their value is
     below the rule's proficiency and rests on at least `min` scores. */
  function isBelowRule(cid, col, sid, value, rule) {
    if (!(value > 0) || roundLevel(value) >= rule.below) return false;
    var evidence = col.sectionIds.reduce(function (n, secId) {
      return n + getSectionEvidenceCount(cid, sid, secId);
    }, 0);
    return evidence >= rule.min;
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
    var level = value > 0 ? Math.max(1, Math.min(4, roundLevel(value))) : 0;
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
    // Everyone in the band is at one level, so they share its next step.
    var next = _bandNextStep(cid, col, pop.level, band.ids);
    return (
      '<div class="dash-mix-pop-head"><span>' +
      esc(col.label + ' · ' + band.label + ' · ' + band.ids.length) +
      '</span><button type="button" class="dash-mix-pop-close" data-action="mixClose" aria-label="Close">×</button></div>' +
      (next
        ? '<div class="dash-mix-pop-next">' + _nextHead('Shared next step', next) + esc(next.text) + '</div>'
        : '') +
      '<div class="dash-ins-people">' +
      people +
      '</div>' +
      '<a class="dash-ins-link" role="link" tabindex="0" data-href="' +
      _gradebookHref(cid, band.ids, col) +
      '">Open These Students in Gradebook →</a>'
    );
  }

  /* The gradebook on some students (all of them when `ids` is empty) and,
     for a single competency, scrolled to it. */
  function _gradebookHref(cid, ids, col) {
    return (
      '/gradebook?course=' +
      cid +
      (ids && ids.length ? '&students=' + ids.join(',') : '') +
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

  // The level the rule's students are below, by name ("Proficient",
  // "Developing"), for any text that says who counts.
  function ruleLevelName(rule) {
    return PROF_LABELS[readRule(rule).below];
  }

  /* Each competency with the students under the rule on it: their value is
     below the rule's proficiency and rests on at least `min` scores.
     → [{ col, ids, values }] in column order */
  function belowLists(cid, allStudents, rule) {
    var ids = _ids(allStudents);
    return columns(cid).map(function (col) {
      var dist = competencyDistribution(cid, ids, col.which);
      var below = ids.filter(function (sid) {
        return isBelowRule(cid, col, sid, dist.values[sid], rule);
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
    ns: { label: 'Missing', cls: 'is-ns' },
    late: { label: 'Late', cls: 'is-late' },
  };

  /* Work labelled Missing or Late in the active term, newest assessment
     first. An empty cell past its due date is not missing. */
  function missingItems(cid, allStudents) {
    var assessments = getAssessments(cid)
      .filter(function (a) {
        return assessmentInYearToDate(cid, a);
      })
      .sort(function (a, b) {
        return (b.dueDate || b.date || '').localeCompare(a.dueDate || a.date || '');
      });
    var items = [];
    assessments.forEach(function (a) {
      allStudents.forEach(function (st) {
        var status = getAssignmentStatus(cid, st.id, a.id);
        var kind = status === 'NS' ? 'ns' : status === 'LATE' ? 'late' : null;
        if (kind) items.push({ kind: kind, student: st, assessment: a });
      });
    });
    return items;
  }

  function missingCounts(items) {
    var counts = { ns: 0, late: 0, total: items.length };
    items.forEach(function (it) {
      counts[it.kind]++;
    });
    return counts;
  }

  /* The top bar's Missing and Late cell. Zero says so in a line; otherwise
     the two counts, and a click opens the class's gradebook (plan F.8). */
  function missingGlanceHtml(items, cid) {
    var c = missingCounts(items);
    var inner =
      '<span class="dash-glance-label">Missing and Late</span>' +
      '<span class="dash-glance-value">' +
      c.total +
      '</span>';
    if (!c.total)
      return (
        '<div class="dash-glance-cell dash-glance-missing">' +
        inner +
        '<span class="dash-glance-sub">Nothing is missing or late.</span></div>'
      );
    return (
      '<a class="dash-glance-cell dash-glance-missing" role="link" tabindex="0" data-href="' +
      esc('/gradebook?course=' + (cid || '')) +
      '" aria-label="' +
      esc(c.total + ' missing or late: open the gradebook') +
      '">' +
      inner +
      '<span class="dash-glance-sub">' +
      ['ns', 'late']
        .map(function (k) {
          return '<b>' + c[k] + '</b> ' + MISSING_KINDS[k].label;
        })
        .join(' · ') +
      '</span></a>'
    );
  }

  /* ── The attention model ──────────────────────────────── */
  /* (Once the Needs Attention card's; the card is gone, plan F.8. The
     page's competency filter and Needs Support read its lists.)
     One entry per student who needs something: competencies under the rule
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
    missingItems(cid, allStudents).forEach(function (it) {
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

  /* The curriculum bank's next step for one competency at a value's level
     (CompetencyWording.nextStep): '' for one with no bank id. */
  function _secNextStep(cid, secId, value) {
    if (!(value > 0) || !window.CompetencyWording) return '';
    var sec = getSections(cid).find(function (x) {
      return x.id === secId;
    });
    var tag = sec && sec.tags && sec.tags[0];
    return tag ? CompetencyWording.nextStep(tag, Math.max(1, Math.min(4, roundLevel(value)))) : '';
  }
  function _secLabel(cid, secId) {
    var sec = getSections(cid).find(function (x) {
      return x.id === secId;
    });
    var tag = sec && sec.tags && sec.tags[0];
    return (sec && (sec.shortName || (tag && (tag.label || tag.name)) || sec.name)) || '';
  }
  /* A student's lowest competency in a folder column: the lowest
     proficiency with a score, the one with more pieces on a tie, then the
     first in the folder. { secId, value } or null. */
  function _folderLowest(cid, col, sid) {
    var best = null;
    col.sectionIds.forEach(function (secId) {
      var v = getSectionProficiency(cid, sid, secId);
      if (!(v > 0)) return;
      var n = getSectionEvidenceCount(cid, sid, secId);
      if (!best || v < best.value || (v === best.value && n > best.n)) best = { secId: secId, value: v, n: n };
    });
    return best;
  }
  /* A column's next step for one student: a competency's step at their
     value; in a folder, the step of their lowest competency there, at
     their level on it, named (Colin, 2026-11-02). { text, label } or
     null. */
  function _colNextStep(cid, col, value, sid) {
    if (!col || !col.sectionIds || !col.sectionIds.length) return null;
    if (col.sectionIds.length === 1) {
      var one = _secNextStep(cid, col.sectionIds[0], value);
      return one ? { text: one, label: '' } : null;
    }
    var low = sid ? _folderLowest(cid, col, sid) : null;
    var text = low ? _secNextStep(cid, low.secId, low.value) : '';
    return text ? { text: text, label: _secLabel(cid, low.secId) } : null;
  }
  /* A band's shared next step: a competency's step at the band's level; in
     a folder, the competency that is lowest for the most students in the
     band (the first in the folder on a tie), at the band's level, named
     (Colin, 2026-11-02). { text, label } or null. */
  function _bandNextStep(cid, col, level, ids) {
    if (!col || !col.sectionIds || col.sectionIds.length < 2) return _colNextStep(cid, col, level);
    var count = {};
    ids.forEach(function (sid) {
      var low = _folderLowest(cid, col, sid);
      if (low) count[low.secId] = (count[low.secId] || 0) + 1;
    });
    var top = null;
    col.sectionIds.forEach(function (secId) {
      if (count[secId] && (!top || count[secId] > count[top])) top = secId;
    });
    var text = top ? _secNextStep(cid, top, level) : '';
    return text ? { text: text, label: _secLabel(cid, top) } : null;
  }
  /* "Next step:" or, in a folder, "Next step (Data Patterns):". */
  function _nextHead(head, next) {
    return '<b>' + head + (next.label ? ' (' + esc(next.label) + ')' : '') + ':</b> ';
  }

  /* ── Students: Cards | Grid ─────────────────────────────── */
  /* The title and count, Cards | Grid beside them, then the controls
     (search, sort, Flagged) on the right. */
  function studentsHeaderHtml(view, controlsHtml, count) {
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
      '<h2 class="dash-students-title">Students' +
      (count > 0 ? ' <span class="dash-students-count">' + count + '</span>' : '') +
      '</h2>' +
      '<div class="seg dash-view-toggle" role="group" aria-label="Show students as">' +
      seg('cards', 'Cards') +
      seg('grid', 'Grid') +
      '</div>' +
      (controlsHtml || '') +
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
    var level = value > 0 ? Math.max(1, Math.min(4, roundLevel(value))) : 0;
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
  /* The grid's column headings sort the list (the dashboard's sortMode):
     Student by last name, Overall by the grade it shows (the course % in a
     Letter class), each competency by proficiency, Last Observed by days
     since. A second click turns the order round. */
  function gridSortOf(sortMode) {
    var m = /^(?:col:(.+)|obs):(asc|desc)$/.exec(sortMode || '');
    if (m) return { key: m[1] ? 'col:' + m[1] : 'obs', dir: m[2] };
    if (sortMode === 'last-asc' || sortMode === 'last-desc') return { key: 'name', dir: sortMode.slice(5) };
    if (sortMode === 'overall-asc' || sortMode === 'overall-desc') return { key: 'overall', dir: sortMode.slice(8) };
    return null;
  }
  function _sortHead(key, label, current) {
    var on = current && current.key === key;
    return (
      '<button type="button" class="dash-sg-sort' +
      (on ? ' is-on' : '') +
      '" data-action="gridSort" data-key="' +
      esc(key) +
      '">' +
      esc(label) +
      '<span class="dash-sg-arrow" aria-hidden="true">' +
      (on ? (current.dir === 'asc' ? '\u2191' : '\u2193') : '') +
      '</span></button>'
    );
  }
  function _ariaSort(key, current) {
    if (!current || current.key !== key) return '';
    return ' aria-sort="' + (current.dir === 'asc' ? 'ascending' : 'descending') + '"';
  }

  function studentGridHtml(cid, students, allStudents, sortMode) {
    var cols = columns(cid);
    var current = gridSortOf(sortMode);
    var allIds = _ids(allStudents);
    var prof = showsProficiency(cid);
    var dists = cols.map(function (col) {
      return competencyDistribution(cid, allIds, col.which);
    });
    var today = getTodayStr();
    var term = getActiveTerm(cid);
    var html = '<div class="dash-section"><div class="dash-sg-wrap"><table class="dash-sg"><thead><tr>';
    html +=
      '<th scope="col" class="dash-sg-name-h"' +
      _ariaSort('name', current) +
      '>' +
      _sortHead('name', 'Student', current) +
      '</th><th scope="col"' +
      _ariaSort('overall', current) +
      '>' +
      _sortHead('overall', 'Overall', current) +
      '</th>';
    cols.forEach(function (col, i) {
      var d = dists[i];
      var max = Math.max.apply(
        null,
        d.bands.map(function (b) {
          return b.ids.length;
        }),
      );
      html +=
        '<th scope="col" title="' +
        esc(col.title + (col.note ? '\n' + col.note : '')) +
        '"' +
        _ariaSort('col:' + col.key, current) +
        '>';
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
      html += '<span class="dash-sg-col">' + _sortHead('col:' + col.key, col.label, current) + '</span></th>';
    });
    html +=
      '<th scope="col" class="dash-sg-obs-h"' +
      _ariaSort('obs', current) +
      '>' +
      _sortHead('obs', 'Last Observed', current) +
      '</th></tr></thead><tbody>';
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
    columnCode: columnCode,
    columnCodes: columnCodes,
    isBelowRule: isBelowRule,
    showsProficiency: showsProficiency,
    popHtml: popHtml,
    gradebookHref: _gradebookHref,
    readRule: readRule,
    ruleLevelName: ruleLevelName,
    belowLists: belowLists,
    helpGroups: helpGroups,
    missingItems: missingItems,
    missingGlanceHtml: missingGlanceHtml,
    attentionModel: attentionModel,
    belowCounts: belowCounts,
    studentsHeaderHtml: studentsHeaderHtml,
    studentGridHtml: studentGridHtml,
    gridSortOf: gridSortOf,
  };
})();
