/**
 * dashboard: the tests that were tests/dashboard-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { PdtDate } from './helpers/pdt-date.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

describe('dashboard-helpers', () => {
  describe('DashOverview.renderDashToolbar', () => {
    beforeEach(() => {
      Object.keys(COURSES).forEach(key => delete COURSES[key]);
      COURSES.c1 = { name: 'Alpha' };
      COURSES.c2 = { name: 'Archived', archived: true };
      globalThis.isCourseArchived = cid => !!(COURSES[cid] && COURSES[cid].archived);
    });

    it('renders only non-archived course options and the count', () => {
      const html = DashOverview.renderDashToolbar({
        activeCourse: 'c1',
        students: [{ id: 's1' }, { id: 's2' }],
      });

      expect(html).toContain('Alpha');
      expect(html).not.toContain('Archived');
      expect(html).toContain('2 Students');
      expect(html).not.toContain('dash-search-input');
      // No term picker: the dashboard always shows the year so far (Colin, 2026-11-03).
      expect(html).not.toContain('data-action="setTerm"');
      expect(html).not.toContain('All Time');
    });

    it('puts search, sort and Flagged in the Students heading with their state', () => {
      const html = DashOverview.studentControlsHtml({
        sortMode: 'overall-desc',
        searchQuery: 'noor',
        showFlaggedOnly: true,
        flagCount: 3,
      });

      expect(html).toContain('value="overall-desc" selected');
      expect(html).toContain('value="noor"');
      expect(html).toContain('Flagged (3)');
    });

    it('shows a grid column sort as the selected line of the sort menu', () => {
      const html = DashOverview.studentControlsHtml({
        sortMode: 'col:s:QAP:desc',
        extraSort: { value: 'col:s:QAP:desc', label: 'Questioning High\u2192Low' },
        searchQuery: '',
        showFlaggedOnly: false,
        flagCount: 0,
      });
      expect(html).toContain('<option value="col:s:QAP:desc" selected>Questioning High\u2192Low</option>');
    });
  });

  describe('DashInsights.gridSortOf', () => {
    it('reads the column and direction from the sort mode', () => {
      expect(DashInsights.gridSortOf('last-asc')).toEqual({ key: 'name', dir: 'asc' });
      expect(DashInsights.gridSortOf('overall-desc')).toEqual({ key: 'overall', dir: 'desc' });
      expect(DashInsights.gridSortOf('col:s:QAP:asc')).toEqual({ key: 'col:s:QAP', dir: 'asc' });
      expect(DashInsights.gridSortOf('obs:desc')).toEqual({ key: 'obs', dir: 'desc' });
      expect(DashInsights.gridSortOf('flagged')).toBeNull();
    });
  });

  describe('DashStudentCards.renderStudentCards', () => {
    beforeEach(() => {
      globalThis.isStudentFlagged = () => false;
      globalThis.getOverallProficiency = () => 0;
      globalThis.getCompletionPct = () => 0;
      globalThis.getStudentQuickObs = () => [];
      globalThis.getGroupedSections = () => ({ groups: [], ungrouped: [] });
      globalThis.getSectionProficiency = () => 0;
    });

    it('renders empty state when no students exist', () => {
      const html = DashStudentCards.renderStudentCards('c1', [], [], [], [], {}, {});
      expect(html).toContain('No students yet');
    });

    it('renders no matches state when filtered list is empty', () => {
      const html = DashStudentCards.renderStudentCards('c1', [], [{ id: 's1' }], [], [], {}, {});
      expect(html).toContain('No matches');
    });
  });
});

describe('dashboard-obs-coverage', () => {
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
      expect(html).toContain('data-href="/student?id=s1&course=' + CID + '&tab=evidence&ob=ob-new"');
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
      });
      // The Observations card is drawn on its own, at the foot of the page
      // (plan F), and keeps working without its state too.
      expect(html).not.toContain('id="dash-obs-card"');
      const obs = DashOverview.obsCardHtml({ cid: CID, allStudents: students });
      expect(obs).toContain('id="dash-obs-card"');
      expect(obs).not.toContain('dash-obs-grid');
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
        observations: [
          { id: 'ob1', body: 'Evening note', enrollment_ids: ['stu1'], created_at: '2026-10-19T01:30:00Z' },
        ],
      });
      const s = DashStudentCards.obsSummary(blob.stu1, '2026-10-19', null);
      expect(s.daysSince).toBe(1);
      expect(DashStudentCards.obsWhenText(s.daysSince)).toBe('Last observed yesterday');
    });
  });
});

describe('dashboard-observations', () => {
  /**
   * The dashboard's Observations card (teacher/dash-observations.js): By week
   * and By competency tabs, flags, the no-strength diamond, and how the
   * students split into columns. docs/DECISIONS.md, "Observations
   * (2026-10-18)", item 4.
   */

  const D = () => globalThis.DashObservations;
  const ob = (date, sentiment = null, extra = {}) => ({
    id: 'o-' + date + '-' + (sentiment || 'none') + '-' + Math.random().toString(36).slice(2, 6),
    date,
    created: date + 'T15:00:00.000Z',
    sentiment,
    text: 'note',
    ...extra,
  });

  describe('DashObservations columns', () => {
    it('uses 1 column up to 15 students, 2 to 30, 3 from 31', () => {
      expect([1, 15, 16, 30, 31, 60].map(n => D().columnRule(n))).toEqual([1, 1, 2, 2, 3, 3]);
    });

    it('uses fewer columns when they do not fit, never fewer than 1', () => {
      const fixed = D().FIXED.week;
      const block = D().blockMinWidth(fixed, 8, 20);
      expect(D().obsGridColumns({ n: 27, cells: 8, minCell: 20, width: 2 * block + 24, fixed })).toBe(2);
      expect(D().obsGridColumns({ n: 27, cells: 8, minCell: 20, width: 2 * block + 23, fixed })).toBe(1);
      expect(D().obsGridColumns({ n: 40, cells: 8, minCell: 20, width: 10, fixed })).toBe(1);
      expect(D().obsGridColumns({ n: 40, cells: 8, minCell: 20, width: 5000, fixed })).toBe(3);
      // No width yet: the rule alone.
      expect(D().obsGridColumns({ n: 20, cells: 8, minCell: 20, width: 0, fixed })).toBe(2);
    });

    it('splits in roster order and pads the shorter columns to the same length', () => {
      const list = Array.from({ length: 7 }, (_, i) => 's' + i);
      expect(D().splitColumns(list, 2)).toEqual([
        ['s0', 's1', 's2', 's3'],
        ['s4', 's5', 's6', null],
      ]);
      const three = D().splitColumns(
        Array.from({ length: 31 }, (_, i) => i),
        3,
      );
      expect(three.map(c => c.length)).toEqual([11, 11, 11]);
      expect(three[2].filter(x => x === null)).toHaveLength(2);
      expect(D().splitColumns(['a'], 1)).toEqual([['a']]);
      expect(D().splitColumns([], 2)).toEqual([]);
    });
  });

  describe('DashObservations week marks', () => {
    it('shows one mark per observation up to 3, newest first', () => {
      const m = D().weekMarks([ob('2026-10-12', 'strength'), ob('2026-10-14', null), ob('2026-10-13', 'concern')]);
      expect(m).toMatchObject({ marks: ['none', 'concern', 'strength'], more: 0, moreLabel: '', total: 3 });
    });

    it('with more than 3, shows every type present once, then the newest, then +N', () => {
      const obs = [
        ob('2026-10-16', 'strength'),
        ob('2026-10-15', 'strength'),
        ob('2026-10-14', 'strength'),
        ob('2026-10-13', 'growth'),
        ob('2026-10-12', 'concern'),
      ];
      const m = D().weekMarks(obs);
      expect(m.marks).toEqual(['strength', 'growth', 'concern']);
      expect(m.more).toBe(2);
      expect(m.moreLabel).toBe('+2');
    });

    it('keeps a concern and an untyped note visible among many strengths', () => {
      const obs = [
        ...Array.from({ length: 6 }, (_, i) => ob('2026-10-1' + i, 'strength')),
        ob('2026-10-09', null),
        ob('2026-10-08', 'concern'),
      ];
      const m = D().weekMarks(obs);
      expect(m.marks.sort()).toEqual(['concern', 'none', 'strength']);
      expect(m.moreLabel).toBe('+5');
    });

    it('reads 9+ from ten more', () => {
      const obs = Array.from({ length: 13 }, (_, i) => ob('2026-10-' + String(10 + (i % 5)), 'growth'));
      expect(D().weekMarks(obs)).toMatchObject({ more: 10, moreLabel: '9+', total: 13 });
    });

    it('counts an unknown sentiment as untyped', () => {
      expect(D().obType({ sentiment: 'mixed' })).toBe('none');
      expect(D().obType({ sentiment: 'growth' })).toBe('growth');
      expect(D().obType({ sentiment: 'note' })).toBe('note');
    });

    it('shows a Note after the three judgement types, before an untyped note', () => {
      const obs = [
        ...Array.from({ length: 4 }, (_, i) => ob('2026-10-1' + i, 'strength')),
        ob('2026-10-09', 'note'),
        ob('2026-10-08', null),
      ];
      expect(D().weekMarks(obs).marks.sort()).toEqual(['none', 'note', 'strength']);
      const all = [
        ob('2026-10-16', null),
        ob('2026-10-15', 'note'),
        ob('2026-10-14', 'concern'),
        ob('2026-10-13', 'growth'),
      ];
      expect(D().weekMarks(all).marks).toEqual(['note', 'concern', 'growth']);
    });
  });

  describe('DashObservations no strength recorded', () => {
    it('needs at least one observation and no strength', () => {
      expect(D().noStrength([])).toBe(false);
      expect(D().noStrength([ob('2026-10-12', 'growth'), ob('2026-10-13', null)])).toBe(true);
      expect(D().noStrength([ob('2026-10-12', 'growth'), ob('2026-10-13', 'strength')])).toBe(false);
    });

    it('never counts a Note as a strength', () => {
      expect(D().noStrength([ob('2026-10-12', 'note'), ob('2026-10-13', 'note')])).toBe(true);
      expect(D().noStrength([ob('2026-10-12', 'note'), ob('2026-10-13', 'strength')])).toBe(false);
    });
  });

  describe('DashObservations week window', () => {
    it('is the last 8 weeks with no term', () => {
      const w = D().weekWindow('2026-10-18', null);
      expect(w.weeks).toHaveLength(8);
      expect(w.weeks[0]).toBe('2026-08-24');
      expect(w.start).toBe('2026-08-24');
      expect(w.end).toBe('2026-10-18');
      expect(w.label).toBe('last 8 weeks');
    });

    it("is the picked term's weeks, bounded by the term's dates", () => {
      const term = { label: 'Term 1', startsOn: '2026-09-02', endsOn: '2026-11-20' };
      const w = D().weekWindow('2026-10-18', term);
      expect(w.weeks[0]).toBe('2026-08-31');
      expect(w.weeks[w.weeks.length - 1]).toBe('2026-10-12');
      expect(w.start).toBe('2026-09-02');
      expect(w.label).toBe('Term 1');
    });

    it('buckets a row by week and keeps overdue measured from today', () => {
      const win = D().weekWindow('2026-10-18', { label: 'Term 1', startsOn: '2026-09-02', endsOn: '2026-11-20' });
      const row = D().weekRow(
        { id: 's1' },
        [ob('2026-09-20', 'growth'), ob('2026-09-01', 'strength'), ob('2026-08-01', 'strength')],
        win,
        '2026-10-18',
      );
      // Sep 1 is before the term starts, though it is in the first week shown.
      expect(row.total).toBe(1);
      expect(row.noStrength).toBe(true);
      expect(row.overdue).toBe(true);
      expect(row.daysSince).toBe(28);
      const cell = row.cells.find(c => c.week === '2026-09-14');
      expect(cell.obs).toHaveLength(1);
    });

    it('reads the day from created when an observation has no date', () => {
      const win = D().weekWindow('2026-10-18', null);
      const row = D().weekRow({ id: 's1' }, [{ id: 'x', created: '2026-10-17T20:00:00.000Z' }], win, '2026-10-18');
      expect(row.total).toBe(1);
      expect(row.overdue).toBe(false);
      expect(row.daysSince).toBe(1);
    });
  });

  describe('DashObservations flags', () => {
    it('lists only flags above 0, per tab', () => {
      expect(
        D()
          .flagList('week', { overdue: 3, noStrength: 0, gap: 4 }, 'last 8 weeks')
          .map(f => f.key),
      ).toEqual(['overdue']);
      expect(
        D()
          .flagList('competency', { overdue: 3, noStrength: 2, gap: 4 }, 'last 8 weeks')
          .map(f => f.key),
      ).toEqual(['gap', 'nostr']);
      expect(D().flagList('week', { overdue: 0, noStrength: 0, gap: 0 }, 'last 8 weeks')).toEqual([]);
    });

    it('words the flags with the right verb and names the window on By competency', () => {
      const one = D().flagList('competency', { gap: 1, noStrength: 1 }, 'last 8 weeks');
      expect(one[0].text).toBe('has a competency with no evidence');
      expect(one[0].aria).toBe('Highlight 1 student with a competency that has no evidence');
      expect(one[1].text).toBe('with no strength recorded in the last 8 weeks');
      const many = D().flagList('competency', { gap: 2, noStrength: 0 }, 'Term 1');
      expect(many[0].text).toBe('have a competency with no evidence');
      expect(D().flagList('competency', { gap: 0, noStrength: 3 }, 'Term 1')[0].text).toBe(
        'with no strength recorded in Term 1',
      );
    });

    it('dims the students a highlight does not match', () => {
      const row = { overdue: true, noStrength: false, gaps: 0 };
      expect(D().rowMatches(row, null)).toBe(true);
      expect(D().rowMatches(row, 'overdue')).toBe(true);
      expect(D().rowMatches(row, 'nostr')).toBe(false);
      expect(D().rowMatches(row, 'gap')).toBe(false);
    });
  });

  describe('DashObservations competency evidence', () => {
    const term = { startsOn: '2026-09-01', endsOn: '2026-11-30' };

    it('counts distinct assessments scored above 0 across the tags, and linked observations', () => {
      const scores = [
        [
          { assessmentId: 'a1', score: 3 },
          { assessmentId: 'a2', score: 0 },
        ],
        [
          { assessmentId: 'a1', score: 2 },
          { assessmentId: 'a3', score: 4 },
        ],
      ];
      const obs = [ob('2026-10-01', null, { competencyId: 't1' }), ob('2026-10-02', null, { competencyId: 'other' })];
      expect(D().sectionEvidenceCount(scores, obs, ['t1', 't2'], null)).toBe(3);
    });

    it('counts only observations inside the term', () => {
      const obs = [ob('2026-06-01', null, { competencyId: 't1' }), ob('2026-10-02', null, { competencyId: 't1' })];
      expect(D().sectionEvidenceCount([], obs, ['t1'], term)).toBe(1);
      expect(D().sectionEvidenceCount([], obs, ['t1'], null)).toBe(2);
    });

    it('is a gap only with no evidence; a level of 0 with evidence is a dash', () => {
      expect(D().competencyCell('c-x', 0, 0)).toMatchObject({ gap: true, level: 0 });
      expect(D().competencyCell('c-x', 0, 2)).toMatchObject({ gap: false, level: 0, text: '—' });
    });

    describe('as the class shows grades', () => {
      const CID = 'c-dash-obs-mode';
      afterEach(() => delete COURSES[CID]);
      const setting = gradingSystem => (COURSES[CID] = { id: CID, name: 'Test', gradingSystem });

      it('shows a level in a Proficiency class', () => {
        setting('proficiency');
        expect(D().competencyCell(CID, 3.33, 4)).toMatchObject({ text: '3.3', level: 3, gap: false });
      });

      it('shows a % and no proficiency word in a Letter class', () => {
        setting('letter');
        const c = D().competencyCell(CID, 3, 4);
        expect(c.text).toBe('75%');
        expect(c.text).not.toMatch(/Extending|Proficient|Developing|Emerging/);
      });

      it('shows both in a Both class', () => {
        setting('both');
        expect(D().competencyCell(CID, 2, 1).text).toBe('2.0 · 50%');
      });
    });
  });

  describe('DashObservations labels', () => {
    it("uses the first tag's label, cut at about 24 characters", () => {
      expect(D().headerLabel({ name: 'Questioning and Predicting', tags: [{ label: 'Question and Predict' }] })).toBe(
        'Question and Predict',
      );
      expect(D().headerLabel({ name: 'Evaluating', tags: [] })).toBe('Evaluating');
      const long = D().headerLabel({ name: 'x', tags: [{ label: 'Communicate scientific ideas and information' }] });
      expect(long.length).toBeLessThanOrEqual(24);
      expect(long.endsWith('…')).toBe(true);
    });

    it('gives the full name as "Section: tag"', () => {
      expect(D().headerFull({ name: 'Questioning and Predicting', tags: [{ label: 'Question and Predict' }] })).toBe(
        'Questioning and Predicting: Question and Predict',
      );
      expect(D().headerFull({ name: 'Evaluating', tags: [{ label: 'Evaluating' }] })).toBe('Evaluating');
    });

    it('shortens a row name to first name and last initial', () => {
      expect(D().rowName({ firstName: 'Christopher', lastName: 'Vance' })).toBe('Christopher V.');
      expect(D().rowName({ firstName: 'Ana', preferred: 'Annie', lastName: 'Lopez' })).toBe('Annie L.');
      expect(D().rowName({ firstName: 'Ana', lastName: '' })).toBe('Ana');
    });
  });
});

describe('dashboard-overall-sort', () => {
  /**
   * The dashboard's Overall sort (the grid's Overall heading and the Overall
   * High→Low / Low→High menu) follows the grade Overall shows. In a Letter
   * class that is the letter and course %, so the sort is by the course %,
   * not the competency proficiency (which is 0 for every student in a
   * points-only class, so the sort did nothing).
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const CID = 'course-sort';

  const points = id => ({ id, title: id, scoreMode: 'points', maxPoints: 100, tagIds: [], type: 'summative' });
  const score = (assessmentId, value) => ({ assessmentId, tagId: '', score: value, date: '2026-10-10' });

  function seed(gradingSystem) {
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [points('essay')];
    _cache.scores[CID] = { low: [score('essay', 48)], high: [score('essay', 72)], none: [] };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  describe('studentOverallSortValue', () => {
    beforeEach(() => localStorage.clear());

    it('is the course % shown in a Letter class', () => {
      seed('letter');
      expect(studentGradeSummary(CID, 'low').text).toContain('48%');
      expect(studentOverallSortValue(CID, 'low')).toBe(48);
      expect(studentOverallSortValue(CID, 'high')).toBe(72);
      expect(studentOverallSortValue(CID, 'none')).toBe(null);
    });

    it('is the overall proficiency in a Proficiency class', () => {
      seed('proficiency');
      expect(studentOverallSortValue(CID, 'high')).toBe(getOverallProficiency(CID, 'high') || null);
    });
  });

  describe('the dashboard Overall sort', () => {
    it('sorts by studentOverallSortValue, not the proficiency', () => {
      const src = readFileSync(resolve(root, 'teacher/page-dashboard.js'), 'utf-8');
      const block = src.slice(src.indexOf("case 'overall-desc':"), src.indexOf("case 'flagged':"));
      expect(block).toContain('studentOverallSortValue(cid, a.id)');
      expect(block).not.toContain('getOverallProficiency');
    });
  });
});
