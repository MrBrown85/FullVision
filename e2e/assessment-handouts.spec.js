import { test, expect } from '@playwright/test';
import { pagesPdf } from '../tests/fixtures/pdf-fixtures.mjs';

/* Handouts and Links (boards 3a and 3b of the Assessment Form canvas), in
   Demo Mode: on the assessment form, under the Description, a teacher adds
   a two-page PDF and a link, takes one off, and saves; Preview as Student
   then shows them on the card under For This Assignment, the link opening
   in a new tab, the handout's pages opening in the page one at a time.
   The pages are made from the PDF on this computer (shared/photo-shrink.js,
   pdf.js) and kept in the photo queue. Nothing is sent. */

const CID = 'sci8';
const SHOTS = process.env.NIGHT_SHOTS || '';

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(cid => getAssessments(cid).length > 0 && getStudents(cid).length > 0, CID);
}

// A piece the first student still has To Do, and that student.
async function toDoPiece(page) {
  return page.evaluate(cid => {
    setStudentPageSwitch(cid, true);
    const st = sortStudents(getStudents(cid), 'lastName')[0];
    const built = StudentView.fromCache(cid, st.id);
    const p = built.view.work.find(x => x.kind === 'due');
    return { sid: st.id, aid: p ? p.id : '' };
  }, CID);
}

async function editForm(page, aid) {
  await page.goto('/assignments?course=' + CID);
  await page.waitForSelector('#ac-' + aid);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('#af-desc')).toBeVisible();
}

test('a teacher adds a handout and a link, and the student sees them on the card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const posts = [];
  page.on('request', r => {
    if (r.method() === 'POST' && /supabase/.test(r.url())) posts.push(r.url());
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await demo(page);

  // Off while the class's Student Page is off.
  const { sid, aid } = await toDoPiece(page);
  expect(aid).not.toBe('');
  await page.evaluate(cid => setStudentPageSwitch(cid, false), CID);
  await editForm(page, aid);
  await expect(page.locator('#af-res')).toHaveCount(0);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), CID);
  await editForm(page, aid);

  // Right under the Description and its hint.
  const field = page.locator('.af-card-what #af-res');
  await expect(field.locator('.af-label')).toHaveText('Handouts and Links');
  await expect(field).toContainText('A PDF can have up to 20 pages.');
  const [hint, box] = await Promise.all([page.locator('#af-desc-hint').boundingBox(), field.boundingBox()]);
  expect(box.y).toBeGreaterThan(hint.y);
  expect(box.y - (hint.y + hint.height)).toBeLessThan(24);

  // + Add a PDF: two pages, named from the file.
  const chooser = page.waitForEvent('filechooser');
  await field.getByRole('button', { name: '+ Add a PDF' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'Density Lab Instructions.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pagesPdf(2)),
  });
  await expect(field.locator('.af-res-item')).toHaveCount(1, { timeout: 20000 });
  await expect(field.locator('.af-res-item').first()).toContainText('Density Lab Instructions · PDF · 2 pages');

  // + Add a Link: a web address only, then its name.
  await field.getByRole('button', { name: '+ Add a Link' }).click();
  const url = field.getByRole('textbox', { name: 'Web Address' });
  await expect(url).toBeFocused();
  await url.fill('javascript:alert(1)');
  await field.getByRole('button', { name: 'Add Link' }).click();
  await expect(field.locator('#af-res-msg')).toHaveText(
    'That isn’t a web address. Copy it from the browser’s address bar.',
  );
  await url.fill('https://www.britannica.com/science/density');
  await field.getByRole('textbox', { name: 'Name Students See (optional)' }).fill('Density');
  await field.getByRole('textbox', { name: 'Name Students See (optional)' }).press('Enter');
  await expect(field.locator('.af-res-linkrow')).toHaveCount(0);
  // Escape in the link row closes the row, not the form.
  await field.getByRole('button', { name: '+ Add a Link' }).click();
  await field.getByRole('textbox', { name: 'Web Address' }).fill('https://example.ca/extra');
  await field.getByRole('textbox', { name: 'Web Address' }).press('Escape');
  await expect(field.locator('.af-res-linkrow')).toHaveCount(0);
  await expect(page.locator('#af-desc')).toBeVisible();
  // One more link, then Remove.
  await field.getByRole('button', { name: '+ Add a Link' }).click();
  await field.getByRole('textbox', { name: 'Web Address' }).fill('https://example.ca/extra');
  await field.getByRole('button', { name: 'Add Link' }).click();
  await expect(field.locator('.af-res-item')).toHaveCount(3);
  await field.getByRole('button', { name: 'Remove example.ca/extra' }).click();
  await expect(field.locator('.af-res-item')).toHaveCount(2);
  await expect(field.locator('.af-res-item').nth(1)).toContainText('Density · britannica.com');
  if (SHOTS) await page.locator('.af-card-what').screenshot({ path: SHOTS + '/handouts-links-form-1366.png' });

  // Saved with the assessment.
  await page.locator('[data-action="saveEditAssess"]').click();
  await page.waitForFunction(
    ({ cid, aid }) => getAssessmentResources(cid, aid).length === 2,
    { cid: CID, aid },
    { timeout: 15000 },
  );
  // Opened again, the form shows them as saved.
  await editForm(page, aid);
  await expect(page.locator('#af-res .af-res-item')).toHaveCount(2);
  await page.locator('[data-action="cancelAssessForm"]').click();

  // Preview as Student: For This Assignment on the card.
  await page.goto('/dashboard?manage=student-page');
  await page.locator('#sp-preview-student').selectOption(sid);
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Chromebook' }).click();
  await dialog.getByRole('button', { name: /^To Do \d+$/ }).click();
  await dialog.locator('.sp-side-row[data-piece="' + aid + '"]').click();
  const card = dialog.locator('.sp-piece.sp-picked');
  const block = card.locator('.sp-res');
  await expect(block.getByRole('heading', { name: 'For This Assignment' })).toBeVisible();
  const handout = block.getByRole('button', { name: /Density Lab Instructions/ });
  await expect(handout).toContainText('Handout · 2 pages');
  const link = block.getByRole('link', { name: /Density/ });
  await expect(link).toHaveAttribute('href', 'https://www.britannica.com/science/density');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toContainText('britannica.com');
  if (SHOTS) await card.screenshot({ path: SHOTS + '/handouts-links-card-chromebook.png' });

  // The handout opens in the page, one page at a time, and Back goes to the card.
  await handout.click();
  const pane = dialog.locator('.sp-handout');
  await expect(pane.getByRole('heading', { name: 'Density Lab Instructions' })).toBeVisible();
  await expect(pane.locator('.sp-fb-sub')).toHaveText('Page 1 of 2');
  await expect(pane.locator('img.sp-work-img')).toHaveAttribute('src', /^blob:/);
  // The page is a real picture.
  await expect
    .poll(() => pane.locator('img.sp-work-img').evaluate(img => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await pane.getByRole('button', { name: 'Next Page' }).click();
  await expect(pane.locator('.sp-fb-sub')).toHaveText('Page 2 of 2');
  if (SHOTS) await dialog.screenshot({ path: SHOTS + '/handouts-links-handout-chromebook.png' });
  await pane.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.locator('.sp-handout')).toHaveCount(0);
  await expect(dialog.locator('.sp-piece.sp-picked .sp-res')).toBeVisible();

  // On a phone too.
  await dialog.getByRole('radio', { name: 'Phone' }).click();
  await expect(dialog.locator('.sp-piece[data-piece="' + aid + '"] .sp-res-row')).toHaveCount(2);

  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
