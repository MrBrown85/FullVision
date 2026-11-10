/**
 * Sentence sources (S18-T1): the Add Here menu, putting a sentence in at a
 * gap, and a row's Options menu and its picks are built from the registered
 * sources (teacher/report-questionnaire.js, registerSource). The comment
 * bank is the one source today, so the menu is as it was; a second source's
 * sentences get their own group, their own row and their own Options menu.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const RQ = ReportQuestionnaire;
let CID = 'course-sources';
let runs = 0;
const TERM = 'term-1';
const MAYA = { id: 'stu-maya', firstName: 'Maya', lastName: 'Lopez', pronouns: 'she/her' };
const TYPED = 'Maya explained her results to the class.';
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

/* History 12, a Letter class: Maya has marks on all eight tasks. */
function seed() {
  CID = 'course-sources-' + ++runs;
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({ designations: [] }, MAYA)];
  _cache.learningMaps[CID] = {
    sections: [section('sec-1', 't1', 'Cause and Consequence'), section('sec-2', 't2', 'Evidence')],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 8 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: [i % 2 ? 't2' : 't1'],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  _cache.scores[CID] = {
    [MAYA.id]: Array.from({ length: 8 }, (_, i) => ({
      assessmentId: 'a' + i,
      tagId: i % 2 ? 't2' : 't1',
      score: 3,
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
    })),
  };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  localStorage.removeItem('gb-report-config-' + CID);
  clearProfCache();
}
const student = () => getStudents(CID).find(s => s.id === MAYA.id);
const saved = () => getStudentTermRating(CID, MAYA.id, TERM) || {};
function open() {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = 0;
  return RQ.renderTermQuestionnaire(CID);
}
/* The open Add Here menu's sentences: what sits between its head and the
   separator above Write Your Own. */
function addMenu() {
  const html = RQ.renderTermQuestionnaire(CID);
  const at = html.indexOf('id="tq-add-menu"');
  expect(at).toBeGreaterThan(-1);
  const menu = html.slice(at, html.indexOf('data-do="browseAt"', at));
  expect(menu).toContain('<span class="qn-menu-head">Add Here</span>');
  return menu.slice(menu.indexOf('Add Here</span>'), menu.indexOf('<div class="qn-menu-sep"'));
}
const sentenceIds = html => Array.from(html.matchAll(/data-do="insert"[^>]*data-sentence="([^"]*)"/g), m => m[1]);

/* A source for the test only: one Next Step sentence, its own Options menu. */
const picks = [];
const TEST_SOURCE = {
  id: 'test',
  label: 'Test Source',
  list: at => [
    {
      step: 'home',
      part: 'nextStep',
      label: 'Next Step',
      id: 'test:1',
      text: 'Gap ' + at.gap + ' for ' + at.student.firstName + '.',
    },
  ],
  row: c => Object.assign(RQ.typedRow(c.text, 'x'), { id: c.id, step: c.step, edited: false, drafted: c.text }),
  owns: row => /^test:/.test(row.id),
  optionsMenu: (cid, st, ctx, rows, i) =>
    `<div class="qn-menu" role="menu" id="test-source-menu">${rows[i].id} of ${st.firstName}</div>`,
  pick: (st, i, id) => picks.push([st.id, i, id]),
};

let hadDoc, oldDoc, remove;
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T19:00:00Z'));
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    body: { classList: { add() {}, remove() {} } },
  };
});
afterAll(() => {
  vi.useRealTimers();
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
});
beforeEach(() => {
  localStorage.clear();
  seed();
  picks.length = 0;
  remove = null;
  // A comment with one sentence of the teacher's: every part is missing.
  upsertTermRating(CID, MAYA.id, TERM, { narrative: TYPED });
});
afterEach(() => {
  if (remove) remove();
  delete COURSES[CID];
  clearProfCache();
});

describe('sourceChoices', () => {
  const at = () => {
    const f = CommentBank.facts(CID, student(), TERM);
    const ctx = CommentBank.context(f, {});
    return { cid: CID, student: student(), f, ctx, rows: [RQ.typedRow(TYPED, 1)], gap: 1, opts: { seed: 3 } };
  };

  it('today: one group, the comment bank’s, holding what insertChoices lists', () => {
    const a = at();
    const groups = RQ.sourceChoices(a);
    expect(groups.map(g => g.source.id)).toEqual(['bank']);
    expect(groups[0].source.label).toBe('Sentence Bank');
    expect(groups[0].choices.length).toBeGreaterThan(0);
    expect(groups[0].choices).toEqual(RQ.insertChoices(a.rows, a.ctx, a.opts));
  });

  it('a second source’s sentences are their own group, after the bank’s; taken out, the bank’s alone', () => {
    const a = at();
    const before = RQ.sourceChoices(a);
    remove = RQ.registerSource(TEST_SOURCE);
    const groups = RQ.sourceChoices(a);
    expect(groups.map(g => g.source.id)).toEqual(['bank', 'test']);
    expect(groups[0].choices).toEqual(before[0].choices);
    expect(groups[1].choices.map(c => c.text)).toEqual(['Gap 1 for Maya.']);
    remove();
    expect(RQ.sourceChoices(a)).toEqual(before);
  });

  it('a source with nothing to offer has no group', () => {
    remove = RQ.registerSource(Object.assign({}, TEST_SOURCE, { list: () => [] }));
    expect(RQ.sourceChoices(at()).map(g => g.source.id)).toEqual(['bank']);
  });
});

describe('the Add Here menu', () => {
  it('with the bank alone: its sentences and no group headings', () => {
    open();
    RQ.tqSentences('addMenu', { dataset: { gap: '1' } });
    const menu = addMenu();
    expect(sentenceIds(menu).length).toBeGreaterThan(0);
    expect(menu).not.toContain('qn-add-source');
    expect(menu).not.toContain('Sentence Bank');
  });

  it('with a second source: each source’s sentences under its own heading, the bank’s unchanged', () => {
    open();
    RQ.tqSentences('addMenu', { dataset: { gap: '1' } });
    const alone = addMenu();
    remove = RQ.registerSource(TEST_SOURCE);
    const both = addMenu();
    const bankHead = '<span class="qn-menu-head qn-add-source">Sentence Bank</span>';
    const testHead = '<span class="qn-menu-head qn-add-source">Test Source</span>';
    expect(sentenceIds(both)).toEqual(sentenceIds(alone).concat('test:1'));
    expect(both.indexOf(bankHead)).toBeGreaterThan(-1);
    expect(both.indexOf(bankHead)).toBeLessThan(both.indexOf('data-do="insert"'));
    expect(both.indexOf(testHead)).toBeGreaterThan(
      both.lastIndexOf('data-sentence="' + sentenceIds(alone).pop() + '"'),
    );
    expect(both.indexOf(testHead)).toBeLessThan(both.indexOf('data-sentence="test:1"'));
    expect(both).toContain('<span class="qn-menu-text">Gap 1 for Maya.</span>');
    // Without the headings and the second source's item, the menu is the
    // bank's alone.
    const testItem = both.slice(both.indexOf(testHead) + testHead.length);
    expect(both.replace(bankHead, '').replace(testHead + testItem, '')).toBe(
      alone.slice(0, alone.lastIndexOf('</button>') + 9),
    );
  });
});

describe('a sentence from a second source', () => {
  it('goes in at the gap as that source’s row, with its Options menu and its picks', () => {
    remove = RQ.registerSource(TEST_SOURCE);
    open();
    RQ.tqSentences('insert', { dataset: { gap: '1', step: 'home', sentence: 'test:1' } });
    expect(saved().narrative).toBe(TYPED + ' Gap 1 for Maya.');
    const card = html => html.slice(html.indexOf('id="tq-sentences"'));
    const drawn = card(RQ.renderTermQuestionnaire(CID));
    expect(drawn).toContain('data-do="wording" data-row="1"');
    expect(drawn).not.toContain('id="test-source-menu"');
    RQ.tqSentences('wording', { dataset: { row: '1' } });
    const menu = card(RQ.renderTermQuestionnaire(CID));
    expect(menu).toContain('<div class="qn-menu" role="menu" id="test-source-menu">test:1 of Maya</div>');
    expect(menu).not.toContain('id="tq-wording-menu"');
    RQ.tqSentences('pick', { dataset: { row: '1', sentence: 'test:2' } });
    expect(picks).toEqual([[MAYA.id, 1, 'test:2']]);
  });

  it('a bank sentence put in beside it keeps the bank’s Options menu', () => {
    remove = RQ.registerSource(TEST_SOURCE);
    open();
    RQ.tqSentences('addMenu', { dataset: { gap: '1' } });
    const bankId = sentenceIds(addMenu())[0];
    RQ.tqSentences('insert', { dataset: { gap: '1', sentence: bankId } });
    RQ.tqSentences('wording', { dataset: { row: '1' } });
    const html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('id="tq-wording-menu"');
    expect(html).toContain('<span class="qn-menu-head">Other ways to say this</span>');
    expect(html).not.toContain('id="test-source-menu"');
  });
});
