/**
 * In a class with no categories, every gradebook Competencies header, every
 * assessment row on the student page and every phone Grade row carried a
 * "No Category" pill, which reads as a warning to fix, and the phone filter
 * offered one "No Category" choice (Nov 3 bug sweep, Step 4 group 3 #30).
 * A class with no categories now shows no category badge or filter; a class
 * with categories still marks work that has none.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'cC';
const quiz = { id: 'q1', title: 'Unit Quiz', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-10' };

function seed(categories) {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.assessments[CID] = [quiz];
  _cache.scores[CID] = {};
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.categories[CID] = categories;
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Adams', designations: [] }];
  clearProfCache();
}

describe('showsCategoryBadge', () => {
  beforeEach(() => localStorage.clear());

  it('is false for work with no category in a class with none', () => {
    seed([]);
    expect(getCategories(CID)).toEqual([]);
    expect(showsCategoryBadge(CID, quiz)).toBe(false);
  });

  it('is true in a class with categories, so missing ones show', () => {
    seed([{ id: 'k1', name: 'Quizzes', weight: 100 }]);
    expect(getCategories(CID).length).toBe(1);
    expect(showsCategoryBadge(CID, quiz)).toBe(true);
    expect(showsCategoryBadge(CID, { ...quiz, categoryId: 'k1' })).toBe(true);
  });
});

describe('the phone Grade list', () => {
  let presented = '';
  const realPresent = MComponents.presentSheet;
  beforeEach(() => {
    localStorage.clear();
    MComponents.presentSheet = html => {
      presented = html;
    };
  });
  afterEach(() => {
    MComponents.presentSheet = realPresent;
  });

  it('has no No Category chip or filter in a class with no categories', () => {
    seed([]);
    expect(MGrade.renderPicker(CID)).not.toContain('No Category');
    MGrade.openFilterSheet(CID);
    expect(presented).not.toContain('No Category');
    expect(presented).not.toContain('>Category<');
  });

  it('keeps them in a class with categories', () => {
    seed([{ id: 'k1', name: 'Quizzes', weight: 100 }]);
    expect(MGrade.renderPicker(CID)).toContain('No Category');
    MGrade.openFilterSheet(CID);
    expect(presented).toContain('>Category<');
  });
});
