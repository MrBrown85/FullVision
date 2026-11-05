/**
 * The vocabulary lint (plan PR 9). Reads every word Generate can write:
 * the whole bank (shared/comment-bank.js), the competency-to-skill table,
 * the built-in support checklist, and the habit and evidence phrases the
 * engine puts into sentences (teacher/comment-bank.js). It fails on any
 * phrasal verb, idiom, person-praise word, comparison with classmates,
 * banned phrase, sentence over 24 words, or evaluative word outside the controlled
 * vocabulary (teacher/comment-lint.js), and on the template rules the
 * realiser relies on.
 *
 * Teacher-typed text (a class's own support lines, closing sentence and
 * late-work line) is used exactly as typed and is not linted. The
 * missing-work sentence is the plan's own fixed wording ("is not handed
 * in") and is built by the engine, not the bank.
 *
 * To add wording: if the lint flags a word that is right for the bank, add
 * it to CONTROLLED in teacher/comment-lint.js with a reason; never to the
 * lists of what is banned.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

/* What is banned lives in teacher/comment-lint.js, where the personal bank
   (plan PR 10) runs the same lint on a teacher's own sentences. */
const { EVALUATIVE, CONTROLLED, plain } = CommentLint;

// Claims about the future (plan, Sentence grammar: never written). A
// comment says what the gradebook shows now; what a student "will" do,
// what results "should" show, or what the next term or report will hold
// is not a fact of theirs. The teacher's own support lines say what the
// teacher will do in class ("In class, I will…"); they are not claims
// about the student and are not read for this rule.
const FUTURE = [
  /\b(?<!I )will\b/i,
  /\bshould\b/i,
  /\b(by|before|at) the (end of (the|this) term|next report)\b/i,
  /\bnext (term|report)\b/i,
  /\bfinished the term\b/i,
  /\bthe (next|coming) (few )?weeks\b/i,
];

/* ── What the lint reads ───────────────────────────────────────────────── */

const he = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
function texts() {
  const out = COMMENT_BANK.sentences.map(s => ({ id: s.id, text: s.text, bank: true }));
  Object.entries(CommentBank.SKILLS).forEach(([fam, rows]) =>
    rows.forEach(r => out.push({ id: 'skill ' + fam + '.' + r.key, text: 'Next, {he} can ' + r.skill + '.' })),
  );
  CommentBank.SUPPORT_LINES.forEach(l => out.push({ id: 'support ' + l.id, text: l.text, support: true }));
  // The Language Goals lines are templates filled like bank sentences.
  CommentBank.LANGUAGE_GOAL_LINES.forEach(l => out.push({ id: 'language goal ' + l.id, text: l.text }));
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
  // The pipeline's own wording (COMMENT_BANK.pipeline), in the frames that
  // say it: what each level means, why a grade is IE, a strength at its
  // level, what a best piece showed, and each habit as behaviour.
  const P = COMMENT_BANK.pipeline;
  Object.entries(P.levelMeaning).forEach(([k, t]) =>
    out.push({ id: 'pipeline level ' + k, text: '{His} work shows ' + t + '.' }),
  );
  Object.entries(P.ieReason).forEach(([k, t]) =>
    out.push({ id: 'pipeline ie ' + k, text: 'The grade is IE, because ' + t + '.' }),
  );
  Object.entries(P.at).forEach(([k, xs]) =>
    xs.forEach((t, i) =>
      out.push({
        id: 'pipeline at ' + k + i,
        text: '{He} ' + t.replace('{base}', 'explain a result').replace('{does}', 'explains a result') + '.',
      }),
    ),
  );
  P.did.forEach((t, i) =>
    out.push({ id: 'pipeline did ' + i, text: 'In it, {he} ' + t.replace('{base}', 'explain a result') + '.' }),
  );
  Object.entries(P.habits).forEach(([k, h]) => {
    h.does.forEach((t, i) => out.push({ id: 'pipeline habit ' + k + ' does ' + i, text: '{He} ' + t + '.' }));
    h.invite.forEach((t, i) =>
      out.push({ id: 'pipeline habit ' + k + ' invite ' + i, text: 'The habit to build is ' + t + '.' }),
    );
    out.push({ id: 'pipeline habit ' + k + ' why', text: 'It would help, ' + h.why + '.' });
  });
  return out;
}
function findings(t) {
  const out = CommentLint.findings(t.text);
  const p = plain(t.text);
  if (!t.support) FUTURE.forEach(re => re.test(p) && out.push('future claim: ' + re));
  return out;
}

describe('the vocabulary lint', () => {
  it('reads the bank, the skill table, the support checklist and the engine’s phrases', () => {
    const all = texts();
    expect(all.filter(t => t.bank).length).toBe(COMMENT_BANK.sentences.length);
    expect(all.some(t => t.id.startsWith('skill '))).toBe(true);
    expect(all.some(t => t.id.startsWith('support '))).toBe(true);
    expect(all.some(t => t.id.startsWith('language goal '))).toBe(true);
    expect(all.some(t => t.id.startsWith('habit '))).toBe(true);
  });

  it('finds no phrasal verb, idiom, person praise, comparison, future claim, long sentence or evaluative word outside the controlled vocabulary', () => {
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
    expect(f('{He} [has|have] finally handed the work in.')).toContain('shame word: finally');
    expect(f('Ask {him} to explain it again.')).toContain('shame word: again');
    expect(f('At least the labs are done.')).toContain('shame word: at least');
    expect(f('{He} [writes|write] insightful essays.')).toContain('evaluative word: insightful');
    expect(f('{He} will finish the unit with the class.').some(x => x.startsWith('future claim'))).toBe(true);
    expect(f('{His} marks should climb by the end of the term.').some(x => x.startsWith('future claim'))).toBe(true);
    expect(f('Next term, {he} will have more to show.').some(x => x.startsWith('future claim'))).toBe(true);
    expect(f('The next report will show more.').some(x => x.startsWith('future claim'))).toBe(true);
    expect(f('Next, {he} can support each claim with evidence from a source.')).toEqual([]);
    expect(findings({ text: 'In class, I will ask about missing work each week.', support: true })).toEqual([]);
    expect(f('{His} work is solid.')).toContain('evaluative word: solid');
    expect(f('{His} work habits are excellent.')).toEqual([]);
    expect(f('{He} [is|are] earning {gradeLetter}, which is {gradeStanding} work.')).toEqual([]);
    // The Nov 4 bans: the questionnaire's lists, ratings, terms and form words.
    expect(f('{He} [is|are] earning {gradeLetter} this term.')).toContain('banned phrase: this term');
    expect(f('All six of {his} work habits are good.')).toContain('banned phrase: all six');
    expect(f('{He} [is|are] rated Consistently in every one.')).toEqual(
      expect.arrayContaining(['banned phrase: rated', 'banned phrase: every one']),
    );
    expect(f('{He} is able to explain a result.')).toContain('banned phrase: is able to');
    expect(f('{His} ability to explain a result has grown.')).toContain('banned phrase: ability to');
    expect(f('The work marked highest is the lab.')).toEqual(
      expect.arrayContaining(['banned phrase: the work marked', 'banned phrase: marked highest']),
    );
    expect(f('Marks are close across skills, skill by skill.')).toEqual(
      expect.arrayContaining([
        'banned phrase: marks are close',
        'banned phrase: across skills',
        'banned phrase: skill by skill',
      ]),
    );
    expect(f('The proficiency scale calls {his} work Proficient.')).toContain('banned phrase: proficiency scale calls');
    expect(f('Each skill is growing.')).toContain('banned phrase: each skill');
    expect(f('Keep going with the labs.')).toContain('banned phrase: keep going');
    expect(f('{He} [hands|hand] in work on time and studies biodegradability together.')).not.toContain(
      'banned phrase: ability to',
    );
    // 24 words a sentence (plan v2, Nov 4 2026).
    expect(
      f(
        'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen x y z w a b c.',
      ),
    ).toEqual([]);
    expect(
      f(
        'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen x y z w a b c d.',
      ),
    ).toContain('over 24 words: 25');
  });

  it('declares every sentence that says "next step" or "to do next": claims nextStep or advises: true', () => {
    const undeclared = COMMENT_BANK.sentences
      .filter(s => CommentLint.advisesText(s.text) && !CommentBank.advises(s))
      .map(s => s.id);
    expect(undeclared).toEqual([]);
    expect(CommentLint.advisesText('{His} next step is to read each comment.')).toBe(true);
    expect(CommentLint.advisesText('One thing to do next is to ask.')).toBe(true);
    // The Habit Ratings phrasings at Sometimes and Rarely name a thing to do.
    expect(CommentLint.advisesText('One thing to do is to ask.')).toBe(true);
    expect(CommentLint.advisesText('A start without a reminder is the thing to do.')).toBe(true);
    expect(CommentLint.advisesText('The aim this term is a plan for each task.')).toBe(true);
    expect(CommentLint.advisesText('For {him}, the change to make is to use class time.')).toBe(true);
    expect(CommentLint.advisesText('The place to start is one answer in each discussion.')).toBe(true);
    expect(CommentLint.advisesText('{He} can start with a short plan for each task.')).toBe(true);
    expect(CommentLint.advisesText('In class, the first thing for {him} to do is start the task.')).toBe(true);
    expect(CommentLint.advisesText('{He} [revises|revise] each piece after feedback.')).toBe(false);
    expect(CommentLint.findings('When a piece comes back with comments, {he} [revises|revise] it.')).toContain(
      'phrasal verb: come back',
    );
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

  it('names the student only through the role slots, never {name}, {whose} or a reflexive (the name has none)', () => {
    bank.forEach(s => expect(s.text, s.id).not.toMatch(/\{(name|whose|himself)\}/));
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
