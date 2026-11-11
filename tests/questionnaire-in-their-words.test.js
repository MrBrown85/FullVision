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
  const at = html.indexOf('id="tq-add-menu"');
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

  it('nothing to quote when only the private answer is on file', () => {
    voice({ about: { note: FULL().about.note }, checkin: null });
    expect(RQ.wordsAnswers(facts())).toEqual([]);
    open();
    RQ.tqSentences('addMenu', { dataset: { gap: '1' } });
    expect(addMenu()).not.toContain('data-sentence="words:');
    expect(addMenu()).not.toContain('splitting up');
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

describe('Add Here', () => {
  it('offers her words first, under its own heading, then the bank', () => {
    open();
    RQ.tqSentences('addMenu', { dataset: { gap: '1' } });
    const menu = addMenu();
    const words = menu.indexOf('<span class="qn-menu-head qn-add-source">In Their Words</span>');
    const bank = menu.indexOf('<span class="qn-menu-head qn-add-source">Sentence Bank</span>');
    expect(words).toBeGreaterThan(-1);
    expect(bank).toBeGreaterThan(words);
    expect(menu.indexOf('data-sentence="words:better:0"')).toBeLessThan(bank);
    expect(menu).toContain('Her words, from her questionnaire');
    expect(menu).not.toContain('splitting up');
  });

  it('puts it in as a Next Step sentence, quoted exactly, saved with the comment', () => {
    open();
    RQ.tqSentences('insert', { dataset: { gap: '1', step: 'nextStep', sentence: 'words:better:0' } });
    expect(saved().narrative).toBe(TYPED + ' ' + FRAME);
    const drawn = card(RQ.renderTermQuestionnaire(CID));
    expect(drawn).toContain('<span class="qn-req-label">Next Step</span>');
    expect(drawn).toContain('Her words, from her questionnaire');
    // Offered once: with it in, Add Here no longer offers it.
    RQ.tqSentences('addMenu', { dataset: { gap: '2' } });
    expect(addMenu()).not.toContain('data-sentence="words:');
  });
});

describe('beside the bank’s Next Step sentence', () => {
  it('is a row of its own with its own Options, not joined to the bank’s', () => {
    open();
    RQ.tqSentences('addMenu', { dataset: { gap: '1' } });
    // The bank's Next Step sentence: the first one offered that is not her words.
    const bankNext = Array.from(
      addMenu().matchAll(/data-step="(nextStep|goWords|home)" data-sentence="([^"]*)"/g),
      m => m,
    ).filter(m => !/^words:/.test(m[2]))[0];
    expect(bankNext).toBeTruthy();
    RQ.tqSentences('insert', { dataset: { gap: '1', step: bankNext[1], sentence: bankNext[2] } });
    RQ.tqSentences('insert', { dataset: { gap: '2', step: 'nextStep', sentence: 'words:better:0' } });
    expect(saved().narrative.endsWith(FRAME)).toBe(true);
    const labels = Array.from(
      card(RQ.renderTermQuestionnaire(CID)).matchAll(/qn-req-label">([^<]*)<[\s\S]*?qn-req-text"[^>]*>([^<]*)</g),
      m => m[1] + '|' + m[2],
    );
    expect(labels).toHaveLength(3);
    expect(labels[1]).toMatch(/^Next Step\|/);
    expect(labels[1]).not.toContain('Cece wrote');
    expect(labels[2]).toBe('Next Step|' + FRAME);
    RQ.tqSentences('wording', { dataset: { row: '2' } });
    expect(card(RQ.renderTermQuestionnaire(CID))).toContain('aria-label="Other ways to say Cece’s words"');
  });
});

describe('its Options menu', () => {
  it('has the other frame, her other shared answers under their questions, and never the private one', () => {
    open();
    RQ.tqSentences('insert', { dataset: { gap: '1', step: 'nextStep', sentence: 'words:better:0' } });
    RQ.tqSentences('wording', { dataset: { row: '1' } });
    const menu = card(RQ.renderTermQuestionnaire(CID));
    expect(menu).toContain('id="tq-wording-menu"');
    expect(menu).toContain('Cece named what she wants to get better at: “' + BETTER_SAID + '”.');
    expect(menu).toContain('Quote another answer');
    expect(menu).toContain('What is hard for me right now?');
    expect(menu).toContain('What am I good at as a learner?');
    expect(menu).toContain('Hand in every lab on time');
    expect(menu).toContain('My goal · In Progress');
    expect(menu).toContain('Answers marked To You Only are never listed.');
    expect(menu).toContain('Remove From Comment');
    expect(menu).not.toContain('splitting up');
  });

  it('a pick replaces the sentence; the answer stays word for word', () => {
    open();
    RQ.tqSentences('insert', { dataset: { gap: '1', step: 'nextStep', sentence: 'words:better:0' } });
    RQ.tqSentences('pick', { dataset: { row: '1', sentence: 'words:hard:1' } });
    expect(saved().narrative).toBe(TYPED + ' Cece named what is hard for her right now: “' + HARD + '”');
    RQ.tqSentences('pick', { dataset: { row: '1', sentence: 'words:better:1' } });
    expect(saved().narrative).toContain('“' + BETTER_SAID + '”.');
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
