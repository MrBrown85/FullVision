/* The student phone page (docs/STUDENT-VOICE-PLAN.md, PR 7; canvas screens
   1–5). A student scans their slip (fullvision.ca/s/#K7M-4QX) or types the
   code, checks it's them, answers one page per part (the questionnaire,
   then its Goal Check-In), and sends.

   It talks only to the student-submit edge function, pinned to
   ca-central-1, with no key: the slip's code is the credential. The code
   sits after # so it never reaches a server log. Answers in progress stay
   in this tab's sessionStorage and are cleared once sent.

   Demo Mode (#demo for the November Reflection, #demo-about for About Me)
   builds the same screens from shared/questionnaire-templates.js and never
   calls the function.

   The render functions are pure (state in, HTML out) and exposed as
   StudentPage._test for tests. */
var StudentPage = (function () {
  'use strict';

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
  var CODE_RE = /^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$/;

  var MESSAGES = {
    not_found:
      "That code didn't work. Check the letters and numbers on your slip. If you have a newer slip, use that one. If not, ask your teacher for a new slip.",
    used: 'This slip has already been used. Ask your teacher for a new slip if you need to change something.',
    closed: 'These questions are closed now. Ask your teacher if you still need to answer.',
    not_open_yet: 'These questions are not open yet.',
    locked: 'Too many tries. Wait 15 minutes and try again.',
    busy: 'FullVision is busy right now. Wait a minute and try again.',
    invalid: "Part of your answer couldn't be saved. Check your answers and try again.",
    empty: 'Answer at least one question before you send.',
    network: "Couldn't reach FullVision. Check your internet and try again. Your answers are still here.",
    report_closed: 'This report link has closed. Your official report card is in MyEd.',
    no_birthday: "Your teacher hasn't added your birthday yet, so this report can't open. Ask your teacher.",
    wrong_birthday: "That birthday doesn't match. Check the month, day and year.",
    wrong_identity: "That doesn't match. Check your birthday or student number.",
    wrong_password: "That password doesn't match. Check the password on your slip.",
    slip_locked: 'This slip is locked after too many wrong tries. Ask your teacher for a new slip.',
    reprint: 'This slip needs to be printed again. Ask your teacher for a new slip.',
  };
  var MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  var S = null;

  function freshState() {
    return {
      screen: 'start', // start | loading | confirm | notme | part | sent; reports: rcheck | report
      code: '',
      typed: '',
      data: null, // {token, student, course, parts, context}
      part: 0,
      answers: {},
      message: '',
      sending: false,
      demo: false,
      ident: null, // what matched on a questionnaire slip, kept to open again if the session runs out
      number: '', // the student number or slip password as typed
      bday: { m: '', d: '', y: '' }, // the pickers as chosen
      report: null, // the report as the teacher sent it
    };
  }

  /* ── Small helpers ─────────────────────────────────────────── */

  function cleanCode(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /* "Science 8 · Block B", as the class list shows it. */
  function className(course) {
    var name = (course && course.name) || '';
    var b = String((course && course.block) || '').trim();
    if (!b) return name;
    var label = /^[A-Za-z0-9]{1,2}$/.test(b) ? 'Block ' + b.toUpperCase() : b;
    return name.toLowerCase().indexOf(label.toLowerCase()) >= 0 ? name : name + ' \u00b7 ' + label;
  }

  function prettyCode(c) {
    return c.length === 6 ? c.slice(0, 3) + '-' + c.slice(3) : c;
  }

  function fmtDate(iso, opts) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', opts || { month: 'long', day: 'numeric' });
  }

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

  function header(title, sub, progress) {
    return (
      '<header class="sp-head"><div class="sp-head-row"><div class="sp-head-title">' +
      esc(title) +
      '</div>' +
      (progress ? '<div class="sp-head-sub">' + esc(sub) + '</div>' : '') +
      '</div>' +
      (progress ? progress : '<div class="sp-head-sub">' + esc(sub) + '</div>') +
      '</header>'
    );
  }

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

  function codeBox(state, label, top) {
    return (
      '<form class="sp-code-box' +
      (top ? ' sp-code-box-top' : '') +
      '" data-form="code" novalidate>' +
      '<label for="sp-code">' +
      esc(label) +
      '</label><div class="sp-code-row">' +
      '<input id="sp-code" class="sp-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" value="' +
      esc(state.typed) +
      '"><button type="submit" class="sp-btn sp-btn-quiet sp-btn-small">Open</button></div>' +
      (state.message && (state.screen === 'start' || (state.screen === 'confirm' && !(state.data && state.data.check)))
        ? '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>'
        : '') +
      '</form>'
    );
  }

  function renderStart(state) {
    return (
      header('Student Questions', 'FullVision') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><h1 class="sp-big">Answer Your Teacher\u2019s Questions</h1>' +
      '<p class="sp-lead">Scan the QR code on your slip with your phone camera, or type the code below.</p></section>' +
      codeBox(state, 'Type the code on your slip', true) +
      '</main>'
    );
  }

  // The desktop's loading screen with lines for students
  // (shared/loading-screen.js); paint() starts the lines turning.
  function renderLoading() {
    var body = window.FVLoading
      ? window.FVLoading.html('student', 'Opening your page', true)
      : '<p class="sp-lead sp-msg-calm" role="status">Opening your page\u2026</p>';
    return (
      header('Student Questions', 'FullVision') +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      body +
      '</main>'
    );
  }

  function partCount(p) {
    return (p.questions || []).filter(function (q) {
      return !q.teacher_only;
    }).length;
  }

  /* Before the check the slip shows only what the questions are called and
     how many there are (open's preview); after it, the questions. */
  function slipParts(d) {
    if (d.parts) {
      return d.parts.map(function (p) {
        return { title: p.title, count: partCount(p) };
      });
    }
    return d.preview || [];
  }

  /* Who are you? A birthday or student number, or the slip's password. */
  function identityFields(state) {
    var by = state.data.check;
    var msg = state.message ? '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>' : '';
    if (by === 'password') {
      return (
        '<p class="sp-lead">To make sure it\u2019s you, type the password printed on your slip.</p>' +
        '<label class="sp-sub-label" for="sp-ident">Password</label>' +
        '<input id="sp-ident" class="sp-input" inputmode="numeric" autocomplete="off" maxlength="16" value="' +
        esc(state.number) +
        '">' +
        msg
      );
    }
    // A password printed before the teacher added a birthday or number still
    // works: the same box takes it.
    var pw = !!state.data.also_password;
    return (
      '<p class="sp-lead">To make sure it\u2019s you, enter your birthday or your student number' +
      (pw ? ', or the password on your slip' : '') +
      '.</p>' +
      birthdayPickers(state) +
      '<div class="sp-or" aria-hidden="true">or</div>' +
      '<label class="sp-sub-label" for="sp-ident">' +
      (pw ? 'Student Number or Password' : 'Student Number') +
      '</label>' +
      '<input id="sp-ident" class="sp-input" inputmode="numeric" autocomplete="off" maxlength="32" value="' +
      esc(state.number) +
      '">' +
      msg
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

  function renderNotMe(state) {
    return (
      header('Student Questions', (state.data && state.data.course.name) || 'FullVision') +
      '<main class="sp-main sp-main-center sp-main-middle">' +
      '<section class="sp-card sp-hello"><h1 class="sp-big">Give This Slip Back</h1>' +
      '<p class="sp-lead">This slip is for someone else. Give it back to your teacher and ask for your own.</p></section>' +
      '<button type="button" class="sp-btn sp-btn-line" data-act="restart">Type a Different Code</button>' +
      '</main>'
    );
  }

  function renderMessage(state) {
    return (
      header('Student Questions', 'FullVision') +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><p class="sp-lead" role="alert">' +
      esc(state.message) +
      '</p></section>' +
      codeBox(Object.assign({}, state, { message: '' }), 'Type the code on your slip', true) +
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
      '</section></main>'
    );
  }

  /* ── Phone reports (canvas R1–R4) ──────────────────────────── */

  function reportSub(d) {
    return d.report && d.report.title ? d.report.title : 'Report';
  }

  function birthdayPickers(state) {
    var b = state.bday || {};
    var now = new Date().getFullYear();
    var years = [];
    for (var y = now - 5; y >= now - 25; y--) years.push(y);
    var opt = function (v, label, cur) {
      return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>';
    };
    var sel = function (id, label, opts) {
      return (
        '<div class="sp-bday-f"><label class="sp-sub-label" for="' +
        id +
        '">' +
        label +
        '</label><select class="sp-input sp-select" id="' +
        id +
        '"><option value=""></option>' +
        opts +
        '</select></div>'
      );
    };
    var days = '';
    for (var d = 1; d <= 31; d++) days += opt(d, d, b.d);
    return (
      '<div class="sp-bday">' +
      sel(
        'sp-bm',
        'Month',
        MONTHS.map(function (m, i) {
          return opt(i + 1, m, b.m);
        }).join(''),
      ) +
      sel('sp-bd', 'Day', days) +
      sel(
        'sp-by',
        'Year',
        years
          .map(function (y) {
            return opt(y, y, b.y);
          })
          .join(''),
      ) +
      '</div>'
    );
  }

  function renderRCheck(state) {
    var d = state.data;
    var first = (d.student && d.student.first_name) || '';
    var until = d.report && d.report.expires_on ? fmtDate(d.report.expires_on, { month: 'short', day: 'numeric' }) : '';
    return (
      header(className(d.course), reportSub(d)) +
      '<main class="sp-main sp-main-center">' +
      '<section class="sp-card sp-hello"><div class="sp-avatar" aria-hidden="true">' +
      esc(first.charAt(0).toUpperCase()) +
      '</div><h1 class="sp-big">' +
      esc('Your report is ready, ' + first) +
      '</h1>' +
      (d.has_birthday === false
        ? '<p class="sp-lead">' + esc(MESSAGES.no_birthday) + '</p>'
        : '<p class="sp-lead">To make sure it\u2019s you, enter your birthday.</p>' + birthdayPickers(state)) +
      (state.message ? '<p class="sp-msg" role="alert">' + esc(state.message) + '</p>' : '') +
      '</section>' +
      (d.has_birthday === false
        ? ''
        : '<button type="button" class="sp-btn sp-btn-primary" data-act="rcheck"' +
          (state.sending ? ' disabled' : '') +
          '>' +
          (state.sending ? 'Opening\u2026' : 'Open My Report') +
          '</button>') +
      '<button type="button" class="sp-btn sp-btn-line" data-act="notme">This Isn\u2019t Me</button>' +
      '<p class="sp-fine">' +
      esc((until ? 'This link works until ' + until + '. ' : '') + 'Keep your slip private, like a password.') +
      '</p></main>'
    );
  }

  function renderReport(state) {
    return (
      '<div class="pr-view">' +
      (typeof PhoneReportView !== 'undefined' ? PhoneReportView.html(state.report) : '') +
      '</div>'
    );
  }

  function render(state) {
    switch (state.screen) {
      case 'loading':
        return renderLoading(state);
      case 'confirm':
        return renderConfirm(state);
      case 'notme':
        return renderNotMe(state);
      case 'part':
        return renderPart(state);
      case 'sent':
        return renderSent(state);
      case 'message':
        return renderMessage(state);
      case 'rcheck':
        return renderRCheck(state);
      case 'report':
        return renderReport(state);
      default:
        return renderStart(state);
    }
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

  /* ── The edge function ─────────────────────────────────────── */

  function endpoint() {
    var base = ((window.__ENV && window.__ENV.SUPABASE_URL) || '').replace(/\/$/, '');
    return base + '/functions/v1/student-submit?forceFunctionRegion=ca-central-1';
  }

  function call(body) {
    return fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
      .then(function (res) {
        return res.json().catch(function () {
          return { ok: false, error: 'network' };
        });
      })
      .catch(function () {
        return { ok: false, error: 'network' };
      });
  }

  function messageFor(res) {
    var e = (res && res.error) || 'network';
    if (e === 'not_open_yet' && res.opens_on) return 'These questions open on ' + fmtDate(res.opens_on) + '.';
    return MESSAGES[e] || MESSAGES.network;
  }

  /* ── Drafts (this tab only) ────────────────────────────────── */

  function draftKey() {
    return 'fv-s-draft-' + S.code;
  }
  function saveDraft() {
    if (!S || S.demo || !S.code) return;
    try {
      sessionStorage.setItem(draftKey(), JSON.stringify({ answers: S.answers, part: S.part }));
    } catch (e) {
      /* private mode: the answers stay on the page */
    }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(sessionStorage.getItem(draftKey()) || 'null');
      if (d && d.answers) S.answers = d.answers;
    } catch (e) {
      /* nothing saved */
    }
  }
  function clearDraft() {
    try {
      sessionStorage.removeItem(draftKey());
    } catch (e) {
      /* nothing to clear */
    }
  }

  /* ── Demo Mode ─────────────────────────────────────────────── */

  function demoData(which) {
    var tpls = typeof QUESTIONNAIRE_TEMPLATES !== 'undefined' ? QUESTIONNAIRE_TEMPLATES : [];
    function part(id, extra) {
      var t = tpls.find(function (x) {
        return x.id === id;
      });
      if (!t) return null;
      return Object.assign(
        {
          id: 'demo-' + id,
          kind: t.kind,
          title: t.title,
          theme: t.theme,
          grade: t.grade,
          questions: t.questions.map(function (q, i) {
            return Object.assign({ id: 'demo-' + id + '-' + i, core_ids: [], options: {} }, q);
          }),
        },
        extra || {},
      );
    }
    var parts =
      which === 'about' ? [part('about-me')] : [part('core-8-1'), part('goal-checkin', { title: 'Goal Check-In' })];
    return {
      ok: true,
      token: 'demo',
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      parts: parts.filter(Boolean),
      context:
        which === 'about'
          ? {}
          : {
              course_goal: {
                text: 'Hand in labs on time by finishing my data table in class.',
                at: new Date().getFullYear() + '-09-15T12:00:00Z',
              },
            },
    };
  }

  /* Demo Mode's phone report: Cece's Report 1, as a teacher would send it. */
  function demoReport() {
    return {
      v: 1,
      name: 'Cece Adeyemi',
      initials: 'CA',
      first: 'Cece',
      course: 'Science 8',
      report: 'Report 1',
      issued: new Date().toISOString(),
      overall: { mode: 'proficiency', text: '3.0', level: 3, word: 'Proficient' },
      skills: [
        { name: 'Questioning and Predicting', line: 'I can ask questions I can test.', word: 'Proficient', level: 3 },
        { name: 'Planning and Conducting', line: 'I can plan a fair investigation.', word: 'Proficient', level: 3 },
        { name: 'Processing and Analyzing Data', line: 'I can make sense of data.', word: 'Extending', level: 4 },
        { name: 'Communicating', line: 'I can share ideas and results.', word: 'Developing', level: 2 },
      ],
      comment: [
        'Cece is working at a proficient level in Science 8, and her data work went further: her Energy Transfer Investigation was extending.',
        'Her next step is handing in labs on time, a goal she set herself. You can help by asking her each week how her goal is going.',
      ],
      goal: {
        text: 'Hand in labs on time by finishing my data table in class.',
        status: 'Working On It',
        at: new Date().toISOString(),
      },
      self: {
        at: new Date().toISOString(),
        items: [
          { name: 'Personal Awareness & Responsibility', step: 2, why: 'I set goals but I forget to check on them.' },
          { name: 'Personal & Cultural Identity', step: 3, why: 'My family and my culture matter a lot to me.' },
        ],
      },
      attendance: { absent: 3, late: 2 },
    };
  }

  function loadDemoTemplates(done) {
    if (typeof QUESTIONNAIRE_TEMPLATES !== 'undefined') return done();
    var s = document.createElement('script');
    s.src = '../shared/questionnaire-templates.js';
    s.onload = done;
    s.onerror = done;
    document.head.appendChild(s);
  }

  /* ── Flow ──────────────────────────────────────────────────── */

  var root = null;

  function paint(focusSel) {
    if (!root) return;
    // html-safe: this file's render (the name is shared): every screen escapes server and typed text with esc; q.id is a question uuid; PhoneReportView.html escapes the report.
    root.innerHTML = render(S);
    if (S.screen === 'loading' && window.FVLoading) window.FVLoading.start(root, 'student');
    root.querySelectorAll('textarea.sp-text').forEach(grow);
    rovingRadios(root);
    var f = focusSel ? root.querySelector(focusSel) : null;
    if (f && f.focus) f.focus({ preventScroll: false });
  }

  /* Each set of choices is one Tab stop, as a radio group is: the chosen
     one, or the first; the arrow keys move inside it. */
  function rovingRadios(el) {
    el.querySelectorAll('[role="radiogroup"]').forEach(function (g) {
      var radios = Array.prototype.slice.call(g.querySelectorAll('[role="radio"]'));
      if (!radios.length) return;
      var on = radios.filter(function (r) {
        return r.getAttribute('aria-checked') === 'true';
      })[0];
      radios.forEach(function (r) {
        r.setAttribute('tabindex', r === (on || radios[0]) ? '0' : '-1');
      });
    });
  }

  function grow(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }

  /* A slip that locked on this phone stays locked when the page is opened
     again (the server says so only after another try). */
  function lockKey(code) {
    return 'fv-s-locked-' + code;
  }
  function slipLockedHere(code) {
    try {
      return !!localStorage.getItem(lockKey(code));
    } catch (e) {
      return false;
    }
  }
  function markSlipLocked(code) {
    try {
      localStorage.setItem(lockKey(code), '1');
    } catch (e) {
      /* private mode: the server still refuses it */
    }
  }

  /* "2 tries left." and, before the last, what happens after it. */
  function triesLeftText(n) {
    if (n == null) return '';
    if (n === 1)
      return ' 1 try left. One more wrong try locks this slip, and you will need a new one from your teacher.';
    return ' ' + n + ' tries left.';
  }

  function openCode(code) {
    var c = cleanCode(code);
    S.typed = prettyCode(c);
    if (!CODE_RE.test(c)) {
      S.message = MESSAGES.not_found;
      S.screen = S.screen === 'confirm' ? 'confirm' : 'start';
      paint('#sp-code');
      return Promise.resolve();
    }
    S.code = c;
    S.message = '';
    S.screen = 'loading';
    paint();
    return call({ route: 'open', code: c }).then(function (res) {
      if (res && res.ok && res.kind === 'report') {
        S.data = res;
        S.screen = 'rcheck';
        S.message = '';
        paint();
      } else if (res && res.ok && res.check && slipLockedHere(c)) {
        // Locked on this phone already: say so now, not after another try.
        S.message = MESSAGES.slip_locked;
        S.screen = 'message';
        paint();
      } else if (res && res.ok) {
        S.data = res;
        S.part = 0;
        S.answers = {};
        if (res.parts) loadDraft();
        S.screen = 'confirm';
        S.message = '';
        paint();
      } else {
        S.message = messageFor(res);
        S.screen = 'message';
        paint();
      }
    });
  }

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

  /* A questionnaire slip: the birthday, student number or slip password
     hands over the questions. A session that ran out opens again from the
     code, once. */
  function verifyIdentity() {
    var by = S.data.check;
    var typed = ((root.querySelector('#sp-ident') || {}).value || '').trim();
    var m = (root.querySelector('#sp-bm') || {}).value || '';
    var dd = (root.querySelector('#sp-bd') || {}).value || '';
    var y = (root.querySelector('#sp-by') || {}).value || '';
    S.number = typed;
    S.bday = { m: m, d: dd, y: y };
    var ident = { birthday: null, student_number: null, password: null };
    if (by === 'password') {
      if (!typed) {
        S.message = 'Type the password printed on your slip.';
        paint('#sp-ident');
        return Promise.resolve();
      }
      ident.password = typed;
    } else {
      var some = m || dd || y;
      if (some && !(m && dd && y)) {
        S.message = 'Choose the month, day and year you were born.';
        paint();
        return Promise.resolve();
      }
      if (some) ident.birthday = y + '-' + String(m).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
      if (typed) ident.student_number = typed;
      if (typed && S.data.also_password && typed.length <= 16) ident.password = typed;
      if (!some && !typed) {
        S.message = 'Choose your birthday or type your student number.';
        paint();
        return Promise.resolve();
      }
    }
    S.message = '';
    var done = function (res) {
      S.sending = false;
      if (res && res.ok) {
        S.ident = ident;
        S.data.parts = res.parts || [];
        S.data.context = res.context || {};
        S.data.check = null;
        S.part = 0;
        S.answers = {};
        loadDraft();
        S.screen = 'part';
        paint();
        window.scrollTo(0, 0);
        return;
      }
      var e = res && res.error;
      if (e === 'slip_locked' && !S.demo) markSlipLocked(S.code);
      if (e === 'wrong_identity') {
        S.message = MESSAGES[by === 'password' ? 'wrong_password' : 'wrong_identity'] + triesLeftText(res.tries_left);
      } else {
        S.message = messageFor(res);
        if (e !== 'network' && e !== 'busy') S.screen = 'message';
      }
      paint();
    };
    if (S.demo) {
      return Promise.resolve(done({ ok: true, parts: S.demoParts, context: S.demoContext }));
    }
    S.sending = true;
    paint();
    return call(Object.assign({ route: 'verify', token: S.data.token }, ident))
      .then(function (res) {
        if (res && res.error === 'expired') {
          return call({ route: 'open', code: S.code }).then(function (again) {
            if (!again || !again.ok) return again;
            S.data.token = again.token;
            return call(Object.assign({ route: 'verify', token: again.token }, ident));
          });
        }
        return res;
      })
      .then(done);
  }

  /* The birthday opens a phone report. A session that ran out opens again
     from the code, once. */
  function checkBirthday() {
    var m = (root.querySelector('#sp-bm') || {}).value;
    var dd = (root.querySelector('#sp-bd') || {}).value;
    var y = (root.querySelector('#sp-by') || {}).value;
    if (!m || !dd || !y) {
      S.bday = { m: m || '', d: dd || '', y: y || '' };
      S.message = 'Choose the month, day and year you were born.';
      paint();
      return Promise.resolve();
    }
    S.bday = { m: m, d: dd, y: y };
    var birthday = y + '-' + String(m).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
    S.message = '';
    var done = function (res) {
      S.sending = false;
      if (res && res.ok) {
        S.report = res.report || {};
        S.screen = 'report';
        paint();
        window.scrollTo(0, 0);
        return;
      }
      var e = res && res.error;
      S.message =
        e === 'wrong_birthday'
          ? MESSAGES.wrong_birthday +
            (res.tries_left != null ? ' ' + res.tries_left + (res.tries_left === 1 ? ' try' : ' tries') + ' left.' : '')
          : messageFor(res);
      if (e === 'report_closed' || e === 'not_found' || e === 'locked') S.screen = 'message';
      paint();
    };
    if (S.demo) {
      return Promise.resolve(done({ ok: true, report: demoReport() }));
    }
    S.sending = true;
    paint();
    return call({ route: 'check', token: S.data.token, birthday: birthday })
      .then(function (res) {
        if (res && res.error === 'expired') {
          return call({ route: 'open', code: S.code }).then(function (again) {
            if (!again || !again.ok) return again;
            S.data.token = again.token;
            return call({ route: 'check', token: again.token, birthday: birthday });
          });
        }
        return res;
      })
      .then(done);
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

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    var act = el.dataset.act;
    var q = el.dataset.q ? questionById(el.dataset.q) : null;
    if (act === 'start' && S.data && S.data.check) {
      verifyIdentity();
    } else if (act === 'start') {
      S.screen = 'part';
      S.part = 0;
      paint();
      window.scrollTo(0, 0);
    } else if (act === 'notme') {
      S.screen = 'notme';
      paint();
    } else if (act === 'restart') {
      S = freshState();
      try {
        history.replaceState(null, '', location.pathname);
      } catch (err) {
        /* fine */
      }
      paint('#sp-code');
    } else if (act === 'next') {
      S.part = Math.min(S.part + 1, S.data.parts.length - 1);
      S.message = '';
      saveDraft();
      paint();
      window.scrollTo(0, 0);
    } else if (act === 'back') {
      S.message = '';
      if (S.part > 0) S.part -= 1;
      else S.screen = 'confirm';
      saveDraft();
      paint();
      window.scrollTo(0, 0);
    } else if (act === 'send') {
      send();
    } else if (act === 'rcheck') {
      checkBirthday();
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

  function onInput(e) {
    var el = e.target;
    if (el.id === 'sp-code') {
      S.typed = el.value;
      return;
    }
    if (el.id === 'sp-ident') {
      S.number = el.value;
      return;
    }
    if (!el.dataset || !el.dataset.q) return;
    var q = questionById(el.dataset.q);
    if (!q) return;
    setAnswer(S, q, el);
    if (el.tagName === 'TEXTAREA') grow(el);
    saveDraft();
    updateCount();
  }

  function onSubmit(e) {
    var form = e.target.closest('[data-form="code"]');
    if (!form) return;
    e.preventDefault();
    var input = form.querySelector('#sp-code');
    openCode(input ? input.value : '');
  }

  var ARROWS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  function onKeydown(e) {
    // Arrow keys, Home and End choose within a set of choices.
    var t = e.target;
    var group = t && t.getAttribute && t.getAttribute('role') === 'radio' && t.closest('[role="radiogroup"]');
    if (group && (ARROWS[e.key] || e.key === 'Home' || e.key === 'End')) {
      var radios = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var i = radios.indexOf(t);
      var n =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? radios.length - 1
            : (i + ARROWS[e.key] + radios.length) % radios.length;
      e.preventDefault();
      if (radios[n]) radios[n].click();
      return;
    }
    // Enter in "Another" adds it instead of submitting anything.
    if (e.key === 'Enter' && e.target && /-other$/.test(e.target.id || '')) {
      e.preventDefault();
      var add = e.target.parentNode.querySelector('[data-act="other-add"]');
      if (add) add.click();
    }
  }

  function start(el, hash) {
    root = el;
    S = freshState();
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('keydown', onKeydown);
    var h = String(hash || '').replace(/^#/, '');
    if (/^demo-report$/i.test(h)) {
      S.demo = true;
      var until = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
      S.data = {
        ok: true,
        kind: 'report',
        token: 'demo',
        student: { first_name: 'Cece' },
        course: { name: 'Science 8', block: 'B' },
        report: { title: 'Report 1', expires_on: until },
        has_birthday: true,
      };
      S.screen = 'rcheck';
      paint();
      return;
    }
    if (/^demo(-about)?$/i.test(h)) {
      S.demo = true;
      S.screen = 'loading';
      paint();
      loadDemoTemplates(function () {
        S.data = demoData(/about/i.test(h) ? 'about' : 'reflection');
        // The reflection asks who you are, as a real slip does (any answer
        // passes in Demo Mode); About Me shows the screen after the check.
        if (!/about/i.test(h) && S.data.parts.length) {
          S.demoParts = S.data.parts;
          S.demoContext = S.data.context;
          S.data.preview = slipParts(S.data);
          delete S.data.parts;
          delete S.data.context;
          S.data.check = 'identity';
        }
        S.screen = S.data.parts || S.data.check ? 'confirm' : 'start';
        paint();
      });
      return;
    }
    if (h) {
      openCode(decodeURIComponent(h));
      return;
    }
    paint();
  }

  var app = typeof document !== 'undefined' && document.getElementById ? document.getElementById('app') : null;
  if (app && typeof app.addEventListener === 'function' && typeof location !== 'undefined') {
    start(app, location.hash);
    window.addEventListener('hashchange', function () {
      var h = location.hash.replace(/^#/, '');
      if (h && cleanCode(h) !== S.code) {
        root.replaceWith((root = root.cloneNode(false)));
        start(root, location.hash);
      }
    });
  }

  return {
    _test: {
      freshState: freshState,
      render: render,
      collect: collect,
      isAnswered: isAnswered,
      answeredCount: answeredCount,
      setAnswer: setAnswer,
      toggleChoice: toggleChoice,
      setStep: setStep,
      demoData: demoData,
      cleanCode: cleanCode,
      start: start,
      state: function () {
        return S;
      },
    },
  };
})();
