/**
 * Checks and approval on the review screen (teacher/report-questionnaire.js,
 * fullvision-generate-plan PR 11c; the "Review-screen states" mockup).
 *
 * - The missing-work, IE and low-grade rows carry "I checked this"; Approve
 *   and Next stays off until each is ticked, the IE deadline is picked, and
 *   the comment is within the character limit with no sentence over 20
 *   words. The count turns orange and says why.
 * - Before Generate: "No comment yet", with the habits rated.
 * - Class warnings: a near-identical comment shows in the Teacher Comment
 *   card with Show Both.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const CID = 'course-checks';
const TERM = 'term-1';
const GAB = { id: 'stu-gab', firstName: 'Gabriel', lastName: 'Wong', pronouns: 'he/him' };
const AVA = { id: 'stu-ava', firstName: 'Ava', lastName: 'Martin', pronouns: 'she/her' };
const secs = ['Evidence', 'Perspective', 'Significance'];

const SIX = [
  'Gabriel is earning a B this term, which is very good work.',
  'His best piece was “Task 4”.',
  'He supports each claim with evidence from a source.',
  'His work habits are excellent.',
  'Next, he can explain why an event mattered and who it affected.',
  'Extra help is at lunch on Tuesdays in [Room].',
].join(' ');

let hadDoc, oldDoc, btn, els;
beforeAll(() => {
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  btn = { disabled: false, title: '' };
  els = {};
  globalThis.document = {
    getElementById: id => (id === 'tq-approve-next' ? btn : els[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } },
  };
});
afterAll(() => {
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
  delete COURSES[CID];
});

function seed(opts) {
  opts = opts || {};
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({}, GAB), Object.assign({}, AVA)];
  _cache.learningMaps[CID] = {
    sections: secs.map((n, i) => ({ id: 'sec' + i, name: n, shortName: n, tags: [{ id: 't' + i, label: n }] })),
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 10 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: ['t' + (i % 3)],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  const levels = [4, 3, 2];
  const missing = opts.missing || [];
  const rows = sid =>
    _cache.assessments[CID].filter(a => !(sid === GAB.id && missing.indexOf(a.id) >= 0)).map(a => ({
      assessmentId: a.id,
      tagId: a.tagIds[0],
      score: levels[Number(a.tagIds[0].slice(1))],
      date: a.date,
    }));
  _cache.scores[CID] = { [GAB.id]: rows(GAB.id), [AVA.id]: rows(AVA.id) };
  const st = {};
  missing.forEach(aid => (st[GAB.id + ':' + aid] = 'NS'));
  _cache.statuses[CID] = st;
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  localStorage.removeItem('gb-report-config-' + CID);
  clearProfCache();
  els = {};
}
function open(sid) {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === (sid || GAB.id));
  return RQ.renderTermQuestionnaire(CID);
}
const current = () => RQ.getTqStudents()[RQ.tqStudentIndex];

describe('lowGrade and checksFor', () => {
  const f = over =>
    Object.assign(
      { grade: { mode: 'letter', letter: 'B' }, standing: '', notHandedIn: { count: 0, titles: [], groups: [] } },
      over,
    );
  it('a low grade is C- or F in a Letter class and Emerging in a Proficiency class', () => {
    expect(RQ.lowGrade(f({ grade: { mode: 'letter', letter: 'C-' } }))).toBe(true);
    expect(RQ.lowGrade(f({ grade: { mode: 'both', letter: 'F' } }))).toBe(true);
    expect(RQ.lowGrade(f({ grade: { mode: 'letter', letter: 'C' } }))).toBe(false);
    expect(RQ.lowGrade(f({ grade: { mode: 'proficiency' }, standing: 'Emerging' }))).toBe(true);
    expect(RQ.lowGrade(f({ grade: { mode: 'proficiency' }, standing: 'Emerging+' }))).toBe(true);
    expect(RQ.lowGrade(f({ grade: { mode: 'proficiency' }, standing: 'Developing' }))).toBe(false);
  });
  it('checks the missing-work row, and the grade row of a low grade once the comment has one', () => {
    expect(RQ.checksFor(f(), [])).toEqual([]);
    expect(RQ.checksFor(f({ notHandedIn: { count: 2, titles: ['A', 'B'], groups: [] } }), [])).toEqual(['missing']);
    const low = f({ grade: { mode: 'letter', letter: 'C-' } });
    expect(RQ.checksFor(low, [])).toEqual([]);
    expect(RQ.checksFor(low, [{ step: 'grade' }])).toEqual(['low']);
    expect(RQ.checksFor(Object.assign(low, { notHandedIn: { count: 1 } }), [{ step: 'grade' }])).toEqual([
      'missing',
      'low',
    ]);
  });
  it('an IE comment checks its Problem row: the missing work, else IE itself; a goals comment checks nothing', () => {
    const ie = f({
      grade: { mode: 'letter', letter: 'IE', basis: 'ie', marked: { mine: 2, all: 8 } },
      notHandedIn: { count: 6, titles: [], groups: [] },
    });
    expect(RQ.checksFor(ie, [{ step: 'grade' }])).toEqual(['missing']);
    const marks = f({ grade: { mode: 'letter', letter: 'IE', basis: 'ie', marked: { mine: 2, all: 8 } } });
    expect(RQ.checksFor(marks, [{ step: 'grade' }])).toEqual(['ie']);
    const goals = f({ grade: { mode: 'letter', letter: 'C-', basis: 'language_goals' } });
    expect(RQ.checksFor(goals, [{ step: 'grade' }])).toEqual([]);
  });
});

describe('longSentences', () => {
  it('finds a sentence over 20 words, a quoted title counting as one', () => {
    const long = 'He ' + 'always '.repeat(20) + 'tries.';
    expect(RQ.longSentences('Short one. ' + long)).toEqual([long]);
    const title = 'His best piece was “' + 'word '.repeat(25).trim() + '”, where he linked two ideas.';
    expect(RQ.longSentences(title)).toEqual([]);
    expect(RQ.longSentences('')).toEqual([]);
  });
});

describe('the Not Handed In row and Approve and Next', () => {
  it('highlights the row with "I checked this" until ticked; Approve waits', () => {
    seed({ missing: ['a3', 'a7'] });
    let html = open();
    expect(html).toContain('id="tq-row-missing"');
    expect(html).toContain('class="qn-req-row flag qn-line-row" id="tq-row-missing"');
    expect(html).toContain('data-tq-check="missing"');
    expect(html).toContain(
      'title="Tick once you have checked these are really missing. Approve and Next stays off until you do."',
    );
    expect(html).toContain('2 of 10 · check that both are really missing before you approve</span>');
    expect(RQ.approveBlockers(current())).toEqual(['missing']);
    RQ.syncApprove();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(
      'Saves this comment to the report card and opens the next student. Tick “I checked this” on the highlighted sentence first.',
    );
    RQ.tqSetCheck('missing', true);
    expect(RQ.approveBlockers(current())).toEqual([]);
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe('Saves this comment to the report card and opens the next student. ⌘ Return');
    html = open();
    expect(html).toContain('class="qn-req-row qn-line-row" id="tq-row-missing"');
    expect(html).toContain('class="qn-req-ctrl on"');
    expect(html).toContain('2 of 10 · checked</span>');
    // Untick: highlighted again.
    RQ.tqSetCheck('missing', false);
    expect(RQ.approveBlockers(current())).toEqual(['missing']);
  });

  it('no check for a student with nothing missing', () => {
    seed();
    const html = open();
    expect(html).not.toContain('I checked this');
    expect(RQ.approveBlockers(current())).toEqual([]);
  });
});

describe('the character count and the 20-word rule', () => {
  it('says why past the limit and turns orange; the Ready line says Approve is off', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { narrative: SIX });
    saveReportConfig(CID, { form: { sides: [] }, commentSettings: { charLimit: 200 } });
    const ready = { textContent: '' };
    els['tq-ready'] = ready;
    const html = open();
    expect(html).toContain('class="qn-count-btn over"');
    expect(html).toContain(
      '<span class="qn-count-text" id="tq-count">' +
        SIX.length +
        ' of 200 characters</span><span id="tq-limit-text"> · remove or shorten a sentence</span>',
    );
    expect(RQ.approveBlockers(current())).toEqual(['limit']);
    RQ.syncRoster();
    RQ.syncApprove();
    expect(btn.disabled).toBe(true);
    expect(ready.textContent).toBe('Approve and Next is off until the comment fits.');
    saveReportConfig(CID, { form: { sides: [] }, commentSettings: { charLimit: null } });
    RQ.syncApprove();
    expect(ready.textContent).toBe('0 of 2 Ready');
  });
  it('a sentence over 20 words keeps Approve off and the count says so', () => {
    seed();
    const long = 'Gabriel ' + 'really '.repeat(20) + 'tries.';
    upsertTermRating(CID, GAB.id, TERM, { narrative: long + ' His work habits are excellent.' });
    const html = open();
    expect(html).toContain('class="qn-count-btn over"');
    expect(html).toContain('<span id="tq-limit-text"> · one sentence is over 20 words</span>');
    expect(RQ.approveBlockers(current())).toEqual(['long']);
    RQ.syncApprove();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(
      'Saves this comment to the report card and opens the next student. Shorten the sentence over 20 words first.',
    );
    upsertTermRating(CID, GAB.id, TERM, { narrative: long + ' ' + long });
    expect(open()).toContain('<span id="tq-limit-text"> · two sentences are over 20 words</span>');
    expect(RQ.approveBlockers(current())).toEqual(['long']);
  });
  it('a comment that fits shows the limit after the count, as before', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { narrative: SIX });
    expect(open()).toContain(
      '<span class="qn-count-text" id="tq-count">' +
        SIX.length +
        ' characters</span><span id="tq-limit-text"> · no limit</span>',
    );
    expect(RQ.approveBlockers(current())).toEqual([]);
  });
});

describe('before Generate', () => {
  it('shows No comment yet with the habits rated, hidden once there is text', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { habits: { completes: 4, ready: 3 } });
    let html = open();
    expect(html).toContain('<label class="qn-empty" id="tq-empty" for="tq-narrative">');
    expect(html).toContain('No comment yet');
    expect(html).toContain('Rate the six work habits, then press Generate Comment. You can also type here.');
    expect(html).toContain('<span class="qn-empty-chip" id="tq-empty-rated">2 of 6 habits rated</span>');
    upsertTermRating(CID, GAB.id, TERM, { narrative: 'Gabriel is earning a B this term.' });
    html = open();
    expect(html).toContain('<label class="qn-empty" id="tq-empty" for="tq-narrative" hidden>');
  });
});

describe('class warnings', () => {
  it('names the classmate whose comment shares five or more sentences, with Show Both', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { narrative: SIX });
    // Five of Ava's six sentences are Gabriel's with the names swapped.
    upsertTermRating(CID, AVA.id, TERM, {
      narrative: SIX.replace(/Gabriel/g, 'Ava')
        .replace(/\bHis\b/g, 'Her')
        .replace('Extra help is at lunch on Tuesdays in [Room].', 'See you in January.'),
    });
    const html = open();
    expect(html).toContain(
      'Five of these sentences are also in Ava Martin’s comment. Press Generate Comment for another version, or change a sentence.',
    );
    expect(html).toContain('data-action="tqShowBoth" data-sid="stu-ava"');
    expect(html).toContain('>Show Both</button>');
    const w = RQ.nearTwin(CID, current(), SIX);
    expect(w.student.id).toBe(AVA.id);
    expect(w.shared).toBe(5);
  });
  it('nothing when the comments differ, or there is no comment', () => {
    seed();
    upsertTermRating(CID, GAB.id, TERM, { narrative: SIX });
    upsertTermRating(CID, AVA.id, TERM, {
      narrative: 'Ava is earning an A this term, which is excellent work. Her timelines are always in order.',
    });
    expect(open()).not.toContain('qn-warn');
    expect(RQ.nearTwin(CID, current(), '')).toBeNull();
  });
});
