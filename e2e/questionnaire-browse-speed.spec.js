import { test, expect } from '@playwright/test';

/* Browse Sentences' search (speed assessment R3). Each key in the search
   box read the whole comment bank against every classmate's comment and
   drew the list again, with no pause between keys. The list now follows
   the box once typing pauses (120 ms), and which sentences each
   classmate's comment holds is kept, so only a changed comment is read
   again. Counted, not timed. */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

test('three quick keys in Browse Sentences count the class once, and the list shows what was typed', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#tq-browse-btn').click();
  const search = page.locator('#tq-browse-search');
  await expect(search).toBeFocused();
  await page.evaluate(() => {
    window.__usage = 0;
    const classUsage = CommentBank.classUsage;
    CommentBank.classUsage = function () {
      window.__usage++;
      return classUsage.apply(this, arguments);
    };
  });
  // Three letters of a word in the last sentence listed.
  const last = await page.locator('#tq-browse-list .qn-browse-sentence').last().textContent();
  const word = last.split(/\s+/).find(w => /^[a-z]{5,}$/i.test(w));
  const q = word.slice(0, 3).toLowerCase();
  await search.pressSequentially(q, { delay: 20 });
  await expect(page.locator('#tq-browse-list .qn-browse-sentence').first()).toContainText(new RegExp(q, 'i'));
  await page.waitForTimeout(400);
  // One count of the class for the three keys (each key counted it before).
  expect(await page.evaluate(() => window.__usage)).toBe(1);
  const shown = await page.locator('#tq-browse-list .qn-browse-sentence').allTextContents();
  expect(shown.length).toBeGreaterThan(0);
  shown.forEach(t => expect(t.toLowerCase()).toContain(q));
  expect(errors).toEqual([]);
});
