/**
 * supabase/functions/_shared/bank-steps.json, the comment bank's Next Step
 * sentences the student-submit function sends My Learning (Batch E, E9), is
 * what scripts/build-bank-steps.mjs makes from shared/bank-comment.js and
 * shared/bank-sets.js, and agrees with CommentBank.bankEntry and isSensitive.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bankSteps } from '../scripts/build-bank-steps.mjs';

describe('bank-steps.json', () => {
  it('is current: run node scripts/build-bank-steps.mjs after the bank changes', () => {
    const kept = JSON.parse(fs.readFileSync('supabase/functions/_shared/bank-steps.json', 'utf8'));
    expect(kept).toEqual(bankSteps());
  });
});
