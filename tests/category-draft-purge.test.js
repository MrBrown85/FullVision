/**
 * The 14-day purge of saved copies leaves an unsaved category draft
 * (gb-category-draft-<class>) alone. A class that is deleted still loses it.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const STALE = '11111111-1111-4111-8111-111111111111';
const FRESH = '22222222-2222-4222-8222-222222222222';
const OLD = () => Date.now() - 15 * 24 * 60 * 60 * 1000;

describe('purging saved copies and category drafts', () => {
  beforeEach(() => localStorage.clear());

  it('a stale class loses its saved copy but keeps its draft', () => {
    _saveClassMeta(STALE, { lastOpenedAt: OLD() });
    localStorage.setItem('gb-students-' + STALE, '[]');
    saveCategoryDraft(STALE, { rows: [{ name: 'Quizzes' }], opened: [] });
    _saveClassMeta(FRESH, { lastOpenedAt: Date.now() });
    localStorage.setItem('gb-students-' + FRESH, '[]');
    _purgeStaleSavedCopies();
    expect(localStorage.getItem('gb-students-' + STALE)).toBeNull();
    expect(localStorage.getItem('gb-bundle-meta-' + STALE)).toBeNull();
    expect(getCategoryDraft(STALE)).toEqual({ rows: [{ name: 'Quizzes' }], opened: [] });
    expect(localStorage.getItem('gb-students-' + FRESH)).toBe('[]');
  });

  it('a stale class without a draft is purged as before', () => {
    _saveClassMeta(STALE, { lastOpenedAt: OLD() });
    localStorage.setItem('gb-students-' + STALE, '[]');
    localStorage.setItem('gb-assessments-' + STALE, '[]');
    _purgeStaleSavedCopies();
    expect(localStorage.getItem('gb-students-' + STALE)).toBeNull();
    expect(localStorage.getItem('gb-assessments-' + STALE)).toBeNull();
    expect(getCategoryDraft(STALE)).toBeNull();
  });

  it('a draft goes when its save lands (the form clears it) and when the class is deleted', () => {
    saveCategoryDraft(STALE, { rows: [{ name: 'Quizzes' }], opened: [] });
    saveCategoryDraft(STALE, null);
    expect(localStorage.getItem('gb-category-draft-' + STALE)).toBeNull();
    saveCategoryDraft(STALE, { rows: [{ name: 'Quizzes' }], opened: [] });
    _clearCourseLocalState(STALE);
    expect(localStorage.getItem('gb-category-draft-' + STALE)).toBeNull();
  });
});
