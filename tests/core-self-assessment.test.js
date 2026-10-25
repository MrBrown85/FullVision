/**
 * Students' self-assessments of the Core Competencies (getCoreSelf /
 * saveCoreSelfAssessment), by reporting term, for the Learner Profile. The
 * student's step, words and goal; clearing every field removes it.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'core-self';

describe('core competency self-assessment', () => {
  beforeEach(() => {
    localStorage.clear();
    delete _cache.coreSelf[CID];
  });

  it('keeps each term apart and trims what the student said', () => {
    saveCoreSelfAssessment(CID, 'stu-1', 'T1', 'CRT', { level: 2, text: '  I rush the reflection.  ', goal: '' });
    saveCoreSelfAssessment(CID, 'stu-1', 'T2', 'CRT', { level: 3, text: 'I slow down now.', goal: 'Two sentences.' });
    const mine = getCoreSelf(CID)['stu-1'];
    expect(mine.T1.CRT).toMatchObject({ level: 2, text: 'I rush the reflection.', goal: '' });
    expect(mine.T2.CRT).toMatchObject({ level: 3, text: 'I slow down now.', goal: 'Two sentences.' });
    expect(typeof mine.T2.CRT.date).toBe('string');
  });

  it('removes a self-assessment with nothing left in it, and ignores a step off the scale', () => {
    saveCoreSelfAssessment(CID, 'stu-1', '', 'COM', { level: 9, text: 'Words only', goal: '' });
    expect(getCoreSelf(CID)['stu-1'][''].COM.level).toBeNull();
    saveCoreSelfAssessment(CID, 'stu-1', '', 'COM', null);
    expect(getCoreSelf(CID)['stu-1'][''].COM).toBeUndefined();
    saveCoreSelfAssessment(CID, 'stu-1', '', 'COM', { level: null, text: '   ', goal: '' });
    expect(getCoreSelf(CID)['stu-1'][''].COM).toBeUndefined();
  });
});
