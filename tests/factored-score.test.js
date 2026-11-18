/**
 * The factored score (2026-11-18): points work at a Factor other than 1×
 * can show students its score times the Factor ("20 / 24" for 5 / 6 at 4×).
 * Display only: the score entered stays the stored one and the course % is
 * unchanged (DECISIONS, "The factored score").
 *
 *   constants.js    factoredPoints(a, points, max)
 *   factor-field.js the form's Show Students the Factored Score switch, and
 *                   the grader's "= 20 / 24" chip beside the score box
 *   data layer      create_assessment's p_students_see_factored (only when
 *                   on), update_assessment's students_see_factored, the
 *                   class load's students_see_factored read back
 *   student page    tests/student-view.test.js
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const AID = '44444444-4444-4444-8444-444444444444';

describe('factoredPoints', () => {
  const quiz = { scoreMode: 'points', maxPoints: 6, weight: 4 };

  it('multiplies the score and the most by the Factor', () => {
    expect(factoredPoints(quiz, 5)).toEqual({ points: 20, outOf: 24, factor: 4 });
    expect(factoredPoints(quiz, 0)).toEqual({ points: 0, outOf: 24, factor: 4 });
    expect(factoredPoints(quiz, '5', 10)).toEqual({ points: 20, outOf: 40, factor: 4 });
    // The server's names work too (the student page's rows).
    expect(factoredPoints({ score_mode: 'points', max_points: 6, weight: 0.5 }, 3)).toEqual({
      points: 1.5,
      outOf: 3,
      factor: 0.5,
    });
  });

  it('keeps the percent the same', () => {
    const fp = factoredPoints(quiz, 5);
    expect(formatPointsPercent(fp.points, fp.outOf)).toBe(formatPointsPercent(5, 6));
  });

  it('is written as people write points', () => {
    const fp = factoredPoints({ scoreMode: 'points', maxPoints: 6, weight: 0.7 }, 3.5);
    expect(formatPoints(fp.points) + ' / ' + formatPoints(fp.outOf)).toBe('2.45 / 4.2');
  });

  it('means nothing at 1×, off points work, or with no score', () => {
    expect(factoredPoints({ scoreMode: 'points', maxPoints: 6, weight: 1 }, 5)).toBe(null);
    expect(factoredPoints({ scoreMode: 'points', maxPoints: 6 }, 5)).toBe(null);
    expect(factoredPoints({ scoreMode: 'complete', weight: 4 }, 1)).toBe(null);
    expect(factoredPoints({ scoreMode: 'proficiency', weight: 4 }, 3)).toBe(null);
    expect(factoredPoints(quiz, null)).toBe(null);
    expect(factoredPoints(quiz, '')).toBe(null);
    expect(factoredPoints(quiz, 'abc')).toBe(null);
    expect(factoredPoints(null, 5)).toBe(null);
  });
});

describe('the form switch', () => {
  let doc;
  // The form's parts the switch reads: scoring, Max Points, Factor, and the share bar it sits under.
  function form(mode, max, weight, on) {
    doc = parseHTML(
      '<!DOCTYPE html><html><body><input id="af-scoremode" value="' +
        mode +
        '"><input id="af-maxpoints" value="' +
        max +
        '"><div id="m"></div><div class="af-counts-as" id="af-counts-as"></div>' +
        FactorField.factoredHtml(mode, max, weight, on) +
        '</body></html>',
    ).document;
    doc.getElementById('m').innerHTML = FactorField.fieldHtml(weight);
    return doc;
  }
  const setWeight = v => {
    const el = doc.getElementById('af-weight');
    el.value = String(v);
    FactorField.track(el);
  };

  it('is on the form only for points work at a Factor other than 1×', () => {
    expect(FactorField.factoredHtml('points', 6, 1, false)).toBe('');
    expect(FactorField.factoredHtml('proficiency', 0, 4, false)).toBe('');
    expect(FactorField.factoredHtml('complete', 1, 4, false)).toBe('');
    const html = FactorField.factoredHtml('points', 6, 4, true);
    expect(html).toContain('Show Students the Factored Score');
    expect(html).toContain('Students see it out of 24. You still grade it out of 6.');
    expect(html).toContain('role="switch"');
    expect(html).toContain(' checked');
  });

  it('comes in when the Factor leaves 1×, and hides (keeping its value) when it goes back', () => {
    form('points', 6, 1, false);
    expect(doc.getElementById('af-factored-wrap')).toBe(null);
    setWeight(4);
    FactorField.renderBar(doc.getElementById('af-counts-as'), null);
    const wrap = doc.getElementById('af-factored-wrap');
    expect(wrap).not.toBe(null);
    expect(wrap.hidden).toBe(false);
    expect(doc.getElementById('af-factored-hint').textContent).toBe(
      'Students see it out of 24. You still grade it out of 6.',
    );
    doc.getElementById('af-factored').checked = true;
    expect(FactorField.factoredOn(doc)).toBe(true);
    setWeight(1);
    FactorField.refreshFactored(doc);
    expect(wrap.hidden).toBe(true);
    expect(doc.getElementById('af-factored').checked).toBe(true);
    // Hidden, it saves as off.
    expect(FactorField.factoredOn(doc)).toBe(false);
  });

  it('follows the Max Points in its hint, and saves as off on other scoring', () => {
    form('points', 6, 4, true);
    doc.getElementById('af-maxpoints').value = '10';
    FactorField.refreshFactored(doc);
    expect(doc.getElementById('af-factored-hint').textContent).toBe(
      'Students see it out of 40. You still grade it out of 10.',
    );
    doc.getElementById('af-scoremode').value = 'proficiency';
    FactorField.refreshFactored(doc);
    expect(doc.getElementById('af-factored-wrap').hidden).toBe(true);
    expect(FactorField.factoredOn(doc)).toBe(false);
  });

  it('is set from a past assessment', () => {
    form('points', 6, 4, false);
    FactorField.setFactored(doc, true);
    expect(FactorField.factoredOn(doc)).toBe(true);
    FactorField.setFactored(doc, false);
    expect(FactorField.factoredOn(doc)).toBe(false);
  });
});

describe('the grader chip', () => {
  it('shows the score times the Factor beside the box', () => {
    const a = { scoreMode: 'points', maxPoints: 6, weight: 4 };
    const html = FactorField.chipHtml(a, 5, 6);
    expect(html).toContain('class="gb-pts-factored"');
    expect(html).toContain('>= 20 / 24<');
    expect(html).toContain('title="Times its Factor, 4×"');
    // Unscored: the chip is there, empty, ready for the first score.
    expect(FactorField.chipHtml(a, null, 6)).toContain('></span>');
  });

  it('is not drawn at 1×', () => {
    expect(FactorField.chipHtml({ scoreMode: 'points', maxPoints: 6, weight: 1 }, 5, 6)).toBe('');
    expect(FactorField.chipHtml({ scoreMode: 'points', maxPoints: 6 }, 5, 6)).toBe('');
  });

  it('follows the box as the teacher types', () => {
    const { document } = parseHTML(
      '<!DOCTYPE html><html><body><div class="score-row">' +
        FactorField.chipHtml({ scoreMode: 'points', maxPoints: 6, weight: 2.5 }, null, 6) +
        '</div></body></html>',
    );
    const row = document.querySelector('.score-row');
    FactorField.refreshChip(row, 4, 6);
    expect(row.querySelector('.gb-pts-factored').textContent).toBe('= 10 / 15');
    FactorField.refreshChip(row, null, 6);
    expect(row.querySelector('.gb-pts-factored').textContent).toBe('');
  });
});

describe('the switch on the write path', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  function seed(value) {
    _cache.assessments[CID] = value;
    localStorage.setItem('gb-' + _DATA_KEYS.assessments + '-' + CID, JSON.stringify(value));
  }

  beforeEach(() => {
    localStorage.clear();
    _cache.assessments = {};
    _assessmentSaveQueue = {};
    _assessmentDispatchQueue = {};
    _serverState = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  const quiz = extra =>
    Object.assign({ title: 'Quiz', tagIds: [], scoreMode: 'points', maxPoints: 6, weight: 4 }, extra);

  it('sends it with a new assessment when it is on', async () => {
    seed([]);
    saveAssessments(CID, [quiz({ id: 'local-1', studentsSeeFactored: true })]);
    await settle();
    expect(fake.committed.find(c => c.name === 'create_assessment').params.p_students_see_factored).toBe(true);
  });

  it('leaves the parameter out when it is off', async () => {
    seed([]);
    saveAssessments(CID, [quiz({ id: 'local-1' })]);
    await settle();
    const call = fake.committed.find(c => c.name === 'create_assessment');
    expect('p_students_see_factored' in call.params).toBe(false);
  });

  it('sends a change in the update patch, and only the change', async () => {
    _persistLoadedField(CID, 'assessments', [quiz({ id: AID })]);
    saveAssessments(
      CID,
      getAssessments(CID).map(a => Object.assign({}, a, { studentsSeeFactored: true })),
    );
    await settle();
    expect(fake.committed.find(c => c.name === 'update_assessment').params.p_patch).toEqual({
      students_see_factored: true,
    });
  });

  it('sends it off when it is turned off', async () => {
    _persistLoadedField(CID, 'assessments', [quiz({ id: AID, studentsSeeFactored: true })]);
    saveAssessments(
      CID,
      getAssessments(CID).map(a => Object.assign({}, a, { studentsSeeFactored: undefined })),
    );
    await settle();
    expect(fake.committed.find(c => c.name === 'update_assessment').params.p_patch).toEqual({
      students_see_factored: false,
    });
  });

  it('sends nothing when it did not change', async () => {
    _persistLoadedField(CID, 'assessments', [quiz({ id: AID, studentsSeeFactored: true })]);
    saveAssessments(
      CID,
      getAssessments(CID).map(a => Object.assign({}, a)),
    );
    await settle();
    expect(fake.calls.filter(c => c.name === 'update_assessment')).toHaveLength(0);
  });

  it('is read back from the class load, and from an older server as off', () => {
    _v2GradebookToCache(CID, {
      course: { id: CID },
      students: [],
      assessments: [
        { id: AID, title: 'Quiz', score_mode: 'points', max_points: 6, weight: 4, students_see_factored: true },
        { id: 'b2', title: 'Old', score_mode: 'points', max_points: 6, weight: 4 },
      ],
      categories: [],
      modules: [],
      cells: {},
    });
    const byId = Object.fromEntries(getAssessments(CID).map(a => [a.id, a]));
    expect(byId[AID].studentsSeeFactored).toBe(true);
    expect(byId.b2.studentsSeeFactored).toBe(false);
    const next = _assessmentFromDetail(
      { id: AID, title: 'Quiz', studentsSeeFactored: true },
      { assessment: { id: AID, students_see_factored: false }, linked_tags: [] },
    );
    expect(next.studentsSeeFactored).toBe(false);
  });
});
