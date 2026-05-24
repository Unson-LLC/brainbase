import { expect, test } from '@playwright/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ConversationLinker } from '../../server/services/conversation-linker.js';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';

async function createCodexSessionFile(rootDir: string, options: {
  day: string;
  file: string;
  cwd: string;
  id: string;
  threadSource?: string;
  source?: unknown;
  extraLines?: Array<string>;
}) {
  const dayDir = path.join(rootDir, '2026', '05', options.day);
  await fs.mkdir(dayDir, { recursive: true });
  const filePath = path.join(dayDir, options.file);
  await fs.writeFile(filePath, [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        id: options.id,
        cwd: options.cwd,
        thread_source: options.threadSource || 'user',
        source: options.source || 'cli',
      },
    }),
    ...(options.extraLines || []),
  ].join('\n') + '\n', 'utf8');
  return filePath;
}

test.describe('story-brainbase-session-resume-integrity-guard', () => {
  test('ac:1 ac:2 ac:3 Codex subagent history resolves to the parent main thread with JSONL line counts', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-resume-integrity-e2e-'));
    const cwd = '/tmp/brainbase-resume-integrity-session';
    const parentId = '019e4a2b-48af-7e92-a061-b1f56352857f';
    const childId = '019e5505-cb1b-73e0-bdc8-d8daa34297f8';

    const parentFile = await createCodexSessionFile(codexRoot, {
      day: '21',
      file: `rollout-2026-05-21T19-53-31-${parentId}.jsonl`,
      cwd,
      id: parentId,
      extraLines: [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'main' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '本体履歴' } }),
      ],
    });
    const childFile = await createCodexSessionFile(codexRoot, {
      day: '23',
      file: `rollout-2026-05-23T22-28-23-${childId}.jsonl`,
      cwd,
      id: childId,
      threadSource: 'subagent',
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: parentId,
          },
        },
      },
      extraLines: [
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '派生履歴' } }),
      ],
    });
    await fs.utimes(parentFile, new Date('2026-05-23T00:00:00.000Z'), new Date('2026-05-23T00:00:00.000Z'));
    await fs.utimes(childFile, new Date('2026-05-24T00:00:00.000Z'), new Date('2026-05-24T00:00:00.000Z'));

    const session = { id: 'session-resume', path: cwd, worktree: { path: cwd } };
    const stateStore = {
      get: () => ({ sessions: [session] }),
      mutateSessions: async (mutator: (sessions: Array<typeof session>) => Array<typeof session>) => ({ sessions: mutator([session]) }),
    };
    const linker = new ConversationLinker({ stateStore });
    linker.codexSessionsDir = codexRoot;

    const summary = await linker._linkSession(session, await linker._buildCodexIndex());

    expect(summary?.codexThreadId).toBe(parentId);
    expect(summary?.lastConversation.resumeId).toBe(parentId);
    expect(summary?.lastConversation.threadSource).toBe('user');
    expect(summary?.lastConversation.messageCount).toBe(3);

    await fs.rm(codexRoot, { recursive: true, force: true });
  });

  test('ac:4 ac:5 persisted ttyd port owned by another session is a critical conflict issue', async () => {
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: {
        get: () => ({
          sessions: [{
            id: 'session-a',
            name: 'Session A',
            engine: 'codex',
            intendedState: 'active',
            ttydProcess: {
              pid: 87837,
              port: 40015,
              engine: 'codex',
            },
          }],
        }),
      },
      runtimeQuery: {
        _isTmuxSessionRunningSync: () => true,
      },
      runtimeLifecycle: {},
      runtimeRegistry: {
        getAll: () => ({ sessions: {} }),
        getSession: () => null,
        updateSession: () => {},
      },
      execSyncFn: (command: string) => {
        if (command.startsWith('ps ')) {
          return '62766 33566 33566 ttyd -p 40015 -W -b /console/session-b -I index.html\n';
        }
        if (command.startsWith('tmux capture-pane')) return '› prompt';
        return '';
      },
      killFn: () => {},
    });

    const health = await reconciler.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.issues).toContainEqual(expect.objectContaining({
      type: 'ttyd_port_conflict',
      severity: 'critical',
      sessionId: 'session-a',
    }));
    expect(health.sessionHealth[0].observed.ttyd.portConflict).toEqual(expect.objectContaining({
      persistedPort: 40015,
      observedSessionId: 'session-b',
    }));
  });

  test('ac:6 automatic terminal reconnect rejects unsafe ttyd proxy reuse', async () => {
    const reconnectSource = await fs.readFile(
      path.join(process.cwd(), 'public/modules/terminal/terminal-reconnect-manager.js'),
      'utf8'
    );
    const uiTestSource = await fs.readFile(
      path.join(process.cwd(), 'tests/ui/integration/app-switch-session-runtime.test.js'),
      'utf8'
    );

    expect(reconnectSource).toContain("hasRuntimeIssue(runtimeStatus, 'stale_ttyd_process')");
    expect(reconnectSource).toContain("hasRuntimeIssue(runtimeStatus, 'ttyd_port_conflict')");
    expect(reconnectSource).toContain('!hasUnsafeTtydIssue(currentRuntime)');
    expect(reconnectSource).toContain('!hasUnsafeTtydIssue(runtimeStatus)');
    expect(reconnectSource).toContain('/terminal/recover');
    expect(uiTestSource).toContain('reconnect does not reuse unsafe ttyd proxyPath and recovers instead');
    expect(uiTestSource).toContain('validates supplied proxyPath before event-driven switch');
    expect(uiTestSource).toContain("proxyPath: '/console/session-b'");
    expect(uiTestSource).toContain("expect(terminalFrame.src).not.toContain('/console/session-b')");
  });
});
