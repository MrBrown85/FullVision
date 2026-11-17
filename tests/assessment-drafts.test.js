/**
 * Draft assessments (teacher/assign-draft.js; Colin, Nov 16 2026: "When
 * teachers create assignments, they might want to keep them as Drafts
 * (like teams) before they're issued to students.").
 *
 * Colin's calls: the state is Draft and the action Assign; Save as Draft in
 * the form's footer; no new scheduled date (Date Assigned already is one:
 * Assign keeps a future date and moves a past one to today); a Draft is on
 * the Assignments page only; Unassign only while no student has a grade, a
 * status or sent work; in the List view a Draft chip, a Drafts filter and
 * Assign on the bar.
 *
 * Signed in, a Draft goes out as create_assessment's p_is_draft (sent only
 * for a Draft) and update_assessment's is_draft
 * (migrations/2026111701_assessment_drafts.sql).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  fire,
  tick,
  settle,
  openAssignments,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const Q = U(41);
const LAB = U(31);
const QUIZ = U(32);
const PLAN = U(33);
let wasDemo;
let session = null;

const ASSESSMENTS = [
  { id: LAB, title: 'Cell Lab', tagIds: [Q], date: '2026-09-10', display_order: 1 },
  { id: QUIZ, title: 'Cell Quiz', tagIds: [Q], date: '2026-09-20', display_order: 2 },
  { id: PLAN, title: 'Organ Systems Plan', tagIds: [Q], date: '2026-09-01', isDraft: true, display_order: 3 },
];

function seed(extra) {
  seedClass(CID, {
    students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: structuredClone(ASSESSMENTS),
    scores: { [AVA]: [{ id: U(71), assessmentId: QUIZ, tagId: Q, score: 3, type: 'summative', date: '2026-09-20' }] },
    ...extra,
  });
  _rememberServerState('assessments', CID, structuredClone(ASSESSMENTS));
}

const main = () => document.getElementById('main');
const card = aid => document.getElementById('ac-' + aid);
const piece = aid => getAssessments(CID).find(a => a.id === aid);
const calls = name =>
  session
    .since()
    .filter(([n]) => n === name)
    .map(([, p]) => p);

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => false;
  localStorage.clear();
  session = signIn();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  session.signOut();
  session = null;
  AssignList.setView(false);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('which screens list a Draft', () => {
  it('getAssignedAssessments leaves Drafts out; with none it is the class’s own list', () => {
    seed();
    expect(getAssignedAssessments(CID).map(a => a.id)).toEqual([LAB, QUIZ]);
    // The same list while nothing changes, so what is kept against it holds.
    expect(getAssignedAssessments(CID)).toBe(getAssignedAssessments(CID));
    const list = getAssessments(CID);
    list.find(a => a.id === PLAN).isDraft = false;
    expect(getAssignedAssessments(CID)).toBe(list);
  });

  it('a Draft takes no work, so it is in no To Grade or Not In', () => {
    seed();
    expect(GraderWork.workOn(CID, piece(PLAN))).toBe(false);
  });

  it('Preview as Student reads a Draft as work students can’t see yet', () => {
    seed();
    let later = null;
    withStudentsToday(CID, () => {
      later = _studentsTodayScope && _studentsTodayScope.later;
    });
    expect(later).toEqual({ [PLAN]: true });
  });
});

describe('the Assignments page', () => {
  it('a Draft card: the Draft chip and Assign, and no grading in its ⋯ menu', () => {
    openAssignments(seed, CID, {});
    const c = card(PLAN);
    expect(c.classList.contains('is-draft')).toBe(true);
    expect(c.querySelector('.draft-badge').textContent).toBe('Draft');
    expect(c.querySelector('.draft-assign-btn').textContent).toBe('Assign');
    const items = Array.from(c.querySelectorAll('.assess-menu-item')).map(b => b.textContent);
    expect(items).toContain('Assign');
    expect(items).not.toContain('Class Results');
    expect(items).not.toContain('Set Everyone To');
    expect(card(LAB).querySelector('.draft-badge')).toBeNull();
  });

  it('Assign sends is_draft false and moves a Date Assigned already past to today', async () => {
    openAssignments(seed, CID, {});
    await settle();
    session.since();
    click(card(PLAN).querySelector('.draft-assign-btn'));
    await settle();
    const today = courseToday(CID);
    expect(piece(PLAN).isDraft).toBeFalsy();
    expect(piece(PLAN).date).toBe(today);
    expect(calls('update_assessment')).toEqual([
      expect.objectContaining({ p_id: PLAN, p_patch: { date_assigned: today, is_draft: false } }),
    ]);
    expect(card(PLAN).classList.contains('is-draft')).toBe(false);
  });

  it('Assign keeps a Date Assigned still to come', () => {
    seed();
    const later = '2099-01-15';
    const a = AssignDraft.assignInto(CID, { id: 'x', isDraft: true, date: later, dateAssigned: later });
    expect(a).toEqual({ id: 'x', date: later, dateAssigned: later });
  });

  it('Unassign while nothing is in; greyed once a student has a grade', async () => {
    openAssignments(seed, CID, {});
    await settle();
    const off = card(QUIZ).querySelector('.draft-unassign-off');
    expect(off.disabled).toBe(true);
    expect(off.title).toBe('Students have work or grades on this.');
    expect(AssignDraft.unassign(CID, QUIZ)).toBe(false);
    session.since();
    click(card(LAB).querySelector('[data-draft-act="unassign"]'));
    await settle();
    expect(piece(LAB).isDraft).toBe(true);
    expect(calls('update_assessment')).toEqual([expect.objectContaining({ p_id: LAB, p_patch: { is_draft: true } })]);
  });

  it('a status counts as work: Unassign is refused', () => {
    seed({ statuses: { [AVA + ':' + LAB]: 'excused' } });
    expect(AssignDraft.hasWork(CID, LAB)).toBe(true);
    expect(AssignDraft.unassign(CID, LAB)).toBe(false);
  });
});

describe('the New Assessment form', () => {
  /** @returns {HTMLElement} */
  function newForm() {
    click(document.querySelector('[data-action="showNewForm"], [data-action="newAssessment"]'));
    const form = document.getElementById('new-assess-form');
    form.querySelector('#af-title').value = 'Body Systems Poster';
    fire(form.querySelector('#af-title'), 'input');
    tick(form.querySelector('.af-tag-cb[value="' + Q + '"]'), true);
    return form;
  }

  it('the footer: Cancel, Save as Draft, Create and Add Another, Create Assessment', () => {
    openAssignments(seed, CID, {});
    const form = newForm();
    const labels = Array.from(form.querySelectorAll('.af-actions button')).map(b => b.textContent);
    expect(labels).toEqual(['Cancel', 'Save as Draft', 'Create and Add Another', 'Create Assessment']);
  });

  it('Save as Draft creates it with p_is_draft; Create Assessment sends no p_is_draft', async () => {
    openAssignments(seed, CID, {});
    await settle();
    session.since();
    click(newForm().querySelector('[data-draft="1"]'));
    await settle();
    let made = calls('create_assessment');
    expect(made).toHaveLength(1);
    expect(made[0].p_is_draft).toBe(true);
    const draft = getAssessments(CID).find(a => a.title === 'Body Systems Poster');
    expect(draft.isDraft).toBe(true);
    expect(getAssignedAssessments(CID).some(a => a.title === 'Body Systems Poster')).toBe(false);

    click(newForm().querySelector('.af-actions .btn-primary[data-action="saveNewAssess"]'));
    await settle();
    made = calls('create_assessment');
    expect(made).toHaveLength(1);
    expect('p_is_draft' in made[0]).toBe(false);
  });

  it('a Draft’s edit form ends with Save Changes and Assign; Assign saves and assigns', async () => {
    openAssignments(seed, CID, {});
    await settle();
    click(card(PLAN).querySelector('[data-action="editAssess"]'));
    const form = document.getElementById('new-assess-form');
    const labels = Array.from(form.querySelectorAll('.af-actions button')).map(b => b.textContent);
    expect(labels).toEqual(['Cancel', 'Save Changes', 'Assign']);
    session.since();
    click(form.querySelector('[data-assign="1"]'));
    await settle();
    expect(piece(PLAN).isDraft).toBeFalsy();
    expect(calls('update_assessment')[0].p_patch.is_draft).toBe(false);
  });
});

describe('the List view', () => {
  it('a Draft chip before the title, a Drafts filter, and Assign on the bar', async () => {
    AssignList.setView(true);
    openAssignments(seed, CID, {});
    await settle();
    const title = main()
      .querySelector('[data-alv-f="' + PLAN + ':title"]')
      .closest('td');
    expect(title.querySelector('.draft-badge').textContent).toBe('Draft');
    const filter = main().querySelector('[data-alv-filter="drafts"]');
    tick(filter, true);
    fire(filter, 'change');
    const rows = Array.from(main().querySelectorAll('tr[data-alv-row]')).map(tr => tr.dataset.alvRow);
    expect(rows).toEqual([PLAN]);
    const box = main().querySelector('[data-alv-f="' + PLAN + ':tick"]');
    tick(box, true);
    click(box);
    session.since();
    click(main().querySelector('[data-alv-act="assign"]'));
    await settle();
    expect(piece(PLAN).isDraft).toBeFalsy();
    expect(calls('update_assessment')).toHaveLength(1);
    expect(main().querySelector('.alv-bar').textContent).toContain('Assigned 1 assessment.');
  });
});

describe('the server row', () => {
  it('a class load reads is_draft; a missing one is assigned', () => {
    expect(_assessmentFieldsPatchOf({ title: 'x', isDraft: true }).is_draft).toBe(true);
    expect(_assessmentFieldsPatchOf({ title: 'x' }).is_draft).toBe(false);
  });
});
