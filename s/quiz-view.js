// @ts-check
/* A quiz on the student's page, drawn (docs/plans/quizzes-plan.md, slice Q3b;
   the board's "Taking It on a Phone"). State in, HTML out: s/quiz.js draws
   it on the student's page and teacher/preview-student.js draws it inside
   Preview as Student's device, so the two cannot differ.

   One scrolling page, numbered in the student's own order, with a count of
   what is left, each answer a control from s/question-kinds.js; a quiet line
   says whether the answers are saved; Send asks first (Ready to Send, or the
   questions not answered, whose primary button is up in the page and never
   where the Send that opened it was); then Sent, and Try Again when the quiz
   allows another. The key is not here: a model has no right answer, so
   nothing drawn shows one, and nothing is graded or said to be right.

   Every text reaches the page through esc (shared/html.js). Names start
   sp-quiz- (s/quiz.css). What is out of sight at rest is `hidden`, and the
   stylesheet makes that win. */
var StudentQuizView = (function () {
  'use strict';

  /**
   * @typedef {{ kind: string, at: number }} Status
   * @typedef {{ mode: string, course?: string, title: string, due?: string, m?: any, answers?: Record<string, any>, status?: Status, message?: string, busy?: boolean, noRetry?: boolean, preview?: boolean, demo?: boolean, back?: any, top?: string }} Ctx
   */

  var M = StudentQuizModel;
  var BACK =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';

  /** @param {number} n @param {string} one @param {string} many */
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /** @param {string} iso */
  function when(iso) {
    var t = iso ? new Date(iso) : null;
    return t && !isNaN(t.getTime())
      ? t.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
  }
  /** @param {string} day a YYYY-MM-DD date */
  function dayOf(day) {
    var t = day ? new Date(day + 'T12:00:00') : null;
    return t && !isNaN(t.getTime()) ? t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';
  }
  /** @param {number} ms */
  function clock(ms) {
    return new Date(ms).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  }

  /** The quiet line under the questions. @param {Status | undefined} s @param {Ctx} c */
  function savedLine(s, c) {
    if (c.preview) return 'This is a preview. Nothing is saved or sent.';
    var k = s ? s.kind : 'idle';
    if (k === 'offline') return 'Saved on this phone. It’ll send when you’re back online.';
    if (k === 'saving') return 'Saving…';
    if (k === 'saved') {
      return 'Saved' + (s && s.at ? ' · ' + clock(s.at) : '') + (c.demo ? '' : ' · You can finish on another phone');
    }
    return 'Your answers save as you go.';
  }

  /** @param {Ctx} c */
  function headHtml(c) {
    return (
      '<header class="sp-quiz-head">' +
      '<button type="button" class="sp-quiz-back" data-act="quiz-back">' +
      BACK +
      '<span>' +
      (c.mode === 'returned' ? 'Back' : 'Assignments') +
      '</span></button>' +
      (c.course || c.due
        ? '<p class="sp-quiz-class">' + esc([c.course, c.due].filter(Boolean).join(' · ')) + '</p>'
        : '') +
      '<h1 class="sp-quiz-title" id="sp-quiz-title" tabindex="-1">' +
      esc(c.title) +
      '</h1></header>'
    );
  }

  /** The state of one card: the line at its top and its tint. @param {any} q @param {Record<string, any>} answers */
  function stateOf(q, answers) {
    return M.isAnswered(q, answers[q.id]);
  }

  /** @param {any} q @param {number} i @param {number} total @param {Record<string, any>} answers */
  function cardHtml(q, i, total, answers) {
    var done = stateOf(q, answers);
    var sub = q.kind === 'choice' && q.multiple ? ' · Pick all that apply' : '';
    return (
      '<section class="sp-quiz-q' +
      (done ? '' : ' sp-quiz-todo') +
      '" data-qbox="' +
      esc(q.id) +
      '" data-pos="' +
      (i + 1) +
      '"><div class="sp-quiz-qn"><span>Question ' +
      (i + 1) +
      ' of ' +
      total +
      esc(sub) +
      '</span><span class="sp-quiz-st" aria-live="off">' +
      (done ? 'Answered' : 'Not Answered') +
      '</span></div>' +
      StudentQuestionKinds.quizBody(q, answers[q.id]) +
      '</section>'
    );
  }

  /** @param {Ctx} c */
  function takeHtml(c) {
    var m = c.m;
    var answers = c.answers || {};
    var n = M.counts(m, answers);
    var one = n.total === 1;
    return (
      headHtml(c) +
      (one
        ? ''
        : '<div class="sp-quiz-progress"><div class="sp-quiz-progress-text"><span class="sp-quiz-count" id="sp-quiz-count" aria-live="off">' +
          countLine(n) +
          '</span><div class="sp-quiz-bar" aria-hidden="true"><i id="sp-quiz-bar-fill" style="width:' +
          barWidth(n) +
          '%"></i></div></div><button type="button" class="sp-quiz-link" id="sp-quiz-next" data-act="quiz-next"' +
          (n.left ? '' : ' hidden') +
          '>Next Unanswered</button></div>') +
      '<div class="sp-quiz-list">' +
      m.questions
        .map(function (/** @type {any} */ q, /** @type {number} */ i) {
          return cardHtml(q, i, n.total, answers);
        })
        .join('') +
      '</div>' +
      '<div class="sp-quiz-foot">' +
      '<p class="sp-quiz-saved" id="sp-quiz-saved" aria-live="off">' +
      esc(savedLine(c.status, c)) +
      '</p>' +
      (c.message
        ? '<p class="sp-quiz-msg" id="sp-quiz-msg" role="alert" tabindex="-1">' + esc(c.message) + '</p>'
        : '') +
      '<button type="button" class="sp-quiz-btn sp-quiz-primary" data-act="quiz-send-ask"' +
      (c.busy ? ' disabled' : '') +
      '>' +
      (one ? 'Send Answer' : 'Send Answers') +
      '</button></div>'
    );
  }

  /** @param {{ total: number, done: number }} n */
  function countLine(n) {
    return n.done + ' of ' + n.total + ' answered';
  }
  /** The bar's width, as a share of the questions. @param {{ total: number, done: number }} n */
  function barWidth(n) {
    return n.total ? String(Math.floor((100 * n.done) / n.total)) : '0';
  }

  /** What a try may do after Send, in a sentence. @param {any} m */
  function triesNote(m) {
    if (m.tries === 1) return 'You get one try. After you send, your teacher can reopen it if you need to finish.';
    if (m.tries === 0) return 'You can try this quiz again after you send.';
    var left = m.triesLeft == null ? 0 : m.triesLeft;
    return left > 0
      ? 'This quiz allows ' + m.tries + ' tries. After you send, you have ' + plural(left, 'try', 'tries') + ' left.'
      : 'This is your last try. After you send, your teacher can reopen it if you need to finish.';
  }

  /** @param {Ctx} c */
  function checkHtml(c) {
    var m = c.m;
    var n = M.counts(m, c.answers || {});
    var left = n.left;
    var primary = left
      ? '<button type="button" class="sp-quiz-btn sp-quiz-primary" data-act="quiz-back-to-questions">Go Back and Answer</button>' +
        '<button type="button" class="sp-quiz-btn sp-quiz-quiet" data-act="quiz-send"' +
        (c.busy ? ' disabled' : '') +
        '>Send Anyway</button>'
      : '<button type="button" class="sp-quiz-btn sp-quiz-primary" data-act="quiz-send"' +
        (c.busy ? ' disabled' : '') +
        '>' +
        (n.total === 1 ? 'Send Answer' : 'Send Answers') +
        '</button><button type="button" class="sp-quiz-btn sp-quiz-quiet" data-act="quiz-back-to-questions">Go Back</button>';
    return (
      headHtml(Object.assign({}, c, { title: left ? 'Send Your Answers?' : 'Ready to Send', due: '' })) +
      '<div class="sp-quiz-body"><section class="sp-quiz-card">' +
      '<p class="sp-quiz-lead">' +
      esc(
        left
          ? 'You haven’t answered ' + plural(left, 'question', 'questions') + '.'
          : n.total === 1
            ? 'Your question is answered.'
            : 'Every question is answered.',
      ) +
      '</p><div class="sp-quiz-actions">' +
      primary +
      '</div>' +
      (c.message
        ? '<p class="sp-quiz-msg" id="sp-quiz-msg" role="alert" tabindex="-1">' + esc(c.message) + '</p>'
        : '') +
      (left
        ? '<div class="sp-quiz-todo-list">' +
          n.unanswered
            .map(function (p) {
              return (
                '<button type="button" class="sp-quiz-link" data-act="quiz-jump" data-pos="' +
                p +
                '">Question ' +
                p +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '<p class="sp-quiz-note">' +
      esc(triesNote(m)) +
      '</p></section></div>'
    );
  }

  /** Your answers, read only: for a try that is sent or closed. @param {any} m @param {Record<string, any>} answers */
  function mineHtml(m, answers) {
    if (!m.questions.length) return '';
    return (
      '<section class="sp-quiz-card sp-quiz-mine"><h2 class="sp-quiz-h2">Your Answers</h2><ol class="sp-quiz-answers">' +
      m.questions
        .map(function (/** @type {any} */ q) {
          var said = M.describe(q, answers[q.id]);
          return (
            '<li><span class="sp-quiz-ans-q">' +
            esc(q.prompt) +
            '</span><span class="sp-quiz-ans-a' +
            (said ? '' : ' sp-quiz-none') +
            '">' +
            esc(said || 'Not Answered') +
            '</span></li>'
          );
        })
        .join('') +
      '</ol></section>'
    );
  }

  /** @param {Ctx} c */
  function sentHtml(c) {
    var m = c.m;
    var n = M.counts(m, c.answers || {});
    var at = when(m.sentAt);
    return (
      headHtml(c) +
      '<div class="sp-quiz-body"><section class="sp-quiz-card"><h2 class="sp-quiz-h2" id="sp-quiz-sent" tabindex="-1">Sent</h2>' +
      '<p class="sp-quiz-line">' +
      esc(
        (at ? at + '. ' : '') +
          (n.left
            ? 'You answered ' + n.done + ' of ' + n.total + ' questions.'
            : n.total === 1
              ? 'Your question was answered.'
              : 'All ' + n.total + ' questions answered.') +
          ' Your teacher returns it with your result.',
      ) +
      '</p>' +
      (m.closed
        ? '<p class="sp-quiz-line">' +
          esc(dayOf(m.closesOn) ? 'This quiz closed on ' + dayOf(m.closesOn) + '.' : 'This quiz is closed.') +
          '</p>'
        : '') +
      (m.canTryAgain
        ? '<p class="sp-quiz-line">' +
          esc(
            (m.tries === 0 ? 'This quiz lets you try again.' : 'This quiz allows ' + m.tries + ' tries.') +
              ' A new try starts with no answers.',
          ) +
          '</p>'
        : '') +
      (c.message
        ? '<p class="sp-quiz-msg" id="sp-quiz-msg" role="alert" tabindex="-1">' + esc(c.message) + '</p>'
        : '') +
      '</section>' +
      mineHtml(m, c.answers || {}) +
      '</div>' +
      (m.canTryAgain
        ? '<div class="sp-quiz-foot"><button type="button" class="sp-quiz-btn sp-quiz-primary" data-act="quiz-again"' +
          (c.busy ? ' disabled' : '') +
          '>' +
          (c.busy ? 'Starting…' : m.triesLeft == null ? 'Try Again' : 'Try Again (' + m.triesLeft + ' Left)') +
          '</button></div>'
        : '')
    );
  }

  /** @param {Ctx} c */
  function closedHtml(c) {
    var m = c.m;
    var n = M.counts(m, c.answers || {});
    var on = dayOf(m.closesOn);
    return (
      headHtml(c) +
      '<div class="sp-quiz-body"><section class="sp-quiz-card"><h2 class="sp-quiz-h2" id="sp-quiz-closed">' +
      esc(on ? 'This Quiz Closed on ' + on : 'This Quiz Is Closed') +
      '</h2><p class="sp-quiz-line">' +
      esc(
        n.done
          ? 'You answered ' +
              n.done +
              ' of ' +
              n.total +
              ' before it closed, and they are saved. Ask your teacher to reopen it so you can finish and send.'
          : m.tryNumber > 0
            ? 'You didn’t answer any questions before it closed. Ask your teacher to reopen it.'
            : 'You didn’t start it before it closed. Ask your teacher to reopen it.',
      ) +
      '</p></section>' +
      (m.tryNumber > 0 ? mineHtml(m, c.answers || {}) : '') +
      '</div>'
    );
  }

  /** @param {Ctx} c */
  function resumeHtml(c) {
    var n = M.counts(c.m, c.answers || {});
    return (
      headHtml(c) +
      '<div class="sp-quiz-body"><section class="sp-quiz-card"><h2 class="sp-quiz-h2" id="sp-quiz-resume">Pick Up Where You Left Off</h2>' +
      '<p class="sp-quiz-line">' +
      esc(
        n.done +
          ' of ' +
          n.total +
          ' answered. Your answers are kept with your class, so any phone you sign in on with your card has them.',
      ) +
      '</p></section></div>' +
      '<div class="sp-quiz-foot"><button type="button" class="sp-quiz-btn sp-quiz-primary" data-act="quiz-carry-on">Carry On at Question ' +
      n.next +
      '</button></div>'
    );
  }

  /* ── When it comes back (quiz-result, slice Q5b; the board's "When It Comes Back") ──
     The result and the teacher's comment are the page's own Your Result
     (s/page-view.js, drawn from calc.js's words), handed in as `top`: nothing here
     works out or formats a grade. Under it, with Look Again, the student's own
     numbering, each question marked with a word and a mark (never colour alone),
     the right answer and the "why" line only where the quiz shows them. "Grade
     Only" stops after the comment. */
  var MARKS = {
    right: { word: 'Right', mark: '✓', cls: 'y' },
    partly: { word: 'Partly Right', mark: '½', cls: 'p' },
    wrong: { word: 'Not Right', mark: '✗', cls: 'n' },
    waiting: { word: 'Not Assessed Yet', mark: '…', cls: 't' },
  };

  /** The first question that is not right, or 0. @param {any[]} questions */
  function firstMissed(questions) {
    for (var i = 0; i < questions.length; i++) {
      var r = questions[i].result;
      if (r === 'wrong' || r === 'partly') return questions[i].number;
    }
    return 0;
  }

  /** @param {any} q */
  function returnedAnswerHtml(q) {
    var k = q.result ? MARKS[q.result] : null;
    var said = M.describe(q, q.yours);
    var lines = '';
    var mineWords = q.kind === 'choice' || q.kind === 'true_false' ? 'You chose: ' : 'Your answer: ';
    lines += said
      ? '<p class="sp-quiz-ra-yours">' + esc(mineWords + said) + '</p>'
      : '<p class="sp-quiz-ra-yours">' + esc('You didn’t answer this question.') + '</p>';
    if (q.result !== 'right') {
      var right = q.answer === undefined ? '' : M.describe(q, q.answer);
      if (right) lines += '<p class="sp-quiz-ra-key">' + esc('Right answer: ' + right) + '</p>';
      if (q.why) lines += '<p class="sp-quiz-ra-why">' + esc(q.why) + '</p>';
    }
    return (
      '<li class="sp-quiz-ra' +
      (k ? ' sp-quiz-ra-is-' + k.cls : '') +
      '" data-pos="' +
      q.number +
      '" tabindex="-1"><span class="sp-quiz-mk' +
      (k ? ' sp-quiz-mk-' + k.cls : ' sp-quiz-mk-none') +
      '" aria-hidden="true">' +
      (k ? k.mark : '') +
      '</span><div class="sp-quiz-ra-body"><p class="sp-quiz-ra-q"><span class="sp-quiz-ra-n">Question ' +
      q.number +
      (k ? ' · ' + esc(k.word) : '') +
      '</span> ' +
      esc(q.prompt) +
      '</p>' +
      lines +
      '</div></li>'
    );
  }

  /** @param {Ctx} c */
  function returnedHtml(c) {
    var b = c.back;
    var missed = b.shows === 'grade' ? 0 : firstMissed(b.questions);
    return (
      headHtml(c) +
      '<div class="sp-quiz-body sp-quiz-returned">' +
      (c.top ? '<div class="sp-quiz-top">' + c.top + '</div>' : '') +
      (b.total
        ? '<section class="sp-quiz-card sp-quiz-totalcard"><h2 class="sp-quiz-h2" id="sp-quiz-total-h">Your Total</h2><p class="sp-quiz-total">' +
          esc(M.figure(b.total.earned) + ' of ' + M.figure(b.total.possible)) +
          '</p></section>'
        : '') +
      (b.shows === 'grade'
        ? '<p class="sp-quiz-line sp-quiz-gradeonly">Your teacher shows your result and comment for this quiz.</p>'
        : (missed
            ? '<button type="button" class="sp-quiz-link sp-quiz-look" data-act="quiz-look" data-pos="' +
              missed +
              '">Look Again at Question ' +
              missed +
              '</button>'
            : '') +
          (b.questions.length
            ? '<section class="sp-quiz-card sp-quiz-mine"><h2 class="sp-quiz-h2" id="sp-quiz-returned">Your Answers</h2><ol class="sp-quiz-answers sp-quiz-ras">' +
              b.questions.map(returnedAnswerHtml).join('') +
              '</ol></section>'
            : '')) +
      '</div>'
    );
  }

  /** @param {Ctx} c @param {string} title @param {string} line @param {boolean} again */
  function plainHtml(c, title, line, again) {
    return (
      headHtml(Object.assign({}, c, { title: title })) +
      '<div class="sp-quiz-body"><section class="sp-quiz-card"><p class="sp-quiz-line" role="status">' +
      esc(line) +
      '</p>' +
      (again
        ? '<div class="sp-quiz-actions"><button type="button" class="sp-quiz-btn sp-quiz-primary" data-act="quiz-retry"' +
          (c.busy ? ' disabled' : '') +
          '>Try Again</button></div>'
        : '') +
      '</section></div>'
    );
  }

  /** The screen: the quiz's own root, everything inside it. @param {Ctx} c */
  function html(c) {
    var inner;
    if (c.mode === 'returned' && c.back) inner = returnedHtml(c);
    else if (c.mode === 'loading') inner = plainHtml(c, c.title, 'Opening your quiz…', false);
    else if (c.mode === 'failed') {
      inner = plainHtml(
        c,
        c.title,
        c.message || 'Couldn’t reach FullVision. Check your internet and try again.',
        !c.noRetry,
      );
    } else if (!c.m) inner = plainHtml(c, c.title, 'This quiz can’t open right now. Ask your teacher.', false);
    else if (c.mode === 'check') inner = checkHtml(c);
    else if (c.mode === 'resume') inner = resumeHtml(c);
    else if (c.mode === 'sent') inner = sentHtml(c);
    else if (c.mode === 'closed') inner = closedHtml(c);
    else inner = takeHtml(c);
    return (
      '<div class="sp-quiz sp-quiz-' +
      esc(c.mode) +
      '" data-quiz-mode="' +
      esc(c.mode) +
      '">' +
      inner +
      (c.demo ? '<p class="sp-quiz-fine">This is Demo Mode. Nothing is sent anywhere.</p>' : '') +
      '</div>'
    );
  }

  /* ── In place, so a box being typed in is never drawn again ── */

  /** The count, the bar, Next Unanswered, each card's state and the quiet line, brought up to date. @param {ParentNode} root @param {Ctx} c */
  function refresh(root, c) {
    if (!root || !c.m) return;
    var answers = c.answers || {};
    var n = M.counts(c.m, answers);
    var count = root.querySelector('#sp-quiz-count');
    if (count) count.textContent = countLine(n);
    var bar = /** @type {HTMLElement | null} */ (root.querySelector('#sp-quiz-bar-fill'));
    if (bar) bar.style.width = barWidth(n) + '%';
    var next = /** @type {HTMLElement | null} */ (root.querySelector('#sp-quiz-next'));
    if (next) next.hidden = !n.left;
    c.m.questions.forEach(function (/** @type {any} */ q) {
      var card = root.querySelector('[data-qbox="' + String(q.id).replace(/["\\]/g, '') + '"]');
      if (!card) return;
      var done = stateOf(q, answers);
      card.classList.toggle('sp-quiz-todo', !done);
      var st = card.querySelector('.sp-quiz-st');
      if (st) st.textContent = done ? 'Answered' : 'Not Answered';
    });
    var saved = root.querySelector('#sp-quiz-saved');
    if (saved) saved.textContent = savedLine(c.status, c);
  }

  /** Choice buttons on one question set to an answer. @param {ParentNode} root @param {any} q @param {unknown} v */
  function setChoices(root, q, v) {
    var card = root.querySelector('[data-qbox="' + String(q.id).replace(/["\\]/g, '') + '"]');
    if (!card) return;
    Array.prototype.forEach.call(card.querySelectorAll('[data-act="quiz-pick"]'), function (/** @type {Element} */ b) {
      var id = b.getAttribute('data-value') || '';
      var on =
        q.kind === 'true_false' ? (id === 'true' ? v === true : v === false) : Array.isArray(v) && v.indexOf(id) >= 0;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      // One Tab stop for a set of radios, as student.js keeps it: the chosen one, or the first.
      if (!q.multiple) b.setAttribute('tabindex', on ? '0' : '-1');
    });
    if (!q.multiple && !Array.prototype.some.call(card.querySelectorAll('[role="radio"]'), isOn)) {
      var first = card.querySelector('[role="radio"]');
      if (first) first.setAttribute('tabindex', '0');
    }
  }
  /** @param {Element} b */
  function isOn(b) {
    return b.getAttribute('aria-checked') === 'true';
  }

  /** The question a press or a box belongs to. @param {any} m @param {Element | null} el */
  function questionOf(m, el) {
    var id = el && el.getAttribute ? el.getAttribute('data-q') : '';
    return (
      (m && id
        ? m.questions.filter(function (/** @type {any} */ q) {
            return q.id === id;
          })[0]
        : null) || null
    );
  }

  /**
   * A choice pressed: the question and the answer it makes, or null.
   * @param {any} m @param {Record<string, any>} answers @param {Element} el
   * @returns {{ q: any, value: any } | null}
   */
  function pressed(m, answers, el) {
    var q = questionOf(m, el);
    var v = (el.getAttribute('data-value') || '').slice(0, 80);
    if (!q || !v) return null;
    if (q.kind === 'true_false') return v === 'true' || v === 'false' ? { q: q, value: v === 'true' } : null;
    if (q.kind !== 'choice') return null;
    var ok = (q.choices || []).some(function (/** @type {any} */ c) {
      return c.id === v;
    });
    return ok ? { q: q, value: M.choiceNext(q, answers[q.id], v) } : null;
  }

  /**
   * A box typed in: the question, the answer to keep (null clears), and a hint for a number that
   * is not one. @param {any} m @param {Element} el
   * @returns {{ q: any, value: any, hint: string } | null}
   */
  function typed(m, el) {
    var q = questionOf(m, el);
    var raw = /** @type {HTMLInputElement} */ (el).value;
    if (!q) return null;
    if (q.kind === 'text') return { q: q, value: M.textValue(raw), hint: '' };
    if (q.kind === 'number') {
      var r = M.parseNumber(raw);
      return r.ok ? { q: q, value: r.value, hint: '' } : { q: q, value: null, hint: 'Type a number, like 3.5.' };
    }
    return null;
  }

  return {
    html: html,
    refresh: refresh,
    setChoices: setChoices,
    pressed: pressed,
    typed: typed,
    savedLine: savedLine,
    dayOf: dayOf,
    questionOf: questionOf,
  };
})();
