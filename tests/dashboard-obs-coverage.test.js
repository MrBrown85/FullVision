import './setup.js';
import { PdtDate } from './helpers/pdt-date.js';

const ob = (date, sentiment = null, text = 'note') => ({ date, sentiment, text });

describe('DashOverview observation coverage', () => {
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

  describe('obsCellTint', () => {
    it('is empty with no observations', () => {
      expect(DashOverview.obsCellTint([])).toBe('empty');
    });

    it('follows the type with the most observations', () => {
      expect(DashOverview.obsCellTint([ob('d', 'strength'), ob('d', 'strength'), ob('d', 'concern')])).toBe('strength');
      expect(DashOverview.obsCellTint([ob('d', 'growth')])).toBe('growth');
      expect(DashOverview.obsCellTint([ob('d', 'concern'), ob('d', null), ob('d', null)])).toBe('concern');
    });

    it('is mixed on a tie and neutral when nothing is typed', () => {
      expect(DashOverview.obsCellTint([ob('d', 'strength'), ob('d', 'concern')])).toBe('mixed');
      expect(DashOverview.obsCellTint([ob('d', null)])).toBe('neutral');
    });
  });

  describe('obsCoverageTerm', () => {
    const terms = [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-20' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-23', ends_on: '2027-01-29' },
    ];

    it('uses the picker term when one is set', () => {
      const active = { ordinal: 2, label: 'Term 2', startsOn: '2026-11-23', endsOn: '2027-01-29' };
      expect(DashOverview.obsCoverageTerm(terms, active, '2026-10-18')).toBe(active);
    });

    it('falls back to the term today is in', () => {
      expect(DashOverview.obsCoverageTerm(terms, null, '2026-10-18')).toMatchObject({
        ordinal: 1,
        startsOn: '2026-09-02',
        endsOn: '2026-11-20',
      });
    });

    it('is null when today is in no term or the class has none', () => {
      expect(DashOverview.obsCoverageTerm(terms, null, '2027-03-01')).toBeNull();
      expect(DashOverview.obsCoverageTerm([], null, '2026-10-18')).toBeNull();
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

  describe('obsCoverageRows', () => {
    it('buckets observations by week in roster order and flags overdue students', () => {
      const students = [{ id: 'b' }, { id: 'a' }];
      const weeks = ['2026-09-28', '2026-10-05', '2026-10-12'];
      const rows = DashOverview.obsCoverageRows(
        students,
        {
          a: [ob('2026-10-14', 'growth'), ob('2026-10-13', 'growth'), ob('2026-08-01', 'strength')],
          b: [ob('2026-09-20', 'concern')],
        },
        weeks,
        '2026-10-18',
      );
      expect(rows.map(r => r.student.id)).toEqual(['b', 'a']);
      expect(rows[0].overdue).toBe(true);
      expect(rows[0].cells.map(c => c.tint)).toEqual(['empty', 'empty', 'empty']);
      expect(rows[1].overdue).toBe(false);
      expect(rows[1].cells[2].obs).toHaveLength(2);
      expect(rows[1].cells[2].tint).toBe('growth');
    });

    it('skips observations with a missing or malformed date', () => {
      const rows = DashOverview.obsCoverageRows(
        [{ id: 'a' }],
        { a: [ob(''), ob('not a date'), ob(null), ob('2026-10-13', 'strength')] },
        ['2026-10-12'],
        '2026-10-18',
      );
      expect(rows[0].cells[0].obs).toHaveLength(1);
      expect(rows[0].lastDate).toBe('2026-10-13');
      expect(rows[0].overdue).toBe(false);
    });
  });

  describe('rendering', () => {
    const stubbed = ['getTodayStr', 'getReportingTerms', 'getActiveTerm', 'getStudentQuickObs'];
    const originals = {};
    beforeEach(() => {
      stubbed.forEach(k => (originals[k] = globalThis[k]));
      globalThis.getTodayStr = () => '2026-10-18';
      globalThis.getReportingTerms = () => [];
      globalThis.getActiveTerm = () => null;
    });
    afterEach(() => {
      stubbed.forEach(k => (globalThis[k] = originals[k]));
    });

    it('names overdue students as chips and links cells to the observations page', () => {
      const obs = { s1: [ob('2026-10-14', 'strength', 'Asked a <good> question')], s2: [] };
      globalThis.getStudentQuickObs = (cid, sid) => obs[sid] || [];
      const students = [
        { id: 's1', firstName: 'Ada', lastName: 'Lee' },
        { id: 's2', firstName: 'Ben', lastName: 'Ng' },
      ];
      const data = DashOverview.obsCoverageData('c1', students);
      const html = DashOverview.renderObsOverdue('c1', students, data) + DashOverview.renderObsCoverageGrid('c1', data);
      expect(html).toContain('1 student has no observation in 3+ weeks');
      expect(html).toMatch(/class="dash-obs-chip" href="#\/student\?id=s2&course=c1"/);
      expect(html).not.toMatch(/dash-obs-chip" href="#\/student\?id=s1/);
      expect(html).toContain('href="#/observations?course=c1&student=s1"');
      expect(html).toContain('dash-obs-tint-strength');
      expect(html).toContain('Asked a &lt;good&gt; question');
      expect(html).toContain('Observations by week, last 8 weeks');
    });

    it('says everyone is observed when nobody is overdue', () => {
      globalThis.getStudentQuickObs = () => [ob('2026-10-16', 'growth')];
      const students = [{ id: 's1', firstName: 'Ada', lastName: 'Lee' }];
      const html = DashOverview.renderObsOverdue('c1', students, DashOverview.obsCoverageData('c1', students));
      expect(html).toContain('Everyone observed in the last 3 weeks');
      expect(html).not.toContain('dash-obs-chip');
    });
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
