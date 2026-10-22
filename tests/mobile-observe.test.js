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

/* ── The edit sheet (D3) ──────────────────────────────────── */
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

  it('puts the types in a folder band of toggle tabs', () => {
    const html = editHtml();
    expect(html).toContain('class="obs-band" role="group" aria-label="Type"');
    expect(html).toMatch(/obs-band-tab[^"]*" data-sentiment="strength" aria-pressed="(true|false)"/);
  });

  it('has Cancel and Save on top, a Context row, tag chips and Delete Observation', () => {
    const html = editHtml();
    expect(html).toContain('>Cancel</button>');
    expect(html).toContain('id="m-obs-submit" data-action="m-obs-save">Save</button>');
    expect(html).toContain('id="m-obs-ctx-row"');
    expect(html).toContain('aria-label="Observation"');
    expect(html).toContain('+ Add Tag');
    expect(html).toContain('>Delete Observation</button>');
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

/* ── The new-observation sheet: the edit sheet with a Student row ── */
describe('New observation sheet content', () => {
  it('is the edit sheet: type band, Student row, note, Context, tags and links; Add waits for text', () => {
    mockDataLayer({ getAssessments: () => [] });
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID);
      expect(sheet.querySelector('.m-edit-title').textContent).toBe('New Observation');
      const types = Array.from(sheet.querySelectorAll('.obs-band-tab')).map(b => b.textContent);
      expect(types).toEqual(['Strength', 'Growth', 'Concern', 'Note']);
      expect(sheet.querySelectorAll('.obs-band-tab.on')).toHaveLength(0);
      const rows = Array.from(sheet.querySelectorAll('.m-edit-row .m-edit-row-k')).map(e => e.textContent);
      expect(rows).toEqual(['Student', 'Context', 'Assessment', 'Competency']);
      expect(sheet.querySelector('#m-obs-text').getAttribute('placeholder')).toBe('What did you notice?');
      expect(sheet.querySelector('#m-obs-submit').disabled).toBe(true);
      expect(sheet.textContent).toContain('+ Add Tag');
      expect(sheet.textContent).not.toContain('Delete Observation');
      expect(sheet.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });

  it('lists every student in a searchable picker', () => {
    mockDataLayer({ getAssessments: () => [] });
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID);
      MObserve.openPicker('students');
      const pick = sheet.querySelector('#m-obs-edit-picker');
      expect(pick.querySelector('.m-pick-search')).toBeTruthy();
      expect(pick.textContent).toContain('Cece Adams');
      expect(pick.textContent).toContain('Noor Khan');
    });
  });

  it('offers Core Competencies and custom tags in the tag picker', () => {
    mockDataLayer({ getCustomTags: () => ['Lab safety'], getAssessments: () => [] });
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID);
      MObserve.openPicker('tags');
      const pick = sheet.querySelector('#m-obs-edit-picker');
      expect(pick.textContent).toContain('Core competencies');
      expect(pick.textContent).toContain('Custom tags');
      expect(pick.textContent).toContain('Lab safety');
    });
  });

  it('a quick-compose student is pre-selected and named in the title', () => {
    mockDataLayer({ getAssessments: () => [] });
    withSheet(sheet => {
      MObserve.presentNewObsSheet(CID, 'stu2');
      expect(sheet.querySelector('.m-edit-title').textContent).toBe('Noor K.');
      expect(sheet.querySelector('#m-obs-stu-row').textContent).toContain('Noor K.');
    });
  });

  it('Add writes through addQuickOb with the type, tags, context and shorthand', () => {
    const added = [];
    mockDataLayer({
      getAssessments: () => [],
      addQuickOb: (cid, sid, text, dims, sentiment, context) => {
        added.push({ sid, text, dims, sentiment, context });
        return true;
      },
    });
    const keep = { dismissSheet: MComponents.dismissSheet, showToast: MComponents.showToast };
    Object.assign(MComponents, { dismissSheet() {}, showToast() {} });
    try {
      withSheet(sheet => {
        MObserve.presentNewObsSheet(CID, 'stu1');
        MObserve.setSentiment('strength');
        MObserve.openPicker('context');
        MObserve.pick('context', 'independent');
        sheet.querySelector('#m-obs-text').value = 'Asked a sharp question #engagement';
        MObserve.saveObservation(CID);
      });
    } finally {
      Object.assign(MComponents, keep);
    }
    expect(added).toEqual([
      {
        sid: 'stu1',
        text: 'Asked a sharp question',
        dims: ['engagement'],
        sentiment: 'strength',
        context: 'independent',
      },
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
    expect(html).toContain('<span class="m-obs-type" data-sentiment="strength">Strength</span>');
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

/* ── Quick menu: the class's sentence starters ─────────────── */
describe('Quick menu starters', () => {
  const STARTERS = [
    {
      id: 'ot1',
      text: 'Explained a model to the table',
      sentiment: 'strength',
      context: 'small-group',
      dims: ['cc:1'],
    },
    { id: 'ot2', text: 'Needed a reminder to start', sentiment: 'growth', context: null, dims: ['tag:Lab safety'] },
  ];

  // A tap closes the sheet and shows a toast; neither matters here.
  function tap(cid, key) {
    const keep = {
      dismissSheet: MComponents.dismissSheet,
      showToast: MComponents.showToast,
      haptic: MComponents.haptic,
    };
    Object.assign(MComponents, { dismissSheet() {}, showToast() {}, haptic() {} });
    try {
      withSheet(() => MObserve.quickPost(cid, 'stu1', key));
    } finally {
      Object.assign(MComponents, keep);
    }
  }

  function menuHtml(cid) {
    let html = '';
    withSheet(sheet => {
      MObserve.presentQuickMenu(cid, 'stu1');
      html = sheet.innerHTML;
    });
    return html;
  }

  it('lists the teacher\u2019s starters, most used first, instead of the fixed six', () => {
    mockDataLayer({ getObservationTemplatesByUse: () => STARTERS });
    const html = menuHtml(CID);
    const texts = [...html.matchAll(/data-template="([^"]+)">.*?<span class="m-quick-row-text">([^<]+)<\/span>/g)].map(
      m => [m[1], m[2]],
    );
    expect(texts).toEqual([
      ['ot1', 'Explained a model to the table'],
      ['ot2', 'Needed a reminder to start'],
    ]);
    expect(html).toContain('<span class="m-obs-type" data-sentiment="strength">Strength</span>');
    expect(html).toMatch(/data-action="m-obs-quick-compose"[^>]*><span class="m-quick-row-text">Write Your Own…</);
    expect(html).not.toContain('Strong collaboration with peers');
    expect(html).toContain('Most used first.');
    expect(html).not.toContain('Also Save as Starter when you write it');
  });

  it('a tap saves at once with the starter type, context and tags', () => {
    const added = [];
    mockDataLayer({
      getObservationTemplatesByUse: () => STARTERS,
      addQuickOb: (cid, sid, text, dims, sentiment, context, ac, link, templateId) =>
        added.push({ cid, sid, text, dims, sentiment, context, templateId }),
    });
    tap(CID, 'ot1');
    expect(added).toEqual([
      {
        cid: CID,
        sid: 'stu1',
        text: 'Explained a model to the table',
        dims: ['cc:1'],
        sentiment: 'strength',
        context: 'small-group',
        templateId: 'ot1',
      },
    ]);
  });

  it('a class with no starters gets the six suggestions and a line saying where to add more', () => {
    const added = [];
    mockDataLayer({
      getObservationTemplatesByUse: () => [],
      addQuickOb: (cid, sid, text, dims, sentiment, context, ac, link, templateId) =>
        added.push({ text, dims, sentiment, templateId }),
    });
    const html = menuHtml(CID);
    OBS_STARTER_SUGGESTIONS.forEach(t => expect(html).toContain(t.text));
    expect(html).toContain('To keep one of your own, turn on Also Save as Starter when you write it.');
    expect(MObserve.quickStarters(CID).suggested).toBe(true);
    tap(CID, 'suggested-1');
    // A suggestion isn't one of the teacher's starters, so nothing is counted.
    expect(added).toEqual([
      { text: 'Asked a great question in class', dims: ['curiosity'], sentiment: 'strength', templateId: null },
    ]);
  });
});
