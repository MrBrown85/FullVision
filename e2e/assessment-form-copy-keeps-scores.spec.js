import { test, expect } from '@playwright/test';

/* Edit a Copy on scored work (redesign PR 10, 2026-11-02): the copy is
   offered, and this assessment's rubric scores move to the copy's criteria,
   criterion by criterion; the other assessments on the original keep
   theirs. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

test('a copy of a shared rubric takes this assessment’s scores with it', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await expect(page.locator('[data-action="editAssess"]').first()).toBeAttached();
  // A scored assessment on a rubric another assessment also uses.
  const snap = () =>
    page.evaluate(() => {
      const all = getAssessments('sci8');
      const scored = a => getStudents('sci8').some(s => hasScoreOrFeedback('sci8', s.id, a.id));
      const a = all.find(
        x => x.rubricId && scored(x) && all.some(y => y.id !== x.id && y.rubricId === x.rubricId && scored(y)),
      );
      const other = all.find(y => y.id !== a.id && y.rubricId === a.rubricId && scored(y));
      const rows = aid =>
        Object.entries(getScores('sci8'))
          .flatMap(([sid, list]) => (list || []).filter(e => e.assessmentId === aid).map(e => ({ sid, ...e })))
          .sort((p, q) => (p.sid + p.tagId < q.sid + q.tagId ? -1 : 1));
      const r = getRubricById('sci8', a.rubricId);
      return {
        aid: a.id,
        oid: other.id,
        rid: a.rubricId,
        crits: r.criteria.map(c => c.id),
        mine: rows(a.id),
        theirs: rows(other.id),
      };
    });
  const before = await snap();
  expect(before.mine.length).toBeGreaterThan(0);

  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), before.aid);
  await page.locator('[data-action="editRubricFromForm"]').click();
  await expect(page.locator('.af-dialog-card .confirm-message')).toContainText('A copy takes them with it');
  const copyBtn = page.locator('.af-dialog-card button', { hasText: 'Edit a Copy for' });
  await expect(copyBtn).toBeEnabled();
  await copyBtn.click();
  await page.locator('[data-action="saveRubricEdit"]').click();
  await page.locator('[data-action="saveEditAssess"]').click();

  await expect
    .poll(() => page.evaluate(aid => getAssessments('sci8').find(a => a.id === aid).rubricId, before.aid))
    .not.toBe(before.rid);
  const after = await page.evaluate(
    ({ aid, oid }) => {
      const a = getAssessments('sci8').find(x => x.id === aid);
      const r = getRubricById('sci8', a.rubricId);
      const rows = id =>
        Object.entries(getScores('sci8'))
          .flatMap(([sid, list]) => (list || []).filter(e => e.assessmentId === id).map(e => ({ sid, ...e })))
          .sort((p, q) => (p.sid + p.tagId < q.sid + q.tagId ? -1 : 1));
      return { crits: r.criteria.map(c => c.id), mine: rows(aid), theirs: rows(oid) };
    },
    { aid: before.aid, oid: before.oid },
  );
  // Each score now sits on the copy's criterion in the same place, unchanged otherwise.
  const moved = before.mine.map(e => {
    const i = before.crits.indexOf(e.tagId);
    const to = i >= 0 ? after.crits[i] : e.tagId;
    return { ...e, tagId: to, id: before.aid + ':' + to };
  });
  const key = e => e.sid + '|' + e.tagId;
  expect(after.mine.map(key).sort()).toEqual(moved.map(key).sort());
  for (const m of moved) {
    const got = after.mine.find(e => key(e) === key(m));
    expect(got.score).toBe(m.score);
  }
  expect(after.mine.some(e => before.crits.includes(e.tagId))).toBe(false);
  // The other assessment on the original rubric keeps its scores.
  expect(after.theirs).toEqual(before.theirs);
});
