import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildJudgmentRequest,
    canonicalJson,
    finalizeEpisode,
    startEpisode
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';
import { resolveRoutineReceiptPaths } from '../../scripts/routines/runtime-paths.mjs';
import {
    deliverJudgmentKnowledgeEventOutbox,
    enqueueJudgmentKnowledgeEvent,
    resolveJudgmentKnowledgeEventDeliveryAuth,
    resolveJudgmentKnowledgeEventDeliveryReceiptPath,
    resolveJudgmentKnowledgeEventOutboxPath
} from '../../server/services/routine-runtime/judgment-event-outbox.js';

const temporaryPaths = [];

function temporaryDirectory() {
    const directory = mkdtempSync(join(tmpdir(), 'brainbase-judgment-event-outbox-'));
    temporaryPaths.push(directory);
    return directory;
}

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function queuedKnowledgeEvent(event_id = 'kev_readback', project_code = 'brainbase') {
    return {
        schema_version: 'knowledge_event.v1',
        contract_version: 'knowledge_event.v1',
        event_id,
        occurred_at: '2026-08-13T00:00:00.000Z',
        captured_at: '2026-08-13T00:00:00.000Z',
        source: { type: 'codex_judgment', ref: `session:${event_id}` },
        subject: { type: 'judgment_episode', id: `episode:${event_id}` },
        decision_authority: { kind: 'judgment_receipt', authorized: false },
        applicability_scope: { scope: 'judgment_episode', project_code },
        permission_snapshot: { knowledge_registration: true, external_action: false },
        source_pointer: { uri: `codex://threads/session#turn=${event_id}` },
        body_hash: 'a'.repeat(64),
        parent_episode_id: `episode:${event_id}`,
        payload: { summary: 'fixture' }
    };
}

function postAck(event, candidate_id = 'candidate_readback') {
    return {
        event_id: event.event_id,
        candidate_id,
        processing_stage: 'retrievable',
        semantic_state: 'active'
    };
}

function cycleReceipt(event, candidate_id = 'candidate_readback', overrides = {}) {
    return {
        schema_version: 'knowledge_cycle_receipt.v1',
        event_id: event.event_id,
        candidate_id,
        processing_stage: 'retrievable',
        semantic_state: 'active',
        ...overrides
    };
}

function validReceipt(args) {
    return {
        resolution_id: 'jr_judgment_event_outbox',
        turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)),
        context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'resolved',
        host_binding: { status: 'managed' },
        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
        active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Judge first.' }],
        classification: { intent: 'answer', action_kind: 'none', domains: ['general'] },
        selected_dag_ids: ['general.v1']
    };
}

async function startManagedEpisode(payload, env, receiptOverrides = {}) {
    const args = buildJudgmentRequest(payload, { env });
    return startEpisode(payload, {
        env,
        fetchImpl: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                management_status: 'managed',
                receipt: { ...validReceipt(args), ...receiptOverrides }
            })
        })
    });
}

function completeAnswer(episode) {
    return `${episode.owner_audit.display_line}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n回答本文`;
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryPaths.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Judgment Host knowledge event outbox', () => {
    it('loopback配送だけinternal API keyを使い、外部URLへは送らない', () => {
        const env = {
            INTERNAL_API_SECRET: 'internal-secret',
            BRAINBASE_KNOWLEDGE_EVENT_SERVICE_TOKEN: 'service-token'
        };

        expect(resolveJudgmentKnowledgeEventDeliveryAuth({
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            env
        })).toEqual({ internalApiKey: 'internal-secret', serviceToken: null });
        expect(resolveJudgmentKnowledgeEventDeliveryAuth({
            endpoint: 'https://bb.unson.jp/api/knowledge/events',
            env
        })).toEqual({ internalApiKey: null, serviceToken: 'service-token' });
    });

    it('internal API key配送はCSRF免除headerだけを送りBearerへ複製しない', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const { deliverJudgmentKnowledgeEventOutbox, enqueueJudgmentKnowledgeEvent } = await import(
            /* @vite-ignore */ outboxModuleUrl
        );
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const event = queuedKnowledgeEvent('kev_internal_auth');
        enqueueJudgmentKnowledgeEvent(event, {
            directory: outboxDir
        });
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event) }
            : { ok: true, status: 200, json: async () => cycleReceipt(event) });

        await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            internalApiKey: 'internal-secret',
            serviceToken: 'must-not-be-used',
            organizationId: 'org_unson',
            fetchImpl
        });

        expect(fetchImpl).toHaveBeenCalledWith(
            'http://127.0.0.1:31013/api/knowledge/events',
            expect.objectContaining({
                headers: {
                    'Content-Type': 'application/json',
                    'x-brainbase-organization-id': 'org_unson',
                    'x-internal-api-key': 'internal-secret'
                }
            })
        );
    });

    it('旧eventはruntime organizationを補い、組織不明なら送信しない', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const { deliverJudgmentKnowledgeEventOutbox, enqueueJudgmentKnowledgeEvent } = await import(
            /* @vite-ignore */ outboxModuleUrl
        );
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const event = queuedKnowledgeEvent('kev_legacy_org');
        enqueueJudgmentKnowledgeEvent(event, {
            directory: outboxDir
        });
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event) }
            : { ok: true, status: 200, json: async () => cycleReceipt(event) });

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            organizationId: 'org_unson',
            internalApiKey: 'internal-secret',
            fetchImpl
        })).resolves.toMatchObject({ delivered: 1, pending: 0 });
        expect(fetchImpl.mock.calls[0][1].headers['x-brainbase-organization-id']).toBe('org_unson');

        enqueueJudgmentKnowledgeEvent({ event_id: 'kev_missing_org', contract_version: 'knowledge_event.v1' }, {
            directory: outboxDir
        });
        fetchImpl.mockClear();
        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            internalApiKey: 'internal-secret',
            fetchImpl
        })).resolves.toMatchObject({ delivered: 0, failed: 1, retryable: 1, pending: 1 });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('eventとruntimeのorganizationが矛盾する場合は送信しない', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const { deliverJudgmentKnowledgeEventOutbox, enqueueJudgmentKnowledgeEvent } = await import(
            /* @vite-ignore */ outboxModuleUrl
        );
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        enqueueJudgmentKnowledgeEvent({
            event_id: 'kev_org_conflict',
            contract_version: 'knowledge_event.v1',
            applicability_scope: { organization_id: 'org_a' }
        }, { directory: outboxDir });
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 }));

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            organizationId: 'org_b',
            internalApiKey: 'internal-secret',
            fetchImpl
        })).resolves.toMatchObject({ delivered: 0, failed: 1, retryable: 1, pending: 1 });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('env未設定・任意cwdでもHostとserverはrepo由来の同じcanonical varを解決する', () => {
        const root = temporaryDirectory();
        const repoDir = join(root, 'workspace', 'code', 'brainbase');
        const foreignCwd = join(root, 'unrelated-cwd');
        const receiptPaths = resolveRoutineReceiptPaths({ repoDir, env: {} });
        const judgmentOutbox = resolveJudgmentKnowledgeEventOutboxPath({
            repoDir,
            cwd: foreignCwd,
            env: {}
        });
        const deliveryReceipt = resolveJudgmentKnowledgeEventDeliveryReceiptPath({
            repoDir,
            outboxDir: judgmentOutbox,
            env: {}
        });

        expect(receiptPaths.varDir).toBe(join(root, 'workspace', 'var'));
        expect(judgmentOutbox).toBe(join(
            receiptPaths.varDir,
            'knowledge-event-outbox',
            'codex-judgment'
        ));
        expect(judgmentOutbox).not.toContain(foreignCwd);
        expect(judgmentOutbox).not.toBe(join(process.cwd(), 'var', 'knowledge-event-outbox', 'codex-judgment'));
        expect(deliveryReceipt).toBe(join(
            receiptPaths.varDir,
            'knowledge-event-delivery-receipt',
            'codex-judgment'
        ));
    });

    it('judgment Hostはenv未設定時もrepoDirをcanonical Outbox resolverへ渡す', () => {
        const hostSource = readFileSync(join(
            process.cwd(),
            'scripts/codex-hooks/judgment-resolver-host.mjs'
        ), 'utf8');

        const resolverCall = hostSource.match(
            /resolveJudgmentKnowledgeEventOutboxPath\(\{[\s\S]{0,160}?\}\)/
        )?.[0];
        expect(resolverCall).toContain('env');
        expect(resolverCall).toMatch(/repoDir:\s*REPO_ROOT/);
    });

    it('壊れたJSONを個別dead-letter化し、他eventのdeliveryと例外一覧を止めない', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const {
            deliverJudgmentKnowledgeEventOutbox,
            enqueueJudgmentKnowledgeEvent,
            listJudgmentKnowledgeEventOutboxExceptions
        } = await import(/* @vite-ignore */ outboxModuleUrl);
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deadLetterDir = join(root, 'dead-letter');
        const event = queuedKnowledgeEvent('kev_valid');
        enqueueJudgmentKnowledgeEvent(event, {
            directory: outboxDir,
            now: () => new Date('2026-08-13T00:00:00.000Z')
        });
        writeFileSync(join(outboxDir, 'corrupt.json'), '{not-json');
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event) }
            : { ok: true, status: 200, json: async () => cycleReceipt(event) });

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deadLetterDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            organizationId: 'org_unson',
            fetchImpl,
            maxAttempts: 2
        })).resolves.toMatchObject({
            delivered: 1,
            failed: 1,
            retryable: 0,
            dead_lettered: 1
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(readdirSync(deadLetterDir)).toContain('corrupt.json');
        await expect(listJudgmentKnowledgeEventOutboxExceptions({
            directory: deadLetterDir
        })).resolves.toEqual([
            expect.objectContaining({ code: 'knowledge_event_outbox_corrupt', path: 'corrupt.json' })
        ]);
    });

    it('maxAttemptsを初期値でスキップせず実送信回数として扱う', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const { deliverJudgmentKnowledgeEventOutbox, enqueueJudgmentKnowledgeEvent } = await import(
            /* @vite-ignore */ outboxModuleUrl
        );
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deadLetterDir = join(root, 'dead-letter');
        enqueueJudgmentKnowledgeEvent(queuedKnowledgeEvent('kev_single_attempt'), {
            directory: outboxDir
        });
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));

        const result = await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deadLetterDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            organizationId: 'org_unson',
            fetchImpl,
            maxAttempts: 1
        });

        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            delivered: 0,
            failed: 1,
            retryable: 0,
            dead_lettered: 1
        });
        const deadLetter = JSON.parse(readFileSync(join(deadLetterDir, 'kev_single_attempt.json'), 'utf8'));
        expect(deadLetter.delivery).toMatchObject({
            last_status: 503,
            last_error_code: 'knowledge_event_delivery_http_error'
        });
    });

    it('limitで1件だけ安全にprobeし、残りを保留する', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const { deliverJudgmentKnowledgeEventOutbox, enqueueJudgmentKnowledgeEvent } = await import(
            /* @vite-ignore */ outboxModuleUrl
        );
        const outboxDir = join(temporaryDirectory(), 'outbox');
        const events = new Map();
        for (const event_id of ['kev_probe_1', 'kev_probe_2']) {
            const event = queuedKnowledgeEvent(event_id);
            events.set(event_id, event);
            enqueueJudgmentKnowledgeEvent(event, {
                directory: outboxDir
            });
        }
        const fetchImpl = vi.fn(async (url, options) => {
            const postedEventId = options.method === 'POST' ? JSON.parse(options.body).event_id : null;
            const event = events.get(postedEventId || (url.includes('kev_probe_1') ? 'kev_probe_1' : 'kev_probe_2'));
            return options.method === 'POST'
                ? { ok: true, status: 202, json: async () => postAck(event) }
                : { ok: true, status: 200, json: async () => cycleReceipt(event) };
        });

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            internalApiKey: 'internal-secret',
            organizationId: 'org_unson',
            fetchImpl,
            limit: 1
        })).resolves.toMatchObject({ delivered: 1, pending: 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('409の恒久衝突は再試行せず診断付きでdead-letterへ隔離する', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const { deliverJudgmentKnowledgeEventOutbox, enqueueJudgmentKnowledgeEvent } = await import(
            /* @vite-ignore */ outboxModuleUrl
        );
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deadLetterDir = join(root, 'dead-letter');
        enqueueJudgmentKnowledgeEvent(queuedKnowledgeEvent('kev_conflict'), { directory: outboxDir });

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deadLetterDir,
            endpoint: 'http://127.0.0.1:31013/api/knowledge/events',
            internalApiKey: 'internal-secret',
            organizationId: 'org_unson',
            fetchImpl: vi.fn(async () => ({ ok: false, status: 409 })),
            maxAttempts: 5
        })).resolves.toMatchObject({
            delivered: 0,
            failed: 1,
            retryable: 0,
            dead_lettered: 1,
            pending: 0
        });
        const deadLetter = JSON.parse(readFileSync(join(deadLetterDir, 'kev_conflict.json'), 'utf8'));
        expect(deadLetter.delivery).toMatchObject({
            attempt: 2,
            last_status: 409,
            last_error_code: 'knowledge_event_conflict'
        });
    });

    it('個別Outbox設定がなくてもcanonical var配下へcompleted eventを永続化する', async () => {
        const root = temporaryDirectory();
        const canonicalVarDir = join(root, 'canonical-var');
        const outboxDir = join(canonicalVarDir, 'knowledge-event-outbox', 'codex-judgment');
        const env = {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_VAR_DIR: canonicalVarDir,
            BRAINBASE_ORGANIZATION_ID: 'org_unson'
        };
        const payload = {
            session_id: 'session-default-outbox',
            turn_id: 'turn-default-outbox',
            prompt: '判断結果を返して',
            cwd: process.cwd()
        };
        const episode = await startManagedEpisode(payload, env);

        const completed = finalizeEpisode({
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: completeAnswer(episode)
        }, { env });

        expect(completed.final).toMatchObject({ completion_status: 'complete' });
        const files = readdirSync(outboxDir).filter((name) => name.endsWith('.json'));
        expect(files).toHaveLength(1);
        expect(JSON.parse(readFileSync(join(outboxDir, files[0]), 'utf8')).event)
            .toMatchObject({
                contract_version: 'knowledge_event.v1',
                organization_id: 'org_unson',
                applicability_scope: expect.objectContaining({ organization_id: 'org_unson' })
            });
    });

    it('complete確定後だけknowledge_event.v1を正規Outboxへ一度だけ登録する', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'knowledge-event-outbox', 'codex-judgment');
        const env = {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR: outboxDir
        };
        const payload = {
            session_id: 'session-outbox-once',
            turn_id: 'turn-outbox-once',
            prompt: '判断結果を返して',
            cwd: process.cwd()
        };
        const episode = await startManagedEpisode(payload, env);
        const stopPayload = {
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: completeAnswer(episode)
        };

        const completed = finalizeEpisode(stopPayload, { env });
        const replay = finalizeEpisode(stopPayload, { env });

        expect(completed.final).toMatchObject({ completion_status: 'complete' });
        expect(replay.final).toEqual(completed.final);
        const files = readdirSync(outboxDir).filter((name) => name.endsWith('.json'));
        expect(files).toHaveLength(1);
        const queued = JSON.parse(readFileSync(join(outboxDir, files[0]), 'utf8'));
        expect(queued.event).toMatchObject({
            contract_version: 'knowledge_event.v1',
            occurred_at: completed.final.finalized_at,
            body_hash: completed.final.answer_digest,
            source: { type: 'codex_judgment', ref: `${payload.session_id}:${payload.turn_id}` },
            subject: { type: 'judgment_episode' },
            payload: { summary: expect.stringContaining('回答本文') },
            source_pointer: {
                uri: `codex://threads/${payload.session_id}#turn=${payload.turn_id}`
            }
        });
        expect(queued.event.parent_episode_id).toBeTruthy();
        expect(JSON.stringify(queued.event)).not.toContain('action_allowed');
        expect(JSON.stringify(queued.event)).not.toContain('approval_scope');
        expect(JSON.stringify(queued.event)).not.toContain('external_action_allowed');
    });

    it('Host journalへ最終回答の生全文を保存せず、安全化した上限付きsummaryだけをOutboxへ渡す', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'knowledge-event-outbox', 'codex-judgment');
        const env = {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR: outboxDir
        };
        const payload = {
            session_id: 'session-safe-final',
            turn_id: 'turn-safe-final',
            prompt: '安全な判断結果を返して',
            cwd: process.cwd()
        };
        const episode = await startManagedEpisode(payload, env);
        const uniqueTail = 'RAW_FINAL_TAIL_MUST_NOT_BE_JOURNALED';
        const body = `安全な回答:${'本文'.repeat(1400)}${uniqueTail}`;
        const fullAnswer = `${episode.owner_audit.display_line}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n${body}`;

        const completed = finalizeEpisode({
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: fullAnswer
        }, { env });

        const finalPath = join(root, 'journal', hash(payload.session_id), `${hash(payload.turn_id)}.final.json`);
        const journalText = readFileSync(finalPath, 'utf8');
        expect(completed.final).not.toHaveProperty('final_answer');
        expect(journalText).not.toContain(fullAnswer);
        expect(journalText).not.toContain(uniqueTail);

        const queuedFile = readdirSync(outboxDir).find((name) => name.endsWith('.json'));
        const queued = JSON.parse(readFileSync(join(outboxDir, queuedFile), 'utf8'));
        expect(queued.event.payload.summary).toMatch(/^安全な回答:/);
        expect(queued.event.payload.summary.length).toBeLessThanOrEqual(2000);
        expect(queued.event.payload.summary).not.toContain('🧠 判断参照');
        expect(queued.event.payload.summary).not.toContain('📚 Brainbase');
    });

    it('必須knowledge未参照でStopがblockされた時はknowledge eventを登録しない', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'knowledge-event-outbox', 'codex-judgment');
        const env = {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR: outboxDir
        };
        const payload = {
            session_id: 'session-outbox-blocked',
            turn_id: 'turn-outbox-blocked',
            prompt: '正本を確認して判断結果を返して',
            cwd: process.cwd()
        };
        await startManagedEpisode(payload, env, {
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        });

        const blocked = finalizeEpisode({
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: '監査行がない回答'
        }, { env });

        expect(blocked).toMatchObject({ output: { decision: 'block' }, final: null });
        expect(existsSync(outboxDir) ? readdirSync(outboxDir) : []).toEqual([]);
    });

    it('final保存後のenqueue失敗は次回Stopで同じeventを再enqueueしてrepairする', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'blocked-outbox-path');
        writeFileSync(outboxDir, 'not a directory');
        const env = {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR: outboxDir
        };
        const payload = {
            session_id: 'session-outbox-repair',
            turn_id: 'turn-outbox-repair',
            prompt: '判断結果を返して',
            cwd: process.cwd()
        };
        const episode = await startManagedEpisode(payload, env);
        const stopPayload = {
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: completeAnswer(episode)
        };

        expect(() => finalizeEpisode(stopPayload, { env })).toThrow();
        unlinkSync(outboxDir);
        const repaired = finalizeEpisode(stopPayload, { env });

        expect(repaired.final).toMatchObject({ completion_status: 'complete' });
        expect(readdirSync(outboxDir).filter((name) => name.endsWith('.json'))).toHaveLength(1);
    });

    it('API失敗でもfinalと同じevent IDのOutboxを保持し、朝の例外として読める', async () => {
        const outboxModuleUrl = pathToFileURL(join(
            process.cwd(),
            'server/services/routine-runtime/judgment-event-outbox.js'
        )).href;
        const {
            deliverJudgmentKnowledgeEventOutbox,
            listJudgmentKnowledgeEventOutboxExceptions
        } = await import(/* @vite-ignore */ outboxModuleUrl);
        const root = temporaryDirectory();
        const outboxDir = join(root, 'knowledge-event-outbox', 'codex-judgment');
        const env = {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR: outboxDir
        };
        const payload = {
            session_id: 'session-outbox-retry',
            turn_id: 'turn-outbox-retry',
            prompt: '判断結果を返して',
            cwd: process.cwd()
        };
        const episode = await startManagedEpisode(payload, env);
        const completed = finalizeEpisode({
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: completeAnswer(episode)
        }, { env });
        const finalPath = join(
            env.BRAINBASE_JUDGMENT_JOURNAL_DIR,
            hash(payload.session_id),
            `${hash(payload.turn_id)}.final.json`
        );
        const originalFinal = readFileSync(finalPath, 'utf8');
        const originalFile = readdirSync(outboxDir).find((name) => name.endsWith('.json'));
        const originalEventId = JSON.parse(readFileSync(join(outboxDir, originalFile), 'utf8')).event.event_id;

        const failed = vi.fn(async () => ({ ok: false, status: 503 }));
        await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            fetchImpl: failed,
            maxAttempts: 5,
            now: () => new Date('2026-08-13T00:10:00.000Z')
        });
        await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            fetchImpl: failed,
            maxAttempts: 5,
            now: () => new Date('2026-08-13T00:11:00.000Z')
        });

        expect(completed.final.completion_status).toBe('complete');
        expect(readFileSync(finalPath, 'utf8')).toBe(originalFinal);
        const remainingFiles = readdirSync(outboxDir).filter((name) => name.endsWith('.json'));
        expect(remainingFiles).toEqual([originalFile]);
        const retried = JSON.parse(readFileSync(join(outboxDir, originalFile), 'utf8'));
        expect(retried.event.event_id).toBe(originalEventId);
        expect(retried.delivery.attempt).toBe(3);
        await expect(listJudgmentKnowledgeEventOutboxExceptions({ directory: outboxDir })).resolves.toEqual([
            expect.objectContaining({
                code: 'knowledge_event_outbox',
                event_id: originalEventId,
                path: originalFile
            })
        ]);
    });

    it('POSTのackとcycles読戻しを両方確認し、証跡を保存してからOutboxを解消する', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'knowledge-event-outbox', 'codex-judgment');
        const deliveryReceiptDir = join(root, 'knowledge-event-delivery-receipt', 'codex-judgment');
        const event = queuedKnowledgeEvent('kev_readback_success');
        enqueueJudgmentKnowledgeEvent(event, { directory: outboxDir });
        const fetchImpl = vi.fn(async (url, options) => {
            if (options.method === 'POST') {
                return { ok: true, status: 202, json: async () => postAck(event) };
            }
            return { ok: true, status: 200, json: async () => cycleReceipt(event) };
        });

        const result = await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deliveryReceiptDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl,
            now: () => new Date('2026-08-13T00:10:00.000Z')
        });

        expect(result).toMatchObject({ delivered: 1, failed: 0, pending: 0 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[0][0]).toBe('https://brainbase.example/api/knowledge/events');
        expect(fetchImpl.mock.calls[1][0]).toBe(
            'https://brainbase.example/api/knowledge/cycles/kev_readback_success?project_code=brainbase'
        );
        const receiptPath = join(deliveryReceiptDir, 'kev_readback_success.json');
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
        expect(receipt).toMatchObject({
            schema_version: 'knowledge_event_delivery_receipt.v1',
            status: 'confirmed',
            event_id: event.event_id,
            candidate_id: 'candidate_readback',
            project_code: 'brainbase',
            post: { event_id: event.event_id, candidate_id: 'candidate_readback', http_status: 202 },
            readback: {
                schema_version: 'knowledge_cycle_receipt.v1',
                event_id: event.event_id,
                candidate_id: 'candidate_readback',
                processing_stage: 'retrievable',
                semantic_state: 'active'
            }
        });
        expect(JSON.stringify(receipt)).not.toContain('service-token');
    });

    it('cyclesのevent/candidate ID不一致は成功にせずackを保存したまま保留する', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deliveryReceiptDir = join(root, 'delivery-receipt');
        const event = queuedKnowledgeEvent('kev_readback_mismatch');
        enqueueJudgmentKnowledgeEvent(event, { directory: outboxDir });
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event, 'candidate_expected') }
            : { ok: true, status: 200, json: async () => cycleReceipt({ ...event, event_id: 'kev_other' }, 'candidate_other') });

        const result = await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deliveryReceiptDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl,
            maxAttempts: 5
        });

        expect(result).toMatchObject({ delivered: 0, failed: 1, retryable: 1, pending: 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(readdirSync(outboxDir)).toContain('kev_readback_mismatch.json');
        expect(existsSync(join(deliveryReceiptDir, 'kev_readback_mismatch.json'))).toBe(false);
        const queued = JSON.parse(readFileSync(join(outboxDir, 'kev_readback_mismatch.json'), 'utf8'));
        expect(queued.delivery.post_ack).toMatchObject({
            event_id: event.event_id,
            candidate_id: 'candidate_expected',
            http_status: 202
        });
        expect(queued.delivery.last_error_code).toBe('knowledge_event_readback_identity_mismatch');
    });

    it('POST ack保存後のGET失敗は再起動後もPOSTを再送せずGETから再開する', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deliveryReceiptDir = join(root, 'delivery-receipt');
        const event = queuedKnowledgeEvent('kev_readback_resume');
        enqueueJudgmentKnowledgeEvent(event, { directory: outboxDir });
        const firstFetch = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event, 'candidate_resume') }
            : { ok: false, status: 503, json: async () => ({}) });

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deliveryReceiptDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl: firstFetch,
            maxAttempts: 5
        })).resolves.toMatchObject({ delivered: 0, retryable: 1, pending: 1 });
        expect(firstFetch).toHaveBeenCalledTimes(2);

        const secondFetch = vi.fn(async (_url, options) => {
            expect(options.method).toBe('GET');
            return { ok: true, status: 200, json: async () => cycleReceipt(event, 'candidate_resume') };
        });
        const resumed = await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deliveryReceiptDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl: secondFetch,
            maxAttempts: 5
        });

        expect(resumed).toMatchObject({ delivered: 1, failed: 0, pending: 0 });
        expect(secondFetch).toHaveBeenCalledOnce();
        expect(JSON.parse(readFileSync(join(deliveryReceiptDir, 'kev_readback_resume.json'), 'utf8')))
            .toMatchObject({ status: 'confirmed', candidate_id: 'candidate_resume' });
    });

    it('cyclesの409はPOST競合と混同せず、readback上限までOutboxに保持する', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deadLetterDir = join(root, 'dead-letter');
        const event = queuedKnowledgeEvent('kev_readback_409');
        enqueueJudgmentKnowledgeEvent(event, { directory: outboxDir });
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event, 'candidate_409') }
            : { ok: false, status: 409, json: async () => ({}) });

        const first = await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deadLetterDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl,
            maxAttempts: 2
        });

        expect(first).toMatchObject({ delivered: 0, failed: 1, retryable: 1, dead_lettered: 0, pending: 1 });
        expect(existsSync(join(outboxDir, 'kev_readback_409.json'))).toBe(true);
        expect(existsSync(join(deadLetterDir, 'kev_readback_409.json'))).toBe(false);
        const queued = JSON.parse(readFileSync(join(outboxDir, 'kev_readback_409.json'), 'utf8'));
        expect(queued.delivery).toMatchObject({
            post_ack: { event_id: event.event_id, candidate_id: 'candidate_409' },
            readback_attempt: 2,
            last_status: 409,
            last_error_code: 'knowledge_event_readback_http_error'
        });
    });

    it('activeでない、またはretrievableでないcyclesは保留しGET再試行対象にする', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const event = queuedKnowledgeEvent('kev_readback_state');
        enqueueJudgmentKnowledgeEvent(event, { directory: outboxDir });
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event) }
            : { ok: true, status: 200, json: async () => cycleReceipt(event, 'candidate_readback', {
                processing_stage: 'resolved',
                semantic_state: 'quarantined'
            }) });

        await expect(deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl,
            maxAttempts: 5
        })).resolves.toMatchObject({ delivered: 0, failed: 1, retryable: 1, pending: 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const queued = JSON.parse(readFileSync(join(outboxDir, 'kev_readback_state.json'), 'utf8'));
        expect(queued.delivery.last_error_code).toBe('knowledge_event_readback_not_retrievable');
    });

    it('受信証跡の保存に失敗した場合はOutboxを削除せず、認証情報も保存しない', async () => {
        const root = temporaryDirectory();
        const outboxDir = join(root, 'outbox');
        const deliveryReceiptDir = join(root, 'receipt-file');
        writeFileSync(deliveryReceiptDir, 'not a directory');
        const event = queuedKnowledgeEvent('kev_readback_receipt_failure');
        enqueueJudgmentKnowledgeEvent(event, { directory: outboxDir });
        const fetchImpl = vi.fn(async (_url, options) => options.method === 'POST'
            ? { ok: true, status: 202, json: async () => postAck(event) }
            : { ok: true, status: 200, json: async () => cycleReceipt(event) });

        const result = await deliverJudgmentKnowledgeEventOutbox({
            outboxDir,
            deliveryReceiptDir,
            endpoint: 'https://brainbase.example/api/knowledge/events',
            serviceToken: 'service-token',
            organizationId: 'org_unson',
            fetchImpl
        });

        expect(result).toMatchObject({ delivered: 0, failed: 1, retryable: 1, pending: 1 });
        expect(readdirSync(outboxDir)).toContain('kev_readback_receipt_failure.json');
        expect(readFileSync(deliveryReceiptDir, 'utf8')).toBe('not a directory');
        const queued = JSON.parse(readFileSync(join(outboxDir, 'kev_readback_receipt_failure.json'), 'utf8'));
        expect(JSON.stringify(queued)).not.toContain('service-token');
    });
});
