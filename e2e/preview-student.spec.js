import { test, expect } from '@playwright/test';

// S4-F6: Preview as Student, from Class Settings › Student Page, in Demo
// Mode. The preview shows the student's page from returned grades only: a
// draft's level is not on it. Phone and Chromebook; Back to Class Settings
// and Escape close it.

test('Preview as Student: the page from returned grades, Phone and Chromebook, and back', async ({ page }) => {
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
  // The class holds grades; one of the first student's grades becomes a draft.
  const at = await page.evaluate(() => {
    var cid = getActiveCourse();
    setStudentPageSwitch(cid, true);
    saveReturnSettings(cid, { return_grades: 'on_return' });
    var st = sortStudents(getStudents(cid), 'lastName')[0];
    var a = getAssessments(cid).find(function (x) {
      return (
        !x.rubricId &&
        !isPointsScored(x) &&
        (getScores(cid)[st.id] || []).some(function (e) {
          return e.assessmentId === x.id;
        })
      );
    });
    var returned = withReturnedOnly(function () {
      return assessmentCellValue(cid, st.id, a).text;
    });
    var e = getScores(cid)[st.id].find(function (x) {
      return x.assessmentId === a.id;
    });
    Grader.setLevel(cid, st.id, a.id, e.tagId, 1, 0);
    return {
      cid: cid,
      name: displayNameWithLast(st),
      title: a.title,
      returned: returned,
      draft: assessmentCellValue(cid, st.id, a).text,
    };
  });
  expect(at.draft).not.toBe(at.returned);

  await page.goto('/dashboard?manage=student-page');
  const open = page.getByRole('button', { name: 'Open Preview' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  await expect(dialog).toBeVisible();
  const row = dialog.locator('.sp-row', { hasText: at.title });
  await expect(row.locator('.sp-row-result')).toHaveText(at.returned);
  await expect(dialog.getByRole('radio', { name: 'Phone' })).toHaveAttribute('aria-checked', 'true');

  await dialog.getByRole('radio', { name: 'Chromebook' }).click();
  await expect(dialog.locator('.ps-device-chromebook')).toBeVisible();
  await expect(row.locator('.sp-row-result')).toHaveText(at.returned);

  await dialog.getByRole('button', { name: 'Back to Class Settings' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();

  await open.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
