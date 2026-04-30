import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function createCurlStub(dir, logPath) {
    const stubPath = path.join(dir, 'curl');
    writeFileSync(stubPath, `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *"/api/version"*) exit 0 ;;
  esac
done
payload=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-d" ]; then
    payload="$arg"
    break
  fi
  prev="$arg"
done
if [ -n "$payload" ]; then
  printf '%s\\n' "$payload" >> "$CURL_LOG"
fi
exit 0
`);
    spawnSync('chmod', ['+x', stubPath]);
    return logPath;
}

function waitForPayloads(logPath, expectedCount) {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
        try {
            const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
            if (lines.length >= expectedCount) {
                return lines.map((line) => JSON.parse(line));
            }
        } catch {
            // background curl has not written yet
        }
    }
    try {
        return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
        return [];
    }
}

describe('codex-notify.sh', () => {
    it('turnId付きheartbeat受信時_開始イベントなしでもworkingを報告する', () => {
        const tempDir = mkdtempSync(path.join(tmpdir(), 'codex-notify-'));
        const logPath = path.join(tempDir, 'curl.log');
        createCurlStub(tempDir, logPath);

        const payload = {
            type: 'item/commandExecution/outputDelta',
            turnId: 'turn-1',
            params: { command: 'npm test' }
        };
        const result = spawnSync('zsh', ['scripts/codex-notify.sh', JSON.stringify(payload)], {
            cwd: repoRoot,
            env: {
                ...process.env,
                PATH: `${tempDir}:${process.env.PATH}`,
                CURL_LOG: logPath,
                TMPDIR: tempDir,
                BRAINBASE_SESSION_ID: 'session-codex-notify-test',
                BRAINBASE_PORT: '31013'
            },
            encoding: 'utf8'
        });

        expect(result.status).toBe(0);
        const reports = waitForPayloads(logPath, 2);
        expect(reports).toEqual([
            expect.objectContaining({
                status: 'working',
                lifecycle: 'turn_started',
                eventType: 'item/commandExecution/outputDelta-synthetic',
                turnId: 'turn-1'
            }),
            expect.objectContaining({
                status: 'working',
                lifecycle: 'heartbeat',
                eventType: 'item/commandExecution/outputDelta',
                turnId: 'turn-1',
                activityKind: 'running_command'
            })
        ]);
    });

    it('turn_completed判定にturn/completedを含める', () => {
        const script = readFileSync(path.join(repoRoot, 'scripts/codex-notify.sh'), 'utf8');
        expect(script).toMatch(/task_complete\|codex\/event\/task_complete\|turn\/completed\|turn\/failed/);
    });
});
