/**
 * Class Settings › Grading (teacher/cm-grading-bars.js): the sentence beside
 * each Points and Proficiency preset, and the Course Percentage bar whose
 * lines between categories drag. A drag types into the weight boxes, so it
 * saves what typing the same two numbers saves.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('what each preset does, said beside it', () => {
  it('names the BC Letter Bands percents and letters', () => {
    const t = CmGradingBars.presetTexts(DEFAULT_GRADING_SCALE);
    expect(t.bc).toBe(
      'Moves the markers onto the BC letter scale. Extending counts as 100% (A), Proficient 80% (B), ' +
        'Proficient + 86% (A), Developing 63% (C) and Emerging 45% (F), with the + and − in between. ' +
        'The bands don’t move.',
    );
  });

  it('names what Match Columns would save for the bands now', () => {
    expect(CmGradingBars.presetTexts(DEFAULT_GRADING_SCALE).match).toBe(
      'Moves the markers to where each band starts, so a proficiency score and a points score agree. ' +
        'For this class, Proficient counts as 73% (B) and Developing 50% (C-). ' +
        'Extending counts as halfway from its start to 100% (93%), and Emerging as 25%. The bands don’t move.',
    );
    const moved = {
      boundaries: [
        { min: 88, proficiency: 4 },
        { min: 75, proficiency: 3 },
        { min: 60, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
    };
    const t = CmGradingBars.presetTexts(moved).match;
    expect(t).toContain('Proficient counts as 75% (B) and Developing 60% (C)');
    expect(t).toContain('100% (94%), and Emerging as 50%.');
  });

  it('says the same numbers the preset saves', () => {
    const m = CmGradingBars.matchedPercents(DEFAULT_GRADING_SCALE.boundaries);
    expect(m).toEqual({ 4: 93, 3: 73, 2: 50, 1: 25 });
  });

  it('names what Reset to Defaults goes back to', () => {
    expect(CmGradingBars.presetTexts(DEFAULT_GRADING_SCALE).reset).toBe(
      'Each score counts as its level out of 4 (Proficient 75%), and the bands go back to 50%, 73% and 86%.',
    );
  });

  it('puts each sentence beside its button', () => {
    const html = CmGradingBars.renderPresets(DEFAULT_GRADING_SCALE);
    expect(html).toMatch(
      /data-action="cmPointsScaleBc">BC Letter Bands<\/button><div class="cm-hint cm-pts-preset-text">Moves the markers onto/,
    );
    expect(html).toMatch(/data-action="cmPointsScaleMatch">Match Columns<\/button><div[^>]*>Moves the markers to/);
    expect(html).toMatch(/cm-pts-reset" data-action="cmPointsScaleReset">Reset to Defaults<\/button><div[^>]*>Each/);
  });
});

describe('the Course Percentage bar', () => {
  const rows = [
    { name: 'Labs', weight: 40 },
    { name: 'Projects', weight: 35 },
    { name: 'Quizzes', weight: 25 },
  ];

  it('keeps the two categories’ total, in whole percents from 0', () => {
    expect(CmGradingBars.splitAt(rows, 0, 52.4)).toEqual([52, 23]);
    expect(CmGradingBars.splitAt(rows, 0, 90)).toEqual([75, 0]);
    expect(CmGradingBars.splitAt(rows, 1, -5)).toEqual([0, 60]);
    expect(CmGradingBars.splitAt(rows, 0, 40)).toBeNull();
    expect(CmGradingBars.splitAt(rows, 2, 10)).toBeNull();
  });
});

describe('dragging a line in Class Settings', () => {
  var originals;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    originals = { isDemoMode: globalThis.isDemoMode };
    globalThis.isDemoMode = () => true;
    _useSupabase = false;
  });
  afterEach(() => {
    globalThis.isDemoMode = originals.isDemoMode;
    localStorage.clear();
    DashClassManager.resetState();
  });

  async function openClass(cid) {
    saveCourses({ [cid]: { id: cid, name: 'Science 8', gradingSystem: 'letter' } });
    _cache.assessments[cid] = [];
    adoptCategoriesFromServer(cid, [
      { id: cid + '-1', name: 'Labs', weight: 40, displayOrder: 0 },
      { id: cid + '-2', name: 'Projects', weight: 35, displayOrder: 1 },
      { id: cid + '-3', name: 'Quizzes', weight: 25, displayOrder: 2 },
    ]);
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await tick();
  }
  function weights(cid) {
    return getCategories(cid).map(c => [c.name, c.weight]);
  }

  it('draws a handle on each line between two categories', async () => {
    await openClass('cd-bar');
    const html = CmGradingBars.renderWeightBar('cd-bar');
    const grips = html.match(/<button type="button" class="cm-weight-grip"[^>]*>/g);
    expect(grips).toHaveLength(2);
    expect(grips[0]).toContain('role="slider"');
    expect(grips[0]).toContain('aria-valuenow="40"');
    expect(grips[0]).toContain('aria-valuemax="75"');
    expect(grips[0]).toContain('style="left:40%"');
    expect(grips[1]).toContain('style="left:75%"');
    expect(html).toContain('<span class="cm-weight-name">Projects</span><span class="cm-weight-pct">35%</span>');
  });

  it('saves the same weights as typing them', async () => {
    await openClass('cd-typed');
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '0' }, value: '55' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '1' }, value: '20' });
    DashClassManager.handleAction('cmCatSave', { dataset: {} });
    await tick();
    const typed = weights('cd-typed');

    await openClass('cd-dragged');
    expect(CmGradingBars.moveLine(0, 55)).toBe(true);
    DashClassManager.handleAction('cmCatSave', { dataset: {} });
    await tick();
    const dragged = weights('cd-dragged');

    expect(typed).toEqual([
      ['Labs', 55],
      ['Projects', 20],
      ['Quizzes', 25],
    ]);
    expect(dragged).toEqual(typed);
  });

  it('saves nothing until Save Categories, as typing does', async () => {
    await openClass('cd-unsaved');
    CmGradingBars.moveLine(1, 50);
    expect(weights('cd-unsaved')).toEqual([
      ['Labs', 40],
      ['Projects', 35],
      ['Quizzes', 25],
    ]);
  });

  it('moves a focused line by 1% with the arrow keys, 5% with Shift', async () => {
    await openClass('cd-keys');
    const grip = { dataset: { idx: '1' } };
    const key = (k, shiftKey = false) => {
      let stopped = false;
      const handled = DashClassManager.handleKeydown({
        key: k,
        shiftKey,
        target: { closest: sel => (sel === '.cm-weight-grip' ? grip : null) },
        preventDefault() {
          stopped = true;
        },
      });
      return handled && stopped;
    };
    expect(key('ArrowRight')).toBe(true);
    expect(key('ArrowLeft', true)).toBe(true);
    expect(key('ArrowUp')).toBe(true);
    DashClassManager.handleAction('cmCatSave', { dataset: {} });
    await tick();
    expect(weights('cd-keys')).toEqual([
      ['Labs', 40],
      ['Projects', 32],
      ['Quizzes', 28],
    ]);
  });
});
