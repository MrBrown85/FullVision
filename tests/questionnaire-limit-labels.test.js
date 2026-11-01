/**
 * Live bug hunt 2 (Nov 1 2026), Term Questionnaire, items 4 and 7–10:
 *
 * 4. Generate kept to the class's character limit: over it, the draft
 *    drops the family line, then attendance, then the strengths, then the
 *    habits sentence, nothing else; when even that cannot fit, the draft is
 *    kept as is and the count says why.
 * 7. A new entry in the limit box is a whole number from 100 to 5000 or
 *    nothing; any other says so and never clears the limit; Escape
 *    cancels, its blur saving nothing. A limit older code saved below 100
 *    is honoured as is.
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
const MSG = 'Enter a whole number from 100 to 5000, or leave it empty for no limit.';

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

  describe('4. Generate keeps to the character limit', () => {
    const DROP = ['home', 'attendance', 'overall', 'habits', 'strongHabits'];
    // The steps a fitted draft left out, in the drop order: the family line
    // goes before attendance, attendance before the strengths, and so on.
    const expectDropOrder = (whole, fitted) => {
      const left = fitted.sentences.map(x => x.id);
      const ids = whole.sentences.map(x => x.id);
      // The fitted draft is the whole draft less some sentences, in order.
      expect(left).toEqual(ids.filter(id => left.indexOf(id) >= 0));
      const gone = whole.sentences.filter(x => left.indexOf(x.id) < 0).map(x => x.step);
      gone.forEach(step => expect(DROP).toContain(step));
      const furthest = Math.max(-1, ...gone.map(s => DROP.indexOf(s)));
      whole.sentences
        .filter(x => DROP.indexOf(x.step) >= 0 && DROP.indexOf(x.step) < furthest)
        .forEach(x => expect(gone, x.step).toContain(x.step));
    };

    it('fits every draft in Report 2 to 350 and to 500, the grade sentence kept', () => {
      const students = getStudents(cid);
      let dropped = 0;
      [350, 500].forEach(limit => {
        students.forEach(st => {
          const whole = draftOf(st);
          const d = draftOf(st, { charLimit: limit });
          expect(d.text.length, st.firstName + ' at ' + limit).toBeLessThanOrEqual(limit);
          expect(d.overLimit).toBeFalsy();
          expect(d.sentences[0].step).toBe(whole.sentences[0].step);
          if (whole.sentences.some(x => x.step === 'grade')) expect(d.sentences.map(x => x.step)).toContain('grade');
          if (whole.text.length <= limit) expect(d.text).toBe(whole.text);
          else dropped++;
          expectDropOrder(whole, d);
        });
      });
      // The live run: 9 of 10 drafts were over 350 before.
      expect(dropped).toBeGreaterThan(10);
    });

    it('never drops the next step, the best piece, Not Handed In or the first sentence; past that the draft is kept', () => {
      const KEEP = ['grade', 'nextStep', 'example', 'notHandedIn', 'lateWork', 'support', 'closer'];
      getStudents(cid).forEach(st => {
        const whole = draftOf(st);
        const steps = whole.sentences.map(x => x.step);
        // Only the four droppable steps out: what is left is the floor.
        const floor = whole.sentences.filter((x, i) => i === 0 || DROP.indexOf(x.step) < 0);
        const min = floor.map(x => x.text).join(' ').length;
        [min - 1, 200].forEach(limit => {
          const d = draftOf(st, { charLimit: limit });
          const left = d.sentences.map(x => x.step);
          KEEP.filter(k => steps.indexOf(k) >= 0).forEach(k => expect(left, st.firstName + ' ' + k).toContain(k));
          expect(left[0]).toBe(steps[0]);
          if (d.text.length > limit) {
            expect(d.overLimit).toBe(true);
            expect(d.text).toBe(whole.text);
          }
        });
        // Just under the floor: nothing more can go, so the whole draft stays.
        const under = draftOf(st, { charLimit: min - 1 });
        expect(under.overLimit, st.firstName).toBe(true);
        expect(under.text).toBe(whole.text);
      });
    });

    it('drops the family line first, then the strengths', () => {
      const st = byName('Tyler');
      const whole = draftOf(st);
      expect(whole.sentences.map(x => x.step)).toEqual(expect.arrayContaining(['grade', 'home', 'overall']));
      const noHome = whole.text.length - whole.sentences.find(x => x.step === 'home').text.length - 1;
      const d = draftOf(st, { charLimit: noHome });
      expect(d.sentences.map(x => x.step)).not.toContain('home');
      expect(d.sentences.map(x => x.step)).toContain('overall');
      const tight = draftOf(st, { charLimit: noHome - 1 });
      expect(tight.sentences.map(x => x.step)).not.toContain('home');
      expect(tight.sentences.map(x => x.step)).not.toContain('overall');
      expect(tight.text.length).toBeLessThanOrEqual(noHome - 1);
    });

    it('keeps the whole draft when a limit smaller than the grade sentence cannot be met', () => {
      getStudents(cid).forEach(st => {
        const whole = draftOf(st);
        const first = whole.sentences[0].text.length;
        const d = draftOf(st, { charLimit: first - 1 });
        expect(d.text, st.firstName).toBe(whole.text);
        expect(d.overLimit).toBe(true);
      });
    });

    it('never drops a sentence the teacher kept, and counts typed sentences against the limit', () => {
      const st = byName('Tyler');
      const whole = draftOf(st);
      const home = whole.sentences.find(x => x.step === 'home').text;
      const d = draftOf(st, { charLimit: 350, kept: { home } });
      expect(d.sentences.find(x => x.step === 'home').text).toBe(home);
      expect(d.text.length).toBeLessThanOrEqual(350);
      const typed = 'I enjoyed having Tyler in class this term.';
      const r = draftOf(st, { charLimit: 350, reserve: typed.length + 1 });
      expect(r.text.length + typed.length + 1).toBeLessThanOrEqual(350);
    });

    it('keeps the IE Required sentences (Report 1, Raj)', () => {
      useTerm(1);
      const st = byName('Raj');
      expect(CommentBank.reportPath(factsOf(st))).toBe('ie');
      const whole = draftOf(st);
      const required = ['grade', 'ieProblem', 'iePlan', 'ieDeadline', 'ieMeeting'];
      [100, 250].forEach(limit => {
        const d = draftOf(st, { charLimit: limit });
        whole.sentences
          .filter(x => required.indexOf(x.step) >= 0)
          .forEach(x =>
            expect(
              d.sentences.map(y => y.step),
              x.step,
            ).toContain(x.step),
          );
        expect(d.text.length <= limit || d.overLimit).toBe(true);
      });
      useTerm(2);
    });

    it('Generate on the review screen keeps to the class’s limit, the typed sentence counted in', () => {
      setLimit(350);
      const over = getStudents(cid).filter(st => draftOf(st).text.length > 350);
      expect(over.length).toBeGreaterThan(10);
      over.slice(0, 6).forEach(st => {
        upsertTermRating(cid, st.id, term(), { narrative: '' });
        open(st);
        box.value = '';
        RQ.tqGenerate();
        expect(box.value.length, st.firstName).toBeGreaterThan(0);
        expect(box.value.length, st.firstName).toBeLessThanOrEqual(350);
      });
      // With a sentence the teacher typed, kept by Generate.
      const st = over[over.length - 1];
      const typed = 'I enjoyed having this student in class this term.';
      upsertTermRating(cid, st.id, term(), { narrative: typed });
      open(st);
      box.value = typed;
      RQ.tqGenerate();
      expect(box.value).toContain(typed);
      expect(box.value.length).toBeLessThanOrEqual(350);
      setLimit(null);
    });
  });

  describe('7. the limit box', () => {
    it('reads only a whole number from 100 to 5000, or empty for no limit', () => {
      expect(CommentBank.parseLimit('')).toEqual({ ok: true, limit: null });
      expect(CommentBank.parseLimit('  ')).toEqual({ ok: true, limit: null });
      expect(CommentBank.parseLimit('100')).toEqual({ ok: true, limit: 100 });
      expect(CommentBank.parseLimit(' 5000 ')).toEqual({ ok: true, limit: 5000 });
      ['50e', 'e', '0', '-5', '99', '5001', '100.5', '1e3', '3,000', 'abc'].forEach(v =>
        expect(CommentBank.parseLimit(v), v).toEqual({ ok: false }),
      );
    });

    it('a limit older code saved below 100 is honoured and shown as is; 0, negatives and text are none', () => {
      const st = byName('Tyler');
      [0, -10, 'abc', ''].forEach(v => {
        setLimit(v);
        expect(CommentBank.classSettings(cid).charLimit, String(v)).toBeNull();
      });
      setLimit(50);
      expect(CommentBank.classSettings(cid).charLimit).toBe(50);
      upsertTermRating(cid, st.id, term(), { narrative: 'x'.repeat(70) });
      open(st);
      box.value = 'x'.repeat(70);
      expect(RQ.approveBlockers(st)).toContain('limit');
      RQ.tqLine('limitMenu');
      expect(RQ.renderTermQuestionnaire(cid)).toContain('title="Leave it empty for no limit." value="50"');
      // Left as it was, Return keeps it; a new entry under 100 is refused.
      const input = el('tq-limit-input', { dataset: { tqLimit: '1' }, value: '50' });
      const msg = el('tq-limit-msg', { hidden: true });
      els['tq-limit-input'] = input;
      els['tq-limit-msg'] = msg;
      RQ.handleKey({ key: 'Enter', target: input, preventDefault() {} });
      expect(RQ.linesOpen()).toBe(false);
      expect(settings().charLimit).toBe(50);
      RQ.tqLine('limitMenu');
      els['tq-limit-input'] = input;
      els['tq-limit-msg'] = msg;
      input.value = '60';
      RQ.handleKey({ key: 'Enter', target: input, preventDefault() {} });
      expect(RQ.linesOpen()).toBe(true);
      expect(msg.hidden).toBe(false);
      expect(settings().charLimit).toBe(50);
      RQ.closeLines();
      setLimit(null);
    });

    it('a stray letter, 0 or a negative never clears the limit; the box says what it takes', () => {
      const st = byName('Tyler');
      setLimit(350);
      upsertTermRating(cid, st.id, term(), { narrative: 'x'.repeat(400) });
      open(st);
      box.value = 'x'.repeat(400);
      RQ.tqLine('limitMenu');
      const html = RQ.renderTermQuestionnaire(cid);
      // A text box: a number box reads "350e" as empty, which cleared the limit.
      expect(html).toContain(
        '<input type="text" inputmode="numeric" autocomplete="off" placeholder="No limit" aria-label="Character limit"',
      );
      expect(html).toContain('id="tq-limit-msg" role="alert" hidden');
      const input = el('tq-limit-input', { dataset: { tqLimit: '1' } });
      const msg = el('tq-limit-msg', { hidden: true });
      els['tq-limit-input'] = input;
      els['tq-limit-msg'] = msg;
      ['350e', 'e', '0', '-5', '99', '5001', '12.5'].forEach(v => {
        input.value = v;
        RQ.tqLineChange(input);
        expect(settings().charLimit, v).toBe(350);
        expect(msg.hidden).toBe(false);
        expect(msg.textContent).toBe(MSG);
        expect(input.attrs['aria-invalid']).toBe('true');
        // Return keeps the box open with its message.
        RQ.handleKey({ key: 'Enter', target: input, preventDefault() {} });
        expect(RQ.linesOpen()).toBe(true);
        // So does a click outside it.
        RQ.clickOutside({ closest: () => null });
        expect(RQ.linesOpen()).toBe(true);
      });
      expect(RQ.approveBlockers(st)).toContain('limit');
      // A valid number clears the message and is saved.
      input.value = '400';
      RQ.tqLineChange(input);
      expect(settings().charLimit).toBe(400);
      expect(msg.hidden).toBe(true);
      expect(input.attrs['aria-invalid']).toBeUndefined();
      RQ.closeLines();
      setLimit(null);
    });

    it('Escape cancels and restores; Return and a click outside save', () => {
      const st = byName('Tyler');
      setLimit(350);
      open(st);
      const input = el('tq-limit-input', { dataset: { tqLimit: '1' } });
      if (RQ.linesOpen()) RQ.closeLines();
      // Escape: the limit stays as saved.
      RQ.tqLine('limitMenu');
      expect(RQ.linesOpen()).toBe(true);
      els['tq-limit-input'] = input;
      input.value = '900';
      RQ.handleKey({ key: 'Escape', target: input, preventDefault() {} });
      expect(settings().charLimit).toBe(350);
      // The blur as the box closes fires change: it saves nothing.
      RQ.tqLineChange(input);
      expect(settings().charLimit).toBe(350);
      expect(RQ.linesOpen()).toBe(false);
      // Opened again, the box shows the saved limit.
      RQ.tqLine('limitMenu');
      expect(RQ.renderTermQuestionnaire(cid)).toContain(
        'id="tq-limit-input" title="Leave it empty for no limit." value="350"',
      );
      // Return saves.
      els['tq-limit-input'] = input;
      input.value = '900';
      RQ.handleKey({ key: 'Enter', target: input, preventDefault() {} });
      expect(settings().charLimit).toBe(900);
      expect(RQ.linesOpen()).toBe(false);
      // A click outside saves; empty is no limit.
      RQ.tqLine('limitMenu');
      els['tq-limit-input'] = input;
      input.value = '';
      RQ.clickOutside({ closest: () => null });
      expect(settings().charLimit).toBeNull();
      expect(RQ.linesOpen()).toBe(false);
    });
  });

  describe('8. the habits source lines and the ⓘ sheet', () => {
    it('Completes Work from the record says so, not “rated” (nothing rated by the teacher)', () => {
      const st = byName('Tyler');
      upsertTermRating(cid, st.id, term(), { habits: {} });
      const f = factsOf(st);
      const ctx = CommentBank.context(f, {});
      const habits = CommentBank.effectiveHabits({}, f.record);
      expect(habits.completes).toBeTruthy();
      const word = CommentBank.SCALE[habits.completes - 1];
      const src = RQ.rowSource({ step: 'habits', edited: false, prov: null }, cid, st, f, ctx);
      expect(src).toBe('From the record: Completes Work, ' + word);
      expect(src).not.toMatch(/rated/);
      // A sentence resting on the rating names its source the same way.
      const row = { step: 'example', edited: false, prov: { factKeys: ['habit:completes'] } };
      expect(RQ.rowSource(row, cid, st, f, ctx)).toContain('From the record: Completes Work, ' + word);
    });

    it('what the teacher rated stays “rated”; the record is named apart', () => {
      const st = byName('Tyler');
      const f = factsOf(st);
      const ctx = CommentBank.context(f, {});
      const src = () => RQ.rowSource({ step: 'habits', edited: false, prov: null }, cid, st, f, ctx);
      // Five rated Consistently, Completes Work from the record.
      const keys = CommentBank.HABITS.map(h => h.key).filter(k => k !== 'completes');
      const mine = {};
      keys.forEach(k => (mine[k] = 4));
      expect(Object.keys(mine).length).toBe(5);
      upsertTermRating(cid, st.id, term(), { habits: mine });
      const rec = CommentBank.effectiveHabits(mine, f.record).completes;
      if (rec === 4) expect(src()).toBe('Five rated Consistently · From the record: Completes Work, Consistently');
      else expect(src()).toContain('From the record: Completes Work, ' + CommentBank.SCALE[rec - 1]);
      expect(src()).not.toMatch(/^All six/);
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
      expect(o.innerHTML).toContain('Until you rate it, Completes Work comes from the assignment record.');
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

  describe('9. the ⓘ sheet keeps the focus', () => {
    it('Tab and Shift-Tab cycle inside it; Escape closes it and the ⓘ button gets the focus', () => {
      const st = byName('Tyler');
      open(st);
      const info = el('tq-info-btn');
      els['tq-info-btn'] = info;
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
    it('counts “1 character”, and a stored limit of 1 says “of 1 character”', () => {
      const st = byName('Tyler');
      upsertTermRating(cid, st.id, term(), { narrative: 'x' });
      setLimit(null);
      expect(open(st)).toContain('<span class="qn-count-text" id="tq-count">1 character</span>');
      setLimit(1);
      upsertTermRating(cid, st.id, term(), { narrative: 'x'.repeat(29) });
      const html = open(st);
      box.value = 'x'.repeat(29);
      expect(html).not.toContain('1 characters');
      expect(html).toContain('<span class="qn-count-text" id="tq-count">29 of 1 character</span>');
      RQ.syncApprove();
      expect(btn.title).toContain('Shorten the comment to 1 character first.');
      expect(btn.title).not.toContain('1 characters');
      setLimit(null);
    });
  });
});
