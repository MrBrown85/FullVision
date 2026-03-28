/* page-mobile.js — Mobile companion app shell
   Manages tab bar, navigation stacks, and event delegation */

(function() {
  'use strict';

  var MC = window.MComponents;
  var _activeTab = 'students';
  var _navStacks = { students: [], observe: [], grade: [] };
  var _cid = null;
  var _searchTimer = null;

  /* ── Boot ───────────────────────────────────────────────────── */
  async function boot() {
    // Check auth: show login screen or proceed to app
    var hasSession = false;
    try {
      var sb = typeof getSupabase === 'function' ? getSupabase() : null;
      if (sb) {
        var result = await sb.auth.getSession();
        hasSession = !!(result && result.data && result.data.session);
      } else {
        // Local dev — no Supabase, skip auth
        hasSession = true;
      }
    } catch(e) {
      console.warn('Auth check failed:', e);
      hasSession = true; // Local dev fallback
    }

    if (!hasSession) {
      _showAuth();
      return; // Don't boot app — wait for sign-in
    }

    _hideAuth();
    // Clear history so browser back gesture can't return to login
    history.replaceState(null, '', location.pathname);
    await _bootApp();
  }

  async function _bootApp() {
    await initAllCourses();
    _cid = getActiveCourse();
    await initData(_cid);
    if (typeof loadSeedIfNeeded === 'function') loadSeedIfNeeded();
    if (typeof migrateAllStudents === 'function') migrateAllStudents();

    MC.setupOfflineDetection();
    _renderTab('students');
    _bindEvents();
  }

  /* ── Auth screen ──────────────────────────────────────────── */
  function _showAuth() {
    var auth = document.getElementById('m-auth');
    var app = document.getElementById('m-app');
    if (auth) auth.style.display = '';
    if (app) app.style.display = 'none';
    _bindAuthEvents();
  }

  function _hideAuth() {
    var auth = document.getElementById('m-auth');
    var app = document.getElementById('m-app');
    if (auth) {
      auth.classList.add('m-auth-exit');
      setTimeout(function() { auth.style.display = 'none'; }, 300);
    }
    if (app) app.style.display = '';
  }

  function _authError(msg) {
    var el = document.getElementById('m-auth-error');
    var success = document.getElementById('m-auth-success');
    if (el) { el.textContent = msg; el.classList.add('visible'); }
    if (success) success.classList.remove('visible');
  }

  function _authSuccess(msg) {
    var el = document.getElementById('m-auth-success');
    var err = document.getElementById('m-auth-error');
    if (el) { el.textContent = msg; el.classList.add('visible'); }
    if (err) err.classList.remove('visible');
  }

  function _authClearMessages() {
    var err = document.getElementById('m-auth-error');
    var success = document.getElementById('m-auth-success');
    if (err) err.classList.remove('visible');
    if (success) success.classList.remove('visible');
  }

  function _bindAuthEvents() {
    // Tab switching
    document.addEventListener('click', function _authClick(e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');

      if (action === 'm-auth-tab') {
        var tab = target.getAttribute('data-tab');
        var isSignIn = tab === 'signin';
        document.getElementById('m-form-signin').style.display = isSignIn ? '' : 'none';
        document.getElementById('m-form-signup').style.display = isSignIn ? 'none' : '';
        document.querySelectorAll('.m-auth-tabs .m-seg-btn').forEach(function(btn) {
          var active = btn.getAttribute('data-tab') === tab;
          btn.classList.toggle('m-seg-active', active);
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        _authClearMessages();
      }

      if (action === 'm-auth-forgot') {
        e.preventDefault();
        _handleForgot();
      }
    });

    // Sign In form
    var signInForm = document.getElementById('m-form-signin');
    if (signInForm) {
      signInForm.addEventListener('submit', function(e) {
        e.preventDefault();
        _handleSignIn();
      });
    }

    // Sign Up form
    var signUpForm = document.getElementById('m-form-signup');
    if (signUpForm) {
      signUpForm.addEventListener('submit', function(e) {
        e.preventDefault();
        _handleSignUp();
      });
    }
  }

  async function _handleSignIn() {
    _authClearMessages();
    var btn = document.getElementById('m-si-submit');
    var email = (document.getElementById('m-si-email') || {}).value || '';
    var password = (document.getElementById('m-si-password') || {}).value || '';
    if (!email.trim() || !password) { _authError('Please enter email and password.'); return; }
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      await signIn(email.trim(), password);
      _hideAuth();
      // Clear history so browser back gesture can't return to login
      history.replaceState(null, '', location.pathname);
      await _bootApp();
    } catch(err) {
      _authError(err.message || 'Sign in failed. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  async function _handleSignUp() {
    _authClearMessages();
    var password = (document.getElementById('m-su-password') || {}).value || '';
    var confirm = (document.getElementById('m-su-confirm') || {}).value || '';
    if (password !== confirm) { _authError('Passwords do not match.'); return; }
    var btn = document.getElementById('m-su-submit');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    try {
      var name = (document.getElementById('m-su-name') || {}).value || '';
      var email = (document.getElementById('m-su-email') || {}).value || '';
      await signUp(email.trim(), password, name.trim());
      _authSuccess('Check your email for a confirmation link.');
      btn.textContent = 'Account Created';
      setTimeout(function() { btn.disabled = false; btn.textContent = 'Create Account'; }, 4000);
    } catch(err) {
      _authError(err.message || 'Sign up failed. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  }

  async function _handleForgot() {
    _authClearMessages();
    var email = (document.getElementById('m-si-email') || {}).value || '';
    if (!email.trim()) { _authError('Enter your email address first, then tap "Forgot password?"'); return; }
    try {
      var sb = getSupabase();
      var result = await sb.auth.resetPasswordForEmail(email.trim());
      if (result.error) throw result.error;
      _authSuccess('Password reset email sent. Check your inbox.');
    } catch(err) {
      _authError(err.message || 'Could not send reset email.');
    }
  }

  /* ── Tab switching ──────────────────────────────────────────── */
  function _switchTab(tab) {
    if (tab === _activeTab) return;
    _activeTab = tab;

    // Update tab bar active state
    document.querySelectorAll('.m-tab-item').forEach(function(t) {
      var isActive = t.getAttribute('data-tab') === tab;
      t.classList.toggle('m-tab-active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) t.querySelector('.m-tab-icon').style.fill = 'var(--active)';
      else t.querySelector('.m-tab-icon').style.fill = 'none';
    });

    _renderTab(tab);
  }

  function _renderTab(tab) {
    // Clean up previous tab's resources
    if (MStudents.destroyCardStack) MStudents.destroyCardStack();

    var stack = document.getElementById('m-nav-stack');
    stack.innerHTML = '';
    _navStacks[tab] = [];

    var html;
    if (tab === 'students') {
      html = MStudents.renderList(_cid);
    } else if (tab === 'observe') {
      html = MObserve.renderFeed(_cid);
    } else if (tab === 'grade') {
      html = MGrade.renderPicker(_cid);
    }

    stack.innerHTML = html;
    _navStacks[tab].push(tab);

    // Setup scroll → large title collapse
    var screen = stack.querySelector('.m-screen');
    if (screen) {
      var navBarId = screen.querySelector('.m-nav-bar') ? screen.querySelector('.m-nav-bar').id : null;
      if (navBarId) MC.setupScrollTitle(screen, navBarId);
    }

    // Initialize card stack for students tab
    if (tab === 'students' && MStudents.initCardStack) {
      MStudents.initCardStack(_cid);
    }
  }

  /* ── Push/pop screens ───────────────────────────────────────── */
  function _pushScreen(html) {
    var stack = document.getElementById('m-nav-stack');
    var current = stack.querySelector('.m-screen:last-child');

    // Insert new screen
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var newScreen = tmp.firstElementChild;
    newScreen.classList.add('m-push-enter');
    stack.appendChild(newScreen);

    // Animate
    requestAnimationFrame(function() {
      if (current) current.classList.add('m-push-exit-active');
      newScreen.classList.remove('m-push-enter', 'm-screen-hidden');
      newScreen.classList.add('m-push-enter-active');

      setTimeout(function() {
        if (current) {
          current.classList.remove('m-push-exit-active');
          current.style.display = 'none';
        }
        newScreen.classList.remove('m-push-enter-active');
        _navStacks[_activeTab].push('detail');

        // Setup scroll for new screen
        var navBar = newScreen.querySelector('.m-nav-bar');
        if (navBar) MC.setupScrollTitle(newScreen, navBar.id);
      }, 360);
    });
  }

  function _popScreen() {
    var stack = document.getElementById('m-nav-stack');
    var screens = stack.querySelectorAll('.m-screen');
    if (screens.length < 2) return;

    var top = screens[screens.length - 1];
    var below = screens[screens.length - 2];

    below.style.display = '';
    below.classList.add('m-pop-enter');
    top.classList.add('m-pop-exit-active');

    requestAnimationFrame(function() {
      below.classList.remove('m-pop-enter');
      below.classList.add('m-pop-enter-active');

      setTimeout(function() {
        top.remove();
        below.classList.remove('m-pop-enter-active');
        _navStacks[_activeTab].pop();
      }, 360);
    });
  }

  /* ── Event delegation ───────────────────────────────────────── */
  function _bindEvents() {
    document.addEventListener('click', function(e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');

      // Tab bar
      if (action === 'm-tab') {
        // Handled by tab-item click below
        return;
      }

      // Navigation
      if (action === 'm-back') {
        _popScreen();
        return;
      }

      // Settings sheet (course switcher + sign out + switch to desktop)
      if (action === 'm-settings') {
        var courseOpts = Object.keys(COURSES).map(function(id) {
          var c = COURSES[id];
          return '<option value="' + id + '"' + (id === _cid ? ' selected' : '') + '>' + MC.esc(c.name) + '</option>';
        }).join('');
        var hasCourses = Object.keys(COURSES).length > 1;
        MC.presentSheet(
          '<div style="padding:8px 0 16px">' +
            '<div style="font-size:17px;font-weight:600;text-align:center;margin-bottom:16px">Settings</div>' +
            (hasCourses ? '<div style="margin-bottom:16px">' +
              '<div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-3);margin-bottom:6px">Active Class</div>' +
              '<select id="m-course-select" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);font-size:17px;font-family:inherit;background:var(--surface);color:var(--text)">' + courseOpts + '</select>' +
            '</div>' : '') +
            '<button class="m-btn-primary" style="background:var(--surface);color:var(--text);border:1px solid var(--border)" data-action="m-switch-desktop">Switch to Desktop</button>' +
            '<button class="m-btn-primary" style="background:none;color:var(--score-1);border:none;margin-top:4px" data-action="m-sign-out">Sign Out</button>' +
            '<button style="width:100%;padding:14px;border:none;background:none;font-size:17px;color:var(--active);font-family:inherit;cursor:pointer;margin-top:4px" data-action="m-dismiss-sheet">Cancel</button>' +
          '</div>'
        );
        // Wire course select change
        var courseSelect = document.getElementById('m-course-select');
        if (courseSelect) {
          courseSelect.addEventListener('change', function() {
            var newCid = this.value;
            if (newCid && newCid !== _cid) {
              _cid = newCid;
              setActiveCourse(newCid);
              initData(newCid).then(function() {
                MC.dismissSheet();
                _renderTab(_activeTab);
              });
            }
          });
        }
        return;
      }

      if (action === 'm-switch-desktop') {
        localStorage.setItem('td-mobile-pref', 'desktop');
        window.location.href = '/teacher/app.html';
        return;
      }

      if (action === 'm-sign-out') {
        MC.dismissSheet();
        if (typeof signOut === 'function') signOut();
        else window.location.href = '/login.html';
        return;
      }

      if (action === 'm-dismiss-sheet') {
        MC.dismissSheet();
        return;
      }

      // ── Students tab ──
      if (action === 'm-student-detail') {
        var sid = target.getAttribute('data-sid');
        var html = MStudents.renderDetail(_cid, sid);
        _pushScreen(html);
        return;
      }

      if (action === 'm-student-search') {
        // Handled by input event below
        return;
      }

      if (action === 'm-toggle-section') {
        var card = target.closest('.m-section-card');
        if (card) {
          card.classList.toggle('m-expanded');
          card.setAttribute('aria-expanded', card.classList.contains('m-expanded'));
        }
        return;
      }

      // ── Observations tab ──
      if (action === 'm-obs-new') {
        MObserve.resetSheetState();
        MObserve.presentNewObsSheet(_cid);
        return;
      }

      if (action === 'm-obs-quick-menu') {
        var qmSid = target.getAttribute('data-sid');
        MObserve.presentQuickMenu(_cid, qmSid);
        return;
      }

      if (action === 'm-obs-quick-post') {
        var qpSid = target.getAttribute('data-sid');
        var tmplKey = target.getAttribute('data-template');
        MObserve.quickPost(_cid, qpSid, tmplKey);
        return;
      }

      if (action === 'm-obs-quick-compose') {
        var qcSid = target.getAttribute('data-sid');
        MC.dismissSheet();
        setTimeout(function() {
          MObserve.resetSheetState();
          MObserve.presentNewObsSheet(_cid);
          // Pre-select the student
          MObserve.selectStudent(qcSid);
        }, 400);
        return;
      }

      if (action === 'm-obs-filter') {
        var filter = target.getAttribute('data-filter');
        MObserve.applyFilter(_cid, filter);
        return;
      }

      if (action === 'm-obs-pick-student') {
        MObserve.toggleStudentPicker();
        return;
      }

      if (action === 'm-obs-select-student') {
        var stuId = target.getAttribute('data-sid');
        MObserve.selectStudent(stuId);
        return;
      }

      if (action === 'm-obs-remove-student') {
        e.stopPropagation();
        var rmId = target.getAttribute('data-sid');
        MObserve.selectStudent(rmId); // toggle off
        return;
      }

      if (action === 'm-obs-sentiment') {
        MObserve.setSentiment(target.getAttribute('data-val'));
        return;
      }

      if (action === 'm-obs-context') {
        MObserve.setContext(target.getAttribute('data-val'));
        return;
      }

      if (action === 'm-obs-dim') {
        MObserve.toggleDim(target.getAttribute('data-val'));
        return;
      }

      if (action === 'm-obs-save') {
        MObserve.saveObservation(_cid);
        return;
      }

      // ── Grade tab ──
      if (action === 'm-grade-seg') {
        MGrade.filterAssessments(_cid, target.getAttribute('data-val'));
        return;
      }

      if (action === 'm-grade-assess') {
        var aid = target.closest('[data-aid]').getAttribute('data-aid');
        var swiperHTML = MGrade.renderSwiper(_cid, aid);
        _pushScreen(swiperHTML);
        setTimeout(function() { MGrade.setupSwiper(_cid, aid); }, 400);
        return;
      }

      if (action === 'm-grade-score') {
        var scoreBtn = target.closest('[data-score]');
        var score = parseInt(scoreBtn.getAttribute('data-score'));
        var sSid = scoreBtn.getAttribute('data-sid');
        var sAid = scoreBtn.getAttribute('data-aid');
        var sTid = scoreBtn.getAttribute('data-tid');
        MGrade.setScore(_cid, sSid, sAid, sTid, score);
        return;
      }

      if (action === 'm-grade-points-inc' || action === 'm-grade-points-dec') {
        var pBtn = target.closest('[data-sid]');
        var delta = action === 'm-grade-points-inc' ? 1 : -1;
        MGrade.adjustPointsScore(_cid, pBtn.getAttribute('data-sid'), pBtn.getAttribute('data-aid'), delta, parseInt(pBtn.getAttribute('data-max'), 10));
        return;
      }

      if (action === 'm-grade-status') {
        var stBtn = target.closest('[data-val]');
        MGrade.setStatus(_cid, stBtn.getAttribute('data-sid'), stBtn.getAttribute('data-aid'), stBtn.getAttribute('data-val'));
        return;
      }

      if (action === 'm-grade-jump') {
        var idx = parseInt(target.getAttribute('data-idx'));
        MGrade.jumpToStudent(idx);
        return;
      }
    });

    // Tab bar clicks
    document.getElementById('m-tab-bar').addEventListener('click', function(e) {
      var tab = e.target.closest('.m-tab-item');
      if (!tab) return;
      _switchTab(tab.getAttribute('data-tab'));
    });

    // Search input
    document.addEventListener('input', function(e) {
      if (e.target.matches('[data-action="m-student-search"]')) {
        MStudents.filterList(e.target.value);
      }
      if (e.target.matches('[data-action="m-obs-student-search"]')) {
        clearTimeout(_searchTimer);
        var val = e.target.value;
        _searchTimer = setTimeout(function() { MObserve.filterStudentPicker(val); }, 150);
      }
      if (e.target.matches('#m-obs-text')) {
        MObserve.updateSubmitState();
      }
    });

    // Keyboard handling for textarea in sheet
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        MC.dismissSheet();
      }
    });
  }

  /* ── Auto-boot ──────────────────────────────────────────────── */
  boot();
})();
