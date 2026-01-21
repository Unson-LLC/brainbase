import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { showInfo } from '../../../public/modules/toast.js';

vi.mock('../../../public/modules/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn()
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const htmlPath = path.join(repoRoot, 'public/index.html');

describe('app worktree fallback warning', () => {
  let app;

  beforeEach(async () => {
    window.__BRAINBASE_TEST__ = true;

    const html = readFileSync(htmlPath, 'utf-8');
    const dom = new JSDOM(html);
    document.body.innerHTML = dom.window.document.body.innerHTML;

    const { createApp } = await import('../../../public/app.js');
    app = createApp();
    await app.setupEventListeners();
  });

  afterEach(() => {
    app?.destroy?.();
    vi.restoreAllMocks();
  });

  it('shows warning when SESSION_WORKTREE_FALLBACK emitted', async () => {
    await eventBus.emit(EVENTS.SESSION_WORKTREE_FALLBACK, {
      sessionId: 'session-1',
      project: 'brainbase',
      reason: 'Not a git repo'
    });

    expect(showInfo).toHaveBeenCalledWith(expect.stringContaining('Worktree作成に失敗'));
  });
});
