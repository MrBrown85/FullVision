/**
 * In Rubrics by Competency, a rubric criterion that feeds no competency
 * keeps its own column, headed by its name. The header's code style put it
 * in capitals ("VISUAL DESIGN"), and a long code dropped to 10px, under the
 * 12px minimum (Nov 3 bug sweep, Step 4 group 3 #39). The name column now
 * takes the criterion style (as named, no capitals) and long codes keep
 * their size.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cH';
const poster = {
  id: 'p1',
  title: 'Poster',
  scoreMode: 'proficiency',
  rubricId: 'r1',
  tagIds: ['T1'],
  date: '2026-10-12',
};

function seed() {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.learningMaps[CID] = {
    subjects: [{ id: 'SUB', name: 'Science' }],
    sections: [
      { id: 'sec1', subject: 'SUB', name: 'Questioning', tags: [{ id: 'T1', code: 'QAP1', label: 'Questions' }] },
    ],
  };
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Adams' }];
  _cache.assessments[CID] = [poster];
  _cache.rubrics[CID] = [
    {
      id: 'r1',
      name: 'Poster Rubric',
      criteria: [
        { id: 'c1', name: 'Research', tagIds: ['T1'], levels: {} },
        { id: 'c2', name: 'Visual Design', tagIds: [], levels: {} },
      ],
    },
  ];
  _cache.scores[CID] = { s1: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

afterEach(unmount);

describe('Rubrics by Competency headers', () => {
  it('write a criterion with no competency as named', () => {
    mount(
      () => {
        seed();
        localStorage.setItem('gb_rubricColumns_' + CID, 'competencies');
      },
      { course: CID },
    );
    showCompetencies();
    const heads = Array.from(document.querySelectorAll('.gb-grid-tag-header'));
    const design = heads.find(h => h.textContent === 'Visual Design');
    expect(design).toBeTruthy();
    expect(design.classList.contains('gb-grid-tag-header-crit')).toBe(true);
    const code = heads.find(h => h.textContent === 'QAP1');
    expect(code.classList.contains('gb-grid-tag-header-crit')).toBe(false);
  });

  it('keep long codes at the 12px minimum', () => {
    const css = readFileSync('teacher/gradebook.css', 'utf-8');
    const rule = css.slice(css.indexOf('.gb-grid-tag-header.gb-code-long {'));
    expect(rule.slice(0, rule.indexOf('}'))).not.toMatch(/font-size/);
  });
});
