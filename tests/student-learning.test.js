/**
 * My Learning, built from the teacher's cache (shared/student-view.js,
 * learning(); docs/plans/student-page-build-plan.md S13-T1).
 *
 * 1. Off unless the class's Show My Learning is on; missing is off.
 * 2. Every level, letter and % is calc.js's on returned work only, in each
 *    grading style.
 * 3. A draft changes nothing in it.
 * 4. No class average and no other student's data is in it.
 * 5. I Can statements are the learning map's, word for word.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';
import { parseHTML } from 'linkedom';

const NOW = '2026-11-10T20:00:00.000Z';
const CID = 'ml-class';
const S1 = 'ml-priya';
const S2 = 'ml-omar';

const I_CAN = ['I can assess the credibility of multiple sources.', 'I can judge whether evidence is adequate.'];
const LEARNING_MAP = {
  subjects: [{ id: 'subj', name: 'Social Studies 8' }],
  competencyGroups: [
    { id: 'g1', name: 'Thinking Like a Historian', sortOrder: 0 },
    { id: 'g2', name: 'Communicating', sortOrder: 1 },
  ],
  sections: [
    {
      id: 'ev',
      name: 'Evidence',
      subject: 'subj',
      groupId: 'g1',
      tags: [{ id: 't-ev', label: 'Evidence', i_can_statements: I_CAN }],
    },
    { id: 'per', name: 'Perspective', subject: 'subj', groupId: 'g1', tags: [{ id: 't-per', label: 'Perspective' }] },
    { id: 'com', name: 'Presenting', subject: 'subj', groupId: 'g2', tags: [{ id: 't-com', label: 'Presenting' }] },
  ],
};
const CATEGORIES = [
  { id: 'cat-q', name: 'Practice Questions', weight: 40, displayOrder: 0 },
  { id: 'cat-t', name: 'Tests', weight: 60, displayOrder: 1 },
];
const piece = (id, title, date, extra) =>
  Object.assign({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: [] }, extra);
const ASSESSMENTS = [
  piece('a1', 'Magna Carta', '2026-10-05', { tagIds: ['t-ev', 't-per'], categoryId: 'cat-q' }),
  piece('a2', 'The King', '2026-10-20', { tagIds: ['t-ev'], categoryId: 'cat-t' }),
  piece('a3', 'Medieval Church', '2026-11-03', { tagIds: ['t-ev', 't-com'], categoryId: 'cat-t' }),
  piece('a4', 'A Knight’s Tale', '2026-10-30', { tagIds: ['t-per'], categoryId: 'cat-q' }),
];

const lv = (value, modifier) => ({ value, modifier: modifier || 0, comment: null });
const cell = tags => ({
  score: { value: null, modifier: 0, comment: null, status: null },
  tag_scores: Object.entries(tags).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
  rubric_scores: [],
});

/* Priya: a1 and a2 returned; a3 a draft never returned; a4 Missing.
   Omar: every piece returned at Extending, so nothing of his can be
   mistaken for hers. */
function seed(gradingSystem, opts) {
  opts = opts || {};
  localStorage.clear();
  clearClass(CID);
  const cells = {
    [S1]: {
      a1: cell({ 't-ev': lv(3, -1), 't-per': lv(2) }),
      a2: cell({ 't-ev': lv(3) }),
      a3: cell({ 't-ev': lv(1), 't-com': lv(1) }),
    },
    [S2]: {
      a1: cell({ 't-ev': lv(4), 't-per': lv(4) }),
      a2: cell({ 't-ev': lv(4) }),
      a3: cell({ 't-ev': lv(4), 't-com': lv(4) }),
      a4: cell({ 't-per': lv(4) }),
    },
  };
  const assessments = structuredClone(ASSESSMENTS);
  const scores = _gradebookCellsToScoreCache(CID, assessments, cells).scores;
  const back = at => ({ is_draft: false, returned_at: at });
  const returns = {
    a1: { [S1]: back('2026-10-06T18:00:00Z'), [S2]: back('2026-10-06T18:00:00Z') },
    a2: { [S1]: back('2026-10-21T18:00:00Z'), [S2]: back('2026-10-21T18:00:00Z') },
    a3: {
      [S1]: opts.a3Returned ? back('2026-11-04T18:00:00Z') : { is_draft: true },
      [S2]: back('2026-11-04T18:00:00Z'),
    },
    a4: { [S2]: back('2026-10-31T18:00:00Z') },
  };
  const config = { student_page_enabled: true, return_grades: 'on_return' };
  if (opts.show !== undefined) config.show_my_learning = opts.show;
  seedClass(CID, {
    students: [
      { id: S1, firstName: 'Priya', lastName: 'Shah' },
      { id: S2, firstName: 'Omar', lastName: 'Nasser' },
    ],
    assessments,
    scores,
    statuses: { [S1 + ':a4']: 'NS' },
    learningMaps: structuredClone(LEARNING_MAP),
    categories: structuredClone(CATEGORIES),
    courseConfigs: config,
    gradeReturns: returns,
  });
  COURSES[CID] = { id: CID, name: 'Socials 8', block: 'A', gradingSystem, gradeLevel: '8' };
  delete _returnedSets[CID];
  clearProfCache();
}

const learningOf = () => StudentView.fromCache(CID, S1).view.learning;
const skills = l => l.groups.flatMap(g => g.skills);
const skill = (l, id) => skills(l).find(s => s.id === id);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
  clearClass(CID);
});

describe('Show My Learning', () => {
  it('is off when the class has no setting', () => {
    seed('proficiency');
    expect(StudentView.learningOn(CID)).toBe(false);
    expect(learningOf()).toBeNull();
  });
  it('is off when the setting is anything but true', () => {
    seed('proficiency', { show: 'yes' });
    expect(learningOf()).toBeNull();
  });
  it('is on when the setting is true', () => {
    seed('proficiency', { show: true });
    expect(learningOf()).not.toBeNull();
  });
  it('the server’s page carries none: the student’s device shows it off', () => {
    seed('proficiency', { show: true });
    const reply = StudentView.reply(CID, S1);
    expect(StudentView.build(reply, CID, null).learning).toBeNull();
  });
});

describe.each(['proficiency', 'letter', 'both'])('a %s class', system => {
  beforeEach(() => seed(system, { show: true }));

  it('the overall grade is calc.js’s on returned work', () => {
    const l = learningOf();
    // As a student reads it: the proficiency, no figure out of 4 (DECISIONS, "Student-facing levels are proficiencies").
    const want = withReturnedOnly(() => studentGradeText(CID, S1));
    expect(l.mode).toBe(system);
    expect(l.overall.text).toBe(want.text);
    expect(l.overall.level).toBe(want.level);
    const badges = withReturnedOnly(() => studentGradeBadges(CID, S1));
    expect(l.overall.letter).toEqual(badges.letter ? { grade: badges.letter.grade, pct: badges.letter.pct } : null);
    expect(l.overall.word).toBe(
      system === 'letter' ? '' : withReturnedOnly(() => levelWord(CID, getOverallProficiency(CID, S1))),
    );
  });

  it('each skill is calc.js’s level, worded as the class grades', () => {
    const l = learningOf();
    ['ev', 'per', 'com'].forEach(id => {
      const v = withReturnedOnly(() => getSectionProficiency(CID, S1, id));
      const s = skill(l, id);
      if (!(v > 0)) {
        expect(s.text).toBe('');
        expect(s.level).toBe(0);
        return;
      }
      expect(s.text).toBe(system === 'letter' ? formatLevel(CID, v) : levelWord(CID, v));
      expect(s.code).toBe(system === 'letter' ? '' : levelCode(v));
      expect(s.level).toBe(nearestScoreLevel(v).level);
    });
  });

  it('a draft changes nothing: a never-returned level is in no number and no list', () => {
    const l = learningOf();
    // Presenting is scored only on the draft.
    expect(skill(l, 'com').text).toBe('');
    expect(skill(l, 'com').pieces).toEqual([]);
    expect(skill(l, 'ev').pieces.map(p => p.id)).toEqual(['a2', 'a1']);
    // Returning it moves the numbers, so the test above can fail.
    seed(system, { show: true, a3Returned: true });
    const after = learningOf();
    expect(skill(after, 'com').pieces.map(p => p.id)).toEqual(['a3']);
    expect(skill(after, 'ev').pieces.map(p => p.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('holds no class average and nothing of another student', () => {
    const l = learningOf();
    delete l.steps; // the ladder's names, the same for everyone
    const json = JSON.stringify(l);
    expect(json).not.toMatch(/Omar|ml-omar|average|rank|class/i);
    // Omar's Extending is nowhere: Priya has no Extending.
    expect(json).not.toMatch(/Extending|EXT/);
  });

  it('Missing work is listed, oldest first, and the returned work newest first', () => {
    const l = learningOf();
    expect(l.missing.map(p => p.id)).toEqual(['a4']);
    expect(l.work.map(p => p.id)).toEqual(['a2', 'a1']);
  });
});

describe('the parts of My Learning', () => {
  it('I Can statements are the learning map’s, word for word', () => {
    seed('proficiency', { show: true });
    expect(skill(learningOf(), 'ev').iCan).toEqual(I_CAN);
    expect(skill(learningOf(), 'per').iCan).toEqual([]);
  });

  it('skills sit in their folders in the map’s order; one course names none', () => {
    seed('proficiency', { show: true });
    const l = learningOf();
    expect(l.groups.map(g => [g.subject, g.folder, g.skills.map(s => s.id)])).toEqual([
      ['', 'Thinking Like a Historian', ['ev', 'per']],
      ['', 'Communicating', ['com']],
    ]);
  });

  it('a piece’s mark names its level with its + or −', () => {
    seed('proficiency', { show: true });
    const ev = skill(learningOf(), 'ev');
    expect(ev.pieces.map(p => p.text)).toEqual([scoreLevelText(3, 0), scoreLevelText(3, -1)]);
  });

  it('What Makes Up Your Grade: each category’s letter and %, calc.js’s, in a Letter class only', () => {
    seed('letter', { show: true });
    const l = learningOf();
    const want = withReturnedOnly(() =>
      assessmentGroupGrade(
        CID,
        S1,
        getAssessments(CID).filter(a => a.categoryId === 'cat-t'),
        'points',
      ),
    );
    const tests = l.categories.find(c => c.id === 'cat-t');
    expect(tests).toEqual({ id: 'cat-t', name: 'Tests', weight: 60, text: want.letter, level: want.level });
    seed('proficiency', { show: true });
    expect(learningOf().categories).toEqual([]);
  });

  it('the month’s change is calc.js’s gradeMonthChange, shown only when the word or letter moved', () => {
    ['proficiency', 'letter'].forEach(system => {
      [false, true].forEach(a3Returned => {
        seed(system, { show: true, a3Returned });
        const m = withReturnedOnly(() => gradeMonthChange(CID, S1, courseToday(CID)));
        const want = m && m.dir ? { dir: m.dir, from: m.from } : null;
        expect(learningOf().trend).toEqual(want);
      });
    });
    // Returning the November draft pulls Priya's letter down from a month ago, so the test above can fail.
    seed('letter', { show: true, a3Returned: true });
    expect(learningOf().trend).toMatchObject({ dir: -1 });
  });

  it('Next Step: the skill Generate names, with the comment bank’s step for its level, word for word', () => {
    seed('proficiency', { show: true });
    const ev = getLearningMap(CID).sections.find(s => s.id === 'ev');
    ev.tags[0].bank_id = 'bc.acct11.cc.1';
    const l = learningOf();
    const n = withReturnedOnly(() => nextStepLevel(CID, S1, 'ev'));
    const step = CommentBank.bankEntry('bc.acct11.cc.1').steps[n.key];
    const said = step.charAt(0).toUpperCase() + step.slice(1) + '.';
    expect(skill(l, 'ev').next).toEqual({ top: false, text: said });
    // Evidence is the only skill with two returned pieces, so it is the one named.
    expect(l.next).toEqual({ id: 'ev', name: 'Evidence', text: said });
    // A skill whose competencies are not from the bank has no step.
    expect(skill(l, 'per').next).toBeNull();
    // Nothing returned on a skill: no step.
    expect(skill(l, 'com').next).toBeNull();
  });

  it('nothing marked yet is empty', () => {
    seed('proficiency', { show: true });
    // Every grade of Priya's waits as a draft.
    Object.values(_cache.gradeReturns[CID]).forEach(rows => (rows[S1] = { is_draft: true }));
    delete _returnedSets[CID];
    clearProfCache();
    const l = learningOf();
    expect(l.empty).toBe(true);
    expect(skills(l).every(s => s.text === '')).toBe(true);
  });
});

describe('the My Learning screens (s/page-view.js)', () => {
  const DOC = parseHTML('<!doctype html><html><body></body></html>').document;
  const drawn = (view, ui) => {
    const box = DOC.createElement('div');
    box.innerHTML = StudentPageView.html(view, Object.assign({ tab: 'learning' }, ui));
    return box;
  };
  const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const el = attrs => ({ getAttribute: name => (name in attrs ? attrs[name] : null), closest: () => null });
  // Each row of Your Work: [title, the line under it, the chip, what pressing it does].
  const rows = box =>
    [...box.querySelectorAll('.sp-ml-work .sp-ml-row')].map(r => [
      words(r.querySelector('.sp-row-title')),
      words(r.querySelector('.sp-row-sub')),
      words(r.querySelector('.sp-level')),
      r.getAttribute('data-act'),
    ]);
  const viewOf = () => StudentView.fromCache(CID, S1).view;
  const resultOf = (view, id) => view.work.find(p => p.id === id).result.text;

  it('off: Your Work with nothing of a grade', () => {
    seed('proficiency');
    const view = viewOf();
    expect(view.learning).toBeNull();
    const box = drawn(view);
    expect(words(box.querySelector('.sp-ml-title'))).toBe('My Learning');
    expect(box.querySelector('.sp-ml-title').classList.contains('sp-hidden-title')).toBe(false);
    expect(rows(box).map(r => r[0])).toEqual(['A Knight’s Tale', 'The King', 'Magna Carta']);
    ['.sp-ml-overall', '.sp-ml-period', '.sp-ml-ladder', '.sp-ml-next'].forEach(sel =>
      expect(box.querySelector(sel), sel).toBeNull(),
    );
    ['You’re at', 'What Makes Up Your Grade', 'hasn’t turned on'].forEach(w =>
      expect(box.textContent).not.toContain(w),
    );
  });

  it('Your Work: Missing, then what came back newest first, each opening what it should', () => {
    seed('proficiency', { show: true });
    const view = viewOf();
    // The draft (Medieval Church) was never returned: it is still to do, on Assignments.
    expect(rows(drawn(view))).toEqual([
      ['A Knight’s Tale', 'Due Oct 30', 'Missing', 'open-piece'],
      ['The King', 'Returned Oct 21', resultOf(view, 'a2'), 'feedback'],
      ['Magna Carta', 'Returned Oct 6', resultOf(view, 'a1'), 'feedback'],
    ]);
    // Missing goes to its card on Outstanding; a returned piece opens Your Feedback, which goes back to My Learning.
    expect(StudentPageView.press({ tab: 'learning' }, view, 'open-piece', el({ 'data-piece': 'a4' }))).toMatchObject({
      ui: { tab: 'assignments', segment: 'outstanding', pick: 'a4' },
      focus: '#sp-piece-a4',
    });
    const fb = StudentPageView.press({ tab: 'learning' }, view, 'feedback', el({ 'data-piece': 'a2' }));
    expect(fb.ui).toMatchObject({ tab: 'learning', feedback: 'a2' });
    expect(words(drawn(view, fb.ui).querySelector('.sp-fb-back'))).toBe('My Learning');
    expect(StudentPageView.press(fb.ui, view, 'feedback-close', el({}))).toMatchObject({
      ui: { feedback: '' },
      focus: '.sp-ml-row[data-piece="a2"]',
    });
  });

  it('Missing counts as 0 only where the course % counts it: Letter and Both, not Proficiency', () => {
    seed('proficiency', { show: true });
    expect(rows(drawn(viewOf()))[0]).toEqual(['A Knight’s Tale', 'Due Oct 30', 'Missing', 'open-piece']);
    ['letter', 'both'].forEach(system => {
      seed(system, { show: true });
      expect(rows(drawn(viewOf()))[0].slice(0, 3)).toEqual([
        'A Knight’s Tale',
        'Due Oct 30 · counts as 0 until it’s in',
        'Missing',
      ]);
    });
  });

  it('work sent first, waiting for feedback; Excused with nothing to open; Late and Updated on what came back; New until opened', () => {
    seed('letter', { show: true });
    const view = viewOf();
    view.work.push(
      { id: 's1', title: 'Sent Today', kind: 'sent', dueDate: '2026-11-09', send: { sent: { at: '2026-11-09' } } },
      { id: 'x1', title: 'Field Trip Form', kind: 'excused', dueDate: '2026-10-01' },
    );
    // Preview marks every returned piece not opened (ruling 116); here the student opened all but The King.
    view.work.forEach(p => (p.unseen = false));
    const a2 = view.work.find(p => p.id === 'a2');
    Object.assign(a2, { late: true, unseen: true });
    const a1 = view.work.find(p => p.id === 'a1');
    Object.assign(a1, {
      updated: true,
      updatedAt: '2026-11-02T18:00:00Z',
      result: Object.assign({}, a1.result, { was: 'C+' }),
    });
    const box = drawn(view);
    expect(rows(box)).toEqual([
      ['Sent Today', 'Sent Nov 9 · waiting for feedback', 'Sent', 'open-piece'],
      ['A Knight’s Tale', 'Due Oct 30 · counts as 0 until it’s in', 'Missing', 'open-piece'],
      ['The King', 'Returned Oct 21 · Late', a2.result.text, 'feedback'],
      ['Magna Carta', 'Updated Nov 2 · was C+', a1.result.text, 'feedback'],
      ['Field Trip Form', null, 'Excused', null],
    ]);
    // Excused is a still row, not a button.
    const excused = [...box.querySelectorAll('.sp-ml-row')].pop();
    expect(excused.tagName).toBe('SPAN');
    // The blue dot and the word New on the one not opened; its row is watched for "opened".
    const marked = [...box.querySelectorAll('.sp-ml-work li[data-unseen]')];
    expect(marked.map(li => li.getAttribute('data-unseen'))).toEqual(['a2']);
    expect(marked[0].querySelector('.sp-ml-new-on')).not.toBeNull();
    expect(words(marked[0].querySelector('.sp-hidden-title'))).toBe('New');
    expect(box.querySelectorAll('.sp-ml-new-on')).toHaveLength(1);
    // A sent piece's row opens its card on My Learning, with the way back.
    const open = StudentPageView.press({ tab: 'learning' }, view, 'open-piece', el({ 'data-piece': 's1' }));
    expect(open.ui).toMatchObject({ tab: 'learning', card: 's1' });
    const card = drawn(view, open.ui);
    expect(words(card.querySelector('.sp-piece-title'))).toBe('Sent Today');
    expect(words(card.querySelector('[data-act="card-close"]'))).toBe('My Learning');
  });

  it('a sent row says the time it went in when the server gives one', () => {
    seed('proficiency', { show: true });
    const view = viewOf();
    view.work.unshift({
      id: 's1',
      title: 'Sent Today',
      kind: 'sent',
      dueDate: '2026-11-09',
      send: { sent: { at: '2026-11-09T19:41:00Z', pages: 3 } },
    });
    const time = new Date('2026-11-09T19:41:00Z').toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
    expect(time).toMatch(/^\d{1,2}:41 [ap]\.m\.$/);
    expect(rows(drawn(view))[0][1]).toBe('Sent Nov 9, ' + time + ' · waiting for feedback');
  });

  it.each(['proficiency', 'letter', 'both'])('a %s class: the grade card, in the view’s own words', system => {
    seed(system, { show: true });
    const view = viewOf();
    const l = view.learning;
    let box = drawn(view);
    const card = box.querySelector('.sp-ml-overall');
    expect(words(card.querySelector('.sp-ml-period'))).toBe('This Year So Far');
    // The heading is for a screen reader once the grade is there.
    expect(box.querySelector('.sp-ml-title').classList.contains('sp-hidden-title')).toBe(true);
    if (system === 'proficiency') {
      expect(words(card.querySelector('.sp-ml-at'))).toBe('You’re at' + l.overall.word);
      expect(card.querySelector('.sp-ml-letter')).toBeNull();
      expect(box.textContent).not.toContain('What Makes Up Your Grade');
    } else {
      expect(words(card.querySelector('.sp-ml-letter'))).toBe(l.overall.letter.grade);
      expect(words(card.querySelector('.sp-ml-pct'))).toBe(l.overall.letter.pct);
      expect(card.querySelector('.sp-ml-ladder')).toBeNull();
      const cats = [...box.querySelectorAll('.sp-ml-card')].find(
        c => words(c.querySelector('h2')) === 'What Makes Up Your Grade',
      );
      expect(
        [...cats.querySelectorAll('.sp-ml-row')].map(r => [
          words(r.querySelector('.sp-row-title')),
          words(r.querySelector('.sp-row-sub')),
          words(r.querySelector('.sp-level')),
        ]),
      ).toEqual(l.categories.map(c => [c.name, 'Counts ' + c.weight + '%', c.text]));
    }
    // Every word of it is the view's: change the view's, and the page says that.
    l.overall.word = 'WORD-FROM-VIEW';
    if (l.overall.letter) l.overall.letter = { grade: 'Q', pct: 'PCT-FROM-VIEW' };
    box = drawn(view);
    expect(box.textContent).toContain(system === 'proficiency' ? 'WORD-FROM-VIEW' : 'PCT-FROM-VIEW');
    // Your Work is under the grade.
    const cards = [...box.querySelectorAll('.sp-ml > section')].map(c => c.className);
    expect(cards[0]).toContain('sp-ml-overall');
    expect(cards[cards.length - 1]).toContain('sp-ml-work');
  });

  it('the month line from the view; no Work On Next, even when the view names a step (Colin, Nov 17)', () => {
    seed('proficiency', { show: true });
    const view = viewOf();
    const l = view.learning;
    l.trend = { dir: 1, from: 'Developing' };
    l.next = { id: 'per', name: 'Perspective', text: 'Explain which beliefs or values shaped that point of view.' };
    let box = drawn(view);
    expect(words(box.querySelector('.sp-ml-trend'))).toBe('Up from Developing a month ago');
    expect(box.querySelector('.sp-ml-next')).toBeNull();
    expect(box.textContent).not.toContain('Work On Next');
    expect(box.textContent).not.toContain('Explain which beliefs');
    l.trend = { dir: -1, from: 'C' };
    expect(words(drawn(view).querySelector('.sp-ml-trend'))).toBe('Down from C a month ago');
    l.trend = null;
    box = drawn(view);
    expect(box.textContent).not.toContain('a month ago');
  });

  it('the ladder: every step reached in the student’s own level’s colour, You on theirs', () => {
    seed('proficiency', { show: true });
    const view = viewOf();
    const at = view.learning.overall.level;
    expect(at).toBeGreaterThan(0);
    const ladder = drawn(view).querySelector('.sp-ml-overall .sp-ml-ladder');
    expect(ladder.classList.contains('sp-ml-at-' + at)).toBe(true);
    expect(ladder.querySelectorAll('.sp-ml-bar-on')).toHaveLength(at);
    expect(ladder.querySelectorAll('.sp-ml-you')).toHaveLength(1);
    expect(ladder.querySelector('.sp-ml-step-on').classList.contains('sp-ml-step-' + at)).toBe(true);
  });

  it('One Skill, Your Strongest and Your Skills are gone', () => {
    seed('proficiency', { show: true });
    const view = viewOf();
    const html = StudentPageView.html(view, { tab: 'learning' });
    ['data-act="skill"', 'Your Strongest', 'Your Skills', 'Next Step', 'How It’s Going'].forEach(w =>
      expect(html).not.toContain(w),
    );
    expect(StudentPageView.press({ tab: 'learning' }, view, 'skill', el({ 'data-skill': 'ev' }))).toBeNull();
  });

  it('nothing marked yet: no grade, and Your Work still lists what is missing', () => {
    seed('proficiency', { show: true });
    Object.values(_cache.gradeReturns[CID]).forEach(rows => (rows[S1] = { is_draft: true }));
    delete _returnedSets[CID];
    clearProfCache();
    const view = viewOf();
    expect(view.learning.empty).toBe(true);
    const box = drawn(view);
    expect(box.querySelector('.sp-ml-overall')).toBeNull();
    expect(rows(box).map(r => r[0])).toEqual(['A Knight’s Tale']);
  });

  it('nothing handed in, missing or back: Nothing Here Yet, and the way to Assignments', () => {
    seed('proficiency', { show: true });
    const view = Object.assign({}, viewOf(), { work: [] });
    view.learning = Object.assign({}, view.learning, { empty: true });
    const box = drawn(view);
    expect(words(box.querySelector('.sp-page-title'))).toBe('Nothing Here Yet');
    const go = box.querySelector('.sp-ml-empty [data-act="tab"]');
    expect([words(go), go.getAttribute('data-tab')]).toEqual(['See Your Assignments', 'assignments']);
  });
});
