/**
 * Stage 5 review fixes for the New Class wizard and the importer (group 3 of
 * 3): an empty class name goes back to Class Details, a typed name survives
 * Back, old-bank competencies that share an id tick separately, and two
 * courses with the same name get folder names that differ.
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
function withName(value, fn) {
  var original = document.getElementById;
  document.getElementById = id => (id === 'cm-new-name' ? { value: value } : original(id));
  try {
    return fn();
  } finally {
    document.getElementById = original;
  }
}

beforeEach(() => {
  localStorage.clear();
  _useSupabase = false;
  saveCourses({});
  main = { innerHTML: '' };
  originalGetElementById = document.getElementById;
  document.getElementById = id => (id === 'main' ? main : originalGetElementById(id));
  originalAlert = globalThis.alert;
  globalThis.alert = function () {};
  originalScrollTo = window.scrollTo;
  window.scrollTo = function () {};
});

afterEach(() => {
  document.getElementById = originalGetElementById;
  globalThis.alert = originalAlert;
  window.scrollTo = originalScrollTo;
  DashClassManager.resetState();
  CURRICULUM_INDEX = null;
  window._CURRICULUM_DATA = undefined;
});

function startWizard(index) {
  CURRICULUM_INDEX = index;
  window._CURRICULUM_DATA = index;
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
  act('cmStartCreate');
  return new Promise(r => setTimeout(r, 0));
}

describe('the wizard', () => {
  it('sends a custom class with no name back to Class Details', async () => {
    await startWizard(newBankIndex(['DRAFT10']));
    act('cwSkipToCustom');
    withName('', () => act('cwGoToStep3'));
    var original = document.getElementById;
    var field = { value: '', style: {}, focus() {} };
    document.getElementById = id => (id === 'cm-new-name' ? field : original(id));
    try {
      await act('cwFinishCreate');
    } finally {
      document.getElementById = original;
    }
    expect(main.innerHTML).toContain('id="cm-new-name"');
    expect(main.innerHTML).not.toContain('The BC curriculum expects every competency to be taught.');
  });

  it('keeps a typed class name after Back from Review', async () => {
    await startWizard(newBankIndex(['DRAFT10']));
    act('cwSelectGrade', { grade: '10' });
    act('cwSelectSubject', { subject: 'Applied Design, Skills and Technologies' });
    act('cwToggleCourse', { tag: 'DRAFT10' });
    act('cwGoToStep2');
    act('cwCompsNext');
    withName('Drafting 10 Block B', () => act('cwGoToStep3'));
    act('cwGoBack');
    expect(main.innerHTML).toMatch(/id="cm-new-name"[^>]*value="Drafting 10 Block B"/);
  });

  it('ticks old-bank competencies that share an id separately', async () => {
    var old = {
      CS11: {
        course_name: 'Computer Science 11',
        grade: 11,
        subject: 'Mathematics',
        categories: [
          {
            name: 'Communicate',
            competencies: [{ id: 'cc_CS11_CR_1', tag: 'CD', short_label: 'Code Documentation', raw: 'Document code' }],
          },
          {
            name: 'Connect',
            competencies: [
              { id: 'cc_CS11_CR_1', tag: 'IC', short_label: 'Impact of Computing', raw: 'Consider impact' },
            ],
          },
        ],
      },
    };
    await startWizard(old);
    act('cwSelectGrade', { grade: '11' });
    act('cwSelectSubject', { subject: 'Mathematics' });
    act('cwToggleCourse', { tag: 'CS11' });
    act('cwGoToStep2');
    var keys = (main.innerHTML.match(/data-key="([^"]+)"/g) || []).map(s => s.slice(10, -1));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    DashClassManager.handleChange({ dataset: { actionChange: 'cwCompToggle', key: keys[0] }, checked: false });
    expect((main.innerHTML.match(/class="cw-cc-check" checked/g) || []).length).toBe(1);
    var map = buildLearningMapFromTags(['CS11'], { skip: [keys[0]] });
    expect(map.sections.map(s => s.tags[0].code)).toEqual(['IC']);
  });
});

describe('the importer', () => {
  it('gives two courses with the same name folder names that differ', () => {
    CURRICULUM_INDEX = newBankIndex(['EFPLS10', 'LS10']);
    var names = buildLearningMapFromTags(['EFPLS10', 'LS10']).competencyGroups.map(g => g.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Literary Studies 10 (EFPLS10): Comprehend and Connect');
    expect(names).toContain('Literary Studies 10 (LS10): Comprehend and Connect');
  });
});
