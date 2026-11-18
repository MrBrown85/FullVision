// @ts-check
/* The Quiz card's drawing (teacher/quiz-builder.js, slice Q2b): HTML out from
   the card's model, read through the readers the builder hands make(). No
   state of its own, no data layer, no events. Text reaches the HTML only
   through esc; the shared pieces (teacher/question-cards.js) escape their own. */
var QuizCardDraw = (function () {
  'use strict';

  /** @param {number} n @param {string} one @param {string} many */
  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  /* The typed numbers as whole numbers of their smallest place, so the range
     line adds them exactly (12.5 and 0.1 give 12.4 to 12.6, never 12.399…).
     Not a grade: the right answer's own range, in the teacher's figures. */
  /** @param {string} s @param {number} dp */
  function _scaled(s, dp) {
    var neg = s.charAt(0) === '-';
    var parts = s.replace('-', '').split('.');
    var whole = Number((parts[0] || '0') + (parts[1] || '').padEnd(dp, '0'));
    return neg ? -whole : whole;
  }
  /** @param {number} v @param {number} dp */
  function _unscaled(v, dp) {
    var digits = String(Math.abs(v)).padStart(dp + 1, '0');
    var text = dp ? digits.slice(0, digits.length - dp) + '.' + digits.slice(digits.length - dp) : digits;
    return (v < 0 ? '-' : '') + text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  var NUM_RE = /^-?(\d+(\.\d+)?|\.\d+)$/;

  /** @param {any} api */
  function make(api) {
    /** @type {any} */
    var S = null;
    /* When the quiz closes, as the setting shown says it. */
    function _closesText() {
      var s = S.settings;
      if (s.after_due === 'until') {
        var day = s.accept_until && typeof formatShortDate === 'function' ? formatShortDate(s.accept_until) : '';
        return day ? 'It stays open until ' + day + '.' : 'It stays open until the last day you choose.';
      }
      if (!api.due()) return 'It has no due date, so it stays open.';
      if (s.after_due === 'keep') return 'It stays open after the due date.';
      return 'It closes on the due date unless you keep it open.';
    }
    /** @param {any} q */
    function _shows(q) {
      return S.tried || q.left;
    }

    /* ── Drawing ───────────────────────────────────────────────────────────── */

    /** @param {any} q */
    function _kindLabel(q) {
      var k = api.kinds().find(function (x) {
        return x.kind === q.kind;
      });
      var name = k ? k.label : 'Question';
      return q.kind === 'choice' && q.multiple ? name + ' · Multiple Answers' : name;
    }

    /** @param {any} q @param {string} field */
    function _err(q, field) {
      if (!_shows(q)) return '';
      var p = api.problems(q).find(function (x) {
        return x.field === field;
      });
      return p ? '<p class="quiz-err" id="quiz-err-' + q.k + '-' + field + '">' + esc(p.text) + '</p>' : '';
    }
    /** @param {any} q @param {string} field */
    function _bad(q, field) {
      if (!_shows(q)) return '';
      var on = api.problems(q).some(function (x) {
        return x.field === field;
      });
      return on ? ' aria-invalid="true" aria-describedby="quiz-err-' + q.k + '-' + field + '"' : '';
    }

    // The piece's competencies, and Counts Toward No Competency.
    // html-safe: competency names and codes through esc
    /** @param {any} q */
    function _tagSelect(q) {
      var tags = api.tags();
      var on = api.tagOn(q.tag) ? q.tag : '';
      return (
        '<label class="quiz-field quiz-field-tag"><span class="af-label">Competency</span>' +
        '<select class="af-input quiz-input" data-quiz-f="tag" data-k="' +
        q.k +
        '">' +
        tags
          .map(function (t) {
            return (
              '<option value="' +
              esc(t.id) +
              '"' +
              (t.id === on ? ' selected' : '') +
              '>' +
              esc((t.code ? t.code + ' ' : '') + t.name) +
              '</option>'
            );
          })
          .join('') +
        '<option value=""' +
        (on ? '' : ' selected') +
        '>Counts Toward No Competency</option></select></label>'
      );
    }

    // html-safe: choice words through esc; ids are this device's UUIDs
    /** @param {any} q */
    function _choiceEditor(q) {
      var L = api.limits();
      var type = q.multiple ? 'checkbox' : 'radio';
      var rows = q.choices
        .map(function (/** @type {any} */ c, /** @type {number} */ j) {
          var letter = String.fromCharCode(65 + j);
          var right = q.answer.indexOf(c.id) >= 0;
          return (
            '<div class="quiz-choice">' +
            '<input type="' +
            type +
            '" class="quiz-key" name="quiz-key-' +
            q.k +
            '" data-quiz-key="' +
            esc(c.id) +
            '" data-k="' +
            q.k +
            '"' +
            (right ? ' checked' : '') +
            ' aria-label="' +
            esc('Right answer: ' + (c.text.trim() || 'Choice ' + letter)) +
            '"' +
            (j === 0 ? _bad(q, 'answer') : '') +
            '>' +
            '<input type="text" class="af-input quiz-input quiz-choice-text" maxlength="' +
            L.choice +
            '" data-quiz-f="choice" data-j="' +
            j +
            '" data-k="' +
            q.k +
            '" value="' +
            esc(c.text) +
            '" aria-label="Choice ' +
            letter +
            '" placeholder="Choice ' +
            letter +
            '">' +
            '<button type="button" class="rb-x quiz-x" data-quiz-act="rmChoice" data-j="' +
            j +
            '" data-k="' +
            q.k +
            '" aria-label="Remove choice ' +
            letter +
            '"' +
            (q.choices.length <= L.choicesMin || q.answered ? ' disabled' : '') +
            '>✕</button></div>'
          );
        })
        .join('');
      var add =
        q.choices.length < L.choicesMax && !q.answered
          ? '<button type="button" class="cm-add-link quiz-add-choice" data-quiz-act="addChoice" data-k="' +
            q.k +
            '">+ Add Choice</button>'
          : '';
      return (
        '<div class="quiz-choices" role="group" aria-label="Choices. Pick the right answer with its button.">' +
        rows +
        '</div>' +
        add +
        _err(q, 'choices') +
        _err(q, 'answer') +
        '<div class="quiz-multi">' +
        '<span class="rb-sw">Multiple Answers<button type="button" class="rb-switch" role="switch" aria-checked="' +
        !!q.multiple +
        '" aria-label="Multiple Answers" data-quiz-act="multiple" data-k="' +
        q.k +
        '"' +
        (q.answered ? ' disabled' : '') +
        '><span></span></button></span>' +
        (q.multiple
          ? '<span class="cm-hint">Several are right. A student gets the points only by choosing every right answer and no other.</span>'
          : '') +
        '</div>'
      );
    }

    /** @param {string} s */
    function _places(s) {
      var m = /\.(\d+)$/.exec(String(s).trim());
      return m ? m[1].length : 0;
    }

    // html-safe: the typed numbers are esc'd; the range line is built from them
    /** @param {any} q */
    function _numberEditor(q) {
      var a = String(q.answer).trim();
      var w = String(q.within).trim();
      var line = '';
      if (NUM_RE.test(a) && (!w || /^(\d+(\.\d+)?|\.\d+)$/.test(w))) {
        var dp = Math.max(_places(a), _places(w));
        var n = _scaled(a, dp);
        var t = w ? _scaled(w, dp) : 0;
        line = t
          ? 'Any answer from ' + _unscaled(n - t, dp) + ' to ' + _unscaled(n + t, dp) + ' is right.'
          : 'Only ' + _unscaled(n, dp) + ' is right.';
      }
      return (
        '<div class="quiz-number">' +
        '<label class="quiz-field"><span class="af-label">Right Answer</span>' +
        '<input type="text" inputmode="decimal" class="af-input quiz-input quiz-num" data-quiz-f="answer" data-k="' +
        q.k +
        '" value="' +
        esc(q.answer) +
        '"' +
        _bad(q, 'answer') +
        '></label>' +
        '<label class="quiz-field"><span class="af-label">Within</span>' +
        '<input type="text" inputmode="decimal" class="af-input quiz-input quiz-num" data-quiz-f="within" data-k="' +
        q.k +
        '" value="' +
        esc(q.within) +
        '" placeholder="Exactly"' +
        _bad(q, 'within') +
        '></label></div>' +
        _err(q, 'answer') +
        _err(q, 'within') +
        '<p class="cm-hint quiz-range" id="quiz-range-' +
        q.k +
        '">' +
        esc(line) +
        '</p>'
      );
    }

    // html-safe: fixed words
    /** @param {any} q */
    function _tfEditor(q) {
      return (
        '<div class="quiz-tf" role="radiogroup" aria-label="Right answer">' +
        ['True', 'False']
          .map(function (w, j) {
            var v = w === 'True';
            return (
              '<label class="quiz-tf-opt"><input type="radio" class="quiz-key" name="quiz-key-' +
              q.k +
              '" data-quiz-tf="' +
              w +
              '" data-k="' +
              q.k +
              '"' +
              (q.answer === v ? ' checked' : '') +
              (j === 0 ? _bad(q, 'answer') : '') +
              '> ' +
              w +
              '</label>'
            );
          })
          .join('') +
        '</div>' +
        _err(q, 'answer')
      );
    }

    /* An open question. */
    // html-safe: every typed word goes through esc; the shared pieces escape their own
    /** @param {any} q @param {number} i */
    function _editHtml(q, i) {
      var L = api.limits();
      var num = i + 1;
      var last = i === S.qs.length - 1;
      var body = '';
      if (q.kind === 'choice') body = _choiceEditor(q);
      else if (q.kind === 'true_false') body = _tfEditor(q);
      else if (q.kind === 'number') body = _numberEditor(q);
      else
        body =
          '<p class="cm-hint">You assess this answer and give its points. Students see them when you return it.</p>';
      if (q.kind !== 'text') {
        body +=
          '<label class="quiz-field quiz-field-why"><span class="af-label">Why the Right Answer Is Right</span>' +
          '<input type="text" class="af-input quiz-input" maxlength="' +
          L.why +
          '" data-quiz-f="why" data-k="' +
          q.k +
          '" value="' +
          esc(q.why) +
          '"></label>' +
          '<p class="cm-hint">' +
          esc(
            S.settings.shows === 'answers'
              ? 'Students see this when the quiz is returned.'
              : 'Students see this only when When Returned, Students See includes the answers.',
          ) +
          '</p>';
      }
      var picker = QuestionCards.kindPicker({ kind: q.kind }, i, { kinds: api.kinds(), actions: api.act });
      if (q.answered) picker = picker.replace('<select ', '<select disabled ');
      return (
        '<div class="quiz-edit rb-q-edit" data-k="' +
        q.k +
        '">' +
        '<div class="rb-q-bar"><span class="rb-q-label">Question ' +
        num +
        '</span>' +
        picker +
        QuestionCards.toolbar(i, last, { actions: api.act }) +
        '</div>' +
        (q.answered
          ? '<p class="cm-hint">Students have answered this question, so its type and choices stay. You can reword them.</p>'
          : '') +
        '<input type="text" class="af-input quiz-input quiz-prompt" maxlength="' +
        L.prompt +
        '" data-quiz-f="prompt" data-k="' +
        q.k +
        '" value="' +
        esc(q.prompt) +
        '" aria-label="Question ' +
        num +
        '" placeholder="Question"' +
        _bad(q, 'prompt') +
        '>' +
        _err(q, 'prompt') +
        body +
        '<div class="quiz-foot">' +
        _tagSelect(q) +
        '<label class="quiz-field quiz-field-points"><span class="af-label">Points</span>' +
        '<input type="text" inputmode="numeric" class="af-input quiz-input quiz-points" data-quiz-f="points" data-k="' +
        q.k +
        '" value="' +
        esc(q.points) +
        '"' +
        _bad(q, 'points') +
        '></label>' +
        '<button type="button" class="btn btn-ghost quiz-done" data-quiz-act="done" data-k="' +
        q.k +
        '">Done</button>' +
        '</div>' +
        _err(q, 'points') +
        '</div>'
      );
    }

    /* A closed question: one button that opens it. */
    // html-safe: prompt and competency through esc
    /** @param {any} q @param {number} i */
    function _rowHtml(q, i) {
      var num = i + 1;
      var tag = api.tagOn(q.tag)
        ? api.tags().find(function (t) {
            return t.id === q.tag;
          })
        : null;
      var chip = tag
        ? '<span class="quiz-chip">' +
          (tag.code ? '<span class="quiz-chip-code">' + esc(tag.code) + '</span>' : '') +
          esc(tag.name) +
          '</span>'
        : '<span class="quiz-chip is-none">No Competency</span>';
      var first = api.problems(q)[0];
      var pts = api.pts(q);
      var right = first
        ? '<span class="quiz-row-bad">' + esc(first.text) + '</span>'
        : esc(_kindLabel(q) + ' · ' + _plural(isFinite(pts) ? pts : 0, 'point', 'points'));
      return (
        '<button type="button" class="quiz-row" data-quiz-act="open" data-k="' +
        q.k +
        '" aria-label="' +
        esc('Question ' + num + ': ' + (q.prompt.trim() || 'New question') + '. Open to edit') +
        '"><span class="quiz-row-num">' +
        num +
        '</span><span class="quiz-row-prompt">' +
        esc(q.prompt.trim() || 'New Question') +
        '</span>' +
        chip +
        '<span class="quiz-row-pts">' +
        right +
        '</span></button>'
      );
    }

    function _headText() {
      return (
        'Quiz · ' + _plural(S.qs.length, 'Question', 'Questions') + ' · ' + _plural(api.total(), 'Point', 'Points')
      );
    }

    // html-safe: competency names through esc
    function _evidenceHtml() {
      var comps = api.mode() === 'competencies';
      var rows = api
        .tags()
        .map(function (t) {
          var qs = S.qs.filter(function (/** @type {any} */ q) {
            return q.tag === t.id;
          });
          var p = qs.reduce(function (/** @type {number} */ a, /** @type {any} */ q) {
            var n = api.pts(q);
            return a + (isFinite(n) ? n : 0);
          }, 0);
          var need = api.minForSuggestion - qs.length;
          return (
            '<div class="quiz-ev-row"><span class="quiz-ev-what">' +
            esc((t.code ? t.code + ' ' : '') + t.name) +
            '</span><span class="quiz-ev-count">' +
            esc(
              qs.length
                ? _plural(qs.length, 'question', 'questions') + ' · ' + _plural(p, 'point', 'points')
                : 'No questions yet',
            ) +
            '</span>' +
            (comps && need > 0
              ? '<span class="quiz-ev-thin">' +
                esc(
                  (need === 1 ? 'One more question' : need + ' more questions') +
                    ' and this quiz can suggest a level here.',
                ) +
                '</span>'
              : '') +
            '</div>'
          );
        })
        .join('');
      var none = S.qs.filter(function (/** @type {any} */ q) {
        return !api.tagOn(q.tag);
      });
      if (none.length) {
        rows +=
          '<div class="quiz-ev-row"><span class="quiz-ev-what is-none">No Competency</span><span class="quiz-ev-count">' +
          esc(_plural(none.length, 'question', 'questions')) +
          '</span>' +
          (comps ? '<span class="quiz-ev-thin">These count toward no competency.</span>' : '') +
          '</div>';
      }
      if (!api.tags().length) rows += '<p class="cm-hint">Tick the competencies this assessment covers, above.</p>';
      if (!comps && api.mode() === 'points') {
        rows += '<p class="cm-hint">On Points, every competency reads the level the total reaches.</p>';
      }
      return '<h4 class="quiz-side-title">Evidence by Competency</h4>' + rows;
    }

    // html-safe: fixed labels and values
    /** @param {string} field @param {string} labelId @param {{ value: string, label: string }[]} choices @param {string} chosen */
    function _seg(field, labelId, choices, chosen) {
      return (
        '<div class="seg quiz-seg" role="radiogroup" aria-labelledby="' +
        labelId +
        '">' +
        choices
          .map(function (c) {
            var on = c.value === chosen;
            return (
              '<button type="button" class="seg-btn' +
              (on ? ' active' : '') +
              '" role="radio" aria-checked="' +
              on +
              '" data-quiz-act="set" data-quiz-set="' +
              field +
              '" data-value="' +
              c.value +
              '">' +
              esc(c.label) +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    }
    // html-safe: fixed labels
    /** @param {string} field @param {string} label @param {boolean} on */
    function _switch(field, label, on) {
      var id = 'quiz-l-' + field;
      return (
        '<div class="quiz-set-row"><span id="' +
        id +
        '">' +
        esc(label) +
        '</span><button type="button" class="rb-switch" role="switch" aria-checked="' +
        !!on +
        '" aria-labelledby="' +
        id +
        '" data-quiz-act="toggle" data-quiz-set="' +
        field +
        '"><span></span></button></div>'
      );
    }

    var SEES = [
      { value: 'grade', label: 'Grade Only' },
      { value: 'right', label: 'Grade and Which Were Right' },
      { value: 'answers', label: 'Grade, Which Were Right and the Answers' },
    ];
    var SEES_HINT = {
      grade: 'Students see their grade and your comment.',
      right: 'Students see their grade, your comment and which questions were right.',
      answers: 'Students see their grade, your comment, which were right and the right answers.',
    };

    // html-safe: fixed labels and esc'd text; the page's own Student Work row escapes its dates
    function _settingsHtml() {
      var s = S.settings;
      var tries = s.tries === 0 ? 'u' : String(s.tries);
      var many = s.tries !== 1;
      var shuffled = s.shuffle_questions || s.shuffle_choices;
      return (
        '<h4 class="quiz-side-title">Quiz Settings</h4>' +
        _switch('shuffle_questions', 'Shuffle Questions', s.shuffle_questions) +
        _switch('shuffle_choices', 'Shuffle Choices', s.shuffle_choices) +
        '<div class="quiz-set-row"><span id="quiz-l-tries">Tries</span>' +
        _seg(
          'tries',
          'quiz-l-tries',
          [
            { value: '1', label: 'One' },
            { value: '2', label: 'Two' },
            { value: 'u', label: 'Unlimited' },
          ],
          tries,
        ) +
        '</div>' +
        (many
          ? '<div class="quiz-set-row"><span id="quiz-l-counts">Counts</span>' +
            _seg(
              'counts',
              'quiz-l-counts',
              [
                { value: 'best', label: 'Best' },
                { value: 'latest', label: 'Latest' },
              ],
              s.counts,
            ) +
            '</div>'
          : '') +
        '<p class="cm-hint">' +
        esc((many && shuffled ? 'Each try is a fresh shuffle. ' : '') + 'You can reopen it for one student.') +
        '</p>' +
        '<fieldset class="quiz-sees"><legend class="af-label">When Returned, Students See</legend>' +
        SEES.map(function (o) {
          return (
            '<label class="quiz-sees-opt"><input type="radio" name="quiz-sees" data-quiz-sees="' +
            o.value +
            '"' +
            (s.shows === o.value ? ' checked' : '') +
            '> ' +
            esc(o.label) +
            '</label>'
          );
        }).join('') +
        '</fieldset>' +
        _switch('add_total', 'Add a Total', s.add_total) +
        '<p class="cm-hint">' +
        esc(
          /** @type {Record<string, string>} */ (SEES_HINT)[s.shows] +
            (s.add_total ? ' A total in points shows beside it.' : ''),
        ) +
        '</p>' +
        api.afterDueRow() +
        (S.tried && !api.untilOk()
          ? '<p class="quiz-err" id="quiz-until-err" tabindex="-1">Choose the last day it stays open.</p>'
          : '') +
        '<p class="cm-hint" id="quiz-closes">' +
        esc('Students see it once you assign it. ' + _closesText()) +
        '</p>'
      );
    }

    /* Preview as a Student: the questions drawn as a student's page shows
     them, in the teacher's order, with nothing to press and nothing sent.
     A small drawing of its own until the student's screen (slice Q3b). */
    // html-safe: QuestionCards.viewHtml escapes every word
    function _previewHtml() {
      var parts = S.qs.map(function (/** @type {any} */ q, /** @type {number} */ i) {
        /** @type {any} */
        var d = {
          kind: q.kind,
          prompt: q.prompt,
          subtitle: null,
          required: false,
          choices: [],
          multiple: false,
          long: true,
        };
        if (q.kind === 'choice') {
          d.choices = q.choices.map(function (/** @type {any} */ c) {
            return c.text;
          });
          d.multiple = q.multiple;
        } else if (q.kind === 'true_false') {
          d.kind = 'choice';
          d.choices = ['True', 'False'];
        }
        var view = QuestionCards.viewHtml(d, i, i + 1, false, { kinds: api.kinds() });
        if (q.kind === 'number') {
          view = view.replace(/<\/div>$/, '<div class="rb-v-box">Students type a number</div></div>');
        }
        var p = api.pts(q);
        return (
          '<li class="quiz-pv-q">' +
          view +
          '<span class="quiz-pv-pts">' +
          esc(_plural(isFinite(p) ? p : 0, 'point', 'points')) +
          '</span></li>'
        );
      });
      var note = S.settings.shuffle_questions
        ? 'Each student gets the questions in an order of their own.'
        : 'Students get the questions in this order.';
      return (
        '<div class="quiz-preview" aria-label="Preview as a Student">' +
        '<p class="cm-hint">' +
        esc(note + ' Nothing here is sent.') +
        '</p>' +
        '<div class="quiz-pv-phone"><ol class="quiz-pv-list">' +
        (parts.join('') || '<li class="cm-hint">No questions yet.</li>') +
        '</ol></div></div>'
      );
    }

    // html-safe: built from the pieces above
    function _cardHtml() {
      var why = api.quizProblem();
      var head =
        '<div class="quiz-card-head"><h3 class="quiz-title" id="quiz-head">' +
        esc(_headText()) +
        '</h3><span class="quiz-head-btns">' +
        '<button type="button" class="btn btn-ghost" data-quiz-act="preview" aria-pressed="' +
        !!S.preview +
        '">' +
        (S.preview ? 'Back to Questions' : 'Preview as a Student') +
        '</button>' +
        (S.preview
          ? ''
          : '<button type="button" class="btn btn-ghost" data-quiz-act="add"' +
            (S.qs.length >= api.limits().questions ? ' disabled' : '') +
            '>Add Question</button>') +
        '</span></div>';
      var lead =
        '<p class="cm-hint quiz-lead">' +
        esc(
          'Students answer on their own page. ' +
            (api.mode() === 'points' ? 'You confirm each score' : 'You confirm each level') +
            ' before it counts.',
        ) +
        '</p>';
      var msg = S.stale
        ? '<div class="quiz-stale"><p class="quiz-err quiz-msg" id="quiz-stale-msg">' +
          esc(S.msg) +
          '</p><span class="quiz-stale-acts">' +
          '<button type="button" class="btn btn-primary" data-quiz-act="keepMine" aria-describedby="quiz-stale-msg">Keep Mine</button>' +
          '<button type="button" class="btn btn-ghost" data-quiz-act="useOther" aria-describedby="quiz-stale-msg">Use the Other One</button>' +
          '</span></div>'
        : S.msg
          ? '<p class="quiz-err quiz-msg">' + esc('Your last change to this quiz was not saved. ' + S.msg) + '</p>'
          : '';
      var whyLine =
        why && (S.tried || !api.scoringOk() || api.collab() !== 'individual')
          ? '<p class="quiz-err" id="quiz-why">' + esc(why) + '</p>'
          : '';
      if (S.loading) {
        return (
          '<section class="af-card quiz-card" aria-labelledby="quiz-head">' +
          head +
          '<p class="cm-hint">Reading the quiz.</p></section>'
        );
      }
      var list = S.preview
        ? _previewHtml()
        : '<ol class="quiz-list" id="quiz-list">' +
          S.qs
            .map(function (/** @type {any} */ q, /** @type {number} */ i) {
              return (
                '<li class="quiz-item" data-k="' +
                q.k +
                '">' +
                (q.k === S.open ? _editHtml(q, i) : _rowHtml(q, i)) +
                '</li>'
              );
            })
            .join('') +
          '</ol>' +
          (S.qs.length ? '' : '<p class="cm-hint">No questions yet. Add Question starts one.</p>') +
          (S.qs.length >= api.limits().questions ? '<p class="cm-hint">A quiz can have up to 100 questions.</p>' : '');
      return (
        '<section class="af-card quiz-card" aria-labelledby="quiz-head">' +
        head +
        lead +
        msg +
        whyLine +
        '<div class="quiz-body"><div class="quiz-main">' +
        list +
        '</div><aside class="quiz-side"><div class="quiz-side-card" id="quiz-evidence">' +
        _evidenceHtml() +
        '</div><div class="quiz-side-card" id="quiz-settings">' +
        _settingsHtml() +
        '</div></aside></div></section>'
      );
    }

    /* Where Send Work is off the page draws no Student Work card: this one asks
     the same question with the two answers a quiz class has. */
    // html-safe: fixed labels
    function _ownWorkHtml() {
      var answer = function (/** @type {string} */ v, /** @type {string} */ label) {
        var on = (v === 'quiz') === !!S.picked;
        return (
          '<button type="button" class="seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-quiz-act="answer" data-value="' +
          v +
          '">' +
          label +
          '</button>'
        );
      };
      return (
        '<section class="af-card quiz-work" aria-labelledby="quiz-work-title">' +
        '<div class="af-card-head"><span class="af-card-title" id="quiz-work-title">Student Work</span></div>' +
        '<div class="af-work-list"><div class="af-work-row"><div class="af-work-ask"><span class="af-work-q" id="quiz-work-q">Do Students Send You Their Work?</span></div>' +
        '<div class="af-work-answer"><div class="seg af-work-seg" role="radiogroup" aria-labelledby="quiz-work-q">' +
        answer('nothing', 'No') +
        answer('quiz', 'They Answer a Quiz') +
        '</div></div></div></div></section>'
      );
    }

    // html-safe: built from _ownWorkHtml and _cardHtml
    function _mountInner() {
      return (S.pageCard ? '' : _ownWorkHtml()) + (S.picked ? _cardHtml() : '');
    }

    /** @param {() => string} fn */
    function withState(fn) {
      S = api.state();
      return fn();
    }
    return {
      mountInner: function () {
        return withState(_mountInner);
      },
      headText: function () {
        return withState(_headText);
      },
      evidenceHtml: function () {
        return withState(_evidenceHtml);
      },
      /** @param {any} q */
      numberEditor: function (q) {
        return withState(function () {
          return _numberEditor(q);
        });
      },
    };
  }

  return { make: make };
})();
if (typeof window !== 'undefined') /** @type {any} */ (window).QuizCardDraw = QuizCardDraw;
