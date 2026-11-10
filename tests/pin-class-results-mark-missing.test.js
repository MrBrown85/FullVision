/**
 * Pin: Mark Missing and Mark Excused on Class Results' Unmarked list
 * (teacher/class-results.js), S0-P1.
 *
 * The buttons show on Complete/Incomplete work. On the gradebook the panel
 * hands the job to the gradebook's Mark Blank Cells; everywhere else (the
 * Assignments page here) it runs its own _markBlankHere. Both are driven
 * through the real panel on a linkedom document. This records what is
 * saved and sent today so the tidying PRs cannot change it unnoticed.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { mount } from './helpers/gradebook-dom.js';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  entries,
  stored,
  settle,
  click,
  openAssignments,
  closePages,
  toastText,
} from './helpers/pin-save-paths.js';

// Loaded before either page starts, as teacher/app.html does, so each page
// tells the panel what its buttons do there (ClassResults.setPage).
runInThisContext(readFileSync('teacher/class-results.js', 'utf-8'), { filename: 'teacher/class-results.js' });

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const ELI = U(15);
const FAY = U(16);
const EXIT = U(31);

const entry = (sid, score, more) => ({
  id: sid + ':' + EXIT + ':' + U(41),
  assessmentId: EXIT,
  tagId: U(41),
  score,
  date: '2026-10-10',
  type: 'formative',
  note: '',
  created: '2026-10-10T17:00:00.000Z',
  ...more,
});

function seed() {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
      { id: CARA, firstName: 'Cara', lastName: 'Chen' },
      { id: DEV, firstName: 'Dev', lastName: 'Das' },
      { id: ELI, firstName: 'Eli', lastName: 'Evans' },
      { id: FAY, firstName: 'Fay', lastName: 'Fox' },
    ],
    assessments: [
      {
        id: EXIT,
        title: 'Exit Ticket',
        scoreMode: 'complete',
        maxPoints: 1,
        tagIds: [U(41)],
        date: '2026-10-10',
        type: 'formative',
      },
    ],
    scores: {
      [AVA]: [entry(AVA, 1)], // Complete
      // Cara is unmarked but has an Overall Comment, which is feedback.
      [CARA]: [entry(CARA, null, { note: 'See me' })],
    },
    // Eli is unmarked and Late; Fay is already Excused.
    statuses: { [ELI + ':' + EXIT]: 'LATE', [FAY + ':' + EXIT]: 'EXC' },
  });
}

const status = (sid, value) => ['set_score_status', { p_enrollment_id: sid, p_assessment_id: EXIT, p_status: value }];
const press = which =>
  click(document.querySelector('#class-results [data-cr="markBlank"][data-status="' + which + '"]'));

describe('pin: Class Results, Mark Missing on the Unmarked list', () => {
  let session = null;

  afterEach(() => {
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    ClassResults.close();
    if (session) session.signOut();
    session = null;
    closePages();
    clearClass(CID);
  });

  describe('on the Assignments page (the panel’s own _markBlankHere)', () => {
    function open() {
      openAssignments(seed, CID);
      session = signIn();
      ClassResults.open(CID, EXIT);
    }

    it('offers both buttons on Complete/Incomplete work', () => {
      open();
      const buttons = document.querySelectorAll('#class-results [data-cr="markBlank"]');
      expect(Array.from(buttons).map(b => b.textContent)).toEqual(['Mark Missing', 'Mark Excused']);
    });

    it('marks only the cells with nothing in them, and writes no score', async () => {
      open();
      const scoresBefore = JSON.stringify(getScores(CID));
      press('NS');
      await settle();

      expect(getAssignmentStatuses(CID)).toEqual({
        [ELI + ':' + EXIT]: 'LATE', // a status of its own: left
        [FAY + ':' + EXIT]: 'EXC',
        [BEN + ':' + EXIT]: 'NS',
        [DEV + ':' + EXIT]: 'NS',
        // Ava is Complete and Cara has feedback: neither is marked.
      });
      expect(stored('statuses', CID)).toEqual(getAssignmentStatuses(CID));
      expect(JSON.stringify(getScores(CID))).toBe(scoresBefore);
      expect(entries(CID, BEN)).toEqual([]);
      // One set_score_status per cell marked, in roster order; nothing else.
      expect(session.sent()).toEqual([status(BEN, 'NS'), status(DEV, 'NS')]);
      expect(toastText()).toBe('2 blank cells marked Missing');
    });

    it('Undo takes off just those marks', async () => {
      open();
      press('NS');
      await settle();
      session.since();
      executeUndo();
      await settle();

      expect(getAssignmentStatuses(CID)).toEqual({ [ELI + ':' + EXIT]: 'LATE', [FAY + ':' + EXIT]: 'EXC' });
      expect(stored('statuses', CID)).toEqual(getAssignmentStatuses(CID));
      expect(session.since()).toEqual([status(BEN, null), status(DEV, null)]);
    });

    it('Undo leaves a cell whose status was changed since', async () => {
      open();
      press('NS');
      await settle();
      setAssignmentStatus(CID, BEN, EXIT, 'EXC');
      await settle();
      session.since();
      executeUndo();
      await settle();

      expect(getAssignmentStatus(CID, BEN, EXIT)).toBe('EXC');
      expect(getAssignmentStatus(CID, DEV, EXIT)).toBe(null);
      expect(session.since()).toEqual([status(DEV, null)]);
    });

    it('Mark Excused does the same with EXC', async () => {
      open();
      press('EXC');
      await settle();

      expect(getAssignmentStatus(CID, BEN, EXIT)).toBe('EXC');
      expect(getAssignmentStatus(CID, DEV, EXIT)).toBe('EXC');
      expect(session.sent()).toEqual([status(BEN, 'EXC'), status(DEV, 'EXC')]);
      expect(toastText()).toBe('2 blank cells marked Excused');
    });

    it('marks on this device and sends nothing with writes off, as in Demo Mode', async () => {
      openAssignments(seed, CID);
      ClassResults.open(CID, EXIT);
      press('NS');
      await settle();
      expect(getAssignmentStatus(CID, BEN, EXIT)).toBe('NS');
      expect(stored('statuses', CID)[DEV + ':' + EXIT]).toBe('NS');
    });
  });

  describe('on the gradebook (handed to its Mark Blank Cells)', () => {
    function open() {
      mount(seed, { course: CID });
      session = signIn();
      ClassResults.open(CID, EXIT);
    }

    it('marks the same cells and sends the same writes', async () => {
      open();
      press('NS');
      await settle();

      expect(getAssignmentStatuses(CID)).toEqual({
        [ELI + ':' + EXIT]: 'LATE',
        [FAY + ':' + EXIT]: 'EXC',
        [BEN + ':' + EXIT]: 'NS',
        [DEV + ':' + EXIT]: 'NS',
      });
      expect(session.sent()).toEqual([status(BEN, 'NS'), status(DEV, 'NS')]);
      expect(toastText()).toBe('2 blank cells marked Missing');
    });

    it('Undo takes off just those marks', async () => {
      open();
      press('NS');
      await settle();
      session.since();
      executeUndo();
      await settle();

      expect(getAssignmentStatuses(CID)).toEqual({ [ELI + ':' + EXIT]: 'LATE', [FAY + ':' + EXIT]: 'EXC' });
      expect(session.since()).toEqual([status(BEN, null), status(DEV, null)]);
    });
  });
});
