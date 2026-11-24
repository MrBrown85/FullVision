import { test, expect } from '@playwright/test';

/* A reflection's questions edited where they print (teacher/report-one-words.js),
   in Demo Mode's Science 8, One Student view: Edit Questions puts the
   cursor in the first statement; typing changes it for the class; ⋯ moves
   a statement under another heading; ⌘Z steps back; the grip drags a
   statement; the + between two rows adds a heading. */

const NAME = 'Cece Adeyemi';
const KEY = 'student-reflection-learning';
test.setTimeout(120_000);

async function openWithReflection(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.evaluate(key => {
    const one = ReportOne.setOn(ReportOne.fromSetup('report-card'), key, true);
    saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one }));
  }, KEY);
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  // The student by name: the canvas otherwise shows whichever report is longest.
  await page.locator('a', { hasText: NAME }).first().click();
  await expect(page.locator('#rb-preview .sheet-student')).toContainText(NAME);
  return errors;
}

const part = page => page.locator(`#rb-preview [data-part="${KEY}"]`);
// The statements and headings in print order: "H:" before a heading.
const rows = page =>
  part(page)
    .locator('tbody tr[data-wrow], tbody tr[data-whead]')
    .evaluateAll(trs =>
      trs.map(t =>
        t.hasAttribute('data-whead') ? 'H:' + t.textContent.trim() : t.querySelector('.report-habit-name').textContent,
      ),
    );
const saved = page =>
  page.evaluate(key => {
    const w = ReportOne.forConfig(getReportConfig('sci8')).wording[key];
    return w ? w.items.map(i => i.label + '/' + i.group) : null;
  }, KEY);

test('the questions are edited on the page, moved, undone, dragged and added to', async ({ page }) => {
  const errors = await openWithReflection(page);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // Edit Questions: the cursor in the first statement, and once, how it works.
  const edit = page.locator(`[data-action="oneWording"][data-part="${KEY}"]`);
  if (!(await edit.isVisible())) await page.locator('#studio-palette').getByText('Reflection: My Learning').click();
  await edit.click();
  const first = part(page).locator('[data-wt="items.0.label"]');
  await expect(first).toBeFocused();
  await expect(page.locator('#rb-preview .one-w-tip')).toContainText('Click any words to change them');

  // Typing changes it for the class, with an Undo.
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type('Focus');
  await page.keyboard.press('Tab');
  await expect(part(page).locator('[data-wt="items.0.label"]')).toHaveText('Focus');
  await expect(page.locator('#undo-toast')).toContainText('Changed “Focus” for everyone');
  expect((await saved(page))[0]).toBe('Focus/Learning Dispositions');

  // ⋯ › Move To: under the other heading.
  await part(page).locator('tr[data-wrow="items.0"]').hover();
  await page.locator('#rb-preview [data-wmore="items.0"]').click();
  await page.getByRole('menuitem', { name: 'Relational & Identity' }).click();
  await expect
    .poll(() => rows(page))
    .toEqual([
      'H:Learning Dispositions',
      'Curiosity & Exploration',
      'Self-Regulation & Reflection',
      'Resilience',
      'H:Relational & Identity',
      'Belonging & Connection',
      'Identity & Self-Knowledge',
      'Collaboration',
      'Respect',
      'Responsibility & Reciprocity',
      'Focus',
    ]);

  // ⌘Z, outside a text box: the move, then the typing.
  await page.locator('#rb-preview').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${mod}+Z`);
  await expect.poll(async () => (await rows(page))[1]).toBe('Focus');
  await page.keyboard.press(`${mod}+Z`);
  await expect(part(page).locator('[data-wt="items.0.label"]')).toHaveText('Engagement');
  expect(await saved(page)).toBeNull();

  // The grip drags Respect up to the top of Learning Dispositions.
  const respect = part(page).locator('tr[data-wrow="items.7"]');
  await respect.hover();
  const grip = page.locator('#rb-preview [data-wgrip="items.7"]');
  const g = await grip.boundingBox();
  const top = await part(page).locator('tr[data-wrow="items.0"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await rows(page)).slice(0, 3))
    .toEqual(['H:Learning Dispositions', 'Respect', 'Engagement']);

  // The + between Engagement and Curiosity: Add a Heading takes the rows under it.
  const eng = await part(page).locator('tr[data-wrow="items.1"]').boundingBox();
  await page.mouse.move(eng.x + 200, eng.y + eng.height - 1);
  const plus = page.locator('#rb-preview .one-w-ins-plus');
  await expect(plus).toBeVisible();
  await plus.hover();
  await page.locator('#rb-preview .one-w-ins-acts').getByText('Add a Heading').click();
  await expect(page.locator('#rb-preview [data-wt="head.2"]')).toBeFocused();
  await page.keyboard.type('My Habits of Mind');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await rows(page)).slice(0, 5))
    .toEqual(['H:Learning Dispositions', 'Respect', 'Engagement', 'H:My Habits of Mind', 'Curiosity & Exploration']);

  // Everyone view has no controls on it.
  await page.getByRole('radio', { name: 'Everyone' }).click();
  await expect(page.locator('#rb-preview .one-w-more')).toHaveCount(0);
  expect(errors).toEqual([]);
});
