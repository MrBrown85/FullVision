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
   error gives it the icon as its picture and marks it fv-img-broken
   (styled in teacher/styles.css and s/student.css: grey, the icon
   centred at its own size, the image's own box kept). Setting a new
   picture takes the mark off. Errors do not bubble, so it listens on the
   way down. */
var FV_IMG_BROKEN =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#98989f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5-8 8.5"/></svg>',
  );
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener(
    'error',
    function (e) {
      var t = /** @type {any} */ (e.target);
      if (!t || t.tagName !== 'IMG' || t.src === FV_IMG_BROKEN) return;
      t.classList.add('fv-img-broken');
      t.src = FV_IMG_BROKEN;
    },
    true,
  );
  document.addEventListener(
    'load',
    function (e) {
      var t = /** @type {any} */ (e.target);
      if (t && t.tagName === 'IMG' && t.src !== FV_IMG_BROKEN) t.classList.remove('fv-img-broken');
    },
    true,
  );
}
