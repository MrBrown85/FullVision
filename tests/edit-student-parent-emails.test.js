/**
 * Edit Student's parent emails load once per class. A dialog closed before
 * that load came back used to fill the next student's dialog with its own
 * student's parents (the boxes share ids), and Save then wrote them onto
 * the second student.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

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
