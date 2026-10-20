/**
 * Report block renderers are pure: given { termId, termLabel } they render
 * without touching the page. The Reports page builds that context once from
 * the term picker (ReportBlocks.reportContext) and passes it for every
 * student, so the same renderers can run in a measuring stage, a worker, or
 * a server later (docs/report-forms-plan.md, Phase 1).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-ctx';
const SID = 'stu-ctx';
const STUDENT = { id: SID, firstName: 'Cece', lastName: 'Adeyemi', studentNumber: 'STU-201' };

let savedGetElementById;
let savedRating;
let savedTerms;

beforeEach(() => {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency', block: 'A' };
  _cache.students[CID] = [STUDENT];
  _cache.courseConfigs[CID] = {};
  savedRating = globalThis.getStudentTermRating;
  savedTerms = globalThis.getReportingTerms;
  globalThis.getStudentTermRating = (cid, sid, termId) =>
    termId === 'term-2' ? { narrative: 'Cece has grown this term.', dims: { engagement: 4, collaboration: 3 } } : null;
  globalThis.getReportingTerms = () => [
    { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-14' },
    { ordinal: 2, label: 'Term 2', starts_on: '2026-11-15', ends_on: '2027-01-29' },
  ];
  savedGetElementById = document.getElementById;
  document.getElementById = () => {
    throw new Error('renderer read the page');
  };
});

afterEach(() => {
  document.getElementById = savedGetElementById;
  globalThis.getStudentTermRating = savedRating;
  globalThis.getReportingTerms = savedTerms;
});

describe('report block renderers take the term as context', () => {
  const ctx = { termId: 'term-2', termLabel: 'Jan Report Card' };

  it('header prints the report label, the term dates and the student number without reading the page', () => {
    const html = ReportBlocks.renderReportBlock('header', CID, STUDENT, ctx);
    expect(html).toContain('Jan Report Card');
    expect(html).toContain('Term 2');
    expect(html).toContain('Nov 15');
    expect(html).toContain('Student No. STU-201');
    expect(html).toContain('Science 8 · Block A');
  });

  it('teacher comment and dispositions use the context term', () => {
    expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, STUDENT, ctx)).toContain(
      'Cece has grown this term.',
    );
    expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, STUDENT, ctx)).toContain('Thriving');
    const other = { termId: 'term-1', termLabel: 'Nov Report Card' };
    expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, STUDENT, other)).toBe('');
    expect(ReportBlocks.renderReportBlock('learner-dimensions', CID, STUDENT, other)).toBe('');
  });

  it('every block renders with a context and no page', () => {
    const ids = Object.keys(ReportSheets.BLOCKS);
    for (const id of ids) {
      expect(() => ReportBlocks.renderReportBlock(id, CID, STUDENT, ctx), id).not.toThrow();
    }
  });
});

describe('reportContext reads the term picker once', () => {
  it('maps "Report N" to term-N and keeps the option text as the label', () => {
    document.getElementById = id =>
      id === 'report-period' ? { value: 'Report 3', selectedIndex: 0, options: [{ text: 'Apr Report Card' }] } : null;
    expect(ReportBlocks.reportContext()).toEqual({ termId: 'term-3', termLabel: 'Apr Report Card' });
    expect(ReportBlocks.termIdFromPeriod('Report 6')).toBe('term-6');
    expect(ReportBlocks.termIdFromPeriod('Spring Update')).toBe('spring-update');
  });

  it('falls back to term-1 when there is no picker', () => {
    document.getElementById = () => null;
    expect(ReportBlocks.reportContext()).toEqual({ termId: 'term-1', termLabel: '' });
  });
});
