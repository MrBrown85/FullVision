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
    const form = ReportSheets.starter('conference-pack');
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
