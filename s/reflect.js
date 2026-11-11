/* Reflect on Feedback, on the student's page (S10-F1; the artboard's
   "Reflect on Feedback", "Reflect, Not Sure", "Reflection Sent", "Your
   Teacher Answered" and "Reflect on Feedback on a Chromebook").

   Opened from Your Feedback (or See Your Work) on a returned piece, while
   the class has Reflect on Feedback on (off until the teacher turns it
   on): Does the Feedback Make Sense? Yes leads to What Will You Do Next
   Time? and What Went Well?; Not Sure to a question for the teacher. Once
   sent, the same button shows what was sent and, when it comes, the
   teacher's answer, with Does It Make Sense Now? (Yes, or Still Not Sure
   and one more question).

   Demo Mode only (#demo-card-reflect): every answer comes from
   s/feedback.js (StudentPage.feedbackAsk), which answers as Batch C's
   `reflect` and `reply` are written to. Nothing is sent anywhere; outside
   Demo Mode nothing is asked. The plan goes on the next piece to do
   (shared/student-view.js, S10-F2) and Check and Send asks Did You Do It?
   (s/send.js).

   Every answer draws only if this reflection is still on screen for the
   same student (StudentPage.whileCurrent drops it after Done, a new card
   or another class). A reply of the wrong kind says it couldn't reach
   FullVision; nothing is left stuck. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var S = null; // the page's state (student.js)
  var LIMIT = 1000;
  var NETWORK = 'Couldn’t reach FullVision. Check your internet and try again.';

  // The board's sentence starters: what each puts in the box.
  var STARTERS = {
    plan: [
      ['Next time I’ll…', 'Next time I’ll '],
      ['I’ll practise…', 'I’ll practise '],
      ['Before I start, I’ll…', 'Before I start, I’ll '],
    ],
    went: [
      ['I’m proud of…', 'I’m proud of '],
      ['I got better at…', 'I got better at '],
    ],
    question: [
      ['What does … mean?', 'What does '],
      ['Can you show me an example of…', 'Can you show me an example of '],
      ['I don’t know how to…', 'I don’t know how to '],
    ],
  };
  var FIELDS = {
    plan: 'sp-reflect-plan',
    went: 'sp-reflect-went',
    question: 'sp-reflect-question',
    follow: 'sp-reflect-follow',
  };

  function view() {
    return S && typeof StudentPage.viewOf === 'function' ? StudentPage.viewOf(S) : null;
  }
  function pieceOf(id) {
    var v = view();
    return (
      (v &&
        v.work.filter(function (p) {
          return p.id === id;
        })[0]) ||
      null
    );
  }
  function teacherOf() {
    var v = view();
    return String((v && v.course && v.course.teacherName) || '').trim();
  }
  function day(iso) {
    var t = iso ? new Date(iso) : null;
    return t && !isNaN(t) ? t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';
  }
  // Only a returned piece with a result, in a class with Reflect on Feedback on.
  function canReflect(v, p) {
    return !!(v && v.reflectOn && p && p.kind === 'back' && p.result && p.result.text);
  }

  // Is this reflection still the one on screen, for the student on screen?
  function current(r) {
    return !!S && S.reflect === r && S.screen === 'reflect' && !!S.page && S.page.student.id === r.student;
  }

  /* ── Opening and leaving ───────────────────────────────────── */

  function stepFor(p) {
    var r = p.reflection;
    if (!r) return 'form';
    return r.answer || r.followUpAnswer ? 'answer' : 'sent';
  }

  function open(id) {
    var v = view();
    var p = pieceOf(id);
    if (!canReflect(v, p)) return;
    S.reflect = {
      id: p.id,
      student: S.page.student.id,
      step: stepFor(p),
      sense: '',
      plan: '',
      went: '',
      question: '',
      follow: '',
      asking: false, // Still Not Sure chosen: the box for one more question shows
      busy: false,
      message: '',
    };
    S.screen = 'reflect';
    StudentPage.paint('#sp-reflect-title');
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  function leave() {
    var id = S.reflect ? S.reflect.id : '';
    S.reflect = null;
    S.screen = 'assignments';
    StudentPage.paint(id ? '[data-act="reflect-open"]' : '#sp-fb-title');
  }

  /* ── Sending ───────────────────────────────────────────────── */

  function said(res, teacher) {
    var e = res && res.error;
    if (e === 'reflect_off') return 'Reflect on Feedback is turned off for this class now.';
    if (e === 'not_returned' || e === 'not_found') return 'This piece can’t take a reflection now.';
    if (e === 'already_asked') return 'You’ve already asked about this. ' + teacher + ' will answer it here.';
    return NETWORK;
  }

  function ready(r) {
    if (r.step === 'form') {
      if (r.sense === 'yes') return !!r.plan.trim();
      if (r.sense === 'not_sure') return !!r.question.trim();
      return false;
    }
    return r.asking && !!r.follow.trim();
  }

  function sendReflection() {
    var r = S.reflect;
    if (!r || r.busy || r.step !== 'form' || !ready(r)) return Promise.resolve();
    var body = {
      enrollment_id: r.student,
      assessment_id: r.id,
      reflection:
        r.sense === 'yes'
          ? { makes_sense: 'yes', plan: r.plan.trim(), went_well: r.went.trim() || null }
          : { makes_sense: 'not_sure', question: r.question.trim() },
    };
    return go(r, 'reflect', body, function () {
      r.step = 'sent';
      return '#sp-reflect-title';
    });
  }

  function sendReply(sense) {
    var r = S.reflect;
    if (!r || r.busy || r.step !== 'answer') return Promise.resolve();
    if (sense === 'not_sure' && !r.follow.trim()) return Promise.resolve();
    var body = {
      enrollment_id: r.student,
      assessment_id: r.id,
      reply: sense === 'yes' ? { sense_now: 'yes' } : { sense_now: 'not_sure', follow_up: r.follow.trim() },
    };
    return go(r, 'reply', body, function () {
      r.asking = false;
      r.follow = '';
      return sense === 'yes' ? '[data-act="reflect-sense-now"][data-value="yes"]' : '#sp-reflect-title';
    });
  }

  function go(r, route, body, done) {
    r.busy = true;
    r.message = '';
    StudentPage.paint();
    var ask = typeof StudentPage.feedbackAsk === 'function' ? StudentPage.feedbackAsk : null;
    var answer = ask ? ask(route, body) : Promise.resolve({ ok: false, error: 'network' });
    return StudentPage.whileCurrent(
      Promise.resolve(answer).then(null, function () {
        return { ok: false, error: 'network' };
      }),
    ).then(function (res) {
      // The student left, or another student signed in, while it was on its way.
      if (!current(r)) return;
      r.busy = false;
      var teacher = teacherOf() || 'Your teacher';
      if (res && res.ok === true && res.reflection && typeof res.reflection === 'object') {
        StudentPage.paint(done());
        return;
      }
      if (res && res.error === 'already_answered') {
        // The teacher answered meanwhile: show the answer.
        r.step = 'answer';
        StudentPage.paint('#sp-reflect-title');
        return;
      }
      r.message = said(res, teacher);
      StudentPage.paint('#sp-reflect-msg');
    });
  }

  /* ── Drawing ───────────────────────────────────────────────── */

  var BACK =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';

  function head(title, sub) {
    return (
      '<button type="button" class="sp-fb-back sp-reflect-back" data-act="reflect-back">' +
      BACK +
      '<span>Your Feedback</span></button><div class="sp-fb-head"><h1 class="sp-fb-title" id="sp-reflect-title" tabindex="-1">' +
      esc(title) +
      '</h1>' +
      (sub ? '<p class="sp-fb-sub">' + esc(sub) + '</p>' : '') +
      '</div>'
    );
  }

  function choicesHtml(label, act, options, chosen, busy) {
    return (
      '<div class="sp-seg sp-seg-' +
      options.length +
      '" role="radiogroup" aria-label="' +
      esc(label) +
      '">' +
      options
        .map(function (o, i) {
          var on = chosen === o[0];
          return (
            '<button type="button" class="sp-seg-btn' +
            (on ? ' sp-seg-on' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" tabindex="' +
            (on || (!chosen && i === 0) ? '0' : '-1') +
            '" data-act="' +
            act +
            '" data-value="' +
            o[0] +
            '"' +
            (busy ? ' disabled' : '') +
            '>' +
            esc(o[1]) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function startersHtml(field) {
    return (
      '<div class="sp-starters">' +
      STARTERS[field]
        .map(function (s, i) {
          return (
            '<button type="button" class="sp-starter" data-act="reflect-starter" data-field="' +
            field +
            '" data-n="' +
            i +
            '">' +
            esc(s[0]) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function boxHtml(field, value, label, placeholder) {
    return (
      '<textarea class="sp-reflect-box" id="' +
      FIELDS[field] +
      '" maxlength="' +
      LIMIT +
      '" rows="3" aria-label="' +
      esc(label) +
      '"' +
      (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') +
      '>' +
      esc(value) +
      '</textarea>'
    );
  }

  function stepHtml(n, title, body, aside) {
    return (
      '<section class="sp-reflect-step"><h2 class="sp-reflect-step-title"><span class="sp-reflect-n" aria-hidden="true">' +
      n +
      '</span>' +
      esc(title) +
      (aside ? '<span class="sp-reflect-aside">' + esc(aside) + '</span>' : '') +
      '</h2>' +
      body +
      '</section>'
    );
  }

  function saidHtml(p, teacher) {
    if (!p.comment) return '';
    return (
      '<section class="sp-fb-card sp-reflect-said"><h2 class="sp-fb-label">' +
      esc((teacher || 'Your Teacher') + ' Said') +
      '</h2><p class="sp-fb-comment-words">' +
      esc(p.comment) +
      '</p></section>'
    );
  }

  function messageHtml(r) {
    return r.message
      ? '<p class="sp-msg" id="sp-reflect-msg" role="alert" tabindex="-1">' + esc(r.message) + '</p>'
      : '';
  }

  // Reflect on Feedback and Reflect, Not Sure (the boards).
  function formHtml(r, p, v, teacher) {
    var who = teacher || 'your teacher';
    var body =
      head('Reflect on Feedback', p.title) +
      saidHtml(p, teacher) +
      stepHtml(
        1,
        'Does the Feedback Make Sense?',
        choicesHtml(
          'Does the feedback make sense?',
          'reflect-sense',
          [
            ['yes', 'Yes'],
            ['not_sure', 'Not Sure'],
          ],
          r.sense,
          r.busy,
        ),
      );
    if (r.sense === 'yes') {
      body +=
        stepHtml(
          2,
          'What Will You Do Next Time?',
          startersHtml('plan') + boxHtml('plan', r.plan, 'What will you do next time?'),
        ) +
        stepHtml(
          3,
          'What Went Well?',
          startersHtml('went') + boxHtml('went', r.went, 'What went well?', 'Something that went well'),
          'Optional',
        );
    } else if (r.sense === 'not_sure') {
      body +=
        '<section class="sp-reflect-step"><p class="sp-reflect-line">' +
        esc('That’s okay. Ask ' + who + ' about the part that doesn’t make sense.') +
        '</p>' +
        startersHtml('question') +
        boxHtml('question', r.question, 'Your question for ' + who) +
        '</section>';
    }
    if (r.sense) {
      body +=
        '<p class="sp-reflect-private">' +
        esc('Only ' + who + ' sees this.') +
        '</p>' +
        messageHtml(r) +
        '<button type="button" class="sp-btn sp-btn-primary sp-btn-big sp-reflect-send" data-act="reflect-send"' +
        (!ready(r) || r.busy ? ' disabled' : '') +
        '>' +
        esc(r.busy ? 'Sending…' : r.sense === 'yes' ? 'Send Reflection' : 'Ask ' + (teacher || 'Your Teacher')) +
        '</button>';
    }
    return body;
  }

  // Reflection Sent (the board), and its question form (mine).
  function sentHtml(r, p, v, teacher) {
    var mine = p.reflection || {};
    var who = teacher || 'Your teacher';
    var plan = mine.makesSense === 'yes';
    return (
      head(plan ? 'Reflection Sent' : 'Question Sent', '') +
      '<section class="sp-reflect-sent"><span class="sp-send-tick" aria-hidden="true">✓</span><p class="sp-reflect-line">' +
      esc(plan ? who + ' will read it.' : who + ' will answer it here.') +
      '</p>' +
      (plan
        ? '<div class="sp-fb-card sp-reflect-plan"><h2 class="sp-fb-label">Your Plan</h2><p class="sp-plan-words">' +
          esc(mine.plan) +
          '</p></div>' +
          '<p class="sp-reflect-line">' +
          esc('It’ll show on your next ' + ((v.course && v.course.name) || 'class') + ' assignment.') +
          '</p>'
        : '<div class="sp-fb-card sp-reflect-plan"><h2 class="sp-fb-label">You Asked</h2><p class="sp-plan-words">' +
          esc(mine.question) +
          '</p></div>') +
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="reflect-back">Done</button></section>'
    );
  }

  function bubbleHtml(who, when, words, theirs, teacher) {
    return (
      '<div class="sp-bubble' +
      (theirs ? ' sp-bubble-theirs' : ' sp-bubble-mine') +
      '"><p class="sp-bubble-who">' +
      (theirs && teacher && StudentPageView.initialsHtml ? StudentPageView.initialsHtml(teacher) : '') +
      '<span>' +
      esc(who + (when ? ', ' + when : '')) +
      '</span></p><p class="sp-bubble-words">' +
      esc(words) +
      '</p></div>'
    );
  }

  // Your Teacher Answered (the board): the question and the answer, then Does It Make Sense Now?
  function answerHtml(r, p, teacher) {
    var mine = p.reflection || {};
    var who = teacher || 'Your Teacher';
    var asked = mine.makesSense === 'not_sure';
    var talk =
      (asked
        ? bubbleHtml('You Asked', day(mine.sentAt), mine.question, false)
        : bubbleHtml('Your Plan', day(mine.sentAt), mine.plan, false)) +
      (mine.answer ? bubbleHtml(who, day(mine.answeredAt), mine.answer, true, teacher) : '') +
      (mine.followUp ? bubbleHtml('You Asked', '', mine.followUp, false) : '') +
      (mine.followUpAnswer ? bubbleHtml(who, day(mine.followUpAnsweredAt), mine.followUpAnswer, true, teacher) : '');
    var after = '';
    if (asked && mine.answer) {
      var sense = mine.senseNow || (r.asking ? 'not_sure' : '');
      after +=
        '<section class="sp-reflect-step"><h2 class="sp-reflect-step-title">Does It Make Sense Now?</h2>' +
        choicesHtml(
          'Does it make sense now?',
          'reflect-sense-now',
          [
            ['yes', 'Yes'],
            ['not_sure', 'Still Not Sure'],
          ],
          sense,
          r.busy || !!mine.senseNow,
        ) +
        '</section>';
      if (mine.senseNow === 'yes') {
        after += '<p class="sp-reflect-line">Then make your plan for next time.</p>';
      } else if (!mine.senseNow && r.asking) {
        after +=
          '<section class="sp-reflect-step">' +
          boxHtml('follow', r.follow, 'Your question for ' + (teacher || 'your teacher')) +
          '</section>' +
          messageHtml(r) +
          '<button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="reflect-follow"' +
          (!ready(r) || r.busy ? ' disabled' : '') +
          '>' +
          esc(r.busy ? 'Sending…' : 'Ask ' + who) +
          '</button>';
      } else if (mine.followUp && !mine.followUpAnswer) {
        after += '<p class="sp-reflect-line">' + esc((teacher || 'Your teacher') + ' will answer it here.') + '</p>';
      }
      if (!r.asking) after += messageHtml(r);
    }
    return head(who + ' Answered', p.title) + '<div class="sp-talk">' + talk + '</div>' + after;
  }

  function renderReflect(state) {
    var r = state.reflect;
    var v = view();
    var p = r && state.page && state.page.student.id === r.student ? pieceOf(r.id) : null;
    if (!p || !canReflect(v, p)) {
      return '<main class="sp-main sp-main-center"><p class="sp-lead" role="status">Opening your page…</p></main>';
    }
    var teacher = teacherOf();
    // What the page holds now decides the step, once something was sent (or answered meanwhile).
    if (r.step === 'form' && p.reflection) r.step = stepFor(p);
    var body =
      r.step === 'answer'
        ? answerHtml(r, p, teacher)
        : r.step === 'sent'
          ? sentHtml(r, p, v, teacher)
          : formHtml(r, p, v, teacher);
    return (
      '<main class="sp-main sp-reflect"><div class="sp-view sp-reflect-view"><section class="sp-feedback">' +
      body +
      '</section></div>' +
      (state.demo ? '<p class="sp-fine">This is Demo Mode. Nothing is sent anywhere.</p>' : '') +
      '</main>'
    );
  }

  /* ── Presses ───────────────────────────────────────────────── */

  function onClick(act, el) {
    if (!S) return;
    var attr = function (n) {
      return (el && el.getAttribute && el.getAttribute(n)) || '';
    };
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      S.reflect = null;
      return;
    }
    if (act === 'reflect-open') return open(attr('data-piece'));
    var r = S.reflect;
    if (S.screen !== 'reflect' || !r) return;
    if (act === 'reflect-back') return leave();
    if (r.busy) return;
    if (act === 'reflect-sense' && r.step === 'form') {
      var v = attr('data-value');
      if (v !== 'yes' && v !== 'not_sure') return;
      r.sense = v;
      r.message = '';
      return StudentPage.paint('[data-act="reflect-sense"][data-value="' + v + '"]');
    }
    if (act === 'reflect-starter') {
      var field = attr('data-field');
      var s = STARTERS[field] && STARTERS[field][Number(attr('data-n'))];
      if (!s || !FIELDS[field]) return;
      var had = r[field] || '';
      r[field] = (had && !/\s$/.test(had) ? had + ' ' : had) + s[1];
      r[field] = r[field].slice(0, LIMIT);
      StudentPage.paint('#' + FIELDS[field]);
      var box = typeof document !== 'undefined' ? document.getElementById(FIELDS[field]) : null;
      if (box && typeof box.setSelectionRange === 'function') box.setSelectionRange(r[field].length, r[field].length);
      return;
    }
    if (act === 'reflect-send') return sendReflection();
    if (act === 'reflect-sense-now' && r.step === 'answer') {
      if (attr('data-value') === 'yes') return sendReply('yes');
      if (attr('data-value') === 'not_sure') {
        r.asking = true;
        return StudentPage.paint('#' + FIELDS.follow);
      }
    }
    if (act === 'reflect-follow') return sendReply('not_sure');
  }

  // Typing keeps the focus: the words are kept and Send follows them, with no redraw.
  function onInput(el) {
    if (!el || !S || !S.reflect || S.screen !== 'reflect') return;
    var r = S.reflect;
    var field = null;
    Object.keys(FIELDS).forEach(function (k) {
      if (FIELDS[k] === el.id) field = k;
    });
    if (!field) return;
    r[field] = String(el.value || '').slice(0, LIMIT);
    var button =
      typeof document !== 'undefined' ? document.querySelector('.sp-reflect-send, [data-act="reflect-follow"]') : null;
    if (button) {
      if (ready(r) && !r.busy) button.removeAttribute('disabled');
      else button.setAttribute('disabled', '');
    }
  }

  StudentPage.addScreens({
    file: 'reflect',
    render: { reflect: renderReflect },
    click: onClick,
    input: onInput,
    share: function (state) {
      S = state;
    },
    test: {
      sendReflection: sendReflection,
      sendReply: sendReply,
    },
  });
})();
