/**
 * Class menus list the same classes as the dashboard: archived classes are
 * left out unless one is open (reported 2026-10-14: three "English Studies
 * 12" entries, two of them archived and empty).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('getPickerCourses', () => {
  var saved;

  beforeEach(() => {
    saved = Object.assign({}, COURSES);
    Object.keys(COURSES).forEach(k => delete COURSES[k]);
    COURSES.hum8 = { id: 'hum8', name: 'Humanities 8' };
    COURSES.old1 = { id: 'old1', name: 'English Studies 12', archived: true };
    COURSES.eng12 = { id: 'eng12', name: 'English Studies 12' };
  });

  afterEach(() => {
    Object.keys(COURSES).forEach(k => delete COURSES[k]);
    Object.assign(COURSES, saved);
  });

  it('leaves out archived classes', () => {
    expect(getPickerCourses('hum8').map(c => c.id)).toEqual(['hum8', 'eng12']);
  });

  it('keeps an archived class that is open, so the menu names it', () => {
    expect(getPickerCourses('old1').map(c => c.id)).toEqual(['hum8', 'old1', 'eng12']);
  });
});
