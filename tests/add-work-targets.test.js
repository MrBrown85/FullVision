/**
 * Add Work for the Class: where each piece goes (B6, docs/plans/add-work-for-class-plan.md).
 *
 * The targets (teacher/add-work-targets.js): one class and one assessment
 * each, with its own staging model. Every test asserts who got which page,
 * in which class, in which assessment, through the data layer's calls as
 * the run makes them (stubbed here, one api per target).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const T = window.AddWorkTargets;

const page = n => ({
  blob: new Blob(['b' + n], { type: 'image/jpeg' }),
  thumb: new Blob(['t' + n], { type: 'image/jpeg' }),
  hash: String(n).padStart(64, 'a'),
  width: 1500,
  height: 2000,
  name: 'scan-' + n + '.jpg',
});
const pages = (...ns) => ns.map(page);
const no = pg => Number(pg.hash.replace(/^a+/, ''));

const A = { cid: 'cA', aid: 'a26', name: 'Block A' };
const B = { cid: 'cB', aid: 'b26', name: 'Block C' };
const LATE = { cid: 'cA', aid: 'a25' };
const listA = [{ id: 'sA1' }, { id: 'sA2' }];
const listB = [{ id: 'sB1' }, { id: 'sB2' }];

// A late paper's assessment: sA2 already has work in it.
const read = (cid, aid) =>
  cid === LATE.cid && aid === LATE.aid
    ? { a: { id: aid, title: '2.5 Vimy Ridge' }, list: listA, subs: { sA2: { files: [{}] } }, name: 'Block A' }
    : null;

function twoClasses() {
  const set = T.create({ ...A, list: listA, subs: {} }, read);
  set.addClass({ ...B, list: listB, subs: { sB2: { on_paper: true } } });
  return set;
}

// The data layer's calls, recorded: "class/assessment/student" → page numbers.
function recorder(answer = () => ({ result: 'sent' })) {
  const got = {};
  const calls = [];
  const apiFor = t => ({
    add: async (sid, pgs, mode) => {
      calls.push(['add', t.cid, t.aid, sid, mode]);
      const res = answer(t, sid);
      if (res.result === 'sent') got[t.cid + '/' + t.aid + '/' + sid] = pgs.map(no);
      return res;
    },
    replace: async (sid, pgs) => {
      calls.push(['replace', t.cid, t.aid, sid]);
      const res = answer(t, sid);
      if (res.result === 'sent') got[t.cid + '/' + t.aid + '/' + sid] = pgs.map(no);
      return res;
    },
    paper: async sids => {
      calls.push(['paper', t.cid, t.aid, ...sids]);
      return { result: 'sent', marked: sids.length, submissions: sids.map(id => ({ enrollment_id: id })) };
    },
  });
  return { got, calls, apiFor };
}

describe('one pile, two classes', () => {
  it('each student’s pages go to their own class’s assessment, and nothing to the other class', async () => {
    const set = twoClasses();
    expect(set.place('sB1', { from: 'Scan, pages 1–2', pages: pages(1, 2) }).ok).toBe(true);
    expect(set.place('sA1', { from: 'Scan, pages 3–4', pages: pages(3, 4) }).ok).toBe(true);
    expect(set.rows().map(r => r.sid)).toEqual(['sA1', 'sA2', 'sB1', 'sB2']);
    expect(set.home('sB1').cid).toBe('cB');
    const r = recorder();
    const out = await T.run(set, r.apiFor);
    expect(r.got).toEqual({ 'cA/a26/sA1': [3, 4], 'cB/b26/sB1': [1, 2] });
    expect(r.calls.filter(c => c[1] === 'cA').map(c => c[3])).toEqual(['sA1']);
    expect(r.calls.filter(c => c[1] === 'cB').map(c => c[3])).toEqual(['sB1']);
    expect(out).toMatchObject({ added: 2, stopped: null });
  });

  it('a student who has work in their own class gets that class’s choices', () => {
    const set = twoClasses();
    set.place('sB2', { from: 'x', pages: pages(1) });
    expect(set.choices('sB2')).toEqual(['replace', 'skip']); // handed in on paper in Block C
    expect(set.row('sB2').choice).toBe('replace');
    expect(set.choices('sA1')).toEqual([]);
  });

  it('a piece moved to a student of the other class goes to that class, and its id is kept', async () => {
    const set = twoClasses();
    const piece = set.place('sA1', { from: 'x', pages: pages(5) }).piece;
    const res = set.move('sA1', 'sB1', piece.id);
    expect(res.ok).toBe(true);
    expect(res.moved[0].id).toBe(piece.id);
    expect(set.row('sA1').pieces).toEqual([]);
    const r = recorder();
    await T.run(set, r.apiFor);
    expect(r.got).toEqual({ 'cB/b26/sB1': [5] });
  });

  it('turning the second class off hands back every piece it held, and its students leave', () => {
    const set = twoClasses();
    set.place('sB1', { from: 'one', pages: pages(1) });
    set.place('sB2', { from: 'two', pages: pages(2, 3) });
    set.place('sA1', { from: 'mine', pages: pages(4) });
    const back = set.removeClass();
    expect(back.map(p => p.from).sort()).toEqual(['one', 'two']);
    expect(set.classes().length).toBe(1);
    expect(set.home('sB1')).toBe(null);
    expect(set.rows().map(r => r.sid)).toEqual(['sA1', 'sA2']);
    expect(set.row('sA1').pieces.map(p => p.from)).toEqual(['mine']);
  });

  it('class_full in one class stops that class only; the other class’s students are still added', async () => {
    const set = twoClasses();
    set.place('sA1', { from: 'a1', pages: pages(1) });
    set.place('sA2', { from: 'a2', pages: pages(2) });
    set.place('sB1', { from: 'b1', pages: pages(3) });
    set.place('sB2', { from: 'b2', pages: pages(4) });
    set.choose('sB2', 'replace');
    // Block A is full from its second student on.
    const r = recorder((t, sid) => (t.cid === 'cA' && sid === 'sA2' ? { result: 'class_full' } : { result: 'sent' }));
    const out = await T.run(set, r.apiFor);
    expect(r.got).toEqual({ 'cA/a26/sA1': [1], 'cB/b26/sB1': [3], 'cB/b26/sB2': [4] });
    expect(out.stopped).toBe('class_full');
    expect(out.said).toBe('Block A: This class has no room for more photos.');
    expect(out.added).toBe(3);
    // Block A's second student keeps their piece, waiting.
    expect(set.row('sA2').pieces.length).toBe(1);
  });

  it('On Paper goes to each student’s own class', async () => {
    const set = twoClasses();
    set.setOnPaper('sA2', true);
    set.setOnPaper('sB1', true);
    const r = recorder();
    await T.run(set, r.apiFor);
    expect(r.calls).toEqual([
      ['paper', 'cA', 'a26', 'sA2'],
      ['paper', 'cB', 'b26', 'sB1'],
    ]);
  });
});

describe('a late paper', () => {
  it('goes to the chosen assessment for that student, and not to the page’s', async () => {
    const set = twoClasses();
    const piece = set.place('sA1', { from: 'Scan, pages 9–10', pages: pages(9, 10) }).piece;
    set.place('sA1', { from: 'Scan, page 11', pages: pages(11) });
    const res = set.setFor('sA1', piece.id, LATE.aid);
    expect(res.ok).toBe(true);
    expect(res.piece.id).toBe(piece.id);
    expect(set.late('sA1').map(x => [x.t.aid, x.piece.id])).toEqual([[LATE.aid, piece.id]]);
    expect(set.row('sA1').pieces.map(p => p.from)).toEqual(['Scan, page 11']);
    const r = recorder();
    await T.run(set, r.apiFor);
    expect(r.got).toEqual({ 'cA/a26/sA1': [11], 'cA/a25/sA1': [9, 10] });
  });

  it('a student added in two targets is counted once; On Paper still counts its own', async () => {
    const set = twoClasses();
    const late = set.place('sA1', { from: 'late', pages: pages(1) }).piece;
    set.setFor('sA1', late.id, LATE.aid);
    set.place('sA1', { from: 'now', pages: pages(2) });
    set.place('sB1', { from: 'b', pages: pages(3) });
    set.setOnPaper('sA2', true);
    const r = recorder();
    const out = await T.run(set, r.apiFor);
    expect(r.got).toEqual({ 'cA/a26/sA1': [2], 'cA/a25/sA1': [1], 'cB/b26/sB1': [3] });
    expect(out).toMatchObject({ added: 2, paper: 1 });
  });

  it('the choices follow what the student has in that assessment', async () => {
    const set = twoClasses();
    const piece = set.place('sA2', { from: 'late', pages: pages(7) }).piece;
    expect(set.choices('sA2')).toEqual([]);
    set.setFor('sA2', piece.id, LATE.aid);
    const t = set.late('sA2')[0].t;
    expect(t.stage.choices('sA2')).toEqual(['add', 'replace', 'skip']);
    t.stage.choose('sA2', 'replace');
    const r = recorder();
    await T.run(set, r.apiFor);
    expect(r.calls).toEqual([['replace', 'cA', 'a25', 'sA2']]);
    expect(r.got).toEqual({ 'cA/a25/sA2': [7] });
  });

  it('a student with only a late paper is still Not In for the page’s assessment, and counts once', () => {
    const set = twoClasses();
    const piece = set.place('sA1', { from: 'late', pages: pages(1) }).piece;
    set.setFor('sA1', piece.id, LATE.aid);
    const c = set.counts();
    expect(c.ready).toBe(1);
    expect(c.notIn).toBe(3); // sA1, sA2, sB1 (sB2 handed in on paper): sA1 is still Not In for 2.6
    set.place('sA1', { from: 'on time', pages: pages(2) });
    expect(set.counts().ready).toBe(1);
    expect(set.buttonLabel()).toBe('Add Work for 1 Student');
  });

  it('back to the page’s assessment, it goes with the rest; an assessment that can’t be had takes nothing', async () => {
    const set = twoClasses();
    const piece = set.place('sA1', { from: 'late', pages: pages(1) }).piece;
    set.setFor('sA1', piece.id, LATE.aid);
    expect(set.setFor('sA1', piece.id, A.aid).ok).toBe(true);
    expect(set.late('sA1')).toEqual([]);
    expect(set.setFor('sA1', piece.id, 'nope')).toEqual({ ok: false, reason: 'not_found' });
    const r = recorder();
    await T.run(set, r.apiFor);
    expect(r.got).toEqual({ 'cA/a26/sA1': [1] });
  });

  it('taking a late piece off, or the student’s every piece, leaves nothing to write', async () => {
    const set = twoClasses();
    const late = set.place('sA1', { from: 'late', pages: pages(1) }).piece;
    set.setFor('sA1', late.id, LATE.aid);
    set.place('sA1', { from: 'now', pages: pages(2) });
    expect(set.takeOff('sA1', late.id).map(p => p.id)).toEqual([late.id]);
    expect(set.takeOff('sA1').map(p => p.from)).toEqual(['now']);
    expect(set.writes()).toEqual([]);
  });
});
