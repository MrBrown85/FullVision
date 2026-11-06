/**
 * The class's overall at the foot of the gradebook's Overall column, in the
 * Class Average row (a CSL reviewer, Nov 5: "Is it possible to get an
 * overall class average?"). It is classGradeSummary over the whole class,
 * the figure the dashboard's top bar shows, and nothing when no student has
 * an Overall yet.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cOv';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Test' },
  { id: 's2', firstName: 'Ben', lastName: 'Test' },
];
const quiz = { id: 'a1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, date: '2026-10-10', type: 'summative' };

function seed(scored) {
  COURSES[CID] = { id: CID, name: 'English 12', gradingSystem: 'letter' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = [quiz];
  _cache.scores[CID] = scored
    ? {
        s1: [{ assessmentId: 'a1', tagId: 'a1', score: 9, date: '2026-10-10', type: 'summative' }],
        s2: [{ assessmentId: 'a1', tagId: 'a1', score: 7, date: '2026-10-10', type: 'summative' }],
      }
    : { s1: [], s2: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('the gradebook Class Average row', () => {
  let stubDocument;

  function open(scored) {
    seed(scored);
    PageGradebook.init({ course: CID });
  }

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    );
    const doc = dom.document;
    const make = doc.createElement.bind(doc);
    doc.createElement = tag => {
      const el = make(tag);
      if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
      return el;
    };
    globalThis.document = doc;
    globalThis.CSS = { escape: s => String(s) };
    globalThis.getComputedStyle = () => ({});
    PageAssignments.graderOpen = () => false;
    runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
  });

  afterEach(() => {
    PageGradebook.destroy();
    globalThis.document = stubDocument;
  });

  it("shows the class's overall under the Overall column, as the dashboard does", () => {
    open(true);
    const cell = document.querySelector('.gb-scores-stats-head .gb-class-overall');
    expect(cell).not.toBeNull();
    const expected = classGradeSummary(CID, ['s1', 's2']).text;
    expect(expected).toMatch(/%/);
    expect(cell.textContent).toBe(expected);
    expect(cell.getAttribute('title')).toBe('The average of every student’s Overall');
  });

  it('shows nothing there before any student has an Overall', () => {
    open(false);
    expect(document.querySelector('.gb-scores-stats-head')).not.toBeNull();
    expect(document.querySelector('.gb-scores-stats-head .gb-class-overall')).toBeNull();
  });
});
