/**
 * Class Settings › Student Page: Send Work and Keep Photos Until (S5-F1,
 * docs/plans/student-page-build-plan.md; board "Teacher: Class Settings,
 * Student Page").
 *
 * - Demo Mode first: the rows are drawn in Demo Mode only, and kept with
 *   its student work (saveDemoStudentWork). A signed-in teacher's class
 *   does not have them (Batch B is not applied) and nothing is asked of
 *   the server.
 * - The line under Keep Photos Until and Delete Photos Now? are Colin's
 *   (ruling 102, s8-f1-wording-draft.md item 1).
 * - Send Work is off until turned on; Keep Photos Until shows only while
 *   it is on, End of Year by default with End of Term offered (Colin).
 * - With the student page off there is no tab, so neither row.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn, seedClass, clearClass, serverSaysStudentPageOn } from './helpers/pin-save-paths.js';

const CID = 'c-sw';
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

describe('Class Settings › Student Page: Send Work', () => {
  var mounts;
  var original;
  var confirms;

  function seed(config) {
    clearClass(CID);
    seedClass(CID, {
      students: [{ id: 's1', firstName: 'Jordan', lastName: 'Reyes' }],
      assessments: [],
      courseConfigs: config,
    });
  }
  function open() {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager('student-page');
  }
  const html = () => mounts.main.innerHTML;
  const card = { dataset: { cid: CID } };
  const at = extra => Object.assign({ closest: sel => (sel === '[data-cid]' ? card : null) }, extra);
  const turn = on => DashClassManager.handleChange(at({ checked: on, dataset: { actionChange: 'spSendWork' } }));
  const keep = value => DashClassManager.handleAction('spKeepPhotos', at({ tagName: 'BUTTON', dataset: { value } }));

  beforeEach(() => {
    localStorage.clear();
    mounts = {
      main: { innerHTML: '' },
      'sidebar-mount': { innerHTML: '', style: {}, removeAttribute() {} },
      'page-toolbar-mount': { innerHTML: '' },
    };
    original = {
      getElementById: document.getElementById,
      setUrl: Router.setUrl,
      pathname: location.pathname,
      useSupabase: _useSupabase,
      isDemoMode: window.isDemoMode,
      showConfirm: globalThis.showConfirm,
    };
    window.isDemoMode = () => true;
    confirms = [];
    globalThis.showConfirm = (title, message, okLabel, okStyle, onConfirm) =>
      confirms.push({ title, message, okLabel, okStyle, onConfirm });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T18:00:00.000Z'));
    document.getElementById = id => mounts[id] || original.getElementById(id);
    Router.setUrl = () => {};
    location.pathname = '/dashboard';
    _useSupabase = false;
    seed(HELD);
  });

  afterEach(() => {
    DashClassManager.resetState();
    document.getElementById = original.getElementById;
    Router.setUrl = original.setUrl;
    location.pathname = original.pathname;
    _useSupabase = original.useSupabase;
    window.isDemoMode = original.isDemoMode;
    globalThis.showConfirm = original.showConfirm;
    vi.useRealTimers();
    clearClass(CID);
  });

  const work = () => JSON.parse(localStorage.getItem('gb-student-work-' + CID));

  it('is off at first, in the board’s words, and Keep Photos Until waits for it', () => {
    open();
    expect(html()).toContain('<label class="sp-row-title" for="sp-send-switch">Send Work</label>');
    expect(html()).toContain(
      '<span class="cm-hint" id="sp-send-hint">Students send photos or files for an assignment you set to take student work.</span>',
    );
    expect(html()).toMatch(/id="sp-send-switch" data-action-change="spSendWork" aria-describedby="sp-send-hint">/);
    expect(html()).not.toContain('Keep Photos Until');
    expect(CmStudentPage.workSettings(CID)).toEqual({
      offered: true,
      send_work: false,
      keep_photos_until: 'end_of_year',
    });
  });

  it('turned on, it is saved and Keep Photos Until shows, End of Year chosen', () => {
    open();
    expect(turn(true)).toBe(true);
    expect(getCourseSendWork(CID).send_work).toBe(true);
    expect(work().course.send_work).toBe(true);
    expect(html()).toMatch(/id="sp-send-switch"[^>]* checked>/);
    expect(html()).toContain('<div class="sp-row-title sp-keep-title" id="sp-keep-label">Keep Photos Until</div>');
    const choices = [...html().matchAll(/id="sp-keep-(\w+)" role="radio" aria-checked="(true|false)"[^>]*>([^<]+)</g)];
    expect(choices.map(m => [m[1], m[2], m[3]])).toEqual([
      ['end_of_term', 'false', 'End of Term'],
      ['end_of_year', 'true', 'End of Year'],
    ]);
    expect(html()).toContain(
      '<div class="cm-hint" id="sp-keep-hint">Photos of student work in this class are deleted on June 30. Grades, comments and Mark Up stay. Deleted photos can&#39;t come back. You&#39;ll get a reminder a week before.</div>',
    );
    // The Return Grades choice is untouched.
    expect(getReturnSettings(CID).return_grades).toBe('on_return');
  });

  it('End of Term is kept, and stays when Send Work is turned off and on again', () => {
    open();
    turn(true);
    expect(keep('end_of_term')).toBe(true);
    expect(CmStudentPage.workSettings(CID).keep_photos_until).toBe('end_of_term');
    turn(false);
    expect(CmStudentPage.workSettings(CID).send_work).toBe(false);
    expect(html()).not.toContain('Keep Photos Until');
    // Not changeable while Send Work is off.
    keep('end_of_year');
    expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
    turn(true);
    expect(html()).toMatch(/id="sp-keep-end_of_term" role="radio" aria-checked="true"/);
    // Anything but the two choices is ignored.
    keep('forever');
    expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
  });

  it('with the student page off there is nothing, and a stray change saves nothing', () => {
    seed({});
    saveDemoStudentWork(CID, { course: { send_work: true } });
    expect(CmStudentPage.workSettings(CID)).toEqual({
      offered: false,
      send_work: false,
      keep_photos_until: 'end_of_year',
    });
    expect(CmStudentPage.render(CID)).toBe('');
    const before = localStorage.getItem('gb-student-work-' + CID);
    CmStudentPage.handleChange(at({ checked: false, dataset: { actionChange: 'spSendWork' } }));
    expect(localStorage.getItem('gb-student-work-' + CID)).toBe(before);
  });

  it('a signed-in teacher has neither row and nothing is sent, even with Send Work on this device', () => {
    saveDemoStudentWork(CID, { course: { send_work: true } });
    window.isDemoMode = () => false;
    const session = signIn();
    serverSaysStudentPageOn(CID);
    try {
      seed(HELD);
      expect(getReturnSettings(CID).student_page).toBe(true);
      expect(CmStudentPage.workSettings(CID).offered).toBe(false);
      expect(CmStudentPage.workSettings(CID).send_work).toBe(false);
      const drawn = CmStudentPage.render(CID);
      expect(drawn).toContain('Return Grades');
      expect(drawn).not.toContain('Send Work');
      expect(drawn).not.toContain('Keep Photos Until');
      CmStudentPage.handleChange(at({ checked: false, dataset: { actionChange: 'spSendWork' } }));
      expect(localStorage.getItem('gb-student-work-' + CID)).toContain('"send_work":true');
      expect(session.sent().filter(c => /send_work|keep_photos/.test(JSON.stringify(c)))).toEqual([]);
    } finally {
      serverSaysStudentPageOn(CID, false);
      session.signOut();
    }
  });

  describe('the day on the line, and a day already gone', () => {
    const terms = ends =>
      seed(
        Object.assign({}, HELD, {
          reportingTerms: ends.map((d, i) => ({
            ordinal: i + 1,
            label: 'Term ' + (i + 1),
            starts_on: '2026-09-02',
            ends_on: d,
          })),
        }),
      );

    it('End of Term is the last day of the term the class is in, or the next to end', () => {
      terms(['2026-11-18', '2027-01-30', '2027-06-24']);
      expect(CmStudentPage.keepPhotosDate(CID, 'end_of_term')).toBe('2026-11-18');
      expect(CmStudentPage.keepPhotosDate(CID, 'end_of_year')).toBe('2027-06-30');
      open();
      turn(true);
      keep('end_of_term');
      expect(confirms).toEqual([]);
      expect(html()).toContain('deleted on November 18. Grades, comments and Mark Up stay.');
      // With no terms, End of Term is June 30 too.
      terms([]);
      expect(CmStudentPage.keepPhotosDate(CID, 'end_of_term')).toBe('2027-06-30');
    });

    it('End of Term with every term ended keeps the photos to June 30, as End of Year, and asks nothing', () => {
      terms(['2026-01-30', '2026-06-24']);
      expect(CmStudentPage.keepPhotosDate(CID, 'end_of_term')).toBe('2027-06-30');
      open();
      turn(true);
      keep('end_of_term');
      expect(confirms).toEqual([]);
      expect(html()).toContain('deleted on June 30.');
    });

    it("End of Term already past (in July) asks first, in Colin's words; Cancel changes nothing", () => {
      vi.setSystemTime(new Date('2027-07-15T18:00:00.000Z'));
      terms(['2027-01-29']);
      open();
      turn(true);
      keep('end_of_term');
      expect(confirms.length).toBe(1);
      const q = confirms[0];
      expect(q.title).toBe('Delete Photos Now?');
      expect(q.message).toBe(
        'End of Term was Jun 30, so this deletes the photos of student work in ' +
          COURSES[CID].name +
          " tonight. Deleted photos can't come back.",
      );
      expect([q.okLabel, q.okStyle]).toEqual(['Delete Photos', 'danger']);
      expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_year');
      q.onConfirm();
      expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
    });
  });
});
