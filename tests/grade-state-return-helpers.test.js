/**
 * Who a Return returns, and the words that say so (S1-T5):
 * GradeState.returnTogether, draftsReturned, draftNames, draftsSentence,
 * returnQuestion and returnNGraded.
 *
 * The gradebook (teacher/page-gradebook.js) and the phone
 * (teacher-mobile/tab-grade.js) each kept a copy of these; both now read
 * them here, so the same class shows the same N and the same names on
 * every screen. What each screen draws from them is held by its own tests
 * (tests/gradebook-draft-cells.test.js, tests/phone-return.test.js,
 * tests/phone-return-counts.test.js), which pass unchanged.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'c-return-helpers';
const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1', 't2'] };
const QUIZ = { id: 'quiz', title: 'Quiz', date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] };
const TALK = {
  id: 'talk',
  title: 'Talk',
  date: '2026-10-15',
  type: 'summative',
  tagIds: ['t1'],
  collaboration: 'pair',
  pairs: [['s1', 's2']],
};
const POSTER = {
  id: 'poster',
  title: 'Poster',
  date: '2026-10-16',
  type: 'summative',
  tagIds: ['t1'],
  collaboration: 'group',
  groups: [
    ['s1', 's2', 's3'],
    ['s4', 's5'],
  ],
};
const BENCH = { id: 'bench', title: 'Reading Benchmark', date: '2026-10-17', scoreMode: 'dibels', tagIds: [] };
const NAMES = ['Sam', 'Cece', 'Noor', 'Avery', 'Mia', 'Ben'];
const IDS = NAMES.map((_, i) => 's' + (i + 1));
const STUDENTS = IDS.map((id, i) => ({ id, firstName: NAMES[i], lastName: 'Test' + i }));
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

const level = (sid, aid, value) => Grader.setLevel(CID, sid, aid, 't1', value, 0);
const together = (aid, sids) => GradeState.returnTogether(CID, aid, sids);
const returned = (aid, sids = IDS) => GradeState.draftsReturned(CID, aid, sids);
const sentence = sids => GradeState.draftsSentence(CID, sids);

function seed(config, students) {
  localStorage.clear();
  clearClass(CID);
  seedClass(CID, {
    students: students || STUDENTS,
    assessments: [ESSAY, QUIZ, TALK, POSTER, BENCH].map(a => structuredClone(a)),
    courseConfigs: config || {},
  });
}

beforeEach(() => seed(HELD));
afterEach(() => {
  clearClass(CID);
  localStorage.clear();
});

describe('GradeState.returnTogether: who a Return returns', () => {
  it('work graded one student at a time: the students asked for, the same list', () => {
    const asked = ['s3', 's1'];
    expect(together('essay', asked)).toBe(asked);
    expect(together('essay', [])).toEqual([]);
  });

  it('pair work: a member brings the partner, after the students asked for', () => {
    expect(together('talk', ['s1'])).toEqual(['s1', 's2']);
    expect(together('talk', ['s2'])).toEqual(['s2', 's1']);
    expect(together('talk', ['s3', 's2'])).toEqual(['s3', 's2', 's1']);
    // Both asked for: nobody twice.
    expect(together('talk', ['s1', 's2'])).toEqual(['s1', 's2']);
    // A student in no pair comes alone.
    expect(together('talk', ['s3'])).toEqual(['s3']);
  });

  it('group work: a member brings the whole group, and only their own', () => {
    expect(together('poster', ['s2'])).toEqual(['s2', 's1', 's3']);
    expect(together('poster', ['s5'])).toEqual(['s5', 's4']);
    expect(together('poster', ['s3', 's4'])).toEqual(['s3', 's4', 's1', 's2', 's5']);
    expect(together('poster', ['s6'])).toEqual(['s6']);
  });

  it('a member graded separately goes alone, and is not brought by the others', () => {
    Grader.gradeSeparately(CID, 'poster', 's3');
    expect(together('poster', ['s3'])).toEqual(['s3']);
    expect(together('poster', ['s1'])).toEqual(['s1', 's2']);
    Grader.backToGroupGrade(CID, 'poster', 's3');
    expect(together('poster', ['s1'])).toEqual(['s1', 's2', 's3']);
  });

  it('a partner no longer on the roster is not brought', () => {
    seed(
      HELD,
      STUDENTS.filter(s => s.id !== 's2'),
    );
    expect(together('talk', ['s1'])).toEqual(['s1']);
  });

  it('a DIBELS benchmark and work that is not in the class: the students asked for', () => {
    expect(together('bench', ['s1'])).toEqual(['s1']);
    expect(together('no-such-work', ['s1', 's2'])).toEqual(['s1', 's2']);
  });
});

describe('GradeState.draftsReturned: the drafts a Return returns', () => {
  it('one student', () => {
    level('s2', 'essay', 3);
    expect(returned('essay')).toEqual(['s2']);
    expect(returned('essay', ['s2'])).toEqual(['s2']);
    expect(returned('essay', ['s1'])).toEqual([]);
    expect(sentence(returned('essay'))).toBe('1 draft: Cece can’t see it yet.');
  });

  it('three students, in the order asked', () => {
    ['s1', 's2', 's3'].forEach(sid => level(sid, 'essay', 2));
    expect(returned('essay')).toEqual(['s1', 's2', 's3']);
    expect(returned('essay', ['s3', 's6', 's1'])).toEqual(['s3', 's1']);
    expect(sentence(returned('essay'))).toBe('3 drafts: Cece, Noor and Sam can’t see them yet.');
  });

  it('more than three', () => {
    IDS.forEach(sid => level(sid, 'essay', 3));
    expect(returned('essay')).toEqual(IDS);
    expect(sentence(returned('essay'))).toBe('6 drafts: Avery, Ben, Cece and 3 others can’t see them yet.');
  });

  it('is draftsIn where nobody is graded together', () => {
    level('s1', 'essay', 3);
    level('s4', 'essay', 2);
    Grader.setPoints(CID, 's5', 'quiz', 7);
    ['essay', 'quiz'].forEach(aid => {
      expect(returned(aid), aid).toEqual(GradeState.draftsIn(CID, aid, IDS));
    });
  });

  it('a pair with a hidden partner: the partner’s draft is returned and named too', () => {
    level('s1', 'talk', 3); // one save is a draft for both
    // Only Cece is on screen (a search hides Sam).
    expect(GradeState.draftsIn(CID, 'talk', ['s2'])).toEqual(['s2']);
    expect(returned('talk', ['s2'])).toEqual(['s2', 's1']);
    expect(sentence(returned('talk', ['s2']))).toBe('2 drafts: Cece and Sam can’t see them yet.');
    expect(GradeState.returnNGraded(returned('talk', ['s2']).length)).toBe('Return 2 Graded');
    // Neither of the pair on screen: nothing to return from here.
    expect(returned('talk', ['s3', 's4'])).toEqual([]);
  });

  it('a partner already returned is not in it: N is 1', () => {
    level('s1', 'talk', 3);
    // Sam's piece alone is returned; Cece's still waits, and the two are
    // still graded together.
    Grader.returnGrades(CID, 'talk', ['s1']);
    expect(GradeState.stateOf(CID, 's1', 'talk')).toBe(GradeState.RETURNED);
    expect(GradeState.stateOf(CID, 's2', 'talk')).toBe(GradeState.DRAFT);
    expect(together('talk', ['s2'])).toEqual(['s2', 's1']);
    expect(returned('talk', ['s2'])).toEqual(['s2']);
    expect(returned('talk')).toEqual(['s2']);
    expect(sentence(returned('talk', ['s2']))).toBe('1 draft: Cece can’t see it yet.');
    expect(GradeState.returnQuestion(returned('talk', ['s2']).length)).toBe('Return 1 Grade Now?');
    // From Sam's row alone there is no draft on screen.
    expect(returned('talk', ['s1'])).toEqual([]);
  });

  it('a partner graded separately and returned is not brought or counted', () => {
    // Sam is graded separately and returned; Cece's own grade then waits.
    Grader.gradeSeparately(CID, 'talk', 's1');
    level('s1', 'talk', 3);
    Grader.returnGrades(CID, 'talk', ['s1']);
    level('s2', 'talk', 2);
    expect(GradeState.stateOf(CID, 's1', 'talk')).toBe(GradeState.RETURNED);
    expect(returned('talk', ['s2'])).toEqual(['s2']);
    expect(returned('talk')).toEqual(['s2']);
    expect(sentence(returned('talk'))).toBe('1 draft: Cece can’t see it yet.');
  });

  it('group work: one member on screen returns the group’s drafts, not another group’s', () => {
    level('s1', 'poster', 3); // s1, s2, s3
    level('s4', 'poster', 2); // s4, s5
    expect(returned('poster', ['s3'])).toEqual(['s3', 's1', 's2']);
    expect(returned('poster', ['s5'])).toEqual(['s5', 's4']);
    expect(returned('poster')).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('Missing and Excused are never drafts: not counted, not named, alone or as a partner', () => {
    applyAssignmentStatus(CID, 's1', 'essay', 'NS');
    applyAssignmentStatus(CID, 's2', 'essay', 'EXC');
    applyAssignmentStatus(CID, 's3', 'essay', 'LATE');
    expect(returned('essay')).toEqual([]);
    // Late is only a label: a grade under it is a draft.
    level('s3', 'essay', 3);
    expect(returned('essay')).toEqual(['s3']);
    // Missing set over a draft's grade leaves no draft to return.
    level('s4', 'essay', 2);
    const statuses = getAssignmentStatuses(CID);
    statuses['s4:essay'] = 'NS';
    saveAssignmentStatuses(CID, statuses);
    expect(returned('essay')).toEqual(['s3']);
    // A pair: the partner marked Excused is not in the count or the names.
    level('s1', 'talk', 3);
    const later = getAssignmentStatuses(CID);
    later['s1:talk'] = 'EXC';
    saveAssignmentStatuses(CID, later);
    expect(returned('talk', ['s2'])).toEqual(['s2']);
    expect(sentence(returned('talk', ['s2']))).toBe('1 draft: Cece can’t see it yet.');
    // Asked from the Excused partner's row alone: no draft is on screen.
    expect(returned('talk', ['s1'])).toEqual([]);
  });

  it('a DIBELS benchmark has no state: nothing to return, whatever is saved on it', () => {
    Grader.setDibels(CID, 's1', 'bench', 'boy', { orfWrc: 90 });
    Grader.setOverallComment(CID, 's2', 'bench', 'Read with expression.');
    expect(returned('bench')).toEqual([]);
    expect(GradeState.draftsWaiting(CID)).toBe(0);
  });

  it('what it lists is what Grader.returnGrades returns, handed returnTogether', () => {
    level('s1', 'talk', 3);
    level('s3', 'talk', 2);
    const waiting = returned('talk', ['s2', 's3']);
    expect(waiting).toEqual(['s2', 's3', 's1']);
    const onScreen = GradeState.draftsIn(CID, 'talk', ['s2', 's3']);
    const out = Grader.returnGrades(CID, 'talk', together('talk', onScreen));
    expect(out.returned).toBe(waiting.length);
    expect(out.enrollment_ids.slice().sort()).toEqual(waiting.slice().sort());
    expect(returned('talk')).toEqual([]);
  });

  it('a class that returns each save at once, or with the student page off, has none', () => {
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    level('s1', 'essay', 3);
    level('s1', 'talk', 3);
    expect(returned('essay')).toEqual([]);
    expect(returned('talk')).toEqual([]);
    seed({});
    level('s1', 'essay', 3);
    expect(returned('essay')).toEqual([]);
  });
});

describe('GradeState.draftNames and draftsSentence: the line of names', () => {
  it('first names, A to Z, whatever order the students are given in', () => {
    expect(GradeState.draftNames(CID, ['s1', 's2', 's3'])).toEqual(['Cece', 'Noor', 'Sam']);
    expect(GradeState.draftNames(CID, ['s3', 's1'])).toEqual(['Noor', 'Sam']);
    expect(GradeState.draftNames(CID, [])).toEqual([]);
  });

  it('one, two, three, four and more', () => {
    expect(sentence(['s1'])).toBe('1 draft: Sam can’t see it yet.');
    expect(sentence(['s1', 's2'])).toBe('2 drafts: Cece and Sam can’t see them yet.');
    expect(sentence(['s1', 's2', 's3'])).toBe('3 drafts: Cece, Noor and Sam can’t see them yet.');
    expect(sentence(['s1', 's2', 's3', 's4'])).toBe('4 drafts: Avery, Cece, Noor and 1 other can’t see them yet.');
    expect(sentence(['s1', 's2', 's3', 's4', 's5'])).toBe(
      '5 drafts: Avery, Cece, Mia and 2 others can’t see them yet.',
    );
  });

  it('uses the name the teacher calls the student by', () => {
    seed(HELD, [
      { id: 's1', firstName: 'Cecilia', preferred: 'Cece', lastName: 'Adeyemi' },
      { id: 's2', firstName: '', lastName: 'Okafor' },
    ]);
    expect(sentence(['s1'])).toBe('1 draft: Cece can’t see it yet.');
    expect(sentence(['s2', 's1'])).toBe('2 drafts: Cece and Okafor can’t see them yet.');
  });

  it('a student with no name on the roster: the count stays, no name is guessed', () => {
    expect(GradeState.draftNames(CID, ['s1', 'gone'])).toEqual(['Sam']);
    expect(sentence(['gone'])).toBe('1 draft: the student can’t see it yet.');
    expect(sentence(['s1', 'gone'])).toBe('2 drafts: the students can’t see them yet.');
  });
});

describe('GradeState.returnQuestion and returnNGraded: the confirm’s words', () => {
  it('the title counts grades; one is singular', () => {
    expect(GradeState.returnQuestion(1)).toBe('Return 1 Grade Now?');
    expect(GradeState.returnQuestion(2)).toBe('Return 2 Grades Now?');
    expect(GradeState.returnQuestion(3)).toBe('Return 3 Grades Now?');
    expect(GradeState.returnQuestion(28)).toBe('Return 28 Grades Now?');
  });

  it('the button is Return N Graded, for one too', () => {
    expect(GradeState.returnNGraded(1)).toBe('Return 1 Graded');
    expect(GradeState.returnNGraded(3)).toBe('Return 3 Graded');
    expect(GradeState.returnNGraded(28)).toBe('Return 28 Graded');
  });
});

describe('the gradebook and the phone keep no copy', () => {
  it('neither file defines the helpers or writes the question’s words itself', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    ['teacher/page-gradebook.js', 'teacher-mobile/tab-grade.js'].forEach(file => {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(src, file).not.toMatch(/function _(returnTogether|draftsReturned|draftsSentence|draftNames)\b/);
      expect(src, file).not.toMatch(/Grades?' \+|' Grades? Now|Now\?'/);
      expect(src, file).not.toMatch(/can(’|\\u2019)t see (it|them) yet/);
      // GraderWork.draftsReturned is GradeState's, less the work out for revision (S11).
      expect(src, file).toMatch(/(GradeState|GraderWork)\.draftsReturned\(/);
      expect(src, file).toMatch(/GradeState\.returnTogether\(/);
      expect(src, file).toMatch(/GradeState\.returnQuestion\(/);
    });
  });
});
