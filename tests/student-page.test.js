/**
 * The student phone page (s/student.js; docs/STUDENT-VOICE-PLAN.md, PR 7),
 * in linkedom with a stand-in fetch. Opens a code, renders each question
 * type, collects answers in the shape student_submit.submit takes, retries
 * once with a fresh token when the 80-minute one has run out, and keeps
 * Demo Mode off the network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { parseHTML } from 'linkedom';

const ROOT = resolve(__dirname, '..');
// tests/setup.js (the global setup file) has loaded shared/questionnaire-templates.js.
runInThisContext(readFileSync(resolve(ROOT, 's/student.js'), 'utf8'));
// shared/phone-report-view.js is loaded by tests/setup.js too.
const T = globalThis.StudentPage._test;

const PARTS = [
  {
    id: 'p1',
    kind: 'core_reflection',
    title: 'November Reflection',
    theme: 'Self-Awareness and Goal Setting',
    grade: 8,
    questions: [
      {
        id: 'q1',
        kind: 'short_set',
        prompt: 'My Personal Shield',
        options: { labels: ['A strength', 'An interest'] },
        core_ids: [],
      },
      { id: 'q2', kind: 'text', prompt: 'How can these help you in this class?', options: {}, core_ids: [] },
      { id: 'q3', kind: 'scale4', prompt: 'How confident do you feel?', options: {}, core_ids: ['PAR', 'PPI'] },
    ],
  },
  {
    id: 'p2',
    kind: 'goal_checkin',
    title: 'Goal Check-In',
    questions: [
      {
        id: 'g1',
        kind: 'goal_status',
        prompt: 'How is your goal going?',
        options: { choices: ['Not Started', 'Working On It', 'Mostly There', 'Done'] },
        core_ids: [],
      },
      { id: 'g2', kind: 'text', prompt: 'What will you do next?', options: {}, core_ids: [] },
      { id: 'g3', kind: 'core_pick', prompt: 'Which one?', options: {}, core_ids: [] },
    ],
  },
];
const OPEN = {
  ok: true,
  token: 'a'.repeat(64),
  student: { first_name: 'Cece' },
  course: { name: 'Science 8', block: 'B' },
  parts: PARTS,
  context: { course_goal: { text: 'Hand in labs on time.', at: '2026-09-15T12:00:00Z' } },
};

let calls;
let replies;
let originals;
let root;

function setup() {
  const { document, window } = parseHTML('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  originals = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    history: globalThis.history,
    location: globalThis.location,
    sessionStorage: globalThis.sessionStorage,
    scrollTo: globalThis.scrollTo,
  };
  const store = {};
  globalThis.document = document;
  globalThis.window = Object.assign(window, { __ENV: { SUPABASE_URL: 'https://x.supabase.co' }, scrollTo() {} });
  globalThis.scrollTo = () => {};
  globalThis.history = { replaceState() {} };
  globalThis.location = { pathname: '/s/', hash: '' };
  globalThis.sessionStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: k => delete store[k],
  };
  calls = [];
  replies = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = replies.length ? replies.shift() : { ok: true };
    return { json: async () => r };
  };
  root = document.getElementById('app');
}

const tick = () => new Promise(r => setTimeout(r, 0));
const click = sel => {
  const el = root.querySelector(sel);
  expect(el, sel).toBeTruthy();
  el.dispatchEvent(new globalThis.window.Event('click', { bubbles: true }));
};
const type = (sel, value) => {
  const el = root.querySelector(sel);
  expect(el, sel).toBeTruthy();
  el.value = value;
  el.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));
};

describe('student page', () => {
  beforeEach(setup);
  afterEach(() => Object.assign(globalThis, originals));

  it('opens the code from the address, pinned to Canada, and asks if it is them', async () => {
    replies.push(OPEN);
    T.start(root, '#k7m-4qx');
    await tick();
    expect(calls[0].url).toBe('https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1');
    expect(calls[0].body).toEqual({ route: 'open', code: 'K7M4QX' });
    expect(root.querySelector('.sp-big').textContent).toBe('Hi Cece!');
    expect(root.querySelector('.sp-head-title').textContent).toBe('Science 8 · Block B');
    expect(root.textContent).toContain('November Reflection and Goal Check-In');
    expect(root.textContent).toContain('6 questions');
  });

  it('a malformed code never leaves the phone; a refused one says why', async () => {
    T.start(root, '');
    type('#sp-code', 'HELLO');
    root.querySelector('form').dispatchEvent(new globalThis.window.Event('submit', { bubbles: true }));
    await tick();
    expect(calls).toHaveLength(0);
    expect(root.querySelector('.sp-msg').textContent).toContain("didn't work");
    replies.push({ ok: false, error: 'used' });
    type('#sp-code', 'abc-234');
    root.querySelector('form').dispatchEvent(new globalThis.window.Event('submit', { bubbles: true }));
    await tick();
    expect(calls[0].body.code).toBe('ABC234');
    expect(root.textContent).toContain('already been used');
    replies.push({ ok: false, error: 'not_open_yet', opens_on: '2026-11-03' });
    type('#sp-code', 'abc-234');
    root.querySelector('form').dispatchEvent(new globalThis.window.Event('submit', { bubbles: true }));
    await tick();
    expect(root.textContent).toContain('These questions open on November 3.');
  });

  it('renders each question type and collects answers the way submit takes them', async () => {
    replies.push(OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="start"]');
    expect(root.querySelector('.sp-kicker').textContent).toBe('Personal & Social · Grade 8');
    expect(root.textContent).toContain('How can these help you in Science 8?');
    type('[data-kind="short_set"][data-i="1"]', 'Soccer');
    type('[data-q="q2"][data-kind="text"]', '  Curious helps in labs.  ');
    click('[data-act="step"][data-core="PAR"][data-value="2"]');
    type('textarea[data-kind="why"][data-core="PAR"]', 'I forget to check my goals.');
    expect(root.querySelector('#sp-count').textContent).toBe('3 of 6 answered');
    click('[data-act="next"]');
    expect(root.textContent).toContain('My Science 8 Goal');
    expect(root.textContent).toContain('You wrote in September');
    expect(root.textContent).toContain('Hand in labs on time.');
    click('[data-act="pick"][data-q="g1"][data-value="Working On It"]');
    click('[data-act="pick"][data-q="g3"][data-value="COL"]');
    expect(T.collect(T.state())).toEqual({
      q1: ['', 'Soccer'],
      q2: 'Curious helps in labs.',
      q3: { levels: { PAR: 2 }, why: { PAR: 'I forget to check my goals.' } },
      g1: 'Working On It',
      g3: 'COL',
    });
    replies.push({ ok: true, submitted_at: '2026-11-04T10:00:00Z' });
    click('[data-act="send"]');
    await tick();
    await tick();
    expect(calls[1].body).toMatchObject({ route: 'submit', token: 'a'.repeat(64) });
    expect(calls[1].body.answers.g3).toBe('COL');
    expect(root.querySelector('.sp-big').textContent).toBe('Sent to Your Teacher');
    expect(root.textContent).toContain('It will be part of your report.');
  });

  it('a token that ran out is renewed once with the same code, then the answers go', async () => {
    replies.push(OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="start"]');
    type('[data-q="q2"][data-kind="text"]', 'Something');
    click('[data-act="next"]');
    replies.push({ ok: false, error: 'expired' }, Object.assign({}, OPEN, { token: 'b'.repeat(64) }), { ok: true });
    click('[data-act="send"]');
    for (let i = 0; i < 6; i++) await tick();
    expect(calls.map(c => c.body.route)).toEqual(['open', 'submit', 'open', 'submit']);
    expect(calls[3].body.token).toBe('b'.repeat(64));
    expect(root.querySelector('.sp-big').textContent).toBe('Sent to Your Teacher');
  });

  it('nothing answered is caught before sending; a network failure keeps the answers', async () => {
    replies.push(OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="start"]');
    click('[data-act="next"]');
    click('[data-act="send"]');
    await tick();
    expect(calls).toHaveLength(1);
    expect(root.querySelector('.sp-msg').textContent).toBe('Answer at least one question before you send.');
    click('[data-act="back"]');
    type('[data-q="q2"][data-kind="text"]', 'Kept');
    click('[data-act="next"]');
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    click('[data-act="send"]');
    for (let i = 0; i < 4; i++) await tick();
    expect(root.querySelector('.sp-msg').textContent).toContain('Your answers are still here.');
    expect(T.state().answers.q2).toBe('Kept');
  });

  it('No, That’s Not Me tells them to give the slip back', async () => {
    replies.push(OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="notme"]');
    expect(root.textContent).toContain('Give This Slip Back');
  });

  it('Demo Mode builds the questions from the templates and never calls the function', async () => {
    T.start(root, '#demo-about');
    await tick();
    expect(root.querySelector('.sp-big').textContent).toBe('Hi Cece!');
    click('[data-act="start"]');
    expect(root.textContent).toContain('Only your teacher sees this');
    expect(root.textContent).toContain('Your course goal · Asked again in January and June');
    expect(root.querySelector('#sp-count').textContent).toBe('0 of 7 answered');
    click('[data-act="choice"][data-value="English"]');
    click('[data-act="other-open"]');
    root.querySelector('input[id$="-other"]').value = 'Igbo';
    click('[data-act="other-add"]');
    click('[data-act="send"]');
    await tick();
    expect(calls).toHaveLength(0);
    expect(root.textContent).toContain('This was Demo Mode. Nothing was sent.');
    expect(T.state().answers[Object.keys(T.state().answers)[0]]).toEqual(['English', 'Igbo']);
  });

  it('a draft survives a reload in the same tab and is cleared once sent', async () => {
    replies.push(OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="start"]');
    type('[data-q="q2"][data-kind="text"]', 'Half written');
    expect(sessionStorage.getItem('fv-s-draft-K7M4QX')).toContain('Half written');
    const fresh = root.cloneNode(false);
    root.replaceWith(fresh);
    root = fresh;
    replies.push(OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="start"]');
    expect(root.querySelector('[data-q="q2"][data-kind="text"]').value).toBe('Half written');
    click('[data-act="next"]');
    click('[data-act="send"]');
    for (let i = 0; i < 3; i++) await tick();
    expect(sessionStorage.getItem('fv-s-draft-K7M4QX')).toBeNull();
  });
});

describe('student page: a report on the phone', () => {
  const REPORT_OPEN = {
    ok: true,
    kind: 'report',
    token: 'a'.repeat(64),
    student: { first_name: 'Cece' },
    course: { name: 'Science 8', block: 'B' },
    report: { title: 'Report 1', expires_on: '2027-01-31' },
    has_birthday: true,
  };
  const REPLY = {
    id: 'rq',
    kind: 'report_reply',
    title: 'Reply to Report 1',
    questions: [
      { id: 'r1', kind: 'text', prompt: 'What are you most proud of?', options: {}, core_ids: [] },
      {
        id: 'r3',
        kind: 'choice',
        prompt: 'Your goal: keep it or change it?',
        options: { choices: ['Keep It', 'Change It'], multiple: false },
        core_ids: [],
      },
      { id: 'r4', kind: 'text', prompt: 'One thing you will do before the next report', options: {}, core_ids: [] },
    ],
  };
  const COPY = {
    name: 'Cece Okafor',
    first: 'Cece',
    course: 'Science 8',
    report: 'Report 1',
    overall: { mode: 'proficiency', text: '3.0', level: 3, word: 'Proficient' },
    goal: { text: 'Hand in labs on time.', status: 'Working On It' },
  };
  beforeEach(setup);
  afterEach(() => Object.assign(globalThis, originals));
  const pickBirthday = () => {
    root.querySelector('#sp-bm option[value="5"]').setAttribute('selected', '');
    root.querySelector('#sp-bd option[value="15"]').setAttribute('selected', '');
    root.querySelector('#sp-by option[value="2012"]').setAttribute('selected', '');
  };

  it('a report code asks for the birthday first, and says how long the link works', async () => {
    replies.push(REPORT_OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    expect(root.querySelector('.sp-big').textContent).toBe('Your report is ready, Cece');
    expect(root.querySelector('.sp-head-title').textContent).toBe('Science 8 · Block B');
    expect(root.querySelector('.sp-fine').textContent).toBe(
      'This link works until Jan 31. Keep your slip private, like a password.',
    );
    expect(root.querySelectorAll('.sp-bday select')).toHaveLength(3);
  });

  it('no birthday on file: no pickers, just what to do', async () => {
    replies.push(Object.assign({}, REPORT_OPEN, { has_birthday: false }));
    T.start(root, '#K7M4QX');
    await tick();
    expect(root.querySelector('.sp-bday')).toBeNull();
    expect(root.textContent).toContain('Ask your teacher.');
    expect(root.querySelector('[data-act="rcheck"]')).toBeNull();
  });

  it('a wrong birthday says so with the tries left; the right one opens the report as sent', async () => {
    replies.push(REPORT_OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    click('[data-act="rcheck"]');
    await tick();
    expect(calls).toHaveLength(1);
    expect(root.querySelector('.sp-msg').textContent).toBe('Choose the month, day and year you were born.');
    pickBirthday();
    replies.push({ ok: false, error: 'wrong_birthday', tries_left: 3 });
    click('[data-act="rcheck"]');
    for (let i = 0; i < 3; i++) await tick();
    expect(calls[1].body).toEqual({ route: 'check', token: 'a'.repeat(64), birthday: '2012-05-15' });
    expect(root.querySelector('.sp-msg').textContent).toBe(
      "That birthday doesn't match. Check the month, day and year. 3 tries left.",
    );
    expect(root.querySelector('#sp-bm').value).toBe('5');
    replies.push({ ok: true, report: COPY, reply: REPLY, replied_at: null });
    click('[data-act="rcheck"]');
    for (let i = 0; i < 3; i++) await tick();
    expect(root.querySelector('.pr-big').textContent).toBe('Proficient');
    expect(root.querySelector('[data-act="reply"]').textContent).toBe('Reply to Your Report');
  });

  it('the reply names their goal, sends once, and leads back to the report', async () => {
    replies.push(REPORT_OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    pickBirthday();
    replies.push({ ok: true, report: COPY, reply: REPLY, replied_at: null });
    click('[data-act="rcheck"]');
    for (let i = 0; i < 3; i++) await tick();
    click('[data-act="reply"]');
    expect(root.querySelector('.sp-head-sub').textContent).toBe('Science 8 · Report 1 · Only your teacher sees this');
    expect(root.textContent).toContain('Your goal: Hand in labs on time.');
    type('[data-q="r1"][data-kind="text"]', 'my biodiversity journal');
    click('[data-act="choice"][data-q="r3"][data-value="Keep It"]');
    type('[data-q="r4"][data-kind="text"]', 'start the data table at lunch');
    replies.push({ ok: true, submitted_at: '2026-11-22T18:00:00Z' });
    click('[data-act="send"]');
    for (let i = 0; i < 3; i++) await tick();
    expect(calls[2].body).toEqual({
      route: 'submit',
      token: 'a'.repeat(64),
      answers: { r1: 'my biodiversity journal', r3: ['Keep It'], r4: 'start the data table at lunch' },
    });
    expect(root.textContent).toContain('Your next step is saved with your goal.');
    click('[data-act="to-report"]');
    expect(root.querySelector('[data-act="reply"]')).toBeNull();
    expect(root.textContent).toContain('You replied on Nov 22. Thanks.');
  });

  it('a session that ran out while they wrote opens again, checks the birthday again, then sends', async () => {
    replies.push(REPORT_OPEN);
    T.start(root, '#K7M4QX');
    await tick();
    pickBirthday();
    replies.push({ ok: true, report: COPY, reply: REPLY, replied_at: null });
    click('[data-act="rcheck"]');
    for (let i = 0; i < 3; i++) await tick();
    click('[data-act="reply"]');
    type('[data-q="r1"][data-kind="text"]', 'proud');
    replies.push(
      { ok: false, error: 'expired' },
      Object.assign({}, REPORT_OPEN, { token: 'b'.repeat(64) }),
      { ok: true, report: COPY, reply: REPLY },
      { ok: true },
    );
    click('[data-act="send"]');
    for (let i = 0; i < 8; i++) await tick();
    expect(calls.slice(2).map(c => c.body.route)).toEqual(['submit', 'open', 'check', 'submit']);
    expect(calls[4].body).toEqual({ route: 'check', token: 'b'.repeat(64), birthday: '2012-05-15' });
    expect(root.textContent).toContain('Sent to Your Teacher');
  });

  it('Demo Mode shows a sample report and reply with no request', async () => {
    T.start(root, '#demo-report');
    await tick();
    pickBirthday();
    click('[data-act="rcheck"]');
    await tick();
    expect(root.querySelector('.pr-name').textContent).toBe('Cece Adeyemi');
    click('[data-act="reply"]');
    type('textarea[data-kind="text"]', 'my journal');
    click('[data-act="send"]');
    await tick();
    expect(calls).toHaveLength(0);
    expect(root.textContent).toContain('This was Demo Mode. Nothing was sent.');
  });
});
