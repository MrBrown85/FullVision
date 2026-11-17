/**
 * The rubric card on the Work Wall shows the whole rubric (Colin, Nov 17
 * 2026: "The rubric should show in this view completely"). Demo Mode,
 * Science 8, Cell Microscope Lab: an Advanced Rubric, three criteria with
 * a checklist in every level. At a laptop's 760px the card is taller than
 * the window, and it used to empty every level but the student's to fit.
 * Every level's descriptor and every checkbox must stay, the student's
 * level filled, the ticked boxes ticked, and nothing cut off.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 760 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';

async function openWall(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  const cid = await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    return cid;
  });
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  expect(await page.evaluate(({ cid, LAB }) => WorkWall.open(cid, LAB), { cid, LAB })).toBe(true);
  return cid;
}

test('the rubric card keeps every level, every checkbox, and fits the window', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cid = await openWall(page);
  const cards = page.locator('#work-wall-overlay .ww-card[data-sid]');
  // Extending at each end of a row (the card is drawn wider or narrower
  // beside each), then the first Proficient, whose higher boxes are not ticked.
  const count = await cards.count();
  expect(count).toBeGreaterThan(4);
  let unticked = 0;
  for (const i of [0, 3, 4]) {
    // Scrolling takes the rubric card off, so the card is in view first.
    await cards.nth(i).scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await expect(page.locator('.wr-card')).toHaveCount(0);
    await cards.nth(i).hover();
    const card = page.locator('.wr-card');
    await expect(card.locator('.wr-row')).toHaveCount(3);
    const sid = await cards.nth(i).getAttribute('data-sid');
    const got = await page.evaluate(
      ({ cid, sid, LAB }) => {
        const a = getAssessments(cid).find(x => x.id === LAB);
        const crits = getRubricById(cid, a.rubricId).criteria;
        const ticked = getRubricCheckIds(cid, sid, LAB);
        const el = document.querySelector('.wr-card');
        const body = el.querySelector('.wr-body').getBoundingClientRect();
        const table = el.querySelector('.wr-table').getBoundingClientRect();
        const rows = [...el.querySelectorAll('.wr-row')].map((tr, r) => {
          const c = crits[r];
          return [...tr.querySelectorAll('.wr-cell')].map((td, k) => {
            const lv = levelOrderFor(cid)[k];
            const desc = td.querySelector('.wr-desc');
            const shown = x => !!x && x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden';
            return {
              on: td.classList.contains('is-on'),
              desc: shown(desc) ? desc.innerText.trim() : '',
              wantDesc: String(c.levels[lv] || '').trim(),
              clamped: !!desc && desc.scrollHeight > desc.clientHeight + 1,
              checks: [...td.querySelectorAll('.wr-check')].filter(shown).map(x => ({
                label: x.lastChild.textContent.trim(),
                on: x.classList.contains('is-on'),
              })),
              wantChecks: RubricChecks.checksAt(c, lv).map(k2 => ({
                label: k2.label,
                on: ticked.indexOf(k2.id) >= 0,
              })),
            };
          });
        });
        return {
          rows,
          ticked: ticked.length,
          cut: table.bottom > body.bottom + 1,
          inWindow: el.getBoundingClientRect().bottom <= innerHeight,
        };
      },
      { cid, sid, LAB },
    );
    expect(got.ticked, 'the sample student has ticked boxes').toBeGreaterThan(0);
    expect(got.cut, 'nothing of the rubric is cut off').toBe(false);
    expect(got.inWindow).toBe(true);
    got.rows.forEach(cells => cells.forEach(c => (unticked += c.checks.filter(k => !k.on).length)));
    got.rows.forEach(cells => {
      expect(cells).toHaveLength(4);
      expect(cells.filter(c => c.on)).toHaveLength(1);
      cells.forEach(c => {
        expect(c.desc).toBe(c.wantDesc);
        expect(c.clamped).toBe(false);
        expect(c.checks).toEqual(c.wantChecks);
      });
    });
    if (SHOTS && i === 4) await page.screenshot({ path: SHOTS + '/work-rubric-card-whole.png' });
  }
  expect(unticked, 'boxes not ticked are shown, not ticked').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
