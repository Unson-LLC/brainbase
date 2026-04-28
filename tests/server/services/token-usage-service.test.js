import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getLocalWeekStart, TokenUsageService } from '../../../server/services/token-usage-service.js';

const tempDirs = [];

async function createLogFile(root, relativePath, lines) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
}

describe('TokenUsageService', () => {
    afterEach(async () => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('getLocalWeekStart returns Monday 00:00 local time', () => {
        const start = getLocalWeekStart(new Date('2026-04-28T12:30:00+09:00'));
        expect(start.getDay()).toBe(1);
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);
    });

    it('aggregates current-week Codex and Claude token usage', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-token-usage-'));
        tempDirs.push(root);
        const codexDir = path.join(root, 'codex');
        const claudeDir = path.join(root, 'claude');

        await createLogFile(codexDir, '2026/04/27/rollout.jsonl', [
            JSON.stringify({
                timestamp: '2026-04-27T01:00:00.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        last_token_usage: {
                            input_tokens: 100,
                            cached_input_tokens: 50,
                            output_tokens: 20,
                            reasoning_output_tokens: 5,
                            total_tokens: 175
                        }
                    }
                }
            }),
            JSON.stringify({
                timestamp: '2026-04-20T01:00:00.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        last_token_usage: {
                            input_tokens: 999,
                            total_tokens: 999
                        }
                    }
                }
            })
        ]);

        await createLogFile(claudeDir, 'project/session.jsonl', [
            JSON.stringify({
                timestamp: '2026-04-27T02:00:00.000Z',
                type: 'assistant',
                requestId: 'req_1',
                message: {
                    id: 'msg_1',
                    usage: {
                        input_tokens: 3,
                        cache_creation_input_tokens: 40,
                        cache_read_input_tokens: 60,
                        output_tokens: 7
                    }
                }
            }),
            JSON.stringify({
                timestamp: '2026-04-27T02:00:01.000Z',
                type: 'assistant',
                requestId: 'req_1',
                message: {
                    id: 'msg_1',
                    usage: {
                        input_tokens: 3,
                        cache_creation_input_tokens: 40,
                        cache_read_input_tokens: 60,
                        output_tokens: 7
                    }
                }
            })
        ]);

        const service = new TokenUsageService({
            codexSessionsDir: codexDir,
            claudeProjectsDir: claudeDir,
            cacheTtlMs: 0
        });

        const result = await service.getWeeklyUsage({
            now: new Date('2026-04-28T03:00:00.000Z')
        });

        expect(result.engines.codex.totalTokens).toBe(175);
        expect(result.engines.claude.totalTokens).toBe(110);
        expect(result.totalTokens).toBe(285);
        expect(result.engines.claude.events).toBe(1);
        expect(result.events).toBe(2);
    });
});
