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

/* ─────────────────────────────────────────────────────────────────
   Task 4: Questionnaire Widget Renderers
   ───────────────────────────────────────────────────────────────── */

/* ── Task 4: obsSummary ──────────────────────────────────────────── */
describe('MCardWidgets.render obsSummary', () => {
  it('renders context sentence with count and context label', () => {
    mockWidgetDataLayer({
      getStudentQuickObs: () => [
        { text: 'Active participant', created: '2026-03-01', context: 'small-group', sentiment: 'strength' },
        { text: 'On task', created: '2026-03-02', context: 'small-group', sentiment: 'strength' },
        { text: 'Great focus', created: '2026-03-03', context: 'whole-class', sentiment: 'strength' },
      ],
    });
    const html = MCardWidgets.render('obsSummary', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-obs-summary');
    expect(html).toContain('3 observations');
    // small-group has count 2, whole-class has count 1 → top context is small-group
    expect(html).toContain('small group');
  });

  it('returns empty string when no observations', () => {
    mockWidgetDataLayer({ getStudentQuickObs: () => [] });
    const html = MCardWidgets.render('obsSummary', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 4: reflection ──────────────────────────────────────────── */
describe('MCardWidgets.render reflection', () => {
  it('renders student voice block from reflections', () => {
    mockWidgetDataLayer({
      getReflections: () => ({ stu1: { text: 'I really enjoyed the project work this term.' } }),
      getGoals: () => ({}),
    });
    const html = MCardWidgets.render('reflection', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-reflection');
    expect(html).toContain('m-wdg-reflection-label');
    expect(html).toContain('m-wdg-reflection-text');
    expect(html).toContain('Student voice');
    expect(html).toContain('I really enjoyed');
  });

  it('falls back to goals when no reflections', () => {
    mockWidgetDataLayer({
      getReflections: () => ({}),
      getGoals: () => ({ stu1: { text: 'My goal is to improve my writing.' } }),
    });
    const html = MCardWidgets.render('reflection', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-reflection');
    expect(html).toContain('My goal is to improve');
  });

  it('returns empty when neither reflections nor goals exist', () => {
    mockWidgetDataLayer({
      getReflections: () => ({}),
      getGoals: () => ({}),
    });
    const html = MCardWidgets.render('reflection', STUDENT, CID, DATA);
    expect(html).toBe('');
  });

  it('truncates long text at 60 chars with ellipsis', () => {
    const longText = 'A'.repeat(80);
    mockWidgetDataLayer({
      getReflections: () => ({ stu1: { text: longText } }),
      getGoals: () => ({}),
    });
    const html = MCardWidgets.render('reflection', STUDENT, CID, DATA);
    expect(html).toContain('\u2026');
    // Should not contain the full 80-char string
    expect(html).not.toContain(longText);
  });
});

/* ── Task 4: dispositions ────────────────────────────────────────── */
describe('MCardWidgets.render dispositions', () => {
  it('renders petal SVG and top dimension summary', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: { engagement: 4, collaboration: 3, selfRegulation: 2, resilience: 1, curiosity: 3, respect: 2 },
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('dispositions', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-dispositions');
    expect(html).toContain('m-wdg-petal');
    expect(html).toContain('<svg');
    expect(html).toContain('m-wdg-disp-text');
    // Top dim is engagement (4), second is collaboration/curiosity (3)
    expect(html).toContain('Engagement');
  });

  it('returns empty when no term rating', () => {
    mockWidgetDataLayer({ getStudentTermRating: () => null });
    const html = MCardWidgets.render('dispositions', STUDENT, CID, DATA);
    expect(html).toBe('');
  });

  it('returns empty when all dims are 0', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: { engagement: 0, collaboration: 0, selfRegulation: 0, resilience: 0, curiosity: 0, respect: 0 },
        socialTraits: [],
        workHabits: 0,
        participation: 0,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('dispositions', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 4: traits ──────────────────────────────────────────────── */
describe('MCardWidgets.render traits', () => {
  it('renders positive trait chips, caps at 4, shows overflow', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: ['leader', 'collaborative', 'independent', 'peer-mentor', 'risk-taker'],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('traits', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-traits');
    expect(html).toContain('m-wdg-chip-positive');
    expect(html).toContain('Leader');
    // 5 traits, 4 shown → +1 more
    expect(html).toContain('+1');
  });

  it('returns empty when no positive traits', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: ['needs-support', 'often-late'],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('traits', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 4: concerns ────────────────────────────────────────────── */
describe('MCardWidgets.render concerns', () => {
  it('renders concern trait chips in red style', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: ['needs-support', 'often-late', 'leader'],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('concerns', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-concerns');
    expect(html).toContain('m-wdg-chip-concern');
    expect(html).toContain('Needs Support');
    expect(html).toContain('Often Late');
    // leader is positive, should NOT appear in concerns
    expect(html).not.toContain('Leader');
  });

  it('returns empty when no concern traits', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: ['leader', 'collaborative'],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('concerns', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ─────────────────────────────────────────────────────────────────
   Task 5: Remaining Widget Renderers
   ───────────────────────────────────────────────────────────────── */

/* ── Task 5: workHabits ──────────────────────────────────────────── */
describe('MCardWidgets.render workHabits', () => {
  it('renders dual segmented bar with pip rows', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: [],
        workHabits: 3,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('workHabits', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-habits');
    expect(html).toContain('m-wdg-habit-col');
    expect(html).toContain('m-wdg-pips');
    expect(html).toContain('m-wdg-pip');
    expect(html).toContain('Work Habits');
    expect(html).toContain('Participation');
  });

  it('returns empty when no term rating', () => {
    mockWidgetDataLayer({ getStudentTermRating: () => null });
    const html = MCardWidgets.render('workHabits', STUDENT, CID, DATA);
    expect(html).toBe('');
  });

  it('returns empty when both workHabits and participation are 0', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: [],
        workHabits: 0,
        participation: 0,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('workHabits', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 5: growthAreas ─────────────────────────────────────────── */
describe('MCardWidgets.render growthAreas', () => {
  it('renders tag chips with section color dots', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: ['tag1', 'tag2'],
        narrative: '',
      }),
      getTagById: (cid, tid) => {
        if (tid === 'tag1') return { id: 'tag1', name: 'Critical Thinking', shortName: 'Crit Think', sectionId: 's1' };
        if (tid === 'tag2') return { id: 'tag2', name: 'Communication', shortName: 'Comm', sectionId: 's2' };
        return null;
      },
      getSections: () => [
        { id: 's1', name: 'Questioning', color: '#2196F3' },
        { id: 's2', name: 'Planning', color: '#4CAF50' },
      ],
    });
    const html = MCardWidgets.render('growthAreas', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-growth-areas');
    expect(html).toContain('m-wdg-section-label');
    expect(html).toContain('Growth Areas');
    expect(html).toContain('m-wdg-chip-neutral');
    expect(html).toContain('Crit Think');
    expect(html).toContain('m-wdg-chip-dot');
  });

  it('returns empty when no growth areas', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
      getTagById: () => null,
      getSections: () => [],
    });
    const html = MCardWidgets.render('growthAreas', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 5: narrative ───────────────────────────────────────────── */
describe('MCardWidgets.render narrative', () => {
  it('renders truncated excerpt with shadow card and header', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '<p>This student has shown tremendous growth this term and demonstrates strong skills in collaborative problem solving.</p>',
      }),
    });
    const html = MCardWidgets.render('narrative', STUDENT, CID, DATA);
    expect(html).toContain('m-wdg-narrative');
    expect(html).toContain('m-wdg-section-label');
    expect(html).toContain('Term Report');
    expect(html).toContain('m-wdg-narrative-text');
    // HTML tags should be stripped
    expect(html).not.toContain('<p>');
    // Text is truncated at 80 chars
    expect(html).toContain('\u2026');
  });

  it('returns empty when no narrative', () => {
    mockWidgetDataLayer({
      getStudentTermRating: () => ({
        dims: {},
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      }),
    });
    const html = MCardWidgets.render('narrative', STUDENT, CID, DATA);
    expect(html).toBe('');
  });

  it('returns empty when no term rating', () => {
    mockWidgetDataLayer({ getStudentTermRating: () => null });
    const html = MCardWidgets.render('narrative', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

/* ── Task 5: flagStatus ──────────────────────────────────────────── */
describe('MCardWidgets.render flagStatus', () => {
  it('is not a standalone renderer (returns empty string)', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('flagStatus', STUDENT, CID, DATA);
    expect(html).toBe('');
  });
});

describe('Card Assembly', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', pronouns: 'she/her', designations: [] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
    _cache.scores = {}; _cache.tags = {}; _cache.statuses = {};
    _cache.quickObs = {}; _cache.termRatings = {};
    _cache.learningMaps = {}; _cache.students = {}; _cache.assessments = {};
    _cache.flags = {}; _cache.observations = {}; _cache.goals = {};
    _cache.reflections = {}; _cache.overrides = {}; _cache.customTags = {};
    _cache.notes = {}; _cache.reportConfig = {}; _cache.courseConfigs = {};
    _cache.modules = {}; _cache.rubrics = {};
  });

  it('assembles default card with hero, sectionBars, obsSnippet, actions', () => {
    var data = { sections: [{ id: 'sec1', name: 'Questioning', color: '#4A90D9' }] };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard');
    expect(html).toContain('m-scard-hero');
    expect(html).toContain('m-scard-sections');
    expect(html).toContain('m-scard-obs');
    expect(html).toContain('m-scard-actions');
    expect(html).toContain('m-scard-widgets');
  });

  it('shows hero fallback when hero is disabled', () => {
    saveCardWidgetConfig({
      order: ['sectionBars', 'obsSnippet', 'actions'],
      disabled: ['hero', 'completion', 'missingWork', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    });
    var data = { sections: [] };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard-hero-min');
    expect(html).not.toContain('m-scard-prof');
  });

  it('renders completion and missingWork as 2-up when both enabled', () => {
    saveCardWidgetConfig({
      order: ['hero', 'completion', 'missingWork', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    });
    localStorage.setItem('gb-tags-course-1', JSON.stringify([{ id: 't1', name: 'Tag1' }]));
    var data = {
      sections: [],
      assessments: [{ id: 'a1' }],
      statuses: { 's1:a1': 'NS' }
    };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-wdg-2up');
  });

  it('skips disabled widgets', () => {
    saveCardWidgetConfig({
      order: ['hero', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'completion', 'missingWork', 'growth',
                 'obsSummary', 'flagStatus', 'reflection', 'dispositions', 'traits',
                 'concerns', 'workHabits', 'growthAreas', 'narrative']
    });
    var html = MCardWidgets.assembleCard(st, cid, { sections: [] });
    expect(html).not.toContain('m-scard-sections');
    expect(html).not.toContain('m-scard-obs');
  });
});

describe('Integration — Full Card Render Cycle', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', pronouns: 'she/her', designations: ['A'] };

  beforeEach(() => {
    localStorage.clear();
    // Reset cache values without deleting the top-level keys (data.js reads from them directly)
    Object.keys(_cache).forEach(function(k) {
      if (_cache[k] !== null && typeof _cache[k] === 'object' && !Array.isArray(_cache[k])) {
        Object.keys(_cache[k]).forEach(function(ck) { delete _cache[k][ck]; });
      } else {
        _cache[k] = null;
      }
    });

    // Seed comprehensive data
    localStorage.setItem('gb-sections-course-1', JSON.stringify([
      { id: 'sec1', name: 'Questioning', shortName: 'Quest', color: '#4A90D9', tags: [{ id: 't1', name: 'Tag1' }] }
    ]));
    localStorage.setItem('gb-tags-course-1', JSON.stringify([
      { id: 't1', name: 'Tag1', sectionId: 'sec1' }
    ]));
    localStorage.setItem('gb-scores-course-1', JSON.stringify({
      s1: [
        { tagId: 't1', assessmentId: 'a1', score: 2, type: 'summative', date: '2026-01-15' },
        { tagId: 't1', assessmentId: 'a2', score: 3, type: 'summative', date: '2026-03-15' }
      ]
    }));
    localStorage.setItem('gb-quick-obs-course-1', JSON.stringify({
      s1: [{ text: 'Great participation in group work', created: '2026-03-20T14:00:00Z', sentiment: 'strength', context: 'small-group' }]
    }));
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': {
        dims: { engagement: 4, collaboration: 3, selfRegulation: 2, resilience: 3, curiosity: 4, respect: 3 },
        workHabits: 3, participation: 4,
        socialTraits: ['leader', 'empathetic', 'low-confidence'],
        growthAreas: ['t1'],
        narrative: '<p>Cece has shown excellent growth this term.</p>'
      }}
    }));
    localStorage.setItem('gb-reflections-course-1', JSON.stringify({
      s1: { text: 'I feel more confident about science now' }
    }));
  });

  it('renders all widgets when all are enabled', () => {
    saveCardWidgetConfig({
      order: ['hero', 'sectionBars', 'completion', 'missingWork', 'growth',
              'obsSnippet', 'obsSummary', 'flagStatus', 'reflection',
              'dispositions', 'traits', 'concerns', 'workHabits', 'growthAreas',
              'narrative', 'actions'],
      disabled: []
    });

    var data = {
      sections: [{ id: 'sec1', name: 'Questioning', shortName: 'Quest', color: '#4A90D9' }],
      assessments: [{ id: 'a1' }, { id: 'a2' }],
      statuses: {},
      termId: 'term-1'
    };
    var html = MCardWidgets.assembleCard(st, cid, data);

    expect(html).toContain('m-scard-hero');
    expect(html).toContain('m-scard-sections');
    expect(html).toContain('m-wdg-arc');
    expect(html).toContain('m-wdg-growth');
    expect(html).toContain('m-scard-obs');
    expect(html).toContain('m-wdg-obs-summary');
    expect(html).toContain('m-wdg-reflection');
    expect(html).toContain('m-wdg-dispositions');
    expect(html).toContain('m-wdg-traits');
    expect(html).toContain('m-wdg-concerns');
    expect(html).toContain('m-wdg-habits');
    expect(html).toContain('m-wdg-growth-areas');
    expect(html).toContain('m-wdg-narrative');
    expect(html).toContain('m-scard-actions');
  });

  it('editor toggle cycle preserves other widgets', () => {
    var config = getCardWidgetConfig();
    expect(config.order.length).toBe(4);

    MCardWidgetEditor.toggleWidget('dispositions');
    config = getCardWidgetConfig();
    expect(config.order).toContain('dispositions');
    expect(config.order.length).toBe(5);

    MCardWidgetEditor.toggleWidget('sectionBars');
    config = getCardWidgetConfig();
    expect(config.order).not.toContain('sectionBars');
    expect(config.order).toContain('dispositions');
    expect(config.order.length).toBe(4);

    var data = { sections: [], assessments: [], statuses: {}, termId: 'term-1' };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard');
  });
});
