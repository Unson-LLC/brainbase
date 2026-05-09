import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function createCurlStub(dir) {
    const stubPath = path.join(dir, 'curl');
    writeFileSync(stubPath, `#!/bin/sh
headers=""
prev=""
for arg in "$@"; do
  case "$arg" in
    *"/api/version"*) exit 0 ;;
    *"/api/csrf-token"*) printf '{"token":"test-csrf-token"}'; exit 0 ;;
  esac
done
payload=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-H" ]; then
    headers="$headers$arg\\n"
  fi
  if [ "$prev" = "-d" ]; then
    payload="$arg"
    break
  fi
  prev="$arg"
done
if [ -n "$payload" ]; then
  printf '%s\\n' "$payload" >> "$CURL_LOG"
  if [ -n "$CURL_HEADER_LOG" ]; then
    printf '%s' "$headers" >> "$CURL_HEADER_LOG"
  fi
fi
exit 0
`);
    spawnSync('chmod', ['+x', stubPath]);
}

function readReports(logPath) {
    const content = readFileSync(logPath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function runHook(payload) {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'codex-hooks-activity-'));
    const logPath = path.join(tempDir, 'curl.log');
    const headerLogPath = path.join(tempDir, 'curl-headers.log');
    writeFileSync(logPath, '');
    writeFileSync(headerLogPath, '');
    createCurlStub(tempDir);

    const result = spawnSync('bash', ['scripts/codex-hooks-activity.sh'], {
        cwd: repoRoot,
        input: JSON.stringify(payload),
        env: {
            ...process.env,
            PATH: `${tempDir}:${process.env.PATH}`,
            CURL_LOG: logPath,
            CURL_HEADER_LOG: headerLogPath,
            TMPDIR: tempDir,
            BRAINBASE_SESSION_ID: 'session-codex-hooks-test',
            BRAINBASE_PORT: '31013'
        },
        encoding: 'utf8'
    });

    return { result, reports: readReports(logPath), headers: readFileSync(headerLogPath, 'utf8') };
}

describe('codex-hooks-activity.sh', () => {
    it('SessionStart受信時_入力待ちとしてdoneを報告する', () => {
        const { result, reports } = runHook({
            hook_event_name: 'SessionStart',
            source: 'startup'
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(reports).toEqual([
            expect.objectContaining({
                sessionId: 'session-codex-hooks-test',
                status: 'done',
                lifecycle: 'turn_completed',
                eventType: 'codex/hook/SessionStart',
                activityKind: 'waiting_input',
                currentStep: '入力待ち'
            })
        ]);
    });

    it('UserPromptSubmit受信時_turn_startedとしてworkingを報告する', () => {
        const { result, reports, headers } = runHook({
            hook_event_name: 'UserPromptSubmit',
            turn_id: 'turn-hook-1',
            prompt: '青インジケーターを直して'
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(reports).toEqual([
            expect.objectContaining({
                sessionId: 'session-codex-hooks-test',
                status: 'working',
                lifecycle: 'turn_started',
                eventType: 'codex/hook/UserPromptSubmit',
                turnId: 'turn-hook-1',
                activityKind: 'task_started',
                currentStep: '依頼を受けて作業開始'
            })
        ]);
        expect(headers).toContain('X-Session-Id: session-codex-hooks-test');
        expect(headers).toContain('X-CSRF-Token: test-csrf-token');
    });

    it('Stop受信時_turn_completedとしてdoneを報告する', () => {
        const { result, reports } = runHook({
            hook_event_name: 'Stop',
            turn_id: 'turn-hook-2',
            last_assistant_message: '修正しました'
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(reports).toEqual([
            expect.objectContaining({
                sessionId: 'session-codex-hooks-test',
                status: 'done',
                lifecycle: 'turn_completed',
                eventType: 'codex/hook/Stop',
                turnId: 'turn-hook-2',
                activityKind: 'task_completed',
                currentStep: '作業が一区切り完了'
            })
        ]);
    });

    it('hooks.jsonは実在するhookスクリプトだけを参照する', () => {
        const config = JSON.parse(readFileSync(path.join(repoRoot, '.codex/hooks.json'), 'utf8'));
        const commands = Object.values(config.hooks)
            .flat()
            .flatMap((group) => group.hooks)
            .map((hook) => hook.command);

        expect(config.hooks.SessionStart[0].matcher).toBe('startup|resume|clear');
        expect(commands.length).toBeGreaterThan(0);
        for (const command of commands) {
            expect(command).toContain('scripts/codex-hooks-activity.sh');
            expect(existsSync(path.join(repoRoot, 'scripts/codex-hooks-activity.sh'))).toBe(true);
        }
    });

    it('Codex起動時_hooks機能をconfigで有効化する', () => {
        const loginScript = readFileSync(path.join(repoRoot, 'scripts/login_script.sh'), 'utf8');
        const ensureRuntime = readFileSync(path.join(repoRoot, 'scripts/ensure_session_runtime.sh'), 'utf8');
        const codexConfig = readFileSync(path.join(repoRoot, '.codex/config.toml'), 'utf8');

        expect(loginScript).toContain('features.hooks=true');
        expect(ensureRuntime).toContain('features.hooks=true');
        expect(codexConfig).toContain('hooks = true');
        expect(loginScript).not.toContain('features.codex_hooks=true');
        expect(ensureRuntime).not.toContain('features.codex_hooks=true');
        expect(codexConfig).not.toContain('codex_hooks = true');
    });
});
