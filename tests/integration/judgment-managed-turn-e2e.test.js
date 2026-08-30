import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { registerJudgmentResolutionApiRoute } from '../../server/bootstrap/register-api-routes.js';
import {
    JudgmentResolutionService,
    computeRequestDigest
} from '../../server/services/judgment-resolution-service.js';
import { __testing as mcpServer } from '../../mcp/brainbase/src/server.ts';
import { runManagedJudgmentTurn } from '../../mcp/brainbase/src/tools/judgment-host-contract.ts';

const NOW = new Date('2026-08-07T00:00:00.000Z');
const SECRET = 'managed-turn-e2e-secret-at-least-32-bytes';

function jwt(payload) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function input(request, turnId, { projectCode = 'brainbase', messages = [], priorReceipts = [] } = {}) {
    const current = { sequence: messages.length, turn_id: turnId, role: 'user', phase: null, text: request };
    const contextWithoutDigest = {
        schema_version: 'brainbase-conversation-context-v1',
        session_ref: 'e'.repeat(64),
        messages: [...messages, current].map((message, sequence) => ({ ...message, sequence })),
        prior_receipts: priorReceipts,
        runtime: { host: 'codex', model: 'gpt-test', permission_mode: 'workspace-write', project_binding: projectCode },
        instruction_bindings: [{ scope: 'repository', source_ref: 'AGENTS.md', digest: 'a'.repeat(64) }],
        completeness: 'complete'
    };
    return {
        request,
        turn_id: turnId,
        project_code: projectCode,
        conversation_context: {
            ...contextWithoutDigest,
            source_digest: computeRequestDigest(contextWithoutDigest)
        }
    };
}

function receiptProjection(receipt) {
    return Object.fromEntries([
        'turn_id', 'resolution_id', 'request_digest', 'context_digest', 'plan_digest', 'classification', 'selected_dag_ids'
    ].map((field) => [field, receipt[field]]));
}

async function listen(app) {
    const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
        candidate.on('error', reject);
    });
    const address = server.address();
    return { server, apiUrl: `http://127.0.0.1:${address.port}` };
}

describe('managed judgment turn end to end', () => {
    const servers = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    });

    it('Host pre-model dispatchからAPI receipt採用・文脈継続・active DAG消費まで通す', async () => {
        let serviceCalls = 0;
        const runtime = new JudgmentResolutionService({
            now: () => NOW,
            id: () => `jr_e2e_${serviceCalls}`,
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
            service: {
                hasHostBinding: (...parameters) => runtime.hasHostBinding(...parameters),
                resolve: (...parameters) => {
                    serviceCalls += 1;
                    return runtime.resolve(...parameters);
                }
            },
            bindingSecret: SECRET,
            now: () => NOW
        });
        const running = await listen(app);
        servers.push(running.server);

        const dependencies = {
            apiUrl: running.apiUrl,
            configuredProjectCodes: ['brainbase'],
            bindingSecret: SECRET,
            adapterId: 'brainbase-mcp',
            adapterVersion: '1',
            now: () => NOW,
            tokenManager: {
                getToken: async () => jwt({ sub: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] })
            },
            fetch: globalThis.fetch
        };
        const resolve = (args) => mcpServer.dispatchJudgmentResolutionBeforeModel(args, dependencies);
        const consumedPlans = [];
        const runTurn = (args) => runManagedJudgmentTurn({
            resolve: () => resolve(args),
            continueTurn: ({ receipt, activeNodeDefinitions }) => {
                consumedPlans.push({ receipt, activeNodeDefinitions });
                return activeNodeDefinitions.map((node) => node.instruction).join('\n');
            }
        });

        expect(mcpServer.tools.some((tool) => tool.name === 'brainbase_judgment_resolve')).toBe(false);

        const firstInput = input('認証APIの設計をレビューして', 'host-turn-e2e-1');
        const first = await runTurn(firstInput);
        expect(first.execution_status).toBe('continued');
        expect(first.receipt).toMatchObject({
            autonomy_decision: 'continue',
            autonomy_reason_code: 'routine_in_scope'
        });
        expect(first.receipt.selected_dag_ids).toEqual(['engineering.v1']);
        expect(first.output).toContain('Fix the actual goal');
        expect(serviceCalls).toBe(1);

        const followUpInput = input('それを修正して', 'host-turn-e2e-2', {
            messages: [
                { turn_id: 'host-turn-e2e-1', role: 'user', phase: null, text: firstInput.request },
                { turn_id: 'host-turn-e2e-1', role: 'assistant', phase: 'final', text: '設計上の問題を説明しました。' }
            ],
            priorReceipts: [receiptProjection(first.receipt)]
        });
        const followUp = await runTurn(followUpInput);
        expect(followUp.execution_status).toBe('continued');
        expect(followUp.receipt.classification).toMatchObject({
            intent: 'implement', domains: ['engineering'], action_kind: 'write'
        });
        expect(followUp.receipt.classification_evidence).toMatchObject({ source: 'prior_receipt' });
        expect(followUp.receipt.autonomy_decision).toBe('continue');
        expect(followUp.receipt.context_digest).toMatch(/^[a-f0-9]{64}$/u);
        expect(serviceCalls).toBe(2);

        const clarification = await runTurn(input('それでいい', 'host-turn-e2e-3'));
        expect(clarification.execution_status).toBe('continued');
        expect(clarification.receipt.status).toBe('needs_classification');
        expect(clarification.receipt).toMatchObject({
            autonomy_decision: 'escalate',
            autonomy_reason_code: 'classification_missing'
        });
        expect(clarification.receipt.active_nodes).toContain('clarification');

        const outsideProject = await runTurn(input('意味を説明して', 'host-turn-e2e-4', { projectCode: 'outside-project' }));
        expect(outsideProject.execution_status).toBe('continued');
        expect(outsideProject.receipt.project_code).toBe('outside-project');
        expect(outsideProject.receipt.applicable_policies.some((policy) => policy.scope?.type === 'project')).toBe(false);

        expect(consumedPlans).toHaveLength(4);
        for (const plan of consumedPlans) {
            expect(plan.activeNodeDefinitions.map((node) => node.id)).toEqual(plan.receipt.active_nodes);
        }
    });
});
