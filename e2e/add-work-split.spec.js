/**
 * Add Work for the Class: Split the Scan (B2, docs/plans/add-work-for-class-plan.md).
 * Demo Mode, Science 8, Cell Microscope Lab (shared/seed-data.js), at 1366 x 900.
 *
 * A made-up 12-page scan, built in the browser from the sample pages in
 * assets/sample-work/ (made-up work), each page a little shorter than the
 * one before so the pages handed over can be told apart. Opened with
 * AddWorkSplit.open, as the class page will open it: read, cut into six
 * pieces of 2, two named with the keyboard alone, and Match the Named
 * Pieces hands those two to onPieces with the right students, the right
 * pages in order, and no file name.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('a 12-page scan is split into six pieces of 2, two are named by keyboard and matched', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1') && !!window.AddWorkSplit;
  });

  // Two students, and the scan: twelve made-up pages as one PDF.
  const two = await page.evaluate(async LAB => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.id === LAB);
    const list = AddWorkClass.students(cid, a);
    const pick = [list[3], list[7]].map(st => ({
      id: st.id,
      name: (st.preferred || st.firstName) + ' ' + st.lastName,
    }));
    const files = ['cece-1', 'fatima-1', 'jas-1', 'jordan-1', 'liam-1', 'mateo-1'];
    const jpegs = [];
    for (let n = 1; n <= 12; n++) {
      const img = await createImageBitmap(
        await (await fetch('/assets/sample-work/cell-lab-' + files[(n - 1) % 6] + '.jpg')).blob(),
      );
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1200 - n * 12;
      c.getContext('2d').drawImage(img, 0, 0, 900, 1200);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
      jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
    }
    // A PDF of JPEG pages, letter width.
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
    window.__aspects = [];
    jpegs.forEach((j, i) => {
      const [pid, cs, iid] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
      const H = Math.round((612 * j.h) / j.w);
      window.__aspects.push(612 / H);
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
    return pick;
  }, LAB);

  const opened = await page.evaluate(LAB => {
    window.__handed = null;
    window.__closed = 0;
    return AddWorkSplit.open(getActiveCourse(), LAB, window.__scan, {
      onPieces: pieces => {
        window.__handed = pieces.map(p => ({
          sid: p.sid,
          from: p.from,
          names: p.pages.map(pg => pg.name),
          aspects: p.pages.map(pg => pg.width / pg.height),
          bytes: p.pages.map(pg => (pg.blob ? pg.blob.size : 0)),
          text: JSON.stringify(p),
        }));
      },
      onClose: () => window.__closed++,
    });
  }, LAB);
  expect(opened).toBe(true);
  const aws = page.locator('#add-work-split-overlay');
  await expect(aws.locator('.aws-title')).toHaveText('Split the Scan');

  // Read: twelve pages, none blank; the class has more students than pages, so 1 a piece.
  await expect(aws.locator('.aws-card')).toHaveCount(12, { timeout: 20000 });
  await expect(aws.locator('.aws-per')).toHaveText('1');
  await expect(aws.locator('.aws-name').first()).toBeFocused();
  await aws.getByRole('button', { name: 'One more page per student' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(6);
  await expect(aws.locator('.aws-line')).toHaveText('12 pages make 6 pieces of 2.');
  await expect(aws.locator('.aws-count')).toHaveText(Array(6).fill('2 pages'));
  await expect(aws.locator('.aws-range').nth(1)).toHaveText('Piece 2 · Pages 3–4');
  await expect
    .poll(() =>
      aws
        .locator('.aws-crop-img')
        .first()
        .evaluate(el => el.complete && el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(aws).not.toContainText('Block C');

  // Name two with the keyboard: a few letters and Return, then the next piece is ready.
  const first = aws.locator('#aws-name-0');
  await first.focus();
  await page.keyboard.type(two[0].name.slice(0, -1));
  await expect(aws.locator('#aws-list-0 .aws-option').first()).toHaveText(two[0].name);
  await page.keyboard.press('Enter');
  await expect(first).toHaveValue(two[0].name);
  await expect(aws.locator('#aws-name-1')).toBeFocused();
  await page.keyboard.type(two[1].name.slice(0, -1));
  await page.keyboard.press('Enter');
  await expect(aws.locator('#aws-name-1')).toHaveValue(two[1].name);
  await expect(aws.locator('#aws-name-2')).toBeFocused();
  await expect(aws.locator('.aws-tally')).toContainText('2 named');
  await shot(page, 'add-work-split-named');

  // Match: the two named pieces go, the four others stay.
  await aws.getByRole('button', { name: 'Match the Named Pieces' }).click();
  await expect(aws.locator('.aws-card')).toHaveCount(4);
  const handed = await page.evaluate(() => window.__handed);
  const aspects = await page.evaluate(() => window.__aspects);
  expect(handed.map(p => p.sid)).toEqual([two[0].id, two[1].id]);
  expect(handed.map(p => p.from)).toEqual(['Scan, pages 1–2', 'Scan, pages 3–4']);
  expect(handed.map(p => p.names)).toEqual([
    ['page-1.jpg', 'page-2.jpg'],
    ['page-1.jpg', 'page-2.jpg'],
  ]);
  handed.forEach((p, k) => p.aspects.forEach((a, i) => expect(Math.abs(a - aspects[k * 2 + i])).toBeLessThan(0.002)));
  handed.forEach(p => p.bytes.forEach(b => expect(b).toBeGreaterThan(0)));
  handed.forEach(p => expect(p.text).not.toContain('Block C'));
  await expect(aws.locator('.aws-range').first()).toHaveText('Piece 1 · Pages 5–6');

  // Leaving asks first, while pieces wait.
  await page.keyboard.press('Escape');
  await expect(page.locator('.confirm-title')).toHaveText('Leave without using this scan?');
  await expect(page.locator('.confirm-message')).toHaveText('4 pieces are waiting.');
  await page.locator('#confirm-ok-btn').click();
  await expect(aws).toHaveCount(0);
  expect(await page.evaluate(() => window.__closed)).toBe(1);
  expect(errors).toEqual([]);
});
