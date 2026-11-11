/**
 * Sentry never receives an image (S8-F2). A photo of student work can show a
 * name, a face or a hand, and Sentry's region is not Canada. The same harness
 * as tests/sentry-scrub.test.js: shared/sentry-init.js run with a stub
 * Sentry, its beforeSend and beforeBreadcrumb fed a real JPEG (one of Demo
 * Mode's sample pages) everywhere an event can carry one.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('../shared/sentry-init.js', import.meta.url), 'utf-8');
const JPEG = readFileSync(new URL('../assets/sample-work/cell-lab-cece-1-thumb.jpg', import.meta.url));
const B64 = JPEG.toString('base64');
const DATA_URL = 'data:image/jpeg;base64,' + B64;

let opts;
beforeAll(() => {
  const head = { appendChild() {} };
  const sandbox = {
    location: { hostname: 'fullvision.ca', href: 'https://fullvision.ca/assignments' },
    document: { head, documentElement: head, createElement: () => ({}), querySelector: () => null },
    console,
  };
  sandbox.window = sandbox;
  sandbox.Sentry = { init: o => (opts = o) };
  runInNewContext(SRC, sandbox);
  sandbox.sentryOnLoad();
});

// Any 24 characters in a row of the file's base64, anywhere in what is sent.
function carriesImage(obj) {
  const s = JSON.stringify(obj) || '';
  for (let i = 0; i + 24 <= B64.length; i += 12) {
    if (s.includes(B64.slice(i, i + 24))) return true;
  }
  return s.includes('data:image');
}

const send = (e, hint = {}) => opts.beforeSend(JSON.parse(JSON.stringify(e)), hint);
const crumb = c => opts.beforeBreadcrumb(JSON.parse(JSON.stringify(c)), {});

describe('no image reaches Sentry', () => {
  it('asks for no screenshot', () => {
    expect(opts.attachScreenshot).toBe(false);
  });

  it('sends no attachment with an event', () => {
    const hint = { attachments: [{ filename: 'page-1.jpg', data: new Uint8Array(JPEG), contentType: 'image/jpeg' }] };
    const out = send({ message: 'Upload failed', attachments: [{ filename: 'page-1.jpg' }] }, hint);
    expect(hint.attachments).toEqual([]);
    expect(out.attachments).toBeUndefined();
  });

  it('takes a picture written into an error out of every place it can be', () => {
    const out = send({
      message: 'Could not draw ' + DATA_URL,
      logentry: { message: 'Image failed: ' + DATA_URL },
      request: { url: DATA_URL },
      transaction: DATA_URL,
      exception: {
        values: [
          { type: 'Error', value: 'Bad page "' + DATA_URL + '"' },
          { type: 'TypeError', value: 'Unexpected bytes ' + B64 },
          {
            type: 'Error',
            value: 'x',
            stacktrace: { frames: [{ filename: DATA_URL, abs_path: DATA_URL, function: 'drawPage' }] },
          },
        ],
      },
      breadcrumbs: [
        { category: 'fetch', data: { method: 'GET', url: DATA_URL, status_code: 200 } },
        { category: 'ui.click', message: 'div.sw-page > img[src="' + DATA_URL + '"]' },
        { category: 'navigation', data: { from: '/assignments', to: DATA_URL } },
        { category: 'xhr', message: B64 },
      ],
    });
    expect(carriesImage(out)).toBe(false);
    // What makes a report useful survives.
    expect(out.exception.values.map(v => v.type)).toEqual(['Error', 'TypeError', 'Error']);
    expect(out.exception.values[2].stacktrace.frames[0].function).toBe('drawPage');
    expect(out.breadcrumbs[0]).toMatchObject({ category: 'fetch', data: { method: 'GET', status_code: 200 } });
  });

  it('takes a picture out of a breadcrumb on its own', () => {
    expect(carriesImage(crumb({ category: 'fetch', data: { url: DATA_URL } }))).toBe(false);
    expect(carriesImage(crumb({ category: 'ui.input', message: 'img[alt="' + DATA_URL + '"]' }))).toBe(false);
    expect(carriesImage(crumb({ category: 'sentry.event', message: 'Sent ' + B64 }))).toBe(false);
  });

  it('leaves ordinary words and short ids alone', () => {
    const out = send({ message: 'Failed to fetch assets/sample-work/cell-lab-cece-1.jpg (404)' });
    expect(out.message).toBe('Failed to fetch assets/sample-work/cell-lab-cece-1.jpg (404)');
  });
});
