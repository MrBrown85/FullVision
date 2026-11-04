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
    'compel',
    'forget',
    'infer',
    'propel',
    'spot',
    'transfer',
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
  var ADJ = /^(personal|social|local|global|new|own|public|private|physical|digital|written|oral)$/;
  var COMPOUND = /^(test (results|data)|work (samples|networks|spaces))$/;
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
    // A second predicate later in the phrase ("plan a fair test and record
    // measurements"): the first verb's object opens on a determiner, no
    // "to" or "that" clause comes before the "and", and the word after it is
    // a known verb in base form.
    var det = /^(a|an|the|his|her|their|its|one|each|every|\{his\})$/;
    // Or a one-word object ("observe nature and ask questions about it").
    // Not when that word describes the next noun ("personal and work
    // networks") or the second word is a noun in a compound ("test results").
    if (ws[2] === 'and' && /^[a-z]+$/.test(ws[1] || '') && ws[3] && /^[a-z]+$/.test(ws[3])) {
      var compound = ADJ.test(ws[1]) || COMPOUND.test(ws[3] + ' ' + (ws[4] || ''));
      if (!compound && !/s$/.test(ws[3]) && VERBS.indexOf(ws[3]) >= 0 && !NOT_VERB.test(ws[3])) form(3);
    } else if (det.test(ws[1] || ''))
      for (var j = 2; j + 1 < ws.length; j++) {
        if (ws[j] === 'to' || ws[j] === 'that' || ws[j] === 'who' || ws[j] === 'which') break;
        if (ws[j] !== 'and') continue;
        var w = ws[j + 1];
        if (/^[a-z]+$/.test(w) && !/s$/.test(w) && VERBS.indexOf(w) >= 0 && !NOT_VERB.test(w)) form(j + 1);
        break;
      }
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
    var o = _override(phrase, overrides, 'doing');
    if (o) return o;
    // "keep exploring a topic" is "exploring a topic" after "at".
    var keep = String(phrase || '')
      .trim()
      .match(/^keep (\w+ing\b.*)$/);
    return keep ? keep[1] : _apply(phrase, gerund);
  }

  /* A verb after "she" as it is after "they": "finds" → "find", "is" →
     "are", "carries" → "carry", "finishes" → "finish". */
  var PLURAL = { is: 'are', has: 'have', does: 'do', goes: 'go', was: 'were', says: 'say' };
  function plural(w) {
    var low = String(w || '').toLowerCase();
    if (PLURAL[low]) return PLURAL[low];
    if (/[^aeiou]ies$/.test(low)) return w.slice(0, -3) + 'y';
    if (/(ches|shes|sses|xes|zes|oes)$/.test(low)) return w.slice(0, -2);
    if (/[^s]s$/.test(low)) return w.slice(0, -1);
    return w;
  }
  // Words that sit before the verb of a predicate ("consistently finds").
  var ADVERBS = /^(consistently|also|often|usually|now)$/i;
  // The verbs a second predicate after "and" can open on: the first words
  // of the skill cards' phrases and next steps, and the habit phrases.
  var VERBS = [
    'act',
    'adapt',
    'add',
    'adjust',
    'analyze',
    'anticipate',
    'apply',
    'arrange',
    'ask',
    'assemble',
    'assess',
    'balance',
    'bring',
    'build',
    'care',
    'carry',
    'change',
    'check',
    'choose',
    'cite',
    'collaborate',
    'collect',
    'combine',
    'come',
    'communicate',
    'compare',
    'compile',
    'complete',
    'compose',
    'conduct',
    'connect',
    'consider',
    'contribute',
    'control',
    'convert',
    'correct',
    'create',
    'credit',
    'critically',
    'critique',
    'decide',
    'demonstrate',
    'describe',
    'design',
    'determine',
    'develop',
    'direct',
    'discuss',
    'do',
    'document',
    'draft',
    'draw',
    'edit',
    'embody',
    'estimate',
    'evaluate',
    'examine',
    'expand',
    'experiment',
    'explain',
    'explore',
    'express',
    'extend',
    'find',
    'finish',
    'follow',
    'form',
    'gather',
    'generate',
    'give',
    'guide',
    'handle',
    'help',
    'identify',
    'improve',
    'improvise',
    'include',
    'infer',
    'interact',
    'interpret',
    'join',
    'judge',
    'justify',
    'keep',
    'label',
    'lead',
    'learn',
    'link',
    'list',
    'listen',
    'maintain',
    'make',
    'manage',
    'manipulate',
    'match',
    'measure',
    'model',
    'move',
    'name',
    'note',
    'notice',
    'observe',
    'offer',
    'operate',
    'order',
    'organize',
    'participate',
    'perform',
    'persist',
    'pick',
    'picture',
    'plan',
    'play',
    'practise',
    'prepare',
    'present',
    'prioritize',
    'produce',
    'propose',
    'protect',
    'pursue',
    'put',
    'question',
    'rank',
    'read',
    'recall',
    'receive',
    'recognize',
    'record',
    'recreate',
    'refine',
    'reflect',
    'rehearse',
    'relate',
    'remember',
    'repeat',
    'request',
    'reread',
    'research',
    'respect',
    'respond',
    'restate',
    'retell',
    'retest',
    'return',
    'revise',
    'run',
    'say',
    'screen',
    'season',
    'select',
    'sense',
    'sequence',
    'set',
    'shape',
    'share',
    'shift',
    'show',
    'solve',
    'sort',
    'speak',
    'spot',
    'start',
    'state',
    'stay',
    'store',
    'strengthen',
    'suggest',
    'support',
    'tackle',
    'tailor',
    'take',
    'talk',
    'tell',
    'test',
    'think',
    'trace',
    'track',
    'transform',
    'troubleshoot',
    'try',
    'turn',
    'understand',
    'update',
    'use',
    'vary',
    'view',
    'watch',
    'weigh',
    'work',
    'write',
  ];
  // Words ending in -s after "and" that are never a second verb.
  var NOT_SECOND = /^(its|this|his|hers|ours|yours|theirs|us|plus|thus|less|unless|across|was|has|is|does)$/;
  // Third-person verbs the predicates open on (after "she"), and modals.
  var MODAL = /^(can|could|would|will|may|might|should)$/i;
  /* A predicate written after "she" said after "they": its first verb (past
     an adverb), and the verb after "and" that joins a second predicate to
     it ("comes to class ready and works well"). Modals and past tense stay. */
  function forThey(text) {
    return _agreeWith(text, function (from, to) {
      return to;
    });
  }
  /* The same predicate as a template that agrees with whichever student it
     is said about: each verb that changes after "they" as [one|many] ("[finds|find]
     patterns"), for the realiser. */
  function agreeable(text) {
    return _agreeWith(text, function (from, to) {
      return /[[\]{}|]/.test(from) ? from : '[' + from + '|' + to + ']';
    });
  }
  function _agreeWith(text, put) {
    var ws = String(text || '').split(' ');
    var plainFirst = null;
    var i = 0;
    while (i < ws.length && ADVERBS.test(ws[i])) i++;
    if (i >= ws.length || MODAL.test(ws[i]) || /ed$/.test(ws[i])) return ws.join(' ');
    var first = ws[i];
    plainFirst = plural(first);
    if (plainFirst === first) return ws.join(' ');
    ws[i] = put(first, plainFirst);
    // An auxiliary ("is beginning to …", "has …") has no second predicate
    // to agree.
    if (PLURAL[first.toLowerCase()]) return ws.join(' ');
    for (var j = i + 1; j + 1 < ws.length; j++) {
      if (ws[j] !== 'and') continue;
      var k = j + 1;
      while (k < ws.length && ADVERBS.test(ws[k])) k++;
      if (
        k < ws.length &&
        /^[a-z]+s$/.test(ws[k]) &&
        !NOT_SECOND.test(ws[k]) &&
        VERBS.indexOf(plural(ws[k])) >= 0 &&
        plural(ws[k]) !== ws[k] &&
        third(plural(ws[k])) === ws[k]
      )
        ws[k] = put(ws[k], plural(ws[k]));
    }
    return ws.join(' ');
  }

  return {
    third: third,
    gerund: gerund,
    does: does,
    doing: doing,
    plural: plural,
    forThey: forThey,
    agreeable: agreeable,
  };
})();
