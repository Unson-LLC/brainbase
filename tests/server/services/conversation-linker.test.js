import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationLinker } from '../../../server/services/conversation-linker.js';

const tempDirs = [];

async function createJsonlFile(lines) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-conv-linker-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'session.jsonl');
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

async function createCodexSessionFile(rootDir, {
  year = '2026',
  month = '05',
  day = '07',
  file = 'rollout-test.jsonl',
  cwd,
  id = '019e0000-0000-7000-8000-000000000001',
  threadSource = 'user',
  source = 'cli',
  metadataShape = 'typed-payload',
  extraLines = []
}) {
  const dayDir = path.join(rootDir, year, month, day);
  await fs.mkdir(dayDir, { recursive: true });
  const filePath = path.join(dayDir, file);
  const metadata = { id, cwd, thread_source: threadSource, source };
  const metadataLine = metadataShape === 'top-level'
    ? { session_meta: metadata }
    : { type: 'session_meta', payload: metadata };
  await fs.writeFile(filePath, [
    JSON.stringify(metadataLine),
    ...extraLines
  ].join('\n') + '\n', 'utf8');
  return filePath;
}

describe('ConversationLinker', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('Claudeログから最新の日本語assistant断片を取得する', async () => {
    const jsonlPath = await createJsonlFile([
      JSON.stringify({ type: 'assistant', message: { content: 'first english message' } }),
      JSON.stringify({ type: 'assistant', message: { content: '最新の表示を日本語断片だけに絞ります' } })
    ]);

    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [] }), update: async () => ({ sessions: [] }) }
    });

    await expect(linker.getLastClaudeAssistantSnippet(jsonlPath))
      .resolves.toBe('最新の表示を日本語断片だけに絞ります');
  });

  it('Codexログから最新の日本語assistant断片を取得する', async () => {
    const jsonlPath = await createJsonlFile([
      JSON.stringify({ type: 'item/agentMessage/delta', message: { text: 'ignore english only' } }),
      JSON.stringify({ type: 'assistant-message', content: [{ text: 'このセッションでは回答断片だけを表示します' }] })
    ]);

    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [] }), update: async () => ({ sessions: [] }) }
    });

    await expect(linker.getLastCodexAssistantSnippet(jsonlPath))
      .resolves.toBe('このセッションでは回答断片だけを表示します');
  });

  it('Codexログのtoken_countからcontext残量を取得する', async () => {
    const jsonlPath = await createJsonlFile([
      JSON.stringify({ type: 'session_meta', cwd: '/tmp/project' }),
      JSON.stringify({
        timestamp: '2026-04-27T00:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 159000,
              output_tokens: 1000,
              total_tokens: 160000
            },
            total_token_usage: {
              total_tokens: 320000
            },
            model_context_window: 200000
          }
        }
      })
    ]);

    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [] }), update: async () => ({ sessions: [] }) }
    });

    await expect(linker.getCodexTokenUsage(jsonlPath))
      .resolves.toMatchObject({
        source: 'codex',
        contextWindow: 200000,
        usedTokens: 160000,
        remainingTokens: 40000,
        usedPercent: 80,
        remainingPercent: 20,
        updatedAt: '2026-04-27T00:00:00.000Z'
      });
  });

  it('linkAllは実行中に追加されたsessionを落とさずにmerge保存する', async () => {
    const initialSessions = [
      { id: 'session-1', name: 'one' },
      { id: 'session-2', name: 'two' }
    ];
    const latestSessions = [
      { id: 'session-1', name: 'one' },
      { id: 'session-2', name: 'two' },
      { id: 'session-3', name: 'newly-added' }
    ];
    const stateStore = {
      get: vi.fn()
        .mockReturnValueOnce({ sessions: initialSessions })
        .mockReturnValueOnce({ sessions: latestSessions }),
      mutateSessions: vi.fn(async (mutator) => ({ sessions: await mutator(latestSessions) }))
    };

    const linker = new ConversationLinker({ stateStore });
    linker._buildCodexIndex = vi.fn(async () => new Map());
    linker._linkSession = vi.fn(async (session) => ({
      totalConversations: 1,
      lastAssistantSnippet: `snippet:${session.id}`,
      lastAssistantSnippetAt: '2026-04-03T00:00:00.000Z'
    }));

    const result = await linker.linkAll();

    expect(result.updated).toBe(2);
    expect(stateStore.mutateSessions).toHaveBeenCalled();
  });

  it('linkAllはlimit指定時_一部セッションだけ処理してcursorを進める', async () => {
    const sessions = [
      { id: 'session-1', name: 'one' },
      { id: 'session-2', name: 'two' },
      { id: 'session-3', name: 'three' }
    ];
    const stateStore = {
      get: vi.fn(() => ({ sessions })),
      mutateSessions: vi.fn(async (mutator) => ({ sessions: await mutator(sessions) }))
    };

    const linker = new ConversationLinker({ stateStore });
    linker._buildCodexIndex = vi.fn(async () => new Map());
    linker._linkSession = vi.fn(async (session) => ({
      totalConversations: 1,
      lastAssistantSnippet: `snippet:${session.id}`,
      lastAssistantSnippetAt: '2026-04-03T00:00:00.000Z'
    }));

    const first = await linker.linkAll({ limit: 2 });
    const second = await linker.linkAll({ limit: 2 });

    expect(first.processed).toBe(2);
    expect(second.processed).toBe(2);
    expect(linker._linkSession.mock.calls.map(([session]) => session.id)).toEqual([
      'session-1',
      'session-2',
      'session-3',
      'session-1'
    ]);
  });

  it('Codex index再構築時_未変更jsonlのcwd読み取りを再実行しない', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-index-'));
    tempDirs.push(codexRoot);
    await createCodexSessionFile(codexRoot, { cwd: '/tmp/project-a' });

    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [] }), update: async () => ({ sessions: [] }) }
    });
    linker.codexSessionsDir = codexRoot;
    const readCwd = vi.spyOn(linker, 'getCodexSessionCwd');

    await linker._buildCodexIndex();
    linker._codexIndexCacheTime = 0;
    const secondIndex = await linker._buildCodexIndex();

    expect(readCwd).toHaveBeenCalledTimes(1);
    expect(secondIndex.get('/tmp/project-a')).toHaveLength(1);
  });

  it('Codex index再構築時_更新されたjsonlだけcwdを読み直す', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-index-'));
    tempDirs.push(codexRoot);
    const filePath = await createCodexSessionFile(codexRoot, { cwd: '/tmp/project-a' });

    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [] }), update: async () => ({ sessions: [] }) }
    });
    linker.codexSessionsDir = codexRoot;
    const readCwd = vi.spyOn(linker, 'getCodexSessionCwd');

    await linker._buildCodexIndex();
    await fs.writeFile(filePath, `${JSON.stringify({ type: 'session_meta', cwd: '/tmp/project-b-updated' })}\n`, 'utf8');
    linker._codexIndexCacheTime = 0;
    const secondIndex = await linker._buildCodexIndex();

    expect(readCwd).toHaveBeenCalledTimes(2);
    expect(secondIndex.has('/tmp/project-a')).toBe(false);
    expect(secondIndex.get('/tmp/project-b-updated')).toEqual([filePath]);
  });

  it('rotated sessionはactive workspaceとretired workspaceのCodexログを同じ会話履歴として扱う', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-history-'));
    tempDirs.push(codexRoot);
    await createCodexSessionFile(codexRoot, {
      day: '16',
      file: 'rollout-2026-05-16T11-07-17-019e2e89-b776-71f1-9a5a-c3ecacd0c24a.jsonl',
      cwd: '/tmp/session-g1',
      id: '019e2e89-b776-71f1-9a5a-c3ecacd0c24a'
    });
    await createCodexSessionFile(codexRoot, {
      day: '17',
      file: 'rollout-2026-05-17T20-03-15-019e359a-c2cc-7a23-99de-e468b147a26b.jsonl',
      cwd: '/tmp/session-g2',
      id: '019e359a-c2cc-7a23-99de-e468b147a26b'
    });

    const session = {
      id: 'session-rotated',
      path: '/tmp/session-g2',
      worktree: { path: '/tmp/session-g2' },
      workspaceHistory: [{ path: '/tmp/session-g1', retiredAt: '2026-05-17T11:02:58.598Z' }]
    };
    const stateStore = {
      get: vi.fn(() => ({ sessions: [session] })),
      mutateSessions: vi.fn(async (mutator) => ({ sessions: await mutator([session]) }))
    };
    const linker = new ConversationLinker({ stateStore });
    linker.codexSessionsDir = codexRoot;

    const result = await linker.linkAll();
    const updated = stateStore.mutateSessions.mock.calls[0][0]([session])[0];

    expect(result.updated).toBe(1);
    expect(updated.conversationSummary.totalConversations).toBe(2);
    expect(updated.conversationSummary.codexLogFiles).toHaveLength(2);
    expect(updated.codexThreadId).toBe('019e359a-c2cc-7a23-99de-e468b147a26b');
  });

  it('story-brainbase-session-resume-integrity-guard INV-1 最新Codexログがsubagentの場合はparent threadをresume正本にする', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-parent-'));
    tempDirs.push(codexRoot);
    const cwd = '/tmp/session-resume-integrity';
    const parentId = '019e4a2b-48af-7e92-a061-b1f56352857f';
    const childId = '019e5505-cb1b-73e0-bdc8-d8daa34297f8';
    const parentFile = await createCodexSessionFile(codexRoot, {
      day: '21',
      file: `rollout-2026-05-21T19-53-31-${parentId}.jsonl`,
      cwd,
      id: parentId,
      extraLines: [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'main work' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '本体ログです' } })
      ]
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
            parent_thread_id: parentId
          }
        }
      },
      extraLines: [
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '派生ログです' } })
      ]
    });

    const parentTime = new Date('2026-05-23T00:00:00.000Z');
    const childTime = new Date('2026-05-24T00:00:00.000Z');
    await fs.utimes(parentFile, parentTime, parentTime);
    await fs.utimes(childFile, childTime, childTime);
    const session = {
      id: 'session-resume',
      path: cwd,
      worktree: { path: cwd }
    };
    const stateStore = {
      get: vi.fn(() => ({ sessions: [session] })),
      mutateSessions: vi.fn(async (mutator) => ({ sessions: await mutator([session]) }))
    };
    const linker = new ConversationLinker({ stateStore });
    linker.codexSessionsDir = codexRoot;

    await linker.linkAll();
    const updated = stateStore.mutateSessions.mock.calls[0][0]([session])[0];

    expect(updated.codexThreadId).toBe(parentId);
    expect(updated.conversationSummary.lastConversation.resumeId).toBe(parentId);
    expect(updated.conversationSummary.lastConversation.threadSource).toBe('user');
    expect(updated.conversationSummary.lastConversation.messageCount).toBe(3);
  });

  it('linkAll再実行時_未変更のCodexログは全ファイル走査をスキップしてキャッシュを再利用する', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-skip-'));
    tempDirs.push(codexRoot);
    const cwd = '/tmp/session-skip-unchanged';
    const id = '019e7000-0000-7000-8000-000000000099';
    await createCodexSessionFile(codexRoot, {
      cwd,
      id,
      extraLines: [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'main work' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '本体ログです' } })
      ]
    });

    const session = { id: 'session-skip', path: cwd, worktree: { path: cwd } };
    let current = [session];
    const stateStore = {
      get: vi.fn(() => ({ sessions: current })),
      mutateSessions: vi.fn(async (mutator) => {
        current = await mutator(current);
        return { sessions: current };
      })
    };
    const linker = new ConversationLinker({ stateStore });
    linker.codexSessionsDir = codexRoot;
    const buildSpy = vi.spyOn(linker, '_buildCodexConversationFromFile');

    await linker.linkAll();
    expect(buildSpy).toHaveBeenCalledTimes(1);

    // 2回目: ファイルは未変更なので _buildCodexConversationFromFile は呼ばれない
    await linker.linkAll();
    expect(buildSpy).toHaveBeenCalledTimes(1);

    expect(current[0].conversationSummary.lastConversation.messageCount).toBe(3);
  });

  it('story-brainbase-session-resume-integrity-guard CON-1a top-level session_meta形式も読む', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-session-meta-'));
    tempDirs.push(codexRoot);
    const cwd = '/tmp/session-meta-compat';
    const id = '019e6a4d-2ea6-7be9-a3c7-a04b736060c1';
    const filePath = await createCodexSessionFile(codexRoot, {
      cwd,
      id,
      metadataShape: 'top-level'
    });
    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [] }), update: async () => ({ sessions: [] }) }
    });

    await expect(linker.getCodexSessionMeta(filePath)).resolves.toMatchObject({
      id,
      cwd,
      threadSource: 'user'
    });
  });

  it('story-brainbase-session-resume-integrity-guard CON-3 API会話一覧でもCodex messageCountがJSONL行数になる', async () => {
    const codexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-codex-api-message-count-'));
    tempDirs.push(codexRoot);
    const cwd = '/tmp/session-api-message-count';
    const id = '019e6a4d-2ea6-7be9-a3c7-a04b736060c2';
    await createCodexSessionFile(codexRoot, {
      cwd,
      id,
      extraLines: [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'main work' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '本体ログです' } })
      ]
    });
    const session = {
      id: 'session-api-message-count',
      path: cwd,
      worktree: { path: cwd }
    };
    const linker = new ConversationLinker({
      stateStore: { get: () => ({ sessions: [session] }), update: async () => ({ sessions: [session] }) }
    });
    linker.codexSessionsDir = codexRoot;

    const result = await linker.getConversationsForSession(session.id);
    const codexConversation = result.conversations.find((conversation) => conversation.engine === 'codex');

    expect(codexConversation).toMatchObject({
      resumeId: id,
      messageCount: 3
    });
  });
});
