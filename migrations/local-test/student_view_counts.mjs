/* What shared/student-view.js counts for a page reply, for
   student_page_fields.py: the suite hands the database's own replies to the
   real build() and compares its To Do and Missing counts with the to_do the
   database sent.

   Reads a JSON list of page replies on stdin; writes a JSON list of build()'s
   counts ({ toDo, sent, back, missing }), one for each. Loads
   shared/constants.js and shared/student-view.js in a context of their own,
   as the student's page does, with no data layer and no calc.js: build() is
   given no reader of results, which it does not need to count. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const context = vm.createContext({});
context.window = context;
for (const file of ['shared/constants.js', 'shared/student-view.js']) {
  vm.runInContext(readFileSync(resolve(root, file), 'utf-8'), context, { filename: file });
}
const build = vm.runInContext('StudentView.build', context);
const replies = JSON.parse(readFileSync(0, 'utf-8'));
process.stdout.write(JSON.stringify(replies.map(reply => build(reply, 'class', null).counts)));
