/**
 * Mark Up a photo on the phone (S9-F2): Demo Mode, Science 8, Cell
 * Microscope Lab, 375 x 812. The sample page with marks is drawn on with
 * real pointer events; nothing is sent.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openPhone(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
  });
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

// The sample student whose page already has marks.
const marked = page =>
  page.evaluate(LAB => getAssessmentMarkup('sci8', LAB).find(r => r.marks.marks.length > 2).enrollment_id, LAB);

test('Mark Up from the photos full screen: draw, a tick, a note, two fingers zoom, Done saves', async ({ page }) => {
  await openPhone(page);
  const sid = await marked(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
  await page.locator('#m-thumb-strip .m-thumb[data-sid="' + sid + '"]').click();
  const card = page.locator('.m-swiper-card[data-sid="' + sid + '"]');
  await card.locator('.m-work-full').click();
  await page.locator('#m-sheet-container [data-action="m-markup-open"]').first().click();

  const mk = page.locator('#m-markup');
  await expect(mk.locator('.m-markup-title')).toHaveText('Mark Up');
  await expect(mk.locator('.m-markup-hint')).toHaveText('One finger draws. Two fingers move the page.');
  await expect(mk.locator('.markup-pin text')).toHaveCount(3);
  await expect(mk).toHaveAttribute('data-page-shown', /.+/);
  const before = await page.evaluate(() => MMarkUp.marks().length);
  await shot(page, 'S9-F2-phone-markup');

  const box = await mk.locator('.m-markup-layer').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  // One finger: a pen line.
  await page.mouse.move(...at(0.2, 0.55));
  await page.mouse.down();
  await page.mouse.move(...at(0.35, 0.57), { steps: 4 });
  await page.mouse.move(...at(0.5, 0.56), { steps: 4 });
  await page.mouse.up();
  // A tick.
  await mk.getByRole('button', { name: 'Tick' }).click();
  await page.mouse.click(...at(0.15, 0.3));
  // A note.
  await mk.getByRole('button', { name: 'Note' }).click();
  await page.mouse.click(...at(0.3, 0.9));
  await mk.locator('.m-markup-note-text').fill('Show your scale bar.');
  await mk.getByRole('button', { name: 'Add Note' }).click();
  await expect(mk.locator('.markup-pin text')).toHaveCount(4);
  expect(await page.evaluate(() => MMarkUp.marks().length)).toBe(before + 3);

  // Two fingers spread: the page zooms and nothing is drawn.
  await page.evaluate(() => {
    const stage = document.querySelector('#m-markup .m-markup-stage');
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type, id, x, y) =>
      stage.dispatchEvent(
        new PointerEvent('pointer' + type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    fire('down', 11, cx - 20, cy);
    fire('down', 12, cx + 20, cy);
    fire('move', 11, cx - 80, cy);
    fire('move', 12, cx + 80, cy);
    fire('up', 11, cx - 80, cy);
    fire('up', 12, cx + 80, cy);
  });
  await expect(mk.locator('.m-markup-layer')).toHaveAttribute('style', /scale\((?!1\))/);
  expect(await page.evaluate(() => MMarkUp.marks().length)).toBe(before + 3);
  await shot(page, 'S9-F2-phone-markup-zoomed');

  await mk.getByRole('button', { name: 'Undo' }).click();
  await expect(mk.locator('.markup-pin text')).toHaveCount(3);
  await mk.getByRole('button', { name: 'Redo' }).click();
  await mk.getByRole('button', { name: 'Done' }).click();
  await expect(mk).toHaveCount(0);
  const saved = await page.evaluate(
    ({ sid, LAB }) => {
      const f = getStudentSubmission('sci8', sid, LAB).files[0];
      return getPageMarkup('sci8', f.id).marks.marks.map(m => m.type);
    },
    { sid, LAB },
  );
  expect(saved.length).toBe(before + 3);
  expect(saved.slice(-3)).toEqual(['pen', 'tick', 'note']);
});
