/**
 * S10-F3: a student's reflection in the grader (the board "Teacher: Grader,
 * Returned Work With a Reflection"): what they asked and Send Answer, their
 * plan and Save as Observation. The student wrote it under "Only Mr. Brown
 * sees this": it shows on their own grader only, and the answer reaches
 * them alone.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages, settle } from './helpers/pin-save-paths.js';
import { click, fire, key } from './helpers/gradebook-dom.js';

const CID = U(1);
const PIECE = U(31);
const Q = U(41);
const ANA = U(101);
const BO = U(102);
const CY = U(103);
let wasDemo;

const ASKED = {
  assessment_id: PIECE,
  enrollment_id: ANA,
  sent_at: '2026-11-04T19:30:00.000Z',
  makes_sense: 'not_sure',
  question: 'What counts as a <reason>?',
  plan: null,
  went_well: null,
};
const PLANNED = {
  assessment_id: PIECE,
  enrollment_id: CY,
  sent_at: '2026-11-06T19:30:00.000Z',
  makes_sense: 'yes',
  question: null,
  plan: "Next time I'll find all three reasons first.",
  went_well: 'My letter had a strong voice.',
};

function seed({ reflect = true, list = [ASKED, PLANNED] } = {}) {
  seedClass(CID, {
    students: [
      { id: ANA, firstName: 'Ana', lastName: 'Avila' },
      { id: BO, firstName: 'Bo', lastName: 'Bell' },
      { id: CY, firstName: 'Cy', lastName: 'Cole' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: PIECE, title: 'Letter', tagIds: [Q], date: '2026-10-20' }],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return', reflect_on_feedback: reflect },
  });
  [ANA, BO, CY].forEach(sid => Grader.setLevel(CID, sid, PIECE, Q, 3));
  Grader.returnGrades(CID, PIECE, [ANA, BO, CY]);
  saveDemoReflections(CID, list);
}

const card = overlay => overlay.querySelector('.grader-reflect');
const texts = (el, sel) => [...el.querySelectorAll(sel)].map(x => x.textContent);

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T18:00:00Z'));
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the reflection beside returned work', () => {
  it('a question: what they asked, a box for the answer and Send Answer, in the board’s words', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const c = card(overlay);
    expect(c.querySelector('.grader-reflect-title').textContent).toBe('Ana’s Reflection');
    expect(c.querySelector('.grader-reflect-when').textContent).toBe('Nov 4, the day after you returned it');
    expect(c.querySelector('.grader-reflect-sense').textContent).toBe('Not sure about the feedback');
    expect(texts(c, '.grader-reflect-who')).toEqual(['Ana asks:']);
    expect(c.querySelector('.grader-reflect-said').innerHTML).toBe('What counts as a &lt;reason&gt;?');
    expect(c.querySelector('label[for="grader-reflect-answer"]').textContent).toBe('Your answer to Ana');
    expect(c.querySelector('[data-grader="reflect-send"]').textContent).toBe('Send Answer');
    expect(c.querySelector('.grader-reflect-only').textContent).toBe('Only Ana sees your answer.');
    expect(c.querySelector('[data-grader="reflect-observe"]')).toBeNull();
    // Above the scoring.
    expect(c.parentNode.nextElementSibling.className).toBe('grader-separate-line');
  });

  it('a plan: their plan and what went well, and Save as Observation', () => {
    const overlay = openGrader(seed, CID, PIECE, CY);
    const c = card(overlay);
    expect(c.querySelector('.grader-reflect-sense').textContent).toBe('The feedback makes sense');
    expect(texts(c, '.grader-reflect-who')).toEqual(['Cy’s plan:', 'What went well:']);
    expect(c.querySelector('.grader-reflect-input')).toBeNull();
    expect(c.querySelector('[data-grader="reflect-observe"]').textContent).toBe('Save as Observation');
  });

  it('shows on that student’s grader only: none for a student who did not reflect, none on the next', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    click(overlay.querySelector('[data-grader="next"]'));
    expect(card(overlay)).toBeNull();
    expect(overlay.textContent).not.toContain('What counts as');
    click(overlay.querySelector('[data-grader="next"]'));
    expect(card(overlay).querySelector('.grader-reflect-title').textContent).toBe('Cy’s Reflection');
    expect(overlay.textContent).not.toContain('What counts as');
  });

  it('a reflection on another piece does not show on this one', () => {
    const other = { ...ASKED, assessment_id: U(32), question: 'About the other piece?' };
    const overlay = openGrader(
      () => {
        seed({ list: [] });
        saveAssessments(CID, [...getAssessments(CID), { id: U(32), title: 'Map', tagIds: [Q], date: '2026-10-21' }]);
        Grader.setLevel(CID, ANA, U(32), Q, 3);
        Grader.returnGrades(CID, U(32), [ANA]);
        expect(saveDemoReflections(CID, [other])).toBe(true);
      },
      CID,
      PIECE,
      ANA,
    );
    expect(getStudentReflections(CID, ANA).length).toBe(1);
    expect(card(overlay)).toBeNull();
  });

  it('with Reflect on Feedback off there is no row and the dialog is as it was', () => {
    const overlay = openGrader(() => seed({ reflect: false }), CID, PIECE, ANA);
    expect(overlay.querySelector('.grader-reflect-host')).toBeNull();
  });
});

describe('Send Answer', () => {
  it('sends the answer to that student alone and clears the question', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    expect(getQuestionsWaiting(CID).length).toBe(1);
    const box = card(overlay).querySelector('.grader-reflect-input');
    box.value = 'A reason says why. Your headline is a hook.';
    fire(box, 'input');
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    await settle();
    expect(getQuestionsWaiting(CID)).toEqual([]);
    const c = card(overlay);
    expect(texts(c, '.grader-reflect-who')).toEqual(['Ana asks:', 'You answered Nov 3:']);
    expect(texts(c, '.grader-reflect-said')[1]).toBe('A reason says why. Your headline is a hook.');
    expect(c.querySelector('.grader-reflect-input')).toBeNull();
    // Only Ana's page carries it; another student's carries nothing of hers.
    const mine = getStudentFeedback(CID, ANA).assessments.find(x => x.id === PIECE);
    expect(mine.reflection.answer).toBe('A reason says why. Your headline is a hook.');
    expect(JSON.stringify(getStudentFeedback(CID, BO))).not.toContain('headline');
    expect(JSON.stringify(getStudentFeedback(CID, CY))).not.toContain('headline');
    expect(JSON.stringify(getStudentFeedback(CID, CY))).not.toContain('counts as');
  });

  it('a blank answer is not sent and says so', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const send = vi.spyOn(globalThis, 'answerReflection');
    card(overlay).querySelector('.grader-reflect-input').value = '   ';
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(card(overlay).querySelector('.grader-reflect-msg').textContent).toBe('Write an answer first.');
  });

  it('what was typed stays in the box while the dialog redraws', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const box = card(overlay).querySelector('.grader-reflect-input');
    box.value = 'Half an answer';
    fire(box, 'input');
    // A grade changes: the dialog draws again, and the reflection with it.
    Grader.setLevel(CID, ANA, PIECE, Q, 2);
    window.PageAssignments.render();
    click(overlay.querySelector('[data-grader="next"]'));
    click(overlay.querySelector('[data-grader="prev"]'));
    expect(card(overlay).querySelector('.grader-reflect-input').value).toBe('Half an answer');
  });

  it('an answer that comes after the dialog moved on is not drawn on the next student; while it waits the button is off', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    let answer;
    vi.spyOn(globalThis, 'answerReflection').mockImplementation(
      () =>
        new Promise(r => {
          answer = r;
        }),
    );
    card(overlay).querySelector('.grader-reflect-input').value = 'Because.';
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    const busy = card(overlay).querySelector('[data-grader="reflect-send"]');
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toBe('Sending…');
    click(overlay.querySelector('[data-grader="next"]'));
    click(overlay.querySelector('[data-grader="next"]'));
    const before = card(overlay).outerHTML;
    answer({ result: 'already_answered' });
    await settle();
    expect(card(overlay).outerHTML).toBe(before);
    expect(overlay.textContent).not.toContain('answered already');
    // Back on Ana: nothing is said about an answer that came while away.
    click(overlay.querySelector('[data-grader="prev"]'));
    click(overlay.querySelector('[data-grader="prev"]'));
    expect(card(overlay).querySelector('.grader-reflect-msg').textContent).toBe('');
  });

  it('a second press while the first answer is on its way sends nothing more', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    let answer;
    const send = vi.spyOn(globalThis, 'answerReflection').mockImplementation(
      () =>
        new Promise(r => {
          answer = r;
        }),
    );
    card(overlay).querySelector('.grader-reflect-input').value = 'Because.';
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    answer({ result: 'answered' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says plainly when it could not be sent, and keeps the words', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    vi.spyOn(globalThis, 'answerReflection').mockImplementation(() => Promise.resolve({ result: 'not_available' }));
    card(overlay).querySelector('.grader-reflect-input').value = 'Because.';
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    await settle();
    expect(card(overlay).querySelector('.grader-reflect-msg').textContent).toBe(
      'Answers can’t be sent from signed-in classes yet.',
    );
    expect(card(overlay).querySelector('.grader-reflect-input').value).toBe('Because.');
  });

  it('a follow-up after the answer gets its own answer', async () => {
    const asked = {
      ...ASKED,
      answer: 'A reason says why.',
      answered_at: '2026-11-05T15:00:00.000Z',
      sense_now: 'not_sure',
      sense_now_at: '2026-11-05T20:00:00.000Z',
      follow_up: 'So is the date a reason?',
    };
    const overlay = openGrader(() => seed({ list: [asked] }), CID, PIECE, ANA);
    expect(texts(card(overlay), '.grader-reflect-who')).toEqual([
      'Ana asks:',
      'You answered Nov 5:',
      'Ana is still not sure and asks:',
    ]);
    card(overlay).querySelector('.grader-reflect-input').value = 'No, a date is a fact.';
    click(card(overlay).querySelector('[data-grader="reflect-send"]'));
    await settle();
    expect(texts(card(overlay), '.grader-reflect-who').pop()).toBe('You answered Nov 3:');
    expect(getQuestionsWaiting(CID)).toEqual([]);
  });

  it('Enter in the answer box writes a new line; the grader’s ← → do not move', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const box = card(overlay).querySelector('.grader-reflect-input');
    box.focus();
    key(box, 'ArrowRight');
    expect(card(overlay).querySelector('.grader-reflect-title').textContent).toBe('Ana’s Reflection');
  });
});

describe('Save as Observation', () => {
  it('keeps the student’s words, quoted, as a Note on them linked to the piece; once', () => {
    const overlay = openGrader(seed, CID, PIECE, CY);
    click(card(overlay).querySelector('[data-grader="reflect-observe"]'));
    const obs = getQuickObs(CID)[CY];
    expect(obs.length).toBe(1);
    expect(obs[0]).toMatchObject({
      text: "Plan after Letter: “Next time I'll find all three reasons first.” Went well: “My letter had a strong voice.”",
      sentiment: 'note',
      // Marked as from a reflection: never offered to a report (ruling 110).
      context: 'reflection',
      assignmentContext: { assessmentId: PIECE, assessmentTitle: 'Letter' },
    });
    expect(isReflectionObservation(obs[0])).toBe(true);
    const b = card(overlay).querySelector('[data-grader="reflect-observe"]');
    expect(b.textContent).toBe('Saved as Observation');
    expect(b.disabled).toBe(true);
    click(b);
    expect(getQuickObs(CID)[CY].length).toBe(1);
  });
});
