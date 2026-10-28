/* comment-bank.js — the Term Questionnaire's Comment Bank engine (DECISIONS
   14, docs/questionnaire-plan.md). The teacher writes the comment; the bank
   (shared/comment-bank.js) offers wording in BC's four parts, each sentence
   filled in for the student and offered only when every slot it names has a
   value and its `when` matches. Nothing here assembles a paragraph.

   Two layers. facts() reads what FullVision has for one student this term
   (scores, assignments, observations, Student Voice, attendance) from the
   data layer; it never reads the page. Everything after it is pure:
   context() turns the facts and the teacher's picks (habits, Focus Area, I
   Can, the note to quote) into the slot values, and fits(), fill() and
   parts() decide what the Comment Bank column shows. */
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
  function _day(d) {
    var date = typeof parseLocalDate === 'function' ? parseLocalDate(String(d).slice(0, 10)) : new Date(d);
    return isNaN(date) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function _answer(it) {
    return it && it.v && it.v.text ? String(it.v.text).trim() : '';
  }

  /* ── What FullVision has ───────────────────────────────────────────── */

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
          getTagScores(cid, sid, tag.id).forEach(function (sc) {
            var a = byId[sc.assessmentId];
            if (!(sc.score > 0) || !inTerm(a) || !dateOf(a)) return;
            scores.push({ v: Number(sc.score), d: dateOf(a), title: a.title || '' });
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
        return v > 0 ? { id: a.id, title: a.title || '', d: dateOf(a), v: v } : null;
      })
      .filter(Boolean);

    // Handed In, Late, Missing: the Missing Work block's rule.
    var rec = { total: 0, handed: 0, late: 0, missing: 0 };
    assessments.filter(inTerm).forEach(function (a) {
      var cell = assessmentCellValue(cid, sid, a);
      var missing = cell.kind === 'missing' || cell.status === 'NS';
      var scored = ['level', 'points', 'complete'].indexOf(cell.kind) >= 0;
      if (!missing && !scored) return;
      rec.total++;
      if (missing) rec.missing++;
      else rec.handed++;
      if (cell.late) rec.late++;
    });

    // Observations this term, newest first.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var obs = (getStudentQuickObs(cid, sid) || [])
      .map(function (o) {
        return { o: o, d: String(o.date || o.created || '').slice(0, 10) };
      })
      .filter(function (x) {
        return !term || (x.d && x.d >= term.startsOn && x.d <= term.endsOn);
      })
      .sort(function (x, y) {
        return y.d.localeCompare(x.d);
      })
      .map(function (x) {
        return {
          id: x.o.id,
          text: String(x.o.text || '').trim(),
          d: x.d,
          day: _day(x.d),
          sentiment: x.o.sentiment || null,
          dims: x.o.dims || [],
        };
      });

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
        return sec && c > 0 ? { name: sec.name, c: c } : null;
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

    return {
      cid: cid,
      sid: sid,
      name: displayNameFirst(student),
      first: student.firstName || displayNameFirst(student),
      course: course.name || '',
      pronouns: ReportBlocks.getPronouns(student),
      comps: comps,
      work: work,
      record: rec,
      obs: obs,
      voice: voice,
      confidence: conf,
      overall: overall,
      standing: mode !== 'letter' && overall > 0 ? word(overall) : '',
      letter: letter && letter.S ? (/^[AFI]/.test(letter.S) ? 'an ' : 'a ') + letter.S + ' (' + letter.R + '%)' : '',
      levelText: function (v) {
        return mode === 'letter' ? formatLevel(cid, v) : levelWord(cid, v);
      },
      defaultFocusId: (focus && focus.sec && focus.sec.id) || null,
      focusId: rating.focusSectionId || (focus && focus.sec && focus.sec.id) || null,
      absent: att.absencesThisTerm,
      late: att.latesThisTerm,
      habits: rating.habits || {},
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

  /* Every value a bank sentence can ask for, from the facts and the
     teacher's picks { habits, focus, ican, note }. An empty value means the
     sentences that need it are not offered. */
  function context(f, picks) {
    picks = picks || {};
    var p = f.pronouns;
    var habits = effectiveHabits(picks.habits || f.habits, f.record);
    var withLevels = f.comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });

    // The picture of the term that picks an opening.
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
    var picture = !withLevels.length
      ? 'early'
      : nowWords.some(function (w) {
            return w === 'Developing' || w === 'Emerging';
          })
        ? 'challenge'
        : nowWords.indexOf('Extending') >= 0 || rises.length > drops.length
          ? 'strong'
          : 'steady';
    var fell = withLevels.filter(function (c) {
      return word(c.start) === 'Extending' && word(c.now) === 'Proficient';
    });

    var options = focusOptions(f, picks.focus);
    var focus =
      options.find(function (c) {
        return c.id === picks.focus;
      }) || options[0];
    var iCan = focus && focus.iCans.length ? focus.iCans[Math.min(picks.ican || 0, focus.iCans.length - 1)] : '';
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
        }
      }
    }

    var note =
      f.obs.find(function (o) {
        return o.id === picks.note;
      }) || f.obs[0];
    // Something to work on: a growth or concern note other than the one
    // being quoted, so a draft never quotes the same note twice.
    var isConcern = function (o) {
      return o.sentiment === 'concern' || o.sentiment === 'growth';
    };
    var concern =
      f.obs.find(function (o) {
        return isConcern(o) && (!note || o.id !== note.id);
      }) || f.obs.find(isConcern);

    var withHabit = function (lvl) {
      return HABITS.filter(function (h) {
        return habits[h.key] === lvl;
      });
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
              return phrase(h.does);
            }),
          ),
      );
    if (withHabit(3).length)
      strengthBits.push(
        'usually ' +
          list(
            withHabit(3).map(function (h) {
              return phrase(h.does);
            }),
          ),
      );
    var growing = withHabit(2).concat(withHabit(1));
    var conf = f.confidence;

    return {
      _p: p,
      _habits: habits,
      _standing: f.standing || '',
      _options: options,
      _focus: focus || null,
      _note: note || null,
      name: f.name,
      course: f.course,
      picture: picture,
      standing: f.standing ? (/^[AEIOU]/.test(f.standing) ? 'an ' : 'a ') + f.standing + ' level' : '',
      letterStanding: f.letter,
      strengths: list(
        byNow
          .filter(function (c) {
            return lowest.indexOf(c) < 0;
          })
          .slice(0, 2)
          .map(function (c) {
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
      fall: drops.length
        ? drops.slice().sort(function (a, b) {
            return tenths(a.start) - tenths(a.now) - (tenths(b.start) - tenths(b.now));
          })[0].name
        : '',
      fellCount: fell.length > 1 ? NUM[fell.length] || String(fell.length) : '',
      assignment: top ? top.title : '',
      level: top ? f.levelText(top.v) : '',
      assignment2: weak ? weak.title : '',
      level2: weak ? f.levelText(weak.v) : '',
      strongWorks: list(best.slice(0, 2).map(the)),
      weakWorks: list(weakTwo.slice(0, 2).map(the)),
      evidence: f.work.length
        ? f.overall >= 2.5
          ? 'a solid grasp of the material'
          : 'progress toward understanding the key concepts'
        : '',
      note: note ? _ended(note.text) : '',
      when: note && note.day ? 'on ' + note.day : '',
      concernNote: concern ? _ended(concern.text) : '',
      concernWhen: concern && concern.day ? concern.day : '',
      selfGood: _quote(f.voice.good),
      selfHard: _quote(f.voice.hard),
      selfStrong: conf.length > 1 && conf[0].c >= 3 ? conf[0].name : '',
      selfLow: conf.length > 1 && conf[conf.length - 1].c <= 2 ? conf[conf.length - 1].name : '',
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
          return phrase(h.doing);
        }),
      ),
      strengthHabitNames: list(
        withHabit(4)
          .concat(withHabit(3))
          .map(function (h) {
            return h.short;
          }),
      ),
      growthHabitNames: list(
        growing.map(function (h) {
          return h.short;
        }),
      ),
      absent: f.absent > 0 ? String(f.absent) : '',
      late: f.late > 0 ? String(f.late) : '',
    };
  }

  /* ── Offering and filling ──────────────────────────────────────────── */

  function fits(s, ctx) {
    var needs = s.needs || [];
    for (var i = 0; i < needs.length; i++) if (!ctx[needs[i]]) return false;
    var when = s.when || {};
    return Object.keys(when).every(function (k) {
      if (k === 'picture') return ctx.picture === when[k];
      if (k === 'standing') return ctx._standing === when[k];
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
     four words of its own has none. */
  var _patterns = {};
  function pattern(s) {
    if (s.id in _patterns) return _patterns[s.id];
    var fixed = String(s.text)
      .replace(/\{\w+\}/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .split(/\s+/)
      .filter(function (w) {
        return /[a-z]{2}/i.test(w);
      });
    var re = null;
    if (fixed.length >= 4) {
      var src = String(s.text)
        .split(/(\{\w+\}|\[[^\]]*\])/)
        .map(function (part) {
          if (/^\{\w+\}$/.test(part)) return '.+?';
          var alt = part.match(/^\[([^|\]]*)\|([^\]]*)\]$/);
          if (alt) return '(?:' + alt[1] + '|' + alt[2] + ')';
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      re = new RegExp(src, 'i');
    }
    _patterns[s.id] = re;
    return re;
  }

  /* How many classmates' comments this term hold the sentence. */
  function usedBy(s, comments) {
    var re = pattern(s);
    if (!re) return 0;
    return (comments || []).filter(function (c) {
      return re.test(c);
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

  /* The draft's shape: an opening, the habits (what is strong, what is
     growing, attendance when entered), where the student is now (overall,
     growth, one example), the next step (and the student's own goal), and
     how they will get there (home or class, then a closer). Each step takes
     at most one sentence. */
  var DRAFT_STEPS = [
    { part: 'now', groups: ['Openings'] },
    { part: 'habits', needsAny: ['strengthHabits', 'strengthHabitNames'] },
    { part: 'habits', needsAny: ['growthHabits', 'growthHabitNames'] },
    { part: 'habits', groups: ['Completes Work and Takes Part'], unless: 1 },
    { part: 'habits', groups: ['Attendance'] },
    { part: 'now', groups: ['Overall'] },
    { part: 'now', groups: ['Growth This Term'] },
    { part: 'now', groups: ['Examples From Work', 'From Your Notes', "In the Student's Words"] },
    { part: 'go', groups: ['Next Step'] },
    { part: 'go', groups: ["In the Student's Words", 'Work to Revisit', 'From Your Notes'] },
    { part: 'how', groups: ['At Home', 'In Class', "In the Student's Words"] },
    { part: 'how', groups: ['Looking Ahead'] },
  ];

  /* A draft from the bank for one student: the sentences that fit, one per
     step, the least used for classmates first, a repeatable pick among the
     ties by `seed` (a new seed gives a new mix), never two in a row that
     start with the same word. Returns { text, ids }. */
  function draft(ctx, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var rand = _rng(opts.seed);
    var comments = opts.comments || [];
    var taken = {};
    var out = [];
    var got = [];
    DRAFT_STEPS.forEach(function (step, i) {
      if (step.unless != null && got[step.unless]) return;
      var cands = bank.sentences.filter(function (s) {
        if (s.part !== step.part || taken[s.id] || !fits(s, ctx)) return false;
        if (step.groups && step.groups.indexOf(s.group) < 0) return false;
        if (step.needsAny)
          return (s.needs || []).some(function (k) {
            return step.needsAny.indexOf(k) >= 0;
          });
        return true;
      });
      if (!cands.length) {
        got[i] = false;
        return;
      }
      var last = out.length ? out[out.length - 1].split(/\s+/)[0] : '';
      var sofar = out.join(' ');
      var scored = cands.map(function (s) {
        var t = fill(s, ctx);
        var used = usedBy(s, comments);
        // A quotation already in the draft (the same note twice) is out.
        var quotes = t.match(/\u201C[^\u201D]+\u201D/g) || [];
        if (
          quotes.some(function (q) {
            return sofar.indexOf(q) >= 0;
          })
        )
          used += 100;
        // An opening a classmate already has reads as a form letter.
        if (step.groups && step.groups[0] === 'Openings' && used) used += 10;
        if (repeatsLast(t, last)) used += 5;
        return { s: s, t: t, used: used, r: rand() };
      });
      scored.sort(function (a, b) {
        return a.used - b.used || a.r - b.r;
      });
      var pick = scored[0];
      taken[pick.s.id] = true;
      out.push(pick.t);
      got[i] = true;
    });
    return {
      text: out.join(' '),
      ids: Object.keys(taken),
    };
  }

  /* How many sentences fit, in all. */
  function fitCount(ctx, bank) {
    return (bank || COMMENT_BANK).sentences.filter(function (s) {
      return fits(s, ctx);
    }).length;
  }

  return {
    SCALE: SCALE,
    HABITS: HABITS,
    NOT_SEEN: NOT_SEEN,
    USED_BY: USED_BY,
    completesFromRecord: completesFromRecord,
    effectiveHabits: effectiveHabits,
    facts: facts,
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
    draft: draft,
    seedFor: seedFor,
    DRAFT_STEPS: DRAFT_STEPS,
    list: list,
  };
})();
