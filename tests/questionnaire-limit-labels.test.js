/**
 * Live bug hunt 2 (Nov 1 2026), Term Questionnaire, items 4 and 7–10:
 *
 * 4. Generate never cuts a draft to the class's character limit, and the
 *    limit never keeps Approve off (Colin, 2026-11-02: "i don't care about
 *    comment maximum length for myedbc - don't restrict users").
 * 7. (The limit box was removed on Nov 26 2026: Colin, "get rid of the
 *    character limit box". A limit saved before is not read.)
 * 8. The habits source lines and the ⓘ sheet say when a rating came from
 *    the record rather than the teacher.
 * 9. The ⓘ sheet keeps Tab and Shift-Tab inside it.
 * 10. "1 character", never "1 characters".
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('the character limit and the habits labels (Demo Mode, Science 8)', () => {
  let cid, saved, hadDoc, oldDoc, box, btn, els, body;
  const byName = first => getStudents(cid).find(s => s.firstName === first);
  let termN = 2;
  const term = () => 'term-' + termN;
  const factsOf = st => CommentBank.facts(cid, st, term());
  const draftOf = (st, opts) =>
    CommentBank.draft(CommentBank.context(factsOf(st), {}), Object.assign({ seed: 3, quiet: true }, opts));
  const open = st => {
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    return RQ.renderTermQuestionnaire(cid);
  };
  const sheet = () => {
    RQ.tqOpenInfo();
    return els['tq-info-overlay'];
  };
  const settings = () => (getReportConfig(cid) || {}).commentSettings || {};
  const setLimit = v =>
    saveReportConfig(cid, Object.assign({}, getReportConfig(cid) || {}, { commentSettings: { charLimit: v } }));
  const useTerm = n => {
    termN = n;
    setActiveTerm(cid, n);
    clearProfCache();
  };
  const el = (id, extra) => {
    const x = Object.assign(
      {
        id,
        value: '',
        hidden: false,
        textContent: '',
        dataset: {},
        attrs: {},
        focus() {
          globalThis.document.activeElement = x;
        },
        setAttribute(k, v) {
          x.attrs[k] = String(v);
        },
        removeAttribute(k) {
          delete x.attrs[k];
        },
      },
      extra,
    );
    return x;
  };

  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    // A Letter class, so every comment opens with the grade sentence.
    COURSES[cid].gradingSystem = 'letter';
    useTerm(2);
    btn = { disabled: false, title: '' };
    els = {};
    body = { children: [], classList: { add() {}, remove() {} } };
    body.appendChild = n => {
      body.children.push(n);
      els[n.id] = n;
    };
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = {
      activeElement: null,
      getElementById: id =>
        id === 'tq-narrative'
          ? box
          : id === 'tq-approve-next'
            ? btn
            : id === 'report-period'
              ? { value: 'Report 2', selectedIndex: 0, options: [{ value: 'Report 2', text: 'Report 2' }] }
              : els[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      execCommand: () => false,
      createElement: () => {
        const n = el('');
        n.listeners = {};
        n.addEventListener = (k, fn) => (n.listeners[k] = fn);
        n.remove = () => {
          delete els[n.id];
        };
        n.querySelector = () => n.done || null;
        n.querySelectorAll = () => n.controls || [];
        n.contains = x => (n.controls || []).indexOf(x) >= 0;
        return n;
      },
      body,
    };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  beforeEach(() => {
    els = {};
    box = el('tq-narrative', {
      dataset: {
        cid,
        get term() {
          return term();
        },
        get sid() {
          return RQ.getTqStudents()[RQ.tqStudentIndex].id;
        },
      },
      style: {},
      scrollHeight: 0,
      select() {},
    });
  });
  afterAll(async () => {
    await new Promise(r => setTimeout(r, 700));
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  describe('4. the limit is only information', () => {
    it('Generate on the review screen gives the whole draft past the class’s limit, and Approve stays on', () => {
      setLimit(350);
      const over = getStudents(cid).filter(st => draftOf(st).text.length > 350);
      expect(over.length).toBeGreaterThan(10);
      const gen = st => {
        upsertTermRating(cid, st.id, term(), { narrative: '' });
        open(st);
        box.value = '';
        RQ.tqGenerate();
        return box.value;
      };
      // The students whose Generate draft runs past the limit.
      const long = over.filter(st => gen(st).length > 350).slice(0, 3);
      expect(long.length).toBe(3);
      long.forEach(st => {
        expect(gen(st).length, st.firstName).toBeGreaterThan(350);
        expect(RQ.approveBlockers(st), st.firstName).not.toContain('limit');
      });
      setLimit(null);
    }, 20000); // Generate runs the whole comment engine; GitHub runners are slower than a Mac.
  });

  describe('8. the habits source lines and the ⓘ sheet', () => {
    it('an unrated Completes Work is not a source: no “From the record” line (nothing rated by the teacher)', () => {
      const st = byName('Tyler');
      upsertTermRating(cid, st.id, term(), { habits: {} });
      const f = factsOf(st);
      const ctx = CommentBank.context(f, {});
      // The record has work in it, yet nothing is rated from it (Nov 4).
      expect(f.record.total).toBeGreaterThan(0);
      expect(CommentBank.effectiveHabits({}, f.record)).toEqual({});
      const src = RQ.rowSource({ step: 'habits', edited: false, prov: null }, cid, st, f, ctx);
      expect(src).toBe('From your Work Habits ratings');
      expect(src).not.toMatch(/record/);
      // A sentence naming the habit has no source for it while it is blank.
      const row = { step: 'example', edited: false, prov: { factKeys: ['habit:completes'] } };
      expect(RQ.rowSource(row, cid, st, f, ctx)).not.toMatch(/From the record|Completes Work/);
    });

    it('what the teacher rated is “rated”; an unrated habit is left out', () => {
      const st = byName('Tyler');
      const f = factsOf(st);
      const ctx = CommentBank.context(f, {});
      const src = () => RQ.rowSource({ step: 'habits', edited: false, prov: null }, cid, st, f, ctx);
      // Five rated Consistently, Completes Work blank: the line counts the
      // five the teacher rated and never names Completes Work.
      const keys = CommentBank.HABITS.map(h => h.key).filter(k => k !== 'completes');
      const mine = {};
      keys.forEach(k => (mine[k] = 4));
      expect(Object.keys(mine).length).toBe(5);
      upsertTermRating(cid, st.id, term(), { habits: mine });
      expect(src()).toBe('All five rated Consistently');
      expect(src()).not.toMatch(/record|Completes Work|^All six/);
      // All six rated by the teacher: the mockup's line.
      upsertTermRating(cid, st.id, term(), { habits: Object.assign({ completes: 4 }, mine) });
      expect(src()).toBe('All six rated Consistently');
      // One to build, rated by the teacher.
      upsertTermRating(cid, st.id, term(), { habits: Object.assign({ completes: 2 }, mine) });
      expect(src()).toBe('Completes Work rated Sometimes');
      upsertTermRating(cid, st.id, term(), { habits: {} });
    });

    it('the ⓘ sheet says “Your six ratings” only once all six are rated by the teacher', () => {
      const st = byName('Tyler');
      upsertTermRating(cid, st.id, term(), { habits: {} });
      open(st);
      let o = sheet();
      expect(o.innerHTML).not.toContain('Your six ratings');
      expect(o.innerHTML).toContain('Rated by you, Rarely to Consistently: none yet.');
      expect(o.innerHTML).toContain('Only the habits you rate are used.');
      expect(o.innerHTML).not.toContain('assignment record');
      RQ.tqCloseInfo();
      const [a, b] = CommentBank.HABITS.map(h => h.key).filter(k => k !== 'completes');
      upsertTermRating(cid, st.id, term(), { habits: { [a]: 3, [b]: 4 } });
      o = sheet();
      expect(o.innerHTML).toContain('Rated by you, Rarely to Consistently: two of six so far.');
      RQ.tqCloseInfo();
      const all = {};
      CommentBank.HABITS.forEach(h => (all[h.key] = 3));
      upsertTermRating(cid, st.id, term(), { habits: all });
      o = sheet();
      expect(o.innerHTML).toContain('Your six ratings, Rarely to Consistently.');
      expect(o.innerHTML).not.toContain('Rated by you');
      RQ.tqCloseInfo();
      upsertTermRating(cid, st.id, term(), { habits: {} });
    });
  });

  describe('the ⓘ sheet lists what Progress Reports prints (One Report’s model)', () => {
    const report = html => html.split('qn-info-label')[2].split('qn-info-never')[0];
    const partsOf = html => [...report(html).matchAll(/class="qn-info-part">([^<]*)</g)].map(m => m[1]);
    const offOf = html => (report(html).match(/qn-info-off-title">[^<]*<\/span><span>([^<]*)</) || [])[1] || '';
    let kept;
    beforeAll(() => {
      kept = getReportConfig(cid);
    });
    afterAll(() => {
      saveReportConfig(cid, kept || {});
    });

    it('lists the parts that are on, in print order, with a renamed heading, then the Feedback Pages', () => {
      saveReportConfig(cid, {
        one: {
          parts: ['header', 'teacher-narrative', 'parent-response', 'proficiency'],
          titles: { 'teacher-narrative': 'From Your Teacher' },
          feedback: { rubrics: true },
        },
      });
      open(byName('Tyler'));
      const html = sheet().innerHTML;
      RQ.tqCloseInfo();
      expect(partsOf(html)).toEqual([
        'Letterhead',
        'From Your Teacher',
        'Proficiency',
        'Parent / Guardian Response',
        'Rubrics',
      ]);
      expect(html).toContain('Your rubrics on each assessment, on pages after the report.');
      const off = offOf(html).split(' · ');
      expect(off).toContain('Assessments');
      expect(off).toContain('Assessment Comments');
      expect(off).not.toContain('Rubrics');
      expect(off).not.toContain('Letterhead');
      // A Letter class has no Proficiency Legend to add.
      expect(off).not.toContain('Proficiency Legend');
      expect(html).toContain('Add them in Print Reports.');
    });

    it('a class with nothing saved lists the Grades setup', () => {
      saveReportConfig(cid, {});
      open(byName('Tyler'));
      const html = sheet().innerHTML;
      RQ.tqCloseInfo();
      expect(partsOf(html)).toEqual(['Letterhead', 'Assessments', 'Categories', 'Course Grade']);
      expect(html).toContain('Each assessment and its score, from your gradebook.');
      expect(html).toContain('Comes from scores and your category weights.');
    });

    it('a class’s old built form lists that form’s blocks', () => {
      saveReportConfig(cid, {
        progressMode: 'build',
        form: {
          v: 6,
          id: 'x',
          sides: [{ rows: [{ cells: [{ block: 'header' }] }, { cells: [{ block: 'teacher-narrative' }] }] }],
        },
      });
      open(byName('Tyler'));
      const html = sheet().innerHTML;
      RQ.tqCloseInfo();
      expect(partsOf(html)).toEqual(['Letterhead', 'Teacher Comment']);
    });
  });

  describe('9. the ⓘ sheet keeps the focus', () => {
    it('Tab and Shift-Tab cycle inside it; Escape closes it and the ⋯ button gets the focus', () => {
      const st = byName('Tyler');
      open(st);
      const info = el('tq-more-btn');
      els['tq-more-btn'] = info;
      const o = sheet();
      const done = el('done');
      const other = el('other');
      o.done = done;
      o.controls = [done, other];
      const tab = shiftKey => {
        let prevented = false;
        RQ.handleKey({
          key: 'Tab',
          shiftKey,
          target: document.activeElement,
          preventDefault: () => (prevented = true),
        });
        return prevented;
      };
      done.focus();
      expect(tab(true)).toBe(true);
      expect(document.activeElement).toBe(other);
      expect(tab(false)).toBe(true);
      expect(document.activeElement).toBe(done);
      // Between the two, the browser moves the focus.
      expect(tab(false)).toBe(false);
      // Focus that left the sheet comes back to it.
      info.focus();
      expect(tab(false)).toBe(true);
      expect(document.activeElement).toBe(done);
      RQ.handleKey({ key: 'Escape', target: done, preventDefault() {} });
      expect(els['tq-info-overlay']).toBeUndefined();
      expect(document.activeElement).toBe(info);
    });
  });

  describe('10. one character is singular', () => {
    it('counts “1 character”, never “1 characters”; a limit saved before is not read', () => {
      const st = byName('Tyler');
      upsertTermRating(cid, st.id, term(), { narrative: 'x' });
      setLimit(null);
      expect(open(st)).toContain('<span class="qn-count-text" id="tq-count">1 character</span>');
      setLimit(1);
      upsertTermRating(cid, st.id, term(), { narrative: 'x'.repeat(29) });
      const html = open(st);
      box.value = 'x'.repeat(29);
      expect(html).toContain('<span class="qn-count-text" id="tq-count">29 characters</span>');
      RQ.syncApprove();
      expect(btn.disabled).toBe(false);
      setLimit(null);
    });
  });
});
