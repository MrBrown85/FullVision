/* Generate for a whole class, the way the Term Questionnaire's Generate
 * Comment button does it (report-questionnaire.js tqGenerate): the facts,
 * the context with the habits and Focus Area on file, and one draft per
 * student with the student's own first-press seed. Students are drafted in
 * the roster's order, each draft counting as a classmate's comment for the
 * ones after it, as if the teacher approved each draft as written. */
import { loadClass } from './app.mjs';

export function generateClass(classData, report) {
  const { cid, termId, students } = loadClass(classData, report);
  const CB = globalThis.CommentBank;
  const comments = [];
  const drafts = students.map(student => {
    const f = CB.facts(cid, student, termId);
    const rating = globalThis.getStudentTermRating(cid, student.id, termId) || {};
    const ctx = CB.context(f, { habits: rating.habits || {}, focus: rating.focusSectionId || f.focusId });
    const d = CB.draft(ctx, {
      seed: CB.seedFor(student.id + '|' + termId) + 1,
      comments: comments.slice(),
      exclude: [],
    });
    comments.push({ sid: student.id, text: d.text });
    return { student, facts: f, text: d.text, angle: d.angle, replaced: d.replaced || [] };
  });
  return { cid, termId, students, drafts };
}

/* Folds a name for matching: case, accents and spacing. */
function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* The roster student a gold or edited entry names: the full name (first or
   preferred, then last), else a first or preferred name only one student
   has. null when none or more than one match. */
export function findStudent(students, name) {
  const want = fold(name);
  if (!want) return null;
  const full = students.filter(s =>
    [s.firstName, s.preferred].filter(Boolean).some(first => fold(first + ' ' + (s.lastName || '')) === want),
  );
  if (full.length === 1) return full[0];
  if (full.length > 1) return null;
  const first = students.filter(s => [s.firstName, s.preferred].filter(Boolean).some(n => fold(n) === want));
  return first.length === 1 ? first[0] : null;
}

/* [{ studentName, comment }] matched to the roster: { matched: [{ student,
   comment }], unmatched: count }. Entries are checked for shape. */
export function matchEntries(students, entries, what) {
  if (!Array.isArray(entries)) throw new Error(what + ' must be a JSON list of { studentName, comment }.');
  const matched = [];
  let unmatched = 0;
  const seen = new Set();
  entries.forEach((e, i) => {
    if (!e || typeof e.studentName !== 'string' || typeof e.comment !== 'string') {
      throw new Error(what + ' entry ' + (i + 1) + ' needs a studentName and a comment.');
    }
    const student = findStudent(students, e.studentName);
    if (!student || seen.has(student.id)) {
      unmatched++;
      return;
    }
    seen.add(student.id);
    matched.push({ student, comment: e.comment });
  });
  return { matched, unmatched };
}
