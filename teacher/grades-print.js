/* Print Grades: the class grade sheet.

   A portrait class list with a grid, laid out like MyEd BC's "Class List
   with Grid" and a paper class record book: a header with the school, the
   sheet's title, the page and the time printed, then the class, teacher,
   block, term and scores setting; Pupil # and Name down the left; one column
   per assessment across the top, its title turned to read up the column
   with its date and "/n" under it, under a band per category; a class
   average row at the foot of the grid. Assignments only: no category or
   overall grades. Letter or Legal, portrait, 0.3in margins. Black and white
   only.

   Blank Gradebook prints the same grid, assessment titles and all, with
   every score box empty. Attendance prints it with school days across the
   top instead, Monday to Friday from the Monday of this week, a heavier rule
   between weeks, as many days as fit the page's width.

   The grid fills the page. Rows stretch to the foot of the page and columns
   to its right edge; when the class is small, blank rows and blank columns
   fill the rest, for writing in. Pagination is arithmetic in inches, not
   measurement, so the dialog's page count is the printed count. Students
   are cut into even blocks that fit a page's height; columns into even
   blocks that fit its width. Pages run every
   column page of one student block before the next.

   Every value comes from shared/calc.js: cells from assessmentCellValue (the
   Scores view's own) and averages through formatLevel and formatPoints,
   following the class's grading style.
   docs/DECISIONS.md, "Printed class grade sheet". */
(function () {
  'use strict';

  var ROOT_ID = 'grades-print-root';
  var STYLE_ID = 'grades-print-page';
  var OVERLAY_ID = 'grades-print-overlay';
  var OPTIONS_KEY = 'grades-print-options';
  var PAPER_KEY = 'gb-report-paper-';

  var MARGIN = 0.3;
  /* Held back on each axis for the grid's rule widths. Every height and
     width on the sheet is set in inches and text never wraps, so a font that
     differs by machine cannot push the grid past the page. */
  var SAFETY = 0.01;
  var PAPER = {
    letter: { key: 'letter', label: 'Letter', w: 8.5, h: 11 },
    legal: { key: 'legal', label: 'Legal', w: 8.5, h: 14 },
  };
  /* Sizes in inches and points. Heights are the heights the CSS sets. Rows
     and score columns stretch between their least and most to fill a page. */
  var SIZES = {
    normal: {
      key: 'normal',
      label: 'Normal',
      cellPt: 8,
      headPt: 7,
      rowMin: 0.22,
      rowMax: 0.3,
      colMin: 0.32,
      colMax: 0.5,
      stuNoW: 0.72,
      stuNoOnlyW: 1.05,
      nameW: 1.85,
      finalW: { proficiency: 0.5, letter: 0.66, both: 0.6 },
      titleChars: 22,
      pageHeadH: 1.16,
      bandH: 0.18,
      colHeadH: 1.4,
      dayHeadH: 0.85,
      keyH: 0.16,
    },
    compact: {
      key: 'compact',
      label: 'Compact',
      cellPt: 7,
      headPt: 6.5,
      rowMin: 0.18,
      rowMax: 0.26,
      colMin: 0.28,
      colMax: 0.45,
      stuNoW: 0.66,
      stuNoOnlyW: 0.95,
      nameW: 1.6,
      finalW: { proficiency: 0.45, letter: 0.6, both: 0.55 },
      titleChars: 21,
      pageHeadH: 1.1,
      bandH: 0.16,
      colHeadH: 1.26,
      dayHeadH: 0.8,
      keyH: 0.15,
    },
  };
  /* The column heads' height: a date needs less than a title. */
  function _colHeadH(opts) {
    var size = SIZES[opts.size] || SIZES.normal;
    return opts.attendance ? size.dayHeadH : size.colHeadH;
  }

  /* A cell printing two values (points over a level, or a level over its %
     in a class that shows both) needs a taller row. */
  var TWO_LINE = 1.6;
  /* A title turns to read up its column on up to this many lines. */
  var TITLE_LINES = 2;

  var MARKS = [
    { key: 'M', label: 'Missing' },
    { key: 'EXC', label: 'Excused' },
    { key: 'L', label: 'Late' },
    { key: '✓', label: 'Complete' },
    { key: '✗', label: 'Incomplete' },
    { key: '—', label: 'No Score' },
  ];

  var DEFAULT_OPTIONS = {
    term: 'all', // 'all' | 'custom' | a term's ordinal as a string
    from: '',
    to: '',
    assessments: 'all', // all | shown | pick
    picked: [],
    shownIds: null, // the ids the gradebook's filters leave visible
    undated: false,
    scoresAs: '', // proficiency | percent | points; '' follows the class's grading style
    late: true,
    average: true,
    students: 'both', // both | name | number: what identifies a student
    sortBy: 'last', // last | first | number
    finalGrade: true,
    paper: 'letter',
    size: 'normal',
    blank: false, // Blank Gradebook: the titles, every score box empty
    attendance: false, // school days across the top in place of assessments
  };
  /* The choices remembered on this device. Term, assessments and paper are
     not: the first two follow the gradebook, paper is per class. */
  var REMEMBERED = ['late', 'average', 'students', 'sortBy', 'finalGrade', 'size'];

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var _state = null;

  /* ── Small helpers ─────────────────────────────────────── */

  function _esc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _round2(n) {
    return Math.round(n * 1000) / 1000;
  }

  function _isoToday() {
    return _iso(new Date());
  }

  function _iso(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function _assessmentDate(a) {
    return (a && (a.date || a.dateAssigned || a.date_assigned)) || '';
  }

  function _categoryId(a) {
    return (a && (a.categoryId || a.category_id)) || '';
  }

  /* "Sep 2 – Nov 14, 2026": one year when both dates share it. */
  function _dateRange(a, b) {
    if (!a && !b) return '';
    if (!a || !b) return formatDate(a || b);
    var da = parseLocalDate(a);
    var db = parseLocalDate(b);
    var short = { month: 'short', day: 'numeric' };
    var long = { month: 'short', day: 'numeric', year: 'numeric' };
    return (
      da.toLocaleDateString('en-CA', da.getFullYear() === db.getFullYear() ? short : long) +
      ' – ' +
      db.toLocaleDateString('en-CA', long)
    );
  }

  /* ── Options ───────────────────────────────────────────── */

  function normalizeOptions(raw) {
    var o = Object.assign({}, DEFAULT_OPTIONS, raw || {});
    if (!PAPER[o.paper]) o.paper = 'letter';
    if (!SIZES[o.size]) o.size = 'normal';
    // Saved before the choices were Proficiency, Percentages and Points.
    o.scoresAs = { entered: 'points', levels: 'proficiency', both: 'points' }[o.scoresAs] || o.scoresAs;
    if (['proficiency', 'percent', 'points'].indexOf(o.scoresAs) < 0) o.scoresAs = '';
    // Blank Grid, the old empty grid without titles, is now Blank Gradebook.
    if (o.assessments === 'blank') {
      o.assessments = 'all';
      o.blank = true;
    }
    if (['all', 'shown', 'pick'].indexOf(o.assessments) < 0) o.assessments = 'all';
    // Saved before the Students choice: a Pupil Numbers box.
    if (raw && raw.students == null && raw.studentNumbers === false) o.students = 'name';
    if (['both', 'name', 'number'].indexOf(o.students) < 0) o.students = 'both';
    if (['last', 'first', 'number'].indexOf(o.sortBy) < 0) o.sortBy = 'last';
    o.term = o.term == null || o.term === '' ? 'all' : String(o.term);
    o.picked = Array.isArray(o.picked) ? o.picked.slice() : [];
    o.blank = !!o.blank;
    o.attendance = !!o.attendance;
    delete o.gridCols;
    return o;
  }

  /* Scores, until the teacher picks: a Letter class prints percentages,
     any other proficiency. */
  function defaultScoresAs(cid) {
    return courseGradeMode(cid) === 'letter' ? 'percent' : 'proficiency';
  }

  /* The period the sheet covers: all time, a reporting term or two dates. */
  function periodFor(cid, opts) {
    if (opts.term === 'custom') {
      var from = opts.from || '';
      var to = opts.to || '';
      if (from && to && from > to) {
        var t = from;
        from = to;
        to = t;
      }
      return { kind: 'custom', ordinal: null, from: from, to: to, label: 'Custom Dates', dates: _dateRange(from, to) };
    }
    if (opts.term !== 'all') {
      var term = getReportingTerms(cid).find(function (x) {
        return String(x.ordinal) === String(opts.term);
      });
      if (term) {
        return {
          kind: 'term',
          ordinal: term.ordinal,
          from: term.starts_on,
          to: term.ends_on,
          label: term.label,
          dates: _dateRange(term.starts_on, term.ends_on),
        };
      }
    }
    return { kind: 'all', ordinal: null, from: '', to: '', label: 'All Time', dates: '' };
  }

  /* Runs fn with the class's grades scoped to the period's term, then puts
     back whatever term the gradebook had. */
  function withPeriod(cid, period, fn) {
    var prev = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    setActiveTerm(cid, period.kind === 'term' ? period.ordinal : null);
    try {
      return fn();
    } finally {
      setActiveTerm(cid, prev ? prev.ordinal : null);
    }
  }

  /* ── Columns ───────────────────────────────────────────── */

  /* A title on up to `lines` lines of `chars` characters. Breaks at spaces,
     keeps a number with the word before it ("Quiz 10"), and ends a word
     longer than a line, or a title that runs out of room, with an ellipsis.
     `cut` says the key prints the title in full. */
  function shortTitleLines(title, chars, lines) {
    var words = String(title || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    // A number joins the word before it when the two fit on a line.
    var tokens = [];
    words.forEach(function (w) {
      var prev = tokens[tokens.length - 1];
      if (prev && /^\d+[a-z]?$/i.test(w) && (prev + ' ' + w).length <= chars)
        tokens[tokens.length - 1] = prev + ' ' + w;
      else tokens.push(w);
    });
    var out = [];
    var line = '';
    var shortened = false;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      // A word longer than a line keeps its start; the key prints it whole.
      if (tok.length > chars) {
        tok = tok.slice(0, chars - 1) + '\u2026';
        shortened = true;
      }
      if (!line) line = tok;
      else if ((line + ' ' + tok).length <= chars) line += ' ' + tok;
      else {
        out.push(line);
        line = tok;
      }
    }
    if (line) out.push(line);
    var cut = shortened || out.length > lines;
    if (out.length > lines) {
      out = out.slice(0, lines);
      var last = out[lines - 1].replace(/\u2026$/, '');
      out[lines - 1] = (last.length >= chars ? last.slice(0, chars - 1) : last) + '\u2026';
    }
    return { lines: out, cut: cut };
  }

  function _sortedCategories(cid) {
    return (getCategories(cid) || []).slice().sort(function (a, b) {
      var oa = Number(a.displayOrder || 0);
      var ob = Number(b.displayOrder || 0);
      if (oa !== ob) return oa - ob;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  /* The assessments the period and the Assessments choice leave in. */
  function assessmentsFor(cid, opts, period) {
    period = period || periodFor(cid, opts);
    var list = getAssessments(cid).filter(function (a) {
      var d = _assessmentDate(a);
      if (!d) return period.kind === 'all' || !!opts.undated;
      if (period.from && d < period.from) return false;
      if (period.to && d > period.to) return false;
      return true;
    });
    if (opts.assessments === 'shown' && Array.isArray(opts.shownIds)) {
      list = list.filter(function (a) {
        return opts.shownIds.indexOf(a.id) >= 0;
      });
    } else if (opts.assessments === 'pick') {
      list = list.filter(function (a) {
        return opts.picked.indexOf(a.id) >= 0;
      });
    }
    return list;
  }

  /* One column per assessment, in category order (no category last), by
     date within a category. Numbered 1..n in that order. */
  function columnsFor(cid, opts, period) {
    if (opts.attendance) return attendanceColumns(opts);
    var size = SIZES[opts.size] || SIZES.normal;
    var cats = _sortedCategories(cid);
    var rank = {};
    cats.forEach(function (c, i) {
      rank[c.id] = i;
    });
    var list = assessmentsFor(cid, opts, period).slice();
    list.sort(function (a, b) {
      var ra = rank[_categoryId(a)];
      var rb = rank[_categoryId(b)];
      ra = ra == null ? cats.length : ra;
      rb = rb == null ? cats.length : rb;
      if (ra !== rb) return ra - rb;
      var da = _assessmentDate(a) || '9999';
      var db = _assessmentDate(b) || '9999';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
    return list.map(function (a, i) {
      var catId = _categoryId(a);
      var cat = catId
        ? cats.find(function (c) {
            return c.id === catId;
          })
        : null;
      var t = shortTitleLines(a.title, size.titleChars, TITLE_LINES);
      var date = _assessmentDate(a);
      return {
        n: i + 1,
        id: a.id,
        assessment: a,
        title: a.title || '',
        lines: t.lines,
        cut: t.cut,
        date: date,
        // Month and day only: the header and the key carry the year.
        dateText: date ? formatShortDate(date, date) : '',
        dateLong: date ? formatDate(date) : '',
        outOf: isPointsScored(a) && !isCompletionScored(a) ? Number(a.maxPoints) || 100 : null,
        complete: isCompletionScored(a),
        catId: cat ? cat.id : '',
        catName: cat ? cat.name || 'Category' : 'No Category',
      };
    });
  }

  /* The Monday an attendance sheet starts on: this week's, or the coming
     week's when printed on a Saturday or Sunday. */
  function weekStart(date) {
    var now = date || new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var dow = d.getDay();
    d.setDate(d.getDate() + (dow === 6 ? 2 : dow === 0 ? 1 : 1 - dow));
    return d;
  }

  /* "Mon Oct 19". */
  function dayLabel(d) {
    return WEEKDAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  /* Attendance's columns: school days, Monday to Friday, from the Monday of
     the week it is printed, as many as fit across the page at their
     narrowest. Each week is a band of its own. */
  function attendanceColumns(opts, today) {
    var count = pageCapacity(opts, 0).full;
    var d = weekStart(today);
    var monday = d;
    var out = [];
    while (out.length < count) {
      var dow = d.getDay();
      if (dow === 1) monday = new Date(d.getTime());
      if (dow >= 1 && dow <= 5) {
        var iso = _iso(d);
        var label = dayLabel(d);
        out.push({
          n: out.length + 1,
          id: 'day-' + iso,
          assessment: null,
          title: label,
          lines: [label],
          cut: false,
          date: iso,
          dateText: '',
          outOf: null,
          complete: false,
          day: true,
          catId: 'week-' + _iso(monday),
          catName: 'Week of ' + MONTHS[monday.getMonth()] + ' ' + monday.getDate(),
        });
      }
      d.setDate(d.getDate() + 1);
    }
    // A week cut short by the page's edge, too narrow for its label, keeps
    // the rule but leaves its band empty; its dates are in the heads.
    out.forEach(function (c) {
      var days = out.filter(function (x) {
        return x.catId === c.catId;
      }).length;
      if (days < 3) c.catName = '';
    });
    return out;
  }

  /* ── Students and cells ────────────────────────────────── */

  function rowsFor(cid, opts) {
    var students = sortStudents(getStudents(cid), opts.sortBy === 'first' ? 'firstName' : 'lastName');
    if (opts.sortBy === 'number') {
      students = students.slice().sort(function (a, b) {
        return String(a.studentNumber || '').localeCompare(String(b.studentNumber || ''), 'en', { numeric: true });
      });
    }
    return students.map(function (s, i) {
      var name =
        opts.sortBy !== 'last'
          ? fullName(s)
          : [s.lastName, s.firstName].filter(Boolean).join(', ') || fullName(s) || displayName(s);
      return { n: i + 1, id: s.id, name: name, studentNumber: s.studentNumber || '' };
    });
  }

  /* What one cell prints: { text, late, mark }. The Scores choice prints
     every score as a proficiency or a %, or as marked: points as points and
     other work as the gradebook shows it. Complete/Incomplete and the
     status marks print the same under every choice. */
  function cellText(cid, sid, col, opts) {
    if (opts.blank) return { text: '', mark: '' };
    var cell = assessmentCellValue(cid, sid, col.assessment);
    var out = { text: cell.text, mark: '' };
    if (cell.kind === 'status') out.mark = cell.text;
    else if (cell.kind === 'complete') out.mark = cell.text;
    else if (cell.kind === 'none') out.mark = '—';
    var as = opts.scoresAs || defaultScoresAs(cid);
    if (cell.kind === 'points' && as === 'percent') {
      out.text = formatPointsPercent(cell.value, col.outOf);
    } else if (cell.kind === 'points' && as === 'proficiency') {
      out.text = formatLevelAs(cid, getAssessmentOverallScore(cid, sid, col.id), 'proficiency');
    } else if (cell.kind === 'level' && as !== 'points') {
      out.text = formatLevelAs(cid, cell.value, as);
    }
    if (cell.late && opts.late && (cell.kind === 'points' || cell.kind === 'level' || cell.kind === 'complete')) {
      out.late = true;
    }
    return out;
  }

  /* The class average under a column, over every student on the sheet, in
     the Scores choice's terms. */
  function columnAverageText(cid, students, col, opts) {
    var a = col.assessment;
    var as = opts.scoresAs || defaultScoresAs(cid);
    if (col.complete || (col.outOf != null && as !== 'proficiency')) {
      var stats = getClassPointsAverage(cid, students, a);
      if (!stats) return '—';
      if (col.complete || as === 'percent') return Math.round(stats.pct) + '%';
      return formatPoints(Math.round(stats.avg * 10) / 10);
    }
    // Proficiency work, or points work printed as a proficiency: calc.js's
    // one column rule, the same as the gradebook's Class Average.
    var level = classColumnAverage(cid, students, { assessment: a, measure: 'level' });
    if (!level) return '—';
    return as === 'points' ? formatLevel(cid, level.avg) : formatLevelAs(cid, level.avg, as);
  }

  /* ── Geometry and pagination ───────────────────────────── */

  /* A class that shows both grades prints its final grade, and under
     Points its proficiency work, as a level over a %. */
  function _isTwoLine(cid, opts) {
    if (opts.blank) return false;
    return !!cid && courseGradeMode(cid) === 'both';
  }

  function _rowLimits(opts, twoLine) {
    var size = SIZES[opts.size] || SIZES.normal;
    var f = twoLine ? TWO_LINE : 1;
    return { min: _round2(size.rowMin * f), max: _round2(size.rowMax * f) };
  }

  function _showsName(opts) {
    return opts.students !== 'number';
  }
  function _showsNumber(opts) {
    return opts.students !== 'name';
  }

  /* The Pupil # column is wider on its own, so "Class Average" fits it. */
  function _numberWidth(opts) {
    var size = SIZES[opts.size] || SIZES.normal;
    return _showsName(opts) ? size.stuNoW : size.stuNoOnlyW;
  }

  function _rowHeadWidth(opts) {
    var size = SIZES[opts.size] || SIZES.normal;
    return (_showsName(opts) ? size.nameW : 0) + (_showsNumber(opts) ? _numberWidth(opts) : 0);
  }

  /* The final grade prints for a term or all time, never for custom dates
     (calc.js scopes grades by reporting term) or a blank sheet. */
  function _finalAllowed(period, opts) {
    return !!opts.finalGrade && period.kind !== 'custom' && !opts.blank;
  }

  /* The width left for score columns on a page, without and with the final
     grade column, and how many columns each holds at their narrowest. */
  function pageCapacity(opts, finalW) {
    var paper = PAPER[opts.paper] || PAPER.letter;
    var size = SIZES[opts.size] || SIZES.normal;
    var width = _round2((paper.w - 2 * MARGIN) * (1 - SAFETY) - _rowHeadWidth(opts));
    var widthWithFinal = _round2(width - (finalW || 0));
    return {
      pageW: paper.w - 2 * MARGIN,
      pageH: paper.h - 2 * MARGIN,
      width: width,
      widthWithFinal: widthWithFinal,
      full: Math.max(1, Math.floor(_round2(width / size.colMin))),
      withFinal: Math.max(0, Math.floor(_round2(widthWithFinal / size.colMin))),
    };
  }

  /* The height left for grid rows (students, blank rows and the class
     average) under the header and the column heads, above the key. */
  function gridHeight(opts) {
    var paper = PAPER[opts.paper] || PAPER.letter;
    var size = SIZES[opts.size] || SIZES.normal;
    var fixed = size.pageHeadH + size.bandH + _colHeadH(opts) + size.keyH;
    return _round2((paper.h - 2 * MARGIN) * (1 - SAFETY) - fixed);
  }

  /* How many students a page holds at the least row height. */
  function rowCapacity(opts, twoLine) {
    var lim = _rowLimits(opts, twoLine);
    var avg = opts.average && !opts.blank ? 1 : 0;
    return Math.max(1, Math.floor(_round2(gridHeight(opts) / lim.min)) - avg);
  }

  /* `count` items stretched over `space`: each at most `max`, and when even
     that leaves room, blank ones added to reach the end. */
  function fill(space, count, max) {
    var total = Math.max(count, Math.ceil(_round2(space / max)), 1);
    return { size: _round2(space / total), blank: total - Math.max(count, 0) };
  }

  /* `n` items into the fewest blocks of at most `max`, as even as they go. */
  function _evenBlocks(n, max) {
    if (n <= 0) return [];
    var k = Math.ceil(n / max);
    var per = Math.ceil(n / k);
    var out = [];
    for (var start = 0; start < n; start += per) out.push({ start: start, count: Math.min(per, n - start) });
    return out;
  }

  /* Column blocks for one student block: pages of at most `full` columns,
     the last of at most `withLast` (room left for the final grade). Spread
     evenly. A final grade that leaves no room for a column gets a page of
     its own. */
  function columnBlocks(n, full, withLast, hasLast) {
    if (!hasLast) return n ? _evenBlocks(n, full) : [{ start: 0, count: 0 }];
    if (n <= withLast) return [{ start: 0, count: n }];
    if (withLast < 1) return _evenBlocks(n, full).concat([{ start: n, count: 0 }]);
    var k = 1 + Math.ceil((n - withLast) / full);
    var per = Math.ceil(n / k);
    var out = [];
    var start = 0;
    if (per <= withLast) {
      for (; start < n; start += per) out.push({ start: start, count: Math.min(per, n - start) });
      return out;
    }
    var head = n - withLast;
    var headPer = Math.ceil(head / (k - 1));
    for (; start < head; start += headPer) out.push({ start: start, count: Math.min(headPer, head - start) });
    out.push({ start: head, count: withLast });
    return out;
  }

  /* Every page of the sheet: { students, cols, final, rowH, blankRows,
     colW, blankCols }. The final grade sits on the last column page of each
     student block. Every column page of a student block shares its row
     height, so the pages line up side by side. */
  function paginate(columns, rowCount, opts, twoLine, finalW) {
    var size = SIZES[opts.size] || SIZES.normal;
    var cap = pageCapacity(opts, finalW);
    var hasFinal = finalW > 0;
    if (twoLine === undefined) twoLine = _isTwoLine(null, opts);
    var blocks = columnBlocks(columns.length, cap.full, cap.withFinal, hasFinal);
    var lim = _rowLimits(opts, twoLine);
    var height = gridHeight(opts);
    var rowsPer = rowCapacity(opts, twoLine);
    var avg = opts.average && !opts.blank ? 1 : 0;
    var studentBlocks = rowCount ? _evenBlocks(rowCount, rowsPer) : [{ start: 0, count: 0 }];
    var pages = [];
    studentBlocks.forEach(function (sb) {
      var rows = fill(height, sb.count + avg, lim.max);
      blocks.forEach(function (cb, i) {
        var last = hasFinal && i === blocks.length - 1;
        var cols = fill(last ? cap.widthWithFinal : cap.width, cb.count, size.colMax);
        pages.push({
          students: sb,
          cols: cb,
          final: last,
          rowH: rows.size,
          blankRows: rows.blank,
          colW: cols.size,
          blankCols: cols.blank,
        });
      });
    });
    return { pages: pages, rowsPer: rowsPer, capacity: cap, twoLine: twoLine, gridH: height };
  }

  /* ── Header ────────────────────────────────────────────── */

  function _nowText() {
    var d = new Date();
    return formatDate(_isoToday()) + ', ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  }

  function headerFields(cid, opts, period, counts) {
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var terms = getReportingTerms(cid);
    var match =
      terms.length && typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(terms) : null;
    var school = match && match.school ? match.school.name : '';
    var blockLabel = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    var block = blockLabel.replace(/^Block /, '');
    var name = course.name || '';
    var teacher = (typeof getConfig === 'function' && getConfig().displayName) || '';
    var scores = opts.grid
      ? 'Blank Grid'
      : opts.attendance
        ? 'Attendance'
        : opts.blank
          ? 'Blank'
          : { proficiency: 'Proficiency', percent: 'Percentages', points: 'Points' }[opts.scoresAs] || '';
    var periodText =
      period.kind === 'all'
        ? 'All Time'
        : period.kind === 'custom'
          ? period.dates
          : period.label + ' · ' + period.dates;
    return {
      school: school,
      className: name,
      block: block,
      teacher: teacher,
      period: periodText,
      printed: _nowText(),
      students: String(counts.students),
      assessments: String(counts.columns),
      scores: scores,
    };
  }

  /* ── The model ─────────────────────────────────────────── */

  /* Everything the sheet prints, as data. Grades are read with the class
     scoped to the period's term and the gradebook's term put back after. */
  function buildModel(cid, rawOpts) {
    var opts = normalizeOptions(rawOpts);
    if (!opts.scoresAs) opts.scoresAs = defaultScoresAs(cid);
    // An attendance sheet is blank: no scores, averages or final grade.
    if (opts.attendance) opts.blank = true;
    var period = periodFor(cid, opts);
    return withPeriod(cid, period, function () {
      var columns = columnsFor(cid, opts, period);
      // No columns (a class with no assessments, or none in the period): the
      // roster prints on an empty grid that fills the page, for marking by hand.
      if (!columns.length) {
        opts.blank = true;
        opts.grid = true;
      }
      var rows = rowsFor(cid, opts);
      var students = rows.map(function (r) {
        return { id: r.id };
      });
      var ids = rows.map(function (r) {
        return r.id;
      });
      var size = SIZES[opts.size] || SIZES.normal;
      var finalOn = _finalAllowed(period, opts) && rows.length > 0;
      var finalW = finalOn ? size.finalW[courseGradeMode(cid)] : 0;
      var layout = paginate(columns, rows.length, opts, _isTwoLine(cid, opts), finalW);
      var marks = {};
      rows.forEach(function (r) {
        r.cells = columns.map(function (c) {
          var t = cellText(cid, r.id, c, opts);
          if (t.mark) marks[t.mark] = true;
          if (t.late) marks.L = true;
          return t;
        });
        // As the gradebook shows it: the term in view's reporting basis.
        if (finalOn) r.final = studentGradeSummary(cid, r.id, viewedReportTerm(cid)).text || '\u2014';
      });
      var averages =
        opts.average && !opts.blank
          ? {
              cells: columns.map(function (c) {
                return columnAverageText(cid, students, c, opts);
              }),
              final: finalOn ? classGradeSummary(cid, ids).text || '\u2014' : '',
            }
          : null;
      var header = headerFields(cid, opts, period, { students: rows.length, columns: columns.length });
      if (opts.attendance) header.period = _dateRange(columns[0].date, columns[columns.length - 1].date);
      return {
        cid: cid,
        opts: opts,
        period: period,
        header: header,
        columns: columns,
        rows: rows,
        averages: averages,
        final: finalOn ? { w: finalW } : null,
        layout: layout,
        pages: layout.pages,
        marks: MARKS.filter(function (m) {
          return marks[m.key];
        }),
      };
    });
  }

  /* The key at the foot of a page: the marks used anywhere on the sheet. */
  function keyLines(model) {
    return {
      marks: model.marks.map(function (m) {
        return m.key + ' ' + m.label;
      }),
    };
  }

  /* ── Rendering ─────────────────────────────────────────── */

  function _bands(cols) {
    var bands = [];
    cols.forEach(function (c) {
      var last = bands[bands.length - 1];
      if (last && last.catId === c.catId) last.count++;
      else bands.push({ catId: c.catId, name: c.catName, count: 1, first: c });
    });
    return bands;
  }

  /* One labelled field. Every field keeps its place, filled or not, so the
     block reads the same on every class. */
  function _info(label, value) {
    return '<div class="gp-info-item"><b>' + _esc(label) + ':</b> <span>' + _esc(value) + '</span></div>';
  }

  /* A turned title: its lines read up the column, with the date and "/n"
     level under it. */
  function _turnedHead(lines, below) {
    return (
      '<div class="gp-ch-in">' +
      '<div class="gp-ch-turn">' +
      lines
        .map(function (l) {
          return '<div>' + _esc(l) + '</div>';
        })
        .join('') +
      '</div>' +
      below
        .map(function (b) {
          return '<div class="gp-ch-below">' + _esc(b) + '</div>';
        })
        .join('') +
      '</div>'
    );
  }

  function renderPage(model, page, index, total) {
    var opts = model.opts;
    var size = SIZES[opts.size];
    var paper = PAPER[opts.paper];
    var cols = model.columns.slice(page.cols.start, page.cols.start + page.cols.count);
    var rows = model.rows.slice(page.students.start, page.students.start + page.students.count);
    var twoLine = model.layout.twoLine;
    var h = model.header;
    var pageW = paper.w - 2 * MARGIN;
    var pageH = paper.h - 2 * MARGIN;
    var blanks = [];
    for (var b = 0; b < page.blankCols; b++) blanks.push(b);
    var showFinal = !!(page.final && model.final);
    var showNo = _showsNumber(opts);
    var showName = _showsName(opts);
    function finalCell(tag, inner, cls) {
      return showFinal ? '<' + tag + ' class="gp-final' + (cls || '') + '">' + inner + '</' + tag + '>' : '';
    }

    /* On a two-line sheet "3.0 · 75%" prints as 3.0 over 75%. */
    function two(text) {
      var t = String(text == null ? '' : text);
      var at = twoLine ? t.indexOf(' · ') : -1;
      if (at < 0) return _esc(t);
      return _esc(t.slice(0, at)) + '<div class="gp-sub">' + _esc(t.slice(at + 3)) + '</div>';
    }
    function edge(i, c, prevCat) {
      return i === 0 ? ' gp-block-start' : c.catId !== prevCat ? ' gp-cat-start' : '';
    }
    var html =
      '<section class="gp-page gp-' +
      opts.size +
      (twoLine ? ' gp-two-line' : '') +
      (opts.attendance ? ' gp-attendance' : '') +
      '" data-page="' +
      (index + 1) +
      '" style="width:' +
      _round2(pageW) +
      'in;height:' +
      _round2(pageH) +
      'in;font-size:' +
      size.cellPt +
      'pt;--gp-row:' +
      page.rowH +
      'in;--gp-head-pt:' +
      size.headPt +
      'pt;--gp-colhead:' +
      _colHeadH(opts) +
      'in">';

    // Header, as MyEd lays out its class lists.
    html +=
      '<header class="gp-head" style="height:' +
      size.pageHeadH +
      'in">' +
      '<div class="gp-head-school">' +
      _esc(h.school) +
      '</div>' +
      '<div class="gp-head-title">' +
      (opts.attendance ? 'Attendance Sheet' : 'Class Grade Sheet') +
      '</div>' +
      '<div class="gp-head-line"><span>Page ' +
      (index + 1) +
      ' of ' +
      total +
      '</span><span>' +
      _esc(h.printed) +
      '</span></div>' +
      '<div class="gp-info">' +
      _info('Class', h.className) +
      _info('Teacher', h.teacher) +
      _info('Block', h.block) +
      (opts.attendance ? _info('Dates', h.period) : _info('Term', h.period)) +
      _info('Students', h.students) +
      (opts.attendance ? _info('School Days', h.assessments) : _info('Scores', h.scores)) +
      '</div>' +
      '</header>';

    // The grid.
    var widths = [];
    if (showNo) widths.push(_numberWidth(opts));
    if (showName) widths.push(size.nameW);
    var rowHeadCols = widths.length;
    cols.forEach(function () {
      widths.push(page.colW);
    });
    blanks.forEach(function () {
      widths.push(page.colW);
    });
    if (showFinal) widths.push(model.final.w);
    var tableW = widths.reduce(function (a, w) {
      return a + w;
    }, 0);
    html += '<table class="gp-grid" style="width:' + _round2(tableW) + 'in"><colgroup>';
    widths.forEach(function (w) {
      html += '<col style="width:' + w + 'in">';
    });
    html += '</colgroup><thead>';

    // Band row: the category over its columns.
    html += '<tr class="gp-band" style="height:' + size.bandH + 'in">';
    html += '<th class="gp-corner" colspan="' + rowHeadCols + '"></th>';
    _bands(cols).forEach(function (band, i) {
      var cont = model.columns.some(function (c) {
        return c.catId === band.catId && c.n < band.first.n;
      });
      html +=
        '<th class="gp-band-cell' +
        (i > 0 ? ' gp-cat-start' : ' gp-block-start') +
        '" colspan="' +
        band.count +
        '"><span>' +
        _esc(band.name + (cont ? ' (cont.)' : '')) +
        '</span></th>';
    });
    if (blanks.length) {
      html +=
        '<th class="gp-band-cell gp-band-blank' +
        (cols.length ? ' gp-cat-start' : '') +
        '" colspan="' +
        blanks.length +
        '"></th>';
    }
    html += finalCell('th', '', ' gp-band-cell');
    html += '</tr>';

    // Column heads: titles turned to read up the column.
    html += '<tr class="gp-colhead" style="height:' + _colHeadH(opts) + 'in">';
    if (showNo) html += '<th class="gp-rh gp-rh-no" scope="col">Pupil #</th>';
    if (showName) html += '<th class="gp-rh gp-rh-name" scope="col">Name</th>';
    var prevCat = null;
    cols.forEach(function (c, i) {
      var start = edge(i, c, prevCat);
      prevCat = c.catId;
      html +=
        '<th class="gp-ch' +
        start +
        '" scope="col" data-col="' +
        c.n +
        '" title="' +
        _esc(c.title) +
        '">' +
        _turnedHead(c.lines, c.day ? [] : [c.dateText, c.outOf != null ? '/' + formatPoints(c.outOf) : '']) +
        '</th>';
    });
    blanks.forEach(function (bc, i) {
      html +=
        '<th class="gp-ch gp-blank' + (i === 0 ? (cols.length ? ' gp-cat-start' : ' gp-block-start') : '') + '"></th>';
    });
    html += finalCell('th', _turnedHead(['Final Grade'], ['']), ' gp-ch');
    html += '</tr></thead><tbody>';

    function blankCells() {
      return blanks
        .map(function (bc, i) {
          return (
            '<td class="gp-cell gp-blank' +
            (i === 0 ? (cols.length ? ' gp-cat-start' : ' gp-block-start') : '') +
            '"></td>'
          );
        })
        .join('');
    }

    // Student rows.
    rows.forEach(function (r) {
      html += '<tr class="gp-row" data-sid="' + _esc(r.id) + '">';
      if (showNo) html += '<td class="gp-no">' + _esc(r.studentNumber) + '</td>';
      if (showName) html += '<td class="gp-name">' + _esc(r.name) + '</td>';
      var prev = null;
      cols.forEach(function (c, i) {
        var t = r.cells[c.n - 1];
        var start = edge(i, c, prev);
        prev = c.catId;
        html +=
          '<td class="gp-cell' +
          start +
          (t.mark && t.mark !== '—' ? ' gp-mark' : '') +
          '">' +
          two(t.text) +
          (t.late ? '<span class="gp-late">L</span>' : '') +
          '</td>';
      });
      html += blankCells();
      html += finalCell('td', two(r.final), ' gp-cell');
      html += '</tr>';
    });

    // Blank rows to the foot of the grid, for writing in.
    for (var br = 0; br < page.blankRows; br++) {
      html += '<tr class="gp-row gp-blank-row">';
      if (showNo) html += '<td class="gp-no"></td>';
      if (showName) html += '<td class="gp-name"></td>';
      var prevB = null;
      cols.forEach(function (c, i) {
        html += '<td class="gp-cell' + edge(i, c, prevB) + '"></td>';
        prevB = c.catId;
      });
      html += blankCells();
      html += finalCell('td', '', ' gp-cell');
      html += '</tr>';
    }

    // Class average, on the last line of the grid.
    if (model.averages && rows.length) {
      html += '<tr class="gp-avg">';
      html += '<td class="gp-avg-label" colspan="' + rowHeadCols + '">Class Average</td>';
      var prevA = null;
      cols.forEach(function (c, i) {
        var start = edge(i, c, prevA);
        prevA = c.catId;
        html += '<td class="gp-cell' + start + '">' + two(model.averages.cells[c.n - 1]) + '</td>';
      });
      html += blankCells();
      html += finalCell('td', two(model.averages.final), ' gp-cell');
      html += '</tr>';
    }
    html += '</tbody></table>';

    // The key, at the foot of the page.
    var key = keyLines(model, page);
    html +=
      '<div class="gp-key" style="height:' +
      size.keyH +
      'in">' +
      (key.marks.length ? 'Key: ' + _esc(key.marks.join(' · ')) : '') +
      '</div>';
    html += '</section>';
    return html;
  }

  function renderPages(model) {
    return model.pages
      .map(function (p, i) {
        return renderPage(model, p, i, model.pages.length);
      })
      .join('');
  }

  /* ── Print ─────────────────────────────────────────────── */

  function _root() {
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    return root;
  }

  /* The page rule: the paper by name and portrait ("legal portrait"), so a
     browser that matches a named size to the printer's paper picks Legal
     rather than shrinking the page onto Letter, and offers no landscape
     choice. reports.css sets its own margins and :left/:right margins for
     duplex reports; the grade sheet has the same narrow margin all round. */
  function _pageStyle(paperKey) {
    var paper = PAPER[paperKey] || PAPER.letter;
    var size = paper.key + ' portrait';
    var margin = MARGIN + 'in';
    return (
      '@page { size: ' +
      size +
      '; margin: ' +
      margin +
      '; }\n@page :left { margin: ' +
      margin +
      '; }\n@page :right { margin: ' +
      margin +
      '; }\n@page :first { margin: ' +
      margin +
      '; }'
    );
  }

  /* Renders the sheet into the print root, off screen, and returns the model. */
  function stage(cid, opts) {
    var model = buildModel(cid, opts);
    var root = _root();
    root.innerHTML = renderPages(model);
    root.setAttribute('lang', 'en');
    root.dataset.paper = model.opts.paper;
    return model;
  }

  /* The page rule goes last in the document every time, so a page rule the
     Reports page left behind (its paper, its margins) cannot win. */
  function activatePrintMode(paperKey) {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    style.textContent = _pageStyle(paperKey);
    document.head.appendChild(style);
    document.body.classList.add('grades-print-active');
  }

  function deactivatePrintMode() {
    document.body.classList.remove('grades-print-active');
    var style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    var root = document.getElementById(ROOT_ID);
    if (root) root.innerHTML = '';
  }

  function print(cid, opts) {
    var model = stage(cid, opts);
    if (!model.pages.length) return model;
    activatePrintMode(model.opts.paper);
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', done);
      deactivatePrintMode();
    }
    window.addEventListener('afterprint', done);
    window.print();
    // Chrome returns from print() when its dialog closes; a browser that
    // returns at once fires afterprint later.
    setTimeout(done, 0);
    return model;
  }

  /* ── Remembered choices ────────────────────────────────── */

  function _loadPaper(cid) {
    try {
      var v = localStorage.getItem(PAPER_KEY + cid);
      return PAPER[v] ? v : 'letter';
    } catch (e) {
      return 'letter';
    }
  }

  function _savePaper(cid, paper) {
    try {
      if (paper === 'letter') localStorage.removeItem(PAPER_KEY + cid);
      else localStorage.setItem(PAPER_KEY + cid, paper);
    } catch (e) {
      /* a per-device preference only */
    }
  }

  function _loadOptions(cid, given) {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    var opts = normalizeOptions({});
    if (saved && typeof saved === 'object') {
      REMEMBERED.forEach(function (k) {
        if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULT_OPTIONS[k]) opts[k] = saved[k];
      });
    }
    opts.paper = _loadPaper(cid);
    opts.scoresAs = defaultScoresAs(cid);
    if (given) {
      if (given.term != null) opts.term = String(given.term);
      if (Array.isArray(given.shownIds)) opts.shownIds = given.shownIds.slice();
    }
    return normalizeOptions(opts);
  }

  function _saveOptions(cid, opts) {
    var keep = {};
    REMEMBERED.forEach(function (k) {
      keep[k] = opts[k];
    });
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(keep));
    } catch (e) {
      /* storage full or blocked: the defaults are fine */
    }
    _savePaper(cid, opts.paper);
  }

  /* ── Dialog ────────────────────────────────────────────── */

  /* Two panes: at the left the title, a picture of the first page and the
     page count, with Cancel and Print; at the right the choices as rows in
     three groups, Content, Students and Page. A row's value opens a small
     menu of its choices; on or off choices are switches. Every change
     redraws the rows and the picture. */

  var CHEVRON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* Each value menu: the option it sets and its choices. */
  function _menus(cid, opts) {
    var assessments = [{ value: 'all', label: 'All Assessments' }];
    if (Array.isArray(opts.shownIds)) assessments.push({ value: 'shown', label: 'Shown in the Gradebook' });
    assessments.push({ value: 'pick', label: 'Pick Assessments' });
    return {
      term: [{ value: 'all', label: 'All Time' }]
        .concat(
          getReportingTerms(cid).map(function (t) {
            return { value: String(t.ordinal), label: t.label, help: _dateRange(t.starts_on, t.ends_on) };
          }),
        )
        .concat([{ value: 'custom', label: 'Custom Dates' }]),
      assessments: assessments,
      scoresAs: [
        { value: 'proficiency', label: 'Proficiency' },
        { value: 'percent', label: 'Percentages' },
        { value: 'points', label: 'Points' },
      ],
      students: [
        { value: 'both', label: 'Pupil # and Name' },
        { value: 'name', label: 'Name Only' },
        { value: 'number', label: 'Pupil # Only' },
      ],
      sortBy: [
        { value: 'last', label: 'Last Name' },
        { value: 'first', label: 'First Name' },
        { value: 'number', label: 'Pupil #' },
      ],
      paper: [
        { value: 'letter', label: 'Letter · 8.5 × 11 in' },
        { value: 'legal', label: 'Legal · 8.5 × 14 in' },
      ],
      size: [
        { value: 'normal', label: 'Normal' },
        { value: 'compact', label: 'Compact' },
      ],
    };
  }

  function _menuValue(items, value) {
    return (
      items.find(function (it) {
        return it.value === String(value);
      }) || items[0]
    );
  }

  /* A row whose value opens a menu. */
  function _menuRow(menus, opts, key, label, off) {
    var cur = _menuValue(menus[key], opts[key]);
    return (
      '<div class="gpd-row' +
      (off ? ' is-off' : '') +
      '"><span class="gpd-label" id="gpd-l-' +
      key +
      '">' +
      _esc(label) +
      '</span><button type="button" class="gpd-value" id="gpd-' +
      key +
      '" data-menu="' +
      key +
      '" aria-haspopup="menu" aria-expanded="false" aria-labelledby="gpd-l-' +
      key +
      ' gpd-' +
      key +
      '"' +
      (off ? ' disabled' : '') +
      '>' +
      _esc(cur.label) +
      CHEVRON +
      '</button></div>'
    );
  }

  /* A row with a switch. */
  function _switchRow(key, checked, label, off, sub) {
    return (
      '<div class="gpd-row gpd-row-switch' +
      (sub ? ' gpd-sub' : '') +
      (off ? ' is-off' : '') +
      '"><label class="gpd-label" for="gpd-' +
      key +
      '">' +
      _esc(label) +
      '</label><span class="gpd-switch"><input type="checkbox" role="switch" id="gpd-' +
      key +
      '" data-opt="' +
      key +
      '"' +
      (checked ? ' checked' : '') +
      (off ? ' disabled' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span></div>'
    );
  }

  function _dateRow(key, label, value) {
    return (
      '<div class="gpd-row gpd-sub"><label class="gpd-label" for="gpd-' +
      key +
      '">' +
      _esc(label) +
      '</label><input type="date" class="gpd-date" id="gpd-' +
      key +
      '" data-date="' +
      key +
      '" value="' +
      _esc(value) +
      '"></div>'
    );
  }

  function _pickList(cid, opts) {
    var period = periodFor(cid, opts);
    var list = assessmentsFor(cid, Object.assign({}, opts, { assessments: 'all' }), period).slice();
    list.sort(function (a, b) {
      var da = _assessmentDate(a) || '9999';
      var db = _assessmentDate(b) || '9999';
      return da < db ? -1 : da > db ? 1 : 0;
    });
    return list
      .map(function (a) {
        var d = _assessmentDate(a);
        return (
          '<label class="gpd-pick-option"><input type="checkbox" data-pick="' +
          _esc(a.id) +
          '"' +
          (opts.picked.indexOf(a.id) >= 0 ? ' checked' : '') +
          '><span>' +
          _esc(a.title || '') +
          (d ? ' <span class="gpd-help">' + _esc(formatShortDate(d)) + '</span>' : '') +
          '</span></label>'
        );
      })
      .join('');
  }

  function _undatedCount(cid) {
    return getAssessments(cid).filter(function (a) {
      return !_assessmentDate(a);
    }).length;
  }

  function _group(label, rows) {
    return (
      '<div class="gpd-group"><div class="gpd-group-label">' +
      _esc(label) +
      '</div><div class="gpd-list">' +
      rows +
      '</div></div>'
    );
  }

  /* The right pane: Content, Students and Page. */
  function _settingsHtml(cid, opts) {
    var menus = _menus(cid, opts);
    var period = periodFor(cid, opts);
    // Attendance puts days where the assessments go, so the assessment
    // choices step aside; either blank sheet leaves the scores off.
    var days = !!opts.attendance;
    var blank = !!opts.blank || days;

    var content = _menuRow(menus, opts, 'term', 'Term', days);
    if (opts.term === 'custom' && !days) {
      content += _dateRow('from', 'From', opts.from) + _dateRow('to', 'To', opts.to);
    }
    if (period.kind !== 'all' && !days && _undatedCount(cid) > 0) {
      content += _switchRow('undated', opts.undated, 'Undated Assessments', false, true);
    }
    content += _menuRow(menus, opts, 'assessments', 'Assessments', days);
    if (opts.assessments === 'pick' && !days) {
      content += '<div class="gpd-pick" role="group" aria-label="Pick Assessments">' + _pickList(cid, opts) + '</div>';
    }
    content += _menuRow(menus, opts, 'scoresAs', 'Scores', blank);
    content += _switchRow('blank', blank, 'Blank Gradebook', days);
    content += _switchRow('attendance', days, 'Blank Attendance');

    var students = _menuRow(menus, opts, 'students', 'Show As') + _menuRow(menus, opts, 'sortBy', 'Sort By');

    var page =
      _switchRow('finalGrade', opts.finalGrade, 'Final Grade', period.kind === 'custom' || blank) +
      _switchRow('average', opts.average, 'Class Average Row', blank) +
      _switchRow('late', opts.late, 'Late Marks', blank) +
      _menuRow(menus, opts, 'paper', 'Paper') +
      _menuRow(menus, opts, 'size', 'Text Size');

    return _group('Content', content) + _group('Students', students) + _group('Page', page);
  }

  /* Widths of the name dashes on the picture's rows, in turn. */
  var THUMB_NAMES = [73, 87, 67, 80, 60, 83, 70, 93, 63, 77, 90, 67, 80, 73, 97, 60, 83, 70, 77, 87, 67, 80];
  var THUMB_H = 274;

  /* A picture of the first page as the choices print it: the header, the
     column heads, a row per student and the blank rows under them, the
     class average row and the final grade column when they print, and
     marks in the cells unless the scores are blank. Widths follow the
     page's own, in inches. */
  function _thumbHtml(model) {
    var opts = model.opts;
    var page = model.pages[0];
    var paper = PAPER[opts.paper] || PAPER.letter;
    var colCount = page.cols.count + page.blankCols;
    var final = !!(page.final && model.final);
    var avg = !!(model.averages && page.students.count);
    var marked = !opts.blank;
    var shown = model.columns.slice(page.cols.start, page.cols.start + page.cols.count);
    // A heavier rule where a category, or an attendance week, begins.
    var brk = shown.map(function (c, i) {
      return i > 0 && c.catId !== shown[i - 1].catId ? ' gpd-t-brk' : '';
    });
    var tracks =
      _round2(_rowHeadWidth(opts)) + 'fr' + (colCount ? ' repeat(' + colCount + ', ' + page.colW + 'fr)' : '');
    if (final) tracks += ' ' + model.final.w + 'fr';
    function cells(kind) {
      var out = '';
      for (var i = 0; i < colCount; i++) {
        var scored = marked && i < page.cols.count && kind !== 'blank';
        out += '<span class="gpd-t-cell' + (brk[i] || '') + '">' + (scored ? '<i></i>' : '') + '</span>';
      }
      if (final) out += '<span class="gpd-t-cell gpd-t-final">' + (kind !== 'blank' ? '<i></i>' : '') + '</span>';
      return out;
    }
    var rows = '';
    for (var r = 0; r < page.students.count; r++) {
      rows +=
        '<div class="gpd-t-row"><span class="gpd-t-name"><i style="width:' +
        THUMB_NAMES[r % THUMB_NAMES.length] +
        '%"></i></span>' +
        cells('student') +
        '</div>';
    }
    for (var b = 0; b < page.blankRows; b++) {
      rows += '<div class="gpd-t-row"><span class="gpd-t-name"></span>' + cells('blank') + '</div>';
    }
    if (avg) {
      rows += '<div class="gpd-t-row gpd-t-avg"><span class="gpd-t-name"><i></i></span>' + cells('avg') + '</div>';
    }
    // Each titled column head carries a stroke for its title; blank columns
    // added to fill the page have none.
    var head = '<span class="gpd-t-cell"></span>';
    for (var h = 0; h < colCount; h++) {
      head += '<span class="gpd-t-cell' + (brk[h] || '') + '">' + (h < page.cols.count ? '<i></i>' : '') + '</span>';
    }
    if (final) head += '<span class="gpd-t-cell"><i></i></span>';
    return (
      '<div class="gpd-thumb" aria-hidden="true" style="width:' +
      Math.round((THUMB_H * paper.w) / paper.h) +
      'px;--gpd-t-cols:' +
      tracks +
      '">' +
      '<div class="gpd-t-head"><i class="gpd-t-title"></i><i class="gpd-t-date"></i></div>' +
      '<div class="gpd-t-row gpd-t-colhead">' +
      head +
      '</div>' +
      '<div class="gpd-t-rows">' +
      rows +
      '</div>' +
      '<div class="gpd-t-foot"><i></i><i></i></div>' +
      '</div>'
    );
  }

  /* "1 page · Letter" over "22 students · 37 columns", "22 students ·
     Blank Gradebook · 37 columns" or "22 students · 16 school days". */
  function previewLines(model) {
    var p = model.pages.length;
    var opts = model.opts;
    var paper = PAPER[opts.paper] || PAPER.letter;
    var first = p + (p === 1 ? ' page' : ' pages') + ' · ' + paper.label;
    var s = model.rows.length;
    if (!s) return { pages: first, detail: 'No students to print.' };
    var who = s + (s === 1 ? ' student' : ' students') + ' · ';
    var c = opts.grid ? model.pages[0].blankCols : model.columns.length;
    if (opts.attendance) return { pages: first, detail: who + c + (c === 1 ? ' school day' : ' school days') };
    var what = opts.grid ? 'Blank Grid · ' : opts.blank ? 'Blank Gradebook · ' : '';
    return { pages: first, detail: who + what + c + (c === 1 ? ' column' : ' columns') };
  }

  function _previewHtml(model) {
    var lines = previewLines(model);
    return (
      _thumbHtml(model) +
      '<div class="gpd-count" id="gp-status" aria-live="polite"><div class="gpd-count-pages">' +
      _esc(lines.pages) +
      '</div><div class="gpd-count-detail">' +
      _esc(lines.detail) +
      '</div></div>'
    );
  }

  function _dialogHtml(cid, opts) {
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    return (
      '<div class="confirm-card grades-print-card">' +
      '<div class="gpd-side">' +
      '<div class="gpd-head"><div class="gpd-title" id="gp-title">Print Grades</div><div class="gpd-class">' +
      _esc(typeof courseDisplayName === 'function' ? courseDisplayName(course) : course.name || '') +
      '</div></div>' +
      '<div class="gpd-preview" id="gpd-preview"></div>' +
      '<div class="gpd-actions"><button type="button" class="confirm-cancel" data-gp="cancel">Cancel</button>' +
      '<button type="button" class="confirm-ok primary" data-gp="print">Print</button></div>' +
      '</div>' +
      '<div class="gpd-settings" id="gpd-settings">' +
      _settingsHtml(cid, opts) +
      '</div>' +
      '</div>'
    );
  }

  /* "27 students · 18 columns · 3 pages." */
  function statusText(model) {
    if (!model.rows.length) return 'No students to print.';
    var s = model.rows.length;
    var c = model.columns.length;
    var p = model.pages.length;
    return (
      s +
      (s === 1 ? ' student' : ' students') +
      ' · ' +
      (c ? c + (c === 1 ? ' column' : ' columns') : 'Blank Grid') +
      ' · ' +
      p +
      (p === 1 ? ' page.' : ' pages.')
    );
  }

  /* Redraws the picture and the page count, and turns Print off when there
     is no one to print. */
  function _refreshPreview() {
    if (!_state) return;
    var model = buildModel(_state.cid, _state.opts);
    var preview = document.getElementById('gpd-preview');
    if (preview) preview.innerHTML = _previewHtml(model);
    var btn = document.querySelector('#' + OVERLAY_ID + ' [data-gp="print"]');
    if (btn) btn.disabled = !model.rows.length;
  }

  /* Redraws the rows after a change, keeping the scroll and the focus. */
  function _redraw(focusId) {
    var pane = document.getElementById('gpd-settings');
    if (!pane) return;
    var pick = pane.querySelector('.gpd-pick');
    var pickTop = pick ? pick.scrollTop : 0;
    var top = pane.scrollTop;
    pane.innerHTML = _settingsHtml(_state.cid, _state.opts);
    pane.scrollTop = top;
    pick = pane.querySelector('.gpd-pick');
    if (pick) pick.scrollTop = pickTop;
    var el = focusId ? document.getElementById(focusId) : null;
    if (el && !el.disabled && el.focus) el.focus();
  }

  function _changed(focusId) {
    _saveOptions(_state.cid, _state.opts);
    _redraw(focusId);
    _refreshPreview();
  }

  /* ── Value menus ── */

  function _closeMenu(refocus) {
    var menu = document.getElementById('gpd-menu');
    if (!menu) return false;
    var btn = document.getElementById('gpd-' + menu.dataset.for);
    menu.remove();
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
    return true;
  }

  function _openMenu(overlay, btn) {
    var key = btn.dataset.menu;
    _closeMenu(false);
    var items = _menus(_state.cid, _state.opts)[key];
    var cur = _menuValue(items, _state.opts[key]);
    var menu = document.createElement('div');
    menu.id = 'gpd-menu';
    menu.className = 'gpd-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', 'gpd-l-' + key);
    menu.dataset.for = key;
    menu.innerHTML = items
      .map(function (it) {
        var on = it === cur;
        return (
          '<button type="button" role="menuitemradio" class="gpd-menu-item" tabindex="-1" aria-checked="' +
          on +
          '" data-menu-item="' +
          _esc(it.value) +
          '">' +
          _esc(it.label) +
          (it.help ? '<span class="gpd-menu-help">' + _esc(it.help) + '</span>' : '') +
          '</button>'
        );
      })
      .join('');
    overlay.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    // Under the value, right edges lined up; above it when there is no room below.
    var r = btn.getBoundingClientRect();
    var h = menu.offsetHeight;
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - h - 4 >= 8) top = r.top - h - 4;
    menu.style.top = Math.round(top) + 'px';
    menu.style.left = Math.round(Math.max(8, r.right - menu.offsetWidth)) + 'px';
    var on = menu.querySelector('[aria-checked="true"]') || menu.querySelector('.gpd-menu-item');
    if (on) on.focus();
  }

  function _pickMenuItem(item) {
    var menu = item.closest('.gpd-menu');
    var key = menu.dataset.for;
    var o = _state.opts;
    o[key] = item.dataset.menuItem;
    _closeMenu(false);
    _changed('gpd-' + key);
  }

  /* Arrow keys, Home and End move through an open menu. */
  function _menuKey(e) {
    var menu = document.getElementById('gpd-menu');
    if (!menu) return false;
    var items = Array.prototype.slice.call(menu.querySelectorAll('.gpd-menu-item'));
    var i = items.indexOf(document.activeElement);
    var next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'Tab') {
      _closeMenu(true);
      return false;
    }
    if (!next) return false;
    e.preventDefault();
    next.focus();
    return true;
  }

  function open(cid, given) {
    close();
    _state = { cid: cid, opts: _loadOptions(cid, given), trigger: document.activeElement };
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'confirm-overlay grades-print-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'gp-title');
    overlay.innerHTML = _dialogHtml(cid, _state.opts);
    overlay.addEventListener('click', function (e) {
      var t = e.target;
      var item = t.closest ? t.closest('[data-menu-item]') : null;
      if (item) {
        _pickMenuItem(item);
        return;
      }
      // A click anywhere else closes an open menu first.
      var menuBtn = t.closest ? t.closest('[data-menu]') : null;
      var wasOpen = document.getElementById('gpd-menu');
      var sameBtn = wasOpen && menuBtn && wasOpen.dataset.for === menuBtn.dataset.menu;
      if (wasOpen && !(t.closest && t.closest('.gpd-menu'))) {
        _closeMenu(false);
        if (!menuBtn || sameBtn) return;
      }
      if (menuBtn) {
        _openMenu(overlay, menuBtn);
        return;
      }
      if (t === overlay) {
        close();
        return;
      }
      var btn = t.closest ? t.closest('[data-gp]') : null;
      if (!btn) return;
      if (btn.dataset.gp === 'cancel') close();
      else if (btn.dataset.gp === 'print') _printFromDialog();
    });
    overlay.addEventListener('change', function (e) {
      var t = e.target;
      var o = _state.opts;
      if (t.dataset.pick != null) {
        o.picked = [];
        overlay.querySelectorAll('input[data-pick]:checked').forEach(function (box) {
          o.picked.push(box.dataset.pick);
        });
        _saveOptions(cid, o);
        _refreshPreview();
      } else if (t.dataset.date) {
        // The dates change which assessments can be picked.
        o[t.dataset.date] = t.value || '';
        var pick = overlay.querySelector('.gpd-pick');
        if (pick) pick.innerHTML = _pickList(cid, o);
        _saveOptions(cid, o);
        _refreshPreview();
      } else if (t.dataset.opt) {
        o[t.dataset.opt] = !!t.checked;
        _changed(t.id);
      }
    });
    overlay.addEventListener('keydown', function (e) {
      if (_menuKey(e)) return;
      var t = e.target;
      if (e.key === 'ArrowDown' && t.dataset && t.dataset.menu) {
        e.preventDefault();
        _openMenu(overlay, t);
      }
    });
    overlay.addEventListener(
      'scroll',
      function () {
        _closeMenu(false);
      },
      true,
    );
    _state.keyHandler = function (e) {
      if (e.key !== 'Escape') return;
      if (_closeMenu(true)) return;
      close();
    };
    document.addEventListener('keydown', _state.keyHandler);
    document.body.appendChild(overlay);
    _refreshPreview();
    var first = overlay.querySelector('[data-menu="term"]');
    if (first && first.focus) first.focus();
  }

  function _printFromDialog() {
    if (!_state) return;
    var cid = _state.cid;
    var opts = _state.opts;
    close();
    print(cid, opts);
  }

  function close() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.remove) overlay.remove();
    if (_state) {
      if (_state.keyHandler) document.removeEventListener('keydown', _state.keyHandler);
      var trigger = _state.trigger;
      _state = null;
      try {
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
      } catch (e) {
        /* the button may be gone */
      }
    }
  }

  function destroy() {
    close();
    deactivatePrintMode();
    var root = document.getElementById(ROOT_ID);
    if (root && root.remove) root.remove();
  }

  window.GradesPrint = {
    PAPER: PAPER,
    SIZES: SIZES,
    MARGIN: MARGIN,
    SAFETY: SAFETY,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    normalizeOptions: normalizeOptions,
    periodFor: periodFor,
    withPeriod: withPeriod,
    shortTitleLines: shortTitleLines,
    assessmentsFor: assessmentsFor,
    columnsFor: columnsFor,
    rowsFor: rowsFor,
    cellText: cellText,
    columnAverageText: columnAverageText,
    pageCapacity: pageCapacity,
    rowCapacity: rowCapacity,
    gridHeight: gridHeight,
    fill: fill,
    paginate: paginate,
    weekStart: weekStart,
    attendanceColumns: attendanceColumns,
    headerFields: headerFields,
    buildModel: buildModel,
    keyLines: keyLines,
    statusText: statusText,
    previewLines: previewLines,
    renderPage: renderPage,
    renderPages: renderPages,
    stage: stage,
    defaultScoresAs: defaultScoresAs,
    activatePrintMode: activatePrintMode,
    deactivatePrintMode: deactivatePrintMode,
    print: print,
    open: open,
    close: close,
    destroy: destroy,
  };
})();
