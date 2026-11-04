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
 * It also builds shared/bank-comment.js, what Generate names a bank
 * competency by (data/bc-curriculum-comment.json): window.BANK_COMMENT =
 * { ids: { competency id: cluster index }, clusters: [[phrase, skill key or
 * null, next step at Emerging, at Developing, at Proficient, version 2 or
 * 0], ...] }. Every card is read as version 2 (cardV2): a version 1 card
 * becomes forms.base = [phrase] with the rest empty, and its slot 5 is 0 so
 * the engine falls back to the version 1 wording; a card with version 2
 * wording ships it in slot 5 as { a: area, b: base forms, d: did forms,
 * at: { developing, proficient, extending }, o: overrides, x: the
 * Extending next step, ev: evidence, h: home invitations }.
 *
 * And shared/bank-proficiency.js, each competency's four level descriptors
 * for printed Tag Rubrics (data/bc-curriculum-proficiency.json), loaded only
 * when a rubric is printed: window.BANK_PROFICIENCY = { ids: { competency
 * id: set index }, levels: [[Emerging, Developing, Proficient, Extending],
 * ...] }, each distinct set stored once.
 *
 * And shared/bank-core-competencies.js, each Core Competency's name, group
 * and the first sentence of the Ministry's description
 * (data/bc-core-competencies.json), loaded the first time the assessment
 * form's Core Competency hover shows: window.BANK_CORE_COMPETENCIES = { id:
 * { name, group, description } }.
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

/* A card as version 2 (plan v1 section 2, "The Schema"): every field
   present, a version 1 card's empty. */
export function cardV2(c) {
  const forms = c.forms || {};
  const at = forms.at || {};
  return {
    phrase: c.phrase,
    area: c.area || '',
    forms: {
      base: forms.base && forms.base.length ? forms.base.slice() : [c.phrase],
      did: (forms.did || []).slice(),
      at: {
        developing: (at.developing || []).slice(),
        proficient: (at.proficient || []).slice(),
        extending: (at.extending || []).slice(),
      },
      override: Object.assign({}, forms.override || {}),
    },
    skill_key: c.skill_key,
    next_steps: Object.assign({ extending: '' }, c.next_steps),
    evidence: c.evidence || '',
    home: (c.home || []).slice(),
    exemplar: c.exemplar,
    version: c.forms ? 2 : 1,
  };
}
/* Whether a version 2 card has wording beyond the version 1 phrase. */
function v2Slot(v) {
  if (v.version !== 2) return 0;
  const out = {
    a: v.area,
    b: v.forms.base,
    d: v.forms.did,
    at: v.forms.at,
    x: v.next_steps.extending,
    ev: v.evidence,
    h: v.home,
  };
  if (Object.keys(v.forms.override).length) out.o = v.forms.override;
  return out;
}

export function buildComment() {
  const comment = read('data/bc-curriculum-comment.json');
  const ican = read('data/bc-curriculum-ican.json');
  const keys = Object.keys(comment)
    .filter(k => k[0] !== '_')
    .sort();
  const index = {};
  const clusters = keys.map((k, i) => {
    index[k] = i;
    const c = cardV2(comment[k]);
    return [c.phrase, c.skill_key, c.next_steps.emerging, c.next_steps.developing, c.next_steps.proficient, v2Slot(c)];
  });
  const ids = {};
  Object.keys(ican)
    .filter(k => k[0] !== '_')
    .sort()
    .forEach(id => {
      if (index[ican[id].cluster] == null) throw new Error(id + ' has no comment cluster');
      ids[id] = index[ican[id].cluster];
    });
  return { ids, clusters };
}

export function buildProficiency() {
  const prof = read('data/bc-curriculum-proficiency.json');
  const ids = {};
  const levels = [];
  const seen = {};
  Object.keys(prof)
    .filter(k => k[0] !== '_')
    .sort()
    .forEach(id => {
      const l = prof[id].levels;
      const set = [l.emerging, l.developing, l.proficient, l.extending];
      if (set.some(t => !t)) throw new Error(id + ' is missing a level descriptor');
      const key = JSON.stringify(set);
      if (seen[key] == null) {
        seen[key] = levels.length;
        levels.push(set);
      }
      ids[id] = seen[key];
    });
  return { ids, levels };
}

export function buildCore() {
  const core = read('data/bc-core-competencies.json');
  const out = {};
  Object.keys(core)
    .filter(k => k[0] !== '_')
    .forEach(id => {
      const c = core[id];
      const para = (c.description || [])[0] || '';
      // The first sentence, word for word.
      const m = para.match(/^.*?[.!?](?=\s|$)/);
      const description = m ? m[0] : para;
      if (!c.name || !description) throw new Error(id + ' is missing its name or description');
      out[id] = { name: c.name, group: c.group || '', description };
    });
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const { bank, missing } = buildBank();
  const json = JSON.stringify(bank, null, 2) + '\n';
  const js = 'window._CURRICULUM_DATA = ' + JSON.stringify(bank) + ';\n';
  const commentJs =
    '/* Built by scripts/build-curriculum-bank.mjs from data/bc-curriculum-comment.json; do not edit. */\n' +
    'window.BANK_COMMENT = ' +
    JSON.stringify(buildComment()) +
    ';\n';
  const profJs =
    '/* Built by scripts/build-curriculum-bank.mjs from data/bc-curriculum-proficiency.json; do not edit. */\n' +
    'window.BANK_PROFICIENCY = ' +
    JSON.stringify(buildProficiency()) +
    ';\n';
  const coreJs =
    '/* Built by scripts/build-curriculum-bank.mjs from data/bc-core-competencies.json; do not edit. */\n' +
    'window.BANK_CORE_COMPETENCIES = ' +
    JSON.stringify(buildCore()) +
    ';\n';
  if (check) {
    const sameJson = readFileSync(resolve(root, 'curriculum_by_course.json'), 'utf-8') === json;
    const sameJs = readFileSync(resolve(root, 'curriculum_data.js'), 'utf-8') === js;
    const sameComment = readFileSync(resolve(root, 'shared/bank-comment.js'), 'utf-8') === commentJs;
    const sameProf = readFileSync(resolve(root, 'shared/bank-proficiency.js'), 'utf-8') === profJs;
    const sameCore = readFileSync(resolve(root, 'shared/bank-core-competencies.js'), 'utf-8') === coreJs;
    if (!sameJson || !sameJs || !sameComment || !sameProf || !sameCore) {
      console.error(
        'curriculum_by_course.json, curriculum_data.js or a shared/bank-*.js file is not a fresh build; run node scripts/build-curriculum-bank.mjs',
      );
      process.exit(1);
    }
    console.log('Bank files match a fresh build.');
    return;
  }
  writeFileSync(resolve(root, 'curriculum_by_course.json'), json);
  writeFileSync(resolve(root, 'curriculum_data.js'), js);
  writeFileSync(resolve(root, 'shared/bank-comment.js'), commentJs);
  writeFileSync(resolve(root, 'shared/bank-proficiency.js'), profJs);
  writeFileSync(resolve(root, 'shared/bank-core-competencies.js'), coreJs);
  const comps = Object.values(bank).reduce(
    (n, c) => n + c.categories.reduce((m, cat) => m + cat.competencies.length, 0),
    0,
  );
  console.log(
    Object.keys(bank).length + ' courses, ' + comps + ' competencies, ' + missing.length + ' without I Can statements.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
