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
    expect(config.order).toEqual([
      'hero',
      'sectionBars',
      'completion',
      'growth',
      'obsSnippet',
      'dispositions',
      'actions',
    ]);
    expect(config.disabled).toContain('missingWork');
    expect(config.disabled).toContain('narrative');
    expect(config.disabled.length).toBe(9);
  });

  it('reads saved config from localStorage', () => {
    var custom = {
      order: ['hero', 'completion', 'actions'],
      disabled: [
        'sectionBars',
        'obsSnippet',
        'missingWork',
        'growth',
        'obsSummary',
        'flagStatus',
        'reflection',
        'dispositions',
        'traits',
        'concerns',
        'workHabits',
        'growthAreas',
        'narrative',
      ],
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(custom));
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'completion', 'actions']);
  });

  it('saves config to localStorage', () => {
    var config = {
      order: ['hero', 'sectionBars', 'completion', 'obsSnippet', 'actions'],
      disabled: [
        'missingWork',
        'growth',
        'obsSummary',
        'flagStatus',
        'reflection',
        'dispositions',
        'traits',
        'concerns',
        'workHabits',
        'growthAreas',
        'narrative',
      ],
    };
    saveCardWidgetConfig(config);
    var raw = JSON.parse(localStorage.getItem('m-card-widgets'));
    expect(raw.order).toEqual(config.order);
  });

  it('handles new widgets added in future releases', () => {
    var old = {
      order: ['hero', 'sectionBars', 'obsSnippet', 'actions'],
      disabled: ['completion', 'missingWork'],
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
      disabled: ['sectionBars'],
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
    displayName: st => (st.preferred || st.firstName) + ' ' + st.lastName,
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

const STUDENT = {
  id: 'stu1',
  firstName: 'Cece',
  lastName: 'Adams',
  preferred: '',
  pronouns: 'she/her',
  designations: [],
};
const SECTIONS = [
  { id: 's1', name: 'Questioning', shortName: 'Quest', color: '#2196F3' },
  { id: 's2', name: 'Planning', shortName: 'Plan', color: '#4CAF50' },
];
const DEFAULT_CONFIG = {
  order: ['hero', 'sectionBars', 'completion', 'growth', 'obsSnippet', 'dispositions', 'actions'],
  disabled: [],
};
const DATA = {
  sections: SECTIONS,
  widgetConfig: DEFAULT_CONFIG,
  obs: [],
  termRating: null,
  statuses: {},
  assessments: [],
  termId: 'term-1',
};

beforeEach(() => {
  localStorage.clear();
  if (typeof _cache !== 'undefined') delete _cache.cardWidgets;
});

afterEach(() => {
  restoreWidgetDataLayer();
});

/* ── Task 2: hero ──────────────────────────────────────────────── */
describe('MCardWidgets.render hero', () => {
  it('renders avatar, name, and proficiency (pronouns removed from card)', () => {
    mockWidgetDataLayer({ getOverallProficiency: () => 3.5 });
    const html = MCardWidgets.render('hero', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-hero');
    expect(html).toContain('m-scard-avatar');
    expect(html).toContain('Cece Adams');
    // Pronouns were intentionally dropped from card surfaces; the full
    // profile page is where identity info lives.
    expect(html).not.toContain('she/her');
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

  it('shows/hides flag icon based on student flag state', () => {
    const d = { ...DATA, widgetConfig: { order: ['hero', 'flagStatus', 'actions'], disabled: [] } };
    let flagged = true;
    mockWidgetDataLayer({ isStudentFlagged: () => flagged });
    expect(MCardWidgets.render('hero', STUDENT, CID, d)).toContain('m-scard-flag');
    flagged = false;
    expect(MCardWidgets.render('hero', STUDENT, CID, d)).not.toContain('m-scard-flag');
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
});

/* ── Task 2: obsSnippet ──────────────────────────────────────────── */
describe('MCardWidgets.render obsSnippet', () => {
  it('renders observation text and timestamp', () => {
    mockWidgetDataLayer({});
    const d = { ...DATA, obs: [{ text: 'Great participation today', created: '2026-03-28T10:00:00Z' }] };
    const html = MCardWidgets.render('obsSnippet', STUDENT, CID, d);
    expect(html).toContain('m-scard-obs');
    expect(html).toContain('Great participation today');
  });

  it('truncates long observation text at 80 chars', () => {
    mockWidgetDataLayer({});
    const longText = 'A'.repeat(100);
    const d = { ...DATA, obs: [{ text: longText, created: '2026-03-28T10:00:00Z' }] };
    const html = MCardWidgets.render('obsSnippet', STUDENT, CID, d);
    expect(html).toContain('\u2026');
  });

  it('shows empty state when no observations', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('obsSnippet', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-obs-empty');
    expect(html).toContain('No observations yet');
  });
});

/* ── Task 2: actions ─────────────────────────────────────────────── */
describe('MCardWidgets.render actions', () => {
  it('renders Observe and View Profile buttons with correct actions and sid', () => {
    mockWidgetDataLayer({});
    const html = MCardWidgets.render('actions', STUDENT, CID, DATA);
    expect(html).toContain('m-scard-actions');
    expect(html).toContain('Observe');
    expect(html).toContain('View Profile');
    expect(html).toContain('data-action="m-obs-quick-menu"');
    expect(html).toContain('data-action="m-student-detail"');
    expect(html).toContain('data-sid="stu1"');
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
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      statuses: { 'stu1:a1': 'NS', 'stu1:a2': 'NS' },
      assessments: [
        { id: 'a1', type: 'summative', date: '2026-01-01', tagIds: [] },
        { id: 'a2', type: 'summative', date: '2026-01-02', tagIds: [] },
      ],
    };
    const html = MCardWidgets.render('missingWork', STUDENT, CID, d);
    expect(html).toContain('m-wdg-tile');
    expect(html).toContain('m-wdg-alert');
    expect(html).toContain('2');
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
});

/* ─────────────────────────────────────────────────────────────────
   Task 4: Questionnaire Widget Renderers
   ───────────────────────────────────────────────────────────────── */

/* ── Task 4: obsSummary ──────────────────────────────────────────── */
describe('MCardWidgets.render obsSummary', () => {
  it('renders context sentence with count and context label', () => {
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      obs: [
        { text: 'Active participant', created: '2026-03-01', context: 'small-group', sentiment: 'strength' },
        { text: 'On task', created: '2026-03-02', context: 'small-group', sentiment: 'strength' },
        { text: 'Great focus', created: '2026-03-03', context: 'whole-class', sentiment: 'strength' },
      ],
    };
    const html = MCardWidgets.render('obsSummary', STUDENT, CID, d);
    expect(html).toContain('m-wdg-obs-summary');
    expect(html).toContain('3 observations');
    // small-group has count 2, whole-class has count 1 → top context is small-group
    expect(html).toContain('small group');
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
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      termRating: {
        dims: { engagement: 4, collaboration: 3, selfRegulation: 2, resilience: 1, curiosity: 3, respect: 2 },
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      },
    };
    const html = MCardWidgets.render('dispositions', STUDENT, CID, d);
    expect(html).toContain('m-wdg-dispositions');
    expect(html).toContain('m-wdg-petal');
    expect(html).toContain('<svg');
    expect(html).toContain('m-wdg-disp-text');
    // Top dim is engagement (4), second is collaboration/curiosity (3)
    expect(html).toContain('Engagement');
  });
});

/* ── Task 4: traits ──────────────────────────────────────────────── */
describe('MCardWidgets.render traits', () => {
  it('renders positive trait chips, caps at 4, shows overflow', () => {
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      termRating: {
        dims: {},
        socialTraits: ['leader', 'collaborative', 'independent', 'peer-mentor', 'risk-taker'],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      },
    };
    const html = MCardWidgets.render('traits', STUDENT, CID, d);
    expect(html).toContain('m-wdg-traits');
    expect(html).toContain('m-wdg-chip-positive');
    expect(html).toContain('Leader');
    // 5 traits, 4 shown → +1 more
    expect(html).toContain('+1');
  });
});

/* ── Task 4: concerns ────────────────────────────────────────────── */
describe('MCardWidgets.render concerns', () => {
  it('renders concern trait chips in red style', () => {
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      termRating: {
        dims: {},
        socialTraits: ['needs-support', 'often-late', 'leader'],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative: '',
      },
    };
    const html = MCardWidgets.render('concerns', STUDENT, CID, d);
    expect(html).toContain('m-wdg-concerns');
    expect(html).toContain('m-wdg-chip-concern');
    expect(html).toContain('Needs Support');
    expect(html).toContain('Often Late');
    // leader is positive, should NOT appear in concerns
    expect(html).not.toContain('Leader');
  });
});

/* ─────────────────────────────────────────────────────────────────
   Task 5: Remaining Widget Renderers
   ───────────────────────────────────────────────────────────────── */

/* ── Task 5: workHabits ──────────────────────────────────────────── */
describe('MCardWidgets.render workHabits', () => {
  it('renders dual segmented bar with pip rows', () => {
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      termRating: {
        dims: {},
        socialTraits: [],
        workHabits: 3,
        participation: 2,
        growthAreas: [],
        narrative: '',
      },
    };
    const html = MCardWidgets.render('workHabits', STUDENT, CID, d);
    expect(html).toContain('m-wdg-habits');
    expect(html).toContain('m-wdg-habit-col');
    expect(html).toContain('m-wdg-pips');
    expect(html).toContain('m-wdg-pip');
    expect(html).toContain('Work Habits');
    expect(html).toContain('Participation');
  });

  it('returns empty when both workHabits and participation are 0', () => {
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      termRating: {
        dims: {},
        socialTraits: [],
        workHabits: 0,
        participation: 0,
        growthAreas: [],
        narrative: '',
      },
    };
    const html = MCardWidgets.render('workHabits', STUDENT, CID, d);
    expect(html).toBe('');
  });
});

/* ── Task 5: growthAreas ─────────────────────────────────────────── */
describe('MCardWidgets.render growthAreas', () => {
  it('renders tag chips with section color dots', () => {
    mockWidgetDataLayer({
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
    const d = {
      ...DATA,
      termRating: {
        dims: {},
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: ['tag1', 'tag2'],
        narrative: '',
      },
    };
    const html = MCardWidgets.render('growthAreas', STUDENT, CID, d);
    expect(html).toContain('m-wdg-growth-areas');
    expect(html).toContain('m-wdg-section-label');
    expect(html).toContain('Growth Areas');
    expect(html).toContain('m-wdg-chip-neutral');
    expect(html).toContain('Crit Think');
    expect(html).toContain('m-wdg-chip-dot');
  });
});

/* ── Task 5: narrative ───────────────────────────────────────────── */
describe('MCardWidgets.render narrative', () => {
  it('renders truncated excerpt with shadow card and header', () => {
    mockWidgetDataLayer({});
    const d = {
      ...DATA,
      termRating: {
        dims: {},
        socialTraits: [],
        workHabits: 2,
        participation: 2,
        growthAreas: [],
        narrative:
          '<p>This student has shown tremendous growth this term and demonstrates strong skills in collaborative problem solving.</p>',
      },
    };
    const html = MCardWidgets.render('narrative', STUDENT, CID, d);
    expect(html).toContain('m-wdg-narrative');
    expect(html).toContain('m-wdg-section-label');
    expect(html).toContain('Term Report');
    expect(html).toContain('m-wdg-narrative-text');
    // HTML tags should be stripped
    expect(html).not.toContain('<p>');
    // Text is truncated at 80 chars
    expect(html).toContain('\u2026');
  });
});

describe('Card Assembly', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', pronouns: 'she/her', designations: [] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (k) {
      delete _cache[k];
    });
    _cache.scores = {};
    _cache.tags = {};
    _cache.statuses = {};
    _cache.quickObs = {};
    _cache.termRatings = {};
    _cache.learningMaps = {};
    _cache.students = {};
    _cache.assessments = {};
    _cache.flags = {};
    _cache.observations = {};
    _cache.goals = {};
    _cache.reflections = {};
    _cache.overrides = {};
    _cache.customTags = {};
    _cache.notes = {};
    _cache.reportConfig = {};
    _cache.courseConfigs = {};
    _cache.modules = {};
    _cache.rubrics = {};
  });

  it('assembles default card with hero, sectionBars, obsSnippet, actions', () => {
    var data = {
      sections: [{ id: 'sec1', name: 'Questioning', color: '#4A90D9' }],
      widgetConfig: getCardWidgetConfig(),
      termId: 'term-1',
    };
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
      disabled: [
        'hero',
        'completion',
        'missingWork',
        'growth',
        'obsSummary',
        'flagStatus',
        'reflection',
        'dispositions',
        'traits',
        'concerns',
        'workHabits',
        'growthAreas',
        'narrative',
      ],
    });
    var data = { sections: [], widgetConfig: getCardWidgetConfig(), termId: 'term-1' };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard-hero-min');
    expect(html).not.toContain('m-scard-prof');
  });

  it('renders completion and missingWork as 2-up when both enabled', () => {
    saveCardWidgetConfig({
      order: ['hero', 'completion', 'missingWork', 'actions'],
      disabled: [
        'sectionBars',
        'obsSnippet',
        'growth',
        'obsSummary',
        'flagStatus',
        'reflection',
        'dispositions',
        'traits',
        'concerns',
        'workHabits',
        'growthAreas',
        'narrative',
      ],
    });
    localStorage.setItem('gb-tags-course-1', JSON.stringify([{ id: 't1', name: 'Tag1' }]));
    var data = {
      sections: [],
      assessments: [{ id: 'a1' }],
      statuses: { 's1:a1': 'NS' },
      widgetConfig: getCardWidgetConfig(),
      termId: 'term-1',
    };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-wdg-2up');
  });

  it('skips disabled widgets', () => {
    saveCardWidgetConfig({
      order: ['hero', 'actions'],
      disabled: [
        'sectionBars',
        'obsSnippet',
        'completion',
        'missingWork',
        'growth',
        'obsSummary',
        'flagStatus',
        'reflection',
        'dispositions',
        'traits',
        'concerns',
        'workHabits',
        'growthAreas',
        'narrative',
      ],
    });
    var html = MCardWidgets.assembleCard(st, cid, {
      sections: [],
      widgetConfig: getCardWidgetConfig(),
      termId: 'term-1',
    });
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
    Object.keys(_cache).forEach(function (k) {
      if (_cache[k] !== null && typeof _cache[k] === 'object' && !Array.isArray(_cache[k])) {
        Object.keys(_cache[k]).forEach(function (ck) {
          delete _cache[k][ck];
        });
      } else {
        _cache[k] = null;
      }
    });

    // Seed comprehensive data
    localStorage.setItem(
      'gb-sections-course-1',
      JSON.stringify([
        { id: 'sec1', name: 'Questioning', shortName: 'Quest', color: '#4A90D9', tags: [{ id: 't1', name: 'Tag1' }] },
      ]),
    );
    localStorage.setItem('gb-tags-course-1', JSON.stringify([{ id: 't1', name: 'Tag1', sectionId: 'sec1' }]));
    localStorage.setItem(
      'gb-scores-course-1',
      JSON.stringify({
        s1: [
          { tagId: 't1', assessmentId: 'a1', score: 2, type: 'summative', date: '2026-01-15' },
          { tagId: 't1', assessmentId: 'a2', score: 3, type: 'summative', date: '2026-03-15' },
        ],
      }),
    );
    localStorage.setItem(
      'gb-quick-obs-course-1',
      JSON.stringify({
        s1: [
          {
            text: 'Great participation in group work',
            created: '2026-03-20T14:00:00Z',
            sentiment: 'strength',
            context: 'small-group',
          },
        ],
      }),
    );
    localStorage.setItem(
      'gb-term-ratings-course-1',
      JSON.stringify({
        s1: {
          'term-1': {
            dims: { engagement: 4, collaboration: 3, selfRegulation: 2, resilience: 3, curiosity: 4, respect: 3 },
            workHabits: 3,
            participation: 4,
            socialTraits: ['leader', 'empathetic', 'low-confidence'],
            growthAreas: ['t1'],
            narrative: '<p>Cece has shown excellent growth this term.</p>',
          },
        },
      }),
    );
    localStorage.setItem(
      'gb-reflections-course-1',
      JSON.stringify({
        s1: { text: 'I feel more confident about science now' },
      }),
    );
  });

  it('renders all widgets when all are enabled', () => {
    saveCardWidgetConfig({
      order: [
        'hero',
        'sectionBars',
        'completion',
        'missingWork',
        'growth',
        'obsSnippet',
        'obsSummary',
        'flagStatus',
        'reflection',
        'dispositions',
        'traits',
        'concerns',
        'workHabits',
        'growthAreas',
        'narrative',
        'actions',
      ],
      disabled: [],
    });

    var data = {
      sections: [{ id: 'sec1', name: 'Questioning', shortName: 'Quest', color: '#4A90D9' }],
      assessments: [{ id: 'a1' }, { id: 'a2' }],
      statuses: {},
      termId: 'term-1',
      widgetConfig: getCardWidgetConfig(),
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
    expect(config.order.length).toBe(7);

    MCardWidgetEditor.toggleWidget('narrative');
    config = getCardWidgetConfig();
    expect(config.order).toContain('narrative');
    expect(config.order.length).toBe(8);

    MCardWidgetEditor.toggleWidget('sectionBars');
    config = getCardWidgetConfig();
    expect(config.order).not.toContain('sectionBars');
    expect(config.order).toContain('narrative');
    expect(config.order.length).toBe(7);

    var data = { sections: [], assessments: [], statuses: {}, termId: 'term-1', widgetConfig: getCardWidgetConfig() };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard');
  });
});
