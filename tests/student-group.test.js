/**
 * The student's group card, with Add a Page (S12-F1; s/feedback.js,
 * s/page-view.js, shared/student-view.js): a piece sent as One per Group.
 *
 * Counts only. The rule forbids another student's name on a student's
 * page and Batch C's `group_work` sends none, so the board's name chips
 * are not drawn: how many are in the group, whether the work is in, how
 * many photos, and whether the student sent any of it.
 *
 * Demo Mode only (#demo-card-group). Nothing is sent anywhere.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const q = (page, sel) => page.root().querySelector(sel);
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card-group');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  // The sample class has bulletins, so the page opens on Bulletins (B1g); these tests start on Assignments.
  await page.click('.sp-tabs-bottom [data-tab="assignments"]');
  return page;
}
const viewOf = page => page.T.viewOf(page.T.state());
const card = page => q(page, '.sp-piece[data-piece="demo-cell-model"]');
const row = page => q(page, '.sp-ml-row[data-piece="demo-cell-model"]');
// Work sent is on My Learning: its row there opens its card.
async function openSentCard(page) {
  await page.click('[data-tab="learning"]');
  await page.click('.sp-ml-row[data-piece="demo-cell-model"]');
}

describe('no group piece anywhere else', () => {
  it('#demo-card-send has no group piece and no group reply', async () => {
    const page = await demo('#demo-card-send');
    expect(page.T.groupOf(page.T.state())).toBeNull();
    expect(viewOf(page).work.some(p => p.group)).toBe(false);
    expect(page.T.state().reply.assessments.some(a => a.id === 'demo-cell-model')).toBe(false);
    // Even with such a piece on the page, a class not sending One per Group gets no group reply.
    page.T.state().reply.assessments.push({ id: 'demo-cell-model', title: 'Cell Model Project' });
    expect(page.T.groupOf(page.T.state())).toBeNull();
  });
});

describe('S12-F1: the group card', () => {
  it('a group-mate sent it: the piece is Sent for Cece too, with the group’s counts and Add a Page', async () => {
    const page = await demo();
    // Not on Assignments: it is in, so it waits on My Learning.
    expect(card(page)).toBeNull();
    expect(words(q(page, '[data-segment="outstanding"]'))).toBe('Outstanding 3');
    expect(words(q(page, '[data-segment="upcoming"]'))).toBe('Upcoming 1');
    await page.click('[data-tab="learning"]');
    expect(row(page).getAttribute('data-act')).toBe('open-piece');
    expect(words(row(page).querySelector('.sp-row-sub'))).toMatch(
      /^Sent \S+ \d+, \d{1,2}:\d\d [ap]\.m\. · waiting for feedback$/,
    );
    expect(words(row(page).querySelector('.sp-level'))).toBe('Sent');
    // The first row of Your Work: work sent goes first.
    expect(q(page, '.sp-ml-work .sp-ml-row').getAttribute('data-piece')).toBe('demo-cell-model');
    await page.click('.sp-ml-row[data-piece="demo-cell-model"]');
    expect(page.T.state().card).toBe('demo-cell-model');
    expect(words(q(page, '.sp-ml-card-open [data-act="card-close"]'))).toBe('My Learning');
    const c = q(page, '.sp-ml-card-open .sp-piece[data-piece="demo-cell-model"]');
    expect([...c.querySelectorAll('.sp-flag')].map(words)).toEqual([
      expect.stringMatching(/^Sent \S+ \d+, \d{1,2}:\d\d [ap]\.m\. · 4 photos$/),
      'Group',
    ]);
    expect(words(c.querySelector('.sp-group-sent'))).toMatch(/^Sent \S+ \d+ · 4 photos$/);
    expect(words(c.querySelector('.sp-group-line'))).toBe('3 in your group. Someone in your group sent it.');
    expect(words(c.querySelector('[data-act="send-open"]'))).toBe('Add a Page');
    expect(page.calls).toEqual([]);
  });

  it('the reply names no one: counts only', async () => {
    const page = await demo();
    const g = page.T.groupOf(page.T.state());
    expect(Object.keys(g.assessments[0]).sort()).toEqual([
      'first_sent_at',
      'id',
      'members',
      'pages',
      'sent',
      'you_sent',
    ]);
    await openSentCard(page);
    expect(card(page).textContent).not.toMatch(/Ava|Leo/);
    expect(row(page)).toBeNull();
    await page.click('[data-act="card-close"]');
    expect(row(page).textContent).not.toMatch(/Ava|Leo/);
  });

  it('Add a Page sends Cece’s own pages, added to the group’s; then it is hers in the count and Add a Page goes', async () => {
    const page = await demo();
    page.T.setPrepare(() =>
      Promise.resolve({ ok: true, kind: 'jpeg', pages: [{ blob: { size: 1 }, thumb: { size: 1 }, hash: 'h' }] }),
    );
    await openSentCard(page);
    await page.click('.sp-piece[data-piece="demo-cell-model"] [data-act="send-open"]');
    expect(words(q(page, '#sp-send-title'))).toBe('Check and Send');
    await page.T.sendFiles([{}], -1);
    await page.settle();
    await page.click('[data-act="send-go"]');
    await page.click('[data-act="send-done"]');
    // Back to the card it was sent from, on My Learning.
    expect(page.T.state().tab).toBe('learning');
    expect(q(page, '.sp-ml-card-open .sp-piece[data-piece="demo-cell-model"]')).not.toBeNull();
    expect(words(card(page).querySelector('.sp-group-sent'))).toMatch(/· 5 photos$/);
    expect(words(card(page).querySelector('.sp-group-line'))).toBe('3 in your group. You sent pages for your group.');
    expect(card(page).querySelector('[data-act="send-open"]')).toBeNull();
  });
});

describe('the view reads the group reply as the contract types it', () => {
  const reply = {
    student: {},
    course: {},
    assessments: [
      { id: 'a', title: 'A', date: '2026-11-01', due_date: '2026-11-20' },
      { id: 'b', title: 'B', date: '2026-11-01', due_date: '2026-11-20', status: 'NS' },
    ],
  };
  const g = fields => ({
    ok: true,
    assessments: [Object.assign({ id: 'a', members: 3, sent: false, pages: 0 }, fields)],
  });

  it('not sent yet: still on Assignments, with the group’s line over Send My Work', () => {
    const v = Object.assign(StudentView.build(reply, 'c', null, null, null, g({})), { today: '2026-11-14' });
    const a = v.work.find(p => p.id === 'a');
    expect(a).toMatchObject({ kind: 'due', group: { members: 3, sent: false } });
    // Due Nov 20, after the class's today: Upcoming.
    expect(StudentPageView.segmentOf(a, v)).toBe('upcoming');
    const html = StudentPageView.html(v, { segment: 'upcoming' });
    expect(html).toMatch(/data-piece="a"[^]*3 in your group\. One of you sends it for the whole group\./);
    expect(StudentPageView.html(v, { segment: 'outstanding' })).not.toMatch(/3 in your group/);
  });

  it('sent: Sent; Missing hides it; a wrong shape or a group of one is none', () => {
    const v = StudentView.build(reply, 'c', null, null, null, {
      ok: true,
      assessments: [
        { id: 'a', members: 2, sent: true, pages: 3, you_sent: false, first_sent_at: '2026-11-05T00:00:00Z' },
        { id: 'b', members: 2, sent: true, pages: 3 },
      ],
    });
    expect(v.work.find(p => p.id === 'a').kind).toBe('sent');
    // Sent: on My Learning, not Assignments.
    expect(
      StudentPageView.segmentOf(
        v.work.find(p => p.id === 'a'),
        v,
      ),
    ).toBe('');
    expect(v.work.find(p => p.id === 'b')).toMatchObject({ kind: 'missing', group: null });
    [{ ok: false, assessments: g({}).assessments }, g({ members: 1 }), g({ members: '3' }), g({ sent: 'yes' })].forEach(
      x => expect(StudentView.build(reply, 'c', null, null, null, x).work.find(p => p.id === 'a').group).toBeNull(),
    );
  });
});
