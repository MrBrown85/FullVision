/**
 * An observation's level on a competency is evidence only: no grade reads
 * it (docs/DECISIONS.md, "Observations (2026-10-18)", item 5). The same
 * student, scores and class give the same competency, section and overall
 * grade with or without a level-4 observation on that competency.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const CID = 'lvl-course';
const SID = 'stu1';
const originals = {};

function mock(overrides) {
  Object.keys(overrides).forEach(fn => {
    if (!(fn in originals)) originals[fn] = globalThis[fn];
    globalThis[fn] = overrides[fn];
  });
}

describe('observation level never changes a grade', () => {
  let observations;

  beforeEach(() => {
    clearProfCache();
    globalThis.COURSES = { [CID]: { id: CID, name: 'Science 8', calcMethod: 'mostRecent', decayWeight: 0.65 } };
    observations = {};
    const tag = { id: 't1', label: 'Make observations' };
    const section = { id: 'sec1', name: 'Questioning and predicting', tags: [tag] };
    mock({
      getScores: () => ({
        [SID]: [
          { score: 2, tagId: 't1', assessmentId: 'a1', date: '2026-10-01', type: 'summative' },
          { score: 2, tagId: 't1', assessmentId: 'a2', date: '2026-10-08', type: 'summative' },
        ],
      }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', tagIds: ['t1'] },
        { id: 'a2', type: 'summative', tagIds: ['t1'] },
      ],
      getAssignmentStatuses: () => ({}),
      getCourseConfig: () => ({ calcMethod: 'mostRecent', decayWeight: 0.65 }),
      getSections: () => [section],
      getOverrides: () => ({}),
      getAllTags: () => [tag],
      getSectionForTag: () => section,
      getGradingScale: () => DEFAULT_GRADING_SCALE,
      getQuickObs: () => observations,
      getStudentQuickObs: (cid, sid) => observations[sid] || [],
      getAllQuickObs: () =>
        Object.keys(observations).flatMap(sid => observations[sid].map(o => Object.assign({ studentId: sid }, o))),
    });
  });

  afterEach(() => {
    Object.keys(originals).forEach(fn => {
      globalThis[fn] = originals[fn];
      delete originals[fn];
    });
  });

  function grades() {
    clearProfCache();
    return {
      tag: getTagProficiency(CID, SID, 't1'),
      section: getSectionProficiency(CID, SID, 'sec1'),
      overall: getOverallProficiency(CID, SID),
      summary: studentGradeSummary(CID, SID),
    };
  }

  it('a level-4 observation on the competency leaves every grade as it was', () => {
    const before = grades();
    expect(before.tag).toBe(2);
    observations[SID] = [
      {
        id: 'ob1',
        text: 'Looked like Extending work',
        dims: [],
        sentiment: 'strength',
        competencyId: 't1',
        level: 4,
        created: '2026-10-09T10:00:00Z',
        date: '2026-10-09',
      },
    ];
    expect(grades()).toEqual(before);
  });

  it('calc.js does not read observations at all', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../shared/calc.js'), 'utf-8');
    expect(src).not.toMatch(/QuickOb|getObservations|competencyId/);
  });
});
