/**
 * The class fit off the click (speed assessment R1). The fit line counts
 * every student's sheets; a tick, an edit or a saved comment used to lay
 * the whole class out in one task straight after the click. Now the
 * click lays out nothing for the fit, the class is laid out a piece at a
 * time while the page is idle, and each student's layout is kept by what
 * it reads, so a change to one student lays out that student only.
 * Counted, not timed.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const S = ReportSheets;
const students = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, firstName: 'F' + id, lastName: 'L' + i }));
const result = st => ({
  html: '<p>' + st.id + '</p>',
  sheets: st.id === 'c' ? 2 : 1,
  sides: st.id === 'c' ? 3 : 1,
  over: false,
  continued: st.id === 'c',
  badge: st.id === 'c' ? '2 sheets' : '1 sheet',
  noComment: st.id === 'b',
  noAttendance: false,
  used: st.id.charCodeAt(0),
  free: 0,
});

describe('the class fit in pieces', () => {
  let clock = 0;
  let createElement;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // The measuring stage, as tests/report-studio-model.test.js stubs it.
    createElement = document.createElement;
    document.createElement = () => ({ setAttribute() {}, style: {}, remove() {} });
  });
  afterEach(() => {
    document.createElement = createElement;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lays out no student in the task that asks for the fit, then about 8 ms of students a piece', () => {
    const calls = [];
    const layout = (cid, st) => {
      calls.push(st.id);
      clock += 5; // each student takes 5 ms: two a piece
      return result(st);
    };
    let summary;
    S.classSummaryLater('x', students, {}, { paper: 'letter', layout, alive: () => true, done: s => (summary = s) });
    expect(calls).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(calls).toEqual(['a', 'b']);
    vi.advanceTimersToNextTimer();
    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(summary).toBeUndefined();
    vi.advanceTimersToNextTimer();
    expect(calls).toEqual(['a', 'b', 'c', 'd', 'e']);
    // The summary the whole class laid out at once gives.
    const once = S.classSummary('x', students, {}, { paper: 'letter', layout: (cid, st) => result(st) });
    expect(summary).toEqual(once);
  });

  it('a slow student is a piece on its own, and a stopped or dead run lays out no more', () => {
    const calls = [];
    const layout = (cid, st) => {
      calls.push(st.id);
      clock += 40;
      return result(st);
    };
    let alive = true;
    const stop = S.classSummaryLater('x', students, {}, { layout, alive: () => alive, done: () => {} });
    vi.advanceTimersToNextTimer();
    expect(calls).toEqual(['a']);
    alive = false;
    vi.advanceTimersToNextTimer();
    expect(calls).toEqual(['a']);
    const calls2 = calls.length;
    const stop2 = S.classSummaryLater('x', students, {}, { layout, alive: () => true, done: () => {} });
    stop2();
    vi.runAllTimers();
    expect(calls.length).toBe(calls2);
    stop();
  });

  it('runs each piece through the function it is given (the report’s set of scores)', () => {
    let inside = 0;
    const seen = [];
    const layout = (cid, st) => {
      seen.push(inside);
      return result(st);
    };
    const run = fn => {
      inside++;
      try {
        return fn();
      } finally {
        inside--;
      }
    };
    S.classSummaryLater('x', students, {}, { layout, run, alive: () => true, done: () => {} });
    vi.runAllTimers();
    expect(seen).toEqual([1, 1, 1, 1, 1]);
  });

  it('gives null when a layout throws, as the fit did', () => {
    let summary = 'none';
    const layout = () => {
      throw new Error('no');
    };
    S.classSummaryLater('x', students, {}, { layout, alive: () => true, done: s => (summary = s) });
    vi.runAllTimers();
    expect(summary).toBeNull();
  });
});

describe('kept layouts', () => {
  it('lays out only the student whose inputs changed, and finds a change put back', () => {
    const calls = [];
    const layout = (cid, st) => {
      calls.push(st.id);
      return result(st);
    };
    const kept = S.keeper();
    let model = 'm1';
    let perB = 0;
    const keyOf = st => model + '|' + (st.id === 'b' ? perB : 0);
    const run = () => students.map(st => kept.layout(layout, keyOf)('x', st, {}, {}));
    run();
    expect(calls.length).toBe(5);
    // A tick for the class: every student again.
    calls.length = 0;
    model = 'm2';
    run();
    expect(calls.length).toBe(5);
    // The tick put back: nobody again.
    calls.length = 0;
    model = 'm1';
    run();
    expect(calls).toEqual([]);
    // A change to one student (their part hidden, their comment saved).
    perB = 1;
    run();
    expect(calls).toEqual(['b']);
    // Cleared: everyone again.
    calls.length = 0;
    kept.clear();
    run();
    expect(calls.length).toBe(5);
  });

  it('gives back the same layout it kept', () => {
    const kept = S.keeper();
    const lay = kept.layout(
      (cid, st) => result(st),
      () => 'k',
    );
    expect(lay('x', students[0], {}, {})).toBe(lay('x', students[0], {}, {}));
  });
});

describe('the Reports page’s kept layouts', () => {
  const model = { parts: ['header', 'assessments'], perStudent: {} };
  const kept = () => S.keptLayouts(() => ({ cid: 'x', ctx: { termId: 't1' }, paper: 'letter', set: 'all', model }));
  const draw = (k, calls) => {
    const lay = k.layout('sheet', (cid, st) => (calls.push(st.id), result(st)), 'one');
    students.forEach(st => lay('x', st, {}, {}));
  };

  it('a saved comment lays out that student; new data for the class lays out everyone', () => {
    const k = kept();
    const calls = [];
    draw(k, calls);
    expect(calls.length).toBe(5);
    calls.length = 0;
    draw(k, calls);
    expect(calls).toEqual([]);
    k.dirty('d');
    draw(k, calls);
    expect(calls).toEqual(['d']);
    calls.length = 0;
    k.changed();
    draw(k, calls);
    expect(calls.length).toBe(5);
    calls.length = 0;
    k.dirty();
    draw(k, calls);
    expect(calls.length).toBe(5);
  });

  it('a change for one student (model.perStudent) lays out that student only', () => {
    const k = kept();
    const calls = [];
    draw(k, calls);
    calls.length = 0;
    model.perStudent = { b: { on: [], off: ['assessments'], removed: {} } };
    draw(k, calls);
    expect(calls).toEqual(['b']);
    model.perStudent = {};
  });
});

describe('a report’s hash, kept per text (R7)', () => {
  // The hash as it was: djb2 over the text, a print date's text left out.
  const djb2 = str => {
    let h = 5381;
    const s = String(str || '').replace(/(<[^>]*\sdata-print-date\b[^>]*>)[^<]*/g, '$1');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  };
  it('is the same hash, asked once or many times', () => {
    const html = '<div class="x"><span data-print-date="1">As of Nov 13</span> Cece</div>';
    expect(ReportIssues.hash(html)).toBe(djb2(html));
    expect(ReportIssues.hash(html)).toBe(djb2(html));
    expect(ReportIssues.hash(html.replace('Nov 13', 'Nov 14'))).toBe(djb2(html));
    expect(ReportIssues.hash('')).toBe(djb2(''));
    expect(ReportIssues.hash(null)).toBe(djb2(null));
    for (let i = 0; i < 600; i++) expect(ReportIssues.hash('<p>' + i + '</p>')).toBe(djb2('<p>' + i + '</p>'));
  });
});
