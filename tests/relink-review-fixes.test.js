/**
 * Stage 5 review fixes for Re-link with the crosswalk (group 2 of 3):
 * Replaced in the Curriculum makes its Ministry folders before additions are
 * placed, puts each statement in its own Ministry folder, moves a replaced
 * competency to its new course, asks first when grades would move, and the
 * crosswalk gives each new competency to one old one.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CROSSWALK = JSON.parse(readFileSync(resolve(root, 'curriculum_crosswalk.json'), 'utf-8'));
const CID = 'e0000000-0000-4000-8000-0000000c2066';

var main;
var originalGetElementById;
var originalScrollTo;
var originalConfirm;
var confirms;

function oldClass(course, rows, extra) {
  var sections = rows.map((r, i) => ({
    id: 's' + i,
    subject: course,
    name: r.code,
    color: '#0891b2',
    tags: [
      { id: 't' + i, code: r.code, label: r.code, text: r.raw, source_text: r.raw, i_can_statements: ['I can do it.'] },
    ],
  }));
  saveCourses({ [CID]: { id: CID, name: 'Old Class', gradingSystem: 'proficiency', curriculumTags: [course] } });
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  _cache.learningMaps[CID] = {
    _customized: true,
    subjects: [{ id: course, name: 'Old ' + course, color: '#0891b2' }],
    competencyGroups: [],
    sections: sections,
  };
  if (extra) extra(_cache.learningMaps[CID]);
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [];
  _cache.scores[CID] = {};
  _cache.statuses[CID] = {};
  saveStudents(CID, []);
}

function relink() {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
  DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
  DashClassManager.handleAction('cmRelinkNext', { dataset: {} });
}
function pickAll(n, pick) {
  for (var i = 0; i < n; i++)
    DashClassManager.handleChange({
      dataset: { actionChange: 'cmCompReviewPick', group: 'replaced', idx: String(i), pick: pick },
      checked: true,
    });
}
function folderOf(sec) {
  var g = getLearningMap(CID).competencyGroups.find(x => x.id === sec.groupId);
  return g ? g.name : '';
}

beforeEach(() => {
  localStorage.clear();
  _useSupabase = false;
  window._CURRICULUM_CROSSWALK = CROSSWALK;
  main = { innerHTML: '' };
  originalGetElementById = document.getElementById;
  document.getElementById = id => (id === 'main' ? main : originalGetElementById(id));
  originalScrollTo = window.scrollTo;
  window.scrollTo = function () {};
  confirms = [];
  originalConfirm = globalThis.showConfirm;
  globalThis.showConfirm = function (title, message, ok, style, run) {
    confirms.push({ title, message, run });
  };
});

afterEach(() => {
  document.getElementById = originalGetElementById;
  window.scrollTo = originalScrollTo;
  globalThis.showConfirm = originalConfirm;
  window._CURRICULUM_CROSSWALK = undefined;
  DashClassManager.resetState();
  CURRICULUM_INDEX = null;
});

describe('the crosswalk file', () => {
  it('gives each new competency to one old competency per course', () => {
    var twice = [];
    Object.keys(CROSSWALK.pairs).forEach(k => {
      var seen = {};
      CROSSWALK.pairs[k].forEach(r =>
        r.to.forEach(id => {
          if (seen[id]) twice.push(k + ' ' + id);
          seen[id] = true;
        }),
      );
    });
    expect(twice).toEqual([]);
  });
});

describe('Re-link apply', () => {
  it('puts additions in the Ministry folders Replaced makes, in the same Apply', () => {
    CURRICULUM_INDEX = newBankIndex(['SCI10']);
    oldClass('SCI10', CROSSWALK.pairs.SCI10);
    relink();
    pickAll(6, 'theirs');
    DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
    var lm = getLearningMap(CID);
    var pa1 = lm.sections.find(s => s.tags[0].code === 'PA1');
    expect(folderOf(pa1)).toBe('Processing and Analyzing');
    var names = lm.competencyGroups.map(g => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('puts each statement of a merged line in its own Ministry folder', () => {
    CURRICULUM_INDEX = newBankIndex(['SA2D12']);
    var row = CROSSWALK.pairs.SA2D12.find(r => r.code === 'TEE');
    oldClass('SA2D12', [row]);
    relink();
    pickAll(1, 'theirs');
    DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
    var lm = getLearningMap(CID);
    var placed = row.to.map(id => folderOf(lm.sections.find(s => s.tags[0].bank_id === id)));
    expect(placed.sort()).toEqual(['Connect and Expand', 'Explore and Create']);
  });

  it('moves a one-for-one replacement to its new course', () => {
    CURRICULUM_INDEX = newBankIndex(['ELA8', 'SS8']);
    var rows = CROSSWALK.pairs.HUM8.filter(r => r.code === 'HT-IS');
    oldClass('HUM8', rows);
    COURSES[CID].curriculumTags = ['HUM8'];
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmStartRelink', { dataset: { cid: CID } });
    return new Promise(r => setTimeout(r, 20)).then(() => {
      DashClassManager.handleAction('cmRelinkNext', { dataset: {} });
      pickAll(1, 'theirs');
      DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
      var lm = getLearningMap(CID);
      var sec = lm.sections.find(s => s.id === 's0');
      var subject = lm.subjects.find(s => s.id === sec.subject);
      expect(subject.name).toBe('Social Studies 8');
      expect(sec.tags[0].code).toBe('INQ');
    });
  });

  it('asks first when Add the Curriculum Version would move grades', () => {
    CURRICULUM_INDEX = newBankIndex(['SCI10']);
    var dsi = CROSSWALK.pairs.SCI10.find(r => r.code === 'DSI');
    oldClass('SCI10', [dsi], map => {
      map.competencyGroups.push({ id: 'g1', name: 'Questioning and Predicting', color: '#0891b2', sortOrder: 0 });
      map.sections.push({
        id: 'sx',
        subject: 'SCI10',
        name: 'Mine',
        groupId: 'g1',
        color: '#0891b2',
        tags: [{ id: 'tx', code: 'MY', label: 'Mine', text: 'My own', i_can_statements: [] }],
      });
      map.sections.push({
        id: 'sy',
        subject: 'SCI10',
        name: 'Other',
        color: '#0891b2',
        tags: [{ id: 'ty', code: 'OT', label: 'Other', text: 'Another', i_can_statements: [] }],
      });
    });
    saveStudents(CID, [{ id: 'st1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' }]);
    var levels = { t0: 2, tx: 4, ty: 2 };
    _cache.assessments[CID] = Object.keys(levels).map((tag, i) => ({
      id: 'a' + i,
      title: 'Task ' + i,
      scoreMode: 'proficiency',
      tagIds: [tag],
      type: 'summative',
      date: '2026-10-0' + (i + 1),
    }));
    _cache.scores[CID] = {
      st1: Object.keys(levels).map((tag, i) => ({
        assessmentId: 'a' + i,
        tagId: tag,
        score: levels[tag],
        date: '2026-10-0' + (i + 1),
      })),
    };
    clearProfCache();
    var before = getOverallProficiency(CID, 'st1');
    relink();
    pickAll(1, 'theirs');
    var adds = (main.innerHTML.match(/data-action-change="cmCompReviewToggle"/g) || []).length;
    for (var i = 0; i < adds; i++)
      DashClassManager.handleChange({
        dataset: { actionChange: 'cmCompReviewToggle', idx: String(i) },
        checked: false,
      });
    DashClassManager.handleAction('cmCompReviewApply', { dataset: {} });
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Change Grades?');
    expect(confirms[0].message).toContain('1 of your 1 students');
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(before, 10);
    confirms[0].run();
    expect(getOverallProficiency(CID, 'st1')).not.toBeCloseTo(before, 5);
  });
});
