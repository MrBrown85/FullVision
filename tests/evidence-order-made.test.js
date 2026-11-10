/**
 * What this device knows about when a piece of work was made (S0-F1e, for
 * the owner's choice of how same-date pieces are ordered).
 *
 * One option is "the piece made later counts later". shared/calc.js can
 * only use what the data layer holds, so this pins what that is today:
 *
 * - A piece made on this device carries its own clock's time
 *   (assessment.created) until the class is next loaded from the server.
 * - A piece loaded from the server carries no creation time: the class
 *   bundle does not send created_at for assessments, and the loader would
 *   not keep it if it did. All that is left of it is the order the pieces
 *   arrive in (display_order, then created_at, then id), which a drag
 *   rewrites.
 *
 * So "made later counts later" cannot be worked out after a reload as
 * things stand. It needs the bundle to send created_at and the loader to
 * keep it; this test fails when the loader starts keeping it, which is the
 * signal to switch _pieceOrderFacts' `made` to it.
 */
import './setup.js';
import { afterAll, describe, expect, it } from 'vitest';
import { syntheticClass } from './eval-fixture.js';
import { loadClass } from '../scripts/eval/app.mjs';

describe('when a piece was made, as the data layer holds it', () => {
  afterAll(() => {
    localStorage.clear();
    clearProfCache();
  });

  it('a class loaded from the server: no piece has a creation time, even if the bundle sent one', () => {
    const bundle = syntheticClass();
    bundle.gradebook.assessments.forEach((a, i) => {
      a.created_at = '2026-09-0' + (i + 1) + 'T16:00:00Z';
    });
    const { cid } = loadClass(bundle, 1);
    setActiveTerm(cid, null);
    const facts = _pieceOrderFacts(cid);
    expect(facts).toHaveLength(7);
    expect(facts.map(f => f.made)).toEqual(['', '', '', '', '', '', '']);
    getAssessments(cid).forEach(a => {
      expect(a.created, a.title).toBeUndefined();
      expect(a.created_at, a.title).toBeUndefined();
      expect(a.createdAt, a.title).toBeUndefined();
    });
    // What is left: the order they arrived in.
    expect(facts.map(f => f.stored)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('a piece made on this device has this device’s time, under a local id', () => {
    const { cid } = loadClass(syntheticClass(), 1);
    // As the Assignments page makes one: a local id and its own clock.
    const made = {
      id: uid(),
      title: 'New Quiz',
      scoreMode: 'proficiency',
      tagIds: [],
      date: '2026-11-09',
      created: new Date().toISOString(),
    };
    getAssessments(cid).push(made);
    clearProfCache();
    const fact = _pieceOrderFacts(cid).find(f => f.id === made.id);
    expect(fact.made).toBe(made.created);
    expect(fact.placed).toBe(0);
    expect(fact.stored).toBe(7); // after everything the server sent
    // The local id is not the server's: 's', the time in milliseconds, then random characters.
    expect(made.id).toMatch(/^s\d{13}[a-z0-9]+$/);
  });
});
