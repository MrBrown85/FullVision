/**
 * Progress Reports is One Report for every class (Colin, 2026-11-13). What
 * a class saved before One Report (its Quick Report choices or its built
 * form) is read into the model the way the old screen read it, and never
 * rewritten; Everyone leads with the longest reports.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

// setup.js stubs PageReports for the router; this loads the real page.
runInThisContext(readFileSync('teacher/page-reports.js', 'utf-8'), { filename: 'teacher/page-reports.js' });

const { readSaved, orderBySheets, longestStudent } = PageReports._helpers;
const R = ReportOne;
const model = rc => R.modelFor(readSaved(rc));

describe('what a class opens with', () => {
  it('a class with nothing saved opens on the Quick Report’s parts', () => {
    expect(model({})).toEqual(R.fromGrade(undefined));
    expect(model(null)).toEqual(R.fromGrade(undefined));
  });

  it('a class on the Quick Report opens with its choices', () => {
    const rc = { progressMode: 'grade', gradeReport: { summary: true, order: 'newest' } };
    expect(model(rc)).toEqual(R.fromGrade(rc.gradeReport));
  });

  it('a class on Build Your Own opens with its form, and one that built a form before there was a choice too', () => {
    // A form as Page Studio saved it (the Conference Pack starter).
    const cell = block => ({ cells: [{ block, size: 'row' }] });
    const form = {
      v: 6,
      id: 'conference-pack',
      name: 'Conference Pack',
      type: 'standard',
      sides: [
        { rows: [cell('header'), cell('proficiency'), cell('legend'), cell('teacher-narrative'), cell('next-steps')] },
        { rows: [cell('learner-dimensions'), cell('grade-table'), cell('parent-response')] },
      ],
      pinned: 'parent-response',
      perStudent: {},
    };
    const built = R.fromForm(ReportSheets.normalizeForm(form));
    expect(model({ progressMode: 'build', form })).toEqual(built);
    expect(model({ form })).toEqual(built);
    // A class that chose the Quick Report after building a form keeps the Quick Report.
    expect(model({ progressMode: 'grade', form })).toEqual(R.fromGrade(undefined));
  });

  it('a class with a model of its own opens with it', () => {
    const one = R.fromSetup('interim-update');
    expect(model({ progressMode: 'grade', one })).toEqual(R.normalize(one));
  });

  it('reads the saved settings without changing them', () => {
    const rc = { gradeReport: { summary: true } };
    const before = JSON.stringify(rc);
    readSaved(rc);
    expect(JSON.stringify(rc)).toBe(before);
  });
});

describe('Everyone and the longest report', () => {
  it('Everyone leads with the students on more than one sheet, most first, then roster order', () => {
    const students = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const summary = { perStudent: { a: { sheets: 1 }, b: { sheets: 2 }, c: { sheets: 3 }, d: { sheets: 1 } } };
    expect(orderBySheets(students, summary).map(s => s.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(orderBySheets(students, null).map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderBySheets(students, { perStudent: {} }).map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('names the student whose report is longest', () => {
    const perStudent = { s0: { used: 900 }, s1: { used: 1800 }, s2: { used: 700 } };
    expect(longestStudent({ perStudent })).toBe('s1');
    expect(longestStudent(null)).toBeNull();
  });
});

describe('Escape and the Parts panel on a narrow screen', () => {
  const progress = PageReports._helpers.tabs.find(t => t.id === 'progress');
  const classes = on => {
    const set = new Set(on);
    return {
      contains: c => set.has(c),
      remove: c => set.delete(c),
      add: c => set.add(c),
      has: c => set.has(c),
    };
  };
  // A page with the panel open; `open` lists the selectors something on it matches.
  const page = (open = []) => {
    const layout = { classList: classes(['rail-open']) };
    const rail = {
      classList: classes(['active']),
      attrs: { 'aria-pressed': 'true' },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      focus() {
        rail.focused = true;
      },
    };
    const old = globalThis.document;
    globalThis.document = Object.assign({}, old, {
      getElementById: id => (id === 'studio' ? layout : id === 'tb-rail-btn' ? rail : null),
      querySelector: sel => (open.some(o => sel.indexOf(o) >= 0) ? {} : null),
    });
    return { layout, rail, restore: () => (globalThis.document = old) };
  };
  const press = (key, target) => {
    const e = { key, target: target || null, prevented: false, preventDefault: () => (e.prevented = true) };
    progress.key(e);
    return e;
  };

  it('closes the panel, puts the Parts button back and gives it the focus', () => {
    const p = page();
    try {
      const e = press('Escape');
      expect(p.layout.classList.has('rail-open')).toBe(false);
      expect(p.rail.classList.has('active')).toBe(false);
      expect(p.rail.attrs['aria-pressed']).toBe('false');
      expect(p.rail.focused).toBe(true);
      expect(e.prevented).toBe(true);
    } finally {
      p.restore();
    }
  });

  it('another key leaves it open', () => {
    const p = page();
    try {
      press('Enter');
      expect(p.layout.classList.has('rail-open')).toBe(true);
    } finally {
      p.restore();
    }
  });

  it.each([
    ['a dialog', '.confirm-overlay'],
    ['a part’s dialog', '.one-dlg-overlay'],
    ['the comment editor', '.one-com-edit'],
    ['the comment’s save question', '.one-com-ask'],
    ['an inline rename', '[data-one-title][contenteditable]'],
    ['a drag', '.is-dragging'],
  ])('leaves it open while %s is open', (what, sel) => {
    const p = page([sel]);
    try {
      const e = press('Escape');
      expect(p.layout.classList.has('rail-open')).toBe(true);
      expect(p.rail.focused).toBeUndefined();
      expect(e.prevented).toBe(false);
    } finally {
      p.restore();
    }
  });

  it('leaves it open for an Escape a dialog used to close itself', () => {
    const p = page();
    try {
      press('Escape', { nodeType: 1, isConnected: false });
      expect(p.layout.classList.has('rail-open')).toBe(true);
      press('Escape', { nodeType: 1, isConnected: true, closest: s => (s === '[role="dialog"]' ? {} : null) });
      expect(p.layout.classList.has('rail-open')).toBe(true);
    } finally {
      p.restore();
    }
  });
});
