/**
 * The Competencies tab on the teacher's page for one student builds a
 * competency's evidence drawer when it opens, not on every draw
 * (docs/plans/speed-assessment.md, section 7, S2).
 *
 * Counted, not timed. Every card drew its drawer in full, closed or open:
 * the evidence worked out twice (the row's count and the drawer) and every
 * score and observation drawn as a row. Now a closed drawer is drawn empty
 * and built as its row is pressed; the evidence is worked out once a card;
 * and the class is sorted once a draw for ‹ and › (it was sorted twice).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cDR';
const SECS = ['A', 'B', 'C', 'D'].map(k => ({
  id: 'sec' + k,
  name: 'Competency ' + k,
  tags: [{ id: 'T' + k, label: 'Tag ' + k }],
}));
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Adams', designations: [] },
  { id: 's2', firstName: 'Ben', lastName: 'Brown', designations: [] },
  { id: 's3', firstName: 'Cy', lastName: 'Chan', designations: [] },
];
const ASSESSMENTS = SECS.map((s, i) => ({
  id: 'a' + i,
  title: 'Lab ' + i,
  scoreMode: 'proficiency',
  tagIds: [s.tags[0].id],
  date: '2026-10-0' + (i + 1),
  type: 'summative',
}));

function seed() {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'proficiency', gradeLevel: '9' };
  _cache.students[CID] = STUDENTS;
  _cache.learningMaps[CID] = { subjects: [], sections: SECS, competencyGroups: [], _customized: true, _version: 1 };
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = {
    s2: ASSESSMENTS.map((a, i) => ({ assessmentId: a.id, tagId: a.tagIds[0], score: 2 + (i % 2), date: a.date })),
  };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('the Competencies tab builds a drawer when it opens', () => {
  let stubDocument;
  let doc;
  let real;
  let count;
  const spy = name => {
    const fn = globalThis[name];
    real.push([name, fn]);
    globalThis[name] = function () {
      count[name] = (count[name] || 0) + 1;
      return fn.apply(this, arguments);
    };
  };

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.requestAnimationFrame = fn => fn();
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    seed();
    real = [];
    count = {};
    spy('getStudentQuickObs');
    spy('sortStudents');
  });

  afterEach(() => {
    real.forEach(([name, fn]) => {
      globalThis[name] = fn;
    });
    if (window.PageStudent) PageStudent.destroy();
    globalThis.document = stubDocument;
  });

  function open() {
    PageStudent.init({ id: 's2', course: CID, tab: 'comps' });
    count = {};
    PageStudent.render();
    return doc.getElementById('main');
  }

  it('draws closed drawers empty, with their counts, and works each card’s evidence out once', () => {
    const main = open();
    expect(main.querySelectorAll('.ced')).toHaveLength(4);
    expect(main.querySelectorAll('.ced[data-ced-later]')).toHaveLength(4);
    expect(main.querySelectorAll('.ced-list, .ced-item')).toHaveLength(0); // was 4 lists and 4 rows
    // One read for the page's observations, then one a card (was two a card: 9).
    expect(count.getStudentQuickObs).toBe(1 + 4);
    expect(
      Array.from(main.querySelectorAll('.dash-tag-evidence')).map(n => n.textContent),
      'the rows still count their evidence',
    ).toEqual(['1 score', '1 score', '1 score', '1 score']);
    // Each drawer is still the row's aria-controls.
    main.querySelectorAll('.dash-tag-row').forEach(row => {
      expect(doc.getElementById(row.getAttribute('aria-controls'))).not.toBeNull();
    });
  });

  it('sorts the class once a draw for ‹ and ›', () => {
    const main = open();
    expect(count.sortStudents).toBe(1); // was 2
    const [prev, next] = main.querySelectorAll('.stu-step-btn');
    expect(prev.dataset.sid).toBe('s1');
    expect(next.dataset.sid).toBe('s3');
  });

  it('builds a drawer as its row is pressed, and draws an open one in full', () => {
    let main = open();
    const row = main.querySelector('.dash-tag-row[data-tagid="TB"]');
    row.click();
    const drawer = doc.getElementById(row.getAttribute('aria-controls'));
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.hasAttribute('data-ced-later')).toBe(false);
    expect(drawer.querySelector('.ced-explain').textContent).toMatch(/^Competency level: .+\.$/);
    expect(drawer.querySelectorAll('.ced-list .tag-assess-row')).toHaveLength(1);
    expect(drawer.querySelector('[data-ced="add"]')).not.toBeNull();
    // Drawn again, the open one is drawn in full and the others stay empty.
    PageStudent.render();
    main = doc.getElementById('main');
    expect(main.querySelectorAll('.ced-list')).toHaveLength(1);
    expect(main.querySelector('#ced-secB .ced-list')).not.toBeNull();
    expect(main.querySelectorAll('.ced[data-ced-later]')).toHaveLength(3);
  });
});
