/**
 * The redrawn Inbox's To Grade view (slice I1 of docs/plans/inbox-redesign-plan.md). Demo Mode, Science 8, the student page and
 * Send Work on. Set FV_SHOTS to a folder to keep pictures.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

const LIGHT = 'sci8a21';
const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return !el || getComputedStyle(el).display === 'none' || +getComputedStyle(el).opacity === 0;
  });
  await page.waitForTimeout(500);
  await page.locator('#dash-inbox').screenshot({ path: SHOTS + '/' + name + '.png' });
};

// With `more`, three more assessments have work waiting (11, 3 and 1 late), as the board draws.
async function open(page, { tile = true, more = false } = {}) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  if (!tile)
    await page.evaluate(() => {
      DashBulletins.html = () => '';
      PageDashboard.render();
    });
  await page.evaluate(more => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    if (more) {
      const lab = getAssessments(cid).find(a => a.id === 'sci8a21');
      const roster = getStudents(cid).map(x => x.id);
      const extra = [
        ['xa1', '5.5 What Was the Main Turning Point Against Germany?', 12, false],
        ['xa2', "2.2 Causes of the War's End", 3, false],
        ['xa3', '3.6 Assessing the Treaty of Versailles', 1, true],
      ];
      saveAssessments(cid, getAssessments(cid).concat(extra.map(([id, title]) => ({ ...lab, id, title }))));
      extra.forEach(([aid, , n, late], k) => {
        work.assessments.push({ id: aid, students_send: 'photos', after_due: 'keep', accept_until: null });
        roster.slice(5, 5 + n).forEach((sid, i) => {
          work.submissions.push({
            ...work.submissions.find(s => s.assessment_id === 'sci8a21'),
            id: 'x' + aid + i,
            assessment_id: aid,
            enrollment_id: sid,
            is_late: late,
            sent_by: 'student',
            // After the sample class's own work, whatever day the test runs: later pieces newer, students in order.
            sent_at: new Date(Date.now() + (k + 1) * 3600000 + i * 60000).toISOString(),
          });
        });
      });
    }
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
  }, more);
  await page.locator('#dash-inbox').waitFor();
  await page.locator('.dash-inbox-stack').first().waitFor();
}

test.use({ viewport: { width: 1280, height: 800 } });

test("the stacks match the sample class, and the header is the board's", async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  const m = await page.evaluate(() => {
    const cid = getActiveCourse();
    const ids = getStudents(cid).map(s => s.id);
    return {
      counts: GraderWork.workCounts(cid, 'sci8a21', ids),
      total: GraderWork.classWorkCounts(cid, ids).tograde,
      stacks: [...document.querySelectorAll('.dash-inbox-stack')].map(b => ({
        aid: b.dataset.aid,
        n: b.querySelector('.dash-inbox-stack-count').textContent,
        late: !!b.querySelector('.dash-inbox-stack-late'),
      })),
    };
  });
  expect(m.stacks).toEqual([{ aid: LIGHT, n: String(m.counts.tograde), late: true }]);
  expect(m.total).toBe(m.counts.tograde);
  await expect(page.locator('#dash-inbox-title')).toHaveText('Inbox');
  await expect(page.locator('.dash-inbox-switch [aria-pressed="true"]')).toHaveText('To Grade');
  await expect(page.locator('.dash-inbox-head a')).toHaveText('Assignments →');
  await expect(page.locator('.dash-inbox-action')).toHaveText('Start Grading');
  await expect(page.locator('#dash-view-btn-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-return-btn')).toHaveText('Return 2');
  await expect(page.locator('.dash-inbox-stack-cap .dash-inbox-stack-title')).toHaveText('Light Refraction Lab');
  // The page's picture is the student's real first page, not a stand-in.
  await expect(page.locator('.dash-inbox-stack img[data-work-pic]')).toHaveAttribute('src', /.+/);
  await shot(page, 'r1-sample');
  expect(errors).toEqual([]);
});

test('a stack opens in place and closes (the button, Escape); the state holds across a draw', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page, { more: true });
  const aids = await page.evaluate(() => [...document.querySelectorAll('.dash-inbox-stack')].map(b => b.dataset.aid));
  expect(aids).toEqual(['xa3', 'xa2', 'xa1', LIGHT]);
  await shot(page, 'r1-stacks');

  await page.locator('.dash-inbox-stack[data-aid="xa2"]').click();
  const spread = page.locator('.dash-inbox-spread');
  await expect(spread).toBeVisible();
  await expect(page.locator('.dash-inbox-stack')).toHaveCount(3);
  await expect(spread.locator('.dash-inbox-page')).toHaveCount(3);
  await expect(spread.locator('.dash-inbox-page-name').first()).not.toHaveText('');
  await expect(spread.locator('.dash-inbox-page-when').first()).toHaveText(/\d:\d\d [ap]m/);
  await expect(spread.locator('.dash-inbox-notin-n')).toHaveText(/^\d+$/);
  // The others stay in order around it.
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.dash-inbox-stacks-row [data-flip]')].map(e => e.dataset.flip),
  );
  expect(order).toEqual(['xa3', 'xa2', 'xa1', LIGHT]);
  // The first page has the focus; the opened stack's pictures are real.
  await expect(spread.locator('.dash-inbox-page').first()).toBeFocused();
  await expect(spread.locator('img[data-work-pic]').first()).toHaveAttribute('src', /.+/);
  await shot(page, 'r2-open');

  // It stays open through a draw.
  await page.evaluate(() => PageDashboard.render());
  await expect(page.locator('.dash-inbox-spread')).toBeVisible();

  // Escape closes it and puts the focus back on its stack.
  await page.keyboard.press('Escape');
  await expect(page.locator('.dash-inbox-spread')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-stack')).toHaveCount(4);
  await expect(page.locator('.dash-inbox-stack[data-aid="xa2"]')).toBeFocused();

  // The close button; and another stack's click moves the spread to it.
  await page.locator('.dash-inbox-stack[data-aid="xa2"]').click();
  await page.locator('.dash-inbox-spread-close').click();
  await expect(page.locator('.dash-inbox-spread')).toHaveCount(0);
  await page.locator('.dash-inbox-stack[data-aid="xa2"]').click();
  await page.locator('.dash-inbox-stack[data-aid="xa1"]').click();
  await expect(page.locator('.dash-inbox-spread')).toHaveCount(1);
  await expect(page.locator('.dash-inbox-stack[data-aid="xa2"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a page opens the grader on that student; Start Grading on the first stack', async ({ page }) => {
  await open(page, { more: true });
  await page.locator('.dash-inbox-stack[data-aid="xa3"]').click();
  const want = await page.evaluate(() => document.querySelector('.dash-inbox-page .dash-inbox-page-name').textContent);
  await page.locator('.dash-inbox-page').first().click();
  await expect(page.locator('#grader-overlay')).toBeVisible();
  const text = await page.evaluate(() => document.getElementById('grader-overlay').textContent);
  expect(text).toContain(want);
  expect(text).toContain('3.6 Assessing the Treaty of Versailles');
  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);

  await page.locator('.dash-inbox-action').click();
  await expect(page.locator('#grader-overlay')).toBeVisible();
  await expect(page.locator('#grader-overlay')).toContainText('3.6 Assessing the Treaty of Versailles');
});

test('a graded pile asks before it returns, and the tile draws again after', async ({ page }) => {
  await open(page);
  // askReturn is another slice's: here the call that reaches it is what is checked.
  await page.evaluate(() => {
    window.__asked = [];
    PageAssignments.askReturn = (cid, aids, button, then) => {
      window.__asked.push([cid, aids, button.textContent]);
      then();
    };
  });
  await page.locator('.dash-inbox-return-btn').click();
  expect(await page.evaluate(() => window.__asked)).toEqual([['sci8', [LIGHT], 'Return 2']]);
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

for (const tile of [true, false]) {
  test(
    'nothing overflows the tile at 1280 by 800, ' + (tile ? 'with' : 'without') + ' the Bulletins tile',
    async ({ page }) => {
      await open(page, { tile, more: true });
      for (const font of FONTS) {
        await useFont(page, font);
        for (const state of ['closed', 'open']) {
          await page.evaluate(state => {
            const closeBtn = document.querySelector('.dash-inbox-spread-close');
            if (state === 'closed' && closeBtn) closeBtn.click();
            if (state === 'open' && !closeBtn) document.querySelector('.dash-inbox-stack[data-aid="xa1"]').click();
          }, state);
          await page.waitForTimeout(350);
          const r = await page.evaluate(() => {
            const tile = document.getElementById('dash-inbox').getBoundingClientRect();
            const inside = el => {
              const b = el.getBoundingClientRect();
              return (
                b.left >= tile.left - 0.5 &&
                b.right <= tile.right + 0.5 &&
                b.top >= tile.top - 0.5 &&
                b.bottom <= tile.bottom + 0.5
              );
            };
            const row = document.getElementById('dash-inbox-stacks-row');
            const rowBox = row.getBoundingClientRect();
            const within = el => {
              const b = el.getBoundingClientRect();
              return b.top >= rowBox.top - 0.5 && b.bottom <= rowBox.bottom + 0.5;
            };
            const spread = document.querySelector('.dash-inbox-spread');
            const first = document.querySelector('.dash-inbox-stack');
            const lines = el =>
              Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
            return {
              head: [...document.querySelectorAll('.dash-inbox-head > *')].map(inside),
              rowInside: inside(row),
              noVerticalScroll: row.scrollHeight <= row.clientHeight + 1,
              first: inside(first),
              firstTitle: inside(first.parentElement.querySelector('.dash-inbox-stack-title')),
              titlesTwoLines: [...document.querySelectorAll('.dash-inbox-stack-title')].every(t => lines(t) <= 2),
              returns: [...document.querySelectorAll('.dash-inbox-return-btn, .dash-inbox-return-count')].every(inside),
              returnsInRow: [...document.querySelectorAll('.dash-inbox-return')].every(within),
              spread: spread
                ? inside(spread) && [...spread.querySelectorAll('.dash-inbox-spread-head > *')].every(inside)
                : true,
              spreadKids: spread
                ? [...spread.querySelectorAll('.dash-inbox-spread-body > *')].every(el => {
                    const b = el.getBoundingClientRect();
                    const s = spread.getBoundingClientRect();
                    return b.right <= s.right + 0.5 && b.bottom <= s.bottom + 0.5;
                  })
                : true,
              spreadPages: spread
                ? !!spread.querySelector('.dash-inbox-page') && within(spread.querySelector('.dash-inbox-page-sheet'))
                : true,
            };
          });
          const where = font + ', ' + state;
          expect(r.head, where).toEqual(r.head.map(() => true));
          expect(r.rowInside, where).toBe(true);
          expect(r.noVerticalScroll, where).toBe(true);
          expect(r.titlesTwoLines, where).toBe(true);
          // Open, the stacks beside the spread and the piles to return wait where the row scrolls.
          if (state === 'closed') {
            expect(r.first, where).toBe(true);
            expect(r.firstTitle, where).toBe(true);
            expect(r.returns, where).toBe(true);
            expect(r.returnsInRow, where).toBe(true);
          }
          expect(r.spread, where).toBe(true);
          expect(r.spreadKids, where).toBe(true);
          expect(r.spreadPages, where).toBe(true);
          await shot(page, 'fit-' + (tile ? 'bulletins' : 'alone') + '-' + font + '-' + state);
        }
      }
    },
  );
}
