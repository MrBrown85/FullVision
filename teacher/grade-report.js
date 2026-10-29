/* grade-report.js — the Grade Report: a ready-made progress report that
   reads like the student printout from the old gradebook programs. The
   letterhead, one row per assessment this term (date, title, category,
   score, out of, percent or proficiency, and Missing, Late or Excused),
   then a summary by category, the term grade and the missing work. Grades
   only: no comment, attendance or other feedback.

   Every student gets one sheet: the front, and the back when the front is
   full. When the rows don't fit, the table steps down to smaller rows, then
   to two columns of rows on each side. The layout returns what
   ReportSheets.layoutStudent returns, so the preview, the fit line, Everyone,
   Print Reports and the printed copies all work as they do for a built
   report (page-reports.js passes it as `layout`). */
window.GradeReport = (function () {
  'use strict';

  var PX_PER_IN = 96;
  var GAP = 12;
  var ROW_W = 720;
  var DEFAULTS = { summary: true, order: 'oldest', name: 'preferred' };
  var WORDS = { 1: 'Emerging', 2: 'Developing', 3: 'Proficient', 4: 'Extending' };
  /* The table's sizes, largest first: row height and type in px, and
     whether each side holds two columns of rows. */
  var TIERS = [
    { key: 'regular', rowPx: 19, cols: 1 },
    { key: 'small', rowPx: 15, cols: 1 },
    { key: 'two', rowPx: 15, cols: 2 },
  ];

  /* The class's choices, with the defaults filled in. */
  function options(saved) {
    var o = Object.assign({}, DEFAULTS);
    if (saved && typeof saved === 'object') {
      if (typeof saved.summary === 'boolean') o.summary = saved.summary;
      if (saved.order === 'newest' || saved.order === 'oldest') o.order = saved.order;
      if (saved.name === 'first' || saved.name === 'preferred') o.name = saved.name;
    }
    return o;
  }

  /* Which mark columns the class shows: a Letter class the percent, a
     Proficiency class the proficiency word, a Both class both. */
  function columnsFor(cid) {
    var mode = typeof courseGradeMode === 'function' ? courseGradeMode(cid) : 'proficiency';
    return { percent: mode !== 'proficiency', word: mode !== 'letter' };
  }

  function _when(d) {
    if (!d) return '';
    return parseLocalDate(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _word(level) {
    return level > 0 ? WORDS[Math.min(4, Math.max(1, Math.round(level)))] : '';
  }

  /* One student's rows: this term's assessments that have a mark or are
     Missing or Excused. Work not yet marked and not yet due is left off.
     { date, title, category, score, outOf, percent, word, note }. */
  function rows(cid, student, opts) {
    opts = options(opts);
    var cats = {};
    (getCategories(cid) || []).forEach(function (c) {
      cats[c.id] = c.name;
    });
    var list = getAssessments(cid)
      .filter(function (a) {
        return a && !(typeof isDibelsScored === 'function' && isDibelsScored(a)) && assessmentInActiveTerm(cid, a);
      })
      .map(function (a) {
        return { a: a, d: _assessmentDate(a) || '' };
      })
      .sort(function (x, y) {
        return x.d.localeCompare(y.d) || String(x.a.title || '').localeCompare(String(y.a.title || ''));
      });
    if (opts.order === 'newest') list.reverse();
    var out = [];
    list.forEach(function (x) {
      var a = x.a;
      var cv = assessmentCellValue(cid, student.id, a);
      var row = {
        id: a.id,
        date: _when(x.d),
        title: a.title || '',
        category: cats[a.categoryId || a.category_id] || '',
        score: '',
        outOf: '',
        percent: '',
        word: '',
        note: cv.late ? 'Late' : '',
      };
      if (cv.kind === 'none' || cv.kind === 'dibels') return;
      if (cv.kind === 'status') {
        row.note = cv.status === 'EXC' ? 'Excused' : 'Missing';
      } else if (cv.kind === 'missing') {
        row.note = 'Missing';
        if (cv.zero && isPointsScored(a)) {
          row.score = '0';
          row.outOf = formatPoints(Number(a.maxPoints) || 100);
          row.percent = '0%';
        }
      } else if (cv.kind === 'complete') {
        row.score = cv.mark === 'complete' ? 'Complete' : 'Incomplete';
      } else if (cv.kind === 'points') {
        var max = Number(a.maxPoints) || 100;
        row.score = formatPoints(cv.value);
        row.outOf = formatPoints(max);
        row.percent = formatPointsPercent(cv.value, max);
        row.word = _word(cv.level);
      } else if (cv.kind === 'level' && cv.value > 0) {
        row.score = levelFigure(cv.value);
        row.outOf = '4';
        row.percent = formatLevelAs(cid, cv.value, 'percent');
        row.word = _word(cv.value);
      } else return;
      out.push(row);
    });
    return out;
  }

  /* The categories this term: weight, how many assessments and the
     student's grade in each, as the gradebook works it out. */
  function categorySummary(cid, student) {
    var termWork = getAssessments(cid).filter(function (a) {
      return a && assessmentInActiveTerm(cid, a);
    });
    return (getCategories(cid) || [])
      .map(function (c) {
        var work = termWork.filter(function (a) {
          return (a.categoryId || a.category_id || null) === c.id;
        });
        if (!work.length) return null;
        var g = assessmentGroupGrade(cid, student.id, work, categoryCalcMode(c));
        return { name: c.name, weight: Number(c.weight || 0), count: work.length, grade: (g && g.text) || '—' };
      })
      .filter(Boolean);
  }

  /* ── HTML ─────────────────────────────────────────────────── */

  /* The columns of a row, by tier: two columns of rows leave the category
     and the proficiency word out so each row still reads in full. */
  function _cols(show, tier) {
    var two = tier.cols === 2;
    var cols = [
      ['date', 'Date', two ? '42px' : '50px', ''],
      ['title', 'Assignment', 'minmax(0,1fr)', ''],
    ];
    if (!two) cols.push(['category', 'Category', '150px', '']);
    cols.push(['score', 'Score', two ? '52px' : '62px', 'r']);
    cols.push(['outOf', 'Out Of', two ? '34px' : '44px', 'r']);
    if (show.percent) cols.push(['percent', '%', two ? '34px' : '42px', 'r']);
    if (show.word && !two) cols.push(['word', 'Proficiency', '74px', '']);
    cols.push(['note', '', two ? '48px' : '56px', '']);
    return cols;
  }

  function _tableHtml(list, show, tier) {
    var cols = _cols(show, tier);
    var tmpl = cols
      .map(function (c) {
        return c[2];
      })
      .join(' ');
    var cell = function (c, v, head) {
      return (
        '<span class="gr-c gr-' +
        c[0] +
        (c[3] ? ' gr-' + c[3] : '') +
        '">' +
        (head ? c[1] : esc(v[c[0]] || '')) +
        '</span>'
      );
    };
    var head =
      '<div class="gr-row gr-head">' +
      cols
        .map(function (c) {
          return cell(c, null, true);
        })
        .join('') +
      '</div>';
    var body = list
      .map(function (r) {
        return (
          '<div class="gr-row' +
          (r.note === 'Missing' ? ' gr-missing' : '') +
          '">' +
          cols
            .map(function (c) {
              return cell(c, r);
            })
            .join('') +
          '</div>'
        );
      })
      .join('');
    return (
      '<div class="gr-table gr-' +
      tier.key +
      '" style="--gr-cols:' +
      tmpl +
      ';--gr-row:' +
      tier.rowPx +
      'px">' +
      head +
      body +
      '</div>'
    );
  }

  /* A side's rows: one table, or two side by side, filled down the left
     column and then the right. */
  function _sideTableHtml(list, show, tier) {
    if (!list.length) return '';
    if (tier.cols === 1) return _tableHtml(list, show, tier);
    var cut = Math.ceil(list.length / 2);
    return (
      '<div class="gr-split">' +
      _tableHtml(list.slice(0, cut), show, tier) +
      _tableHtml(list.slice(cut), show, tier) +
      '</div>'
    );
  }

  /* Everything after the table: the summary by category, the term grade
     and the missing work count. */
  function _tailHtml(cid, student, opts) {
    var html = '';
    var term = studentGradeSummary(cid, student.id).text;
    if (opts.summary) {
      var cats = categorySummary(cid, student);
      if (cats.length) {
        html +=
          '<div class="gr-summary"><div class="gr-row gr-head" style="--gr-cols:minmax(0,1fr) 70px 90px 110px"><span class="gr-c">Category</span><span class="gr-c gr-r">Weight</span><span class="gr-c gr-r">Assessments</span><span class="gr-c gr-r">Grade</span></div>' +
          cats
            .map(function (c) {
              return (
                '<div class="gr-row" style="--gr-cols:minmax(0,1fr) 70px 90px 110px"><span class="gr-c">' +
                esc(c.name) +
                '</span><span class="gr-c gr-r">' +
                c.weight +
                '%</span><span class="gr-c gr-r">' +
                c.count +
                '</span><span class="gr-c gr-r">' +
                esc(c.grade) +
                '</span></div>'
              );
            })
            .join('') +
          '</div>';
      }
    }
    html +=
      '<div class="gr-term"><span>Term Grade</span><span class="gr-term-grade">' + esc(term || '—') + '</span></div>';
    var missing = rows(cid, student, opts).filter(function (r) {
      return r.note === 'Missing';
    }).length;
    html += '<div class="gr-facts">Missing Assignments: ' + missing + '</div>';
    return '<div class="gr-tail">' + html + '</div>';
  }

  /* ── Fitting ───────────────────────────────────────────────── */

  /* How the rows fall on the front and back at one tier, from the measured
     heights: { front, back, tailOnFront, fits }. H is a side's height. */
  function plan(n, sizes, tier, H) {
    var per = function (room) {
      return Math.max(0, Math.floor((room - sizes.headPx) / tier.rowPx)) * tier.cols;
    };
    var tableH = function (k) {
      return k ? sizes.headPx + Math.ceil(k / tier.cols) * tier.rowPx : 0;
    };
    var frontRoom = H - sizes.letterheadPx - GAP;
    var front = Math.min(n, per(frontRoom));
    var rest = n - front;
    if (!rest && sizes.letterheadPx + GAP + tableH(front) + (front ? GAP : 0) + sizes.tailPx <= H) {
      return { front: front, back: 0, tailOnFront: true, fits: true };
    }
    var backRoom = H - sizes.tailPx - (rest ? GAP : 0);
    var back = Math.min(rest, per(backRoom));
    return { front: front, back: back, tailOnFront: false, fits: back === rest && sizes.tailPx <= H };
  }

  function _measure(stage, html) {
    stage.innerHTML = '<div class="sheet-item">' + html + '</div>';
    return stage.firstChild.offsetHeight;
  }

  function _stage(host) {
    var st = document.createElement('div');
    st.className = 'report-sheet report-sheet-measure';
    st.setAttribute('aria-hidden', 'true');
    st.style.cssText =
      'position:absolute;left:-10000px;top:0;width:' +
      ROW_W +
      'px;height:auto;min-height:0;padding:0;margin:0;box-shadow:none;display:block;visibility:hidden;overflow:visible';
    host.appendChild(st);
    return st;
  }

  function _sideHtml(body, paper, kind, from) {
    return (
      '<div class="report-sheet gr-sheet" data-paper="' +
      paper +
      '"' +
      (kind ? ' data-kind="' + kind + '" data-side="' + from + '"' : '') +
      '><div class="sheet-body">' +
      body +
      '</div></div>'
    );
  }

  /* One student's sheet. opts: { paper, stage, grade (the class's
     choices) }. Returns the shape ReportSheets.layoutStudent returns. */
  function layoutStudent(cid, student, ctx, opts) {
    opts = opts || {};
    var o = options(opts.grade);
    var paper = opts.paper === 'legal' ? 'legal' : 'letter';
    var H = ReportSheets.sideHeight(paper);
    var show = columnsFor(cid);
    var list = rows(cid, student, o);
    var letterhead = ReportBlocks.renderBlockHeader(cid, student, ctx, { name: o.name });
    var tail = _tailHtml(cid, student, o);
    var own = !opts.stage;
    var stage = opts.stage || _stage(document.body);
    var chosen = null;
    var p = null;
    try {
      var sizes = { letterheadPx: _measure(stage, letterhead), tailPx: _measure(stage, tail) };
      for (var t = 0; t < TIERS.length; t++) {
        var tier = TIERS[t];
        // The header row and one row, measured at this tier.
        var one = _measure(stage, _tableHtml(list.slice(0, 1).concat(list.slice(0, 1)), show, tier));
        var head = _measure(stage, _tableHtml([], show, tier));
        tier = Object.assign({}, tier, { rowPx: Math.max(tier.rowPx, (one - head) / 2) });
        p = plan(list.length, { letterheadPx: sizes.letterheadPx, tailPx: sizes.tailPx, headPx: head }, tier, H);
        chosen = tier;
        if (p.fits) break;
      }
      // Still too many at the smallest size: two rows less on the back
      // leave room (and the gap above it) to say how many are not shown.
      if (!p.fits && p.back) p.back = Math.max(0, p.back - 2 * chosen.cols);
    } finally {
      if (own) stage.remove();
    }
    var frontRows = list.slice(0, p.front);
    var backRows = list.slice(p.front, p.front + p.back);
    var cut = list.length - p.front - p.back;
    var frontBody = letterhead + _sideTableHtml(frontRows, show, chosen) + (p.tailOnFront ? tail : '');
    var backBody =
      _sideTableHtml(backRows, show, chosen) +
      (cut > 0 ? '<div class="gr-cut">' + cut + ' more not shown: they do not fit on one sheet.</div>' : '') +
      tail;
    var sides = p.tailOnFront ? 1 : 2;
    var over = cut > 0;
    var name = fullName(student);
    var badge = over ? 'Too long' : '1 sheet';
    var html =
      '<div class="sheet-student" data-action="fitMapPick" data-sid="' +
      esc(student.id) +
      '" data-sheets="1" data-continued="0" data-after="0">' +
      '<div class="sheet-student-head no-print"><span class="sheet-student-name">' +
      esc(name) +
      '</span><span class="sheet-badge ' +
      (over ? 'over' : 'ok') +
      '">' +
      badge +
      '</span></div>' +
      '<div class="sheet-zoom" data-side="0"><div class="sheet-label no-print">Front</div>' +
      _sideHtml(frontBody, paper, 'side', 0) +
      '</div>' +
      '<div class="sheet-zoom" data-side="1"><div class="sheet-label no-print">' +
      (sides === 2 ? 'Back' : 'Blank') +
      '</div>' +
      (sides === 2
        ? _sideHtml(backBody, paper, 'side', 1)
        : '<div class="report-sheet sheet-blank-side" data-paper="' +
          paper +
          '"><div class="sheet-body"><div class="sheet-blank">This side is left blank.</div></div></div>') +
      '</div></div>';
    return {
      html: html,
      sheets: 1,
      sides: sides,
      continued: [],
      after: [],
      over: over,
      used: 0,
      free: [],
      commentLines: 0,
      room: 0,
      noComment: false,
      noAttendance: false,
      badge: badge,
      tier: chosen.key,
      rows: list.length,
    };
  }

  /* A layout function for ReportSheets.renderPreview and classSummary. */
  function layoutWith(grade) {
    return function (cid, student, ctx, opts) {
      return layoutStudent(cid, student, ctx, { paper: opts.paper, stage: opts.stage, grade: grade });
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    TIERS: TIERS,
    options: options,
    columnsFor: columnsFor,
    rows: rows,
    categorySummary: categorySummary,
    plan: plan,
    layoutStudent: layoutStudent,
    layoutWith: layoutWith,
  };
})();
