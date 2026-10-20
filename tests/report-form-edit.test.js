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
    expect(ReportSheets.saveTemplate('   ', base())).toBeNull();
    const entry = ReportSheets.saveTemplate('Humanities 8 · Report Card', ReportSheets.setType(base(), 'compact'));
    expect(ReportSheets.templates().map(t => t.name)).toEqual(['Humanities 8 · Report Card']);
    expect(ReportSheets.template(entry.id).type).toBe('compact');
    expect(ReportSheets.template(entry.id).name).toBe('Humanities 8 · Report Card');
    ReportSheets.removeTemplate(entry.id);
    expect(ReportSheets.templates()).toEqual([]);
  });
});
