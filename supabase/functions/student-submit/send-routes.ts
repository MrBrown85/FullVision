// The routes a student's phone sends work through (docs/plans/student-page-
// build-plan.md 1.7, 1.8, slice S5, plan id S5-F4), and the teacher's
// `sweep`. The database side is Batch B (migrations/2026111101,
// 2026111102 and 2026111104; its contract is migrations/local-test/
// batch-b-contract.md on the batch-b branches). Not applied when this was
// written: until it is, each of these routes answers a plain server error
// and every other route carries on.
//
//   {route: 'work', session, enrollment_id}
//        -> student_submit.work. What the page shows about sending.
//   {route: 'send-start' | 'replace', session, enrollment_id, assessment_id,
//    request_id, pages, note?, followed_plan?}
//        -> student_submit.send_start | student_submit.replace; then one
//           upload link for each path the database named, and the worker.
//   {route: 'send-finish', session, enrollment_id, submission_id,
//    files: [file_id, …]}
//        -> student_submit.send_paths (read-only: this student's own
//           unfinished send's paths), every file read and checked, then
//           student_submit.send_finish; then the worker.
//   {route: 'unsend', session, enrollment_id, assessment_id}
//        -> student_submit.unsend; then the worker.
//   {route: 'file-links', session, enrollment_id, assessment_id}
//        -> student_submit.file_links; then a 300-second link for each path
//           it named.
//   {route: 'sweep', access_token}
//        -> a signed-in teacher only. student_submit.removal_batch, the files
//           deleted, student_submit.removal_done: the worker, and nothing else.
//
// The rules every route keeps:
//   - The session is checked as `page` checks it, before anything else: a
//     session token and an enrollment id of the right shape, and then the
//     database's own check, which every one of these functions makes first.
//     Who the student is comes only from that check. Nothing the phone says
//     about a class, a teacher, a path, a file it does not own or a link is
//     read: a field the route does not name is never looked at.
//   - Each route names its statements here and nowhere else, built from the
//     checked request. Every value goes as a parameter, never into the text.
//   - A path given to the Storage service comes from the database's answer
//     in this same request (the contract, 3, 4 and 7), and only after its
//     parts are checked to be this student's: the bucket's layout, this
//     enrollment, this assessment, and, for a send, this send and this file.
//   - A reply is copied field by field, as card-routes.ts does. A refusal is
//     its code, with the one extra field the contract gives that code.
//   - Every request the database would raise 22023 for is refused here
//     first, as bad_request: 22023 is a bug in this function (the contract,
//     9), so it is answered as a plain server error if it ever comes.
//   - A log line holds the route, the outcome, the time, and counts. Never a
//     session token, a sign-in token, an id, a path, a link, a hash or a
//     byte of a file.
//
// Kept free of Deno and database imports, as handler.ts is.
import { inspectJpeg, sha256Hex } from '../_shared/jpeg-check.ts';
import { BUCKET, pathParts, type Store } from '../_shared/storage-rest.ts';
import { tokenShape } from '../_shared/teacher-auth.ts';

type Json = Record<string, unknown>;
type Param = string | null;

export type SendOptions = {
  db: { call: (sql: string, params: Param[]) => Promise<unknown> };
  // The student-photos bucket with the service key, or null when it is not set up: then every route that
  // needs it answers a server error and asks the database nothing.
  store: Store | null;
  // Who a teacher's sign-in token belongs to (Supabase Auth), for sweep. Null: sweep answers a server error.
  whoIs: ((token: string) => Promise<string | null>) | null;
  log: (entry: Record<string, unknown>) => void;
  now: () => number;
};

export type SendAnswer = { status: number; body: Json };

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const SEND_ROUTES: Record<string, true> = {
  work: true,
  'send-start': true,
  replace: true,
  'send-finish': true,
  unsend: true,
  'file-links': true,
  sweep: true,
};

// ── The limits (the contract, "Storage" and "What the edge function must do", 1) ──
/** A page or a thumbnail the function reads may be no larger than this. */
export const MAX_FILE_BYTES = 2_000_000;
/** A page is 1 to 20,000 pixels each way. */
export const MAX_PAGE_SIDE = 20_000;
/** A thumbnail is no larger than the phone is told to make it: 400 px on its long side (shared/photo-shrink.js). */
export const MAX_THUMB_SIDE = 400;
/** A download link lives 300 seconds. */
export const LINK_SECONDS = 300;
/** A submission holds 1 to 30 pages. */
const MAX_PAGES = 30;
// What the database allows in p_pages (_work_check_pages).
const MAX_SIDE_SAID = 20_000;
const MAX_BYTES_SAID = 2_097_152;
// The removal worker: items asked for at a time, and how long it may run after a phone's route and for sweep.
const BATCH = 200;
const WORKER_AFTER_ROUTE = { ms: 2_000, rounds: 2 };
const WORKER_SWEEP = { ms: 10_000, rounds: 10 };
// How many Storage requests run at once.
const AT_ONCE = 4;

// ── The statements ──────────────────────────────────────────────────────────
// The caller's hashed address is last where the function takes one (unused by Batch B, as by page).
export const SQL = {
  work: 'select student_submit.work($1::text, $2::uuid, $3::text) as r',
  sendStart:
    'select student_submit.send_start($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::uuid, $8::text) as r',
  replace:
    'select student_submit.replace($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::uuid, $8::text) as r',
  // PR 1095, section 4: read-only, the paths of this student's own unfinished send, by its id.
  sendPaths: 'select student_submit.send_paths($1::text, $2::uuid, $3::uuid, $4::text) as r',
  sendFinish: 'select student_submit.send_finish($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text) as r',
  unsend: 'select student_submit.unsend($1::text, $2::uuid, $3::uuid, $4::text) as r',
  fileLinks: 'select student_submit.file_links($1::text, $2::uuid, $3::uuid, $4::text) as r',
  removalBatch: 'select student_submit.removal_batch($1::int) as r',
  removalDone: 'select student_submit.removal_done($1::bigint[]) as r',
};

// ── What each route passes on ───────────────────────────────────────────────
// Any other refusal is answered not_found, as card-routes.ts does.
const SESSION_ERRORS = ['signed_out', 'not_found', 'card_stopped', 'card_expired', 'closed'];
const CHANGE_ERRORS = [...SESSION_ERRORS, 'card_locked'];
const ERRORS = {
  work: SESSION_ERRORS,
  'send-start': [
    ...CHANGE_ERRORS,
    'send_off',
    'not_taking_work',
    'expired',
    'work_closed',
    'already_sent',
    'too_many',
    'class_full',
  ],
  replace: [
    ...CHANGE_ERRORS,
    'send_off',
    'not_taking_work',
    'expired',
    'work_closed',
    'nothing_sent',
    'cannot_change',
    'grading_started',
    'too_many_pages',
    'too_many',
    'class_full',
  ],
  'send-finish': [
    ...CHANGE_ERRORS,
    'expired',
    'send_off',
    'not_taking_work',
    'work_closed',
    'missing_pages',
    'bad_file',
    'already_sent',
    'grading_started',
    'too_many_pages',
  ],
  unsend: [...CHANGE_ERRORS, 'cannot_change', 'send_off', 'not_taking_work', 'work_closed', 'grading_started'],
  'file-links': SESSION_ERRORS,
} as const;

// ── Reading a request ───────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
const whole = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;

/* The device's session token, as card-routes.ts reads it for page: a
   string of at most 128 characters. Null when absent or of the wrong shape:
   every route here needs one. The database decides whether it is live. */
function session(body: Json): string | null {
  const v = body.session;
  return typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null;
}

/* p_pages, as the database checks it: 1 to 30 objects, each with any of
   width and height (whole, 1 to 20,000) and bytes and thumb_bytes (whole, 1
   to 2,097,152). Only those four are copied: nothing else in a page reaches
   the database. Null when anything is wrong. */
function pages(v: unknown): Json[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PAGES) return null;
  const out: Json[] = [];
  for (const p of v) {
    if (!isObject(p)) return null;
    const page: Json = {};
    for (const [key, most] of [
      ['width', MAX_SIDE_SAID],
      ['height', MAX_SIDE_SAID],
      ['bytes', MAX_BYTES_SAID],
      ['thumb_bytes', MAX_BYTES_SAID],
    ] as const) {
      const n = p[key];
      if (n == null) continue;
      if (!whole(n, 1, most)) return null;
      page[key] = n;
    }
    out.push(page);
  }
  return out;
}

/* The student's note: null, or text of at most 1,000 characters as
   Postgres counts them, with no NUL (which Postgres text cannot hold).
   Undefined when it is wrong. */
function note(v: unknown): string | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.includes('\u0000') || [...v].length > 1000) return undefined;
  return v;
}

function plan(v: unknown): string | null | undefined {
  if (v == null || v === '') return null;
  return v === 'yes' || v === 'partly' || v === 'no' ? v : undefined;
}

type Start = { session: string; enrollment: string; assessment: string; request: string; params: Param[] };

/* A start (send-start, replace): the parameters before the hashed
   address, or null. */
function readStart(body: Json): Start | null {
  const s = session(body);
  const e = uuid(body.enrollment_id);
  const a = uuid(body.assessment_id);
  const r = uuid(body.request_id);
  const p = pages(body.pages);
  const n = note(body.note);
  const f = plan(body.followed_plan);
  if (!s || !e || !a || !r || !p || n === undefined || f === undefined) return null;
  return { session: s, enrollment: e, assessment: a, request: r, params: [s, e, a, JSON.stringify(p), n, f, r] };
}

/* The pages to hand in, in their final order: 1 to 30 file ids, each once. */
function fileIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PAGES) return null;
  const ids = v.map(uuid);
  if (ids.includes(null) || new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

// ── Copying a reply ─────────────────────────────────────────────────────────
const plain = (v: unknown): unknown =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ? v : null;

function pick(from: unknown, keys: string[]): Json {
  const src = isObject(from) ? from : {};
  const out: Json = {};
  for (const k of keys) if (k in src) out[k] = plain(src[k]);
  return out;
}

/* A refusal: its code, if the route passes it on, with the field the
   contract gives that code and nothing else. A reply that is neither a
   good answer nor a refusal is thrown: the handler answers a server error. */
const EXTRA: Record<string, (r: Json) => Json> = {
  work_closed: r => ({ closed_on: typeof r.closed_on === 'string' && DATE.test(r.closed_on) ? r.closed_on : null }),
  too_many: r => (whole(r.retry_after_s, 1, 86_400) ? { retry_after_s: r.retry_after_s } : {}),
  too_many_pages: r => (whole(r.room, 0, MAX_PAGES) ? { room: r.room } : {}),
  missing_pages: r => ({ missing: list(r.missing).map(uuid).filter(Boolean) }),
  bad_file: r => ({ files: list(r.files).map(uuid).filter(Boolean) }),
};

function refusal(r: unknown, errors: readonly string[]): Json {
  if (!isObject(r) || typeof r.error !== 'string') throw new TypeError('reply');
  if (!errors.includes(r.error)) return { ok: false, error: 'not_found' };
  return { ok: false, error: r.error, ...(EXTRA[r.error] ? EXTRA[r.error](r) : {}) };
}

const good = (r: unknown): r is Json => isObject(r) && r.ok === true;

function work(r: Json): Json {
  return {
    ok: true,
    ...pick(r, ['v', 'send_work']),
    assessments: list(r.assessments).map(a => {
      const x = isObject(a) ? a : {};
      return {
        ...pick(x, ['id', 'students_send', 'open', 'closes_on', 'late_now']),
        sent: isObject(x.sent)
          ? pick(x.sent, [
              'submission_id',
              'sent_at',
              'sent_by',
              'on_paper',
              'is_late',
              'note',
              'pages',
              'grading',
              'can_change',
            ])
          : null,
        sending: isObject(x.sending)
          ? pick(x.sending, ['submission_id', 'intent', 'started_at', 'finish_by', 'pages'])
          : null,
      };
    }),
  };
}

/* A send's files as the database named them, each checked to be where this
   send's files must be: the bucket's layout, this assessment, this student,
   this send, this file, the thumbnail beside its page in the same folder.
   A file that is anything else is thrown: the database did not name it so,
   and no link is made for any of them. */
type SendFile = { id: string; page: number; path: string; thumb: string };
function sendFiles(r: Json, enrollment: string, assessment: string, submission: string): SendFile[] {
  if (r.bucket !== BUCKET) throw new TypeError('bucket');
  return list(r.files).map(f => {
    const x = isObject(f) ? f : {};
    const id = uuid(x.file_id);
    const p = pathParts(x.path);
    const t = pathParts(x.thumb_path);
    if (!id || !whole(x.page, 1, MAX_PAGES) || !p || !t || p.thumb || !t.thumb) throw new TypeError('file');
    for (const parts of [p, t]) {
      if (
        parts.enrollment !== enrollment ||
        parts.assessment !== assessment ||
        parts.submission !== submission ||
        parts.file !== id ||
        parts.course !== p.course
      ) {
        throw new TypeError('file');
      }
    }
    return { id, page: x.page, path: x.path as string, thumb: x.thumb_path as string };
  });
}

// Runs `each` over `items`, a few at a time, in order of the answers.
async function inTurn<T, U>(items: T[], each: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await each(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, lane));
  return out;
}

const bad = (): SendAnswer => ({ status: 400, body: { ok: false, error: 'bad_request' } });
const server = (): SendAnswer => ({ status: 500, body: { ok: false, error: 'server' } });
const ok = (body: Json): SendAnswer => ({ status: 200, body });

export function makeSendRoutes(opts: SendOptions) {
  const { db, store, log } = opts;
  let sweeping = false;

  /* The removal worker (the contract, 5): files queued for deletion are
     handed out, deleted from storage by their exact names, and reported
     done; the database believes "done" only for a file storage no longer
     has. Again while some are left and there is time. One run at a time in
     this instance: a run that finds another running leaves the queue to
     it. A failure is logged and never reaches the caller's answer: the
     queue keeps every file for the next run. An item whose bucket or path is
     not the bucket's own is not deleted and not reported: it stays queued. */
  async function worker(route: string, budget: { ms: number; rounds: number }): Promise<void> {
    if (!store || sweeping) return;
    sweeping = true;
    const until = opts.now() + budget.ms;
    let removed = 0;
    let skipped = 0;
    let left = 0;
    try {
      for (let round = 0; round < budget.rounds; round++) {
        const r = await db.call(SQL.removalBatch, [String(BATCH)]);
        if (!good(r)) throw new TypeError('reply');
        left = whole(r.left, 0, Number.MAX_SAFE_INTEGER) ? r.left : 0;
        const items: { id: string; path: string }[] = [];
        for (const it of list(r.items)) {
          const x = isObject(it) ? it : {};
          const id = typeof x.id === 'number' && Number.isSafeInteger(x.id) && x.id > 0 ? String(x.id) : null;
          if (id && x.bucket === BUCKET && pathParts(x.path)) items.push({ id, path: x.path as string });
          else skipped++;
        }
        if (items.length) {
          await store.remove(items.map(i => i.path));
          const done = await db.call(SQL.removalDone, ['{' + items.map(i => i.id).join(',') + '}']);
          if (!good(done)) throw new TypeError('reply');
          if (whole(done.gone, 0, Number.MAX_SAFE_INTEGER)) removed += done.gone;
        }
        if (!left || !list(r.items).length || opts.now() >= until) break;
      }
      log({ route, worker: 'ran', removed, skipped, left });
    } catch (e) {
      log({ route, worker: 'error', kind: e instanceof Error ? e.name : typeof e, removed, skipped });
    } finally {
      sweeping = false;
    }
  }

  const after = (route: string) => worker(route, WORKER_AFTER_ROUTE);

  async function start(route: 'send-start' | 'replace', body: Json, hash: string): Promise<SendAnswer> {
    const asked = readStart(body);
    if (!asked) return bad();
    if (!store) return server();
    const r = await db.call(route === 'replace' ? SQL.replace : SQL.sendStart, [...asked.params, hash]);
    let answer: Json;
    if (good(r)) {
      const submission = uuid(r.submission_id);
      if (!submission || (r.state !== 'sending' && r.state !== 'sent')) throw new TypeError('reply');
      // Handed in already (a replay after the finish): no file, no link.
      const files = r.state === 'sending' ? sendFiles(r, asked.enrollment, asked.assessment, submission) : [];
      const links = await inTurn(files, async f => [await store.signUpload(f.path), await store.signUpload(f.thumb)]);
      answer = {
        ok: true,
        ...pick(r, ['replayed', 'submission_id', 'state', 'late', 'finish_by']),
        files: files.map((f, i) => ({
          file_id: f.id,
          page: f.page,
          upload_url: links[i][0],
          thumb_upload_url: links[i][1],
        })),
      };
    } else {
      answer = refusal(r, ERRORS[route]);
    }
    await after(route);
    return ok(answer);
  }

  /* send-finish. The function must read every file before send_finish (the
     contract, 1), with a path from the database's answer in this request
     (7). send_finish names no path, so they come from send_paths (PR 1095,
     section 4): read-only, the pages of this student's own unfinished send
     by its id, exactly as the start named them, and nothing for a send that
     is another student's, the teacher's, handed in, dropped or past its two
     hours. The start is never sent again here: nothing is made, dropped or
     counted before send_finish. Until send_paths is on the database, the
     call raises and the route is a plain server error.
     Ruling 106: whether the piece is open now is not asked; a send that
     holds its place can be finished, and send_finish says whether it is
     Late or refused. */
  async function finish(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const enrollment = uuid(body.enrollment_id);
    const submission = uuid(body.submission_id);
    const ids = fileIds(body.files);
    if (!s || !enrollment || !submission || !ids) return bad();
    if (!store) return server();

    const r = await db.call(SQL.sendPaths, [s, enrollment, submission, hash]);
    if (!good(r)) {
      const answer = refusal(r, ERRORS['send-finish']);
      // Not an unfinished send of this student's. If it is their work, handed in, this is the same finish
      // again: answered as send_finish answers it, from work(), with nothing read.
      if (answer.error === 'not_found') return ok(await handedIn(s, enrollment, submission, hash));
      return ok(answer);
    }
    const assessment = uuid(r.assessment_id);
    if (uuid(r.submission_id) !== submission || !assessment) throw new TypeError('reply');
    const byId = new Map(sendFiles(r, enrollment, assessment, submission).map(f => [f.id, f]));
    const chosen = ids.map(id => byId.get(id));
    // A file that is not one of this send's: the phone's mistake. Nothing is read and send_finish is not asked.
    if (chosen.includes(undefined)) return bad();

    // Every page and its thumbnail, read and checked (the contract, 1).
    const reasons = new Set<string>();
    let stripped = 0;
    const checked = await inTurn(chosen as SendFile[], async f => {
      const [page, thumb] = [await store.read(f.path, MAX_FILE_BYTES), await store.read(f.thumb, MAX_FILE_BYTES)];
      if (page === 'missing' || thumb === 'missing') return { id: f.id, state: 'missing' as const };
      const pageCheck =
        page === 'too_large' ? null : inspectJpeg(page.bytes, { maxBytes: MAX_FILE_BYTES, maxSide: MAX_PAGE_SIDE });
      const thumbCheck =
        thumb === 'too_large' ? null : inspectJpeg(thumb.bytes, { maxBytes: MAX_FILE_BYTES, maxSide: MAX_THUMB_SIDE });
      if (!pageCheck || !pageCheck.ok || !thumbCheck || !thumbCheck.ok) {
        for (const c of [pageCheck, thumbCheck]) if (!c || !c.ok) reasons.add(c ? c.reason : 'too_large');
        return { id: f.id, state: 'bad' as const };
      }
      // Location data left in a file is cut out, and the file stored without it, before it is hashed.
      if (pageCheck.stripped) {
        await store.overwrite(f.path, pageCheck.clean);
        stripped++;
      }
      if (thumbCheck.stripped) {
        await store.overwrite(f.thumb, thumbCheck.clean);
        stripped++;
      }
      return { id: f.id, state: 'good' as const, sha256: await sha256Hex(pageCheck.clean) };
    });
    if (stripped) log({ route: 'send-finish', stripped });
    const missing = checked.filter(c => c.state === 'missing').map(c => c.id);
    const refused = checked.filter(c => c.state === 'bad').map(c => c.id);
    if (missing.length || refused.length) {
      // Nothing is handed in, and send_finish is not asked (the contract, 1).
      if (refused.length) log({ route: 'send-finish', refused: refused.length, reasons: [...reasons].sort() });
      await after('send-finish');
      return ok(
        missing.length
          ? { ok: false, error: 'missing_pages', missing }
          : { ok: false, error: 'bad_file', files: refused },
      );
    }

    const files = checked.map(c => ({ file_id: c.id, sha256: (c as { sha256: string }).sha256 }));
    const done = await db.call(SQL.sendFinish, [s, enrollment, submission, JSON.stringify(files), hash]);
    const answer = good(done)
      ? { ok: true, ...pick(done, ['replayed', 'submission_id', 'sent_at', 'late', 'pages']) }
      : refusal(done, ERRORS['send-finish']);
    await after('send-finish');
    return ok(answer);
  }

  /* The same finish again after it went through: the student's own work for
     a piece, handed in, under that id. Anything else is not_found. */
  async function handedIn(s: string, enrollment: string, submission: string, hash: string): Promise<Json> {
    const w = await db.call(SQL.work, [s, enrollment, hash]);
    if (!good(w)) return refusal(w, ERRORS['send-finish']);
    for (const a of list(w.assessments)) {
      const sent = isObject(a) && isObject(a.sent) ? a.sent : null;
      if (sent && sent.submission_id === submission && sent.sent_by === 'student') {
        return {
          ok: true,
          replayed: true,
          ...pick(sent, ['submission_id', 'sent_at']),
          late: plain(sent.is_late),
          ...pick(sent, ['pages']),
        };
      }
    }
    return { ok: false, error: 'not_found' };
  }

  async function unsend(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const a = uuid(body.assessment_id);
    if (!s || !e || !a) return bad();
    const r = await db.call(SQL.unsend, [s, e, a, hash]);
    const answer = good(r)
      ? { ok: true, ...pick(r, ['unsent', 'cancelled', 'pages', 'kept']) }
      : refusal(r, ERRORS.unsend);
    await after('unsend');
    return ok(answer);
  }

  /* The student's own pages of one piece, handed in, as links that live 300
     seconds (the contract, 4). A page kept through a Replace, or added by the
     teacher, keeps the path it was first given, so its send folder can be
     another submission's; its class, piece, student and file are checked. */
  async function fileLinks(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const a = uuid(body.assessment_id);
    if (!s || !e || !a) return bad();
    if (!store) return server();
    const r = await db.call(SQL.fileLinks, [s, e, a, hash]);
    if (!good(r)) return ok(refusal(r, ERRORS['file-links']));
    if (r.bucket !== BUCKET) throw new TypeError('bucket');
    const files = list(r.files).map(f => {
      const x = isObject(f) ? f : {};
      const id = uuid(x.file_id);
      const p = pathParts(x.path);
      const t = pathParts(x.thumb_path);
      if (!id || !p || !t || p.thumb || !t.thumb) throw new TypeError('file');
      for (const parts of [p, t]) {
        if (parts.enrollment !== e || parts.assessment !== a || parts.file !== id || parts.course !== p.course) {
          throw new TypeError('file');
        }
        if (parts.submission !== p.submission) throw new TypeError('file');
      }
      return { x, id, path: x.path as string, thumb: x.thumb_path as string };
    });
    const links = files.length
      ? await store.signDownloads(
          files.flatMap(f => [f.path, f.thumb]),
          LINK_SECONDS,
        )
      : {};
    return ok({
      ok: true,
      files: files.map(f => ({
        file_id: f.id,
        ...pick(f.x, ['submission_id', 'version', 'page', 'width', 'height', 'rotation']),
        url: links[f.path],
        thumb_url: links[f.thumb],
      })),
    });
  }

  /* sweep: the worker, for a signed-in teacher's browser (the contract, 5).
     The teacher's sign-in token travels in the body, as a student's session
     does, so nothing new is asked of CORS. Auth says whose it is; nothing
     else in the body is read. A phone holds no sign-in token, so a student
     cannot run it. */
  async function sweep(body: Json): Promise<SendAnswer> {
    const token = tokenShape(body.access_token);
    if (!token) return { status: 401, body: { ok: false, error: 'unauthorized' } };
    if (!store || !opts.whoIs) return server();
    const who = await opts.whoIs(token);
    if (!who) return { status: 401, body: { ok: false, error: 'unauthorized' } };
    await worker('sweep', WORKER_SWEEP);
    return ok({ ok: true });
  }

  return async function run(route: string, body: Json, hash: string): Promise<SendAnswer> {
    switch (route) {
      case 'work': {
        const s = session(body);
        const e = uuid(body.enrollment_id);
        if (!s || !e) return bad();
        const r = await db.call(SQL.work, [s, e, hash]);
        return ok(good(r) ? work(r) : refusal(r, ERRORS.work));
      }
      case 'send-start':
      case 'replace':
        return start(route, body, hash);
      case 'send-finish':
        return finish(body, hash);
      case 'unsend':
        return unsend(body, hash);
      case 'file-links':
        return fileLinks(body, hash);
      case 'sweep':
        return sweep(body);
      default:
        return bad();
    }
  };
}
