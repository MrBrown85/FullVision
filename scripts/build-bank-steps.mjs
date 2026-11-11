// The comment bank's Next Step sentences, for the student-submit edge
// function (Batch E, E9; my-learning-contract.md). My Learning on a
// student's card names each skill's Next Step as Preview does, from
// CommentBank.bankEntry (shared/bank-comment.js: the step toward the level
// above, at Emerging, Developing and Proficient) and never for a sensitive
// set (shared/bank-sets.js, CommentBank.isSensitive). The card does not load
// those two files (1.9 MB); the edge function sends only the class's own
// skills' sentences from this file.
//
//   node scripts/build-bank-steps.mjs [--check]
//
// Writes supabase/functions/_shared/bank-steps.json from the two bank files.
// tests/bank-steps.test.js fails when it is not current.
import fs from 'node:fs';
import vm from 'node:vm';

function load(file, name) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.window[name];
}

export function bankSteps(root = '.') {
  const bank = load(root + '/shared/bank-comment.js', 'BANK_COMMENT');
  const sets = load(root + '/shared/bank-sets.js', 'BANK_SETS');
  const ids = {};
  for (const id of Object.keys(bank.ids).sort()) ids[id] = bank.ids[id];
  const steps = bank.clusters.map(row => [row[2] || '', row[3] || '', row[4] || '']);
  const sensitive = Object.keys(sets.ids)
    .filter(id => {
      const r = sets.rows[sets.ids[id]];
      return !!(r && r[12]);
    })
    .sort();
  return { ids, steps, sensitive };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const out = 'supabase/functions/_shared/bank-steps.json';
  const text = JSON.stringify(bankSteps()) + '\n';
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text;
    console.log(
      same ? 'bank-steps.json is current' : 'bank-steps.json is stale: run node scripts/build-bank-steps.mjs',
    );
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(out, text);
  console.log('wrote ' + out + ' (' + text.length + ' bytes)');
}
