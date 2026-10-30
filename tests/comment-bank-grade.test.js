/**
 * Generate's grade sentence (plan PR 3a): in Letter and Both classes the
 * comment opens "{name} is earning {a|an} {letter} this term, which is
 * {standing} work." with the Letter Grades Order words, C- with its own
 * sentences, "close to" the next letter only upward, within 2 points, with
 * 6+ scored pieces and no downward trend. Proficiency classes use the
 * proficiency word. IE and F keep today's draft. The letter and % come
 * from calc.js, and verify() catches a grade sentence that is no longer true.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const GRADE_IDS = ['gr01', 'gr02', 'gr03', 'gr04', 'gr05'];
const piece = (d, pct) => ({ id: 'p' + d, d: '2026-10-' + String(d).padStart(2, '0'), pct });
const flat = (n, pct) => Array.from({ length: n }, (_, i) => piece(i + 1, pct));

/* Facts with only what the grade sentence reads. */
function letterFacts(letter, pct, pieces, mode) {
  return {
    name: 'Noor',
    pronouns: { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' },
    comps: [],
    work: [],
    obs: [],
    voice: {},
    confidence: [],
    record: { total: 0, handed: 0, late: 0, missing: 0 },
    habits: {},
    overall: 0,
    standing: '',
    letter: '',
    levelText: () => '',
    grade: {
      mode: mode || 'letter',
      letter,
      pct,
      next: nextLetterBand(pct),
      pieces: pieces || flat(8, pct),
    },
  };
}

/* One sentence as a draft, filled from ctx, to verify against facts. */
function one(id, ctx) {
  const s = byId(id);
  const text = CommentBank.fill(s, ctx);
  return {
    text,
    ids: [id],
    sentences: [{ id, part: s.part, text }],
    provenance: [CommentBank.provenance(s, ctx)],
  };
}
const words = t => t.trim().split(/\s+/).length;

describe('the grade sentences in the bank', () => {
  it('are worded per the plan, claim the grade, and stay within 20 words', () => {
    const ctx = CommentBank.context(letterFacts('B', 84.5), {});
    expect(CommentBank.fill(byId('gr01'), { ...ctx, gradeNext: '' })).toBe(
      'Noor is earning a B this term, which is very good work.',
    );
    expect(CommentBank.fill(byId('gr02'), ctx)).toBe(
      'Noor is earning a B this term, which is very good work and close to an A.',
    );
    GRADE_IDS.forEach(id => {
      expect(byId(id)).toMatchObject({ part: 'now', group: 'Grade', claims: ['grade'] });
      expect(words(CommentBank.fill(byId(id), ctx)), id).toBeLessThanOrEqual(20);
    });
  });

  it('gives C- its own sentences, with the minimally acceptable wording', () => {
    expect(byId('gr03').text).toBe('{name} is earning a C- this term, which is minimally acceptable work.');
    expect(byId('gr04').text).toBe(
      '{name} is earning a C- this term, which is minimally acceptable work and close to a C.',
    );
  });
});

describe('a or an by sound', () => {
  it('says a letter grade letter by letter, and a word by its first letter', () => {
    expect(['A', 'B', 'C+', 'C', 'C-', 'F', 'IE'].map(CommentBank.aOrAn)).toEqual([
      'an A',
      'a B',
      'a C+',
      'a C',
      'a C-',
      'an F',
      'an IE',
    ]);
    expect(['Extending', 'Proficient', 'Developing', 'Emerging'].map(CommentBank.aOrAn)).toEqual([
      'an Extending',
      'a Proficient',
      'a Developing',
      'an Emerging',
    ]);
  });
});

describe('the next letter band (calc.js)', () => {
  it('names the letter above and where it starts', () => {
    expect(nextLetterBand(82.9)).toEqual({ letter: 'A', min: 86 });
    expect(nextLetterBand(72)).toEqual({ letter: 'B', min: 73 });
    expect(nextLetterBand(66.9)).toEqual({ letter: 'C+', min: 67 });
    expect(nextLetterBand(59.9)).toEqual({ letter: 'C', min: 60 });
    expect(nextLetterBand(49)).toEqual({ letter: 'C-', min: 50 });
    expect(nextLetterBand(86)).toBeNull();
    expect(nextLetterBand(null)).toBeNull();
  });
});

describe('the downward trend', () => {
  it('compares the median % of the latest third with the earliest third, in date order', () => {
    expect(CommentBank.trendingDown(flat(6, 80))).toBe(false);
    expect(CommentBank.trendingDown([90, 88, 80, 85, 70, 72].map((p, i) => piece(i + 1, p)))).toBe(true);
    expect(CommentBank.trendingDown([70, 72, 80, 85, 90, 88].map((p, i) => piece(i + 1, p)))).toBe(false);
    // Out of order in the list, read by date.
    const down = [90, 88, 80, 85, 70, 72].map((p, i) => piece(i + 1, p)).reverse();
    expect(CommentBank.trendingDown(down)).toBe(true);
    // One low piece in the middle is not a trend.
    expect(CommentBank.trendingDown([84, 86, 40, 85, 84, 86].map((p, i) => piece(i + 1, p)))).toBe(false);
    expect(CommentBank.trendingDown([piece(1, 90), piece(2, 50)])).toBe(false);
  });
});

describe('close to the next letter', () => {
  const close = (pct, pieces) => CommentBank.closeTo(letterFacts('B', pct, pieces).grade);

  it('fires within 2 points below the next band, with 6+ scored pieces and no downward trend', () => {
    expect(close(84)).toEqual({ letter: 'A', min: 86, gap: 2 });
    expect(close(85.9)).toEqual({ letter: 'A', min: 86, gap: 0.1 });
    expect(close(83.9)).toBeNull(); // 2.1 points short
    expect(close(82.9)).toBeNull(); // the mockup's Gabriel: 3.1 short
    expect(close(85, flat(6, 85))).not.toBeNull();
    expect(close(85, flat(5, 85))).toBeNull();
    expect(
      close(
        85,
        [95, 92, 85, 85, 78, 76].map((p, i) => piece(i + 1, p)),
      ),
    ).toBeNull();
  });

  it('only upward: never at an A, and C- is close to a C', () => {
    expect(CommentBank.closeTo(letterFacts('A', 99).grade)).toBeNull();
    expect(CommentBank.closeTo(letterFacts('C-', 58.5).grade)).toMatchObject({ letter: 'C' });
  });
});

describe('gradeOf', () => {
  it('gives each letter its Letter Grades Order standing word', () => {
    const at = (L, pct) => CommentBank.gradeOf(letterFacts(L, pct));
    expect(at('A', 90)).toEqual({ kind: 'letter', letter: 'A', standing: 'excellent', next: '' });
    expect(at('B', 80)).toEqual({ kind: 'letter', letter: 'B', standing: 'very good', next: '' });
    expect(at('C+', 70)).toEqual({ kind: 'letter', letter: 'C+', standing: 'good', next: '' });
    expect(at('C', 62)).toEqual({ kind: 'letter', letter: 'C', standing: 'satisfactory', next: '' });
    expect(at('C-', 52)).toEqual({ kind: 'cminus', letter: 'C-', standing: 'minimally acceptable', next: '' });
    expect(at('B', 84.5)).toMatchObject({ kind: 'letterClose', next: 'A' });
    expect(at('C-', 59)).toMatchObject({ kind: 'cminusClose', next: 'C' });
    expect(CommentBank.gradeOf(letterFacts('B', 80, null, 'both')).kind).toBe('letter');
  });

  it('has no grade sentence for IE, F or no marks', () => {
    expect(CommentBank.gradeOf(letterFacts('IE', 42))).toBeNull();
    expect(CommentBank.gradeOf(letterFacts('F', 42))).toBeNull();
    expect(CommentBank.gradeOf(letterFacts(null, null, []))).toBeNull();
  });

  it('uses the proficiency word in a Proficiency class', () => {
    const f = { ...letterFacts(null, null, [], 'proficiency'), overall: 3.1, standing: 'Proficient' };
    expect(CommentBank.gradeOf(f)).toEqual({ kind: 'proficiency', word: 'Proficient' });
    const ctx = CommentBank.context(f, {});
    expect(CommentBank.fill(byId('gr05'), ctx)).toBe('Noor is Proficient on the BC proficiency scale this term.');
    expect(GRADE_IDS.filter(id => CommentBank.fits(byId(id), ctx))).toEqual(['gr05']);
  });
});

describe('verify catches a wrong grade', () => {
  it('passes a true grade sentence and catches it once the letter changes', () => {
    const f = letterFacts('B', 80);
    const d = one('gr01', CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const lower = letterFacts('C+', 70);
    expect(CommentBank.verify(d, lower, {}).replaced[0]).toMatchObject({ sentenceId: 'gr01' });
    expect(CommentBank.verify(d, lower, {}).replaced[0].failed).toContain('grade');
  });

  it('catches a grade sentence filled with a letter the facts do not give', () => {
    const f = letterFacts('B', 80);
    const ctx = CommentBank.context(f, {});
    const wrong = one('gr01', { ...ctx, gradeLetter: 'an A', gradeStanding: 'excellent' });
    expect(wrong.text).toBe('Noor is earning an A this term, which is excellent work.');
    const v = CommentBank.verify(wrong, f, {});
    expect(v.replaced[0].failed).toEqual(['slots', 'grade']);
    expect(v.text).not.toMatch(/an A/);
    // The claim alone, without the slot check, still fails.
    expect(CommentBank.CLAIMS.grade(wrong.provenance[0], f, ctx)).toBe(false);
  });

  it('catches "close to" once the gate no longer passes', () => {
    const f = letterFacts('B', 84.5);
    const d = one('gr02', CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    expect(CommentBank.verify(d, letterFacts('B', 83.5), {}).replaced[0].failed).toContain('grade');
    expect(CommentBank.verify(d, letterFacts('B', 84.5, flat(5, 84.5)), {}).replaced[0].failed).toContain('grade');
    const falling = [95, 92, 85, 85, 78, 76].map((p, i) => piece(i + 1, p));
    expect(CommentBank.verify(d, letterFacts('B', 84.5, falling), {}).replaced[0].failed).toContain('grade');
  });

  it('catches a C- sentence for a student who is now a C', () => {
    const f = letterFacts('C-', 55);
    const d = one('gr03', CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    expect(CommentBank.verify(d, letterFacts('C', 61), {}).replaced[0].failed).toContain('grade');
  });

  it('catches a proficiency word that has changed', () => {
    const f = { ...letterFacts(null, null, [], 'proficiency'), overall: 3.1, standing: 'Proficient' };
    const d = one('gr05', CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const lower = { ...f, overall: 2.1, standing: 'Developing' };
    expect(CommentBank.verify(d, lower, {}).replaced[0].failed).toContain('grade');
  });
});

describe('Generate in a Letter class', () => {
  const CID = 'course-grade-sentence';
  const TERM = 'term-1';
  const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'they/them' };
  const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

  /* Proficiency-scored work on two competencies, one piece a day: each
     level is level ÷ 4 of the course % (no categories). */
  function seed(gradingSystem, levels) {
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem };
    _cache.students[CID] = [NOOR];
    _cache.learningMaps[CID] = {
      sections: [section('sec-1', 't1', 'Cause and Consequence'), section('sec-2', 't2', 'Evidence')],
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = levels.map((_, i) => ({
      id: 'a' + i,
      title: 'Task ' + (i + 1),
      scoreMode: 'proficiency',
      tagIds: [i % 2 ? 't2' : 't1'],
      type: 'summative',
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
    }));
    _cache.scores[CID] = {
      [NOOR.id]: levels.map((v, i) => ({
        assessmentId: 'a' + i,
        tagId: i % 2 ? 't2' : 't1',
        score: v,
        date: '2026-10-' + String(i + 1).padStart(2, '0'),
      })),
    };
    _cache.statuses[CID] = {};
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = {};
    _cache.observations[CID] = {};
    _cache.reflections[CID] = {};
    _cache.termRatings[CID] = {};
    clearProfCache();
    return CommentBank.facts(CID, NOOR, TERM);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    delete COURSES[CID];
    clearProfCache();
  });

  const claimsGrade = id => (byId(id).claims || []).indexOf('grade') >= 0;

  it('opens with the grade from calc.js and states it nowhere else', () => {
    const f = seed('letter', [3, 3, 3, 3]);
    const badge = studentGradeBadges(CID, NOOR.id).letter;
    expect(badge.grade).toBe('B');
    expect(f.grade).toMatchObject({ mode: 'letter', letter: 'B', pct: 75 });
    expect(f.grade.letter).toBe(percentageToLetter(f.grade.pct, CID));
    expect(f.grade.pieces).toHaveLength(4);
    for (let seedN = 1; seedN <= 10; seedN++) {
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: seedN });
      expect(d.sentences[0].text).toBe('Noor is earning a B this term, which is very good work.');
      expect(d.ids.slice(1).filter(claimsGrade), 'seed ' + seedN).toEqual([]);
      expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    }
  });

  it('says close to an A at 85.7% with seven pieces and no downward trend', () => {
    const f = seed('letter', [4, 3, 3, 4, 3, 4, 3]);
    expect(f.grade).toMatchObject({ letter: 'B', pct: 85.7, next: { letter: 'A', min: 86 } });
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.sentences[0].text).toBe('Noor is earning a B this term, which is very good work and close to an A.');
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
  });

  it('does not say close to when the latest work is lower', () => {
    const f = seed('letter', [4, 4, 4, 3, 3, 3, 3]);
    expect(f.grade.pct).toBe(85.7);
    expect(CommentBank.trendingDown(f.grade.pieces)).toBe(true);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.sentences[0].text).toBe('Noor is earning a B this term, which is very good work.');
  });

  it('does not say close to with fewer than six scored pieces', () => {
    const f = seed('letter', [4, 3, 4, 3, 3]);
    expect(f.grade.pct).toBe(85);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.sentences[0].text).toBe('Noor is earning a B this term, which is very good work.');
  });

  it('catches the sentence after the marks change', () => {
    const f = seed('letter', [3, 3, 3, 3]);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    const lower = seed('letter', [3, 3, 2, 3]); // 68.8%: a C+
    expect(lower.grade.letter).toBe('C+');
    const v = CommentBank.verify(d, lower, {});
    expect(v.replaced.find(r => r.sentenceId === 'gr01').failed).toEqual(['slots', 'grade']);
    expect(v.text).not.toMatch(/earning a B/);
  });

  it('uses the letter in a Both class', () => {
    const f = seed('both', [3, 3, 3, 3]);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.sentences[0].text).toBe('Noor is earning a B this term, which is very good work.');
    expect(d.ids.slice(1).filter(claimsGrade)).toEqual([]);
  });

  it('uses the proficiency word in a Proficiency class', () => {
    const f = seed('proficiency', [3, 3, 3, 3]);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.sentences[0].text).toBe('Noor is Proficient on the BC proficiency scale this term.');
    expect(d.ids.slice(1).filter(claimsGrade)).toEqual([]);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
  });

  it('leaves the draft for an IE student as it was', () => {
    const f = seed('letter', [1, 1, 2, 1]); // 31.3%: IE before the course ends
    expect(f.grade.letter).toBe('IE');
    expect(CommentBank.gradeOf(f)).toBeNull();
    const without = {
      parts: COMMENT_BANK.parts,
      sentences: COMMENT_BANK.sentences.filter(s => s.group !== 'Grade'),
    };
    for (let seedN = 1; seedN <= 10; seedN++) {
      const ctx = CommentBank.context(f, {});
      const d = CommentBank.draft(ctx, { seed: seedN });
      expect(d.ids.filter(id => GRADE_IDS.indexOf(id) >= 0)).toEqual([]);
      expect(d.text).toBe(CommentBank.draft(ctx, { seed: seedN, bank: without }).text);
    }
  });
});
