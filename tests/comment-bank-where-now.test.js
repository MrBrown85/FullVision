/**
 * Where the student is now (Colin, 2026-11-02): for a strongest competency
 * from the BC bank, the Overall sentence says its cluster's phrase at the
 * level word, with the Ministry scale's qualifier: "is beginning to",
 * "with growing consistency", "consistently", "with depth and complexity".
 * The strongest gate (3+ pieces, half a step clear) holds as before; a
 * class not linked to the bank keeps the table's strengths sentences.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const comment = JSON.parse(readFileSync('data/bc-curriculum-comment.json', 'utf-8'));
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const comp = (id, name, level, bankId) => ({
  id,
  name,
  bankId: bankId || null,
  scores: [0, 1, 2].map(i => ({ id: 'w' + i, d: day(i * 7), v: level, title: 'Task ' + i })),
  start: level,
  now: level,
  level,
  iCans: ['I can explain why it matters'],
});

/* An SS 10 student: Evidence is the strength, Significance the next step. */
function facts(levels, bank = true, over) {
  const [e, p, s] = levels;
  return Object.assign(
    {
      cid: 'bank-phrases',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      course: 'Social Studies 10',
      family: 'socials',
      pronouns: THEY,
      pronounsOnFile: true,
      comps: [
        comp('c1', 'Evidence', e, bank && 'bc.ss10.cc.3'),
        comp('c2', 'Perspective', p, bank && 'bc.ss10.cc.6'),
        comp('c3', 'Significance', s, bank && 'bc.ss10.cc.2'),
      ],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 3, handed: 3, late: 0, missing: 0 },
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
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    },
    over,
  );
}

const QUALIFIER = {
  Emerging: /beginning to|early skill/,
  Developing: /growing consistency|More and more often/,
  Proficient: /consistently/,
  Extending: /depth and complexity/,
};
/* The student with three pieces of work, each scored on every competency,
   so the comment tells the whole term (not the thin story). */
const withWork = (levels, bank = true) => {
  const f = facts(levels, bank);
  f.work = [0, 1, 2].map(i => ({ id: 'w' + i, title: 'Task ' + i, d: day(i * 7), v: levels[0], pct: null, note: '' }));
  return f;
};
const overallOf = d => d.sentences.find(x => x.step === 'overall');

describe('where the student is now', () => {
  it('gives the first strength its phrase and level word', () => {
    const f = withWork([3.1, 2.4, 2]);
    const ctx = CommentBank.context(f, {});
    expect(ctx.strengthNow).toBe(comment['ss-evi'].phrase);
    expect(ctx._strengthWord).toBe('Proficient');
    expect(CommentBank.strengthNowOf(f).comp.id).toBe('c1');
  });

  it('says the phrase with the qualifier for each level, and the draft verifies', () => {
    [
      [[1.2, 0.6, 0.6], 'Emerging'],
      [[2.2, 1.4, 1.2], 'Developing'],
      [[3.1, 2.4, 2], 'Proficient'],
      [[3.8, 3, 2.4], 'Extending'],
    ].forEach(([levels, w]) => {
      const f = withWork(levels);
      for (let seed = 1; seed <= 6; seed++) {
        const d = CommentBank.draft(CommentBank.context(f, {}), { seed, quiet: true });
        const o = overallOf(d);
        expect(o && o.id, w + ' seed ' + seed).toMatch(/^wn\d\d$/);
        expect(o.text).toContain(comment['ss-evi'].phrase);
        expect(o.text, w).toMatch(QUALIFIER[w]);
        expect(CommentBank.verify(d, f, {}).replaced, w + ' seed ' + seed).toEqual([]);
      }
    });
  });

  it('is left out below the strongest gate and for a class not linked to the bank', () => {
    // Two pieces only: nothing is strongest.
    const thin = withWork([3.1, 2.4, 2]);
    thin.comps[0].scores = thin.comps[0].scores.slice(0, 2);
    expect(CommentBank.context(thin, {}).strengthNow).toBe('');
    const plain = withWork([3.1, 2.4, 2], false);
    expect(CommentBank.context(plain, {}).strengthNow).toBe('');
    const d = CommentBank.draft(CommentBank.context(plain, {}), { seed: 1, quiet: true });
    const o = overallOf(d);
    if (o) expect(o.id).not.toMatch(/^wn/);
  });

  it('fails verify() once the level word changes', () => {
    const f = withWork([3.1, 2.4, 2]);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1, quiet: true });
    const o = overallOf(d);
    const r = CommentBank.verify(d, withWork([3.8, 2.4, 2]), {});
    expect(r.replaced.map(x => x.sentenceId)).toContain(o.id);
  });
});
