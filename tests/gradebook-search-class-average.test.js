/**
 * With a search on, the row still said Class Average but showed only the
 * searched students' average (8.7/10 for "ma" against the class's 6/10).
 * Escape didn't clear the search and there was no × (Nov 3 bug sweep, Step 4
 * group 2 #23). Class Average is now always the class's, Escape in the box
 * clears the search, and a × clears it too.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount, key, click, fire, showCompetencies } from './helpers/gradebook-dom.js';

const CID = 'cS';
const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };

function seed() {
  _cache.students[CID] = [
    { id: 's1', firstName: 'Mateo', lastName: 'Alvarez' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.assessments[CID] = [quiz];
  _cache.scores[CID] = {
    s1: [{ assessmentId: 'q1', tagId: 'T1', score: 10, date: '2026-10-10', note: '' }],
    s2: [{ assessmentId: 'q1', tagId: 'T1', score: 2, date: '2026-10-10', note: '' }],
  };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

function search(text) {
  const inp = document.querySelector('.gb-search-input');
  inp.value = text;
  fire(inp, 'input');
  return document.querySelector('.gb-search-input');
}

const rows = () => document.querySelectorAll('#gb-data tr[data-sid]').length;

afterEach(unmount);

describe('Class Average while searching', () => {
  it('stays the class average in the Scores view', () => {
    mount(seed, { course: CID });
    search('mat');
    expect(rows()).toBe(1);
    expect(document.querySelector('.gb-scores-stats .gb-avg-val').textContent).toBe('6/10');
  });

  it('stays the class average in the Competencies view', () => {
    mount(seed, { course: CID });
    showCompetencies();
    search('mat');
    expect(rows()).toBe(1);
    expect(document.querySelector('.gb-stats-row .gb-avg-val').textContent).toBe('6/10');
  });
});

describe('clearing the search', () => {
  it('Escape in the box clears it', () => {
    mount(seed, { course: CID });
    const inp = search('mat');
    inp.focus();
    key(inp, 'Escape');
    expect(document.querySelector('.gb-search-input').value).toBe('');
    expect(rows()).toBe(2);
  });

  it('the × clears it', () => {
    mount(seed, { course: CID });
    expect(document.querySelector('.gb-search-clear')).toBeNull();
    search('mat');
    click(document.querySelector('.gb-search-clear'));
    expect(document.querySelector('.gb-search-input').value).toBe('');
    expect(rows()).toBe(2);
  });
});
