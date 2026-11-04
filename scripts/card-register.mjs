/**
 * Whether a skill card speaks its subject's register (blind sort 3, Nov 4
 * 2026: Science 8 cards drifted into Socials and Math talk: "ask what a
 * source leaves unsaid", "word a question so the result is a number"). Every
 * content word of a card's strings must appear, by its stem, in its
 * course's Ministry text (big ideas, curricular competencies, content and
 * their elaborations) or the course's I Can statements; a short stop list
 * of everyday words a teacher uses in any subject is allowed.
 *
 *   node scripts/card-register.mjs SCI8      (prints each card's stray words)
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf-8'));

// Everyday words any subject's comment may use: function words, the verbs
// of teaching and doing, the pronoun slots, and the words of time and
// quantity. Nouns of a subject are not here: those must come from its text.
export const STOP = new Set(
  (
    'a an the and or but if so as at by for from in into of on onto to with without about after before between ' +
    'during each every one two three four five first second next last more most less few many some any all ' +
    'own other another same new old good well better clear clearly simple simply plain own own careful carefully ' +
    'his her him he she they their them it its this that these those there here what which who whom whose why how when where ' +
    'is are was were be been being has have had do does did can could will would should may might must ' +
    'not no yes also too very just then than still only even ever never always often again ' +
    'make makes made making take takes took taking give gives gave giving get gets got use uses used using ' +
    'say says said saying tell tells told show shows showed showing ask asks asked asking explain explains explained ' +
    'describe describes described describing name names named naming pick picks picked choose chooses chose chosen ' +
    'check checks checked checking try tries tried trying keep keeps kept keeping start starts started starting ' +
    'begin begins began write writes wrote written writing read reads note notes noted noting list lists listed ' +
    'find finds found finding look looks looked see sees saw seen notice notices noticed noticing think thinks thought ' +
    'help helps helped work works worked working plan plans planned planning test tests tested testing ' +
    'compare compares compared comparing change changes changed changing add adds added adding put puts ' +
    'learn learns learned learning practise practice know knows knew way ways thing things part parts piece pieces ' +
    'time times week weeks day days class lesson lessons unit home family kitchen yard together ' +
    // Words of any piece of school work and its talk.
    'sentence sentences report reports step steps several small large sure word words detail details ' +
    'reason reasons example examples set sets kind kinds include includes included decide decides decided ' +
    'happen happens happened end ends finish finishes finished order turn mark marks real true wrong easy hard ' +
    'much enough else anything someone everything around beside against while once until away back near nearby ' +
    'link links linked student students partner team notebook sheet page title label labels labelled ' +
    // The lab bench's own nouns, which the Ministry text takes as read.
    'lab labs trial trials average averages reading readings temperature thermometer ruler scale timer chart ' +
    'column columns axis axes plant plants animal animals metric metre metres litre litres gram grams millilitres centimetres'
  ).split(/\s+/),
);

/* A word's stem: lower case, a plural or verb ending off. */
export function stem(w) {
  let s = String(w).toLowerCase();
  s = s.replace(/’s$|'s$/, '');
  for (const end of ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 'ly', 's']) {
    if (s.length > end.length + 3 && s.endsWith(end)) {
      s = s.slice(0, -end.length);
      break;
    }
  }
  // "measure" and "measured", "trace" and "tracing": one stem.
  return s.replace(/e$/, '').replace(/([^aeiou])\1$/, '$1');
}

/* Every string a v2 card says about the skill: phrase, forms and steps.
   The home prompts are about family life (a cup of flour, the yard) and are
   not held to the subject's nouns. */
export function cardStrings(c) {
  const f = c.forms || {};
  const at = f.at || {};
  const next = f.next || {};
  return [c.phrase]
    .concat(f.base || [], f.did || [], at.developing || [], at.proficient || [], at.extending || [])
    .concat(Object.values(c.next_steps || {}), ...Object.values(next))
    .filter(Boolean);
}

/* The subject's own text (every course of the course's subject: its big
   ideas, competencies, content and elaborations) and their I Can
   statements, as a set of stems. */
export function courseStems(course) {
  const src = read('data/bc-curriculum-source.json');
  const ican = read('data/bc-curriculum-ican.json');
  const subject = (src[course] || {}).subject;
  const courses = new Set(Object.keys(src).filter(k => src[k] && src[k].subject === subject));
  const words = [];
  const add = t =>
    String(t || '')
      .split(/[^A-Za-z’'-]+/)
      .forEach(w => w && words.push(stem(w)));
  courses.forEach(k => add(JSON.stringify(src[k])));
  Object.values(ican)
    .filter(x => x && courses.has(x.course))
    .forEach(x => (x.i_can_statements || []).forEach(add));
  return new Set(words);
}

/* The words of a card the course's text never uses: [] when the card is in
   its subject's register. */
export function strayWords(card, stems) {
  const out = new Set();
  cardStrings(card).forEach(t =>
    String(t)
      .replace(/\{\w+\}|\[[^\]]*\]/g, ' ')
      .split(/[^A-Za-z’'-]+/)
      .filter(w => w.length >= 3)
      .forEach(w => {
        const lw = w.toLowerCase();
        if (STOP.has(lw) || /-/.test(lw)) return;
        if (!stems.has(stem(lw))) out.add(lw);
      }),
  );
  return [...out].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const course = process.argv[2] || 'SCI8';
  const comment = read('data/bc-curriculum-comment.json');
  const ican = read('data/bc-curriculum-ican.json');
  const clusters = new Set(
    Object.values(ican)
      .filter(x => x && x.course === course)
      .map(x => x.cluster),
  );
  const stems = courseStems(course);
  let bad = 0;
  [...clusters].sort().forEach(k => {
    const c = comment[k];
    if (!c || !c.forms) return;
    const stray = strayWords(c, stems);
    if (stray.length) {
      bad++;
      console.log(k + ': ' + stray.join(', '));
    }
  });
  console.log(bad ? bad + ' cards with stray words' : 'clean');
}
