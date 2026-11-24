import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';

// My Learning in Preview as Student, Demo Mode (S13-F2; redrawn by Colin's
// ruling of 2026-11-14). The tab always lists Your Work; once the class's
// Show My Learning is on (S13-F1 sets it), the grade sits above it in the
// class's grading style, from returned grades only. SHOTS=dir saves a
// picture of each.

test.beforeEach(({ page }) => demoStudentPageOff(page));

const SHOTS = process.env.SHOTS || '';

async function openPreview(page, system) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0 && getAllTags(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  const at = await page.evaluate(system => {
    var cid = getActiveCourse();
    setStudentPageSwitch(cid, true);
    if (system) {
      saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), { show_my_learning: true }));
      COURSES[cid].gradingSystem = system;
      saveCourses(COURSES);
    }
    var st = sortStudents(getStudents(cid), 'lastName')[0];
    return { cid: cid, sid: st.id, name: displayNameWithLast(st) };
  }, system);
  await page.goto('/dashboard?manage=student-page');
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  await expect(dialog).toBeVisible();
  const screen = dialog.locator('.ps-screen');
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  return { at, dialog, screen, errors };
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' });
}

test('with Show My Learning off: Your Work, and no grade', async ({ page }) => {
  const { dialog, screen, errors } = await openPreview(page, null);
  await expect(screen.getByRole('heading', { name: 'My Learning' })).toBeVisible();
  await expect(screen.locator('.sp-ml-work .sp-ml-row').first()).toBeVisible();
  await expect(screen.locator('.sp-ml-overall')).toHaveCount(0);
  await expect(screen.getByText('Your teacher hasn’t turned on My Learning for this class.')).toHaveCount(0);
  await expect(
    dialog.getByText('Show Overall Grade is off for this class. Turn it on in Class Settings › Student Page.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a Proficiency class: You’re at and Your Work, with no Work On Next', async ({ page }) => {
  const { at, dialog, screen, errors } = await openPreview(page, 'proficiency');
  const want = await page.evaluate(
    ({ cid, sid }) => {
      var view = StudentView.fromCache(cid, sid).view;
      var word = withReturnedOnly(function () {
        return levelWord(cid, getOverallProficiency(cid, sid));
      });
      return {
        word: word,
        rows: StudentPageView.learningPieces(view).map(function (p) {
          return p.title;
        }),
      };
    },
    { cid: at.cid, sid: at.sid },
  );
  await expect(screen.locator('.sp-ml-period')).toHaveText('This Year So Far');
  await expect(screen.locator('.sp-ml-at-word')).toHaveText(want.word);
  await expect(screen.locator('.sp-ml-overall .sp-ml-ladder')).toBeVisible();
  // No Work On Next on the student page (Colin, Nov 17: "It seems like clutter").
  await expect(screen.locator('.sp-ml-next')).toHaveCount(0);
  await expect(screen.getByText(/Work On Next/)).toHaveCount(0);
  await expect(screen.locator('.sp-ml-work .sp-row-title')).toHaveText(want.rows);
  // Gone with the redesign: Your Strongest, Your Skills and One Skill.
  await expect(screen.getByRole('heading', { name: 'Your Skills' })).toHaveCount(0);
  await expect(screen.locator('[data-act="skill"]')).toHaveCount(0);
  await expect(screen.locator('.sp-ml-strongest')).toHaveCount(0);
  await expect(screen.getByRole('heading', { name: 'What Makes Up Your Grade' })).toHaveCount(0);
  await expect(dialog.getByText('Their grade, only from work you’ve returned.')).toBeVisible();
  await shot(page, 'S13-F2-proficiency-phone');

  // A returned row opens Your Feedback, and its back button goes to My Learning.
  await screen.locator('.sp-ml-work .sp-ml-row[data-act="feedback"]').first().click();
  await expect(screen.locator('.sp-fb-title')).toBeFocused();
  await screen.locator('.sp-fb-back').click();
  await expect(screen.locator('.sp-ml-at-word')).toBeVisible();

  await dialog.getByRole('radio', { name: 'Chromebook' }).click();
  await expect(screen.locator('.sp-ml-at-word')).toBeVisible();
  await shot(page, 'S13-F2-proficiency-chromebook');
  expect(errors).toEqual([]);
});

test('Class Settings says what Show My Learning shows', async ({ page }) => {
  await openPreview(page, 'proficiency');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sp-learning-hint')).toHaveText(
    'Students see their overall grade, from work you’ve returned, at the top of My Learning. Off, they still see each piece’s result.',
  );
  await expect(page.locator('#sp-learning-would')).toHaveText(
    "Students would see their grade in this class’s grading style (Proficiency), only from work you've returned.",
  );
});

test('a Letter class: the letter and %, and What Makes Up Your Grade', async ({ page }) => {
  const { at, screen, errors } = await openPreview(page, 'letter');
  const want = await page.evaluate(
    ({ cid, sid }) =>
      withReturnedOnly(function () {
        return studentGradeBadges(cid, sid).letter;
      }),
    { cid: at.cid, sid: at.sid },
  );
  await expect(screen.locator('.sp-ml-letter')).toHaveText(want.grade);
  await expect(screen.locator('.sp-ml-pct')).toHaveText(want.pct);
  await expect(screen.getByRole('heading', { name: 'What Makes Up Your Grade' })).toBeVisible();
  await expect(screen.getByText('Counts 40%')).toBeVisible();
  await expect(screen.locator('.sp-ml-at-word')).toHaveCount(0);
  // Missing work counts as 0 in a class with a course %.
  const missing = screen.locator('.sp-ml-row', { has: screen.locator('.sp-lv-missing') });
  if (await missing.count())
    await expect(missing.first().locator('.sp-row-sub')).toContainText('counts as 0 until it’s in');
  await shot(page, 'S13-F2-letter-phone');
  expect(errors).toEqual([]);
});

test('a Both class: the letter and %, and What Makes Up Your Grade', async ({ page }) => {
  const { screen, errors } = await openPreview(page, 'both');
  await expect(screen.locator('.sp-ml-letter')).toBeVisible();
  await expect(screen.locator('.sp-ml-pct')).toHaveText(/%$/);
  await expect(screen.getByRole('heading', { name: 'What Makes Up Your Grade' })).toBeVisible();
  await expect(screen.locator('.sp-ml-strongest')).toHaveCount(0);
  await expect(screen.getByRole('heading', { name: 'Your Skills' })).toHaveCount(0);
  await shot(page, 'S13-F2-both-phone');
  expect(errors).toEqual([]);
});

test('nothing returned yet: no grade, and Your Work lists only what is still owed', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getActiveCourse === 'function' && getStudents(getActiveCourse()).length > 0);
  await page.evaluate(() => {
    var cid = getActiveCourse();
    setStudentPageSwitch(cid, true);
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), { show_my_learning: true }));
  });
  await page.goto('/dashboard?manage=student-page');
  await page.getByRole('button', { name: 'Open Preview' }).waitFor();
  // A student with no grade at all, in this page's memory only.
  const at = await page.evaluate(() => {
    var cid = getActiveCourse();
    var st = sortStudents(getStudents(cid), 'lastName')[0];
    _cache.scores[cid][st.id] = [];
    delete _returnedSets[cid];
    clearProfCache();
    var view = StudentView.fromCache(cid, st.id).view;
    return {
      name: displayNameWithLast(st),
      rows: StudentPageView.learningPieces(view).map(function (p) {
        return p.title;
      }),
    };
  });
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const screen = page.getByRole('dialog', { name: 'Previewing as ' + at.name }).locator('.ps-screen');
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  await expect(screen.locator('.sp-ml-overall')).toHaveCount(0);
  if (at.rows.length) {
    await expect(screen.locator('.sp-ml-work .sp-row-title')).toHaveText(at.rows);
    await expect(screen.locator('.sp-ml-work .sp-ml-row[data-act="feedback"]')).toHaveCount(0);
  } else {
    await expect(screen.getByRole('heading', { name: 'Nothing Here Yet' })).toBeVisible();
    await screen.getByRole('button', { name: 'See Your Assignments' }).click();
    await expect(screen.locator('.sp-segments')).toBeVisible();
  }
  await shot(page, 'S13-F2-nothing-yet-phone');
});
