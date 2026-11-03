/**
 * Competencies tab: select mode, removing several at once (scores kept),
 * CSV export/import through the review, and Re-link's review, which matches
 * on curriculum wording, then code, then title, so nothing is added twice.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
