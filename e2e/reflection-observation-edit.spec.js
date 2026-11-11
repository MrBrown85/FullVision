import { test, expect } from '@playwright/test';

/* An observation saved from a reflection keeps its context for good (S10
   follow-up to PR 1092, ruling 110): the edit card on the Observations page
   and the phone's sheet show the context as fixed, with "From a
   reflection. Not used in reports.", and Save keeps it. Demo Mode. */

const LINE = 'From a reflection. Not used in reports.';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function enterDemo(page, phone) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(phone ? { width: 375, height: 812 } : { width: 1366, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /\/dashboard/);
}

// As Save as Observation in the grader saves it.
async function addReflectionOb(page) {
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getStudents(cid).length > 0;
  });
  return page.evaluate(() => {
    const cid = getActiveCourse();
    const sid = getStudents(cid)[0].id;
    addQuickOb(cid, sid, 'Plan after Lab: “Next time I’ll label every part first.”', [], 'note', 'reflection');
    const obs = getQuickObs(cid)[sid];
    return { cid, sid, obId: obs[obs.length - 1].id };
  });
}

function contextOf(page, o) {
  return page.evaluate(o => getQuickObs(o.cid)[o.sid].find(x => x.id === o.obId).context, o);
}

test('desktop: the edit card shows the context as fixed and Save keeps it', async ({ page }) => {
  await enterDemo(page, false);
  const o = await addReflectionOb(page);
  await page.goto('/observations');
  const card = page.locator('.obs-card[data-obid="' + o.obId + '"]');
  await expect(card).toContainText(LINE);
  await card.click();
  const ed = page.locator('#obs-focus-card');
  await expect(ed).toBeVisible();
  await expect(ed.locator('.obs-focus-row')).toContainText(LINE);
  await expect(ed.locator('.obs-menu-btn')).toHaveCount(0);
  await shot(page, 'S10-reflection-context-fixed-1366');
  await ed.getByRole('button', { name: 'Strength' }).click();
  await ed.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#obs-focus-card')).toHaveCount(0);
  expect(await contextOf(page, o)).toBe('reflection');
  await expect(card).toContainText(LINE);
});

test('phone: the sheet shows the context as fixed and Save keeps it', async ({ page }) => {
  await enterDemo(page, true);
  const o = await addReflectionOb(page);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  const card = page.locator('#m-obs-cards .m-obs-card[data-obid="' + o.obId + '"]');
  await card.locator('.m-obs-text').click();
  const row = page.locator('.m-sheet.m-sheet-visible #m-obs-ctx-row');
  await expect(row).toContainText(LINE);
  await row.click();
  await expect(page.locator('#m-obs-edit-picker')).toBeHidden();
  await shot(page, 'S10-reflection-context-fixed-375');
  await page.locator('#m-obs-submit').click();
  await expect(page.getByText('Observation updated')).toBeVisible();
  expect(await contextOf(page, o)).toBe('reflection');
});
