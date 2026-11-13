/**
 * A HEIC photo the browser cannot read, on the student page's Send My Work:
 * it says to take the photo there or save a JPEG. Any other unreadable
 * photo keeps the old words. Same harness as tests/student-send.test.js.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const text = (page, sel) => {
  const el = page.root().querySelector(sel);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
};
const fakePrepare = () => file => Promise.resolve({ ok: false, reason: file.refuse, kind: file.kind });

async function openSend() {
  const page = openStudentPage();
  await page.start('#demo-card-send');
  page.T.setPrepare(fakePrepare());
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  const id = page.T.state().reply.assessments.find(a => a.title === 'Science Fair Proposal').id;
  await page.click('.sp-piece[data-piece="' + id + '"] [data-act="send-open"]');
  return page;
}
async function choose(page, files) {
  await page.T.sendFiles(files, -1);
  await page.settle();
}

describe('a HEIC photo with no reader, on the student page', () => {
  it('says to take the photo there or save a JPEG; other unreadable photos keep the old words', async () => {
    const page = await openSend();
    await choose(page, [{ name: 'IMG_1.heic', kind: 'heic', refuse: 'no_decoder' }]);
    expect(text(page, '.sp-send-msg')).toBe('Take the photo here, or save it as a JPEG first.');
    await choose(page, [{ name: 'IMG_2.jpg', kind: 'jpeg', refuse: 'unreadable' }]);
    expect(text(page, '.sp-send-msg')).toBe('That file couldn’t be used. Try another photo.');
    // A HEIC that was damaged (not "no reader") is not this case.
    await choose(page, [{ name: 'IMG_3.heic', kind: 'heic', refuse: 'unreadable' }]);
    expect(text(page, '.sp-send-msg')).toBe('That file couldn’t be used. Try another photo.');
  });
});
