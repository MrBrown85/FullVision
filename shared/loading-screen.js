/* The loading screen: the hopping FullVision logo with a new line under it
   every couple of seconds. One copy for the desktop (teacher/app.html), the
   phone (teacher-mobile/index.html) and the student page (s/student.js).

   A page puts <div data-fv-loading="teacher"> where the screen goes and
   loads this file right after it; the screen fills in at once. The student
   page draws it with FVLoading.html('student') inside its own screens and
   starts the lines with FVLoading.start(). The lines stop by themselves
   once the screen leaves the page. Styles: shared/loading-screen.css. */
(function () {
  var LINES = {
    teacher: [
      'Sharpening the pencils…',
      'Taking attendance…',
      'Counting heads twice…',
      'Finding the missing permission slips…',
      'Hunting for a whiteboard marker that works…',
      'Unjamming the photocopier…',
      'Collecting the late work…',
      'Putting the date on the board…',
      'Rounding up the stragglers from recess…',
      'Topping up the coffee…',
      'Untangling the projector cable…',
      'Waiting for the bell…',
      'Shushing the back row…',
      'Handing out the name tags…',
      'Checking under the desks for gum…',
      'Stacking the chairs…',
    ],
    // For students in grades 8 to 12: kind, short, and never about marks.
    student: [
      'Finding your teacher’s questions…',
      'Saving you a seat…',
      'Untangling your earbuds…',
      'Turning to the right page…',
      'Opening your locker on the first try…',
      'Warming up the feedback…',
      'Making room for your ideas…',
      'Reading your teacher’s handwriting…',
      'Folding your report into a paper airplane…',
      'Finding a quiet spot to think…',
      'Lining up the questions…',
      'Sharpening a pencil for you…',
      'Dusting off your notebook…',
      'Finding the good pen…',
      'Smoothing out the creases…',
      'Taking a deep breath with you…',
    ],
  };

  function lines(kind) {
    return LINES[kind] || LINES.teacher;
  }

  // html-safe: fixed markup; the one line of text goes through esc.
  function inner(kind) {
    var list = lines(kind);
    return (
      '<div class="app-loading-mark" aria-hidden="true">' +
      '<svg class="app-loading-logo" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="15" fill="#0071e3" />' +
      '<rect class="app-loading-bar" x="13" y="38" width="8" height="10" rx="2" fill="#fff" opacity="0.55" />' +
      '<rect class="app-loading-bar" x="23" y="31" width="8" height="17" rx="2" fill="#fff" opacity="0.7" />' +
      '<rect class="app-loading-bar" x="33" y="24" width="8" height="24" rx="2" fill="#fff" opacity="0.85" />' +
      '<rect class="app-loading-bar" x="43" y="17" width="8" height="31" rx="2" fill="#fff" />' +
      '</svg>' +
      '<div class="app-loading-shadow"></div>' +
      '</div>' +
      '<div class="app-loading-title" aria-hidden="true">FullVision</div>' +
      '<div class="app-loading-text" aria-hidden="true">' +
      esc(list[Math.floor(Math.random() * list.length)]) +
      '</div>'
    );
  }

  /* The whole screen as HTML, for a page that draws its own screens.
     `label` is what a screen reader hears; `inline` keeps it in the page's
     flow instead of covering the window. */
  // html-safe: fixed markup; label goes through esc.
  function html(kind, label, inline) {
    return (
      '<div class="app-loading' +
      (inline ? ' app-loading--inline' : '') +
      '" role="status" aria-label="' +
      esc(label || 'Loading') +
      '">' +
      inner(kind) +
      '</div>'
    );
  }

  // A new line every couple of seconds while `root`'s screen is on the page.
  function start(root, kind) {
    var el = root && root.querySelector ? root.querySelector('.app-loading-text') : null;
    if (!el || el.getAttribute('data-rotating')) return;
    el.setAttribute('data-rotating', '1');
    var list = lines(kind);
    var i = Math.max(0, list.indexOf(el.textContent));
    var timer = setInterval(function () {
      if (!el.isConnected) return clearInterval(timer);
      el.classList.add('is-swapping');
      setTimeout(function () {
        i = (i + 1) % list.length;
        el.textContent = list[i];
        el.classList.remove('is-swapping');
      }, 200);
    }, 2200);
  }

  // Fills every empty <div data-fv-loading="…"> already on the page.
  function mount() {
    var els = document.querySelectorAll('[data-fv-loading]');
    for (var n = 0; n < els.length; n++) {
      var el = els[n];
      if (el.firstChild) continue;
      var kind = el.getAttribute('data-fv-loading');
      el.classList.add('app-loading');
      // html-safe: inner() is fixed markup with one escaped line.
      el.innerHTML = inner(kind);
      start(el, kind);
    }
  }

  window.FVLoading = { html: html, start: start, LINES: LINES };
  if (typeof document !== 'undefined' && document.querySelectorAll) mount();
})();
