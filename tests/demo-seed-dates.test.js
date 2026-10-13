/**
 * Demo Mode dates — shared/seed-data.js.
 *
 * The demo class is written as one term ending SEED_LAST_DAY and moved at
 * seed time so that day is yesterday. These tests cover the move and the
 * rule that keeps it correct: no date in the file is later than
 * SEED_LAST_DAY.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'shared/seed-data.js'), 'utf-8');
runInThisContext(source, { filename: 'shared/seed-data.js' });
// A top-level const isn't visible to this module, so read it from the source.
const SEED_LAST_DAY = source.match(/const SEED_LAST_DAY = '([\d-]+)'/)[1];

describe('shiftSeedDates', () => {
  it('moves dates and timestamps by whole days, leaving other strings alone', () => {
    const out = shiftSeedDates(
      {
        date: '2026-03-21',
        created: '2026-03-20T12:00:00.000Z',
        list: [{ date: '2025-12-31' }],
        id: 'st1',
        text: 'Lab on 2026-03-21',
        score: 3,
      },
      2,
    );
    expect(out).toEqual({
      date: '2026-03-23',
      created: '2026-03-22T12:00:00.000Z',
      list: [{ date: '2026-01-02' }],
      id: 'st1',
      text: 'Lab on 2026-03-21',
      score: 3,
    });
  });

  it('does not change what it was given', () => {
    const input = { date: '2026-03-21' };
    shiftSeedDates(input, 5);
    expect(input.date).toBe('2026-03-21');
  });
});

describe('seed timeline', () => {
  it('has no date later than SEED_LAST_DAY', () => {
    const dates = source.match(/'\d{4}-\d{2}-\d{2}/g).map(d => d.slice(1));
    expect(dates.filter(d => d > SEED_LAST_DAY)).toEqual([]);
  });
});

describe('seed scores', () => {
  it('scores every student on every assessment', () => {
    const start = source.indexOf('const sci8ScoreMap = {');
    const map = source.slice(start, source.indexOf('saveScores(', start));
    const rows = [...map.matchAll(/(sci8[a-z]\d+): \[([^\]]+)\]/g)];
    expect(rows.length).toBe(37);
    rows.forEach(([, id, list]) => {
      const values = list
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
        .map(Number);
      expect([id, values.length]).toEqual([id, 27]);
      expect([id, values.filter(v => v === 0).length]).toEqual([id, 0]);
    });
  });
});
