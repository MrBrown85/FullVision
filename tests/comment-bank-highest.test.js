/**
 * Strengths for a staircase (Nov 2): the student's own highest-marked skill.
 *
 * - highestOf: no other route holds (strongest, a tie at the top, even
 *   results); two or more competencies judged on 3+ pieces; the judged
 *   ones at the highest proficiency as it prints, the next step's left out.
 * - highestSkills: those as skills from the table, the next step's skill
 *   left out; the skill named for the fewest classmates first, then the
 *   shortest wording.
 * - The frames (`when.highestWord`) say what the work shows at the
 *   competency's own proficiency word; the ones that say "highest" or
 *   "where {his} marks are highest" need `highestTop` (no competency with
 *   a level above).
 * - verify() checks the competency is still one of the highest-marked ones
 *   and not the next step, in the table's wording, at its own word.
 * - Browse Sentences: "Highest Marks · {word}" under Strengths.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
const WORDS = ['Extending', 'Proficient', 'Developing', 'Emerging'];
const RQ = ReportQuestionnaire;

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
const comp = (id, name, level, n = 3) => ({
  id,
  name,
  scores: pts(Array(n).fill(level)),
  start: level,
  now: level,
  level,
  iCans: [],
});
const ids = xs => xs.map(c => c.id);
const skillWords = (family, key) => CommentBank.SKILLS[family].find(r => r.key === key).skill;

function facts(comps, over) {
  return Object.assign(
    {
      cid: 'c-high',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'History 12',
      family: 'socials',
      pronouns: HE,
      pronounsOnFile: true,
      comps,
      work: pts([3, 3, 3]),
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 2.8,
      standing: 'Proficient',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: () => '',
      enrolled: '',
      classStart: '',
      termStart: '',
      absent: 0,
      late: 0,
    },
    over,
  );
}
/* A staircase: two at 3.0, then 2.8, 2.7, 2.5, and the next step a full
   step and more below. No half-step lead anywhere, so no strongest and no
   tie; a 2.0 spread, so not even. */
const stairs = () => [
  comp('a', 'Evidence', 3.0),
  comp('b', 'Significance', 3.0, 4),
  comp('c', 'Cause and Consequence', 2.8),
  comp('d', 'Continuity and Change', 2.7),
  comp('e', 'Inquiry', 2.5),
  comp('f', 'Perspective', 1.0),
];
const frames = COMMENT_BANK.sentences.filter(s => s.when && s.when.highestWord);
const isHigh = id => /^n10\d\d$/.test(id) && frames.some(s => s.id === id);
const verified = (s, text, pv, f) =>
  CommentBank.verify({ text, sentences: [{ id: s.id, part: s.part, step: 'overall', text }], provenance: [pv] }, f, {});

describe('the highest-marked skill (highestOf)', () => {
  it('holds for a staircase: the judged competencies at the highest proficiency, the next step left out', () => {
    const f = facts(stairs());
    expect(CommentBank.strongestOf(f.comps)).toEqual([]);
    expect(CommentBank.topTieOf(f.comps)).toEqual([]);
    expect(CommentBank.evenComps(f.comps, f.overall)).toEqual([]);
    expect(CommentBank.nextStepOf(f.comps).id).toBe('f');
    expect(ids(CommentBank.highestOf(f.comps, f.overall))).toEqual(['a', 'b']);
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengths).toBe('');
    expect(ctx._topSkill).toBe('');
    expect(ctx.evenResults).toBe('');
    // The shorter wording first: Evidence's eight words, Significance's nine.
    expect(ctx._highestSkills.map(x => x.key)).toEqual(['evidence', 'significance']);
    expect(ctx.highestSkill).toBe(skillWords('socials', 'evidence'));
    expect(ctx._highestWord).toBe('Proficient');
    expect(ctx.highestTop).toBe('yes');
  });

  it('comes after strongest, a tie and even results', () => {
    const strongest = [comp('a', 'Evidence', 3.6), comp('b', 'Significance', 2.8), comp('c', 'Inquiry', 2.6)];
    expect(CommentBank.strongestOf(strongest).length).toBe(1);
    expect(CommentBank.highestOf(strongest, 3)).toEqual([]);
    const tie = [
      comp('a', 'Evidence', 3.6),
      comp('b', 'Significance', 3.4),
      comp('c', 'Cause and Consequence', 3.3),
      comp('d', 'Inquiry', 2.6),
    ];
    expect(CommentBank.strongestOf(tie)).toEqual([]);
    expect(CommentBank.topTieOf(tie).length).toBe(3);
    expect(CommentBank.highestOf(tie, 3.2)).toEqual([]);
    const even = [comp('a', 'Evidence', 3.1), comp('b', 'Significance', 3.0), comp('c', 'Inquiry', 2.9)];
    expect(CommentBank.evenComps(even, 3).length).toBe(3);
    expect(CommentBank.highestOf(even, 3)).toEqual([]);
    const ctx = CommentBank.context(facts(tie, { overall: 3.2 }), {});
    expect(ctx._topSkill).not.toBe('');
    expect(ctx.highestSkill).toBe('');
  });

  it('needs two or more judged competencies: one skill on 3+ pieces names nothing', () => {
    const comps = [comp('a', 'Evidence', 3.0), comp('b', 'Significance', 3.0, 2), comp('c', 'Inquiry', 2.0, 1)];
    expect(CommentBank.strongestOf(comps)).toEqual([]);
    expect(CommentBank.topTieOf(comps)).toEqual([]);
    expect(CommentBank.highestOf(comps, 2.8)).toEqual([]);
    const ctx = CommentBank.context(facts(comps), {});
    expect(ctx.highestSkill).toBe('');
    expect(ctx._highestWord).toBe('');
    expect(CommentBank.stepPool('overall', ctx).filter(s => isHigh(s.id))).toEqual([]);
    const d = CommentBank.draft(ctx, { seed: 1 });
    expect(d.sentences.find(x => x.step === 'overall')).toBeUndefined();
  });

  it('leaves out the next step, even when it ties at the top, and says "highest" only with nothing above', () => {
    // Evidence and Significance both 3.0 on 3 pieces; Evidence, first in
    // report order, is the next step. Inquiry, on one piece, sits above.
    const comps = [comp('a', 'Evidence', 3.0), comp('b', 'Significance', 3.0), comp('c', 'Inquiry', 3.6, 1)];
    const f = facts(comps);
    expect(CommentBank.strongestOf(comps)).toEqual([]);
    expect(CommentBank.topTieOf(comps)).toEqual([]);
    expect(CommentBank.evenComps(comps, f.overall)).toEqual([]);
    expect(CommentBank.nextStepOf(comps).id).toBe('a');
    expect(ids(CommentBank.highestOf(comps, f.overall))).toEqual(['b']);
    const ctx = CommentBank.context(f, {});
    expect(ctx.highestSkill).toBe(skillWords('socials', 'significance'));
    expect(ctx.highestTop).toBe('');
  });
});
