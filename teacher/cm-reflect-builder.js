// @ts-check
/* Class Settings, Reflect tab: New Reflection, the builder
   (docs/plans/reflect-plan.md, board 2).

   A teacher builds a reflection the way MS Forms does it: a title and a
   description, then question cards. The card being edited is open with its
   controls; the others show as students will see them, and a click opens
   one. The draft lives here, in memory, until Save; every field is read
   back when it is left and before every action, so nothing redraws while a
   teacher types. What Save sends follows the plan's data contract exactly
   (toContract).

   CmQuestionnaires draws the builder in place of the list while it is open
   and hands over every sqB action, change and blur. */
var CmReflectBuilder = (function () {
  'use strict';

  /* The card pieces (a question's read and edit forms, its list editor and
     toolbar) are teacher/question-cards.js; this builder passes nothing, so
     they use the sqB action names and the limits below. */
  var KINDS = QuestionCards.KINDS;
  var MAX = Object.assign({ title: 120, description: 500 }, QuestionCards.MAX);
  var LIKERT_COLUMNS = ['Never', 'Sometimes', 'Usually', 'Always'];
  var PREVIEW_KEY = 'fv-reflect-preview';

  /** @type {any} */
  var _b = null; // the open draft: { cid, qid, title, description, closes, savedCloses, questions, active, menu, showErrors, msg, saving, base, wasOn, answered }
  var _seq = 0;

  /* The page's other modules (DashClassManager, Questionnaires,
     showConfirm), read where they are used. */
  function _g() {
    return /** @type {any} */ (globalThis);
  }

  function _rerender() {
    var dcm = _g().DashClassManager;
    if (dcm && dcm.renderClassManager) dcm.renderClassManager();
  }

  function _today() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function _clean(s) {
    return String(s == null ? '' : s).trim();
  }

  function _list(arr, max, len) {
    return (arr || [])
      .map(_clean)
      .filter(Boolean)
      .map(function (s) {
        return s.slice(0, len);
      })
      .slice(0, max);
  }

  /* ── The draft ─────────────────────────────────────────────── */

  function _blank(kind) {
    return {
      k: 'k' + ++_seq,
      kind: kind,
      prompt: '',
      subtitle: kind === 'section' ? '' : null,
      required: false,
      choices: kind === 'ranking' ? ['', '', ''] : ['', ''],
      multiple: false,
      other: false,
      dropdown: false,
      shuffle: false,
      long: true,
      levels: 5,
      low: '',
      high: '',
      statements: [''],
      columns: LIKERT_COLUMNS.slice(),
    };
  }

  /* A saved question as a draft card. */
  function fromSaved(x) {
    var o = (x && x.options) || {};
    var d = _blank(x.kind);
    d.id = x.id;
    d.prompt = x.prompt || '';
    d.subtitle = o.subtitle ? String(o.subtitle) : x.kind === 'section' ? '' : null;
    d.required = o.required === true;
    if (x.kind === 'likert') {
      d.statements = (o.statements || []).slice();
      d.columns = (o.choices || []).slice();
    } else if (o.choices) {
      d.choices = o.choices.slice();
    }
    d.multiple = x.kind === 'choice' ? o.multiple !== false : false;
    d.other = !!o.other;
    d.dropdown = !!o.dropdown;
    d.shuffle = !!o.shuffle;
    d.long = o.long !== false;
    d.levels = o.levels || 5;
    d.low = o.low || '';
    d.high = o.high || '';
    return d;
  }

  /* A draft card as the contract's question (reflect plan, "The data
     contract"): only the options its kind takes. */
  function toContract(d) {
    var o = {};
    if (d.kind !== 'section' && d.required) o.required = true;
    var sub = _clean(d.subtitle).slice(0, MAX.subtitle);
    if (sub) o.subtitle = sub;
    if (d.kind === 'text') {
      if (!d.long) o.long = false;
    } else if (d.kind === 'choice') {
      o.choices = _list(d.choices, MAX.choices, MAX.choice);
      if (!d.multiple) o.multiple = false;
      if (d.other) o.other = true;
      if (d.dropdown && !d.multiple) o.dropdown = true;
      if (d.shuffle) o.shuffle = true;
    } else if (d.kind === 'rating') {
      var n = Number(d.levels);
      o.levels = Number.isInteger(n) && n >= 2 && n <= 10 ? n : 5;
      var low = _clean(d.low).slice(0, MAX.end);
      var high = _clean(d.high).slice(0, MAX.end);
      if (low) o.low = low;
      if (high) o.high = high;
    } else if (d.kind === 'ranking') {
      o.choices = _list(d.choices, MAX.items, MAX.choice);
    } else if (d.kind === 'likert') {
      o.statements = _list(d.statements, MAX.statements, MAX.statement);
      o.choices = _list(d.columns, MAX.columns, MAX.column);
    }
    var out = {
      prompt: _clean(d.prompt).slice(0, MAX.prompt),
      kind: d.kind,
      options: o,
      core_ids: [],
      repeated_key: null,
      teacher_only: false,
    };
    if (d.id) out.id = d.id;
    return out;
  }

  function _dupes(list) {
    var seen = {};
    return list.some(function (s) {
      var k = s.toLowerCase();
      if (seen[k]) return true;
      seen[k] = true;
      return false;
    });
  }

  /* What stops a save, in plain words beside the problem:
     { title, none, closes, q: { <card key>: message } }, or null. A past
     closing date is refused only when the teacher picked it: one already
     saved (a reflection that has closed) stays as it is on Save, Keep Off,
     and Save and Turn On clears it (_save). */
  function validate(draft, today) {
    /** @type {any} */
    var e = { q: {} };
    var bad = false;
    if (!_clean(draft.title)) {
      e.title = 'Give the reflection a title.';
      bad = true;
    }
    var asks = (draft.questions || []).filter(function (d) {
      return d.kind !== 'section';
    });
    if (!asks.length) {
      e.none = 'Add at least one question.';
      bad = true;
    }
    if (draft.closes && draft.closes !== (draft.savedCloses || '') && draft.closes < (today || _today())) {
      e.closes = 'Pick today or a later day, or leave it empty.';
      bad = true;
    }
    (draft.questions || []).forEach(function (d) {
      var c = toContract(d);
      var o = c.options;
      /** @type {string|null} */
      var msg = null;
      if (!c.prompt) msg = d.kind === 'section' ? 'Write the heading.' : 'Write the question.';
      else if (d.kind === 'choice' && o.choices.length < 2) msg = 'Give at least two options.';
      else if (d.kind === 'choice' && _dupes(o.choices)) msg = 'Two options say the same thing.';
      else if (d.kind === 'ranking' && o.choices.length < 2) msg = 'Give at least two items to put in order.';
      else if (d.kind === 'ranking' && _dupes(o.choices)) msg = 'Two items say the same thing.';
      else if (d.kind === 'likert' && (o.statements.length < 1 || o.choices.length < 2))
        msg = 'Give at least one statement and two columns.';
      else if (d.kind === 'likert' && (_dupes(o.statements) || _dupes(o.choices)))
        msg = 'Two statements or two columns say the same thing.';
      if (msg) {
        e.q[d.k] = msg;
        bad = true;
      }
    });
    return bad ? e : null;
  }

  function _snapshot() {
    return JSON.stringify({
      t: _clean(_b.title),
      d: _clean(_b.description),
      c: _b.closes || '',
      q: _b.questions.map(toContract),
    });
  }

  function isOpen(cid) {
    return !!_b && _b.cid === cid;
  }

  /* On in the students' Reflect tab: on and not past its closing date. One
     on but closed shows as Off on its card ("Closed Feb 1"), so the builder
     offers Save, Keep Off and Save and Turn On for it, as for one that is
     off (cm-questionnaires.js _isOn). */
  function _isOn(q) {
    if (!q || !q.is_on) return false;
    var Q = _g().Questionnaires;
    return !(Q && Q.status && Q.status(q, _today()).state === 'closed');
  }

  /* Opens the builder for a new reflection (q null) or a teacher-built one. */
  function open(cid, q) {
    _listen();
    _b = {
      cid: cid,
      qid: q ? q.id : null,
      title: q ? q.title || '' : '',
      description: q ? q.theme || '' : '',
      closes: q ? q.closes_on || '' : '',
      savedCloses: q ? q.closes_on || '' : '',
      questions: q
        ? (q.questions || [])
            .filter(function (x) {
              return !x.archived;
            })
            .map(fromSaved)
        : [],
      active: -1,
      menu: -1,
      past: [], // the Undo list: { qs, active, label }, newest last
      showErrors: false,
      msg: '',
      saving: false,
      wasOn: _isOn(q),
      answered: !!(q && (q.answered || []).length),
    };
    if (!q) {
      _b.questions.push(_blank('choice'));
      _b.active = 0;
    }
    _b.base = _snapshot();
  }

  function close() {
    _b = null;
  }

  /* ── Reading the fields back ──────────────────────────────── */

  function _set(i, path, value) {
    if (!_b) return;
    if (i == null || i === '') {
      if (path === 'title' || path === 'description' || path === 'closes') _b[path] = value;
      return;
    }
    var d = _b.questions[Number(i)];
    if (!d) return;
    var parts = String(path).split('.');
    if (parts.length === 2 && Array.isArray(d[parts[0]])) d[parts[0]][Number(parts[1])] = value;
    else if (['prompt', 'subtitle', 'low', 'high'].indexOf(path) >= 0) d[path] = value;
  }

  function _sync() {
    if (!_b || typeof document === 'undefined') return;
    var root = document.querySelector('.rb-build[data-rb-open]');
    if (!root) return;
    root.querySelectorAll('[data-rb-path]').forEach(function (/** @type {any} */ el) {
      _set(el.dataset.i, el.dataset.rbPath, el.value);
    });
  }

  /* ── Moving (pure: the tests call these) ─────────────────────
     As One Report moves a reflection's statements (DECISIONS, "Reflect's
     builder works the way One Report's editor does" 2). A heading carries
     the questions under it, up to the next heading: its block (questions
     before the first heading are a block with no heading). A heading moves
     past the whole block next to it; a question moves one card at a time,
     past a heading into the block next to it. */

  /* The blocks of a list of cards: [{ start, end, head }], end exclusive. */
  function blocksOf(qs) {
    var out = [];
    (qs || []).forEach(function (d, i) {
      if (d.kind === 'section' || !out.length) out.push({ start: i, end: i + 1, head: d.kind === 'section' });
      else out[out.length - 1].end = i + 1;
    });
    return out;
  }

  function _blockAt(qs, i) {
    return blocksOf(qs).filter(function (b) {
      return i >= b.start && i < b.end;
    })[0];
  }

  /* The cards from..to (exclusive) moved to sit before card `before`. */
  function _shift(qs, from, to, before) {
    if (before >= from && before <= to) return qs.slice();
    var out = qs.slice();
    var run = out.splice(from, to - from);
    var at = before > from ? before - run.length : before;
    Array.prototype.splice.apply(out, [at, 0].concat(run));
    return out;
  }

  /* Card i one step up (dir -1) or down (1): a question one card, a heading
     with its block past the block next to it. The same list when it cannot. */
  function moveBy(qs, i, dir) {
    var d = qs[i];
    if (!d) return qs.slice();
    if (d.kind !== 'section') {
      var j = i + dir;
      if (j < 0 || j >= qs.length) return qs.slice();
      return _shift(qs, i, i + 1, dir < 0 ? j : j + 1);
    }
    var all = blocksOf(qs);
    var at = all.findIndex(function (b) {
      return b.start === i;
    });
    var other = all[at + dir];
    if (!other) return qs.slice();
    return dir < 0 ? _shift(qs, i, all[at].end, other.start) : _shift(qs, i, all[at].end, other.end);
  }

  /* Question i to the foot of the block that starts at card `start`. */
  function moveTo(qs, i, start) {
    var b = _blockAt(qs, start);
    if (!qs[i] || qs[i].kind === 'section' || !b || (i >= b.start && i < b.end)) return qs.slice();
    return _shift(qs, i, i + 1, b.end);
  }

  /* Card i (a heading with its block) dragged to sit before card `before`
     (qs.length: the end). A heading lands only at the top, before another
     heading or at the end. */
  function dropAt(qs, i, before) {
    var d = qs[i];
    if (!d) return qs.slice();
    if (d.kind !== 'section') return _shift(qs, i, i + 1, before);
    var b = _blockAt(qs, i);
    if (before > 0 && before < qs.length && (!qs[before] || qs[before].kind !== 'section')) return qs.slice();
    return _shift(qs, b.start, b.end, before);
  }

  /* What a question added before card `at` is: the type of the nearest
     question above it, a Choice when there is none
     (DECISIONS, "Reflect's builder works the way One Report's editor does" 3). */
  function kindAbove(qs, at) {
    for (var k = Math.min(at, (qs || []).length) - 1; k >= 0; k--) if (qs[k].kind !== 'section') return qs[k].kind;
    return 'choice';
  }

  /* Whether "Start a New Heading Here" fits question i: not when it is
     already the first question under its heading (or the very first). */
  function canStartHeading(qs, i) {
    var b = _blockAt(qs, i);
    if (!b || !qs[i] || qs[i].kind === 'section') return false;
    return i > (b.head ? b.start + 1 : b.start);
  }

  /* ── Drawing ───────────────────────────────────────────────── */

  /* A saved reflection's questions as students see them (the card's Show Questions). */
  function previewHtml(questions) {
    var num = 0;
    return (
      '<ol class="rb-qs rb-qs-view">' +
      (questions || [])
        .filter(function (x) {
          return !x.archived;
        })
        .map(function (x, i) {
          var d = fromSaved(x);
          if (d.kind !== 'section') num++;
          return '<li class="rb-q">' + QuestionCards.viewHtml(d, i, num, false) + '</li>';
        })
        .join('') +
      '</ol>'
    );
  }

  /* The ⋯ menu's moving items for card i (QuestionCards opts.more). */
  function _moreItems(d, i) {
    var qs = _b.questions;
    var same = function (next) {
      return next.every(function (x, k) {
        return x === qs[k];
      });
    };
    if (d.kind === 'section') {
      var b = _blockAt(qs, i);
      return [
        { label: 'Move Heading Up', action: 'sqBUp', off: same(moveBy(qs, i, -1)) },
        { label: 'Move Heading Down', action: 'sqBDown', off: same(moveBy(qs, i, 1)) },
        null,
        {
          label: b && b.end - b.start > 1 ? 'Remove Heading, Keep Its Questions' : 'Remove Heading',
          action: 'sqBDelete',
          danger: true,
        },
      ];
    }
    /** @type {any[]} */
    var out = [null, { label: 'Add a Question Below', action: 'sqBAddAt', data: { at: i + 1 } }];
    if (canStartHeading(qs, i))
      out.push({ label: 'Start a New Heading Here', action: 'sqBAddAt', data: { at: i, kind: 'section' } });
    out.push(
      null,
      { label: 'Move Up', action: 'sqBUp', off: i === 0 },
      { label: 'Move Down', action: 'sqBDown', off: i === qs.length - 1 },
    );
    var mine = _blockAt(qs, i);
    var others = blocksOf(qs).filter(function (b) {
      return !mine || b.start !== mine.start;
    });
    if (others.length) {
      out.push({ sub: 'Move To' });
      others.forEach(function (b) {
        out.push({
          label: b.head ? _clean(qs[b.start].prompt) || 'Untitled Heading' : 'No Heading',
          action: 'sqBMoveTo',
          data: { to: b.start },
        });
      });
    }
    out.push(null, { label: 'Remove Question', action: 'sqBDelete', danger: true });
    return out;
  }

  var CARD_OPTS = { arrows: false, more: _moreItems };

  function render(cid) {
    if (!isOpen(cid)) return '';
    var errs = _b.showErrors ? validate(_b) : null;
    var num = 0;
    var last = _b.questions.length - 1;
    var cards = _b.questions
      .map(function (d, i) {
        if (d.kind !== 'section') num++;
        var on = i === _b.active;
        var err = errs && errs.q[d.k];
        return (
          '<li class="rb-q' +
          (on ? ' rb-q-on' : '') +
          (err ? ' rb-q-bad' : '') +
          '" data-k="' +
          d.k +
          '" data-i="' +
          i +
          '">' +
          '<button type="button" class="rb-q-grip" tabindex="-1" aria-hidden="true" data-rb-grip="' +
          i +
          '">⠿</button>' +
          (on
            ? QuestionCards.editHtml(d, i, num, i === last, _b.menu === i, CARD_OPTS)
            : QuestionCards.viewHtml(d, i, num, true, CARD_OPTS)) +
          (err ? '<div class="rb-err" role="alert">' + esc(err) + '</div>' : '') +
          '</li>'
        );
      })
      .join('');
    var errLine = function (msg) {
      return msg ? '<div class="rb-err" role="alert">' + esc(msg) + '</div>' : '';
    };
    var editing = !!_b.qid;
    var buttons =
      editing && _b.wasOn
        ? '<button type="button" class="btn btn-primary" data-action="sqBSave" data-on="keep"' +
          (_b.saving ? ' disabled' : '') +
          '>Save</button>'
        : '<button type="button" class="cm-action-btn" data-action="sqBSave" data-on="0"' +
          (_b.saving ? ' disabled' : '') +
          '>Save, Keep Off</button>' +
          '<button type="button" class="btn btn-primary" data-action="sqBSave" data-on="1"' +
          (_b.saving ? ' disabled' : '') +
          '>Save and Turn On</button>';
    return (
      '<div class="rb-build" data-rb-open="1">' +
      '<div class="rb-top"><div class="cm-section-title">' +
      (editing ? 'Edit Reflection' : 'New Reflection') +
      '</div><button type="button" class="cm-action-btn rb-preview-btn" data-action="sqBPreview">' +
      QuestionCards.icon('phone') +
      'Preview as a Student</button></div>' +
      '<div class="rb-heads">' +
      '<input type="text" class="rb-name" id="rb-name" aria-label="Title" placeholder="Title" maxlength="' +
      MAX.title +
      '" value="' +
      esc(_b.title) +
      '" data-action-blur="sqBField" data-rb-path="title">' +
      errLine(errs && errs.title) +
      '<input type="text" class="rb-desc" id="rb-desc" aria-label="Description" placeholder="Description (optional)" maxlength="' +
      MAX.description +
      '" value="' +
      esc(_b.description) +
      '" data-action-blur="sqBField" data-rb-path="description">' +
      '</div>' +
      '<ol class="rb-qs">' +
      cards +
      '</ol>' +
      '<div class="rb-add"><span class="rb-add-label">Add a Question</span>' +
      KINDS.map(function (k) {
        return (
          '<button type="button" class="rb-add-btn' +
          (k.kind === 'section' ? ' rb-add-section' : '') +
          '" data-action="sqBAdd" data-kind="' +
          k.kind +
          '">' +
          esc(k.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      errLine(errs && errs.none) +
      '<div class="rb-footer"><div class="rb-closes"><label class="cm-label" for="rb-closes">Closes (Optional)</label>' +
      '<input type="date" class="cm-input" id="rb-closes" value="' +
      esc(_b.closes || '') +
      '" data-action-blur="sqBField" data-action-change="sqBField" data-rb-path="closes">' +
      errLine(errs && errs.closes) +
      '</div><div class="rb-buttons"><button type="button" class="btn btn-ghost" data-action="sqBCancel">Cancel</button>' +
      buttons +
      '</div></div>' +
      (errs ? '<div class="rb-msg" role="status">Fix the problems marked above, then save again.</div>' : '') +
      (_b.msg ? '<div class="rb-msg" role="status">' + esc(_b.msg) + '</div>' : '') +
      (_b.answered
        ? '<div class="cm-hint">Students have already answered this. Their answers stay, even for questions you remove.</div>'
        : '') +
      '<div class="cm-hint">Changes apply to this class only. To use it in another class, choose Copy to Another Class on its card.</div>' +
      '</div>'
    );
  }

  /* ── Motion: a moved card glides from its old place (FLIP) ── */

  function _tops() {
    var out = {};
    if (typeof document === 'undefined') return out;
    document.querySelectorAll('.rb-q[data-k]').forEach(function (/** @type {any} */ el) {
      if (el.getBoundingClientRect) out[el.dataset.k] = el.getBoundingClientRect().top;
    });
    return out;
  }

  function _glide(before) {
    if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('.rb-q[data-k]').forEach(function (/** @type {any} */ el) {
      var was = before[el.dataset.k];
      if (was == null) return;
      var dy = was - el.getBoundingClientRect().top;
      if (!dy) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + dy + 'px)';
      el.getBoundingClientRect();
      requestAnimationFrame(function () {
        el.style.transition = 'transform 200ms ease';
        el.style.transform = '';
        el.addEventListener(
          'transitionend',
          function () {
            el.style.transition = '';
          },
          { once: true },
        );
      });
    });
  }

  function _focus(selector) {
    if (typeof document === 'undefined') return;
    var el = document.querySelector(selector);
    if (el && el.focus) el.focus();
  }

  /* ── Undo (DECISIONS, "Reflect's builder works the way One Report's
     editor does" 4) ─────────────────────────────────────────────
     Every add, copy, move and remove goes on the draft's Undo list first;
     ⌘Z outside a text box steps back through it, and a remove's toast has
     Undo too. The list holds the cards themselves, so words typed since
     stay. It goes with the draft (Save, Cancel). */

  function _push(label) {
    _b.past.push({ qs: _b.questions.slice(), active: _b.active, label: label });
    if (_b.past.length > 50) _b.past.shift();
    return _b.past[_b.past.length - 1];
  }

  /* Steps back to `step` (the newest on the list), or to the newest. */
  function _undo(step) {
    if (!_b || !_b.past.length) return false;
    var top = _b.past[_b.past.length - 1];
    if (step && step !== top) return false;
    _settle();
    _b.past.pop();
    var before = _tops();
    _b.questions = top.qs;
    _b.active = top.active;
    _b.menu = -1;
    _hideIns();
    _rerender();
    _glide(before);
    var g = _g();
    if (!step && typeof g.dismissUndoToast === 'function') g.dismissUndoToast();
    _say('Undid: ' + top.label + '.');
    return true;
  }

  /* What a card is called in a toast or to a screen reader. */
  function _cardName(qs, i) {
    var d = qs[i];
    var words = _clean(d && d.prompt);
    if (d && d.kind === 'section') return words ? 'the heading “' + words + '”' : 'a heading';
    var num = 0;
    for (var k = 0; k <= i; k++) if (qs[k].kind !== 'section') num++;
    return 'question ' + num + (words ? ', “' + words + '”' : '');
  }

  function _remove(i) {
    var qs = _b.questions;
    if (!qs[i]) return;
    var label = 'Removed ' + _cardName(qs, i);
    var step = _push(label);
    _settle();
    var before = _tops();
    _b.questions = qs.slice(0, i).concat(qs.slice(i + 1));
    _b.active = -1;
    _b.menu = -1;
    _rerender();
    _glide(before);
    var g = _g();
    if (typeof g.showUndoToast === 'function')
      g.showUndoToast(label, function () {
        _undo(step);
      });
    else _say(label + '.');
  }

  /* A card moved: the new list drawn, the cards gliding from where they
     were, the moved card still the one open (when it was), and the focus
     back where the teacher was: `back` is 'menu' (the card's ⋯), or the id
     of the box being typed in with its caret. A screen reader hears where
     it went. */
  function _moveCard(next, d, back, caret) {
    var qs = _b.questions;
    if (
      next.every(function (x, k) {
        return x === qs[k];
      })
    )
      return false;
    _push('Moved ' + _cardName(qs, qs.indexOf(d)));
    _settle();
    var open = _b.active >= 0 ? qs[_b.active] : null;
    var before = _tops();
    _b.questions = next;
    _b.active = open ? next.indexOf(open) : -1;
    _b.menu = -1;
    _rerender();
    _glide(before);
    if (back === 'menu') _focus('.rb-q[data-k="' + d.k + '"] .rb-qmore-btn');
    else if (back) {
      var el = /** @type {any} */ (typeof document !== 'undefined' ? document.getElementById(back) : null);
      if (el && el.focus) {
        el.focus();
        if (caret && el.setSelectionRange) {
          try {
            el.setSelectionRange(caret[0], caret[1]);
          } catch (e) {
            /* a box with no caret (a date, a list) */
          }
        }
      }
    }
    _say(_movedText(d));
    return true;
  }

  function _movedText(d) {
    var qs = _b.questions;
    var at = qs.indexOf(d);
    var num = 0;
    for (var k = 0; k <= at; k++) if (qs[k].kind !== 'section') num++;
    if (d.kind === 'section') return 'Moved the heading ' + (_clean(d.prompt) || 'Untitled Heading') + '.';
    var b = _blockAt(qs, at);
    var head = b && b.head ? _clean(qs[b.start].prompt) : '';
    return 'Moved to question ' + num + (head ? ', under ' + head : '') + '.';
  }

  /* Said to a screen reader, from a box outside the redraw. */
  function _say(text) {
    if (typeof document === 'undefined' || !document.body) return;
    var box = document.getElementById('rb-said');
    if (!box) {
      box = document.createElement('div');
      box.id = 'rb-said';
      box.className = 'rb-said';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    box.textContent = '';
    var b = box;
    setTimeout(function () {
      b.textContent = text;
    }, 30);
  }

  /* The box being typed in saves now, by the place it was drawn at. A
     redraw takes it away, and a blur after a card was added, removed or
     moved would save its words into whichever card has that place by then
     (Safari keeps the focus in the box when a button is clicked). */
  function _settle() {
    var typing = /** @type {any} */ (typeof document !== 'undefined' ? document.activeElement : null);
    if (typing && typing.blur && typing.closest && typing.closest('.rb-build') && typing.dataset.rbPath != null)
      typing.blur();
  }

  /* ── The + between two cards ───────────────────────────────
     Pointing at the line between two cards (or above the first) shows a +
     in the left margin; pointing at the + parts the cards and offers Add a
     Question and Add a Heading, as One Report's + does. It is for the
     pointer: the keyboard adds from ⋯. */

  var PART = 20; // px the cards part by, on top of .rb-qs's 12px gap
  /** @type {any} */
  var _ins = null; // { el, at, y, open, next }

  /* The places between cards: { at, y } in page coordinates, y the middle of the gap. */
  function _gaps() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.rb-build[data-rb-open] .rb-qs > .rb-q'));
    var out = [];
    cards.forEach(function (/** @type {any} */ el, k) {
      var r = el.getBoundingClientRect();
      if (k === 0) out.push({ at: 0, y: r.top - GAP / 2, el: el });
      else out.push({ at: k, y: (cards[k - 1].getBoundingClientRect().bottom + r.top) / 2, el: el });
    });
    return out;
  }

  function _hideIns() {
    var ins = _ins;
    _ins = null;
    if (!ins) return;
    if (ins.el.parentNode) ins.el.parentNode.removeChild(ins.el);
    if (ins.next) ins.next.classList.remove('rb-q-parted');
  }

  function _part(open) {
    if (!_ins || _ins.open === open) return;
    _ins.open = open;
    _ins.el.classList.toggle('open', open);
    if (_ins.next) _ins.next.classList.toggle('rb-q-parted', open);
  }

  function _onPointerMove(e) {
    if (!_b || _drag || e.pointerType === 'touch') return;
    var t = /** @type {any} */ (e.target);
    var build = t && t.closest ? t.closest('.rb-build[data-rb-open]') : null;
    if (_ins && _ins.el.contains(t)) return;
    if (!build || (t.closest && t.closest('.rb-qmenu'))) return _hideIns();
    var list = build.querySelector('.rb-qs');
    var lr = list.getBoundingClientRect();
    if (e.clientX < lr.left - 44 || e.clientX > lr.right) return _hideIns();
    /** @type {any} */
    var best = null;
    _gaps().forEach(function (g) {
      var dd = Math.abs(e.clientY - g.y);
      if (dd <= 8 && (!best || dd < best.d)) best = { at: g.at, y: g.y, d: dd, el: g.el };
    });
    if (!best) {
      if (_ins && !_ins.open) _hideIns();
      return;
    }
    if (_ins && _ins.at === best.at) return;
    _hideIns();
    var br = build.getBoundingClientRect();
    var box = document.createElement('div');
    box.className = 'rb-ins';
    box.style.top = best.y - br.top + 'px';
    box.style.left = lr.left - br.left + 'px';
    box.style.width = lr.width + 'px';
    var kind = esc(kindAbove(_b.questions, best.at));
    var at = Number(best.at);
    // html-safe: fixed markup; at is a number and kind passes through esc
    box.innerHTML =
      '<div class="rb-ins-line"></div><button type="button" class="rb-ins-plus" tabindex="-1" aria-hidden="true">+</button>' +
      '<div class="rb-ins-acts">' +
      '<button type="button" tabindex="-1" data-action="sqBAddAt" data-at="' +
      at +
      '" data-kind="' +
      kind +
      '">Add a Question</button>' +
      '<button type="button" tabindex="-1" data-action="sqBAddAt" data-at="' +
      at +
      '" data-kind="section">Add a Heading</button></div>';
    build.appendChild(box);
    _ins = { el: box, at: best.at, open: false, next: best.el };
    var plus = box.querySelector('.rb-ins-plus');
    if (plus)
      plus.addEventListener('mouseenter', function () {
        _part(true);
      });
    box.addEventListener('mouseleave', function () {
      _hideIns();
    });
  }

  /* A new card of `kind` before card `at`, open with the cursor in it. */
  function _addAt(at, kind) {
    at = Math.max(0, Math.min(at, _b.questions.length));
    var added = _blank(kind);
    _settle();
    var tops = _tops();
    _push(kind === 'section' ? 'Added a heading' : 'Added a question');
    _b.questions.splice(at, 0, added);
    _b.active = at;
    _b.menu = -1;
    _hideIns();
    _rerender();
    _glide(tops);
    _focus('#rb-' + added.k + '-prompt');
    _say(kind === 'section' ? 'Added a heading.' : 'Added a question.');
  }

  /* ── Enter (DECISIONS, "Reflect's builder works the way One Report's
     editor does" 5) ─────────────────────────────────────────────
     Enter goes to where the next words go, down the card, then makes the
     next one, as One Report's Enter does: the title to the description to
     the open card; a question to the first box under it; an option (item,
     statement, column) with words to the empty one under it or a new one;
     the last one,
     empty, goes and a question is added below; a card with nothing more
     to fill adds a question below. Only an Enter does any of it. */

  var LISTS = {
    choice: [{ list: 'choices', min: 2, max: 'choices' }],
    ranking: [{ list: 'choices', min: 2, max: 'items' }],
    likert: [
      { list: 'statements', min: 1, max: 'statements' },
      { list: 'columns', min: 2, max: 'columns' },
    ],
  };

  function _box(d, path) {
    return '#rb-' + d.k + '-' + String(path).replace('.', '-');
  }

  /* The first box under the question's own words (and its subtitle). */
  function _firstBelow(d, fromSubtitle) {
    if (!fromSubtitle && d.subtitle !== null) return _box(d, 'subtitle');
    if (LISTS[d.kind]) return _box(d, LISTS[d.kind][0].list + '.0');
    if (d.kind === 'rating') return _box(d, 'low');
    return null;
  }

  /* After card i: the next question under a heading, or a new question. */
  function _onward(i) {
    var d = _b.questions[i];
    var next = _b.questions[i + 1];
    if (d.kind === 'section' && next && next.kind !== 'section') {
      _b.active = i + 1;
      _rerender();
      _focus(_box(next, 'prompt'));
      return;
    }
    _addAt(i + 1, d.kind === 'section' ? kindAbove(_b.questions, i + 1) : d.kind);
  }

  function _onEnter(t) {
    var path = t.dataset.rbPath;
    _sync();
    _settle();
    if (path === 'title') return _focus('#rb-desc');
    if (path === 'description') {
      if (!_b.questions.length) return;
      if (_b.active < 0) {
        _b.active = 0;
        _rerender();
      }
      return _focus(_box(_b.questions[_b.active], 'prompt'));
    }
    var i = Number(t.dataset.i);
    var d = _b.questions[i];
    if (!d) return;
    if (path === 'prompt' || path === 'subtitle') {
      var below = _firstBelow(d, path === 'subtitle');
      return below ? _focus(below) : _onward(i);
    }
    if (path === 'low') return _focus(_box(d, 'high'));
    if (path === 'high') return _onward(i);
    var parts = String(path).split('.');
    var spec = (LISTS[d.kind] || []).filter(function (x) {
      return x.list === parts[0];
    })[0];
    if (!spec || !Array.isArray(d[spec.list])) return;
    var list = d[spec.list];
    var j = Number(parts[1]);
    var last = j === list.length - 1;
    if (_clean(list[j])) {
      if (!last && !_clean(list[j + 1])) return _focus(_box(d, spec.list + '.' + (j + 1)));
      if (list.length >= MAX[spec.max]) return last ? undefined : _focus(_box(d, spec.list + '.' + (j + 1)));
      list.splice(j + 1, 0, '');
      _rerender();
      return _focus(_box(d, spec.list + '.' + (j + 1)));
    }
    if (!last) return _focus(_box(d, spec.list + '.' + (j + 1)));
    // The last one, empty: it goes (while the list keeps its least), then onward.
    if (list.length > spec.min) list.splice(j, 1);
    // A Likert's statements lead on to its columns.
    if (spec.list === 'statements') {
      _rerender();
      return _focus(_box(d, 'columns.0'));
    }
    _onward(i);
  }

  /* ⌘Z (Ctrl+Z) on the builder, outside a text box (where it undoes typing). */
  function _isUndoKey(e) {
    if (!_b || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return false;
    if (typeof document === 'undefined' || !document.querySelector('.rb-build[data-rb-open]')) return false;
    var t = /** @type {any} */ (e.target);
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
    return !document.querySelector('.confirm-overlay, body.rb-dragging');
  }

  /* ⌥↑ ⌥↓ in the card being edited move it, the caret staying put. */
  function _onKey(e) {
    if (_isUndoKey(e)) {
      if (_undo(null)) e.preventDefault();
      return;
    }
    if (
      _b &&
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.isComposing &&
      e.target &&
      e.target.tagName === 'INPUT' &&
      e.target.type === 'text' &&
      e.target.closest &&
      e.target.closest('.rb-build[data-rb-open]') &&
      e.target.dataset.rbPath != null
    ) {
      e.preventDefault();
      _onEnter(e.target);
      return;
    }
    if (!_b || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    var t = /** @type {any} */ (e.target);
    if (!t || !t.closest || !t.closest('.rb-build[data-rb-open] .rb-q-on')) return;
    e.preventDefault();
    _sync();
    var i = _b.active;
    var d = _b.questions[i];
    if (!d) return;
    var caret = typeof t.selectionStart === 'number' ? [t.selectionStart, t.selectionEnd] : null;
    _moveCard(moveBy(_b.questions, i, e.key === 'ArrowUp' ? -1 : 1), d, t.id || 'menu', caret);
  }

  /* ── Dragging a card by its ⠿ ──────────────────────────────── */

  var GAP = 12; // .rb-qs's gap
  /** @type {any} */
  var _drag = null;

  function _onPointerDown(e) {
    if (!_b || e.button !== 0) return;
    var g = e.target && e.target.closest ? e.target.closest('.rb-build[data-rb-open] [data-rb-grip]') : null;
    if (!g) return;
    e.preventDefault();
    _sync();
    var i = Number(g.dataset.rbGrip);
    var d = _b.questions[i];
    if (!d) return;
    var cards = Array.prototype.slice.call(document.querySelectorAll('.rb-build[data-rb-open] .rb-q[data-k]'));
    var b = d.kind === 'section' ? _blockAt(_b.questions, i) : { start: i, end: i + 1 };
    var rows = cards.map(function (el, k) {
      return { el: el, i: k, rect: el.getBoundingClientRect(), moving: k >= b.start && k < b.end };
    });
    var moving = rows.filter(function (r) {
      return r.moving;
    });
    if (!moving.length) return;
    var top = moving[0].rect.top;
    var bottom = moving[moving.length - 1].rect.bottom;
    _drag = {
      i: i,
      d: d,
      rows: rows,
      moving: moving,
      cands: rows.filter(function (r) {
        return !r.moving;
      }),
      y0: e.clientY,
      grab: e.clientY - top,
      h: bottom - top + GAP,
      span: Math.min(bottom - top, 80),
      at: -1,
    };
    _b.menu = -1;
    _hideIns();
    moving.forEach(function (r) {
      r.el.classList.add('rb-q-lift');
    });
    rows.forEach(function (r) {
      if (!r.moving) r.el.classList.add('rb-q-shift');
    });
    document.body.classList.add('rb-dragging');
    window.addEventListener('pointermove', _onDragMove);
    window.addEventListener('pointerup', _onDragEnd);
    window.addEventListener('pointercancel', _onDragEnd);
  }

  /* Where the dragged cards would land: they go before cands[at]
     (cands.length: the end). A heading lands only at the top, before
     another heading or at the end. */
  function _landing(y) {
    var dr = _drag;
    var c = dr.cands;
    var mid = y - dr.grab + dr.span / 2;
    var at = 0;
    c.forEach(function (r, k) {
      if (r.rect.top + r.rect.height / 2 < mid) at = k + 1;
    });
    if (dr.d.kind !== 'section') return at;
    var best = c.length;
    var gap = Infinity;
    for (var k = 0; k <= c.length; k++) {
      if (k > 0 && k < c.length && _b.questions[c[k].i].kind !== 'section') continue;
      if (Math.abs(k - at) < gap) {
        gap = Math.abs(k - at);
        best = k;
      }
    }
    return best;
  }

  function _onDragMove(e) {
    var dr = _drag;
    if (!dr) return;
    var dy = e.clientY - dr.y0;
    dr.moving.forEach(function (r) {
      r.el.style.transform = 'translateY(' + dy + 'px)';
    });
    var at = _landing(e.clientY);
    if (at === dr.at) return;
    dr.at = at;
    // The cards between the old place and the new one make room.
    var first = dr.moving[0].i;
    dr.cands.forEach(function (r, k) {
      var shift = 0;
      if (r.i < first && k >= at) shift = dr.h;
      if (r.i > first && k < at) shift = -dr.h;
      r.el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  function _onDragEnd() {
    var dr = _drag;
    _drag = null;
    window.removeEventListener('pointermove', _onDragMove);
    window.removeEventListener('pointerup', _onDragEnd);
    window.removeEventListener('pointercancel', _onDragEnd);
    if (typeof document !== 'undefined') document.body.classList.remove('rb-dragging');
    if (!dr || !_b) return;
    var c = dr.cands;
    var before = dr.at < 0 ? -1 : dr.at < c.length ? c[dr.at].i : _b.questions.length;
    var moved = before >= 0 && _moveCard(dropAt(_b.questions, dr.i, before), dr.d, null);
    if (moved) return;
    // Back where it was.
    dr.rows.forEach(function (r) {
      r.el.style.transform = '';
      r.el.classList.remove('rb-q-lift');
      r.el.classList.add('rb-q-shift');
    });
    setTimeout(function () {
      dr.rows.forEach(function (r) {
        r.el.classList.remove('rb-q-shift');
      });
    }, 220);
  }

  var _listening = false;
  function _listen() {
    if (_listening || typeof document === 'undefined') return;
    _listening = true;
    document.addEventListener('pointerdown', _onPointerDown);
    document.addEventListener('pointermove', _onPointerMove);
    document.addEventListener('keydown', _onKey);
  }

  /* ── Actions ───────────────────────────────────────────────── */

  function _closeAndDraw() {
    var g = _g();
    if (typeof g.dismissUndoToast === 'function') g.dismissUndoToast();
    close();
    _rerender();
  }

  function _payload() {
    return {
      title: _clean(_b.title),
      description: _clean(_b.description),
      questions: _b.questions.map(toContract),
    };
  }

  function _preview() {
    var cid = _b.cid;
    var p = _payload();
    var course = typeof COURSES !== 'undefined' && COURSES[cid] ? COURSES[cid] : {};
    try {
      localStorage.setItem(
        PREVIEW_KEY,
        JSON.stringify({
          title: p.title,
          description: p.description,
          course: { name: course.name || '' },
          questions: p.questions,
        }),
      );
    } catch (e) {
      /* a full device: the preview opens with nothing to show */
    }
    /* The query changes each time: the same address in a window already on
       it is only a move within the page, which would not read the new draft. */
    var w = window.open(
      '/s/?preview=' + Date.now() + '#preview-reflection',
      'fv-reflect-preview',
      'popup=yes,width=400,height=820',
    );
    _b.msg = w ? '' : 'The preview window was blocked. Allow pop-ups for this site, then try again.';
    if (!w) _rerender();
  }

  function _save(on) {
    var errs = validate(_b);
    if (errs) {
      _b.showErrors = true;
      var errsQ = errs.q;
      var bad = _b.questions.findIndex(function (/** @type {any} */ d) {
        return errsQ[d.k];
      });
      if (bad >= 0 && !errs.title) _b.active = bad;
      _b.menu = -1;
      _rerender();
      return Promise.resolve(null);
    }
    var cid = _b.cid;
    var prev = _b.qid
      ? _g().Questionnaires.find(cid, function (x) {
          return x.id === _b.qid;
        })
      : null;
    var isOn = on === 'keep' ? _b.wasOn : on === '1';
    var today = _today();
    var p = _payload();
    var opens = prev ? prev.opens_on || null : null;
    if (isOn && !(opens && opens <= today)) opens = today;
    // Turned On with a past closing date it already had: the date goes, as the tab's switch does.
    var closes = _b.closes || null;
    if (isOn && closes && closes < today) closes = null;
    var draft = _b;
    draft.saving = true;
    draft.msg = '';
    var saving = _g().Questionnaires.saveCustom(cid, {
      id: draft.qid,
      title: p.title,
      theme: p.description,
      opens_on: opens,
      closes_on: closes,
      is_on: isOn,
      questions: p.questions,
    });
    _rerender();
    return saving.then(function (row) {
      if (_b !== draft) return row;
      if (!row) {
        draft.saving = false;
        draft.msg = 'Could not save this reflection. Check the connection and try again.';
        _rerender();
        return null;
      }
      _closeAndDraw();
      return row;
    });
  }

  function _cancel() {
    var confirm = _g().showConfirm;
    if (_snapshot() === _b.base || typeof confirm !== 'function') return _closeAndDraw();
    confirm(
      'Discard Your Changes?',
      'The changes to this reflection are not saved. Discard them?',
      'Discard Changes',
      'danger',
      _closeAndDraw,
    );
  }

  function handleAction(action, el) {
    if (!_b || !/^sqB/.test(action)) return false;
    _sync();
    _settle();
    var i = el.dataset.i != null && el.dataset.i !== '' ? Number(el.dataset.i) : -1;
    var d = i >= 0 ? _b.questions[i] : null;
    if (action !== 'sqBMenu') _b.menu = -1;
    switch (action) {
      case 'sqBEdit':
        if (_b.active === i) return true;
        _b.active = i;
        _rerender();
        if (d) _focus('#rb-' + d.k + '-prompt');
        return true;
      case 'sqBAdd': {
        var n = _blank(el.dataset.kind || 'choice');
        _push(n.kind === 'section' ? 'Added a heading' : 'Added a question');
        _b.questions.push(n);
        _b.active = _b.questions.length - 1;
        _rerender();
        _focus('#rb-' + n.k + '-prompt');
        return true;
      }
      case 'sqBAddAt': {
        var at = Number(el.dataset.at);
        _addAt(at, el.dataset.kind === 'section' ? 'section' : kindAbove(_b.questions, at));
        return true;
      }
      case 'sqBCopy': {
        if (!d) return true;
        var c = JSON.parse(JSON.stringify(d));
        delete c.id;
        delete c.savedId;
        c.k = 'k' + ++_seq;
        _push('Copied ' + _cardName(_b.questions, i));
        _b.questions.splice(i + 1, 0, c);
        _b.active = i + 1;
        _rerender();
        _focus('#rb-' + c.k + '-prompt');
        return true;
      }
      case 'sqBUp':
      case 'sqBDown':
        if (!d) return true;
        _moveCard(moveBy(_b.questions, i, action === 'sqBUp' ? -1 : 1), d, 'menu');
        return true;
      case 'sqBMoveTo':
        if (!d) return true;
        _moveCard(moveTo(_b.questions, i, Number(el.dataset.to)), d, 'menu');
        return true;
      case 'sqBDelete':
        if (d) _remove(i);
        return true;
      case 'sqBToggle': {
        if (!d) return true;
        var opt = el.dataset.opt;
        d[opt] = !d[opt];
        if (opt === 'multiple' && d.multiple) d.dropdown = false;
        if (opt === 'dropdown' && d.dropdown) d.multiple = false;
        _rerender();
        _focus('.rb-q[data-k="' + d.k + '"] [data-action="sqBToggle"][data-opt="' + opt + '"]');
        return true;
      }
      case 'sqBOther':
        if (!d) return true;
        d.other = el.dataset.on === '1';
        _rerender();
        return true;
      case 'sqBOptAdd': {
        var list = el.dataset.list;
        if (!d || !Array.isArray(d[list])) return true;
        d[list].push('');
        _rerender();
        _focus('#rb-' + d.k + '-' + list + '-' + (d[list].length - 1));
        return true;
      }
      case 'sqBOptRemove': {
        var l = el.dataset.list;
        if (!d || !Array.isArray(d[l])) return true;
        d[l].splice(Number(el.dataset.j), 1);
        _rerender();
        return true;
      }
      case 'sqBMenu':
        _b.menu = _b.menu === i ? -1 : i;
        _rerender();
        if (_b.menu === i) _focus('.rb-q[data-k="' + d.k + '"] .rb-qmenu-item');
        return true;
      case 'sqBSubtitle':
        if (!d) return true;
        d.subtitle = d.subtitle === null ? '' : null;
        _rerender();
        if (d.subtitle !== null) _focus('#rb-' + d.k + '-subtitle');
        return true;
      case 'sqBPreview':
        _preview();
        return true;
      case 'sqBCancel':
        _cancel();
        return true;
      case 'sqBSave':
        _save(el.dataset.on);
        return true;
    }
    return false;
  }

  function handleChange(el) {
    if (!_b) return false;
    var a = el.dataset.actionChange;
    if (a === 'sqBField') {
      _set(el.dataset.i, el.dataset.rbPath, el.value);
      return true;
    }
    if (a !== 'sqBType' && a !== 'sqBLevels') return false;
    _sync();
    var d = _b.questions[Number(el.dataset.i)];
    if (!d) return true;
    if (a === 'sqBType') {
      /* A saved question changing kind loses its id: the server keeps the
         old one, with its answers, as removed, and makes a new one, so no
         answer of the old kind is read as the new. Back to its first kind
         before saving, it is that question again. */
      if (d.id && el.value !== d.kind) {
        d.savedId = d.id;
        d.savedKind = d.kind;
        delete d.id;
      } else if (!d.id && d.savedId && el.value === d.savedKind) {
        d.id = d.savedId;
      }
      d.kind = el.value;
      if (d.kind === 'section' && d.subtitle === null) d.subtitle = '';
    } else {
      d.levels = Number(el.value) || 5;
    }
    _rerender();
    _focus('.rb-q[data-k="' + d.k + '"] [data-action-change="' + a + '"]');
    return true;
  }

  function handleBlur(el) {
    if (!_b || el.dataset.actionBlur !== 'sqBField') return false;
    _set(el.dataset.i, el.dataset.rbPath, el.value);
    return true;
  }

  function _state() {
    return _b;
  }

  function _reset() {
    _b = null;
    _seq = 0;
  }

  return {
    KINDS: KINDS,
    open: open,
    close: close,
    isOpen: isOpen,
    render: render,
    previewHtml: previewHtml,
    fromSaved: fromSaved,
    toContract: toContract,
    validate: validate,
    blocksOf: blocksOf,
    undo: function () {
      return _undo(null);
    },
    moveBy: moveBy,
    moveTo: moveTo,
    dropAt: dropAt,
    kindAbove: kindAbove,
    canStartHeading: canStartHeading,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _state: _state,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmReflectBuilder = CmReflectBuilder;
