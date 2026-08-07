import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { registerJudgmentResolutionApiRoute } from '../../server/bootstrap/register-api-routes.js';
import { JudgmentResolutionService } from '../../server/services/judgment-resolution-service.js';
import { __testing as mcpServer } from '../../mcp/brainbase/src/server.ts';
import { runManagedJudgmentTurn } from '../../mcp/brainbase/src/tools/judgment-host-contract.ts';

const NOW = new Date('2026-08-07T00:00:00.000Z');
const SECRET = 'managed-turn-e2e-secret-at-least-32-bytes';

function jwt(payload) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none' })}.${encode(payload)}.`;
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

    it('production MCPからauth route・Resolver・receipt再束縛・文脈継続・active node消費まで通す', async () => {
        let serviceCalls = 0;
        const runtime = new JudgmentResolutionService({
            now: () => NOW,
            id: () => `jr_e2e_${serviceCalls}`,
            personalOwnerPersonId: 'person_owner'
        });
        const service = {
            hasHostBinding: (...parameters) => runtime.hasHostBinding(...parameters),
            resolve: (...parameters) => {
                serviceCalls += 1;
                return runtime.resolve(...parameters);
            }
        };
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
        const running = await listen(app);
        servers.push(running.server);

        const token = jwt({ sub: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] });
        const dependencies = {
            apiUrl: running.apiUrl,
            configuredProjectCodes: ['brainbase'],
            bindingSecret: SECRET,
            adapterId: 'brainbase-mcp',
            adapterVersion: '1',
            now: () => NOW,
            tokenManager: { getToken: async () => token },
            fetch: globalThis.fetch
        };
        const firstInput = {
            request: '認証APIの設計をレビューして',
            turn_id: 'host-turn-e2e-1',
            project_code: 'brainbase',
            classification_proposal: {
                intent: 'review', domains: ['engineering'], action_kind: 'read', risk: 'low', confidence: 'confirmed', signals: []
            }
        };
        let resolverCalls = 0;
        const consumedPlans = [];
        const runTurn = (input) => runManagedJudgmentTurn({
            resolve: async () => {
                resolverCalls += 1;
                return mcpServer.dispatchJudgmentResolutionToolCall('brainbase_judgment_resolve', input, dependencies);
            },
            actionKind: 'read',
            continueTurn: ({ receipt, activeNodeDefinitions }) => {
                consumedPlans.push({ receipt, activeNodeDefinitions });
                return activeNodeDefinitions.map((node) => node.instruction).join('\n');
            }
        });

        const first = await runTurn(firstInput);
        expect(first.execution_status).toBe('continued');
        expect(first.receipt.selected_dag_ids).toEqual(['engineering.v1']);
        expect(first.output).toContain('Fix the actual goal');
        expect(resolverCalls).toBe(1);
        expect(serviceCalls).toBe(1);

        const followUp = await runTurn({
            request: 'それをレビューして',
            turn_id: 'host-turn-e2e-2',
            project_code: 'brainbase',
            conversation_context: {
                text: '前のターンでは認証APIの設計を対象にした。',
                source_turn_ids: ['host-turn-e2e-1']
            },
            classification_proposal: {
                intent: 'review', domains: ['engineering'], action_kind: 'read', risk: 'low', confidence: 'confirmed', signals: []
            }
        });
        expect(followUp.execution_status).toBe('continued');
        expect(followUp.receipt.selected_dag_ids).toEqual(['engineering.v1']);
        expect(followUp.receipt.context_digest).toMatch(/^[a-f0-9]{64}$/u);
        expect(resolverCalls).toBe(2);
        expect(serviceCalls).toBe(2);
        expect(consumedPlans).toHaveLength(2);
        for (const plan of consumedPlans) {
            expect(plan.activeNodeDefinitions.map((node) => node.id)).toEqual(plan.receipt.active_nodes);
        }
    });
});
