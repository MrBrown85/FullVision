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
  var call = StudentPage.call;
  var messageFor = StudentPage.messageFor;
  var saveDraft = StudentPage.saveDraft;
  var clearDraft = StudentPage.clearDraft;
  var paint = StudentPage.paint;
  var grow = StudentPage.grow;

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

  /* "this class" in a template prompt reads as the class's name. */
  function promptText(q, course) {
    var p = q.prompt || '';
    return course ? p.replace(/\bthis class\b/g, course) : p;
  }

  function isAnswered(q, v) {
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

  /* The progress counts the questions every student answers; the private
     note to the teacher is extra. */
  function countedQuestions(data) {
    return allQuestions(data).filter(function (q) {
      return !q.teacher_only;
    });
  }

  function answeredCount(state) {
    return countedQuestions(state.data).filter(function (q) {
      return isAnswered(q, state.answers[q.id]);
    }).length;
  }

  /* The answers as submit takes them: only the answered ones. */
  function collect(state) {
    var out = {};
    allQuestions(state.data).forEach(function (q) {
      var v = state.answers[q.id];
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

  function questionCard(q, v, part, course) {
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
    if (part.kind === 'core_reflection') body += reflectionIntro(part);
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
      '<div class="sp-foot-row">' +
      '<button type="button" class="sp-btn sp-btn-quiet" data-act="back">Back</button>' +
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
      (state.demo ? '<p class="sp-note">This was Demo Mode. Nothing was sent.</p>' : '') +
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
    S.sending = true;
    S.message = '';
    paint();
    function attempt(retried) {
      return call({ route: 'submit', token: S.data.token, answers: answers }).then(function (res) {
        if (res && res.ok) return res;
        // The 80-minute token (a class block) ran out while they wrote: open again for a
        // fresh one (the code is still unused) and send once more.
        if (res && res.error === 'expired' && !retried) {
          return call({ route: 'open', code: S.code }).then(function (again) {
            if (!again || !again.ok) return again;
            S.data.token = again.token;
            // A slip that asks who you are asks again on the new session.
            if (again.check && S.ident) {
              return call(Object.assign({ route: 'verify', token: again.token }, S.ident)).then(function (ok) {
                return ok && ok.ok ? attempt(true) : ok;
              });
            }
            return attempt(true);
          });
        }
        return res;
      });
    }
    return attempt(false).then(function (res) {
      S.sending = false;
      if (res && res.ok) {
        clearDraft();
        S.screen = 'sent';
        S.message = '';
        try {
          history.replaceState(null, '', location.pathname);
        } catch (e) {
          /* the code stays in the address; it no longer works */
        }
      } else {
        S.message = messageFor(res);
      }
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

  function updateCount() {
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
      // Opened from a card's page (S4-F4): the first part's Back goes back to that page.
      else if (S.back && StudentPage.pageBack) return StudentPage.pageBack();
      else S.screen = 'confirm';
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
    }
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function onInput(el) {
    if (!el.dataset || !el.dataset.q) return;
    var q = questionById(el.dataset.q);
    if (!q) return;
    setAnswer(S, q, el);
    if (el.tagName === 'TEXTAREA') grow(el);
    saveDraft();
    updateCount();
  }

  StudentPage.addScreens({
    file: 'questionnaire',
    render: { confirm: renderConfirm, part: renderPart, sent: renderSent },
    click: onClick,
    input: onInput,
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
    },
  });
})();
