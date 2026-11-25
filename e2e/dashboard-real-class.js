/**
 * A class shaped like a real one, for the Dashboard row's fit tests: Demo
 * Mode's Science 8 grown to 30 students, with 11 more pieces of work with
 * long names, five of them with 25 to 28 hand-ins (as the PR 1603 review
 * built it). Send Work is on. Pictures reuse the sample class's pages.
 *
 *   await openRealClass(page, { view: 'roll' });
 */
export const REAL_TITLES = [
  'Current Events: Week of September 14',
  '3.1 Imperial Demise and Restructuring: Jigsaw',
  '1.2 Why New Imperialism Happened',
  'Current Events: Week of September 21',
  '2.4 The Scramble for Africa: Primary Source Analysis',
  'Unit 1 Inquiry Project: Proposal and Research Question',
  "1.3 Social Darwinism and the White Man's Burden",
  'Current Events: Week of October 5',
  '2.1 The Opium Wars and Unequal Treaties: Document Set',
  'Reading Response: Things Fall Apart, Chapters 1 to 7',
  'Map Skills: Empires in 1914',
];

/** Grows the open class in place and draws the Dashboard again. */
export async function makeRealClass(page) {
  return page.evaluate(titles => {
    const cid = getActiveCourse();
    let st = getStudents(cid);
    const extra = [
      ['Benedict', 'Okonkwo-Hartley'],
      ['Annika', 'Vasquez-Lindqvist'],
      ['Thanh', 'Nguyen'],
    ];
    let k = 0;
    while (st.length < 30) {
      const s = JSON.parse(JSON.stringify(st[0]));
      const [f, l] = extra[k % extra.length];
      s.id = 'stx' + k;
      s.firstName = f;
      s.lastName = l;
      if ('preferred' in s) s.preferred = '';
      if ('name' in s) s.name = f + ' ' + l;
      st.push(s);
      k++;
    }
    saveStudents(cid, st);
    st = getStudents(cid);
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    const base = getAssessments(cid).find(a => a.id === 'sci8a1');
    const today = courseToday(cid);
    const day = n => new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
    const list = getAssessments(cid).slice();
    const pages = [
      'cell-lab-cece-1',
      'cell-lab-noor-1',
      'cell-lab-sam-1',
      'cell-lab-liam-1',
      'cell-lab-mateo-1',
      'cell-lab-jas-1',
      'cell-lab-fatima-1',
      'cell-lab-priya-1',
      'cell-lab-jordan-1',
      'light-lab-ines-1',
      'light-lab-sofia-1',
      'light-lab-marcus-1',
    ];
    const counts = [28, 26, 25, 12, 6, 3, 9, 2, 27, 4, 1];
    titles.forEach((t, i) => {
      const a = JSON.parse(JSON.stringify(base));
      a.id = 'hx' + i;
      a.title = t;
      a.date = day(i + 1);
      a.dueDate = day(i);
      if ('due_date' in a) a.due_date = day(i);
      list.push(a);
      work.assessments.push({ id: a.id, students_send: 'photos', after_due: 'keep', accept_until: null });
      for (let j = 0; j < counts[i] && j < st.length; j++) {
        const sid = st[j].id;
        const id = 'rx-' + sid + '-' + a.id;
        const np = j % 5 === 0 ? 2 : 1;
        const sentAt = new Date(Date.parse(day(i) + 'T15:00:00Z') + j * 600000).toISOString();
        work.submissions.push({
          id,
          assessment_id: a.id,
          enrollment_id: sid,
          version: 1,
          state: 'sent',
          sent_by: 'student',
          on_paper: false,
          is_late: j % 7 === 3,
          note: null,
          followed_plan: null,
          created_at: sentAt,
          sent_at: sentAt,
          files: Array.from({ length: np }, (_, p) => {
            const nm = pages[(j + p + i) % pages.length];
            return {
              id: id + '-p' + (p + 1),
              page: p + 1,
              path: nm + '.jpg',
              thumb_path: nm + '-thumb.jpg',
              bytes: 70000,
              thumb_bytes: 8000,
              width: 900,
              height: 1200,
              rotation: 0,
              sha256: 'x',
            };
          }),
        });
      }
    });
    saveAssessments(cid, list);
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
    return getStudents(cid).length;
  }, REAL_TITLES);
}

/** Demo Mode, the Inbox on `view`, then the real class. */
export async function openRealClass(page, { view = 'stacks' } = {}) {
  await page.addInitScript(
    ([v]) => {
      try {
        localStorage.setItem('fv-dash-inbox-view:sci8', v);
      } catch (e) {
        /* storage blocked */
      }
    },
    [view],
  );
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  await makeRealClass(page);
  await page.locator('#dash-inbox').waitFor();
  await page.waitForTimeout(300);
}
