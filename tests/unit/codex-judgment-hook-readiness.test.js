import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    checkHookReadiness,
    evaluateHookReadiness,
    queryCodexHooks,
    resolveDefaultCodexBin
} from '../../scripts/check-codex-judgment-hook-readiness.mjs';

const temporaryPaths = [];
const cwd = process.cwd();
const command = 'bash /runtime/scripts/codex-hooks/judgment-resolver-entry.sh';

function hook(eventName, overrides = {}) {
    return {
        key: `/hooks.json:${eventName}:0:0`,
        eventName,
        matcher: ['postToolUse', 'postToolUseFailure'].includes(eventName) ? '.*' : null,
        command,
        enabled: true,
        trustStatus: 'trusted',
        ...overrides
    };
}

function result(hooks = [hook('userPromptSubmit'), hook('postToolUse'), hook('postToolUseFailure'), hook('stop')], overrides = {}) {
    return {
        data: [{ cwd, hooks, warnings: [], errors: [], ...overrides }]
    };
}

function fakeCodex(response, { silent = false } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'brainbase-codex-hooks-'));
    temporaryPaths.push(root);
    const path = join(root, 'codex');
    const body = silent
        ? `#!/usr/bin/env node\nprocess.stdin.resume();\n`
        : `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf('\\n');
    if (boundary < 0) break;
    const line = input.slice(0, boundary);
    input = input.slice(boundary + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\\n');
    if (message.id === 2) process.stdout.write(JSON.stringify({ id: 2, result: ${JSON.stringify(response)} }) + '\\n');
  }
});
`;
    writeFileSync(path, body);
    chmodSync(path, 0o755);
    return path;
}

afterEach(() => {
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Codex Judgment Hook readiness', () => {
    it('macOSではDesktop同梱Codexを優先し、他環境ではPATHへfallbackする', () => {
        expect(resolveDefaultCodexBin({ platform: 'darwin', exists: () => true }))
            .toBe('/Applications/ChatGPT.app/Contents/Resources/codex');
        expect(resolveDefaultCodexBin({ platform: 'darwin', exists: () => false })).toBe('codex');
        expect(resolveDefaultCodexBin({ platform: 'linux', exists: () => true })).toBe('codex');
    });

    it('4つのcanonical Hookがcurrent trustならready_for_fresh_taskまで進める', () => {
        expect(evaluateHookReadiness(result(), { cwd })).toMatchObject({
            status: 'ready_for_fresh_task',
            ready: true,
            events: [
                { event_name: 'userPromptSubmit', status: 'ready', trust_status: 'trusted' },
                { event_name: 'postToolUse', status: 'ready', trust_status: 'trusted' },
                { event_name: 'postToolUseFailure', status: 'ready', trust_status: 'trusted' },
                { event_name: 'stop', status: 'ready', trust_status: 'trusted' }
            ]
        });
    });

    it('1つでもmodifiedならtrust_requiredにしてactiveとは呼ばない', () => {
        const checked = evaluateHookReadiness(result([
            hook('userPromptSubmit'),
            hook('postToolUse', { trustStatus: 'modified' }),
            hook('postToolUseFailure'),
            hook('stop')
        ]), { cwd });

        expect(checked).toMatchObject({
            status: 'trust_required',
            ready: false,
            next_action: 'Open /hooks and approve the four current Resolver hooks.'
        });
        expect(JSON.stringify(checked)).not.toContain('currentHash');
        expect(JSON.stringify(checked)).not.toContain('trusted_hash');
    });

    it.each([
        ['missing', [hook('userPromptSubmit'), hook('postToolUse'), hook('postToolUseFailure')], 'trust_required'],
        ['duplicate', [hook('userPromptSubmit'), hook('postToolUse'), hook('postToolUseFailure'), hook('stop'), hook('stop')], 'configuration_error'],
        ['disabled', [hook('userPromptSubmit'), hook('postToolUse'), hook('postToolUseFailure'), hook('stop', { enabled: false })], 'configuration_error'],
        ['matcher mismatch', [hook('userPromptSubmit'), hook('postToolUse', { matcher: '*' }), hook('postToolUseFailure'), hook('stop')], 'configuration_error']
    ])('%sをreadiness成功にしない', (_name, hooks, status) => {
        expect(evaluateHookReadiness(result(hooks), { cwd })).toMatchObject({ status, ready: false });
    });

    it('Codexが返したconfiguration errorをprobe_errorとして可視化する', () => {
        expect(evaluateHookReadiness(result([], { errors: ['invalid hook'] }), { cwd })).toMatchObject({
            status: 'probe_error',
            ready: false,
            errors: ['hooks_list_reported_errors']
        });
    });

    it('別cwdのhooks/list結果を対象repoのreadinessとして採用しない', () => {
        const otherCwd = join(cwd, 'other-repository');
        expect(evaluateHookReadiness({
            data: [{ cwd: otherCwd, hooks: result().data[0].hooks, warnings: [], errors: [] }]
        }, { cwd })).toMatchObject({
            status: 'probe_error',
            ready: false,
            errors: ['hooks_list_cwd_missing']
        });
    });

    it('fresh app-serverへinitializeしてからhooks/listを取得する', async () => {
        const codexBin = fakeCodex(result());
        await expect(queryCodexHooks({ cwd, codexBin, timeoutMs: 2_000 })).resolves.toEqual(result());
    });

    it('app-server timeoutを成功にせずprobe_errorへ畳む', async () => {
        const codexBin = fakeCodex({}, { silent: true });
        await expect(checkHookReadiness({ cwd, codexBin, timeoutMs: 50 })).resolves.toMatchObject({
            status: 'probe_error',
            ready: false,
            errors: ['codex_hooks_list_timeout']
        });
    });

    it('CLIはmodifiedをJSONで示して非zero終了する', () => {
        const modified = result([
            hook('userPromptSubmit'),
            hook('postToolUse', { trustStatus: 'modified' }),
            hook('postToolUseFailure'),
            hook('stop')
        ]);
        const codexBin = fakeCodex(modified);
        const processResult = spawnSync(process.execPath, [
            'scripts/check-codex-judgment-hook-readiness.mjs',
            '--cwd', cwd,
            '--codex-bin', codexBin,
            '--json'
        ], { cwd: process.cwd(), encoding: 'utf8' });

        expect(processResult.status).toBe(1);
        expect(JSON.parse(processResult.stdout)).toMatchObject({
            status: 'trust_required',
            ready: false
        });
    });
});
