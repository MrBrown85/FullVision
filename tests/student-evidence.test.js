/**
 * The student page's Evidence panel — teacher/student-evidence.js.
 *
 * Timeline layout (term span, all-time span, gaps over 14 days, the gap up
 * to today), the type chips and counts, Seen in Class, months, and the
 * panel itself in a DOM: chips, private notes kept off screen, cards, add
 * and Undo delete.
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

describe('type chips, Seen in Class and months', () => {
  const obs = [
    ob('a', '2026-10-10', { sentiment: 'concern', competencyId: 't2' }),
    ob('b', '2026-10-09', { assignmentContext: { assessmentId: 'x1', assessmentTitle: 'Lab 1' } }),
    ob('c', '2026-09-08', { sentiment: 'strength', competencyId: 't1' }),
    ob('d', '2026-09-07', { competencyId: 'gone', sentiment: 'note' }),
    ob('e', '2025-06-06', { sentiment: 'concern', competencyId: 't1' }),
  ];

  it('lists each type; a note with no type shows under All only', () => {
    expect(H.typeFilter(obs, 'all').map(o => o.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(H.typeFilter(obs, 'concern').map(o => o.id)).toEqual(['a', 'e']);
    expect(H.typeFilter(obs, 'growth')).toEqual([]);
    expect(H.typeCounts(obs)).toEqual({ all: 5, strength: 1, growth: 0, concern: 2, note: 1 });
  });

  it('counts each competency on the map, in map order, zero included; off-map links are left out', () => {
    const items = [
      { type: 'section', label: 'Questioning' },
      { id: 't1', label: 'Make observations' },
      { id: 't2', label: 'Plan an investigation' },
      { id: 't3', label: 'Evaluate' },
    ];
    expect(H.coverage(obs, items)).toEqual([
      { id: 't1', label: 'Make observations', n: 2 },
      { id: 't2', label: 'Plan an investigation', n: 1 },
      { id: 't3', label: 'Evaluate', n: 0 },
    ]);
  });

  it('groups by month, newest first, with the year on another year', () => {
    const g = H.monthGroups(obs, '2026-10-18');
    expect(g.map(m => [m.label, m.obs.map(o => o.id)])).toEqual([
      ['October', ['a', 'b']],
      ['September', ['c', 'd']],
      ['June 2025', ['e']],
    ]);
  });

  it('says the latest gap and lists a short run of days', () => {
    const L = H.timelineLayout([ob('x', '2026-09-20'), ob('y', '2026-10-16')], { today: '2026-10-18' });
    expect(H.gapSentence(L, '2026-10-18')).toBe('No notes for 26 days, Sep 20 to Oct 16');
    const L2 = H.timelineLayout([ob('x', '2026-09-20')], { today: '2026-10-18' });
    expect(H.gapSentence(L2, '2026-10-18')).toBe('No notes for 28 days, since Sep 20');
    expect(H.datesSentence(L, '2026-10-18')).toBe('Notes on Sep 20 and Oct 16.');
    expect(H.datesSentence(L2, '2026-10-18')).toBe('A note on Sep 20.');
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
  const chipText = () => $$('.ev-type-chip').map(t => t.textContent.replace(/\s+/g, ' ').trim());
  const cardIds = () => $$('#ev-list .obs-card').map(c => c.getAttribute('data-obid'));

  it('shows one panel with type chips, counts and cards newest first by month, without the name', () => {
    expect($('#ev-title').textContent).toBe('Observations');
    expect(chipText()).toEqual(['All 3', 'Strength 1', 'Growth 0', 'Concern 1', 'Note 0']);
    expect($('[data-ev-type="all"]').getAttribute('aria-pressed')).toBe('true');
    expect(cardIds()).toEqual(['o3', 'o2', 'o1']);
    expect($$('.ev-month-title').map(h => h.textContent)).toEqual(['October', 'September']);
    expect($('#ev-list .obs-card-student')).toBeNull();
    expect($('#ev-list .obs-card-with')).toBeNull();
    // A card opens the edit window (the Observations page's, over this page).
    expect($('#ev-list .obs-card').getAttribute('data-action')).toBe('evEditOb');
    expect($('#ev-list .obs-card').getAttribute('tabindex')).toBe('0');
    // No learning map: no Seen in Class.
    expect($('#ev-seen').hidden).toBe(true);
  });

  it('keeps a private note off the screen until Show', () => {
    const text = () => $('#ev-list .obs-card[data-obid="o3"] .obs-card-text').textContent;
    expect(text()).toBe('Hidden on screen. Show');
    expect($('.ev-tl-mark[data-obid="o3"]').getAttribute('aria-label')).toBe('Oct 16 · Concern · Private');
    expect($('#ev-list .obs-card[data-obid="o1"] .obs-card-text').textContent).toBe('Asked a sharp question');
    $('#ev-list .obs-card[data-obid="o3"] .obs-card-reveal').click();
    expect(text()).toBe('Left the lab early');
    expect($('.ev-tl-mark[data-obid="o3"]').getAttribute('aria-label')).toBe(
      'Oct 16 · Concern · Private: Left the lab early',
    );
    // Another student, then back: hidden again.
    StudentEvidence.mount('c1', 's2');
    StudentEvidence.mount('c1', 's1');
    expect(text()).toBe('Hidden on screen. Show');
  });

  it('draws a mark per observation, labels the gap and says it in words', () => {
    expect($$('.ev-tl-mark').map(m => m.getAttribute('data-obid'))).toEqual(['o1', 'o2', 'o3']);
    expect($('.ev-tl-mark[data-obid="o2"]').getAttribute('data-shape')).toBe('square');
    // Sep 20 → Oct 1 is 11 days, Oct 1 → Oct 16 is 15, Oct 16 → today is 2.
    expect($$('.ev-tl-gap-label').map(g => g.textContent)).toEqual(['No notes for 15 days']);
    expect($('.ev-tl-head .ev-h3').textContent).toBe('All Time');
    expect($('.ev-tl-range').textContent).toBe('Sep 20 to today');
    expect($('.ev-tl-gapline').textContent).toBe('No notes for 15 days, Oct 1 to Oct 16');
    expect($('.ev-tl-dates').textContent).toBe('Notes on Sep 20, Oct 1 and Oct 16.');
  });

  it('narrows by type, and says so when nothing matches', () => {
    $('[data-ev-type="concern"]').click();
    expect(cardIds()).toEqual(['o3']);
    expect($('[data-ev-type="concern"]').getAttribute('aria-pressed')).toBe('true');
    expect($('[data-ev-type="all"]').getAttribute('aria-pressed')).toBe('false');
    $('[data-ev-type="growth"]').click();
    expect($('#ev-list').textContent).toBe('No notes match. Show All Notes');
    $('[data-ev-clear]').click();
    expect(cardIds()).toEqual(['o3', 'o2', 'o1']);
  });

  it('Seen in Class counts each competency, marks the unseen, and narrows the notes', () => {
    store[0].competencyId = 't1';
    store[2].competencyId = 't1';
    const tags = { t1: { id: 't1', label: 'Make observations' }, t2: { id: 't2', label: 'Plan an investigation' } };
    swap('getSections', () => [{ id: 'sec', name: 'Questioning', tags: [tags.t1, tags.t2] }]);
    swap('getTagById', (cid, id) => tags[id] || null);
    StudentEvidence.refresh();
    const chips = () => $$('.ev-seen-chip').map(c => c.textContent.replace(/\s+/g, ' ').trim());
    expect($('#ev-seen').hidden).toBe(false);
    expect(chips()).toEqual(['Make observations 2', 'Plan an investigation 0']);
    expect($('.ev-seen-chip[data-ev-comp="t2"]').classList.contains('is-none')).toBe(true);
    expect($('.ev-seen-note').textContent).toBe('1 competency has no observation yet. Watch for it next class.');

    $('.ev-seen-chip[data-ev-comp="t1"]').click();
    expect(cardIds()).toEqual(['o3', 'o1']);
    expect(chipText()).toEqual(['All 2', 'Strength 1', 'Growth 0', 'Concern 1', 'Note 0']);
    expect($('.ev-comp-pill').textContent).toContain('Make observations');
    // The pill's × shows every competency.
    $('.ev-comp-clear').click();
    expect(cardIds()).toEqual(['o3', 'o2', 'o1']);
    expect($('.ev-comp-pill')).toBeNull();
  });

  it('search narrows the notes and the counts', () => {
    const input = $('#ev-search');
    input.value = 'lab';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    // "Left the lab early" by text, "Strong graph" by its assessment title.
    expect(cardIds()).toEqual(['o3', 'o2']);
    expect(chipText()).toEqual(['All 2', 'Strength 0', 'Growth 0', 'Concern 1', 'Note 0']);
    $('[data-ev-type="concern"]').click();
    expect(cardIds()).toEqual(['o3']);
    input.value = 'zebra';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect($('#ev-list').textContent).toContain('Nothing here matches');
  });

  it('a timeline mark clears a filter that hides its card', () => {
    $('[data-ev-type="concern"]').click();
    $('.ev-tl-mark[data-obid="o1"]').click();
    expect($('[data-ev-type="all"]').getAttribute('aria-pressed')).toBe('true');
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
    expect(chipText()[0]).toBe('All 4');
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
    expect($('#ev-timeline').hidden).toBe(false);
    expect($('.ev-tl-range').textContent).toBe('No observations yet');
    expect($$('.ev-tl-mark')).toHaveLength(0);
    $('[data-ev-type="concern"]').click();
    expect($('#ev-list').textContent).toBe('No observations yet. Add one above.');
  });
});
