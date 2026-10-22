/**
 * A competency removed from a class keeps its scores (section.removed_at) so
 * Re-link can put it back, but they stop counting toward the assessment's
 * overall score and the course %, as they already did for proficiency
 * (Colin, 2026-10-22: "go with A"). A points score is one number for the
 * assessment and always counts. Removing one says first how many students'
 * grades it changes.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000a0e1';

function section(id) {
  return {
    id: id,
    subject: 'sub',
    name: id,
    shortName: id,
    color: '#0891b2',
    tags: [{ id: id, label: id, color: '#0891b2' }],
  };
}

beforeEach(() => {
  localStorage.clear();
  saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'both', calcMethod: 'mostRecent' } });
  _cache.courseConfigs[CID] = {};
  saveStudents(CID, [
    { id: 's1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' },
    { id: 's2', firstName: 'Bo', lastName: 'Tran', enrolledDate: '2026-09-01' },
  ]);
  _cache.learningMaps[CID] = {
    subjects: [{ id: 'sub', name: 'Science', color: '#0891b2' }],
    sections: [section('A'), section('B')],
    _customized: true,
    _flatVersion: 2,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [
    { id: 'lab', title: 'Lab', scoreMode: 'proficiency', tagIds: ['A', 'B'], type: 'summative', date: '2026-10-01' },
    {
      id: 'quiz',
      title: 'Quiz',
      scoreMode: 'points',
      maxPoints: 10,
      tagIds: ['B'],
      type: 'summative',
      date: '2026-10-02',
    },
  ];
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'lab', tagId: 'A', score: 4, date: '2026-10-01' },
      { assessmentId: 'lab', tagId: 'B', score: 2, date: '2026-10-01' },
      { assessmentId: 'quiz', tagId: 'B', score: 8, date: '2026-10-02' },
    ],
    s2: [
      { assessmentId: 'lab', tagId: 'A', score: 3, date: '2026-10-01' },
      { assessmentId: 'lab', tagId: 'B', score: 3, date: '2026-10-01' },
    ],
  };
  _cache.statuses[CID] = {};
  clearProfCache();
});

function removeB() {
  _cache.learningMaps[CID] = Object.assign({}, _cache.learningMaps[CID], { sections: [section('A')] });
  clearProfCache();
}

describe('a removed competency in the grades', () => {
  it('leaves the assessment overall, so the course % follows', () => {
    expect(getAssessmentOverallScore(CID, 's1', 'lab')).toBe(3);
    removeB();
    expect(getAssessmentOverallScore(CID, 's1', 'lab')).toBe(4);
  });

  it('a points score still counts', () => {
    const before = getAssessmentOverallScore(CID, 's1', 'quiz');
    removeB();
    expect(getAssessmentOverallScore(CID, 's1', 'quiz')).toBe(before);
  });

  it('a class with no competencies yet keeps every score', () => {
    _cache.learningMaps[CID] = { subjects: [], sections: [], _customized: true, _flatVersion: 2 };
    clearProfCache();
    expect(getAssessmentOverallScore(CID, 's1', 'lab')).toBe(3);
  });

  it('the preview counts the students whose grade moves and changes nothing', () => {
    const before = studentGradeSummary(CID, 's1').text;
    const preview = previewCompetencyRemoval(CID, ['B']);
    // Amara's lab goes from 3 to 4; Bo's 3s stay 3.
    expect(preview).toMatchObject({ changed: 1, total: 2 });
    expect(preview.example.name).toBe('Amara Osei');
    expect(preview.example.before).toBe(before);
    expect(preview.example.after).not.toBe(before);
    expect(getLearningMap(CID).sections.map(s => s.id)).toEqual(['A', 'B']);
    expect(studentGradeSummary(CID, 's1').text).toBe(before);
  });
});

describe('the Remove confirm', () => {
  var confirms;
  var originalConfirm;
  var originalGetElementById;
  beforeEach(() => {
    confirms = [];
    originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = function (title, message) {
      confirms.push({ title, message });
    };
    originalGetElementById = document.getElementById;
    const main = { innerHTML: '' };
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
  });
  afterEach(() => {
    globalThis.showConfirm = originalConfirm;
    document.getElementById = originalGetElementById;
  });

  it('says how many students it moves before anything is removed', () => {
    DashClassManager.handleAction('cmDeleteStd', { dataset: { secid: 'B' } });
    expect(confirms[0].message).toContain('This changes the grade for 1 of your 2 students.');
    expect(confirms[0].message).toContain('For example, Amara Osei goes from');
    expect(confirms[0].message).toContain('Its scores are kept, so Re-link can put it back.');
    expect(getLearningMap(CID).sections.map(s => s.id)).toEqual(['A', 'B']);
  });
});

describe('the gradebook cell', () => {
  it('shows the same score the overall counts once a competency is removed', () => {
    expect(assessmentCellValue(CID, 's1', getAssessments(CID)[0], '2026-10-22').value).toBe(3);
    removeB();
    const cell = assessmentCellValue(CID, 's1', getAssessments(CID)[0], '2026-10-22');
    expect(cell.value).toBe(4);
    expect(cell.value).toBe(getAssessmentOverallScore(CID, 's1', 'lab'));
  });
});

describe('where a removed competency stops showing', () => {
  it('leaves the assessment competency list, but a points assessment keeps its score key', () => {
    expect(scoreTagIds(getAssessments(CID)[0], CID)).toEqual(['A', 'B']);
    removeB();
    expect(scoreTagIds(getAssessments(CID)[0], CID)).toEqual(['A']);
    // The link itself is kept, so Re-link can put it back.
    expect(getAssessments(CID)[0].tagIds).toEqual(['A', 'B']);
    expect(scoreTagIds(getAssessments(CID)[1], CID)).toEqual(['B']);
    expect(getAssessmentOverallScore(CID, 's1', 'quiz')).toBeGreaterThan(0);
  });
});
