/**
 * A signed-in class's work is worked out with one read of the outbox.
 *
 * What was slow: _workServerView (shared/data-student-work.js), worked out
 * once a turn, asked the outbox about four endpoints in turn, and each ask
 * (v2Queue.queued) read and parsed the whole outbox from localStorage, looked
 * up who is signed in, and copied the payloads. It now asks once for all four
 * (v2Queue.queuedEach) and reads its answer for each.
 *
 * This file holds the view beside the view the old way gives, with writes of
 * every kind waiting, another teacher's left out, and counts the reads.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = U(1);
const IDS = [U(100), U(101), U(102)];
const AIDS = [U(300), U(301), U(302)];
const QUEUE = 'fv-sync-queue-v1';
const ME = U(900);
const ENDPOINTS = ['set_course_send_work', 'set_assessment_student_work', 'delete_submission', 'mark_handed_in_paper'];
let realGet;
let reads;

beforeAll(() => {
  runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
    filename: 'shared/offline-queue.js',
  });
});

function entry(n, endpoint, payload, owner) {
  return { id: 'q' + n, endpoint, payload, created_at: '2026-11-13T19:0' + n + ':00Z', owner, attempts: 0 };
}
function seed() {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'F' + i, lastName: 'L' + i })),
    assessments: AIDS.map((id, i) => ({ id, title: 'Piece ' + i, date: '2026-10-01' })),
  });
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: ME } }));
  const sub = (id, aid, sid) => ({
    id,
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    files: [{ id: id + '-1', page: 1, path: 'x.jpg' }],
  });
  _workServer[CID] = {
    assessments: AIDS.map(id => ({ id, students_send: 'photos', after_due: 'keep' })),
    submissions: [sub('s1', AIDS[0], IDS[0]), sub('s2', AIDS[0], IDS[1]), sub('s3', AIDS[1], IDS[0])],
  };
  _workCourseRow[CID] = { send_work: false, keep_photos_until: 'end_of_year' };
  const entries = [
    entry(1, 'set_course_send_work', { p_course_id: CID, p_patch: { send_work: true } }, ME),
    entry(2, 'set_assessment_student_work', { p_assessment_id: AIDS[1], p_patch: { students_send: 'nothing' } }, ME),
    entry(3, 'delete_submission', { p_submission_id: 's2' }, ME),
    entry(4, 'mark_handed_in_paper', { p_assessment_id: AIDS[2], p_enrollment_ids: [IDS[0], IDS[2]] }, ME),
    // Another teacher's: left out, as queued() leaves it out.
    entry(5, 'delete_submission', { p_submission_id: 's1' }, U(901)),
    // Another class's piece, and an endpoint the view does not read.
    entry(6, 'set_assessment_student_work', { p_assessment_id: U(399), p_patch: { students_send: 'nothing' } }, ME),
    entry(7, 'save_markup', { p_file_id: 's1-1' }, ME),
    // A write from before owners: it counts.
    entry(8, 'mark_handed_in_paper', { p_assessment_id: AIDS[1], p_enrollment_ids: [IDS[2]] }),
  ];
  localStorage.setItem(QUEUE, JSON.stringify({ entries, last_flush_at: null }));
}
function build() {
  _workChanged(CID);
  return _workServerView(CID);
}
function oldWay() {
  const each = window.v2Queue.queuedEach;
  delete window.v2Queue.queuedEach;
  try {
    return build();
  } finally {
    window.v2Queue.queuedEach = each;
  }
}

beforeEach(() => {
  localStorage.clear();
  realGet = localStorage.getItem;
  reads = 0;
  localStorage.getItem = function (k) {
    if (k === QUEUE) reads++;
    return realGet.apply(localStorage, arguments);
  };
  seed();
});
afterEach(() => {
  localStorage.getItem = realGet;
  delete _workServer[CID];
  delete _workCourseRow[CID];
  _workChanged(CID);
  clearClass(CID);
  localStorage.clear();
});

describe("a signed-in class's work, worked out", () => {
  it('is what the old way gave, from one read of the outbox instead of four', () => {
    reads = 0;
    const old = oldWay();
    expect(reads).toBe(4);
    reads = 0;
    const now = build();
    expect(reads).toBe(1);
    expect(now).toEqual(old);
    // The waiting writes are in it, another teacher's is not.
    expect(now.course.send_work).toBe(true);
    expect(now.assessments.find(a => a.id === AIDS[1]).students_send).toBe('nothing');
    expect(now.submissions.map(s => s.id)).toEqual([
      's1',
      's3',
      'paper:q4:' + IDS[0],
      'paper:q4:' + IDS[2],
      'paper:q8:' + IDS[2],
    ]);
  });

  it('queuedEach gives, for each endpoint, what queued gives', () => {
    const each = window.v2Queue.queuedEach(ENDPOINTS.concat(['save_markup', 'nothing_here']));
    ENDPOINTS.concat(['save_markup', 'nothing_here']).forEach(ep =>
      expect(each[ep]).toEqual(window.v2Queue.queued(ep)),
    );
    // Copies: changing one changes nothing queued.
    each.delete_submission[0].payload.p_submission_id = 'changed';
    expect(window.v2Queue.queued('delete_submission')[0].payload.p_submission_id).toBe('s2');
  });

  it('follows the outbox: a write queued or sent shows at the next view', () => {
    build();
    const q = JSON.parse(realGet.call(localStorage, QUEUE));
    q.entries = q.entries.filter(e => e.id !== 'q3');
    q.entries.push(entry(9, 'delete_submission', { p_submission_id: 's3' }, ME));
    localStorage.setItem(QUEUE, JSON.stringify(q));
    const now = build();
    expect(now).toEqual(oldWay());
    expect(now.submissions.map(s => s.id)).toContain('s2');
    expect(now.submissions.map(s => s.id)).not.toContain('s3');
  });
});
