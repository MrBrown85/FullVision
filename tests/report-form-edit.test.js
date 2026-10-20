/**
 * The class's form as data: normalizeForm makes any saved layout whole,
 * and the editing helpers are pure.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const ids = list => list.map(it => (it.pair ? it.pair.map(q => q.block).join('+') : it.block));

describe('ReportSheets.normalizeForm', () => {
  it('is the Report Card when nothing is saved', () => {
    const f = ReportSheets.normalizeForm(undefined);
    expect(f.v).toBe(3);
    expect(ids(f.front)).toEqual([
      'header',
      'academic-summary',
      'teacher-narrative',
      'competency-table+attendance',
      'next-steps',
    ]);
    expect(ids(f.back)).toEqual(['learner-dimensions', 'parent-response']);
    expect(f.back[1].pinned).toBe('bottom');
    expect(f.type).toBe('standard');
  });

  it('drops unknown blocks and duplicates, leads with the letterhead, keeps one pinned block last on the back', () => {
    const f = ReportSheets.normalizeForm({
      front: [{ block: 'bogus' }, { block: 'legend' }, { block: 'header' }, { block: 'legend' }],
      back: [
        { block: 'parent-response', pinned: 'bottom' },
        { block: 'learner-dimensions', pinned: 'bottom' },
      ],
      type: 'compact',
    });
    expect(ids(f.front)).toEqual(['header', 'legend']);
    expect(ids(f.back)).toEqual(['learner-dimensions', 'parent-response']);
    expect(f.back[1].pinned).toBe('bottom');
    expect(f.back[0].pinned).toBeUndefined();
    expect(f.type).toBe('compact');
  });

  it("keeps a flowing block's room and empty rule within bounds", () => {
    const f = ReportSheets.normalizeForm({
      front: [{ block: 'teacher-narrative', room: { lines: 99 }, whenEmpty: 'nope' }],
    });
    expect(f.front[1].room).toEqual({ lines: 8 });
    expect(f.front[1].whenEmpty).toBe('box');
  });
});

describe('ReportSheets editing helpers', () => {
  const base = () => ReportSheets.form();

  it('moves a block within a side, never past the letterhead or a pinned block', () => {
    let f = ReportSheets.moveItem(base(), 'front', 2, -1);
    expect(ids(f.front)).toEqual([
      'header',
      'teacher-narrative',
      'academic-summary',
      'competency-table+attendance',
      'next-steps',
    ]);
    f = ReportSheets.moveItem(f, 'front', 1, -1);
    expect(ids(f.front)[0]).toBe('header');
    f = ReportSheets.moveItem(base(), 'back', 0, 1);
    expect(ids(f.back)).toEqual(['learner-dimensions', 'parent-response']);
  });

  it('moves a block to the other side, above the pinned block', () => {
    const f = ReportSheets.moveToSide(base(), 'front', 4);
    expect(ids(f.front)).toEqual(['header', 'academic-summary', 'teacher-narrative', 'competency-table+attendance']);
    expect(ids(f.back)).toEqual(['learner-dimensions', 'next-steps', 'parent-response']);
  });

  it('removes and adds blocks; the letterhead stays', () => {
    let f = ReportSheets.removeItem(base(), 'front', 0);
    expect(ids(f.front)[0]).toBe('header');
    f = ReportSheets.removeItem(f, 'back', 0);
    expect(ids(f.back)).toEqual(['parent-response']);
    expect(ReportSheets.available(f)).toContain('learner-dimensions');
    f = ReportSheets.addBlock(f, 'legend', 'back');
    expect(ids(f.back)).toEqual(['legend', 'parent-response']);
    expect(ReportSheets.addBlock(f, 'legend', 'front')).toEqual(f);
  });

  it('sets the comment room, the empty rule, the pin and the type', () => {
    let f = ReportSheets.setRoom(base(), 12);
    expect(f.front[2].room).toEqual({ lines: 12 });
    f = ReportSheets.setWhenEmpty(f, 'next-steps', 'box');
    expect(f.front[4].whenEmpty).toBe('box');
    f = ReportSheets.setPinned(f, 'parent-response', false);
    expect(f.back[1].pinned).toBeUndefined();
    f = ReportSheets.setPinned(f, 'parent-response', true);
    expect(f.back[f.back.length - 1].pinned).toBe('bottom');
    expect(ReportSheets.setType(f, 'compact').type).toBe('compact');
  });
});

describe('ReportSheets reorder, pairs, starters and the library', () => {
  const base = () => ReportSheets.form();
  const ids = list => list.map(it => (it.pair ? it.pair.map(q => q.block).join('+') : it.block));

  it('reorder drops a block where it is dragged, never above the letterhead or below the pinned block', () => {
    let f = ReportSheets.reorder(base(), 'front', 4, 1);
    expect(ids(f.front)).toEqual([
      'header',
      'next-steps',
      'academic-summary',
      'teacher-narrative',
      'competency-table+attendance',
    ]);
    f = ReportSheets.reorder(base(), 'front', 2, 0);
    expect(ids(f.front)[0]).toBe('header');
    expect(ids(f.front)[1]).toBe('teacher-narrative');
    f = ReportSheets.moveToSide(base(), 'front', 4);
    f = ReportSheets.reorder(f, 'back', 0, 5);
    expect(ids(f.back)).toEqual(['next-steps', 'learner-dimensions', 'parent-response']);
  });

  it('pairs two fixed neighbours and splits a pair', () => {
    let f = ReportSheets.unpair(base(), 'front', 3);
    expect(ids(f.front)).toEqual([
      'header',
      'academic-summary',
      'teacher-narrative',
      'competency-table',
      'attendance',
      'next-steps',
    ]);
    expect(ReportSheets.canPair(f.front[3], f.front[4])).toBe(true);
    expect(ReportSheets.canPair(f.front[2], f.front[3])).toBe(false);
    f = ReportSheets.pairWith(f, 'front', 3);
    expect(ids(f.front)).toEqual([
      'header',
      'academic-summary',
      'teacher-narrative',
      'competency-table+attendance',
      'next-steps',
    ]);
  });

  it('starters are whole forms', () => {
    expect(ReportSheets.starters().map(s => s.id)).toEqual(['report-card', 'interim-update', 'conference-pack']);
    const interim = ReportSheets.starter('interim-update');
    expect(ids(interim.front)).toEqual(['header', 'academic-summary', 'teacher-narrative', 'next-steps', 'legend']);
    expect(interim.front[2].room).toEqual({ lines: 6 });
    expect(interim.back).toEqual([]);
    expect(ids(ReportSheets.starter('conference-pack').front)).toContain('grade-table');
    expect(ReportSheets.starter('nope')).toBeNull();
  });

  it('saves, lists, applies and removes a form in the library', () => {
    localStorage.clear();
    // The device copy alone; the server path is tests/report-library-server.test.js.
    const noServer = () => Promise.resolve({ data: null, error: null });
    const v2 = window.v2;
    const kept = { save: v2.saveReportTemplate, del: v2.deleteReportTemplate };
    v2.saveReportTemplate = noServer;
    v2.deleteReportTemplate = noServer;
    expect(ReportSheets.saveTemplate('   ', base())).toBeNull();
    const entry = ReportSheets.saveTemplate('Humanities 8 · Report Card', ReportSheets.setType(base(), 'compact'));
    expect(ReportSheets.templates().map(t => t.name)).toEqual(['Humanities 8 · Report Card']);
    expect(ReportSheets.template(entry.id).type).toBe('compact');
    expect(ReportSheets.template(entry.id).name).toBe('Humanities 8 · Report Card');
    ReportSheets.removeTemplate(entry.id);
    expect(ReportSheets.templates()).toEqual([]);
    v2.saveReportTemplate = kept.save;
    v2.deleteReportTemplate = kept.del;
  });
});

describe('ReportSheets setup choices', () => {
  const base = () => ReportSheets.normalizeForm(undefined);
  const blocks = f => ids(f.front).concat(ids(f.back));

  it('reads the comment room as a word and sets it from one', () => {
    expect(ReportSheets.roomChoice(base())).toBe('standard');
    const short = ReportSheets.setRoomChoice(base(), 'short');
    expect(short.front[2].room).toEqual({ lines: 5 });
    expect(ReportSheets.roomChoice(short)).toBe('short');
    expect(ReportSheets.roomChoice(ReportSheets.setRoomChoice(base(), 'long'))).toBe('long');
    expect(ReportSheets.roomChoice(ReportSheets.setRoomChoice(base(), 'nope'))).toBe('standard');
    const noComment = ReportSheets.normalizeForm({
      front: [{ block: 'header' }, { block: 'academic-summary' }],
      back: [],
    });
    expect(ReportSheets.roomChoice(noComment)).toBeNull();
  });

  it('lists the optional blocks with whether each is on', () => {
    expect(ReportSheets.includes(base())).toEqual([
      { id: 'attendance', label: 'Attendance', on: true },
      { id: 'dispositions', label: 'Learning Dispositions', on: true },
      { id: 'reflection', label: 'Student Reflection', on: false },
      { id: 'response', label: 'Parent / Guardian Response', on: true },
    ]);
    const interim = ReportSheets.starter('interim-update');
    expect(ReportSheets.includes(interim).map(i => i.on)).toEqual([false, false, false, false]);
  });

  it('attendance leaves the pair when off and comes back beside the competencies when on', () => {
    const off = ReportSheets.setInclude(base(), 'attendance', false);
    expect(ids(off.front)).toEqual([
      'header',
      'academic-summary',
      'teacher-narrative',
      'competency-table',
      'next-steps',
    ]);
    const on = ReportSheets.setInclude(off, 'attendance', true);
    expect(ids(on.front)).toEqual(ids(base().front));
    // Without a competency table it goes on the front by itself.
    const interim = ReportSheets.setInclude(ReportSheets.starter('interim-update'), 'attendance', true);
    expect(ids(interim.front).pop()).toBe('attendance');
  });

  it('dispositions lead the back, the reflection follows them, the response stays pinned last', () => {
    let f = ReportSheets.starter('interim-update');
    f = ReportSheets.setInclude(f, 'response', true);
    f = ReportSheets.setInclude(f, 'reflection', true);
    f = ReportSheets.setInclude(f, 'dispositions', true);
    expect(ids(f.back)).toEqual([
      'learner-dimensions',
      'student-reflection-learning',
      'student-reflection-habits',
      'parent-response',
    ]);
    expect(f.back[3].pinned).toBe('bottom');
    f = ReportSheets.setInclude(f, 'reflection', false);
    expect(ids(f.back)).toEqual(['learner-dimensions', 'parent-response']);
    f = ReportSheets.setInclude(f, 'response', false);
    f = ReportSheets.setInclude(f, 'dispositions', false);
    expect(f.back).toEqual([]);
    expect(blocks(f)).toEqual(ids(ReportSheets.starter('interim-update').front));
  });

  it('turning a block on twice adds it once, and an unknown include changes nothing', () => {
    const twice = ReportSheets.setInclude(ReportSheets.setInclude(base(), 'reflection', true), 'reflection', true);
    expect(blocks(twice).filter(b => b.startsWith('student-reflection'))).toHaveLength(2);
    expect(ReportSheets.setInclude(base(), 'bogus', true)).toEqual(base());
  });
});
