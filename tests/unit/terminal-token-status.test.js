import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('shows compact Codex context and rate-limit details inline', () => {
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
    expect(app.terminalTokenStatusEl.textContent).toBe('ctx 70% · 5h 26/60% · 7d 63/85%');
    expect(app.terminalTokenStatusEl.dataset.microText).toBe('ctx 70% · 5h 26/60% · 7d 63/85%');
    expect(app.terminalTokenStatusEl.title).toContain('Context used 70% (700 / 1K, remaining 300)');
    expect(app.terminalTokenStatusEl.title).toContain('Codex token limits: 5h usage 26%, elapsed time 60%, 7d usage 63%, elapsed time 85%');
  });

  it('terminal toolbar stays mounted and hides only during startup prompt mode', () => {
    const indexHtml = readFileSync(join(process.cwd(), 'public/index.html'), 'utf8');
    const styleCss = readFileSync(join(process.cwd(), 'public/style.css'), 'utf8');
    const headerStatusStart = indexHtml.indexOf('<div class="terminal-header-status-group">');
    const tokenStatusIndex = indexHtml.indexOf('id="terminal-token-status"');
    const terminalStageIndex = indexHtml.indexOf('id="terminal-stage"');
    const tokenStatusBlock = styleCss.match(/\\.terminal-token-status\\s*{[^}]+}/)?.[0] || '';

    expect(headerStatusStart).toBeGreaterThan(-1);
    expect(tokenStatusIndex).toBeGreaterThan(headerStatusStart);
    expect(tokenStatusIndex).toBeLessThan(terminalStageIndex);
    expect(styleCss).toContain('.console-area.terminal-startup-active > .terminal-header');
    expect(styleCss).toContain('display: none;');
    expect(styleCss).not.toContain('.console-area > .terminal-header,\n.command-center-theme .console-area > .terminal-header');
    expect(tokenStatusBlock).not.toContain('position: absolute');
    expect(tokenStatusBlock).not.toContain('bottom:');
  });

  it('xterm type-to-focus Shift+Enter uses the same S-Enter contract as xterm custom key handling', () => {
    const inputUxSource = readFileSync(join(process.cwd(), 'public/modules/app/terminal-input-ux-mixin.js'), 'utf8');
    const transportSource = readFileSync(join(process.cwd(), 'public/modules/core/terminal-transport-client.js'), 'utf8');

    expect(transportSource).toContain("void this.sendKey('S-Enter')");
    expect(inputUxSource).toContain("this.terminalTransportClient.sendKey('S-Enter')");
    expect(inputUxSource).not.toContain("this.terminalTransportClient.sendKey('M-Enter')");
  });
});
