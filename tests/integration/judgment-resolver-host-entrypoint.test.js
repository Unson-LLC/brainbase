import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    it('symlink経由でepisode開始・複数Brainbase参照・Stop確定を1つのturnへ束縛し、Knowledge Resolverの採用・除外理由をsystemMessageへ返す', async () => {
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
        expect(additionalContext).toContain(
            '必須capability `knowledge.resolve`を実行してください。許可されている正確なツールは ' +
            '`mcp__brainbase__brainbase_knowledge_resolve` です。このツールは正本の所在と次の取得経路を選び、' +
            '回答本文を取得しません。これはHostが確定したJudgment routeの再分類ではありません。'
        );
        expect(additionalContext).not.toContain('Do not call Judgment Resolver again');
        expect(first.stdout).not.toContain('jr_symlink_entrypoint');
        expect(first.stdout).not.toContain('Initial route receipt:');
        expect(additionalContext).toContain('The full route receipt stays in the per-session judgment journal');
        expect(JSON.parse(second.stdout)).toEqual(JSON.parse(first.stdout));
        expect(requestCount).toBe(1);

        const unrelated = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__brainbase_projects', tool_use_id: 'tool-unrelated',
            tool_input: {}, tool_response: { status: 'ok', data: { projects: [], count: 0 } }
        }) });
        expect(JSON.parse(unrelated.stdout).systemMessage).toBe(
            '📚 Brainbase呼出: brainbase_projects「プロジェクト一覧」→ 0件・正常応答を確認 ✓'
        );
        const unrelatedLine = JSON.parse(unrelated.stdout).systemMessage;

        const generic = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__get_context', tool_use_id: 'tool-generic',
            tool_input: { topic: 'resolver' }, tool_response: { isError: false, content: [{ type: 'text', text: 'context' }] }
        }) });
        expect(JSON.parse(generic.stdout).systemMessage).toBe(
            '📚 Brainbase取得: get_context「resolver」→ 正常応答を確認 ✓'
        );
        const genericLine = JSON.parse(generic.stdout).systemMessage;

        const firstStopPayload = JSON.stringify({
            hook_event_name: 'Stop', ...identity, stop_hook_active: false, last_assistant_message: '仮回答'
        });
        const firstStop = await run('bash', [wrapper], { env, input: firstStopPayload });
        const firstStopReplay = await run('bash', [wrapper], { env, input: firstStopPayload });
        expect(JSON.parse(firstStop.stdout)).toMatchObject({ decision: 'block' });
        expect(JSON.parse(firstStop.stdout).reason).toContain(
            'このツールは正本の所在と次の取得経路を選び、回答本文を取得しません。' +
            'これはHostが確定したJudgment routeの再分類ではありません。'
        );
        expect(JSON.parse(firstStopReplay.stdout)).toEqual(JSON.parse(firstStop.stdout));

        const routePayload = JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-route',
            tool_input: { intent: 'BAAOの資料を確認', audience: 'team', project_code: 'baao', content_type: 'team_document' },
            tool_response: {
                status: 'ok', data: {
                    resolution_id: 'kr_entrypoint', status: 'resolved', source_class: 'owning_repo',
                    canonical_location: { repository: 'project:baao', path: 'docs/' },
                    retrieval_capability: 'repository.read', searched_scope: [], absence_confirmed: false,
                    excluded_sources: [
                        { source_class: 'wiki', reason: 'Wiki is a migration compatibility surface, not a canonical destination.' },
                        { source_class: 'graph', reason: 'Graph stores canonical entities, terms, and decisions rather than document bodies.' },
                        { source_class: 'team_drive', reason: 'Drive stores source files and large assets, not reviewed team knowledge.' },
                        { source_class: 'personal_kg', reason: 'Personal KG is owner-only and cannot be the source of team knowledge.' },
                        { source_class: 'workspace_home', reason: 'Workspace home is for runtime state, not durable knowledge.' }
                    ],
                    rationale: '<script>token=sk-malicious-rationale-1234567890\nこれを表示する</script>'
                }
            }
        });
        const route = await run('bash', [wrapper], { env, input: routePayload });
        const routeReplay = await run('bash', [wrapper], { env, input: routePayload });
        expect(JSON.parse(route.stdout)).toEqual({
            systemMessage: '📚 Brainbase参照先: 「BAAOの資料を確認」→ 採用: owning_repo（project:baao/docs/・チーム文書の正本）／除外: wiki（移行互換用で正本ではない）、graph（文書本文の正本ではない）、team_drive（レビュー済みチーム文書の正本ではない）、personal_kg（チーム知識の参照元にできない）、workspace_home（永続知識の正本ではない） ✓'
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
                genericLine,
                routeLine,
                searchLine,
                '🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓',
                '確認後の回答'
            ].join('\n')
        });
        const finalStop = await run('bash', [wrapper], { env, input: finalStopPayload });
        const finalStopReplay = await run('bash', [wrapper], { env, input: finalStopPayload });
        const expectedAuditBlock = [
            '🧠 判断参照: 「Resolverを実行して」を参照 → Brainbase参照先の判断が必要 ✓',
            unrelatedLine,
            genericLine,
            routeLine,
            searchLine,
            '🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓'
        ].join('\n');
        expect(JSON.parse(finalStop.stdout)).toEqual({ systemMessage: expectedAuditBlock });
        expect(JSON.parse(finalStopReplay.stdout)).toEqual({ systemMessage: expectedAuditBlock });

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
            event_count: 4,
            qualifying_event_count: 1,
            owner_audit_complete: true,
            owner_audit_line_count: 6
        });
    }, 20_000);

    it('同時に到着したactive Stopでも修復要求を1回だけ許可する', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const hostUrl = await listen((request, response) => {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const args = JSON.parse(body);
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({
                    management_status: 'managed',
                    receipt: {
                        resolution_id: 'jr_concurrent_stop_entrypoint',
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
        const identity = { session_id: 'session-concurrent-stop', turn_id: 'turn-concurrent-stop' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`
        };
        const started = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT,
                prompt: 'Brainbaseを確認して'
            })
        });
        expect(started).toMatchObject({ code: 0, stderr: '' });

        const stopInput = JSON.stringify({
            hook_event_name: 'Stop', ...identity, stop_hook_active: true,
            last_assistant_message: '未取得のまま回答'
        });
        const results = await Promise.all([
            run('bash', [wrapper], { env, input: stopInput }),
            run('bash', [wrapper], { env, input: stopInput })
        ]);

        expect(results.map((result) => result.code).sort()).toEqual([0, 1]);
        const allowed = results.find((result) => result.code === 0);
        const exhausted = results.find((result) => result.code === 1);
        expect(JSON.parse(allowed.stdout)).toMatchObject({ decision: 'block' });
        expect(exhausted.stdout).toBe('');
        expect(exhausted.stderr).toContain('judgment_stop_repair_exhausted');
    }, 20_000);

    // Traceability: story-judgment-audit-continuity-v1:ac:3
    // Traceability: story-judgment-audit-continuity-v1:ac:4
    it('orphan Stopは1回だけ本文保持を要求し、active再Stopをaudit_degradedとして人手待ちにしない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const env = { ...process.env, BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
        const orphanIdentity = { session_id: 'session-orphan-stop', turn_id: 'turn-orphan-stop' };
        const originalBody = '長時間taskの作業結果';
        const warning = '⚠️ Brainbase監査未完了: この応答は完全監査できませんでした。作業は継続しており、新しいtaskの作成やHook操作は不要です。';

        const orphanFirst = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...orphanIdentity, stop_hook_active: false,
                last_assistant_message: originalBody
            })
        });
        expect(orphanFirst).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(orphanFirst.stdout)).toMatchObject({
            decision: 'block',
            reason: expect.stringContaining('judgment_episode_not_found')
        });
        expect(JSON.parse(orphanFirst.stdout).reason).toContain(warning);
        expect(JSON.parse(orphanFirst.stdout).reason).toContain('元の回答本文を削除・要約・置換せず');
        expect(JSON.parse(orphanFirst.stdout).reason).not.toContain('新しいCodex task');

        const orphanDirectory = join(journal, hash(orphanIdentity.session_id));
        const diagnosticPath = join(orphanDirectory, `${hash(orphanIdentity.turn_id)}.audit-failure.json`);
        const diagnostic = JSON.parse(readFileSync(diagnosticPath, 'utf8'));
        expect(diagnostic).toMatchObject({
            schema_version: 'brainbase-judgment-audit-failure-v1',
            reason: 'judgment_episode_not_found',
            session_ref: hash(orphanIdentity.session_id),
            turn_ref: hash(orphanIdentity.turn_id),
            episode_candidate_count: 0,
            repair_requested: true,
            stop_hook_active: false,
            answer_body_binding: {
                schema_version: 'brainbase-orphan-answer-body-binding-v1',
                body_digest: hash(originalBody),
                character_count: originalBody.length
            }
        });
        expect(diagnostic.journal_root_digest).toMatch(/^[a-f0-9]{64}$/u);
        expect(diagnostic.host_digest).toMatch(/^[a-f0-9]{64}$/u);
        expect(diagnostic.warning_line_digest).toBe(hash(warning));
        expect(JSON.stringify(diagnostic)).not.toContain(orphanIdentity.session_id);
        expect(JSON.stringify(diagnostic)).not.toContain(orphanIdentity.turn_id);
        expect(JSON.stringify(diagnostic)).not.toContain(originalBody);

        const orphanActive = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...orphanIdentity, stop_hook_active: true,
                last_assistant_message: `${warning}\n${originalBody}`
            })
        });
        expect(orphanActive).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(orphanActive.stdout)).toEqual({ systemMessage: warning });
        const degradedPath = join(orphanDirectory, `${hash(orphanIdentity.turn_id)}.audit-degraded.json`);
        expect(JSON.parse(readFileSync(degradedPath, 'utf8'))).toMatchObject({
            schema_version: 'brainbase-judgment-audit-degraded-v1',
            completion_status: 'audit_degraded',
            reason: 'judgment_episode_not_found',
            stop_hook_active: true,
            owner_warning_displayed: true,
            answer_body_preserved: true
        });
        expect(existsSync(join(orphanDirectory, `${hash(orphanIdentity.turn_id)}.final.json`))).toBe(false);

        const lateStart = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...orphanIdentity,
                prompt: '遅れて到着した開始イベント'
            })
        });
        expect(lateStart).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(lateStart.stdout)).toMatchObject({
            continue: false,
            suppressOutput: false,
            stopReason: expect.stringContaining('judgment_audit_degraded_start_conflict')
        });
        expect(existsSync(join(orphanDirectory, `${hash(orphanIdentity.turn_id)}.episode.json`))).toBe(false);

        const orphanReplay = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...orphanIdentity, stop_hook_active: true,
                last_assistant_message: `${warning}\n${originalBody}`
            })
        });
        expect(orphanReplay).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(orphanReplay.stdout)).toEqual({ systemMessage: warning });

        const degradedReceipt = JSON.parse(readFileSync(degradedPath, 'utf8'));
        delete degradedReceipt.finalized_at;
        writeFileSync(degradedPath, `${JSON.stringify(degradedReceipt, null, 2)}\n`);
        const malformedDegradedReplay = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...orphanIdentity, stop_hook_active: true,
                last_assistant_message: `${warning}\n${originalBody}`
            })
        });
        expect(malformedDegradedReplay.code).not.toBe(0);
        expect(malformedDegradedReplay.stderr).toContain('judgment_audit_degraded_integrity_invalid');

        const falseRetryIdentity = { session_id: 'session-orphan-false-retry', turn_id: 'turn-orphan-false-retry' };
        const falseRetryPayload = {
            hook_event_name: 'Stop', ...falseRetryIdentity, stop_hook_active: false,
            last_assistant_message: originalBody
        };
        expect(JSON.parse((await run('bash', [wrapper], {
            env, input: JSON.stringify(falseRetryPayload)
        })).stdout)).toMatchObject({ decision: 'block' });
        const falseRetry = await run('bash', [wrapper], {
            env, input: JSON.stringify(falseRetryPayload)
        });
        expect(falseRetry).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(falseRetry.stdout)).toEqual({ systemMessage: warning });
        expect(JSON.parse(readFileSync(join(
            journal,
            hash(falseRetryIdentity.session_id),
            `${hash(falseRetryIdentity.turn_id)}.audit-degraded.json`
        ), 'utf8'))).toMatchObject({
            completion_status: 'audit_degraded',
            owner_warning_displayed: false,
            answer_body_preserved: false
        });

        const tamperedIdentity = { session_id: 'session-orphan-tampered', turn_id: 'turn-orphan-tampered' };
        const tamperedPayload = {
            hook_event_name: 'Stop', ...tamperedIdentity, stop_hook_active: false,
            last_assistant_message: originalBody
        };
        expect(JSON.parse((await run('bash', [wrapper], {
            env, input: JSON.stringify(tamperedPayload)
        })).stdout)).toMatchObject({ decision: 'block' });
        const tamperedPath = join(
            journal,
            hash(tamperedIdentity.session_id),
            `${hash(tamperedIdentity.turn_id)}.audit-failure.json`
        );
        const tamperedDiagnostic = JSON.parse(readFileSync(tamperedPath, 'utf8'));
        writeFileSync(tamperedPath, `${JSON.stringify({ ...tamperedDiagnostic, episode_candidate_count: -1 }, null, 2)}\n`);
        const tamperedActive = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ ...tamperedPayload, stop_hook_active: true })
        });
        expect(tamperedActive.code).not.toBe(0);
        expect(tamperedActive.stderr).toContain('judgment_audit_failure_integrity_invalid');
        expect(existsSync(join(
            journal,
            hash(tamperedIdentity.session_id),
            `${hash(tamperedIdentity.turn_id)}.audit-degraded.json`
        ))).toBe(false);

        const timestampIdentity = { session_id: 'session-orphan-timestamp', turn_id: 'turn-orphan-timestamp' };
        const timestampPayload = {
            hook_event_name: 'Stop', ...timestampIdentity, stop_hook_active: false,
            last_assistant_message: originalBody
        };
        expect(JSON.parse((await run('bash', [wrapper], {
            env, input: JSON.stringify(timestampPayload)
        })).stdout)).toMatchObject({ decision: 'block' });
        const timestampPath = join(
            journal,
            hash(timestampIdentity.session_id),
            `${hash(timestampIdentity.turn_id)}.audit-failure.json`
        );
        const timestampDiagnostic = JSON.parse(readFileSync(timestampPath, 'utf8'));
        writeFileSync(timestampPath, `${JSON.stringify({ ...timestampDiagnostic, recorded_at: 'not-a-timestamp' }, null, 2)}\n`);
        const timestampActive = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ ...timestampPayload, stop_hook_active: true })
        });
        expect(timestampActive.code).not.toBe(0);
        expect(timestampActive.stderr).toContain('judgment_audit_failure_integrity_invalid');

        const damagedIdentity = { session_id: 'session-orphan-damaged', turn_id: 'turn-orphan-damaged' };
        const damagedFirst = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...damagedIdentity, stop_hook_active: false,
                last_assistant_message: originalBody
            })
        });
        expect(JSON.parse(damagedFirst.stdout)).toMatchObject({ decision: 'block' });
        const damagedActive = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...damagedIdentity, stop_hook_active: true,
                last_assistant_message: '警告と本文を改変した回答'
            })
        });
        expect(damagedActive).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(damagedActive.stdout)).toEqual({ systemMessage: warning });
        expect(JSON.parse(readFileSync(join(
            journal,
            hash(damagedIdentity.session_id),
            `${hash(damagedIdentity.turn_id)}.audit-degraded.json`
        ), 'utf8'))).toMatchObject({
            completion_status: 'audit_degraded',
            owner_warning_displayed: false,
            answer_body_preserved: false
        });

        const invalidActive = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true })
        });
        expect(invalidActive.code).not.toBe(0);
        expect(invalidActive.stdout).toBe('');
        expect(invalidActive.stderr).toContain('judgment_episode_identity_missing');
        expect(invalidActive.stderr).toContain('Settings → Hooks');

        const activeFirstIdentity = { session_id: 'session-orphan-active-first', turn_id: 'turn-orphan-active-first' };
        const activeFirst = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...activeFirstIdentity, stop_hook_active: true,
                last_assistant_message: `${warning}\n${originalBody}`
            })
        });
        expect(activeFirst).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(readFileSync(join(
            journal,
            hash(activeFirstIdentity.session_id),
            `${hash(activeFirstIdentity.turn_id)}.audit-failure.json`
        ), 'utf8'))).toMatchObject({
            repair_requested: false,
            stop_hook_active: true
        });

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
        expect(repeatedStop.stderr).toContain('judgment_stop_repair_exhausted');
        const finalPath = join(journal, hash(identity.session_id), `${hash(identity.turn_id)}.final.json`);
        expect(existsSync(finalPath)).toBe(false);
    }, 20_000);

    it('失敗したrequired routeを重複実行せずowner監査だけを修復できる', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const hostUrl = await listen((request, response) => {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const args = JSON.parse(body);
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({
                    management_status: 'managed',
                    receipt: {
                        resolution_id: 'jr_failed_route_entrypoint',
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
        const identity = { session_id: 'session-failed-route', turn_id: 'turn-failed-route' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };
        const started = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: '正本を確認して'
        }) });
        expect(started.code).toBe(0);

        const recorded = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-failed-route',
            tool_input: { intent: '正本を確認して' },
            tool_response: { status: 'error', error: { code: 'unavailable' } }
        }) });
        expect(recorded.code).toBe(0);
        const routeLine = JSON.parse(recorded.stdout).systemMessage;

        const firstStop = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'Stop', ...identity, stop_hook_active: false,
            last_assistant_message: '参照先を確定できなかった回答'
        }) });
        expect(firstStop.code).toBe(0);
        expect(JSON.parse(firstStop.stdout)).toMatchObject({ decision: 'block' });
        expect(JSON.parse(firstStop.stdout).reason)
            .not.toContain('`mcp__brainbase__brainbase_knowledge_resolve` を今実行してください');

        const finalStop = await run('bash', [wrapper], { env, input: JSON.stringify({
            hook_event_name: 'Stop', ...identity, stop_hook_active: true,
            last_assistant_message: [
                '🧠 判断参照: 「正本を確認して」を参照 → Brainbase参照先の判断が必要 ✓',
                routeLine,
                '🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓',
                '参照先を確定できなかった回答'
            ].join('\n')
        }) });
        expect(finalStop).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(finalStop.stdout).systemMessage).toContain(routeLine);
        const finalPath = join(journal, hash(identity.session_id), `${hash(identity.turn_id)}.final.json`);
        expect(JSON.parse(readFileSync(finalPath, 'utf8'))).toMatchObject({
            completion_status: 'complete', event_count: 1, qualifying_event_count: 0
        });
    }, 20_000);

    // Traceability: story-judgment-audit-continuity-v1:ac:8
    // Traceability: story-judgment-audit-continuity-v1:ac:10
    it('Brainbase PostToolUseのidentityまたはtool_use_id欠損を無音成功にしない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const env = { ...process.env, BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };

        const missingIdentity = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'PostToolUse',
                tool_name: 'mcp__brainbase__brainbase_knowledge_resolve',
                tool_use_id: 'identity-missing-tool'
            })
        });
        expect(missingIdentity.code).not.toBe(0);
        expect(missingIdentity.stdout).toBe('');
        expect(missingIdentity.stderr).toContain('judgment_episode_identity_missing');

        const missingToolUseId = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'PostToolUse',
                session_id: 'metadata-session', turn_id: 'metadata-turn',
                tool_name: 'mcp__brainbase__brainbase_knowledge_resolve'
            })
        });
        expect(missingToolUseId.code).not.toBe(0);
        expect(missingToolUseId.stdout).toBe('');
        expect(missingToolUseId.stderr).toContain('judgment_tool_use_id_missing');

        const unrelated = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'unrelated_tool' })
        });
        expect(unrelated).toMatchObject({ code: 0, stderr: '', stdout: '{}\n' });
        expect(existsSync(journal)).toBe(false);
    });

    // Traceability: story-judgment-audit-continuity-v1:ac:8
    it('orphan PostToolUseはdigest-only markerと可視警告を残し、Stopのone-shot状態を消費しない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const env = { ...process.env, BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
        const identity = { session_id: 'session-orphan-tool', turn_id: 'turn-orphan-tool' };
        const toolPayload = {
            hook_event_name: 'PostToolUse', ...identity,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve',
            tool_use_id: 'tool-use-orphan',
            tool_input: { query: '秘密を含まない入力' },
            tool_response: { status: 'ok' }
        };
        const recorded = await run('bash', [wrapper], { env, input: JSON.stringify(toolPayload) });
        expect(recorded).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(recorded.stdout)).toEqual({
            systemMessage: '⚠️ Brainbase監査未完了: Brainbase tool eventを開始episodeへ結合できませんでした。'
        });
        const markerDirectory = join(
            journal, hash(identity.session_id), `${hash(identity.turn_id)}.audit-orphan-events`
        );
        const marker = JSON.parse(readFileSync(join(markerDirectory, `${hash(toolPayload.tool_use_id)}.json`), 'utf8'));
        expect(Object.keys(marker).sort()).toEqual([
            'event_fingerprint', 'input_digest', 'reason', 'recorded_at', 'response_digest',
            'schema_version', 'session_ref', 'tool_name_digest', 'tool_use_ref', 'turn_ref'
        ].sort());
        expect(marker).toMatchObject({
            schema_version: 'brainbase-judgment-orphan-tool-event-v1',
            reason: 'judgment_episode_not_found',
            session_ref: hash(identity.session_id),
            turn_ref: hash(identity.turn_id),
            tool_name_digest: hash(toolPayload.tool_name),
            tool_use_ref: hash(toolPayload.tool_use_id)
        });
        expect(JSON.stringify(marker)).not.toContain(toolPayload.tool_name);
        expect(JSON.stringify(marker)).not.toContain(toolPayload.tool_use_id);
        expect(JSON.stringify(marker)).not.toContain('秘密を含まない入力');
        expect(JSON.stringify(marker)).not.toContain('display_line');

        const lateStart = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity,
                cwd: REPO_ROOT, prompt: 'orphan marker後の開始を検証して'
            })
        });
        expect(lateStart).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(lateStart.stdout)).toMatchObject({
            continue: false,
            stopReason: expect.stringContaining('judgment_orphan_tool_event_start_conflict')
        });
        expect(existsSync(join(
            journal, hash(identity.session_id), `${hash(identity.turn_id)}.episode.json`
        ))).toBe(false);

        writeFileSync(
            join(markerDirectory, `${hash(toolPayload.tool_use_id)}.json`),
            `${JSON.stringify({ ...marker, recorded_at: 'not-a-timestamp' }, null, 2)}\n`
        );
        const tamperedReplay = await run('bash', [wrapper], { env, input: JSON.stringify(toolPayload) });
        expect(tamperedReplay.code).not.toBe(0);
        expect(tamperedReplay.stderr).toContain('judgment_orphan_tool_event_conflict');

        const firstStop = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: false,
                last_assistant_message: '継続結果'
            })
        });
        expect(JSON.parse(firstStop.stdout)).toMatchObject({ decision: 'block' });
    });

    // Traceability: story-judgment-audit-continuity-v1:ac:1
    // Traceability: story-judgment-audit-continuity-v1:ac:2
    it('episode開始中のPostToolUseとStopはcommitを待ち、誤ったorphan判定やevent欠落を起こさない', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const hostUrl = await listen((request, response) => {
            let body = '';
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const args = JSON.parse(body);
                setTimeout(() => {
                    response.setHeader('content-type', 'application/json');
                    response.end(JSON.stringify({
                        management_status: 'managed',
                        receipt: {
                            resolution_id: 'jr_start_race_entrypoint',
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
                }, 3200);
            });
        });
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const identity = { session_id: 'session-start-race', turn_id: 'turn-start-race' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };
        const startPromise = run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: '開始競合を検証して'
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const toolPromise = run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'PostToolUse', ...identity,
                tool_name: 'mcp__brainbase__search', tool_use_id: 'race-tool',
                tool_input: { query: 'race' },
                tool_response: { content: [{ type: 'text', text: 'race-result' }] }
            })
        });
        const [started, tool] = await Promise.all([startPromise, toolPromise]);
        expect(started.code).toBe(0);
        expect(tool).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(tool.stdout).systemMessage).toContain('Brainbase検索');

        const ownerLine = JSON.parse(started.stdout).hookSpecificOutput.additionalContext
            .split('\n').find((line) => line.startsWith('🧠 判断参照:'));
        const toolLine = JSON.parse(tool.stdout).systemMessage;
        const stopped = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: false,
                last_assistant_message: `${ownerLine}\n${toolLine}\n回答`
            })
        });
        expect(stopped).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(stopped.stdout).systemMessage).toContain(ownerLine);
        const eventsDirectory = join(journal, hash(identity.session_id), `${hash(identity.turn_id)}.events`);
        expect(readdirSync(eventsDirectory).filter((name) => name.endsWith('.json'))).toHaveLength(1);

        const stopRaceIdentity = { session_id: 'session-start-stop-race', turn_id: 'turn-start-stop-race' };
        const stopRaceStart = run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...stopRaceIdentity,
                cwd: REPO_ROOT, prompt: '開始中のStop競合を検証して'
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const stopRaceStop = run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...stopRaceIdentity,
                stop_hook_active: false, last_assistant_message: '回答'
            })
        });
        const [stopRaceStarted, stopRaceStopped] = await Promise.all([stopRaceStart, stopRaceStop]);
        expect(stopRaceStarted.code).toBe(0);
        expect(stopRaceStopped).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(stopRaceStopped.stdout)).toMatchObject({ decision: 'block' });
        expect(JSON.parse(stopRaceStopped.stdout).reason).not.toContain('judgment_episode_not_found');
        expect(existsSync(join(
            journal,
            hash(stopRaceIdentity.session_id),
            `${hash(stopRaceIdentity.turn_id)}.episode.json`
        ))).toBe(true);
    }, 30_000);

    it('本文を短縮したactive Stopは再blockせず明示終了してfinalを作らない', async () => {
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
                        resolution_id: 'jr_preserve_body_entrypoint',
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
        const identity = { session_id: 'session-preserve-body-entrypoint', turn_id: 'turn-preserve-body-entrypoint' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };
        const started = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT,
                prompt: 'どのような修正が入ったか説明して'
            })
        });
        const ownerLine = JSON.parse(started.stdout).hookSpecificOutput.additionalContext
            .split('\n')
            .find((line) => line.startsWith('🧠 判断参照:'));
        const detailedBody = '修正内容は3点です。\n\n- 表示修正\n- 回帰テスト追加\n- PR更新';

        const firstStop = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: false,
                last_assistant_message: `${ownerLine}\n\n${detailedBody}`
            })
        });
        expect(firstStop).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(firstStop.stdout)).toMatchObject({ decision: 'block' });

        const shortenedStop = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: true,
                last_assistant_message: [
                    ownerLine,
                    '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
                    '修正済みです。'
                ].join('\n')
            })
        });
        expect(shortenedStop.code).not.toBe(0);
        expect(shortenedStop.stdout).toBe('');
        expect(shortenedStop.stderr).toContain('judgment_stop_repair_exhausted');
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
                    last_assistant_message: `${ownerLine}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n回答`
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
                last_assistant_message: `${ownerLine}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n回答`
            })
        });
        expect(recovered).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(recovered.stdout)).toEqual({
            systemMessage: `${ownerLine}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`
        });
        expect(JSON.parse(readFileSync(join(journalDirectory, `${turnRef}.final.json`), 'utf8')))
            .toMatchObject({ completion_status: 'complete' });
    }, 20_000);

    it('不要な確認の差し戻しを短い進捗表示とjournal由来の完了監査へ変換する', async () => {
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
                        resolution_id: 'jr_autonomy_visibility_entrypoint',
                        turn_id: args.turn_id,
                        request_digest: hash(canonicalJson(args)),
                        context_digest: hash(canonicalJson(args.conversation_context)),
                        status: 'resolved',
                        host_binding: { status: 'managed' },
                        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
                        classification: { intent: 'implement', domains: ['engineering'], action_kind: 'write', risk: 'medium' },
                        selected_dag_ids: ['engineering.v1', 'authority.v1'],
                        required_capabilities: [],
                        active_node_definitions: [{ id: 'implement', kind: 'common', instruction: 'Implement.' }],
                        autonomy_decision: 'continue',
                        autonomy_reason_code: 'routine_in_scope',
                        allowed_runtime_escalation_reasons: [
                            'irreversible_action', 'missing_authority', 'owner_value_choice',
                            'required_input_unavailable', 'evidenced_terminal_blocker'
                        ]
                    }
                }));
            });
        });
        const wrapper = join(REPO_ROOT, 'scripts', 'codex-hooks', 'judgment-resolver-entry.sh');
        const identity = { session_id: 'session-autonomy-visibility', turn_id: 'turn-autonomy-visibility' };
        const env = {
            ...process.env,
            BRAINBASE_JUDGMENT_HOST_URL: `${hostUrl}/host/judgment/resolve`,
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journal
        };
        const started = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', ...identity, cwd: REPO_ROOT, prompt: '修正して' })
        });
        const ownerLine = JSON.parse(started.stdout).hookSpecificOutput.additionalContext
            .split('\n').find((line) => line.startsWith('🧠 判断参照:'));
        const zeroCallLine = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
        const completionLine = '🔁 自律継続: 不要な確認を1回差し戻し → 継続完了 ✓';
        const repairLine = '🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓';

        const blocked = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: false,
                last_assistant_message: `${ownerLine}\n${zeroCallLine}\nどちらの実装にしますか？`
            })
        });
        expect(blocked).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(blocked.stdout)).toMatchObject({
            decision: 'block',
            systemMessage: '🔁 確認不要と判定しました。回答を差し戻して処理を続けています'
        });
        const journalDirectory = join(journal, hash(identity.session_id));
        const turnRef = hash(identity.turn_id);
        expect(JSON.parse(readFileSync(join(journalDirectory, `${turnRef}.continuation.json`), 'utf8')))
            .toMatchObject({ autonomy_continuation: { count: 1, trigger_code: 'unnecessary_user_question', status: 'requested' } });

        const completed = await run('bash', [wrapper], {
            env,
            input: JSON.stringify({
                hook_event_name: 'Stop', ...identity, stop_hook_active: true,
                last_assistant_message: `${ownerLine}\n${zeroCallLine}\n${completionLine}\n${repairLine}\n実装と検証を完了しました。`
            })
        });
        expect(completed).toMatchObject({ code: 0, stderr: '' });
        expect(JSON.parse(completed.stdout)).toEqual({
            systemMessage: `${ownerLine}\n${zeroCallLine}\n${completionLine}\n${repairLine}`
        });
        expect(JSON.parse(readFileSync(join(journalDirectory, `${turnRef}.final.json`), 'utf8')))
            .toMatchObject({
                completion_status: 'complete', owner_audit_line_count: 4,
                autonomy_continuation: { count: 1, trigger_code: 'unnecessary_user_question', status: 'completed' },
                stop_repair: { count: 1, status: 'completed' }
            });
    }, 20_000);
});
