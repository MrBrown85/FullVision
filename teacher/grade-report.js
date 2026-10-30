/* grade-report.js — the Grade Report: a ready-made progress report that
   reads like the student printout from the old gradebook programs. The
   letterhead, one row per assessment this term (date, title, category,
   score, out of, percent in a Letter or Both class, and Missing, Late or
   Excused),
   then a summary by category, the term grade and the missing work. Grades
   only: no comment, attendance or other feedback.

   Every student gets one sheet: the front, and the back when the front is
   full. When the rows don't fit, the table steps down to smaller rows, then
   to two columns of rows on each side.

   Feedback Pages (the `feedback` option): after the grade sheet, a card for
   every assessment with a rubric or written feedback
   (ReportFeedback.forStudent and .cardHtml), down two columns, on as many
   sides as they need. Each card is measured at the column's width and the
   columns are filled by those heights (packColumns); a card never splits,
   except a rubric taller than a whole column, which splits between its
   criterion rows (splitRows). The layout returns what
   ReportSheets.layoutStudent returns, so the preview, the fit line, Everyone,
   Print Reports and the printed copies all work as they do for a built
   report (page-reports.js passes it as `layout`). */
window.GradeReport = (function () {
  'use strict';

  var PX_PER_IN = 96;
  var GAP = 12;
  var ROW_W = 720;
  // ungraded: list this term's work with no mark yet, a dash for its score
  // (Colin, Oct 29: leaving it off can mislead), up to today.
  // numbers: a "#" column numbering the rows in the order they print, off
  // until the teacher ticks Assignment Numbers.
  // feedback: the Feedback Pages after the grade sheet, off until the
  // teacher turns them on. rubrics and comments say what the cards show;
  // observations and termComment are saved for their own cards.
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
      FLAGS.forEach(function (k) {
        if (typeof saved[k] === 'boolean') o[k] = saved[k];
      });
      if (saved.order === 'newest' || saved.order === 'oldest') o.order = saved.order;
      if (saved.name === 'first' || saved.name === 'preferred') o.name = saved.name;
    }
    return o;
  }

  /* Which mark columns the class shows: the percent in a Letter or Both
     class. The assignments are the point, so no proficiency words. */
  function columnsFor(cid) {
    var mode = typeof courseGradeMode === 'function' ? courseGradeMode(cid) : 'proficiency';
    return { percent: mode !== 'proficiency' };
  }

  function _when(d) {
    if (!d) return '';
    return parseLocalDate(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  /* One student's rows: this term's assessments that have a mark or are
     Missing or Excused, and with Ungraded Assignments on, the work dated up
     to today with no mark yet, its score a dash. Work not yet due is left
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
        return a && !(typeof isDibelsScored === 'function' && isDibelsScored(a)) && assessmentInActiveTerm(cid, a);
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
        row.score = '\u2014';
      } else if (cv.kind === 'status') {
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
      } else if (cv.kind === 'level' && cv.value > 0) {
        row.score = levelFigure(cv.value);
        row.outOf = '4';
        row.percent = formatLevelAs(cid, cv.value, 'percent');
      } else return;
      out.push(row);
    });
    out.forEach(function (r, i) {
      r.n = i + 1;
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
     out so each row still reads in full. */
  /* The category and assignment columns share the width the others leave,
     by what the student's rows need (show.catPx and show.titlePx, measured
     in layoutStudent): both print in full when they fit; when they don't,
     each gets a share in proportion to its need, the title never less
     than TITLE_MIN_PX and the category never less than 100px, and the
     rest ends in "…". */
  var TITLE_MIN_PX = 200;
  var COL_GAP = 6; // reports.css .gr-row column-gap
  function _cols(show, tier) {
    var two = tier.cols === 2;
    var cols = [];
    // Assignment Numbers: a narrow bold column, wide enough for the
    // highest number (show.numPx, set in layoutStudent).
    if (show.numbers) cols.push(['n', '#', (show.numPx || 22) + 'px', 'r']);
    cols.push(['date', 'Date', '42px', ''], ['title', 'Assignment', 'minmax(0,1fr)', '']);
    if (!two) cols.push(['category', 'Category', null, '']);
    // Score holds "Incomplete"; the note "Excused" in bold.
    cols.push(['score', 'Score', two ? '54px' : '64px', 'r']);
    cols.push(['outOf', 'Out Of', two ? '34px' : '40px', 'r']);
    if (show.percent) cols.push(['percent', '%', two ? '32px' : '36px', 'r']);
    cols.push(['note', '', two ? '46px' : '52px', '']);
    if (!two) {
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
    }
    return cols;
  }

  /* The widest of some texts at the table's largest type, in px. */
  function _textPx(stage, names) {
    names = names.filter(function (n, i) {
      return n && names.indexOf(n) === i;
    });
    stage.innerHTML =
      '<div class="gr-table gr-regular">' +
      names
        .map(function (n) {
          return (
            '<div><span class="gr-measure" style="display:inline-block;white-space:nowrap">' + esc(n) + '</span></div>'
          );
        })
        .join('') +
      '</div>';
    var w = 0;
    Array.prototype.forEach.call(stage.querySelectorAll('.gr-measure'), function (el) {
      w = Math.max(w, el.offsetWidth);
    });
    return Math.ceil(w) + 4;
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
        (head ? c[1] : esc(String(v[c[0]] || ''))) +
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
      });
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

  /* The Feedback Pages for one student, measured in `stage`, or null with
     no cards: { count (sides), over, cards, colPx, body(page, total) },
     body giving each side's HTML, numbered from `page` of `total`. H is a
     side's height. */
  function _feedbackPages(cid, student, ctx, o, list, stage, H) {
    var items = feedbackItems(cid, student, o);
    if (!items.length) return null;
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
      var it = items[i];
      var html = ReportFeedback.cardHtml(piece ? _pieceItem(it, piece) : it, { number: numberOf(it) });
      return _withTextSize(html, sizes[i]);
    };
    var htmls = items.map(function (it, i) {
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
      if (!items[i].rubric) return;
      sizes[i] = _rubricTextSize(el);
      if (sizes[i] < FB_RB_SIZES[0]) {
        htmls[i] = cardOf(i);
        smaller = true;
      }
    });
    if (smaller) heights = _measureCards(stage, htmls);
    var entries = heights.map(function (h, i) {
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
      cards: items.length,
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

  /* One student's sheet, and with Feedback Pages on, the sides after it.
     opts: { paper, stage, grade (the class's choices) }. Returns the shape
     ReportSheets.layoutStudent returns, plus cards and feedbackSides. */
  function layoutStudent(cid, student, ctx, opts) {
    opts = opts || {};
    var o = options(opts.grade);
    var paper = opts.paper === 'legal' ? 'legal' : 'letter';
    var H = ReportSheets.sideHeight(paper);
    var show = columnsFor(cid);
    var list = rows(cid, student, o);
    var letterhead = ReportBlocks.renderBlockHeader(cid, student, ctx, { name: o.name });
    var tail = _tailHtml(cid, student, o);
    if (o.numbers) {
      show.numbers = true;
      show.numPx = 8 + 7 * String(Math.max(1, list.length)).length;
    }
    var own = !opts.stage;
    var stage = opts.stage || _stage(document.body);
    var chosen = null;
    var p = null;
    var fb = null;
    try {
      show.catPx = _textPx(
        stage,
        ['Category'].concat(
          list.map(function (r) {
            return r.category;
          }),
        ),
      );
      show.titlePx = _textPx(
        stage,
        ['Assignment'].concat(
          list.map(function (r) {
            return r.title;
          }),
        ),
      );
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
      if (o.feedback) fb = _feedbackPages(cid, student, ctx, o, list, stage, H);
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
    var gradeSides = p.tailOnFront ? 1 : 2;
    var bodies = [{ html: frontBody, cls: 'gr-sheet' }];
    if (gradeSides === 2) bodies.push({ html: backBody, cls: 'gr-sheet' });
    // The Feedback Pages start on the grade sheet's back when it has only
    // a front, else on the next side.
    if (fb) {
      fb.body(bodies.length + 1, bodies.length + fb.count).forEach(function (html) {
        bodies.push({ html: html, cls: 'fb-sheet' });
      });
    }
    var sides = bodies.length;
    var sheets = Math.ceil(sides / 2);
    // over: the grade sheet's rows don't all fit. feedbackOver: a feedback
    // card is taller than a page even after splitting.
    var feedbackOver = !!(fb && fb.over);
    var over = cut > 0 || feedbackOver;
    var name = fullName(student);
    var badge = over ? 'Too long' : sheets === 1 ? '1 sheet' : sheets + ' sheets';
    var html =
      '<div class="sheet-student" data-action="fitMapPick" data-sid="' +
      esc(student.id) +
      '" data-sheets="' +
      sheets +
      '" data-continued="0" data-after="0">' +
      '<div class="sheet-student-head no-print"><span class="sheet-student-name">' +
      esc(name) +
      '</span><span class="sheet-badge ' +
      (over ? 'over' : 'ok') +
      '">' +
      badge +
      '</span></div>';
    for (var s = 0; s < sheets * 2; s++) {
      var b = bodies[s];
      var label = sheets === 1 ? '' : 'Sheet ' + (Math.floor(s / 2) + 1) + ' · ';
      label += b ? (s % 2 ? 'Back' : 'Front') : 'Blank';
      if (sheets === 1 && !b) label = 'Blank';
      html +=
        '<div class="sheet-zoom" data-side="' +
        s +
        '"><div class="sheet-label no-print">' +
        label +
        '</div>' +
        (b
          ? _sideHtml(b.html, paper, 'side', s, b.cls)
          : '<div class="report-sheet sheet-blank-side" data-paper="' +
            paper +
            '"><div class="sheet-body"><div class="sheet-blank">This side is left blank.</div></div></div>') +
        '</div>';
    }
    html += '</div>';
    return {
      html: html,
      sheets: sheets,
      sides: sides,
      continued: [],
      after: [],
      over: over,
      feedbackOver: feedbackOver,
      gradeOver: cut > 0,
      used: 0,
      free: [],
      commentLines: 0,
      room: 0,
      noComment: false,
      noAttendance: false,
      badge: badge,
      tier: chosen.key,
      rows: list.length,
      cards: fb ? fb.cards : 0,
      feedbackSides: fb ? fb.count : 0,
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
    packColumns: packColumns,
    splitRows: splitRows,
    feedbackItems: feedbackItems,
    FB_COL_W: FB_COL_W,
    layoutStudent: layoutStudent,
    layoutWith: layoutWith,
  };
})();
