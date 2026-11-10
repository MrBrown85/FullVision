/**
 * The pin helper's seeded class is a loaded class (tests/helpers/pin-save-paths.js).
 *
 * teacher/router.js, which tests/setup.js loads, starts loading the
 * teacher's other classes 1.5 s later (preloadClasses in shared/data.js).
 * A pin signs in with a recording client that holds no classes. When that
 * timer came due inside a pin that was waiting, on a slow or busy machine,
 * the pin's class was fetched from the client and emptied, and the pin
 * failed now and then. seedClass now tells data.js the class is loaded, as
 * a class a teacher has open is, so the preload leaves it alone.
 *
 * This runs the preload by hand, so it does not depend on the clock.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass, entries, settle } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const ESSAY = U(31);
const QUESTION = U(41);

function seed() {
  seedClass(CID, {
    students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
    assessments: [{ id: ESSAY, title: 'Essay', tagIds: [QUESTION], date: '2026-10-10', type: 'summative' }],
    scores: {
      [AVA]: [
        {
          id: AVA + ':' + ESSAY + ':' + QUESTION,
          assessmentId: ESSAY,
          tagId: QUESTION,
          score: 3,
          date: '2026-10-10',
          type: 'summative',
          note: '',
          created: '2026-10-10T17:00:00.000Z',
        },
      ],
    },
  });
}

describe('the pin helper’s seeded class is a loaded class', () => {
  let session = null;

  afterEach(() => {
    if (session) session.signOut();
    session = null;
    clearClass(CID);
  });

  it('the load of the teacher’s other classes leaves it alone: nothing is fetched, nothing is emptied', async () => {
    seed();
    session = signIn();
    // The pin's class is not the one data.js calls open, so it is one of
    // the "other classes" the preload would load.
    expect(getActiveCourse()).not.toBe(CID);
    expect(isClassLoaded(CID)).toBe(true);
    expect(classesToPreload()).not.toContain(CID);

    await preloadClasses();
    await settle();

    expect(session.sent().filter(([, params]) => params && params.p_course_id === CID)).toEqual([]);
    expect(getStudents(CID).map(s => s.id)).toEqual([AVA]);
    expect(getAssessments(CID).map(a => a.id)).toEqual([ESSAY]);
    expect(entries(CID, AVA).map(e => [e.tagId, e.score])).toEqual([[QUESTION, 3]]);
  });

  it('clearClass takes the mark off again', () => {
    seed();
    session = signIn();
    clearClass(CID);
    expect(isClassLoaded(CID)).toBe(false);
  });
});
