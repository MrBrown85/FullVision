/* The questionnaire on the student page (docs/STUDENT-VOICE-PLAN.md, PR 7;
   canvas screens 2–5): Is This You, one page per part (the questionnaire,
   then its Goal Check-In), and Sent. Moved out of student.js, which holds
   the code box, the identity check, the edge function and drafts, and loads
   first. This file adds its screens with StudentPage.addScreens. */
(function () {
  'use strict';

  // A copy of student.js from before the split holds these screens itself.
  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var MESSAGES = StudentPage.MESSAGES;
  var className = StudentPage.className;
  var fmtDate = StudentPage.fmtDate;
  var header = StudentPage.header;
  var codeBox = StudentPage.codeBox;
  var slipParts = StudentPage.slipParts;
  var identityFields = StudentPage.identityFields;
  var verifyIdentity = StudentPage.verifyIdentity;
  var saveDraft = StudentPage.saveDraft;
  var clearDraft = StudentPage.clearDraft;
  var paint = StudentPage.paint;
  var grow = StudentPage.grow;
  // A teacher-built reflection's questions and the new kinds (s/question-kinds.js); a copy of
  // index.html from before it draws the ready-made reflections as it always did.
  var Kinds = typeof StudentQuestionKinds !== 'undefined' ? StudentQuestionKinds : null;
  var STARRED = 'Answer the questions marked with a star first.';
  var PREVIEW_KEY = 'fv-reflect-preview';

  // The page's state and its #app: student.js's own, handed over by share.
  var S = null;
  var root = null;

  var CORE = {
    COM: { name: 'Communicating', group: 'Communication', line: 'I can share my ideas and listen to others.' },
    COL: { name: 'Collaborating', group: 'Communication', line: 'I can work with others toward a shared goal.' },
    CT: { name: 'Creative Thinking', group: 'Thinking', line: 'I can come up with new ideas and try them out.' },
    CRT: {
      name: 'Critical & Reflective Thinking',
      group: 'Thinking',
      line: 'I can ask questions, weigh evidence and think about my learning.',
    },
    PPI: {
      name: 'Personal & Cultural Identity',
      group: 'Personal & Social',
      line: 'I know what makes me who I am and what I value.',
    },
    PAR: {
      name: 'Personal Awareness & Responsibility',
      group: 'Personal & Social',
      line: 'I can set goals, manage my feelings and take care of myself.',
    },
    SAR: {
      name: 'Social Awareness & Responsibility',
      group: 'Personal & Social',
      line: 'I can be kind, include others and care for my community.',
    },
  };
  var CORE_ORDER = ['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR'];
  var GROUPS = ['Communication', 'Thinking', 'Personal & Social'];
  var STEPS = ['Beginning', 'Growing', 'Confident', 'Leading'];

  /* ── Small helpers ─────────────────────────────────────────── */

  function allQuestions(data) {
    var out = [];
    var skip = noGoalQuestions(data);
    ((data && data.parts) || []).forEach(function (p) {
      (p.questions || []).forEach(function (q) {
        if (!skip[q.id]) out.push(q);
      });
    });
    return out;
  }

  /* A Goal Check-In's part is grouped as the phone shows it: a goal status
     question and the ones after it, then a Core Competency pick and the
     ones after it. */
  function goalGroups(part) {
    var groups = [];
    var cur = null;
    (part.questions || []).forEach(function (q) {
      if (q.kind === 'goal_status' || q.kind === 'core_pick' || !cur) {
        cur = { lead: q.kind, items: [] };
        groups.push(cur);
      }
      cur.items.push(q);
    });
    return groups;
  }

  function hasCourseGoal(data) {
    var goal = data && data.context && data.context.course_goal;
    return !!(goal && String(goal.text || '').trim());
  }

  /* With no course goal written yet there is nothing to check on: the goal
     status and its next step are left out ({question id: true}). */
  function noGoalQuestions(data) {
    var out = {};
    if (!data || !data.parts || hasCourseGoal(data)) return out;
    data.parts.forEach(function (p) {
      if (p.kind !== 'goal_checkin') return;
      goalGroups(p).forEach(function (g) {
        if (g.lead !== 'goal_status') return;
        g.items.forEach(function (q) {
          out[q.id] = true;
        });
      });
    });
    return out;
  }

  /* "this class" in a ready-made prompt reads as the class's name. A
     teacher's own words (a `custom` part, and the preview, which is one)
     stay as they wrote them. */
  function promptText(q, course, part) {
    var p = q.prompt || '';
    if (part && part.kind === 'custom') return p;
    return course ? p.replace(/\bthis class\b/g, course) : p;
  }

  function isNewKind(q) {
    return !!Kinds && Kinds.isNew(q.kind);
  }

  function isAnswered(q, v) {
    if (isNewKind(q)) return Kinds.isAnswered(q, v);
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v))
      return v.some(function (x) {
        return String(x || '').trim() !== '';
      });
    if (q.kind === 'scale4') {
      if (v.level) return true;
      if (v.levels && Object.keys(v.levels).length) return true;
      var w = v.why;
      if (typeof w === 'string') return w.trim() !== '';
      return !!(
        w &&
        Object.keys(w).some(function (k) {
          return String(w[k] || '').trim() !== '';
        })
      );
    }
    return false;
  }

  // Answered in full: a likert needs every statement (s/question-kinds.js); the rest as isAnswered.
  function isComplete(q, v) {
    return isNewKind(q) ? Kinds.isComplete(q, v) : isAnswered(q, v);
  }

  /* The progress counts the questions every student answers; the private
     note to the teacher is extra, and a section heading takes no answer. */
  function countedQuestions(data) {
    return allQuestions(data).filter(function (q) {
      return !q.teacher_only && q.kind !== 'section';
    });
  }

  /* A teacher-built reflection's choice answers as the questions are now
     (s/question-kinds.js choiceKept): a draft kept before a choice was
     renamed or removed loses the old text, so what is shown, counted and
     sent agree. The ready-made reflections' choices are left as they are. */
  function tidyChoices(state) {
    if (!Kinds || !state || !state.answers) return;
    ((state.data && state.data.parts) || []).forEach(function (p) {
      if (p.kind !== 'custom') return;
      (p.questions || []).forEach(function (q) {
        if (q.kind !== 'choice' || !Object.prototype.hasOwnProperty.call(state.answers, q.id)) return;
        var v = state.answers[q.id];
        var kept = Kinds.choiceKept(q, v);
        if (JSON.stringify(kept) !== JSON.stringify(v)) state.answers[q.id] = kept;
      });
    });
  }

  function answeredCount(state) {
    tidyChoices(state);
    return countedQuestions(state.data).filter(function (q) {
      return isComplete(q, state.answers[q.id]);
    }).length;
  }

  /* The first question marked with a star that is not answered in full,
     with the part it is on, or null. */
  function firstMissing(state) {
    tidyChoices(state);
    var skip = noGoalQuestions(state.data);
    var parts = (state.data && state.data.parts) || [];
    for (var i = 0; i < parts.length; i++) {
      var qs = parts[i].questions || [];
      for (var j = 0; j < qs.length; j++) {
        var q = qs[j];
        if (skip[q.id] || q.kind === 'section' || !Kinds || !Kinds.required(q)) continue;
        if (!isComplete(q, state.answers[q.id])) return { part: i, q: q };
      }
    }
    return null;
  }

  /* The answers as submit takes them: only the answered ones. */
  function collect(state) {
    var out = {};
    tidyChoices(state);
    allQuestions(state.data).forEach(function (q) {
      var v = state.answers[q.id];
      if (isNewKind(q)) {
        var nv = Kinds.value(q, v);
        if (nv !== undefined) out[q.id] = nv;
        return;
      }
      if (!isAnswered(q, v)) return;
      if (q.kind === 'short_set') {
        out[q.id] = v.map(function (x) {
          return String(x || '').trim();
        });
      } else if (typeof v === 'string') {
        out[q.id] = v.trim();
      } else {
        out[q.id] = v;
      }
    });
    return out;
  }

  /* ── Rendering ─────────────────────────────────────────────── */

  function progressHtml(state) {
    var qs = countedQuestions(state.data);
    var done = answeredCount(state);
    var segs = qs.length <= 16 ? qs.length : 16;
    var lit = qs.length <= 16 ? done : Math.round((done / qs.length) * 16);
    var bar = '';
    for (var i = 0; i < segs; i++) bar += '<span' + (i < lit ? ' class="on"' : '') + '></span>';
    return (
      '<div class="sp-progress"><div class="sp-head-sub" id="sp-count">' +
      esc(done + ' of ' + qs.length + ' answered') +
      '</div><div class="sp-bar" aria-hidden="true">' +
      bar +
      '</div></div>'
    );
  }

  function renderConfirm(state) {
    var d = state.data;
    var first = (d.student && d.student.first_name) || '';
    var parts = slipParts(d);
    var n = parts.reduce(function (sum, p) {
      return sum + (p.count || 0);
    }, 0);
    var minutes = Math.max(2, Math.round((n * 1.4) / 5) * 5 || 5);
    return (
      header(className(d.course), 'Student Questions') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello">' +
      '<div class="sp-avatar" aria-hidden="true">' +
      esc(first.charAt(0).toUpperCase()) +
      '</div>' +
      '<h1 class="sp-big">Hi ' +
      esc(first) +
      '!</h1>' +
      '<p class="sp-lead">Is this you? Your teacher made these questions just for you.</p>' +
      '<div class="sp-will"><div class="sp-head-sub">You will answer</div><strong>' +
      esc(
        parts
          .map(function (p) {
            return p.title;
          })
          .join(' and '),
      ) +
      '</strong><div class="sp-head-sub">' +
      esc('About ' + minutes + ' minutes \u00b7 ' + n + ' question' + (n === 1 ? '' : 's')) +
      '</div></div>' +
      (d.check ? '<div class="sp-ident">' + identityFields(state) + '</div>' : '') +
      '</section>' +
      '<button type="button" class="sp-btn sp-btn-primary" data-act="start"' +
      (state.sending ? ' disabled' : '') +
      '>' +
      (state.sending ? 'Checking\u2026' : 'Yes, Start') +
      '</button>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="notme">No, That\u2019s Not Me</button>' +
      codeBox(state, 'No camera? Type the code on your slip') +
      '</main>'
    );
  }

  /* One question's controls. */
  function textArea(id, value, rows, attrs) {
    return (
      '<textarea class="sp-text" id="' +
      esc(id) +
      '" rows="' +
      (rows || 2) +
      '"' +
      (attrs || '') +
      '>' +
      esc(value || '') +
      '</textarea>'
    );
  }

  function questionBody(q, v, course) {
    var o = q.options || {};
    var id = 'q-' + q.id;
    var html = '';
    if (q.kind === 'text') {
      html +=
        '<label class="sp-q" for="' +
        id +
        '">' +
        esc(promptText(q, course)) +
        (o.optional ? ' (Optional)' : '') +
        '</label>';
      html += textArea(id, v, 2, ' data-q="' + q.id + '" data-kind="text" maxlength="2000"');
      if ((o.starters || []).length) {
        html +=
          '<div class="sp-starters"><span>Start with:</span>' +
          o.starters
            .map(function (s) {
              return (
                '<button type="button" class="sp-starter" data-act="starter" data-q="' +
                q.id +
                '" data-text="' +
                esc(s) +
                '">' +
                esc(s) +
                '</button>'
              );
            })
            .join('') +
          '</div>';
      }
      return html;
    }
    if (q.kind === 'short_set') {
      var labels = o.labels && o.labels.length ? o.labels : [''];
      var vals = Array.isArray(v) ? v : [];
      html += '<div class="sp-q" id="' + id + '">' + esc(promptText(q, course)) + '</div><div class="sp-shield">';
      labels.forEach(function (lab, i) {
        var fid = id + '-' + i;
        html +=
          '<div><label class="sp-sub-label" for="' +
          fid +
          '">' +
          esc(lab) +
          '</label><input class="sp-input" id="' +
          fid +
          '" maxlength="300" data-q="' +
          q.id +
          '" data-kind="short_set" data-i="' +
          i +
          '" value="' +
          esc(vals[i] || '') +
          '"></div>';
      });
      return html + '</div>';
    }
    if (q.kind === 'choice') {
      var picked = Array.isArray(v) ? v : [];
      var choices = (o.choices || []).slice();
      picked.forEach(function (p) {
        if (choices.indexOf(p) < 0) choices.push(p);
      });
      html += '<div class="sp-q" id="' + id + '">' + esc(promptText(q, course)) + '</div>';
      if (o.multiple === false && choices.length <= 3) {
        html +=
          '<div class="sp-seg" role="radiogroup" aria-labelledby="' +
          id +
          '" style="grid-template-columns:repeat(' +
          choices.length +
          ',minmax(0,1fr))">' +
          choices
            .map(function (c) {
              var on = picked.indexOf(c) >= 0;
              return (
                '<button type="button" role="radio" aria-checked="' +
                on +
                '" data-act="choice" data-q="' +
                q.id +
                '" data-value="' +
                esc(c) +
                '">' +
                esc(c) +
                '</button>'
              );
            })
            .join('') +
          '</div>';
        return html;
      }
      var single = o.multiple === false;
      html +=
        '<div class="sp-chips"' +
        (single ? ' role="radiogroup" aria-labelledby="' + id + '"' : ' role="group" aria-labelledby="' + id + '"') +
        '>' +
        choices
          .map(function (c) {
            var on = picked.indexOf(c) >= 0;
            return (
              '<button type="button" class="sp-chip" ' +
              (single ? 'role="radio" aria-checked="' : 'aria-pressed="') +
              on +
              '" data-act="choice" data-q="' +
              q.id +
              '" data-value="' +
              esc(c) +
              '">' +
              esc(c) +
              '</button>'
            );
          })
          .join('') +
        (o.other
          ? '<button type="button" class="sp-chip" data-act="other-open" data-q="' + q.id + '">+ Another</button>'
          : '') +
        '</div>';
      if (o.other) {
        html +=
          '<div class="sp-other" hidden data-other="' +
          q.id +
          '"><label class="sp-vh" for="' +
          id +
          '-other">Another answer</label><input class="sp-input" id="' +
          id +
          '-other" maxlength="60" placeholder="Type it here"><button type="button" class="sp-btn sp-btn-quiet sp-btn-small" data-act="other-add" data-q="' +
          q.id +
          '">Add</button></div>';
      }
      return html;
    }
    if (q.kind === 'goal_status') {
      var gs = typeof v === 'string' ? v : '';
      html += '<div class="sp-q" id="' + id + '">' + esc(promptText(q, course)) + '</div>';
      html +=
        '<div class="sp-grid2" role="radiogroup" aria-labelledby="' +
        id +
        '">' +
        (o.choices || [])
          .map(function (c) {
            return (
              '<button type="button" class="sp-opt" role="radio" aria-checked="' +
              (gs === c) +
              '" data-act="pick" data-q="' +
              q.id +
              '" data-value="' +
              esc(c) +
              '">' +
              esc(c) +
              '</button>'
            );
          })
          .join('') +
        '</div>';
      return html;
    }
    if (q.kind === 'core_pick') {
      var cp = typeof v === 'string' ? v : '';
      var allowed = q.core_ids && q.core_ids.length ? q.core_ids : CORE_ORDER;
      html +=
        '<div class="sp-q" id="' +
        id +
        '">' +
        esc(promptText(q, course)) +
        '</div><div role="radiogroup" aria-labelledby="' +
        id +
        '" class="sp-core">';
      GROUPS.forEach(function (g) {
        var ids = CORE_ORDER.filter(function (k) {
          return CORE[k].group === g && allowed.indexOf(k) >= 0;
        });
        if (!ids.length) return;
        html +=
          '<div class="sp-pick-group"><div class="sp-tag">' +
          esc(g) +
          '</div><div class="sp-chips">' +
          ids
            .map(function (k) {
              return (
                '<button type="button" class="sp-pick" role="radio" aria-checked="' +
                (cp === k) +
                '" data-act="pick" data-q="' +
                q.id +
                '" data-value="' +
                k +
                '">' +
                esc(CORE[k].name) +
                '</button>'
              );
            })
            .join('') +
          '</div></div>';
      });
      return html + '</div>';
    }
    if (q.kind === 'scale4') {
      var sv = v && typeof v === 'object' ? v : {};
      html += '<div class="sp-q">' + esc(promptText(q, course)) + '</div>';
      var cores = q.core_ids && q.core_ids.length ? q.core_ids : [null];
      cores.forEach(function (k) {
        var key = k || '_';
        var level = k ? (sv.levels || {})[k] : sv.level;
        var why = k
          ? sv.why && typeof sv.why === 'object'
            ? sv.why[k]
            : ''
          : typeof sv.why === 'string'
            ? sv.why
            : '';
        var gid = id + '-' + key;
        html += '<div class="sp-core">';
        if (k && CORE[k]) {
          html +=
            '<div class="sp-core-name" id="' +
            esc(gid) +
            '">' +
            esc(CORE[k].name) +
            '</div><div class="sp-core-line">' +
            esc(CORE[k].line) +
            '</div>';
        }
        html +=
          '<div class="sp-grid4" role="radiogroup" aria-label="' +
          esc(k && CORE[k] ? CORE[k].name : promptText(q, course)) +
          '">' +
          STEPS.map(function (s, i) {
            return (
              '<button type="button" class="sp-opt" role="radio" data-step="' +
              (i + 1) +
              '" aria-checked="' +
              (level === i + 1) +
              '" data-act="step" data-q="' +
              q.id +
              '" data-core="' +
              esc(key) +
              '" data-value="' +
              (i + 1) +
              '">' +
              s +
              '</button>'
            );
          }).join('') +
          '</div>' +
          '<label class="sp-sub-label" for="' +
          esc(gid) +
          '-why">Why? One sentence.</label>' +
          textArea(
            gid + '-why',
            why,
            2,
            ' data-q="' + q.id + '" data-kind="why" data-core="' + esc(key) + '" maxlength="1000"',
          ) +
          '</div>';
      });
      return html;
    }
    return html;
  }

  // A choice's Other is chosen: pressed, or a typed answer kept (a draft brought back).
  function otherOn(state, q, v) {
    if (state.otherOn && Object.prototype.hasOwnProperty.call(state.otherOn, q.id)) return !!state.otherOn[q.id];
    return !!(Kinds && Kinds.otherText(q, v));
  }

  function questionCard(q, v, part, course) {
    if (Kinds && Kinds.owns(q, part)) {
      return Kinds.card(q, v, { prompt: promptText(q, course, part), other: otherOn(S, q, v) });
    }
    if (q.teacher_only) {
      return (
        '<section class="sp-card sp-card-private"><div class="sp-private-tag">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7a5900" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>' +
        '<span>Only your teacher sees this</span></div>' +
        questionBody(q, v, course) +
        '</section>'
      );
    }
    var tag = '';
    if (part.kind === 'about_me' && q.repeated_key) {
      tag = (q.repeated_key === 'better_at' ? 'Your course goal \u00b7 ' : '') + 'Asked again in January and June';
    }
    return (
      '<section class="sp-card">' +
      (tag ? '<div class="sp-tag">' + esc(tag) + '</div>' : '') +
      questionBody(q, v, course) +
      '</section>'
    );
  }

  /* The Goal Check-In in two cards: the course goal (from its goal status
     question) and the Core Competency goal (from its pick). */
  function goalSections(state, part) {
    var course = state.data.course.name;
    var groups = goalGroups(part);
    return groups
      .map(function (g) {
        var html = '<section class="sp-card">';
        if (g.lead === 'goal_status' && !hasCourseGoal(state.data)) {
          // No goal to check on: say so instead of asking how it is going.
          return (
            html +
            '<h2 class="sp-h2">' +
            esc('My ' + course + ' Goal') +
            '</h2><p class="sp-note">' +
            esc('You haven’t written a ' + course + ' goal yet, so there is nothing to check on here.') +
            '</p></section>'
          );
        }
        if (g.lead === 'goal_status') {
          html += '<h2 class="sp-h2">' + esc('My ' + course + ' Goal') + '</h2>';
          var goal = state.data.context && state.data.context.course_goal;
          if (goal && goal.text) {
            html +=
              '<div class="sp-earlier"><div class="sp-tag">' +
              esc('You wrote in ' + fmtDate(goal.at, { month: 'long' })) +
              '</div><div>' +
              esc(goal.text) +
              '</div></div>';
          }
        } else if (g.lead === 'core_pick') {
          html += '<h2 class="sp-h2">My Core Competency Goal</h2>';
        }
        g.items.forEach(function (q) {
          html += questionBody(q, state.answers[q.id], course);
        });
        return html + '</section>';
      })
      .join('');
  }

  function reflectionIntro(part) {
    var scale = (part.questions || []).filter(function (q) {
      return q.kind === 'scale4' && (q.core_ids || []).length;
    })[0];
    var groups = {};
    ((scale && scale.core_ids) || []).forEach(function (k) {
      if (CORE[k]) groups[CORE[k].group] = true;
    });
    var g = Object.keys(groups);
    var kicker = [g.length === 1 ? g[0] : '', part.grade ? 'Grade ' + part.grade : ''].filter(Boolean).join(' \u00b7 ');
    return (
      '<section class="sp-card">' +
      (kicker ? '<div class="sp-kicker">' + esc(kicker) + '</div>' : '') +
      '<h1 class="sp-h1">' +
      esc(part.theme || part.title) +
      '</h1><p class="sp-note">This is about you, not your marks. Your family will see what you write here.</p></section>'
    );
  }

  function renderPart(state) {
    var d = state.data;
    var part = d.parts[state.part];
    var course = d.course.name;
    var body = '';
    tidyChoices(state);
    if (state.preview) body += '<p class="sp-preview-note" role="note">This is a preview. Nothing is sent.</p>';
    if (part.kind === 'core_reflection') body += reflectionIntro(part);
    if (part.kind === 'custom' && Kinds) body += Kinds.intro(part);
    if (part.kind === 'goal_checkin') {
      body += goalSections(state, part);
    } else {
      (part.questions || []).forEach(function (q) {
        body += questionCard(q, state.answers[q.id], part, course);
      });
    }
    var last = state.part === d.parts.length - 1;
    var next = d.parts[state.part + 1];
    var nextLabel = next ? 'Next: ' + (next.kind === 'goal_checkin' ? 'My Goals' : next.title) : '';
    var title = part.kind === 'goal_checkin' && state.part > 0 ? d.parts[0].title : part.title;
    return (
      header(title, course, progressHtml(state)) +
      '<main class="sp-main">' +
      body +
      '</main>' +
      '<footer class="sp-foot">' +
      (state.message ? '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>' : '') +
      '<div class="sp-foot-row' +
      (state.preview && state.part === 0 ? ' sp-foot-one' : '') +
      '">' +
      // A preview's first part has nowhere to go back to.
      (state.preview && state.part === 0
        ? ''
        : '<button type="button" class="sp-btn sp-btn-quiet" data-act="back">Back</button>') +
      (last
        ? '<button type="button" class="sp-btn sp-btn-primary" data-act="send"' +
          (state.sending ? ' disabled' : '') +
          '>' +
          (state.sending ? 'Sending\u2026' : 'Send to My Teacher') +
          '</button>'
        : '<button type="button" class="sp-btn sp-btn-primary" data-act="next">' + esc(nextLabel) + '</button>') +
      '</div></footer>'
    );
  }

  function renderSent(state) {
    var d = state.data;
    var first = (d.student && d.student.first_name) || '';
    var reflection = d.parts.some(function (p) {
      return p.kind === 'core_reflection';
    });
    return (
      header(d.parts[0].title, d.course.name) +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      '<section class="sp-card sp-hello"><div class="sp-avatar sp-avatar-done" aria-hidden="true">' +
      '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#166534" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"></path></svg></div>' +
      '<h1 class="sp-big">Sent to Your Teacher</h1>' +
      '<p class="sp-lead">' +
      esc('Thanks' + (first ? ', ' + first : '') + '. You can close this page now.') +
      '</p>' +
      (reflection
        ? '<p class="sp-note">Talk with your family about what you wrote. It will be part of your report.</p>'
        : '') +
      (state.preview
        ? '<p class="sp-note">This is a preview. Nothing was sent.</p>'
        : state.demo
          ? '<p class="sp-note">This was Demo Mode. Nothing was sent.</p>'
          : '') +
      (state.back
        ? '<button type="button" class="sp-btn sp-btn-primary" data-act="page-back">Back to Your Page</button>'
        : '') +
      '</section></main>'
    );
  }

  /* ── Answers ───────────────────────────────────────────────── */

  function setAnswer(state, q, el) {
    var id = q.id;
    var kind = el.dataset.kind;
    if (kind === 'text') {
      state.answers[id] = el.value;
    } else if (kind === 'short_set') {
      var arr = Array.isArray(state.answers[id]) ? state.answers[id].slice() : [];
      var n = ((q.options || {}).labels || ['']).length;
      while (arr.length < n) arr.push('');
      arr[Number(el.dataset.i)] = el.value;
      state.answers[id] = arr;
    } else if (kind === 'date') {
      state.answers[id] = el.value;
    } else if (kind === 'other') {
      setOther(state, q, el.value);
    } else if (kind === 'select') {
      var v = el.value;
      var ons = state.otherOn || (state.otherOn = {});
      if (v === Kinds.OTHER) {
        ons[id] = true;
        state.answers[id] = [];
      } else {
        ons[id] = false;
        state.answers[id] = v ? [v] : [];
      }
    } else if (kind === 'why') {
      var cur = Object.assign({}, state.answers[id] || {});
      if (el.dataset.core === '_') cur.why = el.value;
      else
        cur.why = Object.assign({}, typeof cur.why === 'object' && cur.why ? cur.why : {}, {
          [el.dataset.core]: el.value,
        });
      state.answers[id] = cur;
    }
  }

  function toggleChoice(state, q, value) {
    var single = (q.options || {}).multiple === false;
    var cur = Array.isArray(state.answers[q.id]) ? state.answers[q.id].slice() : [];
    var at = cur.indexOf(value);
    if (single) cur = at >= 0 ? [] : [value];
    else if (at >= 0) cur.splice(at, 1);
    else cur.push(value);
    state.answers[q.id] = cur;
  }

  /* A teacher-built reflection's choice pressed. One answer: that one, or
     none when pressed again (Other goes). Many: it joins or leaves, the
     typed Other kept. */
  function pickChoice(state, q, value) {
    var single = (q.options || {}).multiple === false;
    var list = Kinds.choicesOf(q);
    var cur = Array.isArray(state.answers[q.id]) ? state.answers[q.id].slice() : [];
    if (single) {
      (state.otherOn || (state.otherOn = {}))[q.id] = false;
      state.answers[q.id] = cur.indexOf(value) >= 0 ? [] : [value];
      return;
    }
    var at = cur.indexOf(value);
    if (at >= 0) cur.splice(at, 1);
    else if (list.indexOf(value) >= 0) cur.push(value);
    state.answers[q.id] = cur;
  }

  // Other pressed: chosen (one answer: the choices go) or not (the typed answer goes).
  function toggleOther(state, q) {
    var ons = state.otherOn || (state.otherOn = {});
    var on = !otherOn(state, q, state.answers[q.id]);
    ons[q.id] = on;
    var single = (q.options || {}).multiple === false;
    var list = Kinds.choicesOf(q);
    var cur = Array.isArray(state.answers[q.id]) ? state.answers[q.id] : [];
    state.answers[q.id] =
      on && single
        ? []
        : cur.filter(function (x) {
            return list.indexOf(x) >= 0;
          });
    return on;
  }

  /* The typed Other, up to 60, in place of any typed before; nothing typed,
     nothing kept. Typed the same as a listed choice (any case), it is that
     choice picked and Other goes off. */
  function setOther(state, q, text) {
    var list = Kinds.choicesOf(q);
    var single = (q.options || {}).multiple === false;
    var cur = (Array.isArray(state.answers[q.id]) ? state.answers[q.id] : []).filter(function (x) {
      return !single && list.indexOf(x) >= 0;
    });
    var t = String(text || '')
      .trim()
      .slice(0, 60);
    var hit = Kinds.listedChoice(q, t);
    var ons = state.otherOn || (state.otherOn = {});
    if (hit) {
      if (cur.indexOf(hit) < 0) cur.push(hit);
      ons[q.id] = false;
    } else {
      if (t) cur.push(t);
      ons[q.id] = true;
    }
    state.answers[q.id] = cur;
  }

  // A rating pressed: that number, or none when pressed again.
  function setRating(state, q, n) {
    if (state.answers[q.id] === n) delete state.answers[q.id];
    else state.answers[q.id] = n;
  }

  // A likert statement's column pressed: that one, or none when pressed again.
  function setLikert(state, q, si, choice) {
    var s = Kinds.statementsOf(q)[si];
    if (s == null) return;
    var cur = Object.assign(
      {},
      state.answers[q.id] && typeof state.answers[q.id] === 'object' ? state.answers[q.id] : {},
    );
    if (cur[s] === choice) delete cur[s];
    else cur[s] = choice;
    state.answers[q.id] = cur;
  }

  // A ranking's row moved one place up (-1) or down (+1); from then on it is the student's order.
  function moveRank(state, q, i, dir) {
    var order = Kinds.rankOrder(q, state.answers[q.id]);
    var j = i + dir;
    if (i < 0 || i >= order.length || j < 0 || j >= order.length) return -1;
    var t = order[i];
    order[i] = order[j];
    order[j] = t;
    state.answers[q.id] = order;
    return j;
  }

  function setStep(state, q, core, step) {
    var cur = Object.assign({}, state.answers[q.id] || {});
    if (core === '_') cur.level = cur.level === step ? undefined : step;
    else {
      var lv = Object.assign({}, cur.levels || {});
      if (lv[core] === step) delete lv[core];
      else lv[core] = step;
      cur.levels = lv;
    }
    state.answers[q.id] = cur;
  }

  /* ── Flow ──────────────────────────────────────────────────── */

  function send() {
    if (S.sending) return Promise.resolve();
    // A question marked with a star and not answered: say so, and go to it.
    var miss = firstMissing(S);
    if (miss) {
      S.message = STARRED;
      S.part = miss.part;
      paint();
      focusQuestion(miss.q);
      return Promise.resolve();
    }
    var answers = collect(S);
    if (!Object.keys(answers).length) {
      S.message = MESSAGES.empty;
      paint();
      return Promise.resolve();
    }
    if (S.demo) {
      S.screen = 'sent';
      S.message = '';
      paint();
      return Promise.resolve();
    }
    if (S.cardForm) return sendFromCard(answers);
    return Promise.resolve();
  }

  /* Opened from a real card's page (S4-F4): `answer` through the card's
     session (app.js's askClass), once. There is no token to renew, so no
     second try: a refusal says why and the answers stay on screen.
     Answered already (`already_sent`) is as good as sent. */
  function sendFromCard(answers) {
    var state = S;
    var form = S.cardForm;
    S.sending = true;
    S.message = '';
    paint();
    var body = { questionnaire_id: form.id, answers: answers };
    return StudentPage.askClass('answer', body, form.student).then(function (res) {
      if (S !== state || S.cardForm !== form || S.screen !== 'part') return;
      S.sending = false;
      if ((res && res.ok === true) || (res && res.error === 'already_sent')) {
        clearDraft();
        S.screen = 'sent';
        S.message = '';
        paint();
        StudentPage.formSent(form, res);
        return;
      }
      if (StudentPage.formSessionOver('answer', res)) return StudentPage.sessionRefused(res);
      S.message = StudentPage.formMessage('answer', res && res.ok === false ? res : { ok: false, error: 'network' });
      paint();
    });
  }

  function questionById(id) {
    return (
      allQuestions(S.data).find(function (q) {
        return q.id === id;
      }) || null
    );
  }

  /* Every starred question answered now: "Answer the questions marked
     with a star first." has done its job and goes. */
  function starsDone() {
    if (!S || S.message !== STARRED || firstMissing(S)) return;
    S.message = '';
    var m = root && root.querySelector('.sp-foot .sp-msg');
    if (m) m.remove();
  }
  // An answer changed by a press: the star message checked, the draft kept.
  function kept() {
    starsDone();
    saveDraft();
  }

  function updateCount() {
    starsDone();
    var box = root && root.querySelector('.sp-progress');
    if (!box) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = progressHtml(S);
    box.replaceWith(tmp.firstChild);
  }

  function onClick(act, el) {
    var q = el.dataset.q ? questionById(el.dataset.q) : null;
    if (act === 'start' && S.data && S.data.check) {
      verifyIdentity();
    } else if (act === 'start') {
      S.screen = 'part';
      S.part = 0;
      paint();
      window.scrollTo(0, 0);
    } else if (act === 'next') {
      S.part = Math.min(S.part + 1, S.data.parts.length - 1);
      S.message = '';
      saveDraft();
      paint();
      window.scrollTo(0, 0);
    } else if (act === 'back') {
      S.message = '';
      if (S.part > 0) S.part -= 1;
      // Opened from a card's page (S4-F4): the first part's Back goes back to that page, the draft kept first.
      else if (S.back && StudentPage.pageBack) {
        saveDraft();
        return StudentPage.pageBack();
      } else S.screen = 'confirm';
      saveDraft();
      paint();
      window.scrollTo(0, 0);
    } else if (act === 'send') {
      send();
    } else if (act === 'choice' && q) {
      toggleChoice(S, q, el.dataset.value);
      saveDraft();
      paint('[data-act="choice"][data-q="' + q.id + '"][data-value="' + cssEsc(el.dataset.value) + '"]');
    } else if (act === 'pick' && q) {
      S.answers[q.id] = S.answers[q.id] === el.dataset.value ? '' : el.dataset.value;
      saveDraft();
      paint('[data-act="pick"][data-q="' + q.id + '"][data-value="' + cssEsc(el.dataset.value) + '"]');
    } else if (act === 'step' && q) {
      setStep(S, q, el.dataset.core, Number(el.dataset.value));
      saveDraft();
      paint(
        '[data-act="step"][data-q="' +
          q.id +
          '"][data-core="' +
          el.dataset.core +
          '"][data-value="' +
          el.dataset.value +
          '"]',
      );
    } else if (act === 'starter' && q) {
      var box = root.querySelector('#q-' + q.id);
      var cur = (S.answers[q.id] || '').replace(/\s+$/, '');
      var add = el.dataset.text.replace(/\u2026$/, '').trim() + ' ';
      S.answers[q.id] = cur ? cur + '\n' + add : add;
      if (box) {
        box.value = S.answers[q.id];
        grow(box);
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }
      saveDraft();
      updateCount();
    } else if (act === 'other-open' && q) {
      var row = root.querySelector('[data-other="' + q.id + '"]');
      if (row) {
        row.hidden = false;
        row.querySelector('input').focus();
      }
    } else if (act === 'other-add' && q) {
      var input = root.querySelector('#q-' + q.id + '-other');
      var val = input ? input.value.trim().slice(0, 60) : '';
      if (val) {
        var list = Array.isArray(S.answers[q.id]) ? S.answers[q.id].slice() : [];
        if (list.indexOf(val) < 0) list.push(val);
        S.answers[q.id] = list;
        saveDraft();
        paint('[data-act="other-open"][data-q="' + q.id + '"]');
      }
    } else if (act === 'kc-pick' && q && Kinds) {
      pickChoice(S, q, el.dataset.value);
      kept();
      paint('[data-act="kc-pick"][data-q="' + cssEsc(q.id) + '"][data-value="' + cssEsc(el.dataset.value) + '"]');
    } else if (act === 'kc-other' && q && Kinds) {
      var on = toggleOther(S, q);
      kept();
      paint(on ? '#q-' + cssId(q.id) + '-other' : '[data-act="kc-other"][data-q="' + cssEsc(q.id) + '"]');
    } else if (act === 'rate' && q && Kinds) {
      setRating(S, q, Number(el.dataset.value));
      kept();
      paint('[data-act="rate"][data-q="' + cssEsc(q.id) + '"][data-value="' + Number(el.dataset.value) + '"]');
    } else if (act === 'likert' && q && Kinds) {
      setLikert(S, q, Number(el.dataset.s), el.dataset.value);
      kept();
      paint(
        '[data-act="likert"][data-q="' +
          cssEsc(q.id) +
          '"][data-s="' +
          Number(el.dataset.s) +
          '"][data-value="' +
          cssEsc(el.dataset.value) +
          '"]',
      );
    } else if ((act === 'rank-up' || act === 'rank-down') && q && Kinds) {
      var dir = act === 'rank-up' ? -1 : 1;
      var before = rankTops(q);
      var to = moveRank(S, q, Number(el.dataset.i), dir);
      if (to < 0) return;
      kept();
      paint();
      glide(q, before);
      // The focus stays on the row moved: the same arrow, or the other one at either end.
      var sel = '[data-q="' + cssEsc(q.id) + '"][data-i="' + to + '"]';
      var btn = root.querySelector('[data-act="' + act + '"]' + sel) || root.querySelector('.sp-rq-move' + sel);
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  // An id as a CSS selector part (ids are uuids, or the builder's own: letters, digits, - and _).
  function cssId(id) {
    return String(id).replace(/[^\w-]/g, '\\$&');
  }

  /* Each row of a ranking glides from where it was to its new place
     (about 200 ms); nothing fades. Read before the page is drawn again. */
  function rankTops(q) {
    var out = {};
    var list = root && root.querySelector('[data-rank-q="' + cssEsc(q.id) + '"]');
    if (!list || typeof list.querySelectorAll !== 'function') return out;
    list.querySelectorAll('li[data-rank]').forEach(function (li) {
      if (typeof li.getBoundingClientRect === 'function')
        out[li.getAttribute('data-rank')] = li.getBoundingClientRect().top;
    });
    return out;
  }
  function glide(q, before) {
    var still =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var list = root && root.querySelector('[data-rank-q="' + cssEsc(q.id) + '"]');
    if (still || !list) return;
    var moved = [];
    list.querySelectorAll('li[data-rank]').forEach(function (li) {
      var was = before[li.getAttribute('data-rank')];
      if (was == null || typeof li.getBoundingClientRect !== 'function') return;
      var now = li.getBoundingClientRect();
      /* The screen's pixels to the row's own: at a Text Size the page is
         zoomed, and a transform is drawn at the zoom (1 when not zoomed). */
      var scale = li.offsetHeight > 0 && now.height > 0 ? now.height / li.offsetHeight : 1;
      var dy = (was - now.top) / scale;
      if (!dy) return;
      li.style.transition = 'none';
      li.style.transform = 'translateY(' + dy + 'px)';
      moved.push(li);
    });
    if (!moved.length) return;
    void list.offsetHeight; // the old places drawn first
    moved.forEach(function (li) {
      li.style.transition = 'transform 200ms ease-out';
      li.style.transform = '';
    });
  }

  /* The focus on a question: its first box, the chosen choice or the
     first, or its first button. */
  function focusQuestion(q) {
    var box = root && root.querySelector('[data-qbox="' + cssEsc(q.id) + '"]');
    if (!box) return;
    var el =
      box.querySelector('input, textarea, select') ||
      box.querySelector('[role="radio"][tabindex="0"]') ||
      box.querySelector('button');
    if (el && el.focus) el.focus({ preventScroll: false });
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function onInput(el) {
    if (!el.dataset || !el.dataset.q) return;
    var q = questionById(el.dataset.q);
    if (!q) return;
    // A menu is read when its choice is made (onChange): choosing Other opens its box.
    if (el.dataset.kind === 'select') return;
    setAnswer(S, q, el);
    if (el.tagName === 'TEXTAREA') grow(el);
    // Kept once the student pauses (student.js): not every key turns every answer into text.
    (StudentPage.saveDraftSoon || saveDraft)();
    updateCount();
  }

  // A menu chosen, or a date picked (a date also says so as it is typed: onInput).
  function onChange(el) {
    if (!el.dataset || !el.dataset.q || !S || S.screen !== 'part') return;
    var q = questionById(el.dataset.q);
    if (!q || !Kinds) return;
    if (el.dataset.kind === 'date') return onInput(el);
    if (el.dataset.kind !== 'select') return;
    var was = otherOn(S, q, S.answers[q.id]);
    setAnswer(S, q, el);
    kept();
    var now = otherOn(S, q, S.answers[q.id]);
    if (was !== now) paint(now ? '#q-' + cssId(q.id) + '-other' : '#q-' + cssId(q.id));
    else updateCount();
  }

  /* ── Preview as a Student (docs/plans/reflect-plan.md) ─────── */

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  /* The teacher's builder leaves its draft under PREVIEW_KEY and opens
     #preview-reflection. It is read once and removed. A reflection in the
     shape the `form` route gives, or null for nothing to preview. */
  function readPreview() {
    var d = null;
    try {
      var raw = localStorage.getItem(PREVIEW_KEY);
      localStorage.removeItem(PREVIEW_KEY);
      d = JSON.parse(raw || 'null');
    } catch (e) {
      d = null;
    }
    if (!d || typeof d !== 'object' || !Array.isArray(d.questions)) return null;
    var seen = {};
    var questions = d.questions
      .filter(function (q) {
        return q && typeof q === 'object' && str(q.kind) && str(q.prompt).trim();
      })
      .map(function (q, i) {
        var id = String(q.id == null ? '' : q.id).replace(/[^\w-]/g, '');
        if (!id || seen[id]) id = 'preview-' + (i + 1);
        seen[id] = true;
        return {
          id: id,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options && typeof q.options === 'object' ? q.options : {},
          core_ids: [],
          teacher_only: false,
        };
      });
    return {
      ok: true,
      token: 'preview',
      student: { first_name: '' },
      course: { name: str(d.course && d.course.name) || 'Your Class' },
      parts: [
        {
          id: 'preview',
          kind: 'custom',
          title: str(d.title).trim() || 'Untitled Reflection',
          theme: str(d.description),
          questions: questions,
        },
      ],
      context: {},
    };
  }

  function renderPreviewNone() {
    return (
      header('Preview', 'FullVision') +
      '<main class="sp-main sp-main-center"><section class="sp-card sp-hello">' +
      '<h1 class="sp-big">Nothing to Preview</h1>' +
      '<p class="sp-lead" role="alert">There is nothing to preview. Open Preview as a Student from the reflection you are building.</p>' +
      '</section></main>'
    );
  }

  // #preview-reflection: the draft on the answering screens, nothing asked and nothing sent.
  function startPreview(hash) {
    if (!/^preview-reflection$/i.test(hash || '')) return false;
    S.demo = true;
    S.preview = true;
    S.data = readPreview();
    S.part = 0;
    S.answers = {};
    S.otherOn = {};
    S.screen = S.data ? 'part' : 'previewnone';
    if (typeof document !== 'undefined') document.title = 'Preview — FullVision';
    paint(S.data ? 'h1' : null);
    return true;
  }

  /* ── Demo Mode's reflections ───────────────────────────────── */

  var DEMO_CUSTOM_ID = 'demo-q-unit2';
  var UNIT2 = {
    title: 'Unit 2 Exit Reflection',
    description: 'A few questions about how the unit went. About 5 minutes.',
  };

  /* Reflect's list (app.js's demoForms): the ready-made November
     Reflection, the teacher-built Unit 2 Exit Reflection, About Me sent,
     March coming up. `isoDay(offset)` is the device's day, offset. */
  function demoFormList(isoDay) {
    return {
      questionnaires: [
        {
          id: 'demo-q-reflection',
          title: 'November Reflection',
          description: 'Core Competencies and your goal check-in',
          minutes: 10,
          state: 'open',
          closes_on: isoDay(9),
        },
        { id: DEMO_CUSTOM_ID, title: UNIT2.title, description: UNIT2.description, state: 'open' },
        { id: 'demo-q-about', title: 'About Me', state: 'sent', sent_at: isoDay(-58) + 'T20:15:00Z' },
        { id: 'demo-q-march', title: 'March Reflection', state: 'not_open_yet', opens_on: isoDay(112) },
      ],
    };
  }

  // Which sample Start opens (student.js's demoData).
  function demoFormKind(id) {
    return id === DEMO_CUSTOM_ID ? 'custom' : 'reflection';
  }

  /* The teacher-built sample, as the `form` route gives it: board 5's five
     questions, then a Section Heading and a Date, so every new kind can be
     tried. */
  function demoCustom() {
    var q = function (n, kind, prompt, options) {
      return { id: 'demo-unit2-' + n, kind: kind, prompt: prompt, options: options, core_ids: [], teacher_only: false };
    };
    return {
      ok: true,
      token: 'demo',
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      parts: [
        {
          id: 'demo-unit2',
          kind: 'custom',
          title: UNIT2.title,
          theme: UNIT2.description,
          closes_on: null,
          grade: null,
          questions: [
            q(1, 'text', 'What is one thing you understand better after this unit?', { required: true }),
            q(2, 'rating', 'How confident are you balancing chemical equations?', {
              required: true,
              levels: 5,
              low: 'Not Yet',
              high: 'Could Teach It',
            }),
            q(3, 'choice', 'Which helped you learn the most?', {
              required: true,
              choices: ['Labs', 'Notes', 'Practice Questions', 'Group Work'],
              multiple: false,
              other: true,
            }),
            q(4, 'likert', 'How often did you do each of these?', {
              statements: [
                'I asked questions when I was stuck',
                'I checked my work before handing it in',
                'I helped someone in my group',
              ],
              choices: ['Never', 'Sometimes', 'Usually', 'Always'],
            }),
            q(5, 'ranking', 'Put these in order, from most to least helpful.', {
              choices: ['Labs', 'Notes', 'Practice Questions'],
            }),
            q(6, 'section', 'Before You Go', { subtitle: 'One last question about your lab report.' }),
            q(7, 'date', 'When will you finish your lab report?', { subtitle: 'Pick the day you plan to hand it in.' }),
          ],
        },
      ],
      context: {},
    };
  }

  StudentPage.demoFormList = demoFormList;
  StudentPage.demoFormKind = demoFormKind;
  StudentPage.demoCustom = demoCustom;

  StudentPage.addScreens({
    file: 'questionnaire',
    render: { confirm: renderConfirm, part: renderPart, sent: renderSent, previewnone: renderPreviewNone },
    click: onClick,
    input: onInput,
    change: onChange,
    start: startPreview,
    share: function (state, el) {
      S = state;
      root = el;
    },
    test: {
      collect: collect,
      isAnswered: isAnswered,
      answeredCount: answeredCount,
      setAnswer: setAnswer,
      toggleChoice: toggleChoice,
      setStep: setStep,
      isComplete: isComplete,
      firstMissing: firstMissing,
      pickChoice: pickChoice,
      toggleOther: toggleOther,
      setOther: setOther,
      setRating: setRating,
      setLikert: setLikert,
      moveRank: moveRank,
      readPreview: readPreview,
      demoCustom: demoCustom,
      PREVIEW_KEY: PREVIEW_KEY,
    },
  });
})();
