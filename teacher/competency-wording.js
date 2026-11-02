/* What a competency's level means, in three lines, for the hovers and taps
   that show it (Nov 2 mockup, approved): the level with its descriptor, what
   Proficient means as the competency's I Can statements, and the next step
   toward the level above.

   - The descriptor follows the printed rubric's rule (levelWording, which
     RubricPrint reads too): the teacher's own wording, else the curriculum
     bank's, else the BC scale's general wording. A leading "The student" is
     dropped, so it reads as the level's one-line name.
   - The next step is the bank cluster's step for that level
     (shared/bank-comment.js), for a competency with a bank id, below
     Extending; none otherwise.
   - The bank's files load late (loadBank: shared/bank-proficiency.js, and
     shared/bank-comment.js where the page hasn't loaded it, as on the
     phone); until they arrive the lines use the other wording, and `ready`
     says whether to ask again.
   Stands alone, so the phone (teacher-mobile) can show the same lines. */
window.CompetencyWording = (function () {
  'use strict';

  function _sentence(t) {
    var s = String(t || '').trim();
    if (!s) return '';
    s = s.replace(/^The student\s+/, '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return /[.!?]$/.test(s) ? s : s + '.';
  }

  // The BC scale's general wording, as printed rubrics have it (RubricPrint.GENERAL_LEVELS).
  var GENERAL = {
    1: 'The student demonstrates an initial understanding of the concepts and competencies relevant to the expected learning.',
    2: 'The student demonstrates a partial understanding of the concepts and competencies relevant to the expected learning.',
    3: 'The student demonstrates a complete understanding of the concepts and competencies relevant to the expected learning.',
    4: 'The student demonstrates a sophisticated understanding of the concepts and competencies relevant to the expected learning.',
  };

  /* One competency's wording at a level (1–4): the teacher's own (the
     descriptor bank, keyed by RubricDraft.competencyKey), else the bank's
     (shared/bank-proficiency.js), else the general wording. skipOwn: the
     wording the teacher's own replaces. { text, ready }: ready is false
     while a bank competency's wording hasn't loaded. */
  function levelWording(tag, level, skipOwn) {
    var own =
      !skipOwn && tag && typeof getCompetencyDescriptor === 'function' && typeof RubricDraft !== 'undefined'
        ? getCompetencyDescriptor(RubricDraft.competencyKey(tag)) || {}
        : {};
    var bank = window.BANK_PROFICIENCY;
    var i = bank && tag && tag.bank_id ? bank.ids[tag.bank_id] : null;
    var set = i != null ? bank.levels[i] : null;
    var text = (own[level] && String(own[level]).trim()) || (set && set[level - 1]) || GENERAL[level] || '';
    return { text: text, ready: !(tag && tag.bank_id && !bank) };
  }

  /* Loads the bank's descriptors and comment phrases the first time a page
     needs them. Resolves true when both are here. */
  var _loading = null;
  function _script(src, ready) {
    return new Promise(function (resolve) {
      if (ready()) return resolve(true);
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () {
        resolve(ready());
      };
      s.onerror = function () {
        resolve(false);
      };
      document.head.appendChild(s);
    });
  }
  function loadBank() {
    if (window.BANK_PROFICIENCY && window.BANK_COMMENT) return Promise.resolve(true);
    if (_loading) return _loading;
    _loading = Promise.all([
      _script('/shared/bank-proficiency.js', function () {
        return !!window.BANK_PROFICIENCY;
      }),
      _script('/shared/bank-comment.js', function () {
        return !!window.BANK_COMMENT;
      }),
    ]).then(function (r) {
      var ok = r[0] && r[1];
      if (!ok) _loading = null;
      return ok;
    });
    return _loading;
  }

  /* The bank cluster's next step for a level (1–3), as a sentence; '' with
     no bank id, at Extending, or when the cluster has none. The cluster row
     is [phrase, SKILLS key, emerging, developing, proficient], as
     CommentBank.bankEntry reads it (a test holds the two together). */
  function nextStep(tag, level) {
    var b = window.BANK_COMMENT;
    var i = tag && tag.bank_id && b && b.ids ? b.ids[tag.bank_id] : null;
    var row = i != null && b.clusters ? b.clusters[i] : null;
    // Steps exist below Extending: Emerging (1) to Proficient (3).
    if (!row || !(level >= 1 && level <= 3)) return '';
    return _sentence(row[level + 1]);
  }

  /* The three lines for a competency at a level (1–4): { word, descriptor,
     iCans, next, ready }. null without a tag or level. */
  function lines(tag, level) {
    var lv = Number(level);
    if (!tag || !(lv >= 1 && lv <= 4)) return null;
    var w = levelWording(tag, lv);
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
      // Also waiting for the next step's phrases where the page hasn't loaded them.
      ready: w.ready && !(tag.bank_id && !window.BANK_COMMENT),
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

  return {
    lines: lines,
    html: html,
    nextStep: nextStep,
    sentence: _sentence,
    levelWording: levelWording,
    loadBank: loadBank,
    GENERAL: GENERAL,
  };
})();
