/**
 * Add Work on the phone (S7-F3) and a student's To Grade list and the Grade
 * tab's count (S7-F4): Demo Mode, Science 8, Cell Microscope Lab, 375 x 812.
 * A real JPEG goes through the camera's file input, is shrunk in the browser
 * (shared/photo-shrink.js) and kept on the phone (shared/photo-queue.js,
 * IndexedDB); nothing is sent.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openPhone(page, { on = true, clear = [] } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(
    ({ on, clear, LAB }) => {
      const cid = getActiveCourse();
      const a = getAssessments(cid).find(x => x.id === LAB);
      clear.forEach(sid => {
        const keys = [...new Set((getScores(cid)[sid] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
        Grader.setOverallComment(cid, sid, LAB, '');
        getRubricCheckIds(cid, sid, LAB).forEach(id => Grader.setTick(cid, sid, LAB, id, false));
        if (keys.length) Grader.clearScore(cid, getScores(cid), sid, a, keys);
      });
      if (on) {
        setStudentPageSwitch(cid, true, 'on_return');
        const work = getCourseSubmissions(cid);
        work.course.send_work = true;
        saveDemoStudentWork(cid, work);
      }
    },
    { on, clear, LAB },
  );
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

async function openLab(page) {
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

const notIn = page =>
  page.evaluate(
    LAB =>
      MGradePhotos.notIn(
        'sci8',
        getAssessments('sci8').find(a => a.id === LAB),
      ),
    LAB,
  );
const fullName = (page, sid) => page.evaluate(sid => displayName(getStudents('sci8').find(s => s.id === sid)), sid);

test('with the build switch off there is no Add Work and no count', async ({ page }) => {
  await openPhone(page, { on: false, clear: ['st2'] });
  await expect(page.locator('.m-scard-tograde')).toHaveCount(0);
  await expect(page.locator('.m-tab-badge')).toHaveCount(0);
  await openLab(page);
  await expect(page.locator('[data-action="m-add-work"]')).toHaveCount(0);
});

test('Add Work from a not-in card: a photo, Save and Next, then the work is on the card', async ({ page }) => {
  await openPhone(page);
  await openLab(page);
  const pile = await notIn(page);
  const sid = pile[0];
  await page.locator('#m-thumb-strip .m-thumb[data-sid="' + sid + '"]').click();
  const card = page.locator('.m-swiper-card[data-sid="' + sid + '"]');
  const add = card.locator('[data-action="m-add-work"]');
  await expect(add).toBeInViewport();
  await expect(card.locator('.m-work-add-hint')).toHaveText(
    'Photos or PDFs. Photos are made smaller before they upload.',
  );
  await shot(page, 'S7-F3-add-work-for-student');

  await add.click();
  const screen = page.locator('#m-addwork');
  await expect(screen.locator('.m-addwork-name')).toHaveText(await fullName(page, sid));
  await expect(screen.locator('.m-addwork-count')).toHaveText('1 of ' + pile.length);
  await expect(screen.locator('.m-addwork-save')).toBeDisabled();
  await screen.locator('.m-addwork-input').setInputFiles(PHOTO);
  await expect(screen.locator('.m-addwork-taken img')).toHaveCount(1);
  await expect(screen.locator('.m-addwork-taken img')).toHaveAttribute('src', /^blob:/);
  await expect(screen.locator('.m-addwork-save')).toBeEnabled();
  await expect(screen.locator('.m-addwork-save')).toHaveText(/^Save and Next: /);
  await shot(page, 'S7-F3-add-work-next-student');

  await screen.locator('.m-addwork-save').click();
  await expect(screen.locator('.m-addwork-name')).toHaveText(await fullName(page, pile[1]));
  await expect(screen.locator('.m-addwork-count')).toHaveText('2 of ' + pile.length);
  const filed = await page.evaluate(({ sid, LAB }) => getStudentSubmission('sci8', sid, LAB), { sid, LAB });
  expect(filed).toMatchObject({ sent_by: 'teacher', on_paper: false });
  expect(filed.files).toHaveLength(1);
  expect(filed.files[0].bytes).toBeLessThanOrEqual(2 * 1000 * 1000);
  // Kept on the phone, never sent.
  const kept = await page.evaluate(async () => {
    await PhotoQueue.ready();
    const sent = (await PhotoQueue.send()).sent;
    return { sent, waiting: PhotoQueue.pages().length };
  });
  expect(kept).toEqual({ sent: 0, waiting: 1 });

  await screen.locator('[data-aw="close"]').click();
  await expect(screen).toHaveCount(0);
  // The card now shows the work, its photo read back from the phone.
  await expect(card.locator('[data-action="m-add-work"]')).toHaveCount(0);
  await expect(card.locator('.m-work-page img')).toHaveAttribute('src', /^blob:/);
});

test('a student who sent meanwhile: Add as More Pages, Replace Them, Skip', async ({ page }) => {
  await openPhone(page);
  await openLab(page);
  const sid = (await notIn(page))[0];
  await page.locator('#m-thumb-strip .m-thumb[data-sid="' + sid + '"]').click();
  await page.locator('.m-swiper-card[data-sid="' + sid + '"] [data-action="m-add-work"]').click();
  const screen = page.locator('#m-addwork');
  await screen.locator('.m-addwork-input').setInputFiles(PHOTO);
  await expect(screen.locator('.m-addwork-taken img')).toHaveCount(1);
  // The student sends from home while the teacher takes the photo.
  await page.evaluate(
    ({ sid, LAB }) => {
      const work = getCourseSubmissions('sci8');
      const pages = getStudentSubmission('sci8', 'st2', LAB).files;
      work.submissions.push({
        id: 'from-home',
        assessment_id: LAB,
        enrollment_id: sid,
        version: 1,
        state: 'sent',
        sent_by: 'student',
        on_paper: false,
        is_late: false,
        note: null,
        followed_plan: null,
        created_at: '2026-10-30T20:39:00',
        sent_at: '2026-10-30T20:41:00',
        files: pages.map(f => Object.assign({}, f, { id: 'h-' + f.id })),
      });
      saveDemoStudentWork('sci8', work);
    },
    { sid, LAB },
  );
  await screen.locator('.m-addwork-save').click();
  await expect(screen.locator('.m-addwork-conflict-line')).toHaveText(/ already sent 2 photos$/);
  await expect(screen.locator('.m-addwork-choice')).toHaveText(['Add as More Pages', 'Replace Them', /^Skip /]);
  await expect(screen.locator('.m-addwork-conflict-page img').first()).toHaveAttribute('src', /sample-work/);
  await shot(page, 'S7-F3-already-sent');
  await screen.locator('[data-aw="add"]').click();
  await expect(screen.locator('.m-addwork-conflict')).toHaveCount(0);
  const files = await page.evaluate(({ sid, LAB }) => getStudentSubmission('sci8', sid, LAB).files, { sid, LAB });
  expect(files.map(f => f.added_by)).toEqual(['student', 'student', 'teacher']);
});

test('the student card’s To Grade list, View Profile’s, the red count, and Add Work, Then Grade It', async ({
  page,
}) => {
  await openPhone(page, { clear: ['st2'] });
  const badge = page.locator('.m-tab-item[data-tab="grade"] .m-tab-badge');
  await expect(badge).toHaveText('1');
  // Noor's card: her lab waits to grade.
  await page.locator('[data-action="m-all-students"]').click();
  const row = await page.evaluate(() =>
    sortStudents(getStudents('sci8').slice(), 'alpha').findIndex(s => s.id === 'st2'),
  );
  await page.locator('[data-action="m-jump-student"]').nth(row).click();
  const top = page.locator('.m-card-stack-item[data-depth="0"]');
  const list = top.locator('.m-scard-tograde');
  await expect(list.locator('.m-scard-return-head')).toHaveText('To Grade');
  const gradeRow = list.locator('.m-scard-tograde-row[data-action="m-assess-grade"]').first();
  await expect(gradeRow.locator('.m-scard-return-sub')).toHaveText(/^Sent .+ · 2 photos$/);
  await expect(gradeRow.locator('.m-scard-tograde-act')).toHaveText('Grade');
  await expect(page.locator('[data-action="m-jump-student"]').first()).toBeHidden();
  await expect(list).toBeInViewport();
  await shot(page, 'S7-F4-student-card-to-grade');

  await top.locator('[data-action="m-student-detail"]').click();
  const detail = page.locator('#m-screen-student-detail');
  await expect(detail.locator('.m-scard-tograde .m-scard-return-head')).toHaveText('To Grade');
  await shot(page, 'S7-F4-view-profile-to-grade');

  // Grade opens the grader on that work, at Noor's card.
  await detail.locator('.m-scard-tograde-row[data-action="m-assess-grade"][data-aid="' + LAB + '"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('Cell Microscope Lab');
});

test('Add Work, Then Grade It from a student with nothing in', async ({ page }) => {
  await openPhone(page);
  const sid = (await notIn(page))[0];
  await page.locator('[data-action="m-all-students"]').click();
  const row = await page.evaluate(
    sid => sortStudents(getStudents('sci8').slice(), 'alpha').findIndex(s => s.id === sid),
    sid,
  );
  await page.locator('[data-action="m-jump-student"]').nth(row).click();
  const top = page.locator('.m-card-stack-item[data-depth="0"]');
  const addRow = top.locator('.m-scard-tograde-row[data-action="m-add-work"][data-aid="' + LAB + '"]');
  await expect(addRow.locator('.m-scard-tograde-act')).toHaveText('Add Work');
  await addRow.click();
  const screen = page.locator('#m-addwork');
  await expect(screen.locator('.m-addwork-close')).toHaveText('Cancel');
  await expect(screen.locator('.m-addwork-save')).toHaveText('Save and Grade');
  await screen.locator('.m-addwork-input').setInputFiles(PHOTO);
  await expect(screen.locator('.m-addwork-taken img')).toHaveCount(1);
  await shot(page, 'S7-F3-add-work-then-grade');
  await screen.locator('.m-addwork-save').click();
  await expect(screen).toHaveCount(0);
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  const card = page.locator('.m-swiper-card[data-sid="' + sid + '"]');
  await expect(card.locator('.m-work-sent')).toHaveText(/^Submitted .+ · 1 photo$/);
  await expect(card.locator('[data-action="m-add-work"]')).toHaveCount(0);
});

test('Reset Demo Data deletes the photos a teacher added on the phone', async ({ page }) => {
  await openPhone(page);
  const sid = (await notIn(page))[0];
  // Add Work keeps its photos in the photo queue (IndexedDB), not in the class data.
  const kept = await page.evaluate(
    async ({ sid, LAB }) => {
      const b = new Blob([new Uint8Array([255, 216, 255, 224])], { type: 'image/jpeg' });
      const res = await addStudentWorkPages('sci8', sid, LAB, [
        { blob: b, thumb: b, hash: 'a'.repeat(64), width: 10, height: 10 },
      ]);
      await PhotoQueue.ready();
      return { result: res.result, queued: PhotoQueue.stats().queued };
    },
    { sid, LAB },
  );
  expect(kept).toEqual({ result: 'sent', queued: 1 });

  await page.locator('.m-screen .m-demo-pill').click();
  const sheet = page.locator('#m-sheet-container .m-sheet.m-sheet-visible');
  await sheet.getByRole('button', { name: 'Reset Demo Data' }).click();
  // The reset reloads the page once the photos are gone.
  const reloaded = page.waitForEvent('load');
  await sheet.getByRole('button', { name: 'Reset', exact: true }).click();
  await reloaded;
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
  const left = await page.evaluate(async () => {
    await PhotoQueue.ready();
    return { queued: PhotoQueue.stats().queued, rows: (await PhotoQueue.indexedDbStore().list()).length };
  });
  expect(left).toEqual({ queued: 0, rows: 0 });
});
