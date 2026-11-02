/**
 * The New Class wizard on the rebuilt bank (curriculum bank stage 4, PR 4):
 * Choose Courses shows competencies and folders, Humanities 8 is a preset
 * that ticks ELA 8 and SS 8, Choose Competencies shows every competency
 * with its wording (all ticked, Select All / Clear per folder), and Review
 * shows the courses in Ministry order with the grading switches.
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
  it('shows four steps and each course’s competencies and folders', async () => {
    await loaded();
    act('cwSelectGrade', { grade: '10' });
    act('cwSelectSubject', { subject: 'Applied Design, Skills and Technologies' });
    expect(main.innerHTML).toContain('Choose Competencies');
    expect(main.innerHTML).toContain('27 Competencies · 8 Folders');
    expect(main.innerHTML).not.toContain('Standards');
    expect(main.innerHTML).not.toContain('Categories');
    act('cwToggleCourse', { tag: 'DRAFT10' });
    expect(main.innerHTML).toContain('<strong>1</strong> course selected · <strong>27</strong> competencies');
  });

  it('offers Humanities 8, which ticks ELA 8 and SS 8 and stands in for them', async () => {
    await loaded();
    act('cwSelectGrade', { grade: '8' });
    act('cwSelectSubject', { subject: 'English Language Arts' });
    expect(main.innerHTML).toContain('Humanities 8');
    expect(main.innerHTML).toContain('ELA8 + SS8');
    act('cwTogglePreset', { tag: 'HUM8' });
    expect(main.innerHTML).not.toContain('data-tag="ELA8"');
    expect(main.innerHTML).toContain(
      '<strong>Humanities 8</strong>: English Language Arts 8 and Social Studies 8 · <strong>28</strong> competencies',
    );
    act('cwSelectSubject', { subject: 'Social Studies' });
    expect(main.innerHTML).toContain('Humanities 8');
    expect(main.innerHTML).not.toContain('data-tag="SS8"');
    act('cwTogglePreset', { tag: 'HUM8' });
    expect(main.innerHTML).toContain('data-tag="SS8"');
    // The old bank's HUM8 course gives way to the preset.
    CURRICULUM_INDEX.HUM8 = { course_name: 'Humanities 8', grade: 8, subject: 'Social Studies', categories: [] };
    CURRICULUM_INDEX.HUM8.categories.push({ name: 'Old', competencies: [{ id: 'cc_hum8_1', tag: 'X', raw: 'x' }] });
    act('cwSelectSubject', { subject: 'Social Studies' });
    expect(main.innerHTML).not.toContain('data-action="cwToggleCourse" data-tag="HUM8"');
    expect(main.innerHTML).toContain('data-action="cwTogglePreset" data-tag="HUM8"');
    expect(main.innerHTML).not.toContain('competencies</div>');
  });
});

describe('Choose Competencies', () => {
  beforeEach(async () => {
    await loaded();
    act('cwSelectGrade', { grade: '10' });
    act('cwSelectSubject', { subject: 'Applied Design, Skills and Technologies' });
    act('cwToggleCourse', { tag: 'DRAFT10' });
    act('cwGoToStep2');
  });

  it('lists every competency, ticked, with its code, name and full wording', () => {
    expect(main.innerHTML).toContain('The BC curriculum expects every competency to be taught.');
    expect(main.innerHTML).toContain('27 of 27 Competencies');
    expect(main.innerHTML).toContain('Prototype, making changes to tools, materials, and procedures as needed');
    expect(main.innerHTML).toContain('Prototype Building');
    expect((main.innerHTML.match(/class="cw-cc-check" checked/g) || []).length).toBe(27);
  });

  it('shows UC1 outside folders and each folder with its figure', () => {
    var uc1 = main.innerHTML.indexOf('Empathetic Research');
    var defining = main.innerHTML.indexOf('cw-cc-folder-name">Defining');
    expect(uc1).toBeGreaterThan(0);
    expect(uc1).toBeLessThan(defining);
    expect(main.innerHTML).toContain('cw-cc-folder-name">Prototyping</span><span class="cw-cc-folder-fig">4 of 4');
  });

  it('unticking updates the folder and course figures', () => {
    change('cwCompToggle', { key: bankId('DF3') }, false);
    expect(main.innerHTML).toContain('cw-cc-folder-name">Defining</span><span class="cw-cc-folder-fig">2 of 3');
    expect(main.innerHTML).toContain('26 of 27 Competencies');
    expect(main.innerHTML).toContain('<strong>26</strong> of <strong>27</strong> competencies selected');
  });

  it('Clear and Select All work on one folder', () => {
    var idx = CURRICULUM_INDEX.DRAFT10.categories.findIndex(c => c.name === 'Ideating');
    act('cwFolderNone', { tag: 'DRAFT10', idx: String(idx) });
    expect(main.innerHTML).toContain('cw-cc-folder-name">Ideating</span><span class="cw-cc-folder-fig">0 of 4');
    expect(main.innerHTML).toContain('23 of 27 Competencies');
    act('cwFolderAll', { tag: 'DRAFT10', idx: String(idx) });
    expect(main.innerHTML).toContain('27 of 27 Competencies');
  });

  it('builds the class from what is ticked', async () => {
    change('cwCompToggle', { key: bankId('DF3') }, false);
    act('cwCompsNext');
    expect(main.innerHTML).toContain('id="cm-new-name"');
    var originalGet = document.getElementById;
    document.getElementById = id => (id === 'cm-new-name' ? { value: 'Drafting 10' } : originalGet(id));
    act('cwGoToStep3');
    document.getElementById = originalGet;
    expect(main.innerHTML).toContain('DRAFT10 · 26 Competencies · 8 Folders');
    expect(main.innerHTML.indexOf('Not in a Folder')).toBeLessThan(main.innerHTML.indexOf('>Defining<'));
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
  });
});

describe('Review for Humanities 8', () => {
  beforeEach(async () => {
    await loaded();
    act('cwSelectGrade', { grade: '8' });
    act('cwSelectSubject', { subject: 'English Language Arts' });
    act('cwTogglePreset', { tag: 'HUM8' });
    act('cwGoToStep2');
    act('cwCompsNext');
  });

  it('names the class Humanities 8', () => {
    expect(main.innerHTML).toMatch(/id="cm-new-name"[^>]*value="Humanities 8"/);
  });

  it('starts with each course counted equally and folders off, and the teacher can flip them', async () => {
    var originalGet = document.getElementById;
    document.getElementById = id => (id === 'cm-new-name' ? { value: 'Humanities 8' } : originalGet(id));
    act('cwGoToStep3');
    document.getElementById = originalGet;
    expect(main.innerHTML).toContain('SS8 · 8 Competencies');
    expect(main.innerHTML).toContain('Not in a Folder');
    expect(main.innerHTML).toMatch(/id="cw-courses-equal"[^>]*checked/);
    expect(main.innerHTML).toContain(
      'English Language Arts 8 and Social Studies 8 each make up half of the overall. You can change this later in Grading.',
    );
    expect(main.innerHTML).not.toMatch(/id="cw-folders-count"[^>]*checked/);
    change('cwRollup', { key: 'folders' }, true);
    expect(main.innerHTML).toMatch(/id="cw-folders-count"[^>]*checked/);
    await act('cwFinishCreate');
    await new Promise(r => setTimeout(r, 50));
    var cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Humanities 8');
    expect(getCoursesCountEqually(cid)).toBe(true);
    expect(getFoldersCountAsOne(cid)).toBe(true);
    expect(getLearningMap(cid).sections).toHaveLength(28);
  });
});
