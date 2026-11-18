// Bulletins on the student's page: the class's one-way feed (docs/plans/
// bulletins-plan.md, slice B1b; the contract is migrations/local-test/
// bulletins-contract.md, "For B1b"; the functions are migrations/
// 2026111803_bulletins_student.sql).
//
//   {route: 'bulletins', session, enrollment_id}
//        -> student_submit.bulletins: the open class's bulletins, oldest
//           first, and how many are new in each class on this device.
//   {route: 'bulletin-seen', session, enrollment_id, bulletin_ids}
//        -> student_submit.bulletin_seen: 0 to 100 ids, each seen once (the
//           first time is kept). { ok, seen }.
//   {route: 'bulletin-react', session, enrollment_id, bulletin_id, word}
//        -> student_submit.bulletin_react: word is got_it, done, question,
//           or null to take the reaction back. { ok, reaction }.
//   {route: 'bulletin-files', session, enrollment_id, bulletin_file_id}
//        -> student_submit.bulletin_file_links; then a 60-second link for
//           each page path it named, in the bucket bulletin-files, only after
//           each is checked to be this file's (<course>/<file>/<n>.jpg, pages
//           1 to the file's page count, each once, one class).
//
// The rules are handout-routes.ts's: the session checked by the database
// first, and who the student is taken only from that; the statement named
// here, every value a parameter; the request's shape checked before the
// database is asked; a reply rebuilt field by field by the builders below,
// from the lists in SENT (tests/student-submit-allow-list.test.js holds them
// to the SQL), so a key the database adds later is left behind until it is
// named there; a
// refusal passed on by its code, any other answered not_found; a log line
// with nothing about the student (handler.ts).
//
// What a student is sent is the contract's and nothing more: no count about
// other students, no name, nothing of another student's. The database never
// sends them; these lists are the second look.
//
// Kept free of Deno and database imports, as handler.ts is.
import { BULLETIN_BUCKET, bulletinPathParts, type Store } from '../_shared/storage-rest.ts';
import {
  LINK_SECONDS,
  SESSION_ERRORS,
  bad,
  good,
  isObject,
  list,
  ok,
  pick,
  refusal,
  server,
  session,
  uuid,
  whole,
  type SendAnswer,
} from './send-routes.ts';

type Json = Record<string, unknown>;
type Param = string | null;

/** The routes this file serves. handler.ts sends a request here when its route is one of them. */
export const BULLETIN_ROUTES: Record<string, true> = {
  bulletins: true,
  'bulletin-seen': true,
  'bulletin-react': true,
  'bulletin-files': true,
};

/** The most ids one bulletin-seen may name (the contract: more is bad_request). */
export const MAX_SEEN_IDS = 100;
/** The most bulletins one answer holds (the contract: the newest 100). */
export const MAX_BULLETINS = 100;
/** A bulletin file has at most 20 pages (the contract, "Storage"). */
export const MAX_BULLETIN_PAGES = 20;
/** A reaction is one of these words; null takes it back. */
export const WORDS = ['got_it', 'done', 'question'];

// The caller's hashed address is last, as every student_submit function takes it.
export const SQL = {
  bulletins: 'select student_submit.bulletins($1::text, $2::uuid, $3::text) as r',
  bulletinSeen: 'select student_submit.bulletin_seen($1::text, $2::uuid, $3::uuid[], $4::text) as r',
  bulletinReact: 'select student_submit.bulletin_react($1::text, $2::uuid, $3::uuid, $4::text, $5::text) as r',
  bulletinFiles: 'select student_submit.bulletin_file_links($1::text, $2::uuid, $3::uuid, $4::text) as r',
};

/* The keys passed on, level by level: exactly the contract's
   (tests/student-submit-allow-list.test.js holds them to the SQL). */
export const SENT = {
  bulletins: ['ok', 'bulletins', 'new'],
  bulletin: [
    'id',
    'kind',
    'body',
    'link_url',
    'link_title',
    'pinned',
    'pinned_until',
    'assessment_id',
    'reactions_on',
    'posted_at',
    'edited_at',
    'files',
    'seen_at',
    'reaction',
  ],
  file: ['id', 'kind', 'title', 'page_count', 'position'],
  fresh: ['enrollment_id', 'count'],
  seen: ['ok', 'seen'],
  react: ['ok', 'reaction'],
  // What the phone is given for bulletin-files: the database's answer without the bucket and the paths,
  // each page's path turned into its link.
  fileLinks: ['ok', 'file_id', 'bulletin_id', 'kind', 'title', 'page_count', 'pages'],
  page: ['page', 'url'],
};

// Refusals each route passes on by name; any other is not_found.
const ERRORS = {
  bulletins: SESSION_ERRORS,
  'bulletin-seen': [...SESSION_ERRORS, 'too_many', 'bad_request'],
  'bulletin-react': [...SESSION_ERRORS, 'reactions_off', 'too_many', 'bad_request'],
  'bulletin-files': SESSION_ERRORS,
} as const;

const idOrNull = (v: unknown): string | null => uuid(v);
const wordOrNull = (v: unknown): string | null => (typeof v === 'string' && WORDS.includes(v) ? v : null);

/* One bulletin, rebuilt: the scalars copied as plain values, the two ids as ids, the files each rebuilt, the
   student's own reaction one of the three words or null. */
const BULLETIN_TYPED = ['id', 'assessment_id', 'files', 'reaction'];
function bulletin(b: unknown): Json {
  const x = isObject(b) ? b : {};
  return {
    // Every other key on SENT.bulletin, as a plain value; a key on no list is never read.
    ...pick(
      x,
      SENT.bulletin.filter(k => !BULLETIN_TYPED.includes(k)),
    ),
    id: idOrNull(x.id),
    assessment_id: idOrNull(x.assessment_id),
    files: list(x.files).map(f => {
      const y = isObject(f) ? f : {};
      return {
        ...pick(
          y,
          SENT.file.filter(k => k !== 'id'),
        ),
        id: idOrNull(y.id),
      };
    }),
    reaction: wordOrNull(x.reaction),
  };
}

/* The answer to bulletins, rebuilt. The keys in the order the contract writes them. */
function bulletinsReply(r: Json): Json {
  const all = list(r.bulletins);
  if (all.length > MAX_BULLETINS) throw new TypeError('bulletins');
  return {
    ok: true,
    bulletins: all.map(b => order(bulletin(b), SENT.bulletin)),
    new: list(r.new).map(n => {
      const x = isObject(n) ? n : {};
      return { enrollment_id: idOrNull(x.enrollment_id), count: whole(x.count, 0, 1_000_000) ? x.count : 0 };
    }),
  };
}

/** The same object with its keys in a fixed order (the keys it has, no others). */
function order(o: Json, keys: string[]): Json {
  const out: Json = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

/* bulletin_ids: an array of 0 to 100 ids, each a uuid. Null when anything is wrong. */
export function bulletinIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_SEEN_IDS) return null;
  const ids = v.map(uuid);
  return ids.includes(null) ? null : (ids as string[]);
}

/* word: one of the three, or null to take the reaction back. Undefined when it is anything else, or absent
   (taking a reaction back is asked for, never assumed). */
export function reactionWord(body: Json): string | null | undefined {
  if (!Object.hasOwn(body, 'word')) return undefined;
  const v = body.word;
  if (v === null) return null;
  return typeof v === 'string' && WORDS.includes(v) ? v : undefined;
}

export function makeBulletinRoutes(opts: {
  db: { call: (sql: string, params: Param[]) => Promise<unknown> };
  store: Store | null;
}) {
  async function bulletins(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    if (!s || !e) return bad();
    const r = await opts.db.call(SQL.bulletins, [s, e, hash]);
    return ok(good(r) ? bulletinsReply(r) : refusal(r, ERRORS.bulletins));
  }

  async function seen(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const ids = bulletinIds(body.bulletin_ids);
    if (!s || !e || !ids) return bad();
    const r = await opts.db.call(SQL.bulletinSeen, [s, e, '{' + ids.join(',') + '}', hash]);
    if (!good(r)) return ok(refusal(r, ERRORS['bulletin-seen']));
    return ok({ ok: true, seen: whole(r.seen, 0, MAX_SEEN_IDS) ? r.seen : 0 });
  }

  async function react(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const b = uuid(body.bulletin_id);
    const word = reactionWord(body);
    if (!s || !e || !b || word === undefined) return bad();
    const r = await opts.db.call(SQL.bulletinReact, [s, e, b, word, hash]);
    if (!good(r)) return ok(refusal(r, ERRORS['bulletin-react']));
    return ok({ ok: true, reaction: wordOrNull(r.reaction) });
  }

  async function files(body: Json, hash: string): Promise<SendAnswer> {
    const s = session(body);
    const e = uuid(body.enrollment_id);
    const id = uuid(body.bulletin_file_id);
    if (!s || !e || !id) return bad();
    if (!opts.store) return server();
    const r = await opts.db.call(SQL.bulletinFiles, [s, e, id, hash]);
    if (!good(r)) return ok(refusal(r, ERRORS['bulletin-files']));
    if (r.bucket !== BULLETIN_BUCKET) throw new TypeError('bucket');
    if (uuid(r.file_id) !== id) throw new TypeError('file');
    const count = r.page_count;
    if (!whole(count, 1, MAX_BULLETIN_PAGES)) throw new TypeError('pages');
    // Each page once, of this file, within its page count, all in one class: anything else is never signed.
    const seenPages = new Set<number>();
    let course: string | null = null;
    const pages = list(r.pages).map(p => {
      const x = isObject(p) ? p : {};
      const parts = bulletinPathParts(x.path);
      if (!parts || parts.file !== id || parts.page > count || seenPages.has(parts.page)) throw new TypeError('page');
      if (x.page !== parts.page) throw new TypeError('page');
      if (course === null) course = parts.course;
      if (parts.course !== course) throw new TypeError('page');
      seenPages.add(parts.page);
      return { page: parts.page, path: x.path as string };
    });
    if (pages.length !== count) throw new TypeError('pages');
    pages.sort((a, b) => a.page - b.page);
    const links = await opts.store.signDownloads(
      pages.map(p => p.path),
      LINK_SECONDS,
      BULLETIN_BUCKET,
    );
    return ok({
      ok: true,
      file_id: id,
      bulletin_id: idOrNull(r.bulletin_id),
      ...pick(r, ['kind', 'title']),
      page_count: count,
      pages: pages.map(p => ({ page: p.page, url: links[p.path] })),
    });
  }

  return async function run(route: string, body: Json, hash: string): Promise<SendAnswer> {
    if (route === 'bulletins') return bulletins(body, hash);
    if (route === 'bulletin-seen') return seen(body, hash);
    if (route === 'bulletin-react') return react(body, hash);
    if (route === 'bulletin-files') return files(body, hash);
    return bad();
  };
}
