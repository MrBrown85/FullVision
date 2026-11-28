/**
 * The Work Habits switches (Colin, Nov 27): the teacher chooses which habits
 * the comment names. habitPlan follows the choice ({ on, off }, kept as
 * draft_meta.habit_choice): a habit switched on is named (in a sentence at
 * its rating that has room, else one of its own), a habit switched off is
 * not, and a plan with no choice is what it was.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const CB = CommentBank;
const keysOf = part => (part ? part.keys : []);
const named = plan =>
  []
    .concat(keysOf(plan.lead), keysOf(plan.more), ...(plan.extra || []).map(keysOf), plan.help)
    .filter((k, i, a) => a.indexOf(k) === i)
    .sort();

describe('habitPlan with the teacher’s choice', () => {
  const ratings = { completes: 4, ready: 4, others: 4, part: 4, feedback: 3, devices: 3 };

  it('is the plan it was with no choice', () => {
    const plain = CB.habitPlan(ratings, '', ratings);
    expect(CB.habitPlan(ratings, '', ratings, null)).toEqual(plain);
    expect(CB.habitPlan(ratings, '', ratings, { on: [], off: [] })).toEqual(plain);
  });

  it('leaves out a habit switched off, and the sentence when it was the only one', () => {
    const plan = CB.habitPlan(ratings, '', ratings, { on: [], off: ['completes'] });
    expect(named(plan)).not.toContain('completes');
    const one = { completes: 4, ready: 3 };
    const p2 = CB.habitPlan(one, '', one, { on: [], off: ['completes'] });
    expect(p2.lead && p2.lead.keys).not.toContain('completes');
    expect(named(p2)).toEqual(['ready']);
  });

  it('puts a habit switched on in the sentence at its rating that has room', () => {
    const r = { completes: 4, ready: 4, others: 3, part: 3 };
    const plain = CB.habitPlan(r, '', r);
    expect(named(plain)).toContain('others');
    const off = CB.habitPlan(r, '', r, { on: [], off: ['ready', 'completes'] });
    expect(named(off)).toEqual(['others', 'part']);
    const back = CB.habitPlan(r, '', r, { on: ['ready'], off: ['completes'] });
    expect(named(back)).toContain('ready');
    expect(named(back)).not.toContain('completes');
  });

  it('does not fold a habit switched on into another habit’s sentence: the page gives it its own', () => {
    const r = { completes: 4, ready: 4, others: 4, part: 4, feedback: 3 };
    const plan = CB.habitPlan(r, '', r, { on: ['part'], off: [] });
    expect(named(plan)).toEqual(named(CB.habitPlan(r, '', r)));
  });

  it('never names a habit that has no rating', () => {
    const r = { completes: 4 };
    const plan = CB.habitPlan(r, '', r, { on: ['ready'], off: [] });
    expect(named(plan)).toEqual(['completes']);
  });

  it('adds and removes habits in the grid’s order, in at most three per sentence', () => {
    const r = { completes: 4, ready: 4, others: 4, part: 4 };
    const two = [{ slot: 'habitsStrong', keys: ['completes', 'others'] }];
    const added = CB.habitChoice.add(two, r, '', 'ready');
    expect(added[0].keys).toEqual(['completes', 'ready', 'others']);
    expect(CB.habitChoice.add(added, r, '', 'part').map(p => [p.slot, p.keys])).toEqual([
      ['habitsStrong', ['completes', 'ready', 'others']],
      ['habitsStrongMore', ['part']],
    ]);
    expect(CB.habitChoice.add(two, r, '', 'part', ['habitsStrongMore'])[0].keys).toEqual([
      'completes',
      'others',
      'part',
    ]);
    expect(CB.habitChoice.remove(added, 'ready')[0].keys).toEqual(['completes', 'others']);
    expect(CB.habitChoice.remove([{ slot: 'habitsStrong', keys: ['completes'] }], 'completes')).toEqual([]);
  });

  it('words a part from the bank for the habits it names, and Generate follows the choice', () => {
    const hand = { completes: 4, ready: 4, others: 4, part: 3 };
    const f = {
      cid: 'c',
      sid: 's',
      name: 'Sam',
      first: 'Sam',
      course: 'Science 8',
      family: 'science',
      pronouns: { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' },
      pronounsOnFile: true,
      comps: [],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 0, handed: 0, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: hand,
      overall: 3,
      standing: '',
      letter: '',
      levelText: () => '',
      grade: { mode: 'letter', letter: 'B', pct: 80, next: null, pieces: [] },
      enrolled: '2026-09-03',
      classStart: '2026-09-03',
      termStart: '2026-09-03',
    };
    const pick = choice => ({ habits: hand, habitChoice: choice });
    const ctx = CB.context(f, pick({ on: ['part'], off: ['completes'] }));
    const only = CB.habitChoice.withPart(ctx, 'habitsStrong', ['ready']);
    expect(only._facts.habitsStrong).toEqual(['habit:ready']);
    expect(only.habitsStrong).not.toBe(ctx.habitsStrong);
    for (let seed = 1; seed <= 6; seed++) {
      const d = CB.draft(ctx, { seed });
      const said = d.provenance
        .filter(pv => /^(habits|habitsMore)$/.test(pv.step || ''))
        .concat(d.provenance)
        .reduce((a, pv) => a.concat(Object.keys(pv.sources || {}).reduce((b, k) => b.concat(pv.sources[k]), [])), []);
      expect(said).not.toContain('habit:completes');
      expect(CB.verify(d, f, pick({ on: ['part'], off: ['completes'] })).replaced).toEqual([]);
    }
  });
});
