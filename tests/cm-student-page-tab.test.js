/**
 * Class Settings: the Student Page tab (teacher/cm-student-page.js) is in
 * CM_TABS but hidden (docs/plans/student-page-build-plan.md, S1-T4). A
 * hidden tab has no button, no address, no place in the arrow-key order and
 * no panel, and a remembered tab that is hidden opens Details. The tab's own
 * module says whether a class shows it; today no class does.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'sci8';
const OTHER = 'hum8';
const SIX = ['details', 'students', 'questionnaires', 'grading', 'terms', 'competencies'];

describe('Class Settings: the hidden Student Page tab', () => {
  var main;
  var urls;
  var original;

  function tabIds() {
    return [...main.innerHTML.matchAll(/data-action="cmSetTab" data-tab="([^"]+)"/g)].map(m => m[1]);
  }
  function activeTab() {
    var m = main.innerHTML.match(/class="cm-tab active"[^>]*data-tab="([^"]+)"/);
    return m ? m[1] : null;
  }
  function panelClass() {
    var m = main.innerHTML.match(/class="cm-tab-panel (cm-tab-panel-[a-z-]+)"/);
    return m ? m[1] : null;
  }
  function click(tab) {
    return DashClassManager.handleAction('cmSetTab', { tagName: 'BUTTON', dataset: { tab: tab } });
  }
  function arrow(from, key) {
    var el = { tagName: 'BUTTON', dataset: { tab: from }, classList: { contains: c => c === 'cm-tab' } };
    return DashClassManager.handleKeydown({ key: key, target: el, preventDefault() {} });
  }
  // What S1-F4 will do for a class with the build switch on.
  function showFor(cid) {
    CmStudentPage.isShown = id => id === cid;
  }

  beforeEach(() => {
    localStorage.clear();
    saveCourses({
      [CID]: { id: CID, name: 'Science 8' },
      [OTHER]: { id: OTHER, name: 'Humanities 8' },
    });
    main = { innerHTML: '' };
    urls = [];
    original = {
      getElementById: document.getElementById,
      setUrl: Router.setUrl,
      pathname: location.pathname,
      isShown: CmStudentPage.isShown,
      render: CmStudentPage.render,
      handleAction: CmStudentPage.handleAction,
      handleChange: CmStudentPage.handleChange,
      handleBlur: CmStudentPage.handleBlur,
    };
    document.getElementById = function (id) {
      return id === 'main' ? main : original.getElementById(id);
    };
    Router.setUrl = url => urls.push(url);
    location.pathname = '/dashboard';
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  });

  afterEach(() => {
    document.getElementById = original.getElementById;
    Router.setUrl = original.setUrl;
    location.pathname = original.pathname;
    CmStudentPage.isShown = original.isShown;
    CmStudentPage.render = original.render;
    CmStudentPage.handleAction = original.handleAction;
    CmStudentPage.handleChange = original.handleChange;
    CmStudentPage.handleBlur = original.handleBlur;
    DashClassManager.resetState();
  });

  describe('as shipped', () => {
    it('the module shows the tab for no class and renders an empty panel', () => {
      expect(CmStudentPage.isShown(CID)).toBe(false);
      expect(CmStudentPage.isShown(undefined)).toBe(false);
      expect(CmStudentPage.render(CID)).toBe('');
      expect(CmStudentPage.handleAction('spAnything', { dataset: {} })).toBe(false);
      expect(CmStudentPage.handleChange({ dataset: {} })).toBe(false);
      expect(CmStudentPage.handleBlur({ dataset: {} })).toBe(false);
    });

    it('draws the six tabs and no Student Page button on any of them', () => {
      DashClassManager.openClassManager();
      SIX.forEach(function (tab) {
        click(tab);
        expect(activeTab()).toBe(tab);
        expect(tabIds()).toEqual(SIX);
        expect(main.innerHTML).not.toContain('student-page');
        expect(main.innerHTML).not.toContain('Student Page');
      });
    });

    it('does not open from its address: it lands where an unknown tab does', () => {
      DashClassManager.openClassManager('student-page');
      var hidden = main.innerHTML;
      expect(activeTab()).toBe('details');
      expect(urls[urls.length - 1]).toBe('/dashboard?manage=details');

      DashClassManager.resetState();
      DashClassManager.openClassManager('no-such-tab');
      expect(main.innerHTML).toBe(hidden);
    });

    it('does not open from its address over a remembered tab', () => {
      DashClassManager.openClassManager('grading');
      DashClassManager.openClassManager('student-page');
      expect(activeTab()).toBe('grading');
      expect(urls[urls.length - 1]).toBe('/dashboard?manage=grading');
    });

    it('does not open by click', () => {
      DashClassManager.openClassManager('terms');
      var before = main.innerHTML;
      click('student-page');
      expect(main.innerHTML).toBe(before);
      expect(activeTab()).toBe('terms');
    });

    it('is skipped by the arrow keys', () => {
      DashClassManager.openClassManager('questionnaires');
      expect(arrow('questionnaires', 'ArrowRight')).toBe(true);
      expect(activeTab()).toBe('grading');
      expect(arrow('grading', 'ArrowLeft')).toBe(true);
      expect(activeTab()).toBe('questionnaires');
      // All the way round: six stops, never a seventh.
      var seen = [];
      for (var i = 0; i < 6; i++) {
        arrow(activeTab(), 'ArrowRight');
        seen.push(activeTab());
      }
      expect(seen).toEqual(['grading', 'terms', 'competencies', 'details', 'students', 'questionnaires']);
    });

    it('never asks the module for a panel or hands it a click, change or blur', () => {
      var calls = [];
      CmStudentPage.render = () => (calls.push('render'), '<p>never</p>');
      CmStudentPage.handleAction = () => (calls.push('action'), true);
      CmStudentPage.handleChange = () => (calls.push('change'), true);
      CmStudentPage.handleBlur = () => (calls.push('blur'), true);
      DashClassManager.openClassManager('student-page');
      SIX.forEach(click);
      expect(DashClassManager.handleAction('spReturnGrades', { tagName: 'BUTTON', dataset: {} })).toBe(false);
      DashClassManager.handleChange({ tagName: 'INPUT', dataset: { actionChange: 'spAnything' } });
      DashClassManager.handleBlur({ tagName: 'INPUT', dataset: { actionBlur: 'spAnything' } });
      expect(calls).toEqual([]);
      expect(main.innerHTML).not.toContain('never');
    });
  });

  describe('once its module shows it for a class', () => {
    it('sits between Questionnaires and Grading, with its own panel and address', () => {
      showFor(CID);
      CmStudentPage.render = cid => '<div class="sp-probe" data-cid="' + cid + '"></div>';
      DashClassManager.openClassManager('student-page');
      expect(tabIds()).toEqual([
        'details',
        'students',
        'questionnaires',
        'student-page',
        'grading',
        'terms',
        'competencies',
      ]);
      expect(activeTab()).toBe('student-page');
      expect(panelClass()).toBe('cm-tab-panel-student-page');
      expect(main.innerHTML).toContain('<div class="sp-probe" data-cid="' + CID + '"></div>');
      expect(urls[urls.length - 1]).toBe('/dashboard?manage=student-page');
      expect(arrow('questionnaires', 'ArrowRight')).toBe(true);
      expect(activeTab()).toBe('student-page');
    });

    it('hands the module every sp click, change and blur', () => {
      showFor(CID);
      var calls = [];
      CmStudentPage.handleAction = action => (calls.push(action), true);
      CmStudentPage.handleChange = el => (calls.push(el.dataset.actionChange), true);
      CmStudentPage.handleBlur = el => (calls.push(el.dataset.actionBlur), true);
      DashClassManager.openClassManager('student-page');
      expect(DashClassManager.handleAction('spReturnGrades', { tagName: 'BUTTON', dataset: {} })).toBe(true);
      expect(DashClassManager.handleChange({ tagName: 'INPUT', dataset: { actionChange: 'spKeep' } })).toBe(true);
      expect(DashClassManager.handleBlur({ tagName: 'INPUT', dataset: { actionBlur: 'spName' } })).toBe(true);
      expect(calls).toEqual(['spReturnGrades', 'spKeep', 'spName']);
    });

    it('a remembered Student Page tab opens Details in a class that hides it', () => {
      showFor(CID);
      DashClassManager.openClassManager('student-page');
      expect(activeTab()).toBe('student-page');

      // The class list picks the other class, which does not show the tab.
      DashClassManager.handleAction('cmSelectClass', { tagName: 'BUTTON', dataset: { cid: OTHER } });
      expect(tabIds()).toEqual(SIX);
      expect(activeTab()).toBe('details');
      expect(panelClass()).toBe('cm-tab-panel-details');
      expect(urls[urls.length - 1]).toBe('/dashboard?manage=details&class=' + OTHER);
    });

    it('a remembered Student Page tab opens Details once the tab is hidden again', () => {
      showFor(CID);
      DashClassManager.openClassManager('student-page');
      CmStudentPage.isShown = original.isShown;
      DashClassManager.renderClassManager();
      expect(tabIds()).toEqual(SIX);
      expect(activeTab()).toBe('details');
      expect(urls[urls.length - 1]).toBe('/dashboard?manage=details');
    });
  });
});
