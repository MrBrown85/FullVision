/**
 * A handout's pages on a card still to do, to swipe through (s/page-carousel.js;
 * Colin, 2026-11-17: "it should look like Instagram"), and where its pages
 * come from on a real card (s/handouts.js, the `handout-links` route).
 *
 * - Which cards show it: due or Missing, with a handout. Needs Revision,
 *   sent, returned and excused cards keep the handout's row.
 * - The pure parts: the pages in order across handouts, which page a
 *   scroll is on, "1 / 2", what to fetch, a page's shape.
 * - The markup: every name escaped; one page has no dots, count or arrows.
 * - A real card: nothing is asked until the card is near the screen; then
 *   one `handout-links` call for the handout and only the pages wanted; a
 *   page wanted after its links have run out asks for new ones; a link that
 *   fails is asked for again once, quietly.
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const C = globalThis.StudentPageCarousel;
const TODAY = new Date().toLocaleDateString('en-CA');

const handout = (id, title, pages) => ({ id, kind: 'handout', title, pages });
const link = { id: 'l1', kind: 'link', title: 'Density', url: 'https://example.com/', host: 'example.com' };
const piece = (kind, resources, more) =>
  Object.assign({ id: 'p1', kind, title: 'Density Lab', resources: resources || [] }, more);

describe('which cards show the pages', () => {
  it('a card due or Missing with a handout', () => {
    expect(C.shows(piece('due', [handout('h1', 'Lab Sheet', 2)]))).toBe(true);
    expect(C.shows(piece('missing', [link, handout('h1', 'Lab Sheet', 1)]))).toBe(true);
  });

  it('not one with only links, and not one handed in, returned, excused or sent back for revision', () => {
    expect(C.shows(piece('due', [link]))).toBe(false);
    ['revise', 'sent', 'back', 'excused'].forEach(kind => {
      expect(C.shows(piece(kind, [handout('h1', 'Lab Sheet', 2)]))).toBe(false);
      expect(C.html(piece(kind, [handout('h1', 'Lab Sheet', 2)]))).toBe('');
    });
  });

  it('a handout with no pages, or more than 20, is left out', () => {
    expect(C.shows(piece('due', [handout('h1', 'Empty', 0)]))).toBe(false);
    expect(C.shows(piece('due', [handout('h1', 'Too Long', 21)]))).toBe(false);
  });
});

describe('the pure parts', () => {
  it('pages follow one another in the handouts’ order, each knowing its handout and page', () => {
    const p = piece('due', [handout('h1', 'Planner', 2), link, handout('h2', 'Safety', 1)]);
    expect(C.slidesOf(p).map(s => [s.rid, s.title, s.page, s.of, s.at])).toEqual([
      ['h1', 'Planner', 0, 2, 0],
      ['h1', 'Planner', 1, 2, 1],
      ['h2', 'Safety', 0, 1, 2],
    ]);
  });

  it('which page a scroll is on, kept to the pages there are', () => {
    expect(C.indexAt(0, 343, 3)).toBe(0);
    expect(C.indexAt(200, 343, 3)).toBe(1);
    expect(C.indexAt(343 * 2, 343, 3)).toBe(2);
    expect(C.indexAt(343 * 9, 343, 3)).toBe(2);
    expect(C.indexAt(100, 0, 3)).toBe(0);
    expect(C.clamp(-1, 3)).toBe(0);
    expect(C.clamp(1.7, 3)).toBe(1);
    expect(C.clamp('x', 3)).toBe(0);
  });

  it('"1 / 2" on the picture', () => {
    expect(C.countText(0, 2)).toBe('1 / 2');
    expect(C.countText(5, 2)).toBe('2 / 2');
  });

  it('the page showing is fetched; the next one too once the student is looking', () => {
    expect(C.wanted(0, 3, false)).toEqual([0]);
    expect(C.wanted(0, 3, true)).toEqual([0, 1]);
    expect(C.wanted(2, 3, true)).toEqual([2]);
    expect(C.wanted(0, 0, true)).toEqual([]);
  });

  it('a page’s shape, kept between very wide and very tall', () => {
    expect(C.ratioOf(1275, 1650)).toBe('1275 / 1650');
    expect(C.ratioOf(100, 1000)).toBe('1 / 2');
    expect(C.ratioOf(3000, 100)).toBe('2 / 1');
    expect(C.ratioOf(0, 100)).toBe('');
  });
});

describe('the markup', () => {
  const draw = p => parseHTML('<main>' + C.html(p) + '</main>').document;

  it('each page a button that opens it full size, with the count, dots and arrows', () => {
    const doc = draw(piece('missing', [handout('h1', 'Lab Sheet', 2)]));
    const slides = [...doc.querySelectorAll('.sp-car-slide')];
    expect(
      slides.map(b => [b.getAttribute('data-act'), b.getAttribute('data-resource'), b.getAttribute('data-page')]),
    ).toEqual([
      ['handout', 'h1', '0'],
      ['handout', 'h1', '1'],
    ]);
    expect(slides[0].getAttribute('aria-label')).toBe('Lab Sheet, page 1 of 2. Open full size');
    // No picture in the markup: attach() puts each in when it is here, so nothing is fetched by drawing.
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelector('.sp-car-count').textContent).toBe('1 / 2');
    expect(doc.querySelectorAll('.sp-car-dot')).toHaveLength(2);
    expect(doc.querySelector('.sp-car-dot-on')).toBe(doc.querySelector('.sp-car-dot'));
    expect(doc.querySelector('.sp-car-prev').getAttribute('aria-label')).toBe('Previous Page');
    expect(doc.querySelector('.sp-car-prev').hasAttribute('hidden')).toBe(true);
    expect(doc.querySelector('.sp-car-next').getAttribute('aria-label')).toBe('Next Page');
    expect(doc.querySelector('.sp-car-track').getAttribute('tabindex')).toBe('0');
    expect(doc.querySelector('.sp-car-track').getAttribute('aria-label')).toBe('Lab Sheet · 2 pages');
    expect(doc.querySelector('.sp-car-caption').textContent).toBe('Lab Sheet');
  });

  it('one page: no count, dots or arrows', () => {
    const doc = draw(piece('due', [handout('h1', 'Lab Sheet', 1)]));
    expect(doc.querySelectorAll('.sp-car-slide')).toHaveLength(1);
    expect(doc.querySelector('.sp-car-count')).toBeNull();
    expect(doc.querySelector('.sp-car-dots')).toBeNull();
    expect(doc.querySelector('.sp-car-arrow')).toBeNull();
  });

  it('every name is escaped', () => {
    const html = C.html(
      piece('due', [handout('h"1', '<b>Lab</b> & "Sheet"', 1)], { id: 'p"<1', title: '<script>x</script>' }),
    );
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Lab&lt;/b&gt; &amp; &quot;Sheet&quot;');
    expect(html).toContain('data-resource="h&quot;1"');
  });
});

/* The count and dots follow the strip on every scroll, at once: nothing
   waits for an animation frame, the end of the scroll or a snap landing
   exactly on a page (a CI browser, a slow phone and Reduce Motion all left
   the count on "1 / 2" while the strip showed page 2, Nov 17). */
describe('the count follows the strip', () => {
  async function demoPage() {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    // The sample class has bulletins, so the page opens on Bulletins (B1g); these tests start on Assignments.
    await page.click('.sp-tabs-bottom [data-tab="assignments"]');
    await page.settle();
    return page;
  }
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  // The strip scrolled to `left`, one page `width` wide, as the browser reports it; then one scroll event.
  function scrollTo(track, left, width, name) {
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(track, 'scrollLeft', { configurable: true, writable: true, value: left });
    track.dispatchEvent(new window.Event(name || 'scroll'));
  }

  it('on the scroll event itself, part way, at the end, and back', async () => {
    const page = await demoPage();
    const car = page.root().querySelector('.sp-car[data-car="demo-quick"]');
    const track = car.querySelector('.sp-car-track');
    const count = () => car.querySelector('.sp-car-count').textContent;
    const dot = () => [...car.querySelectorAll('.sp-car-dot')].findIndex(d => d.classList.contains('sp-car-dot-on'));
    expect(count()).toBe('1 / 2');
    // More than half of page 2 in view, the snap not landed yet: page 2 already.
    scrollTo(track, 200, 343);
    expect([count(), dot()]).toEqual(['2 / 2', 1]);
    // Landed a fraction off a whole page (a phone's pixels): still page 2.
    scrollTo(track, 342.6, 343);
    expect([count(), dot()]).toEqual(['2 / 2', 1]);
    // Back, by a scroll that only says it ended.
    scrollTo(track, 0, 343, 'scrollend');
    expect([count(), dot()]).toEqual(['1 / 2', 0]);
  });
});

/* ── A real card: the pages come from `handout-links`, only as they are wanted ── */

const RES = '00000099-0000-4000-8000-000000000000';

async function realCard(opts = {}) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  // The Quick Check is Missing: it carries a three-page handout.
  fn.state.dirty = reply => {
    reply.assessments.forEach(a => {
      a.resources =
        a.id === WORK.quick ? [{ id: RES, kind: 'pdf', title: 'Study Guide', url: null, page_count: 3 }] : [];
    });
    return reply;
  };
  const page = openStudentPage({ objectUrls: true });
  const asked = [];
  page.server = body => {
    if (body.route !== 'handout-links') return fn.handle(body);
    asked.push(body);
    const round = asked.length;
    return {
      ok: true,
      pages: [1, 2, 3].map(n => ({ page: n, url: 'https://x.supabase.co/sign/' + n + '?t=' + round })),
    };
  };
  page.storage = async url =>
    opts.fail && opts.fail(url) ? { status: 400 } : { status: 200, blob: new Blob(['jpeg']) };
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  await page.settle();
  return { page, asked };
}
const gets = page => page.storageCalls.map(c => c.url.replace('https://x.supabase.co/sign/', ''));
const pictures = page =>
  [...page.root().querySelectorAll('.sp-car[data-car="' + WORK.quick + '"] .sp-car-slide')].map(s =>
    s.querySelector('img') ? s.querySelector('img').getAttribute('src') : '',
  );

describe('on a real card', () => {
  it('nothing is asked until the card is near the screen; then one call and only the pages wanted', async () => {
    const { page, asked } = await realCard();
    expect(page.root().querySelector('.sp-car[data-car="' + WORK.quick + '"]')).toBeTruthy();
    expect(asked).toEqual([]);
    expect(page.storageCalls).toEqual([]);
    // Near the screen (and on it): the page it shows, and the next.
    page.onScreen(el => el.getAttribute('data-car') === WORK.quick);
    await page.settle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ route: 'handout-links', resource_id: RES, assessment_id: WORK.quick });
    expect(gets(page)).toEqual(['1?t=1', '2?t=1']);
    expect(pictures(page)).toEqual(['blob:page/1', 'blob:page/2', '']);
    // On screen again: nothing new is asked for what is here.
    page.onScreen(() => true);
    await page.settle();
    expect(asked).toHaveLength(1);
    expect(gets(page)).toHaveLength(2);
  });

  it('a page wanted after its links have run out asks for new links first', async () => {
    const { page, asked } = await realCard();
    page.onScreen(el => el.getAttribute('data-car') === WORK.quick);
    await page.settle();
    page.advance(50000);
    const url = await page.T.handoutSource.load(WORK.quick, RES, 2);
    await page.settle();
    expect(url).toMatch(/^blob:page\//);
    expect(asked).toHaveLength(2);
    expect(gets(page).slice(-1)).toEqual(['3?t=2']);
  });

  it('a link that fails is asked for again once, quietly; a page that still fails stays a grey box', async () => {
    const { page, asked } = await realCard({ fail: url => /\/2\?t=1$/.test(url) || /\/3\?/.test(url) });
    page.onScreen(el => el.getAttribute('data-car') === WORK.quick);
    await page.settle();
    // Page 2's first link failed: new links, and page 2 came.
    expect(asked).toHaveLength(2);
    expect(gets(page)).toEqual(['1?t=1', '2?t=1', '2?t=2']);
    expect(pictures(page)[1]).toMatch(/^blob:page\//);
    // Page 3 fails every time: asked again once, then left grey, with nothing said.
    const url = await page.T.handoutSource.load(WORK.quick, RES, 2);
    await page.settle();
    expect(url).toBe('');
    expect(asked).toHaveLength(3);
    expect(page.root().querySelector('[role="alert"]')).toBeNull();
    expect(pictures(page)[2]).toBe('');
  });

  it('a tap on a page opens the handout at that page, its pages already here', async () => {
    const { page, asked } = await realCard();
    page.onScreen(el => el.getAttribute('data-car') === WORK.quick);
    await page.settle();
    await page.click('.sp-car[data-car="' + WORK.quick + '"] .sp-car-slide[data-page="1"]');
    await page.settle();
    expect(page.T.state().handoutPage).toBe(1);
    expect(page.root().querySelector('.sp-handout .sp-fb-sub').textContent).toBe('Page 2 of 3');
    expect(page.root().querySelector('.sp-handout img.sp-work-img').getAttribute('src')).toBe('blob:page/2');
    // The open handout fetched the page it did not have, with the same links.
    expect(asked).toHaveLength(1);
    expect(gets(page)).toEqual(['1?t=1', '2?t=1', '3?t=1']);
  });
});
