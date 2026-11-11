/* Demo Mode's sample Cell Microscope Lab (Science 8) has every student's
   grade returned: ten sent work, and the other seventeen were graded from
   paper. GraderWork (shared/grader.js) counts a student graded from paper
   as Returned, not Not In, so on the sample class nobody is Not In on the
   Lab. The phone's not-in tests need students with nothing in: this takes
   the grades off the students who sent nothing (before the build switch is
   turned on, as the tests' clearLab does), so they are Not In. Answers the
   students it cleared, in the class's order. */
export function ungradeLabNotSent(cid, aid) {
  const a = getAssessments(cid).find(x => x.id === aid);
  const cleared = [];
  getStudents(cid).forEach(st => {
    if (getStudentSubmission(cid, st.id, aid)) return;
    const keys = [...new Set((getScores(cid)[st.id] || []).filter(e => e.assessmentId === aid).map(e => e.tagId))];
    Grader.setOverallComment(cid, st.id, aid, '');
    getRubricCheckIds(cid, st.id, aid).forEach(id => Grader.setTick(cid, st.id, aid, id, false));
    if (keys.length) Grader.clearScore(cid, getScores(cid), st.id, a, keys);
    cleared.push(st.id);
  });
  return cleared;
}
