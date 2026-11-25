/**
 * Open as PDF (migration 2026112408, the route `handout-original`; s/handouts.js).
 *
 * - The route is asked once per handout when the Save or Print sheet opens, and its answer kept:
 *   a handout with no original shows two rows (Save to Phone, Print), one with an original shows
 *   Open as PDF first. Nothing is asked before the sheet opens, and nothing is asked twice.
 * - Each row's source: the original when there is one (Print opens it in the phone's viewer, which has
 *   Print; Save to Phone gives it as it is), else the pages.
 * - Open as PDF fetches the original from its signed link, as a PDF blob, and hands it to the viewer.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toLocaleDateString('en-CA');
const RES = '00000099-0000-4000-8000-000000000000';

async function openHandout(original) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  fn.state.dirty = reply => {
    reply.assessments.forEach(a => {
      a.resources =
        a.id === WORK.quick ? [{ id: RES, kind: 'pdf', title: 'Study Guide', url: null, page_count: 2 }] : [];
    });
    return reply;
  };
  const page = openStudentPage({ objectUrls: true });
  const asked = [];
  page.server = body => {
    if (body.route === 'handout-links') {
      return { ok: true, pages: [1, 2].map(n => ({ page: n, url: 'https://x.supabase.co/sign/' + n })) };
    }
    if (body.route === 'handout-original') {
      asked.push(body);
      return original;
    }
    return fn.handle(body);
  };
  page.storage = async () => ({ status: 200, blob: new Blob(['x']) });
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  await page.settle();
  page.onScreen(el => el.getAttribute('data-car') === WORK.quick);
  await page.settle();
  await page.click('.sp-car[data-car="' + WORK.quick + '"] .sp-car-slide[data-page="0"]');
  await page.settle();
  return { page, asked };
}
const rows = page => [...page.root().querySelectorAll('.sp-handout-sheet .sp-out-row')].map(r => r.textContent.trim());

describe('the route is asked when the sheet opens, once', () => {
  it('an older handout: two rows, and the answer is kept', async () => {
    const { page, asked } = await openHandout({ ok: true, original: false });
    expect(asked).toEqual([]);
    await page.click('[data-act="handout-out-open"]');
    await page.settle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ route: 'handout-original', resource_id: RES });
    expect(rows(page)).toEqual(['Save to Phone', 'Print']);
    // Closed and opened again: not asked again.
    await page.click('.sp-handout-sheet .sp-btn-quiet');
    await page.click('[data-act="handout-out-open"]');
    await page.settle();
    expect(asked).toHaveLength(1);
    expect(rows(page)).toEqual(['Save to Phone', 'Print']);
  });

  it('a handout with an original: Open as PDF first, the file fetched ahead from its link', async () => {
    const { page, asked } = await openHandout({
      ok: true,
      original: true,
      bytes: 4,
      title: 'Study Guide',
      url: 'https://x.supabase.co/sign/original',
    });
    await page.click('[data-act="handout-out-open"]');
    await page.settle();
    expect(asked).toHaveLength(1);
    expect(rows(page)).toEqual(['Open as PDF', 'Save to Phone', 'Print']);
    expect(page.storageCalls.map(c => c.url)).toContain('https://x.supabase.co/sign/original');
  });

  it('a route that does not answer leaves the two rows, and is asked again the next time', async () => {
    const { page, asked } = await openHandout({ ok: false, error: 'network' });
    await page.click('[data-act="handout-out-open"]');
    await page.settle();
    expect(rows(page)).toEqual(['Save to Phone', 'Print']);
    await page.click('.sp-handout-sheet .sp-btn-quiet');
    await page.click('[data-act="handout-out-open"]');
    await page.settle();
    expect(asked).toHaveLength(2);
  });
});

describe('each row’s source', () => {
  it('uses the original when there is one, else the pages', async () => {
    const { page } = await openHandout({ ok: true, original: false });
    const of = page.T.sourceOf;
    expect(of(true, 'open')).toBe('original-open');
    expect(of(true, 'print')).toBe('original-open');
    expect(of(true, 'save')).toBe('original-save');
    expect(of(false, 'print')).toBe('pages-print');
    expect(of(false, 'save')).toBe('pages-save');
  });
});
