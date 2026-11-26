/**
 * Add Work for the Class: stickers name the pieces of a scan (B4 phase 2,
 * docs/plans/add-work-for-class-plan.md). Demo Mode, Science 8, Cell
 * Microscope Lab, at 1366 x 900.
 *
 * The class's sticker codes are made (issueScanLabels), and one student's
 * sheet is replaced, so their old code is retired. A made-up 12-page scan
 * is drawn in the browser, each page a little shorter than the one before
 * so a page can be told by its shape, with stickers (vendor/qrcode.js, as
 * printed) on some pages. The papers are two pages each.
 * First the scan is cut three pages per student (a wrong cut): piece 1
 * (pages 1–3) holds B's sticker on its page 3, so it is not named and says
 * so. Then two pages per student:
 *   page 1  A's sticker            → piece 1 is A's, By Sticker
 *   page 2  A's sticker again      → A's own: fine, no warning
 *   page 3  B's sticker            → piece 2 is B's
 *   page 5  none                   → piece 3 is typed: D
 *   page 7  C's sticker, upside down → piece 4 is C's; page 7 "Upside down?"
 *   page 9  E's old, retired code  → piece 5: "replaced", no name
 *   page 11 none                   → piece 6: no name
 * Split, the rest typed, Match, Add Work: every page under the right student.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('stickers name their pieces, the rest are typed, and every page goes to the right student @flaky', async ({
  page,
}) => {
  // The scan is read, then six first pages are read for stickers: well under this on CI's two cores.
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1') && !!window.AddWorkSplitStickers;
  });

  const set = await page.evaluate(async LAB => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    localStorage.removeItem('fv-add-work-split-setup');
    const a = getAssessments(cid).find(x => x.id === LAB);
    const free = AddWorkClass.students(cid, a).filter(st => !getStudentSubmission(cid, st.id, LAB));
    const pick = [free[1], free[4], free[6], free[2], free[8]].map(st => ({
      id: st.id,
      name: (st.preferred || st.firstName) + ' ' + st.lastName,
    }));
    const issued = (await issueScanLabels(cid)).data.labels;
    const code = {};
    issued.forEach(l => (code[l.enrollment_id] = l.code));
    // E lost a sheet: E's old code is retired.
    const retired = code[pick[4].id];
    await reissueScanLabel(cid, pick[4].id);
    return { pick, codes: pick.map(p => code[p.id]), retired };
  }, LAB);
  const [A, B, C, D, E] = set.pick;

  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  set.shapes = await page.evaluate(async set => {
    const real = window.addStudentWorkPages;
    window.__sent = {};
    window.addStudentWorkPages = function (c, sid, aid, pages, opts) {
      window.__sent[sid] = pages.map(pg => Math.round((pg.width / pg.height) * 1000));
      return real.apply(this, arguments);
    };
    await new Promise(r => Router.withScripts('qrcode', r));
    // Which sticker on which page: [code, upside down].
    const on = { 1: [set.codes[0]], 2: [set.codes[0]], 3: [set.codes[1]], 7: [set.codes[2], true], 9: [set.retired] };
    const jpegs = [];
    for (let n = 1; n <= 12; n++) {
      // A letter page at 150 dots per inch, a little shorter each time.
      const c = document.createElement('canvas');
      c.width = 1275;
      c.height = 1650 - n * 18;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#333';
      for (let line = 0; line < 20; line++) x.fillRect(140, 320 + line * 55, 900 - ((line * 37 + n * 11) % 300), 7);
      if (on[n]) {
        // A sticker (1.75 x 0.5 inch) at the top right, its QR 0.42 inch: 3 px squares.
        const qr = qrcode(1, 'Q');
        qr.addData('FVS' + on[n][0], 'Alphanumeric');
        qr.make();
        const size = qr.getModuleCount();
        x.save();
        x.translate(900, 60);
        if (on[n][1]) {
          x.translate(262, 75);
          x.rotate(Math.PI);
        }
        x.strokeStyle = '#ddd';
        x.strokeRect(0, 0, 262, 75);
        x.fillStyle = '#000';
        for (let r = 0; r < size; r++)
          for (let k = 0; k < size; k++) if (qr.isDark(r, k)) x.fillRect(6 + k * 3, 6 + r * 3, 3, 3);
        x.font = 'bold 22px sans-serif';
        x.fillText('Student', 80, 35);
        x.restore();
      }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
    }
    const enc = new TextEncoder();
    const parts = [];
    const offs = [];
    let len = 0;
    const push = v => {
      const b = typeof v === 'string' ? enc.encode(v) : v;
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
    let t = 'xref\n0 39\n0000000000 65535 f \n';
    for (let id = 1; id < 39; id++) t += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    push(t + 'trailer\n<< /Size 39 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    window.__scan = new File(parts, 'Block C 2026-11-17 0832.pdf', { type: 'application/pdf' });
    return shapes;
  }, set);

  const card = page.locator('#ac-' + LAB);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await card.locator('.assess-more-btn').click();
  await card.locator('.assess-add-class-btn').click();
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc.locator('.awc-title')).toHaveText('Add Work for the Class');
  await page.evaluate(() => {
    const input = document.querySelector('.awt-input[data-awt-input="scan"]');
    const dt = new DataTransfer();
    dt.items.add(window.__scan);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const aws = page.locator('#add-work-split-overlay');
  await expect(aws.locator('.aws-card').first()).toBeVisible({ timeout: 30000 });
  // A wrong cut first: three pages per student, four pieces. Piece 1 holds B's sticker on its page 3.
  while ((await aws.locator('.aws-per').textContent()) !== '3')
    await aws.getByRole('button', { name: 'One more page per student' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(4);
  await expect(aws.locator('.aws-card[data-at="0"] .aws-stk-note')).toHaveText(
    /^Page 3 of this piece has .+’s sticker\. Check where this piece ends\.$/,
    { timeout: 60000 },
  );
  await expect(aws.locator('#aws-name-0')).toHaveValue('');
  // Piece 3 (pages 7–9): page 9 is E's paper (E's old, retired sticker), so C's sticker does not name it.
  await expect(aws.locator('.aws-card[data-at="2"] .aws-stk-note')).toHaveText(
    /^Page 3 of this piece has .+’s sticker\. Check where this piece ends\.$/,
    { timeout: 60000 },
  );
  await expect(aws.locator('#aws-name-2')).toHaveValue('');
  await expect(aws.locator('.aws-stk-line')).toHaveText(/ named by sticker, /, { timeout: 60000 });
  await shot(page, 'add-work-stickers-wrong-cut');

  // Cut right: two pages per student, six pieces.
  await aws.getByRole('button', { name: 'One fewer page per student' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(6);

  // As a teacher sees it: each stickered piece's name comes once all its pages are read, then both counts.
  await expect(aws.locator('#aws-name-0')).toHaveValue(A.name, { timeout: 60000 });
  await expect(aws.locator('#aws-name-3')).toHaveValue(C.name, { timeout: 60000 });
  await expect(aws.locator('.aws-stk-line')).toHaveText('3 pieces named by sticker, 3 left to type.', {
    timeout: 60000,
  });
  await expect(aws.locator('.aws-stk-pending')).toHaveCount(0);
  await expect(aws.locator('#aws-name-1')).toHaveValue(B.name);
  await expect(aws.locator('#aws-name-2')).toHaveValue('');
  await expect(aws.locator('#aws-name-3')).toHaveValue(C.name);
  await expect(aws.locator('#aws-name-4')).toHaveValue('');
  await expect(aws.locator('#aws-name-5')).toHaveValue('');
  await expect(aws.locator('.aws-by-sticker')).toHaveCount(3);
  await expect(aws.locator('.aws-card[data-at="4"] .aws-stk-note')).toHaveText(
    'This sticker is from a sheet that was replaced.',
  );
  // C's sticker was upside down: its page is pointed out, never turned.
  await expect(aws.locator('.aws-tile[data-no="7"] .aws-upside')).toHaveText('Upside down?');
  await expect(aws.locator('.aws-upside')).toHaveCount(1);

  await shot(page, 'add-work-stickers-read');

  // D is typed on piece 3.
  await aws.locator('#aws-name-2').focus();
  await page.keyboard.type(D.name.slice(0, -1));
  await page.keyboard.press('Enter');
  await expect(aws.locator('#aws-name-2')).toHaveValue(D.name);
  await expect(aws.locator('.aws-stk-line')).toHaveText('3 pieces named by sticker, 2 left to type.');

  await aws.getByRole('button', { name: 'Match the Named Pieces' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(2);
  await aws.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#confirm-ok-btn').click();
  await expect(aws).toHaveCount(0);

  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 4 Students');
  await awc.locator('.awc-primary').click();
  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 4 Students', { timeout: 15000 });
  const sent = await page.evaluate(() => window.__sent);
  const which = shapes =>
    shapes.map(
      v => 1 + set.shapes.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(set.shapes[best] - v) ? i : best), 0),
    );
  expect(which(sent[A.id])).toEqual([1, 2]);
  expect(which(sent[B.id])).toEqual([3, 4]);
  expect(which(sent[D.id])).toEqual([5, 6]);
  expect(which(sent[C.id])).toEqual([7, 8]);
  expect(sent[E.id]).toBeUndefined();
  expect(Object.keys(sent)).toHaveLength(4);
  expect(errors).toEqual([]);
});
