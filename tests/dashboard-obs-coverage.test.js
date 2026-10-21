import './setup.js';
import { PdtDate } from './helpers/pdt-date.js';

const ob = (date, sentiment = null, text = 'note') => ({ date, sentiment, text });

describe('DashOverview observation weeks', () => {
  describe('obsWeekStart', () => {
    it('returns the Monday of the ISO week', () => {
      expect(DashOverview.obsWeekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
      expect(DashOverview.obsWeekStart('2026-10-12')).toBe('2026-10-12'); // Monday
      expect(DashOverview.obsWeekStart('2026-10-14')).toBe('2026-10-12');
      expect(DashOverview.obsWeekStart('2026-01-01')).toBe('2025-12-29'); // across a year
    });
  });

  describe('obsIsOverdue', () => {
    it('is overdue with no observations', () => {
      expect(DashOverview.obsIsOverdue([], '2026-10-18')).toBe(true);
    });

    it('is overdue at exactly 21 days and not at 20', () => {
      expect(DashOverview.obsIsOverdue([ob('2026-09-27')], '2026-10-18')).toBe(true);
      expect(DashOverview.obsIsOverdue([ob('2026-09-28')], '2026-10-18')).toBe(false);
    });

    it('uses the most recent observation', () => {
      expect(DashOverview.obsIsOverdue([ob('2026-10-15'), ob('2026-08-01')], '2026-10-18')).toBe(false);
      expect(DashOverview.obsLastDate([ob('2026-08-01'), ob('2026-10-15'), ob('2026-09-01')])).toBe('2026-10-15');
    });
  });

  describe('obsCoverageWeeks', () => {
    it('shows the last 8 weeks with no term', () => {
      const weeks = DashOverview.obsCoverageWeeks('2026-10-18', null);
      expect(weeks).toHaveLength(8);
      expect(weeks[7]).toBe('2026-10-12');
      expect(weeks[0]).toBe('2026-08-24');
    });

    it('runs from the term start to today', () => {
      const weeks = DashOverview.obsCoverageWeeks('2026-10-18', { startsOn: '2026-09-02', endsOn: '2026-11-20' });
      expect(weeks[0]).toBe('2026-08-31');
      expect(weeks[weeks.length - 1]).toBe('2026-10-12');
      expect(weeks).toHaveLength(7);
    });

    it('stops at the end of a past term', () => {
      const weeks = DashOverview.obsCoverageWeeks('2027-03-01', { startsOn: '2026-09-02', endsOn: '2026-11-20' });
      expect(weeks[weeks.length - 1]).toBe('2026-11-16');
    });

    it('shows the first week of a term that has not started', () => {
      expect(DashOverview.obsCoverageWeeks('2026-10-18', { startsOn: '2026-11-23', endsOn: '2027-01-29' })).toEqual([
        '2026-11-23',
      ]);
    });
  });
});

/* The Observations card as the dashboard draws it (dash-observations.js). */
describe('Observations card rendering', () => {
  const CID = 'c-obs-card';
  const stubbed = [
    'getTodayStr',
    'getActiveTerm',
    'getStudentQuickObs',
    'getSections',
    'getTagScores',
    'getSectionProficiency',
  ];
  const originals = {};
  const students = [
    { id: 's1', firstName: 'Ada', lastName: 'Lee' },
    { id: 's2', firstName: 'Ben', lastName: 'Ng' },
  ];
  const sections = [
    { id: 'sec1', name: 'Questioning and Predicting', tags: [{ id: 't1', label: 'Question and Predict' }] },
    { id: 'sec2', name: 'Evaluating', tags: [{ id: 't2', label: 'Evaluate Methods' }] },
  ];
  let obs;
  let scores;
  let term;
  beforeEach(() => {
    stubbed.forEach(k => (originals[k] = globalThis[k]));
    obs = {};
    scores = {};
    term = null;
    globalThis.getTodayStr = () => '2026-10-18';
    globalThis.getActiveTerm = () => term;
    globalThis.getStudentQuickObs = (cid, sid) => obs[sid] || [];
    globalThis.getSections = () => sections;
    globalThis.getTagScores = (cid, sid, tagId) => (scores[sid] || {})[tagId] || [];
    globalThis.getSectionProficiency = (cid, sid, secId) => (scores[sid] && scores[sid][secId + ':level']) || 0;
    COURSES[CID] = { id: CID, name: 'Test', gradingSystem: 'proficiency' };
  });
  afterEach(() => {
    stubbed.forEach(k => (globalThis[k] = originals[k]));
    delete COURSES[CID];
  });

  it('By week: overdue names, marks, a link to the newest note, and no native titles', () => {
    obs = {
      s1: [
        {
          id: 'ob-new',
          date: '2026-10-14',
          created: '2026-10-14T15:00:00Z',
          sentiment: 'strength',
          text: 'Asked a <good> question',
        },
        { id: 'ob-old', date: '2026-10-13', created: '2026-10-13T15:00:00Z', sentiment: null, text: 'Note' },
      ],
      s2: [{ id: 'ob-b', date: '2026-09-01', created: '2026-09-01T15:00:00Z', sentiment: 'concern', text: 'Late' }],
    };
    const state = { tab: 'week' };
    const html = DashObservations.renderCard(CID, students, state);
    expect(html).toContain('last 8 weeks');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('<b>1</b> not observed in 3+ weeks');
    expect(html).toContain('<b>1</b> with no strength recorded');
    expect(html).toMatch(/class="dash-ob2-name is-overdue"[^>]*>Ben N\.<\/a>/);
    expect(html).not.toMatch(/class="dash-ob2-name is-overdue"[^>]*>Ada L\./);
    expect(html).toContain('data-href="#/student?id=s1&course=' + CID + '&ob=ob-new"');
    expect(html).toContain('<i data-type="strength"></i><i data-type="none"></i>');
    expect(html).toContain('47d');
    expect(html).not.toMatch(/\stitle="/);
    expect(DashObservations.popoverHtml('s1', 7)).toContain('Asked a &lt;good&gt; question');
    expect(DashObservations.popoverHtml('s1', 7)).toContain('Click to open in Ada’s Evidence panel');
  });

  it('By week: a Note is a yellow mark and in the legend, and never counts as a strength', () => {
    obs = {
      s1: [
        { id: 'ob-n1', date: '2026-10-14', created: '2026-10-14T15:00:00Z', sentiment: 'note', text: 'Away' },
        { id: 'ob-n2', date: '2026-10-13', created: '2026-10-13T15:00:00Z', sentiment: null, text: 'Untyped' },
      ],
      s2: [{ id: 'ob-s', date: '2026-10-14', created: '2026-10-14T15:00:00Z', sentiment: 'strength', text: 'Good' }],
    };
    const html = DashObservations.renderCard(CID, students, { tab: 'week' });
    const key = html.match(/<div class="dash-ob2-key">.*?<\/div>/)[0];
    expect(key.match(/data-type="(\w+)"/g)).toEqual([
      'data-type="strength"',
      'data-type="growth"',
      'data-type="concern"',
      'data-type="note"',
      'data-type="none"',
    ]);
    expect(key).toContain('</i>Note</span>');
    expect(html).toContain('<i data-type="note"></i><i data-type="none"></i>');
    expect(html).toContain('1 note, 1 with no type');
    expect(html).toContain('<b>1</b> with no strength recorded');
    expect(DashObservations.popoverHtml('s1', 7)).toMatch(/data-type="note"[^>]*>Note</);
  });

  it('a busy week shows 3 marks and "+N" in a cell wide enough to hold them', () => {
    obs = {
      s1: Array.from({ length: 5 }, (_, i) => ({
        id: 'ob-' + i,
        date: '2026-10-14',
        created: '2026-10-14T15:0' + i + ':00Z',
        sentiment: 'strength',
        text: 'n',
      })),
    };
    const html = DashObservations.renderCard(CID, students, { tab: 'week', width: 2000 });
    const cell = html.match(/<a class="dash-ob2-cell has has-more"[^>]*>(.*?)<\/a>/);
    expect(cell).toBeTruthy();
    expect(cell[1].match(/<i /g)).toHaveLength(3);
    expect(cell[1]).toContain('<span class="dash-ob2-more">+2</span>');
    // 3 marks of 5px, 1px gaps, "+N" or "9+" at 9px, a 1px border each side.
    expect(DashObservations.MIN_CELL.week).toBeGreaterThanOrEqual(34);
    expect(DashObservations.lastModel().minCell).toBe(DashObservations.MIN_CELL.week);
  });

  it('says so when nobody is overdue or short of a strength', () => {
    obs = {
      s1: [{ id: 'a', date: '2026-10-16', sentiment: 'strength', text: 'n' }],
      s2: [{ id: 'b', date: '2026-10-15', sentiment: 'strength', text: 'n' }],
    };
    const html = DashObservations.renderCard(CID, students, { tab: 'week' });
    expect(html).toContain('Everyone has an observation in the last 3 weeks.');
    expect(html).not.toContain('dash-ob2-flag"');
  });

  it('a class with no observations has no amber names and no flags', () => {
    const html = DashObservations.renderCard(CID, students, { tab: 'week' });
    expect(html).toContain('No observations recorded yet.');
    expect(html).not.toContain('is-overdue');
    expect(html).not.toContain('data-action="obsFlag"');
  });

  it('drops a highlight whose flag is gone', () => {
    obs = { s1: [{ id: 'a', date: '2026-10-16', sentiment: 'strength', text: 'n' }] };
    const state = { tab: 'week', highlight: 'nostr' };
    DashObservations.renderCard(CID, students, state);
    expect(state.highlight).toBeNull();
    const kept = { tab: 'week', highlight: 'overdue' };
    const html = DashObservations.renderCard(CID, students, kept);
    expect(kept.highlight).toBe('overdue');
    expect(html).toMatch(/class="dash-ob2-row is-dim" data-ob2-navrow data-sid="s1"/);
  });

  it('By competency: levels, evidence counts, and dashed "none" gaps', () => {
    scores = { s1: { t1: [{ assessmentId: 'a1', score: 3 }], 'sec1:level': 3 } };
    obs = { s1: [{ id: 'x', date: '2026-10-10', competencyId: 't2', text: 'n' }] };
    const html = DashObservations.renderCard(CID, students, { tab: 'competency' });
    expect(html).toContain('all time');
    expect(html).toContain('aria-label="Questioning and Predicting: Question and Predict"');
    expect(html).toMatch(/dash-ob2-lv lv-3[^>]*>3\.0 <small>1<\/small>/);
    // An observation alone is evidence: a dash for the level, not a gap.
    expect(html).toMatch(/dash-ob2-lv is-neutral[^>]*>— <small>1<\/small>/);
    // Ben has nothing on either competency.
    expect((html.match(/>none</g) || []).length).toBe(2);
    expect(html).toContain('<span class="dash-ob2-gaps">2</span>');
    expect(html).toContain('<b>1</b> has a competency with no evidence');
    expect(html).toContain('Extending');
  });

  it('By competency counts only evidence inside the picked term', () => {
    term = { label: 'Term 1', startsOn: '2026-09-01', endsOn: '2026-11-30' };
    obs = {
      s1: [
        { id: 'in', date: '2026-10-10', competencyId: 't1', text: 'n' },
        { id: 'out', date: '2026-06-10', competencyId: 't2', text: 'n' },
      ],
    };
    const html = DashObservations.renderCard(CID, students, { tab: 'competency' });
    expect(html).toContain('Term 1');
    expect(html).toContain('<span class="dash-ob2-gaps">1</span>');
  });

  it('a Letter class shows grades as % and no proficiency words', () => {
    COURSES[CID].gradingSystem = 'letter';
    scores = { s1: { t1: [{ assessmentId: 'a1', score: 3 }], 'sec1:level': 3 } };
    const html = DashObservations.renderCard(CID, students, { tab: 'competency' });
    expect(html).toContain('75% <small>1</small>');
    expect(html).not.toMatch(/Extending|Proficient|Developing|Emerging/);
  });

  it('shows plain lines for an empty class or a class with no competencies', () => {
    expect(DashObservations.renderCard(CID, [], { tab: 'week' })).toContain('No students yet.');
    expect(DashObservations.renderCard(CID, [], { tab: 'week' })).not.toContain('role="tablist"');
    globalThis.getSections = () => [];
    const html = DashObservations.renderCard(CID, students, { tab: 'competency' });
    expect(html).toContain('This class has no curricular competencies yet.');
    expect(html).not.toContain('data-action="obsFlag"');
  });

  it('the overview keeps working without the card state (older callers)', () => {
    const html = DashOverview.renderOverviewPanel({
      cid: CID,
      sections: [],
      allStudents: students,
      assessments: [],
      tagCoveragePct: 0,
      sectionClassAvgs: [],
      tagsWithEvidence: 0,
      allTags: [],
      tagCoverageMap: {},
      assessedCCs: new Set(),
      ccCounts: {},
      ccAssessments: {},
      actionItems: [],
    });
    expect(html).toContain('id="dash-obs-card"');
    expect(html).not.toContain('dash-obs-grid');
    // Every opened element is closed inside the panel.
    const opens = (html.match(/<div\b/g) || []).length + (html.match(/<section\b/g) || []).length;
    const closes = (html.match(/<\/div>/g) || []).length + (html.match(/<\/section>/g) || []).length;
    expect(closes).toBe(opens);
  });
});

describe('DashStudentCards observation line', () => {
  const o = (date, sentiment) => ({ date, created: date + 'T15:00:00.000Z', sentiment, text: 'n' });
  const today = '2026-10-18';

  it('shows the three newest types, newest first', () => {
    const s = DashStudentCards.obsSummary(
      [o('2026-10-16', 'concern'), o('2026-10-10', null), o('2026-10-01', 'strength'), o('2026-09-01', 'growth')],
      today,
      null,
    );
    expect(s.dots).toEqual(['concern', 'none', 'strength']);
  });

  it('counts days since the last observation, amber at 21 and not at 20', () => {
    expect(DashStudentCards.obsSummary([o('2026-09-28')], today, null)).toMatchObject({
      daysSince: 20,
      overdue: false,
    });
    expect(DashStudentCards.obsSummary([o('2026-09-27')], today, null)).toMatchObject({
      daysSince: 21,
      overdue: true,
    });
  });

  it('counts this term when a term is active, all time when none is', () => {
    const obs = [o('2026-10-16'), o('2026-09-10'), o('2026-06-01')];
    const term = { startsOn: '2026-09-01', endsOn: '2026-11-30' };
    expect(DashStudentCards.obsSummary(obs, today, term)).toMatchObject({ count: 2, inTerm: true });
    expect(DashStudentCards.obsSummary(obs, today, null)).toMatchObject({ count: 3, inTerm: false });
  });

  it('reads the day from created when an observation has no date', () => {
    const s = DashStudentCards.obsSummary([{ created: '2026-10-17T20:00:00.000Z', text: 'n' }], today, null);
    expect(s.daysSince).toBe(1);
  });

  it('words the line plainly', () => {
    expect(DashStudentCards.obsWhenText(null)).toBe('No observations yet');
    expect(DashStudentCards.obsWhenText(0)).toBe('Last observed today');
    expect(DashStudentCards.obsWhenText(1)).toBe('Last observed yesterday');
    expect(DashStudentCards.obsWhenText(5)).toBe('Last observed 5 days ago');
  });

  it('is not amber for a student with no observations', () => {
    expect(DashStudentCards.obsSummary([], today, null)).toMatchObject({ daysSince: null, overdue: false, count: 0 });
  });
});

describe('days since an evening observation after a reload', () => {
  beforeEach(() => {
    vi.stubGlobal('Date', PdtDate);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says yesterday the next day, not today', () => {
    // 6:30 pm PDT on Oct 18; the UTC day is already Oct 19.
    const blob = _observationsPayloadToBlob({
      observations: [{ id: 'ob1', body: 'Evening note', enrollment_ids: ['stu1'], created_at: '2026-10-19T01:30:00Z' }],
    });
    const s = DashStudentCards.obsSummary(blob.stu1, '2026-10-19', null);
    expect(s.daysSince).toBe(1);
    expect(DashStudentCards.obsWhenText(s.daysSince)).toBe('Last observed yesterday');
  });
});
