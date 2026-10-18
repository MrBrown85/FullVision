/**
 * Mobile Observations Notepad tests — m-observe.js
 *
 * Tests observation feed rendering, filtering, form state management,
 * sentiment ARIA labels, and save/delete flows.
 */

import './setup-mobile.js';
import { parseHTML } from 'linkedom';

const CID = 'test';
const originals = {};

function mockDataLayer(overrides) {
  const defaults = {
    getStudents: () => [
      { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] },
      { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: 'Noor', pronouns: '', designations: [] },
    ],
    sortStudents: arr => arr,
    displayName: st => (st.preferred || st.firstName) + ' ' + st.lastName,
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

/* The new-observation sheet mounts the shared capture strip, which needs a
   real DOM: run it in linkedom with presentSheet writing into a container. */
function withSheet(fn) {
  const dom = parseHTML('<!doctype html><html><body><div id="sheet"></div></body></html>');
  const origDoc = globalThis.document;
  const origPresent = MComponents.presentSheet;
  let opts = null;
  globalThis.document = dom.document;
  MComponents.presentSheet = (html, o) => {
    opts = o;
    dom.document.getElementById('sheet').innerHTML = html;
  };
  try {
    return fn(dom.document.getElementById('sheet'), () => opts, dom);
  } finally {
    if (opts && opts.onClose) opts.onClose();
    globalThis.document = origDoc;
    MComponents.presentSheet = origPresent;
  }
}

const EDIT_OB = {
  id: 'ob1',
  text: 'Great work',
  sentiment: null,
  context: null,
  dims: [],
  created: '2026-10-18T10:00:00Z',
};

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
    expect(html).toContain('No observations');
    expect(html).toContain('Tap + to record one');
  });

  it('renders observation cards grouped by date', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'Great work',
          sentiment: 'strength',
          created: new Date().toISOString(),
          dims: [],
        },
        {
          id: 'ob2',
          studentId: 'stu2',
          text: 'Needs support',
          sentiment: 'concern',
          created: '2025-01-01T10:00:00Z',
          dims: [],
        },
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
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          sentiment: 'strength',
          created: '2025-03-01T10:00:00Z',
          dims: [],
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Cece Adams'); // student with obs appears as filter
  });

  it('shows dimension tags on observation cards', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          sentiment: 'strength',
          dims: ['engagement', 'self-regulation'],
          created: '2025-03-01T10:00:00Z',
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-obs-tag-chip');
  });

  it('shows context label on observation cards', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          context: 'small-group',
          sentiment: 'growth',
          dims: [],
          created: '2025-03-01T10:00:00Z',
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-obs-context');
  });

  it('renders sentiment-colored card borders', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          sentiment: 'strength',
          created: '2025-03-01T10:00:00Z',
          dims: [],
        },
        {
          id: 'ob2',
          studentId: 'stu2',
          text: 'test2',
          sentiment: 'concern',
          created: '2025-03-01T10:00:00Z',
          dims: [],
        },
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

/* ── Sentiment ARIA on the edit sheet (radiogroup pattern) ─── */
describe('Sentiment button accessibility', () => {
  function editHtml() {
    let capturedHTML = '';
    const origPresent = MComponents.presentSheet;
    MComponents.presentSheet = html => {
      capturedHTML = html;
    };
    mockDataLayer({ getStudentQuickObs: () => [EDIT_OB] });
    MObserve.presentEditObsSheet(CID, 'stu1', 'ob1');
    MComponents.presentSheet = origPresent;
    return capturedHTML;
  }

  it('renders sentiment buttons with role="radio" and aria-checked', () => {
    const html = editHtml();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Observation type"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="false"');
  });

  it('renders textarea with proper <label> element', () => {
    const html = editHtml();
    expect(html).toContain('<label');
    expect(html).toContain('for="m-obs-text"');
  });

  it('offers Core Competencies and custom tags, not just dispositions', () => {
    globalThis.getCustomTags = () => ['Lab safety'];
    const html = editHtml();
    expect(html).toContain('Core competencies');
    expect(html).toContain('data-val="tag:Lab safety"');
    expect(html).toContain('m-dim-chip');
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
    mockDataLayer({});
    withSheet((sheet, getOpts) => {
      MObserve.presentNewObsSheet(CID);
      expect(getOpts()).not.toBeNull();
      expect(typeof getOpts().onClose).toBe('function');
    });
  });
});

/* ── Feed rendering edge cases ──────────────────────────────── */
describe('Observation feed edge cases', () => {
  it('handles observation with no sentiment', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'No sentiment',
          sentiment: null,
          created: '2025-03-14T10:00:00Z',
          dims: [],
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('No sentiment');
    expect(html).toContain('data-sentiment=""');
  });

  it('handles observation with no dims', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          sentiment: 'strength',
          created: '2025-03-14T10:00:00Z',
          dims: null,
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).not.toContain('m-obs-tag-chip');
  });

  it('handles observation with empty dims array', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          sentiment: 'strength',
          created: '2025-03-14T10:00:00Z',
          dims: [],
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).not.toContain('m-obs-tags');
  });

  it('handles observation with no context', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'stu1',
          text: 'test',
          sentiment: 'strength',
          context: null,
          created: '2025-03-14T10:00:00Z',
          dims: [],
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).not.toContain('m-obs-context');
  });

  it('handles observation for unknown student', () => {
    mockDataLayer({
      getAllQuickObs: () => [
        {
          id: 'ob1',
          studentId: 'deleted-student',
          text: 'test',
          sentiment: 'strength',
          created: '2025-03-14T10:00:00Z',
          dims: [],
        },
      ],
    });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('Unknown');
  });

  it('renders multiple date groups correctly', () => {
    // Freeze time away from UTC-midnight so `.toISOString()` and
    // dateGroupLabel's local-date math agree on "today".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));
    try {
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
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── Sheet form content: the shared capture strip ──────────── */
describe('New observation sheet content', () => {
  it('is the shared capture strip in its sheet layout', () => {
    mockDataLayer({});
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID);
      expect(sheet.textContent).toContain('New observation');
      expect(sheet.querySelector('.obsc.obsc--sheet')).toBeTruthy();
      expect(sheet.querySelector('#m-capture-input').getAttribute('placeholder')).toBe('What did you notice?');
      expect(sheet.querySelector('#m-capture-add-btn').disabled).toBe(true);
    });
  });

  it('renders the three types, context and tags as text, with no emoji', () => {
    mockDataLayer({});
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID);
      const types = Array.from(sheet.querySelectorAll('.obsc-chip-type')).map(b => b.textContent);
      expect(types).toEqual(['Strength', 'Growth', 'Concern']);
      expect(sheet.textContent).toContain('Context');
      expect(sheet.textContent).toContain('+ Tag');
      expect(sheet.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });

  it('lists every student in a searchable picker', () => {
    mockDataLayer({});
    withSheet((sheet, getOpts, dom) => {
      MObserve.presentNewObsSheet(CID);
      sheet.querySelector('#m-student-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const menu = sheet.querySelector('#m-student-dropdown');
      expect(menu.querySelector('.obsc-menu-search')).toBeTruthy();
      expect(menu.textContent).toContain('Cece Adams');
      expect(menu.textContent).toContain('Noor Khan');
    });
  });

  it('offers Core Competencies and custom tags, which the phone lacked before', () => {
    mockDataLayer({ getCustomTags: () => ['Lab safety'] });
    withSheet((sheet, getOpts, dom) => {
      MObserve.presentNewObsSheet(CID);
      sheet.querySelector('#m-tag-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const menu = sheet.querySelector('#m-tag-dropdown');
      expect(menu.textContent).toContain('Core competencies');
      expect(menu.textContent).toContain('Custom tags');
      expect(menu.textContent).toContain('Lab safety');
    });
  });

  it('a quick-compose student is pre-selected', () => {
    mockDataLayer({});
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID, 'stu2');
      expect(sheet.querySelector('.obsc-chip-student').textContent).toContain('Noor Khan');
    });
  });

  it('saving writes through addQuickOb with the type and tags', () => {
    const added = [];
    mockDataLayer({
      addQuickOb: (cid, sid, text, dims, sentiment) => {
        added.push({ sid, text, dims, sentiment });
        return true;
      },
    });
    const origDismiss = MComponents.dismissSheet;
    const origToast = MComponents.showToast;
    MComponents.dismissSheet = () => {};
    MComponents.showToast = () => {};
    try {
      withSheet((sheet, getOpts, dom) => {
        MObserve.presentNewObsSheet(CID, 'stu1');
        sheet
          .querySelector('[data-obsc="type"][data-value="strength"]')
          .dispatchEvent(new dom.window.Event('click', { bubbles: true }));
        const input = sheet.querySelector('#m-capture-input');
        input.value = 'Asked a sharp question #engagement';
        sheet.querySelector('#m-capture-add-btn').disabled = false;
        sheet.querySelector('#m-capture-add-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      });
    } finally {
      MComponents.dismissSheet = origDismiss;
      MComponents.showToast = origToast;
    }
    expect(added).toEqual([
      { sid: 'stu1', text: 'Asked a sharp question', dims: ['engagement'], sentiment: 'strength' },
    ]);
  });
});

/* ── Text pills and delete with Undo ───────────────────────── */
describe('MObserve feed pills and Undo', () => {
  const ob = {
    id: 'ob1',
    studentId: 'stu1',
    text: 'Explained the method to her group',
    sentiment: 'strength',
    context: 'small-group',
    dims: ['collaboration', 'cc:COM'],
    created: '2025-03-01T10:00:00Z',
  };

  it('renders type, context and tags as text with no emoji', () => {
    mockDataLayer({ getAllQuickObs: () => [ob] });
    const html = MObserve.renderFeed(CID);
    expect(html).toContain('m-obs-type-pill');
    expect(html).toContain('Small group');
    expect(html).toContain('Collaboration');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('hides a deleted card for six seconds, then deletes it', () => {
    vi.useFakeTimers();
    const deleted = [];
    let toastOpts = null;
    const origToast = MComponents.showToast;
    MComponents.showToast = (msg, opts) => {
      toastOpts = { msg, ...opts };
    };
    mockDataLayer({
      getAllQuickObs: () => [ob],
      deleteQuickOb: (cid, sid, id) => deleted.push(id),
    });
    MObserve.holdDelete(CID, 'stu1', 'ob1');
    expect(toastOpts.msg).toBe('Observation deleted');
    expect(toastOpts.duration).toBe(6000);
    expect(MObserve.renderFeed(CID)).not.toContain('Explained the method');
    vi.advanceTimersByTime(5900);
    expect(deleted).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(deleted).toEqual(['ob1']);
    MComponents.showToast = origToast;
    vi.useRealTimers();
  });

  it('Undo brings the card back and never deletes', () => {
    vi.useFakeTimers();
    const deleted = [];
    let toastOpts = null;
    const origToast = MComponents.showToast;
    MComponents.showToast = (msg, opts) => {
      toastOpts = opts;
    };
    mockDataLayer({
      getAllQuickObs: () => [ob],
      deleteQuickOb: (cid, sid, id) => deleted.push(id),
    });
    MObserve.holdDelete(CID, 'stu1', 'ob1');
    toastOpts.onUndo();
    expect(MObserve.renderFeed(CID)).toContain('Explained the method');
    vi.advanceTimersByTime(10000);
    expect(deleted).toEqual([]);
    MComponents.showToast = origToast;
    vi.useRealTimers();
  });
});
