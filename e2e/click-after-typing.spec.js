import { test, expect } from '@playwright/test';

/* Nov 3 sweep (step 4 group 2 #15): typing in a box and then clicking a
   button straight away only finished the typing. A data refresh waiting for
   the teacher to leave the box redrew the page between the press and the
   click, so Save Categories needed a second click; in the grader, Late's
   button was swapped as the typed score locked Missing and Excused. Demo
   Mode, Science 8. A real press takes a moment, so the clicks hold it. */
test.use({ viewport: { width: 1440, height: 1000 } });

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
async function heldClick(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
}

test('one click on Save Categories saves, though a refresh was waiting on the weight', async ({ page }) => {
  await demo(page);
  await page.locator('button', { hasText: 'Class Settings' }).first().click();
  await page
    .locator('button', { hasText: /^Grading/ })
    .first()
    .click();
  const before = await page.evaluate(() => getCategories('sci8').length);
  const first = page.locator('.cm-cat-weight').first();
  const w = Number(await first.inputValue());
  await page.locator('[data-action="cmCatAdd"]').click();
  await page.locator('.cm-cat-name').last().fill('Exit Slips');
  await first.fill(String(w - 10));
  await page.locator('.cm-cat-weight').last().fill('10');
  await page.evaluate(() => _invalidateAndRerender());
  await heldClick(page, page.locator('[data-action="cmCatSave"]'));
  await expect.poll(() => page.evaluate(() => getCategories('sci8').length)).toBe(before + 1);
});

test('typing a score and clicking Late keeps the same Late button and turns it on', async ({ page }) => {
  await demo(page);
  const [aid, sid] = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.scoreMode === 'points');
    const st = getStudents('sci8')[0];
    // Start from an unscored student with no status.
    setAssignmentStatus('sci8', st.id, a.id, null);
    setPointsScore('sci8', st.id, a.id, null);
    return [a.id, st.id];
  });
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.evaluate(([aid, sid]) => PageAssignments.openGrader('sci8', aid, sid), [aid, sid]);
  const late = page.locator('#grader-overlay .grader-status-btn[data-status="LATE"]');
  await page.locator('#grader-overlay .grdp-input').fill('7');
  await late.evaluate(el => (el.dataset.kept = '1'));
  await page.evaluate(() => _invalidateAndRerender());
  await heldClick(page, late);
  await expect(late).toHaveAttribute('aria-pressed', 'true');
  await expect(late).toHaveAttribute('data-kept', '1');
  await expect(page.locator('#grader-overlay .grader-status-btn[data-status="NS"]')).toBeDisabled();
  expect(await page.evaluate(([aid, sid]) => getAssignmentStatus('sci8', sid, aid), [aid, sid])).toBe('LATE');
  expect(await page.evaluate(([aid, sid]) => getPointsScore('sci8', sid, aid), [aid, sid])).toBe(7);
});
