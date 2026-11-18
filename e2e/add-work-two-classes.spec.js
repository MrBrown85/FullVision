/**
 * Add Work for the Class: one pile, two classes; a late paper (B6,
 * docs/plans/add-work-for-class-plan.md). Demo Mode at 1366 x 900.
 *
 * Demo Mode has one class (Science 8). This spec makes a second, "Block C",
 * through the app's own calls (createCourse, saveStudents,
 * saveAssessments), with its own Cell Microscope Lab and three students:
 * one has the very name of a Science 8 student.
 *
 * - This Pile Has Two Classes, turned on; both classes listed.
 * - A file on a Block C student, then two classes off: the file waits in
 *   the tray, never on a Science 8 student.
 * - A made-up 6-page scan split in pieces of 2: a Block C student; the
 *   shared name, which Return alone does not take (the arrow picks the
 *   Block C one); a Science 8 student whose piece is then set For another
 *   assessment (a late paper).
 * - Add Work: each student's pages in their own class and assessment,
 *   nothing for anyone else; the Not In list shows each class; one Grade in
 *   Scan Order button, for Block C.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { madeUpScan } from './made-up-scan.js';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('one pile, two classes, and a late paper: every page in its own class and assessment', async ({ page }) => {
  // The scan specs take about 20 s on CI's two cores (main's run, PR 1537).
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1') && !!window.AddWorkTwoClasses;
  });

  // On Science 8's Assignments: the second class is made here, with no reload.
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  const set = await page.evaluate(LAB => {
    const cidA = getActiveCourse();
    const sendWork = cid => {
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      // Students Send: Photos, as the teacher sets it on the piece.
      work.assessments = work.assessments.map(x => Object.assign({}, x, { students_send: 'photos' }));
      saveDemoStudentWork(cid, work);
    };
    sendWork(cidA);
    const lab = getAssessments(cidA).find(x => x.id === LAB);
    const plain = st => !st.preferred || st.preferred === st.firstName;
    const free = AddWorkClass.students(cidA, lab).filter(st => plain(st) && !getStudentSubmission(cidA, st.id, LAB));
    const twinA = free[1];
    const lateA = free[3];
    // The late paper's assessment: one where that student has nothing in.
    const late = getAssessments(cidA).find(
      x => x.id !== LAB && !x.isDraft && AddWorkClass.offered(cidA, x) && !getStudentSubmission(cidA, lateA.id, x.id),
    );
    // The second class, made as a teacher makes one.
    const cidB = createCourse({ name: 'Block C', gradeLevel: '8' }).id;
    const mk = (first, last) => ({ id: crypto.randomUUID(), firstName: first, lastName: last });
    const b = [mk('Ximena', 'Quill'), mk(twinA.firstName, twinA.lastName), mk('Yusuf', 'Zane')];
    saveStudents(cidB, b);
    const copy = Object.assign({}, lab, { id: 'blab-' + Date.now().toString(36), title: '  cell microscope  LAB ' });
    saveAssessments(cidB, [copy]);
    sendWork(cidB);
    // The page drawn again with Send Work on.
    PageAssignments.render();
    const nm = st => (st.preferred || st.firstName) + ' ' + st.lastName;
    return {
      cidA,
      cidB,
      bLab: copy.id,
      b: b.map(st => ({ id: st.id, name: nm(st) })),
      twinA: { id: twinA.id, name: nm(twinA) },
      lateA: { id: lateA.id, name: nm(lateA), first: lateA.preferred || lateA.firstName },
      late: late.id,
    };
  }, LAB);

  // What each write carried.
  await page.evaluate(() => {
    const real = window.addStudentWorkPages;
    window.__sent = [];
    window.addStudentWorkPages = function (cid, sid, aid, pages) {
      window.__sent.push({ cid, sid, aid, shapes: pages.map(pg => Math.round((pg.width / pg.height) * 1000)) });
      return real.apply(this, arguments);
    };
  });
  const shapes = await page.evaluate(madeUpScan, 6);
  expect(await page.evaluate(() => getActiveCourse())).toBe(set.cidA);
  const card = page.locator('#ac-' + LAB);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await card.locator('.assess-more-btn').click();
  await card.locator('.assess-add-class-btn').click();
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc.locator('.awc-title')).toHaveText('Add Work for the Class');

  // Offered, never on by itself.
  const two = awc.getByRole('switch', { name: 'This Pile Has Two Classes' });
  await expect(two).toHaveAttribute('aria-checked', 'false');
  await expect(awc.locator('.awc-two-line')).toContainText('Block C has Cell Microscope Lab too.');
  await expect(awc.locator('.awc-class-head')).toHaveCount(0);
  await two.click();
  await expect(two).toHaveAttribute('aria-checked', 'true');
  await expect(awc.locator('.awc-class-head').nth(0)).toHaveText('Science 8');
  await expect(awc.locator('.awc-class-head').nth(1)).toHaveText('Block C');
  for (const st of set.b) await expect(awc.locator('.awc-row[data-awc-target="' + st.id + '"]')).toHaveCount(1);

  // A file on a Block C student, then two classes off: it waits in the tray.
  await awc.locator('.awc-file[data-sid="' + set.b[2].id + '"]').setInputFiles(PHOTO);
  await expect(awc.locator('.awc-row[data-awc-target="' + set.b[2].id + '"] .awc-chip')).toHaveCount(1, {
    timeout: 15000,
  });
  await two.click();
  await expect(two).toHaveAttribute('aria-checked', 'false');
  await expect(awc.locator('.awc-two-line')).toHaveText('1 file from Block C went back to Waiting for a Student.');
  await expect(awc.locator('.awt-item')).toHaveCount(1);
  await expect(awc.locator('.awc-chip')).toHaveCount(0);
  await awc.locator('.awt-item .awt-off').click();
  await expect(awc.locator('.awt-item')).toHaveCount(0);
  await two.click();
  await expect(two).toHaveAttribute('aria-checked', 'true');

  // The scan, split across both classes.
  await page.evaluate(() => {
    const input = document.querySelector('.awt-input[data-awt-input="scan"]');
    const dt = new DataTransfer();
    dt.items.add(window.__scan);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const aws = page.locator('#add-work-split-overlay');
  await expect(aws.locator('.aws-card')).toHaveCount(6, { timeout: 20000 });
  // Not Class List Order: a pile can't be in two lists' order.
  await expect(aws.getByRole('button', { name: 'Class List Order' })).toHaveCount(0);
  await aws.getByRole('button', { name: 'One more page per student' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(3);

  // Piece 1: a Block C student.
  await aws.locator('#aws-name-0').focus();
  await page.keyboard.type(set.b[0].name.slice(0, -1));
  await expect(aws.locator('#aws-list-0 .aws-option').first()).toHaveText(set.b[0].name + ' · Block C');
  await page.keyboard.press('Enter');
  await expect(aws.locator('#aws-name-1')).toBeFocused();
  // Piece 2: the name in both classes. Return alone takes neither; the arrow picks.
  await page.keyboard.type(set.twinA.name);
  await expect(aws.locator('#aws-list-1 .aws-option')).toHaveText([
    set.twinA.name + ' · Science 8',
    set.twinA.name + ' · Block C',
  ]);
  await page.keyboard.press('Enter');
  await expect(aws.locator('.aws-note')).toHaveText(
    'Two students are named ' + set.twinA.name + '. Choose one with the arrow keys.',
  );
  await expect(aws.locator('.aws-tally')).toContainText('1 named');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(aws.locator('#aws-name-1')).toHaveValue(set.twinA.name);
  // Piece 3: a Science 8 student.
  await aws.locator('#aws-name-2').focus();
  await page.keyboard.type(set.lateA.name);
  await page.keyboard.press('Enter');
  await expect(aws.locator('.aws-tally')).toContainText('3 named');
  await aws.getByRole('button', { name: 'Match the Named Pieces' }).click();
  await expect(aws).toHaveCount(0);

  // Who got which piece, on the class page.
  const row = sid => awc.locator('.awc-row[data-awc-target="' + sid + '"]');
  await expect(row(set.b[0].id).locator('.awc-chip')).toHaveCount(1);
  await expect(row(set.b[1].id).locator('.awc-chip')).toHaveCount(1);
  await expect(row(set.twinA.id).locator('.awc-chip')).toHaveCount(0);
  await expect(row(set.lateA.id).locator('.awc-chip')).toHaveCount(1);

  // A late paper: the Science 8 student's piece is for another assessment.
  const forSel = row(set.lateA.id).locator('.awc-for select');
  await expect(forSel).toHaveValue(LAB);
  await forSel.selectOption(set.late);
  await expect(row(set.lateA.id).locator('.awc-chip.is-late')).toHaveCount(1);
  await expect(row(set.lateA.id).locator('.awc-chip.is-late .awc-for select')).toHaveValue(set.late);
  await expect(row(set.lateA.id).locator('.awc-late-hint')).toHaveText(
    'Changing which assessment a file is for doesn’t set Late.',
  );
  await shot(page, 'add-work-two-classes-placed');

  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 3 Students');
  await awc.locator('.awc-primary').click();
  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 3 Students', { timeout: 15000 });

  // Every page in its own class and assessment, and nothing else written.
  const sent = await page.evaluate(() => window.__sent);
  const which = list =>
    list.map(v => 1 + shapes.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(shapes[best] - v) ? i : best), 0));
  expect(
    sent
      .map(w => ({ cid: w.cid, sid: w.sid, aid: w.aid, pages: which(w.shapes) }))
      .sort((p, q) => p.pages[0] - q.pages[0]),
  ).toEqual([
    { cid: set.cidB, sid: set.b[0].id, aid: set.bLab, pages: [1, 2] },
    { cid: set.cidB, sid: set.b[1].id, aid: set.bLab, pages: [3, 4] },
    { cid: set.cidA, sid: set.lateA.id, aid: set.late, pages: [5, 6] },
  ]);
  const stored = await page.evaluate(
    ({ set, LAB }) => ({
      bOwn: (getStudentSubmission(set.cidB, set.b[1].id, set.bLab) || { files: [] }).files.length,
      twinA: !!getStudentSubmission(set.cidA, set.twinA.id, LAB),
      lateIn: (getStudentSubmission(set.cidA, set.lateA.id, set.late) || { files: [] }).files.length,
      lateLab: !!getStudentSubmission(set.cidA, set.lateA.id, LAB),
      lateStatus: getAssignmentStatus(set.cidA, set.lateA.id, set.late) || null,
    }),
    { set, LAB },
  );
  expect(stored).toEqual({ bOwn: 2, twinA: false, lateIn: 2, lateLab: false, lateStatus: null });

  // Still Not In: both classes, each student with their class.
  const doneRow = awc.locator('.awc-done-row', { hasText: set.b[2].name });
  await expect(doneRow.locator('.awc-class-tag')).toHaveText('Block C');
  await expect(awc.locator('.awc-done-row', { hasText: set.lateA.name }).locator('.awc-class-tag')).toHaveText(
    'Science 8',
  );
  // Grade in Scan Order: Block C's students came off the scan into 2.6; Science 8's went to another assessment.
  await expect(awc.locator('[data-awc="scanOrder"]')).toHaveText(['Grade Block C in Scan Order']);
  await shot(page, 'add-work-two-classes-done');
  expect(await page.evaluate(() => getActiveCourse())).toBe(set.cidA);

  // Block C's grader: the app switches to Block C, as Open Copy In does, and
  // the grader opens on Block C's first student off the scan.
  await awc.getByRole('button', { name: 'Grade Block C in Scan Order' }).click();
  await expect(awc).toHaveCount(0);
  const grader = page.locator('#grader-overlay');
  await expect(grader.locator('.grader-student')).toContainText(set.b[0].name.split(' ')[0], { timeout: 15000 });
  expect(await page.evaluate(() => getActiveCourse())).toBe(set.cidB);
  await page.keyboard.press('Escape');
  await expect(grader).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* Files first, then the switch: a file certain in Science 8 alone is matched
   again with both classes listed, and waits when Block C has the same name. */
test('turned on after the files: a name now in both classes waits, never stays on its student', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1') && !!window.AddWorkTwoClasses;
  });
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  const set = await page.evaluate(LAB => {
    const cidA = getActiveCourse();
    const sendWork = cid => {
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      work.assessments = work.assessments.map(x => Object.assign({}, x, { students_send: 'photos' }));
      saveDemoStudentWork(cid, work);
    };
    sendWork(cidA);
    const lab = getAssessments(cidA).find(x => x.id === LAB);
    const roster = getStudents(cidA);
    // A Science 8 student whose last name alone is certain in Science 8.
    const st = AddWorkClass.students(cidA, lab).find(
      x => !getStudentSubmission(cidA, x.id, LAB) && NameMatch.match(x.lastName, roster).kind === 'one',
    );
    const cidB = createCourse({ name: 'Block C', gradeLevel: '8' }).id;
    saveStudents(cidB, [{ id: crypto.randomUUID(), firstName: 'Hana', lastName: st.lastName }]);
    saveAssessments(cidB, [Object.assign({}, lab, { id: 'blab-' + Date.now().toString(36) })]);
    sendWork(cidB);
    PageAssignments.render();
    return { sid: st.id, last: st.lastName };
  }, LAB);

  const card = page.locator('#ac-' + LAB);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await card.locator('.assess-more-btn').click();
  await card.locator('.assess-add-class-btn').click();
  const awc = page.locator('#add-work-class-overlay');
  const row = awc.locator('.awc-row[data-awc-target="' + set.sid + '"]');

  // Dropped first, with Science 8 alone: certain, so it goes on the student.
  await awc.locator('.awt-input[data-awt-input="files"]').setInputFiles({
    name: set.last + '.jpg',
    mimeType: 'image/jpeg',
    buffer: fs.readFileSync(PHOTO),
  });
  await expect(row.locator('.awc-chip')).toHaveCount(1, { timeout: 15000 });

  // Then the switch: the name is in both classes now, so the file waits.
  const two = awc.getByRole('switch', { name: 'This Pile Has Two Classes' });
  await two.click();
  await expect(two).toHaveAttribute('aria-checked', 'true');
  await expect(awc.locator('.awc-chip')).toHaveCount(0);
  const item = awc.locator('.awt-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.awt-why')).toHaveText('Two students are named ' + set.last + '.');
  await expect(awc.locator('.awc-two-line')).toHaveText(
    'Both classes are listed. 1 file went back to Waiting for a Student.',
  );
  // Each Hana-or-not choice says its class; Add Work has nothing to add.
  await expect(item.locator('.awt-act').nth(0)).toContainText('· Science 8');
  await expect(item.locator('.awt-act').nth(1)).toContainText('· Block C');
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 0 Students');
  expect(errors).toEqual([]);
});
