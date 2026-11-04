/* comment-forms.js — the verb forms a skill card's base phrase is said in
   (Colin, Nov 4 2026, decision 4: "does" and "doing" are derived by rule,
   with a spelling table and a per-card override, and a test that prints
   every derived form: tests/comment-forms.test.js, its listing in
   tests/__forms__/derived-forms.txt).

   A base phrase is a bare verb phrase ("find patterns and trends in data").
   does() gives it after "she" ("finds patterns and trends in data") and
   doing() after "at" or "for" ("finding patterns and trends in data"). The
   first word is the verb; when the second word is "and" or "or", the third
   is a second verb and takes the same form ("explore and explain the local
   environment" → "explores and explains …"). Everything after stays as
   written, slots ({his}) included.

   A card's `forms.override` maps a base phrase to the forms the rule gets
   wrong: { "<base>": { does: "…", doing: "…" } }. */
window.CommentForms = (function () {
  'use strict';

  /* The spelling table: verbs whose forms the rule below would get wrong. */
  var THIRD = { be: 'is', have: 'has', do: 'does', go: 'goes', say: 'says' };
  var GERUND = { be: 'being', see: 'seeing', agree: 'agreeing', free: 'freeing', dye: 'dyeing' };
  // Verbs that double their last consonant before -ing (stressed last
  // syllable ending consonant-vowel-consonant).
  var DOUBLE = [
    'admit',
    'bat',
    'begin',
    'chat',
    'commit',
    'control',
    'cut',
    'dig',
    'drop',
    'fit',
    'flip',
    'get',
    'grab',
    'hit',
    'jog',
    'let',
    'map',
    'nod',
    'occur',
    'omit',
    'permit',
    'plan',
    'plot',
    'prefer',
    'put',
    'refer',
    'rub',
    'run',
    'set',
    'ship',
    'shop',
    'sit',
    'skip',
    'spin',
    'step',
    'stir',
    'stop',
    'submit',
    'swim',
    'tag',
    'tap',
    'transmit',
    'trim',
    'win',
    'wrap',
  ];
  // Words after "and"/"or" that are not a second verb.
  var NOT_VERB =
    /^(the|a|an|their|his|her|its|other|others|more|new|own|then|when|why|how|what|where|which|who|its|\{\w+\})$/i;

  /* One verb after "she": "finds", "explains", "carries", "does". */
  function third(v) {
    var w = String(v || '');
    var low = w.toLowerCase();
    if (THIRD[low]) return THIRD[low];
    if (/(s|sh|ch|x|z|o)$/.test(low)) return w + 'es';
    if (/[^aeiou]y$/.test(low)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  /* One verb after "at": "finding", "using", "planning", "tying". */
  function gerund(v) {
    var w = String(v || '');
    var low = w.toLowerCase();
    if (GERUND[low]) return GERUND[low];
    if (DOUBLE.indexOf(low) >= 0) return w + w.slice(-1) + 'ing';
    if (/ie$/.test(low)) return w.slice(0, -2) + 'ying';
    if (/ee$/.test(low)) return w + 'ing';
    if (/[^aeiou]e$/.test(low) || /[aeiou]{2}[^aeiou]e$/.test(low) || /ue$/.test(low)) return w.slice(0, -1) + 'ing';
    return w + 'ing';
  }

  /* The verbs at the front of a phrase take the form: the first word, each
     word after a comma that follows a verb ("design, create and test …"),
     and the word after "and" or "or" that follows one. Punctuation stays. */
  function _apply(phrase, f) {
    var ws = String(phrase || '')
      .trim()
      .split(/\s+/);
    if (!ws[0]) return '';
    var form = function (i) {
      var m = ws[i].match(/^([a-z]+)([,]?)$/i);
      if (m) ws[i] = f(m[1]) + m[2];
    };
    form(0);
    var i = 1;
    while (i < ws.length && /,$/.test(ws[i - 1]) && /^[a-z]+,?$/.test(ws[i]) && !NOT_VERB.test(ws[i])) form(i++);
    if ((ws[i] === 'and' || ws[i] === 'or') && ws[i + 1] && !NOT_VERB.test(ws[i + 1]) && /^[a-z]+$/.test(ws[i + 1]))
      form(i + 1);
    return ws.join(' ');
  }
  function _override(phrase, overrides, key) {
    var o = overrides && overrides[String(phrase || '').trim()];
    return o && o[key] ? o[key] : null;
  }
  /* The phrase after "she": "finds patterns and trends in data". */
  function does(phrase, overrides) {
    return _override(phrase, overrides, 'does') || _apply(phrase, third);
  }
  /* The phrase after "at": "finding patterns and trends in data". */
  function doing(phrase, overrides) {
    return _override(phrase, overrides, 'doing') || _apply(phrase, gerund);
  }

  return { third: third, gerund: gerund, does: does, doing: doing };
})();
