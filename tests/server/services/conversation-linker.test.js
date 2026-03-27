import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

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
});
