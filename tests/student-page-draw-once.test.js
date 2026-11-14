/**
 * The teacher's page for one student works each tab's figures out once a
 * draw (docs/plans/speed-assessment.md, section 7, S1).
 *
 * Counted, not timed. The Overview's model costs one getCourseLetterData,
 * plus one more and one per missing piece when the grade if handed in
 * shows (withMissingLeftOut). It was worked out for the tab's Missing badge
 * on every draw, whatever the tab, and again by the Overview and Grades
 * tabs. The student's answers (StudentVoice.profile) and Reflect on
 * Feedback (LearnerProfile.feedbackOf) were worked out for the Learner
 * Profile's badge and again by the Learner Profile tab. Now: the badge
 * counts the missing work alone, the model is made once and only on the
 * two tabs that show it, the answers once a draw, and Reflect on Feedback
 * in full only on the Learner Profile (its two counts elsewhere).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cDO';
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

function seed() {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = { s1: [entry('q1', 9), entry('q2', 7)], s2: [entry('q1', 5), entry('q2', 5)] };
  _cache.statuses[CID] = { 's1:m1': 'NS', 's1:m2': 'NS', 's2:m1': 'NS' };
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('the student page draws each figure once', () => {
  let stubDocument;
  let doc;
  let real;
  let count;

  const spy = (owner, name) => {
    real.push([owner, name, owner[name]]);
    const fn = owner[name];
    owner[name] = function () {
      count[name] = (count[name] || 0) + 1;
      return fn.apply(this, arguments);
    };
  };

  // One draw of a tab, and what it cost.
  function draw(tab) {
    PageStudent.destroy();
    PageStudent.init({ id: 's1', course: CID, tab });
    count = {};
    PageStudent.render();
    return Object.assign(
      { getCourseLetterData: 0, withMissingLeftOut: 0, profile: 0, feedbackOf: 0, feedbackCounts: 0 },
      count,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.requestAnimationFrame = fn => fn();
    real = [[globalThis, 'isDemoMode', globalThis.isDemoMode]];
    globalThis.isDemoMode = () => true; // the student's answers are read on the device, at once
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    seed();
    count = {};
    spy(globalThis, 'getCourseLetterData');
    spy(globalThis, 'withMissingLeftOut');
    spy(StudentVoice, 'profile');
    spy(LearnerProfile, 'feedbackOf');
    if (LearnerProfile.feedbackCounts) spy(LearnerProfile, 'feedbackCounts');
  });

  afterEach(() => {
    real.reverse().forEach(([owner, name, fn]) => {
      owner[name] = fn;
    });
    if (window.PageStudent) PageStudent.destroy();
    globalThis.document = stubDocument;
  });

  it('the Overview works its grades out once, not twice', () => {
    // The grade now, the grade with both missing pieces in, and each one alone: 4. It was 8.
    const n = draw('overview');
    expect(n.withMissingLeftOut).toBe(3);
    expect(n.getCourseLetterData).toBe(4 + 1); // and once for the header's grade pill
    expect(doc.querySelector('#stu-tab-overview .stu-tab-badge').textContent).toBe('2 Missing');
  });

  it('the Grades tab works them out once', () => {
    const n = draw('grades');
    expect(n.withMissingLeftOut).toBe(3);
    expect(n.getCourseLetterData).toBe(4 + 2); // and the header's pill, and the tab's own course row
  });

  it('a tab that shows no grades works none of the Overview out; the badge still counts', () => {
    for (const tab of ['comps', 'evidence', 'profile']) {
      const n = draw(tab);
      expect(n.withMissingLeftOut, tab).toBe(0);
      expect(n.getCourseLetterData, tab).toBe(1); // the header's pill only
      expect(doc.querySelector('#stu-tab-overview .stu-tab-badge').textContent, tab).toBe('2 Missing');
    }
  });

  it('the Learner Profile reads the answers and Reflect on Feedback once', () => {
    const n = draw('profile');
    expect(n.profile).toBe(1);
    expect(n.feedbackOf).toBe(1);
    expect(n.feedbackCounts).toBe(0);
  });

  it('another tab reads the answers once and only the two feedback counts', () => {
    const n = draw('overview');
    expect(n.profile).toBe(1);
    expect(n.feedbackOf).toBe(0);
    expect(n.feedbackCounts).toBe(1);
  });
});

describe('LearnerProfile.feedbackCounts', () => {
  it('gives feedbackOf’s count and waiting, or null while Reflect on Feedback is off', () => {
    const was = globalThis.getReflectOnFeedback;
    try {
      globalThis.getReflectOnFeedback = () => false;
      expect(LearnerProfile.feedbackCounts('cX', 's1')).toBeNull();
      expect(LearnerProfile.feedbackOf('cX', 's1')).toBeNull();
    } finally {
      globalThis.getReflectOnFeedback = was;
    }
  });
});
