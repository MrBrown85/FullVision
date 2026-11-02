/* A course from the app's BC curriculum bank (curriculum_by_course.json,
   built from data/ by scripts/build-curriculum-bank.mjs):

     { course_name, grade, subject, categories: [
         { name, folder, path, competencies: [
             { id, tag, short_label, raw, i_can_statements } ] } ] }

   A category with folder: true is a Ministry heading that becomes a folder;
   folder: false holds a competency with no folder (Social Studies, a
   one-competency heading). */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let BANK;

export function newBankCourse(key) {
  BANK = BANK || JSON.parse(readFileSync(resolve(root, 'curriculum_by_course.json'), 'utf-8'));
  if (!BANK[key]) throw new Error(key + ' is not in curriculum_by_course.json');
  return structuredClone(BANK[key]);
}

export function newBankIndex(keys) {
  const index = {};
  keys.forEach(k => (index[k] = newBankCourse(k)));
  return index;
}
