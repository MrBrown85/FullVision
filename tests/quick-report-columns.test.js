/**
 * The Quick Report's columns (DECISIONS, "Student-facing levels are
 * proficiencies", the Quick Report's columns, 2026-11-12). Colin: "now that
 * students only see the proficincey, the columns don't make a lot of sense."
 *
 * - A Proficiency class: Date, Assignment, Category, Result. Result holds
 *   what the piece was marked in: the proficiency, points as "8 / 10",
 *   Complete or Incomplete, Missing, Excused. The summary is Category,
 *   Assessments, Proficiency; the last line Overall Proficiency.
 * - A Both class: Result and Percent; the summary keeps its Weight.
 * - Every class: a piece with no mark yet has a blank Result (Score in a
 *   Letter class), no dash.
 * - A Letter class is otherwise exactly what main printed:
 *   tests/fixtures/quick-report-letter.json was written by this file in a
 *   checkout of origin/main before the change: each sheet main printed,
 *   with only its no-mark cells' dash taken out, fingerprinted, and how many
 *   dashes were taken out. Each sheet now must match it.
 *
 *   UPDATE_QUICK_REPORT_LETTER=1 npx vitest run tests/quick-report-columns.test.js
 */
import './setup.js';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, 'fixtures/quick-report-letter.json');
const UPDATE = process.env.UPDATE_QUICK_REPORT_LETTER === '1';

const G = GradeReport;
const CID = 'cqr';
const ST = { id: 's1', firstName: 'Ada', lastName: 'Lovelace' };

const keep = {};
const stub = (name, fn) => {
  if (!(name in keep)) keep[name] = globalThis[name];
  globalThis[name] = fn;
};
const unstub = () =>
  Object.keys(keep).forEach(k => {
    globalThis[k] = keep[k];
    delete keep[k];
  });

/* One piece of every kind: a level, a late level, points, a late points
   score, Complete, Incomplete, Missing, Excused, and no mark yet. */
function seedEvery(mode) {
  const work = [
    { id: 'a1', title: 'Plate Tectonics', date: '2026-09-10', categoryId: 'c1' },
    { id: 'a2', title: 'Rock Cycle Poster', date: '2026-09-12', categoryId: 'c1' },
    { id: 'a3', title: 'Energy Quiz', date: '2026-09-15', categoryId: 'c2', scoreMode: 'points', maxPoints: 10 },
    { id: 'a4', title: 'Formulas Quiz', date: '2026-09-18', categoryId: 'c2', scoreMode: 'points', maxPoints: 15 },
    { id: 'a5', title: 'Reading Log', date: '2026-09-20', categoryId: 'c1', scoreMode: 'complete' },
    { id: 'a6', title: 'Safety Contract', date: '2026-09-21', categoryId: 'c1', scoreMode: 'complete' },
    { id: 'a7', title: 'Density Lab', date: '2026-09-25', categoryId: 'c1' },
    { id: 'a8', title: 'Field Trip Form', date: '2026-09-28', categoryId: 'c1' },
    { id: 'a9', title: 'Cells Sketch', date: '2026-10-02', categoryId: 'c1' },
  ];
  const cells = {
    a1: { kind: 'level', value: 3.33, level: 3, percentText: '83%', late: false },
    a2: { kind: 'level', value: 2, level: 2, percentText: '63%', late: true },
    a3: { kind: 'points', value: 8, level: 3, late: false },
    a4: { kind: 'points', value: 12, level: 3, late: true },
    a5: { kind: 'complete', mark: 'complete', value: 1, late: false },
    a6: { kind: 'complete', mark: 'incomplete', value: 0, late: false },
    a7: { kind: 'status', status: 'NS', value: 0, level: 0, late: false },
    a8: { kind: 'status', status: 'EXC', late: false },
    a9: { kind: 'none', late: false },
  };
  stub('getAssessments', () => work);
  stub('assessmentInYearToDate', () => true);
  stub('assessmentCellValue', (cid, sid, a) => cells[a.id]);
  stub('getCategories', () => [
    { id: 'c1', name: 'Labs', weight: 40 },
    { id: 'c2', name: 'Quizzes', weight: 60 },
  ]);
  stub('courseGradeMode', () => mode);
  stub('courseToday', () => '2026-10-29');
  stub('ReportBlocks', {
    renderBlockHeader: () => '<div class="gr-letterhead">Letterhead</div>',
    renderContinuedLine: () => '<div class="sheet-name-line">Ada Lovelace (continued)</div>',
    reportContext: () => ({}),
  });
  stub('ReportSheets', { sideHeight: paper => (paper === 'legal' ? 1284 : 996) });
  const word = mode === 'letter' ? null : 'Proficient';
  stub('studentGradeText', () => ({
    text: mode === 'letter' ? 'B 80%' : mode === 'both' ? 'Proficient · B 80%' : 'Proficient',
  }));
  stub('assessmentGroupGrade', () => ({ text: '80%' }));
  stub('studentGroupGradeText', () => (word ? (mode === 'both' ? word + ' · 80%' : word) : 'B 80%'));
  stub('categoryCalcMode', () => 'average');
  stub('fullName', s => s.firstName + ' ' + s.lastName);
}

/* A stage with no DOM: every block 50px tall, every text 7px a character. */
const stubStage = () => ({
  innerHTML: '',
  firstChild: { offsetHeight: 50 },
  querySelectorAll() {
    return [...this.innerHTML.matchAll(/class="gr-measure"[^>]*>([^<]*)</g)].map(m => ({
      offsetWidth: m[1].replace(/&#39;|&amp;/g, 'x').length * 7,
    }));
  },
});

const sheet = (cid, st, grade, paper) =>
  G.layoutStudent(cid, st, {}, { paper: paper || 'letter', stage: stubStage(), grade: grade || {} }).html;

/* The grade sheet's table, read back: the header cells and each row's cells, by column class. */
function table(html) {
  const head = html.match(/<div class="gr-row gr-head">((?:(?!<\/div>).)*)<\/div>/);
  const cells = s => [...s.matchAll(/<span class="gr-c gr-([a-zA-Z]+)[^"]*">([^<]*)<\/span>/g)].map(m => [m[1], m[2]]);
  const rows = [...html.matchAll(/<div class="gr-row(?: gr-missing)?(?: gr-wrap)?">((?:(?!<\/div>).)*)<\/div>/g)].map(
    m => Object.fromEntries(cells(m[1])),
  );
  return { head: cells(head[1]).map(c => c[1]), rows };
}
function summary(html) {
  const s = html.match(/<div class="gr-summary">([\s\S]*?)<\/div><div class="gr-term">/);
  return [...s[1].matchAll(/<div class="gr-row[^"]*"[^>]*>((?:(?!<\/div>).)*)<\/div>/g)].map(m =>
    [...m[1].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(c => c[1]),
  );
}
const lastLine = html => html.match(/<div class="gr-term"><span>([^<]*)<\/span><span class="gr-term-grade">([^<]*)</);

/* The no-mark cell as main printed it, a dash, taken out: what main
   printed with that one change, and how many cells it changed. */
const DASH_CELL = /(<span class="gr-c gr-score gr-r">)—(<\/span>)/g;
const fingerprint = s => createHash('sha256').update(s).digest('hex').slice(0, 20) + ' ' + s.length;
function withoutDashes(sheets) {
  let dashes = 0;
  const parts = {};
  Object.keys(sheets).forEach(k => {
    const v = / › rows/.test(k)
      ? sheets[k].replace(/"score":"—"/g, () => (dashes++, '"score":""'))
      : sheets[k].replace(DASH_CELL, (m, a, b) => (dashes++, a + b));
    parts[k] = fingerprint(v);
  });
  return { dashes, parts };
}

/* Every Letter sheet this file pins: the seeded class each way it can
   print, and every Demo student as a Letter class on both papers. */
function letterSheets() {
  const out = {};
  seedEvery('letter');
  [
    ['default', {}],
    ['numbers', { numbers: true }],
    ['newest', { order: 'newest' }],
    ['no summary', { summary: false }],
    ['no ungraded', { ungraded: false }],
  ].forEach(([name, grade]) => {
    out['seeded › letter › ' + name] = sheet(CID, ST, grade);
    out['seeded › legal › ' + name] = sheet(CID, ST, grade, 'legal');
  });
  out['seeded › rows'] = JSON.stringify(G.rows(CID, ST));
  out['seeded › summary'] = JSON.stringify(G.categorySummary(CID, ST));
  unstub();
  return out;
}

describe('the Quick Report in a Letter class', { timeout: 120000 }, () => {
  let now;
  let wasDemo;

  beforeAll(async () => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    now = letterSheets();
    const cid = loadDemoClass();
    await new Promise(r => setTimeout(r, 0));
    COURSES[cid].gradingSystem = 'letter';
    getStudents(cid).forEach(st => {
      ['letter', 'legal'].forEach(paper => {
        out(now, 'demo › ' + paper + ' › ' + st.id, sheet(cid, st, {}, paper));
      });
      out(now, 'demo › rows › ' + st.id, JSON.stringify(G.rows(cid, st, G.options({}))));
    });
    COURSES[cid].gradingSystem = 'proficiency';
    // Written on main: what it printed, the dashes out.
    if (UPDATE)
      writeFileSync(FILE, JSON.stringify(Object.assign({ frozenAt: FROZEN_AT }, withoutDashes(now)), null, 2) + '\n');
  }, 120000);
  function out(o, k, v) {
    o[k] = v;
  }

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('prints exactly what main printed, but for the no-mark cells, now blank', () => {
    const was = JSON.parse(readFileSync(FILE, 'utf-8'));
    const keys = Object.keys(was.parts);
    expect(keys.length).toBeGreaterThan(20);
    expect(Object.keys(now).sort()).toEqual(keys.slice().sort());
    expect(keys.filter(k => fingerprint(now[k]) !== was.parts[k])).toEqual([]);
    // Main had no-mark cells to take the dash out of; none is left.
    expect(was.dashes).toBeGreaterThan(10);
    expect(withoutDashes(now).dashes).toBe(0);
  });
});

describe('the Quick Report’s columns', () => {
  afterEach(unstub);

  it('a Proficiency class: Date, Assignment, Category, Result, and the Result as the piece was marked', () => {
    seedEvery('proficiency');
    const t = table(sheet(CID, ST));
    expect(t.head).toEqual(['Date', 'Assignment', 'Category', 'Result', '']);
    const by = Object.fromEntries(t.rows.map(r => [r.title, r]));
    expect(by['Plate Tectonics']).toMatchObject({ category: 'Labs', result: 'Proficient +', note: '' });
    expect(by['Rock Cycle Poster']).toMatchObject({ result: 'Developing', note: 'Late' });
    expect(by['Energy Quiz']).toMatchObject({ result: '8 / 10', note: '' });
    expect(by['Formulas Quiz']).toMatchObject({ result: '12 / 15', note: 'Late' });
    expect(by['Reading Log']).toMatchObject({ result: 'Complete' });
    expect(by['Safety Contract']).toMatchObject({ result: 'Incomplete' });
    expect(by['Density Lab']).toMatchObject({ result: 'Missing', note: '' });
    expect(by['Field Trip Form']).toMatchObject({ result: 'Excused', note: '' });
    // No mark yet: the cell is there and empty, no dash, no words.
    expect(by['Cells Sketch']).toMatchObject({ result: '', note: '' });
    t.rows.forEach(r => {
      expect(r).not.toHaveProperty('score');
      expect(r).not.toHaveProperty('outOf');
      expect(r).not.toHaveProperty('percent');
    });
  });

  it('a Proficiency class: the Missing row is marked as missing, and the summary and the last line read as proficiencies', () => {
    seedEvery('proficiency');
    const html = sheet(CID, ST);
    expect(html).toMatch(
      /<div class="gr-row gr-missing">(?:(?!<\/div>).)*Density Lab(?:(?!<\/div>).)*gr-result[^>]*>Missing</,
    );
    expect(summary(html)).toEqual([
      ['Category', 'Assessments', 'Proficiency'],
      ['Labs', '7', 'Proficient'],
      ['Quizzes', '2', 'Proficient'],
    ]);
    expect(lastLine(html).slice(1)).toEqual(['Overall Proficiency', 'Proficient']);
    expect(html).toContain('Missing Assignments: 1');
    expect(html).not.toContain('Course Grade');
    expect(html).not.toContain('—');
  });

  it('a Proficiency class: the same columns in two columns of rows, with no Category', () => {
    seedEvery('proficiency');
    const many = Array.from({ length: 140 }, (_, i) => ({
      id: 'p' + i,
      title: 'Piece ' + i,
      date: '2026-09-10',
      categoryId: 'c1',
    }));
    stub('getAssessments', () => many);
    stub('assessmentCellValue', () => ({ kind: 'level', value: 3, level: 3, late: false }));
    const lay = G.layoutStudent(CID, ST, {}, { paper: 'letter', stage: stubStage(), grade: {} });
    expect(lay.tier).toBe('two');
    const t = table(lay.html);
    expect(t.head).toEqual(['Date', 'Assignment', 'Result', '']);
    expect(t.rows[0]).toMatchObject({ title: 'Piece 0', result: 'Proficient' });
  });

  it('a Both class: Result and Percent, and the summary keeps its Weight', () => {
    seedEvery('both');
    const html = sheet(CID, ST);
    const t = table(html);
    expect(t.head).toEqual(['Date', 'Assignment', 'Category', 'Result', 'Percent', '']);
    const by = Object.fromEntries(t.rows.map(r => [r.title, r]));
    expect(by['Plate Tectonics']).toMatchObject({ result: 'Proficient +', percent: '83%' });
    expect(by['Energy Quiz']).toMatchObject({ result: '8 / 10', percent: '80%' });
    expect(by['Formulas Quiz']).toMatchObject({ result: '12 / 15', percent: '80%', note: 'Late' });
    expect(by['Reading Log']).toMatchObject({ result: 'Complete', percent: '' });
    expect(by['Density Lab']).toMatchObject({ result: 'Missing', percent: '' });
    expect(by['Field Trip Form']).toMatchObject({ result: 'Excused', percent: '' });
    expect(by['Cells Sketch']).toMatchObject({ result: '', percent: '', note: '' });
    expect(summary(html)).toEqual([
      ['Category', 'Weight', 'Assessments', 'Grade'],
      ['Labs', '40%', '7', 'Proficient · 80%'],
      ['Quizzes', '60%', '2', 'Proficient · 80%'],
    ]);
    // Its grade column is wide enough for "Developing · C- 55.4%" (it was 110px, and cut it off).
    expect(html).toContain(
      '<div class="gr-summary"><div class="gr-row gr-head" style="--gr-cols:minmax(0,1fr) 70px 90px 170px">',
    );
    expect(lastLine(html).slice(1)).toEqual(['Course Grade', 'Proficient · B 80%']);
    expect(html).not.toContain('—');
  });

  it('a Letter class keeps Score, Out Of and %, with a blank Score for no mark', () => {
    seedEvery('letter');
    const html = sheet(CID, ST);
    const t = table(html);
    expect(t.head).toEqual(['Date', 'Assignment', 'Category', 'Score', 'Out Of', '%', '']);
    const by = Object.fromEntries(t.rows.map(r => [r.title, r]));
    expect(by['Energy Quiz']).toMatchObject({ score: '8', outOf: '10', percent: '80%' });
    expect(by['Density Lab']).toMatchObject({ score: '', note: 'Missing' });
    expect(by['Cells Sketch']).toMatchObject({ score: '', outOf: '', percent: '', note: '' });
    expect(summary(html)[0]).toEqual(['Category', 'Weight', 'Assessments', 'Grade']);
    expect(lastLine(html)[1]).toBe('Course Grade');
  });

  it('gives the Assignment column the width Out Of had', () => {
    const template = mode => {
      seedEvery(mode);
      const html = sheet(CID, ST);
      unstub();
      return html.match(/--gr-cols:([^;]*);/)[1];
    };
    // The category gets what it needs here (7px a character); the title
    // takes the rest: 720px less 214px of fixed columns and four 6px gaps
    // is 482px. On main a Proficiency class had Score 80px, Out Of 40px and
    // a 52px note, 416px for the title; the note now holds only Late.
    expect(template('proficiency')).toBe('42px minmax(0,1fr) 60px 80px 32px');
    expect(template('both')).toBe('42px minmax(0,1fr) 60px 80px 48px 32px');
    expect(template('letter')).toBe('42px minmax(0,1fr) 60px 64px 40px 36px 52px');
  });

  it('is the same data underneath: rows() keeps its fields, a no-mark score blank', () => {
    seedEvery('proficiency');
    const rows = G.rows(CID, ST);
    expect(rows.find(r => r.title === 'Energy Quiz')).toMatchObject({ score: '8', outOf: '10', note: '' });
    expect(rows.find(r => r.title === 'Cells Sketch')).toMatchObject({ score: '', outOf: '', percent: '', note: '' });
    expect(G.resultText(rows.find(r => r.title === 'Energy Quiz'))).toBe('8 / 10');
    expect(G.resultText(rows.find(r => r.title === 'Density Lab'))).toBe('Missing');
    expect(G.resultText(rows.find(r => r.title === 'Rock Cycle Poster'))).toBe('Developing');
  });
});
