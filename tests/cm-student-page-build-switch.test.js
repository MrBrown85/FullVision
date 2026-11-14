/**
 * The Student Page switch in Class Settings (S0-W1,
 * docs/plans/student-page-build-plan.md). Off by default for every class.
 *
 * - Every class has the Student Page tab, and the switch is drawn on it for
 *   every teacher, as a Student Page switch in a card of its own (Colin,
 *   Nov 13: no hidden build address).
 * - A class whose student page is off has the switch alone on the tab.
 * - Turning it on changes that one setting. In Demo Mode at once; signed
 *   in, the server is asked first and the class is on only when it has
 *   answered. The class's Return Grades choice is left as it is, and is
 *   not sent.
 * - Turning it off is leaving When I Return Them: with grades waiting it
 *   asks first, in the words Class Settings already uses (DECISIONS,
 *   Student page build rulings 8); Cancel changes nothing. Signed in, the
 *   number is the server's, and with no number it is not turned off.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass, settle, serverSaysStudentPageOn } from './helpers/pin-save-paths.js';

const CID = 'c-build';
const LIVE = U(1);
const SIX = ['details', 'students', 'questionnaires', 'grading', 'terms', 'competencies'];
const SEVEN = ['details', 'students', 'questionnaires', 'student-page', 'grading', 'terms', 'competencies'];
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

const STUDENTS = ['s1', 's2'].map((id, i) => ({ id, firstName: ['Jordan', 'Avery'][i], lastName: 'Test' }));
const ASSESSMENTS = [{ id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1'] }];
const LIVE_STUDENTS = [U(11), U(12)].map((id, i) => ({ id, firstName: ['Jordan', 'Avery'][i], lastName: 'Test' }));
const LIVE_ASSESSMENTS = [{ id: U(31), title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: [U(51)] }];

describe('Class Settings: the student page’s build switch', () => {
  let mounts;
  let confirms;
  let original;

  function seed(cid, config) {
    clearClass(cid);
    seedClass(cid, {
      students: cid === LIVE ? LIVE_STUDENTS : STUDENTS,
      assessments: structuredClone(cid === LIVE ? LIVE_ASSESSMENTS : ASSESSMENTS),
      courseConfigs: config || {},
    });
  }
  function open(cid, tab) {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid || CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager(tab || 'student-page');
  }
  const html = () => mounts.main.innerHTML;
  const tabIds = () => [...html().matchAll(/data-action="cmSetTab" data-tab="([^"]+)"/g)].map(m => m[1]);
  const activeTab = () => (html().match(/class="cm-tab active"[^>]*data-tab="([^"]+)"/) || [])[1] || null;
  // The switch as drawn: null when it is not, else whether it is on.
  function switchDrawn() {
    const m = html().match(
      /<input type="checkbox" role="switch" id="sp-build-switch" data-action-change="spBuildSwitch"( checked)?(?: disabled)?>/,
    );
    return m ? !!m[1] : null;
  }
  // The teacher flips the switch: the page's change handler hands it over.
  function flip(cid, on) {
    const el = {
      tagName: 'INPUT',
      checked: on,
      dataset: { actionChange: 'spBuildSwitch' },
      closest: sel => (sel === '[data-cid]' ? { dataset: { cid: cid } } : null),
    };
    const handled = DashClassManager.handleChange(el);
    return { handled, el };
  }
  const stored = cid => localStorage.getItem('gb-courseconfig-' + cid);

  beforeEach(() => {
    localStorage.clear();
    mounts = {
      main: { innerHTML: '' },
      'sidebar-mount': { innerHTML: '', style: {}, removeAttribute() {} },
      'page-toolbar-mount': { innerHTML: '' },
    };
    confirms = [];
    original = {
      getElementById: document.getElementById,
      setUrl: Router.setUrl,
      pathname: location.pathname,
      search: location.search,
      showConfirm: globalThis.showConfirm,
      useSupabase: _useSupabase,
    };
    document.getElementById = id => mounts[id] || original.getElementById(id);
    Router.setUrl = () => {};
    location.pathname = '/dashboard';
    globalThis.showConfirm = (title, message, okLabel, okStyle, onConfirm) =>
      confirms.push({ title, message, okLabel, okStyle, onConfirm });
    _useSupabase = false;
    StudentCards._reset();
  });

  afterEach(() => {
    DashClassManager.resetState();
    document.getElementById = original.getElementById;
    Router.setUrl = original.setUrl;
    location.pathname = original.pathname;
    location.search = original.search;
    globalThis.showConfirm = original.showConfirm;
    _useSupabase = original.useSupabase;
    CmStudentPage._reset();
    StudentCards._reset();
    clearClass(CID);
    clearClass(LIVE);
  });

  it('whatever the address, every class has the tab, with the switch on it', () => {
    ['', '?manage=student-page', '?build=student-page'].forEach(search => {
      seed(CID, {});
      location.search = search;
      CmStudentPage._reset();
      open(CID);
      expect(tabIds(), search).toEqual(SEVEN);
      expect(switchDrawn(), search).toBe(false);
    });
    seed(CID, HELD);
    open(CID);
    expect(switchDrawn()).toBe(true);
  });

  it('the switch is on the Student Page tab only', () => {
    seed(CID, { return_grades: 'on_return' });
    open(CID);
    SIX.forEach(tab => {
      DashClassManager.handleAction('cmSetTab', { tagName: 'BUTTON', dataset: { tab: tab } });
      expect(html(), tab).not.toContain('sp-build');
      expect(html(), tab).not.toContain('spBuildSwitch');
    });
  });

  describe('the switch', () => {
    it('a class with its student page off has the tab, with the switch alone on it, off', () => {
      seed(CID, {});
      const before = stored(CID);
      open(CID);
      expect(tabIds()).toEqual(SEVEN);
      expect(activeTab()).toBe('student-page');
      expect(switchDrawn()).toBe(false);
      expect(html()).toContain('<label class="cm-label" for="sp-build-switch">Student Page</label>');
      expect(html()).toContain('Off for this class. Turn it on to give students a card that opens their own page.');
      expect(html()).not.toContain('sp-card');
      expect(html()).not.toContain('Return Grades');
      expect(html()).not.toContain('sc-card');
      // Looking saves nothing.
      expect(stored(CID)).toBe(before);
    });

    it('a class that does not exist has no tab', () => {
      expect(CmStudentPage.isShown('no-such-class')).toBe(false);
      expect(CmStudentPage.isShown(undefined)).toBe(false);
    });

    it('turned on: the setting is saved, and Return Grades and Student Cards are there with no choice made', () => {
      seed(CID, {});
      open(CID);
      expect(flip(CID, true).handled).toBe(true);
      expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: null });
      expect(JSON.parse(stored(CID))).toEqual({ student_page_enabled: true });
      expect(switchDrawn()).toBe(true);
      expect(html()).toContain('On for this class: grades are Draft or Returned, and students can have cards.');
      expect(html()).toContain('sp-card');
      expect(html()).toContain('sc-card');
      // The switch's card comes first.
      expect(html().indexOf('sp-build')).toBeLessThan(html().indexOf('sp-card'));
      // No choice made yet: the tab says so, as it does for any class from before the setting.
      expect(html()).toContain('id="sp-return-unset"');
      expect(confirms).toEqual([]);
    });

    it('turned on keeps a Return Grades choice the class already holds', () => {
      seed(CID, { return_grades: 'on_return' });
      open(CID);
      flip(CID, true);
      expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    });

    it('turned off with nothing waiting: saved at once, and the tab keeps only the switch', () => {
      seed(CID, HELD);
      open(CID);
      expect(switchDrawn()).toBe(true);
      expect(flip(CID, false).handled).toBe(true);
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID)).toEqual({ student_page: false, return_grades: 'on_return' });
      expect(switchDrawn()).toBe(false);
      expect(html()).not.toContain('sp-card');
      expect(html()).not.toContain('sc-card');
    });

    it('turned off with grades waiting: asks first, in Class Settings’ words; Cancel changes nothing', () => {
      seed(CID, HELD);
      Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
      Grader.setLevel(CID, 's2', 'essay', 't1', 2, 0);
      open(CID);
      const before = { config: stored(CID), rows: localStorage.getItem('gb-grade-returns-' + CID) };
      const { el } = flip(CID, false);
      expect(confirms.length).toBe(1);
      expect(confirms[0]).toMatchObject({
        title: 'Return 2 Grades Now?',
        message: '2 grades are waiting as drafts. Changing this returns them to students now.',
        okLabel: 'Return and Change',
        okStyle: 'primary',
      });
      // Still on while it asks, on the screen and in the class.
      expect(el.checked).toBe(true);
      expect(getReturnSettings(CID).student_page).toBe(true);
      expect(stored(CID)).toBe(before.config);
      expect(localStorage.getItem('gb-grade-returns-' + CID)).toBe(before.rows);
      expect(GradeState.draftsWaiting(CID)).toBe(2);
      // Cancel is never answering: nothing changes.
      DashClassManager.renderClassManager();
      expect(switchDrawn()).toBe(true);
    });

    it('one grade waiting is asked about in the singular', () => {
      seed(CID, HELD);
      Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
      open(CID);
      flip(CID, false);
      expect(confirms[0]).toMatchObject({
        title: 'Return 1 Grade Now?',
        message: '1 grade is waiting as a draft. Changing this returns it to the student now.',
      });
    });

    it('Return and Change returns every one and turns it off', () => {
      seed(CID, HELD);
      Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
      Grader.setLevel(CID, 's2', 'essay', 't1', 2, 0);
      open(CID);
      flip(CID, false);
      confirms[0].onConfirm();
      expect(getReturnSettings(CID).student_page).toBe(false);
      expect(getGradeReturn(CID, 's1', 'essay').is_draft).toBe(false);
      expect(getGradeReturn(CID, 's2', 'essay').is_draft).toBe(false);
      expect(getGradeReturn(CID, 's1', 'essay').returned_at).toBeTruthy();
      expect(switchDrawn()).toBe(false);
    });

    it('a class on As Soon As I Save holds nothing, so turning it off asks nothing', () => {
      seed(CID, { student_page_enabled: true, return_grades: 'on_save' });
      Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
      open(CID);
      flip(CID, false);
      expect(confirms).toEqual([]);
      expect(getReturnSettings(CID).student_page).toBe(false);
    });

    describe('for a signed-in teacher', () => {
      let session;
      /* After an ask of the server that fails, shared/data.js reads the
         class again (_convergeOnServer; tests/grade-return-server.test.js
         walks it against a server that has a class to send). This file's
         recording client has none, so the read is noted here, not made. */
      let readAgain;
      let realConverge;
      beforeEach(() => {
        session = signIn();
        readAgain = [];
        realConverge = globalThis._convergeOnServer;
        globalThis._convergeOnServer = cid => readAgain.push(cid);
      });
      afterEach(() => {
        globalThis._convergeOnServer = realConverge;
        serverSaysStudentPageOn(LIVE, false);
        session.signOut();
      });
      const writes = () => session.sent().filter(c => !/^(list|get)_/.test(c[0]));
      const note = () => (html().match(/id="sp-switch-note" role="status">([^<]*)</) || [])[1] || null;
      const disabled = () => /id="sp-build-switch"[^>]* disabled>/.test(html());

      it('turned on: the server is asked first, for the switch alone; it shows on only when the server has answered', async () => {
        seed(LIVE, { levelOrder: 'asc', return_grades: 'on_return' });
        let answer;
        session.fake.on('update_course', () => new Promise(r => (answer = () => r({ data: null, error: null }))));
        open(LIVE);
        expect(switchDrawn()).toBe(false);
        flip(LIVE, true);
        await settle();
        // Asked, and waiting: the class is not on yet.
        expect(getReturnSettings(LIVE).student_page).toBe(false);
        expect(note()).toBe('Changing…');
        expect(switchDrawn()).toBe(true); // drawn as asked for, and not to be pressed again
        expect(disabled()).toBe(true);
        expect(html()).not.toContain('sp-card');
        // Only the switch: never this device's copy of Return Grades or of any other setting.
        expect(writes()).toEqual([['update_course', { p_course_id: LIVE, p_patch: { student_page_enabled: true } }]]);
        answer();
        await settle();
        expect(getReturnSettings(LIVE)).toEqual({ student_page: true, return_grades: 'on_return' });
        expect(switchDrawn()).toBe(true);
        expect(disabled()).toBe(false);
        expect(note()).toBe(null);
        expect(html()).toContain('sp-card');
      });

      it('offline or refused, it is not turned on, and the card says so', async () => {
        seed(LIVE, { levelOrder: 'asc', return_grades: 'on_return' });
        session.fake.on('update_course', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
        open(LIVE);
        const before = stored(LIVE);
        flip(LIVE, true);
        await settle();
        expect(stored(LIVE)).toBe(before);
        expect(getReturnSettings(LIVE).student_page).toBe(false);
        expect(switchDrawn()).toBe(false);
        expect(note()).toBe('Could not change this. Check the connection and try again.');
        expect(html()).not.toContain('sp-card');
        // Asked and not answered well: the class is read again from the server.
        expect(readAgain).toEqual([LIVE]);
        // The server had made the change after all (only its answer was
        // lost): once the read has brought it, the line goes.
        serverSaysStudentPageOn(LIVE);
        _cache.courseConfigs[LIVE] = Object.assign({}, getCourseConfig(LIVE), { student_page_enabled: true });
        DashClassManager.renderClassManager();
        expect(switchDrawn()).toBe(true);
        expect(note()).toBe(null);
        serverSaysStudentPageOn(LIVE, false);
        seed(LIVE, { levelOrder: 'asc', return_grades: 'on_return' });
        readAgain.length = 0;
        open(LIVE);
        flip(LIVE, true);
        await settle();
        expect(note()).toBe('Could not change this. Check the connection and try again.');
        readAgain.length = 0;
        // Offline it does not even ask.
        const online = Object.getOwnPropertyDescriptor(navigator, 'onLine');
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        try {
          // The draws above ask for the categories a timer tick later
          // (_cmCatPrepare): let that read go first, so only the flip is watched.
          await new Promise(r => setTimeout(r, 0));
          await settle();
          session.since();
          flip(LIVE, true);
          await settle();
          expect(session.since()).toEqual([]);
          expect(getReturnSettings(LIVE).student_page).toBe(false);
          expect(note()).toBe('Could not change this. Check the connection and try again.');
          // Nothing was asked, so there is nothing to read again.
          expect(readAgain).toEqual([]);
        } finally {
          if (online) Object.defineProperty(navigator, 'onLine', online);
          else Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
        }
      });

      it('turned off: the server’s count is asked first; with grades waiting it asks, then sends the switch alone and no return', async () => {
        seed(LIVE, HELD);
        serverSaysStudentPageOn(LIVE);
        Grader.setLevel(LIVE, U(11), U(31), U(51), 3, 0);
        await settle();
        // The server counts a withdrawn student's draft too: two, where this device shows one.
        expect(GradeState.draftsWaiting(LIVE)).toBe(1);
        session.fake.on('course_draft_count', () => ({ data: 2, error: null }));
        open(LIVE);
        session.since();
        const { el } = flip(LIVE, false);
        // Still on while the count is fetched and the question is up.
        expect(el.checked).toBe(true);
        await settle();
        expect(confirms.length).toBe(1);
        expect(confirms[0]).toMatchObject({
          title: 'Return 2 Grades Now?',
          message: '2 grades are waiting as drafts. Changing this returns them to students now.',
          okLabel: 'Return and Change',
        });
        expect(getReturnSettings(LIVE).student_page).toBe(true);
        // While the question is up the switch is drawn as it was, and can be
        // pressed again after Cancel (it was greyed out while the count was read).
        expect(switchDrawn()).toBe(true);
        expect(disabled()).toBe(false);
        expect(note()).toBe(null);
        expect(session.since().filter(c => !/^(list|get)_/.test(c[0]))).toEqual([
          ['course_draft_count', { p_course_id: LIVE }],
        ]);
        confirms[0].onConfirm();
        expect(getReturnSettings(LIVE).student_page).toBe(false);
        expect(getGradeReturn(LIVE, U(11), U(31)).is_draft).toBe(false);
        await settle();
        const sent = session.since().filter(c => !/^(list|get)_/.test(c[0]));
        expect(sent).toEqual([['update_course', { p_course_id: LIVE, p_patch: { student_page_enabled: false } }]]);
      });

      it('turned off when the count cannot be read: it stays on, and the card says so', async () => {
        seed(LIVE, HELD);
        serverSaysStudentPageOn(LIVE);
        session.fake.on('course_draft_count', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
        open(LIVE);
        const before = stored(LIVE);
        flip(LIVE, false);
        await settle();
        expect(confirms).toEqual([]);
        expect(stored(LIVE)).toBe(before);
        expect(getReturnSettings(LIVE).student_page).toBe(true);
        expect(switchDrawn()).toBe(true);
        expect(note()).toBe('Could not check for grades waiting to be returned. Check the connection and try again.');
        expect(writes().map(c => c[0])).toEqual(['course_draft_count']);
      });

      describe('an answer that arrives after the teacher has moved on', () => {
        // Verify pass on PR 999, finding 1. The page the teacher went to.
        const ELSEWHERE = '<div id="gradebook">THE GRADEBOOK</div>';
        const leaveClassSettings = () => {
          try {
            DashClassManager.closeClassManager();
          } catch (e) {
            /* the harness has no page behind Class Settings to draw */
          }
          expect(DashClassManager.classManagerOpen).toBe(false);
          mounts.main.innerHTML = ELSEWHERE;
        };

        it('the switch: Class Settings is not drawn over the page, and the change is still made', async () => {
          seed(LIVE, { levelOrder: 'asc', return_grades: 'on_return' });
          let answer;
          session.fake.on('update_course', () => new Promise(r => (answer = () => r({ data: null, error: null }))));
          open(LIVE);
          flip(LIVE, true);
          await settle();
          expect(note()).toBe('Changing…');
          leaveClassSettings();
          answer();
          await settle();
          expect(mounts.main.innerHTML).toBe(ELSEWHERE);
          expect(getReturnSettings(LIVE).student_page).toBe(true);
        });

        it('a refusal: nothing is drawn either, and the line is there when Class Settings is opened again', async () => {
          seed(LIVE, { levelOrder: 'asc', return_grades: 'on_return' });
          let answer;
          session.fake.on(
            'update_course',
            () => new Promise(r => (answer = () => r({ data: null, error: { code: '22023', message: 'invalid' } }))),
          );
          open(LIVE);
          flip(LIVE, true);
          await settle();
          leaveClassSettings();
          answer();
          await settle();
          expect(mounts.main.innerHTML).toBe(ELSEWHERE);
          open(LIVE);
          expect(switchDrawn()).toBe(false);
          expect(note()).toBe('Could not change this. Check the connection and try again.');
        });

        it('the count, turning off: no question goes up over the other page, and nothing is changed or returned', async () => {
          seed(LIVE, HELD);
          serverSaysStudentPageOn(LIVE);
          Grader.setLevel(LIVE, U(11), U(31), U(51), 3, 0);
          await settle();
          let answer;
          session.fake.on('course_draft_count', () => new Promise(r => (answer = () => r({ data: 3, error: null }))));
          open(LIVE);
          session.since();
          flip(LIVE, false);
          await settle();
          leaveClassSettings();
          answer();
          await settle();
          expect(confirms).toEqual([]);
          expect(mounts.main.innerHTML).toBe(ELSEWHERE);
          expect(getReturnSettings(LIVE).student_page).toBe(true);
          expect(getGradeReturn(LIVE, U(11), U(31)).is_draft).toBe(true);
          expect(session.since().filter(c => !/^(list|get)_/.test(c[0]))).toEqual([
            ['course_draft_count', { p_course_id: LIVE }],
          ]);
          // Opened again, the switch is as it was and can be pressed: nothing is left "Changing…".
          open(LIVE);
          expect(switchDrawn()).toBe(true);
          expect(disabled()).toBe(false);
          expect(note()).toBe(null);
        });

        it('the count, with another class opened in Class Settings meanwhile: no question about the first', async () => {
          seed(LIVE, HELD);
          seed(CID, {});
          serverSaysStudentPageOn(LIVE);
          let answer;
          session.fake.on('course_draft_count', () => new Promise(r => (answer = () => r({ data: 3, error: null }))));
          open(LIVE);
          flip(LIVE, false);
          await settle();
          DashClassManager.handleAction('cmSelectClass', { tagName: 'BUTTON', dataset: { cid: CID } });
          answer();
          await settle();
          expect(confirms).toEqual([]);
          expect(getReturnSettings(LIVE).student_page).toBe(true);
          expect(DashClassManager.classManagerOpen).toBe(true);
        });

        it('with Class Settings still open on the class, the question is asked as before', async () => {
          seed(LIVE, HELD);
          serverSaysStudentPageOn(LIVE);
          let answer;
          session.fake.on('course_draft_count', () => new Promise(r => (answer = () => r({ data: 3, error: null }))));
          open(LIVE);
          flip(LIVE, false);
          await settle();
          answer();
          await settle();
          expect(confirms.length).toBe(1);
          expect(confirms[0].title).toBe('Return 3 Grades Now?');
        });
      });

      it('the two settings on this device alone do not show the switch as on', () => {
        seed(LIVE, HELD);
        open(LIVE);
        expect(switchDrawn()).toBe(false);
        expect(html()).not.toContain('sp-card');
      });
    });
  });
});
