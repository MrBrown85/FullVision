/**
 * Strengths for a tie at the top (Nov 1): with 8–12 competencies several
 * tie at the top, so the "strongest" gate finds no half-step lead and most
 * students got no strengths sentence.
 *
 * - topTieOf: nothing past the "strongest" gate; two or more competencies,
 *   each on 3+ pieces, within half a step of the highest, every one of them
 *   half a step or more over the rest (of which there is at least one).
 * - topSkillOf: the strongest skill, else one of the tie: the skill named
 *   for the fewest classmates this session, then the shortest wording.
 * - The per-skill frames that do not assert "strongest" (`when.topSkill`)
 *   fit under the strongest and under the tie; the ones that do
 *   (`when.strongSkill`) stay gated on the strongest.
 * - Order: strongest, then the tie, then even results.
 * - verify() checks the tie facts; the At a Glance tag stays "Strongest".
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
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
/* A competency named by its id, for the gate tests. */
const c = (id, level, n) => comp(id, 'Area ' + id, level, n);

function facts(comps, over) {
  return Object.assign(
    {
      cid: 'c-tie',
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
      overall: 3.2,
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
/* Three at the top within half a step (3.6, 3.4, 3.3), one a full step
   below: a tie, no strongest. */
const tieComps = () => [
  comp('a', 'Evidence', 3.6),
  comp('b', 'Significance', 3.4),
  comp('c', 'Cause and Consequence', 3.3),
  comp('d', 'Inquiry', 2.6),
];
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
// The languages hidden and newcomer frames are bound to a skill (topSkill)
// but need their story too (tests/comment-bank-languages-frames.test.js).
const topFrames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.topSkill && !s.story);
const strongFrames = COMMENT_BANK.sentences.filter(s => s.group === 'Overall' && s.when && s.when.strongSkill);
const skillWords = key => CommentBank.SKILLS.socials.find(r => r.key === key).skill;
const wc = t => CommentRealiser.wordCount(t);
const verified = (s, text, pv, f, step) =>
  CommentBank.verify({ text, sentences: [{ id: s.id, part: s.part, step, text }], provenance: [pv] }, f, {});

describe('the tie at the top (topTieOf)', () => {
  it('holds for three within half a step of the highest, all half a step or more over the rest', () => {
    const comps = tieComps();
    expect(CommentBank.strongestOf(comps)).toEqual([]);
    expect(ids(CommentBank.topTieOf(comps))).toEqual(['a', 'b', 'c']);
    // Exactly half a step over the rest counts (3.3 over 2.8).
    expect(ids(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3), c('d', 2.8)]))).toEqual(['a', 'b', 'c']);
  });

  it('fails under half a step over the rest, or with no rest', () => {
    // 3.3 over 2.9 is not half a step.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3), c('d', 2.9)])).toEqual([]);
    // Every competency within half a step: the even case, not a tie.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3)])).toEqual([]);
    expect(CommentBank.topTieOf([c('a', 3.4), c('b', 3.2)])).toEqual([]);
    // Half a step below the highest is the rest (3.1), and the tie is only 0.3 over it.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.1)])).toEqual([]);
    // Two at the top half a step over the third pass the strongest gate instead.
    expect(ids(CommentBank.strongestOf([c('a', 3.6), c('b', 3.5), c('c', 2.8)]))).toEqual(['a', 'b']);
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.5), c('c', 2.8)])).toEqual([]);
  });

  it('leaves a competency on fewer than 3 pieces out of the tie: not named, not a blocker, not the rest', () => {
    // In the band on two pieces: the other two tie, half a step over the rest.
    expect(ids(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4, 2), c('c', 3.3), c('d', 2.6)]))).toEqual(['a', 'c']);
    // The lead is the tie's own: 3.4 over 2.9 is half a step even though
    // the thin one (3.2) is not.
    expect(ids(CommentBank.topTieOf([c('a', 3.6), c('b', 3.2, 2), c('c', 3.4), c('d', 2.9)]))).toEqual(['a', 'c']);
    // And the tie's own lead still has to be half a step: 3.3 over 2.9 is not.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4, 2), c('c', 3.3), c('d', 2.9)])).toEqual([]);
    // Two or more on 3+ pieces must tie: one judged in the band is not a tie.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4, 2), c('c', 3.3, 1), c('d', 2.6)])).toEqual([]);
    // Thin and alone at the top: no strongest, and the band below it has
    // one judged competency, so no tie either.
    expect(CommentBank.strongestOf([c('a', 4, 2), c('b', 3.5), c('c', 3.0), c('d', 3.0, 1)])).toEqual([]);
    expect(CommentBank.topTieOf([c('a', 4, 2), c('b', 3.5), c('c', 3.0), c('d', 3.0, 1)])).toEqual([]);
    // Below the band, a thin competency is still the rest the lead is measured over.
    expect(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3), c('d', 2.9, 1)])).toEqual([]);
    expect(ids(CommentBank.topTieOf([c('a', 3.6), c('b', 3.4), c('c', 3.3), c('d', 2.8, 1)]))).toEqual(['a', 'b', 'c']);
    // The strongest and even gates are as they were: a thin competency
    // in the band still blocks the strongest, and still counts for even.
    expect(CommentBank.strongestOf([c('a', 3.6, 2), c('b', 3.0), c('c', 2.8)])).toEqual([]);
    expect(ids(CommentBank.strongestOf([c('a', 3.6), c('b', 3.0, 2), c('c', 2.8)]))).toEqual(['a']);
    expect(ids(CommentBank.evenComps([c('a', 3.2), c('b', 3.1, 2), c('c', 3.0)], 3.1))).toEqual(['a', 'b', 'c']);
    expect(CommentBank.evenComps([c('a', 3.2), c('b', 3.1, 2), c('c', 2.7)], 3.1)).toEqual([]);
    // The skill named is one of the judged tie, and verify() holds it.
    const f = facts([
      comp('a', 'Evidence', 3.6),
      comp('b', 'Significance', 3.4, 2),
      comp('c', 'Cause and Consequence', 3.3),
      comp('d', 'Inquiry', 2.6),
    ]);
    expect(CommentBank.topTieSkills(f).map(x => x.key)).toEqual(['evidence', 'cause']);
    const ctx = CommentBank.context(f, {});
    expect(['evidence', 'cause']).toContain(ctx._topSkill);
  });

  it('yields to the strongest gate, and ignores a competency with no level', () => {
    const strong = [comp('a', 'Evidence', 4), comp('b', 'Significance', 3.4), comp('c', 'Cause', 3.3)];
    expect(ids(CommentBank.strongestOf(strong))).toEqual(['a']);
    expect(CommentBank.topTieOf(strong)).toEqual([]);
    expect(ids(CommentBank.topTieOf(tieComps().concat([comp('e', 'Perspective', 0)])))).toEqual(['a', 'b', 'c']);
  });

  it('names the tied skills from the table, the next step left out', () => {
    const f = facts(tieComps());
    expect(CommentBank.nextStepOf(f.comps).id).toBe('d');
    expect(CommentBank.topTieSkills(f).map(x => x.key)).toEqual(['evidence', 'significance', 'cause']);
    // The rest on one piece: the next step is the lowest of the tie, and it
    // is not also the strength.
    const thin = facts([
      comp('a', 'Evidence', 3.6),
      comp('b', 'Significance', 3.4),
      comp('c', 'Cause and Consequence', 3.3),
      comp('d', 'Inquiry', 2.5, 1),
    ]);
    expect(ids(CommentBank.topTieOf(thin.comps))).toEqual(['a', 'b', 'c']);
    expect(CommentBank.nextStepOf(thin.comps).id).toBe('c');
    expect(CommentBank.topTieSkills(thin).map(x => x.key)).toEqual(['evidence', 'significance']);
  });
});

describe('the strength named (topSkillOf)', () => {
  it('is the strongest skill when there is one, else the shortest wording of the tie', () => {
    const strong = facts([comp('a', 'Evidence', 4), comp('b', 'Significance', 3.4), comp('c', 'Cause', 3.3)]);
    expect(CommentBank.topSkillOf(strong).key).toBe('evidence');
    const f = facts(tieComps(), { cid: 'c-tie-shortest' });
    const words = ['evidence', 'significance', 'cause'].map(k => [k, wc(skillWords(k))]);
    const shortest = words.slice().sort((x, y) => x[1] - y[1])[0][0];
    expect(CommentBank.topSkillOf(f).key).toBe(shortest);
    expect(CommentBank.topSkillOf(facts([comp('a', 'Evidence', 3.4), comp('b', 'Significance', 3.2)]))).toBeNull();
  });
});
