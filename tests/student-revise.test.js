/**
 * Revisions on the student's page (S11-F2; s/page-view.js, s/send.js,
 * s/feedback.js, shared/student-view.js): Needs Revision on its card, first
 * in Outstanding, and on Your Feedback; Send My Revision through the send
 * screens, then a Sent row on My Learning whose card has Unsend and Replace
 * only until grading starts; Before and After once the revision's grade is
 * returned.
 *
 * Demo Mode only (#demo-card-revise: Send Work on, a class graded by
 * both). A real card's page shows none of it: the server sends no
 * revision yet. The page runs as a browser loads it
 * (tests/helpers/student-page-context.js); nothing waits on real time.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];
const text = (page, sel) => words(q(page, sel));
const cardOf = (page, id) => q(page, '.sp-deck .sp-piece[data-piece="' + id + '"]');
const viewOf = page => page.T.viewOf(page.T.state());
const piece = (page, id) => viewOf(page).work.find(p => p.id === id);
const dayWord = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const dueWord = iso =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

function fakePrepare() {
  return () =>
    Promise.resolve({ ok: true, kind: 'jpeg', pages: [{ blob: { size: 1000 }, thumb: { size: 100 }, hash: 'h0' }] });
}

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card-revise');
  page.T.setPrepare(fakePrepare());
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  // The sample class has bulletins, so the page opens on Bulletins (B1g); these tests start on Assignments.
  await page.click('.sp-tabs-bottom [data-tab="assignments"]');
  return page;
}
const revs = page => page.T.demoRevisions(page.T.state());

// Send My Revision on the lab, one photo, a note, Send.
// The sent revision's card, from its Sent row on My Learning.
async function openSentLab(page) {
  await page.click('[data-tab="learning"]');
  await page.click('.sp-ml-row[data-piece="demo-lab"]');
  expect(q(page, '.sp-ml-card-open .sp-piece[data-piece="demo-lab"]')).not.toBeNull();
}
// Every list a student can see: Outstanding, Upcoming and My Learning.
async function everyList(page) {
  let html = '';
  for (const sel of ['[data-segment="outstanding"]', '[data-segment="upcoming"]', '[data-tab="learning"]']) {
    await page.click(sel);
    html += page.root().innerHTML;
  }
  return html;
}

async function sendRevision(page, note) {
  await page.click('.sp-piece[data-piece="demo-lab"] [data-act="revise-open"]');
  expect(text(page, '#sp-send-title')).toBe('Check and Send');
  await page.T.sendFiles([{ name: 'a.jpg' }], -1);
  await page.settle();
  if (note) page.type('#sp-send-note', note);
  await page.click('[data-act="send-go"]');
  await page.settle();
}

describe('nothing new without revisions: every other address, and a real card', () => {
  it.each(['#demo-card', '#demo-card-send', '#demo-card-reflect', '#demo-card-group'])(
    '%s: no revision in the replies, no Needs Revision anywhere',
    async hash => {
      const page = await demo(hash);
      const fb = page.T.feedbackOf(page.T.state());
      expect(JSON.stringify(fb || {})).not.toMatch(/"revision":\{/);
      expect(page.T.demoRevisions(page.T.state())).toBeNull();
      expect(viewOf(page).work.every(p => p.revision === null && p.kind !== 'revise')).toBe(true);
      expect(await everyList(page)).not.toMatch(/Needs Revision|sp-revise|Before and After|Send My Revision/);
      expect(viewOf(page).changes.some(c => c.why === 'revise')).toBe(false);
      expect(page.calls).toEqual([]);
    },
  );

  it('a real card (not Demo Mode): the page asks for and reads no revision, and draws nothing new', async () => {
    const page = await demo();
    const real = Object.assign({}, page.T.state(), { demo: false });
    expect(page.T.feedbackOf(real)).toBeNull();
    expect(page.T.workOf(real)).toBeNull();
    expect(page.T.demoRevisions(real)).toBeNull();
    // The server's page today, as the same card gets it: nothing about revisions.
    const view = page.T.viewOf(real);
    expect(view.work.some(p => p.revision || p.kind === 'revise')).toBe(false);
  });

  it('a feedback reply of the wrong shape reads as no revision', () => {
    const reply = {
      student: {},
      course: {},
      assessments: [{ id: 'a1', title: 'One', date: '2026-11-01', due_date: '2026-11-09' }],
    };
    const odd = [
      { ok: true, assessments: [{ id: 'a1', revision: { state: 'open' } }] }, // no What to Fix
      { ok: true, assessments: [{ id: 'a1', revision: { state: 'grading', what_to_fix: 'Fix it.' } }] },
      { ok: true, assessments: [{ id: 'a1', revision: 'open' }] },
      { ok: false, assessments: [{ id: 'a1', revision: { state: 'open', what_to_fix: 'Fix it.' } }] },
    ];
    odd.forEach(fb => {
      const v = StudentView.build(reply, 'c', null, null, fb);
      expect(v.work[0].revision).toBeNull();
      expect(v.work[0].kind).toBe('due');
    });
  });
});

describe('Needs Revision (the board "Student: Needs Revision")', () => {
  it('the card in Outstanding: Revise By, Your Teacher and What to Fix, the criterion, Your First Version, Send My Revision', async () => {
    const page = await demo();
    const by = revs(page)['demo-lab'].revise_by;
    // The lab, the Missing quick check and the poster past its due date.
    expect(text(page, '[data-segment="outstanding"]')).toBe('Outstanding 4');
    expect(StudentPageView.segmentOf(piece(page, 'demo-lab'), viewOf(page))).toBe('outstanding');
    const card = cardOf(page, 'demo-lab');
    expect(card).not.toBeNull();
    expect(words(card.querySelector('.sp-flag-revise'))).toBe('Revise by ' + dueWord(by));
    expect(words(card.querySelector('.sp-revise-who'))).toBe('Your Teacher');
    expect(words(card.querySelector('.sp-revise-fix'))).toBe(
      'Write the magnification beside each drawing, then send it again.',
    );
    expect(words(card.querySelector('.sp-revise-crit-title'))).toBe('Revise');
    expect([...card.querySelectorAll('.sp-revise-crit-name')].map(words)).toEqual(['Labelled Drawing']);
    expect(words(card.querySelector('.sp-revise-first'))).toBe('Your First Version');
    expect(card.querySelector('.sp-send-thumb').getAttribute('alt')).toBe('First version, page 1');
    expect(words(card.querySelector('[data-act="revise-open"]'))).toBe('Send My Revision');
    // The grade was kept: See Your Feedback still opens it, as the quieter button (one primary on the card).
    expect(words(card.querySelector('[data-act="feedback"]'))).toBe('See Your Feedback');
    expect(card.querySelectorAll('.sp-btn-primary')).toHaveLength(1);
    expect(card.querySelector('[data-act="feedback"]').classList.contains('sp-btn-tint')).toBe(true);
    // Needs Revision leads Outstanding, before older due dates.
    expect(qa(page, '.sp-deck .sp-piece').map(c => c.getAttribute('data-piece'))).toEqual([
      'demo-lab',
      'demo-quick',
      'demo-poster',
      'demo-quiz-check',
    ]);
    // Never the teacher's name.
    expect(page.root().innerHTML).not.toMatch(/Rivera/);
  });

  it('the list beside the cards and the Assignments tab say a revision was asked for', async () => {
    const page = await demo();
    const by = revs(page)['demo-lab'].revise_by;
    // The Chromebook's list: the lab first, "Needs Revision · due Nov 17".
    const side = qa(page, '.sp-side-row');
    expect(side[0].getAttribute('data-piece')).toBe('demo-lab');
    expect(words(side[0].querySelector('.sp-row-sub'))).toBe('Needs Revision · due ' + dayWord(by));
    expect(page.T.rowView(piece(page, 'demo-lab')).sub).toBe('Needs Revision · due ' + dayWord(by));
    // What changed since the student last looked: the revision is Assignments' badge, not My Learning's.
    expect(
      viewOf(page)
        .changes.filter(c => c.why === 'revise')
        .map(c => c.id),
    ).toEqual(['demo-lab']);
    const tab = q(page, '.sp-tabs-bottom [data-tab="assignments"]');
    expect(words(tab.querySelector('.sp-tab-badge'))).toBe('1');
    expect(words(tab.querySelector('.sp-hidden-title'))).toBe('1 new');
    // Not a row on My Learning: it is still to do.
    await page.click('[data-tab="learning"]');
    expect(q(page, '.sp-ml-row[data-piece="demo-lab"]')).toBeNull();
  });

  it('Your Feedback on it: What to Fix and Send My Revision above the grade the student was given', async () => {
    const page = await demo();
    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="feedback"]');
    expect(text(page, '#sp-fb-title')).toBe('Cell Microscope Lab');
    expect(text(page, '.sp-fb-sub')).toBe('Revise by ' + dueWord(revs(page)['demo-lab'].revise_by));
    // It lives on Assignments, so that is the way back.
    expect(text(page, '.sp-fb-back')).toBe('Assignments');
    expect(text(page, '.sp-revise-fb .sp-revise-fix')).toBe(
      'Write the magnification beside each drawing, then send it again.',
    );
    expect(q(page, '.sp-revise-fb [data-act="revise-open"]')).not.toBeNull();
    expect(q(page, '.sp-fb-card[aria-labelledby="sp-fb-result"]')).not.toBeNull();
    // Reflect on Feedback is for returned work only.
    expect(q(page, '[data-act="reflect-open"]')).toBeNull();
  });
});

describe('Send My Revision, with Unsend and Replace until grading starts', () => {
  it('Check and Send, Sent, then the piece is a Sent row on My Learning; Unsend puts it back to Needs Revision', async () => {
    const page = await demo();
    await sendRevision(page, 'I wrote 400x beside each drawing.');
    expect(text(page, '#sp-send-title')).toBe('Sent to Your Teacher');
    const r = revs(page)['demo-lab'].revision;
    expect(r).toMatchObject({ note: 'I wrote 400x beside each drawing.', late: false, grading: false });
    expect(r.pages).toHaveLength(1);
    // Nothing went into the ordinary sends.
    expect(page.T.state().demoSent).toEqual({});
    await page.click('[data-act="send-done"]');
    expect(text(page, '[data-segment="outstanding"]')).toBe('Outstanding 3');
    expect(cardOf(page, 'demo-lab')).toBeNull();
    await page.click('[data-tab="learning"]');
    const row = q(page, '.sp-ml-row[data-piece="demo-lab"]');
    // Work sent goes first in Your Work.
    expect(q(page, '.sp-ml-work .sp-ml-row')).toBe(row);
    expect(words(row.querySelector('.sp-row-sub'))).toMatch(
      /^Sent \S+ \d+, \d{1,2}:\d\d [ap]\.m\. · waiting for feedback$/,
    );
    expect(words(row.querySelector('.sp-level'))).toBe('Sent');
    await page.click('.sp-ml-row[data-piece="demo-lab"]');
    const card = cardOf(page, 'demo-lab');
    expect(words(card.querySelector('.sp-send-line'))).toBe(
      'Your teacher hasn’t started grading it. You can still change it.',
    );
    expect([...card.querySelectorAll('.sp-send-change .sp-btn')].map(words)).toEqual(['Replace Photos', 'Unsend']);
    expect(card.querySelector('.sp-revise')).toBeNull();
    // The grade the student had stays theirs to see while the new one is not back.
    expect(words(card.querySelector('[data-act="feedback"]'))).toBe('See Your Feedback');
    expect(piece(page, 'demo-lab').revision.state).toBe('sent');
    expect(page.T.feedbackOf(page.T.state()).assessments.find(a => a.id === 'demo-lab').revision.state).toBe('sent');

    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="send-unsend"]');
    expect(text(page, '#sp-send-ask-title')).toBe('Unsend Your Work?');
    await page.click('[data-act="send-ask-yes"]');
    expect(revs(page)['demo-lab'].revision).toBeNull();
    expect(piece(page, 'demo-lab').kind).toBe('revise');
    // Back to its card, first in Outstanding.
    expect(page.T.state()).toMatchObject({ tab: 'assignments', segment: 'outstanding', card: '' });
    expect(text(page, '[data-segment="outstanding"]')).toBe('Outstanding 4');
    expect(q(page, '.sp-deck .sp-piece').getAttribute('data-piece')).toBe('demo-lab');
    expect(cardOf(page, 'demo-lab').querySelector('[data-act="revise-open"]')).not.toBeNull();
    expect(page.calls).toEqual([]);
  });

  it('Replace takes the new photos in place of the revision sent', async () => {
    const page = await demo();
    await sendRevision(page);
    await page.click('[data-act="send-done"]');
    await openSentLab(page);
    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="send-replace"]');
    await page.click('[data-act="send-ask-yes"]');
    expect(page.T.state().send.revision).toBe(true);
    await page.T.sendFiles([{ name: 'b.jpg' }], -1);
    await page.settle();
    page.type('#sp-send-note', 'Second try.');
    await page.click('[data-act="send-go"]');
    await page.settle();
    expect(revs(page)['demo-lab'].revision.note).toBe('Second try.');
  });

  it('once the teacher starts grading it: no Unsend or Replace, even from a card drawn before', async () => {
    const page = await demo();
    await sendRevision(page);
    await page.click('[data-act="send-done"]');
    await openSentLab(page);
    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="send-unsend"]');
    // The teacher starts grading while the question is open (a grade changed, or her marks on a page).
    revs(page)['demo-lab'].revision.grading = true;
    await page.click('[data-act="send-ask-yes"]');
    expect(revs(page)['demo-lab'].revision).not.toBeNull();
    const card = cardOf(page, 'demo-lab');
    expect(words(card.querySelector('.sp-send-line'))).toBe('Your teacher is grading this');
    expect(card.querySelector('[data-act="send-unsend"], [data-act="send-replace"]')).toBeNull();
  });

  it('grading starts while a Replace is being sent: nothing is replaced, and the student is told', async () => {
    const page = await demo();
    await sendRevision(page, 'First try.');
    await page.click('[data-act="send-done"]');
    await openSentLab(page);
    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="send-replace"]');
    await page.click('[data-act="send-ask-yes"]');
    await page.T.sendFiles([{ name: 'b.jpg' }], -1);
    await page.settle();
    page.click('[data-act="send-go"]');
    revs(page)['demo-lab'].revision.grading = true;
    await page.settle();
    expect(revs(page)['demo-lab'].revision.note).toBe('First try.');
    expect(text(page, '#sp-send-title')).toBe('Check and Send');
    expect(text(page, '.sp-send-msg')).toBe('Your teacher has started grading this. Ask your teacher instead.');
  });

  it('a revision sent after Revise By says so on Check and Send and is marked Late', async () => {
    const page = await demo();
    const by = revs(page)['demo-lab'].revise_by;
    page.T.setClock(() => new Date(by + 'T12:00:00').getTime() + 2 * 864e5);
    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="revise-open"]');
    expect(text(page, '.sp-send-due')).toBe('Revise by ' + dueWord(by));
    expect(text(page, '.sp-send-late')).toBe('This will be marked Late.');
    await page.T.sendFiles([{ name: 'a.jpg' }], -1);
    await page.settle();
    await page.click('[data-act="send-go"]');
    await page.settle();
    expect(revs(page)['demo-lab'].revision.late).toBe(true);
  });

  it('a send still going when the student goes Back records nothing', async () => {
    const page = await demo();
    await page.click('.sp-piece[data-piece="demo-lab"] [data-act="revise-open"]');
    await page.T.sendFiles([{ name: 'a.jpg' }], -1);
    await page.settle();
    // Back before the pages are up: the answer finds another screen showing and draws nothing.
    page.click('[data-act="send-go"]');
    await page.click('[data-act="send-back"]');
    await page.settle();
    expect(revs(page)['demo-lab'].revision).toBeNull();
    expect(page.T.state().screen).toBe('assignments');
  });

  it('Done forgets what the sample sent', async () => {
    const page = await demo();
    await sendRevision(page);
    await page.click('[data-act="send-done"]');
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    // Log Out? takes presses once it has been up a moment (a double tap is not a yes).
    page.advance(500);
    expect(text(page, '#sp-logout-title')).toBe('Log Out?');
    await page.click('[data-act="card-done"]');
    expect(page.T.state().demoRevisions).toBeNull();
  });
});

describe('Before and After (the boards "Before and After a Revision" and "… on a Chromebook")', () => {
  it('the board’s worked example: Proficient − · 67% before, Proficient · 75% after, with each row and both versions', async () => {
    const page = await demo();
    // Returned work is on My Learning: the revision's row, with its new grade.
    await page.click('[data-tab="learning"]');
    const row = q(page, '.sp-ml-row[data-piece="demo-vaccine"]');
    expect(row.getAttribute('data-act')).toBe('feedback');
    expect(words(row.querySelector('.sp-level'))).toBe('Proficient · 75%');
    // Its row opens Your Feedback, which carries Before and After.
    row.click();
    await page.settle();
    expect(q(page, '[data-act="compare"][data-piece="demo-vaccine"]').textContent).toBe('Before and After');
    q(page, '[data-act="compare"][data-piece="demo-vaccine"]').click();
    await page.settle();
    expect(page.T.state()).toMatchObject({ tab: 'learning', feedback: 'demo-vaccine', compare: true });
    expect(text(page, '#sp-fb-title')).toBe('How Vaccines Work');
    expect(text(page, '.sp-fb-sub')).toMatch(/^Revision returned \S+ \d+$/);
    expect(text(page, '.sp-ba-title')).toBe('Before and After');
    expect(qa(page, '.sp-ba-label').map(words)).toEqual(['First Version', 'Your Revision']);
    expect(qa(page, '.sp-ba-sent').every(el => /^Sent \S+ \d+$/.test(words(el)))).toBe(true);
    expect(qa(page, '.sp-ba-photo').map(i => i.getAttribute('alt'))).toEqual([
      'First Version, page 1',
      'Your Revision, page 1',
    ]);
    const parts = r =>
      [...r.querySelectorAll('.sp-ba-name, .sp-level, .sp-ba-old, .sp-ba-new, .sp-ba-same')].map(words);
    expect(qa(page, '.sp-ba-rows:not(.sp-ba-result) .sp-ba-row').map(parts)).toEqual([
      ['Communicating', 'Developing +', 'Proficient'],
      ['Questioning and Predicting', 'No change', 'Proficient'],
    ]);
    expect(parts(q(page, '.sp-ba-result .sp-ba-row'))).toEqual([
      'Your Result',
      'Proficient − · 67%',
      'Proficient · 75%',
    ]);
    expect(qa(page, '.sp-ba-said-title').map(words)).toEqual(['Your Teacher Asked', 'You Did']);
    expect(qa(page, '.sp-ba-words').map(words)).toEqual([
      'Add a third example of how the body remembers a germ.',
      'I added how a booster shot reminds the body about a germ it has met before.',
    ]);
    // The grade now is the new one, everywhere on the page.
    expect(piece(page, 'demo-vaccine').result.text).toBe('Proficient · 75%');
    await page.click('.sp-ba [data-act="feedback"]');
    expect(page.T.state().compare).toBe(false);
    expect(text(page, '.sp-fb-big')).toBe('Proficient · 75%');
    expect(page.root().innerHTML).not.toMatch(/Rivera/);
  });

  it('Before and After only for a returned revision: a press for any other piece opens nothing', async () => {
    const page = await demo();
    const before = page.root().innerHTML;
    const fake = page.ctx.document.createElement('button');
    fake.setAttribute('data-act', 'compare');
    fake.setAttribute('data-piece', 'demo-lab');
    expect(StudentPageView.press({}, viewOf(page), 'compare', fake)).toBeNull();
    expect(page.root().innerHTML).toBe(before);
  });
});
