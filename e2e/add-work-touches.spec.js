/**
 * Add Work for the Class: small touches (B5, docs/plans/add-work-for-class-plan.md).
 * Demo Mode, Science 8, Cell Microscope Lab (shared/seed-data.js), at 1366 x 900.
 *
 * A made-up 12-page scan (the sample pages in assets/sample-work/, each a
 * little shorter than the one before, so a page can be told by its shape),
 * split from Add Work for the Class's Split a Scan…:
 * - Set Up Like Last Time: 2 pages per student from the last scan, said
 *   in one line with the assessment it came from (the scan shows no even
 *   split of its own); an old Class List Order is not carried; the choices
 *   kept after Match hold no order and no student data.
 * - Turn Every Page turns the whole scan, and pressed again turns it back.
 * - Space on a piece shows its pages full size.
 * - A page moved: page 5 onto the first piece with its menu, page 6 onto
 *   the second piece by dragging; the third piece, left with no pages,
 *   goes. Each student's pages are the right ones, in order, and the Work
 *   Wall shows 3 pages for each.
 * - Grade in Scan Order: the grader opens on the first student off the
 *   scan, who is not the first on the class list.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('Set Up Like Last Time, a moved page under the right student, and Grade in Scan Order', async ({ page }) => {
  // Two scans are read and their pages turned: about 22 s on CI's two cores.
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1') && !!window.AddWorkSplitSetup;
  });

  // Send Work on; two students with nothing in, the later one on the list first
  // off the scan; the last scan's choices, from another assessment.
  const set = await page.evaluate(async LAB => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const a = getAssessments(cid).find(x => x.id === LAB);
    const list = AddWorkClass.students(cid, a);
    const free = list.filter(st => !getStudentSubmission(cid, st.id, LAB));
    const pick = [free[5], free[2]].map(st => ({
      id: st.id,
      name: (st.preferred || st.firstName) + ' ' + st.lastName,
      first: st.preferred || st.firstName,
    }));
    const other = getAssessments(cid).find(x => x.id !== LAB && x.title);
    localStorage.setItem(
      'fv-add-work-split-setup',
      // An order kept by an earlier version of the key: never carried over.
      JSON.stringify({ cid, aid: other.id, per: 2, order: 'list', leaveOut: true }),
    );
    return { pick, other: other.title };
  }, LAB);
  const [mia, owen] = set.pick;

  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  // On this page: what each write carries, and the scan.
  set.shapes = await page.evaluate(async () => {
    // What each write carried: the shape of each page, in order.
    const real = window.addStudentWorkPages;
    window.__sent = {};
    window.addStudentWorkPages = function (c, sid, aid, pages, opts) {
      window.__sent[sid] = pages.map(pg => Math.round((pg.width / pg.height) * 1000));
      return real.apply(this, arguments);
    };
    // The scan: twelve made-up pages as one PDF.
    const files = ['cece-1', 'fatima-1', 'jas-1', 'jordan-1', 'liam-1', 'mateo-1'];
    const jpegs = [];
    for (let n = 1; n <= 12; n++) {
      const img = await createImageBitmap(
        await (await fetch('/assets/sample-work/cell-lab-' + files[(n - 1) % 6] + '.jpg')).blob(),
      );
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1200 - n * 24;
      c.getContext('2d').drawImage(img, 0, 0, 900, 1200);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
      jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
    }
    const enc = new TextEncoder();
    const parts = [];
    const offs = [];
    let len = 0;
    const push = x => {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(b);
      len += b.length;
    };
    const obj = (id, body) => {
      offs[id] = len;
      push(id + ' 0 obj\n' + body + '\nendobj\n');
    };
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + jpegs.map((_, i) => 3 + i * 3 + ' 0 R').join(' ') + '] /Count 12 >>');
    const shapes = [];
    jpegs.forEach((j, i) => {
      const [pid, cs, iid] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
      const H = Math.round((612 * j.h) / j.w);
      shapes.push(Math.round((612 / H) * 1000));
      const draw = 'q 612 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      obj(
        pid,
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ' +
          H +
          '] /Resources << /XObject << /Im0 ' +
          iid +
          ' 0 R >> >> /Contents ' +
          cs +
          ' 0 R >>',
      );
      obj(cs, '<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream');
      offs[iid] = len;
      push(
        iid +
          ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' +
          j.w +
          ' /Height ' +
          j.h +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
          j.bytes.length +
          ' >>\nstream\n',
      );
      push(j.bytes);
      push('\nendstream\nendobj\n');
    });
    const xref = len;
    let x = 'xref\n0 39\n0000000000 65535 f \n';
    for (let id = 1; id < 39; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size 39 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    window.__scan = new File(parts, 'Block C 2026-11-17 0832.pdf', { type: 'application/pdf' });
    return shapes;
  });
  const card = page.locator('#ac-' + LAB);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const more = card.locator('.assess-more-btn');
  await more.click();
  await card.locator('.assess-add-class-btn').click();
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc.locator('.awc-title')).toHaveText('Add Work for the Class');

  // Split a Scan…: the scan chosen.
  await page.evaluate(() => {
    const input = document.querySelector('.awt-input[data-awt-input="scan"]');
    const dt = new DataTransfer();
    dt.items.add(window.__scan);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const aws = page.locator('#add-work-split-overlay');
  await expect(aws.locator('.aws-card')).toHaveCount(6, { timeout: 20000 });

  // Set Up Like Last Time: said in one line, every choice still on screen.
  const setup = aws.locator('.aws-setup');
  await expect(setup.locator('.aws-h')).toHaveText('Set Up Like Last Time');
  await expect(setup.locator('.aws-hint')).toHaveText(
    'From ' + set.other + ': 2 pages per student. Change anything below.',
  );
  await expect(aws.locator('.aws-per')).toHaveText('2');
  // The pile's order is never carried: names are typed until the teacher says otherwise.
  await expect(aws.getByRole('button', { name: 'No Order: I’ll Type Names' })).toHaveAttribute('aria-pressed', 'true');
  await expect(aws.locator('.aws-name').first()).toHaveValue('');
  await expect(setup.getByRole('button', { name: 'Start Fresh' })).toBeVisible();

  // Turn Every Page, and back again: a toggle.
  const turnAll = aws.getByRole('button', { name: 'Turn Every Page' });
  await turnAll.click();
  await expect(turnAll).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await expect(aws.locator('.aws-turn-line')).toHaveText('Every page is turned. Press it again to turn them back.');
  await turnAll.click();
  await expect(turnAll).toHaveAttribute('aria-pressed', 'false', { timeout: 20000 });

  // Name the first two pieces with the keyboard.
  await aws.locator('#aws-name-0').focus();
  await page.keyboard.type(mia.name.slice(0, -1));
  await page.keyboard.press('Enter');
  await expect(aws.locator('#aws-name-1')).toBeFocused();
  await page.keyboard.type(owen.name.slice(0, -1));
  await page.keyboard.press('Enter');
  await expect(aws.locator('#aws-name-0')).toHaveValue(mia.name);
  await expect(aws.locator('#aws-name-1')).toHaveValue(owen.name);

  // Space on a named piece: its pages full size; Space again closes.
  await aws.locator('#aws-name-0').focus();
  await page.keyboard.press(' ');
  const view = page.locator('.awv-overlay');
  await expect(view.locator('.awv-where')).toHaveText('Page 1 · 1 of 2');
  await page.keyboard.press('ArrowRight');
  await expect(view.locator('.awv-where')).toHaveText('Page 2 · 2 of 2');
  await page.keyboard.press(' ');
  await expect(view).toHaveCount(0);
  await expect(aws.locator('#aws-name-0')).toBeFocused();
  await expect(aws.locator('#aws-name-0')).toHaveValue(mia.name);

  // Page 5 (piece 3's first) onto Mia's piece, from its menu.
  await aws.locator('.aws-tile[data-no="5"] .aws-pmenu').click();
  await shot(page, 'add-work-touches-menu');
  await aws.getByRole('menuitem', { name: 'Make It ' + mia.first + '’s Page 3' }).click();
  await expect(aws.locator('.aws-note')).toHaveText('Page 5 is now ' + mia.first + '’s Page 3.');
  await expect(aws.locator('.aws-range').nth(0)).toHaveText('Piece 1 · Pages 1–2, 5');
  await expect(aws.locator('.aws-range').nth(2)).toHaveText('Piece 3 · Page 6');

  // Page 6, now piece 3's only page, dragged onto Owen's piece: piece 3 goes.
  await aws.locator('.aws-tile[data-no="6"]').dragTo(aws.locator('.aws-card[data-at="1"] .aws-crop'));
  await expect(aws.locator('.aws-note')).toHaveText(
    'Page 6 is now ' + owen.first + '’s Page 3. Piece 3 had no pages left and went.',
  );
  await expect(aws.locator('.aws-card')).toHaveCount(5);
  await expect(aws.locator('.aws-range').nth(1)).toHaveText('Piece 2 · Pages 3–4, 6');
  await expect(aws.locator('#aws-name-0')).toHaveValue(mia.name);
  await expect(aws.locator('#aws-name-1')).toHaveValue(owen.name);
  await shot(page, 'add-work-touches-moved');

  await aws.getByRole('button', { name: 'Match the Named Pieces' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(3);
  // What was kept for next time: the choices and the assessment, no student.
  const kept = await page.evaluate(() => localStorage.getItem('fv-add-work-split-setup'));
  expect(JSON.parse(kept)).toEqual({ cid: expect.any(String), aid: LAB, per: 2, leaveOut: true });
  for (const st of set.pick) {
    expect(kept).not.toContain(st.id);
    expect(kept).not.toContain(st.first);
  }
  expect(kept).not.toContain('Block C');
  await aws.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#confirm-ok-btn').click();
  await expect(aws).toHaveCount(0);

  // Add Work: each student gets the right pages, in order.
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 2 Students');
  await awc.locator('.awc-primary').click();
  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 2 Students', { timeout: 15000 });
  const sent = await page.evaluate(() => window.__sent);
  // Each page told by its shape: the scan's page whose shape is nearest.
  const which = shapes =>
    shapes.map(
      v => 1 + set.shapes.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(set.shapes[best] - v) ? i : best), 0),
    );
  expect(which(sent[mia.id])).toEqual([1, 2, 5]);
  expect(which(sent[owen.id])).toEqual([3, 4, 6]);
  await shot(page, 'add-work-touches-done');

  // Grade in Scan Order: the grader opens on Mia, first off the scan.
  const order = await page.evaluate(() => AddWorkClass.scanOrder());
  expect(order).toEqual([mia.id, owen.id]);
  await awc.getByRole('button', { name: 'Grade in Scan Order' }).click();
  await expect(awc).toHaveCount(0);
  const grader = page.locator('#grader-overlay');
  await expect(grader.locator('.grader-student')).toContainText(mia.first);
  await page.keyboard.press('Escape');
  await expect(grader).toHaveCount(0);

  // The Work Wall shows each with three pages.
  await more.click();
  await card.locator('.assess-work-wall-btn').click();
  const wall = page.locator('#work-wall-overlay');
  for (const st of set.pick)
    await expect(wall.locator('.ww-card[data-sid="' + st.id + '"] .ww-count')).toHaveText('3 pages');
  expect(errors).toEqual([]);
});
