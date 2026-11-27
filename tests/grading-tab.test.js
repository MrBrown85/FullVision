/**
 * Class Settings' Grading tab. Each calculation method shows its result on
 * the same example scores, the % shows as the class rounds it, and switching
 * the method says how many students it moves before it changes anything.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'e0000000-0000-4000-8000-00000000g7ab';
const TAG = 'tag-1';
const SEC = 'sec-1';
const EXAMPLE = [1, 2, 2, 3, 4];

function student(id, first, last) {
  return { id, firstName: first, lastName: last, enrolledDate: '2026-09-01' };
}

// Two students: Amara's scores move under Mean, Bo's (all 3s) don't.
function seedClass(config) {
  saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
  _cache.courseConfigs[CID] = config || {};
  saveStudents(CID, [student('s1', 'Amara', 'Osei'), student('s2', 'Bo', 'Tran')]);
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: SEC, name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = ['a', 'b', 'c'].map(function (id, i) {
    return {
      id,
      title: 'Lab ' + id,
      scoreMode: 'proficiency',
      tagIds: [TAG],
      type: 'summative',
      date: '2026-10-0' + (i + 1),
    };
  });
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'a', tagId: TAG, score: 1, date: '2026-10-01' },
      { assessmentId: 'b', tagId: TAG, score: 2, date: '2026-10-02' },
      { assessmentId: 'c', tagId: TAG, score: 4, date: '2026-10-03' },
    ],
    s2: [
      { assessmentId: 'a', tagId: TAG, score: 3, date: '2026-10-01' },
      { assessmentId: 'b', tagId: TAG, score: 3, date: '2026-10-02' },
    ],
  };
  _cache.statuses[CID] = {};
  clearProfCache();
}

describe('calculation method examples', () => {
  it('gives each method its result on 1, 2, 2, 3, 4', () => {
    expect(calcMethodExample(EXAMPLE, 'mostRecent', 0.65)).toBe(4);
    expect(calcMethodExample(EXAMPLE, 'highest', 0.65)).toBe(4);
    expect(calcMethodExample(EXAMPLE, 'average', 0.65)).toBeCloseTo(2.4);
    expect(calcMethodExample(EXAMPLE, 'median', 0.65)).toBe(2);
    expect(calcMethodExample(EXAMPLE, 'mode', 0.65)).toBe(2);
    expect(calcMethodExample(EXAMPLE, 'decayingAvg', 0.65)).toBeCloseTo(3.51, 2);
  });
});

describe('course % as the class shows it', () => {
  beforeEach(() => seedClass());
  it('rounds to a whole number or one decimal', () => {
    _cache.courseConfigs[CID] = { roundPercent: true };
    expect(formatCoursePercent(CID, 85.94)).toBe('86%');
    _cache.courseConfigs[CID] = { roundPercent: false };
    expect(formatCoursePercent(CID, 85.94)).toBe('85.9%');
    expect(formatCoursePercent(CID, null)).toBe('—');
  });
});

describe('switching the calculation method', () => {
  var confirms;
  var originalConfirm;
  var originalGetElementById;
  var main;

  beforeEach(() => {
    localStorage.clear();
    seedClass();
    confirms = [];
    originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirms.push({ title, message, okLabel, run: onConfirm });
    };
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    globalThis.showConfirm = originalConfirm;
    document.getElementById = originalGetElementById;
  });

  it('previews how many students move without changing the saved method', () => {
    const preview = previewCalcMethodChange(CID, 'average');
    expect(preview).toMatchObject({ changed: 1, total: 2 });
    expect(preview.example).toEqual({ name: 'Amara Osei', before: '4.0', after: '2.3' });
    expect(getCourseConfig(CID).calcMethod).toBeUndefined();
    expect(getOverallProficiency(CID, 's1')).toBe(4);
  });

  it('asks first, then saves the method only when the teacher agrees', () => {
    DashClassManager.handleAction('cmSetCalcMethod', { dataset: { value: 'average' } });
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Change Calculation Method to Mean?');
    expect(confirms[0].message).toContain('1 of your 2 students');
    expect(confirms[0].message).toContain('Amara Osei goes from 4.0 to 2.3');
    expect(COURSES[CID].calcMethod).toBe('mostRecent');

    confirms[0].run();
    expect(COURSES[CID].calcMethod).toBe('average');
    expect(getCourseConfig(CID).calcMethod).toBe('average');
  });

  it('changes at once when no student would move', () => {
    _cache.scores[CID] = {};
    clearProfCache();
    DashClassManager.handleAction('cmSetCalcMethod', { dataset: { value: 'highest' } });
    expect(confirms).toHaveLength(0);
    expect(COURSES[CID].calcMethod).toBe('highest');
  });

  it('Class Settings shows the year so far, even when opened over a report in view (Colin, 2026-11-03)', () => {
    // Most Recent: Amara's last score is the 4 on Oct 3. As of a report
    // ending Oct 2 it would be her 2.
    _cache.courseConfigs[CID] = {
      reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-02' }],
    };
    clearProfCache();
    setActiveTerm(CID, 1);
    expect(studentGradeSummary(CID, 's1').text).toBe('2.0');
    try {
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
      expect(main.innerHTML).toContain('cm-check-value">4.0<');
      // The report's term is cleared, so the method preview counts the year so far.
      expect(getActiveTerm(CID)).toBeNull();
      expect(previewCalcMethodChange(CID, 'average').example).toEqual({
        name: 'Amara Osei',
        before: '4.0',
        after: '2.3',
      });
    } finally {
      setActiveTerm(CID, null);
    }
  });

  it('draws the tab with the method rule and the student check', () => {
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(main.innerHTML).toContain('Exactly How Most Recent Score Works');
    expect(main.innerHTML).toContain('Check With a Student');
    expect(main.innerHTML).toContain('Not used in a Proficiency class');
  });
});

describe('Points and Proficiency as one scale on the Grading tab', () => {
  var originalGetElementById;
  var originalConfirm;
  var originalUndo;
  var main;
  var confirms;
  var undos;

  // A marker's or handle's button as the browser hands it to the handlers.
  function button(kind, value) {
    var dataset =
      kind === 'step' ? { action: 'cmPtsPick', kind, key: value } : { action: 'cmPtsPick', kind, level: value };
    var el = { tagName: 'BUTTON', dataset };
    el.closest = sel => (sel === '.cm-pts-scale' || sel === '[data-action="cmPtsPick"]' ? el : null);
    return el;
  }
  function act(name, dataset) {
    DashClassManager.handleAction(name, { dataset: dataset || {} });
  }
  function edit() {
    act('cmPtsEdit');
  }
  function save() {
    act('cmPtsSave');
  }
  function pick(kind, value) {
    DashClassManager.handleAction('cmPtsPick', button(kind, value));
  }
  function key(target, k, extra) {
    var prevented = false;
    var handled = DashClassManager.handleKeydown(
      Object.assign({ key: k, target, preventDefault: () => (prevented = true) }, extra || {}),
    );
    return handled && prevented;
  }
  function type(value) {
    DashClassManager.handleChange({ id: 'cm-pts-input', value, dataset: { actionChange: 'cmPointsScale' } });
  }
  function input() {
    var el = { id: 'cm-pts-input', tagName: 'INPUT', value: '', dataset: {} };
    el.closest = sel => (sel === '.cm-pts-scale' ? el : null);
    return el;
  }
  // The draft while editing: what Save would write.
  function draft() {
    return CmPtsEdit.draft(CID);
  }
  function markerLeft(k) {
    var m = main.innerHTML.match(new RegExp('data-key="' + k.replace('+', '\\+') + '" style="left:([0-9.]+)%"'));
    return m ? Number(m[1]) : null;
  }
  function marker(k) {
    var m = main.innerHTML.match(
      new RegExp('<div class="cm-pts-marker[^"]*" data-key="' + k.replace('+', '\\+') + '"[^>]*>'),
    );
    return m ? m[0] : '';
  }
  function editLine() {
    var m = main.innerHTML.match(/<div class="cm-pts-edit">(.*?)<\/div>/);
    return m ? m[1] : null;
  }
  // The scale as saved, nothing in the draft.
  const DEFAULTS = { 4: 100, 3: 75, 2: 50, 1: 25 };

  beforeEach(() => {
    localStorage.clear();
    seedClass();
    main = { innerHTML: '' };
    confirms = [];
    undos = [];
    originalUndo = globalThis.showUndoToast;
    globalThis.showUndoToast = (message, undo) => undos.push({ message, undo });
    originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirms.push({ title, message, okLabel, run: onConfirm });
    };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    globalThis.showConfirm = originalConfirm;
    globalThis.showUndoToast = originalUndo;
  });

  it('draws Points to Proficiency as four bands split at the class’s starts', () => {
    expect(main.innerHTML).toContain('Points and Proficiency');
    expect(main.innerHTML).toContain('<span class="cm-pts-band lv-1" data-lv="1" style="width:50%">Emerging</span>');
    expect(main.innerHTML).toContain('<span class="cm-pts-band lv-2" data-lv="2" style="width:23%">Developing</span>');
    expect(main.innerHTML).toContain('<span class="cm-pts-band lv-3" data-lv="3" style="width:13%">Proficient</span>');
    expect(main.innerHTML).toContain('<span class="cm-pts-band lv-4" data-lv="4" style="width:14%">Extending</span>');
    expect(main.innerHTML).toMatch(/data-level="2" style="left:50%"/);
    expect(main.innerHTML).toMatch(/aria-label="Proficient starts at 73%"[^>]*>73%<\/span>/);
    expect(main.innerHTML).toMatch(/data-level="4" style="left:86%"/);
    [0, 25, 50, 75, 100].forEach(t => expect(main.innerHTML).toContain('style="left:' + t + '%">' + t + '%</span>'));
  });

  it('puts a Counts As marker for every step at the percent it counts as', () => {
    expect(markerLeft('1')).toBe(25);
    expect(markerLeft('1+')).toBeCloseTo(33.33, 2);
    expect(markerLeft('2-')).toBeCloseTo(41.67, 2);
    expect(markerLeft('3')).toBe(75);
    expect(markerLeft('3+')).toBeCloseTo(83.33, 2);
    expect(markerLeft('4')).toBe(100);
    expect(main.innerHTML).toMatch(/aria-label="3\+ counts as 83.3%"[^>]*>3\+<\/span>/);
    expect(main.innerHTML).toContain('>2−</span>');
    expect(marker('2')).toContain('lv-2');
    // Level ÷ 4 is 8.3 apart: one row.
    expect(main.innerHTML).not.toContain('is-low');
    expect(main.innerHTML).not.toContain('is-two-rows');
    // Locked: no line to type in, and no presets.
    expect(editLine()).toBeNull();
    expect(main.innerHTML).not.toContain('cm-pts-actions');
  });

  it('is locked at rest: the markers are labels, and Edit and Use in Other Classes are offered', () => {
    expect(main.innerHTML).not.toContain('data-action="cmPtsPick"');
    expect(main.innerHTML).toContain('data-action="cmPtsEdit">Edit</button>');
    expect(main.innerHTML).toContain('data-action="cmPtsUse">Use in Other Classes…</button>');
    expect(main.innerHTML).not.toContain('Drag a marker or a % tab, or pick one and type.');
    expect(main.innerHTML).toContain('The coloured bands are the proficiency a points score shows as.');
    // An arrow key does nothing: nothing is focusable to take it, and a stray one is not taken.
    var before = main.innerHTML;
    key(button('step', '3+'), 'ArrowRight');
    expect(main.innerHTML).toBe(before);
    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
  });

  it('Edit opens a draft: buttons, the presets, Cancel and a Save that waits for a change', () => {
    edit();
    expect(main.innerHTML).toContain('cm-pts-scroll is-editing');
    expect(main.innerHTML).toContain('data-action="cmPtsCancel">Cancel</button>');
    expect(main.innerHTML).toMatch(/id="cm-pts-save" data-action="cmPtsSave" disabled>Save<\/button>/);
    expect(main.innerHTML).toContain('Drag a marker or a % tab, or pick one and type.');
    expect(main.innerHTML).toContain('data-action="cmPointsScaleBc">BC Letter Bands</button>');
    expect(main.innerHTML).toContain('data-action="cmPtsPick" data-kind="step" data-key="3"');
    expect(main.innerHTML).not.toContain('data-action="cmPtsUse"');
    pick('step', '3');
    type('80');
    expect(main.innerHTML).not.toMatch(/id="cm-pts-save" data-action="cmPtsSave" disabled/);
  });

  it('Cancel drops the draft and nothing was saved', () => {
    edit();
    pick('step', '3');
    type('80');
    expect(markerLeft('3')).toBe(80);
    act('cmPtsCancel');
    expect(markerLeft('3')).toBe(75);
    expect(main.innerHTML).toContain('cm-pts-scroll is-rest');
    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
    expect(CmPtsEdit.draft(CID)).toBeNull();
  });

  it('leaving the Grading tab, or the class, drops the draft', () => {
    edit();
    pick('step', '3');
    type('80');
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'details' } });
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(markerLeft('3')).toBe(75);
    expect(main.innerHTML).toContain('cm-pts-scroll is-rest');
    edit();
    pick('step', '3');
    type('80');
    DashClassManager.resetState();
    expect(CmPtsEdit.draft(CID)).toBeNull();
  });

  it('staggers markers that sit close together on two rows', () => {
    edit();
    act('cmPointsScaleBc');
    expect(main.innerHTML).toContain('cm-pts-ruler is-two-rows');
    expect(markerLeft('1')).toBe(45);
    expect(markerLeft('1+')).toBe(50);
    expect(markerLeft('3+')).toBe(86);
    // 45 and 50 are a pill apart: 1+ drops; 55 is clear of 45 and stays up.
    expect(marker('1')).not.toContain('is-low');
    expect(marker('1+')).toContain('is-low');
    expect(marker('2-')).not.toContain('is-low');
    expect(marker('2+')).toContain('is-low');
  });

  it('flags a whole level that reads back as another, in its name', () => {
    edit();
    pick('step', '3');
    type('70');
    expect(main.innerHTML).toContain('aria-label="3 counts as 70%, which shows as Developing"');
    expect(main.innerHTML).toContain('aria-label="4 counts as 100%"');
  });

  it('shows one line to edit what is picked, and lets go when it is clicked again', () => {
    edit();
    pick('step', '3+');
    expect(editLine()).toContain('<span class="cm-pts-edit-name">3+</span> counts as</label>');
    expect(editLine()).toMatch(/id="cm-pts-input"[^>]*step="0.1"[^>]*value="83.3"/);
    expect(main.innerHTML).toMatch(/id="cm-pts-step-3p"[^>]*aria-pressed="true"/);
    pick('edge', '3');
    expect(editLine()).toContain('<span class="cm-pts-edit-name">Proficient</span> starts at</label>');
    expect(editLine()).toMatch(/id="cm-pts-input"[^>]*value="73"/);
    expect(main.innerHTML).toMatch(/id="cm-pts-step-3p"[^>]*aria-pressed="false"/);
    expect(main.innerHTML).toMatch(/id="cm-pts-edge-3"[^>]*aria-pressed="true"/);
    pick('edge', '3');
    expect(editLine()).toBe('');
  });

  it('holds a typed Counts As in the draft, and saves it on Save', () => {
    edit();
    pick('step', '3+');
    type('85');
    expect(draft().percents).toEqual({ ...DEFAULTS, '3+': 85 });
    expect(getGradingScale(CID).percents).toEqual(DEFAULTS);
    expect(markerLeft('3+')).toBe(85);
    expect(editLine()).toMatch(/value="85"/);
    save();
    expect(getGradingScale(CID).percents).toEqual({ ...DEFAULTS, '3+': 85 });
    expect(markerLeft('3+')).toBe(85);
    // Back at rest.
    expect(editLine()).toBeNull();
    expect(CmPtsEdit.draft(CID)).toBeNull();
  });

  it('cites the class’s Proficient in the course % rule', () => {
    expect(main.innerHTML).toContain('Proficient counts as 75% now.');
    edit();
    pick('step', '3');
    type('80');
    expect(main.innerHTML).toContain('Proficient counts as 75% now.');
    save();
    expect(getGradingScale(CID).percents).toEqual({ 4: 100, 3: 80, 2: 50, 1: 25 });
    expect(main.innerHTML).toContain('Proficient counts as 80% now.');
  });

  it('leaves a + or − in between when it is typed at that value or cleared', () => {
    edit();
    pick('step', '3-');
    type('66.7');
    expect(draft().percents).toEqual(DEFAULTS);
    pick('step', '3+');
    type('86');
    expect(draft().percents['3+']).toBe(86);
    type('');
    expect(draft().percents).toEqual(DEFAULTS);
    expect(markerLeft('3+')).toBeCloseTo(83.33, 2);
  });

  it('saves where a proficiency starts and keeps any saved labels', () => {
    _cache.courseConfigs[CID].gradingScale = {
      boundaries: structuredClone(DEFAULT_GRADING_SCALE.boundaries),
      labels: [null, null, 'Meeting', null],
    };
    edit();
    pick('edge', '4');
    type('90');
    pick('edge', '3');
    type('75');
    pick('edge', '2');
    type('55');
    save();
    expect(getGradingScale(CID)).toEqual({
      boundaries: [
        { min: 90, proficiency: 4 },
        { min: 75, proficiency: 3 },
        { min: 55, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
      percents: { 4: 100, 3: 75, 2: 50, 1: 25 },
      labels: [null, null, 'Meeting', null],
    });
    expect(main.innerHTML).toContain('<span class="cm-pts-band lv-1" data-lv="1" style="width:55%">Emerging</span>');
  });

  it('refuses a step out of order and shows what was typed', () => {
    edit();
    pick('step', '3');
    type('100');
    expect(draft().percents).toEqual(DEFAULTS);
    expect(main.innerHTML).toContain(
      '<div class="cm-pts-error" id="cm-pts-error" role="alert">Each step must count for more than the one below it.</div>',
    );
    expect(editLine()).toMatch(/value="100"[^>]*aria-invalid="true"/);
    // A good value clears it.
    type('76');
    expect(main.innerHTML).not.toContain('cm-pts-error');
    expect(draft().percents[3]).toBe(76);
  });

  it('refuses a proficiency that starts at or below the one under it', () => {
    edit();
    pick('edge', '3');
    type('90');
    expect(draft().boundaries).toEqual(DEFAULT_GRADING_SCALE.boundaries);
    expect(main.innerHTML).toContain('Each proficiency must start higher than the one below it.');
    pick('edge', '2');
    type('0');
    expect(draft().boundaries).toEqual(DEFAULT_GRADING_SCALE.boundaries);
    expect(main.innerHTML).toContain('Each proficiency must start higher than the one below it.');
  });

  it('nudges a marker by 0.1, or 1 with Shift, in the draft', () => {
    edit();
    var btn = button('step', '3+');
    expect(key(btn, 'ArrowRight')).toBe(true);
    expect(draft().percents['3+']).toBe(83.4);
    // The nudge picks it.
    expect(editLine()).toMatch(/value="83.4"/);
    key(btn, 'ArrowLeft', { shiftKey: true });
    expect(draft().percents['3+']).toBe(82.4);
    expect(markerLeft('3+')).toBe(82.4);
    expect(getGradingScale(CID).percents).toEqual(DEFAULTS);
  });

  it('nudges a handle by 1, or 5 with Shift, in the draft', () => {
    edit();
    var btn = button('edge', '3');
    key(btn, 'ArrowRight');
    expect(draft().boundaries[1]).toEqual({ min: 74, proficiency: 3 });
    key(btn, 'ArrowRight', { shiftKey: true });
    expect(draft().boundaries[1]).toEqual({ min: 79, proficiency: 3 });
    key(btn, 'ArrowLeft');
    expect(main.innerHTML).toMatch(/aria-label="Proficient starts at 78%"/);
  });

  it('won’t nudge a marker past the next step', () => {
    edit();
    pick('step', '4-');
    type('99.9');
    key(button('step', '4-'), 'ArrowRight');
    expect(draft().percents['4-']).toBe(99.9);
    expect(main.innerHTML).toContain('Each step must count for more than the one below it.');
  });

  it('takes the typed value with Enter in the box and lets go with Escape', () => {
    edit();
    pick('step', '2+');
    var box = input();
    box.value = '60';
    expect(key(box, 'Enter')).toBe(true);
    expect(draft().percents['2+']).toBe(60);
    expect(key(box, 'Escape')).toBe(true);
    expect(editLine()).toBe('');
    expect(main.innerHTML).toMatch(/id="cm-pts-step-2p"[^>]*aria-pressed="false"/);
  });

  describe('a ghost stays where a marker was saved', () => {
    it('marks the saved place of a step that moved, and puts it back when clicked', () => {
      edit();
      pick('step', '3');
      type('80');
      // 3 was saved at 75: a dashed pill there, tied to the live one on the same row.
      expect(main.innerHTML).toMatch(
        /<div class="cm-pts-marker cm-pts-ghost lv-3" data-key="3" style="left:75%"><button type="button" class="cm-pts-pill" data-action="cmPtsGhost" data-kind="step" data-key="3" aria-label="Put 3 back at 75%"/,
      );
      expect(main.innerHTML).toContain('class="cm-pts-tether"');
      // 3+ and 3− follow their whole levels: small rings.
      expect(main.innerHTML).toMatch(/cm-pts-ghost lv-3 is-ring" data-key="3\+"/);
      act('cmPtsGhost', { kind: 'step', key: '3' });
      expect(markerLeft('3')).toBe(75);
      expect(main.innerHTML).not.toContain('cm-pts-ghost');
      expect(draft().percents).toEqual(DEFAULTS);
    });

    it('marks a band start that moved with a dashed line and tab, and puts it back', () => {
      edit();
      pick('edge', '3');
      type('70');
      expect(main.innerHTML).toMatch(
        /<div class="cm-pts-edge cm-pts-ghost" data-level="3" style="left:73%">.*aria-label="Put Proficient back at 73%"[^>]*>73%<\/button>/,
      );
      act('cmPtsGhost', { kind: 'edge', level: 3 });
      expect(draft().boundaries).toEqual(DEFAULT_GRADING_SCALE.boundaries);
      expect(main.innerHTML).not.toContain('cm-pts-ghost');
    });

    it('draws nothing at rest or in a draft that matches what is saved', () => {
      expect(main.innerHTML).not.toContain('cm-pts-ghost');
      edit();
      expect(main.innerHTML).not.toContain('cm-pts-ghost');
    });
  });

  describe('Save', () => {
    // Letter class: the course % is shown, so a Counts As change can move it.
    function letterClass() {
      COURSES[CID].gradingSystem = 'letter';
      _cache.assessments[CID].forEach(a => (a.scoreMode = 'proficiency'));
      clearProfCache();
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    }

    it('asks first, naming each step that moved, when a course % would change', () => {
      letterClass();
      edit();
      pick('step', '3');
      type('80');
      pick('edge', '4');
      type('88');
      save();
      expect(confirms.map(c => c.title)).toEqual(['Change the Course %?']);
      expect(confirms[0].okLabel).toBe('Save');
      expect(getGradingScale(CID).percents).toEqual(DEFAULTS);
      confirms[0].run();
      expect(getGradingScale(CID).percents[3]).toBe(80);
      expect(getGradingScale(CID).boundaries[0]).toEqual({ min: 88, proficiency: 4 });
    });

    it('adds the ended-term sentence only when a reporting term has ended', () => {
      letterClass();
      edit();
      pick('step', '3');
      type('80');
      save();
      expect(confirms[0].message).not.toContain('already ended');
      _cache.courseConfigs[CID].reportingTerms = [
        { ordinal: 1, label: 'Term 1', starts_on: '2020-09-01', ends_on: '2020-11-30' },
      ];
      save();
      expect(confirms[1].message).toContain(
        'This changes the course % for every term, including Term 1, which has already ended. Report cards printed before today won’t match.',
      );
    });

    it('saves at once, with no question, when no course % moves', () => {
      letterClass();
      edit();
      // Nobody has a score near the Extending start, so no course % moves.
      pick('edge', '4');
      type('88');
      save();
      expect(confirms).toHaveLength(0);
      expect(getGradingScale(CID).boundaries[0]).toEqual({ min: 88, proficiency: 4 });
    });

    it('saves at once in a Proficiency class, which shows no course %', () => {
      _cache.courseConfigs[CID].reportingTerms = [
        { ordinal: 1, label: 'Term 1', starts_on: '2020-09-01', ends_on: '2020-11-30' },
      ];
      edit();
      pick('step', '3+');
      type('86');
      save();
      expect(confirms).toHaveLength(0);
      expect(getGradingScale(CID).percents['3+']).toBe(86);
    });

    it('does nothing while the draft matches what is saved', () => {
      edit();
      save();
      expect(CmPtsEdit.draft(CID)).not.toBeNull();
      expect(confirms).toHaveLength(0);
    });
  });

  it('sets the BC Letter Bands in the draft and leaves Points to Proficiency alone', () => {
    edit();
    pick('step', '3+');
    act('cmPointsScaleBc');
    expect(draft().percents).toEqual(BC_LETTER_BAND_PERCENTS);
    expect(draft().boundaries).toEqual(DEFAULT_GRADING_SCALE.boundaries);
    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
    save();
    expect(getGradingScale(CID).percents).toEqual(BC_LETTER_BAND_PERCENTS);
  });

  it('starts a new grade 10–12 class on the BC Letter Bands', () => {
    expect(DashClassManager.defaultGradingScale('11').percents).toEqual(BC_LETTER_BAND_PERCENTS);
    expect(DashClassManager.defaultGradingScale('8')).toBe(null);
  });

  it('matches Counts As to the thresholds, Emerging at 50', () => {
    _cache.courseConfigs[CID].gradingScale = {
      boundaries: [
        { min: 96, proficiency: 4 },
        { min: 84, proficiency: 3 },
        { min: 62, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
      labels: null,
    };
    edit();
    act('cmPointsScaleMatch');
    expect(draft().percents).toEqual({ 4: 98, 3: 84, 2: 62, 1: 50 });
    expect(markerLeft('3')).toBe(84);
    save();
    expect(getGradingScale(CID).percents).toEqual({ 4: 98, 3: 84, 2: 62, 1: 50 });
  });

  it('resets to the defaults', () => {
    _cache.courseConfigs[CID].gradingScale = {
      boundaries: [
        { min: 90, proficiency: 4 },
        { min: 80, proficiency: 3 },
        { min: 60, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
      percents: BC_LETTER_BAND_PERCENTS,
      labels: null,
    };
    edit();
    act('cmPointsScaleReset');
    save();
    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
    expect(markerLeft('3+')).toBeCloseTo(83.33, 2);
  });

  it('shows the scale in a Proficiency class too', () => {
    expect(COURSES[CID].gradingSystem).toBe('proficiency');
    expect(main.innerHTML).toContain('id="cm-pts-ruler"');
  });

  it('offers a class backup from Class Actions', () => {
    expect(main.innerHTML).toContain('data-action="cmDownloadBackup"');
    expect(main.innerHTML).toContain('Download Class Backup');
  });

  it('draws an icon before each Class Actions item, archived or not', () => {
    const items = () => {
      const { document: doc } = parseHTML('<!DOCTYPE html><html><body>' + main.innerHTML + '</body></html>');
      return [...doc.querySelectorAll('.cm-class-actions-menu [role="menuitem"]')].map(b => [
        b.textContent,
        b.firstElementChild.tagName.toLowerCase(),
        b.firstElementChild.getAttribute('aria-hidden'),
      ]);
    };
    expect(items()).toEqual([
      ['Duplicate Class', 'svg', 'true'],
      ['Download Class Backup', 'svg', 'true'],
      ['Archive Class', 'svg', 'true'],
    ]);
    DashClassManager.handleAction('cmToggleArchive', { dataset: { cid: CID } });
    if (confirms.length) confirms[confirms.length - 1].run();
    expect(items()).toEqual([
      ['Duplicate Class', 'svg', 'true'],
      ['Download Class Backup', 'svg', 'true'],
      ['Unarchive Class', 'svg', 'true'],
      ['Delete Class', 'svg', 'true'],
    ]);
  });
});
