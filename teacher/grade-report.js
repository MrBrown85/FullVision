/* grade-report.js — the grade parts One Report (report-one.js) prints:
   the Assessments list (listPart), one row per assessment in the year to
   date as of the report's end; the summary by category (summaryHtml);
   the course grade line, Overall Proficiency in a Proficiency class
   (termHtml); and the Feedback Pages after the report (feedbackPages,
   drawn on sides by sideHtml). It also reads a class's saved Quick Report
   choices (options), which ReportOne.fromGrade opens as a model.

   A row's columns follow the class's grading style (DECISIONS, "The
   Quick Report's columns", 2026-11-12): in a Proficiency class Date,
   Assignment, Category and Result, the Result what the piece was assessed
   in ("Developing +", "8 / 10", Complete, Missing, Excused); a Both class
   adds Percent; a Letter class prints Score, Out Of, % and the note, as it
   always has. Work not yet assessed leaves its Result (or Score) blank.

   Feedback Pages: a card for every assessment with a rubric or written
   feedback (ReportFeedback.forStudent and .cardHtml), down two columns,
   on as many sides as they need. Each card is measured at the column's
   width and the columns are filled by those heights (packColumns); a
   card never splits, except a rubric taller than a whole column, which
   splits between its criterion rows (splitRows). */
window.GradeReport = (function () {
  'use strict';

  /* These parts are drawn in the set of scores Progress Reports use
     (teacher/report-scores.js): each function named here runs inside
     ReportScores.withReportScores every time it is called, so its rows,
     its summary and its Feedback Pages read no grade outside it. */
  var _inReportScores = function (fn) {
    return ReportScores.scoped('progress', fn);
  };
  rows = _inReportScores(rows);
  categorySummary = _inReportScores(categorySummary);
  feedbackItems = _inReportScores(feedbackItems);
  extraCards = _inReportScores(extraCards);
  // The pieces One Report (report-one.js) draws its parts with.
  listPart = _inReportScores(listPart);
  _summaryHtml = _inReportScores(_summaryHtml);
  _termHtml = _inReportScores(_termHtml);
  _feedbackPages = _inReportScores(_feedbackPages);

  var GAP = 12;
  var ROW_W = 720;
  // ungraded: list the year's work with no mark yet, up to today (Colin,
  // Oct 29: leaving it off can mislead), its score blank (Colin,
  // 2026-11-12: no dash, no words).
  // numbers: a "#" column numbering the rows in the order they print, off
  // until the teacher ticks Assignment Numbers.
  // feedback: the Feedback Pages after the grade sheet, off until the
  // teacher turns them on. rubrics and comments say what the assessment
  // cards show; observations and termComment add a card each after them.
  var DEFAULTS = {
    summary: true,
    ungraded: true,
    numbers: false,
    order: 'oldest',
    name: 'preferred',
    feedback: false,
    rubrics: true,
    comments: true,
    observations: false,
    termComment: false,
  };
  var FLAGS = ['summary', 'ungraded', 'numbers', 'feedback', 'rubrics', 'comments', 'observations', 'termComment'];
  /* The table's size: its type and its row height in px (measured again
     for each student's list). */
  var TIER = { key: 'regular', rowPx: 19 };

  /* The class's choices, with the defaults filled in. */
  function options(saved) {
    var o = Object.assign({}, DEFAULTS);
    if (saved && typeof saved === 'object') {
      FLAGS.forEach(function (k) {
        if (typeof saved[k] === 'boolean') o[k] = saved[k];
      });
      if (saved.order === 'newest' || saved.order === 'oldest') o.order = saved.order;
      if (saved.name === 'first' || saved.name === 'preferred') o.name = saved.name;
    }
    return o;
  }

  /* Which mark columns the class shows: the percent in a Letter or Both
     class. byName: a Proficiency or Both class prints a level as its
     proficiency ("Proficient +"), never a figure out of 4 (DECISIONS,
     "Student-facing levels are proficiencies", 2026-11-12), and one Result
     column in place of Score and Out Of (resultText). */
  function columnsFor(cid) {
    var mode = typeof courseGradeMode === 'function' ? courseGradeMode(cid) : 'proficiency';
    return { percent: mode !== 'proficiency', byName: mode !== 'letter' };
  }

  function _when(d) {
    if (!d) return '';
    return parseLocalDate(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  /* One student's rows: the assessments in the year to date as of the
     report's end (Colin, 2026-11-03) that have a mark or are
     Missing or Excused, and with Ungraded Assignments on, the work dated up
     to today with no mark yet, its score blank. Work not yet due is left
     off. { n, date, title, category, score, outOf, percent, note }, n the
     row's number, 1, 2, 3 in the order the rows print. */
  function rows(cid, student, opts) {
    opts = options(opts);
    var cats = {};
    (getCategories(cid) || []).forEach(function (c) {
      cats[c.id] = c.name;
    });
    var list = getAssessments(cid)
      .filter(function (a) {
        return a && !(typeof isDibelsScored === 'function' && isDibelsScored(a)) && assessmentInYearToDate(cid, a);
      })
      .map(function (a) {
        return { a: a, d: _assessmentDate(a) || '' };
      })
      .sort(function (x, y) {
        return x.d.localeCompare(y.d) || String(x.a.title || '').localeCompare(String(y.a.title || ''));
      });
    if (opts.order === 'newest') list.reverse();
    var today = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
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
        note: cv.late ? 'Late' : '',
      };
      if (cv.kind === 'dibels') return;
      var ungraded = cv.kind === 'none' || (cv.kind === 'level' && !(cv.value > 0));
      if (ungraded) {
        if (!opts.ungraded || (x.d && x.d > today)) return;
      } else if (cv.kind === 'status') {
        row.note = cv.status === 'EXC' ? 'Excused' : 'Missing';
      } else if (cv.kind === 'complete') {
        row.score = cv.mark === 'complete' ? 'Complete' : 'Incomplete';
      } else if (cv.kind === 'points') {
        var max = Number(a.maxPoints) || 100;
        row.score = formatPoints(cv.value);
        row.outOf = formatPoints(max);
        row.percent = formatPointsPercent(cv.value, max);
      } else if (cv.kind === 'level' && cv.value > 0) {
        // A Letter class prints the level out of 4 as it always has; a
        // Proficiency or Both class prints its name with its + or −
        // (calc.js nearestScoreLevelName), the Both class's % in its own
        // column.
        if (courseGradeMode(cid) === 'letter') {
          row.score = levelFigure(cv.value);
          row.outOf = '4';
        } else {
          row.score = nearestScoreLevelName(cv.value);
        }
        row.percent = cv.percentText;
      } else return;
      out.push(row);
    });
    out.forEach(function (r, i) {
      r.n = i + 1;
    });
    return out;
  }

  /* A row's Result in a Proficiency or Both class: what the piece was
     marked in. Missing or Excused; points as "8 / 10" (the Score and Out Of
     a Letter class prints, joined); a level's proficiency, Complete or
     Incomplete as rows() wrote it; no mark yet, blank. */
  function resultText(r) {
    if (r.note === 'Missing' || r.note === 'Excused') return r.note;
    if (r.score && r.outOf) return r.score + ' / ' + r.outOf;
    return r.score || '';
  }

  /* The categories in the year to date: weight, how many of the rows above are in
     each (rows(), with opts), and the student's grade in each, as the
     gradebook works it out. */
  function categorySummary(cid, student, opts) {
    var termWork = getAssessments(cid).filter(function (a) {
      return a && assessmentInYearToDate(cid, a);
    });
    var shown = {};
    rows(cid, student, opts).forEach(function (r) {
      // One Report: an assessment left off the list is not counted (opts.omit).
      if (!(opts && opts.omit && opts.omit[r.id])) shown[r.id] = true;
    });
    return (getCategories(cid) || [])
      .map(function (c) {
        var work = termWork.filter(function (a) {
          return (a.categoryId || a.category_id || null) === c.id;
        });
        if (!work.length) return null;
        var g = assessmentGroupGrade(cid, student.id, work, categoryCalcMode(c));
        var count = work.filter(function (a) {
          return shown[a.id];
        }).length;
        // As a student reads it (calc.js studentGroupGradeText): the
        // proficiency in a Proficiency class, never its figure.
        return {
          name: c.name,
          weight: Number(c.weight || 0),
          count: count,
          grade: studentGroupGradeText(cid, g) || '—',
        };
      })
      .filter(Boolean);
  }

  /* ── HTML ─────────────────────────────────────────────────── */

  /* The category and assignment columns share the width the others leave,
     by what the student's rows need (show.catPx and show.titlePx, measured
     in listPart): both print in full when they fit; when they don't,
     each gets a share in proportion to its need, the title never less
     than TITLE_MIN_PX and the category never less than 100px, and a row
     whose title or category is still too long prints on two lines. */
  var TITLE_MIN_PX = 200;
  var COL_GAP = 6; // reports.css .gr-row column-gap
  function _cols(show, tier) {
    // Each fixed column is at least the width it has always had, and wider
    // when its widest text needs more in the fonts this machine shows and
    // prints the sheet in (show.fit, measured in listPart).
    var fit = (show.fit && show.fit.regular) || {};
    var px = function (key, min) {
      return Math.max(min, fit[key] || 0) + 'px';
    };
    var cols = [];
    // Assignment Numbers: a narrow bold column, wide enough for the
    // highest number (show.numPx, set in listPart).
    if (show.numbers) cols.push(['n', '#', (show.numPx || 22) + 'px', 'r']);
    // One Report can leave the Date or the Category column off (show.hide).
    var hide = show.hide || {};
    if (!hide.date) cols.push(['date', 'Date', px('date', 42), '']);
    cols.push(['title', show.titleHead || 'Assignment', 'minmax(0,1fr)', '']);
    if (!hide.category) cols.push(['category', 'Category', null, '']);
    if (show.byName) {
      // A Proficiency or Both class: one Result column, wide enough for
      // "Developing +", "Incomplete" and "Missing" in bold, read left to
      // right like the title beside it; Percent in a Both class; the note
      // holds only Late. The width Out Of had goes to the title.
      cols.push(['result', 'Result', px('result', 80), '']);
      if (show.percent) cols.push(['percent', 'Percent', px('percent', 48), 'r']);
      cols.push(['note', '', px('note', 32), '']);
    } else {
      // Score holds "Incomplete"; the note "Excused" in bold.
      cols.push(['score', 'Score', px('score', 64), 'r']);
      cols.push(['outOf', 'Out Of', px('outOf', 40), 'r']);
      if (show.percent) cols.push(['percent', '%', px('percent', 36), 'r']);
      cols.push(['note', '', px('note', 52), '']);
    }
    var fixed = cols.reduce(function (sum, c) {
      return sum + (c[2] && /px$/.test(c[2]) ? parseFloat(c[2]) : 0);
    }, 0);
    var avail = ROW_W - fixed - COL_GAP * (cols.length - 1);
    var catNeed = show.catPx || 150;
    var titleNeed = show.titlePx || avail - catNeed;
    var cat =
      catNeed + titleNeed <= avail
        ? catNeed
        : Math.max(100, Math.min(avail - TITLE_MIN_PX, (avail * catNeed) / (catNeed + titleNeed)));
    cols.forEach(function (c) {
      if (c[0] === 'category') c[2] = Math.round(cat) + 'px';
    });
    return cols;
  }

  /* What has been measured, kept for the page: every student's report
     lists the same assignment titles and categories and has the same table
     header, so a class's reports measure each once, not once per student
     (Nov 4: year-to-date reports list the whole year's work, and redrawing
     27 students' reports took twice as long). Kept only once the fonts have
     loaded, so a font that arrives late can't leave a wrong width. */
  var _widthMemo = {};
  var _heightMemo = {};
  var _memoSize = 0;
  function _memoOk() {
    if (_memoSize > 20000) {
      _widthMemo = {};
      _heightMemo = {};
      _memoSize = 0;
    }
    return typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
  }

  /* The widest of some texts at the table's largest type, in px. */
  function _textPx(stage, names) {
    names = names.filter(function (n, i) {
      return n && names.indexOf(n) === i;
    });
    var w = 0;
    _textWidthsMemo(stage, names, 'regular').forEach(function (x) {
      w = Math.max(w, x);
    });
    return Math.ceil(w) + 4;
  }

  /* _textWidths, measuring only the texts not measured before. */
  function _textWidthsMemo(stage, names, key) {
    if (!_memoOk()) return _textWidths(stage, names, key);
    var memo = _widthMemo[key] || (_widthMemo[key] = {});
    var todo = names.filter(function (n, i) {
      var k = String(n || '');
      return !Object.prototype.hasOwnProperty.call(memo, k) && names.indexOf(n) === i;
    });
    if (todo.length) {
      _textWidths(stage, todo, key).forEach(function (w, i) {
        memo[String(todo[i] || '')] = w;
        _memoSize++;
      });
    }
    return names.map(function (n) {
      return memo[String(n || '')];
    });
  }

  /* Each text's width in a table of one tier's type, in px, in order. */
  function _textWidths(stage, names, key) {
    // html-safe: key is the tier key ('regular'); every name goes through esc
    stage.innerHTML =
      '<div class="gr-table gr-' +
      key +
      '">' +
      names
        .map(function (n) {
          return (
            '<div><span class="gr-measure" style="display:inline-block;white-space:nowrap">' +
            esc(n || '') +
            '</span></div>'
          );
        })
        .join('') +
      '</div>';
    return Array.prototype.map.call(stage.querySelectorAll('.gr-measure'), function (el) {
      return el.offsetWidth;
    });
  }

  /* What the fixed columns can hold. A column sized for the widest text
     in one machine's fonts cuts it off in a wider one: on CI's Linux fonts
     "May 31" and "Developing −" were wider than the Date and Result
     columns a Mac fitted them in (Nov 12). So each column's widest texts
     (every date the format can print, every Result, Late, and what this
     student's rows hold) are measured in the sheet's own type, both in the
     font the page shows it in and in the one it prints in (reports.css
     .gr-print-font), with headroom: 4% and 2px. Each column keeps at
     least its old width, so where the old width was enough it is
     unchanged; on a Mac only Date grows ("May 28" was 41.7px of 42). More
     headroom costs the title room: at 8%, a Letter class's sheet in a
     Verdana-wide font needed a back for its rows. */
  var FIT_ROOM = 1.04;
  var _fitTexts = null;
  function _fitCanon() {
    if (_fitTexts) return _fitTexts;
    var dates = [];
    for (var m = 1; m <= 12; m++) {
      ['28', '30'].forEach(function (d) {
        if (m === 2 && d === '30') return;
        dates.push(_when('2026-' + (m < 10 ? '0' : '') + m + '-' + d));
      });
    }
    var levels = [];
    if (typeof scoreLevelText === 'function') {
      for (var l = 1; l <= 4; l++) {
        [-1, 0, 1].forEach(function (mod) {
          levels.push(scoreLevelText(l, mod));
        });
      }
    }
    _fitTexts = { dates: dates, levels: levels };
    return _fitTexts;
  }

  /* The width a column needs for texts at one tier's type (bold: in bold,
     as a header or a flag prints), in px, headroom included. */
  function _fitPx(stage, key, texts, bold) {
    var names = texts
      .map(function (t) {
        return t == null ? '' : String(t);
      })
      .filter(function (t, i, all) {
        return t && all.indexOf(t) === i;
      });
    if (!names.length) return 0;
    var memo = _memoOk()
      ? _widthMemo['fit-' + key + (bold ? '-b' : '')] || (_widthMemo['fit-' + key + (bold ? '-b' : '')] = {})
      : {};
    var todo = names.filter(function (n) {
      return !Object.prototype.hasOwnProperty.call(memo, n);
    });
    if (todo.length) {
      var span = function (n) {
        return '<span class="gr-fit" style="display:inline-block;white-space:nowrap">' + esc(n) + '</span>';
      };
      // html-safe: key is the tier key ('regular'); every name goes through esc
      stage.innerHTML =
        '<div class="gr-table gr-' +
        key +
        '"' +
        (bold ? ' style="font-weight:700"' : '') +
        '>' +
        todo
          .map(function (n) {
            return '<div>' + span(n) + '</div><div class="gr-print-font">' + span(n) + '</div>';
          })
          .join('') +
        '</div>';
      var els = stage.querySelectorAll('.gr-fit');
      todo.forEach(function (n, i) {
        var a = els[2 * i];
        var b = els[2 * i + 1];
        var px = Math.max((a && a.offsetWidth) || 0, (b && b.offsetWidth) || 0);
        // Nothing measured (no layout): kept out of the memo.
        if (px > 0) {
          memo[n] = px;
          _memoSize++;
        }
      });
    }
    var w = 0;
    names.forEach(function (n) {
      w = Math.max(w, memo[n] || 0);
    });
    return w > 0 ? Math.ceil(w * FIT_ROOM) + 2 : 0;
  }

  /* show.fit: each fixed column's need at the regular type,
     for this student's rows (_cols takes the larger of it and the
     column's usual width). */
  function _fitColumns(stage, show, list) {
    var canon = _fitCanon();
    var col = function (k) {
      return list.map(function (x) {
        return x[k];
      });
    };
    var fit = {};
    ['regular'].forEach(function (key) {
      var need = function (head, texts, boldTexts) {
        return Math.max(_fitPx(stage, key, [head].concat(boldTexts || []), true), _fitPx(stage, key, texts, false));
      };
      var f = {
        date: need('Date', canon.dates.concat(col('date'))),
      };
      if (show.byName) {
        f.result = need('Result', canon.levels.concat(['Complete', 'Incomplete', '100 / 100'], list.map(resultText)), [
          'Missing',
          'Excused',
        ]);
        f.note = need('', [], ['Late']);
      } else {
        f.score = need('Score', ['Complete', 'Incomplete', '4'].concat(col('score')));
        f.outOf = need('Out Of', ['100'].concat(col('outOf')));
        f.note = need('', [], ['Late', 'Missing', 'Excused']);
      }
      if (show.percent) f.percent = need(show.byName ? 'Percent' : '%', ['100%'].concat(col('percent')));
      fit[key] = f;
    });
    return fit;
  }

  /* The assignment and category cells' widths at one tier, in px (the
     category 0 when it is left off). */
  function _cellWidths(show, tier) {
    var cols = _cols(show, tier);
    var rowW = ROW_W;
    var fixed = 0;
    var cat = 0;
    cols.forEach(function (c) {
      if (c[2] && /px$/.test(c[2])) fixed += parseFloat(c[2]);
      if (c[0] === 'category') cat = parseFloat(c[2]);
    });
    return { title: rowW - fixed - COL_GAP * (cols.length - 1), category: cat };
  }

  /* wrap: for each row of list, true when its title or category is too
     long for one line, so the row prints on two (reports.css .gr-wrap). */
  function _tableHtml(list, show, tier, wrap) {
    var cols = _cols(show, tier);
    var tmpl = cols
      .map(function (c) {
        return c[2];
      })
      .join(' ');
    // A Proficiency or Both class: the Result is resultText, Missing and
    // Excused in it in bold (gr-flag) as the note printed them; the note
    // is only Late.
    var text = function (c, v) {
      if (!show.byName) return String(v[c[0]] || '');
      if (c[0] === 'result') return resultText(v);
      if (c[0] === 'note') return v.note === 'Late' ? 'Late' : '';
      return String(v[c[0]] || '');
    };
    var cell = function (c, v, head) {
      var t = head ? c[1] : text(c, v);
      var flag = !head && c[0] === 'result' && (t === 'Missing' || t === 'Excused');
      return (
        '<span class="gr-c gr-' +
        c[0] +
        (c[3] ? ' gr-' + c[3] : '') +
        (flag ? ' gr-flag' : '') +
        '">' +
        (head ? c[1] : esc(t)) +
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
      .map(function (r, i) {
        return (
          '<div class="gr-row' +
          (r.note === 'Missing' ? ' gr-missing' : '') +
          (wrap && wrap[i] ? ' gr-wrap' : '') +
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
      'px;--gr-row2:' +
      (tier.row2Px ? tier.row2Px + 'px' : 'auto') +
      '">' +
      head +
      body +
      '</div>'
    );
  }

  /* The course grade's line: Overall Proficiency in a Proficiency class. */
  function _termHtml(cid, student, ctx) {
    var term = studentGradeText(cid, student.id, ctx && ctx.termId).text;
    var show = columnsFor(cid);
    var prof = show.byName && !show.percent;
    return (
      '<div class="gr-term"><span>' +
      (prof ? 'Overall Proficiency' : 'Course Grade') +
      '</span><span class="gr-term-grade">' +
      esc(term || '—') +
      '</span></div>'
    );
  }

  /* The summary by category. */
  function _summaryHtml(cid, student, opts, stage) {
    var html = '';
    var show = columnsFor(cid);
    var prof = show.byName && !show.percent;
    var cats = categorySummary(cid, student, opts);
    // Each column at least its usual width, and wider when its header or
    // widest text needs it in this machine's fonts (_fitPx; no stage,
    // the usual widths).
    var need = function (min, head, texts) {
      if (!stage) return min + 'px';
      return Math.max(min, _fitPx(stage, 'regular', [head], true), _fitPx(stage, 'regular', texts, false)) + 'px';
    };
    var counts = cats.map(function (c) {
      return String(c.count);
    });
    var grades = cats.map(function (c) {
      return c.grade;
    });
    var grid;
    if (cats.length && prof) {
      grid =
        'minmax(0,1fr) ' +
        need(90, 'Assessments', counts) +
        ' ' +
        need(110, 'Proficiency', _fitCanon().levels.concat(grades));
      html +=
        '<div class="gr-summary"><div class="gr-row gr-head" style="--gr-cols:' +
        grid +
        '"><span class="gr-c">Category</span><span class="gr-c gr-r">Assessments</span><span class="gr-c gr-r">Proficiency</span></div>' +
        cats
          .map(function (c) {
            return (
              '<div class="gr-row" style="--gr-cols:' +
              grid +
              '"><span class="gr-c">' +
              esc(c.name) +
              '</span><span class="gr-c gr-r">' +
              c.count +
              '</span><span class="gr-c gr-r">' +
              esc(c.grade) +
              '</span></div>'
            );
          })
          .join('') +
        '</div>';
    } else if (cats.length) {
      // A Both class's grade reads "Developing · C- 55.4%": wider than a
      // Letter class's "C- 55.4%", which keeps its 110px.
      grid =
        'minmax(0,1fr) ' +
        need(
          70,
          'Weight',
          ['100%'].concat(
            cats.map(function (c) {
              return c.weight + '%';
            }),
          ),
        ) +
        ' ' +
        need(90, 'Assessments', counts) +
        ' ' +
        need(show.byName ? 170 : 110, 'Grade', grades);
      html +=
        '<div class="gr-summary"><div class="gr-row gr-head" style="--gr-cols:' +
        grid +
        '"><span class="gr-c">Category</span><span class="gr-c gr-r">Weight</span><span class="gr-c gr-r">Assessments</span><span class="gr-c gr-r">Grade</span></div>' +
        cats
          .map(function (c) {
            return (
              '<div class="gr-row" style="--gr-cols:' +
              grid +
              '"><span class="gr-c">' +
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
    return html;
  }

  /* One Report's Assessments part: the student's rows as one table at the
     regular size, with the rows too long for one line marked, and the rows
     themselves. o.omit: { id: true } for the assessments left off the list.
     The rows are numbered as they print. */
  function listPart(cid, student, o, stage) {
    var show = columnsFor(cid);
    var omit = o.omit || {};
    var list = rows(cid, student, o).filter(function (r) {
      return !omit[r.id];
    });
    list.forEach(function (r, i) {
      r.n = i + 1;
    });
    show.hide = o.hide || null;
    show.titleHead = 'Assessment';
    if (o.numbers) {
      show.numbers = true;
      show.numPx = 8 + 7 * String(Math.max(1, list.length)).length;
    }
    show.fit = _fitColumns(stage, show, list);
    if (show.numbers) show.numPx = Math.max(show.numPx, _fitPx(stage, 'regular', ['#', String(list.length)], true));
    var titles = list.map(function (r) {
      return r.title;
    });
    var cats = list.map(function (r) {
      return r.category;
    });
    show.catPx = _textPx(stage, ['Category'].concat(cats));
    show.titlePx = _textPx(stage, ['Assessment'].concat(titles));
    var tier = Object.assign({}, TIER);
    var one = _measure(stage, _tableHtml(list.slice(0, 1).concat(list.slice(0, 1)), show, tier));
    var head = _measure(stage, _tableHtml([], show, tier));
    if (list.length) tier.rowPx = Math.max(tier.rowPx, (one - head) / 2);
    var cw = _cellWidths(show, tier);
    var tw = _textWidthsMemo(stage, titles, 'regular');
    var cwid = _textWidthsMemo(stage, cats, 'regular');
    var tall = list.map(function (r, i) {
      return (tw[i] || 0) > cw.title || (cw.category > 0 && (cwid[i] || 0) > cw.category);
    });
    if (tall.indexOf(true) >= 0) {
      var sample = Object.assign({}, list[0], { title: new Array(80).join('Assignment ') });
      var two = _measure(stage, _tableHtml([sample, sample], show, tier, [true, true]));
      tier.row2Px = Math.max(tier.rowPx + 10, Math.ceil((two - head) / 2));
    }
    return { list: list, html: list.length ? _tableHtml(list, show, tier, tall) : '' };
  }

  function _measure(stage, html) {
    // The same markup is the same height (the table header, a sample row).
    var ok = _memoOk();
    if (ok && Object.prototype.hasOwnProperty.call(_heightMemo, html)) return _heightMemo[html];
    // html-safe: html is _tableHtml, escaped
    stage.innerHTML = '<div class="sheet-item">' + html + '</div>';
    var h = stage.firstChild.offsetHeight;
    if (ok) {
      _heightMemo[html] = h;
      _memoSize++;
    }
    return h;
  }

  function _sideHtml(body, paper, kind, from, cls) {
    return (
      '<div class="report-sheet ' +
      (cls || 'gr-sheet') +
      '" data-paper="' +
      paper +
      '"' +
      (kind ? ' data-kind="' + kind + '" data-side="' + from + '"' : '') +
      '><div class="sheet-body">' +
      body +
      '</div></div>'
    );
  }

  /* ── Feedback Pages ────────────────────────────────────────── */

  var FB_COL_GAP = 16; // between the two columns (reports.css .fb-cols)
  var FB_COL_W = (ROW_W - FB_COL_GAP) / 2;
  var FB_CARD_GAP = 12; // between cards in a column (.fb-col)

  /* A rubric taller than a whole column, cut between its criterion rows
     (a criterion and its comment row are one entry in `rows`). parts, in
     px: head (the title bar and the level header row, with the card's top
     edge), contHead (the same on a later piece, its title ending
     "(continued)"), foot (the card's bottom edge under the table) and tail
     (the last piece's bottom: the overall Feedback and the edge).
     firstRoom is the room left in the column the card starts in.
     Returns { pieces: [{ from, to, h }], startNext, over }: startNext when
     not one row fits firstRoom, so the first piece starts a fresh column;
     over when a single row is taller than a column (it goes alone). */
  function splitRows(rows, parts, colH, firstRoom) {
    var n = rows.length;
    var pieces = [];
    var room = firstRoom == null ? colH : Math.min(firstRoom, colH);
    var startNext = false;
    var over = false;
    var i = 0;
    while (i < n) {
      var head = pieces.length ? parts.contHead : parts.head;
      var sum = 0;
      var j = i;
      while (j < n && head + sum + rows[j] + (j === n - 1 ? parts.tail : parts.foot) <= room) {
        sum += rows[j];
        j++;
      }
      if (j === i) {
        if (room < colH) {
          if (!pieces.length) startNext = true;
          room = colH;
          continue;
        }
        sum = rows[j];
        j++;
        over = true;
      }
      pieces.push({ from: i, to: j, h: head + sum + (j === n ? parts.tail : parts.foot) });
      i = j;
      room = colH;
    }
    return { pieces: pieces, startNext: startNext, over: over };
  }

  /* The cards down two columns a side, in order: each goes under the one
     before it while it fits the room left, else to the top of the next
     column (left, then right, then the next side). Nothing moves back to
     fill a gap, so the order holds. entries: a height in px, or { h, rows,
     head, contHead, foot, tail } for a rubric that may split (splitRows),
     which it does only when taller than a column. opts.gap: px between
     cards (12). Returns { sides: [[left, right]], over }, each column a
     list of { i (the entry), h } and, on a piece of a split rubric,
     { from, to, part, last }. over: something taller than a column that
     could not be split; it sits alone at the top of a column. */
  function packColumns(entries, colH, opts) {
    var gap = opts && opts.gap != null ? opts.gap : FB_CARD_GAP;
    var sides = [];
    var c = 1;
    var used = 0;
    var over = false;
    function next() {
      c++;
      used = 0;
      if (c > 1) {
        sides.push([[], []]);
        c = 0;
      }
    }
    function room() {
      return used ? colH - used - gap : colH;
    }
    function put(p) {
      if (used) used += gap;
      used += p.h;
      sides[sides.length - 1][c].push(p);
    }
    if (!entries.length) return { sides: [], over: false };
    next();
    entries.forEach(function (e, i) {
      var h = typeof e === 'number' ? e : e.h;
      if (h <= room()) return put({ i: i, h: h });
      if (h <= colH) {
        next();
        return put({ i: i, h: h });
      }
      if (e && e.rows && e.rows.length > 1) {
        var r = splitRows(e.rows, e, colH, room());
        if (r.startNext && used) next();
        r.pieces.forEach(function (p, k) {
          if (k) next();
          put({ i: i, h: p.h, from: p.from, to: p.to, part: k, last: k === r.pieces.length - 1 });
        });
        if (r.over) over = true;
        return;
      }
      if (used) next();
      put({ i: i, h: h });
      over = true;
    });
    return { sides: sides, over: over };
  }

  /* The student's cards: ReportFeedback's items with the class's choices.
     Rubrics off drops the rubric tables (a card with nothing left goes);
     Assignment Comments off drops the written feedback. */
  function feedbackItems(cid, student, o) {
    if (typeof ReportFeedback === 'undefined' || !ReportFeedback.forStudent) return [];
    return ReportFeedback.forStudent(cid, student, { order: o.order })
      .map(function (it) {
        var x = Object.assign({}, it);
        if (!o.comments) x.feedback = [];
        if (!o.rubrics) x.rubric = null;
        return x;
      })
      .filter(function (x) {
        return !!x.rubric || (x.feedback && x.feedback.length > 0);
      })
      .filter(function (x) {
        // One Report: a card goes with its assessment when that is left
        // off the list, or when the card itself is removed (o.omit).
        return !(o.omit && o.omit[x.id]);
      });
  }

  /* The cards after the assessments, in order: Observations, then the Term
     Comment, each only when ticked and the student has something. rows:
     the entries the card splits between (an observation, a paragraph). */
  function extraCards(cid, student, ctx, o) {
    var out = [];
    if (typeof ReportFeedback === 'undefined') return out;
    var termId = ctx && ctx.termId;
    if (o.observations && ReportFeedback.observations) {
      var obs = ReportFeedback.observations(cid, student, termId);
      if (obs && obs.length) out.push({ kind: 'observations', rows: obs });
    }
    if (o.termComment && ReportFeedback.termComment) {
      var text = ReportFeedback.termComment(cid, student, termId);
      var paras = String(text || '')
        .split(/\n+/)
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);
      if (paras.length) out.push({ kind: 'term', rows: paras });
    }
    return out;
  }

  /* One piece of an extra card; part > 0 is a later piece. */
  // html-safe: ReportFeedback.observationsCardHtml / termCommentCardHtml escape every field
  function _extraHtml(x, p) {
    var rows = p ? x.rows.slice(p.from, p.to) : x.rows;
    var opts = { continued: !!(p && p.part > 0) };
    return x.kind === 'observations'
      ? ReportFeedback.observationsCardHtml(rows, opts)
      : ReportFeedback.termCommentCardHtml(rows.join('\n'), opts);
  }

  /* One piece of a split rubric as its own card. */
  function _pieceItem(item, p) {
    var x = Object.assign({}, item, {
      rubric: Object.assign({}, item.rubric, { rows: item.rubric.rows.slice(p.from, p.to) }),
    });
    if (p.part > 0) x.title = (item.title || '') + ' (continued)';
    if (!p.last) x.feedback = [];
    return x;
  }

  /* The head of a Feedback Page: the student's name, the class, block and
     term, and the page number. */
  function _pageHeadHtml(name, meta, pageText) {
    return (
      '<div class="fb-page-head"><span class="fb-page-who"><b class="fb-page-name">' +
      esc(name) +
      '</b>' +
      (meta ? '<span class="fb-page-meta"> · ' + esc(meta) + '</span>' : '') +
      '</span><span class="fb-page-n">' +
      esc(pageText) +
      '</span></div>'
    );
  }

  /* Heights in the stage, in layout px (the stage may sit under a zoom). */
  function _scale(stage) {
    return stage.getBoundingClientRect().width / stage.offsetWidth || 1;
  }
  function _measureCards(stage, htmls) {
    // html-safe: htmls are ReportFeedback card HTML (report-feedback-cards.js escapes every field)
    stage.innerHTML = '<div class="fb-col" style="width:' + FB_COL_W + 'px">' + htmls.join('') + '</div>';
    var k = _scale(stage);
    return Array.prototype.map.call(stage.firstChild.children, function (el) {
      return el.getBoundingClientRect().height / k;
    });
  }

  /* The rubric's type steps down, 9px to 7.5px, until every word in its
     cells fits its cell (overflow-wrap would split it: "understandab|le").
     Each word is measured in its own font on a canvas against its box's
     content width; a hyphen is a place to break. The checks are 0.5px
     smaller than the descriptors (reports.css .fb-cks). */
  var FB_RB_SIZES = [9, 8.5, 8, 7.5];
  var _wordPx = {};
  var _ctx2d = null;
  function _textWidth(font, word) {
    var key = font + '|' + word;
    if (_wordPx[key] == null) {
      if (!_ctx2d) _ctx2d = document.createElement('canvas').getContext('2d');
      if (!_ctx2d) return 0;
      _ctx2d.font = font;
      _wordPx[key] = _ctx2d.measureText(word).width;
    }
    return _wordPx[key];
  }
  function _rubricTextSize(card) {
    var table = card.querySelector('table.fb-rb');
    if (!table) return FB_RB_SIZES[0];
    var max = Infinity;
    // skip: text the box does not hold (the mark, and the checks, which
    // are measured in their own boxes).
    var fit = function (box, skip, extra) {
      var bs = getComputedStyle(box);
      var room = box.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
      if (!(room > 0)) return;
      var walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var el = n.parentElement;
          return skip && el && el.closest(skip) && box.contains(el.closest(skip))
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      });
      var n;
      while ((n = walk.nextNode())) {
        var fs = getComputedStyle(n.parentElement);
        var font = fs.fontStyle + ' ' + fs.fontWeight + ' ' + fs.fontSize + ' ' + fs.fontFamily;
        var size = parseFloat(fs.fontSize);
        String(n.textContent)
          .split(/\s+/)
          .forEach(function (w) {
            w.replace(/-/g, '-\u0000')
              .split('\u0000')
              .forEach(function (part) {
                var px = part ? _textWidth(font, part) : 0;
                if (px > room) max = Math.min(max, (size * room) / px + extra);
              });
          });
      }
    };
    // The heading row is half a point larger than the cells (reports.css),
    // so its words need half a point less than the cells' size allows.
    Array.prototype.forEach.call(table.querySelectorAll('thead th'), function (cell) {
      fit(cell, null, -0.5);
    });
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr:not(.fb-cm) > *'), function (cell) {
      fit(cell, '.fb-mk, .fb-cks', 0);
      Array.prototype.forEach.call(cell.querySelectorAll('.fb-ck > span:last-child'), function (label) {
        fit(label, null, 0.5);
      });
    });
    for (var i = 0; i < FB_RB_SIZES.length; i++) if (FB_RB_SIZES[i] <= max) return FB_RB_SIZES[i];
    return FB_RB_SIZES[FB_RB_SIZES.length - 1];
  }
  function _withTextSize(html, size) {
    return size && size < FB_RB_SIZES[0]
      ? html.replace(/^<div class="fb-card /, '<div style="--fb-rb-size:' + size + 'px" class="fb-card ')
      : html;
  }

  /* A rubric card's parts for splitRows, measured: the full card gives each
     criterion's height (to the next criterion's top, so the borders between
     rows count), the head above the first and the tail under the table; a
     "(continued)" piece of the first row with no Feedback gives contHead
     and foot. */
  function _rubricParts(stage, item, number, h, size) {
    var cont = _pieceItem(item, { from: 0, to: 1, part: 1, last: false });
    // html-safe: two ReportFeedback.cardHtml cards (report-feedback-cards.js escapes every field); size is a number
    stage.innerHTML =
      '<div class="fb-col" style="width:' +
      FB_COL_W +
      'px">' +
      _withTextSize(ReportFeedback.cardHtml(item, { number: number }), size) +
      _withTextSize(ReportFeedback.cardHtml(cont, { number: number }), size) +
      '</div>';
    var k = _scale(stage);
    var cards = stage.firstChild.children;
    var part = function (card) {
      var box = card.getBoundingClientRect();
      var table = card.querySelector('table.fb-rb');
      if (!table) return null;
      var tops = Array.prototype.map.call(table.querySelectorAll('tbody > tr:not(.fb-cm)'), function (tr) {
        return tr.getBoundingClientRect().top;
      });
      var bottom = table.getBoundingClientRect().bottom;
      return { box: box, tops: tops, bottom: bottom };
    };
    var full = part(cards[0]);
    var one = part(cards[1]);
    if (!full || !one || full.tops.length !== item.rubric.rows.length || !full.tops.length) return h;
    var rows = full.tops.map(function (t, i) {
      return ((i + 1 < full.tops.length ? full.tops[i + 1] : full.bottom) - t) / k;
    });
    return {
      h: h,
      rows: rows,
      head: (full.tops[0] - full.box.top) / k,
      tail: (full.box.bottom - full.bottom) / k,
      contHead: (one.tops[0] - one.box.top) / k,
      foot: (one.box.bottom - one.bottom) / k,
    };
  }

  /* An Observations or Term Comment card's parts for splitRows, measured
     like _rubricParts: each entry's height (to the next entry's top), the
     head above the first, the foot under the last, and the head of a
     "(continued)" piece. */
  function _extraParts(stage, x, h) {
    var cont = _extraHtml(x, { from: 0, to: 1, part: 1 });
    // html-safe: both cards from _extraHtml, which is escaped
    stage.innerHTML = '<div class="fb-col" style="width:' + FB_COL_W + 'px">' + _extraHtml(x) + cont + '</div>';
    var k = _scale(stage);
    var sel = x.kind === 'observations' ? '.fb-obs' : '.fb-para';
    var part = function (card) {
      var els = card.querySelectorAll(sel);
      var tops = Array.prototype.map.call(els, function (el) {
        return el.getBoundingClientRect().top;
      });
      var last = els[els.length - 1];
      return { box: card.getBoundingClientRect(), tops: tops, bottom: last ? last.getBoundingClientRect().bottom : 0 };
    };
    var full = part(stage.firstChild.children[0]);
    var one = part(stage.firstChild.children[1]);
    if (full.tops.length !== x.rows.length || !full.tops.length) return h;
    var rows = full.tops.map(function (t, i) {
      return ((i + 1 < full.tops.length ? full.tops[i + 1] : full.bottom) - t) / k;
    });
    var foot = (full.box.bottom - full.bottom) / k;
    return {
      h: h,
      rows: rows,
      head: (full.tops[0] - full.box.top) / k,
      tail: foot,
      contHead: (one.tops[0] - one.box.top) / k,
      foot: foot,
    };
  }

  /* The Feedback Pages for one student, measured in `stage`, or null with
     no cards: { count (sides), over, cards, colPx, body(page, total) },
     body giving each side's HTML, numbered from `page` of `total`. H is a
     side's height. */
  function _feedbackPages(cid, student, ctx, o, list, stage, H) {
    var items = feedbackItems(cid, student, o);
    var extras = extraCards(cid, student, ctx, o);
    if (!items.length && !extras.length) return null;
    var nums = {};
    if (o.numbers) {
      list.forEach(function (r) {
        nums[r.id] = r.n;
      });
    }
    var numberOf = function (it) {
      return o.numbers && nums[it.id] != null ? nums[it.id] : null;
    };
    var sizes = items.map(function () {
      return FB_RB_SIZES[0];
    });
    var cardOf = function (i, piece) {
      if (i >= items.length) return _extraHtml(extras[i - items.length], piece);
      var it = items[i];
      var html = ReportFeedback.cardHtml(piece ? _pieceItem(it, piece) : it, { number: numberOf(it) });
      return _withTextSize(html, sizes[i]);
    };
    var htmls = items.concat(extras).map(function (it, i) {
      return cardOf(i);
    });
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var block = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    var meta = [course.name, block, (ctx && ctx.termLabel) || ''].filter(Boolean).join(' · ');
    var name = typeof printedStudentName === 'function' ? printedStudentName(student, o.name) : fullName(student);
    // The widest page number it can print, so the head never grows later.
    stage.innerHTML = _pageHeadHtml(name, meta, 'Page 88 of 88');
    var headPx = stage.firstChild.getBoundingClientRect().height / _scale(stage);
    var colH = H - headPx - GAP;
    var heights = _measureCards(stage, htmls);
    var smaller = false;
    Array.prototype.forEach.call(stage.firstChild.children, function (el, i) {
      if (!items[i] || !items[i].rubric) return;
      sizes[i] = _rubricTextSize(el);
      if (sizes[i] < FB_RB_SIZES[0]) {
        htmls[i] = cardOf(i);
        smaller = true;
      }
    });
    if (smaller) heights = _measureCards(stage, htmls);
    var entries = heights.map(function (h, i) {
      if (i >= items.length)
        return h > colH && extras[i - items.length].rows.length > 1
          ? _extraParts(stage, extras[i - items.length], h)
          : h;
      var it = items[i];
      return h > colH && it.rubric && it.rubric.rows && it.rubric.rows.length > 1
        ? _rubricParts(stage, it, numberOf(it), h, sizes[i])
        : h;
    });
    // Each piece of a split rubric is measured as it prints; a piece taller
    // than its sum (a border more or less) moves its last row on.
    var packed = null;
    for (var tries = 0; tries < 4; tries++) {
      packed = packColumns(entries, colH, { gap: FB_CARD_GAP });
      var pieces = [];
      packed.sides.forEach(function (sd) {
        sd.forEach(function (col) {
          col.forEach(function (p) {
            if (p.from != null) pieces.push(p);
          });
        });
      });
      if (!pieces.length) break;
      var real = _measureCards(
        stage,
        pieces.map(function (p) {
          return cardOf(p.i, p);
        }),
      );
      var grew = false;
      pieces.forEach(function (p, k) {
        if (real[k] > p.h + 0.5) {
          entries[p.i].rows[p.to - 1] += real[k] - p.h;
          grew = true;
        }
      });
      if (!grew) break;
    }
    var placed = function (p) {
      return p.from != null ? cardOf(p.i, p) : htmls[p.i];
    };
    return {
      count: packed.sides.length,
      over: packed.over,
      cards: items.length + extras.length,
      colPx: colH,
      body: function (page, total) {
        return packed.sides.map(function (sd, s) {
          return (
            _pageHeadHtml(name, meta, 'Page ' + (page + s) + ' of ' + total) +
            '<div class="fb-cols">' +
            sd
              .map(function (col) {
                return '<div class="fb-col">' + col.map(placed).join('') + '</div>';
              })
              .join('') +
            '</div>'
          );
        });
      },
    };
  }

  return {
    options: options,
    columnsFor: columnsFor,
    rows: rows,
    resultText: resultText,
    categorySummary: categorySummary,
    packColumns: packColumns,
    splitRows: splitRows,
    feedbackItems: feedbackItems,
    extraCards: extraCards,
    extraHtml: _extraHtml,
    // One Report (report-one.js) draws its parts with these.
    listPart: listPart,
    summaryHtml: _summaryHtml,
    termHtml: _termHtml,
    feedbackPages: _feedbackPages,
    sideHtml: _sideHtml,
  };
})();
