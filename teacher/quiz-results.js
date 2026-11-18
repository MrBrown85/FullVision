// @ts-check
/* A quiz's results and Confirm (docs/plans/quizzes-plan.md, slice Q4;
   board "Quizzes Artboard", Board 3).

   One screen over the Assignments page, opened from the line on a quiz
   piece's card ("12 Answered · Confirm Levels"). Three views:
   - By Competency: each student's suggested level on each competency,
     dashed until confirmed, with the points beside it. A click picks a
     level; Step Up and Step Down change it, and a changed one carries a dot
     (Changed). With two tries, "Best of 2 Tries", which try counts, and both.
   - By Question: each question, how many had it right, the wrong choice
     most picked, and every Text answer assessed down one column.
   - By Student: one student's quiz in their own order, as See Answers'
     By Student shows a reflection.
   Reopen for One Student, and Confirm with its question and Undo.

   Suggestions come from calc.js (quizSuggestions) and from nowhere else;
   this screen is the only reader of them. Nothing here writes a score:
   Confirm hands what the teacher confirms to Grader.confirmQuiz, which asks
   nothing of this file but the rows. Levels are named through calc.js's
   helpers (scoreLevelText). Text reaches the HTML only through esc. Dark
   until the quizzes build switch is on. */
var QuizResults = (function () {
  'use strict';

  var G = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);
  // Each level a click can step to, low to high: Emerging to Extending, with + and −.
  var STEPS = [
    [1, 0],
    [1, 1],
    [2, -1],
    [2, 0],
    [2, 1],
    [3, -1],
    [3, 0],
    [3, 1],
    [4, -1],
    [4, 0],
  ];
  var VIEWS = [
    { id: 'student', label: 'By Student' },
    { id: 'question', label: 'By Question' },
    { id: 'competency', label: 'By Competency' },
  ];

  /** @type {any} */
  var R = null; // the open screen: see open()
  /** @type {Record<string, boolean>} */
  var _asked = {}; // aid → this page has asked the server for the quiz and its tries

  function _on() {
    return typeof BuildFlags !== 'undefined' && BuildFlags.on('quizzes');
  }
  /** @param {number} n @param {string} one @param {string} many */
  function _n(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  /** @param {string} cid @param {string} aid */
  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (/** @type {any} */ a) {
        return a && a.id === aid;
      }) || null
    );
  }
  /** @param {any} st */
  function _name(st) {
    return typeof displayNameWithLast === 'function'
      ? displayNameWithLast(st)
      : ((st.preferred || st.firstName || '') + ' ' + (st.lastName || '')).trim();
  }
  /** @param {any} l */
  function _word(l) {
    return l && l.level ? scoreLevelText(l.level, l.mod || 0) : '';
  }
  /** @param {any} l */
  function _step(l) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i][0] === l.level && STEPS[i][1] === (l.mod || 0)) return i;
    return 0;
  }
  /* A number of points as the app prints points. */
  /** @param {number} v */
  function _pts(v) {
    return typeof formatPoints === 'function' ? String(formatPoints(v)) : String(v);
  }

  /* ── The model ─────────────────────────────────────────────── */

  /* The same marking two ways round: the stored one (jsonb, keys in its own
     order) and calc.js's. */
  /** @param {any} a @param {any} b */
  function _sameMarked(a, b) {
    if (!a || !b) return !a && !b;
    if (Number(a.earned) !== Number(b.earned) || Number(a.possible) !== Number(b.possible)) return false;
    var qa = a.questions || {};
    var qb = b.questions || {};
    var ids = Object.keys(Object.assign({}, qa, qb));
    return ids.every(function (id) {
      return !!qa[id] && !!qb[id] && Number(qa[id].earned) === Number(qb[id].earned) && qa[id].result === qb[id].result;
    });
  }

  /**
   * Everything the screen draws, from the data layer and calc.js: the quiz,
   * its questions and competencies, and each student with their tries,
   * suggestions and what the gradebook holds. null when the quiz or its
   * tries are not read yet.
   * @param {string} cid @param {string} aid @param {Record<string, any>} [changes]
   */
  function model(cid, aid, changes) {
    var a = _piece(cid, aid);
    var quiz = !!G.QuizData ? G.QuizData.get(cid, aid) : null;
    var tries = !!G.QuizTries ? G.QuizTries.get(cid, aid) : null;
    if (!a || !quiz || !quiz.quiz || !tries) return null;
    var points = isPointsScored(a);
    var questions = quiz.questions || [];
    var tagIds = (points ? a.tagIds || [] : scoreTagIds(a, cid)).filter(function (/** @type {string} */ id) {
      return !isUnlinkedTag(id);
    });
    var all = getAllTags(cid) || [];
    var tags = tagIds.map(function (/** @type {string} */ id) {
      var t =
        all.find(function (/** @type {any} */ x) {
          return x.id === id;
        }) || {};
      return { id: id, code: t.code || '', name: t.label || t.name || t.text || 'Competency' };
    });
    var settings = {
      tries: quiz.quiz.tries,
      counts: quiz.quiz.counts,
      scoring: points ? 'points' : 'competencies',
      tagIds: tagIds,
      maxPoints: a.maxPoints,
    };
    var scale = typeof getGradingScale === 'function' ? getGradingScale(cid) : undefined;
    var rows = {};
    (tries.students || []).forEach(function (/** @type {any} */ s) {
      rows[s.enrollment_id] = s;
    });
    var scores = getScores(cid);
    var ch = changes || {};
    var students = sortStudents((getStudents(cid) || []).slice(), 'lastName', cid).map(
      function (/** @type {any} */ st) {
        var row = rows[st.id] || { sent: 0, tries: [], in_progress: false, reopened: false };
        var sug = quizSuggestions(questions, null, row.tries || [], settings, scale);
        var confirmed =
          (row.tries || []).find(function (/** @type {any} */ t) {
            return !!t.marked;
          }) || null;
        var entries = (scores[st.id] || []).filter(function (/** @type {any} */ e) {
          return e && e.assessmentId === aid;
        });
        /** @type {Record<string, any>} */
        var held = {};
        entries.forEach(function (/** @type {any} */ e) {
          if (Number(e.score) > 0) held[e.tagId] = { level: Number(e.score), mod: e.mod || 0 };
        });
        var cells = sug.competencies.map(function (/** @type {any} */ c) {
          var mine = ch[st.id + '|' + c.tagId];
          var sugg = c.state === 'level' || c.state === 'total' ? { level: c.level, mod: 0 } : null;
          return Object.assign({}, c, {
            held: points ? null : held[c.tagId] || null,
            suggested: sugg,
            shown: mine && !points ? mine : sugg,
            changed: !!mine && !points,
          });
        });
        return {
          sid: st.id,
          name: _name(st),
          first: typeof displayNameFirst === 'function' ? displayNameFirst(st) : st.firstName || _name(st),
          status: getAssignmentStatus(cid, st.id, aid) || null,
          locked: isScoreLocked(cid, st.id, aid),
          row: row,
          sug: sug,
          cells: cells,
          heldPoints: points ? getPointsScore(cid, st.id, aid) : null,
          confirmed: confirmed,
          changedSince: !!confirmed && (!sug.counted || !_sameMarked(confirmed.marked, sug.marked)),
        };
      },
    );
    var toAssess = 0;
    students.forEach(function (/** @type {any} */ s) {
      s.sug.tries.forEach(function (/** @type {any} */ t) {
        toAssess += t.waiting;
      });
    });
    return {
      cid: cid,
      aid: aid,
      a: a,
      points: points,
      quiz: quiz.quiz,
      questions: questions,
      tags: tags,
      students: students,
      sent: students.filter(function (/** @type {any} */ s) {
        return s.sug.tries.length > 0;
      }).length,
      toAssess: toAssess,
    };
  }

  /* What Confirm would confirm: one row a student who sent it, for
     GraderWork.quizConfirmPlan. A changed level goes in its place. */
  /** @param {any} m */
  function confirmRows(m) {
    return m.students
      .filter(function (/** @type {any} */ s) {
        return s.sug.tries.length > 0;
      })
      .map(function (/** @type {any} */ s) {
        var levels = s.cells
          .filter(function (/** @type {any} */ c) {
            return c.state === 'level';
          })
          .map(function (/** @type {any} */ c) {
            return { tagId: c.tagId, level: c.shown.level, mod: c.shown.mod || 0 };
          });
        var waiting = m.points
          ? s.sug.total.state === 'waiting'
            ? 1
            : 0
          : s.cells.filter(function (/** @type {any} */ c) {
              return c.state === 'waiting';
            }).length;
        return {
          sid: s.sid,
          attemptId: s.sug.counted ? s.sug.counted.attempt_id : null,
          marked: s.sug.marked,
          prior: s.confirmed ? { attempt_id: s.confirmed.attempt_id, marked: s.confirmed.marked } : null,
          levels: levels,
          points: m.points && s.sug.total.state === 'level' ? s.sug.total.earned : null,
          waiting: waiting,
        };
      });
  }

  /* ── Drawing ───────────────────────────────────────────────── */

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} l @param {{ sugg?: boolean, changed?: boolean }} [o] */
  function _chip(l, o) {
    if (!l || !l.level) return '';
    var opts = o || {};
    return (
      '<span class="quiz-lv quiz-lv' +
      l.level +
      (opts.sugg ? ' is-suggested' : '') +
      '">' +
      (opts.changed ? '<span class="quiz-lv-dot" aria-hidden="true"></span>' : '') +
      esc(_word(l)) +
      '</span>'
    );
  }

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m @param {any} s @param {any} c */
  function _cellHtml(m, s, c) {
    var figure = '<span class="quiz-of">' + esc(_pts(c.earned) + ' / ' + _pts(c.possible)) + '</span>';
    if (s.locked) return '<span class="quiz-none">' + (s.status === 'EXC' ? 'Excused' : 'Missing') + '</span>';
    if (c.held) return '<span class="quiz-cell">' + _chip(c.held) + (s.sug.tries.length ? figure : '') + '</span>';
    if (c.state === 'not_sent') return '';
    if (c.state === 'too_few')
      return '<span class="quiz-cell"><span class="quiz-none">Too Few Questions</span>' + figure + '</span>';
    if (c.state === 'waiting')
      return (
        '<button type="button" class="quiz-rowbtn quiz-wait" data-quiz-act="student" data-sid="' +
        esc(s.sid) +
        '">' +
        (s.sug.counted ? 'Short Answer to Assess' : 'Waiting for a Short Answer') +
        '</button>'
      );
    var on = R && R.sel && R.sel.sid === s.sid && R.sel.tagId === c.tagId;
    var label =
      c.tagId +
      ' for ' +
      s.name +
      ': suggested ' +
      _word(c.shown) +
      (c.changed ? ', changed by you' : '') +
      (m.points ? '' : '. Pick to step it');
    if (m.points) return '<span class="quiz-cell">' + _chip(c.shown, { sugg: true }) + figure + '</span>';
    return (
      '<span class="quiz-cell"><button type="button" class="quiz-lvb" data-quiz-act="cell" data-sid="' +
      esc(s.sid) +
      '" data-tag="' +
      esc(c.tagId) +
      '" aria-pressed="' +
      !!on +
      '" aria-label="' +
      esc(label) +
      '">' +
      _chip(c.shown, { sugg: true, changed: c.changed }) +
      '</button>' +
      figure +
      '</span>'
    );
  }

  /** @param {any} s */
  function _sentText(s) {
    var t = s.sug.tries;
    if (!t.length) return s.row.reopened ? 'Reopened' : s.row.in_progress ? 'Answering Now' : 'Not Sent';
    var last = t[t.length - 1];
    return typeof formatDate === 'function'
      ? formatDate(String(last.sent_at).slice(0, 10))
      : String(last.sent_at).slice(0, 10);
  }

  /* One try's own figures, for the rows under a student with two or more. */
  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m @param {any} s @param {any} t */
  function _tryRow(m, s, t) {
    var one = quizSuggestions(
      m.questions,
      null,
      s.row.tries.filter(function (/** @type {any} */ x) {
        return x.attempt_id === t.attempt_id;
      }),
      {
        tries: 1,
        scoring: m.points ? 'points' : 'competencies',
        tagIds: m.tags.map((/** @type {any} */ x) => x.id),
        maxPoints: m.a.maxPoints,
      },
      typeof getGradingScale === 'function' ? getGradingScale(m.cid) : undefined,
    );
    var counts = s.sug.counted && s.sug.counted.attempt_id === t.attempt_id;
    return (
      '<tr class="quiz-try-row' +
      (counts ? ' is-counted' : '') +
      '"><td class="quiz-try-name">Try ' +
      t.try +
      (counts ? ' <span class="quiz-tag">Counts</span>' : '') +
      '</td>' +
      one.competencies
        .map(function (/** @type {any} */ c) {
          var l = c.state === 'level' || c.state === 'total' ? { level: c.level, mod: 0 } : null;
          return (
            '<td><span class="quiz-cell">' +
            (l
              ? _chip(l, { sugg: true })
              : '<span class="quiz-none">' + (c.state === 'waiting' ? 'Waiting' : 'Too Few Questions') + '</span>') +
            '<span class="quiz-of">' +
            esc(_pts(c.earned) + ' / ' + _pts(c.possible)) +
            '</span></span></td>'
          );
        })
        .join('') +
      (m.points ? '<td class="quiz-fig">' + esc(_pts(t.earned) + ' / ' + _pts(t.possible)) + '</td>' : '') +
      '<td class="quiz-fig">' +
      esc(typeof formatDate === 'function' ? formatDate(String(t.sent_at).slice(0, 10)) : String(t.sent_at)) +
      '</td></tr>'
    );
  }

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m */
  function _byCompetency(m) {
    var head =
      '<tr><th scope="col">Student</th>' +
      m.tags
        .map(function (/** @type {any} */ t) {
          return '<th scope="col">' + esc((t.code ? t.code + ' ' : '') + t.name) + '</th>';
        })
        .join('') +
      (m.points ? '<th scope="col">Total</th>' : '') +
      '<th scope="col">Sent</th></tr>';
    var rows = m.students
      .map(function (/** @type {any} */ s) {
        var many = s.sug.tries.length > 1;
        var sel = R && R.sel && R.sel.sid === s.sid;
        var name =
          '<button type="button" class="quiz-rowbtn" data-quiz-act="student" data-sid="' +
          esc(s.sid) +
          '">' +
          esc(s.name) +
          '</button>' +
          (many
            ? '<span class="quiz-sub">' +
              (s.sug.mode === 'best' ? 'Best' : 'Latest') +
              ' of ' +
              s.sug.tries.length +
              ' Tries</span>'
            : '') +
          (s.changedSince ? '<span class="quiz-tag is-changed">Changed Since Confirmed</span>' : '');
        var cells;
        if (!s.sug.tries.length && !s.locked) {
          cells =
            '<td colspan="' +
            (m.tags.length + (m.points ? 1 : 0)) +
            '"><span class="quiz-none">Not sent.</span>' +
            (m.a.isDraft || s.row.reopened
              ? ''
              : ' <button type="button" class="quiz-link" data-quiz-act="reopen" data-sid="' +
                esc(s.sid) +
                '">Reopen</button>') +
            '</td>';
        } else {
          cells = s.cells
            .map(function (/** @type {any} */ c) {
              return '<td>' + _cellHtml(m, s, c) + '</td>';
            })
            .join('');
          if (m.points) {
            var tot = s.sug.total;
            cells +=
              '<td class="quiz-fig">' +
              (s.locked
                ? ''
                : s.heldPoints != null
                  ? '<b>' + esc(_pts(s.heldPoints)) + '</b> / ' + esc(_pts(tot.possible))
                  : tot.state === 'level'
                    ? '<span class="quiz-total is-suggested">' +
                      esc(_pts(tot.earned)) +
                      '</span> / ' +
                      esc(_pts(tot.possible))
                    : 'Waiting') +
              '</td>';
          }
        }
        var counted = s.sug.counted;
        var sentCell = many && counted ? 'Try ' + counted.try + ' Counts' : _sentText(s);
        var out =
          '<tr' +
          (sel ? ' class="is-selected"' : '') +
          '><th scope="row" class="quiz-name">' +
          name +
          '</th>' +
          cells +
          '<td class="quiz-fig">' +
          esc(sentCell) +
          '</td></tr>';
        if (many)
          out += s.sug.tries
            .map(function (/** @type {any} */ t) {
              return _tryRow(m, s, t);
            })
            .join('');
        return out;
      })
      .join('');
    return (
      '<div class="quiz-table-wrap"><table class="quiz-rt"><thead>' +
      head +
      '</thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  /* How a student answered one question, as words. */
  /** @param {any} q @param {any} a */
  function _answerText(q, a) {
    if (!a) return 'No answer';
    if (q.kind === 'choice') {
      var picked = (q.choices || []).filter(function (/** @type {any} */ c) {
        return (a.answer || []).indexOf(c.id) >= 0;
      });
      return picked.length
        ? picked
            .map(function (/** @type {any} */ c) {
              return c.text;
            })
            .join('; ')
        : 'No answer';
    }
    if (q.kind === 'true_false') return a.answer === true ? 'True' : a.answer === false ? 'False' : 'No answer';
    return String(a.answer);
  }
  /** @param {any} q */
  function _rightText(q) {
    var k = q.key || {};
    if (q.kind === 'choice')
      return (q.choices || [])
        .filter(function (/** @type {any} */ c) {
          return (k.answer || []).indexOf(c.id) >= 0;
        })
        .map(function (/** @type {any} */ c) {
          return c.text;
        })
        .join('; ');
    if (q.kind === 'true_false') return k.answer ? 'True' : 'False';
    if (q.kind === 'number') return String(k.answer) + (k.tolerance ? ', give or take ' + k.tolerance : '');
    return '';
  }
  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {string} result */
  function _mark(result) {
    var M = {
      right: ['is-right', '✓', 'Right'],
      wrong: ['is-wrong', '✗', 'Not right'],
      partly: ['is-partly', '½', 'Partly right'],
      waiting: ['is-waiting', '?', 'Not assessed yet'],
    };
    var x = M[/** @type {'right'} */ (result)] || M.wrong;
    return '<span class="quiz-mk ' + x[0] + '" role="img" aria-label="' + x[2] + '">' + x[1] + '</span>';
  }

  /* The points buttons for one Text answer, assessed by hand. A mark above
     what the question is worth now is not shown as pressed: it is asked for
     again, and counts only what the question is worth meanwhile. */
  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} q @param {any} t @param {any} a @param {string} label */
  function _assessHtml(q, t, a, label) {
    var worth = Number(q.points) || 0;
    var given = a && a.given_points != null ? Number(a.given_points) : null;
    var over = given != null && given > worth;
    var steps = [];
    for (var p = 0; p <= worth && steps.length < 21; p += worth > 10 ? Math.ceil(worth / 10) : 1) steps.push(p);
    if (steps[steps.length - 1] !== worth) steps.push(worth);
    return (
      '<div class="quiz-assess"><span class="quiz-assess-label">Points</span><span class="seg seg-sm" role="group" aria-label="' +
      esc(label) +
      '">' +
      steps
        .map(function (n) {
          return (
            '<button type="button" class="seg-btn" data-quiz-act="assess" data-attempt="' +
            esc(t.attempt_id) +
            '" data-q="' +
            esc(q.id) +
            '" data-points="' +
            n +
            '" aria-pressed="' +
            (!over && given === n) +
            '">' +
            esc(_pts(n)) +
            '</button>'
          );
        })
        .join('') +
      '</span>' +
      (over
        ? '<span class="quiz-hint">Assessed ' +
          esc(_pts(given || 0)) +
          ' when this question was worth more. It counts ' +
          esc(_pts(worth)) +
          ' until you assess it again.</span>'
        : '') +
      '</div>'
    );
  }

  /* The questions in this student's own order for one try (the contract's
     "Reading an order"): the stored order's active questions, then any
     added since, in the teacher's order. */
  /** @param {any[]} questions @param {any} t */
  function _ordered(questions, t) {
    var order = (t && t.question_order && t.question_order.questions) || [];
    var byId = {};
    questions.forEach(function (q) {
      byId[q.id] = q;
    });
    var out = order
      .map(function (/** @type {string} */ id) {
        return byId[id];
      })
      .filter(Boolean);
    return out.concat(
      questions.filter(function (q) {
        return out.indexOf(q) < 0;
      }),
    );
  }

  /* One student's answers, for By Student and the side panel. */
  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m @param {any} s @param {boolean} wide */
  function _studentHtml(m, s, wide) {
    var t = s.sug.tries;
    var head =
      '<div class="quiz-who-head"><h3 class="quiz-h3" id="quiz-who-title">' +
      esc(s.name) +
      (wide ? '' : ' · Answers') +
      '</h3>' +
      (!m.a.isDraft && !s.row.reopened && !s.locked
        ? '<button type="button" class="btn btn-ghost quiz-btn-sm" data-quiz-act="reopen" data-sid="' +
          esc(s.sid) +
          '">Reopen for ' +
          esc(s.first) +
          '</button>'
        : '') +
      '</div>';
    if (!t.length)
      return (
        head +
        '<p class="quiz-hint">' +
        (s.row.reopened
          ? 'Reopened: one more try is waiting for them.'
          : s.row.in_progress
            ? 'Answering now. You see the answers once they are sent.'
            : 'Not sent yet.') +
        '</p>'
      );
    var shownTry = (R && R.tryOf && R.tryOf[s.sid]) || (s.sug.counted ? s.sug.counted.try : t[t.length - 1].try);
    var tm =
      t.find(function (/** @type {any} */ x) {
        return x.try === shownTry;
      }) || t[t.length - 1];
    var raw = s.row.tries.find(function (/** @type {any} */ x) {
      return x.attempt_id === tm.attempt_id;
    });
    var tabs = '';
    if (t.length > 1)
      tabs =
        '<div class="quiz-tries"><span class="quiz-sub">' +
        (s.sug.mode === 'best' ? 'Best' : 'Latest') +
        ' of ' +
        t.length +
        ' Tries' +
        (s.sug.counted
          ? ': Try ' + s.sug.counted.try + ' counts.'
          : ': waiting for a short answer before the best can be told.') +
        '</span><span class="seg seg-sm" role="group" aria-label="Try shown">' +
        t
          .map(function (/** @type {any} */ x) {
            return (
              '<button type="button" class="seg-btn" data-quiz-act="try" data-sid="' +
              esc(s.sid) +
              '" data-try="' +
              x.try +
              '" aria-pressed="' +
              (x.try === tm.try) +
              '">Try ' +
              x.try +
              ' · ' +
              esc(_pts(x.earned) + ' / ' + _pts(x.possible)) +
              '</button>'
            );
          })
          .join('') +
        '</span></div>';
    var answers = {};
    ((raw && raw.answers) || []).forEach(function (/** @type {any} */ a) {
      answers[a.question_id] = a;
    });
    var codes = {};
    m.tags.forEach(function (/** @type {any} */ x) {
      codes[x.id] = x.code || x.name;
    });
    var list = _ordered(m.questions, raw)
      .map(function (q, i) {
        var r = tm.questions[q.id] || { earned: 0, result: 'wrong' };
        var a = answers[q.id];
        var extra = '';
        if (q.kind === 'text')
          extra =
            '<div class="quiz-yours">' +
            esc(a ? String(a.answer) : 'No answer') +
            '</div>' +
            (a ? _assessHtml(q, tm, a, 'Points for Question ' + (i + 1) + ', ' + s.name) : '');
        else
          extra =
            '<div class="quiz-yours">' +
            esc(_answerText(q, a)) +
            (r.result === 'right' ? '' : '<span class="quiz-right"> Right answer: ' + esc(_rightText(q)) + '</span>') +
            '</div>';
        return (
          '<li class="quiz-ans">' +
          _mark(r.result) +
          '<div class="quiz-ans-body"><div><b>Question ' +
          (i + 1) +
          '</b> ' +
          esc(q.prompt) +
          ' <span class="quiz-hint">' +
          esc((q.tag_id ? codes[q.tag_id] || '' : 'No Competency') + ' · ') +
          esc(
            r.result === 'waiting'
              ? 'To assess'
              : _pts(r.earned) + ' of ' + _n(Number(q.points) || 0, 'point', 'points'),
          ) +
          '</span></div>' +
          extra +
          '</div></li>'
        );
      })
      .join('');
    return head + tabs + '<ol class="quiz-ans-list">' + list + '</ol>';
  }

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m */
  function _byQuestion(m) {
    return (
      '<ol class="quiz-q-list">' +
      m.questions
        .map(function (/** @type {any} */ q, /** @type {number} */ i) {
          var right = 0;
          var of = 0;
          /** @type {Record<string, number>} */
          var picks = {};
          var texts = [];
          m.students.forEach(function (/** @type {any} */ s) {
            var t = s.sug.counted || s.sug.tries[s.sug.tries.length - 1];
            if (!t) return;
            var r = t.questions[q.id];
            if (r.result !== 'waiting') {
              of++;
              if (r.result === 'right') right++;
            }
            s.row.tries.forEach(function (/** @type {any} */ raw) {
              var a = (raw.answers || []).find(function (/** @type {any} */ x) {
                return x.question_id === q.id;
              });
              if (q.kind === 'text' && a) texts.push({ s: s, raw: raw, a: a, many: s.row.tries.length > 1 });
              if (raw.attempt_id === t.attempt_id && a && q.kind === 'choice' && r.result !== 'right')
                (a.answer || []).forEach(function (/** @type {string} */ id) {
                  if (((q.key || {}).answer || []).indexOf(id) < 0) picks[id] = (picks[id] || 0) + 1;
                });
            });
          });
          var top = Object.keys(picks).sort(function (x, y) {
            return picks[y] - picks[x];
          })[0];
          var topChoice = top
            ? (q.choices || []).find(function (/** @type {any} */ c) {
                return c.id === top;
              })
            : null;
          var tag = m.tags.find(function (/** @type {any} */ x) {
            return x.id === q.tag_id;
          });
          var pct = of ? Math.round((100 * right) / of) : 0;
          var body =
            '<div class="quiz-q-head"><b>Question ' +
            (i + 1) +
            '</b> <span class="quiz-q-prompt">' +
            esc(q.prompt) +
            '</span> <span class="quiz-hint">' +
            esc((tag ? tag.code || tag.name : 'No Competency') + ' · ' + _n(Number(q.points) || 0, 'point', 'points')) +
            '</span></div>' +
            '<div class="quiz-q-bar"><span class="quiz-track" role="img" aria-label="' +
            esc(right + ' of ' + of + ' right') +
            '"><span class="quiz-fill" style="width:' +
            pct +
            '%"></span></span><span class="quiz-fig">' +
            esc(right + ' of ' + of + ' right') +
            '</span></div>' +
            (topChoice && of - right
              ? '<p class="quiz-hint">' +
                esc(
                  _n(of - right, 'student', 'students') +
                    ' missed it. ' +
                    picks[top] +
                    ' of them picked “' +
                    topChoice.text +
                    '”.',
                ) +
                '</p>'
              : '');
          if (q.kind === 'text')
            body +=
              '<ul class="quiz-col">' +
              texts
                .map(function (x) {
                  return (
                    '<li class="quiz-col-row"><div class="quiz-col-who">' +
                    esc(x.s.name + (x.many ? ', Try ' + x.raw.try : '')) +
                    '</div><div class="quiz-yours">' +
                    esc(String(x.a.answer)) +
                    '</div>' +
                    _assessHtml(q, x.raw, x.a, 'Points for ' + x.s.name + (x.many ? ', Try ' + x.raw.try : '')) +
                    '</li>'
                  );
                })
                .join('') +
              '</ul>';
          return '<li class="quiz-q">' + body + '</li>';
        })
        .join('') +
      '</ol>'
    );
  }

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m */
  function _confirmHtml(m) {
    var plan = G.GraderWork.quizConfirmPlan(m.cid, m.aid, confirmRows(m));
    var n = plan.cells.length;
    var unit = m.points ? ['Score', 'Scores'] : ['Suggested Level', 'Suggested Levels'];
    var undo = R && R.done;
    var held = typeof GradeState !== 'undefined' && GradeState.holds(getReturnSettings(m.cid));
    return (
      '<div class="quiz-panel quiz-confirm">' +
      (undo
        ? '<div class="quiz-undo" role="status"><span>' +
          esc(
            _n(undo.set, m.points ? 'score' : 'level', m.points ? 'scores' : 'levels') +
              ' confirmed' +
              (held ? ' as drafts.' : '.'),
          ) +
          '</span><button type="button" data-quiz-act="undo">Undo</button></div>'
        : '') +
      '<button type="button" class="btn btn-primary" data-quiz-act="confirm"' +
      (m.a.isDraft || !n ? ' disabled' : '') +
      '>' +
      esc(n ? 'Confirm ' + _n(n, unit[0], unit[1]) : 'Nothing to Confirm Yet') +
      '</button><span class="quiz-hint">' +
      esc(
        (plan.waiting
          ? _n(plan.waiting, m.points ? 'score waits' : 'level waits', m.points ? 'scores wait' : 'levels wait') +
            ' for a short answer to be assessed. '
          : '') +
          (m.points
            ? 'Each total becomes the student’s points on this piece.'
            : 'Pick any level first to step it up or down.'),
      ) +
      '</span></div>'
    );
  }

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m */
  function _stepperHtml(m) {
    if (!R || !R.sel || !R.sel.tagId || m.points) return '';
    var s = m.students.find(function (/** @type {any} */ x) {
      return x.sid === R.sel.sid;
    });
    var c =
      s &&
      s.cells.find(function (/** @type {any} */ x) {
        return x.tagId === R.sel.tagId;
      });
    if (!c || c.state !== 'level' || c.held) return '';
    var tag = m.tags.find(function (/** @type {any} */ x) {
      return x.id === c.tagId;
    });
    var i = _step(c.shown);
    return (
      '<div class="quiz-panel"><h3 class="quiz-h3">' +
      esc((tag.code ? tag.code + ' ' : '') + tag.name + ' · ' + s.name) +
      '</h3><div class="quiz-stepper"><button type="button" class="btn btn-ghost" data-quiz-act="step" data-by="-1"' +
      (i === 0 ? ' disabled' : '') +
      '>Step Down</button>' +
      _chip(c.shown, { sugg: true, changed: c.changed }) +
      '<button type="button" class="btn btn-ghost" data-quiz-act="step" data-by="1"' +
      (i === STEPS.length - 1 ? ' disabled' : '') +
      '>Step Up</button></div><span class="quiz-hint">' +
      esc(
        'Suggested: ' +
          _word(c.suggested) +
          ' from ' +
          _pts(c.earned) +
          ' of ' +
          _n(c.possible, 'point', 'points') +
          '.',
      ) +
      (c.changed ? ' <button type="button" class="quiz-link" data-quiz-act="reset">Use the Suggestion</button>' : '') +
      '</span></div>'
    );
  }

  function _draw() {
    if (!R) return;
    var m = model(R.cid, R.aid, R.changes);
    var body = R.overlay.querySelector('.quiz-results-body');
    if (!m) {
      body.innerHTML =
        '<p class="quiz-hint">' +
        esc(
          R.loading
            ? 'Reading the answers…'
            : 'The answers could not be read. Check the connection, then open this again.',
        ) +
        '</p>';
      return;
    }
    if (!R.sel || !R.sel.sid) {
      var first = m.students.find(function (/** @type {any} */ s) {
        return s.sug.tries.length;
      });
      R.sel = { sid: first ? first.sid : m.students[0] ? m.students[0].sid : '', tagId: '' };
    }
    var who = m.students.find(function (/** @type {any} */ s) {
      return s.sid === R.sel.sid;
    });
    var cls = (typeof COURSES !== 'undefined' && COURSES[R.cid] && COURSES[R.cid].name) || '';
    R.overlay.querySelector('.quiz-results-sub').textContent =
      m.sent +
      ' of ' +
      m.students.length +
      ' sent · ' +
      _n(m.toAssess, 'short answer', 'short answers') +
      ' to assess' +
      (cls ? ' · ' + cls : '');
    R.overlay.querySelectorAll('[data-quiz-view]').forEach(function (/** @type {HTMLElement} */ b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-quiz-view') === R.view));
    });
    var notice = m.a.isDraft
      ? 'This piece is a Draft: students cannot answer it until you assign it.'
      : m.points
        ? 'Suggested totals from the answers. Nothing counts until you confirm. Each competency on this piece reads the level the total reaches.'
        : 'Suggested levels from the answers, using this class’s Points to Proficiency table. Nothing counts until you confirm. A dot marks a level you changed. A competency needs 3 questions for a suggestion.';
    // The frame first, then each part in its own place.
    var frame = {
      question: '<div class="quiz-top"></div><div class="quiz-panel" data-quiz-part="main"></div>',
      student:
        '<div class="quiz-top"></div><div class="quiz-who-grid"><ul class="quiz-who-list" aria-label="Students"></ul><div class="quiz-panel" data-quiz-part="who"></div></div>',
      competency:
        '<div class="quiz-grid"><div class="quiz-panel quiz-panel-flush" data-quiz-part="main"></div><div class="quiz-aside"><div class="quiz-top"></div><div data-quiz-part="step"></div><div class="quiz-panel" data-quiz-part="who"></div></div></div>',
    };
    // html-safe: the frame is fixed markup from this function.
    body.innerHTML = '<p class="quiz-notice"></p>' + (frame[R.view] || frame.competency);
    /** @param {string} sel @returns {HTMLElement} */
    var part = sel => body.querySelector(sel);
    part('.quiz-notice').textContent = notice;
    part('.quiz-top').innerHTML = _confirmHtml(m);
    if (R.view === 'question') part('[data-quiz-part="main"]').innerHTML = _byQuestion(m);
    else if (R.view === 'competency') part('[data-quiz-part="main"]').innerHTML = _byCompetency(m);
    if (R.view === 'competency') part('[data-quiz-part="step"]').innerHTML = _stepperHtml(m);
    if (R.view === 'student') part('.quiz-who-list').innerHTML = _whoListHtml(m);
    if (R.view !== 'question')
      part('[data-quiz-part="who"]').innerHTML = who ? _studentHtml(m, who, R.view === 'student') : '';
  }

  // html-safe: every name, prompt, answer, id and word through esc(); otherwise numbers, true/false and this file's fixed markup
  /** @param {any} m */
  function _whoListHtml(m) {
    return m.students
      .map(function (/** @type {any} */ s) {
        var t = s.sug.tries;
        var fig = t.length ? _pts(t[t.length - 1].earned) + ' / ' + _pts(s.sug.total.possible) : _sentText(s);
        return [
          '<li><button type="button" class="quiz-rowbtn" data-quiz-act="student" data-sid="',
          esc(s.sid),
          '" aria-current="',
          esc(String(s.sid === R.sel.sid)),
          '">',
          esc(s.name),
          '</button><span class="quiz-sub">',
          esc(fig),
          '</span></li>',
        ].join('');
      })
      .join('');
  }

  /* ── Acting ────────────────────────────────────────────────── */

  /** @param {string} sel */
  function _focus(sel) {
    var el = R && /** @type {HTMLElement | null} */ (R.overlay.querySelector(sel));
    if (el && el.focus) el.focus();
  }

  function _confirm() {
    var m = model(R.cid, R.aid, R.changes);
    if (!m || m.a.isDraft) return;
    var plan = G.GraderWork.quizConfirmPlan(R.cid, R.aid, confirmRows(m));
    var mine = R;
    showConfirm(plan.ask.title, plan.ask.message, plan.ask.button, 'primary', function () {
      if (R !== mine || plan.ask.none) return;
      var done = G.Grader.confirmQuiz(R.cid, R.aid, plan);
      R.done = done;
      // What was confirmed is a score now: the teacher's changes go with it.
      plan.cells.forEach(function (/** @type {any} */ c) {
        delete R.changes[c.sid + '|' + c.key];
      });
      _draw();
      _focus('[data-quiz-act="undo"]');
    });
  }

  function _undo() {
    if (!R || !R.done) return;
    G.Grader.undoConfirmQuiz(R.cid, R.aid, R.done);
    R.done = null;
    _draw();
    _focus('[data-quiz-act="confirm"]');
  }

  /** @param {string} sid */
  function _reopen(sid) {
    var m = model(R.cid, R.aid, R.changes);
    if (!m || m.a.isDraft) return;
    var s = m.students.find(function (/** @type {any} */ x) {
      return x.sid === sid;
    });
    if (!s) return;
    var seen =
      typeof GradeState !== 'undefined' &&
      GradeState.stateOf(R.cid, sid, R.aid) === GradeState.RETURNED &&
      m.quiz.shows !== 'grade' &&
      s.sug.tries.length > 0;
    var mine = R;
    showConfirm(
      'Reopen for ' + s.name + '?',
      s.name +
        ' gets one more try, even after the quiz closes. It stays open until they send it.' +
        (seen ? ' Their work was returned showing which were right, so they have seen that.' : ''),
      'Reopen',
      'primary',
      function () {
        if (R !== mine) return;
        G.QuizTries.reopen(R.cid, R.aid, sid).then(function () {
          if (R === mine) _draw();
        });
        _draw();
      },
    );
  }

  /** @param {MouseEvent} e */
  function _click(e) {
    var t = /** @type {HTMLElement} */ (e.target);
    var close = t.closest('[data-quiz-close]');
    if (close) return void QuizResults.close();
    var view = t.closest('[data-quiz-view]');
    if (view) {
      R.view = view.getAttribute('data-quiz-view');
      _draw();
      return void _focus('[data-quiz-view="' + R.view + '"]');
    }
    var el = /** @type {HTMLElement | null} */ (t.closest('[data-quiz-act]'));
    if (!el) return;
    var act = el.getAttribute('data-quiz-act');
    var sid = el.getAttribute('data-sid') || '';
    if (act === 'cell') {
      R.sel = { sid: sid, tagId: el.getAttribute('data-tag') };
      _draw();
      return void _focus(
        '[data-quiz-act="cell"][data-sid="' + CSS.escape(sid) + '"][data-tag="' + CSS.escape(R.sel.tagId) + '"]',
      );
    }
    if (act === 'student') {
      R.sel = { sid: sid, tagId: '' };
      _draw();
      return void _focus(
        R.view === 'student' ? '[data-quiz-act="student"][data-sid="' + CSS.escape(sid) + '"]' : '#quiz-who-title',
      );
    }
    if (act === 'step' || act === 'reset') {
      var m = model(R.cid, R.aid, R.changes);
      if (!m) return;
      var s = m.students.find(function (/** @type {any} */ x) {
        return x.sid === R.sel.sid;
      });
      var c =
        s &&
        s.cells.find(function (/** @type {any} */ x) {
          return x.tagId === R.sel.tagId;
        });
      if (!c || !c.suggested) return;
      var key = s.sid + '|' + c.tagId;
      var i =
        act === 'reset'
          ? -1
          : Math.max(0, Math.min(STEPS.length - 1, _step(c.shown) + Number(el.getAttribute('data-by'))));
      var next = i < 0 ? c.suggested : { level: STEPS[i][0], mod: STEPS[i][1] };
      if (next.level === c.suggested.level && (next.mod || 0) === 0) delete R.changes[key];
      else R.changes[key] = next;
      _draw();
      return void _focus(
        act === 'reset'
          ? '[data-quiz-act="step"][data-by="1"]'
          : '[data-quiz-act="step"][data-by="' + el.getAttribute('data-by') + '"]:not([disabled])',
      );
    }
    if (act === 'try') {
      R.tryOf[sid] = Number(el.getAttribute('data-try'));
      _draw();
      return void _focus('[data-quiz-act="try"][data-try="' + R.tryOf[sid] + '"]');
    }
    if (act === 'assess') {
      var pressed = el.getAttribute('aria-pressed') === 'true';
      var points = pressed ? null : Number(el.getAttribute('data-points'));
      var at = {
        attempt: el.getAttribute('data-attempt'),
        q: el.getAttribute('data-q'),
        p: el.getAttribute('data-points'),
      };
      var mine = R;
      G.QuizTries.mark(R.cid, R.aid, at.attempt, at.q, points, null).then(function () {
        if (R !== mine) return;
        _draw();
        _focus(
          '[data-quiz-act="assess"][data-attempt="' +
            at.attempt +
            '"][data-q="' +
            at.q +
            '"][data-points="' +
            at.p +
            '"]',
        );
      });
      return;
    }
    if (act === 'confirm') return _confirm();
    if (act === 'undo') return _undo();
    if (act === 'reopen') return _reopen(sid);
  }

  /** @param {KeyboardEvent} e */
  function _keydown(e) {
    if (!R || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('.confirm-overlay')) return;
    e.preventDefault();
    close();
  }

  /**
   * Whether a piece's results can be opened: the switch on, the quizzes
   * offered in the class, and the piece a quiz (as read on this page).
   * @param {string} cid @param {any} a
   */
  function offered(cid, a) {
    if (!_on() || !a || !G.QuizData || !G.QuizData.offered(cid)) return false;
    var q = G.QuizData.get(cid, a.id);
    return !!(q && q.quiz);
  }

  /**
   * Open the results of one quiz. opts.onClose runs when it closes.
   * @param {string} cid @param {string} aid @param {{ onClose?: () => void }} [opts]
   */
  function open(cid, aid, opts) {
    if (!_on() || !_piece(cid, aid)) return false;
    close(true);
    var a = _piece(cid, aid);
    var overlay = document.createElement('div');
    overlay.className = 'quiz-results-overlay';
    overlay.innerHTML =
      '<div class="quiz-results" role="dialog" aria-modal="true" aria-labelledby="quiz-results-title">' +
      '<div class="quiz-results-head"><div><h2 class="quiz-results-title" id="quiz-results-title">' +
      esc(a.title || 'Quiz') +
      '</h2><div class="quiz-results-sub quiz-hint"></div></div>' +
      '<div class="quiz-results-tools"><div class="seg" role="group" aria-label="Results view">' +
      VIEWS.map(function (v) {
        return (
          '<button type="button" class="seg-btn" data-quiz-view="' +
          v.id +
          '" aria-pressed="false">' +
          esc(v.label) +
          '</button>'
        );
      }).join('') +
      '</div><button type="button" class="btn btn-ghost" data-quiz-close>Close</button></div></div>' +
      '<div class="quiz-results-body"></div></div>';
    document.body.appendChild(overlay);
    R = {
      cid: cid,
      aid: aid,
      view: 'competency',
      sel: null,
      changes: {},
      tryOf: {},
      done: null,
      overlay: overlay,
      opener: document.activeElement,
      onClose: (opts && opts.onClose) || null,
      loading: true,
    };
    overlay.addEventListener('click', _click);
    document.addEventListener('keydown', _keydown);
    _draw();
    _focus('[data-quiz-view="competency"]');
    var mine = R;
    Promise.all([G.QuizData.load(cid, aid), G.QuizTries.load(cid, aid)]).then(function () {
      if (R !== mine) return;
      R.loading = false;
      _draw();
    });
    return true;
  }

  /** @param {boolean} [quiet] */
  function close(quiet) {
    var r = R;
    if (!r) return;
    R = null;
    document.removeEventListener('keydown', _keydown);
    r.overlay.remove();
    if (!quiet && r.opener && r.opener.isConnected && r.opener.focus) r.opener.focus();
    if (!quiet && r.onClose) r.onClose();
  }

  /**
   * The line on a quiz piece's card, a button that opens its results:
   * "12 Answered · Confirm Levels". '' with the switch off, on a Draft, on a
   * piece that is not a quiz, and (signed in) until the piece's quiz has been
   * read; the first ask reads it and draws the line in place.
   * @param {string} cid @param {any} a
   */
  function cardLine(cid, a) {
    if (!_on() || !a || a.isDraft || !G.QuizData || !G.QuizData.offered(cid)) return '';
    var m = model(cid, a.id);
    if (!m) {
      var ask = cid + '|' + a.id;
      if (!_asked[ask]) {
        _asked[ask] = true;
        Promise.all([G.QuizData.load(cid, a.id), G.QuizTries.load(cid, a.id)]).then(function () {
          var slot = document.querySelector('[data-quiz-line="' + CSS.escape(a.id) + '"]');
          if (slot) slot.outerHTML = cardLine(cid, a) || '<span data-quiz-line="' + esc(a.id) + '" hidden></span>';
        });
      }
      return '<span data-quiz-line="' + esc(a.id) + '" hidden></span>';
    }
    var plan = G.GraderWork.quizConfirmPlan(cid, a.id, confirmRows(m));
    var text = m.sent ? _n(m.sent, 'Answered', 'Answered') : 'No Answers Yet';
    if (plan.cells.length) text += m.points ? ' · Confirm Scores' : ' · Confirm Levels';
    else if (m.toAssess) text += ' · ' + m.toAssess + ' to Assess';
    return (
      '<button type="button" class="quiz-card-line" data-quiz-line="' +
      esc(a.id) +
      '" data-action="openQuizResults" data-aid="' +
      esc(a.id) +
      '">' +
      esc(text) +
      '</button>'
    );
  }

  return { offered: offered, open: open, close: close, model: model, confirmRows: confirmRows, cardLine: cardLine };
})();
if (typeof window !== 'undefined') /** @type {any} */ (window).QuizResults = QuizResults;
