/**
 * Class Settings' competency list and card for a class built from the
 * rebuilt bank (curriculum bank stage 4, PR 5): competencies outside
 * folders sit in Ministry order among the folders, each row shows its
 * wording's first line, and the card's source line names the course and
 * the Ministry's headings. A competency with no I Can statements says what
 * reports print.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'e0000000-0000-4000-8000-0000000da710';
var main;
var originalGetElementById;
var originalScrollTo;

function setUpClass(keys) {
  CURRICULUM_INDEX = newBankIndex(keys);
  var map = buildLearningMapFromTags(keys);
  saveCourses({ [CID]: { id: CID, name: keys.join(' + '), gradingSystem: 'proficiency', curriculumTags: keys } });
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  _cache.learningMaps[CID] = map;
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [];
  _cache.scores[CID] = {};
  _cache.statuses[CID] = {};
  saveStudents(CID, []);
}

function openTab() {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
  DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'competencies' } });
}

function sectionByCode(code) {
  return getLearningMap(CID).sections.find(s => s.tags[0].code === code);
}

beforeEach(() => {
  localStorage.clear();
  _useSupabase = false;
  main = { innerHTML: '' };
  originalGetElementById = document.getElementById;
  document.getElementById = function (id) {
    return id === 'main' ? main : originalGetElementById(id);
  };
  originalScrollTo = window.scrollTo;
  window.scrollTo = function () {};
});

afterEach(() => {
  document.getElementById = originalGetElementById;
  window.scrollTo = originalScrollTo;
  DashClassManager.resetState();
  CURRICULUM_INDEX = null;
});

describe('the list', () => {
  it('puts Understanding Context before the first folder, with no Ungrouped section', () => {
    setUpClass(['DRAFT10']);
    openTab();
    var html = main.innerHTML;
    var uc1 = html.indexOf('Empathetic Research');
    var defining = html.indexOf('value="Defining"');
    expect(uc1).toBeGreaterThan(0);
    expect(uc1).toBeLessThan(defining);
    expect(html).not.toContain('>Ungrouped<');
    // The run outside folders is still a drop target for "no folder".
    expect(html).toMatch(/class="mod-folder no-module open cm-loose-run" data-folder-drop="__none__"/);
  });

  it('keeps the Ungrouped drop target when every competency is in a folder', () => {
    setUpClass(['DRAFT10']);
    var map = getLearningMap(CID);
    map.sections.find(s => !s.groupId).groupId = map.competencyGroups[0].id;
    openTab();
    expect(main.innerHTML).toContain('>Ungrouped<');
    expect(main.innerHTML).toContain('Every competency is in a folder');
  });

  it('lists SS competencies in order after the ELA folders in Humanities 8', () => {
    setUpClass(['ELA8', 'SS8']);
    openTab();
    var html = main.innerHTML;
    expect(html.indexOf('value="Create and Communicate"')).toBeLessThan(html.indexOf('Ethical Judgment'));
    expect(html).not.toContain('>Ungrouped<');
  });

  it('shows each competency’s wording under its name', () => {
    setUpClass(['DRAFT10']);
    openTab();
    expect(main.innerHTML).toContain(
      '<span class="cm-std-line">Prototype, making changes to tools, materials, and procedures as needed</span>',
    );
  });
});

describe('the card', () => {
  it('names the course and the Ministry headings in its source line', () => {
    setUpClass(['DRAFT10']);
    openTab();
    DashClassManager.handleAction('cmToggleStdCard', { dataset: { secid: sectionByCode('PR3').id } });
    expect(main.innerHTML).toContain(
      '<span class="cm-std-source">BC Curriculum · Drafting 10 · Applied Design › Prototyping</span>',
    );
  });

  it('says reports print nothing while a competency has no I Can statements', () => {
    setUpClass(['DRAFT10']);
    // Every bank course now has I Can statements, so clear them here.
    getLearningMap(CID).sections.forEach(sec =>
      sec.tags.forEach(tag => {
        tag.i_can_statements = [];
        tag.text = '';
      }),
    );
    openTab();
    expect(main.innerHTML).toContain(
      'No I Can statements yet. Reports print nothing for this competency until you add one.',
    );
    expect(main.innerHTML).not.toContain('Printed Reports · first statement');
  });

  it('keeps Shown In for a competency with I Can statements', () => {
    setUpClass(['SS8']);
    openTab();
    expect(main.innerHTML).toContain('Printed Reports · first statement');
    expect(main.innerHTML).toContain('<span class="cm-std-source">BC Curriculum · Social Studies 8</span>');
  });

  it('keeps the old source line for a competency with no bank id', () => {
    setUpClass(['DRAFT10']);
    var sec = sectionByCode('PR3');
    delete sec.tags[0].bank_id;
    sec.name = 'Applied Design';
    openTab();
    expect(main.innerHTML).toContain('<span class="cm-std-source">BC Curriculum · Applied Design</span>');
  });
});
