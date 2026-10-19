/**
 * Phone class sweep — teacher-mobile/sweep.js (docs/DECISIONS.md,
 * "Observations (2026-10-18)", Mockup B).
 *
 * Done comes from the data (any observation dated today); Skip is per
 * device and per day. Save and next writes through addQuickOb and Undo
 * removes exactly that observation.
 */

import './setup-mobile.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';

runInThisContext(readFileSync(resolve(__dirname, '..', 'teacher-mobile/sweep.js'), 'utf-8'), {
  filename: 'teacher-mobile/sweep.js',
});

const H = MSweep._helpers;
const CID = 'sweep-test';
const TODAY = getTodayStr();

const STUDENTS = [
  { id: 's1', firstName: 'Cece', lastName: 'Adams', preferred: '' },
  { id: 's2', firstName: 'Noor', lastName: 'Baker', preferred: '' },
  { id: 's3', firstName: 'Sam', lastName: 'Chen', preferred: '' },
  { id: 's4', firstName: 'Sam', lastName: 'Diaz', preferred: '' },
];

const STARTERS = [
  { id: 'ot1', text: 'Asked a great question', sentiment: 'strength', context: 'discussion', dims: ['curiosity'] },
  { id: 'ot2', text: 'Needed a reminder to start', sentiment: 'growth', context: null, dims: ['selfRegulation'] },
];

function ago(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

describe('sweep helpers', () => {
  it('counts a student done only for an observation dated today', () => {
    const done = H.doneSet(
      [
        { studentId: 's1', created: new Date().toISOString() },
        { studentId: 's2', created: ago(2) },
      ],
      TODAY,
    );
    expect(done).toEqual({ s1: true });
  });

  it('adds a last initial for duplicate first names, the last name if that collides', () => {
    expect(H.tileNames(STUDENTS)).toEqual({ s1: 'Cece', s2: 'Noor', s3: 'Sam C.', s4: 'Sam D.' });
    const names = H.tileNames([
      { id: 'a', firstName: 'Ana', lastName: 'Lee' },
      { id: 'b', firstName: 'Ana', lastName: 'Lopez' },
      { id: 'c', firstName: 'Ben', lastName: 'Ng', preferred: 'Benji' },
    ]);
    expect(names).toEqual({ a: 'Ana Lee', b: 'Ana Lopez', c: 'Benji' });
  });

  it('roster order keeps the roster; longest since observed puts never-observed first', () => {
    const last = H.lastObserved([
      { studentId: 's1', created: ago(1) },
      { studentId: 's1', created: ago(9) },
      { studentId: 's2', created: ago(5) },
      { studentId: 's4', created: ago(1) },
    ]);
    expect(H.orderIds(STUDENTS, 'roster', last)).toEqual(['s1', 's2', 's3', 's4']);
    // s3 never observed; s2 five days ago; s1 and s4 both a day ago (roster breaks the tie).
    expect(H.orderIds(STUDENTS, 'longest', last)).toEqual(['s3', 's2', 's1', 's4']);
  });

  it('next student skips done and skipped, wraps round, and is null when no one is left', () => {
    const ids = ['s1', 's2', 's3', 's4'];
    expect(H.nextStudent(ids, { s2: true }, { s3: true }, 's1')).toBe('s4');
    expect(H.nextStudent(ids, {}, {}, 's4')).toBe('s1');
    expect(H.nextStudent(ids, { s1: true }, {}, null)).toBe('s2');
    expect(H.nextStudent(ids, { s1: true, s2: true, s3: true }, {}, 's4')).toBe(null);
    expect(H.nextStudent(ids, { s1: true, s2: true, s3: true, s4: true }, {}, null)).toBe(null);
  });

  it("puts the chosen type's starters first and keeps bank order otherwise", () => {
    const items = [
      { key: 'a', sentiment: 'strength' },
      { key: 'b', sentiment: 'growth' },
      { key: 'c', sentiment: 'strength' },
    ];
    expect(H.sortStarters(items, null).map(t => t.key)).toEqual(['a', 'b', 'c']);
    expect(H.sortStarters(items, 'growth').map(t => t.key)).toEqual(['b', 'a', 'c']);
  });

  it('keeps skipped per course and day, and drops older days', () => {
    localStorage.clear();
    localStorage.setItem('gb-sweep-skipped-' + CID + '-2026-01-01', '["s1"]');
    localStorage.setItem('gb-sweep-skipped-other-2026-01-01', '["s9"]');
    H.writeSkipped(CID, TODAY, { s2: true });
    expect(H.readSkipped(CID, TODAY)).toEqual({ s2: true });
    expect(localStorage.getItem('gb-sweep-skipped-' + CID + '-2026-01-01')).toBe(null);
    expect(localStorage.getItem('gb-sweep-skipped-other-2026-01-01')).toBe('["s9"]');
  });
});

/* The screen, in linkedom, on the real observation data layer. */
describe('sweep screen', () => {
  const saved = {};
  let dom;
  let origDoc;

  function screen() {
    return dom.document.getElementById('m-screen-obs-sweep');
  }
  function q(sel) {
    return dom.document.querySelector(sel);
  }
  function click(sel) {
    const el = typeof sel === 'string' ? q(sel) : sel;
    MSweep.handleAction(el.getAttribute('data-action'), el);
  }
  function tile(sid) {
    return q('.m-sweep-tile[data-sid="' + sid + '"]');
  }
  function open() {
    dom.document.getElementById('stack').innerHTML = MSweep.render(CID);
  }

  beforeEach(() => {
    localStorage.clear();
    _cache.observations[CID] = undefined;
    ['getStudents', 'getObservationTemplates'].forEach(fn => (saved[fn] = globalThis[fn]));
    globalThis.getStudents = () => STUDENTS.map(s => ({ ...s }));
    globalThis.getObservationTemplates = () => STARTERS.map(s => ({ ...s, dims: s.dims.slice() }));
    dom = parseHTML('<!doctype html><html><body><div id="stack"></div><div id="m-toast"></div></body></html>');
    origDoc = globalThis.document;
    globalThis.document = dom.document;
  });

  afterEach(() => {
    MSweep.close();
    globalThis.document = origDoc;
    Object.keys(saved).forEach(fn => (globalThis[fn] = saved[fn]));
  });

  it('shows the count, the grid with duplicate names, and the order toggle', () => {
    saveQuickObs(CID, { s2: [{ id: 'qo_x', text: 'Earlier today', created: new Date().toISOString(), dims: [] }] });
    open();
    expect(screen()).not.toBe(null);
    expect(q('#m-sweep-count').textContent).toBe('1 of 4 observed today');
    expect(tile('s2').getAttribute('data-state')).toBe('done');
    expect(tile('s3').textContent).toBe('Sam C.');
    expect(q('.m-sweep-order-btn.m-seg-active').textContent).toBe('Roster order');
    expect(q('.m-sweep-hint').textContent).toBe('Tap a name to start.');
  });

  it("Save and next writes the text, the chosen type, the starter's context and tags", () => {
    open();
    click(tile('s1'));
    expect(q('.m-sweep-panel-name').textContent).toBe('Cece Adams');
    expect(q('#m-sweep-save').hasAttribute('disabled')).toBe(true);
    click('[data-action="m-sweep-starter"][data-key="ot1"]');
    // The starter's own type preselects the type button.
    expect(q('.m-sweep-type.m-selected').getAttribute('data-val')).toBe('strength');
    click('[data-action="m-sweep-type"][data-val="concern"]');
    expect(q('#m-sweep-save').hasAttribute('disabled')).toBe(false);
    click('#m-sweep-save');

    const obs = getStudentQuickObs(CID, 's1');
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      text: 'Asked a great question',
      sentiment: 'concern',
      context: 'discussion',
      dims: ['curiosity'],
    });
    expect(q('#m-toast').textContent).toContain('Saved for Cece');
    expect(q('#m-sweep-count').textContent).toBe('1 of 4 observed today');
    expect(tile('s1').getAttribute('data-state')).toBe('done');
    // The next student opens.
    expect(q('.m-sweep-panel-name').textContent).toBe('Noor Baker');
  });

  it('Write instead saves the typed text with no starter tags', () => {
    open();
    click(tile('s2'));
    click('[data-action="m-sweep-type"][data-val="growth"]');
    // Choosing a type lists that type's starters first.
    expect(q('.m-sweep-starter').getAttribute('data-key')).toBe('ot2');
    click('[data-action="m-sweep-write"]');
    const ta = q('#m-sweep-text');
    ta.value = 'Explained the model to a partner';
    ta.dispatchEvent(new dom.Event('input'));
    click('#m-sweep-save');
    expect(getStudentQuickObs(CID, 's2')[0]).toMatchObject({
      text: 'Explained the model to a partner',
      sentiment: 'growth',
      dims: [],
    });
  });

  it('Undo removes exactly the observation Save and next wrote', () => {
    saveQuickObs(CID, { s1: [{ id: 'qo_keep', text: 'Last week', created: ago(7), dims: [] }] });
    open();
    click(tile('s1'));
    click('[data-action="m-sweep-starter"][data-key="ot2"]');
    click('#m-sweep-save');
    expect(getStudentQuickObs(CID, 's1')).toHaveLength(2);
    expect(tile('s1').getAttribute('data-state')).toBe('done');

    q('#m-toast [data-action="m-toast-undo"]').onclick();
    const left = getStudentQuickObs(CID, 's1');
    expect(left.map(o => o.id)).toEqual(['qo_keep']);
    expect(tile('s1').getAttribute('data-state')).toBe('');
    expect(q('#m-sweep-count').textContent).toBe('0 of 4 observed today');
  });

  it('Skip mutes the student, is not done, and survives leaving and returning', () => {
    open();
    click(tile('s1'));
    click('[data-action="m-sweep-skip"]');
    expect(tile('s1').getAttribute('data-state')).toBe('skipped');
    expect(q('#m-sweep-count').textContent).toBe('0 of 4 observed today');
    expect(q('.m-sweep-panel-name').textContent).toBe('Noor Baker');
    click('[data-action="m-sweep-order"][data-val="longest"]');

    MSweep.close();
    open();
    expect(tile('s1').getAttribute('data-state')).toBe('skipped');
    expect(q('.m-sweep-order-btn.m-seg-active').textContent).toBe('Longest since observed');
  });

  it('shows "Everyone has an observation today" when all are done', () => {
    const now = new Date().toISOString();
    saveQuickObs(CID, {
      s1: [{ id: 'a', text: 'x', created: now, dims: [] }],
      s2: [{ id: 'b', text: 'x', created: now, dims: [] }],
      s3: [{ id: 'c', text: 'x', created: now, dims: [] }],
    });
    open();
    click(tile('s4'));
    click('[data-action="m-sweep-starter"][data-key="ot1"]');
    click('#m-sweep-save');
    expect(q('#m-sweep-count').textContent).toBe('4 of 4 observed today');
    expect(q('.m-sweep-finished-title').textContent).toBe('Everyone has an observation today');
    expect(q('[data-action="m-sweep-done"]').textContent).toBe('Done');
  });

  it('says who is left skipped when no one else is', () => {
    saveQuickObs(CID, {
      s1: [{ id: 'a', text: 'x', created: new Date().toISOString(), dims: [] }],
      s2: [{ id: 'b', text: 'x', created: new Date().toISOString(), dims: [] }],
    });
    H.writeSkipped(CID, TODAY, { s3: true });
    open();
    click(tile('s4'));
    click('[data-action="m-sweep-skip"]');
    expect(q('.m-sweep-finished-title').textContent).toBe('No one left. 2 students skipped for today.');
  });
});

describe('sweep after a reload in the evening', () => {
  const origTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (origTZ === undefined) delete process.env.TZ;
    else process.env.TZ = origTZ;
  });

  afterEach(() => {
    _cache.observations[CID] = undefined;
    localStorage.clear();
  });

  it('counts an observation written at 6:30 pm PDT as done that day', () => {
    // 6:30 pm PDT on Oct 18; the UTC day is already Oct 19.
    const blob = _observationsPayloadToBlob({
      observations: [{ id: 'ob1', body: 'Evening note', enrollment_ids: ['s1'], created_at: '2026-10-19T01:30:00Z' }],
    });
    saveQuickObs(CID, blob);
    expect(H.doneSet(getAllQuickObs(CID), '2026-10-18')).toEqual({ s1: true });
    expect(H.doneSet(getAllQuickObs(CID), '2026-10-19')).toEqual({});
  });
});
