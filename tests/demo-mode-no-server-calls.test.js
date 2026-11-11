/**
 * Demo Mode stays on this computer. The page still has the anon Supabase
 * client, so writes used to go out and fail ("permission denied", 401):
 * saved categories never reached the cache, "1 unsynced change" stuck, and
 * creating a class with a curriculum reported that its competencies failed
 * to sync. Now no RPC leaves the page in Demo Mode, and those saves apply
 * locally.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('Demo Mode sends nothing to Supabase', () => {
  var calls;
  var alerts;
  var originals;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    calls = [];
    alerts = [];
    originals = {
      getSupabase: globalThis.getSupabase,
      isDemoMode: globalThis.isDemoMode,
      alert: globalThis.alert,
      index: CURRICULUM_INDEX,
    };
    // The anon client a Demo Mode page has: every call fails as anon.
    globalThis.getSupabase = () => ({
      rpc(name) {
        calls.push(name);
        return Promise.resolve({ data: null, error: { message: 'permission denied', status: 401 } });
      },
      from(table) {
        calls.push('from:' + table);
        return { select: () => Promise.resolve({ data: [], error: null }) };
      },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    });
    globalThis.isDemoMode = () => true;
    globalThis.alert = message => alerts.push(message);
    _useSupabase = false;
  });

  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.alert = originals.alert;
    CURRICULUM_INDEX = originals.index;
    localStorage.clear();
    DashClassManager.resetState();
  });

  it('makes no RPC from the v2 write and read helpers', async () => {
    const save = await window.v2.saveCategories('course-demo', [{ name: 'Tests', weight: 100 }]);
    const list = await window.v2.listCategories('course-demo');
    const upsert = await window.v2.upsertSubject({ courseId: 'course-demo', name: 'Science' });
    expect(save).toEqual({ data: null, error: null });
    expect(list).toEqual({ data: null, error: null });
    expect(upsert).toEqual({ data: null, error: null });
    expect(calls).toEqual([]);
  });

  it('saves categories locally from the class manager', async () => {
    const cid = 'course-demo-cats';
    saveCourses({ [cid]: { id: cid, name: 'Science 8', gradingSystem: 'letter' } });
    _cache.assessments[cid] = [];
    adoptCategoriesFromServer(cid, [
      { id: 'd1', name: 'Labs', weight: 60, displayOrder: 0 },
      { id: 'd2', name: 'Quizzes', weight: 40, displayOrder: 1 },
    ]);
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await tick();

    DashClassManager.handleAction('cmCatAdd', { dataset: {} });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatNameLive', idx: '2' }, value: 'Homework' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '0' }, value: '50' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '1' }, value: '30' });
    DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '2' }, value: '20' });
    DashClassManager.handleAction('cmCatSave', { dataset: {} });
    await tick();

    const cats = getCategories(cid);
    expect(cats.map(c => [c.name, c.weight])).toEqual([
      ['Labs', 50],
      ['Quizzes', 30],
      ['Homework', 20],
    ]);
    expect(cats[2].id).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('creates a class with a curriculum without a sync warning', async () => {
    CURRICULUM_INDEX = {
      SCI9: {
        course_name: 'Science 9',
        subject: 'Science',
        categories: [
          {
            name: 'Questioning and Predicting',
            competencies: [{ tag: 'QAP1', short_label: 'Curiosity', raw: 'Demonstrate a sustained curiosity' }],
          },
        ],
      },
    };
    saveCourses({});
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmStartCreate', { dataset: {} });
    DashClassManager.handleAction('cwToggleCourse', { dataset: { tag: 'SCI9' } });
    DashClassManager.handleAction('cwGoToStep2', { dataset: {} });
    const originalGetElementById = document.getElementById;
    document.getElementById = id => (id === 'cm-new-name' ? { value: 'Science 9 Demo' } : originalGetElementById(id));
    DashClassManager.handleAction('cwGoToStep3', { dataset: {} });
    document.getElementById = originalGetElementById;
    DashClassManager.handleAction('cwFinishCreate', { dataset: {} });
    await tick(50);

    const cid = Object.keys(COURSES).find(id => COURSES[id].name === 'Science 9 Demo');
    expect(cid).toBeTruthy();
    expect(getSections(cid).map(s => s.tags[0].code)).toEqual(['QAP1']);
    expect(alerts).toEqual([]);
    expect(calls).toEqual([]);
  });
});

/* The student page's card path (s/app.js, s/assignments.js,
   s/student-data.js; docs/plans/student-page-build-plan.md, 1.10). Demo Mode
   builds the card, the identity check and the page for one class on the
   device, and the edge function is never asked.
   Since S0-W1 a real card does ask it, from one place: `ask` in s/app.js,
   which answers on the device and returns before the call whenever the
   page is in Demo Mode. The other two files still hold no way to ask. */
describe('Demo Mode sends nothing from the student page', () => {
  const CARD_FILES = ['s/app.js', 's/assignments.js', 's/student-data.js'];
  const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf-8');

  it.each(CARD_FILES)('%s has no way of its own to reach a server', file => {
    const src = source(file);
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(src).not.toMatch(/functions\/v1|supabase\.co|__ENV/i);
    if (file !== 's/app.js') expect(src).not.toMatch(/StudentPage\.call\b|supabase/i);
  });

  it('s/app.js asks the function from one place, and never from Demo Mode', () => {
    const src = source('s/app.js');
    // One call, and no other name for it.
    expect(src.match(/StudentPage\.call\b/g)).toHaveLength(1);
    expect(src).not.toMatch(/=\s*StudentPage\.call\b|StudentPage\[/);
    // It is the last line of `fromFunction` (all `ask` calls), after Demo Mode has returned its own answer.
    expect(src.match(/\bfromFunction\(/g)).toHaveLength(2);
    const ask = /\n {2}function fromFunction\(route, body\) \{\n([\s\S]*?)\n {2}\}\n/.exec(src)[1];
    expect(ask.replace(/\s+/g, ' ').trim()).toBe(
      'if (S.demo) { var answer = demo ? DEMO_ANSWERS[route] : null; ' +
        "return Promise.resolve(answer ? answer(body || {}) : { ok: false, error: 'not_found' }); } " +
        'return StudentPage.call(Object.assign({ route: route }, body));',
    );
  });

  it.each(['#demo-card', '#demo-card-password', '#demo-card-letter', '#demo-card-both'])(
    '%s walks card, Is This You? and Assignments with no request',
    async hash => {
      const page = openStudentPage();
      await page.start(hash);
      expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
      await page.submit('form[data-form="card"]');
      expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
      // No, That's Not Me, and back to the card.
      await page.click('[data-act="card-notme"]');
      await page.click('[data-act="card-restart"]');
      await page.submit('form[data-form="card"]');
      // The code box under Is This You? opens the sample card again, on the device.
      page.type('#sp-code', 'K7M-4QX');
      await page.submit('form.sp-code-box');
      expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
      // A wrong try, then the right one.
      page.type('#sp-ident', '0');
      await page.click('[data-act="card-yes"]');
      expect(page.root().querySelector('.sp-msg').textContent).toContain('4 tries left.');
      page.type('#sp-ident', hash === '#demo-card-password' ? page.T.DEMO.password : page.T.DEMO.number);
      await page.click('[data-act="card-yes"]');
      expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
      expect(page.root().querySelectorAll('.sp-row, .sp-piece').length).toBeGreaterThan(0);
      expect(page.calls).toEqual([]);
      // The only files fetched late are the site's own calc.js and constants.js.
      expect(page.fetched).toEqual(['../shared/constants.js', '../shared/calc.js']);
    },
  );

  it('the other demo addresses still call nothing', async () => {
    for (const hash of ['#demo', '#demo-about', '#demo-report']) {
      const page = openStudentPage();
      await page.start(hash);
      expect(page.calls, hash).toEqual([]);
      // Demo Mode's questions come from the site's own templates file.
      expect(page.fetched, hash).toEqual(hash === '#demo-report' ? [] : ['../shared/questionnaire-templates.js']);
    }
  });
});

/* Draft and Returned (S0-F2): the rule runs on the device. Grading in a
   class that holds grades, Return, and leaving When I Return Them send
   nothing, and the modules that hold the rule have no way to reach a
   server or to name a server function. */
describe('Demo Mode sends nothing for Draft and Returned', () => {
  const CID = 'c-demo-held';
  let calls;
  let originals;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    calls = [];
    originals = { getSupabase: globalThis.getSupabase, isDemoMode: globalThis.isDemoMode, useSupabase: _useSupabase };
    globalThis.getSupabase = () => ({
      rpc(name) {
        calls.push(name);
        return Promise.resolve({ data: null, error: { message: 'permission denied', status: 401 } });
      },
      from(table) {
        calls.push('from:' + table);
        return { select: () => Promise.resolve({ data: [], error: null }) };
      },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    });
    globalThis.isDemoMode = () => true;
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency', gradeLevel: '8' };
    saveStudents(CID, [{ id: 's1', firstName: 'Jordan', lastName: 'Test' }]);
    saveAssessments(CID, [{ id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {});
  });

  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    _useSupabase = originals.useSupabase;
    Object.keys(_cache).forEach(field => {
      if (_cache[field] && typeof _cache[field] === 'object') delete _cache[field][CID];
    });
    delete COURSES[CID];
    localStorage.clear();
  });

  // A Demo Mode page can also be one a signed-in teacher opened.
  it.each([false, true])('a draft, Return and a change of Return Grades (signed in behind it: %s)', async signedIn => {
    _useSupabase = signedIn;
    expect(setStudentPageSwitch(CID, true)).toBe(true);
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('draft');
    expect(getReturnedScores(CID).s1).toEqual([]);
    expect(Grader.returnGrades(CID, 'essay', ['s1']).returned).toBe(1);
    Grader.setLevel(CID, 's1', 'essay', 't1', 4, 0);
    Grader.setOverallComment(CID, 's1', 'essay', 'Recounted.');
    expect(getReturnedScores(CID).s1.map(e => e.score)).toEqual([3]);
    // Leaving When I Return Them returns what was waiting.
    setStudentPageSwitch(CID, true, 'on_save');
    expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
    setStudentPageSwitch(CID, false);
    await tick();
    expect(calls).toEqual([]);
    expect(JSON.parse(localStorage.getItem('gb-grade-returns-' + CID)).essay.s1.is_draft).toBe(false);
  });

  /* Student cards (S0-W1, S3-W1): made, listed and marked printed on the
     device. Making cards is the teacher-cards function for a signed-in
     teacher (a fetch, not an RPC): in Demo Mode it is never fetched, and
     the saved card keeps no code. */
  it.each([false, true])(
    'student cards: Make and Print and marking them printed (signed in behind it: %s)',
    async signedIn => {
      _useSupabase = signedIn;
      const fetched = [];
      const realFetch = globalThis.fetch;
      const realSheet = QrSlips.printSheet;
      const printed = [];
      globalThis.fetch = async url => {
        fetched.push(String(url));
        throw new TypeError('Failed to fetch');
      };
      // The sheet itself is drawn elsewhere (tests/student-cards.test.js); here, what goes on it.
      QrSlips.printSheet = items => printed.push(items.length);
      try {
        setStudentPageSwitch(CID, true);
        expect((await listStudentCards(CID)).data).toEqual([]);
        const made = (await makeStudentCards(CID, [{ enrollment_id: 's1', replaces: null }])).data;
        expect(made.results[0].result).toBe('made');
        expect((await markStudentCardsPrinted(CID, [made.results[0].card_id])).data.printed).toBe(1);
        // A second student, and the screen's own press: it makes and prints a card, on the device.
        saveStudents(CID, getStudents(CID).concat([{ id: 's2', firstName: 'Avery', lastName: 'Test' }]));
        const realQuery = document.querySelector;
        const wasOpen = DashClassManager.classManagerOpen;
        const realDraw = DashClassManager.renderClassManager;
        document.querySelector = sel =>
          sel === '.sc-card' ? { dataset: { cid: CID } } : realQuery.call(document, sel);
        DashClassManager.classManagerOpen = true;
        DashClassManager.renderClassManager = () => {};
        const realConfirm = globalThis.showConfirm;
        // Every question is answered Yes.
        globalThis.showConfirm = (title, message, ok, style, onOk) => onOk();
        let pressed;
        try {
          StudentCards._reset();
          StudentCards.render(CID);
          await StudentCards.load(CID);
          pressed = await StudentCards.makeAndPrint(CID);
          // Print New Card, New Codes for This Class, Unlock and Unlock All: on the device too.
          await StudentCards.printNewCard(CID, 's1');
          await tick();
          StudentCards.newCodes(CID);
          await tick();
          const kept = JSON.parse(localStorage.getItem('gb-student-cards-' + CID));
          kept.forEach(c => (c.locked_at = new Date().toISOString()));
          localStorage.setItem('gb-student-cards-' + CID, JSON.stringify(kept));
          await StudentCards.load(CID);
          StudentCards.unlock(CID, kept[0].id);
          StudentCards.unlockAll(CID);
          await tick();
        } finally {
          document.querySelector = realQuery;
          DashClassManager.classManagerOpen = wasOpen;
          DashClassManager.renderClassManager = realDraw;
          globalThis.showConfirm = realConfirm;
        }
        expect(pressed).toBe(1);
        expect(printed).toEqual([1, 1, 2]);
        expect(JSON.parse(localStorage.getItem('gb-student-cards-' + CID)).every(c => !c.locked_at)).toBe(true);
        await tick();
        expect(calls).toEqual([]);
        expect(fetched).toEqual([]);
        const kept = localStorage.getItem('gb-student-cards-' + CID);
        expect(JSON.parse(kept).length).toBe(2);
        expect(JSON.parse(kept).every(c => !!c.printed_at)).toBe(true);
        expect(kept).not.toContain(made.results[0].code);
        expect(kept).not.toMatch(/"(code|password)":/);
        // Nothing waits in an outbox either.
        expect(localStorage.getItem('fv-sync-queue-v1')).toBe(null);
      } finally {
        globalThis.fetch = realFetch;
        QrSlips.printSheet = realSheet;
        StudentCards._reset();
      }
    },
  );

  it.each([false, true])(
    'the two settings’ own writer and the count of drafts (signed in behind it: %s)',
    async signedIn => {
      _useSupabase = signedIn;
      expect(saveReturnSettings(CID, { student_page_enabled: true }).now).toEqual({ ok: true });
      expect(saveReturnSettings(CID, { return_grades: 'on_return' }).now).toEqual({ ok: true });
      Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
      expect(draftsWaitingToReturn(CID).now).toEqual({ count: 1 });
      expect(saveReturnSettings(CID, { return_grades: 'on_save' }).now).toEqual({ ok: true });
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
      expect(draftsWaitingToReturn(CID).now).toEqual({ count: 0 });
      expect(saveReturnSettings(CID, { student_page_enabled: false }).now).toEqual({ ok: true });
      await tick();
      expect(calls).toEqual([]);
      expect(localStorage.getItem('fv-sync-queue-v1')).toBe(null);
    },
  );

  it('the rule and the grader name no server function', () => {
    ['shared/grade-state.js', 'shared/grader.js'].forEach(file => {
      const src = readFileSync(new URL('../' + file, import.meta.url), 'utf-8');
      expect(src, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase/);
    });
    // Until S0-W1 nothing the client sent named the server's return, its
    // list of rows or its count of drafts. Now shared/data.js sends all
    // three, for a signed-in teacher only (tests/grade-return-server.test.js);
    // no other file names them.
    ['shared/grade-state.js', 'shared/grader.js', 'teacher/page-assignments.js'].forEach(file => {
      const src = readFileSync(new URL('../' + file, import.meta.url), 'utf-8');
      expect(src, file).not.toMatch(/['"`](return_grades|list_course_grade_returns|course_draft_count)['"`]\s*,/);
      expect(src, file).not.toMatch(/rpc:\s*['"`](return_grades|list_course_grade_returns|course_draft_count)/);
    });
    ['shared/data.js'].forEach(file => {
      const src = readFileSync(new URL('../' + file, import.meta.url), 'utf-8');
      // Each through the guarded calls, never as a bare { rpc: … } op.
      expect(src, file).not.toMatch(/rpc:\s*['"`](return_grades|list_course_grade_returns|course_draft_count)/);
    });
  });
});
