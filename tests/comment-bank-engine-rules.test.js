/**
 * The engine against the plan (Oct 31 drift audit):
 *
 * - Strengths (target comment part 3) are one or two skills from the
 *   competency-to-skill table, filled exactly as the next step is; never a
 *   bare competency label. verify() fails a strengths sentence whose value
 *   is not that wording.
 * - The draft runs the plan's eight parts only: no opening, growth or
 *   student's-words step on any angle.
 * - The support line is left out when no ticked line fits the student;
 *   never the first ticked line.
 * - Six to nine sentences: never more than nine (the family sentence goes
 *   first, then attendance, then the strengths); under six the draft says
 *   only what is true and carries `short: true`, never padding.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
const comp = (id, name, level, n = 3) => ({
  id,
  name,
  scores: pts(Array.from({ length: n }, () => level)),
  start: level,
  now: level,
  level,
  iCans: [],
});
const piece = (id, title, d, pct, note) => ({ id, title, d, v: pct / 25, pct, note: note || '' });
const line = (id, text, fits) => ({ id, text, fits: fits || [], own: false, on: true });

/* A History 12 student with every part true: a B, a best piece with a
   note, Evidence past the "strongest" gate, two habits to build,
   attendance entered, two pieces not handed in with a late-work line, a
   next step (Significance), a support line that fits it, and a closing
   sentence. */
function tomas(over) {
  const pieces = [
    piece('p1', '4.3 What Does the Poster Show?', '2026-10-20', 92, 'linked the poster to the Act'),
    piece('p2', 'Interwar Timeline', '2026-10-06', 80),
    piece('p3', 'Unit 1 Test', '2026-09-28', 78),
    piece('p4', 'Treaty of Versailles Debate', '2026-09-15', 74),
  ];
  return Object.assign(
    {
      cid: 'rules',
      sid: 's-tomas',
      name: 'Tomas',
      first: 'Tomas',
      course: 'History 12',
      family: 'socials',
      pronouns: HE,
      pronounsOnFile: true,
      comps: [comp('c1', 'Evidence', 3.6), comp('c2', 'Perspective', 3), comp('c3', 'Significance', 2.5)],
      work: pieces,
      voice: {},
      confidence: [],
      record: { total: 8, handed: 6, late: 0, missing: 2 },
      notHandedIn: { count: 2, titles: ['Current Events: Week 4', 'Current Events: Week 5'], groups: [] },
      habits: { completes: 2, ready: 4, others: 4, part: 2, feedback: 4, devices: 4 },
      absent: 3,
      late: 1,
      overall: 3.2,
      standing: 'Proficient',
      letter: 'B',
      grade: { mode: 'letter', letter: 'B', pct: 82, pieces, marked: { mine: 6, all: 8 } },
      levelText: v => Math.round(v * 25) + '%',
      enrolled: '',
      classStart: '',
      termStart: '',
      classLines: {
        support: [line('sl', 'In class, I will give feedback on source work each week.', ['significance'])],
        pick: null,
        closing: 'Extra help is at lunch on Tuesdays in [Room].',
        late: 'Late work is accepted until December 4.',
        charLimit: null,
      },
    },
    over,
  );
}
const draftOf = (f, opts) => CommentBank.draft(CommentBank.context(f, {}), Object.assign({ seed: 3 }, opts));
const stepsOf = d => d.sentences.map(s => s.step);
const EVIDENCE = 'support each claim with evidence from a source';
const PERSPECTIVE = 'judge a source by who created it and why';

/* A strengths sentence in the shape of the generic frames the bank no
   longer carries (n15, cut in round three: the per-skill frames cover every
   skill); verify() reads it from a bank that holds it. */
const N15 = {
  id: 'n15',
  part: 'now',
  group: 'Overall',
  text: '{His} strongest work shows {he} can {strengths}.',
  needs: ['strengths'],
  claims: ['strength'],
};
const withN15 = { parts: COMMENT_BANK.parts, sentences: COMMENT_BANK.sentences.concat([N15]) };
describe('strengths are skills from the table, never a bare competency label', () => {
  it('fills {strengths} and {strength} from skillOf, as the next step is filled', () => {
    const ctx = CommentBank.context(tomas(), {});
    expect(ctx.strengths).toBe(EVIDENCE);
    expect(ctx.strength).toBe(EVIDENCE);
    expect(ctx.strengths).not.toMatch(/Evidence/);
    expect(ctx._facts.strengths).toEqual(['comp:c1']);
    expect(ctx._facts.strength).toEqual(['comp:c1']);
    expect(CommentBank.strengthSkills(tomas()).map(x => x.key)).toEqual(['evidence']);
  });

  it('names two skills with "and" when two competencies pass the gate, and the first alone in {strength}', () => {
    const f = tomas({
      comps: [comp('c1', 'Evidence', 3.6), comp('c2', 'Perspective', 3.5), comp('c3', 'Significance', 2.5)],
    });
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengths).toBe(EVIDENCE + ' and ' + PERSPECTIVE);
    expect(ctx.strength).toBe(EVIDENCE);
  });

  it('gives no strengths for a competency the table has no skill for, rather than its label', () => {
    const f = tomas({
      comps: [comp('c1', 'Recognize Impacts', 3.6), comp('c2', 'Perspective', 3), comp('c3', 'Significance', 2.5)],
    });
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengths).toBe('');
    expect(ctx.strength).toBe('');
    expect(draftOf(f).text).not.toMatch(/Recognize Impacts/);
  });

  it('prints the strengths after "can" in every draft, and never a competency label', () => {
    const f = tomas();
    for (let seed = 1; seed <= 12; seed++) {
      const d = draftOf(f, { seed });
      const s = d.sentences.find(x => x.step === 'overall');
      expect(s, 'seed ' + seed).toBeTruthy();
      expect(s.text).toMatch(/\bsupport each claim with evidence from a source\b/);
      expect(s.text).not.toMatch(/\b(Evidence|Perspective|Significance)\b/);
      expect(d.replaced).toEqual([]);
    }
  });

  it('verify() fails a strengths sentence filled with a bare label, or with the wrong skill', () => {
    const f = tomas();
    const ctx = CommentBank.context(f, {});
    const n15 = N15;
    const asDrafted = {
      text: CommentBank.fill(n15, ctx),
      ids: ['n15'],
      sentences: [{ id: 'n15', part: 'now', text: CommentBank.fill(n15, ctx) }],
      provenance: [CommentBank.provenance(n15, ctx)],
    };
    expect(CommentBank.verify(asDrafted, f, {}, { bank: withN15 }).replaced).toEqual([]);
    const bare = Object.assign(CommentBank.context(f, {}), { strengths: 'Evidence' });
    const wrong = {
      text: CommentBank.fill(n15, bare),
      ids: ['n15'],
      sentences: [{ id: 'n15', part: 'now', text: CommentBank.fill(n15, bare) }],
      provenance: [CommentBank.provenance(n15, bare)],
    };
    expect(wrong.text).toContain('can Evidence');
    const v = CommentBank.verify(wrong, f, {}, { bank: withN15 });
    expect(v.replaced[0].sentenceId).toBe('n15');
    expect(v.replaced[0].failed).toContain('strength');
    expect(v.text).not.toContain('Evidence');
    // The gate still holds: the sentence fails once Evidence is no longer
    // among the strongest. (With Evidence and Perspective both past the
    // gate, the one-skill wording still holds: it is what {strengths}
    // falls back to when two skills run past 20 words, ctxFor.)
    const close = tomas({
      comps: [comp('c1', 'Evidence', 3), comp('c2', 'Perspective', 3.6), comp('c3', 'Significance', 3)],
    });
    expect(CommentBank.verify(asDrafted, close, {}, { bank: withN15 }).replaced[0].failed).toContain('strength');
    const both = tomas({
      comps: [comp('c1', 'Evidence', 3.2), comp('c2', 'Perspective', 3), comp('c3', 'Significance', 2.5)],
    });
    expect(CommentBank.strengthSkills(both).map(x => x.key)).toEqual(['evidence', 'perspective']);
    expect(CommentBank.verify(asDrafted, both, {}, { bank: withN15 }).replaced).toEqual([]);
    expect(CommentBank.CLAIMS.strength(asDrafted.provenance[0], f)).toBe(true);
    expect(CommentBank.CLAIMS.strength(wrong.provenance[0], f)).toBe(false);
  });
});

describe('the draft is the plan’s eight parts only', () => {
  const PLAN = [
    'grade',
    'spread',
    'growth',
    'example',
    'overall',
    'habits',
    'habitsMore',
    'habitsBuild',
    'attendance',
    'notHandedIn',
    'lateWork',
    // Before the Next Step: never between it and its family line (#632).
    'languageGoals',
    'nextStep',
    'support',
    'home',
    'closer',
    'ieProblem',
    'strongHabits',
    'iePlan',
    'ieDeadline',
    'ieMeeting',
  ];

  it('has no opening, growth or student’s-words step, on any angle', () => {
    expect(CommentBank.DRAFT_STEPS.map(s => s.key)).toEqual(PLAN);
    CommentBank.ANGLES.forEach(a => {
      a.order.forEach(k => expect(PLAN, a.id).toContain(k));
      ['opening', 'goWords'].forEach(k => expect(a.order, a.id).not.toContain(k));
      // One order for every comment off the IE path (the sample voice, Nov 4).
      if (a.id !== 'ie') expect(a.order, a.id).toBe(CommentBank.CORE_ORDER);
    });
  });

  it('drafts Tomas in the angle’s order with nothing else: grade, best piece, strengths, habits, not handed in, late work, next step, support, closing', () => {
    const d = draftOf(tomas());
    // Strong handed-in work behind two pieces labelled Missing. Every part
    // that is true is written, in the one order (Colin, Nov 4: nothing is
    // trimmed; "longer is fine").
    expect(d.angle).toBe('hidden');
    expect(stepsOf(d)).toEqual([
      'grade',
      'example',
      'overall',
      'habits',
      'habitsBuild',
      'attendance',
      'notHandedIn',
      'lateWork',
      'nextStep',
      'support',
      'home',
      'closer',
    ]);
    // The grade sentence, then the best piece with its note (in one of the
    // best-piece frames, bank expansion Nov 1).
    expect(d.sentences[0].step).toBe('grade');
    expect(d.sentences[0].text).toContain('Tomas');
    expect(d.sentences[0].text).toMatch(/\ba B\b/);
    expect(d.sentences[0].text).toMatch(/very good/);
    expect(d.sentences[1].step).toBe('example');
    expect(d.sentences[1].text).toContain('“What Does the Poster Show?”');
    expect(d.sentences[1].text).toContain('linked the poster to the Act.');
    expect(d.text).toContain('handing in each task by its due date, and sharing his ideas in class discussions.');
    expect(d.text).toMatch(/three classes/);
    // One of the two-title Not Handed In frames (m01, m07-m11), both titles
    // quoted, with the class's late-work line right after it.
    expect(d.text).toContain('not handed in');
    expect(d.text).toMatch(
      /“Current Events: Week 4” and “Current Events: Week 5\.?”[^.]*\.? Late work is accepted until December 4\./,
    );
    // The next step is one of the frames for Significance, then the
    // support line.
    const next = d.sentences.find(x => x.step === 'nextStep');
    const forSkill = COMMENT_BANK.sentences
      .filter(s => s.when && s.when.nextSkill === 'significance' && s.subjects[0] === 'socials')
      .map(s => s.id);
    expect(forSkill).toContain(next.id);
    expect(next.text).not.toContain('Significance');
    expect(d.text).toContain(next.text + ' In class, I will give feedback on source work each week.');
    expect(d.text).toMatch(/Extra help is at lunch on Tuesdays in \[Room\]\.$/);
    expect(d.text).not.toMatch(
      /There is a lot to recognize|steady term|grown most|slipped|even across|own goal|revisit/,
    );
  });
});

describe('the support line', () => {
  it('is left out when no ticked line fits the student, never the first ticked line', () => {
    const f = tomas({
      classLines: {
        support: [
          line('a', 'In class, I will give a short checklist for each assignment.', ['ready']),
          line('b', 'In class, I will model how to plan a paragraph before writing.', ['perspective']),
        ],
        pick: null,
        closing: '',
        late: '',
        charLimit: null,
      },
    });
    expect(CommentBank.supportChoice(f, f.habits)).toBeNull();
    expect(CommentBank.context(f, {}).supportLine).toBe('');
    expect(stepsOf(draftOf(f))).not.toContain('support');
  });

  it('takes the line that fits the next step, else one that fits a habit to build', () => {
    const f = tomas({
      classLines: {
        support: [
          line('a', 'In class, I will ask about missing work each week.', ['completes']),
          line('b', 'In class, I will give feedback on source work each week.', ['significance']),
        ],
        pick: null,
        closing: '',
        late: '',
        charLimit: null,
      },
    });
    expect(CommentBank.supportChoice(f, f.habits)).toMatchObject({ line: { id: 'b' }, fit: 'significance' });
    const noNext = tomas({
      comps: [comp('c1', 'Evidence', 3.6), comp('c2', 'Perspective', 3, 1), comp('c3', 'Significance', 2.5, 1)],
      classLines: f.classLines,
    });
    expect(CommentBank.supportChoice(noNext, noNext.habits)).toMatchObject({ line: { id: 'a' }, fit: 'completes' });
  });
});

/* The sentences as the plan counts them: the habits part is one (its
   second sentence and the habits that would help are part of it). */
const counted = d => d.sentences.filter(s => s.step !== 'habitsMore' && s.step !== 'habitsBuild').length;

describe('six sentences or more, never trimmed', () => {
  it('writes every part that is true, the family sentence and attendance included (Colin, Nov 4: "longer is fine")', () => {
    const excellent = tomas({ habits: { completes: 4, ready: 4, others: 4, part: 4, feedback: 4, devices: 4 } });
    [tomas(), excellent].forEach(f => {
      for (let seed = 1; seed <= 10; seed++) {
        const d = draftOf(f, { seed });
        expect(counted(d), 'seed ' + seed).toBeGreaterThan(9);
        expect(d.short).toBe(false);
        ['home', 'attendance', 'overall', 'closer'].forEach(k => expect(stepsOf(d), 'seed ' + seed).toContain(k));
        expect(d.replaced).toEqual([]);
      }
    });
    // With nothing missing and no attendance, the rest is as it was.
    const fits = draftOf(
      tomas({
        absent: 0,
        late: 0,
        record: { total: 8, handed: 8, late: 0, missing: 0 },
        notHandedIn: { count: 0, titles: [], groups: [] },
      }),
    );
    expect(stepsOf(fits)).toEqual([
      'grade',
      'example',
      'overall',
      'habits',
      'habitsBuild',
      'nextStep',
      'support',
      'home',
      'closer',
    ]);
  });

  it('keeps a sentence the teacher kept and the class’s lines', () => {
    const mine = 'At home, you can ask him what a news story means for the people in it.';
    const d = draftOf(tomas(), { kept: { home: mine } });
    expect(d.sentences.find(s => s.step === 'home')).toMatchObject({ kept: true, text: mine });
    expect(stepsOf(d)).toContain('overall');
    expect(d.sentences.filter(s => s.classLine).map(s => s.step)).toEqual(['lateWork', 'support', 'closer']);
    expect(d.text).toMatch(/Extra help is at lunch on Tuesdays in \[Room\]\.$/);
  });

  it('under six says only what is true, flags the draft, and pads nothing', () => {
    const thin = {
      cid: 'rules',
      sid: 's-ines',
      name: 'Ines',
      first: 'Ines',
      course: 'Science 8',
      family: 'science',
      pronouns: THEY,
      pronounsOnFile: true,
      comps: [comp('q', 'Questioning and Predicting', 3, 1)],
      work: [piece('p1', 'Energy Lab', '2026-10-01', 75)],
      voice: {},
      confidence: [],
      record: { total: 2, handed: 2, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 3,
      standing: 'Proficient',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: () => 'Proficient',
      enrolled: '',
      classStart: '',
      termStart: '',
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    };
    expect(CommentBank.MIN_SENTENCES).toBe(6);
    const d = draftOf(thin);
    expect(d.short).toBe(true);
    expect(d.sentences.length).toBeLessThan(6);
    // Every comment has a next step and a family line (Colin, Nov 4): with
    // no competency to draw one from, a generic science step that claims
    // nothing, and a family line for any science class.
    // The strength, with one competency and one piece: a skill at Proficient, or the course's top mark.
    expect(stepsOf(d)).toEqual(['grade', 'example', 'overall', 'nextStep', 'home']);
    expect(d.sentences[0].text).toContain('Ines');
    expect(d.sentences[0].text).toContain('Proficient');
    expect(d.sentences[1].text).toMatch(/[Tt]heir Energy Lab/);
    expect(['oa01', 'oa02', 'oa03', 'oa04', 'oc01', 'oc02', 'oc03']).toContain(d.ids[2]);
    const next = COMMENT_BANK.sentences.find(s => s.id === d.ids[3]);
    expect(next.claims).toEqual([]);
    expect(next.subjects).toEqual(['science']);
    // Nothing else was added to reach six: no habits sentence with no habit
    // rated, no strengths below the gate.
    expect(CommentBank.verify(d, thin, {}).text).toBe(d.text);
  });
});
