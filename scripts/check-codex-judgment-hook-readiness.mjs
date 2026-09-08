#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REQUIRED_HOOKS = [
    { eventName: 'userPromptSubmit', matcher: null, required: true },
    { eventName: 'postToolUse', matcher: '.*', required: true },
    { eventName: 'postToolUseFailure', matcher: '.*', required: false },
    { eventName: 'stop', matcher: null, required: true }
];
const CANONICAL_ENTRYPOINT = 'scripts/codex-hooks/judgment-resolver-entry.sh';
const READY_TRUST_STATUSES = new Set(['trusted', 'managed']);
const CODEX_DESKTOP_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex';

export function resolveDefaultCodexBin({
    platform = process.platform,
    exists = existsSync
} = {}) {
    if (platform === 'darwin' && exists(CODEX_DESKTOP_BIN)) return CODEX_DESKTOP_BIN;
    return 'codex';
}

function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function canonicalResolverHook(hook) {
    return typeof hook?.command === 'string' && hook.command.includes(CANONICAL_ENTRYPOINT);
}

function eventResult(required, candidates) {
    // Disabled global definitions do not execute alongside a scoped canary.
    // Keep disabled candidates when none are enabled so missing and disabled
    // remain distinguishable.
    const enabledCandidates = candidates.filter((hook) => hook.enabled === true);
    if (enabledCandidates.length > 0) candidates = enabledCandidates;
    if (candidates.length === 0) {
        if (!required.required) {
            return {
                event_name: required.eventName,
                status: 'not_enumerated',
                required: false,
                enabled: false,
                trust_status: 'not_applicable',
                matcher_valid: true
            };
        }
        return {
            event_name: required.eventName,
            status: 'missing',
            required: true,
            enabled: false,
            trust_status: 'missing',
            matcher_valid: false
        };
    }
    if (candidates.length > 1) {
        return {
            event_name: required.eventName,
            status: 'duplicate',
            required: true,
            enabled: candidates.every((hook) => hook.enabled === true),
            trust_status: 'ambiguous',
            matcher_valid: false
        };
    }
    const hook = candidates[0];
    const matcher = hook.matcher ?? null;
    const matcherValid = matcher === required.matcher;
    const enabled = hook.enabled === true;
    const trustStatus = typeof hook.trustStatus === 'string' ? hook.trustStatus : 'missing';
    let status = 'ready';
    if (!enabled) status = 'disabled';
    else if (!matcherValid) status = 'matcher_mismatch';
    else if (!READY_TRUST_STATUSES.has(trustStatus)) status = 'trust_required';
    return {
        event_name: required.eventName,
        status,
        required: true,
        enabled,
        trust_status: trustStatus,
        matcher_valid: matcherValid,
        key: typeof hook.key === 'string' ? hook.key : null,
        command: typeof hook.command === 'string' ? hook.command : null
    };
}

export function evaluateHookReadiness(hooksListResult, { cwd = process.cwd() } = {}) {
    const data = Array.isArray(hooksListResult?.data) ? hooksListResult.data : [];
    const cwdEntry = data.find((entry) => (
        typeof entry?.cwd === 'string' && resolve(entry.cwd) === resolve(cwd)
    ));
    if (!cwdEntry) {
        return {
            status: 'probe_error',
            ready: false,
            cwd,
            events: [],
            errors: ['hooks_list_cwd_missing'],
            next_action: 'Rerun the readiness check for the target repository.'
        };
    }

    const errors = Array.isArray(cwdEntry.errors) ? cwdEntry.errors.map(String) : [];
    if (errors.length > 0) {
        return {
            status: 'probe_error',
            ready: false,
            cwd,
            events: [],
            errors: ['hooks_list_reported_errors'],
            next_action: 'Resolve the Codex hook configuration errors and rerun the readiness check.'
        };
    }

    const hooks = Array.isArray(cwdEntry.hooks) ? cwdEntry.hooks : [];
    const events = REQUIRED_HOOKS.map((required) => eventResult(
        required,
        hooks.filter((hook) => hook?.eventName === required.eventName && canonicalResolverHook(hook))
    ));
    const diagnosticContinue = events.some((event) =>
        /(?:^|\s)BRAINBASE_JUDGMENT_START_FAILURE_MODE=(?:diagnostic_continue|"diagnostic_continue"|'diagnostic_continue')(?=\s|$)/.test(event.command ?? '')
    );
    if (diagnosticContinue) {
        events.push(eventResult(
            { eventName: 'preToolUse', matcher: '*', required: true },
            hooks.filter((hook) => hook?.eventName === 'preToolUse' && canonicalResolverHook(hook))
        ));
    }
    const compatibilityGaps = events.some((event) => (
        event.event_name === 'postToolUseFailure' && event.status === 'not_enumerated'
    )) ? ['postToolUseFailure_not_enumerated_by_host'] : [];
    const commands = new Set(events.map((event) => event.command).filter(Boolean));
    const configurationError = events.some((event) => [
        'duplicate', 'disabled', 'matcher_mismatch'
    ].includes(event.status)) || commands.size > 1;
    const trustRequired = events.some((event) => [
        'missing', 'trust_required'
    ].includes(event.status));

    if (configurationError) {
        return {
            status: 'configuration_error',
            ready: false,
            cwd,
            events,
            compatibility_gaps: compatibilityGaps,
            errors: commands.size > 1 ? ['resolver_entrypoint_mismatch'] : [],
            next_action: 'Repair the canonical Resolver hook definitions before approving them.'
        };
    }
    if (trustRequired) {
        return {
            status: 'trust_required',
            ready: false,
            cwd,
            events,
            compatibility_gaps: compatibilityGaps,
            errors: [],
            next_action: `Open /hooks and approve the ${events.filter((event) => event.required).length === 4 ? 'four' : 'three'} current Resolver hooks.`
        };
    }
    const observationOnly = events.some((event) =>
        /(?:^|\s)BRAINBASE_JUDGMENT_HOOK_MODE=(?:record_only|"record_only"|'record_only')(?=\s|$)/.test(event.command ?? '')
    );
    if (observationOnly) {
        return {
            status: 'observation_only',
            ready: false,
            cwd,
            events,
            compatibility_gaps: compatibilityGaps,
            errors: ['judgment_audit_not_enabled'],
            next_action: 'Recording is enabled, but judgment audit is not. Configure and approve the scoped audit hooks before live verification.'
        };
    }
    return {
        status: 'ready_for_fresh_task',
        ready: true,
        cwd,
        events,
        compatibility_gaps: compatibilityGaps,
        errors: [],
        next_action: 'Create a new Codex Desktop task and prove one live judgment episode.'
    };
}

function send(child, message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
}

export function queryCodexHooks({
    cwd = process.cwd(),
    codexBin = resolveDefaultCodexBin(),
    timeoutMs = 10_000
} = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(codexBin, ['app-server', '--listen', 'stdio://'], {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            child.kill('SIGTERM');
            callback(value);
        };
        const timeout = setTimeout(() => {
            finish(rejectPromise, new Error('codex_hooks_list_timeout'));
        }, timeoutMs);

        child.on('error', () => finish(rejectPromise, new Error('codex_app_server_start_failed')));
        child.on('close', (code) => {
            if (!settled) finish(rejectPromise, new Error(`codex_app_server_closed:${code ?? 'unknown'}`));
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            for (;;) {
                const boundary = stdout.indexOf('\n');
                if (boundary < 0) break;
                const line = stdout.slice(0, boundary);
                stdout = stdout.slice(boundary + 1);
                if (!line.trim()) continue;
                let message;
                try { message = JSON.parse(line); } catch {
                    finish(rejectPromise, new Error('codex_app_server_response_invalid'));
                    return;
                }
                if (message.id === 1) {
                    if (message.error) {
                        finish(rejectPromise, new Error('codex_app_server_initialize_failed'));
                        return;
                    }
                    send(child, { method: 'initialized' });
                    send(child, { method: 'hooks/list', id: 2, params: { cwds: [cwd] } });
                }
                if (message.id === 2) {
                    if (message.error || !record(message.result)) {
                        finish(rejectPromise, new Error('codex_hooks_list_failed'));
                        return;
                    }
                    finish(resolvePromise, message.result);
                    return;
                }
            }
        });

        send(child, {
            method: 'initialize',
            id: 1,
            params: {
                clientInfo: { name: 'brainbase-judgment-hook-readiness', version: '1.0.0' },
                capabilities: { experimentalApi: true }
            }
        });
    });
}

export async function checkHookReadiness(options = {}) {
    const cwd = resolve(options.cwd || process.cwd());
    try {
        const result = await queryCodexHooks({ ...options, cwd });
        return evaluateHookReadiness(result, { cwd });
    } catch (error) {
        return {
            status: 'probe_error',
            ready: false,
            cwd,
            events: [],
            errors: [error instanceof Error ? error.message : String(error)],
            next_action: 'Confirm the Codex app-server is available, then rerun the readiness check.'
        };
    }
}

function parseArguments(argv) {
    const options = {
        cwd: process.cwd(),
        codexBin: resolveDefaultCodexBin(),
        timeoutMs: 10_000,
        json: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--json') options.json = true;
        else if (argument === '--cwd') options.cwd = argv[++index];
        else if (argument === '--codex-bin') options.codexBin = argv[++index];
        else if (argument === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
        else throw new Error(`unknown_argument:${argument}`);
    }
    if (!options.cwd || !options.codexBin || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error('invalid_arguments');
    }
    return options;
}

function humanOutput(result) {
    const lines = [`Judgment Hook readiness: ${result.status}`];
    for (const event of result.events) {
        lines.push(`- ${event.event_name}: ${event.status} (trust=${event.trust_status})`);
    }
    lines.push(`Next: ${result.next_action}`);
    return `${lines.join('\n')}\n`;
}

async function main() {
    let options;
    try { options = parseArguments(process.argv.slice(2)); } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
        return;
    }
    const result = await checkHookReadiness(options);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : humanOutput(result));
    if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) await main();
