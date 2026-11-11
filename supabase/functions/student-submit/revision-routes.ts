// Send My Revision, and the group's pages (Batch C; docs/plans/student-
// page-build-plan.md, S11 and S12). The database side is migrations/
// 2026111120_markup_reflect_revise.sql (its contract: migrations/local-test/
// batch-c-contract.md, "revision_start" to "group_file_links"). A revision
// is sent as Batch B's work is (send-routes.ts), through its own three
// routes; send-start, send-finish and unsend refuse a revision.
//
//   {route: 'revise-start', session, enrollment_id, assessment_id,
//    request_id, pages, note?}
//        -> student_submit.revision_start; then one upload link for each
//           path the database named, and the removal worker.
//   {route: 'revise-finish', session, enrollment_id, submission_id,
//    files: [file_id, …]}
//        -> student_submit.send_paths (read-only: this student's own
//           unfinished send's paths; it must be a revision, version 2 or
//           more), every file read and checked as send-finish checks it,
//           then student_submit.revision_finish; then the worker.
//   {route: 'revise-unsend', session, enrollment_id, assessment_id}
//        -> student_submit.revision_unsend; then the worker.
//   {route: 'group-links', session, enrollment_id, assessment_id}
//        -> student_submit.group_file_links; then a 300-second link for
//           each path it named.
//
// Every rule send-routes.ts keeps, this file keeps, with send-routes.ts's
// own helpers: the session checked by the database first, and who the
// student is taken only from that; each statement named here; a request
// the database would raise 22023 for refused first as bad_request; a path
// given to Storage only from the database's answer in this same request,
// after its parts are checked; a reply copied field by field; and a log
// line with no token, id, path, link or byte of a file.
//
// Kept free of Deno and database imports, as handler.ts is.
import { BUCKET, pathParts } from '../_shared/storage-rest.ts';
import {
  CHANGE_ERRORS,
  LINK_SECONDS,
  SESSION_ERRORS,
  SQL as SEND_SQL,
  bad,
  checkPages,
  fileIds,
  good,
  inTurn,
  isObject,
  list,
  note,
  ok,
  pages,
  pick,
  plain,
  refusal,
  sendFiles,
  server,
  session,
  uuid,
  whole,
  type Removal,
  type SendAnswer,
  type SendFile,
  type SendOptions,
} from './send-routes.ts';

type Json = Record<string, unknown>;

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const REVISION_ROUTES: Record<string, true> = {
  'revise-start': true,
  'revise-finish': true,
  'revise-unsend': true,
  'group-links': true,
};

// ── The statements ──────────────────────────────────────────────────────────
// The caller's hashed address is last (unused by Batch C). revise-finish also reads send_paths, and for a
// finish sent again work and file_links, with send-routes.ts's own statements.
export const SQL = {
  revisionStart:
    'select student_submit.revision_start($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::uuid, $7::text) as r',
  revisionFinish: 'select student_submit.revision_finish($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text) as r',
  revisionUnsend: 'select student_submit.revision_unsend($1::text, $2::uuid, $3::uuid, $4::text) as r',
  groupFileLinks: 'select student_submit.group_file_links($1::text, $2::uuid, $3::uuid, $4::text) as r',
};

// ── What each route passes on ───────────────────────────────────────────────
// Any other refusal is answered not_found. too_many, missing_pages and bad_file carry their one extra field
// (send-routes.ts, refusal).
const ERRORS = {
  'revise-start': [
    ...CHANGE_ERRORS,
    'send_off',
    'not_taking_work',
    'expired',
    'no_revision',
    'grading_started',
    'too_many',
    'class_full',
  ],
  'revise-finish': [
    ...CHANGE_ERRORS,
    'expired',
    'send_off',
    'not_taking_work',
    'no_revision',
    'grading_started',
    'request_changed',
    'cannot_change',
    'missing_pages',
    'bad_file',
  ],
  'revise-unsend': [...CHANGE_ERRORS, 'grading_started', 'cannot_change'],
  'group-links': SESSION_ERRORS,
} as const;

/** A send holds 1 to 30 pages; a version number is a Postgres smallint. */
const MAX_PAGES = 30;
const MAX_VERSION = 32_767;

export type RevisionOptions = Pick<SendOptions, 'db' | 'store' | 'log'> & {
  // The removal worker the send routes use too (handler.ts makes one), so one runs at a time.
  removal: Removal;
};

export function makeRevisionRoutes(opts: RevisionOptions) {
  const { db, store, log } = opts;
  const { after } = opts.removal;

  /* revise-start: revision_start, then an upload link for each page and
     thumbnail the database named, after each path is checked to be this
     send's (sendFiles). A replay after the finish (state sent) gets no
     file and no link. The answer's version must be a revision's: a request
     id that belongs to a first send (version 1) is answered by
     revision_start as a replay of that send, and is refused here with no
     link, as send-finish refuses a revision. */
  async function start(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const a = uuid(body.assessment_id);
    const req = uuid(body.request_id);
    const p = pages(body.pages);
    const n = note(body.note);
    if (!s || !e || !a || !req || !p || n === undefined) return bad();
    if (!store) return server();
    const r = await db.call(SQL.revisionStart, [s, e, a, JSON.stringify(p), n, req, hash]);
    let answer: Json;
    if (good(r)) {
      const submission = uuid(r.submission_id);
      if (!submission || (r.state !== 'sending' && r.state !== 'sent') || !whole(r.version, 1, MAX_VERSION)) {
        throw new TypeError('reply');
      }
      if (r.version < 2) {
        answer = { ok: false, error: 'not_found' };
      } else {
        const files = r.state === 'sending' ? sendFiles(r, e, a, submission) : [];
        const links = await inTurn(files, async f => [await store.signUpload(f.path), await store.signUpload(f.thumb)]);
        answer = {
          ok: true,
          ...pick(r, ['replayed', 'submission_id', 'state', 'version', 'late', 'finish_by']),
          files: files.map((f, i) => ({
            file_id: f.id,
            page: f.page,
            upload_url: links[i][0],
            thumb_upload_url: links[i][1],
          })),
        };
      }
    } else {
      answer = refusal(r, ERRORS['revise-start']);
    }
    await after('revise-start');
    return ok(answer);
  }

  /* revise-finish: as send-finish. The paths come from send_paths (read-
     only: this student's own unfinished send, by its id, exactly as the
     start named them). A first send (version 1) is not finished here; it
     goes through send-finish. Every page and thumbnail is read and checked
     (checkPages) before revision_finish is asked; when one is bad or
     missing, nothing is handed in and revision_finish is not asked. */
  async function finish(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const submission = uuid(body.submission_id);
    const ids = fileIds(body.files);
    if (!s || !e || !submission || !ids) return bad();
    if (!store) return server();

    const r = await db.call(SEND_SQL.sendPaths, [s, e, submission, hash]);
    if (!good(r)) {
      const answer = refusal(r, ERRORS['revise-finish']);
      // Not an unfinished send of this student's. If it is their revision, handed in, this is the same finish
      // again: answered as revision_finish answers it, from what is in, with nothing read.
      if (answer.error === 'not_found') return ok(await handedIn(s, e, submission, hash));
      return ok(answer);
    }
    const assessment = uuid(r.assessment_id);
    if (uuid(r.submission_id) !== submission || !assessment || !whole(r.version, 1, MAX_VERSION)) {
      throw new TypeError('reply');
    }
    if (r.version < 2) return ok({ ok: false, error: 'not_found' });
    const byId = new Map(sendFiles(r, e, assessment, submission).map(f => [f.id, f]));
    const chosen = ids.map(id => byId.get(id));
    // A file that is not one of this send's: the phone's mistake. Nothing is read and revision_finish is not
    // asked (it would raise 22023).
    if (chosen.includes(undefined)) return bad();

    const checked = await checkPages(store, log, 'revise-finish', chosen as SendFile[]);
    if ('refused' in checked) {
      await after('revise-finish');
      return ok(checked.refused);
    }
    const done = await db.call(SQL.revisionFinish, [s, e, submission, JSON.stringify(checked.files), hash]);
    const answer = good(done)
      ? { ok: true, ...pick(done, ['replayed', 'submission_id', 'version', 'sent_at', 'late', 'pages']) }
      : refusal(done, ERRORS['revise-finish']);
    await after('revise-finish');
    return ok(answer);
  }

  /* The same revise-finish again after it went through: the student's own
     revision for a piece, handed in, under that id. work says which piece
     holds it as the student's latest send; file_links says its version,
     which must be 2 or more. Both are read-only. Anything else is
     not_found. */
  async function handedIn(s: string, e: string, submission: string, hash: string): Promise<Json> {
    const w = await db.call(SEND_SQL.work, [s, e, hash]);
    if (!good(w)) return refusal(w, ERRORS['revise-finish']);
    for (const a of list(w.assessments)) {
      const x = isObject(a) ? a : {};
      const sent = isObject(x.sent) ? x.sent : null;
      const piece = uuid(x.id);
      if (!piece || !sent || sent.submission_id !== submission || sent.sent_by !== 'student') continue;
      const links = await db.call(SEND_SQL.fileLinks, [s, e, piece, hash]);
      if (!good(links)) return refusal(links, ERRORS['revise-finish']);
      const page = list(links.files).find(f => isObject(f) && f.submission_id === submission) as Json | undefined;
      if (!page || !whole(page.version, 2, MAX_VERSION)) break;
      return {
        ok: true,
        replayed: true,
        submission_id: submission,
        version: page.version,
        ...pick(sent, ['sent_at']),
        late: plain(sent.is_late),
        ...pick(sent, ['pages']),
      };
    }
    return { ok: false, error: 'not_found' };
  }

  async function unsend(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const a = uuid(body.assessment_id);
    if (!s || !e || !a) return bad();
    const r = await db.call(SQL.revisionUnsend, [s, e, a, hash]);
    const answer = good(r)
      ? { ok: true, ...pick(r, ['unsent', 'cancelled', 'pages']) }
      : refusal(r, ERRORS['revise-unsend']);
    await after('revise-unsend');
    return ok(answer);
  }

  /* group-links: every handed-in page of the group's work for one piece, as
     links that live 300 seconds (the student's own only, for a piece that
     is not group work). Each file is checked before any link is made: a
     page and its thumbnail in the bucket's layout, in the same folder, in
     this piece, named for its file id, and in the same class as every
     other; `mine` true or false, and the page's student folder this
     student's exactly when it is mine. Each file named once, and at most
     30 pages for each send. Anything else is thrown, and no link is made. */
  async function groupLinks(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const a = uuid(body.assessment_id);
    if (!s || !e || !a) return bad();
    if (!store) return server();
    const r = await db.call(SQL.groupFileLinks, [s, e, a, hash]);
    if (!good(r)) return ok(refusal(r, ERRORS['group-links']));
    if (r.bucket !== BUCKET) throw new TypeError('bucket');
    const seen = new Set<string>();
    const perSend = new Map<string, number>();
    let course: string | null = null;
    const files = list(r.files).map(f => {
      const x = isObject(f) ? f : {};
      const id = uuid(x.file_id);
      const sub = uuid(x.submission_id);
      const p = pathParts(x.path);
      const t = pathParts(x.thumb_path);
      if (!id || !sub || !p || !t || p.thumb || !t.thumb || seen.has(id) || typeof x.mine !== 'boolean') {
        throw new TypeError('file');
      }
      seen.add(id);
      const n = (perSend.get(sub) || 0) + 1;
      if (n > MAX_PAGES) throw new TypeError('files');
      perSend.set(sub, n);
      course = course || p.course;
      for (const parts of [p, t]) {
        if (
          parts.course !== course ||
          parts.assessment !== a ||
          parts.file !== id ||
          parts.enrollment !== p.enrollment ||
          parts.submission !== p.submission
        ) {
          throw new TypeError('file');
        }
      }
      if ((p.enrollment === e) !== x.mine) throw new TypeError('file');
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
        ...pick(f.x, ['submission_id', 'version', 'page', 'width', 'height', 'rotation', 'mine']),
        url: links[f.path],
        thumb_url: links[f.thumb],
      })),
    });
  }

  return async function run(route: string, body: Json, hash: string): Promise<SendAnswer> {
    switch (route) {
      case 'revise-start':
        return start(body, hash);
      case 'revise-finish':
        return finish(body, hash);
      case 'revise-unsend':
        return unsend(body, hash);
      case 'group-links':
        return groupLinks(body, hash);
      default:
        return bad();
    }
  };
}
