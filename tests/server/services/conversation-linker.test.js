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
});
