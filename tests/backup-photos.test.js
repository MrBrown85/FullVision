/**
 * Class backups leave photos of student work out and say so (S8-F2; Colin,
 * Q22): "Photos of student work are not in this file." The line is in the
 * file's `photos` field once the class's student page is on; with it off the
 * file is as it always was. Nothing of the work sent goes in, and a backup
 * carrying the line restores as any other.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = 'b0000000-0000-4000-8000-0000000000a1';
const NOTE = 'Photos of student work are not in this file.';

describe('Download Class Backup and photos of student work', () => {
  let written;
  let originals;
  let link;
  let wasDemo;

  beforeEach(() => {
    localStorage.clear();
    wasDemo = window.isDemoMode;
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
    saveCourseConfig(CID, {});
    saveStudents(CID, [{ id: 's1', firstName: 'Noor', lastName: 'Ahmed' }]);
    saveAssessments(CID, [{ id: 'a1', title: 'Cell Lab', date: '2026-10-10', tagIds: [] }]);
    written = null;
    originals = { Blob: globalThis.Blob, url: URL.createObjectURL, el: document.createElement };
    globalThis.Blob = function (parts) {
      written = parts.join('');
    };
    URL.createObjectURL = () => 'blob:backup';
    link = { click: vi.fn() };
    document.createElement = () => link;
  });

  afterEach(() => {
    globalThis.Blob = originals.Blob;
    URL.createObjectURL = originals.url;
    document.createElement = originals.el;
    window.isDemoMode = wasDemo;
  });

  const download = () => {
    DashClassManager.handleAction('cmDownloadBackup', { dataset: { cid: CID } });
    return JSON.parse(written);
  };

  it('has the exact line', () => {
    expect(FVBackupRestore.PHOTOS_NOTE).toBe(NOTE);
  });

  const sendWork = on => {
    window.isDemoMode = () => true;
    saveDemoStudentWork(CID, { course: { send_work: on } });
  };
  const studentPage = () =>
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { student_page_enabled: true }));

  it('says so in the file once the class’s student page and Send Work are on', () => {
    studentPage();
    sendWork(true);
    expect(download().photos).toBe(NOTE);
  });

  it('leaves the file as it was while either is off', () => {
    expect('photos' in download()).toBe(false);
    sendWork(true);
    expect('photos' in download()).toBe(false);
    studentPage();
    sendWork(false);
    expect('photos' in download()).toBe(false);
  });

  it('puts nothing of the work sent in the file', () => {
    window.isDemoMode = () => true;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { student_page_enabled: true }));
    saveDemoStudentWork(CID, {
      course: { send_work: true },
      assessments: [{ id: 'a1', students_send: 'photos' }],
      submissions: [
        {
          id: 'sub-zz1',
          assessment_id: 'a1',
          enrollment_id: 's1',
          state: 'sent',
          sent_by: 'student',
          note: 'ZZSENT note',
          files: [{ id: 'f-zz1', page: 1, path: 'zz-page.jpg', thumb_path: 'zz-page-thumb.jpg' }],
        },
      ],
    });
    expect(getCourseSubmissions(CID).submissions).toHaveLength(1);
    download();
    ['ZZSENT', 'zz-page', 'sub-zz1', 'f-zz1', 'students_send', 'send_work'].forEach(v =>
      expect(written).not.toContain(v),
    );
  });

  it('restores a backup that carries the line', () => {
    studentPage();
    sendWork(true);
    const backup = FVBackupRestore.parseBackup(JSON.stringify(Object.assign({ learningMap: {} }, download())));
    expect(backup.photos).toBe(NOTE);
    const remapped = FVBackupRestore.remapBackup(backup, () => crypto.randomUUID());
    expect(remapped.backup.photos).toBe(NOTE);
  });
});
