/* Core Competency self-assessments: which reporting term they are read for,
   and each student's step this term. The student page (teacher/page-student.js)
   and the dashboard's Core Competencies card (teacher/dash-overview.js) both
   read them through here, so they always agree on the term.

   A step is the student's own (Beginning / Growing / Confident / Leading,
   CONFIDENCE_LABELS), never a teacher's grade. */

/* The reporting term the self-assessments are read for: the one picked
   (chosenOrdinal, the student page's term buttons), else the term in view
   (activeTerm), else the term today falls in, else the last one.
   → { terms, pick, key } with key 'T' + the term's ordinal; a class without
   terms gives { terms: [], key: '' } and no pick. */
function coreSelfTerm(cid, chosenOrdinal, activeTerm) {
  var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
  if (!terms.length) return { terms: [], key: '' };
  var pick = terms.find(function (t) {
    return t.ordinal === chosenOrdinal;
  });
  if (!pick && activeTerm)
    pick = terms.find(function (t) {
      return t.ordinal === activeTerm.ordinal;
    });
  if (!pick) {
    var today = typeof getTodayStr === 'function' ? getTodayStr() : new Date().toISOString().slice(0, 10);
    pick =
      terms.find(function (t) {
        return t.starts_on <= today && today <= t.ends_on;
      }) || terms[terms.length - 1];
  }
  return { terms: terms, pick: pick, key: 'T' + pick.ordinal };
}

/* Each student's step on each Core Competency this term, as the student page
   shows it: what the teacher entered for them first, else what the student
   gave in that term's questionnaire (once StudentVoice has the answers).
   → { key, pick, any, byCore: { coreId: { sid: level 1–4 } } }; a student
   with no step is left out. */
function coreSelfRatings(cid, studentIds) {
  var tk = coreSelfTerm(cid);
  var all = typeof getCoreSelf === 'function' ? getCoreSelf(cid) || {} : {};
  var voice =
    tk.pick && typeof StudentVoice !== 'undefined' && StudentVoice.coreSelf && StudentVoice.loaded(cid)
      ? StudentVoice
      : null;
  var byCore = {};
  var any = false;
  (typeof CORE_COMPETENCIES !== 'undefined' ? CORE_COMPETENCIES : []).forEach(function (cc) {
    byCore[cc.id] = {};
  });
  (studentIds || []).forEach(function (sid) {
    var mine = (all[sid] || {})[tk.key] || {};
    var theirs = voice ? voice.coreSelf(voice.entries(cid, sid), tk.pick.ordinal) : {};
    Object.keys(byCore).forEach(function (id) {
      var e = mine[id] || theirs[id];
      var level = e ? Number(e.level) : 0;
      if (level >= 1 && level <= 4) {
        byCore[id][sid] = level;
        any = true;
      }
    });
  });
  return { key: tk.key, pick: tk.pick || null, any: any, byCore: byCore };
}
