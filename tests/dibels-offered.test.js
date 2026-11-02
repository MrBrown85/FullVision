/**
 * Where the DIBELS 8 Benchmark is offered (docs/DECISIONS.md, 2026-11-02):
 * classes linked to Social Studies 8 or any English Language Arts course,
 * so Humanities 8 (ELA 8 + SS 8) has it. Decided by the linked courses, not
 * the class name. DIBELS work only copies to classes that offer it.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BANK = JSON.parse(readFileSync(new URL('../curriculum_by_course.json', import.meta.url), 'utf8'));

describe('the classes offered DIBELS', () => {
  it('lists Social Studies 8 and every English Language Arts course in the bank', () => {
    const ela = Object.keys(BANK).filter(k => BANK[k].subject === 'English Language Arts');
    expect(ela.length).toBeGreaterThan(20);
    expect(DIBELS_COURSE_TAGS.slice().sort()).toEqual(['SS8'].concat(ela).sort());
    DIBELS_COURSE_TAGS.forEach(t => expect(BANK[t]).toBeTruthy());
  });

  it('goes by the linked courses', () => {
    expect(courseOffersDibels({ curriculumTags: ['ELA8', 'SS8'] })).toBe(true);
    expect(courseOffersDibels({ curriculumTags: ['SS8'] })).toBe(true);
    expect(courseOffersDibels({ curriculumTags: ['ES12'] })).toBe(true);
    expect(courseOffersDibels({ curriculumTags: ['EFP12'] })).toBe(true);
    expect(courseOffersDibels({ curriculumTags: ['SCI8'] })).toBe(false);
    expect(courseOffersDibels({ curriculumTags: ['SS9'] })).toBe(false);
    expect(courseOffersDibels({ curriculumTags: ['HIST12'] })).toBe(false);
    // An unlinked class isn't offered it, whatever its name.
    expect(courseOffersDibels({ name: 'Humanities 8' })).toBe(false);
    expect(courseOffersDibels(null)).toBe(false);
  });
});

describe('copying DIBELS work', () => {
  const HUM = 'cls-hum8';
  const ENG = 'cls-eng12';
  const SCI = 'cls-sci8';
  var originalInit;
  const dibels = () => ({
    id: 'asm-d',
    title: 'Fall DIBELS',
    date: '2026-10-03',
    dateAssigned: '2026-10-03',
    scoreMode: 'dibels',
    maxPoints: 0,
    tagIds: [],
    copyGroup: 'grp-d',
  });

  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    originalInit = globalThis.initData;
    globalThis.initData = () => Promise.resolve();
    saveCourses({
      [HUM]: { id: HUM, name: 'Humanities 8', curriculumTags: ['ELA8', 'SS8'] },
      [ENG]: { id: ENG, name: 'English Studies 12', curriculumTags: ['ES12'] },
      [SCI]: { id: SCI, name: 'Science 8', curriculumTags: ['SCI8'] },
    });
    [HUM, ENG, SCI].forEach(cid => {
      _cache.categories[cid] = [];
      _cache.learningMaps[cid] = { subjects: [], sections: [], _customized: true, _version: 1 };
      _cache.rubrics[cid] = [];
      _cache.modules[cid] = [];
      _cache.assessments[cid] = [];
    });
  });

  afterEach(() => {
    globalThis.initData = originalInit;
  });

  it('adds it to classes that offer DIBELS and not to the others', async () => {
    var a = dibels();
    _cache.assessments[HUM] = [a];
    var plans = await AssessmentCopy.copyToClasses(HUM, a, [{ cid: ENG }, { cid: SCI }]);
    expect(plans.map(p => p.dstCid)).toEqual([ENG]);
    expect(getAssessments(ENG).map(x => x.scoreMode)).toEqual(['dibels']);
    expect(getAssessments(SCI)).toEqual([]);
  });

  it('adds nothing when no class offers DIBELS', async () => {
    var a = dibels();
    _cache.assessments[HUM] = [a];
    expect(await AssessmentCopy.copyToClasses(HUM, a, [{ cid: SCI }])).toEqual([]);
    expect(getAssessments(SCI)).toEqual([]);
  });

  it('a linked edit to DIBELS leaves the scoring of a copy in a class without it', () => {
    var before = Object.assign(dibels(), { scoreMode: 'points', maxPoints: 20 });
    var after = dibels();
    var copy = Object.assign({}, before, { id: 'sci-1' });
    var plan = AssessmentCopy.planLinkedEdit(HUM, before, after, SCI, copy);
    expect(plan.patch.scoreMode).toBeUndefined();
    expect(plan.skipped).toContain('scoring mode');
    var ok = AssessmentCopy.planLinkedEdit(HUM, before, after, ENG, Object.assign({}, copy, { id: 'eng-1' }));
    expect(ok.patch.scoreMode).toBe('dibels');
  });
});
