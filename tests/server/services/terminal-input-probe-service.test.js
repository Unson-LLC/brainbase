import { describe, expect, it, vi } from 'vitest';
import { TerminalInputProbeService } from '../../../server/services/terminal-input-probe-service.js';

function buildService(overrides = {}) {
  const runtimeRegistry = {
    getSession: vi.fn(() => null),
    setInputProbe: vi.fn()
  };
  const terminalIo = {
    sentText: '',
    sendInput: vi.fn(async (sessionId, value, type) => {
      if (type === 'text') terminalIo.sentText = value;
    })
  };
  const captureCache = {
    invalidate: vi.fn(),
    getSnapshot: vi.fn()
      .mockImplementation(async () => ({
        text: terminalIo.sentText ? `> ${terminalIo.sentText}` : '>',
        colorText: null,
        copyMode: false
      }))
  };
  const service = new TerminalInputProbeService({
    ownershipService: {
      getTerminalAccessState: vi.fn(() => ({ state: 'owner' })),
      touchTerminalOwnership: vi.fn()
    },
    runtimeQuery: {
      isTmuxSessionRunning: vi.fn(async () => true)
    },
    terminalIo,
    snapshotService: {},
    runtimeRegistry,
    captureCache,
    ...overrides
  });
  return { service, runtimeRegistry, terminalIo, captureCache };
}

describe('TerminalInputProbeService', () => {
  it('probe成功時_inputProbe passedをregistryへ記録する', async () => {
    const { service, runtimeRegistry, terminalIo } = buildService();

    const result = await service.probe({ sessionId: 'session-1', viewerId: 'viewer-1' });

    expect(result.success).toBe(true);
    expect(result.inputReady).toBe(true);
    expect(terminalIo.sendInput).toHaveBeenCalledWith('session-1', expect.stringMatching(/^BB_PROBE_/), 'text');
    expect(terminalIo.sendInput).toHaveBeenCalledWith('session-1', 'C-u', 'key');
    expect(runtimeRegistry.setInputProbe).toHaveBeenCalledWith('session-1', expect.objectContaining({ status: 'passed' }));
  });

  it('ownerでないviewerはprobeできない', async () => {
    const { service, terminalIo } = buildService({
      ownershipService: {
        getTerminalAccessState: vi.fn(() => ({ state: 'blocked', canTakeover: true }))
      }
    });

    const result = await service.probe({ sessionId: 'session-1', viewerId: 'viewer-2' });

    expect(result.success).toBe(false);
    expect(result.code).toBe('SESSION_OWNED_BY_OTHER_VIEWER');
    expect(terminalIo.sendInput).not.toHaveBeenCalled();
  });

  it('Claude選択式プロンプト時_文字列probeなしでinputReadyを返す', async () => {
    const { service, runtimeRegistry, terminalIo, captureCache } = buildService();
    captureCache.getSnapshot.mockResolvedValue({
      text: [
        '  4. Type something.',
        '────────────────────────',
        '  5. Chat about this',
        '  6. Skip interview and plan immediately',
        '',
        'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
      ].join('\n'),
      colorText: null,
      copyMode: false
    });

    const result = await service.probe({ sessionId: 'session-1', viewerId: 'viewer-1' });

    expect(result.success).toBe(true);
    expect(result.inputReady).toBe(true);
    expect(result.cliState).toBe('waiting');
    expect(terminalIo.sendInput).not.toHaveBeenCalled();
    expect(runtimeRegistry.setInputProbe).toHaveBeenCalledWith('session-1', expect.objectContaining({
      status: 'passed',
      mode: 'waiting_prompt'
    }));
  });
});
