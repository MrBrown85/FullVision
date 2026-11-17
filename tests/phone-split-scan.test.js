/**
 * Split a Scan on the phone (Add Work for the Class, B7): the parts with no
 * DOM (teacher-mobile/split-scan-model.js). The scan's model, the
 * name matching, the staging and the run are the desktop's own modules,
 * tested in tests/add-work-split.test.js and tests/add-work-class.test.js;
 * here, what the phone adds: which assessment comes first, what Return in
 * a name box takes, the named pieces staged on their students, and the
 * pieces that leave the scan once their students' work is added.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = rel => runInThisContext(readFileSync(resolve(root, rel), 'utf-8'), { filename: rel });

beforeAll(() => {
  load('teacher-mobile/split-scan-model.js');
});

const fakePage = n => ({
  blob: new Blob(['b' + n], { type: 'image/jpeg' }),
  thumb: new Blob(['t' + n], { type: 'image/jpeg' }),
  hash: String(n).padStart(64, 'a'),
  width: 1545,
  height: 2000,
  name: 'page-' + n + '.jpg',
  page: n,
});
const scan = (n, blank = []) =>
  Array.from({ length: n }, (_, i) => ({ page: fakePage(i + 1), blank: blank.indexOf(i + 1) >= 0 }));

const CLASS = [
  { id: 's1', firstName: 'Avery', lastName: 'Chen' },
  { id: 's2', firstName: 'Liam', lastName: 'Chen' },
  { id: 's3', firstName: 'Zoë', lastName: 'Okafor' },
  { id: 's4', firstName: 'Theodore', lastName: 'Nguyen', preferred: 'Theo' },
];

// The globals the model reads, swapped for the test and put back after.
const swapped = {};
function swap(name, value) {
  if (!(name in swapped)) swapped[name] = globalThis[name];
  globalThis[name] = value;
}
afterEach(() => {
  Object.keys(swapped).forEach(k => {
    globalThis[k] = swapped[k];
    delete swapped[k];
  });
});

const M = () => window.MSplitScanModel;

describe('Return in a name box', () => {
  it('takes a student only when the letters fit exactly one', () => {
    expect(M().typed(CLASS, 'Ave')).toBe('s1');
    expect(M().typed(CLASS, 'zoe')).toBe('s3');
    expect(M().typed(CLASS, 'Theo')).toBe('s4');
  });
  it('takes no one when two or more fit', () => {
    expect(M().typed(CLASS, 'Chen')).toBe('');
    expect(M().typed(CLASS, 'c')).toBe('');
  });
  it('takes no one for an empty box or letters that fit nobody', () => {
    expect(M().typed(CLASS, '')).toBe('');
    expect(M().typed(CLASS, '   ')).toBe('');
    expect(M().typed(CLASS, 'Xavier')).toBe('');
  });
});

describe('which assessment comes first', () => {
  beforeEach(() => {
    const pieces = [
      { id: 'a1', title: 'Old Lab', date: '2026-10-01' },
      { id: 'a2', title: 'Draft', date: '2026-11-20', isDraft: true },
      { id: 'a3', title: 'Essay', date: '2026-11-14' },
      { id: 'a4', title: 'Quiz', date: '2026-11-07' },
      { id: 'a5', title: 'No Work Here', date: '2026-11-15' },
    ];
    // Work in: a1 from nobody, a3 from one, a4 from nobody.
    const subs = { a3: { s1: {} } };
    swap('getAssessments', () => pieces);
    swap('getStudentSubmission', (cid, sid, aid) => (subs[aid] && subs[aid][sid]) || null);
    swap('AddWorkClass', {
      offered: (cid, a) => !a.isDraft && a.id !== 'a5',
      students: () => CLASS,
    });
  });

  it('lists only the pieces the desktop offers it on, most Not In first, then the latest due', () => {
    const list = M().assessments('c1');
    expect(list.map(r => r.a.id)).toEqual(['a4', 'a1', 'a3']);
    expect(list.map(r => r.notIn)).toEqual([4, 4, 3]);
    expect(list[0].students).toBe(4);
  });
});

describe('the named pieces staged on their students', () => {
  it('places each named piece, in order, with its pages renamed; a student with work gets the default choice', () => {
    swap('getStudentSubmission', (cid, sid) =>
      sid === 's2' ? { files: [{}] } : sid === 's3' ? { on_paper: true } : null,
    );
    const m = window.AddWorkSplitModel.model(scan(8, [4]), CLASS);
    m.setPer(2);
    // Pieces: [1,2] [3,5] (4 left out) [6,7] [8]
    expect(m.pieces().map(p => p.nos)).toEqual([[1, 2], [3, 5], [6, 7], [8]]);
    m.name(0, 's2');
    m.name(1, 's1');
    m.name(2, 's3');
    const built = M().stageFor('c1', 'a1', m, CLASS, { s3: 'skip' });
    const st = built.stage;
    expect(built.placed).toEqual(['s2', 's1', 's3']);
    expect(st.row('s1').pieces[0].pages.map(p => p.hash)).toEqual([fakePage(3).hash, fakePage(5).hash]);
    expect(st.row('s1').pieces[0].pages.map(p => p.name)).toEqual(['page-1.jpg', 'page-2.jpg']);
    expect(st.row('s2').choice).toBe('add');
    expect(st.row('s3').choice).toBe('skip');
    expect(st.row('s4').pieces).toEqual([]);
    // The first page of each staged piece, for its picture.
    expect(Object.values(built.firsts).sort()).toEqual([1, 3, 6]);
    // The writes: s1 new, s2 add; s3 skipped.
    expect(st.writes().map(w => [w.sid, w.kind, w.mode])).toEqual([
      ['s1', 'add', 'new'],
      ['s2', 'add', 'add'],
    ]);
  });
});

describe('after Add Work', () => {
  it('takes only the added students’ pieces off the scan; the others keep their names', () => {
    const m = window.AddWorkSplitModel.model(scan(8, [4]), CLASS);
    m.setPer(2);
    m.name(0, 's2');
    m.name(1, 's1');
    m.name(2, 's3');
    const gone = M().settle(m, { s1: true, s3: true });
    // s1's piece took the blank page between its pages with it.
    expect(gone).toEqual([3, 4, 5, 6, 7]);
    expect(m.pieces().map(p => [p.nos, p.sid])).toEqual([
      [[1, 2], 's2'],
      [[8], ''],
    ]);
  });
  it('changes nothing when no one was added', () => {
    const m = window.AddWorkSplitModel.model(scan(4), CLASS);
    m.setPer(2);
    m.name(0, 's1');
    expect(M().settle(m, {})).toEqual([]);
    expect(m.pieces().map(p => [p.nos, p.sid])).toEqual([
      [[1, 2], 's1'],
      [[3, 4], ''],
    ]);
  });
});
