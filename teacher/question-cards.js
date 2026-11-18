// @ts-check
/* Question cards: the drawing pieces a question-card builder shares.

   Moved out of teacher/cm-reflect-builder.js unchanged (docs/plans/
   quizzes-plan.md, Q2a) so a second builder can draw the same cards. Every
   function here is pure: HTML out, from the arguments in. No state, no data
   layer, no redraw. What a card reads from its builder (whether its "more"
   menu is open, the last card's place) comes in as an argument; the action
   names, the kinds offered and the length limits come in as options whose
   defaults are Reflect's own, so Reflect's output is the same as before.

   A draft question (d) is { k, kind, prompt, subtitle, required, choices,
   multiple, other, dropdown, shuffle, long, levels, low, high, statements,
   columns }; i is its place in the list and num its number. Text goes into
   the HTML only through esc. */
var QuestionCards = (function () {
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
  /* The data-action name of each thing on a card. */
  var ACTIONS = {
    edit: 'sqBEdit',
    field: 'sqBField',
    toggle: 'sqBToggle',
    optRemove: 'sqBOptRemove',
    optAdd: 'sqBOptAdd',
    other: 'sqBOther',
    levels: 'sqBLevels',
    type: 'sqBType',
    copy: 'sqBCopy',
    up: 'sqBUp',
    down: 'sqBDown',
    del: 'sqBDelete',
    menu: 'sqBMenu',
    subtitle: 'sqBSubtitle',
  };

  /* opts: { actions, kinds, max }, each optional and merged over the defaults. */
  function _o(opts) {
    var o = opts || {};
    return {
      actions: Object.assign({}, ACTIONS, o.actions),
      kinds: o.kinds || KINDS,
      max: Object.assign({}, MAX, o.max),
    };
  }

  function _clean(s) {
    return String(s == null ? '' : s).trim();
  }

  var ICONS = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  };
  function icon(name) {
    return (
      '<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[name] +
      '</svg>'
    );
  }
  var GRIP =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg>';

  function _label(kind, kinds) {
    var k = kinds.find(function (x) {
      return x.kind === kind;
    });
    return k ? k.label : 'Question';
  }

  function kindText(d, opts) {
    if (d.kind === 'text') return 'Text · ' + (d.long ? 'Long Answer' : 'One Line');
    if (d.kind === 'rating') return 'Rating · ' + (Number(d.levels) || 5) + ' Levels';
    if (d.kind === 'choice') return 'Choice' + (d.multiple ? ' · Multiple Answers' : d.dropdown ? ' · Drop-Down' : '');
    return _label(d.kind, _o(opts).kinds);
  }

  function _ph(text, fallback) {
    var t = _clean(text);
    return t ? esc(t) : '<span class="rb-v-empty">' + esc(fallback) + '</span>';
  }

  /* What a student sees for one question, drawn inert. */
  function viewBody(d) {
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
  // html-safe: prompts, subtitles and options pass through esc (_ph, viewBody); i and num are numbers
  function viewHtml(d, i, num, editable, opts) {
    var a = _o(opts).actions;
    var attrs = editable ? ' data-action="' + a.edit + '" data-i="' + i + '"' : '';
    var req = d.kind !== 'section' && d.required ? ' <span class="rb-req" aria-label="required">*</span>' : '';
    var words =
      d.kind === 'section' ? _ph(d.prompt, 'Section heading') : num + '. ' + _ph(d.prompt, 'Question ' + num) + req;
    var prompt = editable
      ? '<button type="button" class="rb-v-prompt" data-action="' +
        a.edit +
        '" data-i="' +
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
      (d.kind === 'section' ? '' : '<span class="rb-v-kind">' + esc(kindText(d, opts)) + '</span>') +
      '</div>' +
      (_clean(d.subtitle) ? '<div class="rb-v-sub">' + esc(_clean(d.subtitle)) + '</div>' : '') +
      viewBody(d) +
      '</div>'
    );
  }

  function input(d, i, path, value, label, max, extra, opts) {
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
      '" data-action-blur="' +
      _o(opts).actions.field +
      '" data-i="' +
      i +
      '" data-rb-path="' +
      path +
      '">'
    );
  }

  function _switch(d, i, opt, label, on, a) {
    return (
      '<span class="rb-sw">' +
      esc(label) +
      '<button type="button" class="rb-switch" role="switch" aria-checked="' +
      !!on +
      '" aria-label="' +
      esc(label) +
      '" data-action="' +
      a.toggle +
      '" data-opt="' +
      opt +
      '" data-i="' +
      i +
      '"><span></span></button></span>'
    );
  }

  /* An editable list: options, ranking items, statements or columns. */
  function listEditor(d, i, list, noun, max, len, mark, opts) {
    var a = _o(opts).actions;
    var items = d[list];
    var rows = items
      .map(function (v, j) {
        return (
          '<div class="rb-opt">' +
          mark +
          input(d, i, list + '.' + j, v, noun + ' ' + (j + 1), len, '', opts) +
          '<button type="button" class="rb-x" aria-label="Remove ' +
          esc(noun.toLowerCase()) +
          ' ' +
          (j + 1) +
          '" data-action="' +
          a.optRemove +
          '" data-i="' +
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
        '<button type="button" class="rb-x" aria-label="Remove Other" data-action="' +
        a.other +
        '" data-on="0" data-i="' +
        i +
        '">✕</button></div>';
    }
    var adds =
      items.length < max
        ? '<button type="button" class="cm-add-link" data-action="' +
          a.optAdd +
          '" data-i="' +
          i +
          '" data-list="' +
          list +
          '">+ Add ' +
          esc(noun) +
          '</button>'
        : '<span class="cm-hint">' + esc('Up to ' + max + ' ' + noun.toLowerCase() + 's.') + '</span>';
    if (list === 'choices' && d.kind === 'choice' && !d.other) {
      adds +=
        '<button type="button" class="cm-add-link" data-action="' +
        a.other +
        '" data-on="1" data-i="' +
        i +
        '">+ Add “Other” Option</button>';
    }
    return '<div class="rb-opts">' + rows + '</div><div class="rb-adds">' + adds + '</div>';
  }

  /* What an open card shows for its kind: the list to edit, the rating's
     controls, or a preview of the answer box. */
  function kindEditor(d, i, opts) {
    var o = _o(opts);
    var a = o.actions;
    var max = o.max;
    var mark =
      '<span class="rb-mark' +
      (d.kind === 'choice' && d.multiple ? ' rb-mark-check' : '') +
      '" aria-hidden="true"></span>';
    if (d.kind === 'choice') return listEditor(d, i, 'choices', 'Option', max.choices, max.choice, mark, opts);
    if (d.kind === 'ranking')
      return listEditor(
        d,
        i,
        'choices',
        'Item',
        max.items,
        max.choice,
        '<span class="rb-grip">' + GRIP + '</span>',
        opts,
      );
    if (d.kind === 'likert') {
      return (
        '<div class="rb-likert"><div><div class="cm-label">Statements</div>' +
        listEditor(d, i, 'statements', 'Statement', max.statements, max.statement, '', opts) +
        '</div><div><div class="cm-label">Columns</div>' +
        listEditor(d, i, 'columns', 'Column', max.columns, max.column, '', opts) +
        '</div></div>'
      );
    }
    if (d.kind === 'rating') {
      var n = Number(d.levels) || 5;
      var levelOpts = '';
      for (var l = 2; l <= 10; l++)
        levelOpts += '<option value="' + l + '"' + (l === n ? ' selected' : '') + '>' + l + '</option>';
      return (
        '<div class="rb-rating">' +
        '<label class="cm-field"><span class="cm-label">Levels</span><select class="cm-input" data-action-change="' +
        a.levels +
        '" data-i="' +
        i +
        '">' +
        levelOpts +
        '</select></label>' +
        '<label class="cm-field"><span class="cm-label">Word for 1</span>' +
        input(d, i, 'low', d.low, 'Word for 1', max.end, '', opts) +
        '</label>' +
        '<label class="cm-field"><span class="cm-label">' +
        esc('Word for ' + n) +
        '</span>' +
        input(d, i, 'high', d.high, 'Word for ' + n, max.end, '', opts) +
        '</label></div>' +
        viewBody(d)
      );
    }
    if (d.kind === 'section') return '';
    return viewBody(d);
  }

  /* The "more options" menu: the subtitle, and a Choice's two extra switches. */
  function menuHtml(d, i, opts) {
    var a = _o(opts).actions;
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
      item(d.subtitle === null ? 'Add a Subtitle' : 'Remove the Subtitle', a.subtitle) +
      (d.kind === 'choice'
        ? item('Shuffle Options', a.toggle, 'shuffle', d.shuffle) +
          item('Show as a Drop-Down', a.toggle, 'dropdown', d.dropdown && !d.multiple)
        : '') +
      '</div>'
    );
  }

  /* Copy, Move Up, Move Down and Delete. last: this is the last card. */
  function toolbar(i, last, opts) {
    var a = _o(opts).actions;
    var tool = function (action, name, label, off) {
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
        icon(name) +
        '</button>'
      );
    };
    return (
      '<span class="rb-tools">' +
      tool(a.copy, 'copy', 'Copy question') +
      tool(a.up, 'up', 'Move question up', i === 0) +
      tool(a.down, 'down', 'Move question down', last) +
      tool(a.del, 'trash', 'Delete question') +
      '</span>'
    );
  }

  /* The question-type picker on an open card. */
  function kindPicker(d, i, opts) {
    var o = _o(opts);
    return (
      '<select class="cm-input rb-kind" aria-label="Question type" data-action-change="' +
      o.actions.type +
      '" data-i="' +
      i +
      '">' +
      o.kinds
        .map(function (k) {
          return (
            '<option value="' + k.kind + '"' + (k.kind === d.kind ? ' selected' : '') + '>' + esc(k.label) + '</option>'
          );
        })
        .join('') +
      '</select>'
    );
  }

  /* An open card. menuOpen: its "more options" menu is showing. */
  // html-safe: every typed word goes through esc (input, listEditor, viewBody); i and num are numbers
  function editHtml(d, i, num, last, menuOpen, opts) {
    var o = _o(opts);
    var a = o.actions;
    var section = d.kind === 'section';
    var foot = '';
    if (d.kind === 'choice') foot += _switch(d, i, 'multiple', 'Multiple Answers', d.multiple, a);
    if (d.kind === 'text') foot += _switch(d, i, 'long', 'Long Answer', d.long, a);
    if (!section) {
      foot +=
        _switch(d, i, 'required', 'Required', d.required, a) +
        '<span class="rb-qmore"><button type="button" class="rb-qmore-btn" aria-label="More options" aria-haspopup="menu" aria-expanded="' +
        !!menuOpen +
        '" data-action="' +
        a.menu +
        '" data-i="' +
        i +
        '">⋯</button>' +
        (menuOpen ? menuHtml(d, i, opts) : '') +
        '</span>';
    }
    return (
      '<div class="rb-q-edit">' +
      '<div class="rb-q-bar"><span class="rb-q-label">' +
      (section ? 'Section Heading' : 'Question ' + num) +
      '</span>' +
      kindPicker(d, i, opts) +
      toolbar(i, last, opts) +
      '</div>' +
      input(d, i, 'prompt', d.prompt, section ? 'Heading' : 'Question', o.max.prompt, ' rb-prompt', opts) +
      (d.subtitle !== null
        ? input(d, i, 'subtitle', d.subtitle, 'Subtitle', o.max.subtitle, ' rb-subtitle', opts)
        : '') +
      kindEditor(d, i, opts) +
      (foot ? '<div class="rb-q-foot">' + foot + '</div>' : '') +
      '</div>'
    );
  }

  return {
    KINDS: KINDS,
    MAX: MAX,
    ACTIONS: ACTIONS,
    icon: icon,
    kindText: kindText,
    viewBody: viewBody,
    viewHtml: viewHtml,
    input: input,
    listEditor: listEditor,
    kindEditor: kindEditor,
    menuHtml: menuHtml,
    toolbar: toolbar,
    kindPicker: kindPicker,
    editHtml: editHtml,
  };
})();
if (typeof window !== 'undefined') window.QuestionCards = QuestionCards;
