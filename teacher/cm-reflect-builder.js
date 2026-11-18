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
          '">' +
          (on
            ? QuestionCards.editHtml(d, i, num, i === last, _b.menu === i)
            : QuestionCards.viewHtml(d, i, num, true)) +
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

  /* ── Actions ───────────────────────────────────────────────── */

  function _closeAndDraw() {
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
        _b.questions.push(n);
        _b.active = _b.questions.length - 1;
        _rerender();
        _focus('#rb-' + n.k + '-prompt');
        return true;
      }
      case 'sqBCopy': {
        if (!d) return true;
        var c = JSON.parse(JSON.stringify(d));
        delete c.id;
        delete c.savedId;
        c.k = 'k' + ++_seq;
        _b.questions.splice(i + 1, 0, c);
        _b.active = i + 1;
        _rerender();
        _focus('#rb-' + c.k + '-prompt');
        return true;
      }
      case 'sqBUp':
      case 'sqBDown': {
        var to = action === 'sqBUp' ? i - 1 : i + 1;
        if (!d || to < 0 || to >= _b.questions.length) return true;
        var before = _tops();
        _b.questions.splice(i, 1);
        _b.questions.splice(to, 0, d);
        _b.active = to;
        _rerender();
        _glide(before);
        var again = /** @type {HTMLButtonElement|null} */ (
          document.querySelector('.rb-q[data-k="' + d.k + '"] [data-action="' + action + '"]')
        );
        _focus(
          '.rb-q[data-k="' +
            d.k +
            '"] [data-action="' +
            (again && !again.disabled ? action : action === 'sqBUp' ? 'sqBDown' : 'sqBUp') +
            '"]',
        );
        return true;
      }
      case 'sqBDelete':
        if (!d) return true;
        _b.questions.splice(i, 1);
        _b.active = -1;
        _rerender();
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
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _state: _state,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmReflectBuilder = CmReflectBuilder;
