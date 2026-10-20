/* tab-reports.js — the phone's Reports tab, read-only (docs/report-forms-plan.md
   Phase 5 item 5.4). A teacher on a phone can see what went home and what a
   student's Report Card looks like now; nothing is set up, issued or printed
   here. The sheets are the same engine as the desktop (teacher/report-sheets.js),
   scaled to the phone's width. */

window.MReports = (function () {
  'use strict';

  var MC = window.MComponents;
  var _termN = null; // the report (1..6) the tab shows
  var _issueRec = null; // the loaded fixed copy while one is open
  var _issueIdx = 0; // which student of it is on screen
  var _liveSid = null;

  /* ── Terms ─────────────────────────────────────────────────── */
  /* The class's reports, as the desktop's picker lists them: its reporting
     terms with the school's report names, or Report 1–6. */
  function _reports(cid) {
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    if (!terms.length) {
      return [1, 2, 3, 4, 5, 6].map(function (n) {
        return { n: n, label: 'Report ' + n, starts_on: '', ends_on: '' };
      });
    }
    var names = typeof reportingTermReportNames === 'function' ? reportingTermReportNames(terms) : null;
    return terms.map(function (t, i) {
      var label = t.label || 'Report ' + t.ordinal;
      if (names) label = names[i] || label;
      return { n: t.ordinal, label: label, starts_on: t.starts_on, ends_on: t.ends_on };
    });
  }

  /* The report that contains today, else the last one begun, else the first. */
  function _defaultReport(cid) {
    var list = _reports(cid);
    var today = typeof courseToday === 'function' ? courseToday(cid) : '';
    var pick = list.find(function (t) {
      return today && t.starts_on && t.starts_on <= today && today <= t.ends_on;
    });
    if (!pick && today)
      pick = list
        .filter(function (t) {
          return t.starts_on && t.starts_on <= today;
        })
        .pop();
    return (pick || list[0]).n;
  }

  function _current(cid) {
    var list = _reports(cid);
    if (
      _termN == null ||
      !list.some(function (t) {
        return t.n === _termN;
      })
    )
      _termN = _defaultReport(cid);
    return list.find(function (t) {
      return t.n === _termN;
    });
  }

  function _ctx(cid) {
    var t = _current(cid);
    return { termId: 'term-' + t.n, termLabel: t.label };
  }

  function _paper(cid) {
    try {
      return localStorage.getItem('gb-report-paper-' + cid) === 'legal' ? 'legal' : 'letter';
    } catch (e) {
      return 'letter';
    }
  }

  function _usesSheets(cid) {
    var rc = typeof getReportConfig === 'function' ? getReportConfig(cid) : null;
    return !rc || !rc.preset || rc.preset === 'standard';
  }

  function _form(cid) {
    var rc = typeof getReportConfig === 'function' ? getReportConfig(cid) : null;
    return ReportSheets.formFor(rc);
  }

  /* ── The tab ───────────────────────────────────────────────── */
  function renderList(cid) {
    var nav = MC.navBar({ id: 'reports', title: 'Reports' });
    var reports = _reports(cid);
    var cur = _current(cid);
    var seg =
      '<div class="m-reports-terms"><div class="m-segmented m-segmented-scroll" role="radiogroup" aria-label="Report">' +
      reports
        .map(function (t) {
          var on = t.n === cur.n;
          return (
            '<button class="m-seg-btn' +
            (on ? ' m-seg-active' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" data-action="m-reports-term" data-n="' +
            t.n +
            '">' +
            MC.esc(t.label) +
            '</button>'
          );
        })
        .join('') +
      '</div></div>';

    var issues = typeof ReportIssues !== 'undefined' ? ReportIssues.list(cid, 'term-' + cur.n) : [];
    var copies = '<div class="m-list-inset-header">Issued Copies</div>';
    if (!issues.length) {
      copies +=
        '<div class="m-empty m-empty-inline"><div class="m-empty-title">Nothing issued yet</div><div class="m-empty-subtitle">Issue Reports on the desktop saves a fixed copy of every report; it shows here.</div></div>';
    } else {
      copies += '<div class="m-list" id="m-reports-issues">';
      issues.forEach(function (e) {
        copies +=
          '<button class="m-cell" data-action="m-reports-issue" data-id="' +
          MC.esc(e.id) +
          '"><div class="m-cell-body"><div class="m-cell-title">' +
          MC.esc(ReportIssues.label(e)) +
          '</div><div class="m-cell-subtitle">' +
          e.count +
          (e.count === 1 ? ' report' : ' reports') +
          ' · ' +
          (e.paper === 'legal' ? 'Legal' : 'Letter') +
          (e.serverId ? '' : ' · on this phone only') +
          '</div></div>' +
          MC.ICONS.chevronRight +
          '</button>';
      });
      copies += '</div>';
    }

    var live = '<div class="m-list-inset-header">Report Card Now</div>';
    if (!_usesSheets(cid)) {
      live +=
        '<div class="m-empty m-empty-inline"><div class="m-empty-title">Not the Report Card</div><div class="m-empty-subtitle">This class prints the Brief or Detailed report. The phone shows the Report Card form; choose it in Reports on the desktop.</div></div>';
    } else {
      var students = sortStudents(getStudents(cid), 'lastName');
      if (!students.length) {
        live +=
          '<div class="m-empty m-empty-inline"><div class="m-empty-title">No students</div><div class="m-empty-subtitle">Add students on the desktop.</div></div>';
      } else {
        live += '<div class="m-list" id="m-reports-students">';
        students.forEach(function (st) {
          var name = fullName(st);
          live +=
            '<button class="m-cell" data-action="m-reports-live" data-sid="' +
            MC.esc(st.id) +
            '"><div class="m-cell-avatar" style="background:' +
            MC.avatarColor(name) +
            '">' +
            MC.avatarInitials(name) +
            '</div><div class="m-cell-body"><div class="m-cell-title">' +
            MC.esc(name) +
            '</div></div>' +
            MC.ICONS.chevronRight +
            '</button>';
        });
        live += '</div>';
      }
    }

    return (
      '<div class="m-screen" id="m-screen-reports">' +
      nav +
      '<div class="m-screen-content">' +
      MC.largeTitleHTML('Reports') +
      seg +
      copies +
      live +
      '<div class="m-reports-note">Reports are set up, issued and printed on the desktop. The phone shows them as they are.</div>' +
      '</div></div>'
    );
  }

  function setTerm(cid, n) {
    _termN = Number(n) || _termN;
  }

  /* ── A fixed copy, one student at a time ───────────────────── */
  function renderIssueScreen(cid, id) {
    _issueRec = null;
    _issueIdx = 0;
    var entry = ReportIssues.list(cid).find(function (e) {
      return e.id === id;
    });
    var title = entry ? ReportIssues.label(entry) : 'Issued copy';
    var nav = MC.navBar({ id: 'reports-issue', title: title, backLabel: 'Reports' });
    return (
      '<div class="m-screen" id="m-screen-reports-issue" data-issue="' +
      MC.esc(id) +
      '">' +
      nav +
      '<div class="m-screen-content">' +
      _stepperHtml('', 0, entry ? entry.count : 0) +
      '<div class="m-reports-sheets" id="m-reports-sheets"><div class="m-empty"><div class="m-empty-subtitle">Loading the copy…</div></div></div>' +
      '</div></div>'
    );
  }

  /* Called once the screen is on the page: fetches the copy (this phone
     first, then the server) and shows its first student. */
  function mountIssue(cid, id) {
    return ReportIssues.load(id, cid).then(function (rec) {
      var host = document.getElementById('m-reports-sheets');
      if (!host) return;
      if (!rec || !rec.students || !rec.students.length) {
        host.innerHTML =
          '<div class="m-empty"><div class="m-empty-title">Copy not available</div><div class="m-empty-subtitle">This copy is not on this phone and could not be fetched. Open it on the desktop that issued it.</div></div>';
        return;
      }
      _issueRec = rec;
      _issueIdx = 0;
      _showIssueStudent();
    });
  }

  function _showIssueStudent() {
    var host = document.getElementById('m-reports-sheets');
    var rec = _issueRec;
    if (!host || !rec) return;
    var s = rec.students[_issueIdx];
    var name = s.name || _nameOf(s.sid) || 'Student ' + (_issueIdx + 1);
    host.innerHTML = s.html;
    host.classList.add('report-sheets-on');
    _zoom(host, rec.paper);
    _setStepper(name, _issueIdx, rec.students.length);
    host.scrollTop = 0;
  }

  function stepIssue(dir) {
    if (!_issueRec) return;
    var n = _issueRec.students.length;
    _issueIdx = Math.max(0, Math.min(n - 1, _issueIdx + dir));
    _showIssueStudent();
  }

  function _nameOf(sid) {
    var cid = typeof getActiveCourse === 'function' ? getActiveCourse() : null;
    var st = cid
      ? getStudents(cid).find(function (x) {
          return x.id === sid;
        })
      : null;
    return st ? fullName(st) : '';
  }

  /* ── The live Report Card for one student ──────────────────── */
  function renderLiveScreen(cid, sid) {
    _liveSid = sid;
    var students = sortStudents(getStudents(cid), 'lastName');
    var idx = students.findIndex(function (s) {
      return s.id === sid;
    });
    var st = students[idx];
    var nav = MC.navBar({ id: 'reports-live', title: _current(cid).label, backLabel: 'Reports' });
    return (
      '<div class="m-screen" id="m-screen-reports-live">' +
      nav +
      '<div class="m-screen-content">' +
      _stepperHtml(st ? fullName(st) : '', Math.max(0, idx), students.length) +
      '<div class="m-reports-sheets" id="m-reports-sheets"></div>' +
      '</div></div>'
    );
  }

  /* Lays the student's sheets out in the host, as the desktop would. */
  function mountLive(cid) {
    var host = document.getElementById('m-reports-sheets');
    if (!host) return;
    var students = sortStudents(getStudents(cid), 'lastName');
    var st = students.find(function (s) {
      return s.id === _liveSid;
    });
    if (!st) return;
    var summary = ReportSheets.renderPreview({
      preview: host,
      cid: cid,
      students: [st],
      ctx: _ctx(cid),
      form: _form(cid),
      paper: _paper(cid),
    });
    var per = summary.perStudent[st.id];
    _setStepper(fullName(st), students.indexOf(st), students.length, per ? per.badge : '');
    host.scrollTop = 0;
  }

  function stepLive(cid, dir) {
    var students = sortStudents(getStudents(cid), 'lastName');
    var idx = students.findIndex(function (s) {
      return s.id === _liveSid;
    });
    var next = Math.max(0, Math.min(students.length - 1, idx + dir));
    if (next === idx) return;
    _liveSid = students[next].id;
    mountLive(cid);
  }

  /* ── Shared bits ───────────────────────────────────────────── */
  function _stepperHtml(name, idx, total) {
    return (
      '<div class="m-reports-stepper" id="m-reports-stepper">' +
      '<button class="m-reports-step" data-action="m-reports-step" data-dir="-1" aria-label="Previous student">' +
      MC.ICONS.chevronLeft +
      '</button>' +
      '<div class="m-reports-who"><div class="m-reports-name" id="m-reports-name">' +
      MC.esc(name) +
      '</div><div class="m-reports-count" id="m-reports-count">' +
      (total ? idx + 1 + ' of ' + total : '') +
      '</div></div>' +
      '<button class="m-reports-step" data-action="m-reports-step" data-dir="1" aria-label="Next student">' +
      MC.ICONS.chevronRight +
      '</button>' +
      '</div>'
    );
  }

  function _setStepper(name, idx, total, badge) {
    var n = document.getElementById('m-reports-name');
    var c = document.getElementById('m-reports-count');
    if (n) n.textContent = name;
    if (c) c.textContent = idx + 1 + ' of ' + total + (badge ? ' · ' + badge : '');
  }

  /* The sheets are 8.5 in wide; scale them to the phone. */
  function _zoom(host, paper) {
    var sheetW = (paper === 'legal' ? 8.5 : 8.5) * 96;
    var avail = Math.max(240, host.clientWidth - 8);
    host.style.setProperty('--sheet-zoom', String(Math.round(Math.min(1, avail / sheetW) * 1000) / 1000));
  }

  return {
    renderList: renderList,
    setTerm: setTerm,
    renderIssueScreen: renderIssueScreen,
    mountIssue: mountIssue,
    stepIssue: stepIssue,
    renderLiveScreen: renderLiveScreen,
    mountLive: mountLive,
    stepLive: stepLive,
  };
})();
