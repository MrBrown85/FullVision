/**
 * The realiser (teacher/comment-realiser.js, plan PR 9 "Sentence grammar"):
 * every rule it applies, then the draft passing through it.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const R = CommentRealiser;
const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const SHE = { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

/* A draft sentence from a template, as Generate builds it. */
const sentence = (id, text, who, values) => ({
  id,
  text: '',
  toks: R.tokens(text, k => (values || {})[k] || ''),
  who,
});
const texts = r => r.sentences.map(x => x.text);

describe('name and pronouns', () => {
  const gabriel = { name: 'Gabriel', p: HE, onFile: true };
  const draft = [
    sentence('a', '{He} [is|are] earning a B this term, which is very good work.', gabriel),
    sentence('b', '{His} work habits are excellent.', gabriel),
    sentence('c', 'At home, you can ask {him} what {he} [is|are] reading.', gabriel),
  ];

  it('names the student in the first sentence and uses the pronouns after', () => {
    expect(texts(R.realise(draft))).toEqual([
      'Gabriel is earning a B this term, which is very good work.',
      'His work habits are excellent.',
      'At home, you can ask him what he is reading.',
    ]);
  });

  it('moves the name to whichever sentence comes first (the mockup’s reorder)', () => {
    const moved = R.realise(draft, ['b', 'a', 'c']);
    expect(texts(moved)).toEqual([
      'Gabriel’s work habits are excellent.',
      'He is earning a B this term, which is very good work.',
      'At home, you can ask him what he is reading.',
    ]);
    // Positions work as well as ids.
    expect(R.realise(draft, [2, 0, 1]).sentences[0].text).toBe('At home, you can ask Gabriel what he is reading.');
    expect(moved.text).toBe(texts(moved).join(' '));
  });

  it('uses the name again in each sentence when no pronouns are on file, they after it in that sentence', () => {
    const chris = { name: 'Chris', p: THEY, onFile: false };
    const r = R.realise([
      sentence('a', '{He} [is|are] earning a B this term, which is very good work.', chris),
      sentence('b', '{His} work habits are excellent.', chris),
      sentence('c', 'At home, you can ask {him} what {he} [is|are] reading.', chris),
    ]);
    expect(texts(r)).toEqual([
      'Chris is earning a B this term, which is very good work.',
      'Chris’s work habits are excellent.',
      'At home, you can ask Chris what they are reading.',
    ]);
  });

  it('makes the possessive ’s whatever the name ends in', () => {
    const r = R.realise([sentence('a', '{His} plan: {plan}', { name: 'Chris', p: HE, onFile: true }, { plan: 'x' })]);
    expect(r.sentences[0].text).toBe('Chris’s plan: x');
  });

  it('gives singular they plural verbs, and the name and he or she singular ones', () => {
    const t = '{He} [comes|come] to class ready and [takes|take] part.';
    const sam = { name: 'Sam', p: THEY, onFile: true };
    const ava = { name: 'Ava', p: SHE, onFile: true };
    expect(R.render(R.tokens(t), sam, { named: true })).toBe('They come to class ready and take part.');
    expect(R.render(R.tokens(t), sam, { named: false })).toBe('Sam comes to class ready and takes part.');
    expect(R.render(R.tokens(t), ava, { named: true })).toBe('She comes to class ready and takes part.');
  });

  it('never makes the name a reflexive', () => {
    const t = '{He} [sees|see] {himself} as strongest in Evidence.';
    expect(R.render(R.tokens(t), { name: 'Chris', p: THEY, onFile: false }, { named: false })).toBe(
      'Chris sees themselves as strongest in Evidence.',
    );
  });

  it('uses teacher text exactly as typed, and counts it as naming the student when it holds the name', () => {
    const r = R.realise([
      { id: 'kept:grade', text: 'gabriel did well. Gabriel is earning a B.', kept: true },
      sentence('b', '{His} work habits are excellent.', gabriel),
    ]);
    expect(texts(r)).toEqual(['gabriel did well. Gabriel is earning a B.', 'His work habits are excellent.']);
    const line = {
      id: 'class:support',
      text: 'In class, I will give feedback on source work each week.',
      classLine: true,
    };
    const r2 = R.realise([line, sentence('b', '{His} work habits are excellent.', gabriel)]);
    expect(texts(r2)).toEqual([line.text, 'Gabriel’s work habits are excellent.']);
  });
});

describe('a or an by sound', () => {
  it('says letter grades and initialisms letter by letter', () => {
    expect(['A', 'B', 'C+', 'C-', 'F', 'IE', 'IEP', 'MRI', 'BC'].map(R.aOrAn)).toEqual([
      'an A',
      'a B',
      'a C+',
      'a C-',
      'an F',
      'an IE',
      'an IEP',
      'an MRI',
      'a BC',
    ]);
  });

  it('says a word by its first sound, a number as it is said, and skips an opening quote', () => {
    expect(R.article('Extending')).toBe('an');
    expect(R.article('Proficient')).toBe('a');
    expect(R.article('Emerging')).toBe('an');
    expect(R.article('hour')).toBe('an');
    expect(R.article('honest')).toBe('an');
    expect(R.article('unit')).toBe('a');
    expect(R.article('European')).toBe('a');
    expect(R.article('one-page')).toBe('a');
    expect(R.article('uneven')).toBe('an');
    expect(R.article('8')).toBe('an');
    expect(R.article('11')).toBe('an');
    expect(R.article('18')).toBe('an');
    expect(R.article('12')).toBe('a');
    expect(R.article('“Energy Lab”')).toBe('an');
  });

  it('fixes a template’s a or an before a slot by the value’s sound', () => {
    const who = { name: 'Noor', p: SHE, onFile: true };
    const t = R.tokens('{He} [is|are] at a {word} level, and {his} best piece was a {assignment}.', k =>
      k === 'word' ? 'Extending' : 'Atom Model',
    );
    expect(R.render(t, who, { named: true })).toBe(
      'She is at an Extending level, and her best piece was an “Atom Model.”',
    );
  });
});

describe('assignment titles', () => {
  it('drops the lesson number and quotes the title', () => {
    expect(R.workTitle('4.3 What Does the Poster Show?')).toBe('What Does the Poster Show?');
    expect(R.workTitle('Lesson 2: Trench Life')).toBe('Trench Life');
    expect(R.quoteTitle('3. Map Quiz.')).toBe('“Map Quiz”');
    expect(R.quoteTitle('1984 Essay')).toBe('“1984 Essay”');
  });

  it('puts a sentence-ending period inside the closing quote, other punctuation after it', () => {
    const who = { name: 'Ava', p: SHE, onFile: true };
    const r = (text, title) =>
      R.render(
        R.tokens(text, () => title),
        who,
        { named: true },
      );
    expect(r('A highlight was {assignment}.', 'Map Quiz')).toBe('A highlight was “Map Quiz.”');
    expect(r('A highlight was {assignment}, where {he} reached Extending.', 'Map Quiz')).toBe(
      'A highlight was “Map Quiz”, where she reached Extending.',
    );
    expect(r('{His} strongest pieces were {strongWorks}.', '“A” and “B”')).toBe(
      'Her strongest pieces were “A” and “B.”',
    );
  });

  it('keeps a title’s own question mark inside the quotes, in place of the period', () => {
    const who = { name: 'Ava', p: SHE, onFile: true };
    const r = (text, title) =>
      R.render(
        R.tokens(text, () => title),
        who,
        { named: true },
      );
    expect(r('{His} best piece was {assignment}.', '4.3 What Does It Hide?')).toBe(
      'Her best piece was “What Does It Hide?”',
    );
    expect(r('{His} best piece was {assignment}, where {he} linked two ideas.', 'What Does It Hide?')).toBe(
      'Her best piece was “What Does It Hide?”, where she linked two ideas.',
    );
  });
});

describe('numbers', () => {
  it('spells out a number that starts a sentence, words from one to ten inside, numerals from 11', () => {
    const who = { name: 'Ava', p: SHE, onFile: true };
    const r = (text, n) =>
      R.render(
        R.tokens(text, () => String(n)),
        who,
        { named: true },
      );
    expect(r('{n} assignments are marked.', 15)).toBe('Fifteen assignments are marked.');
    expect(r('{n} assignments are marked.', 21)).toBe('Twenty-one assignments are marked.');
    expect(r('{He} [has|have] {n} marks.', 4)).toBe('She has four marks.');
    expect(r('{He} [has|have] {n} marks.', 10)).toBe('She has ten marks.');
    expect(r('{He} [has|have] {n} marks.', 11)).toBe('She has 11 marks.');
    expect(R.numberWords(105)).toBe('one hundred five');
  });

  it('says how many times: once, twice, then the count', () => {
    expect([1, 2, 3, 12].map(R.times)).toEqual(['once', 'twice', 'three times', '12 times']);
  });

  it('writes the attendance sentence by the plan, either half left out when empty or zero', () => {
    expect(CommentBank.attendanceText(3, 1)).toBe('missed three classes and been late once');
    expect(CommentBank.attendanceText(12, 0)).toBe('missed 12 classes');
    expect(CommentBank.attendanceText(1, null)).toBe('missed one class');
    expect(CommentBank.attendanceText(0, 2)).toBe('been late twice');
    expect(CommentBank.attendanceText(0, 0)).toBe('');
    const h60 = COMMENT_BANK.sentences.find(s => s.id === 'h60');
    const ctx = { _p: HE, name: 'Jack', attendance: CommentBank.attendanceText(3, 1) };
    expect(CommentBank.fill(h60, ctx)).toBe('He has missed three classes and been late once this term.');
  });
});

describe('lists and length', () => {
  it('joins with "and", with no serial comma, and says a value once', () => {
    expect(R.list(['A'])).toBe('A');
    expect(R.list(['A', 'B'])).toBe('A and B');
    expect(R.list(['A', 'B', 'C'])).toBe('A, B and C');
    expect(R.list(['A', 'A', '', 'B'])).toBe('A and B');
  });

  it('counts words with a quoted title as one, and flags a sentence over 20', () => {
    expect(R.wordCount('Her best piece was “What Does the Poster Show, and What Does It Hide?”.')).toBe(5);
    const twenty = Array.from({ length: 20 }, () => 'word').join(' ') + '.';
    expect(R.tooLong(twenty)).toBe(false);
    expect(R.tooLong('One more ' + twenty)).toBe(true);
    expect(R.realise([{ id: 'x', text: twenty }]).sentences[0].words).toBe(20);
  });

  it('drafts a sentence over 20 words only when nothing shorter fits', () => {
    const long = '{He} ' + Array.from({ length: 22 }, () => 'worked').join(' ') + '.';
    const bank = {
      parts: [{ id: 'now', title: 'Now' }],
      sentences: [
        { id: 'long', part: 'now', group: 'Openings', text: long, claims: [] },
        { id: 'short', part: 'now', group: 'Openings', text: '{He} [has|have] had a steady term.', claims: [] },
      ],
    };
    for (let seed = 1; seed <= 6; seed++) {
      const d = CommentBank.draft({ _p: HE, name: 'Jack' }, { seed, bank });
      expect(d.ids).toEqual(['short']);
      expect(d.text).toBe('Jack has had a steady term.');
    }
  });
});

describe('the draft passes through the realiser', () => {
  let cid, saved;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
  });
  afterAll(() => {
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const draftFor = first => {
    const st = getStudents(cid).find(s => s.firstName === first);
    const f = CommentBank.facts(cid, st, 'term-2');
    return { st, f, d: CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) }) };
  };

  it('names the student once, first, and uses the pronouns on file after', () => {
    getStudents(cid)
      .filter(s => String(s.pronouns || '').trim())
      .forEach(s => {
        const { f, d } = draftFor(s.firstName);
        const name = new RegExp('\\b' + f.name + '\\b');
        expect(d.sentences[0].text, f.name).toMatch(name);
        d.sentences.slice(1).forEach(x => expect(x.text, f.name).not.toMatch(name));
        d.sentences.forEach(x => expect(x.text, f.name).not.toMatch(/[{}[\]]|\bthe “/));
      });
  });

  it('lets the screen move a sentence first, moving the name with it', () => {
    const { f, d } = draftFor('Cece');
    const last = d.sentences.length - 1;
    const r = CommentBank.realise(d.sentences, [d.sentences[1].id]);
    expect(r.sentences[0].id).toBe(d.sentences[1].id);
    expect(r.sentences[0].text).toMatch(new RegExp('\\b' + f.name + '\\b'));
    expect(r.sentences[1].text).toMatch(/^She is /);
    expect(r.sentences.length).toBe(last + 1);
  });

  it('fills the IE comment’s Required parts as the draft does, the grade sentence naming the student', () => {
    const ctx = {
      _p: HE,
      _who: { name: 'Jack', p: HE, onFile: true },
      _path: 'ie',
      _grade: 'ie',
      _ieProblem: 'missing',
      name: 'Jack',
      missingWork: 'One assignment is not handed in: “Map Quiz.”',
      ieDeadline: 'December 18',
    };
    const parts = CommentBank.requiredParts(ctx);
    expect(parts.map(p => p.text)).toEqual([
      'Jack’s mark this term is IE, which means there is not yet enough evidence for a letter grade.',
      'One assignment is not handed in: “Map Quiz.”',
      'To earn a grade, he needs to submit the missing work.',
      'The deadline to replace this IE with a grade is December 18.',
      'Please contact me so we can talk about this plan together.',
    ]);
  });
});
