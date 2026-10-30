/* comment-bank.js — the Term Questionnaire's Comment Bank engine (DECISIONS
   14, docs/questionnaire-plan.md). The teacher writes the comment; the bank
   (shared/comment-bank.js) offers wording in BC's four parts, each sentence
   filled in for the student and offered only when every slot it names has a
   value and its `when` matches. Nothing here assembles a paragraph.

   Two layers. facts() reads what FullVision has for one student this term
   (scores, assignments, Student Voice, attendance) from the data layer; it
   never reads the page or the observations (Colin, Oct 30: Generate never
   quotes an observation). Everything after it is pure: context() turns
   the facts and the teacher's picks (habits, Focus Area, I Can) into the
   slot values, and fits(), fill() and
   parts() decide what the Comment Bank column shows. draft() returns each
   sentence's provenance with the comment; verify() re-checks a draft's
   claims against the facts. */
window.CommentBank = (function () {
  'use strict';

  /* The habit scale as stored in term_rating.habits. */
  var SCALE = ['Rarely', 'Sometimes', 'Usually', 'Consistently', 'Not Seen'];
  var CONSISTENTLY = 4;
  var NOT_SEEN = 5;

  /* The six habits: the name and hint on the scale, and how a sentence says
     it ("hands in complete work on time", "handing in …", "completing work").
     {his} is filled with the student's pronoun. */
  var HABITS = [
    {
      key: 'completes',
      name: 'Completes Work',
      hint: 'Hands in assignments, complete and on time',
      does: 'hands in complete work on time',
      doing: 'handing in complete work on time',
      short: 'completing work',
    },
    {
      key: 'ready',
      name: 'Comes Ready and Uses Class Time',
      hint: 'Brings materials, starts tasks, stays on task',
      does: 'comes ready and uses class time well',
      doing: 'coming ready and using class time well',
      short: 'using class time well',
    },
    {
      key: 'others',
      name: 'Works With Others',
      hint: 'Listens, shares the work, helps classmates',
      does: 'works well with others',
      doing: 'working well with others',
      short: 'working with others',
    },
    {
      key: 'part',
      name: 'Takes Part',
      hint: 'Asks questions, adds to discussions',
      does: 'asks questions and takes part in discussions',
      doing: 'asking questions and taking part in discussions',
      short: 'taking part in class',
    },
    {
      key: 'feedback',
      name: 'Uses Feedback',
      hint: 'Revises work, keeps going, asks for help',
      does: 'uses feedback to improve {his} work',
      doing: 'using feedback to improve {his} work',
      short: 'using feedback',
    },
    {
      key: 'devices',
      name: 'Uses Devices Well',
      hint: 'Phone away when asked, devices for learning, not a distraction',
      does: 'uses devices for learning and puts {his} phone away when asked',
      doing: 'using devices for learning and putting {his} phone away when asked',
      short: 'using devices well',
    },
  ];

  /* The kind of class, for the bank's subject wording: one of adst, arts,
     career, ela, math, pe, science, socials, or '' when unknown. From the
     learning map's subject (its BC subject area, or its course tag), else
     the class's name. */
  var FAMILIES = {
    'Applied Design, Skills and Technologies': 'adst',
    'Arts Education': 'arts',
    'Career Education': 'career',
    'English Language Arts': 'ela',
    Mathematics: 'math',
    'Physical and Health Education': 'pe',
    Science: 'science',
    'Social Studies': 'socials',
  };
  var TAG_FAMILIES = [
    [/^(PHE|AL|FC|ODED)\d/, 'pe'],
    [/^(SCI|ANAT|BIO|CHEM|EARTH|ENVSCI|GEO|LS\d+SCI|PHYS|SFC)/, 'science'],
    [/^(MATH|APPM|CALC|CS\d|FOM|FPC|HOM|PC\d|STAT|WPM)/, 'math'],
    [/^(ELA|COMP\d|CW|EFP|ES12|LS\d|NM|NMED|SL|SPKN|HUM)/, 'ela'],
    [/^(SS|ASIA|BCFP|CC12|CIS12|ECON|ESS|GEN|HGEO|HIST|INDS|LAW|PGEO|PHIL|PHYG|POL|REL|SJ|URB)/, 'socials'],
    [/^(CAREE|CLC|CLE)/, 'career'],
    [
      /^(ARTS|ARTSTUDIO|CHOR|CMUSIC|COMP_PROD|CP12|DANCE|DCHORE|DCOMP|DCOND|DFOUND|DRAMA|DSD|DTEP|FTVT|GARTS|INS|MEDIA|MTHEATRE|MUSIC|PHOTO|SA2D|SA3D|THCO|THPROD|VA)/,
      'arts',
    ],
  ];
  var NAME_FAMILIES = [
    [/\b(pe|p\.e\.|phys(ical)?\s*(and health )?ed|fitness|outdoor|active living|health)\b/i, 'pe'],
    [/\b(science|biology|chemistry|physics|earth|geology|environmental)\b/i, 'science'],
    [/\b(math|calculus|pre-?calc|statistics|foundations|workplace math)/i, 'math'],
    [/\b(english|ela|literary|composition|creative writing|spoken language|new media|humanities)\b/i, 'ela'],
    [
      /\b(social|socials|history|geography|law|philosophy|economics|political|psychology|genocide|justice)\b/i,
      'socials',
    ],
    [/\b(career|planning|clc|cle)\b/i, 'career'],
    [/\b(drama|theatre|theater|music|band|choir|choral|dance|art|arts|photo|film|media arts|visual)\b/i, 'arts'],
    [
      /\b(foods|textiles|wood|metal|tech|computer|coding|design|engineering|business|marketing|automotive|electronics|drafting|culinary|robotics|adst|shop)\b/i,
      'adst',
    ],
  ];
  function familyOf(cid) {
    var map = typeof getLearningMap === 'function' ? getLearningMap(cid) : null;
    var sub = map && map.subjects && map.subjects[0];
    if (sub && sub.family && FAMILIES[sub.family]) return FAMILIES[sub.family];
    var tag = sub && String(sub.id || '');
    for (var i = 0; tag && i < TAG_FAMILIES.length; i++) if (TAG_FAMILIES[i][0].test(tag)) return TAG_FAMILIES[i][1];
    var name = (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || '';
    for (var k = 0; name && k < NAME_FAMILIES.length; k++)
      if (NAME_FAMILIES[k][0].test(name)) return NAME_FAMILIES[k][1];
    return '';
  }

  var PER_GROUP = 2;
  var USED_BY = 3;
  var NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  /* "a", "a and b", "a, b and c"; a name given twice once. */
  function list(xs) {
    xs = (xs || []).filter(function (x, i, all) {
      return x && all.indexOf(x) === i;
    });
    return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }

  /* A level rounded as it prints (3.07 and 3.1 are the same figure). */
  function tenths(v) {
    return Math.round(Number(v) * 10);
  }
  function word(v) {
    return v > 0 ? PROF_LABELS[Math.max(1, Math.min(4, Math.round(v)))] || '' : '';
  }

  /* Completes Work from the assignment record, until the teacher picks: all
     in, none late or missing is Consistently; more than two missing is
     Rarely; any missing or more than two late is Sometimes; else Usually.
     Nothing with no record. */
  function completesFromRecord(rec) {
    if (!rec || !(rec.total > 0)) return undefined;
    if (rec.handed === rec.total && !rec.late && !rec.missing) return CONSISTENTLY;
    if (rec.missing > 2) return 1;
    if (rec.missing || rec.late > 2) return 2;
    return 3;
  }

  /* The habits a sentence is matched against: the teacher's, with Completes
     Work from the record while the teacher has not picked it. */
  function effectiveHabits(stored, rec) {
    var out = {};
    HABITS.forEach(function (h) {
      var v = stored && Number(stored[h.key]);
      if (v >= 1 && v <= NOT_SEEN) out[h.key] = v;
    });
    if (!('completes' in out)) {
      var auto = completesFromRecord(rec);
      if (auto) out.completes = auto;
    }
    return out;
  }

  /* Text that ends a sentence: its own . ! ? or … kept, else a period. */
  function _ended(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    return /[.!?…]$/.test(t) ? t : t + '.';
  }
  function _quote(text) {
    var t = _ended(text);
    return t ? '“' + t + '”' : '';
  }
  function _answer(it) {
    return it && it.v && it.v.text ? String(it.v.text).trim() : '';
  }

  /* ── The best-piece sentence (plan, Sentence grammar) ──────────────── */

  /* A title as a comment quotes it: the lesson number ("4.3 ", "Lesson 2:")
     dropped. A title that is only a number keeps it. */
  function workTitle(title) {
    var t = String(title || '')
      .replace(/\s+/g, ' ')
      .trim();
    var bare = t.replace(
      /^(?:lesson\s+\d+(?:\.\d+)*[a-z]?\s*[.:)\-\u2013\u2014]?|\d+(?:\.\d+)+[a-z]?\s*[.:)\-\u2013\u2014]?|\d+[a-z]?\s*[.:)\-\u2013\u2014])\s+/i,
      '',
    );
    return bare || t;
  }

  /* The teacher's Note for the Report as the sentence uses it: one line,
     its first letter lower case when it starts a plain word ("Linked" →
     "linked"), no closing period (the sentence adds its own). */
  function reportNoteText(note) {
    var t = String(note || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.\s]+$/, '');
    if (/^[A-Z][a-z]/.test(t)) t = t.charAt(0).toLowerCase() + t.slice(1);
    return t;
  }

  /* Who the sentence is about: the student's pronouns when on file, else
     the preferred first name again. */
  function _whose(o) {
    if (!o.onFile || !o.pronouns) return o.name + '\u2019s';
    var poss = String(o.pronouns.poss || 'their');
    return poss.charAt(0).toUpperCase() + poss.slice(1);
  }
  function _who(o) {
    return o.onFile && o.pronouns ? String(o.pronouns.subj || 'they') : o.name;
  }

  /* "{His} best piece was “{title}”, where {he} {note}." With no note:
     "{His} best piece was “{title}.”" A title's own ? or ! stays inside the
     quotes; the period ends inside the closing quote, any comma after it.
     o: { title, note, name, pronouns, onFile }. '' with no title. */
  function bestPieceSentence(o) {
    o = o || {};
    var title = workTitle(o.title);
    if (!title) return '';
    var note = reportNoteText(o.note);
    var start = _whose(o) + ' best piece was \u201C';
    if (note)
      return (
        start +
        title.replace(/\.+$/, '') +
        '\u201D, where ' +
        _who(o) +
        ' ' +
        note +
        (/[!?\u2026]$/.test(note) ? '' : '.')
      );
    return start + title + (/[.!?\u2026]$/.test(title) ? '' : '.') + '\u201D';
  }

  /* The name and pronouns a sentence about this student uses. */
  function studentRef(student) {
    return {
      name: displayNameFirst(student),
      pronouns: ReportBlocks.getPronouns(student),
      onFile: !!String(student.pronouns || '').trim(),
    };
  }

  /* ── What FullVision has ───────────────────────────────────────────── */

  /* The work labelled Missing, oldest first: { count, titles, groups }.
     A group is three or more titles sharing the words before a colon
     ("Current Events: Week 3"), as { name, count }, largest first. */
  function notHandedIn(list, dateOf) {
    var sorted = list.slice().sort(function (x, y) {
      return (
        String(dateOf(x)).localeCompare(String(dateOf(y))) || String(x.title || '').localeCompare(String(y.title || ''))
      );
    });
    var titles = sorted.map(function (a) {
      return String(a.title || '').trim();
    });
    var byName = {};
    var order = [];
    titles.forEach(function (t) {
      var i = t.indexOf(':');
      var name = i > 0 ? t.slice(0, i).trim() : '';
      if (!name) return;
      if (!byName[name]) {
        byName[name] = 0;
        order.push(name);
      }
      byName[name]++;
    });
    var groups = order
      .filter(function (name) {
        return byName[name] >= 3;
      })
      .map(function (name) {
        return { name: name, count: byName[name] };
      })
      .sort(function (x, y) {
        return y.count - x.count;
      });
    return { count: titles.length, titles: titles, groups: groups };
  }

  /* One student's term, from the data layer. Reads no DOM. */
  function facts(cid, student, termId) {
    var sid = student.id;
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var byId = {};
    var assessments = getAssessments(cid) || [];
    assessments.forEach(function (a) {
      byId[a.id] = a;
    });
    var inTerm = function (a) {
      return !!a && assessmentInActiveTerm(cid, a);
    };
    var dateOf = function (a) {
      return (typeof _assessmentDate === 'function' ? _assessmentDate(a) : a.date) || '';
    };

    // Every score this term per competency, oldest to newest, and the level
    // at the start of the term and now (calc.js startAndNow).
    var sections = ReportBlocks.reportSections(cid);
    var comps = sections
      .map(function (sec) {
        var scores = [];
        (sec.tags || []).forEach(function (tag) {
          // One point per piece of work: a rubric's criteria on the
          // competency average into it (calc.js tagScoresByAssessment).
          tagScoresByAssessment(cid, sid, tag.id).forEach(function (sc) {
            var a = byId[sc.assessmentId];
            if (!(sc.score > 0) || !inTerm(a) || !dateOf(a)) return;
            scores.push({ id: a.id, v: Number(sc.score), d: dateOf(a), title: a.title || '' });
          });
        });
        scores.sort(function (x, y) {
          return x.d.localeCompare(y.d);
        });
        var sn = startAndNow(
          scores.map(function (s) {
            return { t: Math.round(parseLocalDate(s.d).getTime() / 86400000), v: s.v };
          }),
        );
        var iCans = [];
        (sec.tags || []).forEach(function (t) {
          (t.i_can_statements || []).forEach(function (s) {
            if (String(s || '').trim()) iCans.push(String(s).trim());
          });
        });
        return {
          id: sec.id,
          // The competency's own label, as the printed report names it; the
          // section name is the curriculum category, shared by several.
          name: ReportBlocks.competencyLabel(sec),
          scores: scores,
          start: sn ? sn.start : 0,
          now: sn ? sn.now : 0,
          // The level now even without dated scores, for strengths.
          level: sn ? sn.now : getSectionProficiency(cid, sid, sec.id),
          iCans: iCans,
        };
      })
      .filter(function (c) {
        return c.level > 0;
      });

    // The assessed work this term, one level per assessment.
    var work = assessments
      .filter(function (a) {
        return inTerm(a) && !(typeof isCompletionScored === 'function' && isCompletionScored(a));
      })
      .map(function (a) {
        var v = getAssessmentOverallScore(cid, sid, a.id);
        // The teacher's Note for the Report on the piece, for the best-piece sentence.
        var note = typeof getScoreReportNote === 'function' ? getScoreReportNote(cid, sid, a.id) : '';
        return v > 0 ? { id: a.id, title: a.title || '', d: dateOf(a), v: v, note: note } : null;
      })
      .filter(Boolean);

    // Handed In, Late, Missing: the Missing Work block's rule. Work is
    // missing only when it is labelled Missing, whatever its due date.
    var rec = { total: 0, handed: 0, late: 0, missing: 0 };
    var notIn = [];
    // The scored pieces this term with their % (calc.js), oldest first, for
    // the grade sentence's "close to" (gradeOf). Work labelled Missing is
    // not a scored piece.
    var pieces = [];
    assessments.filter(inTerm).forEach(function (a) {
      var cell = assessmentCellValue(cid, sid, a);
      var missing = cell.status === 'NS';
      if (missing) notIn.push(a);
      var scored = ['level', 'points', 'complete'].indexOf(cell.kind) >= 0;
      if (!missing && !scored) return;
      rec.total++;
      if (missing) rec.missing++;
      else rec.handed++;
      if (cell.late) rec.late++;
      if (missing || !dateOf(a)) return;
      var pc = getAssessmentGroupPercentage(cid, sid, [a]);
      if (pc && pc.pct != null) pieces.push({ id: a.id, d: dateOf(a), pct: pc.pct });
    });
    pieces.sort(function (x, y) {
      return String(x.d).localeCompare(String(y.d));
    });

    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;

    // Student Voice.
    var entries =
      typeof StudentVoice !== 'undefined' && StudentVoice.entries ? StudentVoice.entries(cid, sid) || [] : [];
    var prof = entries.length && StudentVoice.profile ? StudentVoice.profile(entries) : null;
    var about = prof && prof.about;
    var checkin = prof && prof.checkin;
    var aboutGoal = about ? _answer(about.goal).split(/\n\s*\n/)[0] : '';
    var voice = {
      entries: entries,
      profile: prof,
      good: about ? _answer(about.goodAt) : '',
      hard: about ? _answer(about.hard) : '',
      goal: (checkin && _answer(checkin.coreGoal)) || aboutGoal,
      goalStatus: checkin && checkin.status ? _answer(checkin.status) : '',
      plan: checkin ? _answer(checkin.next) : '',
      private: about ? _answer(about.note) : '',
    };

    // The student's confidence per competency (Reflections), strongest and least.
    var refl = (typeof getReflections === 'function' && (getReflections(cid) || {})[sid]) || {};
    var conf = Object.keys(refl)
      .map(function (secId) {
        var sec = sections.find(function (s) {
          return s.id === secId;
        });
        var c = refl[secId] && Number(refl[secId].confidence);
        return sec && c > 0 ? { id: secId, name: sec.name, c: c } : null;
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return b.c - a.c;
      });

    var overall = getOverallProficiency(cid, sid);
    var mode = courseGradeMode(cid);
    var letter =
      mode !== 'proficiency' && typeof getCourseLetterData === 'function' ? getCourseLetterData(cid, sid) : null;
    // The report's own Focus Area before any pick (the biggest change), so
    // the choices keep their order when the teacher picks one.
    var focus = ReportBlocks.focusArea(cid, student, { termId: termId }, 'change');
    var att = getTermAttendance(cid, sid, termId) || {};
    var rating = getStudentTermRating(cid, sid, termId) || {};
    // When the student joined the class (enrollment.enrolled_at), and the
    // class's first enrolment, for the new-to-the-class story (angle()).
    var day = function (v) {
      return v ? String(v).slice(0, 10) : '';
    };
    var classStart = (getStudents(cid) || [])
      .map(function (s) {
        return day(s.enrolledDate);
      })
      .filter(Boolean)
      .sort()[0];

    return {
      cid: cid,
      sid: sid,
      name: displayNameFirst(student),
      first: student.firstName || displayNameFirst(student),
      course: course.name || '',
      family: familyOf(cid),
      pronouns: ReportBlocks.getPronouns(student),
      pronounsOnFile: !!String(student.pronouns || '').trim(),
      comps: comps,
      work: work,
      record: rec,
      notHandedIn: notHandedIn(notIn, dateOf),
      voice: voice,
      confidence: conf,
      overall: overall,
      standing: mode !== 'letter' && overall > 0 ? word(overall) : '',
      letter: letter && letter.S ? (/^[AFI]/.test(letter.S) ? 'an ' : 'a ') + letter.S + ' (' + letter.R + '%)' : '',
      // The course grade for the grade sentence, all from calc.js: the class's
      // grading style, the letter and % as shown, the band above, and the
      // scored pieces (gradeOf).
      grade: {
        mode: mode,
        letter: letter && letter.R != null ? percentageToLetter(letter.R, cid) : null,
        pct: letter && letter.R != null ? letter.R : null,
        next: letter && letter.R != null ? nextLetterBand(letter.R) : null,
        pieces: pieces,
      },
      levelText: function (v) {
        return mode === 'letter' ? formatLevel(cid, v) : levelWord(cid, v);
      },
      defaultFocusId: (focus && focus.sec && focus.sec.id) || null,
      focusId: rating.focusSectionId || (focus && focus.sec && focus.sec.id) || null,
      absent: att.absencesThisTerm,
      late: att.latesThisTerm,
      habits: rating.habits || {},
      enrolled: day(student.enrolledDate),
      classStart: classStart || '',
      termStart: (term && term.startsOn) || '',
    };
  }

  /* The Focus Area choices: the report's Focus Area first, then the
     competencies whose level changed most this term, ties to the lowest now.
     A Focus Area the teacher saved is always one of them (in the last place
     when it is no longer in the top three), so the comment and the printed
     report never disagree. */
  function focusOptions(f, picked) {
    var withLevels = f.comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });
    var sorted = withLevels.slice().sort(function (a, b) {
      var ca = Math.abs(tenths(a.now) - tenths(a.start));
      var cb = Math.abs(tenths(b.now) - tenths(b.start));
      return cb - ca || a.now - b.now;
    });
    var first = withLevels.find(function (c) {
      return c.id === (f.defaultFocusId || f.focusId);
    });
    var out = first ? [first] : [];
    sorted.forEach(function (c) {
      if (out.length < 3 && out.indexOf(c) < 0) out.push(c);
    });
    var saved =
      picked &&
      f.comps.find(function (c) {
        return c.id === picked;
      });
    if (saved && out.indexOf(saved) < 0) {
      if (out.length >= 3) out.pop();
      out.push(saved);
    }
    return out;
  }

  /* ── The slots ─────────────────────────────────────────────────────── */

  /* The picture of the term that picks an opening: early with no levels to
     compare; challenge when any competency is Developing or Emerging now;
     strong when one is Extending or more rose than fell; else steady. */
  function pictureOf(comps) {
    var withLevels = comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });
    if (!withLevels.length) return 'early';
    var nowWords = withLevels.map(function (c) {
      return word(c.now);
    });
    if (
      nowWords.some(function (w) {
        return w === 'Developing' || w === 'Emerging';
      })
    )
      return 'challenge';
    var rises = withLevels.filter(function (c) {
      return tenths(c.now) > tenths(c.start);
    }).length;
    var drops = withLevels.filter(function (c) {
      return tenths(c.now) < tenths(c.start);
    }).length;
    return nowWords.indexOf('Extending') >= 0 || rises > drops ? 'strong' : 'steady';
  }

  /* What the assessed work shows overall, from the overall level. */
  function evidenceOf(f) {
    if (!f.work.length) return '';
    return f.overall >= 2.5 ? 'a solid grasp of the material' : 'progress toward understanding the key concepts';
  }

  /* ── The grade sentence ────────────────────────────────────────────── */

  /* The standing words of the Letter Grades Order (M192/94). IE and F have
     none, so they get no grade sentence here. */
  var STANDING = { A: 'excellent', B: 'very good', 'C+': 'good', C: 'satisfactory', 'C-': 'minimally acceptable' };
  /* "Close to" the next letter: at most this many points below its band,
     with at least this many scored pieces. */
  var CLOSE_POINTS = 2;
  var CLOSE_PIECES = 6;

  /* "a" or "an" by sound: a letter grade or initialism is said letter by
     letter ("an A", "a B", "an IE"); a word by its first letter ("an
     Extending", "a Proficient"). */
  function aOrAn(w) {
    var t = String(w || '');
    var spelled = /^[A-Z]{1,3}[+-]?$/.test(t);
    var vowel = spelled ? /^[AEFHILMNORSX]/.test(t) : /^[aeiou]/i.test(t);
    return (vowel ? 'an ' : 'a ') + t;
  }

  function _median(xs) {
    var s = xs.slice().sort(function (a, b) {
      return a - b;
    });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Whether the marks are going down: the scored pieces in date order, and
     the median % of the latest third below the median of the earliest
     third. Fewer than three pieces show no trend. */
  function trendingDown(pieces) {
    var xs = (pieces || []).slice().sort(function (a, b) {
      return String(a.d).localeCompare(String(b.d));
    });
    var n = Math.floor(xs.length / 3);
    if (n < 1) return false;
    var pct = function (p) {
      return Number(p.pct);
    };
    return _median(xs.slice(-n).map(pct)) < _median(xs.slice(0, n).map(pct));
  }

  /* The next letter up when the student is close to it: { letter, min,
     gap }, or null. Only upward, only within CLOSE_POINTS of the band, with
     CLOSE_PIECES or more scored pieces and no downward trend. */
  function closeTo(g) {
    var nx = g && g.next;
    if (!nx || g.pct == null) return null;
    var gap = Math.round((nx.min - Number(g.pct)) * 10) / 10;
    if (!(gap > 0) || gap > CLOSE_POINTS) return null;
    if ((g.pieces || []).length < CLOSE_PIECES || trendingDown(g.pieces)) return null;
    return { letter: nx.letter, min: nx.min, gap: gap };
  }

  /* What the grade sentence says, from the facts: { kind, letter,
     standing, next } in a Letter or Both class, { kind: 'proficiency',
     word } in a Proficiency class, or null when there is no grade sentence
     (no marks yet, or IE or F, which keep today's draft). kind picks the
     bank sentence: letter, letterClose, cminus, cminusClose, proficiency. */
  function gradeOf(f) {
    var g = (f && f.grade) || {};
    if (g.mode === 'proficiency') return f.standing ? { kind: 'proficiency', word: f.standing } : null;
    if (g.mode !== 'letter' && g.mode !== 'both') return null;
    var standing = g.letter && STANDING[g.letter];
    if (!standing) return null;
    var close = closeTo(g);
    return {
      kind: (g.letter === 'C-' ? 'cminus' : 'letter') + (close ? 'Close' : ''),
      letter: g.letter,
      standing: standing,
      next: close ? close.letter : '',
    };
  }

  /* The grade sentence's slot values for a gradeOf result. */
  function gradeSlots(gr) {
    return {
      gradeLetter: gr && gr.letter ? aOrAn(gr.letter) : '',
      gradeStanding: (gr && gr.standing) || '',
      gradeNext: gr && gr.next ? aOrAn(gr.next) : '',
      gradeWord: (gr && gr.word) || '',
    };
  }

  /* Every value a bank sentence can ask for, from the facts and the
     teacher's picks { habits, focus, ican }. An empty value means the
     sentences that need it are not offered. */
  function context(f, picks) {
    picks = picks || {};
    var p = f.pronouns;
    var habits = effectiveHabits(picks.habits || f.habits, f.record);
    var withLevels = f.comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });

    // The picture of the term (pictureOf), what rose and what fell.
    var nowWords = withLevels.map(function (c) {
      return word(c.now);
    });
    var rises = withLevels
      .filter(function (c) {
        return tenths(c.now) > tenths(c.start);
      })
      .sort(function (a, b) {
        return tenths(b.now) - tenths(b.start) - (tenths(a.now) - tenths(a.start));
      });
    var drops = withLevels.filter(function (c) {
      return tenths(c.now) < tenths(c.start);
    });
    var picture = pictureOf(f.comps);
    var fell = withLevels.filter(function (c) {
      return word(c.start) === 'Extending' && word(c.now) === 'Proficient';
    });

    var options = focusOptions(f, picks.focus);
    var focus =
      options.find(function (c) {
        return c.id === picks.focus;
      }) || options[0];
    var iCan =
      focus && focus.iCans.length ? _ended(focus.iCans[Math.min(picks.ican || 0, focus.iCans.length - 1)]) : '';
    // Strengths are the highest levels now; the areas to grow, the two
    // lowest (only below the highest, so an even term names none).
    var byNow = f.comps.slice().sort(function (a, b) {
      return b.level - a.level;
    });
    var highest = byNow.length ? tenths(byNow[0].level) : 0;
    var lowest = byNow
      .slice()
      .reverse()
      .filter(function (c) {
        return tenths(c.level) < highest;
      })
      .slice(0, 2);
    var strongest = byNow
      .filter(function (c) {
        return lowest.indexOf(c) < 0;
      })
      .slice(0, 2);
    var fallen = drops.length
      ? drops.slice().sort(function (a, b) {
          return tenths(a.start) - tenths(a.now) - (tenths(b.start) - tenths(b.now));
        })[0]
      : null;

    // Work: best and lowest this term.
    var best = f.work.slice().sort(function (a, b) {
      return b.v - a.v || b.d.localeCompare(a.d);
    });
    var low = f.work.slice().sort(function (a, b) {
      return a.v - b.v || b.d.localeCompare(a.d);
    });
    var top = best[0];
    var weak = low[0] && top && tenths(low[0].v) < tenths(top.v) ? low[0] : null;
    var the = function (w) {
      return 'the ' + w.title;
    };
    var weakTwo = low.filter(function (w) {
      return top && tenths(w.v) < tenths(top.v);
    });

    // The Focus Area's work, for the family to see and ask about (the Ways
    // to Support at Home block's rule).
    var seeWork = '';
    var aboutWork = '';
    var seeId = null;
    var aboutId = null;
    if (focus) {
      var fw = {};
      focus.scores.forEach(function (s) {
        if (!fw[s.title] || s.v > fw[s.title].v) fw[s.title] = s;
      });
      var fl = Object.keys(fw).map(function (k) {
        return fw[k];
      });
      if (fl.length > 1) {
        var fb = fl.slice().sort(function (a, b) {
          return b.v - a.v || b.d.localeCompare(a.d);
        })[0];
        var fo = fl.slice().sort(function (a, b) {
          return a.v - b.v || b.d.localeCompare(a.d);
        })[0];
        if (fb !== fo) {
          seeWork = fb.title;
          aboutWork = fo.title;
          seeId = fb.id;
          aboutId = fo.id;
        }
      }
    }

    var withHabit = function (lvl) {
      return HABITS.filter(function (h) {
        return habits[h.key] === lvl;
      });
    };
    // In PE, Completes Work is taking part.
    var PE_COMPLETES = {
      does: 'takes a full part in every activity',
      doing: 'taking a full part in every activity',
      short: 'taking part fully',
    };
    // In Arts, where the bank keeps handed-in wording out, it is completing
    // the work.
    var ARTS_COMPLETES = {
      does: 'completes {his} work',
      doing: 'completing {his} work',
      short: 'completing work',
    };
    var habitWords = function (h, k) {
      if (h.key !== 'completes') return h[k];
      return f.family === 'pe' ? PE_COMPLETES[k] : f.family === 'arts' ? ARTS_COMPLETES[k] : h[k];
    };
    // A habit phrase names the student's own work ("{his} work"): filled
    // here, so fill() never reads a slot inside a value.
    var phrase = function (t) {
      return t.replace(/\{his\}/g, p.poss);
    };
    var strengthBits = [];
    if (withHabit(4).length)
      strengthBits.push(
        'consistently ' +
          list(
            withHabit(4).map(function (h) {
              return phrase(habitWords(h, 'does'));
            }),
          ),
      );
    if (withHabit(3).length)
      strengthBits.push(
        'usually ' +
          list(
            withHabit(3).map(function (h) {
              return phrase(habitWords(h, 'does'));
            }),
          ),
      );
    var growing = withHabit(2).concat(withHabit(1));
    var conf = f.confidence;
    var selfStrong = conf.length > 1 && conf[0].c >= 3 ? conf[0] : null;
    var selfLow = conf.length > 1 && conf[conf.length - 1].c <= 2 ? conf[conf.length - 1] : null;

    // The facts behind each slot, for the draft's provenance and verify():
    // 'comp:<section id>', 'work:<assessment id>',
    // 'habit:<key>', 'confidence:<section id>', or a field of the facts.
    var keys = function (kind, xs) {
      return xs.filter(Boolean).map(function (x) {
        return kind + ':' + (x.id != null ? x.id : x);
      });
    };
    var habitKeys = function (hs) {
      return keys(
        'habit',
        hs.map(function (h) {
          return h.key;
        }),
      );
    };
    var strongHabits = withHabit(4).concat(withHabit(3));
    var focusKeys = keys('comp', [focus]);
    var gr = gradeOf(f);
    var gslots = gradeSlots(gr);
    var factsOf = {
      gradeLetter: ['grade.letter'],
      gradeStanding: ['grade.letter'],
      gradeNext: ['grade.pct', 'grade.pieces'],
      gradeWord: ['overall'],
      standing: ['overall'],
      letterStanding: ['letter'],
      evidence: ['overall', 'work'],
      strengths: keys('comp', strongest),
      growthAreas: keys('comp', lowest),
      even: keys('comp', withLevels),
      rise: keys('comp', [rises[0]]),
      fall: keys('comp', [fallen]),
      fellCount: keys('comp', fell),
      assignment: keys('work', [top]),
      level: keys('work', [top]),
      bestPiece: keys('work', [top]),
      assignment2: keys('work', [weak]),
      level2: keys('work', [weak]),
      strongWorks: keys('work', best.slice(0, 2)),
      weakWorks: keys('work', weakTwo.slice(0, 2)),
      selfGood: ['voice.good'],
      selfHard: ['voice.hard'],
      selfStrong: keys('confidence', [selfStrong]),
      selfLow: keys('confidence', [selfLow]),
      goal: ['voice.goal'],
      plan: ['voice.plan'],
      focus: focusKeys,
      focusLow: focusKeys,
      nextStep: focusKeys,
      seeWork: focusKeys.concat(keys('work', [seeId])),
      aboutWork: focusKeys.concat(keys('work', [aboutId])),
      strengthHabits: habitKeys(strongHabits),
      strengthHabitNames: habitKeys(strongHabits),
      growthHabits: habitKeys(growing),
      growthHabitNames: habitKeys(growing),
      absent: ['attendance.absent'],
      late: ['attendance.late'],
    };

    return {
      // The facts and picks this context was built from, so draft() can
      // pick the story (angle) and verify the draft before returning it.
      _f: f,
      _picks: picks,
      _p: p,
      _habits: habits,
      _standing: f.standing || '',
      _family: f.family || '',
      _grade: gr ? gr.kind : '',
      _options: options,
      _focus: focus || null,
      _facts: factsOf,
      _bestNote: !!(top && reportNoteText(top.note)),
      name: f.name,
      course: f.course,
      picture: picture,
      standing: f.standing ? (/^[AEIOU]/.test(f.standing) ? 'an ' : 'a ') + f.standing + ' level' : '',
      letterStanding: f.letter,
      gradeLetter: gslots.gradeLetter,
      gradeStanding: gslots.gradeStanding,
      gradeNext: gslots.gradeNext,
      gradeWord: gslots.gradeWord,
      strengths: list(
        strongest.map(function (c) {
          return c.name;
        }),
      ),
      growthAreas: list(
        lowest.map(function (c) {
          return c.name;
        }),
      ),
      even:
        withLevels.length > 1 &&
        nowWords.every(function (w) {
          return w === nowWords[0];
        })
          ? 'yes'
          : '',
      rise: rises.length ? rises[0].name : '',
      fall: fallen ? fallen.name : '',
      fellCount: fell.length > 1 ? NUM[fell.length] || String(fell.length) : '',
      assignment: top ? top.title : '',
      level: top ? f.levelText(top.v) : '',
      // The whole best-piece sentence, with the teacher's note when there is one.
      bestPiece: top
        ? bestPieceSentence({ title: top.title, note: top.note, name: f.name, pronouns: p, onFile: f.pronounsOnFile })
        : '',
      assignment2: weak ? weak.title : '',
      level2: weak ? f.levelText(weak.v) : '',
      strongWorks: list(best.slice(0, 2).map(the)),
      weakWorks: list(weakTwo.slice(0, 2).map(the)),
      evidence: evidenceOf(f),
      selfGood: _quote(f.voice.good),
      selfHard: _quote(f.voice.hard),
      selfStrong: selfStrong ? selfStrong.name : '',
      selfLow: selfLow ? selfLow.name : '',
      goal: _quote(f.voice.goal),
      plan: _quote(f.voice.plan),
      focus: focus ? focus.name : '',
      // The Focus Area only when it is one of the two lowest now, for
      // sentences that call it the area to build (the report's Focus Area
      // can be the biggest change, rising or falling).
      focusLow:
        focus &&
        lowest.some(function (c) {
          return c.id === focus.id;
        })
          ? focus.name
          : '',
      nextStep: iCan,
      seeWork: seeWork,
      aboutWork: aboutWork,
      strengthHabits: strengthBits.join(', and '),
      growthHabits: list(
        growing.map(function (h) {
          return phrase(habitWords(h, 'doing'));
        }),
      ),
      strengthHabitNames: list(
        withHabit(4)
          .concat(withHabit(3))
          .map(function (h) {
            return habitWords(h, 'short');
          }),
      ),
      growthHabitNames: list(
        growing.map(function (h) {
          return habitWords(h, 'short');
        }),
      ),
      absent: f.absent > 0 ? String(f.absent) : '',
      late: f.late > 0 ? String(f.late) : '',
    };
  }

  /* ── Offering and filling ──────────────────────────────────────────── */

  /* A sentence for some kinds of class (`subjects`), or for all but some
     (`except`); without either, for every class. */
  function forFamily(s, family) {
    if (s.subjects && s.subjects.indexOf(family) < 0) return false;
    if (s.except && family && s.except.indexOf(family) >= 0) return false;
    return true;
  }

  function fits(s, ctx) {
    if (!forFamily(s, ctx._family || '')) return false;
    var needs = s.needs || [];
    for (var i = 0; i < needs.length; i++) if (!ctx[needs[i]]) return false;
    var when = s.when || {};
    return Object.keys(when).every(function (k) {
      if (k === 'picture') return ctx.picture === when[k];
      if (k === 'standing') return ctx._standing === when[k];
      if (k === 'grade') return ctx._grade === when[k];
      return (ctx._habits || {})[k] === when[k];
    });
  }

  /* One pass over the sentence's own text: a pronoun slot, a data slot, or a
     [singular|plural] verb after a pronoun ("she is", "they are"); a capital
     to start. Values go in as written: a note or a student's answer that
     happens to hold "{name}" or "[a|b]" is never read as a slot. */
  function fill(s, ctx) {
    var p = ctx._p || { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };
    var cap = function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    };
    var pron = {
      He: cap(p.subj),
      he: p.subj,
      him: p.obj,
      His: cap(p.poss),
      his: p.poss,
      himself: p.refl,
    };
    var own = Object.prototype.hasOwnProperty;
    var t = String(s.text).replace(/\{(\w+)\}|\[([^|\]]*)\|([^\]]*)\]/g, function (m, k, one, many) {
      if (k === undefined) return p.subj === 'they' ? many : one;
      if (own.call(pron, k)) return pron[k];
      return own.call(ctx, k) && ctx[k] != null ? String(ctx[k]) : '';
    });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* A sentence as a pattern with its slots as wildcards, to find it in a
     classmate's comment. A sentence that is mostly slots ("{name}
     {strengthHabits}.") would match any comment, so one with fewer than
     four words of its own has none. Cached by id and wording, with the
     wording's own pieces (_literals), which a comment must hold before the
     pattern is tried: a pattern with several wildcards is slow on a long
     comment that does not hold it. */
  var _patterns = {};
  var _literals = {};
  function pattern(s) {
    var key = s.id + '\u0000' + s.text;
    if (key in _patterns) return _patterns[key];
    var fixed = String(s.text)
      .replace(/\{\w+\}/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .split(/\s+/)
      .filter(function (w) {
        return /[a-z]{2}/i.test(w);
      });
    var re = null;
    var lits = [];
    if (fixed.length >= 4) {
      var src = String(s.text)
        .split(/(\{\w+\}|\[[^\]]*\])/)
        .map(function (part) {
          if (/^\{\w+\}$/.test(part)) return '.+?';
          var alt = part.match(/^\[([^|\]]*)\|([^\]]*)\]$/);
          if (alt) return '(?:' + alt[1] + '|' + alt[2] + ')';
          var lit = part.trim().toLowerCase();
          if (lit.length >= 3) lits.push(lit);
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      re = new RegExp(src, 'i');
    }
    _patterns[key] = re;
    _literals[key] = lits;
    return re;
  }

  /* Whether a comment holds the sentence: its pattern found in the text.
     lower: the text in lower case, for the quick check of its pieces. */
  function _holds(s, text, lower) {
    var re = pattern(s);
    if (!re) return false;
    var lits = _literals[s.id + '\u0000' + s.text];
    for (var i = 0; i < lits.length; i++) if (lower.indexOf(lits[i]) < 0) return false;
    return re.test(text);
  }

  /* A classmate's comment as { sid, text }: the screen passes { sid, text };
     a plain string has no sid. */
  function _comment(c) {
    if (c && typeof c === 'object') return { sid: c.sid != null ? String(c.sid) : null, text: String(c.text || '') };
    return { sid: null, text: String(c == null ? '' : c) };
  }

  /* How many classmates' comments this term hold the sentence. */
  function usedBy(s, comments) {
    var re = pattern(s);
    if (!re) return 0;
    return (comments || []).filter(function (c) {
      var t = _comment(c).text;
      return _holds(s, t, t.toLowerCase());
    }).length;
  }

  /* The first word of the comment's last sentence: what follows the last
     . ! ? or closing quote that has a space after it. (No lookbehind, which
     Safari before 16.4 cannot parse.) */
  function lastStart(text) {
    var t = String(text || '').trim();
    var re = /[.!?”]\s+(?=\S)/g;
    var from = 0;
    var m;
    while ((m = re.exec(t))) from = m.index + m[0].length;
    return t.slice(from).split(/\s+/)[0] || '';
  }

  /* A row's note under its sentence. */
  function rowMeta(repeats, used) {
    var bits = [];
    if (repeats) bits.push('Starts like your last sentence');
    if (used >= USED_BY) bits.push('Used for ' + used + ' classmates this term');
    return bits.join(' · ');
  }
  /* Whether a sentence not yet added starts like the comment's last one. */
  function repeatsLast(sentence, last) {
    return !!last && String(sentence).split(/\s+/)[0] === last;
  }

  /* The Comment Bank column: the four parts in BC's order, each with the
     sentences that fit, grouped by source, two per group until Show All (an
     added sentence always shows), sentences used for three or more
     classmates last in their group. opts: { more: {part: true}, comments:
     classmates' comments this term, first: the first name for the titles
     (sentences use the name the student goes by), bank }. */
  function parts(ctx, text, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var more = opts.more || {};
    var last = lastStart(text);
    var first = opts.first || ctx.name;
    var titles = {
      habits: 'Work Habits',
      now: 'Where ' + first + ' Is Now',
      go: 'Where ' + first + ' Needs to Go',
      how: 'How ' + first + ' Will Get There',
    };
    return bank.parts.map(function (part, i) {
      var all = bank.sentences.filter(function (s) {
        return s.part === part.id;
      });
      var ok = all.filter(function (s) {
        return fits(s, ctx);
      });
      var rows = ok.map(function (s, at) {
        var t = fill(s, ctx);
        var used = usedBy(s, opts.comments);
        return {
          id: s.id,
          group: s.group,
          text: t,
          added: String(text || '').indexOf(t) >= 0,
          used: used,
          crowded: used >= USED_BY,
          repeats: false,
          at: at,
        };
      });
      // Groups keep their bank order; inside a group, crowded sentences last.
      var groupAt = {};
      rows.forEach(function (r) {
        if (!(r.group in groupAt)) groupAt[r.group] = r.at;
      });
      rows.sort(function (a, b) {
        return groupAt[a.group] - groupAt[b.group] || a.crowded - b.crowded || a.at - b.at;
      });
      var seen = {};
      var shown = more[part.id]
        ? rows
        : rows.filter(function (r) {
            seen[r.group] = (seen[r.group] || 0) + 1;
            return seen[r.group] <= PER_GROUP || r.added;
          });
      var prev = '';
      shown.forEach(function (r) {
        r.first = r.group !== prev;
        prev = r.group;
        r.repeats = !r.added && repeatsLast(r.text, last);
        r.meta = rowMeta(r.repeats, r.used);
      });
      return {
        id: part.id,
        n: String(i + 1),
        title: titles[part.id] || part.title,
        rows: shown,
        fit: ok.length,
        total: all.length,
        waiting: all.length - ok.length,
        canMore: shown.length < rows.length || !!more[part.id],
        more: !!more[part.id],
        inComment: rows.some(function (r) {
          return r.added;
        }),
      };
    });
  }

  /* ── Generate ──────────────────────────────────────────────────────── */

  /* A small repeatable random: the same seed gives the same draft. */
  function _rng(seed) {
    var x = (Number(seed) || 1) >>> 0;
    return function () {
      x = (x + 0x6d2b79f5) >>> 0;
      var t = x;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFor(text) {
    var h = 2166136261;
    String(text || '')
      .split('')
      .forEach(function (ch) {
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      });
    return h || 1;
  }

  /* The draft's steps: the grade sentence (gradeOf; none for IE, F or no
     marks), an opening, the habits (what is strong, what is growing,
     attendance when entered), where the student is now (overall, one
     example, growth), the next step (and the student's own goal), and how
     they will get there (home or class, then a closer). Each step takes at
     most one sentence. A step that `says` a fact (the grade) keeps every
     later sentence claiming it out; a step `unless` another has a sentence
     is skipped (the growing habits and Completes Work and Takes Part name
     the same habits). The angle (angle()) sets which steps run and in what
     order; this is the order with no story to tell. */
  var DRAFT_STEPS = [
    { key: 'grade', part: 'now', groups: ['Grade'], says: 'grade' },
    { key: 'opening', part: 'now', groups: ['Openings'] },
    { key: 'strongHabits', part: 'habits', needsAny: ['strengthHabits', 'strengthHabitNames'] },
    { key: 'growingHabits', part: 'habits', needsAny: ['growthHabits', 'growthHabitNames'], unless: 'completes' },
    { key: 'completes', part: 'habits', groups: ['Completes Work and Takes Part'], unless: 'growingHabits' },
    { key: 'attendance', part: 'habits', groups: ['Attendance'] },
    { key: 'overall', part: 'now', groups: ['Overall'] },
    { key: 'example', part: 'now', groups: ['Examples From Work', "In the Student's Words"] },
    { key: 'growth', part: 'now', groups: ['Growth This Term'] },
    { key: 'nextStep', part: 'go', groups: ['Next Step'] },
    { key: 'goWords', part: 'go', groups: ["In the Student's Words", 'Work to Revisit'] },
    { key: 'home', part: 'how', groups: ['At Home', 'In Class', "In the Student's Words"] },
    { key: 'closer', part: 'how', groups: ['Looking Ahead'] },
  ];

  /* Facts a draft states once, by topic: the strong habits named or
     phrased are one fact, as are the growing ones. */
  var NO_REPEAT = {
    strengthHabits: 'strong',
    strengthHabitNames: 'strong',
    growthHabits: 'growing',
    growthHabitNames: 'growing',
    rise: 'rise',
    fall: 'fall',
    fellCount: 'fell',
    nextStep: 'nextStep',
    goal: 'goal',
    plan: 'plan',
  };

  /* The data slots a sentence names, in its own order: every {slot} but the
     pronouns, then any it needs without printing ("even"). */
  var PRONOUN_SLOTS = { He: 1, he: 1, him: 1, His: 1, his: 1, himself: 1 };
  function slotsOf(s) {
    var out = [];
    String(s.text).replace(/\{(\w+)\}/g, function (m, k) {
      if (!PRONOUN_SLOTS[k] && out.indexOf(k) < 0) out.push(k);
      return m;
    });
    (s.needs || []).forEach(function (k) {
      if (out.indexOf(k) < 0) out.push(k);
    });
    return out;
  }

  /* Where one sentence of a draft came from: its claims (from the bank), the
     facts behind it (factKeys, see context's _facts), and the values it was
     filled with ('when.<key>' for a `when` it matched). `sources` keeps the
     fact keys per slot, for verify(). */
  var CLAIM_FACTS = { lateWork: 'record.late', notHandedIn: 'notHandedIn' };
  function provenance(s, ctx) {
    var own = Object.prototype.hasOwnProperty;
    var values = {};
    var sources = {};
    var factKeys = [];
    var add = function (k) {
      if (factKeys.indexOf(k) < 0) factKeys.push(k);
    };
    slotsOf(s).forEach(function (k) {
      values[k] = own.call(ctx, k) && ctx[k] != null ? String(ctx[k]) : '';
      var fk = ctx._facts && own.call(ctx._facts, k) ? ctx._facts[k] : k === 'name' || k === 'course' ? [] : [k];
      sources[k] = fk.slice();
      fk.forEach(add);
    });
    var when = s.when || {};
    Object.keys(when).forEach(function (k) {
      values['when.' + k] = when[k];
      add(k === 'picture' ? 'picture' : k === 'standing' ? 'overall' : k === 'grade' ? 'grade' : 'habit:' + k);
    });
    (s.claims || []).forEach(function (c) {
      if (CLAIM_FACTS[c]) add(CLAIM_FACTS[c]);
    });
    return {
      sentenceId: s.id,
      part: s.part,
      claims: (s.claims || []).slice(),
      factKeys: factKeys,
      values: values,
      sources: sources,
    };
  }

  /* ── The angle: the story of this student's term ───────────────────── */

  /* Before any sentence is chosen, angle() picks the story the comment
     tells, from the facts alone. Each story sets which steps run, their
     order and which leads; the grade sentence always comes first. Only
     facts FullVision has: the scored pieces and their % (calc.js), the
     levels per competency, the work labelled Missing, the habit ratings
     (Completes Work from the record until rated), and the enrolment date.
     The lowest tier that holds wins; inside a tier, the story used least in
     the class, then this order. "Angle" is never shown. */
  var ANGLE_DAYS = 28; // a climb or a slide spans four weeks or more
  var ANGLE_POINTS = 5; // and moves the median by five points or more
  var NEW_DAYS = 14; // joined two weeks or more after the class began
  var THIN = 3; // fewer scored pieces than this is too little to judge

  var ANGLES = [
    {
      // The mark is IE (calc.js, under 50% before the course ends): what is
      // not in and what to do next lead.
      id: 'ie',
      tier: 1,
      when: function (a) {
        return a.letter === 'IE';
      },
      order: ['completes', 'growingHabits', 'attendance', 'example', 'nextStep', 'home', 'closer'],
    },
    {
      // Too few scored pieces to say much: the habits and one example.
      id: 'thin',
      tier: 2,
      when: function (a) {
        return a.scored < THIN;
      },
      order: [
        'opening',
        'strongHabits',
        'growingHabits',
        'completes',
        'attendance',
        'example',
        'nextStep',
        'home',
        'closer',
      ],
    },
    {
      // Joined the class two weeks or more after it began, during this
      // term: no growth over a term that was not all theirs.
      id: 'newcomer',
      tier: 2,
      when: function (a) {
        return a.joinedLate;
      },
      order: [
        'opening',
        'strongHabits',
        'growingHabits',
        'completes',
        'attendance',
        'example',
        'overall',
        'nextStep',
        'home',
        'closer',
      ],
    },
    {
      // Strong handed-in work behind a grade pulled down by work labelled
      // Missing: the best piece leads, then what is not in.
      id: 'hidden',
      tier: 3,
      when: function (a) {
        return a.missing >= 2 && a.missing * 5 >= a.total && a.strongWork;
      },
      order: ['example', 'overall', 'completes', 'growingHabits', 'attendance', 'nextStep', 'home', 'closer'],
    },
    {
      // The marks climbed over the term: the growth leads.
      id: 'climb',
      tier: 4,
      when: function (a) {
        return a.trend >= ANGLE_POINTS;
      },
      order: [
        'growth',
        'example',
        'overall',
        'strongHabits',
        'growingHabits',
        'completes',
        'attendance',
        'nextStep',
        'home',
        'closer',
      ],
    },
    {
      // The marks slid over the term: the best piece first, then the slide.
      id: 'slide',
      tier: 4,
      when: function (a) {
        return a.trend <= -ANGLE_POINTS;
      },
      order: [
        'example',
        'growth',
        'overall',
        'growingHabits',
        'completes',
        'strongHabits',
        'attendance',
        'nextStep',
        'goWords',
        'home',
        'closer',
      ],
    },
    {
      // Strong in one skill, weak in another (a full proficiency apart, each
      // on three or more pieces): the strengths and the area to build lead.
      id: 'split',
      tier: 4,
      when: function (a) {
        return a.split;
      },
      order: [
        'overall',
        'example',
        'strongHabits',
        'growingHabits',
        'completes',
        'attendance',
        'nextStep',
        'goWords',
        'home',
        'closer',
      ],
    },
    {
      // Good marks, with two or more habits rated Sometimes or Rarely: the
      // work first, then the habits to build.
      id: 'habits',
      tier: 4,
      when: function (a) {
        return a.growing >= 2 && a.good;
      },
      order: [
        'example',
        'growingHabits',
        'completes',
        'strongHabits',
        'attendance',
        'overall',
        'nextStep',
        'home',
        'closer',
      ],
    },
    {
      // An A or B (or Proficient and up), nothing missing, no slide: the
      // best piece leads.
      id: 'strength',
      tier: 5,
      when: function (a) {
        return a.high && !a.missing && a.trend > -ANGLE_POINTS;
      },
      order: [
        'example',
        'overall',
        'strongHabits',
        'growingHabits',
        'completes',
        'attendance',
        'nextStep',
        'goWords',
        'home',
        'closer',
      ],
    },
    {
      // A C or C- (or below Proficient): what is working leads.
      id: 'building',
      tier: 5,
      when: function (a) {
        return a.low;
      },
      order: [
        'strongHabits',
        'example',
        'growingHabits',
        'completes',
        'attendance',
        'overall',
        'nextStep',
        'goWords',
        'home',
        'closer',
      ],
    },
    {
      // No story stands out: the steps in their usual order.
      id: 'steady',
      tier: 6,
      when: function () {
        return true;
      },
      order: DRAFT_STEPS.slice(1).map(function (s) {
        return s.key;
      }),
    },
  ];

  function _days(a, b) {
    var x = typeof parseLocalDate === 'function' ? parseLocalDate(a) : new Date(a);
    var y = typeof parseLocalDate === 'function' ? parseLocalDate(b) : new Date(b);
    return (y - x) / 86400000;
  }

  /* The change over the term in points: the median % of the latest third of
     the scored pieces less the earliest third's. Zero with fewer than six
     pieces (so the earliest third never rests on one score) or under four
     weeks between the first and last. */
  function _trend(pieces) {
    var xs = (pieces || []).slice().sort(function (a, b) {
      return String(a.d).localeCompare(String(b.d));
    });
    var n = Math.floor(xs.length / 3);
    if (n < 2 || !(_days(xs[0].d, xs[xs.length - 1].d) >= ANGLE_DAYS)) return 0;
    var pct = function (p) {
      return Number(p.pct);
    };
    return _median(xs.slice(-n).map(pct)) - _median(xs.slice(0, n).map(pct));
  }

  /* What the stories are told from, all read off the facts. */
  function angleFacts(f, picks) {
    var g = f.grade || {};
    var pieces = g.pieces || [];
    var work = f.work || [];
    var rec = f.record || {};
    var habits = effectiveHabits((picks && picks.habits) || f.habits, rec);
    var letterMode = g.mode === 'letter' || g.mode === 'both';
    var level = Number(f.overall) || 0;
    var judged = (f.comps || []).filter(function (c) {
      return (c.scores || []).length >= THIN;
    });
    var levels = judged.map(function (c) {
      return tenths(c.level);
    });
    // The handed-in work on its own: its median %, else its median level.
    var strongWork = pieces.length
      ? pieces.length >= THIN &&
        _median(
          pieces.map(function (p) {
            return Number(p.pct);
          }),
        ) >= 73
      : work.length >= THIN &&
        _median(
          work.map(function (w) {
            return Number(w.v);
          }),
        ) >= 3;
    var joinedLate =
      !!f.enrolled &&
      !!f.classStart &&
      !!f.termStart &&
      f.enrolled > f.termStart &&
      _days(f.classStart, f.enrolled) >= NEW_DAYS;
    return {
      letter: g.letter || '',
      scored: Math.max(pieces.length, work.length),
      missing: _missingCount(f),
      total: rec.total || 0,
      strongWork: strongWork,
      trend: _trend(pieces),
      split: levels.length >= 2 && Math.max.apply(null, levels) - Math.min.apply(null, levels) >= 10,
      growing: Object.keys(habits).filter(function (k) {
        return habits[k] === 1 || habits[k] === 2;
      }).length,
      good: letterMode ? ['A', 'B', 'C+'].indexOf(g.letter) >= 0 : level >= 2.5,
      high: letterMode ? g.letter === 'A' || g.letter === 'B' : level >= 3,
      low: letterMode ? g.letter === 'C' || g.letter === 'C-' : level > 0 && level < 2.5,
      joinedLate: joinedLate,
    };
  }

  /* The story for one student: { id, order, lead }. order is the steps
     after the grade sentence; lead is the first of them. opts.uses: how
     many classmates' drafts told each story ({ id: n }), for the tie. */
  function angle(f, picks, opts) {
    var a = angleFacts(f, picks);
    var uses = (opts && opts.uses) || {};
    var fit = ANGLES.filter(function (x) {
      return x.when(a);
    });
    var tier = Math.min.apply(
      null,
      fit.map(function (x) {
        return x.tier;
      }),
    );
    var pick = fit
      .filter(function (x) {
        return x.tier === tier;
      })
      .sort(function (x, y) {
        return (uses[x.id] || 0) - (uses[y.id] || 0) || ANGLES.indexOf(x) - ANGLES.indexOf(y);
      })[0];
    return { id: pick.id, order: pick.order.slice(), lead: pick.order[0] };
  }

  /* The stories told in each class this session, per student, for the
     least-used tie: { cid: { sid: angle id } }. Kept in memory only. */
  var _told = {};
  function _usesFor(cid, sid) {
    var mine = _told[cid] || {};
    var out = {};
    Object.keys(mine).forEach(function (k) {
      if (k !== String(sid)) out[mine[k]] = (out[mine[k]] || 0) + 1;
    });
    return out;
  }

  /* The step a bank sentence belongs to: its part and group (or the habit
     slots it needs), first step in DRAFT_STEPS order. */
  function stepOf(s) {
    var st = DRAFT_STEPS.find(function (x) {
      if (!s || x.part !== s.part) return false;
      if (x.groups) return x.groups.indexOf(s.group) >= 0;
      return (s.needs || []).some(function (k) {
        return x.needsAny.indexOf(k) >= 0;
      });
    });
    return st ? st.key : null;
  }

  /* The steps a draft runs, in order: the grade, then the angle's order;
     a kept step the angle leaves out goes back where DRAFT_STEPS has it;
     then the teacher's order (step keys) over the steps it names, the
     others keeping their places. */
  function _sequence(order, keptSteps, teacherOrder) {
    var seq = ['grade'].concat(order);
    var all = DRAFT_STEPS.map(function (s) {
      return s.key;
    });
    keptSteps.forEach(function (k) {
      if (seq.indexOf(k) >= 0 || all.indexOf(k) < 0) return;
      var at = 0;
      seq.forEach(function (x, i) {
        if (all.indexOf(x) < all.indexOf(k)) at = i + 1;
      });
      seq.splice(at, 0, k);
    });
    var named = (teacherOrder || []).filter(function (k, i, xs) {
      return seq.indexOf(k) >= 0 && xs.indexOf(k) === i;
    });
    var slots = named
      .map(function (k) {
        return seq.indexOf(k);
      })
      .sort(function (x, y) {
        return x - y;
      });
    slots.forEach(function (at, i) {
      seq[at] = named[i];
    });
    return seq;
  }

  /* The teacher's kept sentences as { step: { id, text, s } }: opts.kept
     maps a step key or a sentence id (from an earlier draft) to the text
     the teacher wants kept, as written. */
  function _isStep(k) {
    return DRAFT_STEPS.some(function (x) {
      return x.key === k;
    });
  }
  function _bankSentence(bank, id) {
    return bank.sentences.find(function (x) {
      return x.id === id;
    });
  }
  function _kept(kept, bank) {
    var out = {};
    Object.keys(kept || {}).forEach(function (k) {
      var text = String(kept[k] == null ? '' : kept[k]).trim();
      if (!text) return;
      var s = _isStep(k) ? null : _bankSentence(bank, k);
      var step = s ? stepOf(s) : _isStep(k) ? k : null;
      if (step) out[step] = { id: s ? s.id : 'kept:' + step, text: text, s: s || null };
    });
    return out;
  }
  /* The teacher's order (step keys or sentence ids) as step keys. */
  function _orderSteps(order, bank) {
    return (order || [])
      .map(function (k) {
        return _isStep(k) ? k : stepOf(_bankSentence(bank, k));
      })
      .filter(Boolean);
  }

  /* ── Selection: most specific wins, exhaust before repeat ──────────── */

  /* How specific a sentence is for this student: the `when` conditions it
     meets (fits() needs every one met), plus one for the sentence that
     carries the teacher's Note for the Report on the best piece. Each step
     keeps only the sentences at its top score. */
  function specificity(s, ctx) {
    var n = Object.keys(s.when || {}).length;
    if (ctx._bestNote && (s.needs || []).indexOf('bestPiece') >= 0) n++;
    return n;
  }

  /* The sentences that stand in when a step's top tier is all excluded:
     ones in the step's part that assert nothing (claims []), fit, and are
     not in the draft or excluded, from the step's own groups when it has
     any there. */
  function _standIns(step, ctx, bank, taken, exclude) {
    var ok = bank.sentences.filter(function (s) {
      return (
        s.part === step.part &&
        Array.isArray(s.claims) &&
        !s.claims.length &&
        !taken[s.id] &&
        !exclude[s.id] &&
        fits(s, ctx)
      );
    });
    var own = ok.filter(function (s) {
      return step.groups && step.groups.indexOf(s.group) >= 0;
    });
    return own.length ? own : ok;
  }

  /* The sentences of each student's latest draft this session, per class:
     { cid: { sid: [{ id, text }] } }. A sentence that is mostly slots has
     no pattern to find in a saved comment (pattern()), so its use is known
     only from this record, and only while that classmate's saved comment
     still holds the text drafted. Kept in memory only. */
  var _drafted = {};

  /* How many classmates have each bank sentence: { sentence id: n }. Read
     off their saved comments for this report, so it survives a reload: a
     sentence counts for a classmate when its pattern is in their comment,
     or, for a sentence with no pattern, when this session drafted it for
     them and their comment still holds that text. comments: [{ sid, text }]
     (or plain strings, which only patterns can match). */
  function classUsage(bank, comments, cid, sid) {
    var mine = sid == null ? null : String(sid);
    var list = (comments || [])
      .map(_comment)
      .filter(function (c) {
        return c.sid == null || c.sid !== mine;
      })
      .map(function (c) {
        c.lower = c.text.toLowerCase();
        return c;
      });
    var out = {};
    var add = function (id) {
      out[id] = (out[id] || 0) + 1;
    };
    bank.sentences.forEach(function (s) {
      list.forEach(function (c) {
        if (_holds(s, c.text, c.lower)) add(s.id);
      });
    });
    var record = (cid != null && _drafted[cid]) || {};
    list.forEach(function (c) {
      var seen = {};
      (record[c.sid] || []).forEach(function (x) {
        var s = _bankSentence(bank, x.id);
        if (!s || seen[x.id] || pattern(s) || c.text.indexOf(x.text) < 0) return;
        seen[x.id] = true;
        add(x.id);
      });
    });
    return out;
  }

  /* One pass of the draft over the steps in `seq`. usage: { sentence id:
     classmates } (classUsage()); exclude: { sentence id: true }. */
  function _compose(ctx, bank, seq, kept, seed, usage, exclude) {
    var rand = _rng(seed);
    var byKey = {};
    DRAFT_STEPS.forEach(function (s) {
      byKey[s.key] = s;
    });
    var taken = {};
    var said = {};
    var got = {};
    var out = [];
    var sentences = [];
    var prov = [];
    // A kept sentence's facts count as said wherever it sits, so no other
    // sentence repeats them.
    Object.keys(kept).forEach(function (k) {
      var s = kept[k].s;
      if (s) taken[s.id] = true;
      ((s && s.needs) || []).forEach(function (n) {
        if (NO_REPEAT[n]) said[NO_REPEAT[n]] = true;
      });
      if (byKey[k].says) said[byKey[k].says] = true;
    });
    seq.forEach(function (key) {
      var step = byKey[key];
      if (kept[key]) {
        var kp = kept[key];
        out.push(kp.text);
        sentences.push({ id: kp.id, part: step.part, step: key, text: kp.text, kept: true });
        prov.push({
          sentenceId: kp.id,
          part: step.part,
          claims: [],
          factKeys: [],
          values: {},
          sources: {},
          kept: true,
        });
        got[key] = true;
        return;
      }
      if (step.unless && got[step.unless]) return;
      var cands = bank.sentences.filter(function (s) {
        if (s.part !== step.part || taken[s.id] || !fits(s, ctx)) return false;
        // A fact the draft already states (the growing habits, the goal, the
        // competency that rose) is not said twice.
        if (
          (s.needs || []).some(function (k) {
            return NO_REPEAT[k] && said[NO_REPEAT[k]];
          })
        )
          return false;
        // Once the grade sentence leads, no other sentence states the grade.
        if (said.grade && (s.claims || []).indexOf('grade') >= 0) return false;
        if (step.groups && step.groups.indexOf(s.group) < 0) return false;
        if (step.needsAny)
          return (s.needs || []).some(function (k) {
            return step.needsAny.indexOf(k) >= 0;
          });
        return true;
      });
      if (!cands.length) return;
      // Most specific wins: only the top tier is kept.
      var top = Math.max.apply(
        null,
        cands.map(function (s) {
          return specificity(s, ctx);
        }),
      );
      var tier = cands.filter(function (s) {
        return specificity(s, ctx) === top && !exclude[s.id];
      });
      // Every sentence of the top tier is excluded: a sentence that asserts
      // nothing stands in, never a vaguer claim.
      if (!tier.length) tier = _standIns(step, ctx, bank, taken, exclude);
      if (!tier.length) return;
      var last = out.length ? out[out.length - 1].split(/\s+/)[0] : '';
      var sofar = out.join(' ');
      var scored = tier.map(function (s) {
        var t = fill(s, ctx);
        // A quotation already in the draft (the same words twice) is out.
        var quotes = t.match(/“[^”]+”/g) || [];
        var dup = quotes.some(function (q) {
          return sofar.indexOf(q) >= 0;
        });
        return {
          s: s,
          t: t,
          dup: dup ? 1 : 0,
          // Exhaust before repeat: a sentence no classmate has comes before
          // any a classmate has, the least used next.
          used: usage[s.id] || 0,
          // At equal use, wording written for this kind of class first, then
          // a sentence that does not start like the one before it.
          general: s.subjects ? 0 : 1,
          repeats: repeatsLast(t, last) ? 1 : 0,
          // The grade step has one sentence that fits and draws no random
          // number, so the rest of the draft's mix is as it was.
          r: step.says ? 0 : rand(),
        };
      });
      scored.sort(function (a, b) {
        return a.dup - b.dup || a.used - b.used || a.general - b.general || a.repeats - b.repeats || a.r - b.r;
      });
      var pick = scored[0];
      taken[pick.s.id] = true;
      (pick.s.needs || []).forEach(function (k) {
        if (NO_REPEAT[k]) said[NO_REPEAT[k]] = true;
      });
      if (step.says) said[step.says] = true;
      out.push(pick.t);
      sentences.push({ id: pick.s.id, part: pick.s.part, step: key, text: pick.t });
      prov.push(provenance(pick.s, ctx));
      got[key] = true;
    });
    return {
      text: out.join(' '),
      ids: sentences.map(function (x) {
        return x.id;
      }),
      sentences: sentences,
      provenance: prov,
    };
  }

  /* A draft from the bank for one student: what the Generate Comment button
     puts in the box. The angle (angle(), from the facts the context was
     built from) sets the steps and their order, the grade sentence first.
     Each step takes, of the sentences that fit, the most specific
     (specificity()); of those, one no classmate has before any a classmate
     has, the least used next (classUsage()), so no sentence repeats in the
     class until that tier is used up; then wording for this kind of class,
     then one that does not start like the sentence before it, then a
     repeatable pick by `seed`. Every draft is verified (verify()) before
     it is returned, so the screen only ever gets text the facts back.

     opts: { seed; comments: classmates' comments this term, [{ sid, text }]
     or plain strings; previous: the text on screen, so each press gives
     another version (the next seeds are tried until the text differs);
     kept: { step key or sentence id: the teacher's text }, kept as written
     in its step; order: step keys or sentence ids in the teacher's order;
     angleUses: { angle id: n } in the class (else this session's drafts in
     the class); exclude: sentence ids never to use (last term's approved
     sentences, once draft_meta stores them; the screen passes none yet);
     bank }.

     Returns { text, ids, sentences, provenance, replaced, angle, seed }:
     each sentence { id, part, step, text, kept? } in order, where each came
     from (provenance()), what verify() replaced, the story told (never
     shown) and the seed used. A context built by hand, without facts, gets
     the steps in DRAFT_STEPS order and no verify. */
  var RETRIES = 8;
  function draft(ctx, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var f = ctx._f || null;
    var cid = f && f.cid;
    var sid = f && f.sid;
    var tally = cid != null && sid != null;
    var story = f ? angle(f, ctx._picks, { uses: opts.angleUses || (tally ? _usesFor(cid, sid) : {}) }) : null;
    var kept = _kept(opts.kept, bank);
    var seq = _sequence(
      story ? story.order : ANGLES[ANGLES.length - 1].order,
      Object.keys(kept),
      _orderSteps(opts.order, bank),
    );
    var previous = String(opts.previous == null ? '' : opts.previous).trim();
    var usage = classUsage(bank, opts.comments, cid, sid);
    var exclude = {};
    (opts.exclude || []).forEach(function (id) {
      exclude[id] = true;
    });
    var base = Number(opts.seed) || 1;
    var d;
    var seed = base;
    for (var k = 0; k < RETRIES; k++) {
      seed = base + k * 7919;
      d = _compose(ctx, bank, seq, kept, seed, usage, exclude);
      if (f) d = verify(d, f, ctx._picks, { bank: bank });
      else d.replaced = [];
      if (!previous || d.text !== previous) break;
    }
    if (story && tally) {
      _told[cid] = _told[cid] || {};
      _told[cid][sid] = story.id;
    }
    // This draft's bank sentences, for classmates' usage (classUsage()).
    if (tally) {
      _drafted[cid] = _drafted[cid] || {};
      _drafted[cid][String(sid)] = d.sentences
        .filter(function (x) {
          return !x.kept;
        })
        .map(function (x) {
          return { id: x.id, text: x.text };
        });
    }
    d.angle = story ? story.id : null;
    d.seed = seed;
    return d;
  }

  /* How many sentences fit, in all. */
  function fitCount(ctx, bank) {
    return (bank || COMMENT_BANK).sentences.filter(function (s) {
      return fits(s, ctx);
    }).length;
  }

  /* ── Near-identical comments ───────────────────────────────────────── */

  /* A comment's sentences: split after . ! ? or … (and a closing quote)
     where the next sentence starts. No lookbehind (Safari before 16.4). */
  function _sentencesOf(text) {
    var t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    var out = [];
    var re = /[.!?…]+["”]?\s+(?=["“]?[A-Z0-9])/g;
    var from = 0;
    var m;
    while ((m = re.exec(t))) {
      out.push(t.slice(from, m.index + m[0].length).trim());
      from = m.index + m[0].length;
    }
    if (from < t.length) out.push(t.slice(from).trim());
    return out.filter(Boolean);
  }

  /* A sentence's runs of four words, as a set: lower case, punctuation
     out, the student's own name as one word so classmates' sentences
     compare. */
  var RUN = 4;
  function _runs(sentence, names) {
    var t = String(sentence).toLowerCase();
    (names || []).forEach(function (n) {
      var name = String(n || '')
        .trim()
        .toLowerCase();
      if (!name) return;
      t = t.replace(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' \u0001 ');
    });
    var words = t
      .replace(/[’']s\b/g, ' s')
      .replace(/[^a-z0-9\u0001%+\- ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    var out = {};
    for (var i = 0; i + RUN <= words.length; i++) out[words.slice(i, i + RUN).join(' ')] = true;
    return out;
  }
  function _sharesRun(a, b) {
    for (var k in a) if (b[k]) return true;
    return false;
  }

  /* After the drafts exist for a class: the pairs of comments that read
     alike, each sharing five or more sentences, a sentence shared when it
     has a run of four words in common with a sentence of the other comment
     (each sentence paired once). comments: [{ sid, name, text }], `name`
     (or a list, `names`) the student's names to set aside. Returns [{ a, b,
     shared, pairs: [[sentence in a, sentence in b]] }] by sid, most shared
     first. opts: { min: 5 }. The warning on screen is a later change. */
  var NEAR_MIN = 5;
  function nearIdentical(comments, opts) {
    var min = (opts && opts.min) || NEAR_MIN;
    var docs = (comments || [])
      .filter(function (c) {
        return c && String(c.text || '').trim();
      })
      .map(function (c) {
        var names = (c.names || []).concat(c.name ? [c.name] : []);
        return {
          sid: c.sid,
          runs: _sentencesOf(c.text).map(function (s) {
            return _runs(s, names);
          }),
        };
      });
    var out = [];
    for (var i = 0; i < docs.length; i++) {
      for (var j = i + 1; j < docs.length; j++) {
        var a = docs[i];
        var b = docs[j];
        var taken = {};
        var pairs = [];
        a.runs.forEach(function (ra, x) {
          for (var y = 0; y < b.runs.length; y++) {
            if (taken[y] || !_sharesRun(ra, b.runs[y])) continue;
            taken[y] = true;
            pairs.push([x, y]);
            return;
          }
        });
        if (pairs.length >= min) out.push({ a: a.sid, b: b.sid, shared: pairs.length, pairs: pairs });
      }
    }
    return out.sort(function (x, y) {
      return y.shared - x.shared;
    });
  }

  /* ── Verify ────────────────────────────────────────────────────────── */

  /* What each claim a bank sentence makes needs to be true, checked against
     the facts (not the context the draft was filled from). Each check reads
     the sentence's provenance: its values and the fact keys behind each
     slot. A claim with nothing to check fails. */
  function _has(pv, k) {
    return Object.prototype.hasOwnProperty.call(pv.values || {}, k);
  }
  function _ids(pv, slot, kind) {
    return ((pv.sources || {})[slot] || [])
      .filter(function (k) {
        return k.indexOf(kind + ':') === 0;
      })
      .map(function (k) {
        return k.slice(kind.length + 1);
      });
  }
  function _byId(xs, id) {
    return (xs || []).find(function (x) {
      return String(x.id) === String(id);
    });
  }
  function _maxTenths(xs, key) {
    return xs.reduce(function (m, x) {
      return Math.max(m, tenths(x[key]));
    }, -Infinity);
  }
  /* The named items are at the top: none left out is higher than the
     lowest named. */
  function _atTop(named, all, key) {
    if (!named.length || !named.every(Boolean)) return false;
    var floor = Math.min.apply(
      null,
      named.map(function (x) {
        return tenths(x[key]);
      }),
    );
    return all.every(function (x) {
      return named.indexOf(x) >= 0 || tenths(x[key]) <= floor;
    });
  }
  function _article(w) {
    return (/^[AEIOU]/.test(w) ? 'an ' : 'a ') + w;
  }
  /* Work labelled Missing this term (facts().notHandedIn; the record's
     count for facts built without it). */
  function _missingCount(f) {
    if (f.notHandedIn && f.notHandedIn.count != null) return Number(f.notHandedIn.count) || 0;
    return (f.record && f.record.missing) || 0;
  }

  var CLAIMS = {
    // The overall standing: the letter, the proficiency word, or what the
    // work shows overall.
    grade: function (pv, f) {
      var v = pv.values;
      var now = f.overall > 0 ? word(f.overall) : '';
      var checks = [];
      if (_has(pv, 'letterStanding')) checks.push(!!f.letter && v.letterStanding === f.letter);
      if (_has(pv, 'standing')) checks.push(!!now && f.standing === now && v.standing === _article(now) + ' level');
      if (_has(pv, 'when.standing')) checks.push(!!now && f.standing === now && v['when.standing'] === now);
      if (_has(pv, 'evidence')) checks.push(!!v.evidence && v.evidence === evidenceOf(f));
      // The grade sentence: the kind it was written for (the letter, C-,
      // close to the next letter, the proficiency word) and each grade
      // slot, against gradeOf on the facts.
      var gr = gradeOf(f);
      if (_has(pv, 'when.grade')) checks.push(!!gr && v['when.grade'] === gr.kind);
      var want = gradeSlots(gr);
      Object.keys(want).forEach(function (k) {
        if (_has(pv, k)) checks.push(!!gr && !!want[k] && v[k] === want[k]);
      });
      return checks.length > 0 && checks.every(Boolean);
    },
    // Results are even: every competency with a start and now is at the
    // same proficiency word now.
    even: function (pv, f) {
      var withLevels = f.comps.filter(function (c) {
        return c.start > 0 && c.now > 0;
      });
      var named = _ids(pv, 'even', 'comp');
      return (
        withLevels.length > 1 &&
        named.length === withLevels.length &&
        withLevels.every(function (c) {
          return named.indexOf(String(c.id)) >= 0 && word(c.now) === word(withLevels[0].now);
        })
      );
    },
    // The strongest competencies, or the one the student feels strongest in
    // when the sentence says the work agrees.
    strength: function (pv, f) {
      var ids = _ids(pv, 'strengths', 'comp').concat(_ids(pv, 'selfStrong', 'confidence'));
      return _atTop(
        ids.map(function (id) {
          return _byId(f.comps, id);
        }),
        f.comps,
        'level',
      );
    },
    // Competencies to build: each below the highest now.
    growthArea: function (pv, f) {
      var ids = _ids(pv, 'growthAreas', 'comp')
        .concat(_ids(pv, 'focusLow', 'comp'))
        .concat(_ids(pv, 'selfLow', 'confidence'));
      var top = _maxTenths(f.comps, 'level');
      return (
        ids.length > 0 &&
        ids.every(function (id) {
          var c = _byId(f.comps, id);
          return !!c && tenths(c.level) < top;
        })
      );
    },
    improved: function (pv, f) {
      var ids = _ids(pv, 'rise', 'comp');
      return (
        ids.length > 0 &&
        ids.every(function (id) {
          var c = _byId(f.comps, id);
          return !!c && c.start > 0 && c.now > 0 && tenths(c.now) > tenths(c.start);
        })
      );
    },
    slipped: function (pv, f) {
      var checks = [];
      _ids(pv, 'fall', 'comp').forEach(function (id) {
        var c = _byId(f.comps, id);
        checks.push(!!c && c.start > 0 && c.now > 0 && tenths(c.now) < tenths(c.start));
      });
      if (_has(pv, 'fellCount')) {
        var fell = f.comps.filter(function (c) {
          return c.start > 0 && c.now > 0 && word(c.start) === 'Extending' && word(c.now) === 'Proficient';
        });
        checks.push(fell.length > 1 && pv.values.fellCount === (NUM[fell.length] || String(fell.length)));
      }
      return checks.length > 0 && checks.every(Boolean);
    },
    // The highest-marked work this term, with the proficiency it reached.
    bestPiece: function (pv, f) {
      var top = _maxTenths(f.work, 'v');
      var checks = [];
      // The whole best-piece sentence: the top piece, said with its note.
      if (_has(pv, 'bestPiece')) {
        var bw = _byId(f.work, _ids(pv, 'bestPiece', 'work')[0]);
        checks.push(
          !!bw &&
            tenths(bw.v) === top &&
            pv.values.bestPiece ===
              bestPieceSentence({
                title: bw.title,
                note: bw.note,
                name: f.name,
                pronouns: f.pronouns,
                onFile: f.pronounsOnFile,
              }),
        );
      }
      ['assignment', 'seeWork'].forEach(function (slot) {
        if (!_has(pv, slot)) return;
        var w = _byId(f.work, _ids(pv, slot, 'work')[0]);
        checks.push(!!w && w.title === pv.values[slot] && tenths(w.v) === top);
        if (w && slot === 'assignment' && _has(pv, 'level')) checks.push(pv.values.level === f.levelText(w.v));
      });
      if (_has(pv, 'strongWorks'))
        checks.push(
          _atTop(
            _ids(pv, 'strongWorks', 'work').map(function (id) {
              return _byId(f.work, id);
            }),
            f.work,
            'v',
          ),
        );
      return checks.length > 0 && checks.every(Boolean);
    },
    // Work marked below the best this term.
    weakPiece: function (pv, f) {
      var top = _maxTenths(f.work, 'v');
      var checks = [];
      if (_has(pv, 'assignment2')) {
        var w = _byId(f.work, _ids(pv, 'assignment2', 'work')[0]);
        checks.push(!!w && w.title === pv.values.assignment2 && tenths(w.v) < top);
        if (w && _has(pv, 'level2')) checks.push(pv.values.level2 === f.levelText(w.v));
      }
      if (_has(pv, 'weakWorks'))
        checks.push(
          _ids(pv, 'weakWorks', 'work').length > 0 &&
            _ids(pv, 'weakWorks', 'work').every(function (id) {
              var x = _byId(f.work, id);
              return !!x && tenths(x.v) < top;
            }),
        );
      return checks.length > 0 && checks.every(Boolean);
    },
    // Two pieces in the Focus Area: the one to show is marked at least as
    // high there as the one to talk about.
    focusWork: function (pv, f) {
      var compId = _ids(pv, 'seeWork', 'comp').concat(_ids(pv, 'aboutWork', 'comp'))[0];
      var c = _byId(f.comps, compId);
      if (!c) return false;
      var marks = function (slot) {
        var id = _ids(pv, slot, 'work')[0];
        return c.scores
          .filter(function (sc) {
            return id != null && String(sc.id) === id && sc.title === pv.values[slot];
          })
          .map(function (sc) {
            return sc.v;
          });
      };
      var see = _has(pv, 'seeWork') ? marks('seeWork') : null;
      var about = _has(pv, 'aboutWork') ? marks('aboutWork') : null;
      if ((see && !see.length) || (about && !about.length) || (!see && !about)) return false;
      return !see || !about || Math.max.apply(null, see) >= Math.min.apply(null, about);
    },
    // The Focus Area and its I Can statement.
    nextStep: function (pv, f) {
      var compId = _ids(pv, 'focus', 'comp').concat(_ids(pv, 'nextStep', 'comp'))[0];
      var c = _byId(f.comps, compId);
      if (!c) return false;
      if (_has(pv, 'focus') && pv.values.focus !== c.name) return false;
      if (_has(pv, 'nextStep'))
        return (
          c.iCans
            .map(function (t) {
              return _ended(t);
            })
            .indexOf(pv.values.nextStep) >= 0
        );
      return true;
    },
    // The habit ratings the sentence was matched on or names.
    habits: function (pv, f, ctx) {
      var eff = ctx._habits || {};
      var checks = [];
      Object.keys(pv.values).forEach(function (k) {
        var m = k.match(/^when\.(\w+)$/);
        if (m && m[1] !== 'picture' && m[1] !== 'standing' && m[1] !== 'grade') checks.push(eff[m[1]] === pv.values[k]);
      });
      ['strengthHabits', 'strengthHabitNames', 'growthHabits', 'growthHabitNames'].forEach(function (slot) {
        if (!_has(pv, slot)) return;
        var ok = /^strength/.test(slot) ? [3, 4] : [1, 2];
        var ids = _ids(pv, slot, 'habit');
        checks.push(
          ids.length > 0 &&
            ids.every(function (k) {
              return ok.indexOf(eff[k]) >= 0;
            }),
        );
      });
      return checks.length > 0 && checks.every(Boolean);
    },
    lateWork: function (pv, f) {
      return !!f.record && f.record.late > 0;
    },
    notHandedIn: function (pv, f) {
      return _missingCount(f) > 0;
    },
    attendance: function (pv, f) {
      var checks = [];
      if (_has(pv, 'absent')) checks.push(f.absent > 0 && pv.values.absent === String(f.absent));
      if (_has(pv, 'late')) checks.push(f.late > 0 && pv.values.late === String(f.late));
      return checks.length > 0 && checks.every(Boolean);
    },
    // The student's own words and self-assessment.
    studentWords: function (pv, f) {
      var checks = [];
      var said = { selfGood: 'good', selfHard: 'hard', goal: 'goal', plan: 'plan' };
      Object.keys(said).forEach(function (slot) {
        if (_has(pv, slot)) checks.push(!!pv.values[slot] && pv.values[slot] === _quote(f.voice[said[slot]]));
      });
      var conf = f.confidence || [];
      [
        ['selfStrong', 1],
        ['selfLow', -1],
      ].forEach(function (pair) {
        if (!_has(pv, pair[0])) return;
        var e = _byId(conf, _ids(pv, pair[0], 'confidence')[0]);
        checks.push(
          !!e &&
            conf.length > 1 &&
            e.name === pv.values[pair[0]] &&
            (pair[1] > 0 ? e.c >= 3 : e.c <= 2) &&
            conf.every(function (x) {
              return pair[1] > 0 ? x.c <= e.c : x.c >= e.c;
            }),
        );
      });
      return checks.length > 0 && checks.every(Boolean);
    },
    // The picture of the term an opening or closer was written for.
    picture: function (pv, f) {
      return _has(pv, 'when.picture') && pv.values['when.picture'] === pictureOf(f.comps);
    },
    // "Benefits from extra support": nothing in FullVision says so.
    support: function () {
      return false;
    },
  };

  /* The claims that fail for one sentence, and 'slots' when a value it was
     filled with is no longer what the facts give or it no longer fits. */
  function _failed(s, pv, f, ctx) {
    var own = Object.prototype.hasOwnProperty;
    var out = [];
    var stale =
      !fits(s, ctx) ||
      Object.keys(pv.values || {}).some(function (k) {
        if (/^when\./.test(k)) return false;
        var now = own.call(ctx, k) && ctx[k] != null ? String(ctx[k]) : '';
        return now !== pv.values[k];
      });
    if (stale) out.push('slots');
    if (!Array.isArray(s.claims)) return out.concat('claims');
    s.claims.forEach(function (c) {
      if (!CLAIMS[c] || !CLAIMS[c](pv, f, ctx)) out.push(c);
    });
    return out;
  }

  /* The no-claim sentence that stands in for a failed one: one in the same
     part that claims nothing, fits, and is not in the draft yet, its own
     group first, then bank order. None when the part has no such sentence. */
  function _fallback(s, ctx, bank, used) {
    var cands = bank.sentences.filter(function (x) {
      return x.part === s.part && Array.isArray(x.claims) && !x.claims.length && !used[x.id] && fits(x, ctx);
    });
    return (
      cands.find(function (x) {
        return x.group === s.group;
      }) ||
      cands[0] ||
      null
    );
  }

  /* Re-check a draft against the facts. Builds the slots afresh from the
     facts and the same picks the draft was made with (context(f, picks)),
     then checks every sentence: each value it was filled with must still be
     what the facts give, and each claim it makes must hold (CLAIMS). A
     sentence that fails is replaced by its part's no-claim sentence, or
     left out when the part has none. Returns the draft's shape { text, ids,
     sentences, provenance } plus `replaced`: [{ sentenceId, failed, by }],
     `by` the stand-in's id or null. opts: { bank }. */
  function verify(d, f, picks, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var ctx = context(f, picks);
    var byId = {};
    bank.sentences.forEach(function (s) {
      byId[s.id] = s;
    });
    var used = {};
    var prov = (d && d.provenance) || [];
    prov.forEach(function (pv) {
      used[pv.sentenceId] = true;
    });
    var sentences = [];
    var out = [];
    var replaced = [];
    prov.forEach(function (pv, i) {
      // A sentence the teacher kept is theirs, as written: not checked.
      if (pv.kept) {
        sentences.push(d.sentences[i]);
        out.push(pv);
        return;
      }
      var s = byId[pv.sentenceId];
      var failed = s ? _failed(s, pv, f, ctx) : ['unknown'];
      if (!failed.length) {
        sentences.push(d.sentences[i]);
        out.push(pv);
        return;
      }
      var stand = s ? _fallback(s, ctx, bank, used) : null;
      replaced.push({ sentenceId: pv.sentenceId, failed: failed, by: stand ? stand.id : null });
      if (!stand) return;
      used[stand.id] = true;
      var x = { id: stand.id, part: stand.part, text: fill(stand, ctx) };
      if (d.sentences[i] && d.sentences[i].step) x.step = d.sentences[i].step;
      sentences.push(x);
      out.push(provenance(stand, ctx));
    });
    return {
      text: sentences
        .map(function (x) {
          return x.text;
        })
        .join(' '),
      ids: sentences.map(function (x) {
        return x.id;
      }),
      sentences: sentences,
      provenance: out,
      replaced: replaced,
    };
  }

  return {
    SCALE: SCALE,
    HABITS: HABITS,
    NOT_SEEN: NOT_SEEN,
    USED_BY: USED_BY,
    completesFromRecord: completesFromRecord,
    effectiveHabits: effectiveHabits,
    facts: facts,
    notHandedIn: notHandedIn,
    focusOptions: focusOptions,
    context: context,
    fits: fits,
    fill: fill,
    lastStart: lastStart,
    rowMeta: rowMeta,
    repeatsLast: repeatsLast,
    pattern: pattern,
    usedBy: usedBy,
    parts: parts,
    fitCount: fitCount,
    familyOf: familyOf,
    forFamily: forFamily,
    draft: draft,
    specificity: specificity,
    classUsage: classUsage,
    nearIdentical: nearIdentical,
    provenance: provenance,
    verify: verify,
    CLAIMS: CLAIMS,
    STANDING: STANDING,
    aOrAn: aOrAn,
    trendingDown: trendingDown,
    closeTo: closeTo,
    gradeOf: gradeOf,
    pictureOf: pictureOf,
    seedFor: seedFor,
    workTitle: workTitle,
    reportNoteText: reportNoteText,
    bestPieceSentence: bestPieceSentence,
    studentRef: studentRef,
    DRAFT_STEPS: DRAFT_STEPS,
    ANGLES: ANGLES,
    angle: angle,
    angleFacts: angleFacts,
    stepOf: stepOf,
    list: list,
  };
})();
