// Checks one batch of course-set wording (the source of truth in
// data/course-sets; how to write and review them: docs/course-sets):
//   node scripts/check-course-sets.mjs data/course-sets/<batch>.json
// Run it on every batch you edit, then scripts/build-course-sets.mjs.
// Format (as sample-sets.json): { "<group>": { "old": {...}, "sets": [ { "id",
// "courses", "competency_ids", "ministry", "bands": { "all" | "8-9" | "10-12":
// { phrase, next_steps: {emerging, developing, proficient, extending},
//   strength: [2], next: {developing, proficient, extending}, home } } } ] } }
// Fails (exit 1) on structure, slots, lint, US spelling and repeats; prints
// warnings for a reviewer. Run it until it says "clean".
import fs from 'fs';
import vm from 'vm';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const file = process.argv[2];
const name = file
  .split('/')
  .pop()
  .replace(/\.json$/, '');
const out = JSON.parse(fs.readFileSync(file, 'utf8'));
// The batch's groups are the file's own keys; build-course-sets.mjs checks
// that every competency lands in some batch.
const batch = Object.fromEntries(
  Object.keys(out)
    .filter(k => !k.startsWith('_'))
    .map(k => [k, out[k]]),
);
const icd = JSON.parse(fs.readFileSync(REPO + '/data/bc-curriculum-ican.json', 'utf8'));
const ican = icd.competencies || icd;
const cb = JSON.parse(fs.readFileSync(REPO + '/curriculum_by_course.json', 'utf8'));
const gradeOf = {};
for (const c of Object.values(cb))
  for (const cat of c.categories) for (const x of cat.competencies) gradeOf[x.id] = c.grade;

const ctx = { window: {}, console };
ctx.self = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(REPO + '/teacher/comment-realiser.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(REPO + '/teacher/comment-lint.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(REPO + '/shared/comment-bank.js', 'utf8') + ';this.CB=COMMENT_BANK;', ctx);
const lint = ctx.window.CommentLint;

const fill = t =>
  String(t || '')
    .replace(/\{He\}/g, 'She')
    .replace(/\{he\}/g, 'she')
    .replace(/\{His\}/g, 'Her')
    .replace(/\{his\}/g, 'her')
    .replace(/\{him\}/g, 'her')
    .replace(/\{himself\}/g, 'herself')
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1');
const STOP = new Set(
  (
    'a an the and or but of to in on at for with by from as is are was were be been being it its this that these those ' +
    'she her hers herself he his him they their them can could would will should may might do does did done has have had ' +
    'next step steps go further you ask what how why when which who one each every more most so not no into about than ' +
    'then also own way ways like such just still even if there here up out new try trying keep keeps practise practising ' +
    'work working habit habits build building'
  ).split(' '),
);
const stem = w => w.replace(/(ing|ed|es|s)$/, '');
const content = t =>
  new Set(
    fill(t)
      .replace(/\{[^}]+\}/g, ' ')
      .toLowerCase()
      .replace(/[^a-z' ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
const ov = (A, B) => {
  if (A.size < 2 || B.size < 2) return 0;
  let n = 0;
  A.forEach(x => B.has(x) && n++);
  return n / Math.min(A.size, B.size);
};
const bankSets = ctx.CB.sentences.map(s => [s.text, content(s.text)]).filter(([, s]) => s.size >= 4);

// US spellings to Canadian (Colin, Nov 4). "practice" is the noun, "practise" the verb.
const US = [
  [/\b(colou?r)\b/i, null],
  [/\bcolor/i, 'colour'],
  [/\bbehavior/i, 'behaviour'],
  [/\bhonor/i, 'honour'],
  [/\blabor\b/i, 'labour'],
  [/\bneighbor/i, 'neighbour'],
  [/\bfavorite/i, 'favourite'],
  [/\bflavor/i, 'flavour'],
  [/\bcenter/i, 'centre'],
  [/\btheater/i, 'theatre'],
  [/\bdefense\b/i, 'defence'],
  [/\boffense\b/i, 'offence'],
  [/\bcatalog\b/i, 'catalogue'],
  [/\bdialog\b/i, 'dialogue'],
  [/\btraveled|\btraveling/i, 'travelled / travelling'],
  [/\bmodeled|\bmodeling/i, 'modelled / modelling'],
  [/\blabeled|\blabeling/i, 'labelled / labelling'],
  [/\bcanceled|\bcanceling/i, 'cancelled / cancelling'],
  [/\b(to|can|will|and|or|should|must|then)\s+practice\b/i, 'practise (verb)'],
  [/\bpracticing\b/i, 'practising'],
  [/\bpracticed\b/i, 'practised'],
  [/\blicense\b(?=\s+(to|is|was|for)\b)/i, 'licence (noun)'],
  [/\bprogramme\b/i, 'program'],
];

let problems = 0;
let warnings = 0;
const say = (k, m) => (problems++, console.log(k + ': ' + m));
const warn = (k, m) => (warnings++, console.log('WARN ' + k + ': ' + m));
const LEVELS = ['emerging', 'developing', 'proficient', 'extending'];
const NEXT = ['developing', 'proficient', 'extending'];
const openers = {};
const allSentences = [];

const strings = (b, where) => [
  [where + ' phrase', b.phrase, 'phrase'],
  ...LEVELS.map(l => [where + ' next_steps.' + l, (b.next_steps || {})[l], 'step']),
  ...(b.strength || []).map((t, i) => [where + ' strength' + i, t, 'sentence']),
  ...NEXT.map(l => [where + ' next.' + l, (b.next || {})[l], 'sentence']),
  [where + ' home', b.home, 'sentence'],
];

for (const k of Object.keys(batch)) {
  const g = out[k];
  if (!g || !Array.isArray(g.sets) || !g.sets.length) {
    say(k, 'MISSING group or its sets');
    continue;
  }
  // Every competency in the group lands in exactly one set.
  const want = Object.keys(ican).filter(id => ican[id] && ican[id].cluster === k);
  const got = {};
  g.sets.forEach(s => (s.competency_ids || []).forEach(id => (got[id] = (got[id] || 0) + 1)));
  want.forEach(id => {
    if (!got[id]) say(k, id + ' is in no set');
    else if (got[id] > 1) say(k, id + ' is in ' + got[id] + ' sets');
  });
  Object.keys(got).forEach(id => {
    if (!want.includes(id)) say(k, id + ' does not belong to this group');
  });
  const ids = new Set();
  const groupSent = [];
  for (const s of g.sets) {
    if (!s.id || !s.id.startsWith(k + '--')) say(k, 'set id must start with "' + k + '--": ' + s.id);
    if (ids.has(s.id)) say(k, 'set id twice: ' + s.id);
    ids.add(s.id);
    if (!(s.courses || []).length) say(s.id, 'no courses');
    const grades = (s.competency_ids || []).map(id => gradeOf[id]).filter(Boolean);
    const lo = grades.some(x => x <= 9);
    const hi = grades.some(x => x >= 10);
    const bands = Object.keys(s.bands || {});
    if (lo && hi && !(bands.includes('8-9') && bands.includes('10-12')))
      say(s.id, 'spans grades 8–12: write both 8-9 and 10-12');
    if (!(lo && hi) && !(bands.length === 1)) say(s.id, 'one grade band expected ("all"), got ' + bands.join(', '));
    if (bands.length === 2 && JSON.stringify(s.bands[bands[0]]) === JSON.stringify(s.bands[bands[1]]))
      say(s.id, 'bands identical');
    for (const band of bands) {
      const b = s.bands[band];
      const where = s.id + ' ' + band;
      if ((b.strength || []).length !== 2) say(where, 'needs 2 strengths');
      strings(b, where).forEach(([id, t, kind]) => {
        // A sensitive set may leave out its home line (Colin, Nov 4: the abuse
        // home line does not go in a report card).
        if (!t) return s.sensitive && id.endsWith(' home') ? null : say(id, 'missing');
        // they/them/their often mean other people, so only the student's
        // own pronouns are checked here.
        if (/\b(she|her|hers|he|his|him)\b/i.test(t.replace(/\{(He|he|His|his|him|himself)\}/g, '')))
          say(id, 'bare pronoun, use {He}/{his}/{him}: ' + t);
        const bad = t.match(
          /\{[Hh]e\}\s+(?:(?:always|usually|often|also|now|still|regularly)\s+)?(?!\[)([a-z]+s|is|was|has|does)\b/,
        );
        if (bad) say(id, 'verb after {He} needs [s-form|plain] ("' + bad[1] + '"): ' + t);
        const f = fill(t);
        US.forEach(([re, fix]) => fix && re.test(f) && say(id, 'Canadian spelling: ' + fix + ': ' + f));
        if (kind === 'sentence') {
          if (!/^[A-Z]/.test(f) || !/[.?]$/.test(f)) say(id, 'not a full sentence: ' + f);
          (lint.findings(f) || []).forEach(x =>
            say(id, 'lint ' + (x.rule || x.id || x.kind || JSON.stringify(x)) + ': ' + f),
          );
          const A = content(t);
          for (const [bt, B] of bankSets)
            if (ov(A, B) >= 0.8) {
              warn(id, 'near the bank: "' + f + '" ~ "' + fill(bt) + '"');
              break;
            }
          groupSent.push([id, A, f]);
          allSentences.push(f);
          if (id.includes(' next.')) {
            const o = f.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
            openers[o] = (openers[o] || 0) + 1;
          }
        } else {
          if (/[.?!]$/.test(f.trim()) || /^[A-Z]/.test(f.trim()))
            say(id, 'a phrase is lower case with no end punctuation: ' + f);
          if (f.split(/\s+/).length > 16) warn(id, 'long phrase (' + f.split(/\s+/).length + ' words): ' + f);
          // The phrase reads after "she can …" and a step after "her next step is to …".
          (lint.findings((kind === 'phrase' ? 'She can ' : 'Her next step is to ') + f + '.') || []).forEach(x =>
            say(id, 'lint ' + (x.rule || x.id || x.kind || JSON.stringify(x)) + ': ' + f),
          );
        }
      });
      // A next step names a skill or habit to practise, not a content task (Colin, Nov 4).
      [...LEVELS.map(l => (b.next_steps || {})[l]), ...NEXT.map(l => (b.next || {})[l])].forEach(t => {
        if (
          t &&
          /\b(read|watch|visit|research|write an essay on|study the|learn about|choose a topic|pick a topic)\b/i.test(
            fill(t),
          )
        )
          warn(where, 'next step may prescribe content: ' + fill(t));
      });
    }
  }
  for (let i = 0; i < groupSent.length; i++)
    for (let j = i + 1; j < groupSent.length; j++)
      if (ov(groupSent[i][1], groupSent[j][1]) >= 0.7)
        say(groupSent[i][0], 'repeats ' + groupSent[j][0] + ': ' + groupSent[i][2]);
}
const extra = Object.keys(out).filter(k => !batch[k] && !k.startsWith('_'));
if (extra.length) say('batch', 'groups not in this batch: ' + extra.join(', '));

const n = Object.values(openers).reduce((a, b) => a + b, 0);
Object.entries(openers)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3)
  .forEach(
    ([o, c]) => c / n > 0.15 && n > 10 && warn('openers', `${Math.round((100 * c) / n)}% of next steps open "${o} …"`),
  );
console.log(
  (problems ? problems + ' problems' : 'clean') +
    (warnings ? ', ' + warnings + ' to look at' : '') +
    ` (${allSentences.length} sentences)`,
);
process.exitCode = problems ? 1 : 0;
