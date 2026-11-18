/**
 * A wide stand-in for the Linux fonts CI's browser has, which run wider than
 * this Mac's: Verdana (or DejaVu Sans, which CI has) with a little more room
 * between letters. A fit or size test runs in the page's own font and again
 * in this one, and the layout holds in both.
 *
 *   for (const font of FONTS) { ... await useFont(page, font); ... }
 *
 * HARSH is wider still, with the text at 13.3 px and taller lines, as
 * e2e/dashboard-inbox-flip.spec.js measures Flip Through.
 */
export const WIDE_CSS =
  'body, body * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
export const HARSH_CSS =
  '#dash-inbox, #dash-inbox * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; line-height: 1.37 !important; font-size: 13.3px !important; }';

export const FONTS = ['page', 'wide'];

/* Puts the wide font on the page (takes it off for 'page'), then draws the
   Dashboard again when it is the page shown, so whatever is fitted at draw
   time is fitted in that font. */
export async function useFont(page, font, css = WIDE_CSS) {
  await page.evaluate(
    c => {
      let t = document.getElementById('__font');
      if (!t) {
        t = document.createElement('style');
        t.id = '__font';
        document.head.appendChild(t);
      }
      t.textContent = c;
    },
    font === 'page' ? '' : css,
  );
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate(() => {
    if (document.querySelector('#main .dash-glance') && window.PageDashboard) PageDashboard.render();
  });
  await page.waitForTimeout(250);
}
