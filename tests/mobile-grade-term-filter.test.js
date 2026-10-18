/**
 * Mobile grade list: the date filter uses the class's reporting terms.
 *
 * One option per term from getReportingTerms(cid), labelled with the
 * term's name, after the fixed All time / This week / Last 30 days
 * options. A term option keeps the assessments dated inside the term
 * and drops undated ones. The old saved value 'term' (last 90 days)
 * falls back to all time. Grades are not touched: this is a list filter.
 */

import './setup-mobile.js';

const CID = 'test';
const originals = {};

const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2025-09-02', ends_on: '2025-12-19' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-01-05', ends_on: '2026-03-13' },
];

const ASSESSMENTS = [
  { id: 'before', title: 'Before term 1', type: 'summative', date: '2025-08-29', tagIds: ['t1'] },
  { id: 'start', title: 'First day of term 1', type: 'summative', date: '2025-09-02', tagIds: ['t1'] },
  { id: 'inside', title: 'Inside term 1', type: 'formative', date: '2025-10-15', tagIds: ['t1'] },
  { id: 'end', title: 'Last day of term 1', type: 'summative', date: '2025-12-19', tagIds: ['t1'] },
  { id: 'after', title: 'Inside term 2', type: 'summative', date: '2026-02-02', tagIds: ['t1'] },
  { id: 'undated', title: 'No date', type: 'summative', date: '', tagIds: ['t1'] },
];

function mockDataLayer(overrides) {
  const defaults = {
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
  const mocks = { ...defaults, ...overrides };
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

/* Open the filter sheet with presentSheet stubbed and return its HTML. */
function sheetHtml() {
  const orig = window.MComponents.presentSheet;
  let html = '';
  window.MComponents.presentSheet = h => {
    html = h;
  };
  try {
    MGrade.openFilterSheet(CID);
  } finally {
    window.MComponents.presentSheet = orig;
  }
  return html;
}

/* The data-val of every date range option, in order. */
function dateOptions(html) {
  return [...html.matchAll(/data-action="m-grade-filter-seg" data-kind="dateRange" data-val="([^"]*)"/g)].map(
    m => m[1],
  );
}

/* The data-val of the active date range option. */
function activeDateOption(html) {
  const m = html.match(
    /m-seg-btn m-seg-active" data-action="m-grade-filter-seg" data-kind="dateRange" data-val="([^"]*)"/,
  );
  return m ? m[1] : null;
}

/* Fake list cells, one per assessment, so filterAssessments can show or
 * hide them. Returns the cells keyed by assessment id. */
function fakeCells() {
  const cells = {};
  ASSESSMENTS.forEach(a => {
    cells[a.id] = {
      style: { display: '' },
      getAttribute: k => (k === 'data-aid' ? a.id : null),
    };
  });
  const origAll = document.querySelectorAll;
  document.querySelectorAll = sel => (sel === '#m-grade-list .m-cell' ? Object.values(cells) : []);
  return {
    cells,
    restore() {
      document.querySelectorAll = origAll;
    },
  };
}

function visibleIds(cells) {
  return Object.keys(cells).filter(id => cells[id].style.display !== 'none');
}

function saveFilters(filters) {
  localStorage.setItem(
    'gb-grade-filters-' + CID,
    JSON.stringify({ category: [], module: [], dateRange: 'all', gradedStatus: 'all', ...filters }),
  );
}

beforeEach(() => {
  localStorage.clear();
  clearProfCache();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 },
  };
});

afterEach(() => {
  restoreDataLayer();
  localStorage.clear();
});

describe('date range options', () => {
  it('offers one option per reporting term, named after the term, after the fixed ranges', () => {
    mockDataLayer({});
    MGrade.renderPicker(CID);
    const html = sheetHtml();
    expect(dateOptions(html)).toEqual(['all', 'week', '30d', 'term:1', 'term:2']);
    expect(html).toContain('>Term 1</button>');
    expect(html).toContain('>Term 2</button>');
    expect(html).not.toContain('Last term');
  });

  it('offers only the fixed ranges when the class has no terms', () => {
    mockDataLayer({ getReportingTerms: () => [] });
    MGrade.renderPicker(CID);
    const html = sheetHtml();
    expect(dateOptions(html)).toEqual(['all', 'week', '30d']);
    expect(html).not.toContain('Last term');
    expect(html).not.toContain('data-val="term"');
  });

  it('marks the chosen term active', () => {
    mockDataLayer({});
    saveFilters({ dateRange: 'term:2' });
    MGrade.renderPicker(CID);
    expect(activeDateOption(sheetHtml())).toBe('term:2');
  });
});

describe('filtering by term', () => {
  it('keeps the assessments dated inside the term, including both end dates', () => {
    mockDataLayer({});
    saveFilters({ dateRange: 'term:1' });
    MGrade.renderPicker(CID);
    const fake = fakeCells();
    try {
      MGrade.filterAssessments(CID, 'all');
      expect(visibleIds(fake.cells).sort()).toEqual(['end', 'inside', 'start']);
    } finally {
      fake.restore();
    }
  });

  it('hides undated assessments and those outside the term', () => {
    mockDataLayer({});
    saveFilters({ dateRange: 'term:2' });
    MGrade.renderPicker(CID);
    const fake = fakeCells();
    try {
      MGrade.filterAssessments(CID, 'all');
      expect(visibleIds(fake.cells)).toEqual(['after']);
      expect(fake.cells.undated.style.display).toBe('none');
      expect(fake.cells.before.style.display).toBe('none');
    } finally {
      fake.restore();
    }
  });

  it('shows every assessment, dated or not, on all time', () => {
    mockDataLayer({});
    saveFilters({ dateRange: 'all' });
    MGrade.renderPicker(CID);
    const fake = fakeCells();
    try {
      MGrade.filterAssessments(CID, 'all');
      expect(visibleIds(fake.cells).length).toBe(ASSESSMENTS.length);
    } finally {
      fake.restore();
    }
  });

  it('applies a term chosen in the sheet and saves it', () => {
    mockDataLayer({});
    MGrade.renderPicker(CID);
    const origPresent = window.MComponents.presentSheet;
    const origDismiss = window.MComponents.dismissSheet;
    window.MComponents.presentSheet = () => {};
    window.MComponents.dismissSheet = () => {};
    const fake = fakeCells();
    try {
      MGrade.openFilterSheet(CID);
      MGrade.onFilterSegChange('dateRange', 'term:1');
      MGrade.applyFilterSheet(CID);
      const saved = JSON.parse(localStorage.getItem('gb-grade-filters-' + CID));
      expect(saved.dateRange).toBe('term:1');
      MGrade.filterAssessments(CID, 'all');
      expect(visibleIds(fake.cells).sort()).toEqual(['end', 'inside', 'start']);
    } finally {
      fake.restore();
      window.MComponents.presentSheet = origPresent;
      window.MComponents.dismissSheet = origDismiss;
    }
  });
});

describe('saved filter fallback', () => {
  it("treats the old saved value 'term' as all time", () => {
    mockDataLayer({});
    saveFilters({ dateRange: 'term' });
    const html = MGrade.renderPicker(CID);
    // No active filter: the badge stays hidden.
    const badge = html.match(/<span class="m-grade-filter-badge"([^>]*)>/);
    expect(badge[1]).toContain('hidden');
    expect(activeDateOption(sheetHtml())).toBe('all');
    const fake = fakeCells();
    try {
      MGrade.filterAssessments(CID, 'all');
      expect(visibleIds(fake.cells).length).toBe(ASSESSMENTS.length);
    } finally {
      fake.restore();
    }
  });

  it('falls back to all time when the saved term no longer exists', () => {
    mockDataLayer({ getReportingTerms: () => [TERMS[0]] });
    saveFilters({ dateRange: 'term:2' });
    MGrade.renderPicker(CID);
    expect(activeDateOption(sheetHtml())).toBe('all');
  });

  it('keeps the other saved filters when the date range falls back', () => {
    mockDataLayer({});
    saveFilters({ dateRange: 'term', category: ['c1'], gradedStatus: 'has-ungraded' });
    const html = MGrade.renderPicker(CID);
    const badge = html.match(/<span class="m-grade-filter-badge"([^>]*)>([^<]*)<\/span>/);
    expect(badge[2].trim()).toBe('2'); // category + graded status, not the date range
  });
});
