// @ts-check
/* A teacher-built reflection's questions on the student page
   (docs/plans/reflect-plan.md, "The data contract"; the mockup's board 5,
   a student answering). s/questionnaire.js draws every question of a
   `custom` part through here, and the kinds only a teacher's reflection
   has (rating, date, ranking, likert, section) wherever they are. The
   ready-made reflections' own kinds stay in questionnaire.js, drawn as
   they always were.

   This file draws and reads answers; it holds no state. What a press
   changes is questionnaire.js's. What `value` gives is what the page
   sends, the contract's "student's answer" column:
     text     a string (questionnaire.js trims it)
     choice   an array of chosen texts; a typed Other is a text not in
              `choices`, up to 60 (questionnaire.js sends the array)
     rating   a whole number, 1 to `levels`
     date     "YYYY-MM-DD"
     ranking  every choice once, in the student's order; nothing until
              the student moves one
     likert   { statement: choice }, statements not answered left out
     section  nothing: no answer, not counted
   Every text goes into the HTML through esc (shared/html.js). */
var StudentQuestionKinds = (function () {
  'use strict';

  // The kinds only a teacher-built reflection has.
  var NEW = { rating: 1, date: 1, ranking: 1, likert: 1, section: 1 };
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var OTHER = '__other__';

  function isNew(kind) {
    return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(NEW, kind);
  }
  // Drawn here: every question of a teacher-built reflection, and a new kind anywhere.
  function owns(q, part) {
    return !!q && ((part && part.kind === 'custom') || isNew(q.kind));
  }

  function opts(q) {
    return (q && q.options && typeof q.options === 'object' && q.options) || {};
  }
  function texts(list) {
    return (Array.isArray(list) ? list : [])
      .map(function (x) {
        return typeof x === 'string' ? x : x == null ? '' : String(x);
      })
      .filter(function (x) {
        return x.trim() !== '';
      });
  }
  function required(q) {
    return opts(q).required === true;
  }
  function levelsOf(q) {
    var n = Number(opts(q).levels);
    return Number.isInteger(n) && n >= 2 && n <= 10 ? n : 5;
  }
  function statementsOf(q) {
    return texts(opts(q).statements);
  }
  function choicesOf(q) {
    return texts(opts(q).choices);
  }

  /* A choice question with shuffle on: its choices in one order for this
     page load, the same order every time it is drawn. */
  var shuffled = {};
  function choiceOrder(q) {
    var list = choicesOf(q);
    if (opts(q).shuffle !== true) return list;
    var key = q.id + '\u0000' + list.join('\u0000');
    if (!shuffled[key]) {
      var out = list.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      shuffled[key] = out;
    }
    return shuffled[key].slice();
  }

  /* A ranking's order: the student's, once they have moved one, holding
     every choice once; otherwise the teacher's. */
  function rankOrder(q, v) {
    var list = choicesOf(q);
    if (!Array.isArray(v)) return list;
    var out = [];
    v.forEach(function (x) {
      if (list.indexOf(x) >= 0 && out.indexOf(x) < 0) out.push(x);
    });
    list.forEach(function (x) {
      if (out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  // A likert answer with only the statements and columns the question has.
  function likertPairs(q, v) {
    var out = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    var cols = choicesOf(q);
    statementsOf(q).forEach(function (s) {
      if (Object.prototype.hasOwnProperty.call(v, s) && cols.indexOf(v[s]) >= 0) out[s] = v[s];
    });
    return out;
  }

  /* ── Answers ───────────────────────────────────────────────── */

  // Answered at all (what is sent). The new kinds only.
  function isAnswered(q, v) {
    if (q.kind === 'section') return false;
    if (q.kind === 'rating') return Number.isInteger(v) && v >= 1 && v <= levelsOf(q);
    if (q.kind === 'date') return typeof v === 'string' && DAY_RE.test(v);
    if (q.kind === 'ranking') return Array.isArray(v) && v.length > 0;
    if (q.kind === 'likert') return Object.keys(likertPairs(q, v)).length > 0;
    return false;
  }

  // Answered in full (what "N of M answered" and a star ask): a likert needs every statement.
  function isComplete(q, v) {
    if (q.kind === 'likert') {
      var pairs = likertPairs(q, v);
      var all = statementsOf(q);
      return (
        all.length > 0 &&
        all.every(function (s) {
          return Object.prototype.hasOwnProperty.call(pairs, s);
        })
      );
    }
    return isAnswered(q, v);
  }

  // What is sent for a new kind, or undefined for nothing.
  function value(q, v) {
    if (!isAnswered(q, v)) return undefined;
    if (q.kind === 'ranking') return rankOrder(q, v);
    if (q.kind === 'likert') return likertPairs(q, v);
    return v;
  }

  // A choice answer's typed Other: the one text not among the choices.
  function otherText(q, v) {
    var list = choicesOf(q);
    var typed = (Array.isArray(v) ? v : []).filter(function (x) {
      return typeof x === 'string' && list.indexOf(x) < 0;
    });
    return typed.length ? typed[typed.length - 1] : '';
  }

  // The listed choice a text stands for (trimmed, any case), or ''.
  function listedChoice(q, text) {
    var t = String(text == null ? '' : text)
      .trim()
      .toLowerCase();
    if (!t) return '';
    var hit = choicesOf(q).filter(function (c) {
      return c.trim().toLowerCase() === t;
    });
    return hit.length ? hit[0] : '';
  }

  /* A choice answer with only what the question has now: its current
     choices, in the student's order, and at most one typed Other, only
     while Other is on (the last one typed, up to 60). One answer keeps one.
     A draft kept before the teacher renamed or removed a choice loses the
     old text here, so what is shown, counted and sent agree. */
  function choiceKept(q, v) {
    var other = opts(q).other === true;
    var arr = (Array.isArray(v) ? v : []).filter(function (x) {
      return typeof x === 'string' && x.trim() !== '';
    });
    var last = -1;
    arr.forEach(function (x, i) {
      if (other && !listedChoice(q, x)) last = i;
    });
    var out = [];
    arr.forEach(function (x, i) {
      var hit = listedChoice(q, x);
      if (hit) {
        if (out.indexOf(hit) < 0) out.push(hit);
      } else if (i === last) {
        out.push(x.trim().slice(0, 60));
      }
    });
    return opts(q).multiple === false ? out.slice(0, 1) : out;
  }

  /* ── Drawing ───────────────────────────────────────────────── */

  var STAR = '<span class="sp-req" aria-hidden="true">*</span><span class="sp-vh"> (required)</span>';
  var UP =
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  var DOWN =
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

  function base(q) {
    return 'q-' + q.id;
  }
  function attrs(q, kind) {
    return ' data-q="' + esc(q.id) + '" data-kind="' + kind + '"' + (required(q) ? ' aria-required="true"' : '');
  }
  function described(q) {
    return opts(q).subtitle ? ' aria-describedby="' + esc(base(q)) + '-sub"' : '';
  }

  // The prompt (a label for one box, else a line the group is named by), its star and its subtitle.
  function head(q, prompt, forId) {
    var id = esc(base(q));
    var sub = String(opts(q).subtitle || '').trim();
    return (
      (forId
        ? '<label class="sp-q" id="' + id + '-p" for="' + esc(forId) + '">'
        : '<div class="sp-q" id="' + id + '-p">') +
      esc(prompt) +
      (required(q) ? ' ' + STAR : '') +
      (forId ? '</label>' : '</div>') +
      (sub ? '<p class="sp-q-sub" id="' + id + '-sub">' + esc(sub) + '</p>' : '')
    );
  }

  function textBody(q, v, prompt) {
    var id = base(q);
    var val = typeof v === 'string' ? v : '';
    if (opts(q).long === false) {
      return (
        head(q, prompt, id) +
        '<input class="sp-input" id="' +
        esc(id) +
        '" maxlength="2000" autocomplete="off"' +
        attrs(q, 'text') +
        described(q) +
        ' value="' +
        esc(val) +
        '">'
      );
    }
    return (
      head(q, prompt, id) +
      '<textarea class="sp-text" id="' +
      esc(id) +
      '" rows="3" maxlength="2000"' +
      attrs(q, 'text') +
      described(q) +
      '>' +
      esc(val) +
      '</textarea>'
    );
  }

  function otherBox(q, v) {
    return (
      '<input class="sp-input sp-rq-other" id="' +
      esc(base(q)) +
      '-other" maxlength="60" autocomplete="off" placeholder="Type your answer" aria-label="Your other answer"' +
      attrs(q, 'other') +
      ' value="' +
      esc(otherText(q, v)) +
      '">'
    );
  }

  /* One choice as a button (a radio when only one answer is wanted, else a
     checkbox): the question's own presses are named by `act`, the value it
     stands for by `value` (none for Other). */
  function optionRow(q, single, act, value, label, on) {
    return (
      '<button type="button" class="sp-rq-opt" role="' +
      (single ? 'radio' : 'checkbox') +
      '" aria-checked="' +
      on +
      '" data-act="' +
      act +
      '" data-q="' +
      esc(q.id) +
      '"' +
      (value == null ? '' : ' data-value="' + esc(value) + '"') +
      '><span class="sp-rq-' +
      (single ? 'dot' : 'box') +
      '" aria-hidden="true"></span><span>' +
      esc(label) +
      '</span></button>'
    );
  }

  /* A choice: a list of buttons (board 5), one answer or many, with Other
     last; or, with dropdown on, a menu. */
  function choiceBody(q, v, prompt, otherOn) {
    var o = opts(q);
    var picked = Array.isArray(v) ? v : [];
    var list = choiceOrder(q);
    var id = base(q);
    if (o.dropdown === true) {
      var now = otherOn
        ? OTHER
        : picked.filter(function (x) {
            return list.indexOf(x) >= 0;
          })[0] || '';
      return (
        head(q, prompt, id) +
        '<select class="sp-input sp-rq-select" id="' +
        esc(id) +
        '"' +
        attrs(q, 'select') +
        described(q) +
        '><option value=""' +
        (now ? '' : ' selected') +
        '>Choose One</option>' +
        list
          .map(function (c) {
            return '<option value="' + esc(c) + '"' + (c === now ? ' selected' : '') + '>' + esc(c) + '</option>';
          })
          .join('') +
        (o.other === true
          ? '<option value="' + OTHER + '"' + (now === OTHER ? ' selected' : '') + '>Other</option>'
          : '') +
        '</select>' +
        (o.other === true && otherOn ? otherBox(q, v) : '')
      );
    }
    var single = o.multiple === false;
    var row = function (act, value, label, on) {
      return optionRow(q, single, act, value, label, on);
    };
    return (
      head(q, prompt) +
      '<div class="sp-rq-list" role="' +
      (single ? 'radiogroup' : 'group') +
      '" aria-labelledby="' +
      esc(id) +
      '-p"' +
      described(q) +
      '>' +
      list
        .map(function (c) {
          return row('kc-pick', c, c, picked.indexOf(c) >= 0);
        })
        .join('') +
      (o.other === true ? row('kc-other', null, 'Other', !!otherOn) : '') +
      '</div>' +
      (o.other === true && otherOn ? otherBox(q, v) : '')
    );
  }

  // As many to a row as fit a phone: up to 5, then two rows.
  function rateColumns(n) {
    return n <= 5 ? n : Math.ceil(n / 2);
  }

  function ratingBody(q, v, prompt) {
    var o = opts(q);
    var n = levelsOf(q);
    var low = String(o.low || '').trim();
    var high = String(o.high || '').trim();
    var html =
      head(q, prompt) +
      '<div class="sp-rq-rate" role="radiogroup" aria-labelledby="' +
      esc(base(q)) +
      '-p"' +
      described(q) +
      ' style="grid-template-columns:repeat(' +
      rateColumns(n) +
      ',minmax(0,1fr))">';
    for (var i = 1; i <= n; i++) {
      var end = i === 1 ? low : i === n ? high : '';
      html +=
        '<button type="button" role="radio" aria-checked="' +
        (v === i) +
        '" data-act="rate" data-q="' +
        esc(q.id) +
        '" data-value="' +
        i +
        '"' +
        (end ? ' aria-label="' + esc(i + ', ' + end) + '"' : '') +
        '>' +
        i +
        '</button>';
    }
    html += '</div>';
    if (low || high) {
      html +=
        '<div class="sp-rq-ends" aria-hidden="true"><span>' + esc(low) + '</span><span>' + esc(high) + '</span></div>';
    }
    return html;
  }

  function dateBody(q, v, prompt) {
    var id = base(q);
    return (
      head(q, prompt, id) +
      '<input type="date" class="sp-input sp-rq-date" id="' +
      esc(id) +
      '"' +
      attrs(q, 'date') +
      described(q) +
      ' value="' +
      esc(typeof v === 'string' && DAY_RE.test(v) ? v : '') +
      '">'
    );
  }

  function rankingBody(q, v, prompt) {
    var order = rankOrder(q, v);
    var last = order.length - 1;
    var move = function (dir, i, c) {
      return (
        '<button type="button" class="sp-rq-move" data-act="rank-' +
        dir +
        '" data-q="' +
        esc(q.id) +
        '" data-i="' +
        i +
        '" aria-label="' +
        esc('Move ' + c + ' ' + dir) +
        '">' +
        (dir === 'up' ? UP : DOWN) +
        '</button>'
      );
    };
    return (
      head(q, prompt) +
      '<p class="sp-q-sub">Use the arrows to move one up or down.</p>' +
      '<ol class="sp-rq-rank" aria-labelledby="' +
      esc(base(q)) +
      '-p" data-rank-q="' +
      esc(q.id) +
      '">' +
      order
        .map(function (c, i) {
          return (
            '<li class="sp-rq-rank-row" data-rank="' +
            esc(c) +
            '"><strong aria-hidden="true">' +
            (i + 1) +
            '</strong><span class="sp-rq-rank-text">' +
            esc(c) +
            '</span>' +
            (i > 0 ? move('up', i, c) : '') +
            (i < last ? move('down', i, c) : '') +
            '</li>'
          );
        })
        .join('') +
      '</ol>'
    );
  }

  function likertBody(q, v, prompt) {
    var pairs = likertPairs(q, v);
    var cols = choicesOf(q);
    var id = esc(base(q));
    // More than four columns don't fit a phone side by side: they stack there (student.css).
    var wide = cols.length > 4;
    return (
      head(q, prompt) +
      '<div class="sp-rq-likert">' +
      statementsOf(q)
        .map(function (s, si) {
          return (
            '<div class="sp-rq-lk-row"><span class="sp-rq-lk-st" id="' +
            id +
            '-s' +
            si +
            '">' +
            esc(s) +
            '</span><div class="sp-rq-scale' +
            (wide ? ' sp-rq-scale-wide' : '') +
            '" role="radiogroup" aria-labelledby="' +
            id +
            '-s' +
            si +
            '" style="--sp-cols:' +
            cols.length +
            '">' +
            cols
              .map(function (c) {
                return (
                  '<button type="button" role="radio" aria-checked="' +
                  (pairs[s] === c) +
                  '" data-act="likert" data-q="' +
                  esc(q.id) +
                  '" data-s="' +
                  si +
                  '" data-value="' +
                  esc(c) +
                  '">' +
                  esc(c) +
                  '</button>'
                );
              })
              .join('') +
            '</div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── A quiz's questions (s/quiz-view.js) ────────────────────
     A quiz question is the shape the `quiz` route sends: { id, kind
     (choice, true_false, number, text), prompt, multiple, choices: [ { id,
     text } ] or null }. Its answer is what `quiz-save` takes: a choice an
     array of choice ids, true_false a boolean, number a finite number,
     text a string. The choices are drawn in the order given (the server
     keeps each student's own order), a press is `quiz-pick` with the
     choice's id (true or false for true_false), and typing is read by
     s/quiz.js from the box's data-q. A quiz shows no right answer. */
  function numberBody(q, v) {
    var id = base(q);
    return (
      head(q, q.prompt || '', id) +
      '<input class="sp-input sp-quiz-number" id="' +
      esc(id) +
      '" type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="24"' +
      attrs(q, 'number') +
      ' value="' +
      esc(typeof v === 'number' && isFinite(v) ? String(v) : '') +
      '">' +
      '<p class="sp-quiz-hint" id="' +
      esc(id) +
      '-hint" role="status"></p>'
    );
  }

  function trueFalseBody(q, v) {
    return (
      head(q, q.prompt || '') +
      '<div class="sp-rq-list" role="radiogroup" aria-labelledby="' +
      esc(base(q)) +
      '-p">' +
      optionRow(q, true, 'quiz-pick', 'true', 'True', v === true) +
      optionRow(q, true, 'quiz-pick', 'false', 'False', v === false) +
      '</div>'
    );
  }

  function quizChoiceBody(q, v) {
    var picked = Array.isArray(v) ? v : [];
    var single = !q.multiple;
    return (
      head(q, q.prompt || '') +
      '<div class="sp-rq-list" role="' +
      (single ? 'radiogroup' : 'group') +
      '" aria-labelledby="' +
      esc(base(q)) +
      '-p">' +
      (Array.isArray(q.choices) ? q.choices : [])
        .map(function (c) {
          return optionRow(q, single, 'quiz-pick', c.id, c.text, picked.indexOf(c.id) >= 0);
        })
        .join('') +
      '</div>'
    );
  }

  // The prompt and the controls of one quiz question, with no card around them (the quiz draws its own).
  function quizBody(q, v) {
    if (q.kind === 'choice') return quizChoiceBody(q, v);
    if (q.kind === 'true_false') return trueFalseBody(q, v);
    if (q.kind === 'number') return numberBody(q, v);
    if (q.kind === 'text') return textBody(q, v, q.prompt || '');
    return '';
  }

  /* One question's card. ctx: { prompt: the prompt as shown, other: a
     choice's Other is chosen }. */
  function card(q, v, ctx) {
    var c = ctx || {};
    var prompt = c.prompt != null ? c.prompt : q.prompt || '';
    if (q.kind === 'section') {
      var sub = String(opts(q).subtitle || '').trim();
      return (
        '<section class="sp-card sp-rq-section"><h2 class="sp-h2">' +
        esc(prompt) +
        '</h2>' +
        (sub ? '<p class="sp-note">' + esc(sub) + '</p>' : '') +
        '</section>'
      );
    }
    var body = '';
    if (q.kind === 'text') body = textBody(q, v, prompt);
    else if (q.kind === 'choice') body = choiceBody(q, v, prompt, !!c.other);
    else if (q.kind === 'rating') body = ratingBody(q, v, prompt);
    else if (q.kind === 'date') body = dateBody(q, v, prompt);
    else if (q.kind === 'ranking') body = rankingBody(q, v, prompt);
    else if (q.kind === 'likert') body = likertBody(q, v, prompt);
    else return '';
    return '<section class="sp-card" data-qbox="' + esc(q.id) + '">' + body + '</section>';
  }

  // A teacher-built reflection's first card: its title and its description.
  function intro(part) {
    var line = String(part.theme || '').trim();
    return (
      '<section class="sp-card"><h1 class="sp-h1">' +
      esc(part.title || '') +
      '</h1>' +
      (line ? '<p class="sp-note">' + esc(line) + '</p>' : '') +
      '</section>'
    );
  }

  return {
    OTHER: OTHER,
    isNew: isNew,
    owns: owns,
    required: required,
    choicesOf: choicesOf,
    choiceOrder: choiceOrder,
    rankOrder: rankOrder,
    statementsOf: statementsOf,
    otherText: otherText,
    listedChoice: listedChoice,
    choiceKept: choiceKept,
    isAnswered: isAnswered,
    isComplete: isComplete,
    value: value,
    card: card,
    quizBody: quizBody,
    intro: intro,
  };
})();
