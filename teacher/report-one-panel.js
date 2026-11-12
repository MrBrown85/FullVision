/* report-one-panel.js — One Report's panel: the Setup, who a change
   applies to, the parts on the report in print order (a switch each, drag
   to reorder, options under the name), the Feedback Pages and Add a Part.
   It reads and changes the model only through ReportOne and the api
   page-reports.js gives it (_oneApi). docs/plans/one-report-build-plan.md. */
window.ReportOnePanel = (function () {
  'use strict';

  var _api = null; // () => api, set at mount
  var _open = {}; // parts whose options are open
  var _fold = { add: true }; // sections folded shut

  function _row(m, key, api, sid) {
    var on = ReportOne.isOn(m, key, sid);
    var opts = on ? ReportOne.optionsFor(m, key, api.cid) : [];
    var label = ReportOne.label(key, api.cid);
    return (
      '<div class="one-row' +
      (on ? ' on' : '') +
      '" data-part="' +
      esc(key) +
      '"><button type="button" class="one-name" data-action="oneOpen" data-part="' +
      esc(key) +
      '"' +
      (opts.length ? ' aria-expanded="' + !!_open[key] + '"' : '') +
      '>' +
      esc(label) +
      '</button><button type="button" class="gr-switch" role="switch" aria-checked="' +
      on +
      '" aria-label="' +
      esc(label) +
      '" data-action="oneSwitch" data-part="' +
      esc(key) +
      '"' +
      (key === 'header' ? ' disabled' : '') +
      '><span class="gr-switch-knob"></span></button></div>'
    );
  }

  function render(palette, api) {
    var m = api.model();
    var sid = api.scope();
    var on = ReportOne.order(m, sid).filter(function (k) {
      return ReportOne.available(k, api.cid);
    });
    var html = '<div class="one-panel">';
    html +=
      '<div class="one-setups">' +
      ReportOne.SETUPS.map(function (s) {
        return (
          '<button type="button" class="seg-btn' +
          (m.setup === s.id ? ' active' : '') +
          '" data-action="oneSetup" data-value="' +
          s.id +
          '">' +
          esc(s.name) +
          '</button>'
        );
      }).join('') +
      '</div>';
    html += '<h4>On the Report</h4><div class="one-list">';
    on.forEach(function (k) {
      html += _row(m, k, api, sid);
    });
    html += '</div><h4>Feedback Pages</h4><div class="one-list">';
    ReportOne.FEEDBACK.forEach(function (f) {
      html += _row(m, f.key, api, sid);
    });
    html += '</div><h4>Add a Part</h4><div class="one-list">';
    ReportOne.offParts(m, api.cid, sid).forEach(function (k) {
      html += _row(m, k, api, sid);
    });
    html += '</div></div>';
    // html-safe: labels are registry labels through esc(); keys are registry keys
    palette.innerHTML = html;
  }

  function mount(palette, apiFn) {
    _api = apiFn;
  }

  function handle(action, el, api) {
    var m = api.model();
    var key = el.dataset.part;
    if (action === 'oneSwitch') {
      var on = !ReportOne.isOn(m, key, api.scope());
      api.set(ReportOne.setOn(m, key, on, api.scope()), (on ? 'Added ' : 'Removed ') + ReportOne.label(key, api.cid));
      return true;
    }
    if (action === 'oneSetup') {
      api.set(ReportOne.fromSetup(el.dataset.value), 'Changed the Setup');
      return true;
    }
    if (action === 'oneOpen') {
      _open[key] = !_open[key];
      api.redraw();
      return true;
    }
    return false;
  }

  function change() {
    return false;
  }

  /* The line over the pages: sheets for the student on the canvas and for
     the class. */
  function fitHtml(api) {
    var fit = api.fit();
    if (!fit) return '';
    var st = api.student();
    var per = st && fit.perStudent[st.id];
    var text = per
      ? per.sheets + (per.sheets === 1 ? ' sheet' : ' sheets') + ' for ' + esc(displayNameFirst(st)) + ' · '
      : '';
    text += fit.sheets + (fit.sheets === 1 ? ' sheet' : ' sheets') + ' for the class';
    return text;
  }

  return { mount: mount, render: render, handle: handle, change: change, fitHtml: fitHtml };
})();
