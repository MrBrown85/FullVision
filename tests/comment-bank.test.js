/**
 * The Term Questionnaire's Comment Bank (teacher/comment-bank.js, the bank
 * in shared/comment-bank.js). Ported from auto-narrative-grammar.test.js:
 * the old generator's grammar cases ("a student who are capable", singular
 * they) now hold for every bank sentence, and nothing is generated.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const P = {
  she: { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' },
  he: { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' },
  they: { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' },
};

/* Every slot with a value, for the grammar checks. */
function fullContext(p, habits) {
  return {
    _p: p,
    _habits: habits || {},
    name: 'Noor',
    course: 'Science 8',
    picture: 'steady',
    standing: 'a Proficient level',
    letterStanding: 'a B (78%)',
    strengths: 'Evaluating',
    growthAreas: 'Communicating',
    even: 'yes',
    rise: 'Evaluating',
    fellCount: 'two',
    assignment: 'Energy Lab',
    level: 'Extending',
    assignment2: 'Map Quiz',
    level2: 'Developing',
    strongWorks: 'the Energy Lab',
    weakWorks: 'the Map Quiz',
    evidence: 'a solid grasp of the material',
    note: 'Asked a good question.',
    when: 'on Oct 24',
    concernNote: 'Left the lab early.',
    concernWhen: 'Oct 2',
    selfGood: '“Labs.”',
    selfHard: '“Deadlines.”',
    selfStrong: 'Evaluating',
    selfLow: 'Communicating',
    goal: '“Finish on time.”',
    plan: '“Start early.”',
    focus: 'Evaluating',
    nextStep: 'I can identify sources of error.',
    seeWork: 'Energy Lab',
    aboutWork: 'Map Quiz',
    strengthHabits: 'consistently uses feedback to improve ' + p.poss + ' work',
    growthHabits: 'taking part in class',
    strengthHabitNames: 'using feedback',
    growthHabitNames: 'taking part in class',
    absent: '4',
    late: '2',
  };
}

describe('the bank', () => {
  it('has 100 sentences in four parts, each with a unique id', () => {
    expect(COMMENT_BANK.sentences).toHaveLength(100);
    expect(COMMENT_BANK.parts.map(p => p.id)).toEqual(['habits', 'now', 'go', 'how']);
    expect(new Set(COMMENT_BANK.sentences.map(s => s.id)).size).toBe(100);
  });

  it('puts a [singular|plural] verb only right after a pronoun', () => {
    COMMENT_BANK.sentences.forEach(s => {
      const re = /\[[^\]]*\]/g;
      let m;
      while ((m = re.exec(s.text))) expect(s.text.slice(0, m.index), s.id).toMatch(/\{[Hh]e\} $/);
    });
  });

  it('names only habits and levels that exist', () => {
    const keys = CommentBank.HABITS.map(h => h.key);
    COMMENT_BANK.sentences.forEach(s => {
      Object.entries(s.when || {}).forEach(([k, v]) => {
        if (k === 'picture') expect(['strong', 'steady', 'challenge', 'early']).toContain(v);
        else {
          expect(keys, s.id).toContain(k);
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(4);
        }
      });
    });
  });
});

describe('fill', () => {
  for (const [who, p] of Object.entries(P)) {
    it(`fills every sentence for ${who}, with no slot left and a capital first`, () => {
      const ctx = fullContext(p);
      COMMENT_BANK.sentences.forEach(s => {
        const t = CommentBank.fill(s, ctx);
        expect(t, s.id).not.toMatch(/[{}[\]]/);
        expect(t[0], s.id).toBe(t[0].toUpperCase());
        expect(t, s.id).not.toMatch(/ {2}/);
      });
    });
  }

  it('conjugates for singular they and keeps the name singular', () => {
    const h13 = COMMENT_BANK.sentences.find(s => s.id === 'h13');
    expect(CommentBank.fill(h13, fullContext(P.they))).toBe(
      'Noor is well prepared each day and adds thoughtful ideas when they join a discussion.',
    );
    expect(CommentBank.fill(h13, fullContext(P.she))).toBe(
      'Noor is well prepared each day and adds thoughtful ideas when she joins a discussion.',
    );
    const h02 = COMMENT_BANK.sentences.find(s => s.id === 'h02');
    expect(CommentBank.fill(h02, fullContext(P.they))).toBe('They are working on taking part in class.');
    expect(CommentBank.fill(h02, fullContext(P.he))).toBe('He is working on taking part in class.');
  });

  it('puts a habit phrase in as the context gives it', () => {
    const h01 = COMMENT_BANK.sentences.find(s => s.id === 'h01');
    expect(CommentBank.fill(h01, fullContext(P.he))).toBe('Noor consistently uses feedback to improve his work.');
  });
});

describe('fill takes values as written', () => {
  it('never reads a slot or a verb choice inside a value', () => {
    const n50 = COMMENT_BANK.sentences.find(s => s.id === 'n50');
    const ctx = { ...fullContext(P.she), selfGood: '“I like [math|science] and {name} games.”' };
    expect(CommentBank.fill(n50, ctx)).toBe(
      'In her own words, she is good at this: “I like [math|science] and {name} games.”',
    );
  });

  it('gives nothing for a slot the context does not own', () => {
    const s = { id: 'x', text: '{name} and {constructor}.' };
    expect(CommentBank.fill(s, fullContext(P.he))).toBe('Noor and .');
  });

  it('fills the pronoun in a habit phrase when the context is built', () => {
    const st = { id: 's', firstName: 'Ava', pronouns: 'she/her' };
    const f = {
      name: 'Ava',
      pronouns: ReportBlocks.getPronouns(st),
      comps: [],
      work: [],
      record: { total: 0, handed: 0, late: 0, missing: 0 },
      obs: [],
      voice: {},
      confidence: [],
      habits: { feedback: 4, devices: 2 },
      levelText: () => '',
    };
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengthHabits).toBe('consistently uses feedback to improve her work');
    expect(ctx.growthHabits).toBe('using devices for learning and putting her phone away when asked');
  });
});

describe('the note keeps its own ending', () => {
  const f = note => ({
    name: 'Ava',
    pronouns: { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' },
    comps: [],
    work: [],
    record: { total: 0, handed: 0, late: 0, missing: 0 },
    obs: [{ id: 'o1', text: note, day: 'Oct 24', sentiment: 'growth' }],
    voice: {},
    confidence: [],
    habits: {},
    levelText: () => '',
  });

  it('adds a period only when the note has no . ! or ?', () => {
    expect(CommentBank.context(f('Asked why the ice melted faster?'), {}).note).toBe(
      'Asked why the ice melted faster?',
    );
    expect(CommentBank.context(f('Helped a classmate!'), {}).note).toBe('Helped a classmate!');
    expect(CommentBank.context(f('Finished the lab  '), {}).note).toBe('Finished the lab.');
    expect(CommentBank.context(f('Left early?'), {}).concernNote).toBe('Left early?');
  });
});

describe('lastStart', () => {
  it('finds the first word of the last sentence, quotes and all', () => {
    expect(CommentBank.lastStart('Cece works hard. She asks “why?” Then she writes it down')).toBe('Then');
    expect(CommentBank.lastStart('One sentence only')).toBe('One');
    expect(CommentBank.lastStart('Ends here. ')).toBe('Ends');
    expect(CommentBank.lastStart('')).toBe('');
  });
});

describe('focusOptions', () => {
  const comp = (id, start, now) => ({ id, name: id, start, now, level: now, scores: [{ v: now }], iCans: [] });
  const f = {
    comps: [comp('A', 3, 3), comp('B', 4, 2), comp('C', 3.5, 2.5), comp('D', 3, 2.2), comp('E', 2, 2.9)],
    defaultFocusId: 'A',
  };

  it('leads with the report’s Focus Area, then the biggest changes', () => {
    expect(CommentBank.focusOptions(f).map(c => c.id)).toEqual(['A', 'B', 'C']);
  });

  it('keeps a saved Focus Area that is no longer in the top three', () => {
    expect(CommentBank.focusOptions(f, 'E').map(c => c.id)).toEqual(['A', 'B', 'E']);
    expect(CommentBank.focusOptions(f, 'B').map(c => c.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('fits', () => {
  it('does not offer a sentence with a missing slot', () => {
    const ctx = fullContext(P.she);
    const n31 = COMMENT_BANK.sentences.find(s => s.id === 'n31');
    expect(CommentBank.fits(n31, ctx)).toBe(true);
    expect(CommentBank.fits(n31, { ...ctx, assignment: '' })).toBe(false);
    const h60 = COMMENT_BANK.sentences.find(s => s.id === 'h60');
    expect(CommentBank.fits(h60, { ...ctx, absent: '' })).toBe(false);
  });

  it('filters by habit level with `when`', () => {
    const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
    const ctx = fullContext(P.she, { completes: 4, part: 4 });
    expect(CommentBank.fits(byId('h10'), ctx)).toBe(true); // Consistently and Consistently
    expect(CommentBank.fits(byId('h12'), ctx)).toBe(false); // part Usually
    expect(CommentBank.fits(byId('h30'), ctx)).toBe(true);
    expect(CommentBank.fits(byId('h32'), ctx)).toBe(false);
    const notSeen = fullContext(P.she, { completes: 5 });
    expect(['h30', 'h32', 'h34', 'h36'].some(id => CommentBank.fits(byId(id), notSeen))).toBe(false);
    expect(CommentBank.fits(byId('n04'), ctx)).toBe(true); // picture steady
    expect(CommentBank.fits(byId('n01'), ctx)).toBe(false); // picture strong
  });
});

describe('Completes Work from the record', () => {
  it('follows the plan’s rule until the teacher picks', () => {
    const c = CommentBank.completesFromRecord;
    expect(c({ total: 22, handed: 22, late: 0, missing: 0 })).toBe(4);
    expect(c({ total: 22, handed: 22, late: 1, missing: 0 })).toBe(3);
    expect(c({ total: 22, handed: 22, late: 3, missing: 0 })).toBe(2);
    expect(c({ total: 22, handed: 21, late: 0, missing: 1 })).toBe(2);
    expect(c({ total: 22, handed: 19, late: 0, missing: 3 })).toBe(1);
    expect(c({ total: 0, handed: 0, late: 0, missing: 0 })).toBeUndefined();
    const rec = { total: 5, handed: 5, late: 0, missing: 0 };
    expect(CommentBank.effectiveHabits({}, rec)).toEqual({ completes: 4 });
    expect(CommentBank.effectiveHabits({ completes: 2, part: 5, kind: 3 }, rec)).toEqual({ completes: 2, part: 5 });
  });
});

describe('parts', () => {
  const bank = {
    parts: [{ id: 'now', title: 'Where They Are Now' }],
    sentences: [
      { id: 'a', part: 'now', group: 'G', text: '{name} worked hard on every lab this term.' },
      { id: 'b', part: 'now', group: 'G', text: '{name} asked careful questions in every class.' },
      { id: 'c', part: 'now', group: 'G', text: '{name} kept a tidy and complete lab notebook.' },
      { id: 'd', part: 'now', group: 'H', text: '{name} needs {missing}.', needs: ['missing'] },
    ],
  };
  const ctx = { ...fullContext(P.she), name: 'Cece' };

  it('shows two per group until Show All, and counts what waits on data', () => {
    const [part] = CommentBank.parts(ctx, '', { bank });
    expect(part.rows.map(r => r.id)).toEqual(['a', 'b']);
    expect(part.fit).toBe(3);
    expect(part.waiting).toBe(1);
    expect(part.canMore).toBe(true);
    const [all] = CommentBank.parts(ctx, '', { bank, more: { now: true } });
    expect(all.rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps an added sentence shown and marks it added', () => {
    const text = 'Cece kept a tidy and complete lab notebook.';
    const [part] = CommentBank.parts(ctx, text, { bank });
    expect(part.rows.map(r => [r.id, r.added])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
    ]);
    expect(part.inComment).toBe(true);
  });

  it('sorts a sentence used for three or more classmates to the end of its group', () => {
    const comments = [
      'Noor worked hard on every lab this term. More.',
      'Sam worked hard on every lab this term.',
      'Ava worked hard on every lab this term. Then more.',
      'Liam asked careful questions in every class.',
    ];
    const [part] = CommentBank.parts(ctx, '', { bank, comments });
    expect(part.rows.map(r => r.id)).toEqual(['b', 'c']);
    const [all] = CommentBank.parts(ctx, '', { bank, comments, more: { now: true } });
    expect(all.rows.map(r => [r.id, r.used, r.crowded])).toEqual([
      ['b', 1, false],
      ['c', 0, false],
      ['a', 3, true],
    ]);
  });

  it('notes a sentence that starts like the comment’s last sentence', () => {
    const [part] = CommentBank.parts(ctx, 'Her lab work was careful. Cece helped others.', { bank });
    expect(part.rows.every(r => r.repeats)).toBe(true);
    const [other] = CommentBank.parts(ctx, 'Cece helped others. She is kind.', { bank });
    expect(other.rows.some(r => r.repeats)).toBe(false);
  });

  it('never matches a sentence that is mostly slots', () => {
    const h01 = COMMENT_BANK.sentences.find(s => s.id === 'h01');
    expect(CommentBank.pattern(h01)).toBeNull();
    expect(CommentBank.usedBy(h01, ['Anything at all.', 'More.', 'Yes.'])).toBe(0);
  });
});

describe('Demo Mode (Science 8, Report 2)', () => {
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
  const ctxFor = first => {
    const st = getStudents(cid).find(s => s.firstName === first);
    return CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {});
  };

  it('offers Cece the 43 sentences the canvas shows (5, 22, 7, 9)', () => {
    const ctx = ctxFor('Cece');
    expect(CommentBank.parts(ctx, '').map(p => p.fit)).toEqual([5, 22, 7, 9]);
    expect(CommentBank.fitCount(ctx)).toBe(43);
  });

  it('offers Jasper the 38 the canvas shows (5, 19, 6, 8), by the name he goes by', () => {
    const ctx = ctxFor('Jasper');
    expect(CommentBank.parts(ctx, '').map(p => p.fit)).toEqual([5, 19, 6, 8]);
    expect(CommentBank.fitCount(ctx)).toBe(38);
    expect(ctx.name).toBe('Jas');
    expect(ctx.fellCount).toBe('four');
  });

  it('reads Completes Work from the record, and a pick overrides it', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(f.record).toEqual({ total: 22, handed: 22, late: 0, missing: 0 });
    expect(CommentBank.context(f, {})._habits).toEqual({ completes: 4 });
    expect(CommentBank.context(f, { habits: { completes: 2 } })._habits).toEqual({ completes: 2 });
  });

  it('keeps the private note out of the bank: never an observation, never the note slot', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(f.voice.private).toMatch(/grandma/);
    expect(f.obs.some(o => /grandma/.test(o.text))).toBe(false);
    const ctx = CommentBank.context(f, {});
    Object.keys(ctx)
      .filter(k => typeof ctx[k] === 'string')
      .forEach(k => expect(ctx[k], k).not.toMatch(/grandma/));
  });

  it('gives Cece every score this term per competency, with the canvas’s Start and Now', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const comps = CommentBank.facts(cid, st, 'term-2').comps;
    expect(comps.map(c => c.scores.length)).toEqual([13, 9, 16, 13, 10, 8]);
    expect(comps.map(c => levelFigure(c.start) + ' → ' + levelFigure(c.now))).toEqual([
      '2.9 → 2.9',
      '3.2 → 3.0',
      '3.1 → 3.2',
      '3.1 → 2.9',
      '3.1 → 2.9',
      '3.1 → 3.3',
    ]);
  });

  it('offers the attendance sentences once totals are entered', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    saveTermAttendance(cid, st.id, 'term-2', 4, 2);
    const ctx = CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {});
    const habits = CommentBank.parts(ctx, '')[0];
    expect(habits.fit).toBe(7);
    saveTermAttendance(cid, st.id, 'term-2', null, null);
  });
});
