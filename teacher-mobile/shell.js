/* page-mobile.js — Mobile companion app shell
   Manages tab bar, navigation stacks, and event delegation */

(function () {
  'use strict';

  var MC = window.MComponents;
  var APP_VERSION = '1.0';
  var _activeTab = 'students';
  var _navStacks = { students: [], observe: [], grade: [] };
  // Where each tab was left: scroll, card, and the screens open on it.
  var _tabState = { students: null, observe: null, grade: null };
  var _cid = null;
  var _searchTimer = null;
  // The student whose page opened the current grading screen (Grade button).
  var _gradeReturnSid = null;
  var _userEmail = '';
  var _userName = '';
  // Set when Back here calls history.back(), so that popstate is not a
  // second Back.
  var _ignorePop = false;
  // A swipe back in progress.
  var _swipeActive = false;

  /* ── Boot ───────────────────────────────────────────────────── */
  async function boot() {
    // Check auth: show login screen or proceed to app
    var hasSession = false;
    try {
      var sb = typeof getSupabase === 'function' ? getSupabase() : null;
      // Demo Mode runs local-only, like the desktop app's requireAuth: with
      // Supabase configured it used to land on the sign-in screen.
      if (typeof isDemoMode === 'function' && isDemoMode()) {
        hasSession = true;
        _userName = 'Demo Teacher';
      } else if (sb) {
        var result = await sb.auth.getSession();
        hasSession = !!(result && result.data && result.data.session);
        if (hasSession && result.data.session.user) {
          _userEmail = result.data.session.user.email || '';
          _userName =
            (result.data.session.user.user_metadata && result.data.session.user.user_metadata.display_name) || '';
        }
      } else {
        // Local dev — no Supabase, skip auth
        hasSession = true;
      }
    } catch (e) {
      console.warn('Auth check failed:', e);
      // Do not grant session on network error — show auth screen so the
      // teacher can sign in once connectivity is restored.
    }

    if (!hasSession) {
      _showAuth();
      return; // Don't boot app — wait for sign-in
    }

    _hideAuth();
    _resetHistory();
    await _bootApp();
  }

  async function _bootApp() {
    await initAllCourses();
    _cid = getActiveCourse();
    await initData(_cid);
    if (typeof loadSeedIfNeeded === 'function') await loadSeedIfNeeded();
    if (typeof migrateAllStudents === 'function') migrateAllStudents();

    MC.setupOfflineDetection();
    _renderTab('students');
    _bindEvents();
    _bindEdgeSwipe();

    _hideLoader();
    _initPullToRefresh();
    // The teacher's other classes load in the background, so switching to
    // one doesn't start from nothing.
    if (typeof preloadClasses === 'function') {
      var preload = function () {
        preloadClasses();
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 3000 });
      else setTimeout(preload, 1500);
    }

    // Register mobile re-render callback for cross-device sync
    if (window.GB && window.GB.registerMobileRerender) {
      window.GB.registerMobileRerender(function () {
        // A sweep in progress redraws in place instead of losing its place.
        if (_activeTab === 'observe' && MSweep.isOpen()) {
          MSweep.refresh();
          return;
        }
        _rerenderActiveTab();
      });
    }
  }

  /* ── History ─────────────────────────────────────────────────
     The app's root entry, then a guard entry: a back press at the root
     lands on the root entry and the guard is put back, so the browser never
     leaves the app. Each pushed screen adds an entry {m: depth}. */
  function _resetHistory() {
    history.replaceState({ m: 0 }, '', location.pathname);
    history.pushState({ m: 0, guard: true }, '');
  }

  /* ── Pull to refresh ───────────────────────────────────────────
     On a list at its top, a pull brings the content down with the finger
     (with resistance) and grows the spinner; past the threshold a release
     reloads the class while the content waits, then it springs back. Not on
     the card stack, which has its own gestures. */
  var PULL_THRESHOLD = 70;
  var PULL_HOLD = 48;
  var _pull = null; // { content, startX, startY, decided, on, dy }
  var _pullIndicator = null;
  var _refreshing = false;

  var _pullToRefreshInitialized = false;
  function _initPullToRefresh() {
    if (_pullToRefreshInitialized) return;
    _pullToRefreshInitialized = true;
    document.addEventListener(
      'touchstart',
      function (e) {
        _pull = null;
        if (_refreshing) return;
        var content = e.target.closest('.m-screen-content');
        if (!content || content.scrollTop > 0) return;
        if (e.target.closest('.m-card-stack')) return;
        if (!document.getElementById('m-sheet-backdrop').classList.contains('u-hidden')) return;
        _pull = {
          content: content,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          decided: false,
          on: false,
          dy: 0,
        };
      },
      { passive: true },
    );

    document.addEventListener(
      'touchmove',
      function (e) {
        if (!_pull) return;
        var dx = e.touches[0].clientX - _pull.startX;
        var dy = e.touches[0].clientY - _pull.startY;
        if (!_pull.decided) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          _pull.decided = true;
          if (dy <= 0 || Math.abs(dx) > dy || _pull.content.scrollTop > 0) {
            _pull = null;
            return;
          }
          _pull.on = true;
          _pull.content.classList.add('m-pulling');
          _showPullIndicator();
        }
        if (!_pull.on) return;
        e.preventDefault();
        // Resistance: the content moves less and less as the pull grows.
        var pull = Math.min(120, Math.max(0, dy) * 0.5);
        _pull.dy = pull;
        _pull.content.style.transform = 'translateY(' + pull + 'px)';
        _pullIndicator.style.height = pull + 'px';
        _pullIndicator.classList.toggle('m-pull-ready', pull >= PULL_THRESHOLD);
        _pullIndicator.style.setProperty('--m-pull', String(Math.min(1, pull / PULL_THRESHOLD)));
      },
      { passive: false },
    );

    document.addEventListener(
      'touchend',
      function () {
        if (!_pull || !_pull.on) {
          _pull = null;
          return;
        }
        var p = _pull;
        _pull = null;
        p.content.classList.remove('m-pulling');
        if (p.dy >= PULL_THRESHOLD) {
          _settlePull(p.content, PULL_HOLD);
          _doRefresh().then(function () {
            _settlePull(p.content, 0);
          });
        } else {
          _settlePull(p.content, 0);
        }
      },
      { passive: true },
    );
  }

  function _showPullIndicator() {
    if (!_pullIndicator) {
      _pullIndicator = document.createElement('div');
      _pullIndicator.className = 'm-pull-indicator';
      _pullIndicator.innerHTML = '<span class="m-pull-spinner"></span>';
      document.getElementById('m-app').prepend(_pullIndicator);
    }
    _pullIndicator.classList.remove('m-pull-settle');
  }

  // The content and the spinner ease to `px` down (0 = back in place).
  function _settlePull(content, px) {
    content.classList.add('m-pull-settle');
    content.style.transform = px ? 'translateY(' + px + 'px)' : '';
    if (_pullIndicator) {
      _pullIndicator.classList.add('m-pull-settle');
      _pullIndicator.style.height = px + 'px';
      _pullIndicator.classList.toggle('m-pull-ready', px > 0);
      _pullIndicator.style.setProperty('--m-pull', px ? '1' : '0');
    }
    setTimeout(function () {
      content.classList.remove('m-pull-settle');
    }, 300);
  }

  async function _doRefresh() {
    _refreshing = true;
    try {
      // refreshFromSupabase was removed, so this used to reload nothing and
      // still say "Synced". It now reloads the class and reports the result.
      var timeout = new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('timeout'));
        }, 8000);
      });
      await Promise.race([retryActiveCourseLoad(), timeout]);
      if (courseLoadFailed(getActiveCourse())) throw new Error('could not reach the server');
    } catch (e) {
      console.warn('Pull-to-refresh error:', e);
      var msg = e.message === 'timeout' ? 'Sync timed out' : 'Refresh failed — ' + (e.message || 'unknown error');
      MC.showToast(msg);
    }
    _refreshing = false;
  }

  /* ── Auth screen ──────────────────────────────────────────── */
  function _hideLoader() {
    var el = document.getElementById('m-loading');
    if (!el || el.style.display === 'none') return;
    el.classList.add('m-loading-fade');
    setTimeout(function () {
      el.style.display = 'none';
    }, 250);
  }

  function _showAuth() {
    _hideLoader();
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
      setTimeout(function () {
        auth.style.display = 'none';
      }, 300);
    }
    if (app) app.style.display = '';
  }

  function _authError(msg) {
    var el = document.getElementById('m-auth-error');
    var success = document.getElementById('m-auth-success');
    if (el) {
      el.textContent = msg;
      el.classList.add('visible');
    }
    if (success) success.classList.remove('visible');
  }

  function _authSuccess(msg) {
    var el = document.getElementById('m-auth-success');
    var err = document.getElementById('m-auth-error');
    if (el) {
      el.textContent = msg;
      el.classList.add('visible');
    }
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
        _authShowTab(target.getAttribute('data-tab'));
      }

      if (action === 'm-auth-forgot') {
        e.preventDefault();
        _handleForgot();
      }

      if (action === 'm-inbox-change-email') {
        _leaveInbox('signup');
        document.getElementById('m-su-email').select();
      }

      if (action === 'm-inbox-signin') {
        _leaveInbox('signin');
        document.getElementById('m-si-email').value = _inboxEmail;
        document.getElementById('m-si-password').focus();
      }

      if (action === 'm-enter-demo-mode') {
        e.preventDefault();
        // Same steps as login.html's Try Demo Mode; this page boots into it.
        if (startDemoMode({ confirm: true })) location.reload();
      }
    });

    // Sign In form
    var signInForm = document.getElementById('m-form-signin');
    if (signInForm) {
      signInForm.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleSignIn();
      });
    }

    // Sign Up form
    var signUpForm = document.getElementById('m-form-signup');
    if (signUpForm) {
      signUpForm.addEventListener('submit', function (e) {
        e.preventDefault();
        _handleSignUp();
      });
    }
  }

  function _authShowTab(tab) {
    var isSignIn = tab === 'signin';
    document.getElementById('m-form-signin').hidden = !isSignIn;
    document.getElementById('m-form-signup').hidden = isSignIn;
    document.querySelectorAll('.m-auth-tabs .m-seg-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('m-seg-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    _authClearMessages();
  }

  /* Check Your Inbox, after Create Account or a sign-in refused because the
   * address isn't confirmed yet. The steps live in shared/sign-in.js. */
  var _stopInbox = null;
  var _inboxEmail = '';

  function _setAuthFormsHidden(hidden) {
    document.querySelector('.m-auth-tabs').hidden = hidden;
    document.querySelector('.m-auth-demo').hidden = hidden;
    if (hidden) {
      document.getElementById('m-form-signin').hidden = true;
      document.getElementById('m-form-signup').hidden = true;
    }
  }

  function _showInbox(email, justSent) {
    _inboxEmail = email;
    _setAuthFormsHidden(true);
    document.getElementById('m-panel-inbox').hidden = false;
    if (_stopInbox) _stopInbox();
    _stopInbox = startCheckInbox({
      email: email,
      justSent: justSent,
      emailEl: document.getElementById('m-inbox-email'),
      resendBtn: document.getElementById('m-inbox-resend'),
      showSuccess: _authSuccess,
      showError: _authError,
      clearMessages: _authClearMessages,
      onSignedIn: _enterApp,
    });
    document.getElementById('m-inbox-title').focus();
  }

  function _leaveInbox(tab) {
    if (_stopInbox) _stopInbox();
    _stopInbox = null;
    document.getElementById('m-panel-inbox').hidden = true;
    _setAuthFormsHidden(false);
    _authShowTab(tab);
  }

  /* Into the app once signed in. An account set to be deleted asks Restore
   * Account first, as on login.html. Returns false if the teacher stays out. */
  async function _enterApp(user) {
    var goOn = await promptRestoreAccount(user, _authSuccess);
    if (!goOn) return false;
    if (_stopInbox) _stopInbox();
    _stopInbox = null;
    _hideAuth();
    _resetHistory();
    await _bootApp();
    return true;
  }

  async function _handleSignIn() {
    _authClearMessages();
    var btn = document.getElementById('m-si-submit');
    var email = (document.getElementById('m-si-email') || {}).value || '';
    var password = (document.getElementById('m-si-password') || {}).value || '';
    if (!email.trim() || !password) {
      _authError('Please enter email and password.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      var result = await signIn(email.trim(), password);
      if (!(await _enterApp(result && result.user))) {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
      if (isEmailNotConfirmed(err)) {
        _showInbox(email.trim(), false);
        _authError("Your email isn't confirmed yet. Open the link we sent, or send a new one.");
        return;
      }
      _authError(err.message || 'Sign in failed. Please try again.');
    }
  }

  async function _handleSignUp() {
    _authClearMessages();
    var password = (document.getElementById('m-su-password') || {}).value || '';
    var confirm = (document.getElementById('m-su-confirm') || {}).value || '';
    if (password !== confirm) {
      _authError('Passwords do not match.');
      return;
    }
    var btn = document.getElementById('m-su-submit');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    try {
      var name = (document.getElementById('m-su-name') || {}).value || '';
      var email = (document.getElementById('m-su-email') || {}).value || '';
      email = email.trim();
      var data = await signUp(email, password, name.trim());
      var outcome = signUpOutcome(data);
      btn.disabled = false;
      btn.textContent = 'Create Account';
      if (outcome === 'signed-in') {
        await _enterApp(data.user);
        return;
      }
      if (outcome === 'exists') {
        _authShowTab('signin');
        document.getElementById('m-si-email').value = email;
        document.getElementById('m-si-password').focus();
        _authError('You already have an account with this email. Sign in below.');
        return;
      }
      document.getElementById('m-su-password').value = '';
      document.getElementById('m-su-confirm').value = '';
      _showInbox(email, true);
    } catch (err) {
      _authError(err.message || 'Sign up failed. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  }

  async function _handleForgot() {
    _authClearMessages();
    var email = (document.getElementById('m-si-email') || {}).value || '';
    if (!email.trim()) {
      _authError('Enter your email address first, then tap "Forgot password?"');
      return;
    }
    try {
      var sb = getSupabase();
      var result = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: resetPasswordRedirect() });
      if (result.error) throw result.error;
      _authSuccess('Password reset email sent. Check your inbox.');
    } catch (err) {
      _authError(err.message || 'Could not send reset email.');
    }
  }

  /* ── Tab switching ──────────────────────────────────────────── */
  function _switchTab(tab) {
    if (tab === _activeTab) return;
    _tabState[_activeTab] = _captureTabState();
    _activeTab = tab;
    _gradeReturnSid = null;

    // Update tab bar active state
    document.querySelectorAll('.m-tab-item').forEach(function (t) {
      var isActive = t.getAttribute('data-tab') === tab;
      t.classList.toggle('m-tab-active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) t.querySelector('.m-tab-icon').style.fill = 'var(--active)';
      else t.querySelector('.m-tab-icon').style.fill = 'none';
    });

    _renderTab(tab);
    _restoreTabState(_tabState[tab]);
    _tabState[tab] = null;

    // The tab fades in rather than cutting.
    var root = document.querySelector('#m-nav-stack .m-screen');
    if (root) {
      root.classList.add('m-tab-enter');
      requestAnimationFrame(function () {
        root.classList.add('m-tab-enter-active');
        root.classList.remove('m-tab-enter');
        setTimeout(function () {
          root.classList.remove('m-tab-enter-active');
        }, 220);
      });
    }
  }

  // The active tab, drawn again from the data, in the same place.
  function _rerenderActiveTab() {
    var state = _captureTabState();
    _renderTab(_activeTab);
    _restoreTabState(state);
  }

  /* ── Tab state: each tab stays where it was left ──────────── */
  function _captureTabState() {
    var stack = document.getElementById('m-nav-stack');
    var screens = stack ? stack.querySelectorAll('.m-screen') : [];
    if (!screens.length) return null;
    var content = screens[0].querySelector('.m-screen-content');
    var state = {
      scrollTop: content ? content.scrollTop : 0,
      cardIndex: _activeTab === 'students' && MStudents.getCardIndex ? MStudents.getCardIndex() : 0,
      gradeReturnSid: _gradeReturnSid,
      pushed: [],
    };
    for (var i = 1; i < screens.length; i++) {
      var raw = screens[i].getAttribute('data-restore');
      if (!raw) continue;
      var c = screens[i].querySelector('.m-screen-content');
      state.pushed.push({
        desc: JSON.parse(raw),
        scrollTop: c ? c.scrollTop : 0,
        gradeIndex: MGrade.getCurrentIndex ? MGrade.getCurrentIndex() : 0,
        cardScrolls: MGrade.getCardScrolls ? MGrade.getCardScrolls() : null,
      });
    }
    return state;
  }

  function _restoreTabState(state) {
    if (!state) return;
    var stack = document.getElementById('m-nav-stack');
    var root = stack.querySelector('.m-screen');
    if (!root) return;
    if (state.cardIndex && MStudents.goToCard) MStudents.goToCard(state.cardIndex);
    var content = root.querySelector('.m-screen-content');
    if (content) content.scrollTop = state.scrollTop;
    state.pushed.forEach(_restorePushed);
    _gradeReturnSid = state.gradeReturnSid;
  }

  // A screen that was open on this tab, put back without the slide.
  function _restorePushed(p) {
    var desc = p.desc;
    var html;
    if (desc.kind === 'detail') html = MStudents.renderDetail(_cid, desc.sid);
    else if (desc.kind === 'swiper') html = MGrade.renderSwiper(_cid, desc.aid);
    else if (desc.kind === 'sweep') html = MSweep.render(_cid, { keep: true });
    if (!html) return;
    var stack = document.getElementById('m-nav-stack');
    var below = stack.querySelector('.m-screen:last-child');
    var tmp = document.createElement('div');
    // html-safe: html is MStudents.renderDetail, MGrade.renderSwiper or MSweep.render, each checked to escape its text.
    tmp.innerHTML = html;
    var screen = tmp.firstElementChild;
    screen.classList.remove('m-screen-hidden');
    screen.setAttribute('data-restore', JSON.stringify(desc));
    stack.appendChild(screen);
    if (below) below.style.display = 'none';
    _navStacks[_activeTab].push('detail');
    var navBar = screen.querySelector('.m-nav-bar');
    if (navBar) MC.setupScrollTitle(screen, navBar.id);
    if (desc.kind === 'swiper') {
      MGrade.setupSwiper(_cid, desc.aid);
      MGrade.jumpToStudent(p.gradeIndex, true);
      if (MGrade.setCardScrolls) MGrade.setCardScrolls(p.cardScrolls);
    }
    var content = screen.querySelector('.m-screen-content');
    if (content) content.scrollTop = p.scrollTop;
  }

  /* ── Demo Mode pill ─────────────────────────────────────────
     In Demo Mode each tab's first screen shows the amber Demo Mode pill
     after the class name, as on the desktop top bar. A tap opens a sheet
     with the same items as the desktop panel. */
  var DEMO_PILL_HTML =
    '<button type="button" class="tb-demo-pill m-demo-pill" data-action="m-demo-menu" aria-haspopup="dialog">Demo Mode' +
    '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"/></svg>' +
    '</button>';

  function _addDemoPill(screen) {
    if (!screen || typeof isDemoMode !== 'function' || !isDemoMode()) return;
    var inner = screen.querySelector('.m-nav-bar-inner');
    if (!inner || inner.querySelector('.m-demo-pill')) return;
    var title = inner.querySelector('.m-nav-bar-title-inline');
    // html-safe: DEMO_PILL_HTML is fixed markup.
    if (title) title.insertAdjacentHTML('beforebegin', DEMO_PILL_HTML);
  }

  var DEMO_SECONDARY_STYLE = 'background:var(--surface-2);color:var(--text);border:none';

  function _demoSheetHtml() {
    return '<div class="m-demo-sheet" role="dialog" aria-labelledby="m-demo-title">' + _demoSheetInnerHtml() + '</div>';
  }

  // signOut stopped because changes have not reached the server: say so,
  // in the sheet, with Leave Demo Mode (deletes them) and Cancel.
  function _demoUnsentConfirmHtml(n, href) {
    return (
      '<h2 class="m-demo-title" id="m-demo-title">Unsent Changes</h2>' +
      '<p class="m-demo-text">' +
      MC.esc(window.leaveDemoUnsentText(n)) +
      '</p>' +
      '<button class="m-btn-primary m-demo-reset-confirm" data-action="m-demo-leave-confirm" data-href="' +
      MC.esc(href) +
      '">Leave Demo Mode</button>' +
      '<button class="m-btn-primary" style="' +
      DEMO_SECONDARY_STYLE +
      ';margin-top:8px" data-action="m-demo-reset-cancel">Cancel</button>'
    );
  }

  function _demoResetConfirmHtml() {
    return (
      '<h2 class="m-demo-title" id="m-demo-title">Reset Demo Data</h2>' +
      '<p class="m-demo-text">All classes are deleted and the sample Science 8 class is restored. This cannot be undone.</p>' +
      '<button class="m-btn-primary m-demo-reset-confirm" data-action="m-demo-reset-confirm">Reset</button>' +
      '<button class="m-btn-primary" style="' +
      DEMO_SECONDARY_STYLE +
      ';margin-top:8px" data-action="m-demo-reset-cancel">Cancel</button>'
    );
  }

  function _demoSheetInnerHtml() {
    var secondary = DEMO_SECONDARY_STYLE;
    return (
      '<h2 class="m-demo-title" id="m-demo-title">Demo Mode</h2>' +
      '<p class="m-demo-text">A sample Science 8 class. Nothing is saved to an account.</p>' +
      '<button class="m-btn-primary" data-action="m-demo-signup">Create an Account</button>' +
      '<button class="m-btn-primary" style="' +
      secondary +
      ';margin-top:8px" data-action="m-demo-signin">Sign In</button>' +
      '<div class="m-demo-rule"></div>' +
      '<button class="m-demo-reset" data-action="m-demo-reset">Reset Demo Data</button>'
    );
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

    // html-safe: html is MStudents.renderList, MObserve.renderFeed or MGrade.renderPicker, each checked to escape its text.
    stack.innerHTML = html;
    _navStacks[tab].push(tab);
    _addDemoPill(stack.querySelector('.m-screen'));

    // Apply any persisted filters to the freshly-mounted Grade list.
    // renderPicker loads _filters from LocalStorage into module state, but
    // the returned HTML renders every cell visible; filterAssessments walks
    // the DOM and hides cells that don't match.
    if (tab === 'grade') MGrade.filterAssessments(_cid);

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
    // The sync light is drawn fresh with each render; show the current state.
    if (typeof _updateSyncIndicator === 'function') _updateSyncIndicator();
  }

  /* ── Push/pop screens ───────────────────────────────────────── */
  // `restore` says how to draw the screen again when its tab is reopened.
  function _pushScreen(html, restore) {
    var stack = document.getElementById('m-nav-stack');
    var current = stack.querySelector('.m-screen:last-child');

    // Insert new screen
    var tmp = document.createElement('div');
    // html-safe: every caller passes MGrade.renderSwiper, MStudents.renderDetail or MSweep.render, each checked to escape its text.
    tmp.innerHTML = html;
    var newScreen = tmp.firstElementChild;
    if (restore) newScreen.setAttribute('data-restore', JSON.stringify(restore));
    newScreen.classList.add('m-push-enter');
    stack.appendChild(newScreen);
    // The student screen's open tab, in view in its strip.
    if (window.MStudentDetail) MStudentDetail.scrollActiveTab(newScreen);
    // A pushed screen with its own sync dot shows the current state.
    if (typeof _updateSyncIndicator === 'function') _updateSyncIndicator();

    _navStacks[_activeTab].push('detail');
    history.pushState({ m: _navStacks[_activeTab].length - 1 }, '');

    // Animate
    requestAnimationFrame(function () {
      if (current) current.classList.add('m-push-exit-active');
      newScreen.classList.remove('m-push-enter', 'm-screen-hidden');
      newScreen.classList.add('m-push-enter-active');

      setTimeout(function () {
        if (current) {
          current.classList.remove('m-push-exit-active');
          // Unless the new screen is already on its way back out.
          if (newScreen.parentNode && !_swipeActive) current.style.display = 'none';
        }
        newScreen.classList.remove('m-push-enter-active');

        // Setup scroll for new screen
        var navBar = newScreen.querySelector('.m-nav-bar');
        if (navBar) MC.setupScrollTitle(newScreen, navBar.id);
      }, 360);
    });
  }

  // `fromHistory`: the browser's own back already removed the entry.
  function _popScreen(fromHistory) {
    var stack = document.getElementById('m-nav-stack');
    var screens = stack.querySelectorAll('.m-screen');
    if (screens.length < 2) return;

    var top = screens[screens.length - 1];
    var below = screens[screens.length - 2];
    if (_gradeReturnSid && top.id === 'm-screen-grade-swiper') {
      _returnToStudent(_gradeReturnSid, top);
      return;
    }

    below.style.display = '';
    below.classList.add('m-pop-enter');
    top.classList.add('m-pop-exit-active');

    requestAnimationFrame(function () {
      below.classList.remove('m-pop-enter');
      below.classList.add('m-pop-enter-active');
      setTimeout(function () {
        _finishPop(top, below, fromHistory);
      }, 360);
    });
  }

  function _finishPop(top, below, fromHistory) {
    top.remove();
    below.classList.remove('m-pop-enter-active');
    _navStacks[_activeTab].pop();
    if (top.id === 'm-screen-obs-sweep') MSweep.close();
    // Drop the screen's history entry too, when it has one (a screen put
    // back by a tab switch has none).
    if (!fromHistory && history.state && history.state.m > 0) {
      _ignorePop = true;
      history.back();
    }
  }

  /* Back from a grading screen that a student page's Grade button opened:
     that student's page again, on the Students tab, with the usual slide. */
  function _returnToStudent(sid, top) {
    // The grading screen leaves the Grade tab for good.
    top.removeAttribute('data-restore');
    top.parentNode.removeChild(top);
    _switchTab('students');
    var stack = document.getElementById('m-nav-stack');
    // The tab switch usually puts the student's page back itself.
    var screen = stack.querySelector('.m-screen:last-child');
    if (
      !(
        screen &&
        screen.id === 'm-screen-student-detail' &&
        screen.getAttribute('data-restore') === JSON.stringify({ kind: 'detail', sid: sid })
      )
    ) {
      var list = screen;
      var tmp = document.createElement('div');
      tmp.innerHTML = MStudents.renderDetail(_cid, sid);
      screen = tmp.firstElementChild;
      screen.classList.remove('m-screen-hidden');
      screen.setAttribute('data-restore', JSON.stringify({ kind: 'detail', sid: sid }));
      stack.appendChild(screen);
      if (window.MStudentDetail) MStudentDetail.scrollActiveTab(screen);
      if (list) list.style.display = 'none';
      _navStacks[_activeTab].push('detail');
      var navBar = screen.querySelector('.m-nav-bar');
      if (navBar) MC.setupScrollTitle(screen, navBar.id);
    }

    stack.appendChild(top);
    screen.classList.add('m-pop-enter');
    top.classList.add('m-pop-exit-active');
    requestAnimationFrame(function () {
      screen.classList.remove('m-pop-enter');
      screen.classList.add('m-pop-enter-active');
      setTimeout(function () {
        top.remove();
        screen.classList.remove('m-pop-enter-active');
      }, 360);
    });
  }

  /* ── Swipe back from the left edge ───────────────────────────
     A drag from the left edge pulls the top screen aside, the screen under
     it following; past a third of the width, or a quick flick, it goes back. */
  function _bindEdgeSwipe() {
    var stack = document.getElementById('m-nav-stack');
    var EDGE = 28;
    var top = null;
    var below = null;
    var startX = 0;
    var startY = 0;
    var startT = 0;
    var dx = 0;
    var width = 0;
    var decided = false;
    var active = false;

    stack.addEventListener(
      'touchstart',
      function (e) {
        top = null;
        var screens = stack.querySelectorAll('.m-screen');
        if (screens.length < 2) return;
        if (!document.getElementById('m-sheet-backdrop').classList.contains('u-hidden')) return;
        var t = e.touches[0];
        if (t.clientX > EDGE) return;
        var candidate = screens[screens.length - 1];
        // Back from this screen goes somewhere else; the plain pop handles it.
        if (_gradeReturnSid && candidate.id === 'm-screen-grade-swiper') return;
        top = candidate;
        below = screens[screens.length - 2];
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
        dx = 0;
        width = stack.clientWidth;
        decided = false;
        active = false;
      },
      { passive: true },
    );

    stack.addEventListener(
      'touchmove',
      function (e) {
        if (!top) return;
        var t = e.touches[0];
        dx = t.clientX - startX;
        var dy = t.clientY - startY;
        if (!decided) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          decided = true;
          if (dx <= 0 || Math.abs(dy) > dx) {
            top = null;
            return;
          }
          active = true;
          _swipeActive = true;
          below.style.display = '';
          top.classList.add('m-swipe-back');
          below.classList.add('m-swipe-back');
        }
        e.preventDefault();
        var x = Math.max(0, dx);
        top.style.transform = 'translateX(' + x + 'px)';
        below.style.transform = 'translateX(' + -0.3 * (width - x) + 'px)';
        below.style.setProperty('--m-dim', String(0.12 * (1 - x / width)));
      },
      { passive: false },
    );

    stack.addEventListener(
      'touchend',
      function () {
        if (!top || !active) {
          top = null;
          return;
        }
        var t = top;
        var b = below;
        top = null;
        _swipeActive = false;
        var velocity = dx / Math.max(Date.now() - startT, 1);
        var goBack = dx > width / 3 || velocity > 0.4;
        t.classList.remove('m-swipe-back');
        b.classList.remove('m-swipe-back');
        t.style.transform = '';
        b.style.removeProperty('--m-dim');
        if (goBack) {
          b.style.transform = '';
          t.classList.add('m-pop-exit-active');
          b.classList.add('m-pop-enter-active');
          setTimeout(function () {
            _finishPop(t, b, false);
          }, 360);
        } else {
          t.classList.add('m-swipe-settle');
          b.classList.add('m-swipe-settle');
          b.style.transform = 'translateX(-30%)';
          setTimeout(function () {
            t.classList.remove('m-swipe-settle');
            b.classList.remove('m-swipe-settle');
            b.style.transform = '';
            b.style.display = 'none';
          }, 260);
        }
      },
      { passive: true },
    );
  }

  /* ── Event delegation ───────────────────────────────────────── */
  function _bindEvents() {
    document.addEventListener('click', function (e) {
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

      // Grade on a student page: the newest assessment's grading screen on
      // the Grade tab, at that student's card. Back returns to the page.
      if (action === 'm-student-grade' || action === 'm-assess-grade') {
        var gradeSid = target.getAttribute('data-sid');
        // A row on the student screen opens its own assessment; the Grade
        // button opens the newest.
        var wantAid = target.getAttribute('data-aid');
        var newest = wantAid
          ? getAssessments(_cid).find(function (a) {
              return a.id === wantAid;
            })
          : getAssessments(_cid)
              .slice()
              .sort(function (a, b) {
                return (b.date || '').localeCompare(a.date || '');
              })[0];
        // The Grade tab opens on its list. A grading screen left open there
        // would come back under this one with the same ids, and the handlers
        // would bind to the hidden copy.
        _tabState.grade = null;
        _switchTab('grade');
        if (!newest) return;
        _gradeReturnSid = gradeSid;
        _pushScreen(MGrade.renderSwiper(_cid, newest.id), { kind: 'swiper', aid: newest.id });
        // On group work the student's group card.
        var gradeIdx = MGrade.studentCardIndex(_cid, newest.id, gradeSid);
        MGrade.setupSwiper(_cid, newest.id);
        if (gradeIdx > 0) MGrade.jumpToStudent(gradeIdx, true);
        return;
      }

      // Settings sheet (course switcher, Customize Card on Students, sign out, switch to desktop)
      if (action === 'm-settings') {
        var pickerCourses = getPickerCourses(_cid);
        var courseOpts = pickerCourses
          .map(function (c) {
            return (
              '<option value="' + c.id + '"' + (c.id === _cid ? ' selected' : '') + '>' + MC.esc(c.name) + '</option>'
            );
          })
          .join('');
        var hasCourses = pickerCourses.length > 1;
        // getLastSyncedAt() is an ISO string (data.js). Calling .toISOString()
        // on it threw, so the gear did nothing after the first sync.
        var lastSyncedAt = window.GB ? window.GB.getLastSyncedAt() : null;
        if (lastSyncedAt instanceof Date) lastSyncedAt = lastSyncedAt.toISOString();
        var syncLine =
          '<div style="font-size:13px;color:var(--text-3);text-align:center;margin-bottom:16px">' +
          (lastSyncedAt ? 'Last synced: ' + MC.relativeTime(String(lastSyncedAt)) : 'Not yet synced this session') +
          '</div>';
        var userBlock =
          '<div style="padding:4px 16px 12px;text-align:center">' +
          (_userName
            ? '<div style="font-size:15px;font-weight:600;color:var(--text)">' + MC.esc(_userName) + '</div>'
            : '') +
          (_userEmail
            ? '<div style="font-size:13px;color:var(--text-3);margin-top:2px">' + MC.esc(_userEmail) + '</div>'
            : '') +
          '</div>';
        var versionBlock =
          '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:12px 0 4px">FullVision v' +
          APP_VERSION +
          '</div>';
        MC.presentSheet(
          '<div style="padding:8px 0 16px">' +
            '<div style="font-size:17px;font-weight:600;text-align:center;margin-bottom:4px">Settings</div>' +
            userBlock +
            syncLine +
            (hasCourses
              ? '<div style="margin-bottom:16px">' +
                '<div style="font-size:13px;font-weight:600;color:var(--text-3);margin-bottom:6px">Active Class</div>' +
                '<select id="m-course-select" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);font-size:17px;font-family:inherit;background:var(--surface);color:var(--text)">' +
                courseOpts +
                '</select>' +
                '</div>'
              : '') +
            (_activeTab === 'students'
              ? '<button class="m-btn-primary" style="background:var(--surface);color:var(--text);border:1px solid var(--border)" data-action="m-open-widget-editor">Customize Card</button>'
              : '') +
            // Help opens the help site in a new tab.
            '<a class="m-btn-primary m-help-link" href="/help" target="_blank" rel="noopener">Help</a>' +
            '<button class="m-btn-primary" style="background:var(--surface);color:var(--text);border:1px solid var(--border)" data-action="m-switch-desktop">Switch to Desktop</button>' +
            '<button class="m-btn-primary" style="background:none;color:var(--score-1);border:none;margin-top:4px" data-action="m-sign-out">Sign Out</button>' +
            versionBlock +
            '</div>',
        );
        // Wire course select change
        var courseSelect = document.getElementById('m-course-select');
        if (courseSelect) {
          courseSelect.addEventListener('change', function () {
            var newCid = this.value;
            if (newCid && newCid !== _cid) {
              _cid = newCid;
              // Screens left open on each tab belong to the old class.
              _tabState = { students: null, observe: null, grade: null };
              _gradeReturnSid = null;
              document.body.setAttribute('aria-busy', 'true');
              switchActiveCourse(newCid).then(
                function (current) {
                  if (!current) return;
                  document.body.removeAttribute('aria-busy');
                  MC.dismissSheet();
                  _renderTab(_activeTab);
                },
                function () {
                  document.body.removeAttribute('aria-busy');
                  _renderTab(_activeTab);
                },
              );
            }
          });
        }
        return;
      }

      if (action === 'm-demo-menu') {
        MC.presentSheet(_demoSheetHtml());
        return;
      }
      // Create an Account and Sign In leave Demo Mode first: a teacher who
      // entered it while signed in is signed out (shared/data.js).
      if (action === 'm-demo-signup' || action === 'm-demo-signin') {
        var demoHref = action === 'm-demo-signup' ? '/login.html#signup' : '/login.html';
        var leaveSheet = target.closest('.m-demo-sheet');
        window.leaveDemoMode(demoHref).then(function (res) {
          if (!res || !res.unsent || !leaveSheet) return;
          // html-safe: _demoUnsentConfirmHtml escapes the href and builds the rest from fixed text and a count.
          leaveSheet.innerHTML = _demoUnsentConfirmHtml(res.unsent, demoHref);
        });
        return;
      }
      if (action === 'm-demo-leave-confirm') {
        MC.dismissSheet();
        window.leaveDemoMode(target.getAttribute('data-href'), { force: true });
        return;
      }
      // Reset Demo Data asks first, inside the sheet, as the desktop's
      // confirm does; Reset runs it and reloads the sample class.
      if (action === 'm-demo-reset') {
        var demoSheet = target.closest('.m-demo-sheet');
        // html-safe: _demoResetConfirmHtml is fixed markup.
        if (demoSheet) demoSheet.innerHTML = _demoResetConfirmHtml();
        return;
      }
      if (action === 'm-demo-reset-cancel') {
        var cancelSheet = target.closest('.m-demo-sheet');
        // html-safe: _demoSheetInnerHtml is fixed markup.
        if (cancelSheet) cancelSheet.innerHTML = _demoSheetInnerHtml();
        return;
      }
      if (action === 'm-demo-reset-confirm') {
        MC.dismissSheet();
        if (typeof resetDemoData === 'function') {
          resetDemoData().then(function () {
            window.location.reload();
          });
        }
        return;
      }

      if (action === 'm-switch-desktop') {
        localStorage.setItem('td-mobile-pref', 'desktop');
        window.location.href = '/dashboard';
        return;
      }

      if (action === 'm-sign-out') {
        MC.dismissSheet();
        if (typeof signOut === 'function') {
          signOut().then(function (res) {
            if (!res || !res.unsent) return;
            var msg =
              res.unsent === 1
                ? '1 change hasn’t reached the server yet. If you sign out now, it will be lost. Sign out anyway?'
                : res.unsent +
                  ' changes haven’t reached the server yet. If you sign out now, they will be lost. Sign out anyway?';
            if (window.confirm(msg)) signOut({ force: true });
          });
        } else window.location.href = '/login.html';
        return;
      }

      if (action === 'm-dismiss-sheet') {
        MC.dismissSheet();
        return;
      }

      // Widget editor actions
      if (action === 'm-open-widget-editor') {
        MCardWidgetEditor.show(function onUpdate() {
          MStudents.initCardStack(_cid);
        });
        return;
      }
      if (action === 'm-wdg-toggle' || action === 'm-wdg-reset') {
        MCardWidgetEditor.handleAction(action, target);
        return;
      }

      // ── Students tab ──
      // The whole Teacher Comment from a student card.
      if (action === 'm-comment-full') {
        var cSid = target.getAttribute('data-sid');
        var cSt = getStudents(_cid).find(function (s) {
          return s.id === cSid;
        });
        var cTerm = target.getAttribute('data-term');
        if (cSt) MC.presentSheet(MCardWidgets.commentSheetHtml(cSt, _cid, cTerm === '' ? null : cTerm));
        return;
      }

      if (action === 'm-all-students') {
        MStudents.showAllStudents();
        return;
      }

      if (action === 'm-jump-student') {
        MStudents.jumpToStudent(target.getAttribute('data-sid'));
        return;
      }

      if (action === 'm-sort') {
        MStudents.showSortSheet();
        return;
      }

      if (action === 'm-set-sort') {
        var sortMode = target.getAttribute('data-mode');
        if (sortMode) MStudents.setSortMode(sortMode);
        return;
      }

      if (action === 'm-student-detail') {
        var sid = target.getAttribute('data-sid');
        var html = MStudents.renderDetail(_cid, sid);
        _pushScreen(html, { kind: 'detail', sid: sid });
        return;
      }

      if (action === 'm-student-tab') {
        MStudentDetail.selectTab(target, target.getAttribute('data-tab'));
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

      if (action === 'm-sweep-start') {
        _pushScreen(MSweep.render(_cid), { kind: 'sweep' });
        return;
      }

      if (action === 'm-sweep-done') {
        _popScreen();
        return;
      }

      if (action.indexOf('m-sweep-') === 0) {
        MSweep.handleAction(action, target);
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
        setTimeout(function () {
          MObserve.resetSheetState();
          MObserve.presentNewObsSheet(_cid, qcSid);
        }, 400);
        return;
      }

      if (action === 'm-obs-edit') {
        var editObId = target.getAttribute('data-obid');
        var editSid = target.getAttribute('data-sid');
        if (editObId && editSid) MObserve.presentEditObsSheet(_cid, editSid, editObId);
        return;
      }

      if (action === 'm-obs-delete') {
        var obId = target.getAttribute('data-obid');
        var obSid = target.getAttribute('data-sid');
        if (target.closest('.m-sheet')) {
          MC.dismissSheet();
          MObserve.resetSheetState();
        }
        if (obId && obSid) MObserve.holdDelete(_cid, obSid, obId);
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

      if (action === 'm-obs-edit-cancel') {
        MC.dismissSheet();
        return;
      }

      if (action === 'm-obs-picker') {
        MObserve.openPicker(target.getAttribute('data-kind'));
        return;
      }

      if (action === 'm-obs-picker-back') {
        MObserve.closePicker();
        return;
      }

      if (action === 'm-obs-pick') {
        MObserve.pick(target.getAttribute('data-kind'), target.getAttribute('data-val'), target);
        return;
      }

      if (action === 'm-obs-flag') {
        MObserve.flagFromSheet(_cid, target.getAttribute('data-sid'), target);
        return;
      }

      if (action === 'm-obs-flag-done') {
        MObserve.flagDone();
        return;
      }

      if (action === 'm-sheet-cancel') {
        MC.dismissSheet();
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

      if (action === 'm-grade-filter-open') {
        MGrade.openFilterSheet(_cid);
        return;
      }

      if (action === 'm-grade-filter-toggle') {
        var tBtn = target.closest('[data-kind]');
        MGrade.onFilterTogglePill(tBtn.getAttribute('data-kind'), tBtn.getAttribute('data-val'));
        return;
      }

      if (action === 'm-grade-filter-seg') {
        var sBtn = target.closest('[data-kind]');
        MGrade.onFilterSegChange(sBtn.getAttribute('data-kind'), sBtn.getAttribute('data-val'));
        return;
      }

      if (action === 'm-grade-filter-apply') {
        MGrade.applyFilterSheet(_cid);
        return;
      }

      if (action === 'm-grade-filter-clear') {
        MGrade.clearFilterSheet(_cid);
        return;
      }

      if (action === 'm-grade-assess') {
        var aid = target.closest('[data-aid]').getAttribute('data-aid');
        var swiperHTML = MGrade.renderSwiper(_cid, aid);
        _pushScreen(swiperHTML, { kind: 'swiper', aid: aid });
        // Wired at once, as when grading from a student: a score typed or an
        // avatar tapped while the screen slides in is not lost.
        MGrade.setupSwiper(_cid, aid);
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

      if (action === 'm-grade-crit') {
        MGrade.setCriterionScore(
          _cid,
          target.getAttribute('data-sid'),
          target.getAttribute('data-aid'),
          target.getAttribute('data-critid'),
          parseInt(target.getAttribute('data-score'), 10),
        );
        return;
      }

      if (action === 'm-grade-view') {
        MGrade.setGradeView(_cid, target.getAttribute('data-aid'), target.getAttribute('data-view'));
        return;
      }

      if (action === 'm-grade-checks') {
        MGrade.toggleChecklist(
          _cid,
          target.getAttribute('data-sid'),
          target.getAttribute('data-aid'),
          target.getAttribute('data-critid'),
        );
        return;
      }

      if (action === 'm-grade-crit-comment') {
        MGrade.openCritComment(target);
        return;
      }

      if (action === 'm-grade-tick') {
        MGrade.tickCheck(
          _cid,
          target.getAttribute('data-sid'),
          target.getAttribute('data-aid'),
          target.getAttribute('data-critid'),
          target.getAttribute('data-checkid'),
          target.checked,
        );
        return;
      }

      if (action === 'm-grade-mod') {
        var modBox = target.closest('.m-score-mods');
        if (modBox.getAttribute('data-critid')) {
          MGrade.setCriterionMod(
            _cid,
            modBox.getAttribute('data-sid'),
            modBox.getAttribute('data-aid'),
            modBox.getAttribute('data-critid'),
            parseInt(target.closest('[data-mod]').getAttribute('data-mod'), 10),
          );
          return;
        }
        MGrade.setScoreMod(
          _cid,
          modBox.getAttribute('data-sid'),
          modBox.getAttribute('data-aid'),
          modBox.getAttribute('data-tid'),
          parseInt(target.closest('[data-mod]').getAttribute('data-mod'), 10),
        );
        return;
      }

      if (action === 'm-grade-completion') {
        var cmpGroup = target.closest('.m-cmp-group');
        MGrade.setCompletion(
          _cid,
          cmpGroup.getAttribute('data-sid'),
          cmpGroup.getAttribute('data-aid'),
          target.closest('[data-mark]').getAttribute('data-mark'),
        );
        return;
      }

      if (action === 'm-grade-points-inc' || action === 'm-grade-points-dec') {
        var pBtn = target.closest('[data-sid]');
        var delta = action === 'm-grade-points-inc' ? 1 : -1;
        MGrade.adjustPointsScore(
          _cid,
          pBtn.getAttribute('data-sid'),
          pBtn.getAttribute('data-aid'),
          delta,
          parseFloat(pBtn.getAttribute('data-max')) || 100,
        );
        return;
      }

      if (action === 'm-grade-status') {
        var stBtn = target.closest('[data-val]');
        MGrade.setStatus(
          _cid,
          stBtn.getAttribute('data-sid'),
          stBtn.getAttribute('data-aid'),
          stBtn.getAttribute('data-val'),
        );
        return;
      }

      if (
        action === 'm-grade-group-more' ||
        action === 'm-grade-separate' ||
        action === 'm-grade-rejoin' ||
        action === 'm-grade-rejoin-yes'
      ) {
        var gFn = {
          'm-grade-group-more': MGrade.openMemberSheet,
          'm-grade-separate': MGrade.gradeSeparately,
          'm-grade-rejoin': MGrade.confirmBackToGroup,
          'm-grade-rejoin-yes': MGrade.backToGroup,
        }[action];
        gFn(_cid, target.getAttribute('data-aid'), target.getAttribute('data-sid'));
        return;
      }

      if (action === 'm-grade-jump') {
        var idx = parseInt(target.getAttribute('data-idx'));
        MGrade.jumpToStudent(idx);
        return;
      }
    });

    // Tab bar clicks
    document.getElementById('m-tab-bar').addEventListener('click', function (e) {
      var tab = e.target.closest('.m-tab-item');
      if (!tab) return;
      _switchTab(tab.getAttribute('data-tab'));
    });

    // Search input
    document.addEventListener('input', function (e) {
      if (e.target.matches('[data-action="m-student-search"]')) {
        MStudents.filterList(e.target.value);
      }
      if (e.target.matches('[data-action="m-obs-student-search"]')) {
        clearTimeout(_searchTimer);
        var val = e.target.value;
        _searchTimer = setTimeout(function () {
          MObserve.filterStudentPicker(val);
        }, 150);
      }
      if (e.target.matches('#m-obs-text')) {
        MObserve.updateSubmitState();
      }
      if (e.target.matches('[data-pick-search]')) {
        MObserve.filterPicker(e.target.value);
      }
    });

    // Keyboard handling for textarea in sheet
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        MC.dismissSheet();
      }
      // A row that acts as a button (role="button") answers Enter and Space
      // as a real button does.
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute) {
        var t = e.target;
        if (t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON' && t.hasAttribute('data-action')) {
          e.preventDefault();
          t.click();
        }
      }
    });

    // The browser's back (Android button, edge gesture): the top screen goes
    // back; at the root the guard entry is put back so the app stays open.
    window.addEventListener('popstate', function (e) {
      if (_ignorePop) {
        _ignorePop = false;
        return;
      }
      if (_navStacks[_activeTab] && _navStacks[_activeTab].length > 1) _popScreen(true);
      if (!(e.state && (e.state.m || e.state.guard))) history.pushState({ m: 0, guard: true }, '');
    });
  }

  /* ── Auto-boot ──────────────────────────────────────────────── */
  boot();
})();
