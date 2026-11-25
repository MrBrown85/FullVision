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
['s/student.js', 's/question-kinds.js', 's/questionnaire.js'].forEach(f =>
  runInThisContext(readFileSync(resolve(ROOT, f), 'utf8')),
);
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
  // A slip locked in one test is remembered on the "phone"; start clean.
  localStorage.clear();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const r = replies.length ? replies.shift() : { ok: true };
    // A fresh object each time, as a real response is.
    return { json: async () => JSON.parse(JSON.stringify(r)) };
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

/* The questions on screen, as a student's card hands them over (a real card's `form`, or here Demo Mode's
   start with the parts swapped for these): the page's own screens, with nothing asked of a server. */
async function openParts(data) {
  T.start(root, '#demo-about');
  await tick();
  const st = T.state();
  st.data = JSON.parse(JSON.stringify(data));
  st.answers = {};
  st.part = 0;
}

describe('student page', () => {
  beforeEach(setup);
  afterEach(() => Object.assign(globalThis, originals));

  it('renders each question type and collects answers the way submit takes them', async () => {
    await openParts(OPEN);
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
  });

  it('with no course goal written, the check-in says so instead of asking how the goal is going', async () => {
    await openParts(Object.assign({}, OPEN, { context: {} }));
    click('[data-act="start"]');
    expect(root.querySelector('#sp-count').textContent).toBe('0 of 4 answered');
    click('[data-act="next"]');
    expect(root.textContent).toContain(
      'You haven’t written a Science 8 goal yet, so there is nothing to check on here.',
    );
    expect(root.textContent).not.toContain('How is your goal going?');
    expect(root.querySelector('[data-q="g1"]')).toBeNull();
    expect(root.querySelector('[data-act="pick"][data-q="g3"]')).toBeTruthy();
  });

  it('a set of choices is one Tab stop, and the arrow keys choose within it', async () => {
    await openParts(OPEN);
    click('[data-act="start"]');
    const steps = () => Array.from(root.querySelectorAll('[data-act="step"][data-core="PAR"]'));
    expect(steps().map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    const key = (el, k) => {
      const e = new globalThis.window.Event('keydown', { bubbles: true, cancelable: true });
      e.key = k;
      el.dispatchEvent(e);
      return e;
    };
    expect(key(steps()[0], 'ArrowRight').defaultPrevented).toBe(true);
    expect(T.collect(T.state()).q3).toEqual({ levels: { PAR: 2 } });
    expect(steps().map(b => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
    key(steps()[1], 'End');
    expect(T.collect(T.state()).q3.levels.PAR).toBe(4);
    key(steps()[3], 'ArrowRight');
    expect(T.collect(T.state()).q3.levels.PAR).toBe(1);
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
});

describe('typing an answer (speed)', () => {
  beforeEach(setup);
  afterEach(() => Object.assign(globalThis, originals));

  it('sets every box’s height after reading them all: one layout, not one a box', () => {
    const log = [];
    const box = name => ({
      style: {
        set height(v) {
          log.push('set ' + name);
        },
      },
      get scrollHeight() {
        log.push('read ' + name);
        return 40;
      },
    });
    StudentPage._test.growAll([box('a'), box('b'), box('c')]);
    // Before: set a, read a, set a, set b, read b, set b... (a layout forced at each read after a set).
    expect(log).toEqual(['set a', 'set b', 'set c', 'read a', 'read b', 'read c', 'set a', 'set b', 'set c']);
  });
});
