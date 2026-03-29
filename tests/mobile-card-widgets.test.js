import './setup-mobile.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Card Widget Config', () => {
  beforeEach(() => {
    localStorage.clear();
    if (typeof _cache !== 'undefined') {
      // Clear any cached widget config
      delete _cache.cardWidgets;
    }
  });

  it('returns default config when no localStorage entry exists', () => {
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'sectionBars', 'obsSnippet', 'actions']);
    expect(config.disabled).toContain('completion');
    expect(config.disabled).toContain('dispositions');
    expect(config.disabled).toContain('narrative');
    expect(config.disabled.length).toBe(12);
  });

  it('reads saved config from localStorage', () => {
    var custom = {
      order: ['hero', 'completion', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'missingWork', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(custom));
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'completion', 'actions']);
  });

  it('saves config to localStorage', () => {
    var config = {
      order: ['hero', 'sectionBars', 'completion', 'obsSnippet', 'actions'],
      disabled: ['missingWork', 'growth', 'obsSummary', 'flagStatus', 'reflection',
                 'dispositions', 'traits', 'concerns', 'workHabits', 'growthAreas', 'narrative']
    };
    saveCardWidgetConfig(config);
    var raw = JSON.parse(localStorage.getItem('m-card-widgets'));
    expect(raw.order).toEqual(config.order);
  });

  it('handles new widgets added in future releases', () => {
    var old = {
      order: ['hero', 'sectionBars', 'obsSnippet', 'actions'],
      disabled: ['completion', 'missingWork']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(old));
    var config = getCardWidgetConfig();
    expect(config.disabled).toContain('growth');
    expect(config.disabled).toContain('dispositions');
    expect(config.disabled).toContain('narrative');
  });

  it('ignores unknown widget keys in localStorage', () => {
    var bad = {
      order: ['hero', 'unknownWidget', 'actions'],
      disabled: ['sectionBars']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(bad));
    var config = getCardWidgetConfig();
    expect(config.order).not.toContain('unknownWidget');
  });
});

/* ─────────────────────────────────────────────────────────────────
   Task 2 + 3: MCardWidgets render function tests
   ───────────────────────────────────────────────────────────────── */

const CID = 'test';
const originals = {};

function mockWidgetDataLayer(overrides) {
  const defaults = {
    getOverallProficiency: () => 3.0,
    getStudentQuickObs: () => [],
    getSectionProficiency: () => 3.0,
    getAssignmentStatuses: () => ({}),
    getAssessments: () => [],
    getScores: () => ({}),
    getTagScores: () => [],
    getCompletionPct: () => 75,
    getCardWidgetConfig: () => ({ order: ['hero', 'sectionBars', 'obsSnippet', 'actions'], disabled: [] }),
    isStudentFlagged: () => false,
    displayName: (st) => (st.preferred || st.firstName) + ' ' + st.lastName,
  };
  const mocks = { ...defaults, ...overrides };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

function restoreWidgetDataLayer() {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
    else delete globalThis[fn];
  });
}

const STUDENT = { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] };
const SECTIONS = [
  { id: 's1', name: 'Questioning', shortName: 'Quest', color: '#2196F3' },
  { id: 's2', name: 'Planning', shortName: 'Plan', color: '#4CAF50' },
];
const DATA = { sections: SECTIONS };

beforeEach(() => {
  localStorage.clear();
  if (typeof _cache !== 'undefined') delete _cache.cardWidgets;
});

afterEach(() => {
  restoreWidgetDataLayer();
});

/* ── Task 2: hero ──────────────────────────────────────────────── */
describe('MCardWidgets.render hero', () => {
  it('renders avatar, name, pronouns, and proficiency', () => {
    mockWidgetDataLayer({ getOverallProficiency: () => 3.5 });
    const html = MCardWidgets.render('hero', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-hero');
    expect(html).toContain('m-scard-avatar');
    expect(html).toContain('Cece Adams');
    expect(html).toContain('she/her');
    expect(html).toContain('3.5');
  });

  it('shows proficiency label', () => {
    mockWidgetDataLayer({ getOverallProficiency: () => 3.0 });
    const html = MCardWidgets.render('hero', STUDENT, CID, DATA);
    expect(html).toContain('Proficient');
  });

  it('shows dash when proficiency is zero', () => {
    mockWidgetDataLayer({ getOverallProficiency: () => 0 });
    const html = MCardWidgets.render('hero', STUDENT, CID, DATA);
    expect(html).toContain('—');
  });

  it('shows IEP badge when student has IEP designation', () => {
    mockWidgetDataLayer({});
    const st = { ...STUDENT, designations: ['G'] }; // G has iep:true
    const html = MCardWidgets.render('hero', st, CID, DATA);
    expect(html).toContain('m-badge-iep');
  });

  it('shows flag icon when flagStatus widget enabled and student is flagged', () => {
    mockWidgetDataLayer({
      getCardWidgetConfig: () => ({ order: ['hero', 'flagStatus', 'actions'], disabled: [] }),
      isStudentFlagged: () => true,
    });
    const html = MCardWidgets.render('hero', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-flag');
  });

  it('does not show flag icon when student is not flagged', () => {
    mockWidgetDataLayer({
      getCardWidgetConfig: () => ({ order: ['hero', 'flagStatus', 'actions'], disabled: [] }),
      isStudentFlagged: () => false,
    });
    const html = MCardWidgets.render('hero', STUDENT, CID, DATA);
    expect(html).not.toContain('m-scard-flag');
  });
});

/* ── Task 2: renderFallbackHero ─────────────────────────────────── */
describe('MCardWidgets.renderFallbackHero', () => {
  it('renders minimal name when hero is toggled off', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.renderFallbackHero(STUDENT);
    expect(html).toContain('m-scard-hero-min');
    expect(html).toContain('m-scard-avatar-min');
    expect(html).toContain('Cece Adams');
  });

  it('does not include full proficiency section', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.renderFallbackHero(STUDENT);
    expect(html).not.toContain('m-scard-prof');
  });
});

/* ── Task 2: sectionBars ─────────────────────────────────────────── */
describe('MCardWidgets.render sectionBars', () => {
  it('renders one row per section', () => {
    mockWidgetDataLayer({ getSectionProficiency: () => 3.0 });
    const html = MCardWidgets.render('sectionBars', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-sections');
    const rows = (html.match(/m-scard-sec-row/g) || []).length;
    expect(rows).toBe(2);
  });

  it('shows section name in each row', () => {
    mockWidgetDataLayer({ getSectionProficiency: () => 2.0 });
    const html = MCardWidgets.render('sectionBars', STUDENT, CID, DATA);
    expect(html).toContain('Quest');
    expect(html).toContain('Plan');
  });

  it('returns empty string when no sections', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('sectionBars', STUDENT, CID, { sections: [] });
    expect(html).toBe('');
  });
});

/* ── Task 2: obsSnippet ──────────────────────────────────────────── */
describe('MCardWidgets.render obsSnippet', () => {
  it('renders observation text and timestamp', () => {
    mockWidgetDataLayer({
      getStudentQuickObs: () => [{ text: 'Great participation today', created: '2026-03-28T10:00:00Z' }],
    });
    const html = MCardWidgets.render('obsSnippet', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-obs');
    expect(html).toContain('Great participation today');
  });

  it('truncates long observation text at 80 chars', () => {
    const longText = 'A'.repeat(100);
    mockWidgetDataLayer({
      getStudentQuickObs: () => [{ text: longText, created: '2026-03-28T10:00:00Z' }],
    });
    const html = MCardWidgets.render('obsSnippet', STUDENT, CID, DATA);
    expect(html).toContain('…');
  });

  it('shows empty state when no observations', () => {
    mockWidgetDataLayer({ getStudentQuickObs: () => [] });
    const html = MCardWidgets.render('obsSnippet', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-obs-empty');
    expect(html).toContain('No observations yet');
  });
});

/* ── Task 2: actions ─────────────────────────────────────────────── */
describe('MCardWidgets.render actions', () => {
  it('renders Observe and View Profile buttons', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('actions', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-actions');
    expect(html).toContain('Observe');
    expect(html).toContain('View Profile');
  });

  it('Observe button has correct data-action and data-sid', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('actions', STUDENT, CID, DATA);
    expect(html).toContain('data-action="m-obs-quick-menu"');
    expect(html).toContain('data-sid="stu1"');
  });

  it('View Profile button has correct data-action and data-sid', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('actions', STUDENT, CID, DATA);
    expect(html).toContain('data-action="m-student-detail"');
  });
});

/* ── Task 3: completion ──────────────────────────────────────────── */
describe('MCardWidgets.render completion', () => {
  it('renders arc ring with percentage', () => {
    mockWidgetDataLayer({ getCompletionPct: () => 85 });
    const html = MCardWidgets.render('completion', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-tile');
    expect(html).toContain('m-wdg-arc');
    expect(html).toContain('85');
    expect(html).toContain('Complete');
  });

  it('uses green color for >= 80%', () => {
    mockWidgetDataLayer({ getCompletionPct: () => 80 });
    const html = MCardWidgets.render('completion', STUDENT, CID, DATA);
    expect(html).toContain('var(--score-3)');
  });

  it('uses amber color for >= 50% and < 80%', () => {
    mockWidgetDataLayer({ getCompletionPct: () => 60 });
    const html = MCardWidgets.render('completion', STUDENT, CID, DATA);
    expect(html).toContain('var(--score-2)');
  });

  it('uses red color for < 50%', () => {
    mockWidgetDataLayer({ getCompletionPct: () => 40 });
    const html = MCardWidgets.render('completion', STUDENT, CID, DATA);
    expect(html).toContain('var(--score-1)');
  });
});

/* ── Task 3: missingWork ─────────────────────────────────────────── */
describe('MCardWidgets.render missingWork', () => {
  it('renders count when missing work > 0', () => {
    mockWidgetDataLayer({
      getAssignmentStatuses: () => ({ 'stu1:a1': 'NS', 'stu1:a2': 'NS' }),
      getAssessments: () => [
        { id: 'a1', type: 'summative', date: '2026-01-01', tagIds: [] },
        { id: 'a2', type: 'summative', date: '2026-01-02', tagIds: [] },
      ],
    });
    const html = MCardWidgets.render('missingWork', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-tile');
    expect(html).toContain('m-wdg-alert');
    expect(html).toContain('2');
  });

  it('returns empty string when 0 missing', () => {
    mockWidgetDataLayer({
      getAssignmentStatuses: () => ({}),
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2026-01-01', tagIds: [] }],
    });
    const html = MCardWidgets.render('missingWork', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 3: growth ──────────────────────────────────────────────── */
describe('MCardWidgets.render growth', () => {
  it('renders journey text when multiple summative scores exist', () => {
    mockWidgetDataLayer({
      getTagScores: (cid, sid, tagId) => [
        { score: 1, type: 'summative', date: '2026-01-01', tagId, assessmentId: 'a1' },
        { score: 3, type: 'summative', date: '2026-02-01', tagId, assessmentId: 'a2' },
      ],
    });
    const dataWithSections = {
      sections: [{ id: 's1', name: 'Test', shortName: 'Test', color: '#888', tags: [{ id: 't1' }] }],
    };
    const html = MCardWidgets.render('growth', STUDENT, CID, dataWithSections);
    expect(html).toContain('m-wdg-growth');
  });

  it('shows improving arrow direction (green) when score increased', () => {
    mockWidgetDataLayer({
      getTagScores: (cid, sid, tagId) => [
        { score: 1, type: 'summative', date: '2026-01-01', tagId, assessmentId: 'a1' },
        { score: 3, type: 'summative', date: '2026-02-01', tagId, assessmentId: 'a2' },
      ],
    });
    const dataWithSections = {
      sections: [{ id: 's1', name: 'Test', shortName: 'Test', color: '#888', tags: [{ id: 't1' }] }],
    };
    const html = MCardWidgets.render('growth', STUDENT, CID, dataWithSections);
    expect(html).toContain('var(--score-3)');
  });

  it('shows single assessment note for only one score', () => {
    mockWidgetDataLayer({
      getTagScores: (cid, sid, tagId) => [
        { score: 2, type: 'summative', date: '2026-01-01', tagId, assessmentId: 'a1' },
      ],
    });
    const dataWithSections = {
      sections: [{ id: 's1', name: 'Test', shortName: 'Test', color: '#888', tags: [{ id: 't1' }] }],
    };
    const html = MCardWidgets.render('growth', STUDENT, CID, dataWithSections);
    expect(html).toContain('1 assessment');
  });

  it('returns empty string when no summative scores', () => {
    mockWidgetDataLayer({
      getTagScores: () => [],
    });
    const dataWithSections = {
      sections: [{ id: 's1', name: 'Test', shortName: 'Test', color: '#888', tags: [{ id: 't1' }] }],
    };
    const html = MCardWidgets.render('growth', STUDENT, CID, dataWithSections);
    expect(html).toBe('');
  });
});
