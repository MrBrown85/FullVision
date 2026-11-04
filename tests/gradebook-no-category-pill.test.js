/**
 * The Competencies view gave every header a grey "No Category" pill in a
 * class with no categories (Nov 3 bug sweep, Step 4 group 3 #30). It now
 * shows none there; a class with categories keeps its category pills.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cP';
const quiz = { id: 'q1', title: 'Unit Quiz', scoreMode: 'proficiency', tagIds: ['T1'], date: '2026-10-10' };

function seed(categories, a) {
  return () => {
    _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Adams' }];
    _cache.assessments[CID] = [a];
    _cache.scores[CID] = { s1: [] };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
    _cache.categories[CID] = categories;
  };
}

const pills = () => Array.from(document.querySelectorAll('.gb-assess-type-pill')).map(p => p.textContent);

afterEach(unmount);

describe('Competencies headers', () => {
  it('have no category pill in a class with no categories', () => {
    mount(seed([], quiz), { course: CID });
    showCompetencies();
    expect(document.querySelector('.gb-grid-assess-group')).not.toBeNull();
    expect(pills()).toEqual([]);
  });

  it('keep the category pill in a class with categories', () => {
    mount(seed([{ id: 'k1', name: 'Quizzes', weight: 100 }], { ...quiz, categoryId: 'k1' }), { course: CID });
    showCompetencies();
    expect(pills()).toEqual(['Quizzes']);
  });
});
