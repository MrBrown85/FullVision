/**
 * Assignment Grades by Competency follows its own Range (Nov 3 bug sweep,
 * reports group 2). On Report 2 the Reports page makes Term 2 the active
 * term, and the competency view read its marks from getTagScores, which
 * keeps only that term's work. Year to Date then printed only Term 2's
 * pieces under a "Year to date" heading, and Last 10 lost Term 1's pieces
 * too, while By Date printed the whole year. The marks are now read all
 * time for those ranges, and the term is put back.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-grades-range';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };
const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-15' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-10-16', ends_on: '2027-01-29' },
];
const work = (id, date) => ({ id, title: 'Work ' + id, date, tagIds: ['t1'] });
const sc = (assessmentId, score) => ({ assessmentId, tagId: 't1', score, date: '2026-10-20' });

function seed() {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [
    work('A', '2026-09-10'),
    work('B', '2026-10-01'),
    work('C', '2026-10-17'),
    work('D', '2026-10-18'),
  ];
  _cache.scores[CID] = { [SID]: [sc('A', 2), sc('B', 3), sc('C', 3), sc('D', 4)] };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average', reportingTerms: TERMS };
  clearProfCache();
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const grades = range =>
  text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'competency', range, per: 8 }));

describe('Assignment Grades by Competency on Report 2', () => {
  afterEach(() => {
    setActiveTerm(CID, null);
    delete COURSES[CID];
  });

  it('prints Term 1 work for Year to Date and Last 10, and only Term 2 for This Term', () => {
    seed();
    setActiveTerm(CID, 2);
    ['all', 'last10'].forEach(range => {
      const out = grades(range);
      ['Work A', 'Work B', 'Work C', 'Work D'].forEach(t => expect(out).toContain(t));
      expect(out).toContain('Work A 2.0 / 4');
    });
    const term = grades('term');
    expect(term).toContain('Work C');
    expect(term).not.toContain('Work A');
    // The report's term is put back.
    expect(getActiveTerm(CID).ordinal).toBe(2);
  });
});
