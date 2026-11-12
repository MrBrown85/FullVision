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

  it('Your Strongest is the skill with the highest level', () => {
    seed('proficiency', { show: true });
    expect(learningOf().strongest.id).toBe('ev');
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
  const html = (view, ui) => StudentPageView.html(view, Object.assign({ tab: 'learning' }, ui));
  const el = attrs => ({ getAttribute: name => (name in attrs ? attrs[name] : null), closest: () => null });

  it('off: the plain line, and nothing of a grade', () => {
    seed('proficiency');
    const out = html(StudentView.fromCache(CID, S1).view);
    expect(out).toContain('Your teacher hasn’t turned on My Learning for this class.');
    expect(out).not.toContain('sp-ml');
  });

  it('Missing counts as 0 only where the course % counts it: Letter and Both, not Proficiency', () => {
    seed('proficiency', { show: true });
    let out = html(StudentView.fromCache(CID, S1).view);
    expect(out).toContain('>1 Missing<');
    expect(out).not.toContain('counts as 0');
    seed('letter', { show: true });
    out = html(StudentView.fromCache(CID, S1).view);
    expect(out).toContain('It counts as 0 until it’s in.');
    expect(out).toContain('data-act="open-piece" data-piece="a4"');
  });

  it('a skill opens One Skill, and My Learning goes back to it', () => {
    seed('proficiency', { show: true });
    const view = StudentView.fromCache(CID, S1).view;
    expect(html(view)).toContain('data-act="skill" data-skill="ev"');
    const out = StudentPageView.press({ tab: 'learning' }, view, 'skill', el({ 'data-skill': 'ev' }));
    expect(out.ui.skill).toBe('ev');
    const one = html(view, out.ui);
    expect(one).toContain('id="sp-ml-skill-title" tabindex="-1">Evidence</h1>');
    I_CAN.forEach(line => expect(one).toContain(line));
    expect(one).toContain('How It’s Going');
    expect(StudentPageView.press(out.ui, view, 'skill-close', el({})).ui.skill).toBe('');
    expect(StudentPageView.press(out.ui, view, 'tab', el({ 'data-tab': 'assignments' })).ui.skill).toBe('');
    // A skill the view does not hold opens nothing.
    expect(StudentPageView.press({}, view, 'skill', el({ 'data-skill': 'nope' }))).toBeNull();
  });

  it('the boards’ month line, Next Step and Top Step, from the view', () => {
    seed('proficiency', { show: true });
    const view = StudentView.fromCache(CID, S1).view;
    const l = view.learning;
    l.trend = { dir: 1, from: 'Developing' };
    l.next = { id: 'per', name: 'Perspective', text: 'Explain which beliefs or values shaped that point of view.' };
    let out = html(view);
    expect(out).toContain('Up from Developing a month ago</p>');
    expect(out).toContain('data-act="skill" data-skill="per"');
    expect(out).toContain('>Next Step: Perspective</span>');
    expect(out).toContain('Explain which beliefs or values shaped that point of view.');
    l.trend = { dir: -1, from: 'C' };
    expect(html(view)).toContain('Down from C a month ago</p>');
    // Nothing to compare, nothing to step to: neither shows.
    l.trend = null;
    l.next = null;
    out = html(view);
    expect(out).not.toContain('a month ago');
    expect(out).not.toContain('Next Step');
    // One Skill: its own step, or the Top Step at Extending.
    const ev = skill(l, 'ev');
    ev.next = { top: false, text: 'Weigh accounts that disagree.' };
    out = html(view, { skill: 'ev' });
    expect(out).toContain('>Next Step</h2>');
    expect(out).toContain('Weigh accounts that disagree.');
    expect(out).not.toContain('Top Step');
    ev.next = { top: true, text: '' };
    out = html(view, { skill: 'ev' });
    expect(out).toContain('You’ve Reached the Top Step');
    expect(out).not.toContain('>Next Step<');
  });

  it('the ladder: every step reached in the student’s own level’s colour, You on theirs', () => {
    seed('proficiency', { show: true });
    const view = StudentView.fromCache(CID, S1).view;
    const out = html(view, { skill: 'ev' });
    const ev = skill(view.learning, 'ev');
    const ladder = out.slice(out.indexOf('sp-ml-ladder'), out.indexOf('</div>', out.indexOf('sp-ml-ladder')));
    expect(ladder).toContain('sp-ml-ladder sp-ml-at-' + ev.level);
    expect((ladder.match(/sp-ml-bar-on/g) || []).length).toBe(ev.level);
    expect((ladder.match(/sp-ml-you/g) || []).length).toBe(1);
  });

  it('nothing marked yet', () => {
    seed('proficiency', { show: true });
    Object.values(_cache.gradeReturns[CID]).forEach(rows => (rows[S1] = { is_draft: true }));
    delete _returnedSets[CID];
    clearProfCache();
    const out = html(StudentView.fromCache(CID, S1).view);
    expect(out).toContain('>Nothing Marked Yet</h1>');
    expect(out).toContain('data-act="tab" data-tab="assignments">See Your Assignments</button>');
  });
});
