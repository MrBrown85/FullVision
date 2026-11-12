/**
 * cm: the tests that were tests/cm-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { parseHTML } from 'linkedom';
import { clearClass, seedClass, serverSaysStudentPageOn, signIn } from './helpers/pin-save-paths.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

describe('cm-competencies-tab', () => {
  /**
   * Competencies tab: select mode, removing several at once (scores kept),
   * CSV export/import through the review, and Re-link's review, which matches
   * on curriculum wording, then code, then title, so nothing is added twice.
   */

  const CID = 'e0000000-0000-4000-8000-0000000c0a11';

  function sec(id, code, label, text, icans, extra) {
    return Object.assign(
      {
        id: id,
        subject: 'SCI8',
        name: 'Questioning and predicting',
        shortName: 'Questioning',
        color: '#0891b2',
        tags: [
          {
            id: id,
            code: code,
            label: label,
            text: text,
            source_text: text,
            i_can_statements: icans || [],
            color: '#0891b2',
            subject: 'SCI8',
          },
        ],
      },
      extra || {},
    );
  }

  const CURRICULUM = {
    SCI8: {
      subject: 'Science',
      course_name: 'Science 8',
      categories: [
        {
          name: 'Questioning and predicting',
          competencies: [
            {
              tag: 'QAP',
              short_label: 'Question and Predict',
              raw: 'Demonstrate curiosity',
              i_can_statements: ['I can ask'],
            },
            {
              tag: 'PI',
              short_label: 'Plan Investigations',
              raw: 'Plan an investigation',
              i_can_statements: ['I can plan'],
            },
            { tag: 'SC', short_label: 'Scientific Communication', raw: 'Communicate ideas', i_can_statements: [] },
            { tag: 'EM', short_label: 'Evaluate Methods', raw: 'Evaluate methods', i_can_statements: [] },
          ],
        },
      ],
    },
  };

  function codes() {
    return getLearningMap(CID).sections.map(function (s) {
      return s.tags[0].code;
    });
  }

  describe('Competencies tab', () => {
    var main;
    var originalGetElementById;
    var originalConfirm;
    var confirms;

    beforeEach(() => {
      localStorage.clear();
      if (_cache.learningMaps) _cache.learningMaps = {};
      if (_cache.scores) _cache.scores = {};
      saveCourses({ [CID]: { id: CID, name: 'Science 8', curriculumTags: ['SCI8'] } });
      saveLearningMap(CID, {
        subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
        sections: [
          // Renamed, with an I Can statement added.
          sec('QAP', 'QAP', 'Questioning', 'Demonstrate curiosity', ['I can ask', 'I can wonder']),
          sec('PI', 'PI', 'Plan Investigations', 'Plan an investigation', ['I can plan']),
          sec('LS', 'LS', 'Lab Safety', 'Work safely', [], { subject: 'SCI8' }),
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      });
      getLearningMap(CID).sections[2].tags[0].source_text = null;
      saveScores(CID, {
        st1: [
          { id: 'x1', assessmentId: 'a1', tagId: 'QAP', score: 3 },
          { id: 'x2', assessmentId: 'a2', tagId: 'QAP', score: 2 },
          { id: 'x3', assessmentId: 'a1', tagId: 'LS', score: 4 },
        ],
      });
      main = { innerHTML: '' };
      originalGetElementById = document.getElementById;
      document.getElementById = function (id) {
        return id === 'main' ? main : originalGetElementById(id);
      };
      originalConfirm = globalThis.showConfirm;
      confirms = [];
      globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
        confirms.push({ title: title, message: message });
        onConfirm();
      };
      CURRICULUM_INDEX = CURRICULUM;
      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
      DashClassManager.openClassManager();
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'competencies' } });
    });

    afterEach(() => {
      globalThis.showConfirm = originalConfirm;
      document.getElementById = originalGetElementById;
      DashClassManager.resetState();
      CURRICULUM_INDEX = null;
    });

    it('shows the toolbar and where the I Can statements appear', () => {
      var html = main.innerHTML;
      ['Select', 'Import / Export', 'Add Folder', 'Add Competency', 'Export Competencies', 'Import From CSV'].forEach(
        function (label) {
          expect(html).toContain(label);
        },
      );
      expect(html).toContain('Printed Reports · first statement');
      expect(html).toContain('BC Curriculum Link');
    });

    it('removes the selected competencies and keeps their scores', () => {
      DashClassManager.handleAction('cmCompSelectStart', { dataset: {} });
      expect(main.innerHTML).toContain('0 Selected');
      expect(main.innerHTML).not.toContain('BC Curriculum Link');
      DashClassManager.handleChange({ dataset: { actionChange: 'cmCompToggle', secid: 'QAP' }, checked: true });
      DashClassManager.handleChange({ dataset: { actionChange: 'cmCompToggle', secid: 'LS' }, checked: true });
      expect(main.innerHTML).toContain('2 Selected');
      DashClassManager.handleAction('cmCompRemoveSelected', { dataset: {} });
      expect(confirms[0].title).toBe('Remove 2 Competencies');
      expect(confirms[0].message).toBe(
        'Remove Questioning and Lab Safety from the class? Their scores are kept, so Re-link can put them back.',
      );
      expect(codes()).toEqual(['PI']);
      expect(getScores(CID).st1).toHaveLength(3);
      expect(
        getRemovedSections(CID).map(function (r) {
          return r.section.id;
        }),
      ).toEqual(['QAP', 'LS']);
    });

    it('reviews a re-link: removed ones come back, edits are kept, nothing doubles', () => {
      DashClassManager.handleAction('cmCompSelectStart', { dataset: {} });
      DashClassManager.handleChange({ dataset: { actionChange: 'cmCompToggle', secid: 'PI' }, checked: true });
      DashClassManager.handleAction('cmCompRemoveSelected', { dataset: {} });
      DashClassManager.handleAction('cmCompSelectDone', { dataset: {} });

      DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
      DashClassManager.handleAction('cmRelinkNext', { dataset: {} });
      var html = main.innerHTML;
      expect(html).toContain('Re-link Curriculum: Review Changes');
      expect(html).toContain('In the Curriculum, Not in Your Class');
      expect(html).toContain('You removed this from the class earlier.');
      expect(html).toContain('Add Back');
      expect(html).toContain('You Changed These');
      expect(html).toContain('Has scores in 2 assessments. Scores stay either way.');
      expect(html).toContain('2 I Can statements (you added 1)');
      expect(html).toContain('Only in Your Class');
      expect(html).toContain('One of your own. Has scores in 1 assessment.');
      // Nothing changes until Apply.
      expect(codes()).toEqual(['QAP', 'LS']);

      DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
      expect(codes().sort()).toEqual(['EM', 'LS', 'PI', 'QAP', 'SC']);
      var map = getLearningMap(CID);
      expect(map.sections.find(s => s.id === 'QAP').tags[0].label).toBe('Questioning');
      expect(map.sections.find(s => s.id === 'PI')).toBeTruthy();
      expect(getRemovedSections(CID)).toHaveLength(0);
    });

    it('uses the curriculum version and removes one of the teacher’s own when picked', () => {
      saveStudents(CID, [{ id: 'st1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' }]);
      DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
      DashClassManager.handleAction('cmRelinkNext', { dataset: {} });
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmCompReviewPick', group: 'changed', idx: '0', pick: 'theirs' },
      });
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmCompReviewPick', group: 'onlyMine', idx: '0', pick: 'remove' },
      });
      expect(main.innerHTML).toContain('use the curriculum version of Questioning');
      // Lab Safety has a score, so removing it moves that student's grade.
      expect(main.innerHTML).toContain('The removals change the grade for 1 of your');
      DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
      var qap = getLearningMap(CID).sections.find(s => s.id === 'QAP').tags[0];
      expect(qap.label).toBe('Question and Predict');
      expect(qap.i_can_statements).toEqual(['I can ask']);
      expect(codes()).not.toContain('LS');
      expect(getScores(CID).st1).toHaveLength(3);
    });

    describe('Re-link asks first when Put Back or Remove would move grades', () => {
      var held;
      function scored() {
        saveStudents(CID, [{ id: 'st1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' }]);
        _cache.assessments[CID] = ['a1', 'a2'].map((id, i) => ({
          id: id,
          title: 'Task ' + (i + 1),
          scoreMode: 'proficiency',
          tagIds: ['QAP', 'LS'],
          type: 'summative',
          date: '2026-10-0' + (i + 1),
        }));
        clearProfCache();
      }
      function relinkHeld() {
        DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
        DashClassManager.handleAction('cmRelinkNext', { dataset: {} });
        held = [];
        globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
          held.push({ title: title, message: message, run: onConfirm });
        };
      }
      function untickNewAdds(from) {
        var adds = (main.innerHTML.match(/data-action-change="cmCompReviewToggle"/g) || []).length;
        for (var i = from; i < adds; i++)
          DashClassManager.handleChange({
            dataset: { actionChange: 'cmCompReviewToggle', idx: String(i) },
            checked: false,
          });
      }

      it('counts a competency put back with its scores', () => {
        scored();
        DashClassManager.handleAction('cmCompSelectStart', { dataset: {} });
        DashClassManager.handleChange({ dataset: { actionChange: 'cmCompToggle', secid: 'QAP' }, checked: true });
        DashClassManager.handleAction('cmCompRemoveSelected', { dataset: {} });
        DashClassManager.handleAction('cmCompSelectDone', { dataset: {} });
        var before = getOverallProficiency(CID, 'st1');
        relinkHeld();
        // Only the put-back stays ticked.
        untickNewAdds(1);
        DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
        expect(held).toHaveLength(1);
        expect(held[0].title).toBe('Change Grades?');
        expect(held[0].message).toContain('1 of your 1 students');
        expect(codes()).not.toContain('QAP');
        expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(before, 10);
        held[0].run();
        expect(codes()).toContain('QAP');
        expect(getOverallProficiency(CID, 'st1')).not.toBeCloseTo(before, 5);
      });

      it('counts a competency removed through the review', () => {
        scored();
        var before = getOverallProficiency(CID, 'st1');
        relinkHeld();
        untickNewAdds(0);
        DashClassManager.handleChange({
          dataset: { actionChange: 'cmCompReviewPick', group: 'onlyMine', idx: '0', pick: 'remove' },
        });
        DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
        expect(held).toHaveLength(1);
        expect(held[0].title).toBe('Change Grades?');
        expect(held[0].message).toContain('1 of your 1 students');
        expect(codes()).toContain('LS');
        expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(before, 10);
        held[0].run();
        expect(codes()).not.toContain('LS');
        expect(getOverallProficiency(CID, 'st1')).not.toBeCloseTo(before, 5);
      });
    });

    it('round-trips the CSV export through the import review without duplicates', () => {
      var csv =
        'Code,Title,Curricular Competency,I Can Statements,Folder\n' +
        '"QAP","Questioning","Demonstrate curiosity","I can ask\nI can wonder",""\n' +
        '"PI","Plan Investigations","Plan an investigation","I can plan",""\n' +
        '"LS","Lab Safety","Work safely","",""\n' +
        '"NEW","Field Notes, Daily","Keep a field journal","I can record ""what I see""","Outdoor"\n';
      var rows = DashClassManager.cmCompRowsFromCsv(csv);
      expect(rows).toHaveLength(4);
      expect(rows[0].icans).toEqual(['I can ask', 'I can wonder']);
      expect(rows[3].label).toBe('Field Notes, Daily');
      expect(rows[3].icans).toEqual(['I can record "what I see"']);
    });
  });
});

describe('cm-empty-state', () => {
  /**
   * Class Settings with no classes: the first screen offers Create a Class
   * and, for a signed-in teacher, Try Demo Mode. Open Demo Mode says
   * what happens before it leaves for /login.html?demo=1, which clears this
   * device's FullVision data. In Demo Mode itself only Create a Class shows.
   */

  var main;
  var originalGetElementById;
  var originalConfirm;
  var originalDemo;
  var originalQueue;
  var confirms;

  function act(action) {
    return DashClassManager.handleAction(action, { dataset: {}, tagName: 'BUTTON' });
  }

  function openEmpty() {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
  }

  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    saveCourses({});
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = id => (id === 'main' ? main : originalGetElementById.call(document, id));
    originalConfirm = globalThis.showConfirm;
    confirms = [];
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirms.push({ title, message, okLabel, onConfirm });
    };
    originalDemo = window.isDemoMode;
    originalQueue = window.v2Queue;
    window.isDemoMode = () => false;
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    globalThis.showConfirm = originalConfirm;
    window.isDemoMode = originalDemo;
    window.v2Queue = originalQueue;
    DashClassManager.resetState();
  });

  describe('the zero-class screen', () => {
    it('offers Create a Class and Try Demo Mode, with a link to the Getting Started Guide', () => {
      openEmpty();
      var html = main.innerHTML;
      expect(html).toContain('No classes yet');
      expect(html).not.toContain('cm-empty-text');
      expect(html).toContain('>Create a Class</h2>');
      expect(html).toContain('Build a class from BC curriculum courses, then add students.');
      expect(html).toMatch(/data-action="cmStartCreate">Create a Class<\/button>/);
      expect(html).toContain('>Try Demo Mode</h2>');
      expect(html).toContain('A sample Science 8 class with 27 students. Nothing is saved to your account.');
      expect(html).toMatch(/data-action="cmOpenDemoMode">Open Demo Mode<\/button>/);
      expect(html).toContain('href="/help/create-a-class">Getting Started Guide</a>');
    });

    it('hides the Demo Mode card in Demo Mode', () => {
      window.isDemoMode = () => true;
      openEmpty();
      var html = main.innerHTML;
      expect(html).toContain('No classes yet');
      expect(html).toContain('data-action="cmStartCreate"');
      expect(html).not.toContain('Try Demo Mode');
      expect(html).not.toContain('cmOpenDemoMode');
    });

    it('Open Demo Mode asks first and says how to come back', () => {
      openEmpty();
      window.v2Queue = { stats: () => ({ queued: 0, deadLettered: 0 }) };
      act('cmOpenDemoMode');
      expect(confirms).toHaveLength(1);
      expect(confirms[0].title).toBe('Open Demo Mode');
      expect(confirms[0].okLabel).toBe('Open Demo Mode');
      expect(confirms[0].message).toContain('clears the FullVision data stored on it.');
      expect(confirms[0].message).toContain('Classes saved to your account are not changed.');
      expect(confirms[0].message).toContain('choose Sign Out in the account menu, then sign in.');
      expect(confirms[0].message).not.toContain('will be lost');
    });

    it('Open Demo Mode names changes not yet sent to the account', () => {
      openEmpty();
      window.v2Queue = { stats: () => ({ queued: 2, deadLettered: 1 }) };
      act('cmOpenDemoMode');
      expect(confirms[0].message).toContain(
        '3 changes on this device have not been sent to your account and will be lost.',
      );
    });
  });
});

describe('cm-import-review', () => {
  /**
   * Import Roster (board: Import Roster canvas, Nov 11 2026). Rows match the
   * roster by student number, then by name: a matched number with a new name
   * is a name change (kept with their scores), a new row is added, and a
   * student the file leaves out is offered for withdrawal, off unless the
   * teacher ticks it. A file whose every column is known goes straight to
   * Ready to Add; any other is checked column by column. Problems never
   * block: the student is added with that field blank. Nothing changes until
   * the teacher adds or saves.
   */

  const CID = 'e0000000-0000-4000-8000-0000000c1a55';

  function student(id, first, last, num) {
    return { id, firstName: first, lastName: last, studentNumber: num, enrolledDate: '2026-09-01' };
  }

  function names() {
    return getStudents(CID)
      .map(function (s) {
        return fullName(s);
      })
      .sort();
  }

  var main;
  var originalGetElementById;

  function openStudents(roster) {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    saveStudents(CID, roster);
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'students' } });
  }

  function importText(text, fileName) {
    DashClassManager.cmStartImport(DashClassManager.rosterImportTable(text), fileName || 'roster.csv');
  }

  function act(action, dataset) {
    DashClassManager.handleAction(action, { dataset: dataset || {} });
  }

  // A MyEd class list: every column known, or left out on purpose.
  const MYED =
    'Legal Surname,Legal First Name,Usual First Name,Pupil #,Grade,Homeroom,Gender,Date of Birth\n' +
    'Bains,Arjun,AJ,1203400,08,D-12,M,2012-04-10\n' +
    'Castillo,Maya,,1203407,08,D-12,F,2012-02-24\n' +
    'Dhillon,Simran,,1203414,08,D-12,F,2012-07-16\n';

  // A teacher's own spreadsheet: headers FullVision doesn't all know, dates
  // month first, a number used twice, a row with no name, a date that isn't
  // real and a column of designation codes.
  const MESSY =
    'Student Name,ID,Birthday,Parent Contact,Block,Notes,IEP\n' +
    '"Bains, Arjun",1203400,5/13/2012,bains.family@gmail.com,B,,\n' +
    '"Castillo, Maya",1203407,5/22/2012,castillo.family@gmail.com,B,,\n' +
    '"Eriksen, Tove",1203421,7/26/2012,eriksen.family@gmail.com,B,,P\n' +
    '"Fontaine, Luc",1203428,Sept 31 2012,fontaine.family@gmail.com,B,,\n' +
    '"Johal, Navdeep",1203456,1/15/2012,johal.family@gmail.com,B,,\n' +
    '"Kowalczyk, Zofia",1203456,1/27/2012,kowalczyk.family@gmail.com,B,sits near front,Q\n' +
    '"",1203498,2/26/2012,patel.family@gmail.com,B,,\n';

  describe('a class with students: What This File Will Change', () => {
    beforeEach(() => {
      openStudents([
        student('s1', 'Fatima', 'Hassan', 'STU-208'),
        student('s2', 'Tyler', 'Rowe', 'STU-215'),
        student('s3', 'Liam', 'Chen', ''),
      ]);
    });

    afterEach(() => {
      document.getElementById = originalGetElementById;
    });

    function importRows(rows) {
      DashClassManager.cmShowImportPreview(rows, 'block-a.csv');
    }

    it('groups the file into new, renamed, missing and unchanged', () => {
      importRows([
        { firstName: 'Fatima', lastName: 'Hassan-Ali', studentNumber: 'STU-208' },
        { firstName: 'Liam', lastName: 'Chen', studentNumber: '' },
        { firstName: 'Noor', lastName: 'Al-Rashid', studentNumber: 'STU-202' },
      ]);
      var html = main.innerHTML;
      expect(html).toContain('What This File Will Change');
      expect(html).toContain('1 new student and 1 new name.');
      expect(html).toContain('New to This Class');
      expect(html).toContain('Noor Al-Rashid');
      expect(html).toContain('Name Changed');
      expect(html).toContain('Fatima Hassan-Ali');
      expect(html).toContain('In Your Class, Not in This File');
      expect(html).toContain('Tyler Rowe');
      expect(html).toContain('Add 1, rename 1.');
      expect(html).toContain('Save Changes');
      // Nothing has changed yet.
      expect(names()).toEqual(['Fatima Hassan', 'Liam Chen', 'Tyler Rowe']);
    });

    it('adds and renames on Save Changes, and withdraws no one unless ticked', () => {
      importRows([
        { firstName: 'Fatima', lastName: 'Hassan-Ali', studentNumber: 'STU-208' },
        { firstName: 'Liam', lastName: 'Chen', studentNumber: '' },
        { firstName: 'Noor', lastName: 'Al-Rashid', studentNumber: 'STU-202' },
      ]);
      act('cmConfirmImport');
      expect(names()).toEqual(['Fatima Hassan-Ali', 'Liam Chen', 'Noor Al-Rashid', 'Tyler Rowe']);
      expect(getStudents(CID).find(s => s.studentNumber === 'STU-208').id).toBe('s1');
      expect(getWithdrawnStudents(CID)).toHaveLength(0);
      expect(main.innerHTML).toContain('Roster Updated');
      expect(main.innerHTML).toContain('1 added, 1 renamed.');
    });

    it('withdraws a missing student the teacher ticks', () => {
      importRows([
        { firstName: 'Fatima', lastName: 'Hassan', studentNumber: 'STU-208' },
        { firstName: 'Liam', lastName: 'Chen', studentNumber: '' },
      ]);
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmImportToggle', kind: 'missing', idx: '0' },
        checked: true,
      });
      act('cmConfirmImport');
      expect(names()).toEqual(['Fatima Hassan', 'Liam Chen']);
      expect(getWithdrawnStudents(CID).map(w => w.student.id)).toEqual(['s2']);
    });

    it('Cancel leaves the roster as it was', () => {
      importRows([{ firstName: 'Noor', lastName: 'Al-Rashid', studentNumber: 'STU-202' }]);
      act('cmCancelImport');
      expect(main.innerHTML).not.toContain('What This File Will Change');
      expect(names()).toEqual(['Fatima Hassan', 'Liam Chen', 'Tyler Rowe']);
    });

    it('opens the drop strip, not a page of rules, from Import Roster', () => {
      act('cmImportRoster');
      var html = main.innerHTML;
      expect(html).toContain('Drop a class list here to update this class');
      expect(html).toContain('matched by student number, so no one is added twice');
      expect(html).toContain('Download Template');
      expect(html).not.toContain('Name columns:');
    });

    it('offers filled-in details for a matched student, old and new side by side, and applies them', () => {
      var table = DashClassManager.rosterImportTable(
        'Student Number,First Name,Last Name,Pronouns,Date of Birth,Designations\nSTU-208,Fatima,Hassan,she/her,2013-07-09,G\n',
      );
      var read = DashClassManager.rosterRowsFromTable(table);
      DashClassManager.cmShowImportPreview(read.rows, 'myed.csv', table, read.skipped);
      var html = main.innerHTML;
      expect(html).toContain('Details Updated');
      expect(html).toContain('Date of Birth <span class="cm-import-old">blank →</span> 2013-07-09');
      expect(html).toContain('Designations + G');
      act('cmConfirmImport');
      var st = getStudents(CID).find(s => s.id === 's1');
      expect(st.pronouns).toBe('she/her');
      expect(st.dateOfBirth).toBe('2013-07-09');
      expect(st.designations).toEqual(['G']);
    });

    it('re-reads the file when a column is matched to a different field', () => {
      var table = DashClassManager.rosterImportTable('First Name,Last Name,Code\nNoor,Al-Rashid,STU-202\n');
      var read = DashClassManager.rosterRowsFromTable(table);
      DashClassManager.cmShowImportPreview(read.rows, 'f.csv', table, read.skipped);
      DashClassManager.handleChange({ dataset: { actionChange: 'cmImportMap', col: '2' }, value: 'studentNumber' });
      act('cmConfirmImport');
      expect(getStudents(CID).find(s => s.firstName === 'Noor').studentNumber).toBe('STU-202');
    });

    it('keeps what was ticked when the file is read again', () => {
      importText('First Name,Last Name,Code\nNoor,Al-Rashid,STU-202\nAva,Lee,STU-203\n');
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmImportToggle', kind: 'added', idx: '0' },
        checked: false,
      });
      act('cmImportPick', { col: '2', field: 'studentNumber' });
      act('cmConfirmImport');
      expect(names()).toEqual(['Ava Lee', 'Fatima Hassan', 'Liam Chen', 'Tyler Rowe']);
    });
  });

  describe('reading the file', () => {
    it('reads columns by header in any order, with quoted commas', () => {
      var table = DashClassManager.rosterImportTable(
        'Student Number,Name,Usual First Name,Birth Date,Parent Email\n' +
          'STU-301,"Okafor, Cecilia",Cece,2012-05-15,n.okafor@example.com\n',
      );
      expect(table.map).toEqual(['studentNumber', 'fullName', 'preferred', 'dateOfBirth', 'parentEmail']);
      var read = DashClassManager.rosterRowsFromTable(table);
      expect(read.rows).toEqual([
        {
          studentNumber: 'STU-301',
          firstName: 'Cecilia',
          lastName: 'Okafor',
          preferred: 'Cece',
          dateOfBirth: '2012-05-15',
          parentEmails: ['n.okafor@example.com'],
        },
      ]);
      expect(read.rows[0].line).toBe(2);
    });

    it('handles CRLF, a BOM, "" inside quotes and tab-separated files', () => {
      expect(DashClassManager.parseRosterCsv('﻿a,"b ""c"", d"\r\n1,2\r\n')).toEqual([
        ['a', 'b "c", d'],
        ['1', '2'],
      ]);
      expect(DashClassManager.parseRosterCsv('First Name\tLast Name\nAva\tLee\n')).toEqual([
        ['First Name', 'Last Name'],
        ['Ava', 'Lee'],
      ]);
    });

    it('falls back to the old fixed column order when there is no header', () => {
      var table = DashClassManager.rosterImportTable('Ava,Lee,,she/her,STU-9,2012-01-02,ava@school.ca\n');
      var read = DashClassManager.rosterRowsFromTable(table);
      expect(read.rows[0]).toMatchObject({
        firstName: 'Ava',
        lastName: 'Lee',
        pronouns: 'she/her',
        studentNumber: 'STU-9',
        dateOfBirth: '2012-01-02',
        email: 'ava@school.ca',
      });
      expect(DashClassManager.rosterImportReady(table)).toBe(false);
    });

    it('keeps known designations and ELL, and lists what it could not read', () => {
      var table = DashClassManager.rosterImportTable(
        'First Name,Last Name,Designations,ELL,DOB,Email\nAva,Lee,Q; ZZ,yes,2012-02-30,not-an-email\n',
      );
      var read = DashClassManager.rosterRowsFromTable(table);
      expect(read.rows[0].designations).toEqual(['Q', 'ELL']);
      expect(read.rows[0].dateOfBirth).toBeUndefined();
      expect(read.skipped).toEqual({ dates: 1, emails: 1, codes: 1 });
      expect(read.problems.map(p => [p.kind, p.line, p.value])).toEqual([
        ['code', 2, 'ZZ'],
        ['date', 2, '2012-02-30'],
        ['email', 2, 'not-an-email'],
      ]);
    });

    it('reads a date column the way its dates show, and asks when every one could go either way', () => {
      expect(DashClassManager.rosterDateOrder(['5/22/2012', '1/3/2012'])).toBe('mdy');
      expect(DashClassManager.rosterDateOrder(['22/5/2012', '1/3/2012'])).toBe('dmy');
      expect(DashClassManager.rosterDateOrder(['5/6/2012', '1/3/2012'])).toBe('ask');
      expect(DashClassManager.rosterDateOrder(['2012-05-06'])).toBe('');
      expect(DashClassManager.rosterDate('1/3/2012', 'mdy')).toBe('2012-01-03');
      expect(DashClassManager.rosterDate('1/3/2012', 'dmy')).toBe('2012-03-01');
      expect(DashClassManager.rosterDate('5/22/12', 'mdy')).toBe('2012-05-22');
      expect(DashClassManager.rosterDate('May 15, 2012')).toBe('2012-05-15');
      expect(DashClassManager.rosterDate('15 May 2012')).toBe('2012-05-15');
      expect(DashClassManager.rosterDate('Sept 30 2012')).toBe('2012-09-30');
      expect(DashClassManager.rosterDate('Sept 31 2012')).toBe('');
      expect(DashClassManager.rosterDate('2012-02-30')).toBe('');

      var table = DashClassManager.rosterImportTable('First Name,DOB\nAva,5/6/2012\nBen,1/3/2012\n');
      expect(table.dateOrder).toEqual(['', 'ask']);
      var read = DashClassManager.rosterRowsFromTable(table);
      expect(read.waiting).toEqual({ 1: 2 });
      expect(read.problems).toEqual([]);
      expect(read.rows[0].dateOfBirth).toBeUndefined();
    });

    it('guesses unknown columns from their values, marks the guesses, and only suggests designations', () => {
      var table = DashClassManager.rosterImportTable(MESSY);
      expect(table.map).toEqual(['fullName', 'studentNumber', 'dateOfBirth', 'parentEmail', '', '', '']);
      expect(table.how).toEqual(['header', 'guess', 'header', 'guess', '', '', '']);
      expect(table.suggest[6]).toBe('designations');
      expect(table.dateOrder[2]).toBe('mdy');
      expect(DashClassManager.rosterImportReady(table)).toBe(false);
      var read = DashClassManager.rosterRowsFromTable(table);
      expect(
        read.rows.some(function (r) {
          return r.designations;
        }),
      ).toBe(false);
      expect(read.rows[0]).toMatchObject({ firstName: 'Arjun', lastName: 'Bains', dateOfBirth: '2012-05-13' });
      expect(read.rows[0].parentEmails).toEqual(['bains.family@gmail.com']);
    });

    it('reports a date that is not real, a number used twice and a row with no name', () => {
      var read = DashClassManager.rosterRowsFromTable(DashClassManager.rosterImportTable(MESSY));
      expect(read.rows).toHaveLength(6);
      expect(read.problems.map(p => [p.kind, p.line])).toEqual([
        ['date', 5],
        ['number', 7],
      ]);
      expect(read.problems[1].other.line).toBe(6);
      var zofia = read.rows.find(r => r.firstName === 'Zofia');
      expect(zofia.studentNumber).toBeUndefined();
      expect(read.unnamed).toEqual([{ line: 8, cells: ['1203498', '2/26/2012', 'patel.family@gmail.com', 'B'] }]);
    });

    it('applies what the teacher types on a row', () => {
      var table = DashClassManager.rosterImportTable(MESSY);
      var read = DashClassManager.rosterRowsFromTable(table, {
        5: { dateOfBirth: '2012-09-30' },
        7: { studentNumber: '1203463' },
        8: { name: 'Patel, Riya' },
      });
      expect(read.problems).toEqual([]);
      expect(read.unnamed).toEqual([]);
      expect(read.rows).toHaveLength(7);
      expect(read.rows.find(r => r.firstName === 'Luc').dateOfBirth).toBe('2012-09-30');
      expect(read.rows.find(r => r.firstName === 'Zofia').studentNumber).toBe('1203463');
      expect(read.rows.find(r => r.firstName === 'Riya')).toMatchObject({
        lastName: 'Patel',
        studentNumber: '1203498',
      });
    });

    it('lets a MyEd class list go straight through, Grade, Homeroom and Gender left out', () => {
      var table = DashClassManager.rosterImportTable(MYED);
      expect(table.myEd).toBe(true);
      expect(DashClassManager.rosterImportReady(table)).toBe(true);
      expect(table.map).toEqual(['lastName', 'firstName', 'preferred', 'studentNumber', '', '', '', 'dateOfBirth']);
      var tmpl = readFileSync('roster-template.csv', 'utf8');
      expect(DashClassManager.rosterImportReady(DashClassManager.rosterImportTable(tmpl))).toBe(true);
    });
  });

  describe('an empty class: the first import', () => {
    beforeEach(() => {
      openStudents([]);
    });

    afterEach(() => {
      document.getElementById = originalGetElementById;
    });

    it('shows where the class list goes, with the MyEd steps, and no page of rules', () => {
      var html = main.innerHTML;
      expect(html).toContain('Add Your Students');
      expect(html).toContain('Get the List From MyEducation BC');
      expect(html).toContain("The file isn't uploaded.");
      expect(html).toContain('Download Template');
      expect(html).not.toContain('data-action="cmImportRoster"');
      expect(html).not.toContain('Name columns:');
    });

    it('takes a MyEd file straight to Ready to Add, then says what was added', () => {
      importText(MYED, 'ScienceD_Roster.csv');
      var html = main.innerHTML;
      expect(html).toContain('Ready to Add 3 Students');
      expect(html).toContain(
        "This is a class list from MyEducation BC. Every column was read, so there's nothing to match.",
      );
      expect(html).toContain('Left out: Grade, Homeroom and Gender.');
      expect(html).not.toContain('cm-import-field-btn');
      expect(html).toContain('Add 3 Students');
      act('cmConfirmImport');
      expect(names()).toEqual(['Arjun Bains', 'Maya Castillo', 'Simran Dhillon']);
      expect(getStudents(CID).find(s => s.firstName === 'Arjun')).toMatchObject({
        preferred: 'AJ',
        studentNumber: '1203400',
      });
      html = main.innerHTML;
      expect(html).toContain('3 Students Added to Science 8');
      expect(html).toContain('Set Up Grading');
      expect(html).toContain('Undo This Import');
      expect(html.match(/cm-rs-new-tag/g)).toHaveLength(3);
      act('cmCloseImportDone');
      expect(main.innerHTML).not.toContain('cm-rs-new-tag');
    });

    it('Change What’s Kept opens the columns of a file that went straight through', () => {
      importText(MYED);
      act('cmImportShowColumns');
      expect(main.innerHTML).toContain('cm-import-field-btn');
      expect(main.innerHTML).toContain('Check How Your File Was Read');
    });

    it('checks any other file column by column, with the rows that need a look', () => {
      importText(MESSY, 'Science 8 Block B.csv');
      var html = main.innerHTML;
      expect(html).toContain('Check How Your File Was Read');
      expect(html).toContain('Best Guess');
      expect(html).toContain('Read as month/day/year: 5/13/2012 can only be May 13.');
      expect(html).toContain('Looks like designations (P and Q). Left out unless you choose.');
      expect(html).toContain('Import as Designations');
      expect(html).toContain('3 Rows Need a Look');
      expect(html).toContain('Luc will be added without a birthday.');
      expect(html).toContain('Student number 1203456 is also Navdeep Johal&#39;s, in row 6.');
      expect(html).toContain('This row has no name, so it will be left out.');
      expect(html).toContain('6 students will be added to Science 8.');
      expect(html).toContain('Row 8 is left out until it has a name.');
      expect(html).toContain('Add 6 Students');
    });

    it('adds a student with the blank, and the Done panel names who to fill in', () => {
      importText(MESSY);
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmImportFix', line: '8', field: 'name' },
        value: 'Patel, Riya',
      });
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmImportFix', line: '5', field: 'dateOfBirth' },
        value: '2012-09-30',
      });
      expect(main.innerHTML).toContain('7 students will be added');
      act('cmConfirmImport');
      expect(getStudents(CID)).toHaveLength(7);
      expect(getStudents(CID).find(s => s.firstName === 'Zofia').studentNumber).toBe('');
      var html = main.innerHTML;
      expect(html).toContain('7 Students Added to Science 8');
      expect(html).toContain('1 has a blank to fill in: Zofia Kowalczyk&#39;s student number.');
      act('cmImportShowBlanks');
      var shown = main.innerHTML.match(/<div class="cm-rs-grid cm-rs-row[^>]*>/g).filter(r => !/ hidden>/.test(r));
      expect(shown).toHaveLength(1);
      expect(main.innerHTML).toContain('Show All Students');
    });

    it('imports designations only when the teacher chooses them', () => {
      importText(MESSY);
      act('cmImportPick', { col: '6', field: 'designations' });
      act('cmConfirmImport');
      expect(getStudents(CID).find(s => s.firstName === 'Tove').designations).toEqual(['P']);
    });

    it('swaps two columns when a field another column uses is chosen', () => {
      importText(MESSY);
      act('cmImportPick', { col: '4', field: 'studentNumber' });
      var html = main.innerHTML;
      expect(html).toContain('aria-label="What Block holds: Student Number"');
      expect(html).toContain('aria-label="What ID holds: Don&#39;t Import"');
    });

    it('asks which comes first when every date could go either way', () => {
      importText('First Name,DOB\nAva,5/6/2012\nBen,1/3/2012\n');
      expect(main.innerHTML).toContain('Which comes first?');
      act('cmImportDateOrder', { col: '1', order: 'dmy' });
      act('cmConfirmImport');
      expect(getStudents(CID).find(s => s.firstName === 'Ava').dateOfBirth).toBe('2012-06-05');
    });

    it('Undo This Import deletes the students it added, except any with something recorded', () => {
      importText(MYED);
      act('cmConfirmImport');
      var ids = getStudents(CID).map(s => s.id);
      var arjun = getStudents(CID).find(s => s.firstName === 'Arjun');
      saveScores(CID, { [arjun.id]: [{ id: 'x1', assessmentId: 'a1', tagId: 'QAP', score: 3 }] });
      act('cmUndoImport');
      expect(names()).toEqual(['Arjun Bains']);
      // Deleted for good: not left in the Withdrawn list.
      expect(getWithdrawnStudents(CID).filter(w => ids.includes(w.student.id))).toHaveLength(0);
      var html = main.innerHTML;
      expect(html).toContain('Import Undone');
      expect(html).toContain('2 students were removed. Arjun Bains stays: they already have scores or observations.');
      expect(html).not.toContain('Undo This Import');
    });

    it('says when a file is an Excel file, or has no names', () => {
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmCSV' },
        files: [{ name: 'Roster.xlsx' }],
        value: '',
      });
      expect(main.innerHTML).toContain('This Is an Excel File');
      importText('Pupil,Unit 1,Unit 2\n1203400,3,4\n1203407,2,3\n', 'Term 1 Marks.csv');
      expect(main.innerHTML).toContain('No Names Found');
      act('cmImportChooseNames');
      expect(main.innerHTML).toContain('Names</strong> · choose the column that holds them');
      expect(main.innerHTML).toMatch(/data-action="cmConfirmImport" disabled/);
    });
  });
});

describe('cm-list-card-bank', () => {
  /**
   * Class Settings' competency list and card for a class built from the
   * rebuilt bank (curriculum bank stage 4, PR 5): competencies outside
   * folders sit in Ministry order among the folders, each row shows its
   * wording's first line, and the card's source line names the course and
   * the Ministry's headings. A competency with no I Can statements says what
   * reports print.
   */

  const CID = 'e0000000-0000-4000-8000-0000000da710';
  var main;
  var originalGetElementById;
  var originalScrollTo;

  function setUpClass(keys) {
    CURRICULUM_INDEX = newBankIndex(keys);
    var map = buildLearningMapFromTags(keys);
    saveCourses({ [CID]: { id: CID, name: keys.join(' + '), gradingSystem: 'proficiency', curriculumTags: keys } });
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    _cache.learningMaps[CID] = map;
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [];
    _cache.scores[CID] = {};
    _cache.statuses[CID] = {};
    saveStudents(CID, []);
  }

  function openTab() {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'competencies' } });
  }

  function sectionByCode(code) {
    return getLearningMap(CID).sections.find(s => s.tags[0].code === code);
  }

  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    originalScrollTo = window.scrollTo;
    window.scrollTo = function () {};
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    window.scrollTo = originalScrollTo;
    DashClassManager.resetState();
    CURRICULUM_INDEX = null;
  });

  describe('the list', () => {
    it('puts Understanding Context before the first folder, with no Ungrouped section', () => {
      setUpClass(['DRAFT10']);
      openTab();
      var html = main.innerHTML;
      var uc1 = html.indexOf('Empathetic Research');
      var defining = html.indexOf('value="Defining"');
      expect(uc1).toBeGreaterThan(0);
      expect(uc1).toBeLessThan(defining);
      expect(html).not.toContain('>Ungrouped<');
      // The run outside folders is still a drop target for "no folder".
      expect(html).toMatch(/class="mod-folder no-module open cm-loose-run" data-folder-drop="__none__"/);
    });

    it('keeps the Ungrouped drop target when every competency is in a folder', () => {
      setUpClass(['DRAFT10']);
      var map = getLearningMap(CID);
      map.sections.find(s => !s.groupId).groupId = map.competencyGroups[0].id;
      openTab();
      expect(main.innerHTML).toContain('>Ungrouped<');
      expect(main.innerHTML).toContain('Every competency is in a folder');
    });

    it('lists SS competencies in order after the ELA folders in Humanities 8', () => {
      setUpClass(['ELA8', 'SS8']);
      openTab();
      var html = main.innerHTML;
      expect(html.indexOf('value="Create and Communicate"')).toBeLessThan(html.indexOf('Ethical Judgment'));
      expect(html).not.toContain('>Ungrouped<');
    });

    it('shows each competency’s wording under its name', () => {
      setUpClass(['DRAFT10']);
      openTab();
      expect(main.innerHTML).toContain(
        '<span class="cm-std-line">Prototype, making changes to tools, materials, and procedures as needed</span>',
      );
    });
  });

  describe('the card', () => {
    it('names the course and the Ministry headings in its source line', () => {
      setUpClass(['DRAFT10']);
      openTab();
      DashClassManager.handleAction('cmToggleStdCard', { dataset: { secid: sectionByCode('PR3').id } });
      expect(main.innerHTML).toContain(
        '<span class="cm-std-source">BC Curriculum · Drafting 10 · Applied Design › Prototyping</span>',
      );
    });

    it('says reports print nothing while a competency has no I Can statements', () => {
      setUpClass(['DRAFT10']);
      // Every bank course now has I Can statements, so clear them here.
      getLearningMap(CID).sections.forEach(sec =>
        sec.tags.forEach(tag => {
          tag.i_can_statements = [];
          tag.text = '';
        }),
      );
      openTab();
      expect(main.innerHTML).toContain(
        'No I Can statements yet. Reports print nothing for this competency until you add one.',
      );
      expect(main.innerHTML).not.toContain('Printed Reports · first statement');
    });

    it('keeps Shown In for a competency with I Can statements', () => {
      setUpClass(['SS8']);
      openTab();
      expect(main.innerHTML).toContain('Printed Reports · first statement');
      expect(main.innerHTML).toContain('<span class="cm-std-source">BC Curriculum · Social Studies 8</span>');
    });

    it('keeps the old source line for a competency with no bank id', () => {
      setUpClass(['DRAFT10']);
      var sec = sectionByCode('PR3');
      delete sec.tags[0].bank_id;
      sec.name = 'Applied Design';
      openTab();
      expect(main.innerHTML).toContain('<span class="cm-std-source">BC Curriculum · Applied Design</span>');
    });
  });
});

describe('cm-student-page-my-learning', () => {
  /**
   * Class Settings › Student Page: Show My Learning and See What They'd See
   * (S13-F1, docs/plans/student-page-build-plan.md; board "Teacher: Class
   * Settings, Student Page").
   *
   * - In Demo Mode the row is kept in the class's settings
   *   (courseConfig.show_my_learning, what the screens read), through
   *   setCourseFeedbackOptions. A signed-in class has it where Reflect on
   *   Feedback is (tests/cm-student-page-show-my-learning.test.js); one the
   *   server keeps no student-page rows for does not, and nothing is asked
   *   of the server.
   * - Off until turned on. Off, the My Learning tab in Preview as Student
   *   shows nothing of a grade; on, it shows My Learning.
   * - See What They'd See opens Preview as Student on My Learning for the
   *   student chosen under Preview as Student, as it would be with the switch
   *   on, and saves nothing.
   */

  const CID = 'ml-class';
  const S1 = 'ml-jordan';
  const S2 = 'ml-avery';
  const SECRET = /DRAFT-SECRET/;
  const HELD = { student_page_enabled: true, return_grades: 'on_return' };

  const piece = (id, title, date) => ({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: ['t1'] });
  const ASSESSMENTS = [piece('essay', 'Returned Essay', '2026-10-01'), piece('poster', 'Draft Poster', '2026-10-05')];
  const cell = (comment, level) => ({
    score: { value: null, modifier: 0, comment, status: null },
    tag_scores: [{ tag_id: 't1', value: level, modifier: 0, comment: null }],
    rubric_scores: [],
  });

  let doc;
  let stub;
  let original;

  function seed(config, gradingSystem) {
    localStorage.clear();
    clearClass(CID);
    const assessments = structuredClone(ASSESSMENTS);
    const cells = {
      [S1]: { essay: cell('Well done.', 3), poster: cell('DRAFT-SECRET poster', 1) },
    };
    seedClass(CID, {
      students: [
        { id: S1, firstName: 'Jordan', lastName: 'Reyes' },
        { id: S2, firstName: 'Avery', lastName: 'Kim' },
      ],
      assessments,
      scores: _gradebookCellsToScoreCache(CID, assessments, cells).scores,
      learningMaps: { sections: [{ id: 'sec1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] }] },
      courseConfigs: config === undefined ? structuredClone(HELD) : config,
      gradeReturns: {
        essay: { [S1]: { is_draft: false, returned_at: '2026-11-03T18:00:00Z' } },
        poster: { [S1]: { is_draft: true } },
      },
    });
    COURSES[CID] = {
      id: CID,
      name: 'Socials 10',
      block: 'C',
      gradingSystem: gradingSystem || 'both',
      gradeLevel: '10',
    };
    delete _returnedSets[CID];
    clearProfCache();
  }

  function openSettings() {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager('student-page');
  }
  const overlay = () => doc.getElementById('preview-student');
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const row = () => doc.querySelector('.sp-learning');
  const saved = () => JSON.parse(localStorage.getItem('gb-courseconfig-' + CID) || '{}');
  function click(target) {
    target.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
  }
  function turn(on) {
    const sw = doc.getElementById('sp-learning-switch');
    expect(sw).toBeTruthy();
    sw.checked = on;
    return DashClassManager.handleChange(sw);
  }
  // The My Learning tab inside the device, as the student presses it.
  function pressMyLearning() {
    const tab = overlay().querySelector('.ps-screen .sp-tabs-bottom [data-act="tab"][data-tab="learning"]');
    expect(tab).toBeTruthy();
    click(tab);
    return overlay().querySelector('.ps-screen');
  }
  function pick(select, value) {
    [...select.querySelectorAll('option')].forEach(o => {
      if (o.getAttribute('value') === value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
    stub = globalThis.document;
    const dom = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    );
    doc = dom.document;
    let active = null;
    Object.defineProperty(doc, 'activeElement', {
      configurable: true,
      get: () => (active && active.isConnected ? active : doc.body),
    });
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
    proto.focus = function () {
      active = this;
    };
    if (!proto.scrollIntoView) proto.scrollIntoView = function () {};
    globalThis.document = doc;
    globalThis.CSS = globalThis.CSS || { escape: s => String(s) };
    original = {
      setUrl: Router.setUrl,
      getSupabase: globalThis.getSupabase,
      useSupabase: _useSupabase,
      isDemoMode: window.isDemoMode,
    };
    Router.setUrl = () => {};
    window.isDemoMode = () => true;
    _useSupabase = false;
    seed();
  });
  afterEach(() => {
    PreviewStudent.close();
    DashClassManager.resetState();
    CmStudentPage._reset();
    Router.setUrl = original.setUrl;
    globalThis.getSupabase = original.getSupabase;
    _useSupabase = original.useSupabase;
    window.isDemoMode = original.isDemoMode;
    globalThis.document = stub;
    clearClass(CID);
    vi.useRealTimers();
  });

  describe('Show My Learning', () => {
    it('is off at first, in the board’s words', () => {
      openSettings();
      const r = row();
      expect(r).toBeTruthy();
      // After Return Grades, Send Work and Reflect on Feedback (S10 follow-up),
      // inside the Student Page card, before Questionnaires and Reports.
      expect([...doc.querySelectorAll('.sp-card .sp-row-title')].map(text)).toEqual([
        'Return Grades',
        'Send Work',
        'Reflect on Feedback',
        'Show My Learning',
        'Questionnaires and Reports',
      ]);
      expect(text(r.querySelector('label[for="sp-learning-switch"]'))).toBe('Show My Learning');
      expect(text(r.querySelector('#sp-learning-hint'))).toBe(
        'Students see their skills, their grade and how it changes over the term.',
      );
      expect(text(r.querySelector('#sp-learning-would'))).toBe(
        "Students would see their level on each skill and their grade in this class’s grading style (Both), only from work you've returned.",
      );
      // Students' own devices show it (S13-W2): no line says they can't.
      expect(r.querySelector('#sp-learning-device')).toBeNull();
      expect(text(r.querySelector('#sp-learning-see'))).toBe("See What They'd See");
      const sw = r.querySelector('#sp-learning-switch');
      expect(sw.getAttribute('role')).toBe('switch');
      expect(sw.hasAttribute('checked')).toBe(false);
      expect(CmStudentPage.learningSettings(CID)).toEqual({ offered: true, on: false });
      expect(StudentView.learningOn(CID)).toBe(false);
    });

    it('names the class’s own grading style', () => {
      seed(undefined, 'letter');
      openSettings();
      expect(text(row().querySelector('#sp-learning-would'))).toContain('grading style (Letter),');
      seed(undefined, 'proficiency');
      openSettings();
      expect(text(row().querySelector('#sp-learning-would'))).toContain('grading style (Proficiency),');
    });

    it('turned on, it is kept in the class’s settings, which is what the screens read; off again, it is off', () => {
      openSettings();
      expect(turn(true)).toBe(true);
      expect(getCourseConfig(CID).show_my_learning).toBe(true);
      expect(saved().show_my_learning).toBe(true);
      expect(StudentView.learningOn(CID)).toBe(true);
      expect(doc.getElementById('sp-learning-switch').hasAttribute('checked')).toBe(true);
      expect(doc.activeElement.id).toBe('sp-learning-switch');
      // Nothing else of the class's settings changed.
      expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
      expect(GradeState.stateOf(CID, S1, 'poster')).toBe(GradeState.DRAFT);
      turn(false);
      expect(saved().show_my_learning).toBe(false);
      expect(StudentView.learningOn(CID)).toBe(false);
    });

    it('off, the My Learning tab in Preview as Student shows nothing of a grade', () => {
      openSettings();
      DashClassManager.handleAction('spPreview', doc.getElementById('sp-preview-open'));
      const screen = pressMyLearning();
      expect(text(screen)).toContain('Your teacher hasn’t turned on My Learning for this class.');
      expect(screen.querySelector('.sp-ml')).toBeNull();
      expect(text(screen)).not.toMatch(/Proficient|Developing|Emerging|Extending|%/);
      expect(text(overlay().querySelector('#ps-sees-title').parentNode)).not.toContain('My Learning');
    });

    it('on, Preview as Student shows My Learning, from returned work only', () => {
      openSettings();
      turn(true);
      const select = doc.getElementById('sp-preview-student');
      pick(select, S1);
      DashClassManager.handleChange(select);
      DashClassManager.handleAction('spPreview', doc.getElementById('sp-preview-open'));
      const screen = pressMyLearning();
      expect(screen.querySelector('.sp-ml')).toBeTruthy();
      expect(text(screen.querySelector('.sp-ml-title'))).toBe('My Learning');
      expect(text(screen)).toContain('Questioning');
      expect(overlay().innerHTML).not.toMatch(SECRET);
      expect(text(overlay().querySelector('#ps-sees-title').parentNode)).toContain('My Learning');
    });

    it('a stray change where the row is not drawn saves nothing', () => {
      seed({});
      expect(CmStudentPage.learningSettings(CID)).toEqual({ offered: false, on: false });
      expect(CmStudentPage.render(CID)).toBe('');
      const at = {
        checked: true,
        dataset: { actionChange: 'spShowLearning' },
        closest: () => ({ dataset: { cid: CID } }),
      };
      CmStudentPage.handleChange(at);
      expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
      expect(saved().show_my_learning).toBeUndefined();
    });
  });

  describe('a signed-in teacher', () => {
    it('with the build switch off, the class is unchanged: no tab, nothing saved, nothing sent', () => {
      window.isDemoMode = () => false;
      const session = signIn();
      try {
        seed({});
        expect(CmStudentPage.isShown(CID)).toBe(false);
        expect(CmStudentPage.render(CID)).toBe('');
        expect(CmStudentPage.learningSettings(CID).offered).toBe(false);
        const at = {
          checked: true,
          dataset: { actionChange: 'spShowLearning' },
          closest: () => ({ dataset: { cid: CID } }),
        };
        CmStudentPage.handleChange(at);
        CmStudentPage.handleAction('spSeeLearning', at);
        expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
        expect(overlay()).toBeNull();
        expect(session.sent()).toEqual([]);
      } finally {
        session.signOut();
      }
    });

    it('with the student page on but a class the server keeps no student-page rows for, has no Show My Learning row and nothing is sent', () => {
      window.isDemoMode = () => false;
      const session = signIn();
      serverSaysStudentPageOn(CID);
      try {
        seed(HELD);
        expect(getReturnSettings(CID).student_page).toBe(true);
        const drawn = CmStudentPage.render(CID);
        expect(drawn).toContain('Return Grades');
        expect(drawn).not.toContain('Show My Learning');
        expect(drawn).not.toContain('See What They');
        expect(session.sent().filter(c => /show_my_learning/.test(JSON.stringify(c)))).toEqual([]);
      } finally {
        serverSaysStudentPageOn(CID, false);
        session.signOut();
      }
    });
  });

  describe("See What They'd See", () => {
    it('opens Preview as Student on My Learning for the student chosen, as it would be on, and saves nothing', () => {
      openSettings();
      const select = doc.getElementById('sp-preview-student');
      pick(select, S1);
      DashClassManager.handleChange(select);
      const before = localStorage.getItem('gb-courseconfig-' + CID);
      const see = doc.getElementById('sp-learning-see');
      expect(DashClassManager.handleAction('spSeeLearning', see)).toBe(true);
      const el = overlay();
      expect(el).toBeTruthy();
      expect(text(el.querySelector('#ps-title'))).toBe('Previewing as Jordan Reyes');
      const screen = el.querySelector('.ps-screen');
      // On the My Learning tab, drawn as with the switch on.
      expect(screen.querySelector('.sp-tabs-bottom .sp-tab-on')).toBeTruthy();
      expect(text(screen.querySelector('.sp-tabs-bottom .sp-tab-on'))).toBe('My Learning');
      expect(screen.querySelector('.sp-ml')).toBeTruthy();
      expect(text(screen)).toContain('Questioning');
      expect(el.innerHTML).not.toMatch(SECRET);
      expect(text(el.querySelector('#ps-sees-title').parentNode)).toContain('My Learning');
      // A press inside keeps My Learning shown (Assignments, then back).
      click(screen.querySelector('.sp-tabs-bottom [data-act="tab"][data-tab="assignments"]'));
      expect(pressMyLearning().querySelector('.sp-ml')).toBeTruthy();
      // The class is still off: nothing saved, and every other screen reads it as it is.
      expect(StudentView.learningOn(CID)).toBe(false);
      expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
      expect(localStorage.getItem('gb-courseconfig-' + CID)).toBe(before);
      expect(StudentView.fromCache(CID, S1).view.learning).toBeNull();
      // Closed, the focus goes back to See What They'd See.
      click(el.querySelector('[data-ps-close]'));
      expect(overlay()).toBeNull();
      expect(doc.activeElement.id).toBe('sp-learning-see');
      // Open Preview afterwards shows the class as it is: off.
      DashClassManager.handleAction('spPreview', doc.getElementById('sp-preview-open'));
      expect(pressMyLearning().querySelector('.sp-ml')).toBeNull();
    });

    it('opens the first student by last name when none has been chosen', () => {
      openSettings();
      DashClassManager.handleAction('spSeeLearning', doc.getElementById('sp-learning-see'));
      expect(text(overlay().querySelector('#ps-title'))).toBe('Previewing as Avery Kim');
    });

    it('sends nothing', () => {
      const calls = [];
      globalThis.getSupabase = () => ({
        rpc(name) {
          calls.push(name);
          return Promise.resolve({ data: null, error: null });
        },
        from(table) {
          calls.push('from:' + table);
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      });
      openSettings();
      turn(true);
      turn(false);
      DashClassManager.handleAction('spSeeLearning', doc.getElementById('sp-learning-see'));
      pressMyLearning();
      expect(calls).toEqual([]);
    });
  });
});

describe('cm-student-page-reflect', () => {
  /**
   * Class Settings › Student Page: the Reflect on Feedback switch (S10
   * follow-up; board "Teacher: Class Settings, Student Page", which draws it
   * between Send Work and Show My Learning).
   *
   * - Demo Mode first, as Show My Learning (PR 1054): the row is drawn in
   *   Demo Mode and signed-in classes, with the class's build switch on, and written only
   *   through setCourseFeedbackOptions (shared/data.js, PR 1067), which keeps
   *   courseConfig.reflect_on_feedback and sends nothing in Demo Mode. A
   *   signed-in class has the row once the server keeps its rows (S10-W1).
   * - Off until turned on. Off, none of the reflection screens shows
   *   anything; on, Demo Mode's sample shows Jordan's question and a student
   *   can reflect on returned work.
   */

  const CID = 'sci8';
  const LAB = 'sci8a1';
  const JORDAN = 'st10';
  const CECE = 'st1';
  const HINT =
    'After you return work, students can say if it made sense, ask you a question and make a plan for next time.';

  let doc;
  let stub;
  let original;
  let fetches;

  function seedDemo({ on = true } = {}) {
    window.isDemoMode = () => true;
    Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
    localStorage.clear();
    CURRICULUM_INDEX = newBankIndex(['SCI8']);
    seedIfNeeded();
    if (on) setStudentPageSwitch(CID, true, 'on_return');
  }

  function openSettings() {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager('student-page', CID);
  }
  const html = () => doc.getElementById('main').innerHTML;
  const sw = () => doc.getElementById('sp-reflect-switch');
  async function turn(on) {
    const el = sw();
    expect(el).toBeTruthy();
    el.checked = on;
    expect(DashClassManager.handleChange(el)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeAll(() => {
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  });
  afterAll(() => {
    CURRICULUM_INDEX = null;
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
    stub = globalThis.document;
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    ).document;
    let active = null;
    Object.defineProperty(doc, 'activeElement', {
      configurable: true,
      get: () => (active && active.isConnected ? active : doc.body),
    });
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
    proto.focus = function () {
      active = this;
    };
    globalThis.document = doc;
    globalThis.CSS = globalThis.CSS || { escape: s => String(s) };
    original = {
      setUrl: Router.setUrl,
      isDemoMode: window.isDemoMode,
      useSupabase: _useSupabase,
      fetch: globalThis.fetch,
    };
    Router.setUrl = () => {};
    _useSupabase = false;
    fetches = [];
    globalThis.fetch = (...args) => {
      fetches.push(String(args[0]));
      return Promise.reject(new Error('no server in this test'));
    };
    seedDemo();
  });

  afterEach(() => {
    expect(fetches).toEqual([]);
    DashClassManager.resetState();
    CmStudentPage._reset();
    Router.setUrl = original.setUrl;
    window.isDemoMode = original.isDemoMode;
    _useSupabase = original.useSupabase;
    globalThis.fetch = original.fetch;
    globalThis.document = stub;
    Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
    localStorage.clear();
    vi.useRealTimers();
  });

  describe('Reflect on Feedback in Class Settings › Student Page', () => {
    it('is off at first, in the board’s words, between Send Work and Show My Learning', () => {
      openSettings();
      expect([...doc.querySelectorAll('.sp-card .sp-row-title')].map(el => el.textContent)).toEqual([
        'Return Grades',
        'Send Work',
        // The sample class has photos, so Keep Photos Until shows with Send Work off (ruling 108's follow-up).
        'Keep Photos Until',
        'Reflect on Feedback',
        'Show My Learning',
        'Questionnaires and Reports',
      ]);
      expect(doc.querySelector('label[for="sp-reflect-switch"]').textContent).toBe('Reflect on Feedback');
      expect(doc.getElementById('sp-reflect-hint').textContent).toBe(HINT);
      expect(sw().hasAttribute('checked')).toBe(false);
      expect(sw().getAttribute('role')).toBe('switch');
      expect(sw().getAttribute('aria-describedby')).toBe('sp-reflect-hint');
      expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: true, on: false });
      expect(getReflectOnFeedback(CID)).toBe(false);
    });

    it('off: none of the reflection screens shows anything', () => {
      openSettings();
      expect(getQuestionsWaiting(CID)).toEqual([]);
      expect(DashOverview.questionsCardHtml(CID)).toBe('');
      expect(getStudentReflections(CID, JORDAN)).toEqual([]);
      expect(getStudentFeedback(CID, CECE).reflect_on_feedback).toBe(false);
      expect(StudentView.fromCache(CID, CECE).view.reflectOn).toBe(false);
      expect(sendStudentReflection(CID, CECE, LAB, { makes_sense: 'yes', plan: 'Label it.' }, CECE)).toEqual({
        ok: false,
        error: 'reflect_off',
      });
    });

    it('turned on, it is kept in the class’s settings; Jordan’s question shows and a student can reflect', async () => {
      openSettings();
      const before = Object.assign({}, getCourseConfig(CID));
      await turn(true);
      expect(getCourseConfig(CID)).toEqual(Object.assign({}, before, { reflect_on_feedback: true }));
      expect(getReflectOnFeedback(CID)).toBe(true);
      expect(sw().hasAttribute('checked')).toBe(true);
      expect(doc.activeElement).toBe(sw());
      // The teacher's screens.
      expect(getQuestionsWaiting(CID).map(r => r.enrollment_id)).toEqual([JORDAN]);
      expect(DashOverview.questionsCardHtml(CID)).toContain('How do I know which cell is which?');
      // The student's: Reflect on Feedback on returned work, in Preview as Student and on their page.
      expect(StudentView.fromCache(CID, CECE).view.reflectOn).toBe(true);
      expect(getStudentFeedback(CID, CECE).reflect_on_feedback).toBe(true);
      expect(sendStudentReflection(CID, CECE, LAB, { makes_sense: 'yes', plan: 'Label it.' }, CECE).ok).toBe(true);
      // Off again.
      await turn(false);
      expect(getReflectOnFeedback(CID)).toBe(false);
      expect(getQuestionsWaiting(CID)).toEqual([]);
      expect(sw().hasAttribute('checked')).toBe(false);
    });

    it('a change made while Class Settings has closed is kept, and nothing is drawn', async () => {
      openSettings();
      const el = sw();
      el.checked = true;
      DashClassManager.handleChange(el);
      DashClassManager.closeClassManager();
      doc.getElementById('main').innerHTML = '<p>Elsewhere</p>';
      await Promise.resolve();
      await Promise.resolve();
      expect(getReflectOnFeedback(CID)).toBe(true);
      expect(html()).toBe('<p>Elsewhere</p>');
    });

    it('an answer that comes once Class Settings is on another class draws nothing there', async () => {
      openSettings();
      const el = sw();
      el.checked = true;
      DashClassManager.handleChange(el);
      // Class Settings now asks the tab about another class, as it does when it draws one.
      CmStudentPage.isShown('another-class');
      doc.getElementById('main').innerHTML = '<p>Another class</p>';
      await Promise.resolve();
      await Promise.resolve();
      expect(getReflectOnFeedback(CID)).toBe(true);
      expect(html()).toBe('<p>Another class</p>');
    });

    it('with the build switch off there is no row, and a stray change saves nothing', () => {
      seedDemo({ on: false });
      expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: false, on: false });
      const box = { dataset: { cid: CID } };
      const stray = {
        checked: true,
        dataset: { actionChange: 'spReflect' },
        closest: s => (s === '[data-cid]' ? box : null),
      };
      CmStudentPage.handleChange(stray);
      expect((getCourseConfig(CID) || {}).reflect_on_feedback).toBeUndefined();
    });

    it('a signed-in class has the row once the server keeps its rows, as the server holds it; any other has none', () => {
      window.isDemoMode = () => false;
      openSettings();
      expect(html()).not.toContain('sp-reflect');
      expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: false, on: false });
      const was = { live: globalThis.studentWorkLive, options: globalThis.getCourseFeedbackOptions };
      globalThis.studentWorkLive = () => true;
      globalThis.getCourseFeedbackOptions = () => ({ reflect_on_feedback: true, show_my_learning: false });
      try {
        openSettings();
        expect(html()).toContain('sp-reflect');
        expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: true, on: true });
        expect(doc.getElementById('sp-reflect-switch').hasAttribute('checked')).toBe(true);
      } finally {
        globalThis.studentWorkLive = was.live;
        globalThis.getCourseFeedbackOptions = was.options;
      }
    });
  });
});

describe('cm-student-page-send-work', () => {
  /**
   * Class Settings › Student Page: Send Work and Keep Photos Until (S5-F1,
   * docs/plans/student-page-build-plan.md; board "Teacher: Class Settings,
   * Student Page").
   *
   * - Demo Mode first: the rows are drawn in Demo Mode only, and kept with
   *   its student work (saveDemoStudentWork). A signed-in teacher's class
   *   does not have them (Batch B is not applied) and nothing is asked of
   *   the server.
   * - The line under Keep Photos Until and Delete Photos Now? are Colin's
   *   (ruling 102, s8-f1-wording-draft.md item 1).
   * - Send Work is off until turned on; Keep Photos Until shows only while
   *   it is on, End of Year by default with End of Term offered (Colin).
   * - With the student page off there is no tab, so neither row.
   */

  const CID = 'c-sw';
  const HELD = { student_page_enabled: true, return_grades: 'on_return' };

  describe('Class Settings › Student Page: Send Work', () => {
    var mounts;
    var original;
    var confirms;

    function seed(config) {
      clearClass(CID);
      seedClass(CID, {
        students: [{ id: 's1', firstName: 'Jordan', lastName: 'Reyes' }],
        assessments: [],
        courseConfigs: config,
      });
    }
    function open() {
      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
      DashClassManager.openClassManager('student-page');
    }
    const html = () => mounts.main.innerHTML;
    const card = { dataset: { cid: CID } };
    const at = extra => Object.assign({ closest: sel => (sel === '[data-cid]' ? card : null) }, extra);
    const turn = on => DashClassManager.handleChange(at({ checked: on, dataset: { actionChange: 'spSendWork' } }));
    const keep = value => DashClassManager.handleAction('spKeepPhotos', at({ tagName: 'BUTTON', dataset: { value } }));

    beforeEach(() => {
      localStorage.clear();
      mounts = {
        main: { innerHTML: '' },
        'sidebar-mount': { innerHTML: '', style: {}, removeAttribute() {} },
        'page-toolbar-mount': { innerHTML: '' },
      };
      original = {
        getElementById: document.getElementById,
        setUrl: Router.setUrl,
        pathname: location.pathname,
        useSupabase: _useSupabase,
        isDemoMode: window.isDemoMode,
        showConfirm: globalThis.showConfirm,
      };
      window.isDemoMode = () => true;
      confirms = [];
      globalThis.showConfirm = (title, message, okLabel, okStyle, onConfirm) =>
        confirms.push({ title, message, okLabel, okStyle, onConfirm });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-11T18:00:00.000Z'));
      document.getElementById = id => mounts[id] || original.getElementById(id);
      Router.setUrl = () => {};
      location.pathname = '/dashboard';
      _useSupabase = false;
      seed(HELD);
    });

    afterEach(() => {
      DashClassManager.resetState();
      document.getElementById = original.getElementById;
      Router.setUrl = original.setUrl;
      location.pathname = original.pathname;
      _useSupabase = original.useSupabase;
      window.isDemoMode = original.isDemoMode;
      globalThis.showConfirm = original.showConfirm;
      vi.useRealTimers();
      clearClass(CID);
    });

    const work = () => JSON.parse(localStorage.getItem('gb-student-work-' + CID));

    it('is off at first, in the board’s words, and Keep Photos Until waits for it', () => {
      open();
      expect(html()).toContain('<label class="sp-row-title" for="sp-send-switch">Send Work</label>');
      expect(html()).toContain(
        '<span class="cm-hint" id="sp-send-hint">Students send photos or files for an assignment you set to take student work.</span>',
      );
      expect(html()).toMatch(/id="sp-send-switch" data-action-change="spSendWork" aria-describedby="sp-send-hint">/);
      expect(html()).not.toContain('Keep Photos Until');
      expect(CmStudentPage.workSettings(CID)).toEqual({
        offered: true,
        send_work: false,
        keep_photos_until: 'end_of_year',
      });
    });

    it('turned on, it is saved and Keep Photos Until shows, End of Year chosen', () => {
      open();
      expect(turn(true)).toBe(true);
      expect(getCourseSendWork(CID).send_work).toBe(true);
      expect(work().course.send_work).toBe(true);
      expect(html()).toMatch(/id="sp-send-switch"[^>]* checked>/);
      expect(html()).toContain('<div class="sp-row-title sp-keep-title" id="sp-keep-label">Keep Photos Until</div>');
      const choices = [
        ...html().matchAll(/id="sp-keep-(\w+)" role="radio" aria-checked="(true|false)"[^>]*>([^<]+)</g),
      ];
      expect(choices.map(m => [m[1], m[2], m[3]])).toEqual([
        ['end_of_term', 'false', 'End of Term'],
        ['end_of_year', 'true', 'End of Year'],
      ]);
      expect(html()).toContain(
        '<div class="cm-hint" id="sp-keep-hint">Photos of student work in this class are deleted on June 30. Grades, comments and Mark Up stay. Deleted photos can&#39;t come back. You&#39;ll get a reminder a week before.</div>',
      );
      // The Return Grades choice is untouched.
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
    });

    it('End of Term is kept, and stays when Send Work is turned off and on again', () => {
      open();
      turn(true);
      expect(keep('end_of_term')).toBe(true);
      expect(CmStudentPage.workSettings(CID).keep_photos_until).toBe('end_of_term');
      turn(false);
      expect(CmStudentPage.workSettings(CID).send_work).toBe(false);
      expect(html()).not.toContain('Keep Photos Until');
      // Not changeable while Send Work is off.
      keep('end_of_year');
      expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
      turn(true);
      expect(html()).toMatch(/id="sp-keep-end_of_term" role="radio" aria-checked="true"/);
      // Anything but the two choices is ignored.
      keep('forever');
      expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
    });

    it('with the student page off there is nothing, and a stray change saves nothing', () => {
      seed({});
      saveDemoStudentWork(CID, { course: { send_work: true } });
      expect(CmStudentPage.workSettings(CID)).toEqual({
        offered: false,
        send_work: false,
        keep_photos_until: 'end_of_year',
      });
      expect(CmStudentPage.render(CID)).toBe('');
      const before = localStorage.getItem('gb-student-work-' + CID);
      CmStudentPage.handleChange(at({ checked: false, dataset: { actionChange: 'spSendWork' } }));
      expect(localStorage.getItem('gb-student-work-' + CID)).toBe(before);
    });

    it('a signed-in teacher has neither row and nothing is sent, even with Send Work on this device', () => {
      saveDemoStudentWork(CID, { course: { send_work: true } });
      window.isDemoMode = () => false;
      const session = signIn();
      serverSaysStudentPageOn(CID);
      try {
        seed(HELD);
        expect(getReturnSettings(CID).student_page).toBe(true);
        expect(CmStudentPage.workSettings(CID).offered).toBe(false);
        expect(CmStudentPage.workSettings(CID).send_work).toBe(false);
        const drawn = CmStudentPage.render(CID);
        expect(drawn).toContain('Return Grades');
        expect(drawn).not.toContain('Send Work');
        expect(drawn).not.toContain('Keep Photos Until');
        CmStudentPage.handleChange(at({ checked: false, dataset: { actionChange: 'spSendWork' } }));
        expect(localStorage.getItem('gb-student-work-' + CID)).toContain('"send_work":true');
        expect(session.sent().filter(c => /send_work|keep_photos/.test(JSON.stringify(c)))).toEqual([]);
      } finally {
        serverSaysStudentPageOn(CID, false);
        session.signOut();
      }
    });

    describe('the day on the line, and a day already gone', () => {
      const terms = ends =>
        seed(
          Object.assign({}, HELD, {
            reportingTerms: ends.map((d, i) => ({
              ordinal: i + 1,
              label: 'Term ' + (i + 1),
              starts_on: '2026-09-02',
              ends_on: d,
            })),
          }),
        );

      it('End of Term is the last day of the term the class is in, or the next to end', () => {
        terms(['2026-11-18', '2027-01-30', '2027-06-24']);
        expect(CmStudentPage.keepPhotosDate(CID, 'end_of_term')).toBe('2026-11-18');
        expect(CmStudentPage.keepPhotosDate(CID, 'end_of_year')).toBe('2027-06-30');
        open();
        turn(true);
        keep('end_of_term');
        expect(confirms).toEqual([]);
        expect(html()).toContain('deleted on November 18. Grades, comments and Mark Up stay.');
        // With no terms, End of Term is June 30 too.
        terms([]);
        expect(CmStudentPage.keepPhotosDate(CID, 'end_of_term')).toBe('2027-06-30');
      });

      it('End of Term with every term ended keeps the photos to June 30, as End of Year, and asks nothing', () => {
        terms(['2026-01-30', '2026-06-24']);
        expect(CmStudentPage.keepPhotosDate(CID, 'end_of_term')).toBe('2027-06-30');
        open();
        turn(true);
        keep('end_of_term');
        expect(confirms).toEqual([]);
        expect(html()).toContain('deleted on June 30.');
      });

      it("End of Term already past (in July) asks first, in Colin's words; Cancel changes nothing", () => {
        vi.setSystemTime(new Date('2027-07-15T18:00:00.000Z'));
        terms(['2027-01-29']);
        open();
        turn(true);
        keep('end_of_term');
        expect(confirms.length).toBe(1);
        const q = confirms[0];
        expect(q.title).toBe('Delete Photos Now?');
        expect(q.message).toBe(
          'End of Term was Jun 30, so this deletes the photos of student work in ' +
            COURSES[CID].name +
            " tonight. Deleted photos can't come back.",
        );
        expect([q.okLabel, q.okStyle]).toEqual(['Delete Photos', 'danger']);
        expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_year');
        q.onConfirm();
        expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
      });
    });
  });
});

describe('cm-student-page-tab', () => {
  /**
   * Class Settings: the Student Page tab (teacher/cm-student-page.js) is in
   * CM_TABS but hidden (docs/plans/student-page-build-plan.md, S1-T4). A
   * hidden tab has no button, no address, no place in the arrow-key order and
   * no panel, and a remembered tab that is hidden opens Details. The tab's own
   * module says whether a class shows it; today no class does.
   */

  const CID = 'sci8';
  const OTHER = 'hum8';
  const SIX = ['details', 'students', 'questionnaires', 'grading', 'terms', 'competencies'];

  describe('Class Settings: the hidden Student Page tab', () => {
    var main;
    var urls;
    var original;

    function tabIds() {
      return [...main.innerHTML.matchAll(/data-action="cmSetTab" data-tab="([^"]+)"/g)].map(m => m[1]);
    }
    function activeTab() {
      var m = main.innerHTML.match(/class="cm-tab active"[^>]*data-tab="([^"]+)"/);
      return m ? m[1] : null;
    }
    function panelClass() {
      var m = main.innerHTML.match(/class="cm-tab-panel (cm-tab-panel-[a-z-]+)"/);
      return m ? m[1] : null;
    }
    function click(tab) {
      return DashClassManager.handleAction('cmSetTab', { tagName: 'BUTTON', dataset: { tab: tab } });
    }
    function arrow(from, key) {
      var el = { tagName: 'BUTTON', dataset: { tab: from }, classList: { contains: c => c === 'cm-tab' } };
      return DashClassManager.handleKeydown({ key: key, target: el, preventDefault() {} });
    }
    // What S1-F4 will do for a class with the build switch on.
    function showFor(cid) {
      CmStudentPage.isShown = id => id === cid;
    }

    beforeEach(() => {
      localStorage.clear();
      saveCourses({
        [CID]: { id: CID, name: 'Science 8' },
        [OTHER]: { id: OTHER, name: 'Humanities 8' },
      });
      main = { innerHTML: '' };
      urls = [];
      original = {
        getElementById: document.getElementById,
        setUrl: Router.setUrl,
        pathname: location.pathname,
        isShown: CmStudentPage.isShown,
        render: CmStudentPage.render,
        handleAction: CmStudentPage.handleAction,
        handleChange: CmStudentPage.handleChange,
        handleBlur: CmStudentPage.handleBlur,
      };
      document.getElementById = function (id) {
        return id === 'main' ? main : original.getElementById(id);
      };
      Router.setUrl = url => urls.push(url);
      location.pathname = '/dashboard';
      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    });

    afterEach(() => {
      document.getElementById = original.getElementById;
      Router.setUrl = original.setUrl;
      location.pathname = original.pathname;
      CmStudentPage.isShown = original.isShown;
      CmStudentPage.render = original.render;
      CmStudentPage.handleAction = original.handleAction;
      CmStudentPage.handleChange = original.handleChange;
      CmStudentPage.handleBlur = original.handleBlur;
      DashClassManager.resetState();
    });

    describe('as shipped', () => {
      it('the module shows the tab for no class and renders an empty panel', () => {
        expect(CmStudentPage.isShown(CID)).toBe(false);
        expect(CmStudentPage.isShown(undefined)).toBe(false);
        expect(CmStudentPage.render(CID)).toBe('');
        expect(CmStudentPage.handleAction('spAnything', { dataset: {} })).toBe(false);
        expect(CmStudentPage.handleChange({ dataset: {} })).toBe(false);
        expect(CmStudentPage.handleBlur({ dataset: {} })).toBe(false);
      });

      it('draws the six tabs and no Student Page button on any of them', () => {
        DashClassManager.openClassManager();
        SIX.forEach(function (tab) {
          click(tab);
          expect(activeTab()).toBe(tab);
          expect(tabIds()).toEqual(SIX);
          expect(main.innerHTML).not.toContain('student-page');
          expect(main.innerHTML).not.toContain('Student Page');
        });
      });

      it('does not open from its address: it lands where an unknown tab does', () => {
        DashClassManager.openClassManager('student-page');
        var hidden = main.innerHTML;
        expect(activeTab()).toBe('details');
        expect(urls[urls.length - 1]).toBe('/dashboard?manage=details');

        DashClassManager.resetState();
        DashClassManager.openClassManager('no-such-tab');
        expect(main.innerHTML).toBe(hidden);
      });

      it('does not open from its address over a remembered tab', () => {
        DashClassManager.openClassManager('grading');
        DashClassManager.openClassManager('student-page');
        expect(activeTab()).toBe('grading');
        expect(urls[urls.length - 1]).toBe('/dashboard?manage=grading');
      });

      it('does not open by click', () => {
        DashClassManager.openClassManager('terms');
        var before = main.innerHTML;
        click('student-page');
        expect(main.innerHTML).toBe(before);
        expect(activeTab()).toBe('terms');
      });

      it('is skipped by the arrow keys', () => {
        DashClassManager.openClassManager('questionnaires');
        expect(arrow('questionnaires', 'ArrowRight')).toBe(true);
        expect(activeTab()).toBe('grading');
        expect(arrow('grading', 'ArrowLeft')).toBe(true);
        expect(activeTab()).toBe('questionnaires');
        // All the way round: six stops, never a seventh.
        var seen = [];
        for (var i = 0; i < 6; i++) {
          arrow(activeTab(), 'ArrowRight');
          seen.push(activeTab());
        }
        expect(seen).toEqual(['grading', 'terms', 'competencies', 'details', 'students', 'questionnaires']);
      });

      it('never asks the module for a panel or hands it a click, change or blur', () => {
        var calls = [];
        CmStudentPage.render = () => (calls.push('render'), '<p>never</p>');
        CmStudentPage.handleAction = () => (calls.push('action'), true);
        CmStudentPage.handleChange = () => (calls.push('change'), true);
        CmStudentPage.handleBlur = () => (calls.push('blur'), true);
        DashClassManager.openClassManager('student-page');
        SIX.forEach(click);
        expect(DashClassManager.handleAction('spReturnGrades', { tagName: 'BUTTON', dataset: {} })).toBe(false);
        DashClassManager.handleChange({ tagName: 'INPUT', dataset: { actionChange: 'spAnything' } });
        DashClassManager.handleBlur({ tagName: 'INPUT', dataset: { actionBlur: 'spAnything' } });
        expect(calls).toEqual([]);
        expect(main.innerHTML).not.toContain('never');
      });
    });

    describe('once its module shows it for a class', () => {
      it('sits between Questionnaires and Grading, with its own panel and address', () => {
        showFor(CID);
        CmStudentPage.render = cid => '<div class="sp-probe" data-cid="' + cid + '"></div>';
        DashClassManager.openClassManager('student-page');
        expect(tabIds()).toEqual([
          'details',
          'students',
          'questionnaires',
          'student-page',
          'grading',
          'terms',
          'competencies',
        ]);
        expect(activeTab()).toBe('student-page');
        expect(panelClass()).toBe('cm-tab-panel-student-page');
        expect(main.innerHTML).toContain('<div class="sp-probe" data-cid="' + CID + '"></div>');
        expect(urls[urls.length - 1]).toBe('/dashboard?manage=student-page');
        expect(arrow('questionnaires', 'ArrowRight')).toBe(true);
        expect(activeTab()).toBe('student-page');
      });

      it('hands the module every sp click, change and blur', () => {
        showFor(CID);
        var calls = [];
        CmStudentPage.handleAction = action => (calls.push(action), true);
        CmStudentPage.handleChange = el => (calls.push(el.dataset.actionChange), true);
        CmStudentPage.handleBlur = el => (calls.push(el.dataset.actionBlur), true);
        DashClassManager.openClassManager('student-page');
        expect(DashClassManager.handleAction('spReturnGrades', { tagName: 'BUTTON', dataset: {} })).toBe(true);
        expect(DashClassManager.handleChange({ tagName: 'INPUT', dataset: { actionChange: 'spKeep' } })).toBe(true);
        expect(DashClassManager.handleBlur({ tagName: 'INPUT', dataset: { actionBlur: 'spName' } })).toBe(true);
        expect(calls).toEqual(['spReturnGrades', 'spKeep', 'spName']);
      });

      it('a remembered Student Page tab opens Details in a class that hides it', () => {
        showFor(CID);
        DashClassManager.openClassManager('student-page');
        expect(activeTab()).toBe('student-page');

        // The class list picks the other class, which does not show the tab.
        DashClassManager.handleAction('cmSelectClass', { tagName: 'BUTTON', dataset: { cid: OTHER } });
        expect(tabIds()).toEqual(SIX);
        expect(activeTab()).toBe('details');
        expect(panelClass()).toBe('cm-tab-panel-details');
        expect(urls[urls.length - 1]).toBe('/dashboard?manage=details&class=' + OTHER);
      });

      it('a remembered Student Page tab opens Details once the tab is hidden again', () => {
        showFor(CID);
        DashClassManager.openClassManager('student-page');
        CmStudentPage.isShown = original.isShown;
        DashClassManager.renderClassManager();
        expect(tabIds()).toEqual(SIX);
        expect(activeTab()).toBe('details');
        expect(urls[urls.length - 1]).toBe('/dashboard?manage=details');
      });
    });
  });
});
