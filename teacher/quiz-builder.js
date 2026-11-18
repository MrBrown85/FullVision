// @ts-check
/* The Quiz card on the assessment form (docs/plans/quizzes-plan.md, slice
   Q2b; board "Quizzes Artboard", Board 1).

   On the Student Work card, "They Answer a Quiz" is the fourth answer,
   offered wherever the class's student page is on (shared/data-quizzes.js,
   quizzesOffered). Where Send Work is off the page draws no Student Work card,
   so this module draws a small one of its own with No and They Answer a Quiz.
   Under it, the Quiz card: the questions (Choice, True or False, Number,
   Text), each with its right answer, points and one of the piece's
   competencies; Evidence by Competency; Quiz Settings; Preview as a Student.

   A quiz is its own record, keyed by the assessment: the piece's Students Send
   stays Nothing. teacher/page-assignments.js asks this module five things
   (answers, chosen, takeAnswer, mountHtml, formOk) and saves through it
   (save), after the assessment is saved, as it saves Student Work.

   The card is drawn from teacher/question-cards.js's pieces (the kinds' names,
   the question-type picker, Copy, Move and Delete, a question as students see
   it) with state and a save of its own. Reflect's builder is not touched.

   Nothing here computes a grade or writes a score. Text reaches the HTML only
   through esc. Dark until the quizzes build switch is on. */
var QuizBuilder = (function () {
  'use strict';

  var MIN_FOR_SUGGESTION = 3; // the plan's decision 4: fewer than three questions on a competency suggests no level
  var ACT = { type: 'quizType', copy: 'quizCopy', up: 'quizUp', down: 'quizDown', del: 'quizDelete' };

  /* The quiz's kinds. Choice and Text take their names from the shared list. */
  function _kinds() {
    var shared = (typeof QuestionCards !== 'undefined' && QuestionCards.KINDS) || [];
    var name = function (/** @type {string} */ kind, /** @type {string} */ fallback) {
      var k = shared.find(function (/** @type {{ kind: string }} */ x) {
        return x.kind === kind;
      });
      return k ? k.label : fallback;
    };
    return [
      { kind: 'choice', label: name('choice', 'Choice') },
      { kind: 'true_false', label: 'True or False' },
      { kind: 'number', label: 'Number' },
      { kind: 'text', label: name('text', 'Text') },
    ];
  }

  /** @type {any} */
  var S = null; // the open form's quiz: see _fresh
  /** @type {(() => void) | null} */
  var _redrawPage = null; // the page's redraw of its Student Work card
  /** @type {any} */
  var _pageTools = null; // the page's own drawing of "Can Students Send After …?" and its Until day
  /** @type {Document | null} */
  var _wired = null; // the document the card's listeners are on

  function _on() {
    return typeof BuildFlags !== 'undefined' && BuildFlags.on('quizzes');
  }
  function _data() {
    return /** @type {any} */ (window).QuizData || null;
  }
  /** @param {string} cid */
  function _offered(cid) {
    var d = _data();
    return _on() && !!d && d.offered(cid);
  }
  /** @param {string} id */
  function $(id) {
    return document.getElementById(id);
  }
  /** @param {number} n @param {string} one @param {string} many */
  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* ── The model ─────────────────────────────────────────────────────────── */

  /** @param {string} cid @param {any} assess */
  function _fresh(cid, assess) {
    var d = _data();
    return {
      cid: cid,
      aid: assess ? assess.id : null,
      isNew: !assess,
      picked: false,
      existed: false,
      loading: false,
      base: '',
      // A new quiz closes on the due date (the board); a saved one keeps its own.
      settings: d ? Object.assign(d.defaults(), { after_due: 'stop' }) : {},
      qs: [],
      open: null,
      tried: false,
      msg: '',
      preview: false,
      seq: 0,
      dropOk: false,
      sig: '',
    };
  }

  /** @param {string} [kind] */
  function _newQ(kind) {
    S.seq += 1;
    var q = {
      k: 'n' + S.seq,
      id: null,
      kind: kind || 'choice',
      prompt: '',
      choices: [],
      multiple: false,
      points: '1',
      tag: _thinnest(),
      answer: null,
      within: '',
      why: '',
      answered: false,
      left: false,
    };
    _shapeFor(q);
    return q;
  }

  /* A question's fields made right for its kind; what still fits is kept. */
  /** @param {any} q */
  function _shapeFor(q) {
    if (q.kind === 'choice') {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        q.choices = (q.choices || [])
          .concat([
            { id: _data().newId(), text: '' },
            { id: _data().newId(), text: '' },
          ])
          .slice(0, 2);
      }
      if (!Array.isArray(q.answer)) q.answer = [];
    } else {
      q.multiple = false;
      if (q.kind === 'true_false') q.answer = q.answer === true || q.answer === false ? q.answer : null;
      else if (q.kind === 'number') q.answer = typeof q.answer === 'string' ? q.answer : '';
      else q.answer = null;
    }
    if (q.kind !== 'number') q.within = '';
  }

  /* From list_quiz's shape (or a save's payload) to the card's. */
  /** @param {any} reply */
  function _fromReply(reply) {
    var quiz = reply && reply.quiz;
    var qs = (reply && Array.isArray(reply.questions) ? reply.questions : []).map(function (/** @type {any} */ r) {
      S.seq += 1;
      var key = r.key || {};
      var answer = key.answer;
      if (r.kind === 'number') answer = typeof answer === 'number' ? String(answer) : '';
      if (r.kind === 'choice') answer = Array.isArray(answer) ? answer.slice() : [];
      if (r.kind === 'true_false') answer = answer === true || answer === false ? answer : null;
      return {
        k: 'n' + S.seq,
        id: r.id || null,
        kind: r.kind,
        prompt: r.prompt || '',
        choices: (r.choices || []).map(function (/** @type {any} */ c) {
          return { id: c.id, text: c.text || '' };
        }),
        multiple: r.multiple === true,
        points: String(r.points == null ? 1 : r.points),
        tag: r.tag_id || null,
        answer: r.kind === 'text' ? null : answer,
        within: r.kind === 'number' && key.tolerance != null ? String(key.tolerance) : '',
        why: key.why || '',
        answered: r.answered === true,
        left: false,
      };
    });
    var settings = Object.assign({}, _data().defaults());
    if (quiz) {
      Object.keys(settings).forEach(function (k) {
        if (k in quiz) settings[k] = quiz[k];
      });
    }
    return { settings: settings, qs: qs };
  }

  /* A save's payload (p_quiz) back to list_quiz's shape, for a kept unsent save. */
  /** @param {any} p */
  function _payloadAsReply(p) {
    var quiz = Object.assign({}, p);
    delete quiz.questions;
    return {
      quiz: quiz,
      questions: (p.questions || []).map(function (/** @type {any} */ q) {
        return Object.assign({}, q, { key: q.key || {} });
      }),
    };
  }

  /* What the card holds, without its own bookkeeping: what Cancel and Save compare. */
  function _state() {
    if (!S) return '';
    return JSON.stringify({
      picked: S.picked,
      settings: S.picked ? S.settings : null,
      qs: S.picked
        ? S.qs.map(function (/** @type {any} */ q) {
            return [q.id, q.kind, q.prompt, q.choices, q.multiple, q.points, q.tag, q.answer, q.within, q.why];
          })
        : null,
    });
  }

  /* ── What the form says ────────────────────────────────────────────────── */

  // 'competencies', 'points', 'proficiency' (Rubric), 'complete' or 'dibels'.
  function _mode() {
    if (S && S.firstPass) return S.startMode;
    var el = /** @type {HTMLInputElement | null} */ ($('af-scoremode'));
    return (el && el.value) || 'proficiency';
  }
  // The form's due date, 'YYYY-MM-DD' or ''.
  function _due() {
    if (S && S.firstPass) return S.startDue;
    var el = /** @type {HTMLInputElement | null} */ ($('af-due'));
    return (el && el.value) || '';
  }
  /* A Last Day that is a real date. */
  function _untilOk() {
    return S.settings.after_due !== 'until' || /^\d{4}-\d{2}-\d{2}$/.test(String(S.settings.accept_until || ''));
  }
  /* Can Students Send After …?, drawn by the page's own Student Work row. '' with no due date, as there. */
  function _afterDueRow() {
    var due = _due();
    if (!due || !_pageTools) return '';
    var until = S.settings.accept_until || _pageTools.untilDefault(S.cid);
    return _pageTools.afterDueRow(due, S.settings.after_due, until, {
      field: 'quiz_after_due',
      action: 'quizAfterDue',
      change: 'quizAfterDueUntil',
      dateId: 'quiz-accept-until',
    });
  }
  function _collab() {
    if (S && S.firstPass) return S.startCollab;
    var on = document.querySelector('.af-collab-btn.active');
    return (on && /** @type {HTMLElement} */ (on).dataset.collab) || 'individual';
  }
  /* The piece's competencies as ticked on the form, in the form's order. */
  function _tags() {
    var cid = S ? S.cid : '';
    // While the form is still a string, the piece's own competencies.
    var ids =
      S && S.firstPass
        ? S.startTags
        : Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(function (cb) {
            return /** @type {HTMLInputElement} */ (cb).value;
          });
    return ids.map(function (/** @type {string} */ id) {
      var tag = typeof getTagById === 'function' ? getTagById(cid, id) : null;
      return { id: id, code: (tag && tag.code) || '', name: (tag && (tag.label || tag.name)) || id };
    });
  }
  /** @param {string | null} tag */
  function _tagOn(tag) {
    return (
      !!tag &&
      _tags().some(function (t) {
        return t.id === tag;
      })
    );
  }
  /* The competency with the fewest questions: where a new question starts (Board 6). */
  function _thinnest() {
    /** @type {string | null} */
    var best = null;
    var n = Infinity;
    _tags().forEach(function (t) {
      var k = S.qs.filter(function (/** @type {any} */ q) {
        return q.tag === t.id;
      }).length;
      if (k < n) {
        n = k;
        best = t.id;
      }
    });
    return best;
  }
  // The scoring a new quiz starts on: Points in a Letter class, else Competencies (decision 2).
  function _startMode() {
    var letter = typeof courseGradeMode === 'function' && courseGradeMode(S.cid) === 'letter';
    var hasComps = typeof getSections === 'function' && getSections(S.cid).length > 0;
    return letter || !hasComps ? 'points' : 'competencies';
  }
  function _scoringOk() {
    var m = _mode();
    return m === 'competencies' || m === 'points';
  }

  /** @param {any} q */
  function _pts(q) {
    var n = Number(String(q.points).trim());
    return /^\d+$/.test(String(q.points).trim()) ? n : NaN;
  }
  function _total() {
    return S.qs.reduce(function (/** @type {number} */ a, /** @type {any} */ q) {
      var n = _pts(q);
      return a + (isFinite(n) ? n : 0);
    }, 0);
  }

  /* ── Validation: a plain sentence beside what is wrong ────────────────── */

  var NUM_RE = /^-?(\d+(\.\d+)?|\.\d+)$/;

  /** @param {any} q @returns {{ field: string, text: string }[]} */
  function _problems(q) {
    var L = _data().LIMITS;
    var out = [];
    if (!q.prompt.trim()) out.push({ field: 'prompt', text: 'Write the question.' });
    if (q.kind === 'choice') {
      if (
        q.choices.some(function (/** @type {any} */ c) {
          return !c.text.trim();
        })
      ) {
        out.push({ field: 'choices', text: 'Write each choice, or remove the empty one.' });
      }
      if (!q.answer.length) {
        out.push({
          field: 'answer',
          text: q.multiple ? 'Choose the right answers.' : 'Choose the right answer.',
        });
      }
    } else if (q.kind === 'true_false') {
      if (q.answer !== true && q.answer !== false) out.push({ field: 'answer', text: 'Choose True or False.' });
    } else if (q.kind === 'number') {
      var a = String(q.answer).trim();
      if (!a) out.push({ field: 'answer', text: 'Write the right answer.' });
      else if (!NUM_RE.test(a)) out.push({ field: 'answer', text: 'The right answer is a number, like 12.5.' });
      else if (Math.abs(Number(a)) > L.number) {
        out.push({ field: 'answer', text: 'The right answer can be up to 1,000,000,000,000 either way.' });
      }
      var w = String(q.within).trim();
      if (w && (!/^(\d+(\.\d+)?|\.\d+)$/.test(w) || Number(w) > L.number)) {
        out.push({ field: 'within', text: 'Within is a number of 0 or more. Leave it blank for exactly.' });
      }
    }
    var p = _pts(q);
    if (!isFinite(p) || p < 0 || p > L.points) {
      out.push({ field: 'points', text: 'Points are a whole number from 0 to ' + L.points + '.' });
    }
    return out;
  }

  /* What stops the whole quiz saving, as one sentence, or ''. */
  function _quizProblem() {
    if (!S || !S.picked) return '';
    if (_collab() !== 'individual') {
      return 'A quiz is for students working on their own. Choose Individual under Students, or another answer above.';
    }
    if (!_scoringOk()) {
      return 'A quiz is scored by Competencies or Points. Choose one of them under Scoring, or another answer above.';
    }
    if (!S.qs.length) return 'Add a question, or choose another answer above.';
    if (_mode() === 'points') {
      var t = _total();
      if (t <= 0) return 'On Points, give at least one question some points.';
      if (t > 9999) return 'On Points, a quiz can be worth up to 9,999 points in all.';
    }
    return '';
  }

  /* The drawing is teacher/quiz-card-draw.js (QuizCardDraw), made with this module's readers. */
  var D = QuizCardDraw.make({
    state: function () {
      return S;
    },
    kinds: _kinds,
    tags: _tags,
    tagOn: _tagOn,
    mode: _mode,
    collab: _collab,
    scoringOk: _scoringOk,
    problems: _problems,
    quizProblem: _quizProblem,
    total: _total,
    pts: _pts,
    limits: function () {
      return _data().LIMITS;
    },
    act: ACT,
    minForSuggestion: MIN_FOR_SUGGESTION,
    due: _due,
    untilOk: _untilOk,
    afterDueRow: _afterDueRow,
  });

  var _reduce =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Draw the mount again; the questions glide from where they were (FLIP,
     200 ms; none under Reduce Motion). focusSel: what takes focus after. */
  /** @param {string} [focusSel] */
  function _draw(focusSel) {
    var mount = $('quiz-mount');
    if (!mount || !S) return;
    /** @type {Record<string, number>} */
    var before = {};
    mount.querySelectorAll('.quiz-item').forEach(function (li) {
      before[/** @type {HTMLElement} */ (li).dataset.k || ''] = li.getBoundingClientRect().top;
    });
    // html-safe: built by _mountInner
    mount.innerHTML = D.mountInner();
    _syncPoints();
    if (!(_reduce && _reduce.matches)) {
      mount.querySelectorAll('.quiz-item').forEach(function (li) {
        var el = /** @type {HTMLElement} */ (li);
        var t = before[el.dataset.k || ''];
        if (t == null) return;
        var dy = t - el.getBoundingClientRect().top;
        if (!dy) return;
        el.style.transition = 'none';
        el.style.transform = 'translateY(' + dy + 'px)';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            el.style.transition = 'transform 200ms cubic-bezier(.2,.7,.2,1)';
            el.style.transform = '';
          });
        });
      });
    }
    S.sig = _sig();
    if (focusSel) {
      var to = /** @type {HTMLElement | null} */ (mount.querySelector(focusSel));
      if (to) to.focus({ preventScroll: false });
    }
  }

  /* The head and Evidence by Competency follow typing without a redraw. */
  function _drawCounts() {
    var head = $('quiz-head');
    if (head) head.textContent = D.headText();
    var ev = $('quiz-evidence');
    // html-safe: built by _evidenceHtml
    if (ev) ev.innerHTML = D.evidenceHtml();
    _syncPoints();
  }

  /* On Points, the piece's Max Points is the quiz's total while it is a quiz. */
  function _syncPoints() {
    var box = /** @type {HTMLInputElement | null} */ ($('af-maxpoints'));
    if (!box || !S) return;
    var tie = S.picked && _mode() === 'points';
    box.readOnly = tie;
    if (!tie) return;
    var t = String(_total());
    if (box.value !== t) {
      box.value = t;
      var win = box.ownerDocument && box.ownerDocument.defaultView;
      var Ev = (win && /** @type {any} */ (win).Event) || Event;
      box.dispatchEvent(new Ev('input', { bubbles: true }));
    }
  }

  /* ── Acting on the card ────────────────────────────────────────────────── */

  /** @param {string} k */
  function _q(k) {
    return S.qs.find(function (/** @type {any} */ q) {
      return q.k === k;
    });
  }
  /** @param {string} k */
  function _ix(k) {
    return S.qs.findIndex(function (/** @type {any} */ q) {
      return q.k === k;
    });
  }

  /** @param {string} k */
  function _close(k) {
    var q = _q(k);
    if (q) q.left = true;
    if (S.open === k) S.open = null;
  }

  /** @param {string} k */
  function _openQ(k) {
    if (S.open && S.open !== k) _close(S.open);
    S.open = k;
    _draw('.quiz-edit[data-k="' + k + '"] .quiz-prompt');
  }

  function _add() {
    if (S.qs.length >= _data().LIMITS.questions) return;
    if (S.open) _close(S.open);
    var q = _newQ();
    S.qs.push(q);
    S.open = q.k;
    _draw('.quiz-edit[data-k="' + q.k + '"] .quiz-prompt');
  }

  /** @param {any} q */
  function _written(q) {
    return (
      !!q.prompt.trim() ||
      q.answered ||
      (q.kind === 'choice' &&
        (q.answer.length > 0 ||
          q.choices.some(function (/** @type {any} */ c) {
            return c.text.trim();
          }))) ||
      (q.kind === 'true_false' && q.answer != null) ||
      (q.kind === 'number' && String(q.answer).trim() !== '') ||
      !!q.why.trim()
    );
  }

  /** @param {string} k */
  function _delete(k) {
    var i = _ix(k);
    if (i < 0) return;
    S.qs.splice(i, 1);
    if (S.open === k) S.open = null;
    var next = S.qs[i] || S.qs[i - 1];
    _draw(next ? '.quiz-row[data-k="' + next.k + '"]' : '[data-quiz-act="add"]');
  }

  /* A confirm never draws its primary button where the click that opened
     it was: the card moves up out of the way when it would. */
  /** @param {{ x: number, y: number } | null} at */
  function _keepClear(at) {
    if (!at) return;
    var cards = document.querySelectorAll('.confirm-overlay .confirm-card');
    var card = /** @type {HTMLElement | null} */ (cards[cards.length - 1] || null);
    var ok = card && card.querySelector('.confirm-ok');
    if (!card || !ok) return;
    var r = ok.getBoundingClientRect();
    if (at.x >= r.left - 8 && at.x <= r.right + 8 && at.y >= r.top - 8 && at.y <= r.bottom + 8) {
      card.style.transform = 'translateY(' + -Math.ceil(card.getBoundingClientRect().height + 24) + 'px)';
    }
  }

  /** @param {string} k @param {{ x: number, y: number } | null} at */
  function _askDelete(k, at) {
    var q = _q(k);
    if (!q) return;
    if (!_written(q) || typeof showConfirm !== 'function') return _delete(k);
    showConfirm(
      'Delete This Question?',
      'Question ' + (_ix(k) + 1) + ' and its right answer are taken out of the quiz when you save.',
      'Delete Question',
      'danger',
      function () {
        _delete(k);
      },
    );
    _keepClear(at);
  }

  /** @param {string} action @param {HTMLElement} el @param {{ x: number, y: number } | null} at */
  function _act(action, el, at) {
    var k = el.dataset.k || '';
    if (!k && el.dataset.i != null) {
      var byI = S.qs[Number(el.dataset.i)];
      k = byI ? byI.k : '';
    }
    var q = k ? _q(k) : null;
    var i = k ? _ix(k) : -1;
    switch (action) {
      case 'answer':
        return _ownAnswer(String(el.dataset.value || ''));
      case 'add':
        return _add();
      case 'open':
        return _openQ(k);
      case 'done':
        _close(k);
        return _draw('.quiz-row[data-k="' + k + '"]');
      case 'preview':
        if (S.open) _close(S.open);
        S.preview = !S.preview;
        return _draw('[data-quiz-act="preview"]');
      case ACT.copy: {
        if (!q || S.qs.length >= _data().LIMITS.questions) return;
        S.seq += 1;
        var copy = JSON.parse(JSON.stringify(q));
        copy.k = 'n' + S.seq;
        copy.id = null;
        copy.answered = false;
        copy.left = false;
        // A copy's choices are new choices: the answer key follows them by place.
        if (copy.kind === 'choice') {
          var map = /** @type {Record<string, string>} */ ({});
          copy.choices.forEach(function (/** @type {any} */ c) {
            var nid = _data().newId();
            map[c.id] = nid;
            c.id = nid;
          });
          copy.answer = copy.answer.map(function (/** @type {string} */ id) {
            return map[id];
          });
        }
        S.qs.splice(i + 1, 0, copy);
        _close(k);
        S.open = copy.k;
        return _draw('.quiz-edit[data-k="' + copy.k + '"] .quiz-prompt');
      }
      case ACT.up:
      case ACT.down: {
        var to = action === ACT.up ? i - 1 : i + 1;
        if (i < 0 || to < 0 || to >= S.qs.length) return;
        S.qs.splice(to, 0, S.qs.splice(i, 1)[0]);
        var at0 = to === 0;
        var atEnd = to === S.qs.length - 1;
        var same = action === ACT.up ? !at0 : !atEnd;
        return _draw(
          '.quiz-edit[data-k="' +
            k +
            '"] [data-action="' +
            (same ? action : action === ACT.up ? ACT.down : ACT.up) +
            '"]',
        );
      }
      case ACT.del:
        return _askDelete(k, at);
      case 'addChoice':
        if (!q || q.choices.length >= _data().LIMITS.choicesMax) return;
        q.choices.push({ id: _data().newId(), text: '' });
        return _draw('.quiz-edit[data-k="' + k + '"] [data-j="' + (q.choices.length - 1) + '"].quiz-choice-text');
      case 'rmChoice': {
        if (!q || q.choices.length <= _data().LIMITS.choicesMin) return;
        var j = Number(el.dataset.j);
        var gone = q.choices.splice(j, 1)[0];
        q.answer = q.answer.filter(function (/** @type {string} */ id) {
          return id !== gone.id;
        });
        return _draw('.quiz-edit[data-k="' + k + '"] [data-j="' + Math.max(0, j - 1) + '"].quiz-choice-text');
      }
      case 'multiple':
        if (!q || q.answered) return;
        q.multiple = !q.multiple;
        if (!q.multiple) q.answer = q.answer.slice(0, 1);
        return _draw('.quiz-edit[data-k="' + k + '"] [data-quiz-act="multiple"]');
      case 'quizAfterDue': {
        var when = String(el.dataset.value || '');
        if (['keep', 'until', 'stop'].indexOf(when) < 0) return;
        S.settings.after_due = when;
        if (when === 'until' && !S.settings.accept_until && _pageTools) {
          S.settings.accept_until = _pageTools.untilDefault(S.cid);
        }
        return _draw('[data-action="quizAfterDue"][data-value="' + when + '"]');
      }
      case 'toggle': {
        var f = String(el.dataset.quizSet || '');
        if (['shuffle_questions', 'shuffle_choices', 'add_total'].indexOf(f) < 0) return;
        S.settings[f] = !S.settings[f];
        return _draw('[data-quiz-act="toggle"][data-quiz-set="' + f + '"]');
      }
      case 'set': {
        var field = String(el.dataset.quizSet || '');
        var v = String(el.dataset.value || '');
        if (field === 'tries' && ['1', '2', 'u'].indexOf(v) >= 0) S.settings.tries = v === 'u' ? 0 : Number(v);
        else if (field === 'counts' && (v === 'best' || v === 'latest')) S.settings.counts = v;
        else return;
        return _draw('[data-quiz-set="' + field + '"][data-value="' + v + '"]');
      }
    }
  }

  /** @param {HTMLElement} t */
  function _onInput(t) {
    var q = _q(t.dataset.k || '');
    var f = t.dataset.quizF;
    if (!q || !f) return;
    var v = /** @type {HTMLInputElement} */ (t).value;
    if (f === 'prompt' || f === 'why' || f === 'within' || f === 'points') q[f] = v;
    else if (f === 'answer' && q.kind === 'number') q.answer = v;
    else if (f === 'choice') {
      var c = q.choices[Number(t.dataset.j)];
      if (!c) return;
      c.text = v;
      var row = t.closest('.quiz-choice');
      var key = row && row.querySelector('.quiz-key');
      if (key)
        key.setAttribute(
          'aria-label',
          'Right answer: ' + (v.trim() || 'Choice ' + String.fromCharCode(65 + Number(t.dataset.j))),
        );
    }
    if (f === 'points') _drawCounts();
    if (q.kind === 'number' && (f === 'answer' || f === 'within')) {
      var line = $('quiz-range-' + q.k);
      if (line) {
        var tmp = document.createElement('div');
        // html-safe: built by _numberEditor, which escapes the numbers
        tmp.innerHTML = D.numberEditor(q);
        var fresh = tmp.querySelector('.quiz-range');
        line.textContent = fresh ? fresh.textContent : '';
      }
    }
  }

  /* A new type redraws the open question under its bar only: the type picker
     keeps the focus and its type-to-find, so "Te" reaches Text past True or False. */
  /** @param {string} k */
  function _redrawBelowBar(k) {
    var mount = $('quiz-mount');
    var now = mount && mount.querySelector('.quiz-edit[data-k="' + k + '"]');
    if (!mount || !now) return _draw();
    var tpl = document.createElement('div');
    // html-safe: built by QuizCardDraw.mountInner
    tpl.innerHTML = D.mountInner();
    var fresh = tpl.querySelector('.quiz-edit[data-k="' + k + '"]');
    if (!fresh) return _draw();
    var into = now;
    Array.from(into.children).forEach(function (c) {
      if (!c.classList.contains('rb-q-bar')) c.remove();
    });
    Array.from(fresh.children).forEach(function (c) {
      if (!c.classList.contains('rb-q-bar')) into.appendChild(c);
    });
    _drawCounts();
  }

  /** @param {HTMLElement} t */
  function _onChange(t) {
    if (t.dataset.actionChange === 'quizAfterDueUntil') {
      S.settings.accept_until = String(/** @type {HTMLInputElement} */ (t).value || '');
      return _draw('#quiz-accept-until');
    }
    if (t.dataset.actionChange === ACT.type) {
      var byI = S.qs[Number(t.dataset.i)];
      if (!byI || byI.answered) return;
      byI.kind = /** @type {HTMLSelectElement} */ (t).value;
      _shapeFor(byI);
      return _redrawBelowBar(byI.k);
    }
    var q = _q(t.dataset.k || '');
    if (t.dataset.quizSees) {
      S.settings.shows = t.dataset.quizSees;
      return _draw('[data-quiz-sees="' + t.dataset.quizSees + '"]');
    }
    if (!q) return;
    if (t.dataset.quizF === 'tag') {
      q.tag = /** @type {HTMLSelectElement} */ (t).value || null;
      return _drawCounts();
    }
    if (t.dataset.quizKey) {
      var id = t.dataset.quizKey;
      if (q.multiple) {
        var others = q.answer.filter(function (/** @type {string} */ x) {
          return x !== id;
        });
        q.answer = /** @type {HTMLInputElement} */ (t).checked ? others.concat([id]) : others;
      } else q.answer = [id];
      return _draw('.quiz-edit[data-k="' + q.k + '"] [data-quiz-key="' + id + '"]');
    }
    if (t.dataset.quizTf) {
      q.answer = t.dataset.quizTf === 'True';
      return _draw('.quiz-edit[data-k="' + q.k + '"] [data-quiz-tf="' + t.dataset.quizTf + '"]');
    }
  }

  /* Enter in a choice adds the next one there (the board). */
  /** @param {KeyboardEvent} e @param {HTMLElement} t */
  function _onKey(e, t) {
    if (e.key !== 'Enter' || t.dataset.quizF !== 'choice') return;
    var q = _q(t.dataset.k || '');
    if (!q || q.answered || q.choices.length >= _data().LIMITS.choicesMax) return;
    e.preventDefault();
    var j = Number(t.dataset.j);
    q.choices.splice(j + 1, 0, { id: _data().newId(), text: '' });
    _draw('.quiz-edit[data-k="' + q.k + '"] [data-j="' + (j + 1) + '"].quiz-choice-text');
  }

  /* The answer on this module's own Student Work card. */
  /** @param {string} v */
  function _ownAnswer(v) {
    takeAnswer(v, null, function () {
      _ownAnswer(v);
    });
    _draw('[data-quiz-act="answer"][data-value="' + v + '"]');
  }

  /* What the form outside the card says changed: scoring, competencies or who works on it. */
  function _sig() {
    return [
      _mode(),
      _collab(),
      _due(),
      _tags()
        .map(function (t) {
          return t.id;
        })
        .join(','),
    ].join('|');
  }
  function _formMoved() {
    if (!S || !$('quiz-mount')) return;
    if (_sig() === S.sig) return;
    _draw();
  }

  function _wire() {
    if (typeof document === 'undefined' || _wired === document) return;
    _wired = document;
    document.addEventListener('click', function (e) {
      var target = /** @type {HTMLElement} */ (e.target);
      var inMount = target && target.closest && target.closest('#quiz-mount');
      if (inMount && S) {
        var el = /** @type {HTMLElement | null} */ (target.closest('[data-quiz-act], [data-action]'));
        if (el && !(/** @type {HTMLButtonElement} */ (el).disabled)) {
          var action = el.dataset.quizAct || el.dataset.action || '';
          var mine = !!el.dataset.quizAct || action.indexOf('quiz') === 0;
          if (mine && el.tagName !== 'SELECT') {
            var at = e.detail > 0 ? { x: e.clientX, y: e.clientY } : null;
            _act(action, el, at);
          }
        }
        return;
      }
      // Something outside the card moved: scoring, competencies, Individual or Pair.
      setTimeout(_formMoved, 0);
    });
    document.addEventListener('input', function (e) {
      var t = /** @type {HTMLElement} */ (e.target);
      if (S && t && t.closest && t.closest('#quiz-mount')) _onInput(t);
    });
    document.addEventListener('change', function (e) {
      var t = /** @type {HTMLElement} */ (e.target);
      if (!S || !t || !t.closest) return;
      if (t.closest('#quiz-mount')) _onChange(t);
      else setTimeout(_formMoved, 0);
    });
    document.addEventListener('keydown', function (e) {
      var t = /** @type {HTMLElement} */ (e.target);
      if (S && t && t.closest && t.closest('#quiz-mount')) _onKey(e, t);
    });
  }

  /* ── What the page asks ────────────────────────────────────────────────── */

  /* The fourth answer for the page's Student Work card: [] where a quiz is not offered. */
  /** @param {string} cid */
  function answers(cid) {
    if (!_offered(cid)) return [];
    return [{ value: 'quiz', label: 'They Answer a Quiz' }];
  }
  /* The answer the page's card shows as chosen. */
  /** @param {string} stored */
  function chosen(stored) {
    return S && S.picked ? 'quiz' : stored;
  }

  /**
   * The page's Student Work card was answered. True when this module took the
   * answer: 'quiz' picks the quiz (and w, the card's choices, keeps Students
   * Send at Nothing), or the teacher is being asked first before a saved quiz
   * comes off (again() runs after Yes). False: the page goes on as before.
   * @param {string} value @param {any} w @param {() => void} again
   */
  function takeAnswer(value, w, again) {
    if (!S || !_offered(S.cid)) return false;
    if (value === 'quiz') {
      if (!S.picked) {
        S.picked = true;
        if (!S.qs.length) {
          var q = _newQ();
          S.qs.push(q);
          S.open = q.k;
        }
        // A new quiz starts on Competencies, or on Points in a Letter class.
        if (S.isNew && _mode() !== _startMode()) {
          var btn = /** @type {HTMLElement | null} */ (
            document.querySelector('.af-scoremode-btn[data-mode="' + _startMode() + '"]')
          );
          if (btn) btn.click();
        }
      }
      if (w) w.students_send = 'nothing';
      _draw();
      return true;
    }
    if (!S.picked) return false;
    if (S.existed && S.qs.length && !S.dropOk && typeof showConfirm === 'function') {
      showConfirm(
        'Take the Quiz Off?',
        'This assessment’s ' +
          _plural(S.qs.length, 'question', 'questions') +
          ' and their right answers are removed when you save it.',
        'Take It Off',
        'danger',
        function () {
          S.dropOk = true;
          again();
        },
      );
      return true;
    }
    S.picked = false;
    S.open = null;
    S.preview = false;
    _draw();
    return false;
  }

  /**
   * The Quiz card's place on the form, under Student Work. pageCard: the page
   * drew its own Student Work card. '' where a quiz is not offered, so with
   * the switch off the form is exactly as before.
   * @param {string} cid @param {any} assess @param {boolean} pageCard
   */
  function mountHtml(cid, assess, pageCard) {
    S = null;
    var d = _data();
    if (!_on() || !d) return '';
    _wire();
    if (!d.offered(cid)) {
      // A signed-in server asked once; the card comes when it answers.
      d.probe(cid).then(function (/** @type {boolean} */ ok) {
        if (ok && !S && _formStillOn(cid)) _lateMount(cid, assess, pageCard);
      });
      return '';
    }
    S = _fresh(cid, assess);
    S.startTags = assess && Array.isArray(assess.tagIds) ? assess.tagIds.slice() : [];
    // Scoring and who works on it as the form will draw them: Competencies is proficiency work with no rubric.
    var m = (assess && assess.scoreMode) || 'proficiency';
    S.startMode = m === 'proficiency' && !(assess && assess.rubricId) ? 'competencies' : m;
    S.startCollab = (assess && assess.collaboration) || 'individual';
    S.startDue = (assess && assess.dueDate) || '';
    S.pageCard = !!pageCard;
    if (assess) {
      var held = d.get(cid, assess.id);
      if (held) _take(held);
      else {
        S.loading = true;
        d.load(cid, assess.id).then(function (/** @type {any} */ reply) {
          if (!S || S.aid !== assess.id) return;
          S.loading = false;
          var untouched = !S.picked || _state() === S.base;
          if (reply && untouched) _take(reply);
          else if (reply && reply.quiz) S.existed = true;
          _draw();
          if (_redrawPage) _redrawPage();
        });
      }
    }
    S.base = _state();
    // html-safe: built by _mountInner
    S.firstPass = true;
    var inner = D.mountInner();
    S.firstPass = false;
    return '<div id="quiz-mount" class="quiz-mount">' + inner + '</div>';
  }

  /* The saved quiz into the card; a save not yet accepted lays over it. */
  /** @param {any} reply */
  function _take(reply) {
    var d = _data();
    if (reply && reply.quiz) {
      var m = _fromReply(reply);
      S.settings = m.settings;
      S.qs = m.qs;
      S.picked = true;
      S.existed = true;
    }
    S.base = _state();
    var unsent = S.aid ? d.unsent(S.cid, S.aid) : null;
    if (unsent) {
      if (unsent.payload === null) {
        S.picked = false;
        S.dropOk = true;
      } else {
        var u = _fromReply(_payloadAsReply(unsent.payload));
        S.settings = u.settings;
        S.qs = u.qs;
        S.picked = true;
      }
      S.msg = unsent.message;
    }
    S.sig = '';
  }

  /** @param {string} cid */
  function _formStillOn(cid) {
    var form = $('new-assess-form');
    if (!form || form.style.display === 'none' || !$('af-title')) return false;
    return !form.dataset.cid || form.dataset.cid === cid;
  }
  /** @param {string} cid @param {any} assess @param {boolean} pageCard */
  function _lateMount(cid, assess, pageCard) {
    var html = mountHtml(cid, assess, pageCard);
    if (!html) return;
    var where = document.querySelector('#new-assess-form .af-actions');
    if (!where) return;
    var tpl = document.createElement('template');
    // html-safe: built by mountHtml
    tpl.innerHTML = html;
    where.parentNode && where.parentNode.insertBefore(tpl.content, where);
    if (_redrawPage) _redrawPage();
  }

  /**
   * Before the form saves: true when the quiz may be saved as it stands (or
   * there is none). Otherwise the card shows what is wrong beside it, the
   * first wrong question opens, and the save stops. On Points, Max Points is
   * set to the quiz's total first.
   */
  function formOk() {
    if (!S || !S.picked || !$('quiz-mount')) return true;
    _syncPoints();
    S.tried = true;
    var bad = S.qs.find(function (/** @type {any} */ q) {
      return _problems(q).length > 0;
    });
    var whole = _quizProblem();
    if (!bad && !whole && _untilOk()) return true;
    S.preview = false;
    if (!bad && !whole) {
      // Until with no Last Day: the sentence is beside the date box.
      _draw($('quiz-accept-until') ? '#quiz-accept-until' : '#quiz-until-err');
      return false;
    }
    if (bad) {
      if (S.open && S.open !== bad.k) _close(S.open);
      S.open = bad.k;
      var field = _problems(bad)[0].field;
      var sel =
        field === 'answer' && bad.kind !== 'number'
          ? '.quiz-key'
          : field === 'choices'
            ? '.quiz-choice-text'
            : '[data-quiz-f="' + field + '"]';
      _draw('.quiz-edit[data-k="' + bad.k + '"] ' + sel);
    } else {
      _draw();
      var why = $('quiz-why');
      if (why && why.scrollIntoView) why.scrollIntoView({ block: 'center' });
    }
    return false;
  }

  /* What the card holds, for the form's Cancel and Save Changes: '' while it is as it opened. */
  function snapshot() {
    if (!S) return '';
    var now = _state();
    return now === S.base ? '' : now;
  }

  /* p_quiz from the card. Competencies no longer on the piece count toward none. */
  function _payload() {
    var tags = _tags().map(function (t) {
      return t.id;
    });
    var s = S.settings;
    return {
      shuffle_questions: !!s.shuffle_questions,
      shuffle_choices: !!s.shuffle_choices,
      tries: s.tries === 0 || s.tries === 2 ? s.tries : 1,
      counts: s.counts === 'latest' ? 'latest' : 'best',
      shows: ['grade', 'right'].indexOf(s.shows) >= 0 ? s.shows : 'answers',
      add_total: !!s.add_total,
      after_due: s.after_due || 'keep',
      accept_until: s.after_due === 'until' ? s.accept_until || null : null,
      questions: S.qs.map(function (/** @type {any} */ q) {
        /** @type {Record<string, any>} */
        var out = {
          kind: q.kind,
          prompt: q.prompt.trim(),
          multiple: q.kind === 'choice' && !!q.multiple,
          points: _pts(q),
          tag_id: tags.indexOf(q.tag) >= 0 ? q.tag : null,
          key: { answer: null, tolerance: null, why: q.kind === 'text' ? null : q.why.trim() || null },
        };
        if (q.id) out.id = q.id;
        if (q.kind === 'choice') {
          out.choices = q.choices.map(function (/** @type {any} */ c) {
            return { id: c.id, text: c.text.trim() };
          });
          var ids = out.choices.map(function (/** @type {any} */ c) {
            return c.id;
          });
          out.key.answer = q.answer
            .filter(function (/** @type {string} */ id) {
              return ids.indexOf(id) >= 0;
            })
            .sort(function (/** @type {string} */ a, /** @type {string} */ b) {
              return a < b ? -1 : a > b ? 1 : 0;
            });
        } else if (q.kind === 'true_false') out.key.answer = q.answer;
        else if (q.kind === 'number') {
          out.key.answer = Number(String(q.answer).trim());
          var w = String(q.within).trim();
          out.key.tolerance = w ? Number(w) : null;
        }
        return out;
      }),
    };
  }

  /**
   * After the assessment is saved (as Student Work is): the quiz for `aid`,
   * when it changed. Nothing when the card was not drawn or nothing changed.
   * A quiz taken off a piece is removed (save_quiz with null).
   * @param {string} cid @param {string} aid
   */
  function save(cid, aid) {
    var d = _data();
    if (!S || !d || S.cid !== cid || !aid) return;
    var changed = snapshot() !== '' || !!S.msg;
    if (!S.picked) {
      if (S.existed && (changed || S.dropOk)) d.save(cid, aid, null, []);
      return;
    }
    if (!changed && S.existed) return;
    var tags = _tags().map(function (t) {
      return t.id;
    });
    var res = d.save(cid, aid, _payload(), tags);
    if (res && res.ok === false && res.error) console.warn('Quiz not saved:', res.error);
    S.base = _state();
    S.existed = true;
    S.msg = '';
  }

  /** @param {() => void} fn */
  /** @param {() => void} fn @param {any} [tools] */
  function redrawWith(fn, tools) {
    _redrawPage = fn;
    _pageTools = tools || null;
  }

  /** Whether the open form's piece is a quiz, as the card stands. */
  function picked() {
    return !!(S && S.picked);
  }

  return {
    answers: answers,
    chosen: chosen,
    takeAnswer: takeAnswer,
    mountHtml: mountHtml,
    formOk: formOk,
    snapshot: snapshot,
    save: save,
    redrawWith: redrawWith,
    picked: picked,
    // For tests: the card's model and its payload.
    _model: function () {
      return S;
    },
    _payload: function () {
      return S ? _payload() : null;
    },
    _problems: _problems,
  };
})();
if (typeof window !== 'undefined') /** @type {any} */ (window).QuizBuilder = QuizBuilder;
