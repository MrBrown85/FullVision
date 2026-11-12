/**
 * The pure parts of the differential run (scripts/differential-run.mjs):
 * its seeded sequence and its comparisons. The run itself drives a browser
 * and is not part of the test suite (docs/differential-run.md).
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '../scripts/differential/prng.mjs';
import { compareCalls, compareScreens, compareStorage, diffValues } from '../scripts/differential/compare.mjs';

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
