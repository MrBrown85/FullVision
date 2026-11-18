/**
 * Bulletins on the student's page (docs/plans/bulletins-plan.md, slice B1d):
 * s/bulletins.js and s/bulletins-view.js, on the page as a browser loads it
 * (tests/helpers/student-page-context.js), against the student-submit
 * function's real handler over a stand-in database, with the four bulletin
 * routes answered here as bulletin-routes.ts answers them (they are not on
 * the deployed function yet; an unknown route is the real handler's
 * bad_request). Demo Mode too. No test waits on real time.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, fakeStudentSubmit, id, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const ON = { 'fv-build-bulletins': '1' };
const routes = page => page.calls.map(c => c.body.route);
const tabs = page => [...page.root().querySelectorAll('.sp-tabs-bottom .sp-tab')].map(t => t.getAttribute('data-tab'));
const current = page =>
  page.root().querySelector('.sp-tabs-bottom .sp-tab[aria-current="page"]').getAttribute('data-tab');
const badge = (page, tab) =>
  (page.root().querySelector('.sp-tabs-bottom [data-tab="' + tab + '"] .sp-tab-badge') || {}).textContent || '';
const ago = mins => new Date(Date.now() - mins * 60000).toISOString();

const B1 = id(101);
const B2 = id(102);
const B3 = id(103);
const FILE = id(111);

function bulletin(n, more) {
  return Object.assign(
    {
      id: n,
      kind: 'announcement',
      body: 'Words ' + n.slice(0, 8),
      link_url: null,
      link_title: null,
      pinned: false,
      pinned_until: null,
      assessment_id: null,
      reactions_on: false,
      posted_at: ago(60),
      edited_at: null,
      files: [],
      seen_at: null,
      reaction: null,
    },
    more,
  );
}

/* The class's bulletins as bulletin-routes.ts answers them; db.fail[route]
   answers a route with a refusal instead; db.hold holds `bulletins` until it
   is let go; db.missing makes every bulletin route the real handler's (an
   unknown route: bad_request). */
function world(opts = {}) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)].concat(opts.more || []) });
  const db = {
    list: opts.list || [],
    news: opts.news || null,
    seen: [],
    reacts: [],
    files: [],
    fail: {},
    hold: null,
    missing: !!opts.missing,
  };
  const server = async body => {
    if (/^bulletin/.test(body.route) && !db.missing) {
      if (db.fail[body.route])
        return typeof db.fail[body.route] === 'function' ? db.fail[body.route]() : db.fail[body.route];
      if (body.route === 'bulletins') {
        if (db.hold) await db.hold;
        const count = db.list.filter(b => !b.seen_at).length;
        return { ok: true, bulletins: db.list, new: db.news || [{ enrollment_id: body.enrollment_id, count }] };
      }
      if (body.route === 'bulletin-seen') {
        db.seen.push(body.bulletin_ids);
        body.bulletin_ids.forEach(x => {
          const b = db.list.find(y => y.id === x);
          if (b && !b.seen_at) b.seen_at = new Date().toISOString();
        });
        return { ok: true, seen: body.bulletin_ids.length };
      }
      if (body.route === 'bulletin-react') {
        db.reacts.push([body.bulletin_id, body.word]);
        return { ok: true, reaction: body.word };
      }
      if (body.route === 'bulletin-files') {
        db.files.push(body.bulletin_file_id);
        return {
          ok: true,
          file_id: body.bulletin_file_id,
          pages: [1, 2].map(p => ({
            page: p,
            url: 'https://x.supabase.co/storage/v1/object/sign/p' + p + '?t=' + db.files.length,
          })),
        };
      }
    }
    return fn.handle(body);
  };
  return { fn, db, server };
}

async function signIn(w, opts = {}) {
  const page = openStudentPage(Object.assign({ store: opts.store || Object.assign({}, ON) }, opts.page));
  // The page context has no URL of its own: a browser's, for the link card.
  if (!opts.page || !opts.page.objectUrls) page.ctx.URL = URL;
  page.server = w.server;
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}

describe('with the switch off, the page is the page it was', () => {
  it('three tabs, the same requests, nothing more kept on the device', async () => {
    const w = world({ list: [bulletin(B1)] });
    const page = await signIn(w, { store: {} });
    expect(tabs(page)).toEqual(['assignments', 'learning', 'questionnaires']);
    expect(current(page)).toBe('assignments');
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms']);
    expect(Object.keys(page.store)).toEqual(['fv-s-session']);
    expect(page.root().innerHTML).not.toMatch(/bulletin/i);
    await page.click('.sp-tabs-bottom [data-tab="questionnaires"]');
    await page.click('.sp-tabs-bottom [data-tab="assignments"]');
    page.runTicks();
    await page.settle();
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'forms']);
  });

  it('a tab named bulletins opens nothing', async () => {
    const w = world({ list: [bulletin(B1)] });
    const page = await signIn(w, { store: {} });
    page.root().querySelector('.sp-tabs-bottom [data-tab="learning"]').setAttribute('data-tab', 'bulletins');
    await page.click('.sp-tabs-bottom [data-tab="bulletins"]');
    expect(current(page)).toBe('assignments');
    expect(page.root().querySelector('.sp-bulletin-tab')).toBeNull();
  });
});

describe('until the server has the route, the page offers nothing (plan rule 7)', () => {
  for (const [what, set] of [
    ['an unknown route (the deployed function today)', db => (db.missing = true)],
    ['a 500', db => (db.fail.bulletins = { ok: false, error: 'server' })],
    ['no answer', db => (db.fail.bulletins = { ok: false, error: 'network' })],
    ['an answer that is not a list', db => (db.fail.bulletins = { ok: true, bulletins: 'x' })],
  ]) {
    it(what + ': no Bulletins tab, opens on Assignments', async () => {
      const w = world({ list: [bulletin(B1)] });
      set(w.db);
      const page = await signIn(w);
      expect(tabs(page)).toEqual(['assignments', 'learning', 'questionnaires']);
      expect(current(page)).toBe('assignments');
      expect(routes(page).filter(r => /bulletin/.test(r))).toEqual(['bulletins']);
      // Nothing else is ever asked: no Seen, no timer.
      page.runTicks();
      await page.settle();
      expect(routes(page).filter(r => /bulletin/.test(r))).toEqual(['bulletins']);
    });
  }

  it('a class whose page is off: the page says what it says today, not an empty tab', async () => {
    const w = world({ list: [bulletin(B1)] });
    w.fn.state.cards.P3R8WDK4.closed = false;
    const page = await signIn(w);
    expect(current(page)).toBe('bulletins');
    w.db.fail.bulletins = { ok: false, error: 'closed' };
    page.advance(25000);
    await page.click('.sp-tabs-bottom [data-tab="assignments"]');
    await page.click('.sp-tabs-bottom [data-tab="bulletins"]');
    expect(page.root().textContent).toContain('The student page is turned off for this class. Ask your teacher.');
    expect(page.root().querySelector('.sp-bulletin-tab')).toBeNull();
  });
});

describe('the opening rule', () => {
  it('a class with a bulletin opens on Bulletins, first in the bar, at the New line', async () => {
    const w = world({ list: [bulletin(B1, { seen_at: ago(50) }), bulletin(B2), bulletin(B3)] });
    const page = await signIn(w);
    expect(tabs(page)).toEqual(['bulletins', 'assignments', 'learning', 'questionnaires']);
    expect(current(page)).toBe('bulletins');
    // The New line sits before the first bulletin not seen.
    const feed = [...page.root().querySelector('.sp-bulletin-feed').children];
    const at = feed.findIndex(el => el.id === 'sp-bulletin-new');
    expect(feed[at + 1].className === 'sp-bulletin-day' ? feed[at + 2] : feed[at + 1]).toBe(
      page.root().querySelector('[data-bulletin="' + B2 + '"]'),
    );
    expect(badge(page, 'bulletins')).toBe('2');
    // `page` and `bulletins` were asked together; the other tabs keep their own counts.
    expect(routes(page).slice(0, 4)).toEqual(['card', 'verify', 'page', 'bulletins']);
    const off = await signIn(world({ list: [] }), { store: {} });
    for (const t of ['assignments', 'learning', 'questionnaires']) expect(badge(page, t)).toBe(badge(off, t));
  });

  it('a class with none opens on Assignments, with the tab there to press', async () => {
    const w = world({ list: [] });
    const page = await signIn(w);
    expect(tabs(page)).toEqual(['bulletins', 'assignments', 'learning', 'questionnaires']);
    expect(current(page)).toBe('assignments');
    await page.click('.sp-tabs-bottom [data-tab="bulletins"]');
    expect(page.root().querySelector('.sp-empty').textContent).toBe('Bulletins from your teacher will show here.');
  });

  it('an answer later than a second: opens on Assignments, the tab fills in, and the tab never moves', async () => {
    const w = world({ list: [bulletin(B1)] });
    let release;
    w.db.hold = new Promise(r => (release = r));
    const page = openStudentPage({ store: Object.assign({}, ON) });
    page.ctx.URL = URL;
    page.server = w.server;
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    page.tap('[data-act="card-yes"]');
    for (let i = 0; i < 40 && !routes(page).includes('bulletins'); i++) await page.tick();
    for (let i = 0; i < 40; i++) await page.tick();
    expect(page.T.state().screen).not.toBe('assignments');
    // A second after `page`: the class opens, on Assignments, with no Bulletins tab yet.
    page.advance(1000);
    page.runTimers();
    for (let i = 0; i < 40 && page.T.state().screen !== 'assignments'; i++) await page.tick();
    expect(current(page)).toBe('assignments');
    expect(tabs(page)).toEqual(['assignments', 'learning', 'questionnaires']);
    // The student is touching the page; the answer comes: the tab appears, the page stays where it is.
    page.tap('[data-segment="upcoming"]');
    await page.tick();
    release();
    await page.settle();
    expect(tabs(page)).toEqual(['bulletins', 'assignments', 'learning', 'questionnaires']);
    expect(current(page)).toBe('assignments');
    expect(page.root().querySelector('.sp-segment[aria-pressed="true"]').getAttribute('data-segment')).toBe('upcoming');
  });

  it('coming back to an open class keeps the tab; another class decides again', async () => {
    const w = world({ list: [bulletin(B1)] });
    const page = await signIn(w);
    expect(current(page)).toBe('bulletins');
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    // Add Another Card, then Back to Your Page: the page as it was.
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="card-add"]');
    await page.click('[data-act="card-back"]');
    expect(current(page)).toBe('learning');
    expect(routes(page).filter(r => r === 'bulletins')).toHaveLength(1);
  });
});

describe('Seen', () => {
  it('is sent once, only for bulletins the server said are not seen, once they have been on screen', async () => {
    const w = world({ list: [bulletin(B1, { seen_at: ago(50) }), bulletin(B2), bulletin(B3)] });
    const page = await signIn(w);
    // Drawing the tab tells the server nothing.
    expect(w.db.seen).toEqual([]);
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellBulletinsSeen();
    await page.settle();
    expect(w.db.seen).toEqual([[B2, B3]]);
    expect(page.calls.find(c => c.body.route === 'bulletin-seen').body).toMatchObject({
      route: 'bulletin-seen',
      enrollment_id: CECE,
      bulletin_ids: [B2, B3],
    });
    expect(badge(page, 'bulletins')).toBe('');
    // Never again, and never an empty call.
    page.advance(700);
    await page.T.tellBulletinsSeen();
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellBulletinsSeen();
    await page.settle();
    expect(w.db.seen).toEqual([[B2, B3]]);
    expect(page.calls.filter(c => c.body.route === 'bulletin-seen').every(c => c.body.bulletin_ids.length)).toBe(true);
  });

  it('a flick past is not seen; a hidden tab does not count', async () => {
    const w = world({ list: [bulletin(B1)] });
    const page = await signIn(w);
    page.onScreen(() => true);
    page.advance(300);
    page.onScreen(() => false);
    page.advance(1000);
    await page.T.tellBulletinsSeen();
    page.onScreen(() => true);
    page.hide();
    page.advance(3000);
    await page.T.tellBulletinsSeen();
    await page.settle();
    expect(w.db.seen).toEqual([]);
  });

  it('a 500 or no connection: kept, sent again at the next answer, and nothing is shown', async () => {
    const w = world({ list: [bulletin(B1), bulletin(B2)] });
    const page = await signIn(w);
    w.db.fail['bulletin-seen'] = { ok: false, error: 'server' };
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellBulletinsSeen();
    await page.settle();
    expect(w.db.seen).toEqual([]);
    expect(page.root().querySelector('[role="alert"]')).toBeNull();
    delete w.db.fail['bulletin-seen'];
    // The next natural moment: the tab pressed again after 20 seconds reads the class, then sends what is waiting.
    page.advance(21000);
    await page.click('.sp-tabs-bottom [data-tab="assignments"]');
    await page.click('.sp-tabs-bottom [data-tab="bulletins"]');
    await page.settle();
    expect(w.db.seen).toEqual([[B1, B2]]);
  });

  it('one deleted meanwhile is let go, not sent again', async () => {
    const w = world({ list: [bulletin(B1), bulletin(B2)] });
    const page = await signIn(w);
    w.db.fail['bulletin-seen'] = { ok: false, error: 'server' };
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellBulletinsSeen();
    await page.settle();
    delete w.db.fail['bulletin-seen'];
    w.db.list = w.db.list.filter(b => b.id !== B1);
    page.runTicks();
    await page.settle();
    expect(w.db.seen).toEqual([[B2]]);
  });
});

describe('what the page reads from an answer', () => {
  it('a key it does not know is ignored; a kind it does not draw is left out', async () => {
    const w = world({
      list: [
        bulletin(B1, {
          body: 'Hello',
          seen_by: 18,
          names: ['Noor Al-Rashid'],
          reaction: 'love',
          counts: { got_it: 14 },
        }),
        bulletin(B2, { kind: 'poll', body: 'A poll' }),
      ],
      news: [{ enrollment_id: CECE, count: 1, names: ['Liam Chen'] }],
    });
    const page = await signIn(w);
    const html = page.root().innerHTML;
    expect(html).not.toContain('Noor');
    expect(html).not.toContain('Liam');
    expect(html).not.toContain('A poll');
    const bubble = page.root().querySelector('.sp-bulletin');
    expect(bubble.querySelector('.sp-bulletin-words').textContent).toBe('Hello');
    expect(bubble.textContent).toBe('Hello' + bubble.querySelector('.sp-bulletin-time').textContent);
    expect(page.T.bulletins().list.map(b => Object.keys(b).sort())).toEqual([
      [
        'assessment_id',
        'body',
        'edited_at',
        'files',
        'fresh',
        'id',
        'kind',
        'link_title',
        'link_url',
        'pinned',
        'pinned_until',
        'posted_at',
        'reaction',
        'reactions_on',
        'seen',
        'seen_at',
        'server',
      ],
    ]);
    expect(page.T.bulletins().list[0].reaction).toBeNull();
  });

  it('a teacher’s words are text, never HTML', async () => {
    const w = world({
      list: [
        bulletin(B1, {
          body: '<img src=x onerror=alert(1)>',
          link_title: '<b>x</b>',
          link_url: 'https://example.org/a',
        }),
      ],
    });
    const page = await signIn(w);
    const words = page.root().querySelector('.sp-bulletin-words');
    expect(words.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(page.root().querySelector('.sp-bulletin img, .sp-bulletin b')).toBeNull();
    expect(page.root().querySelector('.sp-bulletin-link-title').textContent).toBe('<b>x</b>');
  });

  it('the same instant written with two offsets reads the same: day and time from the parsed date', async () => {
    const V = window.StudentBulletinsView || runView();
    const now = new Date(2026, 10, 18, 12, 0);
    const local = new Date(2026, 10, 17, 22, 5); // 10:05 p.m. yesterday, on this device
    const utc = local.toISOString().replace('Z', '+00:00');
    const off = new Date(local.getTime() - 7 * 3600000).toISOString().replace('Z', '-07:00');
    expect(Date.parse(utc)).toBe(Date.parse(off));
    expect(V.dayHeading(utc, now)).toBe('Yesterday');
    expect(V.dayHeading(off, now)).toBe('Yesterday');
    expect(V.timeOf(utc)).toBe('10:05 p.m.');
    expect(V.timeOf(off)).toBe('10:05 p.m.');
  });

  it('says days as the teacher’s page says them', () => {
    const V = window.StudentBulletinsView || runView();
    runInThisContext(readFileSync('teacher/bulletins-format.js', 'utf-8'), { filename: 'teacher/bulletins-format.js' });
    const H = window.BulletinsFormat;
    const now = new Date(2026, 10, 18, 12, 0);
    for (const d of [
      new Date(2026, 10, 18, 9, 58),
      new Date(2026, 10, 17, 8, 1),
      new Date(2026, 10, 15, 8, 42),
      new Date(2026, 10, 12, 23, 59),
      new Date(2026, 10, 9, 8, 42),
      new Date(2025, 11, 9, 8, 42),
    ]) {
      expect(V.dayHeading(d.toISOString(), now)).toBe(H.dayHeading(d.toISOString(), now));
      // The time on a bubble is the time the teacher's page shows for today.
      expect(V.timeOf(d.toISOString())).toBe(H.timeLabel(d.toISOString(), d));
    }
  });

  it('a link card shows the site’s name from a real parse; one that is not a web address is no card', () => {
    const V = window.StudentBulletinsView || runView();
    expect(V.linkOf('https://www.youtube.com/watch?v=x')).toEqual({
      href: 'https://www.youtube.com/watch?v=x',
      host: 'youtube.com',
    });
    expect(V.linkOf('http://example.org:8080/a')).toEqual({ href: 'http://example.org:8080/a', host: 'example.org' });
    expect(V.linkOf('javascript:alert(1)')).toBeNull();
    expect(V.linkOf('not a url')).toBeNull();
    expect(V.linkOf('data:text/html,hi')).toBeNull();
  });
});

function runView() {
  globalThis.window.StudentPageView = globalThis.window.StudentPageView || {};
  runInThisContext(readFileSync('s/bulletins-view.js', 'utf-8'), { filename: 's/bulletins-view.js' });
  return window.StudentBulletinsView;
}

describe('a link asks first', () => {
  it('“Open this website in a new tab?” with the address; nothing opens until Open Website', async () => {
    const w = world({
      list: [
        bulletin(B1, {
          link_url: 'https://www.youtube.com/watch?v=inside-a-cell',
          link_title: 'Inside a Cell (video)',
        }),
      ],
    });
    const page = await signIn(w);
    const opened = [];
    page.run('window').open = (...a) => opened.push(a);
    const card = page.root().querySelector('.sp-bulletin-link');
    expect(card.querySelector('.sp-bulletin-link-host').textContent).toBe('youtube.com');
    // Nothing asked at rest.
    const doc = page.root().ownerDocument;
    expect(doc.querySelector('.sp-bulletin-ask')).toBeNull();
    await page.click('.sp-bulletin-link');
    expect(doc.querySelector('.sp-bulletin-ask-words').textContent).toBe('Open this website in a new tab?');
    expect(doc.querySelector('.sp-bulletin-ask-url').textContent).toBe('https://www.youtube.com/watch?v=inside-a-cell');
    expect(opened).toEqual([]);
    doc.querySelector('.sp-bulletin-ask-no').dispatchEvent(new doc.defaultView.Event('click'));
    expect(doc.querySelector('.sp-bulletin-ask')).toBeNull();
    expect(opened).toEqual([]);
    await page.click('.sp-bulletin-link');
    doc.querySelector('.sp-bulletin-ask-go').dispatchEvent(new doc.defaultView.Event('click'));
    expect(opened).toEqual([['https://www.youtube.com/watch?v=inside-a-cell', '_blank', 'noopener,noreferrer']]);
    expect(doc.querySelector('.sp-bulletin-ask')).toBeNull();
    // Nothing went to the server for it.
    expect(routes(page).filter(r => /bulletin/.test(r))).toEqual(['bulletins']);
  });

  it('an address that is not a web address draws no card that could open', async () => {
    const w = world({ list: [bulletin(B1, { link_url: 'javascript:alert(1)', link_title: 'Click' })] });
    const page = await signIn(w);
    expect(page.root().querySelector('.sp-bulletin-link')).toBeNull();
  });
});

describe('reactions', () => {
  it('three words, one tap; the student’s own choice shown; a tap on it takes it back', async () => {
    const w = world({ list: [bulletin(B1, { reactions_on: true }), bulletin(B2)] });
    const page = await signIn(w);
    const words = [...page.root().querySelectorAll('.sp-bulletin-react')].map(b => b.textContent);
    expect(words).toEqual(['Got It', 'Done', 'I Have a Question']);
    expect(page.root().querySelectorAll('[data-bulletin="' + B2 + '"] .sp-bulletin-react')).toHaveLength(0);
    await page.click('.sp-bulletin-react[data-word="got_it"]');
    expect(w.db.reacts).toEqual([[B1, 'got_it']]);
    expect(page.root().querySelector('.sp-bulletin-react[data-word="got_it"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
    await page.click('.sp-bulletin-react[data-word="question"]');
    await page.click('.sp-bulletin-react[data-word="question"]');
    expect(w.db.reacts).toEqual([
      [B1, 'got_it'],
      [B1, 'question'],
      [B1, null],
    ]);
    expect(page.root().querySelectorAll('.sp-bulletin-react[aria-pressed="true"]')).toHaveLength(0);
    // Nothing about classmates: no number anywhere in the bubble but its time.
    expect(page.root().querySelector('.sp-bulletin-reacts').textContent).not.toMatch(/\d/);
  });

  it('one that does not land is kept, shown, and sent again; one refused goes back to what the server holds', async () => {
    const w = world({ list: [bulletin(B1, { reactions_on: true })] });
    const page = await signIn(w);
    w.db.fail['bulletin-react'] = { ok: false, error: 'network' };
    await page.click('.sp-bulletin-react[data-word="done"]');
    expect(page.root().querySelector('.sp-bulletin-react[data-word="done"]').getAttribute('aria-pressed')).toBe('true');
    expect(page.root().querySelector('[role="alert"]')).toBeNull();
    delete w.db.fail['bulletin-react'];
    page.runTicks();
    await page.settle();
    expect(w.db.reacts).toEqual([[B1, 'done']]);
    w.db.fail['bulletin-react'] = { ok: false, error: 'reactions_off' };
    await page.click('.sp-bulletin-react[data-word="got_it"]');
    expect(page.root().querySelector('.sp-bulletin-react[data-word="done"]').getAttribute('aria-pressed')).toBe('true');
    expect(page.root().querySelector('.sp-bulletin-react[data-word="got_it"]').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});

describe('asking again', () => {
  it('every 30 seconds only while Bulletins shows in a tab someone is looking at; the tab pressed after 20 seconds', async () => {
    const w = world({ list: [bulletin(B1)] });
    const page = await signIn(w);
    const asks = () => routes(page).filter(r => r === 'bulletins').length;
    expect(asks()).toBe(1);
    page.runTicks();
    await page.settle();
    expect(asks()).toBe(2);
    page.hide();
    page.runTicks();
    await page.settle();
    expect(asks()).toBe(2);
    page.show();
    await page.click('.sp-tabs-bottom [data-tab="assignments"]');
    page.runTicks();
    await page.settle();
    expect(asks()).toBe(2);
    // Back to the tab within 20 seconds: nothing asked; after: asked.
    await page.click('.sp-tabs-bottom [data-tab="bulletins"]');
    expect(asks()).toBe(2);
    page.advance(21000);
    await page.click('.sp-tabs-bottom [data-tab="assignments"]');
    await page.click('.sp-tabs-bottom [data-tab="bulletins"]');
    expect(asks()).toBe(3);
  });

  it('a new bulletin arrives: drawn, gliding in, the count up, the page not moved', async () => {
    const w = world({ list: [bulletin(B1, { seen_at: ago(5) })] });
    const page = await signIn(w);
    expect(page.root().querySelector('.sp-bulletin-glide')).toBeNull();
    w.db.list.push(bulletin(B2, { posted_at: ago(0) }));
    page.runTicks();
    await page.settle();
    expect(page.root().querySelector('[data-bulletin="' + B2 + '"]').className).toContain('sp-bulletin-glide');
    expect(page.root().querySelector('[data-bulletin="' + B1 + '"]').className).not.toContain('sp-bulletin-glide');
    expect(badge(page, 'bulletins')).toBe('1');
    expect(current(page)).toBe('bulletins');
  });

  it('"2 new" beside each class in Switch Class, as the server counts it', async () => {
    const w = world({
      list: [bulletin(B1), bulletin(B2)],
      news: [
        { enrollment_id: CECE, count: 2 },
        { enrollment_id: OMAR, count: 3 },
      ],
    });
    const page = await signIn(w);
    page.T.state().page.classes = [
      { enrollmentId: CECE, name: 'Science 8', block: 'B', toDo: 0 },
      { enrollmentId: OMAR, name: 'Humanities 8', block: 'A', toDo: 0 },
    ];
    await page.click('[data-act="settings-open"]');
    const rows = [...page.root().querySelectorAll('.sp-set-classes .sp-class')].map(r => [
      r.querySelector('.sp-class-name').textContent,
      (r.querySelector('.sp-bulletin-class-new') || {}).textContent || '',
    ]);
    expect(rows).toEqual([
      ['Science 8', '2 new'],
      ['Humanities 8', '3 new'],
    ]);
  });
});

describe('a file’s pages', () => {
  it('links are asked once, again when they have run out; each page is fetched as this device’s own copy', async () => {
    const w = world({
      list: [
        bulletin(B1, { files: [{ id: FILE, kind: 'pdf', title: 'Cell Theory Reading', page_count: 2, position: 1 }] }),
      ],
    });
    const page = await signIn(w, { page: { objectUrls: true } });
    page.storage = async () => ({ status: 200, blob: new Blob(['x']) });
    const src = page.T.bulletinSource;
    expect(page.root().querySelectorAll('.sp-bulletin-file-slide')).toHaveLength(2);
    expect(await src.load(FILE, 0)).toMatch(/^blob:/);
    expect(await src.load(FILE, 1)).toMatch(/^blob:/);
    expect(w.db.files).toEqual([FILE]);
    expect(page.storageCalls.map(c => c.url)).toEqual([
      'https://x.supabase.co/storage/v1/object/sign/p1?t=1',
      'https://x.supabase.co/storage/v1/object/sign/p2?t=1',
    ]);
    // Kept: asked for again, nothing is fetched.
    expect(src.known(FILE, 0)).toMatch(/^blob:/);
    // Opened full size, then Back.
    await page.click('.sp-bulletin-file-slide[data-page="1"]');
    expect(page.root().querySelector('#sp-bulletin-viewer-title').textContent).toBe('Cell Theory Reading');
    expect(page.root().querySelector('.sp-bulletin-viewer-sub').textContent).toBe('Page 2 of 2');
    expect(page.root().querySelector('.sp-bulletin-viewer-img').getAttribute('src')).toMatch(/^blob:/);
    await page.click('[data-act="bulletin-page-close"]');
    expect(page.root().querySelector('.sp-bulletin-viewer')).toBeNull();
    expect(page.root().querySelector('.sp-bulletin-feed')).not.toBeNull();
  });
});

describe('Demo Mode', () => {
  async function demo(store) {
    const page = openStudentPage({ store: Object.assign({}, ON, store || {}) });
    page.ctx.URL = URL;
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    return page;
  }

  it('the board’s samples, opened at the New line; nothing is sent, a Seen and a reaction included', async () => {
    const page = await demo();
    expect(current(page)).toBe('bulletins');
    expect(badge(page, 'bulletins')).toBe('2');
    expect(page.root().querySelector('.sp-bulletin-pinbar')).not.toBeNull();
    expect(page.root().querySelector('.sp-bulletin-link-host').textContent).toBe('youtube.com');
    page.onScreen(() => true);
    page.advance(700);
    await page.T.tellBulletinsSeen();
    await page.click('.sp-bulletin-react[data-word="got_it"]');
    await page.settle();
    expect(page.calls).toEqual([]);
    expect(badge(page, 'bulletins')).toBe('');
    // Nothing kept on the device either.
    expect(Object.keys(page.store).sort()).toEqual(['fv-build-bulletins']);
  });

  it('reads the demo teacher’s bulletins from this device, read only, with Cece’s own Seen', async () => {
    const kept = {
      bulletins: [
        {
          id: 'b-1',
          kind: 'announcement',
          body: 'From the teacher',
          posted_at: ago(30),
          files: [],
          reactions_on: false,
        },
        { id: 'b-2', kind: 'announcement', body: 'Waiting', posted_at: null, files: [] },
      ],
      seen: { 'b-1': ['st1'] },
      reactions: {},
    };
    const raw = JSON.stringify(kept);
    const page = await demo({ 'gb-bulletins-sci8': raw });
    expect([...page.root().querySelectorAll('.sp-bulletin-words')].map(e => e.textContent)).toEqual([
      'From the teacher',
    ]);
    expect(badge(page, 'bulletins')).toBe('');
    expect(page.store['gb-bulletins-sci8']).toBe(raw);
  });

  it('Switch Class: each class opened afresh decides its own tab, and keeps its bulletins', async () => {
    const page = await demo();
    expect(current(page)).toBe('bulletins');
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="card-add"]');
    page.type('#sp-code', 'ABCD-EFGH');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    // The second sample class has nothing posted: Assignments, with the tab there.
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Humanities 8');
    expect(current(page)).toBe('assignments');
    expect(tabs(page)[0]).toBe('bulletins');
    await page.click('[data-act="settings-open"]');
    const science = [...page.root().querySelectorAll('.sp-set-classes .sp-class')].find(b =>
      b.textContent.includes('Science 8'),
    );
    expect(science.querySelector('.sp-bulletin-class-new').textContent).toBe('2 new');
    await page.click('.sp-set-classes .sp-class[data-enrollment="demo-cece"]');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Science 8');
    expect(current(page)).toBe('bulletins');
    expect(page.T.bulletins().student).toBe('demo-cece');
    expect(page.calls).toEqual([]);
  });

  it('a paused student: the card says it is closed, as today', async () => {
    const page = openStudentPage({
      store: Object.assign({}, ON, {
        'gb-student-page-options-sci8': JSON.stringify({ st1: { paused_at: '2026-11-01T00:00:00Z' } }),
      }),
    });
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    expect(page.root().textContent).toContain('turned off');
    expect(page.root().querySelector('.sp-bulletin-tab')).toBeNull();
  });
});

describe('the four tab lists agree', () => {
  it('TABS, TAB_BODIES, TAB_IDS and newsOf name the same tabs', () => {
    const src = readFileSync('s/page-view.js', 'utf-8');
    const block = name =>
      src.slice(src.indexOf('var ' + name + ' ='), src.indexOf('};', src.indexOf('var ' + name + ' =')));
    const tabsIds = [
      ...src
        .slice(src.indexOf('var TABS = ['), src.indexOf('];', src.indexOf('var TABS = [')))
        .matchAll(/id: '(\w+)'/g),
    ].map(m => m[1]);
    const ids = [...block('TAB_IDS').matchAll(/(\w+): 1/g)].map(m => m[1]);
    const bodies = ['assignments'].concat([...block('TAB_BODIES').matchAll(/^\s+(\w+): \{/gm)].map(m => m[1]));
    const news = src.match(/var n = \{([^}]*)\}/)[1].match(/\w+(?=:)/g);
    expect(tabsIds).toEqual(['bulletins', 'assignments', 'learning', 'questionnaires']);
    expect(ids).toEqual(tabsIds);
    expect(bodies.sort()).toEqual(tabsIds.slice().sort());
    expect(news).toEqual(tabsIds);
  });
});
