/**
 * Generate's evidence gates (plan PR 6). "Strongest" needs 3+ scored pieces
 * in the competency and half a proficiency step over the next one;
 * "improved" needs 4+ pieces over 4+ weeks, comparing the medians of the
 * earliest and latest thirds by date, and is suppressed when the gain rests
 * on one low early score. Below a gate the claiming sentence is not
 * eligible: selection skips it and verify() fails it. The climb and slide
 * stories and the At a Glance Strongest tag read the same gates.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

/* A day counted from Sep 1, 2026, as YYYY-MM-DD. */
function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* Points { d, v }, `gap` days apart. */
const pts = (vs, gap = 7) => vs.map((v, i) => ({ id: 'w' + i, d: day(i * gap), v, title: 'Task ' + i }));
/* A competency at `level` with n scores (or the scores given). */
const comp = (id, level, n = 3, scores) => ({
  id,
  name: 'Skill ' + id,
  scores: scores || pts(Array.from({ length: n }, () => level)),
  start: level,
  now: level,
  level,
  iCans: [],
});

function facts(over) {
  return Object.assign(
    {
      cid: 'gates',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'Science 10',
      family: 'science',
      pronouns: THEY,
      comps: [comp('a', 3.5), comp('b', 3), comp('c', 2.5)],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 6, handed: 6, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 3,
      standing: 'Proficient',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: () => '',
      enrolled: '',
      classStart: '',
      termStart: '',
    },
    over,
  );
}
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const one = (id, ctx) => {
  const s = byId(id);
  const text = CommentBank.fill(s, ctx);
  return { text, ids: [id], sentences: [{ id, part: s.part, text }], provenance: [CommentBank.provenance(s, ctx)] };
};
const ids = xs => xs.map(c => c.id);

describe('the "strongest" gate', () => {
  it('passes at 3 scored pieces and half a step over the next competency', () => {
    expect(ids(CommentBank.strongestOf([comp('a', 3.5), comp('b', 3)]))).toEqual(['a']);
  });
  it('fails at 2 pieces', () => {
    expect(CommentBank.strongestOf([comp('a', 3.5, 2), comp('b', 3)])).toEqual([]);
  });
  it('fails under half a step, and counts 3.3 over 2.8 as half a step', () => {
    expect(CommentBank.strongestOf([comp('a', 3.4), comp('b', 3)])).toEqual([]);
    expect(ids(CommentBank.strongestOf([comp('a', 3.3), comp('b', 2.8)]))).toEqual(['a']);
  });
  it('names two when they are close together and both half a step over the third', () => {
    expect(ids(CommentBank.strongestOf([comp('a', 3.6), comp('b', 3.5), comp('c', 3)]))).toEqual(['a', 'b']);
    expect(CommentBank.strongestOf([comp('a', 3.6), comp('b', 3.5), comp('c', 3.1)])).toEqual([]);
    expect(CommentBank.strongestOf([comp('a', 3.6), comp('b', 3.5, 2), comp('c', 3)])).toEqual([]);
  });
  it('needs a next competency: none with one, or with two that tie', () => {
    expect(CommentBank.strongestOf([comp('a', 4)])).toEqual([]);
    expect(CommentBank.strongestOf([comp('a', 3), comp('b', 3)])).toEqual([]);
  });
  it('compares with the next competency even when that one has few pieces', () => {
    expect(CommentBank.strongestOf([comp('a', 3.5), comp('b', 3.4, 1), comp('c', 2)])).toEqual([]);
  });
});

describe('the "improved" gate', () => {
  const up = [2, 2.5, 3, 3];
  it('passes at 4 pieces over 4 weeks, up half a step between the thirds’ medians', () => {
    expect(CommentBank.improvedGate(pts(up, 10), 0.5)).toBe(true);
    expect(CommentBank.trendOf(pts(up, 10))).toBe(1);
  });
  it('fails at 3 pieces, or under 4 weeks', () => {
    expect(CommentBank.improvedGate(pts([2, 2.5, 3], 14), 0.5)).toBe(false);
    expect(CommentBank.trendOf(pts([2, 2.5, 3], 14))).toBeNull();
    expect(CommentBank.improvedGate(pts(up, 9), 0.5)).toBe(false);
    expect(CommentBank.trendOf(pts(up, 9))).toBeNull();
    // Exactly 28 days from first to last passes.
    const four = [0, 7, 14, 28].map((n, i) => ({ d: day(n), v: up[i] }));
    expect(CommentBank.improvedGate(four, 0.5)).toBe(true);
    expect(CommentBank.improvedGate(four.slice(0, 3).concat({ d: day(27), v: 3 }), 0.5)).toBe(false);
  });
  it('fails when the change is under the step', () => {
    expect(CommentBank.improvedGate(pts([2.6, 2.8, 3, 3], 10), 0.5)).toBe(false);
  });
  it('compares medians of the earliest and latest thirds by date, whatever the order given', () => {
    const xs = pts([2, 2, 2.5, 3, 3, 3], 7);
    expect(CommentBank.trendOf(xs.slice().reverse())).toBe(1);
    expect(CommentBank.improvedGate(xs.slice().reverse(), 0.5)).toBe(true);
  });
  it('is suppressed when the gain rests on one low early score', () => {
    // One low start, then flat: no gain without it.
    expect(CommentBank.trendOf(pts([1, 3, 3, 3.2], 10))).toBeCloseTo(2.2);
    expect(CommentBank.improvedGate(pts([1, 3, 3, 3.2], 10), 0.5)).toBe(false);
    // Thirds of two: the one low score drags the early median.
    expect(CommentBank.improvedGate(pts([1, 3, 3.2, 3, 3.2, 3.2], 7), 0.5)).toBe(false);
    // A low start in a real climb still counts.
    expect(CommentBank.improvedGate(pts([1, 2.5, 3, 3.5], 10), 0.5)).toBe(true);
  });
  it('reads the scored pieces’ % for the climb and slide stories, five points either way', () => {
    const pct = (vs, gap) => vs.map((p, i) => ({ id: 'p' + i, d: day(i * gap), pct: p }));
    expect(CommentBank.climbed(pct([70, 74, 78, 80], 10))).toBe(true);
    expect(CommentBank.climbed(pct([70, 72, 74, 74], 10))).toBe(false);
    expect(CommentBank.climbed(pct([70, 74, 78, 80], 9))).toBe(false);
    expect(CommentBank.slid(pct([76, 74, 72, 71], 10))).toBe(true);
    expect(CommentBank.slid(pct([76, 74, 72, 72], 10))).toBe(false);
  });
});

describe('below a gate, the claiming sentence is not eligible', () => {
  // The student feels strongest in b, a skill the work does not put on top.
  const selfB = {
    confidence: [
      { id: 'b', name: 'Skill b', c: 4 },
      { id: 'c', name: 'Skill c', c: 2 },
    ],
  };

  it('selection skips a strength claim below the gate, even when its slot has a value', () => {
    const f = facts(selfB);
    const ctx = CommentBank.context(f, {});
    expect(ctx.selfStrong).toBe('Skill b');
    expect(CommentBank.fits(byId('n146'), ctx)).toBe(false);
    // On a skill past the gate, the same sentence fits.
    const f2 = facts({ ...selfB, comps: [comp('b', 3.5), comp('a', 3), comp('c', 2.5)] });
    expect(CommentBank.fits(byId('n146'), CommentBank.context(f2, {}))).toBe(true);
  });

  it('gives no strengths slot below the gate', () => {
    expect(CommentBank.context(facts({ comps: [comp('a', 3.4), comp('b', 3)] }), {}).strengths).toBe('');
    expect(CommentBank.context(facts({ comps: [comp('a', 3.5, 2), comp('b', 3)] }), {}).strengths).toBe('');
    expect(CommentBank.context(facts({}), {}).strengths).toBe('Skill a');
  });

  it('gives no rise below the "improved" gate', () => {
    const rising = scores => facts({ comps: [comp('a', 3, 0, pts(scores, 10)), comp('b', 3)] });
    expect(CommentBank.context(rising([2, 2.5, 3, 3]), {}).rise).toBe('Skill a');
    expect(CommentBank.context(rising([1, 3, 3, 3.2]), {}).rise).toBe('');
    expect(CommentBank.context(rising([2, 2.5, 3]), {}).rise).toBe('');
  });

  it('no draft ever makes a strength or improved claim the facts do not pass', () => {
    const f = facts({
      ...selfB,
      comps: [comp('a', 3.4), comp('b', 3, 0, pts([1, 3, 3, 3.2], 10)), comp('c', 2.8)],
    });
    for (let seed = 1; seed <= 40; seed++) {
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed, angleUses: {} });
      expect(d.replaced, 'seed ' + seed).toEqual([]);
      d.ids.forEach(id => {
        const claims = (byId(id) && byId(id).claims) || [];
        expect(claims, id).not.toContain('strength');
        expect(claims, id).not.toContain('improved');
      });
    }
  });

  it('verify() fails a strength sentence once the facts fall below the gate', () => {
    const f = facts({});
    const d = one('n15', CommentBank.context(f, {}));
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    // Two pieces in the top skill now.
    const thin = facts({ comps: [comp('a', 3.5, 2), comp('b', 3), comp('c', 2.5)] });
    expect(CommentBank.verify(d, thin, {}).replaced[0].failed).toContain('strength');
    // Under half a step clear.
    const close = facts({ comps: [comp('a', 3.4), comp('b', 3), comp('c', 2.8)] });
    expect(CommentBank.verify(d, close, {}).replaced[0].failed).toContain('strength');
  });

  it('verify() fails an improved sentence once the gain rests on one low early score', () => {
    const f = facts({ comps: [comp('a', 3, 0, pts([2, 2.5, 3, 3], 10)), comp('b', 3)] });
    const d = one('n20', CommentBank.context(f, {}));
    expect(d.text).toContain('Skill a');
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const lowStart = facts({ comps: [comp('a', 3, 0, pts([1, 3, 3, 3.2], 10)), comp('b', 3)] });
    expect(CommentBank.verify(d, lowStart, {}).replaced[0].failed).toContain('improved');
    expect(CommentBank.CLAIMS.improved(d.provenance[0], lowStart)).toBe(false);
  });
});
