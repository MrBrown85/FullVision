/**
 * Failed writes from the week's new operations — shared/offline-queue.js.
 *
 * The outbox keeps one failed write per target, and a write that lands drops
 * the failed writes it replaces. A target that is too wide lets one write
 * drop or replace another that sets something else:
 *  - save_term_rating left out the term, so a term 1 and a term 2 save
 *    replaced each other; and it sends only the fields that changed, so a
 *    habits save that landed dropped a failed narrative, approval
 *    (draft_meta) or IE (reporting_basis + ie_deadline) save.
 *  - save_comment_template sends p_id null for a new template, so every new
 *    template shared one target.
 * Each test queues two writes offline, then flushes.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_SOURCE = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
const TEACHER = '11111111-1111-4111-8111-111111111111';
const ENR = '33333333-3333-4333-8333-333333333333';
const ENR2 = '44444444-4444-4444-8444-444444444444';
const ASMT = '55555555-5555-4555-8555-555555555555';
const ASMT2 = '66666666-6666-4666-8666-666666666666';
const TPL = '77777777-7777-4777-8777-777777777777';
const TPL2 = '88888888-8888-4888-8888-888888888888';
const REJECT = { data: null, error: { code: '23514', message: 'rejected' } };
const OK = { data: null, error: null };

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get() {
      return value;
    },
  });
}

var page = null;
function loadPage() {
  if (page) page.release();
  setOnline(false);
  runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
  page = window.v2Queue;
  return page;
}

const rating = (term, wire, enr) => ({ p_enrollment_id: enr || ENR, p_term: term, p_payload: wire });
const template = (text, id) => ({ p_text: text, p_slots: [], p_condition: {}, p_id: id || null, p_uses: null });
const note = (aid, text) => ({ p_enrollment_id: ENR, p_assessment_id: aid, p_note: text });

/* Queue each write offline, then flush with `answer(endpoint, payload)`
   deciding the server's reply. Returns the dead letter's payloads. */
async function run(writes, answer) {
  var Q = loadPage();
  writes.forEach(w => Q.push(w[0], w[1]));
  Q.configure({ send: (name, payload) => answer(name, payload) });
  setOnline(true);
  await Q.flush();
  await Q.flush();
  return Q.deadLetter().map(e => e.payload);
}

describe('failed writes from the new operations keep their own target', () => {
  var originalQueue;
  var originalSentry;
  var originalSetTimeout;

  beforeEach(() => {
    localStorage.clear();
    originalQueue = window.v2Queue;
    originalSentry = window.Sentry;
    originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = function () {
      return 0;
    };
    window.Sentry = { captureMessage: vi.fn() };
    localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: TEACHER } }));
  });

  afterEach(() => {
    window.v2Queue.clear();
    window.v2Queue = originalQueue;
    window.Sentry = originalSentry;
    globalThis.setTimeout = originalSetTimeout;
    setOnline(false);
  });

  describe('save_term_rating', () => {
    it('a term 2 save that lands keeps the failed term 1 save', async () => {
      const dead = await run(
        [
          ['save_term_rating', rating(1, { narrative_html: 'Term one.' })],
          ['save_term_rating', rating(2, { narrative_html: 'Term two.' })],
        ],
        (n, p) => (p.p_term === 1 ? REJECT : OK),
      );
      expect(dead.map(p => p.p_term)).toEqual([1]);
    });

    it('a failed term 1 save and a failed term 2 save are both kept', async () => {
      const dead = await run(
        [
          ['save_term_rating', rating(1, { narrative_html: 'Term one.' })],
          ['save_term_rating', rating(2, { narrative_html: 'Term two.' })],
        ],
        () => REJECT,
      );
      expect(dead.map(p => p.p_term)).toEqual([1, 2]);
    });

    it('another student’s save never touches this one', async () => {
      const dead = await run(
        [
          ['save_term_rating', rating(1, { narrative_html: 'Mine.' })],
          ['save_term_rating', rating(1, { narrative_html: 'Theirs.' }, ENR2)],
        ],
        (n, p) => (p.p_enrollment_id === ENR ? REJECT : OK),
      );
      expect(dead.map(p => p.p_enrollment_id)).toEqual([ENR]);
    });

    it('a habits save that lands keeps a failed approval (draft_meta) save', async () => {
      const approve = { narrative_html: 'Approved text.', approved: true, draft_meta: { facts_hash: 'h1' } };
      const dead = await run(
        [
          ['save_term_rating', rating(1, approve)],
          ['save_term_rating', rating(1, { habits: { ready: 3 } })],
        ],
        (n, p) => ('draft_meta' in p.p_payload ? REJECT : OK),
      );
      expect(dead.map(p => p.p_payload)).toEqual([approve]);
    });

    it('a narrative save that lands keeps a failed IE choice (reporting_basis + ie_deadline)', async () => {
      const ie = { reporting_basis: 'ie', ie_deadline: '2026-11-20' };
      const dead = await run(
        [
          ['save_term_rating', rating(1, ie)],
          ['save_term_rating', rating(1, { narrative_html: 'New text.' })],
        ],
        (n, p) => ('reporting_basis' in p.p_payload ? REJECT : OK),
      );
      expect(dead.map(p => p.p_payload)).toEqual([ie]);
    });

    it('a later save that sets the same fields still replaces the failed one', async () => {
      const landed = await run(
        [
          ['save_term_rating', rating(1, { narrative_html: 'Old.' })],
          ['save_term_rating', rating(1, { narrative_html: 'New.', approved: false })],
        ],
        (n, p) => (p.p_payload.narrative_html === 'Old.' ? REJECT : OK),
      );
      expect(landed).toEqual([]);
      const failed = await run(
        [
          ['save_term_rating', rating(1, { reporting_basis: 'ie', ie_deadline: '2026-11-20' })],
          ['save_term_rating', rating(1, { reporting_basis: 'ie', ie_deadline: '2026-11-27' })],
        ],
        () => REJECT,
      );
      expect(failed.map(p => p.p_payload.ie_deadline)).toEqual(['2026-11-27']);
    });

    const APPROVE_OLD = { narrative_html: 'Old.', approved: true, draft_meta: { facts_hash: 'X' } };
    const failedEntry = (id, wire) => ({
      id: id,
      owner: TEACHER,
      key: 'enrollment:' + ENR,
      endpoint: 'save_term_rating',
      payload: rating(1, wire),
      attempts: 1,
      last_error: 'rejected',
    });
    /* A page load that sends everything and records each p_payload. */
    async function reloadAndSend() {
      const sent = [];
      const Q = loadPage();
      Q.configure({
        send: (n, p) => {
          sent.push(p.p_payload);
          return OK;
        },
      });
      setOnline(true);
      await Q.flush();
      await Q.flush();
      return sent;
    }

    it('a newer narrative that lands drops the old narrative and its approval from a failed save', async () => {
      const sent = [];
      const dead = await run(
        [
          ['save_term_rating', rating(1, APPROVE_OLD)],
          ['save_term_rating', rating(1, { narrative_html: 'New.' })],
        ],
        (n, p) => {
          if (p.p_payload.narrative_html === 'Old.') return REJECT;
          sent.push(p.p_payload);
          return OK;
        },
      );
      expect(sent).toEqual([{ narrative_html: 'New.' }]);
      expect(dead).toEqual([]);
      expect(await reloadAndSend()).toEqual([]);
    });

    it('a failed save keeps what the newer narrative does not set', async () => {
      const dead = await run(
        [
          ['save_term_rating', rating(1, Object.assign({ habits: { ready: 3 } }, APPROVE_OLD))],
          ['save_term_rating', rating(1, { narrative_html: 'New.' })],
        ],
        (n, p) => (p.p_payload.narrative_html === 'Old.' ? REJECT : OK),
      );
      expect(dead.map(p => p.p_payload)).toEqual([{ habits: { ready: 3 } }]);
    });

    it('a newer narrative that carries its own approval wins', async () => {
      const approveNew = { narrative_html: 'New.', approved: true, draft_meta: { facts_hash: 'Y' } };
      const sent = [];
      const dead = await run(
        [
          ['save_term_rating', rating(1, APPROVE_OLD)],
          ['save_term_rating', rating(1, approveNew)],
        ],
        (n, p) => {
          if (p.p_payload.narrative_html === 'Old.') return REJECT;
          sent.push(p.p_payload);
          return OK;
        },
      );
      expect(sent).toEqual([approveNew]);
      expect(dead).toEqual([]);
    });

    it('a newer narrative still queued at the next load is sent, and the old approval is not', async () => {
      localStorage.setItem(
        'fv-sync-queue-v1',
        JSON.stringify({
          entries: [
            {
              id: 'q1',
              owner: TEACHER,
              key: 'enrollment:' + ENR,
              endpoint: 'save_term_rating',
              payload: rating(1, { narrative_html: 'New.' }),
              attempts: 0,
            },
          ],
        }),
      );
      localStorage.setItem('fv-sync-dead-letter-v1', JSON.stringify([failedEntry('d1', APPROVE_OLD)]));
      const sent = await reloadAndSend();
      expect(sent).toEqual([{ narrative_html: 'New.' }]);
      expect(JSON.stringify(sent)).not.toMatch(/Old\.|approved|draft_meta/);
    });

    it('an approval still queued loses its approval when a newer narrative is queued behind it', async () => {
      const sent = [];
      await run(
        [
          ['save_term_rating', rating(1, APPROVE_OLD)],
          ['save_term_rating', rating(1, { narrative_html: 'New.' })],
        ],
        (n, p) => {
          sent.push(p.p_payload);
          return OK;
        },
      );
      expect(sent).toEqual([{ narrative_html: 'Old.' }, { narrative_html: 'New.' }]);
    });

    it('an approval alone still queued goes as an empty save', async () => {
      const sent = [];
      await run(
        [
          ['save_term_rating', rating(1, { approved: true, draft_meta: { facts_hash: 'X' } })],
          ['save_term_rating', rating(1, { narrative_html: 'New.' })],
        ],
        (n, p) => {
          sent.push(p.p_payload);
          return OK;
        },
      );
      expect(sent).toEqual([{}, { narrative_html: 'New.' }]);
    });

    it('on the next load a failed save is retried unless a queued save sets the same fields', () => {
      const dead = (id, wire, term) => ({
        id: id,
        owner: TEACHER,
        key: 'enrollment:' + ENR,
        endpoint: 'save_term_rating',
        payload: rating(term || 1, wire),
        attempts: 1,
        last_error: 'rejected',
      });
      localStorage.setItem(
        'fv-sync-queue-v1',
        JSON.stringify({
          entries: [
            {
              id: 'q1',
              owner: TEACHER,
              key: 'enrollment:' + ENR,
              endpoint: 'save_term_rating',
              payload: rating(1, { narrative_html: 'Newer.', approved: false }),
              attempts: 0,
            },
          ],
        }),
      );
      localStorage.setItem(
        'fv-sync-dead-letter-v1',
        JSON.stringify([
          dead('stale', { narrative_html: 'Older.' }),
          dead('habits', { habits: { ready: 3 } }),
          dead('term2', { narrative_html: 'Older.' }, 2),
        ]),
      );

      loadPage();

      const queued = JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries;
      expect(queued.map(e => e.id)).toEqual(['q1', 'habits', 'term2']);
      expect(window.Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('save_comment_template', () => {
    it('a new template that lands keeps another new template’s failed save', async () => {
      const dead = await run(
        [
          ['save_comment_template', template('{name} reads every source twice before writing.')],
          ['save_comment_template', template('{name} asks a question in every class discussion.')],
        ],
        (n, p) => (/reads/.test(p.p_text) ? REJECT : OK),
      );
      expect(dead.map(p => p.p_text)).toEqual(['{name} reads every source twice before writing.']);
    });

    it('two failed new templates are both kept', async () => {
      const dead = await run(
        [
          ['save_comment_template', template('{name} reads every source twice before writing.')],
          ['save_comment_template', template('{name} asks a question in every class discussion.')],
        ],
        () => REJECT,
      );
      expect(dead.length).toBe(2);
    });

    it('saved templates key by their id', async () => {
      const dead = await run(
        [
          ['save_comment_template', template('{name} reads every source twice.', TPL)],
          ['save_comment_template', template('{name} reads every source twice.', TPL2)],
        ],
        (n, p) => (p.p_id === TPL ? REJECT : OK),
      );
      expect(dead.map(p => p.p_id)).toEqual([TPL]);
    });

    it('the same new template saved twice keeps one failed save', async () => {
      const dead = await run(
        [
          ['save_comment_template', template('{name} reads every source twice before writing.')],
          ['save_comment_template', template('{name} reads every source twice before writing.')],
        ],
        () => REJECT,
      );
      expect(dead.length).toBe(1);
    });
  });

  describe('save_score_report_note', () => {
    it('a note on another piece that lands keeps the failed note', async () => {
      const dead = await run(
        [
          ['save_score_report_note', note(ASMT, 'Wrote from a soldier’s view.')],
          ['save_score_report_note', note(ASMT2, 'Labelled every river.')],
        ],
        (n, p) => (p.p_assessment_id === ASMT ? REJECT : OK),
      );
      expect(dead.map(p => p.p_assessment_id)).toEqual([ASMT]);
    });

    it('two failed notes on two pieces are both kept', async () => {
      const dead = await run(
        [
          ['save_score_report_note', note(ASMT, 'Wrote from a soldier’s view.')],
          ['save_score_report_note', note(ASMT2, 'Labelled every river.')],
        ],
        () => REJECT,
      );
      expect(dead.map(p => p.p_assessment_id)).toEqual([ASMT, ASMT2]);
    });
  });
});
