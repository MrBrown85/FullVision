/* The phone report on the student page (canvas R1–R4): Your Report Is
   Ready, with the birthday check, and the report itself
   (shared/phone-report-view.js). Moved out of student.js, which holds the
   code box, the edge function and Demo Mode's sample report, and loads
   first. This file adds its screens with StudentPage.addScreens. */
(function () {
  'use strict';

  // A copy of student.js from before the split holds these screens itself.
  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var MESSAGES = StudentPage.MESSAGES;
  var className = StudentPage.className;
  var fmtDate = StudentPage.fmtDate;
  var header = StudentPage.header;
  var birthdayPickers = StudentPage.birthdayPickers;
  var call = StudentPage.call;
  var messageFor = StudentPage.messageFor;
  var demoReport = StudentPage.demoReport;
  var paint = StudentPage.paint;

  // The page's state and its #app: student.js's own, handed over by share.
  var S = null;
  var root = null;

  /* ── Phone reports (canvas R1–R4) ──────────────────────────── */

  function reportSub(d) {
    return d.report && d.report.title ? d.report.title : 'Report';
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
      (state.back
        ? '<div class="sp-report-back"><button type="button" class="sp-btn sp-btn-line" data-act="page-back">Back to Your Page</button></div>'
        : '') +
      (typeof PhoneReportView !== 'undefined' ? PhoneReportView.html(state.report) : '') +
      '</div>'
    );
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

  function onClick(act) {
    if (act === 'rcheck') {
      checkBirthday();
    }
  }

  StudentPage.addScreens({
    file: 'report',
    render: { rcheck: renderRCheck, report: renderReport },
    click: onClick,
    share: function (state, el) {
      S = state;
      root = el;
    },
  });
})();
