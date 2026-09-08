import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { registerJudgmentResolutionApiRoute } from '../../server/bootstrap/register-api-routes.js';
import { JudgmentResolutionService } from '../../server/services/judgment-resolution-service.js';
import {
    buildJudgmentRequest,
    canonicalJson,
    processHookPayload,
    readEpisodeAudit,
    recordBrainbaseToolUse
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';
import { handleJudgmentResolutionToolCall } from '../../mcp/brainbase/src/tools/judgment-resolution-tools.ts';

const NOW = new Date('2026-08-07T00:00:00.000Z');
const SECRET = 'needs-classification-e2e-secret-at-least-32-bytes';
const temporaryPaths = [];
const servers = [];

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function jwt(payload) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function temporaryDirectory() {
    const path = mkdtempSync(join(tmpdir(), 'brainbase-judgment-needs-classification-'));
    temporaryPaths.push(path);
    return path;
}

async function listen(app) {
    const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
        candidate.on('error', reject);
    });
    servers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

function bootstrapReceipt(args) {
    return {
        resolution_id: 'jr_needs_classification_bootstrap',
        turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)),
        context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'needs_classification',
        host_binding: { status: 'managed' },
        classification: null,
        classification_assurance: 'unknown',
        reconciliation_reasons: ['model_interpretation_missing'],
        selected_dag_ids: ['clarification.v1'],
        required_capabilities: [],
        active_node_definitions: [{ id: 'clarification', kind: 'common', instruction: 'Ask for clarification.' }],
        unresolved: ['model_interpretation_missing']
    };
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Host binding for real needs_classification receipts', () => {
    it('records the server project-missing reason instead of rejecting the MCP PostToolUse result', async () => {
        const root = temporaryDirectory();
        const journal = join(root, 'journal');
        const cwd = join(root, 'projectless-cwd');
        mkdirSync(cwd, { recursive: true });
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
        const payload = {
            hook_event_name: 'UserPromptSubmit',
            session_id: 'session-projectless-knowledge',
            turn_id: 'turn-projectless-knowledge',
            prompt: '過去の判断履歴を調べて',
            cwd
        };
        const bootstrapArgs = buildJudgmentRequest(payload, { env });
        expect(bootstrapArgs.project_code).toBeUndefined();
        expect(bootstrapArgs.conversation_context.runtime.project_binding).toBeNull();

        await processHookPayload(payload, {
            env,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ management_status: 'managed', receipt: bootstrapReceipt(bootstrapArgs) })
            })
        });

        const turnRef = `${hash(payload.session_id)}/${hash(payload.turn_id)}`;
        expect(existsSync(join(journal, hash(payload.session_id), `${hash(payload.turn_id)}.turn-input.json`))).toBe(true);

        const service = new JudgmentResolutionService({
            now: () => NOW,
            id: () => 'jr_needs_classification_server',
            personalOwnerPersonId: 'person_owner'
        });
        const app = express();
        app.use(express.json());
        registerJudgmentResolutionApiRoute(app, {
            authService: {
                verifyToken: () => ({
                    sub: 'person_owner', tenantId: 'unson', role: 'ceo', projectCodes: ['brainbase']
                })
            },
            service,
            bindingSecret: SECRET,
            now: () => NOW
        });
        const apiUrl = await listen(app);
        const dependencies = {
            apiUrl,
            configuredProjectCodes: ['brainbase'],
            bindingSecret: SECRET,
            adapterId: 'brainbase-mcp',
            adapterVersion: '1',
            now: () => NOW,
            judgmentJournalRoot: journal,
            tokenManager: {
                getToken: async () => jwt({ sub: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] })
            },
            fetch: globalThis.fetch
        };
        const toolInput = {
            turn_ref: turnRef,
            model_interpretation: {
                intent: 'investigate',
                domains: ['knowledge'],
                action_kind: 'read',
                risk: 'low',
                confidence: 'confirmed',
                signals: []
            }
        };

        // This invokes the model-callable MCP handler and the real Express
        // JudgmentResolutionService route. The projectless context is kept
        // unresolved by the server's safety floor.
        const mcpResult = await handleJudgmentResolutionToolCall(
            'brainbase_resolve_turn',
            toolInput,
            dependencies
        );
        expect(mcpResult).toMatchObject({ status: 'ok' });
        expect(mcpResult.data).toMatchObject({
            status: 'needs_classification',
            project_code: null,
            reconciliation_reasons: ['knowledge_project_code_missing'],
            unresolved: ['knowledge_project_code_missing']
        });

        // PostToolUse receives the MCP CallTool content envelope, not the
        // internal handler object. nestedRecords must still find the receipt.
        const toolResponse = {
            content: [{ type: 'text', text: JSON.stringify(mcpResult, null, 2) }]
        };
        const event = recordBrainbaseToolUse({
            hook_event_name: 'PostToolUse',
            session_id: payload.session_id,
            turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__brainbase_resolve_turn',
            tool_use_id: 'tool-projectless-knowledge',
            tool_input: toolInput,
            tool_response: toolResponse
        }, { env });

        expect(event).toMatchObject({
            event_kind: 'turn_resolution',
            success: true,
            satisfies: ['judgment.resolve_turn'],
            safe_metadata: {
                turn_contract: expect.objectContaining({
                    status: 'needs_classification',
                    project_code: null,
                    reconciliation_reasons: ['knowledge_project_code_missing']
                })
            }
        });
        expect(event.system_message).toContain('参照対象のprojectを確認できない');
        expect(event.system_message).not.toContain('classification_missing確認質問は最終回答へ残さない');

        const audit = readEpisodeAudit(turnRef, { env });
        expect(audit.prefix).toContain('参照対象のprojectを確認できない');

        // The resolved receipt is still an escalation: the server could not
        // bind a project for the knowledge request, so Stop must accept one
        // clarification question without asking for another resolver call.
        const clarification = '⚠️ 確認が必要[classification_missing]: 参照対象のproject_codeを教えてください。';
        const stopped = await processHookPayload({
            ...payload,
            hook_event_name: 'Stop',
            stop_hook_active: false,
            last_assistant_message: `${audit.prefix}\n${clarification}`
        }, { env });
        expect(stopped).toEqual({ systemMessage: audit.prefix });

        const finalPath = join(journal, hash(payload.session_id), `${hash(payload.turn_id)}.final.json`);
        const final = JSON.parse(readFileSync(finalPath, 'utf8'));
        expect(final).toMatchObject({
            completion_status: 'complete',
            owner_audit_complete: true,
            owner_audit_source: 'assistant_answer',
            autonomy_compliance_status: 'escalated',
            stop_decision: {
                business_decision: 'ASK_HUMAN',
                business_reasons: ['classification_missing'],
                protocol_reasons: []
            },
            event_count: 1,
            qualifying_event_count: 0
        });
        expect(final.initial_route_receipt_digest).toBe(hash(canonicalJson(mcpResult.data)));
        expect(final.stop_decision.protocol_reasons).not.toContain('judgment.resolve_turn');
    });
});
