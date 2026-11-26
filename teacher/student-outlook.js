// @ts-check
/* ── student-outlook.js — one student's missing work and where it leads ──
   Two screens ask the same question of one student: what is not handed in,
   and what would the grade be if it were? The teacher's student page
   (Overview and Grades tabs, teacher/page-student.js) and the Gradebook's
   card on a student's name (teacher/gradebook-chrome.js) both read `model`,
   so the two never disagree.

   Every grade here comes from calc.js. The grade "if handed in" is the same
   calculation with this student's Missing work left out (withMissingLeftOut),
   so it carries the category weights. It is worked out only for a class with
   a % (Missing lowers nothing else) and only when at least a third of the
   work is assessed: a guess from two scores misleads. Text goes into HTML
   through esc. */
/** @type {any} */ (window).StudentOutlook = (function () {
  'use strict';

  var THIN = 1 / 3;
  var LINE = { w: 104, h: 34, pad: 4 }; // the card's line of the grade, in px
  var MOST = 5; // lines of missing work on the card

  /* `assessments` is the work in view (the year so far, or as of the term in
     view); `cells`, when the caller has them, is { assessmentId: its
     assessmentCellValue }. Gives { assigned, missing, marked, handedIn,
     thin, lg, proj, gains, statusOf, dueOf }: `lg` the course letter and %
     now (null in a Proficiency class), `proj` { lg, cost } with every
     Missing piece in or null, `gains` { assessmentId: the % one piece adds },
     `missing` with the pieces that add most first, then the oldest. */
  function model(cid, sid, assessments, cells) {
    var statuses = getAssignmentStatuses(cid) || {};
    var statusOf = function (a) {
      return statuses[sid + ':' + a.id] || '';
    };
    var dueOf = function (a) {
      return a.dueDate || a.date || '';
    };
    var counted = (assessments || []).filter(function (a) {
      return countsTowardGrades(cid, a);
    });
    var assigned = counted.filter(function (a) {
      return statusOf(a) !== 'EXC';
    });
    var missing = counted.filter(function (a) {
      return statusOf(a) === 'NS';
    });
    var marked = assigned.filter(function (a) {
      if (statusOf(a) === 'NS') return false;
      var c = cells ? cells[a.id] : assessmentCellValue(cid, sid, a);
      return !!c && (c.kind === 'points' || c.kind === 'level' || c.kind === 'complete');
    });
    var thin = missing.length > 0 && assigned.length > 0 && marked.length / assigned.length < THIN;
    var lg = courseShowsLetterGrades(COURSES[cid]) ? getCourseLetterData(cid, sid) : null;
    /** @type {any} */
    var proj = null;
    /** @type {Record<string, number>} */
    var gains = {};
    if (lg && lg.R != null && missing.length && !thin) {
      var p = withMissingLeftOut(sid, null, function () {
        return getCourseLetterData(cid, sid);
      });
      if (p && p.R != null && p.R > lg.R) {
        proj = { lg: p, cost: Math.round(p.R - lg.R) };
        missing.forEach(function (a) {
          var one = withMissingLeftOut(sid, [a.id], function () {
            return getCourseLetterData(cid, sid);
          });
          gains[a.id] = one && one.R != null ? Math.max(0, Math.round(one.R - lg.R)) : 0;
        });
      }
    }
    missing = missing.slice().sort(function (x, y) {
      return (gains[y.id] || 0) - (gains[x.id] || 0) || dueOf(x).localeCompare(dueOf(y));
    });
    return {
      assigned: assigned,
      missing: missing,
      marked: marked,
      handedIn: assigned.length - missing.length,
      thin: thin,
      lg: lg,
      proj: proj,
      gains: gains,
      statusOf: statusOf,
      dueOf: dueOf,
    };
  }

  /* ── The Gradebook's card on a student's name ─────────────── */

  function _dayNumber(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : 0;
  }

  /* The grade on each day work counted, to the last day in view, and how it
     has moved in a month: { points, since, then, last }. The last day is
     today, or the end of the term in view when that has passed. */
  function _history(cid, sid, o) {
    var today = courseToday(cid);
    var term = getActiveTerm(cid);
    var end = term && term.endsOn && term.endsOn < today ? term.endsOn : today;
    var marked = {};
    o.marked.forEach(function (a) {
      marked[a.id] = true;
    });
    var days = {};
    o.assigned.forEach(function (a) {
      var day = String(a.date || '').slice(0, 10);
      if (day && day <= end && (marked[a.id] || o.statusOf(a) === 'NS')) days[day] = true;
    });
    var since = monthAgoDate(end);
    if (since) days[since] = true;
    days[end] = true;
    var all = gradeOverYear(cid, sid, Object.keys(days).sort()).filter(function (h) {
      return h.value != null;
    });
    return {
      points: all,
      since: since,
      then: all.filter(function (h) {
        return h.day === since;
      })[0],
      last: all[all.length - 1],
    };
  }

  /* "5% Since Oct 26" under the grade, pointing up or down: the course % in a
     class with one, else the level's word when it has changed. Nothing when
     the grade shows the same as a month ago, or there was none then. */
  function _moveHtml(cid, h) {
    if (!h.then || !h.last || h.then === h.last) return '';
    var up;
    var text;
    if (courseGradeMode(cid) === 'proficiency') {
      if (!h.then.word || h.then.word === h.last.word) return '';
      up = h.last.level > h.then.level;
      text = 'From ' + h.then.word;
    } else {
      var points = wholePercent(Math.abs(h.last.value - h.then.value));
      if (!points) return '';
      up = h.last.value > h.then.value;
      text = points + '%';
    }
    return (
      '<div class="gb-card-move ' +
      (up ? 'is-up' : 'is-down') +
      '"><svg aria-hidden="true" width="9" height="8" viewBox="0 0 9 8"><path d="' +
      (up ? 'M4.5 0L9 8H0z' : 'M4.5 8L0 0h9z') +
      '" fill="currentColor"/></svg><span>' +
      esc(text + ' Since ' + formatShortDate(h.since)) +
      '</span></div>'
    );
  }

  /* The grade since the first work as a small line, drawn by its days; none
     with fewer than three. The scale spans at least 20 points (one level in
     a Proficiency class) so a steady grade draws flat. */
  function _lineHtml(cid, points, color) {
    if (points.length < 3) return '';
    var first = _dayNumber(points[0].day);
    var span = _dayNumber(points[points.length - 1].day) - first || 1;
    var least = courseGradeMode(cid) === 'proficiency' ? 1 : 20;
    var lo = Infinity;
    var hi = -Infinity;
    points.forEach(function (p) {
      lo = Math.min(lo, p.value);
      hi = Math.max(hi, p.value);
    });
    if (hi - lo < least) {
      var mid = (hi + lo) / 2;
      lo = mid - least / 2;
      hi = mid + least / 2;
    }
    var tenth = function (px) {
      return Math.round(px * 10) / 10;
    };
    var xy = points.map(function (p) {
      var across = (_dayNumber(p.day) - first) / span;
      var up = (p.value - lo) / (hi - lo);
      return [
        tenth(LINE.pad + across * (LINE.w - 2 * LINE.pad)),
        tenth(LINE.h - LINE.pad - up * (LINE.h - 2 * LINE.pad)),
      ];
    });
    var end = xy[xy.length - 1];
    return (
      '<svg class="gb-card-line" role="img" aria-label="The grade over the year" width="' +
      LINE.w +
      '" height="' +
      LINE.h +
      '" viewBox="0 0 ' +
      LINE.w +
      ' ' +
      LINE.h +
      '"><polyline points="' +
      xy
        .map(function (q) {
          return q.join(',');
        })
        .join(' ') +
      '" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="stroke:' +
      color +
      '"/><circle cx="' +
      end[0] +
      '" cy="' +
      end[1] +
      '" r="3" style="fill:' +
      color +
      '"/></svg>'
    );
  }

  /* The categories as the student page's Course Grade strip draws them: a
     bar a category, as wide as its share of the grade and filled to its
     grade in its level's colour, then a line a category with its share and
     its grade. Categories that count toward nothing are left out. */
  function _categoriesHtml(cid, sid, assessments) {
    var cats = (getCategories(cid) || []).filter(function (c) {
      return Number(c.weight || 0) > 0;
    });
    if (!cats.length) return '';
    var bars = '';
    var rows = '';
    var label = [];
    cats.forEach(function (cat) {
      var mine = assessmentGroupGrade(
        cid,
        sid,
        assessments.filter(function (a) {
          return (a.categoryId || a.category_id || null) === cat.id;
        }),
        categoryCalcMode(cat),
      );
      var w = Number(cat.weight);
      var fill = mine ? (mine.pct != null ? mine.pct : mine.prof != null ? (mine.prof / 4) * 100 : 0) : 0;
      var color = PROF_COLORS[mine ? mine.level : 0] || PROF_COLORS[0];
      label.push(cat.name + ' ' + (mine ? mine.text : 'not yet graded') + ', ' + w + '% of the grade');
      bars +=
        '<div class="gb-card-seg" style="flex:' +
        w +
        ' 1 0"><div style="width:' +
        Math.max(0, Math.min(100, fill)) +
        '%;background:' +
        color +
        '"></div></div>';
      rows +=
        '<div class="gb-card-row gb-card-cat"><span class="gb-card-what">' +
        esc(cat.name) +
        '</span><small>' +
        esc(w + '%') +
        '</small><b style="color:' +
        (mine ? color : 'var(--text-3)') +
        '">' +
        esc(mine ? mine.text : '—') +
        '</b></div>';
    });
    return '<div class="gb-card-cats" role="img" aria-label="' + esc(label.join('; ')) + '">' + bars + '</div>' + rows;
  }

  /* Missing Work: each piece with its day and, when the class has a % and
     enough is assessed, what handing it in adds; five lines at most (four
     and "N More" past that), then the grade with all of it in. */
  function _missingHtml(cid, sid, o) {
    if (!o.missing.length) return '';
    var shown = o.missing.length > MOST ? o.missing.slice(0, MOST - 1) : o.missing;
    var html =
      '<div class="gb-card-head"><span>Missing Work</span>' + (o.proj ? '<span>If Handed In</span>' : '') + '</div>';
    shown.forEach(function (a) {
      html +=
        '<div class="gb-card-row"><span class="gb-card-what">' +
        esc(a.title || 'Assessment') +
        '</span><small>' +
        esc(formatShortDate(o.dueOf(a))) +
        '</small>' +
        (o.proj ? '<b class="gb-card-gain">' + (o.gains[a.id] > 0 ? '+' + o.gains[a.id] + '%' : '') + '</b>' : '') +
        '</div>';
    });
    if (o.missing.length > shown.length)
      html += '<div class="gb-card-more">' + (o.missing.length - shown.length) + ' More</div>';
    if (o.proj) {
      // The letter and % as the class prints them, with the Missing work in.
      var badge = withMissingLeftOut(sid, null, function () {
        return studentGradeBadges(cid, sid).letter;
      });
      if (badge)
        html +=
          '<div class="gb-card-total"><span>' +
          (o.missing.length === 1 ? 'With It Handed In' : 'With All ' + o.missing.length + ' Handed In') +
          '</span><b style="color:' +
          (PROF_COLORS[badge.level] || PROF_COLORS[0]) +
          '">' +
          esc(badge.text) +
          '</b></div>';
    }
    return html;
  }

  /* The card: the student's name, the grade as the class shows it with how
     it has moved in a month and a line of it over the year, the categories,
     then the missing work. Built when the card opens, not for every row. */
  // html-safe: names, titles, categories and grade text go through esc; levels and colours come from calc.js.
  function cardHtml(cid, student) {
    var sid = student.id;
    var assessments = _scopedAssessments(cid);
    var grade = studentGradeSummary(cid, sid, viewedReportTerm(cid));
    var word = levelWord(cid, getOverallProficiency(cid, sid));
    var color = grade.text ? PROF_COLORS[grade.level] || PROF_COLORS[0] : 'var(--text-3)';
    var o = model(cid, sid, assessments);
    var h = _history(cid, sid, o);
    return (
      '<div class="gb-tip-name">' +
      esc(displayName(student)) +
      '</div><div class="gb-card-top"><div><div class="gb-tip-grade" style="color:' +
      color +
      '">' +
      (grade.text ? (word ? word + ' (' + esc(grade.text) + ')' : esc(grade.text)) : 'No Evidence') +
      '</div>' +
      _moveHtml(cid, h) +
      '</div>' +
      _lineHtml(cid, h.points, color) +
      '</div>' +
      _categoriesHtml(cid, sid, assessments) +
      _missingHtml(cid, sid, o)
    );
  }

  return { model: model, cardHtml: cardHtml };
})();
