/**
 * curriculum_by_course.json is built from data/ by
 * scripts/build-curriculum-bank.mjs and never edited by hand: it must equal
 * a fresh build (curriculum bank stage 6). curriculum-labels.test.js checks
 * curriculum_data.js matches it.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildBank } from '../scripts/build-curriculum-bank.mjs';

describe('the app bank', () => {
  it('is a fresh build of data/bc-curriculum-*.json', () => {
    const { bank, missing } = buildBank();
    expect(JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'))).toEqual(bank);
    expect(missing).toEqual([]);
  });

  it('holds every Ministry course for grades 8–12 and no dropped one', () => {
    const bank = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
    expect(Object.keys(bank)).toHaveLength(226);
    ['HUM8', 'ELA10', 'BIO12', 'PHE11', 'PHE12', 'CLE11', 'BCFP11', 'INDS11', 'PHYG11', 'WPM12'].forEach(k =>
      expect(bank[k], k).toBeUndefined(),
    );
  });
});
