/**
 * Every Scores column is as wide as its tilted title (48px), whatever its
 * cells hold. To Grade's chip and the camera next to a grade made columns
 * up to 78px wide, so the cells stopped lining up with the titles above
 * them; a points column's "59.6/80" Class Average and a Letter class's
 * "100%" with Late's L did the same. Demo Mode's sample with the student
 * page and Send Work on carries every mark: To Grade, photos, a draft, a
 * question, Revising, Late. Each grading style is drawn in turn.
 */
import { test, expect } from '@playwright/test';

// The build switch and Send Work on, as Class Settings › Student Page turns them on.
const turnOn = () => {
  const cid = getActiveCourse();
  setStudentPageSwitch(cid, true, 'on_return');
  const work = getCourseSubmissions(cid);
  work.course.send_work = true;
  saveDemoStudentWork(cid, work);
};

test.use({ viewport: { width: 1500, height: 900 } });

// A wide face as a Chromebook, Windows or CI's Linux draws it, forced on every element.
const WIDE =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getCourseSubmissions('sci8').submissions.length === 16, null, { timeout: 15000 });
  await page.evaluate(turnOn);
  // Demo Mode opened again: the class holds grades now, so the drafts are made.
  await page.goto('/dashboard');
  await page.waitForFunction(() => GradeState.draftsWaiting('sci8') === 2, null, { timeout: 15000 });
});

for (const style of ['proficiency', 'letter', 'both'])
  for (const face of ['page', 'wide']) {
    test('every column is its title’s width: ' + style + ', ' + face + ' font', async ({ page }) => {
      await page.goto('/gradebook');
      await page.waitForSelector('.gb-scores-cell', { timeout: 10000 });
      if (face === 'wide') await page.addStyleTag({ content: WIDE });
      await page.evaluate(s => {
        COURSES[getActiveCourse()].gradingSystem = s;
        PageGradebook.render();
      }, style);
      await page.waitForSelector('.gb-scores-cell', { timeout: 10000 });
      const at = await page.evaluate(() => {
        const w = el => Math.round(el.getBoundingClientRect().width * 10) / 10;
        const wide = [...document.querySelectorAll('.gb-scores-cell, .gb-scores-avg')]
          .filter(c => w(c) > 48.5)
          .map(c => (c.dataset.aid || 'average') + ' ' + w(c));
        const marks = {};
        for (const m of ['gb-to-grade', 'gb-work-camera', 'gb-question', 'gb-revising', 'gb-late', 'gb-draft']) {
          marks[m] = document.querySelectorAll('.gb-scores-cell .' + m + ', .gb-scores-cell.' + m).length > 0;
        }
        return {
          style: courseGradeMode(getActiveCourse()),
          heads: [...new Set([...document.querySelectorAll('.gb-grid-colhead')].map(w))],
          wide: [...new Set(wide)].slice(0, 6),
          marks,
        };
      });
      expect(at.style).toBe(style);
      // The sample carries every mark, or this test proves nothing.
      expect(at.marks).toEqual({
        'gb-to-grade': true,
        'gb-work-camera': true,
        'gb-question': true,
        'gb-revising': true,
        'gb-late': true,
        'gb-draft': true,
      });
      expect(at.heads).toEqual([48]);
      expect(at.wide).toEqual([]);
    });
  }
