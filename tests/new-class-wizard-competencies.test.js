/**
 * The New Class wizard in two steps (Colin, 2026-11-25): Choose Courses
 * lists every course of the grade with its competencies, Humanities 8 is a
 * preset that ticks ELA 8 and SS 8, and Your Class shows what is ticked;
 * Name Your Class keeps the competencies (every one with its wording, all
 * ticked, Select All / Clear per folder) and the grading switches under
 * Already Set for You, each behind Change.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

var main;
var originalGetElementById;
var originalAlert;
var originalScrollTo;

function act(action, dataset) {
  return DashClassManager.handleAction(action, { dataset: dataset || {}, tagName: 'BUTTON' });
}
function change(action, dataset, checked) {
  return DashClassManager.handleChange({ dataset: Object.assign({ actionChange: action }, dataset), checked });
}
function bankId(code) {
  var hit = null;
  CURRICULUM_INDEX.DRAFT10.categories.forEach(c =>
    c.competencies.forEach(x => {
      if (x.tag === code) hit = x.id;
    }),
  );
  return hit;
}

beforeEach(() => {
  localStorage.clear();
  _useSupabase = false;
  saveCourses({});
  CURRICULUM_INDEX = newBankIndex(['DRAFT10', 'CUL10', 'ELA8', 'SS8']);
  window._CURRICULUM_DATA = CURRICULUM_INDEX;
  main = { innerHTML: '' };
  originalGetElementById = document.getElementById;
  document.getElementById = function (id) {
    return id === 'main' ? main : originalGetElementById(id);
  };
  originalAlert = globalThis.alert;
  globalThis.alert = function () {};
  originalScrollTo = window.scrollTo;
  window.scrollTo = function () {};
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
  act('cmStartCreate');
});

afterEach(() => {
  document.getElementById = originalGetElementById;
  globalThis.alert = originalAlert;
  window.scrollTo = originalScrollTo;
  DashClassManager.resetState();
  CURRICULUM_INDEX = null;
  window._CURRICULUM_DATA = undefined;
});

async function loaded() {
  await new Promise(r => setTimeout(r, 0));
}

describe('Choose Courses', () => {
  it('shows two steps and every course of the grade, with its competencies', async () => {
    await loaded();
    expect(main.innerHTML).toContain('Name Your Class');
    expect(main.innerHTML).not.toContain('Choose Competencies');
    expect(main.innerHTML).toContain('Pick a grade to see its courses.');
    act('cwSelectGrade', { grade: '10' });
    // Drafting 10 and Culinary Arts 10, in one list with no subject to pick first.
    expect(main.innerHTML).toContain('data-tag="DRAFT10"');
    expect(main.innerHTML).toContain('data-tag="CUL10"');
    expect(main.innerHTML).not.toContain('cwSelectSubject');
    expect(main.innerHTML).toContain('27 Competencies');
    expect(main.innerHTML).toContain('Tick a course and it shows here.');
    act('cwToggleCourse', { tag: 'DRAFT10' });
    expect(main.innerHTML).toMatch(/cw-rail-cname">Drafting 10<\/span><span class="cw-rail-count">27 Competencies/);
    expect(main.innerHTML).toContain('aria-label="Take Out Drafting 10"');
  });

  it('offers Humanities 8, which ticks ELA 8 and SS 8 together', async () => {
    await loaded();
    act('cwSelectGrade', { grade: '8' });
    expect(main.innerHTML).toContain('English Language Arts 8 and Social Studies 8, taught together');
    act('cwTogglePreset', { tag: 'HUM8' });
    expect(main.innerHTML).toMatch(/aria-checked="true" data-action="cwTogglePreset" data-tag="HUM8"/);
    expect(main.innerHTML).toMatch(/aria-checked="true" data-action="cwToggleCourse" data-tag="ELA8"/);
    expect(main.innerHTML).toMatch(/aria-checked="true" data-action="cwToggleCourse" data-tag="SS8"/);
    expect(main.innerHTML).toContain('id="cw-rail-name">Humanities 8<');
    expect(main.innerHTML).toContain('English Language Arts 8 and Social Studies 8 each make up half of the overall.');
    // Taking one course out takes the preset off.
    act('cwToggleCourse', { tag: 'SS8' });
    expect(main.innerHTML).toMatch(/aria-checked="false" data-action="cwTogglePreset" data-tag="HUM8"/);
    expect(main.innerHTML).toContain('id="cw-rail-name">English Language Arts 8<');
    // The old bank's HUM8 course gives way to the preset.
    CURRICULUM_INDEX.HUM8 = { course_name: 'Humanities 8', grade: 8, subject: 'Social Studies', categories: [] };
    CURRICULUM_INDEX.HUM8.categories.push({ name: 'Old', competencies: [{ id: 'cc_hum8_1', tag: 'X', raw: 'x' }] });
    act('cwSelectGrade', { grade: '8' });
    expect(main.innerHTML).not.toContain('data-action="cwToggleCourse" data-tag="HUM8"');
    expect(main.innerHTML).toContain('data-action="cwTogglePreset" data-tag="HUM8"');
  });
});

describe('Name Your Class: Competencies', () => {
  beforeEach(async () => {
    await loaded();
    act('cwSelectGrade', { grade: '10' });
    act('cwToggleCourse', { tag: 'DRAFT10' });
    act('cwGoToStep2');
  });

  it('names the class from the course and keeps the competencies under Already Set for You', () => {
    expect(main.innerHTML).toMatch(/id="cm-new-name"[^>]*value="Drafting 10"/);
    expect(main.innerHTML).toContain('Already Set for You');
    expect(main.innerHTML).toContain('All 27 from the BC curriculum');
    expect(main.innerHTML).not.toContain('cw-cc-check');
    expect(main.innerHTML).not.toContain('cm-new-desc');
    expect(main.innerHTML).not.toContain('cm-new-late-policy');
  });

  it('lists every competency, ticked, with its code, name and full wording behind Change', () => {
    act('cwOpenRow', { row: 'comps' });
    expect(main.innerHTML).toContain('aria-label="Done With Competencies"');
    expect(main.innerHTML).toContain('The BC curriculum expects every competency to be taught.');
    expect(main.innerHTML).toContain('27 of 27 Competencies');
    expect(main.innerHTML).toContain('Prototype, making changes to tools, materials, and procedures as needed');
    expect(main.innerHTML).toContain('Prototype Building');
    expect((main.innerHTML.match(/class="cw-cc-check" checked/g) || []).length).toBe(27);
    var uc1 = main.innerHTML.indexOf('Empathetic Research');
    expect(uc1).toBeGreaterThan(0);
    expect(uc1).toBeLessThan(main.innerHTML.indexOf('cw-cc-folder-name">Defining'));
    expect(main.innerHTML).toContain('cw-cc-folder-name">Prototyping</span><span class="cw-cc-folder-fig">4 of 4');
  });

  it('unticking updates the folder, the course, the row and Your Class', () => {
    act('cwOpenRow', { row: 'comps' });
    change('cwCompToggle', { key: bankId('DF3') }, false);
    expect(main.innerHTML).toContain('cw-cc-folder-name">Defining</span><span class="cw-cc-folder-fig">2 of 3');
    expect(main.innerHTML).toContain('26 of 27 Competencies');
    expect(main.innerHTML).toContain('26 of 27 from the BC curriculum');
    expect(main.innerHTML).toContain('cw-rail-count">26 of 27 Competencies');
  });

  it('Clear and Select All work on one folder', () => {
    act('cwOpenRow', { row: 'comps' });
    var idx = CURRICULUM_INDEX.DRAFT10.categories.findIndex(c => c.name === 'Ideating');
    act('cwFolderNone', { tag: 'DRAFT10', idx: String(idx) });
    expect(main.innerHTML).toContain('cw-cc-folder-name">Ideating</span><span class="cw-cc-folder-fig">0 of 4');
    expect(main.innerHTML).toContain('23 of 27 Competencies');
    act('cwFolderAll', { tag: 'DRAFT10', idx: String(idx) });
    expect(main.innerHTML).toContain('27 of 27 Competencies');
  });

  it('builds the class from what is ticked', async () => {
    act('cwOpenRow', { row: 'comps' });
    change('cwCompToggle', { key: bankId('DF3') }, false);
    act('cwOpenRow', { row: 'grading' });
    expect(main.innerHTML).toContain('Folders Count as One');
    expect(main.innerHTML).not.toContain('Each Course Counts Equally');
    expect(main.innerHTML).toContain('You can change this later in Grading.');
    await act('cwFinishCreate');
    await new Promise(r => setTimeout(r, 50));
    var cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Drafting 10');
    var lm = getLearningMap(cid);
    expect(lm.sections).toHaveLength(26);
    expect(lm.sections.some(s => s.tags[0].code === 'DF3')).toBe(false);
    expect(lm.competencyGroups).toHaveLength(8);
    expect(getFoldersCountAsOne(cid)).toBe(true);
    expect(getCoursesCountEqually(cid)).toBe(false);
    expect(COURSES[cid].gradeLevel).toBe('10');
    expect(COURSES[cid].description || '').toBe('');
  });
});

describe('Name Your Class for Humanities 8', () => {
  beforeEach(async () => {
    await loaded();
    act('cwSelectGrade', { grade: '8' });
    act('cwTogglePreset', { tag: 'HUM8' });
    act('cwGoToStep2');
  });

  it('names the class Humanities 8', () => {
    expect(main.innerHTML).toMatch(/id="cm-new-name"[^>]*value="Humanities 8"/);
    expect(main.innerHTML).toContain('Each Course Counts Equally · Every Competency Counts the Same');
  });

  it('starts with each course counted equally and folders off, and the teacher can flip them', async () => {
    act('cwOpenRow', { row: 'grading' });
    expect(main.innerHTML).toMatch(/id="cw-courses-equal"[^>]*checked/);
    expect(main.innerHTML).toContain(
      'English Language Arts 8 and Social Studies 8 each make up half of the overall. You can change this later in Grading.',
    );
    expect(main.innerHTML).not.toMatch(/id="cw-folders-count"[^>]*checked/);
    change('cwRollup', { key: 'folders' }, true);
    expect(main.innerHTML).toMatch(/id="cw-folders-count"[^>]*checked/);
    expect(main.innerHTML).toContain('Each Course Counts Equally · Folders Count as One');
    await act('cwFinishCreate');
    await new Promise(r => setTimeout(r, 50));
    var cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Humanities 8');
    expect(getCoursesCountEqually(cid)).toBe(true);
    expect(getFoldersCountAsOne(cid)).toBe(true);
    expect(getLearningMap(cid).sections).toHaveLength(28);
  });
});
