/**
 * curriculum: the tests that were tests/curriculum-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBank, buildComment, buildCore, buildProficiency } from '../scripts/build-curriculum-bank.mjs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

describe('curriculum-bank-build', () => {
  /**
   * curriculum_by_course.json is built from data/ by
   * scripts/build-curriculum-bank.mjs and never edited by hand: it must equal
   * a fresh build (curriculum bank stage 6). curriculum-labels.test.js checks
   * curriculum_data.js matches it.
   */

  describe('the app bank', () => {
    it('is a fresh build of data/bc-curriculum-*.json', () => {
      const { bank, missing } = buildBank();
      expect(JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'))).toEqual(bank);
      expect(missing).toEqual([]);
    });

    it('ships the comment phrases as a fresh build of data/bc-curriculum-comment.json', () => {
      const js = readFileSync('shared/bank-comment.js', 'utf-8');
      const shipped = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf(';')));
      expect(shipped).toEqual(buildComment());
      expect(Object.keys(shipped.ids)).toHaveLength(5029);
    });

    it('ships the Core Competencies as a fresh build of data/bc-core-competencies.json', () => {
      const js = readFileSync('shared/bank-core-competencies.js', 'utf-8');
      const shipped = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf(';')));
      expect(shipped).toEqual(buildCore());
      expect(Object.keys(shipped).sort()).toEqual(['COL', 'COM', 'CRT', 'CT', 'PAR', 'PPI', 'SAR']);
      // The first sentence, word for word.
      const core = JSON.parse(readFileSync('data/bc-core-competencies.json', 'utf-8'));
      expect(core.COL.description[0].startsWith(shipped.COL.description)).toBe(true);
      expect(shipped.COL.description.endsWith('.')).toBe(true);
    });

    it('ships the level descriptors as a fresh build of data/bc-curriculum-proficiency.json', () => {
      const js = readFileSync('shared/bank-proficiency.js', 'utf-8');
      const shipped = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf(';')));
      expect(shipped).toEqual(buildProficiency());
      expect(Object.keys(shipped.ids)).toHaveLength(5029);
      // Each set is Emerging, Developing, Proficient, Extending, in that order.
      const prof = JSON.parse(readFileSync('data/bc-curriculum-proficiency.json', 'utf-8'));
      const id = 'bc.ss10.cc.1';
      expect(shipped.levels[shipped.ids[id]]).toEqual([
        prof[id].levels.emerging,
        prof[id].levels.developing,
        prof[id].levels.proficient,
        prof[id].levels.extending,
      ]);
    });

    it('holds every Ministry course for grades 8–12 and no dropped one', () => {
      const bank = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
      expect(Object.keys(bank)).toHaveLength(226);
      ['HUM8', 'ELA10', 'BIO12', 'PHE11', 'PHE12', 'CLE11', 'BCFP11', 'INDS11', 'PHYG11', 'WPM12'].forEach(k =>
        expect(bank[k], k).toBeUndefined(),
      );
    });
  });
});

describe('curriculum-crosswalk', () => {
  /**
   * Re-link with the crosswalk from the old bank (curriculum_crosswalk.json;
   * curriculum bank stage 4, PR 6). An older class's competencies pair with
   * the rebuilt bank's replacements under "Replaced in the Curriculum", Keep
   * Mine by default: one for one updates in place, one for several adds the
   * several in their Ministry folder and moves the old one in with its scores.
   */

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
});

describe('curriculum-fresh-ids', () => {
  /**
   * Two classes made from the same BC course in one sitting each get their own
   * rows. The curriculum builder names rows after the course and its codes, the
   * same for every class, and the outbox resolves a local id against every
   * class's swaps, so the wizard and Re-link give new rows fresh ids before
   * saving (stage 5 review, finding F1).
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
    filename: 'shared/offline-queue.js',
  });

  const A = '11111111-1111-4111-8111-1111111111aa';
  const B = '11111111-1111-4111-8111-1111111111bb';

  describe('two classes from the same course', () => {
    var fake;
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      localStorage.clear();
      _cache.learningMaps = {};
      _learningMapSaveQueue = {};
      _learningMapIdRemap = {};
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
      saveCourses({ [A]: { id: A, name: 'Drafting 10 A' }, [B]: { id: B, name: 'Drafting 10 B' } });
      CURRICULUM_INDEX = newBankIndex(['DRAFT10']);
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      window.v2Queue.clear();
      CURRICULUM_INDEX = null;
    });

    it('saves the second class under its own course, folders and competencies', async () => {
      saveLearningMap(A, withFreshLearningMapIds(buildLearningMapFromTags(['DRAFT10'])));
      await settle(80);
      var before = fake.committed.length;
      saveLearningMap(B, withFreshLearningMapIds(buildLearningMapFromTags(['DRAFT10'])));
      await settle(80);
      var mine = fake.committed.slice(before);
      var subjects = mine.filter(c => c.name === 'upsert_subject' && !c.params.p_id);
      expect(subjects).toHaveLength(1);
      var subjectId = getLearningMap(B).subjects[0].id;
      var sections = mine.filter(c => c.name === 'upsert_section');
      expect(sections).toHaveLength(27);
      expect(sections.every(c => c.params.p_subject_id === subjectId)).toBe(true);
      // Every section in a folder points at one of B's folders.
      var folders = getLearningMap(B).competencyGroups.map(g => g.id);
      var inFolders = sections.filter(c => c.params.p_competency_group_id);
      expect(inFolders).toHaveLength(26);
      expect(inFolders.every(c => folders.indexOf(c.params.p_competency_group_id) >= 0)).toBe(true);
      // A is untouched: still 27 competencies.
      expect(getLearningMap(A).sections).toHaveLength(27);
    });
  });
});
