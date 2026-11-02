/**
 * Browse Sentences' Use on every row (Colin, 2026-11-02: "teachers should
 * still be able to manually select sentences that have been used for
 * classmates. don't block users from custom actions like that."). A
 * sentence that does not fit the student goes in as written, as the
 * teacher's own sentence, so it is never checked against the marks and
 * Approve and Next stays on.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const CID = 'course-browse-use';
const TERM = 'term-1';
const PRI = { id: 'stu-pri', firstName: 'Priya', lastName: 'Nandi', pronouns: 'she/her' };
const MAT = { id: 'stu-mat', firstName: 'Mateo', lastName: 'Silva', pronouns: 'he/him' };
const secs = ['Evidence', 'Perspective', 'Significance'];

let hadDoc, oldDoc, btn, ready;
beforeAll(() => {
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'tq-approve-next' ? btn : id === 'tq-ready' ? ready : null),
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

function seed() {
  btn = { disabled: false, title: '' };
  ready = { textContent: '' };
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({}, PRI), Object.assign({}, MAT)];
  _cache.learningMaps[CID] = {
    sections: secs.map((n, i) => ({ id: 'sec' + i, name: n, shortName: n, tags: [{ id: 't' + i, label: n }] })),
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 9 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: ['t' + (i % 3)],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  const levels = [4, 3, 3];
  const rows = () =>
    _cache.assessments[CID].map(a => ({
      assessmentId: a.id,
      tagId: a.tagIds[0],
      score: levels[Number(a.tagIds[0].slice(1))],
      date: a.date,
    }));
  _cache.scores[CID] = { [PRI.id]: rows(), [MAT.id]: rows() };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  clearProfCache();
}
function open() {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === PRI.id);
  return RQ.renderTermQuestionnaire(CID);
}
const ctx = () => CommentBank.context(CommentBank.facts(CID, PRI, TERM), {});
const narrative = () => (getStudentTermRating(CID, PRI.id, TERM) || {}).narrative || '';

describe('Use on a sentence that does not fit', () => {
  beforeEach(seed);

  it('puts it in as written, as the teacher’s own sentence, and Approve stays on', () => {
    upsertTermRating(CID, PRI.id, TERM, { narrative: 'Priya had a strong term.' });
    open();
    // A Not Handed In sentence: Priya has handed everything in, so it
    // does not fit her.
    const c = ctx();
    const row = RQ.browseList('notHandedIn', c, {}).rows.find(r => !r.fits);
    expect(row).toBeTruthy();
    RQ.tqSentences('use', { dataset: { sentence: row.id, case: row.case } });
    const text = narrative();
    expect(text).toContain('Priya had a strong term.');
    expect(text).toContain(row.text.replace(/\.$/, ''));
    expect(RQ.approveBlockers(PRI)).not.toContain('claims');
    // A fact it had no value for shows as …, and the row says to fill it in.
    const f = CommentBank.facts(CID, PRI, TERM);
    const src = t => RQ.rowSource({ step: null, text: t, edited: true }, CID, PRI, f, c);
    expect(src('One assignment is not handed in: ….')).toBe('Typed by you · fill in the … · kept when you regenerate');
    expect(src('Priya had a strong term.')).toBe('Typed by you · kept when you regenerate');
  });

  it('a frame that fits the student, under another case, goes in as that case shows it', () => {
    upsertTermRating(CID, PRI.id, TERM, { narrative: 'Priya had a strong term.' });
    open();
    const c = ctx();
    const row = RQ.browseList('grade', c, {}).rows.find(
      r =>
        !r.fits &&
        CommentBank.fits(
          COMMENT_BANK.sentences.find(x => x.id === r.id),
          c,
        ),
    );
    expect(row).toBeTruthy();
    RQ.tqSentences('use', { dataset: { sentence: row.id, case: row.case } });
    expect(narrative()).toContain(row.text.replace(/\.$/, ''));
  });

  it('a sentence used for a classmate that does not fit the student goes in for them too', () => {
    // Mateo's marks are lower, so his grade sentence is another letter's.
    _cache.scores[CID][MAT.id].forEach(x => (x.score = 2));
    clearProfCache();
    const mctx = CommentBank.context(CommentBank.facts(CID, MAT, TERM), {});
    const theirs = RQ.browseList('grade', mctx, {}).rows.find(r => r.fits);
    upsertTermRating(CID, MAT.id, TERM, { narrative: theirs.text });
    upsertTermRating(CID, PRI.id, TERM, { narrative: 'Priya had a strong term.' });
    open();
    const usage = CommentBank.classUsage(
      COMMENT_BANK,
      [{ sid: MAT.id, text: theirs.text, names: ['Mateo', 'Silva'] }],
      CID,
      PRI.id,
    );
    expect(usage[theirs.id], theirs.text).toBe(1);
    const row = RQ.browseList('grade', ctx(), {}).rows.find(r => r.id === theirs.id && r.case === theirs.case);
    expect(row.fits).toBe(false);
    RQ.tqSentences('use', { dataset: { sentence: row.id, case: row.case } });
    expect(narrative()).toContain(row.text.replace(/\.$/, '').slice(0, 20));
    expect(RQ.approveBlockers(PRI)).not.toContain('claims');
  });
});

describe('Use adds, never swaps', () => {
  beforeEach(seed);

  it('a second Strengths sentence goes in after the first, and the comment grows', () => {
    const c = ctx();
    const fits = RQ.browseList('strengths', c, {}).rows.filter(r => r.fits);
    expect(fits.length).toBeGreaterThan(1);
    upsertTermRating(CID, PRI.id, TERM, { narrative: '' });
    open();
    RQ.tqSentences('use', { dataset: { sentence: fits[0].id, case: fits[0].case } });
    const one = narrative();
    const second = fits.find(r => one.indexOf(r.text.slice(10, 40)) < 0);
    RQ.tqSentences('use', { dataset: { sentence: second.id, case: second.case } });
    const two = narrative();
    expect(two.length).toBeGreaterThan(one.length);
    expect(two.indexOf(one.trim().slice(0, 40))).toBe(0);
    expect(two).toContain(second.text.slice(10, 40));
  });
});
