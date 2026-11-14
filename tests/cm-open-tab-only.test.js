/**
 * Class Settings builds the open tab's panel only. It used to build every
 * tab's panel (the Grading tab's examples and student check, the whole
 * competency list, the roster) on each draw, opening, every tab switch and
 * most setting clicks, and show one.
 *
 * Counted by a call each panel makes while it is built:
 *   details        reads the class's Late Work Policy
 *   students       getWithdrawnStudents (the Withdrawn list)
 *   questionnaires CmQuestionnaires.render
 *   grading        calcMethodExample (one per method)
 *   terms          normalizeTermOrdinals (the term tiles)
 *   competencies   getFoldersCountAsOne (the Grading tab asks it too)
 *
 * What a closed tab did besides drawing still happens: the questionnaires
 * are asked for, for the tab's count.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-0000000c0ab1';
const WRAPPED = ['getWithdrawnStudents', 'calcMethodExample', 'normalizeTermOrdinals', 'getFoldersCountAsOne'];

describe('Class Settings builds the open tab only', () => {
  let main, originalGetElementById, real, n, loads;

  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'letter', calcMethod: 'mostRecent' } });
    _cache.courseConfigs[CID] = {
      reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' }],
    };
    saveStudents(CID, [{ id: 's1', firstName: 'Amara', lastName: 'Osei' }]);
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: 't', label: 'Inquiry' }] }],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [];
    _cache.scores[CID] = {};
    clearProfCache();

    n = { details: 0, students: 0, questionnaires: 0, grading: 0, terms: 0, competencies: 0 };
    const key = {
      getWithdrawnStudents: 'students',
      calcMethodExample: 'grading',
      normalizeTermOrdinals: 'terms',
      getFoldersCountAsOne: 'competencies',
    };
    real = {};
    WRAPPED.forEach(name => {
      real[name] = globalThis[name];
      globalThis[name] = function () {
        n[key[name]]++;
        return real[name].apply(this, arguments);
      };
    });
    real.qnRender = CmQuestionnaires.render;
    CmQuestionnaires.render = function () {
      n.questionnaires++;
      return real.qnRender.apply(this, arguments);
    };
    real.loaded = Questionnaires.loaded;
    real.load = Questionnaires.load;
    loads = 0;
    Questionnaires.loaded = () => false;
    Questionnaires.load = () => {
      loads++;
    };
    let policy = '';
    Object.defineProperty(COURSES[CID], 'lateWorkPolicy', {
      get() {
        n.details++;
        return policy;
      },
      set(v) {
        policy = v;
      },
      configurable: true,
    });

    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = id => (id === 'main' ? main : originalGetElementById(id));
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  });

  afterEach(() => {
    WRAPPED.forEach(name => (globalThis[name] = real[name]));
    CmQuestionnaires.render = real.qnRender;
    Questionnaires.loaded = real.loaded;
    Questionnaires.load = real.load;
    document.getElementById = originalGetElementById;
    DashClassManager.resetState();
  });

  const reset = () => Object.keys(n).forEach(k => (n[k] = 0));
  const built = () => Object.keys(n).filter(k => n[k] > 0);
  const open = tab => DashClassManager.handleAction('cmSetTab', { dataset: { tab } });

  it('opens on Details and builds Details alone', () => {
    DashClassManager.openClassManager();
    expect(main.innerHTML).toContain('cm-tab-panel-details');
    expect(built()).toEqual(['details']);
  });

  it('builds each tab when it is opened, and no other', () => {
    DashClassManager.openClassManager();
    ['students', 'questionnaires', 'grading', 'terms', 'competencies'].forEach(tab => {
      reset();
      open(tab);
      expect(main.innerHTML).toContain('cm-tab-panel-' + tab);
      // The Grading tab asks whether folders count as one, as the competency list does.
      expect(built()).toEqual(tab === 'grading' ? ['grading', 'competencies'] : [tab]);
    });
  });

  it('still asks for the questionnaires on another tab, for the tab count', () => {
    DashClassManager.openClassManager();
    expect(n.questionnaires).toBe(0);
    expect(loads).toBeGreaterThan(0);
  });
});
