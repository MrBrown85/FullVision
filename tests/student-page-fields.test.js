/**
 * What a student's page can also be told (S4-M1,
 * migrations/2026111103_student_page_fields.sql). The SQL itself is tested on
 * a local Postgres (migrations/local-test/student_page_fields.py), which CI
 * does not run. These are the two places where that SQL repeats something
 * the app owns, checked here so they cannot drift apart unnoticed:
 *
 * 1. The Core Competency names it sends are CORE_COMPETENCIES' labels, in
 *    the same order (shared/constants.js).
 * 2. category_percent says what calc.js does. "Tests count 40% of your
 *    grade" is the category's weight in a class that shows a %; 0 for a
 *    category that weighs 0; nothing in a Proficiency class, for a DIBELS
 *    benchmark, or for work with no category.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SQL = readFileSync(resolve(ROOT, 'migrations/2026111103_student_page_fields.sql'), 'utf-8');

describe('S4-M1: the Core Competency names the page is sent', () => {
  it('are the labels in shared/constants.js, in its order', () => {
    const list = SQL.split("'core_competencies', coalesce((")[1].split('as cc(ord, id, name)')[0];
    const rows = [...list.matchAll(/\((\d+), '(\w+)',\s+'([^']+)'\)/g)].map(m => [Number(m[1]), m[2], m[3]]);
    expect(rows.map(r => r[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows.map(r => [r[1], r[2]])).toEqual(CORE_COMPETENCIES.map(c => [c.id, c.label]));
  });

  it('are the seven codes the database accepts on an assessment', () => {
    const allowed = readFileSync(resolve(ROOT, 'migrations/20261027_assessment_core_competencies.sql'), 'utf-8')
      .split('check (core_competency_ids <@ array[')[1]
      .split(']')[0];
    expect([...allowed.matchAll(/'(\w+)'/g)].map(m => m[1])).toEqual(CORE_COMPETENCIES.map(c => c.id));
  });
});

/* The rule the SQL holds, as the contract gives it for the browser
   (migrations/local-test/s4-m1-contract.md). */
function categoryPercent(cid, assessment) {
  const categories = getCategories(cid) || [];
  const category = getCategoryById(cid, assessment.categoryId);
  const total = categories.reduce((sum, c) => sum + Number(c.weight || 0), 0);
  if (!category || isDibelsScored(assessment)) return null;
  if (Number(category.weight) === 0) return 0;
  return courseGradeMode(cid) !== 'proficiency' && total === 100 ? Number(category.weight) : null;
}

describe('S4-M1: category_percent says what calc.js does', () => {
  const CID = 'page-fields';
  const SID = 'stu-1';
  const TEST = { id: 'a-test', title: 'Unit Test', scoreMode: 'points', maxPoints: 50, categoryId: 'k-tests' };
  const PROJECT = { id: 'a-proj', title: 'Project', scoreMode: 'points', maxPoints: 20, categoryId: 'k-proj' };
  const PRACTICE = { id: 'a-prac', title: 'Practice', scoreMode: 'points', maxPoints: 10, categoryId: 'k-prac' };
  const LOOSE = { id: 'a-loose', title: 'No Category', scoreMode: 'points', maxPoints: 10 };
  const BENCH = { id: 'a-bench', title: 'Fall Benchmark', scoreMode: 'dibels', categoryId: 'k-tests' };
  const points = (a, score) => ({ assessmentId: a.id, tagId: a.id, score, date: '2026-10-01' });

  function seed(gradingSystem, scores) {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem };
    _cache.courseConfigs[CID] = { roundPercent: false };
    _cache.categories[CID] = [
      { id: 'k-tests', name: 'Tests', weight: 40, displayOrder: 0 },
      { id: 'k-proj', name: 'Projects', weight: 60, displayOrder: 1 },
      { id: 'k-prac', name: 'Practice', weight: 0, displayOrder: 2 },
    ];
    _cache.rubrics[CID] = [];
    _cache.assessments[CID] = [TEST, PROJECT, PRACTICE, LOOSE, BENCH];
    _cache.scores[CID] = { [SID]: scores || [] };
    _cache.statuses[CID] = {};
    clearProfCache();
  }
  beforeEach(() => localStorage.clear());

  it.each(['letter', 'both'])('in a %s class a category carries its weight of the course %%', system => {
    // Full marks in Tests and nothing in Projects is 40%; the other way round is 60%.
    seed(system, [points(TEST, 50), points(PROJECT, 0)]);
    expect(getCourseLetterData(CID, SID).R).toBeCloseTo(categoryPercent(CID, TEST), 6);
    expect(categoryPercent(CID, TEST)).toBe(40);
    seed(system, [points(TEST, 0), points(PROJECT, 20)]);
    expect(getCourseLetterData(CID, SID).R).toBeCloseTo(categoryPercent(CID, PROJECT), 6);
    expect(categoryPercent(CID, PROJECT)).toBe(60);
  });

  it('a category that weighs 0 counts toward nothing, in every grading style', () => {
    for (const system of ['letter', 'both', 'proficiency']) {
      seed(system, [points(TEST, 25), points(PROJECT, 10)]);
      const before = getCourseLetterData(CID, SID).R;
      expect(countsTowardGrades(CID, PRACTICE)).toBe(false);
      expect(categoryPercent(CID, PRACTICE)).toBe(0);
      // Full marks on the practice piece move nothing.
      seed(system, [points(TEST, 25), points(PROJECT, 10), points(PRACTICE, 10)]);
      expect(getCourseLetterData(CID, SID).R).toBe(before);
    }
  });

  it('a Proficiency class shows no %, so a category that weighs something has no percent to state', () => {
    seed('proficiency', [points(TEST, 50)]);
    expect(assessmentCourseWorth(CID, TEST)).toBeNull();
    expect(categoryPercent(CID, TEST)).toBeNull();
  });

  it('work with no category, and a DIBELS benchmark, have none either', () => {
    seed('letter', [points(TEST, 50), points(PROJECT, 20)]);
    const before = getCourseLetterData(CID, SID).R;
    expect(assessmentCourseWorth(CID, LOOSE)).toEqual({ kind: 'uncategorized' });
    expect(categoryPercent(CID, LOOSE)).toBeNull();
    expect(assessmentCourseWorth(CID, BENCH)).toBeNull();
    expect(categoryPercent(CID, BENCH)).toBeNull();
    // Nothing on the uncategorized piece moves the course %.
    seed('letter', [points(TEST, 50), points(PROJECT, 20), points(LOOSE, 0)]);
    expect(getCourseLetterData(CID, SID).R).toBe(before);
  });

  it('the SQL holds the same four branches, in this order', () => {
    const rule = SQL.split("'category_percent', case")[1].split('end,')[0].replace(/\s+/g, ' ').trim();
    expect(rule).toBe(
      "when a.score_mode = 'dibels' then null when k.weight = 0 then 0 " +
        "when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight",
    );
  });
});
