/* What a competency's level means, in three lines, for the hovers and taps
   that show it (Nov 2 mockup, approved): the level with its descriptor, what
   Proficient means as the competency's I Can statements, and the next step
   toward the level above.

   - The descriptor follows the printed rubric's rule (RubricPrint
     levelWording): the teacher's own wording, else the curriculum bank's,
     else the BC scale's general wording. A leading "The student" is dropped,
     so it reads as the level's one-line name.
   - The next step is the bank cluster's step for that level
     (shared/bank-comment.js), for a competency with a bank id, below
     Extending; none otherwise.
   - The bank's descriptors load late (RubricPrint.loadBankLevels); until
     they arrive the lines use the other wording, and `ready` says whether
     to ask again. */
window.CompetencyWording = (function () {
  'use strict';

  function _sentence(t) {
    var s = String(t || '').trim();
    if (!s) return '';
    s = s.replace(/^The student\s+/, '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return /[.!?]$/.test(s) ? s : s + '.';
  }

  /* The bank cluster's next step for a level (1–3), as a sentence; '' with
     no bank id, at Extending, or when the cluster has none. */
  function nextStep(tag, level) {
    var e = tag && tag.bank_id && window.CommentBank ? CommentBank.bankEntry(tag.bank_id) : null;
    // Steps exist below Extending: Emerging (1) to Proficient (3).
    if (!e || !(level >= 1 && level <= 3)) return '';
    return _sentence(e.steps[PROF_LABELS[level]]);
  }

  /* The three lines for a competency at a level (1–4): { word, descriptor,
     iCans, next, ready }. null without a tag or level. */
  function lines(tag, level) {
    var lv = Number(level);
    if (!tag || !(lv >= 1 && lv <= 4)) return null;
    var w =
      window.RubricPrint && RubricPrint.levelWording ? RubricPrint.levelWording(tag, lv) : { text: '', ready: true };
    return {
      // The level's name, as a label (the line reads "Developing: …").
      word: PROF_LABELS[lv] || '',
      descriptor: _sentence(w.text),
      iCans: (tag.i_can_statements || [])
        .map(function (s) {
          return String(s || '').trim();
        })
        .filter(Boolean),
      next: nextStep(tag, lv),
      ready: w.ready,
    };
  }

  /* The lines as markup: "Developing: …", "Proficient means: …" (the I Can
     statements, joined by ·), "Next step: …"; a line with nothing to say is
     left out. '' with no lines. */
  function html(l) {
    if (!l) return '';
    var out = [];
    // html-safe: the level word is fixed; descriptor, I Can and step through esc
    if (l.descriptor) out.push('<span class="cw-line"><b>' + esc(l.word) + ':</b> ' + esc(l.descriptor) + '</span>');
    if (l.iCans.length)
      out.push('<span class="cw-line"><b>Proficient means:</b> ' + l.iCans.map(esc).join(' · ') + '</span>');
    if (l.next) out.push('<span class="cw-line"><b>Next step:</b> ' + esc(l.next) + '</span>');
    return out.join('');
  }

  return { lines: lines, html: html, nextStep: nextStep, sentence: _sentence };
})();
