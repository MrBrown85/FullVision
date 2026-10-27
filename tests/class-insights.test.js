/**
 * The dashboard's class insights (teacher/dash-insights.js) and the calc.js
 * helpers behind them: how many students sit at each proficiency on a
 * competency, Who Needs Help, Missing and Late, and the class average's
 * change since the term before.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-insights';
const STUDENTS = [
  { id: 's1', firstName: 'Raj', lastName: 'Venkatesh' },
  { id: 's2', firstName: 'Sam', lastName: 'Blackwood' },
  { id: 's3', firstName: 'Noor', lastName: 'Al-Rashid' },
  { id: 's4', firstName: 'Ethan', lastName: 'Dubois' },
];
const SECTIONS = [
  { id: 'q', name: 'Questioning and Predicting', shortName: 'Questioning', color: '#00f', tags: [{ id: 'tq' }] },
  { id: 'p', name: 'Processing', shortName: 'Processing', color: '#0f0', tags: [{ id: 'tp' }] },
  { id: 'c', name: 'Communicating', shortName: 'Communicating', color: '#f00', tags: [{ id: 'tc' }] },
];
// Each student's proficiency on each competency; 0 is not scored.
const PROF = {
  s1: { q: 2, p: 1, c: 2 },
  s2: { q: 2, p: 2, c: 2.3 },
  s3: { q: 4, p: 3.6, c: 4 },
  s4: { q: 3, p: 2, c: 0 },
};

const STUBBED = [
  'getSectionProficiency',
  'getGroupProficiency',
  'getGroupedSections',
  'getSections',
  'getSectionEvidenceCount',
  'getAssessments',
  'getAssignmentStatus',
  'assessmentCellValue',
];
let saved;
let evidence;

beforeEach(() => {
  saved = {};
  STUBBED.forEach(name => {
    saved[name] = globalThis[name];
  });
  evidence = 3;
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  globalThis.getSectionProficiency = (cid, sid, secId) => (PROF[sid] && PROF[sid][secId]) || 0;
  globalThis.getGroupedSections = () => ({ groups: [], ungrouped: SECTIONS });
  globalThis.getSections = () => SECTIONS;
  globalThis.getSectionEvidenceCount = () => evidence;
});

afterEach(() => {
  STUBBED.forEach(name => {
    globalThis[name] = saved[name];
  });
  delete COURSES[CID];
  setActiveTerm(CID, null);
});

const IDS = STUDENTS.map(s => s.id);

describe('competencyDistribution', () => {
  it('bands each scored student by their rounded proficiency, Emerging first', () => {
    const d = competencyDistribution(CID, IDS, { sectionId: 'p' });
    expect(d.bands.map(b => b.label)).toEqual(['Emerging', 'Developing', 'Proficient', 'Extending']);
    expect(d.bands.map(b => b.ids)).toEqual([['s1'], ['s2', 's4'], [], ['s3']]);
    expect(d.avg).toBeCloseTo((1 + 2 + 3.6 + 2) / 4);
  });

  it('leaves out students not yet scored on it', () => {
    const d = competencyDistribution(CID, IDS, { sectionId: 'c' });
    expect(d.values.s4).toBeUndefined();
    expect(d.bands[1].ids).toEqual(['s1', 's2']);
  });
});

describe('Who Needs Help', () => {
  it('ranks competencies by students below Proficient and joins those with the same students', () => {
    const res = DashInsights.helpGroups(CID, STUDENTS, { below: 3, min: 3 });
    expect(res.groups.map(g => g.cols.map(c => c.key))).toEqual([['s:p'], ['s:q', 's:c']]);
    expect(res.groups[0].ids).toEqual(['s1', 's2', 's4']);
    expect(res.groups[1].ids).toEqual(['s1', 's2']);
  });

  it('lists students below on most competencies', () => {
    const res = DashInsights.helpGroups(CID, STUDENTS, { below: 3, min: 3 });
    expect(res.wideMin).toBe(2);
    expect(res.wide).toEqual(['s1', 's2']);
  });

  it('follows the rule: below Developing, and a minimum number of scores', () => {
    expect(DashInsights.helpGroups(CID, STUDENTS, { below: 2, min: 3 }).groups.map(g => g.ids)).toEqual([['s1']]);
    evidence = 2;
    expect(DashInsights.helpGroups(CID, STUDENTS, { below: 3, min: 3 }).groups).toEqual([]);
  });

  it('reads a saved rule and falls back to Below Proficient, at least 3 scores', () => {
    expect(DashInsights.readRule(undefined)).toEqual({ below: 3, min: 3 });
    expect(DashInsights.readRule({ below: 2, min: 1 })).toEqual({ below: 2, min: 1 });
    expect(DashInsights.readRule({ below: 7, min: 9 })).toEqual({ below: 3, min: 3 });
  });
});

describe('Needs Attention', () => {
  const OVERALL = { s1: 1.7, s2: 2.1, s3: 3.8, s4: 2.5 };
  beforeEach(() => {
    saved.getStudentQuickObs = globalThis.getStudentQuickObs;
    saved.getOverallProficiency = globalThis.getOverallProficiency;
    saved.studentGradeSummary = globalThis.studentGradeSummary;
    globalThis.getStudentQuickObs = () => [];
    globalThis.getAssessments = () => [];
    globalThis.getOverallProficiency = (cid, sid) => OVERALL[sid];
    globalThis.studentGradeSummary = (cid, sid) => ({ text: String(OVERALL[sid]), level: Math.round(OVERALL[sid]) });
  });
  afterEach(() => {
    ['getStudentQuickObs', 'getOverallProficiency', 'studentGradeSummary'].forEach(name => {
      globalThis[name] = saved[name];
    });
  });
  const model = rule => DashInsights.attentionModel(CID, STUDENTS, { rule, todayStr: '2026-10-22' });

  it('lists each student once, worst first, with the competencies under the rule', () => {
    const m = model({ below: 3, min: 3 });
    expect(m.people.map(p => [p.student.id, p.below.length])).toEqual([
      ['s1', 3],
      ['s2', 3],
      ['s4', 1],
    ]);
    expect(m.counts).toEqual({ all: 3, below: 3, notobs: 0, nostr: 0, missing: 0 });
    expect(DashInsights.belowCounts(m)).toEqual({ 's:q': 2, 's:p': 3, 's:c': 2 });
  });

  it('says how many competencies are below and the lowest, and links the gradebook', () => {
    const html = DashInsights.attentionCardHtml(CID, model({ below: 3, min: 3 }), {});
    expect(html).toContain('Below Proficient on <b>3</b> of 3');
    expect(html).toContain('Lowest');
    expect(html).toContain('/gradebook?course=' + CID + '&students=s1');
    expect(html).toContain('Below Proficient · At Least 3 Scores');
  });

  it("shows one competency's students when its count is picked", () => {
    const html = DashInsights.attentionCardHtml(CID, model({ below: 3, min: 3 }), { comp: 's:p' });
    expect(html).toContain('3 students');
    expect(html).toContain('&students=s4&section=p');
    expect(html).toContain('dash-na-compchip');
  });

  it('says so when nobody is below the rule', () => {
    PROF.s1.p = 3;
    const html = DashInsights.attentionCardHtml(CID, model({ below: 2, min: 3 }), { filter: 'below' });
    PROF.s1.p = 1;
    expect(html).toContain('Every scored student is at Developing or above.');
  });

  it('puts the class Next Steps above the students', () => {
    const html = DashInsights.attentionCardHtml(CID, model({ below: 3, min: 3 }), {
      classItems: [{ text: '2 core competencies not yet tagged', link: '/assignments', linkText: 'Tag' }],
    });
    expect(html.indexOf('2 core competencies not yet tagged')).toBeLessThan(html.indexOf('Raj Venkatesh'));
  });
});

describe('the Missing and Late cell', () => {
  it('says so at zero and counts each kind otherwise', () => {
    expect(DashInsights.missingGlanceHtml([])).toContain('Nothing is missing or late.');
    const html = DashInsights.missingGlanceHtml([{ kind: 'ns' }, { kind: 'late' }, { kind: 'late' }]);
    expect(html).toContain('<b>1</b> Not Submitted · <b>2</b> Late · <b>0</b> Past Due');
  });
});

describe('Missing and Late', () => {
  it('lists Not Submitted, Late and past-due unscored work in the active term', () => {
    const A = [
      { id: 'a1', title: 'Lab', date: '2026-10-01', dueDate: '2026-10-05' },
      { id: 'a2', title: 'Quiz', date: '2026-10-10', dueDate: '2026-10-30' },
    ];
    globalThis.getAssessments = () => A;
    globalThis.getAssignmentStatus = (cid, sid, aid) =>
      sid === 's1' && aid === 'a2' ? 'NS' : sid === 's2' && aid === 'a1' ? 'LATE' : null;
    globalThis.assessmentCellValue = (cid, sid, a) => ({ kind: sid === 's3' && a.id === 'a1' ? 'missing' : 'level' });
    const items = DashInsights.missingItems(CID, STUDENTS, '2026-10-22');
    expect(items.map(it => [it.kind, it.student.id, it.assessment.id])).toEqual([
      ['ns', 's1', 'a2'],
      ['late', 's2', 'a1'],
      ['due', 's3', 'a1'],
    ]);
  });
});

describe('the class average since the term before', () => {
  it('is null with no term active', () => {
    expect(classGradeChange(CID, IDS)).toBeNull();
  });
});

describe('a class average on one assessment', () => {
  it('reads as a level, points with a %, or a %', () => {
    expect(classColumnAverageText(CID, { scoreMode: 'proficiency' }, { avg: 2.94, count: 3 })).toBe('2.9');
    expect(
      classColumnAverageText(CID, { scoreMode: 'points', maxPoints: 10 }, { avg: 7.37, pct: 73.7, count: 3 }),
    ).toBe('7.4/10 · 74%');
    expect(classColumnAverageText(CID, { scoreMode: 'points' }, null)).toBe('—');
  });
});

describe('dashboard settings follow the teacher', () => {
  it('saves Cards | Grid and the rule with the teacher config, each keeping the other', () => {
    saveDashboardPrefs({ studentView: 'grid' });
    saveDashboardPrefs({ helpRule: { below: 2, min: 1 } });
    expect(getDashboardPrefs()).toEqual({ studentView: 'grid', helpRule: { below: 2, min: 1 } });
    expect(JSON.parse(localStorage.getItem('gb-config')).dashboardPrefs.studentView).toBe('grid');
  });

  it('sends them to save_teacher_preferences as dashboard_prefs', () => {
    expect(_teacherPrefsPatchFromConfig({ dashboardPrefs: { studentView: 'grid' } })).toEqual({
      dashboard_prefs: { studentView: 'grid' },
    });
  });
});
