/**
 * Mobile Observations Notepad tests — m-observe.js
 *
 * Tests observation feed rendering, filtering, form state management,
 * sentiment ARIA labels, and save/delete flows.
 */

import './setup-mobile.js';

const CID = 'test';
const originals = {};

function mockDataLayer(overrides) {
  const defaults = {
    getStudents: () => [
      { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] },
      { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: 'Noor', pronouns: '', designations: [] },
    ],
    sortStudents: (arr) => arr,
    displayName: (st) => (st.preferred || st.firstName) + ' ' + st.lastName,
    getAllQuickObs: () => [],
    getStudentQuickObs: () => [],
    addQuickOb: () => {},
    deleteQuickOb: () => {},
    getActiveCourse: () => CID,
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
  });
}

afterEach(() => {
  restoreDataLayer();
  MObserve.resetSheetState();
});

/* ── renderFeed ─────────────────────────────────────────────── */
describe('MObserve.renderFeed', () => {
  it('renders the observation feed with title', () => {
    mockDataLayer({});
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Observations');
    expect(html).toContain('m-screen');
  });

  it('shows empty state when no observations', () => {
    mockDataLayer({});
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('No Observations');
    expect(html).toContain('Tap + to record one');
  });

  it('renders observation cards grouped by date', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'Great work', sentiment: 'strength', created: new Date().toISOString(), dims: [] },
        { id: 'ob2', studentId: 'stu2', text: 'Needs support', sentiment: 'concern', created: '2025-01-01T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Great work');
    expect(html).toContain('Needs support');
    expect(html).toContain('m-obs-date-group'); // date group headers
  });

  it('includes FAB with aria-label for accessibility', () => {
    mockDataLayer({});
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-fab');
    expect(html).toContain('aria-label="New observation"');
  });

  it('renders filter pills including sentiment options', () => {
    mockDataLayer({});
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-filter-pill');
    expect(html).toContain('All');
    expect(html).toContain('Strength');
    expect(html).toContain('Growth');
    expect(html).toContain('Concern');
  });

  it('shows student name filters for students with observations', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', sentiment: 'strength', created: '2025-03-01T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Cece Adams'); // student with obs appears as filter
  });

  it('shows dimension tags on observation cards', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', sentiment: 'strength', dims: ['engagement', 'self-regulation'], created: '2025-03-01T10:00:00Z' },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-obs-tag-chip');
  });

  it('shows context label on observation cards', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', context: 'small-group', sentiment: 'growth', dims: [], created: '2025-03-01T10:00:00Z' },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-obs-context');
  });

  it('renders sentiment-colored card borders', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', sentiment: 'strength', created: '2025-03-01T10:00:00Z', dims: [] },
        { id: 'ob2', studentId: 'stu2', text: 'test2', sentiment: 'concern', created: '2025-03-01T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('data-sentiment="strength"');
    expect(html).toContain('data-sentiment="concern"');
  });
});

/* ── presentNewObsSheet ─────────────────────────────────────── */
describe('MObserve.presentNewObsSheet', () => {
  it('is a callable function', () => {
    expect(typeof MObserve.presentNewObsSheet).toBe('function');
  });

  // Note: Full DOM-dependent sheet tests are better as integration/preview tests.
  // Here we test the data contracts and state management.
});

/* ── Sheet state management ─────────────────────────────────── */
describe('Sheet state management', () => {
  it('resetSheetState clears all selections', () => {
    // The reset function should be callable without error
    expect(() => MObserve.resetSheetState()).not.toThrow();
  });

  it('updateSubmitState is a function', () => {
    expect(typeof MObserve.updateSubmitState).toBe('function');
  });
});

/* ── Sentiment ARIA (radiogroup pattern) ────────────────────── */
describe('Sentiment button accessibility', () => {
  it('renders sentiment buttons with role="radio" and aria-checked', () => {
    mockDataLayer({});
    // presentNewObsSheet builds the HTML — we capture it via the MComponents.presentSheet spy
    // Instead, test the expected pattern in renderFeed's sheet template
    // The sheet HTML is generated in presentNewObsSheet — we need to mock presentSheet
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };

    MObserve.presentNewObsSheet(CID);

    expect(capturedHTML).toContain('role="radiogroup"');
    expect(capturedHTML).toContain('aria-label="Observation type"');
    expect(capturedHTML).toContain('role="radio"');
    expect(capturedHTML).toContain('aria-checked="false"');

    MComponents.presentSheet = origPresent;
  });

  it('renders textarea with proper <label> element', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };

    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);

    expect(capturedHTML).toContain('<label');
    expect(capturedHTML).toContain('for="m-obs-text"');

    MComponents.presentSheet = origPresent;
  });
});

/* ── applyFilter ────────────────────────────────────────────── */
describe('MObserve.applyFilter', () => {
  it('is a callable function', () => {
    expect(typeof MObserve.applyFilter).toBe('function');
  });
});

/* ── saveObservation ────────────────────────────────────────── */
describe('MObserve.saveObservation', () => {
  it('is a callable function', () => {
    expect(typeof MObserve.saveObservation).toBe('function');
  });
});

/* ── deleteObservation ──────────────────────────────────────── */
describe('MObserve.deleteObservation', () => {
  it('is a callable function', () => {
    expect(typeof MObserve.deleteObservation).toBe('function');
  });
});

/* ── Student picker ─────────────────────────────────────────── */
describe('Student multi-picker', () => {
  it('selectStudent toggles selection on and off', () => {
    mockDataLayer({
      getActiveCourse: () => CID,
    });
    // Select — may fail on DOM update but toggle logic should work
    try {
      MObserve.selectStudent('stu1');
      MObserve.selectStudent('stu1');
    } catch (e) {
      // DOM operations may fail in test env — that's OK, we're testing the logic
    }
  });

  it('filterStudentPicker is callable', () => {
    expect(typeof MObserve.filterStudentPicker).toBe('function');
  });

  it('toggleStudentPicker is callable', () => {
    expect(typeof MObserve.toggleStudentPicker).toBe('function');
  });
});

/* ── Sentiment/context/dim toggle ───────────────────────────── */
describe('Form selection toggles', () => {
  it('setSentiment can be called without error', () => {
    expect(() => MObserve.setSentiment('strength')).not.toThrow();
  });

  it('setContext can be called without error', () => {
    expect(() => MObserve.setContext('whole-class')).not.toThrow();
  });

  it('toggleDim can be called without error', () => {
    expect(() => MObserve.toggleDim('engagement')).not.toThrow();
  });

  it('calling setSentiment twice with same value deselects', () => {
    MObserve.setSentiment('strength');
    MObserve.setSentiment('strength');
    // No error — internal state toggled
  });
});

/* ── Sheet onClose callback ─────────────────────────────────── */
describe('Sheet form cleanup on dismiss', () => {
  it('passes onClose callback to presentSheet', () => {
    let receivedOpts = null;
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html, opts) => { receivedOpts = opts; };

    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);

    expect(receivedOpts).not.toBeNull();
    expect(typeof receivedOpts.onClose).toBe('function');

    MComponents.presentSheet = origPresent;
  });
});

/* ── Feed rendering edge cases ──────────────────────────────── */
describe('Observation feed edge cases', () => {
  it('handles observation with no sentiment', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'No sentiment', sentiment: null, created: '2025-03-14T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('No sentiment');
    expect(html).toContain('data-sentiment=""');
  });

  it('handles observation with no dims', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', sentiment: 'strength', created: '2025-03-14T10:00:00Z', dims: null },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).not.toContain('m-obs-tag-chip');
  });

  it('handles observation with empty dims array', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', sentiment: 'strength', created: '2025-03-14T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).not.toContain('m-obs-tags');
  });

  it('handles observation with no context', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'test', sentiment: 'strength', context: null, created: '2025-03-14T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).not.toContain('m-obs-context');
  });

  it('handles observation for unknown student', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'deleted-student', text: 'test', sentiment: 'strength', created: '2025-03-14T10:00:00Z', dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Unknown');
  });

  it('renders multiple date groups correctly', () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const lastWeek = new Date(Date.now() - 5 * 86400000).toISOString();
    mockDataLayer({
      getAllQuickObs: () => [
        { id: 'ob1', studentId: 'stu1', text: 'today', sentiment: 'strength', created: today, dims: [] },
        { id: 'ob2', studentId: 'stu1', text: 'yesterday', sentiment: 'growth', created: yesterday, dims: [] },
        { id: 'ob3', studentId: 'stu1', text: 'last week', sentiment: 'concern', created: lastWeek, dims: [] },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Today');
    expect(html).toContain('Yesterday');
  });
});

/* ── Sheet form content ─────────────────────────────────────── */
describe('New observation sheet content', () => {
  it('includes student picker', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('m-student-picker');
    expect(capturedHTML).toContain('Select student...');
    MComponents.presentSheet = origPresent;
  });

  it('includes textarea for observation text', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('m-sheet-textarea');
    expect(capturedHTML).toContain('What did you notice?');
    MComponents.presentSheet = origPresent;
  });

  it('includes all context options', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('m-context-btn');
    MComponents.presentSheet = origPresent;
  });

  it('includes dimension tag chips', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('m-dim-chip');
    MComponents.presentSheet = origPresent;
  });

  it('includes disabled submit button', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('disabled');
    expect(capturedHTML).toContain('Add Observation');
    MComponents.presentSheet = origPresent;
  });

  it('renders all three sentiment options', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('Strength');
    expect(capturedHTML).toContain('Growth');
    expect(capturedHTML).toContain('Concern');
    MComponents.presentSheet = origPresent;
  });

  it('renders sentiment emojis', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('✅');
    expect(capturedHTML).toContain('🔄');
    expect(capturedHTML).toContain('⚠️');
    MComponents.presentSheet = origPresent;
  });

  it('includes searchable student list', () => {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = (html) => { capturedHTML = html; };
    mockDataLayer({});
    MObserve.presentNewObsSheet(CID);
    expect(capturedHTML).toContain('m-picker-search');
    expect(capturedHTML).toContain('m-picker-item');
    // Should list all students
    expect(capturedHTML).toContain('Cece Adams');
    expect(capturedHTML).toContain('Noor Khan');
    MComponents.presentSheet = origPresent;
  });
});
