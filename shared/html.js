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
