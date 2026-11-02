/**
 * Re-link with the crosswalk from the old bank (curriculum_crosswalk.json;
 * curriculum bank stage 4, PR 6). An older class's competencies pair with
 * the rebuilt bank's replacements under "Replaced in the Curriculum", Keep
 * Mine by default: one for one updates in place, one for several adds the
 * several in their Ministry folder and moves the old one in with its scores.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CROSSWALK = JSON.parse(readFileSync(resolve(root, 'curriculum_crosswalk.json'), 'utf-8'));
const SOURCE = JSON.parse(readFileSync(resolve(root, 'data/bc-curriculum-source.json'), 'utf-8'));
const CID = 'e0000000-0000-4000-8000-0000000c2055';

describe('the crosswalk file', () => {
  var ids = {};
  Object.keys(SOURCE)
    .filter(k => k[0] !== '_')
    .forEach(k => SOURCE[k].categories.forEach(c => c.competencies.forEach(x => (ids[x.id] = true))));

  it('points only at competencies in the rebuilt bank', () => {
    var missing = [];
    Object.keys(CROSSWALK.pairs).forEach(k =>
      CROSSWALK.pairs[k].forEach(r => r.to.forEach(id => ids[id] || missing.push(k + ' ' + r.code + ' → ' + id))),
    );
    expect(missing).toEqual([]);
  });

  it('lists each old competency once', () => {
    var seen = {};
    var twice = [];
    Object.keys(CROSSWALK.pairs).forEach(k =>
      CROSSWALK.pairs[k].forEach(r => {
        var key = k + '|' + r.code + '|' + r.raw;
        if (seen[key]) twice.push(key);
        seen[key] = true;
      }),
    );
    expect(twice).toEqual([]);
  });

  it('gives every dropped course successors that are in the bank, and HUM8 is settled', () => {
    var dropped = Object.keys(CROSSWALK.courses).filter(k => CROSSWALK.courses[k].dropped);
    expect(dropped.sort()).toEqual(
      ['BCFP11', 'BIO12', 'CLE11', 'ELA10', 'HUM8', 'INDS11', 'PHE11', 'PHE12', 'PHYG11', 'WPM12'].sort(),
    );
    dropped.forEach(k => {
      expect(CROSSWALK.courses[k].successors.length).toBeGreaterThan(0);
      CROSSWALK.courses[k].successors.forEach(s => expect(SOURCE[s]).toBeTruthy());
    });
    expect(CROSSWALK.courses.HUM8).toMatchObject({ decided: true, successors: ['ELA8', 'SS8'] });
  });
});

describe('Re-link for an older class', () => {
  var main;
  var originalGetElementById;
  var originalScrollTo;

  // A class made from the old bank: each old competency as it was imported.
  function oldClass(course, rows) {
    var sections = rows.map((r, i) => ({
      id: 's' + i,
      subject: course,
      name: r.code,
      color: '#0891b2',
      tags: [
        {
          id: 's' + i,
          code: r.code,
          label: r.label || r.code,
          text: r.raw,
          source_text: r.raw,
          i_can_statements: ['I can do what the old bank said.'],
        },
      ],
    }));
    saveCourses({ [CID]: { id: CID, name: 'Old Class', gradingSystem: 'proficiency', curriculumTags: [course] } });
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    _cache.learningMaps[CID] = {
      _customized: true,
      subjects: [{ id: course, name: SOURCE[course].course_name, color: '#0891b2' }],
      competencyGroups: [],
      sections: sections,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [];
    _cache.scores[CID] = {};
    _cache.statuses[CID] = {};
    saveStudents(CID, []);
  }

  function relink(tags) {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
    DashClassManager.handleAction('cmRelinkNext', { dataset: {} });
  }

  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    window._CURRICULUM_CROSSWALK = CROSSWALK;
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = id => (id === 'main' ? main : originalGetElementById(id));
    originalScrollTo = window.scrollTo;
    window.scrollTo = function () {};
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    window.scrollTo = originalScrollTo;
    window._CURRICULUM_CROSSWALK = undefined;
    DashClassManager.resetState();
    CURRICULUM_INDEX = null;
  });

  it('pairs Science 10’s six old lines with the statements that replace them', () => {
    CURRICULUM_INDEX = newBankIndex(['SCI10']);
    oldClass('SCI10', CROSSWALK.pairs.SCI10);
    relink();
    var html = main.innerHTML;
    expect(html).toContain('Replaced in the Curriculum</h3><span>6</span>');
    expect(html).toContain('In the Curriculum, Not in Your Class</h3><span>9</span>');
    expect(html).not.toContain('Only in Your Class');
    expect(html).toContain('Add the Curriculum Version');
    expect(html).toContain(
      'Adds these 3 in a new folder, Questioning and Predicting. Your DSI moves into the same folder',
    );
    // Wording shows on the rows to add.
    expect(html).toContain('<span class="cm-cr-wording">Experience and interpret the local environment</span>');
  });

  it('changes nothing with Keep Mine everywhere and nothing ticked', () => {
    CURRICULUM_INDEX = newBankIndex(['SCI10']);
    oldClass('SCI10', CROSSWALK.pairs.SCI10);
    relink();
    for (var i = 0; i < 9; i++)
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmCompReviewToggle', idx: String(i) },
        checked: false,
      });
    expect(main.innerHTML).toContain('<strong>No changes.</strong>');
  });

  it('adds the curriculum version in its folder and moves the old line in, unchanged', () => {
    CURRICULUM_INDEX = newBankIndex(['SCI10']);
    oldClass('SCI10', CROSSWALK.pairs.SCI10);
    relink();
    for (var i = 0; i < 9; i++)
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmCompReviewToggle', idx: String(i) },
        checked: false,
      });
    DashClassManager.handleChange({
      dataset: { actionChange: 'cmCompReviewPick', group: 'replaced', idx: '0', pick: 'theirs' },
      checked: true,
    });
    DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
    var lm = getLearningMap(CID);
    var folder = lm.competencyGroups.find(g => g.name === 'Questioning and Predicting');
    expect(folder).toBeTruthy();
    var inFolder = lm.sections.filter(s => s.groupId === folder.id).map(s => s.tags[0].code);
    expect(inFolder.sort()).toEqual(['DSI', 'QP1', 'QP2', 'QP3']);
    var dsi = lm.sections.find(s => s.tags[0].code === 'DSI');
    expect(dsi.id).toBe('s0');
    expect(dsi.tags[0].text).toBe(CROSSWALK.pairs.SCI10[0].raw);
  });

  it('updates a one-for-one replacement in place, keeping the competency', () => {
    CURRICULUM_INDEX = newBankIndex(['ELA9']);
    var rows = CROSSWALK.pairs.ELA9;
    oldClass('ELA9', rows);
    var all = rows;
    relink();
    // The 19 whose wording the Ministry kept already match; the 3 rewordings are offered.
    var reworded = rows.filter(r => r.kind !== 'exact');
    expect(reworded).toHaveLength(3);
    expect(main.innerHTML).toContain('Replaced in the Curriculum</h3><span>3</span>');
    expect(main.innerHTML).toContain('Already Match the Curriculum <span>19</span>');
    expect(main.innerHTML).not.toContain('You Changed These');
    rows = reworded;
    var ai = all.findIndex(r => r.code === 'AI');
    var aiReplaced = rows.findIndex(r => r.code === 'AI');
    DashClassManager.handleChange({
      dataset: { actionChange: 'cmCompReviewPick', group: 'replaced', idx: String(aiReplaced), pick: 'theirs' },
      checked: true,
    });
    DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
    var sec = getLearningMap(CID).sections.find(s => s.id === 's' + ai);
    expect(sec.tags[0].code).toBe('CP1');
    expect(sec.tags[0].bank_id).toMatch(/^bc\.ela9\.cc\./);
    expect(sec.name).toBe(sec.tags[0].label);
  });

  it('a class linked to Humanities 8 starts Re-link on ELA 8 and SS 8 when the bank has dropped HUM8', () => {
    CURRICULUM_INDEX = newBankIndex(['ELA8', 'SS8']);
    oldClass('ELA8', []);
    COURSES[CID].curriculumTags = ['HUM8'];
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
    return new Promise(r => setTimeout(r, 20)).then(() => {
      expect(main.innerHTML).toContain('Humanities 8 is no longer a BC curriculum course.');
      expect(main.innerHTML).toContain('<strong>2</strong> courses selected');
    });
  });
});
