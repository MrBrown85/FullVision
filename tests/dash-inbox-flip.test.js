/**
 * Flip Through's model (teacher/dash-inbox-flip.js; D7 of
 * docs/plans/dashboard-inbox-plan.md): the order of the stage, the caption's
 * parts, paging within a student's pages, clamping at both ends, the centre
 * held by student, and the piece switch starting the centre again. The
 * sample class (Science 8) with Send Work on.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1'; // Cell Microscope Lab: all returned; Noor and Fatima two pages, Mateo added, Ethan on paper
const LIGHT = 'sci8a21'; // Light Refraction Lab: work waiting; Marcus late
let wasDemo;

describe('Flip Through, Science 8 with Send Work on', () => {
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  });
  afterAll(() => {
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
  });
  beforeEach(() => {
    window.isDemoMode = () => true;
    Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
    localStorage.clear();
    CURRICULUM_INDEX = newBankIndex(['SCI8']);
    seedIfNeeded();
    setStudentPageSwitch(CID, true, 'on_return');
    const work = getCourseSubmissions(CID);
    work.course.send_work = true;
    saveDemoStudentWork(CID, work);
    DashInboxFlip.reset();
    delete window.DashInboxPick;
  });
  afterEach(() => {
    delete window.DashInboxPick;
  });

  const ids = () => getStudents(CID).map(s => s.id);
  const find = (list, name) => list.find(e => e.name === name);

  it('registers as a view of the Inbox', () => {
    const v = DashInbox.viewOf(CID);
    expect(v).toBeTruthy();
    DashInbox.setView(CID, 'flip');
    expect(DashInbox.viewOf(CID).key).toBe('flip');
    expect(DashInbox.viewOf(CID).label).toBe('Flip Through');
    expect(DashInbox.viewOf(CID).hint).toBe("One student's work at a time, large.");
  });

  it("lists the students with work in, and every state is GraderWork's", () => {
    for (const aid of [LAB, LIGHT]) {
      const list = DashInboxFlip.entries(CID, aid);
      const c = GraderWork.workCounts(CID, aid, ids());
      expect(list.length).toBeGreaterThan(0);
      list.forEach(e => {
        const k = ['tograde', 'toreturn', 'returned'].find(k => c.ids[k].includes(e.sid));
        expect(e.state).toBe(k || 'started');
        expect(e.waiting).toBe(k === 'tograde');
      });
      // Nobody not in is listed.
      list.forEach(e => expect(c.ids.notin).not.toContain(e.sid));
      expect(list.length).toBeLessThanOrEqual(GraderWork.workInIds(CID, aid, ids()).length);
    }
  });

  it('puts work to grade first, then the rest, each in the order the work came in', () => {
    const list = DashInboxFlip.entries(CID, LIGHT);
    const firstDone = list.findIndex(e => !e.waiting);
    expect(list[0].waiting).toBe(true);
    if (firstDone >= 0) expect(list.slice(firstDone).every(e => !e.waiting)).toBe(true);
    const at = e => Date.parse(e.at);
    const waiting = list.filter(e => e.waiting);
    for (let i = 1; i < waiting.length; i++) expect(at(waiting[i])).toBeGreaterThanOrEqual(at(waiting[i - 1]));
    const rest = list.filter(e => !e.waiting);
    for (let i = 1; i < rest.length; i++) expect(at(rest[i])).toBeGreaterThanOrEqual(at(rest[i - 1]));
    // Marcus Lee is the one sent in late.
    expect(find(list, 'Marcus Lee').late).toBe(true);
  });

  it('says what is true of the student in the caption', () => {
    const list = DashInboxFlip.entries(CID, LAB);
    const mateo = DashInboxFlip.caption(CID, find(list, 'Mateo Cruz'), 0);
    expect(mateo.added).toBe(true);
    expect(mateo.onPaper).toBe(false);
    expect(mateo.pagesText).toBe('1 page');
    expect(mateo.pager).toBeNull();
    expect(mateo.label).toBe('Open');

    const ethan = DashInboxFlip.caption(CID, find(list, 'Ethan Dubois'), 0);
    expect(ethan.onPaper).toBe(true);
    expect(ethan.pagesText).toBe('');
    expect(find(list, 'Ethan Dubois').pages).toBe(0);

    const fatima = DashInboxFlip.caption(CID, find(list, 'Fatima Hassan'), 1);
    expect(fatima.late).toBe(true);
    expect(fatima.pager).toEqual({ page: 2, of: 2 });
    expect(fatima.pagesText).toBe('');
    expect(fatima.when).toBeTruthy();

    // Work waiting says Grade Submissions.
    const waiting = DashInboxFlip.entries(CID, LIGHT).find(e => e.waiting);
    expect(DashInboxFlip.caption(CID, waiting, 0).label).toBe('Grade Submissions');
  });

  it("pages through one student's work in place, stopping at the first and the last", () => {
    const list = DashInboxFlip.entries(CID, LAB);
    const st = DashInboxFlip.stateOf(CID, LAB);
    const noor = find(list, 'Noor Al-Rashid');
    expect(noor.pages).toBe(2);
    expect(DashInboxFlip.pageOf(st, noor)).toBe(0);
    expect(DashInboxFlip.turn(st, noor, -1)).toBe(0);
    expect(DashInboxFlip.turn(st, noor, 1)).toBe(1);
    expect(DashInboxFlip.turn(st, noor, 1)).toBe(1);
    expect(DashInboxFlip.pageOf(st, noor)).toBe(1);
    expect(DashInboxFlip.turn(st, noor, -1)).toBe(0);
    // One page, or none: nothing to turn.
    expect(DashInboxFlip.turn(st, find(list, 'Mateo Cruz'), 1)).toBe(0);
    expect(DashInboxFlip.turn(st, find(list, 'Ethan Dubois'), 1)).toBe(0);
    // Another student's page is their own.
    expect(DashInboxFlip.pageOf(st, find(list, 'Fatima Hassan'))).toBe(0);
  });

  it('moves the centre and stops at both ends', () => {
    const list = DashInboxFlip.entries(CID, LAB);
    const st = DashInboxFlip.stateOf(CID, LAB);
    expect(DashInboxFlip.centreOf(st, list)).toBe(0);
    expect(DashInboxFlip.move(st, list, -1)).toBe(0);
    expect(DashInboxFlip.move(st, list, 1)).toBe(1);
    expect(DashInboxFlip.moveTo(st, list, 4)).toBe(4);
    expect(st.sid).toBe(list[4].sid);
    expect(DashInboxFlip.moveTo(st, list, 999)).toBe(list.length - 1);
    expect(DashInboxFlip.move(st, list, 1)).toBe(list.length - 1);
    expect(DashInboxFlip.moveTo(st, list, -5)).toBe(0);
  });

  it('holds the centre by student, so work coming in moves nobody', () => {
    const list = DashInboxFlip.entries(CID, LAB);
    const st = DashInboxFlip.stateOf(CID, LAB);
    DashInboxFlip.moveTo(st, list, 3);
    const who = list[3].sid;
    // The list changes order: the same student is still the centre.
    const shuffled = list.slice().reverse();
    expect(shuffled[DashInboxFlip.centreOf(st, shuffled)].sid).toBe(who);
    // The student leaves the list: the place held is kept, in range.
    const gone = list.filter(e => e.sid !== who).slice(0, 2);
    expect(DashInboxFlip.centreOf(st, gone)).toBe(1);
  });

  it('shows the first piece with work in when the switch is not there, and the switch otherwise', () => {
    const model = DashInboxModel.build(CID, { seen: null });
    expect(DashInboxFlip.chosen(CID, model)).toBe(model.pieces.filter(p => p.in > 0)[0].aid);
    window.DashInboxPick = { current: () => LIGHT, html: () => '', mount() {}, unmount() {}, pieces: () => [] };
    expect(DashInboxFlip.chosen(CID, model)).toBe(LIGHT);
    // A piece the model does not list falls back to the first.
    window.DashInboxPick = { current: () => 'nope', html: () => '', mount() {}, unmount() {}, pieces: () => [] };
    expect(DashInboxFlip.chosen(CID, model)).toBe(model.pieces.filter(p => p.in > 0)[0].aid);
    // The switch has nothing to say yet: the first.
    window.DashInboxPick = { current: () => null, html: () => '', mount() {}, unmount() {}, pieces: () => [] };
    expect(DashInboxFlip.chosen(CID, model)).toBe(model.pieces.filter(p => p.in > 0)[0].aid);
  });

  it('a piece switch starts the centre again, and its pages', () => {
    const lab = DashInboxFlip.entries(CID, LAB);
    const st = DashInboxFlip.stateOf(CID, LAB);
    DashInboxFlip.moveTo(st, lab, 5);
    DashInboxFlip.turn(st, find(lab, 'Noor Al-Rashid'), 1);
    const other = DashInboxFlip.stateOf(CID, LIGHT);
    expect(other.sid).toBeNull();
    expect(other.idx).toBe(0);
    expect(other.pages).toEqual({});
    // Back on the first piece, it starts at the first student too.
    expect(DashInboxFlip.stateOf(CID, LAB).sid).toBeNull();
  });

  it('draws the stage: one button a student, the centre named with what it does, a labelled slider', () => {
    DashInbox.setView(CID, 'flip');
    const model = DashInboxModel.build(CID, { seen: null });
    const html = DashInboxFlip.html(CID, model);
    const list = DashInboxFlip.entries(CID, DashInboxFlip.chosen(CID, model));
    expect((html.match(/dash-inbox-flip-pg/g) || []).length).toBeGreaterThanOrEqual(list.length);
    expect(html).toContain('aria-label="' + list[0].name + ', Open"');
    expect(html).toContain('aria-label="Student 1 of ' + list.length + '"');
    expect(html).toContain('aria-roledescription="carousel"');
    // No switch of the other builder's: none drawn.
    expect(html).not.toContain('dash-inbox-flip-pick');
    // Pages off the stage are marked, and carry no picture.
    expect(html).toContain('is-off');
    const imgs = (html.match(/<img /g) || []).length;
    expect(imgs).toBeLessThanOrEqual(2 * DashInboxFlip.WINDOW + 1);
  });

  it('draws the switch above the stage when there is one', () => {
    window.DashInboxPick = {
      current: () => null,
      html: () => '<button type="button">Cell Microscope Lab · 10 In</button>',
      mount() {},
      unmount() {},
      pieces: () => [],
    };
    const html = DashInboxFlip.html(CID, DashInboxModel.build(CID, { seen: null }));
    expect(html).toContain('id="dash-inbox-flip-pick"');
    expect(html.indexOf('dash-inbox-flip-pick')).toBeLessThan(html.indexOf('dash-inbox-flip-stage'));
  });

  it('says so, in a sentence, when the piece has no work in', () => {
    window.DashInboxPick = { current: () => 'sci8a2', html: () => '', mount() {}, unmount() {}, pieces: () => [] };
    const model = DashInboxModel.build(CID, { seen: null });
    // A piece listed with nothing in has an empty stage.
    const empty = DashInboxFlip.entries(CID, 'sci8a-none');
    expect(empty).toEqual([]);
    const html = DashInboxFlip.html(CID, { pieces: [] });
    expect(html).toContain('No work in yet');
    expect(model.on).toBe(true);
  });

  it('escapes a name with markup in it', () => {
    const st = getStudents(CID).find(s => s.id === find(DashInboxFlip.entries(CID, LAB), 'Cece Adeyemi').sid);
    const was = st.firstName;
    st.firstName = '<img src=x onerror=1>';
    st.preferred = '';
    const html = DashInboxFlip.html(CID, DashInboxModel.build(CID, { seen: null }));
    st.firstName = was;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
