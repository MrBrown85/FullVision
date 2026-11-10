/**
 * Class Settings › Student Page: Return Grades (S1-F4,
 * docs/plans/student-page-build-plan.md; board "Teacher: Class Settings,
 * Student Page").
 *
 * - The tab is there only for a class whose student page is on (the build
 *   switch). A signed-in teacher never has it and never sends the setting.
 * - Each choice is saved through saveCourseConfig and read back.
 * - A class with no choice made is offered When I Return Them first, and
 *   opening the tab saves nothing.
 * - Leaving When I Return Them with grades waiting asks first; Return and
 *   Change returns every one and saves, Cancel changes nothing. With none
 *   waiting there is no question.
 * - With the switch off, Class Settings draws exactly what main draws.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass, settle } from './helpers/pin-save-paths.js';

const CID = 'c-sp';
const OTHER = 'c-other';
const SIX = ['details', 'students', 'questionnaires', 'grading', 'terms', 'competencies'];
const SEVEN = ['details', 'students', 'questionnaires', 'student-page', 'grading', 'terms', 'competencies'];
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

const STUDENTS = ['s1', 's2', 's3', 's4'].map((id, i) => ({
  id,
  firstName: ['Jordan', 'Avery', 'Noor', 'Lena'][i],
  lastName: 'Test',
}));
const ASSESSMENTS = ['essay', 'lab', 'talk'].map((id, i) => ({
  id,
  title: ['Essay', 'Lab', 'Talk'][i],
  date: '2026-10-1' + i,
  type: 'summative',
  tagIds: ['t1'],
}));

describe('Class Settings › Student Page: Return Grades', () => {
  var mounts;
  var confirms;
  var original;

  function seed(cid, config) {
    clearClass(cid);
    seedClass(cid, {
      students: STUDENTS,
      assessments: ASSESSMENTS.map(a => structuredClone(a)),
      courseConfigs: config || {},
    });
  }
  function open(tab, cid) {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid || CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager(tab || 'student-page');
  }
  const html = () => mounts.main.innerHTML;
  const tabIds = () => [...html().matchAll(/data-action="cmSetTab" data-tab="([^"]+)"/g)].map(m => m[1]);
  const activeTab = () => (html().match(/class="cm-tab active"[^>]*data-tab="([^"]+)"/) || [])[1] || null;
  // The Return Grades buttons as drawn: [{ value, label, checked }], in order.
  function choices() {
    var re =
      /<button type="button" class="seg-btn cm-seg-btn(?: active)?" id="sp-return-(\w+)" role="radio" aria-checked="(true|false)" data-action="spReturnGrades" data-value="(\w+)">([^<]+)<\/button>/g;
    return [...html().matchAll(re)].map(m => ({ value: m[3], label: m[4], checked: m[2] === 'true', id: m[1] }));
  }
  const checked = () =>
    choices()
      .filter(c => c.checked)
      .map(c => c.value);
  // A click on a choice, as the page's click handler hands it over.
  function choose(value, cid) {
    var card = { dataset: { cid: cid || CID } };
    var el = { tagName: 'BUTTON', dataset: { value: value }, closest: sel => (sel === '[data-cid]' ? card : null) };
    return DashClassManager.handleAction('spReturnGrades', el);
  }
  const level = (sid, aid, value) => Grader.setLevel(CID, sid, aid, 't1', value, 0);
  const stored = (key, cid) => localStorage.getItem('gb-' + key + '-' + (cid || CID));
  const drafts = () => {
    var n = 0;
    var rows = getGradeReturns(CID);
    Object.keys(rows).forEach(aid =>
      Object.keys(rows[aid]).forEach(sid => {
        if (rows[aid][sid].is_draft) n++;
      }),
    );
    return n;
  };

  beforeEach(() => {
    localStorage.clear();
    mounts = {
      main: { innerHTML: '' },
      'sidebar-mount': { innerHTML: '', style: {}, removeAttribute() {} },
      'page-toolbar-mount': { innerHTML: '' },
    };
    confirms = [];
    original = {
      getElementById: document.getElementById,
      setUrl: Router.setUrl,
      pathname: location.pathname,
      showConfirm: globalThis.showConfirm,
      useSupabase: _useSupabase,
      module: globalThis.CmStudentPage,
    };
    document.getElementById = id => mounts[id] || original.getElementById(id);
    Router.setUrl = () => {};
    location.pathname = '/dashboard';
    globalThis.showConfirm = (title, message, okLabel, okStyle, onConfirm) =>
      confirms.push({ title, message, okLabel, okStyle, onConfirm });
    _useSupabase = false;
    seed(CID, HELD);
    seed(OTHER, {});
  });

  afterEach(() => {
    DashClassManager.resetState();
    document.getElementById = original.getElementById;
    Router.setUrl = original.setUrl;
    location.pathname = original.pathname;
    globalThis.showConfirm = original.showConfirm;
    globalThis.CmStudentPage = original.module;
    _useSupabase = original.useSupabase;
    clearClass(CID);
    clearClass(OTHER);
    clearClass(U(1));
  });

  describe('which classes have the tab', () => {
    it('a class with its student page on has it, between Questionnaires and Grading', () => {
      expect(CmStudentPage.isShown(CID)).toBe(true);
      open();
      expect(tabIds()).toEqual(SEVEN);
      expect(activeTab()).toBe('student-page');
      expect(html()).toContain('<div class="cm-section sp-card" data-cid="' + CID + '">');
    });

    it('a class with it off does not: no button, no panel, no way in', () => {
      expect(CmStudentPage.isShown(OTHER)).toBe(false);
      expect(CmStudentPage.isShown(undefined)).toBe(false);
      expect(CmStudentPage.isShown('no-such-class')).toBe(false);
      expect(CmStudentPage.render(OTHER)).toBe('');
      open('student-page', OTHER);
      expect(tabIds()).toEqual(SIX);
      expect(activeTab()).toBe('details');
      expect(html()).not.toContain('data-tab="student-page"');
      expect(html()).not.toContain('sp-card');
      // A choice made earlier does not bring the tab back with the switch off.
      seed(OTHER, { return_grades: 'on_return' });
      expect(CmStudentPage.isShown(OTHER)).toBe(false);
      // Nor does anything but true.
      seed(OTHER, { student_page_enabled: 'yes', return_grades: 'on_return' });
      expect(CmStudentPage.isShown(OTHER)).toBe(false);
    });

    it('follows the class picked in the list, and the switch as it is turned on and off', () => {
      open();
      DashClassManager.handleAction('cmSelectClass', { tagName: 'BUTTON', dataset: { cid: OTHER } });
      expect(tabIds()).toEqual(SIX);
      expect(activeTab()).toBe('details');

      expect(setStudentPageSwitch(OTHER, true)).toBe(true);
      DashClassManager.renderClassManager();
      expect(tabIds()).toEqual(SEVEN);
      setStudentPageSwitch(OTHER, false);
      DashClassManager.renderClassManager();
      expect(tabIds()).toEqual(SIX);
    });

    it('a click meant for a class without the tab saves nothing', () => {
      open('details', OTHER);
      var before = stored('courseconfig', OTHER);
      expect(choose('on_return', OTHER)).toBe(false);
      // Even handed straight to the module.
      CmStudentPage.handleAction('spReturnGrades', {
        dataset: { value: 'on_return' },
        closest: () => ({ dataset: { cid: OTHER } }),
      });
      expect(stored('courseconfig', OTHER)).toBe(before);
      expect(getReturnSettings(OTHER).return_grades).toBeNull();
    });
  });

  describe('the row, as the board words it', () => {
    it('draws the title, the two choices in order and both lines', () => {
      open();
      expect(html()).toContain('<h2 class="cm-grade-title">Student Page</h2>');
      expect(html()).toContain('<div class="sp-row-title" id="sp-return-label">Return Grades</div>');
      expect(html()).toContain(
        '<div class="cm-hint" id="sp-return-hint">When a grade shows on a student&#39;s page. Until then it&#39;s a draft only you can see.</div>',
      );
      expect(html()).toContain(
        '<div class="seg cm-seg" role="radiogroup" aria-labelledby="sp-return-label" aria-describedby="sp-return-hint">',
      );
      expect(choices().map(c => [c.value, c.label])).toEqual([
        ['on_return', 'When I Return Them'],
        ['on_save', 'As Soon As I Save'],
      ]);
      expect(choices().every(c => c.id === c.value)).toBe(true);
      expect(html()).toContain(
        '<div class="cm-hint">A change to a returned grade follows the same rule, and the student sees it marked Updated.</div>',
      );
    });

    it('draws no other row of the board yet', () => {
      open();
      [
        'Send Work',
        'Keep Photos Until',
        'Reflect on Feedback',
        'Show My Learning',
        'Student Cards',
        'Preview as Student',
        'Questionnaires and Reports',
      ].forEach(label => expect(html(), label).not.toContain(label));
      expect((html().match(/class="sp-row"/g) || []).length).toBe(1);
    });
  });

  describe('each choice is saved and read back', () => {
    it('As Soon As I Save, then When I Return Them', () => {
      open();
      expect(checked()).toEqual(['on_return']);

      expect(choose('on_save')).toBe(true);
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_save' });
      expect(JSON.parse(stored('courseconfig'))).toEqual({ student_page_enabled: true, return_grades: 'on_save' });
      expect(checked()).toEqual(['on_save']);

      expect(choose('on_return')).toBe(true);
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
      expect(JSON.parse(stored('courseconfig')).return_grades).toBe('on_return');
      expect(checked()).toEqual(['on_return']);

      // As a reload reads it: from what is stored, not the cache.
      delete _cache.courseConfigs[CID];
      DashClassManager.renderClassManager();
      expect(checked()).toEqual(['on_return']);
    });

    it('keeps every other setting of the class', () => {
      seed(CID, Object.assign({ calcMethod: 'decayingAvg', roundPercent: false, levelOrder: 'desc' }, HELD));
      open();
      choose('on_save');
      expect(getCourseConfig(CID)).toEqual({
        calcMethod: 'decayingAvg',
        roundPercent: false,
        levelOrder: 'desc',
        student_page_enabled: true,
        return_grades: 'on_save',
      });
    });

    it('a save under each choice does what the choice says', () => {
      open();
      level('s1', 'essay', 3);
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('draft');
      Grader.returnGrades(CID, 'essay', ['s1']);
      choose('on_save');
      level('s2', 'essay', 3);
      expect(GradeState.stateOf(CID, 's2', 'essay')).toBe('returned');
      choose('on_return');
      level('s3', 'essay', 3);
      expect(GradeState.stateOf(CID, 's3', 'essay')).toBe('draft');
    });

    it('the choice already made, or one it does not know, saves nothing', () => {
      open();
      var saves = 0;
      var save = globalThis.saveCourseConfig;
      globalThis.saveCourseConfig = function () {
        saves++;
        return save.apply(this, arguments);
      };
      try {
        choose('on_return');
        choose('sometimes');
        choose(undefined);
        expect(saves).toBe(0);
        choose('on_save');
        expect(saves).toBe(1);
      } finally {
        globalThis.saveCourseConfig = save;
      }
      expect(getReturnSettings(CID).return_grades).toBe('on_save');
    });
  });

  describe('a class with no choice made', () => {
    beforeEach(() => seed(CID, { student_page_enabled: true, calcMethod: 'mostRecent' }));

    it('is offered When I Return Them first, with neither marked as chosen', () => {
      open();
      expect(choices().map(c => c.value)).toEqual(['on_return', 'on_save']);
      expect(checked()).toEqual([]);
      expect(html()).not.toContain('seg-btn cm-seg-btn active" id="sp-return-');
      expect(html()).toContain(
        '<div class="cm-hint" id="sp-return-unset">You haven&#39;t chosen yet. Until you do, a grade shows as soon as you save it.</div>',
      );
    });

    it('opening the tab saves nothing and changes nothing about the class', () => {
      var before = stored('courseconfig');
      var saves = 0;
      var save = globalThis.saveCourseConfig;
      globalThis.saveCourseConfig = function () {
        saves++;
        return save.apply(this, arguments);
      };
      try {
        open();
        DashClassManager.renderClassManager();
        open('grading');
        open();
      } finally {
        globalThis.saveCourseConfig = save;
      }
      expect(saves).toBe(0);
      expect(stored('courseconfig')).toBe(before);
      expect(getCourseConfig(CID)).toEqual({ student_page_enabled: true, calcMethod: 'mostRecent' });
      expect(getReturnSettings(CID).return_grades).toBeNull();
      // It still returns each grade as it is saved.
      level('s1', 'essay', 3);
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
      expect(GradeState.draftsWaiting(CID)).toBe(0);
    });

    it('choosing When I Return Them saves it, with no question, and the line goes', () => {
      open();
      choose('on_return');
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
      expect(checked()).toEqual(['on_return']);
      expect(html()).not.toContain('sp-return-unset');
      level('s1', 'essay', 3);
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('draft');
    });

    it('choosing As Soon As I Save saves it, with no question', () => {
      open();
      level('s1', 'essay', 3);
      choose('on_save');
      expect(confirms).toEqual([]);
      expect(JSON.parse(stored('courseconfig')).return_grades).toBe('on_save');
      expect(checked()).toEqual(['on_save']);
      expect(html()).not.toContain('sp-return-unset');
    });
  });

  describe('leaving When I Return Them', () => {
    function twelveDrafts() {
      ASSESSMENTS.forEach(a => STUDENTS.forEach(s => level(s.id, a.id, 3)));
    }

    it('with grades waiting asks first, in the ruling’s words, and changes nothing yet', () => {
      twelveDrafts();
      open();
      var before = { config: stored('courseconfig'), rows: stored('grade-returns'), scores: stored('scores') };
      expect(choose('on_save')).toBe(true);
      expect(confirms.length).toBe(1);
      expect(confirms[0]).toMatchObject({
        title: 'Return 12 Grades Now?',
        message: '12 grades are waiting as drafts. Changing this returns them to students now.',
        okLabel: 'Return and Change',
        okStyle: 'primary',
      });
      expect(stored('courseconfig')).toBe(before.config);
      expect(stored('grade-returns')).toBe(before.rows);
      expect(checked()).toEqual(['on_return']);
    });

    it('Cancel leaves the setting and every waiting grade as they were', () => {
      twelveDrafts();
      Grader.returnGrades(CID, 'essay', ['s1']);
      level('s1', 'essay', 4); // a change to a returned grade waits too
      open();
      var before = {
        config: stored('courseconfig'),
        rows: stored('grade-returns'),
        scores: stored('scores'),
        html: html(),
      };
      choose('on_save');
      // Cancel, Escape and a click outside all close the dialog without
      // calling back: nothing more happens.
      expect(confirms.length).toBe(1);
      expect(stored('courseconfig')).toBe(before.config);
      expect(stored('grade-returns')).toBe(before.rows);
      expect(stored('scores')).toBe(before.scores);
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
      expect(drafts()).toBe(12);
      expect(GradeState.draftsWaiting(CID)).toBe(12);
      expect(
        getReturnedScores(CID)
          .s1.filter(e => e.assessmentId === 'essay')
          .map(e => e.score),
      ).toEqual([3]);
      DashClassManager.renderClassManager();
      expect(html()).toBe(before.html);
    });

    it('Return and Change returns every one and saves the choice', () => {
      twelveDrafts();
      Grader.returnGrades(CID, 'essay', ['s1']);
      level('s1', 'essay', 4);
      open();
      choose('on_save');
      confirms[0].onConfirm();

      expect(getReturnSettings(CID).return_grades).toBe('on_save');
      expect(JSON.parse(stored('courseconfig'))).toEqual({ student_page_enabled: true, return_grades: 'on_save' });
      expect(checked()).toEqual(['on_save']);
      expect(drafts()).toBe(0);
      expect(GradeState.draftsWaiting(CID)).toBe(0);
      ASSESSMENTS.forEach(a =>
        STUDENTS.forEach(s => {
          var row = getGradeReturn(CID, s.id, a.id);
          expect(row.is_draft, s.id + ' ' + a.id).toBe(false);
          expect(row.returned_at, s.id + ' ' + a.id).toBeTruthy();
          expect(row.returned_copy, s.id + ' ' + a.id).toBeUndefined();
          expect(GradeState.stateOf(CID, s.id, a.id)).toBe('returned');
        }),
      );
      // The student is given the working grade, and the changed one is marked.
      expect(
        getReturnedScores(CID)
          .s1.filter(e => e.assessmentId === 'essay')
          .map(e => e.score),
      ).toEqual([4]);
      expect(getGradeReturn(CID, 's1', 'essay').updated_at).toBeTruthy();
      // As a reload reads it.
      expect(JSON.parse(stored('grade-returns')).talk.s4.is_draft).toBe(false);
    });

    it('names one grade in the singular', () => {
      level('s1', 'essay', 3);
      open();
      choose('on_save');
      expect(confirms[0]).toMatchObject({
        title: 'Return 1 Grade Now?',
        message: '1 grade is waiting as a draft. Changing this returns it to the student now.',
        okLabel: 'Return and Change',
      });
    });

    it('counts what waits when the question is asked, not when the tab was drawn', () => {
      open();
      level('s1', 'essay', 3);
      level('s2', 'essay', 3);
      Grader.returnGrades(CID, 'essay', ['s2']);
      choose('on_save');
      expect(confirms[0].message).toBe('1 grade is waiting as a draft. Changing this returns it to the student now.');
    });

    it('with none waiting asks nothing and saves', () => {
      open();
      choose('on_save');
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_save');

      // The same once every grade has been returned.
      choose('on_return');
      level('s1', 'essay', 3);
      level('s2', 'essay', 2);
      Grader.returnGrades(CID, 'essay', ['s1', 's2']);
      choose('on_save');
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_save');
      expect(checked()).toEqual(['on_save']);
    });

    it('going to When I Return Them never asks', () => {
      seed(CID, { student_page_enabled: true, return_grades: 'on_save' });
      level('s1', 'essay', 3);
      open();
      choose('on_return');
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
      // What was returned stays returned.
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
    });

    it('a grade under Missing shows no Draft mark and is not counted; the change still leaves no draft behind', () => {
      level('s1', 'essay', 3);
      saveAssignmentStatuses(CID, { 's1:essay': 'NS' });
      expect(getGradeReturn(CID, 's1', 'essay').is_draft).toBe(true);
      open();
      choose('on_save');
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_save');
      expect(drafts()).toBe(0);
      // Missing still wins: the student is given no grade for it.
      expect(getReturnedScores(CID).s1.filter(e => e.assessmentId === 'essay' && Number(e.score) > 0)).toEqual(
        getScores(CID).s1.filter(e => e.assessmentId === 'essay' && Number(e.score) > 0),
      );
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
    });

    it('answering the question after the tab is gone saves nothing', () => {
      level('s1', 'essay', 3);
      open();
      choose('on_save');
      setStudentPageSwitch(CID, false); // returns what waited, and hides the tab
      var before = stored('courseconfig');
      confirms[0].onConfirm();
      expect(stored('courseconfig')).toBe(before);
      expect(JSON.parse(before).return_grades).toBe('on_return');
    });
  });

  describe('a signed-in teacher', () => {
    var session;
    const REAL = U(1);

    beforeEach(() => {
      session = signIn();
      seed(REAL, Object.assign({ levelOrder: 'asc' }, HELD));
    });
    afterEach(() => session.signOut());
    // Everything sent but Class Settings' own reads (family contacts, categories).
    const writes = () => session.sent().filter(c => !/^(list|get)_/.test(c[0]));

    it('never has the tab, whatever the class holds', () => {
      expect(getReturnSettings(REAL).student_page).toBe(false);
      expect(CmStudentPage.isShown(REAL)).toBe(false);
      expect(CmStudentPage.render(REAL)).toBe('');
      open('student-page', REAL);
      expect(tabIds()).toEqual(SIX);
      expect(activeTab()).toBe('details');
      SIX.forEach(tab => {
        DashClassManager.handleAction('cmSetTab', { tagName: 'BUTTON', dataset: { tab: tab } });
        expect(html(), tab).not.toContain('data-tab="student-page"');
        expect(html(), tab).not.toContain('Return Grades');
        expect(html(), tab).not.toContain('sp-card');
      });
      // The console switch does nothing for them either.
      expect(setStudentPageSwitch(REAL, true)).toBe(false);
    });

    it('never sends the setting: a click that reaches the module saves and sends nothing', async () => {
      open('details', REAL);
      var before = stored('courseconfig', REAL);
      expect(choose('on_save', REAL)).toBe(false);
      CmStudentPage.handleAction('spReturnGrades', {
        dataset: { value: 'on_save' },
        closest: () => ({ dataset: { cid: REAL } }),
      });
      await settle();
      expect(confirms).toEqual([]);
      expect(stored('courseconfig', REAL)).toBe(before);
      expect(writes()).toEqual([]);
    });

    it('and a class setting saved beside it goes without the two keys', async () => {
      var cfg = Object.assign({}, getCourseConfig(REAL), { levelOrder: 'desc', return_grades: 'on_save' });
      saveCourseConfig(REAL, cfg);
      await settle();
      var sent = writes();
      expect(sent.map(c => c[0])).toEqual(['update_course']);
      expect(sent[0][1].p_patch).toEqual({ level_order: 'desc' });
      expect(JSON.stringify(sent)).not.toMatch(/return_grades|student_page/);
    });
  });

  describe('the tab names no server function', () => {
    it('teacher/cm-student-page.js writes only through saveCourseConfig', () => {
      const src = readFileSync(new URL('../teacher/cm-student-page.js', import.meta.url), 'utf-8');
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase/);
      expect(src).not.toMatch(/localStorage|_cache\b|_saveCourseField|setStudentPageSwitch/);
      expect((src.match(/saveCourseConfig\(/g) || []).length).toBe(1);
    });
  });
});

/* With the build switch off, Class Settings draws byte for byte what main
   draws. tests/fixtures/cm-student-page-on-main.js.txt is main's
   teacher/cm-student-page.js as PR 978 left it (the tab hidden for every
   class); nothing else of Class Settings is changed by S1-F4. Each class
   below is drawn on every tab, and from the tab's own address, once with
   main's module and once with this one. */
describe('Class Settings with the switch off is what main draws', () => {
  const ON_MAIN = readFileSync(new URL('./fixtures/cm-student-page-on-main.js.txt', import.meta.url), 'utf-8');
  const mainModule = () => new Function(ON_MAIN + '\nreturn CmStudentPage;')();
  var mounts;
  var original;

  function seed(cid, config) {
    clearClass(cid);
    seedClass(cid, {
      students: STUDENTS,
      assessments: ASSESSMENTS.map(a => structuredClone(a)),
      scores: { s1: [{ assessmentId: 'essay', tagId: 't1', score: 3, date: '2026-10-10', type: 'summative' }] },
      courseConfigs: config,
    });
  }
  // Everything Class Settings draws for a class: each tab, the tab's own
  // address, and a click on a choice that is not there.
  function drawn(cid) {
    var out = [];
    var all = () => JSON.stringify([mounts.main.innerHTML, mounts['sidebar-mount'].innerHTML, mounts.bar.innerHTML]);
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager('student-page');
    out.push(all());
    SIX.forEach(tab => {
      DashClassManager.handleAction('cmSetTab', { tagName: 'BUTTON', dataset: { tab: tab } });
      out.push(all());
    });
    DashClassManager.handleAction('cmSetTab', { tagName: 'BUTTON', dataset: { tab: 'student-page' } });
    DashClassManager.handleAction('spReturnGrades', {
      tagName: 'BUTTON',
      dataset: { value: 'on_save' },
      closest: () => ({ dataset: { cid: cid } }),
    });
    DashClassManager.renderClassManager();
    out.push(all());
    DashClassManager.resetState();
    return out;
  }

  beforeEach(() => {
    localStorage.clear();
    mounts = {
      main: { innerHTML: '' },
      'sidebar-mount': { innerHTML: '', style: {}, removeAttribute() {} },
      bar: { innerHTML: '' },
    };
    original = {
      getElementById: document.getElementById,
      setUrl: Router.setUrl,
      pathname: location.pathname,
      useSupabase: _useSupabase,
      module: globalThis.CmStudentPage,
    };
    document.getElementById = id =>
      id === 'page-toolbar-mount' ? mounts.bar : mounts[id] || original.getElementById(id);
    Router.setUrl = () => {};
    location.pathname = '/dashboard';
    _useSupabase = false;
  });
  afterEach(() => {
    DashClassManager.resetState();
    document.getElementById = original.getElementById;
    Router.setUrl = original.setUrl;
    location.pathname = original.pathname;
    globalThis.CmStudentPage = original.module;
    _useSupabase = original.useSupabase;
    clearClass(CID);
    clearClass(U(1));
  });

  it("the fixture is main's module: hidden for every class", () => {
    var onMain = mainModule();
    expect(onMain).not.toBe(original.module);
    expect(onMain.isShown(CID)).toBe(false);
    expect(onMain.render(CID)).toBe('');
  });

  it.each([
    ['no setting at all', {}],
    ['a Return Grades choice left from before, switch off', { return_grades: 'on_return' }],
    ['As Soon As I Save, switch off', { return_grades: 'on_save', levelOrder: 'desc' }],
    ['a switch that is not true', { student_page_enabled: 'true', return_grades: 'on_return' }],
  ])('a Demo Mode class with %s', (name, config) => {
    seed(CID, config);
    var before = localStorage.getItem('gb-courseconfig-' + CID);
    globalThis.CmStudentPage = mainModule();
    var onMain = drawn(CID);
    globalThis.CmStudentPage = original.module;
    var here = drawn(CID);
    expect(here.length).toBe(8);
    expect(here).toEqual(onMain);
    expect(here.join('')).not.toContain('student-page');
    expect(here.join('')).not.toContain('sp-return');
    // And looking saved nothing.
    expect(localStorage.getItem('gb-courseconfig-' + CID)).toBe(before);
  });

  it('a signed-in class, even one that holds the switch', async () => {
    var session = signIn();
    try {
      seed(U(1), HELD);
      globalThis.CmStudentPage = mainModule();
      var onMain = drawn(U(1));
      globalThis.CmStudentPage = original.module;
      var here = drawn(U(1));
      expect(here).toEqual(onMain);
      expect(here.join('')).not.toContain('student-page');
      await settle();
      // Class Settings reads; it writes nothing.
      expect(session.sent().filter(c => !/^(list|get)_/.test(c[0]))).toEqual([]);
    } finally {
      session.signOut();
    }
  });

  it('and the check can tell: a class with the switch on is not what main draws', () => {
    seed(CID, HELD);
    globalThis.CmStudentPage = mainModule();
    var onMain = drawn(CID);
    globalThis.CmStudentPage = original.module;
    var here = drawn(CID);
    expect(here).not.toEqual(onMain);
    expect(here[0]).toContain('Return Grades');
    expect(onMain.join('')).not.toContain('Return Grades');
  });
});
