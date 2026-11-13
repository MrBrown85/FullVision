/**
 * Class Results, open beside the gradebook, is drawn again only when what
 * it shows has changed (teacher/class-results.js, refresh). The gradebook
 * asks it to refresh after every draw; before, each one rewrote the whole
 * panel and fetched the other classes' results again, even after a score
 * on another assessment.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { mount, unmount } from './helpers/gradebook-dom.js';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

// Loaded before the page starts, as teacher/app.html does.
runInThisContext(readFileSync('teacher/class-results.js', 'utf-8'), { filename: 'teacher/class-results.js' });

const CID = U(1);
const [AVA, BEN] = [U(11), U(12)];
const [ESSAY, QUIZ] = [U(31), U(32)];
const TAG = U(41);
const entry = (sid, aid, score) => ({
  id: sid + ':' + aid + ':' + TAG,
  assessmentId: aid,
  tagId: TAG,
  score,
  date: '2026-10-10',
  type: 'summative',
  note: '',
  created: '2026-10-10T17:00:00.000Z',
});

function seed() {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [TAG], date: '2026-10-10', type: 'summative' },
      { id: QUIZ, title: 'Quiz', tagIds: [TAG], date: '2026-10-11', type: 'summative' },
    ],
    scores: { [AVA]: [entry(AVA, ESSAY, 3), entry(AVA, QUIZ, 2)] },
  });
}

const body = () => document.querySelector('#class-results').firstElementChild;
const opener = () => document.querySelector('#gb-data [data-action="classResults"][data-aid="' + ESSAY + '"]');

afterEach(() => {
  ClassResults.close();
  unmount();
  clearClass(CID);
  localStorage.clear();
});

describe('Class Results beside the gradebook', () => {
  it('a redraw that changes nothing it shows leaves it as it is, and keeps its cell marked', () => {
    mount(seed, { course: CID });
    ClassResults.open(CID, ESSAY);
    const before = body();
    // A score on the other assessment, and the gradebook's redraw.
    Grader.typeLevel(CID, BEN, QUIZ, TAG, 4, '2026-10-11', 'summative', '');
    clearProfCache();
    PageGradebook.render();
    expect(body()).toBe(before);
    expect(opener().classList.contains('cr-is-open')).toBe(true);
  });

  it('a score on its own assessment draws it again', () => {
    mount(seed, { course: CID });
    ClassResults.open(CID, ESSAY);
    const before = body();
    Grader.typeLevel(CID, BEN, ESSAY, TAG, 4, '2026-10-10', 'summative', '');
    clearProfCache();
    PageGradebook.render();
    expect(body()).not.toBe(before);
    expect(document.querySelector('#class-results').textContent).toContain('2 of 2');
    expect(opener().classList.contains('cr-is-open')).toBe(true);
  });
});
