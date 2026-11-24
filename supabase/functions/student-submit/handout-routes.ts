// A teacher's handout, opened on the student's page (Handouts and Links;
// the contract is handouts-links-contract.md, the migration
// student_submit.handout_links).
//
//   {route: 'handout-links', session, enrollment_id, resource_id}
//        -> student_submit.handout_links; then a 60-second link for each
//           page path it named.
//   {route: 'handout-file', session, enrollment_id, resource_id}
//        -> student_submit.handout_file (2026111706): a web page, a text
//           file or an EPUB the teacher attached; then one 60-second link
//           to it in the bucket handout-files, only after its name is
//           checked to be this handout's (<course>/<resource>.<kind>, the
//           kind the database named). { ok, kind, bytes, title, url }.
//           The page fetches the file and shows it; a web page or a book
//           only in the sealed frame (shared/handout-frame.html).
//
//   {route: 'handout-original', session, enrollment_id, resource_id}
//        -> student_submit.handout_original (2026112408): the original PDF a teacher attached beside a PDF
//           handout's pages. { ok: true, original: false } when the handout has none (older handouts, or one
//           not finished): the page leaves "Open as PDF" out without asking again. With one, { ok: true,
//           original: true, bytes, title, url }: one 60-second link in handout-files, only after its name is
//           checked to be this handout's (<course>/<resource>.pdf).
//
// A link the student opens (a web address the teacher added) needs nothing
// here: it comes with the page, assessments[].resources (card-routes.ts).
//
// The rules are send-routes.ts's file-links: the session checked by the
// database first, and who the student is taken only from that (the
// database answers only for a handout on an assessment that student's page
// shows); the statement named here; a path given to the Storage service
// only from the database's answer in this same request, and only after its
// parts are checked to be this handout's: the bucket, the handouts folder,
// this resource, page numbers 1 to 20, each once; a reply copied field by
// field; a refusal passed on by its code, any other answered not_found; a
// log line with nothing about the student (handler.ts).
//
// Kept free of Deno and database imports, as handler.ts is.
import { BUCKET, FILE_BUCKET, handoutFilePathParts, handoutPathParts, type Store } from '../_shared/storage-rest.ts';
import {
  LINK_SECONDS,
  SESSION_ERRORS,
  bad,
  good,
  isObject,
  list,
  ok,
  refusal,
  server,
  session,
  uuid,
  type SendAnswer,
} from './send-routes.ts';

type Json = Record<string, unknown>;
type Param = string | null;

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const HANDOUT_ROUTES: Record<string, true> = {
  'handout-links': true,
  'handout-file': true,
  'handout-original': true,
};

/** A handout file is 20 MB at most (2026111706, the bucket's limit). */
export const MAX_HANDOUT_FILE_BYTES = 20971520;
const FILE_KINDS: Record<string, true> = { html: true, txt: true, epub: true };

/** A handout has at most 20 pages (the contract; shared/photo-shrink.js refuses a longer PDF). */
export const MAX_HANDOUT_PAGES = 20;

// The caller's hashed address is last, as every student_submit function takes it.
export const SQL = {
  handoutLinks: 'select student_submit.handout_links($1::text, $2::uuid, $3::uuid, $4::text) as r',
  handoutFile: 'select student_submit.handout_file($1::text, $2::uuid, $3::uuid, $4::text) as r',
  handoutOriginal: 'select student_submit.handout_original($1::text, $2::uuid, $3::uuid, $4::text) as r',
};

export function makeHandoutRoutes(opts: {
  db: { call: (sql: string, params: Param[]) => Promise<unknown> };
  store: Store | null;
}) {
  async function handoutLinks(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const id = uuid(body.resource_id);
    if (!s || !e || !id) return bad();
    if (!opts.store) return server();
    const r = await opts.db.call(SQL.handoutLinks, [s, e, id, hash]);
    if (!good(r)) return ok(refusal(r, SESSION_ERRORS));
    if (r.bucket !== undefined && r.bucket !== BUCKET) throw new TypeError('bucket');
    // Each page once, in the handouts folder of one class, under this handout, 20 at most.
    const seen = new Set<number>();
    let course: string | null = null;
    const pages = list(r.pages).map(p => {
      const x = isObject(p) ? p : {};
      const parts = handoutPathParts(x.path);
      if (!parts || parts.resource !== id || seen.has(parts.page)) throw new TypeError('page');
      if (x.page !== undefined && x.page !== parts.page) throw new TypeError('page');
      if (course === null) course = parts.course;
      if (parts.course !== course) throw new TypeError('page');
      seen.add(parts.page);
      return { page: parts.page, path: x.path as string };
    });
    if (pages.length > MAX_HANDOUT_PAGES) throw new TypeError('pages');
    pages.sort((a, b) => a.page - b.page);
    const links = pages.length
      ? await opts.store.signDownloads(
          pages.map(p => p.path),
          LINK_SECONDS,
        )
      : {};
    return ok({ ok: true, pages: pages.map(p => ({ page: p.page, url: links[p.path] })) });
  }

  async function handoutFile(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const id = uuid(body.resource_id);
    if (!s || !e || !id) return bad();
    if (!opts.store) return server();
    const r = await opts.db.call(SQL.handoutFile, [s, e, id, hash]);
    if (!good(r)) return ok(refusal(r, SESSION_ERRORS));
    if (r.bucket !== FILE_BUCKET) throw new TypeError('bucket');
    // One file, this handout's, of the kind the database named.
    const parts = handoutFilePathParts(r.path);
    if (!parts || parts.resource !== id || typeof r.kind !== 'string' || !FILE_KINDS[r.kind] || parts.kind !== r.kind) {
      throw new TypeError('path');
    }
    const bytes = typeof r.bytes === 'number' && Number.isSafeInteger(r.bytes) ? r.bytes : 0;
    if (bytes < 1 || bytes > MAX_HANDOUT_FILE_BYTES) throw new TypeError('bytes');
    const path = r.path as string;
    const links = await opts.store.signDownloads([path], LINK_SECONDS, FILE_BUCKET);
    return ok({
      ok: true,
      kind: r.kind,
      bytes,
      title: typeof r.title === 'string' ? r.title : '',
      url: links[path],
    });
  }

  async function handoutOriginal(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const id = uuid(body.resource_id);
    if (!s || !e || !id) return bad();
    if (!opts.store) return server();
    const r = await opts.db.call(SQL.handoutOriginal, [s, e, id, hash]);
    if (!good(r)) return ok(refusal(r, SESSION_ERRORS));
    // A handout with no original says so plainly; nothing else of it is passed on.
    if (r.has_original === false) return ok({ ok: true, original: false });
    if (r.has_original !== true || r.bucket !== FILE_BUCKET) throw new TypeError('bucket');
    // One file, this handout's, a PDF.
    const parts = handoutFilePathParts(r.path);
    if (!parts || parts.resource !== id || parts.kind !== 'pdf') throw new TypeError('path');
    const bytes = typeof r.bytes === 'number' && Number.isSafeInteger(r.bytes) ? r.bytes : 0;
    if (bytes < 1 || bytes > MAX_HANDOUT_FILE_BYTES) throw new TypeError('bytes');
    const path = r.path as string;
    const links = await opts.store.signDownloads([path], LINK_SECONDS, FILE_BUCKET);
    return ok({
      ok: true,
      original: true,
      bytes,
      title: typeof r.title === 'string' ? r.title : '',
      url: links[path],
    });
  }

  return async function run(route: string, body: Json, hash: string): Promise<SendAnswer> {
    if (route === 'handout-links') return handoutLinks(body, hash);
    if (route === 'handout-file') return handoutFile(body, hash);
    if (route === 'handout-original') return handoutOriginal(body, hash);
    return bad();
  };
}
