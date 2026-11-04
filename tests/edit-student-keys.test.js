/**
 * Edit Student from the keyboard. Shift+Tab used to leave the dialog for
 * the page behind it, and closing it dropped focus on the page body
 * instead of the Edit Student button that opened it.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

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
