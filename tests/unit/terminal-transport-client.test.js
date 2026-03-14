import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseDesktopXtermTransport } from '../../public/modules/core/terminal-transport-client.js';

describe('terminal-transport-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('localhost desktop環境ではxterm transportを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseDesktopXtermTransport()).toBe(true);
  });

  it('mobile環境ではttyd fallbackを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 390,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });

    expect(shouldUseDesktopXtermTransport()).toBe(false);
  });

  it('Cloudflare hostnameではttyd fallbackを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1440,
      location: { hostname: 'brain-base.work' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseDesktopXtermTransport()).toBe(false);
  });
});
