/**
 * edit: the tests that were tests/edit-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { parseHTML } from 'linkedom';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

describe('edit-copy-duplicate-checks', () => {
  /**
   * Edit a Copy on scored work moves the assessment's rubric scores to the copy
   * (move_rubric_scores, migrations/20261102_move_rubric_scores.sql). Two
   * checkboxes at one level with the same wording used to map to the same new
   * checkbox, so the server move hit a duplicate row and was undone while this
   * device had already moved the scores (Nov 3 bug sweep, Database changes,
   * group 2). Each checkbox now maps to its own new one.
   */

  const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

  /* _scoreMoveMaps as written in page-assignments.js. */
  function scoreMoveMaps() {
    const src = readFileSync('teacher/page-assignments.js', 'utf-8');
    const fn = src.match(/ {2}function _scoreMoveMaps\([^)]*\) \{[\s\S]*?\n {2}\}\n/);
    expect(fn, '_scoreMoveMaps in page-assignments.js').toBeTruthy();
    // eslint-disable-next-line no-new-func
    return new Function('getRubricById', '_writesEnabled', '_isUuid', fn[0] + '\nreturn _scoreMoveMaps;')(
      () => null,
      () => true,
      id => /^[0-9a-f-]{36}$/.test(id),
    );
  }

  describe('Edit a Copy score move maps', () => {
    const held = {
      id: 'held',
      criteria: [
        {
          id: 'hc1',
          checks: [
            { id: 'hk1', level: 3, label: 'Labels the axes' },
            { id: 'hk2', level: 3, label: 'Labels the axes' },
            { id: 'hk3', level: 4, label: 'Adds a trend line' },
          ],
        },
      ],
    };
    const copiedFrom = {
      criteria: { hc1: U(1) },
      checks: { hk1: U(11), hk2: U(12), hk3: U(13) },
    };
    const result = {
      rubrics: [
        {
          id: U(100),
          criteria: [
            {
              id: U(101),
              checks: [
                { id: U(111), level: 3, label: 'Labels the axes' },
                { id: U(112), level: 3, label: 'Labels the axes' },
                { id: U(113), level: 4, label: 'Adds a trend line' },
              ],
            },
          ],
        },
      ],
    };

    it('maps two checkboxes with the same wording at one level to two new checkboxes', () => {
      const maps = scoreMoveMaps()('cid', 'aid', U(100), copiedFrom, held, result);
      expect(maps.criteria).toEqual({ [U(1)]: U(101) });
      expect(maps.checks).toEqual({ [U(11)]: U(111), [U(12)]: U(112), [U(13)]: U(113) });
      const targets = Object.values(maps.checks);
      expect(new Set(targets).size).toBe(targets.length);
    });

    it('lets a checkbox added in the copy take its own new checkbox', () => {
      const added = {
        id: 'held',
        criteria: [
          {
            id: 'hc1',
            checks: [
              { id: 'new', level: 3, label: 'Labels the axes' },
              { id: 'hk1', level: 3, label: 'Labels the axes' },
            ],
          },
        ],
      };
      const maps = scoreMoveMaps()('cid', 'aid', U(100), copiedFrom, added, result);
      expect(maps.checks).toEqual({ [U(11)]: U(112) });
    });
  });
});

describe('edit-student-keys', () => {
  /**
   * Edit Student from the keyboard. Shift+Tab used to leave the dialog for
   * the page behind it, and closing it dropped focus on the page body
   * instead of the Edit Student button that opened it.
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const CID = 'course-ek';

  describe('Edit Student keys', () => {
    var stubDocument, stubToast, stubV2, doc, active, opener, toasts;

    beforeEach(() => {
      localStorage.clear();
      stubDocument = globalThis.document;
      stubV2 = window.v2;
      window.v2 = Object.assign({}, stubV2, { listCourseGuardians: () => Promise.resolve({ data: [] }) });
      doc = parseHTML(
        '<!DOCTYPE html><html><body><button data-action="openEditStudent">Edit Student</button></body></html>',
      ).document;
      globalThis.document = doc;
      // linkedom has no focus: keep track of it here.
      active = null;
      Object.defineProperty(doc, 'activeElement', { get: () => active || doc.body, configurable: true });
      doc.defaultView.HTMLElement.prototype.focus = function () {
        active = this;
      };
      doc.defaultView.HTMLInputElement.prototype.checkValidity = () => true;
      runInThisContext(readFileSync(resolve(root, 'teacher/page-student.js'), 'utf-8'), {
        filename: 'teacher/page-student.js',
      });
      DashClassManager.resetState();
      saveStudents(CID, [{ id: 'st-a', firstName: 'Ava', lastName: 'Lee', designations: [] }]);
      toasts = [];
      stubToast = globalThis.showUndoToast;
      globalThis.showUndoToast = (msg, undo) => toasts.push({ msg, undo });
      opener = doc.querySelector('[data-action="openEditStudent"]');
      opener.focus();
    });

    afterEach(() => {
      globalThis.showUndoToast = stubToast;
      window.v2 = stubV2;
      globalThis.document = stubDocument;
    });

    function key(k, opts) {
      const e = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
      Object.assign(e, { key: k, shiftKey: !!(opts && opts.shift) });
      (doc.activeElement || doc.body).dispatchEvent(e);
      return e;
    }

    it('Shift+Tab from the first box goes to the last button, not the page behind', () => {
      PageStudent.openEditStudent(CID, 'st-a', () => {});
      expect(doc.activeElement.id).toBe('edit-first');
      const e = key('Tab', { shift: true });
      expect(e.defaultPrevented).toBe(true);
      expect(doc.activeElement.dataset.action).toBe('saveEditStudent');
      key('Tab');
      expect(doc.activeElement.id).toBe('edit-first');
    });

    it('Escape closes it and puts focus back on Edit Student', () => {
      PageStudent.openEditStudent(CID, 'st-a', () => {});
      key('Escape');
      expect(doc.getElementById('edit-modal-overlay')).toBe(null);
      expect(doc.activeElement).toBe(opener);
    });

    it('Escape after a change closes with an Undo that brings the dialog back as it was', () => {
      PageStudent.openEditStudent(CID, 'st-a', () => {});
      const pref = doc.getElementById('edit-pref');
      pref.value = 'Lee';
      pref.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      key('Escape');
      expect(doc.getElementById('edit-modal-overlay')).toBe(null);
      expect(toasts.map(t => t.msg)).toEqual(['Changes to Ava not saved']);
      toasts[0].undo();
      expect(doc.getElementById('edit-modal-overlay')).not.toBe(null);
      expect(doc.getElementById('edit-pref').value).toBe('Lee');
      expect(doc.activeElement.id).toBe('edit-first');
    });

    it('Escape with nothing changed just closes', () => {
      PageStudent.openEditStudent(CID, 'st-a', () => {});
      key('Escape');
      expect(toasts).toEqual([]);
    });

    it('Enter in a box saves', () => {
      let saved = 0;
      PageStudent.openEditStudent(CID, 'st-a', () => saved++);
      const pref = doc.getElementById('edit-pref');
      pref.value = 'Lee';
      pref.focus();
      const e = key('Enter');
      expect(e.defaultPrevented).toBe(true);
      expect(saved).toBe(1);
      expect(getStudents(CID)[0].preferred).toBe('Lee');
      expect(doc.getElementById('edit-modal-overlay')).toBe(null);
    });
  });
});

describe('edit-student-parent-emails', () => {
  /**
   * Edit Student's parent emails load once per class. A dialog closed before
   * that load came back used to fill the next student's dialog with its own
   * student's parents (the boxes share ids), and Save then wrote them onto
   * the second student.
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const CID = 'course-es';

  describe('Edit Student parent emails', () => {
    var stubDocument, stubV2, stubSave, doc, release, saved;

    beforeEach(() => {
      localStorage.clear();
      stubDocument = globalThis.document;
      stubV2 = window.v2;
      doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
      globalThis.document = doc;
      // linkedom has no form validation; every email here is well formed.
      doc.defaultView.HTMLInputElement.prototype.checkValidity = () => true;
      runInThisContext(readFileSync(resolve(root, 'teacher/page-student.js'), 'utf-8'), {
        filename: 'teacher/page-student.js',
      });
      DashClassManager.resetState();
      saveStudents(CID, [
        { id: 'st-a', firstName: 'Ava', lastName: 'Lee', designations: [] },
        { id: 'st-b', firstName: 'Ben', lastName: 'Cho', designations: [] },
      ]);
      // The class's guardians, held until the test lets the read return.
      window.v2 = Object.assign({}, stubV2, {
        listCourseGuardians: () =>
          new Promise(res => {
            release = () =>
              res({
                data: [
                  { enrollment_id: 'st-a', email: 'a.parent@example.com', created_at: '1' },
                  { enrollment_id: 'st-b', email: 'b.parent@example.com', created_at: '1' },
                ],
              });
          }),
      });
      saved = [];
      stubSave = DashClassManager.saveGuardianEmail;
      DashClassManager.saveGuardianEmail = (cid, sid, i, email) => saved.push([sid, i, email]);
    });

    afterEach(() => {
      DashClassManager.saveGuardianEmail = stubSave;
      window.v2 = stubV2;
      globalThis.document = stubDocument;
    });

    // The dialog's own buttons.
    function click(action) {
      const btn = doc.querySelector('#edit-modal-overlay [data-action="' + action + '"]');
      btn.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
    }

    it("does not put one student's parents in the next student's dialog", async () => {
      PageStudent.openEditStudent(CID, 'st-a', () => {});
      click('closeEditStudent');
      PageStudent.openEditStudent(CID, 'st-b', () => {});
      release();
      await new Promise(r => setTimeout(r, 0));

      const shown = doc.getElementById('edit-g0').value;
      // Saving without a change writes no parent email.
      click('saveEditStudent');
      expect({ shown, saved }).toEqual({ shown: 'b.parent@example.com', saved: [] });
    });
  });
});
