/**
 * Text contrast check for the Playwright suite (e2e/contrast.spec.js).
 *
 * `findLowContrastText(page, opts)` runs in the page and returns every visible
 * text element under 18 px whose WCAG contrast against its rendered
 * background is below 4.5:1. The background is found by compositing the
 * element's ancestors' background colours down to the page. Skipped:
 * aria-hidden and disabled controls, screen-reader-only text, anything
 * inside `opts.skip` selectors, text drawn in one of `opts.textTokens` colours, and text on a
 * fill of one of `opts.fillTokens` colours (tokens are custom property names,
 * read in the current colour scheme).
 */

export async function findLowContrastText(page, opts = {}) {
  return page.evaluate(
    ({ skip, textTokens, fillTokens, min, maxPx }) => {
      // Computed colours come back as rgb()/rgba(), or as color(srgb …) with
      // 0–1 channels when color-mix() made them. Anything else throws, so a
      // new format fails the test instead of being skipped.
      const parse = c => {
        if (c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
        let m = c.match(/^rgba?\(([^)]+)\)$/);
        let scale = 1;
        if (!m) {
          m = c.match(/^color\(srgb ([^)]+)\)$/);
          scale = 255;
        }
        if (!m) throw new Error('Unknown colour format: ' + c);
        const p = m[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return { r: p[0] * scale, g: p[1] * scale, b: p[2] * scale, a: p.length > 3 ? p[3] : 1 };
      };
      const over = (top, under) => {
        const a = top.a + under.a * (1 - top.a);
        if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
        const mix = k => (top[k] * top.a + under[k] * under.a * (1 - top.a)) / a;
        return { r: mix('r'), g: mix('g'), b: mix('b'), a };
      };
      const lum = c => {
        const f = v => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const rgbKey = c => [c.r, c.g, c.b].map(Math.round).join(',');
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const tokenKeys = names =>
        new Set(
          names
            .map(n => {
              probe.style.color = '';
              probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
              const c = probe.style.color && parse(getComputedStyle(probe).color);
              return c && c.a === 1 ? rgbKey(c) : null;
            })
            .filter(Boolean),
        );
      const textKeys = tokenKeys(textTokens);
      const fillKeys = tokenKeys(fillTokens);
      probe.remove();
      const hex = c =>
        '#' +
        [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') +
        (c.a < 1 ? ' @' + c.a.toFixed(2) : '');

      // Backgrounds under an element: composite each ancestor's background
      // colour, nearest first, down to the first opaque one (or the canvas).
      // A gradient counts as each of its colour stops in turn, so the result
      // is a list and the text must pass on every one. `fill` is the nearest
      // painted layer; `opacity` multiplies the ancestors' opacity.
      const canvas = matchMedia('(prefers-color-scheme: dark)').matches
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 };
      const backgroundOf = el => {
        let stacks = [[]];
        let opacity = 1;
        let fill = null;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          const cs = getComputedStyle(n);
          opacity *= Number(cs.opacity);
          const bg = parse(cs.backgroundColor);
          const stops = cs.backgroundImage.includes('gradient(')
            ? (cs.backgroundImage.match(/(?:rgba?|color)\([^)]+\)/g) || []).map(parse).filter(c => c.a > 0)
            : [];
          if (stops.length) stacks = stacks.flatMap(st => stops.map(c => [...st, c]));
          if (bg && bg.a > 0) stacks = stacks.map(st => [...st, bg]);
          if (!fill && (stops.length || (bg && bg.a > 0))) fill = stops.length ? null : bg;
          if (bg && bg.a >= 1) break;
        }
        const bgs = stacks.map(st => st.reduceRight((under, top) => over(top, under), canvas));
        return { bgs, opacity, fill: fill || {} };
      };

      const failures = [];
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        const el = t.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (el.closest('script, style, noscript, svg, template, option, [aria-hidden="true"], [inert]')) continue;
        if (el.closest(':disabled, [aria-disabled="true"], .disabled')) continue;
        if (skip.length && el.closest(skip.join(','))) continue;
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.fontSize) >= maxPx) continue;
        if (cs.clip !== 'auto' || cs.clipPath !== 'none') continue;
        const fg = parse(cs.color);
        if (!fg || fg.a === 0) continue;
        if (textKeys.has(rgbKey(fg))) continue;
        const under = backgroundOf(el);
        if (under.fill.a === 1 && fillKeys.has(rgbKey(under.fill))) continue;
        let r = Infinity;
        let text, bg;
        for (const b of under.bgs) {
          const blended = over({ ...fg, a: fg.a * under.opacity }, b);
          const rb = ratio(blended, b);
          if (rb < r) [r, text, bg] = [rb, blended, b];
        }
        if (r < min) {
          failures.push({
            text: t.nodeValue.trim().slice(0, 40),
            selector:
              el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''),
            ratio: Math.round(r * 100) / 100,
            fg: hex(text),
            bg: hex(bg),
            px: parseFloat(cs.fontSize),
          });
        }
      }
      return failures;
    },
    {
      skip: opts.skip || [],
      textTokens: opts.textTokens || [],
      fillTokens: opts.fillTokens || [],
      min: opts.min || 4.5,
      maxPx: opts.maxPx || 18,
    },
  );
}
