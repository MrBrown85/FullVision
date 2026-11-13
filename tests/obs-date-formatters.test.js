/**
 * Dates on the Dashboard's Observations card and on observation cards are
 * written with formatters made once, not one per cell or card.
 *
 * Making a date formatter is slow (toLocaleDateString with options makes
 * one each call). The Observations card labelled every week of every
 * student, empty weeks included, before it knew the cell was empty: 240
 * formatters a draw on a class of 30. Each observation card made one or two.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'c-obs-dates';
const students = Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, firstName: 'First' + i, lastName: 'Last' + i }));
const stubbed = ['getTodayStr', 'getActiveTerm', 'getStudentQuickObs', 'getSections', 'getTagScores'];
const originals = {};

// Counts every date formatter made, directly or through toLocale*String.
const real = {
  DTF: Intl.DateTimeFormat,
  date: Date.prototype.toLocaleDateString,
  time: Date.prototype.toLocaleTimeString,
  str: Date.prototype.toLocaleString,
};
let made = 0;
function meterOn() {
  made = 0;
  const Counted = function (locales, opts) {
    made++;
    return new real.DTF(locales, opts);
  };
  Counted.prototype = real.DTF.prototype;
  Counted.supportedLocalesOf = real.DTF.supportedLocalesOf;
  Intl.DateTimeFormat = Counted;
  ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].forEach((name, i) => {
    const orig = [real.date, real.time, real.str][i];
    Date.prototype[name] = function () {
      if (arguments.length) made++;
      return orig.apply(this, arguments);
    };
  });
}
function meterOff() {
  Intl.DateTimeFormat = real.DTF;
  Date.prototype.toLocaleDateString = real.date;
  Date.prototype.toLocaleTimeString = real.time;
  Date.prototype.toLocaleString = real.str;
}

describe('date formatters are made once', () => {
  beforeEach(() => {
    stubbed.forEach(k => (originals[k] = globalThis[k]));
    globalThis.getTodayStr = () => '2026-10-18';
    globalThis.getActiveTerm = () => null;
    // A few students observed, most weeks empty.
    globalThis.getStudentQuickObs = (cid, sid) =>
      Number(sid.slice(1)) % 5 === 0
        ? [{ id: 'ob-' + sid, date: '2026-10-14', created: '2026-10-14T15:00:00Z', sentiment: 'strength', text: 'A' }]
        : [];
    globalThis.getSections = () => [];
    globalThis.getTagScores = () => [];
    COURSES[CID] = { id: CID, name: 'Test', gradingSystem: 'proficiency' };
  });
  afterEach(() => {
    meterOff();
    stubbed.forEach(k => (globalThis[k] = originals[k]));
    delete COURSES[CID];
  });

  it('the Observations card makes no formatter per week cell', () => {
    DashObservations.renderCard(CID, students, { tab: 'week' }); // first draw may make them
    meterOn();
    const html = DashObservations.renderCard(CID, students, { tab: 'week' });
    DashObservations.renderCard(CID, students, { tab: 'week' });
    meterOff();
    expect(made).toBe(0);
    expect(html).toContain('First0 Last0, week of Oct 12');
  });

  it('an observation card makes no formatter per card', () => {
    const obs = Array.from({ length: 50 }, (_, i) => ({
      id: 'o' + i,
      date: '2026-10-' + String((i % 28) + 1).padStart(2, '0'),
      created: '2026-10-' + String((i % 28) + 1).padStart(2, '0') + 'T15:' + String(i % 60).padStart(2, '0') + ':00Z',
    }));
    const old = { id: 'old', date: '2019-03-04', created: '2019-03-04T18:05:00Z' };
    ObsCard.cardWhen(obs[0]);
    ObsCard.cardWhen(old);
    meterOn();
    const got = obs.map(ob => ObsCard.cardWhen(ob)).concat(ObsCard.cardWhen(old), ObsCard.cardWhen(old, true));
    meterOff();
    expect(made).toBe(0);
    // The same words toLocale*String gives.
    const want = ob => {
      const d = new Date(ob.created);
      const opts = { weekday: 'short', month: 'short', day: 'numeric' };
      if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
      return d.toLocaleDateString('en-CA', opts);
    };
    obs.forEach((ob, i) =>
      expect(got[i]).toBe(
        want(ob) + ' · ' + new Date(ob.created).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }),
      ),
    );
    expect(got[51]).toBe(want(old));
    expect(got[51]).toContain('2019');
  });

  it('an observation with no readable date reads as before, and the card is still drawn', () => {
    // toLocaleDateString gave "Invalid Date"; a formatter's format() throws.
    const bad = { id: 'bad' };
    expect(() => ObsCard.cardWhen(bad)).not.toThrow();
    expect(ObsCard.cardWhen(bad)).toBe(new Date('x').toLocaleDateString('en-CA', { weekday: 'short' }));
    expect(ObsCard.cardWhen({ id: 'bad2', created: 'not a date' })).toBe('Invalid Date · Invalid Date');
  });
});
