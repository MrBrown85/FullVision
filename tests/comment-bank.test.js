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
    gradeLetter: 'a B',
    gradeStanding: 'very good',
    gradeNext: 'an A',
    gradeWord: 'a Proficient',
    strengths: 'Evaluating',
    growthAreas: 'Communicating',
    even: 'yes',
    rise: 'Evaluating',
    fall: 'Planning',
    focusLow: 'Evaluating',
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
  it('has 439 sentences in four parts, each with a unique id', () => {
    expect(COMMENT_BANK.sentences).toHaveLength(439);
    expect(COMMENT_BANK.parts.map(p => p.id)).toEqual(['habits', 'now', 'go', 'how']);
    expect(new Set(COMMENT_BANK.sentences.map(s => s.id)).size).toBe(439);
  });

  it('has wording for every kind of class, and keeps handed-in work out of PE and Arts', () => {
    const fams = ['pe', 'arts', 'math', 'adst', 'ela', 'socials', 'science', 'career'];
    fams.forEach(f => {
      const mine = COMMENT_BANK.sentences.filter(s => s.subjects && s.subjects.indexOf(f) >= 0);
      expect(mine.length, f).toBeGreaterThanOrEqual(6);
      ['Emerging', 'Developing', 'Proficient'].forEach(w =>
        expect(
          mine.some(s => s.when && s.when.standing === w),
          f + ' ' + w,
        ).toBe(true),
      );
    });
    COMMENT_BANK.sentences
      .filter(s => s.part === 'habits' && /Completes Work/.test(s.group) && !s.subjects)
      .forEach(s => expect(s.except, s.id).toEqual(['pe', 'arts']));
    ['g104', 'g105', 'w112'].forEach(id =>
      expect(COMMENT_BANK.sentences.find(s => s.id === id).except).toEqual(['pe', 'career']),
    );
  });

  it('covers every habit at every level, and every picture with an opening and a closer', () => {
    const at = (key, lvl) => COMMENT_BANK.sentences.filter(s => s.when && s.when[key] === lvl);
    CommentBank.HABITS.forEach(h =>
      [1, 2, 3, 4].forEach(l => expect(at(h.key, l).length, h.key + ' ' + l).toBeGreaterThan(0)),
    );
    ['strong', 'steady', 'challenge', 'early'].forEach(pic => {
      expect(at('picture', pic).filter(s => s.group === 'Openings').length, pic).toBeGreaterThanOrEqual(3);
      expect(at('picture', pic).filter(s => s.group === 'Looking Ahead').length, pic).toBeGreaterThanOrEqual(2);
    });
    ['Emerging', 'Developing', 'Proficient', 'Extending'].forEach(w =>
      expect(at('standing', w).length, w).toBeGreaterThanOrEqual(3),
    );
  });

  it('keeps the old generator’s cut patterns out: no superlatives, no teacher’s feelings', () => {
    const banned =
      /outstanding|joy to have|pleased|proud|excellent|impressive|standout|shines|stay tuned|can't say enough/i;
    COMMENT_BANK.sentences.forEach(s => expect(s.text, s.id).not.toMatch(banned));
  });

  it('puts a [singular|plural] verb only right after a pronoun', () => {
    COMMENT_BANK.sentences.forEach(s => {
      const re = /\[[^\]]*\]/g;
      let m;
      while ((m = re.exec(s.text))) expect(s.text.slice(0, m.index), s.id).toMatch(/\{[Hh]e\} $/);
    });
  });

  it('says what every sentence claims, with claims the verifier can check', () => {
    COMMENT_BANK.sentences.forEach(s => {
      expect(Array.isArray(s.claims), s.id + ' has no claims').toBe(true);
      expect(new Set(s.claims).size, s.id).toBe(s.claims.length);
      s.claims.forEach(c => expect(typeof CommentBank.CLAIMS[c], s.id + ' ' + c).toBe('function'));
    });
  });

  it('claims what its slots and `when` say, and a no-claim sentence has neither', () => {
    const SLOT = {
      standing: 'grade',
      letterStanding: 'grade',
      gradeLetter: 'grade',
      gradeStanding: 'grade',
      gradeNext: 'grade',
      gradeWord: 'grade',
      evidence: 'grade',
      even: 'even',
      strengths: 'strength',
      growthAreas: 'growthArea',
      focusLow: 'growthArea',
      rise: 'improved',
      fall: 'slipped',
      fellCount: 'slipped',
      assignment: 'bestPiece',
      level: 'bestPiece',
      strongWorks: 'bestPiece',
      assignment2: 'weakPiece',
      level2: 'weakPiece',
      weakWorks: 'weakPiece',
      seeWork: 'focusWork',
      aboutWork: 'focusWork',
      focus: 'nextStep',
      nextStep: 'nextStep',
      strengthHabits: 'habits',
      growthHabits: 'habits',
      strengthHabitNames: 'habits',
      growthHabitNames: 'habits',
      absent: 'attendance',
      late: 'attendance',
      note: 'note',
      when: 'note',
      concernNote: 'note',
      concernWhen: 'note',
      selfGood: 'studentWords',
      selfHard: 'studentWords',
      selfStrong: 'studentWords',
      selfLow: 'studentWords',
      goal: 'studentWords',
      plan: 'studentWords',
    };
    COMMENT_BANK.sentences.forEach(s => {
      const slots = (s.text.match(/\{(\w+)\}/g) || []).map(x => x.slice(1, -1)).concat(s.needs || []);
      slots.forEach(k => {
        if (SLOT[k]) expect(s.claims, s.id + ' {' + k + '}').toContain(SLOT[k]);
        else expect(['name', 'course', 'He', 'he', 'him', 'His', 'his', 'himself'], s.id).toContain(k);
      });
      Object.keys(s.when || {}).forEach(k =>
        expect(s.claims, s.id + ' when ' + k).toContain(
          k === 'picture' ? 'picture' : k === 'standing' || k === 'grade' ? 'grade' : 'habits',
        ),
      );
      if (!s.claims.length) {
        expect(
          slots.filter(k => SLOT[k]),
          s.id,
        ).toEqual([]);
        expect(s.when, s.id).toBeUndefined();
      }
    });
  });

  it('names only habits and levels that exist', () => {
    const keys = CommentBank.HABITS.map(h => h.key);
    COMMENT_BANK.sentences.forEach(s => {
      Object.entries(s.when || {}).forEach(([k, v]) => {
        if (k === 'picture') expect(['strong', 'steady', 'challenge', 'early']).toContain(v);
        else if (k === 'standing') expect(['Emerging', 'Developing', 'Proficient', 'Extending']).toContain(v);
        else if (k === 'grade') expect(['letter', 'letterClose', 'cminus', 'cminusClose', 'proficiency']).toContain(v);
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

describe('work not handed in', () => {
  it('lists the titles oldest first and groups three or more sharing the words before a colon', () => {
    const dateOf = a => a.date;
    const list = [
      { title: 'Current Events: Week 3', date: '2026-10-15' },
      { title: 'Poster', date: '2026-09-20' },
      { title: 'Current Events: Week 1', date: '2026-10-01' },
      { title: 'Lab: Density', date: '2026-10-02' },
      { title: 'Current Events: Week 2', date: '2026-10-08' },
      { title: 'Lab: Heat', date: '2026-10-09' },
    ];
    expect(CommentBank.notHandedIn(list, dateOf)).toEqual({
      count: 6,
      titles: [
        'Poster',
        'Current Events: Week 1',
        'Lab: Density',
        'Current Events: Week 2',
        'Lab: Heat',
        'Current Events: Week 3',
      ],
      groups: [{ name: 'Current Events', count: 3 }],
    });
    expect(CommentBank.notHandedIn([], dateOf)).toEqual({ count: 0, titles: [], groups: [] });
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
  const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
  const ctxFor = first => {
    const st = getStudents(cid).find(s => s.firstName === first);
    return CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {});
  };

  it('knows the Demo class is Science from its name, and offers Cece 101 sentences (9, 47, 19, 26)', () => {
    expect(CommentBank.familyOf(cid)).toBe('science');
    const ctx = ctxFor('Cece');
    expect(ctx._family).toBe('science');
    expect(CommentBank.parts(ctx, '').map(p => p.fit)).toEqual([9, 47, 19, 26]);
    expect(CommentBank.fitCount(ctx)).toBe(101);
  });

  it('offers Jasper 88 (9, 40, 15, 24), by the name he goes by', () => {
    const ctx = ctxFor('Jasper');
    expect(CommentBank.parts(ctx, '').map(p => p.fit)).toEqual([9, 40, 15, 24]);
    expect(CommentBank.fitCount(ctx)).toBe(88);
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

  it('counts only work labelled Missing, whatever its due date', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const term = getAssessments(cid).filter(a => assessmentInActiveTerm(cid, a));
    const empty = Object.assign({}, term[0], { id: 'past-due-empty', title: 'Past Due', dueDate: '2026-01-05' });
    const savedWork = _cache.assessments[cid];
    const savedStatuses = _cache.statuses[cid];
    try {
      // An empty cell past its due date is not missing.
      _cache.assessments[cid] = savedWork.concat([empty]);
      clearProfCache();
      let f = CommentBank.facts(cid, st, 'term-2');
      expect(f.record.missing).toBe(0);
      expect(f.notHandedIn).toEqual({ count: 0, titles: [], groups: [] });
      // Labelled Missing counts, due date or not.
      _cache.statuses[cid] = Object.assign({}, savedStatuses, { [st.id + ':' + empty.id]: 'NS' });
      clearProfCache();
      f = CommentBank.facts(cid, st, 'term-2');
      expect(f.record.missing).toBe(1);
      expect(f.notHandedIn).toEqual({ count: 1, titles: ['Past Due'], groups: [] });
    } finally {
      _cache.assessments[cid] = savedWork;
      _cache.statuses[cid] = savedStatuses;
      clearProfCache();
    }
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
    // One point per piece of work; a rubric's criteria on the competency
    // average into it (tagScoresByAssessment).
    expect(comps.map(c => c.scores.length)).toEqual([13, 9, 16, 13, 9, 8]);
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
    const habits = CommentBank.parts(ctx, '', { more: { habits: true } })[0];
    expect(habits.fit).toBe(9 + 7);
    expect(habits.rows.filter(r => r.group === 'Attendance')).toHaveLength(7);
    saveTermAttendance(cid, st.id, 'term-2', null, null);
  });

  it('Generate drafts a comment from the bank: one sentence per step, every slot filled', () => {
    const ctx = ctxFor('Cece');
    const d = CommentBank.draft(ctx, { seed: 1 });
    const sentences = d.text.split(/(?<=[.!?”])\s+(?=[A-Z“])/);
    expect(sentences.length).toBeGreaterThanOrEqual(8);
    expect(d.text).not.toMatch(/[{}[\]]/);
    expect(d.text).toMatch(/^Cece /);
    expect(d.text).toMatch(/Science 8/);
    // Each chosen sentence fits and is in the bank once.
    expect(new Set(d.ids).size).toBe(d.ids.length);
    d.ids.forEach(id =>
      expect(
        CommentBank.fits(
          COMMENT_BANK.sentences.find(s => s.id === id),
          ctx,
        ),
      ).toBe(true),
    );
    // In the draft's order: opening, habits, now, go, how.
    const order = d.ids.map(id => COMMENT_BANK.sentences.find(s => s.id === id).part);
    const first = part => order.indexOf(part);
    expect(order[0]).toBe('now');
    expect(first('habits')).toBeLessThan(first('go'));
    expect(first('go')).toBeLessThan(first('how'));
  });

  it('the same seed gives the same draft; a new seed a different one; classmates get different openings', () => {
    const ctx = ctxFor('Cece');
    expect(CommentBank.draft(ctx, { seed: 7 }).text).toBe(CommentBank.draft(ctx, { seed: 7 }).text);
    expect(CommentBank.draft(ctx, { seed: 7 }).text).not.toBe(CommentBank.draft(ctx, { seed: 8 }).text);
    // The grade sentence leads both; the opening after it differs.
    const opening = d => d.sentences.find(x => byId(x.id).group === 'Openings').text;
    const mine = CommentBank.draft(ctx, { seed: 7 });
    const other = CommentBank.draft(ctx, { seed: 7, comments: [mine.text] });
    expect(other.sentences[0].text).toBe(mine.sentences[0].text);
    expect(opening(other)).not.toBe(opening(mine));
  });

  it('drafts for every Demo student: six or more sentences, nothing unfilled, no note quoted twice', () => {
    getStudents(cid).forEach(st => {
      const ctx = CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {});
      const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id) });
      expect(d.ids.length, st.firstName).toBeGreaterThanOrEqual(6);
      expect(d.text, st.firstName).not.toMatch(/[{}[\]]|  /);
      const quotes = d.text.match(/“[^”]+”/g) || [];
      expect(new Set(quotes).size, st.firstName).toBe(quotes.length);
      // The growing habits are said once.
      const growing = d.ids.filter(id => {
        const s = COMMENT_BANK.sentences.find(x => x.id === id);
        return (s.needs || []).some(k => k === 'growthHabits' || k === 'growthHabitNames');
      });
      expect(growing.length, st.firstName).toBeLessThanOrEqual(1);
    });
  });

  it('every Demo draft verifies unchanged, with where each sentence came from', () => {
    getStudents(cid).forEach(st => {
      const f = CommentBank.facts(cid, st, 'term-2');
      for (let seed = 1; seed <= 10; seed++) {
        const d = CommentBank.draft(CommentBank.context(f, {}), { seed });
        expect(
          d.sentences.map(x => x.id),
          st.firstName,
        ).toEqual(d.ids);
        expect(d.sentences.map(x => x.text).join(' ')).toBe(d.text);
        expect(d.provenance.map(p => p.sentenceId)).toEqual(d.ids);
        d.provenance.forEach(p => {
          if (p.claims.length) expect(p.factKeys.length, p.sentenceId).toBeGreaterThan(0);
          expect(typeof p.values, p.sentenceId).toBe('object');
        });
        const v = CommentBank.verify(d, f, {});
        expect(v.replaced, st.firstName + ' ' + seed).toEqual([]);
        expect(v.text).toBe(d.text);
        expect(v.provenance).toEqual(d.provenance);
      }
    });
  });

  it('names the facts behind a sentence: the work, the competency, the habit', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const f = CommentBank.facts(cid, st, 'term-2');
    const ctx = CommentBank.context(f, {});
    const top = f.work.slice().sort((a, b) => b.v - a.v || b.d.localeCompare(a.d))[0];
    const n31 = CommentBank.provenance(byId('n31'), ctx);
    expect(n31).toMatchObject({
      sentenceId: 'n31',
      claims: ['bestPiece'],
      factKeys: ['work:' + top.id],
      values: { assignment: top.title, level: ctx.level },
    });
    expect(CommentBank.provenance(byId('n20'), ctx).factKeys).toEqual(['comp:SC']);
    expect(CommentBank.provenance(byId('h03'), ctx).factKeys).toEqual(['habit:completes']);
    expect(CommentBank.provenance(byId('n04'), ctx).values['when.picture']).toBe('steady');
  });

  /* One sentence as a draft, to verify against changed facts. */
  const one = (id, ctx) => {
    const s = byId(id);
    return {
      text: CommentBank.fill(s, ctx),
      ids: [id],
      sentences: [{ id, part: s.part, text: CommentBank.fill(s, ctx) }],
      provenance: [CommentBank.provenance(s, ctx)],
    };
  };
  const cece = () =>
    CommentBank.facts(
      cid,
      getStudents(cid).find(s => s.firstName === 'Cece'),
      'term-2',
    );

  it('drops a best-piece sentence once that work is no longer the best (no no-claim sentence in its part)', () => {
    const f = cece();
    const ctx = CommentBank.context(f, {});
    const d = one('n31', ctx);
    const top = d.provenance[0].sources.assignment[0].slice(5);
    const lower = { ...f, work: f.work.map(w => (w.id === top ? { ...w, v: 1 } : w)) };
    const v = CommentBank.verify(d, lower, {});
    expect(v.replaced).toEqual([{ sentenceId: 'n31', failed: ['slots', 'bestPiece'], by: null }]);
    expect(v.text).toBe('');
    expect(v.provenance).toEqual([]);
  });

  it('puts the part’s no-claim sentence in place of a closer whose picture of the term is no longer true', () => {
    const f = cece();
    const ctx = CommentBank.context(f, {});
    expect(ctx.picture).toBe('steady');
    const d = one('w120', ctx);
    const harder = { ...f, comps: f.comps.map(c => ({ ...c, now: 1.6, level: 1.6 })) };
    const v = CommentBank.verify(d, harder, {});
    expect(v.replaced).toEqual([{ sentenceId: 'w120', failed: ['slots', 'picture'], by: 'w06' }]);
    expect(byId('w06').claims).toEqual([]);
    expect(v.ids).toEqual(['w06']);
    expect(v.text).toBe('Next term, the goal is to build on what is working and keep using feedback.');
    expect(v.provenance[0]).toMatchObject({ sentenceId: 'w06', claims: [], factKeys: [] });
  });

  it('checks a claim the wording makes beyond its slots: late work, work not handed in', () => {
    const f = cece();
    expect(f.record.late).toBe(0);
    const usually = { habits: { completes: 3 } };
    const late = one('h105', CommentBank.context(f, usually));
    expect(CommentBank.verify(late, f, usually).replaced[0]).toMatchObject({ failed: ['lateWork'], by: null });
    const withLate = { ...f, record: { ...f.record, late: 1 } };
    expect(CommentBank.verify(late, withLate, usually).replaced).toEqual([]);

    const rarely = { habits: { completes: 1 } };
    const missing = one('h108', CommentBank.context(f, rarely));
    expect(CommentBank.verify(missing, f, rarely).replaced[0].failed).toEqual(['notHandedIn']);
    expect(f.notHandedIn.count).toBe(0);
    expect(
      CommentBank.verify(missing, { ...f, notHandedIn: { count: 1, titles: ['Lab 3'] } }, rarely).replaced,
    ).toEqual([]);
  });

  it('catches “it is the best work this term” on a piece that is only best in the Focus Area', () => {
    const caught = [];
    getStudents(cid).forEach(st => {
      const f = CommentBank.facts(cid, st, 'term-2');
      const ctx = CommentBank.context(f, {});
      if (!CommentBank.fits(byId('w101'), ctx)) return;
      const v = CommentBank.verify(one('w101', ctx), f, {});
      const best = Math.max(...f.work.map(w => Math.round(w.v * 10)));
      const see = f.work.find(w => w.title === ctx.seeWork);
      expect(v.replaced.length > 0, st.firstName).toBe(!see || Math.round(see.v * 10) < best);
      if (v.replaced.length) caught.push(v.replaced[0]);
    });
    expect(caught.length).toBeGreaterThan(0);
    caught.forEach(r => {
      expect(r.failed).toEqual(['bestPiece']);
      expect(byId(r.by)).toMatchObject({ part: 'how', claims: [] });
    });
  });

  it('re-checks the letter grade against the facts', () => {
    const f = { ...cece(), letter: 'a B (78%)' };
    const d = one('n14', CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    expect(CommentBank.verify(d, { ...f, letter: 'a C+ (68%)' }, {}).replaced[0].failed).toEqual(['slots', 'grade']);
  });

  it('never passes a sentence with no fact behind it, or one with no claims field', () => {
    const f = cece();
    const ctx = CommentBank.context(f, {});
    expect(CommentBank.verify(one('h59', ctx), f, {}).replaced[0].failed).toEqual(['support']);
    const bare = { ...byId('w129') };
    delete bare.claims;
    const bank = { parts: COMMENT_BANK.parts, sentences: [bare] };
    expect(CommentBank.verify(one('w129', ctx), f, {}, { bank }).replaced[0].failed).toEqual(['claims']);
  });

  it('never calls a rising Focus Area the area to build', () => {
    // Cece's Focus Area is Scientific Communication (the biggest change, upward).
    const ctx = ctxFor('Cece');
    expect(ctx.focus).toBe('Scientific Communication');
    expect(ctx.focusLow).toBe('');
    const texts = CommentBank.parts(ctx, '', { more: { go: true } })[2].rows.map(r => r.text);
    expect(texts.some(t => /Scientific Communication is the area to build next/.test(t))).toBe(false);
  });
});

describe('competency names in an imported class', () => {
  it('names each competency by its own label, as the report does, not by its category', async () => {
    window._CURRICULUM_DATA = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
    await loadCurriculumIndex();
    const cid = 'course-ss8';
    const map = buildLearningMapFromTags(['SS8']);
    COURSES[cid] = { id: cid, name: 'Socials 8', gradingSystem: 'proficiency' };
    const st = { id: 'stu-p', firstName: 'Priya', lastName: 'Kaur', pronouns: 'she/her' };
    _cache.students[cid] = [st];
    _cache.learningMaps[cid] = map;
    _cache.categories[cid] = [];
    _cache.assessments[cid] = map.sections.slice(0, 3).map((sec, i) => ({
      id: 'a' + i,
      title: 'Task ' + i,
      scoreMode: 'proficiency',
      tagIds: [sec.tags[0].id],
      type: 'summative',
      date: '2026-09-1' + i,
    }));
    _cache.scores[cid] = {
      'stu-p': _cache.assessments[cid].map(a => ({ assessmentId: a.id, tagId: a.tagIds[0], score: 3, date: a.date })),
    };
    _cache.statuses[cid] = {};
    _cache.overrides[cid] = {};
    _cache.courseConfigs[cid] = {};
    _cache.observations[cid] = {};
    _cache.reflections[cid] = {};
    _cache.termRatings[cid] = {};
    clearProfCache();
    const names = CommentBank.facts(cid, st, 'term-1').comps.map(c => c.name);
    expect(names).toEqual(['Critical Thinking', 'Interpret Graphics', 'Cite Sources']);
    expect(names).toEqual(ReportBlocks.reportSections(cid).slice(0, 3).map(ReportBlocks.competencyLabel));
    expect(names).not.toContain('Use Social Studies inquiry processes and skills');
    delete COURSES[cid];
  });
});

describe('wording by kind of class', () => {
  it('offers a sentence to its subjects only, and an except sentence to every other kind', () => {
    const pe = { id: 'x', text: 'x', subjects: ['pe'] };
    const notPe = { id: 'y', text: 'y', except: ['pe', 'career'] };
    const any = { id: 'z', text: 'z' };
    expect(CommentBank.forFamily(pe, 'pe')).toBe(true);
    expect(CommentBank.forFamily(pe, 'math')).toBe(false);
    expect(CommentBank.forFamily(pe, '')).toBe(false);
    expect(CommentBank.forFamily(notPe, 'pe')).toBe(false);
    expect(CommentBank.forFamily(notPe, 'career')).toBe(false);
    expect(CommentBank.forFamily(notPe, 'math')).toBe(true);
    expect(CommentBank.forFamily(notPe, '')).toBe(true);
    expect(CommentBank.forFamily(any, 'pe')).toBe(true);
  });

  it('reads the kind of class from the imported subject, its tag, or the class name', () => {
    const cid = 'course-kind';
    const withMap = (map, name) => {
      COURSES[cid] = { id: cid, name };
      _cache.learningMaps[cid] = map;
      return CommentBank.familyOf(cid);
    };
    expect(
      withMap(
        { subjects: [{ id: 'PHE8', name: 'PE 8', family: 'Physical and Health Education' }], sections: [] },
        'Block C',
      ),
    ).toBe('pe');
    expect(withMap({ subjects: [{ id: 'DRAMA10', name: 'Drama 10' }], sections: [] }, 'Block C')).toBe('arts');
    expect(withMap({ subjects: [{ id: 'FOM11', name: 'Foundations 11' }], sections: [] }, 'Block C')).toBe('math');
    expect(withMap({ subjects: [], sections: [] }, 'Foods 9')).toBe('adst');
    expect(withMap({ subjects: [], sections: [] }, 'Socials 10')).toBe('socials');
    expect(withMap({ subjects: [], sections: [] }, 'Block D')).toBe('');
    delete COURSES[cid];
    delete _cache.learningMaps[cid];
  });

  it('drafts for every kind of class without handed-in or area-to-build wording where it does not belong', async () => {
    window._CURRICULUM_DATA = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
    await loadCurriculumIndex();
    const cases = [
      ['PHE8', 'pe'],
      ['DRAMA10', 'arts'],
      ['MATH8', 'math'],
      ['FS10', 'adst'],
      ['ELA10', 'ela'],
      ['SS8', 'socials'],
      ['SCI10', 'science'],
      ['CLE10', 'career'],
    ];
    cases.forEach(([tag, fam]) => {
      const cid = 'course-' + tag;
      const map = buildLearningMapFromTags([tag]);
      COURSES[cid] = { id: cid, name: tag, gradingSystem: 'proficiency' };
      const st = { id: 'stu-k', firstName: 'Priya', lastName: 'Kaur', pronouns: 'she/her' };
      _cache.students[cid] = [st];
      _cache.learningMaps[cid] = map;
      _cache.categories[cid] = [];
      const secs = map.sections.slice(0, 4);
      _cache.assessments[cid] = secs.map((sec, i) => ({
        id: 'a' + i,
        title: 'Unit ' + (i + 1),
        scoreMode: 'proficiency',
        tagIds: [sec.tags[0].id],
        type: 'summative',
        date: '2026-09-1' + i,
      }));
      _cache.scores[cid] = {
        'stu-k': _cache.assessments[cid].map((a, i) => ({
          assessmentId: a.id,
          tagId: a.tagIds[0],
          score: [3, 2, 4, 3][i],
          date: a.date,
        })),
      };
      _cache.statuses[cid] = {};
      _cache.overrides[cid] = {};
      _cache.courseConfigs[cid] = {};
      _cache.observations[cid] = {};
      _cache.reflections[cid] = {};
      _cache.termRatings[cid] = { 'stu-k': { 'term-1': { habits: { completes: 2, ready: 3, part: 2, devices: 2 } } } };
      clearProfCache();
      const f = CommentBank.facts(cid, st, 'term-1');
      expect(f.family, tag).toBe(fam);
      const ctx = CommentBank.context(f, {});
      const d = CommentBank.draft(ctx, { seed: 5 });
      expect(CommentBank.verify(d, f, {}).replaced, tag).toEqual([]);
      expect(d.ids.length, tag).toBeGreaterThanOrEqual(6);
      expect(d.text, tag).not.toMatch(/[{}[\]]/);
      if (fam === 'pe' || fam === 'arts') expect(d.text, tag).not.toMatch(/hands? in|handing in/i);
      if (fam === 'pe' || fam === 'career')
        expect(d.text, tag).not.toMatch(/area to build|room to grow in|targeted practice in/i);
      delete COURSES[cid];
    });
  });
});
