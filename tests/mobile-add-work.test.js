/**
 * Add Work on the phone (S7-F3) and a student's To Grade list and the
 * Grade tab's count (S7-F4), on Demo Mode's sample work (Science 8, Cell
 * Microscope Lab). teacher-mobile/add-work.js and grade-photos.js; the data
 * functions are tests/teacher-work.test.js's.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
let wasDemo;
let stubDocument;
let store;
let urls;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

function turnOn({ sendWork = true, page = true } = {}) {
  if (page) setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = sendWork;
  saveDemoStudentWork(CID, work);
}

function memoryStore() {
  const metas = new Map();
  const files = new Map();
  const copy = v => JSON.parse(JSON.stringify(v));
  return {
    async list() {
      return [...metas.values()].map(copy);
    },
    async putAll(items) {
      items.forEach(i => {
        metas.set(i.meta.id, copy(i.meta));
        files.set(i.meta.id, { photo: i.photo, thumb: i.thumb });
      });
    },
    async update(id, patch) {
      if (metas.has(id)) metas.set(id, window.PhotoQueue.applyPatch(copy(metas.get(id)), copy(patch)));
    },
    async blobs(id) {
      return files.get(id) || null;
    },
    async remove(ids) {
      ids.forEach(id => {
        metas.delete(id);
        files.delete(id);
      });
    },
    async clear() {
      metas.clear();
      files.clear();
    },
    count: () => metas.size,
  };
}

// What PhotoShrink.prepare gives for one file: n pages.
function shrunkOf(n = 1) {
  return {
    ok: true,
    kind: 'jpeg',
    pages: Array.from({ length: n }, (_, i) => ({
      blob: new Blob(['page' + i], { type: 'image/jpeg' }),
      thumb: new Blob(['t' + i], { type: 'image/jpeg' }),
      hash: String(i).padStart(64, 'b'),
      width: 1500,
      height: 2000,
    })),
  };
}
const photo = name => ({ name: name || 'IMG_1.jpg', size: 10 });

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<nav id="m-tab-bar"><button class="m-tab-item" data-tab="grade"><span class="m-tab-label">Grade</span></button></nav>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}
const stack = () => document.getElementById('m-nav-stack');
const lab = () => getAssessments(CID).find(a => a.id === LAB);
const name = sid => getStudents(CID).find(s => s.id === sid);
const shortName = sid => displayNameFirst(name(sid)) + ' ' + name(sid).lastName.charAt(0) + '.';
const screen = () => document.getElementById('m-addwork');
const click = sel => screen().querySelector(sel).click();
const flush = () => new Promise(r => setTimeout(r, 0));

function grading() {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, LAB);
  return stack();
}

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
  stubDocument = globalThis.document;
  page();
  seedDemo();
  store = memoryStore();
  window.PhotoQueue.configure({ store, isDemo: () => window.isDemoMode(), upload: async () => ({ error: null }) });
  urls = { made: 0, revoked: [] };
  URL.createObjectURL = () => 'blob:t' + ++urls.made;
  URL.revokeObjectURL = u => urls.revoked.push(u);
  MAddWork.configure({ prepare: async () => shrunkOf(1), onGrade: null });
});
afterEach(() => {
  MAddWork.close();
  globalThis.document = stubDocument;
  vi.restoreAllMocks();
});

describe('with the build switch or Send Work off', () => {
  it.each([
    ['nothing on', { page: false, sendWork: false }],
    ['Send Work off', { page: true, sendWork: false }],
  ])('%s: no Add Work, no To Grade list, no count', (_, opts) => {
    turnOn(opts);
    expect(grading().querySelector('[data-action="m-add-work"]')).toBeNull();
    expect(MGradePhotos.studentListHtml(CID, name('st11'))).toBe('');
    expect(MAddWork.open(CID, LAB, 'st11')).toBe(false);
    expect(screen()).toBeNull();
    MGradePhotos.syncTabBadge(CID);
    expect(document.querySelector('.m-tab-badge')).toBeNull();
  });
});

describe('with the student page and Send Work on', () => {
  beforeEach(() => turnOn());

  it('a not-in card offers Add Work for the student, with the board’s hint; a card with work does not', () => {
    const root = grading();
    const card = sid => root.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
    const btn = card('st11').querySelector('[data-action="m-add-work"]');
    expect(btn.textContent).toBe('Add Work for ' + displayNameFirst(name('st11')));
    expect(btn.getAttribute('data-aid')).toBe(LAB);
    expect(card('st11').querySelector('.m-work-add-hint').textContent).toBe(
      'Photos or PDFs. Photos are made smaller before they upload.',
    );
    expect(card('st11').querySelector('.m-work-sent').textContent).toMatch(/^Not In( · \d+ days? late)?$/);
    expect(card('st1').querySelector('[data-action="m-add-work"]')).toBeNull();
  });

  it('an Excused piece has no Add Work', () => {
    const real = getAssignmentStatus;
    vi.spyOn(globalThis, 'getAssignmentStatus').mockImplementation((c, sid, aid) =>
      sid === 'st11' && aid === LAB ? 'EXC' : real(c, sid, aid),
    );
    expect(grading().querySelector('.m-swiper-card[data-sid="st11"] [data-action="m-add-work"]')).toBeNull();
  });

  it('says how many days late, by the class’s day', () => {
    const a = { id: 'x', dueDate: '2026-01-10' };
    const spy = vi.spyOn(globalThis, 'courseToday');
    spy.mockReturnValue('2026-01-10');
    expect(MGradePhotos.notInState(CID, a)).toBe('Not In');
    spy.mockReturnValue('2026-01-07');
    expect(MGradePhotos.notInState(CID, a)).toBe('Not In');
    spy.mockReturnValue('2026-01-11');
    expect(MGradePhotos.notInState(CID, a)).toBe('Not In · 1 day late');
    spy.mockReturnValue('2026-01-17');
    expect(MGradePhotos.notInState(CID, a)).toBe('Not In · 7 days late');
    expect(MGradePhotos.notInState(CID, { id: 'y' })).toBe('Not In');
  });

  it('the red count goes when nothing waits', () => {
    expect(MGradePhotos.classToGrade(CID)).toBe(0);
    const tab = document.querySelector('.m-tab-item[data-tab="grade"]');
    tab.insertAdjacentHTML('beforeend', '<span class="m-tab-badge">3</span>');
    MGradePhotos.syncTabBadge(CID);
    expect(document.querySelector('.m-tab-badge')).toBeNull();
  });

  describe('Add Work, then the next student not in', () => {
    it('takes photos, files them as the teacher’s work, and goes on to the next student', async () => {
      const pile = MGradePhotos.notIn(CID, lab());
      const sid = pile[0];
      expect(MAddWork.open(CID, LAB, sid)).toBe(true);
      expect(screen().querySelector('.m-addwork-close').textContent).toBe('Done');
      expect(screen().querySelector('.m-addwork-title').textContent).toBe(lab().title);
      expect(screen().querySelector('.m-addwork-name').textContent).toBe(displayName(name(sid)));
      expect(screen().querySelector('.m-addwork-count').textContent).toBe('1 of ' + pile.length);
      expect(screen().querySelector('.m-addwork-shutter').getAttribute('aria-label')).toBe('Take page 1');
      expect(screen().querySelector('.m-addwork-save').disabled).toBe(true);
      expect(screen().querySelector('.m-addwork-save').textContent).toBe('Save and Next: ' + shortName(pile[1]));

      await MAddWork.addFiles([photo(), photo()]);
      expect(screen().querySelectorAll('.m-addwork-taken')).toHaveLength(2);
      expect(screen().querySelector('.m-addwork-taken img').getAttribute('alt')).toBe('Page 1, taken');
      expect(screen().querySelector('.m-addwork-shutter').getAttribute('aria-label')).toBe('Take page 3');

      click('[data-aw="save"]');
      await vi.waitFor(() =>
        expect(screen().querySelector('.m-addwork-name').textContent).toBe(displayName(name(pile[1]))),
      );
      const sub = getStudentSubmission(CID, sid, LAB);
      expect(sub).toMatchObject({ sent_by: 'teacher', on_paper: false });
      expect(sub.files.map(f => f.added_by)).toEqual(['teacher', 'teacher']);
      // Kept on the phone; nothing is sent in Demo Mode.
      expect(store.count()).toBe(2);
      expect((await window.PhotoQueue.send()).note).toBe('demo');
      // The taken pages' thumbnails were let go, and the next student starts empty.
      expect(urls.revoked).toEqual(['blob:t1', 'blob:t2']);
      expect(screen().querySelector('.m-addwork-count').textContent).toBe('2 of ' + pile.length);
      expect(screen().querySelectorAll('.m-addwork-taken')).toHaveLength(0);
      // The grader's card for that student now shows the work.
      expect(grading().querySelector('.m-swiper-card[data-sid="' + sid + '"] [data-action="m-add-work"]')).toBeNull();
    });

    it('Done saves photos taken and closes; Done with none just closes', async () => {
      const sid = MGradePhotos.notIn(CID, lab())[0];
      MAddWork.open(CID, LAB, sid);
      await MAddWork.addFiles([photo()]);
      await MAddWork.done();
      expect(screen()).toBeNull();
      expect(getStudentSubmission(CID, sid, LAB).files).toHaveLength(1);
      MAddWork.open(CID, LAB, MGradePhotos.notIn(CID, lab())[0]);
      await MAddWork.done();
      expect(screen()).toBeNull();
    });

    it('the last student’s button is Save, and saving closes', async () => {
      const pile = MGradePhotos.notIn(CID, lab());
      const last = pile[pile.length - 1];
      MAddWork.open(CID, LAB, last);
      expect(screen().querySelector('.m-addwork-save').textContent).toBe('Save');
      await MAddWork.addFiles([photo()]);
      await MAddWork.save('new');
      expect(screen()).toBeNull();
    });

    it('says why a file was refused, and keeps the pages it has', async () => {
      const R = PhotoShrink.REASONS;
      MAddWork.open(CID, LAB, MGradePhotos.notIn(CID, lab())[0]);
      MAddWork.configure({ prepare: async () => ({ ok: false, reason: R.OFFICE, office: 'word' }) });
      await MAddWork.addFiles([photo('essay.docx')]);
      expect(screen().querySelector('.m-addwork-msg').textContent).toBe('Save it as a PDF first.');
      MAddWork.configure({ prepare: async () => ({ ok: false, reason: R.NO_DECODER, kind: 'pdf' }) });
      await MAddWork.addFiles([photo('work.pdf')]);
      expect(screen().querySelector('.m-addwork-msg').textContent).toBe(
        "PDFs can't be added on the phone yet. Take a photo of each page.",
      );
      MAddWork.configure({ prepare: async () => shrunkOf(31) });
      await MAddWork.addFiles([photo()]);
      expect(screen().querySelectorAll('.m-addwork-taken')).toHaveLength(30);
      expect(screen().querySelector('.m-addwork-msg').textContent).toBe('A piece of work can have 30 pages at most.');
      expect(screen().querySelector('.m-addwork-shutter')).toBeNull();
    });

    it('a photo still being shrunk when the screen closes is dropped', async () => {
      let finish;
      MAddWork.configure({ prepare: () => new Promise(r => (finish = r)) });
      MAddWork.open(CID, LAB, MGradePhotos.notIn(CID, lab())[0]);
      const adding = MAddWork.addFiles([photo()]);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      MAddWork.close();
      finish(shrunkOf(1));
      await adding;
      expect(screen()).toBeNull();
      expect(urls.made).toBe(0);
    });

    it('a save answered after the screen closed changes nothing on screen', async () => {
      const sid = MGradePhotos.notIn(CID, lab())[0];
      MAddWork.open(CID, LAB, sid);
      await MAddWork.addFiles([photo()]);
      const saving = MAddWork.save('new');
      MAddWork.close();
      const res = await saving;
      expect(res.result).toBe('sent');
      expect(screen()).toBeNull();
      expect(MAddWork.isOpen()).toBe(false);
    });
  });

  describe('a student who already sent some', () => {
    async function conflictFor(sid, sub) {
      MAddWork.open(CID, LAB, sid);
      await MAddWork.addFiles([photo()]);
      // The student sends meanwhile (or another device filed it).
      const work = getCourseSubmissions(CID);
      work.submissions.push(
        Object.assign(
          {
            id: 'meanwhile',
            assessment_id: LAB,
            enrollment_id: sid,
            version: 1,
            state: 'sent',
            sent_by: 'student',
            on_paper: false,
            is_late: false,
            note: null,
            followed_plan: null,
            created_at: '2026-10-30T20:39:00',
            sent_at: '2026-10-30T20:41:00',
            files: getStudentSubmission(CID, 'st2', LAB).files.map(f => Object.assign({}, f, { id: 'm-' + f.id })),
          },
          sub,
        ),
      );
      saveDemoStudentWork(CID, work);
      await MAddWork.save('new');
    }

    it('offers Add as More Pages, Replace Them and Skip, with the pages and when they came', async () => {
      const sid = MGradePhotos.notIn(CID, lab())[0];
      await conflictFor(sid);
      const first = displayNameFirst(name(sid));
      expect(screen().querySelector('.m-addwork-conflict-line').textContent).toBe(first + ' already sent 2 photos');
      expect(screen().querySelector('.m-addwork-conflict-when').textContent).toBe(
        formatShortDate('2026-10-30') + ', 8:41 pm',
      );
      expect([...screen().querySelectorAll('.m-addwork-choice')].map(b => b.textContent)).toEqual([
        'Add as More Pages',
        'Replace Them',
        'Skip ' + first,
      ]);
      await vi.waitFor(() =>
        expect(screen().querySelector('.m-addwork-conflict-page img').getAttribute('src')).toMatch(
          /^\/assets\/sample-work\//,
        ),
      );
      click('[data-aw="add"]');
      await vi.waitFor(() => expect(getStudentSubmission(CID, sid, LAB).files).toHaveLength(3));
      expect(getStudentSubmission(CID, sid, LAB)).toMatchObject({ id: 'meanwhile', sent_by: 'student' });
      expect(getStudentSubmission(CID, sid, LAB).files[2].added_by).toBe('teacher');
    });

    it('Replace Them files only the new pages, as the teacher’s', async () => {
      const sid = MGradePhotos.notIn(CID, lab())[0];
      await conflictFor(sid);
      click('[data-aw="replace"]');
      await vi.waitFor(() => expect(getStudentSubmission(CID, sid, LAB).sent_by).toBe('teacher'));
      expect(getStudentSubmission(CID, sid, LAB).files).toHaveLength(1);
    });

    it('Skip files nothing and goes on', async () => {
      const pile = MGradePhotos.notIn(CID, lab());
      await conflictFor(pile[0]);
      click('[data-aw="skip"]');
      expect(getStudentSubmission(CID, pile[0], LAB).id).toBe('meanwhile');
      expect(screen().querySelector('.m-addwork-name').textContent).toBe(displayName(name(pile[1])));
      expect(store.count()).toBe(0);
    });

    it('work handed in on paper offers Replace Them and Skip only', async () => {
      const sid = MGradePhotos.notIn(CID, lab())[0];
      await conflictFor(sid, { on_paper: true, sent_by: 'teacher', files: [] });
      expect(screen().querySelector('.m-addwork-conflict-line').textContent).toBe(
        displayNameFirst(name(sid)) + ' handed it in on paper',
      );
      expect(screen().querySelector('[data-aw="add"]')).toBeNull();
      expect(screen().querySelector('[data-aw="replace"]')).not.toBeNull();
    });
  });

  describe('Add Work, then grade it', () => {
    it('one student: Cancel, Save and Grade, then the grader on that work', async () => {
      const onGrade = vi.fn();
      MAddWork.configure({ onGrade });
      MAddWork.open(CID, LAB, 'st11', { then: 'grade' });
      expect(screen().querySelector('.m-addwork-close').textContent).toBe('Cancel');
      expect(screen().querySelector('.m-addwork-count')).toBeNull();
      expect(screen().querySelector('.m-addwork-pile')).toBeNull();
      expect(screen().querySelector('.m-addwork-save').textContent).toBe('Save and Grade');
      await MAddWork.addFiles([photo()]);
      await MAddWork.save('new');
      expect(screen()).toBeNull();
      expect(onGrade).toHaveBeenCalledWith(CID, LAB, 'st11');
      expect(getStudentSubmission(CID, 'st11', LAB).sent_by).toBe('teacher');
    });

    it('Cancel files nothing and lets the photos go', async () => {
      MAddWork.open(CID, LAB, 'st11', { then: 'grade' });
      await MAddWork.addFiles([photo()]);
      click('[data-aw="close"]');
      await flush();
      expect(screen()).toBeNull();
      expect(getStudentSubmission(CID, 'st11', LAB)).toBeNull();
      expect(urls.revoked).toEqual(['blob:t1']);
    });
  });
});

describe('with work waiting', () => {
  beforeEach(() => {
    // Noor's grade cleared with the switch off, so her work waits.
    const a = lab();
    const keys = [...new Set((getScores(CID).st2 || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
    Grader.setOverallComment(CID, 'st2', LAB, '');
    getRubricCheckIds(CID, 'st2', LAB).forEach(id => Grader.setTick(CID, 'st2', LAB, id, false));
    if (keys.length) Grader.clearScore(CID, getScores(CID), 'st2', a, keys);
    turnOn();
  });

  it('the To Grade list: work waiting with Grade, then pieces not in with Add Work', () => {
    // Ines has nothing in: one Add Work row that goes on to grading.
    const holder = document.createElement('div');
    // html-safe: studentListHtml escapes its text; a test page
    holder.innerHTML = MGradePhotos.studentListHtml(CID, name('st11'));
    expect(holder.querySelector('.m-scard-return-head').textContent).toBe('To Grade');
    const rows = [...holder.querySelectorAll('.m-scard-tograde-row')];
    const labRow = rows.find(r => r.getAttribute('data-aid') === LAB);
    expect(labRow.getAttribute('data-action')).toBe('m-add-work');
    expect(labRow.getAttribute('data-then')).toBe('grade');
    expect(labRow.querySelector('.m-scard-tograde-act').textContent).toBe('Add Work');
    expect(labRow.querySelector('.m-scard-return-sub').textContent).toMatch(/^(Not In|Missing)/);
    // Noor's work waits (her grade was cleared): a Grade row first.
    const a = lab();
    // html-safe: studentListHtml escapes its text; a test page
    holder.innerHTML = MGradePhotos.studentListHtml(CID, name('st2'));
    const first = holder.querySelector('.m-scard-tograde-row');
    expect(first.getAttribute('data-action')).toBe('m-assess-grade');
    expect(first.querySelector('.m-scard-return-title').textContent).toBe(a.title);
    expect(first.querySelector('.m-scard-return-sub').textContent).toMatch(/^Sent .+ · 2 photos$/);
    expect(first.querySelector('.m-scard-tograde-act').textContent).toBe('Grade');
    // The Grade tab's red count.
    MGradePhotos.syncTabBadge(CID);
    const badge = document.querySelector('.m-tab-item[data-tab="grade"] .m-tab-badge');
    expect(badge.textContent).toBe(String(MGradePhotos.classToGrade(CID)));
    expect(MGradePhotos.classToGrade(CID)).toBeGreaterThan(0);
  });

  it('on the student card the To Grade list is a widget: on by default, under the name, and the editor turns it off', () => {
    const card = () => {
      const data = {
        sections: [],
        assessments: [],
        statuses: {},
        termId: 'term-1',
        widgetConfig: getCardWidgetConfig(),
      };
      const holder = document.createElement('div');
      // html-safe: assembleCard escapes every widget's text; a test page
      holder.innerHTML = MCardWidgets.assembleCard(name('st2'), CID, data);
      return holder;
    };
    const on = card();
    const list = on.querySelector('.m-scard-widgets > .m-scard-tograde');
    expect(list).not.toBeNull();
    expect(on.querySelector('.m-scard-widgets').firstElementChild).toBe(list);
    MCardWidgetEditor.toggleWidget('toGrade');
    expect(card().querySelector('.m-scard-tograde')).toBeNull();
    MCardWidgetEditor.toggleWidget('toGrade');
    expect(card().querySelector('.m-scard-tograde')).not.toBeNull();
  });
});

describe('the phone loads Add Work', () => {
  it('in its page, its offline copy and its tests', () => {
    expect(readFileSync('teacher-mobile/index.html', 'utf-8')).toContain(
      '<script src="../teacher-mobile/add-work.js"></script>',
    );
    expect(readFileSync('sw.js', 'utf-8')).toContain("'/teacher-mobile/add-work.js'");
    expect(readFileSync('tests/setup-mobile.js', 'utf-8')).toContain("load('teacher-mobile/add-work.js')");
  });
});
