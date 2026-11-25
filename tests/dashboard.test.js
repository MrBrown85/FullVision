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

    it('renders only non-archived course options and Class Settings, with no count', () => {
      const html = DashOverview.renderDashToolbar({
        activeCourse: 'c1',
        students: [{ id: 's1' }, { id: 's2' }],
      });

      expect(html).toContain('Alpha');
      expect(html).not.toContain('Archived');
      expect(html).toContain('data-action="openClassManager"');
      expect(html).not.toContain('Students');
      expect(html).not.toContain('dash-toolbar-label');
      expect(html).not.toContain('dash-search-input');
      // No term picker: the dashboard always shows the year so far (Colin, 2026-11-03).
      expect(html).not.toContain('data-action="setTerm"');
      expect(html).not.toContain('All Time');
    });

    it('puts search, Show and sort in the Students heading with their state', () => {
      const html = DashOverview.studentControlsHtml({
        sortMode: 'overall-desc',
        searchQuery: 'noor',
        showFlaggedOnly: true,
        flagCount: 3,
      });

      expect(html).toContain('value="overall-desc" selected');
      expect(html).toContain('value="noor"');
      // Show: Flagged is pressed and carries its count in a badge; All is not.
      expect(html).toMatch(/data-action="dashShow" data-show="all"/);
      expect(html).toMatch(/aria-pressed="true" data-action="dashShow" data-show="flagged"/);
      expect(html).toContain('aria-label="Show flagged students only, 3 flagged"');
      expect(html).toContain('<span class="atb-badge atb-badge-blue" data-n="flagged">3</span>');
      expect(html).not.toContain('Flagged (3)');
      expect(html).not.toContain('dash-filter-chip');
    });

    it('draws no badge while nothing is flagged', () => {
      const html = DashOverview.studentControlsHtml({
        sortMode: 'last-asc',
        searchQuery: '',
        showFlaggedOnly: false,
        flagCount: 0,
      });
      expect(html).toContain('data-show="flagged"');
      expect(html).not.toContain('atb-badge');
      expect(html).toContain('aria-label="Show flagged students only"');
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
   * The observation helpers left in teacher/dash-observations.js after the
   * Dashboard's Observations grid was removed (docs/DECISIONS.md,
   * "Observations off the Dashboard"): row names and the Observations page
   * roster's days.
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

  describe('DashObservations roster mark', () => {
    const today = '2026-10-18';
    it('counts days since the newest observation, amber from 21 days', () => {
      expect(D().rosterMark([ob('2026-10-18')], today, true)).toMatchObject({ text: 'Today', overdue: false });
      expect(D().rosterMark([ob('2026-10-17')], today, true)).toMatchObject({
        text: '1d',
        title: 'Last observed yesterday',
      });
      expect(D().rosterMark([ob('2026-09-28'), ob('2026-10-01')], today, true)).toMatchObject({
        text: '17d',
        overdue: false,
      });
      expect(D().rosterMark([ob('2026-09-27')], today, true)).toMatchObject({
        text: '21d',
        overdue: true,
        title: 'Last observed 21 days ago',
      });
    });

    it('says None for a student never observed, amber, once the class has observations', () => {
      expect(D().rosterMark([], today, true)).toMatchObject({ text: 'None', overdue: true });
    });

    it('marks nobody in a class with no observations at all', () => {
      expect(D().rosterMark([], today, false)).toMatchObject({ text: '', overdue: false });
    });

    it('reads the day from created when an observation has no date', () => {
      expect(D().rosterMark([{ created: '2026-10-11T15:00:00.000Z' }], today, true).text).toBe('7d');
    });
  });

  describe('DashObservations labels', () => {
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
      // The sort moved to DashInsights.sortStudents (teacher/dash-insights.js).
      const src = readFileSync(resolve(root, 'teacher/dash-insights.js'), 'utf-8');
      const block = src.slice(src.indexOf("case 'overall-desc':"), src.indexOf("case 'flagged':"));
      expect(block).toContain('studentOverallSortValue(cid, a.id)');
      expect(block).not.toContain('getOverallProficiency');
    });
  });
});
