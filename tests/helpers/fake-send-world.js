/**
 * A stand-in for Batch B's student_submit functions and for the
 * student-photos bucket, for tests/student-submit-send-routes.test.js.
 *
 * The database half answers the statements send-routes.ts makes (work,
 * send_start, replace, send_paths, send_finish, unsend, file_links,
 * removal_batch, removal_done) as migrations/local-test/batch-b-contract.md
 * says they answer, and send_paths as PR 1095 defines it
 * (migrations/2026111130_student_send_rules.sql, section 4), for a small world: two classes of two teachers, three
 * students, a session per phone. It RAISES { code: '22023' } for every
 * shape the contract says raises, so a test fails if the function ever
 * sends one. It is not the SQL: the SQL's own rules are proven by Batch B's
 * suite (migrations/local-test/submissions*.py). This only has to be right
 * about the shapes the function reads and the ids it is asked with.
 *
 * The storage half behaves as the contract says Storage does: an upload
 * link writes one path, once (no upsert), and only while the bucket's
 * limits allow; a read gives the bytes back; a delete removes by exact name.
 */
import fs from 'node:fs';

export const C1 = 'c1c1c1c1-0000-4000-8000-000000000001'; // Science 8, Ms. A's
export const C2 = 'c2c2c2c2-0000-4000-8000-000000000002'; // Socials 9, Mr. B's
export const CECE = 'e1e1e1e1-0000-4000-8000-000000000001'; // in C1
export const OMAR = 'e2e2e2e2-0000-4000-8000-000000000002'; // in C1
export const LIAM = 'e3e3e3e3-0000-4000-8000-000000000003'; // in C2
export const LAB = 'a1a1a1a1-0000-4000-8000-000000000001'; // C1, takes photos
export const ESSAY = 'a2a2a2a2-0000-4000-8000-000000000002'; // C1, takes photos
export const MAP = 'a3a3a3a3-0000-4000-8000-000000000003'; // C2, takes photos
export const CECE_PHONE = 's'.repeat(64);
export const OMAR_PHONE = 't'.repeat(64);
export const LIAM_PHONE = 'u'.repeat(64);
export const ENDED = 'x'.repeat(64);
export const TEACHER_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.teacher-a.signature-of-teacher-a';
export const TEACHER_A = 'f1f1f1f1-0000-4000-8000-000000000001';

export const SAMPLE = 'assets/sample-work/';
export const PAGE_JPEG = new Uint8Array(fs.readFileSync(SAMPLE + 'cell-lab-cece-1.jpg'));
export const THUMB_JPEG = new Uint8Array(fs.readFileSync(SAMPLE + 'cell-lab-cece-1-thumb.jpg'));
export const PAGE2_JPEG = new Uint8Array(fs.readFileSync(SAMPLE + 'cell-lab-fatima-1.jpg'));
export const THUMB2_JPEG = new Uint8Array(fs.readFileSync(SAMPLE + 'cell-lab-fatima-1-thumb.jpg'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let counter = 0;
const newId = () => {
  counter += 1;
  return `99${String(counter).padStart(6, '0')}-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};

function raise() {
  const e = new Error('invalid_parameter_value');
  e.name = 'PostgresError';
  e.code = '22023';
  throw e;
}

export const STATEMENTS = {
  work: 'select student_submit.work($1::text, $2::uuid, $3::text) as r',
  send_start:
    'select student_submit.send_start($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::uuid, $8::text) as r',
  replace:
    'select student_submit.replace($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::uuid, $8::text) as r',
  send_paths: 'select student_submit.send_paths($1::text, $2::uuid, $3::uuid, $4::text) as r',
  send_finish: 'select student_submit.send_finish($1::text, $2::uuid, $3::uuid, $4::jsonb, $5::text) as r',
  unsend: 'select student_submit.unsend($1::text, $2::uuid, $3::uuid, $4::text) as r',
  file_links: 'select student_submit.file_links($1::text, $2::uuid, $3::uuid, $4::text) as r',
  removal_batch: 'select student_submit.removal_batch($1::int) as r',
  removal_done: 'select student_submit.removal_done($1::bigint[]) as r',
};
const BY_SQL = Object.fromEntries(Object.entries(STATEMENTS).map(([k, v]) => [v, k]));

export function fakeWorld() {
  const calls = []; // [name, params]
  const enrollments = {
    [CECE]: { course: C1 },
    [OMAR]: { course: C1 },
    [LIAM]: { course: C2 },
  };
  const assessments = {
    [LAB]: { course: C1, students_send: 'photos', open: true },
    [ESSAY]: { course: C1, students_send: 'photos', open: true },
    [MAP]: { course: C2, students_send: 'photos', open: true },
  };
  const sessions = { [CECE_PHONE]: [CECE], [OMAR_PHONE]: [OMAR], [LIAM_PHONE]: [LIAM] };
  const subs = new Map(); // id -> submission
  const queue = []; // { id, bucket, path, done }
  const objects = new Map(); // path -> { bytes, type }
  const override = {}; // name -> (params) => answer
  let queueId = 0;

  const queueFiles = sub => {
    for (const f of sub.files) {
      for (const p of [f.path, f.thumb_path]) {
        if (!queue.some(q => q.path === p))
          queue.push({ id: ++queueId, bucket: 'student-photos', path: p, done: false });
      }
    }
  };
  const drop = sub => {
    queueFiles(sub);
    subs.delete(sub.id);
  };
  const sessionError = (token, e) => {
    if (token === ENDED) return { ok: false, error: 'signed_out' };
    const list = sessions[token];
    if (!list) return { ok: false, error: 'signed_out' };
    if (!list.includes(e)) return { ok: false, error: 'not_found' };
    return null;
  };
  const sentFor = (a, e) =>
    [...subs.values()].find(s => s.assessment === a && s.enrollment === e && s.state === 'sent');
  const sendingFor = (a, e) =>
    [...subs.values()].find(
      s => s.assessment === a && s.enrollment === e && s.state === 'sending' && s.sent_by === 'student',
    );
  const uploadJson = sub =>
    sub.files.map(f => ({ file_id: f.id, page: f.page, path: f.path, thumb_path: f.thumb_path }));

  const fns = {
    work([token, e]) {
      const err = sessionError(token, e);
      if (err) return err;
      const course = enrollments[e].course;
      return {
        ok: true,
        v: 1,
        send_work: true,
        assessments: Object.entries(assessments)
          .filter(([, a]) => a.course === course)
          .map(([id, a]) => {
            const s = sentFor(id, e);
            const u = sendingFor(id, e);
            return {
              id,
              students_send: a.students_send,
              open: a.open,
              closes_on: null,
              late_now: false,
              sent: s
                ? {
                    submission_id: s.id,
                    sent_at: s.sent_at,
                    sent_by: s.sent_by,
                    on_paper: false,
                    is_late: !!s.late,
                    note: s.note,
                    pages: s.files.length,
                    grading: false,
                    can_change: true,
                  }
                : null,
              sending: u
                ? {
                    submission_id: u.id,
                    intent: u.intent,
                    started_at: u.created_at,
                    finish_by: u.finish_by,
                    pages: u.files.length,
                  }
                : null,
            };
          }),
      };
    },

    begin(intent, [token, e, a, pages, note, plan, req]) {
      if (!req || !UUID.test(req)) raise();
      if (!a) raise();
      const p = JSON.parse(pages);
      if (!Array.isArray(p) || p.length < 1 || p.length > 30) raise();
      for (const page of p) {
        if (!page || typeof page !== 'object' || Array.isArray(page)) raise();
        for (const [k, most] of [
          ['width', 20000],
          ['height', 20000],
          ['bytes', 2097152],
          ['thumb_bytes', 2097152],
        ]) {
          if (k in page && page[k] !== null && !(Number.isInteger(page[k]) && page[k] >= 1 && page[k] <= most)) raise();
        }
      }
      if (note != null && [...note].length > 1000) raise();
      if (plan != null && !['yes', 'partly', 'no'].includes(plan)) raise();
      const err = sessionError(token, e);
      if (err) return err;
      const course = enrollments[e].course;
      const piece = assessments[a];
      if (!piece || piece.course !== course) return { ok: false, error: 'not_found' };
      const mine = [...subs.values()].find(s => s.assessment === a && s.enrollment === e && s.request_id === req);
      if (mine && mine.expired) return { ok: false, error: 'expired' };
      if (mine) {
        return {
          ok: true,
          replayed: true,
          submission_id: mine.id,
          state: mine.state,
          bucket: 'student-photos',
          late: false,
          finish_by: mine.state === 'sending' ? mine.finish_by : null,
          files: mine.state === 'sending' ? uploadJson(mine) : [],
        };
      }
      if (!piece.open) return { ok: false, error: 'work_closed', closed_on: '2026-11-13' };
      const sent = sentFor(a, e);
      if (intent === 'new' && sent) return { ok: false, error: 'already_sent' };
      if (intent === 'replace' && !sent) return { ok: false, error: 'nothing_sent' };
      const old = sendingFor(a, e);
      if (old) drop(old);
      const id = newId();
      const files = p.map((_, i) => {
        const f = newId();
        const base = `${course}/${a}/${e}/${id}/${f}`;
        return { id: f, page: i + 1, path: base + '.jpg', thumb_path: base + '-thumb.jpg', added_by: 'student' };
      });
      const sub = {
        id,
        course,
        assessment: a,
        enrollment: e,
        state: 'sending',
        intent,
        target: intent === 'replace' ? sent.id : null,
        sent_by: 'student',
        request_id: req,
        note,
        created_at: '2026-11-11T17:00:00+00:00',
        finish_by: '2026-11-11T19:00:00+00:00',
        files,
      };
      subs.set(id, sub);
      return {
        ok: true,
        replayed: false,
        submission_id: id,
        state: 'sending',
        bucket: 'student-photos',
        late: false,
        finish_by: sub.finish_by,
        files: uploadJson(sub),
      };
    },
    send_start(params) {
      return fns.begin('new', params);
    },
    replace(params) {
      return fns.begin('replace', params);
    },

    /* PR 1095, section 4: the pages of THIS student's OWN unfinished send,
       by its id, as the start gives them. Read-only. A send that is
       another student's, another class's, the teacher's, handed in or
       dropped is not_found; one past its two hours is expired. */
    send_paths([token, e, subId]) {
      if (!subId) raise();
      const err = sessionError(token, e);
      if (err) return err;
      const sub = subs.get(subId);
      if (
        !sub ||
        sub.enrollment !== e ||
        sub.course !== enrollments[e].course ||
        sub.sent_by !== 'student' ||
        sub.state !== 'sending'
      ) {
        return { ok: false, error: 'not_found' };
      }
      if (sub.expired) return { ok: false, error: 'expired' };
      return {
        ok: true,
        submission_id: sub.id,
        assessment_id: sub.assessment,
        version: 1,
        finish_by: sub.finish_by,
        bucket: 'student-photos',
        files: uploadJson(sub),
      };
    },

    send_finish([token, e, subId, filesJson]) {
      if (!subId) raise();
      const files = JSON.parse(filesJson);
      if (!Array.isArray(files) || files.length < 1 || files.length > 30) raise();
      for (const f of files) {
        if (!f || typeof f.file_id !== 'string' || !UUID.test(f.file_id) || !/^[0-9a-f]{64}$/.test(f.sha256 || ''))
          raise();
      }
      if (new Set(files.map(f => f.file_id)).size !== files.length) raise();
      const err = sessionError(token, e);
      if (err) return err;
      const sub = subs.get(subId);
      if (sub && sub.expired) {
        drop(sub);
        return { ok: false, error: 'expired' };
      }
      if (!sub || sub.enrollment !== e || sub.sent_by !== 'student') return { ok: false, error: 'not_found' };
      if (sub.state === 'sent') {
        return {
          ok: true,
          replayed: true,
          submission_id: sub.id,
          sent_at: sub.sent_at,
          late: !!sub.late,
          pages: sub.files.length,
        };
      }
      if (files.some(f => !sub.files.some(x => x.id === f.file_id))) raise();
      // Ruling 106 (PR 1095): refused only when the teacher moved the last day to before the day the send
      // started; a send started while the piece was open and finished after its last day is taken, Late.
      const piece = assessments[sub.assessment];
      if (piece.closed_before_start) return { ok: false, error: 'work_closed', closed_on: '2026-11-10' };
      const missing = files
        .filter(f => {
          const x = sub.files.find(y => y.id === f.file_id);
          return !objects.has(x.path) || !objects.has(x.thumb_path);
        })
        .map(f => f.file_id);
      if (missing.length) return { ok: false, error: 'missing_pages', missing };
      const bad = files
        .filter(f => {
          const x = sub.files.find(y => y.id === f.file_id);
          return [x.path, x.thumb_path].some(
            p => objects.get(p).bytes.length > 2097152 || objects.get(p).type !== 'image/jpeg',
          );
        })
        .map(f => f.file_id);
      if (bad.length) return { ok: false, error: 'bad_file', files: bad };
      const keep = files.map(f => f.file_id);
      queueFiles({ files: sub.files.filter(x => !keep.includes(x.id)) });
      sub.files = keep.map((id, i) => ({ ...sub.files.find(x => x.id === id), page: i + 1, sha256: files[i].sha256 }));
      if (sub.intent === 'replace') {
        const old = subs.get(sub.target);
        if (old) drop(old);
      }
      sub.state = 'sent';
      sub.intent = 'new';
      sub.sent_at = '2026-11-11T17:30:00+00:00';
      sub.late = !piece.open;
      return {
        ok: true,
        replayed: false,
        submission_id: sub.id,
        sent_at: sub.sent_at,
        late: sub.late,
        pages: sub.files.length,
      };
    },

    unsend([token, e, a]) {
      if (!a) raise();
      const err = sessionError(token, e);
      if (err) return err;
      const piece = assessments[a];
      if (!piece || piece.course !== enrollments[e].course) return { ok: false, error: 'not_found' };
      const open = sendingFor(a, e);
      if (open) drop(open);
      const sent = sentFor(a, e);
      if (!sent) return { ok: true, unsent: false, cancelled: !!open, pages: 0, kept: 0 };
      if (sent.sent_by !== 'student') return { ok: false, error: 'cannot_change' };
      const pages = sent.files.length;
      drop(sent);
      return { ok: true, unsent: true, cancelled: !!open, pages, kept: 0 };
    },

    file_links([token, e, a]) {
      const err = sessionError(token, e);
      if (err) return err;
      const course = enrollments[e].course;
      const files = [...subs.values()]
        .filter(s => s.assessment === a && s.enrollment === e && s.course === course && s.state === 'sent')
        .flatMap(s =>
          s.files.map(f => ({
            file_id: f.id,
            submission_id: s.id,
            version: 1,
            page: f.page,
            path: f.path,
            thumb_path: f.thumb_path,
            width: 900,
            height: 1200,
            rotation: 0,
          })),
        );
      return { ok: true, bucket: 'student-photos', files };
    },

    removal_batch([limit]) {
      const n = Number(limit);
      const items = queue.filter(q => !q.done).slice(0, n);
      return {
        ok: true,
        items: items.map(q => ({ id: q.id, bucket: q.bucket, path: q.path })),
        left: queue.filter(q => !q.done).length - items.length,
      };
    },

    removal_done([ids]) {
      const list = ids.replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
      let gone = 0;
      const still = [];
      for (const id of list) {
        const q = queue.find(x => x.id === id);
        if (!q || q.done) continue;
        if (objects.has(q.path)) still.push(id);
        else {
          q.done = true;
          gone++;
        }
      }
      return { ok: true, gone, still_there: still };
    },
  };

  const db = {
    async call(sql, params) {
      const name = BY_SQL[sql];
      calls.push([name || sql, params]);
      if (!name) throw new Error('unknown statement');
      if (override[name]) return override[name](params, fns);
      return JSON.parse(JSON.stringify(fns[name](params)));
    },
  };

  // ── The bucket ──────────────────────────────────────────────────────────
  const storeCalls = [];
  const tokens = new Map(); // token -> path
  let tokenN = 0;
  const store = {
    async signUpload(path) {
      storeCalls.push(['signUpload', path]);
      const token = 'up' + ++tokenN;
      tokens.set(token, path);
      return `https://store.test/storage/v1/object/upload/sign/student-photos/${path}?token=${token}`;
    },
    async signDownloads(paths, seconds) {
      storeCalls.push(['signDownloads', paths, seconds]);
      return Object.fromEntries(
        paths.map(p => [p, `https://store.test/storage/v1/object/sign/student-photos/${p}?token=dl&s=${seconds}`]),
      );
    },
    async read(path, max) {
      storeCalls.push(['read', path, max]);
      const o = objects.get(path);
      if (!o) return 'missing';
      if (o.bytes.length > max) return 'too_large';
      return { bytes: o.bytes };
    },
    async overwrite(path, bytes) {
      storeCalls.push(['overwrite', path, bytes.length]);
      if (!objects.has(path)) throw new Error('storage overwrite 404');
      objects.set(path, { bytes, type: 'image/jpeg' });
    },
    async remove(paths) {
      storeCalls.push(['remove', paths]);
      for (const p of paths) objects.delete(p);
    },
  };

  /* What a phone does with an upload link: one file, once, JPEG-typed and
     2 MB at most (the bucket's own limits). Returns the status Storage
     would answer. */
  function phoneUpload(url, bytes, type = 'image/jpeg') {
    const token = new URL(url).searchParams.get('token');
    const path = tokens.get(token);
    if (!path) return 403;
    if (objects.has(path)) return 409;
    if (bytes.length > 2097152) return 413;
    if (type !== 'image/jpeg') return 415;
    objects.set(path, { bytes, type });
    return 200;
  }

  return { db, store, calls, storeCalls, objects, subs, queue, override, assessments, sessions, phoneUpload, fns };
}
