/* comment-lint.js — the vocabulary lint (plan PR 9), as the app runs it.
   tests/comment-bank-lint.test.js runs it over every word Generate can
   write (the bank, the skill table, the support checklist, the engine's
   phrases); the personal bank (teacher/comment-personal.js, plan PR 10)
   runs it over each sentence a teacher could keep, so a sentence of their
   own passes the same lint as the shared bank's.

   It finds any phrasal verb, idiom, person-praise word, comparison with
   classmates, sentence over 20 words, or evaluative word outside the
   controlled vocabulary. Teacher-typed class lines (support, closing,
   late work) are used as typed and are not linted.

   To add wording: if the lint flags a word that is right for the bank, add
   it to CONTROLLED with a reason; never to the lists of what is banned. */
window.CommentLint = (function () {
  'use strict';

  /* ── What is banned ────────────────────────────────────────────────────── */

  // Phrasal verbs: [verb, particle]. Any form of the verb, the particle
  // right after it or after a short object ("talk it through").
  var PHRASAL = [
    ['act', 'on'],
    ['back', 'up'],
    ['bring', 'along'],
    ['bring', 'out'],
    ['bring', 'up'],
    ['build', 'on'],
    ['build', 'up'],
    ['carry', 'out'],
    ['catch', 'up'],
    ['check', 'in'],
    ['check', 'on'],
    ['check', 'out'],
    ['coach', 'through'],
    ['come', 'along'],
    ['come', 'in'],
    ['come', 'into'],
    ['come', 'out'],
    ['come', 'together'],
    ['come', 'up'],
    ['end', 'up'],
    ['fall', 'behind'],
    ['figure', 'out'],
    ['fill', 'in'],
    ['find', 'out'],
    ['firm', 'up'],
    ['fit', 'in'],
    ['follow', 'through'],
    ['follow', 'up'],
    ['get', 'ahead'],
    ['get', 'back'],
    ['get', 'by'],
    ['get', 'going'],
    ['get', 'in'],
    ['get', 'lost'],
    ['get', 'on'],
    ['get', 'started'],
    ['get', 'through'],
    ['give', 'up'],
    ['go', 'back'],
    ['go', 'over'],
    ['hand', 'in'],
    ['hand', 'out'],
    ['hang', 'in'],
    ['hold', 'on'],
    ['keep', 'on'],
    ['keep', 'up'],
    ['look', 'back'],
    ['look', 'forward'],
    ['look', 'into'],
    ['look', 'over'],
    ['mess', 'up'],
    ['move', 'along'],
    ['move', 'on'],
    ['move', 'up'],
    ['pick', 'up'],
    ['point', 'out'],
    ['put', 'away'],
    ['put', 'in'],
    ['put', 'off'],
    ['set', 'out'],
    ['set', 'up'],
    ['show', 'up'],
    ['sign', 'up'],
    ['slow', 'down'],
    ['sort', 'out'],
    ['speed', 'up'],
    ['step', 'up'],
    ['stick', 'with'],
    ['take', 'in'],
    ['take', 'on'],
    ['take', 'up'],
    ['talk', 'through'],
    ['try', 'out'],
    ['turn', 'into'],
    ['settle', 'on'],
    ['turn', 'around'],
    ['walk', 'through'],
    ['work', 'on'],
    ['work', 'out'],
    ['work', 'through'],
    ['write', 'down'],
    ['write', 'up'],
  ];
  var IRREGULAR = {
    bring: ['brought'],
    build: ['built'],
    catch: ['caught'],
    come: ['came'],
    fall: ['fell', 'fallen'],
    find: ['found'],
    fit: ['fitting'],
    get: ['got', 'gotten', 'getting'],
    give: ['gave', 'given'],
    go: ['went', 'gone', 'goes'],
    hang: ['hung'],
    hold: ['held'],
    keep: ['kept'],
    put: ['putting'],
    set: ['setting'],
    speed: ['sped'],
    step: ['stepped', 'stepping'],
    stick: ['stuck'],
    take: ['took', 'taken'],
    write: ['wrote', 'written'],
  };
  function forms(v) {
    var out = [v];
    if (/e$/.test(v)) out.push(v + 's', v + 'd', v.slice(0, -1) + 'ing');
    else if (/[^aeiou]y$/.test(v)) out.push(v.slice(0, -1) + 'ies', v.slice(0, -1) + 'ied', v + 'ing');
    else if (/(ch|sh|ss|x)$/.test(v)) out.push(v + 'es', v + 'ed', v + 'ing');
    else out.push(v + 's', v + 'ed', v + 'ing');
    return out.concat(IRREGULAR[v] || []);
  }
  var OBJECT = '(?:\\s+(?:it|them|that|this|X|you|him|her|his|their|work|the work)){0,2}';
  var PHRASAL_RES = PHRASAL.map(function (pair) {
    var v = pair[0];
    var p = pair[1];
    return {
      name: v + ' ' + p,
      re: new RegExp('\\b(?:' + forms(v).join('|') + ')' + OBJECT + '\\s+' + p + '\\b(?!\\s+time\\b)', 'i'),
    };
  });

  // Idioms and figures of speech a family reading in a second language
  // would have to decode.
  var IDIOMS = [
    /\bkeep it up\b/i,
    /\bon (the right )?track\b/i,
    /\broom to grow\b/i,
    /\bups and downs\b/i,
    /\binto view\b/i,
    /\bin view\b/i,
    /\bbecomes? a wall\b/i,
    /\bwell placed\b/i,
    /\bwell set up\b/i,
    /\baim high\b/i,
    /\bnext push\b/i,
    /\bmake a (real )?difference\b/i,
    /\breal (progress|strengths?)\b/i,
    /\bthe extra mile\b/i,
    /\bhit the ground running\b/i,
    /\b(the )?way forward\b/i,
    /\bfirm(est)? ground\b/i,
    /\bhead start\b/i,
    /\bclear path\b/i,
    /\bthe rest follows\b/i,
    /\bfollows? from\b/i,
    /\bvoice of (his|her|their|X) own\b/i,
    /\bstretch(es|ing)?\b/i,
    /\bshines?\b/i,
    /\bblossom/i,
    /\bflourish/i,
    /\bmov(e|es|ing) forward\b/i,
    /\bin the long run\b/i,
    /\bat the end of the day\b/i,
    /\bpiece of cake\b/i,
    /\bhang of\b/i,
    /\bthe work ahead\b/i,
    /\ba way into\b/i,
    /\bstill thin\b/i,
    /\bthe gaps show\b/i,
    /\bget in touch\b/i,
    /\bwell past\b/i,
    /\bin the mix\b/i,
    /\bhas been a mix\b/i,
    /\bpicture .* (forming|coming)\b/i,
    /\balong the way\b/i,
    /\bmore of a challenge\b/i,
    /\bturn\b.*\baround\b/i,
    // "tell a reliable site from one that is not" (tell apart).
    /\btell\b[^.]{0,30}\bfrom (one|another|each other)\b/i,
    /\bha(ve|ving|s|d) a hard time\b/i,
  ];

  // Praise of the person, not the work.
  var PRAISE = [
    'bright',
    'talented',
    'gifted',
    'smart',
    'intelligent',
    'clever',
    'brilliant',
    'genius',
    'natural',
    'hardworking',
    'hard-working',
    'conscientious',
    'diligent',
    'motivated',
    'mature',
    'polite',
    'respectful',
    'kind',
    'lovely',
    'delightful',
    'pleasant',
    'wonderful',
    'amazing',
    'awesome',
    'fantastic',
    'superb',
    'outstanding',
    'exceptional',
    'remarkable',
    'star',
    'superstar',
    'joy',
    'pleasure',
    'capable',
    'standout',
  ];

  // Words a student reads as shame (the acceptability checklist): one
  // appearing anywhere in a sentence about them.
  var SHAME = ['finally', 'still', 'again', 'only', 'at least', 'unfortunately'];
  var SHAME_RES = SHAME.map(function (w) {
    return { name: w, re: new RegExp('\\b' + w.replace(' ', '\\s+') + '\\b', 'i') };
  });

  // Comparisons with classmates.
  var COMPARISONS = [
    /\btop of (the|his|her|their) class\b/i,
    /\bbest in (the )?class\b/i,
    /\bthan (others|other students|most|the rest|everyone|anyone|classmates|(his|her|their|X) peers|the class)\b/i,
    /\bclassmates?\b/i,
    /\bpeers?\b/i,
    /\bthe (rest of the|whole) class\b/i,
    /\beveryone else\b/i,
    /\bone of the (best|strongest|top|most)\b/i,
    /\b(above|below) (the )?(class )?average\b/i,
    /\bclass average\b/i,
    /\bahead of\b/i,
    /\b(fall|falls|fell|falling|is|are|was|were) behind\b/i,
    /\bcompared (to|with)\b/i,
    /\bmore than (most|others)\b/i,
    /\btop student\b/i,
  ];

  // Words that judge quality. Only the CONTROLLED ones may appear.
  var EVALUATIVE = [
    'excellent',
    'good',
    'satisfactory',
    'acceptable',
    'great',
    'strong',
    'stronger',
    'strongest',
    'strongly',
    'best',
    'better',
    'weak',
    'weaker',
    'weakest',
    'worse',
    'worst',
    'poor',
    'poorly',
    'solid',
    'steady',
    'well',
    'careful',
    'carefully',
    'clear',
    'clearly',
    'reliable',
    'deep',
    'deeper',
    'deepest',
    'insightful',
    'thoughtful',
    'thoughtfully',
    'honest',
    'detailed',
    'sound',
    'convincing',
    'impressive',
    'particular',
    'particularly',
    'nice',
    'fine',
    'perfect',
    'flawless',
    'beautiful',
    'neat',
    'tidy',
    'sloppy',
    'messy',
    'lazy',
    'careless',
    'rushed',
    'consistent',
    'effective',
    'effectively',
    'successful',
    'successfully',
    'admirable',
    'commendable',
    'responsible',
    'dependable',
    'enthusiastic',
    'eager',
    'keen',
    'positive',
    'negative',
    'creative',
    'original',
    'sophisticated',
    'advanced',
    'high',
    'rich',
    'vivid',
    'powerful',
    'compelling',
    'persuasive',
    'skilled',
    'skilful',
    'skillful',
    'competent',
    'confident',
    'confidently',
    'independent',
    'independently',
    'accurate',
    'accurately',
    'precise',
    'precisely',
    'polished',
    'ambitious',
    'struggling',
    'struggles',
    'excels',
    'quality',
    'superior',
    'inferior',
    'brief',
  ];
  // The controlled vocabulary, and why each word is allowed.
  var CONTROLLED = {
    // The Letter Grades Order standing words (plan, Sentence grammar).
    excellent: 'standing word; also "work habits are excellent" (plan PR 7)',
    good: 'standing word ("very good", "good"); also "work habits are good"',
    satisfactory: 'standing word',
    acceptable: 'standing word ("minimally acceptable")',
    // Claims behind an evidence gate or the gradebook (plan PR 6).
    best: 'the best piece: the highest-marked work',
    strongest: 'the "strongest" gate (strongestOf)',
    stronger: 'a competency past the "improved" gate',
    // The term's picture (pictureOf), read off the levels.
    strong: 'the "strong" picture of the term',
    steady: 'the "steady" picture of the term',
    // The plan's habit wording ("work well with others").
    well: 'habit phrases and "did well" on the best piece',
    // What a skill asks for, in the skill table and the subject sentences.
    clearly: 'a skill to show ("explain results clearly"); the approved mockup says it',
    clear: 'a skill to show ("ask a clear question")',
    carefully: 'a skill to show ("record measurements carefully")',
    reliable: 'a skill to show ("find information in a reliable source")',
  };

  /* ── The check ─────────────────────────────────────────────────────── */

  /* A template as plain words: each slot and verb choice one word ("X"). */
  function plain(text) {
    return String(text)
      .replace(/\{\w+\}/g, 'X')
      .replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1');
  }
  // Compounds whose word is no judgement: "high school" is a place, not a
  // mark ("high" alone is evaluative).
  var COMPOUNDS = [[/\bhigh school\b/gi, 'highschool']];
  function words(text) {
    var t = plain(text);
    COMPOUNDS.forEach(function (c) {
      t = t.replace(c[0], c[1]);
    });
    return t
      .toLowerCase()
      .replace(/[‘’]s\b/g, '')
      .split(/[^a-z’-]+/)
      .filter(Boolean);
  }

  /* What the lint finds in one template or sentence: [] when it passes,
     else one line per finding ("phrasal verb: keep up"). */
  // The plan's own Not Handed In wording (Sentence grammar: "One assignment
  // is not handed in"), a participle the bank's frames repeat; "hand in"
  // as a verb ("needs to hand in the work") stays banned.
  var PLAN_PHRASES = [/\bnot handed in\b/gi];

  function findings(text) {
    var out = [];
    var p = plain(text);
    var pp = PLAN_PHRASES.reduce(function (t, re) {
      return t.replace(re, 'not-handed-in');
    }, p);
    PHRASAL_RES.forEach(function (x) {
      if (x.re.test(pp)) out.push('phrasal verb: ' + x.name);
    });
    IDIOMS.forEach(function (re) {
      if (re.test(p)) out.push('idiom: ' + re);
    });
    var ws = words(text);
    PRAISE.forEach(function (w) {
      if (ws.indexOf(w) >= 0) out.push('person praise: ' + w);
    });
    COMPARISONS.forEach(function (re) {
      if (re.test(p)) out.push('comparison: ' + re);
    });
    SHAME_RES.forEach(function (x) {
      if (x.re.test(p)) out.push('shame word: ' + x.name);
    });
    ws.forEach(function (w) {
      if (EVALUATIVE.indexOf(w) >= 0 && !CONTROLLED[w]) out.push('evaluative word: ' + w);
    });
    var n = window.CommentRealiser.wordCount(p);
    if (n > window.CommentRealiser.MAX_WORDS) out.push('over 20 words: ' + n);
    return out;
  }

  /* ── The Note for the Report (plan PR 7) ──────────────────────────── */

  /* The best-piece sentence reads "…, where {he} {note}.", so a note is
     used only when it starts with a past-tense verb: a word ending in -ed,
     or one of these irregular past forms. The grader's card
     (teacher/page-assignments.js) and the comment engine
     (teacher/comment-bank.js) share this one check. */
  var PAST_FORMS = [
    'wrote',
    'made',
    'built',
    'drew',
    'showed',
    'gave',
    'took',
    'chose',
    'found',
    'kept',
    'led',
    'read',
    'said',
    'put',
    'set',
    'used',
    'began',
    'brought',
    'came',
    'did',
    'got',
    'had',
    'held',
    'knew',
    'left',
    'met',
    'ran',
    'saw',
    'sent',
    'spoke',
    'stood',
    'taught',
    'thought',
    'told',
    'understood',
    'went',
    'won',
  ];
  function startsPastTense(note) {
    var m = String(note || '')
      .trim()
      .toLowerCase()
      .match(/^[a-z’'-]+/);
    if (!m) return false;
    var w = m[0].replace(/[’'-]+$/, '');
    return /ed$/.test(w) || PAST_FORMS.indexOf(w) >= 0;
  }

  return {
    PHRASAL: PHRASAL,
    IDIOMS: IDIOMS,
    PRAISE: PRAISE,
    COMPARISONS: COMPARISONS,
    SHAME: SHAME,
    EVALUATIVE: EVALUATIVE,
    CONTROLLED: CONTROLLED,
    plain: plain,
    words: words,
    findings: findings,
    PAST_FORMS: PAST_FORMS,
    startsPastTense: startsPastTense,
  };
})();
