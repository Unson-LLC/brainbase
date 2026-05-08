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
      ensureTerminalOwnership: vi.fn(() => ({ allowed: true, terminalAccess: { state: 'owner' } })),
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
  it('ready判定時_文字列probeを送らずinputProbe passedをregistryへ記録する', async () => {
    const { service, runtimeRegistry, terminalIo } = buildService();

    const result = await service.probe({ sessionId: 'session-1', viewerId: 'viewer-1' });

    expect(result.success).toBe(true);
    expect(result.inputReady).toBe(true);
    expect(terminalIo.sendInput).not.toHaveBeenCalled();
    expect(runtimeRegistry.setInputProbe).toHaveBeenCalledWith('session-1', expect.objectContaining({
      status: 'passed',
      mode: 'snapshot_ready'
    }));
  });

  it('ownerでないviewerはprobeできない', async () => {
    const { service, terminalIo } = buildService({
      ownershipService: {
        ensureTerminalOwnership: vi.fn(() => ({
          allowed: false,
          terminalAccess: { state: 'blocked', canTakeover: true }
        }))
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

  it('Codex Plan Mode質問UI時_文字列probeなしでinputReadyを返す', async () => {
    const { service, runtimeRegistry, terminalIo, captureCache } = buildService();
    captureCache.getSnapshot.mockResolvedValue({
      text: [
        '  Question 1/2 (2 unanswered)',
        '  現行Brainbaseはplain ES modules + Expressなので、Next.js実装の入り方をどこに置くか決めたいです。',
        '',
        '  › 1. 別Next画面 (Recommended)  既存UIを壊さず、VibePro専用Next.js画面を追加して段階移行できます。',
        '    2. 既存UI内に統合            右ドロワーだけをNext.jsで埋め込むため、配線は複雑になります。',
        '    3. 全面移行                  Brainbase UI全体をNext.jsへ移す大きなリプレイスになります。',
        '    4. None of the above         Optionally, add details in notes (tab).',
        '',
        '  tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt'
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
      mode: 'waiting_prompt',
      cliReason: 'codex_plan_question'
    }));
  });
});
