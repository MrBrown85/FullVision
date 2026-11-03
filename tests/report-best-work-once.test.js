/**
 * The Proficiency block's Best work names a piece once (Nov 3 bug sweep,
 * reports group 3). Two competencies tied for highest and one assessment
 * scored both, so the line read "Best work: Primary Source Analysis (Oct 2)
 * and Primary Source Analysis (Oct 2), 4.0 / 4."
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-best-once';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Owen', lastName: 'Martens' };

function seed(assessments, scores) {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec-1', name: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] },
      { id: 'sec-2', name: 'Perspective', tags: [{ id: 't2', label: 'Perspective' }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const sc = (assessmentId, tagId, score) => ({ assessmentId, tagId, score, date: '2026-10-10' });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Best work in the Proficiency block', () => {
  afterEach(() => delete COURSES[CID]);

  it('names a piece that scored two tied competencies once', () => {
    seed(
      [
        { id: 'psa', title: 'Primary Source Analysis', date: '2026-10-02', tagIds: ['t1', 't2'] },
        { id: 'map', title: 'Map Study', date: '2026-10-06', tagIds: ['t2'] },
      ],
      [sc('psa', 't1', 4), sc('psa', 't2', 4), sc('map', 't2', 4)],
    );
    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(prof).toContain('Highest now: Evidence and Perspective');
    expect(prof).toContain('Best work: Primary Source Analysis (Oct 2) and Map Study (Oct 6), 4.0 / 4.');
  });

  it('names it once when it is the only piece', () => {
    seed(
      [{ id: 'psa', title: 'Primary Source Analysis', date: '2026-10-02', tagIds: ['t1', 't2'] }],
      [sc('psa', 't1', 4), sc('psa', 't2', 4)],
    );
    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(prof).toContain('Best work: Primary Source Analysis (Oct 2), 4.0 / 4.');
  });
});
