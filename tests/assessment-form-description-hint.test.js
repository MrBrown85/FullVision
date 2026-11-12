/**
 * The assessment form's Description box says who reads it (S4-W1
 * follow-up, Colin's ruling 111: "Yes with the hint").
 *
 * Once the student page is sent each assessment's Description, a student in
 * a class whose Student Page is on reads it on their page. So, in that class
 * only, one line sits under the box: "Students see this on their page."
 * (Colin's words, approved, ruling 111.)
 *
 * 1. With the class's Student Page off the form is byte for byte what it
 *    was before this change: tests/fixtures/assessment-form-page-off.json
 *    holds the edit form as origin/main drew it (commit aae1c921), in Demo
 *    Mode and signed in, for a piece with a Description and one without.
 *    It was written by this file's own walk on that commit:
 *      UPDATE_ASSESSMENT_FORM_SNAPSHOT=1 npx vitest run tests/assessment-form-description-hint.test.js
 *    Run that only on code from before a change the form is meant to keep
 *    out; never to make a failing comparison pass.
 * 2. With it on (Demo Mode, and signed in with the server agreeing) the
 *    line is there, right under the box, and nothing else on the form moved.
 */
import './setup.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  openAssignments,
  closePages,
  serverSaysStudentPageOn,
} from './helpers/pin-save-paths.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'assessment-form-page-off.json');
const UPDATE = process.env.UPDATE_ASSESSMENT_FORM_SNAPSHOT === '1';

const CID = U(1);
const AVA = U(11);
const QUESTION = U(41);
const ESSAY = U(31); // has a Description
const QUIZ = U(32); // has none
const HINT = 'Students see this on their page.';

function seedWith(config) {
  return () => {
    seedClass(CID, {
      students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
      learningMaps: {
        subjects: [],
        sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        {
          id: ESSAY,
          title: 'Essay',
          description: 'Argue one side of the debate.',
          tagIds: [QUESTION],
          date: '2026-10-10',
          type: 'summative',
        },
        { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      ],
      courseConfigs: config || {},
    });
  };
}

const settled = () => new Promise(r => setTimeout(r, 10));

/* The edit form of each piece, as HTML. */
async function walk(config) {
  const out = {};
  for (const [name, aid] of [
    ['Essay, with a Description', ESSAY],
    ['Quiz, no Description', QUIZ],
  ]) {
    openAssignments(seedWith(config), CID);
    await settled();
    click(document.querySelector('[data-action="editAssess"][data-aid="' + aid + '"]'));
    await settled();
    out[name] = document.getElementById('new-assess-form').innerHTML;
    closePages();
    clearClass(CID);
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  serverSaysStudentPageOn(CID, false);
});

describe('with the Student Page off the assessment form is what it was', () => {
  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', async () => {
      const demo = await walk();
      const session = signIn();
      try {
        // Signed in, the switch saved but the server not agreeing: still off.
        const signedIn = await walk({ student_page_enabled: true });
        Object.keys(demo).forEach(name => expect(signedIn[name], name).toBe(demo[name]));
      } finally {
        session.signOut();
      }
      writeFileSync(SNAPSHOT, JSON.stringify(demo, null, 2) + '\n');
    });
    return;
  }
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};

  it('has the snapshot', () => {
    expect(Object.keys(before)).toEqual(['Essay, with a Description', 'Quiz, no Description']);
  });

  it('in Demo Mode', async () => {
    const now = await walk();
    Object.keys(before).forEach(name => expect(now[name], name).toBe(before[name]));
    Object.values(now).forEach(html => expect(html).not.toContain(HINT));
  });

  it('signed in, with the switch saved but the server not agreeing', async () => {
    const session = signIn();
    try {
      const now = await walk({ student_page_enabled: true });
      Object.keys(before).forEach(name => expect(now[name], name).toBe(before[name]));
    } finally {
      session.signOut();
    }
  });
});

describe('with the Student Page on the form says students see the Description', () => {
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};
  const HINT_HTML = '<p class="af-category-hint" id="af-desc-hint">' + HINT + '</p>';
  // The form with the hint taken out is the form with the page off. Handouts and Links
  // (assessment-handouts.test.js) is the other field a class whose students read the page has.
  const RES_FIELD = /<div class="af-field af-res" id="af-res"[\s\S]*?<p class="af-res-msg"[^>]*>[^<]*<\/p><\/div>/;
  const withoutHint = html =>
    html.replace(RES_FIELD, '').replace(HINT_HTML, '').replace(' aria-describedby="af-desc-hint"', '');

  async function check(config) {
    const now = await walk(config);
    Object.keys(before).forEach(name => {
      const html = now[name];
      expect(html.split(HINT).length - 1, name).toBe(1);
      // Right under the box, inside the Description's field, read with it.
      expect(html, name).toMatch(/<textarea class="af-textarea" id="af-desc"[^>]*aria-describedby="af-desc-hint"/);
      expect(html, name).toContain('</textarea>' + HINT_HTML + '</div>');
      expect(withoutHint(html), name).toBe(before[name]);
    });
  }

  it('in Demo Mode', async () => {
    await check({ student_page_enabled: true });
  });

  it('signed in, with the server agreeing', async () => {
    const session = signIn();
    try {
      serverSaysStudentPageOn(CID, true);
      await check({ student_page_enabled: true });
    } finally {
      session.signOut();
    }
  });
});
