/**
 * The vocabulary lint (plan PR 9). Reads every word Generate can write:
 * the whole bank (shared/comment-bank.js), the competency-to-skill table,
 * the built-in support checklist, and the habit and evidence phrases the
 * engine puts into sentences (teacher/comment-bank.js). It fails on any
 * phrasal verb, idiom, person-praise word, comparison with classmates,
 * sentence over 20 words, or evaluative word outside the controlled
 * vocabulary below, and on the template rules the realiser relies on.
 *
 * Teacher-typed text (a class's own support lines, closing sentence and
 * late-work line) is used exactly as typed and is not linted. The
 * missing-work sentence is the plan's own fixed wording ("is not handed
 * in") and is built by the engine, not the bank.
 *
 * To add wording: if the lint flags a word that is right for the bank, add
 * it to CONTROLLED with a reason; never to the lists of what is banned.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

/* ── What is banned ────────────────────────────────────────────────────── */

// Phrasal verbs: [verb, particle]. Any form of the verb, the particle
// right after it or after a short object ("talk it through").
const PHRASAL = [
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
  ['come', 'along'],
  ['come', 'in'],
  ['come', 'into'],
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
  ['turn', 'around'],
  ['walk', 'through'],
  ['work', 'on'],
  ['work', 'out'],
  ['work', 'through'],
  ['write', 'up'],
];
const IRREGULAR = {
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
  const out = [v];
  if (/e$/.test(v)) out.push(v + 's', v + 'd', v.slice(0, -1) + 'ing');
  else if (/[^aeiou]y$/.test(v)) out.push(v.slice(0, -1) + 'ies', v.slice(0, -1) + 'ied', v + 'ing');
  else if (/(ch|sh|ss|x)$/.test(v)) out.push(v + 'es', v + 'ed', v + 'ing');
  else out.push(v + 's', v + 'ed', v + 'ing');
  return out.concat(IRREGULAR[v] || []);
}
const OBJECT = '(?:\\s+(?:it|them|that|this|X|you|him|her|his|their|work|the work)){0,2}';
const PHRASAL_RES = PHRASAL.map(([v, p]) => ({
  name: v + ' ' + p,
  re: new RegExp('\\b(?:' + forms(v).join('|') + ')' + OBJECT + '\\s+' + p + '\\b(?!\\s+time\\b)', 'i'),
}));

// Idioms and figures of speech a family reading in a second language
// would have to decode.
const IDIOMS = [
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
];

// Praise of the person, not the work.
const PRAISE = [
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

// Comparisons with classmates.
const COMPARISONS = [
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
const EVALUATIVE = [
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
const CONTROLLED = {
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

/* ── What the lint reads ───────────────────────────────────────────────── */

const he = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
function texts() {
  const out = COMMENT_BANK.sentences.map(s => ({ id: s.id, text: s.text, bank: true }));
  Object.entries(CommentBank.SKILLS).forEach(([fam, rows]) =>
    rows.forEach(r => out.push({ id: 'skill ' + fam + '.' + r.key, text: 'Next, {he} can ' + r.skill + '.' })),
  );
  CommentBank.SUPPORT_LINES.forEach(l => out.push({ id: 'support ' + l.id, text: l.text }));
  ['build', 'does', 'do'].forEach(form =>
    ['', 'pe', 'arts'].forEach(fam =>
      CommentBank.HABITS.forEach(h =>
        out.push({
          id: 'habit ' + h.key + '.' + form + (fam ? '.' + fam : ''),
          text: CommentBank.habitWords(h.key, form, fam, he),
        }),
      ),
    ),
  );
  Object.entries(CommentBank.EVIDENCE).forEach(([k, t]) => out.push({ id: 'evidence ' + k, text: t }));
  return out;
}
/* A template as plain words: each slot and verb choice one word ("X"). */
function plain(text) {
  return String(text)
    .replace(/\{\w+\}/g, 'X')
    .replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1');
}
function words(text) {
  return plain(text)
    .toLowerCase()
    .replace(/[‘’]s\b/g, '')
    .split(/[^a-z’-]+/)
    .filter(Boolean);
}

function findings(t) {
  const out = [];
  const p = plain(t.text);
  PHRASAL_RES.forEach(x => x.re.test(p) && out.push('phrasal verb: ' + x.name));
  IDIOMS.forEach(re => re.test(p) && out.push('idiom: ' + re));
  const ws = words(t.text);
  PRAISE.forEach(w => ws.includes(w) && out.push('person praise: ' + w));
  COMPARISONS.forEach(re => re.test(p) && out.push('comparison: ' + re));
  ws.forEach(w => EVALUATIVE.includes(w) && !CONTROLLED[w] && out.push('evaluative word: ' + w));
  const n = CommentRealiser.wordCount(p);
  if (n > CommentRealiser.MAX_WORDS) out.push('over 20 words: ' + n);
  return out;
}

describe('the vocabulary lint', () => {
  it('reads the bank, the skill table, the support checklist and the engine’s phrases', () => {
    const all = texts();
    expect(all.filter(t => t.bank).length).toBe(COMMENT_BANK.sentences.length);
    expect(all.some(t => t.id.startsWith('skill '))).toBe(true);
    expect(all.some(t => t.id.startsWith('support '))).toBe(true);
    expect(all.some(t => t.id.startsWith('habit '))).toBe(true);
  });

  it('finds no phrasal verb, idiom, person praise, comparison, long sentence or evaluative word outside the controlled vocabulary', () => {
    const bad = texts()
      .map(t => ({ id: t.id, text: t.text, why: findings(t) }))
      .filter(x => x.why.length);
    expect(bad).toEqual([]);
  });

  it('catches each kind of wording it is meant to', () => {
    const f = text => findings({ text });
    expect(f('A regular time for homework would help {him} keep up.')).toContain('phrasal verb: keep up');
    expect(f('{He} [needs|need] to hand in the missing work.')).toContain('phrasal verb: hand in');
    expect(f('{He} caught up on the labs.')).toContain('phrasal verb: catch up');
    expect(f('{He} figured it out.')).toContain('phrasal verb: figure out');
    expect(f('{He} [is|are] working on {focus}.')).toContain('phrasal verb: work on');
    expect(f('Ask {him} to talk it through.')).toContain('phrasal verb: talk through');
    expect(f('There is more room to grow in {focus}.').some(x => x.startsWith('idiom'))).toBe(true);
    expect(f('{He} [is|are] a bright student.')).toContain('person praise: bright');
    expect(f('{He} [is|are] talented.')).toContain('person praise: talented');
    expect(f('{He} [is|are] at the top of the class.').some(x => x.startsWith('comparison'))).toBe(true);
    expect(f('{His} work is stronger than others.').some(x => x.startsWith('comparison'))).toBe(true);
    expect(f('{He} [writes|write] insightful essays.')).toContain('evaluative word: insightful');
    expect(f('{His} work is solid.')).toContain('evaluative word: solid');
    expect(f('{His} work habits are excellent.')).toEqual([]);
    expect(f('{He} [is|are] earning {gradeLetter} this term, which is {gradeStanding} work.')).toEqual([]);
    expect(
      f('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.'),
    ).toEqual([]);
    expect(
      f(
        'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen x y z w.',
      ),
    ).toContain('over 20 words: 21');
  });

  it('counts a quoted title as one word', () => {
    expect(CommentRealiser.wordCount('His best piece was “What Does the Poster Show, and What Does It Hide?”.')).toBe(
      5,
    );
  });

  it('keeps the controlled vocabulary to words the lint knows as evaluative', () => {
    Object.keys(CONTROLLED).forEach(w => expect(EVALUATIVE, w).toContain(w));
  });
});

describe('the bank’s templates follow the realiser’s rules', () => {
  const bank = COMMENT_BANK.sentences;

  it('names the student only through the role slots, never {name} or {whose}', () => {
    bank.forEach(s => expect(s.text, s.id).not.toMatch(/\{(name|whose)\}/));
  });

  it('puts a [singular|plural] verb only after a subject slot in the same sentence', () => {
    bank.forEach(s => {
      const re = /\[[^\]]*\]/g;
      let m;
      while ((m = re.exec(s.text))) expect(s.text.slice(0, m.index), s.id).toMatch(/\{[Hh]e\}/);
    });
  });

  it('is one sentence a template, with curly quotes and apostrophes only', () => {
    bank.forEach(s => {
      expect(plain(s.text), s.id).not.toMatch(/[.!?]\s+[A-Z]/);
      expect(s.text, s.id).not.toMatch(/['"]/);
    });
  });

  it('quotes a title slot itself: no "the" or "his" before one', () => {
    bank.forEach(s =>
      expect(s.text, s.id).not.toMatch(/\b(the|his|her|their|\{his\}) \{(assignment2?|seeWork|aboutWork)\}/i),
    );
  });

  it('writes a or an by sound, numbers by the rule and lists with no serial comma', () => {
    texts().forEach(t => {
      const p = plain(t.text);
      const re = /\b(a|an) ([A-Za-z][\w+-]*)/g;
      let m;
      while ((m = re.exec(p))) {
        if (m[2] === 'X') continue;
        expect(m[1].toLowerCase(), t.id + ': ' + m[0]).toBe(CommentRealiser.article(m[2]));
      }
      // Numerals from 0 to 10 inside a sentence, and words for 11 and up.
      expect(p, t.id).not.toMatch(/(^|\s)(10|[0-9])(\s|$)/);
      expect(p, t.id).not.toMatch(
        /\s(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i,
      );
      expect(p, t.id + ' starts with a numeral').not.toMatch(/^\d/);
      // "A, B, and C": a comma before the "and" that ends a short list.
      expect(p, t.id).not.toMatch(/(^|[\s(])\w+(?: \w+)?, \w+(?: \w+)?, (and|or) /);
    });
  });
});
