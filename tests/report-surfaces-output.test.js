/**
 * What every report surface gives for the Demo class, pinned
 * (student page build plan, S2-T1: reports read grades through one entry).
 *
 * Progress Reports, the Quick Report and its Feedback Pages, the Term
 * Questionnaire with Generate, Sent to Phones, Print Grades and Export are
 * each drawn for Demo Mode's Science 8 (tests/helpers/report-surfaces.js)
 * and compared with tests/fixtures/report-surfaces.json, a fingerprint of
 * each part's text.
 *
 * The file was made on main before S2-T1 changed a line of the report
 * code, so this test passing says S2-T1 changed no report's output. It
 * stays as the reports' own golden file: a PR that means to change what a
 * report prints regenerates it and says so; any other PR must pass it
 * unchanged.
 *
 *   UPDATE_REPORT_SURFACES=1 npx vitest run tests/report-surfaces-output.test.js
 *
 * The same every run: the clock is frozen (Demo Mode moves its dates so the
 * class ends yesterday), Generate is seeded from the student and the term,
 * and nothing reads a random id.
 */
import './setup.js';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { SURFACES, surfaceOf, surfaces } from './helpers/report-surfaces.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, 'fixtures/report-surfaces.json');
const UPDATE = process.env.UPDATE_REPORT_SURFACES === '1';

const fingerprint = s => createHash('sha256').update(s).digest('hex').slice(0, 20) + ' ' + s.length;

describe('what each report surface gives for the Demo class', () => {
  let drawn;
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    const cid = loadDemoClass();
    clearProfCache();
    drawn = surfaces(cid);
  });

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('draws every surface, and each part says something', () => {
    const bySurface = {};
    Object.keys(drawn).forEach(key => (bySurface[surfaceOf(key)] = (bySurface[surfaceOf(key)] || 0) + 1));
    expect(Object.keys(bySurface).sort()).toEqual(SURFACES.slice().sort());
    // 27 students, the year and two terms; a block is drawn at two widths.
    expect(bySurface.quick).toBe(81);
    expect(bySurface.questionnaire).toBe(81);
    expect(bySurface.phones).toBe(81);
    expect(bySurface.printGrades).toBe(15);
    expect(bySurface.export).toBe(1);
    expect(bySurface.progress).toBeGreaterThan(150);
    // A grade is in there: the output is not a page of dashes.
    const one = Object.keys(drawn).find(k => k.indexOf('year › phones › ') === 0);
    expect(JSON.parse(drawn[one]).overall.text).toMatch(/\d/);
    expect(drawn['year › printGrades › {}']).toMatch(/\d/);
    expect(drawn['year › export › workbook'].length).toBeGreaterThan(50000);
  });

  it('gives the same output twice in a row', () => {
    const again = surfaces('sci8');
    expect(Object.keys(again)).toEqual(Object.keys(drawn));
    /* All but what Generate drafts: it remembers the stories it has told the
       class this session and picks the one used least, so a second draft
       for the same student is another version by design. The file below
       holds the first. */
    const steady = (key, value) => {
      if (surfaceOf(key) !== 'questionnaire') return value;
      const part = JSON.parse(value);
      delete part.generated;
      delete part.sentences;
      return JSON.stringify(part);
    };
    const moved = Object.keys(drawn).filter(k => steady(k, again[k]) !== steady(k, drawn[k]));
    expect(moved).toEqual([]);
  });

  it('matches tests/fixtures/report-surfaces.json, part for part', () => {
    const now = {};
    Object.keys(drawn).forEach(key => (now[key] = fingerprint(drawn[key])));
    if (UPDATE) {
      writeFileSync(FILE, JSON.stringify({ frozenAt: FROZEN_AT, parts: now }, null, 2) + '\n');
      return;
    }
    const kept = JSON.parse(readFileSync(FILE, 'utf-8'));
    expect(kept.frozenAt).toBe(FROZEN_AT);
    expect(Object.keys(now)).toEqual(Object.keys(kept.parts));
    // Named, so a failure says which surface, which view and which student or block moved.
    const moved = Object.keys(now).filter(key => now[key] !== kept.parts[key]);
    expect(moved).toEqual([]);
  });
});
