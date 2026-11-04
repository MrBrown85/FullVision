/**
 * What FullVision sends to Sentry (EU region). shared/sentry-init.js is run
 * with a stub Sentry; the beforeSend and beforeBreadcrumb it registers are
 * fed events and breadcrumbs carrying every kind of student and teacher
 * information the app holds, and none of it may come out the other side.
 * The error's type, the page path and the stack must survive, or Sentry
 * stops being useful.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('../shared/sentry-init.js', import.meta.url), 'utf-8');

let opts;
beforeAll(() => {
  const head = { appendChild() {} };
  const sandbox = {
    location: { hostname: 'fullvision.ca', href: 'https://fullvision.ca/dashboard' },
    document: { head, documentElement: head, createElement: () => ({}), querySelector: () => null },
    console,
  };
  sandbox.window = sandbox;
  sandbox.Sentry = { init: o => (opts = o) };
  runInNewContext(SRC, sandbox);
  sandbox.sentryOnLoad();
});

const CID = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b';
const SID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const EID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZWFjaGVyQHN1cnJleS5jYSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// Everything that must never reach Sentry.
const PERSONAL = [
  'Maya',
  'Okafor',
  'Mo Okafor', // preferred name
  'she/her',
  'maya.okafor@student.surreyschools.ca',
  'c.brown@surreyschools.ca',
  '2012-04-17', // birthday
  '1234567', // student number
  'K7P-3QX', // slip code
  JWT,
  'rt_9f8e7d6c5b4a', // refresh token
  'struggled with fractions', // comment / observation / note
  'Science 8 Block B', // class name
  CID,
  SID,
  EID,
];

function leaks(obj) {
  const s = JSON.stringify(obj) || '';
  return PERSONAL.filter(v => s.includes(v));
}

const send = e => opts.beforeSend(JSON.parse(JSON.stringify(e)), {});
const crumb = c => opts.beforeBreadcrumb(JSON.parse(JSON.stringify(c)), {});

describe('Sentry setup', () => {
  it('sends no default PII, no replays and no traces', () => {
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.replaysSessionSampleRate).toBe(0);
    expect(opts.replaysOnErrorSampleRate).toBe(0);
    expect(opts.tracesSampleRate).toBe(0);
  });

  it('is not loaded by the student page', () => {
    const html = readFileSync(new URL('../s/index.html', import.meta.url), 'utf-8');
    expect(html).not.toMatch(/sentry/i);
  });
});

describe('breadcrumbs', () => {
  it('drops console breadcrumbs', () => {
    expect(crumb({ category: 'console', level: 'warn', message: 'Maya Okafor ' + SID })).toBeNull();
  });

  it('keeps the clicked element but not its text, title, label or id', () => {
    const out = crumb({
      category: 'ui.click',
      message:
        'body > div#app > div.gb-row#st-' +
        SID +
        ' > button.gb-name[title="Open Maya Okafor"][aria-label="Mo Okafor (she/her)"][name="maya.okafor@student.surreyschools.ca"]',
      data: { textContent: 'Maya Okafor' },
    });
    expect(leaks(out)).toEqual([]);
    expect(out.message).toContain('button.gb-name');
  });

  it('keeps key presses as an element only', () => {
    const out = crumb({
      category: 'ui.input',
      message: 'textarea.obs-text[placeholder="struggled with fractions"]',
    });
    expect(leaks(out)).toEqual([]);
    expect(out.message).toContain('textarea.obs-text');
  });

  it('keeps the page path of a navigation, not its query or hash', () => {
    const out = crumb({
      category: 'navigation',
      data: {
        from: '/gradebook?course=' + CID,
        to: '/student?id=' + SID + '&course=' + CID + '#notes',
      },
    });
    expect(leaks(out)).toEqual([]);
    expect(out.data).toEqual({ from: '/gradebook', to: '/student' });
  });

  it('keeps a request as method, path and status', () => {
    const urls = [
      'https://x.supabase.co/rest/v1/enrollment?select=*&id=eq.' + EID,
      'https://x.supabase.co/rest/v1/student?email=eq.maya.okafor@student.surreyschools.ca',
      'https://x.supabase.co/rest/v1/rpc/get_class_bundle?p_course_id=' + CID,
      'https://x.supabase.co/functions/v1/student-submit#K7P-3QX',
      'https://x.supabase.co/auth/v1/verify?token=' + JWT + '&type=recovery',
    ];
    for (const url of urls) {
      for (const category of ['fetch', 'xhr']) {
        const out = crumb({
          category,
          type: 'http',
          data: { method: 'POST', url, status_code: 400, request_body_size: 10, response_body_size: 2 },
        });
        expect(leaks(out), url).toEqual([]);
        expect(out.data.method).toBe('POST');
        expect(out.data.status_code).toBe(400);
        expect(out.data.url).toMatch(/^https:\/\/x\.supabase\.co\/(rest|functions|auth)\/v1\//);
      }
    }
    const rpc = crumb({ category: 'fetch', data: { url: urls[2] } });
    expect(rpc.data.url).toBe('https://x.supabase.co/rest/v1/rpc/get_class_bundle');
  });
});

function exceptionEvent(value, extra = {}) {
  return {
    event_id: 'e1',
    level: 'error',
    platform: 'javascript',
    environment: 'production',
    release: 'abc123',
    exception: {
      values: [
        {
          type: 'Error',
          value,
          mechanism: { type: 'onunhandledrejection', handled: false, data: { note: 'Maya Okafor' } },
          stacktrace: {
            frames: [
              {
                filename: 'https://fullvision.ca/teacher/page-student.js',
                abs_path: 'https://fullvision.ca/teacher/page-student.js',
                function: 'renderStudent',
                lineno: 812,
                colno: 14,
                in_app: true,
              },
              {
                filename: 'https://fullvision.ca/student?id=' + SID + '&course=' + CID,
                abs_path: 'https://fullvision.ca/student?id=' + SID + '&course=' + CID,
                function: '?',
                lineno: 3,
                colno: 1,
                context_line: '<button class="gb-name">Maya Okafor</button>',
                pre_context: ['<td>1234567</td>'],
                post_context: ['<td>struggled with fractions</td>'],
                vars: { name: 'Maya Okafor', email: 'maya.okafor@student.surreyschools.ca' },
              },
            ],
          },
        },
      ],
    },
    ...extra,
  };
}
