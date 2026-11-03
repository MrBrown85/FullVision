/**
 * Assignment Grades on Last 10 leaves out work not yet due (Nov 3 bug
 * sweep, reports group 3). Last 10 took the ten newest assessments with no
 * date filter, so three December pieces made ahead of time printed at the
 * top as dashes and pushed three graded October pieces off. Side by Side
 * always uses Last 10. Year to Date and the Quick Report already left work
 * dated after today out; Last 10 now does too, and so does This Term
 * (Colin, 2026-11-03).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = 'report-grades-last10';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan' };
const pad = n => String(n).padStart(2, '0');

function seed() {
  const october = Array.from({ length: 12 }, (_, i) => ({
    id: 'oct' + (i + 1),
    title: 'October ' + pad(i + 1),
    date: '2026-10-' + pad(i + 1),
    tagIds: ['t1'],
  }));
  const december = [1, 5, 10].map(d => ({
    id: 'dec' + d,
    title: 'December ' + pad(d),
    date: '2026-12-' + pad(d),
    tagIds: ['t1'],
  }));
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
  _cache.assessments[CID] = october.concat(december);
  _cache.scores[CID] = { [SID]: october.map(a => ({ assessmentId: a.id, tagId: 't1', score: 3, date: a.date })) };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Assignment Grades on Last 10', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T19:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    delete COURSES[CID];
  });

  it('lists the ten newest pieces dated up to today, at either size', () => {
    seed();
    [{ range: 'last10' }, { size: 'half' }].forEach(options => {
      const out = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, options));
      expect(out).not.toContain('December');
      for (let d = 3; d <= 12; d++) expect(out).toContain('October ' + pad(d));
      expect(out).not.toContain('October 02');
    });
  });

  it('This Term leaves out work dated after today too', () => {
    seed();
    _cache.courseConfigs[CID].reportingTerms = [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-12-20' },
    ];
    setActiveTerm(CID, 1);
    try {
      const out = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { range: 'term' }));
      expect(out).toContain('This term');
      expect(out).not.toContain('December');
      for (let d = 1; d <= 12; d++) expect(out).toContain('October ' + pad(d));
    } finally {
      setActiveTerm(CID, null);
    }
  });
});
