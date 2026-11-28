// @ts-check
/* dash-inbox-questions.js — a student's question, waiting, as one line in the
   Inbox above the stacks (Colin, Nov 26 2026: the Questions From Students card
   "is ugly … replies to student comments should really live somewhere else,
   less intrusive"; board E2). "Jordan Kim asked on Cell Microscope Lab: “How
   do I know …” [Answer]": the whole line and its button open the grader (the
   app's grey button, so it reads as something to press). Oldest first, two at most, then "+ 2 More" which
   opens the next. Answer opens the grader on that student's piece, as the card
   did (dashAnswerQuestion). The questions are this class's
   getQuestionsWaiting: the list the gradebook's dot and the Learner Profile
   read, so one answer clears all three. The Questions From Students card
   (DashOverview) and the To Grade card's "1 Question" read them here too. */
window.DashInboxQuestions = (function () {
  'use strict';

  /** The class's questions not answered yet: none where its student page or
   * Reflect on Feedback is off. @param {string} cid @returns {any[]} */
  function questionsIn(cid) {
    if (typeof getReflectOnFeedback !== 'function' || !getReflectOnFeedback(cid)) return [];
    return getQuestionsWaiting(cid);
  }

  /** The question waiting: a follow-up after an answer, or the first one. @param {any} r */
  function waitingWords(r) {
    var follow = !!(r.follow_up && !r.follow_up_answer);
    return {
      text: follow ? r.follow_up : r.question,
      at: follow ? r.sense_now_at || r.sent_at : r.sent_at,
    };
  }

  /** This class's questions waiting, oldest first: { st, a, text, at }.
   * @param {string} cid */
  function rows(cid) {
    /** @type {Record<string, any>} */
    var students = {};
    (getStudents(cid) || []).forEach(function (/** @type {any} */ s) {
      students[s.id] = s;
    });
    /** @type {Record<string, any>} */
    var pieces = {};
    (getAssignedAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (a && a.id) pieces[a.id] = a;
    });
    /** @type {any[]} */
    var out = [];
    questionsIn(cid).forEach(function (/** @type {any} */ r) {
      var w = waitingWords(r);
      var st = students[r.enrollment_id];
      var a = pieces[r.assessment_id];
      if (st && a && w.text) out.push({ st: st, a: a, text: w.text, at: String(w.at || '') });
    });
    return out.sort(function (x, y) {
      return x.at < y.at ? -1 : x.at > y.at ? 1 : 0;
    });
  }

  /** The lines, '' with none waiting. @param {string} cid */
  // html-safe: names, titles and the student's words esc()'d; ids esc()'d
  function html(cid) {
    var list = rows(cid);
    if (!list.length) return '';
    /** @param {any} row */
    var btn = function (row, label, cls) {
      return (
        '<button type="button" class="' +
        cls +
        '" data-action="dashAnswerQuestion" data-cid="' +
        esc(cid) +
        '" data-aid="' +
        esc(row.a.id) +
        '" data-sid="' +
        esc(row.st.id) +
        '">' +
        label +
        '</button>'
      );
    };
    var lines = list.slice(0, 2).map(function (row) {
      var name = displayNameWithLast(row.st);
      return (
        '<div class="dash-inbox-q" data-action="dashAnswerQuestion" data-cid="' +
        esc(cid) +
        '" data-aid="' +
        esc(row.a.id) +
        '" data-sid="' +
        esc(row.st.id) +
        '"><span class="dash-inbox-q-text"><b>' +
        esc(name) +
        '</b> asked on ' +
        esc(row.a.title) +
        ': “' +
        esc(row.text) +
        '”</span>' +
        btn(row, 'Answer', 'btn btn-ghost dash-inbox-q-answer') +
        '</div>'
      );
    });
    var more = list.length - 2;
    if (more > 0)
      lines.push(btn(list[2], '+ ' + more + ' More ' + (more === 1 ? 'Question' : 'Questions'), 'dash-inbox-q-more'));
    return '<div class="dash-inbox-qs" aria-label="Questions from students">' + lines.join('') + '</div>';
  }

  /** Whether the Inbox steps back to one line: nothing to grade or return,
   * and no question waiting. @param {any} view @param {any} queue @param {string} cid @param {boolean} targets */
  function quiet(view, queue, cid, targets) {
    var caughtUp = queue.on && queue.caughtUp && !(queue.returns && queue.returns.length);
    return !!(view.key === 'stacks' && caughtUp && targets && !rows(cid).length);
  }

  /** The height one closed row of stacks has: the tile's share of the column
   * (60% beside Bulletins, 70% with a question waiting) less its head and a stack's layers, title and gap,
   * and less any question lines above the stacks. @param {HTMLElement} el the stacks */
  function stackRoom(el) {
    var col = /** @type {HTMLElement} */ (el.closest('.dash-row-left') || el);
    var q = /** @type {HTMLElement | null} */ (el.previousElementSibling);
    var part = col.classList.contains('has-bulletins') ? (q ? 0.7 : 0.6) : 1; // 70% with a question line (the CSS says so too)
    var share = (col.clientHeight - 12) * part;
    return share - 192 - (q ? q.offsetHeight + 10 : 0);
  }

  return {
    html: html,
    rows: rows,
    questionsIn: questionsIn,
    waitingWords: waitingWords,
    quiet: quiet,
    stackRoom: stackRoom,
  };
})();
