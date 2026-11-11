/**
 * The student page's Overview tab: the grade now, the grade if the missing
 * work were handed in, and the work still to do.
 *
 * 1. calc.js: withMissingLeftOut is the same calculation with one
 *    student's Missing work read as Excused. It moves only that student,
 *    only the pieces named, shares no cached number with the real grade,
 *    and puts everything back after.
 * 2. The tab: opens by default, shows both grades in a Letter class, sorts
 *    the missing work by what handing it in adds, hides the projection when
 *    too little is marked, and never shows it in a Proficiency class.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cOV';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Test', designations: [] },
  { id: 's2', firstName: 'Ben', lastName: 'Test', designations: [] },
];
const pts = (id, title, max, date) => ({
  id,
  title,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: ['T1'],
  date,
  type: 'summative',
});
const ASSESSMENTS = [
  pts('q1', 'Quiz One', 10, '2026-10-01'),
  pts('q2', 'Quiz Two', 10, '2026-10-05'),
  pts('m1', 'Short Response', 10, '2026-10-10'),
  pts('m2', 'Source Essay', 20, '2026-10-20'),
];
const entry = (aid, score) => ({ assessmentId: aid, tagId: 'T1', score, date: '2026-10-10', note: '' });

function seed(gradingSystem, statuses, scores) {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem, gradeLevel: '12' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = scores || { s1: [entry('q1', 9), entry('q2', 7)], s2: [entry('q1', 5), entry('q2', 5)] };
  _cache.statuses[CID] = statuses || { 's1:m1': 'NS', 's1:m2': 'NS', 's2:m1': 'NS' };
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

/* ── 1. calc.js ──────────────────────────────────────────────── */

describe('withMissingLeftOut', () => {
  beforeEach(() => {
    localStorage.clear();
    seed('letter');
  });

  it('counts Missing as 0 normally, and leaves it out inside', () => {
    // 16 of 50 points with both Missing pieces at 0.
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
    const all = withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's1'));
    expect(all.R).toBe(80); // 16 of 20
    const one = withMissingLeftOut('s1', ['m1'], () => getCourseLetterData(CID, 's1'));
    expect(one.R).toBe(40); // 16 of 40: the essay still counts as 0
  });

  it('gives the same grade as marking those pieces Excused', () => {
    const left = withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's1'));
    seed('letter', { 's1:m1': 'EXC', 's1:m2': 'EXC', 's2:m1': 'NS' });
    expect(getCourseLetterData(CID, 's1')).toEqual(left);
  });

  it('moves only the student named', () => {
    const ben = getCourseLetterData(CID, 's2').R;
    const inside = withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's2').R);
    expect(inside).toBe(ben);
  });

  it('shares no cached number with the real grade, and puts the state back', () => {
    withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's1'));
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
    expect(() =>
      withMissingLeftOut('s1', null, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
  });

  it('refuses work that does not finish at once', () => {
    expect(() => withMissingLeftOut('s1', null, () => Promise.resolve(1))).toThrow(/does not finish at once/);
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
  });
});

/* ── 2. The tab ──────────────────────────────────────────────── */

describe('the Overview tab', () => {
  let stubDocument;
  let doc;

  function open(params) {
    PageStudent.init(Object.assign({ id: 's1', course: CID }, params || {}));
    return doc.getElementById('main');
  }

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.requestAnimationFrame = fn => fn();
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    seed('letter');
  });

  afterEach(() => {
    if (window.PageStudent) PageStudent.destroy();
    globalThis.document = stubDocument;
  });

  it('is the first tab and opens when no tab was saved', () => {
    const main = open();
    const tabs = Array.from(main.querySelectorAll('.stu-tab'));
    expect(tabs[0].textContent).toContain('Overview');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(main.querySelector('.stu-ov')).not.toBeNull();
  });

  it('shows the grade now and the grade if the missing work is handed in', () => {
    const main = open();
    const now = main.querySelector('.stu-ov-now').textContent;
    const proj = main.querySelector('.stu-ov-proj').textContent;
    expect(now).toContain('32%');
    expect(proj).toContain('80%');
    expect(main.querySelector('.stu-ov-miss').textContent).toContain('Costing you 48%');
    expect(main.querySelector('.stu-tab').textContent).toContain('2 Missing');
  });

  it('lists the missing work by what handing it in adds', () => {
    const main = open();
    const titles = Array.from(main.querySelectorAll('.stu-ov-todo-title')).map(n => n.textContent);
    // The essay (20 points) adds more than the short response (10).
    expect(titles).toEqual(['Source Essay', 'Short Response']);
    expect(main.querySelector('.stu-ov-start').closest('li').textContent).toContain('Source Essay');
  });

  it('opens a piece of work in place', () => {
    let main = open();
    main.querySelector('.stu-ov-row-btn[data-aid="m2"]').click();
    main = doc.getElementById('main');
    const row = main.querySelector('#stu-ov-row-m2');
    expect(row.classList.contains('open')).toBe(true);
    expect(row.querySelector('.stu-ov-facts').textContent).toContain('Adds About');
  });

  it('shows no projection when under a third of the work is marked', () => {
    seed('letter', { 's1:q2': 'NS', 's1:m1': 'NS', 's1:m2': 'NS' }, { s1: [entry('q1', 9)], s2: [] });
    const main = open();
    expect(main.querySelector('.stu-ov-thin')).not.toBeNull();
    expect(main.querySelector('.stu-ov-gain')).toBeNull();
    expect(main.querySelector('.stu-ov-miss').textContent).not.toContain('Costing');
  });

  it('shows no projection in a Proficiency class, where Missing is left out already', () => {
    seed('proficiency');
    const main = open();
    expect(main.querySelector('.stu-ov-proj')).toBeNull();
    expect(main.querySelector('.stu-ov-lede').textContent).not.toContain('counts as 0');
  });
});
