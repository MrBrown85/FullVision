/* Reports on students' phones, the teacher's side (docs/STUDENT-VOICE-PLAN.md,
   PR 9; canvas T1): Progress Reports › Sent to Phones.

   snapshot() builds a student's phone copy from the same helpers the app
   shows (calc.js formats every grade, so the copy follows the class's
   Proficiency / Letter / Both setting). Send makes the report on the server
   (create_phone_report) with every student's copy and prints the slips;
   Update Issued Copy rebuilds the copies; Close All Links stops them. The
   list shows who opened it (passed the birthday check) and who replied,
   with the start of each reply.

   Demo Mode keeps the reports on this device (gb-phone-reports-<cid>) and
   makes up slip codes; nothing reaches a phone. */
var PhoneReports = (function () {
  'use strict';

  var _byCourse = {}; // cid -> [report], newest first
  var _loading = {};
  var _filter = 'all'; // all | replied | unopened
  var _msg = '';
  var _busy = false;
  var DAYS_OPEN = 60;

  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }

  function _readLocal(cid) {
    try {
      var v = JSON.parse(localStorage.getItem('gb-phone-reports-' + cid) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function _writeLocal(cid, list) {
    try {
      localStorage.setItem('gb-phone-reports-' + cid, JSON.stringify(list));
    } catch (e) {
      /* a full device keeps it for this visit */
    }
  }

  function _rerender() {
    if (typeof PageReports !== 'undefined' && PageReports.renderReports) PageReports.renderReports();
  }

  function _today() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function _addDays(iso, n) {
    var t = new Date(iso + 'T12:00:00');
    t.setDate(t.getDate() + n);
    return (
      t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    );
  }

  function _day(iso) {
    return typeof PhoneReportView !== 'undefined' ? PhoneReportView.day(iso) : String(iso || '').slice(0, 10);
  }

  function termNumber(termId) {
    var m = /(\d+)$/.exec(String(termId || ''));
    var n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= 6 ? n : 1;
  }

  /* ── Loading ───────────────────────────────────────────────── */

  function loaded(cid) {
    return _demo() || Object.prototype.hasOwnProperty.call(_byCourse, cid);
  }

  function load(cid, onChange) {
    if (!cid) return Promise.resolve([]);
    if (typeof StudentVoice !== 'undefined') StudentVoice.load(cid, onChange);
    if (_demo()) return Promise.resolve(_readLocal(cid));
    if (_loading[cid]) return _loading[cid];
    var v2 = window.v2 || {};
    _loading[cid] = (v2.listPhoneReports ? v2.listPhoneReports(cid) : Promise.resolve({ data: [] })).then(
      function (res) {
        delete _loading[cid];
        _byCourse[cid] = (res && res.data) || [];
        if (onChange) onChange(cid);
        return _byCourse[cid];
      },
    );
    return _loading[cid];
  }

  function list(cid) {
    return _demo() ? _readLocal(cid) : _byCourse[cid] || [];
  }

  /* The report sent for this reporting period, newest first. */
  function forTerm(cid, term) {
    return (
      list(cid).find(function (r) {
        return r.term === term;
      }) || null
    );
  }

  function _store(cid, report) {
    var all = list(cid).filter(function (r) {
      return r.id !== report.id;
    });
    all.unshift(report);
    if (_demo()) _writeLocal(cid, all);
    else _byCourse[cid] = all;
    return report;
  }

  /* ── A student's phone copy ────────────────────────────────── */

  function _paragraphs(narrative) {
    var raw = String(narrative || '').trim();
    if (!raw) return [];
    var text = raw;
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      var marked = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n');
      if (typeof DOMParser !== 'undefined') {
        // Parsed, never placed in the page: nothing in it runs.
        text = new DOMParser().parseFromString(marked, 'text/html').body.textContent || '';
      } else {
        text = marked
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');
      }
    }
    return text
      .split(/\n\s*\n/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
  }

  function snapshot(cid, st, ctx) {
    var course = COURSES[cid] || {};
    var mode = courseGradeMode(cid);
    var overallV = getOverallProficiency(cid, st.id);
    var summary = studentGradeSummary(cid, st.id);
    var term = termNumber(ctx.termId);
    var data = {
      v: 1,
      name: displayNameWithLast(st),
      initials: initials(st),
      first: displayNameFirst(st),
      course: course.name || '',
      report: ctx.termLabel || 'Report ' + term,
      issued: ctx.issued || new Date().toISOString(),
      overall: {
        mode: mode,
        text: summary.text || '',
        level: summary.level || 0,
        word: levelWord(cid, overallV) || '',
      },
      skills: getSections(cid).map(function (sec) {
        var sp = getSectionProficiency(cid, st.id, sec.id);
        var tag = (sec.tags || [])[0];
        return {
          name: sec.shortName || sec.name,
          line: (tag && (tag.i_can_statements || [])[0]) || '',
          text: formatLevel(cid, sp, ''),
          word: levelWord(cid, sp) || '',
          level: sp > 0 ? Math.round(sp) : 0,
        };
      }),
      comment: _paragraphs((getStudentTermRating(cid, st.id, ctx.termId) || {}).narrative),
      goal: null,
      self: null,
      attendance: null,
    };
    // Their goal, in their own words, and how they last said it was going.
    if (typeof StudentVoice !== 'undefined' && StudentVoice.loaded(cid)) {
      var voice = StudentVoice.profile(StudentVoice.entries(cid, st.id));
      var g = voice.about && voice.about.goal && voice.about.goal.v;
      if (g && g.text) {
        var c = voice.checkin;
        data.goal = {
          text: g.text,
          status: c && c.status && c.status.v ? c.status.v.text || '' : '',
          at: c && c.status && c.status.v ? c.at : null,
        };
      }
    }
    // Their Core Competency self-assessments for this reporting period.
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    var key = terms.length ? 'T' + term : '';
    var mine = ((typeof getCoreSelf === 'function' ? getCoreSelf(cid)[st.id] : null) || {})[key] || {};
    var items = [];
    var at = '';
    CORE_COMPETENCIES.forEach(function (cc) {
      var e = mine[cc.id];
      if (!e || !e.level) return;
      items.push({ name: cc.label, step: e.level, why: e.text || '' });
      if (e.date && e.date > at) at = e.date;
    });
    // Or, where nothing is filed for the period, what they chose in that
    // period's reflection.
    if (!items.length && typeof StudentVoice !== 'undefined' && StudentVoice.loaded(cid)) {
      var refl = StudentVoice.entries(cid, st.id).find(function (e) {
        return e.kind === 'core_reflection' && (!e.report_period || e.report_period === term);
      });
      (refl ? refl.items : []).forEach(function (it) {
        if (it.q.kind !== 'scale4' || !it.v || !it.v.json) return;
        var lv = it.v.json.levels || {};
        var why = it.v.json.why;
        (it.q.core_ids || []).forEach(function (k) {
          if (!lv[k]) return;
          var cc = CORE_COMPETENCIES.find(function (x) {
            return x.id === k;
          });
          items.push({
            name: cc ? cc.label : k,
            step: lv[k],
            why: why && typeof why === 'object' ? why[k] || '' : typeof why === 'string' ? why : '',
          });
        });
      });
      if (items.length) at = refl.at;
    }
    if (items.length) data.self = { at: at || null, items: items };
    var att = typeof getTermAttendance === 'function' ? getTermAttendance(cid, st.id, ctx.termId) : null;
    if (att && (att.absences != null || att.lates != null)) data.attendance = { absent: att.absences, late: att.lates };
    return data;
  }

  function _students(cid) {
    return sortStudents(getStudents(cid), 'lastName');
  }

  /* ── Sending, updating, closing, slips ─────────────────────── */

  function _codes(cid, report, ids) {
    if (_demo()) {
      var abc = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
      var make = function () {
        var s = '';
        for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
        return s.slice(0, 3) + '-' + s.slice(3);
      };
      var list = (
        ids && ids.length
          ? ids
          : report.students.map(function (s) {
              return s.enrollment_id;
            })
      ).map(function (id) {
        return { enrollment_id: id, code: make() };
      });
      return Promise.resolve({ data: list, error: null });
    }
    return window.v2.issueReportCodes(report.id, ids);
  }

  function printSlips(cid, report, ids) {
    _msg = 'Making slips…';
    _rerender();
    return _codes(cid, report, ids).then(function (res) {
      var codes = (res && res.data) || [];
      if (!codes.length) {
        _msg = 'Could not make the slips. Check the connection and try again.';
        _rerender();
        return;
      }
      _msg = '';
      _rerender();
      QrSlips.print(
        cid,
        {
          title: report.term_label || 'Report ' + report.term,
          closes_on: report.expires_on,
          slipNote: 'Your report. Keep this slip private, like a password.',
        },
        codes,
      );
    });
  }

  function _copies(cid, ctx) {
    return _students(cid).map(function (st) {
      return { enrollment_id: st.id, data: snapshot(cid, st, ctx) };
    });
  }

  function send(cid, ctx, expiresOn) {
    if (_busy) return Promise.resolve();
    _busy = true;
    _msg = 'Sending…';
    _rerender();
    var term = termNumber(ctx.termId);
    var ready = typeof StudentVoice !== 'undefined' ? StudentVoice.load(cid) : Promise.resolve();
    return Promise.resolve(ready)
      .then(function () {
        var issued = new Date().toISOString();
        var students = _copies(cid, Object.assign({}, ctx, { issued: issued }));
        if (_demo()) {
          return {
            data: {
              id: 'pr' + Date.now().toString(36),
              course_id: cid,
              term: term,
              term_label: ctx.termLabel,
              issued_at: issued,
              updated_at: issued,
              expires_on: expiresOn,
              closed_at: null,
              students: students.map(function (s) {
                return { enrollment_id: s.enrollment_id, data: s.data, opened_at: null, replied_at: null };
              }),
            },
          };
        }
        return window.v2.createPhoneReport(cid, term, ctx.termLabel, expiresOn, students);
      })
      .then(function (res) {
        _busy = false;
        var report = res && res.data;
        if (!report || !report.id) {
          _msg = 'Could not send. Check the connection and try again.';
          _rerender();
          return null;
        }
        _store(cid, report);
        _msg = '';
        _rerender();
        return printSlips(cid, report, null).then(function () {
          return report;
        });
      });
  }

  function update(cid, report, ctx) {
    _msg = 'Updating…';
    _rerender();
    var students = _copies(cid, Object.assign({}, ctx, { issued: report.issued_at }));
    var done = function (fresh) {
      _msg = fresh ? 'Updated. Phones now show today’s copy.' : 'Could not update. Check the connection and try again.';
      if (fresh) _store(cid, fresh);
      _rerender();
    };
    if (_demo()) {
      var byId = {};
      students.forEach(function (s) {
        byId[s.enrollment_id] = s.data;
      });
      var fresh = Object.assign({}, report, {
        updated_at: new Date().toISOString(),
        students: report.students.map(function (s) {
          return Object.assign({}, s, { data: byId[s.enrollment_id] || s.data });
        }),
      });
      done(fresh);
      return Promise.resolve(fresh);
    }
    return window.v2.updatePhoneReport(report.id, students, null).then(function (res) {
      done(res && res.data);
    });
  }

  function close(cid, report) {
    if (_demo()) {
      _store(cid, Object.assign({}, report, { closed_at: new Date().toISOString() }));
      _rerender();
      return Promise.resolve();
    }
    return window.v2.closePhoneReport(report.id).then(function (res) {
      if (res && res.data) _store(cid, res.data);
      else _msg = 'Could not close the links. Check the connection and try again.';
      _rerender();
    });
  }

  /* ── The panel ─────────────────────────────────────────────── */

  /* A student's reply as one line: what they're proud of and their next step. */
  function replyLine(cid, report, sid) {
    if (typeof StudentVoice === 'undefined' || !report.reply_questionnaire_id) return '';
    var e = StudentVoice.entries(cid, sid).find(function (x) {
      return x.qid === report.reply_questionnaire_id;
    });
    if (!e) return '';
    var parts = [];
    var next = '';
    e.items.forEach(function (it) {
      var t = it.v && (it.v.text || (Array.isArray(it.v.json) ? it.v.json.join(', ') : ''));
      if (!t) return;
      if (/before the next report/i.test(it.q.prompt)) next = t;
      else if (it.q.kind === 'text') parts.push(t);
    });
    if (next) parts.push('Next: ' + next);
    return parts.join(' · ');
  }

  function changedGoal(cid, report, sid) {
    if (typeof StudentVoice === 'undefined' || !report.reply_questionnaire_id) return false;
    var e = StudentVoice.entries(cid, sid).find(function (x) {
      return x.qid === report.reply_questionnaire_id;
    });
    return !!(
      e &&
      e.items.some(function (it) {
        return it.q.kind === 'choice' && it.v && /change/i.test(it.v.text || '');
      })
    );
  }

  function _sendHtml(cid, ctx) {
    var label = ctx.termLabel || 'this report';
    var noBirthday = _students(cid).filter(function (s) {
      return !s.dateOfBirth;
    });
    return (
      '<section class="tq-panel pp-panel" aria-labelledby="pp-send-h"><h1 id="pp-send-h" class="pp-title">' +
      esc('Send ' + label + ' to Students’ Phones') +
      '</h1><p class="pp-sub">Each student gets a slip. They open their report with their birthday and can reply to you once. You can update the copy or close the links any time.</p>' +
      '<label class="pp-field"><span class="cm-label">Links Work Until</span><input type="date" class="cm-input" id="pp-until" value="' +
      esc(_addDays(_today(), DAYS_OPEN)) +
      '" min="' +
      esc(_today()) +
      '"></label>' +
      (noBirthday.length
        ? '<p class="pp-warn">' +
          esc(
            noBirthday.length +
              (noBirthday.length === 1 ? ' student has' : ' students have') +
              ' no birthday on file and can’t open it until you add one: ' +
              noBirthday.slice(0, 8).map(displayNameWithLast).join(', ') +
              (noBirthday.length > 8 ? ' and ' + (noBirthday.length - 8) + ' more' : '') +
              '.',
          ) +
          '</p>'
        : '') +
      '<div><button type="button" class="btn btn-primary" data-action="ppSend"' +
      (_busy ? ' disabled' : '') +
      '>Send to Phones and Print Slips</button></div>' +
      (_msg ? '<p class="pp-msg" role="status">' + esc(_msg) + '</p>' : '') +
      '</section>'
    );
  }

  function _row(cid, report, st, sRow, i) {
    var opened = sRow && sRow.opened_at;
    var replied = sRow && sRow.replied_at;
    var line = replied ? replyLine(cid, report, st.id) : '';
    var act = replied
      ? '<button type="button" class="cm-add-link" data-action="ppReadReply" data-sid="' +
        esc(st.id) +
        '">Read Reply</button>'
      : opened
        ? '<button type="button" class="cm-add-link" data-action="ppReadReport" data-sid="' +
          esc(st.id) +
          '">Read Report</button>'
        : report.closed_at
          ? ''
          : '<button type="button" class="cm-add-link" data-action="ppNewSlip" data-sid="' +
            esc(st.id) +
            '">New Slip</button>';
    return (
      '<div class="pp-grid pp-row' +
      (i % 2 ? ' pp-alt' : '') +
      '"><a class="pp-name" href="#/student?id=' +
      encodeURIComponent(st.id) +
      '&course=' +
      encodeURIComponent(cid) +
      '&tab=profile">' +
      esc(displayNameWithLast(st)) +
      '</a><span class="pp-st"><span class="pp-dot" style="background:' +
      (opened ? 'var(--score-3)' : 'var(--score-2)') +
      '"></span>' +
      esc(opened ? _day(opened) : 'Not yet') +
      '</span><span class="pp-st"><span class="pp-dot" style="background:' +
      (replied ? 'var(--score-3)' : 'var(--border-2, var(--text-3))') +
      '"></span>' +
      esc(replied ? _day(replied) : '—') +
      '</span><span class="pp-reply' +
      (line ? '' : ' pp-none') +
      '">' +
      esc(line || (replied ? 'Replied' : 'No reply')) +
      '</span><span class="pp-acts">' +
      act +
      '</span></div>'
    );
  }

  function _reportHtml(cid, report) {
    var rows = {};
    (report.students || []).forEach(function (s) {
      rows[s.enrollment_id] = s;
    });
    var students = _students(cid).filter(function (st) {
      return rows[st.id];
    });
    var n = students.length;
    var opened = students.filter(function (st) {
      return rows[st.id].opened_at;
    });
    var replied = students.filter(function (st) {
      return rows[st.id].replied_at;
    });
    var changed = replied.filter(function (st) {
      return changedGoal(cid, report, st.id);
    }).length;
    var shown = students.filter(function (st) {
      if (_filter === 'replied') return rows[st.id].replied_at;
      if (_filter === 'unopened') return !rows[st.id].opened_at;
      return true;
    });
    var title = report.term_label || 'Report ' + report.term;
    var closed = !!report.closed_at;
    var seg = function (id, label) {
      var on = _filter === id;
      return (
        '<button type="button" class="seg-btn' +
        (on ? ' active' : '') +
        '" role="radio" aria-checked="' +
        on +
        '" data-action="ppFilter" data-filter="' +
        id +
        '">' +
        esc(label) +
        '</button>'
      );
    };
    return (
      '<section class="tq-panel pp-panel" aria-labelledby="pp-h"><div class="pp-top"><div class="pp-titles"><h1 id="pp-h" class="pp-title">' +
      esc(title + ' on Students’ Phones') +
      '</h1><div class="pp-sub">' +
      esc(
        'Issued ' +
          _day(report.issued_at) +
          (report.updated_at && report.updated_at.slice(0, 10) !== String(report.issued_at).slice(0, 10)
            ? ' · Updated ' + _day(report.updated_at)
            : '') +
          (closed ? ' · Links closed ' + _day(report.closed_at) : ' · Links work until ' + _day(report.expires_on)) +
          ' · Students check in with their birthday',
      ) +
      '</div></div><div class="pp-btns">' +
      (closed
        ? ''
        : '<button type="button" class="cm-action-btn" data-action="ppPrint">Print QR Slips</button>' +
          '<button type="button" class="cm-action-btn" data-action="ppUpdate">Update Issued Copy</button>' +
          '<button type="button" class="cm-action-btn" data-action="ppClose">Close All Links</button>') +
      '</div></div>' +
      (_msg ? '<p class="pp-msg" role="status">' + esc(_msg) + '</p>' : '') +
      '<div class="pp-stats"><div class="pp-stat"><strong>' +
      opened.length +
      ' <span>of ' +
      n +
      '</span></strong><span>Opened</span></div><div class="pp-stat"><strong>' +
      replied.length +
      '</strong><span>Replied</span></div><div class="pp-stat"><strong>' +
      changed +
      '</strong><span>Changed their goal</span></div><div class="pp-stat"><strong class="' +
      (n - opened.length ? 'pp-warn-n' : '') +
      '">' +
      (n - opened.length) +
      '</strong><span>Haven’t opened</span></div></div></section>' +
      '<section class="tq-panel pp-panel pp-list" aria-labelledby="pp-who"><div class="pp-list-head"><h2 id="pp-who" class="tq-panel-title">Students</h2>' +
      '<div class="seg seg-sm" role="radiogroup" aria-label="Show">' +
      seg('all', 'All ' + n) +
      seg('replied', 'Replied ' + replied.length) +
      seg('unopened', 'Not Opened ' + (n - opened.length)) +
      '</div></div><div class="pp-grid pp-head" aria-hidden="true"><span>Student</span><span>Opened</span><span>Replied</span><span>Reply</span><span></span></div>' +
      shown
        .map(function (st, i) {
          return _row(cid, report, st, rows[st.id], i);
        })
        .join('') +
      (shown.length ? '' : '<div class="pp-empty">No students here.</div>') +
      '</section>'
    );
  }

  function panelHtml(cid, ctx) {
    if (!loaded(cid)) {
      load(cid, _rerender);
      return '<div class="pp-wrap"><div class="cm-hint">Loading…</div></div>';
    }
    var report = forTerm(cid, termNumber(ctx.termId));
    return '<div class="pp-wrap">' + (report ? _reportHtml(cid, report) : _sendHtml(cid, ctx)) + '</div>';
  }

  /* What the student sees, in a phone-sized window. */
  function _preview(cid, report, sid) {
    var row = (report.students || []).find(function (s) {
      return s.enrollment_id === sid;
    });
    if (!row || !row.data || typeof PhoneReportView === 'undefined') return;
    var overlay = document.createElement('div');
    overlay.className = 'pp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Report as the student sees it');
    overlay.innerHTML =
      '<div class="pp-phone"><div class="pp-phone-bar"><span>As ' +
      esc(row.data.first || 'the student') +
      ' sees it</span><button type="button" class="cm-action-btn" data-pp-close>Close</button></div><div class="pr-view pp-phone-body">' +
      PhoneReportView.html(row.data) +
      '</div></div>';
    var shut = function () {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    var onKey = function (e) {
      if (e.key === 'Escape') shut();
    };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || (e.target.closest && e.target.closest('[data-pp-close]'))) shut();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    var btn = overlay.querySelector('[data-pp-close]');
    if (btn) btn.focus();
  }

  function handleAction(action, el, cid, ctx) {
    var report = forTerm(cid, termNumber(ctx.termId));
    switch (action) {
      case 'ppSend': {
        var until = (document.getElementById('pp-until') || {}).value || _addDays(_today(), DAYS_OPEN);
        if (until < _today()) {
          _msg = 'The last day must be today or later.';
          _rerender();
          return true;
        }
        send(cid, ctx, until);
        return true;
      }
      case 'ppPrint':
        if (report) printSlips(cid, report, null);
        return true;
      case 'ppNewSlip':
        if (report) printSlips(cid, report, [el.dataset.sid]);
        return true;
      case 'ppUpdate':
        if (report) update(cid, report, ctx);
        return true;
      case 'ppClose':
        if (!report) return true;
        showConfirm(
          'Close All Links',
          'Students will no longer be able to open ' +
            (report.term_label || 'this report') +
            ' on their phones or reply. Replies already sent stay on their Learner Profiles.',
          'Close All Links',
          'danger',
          function () {
            close(cid, report);
          },
        );
        return true;
      case 'ppFilter':
        _filter = el.dataset.filter || 'all';
        _rerender();
        return true;
      case 'ppReadReport':
        if (report) _preview(cid, report, el.dataset.sid);
        return true;
      case 'ppReadReply':
        if (typeof Router !== 'undefined' && Router.navigate) {
          Router.navigate(
            '/student?id=' + encodeURIComponent(el.dataset.sid) + '&course=' + encodeURIComponent(cid) + '&tab=profile',
          );
        }
        return true;
    }
    return false;
  }

  function _reset() {
    _byCourse = {};
    _loading = {};
    _filter = 'all';
    _msg = '';
    _busy = false;
  }

  return {
    snapshot: snapshot,
    termNumber: termNumber,
    load: load,
    loaded: loaded,
    list: list,
    forTerm: forTerm,
    send: send,
    update: update,
    close: close,
    printSlips: printSlips,
    panelHtml: panelHtml,
    replyLine: replyLine,
    handleAction: handleAction,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.PhoneReports = PhoneReports;
