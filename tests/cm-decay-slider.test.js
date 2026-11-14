/**
 * Class Settings' "How Much Newer Work Counts" slider (Decaying Average).
 * While it moves, only its percent and the rule's words follow it. Letting
 * it go saves the class: one save of the settings and one of the course,
 * not one of each for every step of the drag (each save cleared the grade
 * caches and went to the server).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-0000000dec01';

describe('the decay slider', () => {
  let main, label, rule, originalGetElementById, real, saves, courseSaves;

  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'decayingAvg' } });
    _cache.courseConfigs[CID] = { calcMethod: 'decayingAvg', decayWeight: 0.65 };
    saveStudents(CID, [{ id: 's1', firstName: 'Amara', lastName: 'Osei' }]);
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: 't', label: 'Inquiry' }] }],
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [];
    _cache.scores[CID] = {};
    clearProfCache();
    main = { innerHTML: '' };
    label = { textContent: '' };
    rule = { textContent: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = id =>
      id === 'main'
        ? main
        : id === 'cm-decay-val'
          ? label
          : id === 'cm-method-rule'
            ? rule
            : originalGetElementById(id);
    real = { saveCourseConfig: globalThis.saveCourseConfig, updateCourse: globalThis.updateCourse };
    saves = 0;
    courseSaves = 0;
    globalThis.saveCourseConfig = function () {
      saves++;
      return real.saveCourseConfig.apply(this, arguments);
    };
    globalThis.updateCourse = function () {
      courseSaves++;
      return real.updateCourse.apply(this, arguments);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
  });

  afterEach(() => {
    globalThis.saveCourseConfig = real.saveCourseConfig;
    globalThis.updateCourse = real.updateCourse;
    document.getElementById = originalGetElementById;
    DashClassManager.resetState();
  });

  const slider = value => ({ dataset: { actionInput: 'cmDecaySlider', actionChange: 'cmDecayCommit' }, value });

  it('draws the slider on the Grading tab', () => {
    expect(main.innerHTML).toContain('id="cm-decay-slider" data-action-input="cmDecaySlider"');
  });

  it('saves nothing while it moves, only the words follow it', () => {
    saves = 0;
    courseSaves = 0;
    for (let v = 66; v <= 85; v++) DashClassManager.handleInput(slider(String(v)));
    expect(saves).toBe(0);
    expect(courseSaves).toBe(0);
    expect(label.textContent).toBe('85%');
    expect(rule.textContent).toContain('85');
    expect(getCourseConfig(CID).decayWeight).toBe(0.65);
  });

  it('saves once when it is let go', () => {
    saves = 0;
    courseSaves = 0;
    for (let v = 66; v <= 85; v++) DashClassManager.handleInput(slider(String(v)));
    DashClassManager.handleChange(slider('85'));
    expect(saves).toBe(1);
    expect(courseSaves).toBe(1);
    expect(getCourseConfig(CID).decayWeight).toBe(0.85);
    expect(COURSES[CID].decayWeight).toBe(0.85);
  });
});
