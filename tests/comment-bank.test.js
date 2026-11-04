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
    gradeWord: 'Proficient',
    missingWork: 'Fifteen assignments are not handed in, including six Current Events assignments.',
    markedMine: 'four',
    markedClass: '28',
    ieDeadline: 'December 18',
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
    whose: p.poss,
    habitsExcellent: 'yes',
    habitsGood: 'yes',
    habitsAllSeen: 'yes',
    habitToBuild: 'taking part in class',
    habitsToBuild: 'using feedback and taking part in class',
    habitStrengths: 'Noor comes to class ready.',
    absent: '4',
    attendance: 'missed four classes and been late twice',
    late: '2',
    absentClasses: 'four classes',
    lateTimes: 'twice',
    absentOnly: 'yes',
    lateOnly: 'yes',
    strongHabits: 'comes to class ready',
    missingTitle: '“Energy Lab”',
    missingTitles: '“Energy Lab” and “Poster”',
    missingMany: 'yes',
    missingGroup: 'six Current Events assignments',
    bestPiece: 'Her best piece was “Energy Lab”, where she measured every trial.',
  };
}

describe('the bank', () => {
  it('has 1702 sentences in four parts, each with a unique id', () => {
    expect(COMMENT_BANK.sentences).toHaveLength(1702);
    expect(COMMENT_BANK.parts.map(p => p.id)).toEqual(['habits', 'now', 'go', 'how']);
    expect(new Set(COMMENT_BANK.sentences.map(s => s.id)).size).toBe(1702);
  });

  it('has wording for every kind of class, and keeps handed-in work out of PE and Arts', () => {
    const fams = ['pe', 'arts', 'math', 'adst', 'ela', 'socials', 'science', 'career'];
    fams.forEach(f => {
      const mine = COMMENT_BANK.sentences.filter(s => s.subjects && s.subjects.indexOf(f) >= 0);
      expect(mine.length, f).toBeGreaterThanOrEqual(6);
    });
    // The habits sentences name a habit only through habitWords, which says
    // Completes Work in PE and Arts their own way. The Not Handed In frames
    // repeat the plan's own "not handed in" (Sentence grammar), as the
    // engine-built m01 prints it for every kind of class.
    COMMENT_BANK.sentences
      .filter(s => s.part === 'habits' && s.group !== 'Not Handed In')
      .forEach(s => expect(s.text, s.id).not.toMatch(/hand/i));
    COMMENT_BANK.sentences
      .filter(s => s.group === 'Not Handed In')
      .forEach(s => expect(s.text.replace(/not handed in/g, ''), s.id).not.toMatch(/hand/i));
  });

  it('holds only the plan’s parts: no openings, growth, student’s words, even results, revisits or looking ahead', () => {
    const at = (key, lvl) => COMMENT_BANK.sentences.filter(s => s.when && s.when[key] === lvl);
    const gone = ['Openings', 'Growth This Term', "In the Student's Words", 'Looking Ahead', 'Work to Revisit'];
    COMMENT_BANK.sentences.forEach(s => expect(gone, s.id).not.toContain(s.group));
    // The best piece: the plan's sentence n36, and the frames around the
    // same title and note (bank expansion, Nov 1), each claiming it.
    const examples = COMMENT_BANK.sentences.filter(s => s.group === 'Examples From Work');
    expect(examples.map(s => s.id)).toContain('n36');
    examples.forEach(s => {
      expect(s.claims, s.id).toEqual(['bestPiece']);
      expect(s.needs, s.id).toContain(s.id === 'n36' ? 'bestPiece' : 'assignment');
    });
    expect(
      COMMENT_BANK.sentences.some(s =>
        /\{(assignment2|level2|strongWorks|weakWorks|even|rise|fall|fellCount|selfGood|selfHard|selfStrong|selfLow|goal|plan|picture)\}/.test(
          s.text,
        ),
      ),
    ).toBe(false);
    COMMENT_BANK.sentences.forEach(s =>
      expect((s.needs || []).concat(Object.keys(s.when || {})), s.id).not.toContain('even'),
    );
    expect(at('picture', 'steady')).toEqual([]);
    // Every strengths sentence prints the skill after "can", never "in {strengths}".
    COMMENT_BANK.sentences
      .filter(s => /\{strengths?\}/.test(s.text))
      .forEach(s => expect(s.text, s.id).toMatch(/\bcan \{strengths?\}/));
    // The standing word is said once, by the grade sentence (DRAFT_STEPS
    // `says`), so no Overall sentence conditions on it: the 44 that did
    // (n114-n125, n201-n239, n300) could never be offered and were cut
    // (2026-11-01). Only the grade frames for one proficiency word
    // (gr39-gr78, round two) condition on it.
    ['Emerging', 'Developing', 'Proficient', 'Extending'].forEach(w =>
      expect(
        at('standing', w).filter(s => s.group !== 'Grade'),
        w,
      ).toEqual([]),
    );
    ['Emerging', 'Developing', 'Proficient', 'Extending'].forEach(w =>
      expect(at('standing', w).filter(s => s.group === 'Grade').length, w).toBe(10),
    );
  });

  it('keeps the old generator’s cut patterns out: no superlatives, no teacher’s feelings', () => {
    const banned =
      /outstanding|joy to have|pleased|proud|excellent|impressive|standout|shines|stay tuned|can't say enough/i;
    // "Work habits are excellent" is the plan's own habits sentence.
    COMMENT_BANK.sentences.forEach(s =>
      expect(s.text.replace(/work habits are excellent/, ''), s.id).not.toMatch(banned),
    );
  });

  it('puts a [singular|plural] verb only after the student as subject, which it agrees with', () => {
    COMMENT_BANK.sentences.forEach(s => {
      const re = /\[[^\]]*\]/g;
      let m;
      while ((m = re.exec(s.text))) expect(s.text.slice(0, m.index), s.id).toMatch(/\{[Hh]e\}/);
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
      missingWork: 'notHandedIn',
      markedMine: 'marks',
      markedClass: 'marks',
      ieDeadline: 'deadline',
      evidence: 'grade',
      even: 'even',
      strengths: 'strength',
      strength: 'strength',
      growthAreas: 'growthArea',
      focusLow: 'growthArea',
      rise: 'improved',
      fall: 'slipped',
      fellCount: 'slipped',
      assignment: 'bestPiece',
      level: 'bestPiece',
      strongWorks: 'bestPiece',
      bestPiece: 'bestPiece',
      bestNote: 'bestPiece',
      // The story slots (bank expansion, Nov 1): needed, never printed.
      climb: 'improved',
      split: 'split',
      hidden: 'strength',
      newcomer: 'newcomer',
      assignment2: 'weakPiece',
      level2: 'weakPiece',
      weakWorks: 'weakPiece',
      seeWork: 'focusWork',
      aboutWork: 'focusWork',
      focus: 'nextStep',
      nextStep: 'nextStep',
      nextSkill: 'nextStep',
      levelStep: 'nextStep',
      // The strongest skill's key and the even-results slots (round two, lane
      // G): needed, the skill printed, the word only where the class shows it.
      strongSkill: 'strength',
      topSkill: 'strength',
      evenResults: 'evenResults',
      evenSkill: 'evenResults',
      evenWord: 'evenResults',
      // The highest-marked skill (strengths for a staircase, Nov 2).
      highestSkill: 'strength',
      highestTop: 'strength',
      // The first strength at its level now (Nov 2).
      strengthNow: 'strength',
      // Progress in levels over the term (Nov 2).
      progressFrom: 'improved',
      progressTo: 'improved',
      progressSkill: 'improved',
      habitsExcellent: 'habits',
      habitsGood: 'habits',
      habitsAllSeen: 'habits',
      habitToBuild: 'habits',
      habitsToBuild: 'habits',
      habitStrengths: 'habits',
      strongHabits: 'habits',
      absent: 'attendance',
      attendance: 'attendance',
      late: 'attendance',
      absentClasses: 'attendance',
      lateTimes: 'attendance',
      absentOnly: 'attendance',
      lateOnly: 'attendance',
      missingTitle: 'notHandedIn',
      missingTitles: 'notHandedIn',
      missingMany: 'notHandedIn',
      missingGroup: 'notHandedIn',
      missingCount: 'notHandedIn',
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
        else expect(['name', 'whose', 'course', 'He', 'he', 'him', 'His', 'his', 'himself'], s.id).toContain(k);
      });
      Object.keys(s.when || {}).forEach(k =>
        expect(s.claims, s.id + ' when ' + k).toContain(
          k === 'picture'
            ? 'picture'
            : k === 'standing' || k === 'grade'
              ? 'grade'
              : k === 'path'
                ? 'ie'
                : k === 'ieProblem'
                  ? { missing: 'notHandedIn', marks: 'marks', noMarks: 'marks', low: 'lowMarks' }[s.when[k]]
                  : k === 'nextSkill'
                    ? 'nextStep'
                    : k === 'strongSkill' ||
                        k === 'topSkill' ||
                        k === 'highestSkill' ||
                        k === 'highestWord' ||
                        k === 'strengthWord'
                      ? 'strength'
                      : k === 'evenWord'
                        ? 'evenResults'
                        : 'habits',
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

  it('names only habits, levels and skills that exist', () => {
    const keys = CommentBank.HABITS.map(h => h.key);
    COMMENT_BANK.sentences.forEach(s => {
      Object.entries(s.when || {}).forEach(([k, v]) => {
        if (k === 'picture') expect(['strong', 'steady', 'challenge', 'early']).toContain(v);
        else if (k === 'standing') expect(['Emerging', 'Developing', 'Proficient', 'Extending']).toContain(v);
        else if (k === 'grade')
          expect([
            'letter',
            'letterClose',
            'cminus',
            'cminusClose',
            'proficiency',
            'ie',
            'languageGoals',
            'iepGoals',
          ]).toContain(v);
        else if (k === 'path') expect(v).toBe('ie');
        else if (k === 'ieProblem') expect(['missing', 'marks', 'noMarks', 'low']).toContain(v);
        else if (k === 'nextSkill') {
          // A sentence for one skill: the key is in the table for its one
          // kind of class. A Next Step frame needs the slot verify() checks;
          // a For the Family sentence helps with the skill without naming it.
          expect(s.subjects, s.id).toHaveLength(1);
          expect(
            (CommentBank.SKILLS[s.subjects[0]] || []).map(r => r.key),
            s.id,
          ).toContain(v);
          if (s.group !== 'For the Family') expect(s.needs, s.id).toContain('nextSkill');
        } else if (k === 'strongSkill' || k === 'topSkill') {
          // A strengths frame for one skill (the strongest, or a strength
          // among a tie at the top): the key is in the table for its one
          // kind of class, and it needs the slot verify() checks.
          expect(s.subjects, s.id).toHaveLength(1);
          expect(
            (CommentBank.SKILLS[s.subjects[0]] || []).map(r => r.key),
            s.id,
          ).toContain(v);
          expect(s.needs, s.id).toContain(k);
        } else if (k === 'evenWord') {
          expect(['Emerging', 'Developing', 'Proficient', 'Extending']).toContain(v);
          expect(s.claims, s.id).toContain('evenResults');
        } else if (k === 'highestWord') {
          // The student's own highest-marked skill, at its proficiency word:
          // the frame needs the skill verify() checks.
          expect(['Emerging', 'Developing', 'Proficient', 'Extending']).toContain(v);
          expect(s.needs, s.id).toContain('highestSkill');
        } else if (k === 'strengthWord') {
          // The first strength at its level now: the frame needs the phrase
          // verify() checks.
          expect(['Emerging', 'Developing', 'Proficient', 'Extending']).toContain(v);
          expect(s.needs, s.id).toContain('strengthNow');
        } else {
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

  it('conjugates for singular they', () => {
    const ie04 = COMMENT_BANK.sentences.find(s => s.id === 'ie04');
    expect(CommentBank.fill(ie04, fullContext(P.they))).toBe('To earn a grade, they need to submit the missing work.');
    expect(CommentBank.fill(ie04, fullContext(P.she))).toBe('To earn a grade, she needs to submit the missing work.');
  });

  it('puts a habit phrase in as the context gives it', () => {
    const hs08 = COMMENT_BANK.sentences.find(s => s.id === 'hs08');
    expect(CommentBank.fill(hs08, fullContext(P.he))).toBe(
      'His work habits to build are using feedback and taking part in class.',
    );
  });
});

describe('fill takes values as written', () => {
  it('never reads a slot or a verb choice inside a value', () => {
    const quoted = {
      id: 'x-quote',
      part: 'now',
      group: 'Overall',
      text: 'In {his} own words, {he} [is|are] good at this: {selfGood}',
    };
    const ctx = { ...fullContext(P.she), selfGood: '“I like [math|science] and {name} games.”' };
    expect(CommentBank.fill(quoted, ctx)).toBe(
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
      habits: { completes: 2, feedback: 4 },
      levelText: () => '',
    };
    expect(CommentBank.context({ ...f, family: 'arts' }, {}).habitToBuild).toBe('completing her work');
    expect(CommentBank.context({ ...f, family: 'pe' }, {}).habitToBuild).toBe('taking a full part in every activity');
    expect(CommentBank.context(f, {}).habitToBuild).toBe('completing work on time');
    const strong = { ...f, family: 'arts', pronounsOnFile: true, habits: { completes: 4, feedback: 4 } };
    expect(CommentBank.context(strong, {}).habitStrengths).toBe('She completes her work and uses feedback.');
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
    const n36 = COMMENT_BANK.sentences.find(s => s.id === 'n36');
    expect(CommentBank.fits(n36, ctx)).toBe(true);
    expect(CommentBank.fits(n36, { ...ctx, bestPiece: '' })).toBe(false);
    const h60 = COMMENT_BANK.sentences.find(s => s.id === 'h60');
    expect(CommentBank.fits(h60, { ...ctx, attendance: '' })).toBe(false);
  });

  it('filters by habit level with `when`', () => {
    const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
    const at = (when, id) => ({ id, part: 'how', group: 'At Home', text: 'Help {name}.', when, claims: ['habits'] });
    const sometimes = at({ completes: 2 }, 'x1');
    const rarely = at({ completes: 1 }, 'x2');
    const both = at({ completes: 2, part: 1 }, 'x3');
    const ctx = fullContext(P.she, { completes: 2, part: 1 });
    expect(CommentBank.fits(sometimes, ctx)).toBe(true);
    expect(CommentBank.fits(rarely, ctx)).toBe(false);
    expect(CommentBank.fits(both, ctx)).toBe(true);
    const notSeen = fullContext(P.she, { completes: 5 });
    expect([sometimes, rarely].some(x => CommentBank.fits(x, notSeen))).toBe(false);
    const steady = { ...at({ picture: 'steady' }, 'x4'), claims: ['picture'] };
    expect(CommentBank.fits(steady, ctx)).toBe(true);
    expect(CommentBank.fits(steady, { ...ctx, picture: 'strong' })).toBe(false);
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
    const hs11 = COMMENT_BANK.sentences.find(s => s.id === 'hs11');
    expect(CommentBank.pattern(hs11)).toBeNull();
    expect(CommentBank.usedBy(hs11, ['Anything at all.', 'More.', 'Yes.'])).toBe(0);
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

  // The habits part: Completes Work from the record is the one strong
  // habit, so the four Strong Habits frames (hs11, hs13-hs15) fit, and the
  // five Habit Ratings frames for Completes Work at Consistently.
  it('knows the Demo class is Science from its name, and offers Cece 78 sentences (9, 40, 4, 25)', () => {
    expect(CommentBank.familyOf(cid)).toBe('science');
    const ctx = ctxFor('Cece');
    expect(ctx._family).toBe('science');
    expect(CommentBank.parts(ctx, '').map(p => p.fit)).toEqual([9, 40, 4, 25]);
    expect(CommentBank.fitCount(ctx)).toBe(78);
  });

  it('offers Jasper 79 (9, 40, 5, 25), by the name he goes by', () => {
    const ctx = ctxFor('Jasper');
    // Overall: every competency is Proficient as the report grades it
    // (2.9 to 3.3), so the even-results frames fit (Nov 3).
    expect(CommentBank.parts(ctx, '').map(p => p.fit)).toEqual([9, 40, 5, 25]);
    expect(CommentBank.fitCount(ctx)).toBe(79);
    expect(ctx.name).toBe('Jas');
    expect(ctx.fellCount).toBe('four');
  });

  it('reads Completes Work from the record, and a pick overrides it', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const f = CommentBank.facts(cid, st, 'term-2');
    // The record is the year to date as of Report 2's end (Colin, 2026-11-03).
    expect(f.record).toEqual({ total: 37, handed: 37, late: 0, missing: 0 });
    expect(CommentBank.context(f, {})._habits).toEqual({ completes: 4 });
    expect(CommentBank.context(f, { habits: { completes: 2 } })._habits).toEqual({ completes: 2 });
  });

  it('counts only work labelled Missing, whatever its due date', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const term = getAssessments(cid).filter(a => assessmentInYearToDate(cid, a));
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

  it('keeps the private note out of the bank: no observations read, never the note slot', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(f.voice.private).toMatch(/grandma/);
    expect(f.obs).toBeUndefined();
    const ctx = CommentBank.context(f, {});
    Object.keys(ctx)
      .filter(k => typeof ctx[k] === 'string')
      .forEach(k => expect(ctx[k], k).not.toMatch(/grandma/));
  });

  it('gives Cece every score in the year to date per competency, with the term’s Start and Now', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const comps = CommentBank.facts(cid, st, 'term-2').comps;
    // One point per piece of work, the competency's mark on it as the
    // gradebook shows it (tagMarksByAssessment): every piece up to Report
    // 2's end (scores), and the ones dated in Term 2 (termScores). Start
    // and Now are this term's trend, on the level's footing, each rubric
    // criterion its own score (getTagScores).
    expect(comps.map(c => c.scores.length)).toEqual([19, 13, 27, 20, 15, 16]);
    expect(comps.map(c => c.termScores.length)).toEqual([13, 9, 16, 13, 9, 8]);
    expect(comps.map(c => levelFigure(c.start) + ' → ' + levelFigure(c.now))).toEqual([
      '2.9 → 2.9',
      '3.2 → 2.9',
      '3.1 → 3.2',
      '3.1 → 2.9',
      '3.1 → 2.9',
      '3.1 → 3.3',
    ]);
  });

  it('offers the attendance sentences once totals are entered', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    // Report 1's totals too, so this term's share is known.
    saveTermAttendance(cid, st.id, 'term-1', 0, 0);
    saveTermAttendance(cid, st.id, 'term-2', 4, 2);
    const ctx = CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {});
    const habits = CommentBank.parts(ctx, '', { more: { habits: true } })[0];
    expect(habits.fit).toBe(4 + 6 + 5);
    // The attendance frames for both counts (plan, Sentence grammar: both
    // halves said, the exact counts): h60 and the five both-count frames.
    const att = habits.rows.filter(r => r.group === 'Attendance');
    expect(att).toHaveLength(6);
    expect(att.map(r => r.text)).toContain('She has missed four classes and been late twice this term.');
    att.forEach(r => {
      expect(r.text).toMatch(/four classes/);
      expect(r.text).toMatch(/twice/);
    });
    saveTermAttendance(cid, st.id, 'term-1', null, null);
    saveTermAttendance(cid, st.id, 'term-2', null, null);
  });

  it('Generate drafts a comment from the bank: one sentence per step, every slot filled', () => {
    const st = getStudents(cid).find(s => s.firstName === 'Cece');
    const rated = { completes: 4, ready: 3, others: 4, part: 2, feedback: 4, devices: 3 };
    const ctx = CommentBank.context(CommentBank.facts(cid, st, 'term-2'), { habits: rated });
    const d = CommentBank.draft(ctx, { seed: 1 });
    expect(d.sentences.filter(x => x.step === 'habits').map(x => x.text)).toEqual([
      // Takes Part is the one habit rated below Usually: the summary frame
      // or a Habit Ratings frame for it names it.
      expect.stringMatching(/tak(e|es|ing) part|discussion|question/i),
    ]);
    const sentences = d.text.split(/(?<=[.!?”])\s+(?=[A-Z“])/);
    // The Demo class has no closing sentence or support lines set, so the
    // comment leaves those out (plan PR 8): the grade, the best piece, the
    // habits, the strengths (Cece's results are even: evenComps), the next
    // step and the family sentence; six, so not flagged short, never padded.
    expect(sentences.length).toBe(6);
    expect(d.sentences.some(x => x.step === 'overall')).toBe(true);
    expect(d.short).toBe(false);
    expect(d.text).not.toMatch(/[{}[\]]/);
    expect(d.sentences[0].text).toContain('Cece');
    // The course is named wherever the story opens with it.
    if (d.sentences.some(x => x.step === 'opening')) expect(d.text).toMatch(/Science 8/);
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
    const texts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => CommentBank.draft(ctx, { seed }).text));
    expect(texts.size).toBeGreaterThanOrEqual(2);
    // The grade sentence leads both, in another of its frames once a
    // classmate has this one (bank expansion, Nov 1); the family sentence,
    // which has 18 to choose from, differs once a classmate has it.
    const mine = CommentBank.draft(ctx, { seed: 7 });
    const other = CommentBank.draft(ctx, { seed: 7, comments: [mine.text] });
    expect([mine.sentences[0].step, other.sentences[0].step]).toEqual(['grade', 'grade']);
    expect(other.sentences[0].text).not.toBe(mine.sentences[0].text);
    expect(other.sentences[0].text).toContain('Proficient');
    const at = mine.sentences.findIndex(x => x.step === 'home');
    expect(at).toBeGreaterThan(0);
    expect(other.sentences[at].step).toBe(mine.sentences[at].step);
    expect(other.sentences[at].text).not.toBe(mine.sentences[at].text);
  });

  it('drafts for every Demo student: four or more sentences, nothing unfilled, nothing quoted twice', () => {
    getStudents(cid).forEach(st => {
      const ctx = CommentBank.context(CommentBank.facts(cid, st, 'term-2'), {});
      const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id) });
      // The Demo class has no closing sentence or support lines (plan PR 8).
      // Titles are quoted (the realiser), so a piece already named is never
      // named again: Liv's revisit sentence would repeat one, and is left out.
      expect(d.ids.length, st.firstName).toBeGreaterThanOrEqual(4);
      expect(d.text, st.firstName).not.toMatch(/[{}[\]]|  /);
      const quotes = d.text.match(/“[^”]+”/g) || [];
      expect(new Set(quotes).size, st.firstName).toBe(quotes.length);
      // The habits are said once, in one sentence.
      const habits = d.ids.filter(id => /^hs/.test(id));
      expect(habits.length, st.firstName).toBeLessThanOrEqual(1);
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
    const n36 = CommentBank.provenance(byId('n36'), ctx);
    expect(n36).toMatchObject({
      sentenceId: 'n36',
      claims: ['bestPiece'],
      factKeys: ['work:' + top.id],
      values: { bestPiece: ctx.bestPiece },
    });
    expect(ctx.bestPiece).toContain('“' + top.title);
    // Cece has no competency past the "improved" gate; Mateo's Scientific
    // Communication is.
    expect(ctx.rise).toBe('');
    const mateo = getStudents(cid).find(s => s.firstName === 'Mateo');
    const mctx = CommentBank.context(CommentBank.facts(cid, mateo, 'term-2'), {});
    const rose = {
      id: 'x-rose',
      part: 'now',
      group: 'Overall',
      text: 'This term {he} [has|have] grown most in {rise}.',
      needs: ['rise'],
      claims: ['improved'],
    };
    expect(CommentBank.provenance(rose, mctx).factKeys).toEqual(['comp:SC']);
    // Only Completes Work is rated (from the record): the IE strengths name it.
    expect(CommentBank.provenance(byId('hs11'), ctx).factKeys).toEqual(['habit:completes']);
    const steady = {
      id: 'x-steady',
      part: 'now',
      group: 'Overall',
      text: 'A steady term.',
      when: { picture: 'steady' },
      claims: ['picture'],
    };
    expect(CommentBank.provenance(steady, ctx).values['when.picture']).toBe('steady');
  });

  /* One sentence as a draft, to verify against changed facts. */
  const one = (idOrSentence, ctx) => {
    const s = typeof idOrSentence === 'string' ? byId(idOrSentence) : idOrSentence;
    const id = s.id;
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
    const d = one('n36', ctx);
    const top = d.provenance[0].sources.bestPiece[0].slice(5);
    const lower = { ...f, work: f.work.map(w => (w.id === top ? { ...w, v: 1 } : w)) };
    const v = CommentBank.verify(d, lower, {});
    expect(v.replaced).toEqual([{ sentenceId: 'n36', failed: ['slots', 'bestPiece'], by: null }]);
    expect(v.text).toBe('');
    expect(v.provenance).toEqual([]);
  });

  it('puts the part’s no-claim sentence in place of one whose picture of the term is no longer true', () => {
    const f = cece();
    const ctx = CommentBank.context(f, {});
    expect(ctx.picture).toBe('steady');
    // A sentence in the family's part that claims the picture of the term;
    // f01 (For the Family) is the part's first no-claim sentence.
    const steadyS = {
      id: 'x-steady',
      part: 'how',
      group: 'For the Family',
      text: 'At home, you can ask {him} about this steady term in {course}.',
      when: { picture: 'steady' },
      claims: ['picture'],
    };
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([steadyS]) };
    const d = {
      text: CommentBank.fill(steadyS, ctx),
      ids: ['x-steady'],
      sentences: [{ id: 'x-steady', part: 'how', text: CommentBank.fill(steadyS, ctx) }],
      provenance: [CommentBank.provenance(steadyS, ctx)],
    };
    const harder = { ...f, comps: f.comps.map(c => ({ ...c, now: 1.6, level: 1.6 })) };
    const v = CommentBank.verify(d, harder, {}, { bank });
    expect(v.replaced).toEqual([{ sentenceId: 'x-steady', failed: ['slots', 'picture'], by: 'f01' }]);
    expect(byId('f01').claims).toEqual([]);
    expect(v.ids).toEqual(['f01']);
    expect(v.text).toBe('At home, you can ask Cece to explain one idea from Science 8 in her own words.');
    expect(v.provenance[0]).toMatchObject({ sentenceId: 'f01', claims: [], factKeys: [] });
  });

  it('checks a claim the wording makes beyond its slots: late work, work not handed in', () => {
    const f = cece();
    expect(f.record.late).toBe(0);
    // Sentences whose wording, not a slot, claims late or missing work.
    const lateS = {
      id: 'x-late',
      part: 'how',
      group: 'At Home',
      text: 'Some of the work came in late.',
      claims: ['lateWork'],
    };
    const missS = {
      id: 'x-miss',
      part: 'how',
      group: 'At Home',
      text: 'Some work has not come in.',
      claims: ['notHandedIn'],
    };
    const bank = { parts: COMMENT_BANK.parts, sentences: [lateS, missS] };
    const ctx = CommentBank.context(f, {});
    const as = s => ({
      text: s.text,
      ids: [s.id],
      sentences: [{ id: s.id, part: s.part, text: s.text }],
      provenance: [CommentBank.provenance(s, ctx)],
    });
    expect(CommentBank.verify(as(lateS), f, {}, { bank }).replaced[0]).toMatchObject({
      failed: ['lateWork'],
      by: null,
    });
    const withLate = { ...f, record: { ...f.record, late: 1 } };
    expect(CommentBank.verify(as(lateS), withLate, {}, { bank }).replaced).toEqual([]);

    expect(CommentBank.verify(as(missS), f, {}, { bank }).replaced[0].failed).toEqual(['notHandedIn']);
    expect(f.notHandedIn.count).toBe(0);
    expect(
      CommentBank.verify(as(missS), { ...f, notHandedIn: { count: 1, titles: ['Lab 3'] } }, {}, { bank }).replaced,
    ).toEqual([]);
  });

  it('catches “it is the best work this term” on a piece that is only best in the Focus Area', () => {
    // The old At Home sentence w101 (cut in plan PR 8), kept here to test the claim.
    const w101 = {
      id: 'w101',
      part: 'how',
      group: 'For the Family',
      text: 'At home, ask {name} to walk you through {his} {seeWork}; it is {his} best work this term.',
      needs: ['seeWork'],
      claims: ['bestPiece', 'focusWork'],
    };
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([w101]) };
    const caught = [];
    getStudents(cid).forEach(st => {
      const f = CommentBank.facts(cid, st, 'term-2');
      const ctx = CommentBank.context(f, {});
      if (!CommentBank.fits(w101, ctx)) return;
      const d = {
        text: CommentBank.fill(w101, ctx),
        ids: ['w101'],
        sentences: [{ id: 'w101', part: 'how', text: CommentBank.fill(w101, ctx) }],
        provenance: [CommentBank.provenance(w101, ctx)],
      };
      const v = CommentBank.verify(d, f, {}, { bank });
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
    // Scientific Communication raised past the "strongest" gate, so a
    // sentence that says the letter grade and a strength fits (the bank's
    // n14, cut in round three, kept here as the test's own).
    const N14 = {
      id: 'n14',
      part: 'now',
      group: 'Overall',
      text: '{He} [has|have] {letterStanding} overall, and {he} can {strengths}.',
      needs: ['letterStanding', 'strengths'],
      claims: ['grade', 'strength'],
    };
    const bank = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([N14]) };
    const base = cece();
    const comps = base.comps.map(c => (c.id === 'SC' ? { ...c, level: 3.9 } : c));
    const f = { ...base, comps, letter: 'a B (78%)' };
    const d = one(N14, CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}, { bank }).replaced).toEqual([]);
    expect(CommentBank.verify(d, { ...f, letter: 'a C+ (68%)' }, {}, { bank }).replaced[0].failed).toEqual([
      'slots',
      'grade',
    ]);
  });

  it('never passes a sentence with no fact behind it, or one with no claims field', () => {
    const f = cece();
    const ctx = CommentBank.context(f, {});
    // A sentence claiming support, which nothing in FullVision backs.
    const h59 = {
      id: 'h59',
      part: 'habits',
      group: 'Work Habits',
      text: '{name} benefits from extra support and encouragement.',
      claims: ['support'],
    };
    const d59 = {
      text: CommentBank.fill(h59, ctx),
      ids: ['h59'],
      sentences: [{ id: 'h59', part: 'habits', text: CommentBank.fill(h59, ctx) }],
      provenance: [CommentBank.provenance(h59, ctx)],
    };
    const b59 = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([h59]) };
    expect(CommentBank.verify(d59, f, {}, { bank: b59 }).replaced[0].failed).toEqual(['support']);
    const bare = { ...byId('f01') };
    delete bare.claims;
    const bank = { parts: COMMENT_BANK.parts, sentences: [bare] };
    expect(CommentBank.verify(one('f01', ctx), f, {}, { bank }).replaced[0].failed).toEqual(['claims']);
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
    // The Ministry's own SS 8 competencies, named by the rebuilt bank.
    expect(names).toEqual(['Inquiry', 'Significance', 'Significance Claims']);
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
      ['COMP10', 'ela'],
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
      // No closing sentence or support lines are set for these classes, and
      // one piece per competency is too little evidence for a next step (so
      // no family line either, which belongs to it).
      expect(d.ids.length, tag).toBeGreaterThanOrEqual(3);
      if (!d.sentences.some(x => x.step === 'nextStep'))
        expect(
          d.sentences.map(x => x.step),
          tag,
        ).not.toContain('home');
      expect(d.text, tag).not.toMatch(/[{}[\]]/);
      if (fam === 'pe' || fam === 'arts') expect(d.text, tag).not.toMatch(/hands? in|handing in/i);
      if (fam === 'pe' || fam === 'career')
        expect(d.text, tag).not.toMatch(/area to build|room to grow in|targeted practice in/i);
      delete COURSES[cid];
    });
  });
});
