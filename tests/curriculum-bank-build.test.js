/**
 * curriculum_by_course.json is built from data/ by
 * scripts/build-curriculum-bank.mjs and never edited by hand: it must equal
 * a fresh build (curriculum bank stage 6). curriculum-labels.test.js checks
 * curriculum_data.js matches it.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildBank, buildComment, buildCore, buildProficiency } from '../scripts/build-curriculum-bank.mjs';

describe('the app bank', () => {
  it('is a fresh build of data/bc-curriculum-*.json', () => {
    const { bank, missing } = buildBank();
    expect(JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'))).toEqual(bank);
    expect(missing).toEqual([]);
  });

  it('ships the comment phrases as a fresh build of data/bc-curriculum-comment.json', () => {
    const js = readFileSync('shared/bank-comment.js', 'utf-8');
    const shipped = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf(';')));
    expect(shipped).toEqual(buildComment());
    expect(Object.keys(shipped.ids)).toHaveLength(5029);
  });

  it('ships the Core Competencies as a fresh build of data/bc-core-competencies.json', () => {
    const js = readFileSync('shared/bank-core-competencies.js', 'utf-8');
    const shipped = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf(';')));
    expect(shipped).toEqual(buildCore());
    expect(Object.keys(shipped).sort()).toEqual(['COL', 'COM', 'CRT', 'CT', 'PAR', 'PPI', 'SAR']);
    // The first sentence, word for word.
    const core = JSON.parse(readFileSync('data/bc-core-competencies.json', 'utf-8'));
    expect(core.COL.description[0].startsWith(shipped.COL.description)).toBe(true);
    expect(shipped.COL.description.endsWith('.')).toBe(true);
  });

  it('ships the level descriptors as a fresh build of data/bc-curriculum-proficiency.json', () => {
    const js = readFileSync('shared/bank-proficiency.js', 'utf-8');
    const shipped = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf(';')));
    expect(shipped).toEqual(buildProficiency());
    expect(Object.keys(shipped.ids)).toHaveLength(5029);
    // Each set is Emerging, Developing, Proficient, Extending, in that order.
    const prof = JSON.parse(readFileSync('data/bc-curriculum-proficiency.json', 'utf-8'));
    const id = 'bc.ss10.cc.1';
    expect(shipped.levels[shipped.ids[id]]).toEqual([
      prof[id].levels.emerging,
      prof[id].levels.developing,
      prof[id].levels.proficient,
      prof[id].levels.extending,
    ]);
  });

  it('holds every Ministry course for grades 8–12 and no dropped one', () => {
    const bank = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
    expect(Object.keys(bank)).toHaveLength(226);
    ['HUM8', 'ELA10', 'BIO12', 'PHE11', 'PHE12', 'CLE11', 'BCFP11', 'INDS11', 'PHYG11', 'WPM12'].forEach(k =>
      expect(bank[k], k).toBeUndefined(),
    );
  });
});
