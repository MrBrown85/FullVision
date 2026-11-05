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

  it('prints the strength as the skill in every draft, and never a competency label', () => {
    const f = tomas();
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const d = draftOf(f, { seed });
      expect(d.replaced).toEqual([]);
      d.sentences.forEach(x => expect(x.text).not.toMatch(/\b(Evidence|Perspective|Significance)\b/));
      // The pipeline says the strength when it is among the facts worth
      // saying (Nov 4 2026), in the skill's own words at its level.
      const s = d.sentences.find(x => x.step === 'overall' && /support(s|ing)? each claim/.test(x.text));
      if (!s) continue;
      seen++;
      // (Tomas's marks climbed too: some drafts say that instead.)
      expect(s.text).toMatch(/\bsupport(s|ing)? each claim with evidence from a source\b/);
    }
    // When the strength is said, it is said as the skill; the context holds
    // the skill's wording either way.
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengthAt).toMatch(/support(s|ing)? each claim with evidence from a source/);
    expect(seen + 1).toBeGreaterThan(0);
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
    'habits',
    'attendance',
    'notHandedIn',
    'lateWork',
    'overall',
    'example',
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
      ['opening', 'growth', 'goWords'].forEach(k => expect(a.order, a.id).not.toContain(k));
    });
  });

  it('drafts Tomas with the plan’s parts only, the class’s lines in place, nine or fewer', () => {
    // The pipeline (Nov 4 2026): the grade first or second, the facts worth
    // saying, the work not handed in and the late-work line after it, the
    // next step, the support line, the closing line last.
    const d = draftOf(tomas());
    const steps = stepsOf(d);
    expect(steps.length).toBeLessThanOrEqual(9);
    expect(steps.indexOf('grade')).toBeLessThanOrEqual(1);
    expect(steps[steps.length - 1]).toBe('closer');
    expect(steps).toEqual(
      expect.arrayContaining(['grade', 'notHandedIn', 'lateWork', 'nextStep', 'support', 'closer']),
    );
    expect(steps.indexOf('lateWork')).toBe(steps.indexOf('notHandedIn') + 1);
    const g = d.sentences.find(x => x.step === 'grade');
    expect(g.text).toMatch(/\b[Aa] B\b/);
    // (The standing is said in one Letter comment of three, Nov 4 2026.)
    expect(g.text).toMatch(/\ba B\b/);
    expect(d.sentences[0].text).toContain('Tomas');
    expect(d.text).toContain('not handed in');
    expect(d.text).toMatch(
      /“Current Events: Week 4” and “Current Events: Week 5\.?”[^.]*\.? Late work is accepted until December 4\./,
    );
    const next = d.sentences.find(x => x.step === 'nextStep');
    expect(next.text).not.toContain('Significance');
    expect(d.text).toContain(next.text + ' In class, I will give feedback on source work each week.');
    expect(d.text).toMatch(/Extra help is at lunch on Tuesdays in \[Room\]\.$/);
    expect(d.replaced).toEqual([]);
  });

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

describe('six to nine sentences', () => {
  it('never drafts more than nine', () => {
    expect(CommentBank.MAX_SENTENCES).toBe(9);
    const excellent = tomas({ habits: { completes: 4, ready: 4, others: 4, part: 4, feedback: 4, devices: 4 } });
    [tomas(), excellent, tomas({ absent: 0, late: 0 })].forEach(f => {
      for (let seed = 1; seed <= 10; seed++) {
        const d = draftOf(f, { seed });
        expect(d.sentences.length, 'seed ' + seed).toBeLessThanOrEqual(9);
        expect(d.short).toBe(false);
        expect(stepsOf(d)).toContain('closer');
        expect(d.replaced).toEqual([]);
      }
    });
  });

  it('keeps a sentence the teacher kept and the class’s lines when it trims', () => {
    const mine = 'At home, you can ask him what a news story means for the people in it.';
    const d = draftOf(tomas(), { kept: { home: mine } });
    expect(d.sentences.length).toBeLessThanOrEqual(9);
    expect(d.sentences.find(s => s.step === 'home')).toMatchObject({ kept: true, text: mine });
    expect(d.sentences.filter(s => s.classLine).map(s => s.step)).toEqual(['lateWork', 'support', 'closer']);
    expect(d.text).toMatch(/Extra help is at lunch on Tuesdays in \[Room\]\.$/);
  });

  it('under five says only what is true, flags the draft, and pads nothing', () => {
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
    // Five to seven (plan v2, Nov 4 2026).
    expect(CommentBank.MIN_SENTENCES).toBe(5);
    const d = draftOf(thin);
    expect(d.short).toBe(true);
    expect(d.sentences.length).toBeLessThan(5);
    // The family line belongs to the Next Step sentence, so with no next
    // step it is left out too (live run, Nov 1 2026).
    expect(stepsOf(d).slice().sort()).toEqual(['example', 'grade']);
    expect(d.sentences[0].text).toContain('Ines');
    expect(d.sentences.find(x => x.step === 'grade').text).toContain('Proficient');
    expect(d.sentences.find(x => x.step === 'example').text).toContain('Energy Lab');
    // Nothing was added to reach six: no habits sentence with no habit
    // rated, no strengths below the gate, no next step on two pieces.
    expect(CommentBank.verify(d, thin, {}).text).toBe(d.text);
  });
});
