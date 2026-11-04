/**
 * In a Letter class Missing counts as 0 in every column's Class Average
 * (DECISIONS, Class Averages and statuses 7). A proficiency column whose
 * counted students are all Missing averages 0, but the gradebook, the
 * printed grade sheet and the CSV export printed "—", the mark for a column
 * nobody counts in (Nov 3 bug sweep). They now print 0%, also where the
 * column prints proficiency figures (Colin, 2026-11-03: as the screen does).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cL';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Test' },
  { id: 's2', firstName: 'Ben', lastName: 'Test' },
];
const essay = {
  id: 'a1',
  title: 'Essay',
  scoreMode: 'proficiency',
  tagIds: ['T1'],
  date: '2026-10-10',
  type: 'summative',
};

function seed(gradingSystem) {
  COURSES[CID] = { id: CID, name: 'English 12', gradingSystem };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = [essay];
  _cache.scores[CID] = { s1: [], s2: [] };
  _cache.statuses[CID] = { 's1:a1': 'NS', 's2:a1': 'NS' };
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('a Letter column whose counted students are all Missing', () => {
  beforeEach(() => {
    localStorage.clear();
    seed('letter');
  });

  it('averages 0 and reads 0%', () => {
    const res = classColumnAverage(CID, STUDENTS, { assessment: essay });
    expect(res).toEqual({ avg: 0, count: 2 });
    expect(classColumnAverageText(CID, essay, res)).toBe('0%');
  });

  it('prints 0% on the grade sheet, as percent or as proficiency', () => {
    const col = { id: 'a1', assessment: essay };
    expect(GradesPrint.columnAverageText(CID, STUDENTS, col, { scoresAs: 'percent' })).toBe('0%');
    expect(GradesPrint.columnAverageText(CID, STUDENTS, col, { scoresAs: 'proficiency' })).toBe('0%');
  });

  it('still reads "—" in a Proficiency class, where Missing is left out', () => {
    seed('proficiency');
    expect(classColumnAverage(CID, STUDENTS, { assessment: essay })).toBeNull();
    expect(GradesPrint.columnAverageText(CID, STUDENTS, { id: 'a1', assessment: essay }, {})).toBe('—');
  });
});

describe('the gradebook and its CSV', () => {
  let stubDocument;
  let csv;
  const originalBlob = globalThis.Blob;
  const originalUrl = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

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
      if (tag === 'a') el.click = () => {};
      return el;
    };
    globalThis.document = doc;
    globalThis.CSS = { escape: s => String(s) };
    globalThis.getComputedStyle = () => ({});
    globalThis.Blob = function (parts) {
      csv = parts.join('');
    };
    URL.createObjectURL = () => 'blob:csv';
    URL.revokeObjectURL = () => {};
    PageAssignments.graderOpen = () => false;
    runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
    seed('letter');
    PageGradebook.init({ course: CID });
  });

  afterEach(() => {
    PageGradebook.destroy();
    globalThis.document = stubDocument;
    globalThis.Blob = originalBlob;
    URL.createObjectURL = originalUrl;
    URL.revokeObjectURL = originalRevoke;
  });

  it('shows 0% as the Scores view Class Average', () => {
    const avg = document.querySelector('.gb-scores-stats .gb-avg-val');
    expect(avg.textContent).toBe('0%');
  });

  it('exports 0% as the Class Average, as the screen shows it', () => {
    const btn = document.querySelector('[data-action="exportScoresCSV"]');
    btn.dispatchEvent(new document.defaultView.Event('click', { bubbles: true, cancelable: true }));
    const last = csv.split('\n').pop();
    expect(last.split(',').pop()).toBe('"0%"');
  });
});
