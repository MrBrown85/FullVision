import { test, expect } from '@playwright/test';
import { jumpTo } from './phone-jump.js';

/* Missing and Excused on the phone grader come back off (Colin,
   2026-11-25: "I can't undo an accidental excused!"). The ⋯ sheet greyed
   Missing and Excused whenever the work had a comment or a rubric row,
   the one already on included, so it could not be taken off (five such
   cells were live that day). Now the status that is on can always come
   off; a status set or taken off has Undo on its toast; and the card's
   status chip, tapped, takes it off. Demo Mode's Science 8. */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openBlankCard(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // A student with nothing on a piece graded one at a time.
  const pick = await page.evaluate(() => {
    for (const a of getAssignedAssessments('sci8')) {
      if (groupGradingUnits('sci8', a, [])) continue;
      for (const st of getStudents('sci8'))
        if (!hasScoreOrFeedback('sci8', st.id, a.id) && !getAssignmentStatus('sci8', st.id, a.id))
          return { aid: a.id, sid: st.id };
    }
  });
  expect(pick).toBeTruthy();
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-tg-row[data-aid="' + pick.aid + '"]').click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  await jumpTo(page, pick.sid);
  const status = () => page.evaluate(p => getAssignmentStatus('sci8', p.sid, p.aid), pick);
  return { pick, status, errors };
}

async function excuseFromMore(page) {
  await page.locator('[data-action="m-grade-more"]').click();
  await page.locator('#m-sheet-container [data-action="m-grade-status"][data-val="EXC"]').first().click();
}

test('an accidental Excused comes off: Undo on the toast, or a tap on its chip', async ({ page }) => {
  const { status, errors } = await openBlankCard(page);
  const toast = page.locator('#m-toast');

  await excuseFromMore(page);
  expect(await status()).toBe('EXC');
  await expect(toast).toContainText('Marked Excused');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(status).toBeNull();

  await excuseFromMore(page);
  const chip = page.locator('#m-swiper').getByRole('button', { name: 'Take Off Excused' }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect.poll(status).toBeNull();
  await expect(toast).toContainText('Took off Excused');
  expect(errors).toEqual([]);
});

test('Excused work that also has a comment can still be taken off from ⋯', async ({ page }) => {
  const { pick, status, errors } = await openBlankCard(page);
  // As five live cells were: Excused, with a comment left on the work.
  await page.evaluate(p => {
    const all = getScores('sci8');
    (all[p.sid] = all[p.sid] || []).push({ assessmentId: p.aid, tagId: null, score: 0, note: 'Left from before' });
    const st = getAssignmentStatuses('sci8');
    st[p.sid + ':' + p.aid] = 'EXC';
    saveAssignmentStatuses('sci8', st);
  }, pick);
  await page.locator('[data-action="m-grade-more"]').click();
  const sheet = page.locator('#m-sheet-container');
  const exc = sheet.locator('[data-action="m-grade-status"][data-val="EXC"]').first();
  await expect(exc).toBeEnabled();
  await expect(exc).toHaveAttribute('aria-pressed', 'true');
  // Missing stays shut: the comment would have to go first.
  await expect(sheet.locator('[data-action="m-grade-status"][data-val="NS"]').first()).toBeDisabled();
  await exc.click();
  await expect.poll(status).toBeNull();
  expect(errors).toEqual([]);
});
