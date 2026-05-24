import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);

test('oyasumi-conversation-personal-kg ac:1 ac:2 ac:3 ac:4 CLI contract', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oyasumi-conversation-e2e-'));
  const inputPath = path.join(tempDir, 'conversation.jsonl');
  const outputDir = path.join(tempDir, 'out');
  await fs.writeFile(inputPath, [
    JSON.stringify({
      source_tool: 'codex',
      session_id: 'e2e-session',
      timestamp: '2026-05-23T12:00:00.000+09:00',
      text: 'personal KGは議事録だけでなくCodexやClaude Codeとの会話ログも日次で拾うべき。meeting 0件をPersonal KG 0件として扱わない。'
    }),
    JSON.stringify({
      source_tool: 'claude_code',
      session_id: 'e2e-session',
      timestamp: '2026-05-23T12:05:00.000+09:00',
      text: 'OpenRouterは使わない。semanticはCodex subagent、Mana captureはBedrock設定を正にする。'
    })
  ].join('\n'));

  const { stdout } = await execFileAsync('node', [
    'scripts/oyasumi-conversation-personal-kg.js',
    '--date',
    '2026-05-23',
    '--input',
    inputPath,
    '--output-dir',
    outputDir,
    '--json'
  ], { cwd: process.cwd() });

  const result = JSON.parse(stdout);
  expect(result.mode).toBe('dry-run');
  expect(result.extracted.input_count).toBe(2);
  expect(result.extracted.deduped_count).toBe(2);
  expect(result.extracted.adopted.length).toBeGreaterThan(0);

  const messagesMode = (await fs.stat(result.messages_path)).mode & 0o777;
  const extractionMode = (await fs.stat(result.extraction_path)).mode & 0o777;
  expect(messagesMode).toBe(0o600);
  expect(extractionMode).toBe(0o600);
});
