/**
 * Mobile grade list: an assessment's YYYY-MM-DD date is a local day.
 *
 * In Vancouver, new Date('2026-10-27') is the evening of October 26, so the
 * list showed every date a day early and the Recent, This Week and Last 30
 * Days cutoffs could drop an assessment a day early. The list reads dates
 * with parseLocalDate, like the student page.
 */

import './setup-mobile.js';

const CID = 'test';
const originals = {};

const TERMS = [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-10-27' }];

const ASSESSMENTS = [
  { id: 'fair', title: 'Science Fair Proposal', type: 'summative', date: '2026-10-27', tagIds: ['t1'] },
  { id: 'week', title: 'Six days ago', type: 'formative', date: '2026-10-23', tagIds: ['t1'] },
  { id: 'month', title: 'Twenty-nine days ago', type: 'formative', date: '2026-09-30', tagIds: ['t1'] },
  { id: 'start', title: 'First day of term 1', type: 'summative', date: '2026-09-02', tagIds: ['t1'] },
  { id: 'old', title: 'Before term 1', type: 'summative', date: '2026-09-01', tagIds: ['t1'] },
];

function mockDataLayer() {
  const mocks = {
    getStudents: () => [{ id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', designations: [] }],
    sortStudents: arr => arr,
    displayName: st => st.firstName + ' ' + st.lastName,
    getAssessments: () => ASSESSMENTS,
    getScores: () => ({}),
    getCategories: () => [],
    getModules: () => [],
    getReportingTerms: () => TERMS,
    getTagById: (cid, tid) => ({ id: tid, label: 'Questioning', name: tid }),
    getSectionForTag: () => ({ color: '#2196F3' }),
    clearProfCache: () => {},
  };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

function restoreDataLayer() {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    else delete globalThis[fn];
  });
}

/* Run filterAssessments over fake list cells and return the ids left showing. */
function visibleAfter(mode) {
  const cells = {};
  ASSESSMENTS.forEach(a => {
    cells[a.id] = { style: { display: '' }, getAttribute: k => (k === 'data-aid' ? a.id : null) };
  });
  const origAll = document.querySelectorAll;
  document.querySelectorAll = sel => (sel === '#m-grade-list .m-cell' ? Object.values(cells) : []);
  try {
    MGrade.filterAssessments(CID, mode);
  } finally {
    document.querySelectorAll = origAll;
  }
  return Object.keys(cells).filter(id => cells[id].style.display !== 'none');
}

function saveDateRange(dateRange) {
  localStorage.setItem(
    'gb-grade-filters-' + CID,
    JSON.stringify({ category: [], module: [], dateRange, gradedStatus: 'all' }),
  );
}

const origTZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/Vancouver';
  // 8 pm on October 29 in Vancouver: the evening, when UTC is already the next day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 20, 0));
  localStorage.clear();
  clearProfCache();
  globalThis.COURSES = { test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 } };
  mockDataLayer();
});

afterEach(() => {
  restoreDataLayer();
  localStorage.clear();
  vi.useRealTimers();
  if (origTZ === undefined) delete process.env.TZ;
  else process.env.TZ = origTZ;
});

describe('grade list dates in Vancouver', () => {
  it('shows the date the assessment is set for, as the student page does', () => {
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('Oct 27');
    expect(html).not.toContain('Oct 26');
  });

  it('keeps an assessment dated 29 days ago in Recent and Last 30 Days', () => {
    expect(visibleAfter('recent')).toContain('month');
    saveDateRange('30d');
    MGrade.renderPicker(CID);
    expect(visibleAfter('all')).toContain('month');
  });

  it('keeps an assessment dated 6 days ago in This Week', () => {
    saveDateRange('week');
    MGrade.renderPicker(CID);
    expect(visibleAfter('all').sort()).toEqual(['fair', 'week']);
  });

  it("keeps an assessment dated on a term's first or last day inside the term", () => {
    saveDateRange('term:1');
    MGrade.renderPicker(CID);
    expect(visibleAfter('all').sort()).toEqual(['fair', 'month', 'start', 'week']);
  });
});
