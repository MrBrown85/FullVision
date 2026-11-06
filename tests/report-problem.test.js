import './setup.js';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Report a Problem', () => {
  it('describes the browser in words, never the full user-agent string', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    expect(reportBrowserText(mac)).toBe('Chrome 131 on macOS');
    expect(
      reportBrowserText(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      ),
    ).toBe('Edge 130 on Windows');
    expect(
      reportBrowserText(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      ),
    ).toBe('Safari 18 on macOS');
    expect(reportBrowserText('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe(
      'Firefox 132 on Linux',
    );
    expect(
      reportBrowserText(
        'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 18 on iPadOS');
    expect(
      reportBrowserText(
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 129 on ChromeOS');
  });

  it('is in the account menu for every teacher', () => {
    const html = renderDock('dashboard');
    const menu = html.slice(html.indexOf('tb-user-dropdown'));
    expect(menu).toContain('data-action="openReportProblem">Report a Problem</button>');
  });

  it('sends through the outbox as submit_support_report, idempotently', async () => {
    expect(FV_IDEMPOTENT_RPCS.submit_support_report).toBe(true);
    const src = readFileSync(resolve(root, 'shared/data.js'), 'utf8');
    expect(src).toContain("_rpcOrNoop('submit_support_report', {");
    expect(typeof window.submitSupportReport).toBe('function');
  });

  it('caps each field at the database limits before sending', () => {
    const src = readFileSync(resolve(root, 'shared/data.js'), 'utf8');
    const body = src.slice(src.indexOf('window.submitSupportReport = function'));
    expect(body).toContain('.slice(0, 200)');
    expect(body).toContain('.slice(0, 5000)');
    expect(body).toContain('.slice(0, 300)');
    expect(body).toContain('.slice(0, 100)');
  });
});
