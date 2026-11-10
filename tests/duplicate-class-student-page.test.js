/**
 * Duplicate Class and the student page's two class settings
 * (docs/DECISIONS.md, Student page build rulings 12): the copy takes the
 * original's Return Grades choice (courseConfig.return_grades), and its
 * Student Page starts off (courseConfig.student_page_enabled is not copied).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SRC = 'sci8';

function seed(settings) {
  saveCourses({ [SRC]: { id: SRC, name: 'Science 8', gradingSystem: 'both' } });
  _cache.courseConfigs[SRC] = Object.assign({ calcMethod: 'decayingAvg', roundPercent: false }, settings);
}

function duplicate() {
  DashClassManager.duplicateCourse(SRC, '');
  return Object.keys(COURSES).find(id => id !== SRC);
}

// What the copy keeps on this device, as a reload would read it.
function stored(cid) {
  return JSON.parse(localStorage.getItem('gb-courseconfig-' + cid));
}

describe('Duplicate Class: Return Grades is copied, Student Page starts off', () => {
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (field) {
      if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
        _cache[field] = {};
      }
    });
    originalUseSupabase = _useSupabase;
    _useSupabase = false;
    DashClassManager.configure({ activeCourse: SRC, onRender: function () {}, onCourseChange: function () {} });
  });

  afterEach(() => {
    DashClassManager.resetState();
    _useSupabase = originalUseSupabase;
  });

  it('a class with its Student Page on and When I Return Them', () => {
    seed({ student_page_enabled: true, return_grades: 'on_return' });
    const cid = duplicate();
    const cc = getCourseConfig(cid);
    expect(cc.student_page_enabled).not.toBe(true);
    expect(cc).not.toHaveProperty('student_page_enabled');
    expect(cc.return_grades).toBe('on_return');
    expect(stored(cid)).not.toHaveProperty('student_page_enabled');
    expect(stored(cid).return_grades).toBe('on_return');
    // Everything else comes along as before.
    expect(cc).toMatchObject({ calcMethod: 'decayingAvg', roundPercent: false });
    // The original keeps its own.
    expect(getCourseConfig(SRC)).toMatchObject({ student_page_enabled: true, return_grades: 'on_return' });
  });

  it('a class with its Student Page on and As Soon As I Save', () => {
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    const cc = getCourseConfig(duplicate());
    expect(cc).not.toHaveProperty('student_page_enabled');
    expect(cc.return_grades).toBe('on_save');
  });

  it('a class with its Student Page off keeps its Return Grades choice too', () => {
    seed({ student_page_enabled: false, return_grades: 'on_return' });
    const cc = getCourseConfig(duplicate());
    expect(cc.student_page_enabled).not.toBe(true);
    expect(cc.return_grades).toBe('on_return');
  });

  it('a class with neither setting copies as it always has', () => {
    seed({});
    const cid = duplicate();
    expect(getCourseConfig(cid)).toEqual({ calcMethod: 'decayingAvg', roundPercent: false });
    expect(stored(cid)).toEqual({ calcMethod: 'decayingAvg', roundPercent: false });
  });
});
