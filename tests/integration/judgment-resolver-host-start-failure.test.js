import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJson } from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const REPO_ROOT = process.cwd();
const WRAPPER = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
const temporaryPaths = [];
const servers = [];

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function temporaryDirectory() {
    const path = mkdtempSync(join(tmpdir(), 'brainbase-judgment-start-failure-'));
    temporaryPaths.push(path);
    return path;
}

function runEntrypoint({ env, payload, timeoutMs = 5000 }) {
    return new Promise((resolve, reject) => {
        const child = spawn('bash', [WRAPPER], { cwd: REPO_ROOT, env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`start-failure entrypoint timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            resolve({ code, signal, stdout, stderr });
        });
        child.stdin.end(JSON.stringify(payload));
    });
}

async function listen(handler) {
    const server = createServer(handler);
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', resolve);
        server.once('error', reject);
    });
    servers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

async function closedLoopbackUrl() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return url;
}

function startPayload(sessionId, turnId, prompt) {
    return {
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId,
        turn_id: turnId,
        cwd: REPO_ROOT,
        prompt
    };
}

function diagnosticPath(journal, payload) {
    return join(
        journal,
        'diagnostics',
        hash(payload.session_id),
        `${hash(payload.turn_id)}.start-failure.json`
    );
}

function expectSafeDiagnostic(diagnostic, prompt) {
    expect(diagnostic).toMatchObject({
        schema_version: 'brainbase-judgment-start-failure-v1',
        failed_stage: expect.any(String),
        reason: expect.any(String),
        error_chain: expect.any(Array),
        elapsed_ms: expect.any(Number),
        audit_status: 'incomplete',
        action_authorized: false
    });
    expect(diagnostic.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(diagnostic.error_chain.length).toBeGreaterThan(0);
    for (const error of diagnostic.error_chain) {
        expect(error).toEqual(expect.objectContaining({
            name: expect.any(String),
            code: expect.anything(),
            reason: expect.any(String)
        }));
        expect(error).not.toHaveProperty('message');
        expect(error).not.toHaveProperty('stack');
    }
    const serialized = JSON.stringify(diagnostic);
    if (typeof prompt === 'string') expect(serialized).not.toContain(prompt);
    expect(serialized).not.toContain('stack');
}

function expectDiagnosticContinue(output) {
    expect(output).toMatchObject({
        continue: true,
        suppressOutput: false,
        systemMessage: expect.any(String)
    });
    expect(output.systemMessage).toMatch(/監査.*未完了|未完了.*監査/u);
    expect(output.systemMessage).toMatch(/権限.*追加なし|追加.*権限.*なし/u);
    expect(output.systemMessage).toMatch(/通常の権限・承認境界.*復旧診断tool/u);
}

function expectDegradedPreTool(output) {
    expect(output).toMatchObject({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: expect.stringContaining('通常の権限・承認境界')
        }
    });
    expect(output.hookSpecificOutput).not.toHaveProperty('permissionDecision');
}

function readJsonOutput(stdout) {
    const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0]);
}

function readSafeStderr(stderr, prompt) {
    const line = stderr.trim().split(/\r?\n/u).reverse().find((candidate) => candidate.trim().startsWith('{'));
    expect(line, stderr).toBeTruthy();
    const diagnostic = JSON.parse(line);
    expect(diagnostic).toEqual(expect.objectContaining({ reason: expect.any(String) }));
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(prompt);
    expect(serialized).not.toContain('stack');
    expect(diagnostic).not.toHaveProperty('message');
    return diagnostic;
}

function managedReceipt(request) {
    return {
        resolution_id: 'jr_start_failure_persist',
        turn_id: request.turn_id,
        request_digest: hash(canonicalJson(request)),
        context_digest: hash(canonicalJson(request.conversation_context)),
        status: 'resolved',
        host_binding: { status: 'managed' },
        classification: {
            intent: 'answer',
            domains: ['operations'],
            action_kind: 'read'
        },
        classification_assurance: 'confirmed',
        selected_dag_ids: ['operations.v1'],
        required_capabilities: [],
        active_node_definitions: [{ id: 'answer', kind: 'common', instruction: 'Answer the request.' }]
    };
}

async function failureCase(name, root, payload) {
    if (name === 'Host成功') {
        return {
            hostUrl: await listen((request, response) => {
                let body = '';
                request.setEncoding('utf8');
                request.on('data', (chunk) => { body += chunk; });
                request.on('end', () => {
                    const hostRequest = JSON.parse(body);
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({
                        management_status: 'managed',
                        receipt: managedReceipt(hostRequest)
                    }));
                });
            }),
            journal: root
        };
    }
    if (name === 'Host接続失敗') {
        return { hostUrl: await closedLoopbackUrl(), journal: root };
    }
    if (name === 'Host不正応答') {
        return {
            hostUrl: await listen((request, response) => {
                request.resume();
                request.on('end', () => {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({
                        management_status: 'unexpected',
                        reason: 'judgment_host_invalid_response'
                    }));
                });
            }),
            journal: root
        };
    }
    if (name === 'Host timeout') {
        return {
            hostUrl: await listen((request, response) => {
                request.resume();
                request.on('end', () => {
                    // Keep the local test server silent until the child aborts.
                    setTimeout(() => response.destroy(), 500);
                });
            }),
            journal: root,
            timeoutMs: '20'
        };
    }
    if (name === 'journal root作成失敗') {
        // A file as the journal root makes the transition-directory creation
        // fail before the episode can be persisted, without contacting a live
        // Host. The diagnostic fallback must remain owner-safe on stderr.
        const journalFile = join(root, 'journal-root-is-a-file');
        writeFileSync(journalFile, 'not a directory\n');
        return { journal: journalFile, hostUrl: await closedLoopbackUrl() };
    }
    if (name === 'episode永続化失敗') {
        const journal = join(root, 'journal');
        return {
            hostUrl: await listen((request, response) => {
                let body = '';
                request.setEncoding('utf8');
                request.on('data', (chunk) => { body += chunk; });
                request.on('end', () => {
                    const hostRequest = JSON.parse(body);
                    // The episode directory is created only after the Host
                    // response, so this exercises createImmutableJson/readJson
                    // persistence rather than transition-directory setup.
                    const episodePath = join(
                        journal,
                        hostRequest.conversation_context.session_ref,
                        `${hash(hostRequest.turn_id)}.episode.json`
                    );
                    mkdirSync(episodePath, { recursive: true });
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({
                        management_status: 'managed',
                        receipt: managedReceipt(hostRequest)
                    }));
                });
            }),
            journal
        };
    }
    throw new Error(`unknown failure case: ${name}`);
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Judgment Resolver Host UserPromptSubmit start failures', () => {
    it.each([
        'Host接続失敗',
        'Host不正応答',
        'Host timeout',
        'journal root作成失敗',
        'episode永続化失敗'
    ])('既定モードは%sでも診断付きで継続し、安全な診断を残す', async (name) => {
        const root = temporaryDirectory();
        const payload = startPayload(
            `session-start-failure-default-${name}`,
            `turn-start-failure-default-${name}`,
            `秘密の入力-${name}-default`
        );
        const setup = await failureCase(name, root, payload);
        const result = await runEntrypoint({
            env: {
                ...process.env,
                BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl ?? 'http://127.0.0.1:9'}/host/judgment/resolve`,
                BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: setup.timeoutMs ?? '100',
                BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal
            },
            payload
        });

        expect(result).toMatchObject({ code: 0, signal: null });
        expectDiagnosticContinue(readJsonOutput(result.stdout));
        if (name === 'journal root作成失敗') {
            readSafeStderr(result.stderr, payload.prompt);
        } else {
            const path = diagnosticPath(setup.journal, payload);
            expectSafeDiagnostic(JSON.parse(readFileSync(path, 'utf8')), payload.prompt);
        }
    }, 10_000);

    it.each([
        'Host接続失敗',
        'Host不正応答',
        'Host timeout',
        'episode永続化失敗'
    ])('明示opt-in時は%sを診断付きcontinue:trueで通常権限下の復旧診断へ戻す', async (name) => {
        const root = temporaryDirectory();
        const payload = startPayload(
            `session-start-failure-diagnostic-${name}`,
            `turn-start-failure-diagnostic-${name}`,
            `秘密の入力-${name}-diagnostic`
        );
        const setup = await failureCase(name, root, payload);
        const result = await runEntrypoint({
            env: {
                ...process.env,
                BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
                BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: setup.timeoutMs ?? '100',
                BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
                BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
                BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
            },
            payload
        });

        expect(result).toMatchObject({ code: 0, signal: null, stderr: '' });
        expectDiagnosticContinue(readJsonOutput(result.stdout));
        expectSafeDiagnostic(
            JSON.parse(readFileSync(diagnosticPath(setup.journal, payload), 'utf8')),
            payload.prompt
        );

        const preToolUse = await runEntrypoint({
            env: {
                ...process.env,
                BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
                BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: setup.timeoutMs ?? '100',
                BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
                BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
                BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
            },
            payload: {
                ...payload,
                hook_event_name: 'PreToolUse',
                tool_name: 'functions.exec_command',
                tool_use_id: `tool-recovery-diagnostic-${name}`
            }
        });
        expect(preToolUse).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(preToolUse.stdout)).toEqual({});
    }, 10_000);

    it('明示opt-in時にjournal root作成失敗は診断付きcontinue:trueにし、診断保存不能をsafe JSONでstderrへ出す', async () => {
        const root = temporaryDirectory();
        const payload = startPayload(
            'session-start-failure-diagnostic-persist',
            'turn-start-failure-diagnostic-persist',
            '秘密の入力-journal root作成失敗-diagnostic'
        );
        const setup = await failureCase('journal root作成失敗', root, payload);
        const result = await runEntrypoint({
            env: {
                ...process.env,
                BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
                BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100',
                BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
                BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
                BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
            },
            payload
        });

        expect(result).toMatchObject({ code: 0, signal: null });
        expectDiagnosticContinue(readJsonOutput(result.stdout));
        readSafeStderr(result.stderr, payload.prompt);
    }, 10_000);

    it('Host失敗とjournal保存不能が重なってもUserPromptSubmitからStopまでCodexをblockしない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal-root-is-a-file');
        writeFileSync(journal, 'not a directory\n');
        const hostUrl = await closedLoopbackUrl();
        const payload = startPayload('session-storage-down', 'turn-storage-down', '通信と保存の同時障害を診断する');
        const env = { ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '50',
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };

        const started = await runEntrypoint({ env, payload });
        expect(started.code).toBe(0);
        expectDiagnosticContinue(readJsonOutput(started.stdout));
        readSafeStderr(started.stderr, payload.prompt);

        const preTool = await runEntrypoint({ env, payload: { ...payload,
            hook_event_name: 'PreToolUse', tool_name: 'functions.exec_command', tool_use_id: 'diagnose-storage' } });
        expect(preTool).toMatchObject({ code: 0, stderr: '' });
        expectDegradedPreTool(readJsonOutput(preTool.stdout));

        const postTool = await runEntrypoint({ env, payload: { ...payload,
            hook_event_name: 'PostToolUse', tool_name: 'functions.exec_command', tool_use_id: 'diagnose-storage',
            tool_input: {}, tool_response: { exit_code: 0 } } });
        expect(postTool).toMatchObject({ code: 0, stderr: '' });
        expect(readJsonOutput(postTool.stdout)).toEqual({
            systemMessage: expect.stringContaining('監査未完了')
        });

        const stopped = await runEntrypoint({ env, payload: { ...payload,
            hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '診断結果' } });
        expect(stopped).toMatchObject({ code: 0, stderr: '' });
        expect(readJsonOutput(stopped.stdout)).toEqual({
            systemMessage: expect.stringContaining('監査未完了')
        });
    }, 10_000);

    it.each(['exact', 'same-repository'])('検証済みepisodeのPreToolUseを%sで許可する', async (scope) => {
        const root = temporaryDirectory();
        const payload = startPayload(
            'session-start-failure-pretool-verified',
            'turn-start-failure-pretool-verified',
            '開始後の安全な読み取りを確認する'
        );
        const setup = await failureCase('Host成功', root, payload);
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100',
            BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };
        if (scope === 'same-repository') {
            env.BRAINBASE_JUDGMENT_CANARY_CWD = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim().replace(/\/.git$/, '');
        }
        const started = await runEntrypoint({ env, payload });
        expect(started).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(started.stdout)).toMatchObject({ continue: true, suppressOutput: true });

        const preToolUse = await runEntrypoint({
            env,
            payload: {
                ...payload,
                hook_event_name: 'PreToolUse',
                tool_name: 'mcp__brainbase__search',
                tool_use_id: 'tool-pretool-verified'
            }
        });
        expect(preToolUse).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(preToolUse.stdout)).toEqual({});
        const foreign = await runEntrypoint({
            env: { ...env, GIT_DIR: execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim() },
            payload: { ...payload, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'mcp__brainbase__search' }
        });
        expect(readJsonOutput(foreign.stdout)).toEqual({});

    }, 10_000);

    it('明示opt-in時に検証済みStop委任復旧episodeのResolver PreToolUseをdenyしない', async () => {
        const root = temporaryDirectory();
        const sessionId = 'session-start-failure-stop-recovery-pretool';
        const turnId = 'turn-start-failure-stop-recovery-pretool';
        const transcript = join(root, 'delegated.jsonl');
        writeFileSync(transcript, [
            JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
            JSON.stringify({
                type: 'response_item',
                payload: {
                    type: 'function_call_output',
                    namespace: 'codex_app',
                    name: 'create_thread',
                    output: '<codex_delegation><source_thread_id>source-thread</source_thread_id><input>Stop復旧後のResolver検証</input></codex_delegation>',
                    internal_chat_message_metadata_passthrough: { turn_id: turnId }
                }
            })
        ].join('\n') + '\n');
        const stopPayload = {
            hook_event_name: 'Stop',
            session_id: sessionId,
            turn_id: turnId,
            cwd: REPO_ROOT,
            transcript_path: transcript,
            stop_hook_active: false,
            last_assistant_message: '委任された処理の応答'
        };
        const setup = await failureCase('Host成功', root, stopPayload);
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100',
            BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
            BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };

        const stop = await runEntrypoint({ env, payload: stopPayload });
        expect(stop).toMatchObject({ code: 0, signal: null, stderr: '' });
        readJsonOutput(stop.stdout);

        const sessionRef = hash(sessionId);
        const turnRef = hash(turnId);
        const episodePath = join(setup.journal, sessionRef, `${turnRef}.episode.json`);
        const turnInputPath = join(setup.journal, sessionRef, `${turnRef}.turn-input.json`);
        expect(JSON.parse(readFileSync(episodePath, 'utf8'))).toMatchObject({
            state: 'open',
            episode_origin: 'stop_delegation_recovery',
            route_application: 'post_generation_recovery'
        });
        expect(JSON.parse(readFileSync(turnInputPath, 'utf8'))).toMatchObject({
            turn_id: turnId,
            conversation_context: { session_ref: sessionRef }
        });

        const preToolUse = await runEntrypoint({
            env,
            payload: {
                ...stopPayload,
                hook_event_name: 'PreToolUse',
                tool_name: 'mcp__brainbase__brainbase_resolve_turn',
                tool_use_id: 'tool-stop-recovery-resolver'
            }
        });
        expect(preToolUse).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(preToolUse.stdout)).toEqual({});
    }, 10_000);

    it.each(['lifecycle不一致', 'turn-input不一致'])('%sのepisodeでも監査障害を通常権限の拒否へ変換しない', async (tamper) => {
        const root = temporaryDirectory();
        const payload = startPayload(
            `session-start-failure-pretool-tampered-${tamper}`,
            `turn-start-failure-pretool-tampered-${tamper}`,
            `PreToolUse整合性検証-${tamper}`
        );
        const setup = await failureCase('Host成功', root, payload);
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100',
            BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };
        const started = await runEntrypoint({ env, payload });
        expect(started).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(started.stdout)).toMatchObject({ continue: true, suppressOutput: true });

        const sessionRef = hash(payload.session_id);
        const turnRef = hash(payload.turn_id);
        const episodePath = join(setup.journal, sessionRef, `${turnRef}.episode.json`);
        const turnInputPath = join(setup.journal, sessionRef, `${turnRef}.turn-input.json`);
        if (tamper === 'lifecycle不一致') {
            const episode = JSON.parse(readFileSync(episodePath, 'utf8'));
            episode.episode_origin = 'stop_delegation_recovery';
            episode.route_application = 'pre_generation';
            writeFileSync(episodePath, JSON.stringify(episode) + '\n');
        } else {
            const turnInput = JSON.parse(readFileSync(turnInputPath, 'utf8'));
            turnInput.request = `${turnInput.request}-改変`;
            writeFileSync(turnInputPath, JSON.stringify(turnInput) + '\n');
        }

        const preToolUse = await runEntrypoint({
            env,
            payload: {
                ...payload,
                hook_event_name: 'PreToolUse',
                tool_name: 'mcp__brainbase__brainbase_resolve_turn',
                tool_use_id: `tool-pretool-tampered-${tamper}`
            }
        });
        expect(preToolUse).toMatchObject({ code: 0, signal: null, stderr: '' });
        expectDegradedPreTool(readJsonOutput(preToolUse.stdout));
    }, 10_000);

    it('正常Start後でも同turnの空または壊れたstart-failure markerはPreToolUseを止めず、Stopは警告だけ返す', async () => {
        const root = temporaryDirectory();
        const payload = startPayload(
            'session-start-failure-marker-priority',
            'turn-start-failure-marker-priority',
            'marker優先denyの確認'
        );
        const setup = await failureCase('Host成功', root, payload);
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100',
            BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };
        const started = await runEntrypoint({ env, payload });
        expect(started).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(started.stdout)).toMatchObject({ continue: true, suppressOutput: true });

        const sessionRef = hash(payload.session_id);
        const turnRef = hash(payload.turn_id);
        const episodePath = join(setup.journal, sessionRef, `${turnRef}.episode.json`);
        const turnInputPath = join(setup.journal, sessionRef, `${turnRef}.turn-input.json`);
        expect(JSON.parse(readFileSync(episodePath, 'utf8'))).toMatchObject({
            episode_origin: 'user_prompt_submit',
            route_application: 'pre_generation'
        });
        expect(JSON.parse(readFileSync(turnInputPath, 'utf8'))).toMatchObject({
            turn_id: payload.turn_id,
            conversation_context: { session_ref: sessionRef }
        });

        const markerPath = diagnosticPath(setup.journal, payload);
        mkdirSync(join(setup.journal, 'diagnostics', sessionRef), { recursive: true });
        for (const marker of ['{}', '{corrupt']) {
            writeFileSync(markerPath, marker);
            const preToolUse = await runEntrypoint({
                env,
                payload: {
                    ...payload,
                    hook_event_name: 'PreToolUse',
                    tool_name: 'mcp__brainbase__search',
                    tool_use_id: `tool-marker-priority-${marker.length}`
                }
            });
            expect(preToolUse).toMatchObject({ code: 0, signal: null, stderr: '' });
            expectDegradedPreTool(readJsonOutput(preToolUse.stdout));

            const stop = await runEntrypoint({
                env,
                payload: {
                    ...payload,
                    hook_event_name: 'Stop',
                    stop_hook_active: false,
                    last_assistant_message: 'marker検証中の説明'
                }
            });
            expect(stop).toMatchObject({ code: 0, signal: null, stderr: '' });
            expect(readJsonOutput(stop.stdout)).toEqual({
                systemMessage: expect.stringContaining('開始処理を確認できない')
            });
        }
    }, 10_000);

    it.each(['欠損', 'corrupt', '保存不能'])('PreToolUseの%s状態でも監査障害を通常権限の拒否へ変換しない', async (state) => {
        const root = temporaryDirectory();
        const payload = startPayload(
            `session-start-failure-pretool-${state}`,
            `turn-start-failure-pretool-${state}`,
            `PreToolUse状態-${state}`
        );
        let journal = root;
        if (state === 'corrupt') {
            const directory = join(root, hash(payload.session_id));
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, `${hash(payload.turn_id)}.episode.json`), '{corrupt');
        }
        if (state === '保存不能') {
            journal = join(root, 'journal-root-is-a-file');
            writeFileSync(journal, 'not a directory\n');
        }
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };
        const preToolUse = await runEntrypoint({
            env,
            payload: {
                ...payload,
                hook_event_name: 'PreToolUse',
                tool_name: 'mcp__brainbase__search',
                tool_use_id: `tool-pretool-${state}`
            }
        });
        expect(preToolUse).toMatchObject({ code: 0, signal: null, stderr: '' });
        expectDegradedPreTool(readJsonOutput(preToolUse.stdout));
    }, 10_000);

    it.each(['env欠落', 'cwd不一致'])('%sでも監査障害をCodex停止へ波及させない', async (state) => {
        const root = temporaryDirectory();
        const payload = startPayload(
            `session-start-failure-canary-${state}`,
            `turn-start-failure-canary-${state}`,
            `canary設定-${state}`
        );
        const setup = await failureCase('Host接続失敗', root, payload);
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${setup.hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100',
            BRAINBASE_JUDGMENT_JOURNAL_DIR: setup.journal,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            ...(state === 'cwd不一致' ? { BRAINBASE_JUDGMENT_CANARY_CWD: root } : {})
        };
        const result = await runEntrypoint({ env, payload });

        expect(result).toMatchObject({ code: 0, signal: null, stderr: '' });
        expectDiagnosticContinue(readJsonOutput(result.stdout));
        expectSafeDiagnostic(
            JSON.parse(readFileSync(diagnosticPath(setup.journal, payload), 'utf8')),
            payload.prompt
        );
    }, 10_000);

    it('明示opt-in時のStart失敗後Stopは有限の可視警告だけを返し、再Startや再修復を行わない', async () => {
        const root = temporaryDirectory();
        const payload = {
            hook_event_name: 'Stop',
            session_id: 'session-start-failure-stop-finite',
            turn_id: 'turn-start-failure-stop-finite',
            cwd: REPO_ROOT,
            stop_hook_active: false,
            last_assistant_message: '診断継続中の説明'
        };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };
        mkdirSync(join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, 'diagnostics', hash(payload.session_id)), { recursive: true });
        writeFileSync(diagnosticPath(env.BRAINBASE_JUDGMENT_JOURNAL_DIR, payload), '{}');
        const outputs = [];
        for (const active of [false, true, true]) {
            const result = await runEntrypoint({
                env,
                payload: { ...payload, stop_hook_active: active }
            });
            expect(result).toMatchObject({ code: 0, signal: null, stderr: '' });
            outputs.push(readJsonOutput(result.stdout));
        }
        for (const output of outputs) {
            expect(output).toMatchObject({
                systemMessage: expect.stringContaining('開始処理を確認できない')
            });
            expect(output).not.toHaveProperty('decision');
            expect(output).not.toHaveProperty('continue');
            expect(output.systemMessage).not.toContain('新しいtask');
            expect(output.systemMessage).not.toContain('Stop修復');
        }
        expect(outputs[1]).toEqual(outputs[0]);
        expect(outputs[2]).toEqual(outputs[0]);
    }, 10_000);

    it('明示opt-inでもmarkerなしの孤立Stopは従来どおりdecision:blockとaudit-failureを生成する', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const payload = {
            hook_event_name: 'Stop',
            session_id: 'session-start-failure-orphan-without-marker',
            turn_id: 'turn-start-failure-orphan-without-marker',
            cwd: REPO_ROOT,
            stop_hook_active: false,
            last_assistant_message: '孤立Stopの元回答'
        };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
            BRAINBASE_JUDGMENT_START_FAILURE_MODE: 'diagnostic_continue',
            BRAINBASE_JUDGMENT_CANARY_CWD: REPO_ROOT
        };
        const result = await runEntrypoint({ env, payload });

        expect(result).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(readJsonOutput(result.stdout)).toMatchObject({
            decision: 'block',
            reason: expect.stringContaining('judgment_episode_not_found')
        });
        expect(() => readFileSync(diagnosticPath(journal, payload), 'utf8')).toThrow();
        const auditFailurePath = join(
            journal,
            hash(payload.session_id),
            `${hash(payload.turn_id)}.audit-failure.json`
        );
        expect(JSON.parse(readFileSync(auditFailurePath, 'utf8'))).toMatchObject({
            schema_version: 'brainbase-judgment-audit-failure-v1',
            reason: 'judgment_episode_not_found',
            audit_status: 'missing',
            repair_requested: true,
            stop_hook_active: false
        });
    }, 10_000);

    it('prompt欠損のStart失敗でも秘密を含まない診断を保存し、Codexを停止しない', async () => {
        const root = temporaryDirectory();
        const payload = {
            hook_event_name: 'UserPromptSubmit',
            session_id: 'session-start-failure-missing-prompt',
            turn_id: 'turn-start-failure-missing-prompt',
            cwd: REPO_ROOT
        };
        const journal = join(root, 'journal');
        const result = await runEntrypoint({
            env: {
                ...process.env,
                BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
                BRAINBASE_JUDGMENT_HOST_URL: 'http://127.0.0.1:9/host/judgment/resolve',
                BRAINBASE_JUDGMENT_HOST_TIMEOUT_MS: '100'
            },
            payload
        });

        expect(result).toMatchObject({ code: 0, signal: null });
        expectDiagnosticContinue(readJsonOutput(result.stdout));
        const diagnostic = JSON.parse(readFileSync(diagnosticPath(journal, payload), 'utf8'));
        expectSafeDiagnostic(diagnostic);
        expect(diagnostic.failed_stage).toBe('judgment_episode_request_build_failed');
        expect(diagnostic.input_shape).toMatchObject({
            prompt_present: false,
            prompt_nonempty: false
        });
    }, 10_000);
});
