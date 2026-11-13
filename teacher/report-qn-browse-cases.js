// @ts-check
/* report-qn-browse-cases.js — Browse Sentences: the cases. Which case each
   sentence in a part is for, the student's own cases, and how a sentence
   frame is filled for another case. Moved from teacher/report-questionnaire.js
   on 2026-11-13 (move only; the split plan is docs/plans/questionnaire-file-map.md).
   It keeps no state of its own and reads the bank (CommentBank) and the grade
   scale (BC_LETTER_BANDS, PROF_LABELS) as globals. */
window.ReportQnBrowseCases = (function () {
  'use strict';

  /* ── Browse Sentences: the cases ─────────────────────────── */

  /* Within a part the sentences sit under headings that name the case
     each one is for, in a fixed order, the student's own case first
     (Colin, Nov 1: "the teacher must be able to select the appropriate
     comments if they don't see something reflective of the student"). A
     sentence's case is read from its taxonomy fields where the bank has
     them (standing, story, skill, habit, level, subjects) and derived from
     `when` and `needs` otherwise, so the grouping works on today's bank. A
     frame that serves several cases (a grade sentence with the letter as
     a slot) is listed under every case it serves, previewed for that case.
     Headings are plain words in Title Case: no competency codes, no
     pronouns. */
  var FAMILY_ORDER = ['socials', 'science', 'math', 'ela', 'arts', 'pe', 'adst', 'career', 'languages'];
  var FAMILY_NAMES = {
    socials: 'Social Studies',
    science: 'Science',
    math: 'Mathematics',
    ela: 'English Language Arts',
    arts: 'Arts Education',
    pe: 'Physical and Health Education',
    adst: 'Applied Design, Skills and Technologies',
    career: 'Career Education',
    languages: 'Languages',
  };
  var LEVEL_WORDS = { 4: 'Consistently', 3: 'Usually', 2: 'Sometimes', 1: 'Rarely' };
  // The letter grades by standing (the Letter Grades Order), and the next
  // letter up for the "close to" frames; A has none.
  var LETTERS = BC_LETTER_BANDS.filter(function (b) {
    return b.min > 0;
  }).map(function (b) {
    return b.label;
  });
  var NEXT_LETTER = {};
  LETTERS.forEach(function (l, i) {
    if (i > 0) NEXT_LETTER[l] = LETTERS[i - 1];
  });
  var PROFICIENCY_WORDS = [4, 3, 2, 1].map(function (l) {
    return PROF_LABELS[l];
  });
  // The stories a strengths sentence can be written for (CommentBank.ANGLES
  // ids); any other story reads as steady.
  var STORIES = [
    ['steady', 'Any Student'],
    ['climb', 'Marks Climbed'],
    ['slide', 'Marks Slid'],
    ['split', 'Strong in One Skill'],
    ['hidden', 'Grade Lowered by Missing Work'],
    ['newcomer', 'New to the Class'],
  ];
  var SUMMARY_CASES = [
    ['sum:excellent', 'Summary · Excellent'],
    ['sum:good', 'Summary · Good'],
    ['sum:one', 'Summary · One Habit to Build'],
    ['sum:two', 'Summary · Two Habits to Build'],
    ['sum:any', 'Summary'],
  ];
  var ATTENDANCE_CASES = [
    ['att:absent', 'Absences Only'],
    ['att:late', 'Lates Only'],
    ['att:both', 'Absences and Lates'],
  ];
  var MISSING_CASES = ['one', 'two', 'count', 'group'];

  function _titleCase(w) {
    return String(w || '').replace(/\b[a-z]/g, function (c) {
      return c.toUpperCase();
    });
  }
  /* A grade case from a standing: a letter (A to C-), a Letter Grades
     Order word or a proficiency word; '' when it is none of them. */
  function _standingCase(w) {
    var s = String(w || '').trim();
    if (CommentBank.STANDING[s]) s = CommentBank.STANDING[s];
    var low = s.toLowerCase();
    var letter = LETTERS.find(function (l) {
      return CommentBank.STANDING[l] === low;
    });
    if (letter) return 'w:' + letter;
    var pw = PROFICIENCY_WORDS.find(function (x) {
      return x.toLowerCase() === low;
    });
    return pw ? 'p:' + pw : '';
  }
  /* A habit rating as the stored scale, 1 Rarely to 4 Consistently, from a
     number or its word; 0 when it is neither. */
  function _levelNum(v) {
    var n = Number(v);
    if (n >= 1 && n <= 4) return n;
    var w = String(v || '').toLowerCase();
    var k = Object.keys(LEVEL_WORDS).find(function (x) {
      return LEVEL_WORDS[x].toLowerCase() === w;
    });
    return k ? Number(k) : 0;
  }
  function _storyCase(id) {
    return STORIES.some(function (x) {
      return x[0] === id;
    })
      ? id
      : 'steady';
  }
  function _familyOfSkill(key) {
    return (
      FAMILY_ORDER.find(function (fam) {
        return (CommentBank.SKILLS[fam] || []).some(function (r) {
          return r.key === key;
        });
      }) || ''
    );
  }

  /* The cases of a part, in their fixed order: [{ id, label }]. Support and
     Closing list the class's own lines and have no bank cases. */
  function browseCases(part) {
    var out = [];
    var add = function (id, label) {
      out.push({ id: id, label: label });
    };
    if (part === 'grade') {
      LETTERS.forEach(function (l) {
        add('w:' + l, _titleCase(CommentBank.STANDING[l]));
      });
      PROFICIENCY_WORDS.forEach(function (w) {
        add('p:' + w, w);
      });
      add('ie', 'Not Enough Evidence');
      add('languageGoals', 'Language Goals');
      add('iepGoals', 'IEP Goals');
    } else if (part === 'bestPiece') {
      add('note', 'With a Note for the Report');
      add('noNote', 'Without a Note for the Report');
    } else if (part === 'strengths') {
      STORIES.forEach(function (x) {
        add(x[0], x[1]);
      });
      // Even results (CommentBank.evenComps), by the overall proficiency
      // word the frame's verb is bound to (bank n5xx).
      PROFICIENCY_WORDS.forEach(function (w) {
        add('even:' + w, 'Even Results · ' + w);
      });
      // The student's own highest-marked skill (CommentBank.highestSkills),
      // by the competency's proficiency word (bank n1001-n1027).
      PROFICIENCY_WORDS.forEach(function (w) {
        add('high:' + w, 'Highest Marks · ' + w);
      });
      PROFICIENCY_WORDS.forEach(function (w) {
        add('st:' + w, w);
      });
      FAMILY_ORDER.forEach(function (fam) {
        // The strongest skill, under its kind of class (bank n6xx-n7xx).
        (CommentBank.SKILLS[fam] || []).forEach(function (r) {
          add('skill:' + fam + ':' + r.key, FAMILY_NAMES[fam] + ' · ' + r.name);
        });
        add('fam:' + fam, FAMILY_NAMES[fam]);
        PROFICIENCY_WORDS.forEach(function (w) {
          add('fam:' + fam + ':' + w, FAMILY_NAMES[fam] + ' · ' + w);
        });
      });
    } else if (part === 'habits') {
      // Every habit at every rating is its own case (Colin, Nov 1: "each
      // rating of each habit needs its own selection"), then the summary
      // sentences, the IE comment's strong habits, and attendance.
      CommentBank.HABITS.forEach(function (h) {
        [4, 3, 2, 1].forEach(function (l) {
          add('cell:' + h.key + ':' + l, h.name + ' · ' + LEVEL_WORDS[l]);
        });
      });
      SUMMARY_CASES.forEach(function (x) {
        add(x[0], x[1]);
      });
      add('strong', 'Strong Habits');
      ATTENDANCE_CASES.forEach(function (x) {
        add(x[0], x[1]);
      });
    } else if (part === 'notHandedIn') {
      add('one', 'One Title');
      add('two', 'Two Titles');
      add('count', 'A Count');
      add('group', 'A Count and a Group');
    } else if (part === 'nextStep') {
      FAMILY_ORDER.forEach(function (fam) {
        (CommentBank.SKILLS[fam] || []).forEach(function (r) {
          add('skill:' + fam + ':' + r.key, FAMILY_NAMES[fam] + ' · ' + r.name);
        });
        add('fam:' + fam, FAMILY_NAMES[fam]);
        (CommentBank.SKILLS[fam] || []).forEach(function (r) {
          add('home:' + fam + ':' + r.key, FAMILY_NAMES[fam] + ' · ' + r.name + ' · For the Family');
        });
        add('home:' + fam, FAMILY_NAMES[fam] + ' · For the Family');
      });
      add('any', 'Any Class');
      add('home:any', 'Any Class · For the Family');
    }
    add('other', 'Other');
    return out;
  }

  /* The cases a bank sentence is for, within a part: one, or every case a
     frame with a slot can serve. */
  function browseCase(part, s) {
    if (s.setCase) return [s.setCase];
    var when = s.when || {};
    var needs = s.needs || [];
    var has = function (k) {
      return needs.indexOf(k) >= 0;
    };
    var fam = s.subjects && s.subjects.length === 1 ? s.subjects[0] : '';
    var step = CommentBank.stepOf(s);
    if (part === 'grade') {
      if (s.standing) return [_standingCase(s.standing) || 'other'];
      var g = when.grade;
      if (g === 'letter')
        return LETTERS.slice(0, 4).map(function (l) {
          return 'w:' + l;
        });
      if (g === 'letterClose')
        return LETTERS.slice(1, 4).map(function (l) {
          return 'w:' + l;
        });
      if (g === 'cminus' || g === 'cminusClose') return ['w:C-'];
      if (g === 'proficiency')
        return PROFICIENCY_WORDS.map(function (w) {
          return 'p:' + w;
        });
      return /^(ie|languageGoals|iepGoals)$/.test(g || '') ? [g] : ['other'];
    }
    if (part === 'bestPiece') return has('bestNote') ? ['note'] : has('assignment') ? ['noNote'] : ['note', 'noNote'];
    if (part === 'strengths') {
      if (s.story) return [_storyCase(s.story)];
      var story = ['climb', 'slide', 'split', 'hidden', 'newcomer'].find(has);
      if (story) return [story];
      if (has('new')) return ['newcomer'];
      // A frame for the strongest skill, or for a strength among a tie at
      // the top (`when.topSkill`), under its kind of class; an even-results
      // frame under the word its verb is bound to.
      var skillKey = when.strongSkill || when.topSkill;
      if (skillKey) {
        var sf = fam || _familyOfSkill(skillKey);
        return [sf ? 'skill:' + sf + ':' + skillKey : 'other'];
      }
      if (when.evenWord) return ['even:' + when.evenWord];
      if (when.highestWord) return ['high:' + when.highestWord];
      if (fam) return ['fam:' + fam + (when.standing ? ':' + when.standing : '')];
      return [when.standing ? 'st:' + when.standing : 'steady'];
    }
    if (part === 'habits') {
      var habit = s.habit || '';
      var level = _levelNum(s.level);
      if (!habit) {
        var keys = Object.keys(when).filter(function (k) {
          return CommentBank.HABITS.some(function (h) {
            return h.key === k;
          });
        });
        if (keys.length === 1) {
          habit = keys[0];
          level = _levelNum(when[habit]);
        }
      }
      if (habit && level) return ['cell:' + habit + ':' + level];
      if (step === 'attendance' || s.group === 'Attendance') {
        if (has('absentOnly')) return ['att:absent'];
        if (has('lateOnly')) return ['att:late'];
        if (has('absentClasses') && has('lateTimes')) return ['att:both'];
        if (has('absentClasses')) return ['att:absent'];
        if (has('lateTimes')) return ['att:late'];
        return ATTENDANCE_CASES.map(function (x) {
          return x[0];
        });
      }
      if (step === 'strongHabits' || s.group === 'Strong Habits' || has('habitStrengths') || has('strongHabits'))
        return ['strong'];
      if (has('habitsExcellent')) return ['sum:excellent'];
      if (has('habitsGood')) return ['sum:good'];
      if (has('habitToBuild')) return ['sum:one'];
      if (has('habitsToBuild')) return ['sum:two'];
      return ['sum:any'];
    }
    if (part === 'notHandedIn') {
      if (has('missingTitle')) return ['one'];
      if (has('missingTitles')) return ['two'];
      if (has('missingGroup')) return ['group'];
      if (has('missingMany') || has('missingCount')) return ['count'];
      return MISSING_CASES.slice();
    }
    if (part === 'nextStep') {
      var key = s.skill || when.nextSkill || '';
      if (step === 'home' || s.group === 'For the Family') {
        var hf = fam || (key && _familyOfSkill(key)) || '';
        return ['home:' + (hf || 'any') + (key && hf ? ':' + key : '')];
      }
      if (key) {
        var sf = fam || _familyOfSkill(key);
        return [sf ? 'skill:' + sf + ':' + key : 'other'];
      }
      return [fam ? 'fam:' + fam : 'any'];
    }
    return ['other'];
  }

  /* The slot values that preview a frame for a case the student is not
     in: another letter's grade words, or a slot left blank (shown as …)
     for attendance or missing work the student does not have. null when
     the preview needs no change. */
  function _caseFill(part, id, s) {
    if (part === 'grade') {
      var m = /^w:(.+)$/.exec(id);
      if (m && LETTERS.indexOf(m[1]) >= 0) {
        var next = NEXT_LETTER[m[1]];
        return {
          gradeLetter: CommentBank.aOrAn(m[1]),
          gradeStanding: CommentBank.STANDING[m[1]],
          gradeNext: next ? CommentBank.aOrAn(next) : '',
        };
      }
      var p = /^p:(.+)$/.exec(id);
      return p ? { gradeWord: p[1] } : null;
    }
    var needs = s.needs || [];
    if (part === 'habits' && /^att:/.test(id) && needs.indexOf('attendance') >= 0) return { attendance: '' };
    if (part === 'notHandedIn' && needs.indexOf('missingWork') >= 0) return { missingWork: '' };
    return null;
  }

  /* The student's own cases in a part, the most specific first, from the
     facts the context was built on: the grade sentence's kind and standing,
     whether the best piece has a note, the term's story, standing and kind
     of class, each habit's rating, the attendance entered, how much work is
     not handed in, and the next step's skill. */
  function browseOwn(part, ctx) {
    var f = ctx._f || {};
    var out = [];
    var fam = ctx._family || '';
    if (part === 'grade') {
      /** @type {{ kind?: string, letter?: string, word?: string }} */
      var gr = CommentBank.gradeOf(f) || {};
      var k = gr.kind || '';
      if (gr.letter) out.push('w:' + gr.letter);
      else if (k === 'proficiency') out.push('p:' + gr.word);
      else if (k) out.push(k);
    } else if (part === 'bestPiece') {
      out.push(ctx._bestNote ? 'note' : 'noNote');
    } else if (part === 'strengths') {
      var story = 'steady';
      try {
        story = _storyCase(CommentBank.angle(f, ctx._picks || {}).id);
      } catch (e) {
        /* a context built by hand: the steady story */
      }
      // The strength's skill (the strongest, else one of a tie at the top),
      // else even results, else the highest-marked skill, come before the
      // story.
      if (fam && ctx._topSkill) out.push('skill:' + fam + ':' + ctx._topSkill);
      if (ctx._evenWord) out.push('even:' + ctx._evenWord);
      if (ctx._highestWord) out.push('high:' + ctx._highestWord);
      out.push(story);
      if (fam && f.standing) out.push('fam:' + fam + ':' + f.standing);
      if (fam) out.push('fam:' + fam);
      if (f.standing) out.push('st:' + f.standing);
    } else if (part === 'habits') {
      var h = ctx._habits || {};
      CommentBank.HABITS.forEach(function (x) {
        var v = Number(h[x.key]);
        if (v >= 1 && v <= 4) out.push('cell:' + x.key + ':' + v);
      });
      if (ctx.habitsExcellent) out.push('sum:excellent');
      else if (ctx.habitsGood) out.push('sum:good');
      else if (ctx.habitToBuild) out.push('sum:one');
      else if (ctx.habitsToBuild) out.push('sum:two');
      out.push('sum:any');
      if (ctx._path === 'ie') out.push('strong');
      var absent = Number(f.absent) > 0;
      var late = Number(f.late) > 0;
      if (absent && late) out.push('att:both');
      else if (absent) out.push('att:absent');
      else if (late) out.push('att:late');
    } else if (part === 'notHandedIn') {
      var nh = f.notHandedIn || {};
      var n = Number(nh.count) || 0;
      if (n === 1) out.push('one');
      else if (n === 2) out.push('two');
      else if (n > 2) {
        if ((nh.groups || []).length) out.push('group');
        out.push('count');
      }
    } else if (part === 'nextStep') {
      if (fam && ctx._nextSkill) out.push('skill:' + fam + ':' + ctx._nextSkill);
      if (fam) out.push('fam:' + fam);
      if (fam && ctx._nextSkill) out.push('home:' + fam + ':' + ctx._nextSkill);
      if (fam) out.push('home:' + fam);
      else out.push('any', 'home:any');
    }
    return out.filter(function (id, i, xs) {
      return !!id && xs.indexOf(id) === i;
    });
  }

  return { browseCases: browseCases, browseCase: browseCase, _caseFill: _caseFill, browseOwn: browseOwn };
})();
