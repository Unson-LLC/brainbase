import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJson } from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const REPO_ROOT = process.cwd();
const temporaryPaths = [];
const servers = [];

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function temporaryDirectory() {
    const path = mkdtempSync(join(tmpdir(), 'brainbase-judgment-entrypoint-'));
    temporaryPaths.push(path);
    return path;
}

function run(command, args, { env, input, timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: REPO_ROOT, env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`host entrypoint timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            resolve({ code, signal, stdout, stderr });
        });
        child.stdin.end(input);
    });
}

async function listen(handler) {
    const server = createServer(handler);
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', resolve);
        server.on('error', reject);
    });
    servers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Codex Judgment Resolver Host process entrypoint', () => {
    it('symlink経由でepisode開始・複数Brainbase参照・Stop確定を1つのturnへ束縛する', async () => {
        const root = temporaryDirectory();
        const repositoryLink = join(root, 'code', 'brainbase');
        mkdirSync(join(root, 'code'));
        symlinkSync(REPO_ROOT, repositoryLink, 'dir');
        const journal = join(root, 'journal');
        let requestCount = 0;
        const hostUrl = await listen((request, response) => {
            if (request.method !== 'POST' || request.url !== '/host/judgment/resolve') {
                response.statusCode = 404;
                response.end();
                return;
            }
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                requestCount += 1;
                const args = JSON.parse(body);
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({
                    management_status: 'managed',
                    receipt: {
                        resolution_id: 'jr_symlink_entrypoint',
                        turn_id: args.turn_id,
                        request_digest: hash(canonicalJson(args)),
                        context_digest: hash(canonicalJson(args.conversation_context)),
                        status: 'resolved',
                        host_binding: { status: 'managed' },
                        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
                        classification: { intent: 'implement', domains: ['operations'], action_kind: 'write' },
                        selected_dag_ids: ['operations.v1', 'authority.v1'],
                        required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }],
                        active_node_definitions: [{ id: 'answer', kind: 'common', instruction: 'Answer.' }]
                    }
                }));
            });
        });
        const wrapper = join(repositoryLink, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const identity = {
            session_id: 'session-symlink-entrypoint',
            turn_id: 'turn-symlink-entrypoint'
        };
        const payload = JSON.stringify({
            hook_event_name: 'UserPromptSubmit',
            ...identity,
            cwd: REPO_ROOT,
            prompt: 'Resolverを実行して'
        });
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };

        const first = await run('bash', [wrapper], { env, input: payload });
        const second = await run('bash', [wrapper], { env, input: payload });

        expect(first).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(JSON.parse(first.stdout)).toMatchObject({
            continue: true,
            suppressOutput: true,
            hookSpecificOutput: { hookEventName: 'UserPromptSubmit' }
        });
        const additionalContext = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
        expect(additionalContext).toContain(
            'The final user-facing response for this turn must start with exactly this Host-generated line, before any other text:\n' +
            '🧠 判断参照: 「Resolverを実行して」を参照 → Brainbase参照先の判断が必要 ✓'
        );
        expect(additionalContext).toContain('Intermediate commentary may omit the owner-visible audit block.');
        expect(additionalContext).toContain('opened one judgment episode');
        expect(additionalContext).toContain('there is no one-call-per-turn limit');
        expect(first.stdout).not.toContain('jr_symlink_entrypoint');
        expect(first.stdout).not.toContain('Initial route receipt:');
        expect(additionalContext).toContain('The full route receipt stays in the per-session judgment journal');
        expect(JSON.parse(second.stdout)).toEqual(JSON.parse(first.stdout));
        expect(requestCount).toBe(1);

        const unrelated = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__get_context', tool_use_id: 'tool-unrelated',
            tool_input: { topic: 'resolver' }, tool_response: { content: [{ type: 'text', text: 'context' }] }
        }) });
        expect(JSON.parse(unrelated.stdout).systemMessage).toContain('Brainbase呼出');
        const unrelatedLine = JSON.parse(unrelated.stdout).systemMessage;

        const firstStopPayload = JSON.stringify({
            hook_event_name: 'Stop', ...identity, stop_hook_active: false, last_assistant_message: '仮回答'
        });
        const firstStop = await run('bash', [wrapper], { env, input: firstStopPayload });
        const firstStopReplay = await run('bash', [wrapper], { env, input: firstStopPayload });
        expect(JSON.parse(firstStop.stdout)).toMatchObject({ decision: 'block' });
        expect(JSON.parse(firstStopReplay.stdout)).toEqual(JSON.parse(firstStop.stdout));

        const routePayload = JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-route',
            tool_input: { intent: 'Resolver仕様', audience: 'team', content_type: 'team_document' },
            tool_response: {
                status: 'ok', data: {
                    resolution_id: 'kr_entrypoint', status: 'resolved', source_class: 'owning_repo',
                    canonical_location: { repository: 'project:brainbase', path: 'docs/' },
                    retrieval_capability: 'repository.read', searched_scope: [], absence_confirmed: false
                }
            }
        });
        const route = await run('bash', [wrapper], { env, input: routePayload });
        const routeReplay = await run('bash', [wrapper], { env, input: routePayload });
        expect(JSON.parse(route.stdout)).toEqual({
            systemMessage: '📚 Brainbase参照先: 「Resolver仕様」→ owning_repoのdocs/を選択 ✓'
        });
        expect(JSON.parse(routeReplay.stdout)).toEqual(JSON.parse(route.stdout));
        const routeLine = JSON.parse(route.stdout).systemMessage;

        const search = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__search', tool_use_id: 'tool-search',
            tool_input: { query: 'Judgment Resolver' }, tool_response: { content: [{ type: 'text', text: 'results' }] }
        }) });
        const searchLine = JSON.parse(search.stdout).systemMessage;
        const finalStopPayload = JSON.stringify({
            hook_event_name: 'Stop', ...identity, stop_hook_active: true,
            last_assistant_message: [
                '🧠 判断参照: 「Resolverを実行して」を参照 → Brainbase参照先の判断が必要 ✓',
                unrelatedLine,
                routeLine,
                searchLine,
                '確認後の回答'
            ].join('\n')
        });
        const finalStop = await run('bash', [wrapper], { env, input: finalStopPayload });
        const finalStopReplay = await run('bash', [wrapper], { env, input: finalStopPayload });
        expect(JSON.parse(finalStop.stdout)).toEqual({});
        expect(JSON.parse(finalStopReplay.stdout)).toEqual({});

        const journalDirectory = join(journal, hash('session-symlink-entrypoint'));
        const journalFiles = readdirSync(journalDirectory);
        expect(journalFiles.sort()).toEqual([
            `${hash('turn-symlink-entrypoint')}.continuation.json`,
            `${hash('turn-symlink-entrypoint')}.episode.json`,
            `${hash('turn-symlink-entrypoint')}.events`,
            `${hash('turn-symlink-entrypoint')}.final.json`,
            `${hash('turn-symlink-entrypoint')}.transition.sqlite`
        ]);
        expect(JSON.parse(readFileSync(join(journalDirectory, `${hash('turn-symlink-entrypoint')}.episode.json`), 'utf8'))).toMatchObject({
            schema_version: 'brainbase-judgment-episode-v1',
            state: 'open',
            owner_audit: {
                source_excerpt: 'Resolverを実行して',
                decision: 'Brainbase参照先の判断が必要',
                display_line: '🧠 判断参照: 「Resolverを実行して」を参照 → Brainbase参照先の判断が必要 ✓'
            }
        });
        expect(JSON.parse(readFileSync(join(journalDirectory, `${hash('turn-symlink-entrypoint')}.final.json`), 'utf8'))).toMatchObject({
            schema_version: 'brainbase-judgment-episode-final-v2',
            completion_status: 'complete',
            event_count: 3,
            qualifying_event_count: 1,
            owner_audit_complete: true,
            owner_audit_line_count: 4
        });
    }, 20_000);

    // Traceability: story-brainbase-judgment-audit-fail-closed:ac:4
    // Traceability: story-brainbase-judgment-audit-fail-closed:ac:5
    it('orphan Stopと監査不足のactive再Stopを成功形へ潰さない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const env = { ...process.env, BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
        const orphanIdentity = { session_id: 'session-orphan-stop', turn_id: 'turn-orphan-stop' };

        const orphanFirst = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ hook_event_name: 'Stop', ...orphanIdentity, stop_hook_active: false })
        });
        expect(orphanFirst).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(orphanFirst.stdout)).toMatchObject({
            decision: 'block',
            reason: expect.stringContaining('judgment_episode_not_found')
        });

        const orphanActive = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ hook_event_name: 'Stop', ...orphanIdentity, stop_hook_active: true })
        });
        expect(orphanActive.code).not.toBe(0);
        expect(orphanActive.stdout).toBe('');
        expect(orphanActive.stderr).toContain('judgment_episode_not_found');

        const hostUrl = await listen((request, response) => {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const args = JSON.parse(body);
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({
                    management_status: 'managed',
                    receipt: {
                        resolution_id: 'jr_fail_closed_entrypoint',
                        turn_id: args.turn_id,
                        request_digest: hash(canonicalJson(args)),
                        context_digest: hash(canonicalJson(args.conversation_context)),
                        status: 'resolved',
                        host_binding: { status: 'managed' },
                        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
                        classification: { intent: 'answer', domains: ['knowledge'], action_kind: 'read' },
                        selected_dag_ids: ['knowledge.v1'],
                        required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }],
                        active_node_definitions: [{ id: 'knowledge', kind: 'domain', instruction: 'Resolve knowledge.' }]
                    }
                }));
            });
        });
        const identity = { session_id: 'session-incomplete-stop', turn_id: 'turn-incomplete-stop' };
        const started = await run('bash', [wrapper], {
            env: { ...env, BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve` },
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: 'Brainbaseを確認して'
            })
        });
        expect(started.code).toBe(0);

        const firstStop = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: false, last_assistant_message: '仮回答'
            })
        });
        expect(JSON.parse(firstStop.stdout)).toMatchObject({ decision: 'block' });

        const repeatedStop = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: true, last_assistant_message: '未取得のまま回答'
            })
        });
        expect(repeatedStop.code).not.toBe(0);
        expect(repeatedStop.stdout).toBe('');
        expect(repeatedStop.stderr).toContain(
            'judgment_episode_incomplete:knowledge.resolve,owner.audit.display'
        );
        const finalPath = join(journal, hash(identity.session_id), `${hash(identity.turn_id)}.final.json`);
        expect(existsSync(finalPath)).toBe(false);
    }, 20_000);

    it('同一turnの並列UserPromptSubmitを1回のResolver呼出と同一episodeへ畳み込む', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        let requestCount = 0;
        const hostUrl = await listen((request, response) => {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                requestCount += 1;
                const args = JSON.parse(body);
                setTimeout(() => {
                    response.setHeader('content-type', 'application/json');
                    response.end(JSON.stringify({
                        management_status: 'managed',
                        receipt: {
                            resolution_id: 'jr_parallel_start_entrypoint',
                            turn_id: args.turn_id,
                            request_digest: hash(canonicalJson(args)),
                            context_digest: hash(canonicalJson(args.conversation_context)),
                            status: 'resolved',
                            host_binding: { status: 'managed' },
                            classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
                            classification: { intent: 'answer', domains: ['general'], action_kind: 'none' },
                            selected_dag_ids: ['general.v1'],
                            required_capabilities: [],
                            active_node_definitions: [{ id: 'answer', kind: 'common', instruction: 'Answer.' }]
                        }
                    }));
                }, 150);
            });
        });
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const identity = { session_id: 'session-parallel-start', turn_id: 'turn-parallel-start' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };
        const payload = JSON.stringify({
            hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: '同時開始を検証して'
        });

        const [first, second] = await Promise.all([
            run('bash', [wrapper], { env, input: payload }),
            run('bash', [wrapper], { env, input: payload })
        ]);

        expect(first).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(second).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(JSON.parse(second.stdout)).toEqual(JSON.parse(first.stdout));
        expect(requestCount).toBe(1);

        const episode = JSON.parse(readFileSync(join(
            journal,
            hash(identity.session_id),
            `${hash(identity.turn_id)}.episode.json`
        ), 'utf8'));
        expect(episode).toMatchObject({
            schema_version: 'brainbase-judgment-episode-v1',
            state: 'open',
            initial_route_receipt: { resolution_id: 'jr_parallel_start_entrypoint' }
        });
    }, 20_000);

    it('別processの並列PostToolUseを重複ないjournal commit順に直列化する', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const hostUrl = await listen((request, response) => {
            if (request.method !== 'POST' || request.url !== '/host/judgment/resolve') {
                response.statusCode = 404;
                response.end();
                return;
            }
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const args = JSON.parse(body);
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({
                    management_status: 'managed',
                    receipt: {
                        resolution_id: 'jr_parallel_entrypoint',
                        turn_id: args.turn_id,
                        request_digest: hash(canonicalJson(args)),
                        context_digest: hash(canonicalJson(args.conversation_context)),
                        status: 'resolved',
                        host_binding: { status: 'managed' },
                        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
                        classification: { intent: 'answer', domains: ['knowledge'], action_kind: 'none' },
                        selected_dag_ids: ['direct.v1'],
                        required_capabilities: [],
                        active_node_definitions: [{ id: 'answer', kind: 'common', instruction: 'Answer.' }]
                    }
                }));
            });
        });
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const identity = { session_id: 'session-parallel-entrypoint', turn_id: 'turn-parallel-entrypoint' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };
        const start = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: '並列参照を検証して'
            })
        });
        expect(start).toMatchObject({ code: 0, signal: null, stderr: '' });

        const calls = ['parallel-a', 'parallel-b'].map((toolUseId) => run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'PostToolUse', ...identity,
                tool_name: 'mcp__brainbase__search', tool_use_id: toolUseId,
                tool_input: { query: toolUseId },
                tool_response: { content: [{ type: 'text', text: `${toolUseId}-result` }] }
            })
        }));
        const results = await Promise.all(calls);
        expect(results).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 0, signal: null, stderr: '' }),
            expect.objectContaining({ code: 0, signal: null, stderr: '' })
        ]));

        const eventsDirectory = join(
            journal,
            hash(identity.session_id),
            `${hash(identity.turn_id)}.events`
        );
        const events = readdirSync(eventsDirectory)
            .filter((name) => name.endsWith('.json'))
            .map((name) => JSON.parse(readFileSync(join(eventsDirectory, name), 'utf8')))
            .sort((left, right) => left.event_sequence - right.event_sequence);
        expect(events.map((event) => event.event_sequence)).toEqual([0, 1]);
        expect(new Set(events.map((event) => event.tool_use_id))).toEqual(new Set(['parallel-a', 'parallel-b']));
    }, 20_000);

    it('live transition transactionとの競合をactive Stopで無音成功に変換しない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const hostUrl = await listen((request, response) => {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const args = JSON.parse(body);
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({
                    management_status: 'managed',
                    receipt: {
                        resolution_id: 'jr_live_transaction_entrypoint',
                        turn_id: args.turn_id,
                        request_digest: hash(canonicalJson(args)),
                        context_digest: hash(canonicalJson(args.conversation_context)),
                        status: 'resolved',
                        host_binding: { status: 'managed' },
                        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
                        classification: { intent: 'answer', domains: ['general'], action_kind: 'none' },
                        selected_dag_ids: ['general.v1'],
                        required_capabilities: [],
                        active_node_definitions: [{ id: 'answer', kind: 'common', instruction: 'Answer.' }]
                    }
                }));
            });
        });
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const identity = { session_id: 'session-live-transaction', turn_id: 'turn-live-transaction' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
            BRAINBASE_JUDGMENT_LOCK_TIMEOUT_MS: '10'
        };
        const started = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: '競合時の確定を検証して'
            })
        });
        const ownerLine = JSON.parse(started.stdout).hookSpecificOutput.additionalContext
            .split('\n')
            .find((line) => line.startsWith('🧠 判断参照:'));
        const journalDirectory = join(journal, hash(identity.session_id));
        const turnRef = hash(identity.turn_id);
        const transitionDatabase = join(journalDirectory, `${turnRef}.transition.sqlite`);
        const lockHolder = new Database(transitionDatabase);
        lockHolder.exec('BEGIN IMMEDIATE');
        try {
            const blocked = await run('bash', [wrapper], {
                env,
                input: JSON.stringify({
                    hook_event_name: 'Stop', ...identity, stop_hook_active: true,
                    last_assistant_message: `${ownerLine}\n回答`
                })
            });
            expect(blocked.code).not.toBe(0);
            expect(blocked.stdout).toBe('');
            expect(blocked.stderr).toContain('judgment_episode_transition_timeout');
            expect(readdirSync(journalDirectory)).not.toContain(`${turnRef}.final.json`);
        } finally {
            lockHolder.exec('ROLLBACK');
            lockHolder.close();
        }

        const recovered = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: true,
                last_assistant_message: `${ownerLine}\n回答`
            })
        });
        expect(recovered).toMatchObject({ code: 0, stderr: '', stdout: '{}\n' });
        expect(JSON.parse(readFileSync(join(journalDirectory, `${turnRef}.final.json`), 'utf8')))
            .toMatchObject({ completion_status: 'complete' });
    }, 20_000);
});
