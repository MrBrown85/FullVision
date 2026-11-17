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

  var KINDS = [
    { kind: 'choice', label: 'Choice' },
    { kind: 'text', label: 'Text' },
    { kind: 'rating', label: 'Rating' },
    { kind: 'date', label: 'Date' },
    { kind: 'ranking', label: 'Ranking' },
    { kind: 'likert', label: 'Likert' },
    { kind: 'section', label: 'Section Heading' },
  ];
  var MAX = {
    title: 120,
    description: 500,
    prompt: 1000,
    subtitle: 300,
    choice: 120,
    choices: 20,
    items: 10,
    statement: 200,
    statements: 10,
    column: 40,
    columns: 7,
    end: 60,
  };
  var LIKERT_COLUMNS = ['Never', 'Sometimes', 'Usually', 'Always'];
  var PREVIEW_KEY = 'fv-reflect-preview';

  /** @type {any} */
  var _b = null; // the open draft: { cid, qid, title, description, closes, questions, active, menu, showErrors, msg, saving, base, wasOn, answered }
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

  function _label(kind) {
    var k = KINDS.find(function (x) {
      return x.kind === kind;
    });
    return k ? k.label : 'Question';
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
     { title, none, closes, q: { <card key>: message } }, or null. */
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
    if (draft.closes && draft.closes < (today || _today())) {
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

  /* Opens the builder for a new reflection (q null) or a teacher-built one. */
  function open(cid, q) {
    _b = {
      cid: cid,
      qid: q ? q.id : null,
      title: q ? q.title || '' : '',
      description: q ? q.theme || '' : '',
      closes: q ? q.closes_on || '' : '',
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
      wasOn: !!(q && q.is_on),
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

  var ICONS = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  };
  function _icon(name) {
    return (
      '<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[name] +
      '</svg>'
    );
  }
  var GRIP =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg>';

  function _kindText(d) {
    if (d.kind === 'text') return 'Text · ' + (d.long ? 'Long Answer' : 'One Line');
    if (d.kind === 'rating') return 'Rating · ' + (Number(d.levels) || 5) + ' Levels';
    if (d.kind === 'choice') return 'Choice' + (d.multiple ? ' · Multiple Answers' : d.dropdown ? ' · Drop-Down' : '');
    return _label(d.kind);
  }

  function _ph(text, fallback) {
    var t = _clean(text);
    return t ? esc(t) : '<span class="rb-v-empty">' + esc(fallback) + '</span>';
  }

  /* What a student sees for one question, drawn inert. */
  function _viewBody(d) {
    if (d.kind === 'text') return '<div class="rb-v-box' + (d.long ? ' rb-v-long' : '') + '">Students type here</div>';
    if (d.kind === 'date') return '<div class="rb-v-box rb-v-date">Pick a date</div>';
    if (d.kind === 'section') return '';
    if (d.kind === 'rating') {
      var n = Number(d.levels) || 5;
      var boxes = '';
      for (var i = 1; i <= n; i++) boxes += '<span class="rb-v-level">' + i + '</span>';
      return (
        '<div class="rb-v-rating">' +
        (_clean(d.low) ? '<span class="rb-v-end">' + esc(_clean(d.low)) + '</span>' : '') +
        '<span class="rb-v-levels">' +
        boxes +
        '</span>' +
        (_clean(d.high) ? '<span class="rb-v-end">' + esc(_clean(d.high)) + '</span>' : '') +
        '</div>'
      );
    }
    if (d.kind === 'choice') {
      if (d.dropdown && !d.multiple) return '<div class="rb-v-box rb-v-select">Choose an answer</div>';
      var mark = '<span class="rb-mark' + (d.multiple ? ' rb-mark-check' : '') + '" aria-hidden="true"></span>';
      return (
        '<div class="rb-v-opts">' +
        d.choices
          .map(function (c, j) {
            return '<div class="rb-v-opt">' + mark + _ph(c, 'Option ' + (j + 1)) + '</div>';
          })
          .join('') +
        (d.other ? '<div class="rb-v-opt">' + mark + 'Other: students type their own</div>' : '') +
        '</div>'
      );
    }
    if (d.kind === 'ranking') {
      return (
        '<div class="rb-v-opts rb-v-rank">' +
        d.choices
          .map(function (c, j) {
            return '<div class="rb-v-item">' + GRIP + _ph(c, 'Item ' + (j + 1)) + '</div>';
          })
          .join('') +
        '</div>'
      );
    }
    if (d.kind === 'likert') {
      var cols = d.columns.length || 1;
      var cells = '<span></span>';
      d.columns.forEach(function (c, j) {
        cells += '<span class="rb-v-col">' + _ph(c, 'Column ' + (j + 1)) + '</span>';
      });
      d.statements.forEach(function (s, j) {
        cells += '<span class="rb-v-stmt">' + _ph(s, 'Statement ' + (j + 1)) + '</span>';
        for (var k = 0; k < d.columns.length; k++)
          cells += '<span class="rb-v-cell"><span class="rb-mark"></span></span>';
      });
      return (
        '<div class="rb-v-likert" style="grid-template-columns:minmax(0,2.4fr) repeat(' +
        cols +
        ',minmax(0,1fr))" aria-hidden="true">' +
        cells +
        '</div>'
      );
    }
    return '';
  }

  /* The question as students see it. editable: a click opens it. */
  // html-safe: prompts, subtitles and options pass through esc (_ph, _viewBody); i and num are numbers
  function _viewHtml(d, i, num, editable) {
    var attrs = editable ? ' data-action="sqBEdit" data-i="' + i + '"' : '';
    var req = d.kind !== 'section' && d.required ? ' <span class="rb-req" aria-label="required">*</span>' : '';
    var words =
      d.kind === 'section' ? _ph(d.prompt, 'Section heading') : num + '. ' + _ph(d.prompt, 'Question ' + num) + req;
    var prompt = editable
      ? '<button type="button" class="rb-v-prompt" data-action="sqBEdit" data-i="' +
        i +
        '" aria-label="Edit ' +
        (d.kind === 'section' ? 'section heading' : 'question ' + num) +
        '">' +
        words +
        '</button>'
      : '<span class="rb-v-prompt">' + words + '</span>';
    return (
      '<div class="rb-q-view' +
      (d.kind === 'section' ? ' rb-v-section' : '') +
      '"' +
      attrs +
      '>' +
      '<div class="rb-v-line">' +
      prompt +
      (d.kind === 'section' ? '' : '<span class="rb-v-kind">' + esc(_kindText(d)) + '</span>') +
      '</div>' +
      (_clean(d.subtitle) ? '<div class="rb-v-sub">' + esc(_clean(d.subtitle)) + '</div>' : '') +
      _viewBody(d) +
      '</div>'
    );
  }

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
          return '<li class="rb-q">' + _viewHtml(d, i, num, false) + '</li>';
        })
        .join('') +
      '</ol>'
    );
  }

  function _input(d, i, path, value, label, max, extra) {
    var id = 'rb-' + d.k + '-' + path.replace('.', '-');
    return (
      '<input type="text" class="cm-input' +
      (extra || '') +
      '" id="' +
      id +
      '" aria-label="' +
      esc(label) +
      '" placeholder="' +
      esc(label) +
      '" maxlength="' +
      max +
      '" value="' +
      esc(value || '') +
      '" data-action-blur="sqBField" data-i="' +
      i +
      '" data-rb-path="' +
      path +
      '">'
    );
  }

  function _switch(d, i, opt, label, on) {
    return (
      '<span class="rb-sw">' +
      esc(label) +
      '<button type="button" class="rb-switch" role="switch" aria-checked="' +
      !!on +
      '" aria-label="' +
      esc(label) +
      '" data-action="sqBToggle" data-opt="' +
      opt +
      '" data-i="' +
      i +
      '"><span></span></button></span>'
    );
  }

  /* An editable list: options, ranking items, statements or columns. */
  function _listEditor(d, i, list, noun, max, len, mark) {
    var items = d[list];
    var rows = items
      .map(function (v, j) {
        return (
          '<div class="rb-opt">' +
          mark +
          _input(d, i, list + '.' + j, v, noun + ' ' + (j + 1), len) +
          '<button type="button" class="rb-x" aria-label="Remove ' +
          esc(noun.toLowerCase()) +
          ' ' +
          (j + 1) +
          '" data-action="sqBOptRemove" data-i="' +
          i +
          '" data-list="' +
          list +
          '" data-j="' +
          j +
          '">✕</button></div>'
        );
      })
      .join('');
    if (list === 'choices' && d.kind === 'choice' && d.other) {
      rows +=
        '<div class="rb-opt">' +
        mark +
        '<div class="rb-other">Other: students type their own</div>' +
        '<button type="button" class="rb-x" aria-label="Remove Other" data-action="sqBOther" data-on="0" data-i="' +
        i +
        '">✕</button></div>';
    }
    var adds =
      items.length < max
        ? '<button type="button" class="cm-add-link" data-action="sqBOptAdd" data-i="' +
          i +
          '" data-list="' +
          list +
          '">+ Add ' +
          esc(noun) +
          '</button>'
        : '<span class="cm-hint">' + esc('Up to ' + max + ' ' + noun.toLowerCase() + 's.') + '</span>';
    if (list === 'choices' && d.kind === 'choice' && !d.other) {
      adds +=
        '<button type="button" class="cm-add-link" data-action="sqBOther" data-on="1" data-i="' +
        i +
        '">+ Add “Other” Option</button>';
    }
    return '<div class="rb-opts">' + rows + '</div><div class="rb-adds">' + adds + '</div>';
  }

  function _kindEditor(d, i) {
    var mark =
      '<span class="rb-mark' +
      (d.kind === 'choice' && d.multiple ? ' rb-mark-check' : '') +
      '" aria-hidden="true"></span>';
    if (d.kind === 'choice') return _listEditor(d, i, 'choices', 'Option', MAX.choices, MAX.choice, mark);
    if (d.kind === 'ranking')
      return _listEditor(d, i, 'choices', 'Item', MAX.items, MAX.choice, '<span class="rb-grip">' + GRIP + '</span>');
    if (d.kind === 'likert') {
      return (
        '<div class="rb-likert"><div><div class="cm-label">Statements</div>' +
        _listEditor(d, i, 'statements', 'Statement', MAX.statements, MAX.statement, '') +
        '</div><div><div class="cm-label">Columns</div>' +
        _listEditor(d, i, 'columns', 'Column', MAX.columns, MAX.column, '') +
        '</div></div>'
      );
    }
    if (d.kind === 'rating') {
      var n = Number(d.levels) || 5;
      var opts = '';
      for (var l = 2; l <= 10; l++)
        opts += '<option value="' + l + '"' + (l === n ? ' selected' : '') + '>' + l + '</option>';
      return (
        '<div class="rb-rating">' +
        '<label class="cm-field"><span class="cm-label">Levels</span><select class="cm-input" data-action-change="sqBLevels" data-i="' +
        i +
        '">' +
        opts +
        '</select></label>' +
        '<label class="cm-field"><span class="cm-label">Word for 1</span>' +
        _input(d, i, 'low', d.low, 'Word for 1', MAX.end) +
        '</label>' +
        '<label class="cm-field"><span class="cm-label">' +
        esc('Word for ' + n) +
        '</span>' +
        _input(d, i, 'high', d.high, 'Word for ' + n, MAX.end) +
        '</label></div>' +
        _viewBody(d)
      );
    }
    if (d.kind === 'section') return '';
    return _viewBody(d);
  }

  function _menuHtml(d, i) {
    var item = function (label, action, opt, on) {
      return (
        '<button type="button" class="rb-qmenu-item" role="' +
        (opt ? 'menuitemcheckbox' : 'menuitem') +
        '"' +
        (opt ? ' aria-checked="' + !!on + '" data-opt="' + opt + '"' : '') +
        ' data-action="' +
        action +
        '" data-i="' +
        i +
        '">' +
        esc(label) +
        '</button>'
      );
    };
    return (
      '<div class="rb-qmenu" role="menu" aria-label="More options">' +
      item(d.subtitle === null ? 'Add a Subtitle' : 'Remove the Subtitle', 'sqBSubtitle') +
      (d.kind === 'choice'
        ? item('Shuffle Options', 'sqBToggle', 'shuffle', d.shuffle) +
          item('Show as a Drop-Down', 'sqBToggle', 'dropdown', d.dropdown && !d.multiple)
        : '') +
      '</div>'
    );
  }

  // html-safe: every typed word goes through esc (_input, _listEditor, _viewBody); i and num are numbers
  function _editHtml(d, i, num, last) {
    var tool = function (action, icon, label, off) {
      return (
        '<button type="button" class="rb-tool" data-action="' +
        action +
        '" data-i="' +
        i +
        '" aria-label="' +
        label +
        '"' +
        (off ? ' disabled' : '') +
        '>' +
        _icon(icon) +
        '</button>'
      );
    };
    var section = d.kind === 'section';
    var foot = '';
    if (d.kind === 'choice') foot += _switch(d, i, 'multiple', 'Multiple Answers', d.multiple);
    if (d.kind === 'text') foot += _switch(d, i, 'long', 'Long Answer', d.long);
    if (!section) {
      foot +=
        _switch(d, i, 'required', 'Required', d.required) +
        '<span class="rb-qmore"><button type="button" class="rb-qmore-btn" aria-label="More options" aria-haspopup="menu" aria-expanded="' +
        (_b.menu === i) +
        '" data-action="sqBMenu" data-i="' +
        i +
        '">⋯</button>' +
        (_b.menu === i ? _menuHtml(d, i) : '') +
        '</span>';
    }
    return (
      '<div class="rb-q-edit">' +
      '<div class="rb-q-bar"><span class="rb-q-label">' +
      (section ? 'Section Heading' : 'Question ' + num) +
      '</span><select class="cm-input rb-kind" aria-label="Question type" data-action-change="sqBType" data-i="' +
      i +
      '">' +
      KINDS.map(function (k) {
        return (
          '<option value="' + k.kind + '"' + (k.kind === d.kind ? ' selected' : '') + '>' + esc(k.label) + '</option>'
        );
      }).join('') +
      '</select><span class="rb-tools">' +
      tool('sqBCopy', 'copy', 'Copy question') +
      tool('sqBUp', 'up', 'Move question up', i === 0) +
      tool('sqBDown', 'down', 'Move question down', last) +
      tool('sqBDelete', 'trash', 'Delete question') +
      '</span></div>' +
      _input(d, i, 'prompt', d.prompt, section ? 'Heading' : 'Question', MAX.prompt, ' rb-prompt') +
      (d.subtitle !== null ? _input(d, i, 'subtitle', d.subtitle, 'Subtitle', MAX.subtitle, ' rb-subtitle') : '') +
      _kindEditor(d, i) +
      (foot ? '<div class="rb-q-foot">' + foot + '</div>' : '') +
      '</div>'
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
          (on ? _editHtml(d, i, num, i === last) : _viewHtml(d, i, num, true)) +
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
      _icon('phone') +
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
    var w = window.open('/s/#preview-reflection', 'fv-reflect-preview', 'popup=yes,width=400,height=820');
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
    var draft = _b;
    draft.saving = true;
    draft.msg = '';
    var saving = _g().Questionnaires.saveCustom(cid, {
      id: draft.qid,
      title: p.title,
      theme: p.description,
      opens_on: opens,
      closes_on: draft.closes || null,
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
