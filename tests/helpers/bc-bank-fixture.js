/* A course in the rebuilt bank's shape, made from data/bc-curriculum-*.json
   the way stage 6 will write curriculum_by_course.json:

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
const read = name => JSON.parse(readFileSync(resolve(root, 'data', name), 'utf-8'));
let SRC, DER, ICAN;

export function newBankCourse(key) {
  SRC = SRC || read('bc-curriculum-source.json');
  DER = DER || read('bc-curriculum-derived.json');
  ICAN = ICAN || read('bc-curriculum-ican.json');
  const src = SRC[key];
  const raw = {};
  src.categories.forEach(c => c.competencies.forEach(x => (raw[x.id] = x.raw)));
  return {
    course_name: src.course_name,
    grade: src.grade,
    subject: src.subject,
    categories: DER[key].categories.map(c => ({
      name: c.folder || c.competencies[0].short_label,
      folder: !!c.folder,
      path: c.path,
      competencies: c.competencies.map(x => ({
        id: x.id,
        tag: x.code,
        short_label: x.short_label,
        raw: raw[x.id],
        i_can_statements: (ICAN[x.id] || {}).i_can_statements || [],
      })),
    })),
  };
}

export function newBankIndex(keys) {
  const index = {};
  keys.forEach(k => (index[k] = newBankCourse(k)));
  return index;
}
