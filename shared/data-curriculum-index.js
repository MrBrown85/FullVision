// @ts-check
/* The BC curriculum index: the bank, the New Class wizard's course lists, and the learning map built from it.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   BC Curriculum Index Loader (unchanged — not persisted data)
   ══════════════════════════════════════════════════════════════════ */
/** @typedef {{ id?: string, tag?: string, short_label?: string, raw?: string, i_can_statements?: unknown[] }} CurriculumCompetency */
/** @typedef {{ name: string, folder?: boolean, competencies?: CurriculumCompetency[] }} CurriculumCategory */
/** @typedef {{ course_name: string, subject: string, grade: unknown, categories?: CurriculumCategory[] }} CurriculumCourse */
/** @type {Record<string, CurriculumCourse> | null} */
let CURRICULUM_INDEX = null;

async function loadCurriculumIndex() {
  if (CURRICULUM_INDEX) return CURRICULUM_INDEX;
  if (window._CURRICULUM_DATA) {
    CURRICULUM_INDEX = /** @type {Record<string, CurriculumCourse>} */ (window._CURRICULUM_DATA);
    return CURRICULUM_INDEX;
  }
  try {
    const resp = await fetch('/curriculum_by_course.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    CURRICULUM_INDEX = await resp.json();
    return CURRICULUM_INDEX;
  } catch (e) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/curriculum_data.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      if (window._CURRICULUM_DATA) {
        CURRICULUM_INDEX = /** @type {Record<string, CurriculumCourse>} */ (window._CURRICULUM_DATA);
        return CURRICULUM_INDEX;
      }
      throw new Error('Script loaded but no data');
    } catch (e2) {
      console.error('Failed to load curriculum index:', e, e2);
      return null;
    }
  }
}

function getCoursesByGrade(grade) {
  if (!CURRICULUM_INDEX) return [];
  const results = [];
  for (const [shortTag, course] of Object.entries(CURRICULUM_INDEX)) {
    if (course.grade === grade) {
      let competencyCount = 0;
      for (const cat of course.categories || []) {
        competencyCount += (cat.competencies || []).length;
      }
      results.push({
        short_tag: shortTag,
        course_name: course.course_name,
        subject: course.subject,
        competencyCount: competencyCount,
        categoryCount: (course.categories || []).length,
        statementCount: competencyCount,
      });
    }
  }
  return results.sort((a, b) => a.course_name.localeCompare(b.course_name));
}

function getSubjectsByGrade(grade) {
  if (!CURRICULUM_INDEX) return [];
  const subjects = new Set();
  for (const course of Object.values(CURRICULUM_INDEX)) {
    if (course.grade === grade) subjects.add(course.subject);
  }
  return [...subjects].sort();
}

/* The class's learning map from the BC curriculum courses it links to.
   One section per competency, named from the bank's short_label (one name
   per competency). A category marked folder: true becomes a folder holding
   its competencies; other categories (Social Studies, one-competency
   headings, every category of the old bank) leave theirs ungrouped. The
   order is the Ministry's: folders take the place of their first
   competency. A competency keeps the bank's id (tag.bank_id) when it has a
   stable one ("bc.…"). In a combined class, a folder name two courses share
   is prefixed with the course name, and a code two courses share gets a
   course mark ("C" + "CP1"), so no two columns read the same.
   options.skip: competencies the teacher unticked in the wizard, by
   curriculumCompKey. */
function buildLearningMapFromTags(shortTags, options) {
  if (!CURRICULUM_INDEX)
    return { subjects: [], sections: [], competencyGroups: [], _customized: true, _version: 1, _flatVersion: 2 };
  const skip = new Set((options && options.skip) || []);
  const courses = shortTags
    .map(courseTag => ({
      courseTag,
      course: /** @type {Record<string, CurriculumCourse>} */ (CURRICULUM_INDEX)[courseTag],
    }))
    .filter(x => x.course && x.course.categories && x.course.categories.length);
  const isHybrid = courses.length > 1;
  const kept = (courseTag, cat) =>
    (cat.competencies || []).filter(comp => !skip.has(curriculumCompKey(courseTag, comp)));

  // Folder names and codes more than one course uses.
  const folderCourses = {};
  const codeCourses = {};
  courses.forEach(({ courseTag, course }) => {
    course.categories.forEach(cat => {
      const comps = kept(courseTag, cat);
      if (!comps.length) return;
      if (cat.folder === true) (folderCourses[cat.name] = folderCourses[cat.name] || new Set()).add(courseTag);
      comps.forEach(comp => {
        if (comp.tag) (codeCourses[comp.tag] = codeCourses[comp.tag] || new Set()).add(courseTag);
      });
    });
  });
  const marks = _curriculumCourseMarks(courses.map(x => x.courseTag));

  const subjects = [];
  const sections = [];
  const competencyGroups = [];
  const seenCategoryNames = {};
  const usedCodes = {};

  for (const { courseTag, course } of courses) {
    const colour = SUBJECT_COLOURS[course.subject] || '#6366f1';
    let addedSections = false;
    const usedTagIds = {};

    for (const category of course.categories) {
      const comps = kept(courseTag, category);
      if (!comps.length) continue;

      /** @type {{ id: string, name: string, color: string, sortOrder: number, displayOrder: number } | null} */
      let group = null;
      if (category.folder === true) {
        const shared = isHybrid && folderCourses[category.name].size > 1;
        group = {
          id: 'grp_' + courseTag + '_' + competencyGroups.length,
          name: shared ? _curriculumFolderPrefix(courseTag, courses) + ': ' + category.name : category.name,
          color: colour,
          sortOrder: competencyGroups.length,
          displayOrder: competencyGroups.length,
        };
        competencyGroups.push(group);
      }

      // Old bank: a category is a heading shared by its competencies, and
      // a name two courses share is prefixed with the course key.
      let sectionName = category.name;
      if (isHybrid && !group) {
        if (seenCategoryNames[category.name] && seenCategoryNames[category.name] !== courseTag) {
          sectionName = courseTag + ': ' + category.name;
          sections
            .filter(s => s.name === category.name && s._category)
            .forEach(s => {
              s.name = seenCategoryNames[category.name] + ': ' + category.name;
              s.tags[0].name = s.name;
            });
        }
        seenCategoryNames[category.name] = seenCategoryNames[category.name] || courseTag;
      }

      for (const comp of comps) {
        const fromBank = typeof comp.id === 'string' && comp.id.indexOf('bc.') === 0;
        // New bank: each competency is named from its own short_label.
        const name = fromBank || group ? comp.short_label || sectionName : sectionName;
        let code = comp.tag;
        if (isHybrid && code && codeCourses[code] && codeCourses[code].size > 1) code = marks[courseTag] + code;
        if (code && usedCodes[code]) console.warn('Curriculum import: code ' + code + ' repeats in this class.');
        if (code) usedCodes[code] = true;

        let baseId = isHybrid ? courseTag + '_' + comp.tag : comp.tag;
        if (usedTagIds[baseId]) {
          usedTagIds[baseId]++;
          baseId = baseId + usedTagIds[baseId];
        } else {
          usedTagIds[baseId] = 1;
        }
        const shortName = fromBank || group ? _curriculumShortName(name) : _curriculumCategoryShortName(category.name);
        const tag = {
          id: baseId,
          code: code,
          label: comp.short_label,
          text: comp.raw,
          source_text: comp.raw,
          i_can_statements: comp.i_can_statements || [],
          bank_id: fromBank ? comp.id : null,
          color: colour,
          subject: courseTag,
          name: name,
          shortName: shortName,
        };
        const sec = {
          id: baseId,
          subject: courseTag,
          name: name,
          shortName: shortName,
          color: colour,
          tags: [tag],
        };
        if (group) sec.groupId = group.id;
        if (!fromBank && !group) Object.defineProperty(sec, '_category', { value: true });
        sections.push(sec);
        addedSections = true;
      }
    }
    if (addedSections) {
      // `family` is the BC subject area ("Physical and Health Education"),
      // which the Term Questionnaire's Comment Bank reads to offer wording
      // for that kind of class.
      subjects.push({ id: courseTag, name: course.course_name, color: colour, family: course.subject });
    }
  }

  sections.forEach((sec, i) => {
    sec.sortOrder = i;
    sec.displayOrder = i;
  });
  return { subjects, sections, competencyGroups, _customized: true, _version: 1, _flatVersion: 2 };
}

/* How the wizard names one competency of a course: its bank id, or, in the
   old bank, whose ids can repeat within a course, the course and the
   competency's place in it. */
function curriculumCompKey(courseTag, comp) {
  if (typeof comp.id === 'string' && comp.id.indexOf('bc.') === 0) return comp.id;
  const course = CURRICULUM_INDEX && CURRICULUM_INDEX[courseTag];
  const all = course ? (course.categories || []).flatMap(cat => cat.competencies || []) : [];
  const at = all.indexOf(comp);
  return courseTag + ':' + (at >= 0 ? at : comp.id || comp.tag);
}

/* What a folder name two courses share is prefixed with: the course name,
   or, when another course in the class has the same name (English First
   Peoples Literary Studies 10 and Literary Studies 10), the name and key. */
function _curriculumFolderPrefix(courseTag, courses) {
  const name = /** @type {Record<string, CurriculumCourse>} */ (CURRICULUM_INDEX)[courseTag].course_name;
  const twin = courses.some(x => x.courseTag !== courseTag && x.course.course_name === name);
  return twin ? name + ' (' + courseTag + ')' : name;
}

/* The grading switches a new curriculum class starts with: one course,
   Folders Count as One on; two or more, Each Course Counts Equally on and
   Folders Count as One off (curriculum bank decision 10). */
function curriculumGradingDefaults(shortTags) {
  const n = (shortTags || []).filter(t => CURRICULUM_INDEX && CURRICULUM_INDEX[t]).length;
  return n > 1
    ? { foldersCountAsOne: false, coursesCountEqually: true }
    : { foldersCountAsOne: true, coursesCountEqually: false };
}

/* A short mark per course for codes two courses share, at most two
   characters so a marked code stays within six: the key's first letter, or,
   when another course in the class starts with the same letter, that letter
   and the first character where their keys (less the grade) differ
   (COMP10 + LS10 → C, L; COMP10 + CW10 → CO, CW; ECOM12 + ECONBUS12 → EM,
   EN; SA2D10 + SA3D10 → S2, S3; WEX12A + WEX12B → WA, WB). */
function _curriculumCourseMarks(courseTags) {
  const keys = courseTags.map(t =>
    String(t)
      .toUpperCase()
      .replace(/\d{1,2}([A-Z]?)$/, '$1')
      .replace(/[^A-Z0-9]/g, ''),
  );
  const marks = {};
  courseTags.forEach((t, i) => {
    const own = keys[i] || String(t).toUpperCase();
    const rivals = keys.filter((k, j) => j !== i && k[0] === own[0]);
    if (!rivals.length) return (marks[t] = own[0]);
    // The first position where every key sharing this letter differs.
    const group = [own].concat(rivals);
    let at = 1;
    while (at < own.length && new Set(group.map(k => k[at] || '')).size < group.length) at++;
    marks[t] = own[0] + (own[at] || String(i));
  });
  return marks;
}

/* A competency's short name: its own name, kept whole up to 20 characters. */
function _curriculumShortName(name) {
  name = String(name || '');
  return name.length > 20 ? name.slice(0, 18) + '\u2026' : name;
}

/* The old bank's short name for a category heading. */
function _curriculumCategoryShortName(name) {
  const short = String(name || '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .split(/\s+and\s+/i)[0]
    .trim();
  return _curriculumShortName(short);
}
