/**
 * Term Questionnaire: In Their Words (S18-F1). A Next Step sentence that
 * quotes the student's own questionnaire answer exactly, offered first in
 * Add Here and never put in by Generate; its Options menu gives the other
 * frame and the student's other shared answers; a "To you only" answer is
 * never offered (teacher/report-questionnaire.js, WORDS_SOURCE).
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const RQ = ReportQuestionnaire;
let CID = 'course-words';
let runs = 0;
const TERM = 'term-1';
const CECE = { id: 'stu-cece', firstName: 'Cece', lastName: 'Adeyemi', pronouns: 'she/her' };
const TYPED = 'Cece explained her results to the class.';
const BETTER = 'I want to get better at  explaining\nhow a quote supports my idea';
const BETTER_SAID = 'I want to get better at explaining how a quote supports my idea';
const HARD = 'Long readings are hard for me.';
const SECRET = 'My parents are splitting up, please do not tell anyone';
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

const ans = (prompt, text, extra) => ({ q: Object.assign({ prompt }, extra || {}), v: text == null ? null : { text } });
let profile = null;
function voice(p) {
  profile = p;
}
const FULL = () => ({
  about: {
    goal: ans('What do I want to get better at?', BETTER, { repeated_key: 'better_at' }),
    hard: ans('What is hard for me right now?', HARD, { repeated_key: 'hard' }),
    goodAt: ans('What am I good at as a learner?', 'Drawing diagrams', { repeated_key: 'good_at' }),
    note: ans('Is there anything you want only me to know?', SECRET, { teacher_only: true }),
  },
  checkin: { coreGoal: ans('My goal', 'Hand in every lab on time'), status: ans('Status', 'In Progress') },
});

function seed(pronouns) {
  CID = 'course-words-' + ++runs;
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency', gradeLevel: '8' };
  _cache.students[CID] = [Object.assign({ designations: [] }, CECE, pronouns ? { pronouns } : {})];
  _cache.learningMaps[CID] = {
    sections: [section('sec-1', 't1', 'Questioning'), section('sec-2', 't2', 'Evaluating')],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 8 }, (_, i) => ({
    id: 'a' + i,
    title: 'Lab ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: [i % 2 ? 't2' : 't1'],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  _cache.scores[CID] = {
    [CECE.id]: Array.from({ length: 8 }, (_, i) => ({
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
const student = () => getStudents(CID).find(s => s.id === CECE.id);
const saved = () => getStudentTermRating(CID, CECE.id, TERM) || {};
const facts = () => CommentBank.facts(CID, student(), TERM);
function open() {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = 0;
  return RQ.renderTermQuestionnaire(CID);
}
function addMenu() {
  const html = RQ.renderTermQuestionnaire(CID);
  const at = html.indexOf('class="qn-own-picks"');
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('data-do="browseAt"', at));
}
const card = html => html.slice(html.indexOf('id="tq-sentences"'));
const FRAME = 'Asked what she wants to get better at, Cece wrote: “' + BETTER_SAID + '”.';

let hadDoc, oldDoc;
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
  vi.spyOn(StudentVoice, 'entries').mockImplementation((cid, sid) =>
    profile && sid === CECE.id ? [{ kind: 'about_me' }] : [],
  );
  vi.spyOn(StudentVoice, 'profile').mockImplementation(() => profile);
});
afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
});
beforeEach(() => {
  localStorage.clear();
  seed();
  voice(FULL());
  upsertTermRating(CID, CECE.id, TERM, { narrative: TYPED });
});
afterEach(() => {
  delete COURSES[CID];
  clearProfCache();
});

describe('the answers it may quote', () => {
  it('are the shared ones, in order, as written but for spacing; never the To You Only answer', () => {
    const a = RQ.wordsAnswers(facts());
    expect(a.map(x => x.key)).toEqual(['better', 'hard', 'good', 'goal']);
    expect(a[0].text).toBe(BETTER_SAID);
    expect(a[1].question).toBe('What is hard for me right now?');
    expect(a[3].status).toBe('In Progress');
    expect(JSON.stringify(a)).not.toContain('splitting up');
  });

  it('an answer with a plan under it is quoted to the end of its first paragraph, as Generate reads it', () => {
    const p = FULL();
    p.about.goal.v.text = 'Hand in labs on time.\n\nHow:\n- start the table in class';
    voice(p);
    expect(RQ.wordsAnswers(facts())[0].text).toBe('Hand in labs on time.');
  });

  it('a shared-looking answer marked teacher only is never quoted', () => {
    const p = FULL();
    p.about.goal.q.teacher_only = true;
    voice(p);
    expect(RQ.wordsAnswers(facts()).map(x => x.key)).toEqual(['hard', 'good', 'goal']);
  });
});

describe('the sentence', () => {
  it('quotes the answer exactly in the board’s frame, filling only the name and pronoun', () => {
    const a = RQ.wordsAnswers(facts())[0];
    expect(RQ.wordsSentence(student(), a, 0)).toBe(FRAME);
    // An answer with its own ending gets no full stop added.
    expect(RQ.wordsSentence(student(), RQ.wordsAnswers(facts())[1], 0)).toBe(
      'Asked what is hard for her right now, Cece wrote: “' + HARD + '”',
    );
  });

  it('reads right with they/them', () => {
    seed('they/them');
    const a = RQ.wordsAnswers(facts())[0];
    expect(RQ.wordsSentence(student(), a, 0)).toBe(
      'Asked what they want to get better at, Cece wrote: “' + BETTER_SAID + '”.',
    );
  });
});

describe('read back', () => {
  it('a saved comment’s quoted answer is its words row again, even split at a full stop inside the quote', () => {
    const two = 'Asked what she wants to get better at, Cece wrote: “Reading faster. And math.”';
    voice(
      Object.assign(FULL(), {
        about: Object.assign(FULL().about, { goal: ans('Better at?', 'Reading faster. And math.') }),
      }),
    );
    const plain = t => ({ id: 'text:' + t, step: null, text: t, edited: false, earlier: true });
    const rows = [
      plain(TYPED),
      plain('Asked what she wants to get better at, Cece wrote: “Reading faster.'),
      plain('And math.”'),
    ];
    const back = RQ.markWords(rows, student(), facts());
    expect(back).toHaveLength(2);
    expect(back[1].words).toBe('better');
    expect(back[1].text).toBe(two);
    // A sentence the teacher edited is theirs, and stays so.
    const edited = Object.assign(plain(two), { earlier: false, edited: true, step: 'nextStep' });
    expect(RQ.markWords([edited], student(), facts())[0].words).toBeUndefined();
  });
});

describe('Generate', () => {
  it('never puts her words in by itself', () => {
    const f = facts();
    const ctx = CommentBank.context(f, {});
    for (let seedN = 1; seedN <= 25; seedN++) {
      const d = CommentBank.draft(ctx, { seed: seedN, quiet: true });
      expect(d.text).not.toContain('explaining how a quote');
      expect(d.text).not.toContain(HARD);
      expect(d.text).not.toContain('splitting up');
    }
  });
});
