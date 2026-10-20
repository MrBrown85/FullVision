/* dash-observations.js — The dashboard's Observations card.

   One card with two tabs (docs/DECISIONS.md, "Observations (2026-10-18)",
   item 4):
   - By week: one row per student, one cell per week, one mark per
     observation coloured by type, the total in the window, and the days
     since the last observation once a student is 3+ weeks overdue.
   - By competency: one row per student, one cell per curricular
     competency with the student's level (from calc.js, as the class shows
     grades) and how many pieces of evidence it rests on; a dashed "none"
     cell where there is no evidence yet.

   Flags above the grid highlight students; the purple diamond marks a
   student with no strength recorded. Nothing here computes a grade: levels
   come from getSectionProficiency and are shown through formatLevel.

   The pure helpers are exported for tests. The page (page-dashboard.js)
   owns the state: tab, highlight, hidden names and the card's width. */
window.DashObservations = (function () {
  'use strict';

  var DAY_MS = 86400000;
  var MAX_MARKS = 3;
  var POP_NOTES = 5;
  var MAX_ROWS = 15;
  var ROW_H = 22;
  var BLOCK_GAP = 24;
  var COL_GAP = 3;
  var LABEL_MAX = 24;
  var TYPES = ['strength', 'growth', 'concern', 'note'];
  // The legend and a week's spoken counts: every type, then no type.
  var KEY_ORDER = TYPES.concat('none');
  // When a week has more notes than marks, the types present show first in
  // this order; a neutral Note comes after the three that carry a judgement.
  var MARK_PRIORITY = ['concern', 'growth', 'strength', 'note', 'none'];
  var TYPE_LABEL = { strength: 'Strength', growth: 'Growth', concern: 'Concern', note: 'Note', none: 'No type' };

  // Width of the parts of a row that are not cells (px): "+", marker, name,
  // then Total and days (By week) or Gaps and room for the angled labels
  // (By competency).
  var FIXED = {
    week: 18 + 12 + 72 + 22 + 30,
    competency: 18 + 12 + 72 + 30 + 48,
  };
  // A week cell must hold 3 marks (5px each) and "+N" or "9+" without
  // clipping; 34px leaves a margin for wider fonts.
  var MIN_CELL = { week: 34, level: 44, both: 76 };

  var DIAMOND =
    '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="M6 1.2 10.8 6 6 10.8 1.2 6Z"/></svg>';

  /* ── Pure helpers ───────────────────────────────────────── */

  function _dayNum(dateStr) {
    return Math.floor(Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
  }
  function _dayStr(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }
  function _isDateStr(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !isNaN(Date.parse(d.slice(0, 10)));
  }

  /** The day an observation belongs to: its date, else the day it was created. */
  function obDay(o) {
    var d = (o && (o.date || (o.created || '').slice(0, 10))) || '';
    return _isDateStr(d) ? d.slice(0, 10) : '';
  }

  /** 'strength', 'growth', 'concern', 'note', or 'none' for an untyped note. */
  function obType(o) {
    return o && TYPES.indexOf(o.sentiment) >= 0 ? o.sentiment : 'none';
  }

  function _newestKey(o) {
    return obDay(o) + '|' + ((o && o.created) || '');
  }
  /** A copy, newest first. */
  function newestFirst(obs) {
    return (obs || []).slice().sort(function (a, b) {
      var ka = _newestKey(a);
      var kb = _newestKey(b);
      return ka < kb ? 1 : ka > kb ? -1 : 0;
    });
  }

  /** 1 column for up to 15 students, 2 for 16–30, 3 for 31 or more. */
  function columnRule(n) {
    return n <= 15 ? 1 : n <= 30 ? 2 : 3;
  }

  /** The narrowest a column of students can be (px). */
  function blockMinWidth(fixed, cells, minCell) {
    return fixed + cells * minCell + (cells + 4) * COL_GAP;
  }

  /* How many columns of students: the rule above, fewer when they do not
     fit in `width`, and never less than 1.
       { n, cells, minCell, width, fixed } */
  function obsGridColumns(o) {
    var rule = columnRule(o.n || 0);
    if (!(o.width > 0)) return rule;
    var block = blockMinWidth(o.fixed == null ? FIXED.week : o.fixed, o.cells || 0, o.minCell || 0);
    var fit = Math.floor((o.width + BLOCK_GAP) / (block + BLOCK_GAP));
    return Math.max(1, Math.min(rule, fit));
  }

  /* Students split into `cols` columns in roster order, rows per column =
     ceil(n / cols); the shorter columns are padded with nulls so every
     column ends on the same line. */
  function splitColumns(list, cols) {
    list = list || [];
    cols = Math.max(1, cols || 1);
    var rows = Math.ceil(list.length / cols);
    var out = [];
    for (var c = 0; c < cols; c++) {
      var part = list.slice(c * rows, (c + 1) * rows);
      if (part.length === 0) continue;
      while (part.length < rows) part.push(null);
      out.push(part);
    }
    return out;
  }

  /* The marks for one week: one per observation, up to 3. With more than 3,
     the types present show once (concern, growth, strength, note, then no
     type) while there is room
     and the rest are the newest; "+N" counts the others ("9+" from 10).
     → { marks: ['concern', …] newest first, more, moreLabel, total } */
  function weekMarks(obs) {
    var list = newestFirst(obs);
    var total = list.length;
    var chosen;
    if (total <= MAX_MARKS) chosen = list;
    else {
      chosen = [];
      MARK_PRIORITY.forEach(function (t) {
        if (chosen.length >= MAX_MARKS) return;
        var o = list.find(function (x) {
          return obType(x) === t;
        });
        if (o) chosen.push(o);
      });
      list.forEach(function (o) {
        if (chosen.length < MAX_MARKS && chosen.indexOf(o) < 0) chosen.push(o);
      });
      chosen.sort(function (a, b) {
        return list.indexOf(a) - list.indexOf(b);
      });
    }
    var more = total - chosen.length;
    return {
      marks: chosen.map(obType),
      more: more,
      moreLabel: more <= 0 ? '' : more >= 10 ? '9+' : '+' + more,
      total: total,
    };
  }

  /** No strength recorded: at least one observation and none of them a strength. */
  function noStrength(obs) {
    return (
      (obs || []).length > 0 &&
      !obs.some(function (o) {
        return obType(o) === 'strength';
      })
    );
  }

  function _hasTerm(term) {
    return !!(term && term.startsOn && term.endsOn);
  }

  /* The By week window: the picked term's weeks, else the last 8 weeks.
     → { weeks: [Monday, …], start, end, label } */
  function weekWindow(todayStr, term) {
    var weeks = DashOverview.obsCoverageWeeks(todayStr, _hasTerm(term) ? term : null);
    var start = weeks[0];
    var end = _dayStr(_dayNum(weeks[weeks.length - 1]) + 6);
    if (_hasTerm(term)) {
      if (term.startsOn > start) start = term.startsOn;
      if (term.endsOn < end) end = term.endsOn;
    }
    return {
      weeks: weeks,
      start: start,
      end: end,
      label: _hasTerm(term) ? term.label || 'this term' : 'last ' + weeks.length + ' weeks',
    };
  }

  /* One By week row: cells per week, the window's total, and the overdue
     state, which always measures from today. */
  function weekRow(student, obs, win, todayStr) {
    obs = obs || [];
    var index = {};
    win.weeks.forEach(function (w, i) {
      index[w] = i;
    });
    var byWeek = win.weeks.map(function () {
      return [];
    });
    var inWindow = [];
    obs.forEach(function (o) {
      var d = obDay(o);
      if (!d || d < win.start || d > win.end) return;
      var i = index[DashOverview.obsWeekStart(d)];
      if (i === undefined) return;
      byWeek[i].push(o);
      inWindow.push(o);
    });
    var dated = obs.map(function (o) {
      return { date: obDay(o) };
    });
    var last = DashOverview.obsLastDate(dated);
    return {
      student: student,
      observed: obs.length > 0,
      total: inWindow.length,
      overdue: DashOverview.obsIsOverdue(dated, todayStr),
      daysSince: last ? Math.max(0, _dayNum(todayStr) - _dayNum(last)) : null,
      noStrength: noStrength(inWindow),
      cells: byWeek.map(function (list, i) {
        var sorted = newestFirst(list);
        return { week: win.weeks[i], obs: sorted, marks: weekMarks(sorted) };
      }),
    };
  }

  function _obsInTerm(o, term) {
    if (typeof CompetencyEvidence !== 'undefined' && CompetencyEvidence._helpers) {
      return CompetencyEvidence._helpers.obsInTerm(o, term);
    }
    if (!_hasTerm(term)) return true;
    var d = obDay(o);
    return !!d && d >= term.startsOn && d <= term.endsOn;
  }

  /* Evidence behind one competency: distinct assessments scored above 0 on
     any of its tags (getTagScores lists, already scoped to the term) plus
     observations linked to one of its tags inside the term. */
  function sectionEvidenceCount(scoreLists, obs, tagIds, term) {
    var assessed = {};
    (scoreLists || []).forEach(function (list) {
      (list || []).forEach(function (s) {
        if (s && s.score > 0) assessed[s.assessmentId] = true;
      });
    });
    var tags = {};
    (tagIds || []).forEach(function (id) {
      tags[id] = true;
    });
    var n = Object.keys(assessed).length;
    (obs || []).forEach(function (o) {
      if (o && o.competencyId && tags[o.competencyId] && _obsInTerm(o, term)) n++;
    });
    return n;
  }

  /* One By competency cell. A cell is a gap only with no evidence at all.
     Text and colour follow the class's grading style through formatLevel. */
  function competencyCell(cid, value, count) {
    var v = value > 0 ? value : 0;
    return {
      value: v,
      count: count,
      gap: count === 0,
      text: formatLevel(cid, v),
      level: v > 0 ? Math.max(1, Math.min(4, Math.round(v))) : 0,
    };
  }

  /** A competency column's short label: its first tag's label, else its name, cut at ~24 characters. */
  function headerLabel(sec) {
    var tag = sec && sec.tags && sec.tags[0];
    var label = String((tag && tag.label) || (sec && sec.name) || '').trim();
    return label.length > LABEL_MAX ? label.slice(0, LABEL_MAX - 1).trimEnd() + '…' : label;
  }

  /** The column's full name: "Section: tag label", or the one that exists. */
  function headerFull(sec) {
    var tag = sec && sec.tags && sec.tags[0];
    var name = String((sec && sec.name) || '').trim();
    var label = String((tag && tag.label) || '').trim();
    if (name && label && name !== label) return name + ': ' + label;
    return name || label;
  }

  /** "Christopher V.": first (or preferred) name and last initial. */
  function rowName(st) {
    var first = displayNameFirst(st);
    var last = String((st && st.lastName) || '').trim();
    if (!first) return displayName(st);
    if (!last || (st.preferred && st.preferred.indexOf(' ') > 0)) return first;
    return first + ' ' + last.charAt(0) + '.';
  }

  function _plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /* The flags a tab shows, those with a count above 0.
     counts: { overdue, noStrength, gap } */
  function flagList(tab, counts, windowLabel) {
    var out = [];
    function add(key, n, text, aria) {
      if (n > 0) out.push({ key: key, count: n, text: text, aria: aria });
    }
    var students = function (n) {
      return n + ' ' + _plural(n, 'student', 'students');
    };
    if (tab === 'competency') {
      add(
        'gap',
        counts.gap,
        _plural(counts.gap, 'has', 'have') + ' a competency with no evidence',
        'Highlight ' + students(counts.gap) + ' with a competency that has no evidence',
      );
      var inWin = windowLabel ? ' in ' + (/^last /.test(windowLabel) ? 'the ' : '') + windowLabel : '';
      add(
        'nostr',
        counts.noStrength,
        'with no strength recorded' + inWin,
        'Highlight ' + students(counts.noStrength) + ' with no strength recorded' + inWin,
      );
    } else {
      add(
        'overdue',
        counts.overdue,
        'not observed in 3+ weeks',
        'Highlight ' + students(counts.overdue) + ' not observed in 3 or more weeks',
      );
      add(
        'nostr',
        counts.noStrength,
        'with no strength recorded',
        'Highlight ' + students(counts.noStrength) + ' with no strength recorded',
      );
    }
    return out;
  }

  /** Whether a row stays lit under a highlight. */
  function rowMatches(row, highlight) {
    if (!highlight) return true;
    if (highlight === 'overdue') return !!row.overdue;
    if (highlight === 'nostr') return !!row.noStrength;
    if (highlight === 'gap') return (row.gaps || 0) > 0;
    return true;
  }

  /* ── Model ──────────────────────────────────────────────── */

  var _last = null;

  function _weekLabel(week) {
    return new Date(_dayNum(week) * DAY_MS).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  /* Everything the card draws, for the class as it is now.
     state: { tab, highlight, width } */
  function buildModel(cid, students, state) {
    state = state || {};
    var tab = state.tab === 'competency' ? 'competency' : 'week';
    var today = getTodayStr();
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var win = weekWindow(today, term);
    var roster = sortStudents(students || [], 'lastName');
    var sections = tab === 'competency' ? getSections(cid) || [] : [];
    var rows = roster.map(function (st) {
      var obs = getStudentQuickObs(cid, st.id).slice();
      var row = weekRow(st, obs, win, today);
      if (tab === 'competency') {
        row.comp = sections.map(function (sec) {
          var tagIds = (sec.tags || []).map(function (t) {
            return t.id;
          });
          var lists = tagIds.map(function (id) {
            return getTagScores(cid, st.id, id);
          });
          var count = sectionEvidenceCount(lists, obs, tagIds, term);
          return competencyCell(cid, getSectionProficiency(cid, st.id, sec.id), count);
        });
        row.gaps = row.comp.filter(function (c) {
          return c.gap;
        }).length;
      }
      return row;
    });
    var classObserved = rows.some(function (r) {
      return r.observed;
    });
    // A class with no observations at all has nobody overdue yet.
    if (!classObserved) {
      rows.forEach(function (r) {
        r.overdue = false;
      });
    }
    var counts = {
      overdue: rows.filter(function (r) {
        return r.overdue;
      }).length,
      noStrength: rows.filter(function (r) {
        return r.noStrength;
      }).length,
      gap: rows.filter(function (r) {
        return r.gaps > 0;
      }).length,
    };
    var mode = typeof courseGradeMode === 'function' ? courseGradeMode(cid) : 'proficiency';
    var cells = tab === 'competency' ? sections.length : win.weeks.length;
    var minCell = tab === 'competency' ? (mode === 'both' ? MIN_CELL.both : MIN_CELL.level) : MIN_CELL.week;
    var fixed = FIXED[tab];
    var cols =
      tab === 'competency' && sections.length > 7
        ? 1
        : obsGridColumns({ n: rows.length, cells: cells, minCell: minCell, width: state.width, fixed: fixed });
    var blockMin = blockMinWidth(fixed, cells, minCell);
    var flags =
      tab === 'week' && !classObserved
        ? []
        : tab === 'competency' && sections.length === 0
          ? []
          : flagList(tab, counts, win.label);
    var highlight = flags.some(function (f) {
      return f.key === state.highlight;
    })
      ? state.highlight
      : null;
    _last = {
      cid: cid,
      tab: tab,
      today: today,
      term: term,
      win: win,
      sections: sections,
      rows: rows,
      counts: counts,
      flags: flags,
      highlight: highlight,
      classObserved: classObserved,
      mode: mode,
      cols: cols,
      blockMin: blockMin,
      scrollX: cols === 1 && state.width > 0 && blockMin > state.width,
      cells: cells,
      minCell: minCell,
      fixed: fixed,
    };
    return _last;
  }

  /* ── HTML ───────────────────────────────────────────────── */

  function _studentHref(cid, sid, obId) {
    return (
      '#/student?id=' +
      encodeURIComponent(sid) +
      '&course=' +
      encodeURIComponent(cid) +
      (obId ? '&ob=' + encodeURIComponent(obId) : '')
    );
  }

  function _nav(sid, col) {
    return ' data-ob2-nav data-ob2-col="' + col + '" tabindex="-1" data-focus-key="nav:' + esc(sid) + ':' + col + '"';
  }

  function _headHtml(m, state, students) {
    var cid = m ? m.cid : state.cid;
    var record = '<a class="dash-ob2-record" href="#/observations?course=' + encodeURIComponent(cid) + '">Record →</a>';
    var h =
      '<div class="dash-ob2-head">' +
      '<div class="dash-section-title dash-ob2-title"><span id="dash-ob2-title">Observations</span>' +
      (m
        ? '<span class="dash-ob2-window">' + esc(m.tab === 'competency' ? _compLabel(m) : m.win.label) + '</span>'
        : '') +
      '</div><div class="dash-ob2-tools">';
    if (m && students > 0) {
      h += '<div class="seg seg-sm dash-ob2-tabs" role="tablist" aria-label="Observations view">';
      [
        ['week', 'By week'],
        ['competency', 'By competency'],
      ].forEach(function (t) {
        var on = m.tab === t[0];
        h +=
          '<button type="button" class="seg-btn dash-ob2-tab" role="tab" id="dash-ob2-tab-' +
          t[0] +
          '" aria-selected="' +
          on +
          '" aria-controls="dash-ob2-panel" tabindex="' +
          (on ? '0' : '-1') +
          '" data-action="obsTab" data-tab="' +
          t[0] +
          '" data-focus-key="tab-' +
          t[0] +
          '">' +
          t[1] +
          '</button>';
      });
      h += '</div>';
      h +=
        '<button type="button" class="dash-ob2-tool" data-action="obsNames" data-focus-key="names" aria-pressed="' +
        !!state.namesHidden +
        '">' +
        (state.namesHidden ? 'Show names' : 'Hide names') +
        '</button>';
    }
    return h + record + '</div></div>';
  }

  function _compLabel(m) {
    return _hasTerm(m.term) ? m.term.label || 'this term' : 'all time';
  }

  function _flagsHtml(m) {
    if (m.tab === 'week' && !m.classObserved) {
      return (
        '<div class="dash-ob2-flags"><span class="dash-ob2-clear">No observations recorded yet. ' +
        '<a href="#/observations?course=' +
        encodeURIComponent(m.cid) +
        '">Record →</a></span></div>'
      );
    }
    if (m.flags.length === 0) {
      var line =
        m.tab === 'week'
          ? 'Everyone has an observation in the last 3 weeks.'
          : 'Every student has evidence on every competency.';
      return '<div class="dash-ob2-flags"><span class="dash-ob2-clear">' + line + '</span></div>';
    }
    var h = '<div class="dash-ob2-flags" role="group" aria-label="Highlight students">';
    m.flags.forEach(function (f) {
      var on = m.highlight === f.key;
      h +=
        '<button type="button" class="dash-ob2-flag" data-action="obsFlag" data-flag="' +
        f.key +
        '" data-focus-key="flag-' +
        f.key +
        '" aria-pressed="' +
        on +
        '" aria-label="' +
        esc(f.aria) +
        '">' +
        (f.key === 'nostr' ? '<span class="dash-ob2-mark">' + DIAMOND + '</span>' : '') +
        (f.key === 'gap' ? '<i class="dash-ob2-gapicon" aria-hidden="true"></i>' : '') +
        '<b>' +
        f.count +
        '</b> ' +
        esc(f.text) +
        '</button>';
    });
    return h + '</div>';
  }

  function _keyHtml(m) {
    var diamond =
      '<span class="dash-ob2-keymark"><span class="dash-ob2-mark">' + DIAMOND + '</span>No strength recorded</span>';
    if (m.tab === 'week') {
      return (
        '<div class="dash-ob2-key"><span>Each square is a week. Each mark is one observation:</span>' +
        KEY_ORDER.map(function (t) {
          return '<span><i class="dash-ob2-swatch" data-type="' + t + '"></i>' + TYPE_LABEL[t] + '</span>';
        }).join('') +
        diamond +
        '</div>'
      );
    }
    var letter = m.mode === 'letter';
    var h =
      '<div class="dash-ob2-key"><span>Each cell is ' +
      (letter ? 'a grade' : 'a level') +
      ' and how many pieces of evidence it rests on:</span>';
    if (!letter) {
      [4, 3, 2, 1].forEach(function (n) {
        h += '<span><i class="dash-ob2-swatch lv-' + n + '"></i>' + esc(PROF_LABELS[n]) + '</span>';
      });
    }
    return h + '<span><i class="dash-ob2-swatch is-gap"></i>No evidence</span>' + diamond + '</div>';
  }

  function _weekHeadHtml(m) {
    var h = '<div class="dash-ob2-row is-head" aria-hidden="true"><span></span><span></span><span></span>';
    h += '<span class="dash-ob2-total">Total</span>';
    var prevMonth = '';
    m.win.weeks.forEach(function (w) {
      var d = new Date(_dayNum(w) * DAY_MS);
      var month = d.toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });
      h +=
        '<span class="dash-ob2-wk"><span class="dash-ob2-wk-m">' +
        (month !== prevMonth ? esc(month) : '') +
        '</span>' +
        d.getUTCDate() +
        '</span>';
      prevMonth = month;
    });
    return h + '<span></span></div>';
  }

  function _compHeadHtml(m, bi) {
    var h = '<div class="dash-ob2-row is-head is-angled" data-ob2-navrow><span></span><span></span><span></span>';
    m.sections.forEach(function (sec, i) {
      h +=
        '<button type="button" class="dash-ob2-ch" data-ob2-nav data-ob2-col="' +
        (2 + i) +
        '" tabindex="-1" data-focus-key="head:' +
        bi +
        ':' +
        i +
        '" aria-label="' +
        esc(headerFull(sec)) +
        '"><span>' +
        esc(headerLabel(sec)) +
        '</span></button>';
    });
    return h + '<span class="dash-ob2-ch is-gaps" aria-hidden="true"><span>Gaps</span></span></div>';
  }

  function _nameHtml(m, r) {
    var st = r.student;
    var overdue = m.tab === 'week' && r.overdue;
    var aria = displayName(st);
    if (overdue) aria += r.daysSince != null ? ', not observed in ' + r.daysSince + ' days' : ', no observations yet';
    if (r.noStrength) aria += ', no strength recorded';
    return (
      '<span class="dash-ob2-markslot">' +
      (r.noStrength ? '<span class="dash-ob2-mark">' + DIAMOND + '</span>' : '') +
      '</span>' +
      '<a class="dash-ob2-name' +
      (overdue ? ' is-overdue' : '') +
      '" href="' +
      _studentHref(m.cid, st.id) +
      '"' +
      _nav(st.id, 1) +
      ' aria-label="' +
      esc(aria) +
      '">' +
      esc(rowName(st)) +
      '</a>'
    );
  }

  function _weekCellHtml(m, r, c, wi) {
    var name = displayName(r.student);
    var when = 'week of ' + _weekLabel(c.week);
    if (c.obs.length === 0) return '<span class="dash-ob2-cell" aria-hidden="true"></span>';
    var types = {};
    c.obs.forEach(function (o) {
      var t = obType(o);
      types[t] = (types[t] || 0) + 1;
    });
    var parts = KEY_ORDER.filter(function (t) {
      return types[t];
    }).map(function (t) {
      return types[t] + ' ' + (t === 'none' ? 'with no type' : TYPE_LABEL[t].toLowerCase());
    });
    var aria =
      name +
      ', ' +
      when +
      ': ' +
      c.obs.length +
      ' ' +
      _plural(c.obs.length, 'observation', 'observations') +
      ' (' +
      parts.join(', ') +
      '). Opens the Evidence panel.';
    var marks = c.marks.marks
      .map(function (t) {
        return '<i data-type="' + t + '"></i>';
      })
      .join('');
    return (
      '<a class="dash-ob2-cell has' +
      (c.marks.moreLabel ? ' has-more' : '') +
      '" href="' +
      _studentHref(m.cid, r.student.id, c.obs[0].id) +
      '" data-sid="' +
      esc(r.student.id) +
      '" data-wi="' +
      wi +
      '"' +
      _nav(r.student.id, 2 + wi) +
      ' aria-label="' +
      esc(aria) +
      '">' +
      marks +
      (c.marks.moreLabel ? '<span class="dash-ob2-more">' + c.marks.moreLabel + '</span>' : '') +
      '</a>'
    );
  }

  function _compCellHtml(m, r, c, si) {
    var sec = m.sections[si];
    var name = displayName(r.student) + ', ' + headerFull(sec) + ': ';
    if (c.gap) {
      return (
        '<span class="dash-ob2-lv is-gap" role="img" aria-label="' + esc(name + 'no evidence yet') + '">none</span>'
      );
    }
    var aria =
      name +
      (c.value > 0 ? c.text : 'no level yet') +
      ', ' +
      c.count +
      ' ' +
      _plural(c.count, 'piece', 'pieces') +
      ' of evidence';
    return (
      '<span class="dash-ob2-lv ' +
      (c.level ? 'lv-' + c.level : 'is-neutral') +
      '" role="img" aria-label="' +
      esc(aria) +
      '">' +
      esc(c.text) +
      ' <small>' +
      c.count +
      '</small></span>'
    );
  }

  function _rowHtml(m, r) {
    if (!r) return '<div class="dash-ob2-row is-pad" aria-hidden="true"></div>';
    var st = r.student;
    var h =
      '<div class="dash-ob2-row' +
      (rowMatches(r, m.highlight) ? '' : ' is-dim') +
      '" data-ob2-navrow data-sid="' +
      esc(st.id) +
      '">' +
      '<button type="button" class="dash-ob2-add" data-action="obsAdd" data-sid="' +
      esc(st.id) +
      '"' +
      _nav(st.id, 0) +
      ' aria-label="Add an observation for ' +
      esc(displayName(st)) +
      '">+</button>' +
      _nameHtml(m, r);
    if (m.tab === 'week') {
      h += '<span class="dash-ob2-total">' + r.total + '</span>';
      r.cells.forEach(function (c, wi) {
        h += _weekCellHtml(m, r, c, wi);
      });
      h +=
        '<span class="dash-ob2-days">' +
        (r.overdue ? (r.daysSince != null ? r.daysSince + 'd' : 'none') : '') +
        '</span>';
    } else {
      r.comp.forEach(function (c, si) {
        h += _compCellHtml(m, r, c, si);
      });
      h += '<span class="dash-ob2-gaps">' + (r.gaps || '') + '</span>';
    }
    return h + '</div>';
  }

  function _gridTemplate(m) {
    if (m.tab === 'week') {
      return '18px 12px minmax(72px, 1.6fr) 22px repeat(' + m.cells + ', minmax(' + m.minCell + 'px, 1fr)) 30px';
    }
    return '18px 12px minmax(72px, 1.6fr) repeat(' + m.cells + ', minmax(' + m.minCell + 'px, 1fr)) 30px';
  }

  function _gridHtml(m) {
    var blocks = splitColumns(m.rows, m.cols);
    var headH = m.tab === 'competency' ? 100 : 30;
    var label =
      m.tab === 'week'
        ? 'Observations by student and week. Use the arrow keys to move.'
        : 'Levels by student and competency. Use the arrow keys to move.';
    var h =
      '<div class="dash-ob2-pane' +
      (m.scrollX ? ' is-scroll-x' : '') +
      (m.tab === 'competency' ? ' is-comp' : '') +
      '" id="dash-ob2-panel" role="tabpanel" aria-labelledby="dash-ob2-tab-' +
      m.tab +
      '" style="max-height:' +
      (headH + MAX_ROWS * ROW_H + 8) +
      'px">' +
      '<div class="dash-ob2-blocks" role="group" aria-label="' +
      label +
      '">';
    blocks.forEach(function (rows, bi) {
      h +=
        '<div class="dash-ob2-block" style="--ob2-cols:' +
        _gridTemplate(m) +
        ';min-width:' +
        m.blockMin +
        'px">' +
        (m.tab === 'week' ? _weekHeadHtml(m) : _compHeadHtml(m, bi));
      rows.forEach(function (r) {
        h += _rowHtml(m, r);
      });
      h += '</div>';
    });
    return h + '</div></div>';
  }

  /* The card's inner HTML (the page owns the #dash-obs-card element).
     state: { tab, highlight, namesHidden, width }. A highlight whose flag
     is gone is dropped: state.highlight is set to null. */
  function renderCard(cid, students, state) {
    state = state || {};
    students = students || [];
    if (students.length === 0) {
      _last = null;
      return (
        _headHtml(null, { cid: cid }, 0) +
        '<div class="dash-ob2-flags"><span class="dash-ob2-clear">No students yet.</span></div>'
      );
    }
    var m = buildModel(cid, students, state);
    state.highlight = m.highlight;
    var h = _headHtml(m, state, students.length);
    if (m.tab === 'competency' && m.sections.length === 0) {
      return (
        h +
        '<div class="dash-ob2-flags"><span class="dash-ob2-clear">This class has no curricular competencies yet. ' +
        '<button type="button" class="dash-ob2-linkbtn" data-action="openClassManager">Class Management →</button>' +
        '</span></div>'
      );
    }
    h += _flagsHtml(m) + _keyHtml(m) + _gridHtml(m);
    h += '<div class="dash-ob2-pop" id="dash-ob2-pop" role="tooltip" hidden></div>';
    return h;
  }

  /* The popover for a week cell: up to 5 notes, newest first. */
  function popoverHtml(sid, wi) {
    if (!_last) return '';
    var r = _last.rows.find(function (x) {
      return x.student.id === sid;
    });
    var c = r && r.cells[wi];
    if (!c || c.obs.length === 0) return '';
    var name = displayNameFirst(r.student) || displayName(r.student);
    var h =
      '<div class="dash-ob2-pop-head">Week of ' +
      esc(_weekLabel(c.week)) +
      ' · ' +
      c.obs.length +
      ' ' +
      _plural(c.obs.length, 'observation', 'observations') +
      '</div>';
    c.obs.slice(0, POP_NOTES).forEach(function (o) {
      var t = obType(o);
      var line = String(o.text || '')
        .split('\n')[0]
        .trim();
      if (line.length > 110) line = line.slice(0, 109) + '…';
      h +=
        '<div class="dash-ob2-pop-note"><span class="dash-ob2-pop-type" data-type="' +
        t +
        '">' +
        TYPE_LABEL[t] +
        '</span><span>' +
        esc(line) +
        '</span></div>';
    });
    if (c.obs.length > POP_NOTES) h += '<div class="dash-ob2-pop-more">' + (c.obs.length - POP_NOTES) + ' more</div>';
    h += '<div class="dash-ob2-pop-foot">Click to open in ' + esc(name) + '’s Evidence panel</div>';
    return h;
  }

  /** The last model drawn (for the page's popover and width checks). */
  function lastModel() {
    return _last;
  }

  return {
    renderCard: renderCard,
    buildModel: buildModel,
    popoverHtml: popoverHtml,
    lastModel: lastModel,
    obsGridColumns: obsGridColumns,
    columnRule: columnRule,
    blockMinWidth: blockMinWidth,
    splitColumns: splitColumns,
    weekMarks: weekMarks,
    noStrength: noStrength,
    weekWindow: weekWindow,
    weekRow: weekRow,
    sectionEvidenceCount: sectionEvidenceCount,
    competencyCell: competencyCell,
    headerLabel: headerLabel,
    headerFull: headerFull,
    rowName: rowName,
    flagList: flagList,
    rowMatches: rowMatches,
    obDay: obDay,
    obType: obType,
    newestFirst: newestFirst,
    FIXED: FIXED,
    MIN_CELL: MIN_CELL,
  };
})();
