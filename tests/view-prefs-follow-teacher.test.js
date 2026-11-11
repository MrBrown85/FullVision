/**
 * A page's view choices (the roster's Sort and Show, Newest First, and the
 * rest) are kept with the teacher's preferences, so signing out, which wipes
 * this computer's gb-* storage, no longer resets them (getViewPref).
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  _cache.config = null;
});

describe('view choices follow the teacher', () => {
  it('saves a choice under dashboard_prefs.view, keeping the other settings', () => {
    saveDashboardPrefs({ studentView: 'grid' });
    saveViewPref('gb-roster-show-c1', 'none');
    saveViewPref('gb-roster-sort-c1', 'firstName');
    expect(getDashboardPrefs()).toEqual({
      studentView: 'grid',
      view: { 'gb-roster-show-c1': 'none', 'gb-roster-sort-c1': 'firstName' },
    });
    expect(_teacherPrefsPatchFromConfig(getConfig()).dashboard_prefs.view['gb-roster-show-c1']).toBe('none');
  });

  it('comes back after sign-out once the preferences arrive', () => {
    saveViewPref('gb-roster-show-c1', 'none');
    const fromServer = getDashboardPrefs();
    localStorage.clear(); // the sign-out wipe
    _cache.config = null;
    expect(getViewPref('gb-roster-show-c1')).toBe(null);
    _cache.config = { dashboardPrefs: fromServer }; // bootstrap_teacher
    expect(getViewPref('gb-roster-show-c1')).toBe('none');
  });

  it('reads a choice made before the move from its old key until it changes', () => {
    localStorage.setItem('gb_newestFirst', '0');
    expect(getViewPref('gb_newestFirst')).toBe('0');
    saveViewPref('gb_newestFirst', '1');
    expect(getViewPref('gb_newestFirst')).toBe('1');
  });

  it('stores numbers as strings, like the old keys', () => {
    saveViewPref('gb_headerHeight', 140);
    expect(getViewPref('gb_headerHeight')).toBe('140');
  });
});
