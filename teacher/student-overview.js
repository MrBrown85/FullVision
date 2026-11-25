// @ts-check
/* ── student-overview.js — the Overview's picture of the grade ─────────
   Two parts of the teacher's student page, Overview tab (DECISIONS, "The
   student Overview pictures the grade (2026-11-17)"):
   - Over the Year, in Your Grade Right Now: the grade as of each day work was
     assessed, to today, as calc.js's gradeOverYear reads it, and, when
     handing in the missing work would move it, where it would go.
   - Your Competencies: each competency as a tile in its folder, coloured
     by its level, with how the levels split above them.
   Pointing at a day lights the competencies its work counted toward;
   pointing at a competency lights the days it was assessed. A tap on a day
   shows that work below; a tap on a competency shows only its work.

   teacher/page-student.js builds the model; every number and word in it
   comes from calc.js and its helpers in the class's grading style. Nothing
   here works a grade out: it only places what it is given. Text goes into
   HTML through esc. */
window.StudentOverview = (function () {
  'use strict';

  var PLOT = { top: 6, bottom: 6, right: 4 }; // % of the plot kept clear at its edges

  function _day(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null;
  }

  // Where a value sits, 0 (bottom) to 100 (top), on the scale.
  function _at(scale, value) {
    var f = (value - scale.lo) / (scale.hi - scale.lo);
    f = Math.max(0, Math.min(1, f));
    return PLOT.bottom + f * (100 - PLOT.top - PLOT.bottom);
  }

  /* The y scale and its lines: the four levels in a Proficiency class; the
     letter bands' lower edges in a Letter or Both class, from C− (or lower
     when the grade has been lower) to 100. */
  function _scale(m) {
    if (m.mode === 'proficiency') {
      return {
        lo: 0.75,
        hi: 4.25,
        lines: [1, 2, 3, 4].map(function (l) {
          return { value: l, label: m.levelNames[l] || '' };
        }),
      };
    }
    var lowest = 100;
    m.points.forEach(function (p) {
      lowest = Math.min(lowest, p.value);
    });
    if (m.proj) lowest = Math.min(lowest, m.proj.value);
    var lo = [50, 30, 0].filter(function (t) {
      return t <= lowest - 2;
    })[0];
    if (lo == null) lo = 0;
    return {
      lo: lo,
      hi: 100,
      lines: m.bands
        .filter(function (b) {
          return b.min >= lo && b.min < 100;
        })
        .map(function (b) {
          return { value: b.min, label: b.label };
        }),
    };
  }

  function _monthTicks(first, last) {
    var out = [];
    var d = new Date(first * 864e5);
    var y = d.getUTCFullYear();
    var mo = d.getUTCMonth() + 1;
    for (var i = 0; i < 14; i++, mo++) {
      if (mo > 11) {
        mo = 0;
        y++;
      }
      var t = Date.UTC(y, mo, 1) / 864e5;
      if (t > last) break;
      out.push({ t: t, label: new Date(t * 864e5).toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' }) });
    }
    return out;
  }

  function _tipHtml(lines) {
    return '<span class="stu-gp-tip" role="tooltip">' + lines.join('') + '</span>';
  }

  /* What the teacher gave and wrote on one piece, to read without opening
     anything: the overall comment, then each rubric criterion (or each
     competency, on work scored without a rubric) with its level and the
     comment on it, as the student's Your Feedback shows it (DECISIONS, "The
     student page from the student's side" 8). A Single-Point Rubric's two
     notes are Went Beyond and Work On. '' with nothing to show. */
  function feedbackHtml(cid, studentId, a, st) {
    if (st === 'NS' || st === 'EXC') return '';
    var note = getScoreComment(cid, studentId, a.id);
    var rows = [];
    var single = false;
    var rid = a.rubricId || a.rubric_id;
    var rubric = !isPointsScored(a) && rid ? getRubricById(cid, rid) : null;
    if (rubric) {
      single = rubric.style === 'single_point';
      // A Six-Point criterion reads as its score, then what it counts as.
      var RS = window.RubricScale;
      var six = !!RS && RS.has(rubric);
      (rubric.criteria || []).forEach(function (crit) {
        var v = rubricCriterionLevel(cid, studentId, a, crit);
        rows.push({
          name: crit.name || '',
          text:
            v != null ? (six ? RS.label(rubric, RS.fromValue(rubric, v)) + ' · ' : '') + nearestScoreLevelName(v) : '',
          lv: v != null ? nearestScoreLevel(v).level : 0,
          // On group work, the line for this student alone follows the group's comment.
          comment: [
            getRubricCriterionComment(cid, studentId, a.id, crit),
            getRubricCriterionOwn(cid, studentId, a.id, crit),
          ]
            .filter(Boolean)
            .join(' '),
          beyond: single ? getRubricCriterionBeyond(cid, studentId, a.id, crit) : '',
        });
      });
    } else if (!isPointsScored(a)) {
      var mine = getScores(cid)[studentId] || [];
      var tids = a.tagIds || [];
      tids.forEach(function (tid) {
        var e = mine.find(function (x) {
          return x.assessmentId === a.id && x.tagId === tid;
        });
        var tag = getTagById(cid, tid);
        var has = e && e.score > 0;
        rows.push({
          name: (tag && (tag.label || tag.text)) || '',
          text: has ? scoreLevelText(roundLevel(e.score), e.mod) : '',
          lv: has ? roundLevel(e.score) : 0,
          comment: getTagComment(cid, studentId, a.id, tid),
          beyond: '',
        });
      });
      // One competency with a level and no comment says what the row's score says.
      if (
        tids.length < 2 &&
        !rows.some(function (r) {
          return r.comment;
        })
      )
        rows = [];
    }
    rows = rows.filter(function (r) {
      return r.name && (r.text || r.comment || r.beyond);
    });
    var words = rows.some(function (r) {
      return r.comment || r.beyond;
    });
    var html = note ? '<p class="stu-ov-fb-note">' + esc(note) + '</p>' : '';
    if (!rows.length) return html;
    html += '<ul class="stu-ov-fb-crits' + (words ? '' : ' no-words') + '">';
    rows.forEach(function (r) {
      var said = '';
      if (single) {
        if (r.beyond) said += '<span class="stu-ov-fb-part beyond"><b>Went Beyond</b> ' + esc(r.beyond) + '</span>';
        if (r.comment) said += '<span class="stu-ov-fb-part work"><b>Work On</b> ' + esc(r.comment) + '</span>';
      } else if (r.comment) said = esc(r.comment);
      html +=
        '<li class="stu-ov-fb-crit"><span class="stu-ov-fb-name">' +
        esc(r.name) +
        '</span><span class="stu-ov-fb-lv">' +
        (r.text ? '<span class="stu-level stu-level-' + r.lv + '">' + esc(r.text) + '</span>' : '') +
        '</span>' +
        (words ? '<span class="stu-ov-fb-words">' + said + '</span>' : '') +
        '</li>';
    });
    return html + '</ul>';
  }

  /* ── Over the Year ────────────────────────────────────────── */
  function lineHtml(m) {
    var head = '<div class="stu-ov-label stu-gp-line-head">Over the Year</div>';
    if (!m.points.length)
      return '<div class="stu-gp-line">' + head + '<p class="stu-gp-empty">No assessed work yet.</p></div>';
    var scale = _scale(m);
    var first = _day(m.points[0].day) || 0;
    var last = _day(m.today) || _day(m.points[m.points.length - 1].day) || first;
    if (last <= first) first = last - 1;
    var xOf = function (day) {
      return (((_day(day) || last) - first) / (last - first)) * (100 - PLOT.right);
    };
    var grid = '';
    var yLabels = '';
    var widest = '';
    var kept = -100;
    scale.lines.forEach(function (l) {
      var y = 100 - _at(scale, l.value);
      // A line too close to the last one kept is left out, so no two labels touch.
      if (Math.abs(y - kept) < 9) return;
      kept = y;
      grid +=
        '<line class="stu-gp-grid" x1="0" x2="100" y1="' + y + '" y2="' + y + '" vector-effect="non-scaling-stroke"/>';
      yLabels += '<span style="top:' + y + '%">' + esc(l.label) + '</span>';
      if (String(l.label).length > widest.length) widest = String(l.label);
    });
    var pts = m.points.map(function (p) {
      return { p: p, x: xOf(p.day), y: 100 - _at(scale, p.value) };
    });
    var line = pts
      .map(function (q, i) {
        return (i ? 'L' : 'M') + q.x + ' ' + q.y;
      })
      .join(' ');
    var area = line + ' L' + pts[pts.length - 1].x + ' 100 L' + pts[0].x + ' 100 Z';
    var svg =
      '<svg class="stu-gp-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      grid +
      '<path class="stu-gp-area" d="' +
      area +
      '"/><path class="stu-gp-path" d="' +
      line +
      '" vector-effect="non-scaling-stroke"/>';
    var end = pts[pts.length - 1];
    var projHtml = '';
    if (m.proj) {
      var py = 100 - _at(scale, m.proj.value);
      svg +=
        '<line class="stu-gp-proj" x1="' +
        end.x +
        '" x2="' +
        end.x +
        '" y1="' +
        end.y +
        '" y2="' +
        py +
        '" vector-effect="non-scaling-stroke"/>';
      projHtml =
        '<span class="stu-gp-projpt" style="left:' +
        end.x +
        '%;top:' +
        py +
        '%" title="' +
        esc(m.proj.label) +
        '"></span>';
    }
    svg += '</svg>';
    var dots = pts
      .map(function (q, i) {
        var p = q.p;
        var isEnd = i === pts.length - 1;
        var tip = [
          '<strong>' + esc(p.label) + '</strong>',
          '<span class="stu-gp-tip-grade">' + esc(p.text) + (p.word ? ' ' + esc(p.word) : '') + '</span>',
        ];
        p.pieces.forEach(function (w) {
          tip.push('<span class="stu-gp-tip-row"><span>' + esc(w.title) + '</span><b>' + esc(w.text) + '</b></span>');
        });
        if (p.pieces.length)
          tip.push(
            '<span class="stu-gp-tip-hint">' + (p.pieces.length > 1 ? 'Show this work' : 'Show it below') + '</span>',
          );
        var ids = p.pieces.map(function (w) {
          return w.id;
        });
        var secs = [];
        p.pieces.forEach(function (w) {
          (w.secs || []).forEach(function (s) {
            if (secs.indexOf(s) < 0) secs.push(s);
          });
        });
        // Each day takes the strip of the plot nearest to it, so the pointer finds a day by its date
        // however close the days are; a hairline marks it.
        var from = i ? (pts[i - 1].x + q.x) / 2 : 0;
        var to = i < pts.length - 1 ? (q.x + pts[i + 1].x) / 2 : 100;
        return (
          '<button type="button" class="stu-gp-pt stu-gp-lv-' +
          (p.lv || 0) +
          (isEnd ? ' end' : '') +
          (q.x > 70 ? ' tip-end' : q.x < 20 ? ' tip-start' : '') +
          '" style="left:' +
          from +
          '%;width:' +
          (to - from) +
          '%;--at:' +
          (to > from ? ((q.x - from) / (to - from)) * 100 : 50) +
          '%" data-action="stuGpPoint" data-aids="' +
          esc(ids.join(' ')) +
          '" data-secs="' +
          esc(secs.join(' ')) +
          '" aria-label="' +
          esc(
            p.label +
              ': ' +
              p.text +
              (p.word ? ' ' + p.word : '') +
              (p.pieces.length
                ? '. ' +
                  p.pieces
                    .map(function (w) {
                      return w.title + ' ' + w.text;
                    })
                    .join(', ')
                : ''),
          ) +
          '"><span class="stu-gp-mark" style="top:' +
          q.y +
          '%"><span class="stu-gp-dot"></span>' +
          _tipHtml(tip) +
          '</span></button>'
        );
      })
      .join('');
    var xLabels = _monthTicks(first, last)
      .map(function (t) {
        var x = ((t.t - first) / (last - first)) * (100 - PLOT.right);
        return x < 2 || x > 94 ? '' : '<span style="left:' + x + '%">' + esc(t.label) + '</span>';
      })
      .join('');
    return (
      '<div class="stu-gp-line" role="group" aria-label="Your grade over the year">' +
      head +
      '<div class="stu-gp-plot"><div class="stu-gp-y" aria-hidden="true" data-w="' +
      esc(widest) +
      '">' +
      yLabels +
      '</div><div class="stu-gp-area-box">' +
      svg +
      dots +
      projHtml +
      '</div><span></span><div class="stu-gp-x" aria-hidden="true">' +
      xLabels +
      '</div></div></div>'
    );
  }

  /* ── Your Competencies ────────────────────────────────────── */
  function compsHtml(m) {
    var c = m.comps;
    if (!c.total) return '';
    var html =
      '<section class="stu-gp-card stu-gp-comps" aria-label="Your competencies"><div class="stu-gp-head">' +
      '<h3 class="stu-ov-h3">Your Competencies</h3><span class="stu-gp-sub">' +
      c.scored +
      ' of ' +
      c.total +
      ' assessed</span></div>';
    // How the levels split: a Proficiency or Both class names its levels (a Letter class does not).
    if (c.counts.length) {
      html +=
        '<div class="stu-gp-seg" role="img" aria-label="' +
        esc(
          c.counts
            .map(function (k) {
              return k.n + ' ' + k.name;
            })
            .join(', '),
        ) +
        '">';
      c.counts.forEach(function (k) {
        html +=
          '<span class="stu-gp-seg-part stu-gp-lv-' +
          k.lv +
          '" style="flex:' +
          k.n +
          ' 1 0" data-lv="' +
          k.lv +
          '" title="' +
          esc(k.n + ' ' + k.name) +
          '">' +
          k.n +
          '</span>';
      });
      html += '</div><div class="stu-gp-key" aria-hidden="true">';
      c.counts.forEach(function (k) {
        html += '<span data-lv="' + k.lv + '"><i class="stu-gp-lv-' + k.lv + '"></i>' + esc(k.name) + '</span>';
      });
      html += '</div>';
    }
    html += '<div class="stu-gp-folders">';
    c.groups.forEach(function (g) {
      html +=
        '<div class="stu-gp-folder">' +
        (g.name ? '<span class="stu-gp-folder-name">' + esc(g.name) + '</span>' : '') +
        '<span class="stu-gp-tiles">';
      g.items.forEach(function (it, i) {
        var on = m.compFilter === it.id;
        var tip = ['<strong>' + esc(it.name) + '</strong>'];
        tip.push(
          '<span class="stu-gp-tip-grade">' +
            esc(it.v > 0 ? it.text + (it.word ? ' ' + it.word : '') : 'Not assessed yet') +
            '</span>',
        );
        if (it.trend) tip.push('<span>' + esc(it.trend) + '</span>');
        if (it.n)
          tip.push(
            '<span class="stu-gp-tip-hint">' +
              (on ? 'Show all work' : 'Show its ' + it.n + (it.n === 1 ? ' piece' : ' pieces')) +
              '</span>',
          );
        html +=
          '<button type="button" class="stu-gp-tile stu-gp-lv-' +
          it.lv +
          (i > 2 ? ' tip-end' : '') +
          '" data-action="stuGpComp" data-sec="' +
          esc(it.id) +
          '" data-lv="' +
          it.lv +
          '" data-aids="' +
          esc(it.aids.join(' ')) +
          '" aria-pressed="' +
          on +
          '" aria-label="' +
          esc(
            it.name +
              ': ' +
              (it.v > 0 ? it.text + (it.word ? ' ' + it.word : '') : 'not assessed yet') +
              (it.trend ? ', ' + it.trend : ''),
          ) +
          '"' +
          (it.n ? '' : ' disabled') +
          '><span class="stu-gp-code">' +
          esc(it.tile) +
          '</span>' +
          (it.dir === 'up'
            ? '<span class="stu-gp-arr up">↑</span>'
            : it.dir === 'down'
              ? '<span class="stu-gp-arr down">↓</span>'
              : '') +
          _tipHtml(tip) +
          '</button>';
      });
      html += '</span></div>';
    });
    return html + '</div></section>';
  }

  /* On a screen with no pointer to rest (an iPad), the first tap on a day
     or a competency shows what is behind it; a second tap on the same one
     acts. True when this tap only showed it. */
  /** @type {Element | null} */
  var _armed = null;
  /** @param {Element} el */
  function armFirst(el) {
    var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
    if (!touch || _armed === el) return false;
    if (_armed) _armed.classList.remove('tip-on');
    _armed = el;
    el.classList.add('tip-on');
    _link(el.closest('.stu-gp'), el);
    return true;
  }

  // Light what the element points at, on the other card.
  function _link(root, el) {
    if (!root) return;
    var on = [];
    if (el && el.classList.contains('stu-gp-pt')) {
      var secs = (el.getAttribute('data-secs') || '').split(' ').filter(Boolean);
      root.querySelectorAll('.stu-gp-tile').forEach(function (t) {
        if (secs.indexOf(t.getAttribute('data-sec')) >= 0) on.push(t);
      });
      on.push(el);
    } else if (el && el.classList.contains('stu-gp-tile')) {
      var aids = (el.getAttribute('data-aids') || '').split(' ').filter(Boolean);
      root.querySelectorAll('.stu-gp-pt').forEach(function (p) {
        var mine = (p.getAttribute('data-aids') || '').split(' ');
        if (
          aids.some(function (a) {
            return mine.indexOf(a) >= 0;
          })
        )
          on.push(p);
      });
      on.push(el);
    } else if (el && el.hasAttribute('data-lv')) {
      var lv = el.getAttribute('data-lv');
      root.querySelectorAll('.stu-gp-tile[data-lv="' + lv + '"]').forEach(function (t) {
        on.push(t);
      });
      on.push(el);
    }
    // Nothing on the other side to light: nothing dims.
    if (on.length < 2) on = [];
    root.querySelectorAll('.hl').forEach(function (n) {
      if (on.indexOf(n) < 0) n.classList.remove('hl');
    });
    on.forEach(function (n) {
      n.classList.add('hl');
    });
    root.classList.toggle('linking', on.length > 0);
  }

  function _target(e) {
    return e.target && e.target.closest
      ? e.target.closest('.stu-gp-pt, .stu-gp-tile, .stu-gp-seg-part, .stu-gp-key span')
      : null;
  }

  // The picture is drawn again with the page, so its listeners go with it.
  function mount(root) {
    var gp = root && root.querySelector('.stu-gp');
    if (!gp) return;
    _armed = null;
    var over = function (e) {
      _link(gp, _target(e));
    };
    var out = function (e) {
      var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.stu-gp') : null;
      if (to !== gp || !_target({ target: e.relatedTarget })) _link(gp, _armed);
    };
    gp.addEventListener('pointerover', over);
    gp.addEventListener('focusin', over);
    gp.addEventListener('pointerout', out);
    gp.addEventListener('focusout', out);
  }

  return {
    lineHtml: lineHtml,
    compsHtml: compsHtml,
    feedbackHtml: feedbackHtml,
    armFirst: armFirst,
    mount: mount,
    _helpers: { scale: _scale },
  };
})();
