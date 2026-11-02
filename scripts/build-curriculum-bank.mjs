#!/usr/bin/env node
/* Builds the app's BC curriculum bank, curriculum_by_course.json and
 * curriculum_data.js, from the rebuilt bank's three files (curriculum bank
 * stage 6):
 *
 *   data/bc-curriculum-source.json   the Ministry's wording, by script
 *   data/bc-curriculum-derived.json  folders, codes and names, by rule
 *   data/bc-curriculum-ican.json     I Can statements, written and reviewed
 *
 * Nothing here is typed by hand. Each course is
 *
 *   { course_name, grade, subject, categories: [
 *       { name, folder, path, competencies: [
 *           { id, tag, short_label, raw, i_can_statements } ] } ] }
 *
 * in the Ministry's order. A category with folder: true is a Ministry heading
 * that becomes a folder at import; folder: false holds competencies with no
 * folder (Social Studies, Philosophy, a one-competency heading). path is the
 * Ministry's headings above the competencies, for the card's source line.
 * The shape is what buildLearningMapFromTags (shared/data.js) and the New
 * Class wizard read; tests/helpers/bc-bank-fixture.js reads it back.
 *
 * Usage: node scripts/build-curriculum-bank.mjs [--check]
 *   --check  fail if the committed files differ from a fresh build. */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf-8'));

export function buildBank() {
  const src = read('data/bc-curriculum-source.json');
  const der = read('data/bc-curriculum-derived.json');
  const ican = read('data/bc-curriculum-ican.json');
  const bank = {};
  const missing = [];
  Object.keys(src)
    .filter(k => k[0] !== '_')
    .forEach(key => {
      const course = src[key];
      const raw = {};
      course.categories.forEach(c => c.competencies.forEach(x => (raw[x.id] = x.raw)));
      if (!der[key]) throw new Error(key + ' has no derived entry');
      bank[key] = {
        course_name: course.course_name,
        grade: course.grade,
        subject: course.subject,
        categories: der[key].categories.map(c => ({
          name: c.folder || (c.path && c.path.length ? c.path[c.path.length - 1] : course.course_name),
          folder: !!c.folder,
          path: c.path || [],
          competencies: c.competencies.map(x => {
            if (raw[x.id] == null) throw new Error(x.id + ' is not in the source');
            const statements = (ican[x.id] || {}).i_can_statements;
            if (!statements || !statements.length) missing.push(x.id);
            return {
              id: x.id,
              tag: x.code,
              short_label: x.short_label,
              raw: raw[x.id],
              i_can_statements: statements || [],
            };
          }),
        })),
      };
    });
  return { bank, missing };
}

function main() {
  const check = process.argv.includes('--check');
  const { bank, missing } = buildBank();
  const json = JSON.stringify(bank, null, 2) + '\n';
  const js = 'window._CURRICULUM_DATA = ' + JSON.stringify(bank) + ';\n';
  if (check) {
    const sameJson = readFileSync(resolve(root, 'curriculum_by_course.json'), 'utf-8') === json;
    const sameJs = readFileSync(resolve(root, 'curriculum_data.js'), 'utf-8') === js;
    if (!sameJson || !sameJs) {
      console.error(
        'curriculum_by_course.json or curriculum_data.js is not a fresh build; run node scripts/build-curriculum-bank.mjs',
      );
      process.exit(1);
    }
    console.log('Bank files match a fresh build.');
    return;
  }
  writeFileSync(resolve(root, 'curriculum_by_course.json'), json);
  writeFileSync(resolve(root, 'curriculum_data.js'), js);
  const comps = Object.values(bank).reduce(
    (n, c) => n + c.categories.reduce((m, cat) => m + cat.competencies.length, 0),
    0,
  );
  console.log(
    Object.keys(bank).length + ' courses, ' + comps + ' competencies, ' + missing.length + ' without I Can statements.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
