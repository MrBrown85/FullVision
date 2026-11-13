/**
 * The differential run's fake server (scripts/differential/fake-server.js),
 * which runs in every signed-in page of a run over mockAuth's fake client:
 * its call log, the server ids it answers creates with, and the Draft and
 * Returned rows it keeps. Here it runs over a stand-in for that client.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('../scripts/differential/fake-server.js', import.meta.url), 'utf-8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CID = 'c1a55e00-0000-4000-8000-0000000d1ff0';
const AID = 'a5500000-0000-4000-8000-000000000001';
const SID = 'e0000000-0000-4000-8000-000000000001';

function storage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: k => void map.delete(k),
  };
}

/* A page with mockAuth's client as it answers: the bundle with a course row,
   reads and writes with nothing, a write with a 504 while writes fail. */
function page(load = 'load3') {
  const window = { localStorage: storage(), __diffTab: load, __e2eFailWrites: false, under: [] };
  window._supabase = {
    rpc(name, params) {
      window.under.push(name);
      if (name === 'get_class_bundle')
        return Promise.resolve({ data: { gradebook: { course: { id: params.p_course_id } } }, error: null });
      if (!/^(get|list)_/.test(name) && window.__e2eFailWrites) {
        return Promise.resolve({ data: null, error: { message: 'simulated 504 timeout', code: '504' }, status: 504 });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('window', SRC + '\ndifferentialFakeServer();')(window);
  return window;
}

function calls(window) {
  const out = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k.startsWith('__diff-call-')) out.push([k, JSON.parse(window.localStorage.getItem(k))]);
  }
  return out.sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

describe('the call log', () => {
  it('writes every call down as it is made, in order, under the page load', async () => {
    const w = page('load7');
    await w._supabase.rpc('upsert_tag_score', { p_value: 3 });
    await w._supabase.rpc('list_teacher_courses');
    expect(calls(w)).toEqual([
      ['__diff-call-load7-000001', { name: 'upsert_tag_score', params: { p_value: 3 } }],
      ['__diff-call-load7-000002', { name: 'list_teacher_courses', params: null }],
    ]);
    // mockAuth's client still takes each call, so its own log and failures stand.
    expect(w.under).toEqual(['upsert_tag_score', 'list_teacher_courses']);
  });

  it('logs a write that fails, and passes the failure on', async () => {
    const w = page();
    w.__e2eFailWrites = true;
    const res = await w._supabase.rpc('create_assessment', { p_idempotency_key: 'k1' });
    expect(res.error.code).toBe('504');
    expect(res.data).toBeNull();
    expect(calls(w)).toHaveLength(1);
  });
});

describe('server ids', () => {
  it('answers a create with an id the app takes for a server id, the same for the same key', async () => {
    const a = page('load1');
    const b = page('load9');
    const one = (await a._supabase.rpc('create_assessment', { p_idempotency_key: 'k1', p_title: 'Quiz' })).data;
    const again = (await b._supabase.rpc('create_assessment', { p_idempotency_key: 'k1', p_title: 'Quiz' })).data;
    const other = (await a._supabase.rpc('create_assessment', { p_idempotency_key: 'k2', p_title: 'Quiz' })).data;
    expect(one).toMatch(UUID);
    expect(again).toBe(one);
    expect(other).toMatch(UUID);
    expect(other).not.toBe(one);
  });

  it('answers a new student with a person and an enrollment, keeping a person the server knows', async () => {
    const w = page();
    const made = (await w._supabase.rpc('create_student_and_enroll', { p_idempotency_key: 'k3' })).data;
    expect(made.student_id).toMatch(UUID);
    expect(made.enrollment_id).toMatch(UUID);
    expect(made.enrollment_id).not.toBe(made.student_id);
    const known = 'f0000000-0000-4000-8000-000000000009';
    const kept = (
      await w._supabase.rpc('create_student_and_enroll', { p_idempotency_key: 'k4', p_existing_student_id: known })
    ).data;
    expect(kept.student_id).toBe(known);
  });

  it('answers a category save with the ids in list order, new ones made', async () => {
    const w = page();
    const has = 'ca700000-0000-4000-8000-000000000001';
    const ids = (
      await w._supabase.rpc('save_categories', {
        p_idempotency_key: 'k5',
        p_categories: [{ id: has, name: 'Tests' }, { name: 'Labs' }, { name: 'Projects' }],
      })
    ).data;
    expect(ids[0]).toBe(has);
    expect(ids[1]).toMatch(UUID);
    expect(ids[2]).toMatch(UUID);
    expect(ids[1]).not.toBe(ids[2]);
  });

  it('leaves any other write answered with nothing', async () => {
    const w = page();
    expect(await w._supabase.rpc('upsert_tag_score', { p_value: 3 })).toEqual({ data: null, error: null });
  });
});

describe('Draft and Returned rows', () => {
  let w;
  const rows = () => w._supabase.rpc('list_course_grade_returns', { p_course_id: CID }).then(r => r.data);
  const device = value => w.localStorage.setItem('gb-grade-returns-' + CID, JSON.stringify(value));
  beforeEach(() => {
    w = page();
    w.localStorage.setItem(
      '__diff-srv-course-' + CID,
      JSON.stringify({ student_page_enabled: true, return_grades: 'on_return', send_work: true }),
    );
  });

  it('has no rows until a write lands, then the rows the device held when it landed', async () => {
    device({ [AID]: { [SID]: { is_draft: true } } });
    expect(await rows()).toEqual({});
    await w._supabase.rpc('upsert_tag_score', { p_enrollment_id: SID, p_assessment_id: AID, p_value: 3 });
    expect(await rows()).toEqual({ [AID]: { [SID]: { is_draft: true } } });
    // A change on the device alone is not the server's.
    device({});
    expect(await rows()).toEqual({ [AID]: { [SID]: { is_draft: true } } });
  });

  it('keeps its rows when a write fails', async () => {
    await w._supabase.rpc('upsert_tag_score', {});
    device({ [AID]: { [SID]: { is_draft: true } } });
    w.__e2eFailWrites = true;
    await w._supabase.rpc('upsert_tag_score', {});
    expect(await rows()).toEqual({});
  });

  it('answers a Return as live, and refuses one when told to, keeping its rows', async () => {
    device({ [AID]: { [SID]: { is_draft: true } } });
    await w._supabase.rpc('upsert_tag_score', {});
    device({ [AID]: { [SID]: { is_draft: false, returned_at: '2026-10-15T15:00:00.000Z' } } });
    w.__diffRefuseReturns = 1;
    const no = await w._supabase.rpc('return_work', { p_assessment_id: AID, p_enrollment_ids: [SID] });
    expect(no.error.code).toBe('42501');
    expect(no.status).toBe(403);
    expect(await rows()).toEqual({ [AID]: { [SID]: { is_draft: true } } });
    const yes = await w._supabase.rpc('return_work', { p_assessment_id: AID, p_enrollment_ids: [SID] });
    expect(yes.error).toBeNull();
    expect(yes.data).toMatchObject({ returned: 1, enrollment_ids: [SID] });
    expect((await rows())[AID][SID].is_draft).toBe(false);
  });

  it('puts the student page, Return Grades and Send Work on the bundle’s course row', async () => {
    const res = await w._supabase.rpc('get_class_bundle', { p_course_id: CID });
    expect(res.data.gradebook.course).toMatchObject({
      id: CID,
      student_page_enabled: true,
      return_grades: 'on_return',
      send_work: true,
    });
    await w._supabase.rpc('set_course_send_work', { p_course_id: CID, p_patch: { send_work: false } });
    const next = await w._supabase.rpc('get_class_bundle', { p_course_id: CID });
    expect(next.data.gradebook.course.send_work).toBe(false);
    expect((await w._supabase.rpc('list_course_submissions', { p_course_id: CID })).data.course.send_work).toBe(false);
  });

  it('makes a revision request once, lists it, and takes it back', async () => {
    const ask = { p_assessment_id: AID, p_enrollment_id: SID, p_request: { what_to_fix: 'Show your working.' } };
    const made = (await w._supabase.rpc('return_for_revision', { ...ask, p_idempotency_key: 'r1' })).data;
    expect(made.result).toBe('made');
    expect(made.request.id).toMatch(UUID);
    const twice = (await w._supabase.rpc('return_for_revision', { ...ask, p_idempotency_key: 'r2' })).data;
    expect(twice).toMatchObject({ result: 'already_open', request: { id: made.request.id } });
    const listed = (await w._supabase.rpc('list_course_feedback', { p_course_id: CID })).data.revisions;
    expect(listed.map(r => [r.id, r.state])).toEqual([[made.request.id, 'open']]);
    const back = (await w._supabase.rpc('cancel_revision', { p_request_id: made.request.id })).data;
    expect(back.result).toBe('cancelled');
    expect((await w._supabase.rpc('cancel_revision', { p_request_id: made.request.id })).data.result).toBe('not_open');
  });
});
