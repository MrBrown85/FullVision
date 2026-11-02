/**
 * Printouts use fonts Chrome can embed. Apple's system fonts (San Francisco,
 * SF Mono) print as Type 3 fonts, a new one for every size and weight; a
 * class set of reports went to the copier as a 466 MB print job instead of
 * 48 MB. The screen keeps the system fonts through --font-base and
 * --font-mono, and @media print in teacher/styles.css swaps both for fonts
 * that embed (Helvetica Neue, Menlo; Arial, Consolas on Windows). So no
 * stylesheet names a system font except through those two tokens.
 */
import { readFileSync, readdirSync } from 'fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('teacher/styles.css', 'utf-8');
const printBlock = styles.slice(
  styles.indexOf('@media print'),
  styles.indexOf('}', styles.indexOf('--font-mono:', styles.indexOf('@media print'))),
);

describe('print fonts', () => {
  it('swaps both font tokens for embeddable fonts in print', () => {
    expect(printBlock).toContain("--font-base: 'Helvetica Neue', Helvetica, Arial, sans-serif;");
    expect(printBlock).toContain("--font-mono: Menlo, Consolas, 'Courier New', monospace;");
  });

  it('names Apple system fonts only in the two tokens', () => {
    const files = readdirSync('teacher')
      .filter(f => f.endsWith('.css'))
      .map(f => 'teacher/' + f);
    const bad = [];
    files.forEach(f =>
      readFileSync(f, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/font-family:.*(-apple-system|BlinkMacSystemFont|'SF Pro|'SF Mono'|system-ui)/.test(line))
            bad.push(f + ':' + (i + 1));
        }),
    );
    expect(bad).toEqual([]);
  });
});
