/**
 * work: the tests that were tests/work-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, clearClass, seedClass } from './helpers/pin-save-paths.js';

describe('work-thumbs', () => {
  /**
   * shared/work-thumbs.js (S14-T1): pictures of student work through one
   * helper. Every address comes from openStudentWorkPage; one per file and
   * size is asked for once and kept while an img shows it; an answer that
   * comes after the screen moved on is let go, never drawn.
   */

  let doc;

  let realOpen;
  let asks;
  let released;

  function file(id, path) {
    return { id, page: 1, path: path + '.jpg', thumb_path: path + '-thumb.jpg' };
  }

  // openStudentWorkPage, held by the test: each ask waits until answer().
  function fakeOpen() {
    asks = [];
    released = [];
    globalThis.openStudentWorkPage = (cid, f, which) =>
      new Promise(resolve => {
        const path = which === 'thumb' ? f.thumb_path : f.path;
        asks.push({
          cid,
          id: f.id,
          which,
          answer: () => resolve({ url: '/x/' + path, release: () => released.push(path) }),
          none: () => resolve(null),
        });
      });
  }

  const settle = () => new Promise(r => setTimeout(r, 0));

  function draw(files, which) {
    const root = doc.createElement('div');
    root.innerHTML = files
      .map((f, i) => '<img data-work-pic data-i="' + i + '"' + (which ? ' data-work-which="' + which + '"' : '') + '>')
      .join('');
    doc.body.appendChild(root);
    return root;
  }

  beforeEach(() => {
    doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    realOpen = globalThis.openStudentWorkPage;
    fakeOpen();
  });
  afterEach(() => {
    globalThis.openStudentWorkPage = realOpen;
  });

  describe('WorkThumbs.holder', () => {
    it('asks for each thumbnail once and draws it', async () => {
      const files = [file('a', 'p-a'), file('b', 'p-b')];
      const root = draw(files);
      const pics = WorkThumbs.holder();
      pics.fill(root, 'c1', img => files[Number(img.dataset.i)]);
      expect(asks.map(a => [a.cid, a.id, a.which])).toEqual([
        ['c1', 'a', 'thumb'],
        ['c1', 'b', 'thumb'],
      ]);
      asks.forEach(a => a.answer());
      await settle();
      expect([...root.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual([
        '/x/p-a-thumb.jpg',
        '/x/p-b-thumb.jpg',
      ]);
      expect(pics.held()).toBe(2);
    });

    it('a page opened full size asks for the page, not the thumbnail', () => {
      const files = [file('a', 'p-a')];
      const root = draw(files, 'page');
      WorkThumbs.holder().fill(root, 'c1', () => files[0]);
      expect(asks.map(a => a.which)).toEqual(['page']);
    });

    it('drawing the screen again asks for nothing new', async () => {
      const files = [file('a', 'p-a')];
      const pics = WorkThumbs.holder();
      let root = draw(files);
      pics.fill(root, 'c1', () => files[0]);
      asks[0].answer();
      await settle();
      root.remove();
      root = draw(files);
      pics.fill(root, 'c1', () => files[0]);
      expect(asks.length).toBe(1);
      expect(root.querySelector('img').getAttribute('src')).toBe('/x/p-a-thumb.jpg');
      pics.sweep();
      expect(released).toEqual([]);
    });

    it('a second img waiting on the same file gets the one answer', async () => {
      const files = [file('a', 'p-a'), file('a', 'p-a')];
      const root = draw(files);
      WorkThumbs.holder().fill(root, 'c1', img => files[Number(img.dataset.i)]);
      expect(asks.length).toBe(1);
      asks[0].answer();
      await settle();
      expect([...root.querySelectorAll('img')].every(i => i.getAttribute('src') === '/x/p-a-thumb.jpg')).toBe(true);
    });

    it('an answer after the img left the page is let go, not drawn', async () => {
      const files = [file('a', 'p-a')];
      const root = draw(files);
      const pics = WorkThumbs.holder();
      pics.fill(root, 'c1', () => files[0]);
      const img = root.querySelector('img');
      root.remove();
      asks[0].answer();
      await settle();
      expect(img.getAttribute('src')).toBe(null);
      expect(released).toEqual(['p-a-thumb.jpg']);
      expect(pics.held()).toBe(0);
    });

    it('an answer for work that changed meanwhile is let go, not drawn', async () => {
      let now = file('a', 'p-a');
      const root = draw([now]);
      WorkThumbs.holder().fill(root, 'c1', () => now);
      now = file('a2', 'p-a2'); // replaced while the answer was on its way
      asks[0].answer();
      await settle();
      expect(root.querySelector('img').getAttribute('src')).toBe(null);
      expect(released).toEqual(['p-a-thumb.jpg']);
    });

    it('releaseAll lets go of what is held and of answers still on their way', async () => {
      const files = [file('a', 'p-a'), file('b', 'p-b')];
      const root = draw(files);
      const pics = WorkThumbs.holder();
      pics.fill(root, 'c1', img => files[Number(img.dataset.i)]);
      asks[0].answer();
      await settle();
      pics.releaseAll();
      expect(released).toEqual(['p-a-thumb.jpg']);
      asks[1].answer();
      await settle();
      expect(released).toEqual(['p-a-thumb.jpg', 'p-b-thumb.jpg']);
      expect(root.querySelectorAll('img')[1].getAttribute('src')).toBe(null);
      expect(pics.held()).toBe(0);
    });

    it('an answer asked for before releaseAll does not take the screen drawn after it', async () => {
      const files = [file('a', 'p-a')];
      const pics = WorkThumbs.holder();
      pics.fill(draw(files), 'c1', () => files[0]);
      pics.releaseAll();
      const root = draw(files);
      pics.fill(root, 'c1', () => files[0]);
      expect(asks.length).toBe(2);
      asks[0].answer(); // the old one
      await settle();
      expect(released).toEqual(['p-a-thumb.jpg']);
      expect(root.querySelector('img').getAttribute('src')).toBe(null);
      asks[1].answer();
      await settle();
      expect(root.querySelector('img').getAttribute('src')).toBe('/x/p-a-thumb.jpg');
      expect(pics.held()).toBe(1);
    });

    it('sweep lets go of an address no img shows any more', async () => {
      const files = [file('a', 'p-a'), file('b', 'p-b')];
      const root = draw(files);
      const pics = WorkThumbs.holder();
      pics.fill(root, 'c1', img => files[Number(img.dataset.i)]);
      asks.forEach(a => a.answer());
      await settle();
      root.querySelectorAll('img')[0].remove();
      pics.sweep();
      expect(released).toEqual(['p-a-thumb.jpg']);
      expect(pics.held()).toBe(1);
    });

    it('no address: nothing is drawn and nothing asked', async () => {
      const root = draw([null, { id: 'z' }]);
      WorkThumbs.holder().fill(root, 'c1', img => (img.dataset.i === '0' ? null : { id: 'z' }));
      expect(asks).toEqual([]);
    });

    it('a null answer leaves the img empty', async () => {
      const files = [file('a', 'p-a')];
      const root = draw(files);
      const pics = WorkThumbs.holder();
      pics.fill(root, 'c1', () => files[0]);
      asks[0].none();
      await settle();
      expect(root.querySelector('img').getAttribute('src')).toBe(null);
      expect(pics.held()).toBe(0);
    });

    it('names no server function', async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(new URL('../shared/work-thumbs.js', import.meta.url), 'utf-8');
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase/);
    });
  });
});

describe('work-wall-groups', () => {
  /**
   * S14 follow-up: the Work Wall counts a group once.
   *
   * On a One per Group piece a pair that sent one piece of work is one piece
   * to grade. GraderWork (shared/grader.js) counts it once; the grader, the
   * gradebook, the dashboard and the phone all say so. The wall's To Grade
   * and Not In pills, and the cards its To Grade filter shows, must say the
   * same. Before this change the wall counted the pair as two.
   */

  const CID = U(1);
  const PIECE = U(31);
  const Q = U(41);
  const NAMES = ['Aiden', 'Olivia', 'Ines', 'Marcus', 'Sofia', 'Tom', 'Uma'];
  const S = NAMES.map((_, i) => U(101 + i));
  const [AIDEN, OLIVIA, INES, MARCUS, SOFIA] = S;

  let doc;
  let stubDocument;
  let wasDemo;
  let realPA;

  const text = el => el.textContent.replace(/\s+/g, ' ').trim();
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => [...doc.querySelectorAll(sel)];
  const click = el => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
  const pill = f => $('.ww-pill[data-filter="' + f + '"]');

  function sub(sid, n) {
    return {
      id: 'w' + n,
      assessment_id: PIECE,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: 'student',
      on_paper: false,
      sent_at: '2026-11-03T18:0' + n + ':00Z',
      created_at: '2026-11-03T18:0' + n + ':00Z',
      files: [{ id: 'p' + n, page: 1, path: 'p' + n + '.jpg', thumb_path: 'p' + n + '-thumb.jpg' }],
    };
  }

  // Aiden and Olivia are a pair; Aiden sent for both. Ines, Marcus and Sofia
  // sent their own; Tom and Uma sent nothing.
  function seed({ groupWork = 'group', sender = AIDEN } = {}) {
    seedClass(CID, {
      students: S.map((id, i) => ({ id, firstName: NAMES[i], lastName: String.fromCharCode(65 + i) + 'son' })),
      learningMaps: {
        subjects: [],
        sections: [{ id: U(51), name: 'Light', tags: [{ id: Q, label: 'Refraction', text: 'Bend light' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        {
          id: PIECE,
          title: 'Light Lab',
          tagIds: [Q],
          date: '2026-11-03',
          collaboration: 'pair',
          pairs: [[AIDEN, OLIVIA]],
        },
      ],
      courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
    });
    saveDemoStudentWork(CID, {
      course: { send_work: true },
      assessments: [{ id: PIECE, students_send: 'photos', group_work: groupWork }],
      submissions: [sub(sender, 1), sub(INES, 2), sub(MARCUS, 3), sub(SOFIA, 4)],
    });
    clearProfCache();
  }

  beforeEach(() => {
    localStorage.clear();
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    stubDocument = globalThis.document;
    doc = parseHTML('<!DOCTYPE html><html><body><div id="main"></div></body></html>').document;
    globalThis.document = doc;
    globalThis.requestAnimationFrame = fn => fn();
    realPA = window.PageAssignments;
    window.PageAssignments = { openGrader: () => {}, graderOpen: () => false };
  });
  afterEach(() => {
    WorkWall.close(true);
    window.PageAssignments = realPA;
    globalThis.document = stubDocument;
    clearClass(CID);
    localStorage.clear();
    window.isDemoMode = wasDemo;
  });

  describe('the Work Wall on a pair', () => {
    it("To Grade and Not In are GraderWork's: the pair counts once", () => {
      seed();
      const c = GraderWork.workCounts(CID, PIECE);
      expect([c.tograde, c.groups, c.notin]).toEqual([4, 1, 2]);
      WorkWall.open(CID, PIECE);
      expect(text(pill('tograde'))).toBe('To Grade ' + c.tograde);
      expect(text(pill('notin'))).toBe('Not In ' + c.notin);
      // All still has a card per student.
      expect(text(pill('all'))).toBe('All 7');
      expect($$('.ww-card').length).toBe(7);
    });

    it('the To Grade filter shows a card per piece of work: the pair once, by the one who sent', () => {
      seed();
      WorkWall.open(CID, PIECE);
      click(pill('tograde'));
      const shown = $$('.ww-card').map(el => el.getAttribute('data-sid'));
      expect(shown.length).toBe(GraderWork.workCounts(CID, PIECE).tograde);
      expect(shown).toContain(AIDEN);
      expect(shown).not.toContain(OLIVIA);
      expect(shown).toEqual(expect.arrayContaining([INES, MARCUS, SOFIA]));
    });

    it('the card that stands for the pair is the one with the work, whoever is first by name', () => {
      seed({ sender: OLIVIA });
      WorkWall.open(CID, PIECE);
      click(pill('tograde'));
      const shown = $$('.ww-card').map(el => el.getAttribute('data-sid'));
      expect(shown).toContain(OLIVIA);
      expect(shown).not.toContain(AIDEN);
      expect($('.ww-card[data-sid="' + OLIVIA + '"] img')).not.toBeNull();
    });

    it('a member graded separately is their own piece again, on the wall as in GraderWork', () => {
      seed();
      Grader.gradeSeparately(CID, PIECE, OLIVIA);
      const c = GraderWork.workCounts(CID, PIECE);
      expect(c.tograde).toBe(5);
      WorkWall.open(CID, PIECE);
      expect(text(pill('tograde'))).toBe('To Grade 5');
      click(pill('tograde'));
      expect($$('.ww-card').length).toBe(5);
    });

    it('on Each Student nothing is merged: Olivia sent nothing and is Not In', () => {
      seed({ groupWork: 'each' });
      const c = GraderWork.workCounts(CID, PIECE);
      WorkWall.open(CID, PIECE);
      expect(text(pill('tograde'))).toBe('To Grade ' + c.tograde);
      expect(text(pill('notin'))).toBe('Not In ' + c.notin);
      expect(c.ids.notin).toContain(OLIVIA);
    });
  });
});
