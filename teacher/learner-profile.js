/* The student-voice parts of the Learner Profile (docs/STUDENT-VOICE-PLAN.md,
   PR 8; canvas screen 9d): the ID card and private note, About Me, the
   student's own goals, and Reflections. Pure: a StudentVoice.profile()
   model in, HTML out. teacher/page-student.js places them and adds the
   competency goals, the disposition timelines and the Core Competency
   table it already had.

   Rules from the hierarchy audit: section heading, then group heading,
   then the question in grey, then the answer at one size for every answer;
   speech bubbles only for the student's words; "From <name>" or "Set by
   you" wherever student and teacher entries sit together; answers keep
   their line breaks and wrap near 68 characters; nothing shown that says
   nothing. */
var LearnerProfile = (function () {
  'use strict';

  var STEPS = ['Beginning', 'Growing', 'Confident', 'Leading'];
  var CORE_NAMES = {
    COM: 'Communicating',
    COL: 'Collaborating',
    CT: 'Creative Thinking',
    CRT: 'Critical & Reflective Thinking',
    PPI: 'Personal & Cultural Identity',
    PAR: 'Personal Awareness & Responsibility',
    SAR: 'Social Awareness & Responsibility',
  };
  var STATUS_COLORS = {
    'Not Started': 'var(--text-3)',
    'Working On It': 'var(--score-2)',
    'Mostly There': 'var(--score-3)',
    Done: 'var(--score-4)',
  };

  function day(iso) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function text(v) {
    if (!v) return '';
    if (v.text != null && String(v.text).trim()) return String(v.text);
    if (Array.isArray(v.json)) return v.json.join(', ');
    return '';
  }

  function coreName(id) {
    return CORE_NAMES[id] || id;
  }

  /* "HAR-jote": a part written in capitals is the stressed one, in bold. */
  function sayHtml(s) {
    return String(s || '')
      .split(/(\s+|-)/)
      .map(function (part) {
        return /^[A-Z]{2,}$/.test(part) ? '<strong>' + esc(part) + '</strong>' : esc(part);
      })
      .join('');
  }

  function bubble(s, lang) {
    return '<blockquote class="qw-b"' + (lang ? ' lang="' + esc(lang) + '"' : '') + '>' + esc(s) + '</blockquote>';
  }

  function noAnswer() {
    return '<div class="gl-none">No answer</div>';
  }

  /* A question and the student's answer in a bubble. */
  function qa(question, v, extraHtml, opts) {
    var t = text(v);
    return (
      '<figure class="qw' +
      (opts && opts.cls ? ' ' + opts.cls : '') +
      '"><figcaption class="qw-q">' +
      esc(question) +
      (extraHtml || '') +
      '</figcaption>' +
      (t ? bubble(t) : noAnswer()) +
      '</figure>'
    );
  }

  function src(who, first) {
    return who === 'you'
      ? '<span class="src src-you">Set by you</span>'
      : '<span class="src src-them">From ' + esc(first) + '</span>';
  }

  /* ── ID card and private note ─────────────────────────────── */

  function icon(kind) {
    var paths = {
      globe:
        '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>',
      people:
        '<circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="9" r="2.5"></circle><path d="M3 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 7 0"></path>',
      lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    };
    return '<svg class="lp-ic" viewBox="0 0 24 24" aria-hidden="true">' + paths[kind] + '</svg>';
  }

  /* The latest reflection's date: a questionnaire reflection, or a
     competency reflection (+ Reflection) when that is newer. */
  function reflectedAt(o) {
    var refl = o.model.reflections[0];
    var comp = o.compRefl || { count: 0, last: null };
    var reflAt = refl ? refl.at : null;
    if (comp.last && (!reflAt || String(comp.last) > String(reflAt))) reflAt = comp.last;
    return reflAt;
  }

  /* The profile's sections, in page order. Each has the id its <section>
     carries, the jump link's label, and what the link says beside the
     label. A new section (Reflections on Feedback, S10-F4) is one more
     entry here. */
  var SECTIONS = [
    // Reflect on Feedback (S10-F4): only while the class has it on.
    {
      id: 'lp-feedback',
      label: 'Reflections on Feedback',
      when: function (o) {
        return !!o.feedback;
      },
      sub: function (o) {
        var f = o.feedback;
        if (f.waiting) return f.waiting + (f.waiting === 1 ? ' question' : ' questions');
        return f.list.length ? day(f.list[0].sent_at) : 'Not yet';
      },
    },
    {
      id: 'lp-about',
      label: 'About Me',
      sub: function (o) {
        var a = o.model.about;
        return a ? day(a.at) : 'Not yet';
      },
    },
    {
      id: 'lp-goals',
      label: 'Goals',
      sub: function (o) {
        return o.goalCount + ' set';
      },
    },
    {
      id: 'lp-refl',
      label: 'Reflections',
      sub: function (o) {
        var at = reflectedAt(o);
        return at ? day(at) : 'Not yet';
      },
    },
  ];

  function jumpHtml(o) {
    return (
      '<nav class="id-jump" aria-label="On this page">' +
      SECTIONS.filter(function (s) {
        return !s.when || s.when(o);
      })
        .map(function (s) {
          return (
            '<a href="#' +
            esc(s.id) +
            '" data-action="lpJump" data-target="' +
            esc(s.id) +
            '">' +
            esc(s.label) +
            ' <span>' +
            esc(s.sub(o)) +
            '</span></a>'
          );
        })
        .join('') +
      '</nav>'
    );
  }

  function idCardHtml(o) {
    var a = o.model.about;
    var say = a && text(a.say && a.say.v);
    var langs = a && a.languages && a.languages.v && Array.isArray(a.languages.v.json) ? a.languages.v.json : [];
    var learns = a && text(a.learns && a.learns.v);
    var facts = '';
    if (langs.length) {
      facts +=
        '<div><dt>' +
        icon('globe') +
        'Speaks at home</dt><dd>' +
        langs
          .map(function (l) {
            return '<span class="stu-chip lp-static">' + esc(l) + '</span>';
          })
          .join('') +
        '</dd></div>';
    }
    if (learns)
      facts += '<div><dt>' + icon('people') + 'Learns best</dt><dd><strong>' + esc(learns) + '</strong></dd></div>';
    var html =
      '<div class="id-card"><div class="id-band"><span>' +
      esc(o.classLabel) +
      '</span>' +
      (o.grade ? '<span>Grade ' + esc(o.grade) + '</span>' : '') +
      '</div><div class="id-top"><div class="id-av" aria-hidden="true">' +
      esc(o.initials) +
      '</div>' +
      (say ? '<div class="id-say"><span>Say it</span> ' + sayHtml(say) + '</div>' : '') +
      (o.pronouns ? '<span class="id-pron">' + esc(o.pronouns) + '</span>' : '') +
      '</div>' +
      (facts ? '<dl class="id-facts">' + facts + '</dl>' : '') +
      jumpHtml(o) +
      '</div>';
    var note = a && text(a.note && a.note.v);
    if (note) {
      html +=
        '<div class="id-private"><div class="id-private-head">' +
        icon('lock') +
        'Private note to you</div><div class="id-private-text">' +
        esc(note) +
        '</div><div class="id-private-foot"><span>Only you see this.</span><span>' +
        esc(day(a.at)) +
        '</span></div></div>';
    }
    return html;
  }

  /* ── The Learner Profile as the redesign's board draws it ───────
     (docs/plans/teacher-student-page-redesign-plan.md, R6). The student's
     words as a list of question and answer, and their own goals as items
     the page lays out beside the competency goals. */

  /* Every About Me answer, in the order asked: { q, t }. */
  function wordsItems(o) {
    var a = o.model.about;
    if (!a) return [];
    var out = [];
    ['learns', 'goodAt', 'hard', 'outside'].forEach(function (k) {
      var it = a[k];
      var t = it && text(it.v);
      if (t) out.push({ q: (it.q && it.q.prompt) || '', t: t });
    });
    var langs = a.languages && a.languages.v && Array.isArray(a.languages.v.json) ? a.languages.v.json : [];
    if (langs.length)
      out.push({ q: (a.languages.q && a.languages.q.prompt) || 'Languages at home', t: langs.join(', ') });
    (a.rest || []).forEach(function (it) {
      if (it.q && it.q.teacher_only) return;
      var t = text(it.v);
      if (t) out.push({ q: it.q.prompt, t: t });
    });
    return out;
  }

  /* The private note the student left for the teacher in About Me, or ''. */
  function privateNote(o) {
    var a = o.model.about;
    return (a && text(a.note && a.note.v)) || '';
  }

  /* The student's own goals: the course goal (with its check-in status)
     and the Core Competency goal. { from, comp, text, status, when }. */
  function studentGoals(o) {
    var a = o.model.about;
    var c = o.model.checkin;
    var out = [];
    var goal = a && a.goal && text(a.goal.v);
    if (goal)
      out.push({
        comp: o.courseName + ' Goal',
        text: goal,
        status: c && c.status ? text(c.status.v) : '',
        when: a.at ? 'Set ' + day(a.at) : '',
      });
    var coreGoal = c && c.coreGoal && text(c.coreGoal.v);
    if (coreGoal) {
      var pick = c.core && c.core.v ? text(c.core.v) : '';
      out.push({
        comp: pick ? coreName(pick) : 'Core Competency Goal',
        text: coreGoal,
        status: '',
        when: c.at ? 'Set ' + day(c.at) : '',
      });
    }
    return out;
  }

  /* A goal's status as four steps and its word (Not Started … Done). */
  var STATUS_STEP = { 'Not Started': 0, 'Working On It': 2, 'Mostly There': 3, Done: 4 };
  function statusHtml(status) {
    if (!status) return '';
    var n = STATUS_STEP[status] != null ? STATUS_STEP[status] : 0;
    var color = STATUS_COLORS[status] || 'var(--text-2)';
    var html = '<span class="lp2-steps" role="img" aria-label="' + esc(status) + '">';
    for (var i = 1; i <= 4; i++) html += '<span' + (i <= n ? ' style="background:' + color + '"' : '') + '></span>';
    return html + '</span><span class="st lp2-status" style="color:' + color + '">' + esc(status) + '</span>';
  }

  function goalCount(model) {
    var n = 0;
    if (model.about && model.about.goal && model.about.goal.v) n++;
    if (model.checkin && model.checkin.coreGoal && model.checkin.coreGoal.v) n++;
    return n;
  }

  /* The competency reflections in the student's words (+ Reflection): how
     many, and when the newest was saved. They count as reflections and
     answers wherever the Learner Profile counts them. */
  function compReflections(cid, sid, sections) {
    var mine = getReflections(cid)[sid] || {};
    var out = { count: 0, last: null };
    (sections || []).forEach(function (sec) {
      var r = mine[sec.id];
      if (!r || !(r.text || r.confidence)) return;
      out.count++;
      if (r.date && (!out.last || String(r.date) > String(out.last))) out.last = r.date;
    });
    return out;
  }

  /* ── Reflections ──────────────────────────────────────────── */

  function steps(level, label) {
    return (
      '<div class="stu-core-steps" role="img" aria-label="' +
      esc(label) +
      '">' +
      STEPS.map(function (s, i) {
        return '<span class="stu-core-step' + (level === i + 1 ? ' on lv-' + level : '') + '">' + s + '</span>';
      }).join('') +
      '</div>'
    );
  }

  function reflectionHtml(o, e, first) {
    var html = '';
    var plain = [];
    e.items.forEach(function (it) {
      var q = it.q;
      var v = it.v;
      if (q.kind === 'short_set') {
        var labels = (q.options && q.options.labels) || [];
        var vals = v && Array.isArray(v.json) ? v.json : [];
        html += '<div class="qw-group"><h3>' + esc(/shield/i.test(q.prompt) ? 'Personal Shield' : q.prompt) + '</h3>';
        html += '<div class="sh-grid">';
        (labels.length ? labels : vals).forEach(function (lab, i) {
          var t = String(vals[i] || '').trim();
          html +=
            '<figure class="qw"><figcaption class="qw-q">' +
            esc(labels.length ? lab : 'Answer ' + (i + 1)) +
            '</figcaption>' +
            (t ? bubble(t) : noAnswer()) +
            '</figure>';
        });
        html += '</div></div>';
      } else if (q.kind === 'scale4') {
        var j = (v && v.json) || {};
        var levels = j.levels || {};
        var why = j.why;
        var cores = (q.core_ids || []).length ? q.core_ids : [null];
        html += '<div class="qw-group"><h3>Self-Assessment</h3><div class="qw-pair">';
        cores.forEach(function (k) {
          var lv = k ? levels[k] : v && v.num;
          var w = k && why && typeof why === 'object' ? why[k] : typeof why === 'string' ? why : k ? '' : text(v);
          html +=
            '<div class="gl-card">' +
            (k ? '<div class="gl-title">' + esc(coreName(k)) + '</div>' : '') +
            '<div class="qw-q qw-q-flush">' +
            esc(q.prompt) +
            '</div>' +
            (lv
              ? steps(lv, first + ' chose ' + STEPS[lv - 1])
              : '<div class="gl-none gl-none-flush">No step chosen</div>') +
            '<figure class="qw"><figcaption class="qw-q">Why?</figcaption>' +
            (w ? bubble(w) : noAnswer()) +
            '</figure></div>';
        });
        html += '</div></div>';
      } else {
        plain.push(it);
      }
    });
    if (plain.length) {
      var pl = '';
      plain.forEach(function (it) {
        pl += qa(it.q.prompt, it.v);
      });
      // Written answers sit with the shield they follow, before the self-assessment.
      var at = html.indexOf('<div class="qw-group"><h3>Self-Assessment');
      var block = '<div class="qw-group">' + pl + '</div>';
      html = at >= 0 ? html.slice(0, at) + block + html.slice(at) : html + block;
    }
    return html;
  }

  function reflectionsHtml(o) {
    var list = o.model.reflections;
    var latest = list[0];
    var html =
      '<section class="qw-sec" id="lp-refl" aria-labelledby="lp-refl-h"><div class="qw-head"><h2 id="lp-refl-h">Reflections</h2>' +
      (list.length > 1
        ? '<span>Newest first</span>'
        : latest
          ? '<span>' + esc(day(latest.at) + (latest.theme ? ' · ' + latest.theme : '')) + '</span>'
          : '') +
      '</div>';
    if (!list.length) {
      var comp = (o.compRefl && o.compRefl.count) || 0;
      return (
        html +
        '<div class="lp-none">' +
        (comp
          ? esc(
              'No questionnaire reflections from ' +
                o.first +
                ' yet. ' +
                (comp === 1
                  ? '1 competency reflection is under Competency Goals.'
                  : comp + ' competency reflections are under Competency Goals.'),
            )
          : 'No reflections from ' + esc(o.first) + ' yet.') +
        '</div></section>'
      );
    }
    list.forEach(function (e) {
      if (list.length > 1) {
        html +=
          '<div class="lp-older"><h3>' +
          esc(e.title) +
          ' <span class="gl-meta">' +
          esc(day(e.at) + (e.theme ? ' · ' + e.theme : '')) +
          '</span></h3></div>';
      }
      html += reflectionHtml(o, e, o.first);
    });
    return html + '</section>';
  }

  /* ── Reflect on Feedback (S10-F4) ─────────────────────────────
     The board "Student Page, Learner Profile With Reflections": beside the
     ID card, Working On (the student's newest plan) and Reflecting So Far;
     in the main column, Reflections on Feedback, one card per reflection,
     newest first, with All / Questions / Plans. Only while the class's
     student page and Reflect on Feedback are on (feedbackOf answers null
     otherwise, and nothing here is drawn). A reflection is the student's
     own words: they show in the student's bubble, exactly, through esc.
     A question waiting leads to the grader, where it is answered; the
     count is getQuestionsWaiting's (shared/data.js), the one the dashboard
     and the gradebook read, so one answer clears all three. Grades on the
     cards come from calc.js (assessmentCellValue), all work, as every
     teacher screen. */

  var FOLLOWED = { yes: 'Yes', partly: 'Partly', no: 'Not This Time' };
  var _feedbackFilter = 'all';

  function setFeedbackFilter(f) {
    _feedbackFilter = f === 'questions' || f === 'plans' ? f : 'all';
  }

  // This student's reflections on the class's pieces (feedbackOf and feedbackCounts).
  function _reflectionsOf(cid, sid, pieces) {
    (getAssessments(cid) || []).forEach(function (a) {
      if (a && a.id) pieces[a.id] = a;
    });
    return getStudentReflections(cid, sid).filter(function (r) {
      return !!pieces[r.assessment_id];
    });
  }

  // Everything the three parts show, or null while Reflect on Feedback is off.
  function feedbackOf(cid, sid) {
    if (typeof getReflectOnFeedback !== 'function' || !getReflectOnFeedback(cid)) return null;
    var pieces = {};
    var list = _reflectionsOf(cid, sid, pieces);
    var returned = Object.keys(pieces).filter(function (aid) {
      return GradeState.stateOf(cid, sid, aid) === GradeState.RETURNED;
    }).length;
    var grades = {};
    list.forEach(function (r) {
      var cell = assessmentCellValue(cid, sid, pieces[r.assessment_id]);
      // The grade as a level chip in its colour (design rule 3); level 0 has none.
      grades[r.assessment_id] = cell && cell.kind !== 'none' ? { text: cell.text, level: cell.level || 0 } : null;
    });
    return {
      cid: cid,
      sid: sid,
      list: list,
      count: list.length,
      pieces: pieces,
      grades: grades,
      returned: returned,
      waiting: getQuestionsWaiting(cid, sid).length,
      lastPlan: getStudentLastPlan(cid, sid),
    };
  }

  /* Only the two numbers the student page's tab shows (feedbackOf's count
     and waiting), for a draw of another tab: no grades, no returned count. */
  function feedbackCounts(cid, sid) {
    if (typeof getReflectOnFeedback !== 'function' || !getReflectOnFeedback(cid)) return null;
    return { count: _reflectionsOf(cid, sid, {}).length, waiting: getQuestionsWaiting(cid, sid).length };
  }

  function _title(f, aid) {
    var a = f.pieces[aid];
    return a ? a.title || 'Untitled' : '';
  }

  function feedbackAsideHtml(o) {
    var f = o.feedback;
    if (!f) return '';
    var html = '';
    var last = f.lastPlan && f.pieces[f.lastPlan.assessment_id] ? f.lastPlan : null;
    if (last) {
      var from = f.list.find(function (r) {
        return r.assessment_id === last.assessment_id;
      });
      html +=
        '<div class="lp-card lp-working"><h3>Working On</h3>' +
        bubble(last.plan) +
        '<div class="lp-card-note">' +
        esc(
          'From the reflection on ' +
            _title(f, last.assessment_id) +
            (last.sent_at ? ', ' + day(last.sent_at) : '') +
            '.' +
            (from && !from.next ? ' It shows on ' + o.first + '’s next ' + o.courseName + ' assignment.' : ''),
        ) +
        '</div></div>';
    }
    var plans = f.list.filter(function (r) {
      return !!r.plan;
    });
    var shown = plans.filter(function (r) {
      return !!r.next;
    });
    var followed = shown.filter(function (r) {
      return r.next.followed_plan === 'yes';
    });
    var lines = [
      f.list.length +
        (f.list.length === 1 ? ' reflection on ' : ' reflections on ') +
        f.returned +
        (f.returned === 1 ? ' returned piece' : ' returned pieces'),
    ];
    if (shown.length) lines.push(followed.length + ' of ' + shown.length + ' plans followed on the next piece');
    if (f.waiting)
      lines.push(f.waiting + (f.waiting === 1 ? ' question waiting for you' : ' questions waiting for you'));
    html +=
      '<div class="lp-card lp-so-far"><h3>Reflecting So Far</h3><ul>' +
      lines
        .map(function (l, i) {
          return '<li' + (f.waiting && i === lines.length - 1 ? ' class="lp-so-far-ask"' : '') + '>' + esc(l) + '</li>';
        })
        .join('') +
      '</ul></div>';
    return html;
  }

  function _answerButton(r) {
    return (
      '<div class="rf-wait"><span>Not answered yet</span>' +
      '<button type="button" class="btn btn-ghost rf-answer" data-action="lpAnswerInGrader" data-aid="' +
      esc(r.assessment_id) +
      '">Answer in the Grader</button></div>'
    );
  }

  function _said(label, words) {
    return (
      '<figure class="qw rf-said"><figcaption class="qw-q">' +
      esc(label) +
      '</figcaption>' +
      bubble(words) +
      '</figure>'
    );
  }

  function _answered(at, words) {
    return (
      '<div class="rf-you"><div class="qw-q">' +
      esc('You answered' + (at ? ' ' + day(at) : '') + ':') +
      '</div><div class="rf-you-text">' +
      esc(words) +
      '</div></div>'
    );
  }

  function _cardHtml(o, f, r) {
    var kinds = (r.question ? ' rf-q' : '') + (r.plan ? ' rf-p' : '');
    var grade = f.grades[r.assessment_id];
    var html =
      '<article class="rf-card' +
      kinds +
      '"><div class="rf-top"><h3 class="rf-title">' +
      esc(_title(f, r.assessment_id)) +
      '</h3>' +
      (grade
        ? '<span class="rf-grade' +
          (grade.level ? ' stu-level stu-level-' + roundLevel(grade.level) : '') +
          '">' +
          esc(grade.text) +
          '</span>'
        : '') +
      '<span class="rf-sense' +
      (r.makes_sense === 'yes' ? ' is-yes' : ' is-unsure') +
      '">' +
      (r.makes_sense === 'yes' ? 'Makes sense' : 'Not sure') +
      '</span><span class="rf-day">' +
      esc(day(r.sent_at)) +
      '</span></div>';
    if (r.question) {
      html += _said('Asked:', r.question);
      if (!r.answer) html += _answerButton(r);
      else {
        html += _answered(r.answered_at, r.answer);
        if (r.sense_now === 'yes')
          html += '<div class="rf-line">' + esc(o.first + ' says it makes sense now.') + '</div>';
        if (r.follow_up) {
          html += _said(o.first + ' is still not sure and asks:', r.follow_up);
          html += r.follow_up_answer ? _answered(r.follow_up_answered_at, r.follow_up_answer) : _answerButton(r);
        }
      }
    }
    if (r.plan) {
      html += _said('Plan:', r.plan);
      html +=
        '<div class="rf-line rf-next">' +
        (!r.next
          ? 'Not yet shown'
          : r.next.followed_plan && FOLLOWED[r.next.followed_plan]
            ? esc('Did it on the next one? ' + o.first + ' says: ' + FOLLOWED[r.next.followed_plan])
            : esc('Didn’t say on the next one')) +
        '</div>';
    }
    if (r.went_well) html += _said('Proud of:', r.went_well);
    return html + '</article>';
  }

  function feedbackHtml(o) {
    var f = o.feedback;
    if (!f) return '';
    var filters = [
      ['all', 'All'],
      ['questions', 'Questions'],
      ['plans', 'Plans'],
    ];
    var html =
      '<section class="qw-sec" id="lp-feedback" aria-labelledby="lp-feedback-h"><div class="qw-head"><h2 id="lp-feedback-h">Reflections on Feedback</h2>' +
      (f.list.length
        ? '<div class="seg rf-filter" role="group" aria-label="Show">' +
          filters
            .map(function (x) {
              var on = _feedbackFilter === x[0];
              return (
                '<button type="button" class="seg-btn' +
                (on ? ' active' : '') +
                '" data-action="lpFeedbackFilter" data-filter="' +
                x[0] +
                '" aria-pressed="' +
                on +
                '">' +
                x[1] +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '</div>';
    if (!f.list.length)
      return (
        html +
        '<div class="lp-none">' +
        esc('No reflections on feedback from ' + o.first + ' yet.') +
        '</div></section>'
      );
    var shown = f.list.filter(function (r) {
      return _feedbackFilter === 'questions' ? !!r.question : _feedbackFilter === 'plans' ? !!r.plan : true;
    });
    if (!shown.length)
      html +=
        '<div class="lp-none">' +
        esc((_feedbackFilter === 'questions' ? 'No questions from ' : 'No plans from ') + o.first + ' yet.') +
        '</div>';
    shown.forEach(function (r) {
      html += _cardHtml(o, f, r);
    });
    return html + '</section>';
  }

  return {
    SECTIONS: SECTIONS,
    feedbackOf: feedbackOf,
    feedbackCounts: feedbackCounts,
    feedbackAsideHtml: feedbackAsideHtml,
    feedbackHtml: feedbackHtml,
    setFeedbackFilter: setFeedbackFilter,
    idCardHtml: idCardHtml,
    reflectionsHtml: reflectionsHtml,
    goalCount: goalCount,
    compReflections: compReflections,
    wordsItems: wordsItems,
    privateNote: privateNote,
    studentGoals: studentGoals,
    statusHtml: statusHtml,
    text: text,
    sayHtml: sayHtml,
    day: day,
    src: src,
    bubble: bubble,
  };
})();
if (typeof window !== 'undefined') window.LearnerProfile = LearnerProfile;
