import { test, expect } from '@playwright/test';

/* New Class › Reporting Terms, Demo Mode (Colin, 2026-11-27: "just reuse
   this"). Change on the row opens Class Settings' own Reporting Terms
   section for the class being made; Create Class saves what it shows, and
   Class Settings › Reporting Terms shows the same dates afterwards.
   FV_SLOW=1 runs each test with the CPU slowed six times (docs/testing.md). */

async function enterDemo(page) {
  if (process.env.FV_SLOW) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  }
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function toNameYourClass(page) {
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.locator('[data-action="cmStartCreate"]').first().click();
  await page.getByRole('radio', { name: 'Grade 9' }).click();
  await page.getByRole('checkbox', { name: /^Science 9\b/ }).click();
  await page.locator('[data-action="cwGoToStep2"]').click();
  await expect(page.locator('#cm-new-name')).toBeVisible();
}

const termsRow = page => page.locator('.cw-set-row', { hasText: 'Reporting Terms' }).locator('.cw-set-value');
const panel = page => page.locator('.cw-set-panel');
const createBtn = page => page.locator('[data-action="cwFinishCreate"]');

test('picks another school, edits a date, and Class Settings shows those dates once the class is made', async ({
  page,
}) => {
  test.setTimeout(process.env.FV_SLOW ? 90_000 : 30_000);
  await enterDemo(page);
  // Earl Marriott's terms this school year, as the app has them; Term 2 ends a week early.
  const school = await page.evaluate(() => reportingTermPreset('earlmarriott'));
  test.skip(!school, 'The Surrey presets cover this school year only (refreshed each August).');
  const earlyEnd = await page.evaluate(iso => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  }, school[1].ends_on);

  await toNameYourClass(page);
  await expect(termsRow(page)).toHaveText('Grandview Heights Secondary, 4 terms');
  await page.getByRole('button', { name: 'Change Reporting Terms' }).click();
  // Class Settings' own section: Dates From, Create New, the tiles and Edit Dates.
  const dates = panel(page).locator('.cm-term-school-select');
  await expect(dates).toHaveValue('grandviewheights');
  await expect(panel(page).locator('.cm-term-tile')).toHaveCount(4);
  await expect(panel(page).getByRole('button', { name: 'Create New' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Edit Dates' })).toBeVisible();
  // Step 2's This Class Runs is the only one.
  await expect(page.getByRole('radiogroup', { name: 'This Class Runs' })).toHaveCount(1);

  await dates.selectOption('earlmarriott');
  await expect(panel(page).locator('.cm-term-school-preview')).toContainText('Earl Marriott Secondary:');
  await panel(page).locator('[data-action="cmTermSchoolPreset"]').click();
  await expect(termsRow(page)).toHaveText('Earl Marriott Secondary, 4 terms');
  await expect(panel(page).getByRole('button', { name: 'Save Terms' })).toHaveCount(0);

  const ends = panel(page).locator('.cm-term-row input[data-field="ends_on"]');
  await expect(ends).toHaveCount(4);
  await ends.nth(1).fill(earlyEnd);
  await expect(termsRow(page)).toHaveText('Your own dates, 4 terms');
  await expect(createBtn(page)).toBeEnabled();

  // A term that ends before it starts marks its row and keeps Create Class off.
  await ends.nth(2).fill(school[0].starts_on);
  await expect(panel(page).locator('.cm-term-row-bad')).toHaveCount(1);
  await expect(panel(page).locator('.cm-term-row-wrap').nth(2)).toHaveClass(/cm-term-row-bad/);
  await expect(createBtn(page)).toBeDisabled();
  await ends.nth(2).fill(school[2].ends_on);
  await expect(panel(page).locator('.cm-term-row-bad')).toHaveCount(0);
  await expect(createBtn(page)).toBeEnabled();

  await page.locator('#cm-new-name').fill('Science 9 Terms');
  await createBtn(page).click();
  await page.getByRole('tab', { name: /^Reporting Terms/ }).click();
  const tiles = page.locator('.cm-term-tile');
  await expect(tiles).toHaveCount(4);
  const shown = await page.evaluate(
    ([from, to]) => CmTerms._cmTermDay(from) + ' – ' + CmTerms._cmTermDay(to),
    [school[1].starts_on, earlyEnd],
  );
  await expect(tiles.nth(1)).toContainText(shown);
  const saved = await page.evaluate(() => {
    const cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Science 9 Terms');
    return getReportingTerms(cid);
  });
  expect(saved.map(t => t.ends_on)).toEqual([school[0].ends_on, earlyEnd, school[2].ends_on, school[3].ends_on]);
});

test('This Class Runs cuts the school’s terms in place and keeps its focus', async ({ page }) => {
  test.setTimeout(process.env.FV_SLOW ? 90_000 : 30_000);
  await enterDemo(page);
  test.skip(!(await page.evaluate(() => reportingTermPreset(null))), 'The Surrey presets cover this school year only.');
  await toNameYourClass(page);
  await page.getByRole('button', { name: 'Change Reporting Terms' }).click();
  await expect(panel(page).locator('.cm-term-tile')).toHaveCount(4);
  const s2 = page.getByRole('radiogroup', { name: 'This Class Runs' }).getByRole('radio', { name: 'Semester 2' });
  await s2.click();
  await expect(termsRow(page)).toHaveText('Grandview Heights Secondary, 2 terms');
  await expect(panel(page).locator('.cm-term-tile')).toHaveCount(2);
  await expect(panel(page).locator('.cm-term-view-foot')).toContainText('Report 3–4');
  await expect(s2).toBeFocused();
  await expect(page.locator('#cw-rail-sub')).toContainText('Semester 2');
});

/* The section sits in the wizard's narrower column: every term row keeps
   its dates and ✕ inside it, at iPad widths and in a wide font
   (docs/testing.md). */
const WIDE_FONT =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
for (const wide of [false, true]) {
  test(`Edit Dates fits the wizard's column at 744 to 1440 px${wide ? ' in a wide font' : ''}`, async ({ page }) => {
    test.setTimeout(process.env.FV_SLOW ? 90_000 : 30_000);
    await enterDemo(page);
    if (wide) await page.addStyleTag({ content: WIDE_FONT });
    await toNameYourClass(page);
    await page.getByRole('button', { name: 'Change Reporting Terms' }).click();
    await panel(page).getByRole('button', { name: 'Edit Dates' }).click();
    await expect(panel(page).locator('.cm-term-row')).not.toHaveCount(0);
    for (const width of [744, 820, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const outside = await panel(page).evaluate(p => {
        const box = p.getBoundingClientRect();
        return [...p.querySelectorAll('.cm-term-row > *, .cm-term-school > *')]
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.right > box.right + 0.5 || r.left < box.left - 0.5;
          })
          .map(el => el.className);
      });
      expect(outside, width + ' px').toEqual([]);
    }
  });
}
