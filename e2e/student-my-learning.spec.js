import { test, expect } from '@playwright/test';

// S13-F2 and F3: My Learning in Preview as Student, Demo Mode. Off until the
// class's Show My Learning is on (S13-F1 sets it); on, the tab shows the
// grade and the skills in each grading style, and One Skill opens from a
// skill, all from returned grades only. SHOTS=dir saves a picture of each.

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

test('My Learning is off until the class shows it', async ({ page }) => {
  const { screen, errors } = await openPreview(page, null);
  await expect(screen.getByText('Your teacher hasn’t turned on My Learning for this class.')).toBeVisible();
  await expect(screen.locator('.sp-ml')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a Proficiency class: You’re at, Your Strongest, Your Skills, and One Skill', async ({ page }) => {
  const { at, dialog, screen, errors } = await openPreview(page, 'proficiency');
  const want = await page.evaluate(
    ({ cid, sid }) => {
      var l = StudentView.fromCache(cid, sid).view.learning;
      var word = withReturnedOnly(function () {
        return levelWord(cid, getOverallProficiency(cid, sid));
      });
      var best = l.groups
        .flatMap(function (g) {
          return g.skills;
        })
        .sort(function (a, b) {
          return b.pieces.length - a.pieces.length;
        })[0];
      return { word: word, first: l.groups[0].skills[0], best: best, next: l.next };
    },
    { cid: at.cid, sid: at.sid },
  );
  await expect(screen.locator('.sp-ml-at-word')).toHaveText(want.word);
  await expect(screen.getByRole('heading', { name: 'Your Skills' })).toBeVisible();
  await expect(screen.locator('.sp-ml-skills [data-act="skill"][data-skill="' + want.first.id + '"]')).toContainText(
    want.first.text || 'Not Yet',
  );
  // Next Step: the comment bank's step for the skill Generate would name, opening that skill.
  if (want.next) {
    await expect(screen.locator('.sp-ml-next')).toContainText('Next Step: ' + want.next.name);
    await expect(screen.locator('.sp-ml-next')).toContainText(want.next.text);
  }
  await expect(
    dialog.getByText('Their level on each skill and their grade, only from work you’ve returned.'),
  ).toBeVisible();
  await shot(page, 'S13-F2-proficiency-phone');

  // One Skill, from the skill with the most marked work: How It's Going and Your Work.
  const row = screen.locator('[data-act="skill"][data-skill="' + want.best.id + '"]').last();
  await row.evaluate(el => {
    var d = el.closest('details');
    if (d) d.open = true;
  });
  await row.click();
  await expect(screen.getByRole('heading', { name: want.best.name })).toBeFocused();
  for (const line of want.best.iCan) await expect(screen.getByText(line, { exact: true })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'How It’s Going' })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Your Work' })).toBeVisible();
  await expect(screen.locator('.sp-ml-one .sp-row-title').first()).toHaveText(want.best.pieces[0].title);
  await shot(page, 'S13-F3-one-skill-phone');
  await screen.getByRole('button', { name: 'My Learning' }).first().click();
  await expect(screen.locator('.sp-ml-at-word')).toBeVisible();

  await dialog.getByRole('radio', { name: 'Chromebook' }).click();
  await expect(screen.locator('.sp-ml-at-word')).toBeVisible();
  await shot(page, 'S13-F2-proficiency-chromebook');
  expect(errors).toEqual([]);
});

test('a Letter class: the letter and %, What Makes Up Your Grade, skills as a %', async ({ page }) => {
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
  await shot(page, 'S13-F2-letter-phone');
  expect(errors).toEqual([]);
});

test('a Both class: the letter and %, Your Strongest and the skills by level', async ({ page }) => {
  const { screen, errors } = await openPreview(page, 'both');
  await expect(screen.locator('.sp-ml-letter')).toBeVisible();
  await expect(screen.locator('.sp-ml-strongest')).toContainText('Your Strongest');
  // The Letter and Skills board leads with the skills: no What Makes Up Your Grade.
  await expect(screen.getByRole('heading', { name: 'What Makes Up Your Grade' })).toHaveCount(0);
  await expect(screen.getByRole('heading', { name: 'Your Skills' })).toBeVisible();
  await shot(page, 'S13-F2-both-phone');
  expect(errors).toEqual([]);
});

test('nothing returned yet: Nothing Marked Yet, and See Your Assignments goes back', async ({ page }) => {
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
  const name = await page.evaluate(() => {
    var cid = getActiveCourse();
    var st = sortStudents(getStudents(cid), 'lastName')[0];
    _cache.scores[cid][st.id] = [];
    delete _returnedSets[cid];
    clearProfCache();
    return displayNameWithLast(st);
  });
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const screen = page.getByRole('dialog', { name: 'Previewing as ' + name }).locator('.ps-screen');
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  await expect(screen.getByRole('heading', { name: 'Nothing Marked Yet' })).toBeVisible();
  await shot(page, 'S13-F2-nothing-yet-phone');
  await screen.getByRole('button', { name: 'See Your Assignments' }).click();
  await expect(screen.locator('.sp-segments')).toBeVisible();
});
