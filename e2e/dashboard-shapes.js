/**
 * Classes of different shapes for the dashboard's layout tests, built in
 * Demo Mode with the New Class wizard's own data functions
 * (teacher/dash-class-manager.js cwFinishCreate): createCourse, the
 * reporting-term preset, curriculumGradingDefaults, buildLearningMapFromTags
 * and saveLearningMap; then a roster, assessments over three months with
 * scores, and Core Competency self-assessments when asked for.
 *
 *   buildClass(page, {
 *     name, tags: ['CAREE8'], grade: 8, grading: 'proficiency'|'letter'|'both',
 *     keep: 3,          // only the course's first N competencies (as unticking the rest)
 *     students: 28,     // roster size
 *     scores: true,     // false: nothing scored yet
 *     self: true,       // Core Competency self-assessments for two thirds of the class
 *   }) → the new class's id, made the active class
 */

const FIRST = [
  'Alexandria-Rose',
  'Maximiliano',
  'Guadalupe Esperanza',
  'Liam',
  'Aarav',
  'Ravi',
  'Arjun',
  'Omar',
  'Lucas',
  'Priya',
  'Hana',
  'Jasper',
  'Zoe',
  'Kai',
  'Amara',
  'Mei',
  'Isla',
  'Noah',
  'Sofia',
  'Ethan',
  'Chloe',
  'Mateo',
  'Ava',
  'Leo',
  'Nora',
  'Felix',
  'Ivy',
  'Owen',
  'Ruby',
  'Theo',
  'Elena',
  'Sam',
  'Yuki',
  'Dev',
];
const LAST = [
  'Vandenberghe-Okonkwo',
  'Fitzgerald-Montgomery',
  'Rodriguez de la Fuente',
  'Brown',
  'Chen',
  'Quinn',
  'Young',
  'Okafor',
  'Martin',
  'Fraser',
  'Ho',
  'Ibrahim',
  'Jones',
  'Kaur',
  'Lee',
  'Nguyen',
  'Patel',
  'Singh',
  'Garcia',
  'Dubois',
  'Wong',
  'Evans',
  'Kim',
  'Silva',
  'Novak',
  'Berg',
  'Ali',
  'Bains',
  'Cohen',
  'Dunn',
  'Ross',
  'Tran',
  'Sato',
  'Mehta',
];

export async function buildClass(page, o) {
  return page.evaluate(
    async ({ o, FIRST, LAST }) => {
      const tags = o.tags;
      const course = createCourse({
        name: o.name,
        gradeLevel: String(o.grade || 8),
        gradingSystem: o.grading || 'proficiency',
      });
      const cid = course.id;
      const cc = getCourseConfig(cid);
      const full = reportingTermPreset(null, courseToday(cid));
      if (full) cc.reportingTerms = termsInSpan(full, 'full', semesterTwoStart(full));
      Object.assign(cc, curriculumGradingDefaults(tags));
      saveCourseConfig(cid, cc);

      // Unticking competencies past the first `keep`, as the wizard's
      // second step does.
      const skip = [];
      if (o.keep) {
        let i = 0;
        tags.forEach(tag =>
          (CURRICULUM_INDEX[tag].categories || []).forEach(cat =>
            (cat.competencies || []).forEach(comp => {
              if (i++ >= o.keep) skip.push(curriculumCompKey(tag, comp));
            }),
          ),
        );
      }
      const map = withFreshLearningMapIds(buildLearningMapFromTags(tags, { skip }));
      await saveLearningMap(cid, map);
      updateCourse(cid, { curriculumTags: tags.slice() });

      const n = o.students || 28;
      const students = [];
      for (let i = 0; i < n; i++) {
        students.push({
          id: cid + '-st' + i,
          firstName: FIRST[i % FIRST.length],
          lastName: LAST[(i * 7) % LAST.length],
          pronouns: '',
          studentNumber: String(3000 + i),
          designations: [],
          attendance: [],
          enrolledDate: '2025-09-02',
        });
      }
      saveStudents(cid, students);

      const tagIds = [];
      getSections(cid).forEach(sec => (sec.tags || []).forEach(t => tagIds.push(t.id)));
      // Six assessments over three months up to today, each on about half
      // the competencies; a student's level drifts a little with the month.
      const today = new Date();
      const day = back => {
        const d = new Date(today);
        d.setDate(d.getDate() - back);
        return d.toISOString().slice(0, 10);
      };
      const assessments = [];
      for (let a = 0; a < 6; a++) {
        const date = day(80 - a * 15);
        assessments.push({
          id: cid + '-a' + a,
          title: 'Task ' + (a + 1),
          date,
          type: 'summative',
          tagIds: tagIds.filter((t, i) => (i + a) % 2 === 0 || tagIds.length <= 4),
          coreCompetencyIds: a % 2 ? ['COM'] : ['CRT'],
          created: new Date(date).toISOString(),
        });
      }
      saveAssessments(cid, assessments);
      if (o.scores !== false) {
        const sc = {};
        students.forEach((st, si) => {
          sc[st.id] = [];
          assessments.forEach((a, ai) => {
            a.tagIds.forEach((t, ti) => {
              // 1–4, mostly 2 and 3, a few students well below.
              const base = si % 5 === 0 ? 1.4 : 2 + ((si * 3 + ti) % 5) / 3;
              const score = Math.max(1, Math.min(4, Math.round(base + (ai > 3 ? 0.4 : 0) - (ti % 3 === 0 ? 0.5 : 0))));
              sc[st.id].push({
                id: a.id + '-' + st.id + '-' + t,
                assessmentId: a.id,
                tagId: t,
                score,
                date: a.date,
                note: '',
                created: a.created,
              });
            });
          });
        });
        saveScores(cid, sc);
      }

      if (o.self) {
        const key = coreSelfTerm(cid).key;
        students.forEach((st, si) => {
          if (si % 3 === 2) return;
          CORE_COMPETENCIES.forEach((core, ci) => {
            saveCoreSelfAssessment(cid, st.id, key, core.id, { level: 1 + ((si + ci) % 4) });
          });
        });
      }
      setActiveCourse(cid);
      return cid;
    },
    { o, FIRST, LAST },
  );
}

/* The dashboard for a class built here: the page drawn again for it. */
export async function showClass(page, cid) {
  await page.evaluate(id => window._pageSwitchCourse && window._pageSwitchCourse(id), cid);
  await page.locator('.dash-comp-card').waitFor();
}

/* What the stress test measured, for one view of the two overview cards:
   their heights, whether they sit side by side, the largest blank band
   inside each (from the last thing drawn to the card's inner bottom edge,
   and between rows), the Needs Support codes, sideways overflow. */
export async function measureCards(page) {
  return page.evaluate(() => {
    const comp = document.querySelector('.dash-comp-card');
    const core = document.querySelector('.dash-core-card');
    const inner = el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { top: r.top + parseFloat(cs.paddingTop), bottom: r.bottom - parseFloat(cs.paddingBottom) };
    };
    // The largest vertical gap inside a card between drawn things (rows,
    // labels, the head) and below the last, to the card's inner bottom.
    const band = (card, sel) => {
      const box = inner(card);
      const els = Array.prototype.slice
        .call(card.querySelectorAll(sel))
        .filter(el => el.offsetParent !== null && el.getBoundingClientRect().height > 0)
        .map(el => el.getBoundingClientRect())
        .sort((a, b) => a.top - b.top);
      let max = 0;
      let edge = box.top;
      els.forEach(r => {
        max = Math.max(max, r.top - edge);
        edge = Math.max(edge, r.bottom);
      });
      max = Math.max(max, box.bottom - edge);
      return Math.round(max);
    };
    const cr = comp.getBoundingClientRect();
    const kr = core.getBoundingClientRect();
    const codes = Array.prototype.map.call(
      document.querySelectorAll('.dash-comp-card .dash-comp-code'),
      el => el.textContent,
    );
    // Inside a row, what is drawn: the row's own content box with its
    // contents, so a tall row with its bar in the middle is not a gap.
    const compBand = band(
      comp,
      '.dash-comp-head, .dash-comp-labels, .dash-comp-row, .dash-comp-more, .dash-comp-moreline, .dash-comp-none',
    );
    const coreBand = band(core, '.dash-core-head, .dash-core-row');
    // Names cut short, and whether each keeps its full text in a title.
    const cut = Array.prototype.filter
      .call(
        document.querySelectorAll('.dash-comp-name, .dash-core-name, .dash-card-name'),
        el =>
          el.offsetParent !== null && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1),
      )
      .map(el => ({ cls: el.className.split(' ')[0], text: el.textContent, title: !!el.getAttribute('title') }));
    const cid = getActiveCourse();
    const allCodes = Object.values(DashInsights.columnCodes(cid));
    return {
      cut,
      allCodes,
      compH: Math.round(cr.height),
      coreH: Math.round(kr.height),
      sideBySide: Math.abs(cr.top - kr.top) < 1 && kr.left > cr.right,
      compBand,
      coreBand,
      codes,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mainOverflow: (() => {
        const m = document.getElementById('main');
        return m.scrollWidth - m.clientWidth;
      })(),
    };
  });
}
