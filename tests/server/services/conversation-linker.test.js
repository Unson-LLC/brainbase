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

async function createCodexSessionFile(rootDir, { year = '2026', month = '05', day = '07', file = 'rollout-test.jsonl', cwd }) {
  const dayDir = path.join(rootDir, year, month, day);
  await fs.mkdir(dayDir, { recursive: true });
  const filePath = path.join(dayDir, file);
  await fs.writeFile(filePath, `${JSON.stringify({ type: 'session_meta', cwd })}\n`, 'utf8');
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
});
