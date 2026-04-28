import { beforeEach, describe, expect, it } from 'vitest';

import { applyTerminalInputUxMixin } from '../../public/modules/app/terminal-input-ux-mixin.js';
import { appStore } from '../../public/modules/core/store.js';

class TestApp {}

applyTerminalInputUxMixin(TestApp);

function createApp() {
  const app = new TestApp();
  app.terminalTokenStatusEl = document.createElement('div');
  app.terminalTokenStatusEl.className = 'terminal-token-status hidden';
  app._weeklyTokenUsage = {
    totalTokens: 1234,
    period: { start: '2026-04-27T00:00:00.000Z' },
    engines: {
      codex: { totalTokens: 1234 },
      claude: { totalTokens: 0 }
    },
    rateLimits: {
      codex: {
        primary: { usedPercent: 26, timeElapsedPercent: 60 },
        secondary: { usedPercent: 63, timeElapsedPercent: 85 }
      }
    }
  };
  return app;
}

describe('terminal token status', () => {
  beforeEach(() => {
    appStore.setState({
      currentSessionId: null,
      sessions: []
    });
  });

  it('hides token status for Claude sessions even when usage data exists', () => {
    const app = createApp();
    appStore.setState({
      currentSessionId: 'claude-1',
      sessions: [{
        id: 'claude-1',
        engine: 'claude',
        conversationSummary: {
          tokenUsage: {
            contextWindow: 1000,
            usedTokens: 700,
            remainingTokens: 300,
            usedPercent: 70
          }
        }
      }]
    });

    app._updateTerminalTokenStatus('claude-1');

    expect(app.terminalTokenStatusEl.classList.contains('hidden')).toBe(true);
    expect(app.terminalTokenStatusEl.textContent).toBe('');
  });

  it('shows Codex context and rate-limit pacing in session, 5h, 7d order', () => {
    const app = createApp();
    appStore.setState({
      currentSessionId: 'codex-1',
      sessions: [{
        id: 'codex-1',
        engine: 'codex',
        conversationSummary: {
          tokenUsage: {
            contextWindow: 1000,
            usedTokens: 700,
            remainingTokens: 300,
            usedPercent: 70
          }
        }
      }]
    });

    app._updateTerminalTokenStatus('codex-1');

    expect(app.terminalTokenStatusEl.classList.contains('hidden')).toBe(false);
    expect(app.terminalTokenStatusEl.textContent).toBe(
      'context used 70% · 700 / 1K | ⏱ 5h:26% t:60% 📅 7d:63% t:85%'
    );
  });
});
