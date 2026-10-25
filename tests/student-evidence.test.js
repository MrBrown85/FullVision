/**
 * The student page's Evidence panel — teacher/student-evidence.js.
 *
 * Timeline layout (term span, all-time span, gaps over 14 days, the gap up
 * to today), the tab filters and counts, competency grouping, and the
 * panel itself in a DOM: tabs, cards, add and Undo delete.
 */
import './setup.js';
import { vi } from 'vitest';

const H = StudentEvidence._helpers;
const ob = (id, date, extra = {}) => ({ id, date, created: date + 'T15:00:00.000Z', text: 'Note ' + id, ...extra });

describe('timelineLayout', () => {
  const term = { ordinal: 1, label: 'Term 1', startsOn: '2026-09-01', endsOn: '2026-11-30' };

  it('spans the term and places marks by date', () => {
    const L = H.timelineLayout([ob('a', '2026-09-01'), ob('b', '2026-11-30'), ob('c', '2026-10-16')], {
      today: '2026-10-18',
      term,
    });
    expect(L.start).toBe('2026-09-01');
    expect(L.end).toBe('2026-11-30');
    expect(L.spanDays).toBe(90);
    const x = Object.fromEntries(L.marks.map(m => [m.id, m.x]));
    expect(x.a).toBe(0);
    expect(x.b).toBe(1);
    expect(x.c).toBeCloseTo(45 / 90);
    expect(L.today).toBeCloseTo(47 / 90);
  });

  it('leaves out observations outside the term', () => {
    const L = H.timelineLayout([ob('in', '2026-10-01'), ob('before', '2026-08-20'), ob('after', '2026-12-05')], {
      today: '2026-10-18',
      term,
    });
    expect(L.marks.map(m => m.id)).toEqual(['in']);
  });

  it('runs from the first observation to today with no term', () => {
    const L = H.timelineLayout([ob('b', '2026-10-01'), ob('a', '2026-09-10')], { today: '2026-10-18', term: null });
    expect(L.start).toBe('2026-09-10');
    expect(L.end).toBe('2026-10-18');
    expect(L.marks.map(m => m.id)).toEqual(['a', 'b']);
    expect(L.marks[0].x).toBe(0);
    expect(L.today).toBe(1);
  });

  it('draws nothing for all time with no observations, but shows an empty term', () => {
    expect(H.timelineLayout([], { today: '2026-10-18', term: null })).toBeNull();
    const L = H.timelineLayout([], { today: '2026-10-18', term });
    expect(L.marks).toEqual([]);
    expect(L.gaps).toEqual([{ from: '2026-09-01', to: '2026-10-18', days: 47, x0: 0, x1: 47 / 90, toToday: true }]);
  });

  it('marks a gap over 14 days and none at exactly 14', () => {
    const L = H.timelineLayout(
      [ob('a', '2026-09-01'), ob('b', '2026-09-15'), ob('c', '2026-10-01'), ob('d', '2026-10-18')],
      {
        today: '2026-10-18',
        term,
      },
    );
    // Sep 1 → Sep 15 is 14 days: no gap. Sep 15 → Oct 1 is 16: a gap. Oct 1 → Oct 18 is 17.
    expect(L.gaps.map(g => [g.from, g.to, g.days])).toEqual([
      ['2026-09-15', '2026-10-01', 16],
      ['2026-10-01', '2026-10-18', 17],
    ]);
    expect(L.gaps[1].toToday).toBe(false); // an observation today ends it
  });

  it('counts the stretch from the last observation up to today', () => {
    const L = H.timelineLayout([ob('a', '2026-09-20')], { today: '2026-10-18', term: null });
    expect(L.gaps).toHaveLength(1);
    expect(L.gaps[0]).toMatchObject({ from: '2026-09-20', to: '2026-10-18', days: 28, toToday: true });
    expect(L.gaps[0].x1).toBe(1);
  });

  it('counts the start of the term as the first point, and stops at the term end', () => {
    const past = { startsOn: '2026-02-01', endsOn: '2026-03-31' };
    const L = H.timelineLayout([ob('a', '2026-02-20'), ob('b', '2026-03-01')], { today: '2026-10-18', term: past });
    expect(L.gaps.map(g => [g.from, g.to, g.days])).toEqual([
      ['2026-02-01', '2026-02-20', 19],
      ['2026-03-01', '2026-03-31', 30],
    ]);
    expect(L.today).toBeNull();
  });

  it('squares assessment-linked marks, types them, and stacks a busy day', () => {
    const L = H.timelineLayout(
      [
        ob('a', '2026-10-10', { sentiment: 'strength' }),
        ob('b', '2026-10-10', { assignmentContext: { assessmentId: 'x1' }, created: '2026-10-10T16:00:00.000Z' }),
        ob('c', '2026-10-12', { sentiment: 'bogus' }),
      ],
      { today: '2026-10-18', term },
    );
    expect(L.marks.map(m => [m.id, m.shape, m.type, m.stack])).toEqual([
      ['a', 'circle', 'strength', 0],
      ['b', 'square', 'none', 1],
      ['c', 'circle', 'none', 0],
    ]);
  });

  it('ticks months on a long span and Mondays on a short one', () => {
    const long = H.timelineLayout([], { today: '2026-10-18', term });
    expect(long.weekly).toBe(false);
    expect(long.ticks.map(t => t.label)).toEqual(['Sep', 'Oct', 'Nov']);
    const short = H.timelineLayout([ob('a', '2026-10-01')], { today: '2026-10-18', term: null });
    expect(short.weekly).toBe(true);
    expect(short.ticks.map(t => t.label)).toEqual(['Oct 5', 'Oct 12']);
  });

  it('gives a one-day all-time strip a week of width', () => {
    const L = H.timelineLayout([ob('a', '2026-10-18')], { today: '2026-10-18', term: null });
    expect(L.spanDays).toBe(7);
    expect(L.marks[0].x).toBe(1);
    expect(L.gaps).toEqual([]);
  });
});

describe('tab filters', () => {
  const obs = [
    ob('a', '2026-10-10', { sentiment: 'concern', competencyId: 't2' }),
    ob('b', '2026-10-09', { assignmentContext: { assessmentId: 'x1', assessmentTitle: 'Lab 1' } }),
    ob('c', '2026-10-08', { sentiment: 'strength', competencyId: 't1' }),
    ob('d', '2026-10-07', { competencyId: 'gone' }),
    ob('e', '2026-10-06', { sentiment: 'concern' }),
  ];

  it('lists each tab', () => {
    expect(H.tabFilter(obs, 'all').map(o => o.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(H.tabFilter(obs, 'assessments').map(o => o.id)).toEqual(['b']);
    expect(H.tabFilter(obs, 'concerns').map(o => o.id)).toEqual(['a', 'e']);
  });

  it('counts each tab; By competency counts the linked ones', () => {
    expect(H.tabCounts(obs)).toEqual({ all: 5, competency: 3, assessments: 1, concerns: 2 });
  });

  it('groups by competency in learning-map order, unknown next, unlinked last', () => {
    const items = [
      { type: 'section', label: 'Questioning' },
      { id: 't1', label: 'Make observations' },
      { id: 't2', label: 'Plan an investigation' },
    ];
    const groups = H.groupByCompetency(obs, items, () => '');
    expect(groups.map(g => [g.label, g.obs.map(o => o.id)])).toEqual([
      ['Make observations', ['c']],
      ['Plan an investigation', ['a']],
      ['Competency', ['d']],
      ['Not linked to a competency', ['b', 'e']],
    ]);
  });
});

describe('Evidence panel in the page', () => {
  let dom;
  const saved = {};
  const swap = (k, v) => {
    if (!(k in saved)) saved[k] = globalThis[k];
    globalThis[k] = v;
  };
  let store;
  let deleted;
  let toast;

  beforeEach(async () => {
    const { parseHTML } = await import('linkedom');
    dom = parseHTML('<!doctype html><html><body><main id="main"></main></body></html>');
    store = [
      ob('o3', '2026-10-16', { sentiment: 'concern', text: 'Left the lab early' }),
      ob('o2', '2026-10-01', {
        assignmentContext: { assessmentId: 'a1', assessmentTitle: 'Lab 1' },
        text: 'Strong graph',
      }),
      ob('o1', '2026-09-20', { sentiment: 'strength', text: 'Asked a sharp question' }),
    ];
    deleted = [];
    toast = null;
    swap('document', dom.document);
    swap('getStudents', () => [{ id: 's1', firstName: 'Mei', lastName: 'Wong' }]);
    swap('getStudentQuickObs', () => store.map(o => ({ ...o })));
    swap('getAllQuickObs', () => store.map(o => ({ ...o, studentId: 's1' })));
    swap('getTodayStr', () => '2026-10-18');
    swap('getActiveTerm', () => null);
    swap('getTermRatings', () => ({}));
    swap('getReportingTerms', () => []);
    swap('getAssessments', () => []);
    swap('getSections', () => []);
    swap('deleteQuickOb', (cid, sid, id) => {
      deleted.push(id);
      store = store.filter(o => o.id !== id);
    });
    swap('addQuickOb', (cid, sid, text, dims, sentiment) => {
      store.unshift(ob('o4', '2026-10-18', { text, sentiment, created: '2026-10-18T18:00:00.000Z' }));
      return true;
    });
    swap('showUndoToast', (msg, undo, commit) => {
      toast = { msg, undo, commit };
    });
    dom.document.getElementById('main').innerHTML = StudentEvidence.panelHtml();
    StudentEvidence.mount('c1', 's1');
  });

  afterEach(() => {
    StudentEvidence.destroy();
    Object.keys(saved).forEach(k => (globalThis[k] = saved[k]));
    Object.keys(saved).forEach(k => delete saved[k]);
  });

  const $ = sel => dom.document.querySelector(sel);
  const $$ = sel => Array.from(dom.document.querySelectorAll(sel));
  const tabText = () => $$('.ev-tab').map(t => t.textContent.replace(/\s+/g, ' ').trim());
  const cardIds = () => $$('#ev-list .obs-card').map(c => c.getAttribute('data-obid'));

  it('shows one Evidence panel with tabs, counts and cards newest first, without the name', () => {
    expect($('#ev-title').textContent).toBe('Observations');
    expect(tabText()).toEqual(['All 3', 'By competency 0', 'Assessments 1', 'Concerns 1']);
    expect(cardIds()).toEqual(['o3', 'o2', 'o1']);
    expect($('#ev-list .obs-card-student')).toBeNull();
    expect($('#ev-list .obs-card-with')).toBeNull();
    expect($('#ev-list .obs-card').getAttribute('data-action')).toBeNull();
  });

  it('draws a mark per observation and labels the gap', () => {
    expect($$('.ev-tl-mark').map(m => m.getAttribute('data-obid'))).toEqual(['o1', 'o2', 'o3']);
    expect($('.ev-tl-mark[data-obid="o2"]').getAttribute('data-shape')).toBe('square');
    expect($('.ev-tl-mark[data-obid="o3"]').getAttribute('aria-label')).toBe('Oct 16 · Concern: Left the lab early');
    // Sep 20 → Oct 1 is 11 days, Oct 1 → Oct 16 is 15, Oct 16 → today is 2.
    expect($$('.ev-tl-gap-label').map(g => g.textContent)).toEqual(['No observations for 15 days']);
    expect($('.ev-tl-range').textContent).toBe('All time · Sep 20 to today');
  });

  it('switches tabs', () => {
    $('[data-ev-tab="concerns"]').click();
    expect(cardIds()).toEqual(['o3']);
    expect($('#ev-tab-concerns').getAttribute('aria-selected')).toBe('true');
    $('[data-ev-tab="assessments"]').click();
    expect(cardIds()).toEqual(['o2']);
    $('[data-ev-tab="competency"]').click();
    expect($('.ev-group-title').textContent).toContain('Not linked to a competency');
    expect(cardIds()).toEqual(['o3', 'o2', 'o1']);
  });

  it('search filters the active tab and its counts', () => {
    const input = $('#ev-search');
    input.value = 'lab';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    // "Left the lab early" by text, "Strong graph" by its assessment title.
    expect(cardIds()).toEqual(['o3', 'o2']);
    expect(tabText()).toEqual(['All 2', 'By competency 0', 'Assessments 1', 'Concerns 1']);
    $('[data-ev-tab="concerns"]').click();
    expect(cardIds()).toEqual(['o3']);
    input.value = 'zebra';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect($('#ev-list').textContent).toContain('Nothing here matches');
  });

  it('a timeline mark opens the All tab on its card', () => {
    $('[data-ev-tab="concerns"]').click();
    $('.ev-tl-mark[data-obid="o1"]').click();
    expect($('#ev-tab-all').getAttribute('aria-selected')).toBe('true');
    expect($('#ev-list .obs-card[data-obid="o1"]').classList.contains('ev-card-hit')).toBe(true);
  });

  it('delete hides the card, Undo brings it back, and the toast closing deletes', () => {
    $('#ev-list .obs-card[data-obid="o2"] .obs-card-delete').click();
    expect(cardIds()).toEqual(['o3', 'o1']);
    expect($$('.ev-tl-mark').length).toBe(2);
    expect(toast.msg).toBe('Observation deleted');
    toast.undo();
    expect(cardIds()).toEqual(['o3', 'o2', 'o1']);
    expect(deleted).toEqual([]);

    $('#ev-list .obs-card[data-obid="o2"] .obs-card-delete').click();
    toast.commit();
    expect(deleted).toEqual(['o2']);
    expect(cardIds()).toEqual(['o3', 'o1']);
  });

  it('adding through the strip shows the new card and its mark', () => {
    const box = $('#note-capture');
    expect(box.querySelector('#note-capture-input')).toBeTruthy();
    expect(box.querySelector('#note-student-btn')).toBeNull();
    expect(box.textContent).toContain('Mei Wong');
    const cap = StudentEvidence.mountCapture('c1', 's1', box);
    cap.setText('Helped a partner');
    cap.submit();
    expect(cardIds()[0]).toBe('o4');
    expect($('.ev-tl-mark[data-obid="o4"]')).toBeTruthy();
    expect(tabText()[0]).toBe('All 4');
  });

  it('tells the page after an add, a delete and an Undo, and reports a pending delete', () => {
    const onChange = vi.fn();
    StudentEvidence.mount('c1', 's1', { onChange });
    const cap = StudentEvidence.mountCapture('c1', 's1', $('#note-capture'));
    cap.setText('Helped a partner');
    cap.submit();
    expect(onChange).toHaveBeenCalledTimes(1);
    $('#ev-list .obs-card[data-obid="o2"] .obs-card-delete').click();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(StudentEvidence.isPending('o2')).toBe(true);
    toast.undo();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(StudentEvidence.isPending('o2')).toBe(false);
  });

  it('says so in a sentence when there is nothing yet', () => {
    store = [];
    StudentEvidence.refresh();
    expect($('#ev-list').textContent).toBe('No observations yet. Add one above.');
    expect($('#ev-timeline').innerHTML).toBe('');
    $('[data-ev-tab="concerns"]').click();
    expect($('#ev-list').textContent).toBe('No concerns recorded.');
  });
});
