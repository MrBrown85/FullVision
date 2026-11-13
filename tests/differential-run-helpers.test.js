/* global Grader, getScores, window -- named inside functions that are only read as text, never run. */
/**
 * The pure parts of the differential run (scripts/differential-run.mjs):
 * its seeded sequence and its comparisons. The run itself drives a browser
 * and is not part of the test suite (docs/differential-run.md).
 */
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../scripts/differential/args.mjs';
import { makeRng } from '../scripts/differential/prng.mjs';
import { readFileSync } from 'node:fs';
import {
  compareCalls,
  compareScreens,
  compareStorage,
  compareViews,
  diffValues,
} from '../scripts/differential/compare.mjs';
import { fingerprint, firstUnlike, watch } from '../scripts/differential/given.mjs';

describe('makeRng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true);
  });

  it('gives a different sequence for another seed', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });

  it('picks by weight and never picks a zero weight', () => {
    const rng = makeRng(3);
    const seen = new Set();
    for (let i = 0; i < 200; i++)
      seen.add(
        rng.weighted([
          { k: 'a', weight: 1 },
          { k: 'b', weight: 0 },
          { k: 'c', weight: 5 },
        ]).k,
      );
    expect([...seen].sort()).toEqual(['a', 'c']);
  });
});

describe('compareStorage', () => {
  it('finds nothing when the text is the same', () => {
    expect(compareStorage({ k: '{"a":1}' }, { k: '{"a":1}' })).toEqual([]);
  });

  it('names a value that differs, with its path', () => {
    const lines = compareStorage({ 'gb-scores-c': '{"s1":[{"score":3}]}' }, { 'gb-scores-c': '{"s1":[{"score":2}]}' });
    expect(lines.join('\n')).toContain('s1[0].score  A: 3  B: 2');
  });

  it('counts the same values saved in another order as a difference', () => {
    expect(compareStorage({ k: '{"a":1,"b":2}' }, { k: '{"b":2,"a":1}' })[0]).toContain('different order');
  });

  it('names a key only one side has', () => {
    expect(compareStorage({ x: '1' }, {})[0]).toContain('only in A');
  });
});

describe('compareCalls', () => {
  const call = (name, params) => ({ tab: 'tab1', name, params });

  it('finds nothing when the calls and their order are the same', () => {
    expect(compareCalls([call('a', { p: 1 })], [call('a', { p: 1 })])).toEqual([]);
  });

  it('catches two calls in the other order', () => {
    const lines = compareCalls([call('a', {}), call('b', {})], [call('b', {}), call('a', {})]);
    expect(lines[0]).toContain('server call 1');
  });

  it('catches a call one side did not make', () => {
    expect(compareCalls([call('a', {})], []).join('\n')).toContain('B made no call here');
  });

  it('catches a parameter that differs', () => {
    expect(compareCalls([call('a', { p_value: 3 })], [call('a', { p_value: 4 })]).join('\n')).toContain('p_value');
  });
});

describe('compareScreens', () => {
  it('shows the first line that differs', () => {
    const lines = compareScreens({ s: 'one\ntwo\nthree' }, { s: 'one\ntwo\nfour' });
    expect(lines.join('\n')).toContain('line 3');
    expect(lines.join('\n')).toContain('A: three');
  });
});

describe('diffValues', () => {
  it('stops after the limit', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    expect(
      diffValues(
        a,
        a.map(x => x + 1),
        '',
        [],
        5,
      ),
    ).toHaveLength(5);
  });
});

describe('parseArgs', () => {
  it('reads the options', () => {
    const o = parseArgs(['--a', 'x', '--b', 'y', '--seed', '7', '--steps', '600', '--offline', '--two-tabs']);
    expect(o).toMatchObject({ a: 'x', b: 'y', seed: 7, steps: 600, offline: true, twoTabs: true, mode: 'both' });
  });

  it('refuses a seed that is not a whole number', () => {
    for (const bad of ['7 a', '', 'seven', '1e3', '-1', '1.5', ' 7', '0x10']) {
      expect(() => parseArgs(['--seed', bad]), bad).toThrow(/--seed takes a whole number/);
    }
    expect(() => parseArgs(['--seed'])).toThrow(/--seed needs a value/);
  });

  it('refuses steps and screens-every that are not whole numbers', () => {
    expect(() => parseArgs(['--steps', '10x'])).toThrow(/--steps takes a whole number of 1 or more/);
    expect(() => parseArgs(['--steps', '0'])).toThrow(/--steps takes a whole number of 1 or more/);
    expect(() => parseArgs(['--screens-every', 'often'])).toThrow(/--screens-every takes a whole number/);
    expect(parseArgs(['--screens-every', '0']).screensEvery).toBe(0);
  });

  it('refuses a mode it does not know and an option it does not know', () => {
    expect(() => parseArgs(['--mode', 'signedin'])).toThrow(/--mode is signed-in, demo or both/);
    expect(() => parseArgs(['--sed', '1'])).toThrow(/Unknown option --sed/);
  });
});

describe('lists of entries with ids', () => {
  const entry = (id, tagId, score = 2) => ({ id, assessmentId: 'a2', tagId, score, date: '2026-05-12' });

  it('names an entry whose key changed, not every entry after it', () => {
    const a = { st1: [entry('e1', 'CM1'), entry('e2', 'c1', 3), entry('e3', 'c2', 1)] };
    const b = { st1: [entry('e9', 'PA5'), entry('e2', 'c1', 3), entry('e3', 'c2', 1)] };
    const lines = compareStorage({ k: JSON.stringify(a) }, { k: JSON.stringify(b) });
    expect(lines).toEqual([
      'localStorage k:',
      '  st1[e1 in A, e9 in B].id  A: "e1"  B: "e9"',
      '  st1[e1 in A, e9 in B].tagId  A: "CM1"  B: "PA5"',
    ]);
  });

  it('names an entry only one side has', () => {
    const a = [entry('e1', 'CM1'), entry('e2', 'c1', 3)];
    const lines = compareStorage({ k: JSON.stringify(a) }, { k: JSON.stringify(a.slice(1)) });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('[e1]  A: {"id":"e1"');
    expect(lines[1]).toContain('B: nothing');
  });

  it('names a field that differs by the entry’s id', () => {
    const lines = compareStorage(
      { k: JSON.stringify([entry('e1', 'CM1', 3), entry('e2', 'c1')]) },
      { k: JSON.stringify([entry('e1', 'CM1', 2), entry('e2', 'c1')]) },
    );
    expect(lines[1]).toBe('  [e1].score  A: 3  B: 2');
  });

  it('says so when the same entries are in another order', () => {
    const a = [entry('e1', 'CM1'), entry('e2', 'c1', 3)];
    const lines = compareStorage({ k: JSON.stringify(a) }, { k: JSON.stringify([a[1], a[0]]) });
    expect(lines.join('\n')).toContain('the order of its entries, from place 1');
  });

  it('compares a list without ids place by place, as before', () => {
    expect(diffValues([1, 2, 3], [1, 5, 3])).toEqual([{ path: '[1]', a: 2, b: 5 }]);
  });
});

describe('compareViews', () => {
  it('finds nothing in two views that are the same, and names what differs', () => {
    const view = { cid: 'c', drafts: { a1: ['s1'] } };
    expect(compareViews(view, structuredClone(view))).toEqual([]);
    expect(compareViews(view, { cid: 'c', drafts: {} }).join('\n')).toContain('drafts.a1');
  });
});

describe('the run asks both builds the same things', () => {
  it('notes what a page is asked, the run’s own waiting aside', () => {
    const settle = () => window.__diffPending;
    const read = () => getScores('c');
    expect(fingerprint(settle)).toBeNull();
    expect(fingerprint(read)).toContain("getScores('c')");
    expect(fingerprint(read, { a: 1 })).not.toBe(fingerprint(read, { a: 2 }));
    expect(fingerprint(read, { a: 1 })).toBe(fingerprint(read, { a: 1 }));
  });

  it('catches a read made of one build and not the other', async () => {
    const page = given => watch({ evaluate: async () => 'ok' }, given, () => 'tab 1');
    const a = [];
    const b = [];
    const readView = () => getScores('c');
    const act = () => Grader.setLevel('c');
    // The fault the tool had: the class was read in A alone before each step.
    await page(a).evaluate(readView);
    await page(a).evaluate(act, { level: 3 });
    await page(b).evaluate(act, { level: 3 });
    const unlike = firstUnlike(a, b);
    expect(unlike.at).toBe(1);
    expect(unlike.a).toContain('getScores');
    expect(unlike.b).toContain('Grader.setLevel');
    // Read in both, the two are the same.
    b.unshift(a[0]);
    expect(firstUnlike(a, b)).toBeNull();
  });

  it('catches the same call with another argument, and one call more', () => {
    const act = () => Grader.setLevel('c');
    const one = [fingerprint(act, { level: 3 })];
    expect(firstUnlike(one, [fingerprint(act, { level: 4 })]).at).toBe(1);
    expect(firstUnlike(one, [...one, 'tab 1: more'])).toMatchObject({ at: 2, a: '(nothing more)' });
  });

  it('has no read of one build alone in the run', () => {
    const src = readFileSync(new URL('../scripts/differential-run.mjs', import.meta.url), 'utf-8');
    // A page of sides[0] or sides[1] is never handed to a reader or asked
    // anything on its own: every read goes through both().
    expect(src).not.toMatch(/\b(read\w+|take\w+|go|tick|phoneRun)\(\s*sides\[[01]\]/);
    expect(src).not.toMatch(/sides\[[01]\](\.\w+|\[\w+\])\.(evaluate|locator|screenshot|reload|goto|keyboard)\b/);
    expect(src).toMatch(/both\(s => readView\(s\[name\]\)\)/);
  });
});
