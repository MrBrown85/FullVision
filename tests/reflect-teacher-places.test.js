/**
 * Questions From Students in the teacher's three places (S10-F4): the
 * gradebook's Question Waiting mark, the dashboard's Questions From
 * Students, and the Learner Profile's Working On, Reflecting So Far and
 * Reflections on Feedback. Demo Mode's Science 8, whose sample (PR 1067)
 * has Jordan's question on Cell Microscope Lab waiting, Noor's answered and
 * Liam's plan.
 *
 * First the pin: with Reflect on Feedback off, or the build switch off,
 * each screen draws exactly what it draws with no reflection stored at all.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { mount, unmount } from './helpers/gradebook-dom.js';

const CID = 'sci8';
let wasDemo;
let voiceLoaded;

function seedDemo(cfg) {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  if (cfg) saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID) || {}, cfg));
}

// No reflection stored at all: what every screen drew before S10.
function dropReflections() {
  const k = 'gb-student-feedback-' + CID;
  const stored = JSON.parse(localStorage.getItem(k) || 'null');
  expect(stored && Object.keys(stored.reflections || {}).length).toBeGreaterThan(0);
  delete stored.reflections;
  localStorage.setItem(k, JSON.stringify(stored));
}

function gradebookHtml(prep, during) {
  mount(prep, { course: CID });
  let html;
  try {
    html = document.getElementById('main').innerHTML;
    if (during) during(document);
  } finally {
    unmount();
  }
  return html;
}

function page(prep, open) {
  const stub = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, CSS: globalThis.CSS };
  const doc = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><main id="main"></main></div></body></html>',
  ).document;
  globalThis.document = doc;
  globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
  globalThis.CSS = { escape: s => String(s) };
  globalThis.requestAnimationFrame = fn => fn();
  Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
    get() {
      return this._value || '';
    },
    set(v) {
      this._value = v;
    },
    configurable: true,
  });
  prep();
  clearProfCache();
  let html = '';
  try {
    html = open(doc);
  } finally {
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.CSS = stub.CSS;
  }
  return html;
}

function dashboardHtml(prep, during) {
  return page(prep, doc => {
    setActiveCourse(CID);
    runInThisContext(readFileSync('teacher/page-dashboard.js', 'utf-8'), { filename: 'teacher/page-dashboard.js' });
    PageDashboard.init({});
    const html = doc.getElementById('page-toolbar-mount').innerHTML + doc.getElementById('main').innerHTML;
    if (during) during(doc);
    const remove = globalThis.removeEventListener;
    globalThis.removeEventListener = () => {};
    PageDashboard.destroy();
    globalThis.removeEventListener = remove;
    return html;
  });
}

function profileHtml(prep, sid = 'st10', during) {
  return page(prep, doc => {
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    PageStudent.init({ id: sid, course: CID, tab: 'profile' });
    const html = doc.getElementById('main').innerHTML;
    if (during) during(doc);
    PageStudent.destroy();
    return html;
  });
}

const SCREENS = { gradebook: gradebookHtml, dashboard: dashboardHtml, profile: profileHtml };

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-11T19:00:00Z'), toFake: ['Date'] });
  voiceLoaded = StudentVoice.loaded;
  StudentVoice.loaded = () => true;
});
afterEach(() => {
  StudentVoice.loaded = voiceLoaded;
  vi.useRealTimers();
});

describe('the pin: with either switch off, each screen is as it was', () => {
  const OFF = {
    'Reflect on Feedback off': { student_page_enabled: true },
    'the build switch off': { reflect_on_feedback: true },
  };
  Object.keys(OFF).forEach(name => {
    Object.keys(SCREENS).forEach(screen => {
      it(screen + ', ' + name, () => {
        const draw = SCREENS[screen];
        const withSample = draw(() => seedDemo(OFF[name]));
        expect(withSample.length).toBeGreaterThan(500);
        const without = draw(() => {
          seedDemo(OFF[name]);
          dropReflections();
        });
        expect(withSample).toBe(without);
      });
    });
  });
});

/* ── With the build switch and Reflect on Feedback on ─────────────── */

const JORDAN = 'st10';
const NOOR = 'st2';
const LIAM = 'st4';
const LAB = 'sci8a1';
const ON = { student_page_enabled: true, reflect_on_feedback: true };
const on = () => seedDemo(ON);
const $ = (doc, sel) => doc.querySelector(sel);
const $$ = (doc, sel) => Array.from(doc.querySelectorAll(sel));
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
function click(doc, el) {
  el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
}
const jordansQuestion = () => getQuestionsWaiting(CID).find(r => r.enrollment_id === JORDAN);
const day = iso => formatShortDate(String(iso).slice(0, 10));
let realPA;

function sendWorkOn() {
  const k = 'gb-student-work-' + CID;
  const w = JSON.parse(localStorage.getItem(k));
  w.course.send_work = true;
  localStorage.setItem(k, JSON.stringify(w));
}

// A question with markup in it, from Cece on the lab, which she has back.
const ODD = 'Is <b>this</b> "bold" & fine?';
function ceceAsks() {
  const r = sendStudentReflection(CID, 'st1', LAB, { makes_sense: 'not_sure', question: ODD }, 'st1');
  expect(r.ok).toBe(true);
}

beforeEach(() => {
  realPA = window.PageAssignments;
  window.PageAssignments = { openGrader: vi.fn(), graderOpen: () => false };
});
afterEach(() => {
  window.PageAssignments = realPA;
});

describe('the gradebook: the Question Waiting mark', () => {
  it('a yellow dot on the cell, its hover line, "1 question" and the key', () => {
    gradebookHtml(on, doc => {
      const r = jordansQuestion();
      const cell = $(doc, '.gb-scores-cell[data-sid="' + JORDAN + '"][data-aid="' + LAB + '"]');
      expect(cell.querySelector('.gb-question')).not.toBeNull();
      expect(cell.getAttribute('title')).toBe(
        'Asked you a question ' + day(r.sent_at) + '. Click to open in the grader.',
      );
      expect(cell.getAttribute('aria-label')).toMatch(/, question waiting$/);
      // One dot only: Noor's was answered, Liam asked nothing.
      expect($$(doc, '.gb-scores-cell .gb-question').length).toBe(1);
      expect(text($(doc, '.gb-questions-btn'))).toBe('1 question');
      expect(text($(doc, '.gb-key'))).toContain('Question waiting');
    });
  });

  it('"1 question" pressed leaves only that student and that piece', () => {
    gradebookHtml(on, doc => {
      click(doc, $(doc, '.gb-questions-btn'));
      expect($$(doc, '#gb-data tr[data-sid]').map(tr => tr.dataset.sid)).toEqual([JORDAN]);
      expect([...new Set($$(doc, '.gb-scores-cell').map(td => td.dataset.aid))]).toEqual([LAB]);
      expect($(doc, '.gb-questions-btn').getAttribute('aria-pressed')).toBe('true');
      click(doc, $(doc, '.gb-questions-btn'));
      expect($$(doc, '#gb-data tr[data-sid]').length).toBeGreaterThan(1);
    });
  });
});

describe('the dashboard: Questions From Students', () => {
  it('a card with the count and one row, the question in the student’s words', () => {
    dashboardHtml(on, doc => {
      const card = $(doc, '#dash-questions');
      expect(text(card.querySelector('#dash-questions-title'))).toBe('Questions From Students');
      expect(text(card.querySelector('.dash-questions-count'))).toBe('1');
      expect(text(card.querySelector('.dash-questions-hint'))).toBe(
        'From Reflect on Feedback, across your classes. You answer in the grader, the same as from the Learner Profile.',
      );
      const rows = $$(doc, '.dash-questions-row');
      expect(rows.length).toBe(1);
      const st = getStudents(CID).find(s => s.id === JORDAN);
      expect(text(rows[0].querySelector('.dash-questions-name'))).toBe(displayNameWithLast(st));
      expect(text(rows[0].querySelector('.dash-questions-meta'))).toBe(
        'Cell Microscope Lab · ' + COURSES[CID].name + ' · ' + day(jordansQuestion().sent_at),
      );
      expect(rows[0].querySelector('.dash-questions-text').textContent).toBe(jordansQuestion().question);
    });
  });

  it('Answer in the Grader opens the grader on that student’s piece, that student only', () => {
    dashboardHtml(on, doc => {
      click(doc, $(doc, '.dash-questions-answer'));
      expect(PageAssignments.openGrader).toHaveBeenCalledTimes(1);
      const [cid, aid, sid, opts] = PageAssignments.openGrader.mock.calls[0];
      expect([cid, aid, sid, opts.studentIds]).toEqual([CID, LAB, JORDAN, [JORDAN]]);
    });
  });

  it('the To Grade cell carries "· 1 Question" when Send Work is on', () => {
    dashboardHtml(
      () => {
        on();
        sendWorkOn();
      },
      doc => {
        expect(text($(doc, '.dash-glance-tograde .dash-glance-sub'))).toMatch(/ · 1 Question$/);
      },
    );
  });

  it('closing the grader draws the dashboard again, only while it is still shown', () => {
    dashboardHtml(on, doc => {
      click(doc, $(doc, '.dash-questions-answer'));
      const close = PageAssignments.openGrader.mock.calls[0][3].onClose;
      answerReflection(CID, jordansQuestion().id, 'Look at the shapes.', 'k-dash-1');
      // Another page took #main: nothing is drawn over it.
      const main = doc.getElementById('main');
      const kept = main.innerHTML;
      main.innerHTML = '<p id="other">Another page</p>';
      close();
      expect(main.innerHTML).toBe('<p id="other">Another page</p>');
      main.innerHTML = kept;
      close();
      expect($(doc, '#dash-questions')).toBeNull();
    });
  });
});

describe('the Learner Profile', () => {
  it('Jordan: the tile, the jump link, and his question with Answer in the Grader', () => {
    profileHtml(on, JORDAN, doc => {
      expect(text($(doc, '#stu-tab-profile'))).toBe('Learner Profile1 Reflection1 question to answer');
      expect(text($(doc, '.id-jump a[data-target="lp-feedback"]'))).toBe('Reflections on Feedback 1 question');
      // First in the main column.
      expect($(doc, '.lp-main > section').id).toBe('lp-feedback');
      const so = $$(doc, '.lp-so-far li').map(text);
      expect(so[0]).toMatch(/^1 reflection on \d+ returned pieces?$/);
      expect(so[so.length - 1]).toBe('1 question waiting for you');
      const card = $(doc, '#lp-feedback .rf-card');
      expect(text(card.querySelector('.rf-title'))).toBe('Cell Microscope Lab');
      expect(text(card.querySelector('.rf-sense'))).toBe('Not sure');
      expect(card.querySelector('.qw-b').textContent).toBe(jordansQuestion().question);
      expect(text(card.querySelector('.rf-wait span'))).toBe('Not answered yet');
      expect(text(card.querySelector('.rf-wait .rf-answer'))).toBe('Answer in the Grader');
      click(doc, card.querySelector('.rf-answer'));
      const [cid, aid, sid, opts] = PageAssignments.openGrader.mock.calls[0];
      expect([cid, aid, sid, opts.studentIds]).toEqual([CID, LAB, JORDAN, [JORDAN]]);
    });
  });

  it('Liam: Working On, his plan and what went well, not yet shown on a next piece', () => {
    profileHtml(on, LIAM, doc => {
      const working = $(doc, '.lp-working');
      expect(working.querySelector('.qw-b').textContent).toBe(
        "Next time I'll write the magnification beside each drawing.",
      );
      expect(text(working.querySelector('.lp-card-note'))).toBe(
        'From the reflection on Cell Microscope Lab, ' +
          LearnerProfile.day(getStudentLastPlan(CID, LIAM).sent_at) +
          '. It shows on Liam’s next ' +
          COURSES[CID].name +
          ' assignment.',
      );
      const card = $(doc, '#lp-feedback .rf-card');
      expect(text(card.querySelector('.rf-sense'))).toBe('Makes sense');
      expect($$(doc, '#lp-feedback .rf-said').map(f => text(f.querySelector('.qw-q')))).toEqual(['Plan:', 'Proud of:']);
      expect(text(card.querySelector('.rf-next'))).toBe('Not yet shown');
      expect(card.querySelector('.rf-answer')).toBeNull();
      expect(text($(doc, '#stu-tab-profile .stu-tab-stat'))).toBe('1 Reflection');
      expect(text($(doc, '#stu-tab-profile .stu-tab-sub'))).toBe(
        'Last reflection ' + LearnerProfile.day(getStudentLastPlan(CID, LIAM).sent_at),
      );
    });
  });

  it('Noor: her question, your answer, and that it makes sense now', () => {
    profileHtml(on, NOOR, doc => {
      const card = $(doc, '#lp-feedback .rf-card');
      expect(text(card.querySelector('.rf-you'))).toMatch(
        /^You answered \w+ \d+:That line is the cell membrane\. Only plant cells, like the onion, have a cell wall as well\.$/,
      );
      expect(text(card.querySelector('.rf-line'))).toBe('Noor says it makes sense now.');
      expect(card.querySelector('.rf-answer')).toBeNull();
      expect($(doc, '.lp-so-far-ask')).toBeNull();
    });
  });

  it('All, Questions and Plans', () => {
    profileHtml(on, LIAM, doc => {
      click(doc, $(doc, '[data-action="lpFeedbackFilter"][data-filter="questions"]'));
      expect($$(doc, '#lp-feedback .rf-card').length).toBe(0);
      expect(text($(doc, '#lp-feedback .lp-none'))).toBe('No questions from Liam yet.');
      click(doc, $(doc, '[data-action="lpFeedbackFilter"][data-filter="plans"]'));
      expect($$(doc, '#lp-feedback .rf-card').length).toBe(1);
      click(doc, $(doc, '[data-action="lpFeedbackFilter"][data-filter="all"]'));
      expect($(doc, '[data-filter="all"]').getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('a follow-up after an answer waits again, with its own Answer in the Grader', () => {
    profileHtml(
      () => {
        on();
        answerReflection(CID, jordansQuestion().id, 'Onion cells sit in rows.', 'k-lp-f1');
        const back = sendStudentReply(CID, JORDAN, LAB, { sense_now: 'not_sure', follow_up: 'Which rows?' }, JORDAN);
        expect(back.ok).toBe(true);
      },
      JORDAN,
      doc => {
        const card = $(doc, '#lp-feedback .rf-card');
        expect($$(doc, '#lp-feedback .rf-said .qw-q').map(text)).toEqual([
          'Asked:',
          'Jordan is still not sure and asks:',
        ]);
        expect(text(card.querySelector('.rf-wait span'))).toBe('Not answered yet');
        expect(text(card.querySelector('.rf-wait .rf-answer'))).toBe('Answer in the Grader');
        expect(text($(doc, '#stu-tab-profile .stu-tab-sub'))).toBe('1 question to answer');
      },
    );
  });

  it('closing the grader draws the profile again, only for the same student still shown', () => {
    profileHtml(on, JORDAN, doc => {
      click(doc, $(doc, '.rf-answer'));
      const close = PageAssignments.openGrader.mock.calls[0][3].onClose;
      answerReflection(CID, jordansQuestion().id, 'Look at the shapes.', 'k-lp-close');
      const main = doc.getElementById('main');
      const kept = main.innerHTML;
      main.innerHTML = '<p id="other">Another page</p>';
      close();
      expect(main.innerHTML).toBe('<p id="other">Another page</p>');
      main.innerHTML = kept;
      close();
      expect($(doc, '.rf-answer')).toBeNull();
      expect(text($(doc, '#stu-tab-profile .stu-tab-sub'))).not.toBe('1 question to answer');
    });
  });
});

describe('one answer clears all three', () => {
  it('the dot, the card and the profile’s question are gone; the student’s words are unchanged', () => {
    gradebookHtml(on, doc => expect($$(doc, '.gb-scores-cell .gb-question').length).toBe(1));
    dashboardHtml(on, doc => expect($(doc, '#dash-questions')).not.toBeNull());
    profileHtml(on, JORDAN, doc => expect($(doc, '.rf-answer')).not.toBeNull());
    const answered = () => {
      on();
      answerReflection(CID, jordansQuestion().id, 'The onion cells sit in rows, like bricks.', 'k-clear');
      expect(getQuestionsWaiting(CID)).toEqual([]);
    };
    gradebookHtml(answered, doc => {
      expect($$(doc, '.gb-scores-cell .gb-question').length).toBe(0);
      expect($(doc, '.gb-questions-btn')).toBeNull();
    });
    dashboardHtml(answered, doc => expect($(doc, '#dash-questions')).toBeNull());
    profileHtml(answered, JORDAN, doc => {
      expect(text($(doc, '#stu-tab-profile .stu-tab-sub'))).not.toMatch(/question/);
      expect($(doc, '.rf-answer')).toBeNull();
      expect($(doc, '.lp-so-far-ask')).toBeNull();
      expect($(doc, '#lp-feedback .qw-b').textContent).toBe(
        'How do I know which cell is which? They look the same to me.',
      );
      expect(text($(doc, '#lp-feedback .rf-you'))).toMatch(/The onion cells sit in rows, like bricks\.$/);
    });
  });
});

describe('a student’s words are escaped on every screen', () => {
  const prep = () => {
    on();
    ceceAsks();
  };
  it('the dashboard and the profile show them exactly; the gradebook shows only the dot', () => {
    dashboardHtml(prep, doc => {
      expect($$(doc, '.dash-questions-text').map(el => el.textContent)).toContain(ODD);
      expect($(doc, '#dash-questions b')).toBeNull();
    });
    profileHtml(prep, 'st1', doc => {
      expect($(doc, '#lp-feedback .qw-b').textContent).toBe(ODD);
      expect($(doc, '#lp-feedback b')).toBeNull();
    });
    gradebookHtml(prep, doc => {
      expect($$(doc, '.gb-scores-cell .gb-question').length).toBe(2);
      expect(text($(doc, '.gb-questions-btn'))).toBe('2 questions');
    });
  });
});
