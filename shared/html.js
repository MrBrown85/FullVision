// @ts-check
/* Text into HTML: the one escape helper every page loads first (desktop,
   phone, the student page and sign-in). Safe in element content and in a
   quoted attribute value; not for a URL, a script or a style. Nothing
   (null, undefined, false, NaN) prints as ''; any other value, 0 included,
   prints as its text. */
function esc(value) {
  if (value == null || value === false || (typeof value === 'number' && isNaN(value))) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* A picture that cannot load (a link that ran out, a photo still on its
   way, no connection) shows a light grey box with a small picture icon,
   not the browser's broken-picture mark (Colin, 2026-11-14). Every page
   loads this file first, so one listener covers them all: an image's
   error marks it fv-img-broken, and teacher/styles.css and s/student.css
   draw the box in the image's own size. Its source and alt text are not
   touched. A later load takes the mark off. Errors do not bubble, so it
   listens on the way down. */
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener(
    'error',
    function (e) {
      var t = /** @type {any} */ (e.target);
      if (t && t.tagName === 'IMG' && t.classList) t.classList.add('fv-img-broken');
    },
    true,
  );
  document.addEventListener(
    'load',
    function (e) {
      var t = /** @type {any} */ (e.target);
      if (t && t.tagName === 'IMG' && t.classList) t.classList.remove('fv-img-broken');
    },
    true,
  );
}
