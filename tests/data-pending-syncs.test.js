import './setup.js';
import { describe, expect, it } from 'vitest';

describe('pending sync drain', () => {
  it('waitForPendingSyncs waits for tracked writes without a default timeout', async () => {
    let release;
    _trackPendingSync(
      new Promise(resolve => {
        release = resolve;
      }),
    );

    let resolved = false;
    const wait = waitForPendingSyncs().then(() => {
      resolved = true;
    });

    await new Promise(resolve => setTimeout(resolve, 25));
    expect(resolved).toBe(false);

    release();
    await wait;
    expect(resolved).toBe(true);
    expect(getSyncStatus().pending).toBe(0);
  });
});
