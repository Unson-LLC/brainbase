import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    DuplicateCandidateError,
    InMemoryCandidateRepository
} from '../../../server/services/candidate-store/candidate-repository.js';
import { ExternalRunnerContractError } from '../../../server/services/external-runner/contract-schema.js';
import { ExternalRunnerIngestService } from '../../../server/services/external-runner/ingest-service.js';
import {
    InMemoryWorkflowRepository,
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    TestAutomationRuntime,
    createDefaultWorkflowHandlers
} from '../../helpers/test-automation-runtime.js';

function makePayload(overrides = {}) {
    const payload = {
        contract_version: 'external_runner.v0',
        runner: {
            type: 'cloudflare_computer',
            external_run_id: 'cloudflare-run-001',
            agent_id: 'sales-agent',
            trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-001'
        },
        run: {
            org_id: 'brainbase',
            project_id: 'brainbase',
            role_agent_id: 'sales',
            workflow_id: 'wf_sales_followup',
            workflow_name: '営業フォローアップ',
            status: 'completed',
            selected_workflow_reason: '案件の次回接触期限が近い'
        },
        loop_control: {
            owner_id: 'keigo',
            cost_owner_id: 'keigo',
            approval_owner_id: 'keigo',
            stop_conditions: ['external_send_requires_approval']
        },
        context_sources: [{
            source_type: 'graph_ssot',
            source_ref: 'customer:acme',
            digest: 'sha256:context',
            redaction_status: 'not_required',
            evidence_refs: ['graph://customer/acme']
        }],
        judgment_dag_trace: {
            dag_id: 'sales-followup-v1',
            version: '1',
            nodes: ['classify', 'draft'],
            evidence_refs: ['graph://customer/acme']
        },
        rounds: [{
            round_id: 'round-1',
            status: 'completed',
            evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/round-1']
        }],
        outputs: [{
            id: 'out-1',
            output_type: 'draft',
            title: 'Slack返信案',
            body: '次回提案の返信案',
            visibility: 'internal',
            approval_required: true,
            evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/out-1']
        }],
        learning_candidates: [{
            candidate_id: 'lc-1',
            cognitive_type: 'insight',
            body: '営業フォローでは期限と顧客温度感を同時に見る',
            promotion_policy: 'manual_review',
            redaction_status: 'not_required',
            evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/out-1']
        }],
        ...overrides
    };
    if (overrides.run && !Object.prototype.hasOwnProperty.call(overrides.run, 'org_id') && overrides.run.project_id) {
        payload.run = {
            ...payload.run,
            org_id: overrides.run.project_id
        };
    }
    return payload;
}

function makeService() {
    const repository = new InMemoryWorkflowRepository();
    const service = new ExternalRunnerIngestService({ workflowRepository: repository });
    return { repository, service };
}

const tempDirs = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

function hashParts(parts) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function expectedCandidateIdentity({
    workspaceId = 'default',
    orgId = 'brainbase',
    projectId = 'brainbase',
    runnerType = 'cloudflare_computer',
    externalRunId = 'cloudflare-run-001',
    sourceCandidateId = 'lc-1'
} = {}) {
    return {
        id: `extcand_${hashParts([
            'external_runner.v0',
            workspaceId,
            orgId,
            projectId,
            runnerType,
            externalRunId,
            sourceCandidateId
        ])}`,
        scopeEventId: `external_runner_scope:${hashParts([
            'external_runner.v0',
            workspaceId,
            orgId,
            projectId,
            runnerType,
            externalRunId
        ])}`
    };
}

function seedLoopControlRefs(repository, {
    orgId = 'salestailor',
    projectId = 'salestailor',
    roleAgentInstanceId = 'rai-salestailor-sales',
    templateId = 'tmpl-sales-followup',
    bindingId = 'bind-salestailor-sales-followup',
    triggerId = 'trg-salestailor-human-sales',
    loopIntentId = 'loop-salestailor-human-sales'
} = {}) {
    repository.upsertRoleAgentInstance({
        id: roleAgentInstanceId,
        workspace_id: 'default',
        org_id: orgId,
        project_id: projectId,
        role_archetype_id: 'sales',
        name: `${orgId} sales agent`
    });
    repository.upsertWorkflowTemplate({
        id: templateId,
        workspace_id: 'default',
        org_id: orgId,
        project_id: projectId,
        name: `${orgId} sales followup`,
        workflow_kind: 'sales'
    });
    repository.upsertWorkflowBinding({
        id: bindingId,
        workspace_id: 'default',
        org_id: orgId,
        project_id: projectId,
        role_agent_instance_id: roleAgentInstanceId,
        workflow_template_id: templateId,
        autonomy_level: 'approval_required'
    });
    repository.upsertWorkflowTrigger({
        id: triggerId,
        workspace_id: 'default',
        org_id: orgId,
        project_id: projectId,
        workflow_binding_id: bindingId,
        trigger_type: 'human'
    });
    repository.upsertLoopIntent({
        id: loopIntentId,
        workspace_id: 'default',
        org_id: orgId,
        project_id: projectId,
        role_agent_instance_id: roleAgentInstanceId,
        workflow_template_id: templateId,
        workflow_binding_id: bindingId,
        trigger_id: triggerId,
        trigger_type: 'human',
        eligibility: {
            status: 'needs_approval',
            autonomy_level: 'approval_required',
            requires_human_approval: true
        }
    });
}

describe('ExternalRunnerIngestService', () => {
    function expectRunIdForExternalRun(runId, externalRunId) {
        const readable = String(externalRunId || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
        expect(runId).toMatch(new RegExp(`^run_brainbase_brainbase_cloudflare_computer_${readable}_[a-f0-9]{12}$`));
    }

    it('ingests S-001 runner.type=cloudflare_computer envelope into Workflow Mission Control surfaces', async () => {
        const { repository, service } = makeService();

        const result = await service.ingest(makePayload());

        expect(result.status).toBe('created');
        expect(result.workflow).toMatchObject({
            id: 'wf_sales_followup',
            execution_env: 'external',
            implementation_key: 'external-runner:cloudflare_computer'
        });
        expect(result.run).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            action_required: 'none'
        });
        expectRunIdForExternalRun(result.run.id, 'cloudflare-run-001');
        expect(result.context_snapshots).toHaveLength(1);
        expect(result.outputs).toHaveLength(1);
        expect(result.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-1',
                persistence_status: 'deferred'
            })
        ]);
        expect(repository.listAuditLogs({ targetId: result.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.ingested' }),
            expect.objectContaining({ action: 'external_runner.round_recorded' }),
            expect.objectContaining({ action: 'external_runner.learning_candidate.deferred' })
        ]));
    });

    it('propagates org agent loop control references from Cloudflare/computer payload into WMC and learning candidates', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository);

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-org-loop-001',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-org-loop-001'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed',
                selected_workflow_reason: 'SalesTailorの接触期限と商談状態から選択',
                eligibility: {
                    status: 'needs_approval',
                    autonomy_level: 'approval_required',
                    requires_human_approval: true
                }
            },
            learning_candidates: [{
                candidate_id: 'lc-1',
                cognitive_type: 'insight',
                body: '営業フォローでは期限と顧客温度感を同時に見る',
                promotion_policy: 'manual_review',
                redaction_status: 'not_required',
                org_ids: [],
                evidence_refs: ['cloudflare-computer://trace/cloudflare-org-loop-001/output/out-1']
            }]
        }));

        expect(result.run.id).toMatch(/^run_salestailor_salestailor_cloudflare_computer_cloudflare-org-loop-001_[a-f0-9]{12}$/);
        expect(result.workflow).toMatchObject({
            id: 'external_runner_salestailor_salestailor_sales-agent',
            org_id: 'salestailor',
            project_id: 'salestailor'
        });
        expect(result.run).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-salestailor-sales',
            workflow_template_id: 'tmpl-sales-followup',
            workflow_binding_id: 'bind-salestailor-sales-followup',
            trigger_id: 'trg-salestailor-human-sales',
            loop_intent_id: 'loop-salestailor-human-sales',
            metadata: {
                org_id: 'salestailor',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                eligibility: {
                    status: 'needs_approval',
                    autonomy_level: 'approval_required',
                    requires_human_approval: true
                }
            }
        });
        expect(result.context_snapshots).toEqual([
            expect.objectContaining({ org_id: 'salestailor' })
        ]);
        expect(result.outputs).toEqual([
            expect.objectContaining({ org_id: 'salestailor' })
        ]);
        expect(result.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-1',
                org_ids: ['salestailor'],
                project_ids: ['salestailor'],
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                persistence_status: 'deferred'
            })
        ]);
        expect(repository.listAuditLogs({ targetId: result.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                org_id: 'salestailor',
                action: 'external_runner.ingested',
                after: expect.objectContaining({
                    role_agent_instance_id: 'rai-salestailor-sales',
                    loop_intent_id: 'loop-salestailor-human-sales'
                })
            }),
            expect.objectContaining({
                org_id: 'salestailor',
                action: 'external_runner.learning_candidate.deferred',
                after: expect.objectContaining({
                    role_agent_instance_id: 'rai-salestailor-sales',
                    workflow_template_id: 'tmpl-sales-followup',
                    workflow_binding_id: 'bind-salestailor-sales-followup',
                    trigger_id: 'trg-salestailor-human-sales',
                    loop_intent_id: 'loop-salestailor-human-sales'
                })
            })
        ]));
    });

    it('derives learning candidate org and project scope from validated run scope instead of Cloudflare/computer payload', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository);

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-org-loop-scope-override',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-org-loop-scope-override'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed',
                selected_workflow_reason: 'SalesTailorの接触期限と商談状態から選択'
            },
            learning_candidates: [{
                candidate_id: 'lc-cross-org',
                cognitive_type: 'insight',
                body: '外部runnerはLearning Candidateのscopeを決められない',
                promotion_policy: 'manual_review',
                redaction_status: 'not_required',
                org_ids: ['unson'],
                project_ids: ['unson'],
                project_id: 'unson',
                evidence_refs: ['cloudflare-computer://trace/cloudflare-org-loop-scope-override/output/out-1']
            }]
        }));

        expect(result.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-cross-org',
                org_ids: ['salestailor'],
                project_ids: ['salestailor'],
                project_id: 'salestailor',
                persistence_status: 'deferred'
            })
        ]);
        expect(repository.listAuditLogs({ targetId: result.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                org_id: 'salestailor',
                action: 'external_runner.learning_candidate.deferred',
                after: expect.objectContaining({
                    candidate_id: 'lc-cross-org',
                    org_ids: ['salestailor'],
                    project_ids: ['salestailor'],
                    project_id: 'salestailor'
                })
            })
        ]));
    });

    it('requires run.org_id when Cloudflare/computer payload carries loop control references', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository);

        await expect(service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-loop-ref-missing-org',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-loop-ref-missing-org'
            },
            run: {
                org_id: undefined,
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'missing_org_id_for_loop_ref'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects unknown org references from Cloudflare/computer payloads without loop-control refs before persistence', async () => {
        const { repository, service } = makeService();

        await expect(service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-unknown-org-no-loop-refs',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-unknown-org-no-loop-refs'
            },
            run: {
                org_id: 'unknown-org',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                workflow_id: 'wf_unknown_org_sales',
                workflow_name: 'Unknown Org Sales',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'unknown_org_reference',
            details: {
                org_id: 'unknown-org',
                project_id: 'salestailor'
            }
        });
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listWorkflows()).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    for (const { field, type } of [
        { field: 'role_agent_instance_id', type: 'role_agent_instance' },
        { field: 'workflow_binding_id', type: 'workflow_binding' },
        { field: 'trigger_id', type: 'workflow_trigger' },
        { field: 'loop_intent_id', type: 'loop_intent' }
    ]) {
        it(`rejects orgless ${type} refs for org-scoped Cloudflare/computer payloads`, async () => {
            const { repository, service } = makeService();
            seedLoopControlRefs(repository, { orgId: null });
            const refIds = {
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales'
            };

            await expect(service.ingest(makePayload({
                runner: {
                    type: 'cloudflare_computer',
                    external_run_id: `cloudflare-orgless-${type}`,
                    agent_id: 'sales-agent',
                    trace_ref: `https://vercel.com/acme/computer/traces/cloudflare-orgless-${type}`
                },
                run: {
                    org_id: 'salestailor',
                    project_id: 'salestailor',
                    role_agent_id: 'sales',
                    [field]: refIds[field],
                    status: 'completed'
                }
            }))).rejects.toMatchObject({
                code: 'loop_control_ref_scope_mismatch',
                details: {
                    type,
                    expected_org_id: 'salestailor',
                    actual_org_id: null
                }
            });
            expect(repository.listRuns()).toHaveLength(0);
            expect(repository.listAuditLogs()).toHaveLength(0);
        });
    }

    it('rejects org-scoped loop control workflow_id collisions with orgless workflows before WMC persistence', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository);
        repository.upsertWorkflow({
            id: 'wf_orgless_sales_followup',
            workspace_id: 'default',
            project_id: 'salestailor',
            name: 'Legacy project workflow',
            owner_id: 'owner-a',
            default_assignee_id: 'owner-a',
            default_approver_id: 'owner-a',
            execution_env: 'local',
            implementation_key: 'manual-placeholder',
            context_sources: []
        });

        await expect(service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-org-loop-workflow-collision',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-org-loop-workflow-collision'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                workflow_id: 'wf_orgless_sales_followup',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'workflow_org_mismatch',
            details: {
                workflow_id: 'wf_orgless_sales_followup',
                workflow_org_id: null,
                run_org_id: 'salestailor'
            }
        });
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('rejects cross-org loop control refs before WMC persistence', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-unson-sales',
            bindingId: 'bind-unson-sales',
            triggerId: 'trg-unson-human-sales',
            loopIntentId: 'loop-unson-human-sales'
        });

        await expect(service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-cross-loop-ref',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-cross-loop-ref'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-unson-sales',
                workflow_template_id: 'tmpl-unson-sales',
                workflow_binding_id: 'bind-unson-sales',
                trigger_id: 'trg-unson-human-sales',
                loop_intent_id: 'loop-unson-human-sales',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'loop_control_ref_scope_mismatch'
        });
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'run_salestailor_salestailor_cloudflare_computer_cloudflare-cross-loop-ref_fallback' })).toHaveLength(0);
    });

    it('rejects same-scope partial loop refs when lineage points to a different binding', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-a',
            templateId: 'tmpl-a',
            bindingId: 'bind-a',
            triggerId: 'trg-a',
            loopIntentId: 'loop-a'
        });
        seedLoopControlRefs(repository, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-b',
            templateId: 'tmpl-b',
            bindingId: 'bind-b',
            triggerId: 'trg-b',
            loopIntentId: 'loop-b'
        });

        await expect(service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-partial-loop-ref',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-partial-loop-ref'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-a',
                workflow_template_id: 'tmpl-a',
                loop_intent_id: 'loop-b',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'loop_control_ref_relationship_mismatch'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rolls back WMC partial persistence when storage fails mid-ingest', async () => {
        class FailingOutputRepository extends InMemoryWorkflowRepository {
            createOutput() {
                throw new Error('output storage unavailable');
            }
        }
        const repository = new FailingOutputRepository();
        const service = new ExternalRunnerIngestService({ workflowRepository: repository });

        await expect(service.ingest(makePayload())).rejects.toThrow('output storage unavailable');
        expect(repository.listWorkflows()).toHaveLength(0);
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listContextSnapshots('run_brainbase_brainbase_cloudflare_computer_cloudflare-run-001')).toHaveLength(0);
        expect(repository.listOutputs('run_brainbase_brainbase_cloudflare_computer_cloudflare-run-001')).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('rejects duplicate replay when an existing run has only partial WMC persistence', async () => {
        const { repository, service } = makeService();
        const normalized = service.adapter.normalize(makePayload());
        repository.upsertWorkflow(normalized.workflow);
        repository.createRun(normalized.run);

        await expect(service.ingest(makePayload())).rejects.toMatchObject({
            code: 'partial_ingest_state',
            details: {
                missing: expect.arrayContaining(['context_snapshots', 'outputs', 'audit_logs', 'learning_candidates'])
            }
        });
        expect(repository.listRuns()).toHaveLength(1);
        expect(repository.listOutputs(normalized.run.id)).toHaveLength(0);
    });

    it('rejects S-003 Cloudflare/computer payloads without trace_ref before creating a completed run', async () => {
        const { repository, service } = makeService();
        const payload = makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-002',
                agent_id: 'sales-agent',
            }
        });

        await expect(service.ingest(payload)).rejects.toMatchObject({
            code: 'missing_string'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects top-level non-object payloads before creating workflow state', async () => {
        const { repository, service } = makeService();

        await expect(service.ingest([])).rejects.toMatchObject({
            code: 'invalid_object',
            message: 'payload must be an object'
        });
        await expect(service.ingest(null)).rejects.toMatchObject({
            code: 'invalid_object',
            message: 'payload must be an object'
        });
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('rejects schema failure modes before creating workflow state', async () => {
        const cases = [
            {
                name: 'unsupported contract version',
                patch: { contract_version: 'external_runner.v1' },
                code: 'unsupported_contract_version'
            },
            {
                name: 'unsupported runner type',
                patch: {
                    runner: {
                        type: 'crewai',
                        external_run_id: 'crew-run-001',
                        agent_id: 'sales-agent'
                    }
                },
                code: 'unsupported_runner_type'
            },
            {
                name: 'missing external run id',
                patch: {
                    runner: {
                        type: 'cloudflare_computer',
                        external_run_id: '',
                        agent_id: 'sales-agent',
                        trace_ref: 'https://vercel.com/acme/computer/traces/missing-run-id'
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing runner agent id',
                patch: {
                    runner: {
                        type: 'cloudflare_computer',
                        external_run_id: 'cloudflare-run-missing-agent',
                        agent_id: '',
                        trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-missing-agent'
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing run project id',
                patch: {
                    run: {
                        project_id: '',
                        role_agent_id: 'sales',
                        workflow_id: 'wf_sales_followup',
                        workflow_name: '営業フォローアップ',
                        status: 'completed'
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing run role agent id',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: '',
                        workflow_id: 'wf_sales_followup',
                        workflow_name: '営業フォローアップ',
                        status: 'completed'
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing context source collection',
                patch: { context_sources: [] },
                code: 'missing_context_source'
            },
            {
                name: 'missing context source type',
                patch: {
                    context_sources: [{
                        source_type: '',
                        source_ref: 'customer:acme',
                        redaction_status: 'not_required'
                    }]
                },
                code: 'missing_string'
            },
            {
                name: 'missing context source ref',
                patch: {
                    context_sources: [{
                        source_type: 'graph_ssot',
                        source_ref: '',
                        redaction_status: 'not_required'
                    }]
                },
                code: 'missing_string'
            },
            {
                name: 'missing round collection',
                patch: { rounds: [] },
                code: 'missing_round'
            },
            {
                name: 'missing round id',
                patch: { rounds: [{ round_id: '', status: 'completed', evidence_refs: ['cloudflare-computer://trace/round'] }] },
                code: 'missing_string'
            },
            {
                name: 'missing round status',
                patch: { rounds: [{ round_id: 'round-missing-status', status: '', evidence_refs: ['cloudflare-computer://trace/round'] }] },
                code: 'missing_string'
            },
            {
                name: 'missing round evidence',
                patch: { rounds: [{ round_id: 'round-empty', status: 'completed', evidence_refs: [] }] },
                code: 'missing_round_evidence'
            },
            {
                name: 'missing stop condition',
                patch: {
                    loop_control: {
                        owner_id: 'keigo',
                        cost_owner_id: 'keigo',
                        approval_owner_id: 'keigo',
                        stop_conditions: []
                    }
                },
                code: 'missing_stop_condition'
            },
            {
                name: 'blank stop condition',
                patch: {
                    loop_control: {
                        owner_id: 'keigo',
                        cost_owner_id: 'keigo',
                        approval_owner_id: 'keigo',
                        stop_conditions: ['']
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'invalid stop condition type',
                patch: {
                    loop_control: {
                        owner_id: 'keigo',
                        cost_owner_id: 'keigo',
                        approval_owner_id: 'keigo',
                        stop_conditions: [{}]
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing loop owner id',
                patch: {
                    loop_control: {
                        owner_id: '',
                        cost_owner_id: 'keigo',
                        approval_owner_id: 'keigo',
                        stop_conditions: ['external_send_requires_approval']
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing loop cost owner id',
                patch: {
                    loop_control: {
                        owner_id: 'keigo',
                        cost_owner_id: '',
                        approval_owner_id: 'keigo',
                        stop_conditions: ['external_send_requires_approval']
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing loop approval owner id',
                patch: {
                    loop_control: {
                        owner_id: 'keigo',
                        cost_owner_id: 'keigo',
                        approval_owner_id: '',
                        stop_conditions: ['external_send_requires_approval']
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'blocked context redaction',
                patch: {
                    context_sources: [{
                        source_type: 'graph_ssot',
                        source_ref: 'customer:acme',
                        redaction_status: 'blocked'
                    }]
                },
                code: 'blocked_context_source'
            },
            {
                name: 'blocked learning candidate redaction',
                patch: {
                    learning_candidates: [{
                        candidate_id: 'lc-blocked',
                        cognitive_type: 'claim',
                        body: 'redacted candidate',
                        promotion_policy: 'manual_review',
                        redaction_status: 'blocked'
                    }]
                },
                code: 'blocked_learning_candidate'
            },
            {
                name: 'missing learning candidate id',
                patch: {
                    learning_candidates: [{
                        candidate_id: '',
                        cognitive_type: 'claim',
                        body: 'missing candidate id',
                        promotion_policy: 'manual_review',
                        redaction_status: 'not_required'
                    }]
                },
                code: 'missing_string'
            },
            {
                name: 'missing learning candidate body',
                patch: {
                    learning_candidates: [{
                        candidate_id: 'lc-missing-body',
                        cognitive_type: 'claim',
                        body: '',
                        promotion_policy: 'manual_review',
                        redaction_status: 'not_required'
                    }]
                },
                code: 'missing_string'
            },
            {
                name: 'approval without human step',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        workflow_id: 'wf_sales_followup',
                        workflow_name: '営業フォローアップ',
                        status: 'approval_required'
                    },
                    human_steps: []
                },
                code: 'missing_human_step'
            },
            {
                name: 'waiting human without actionable prompt',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        workflow_id: 'wf_sales_followup',
                        workflow_name: '営業フォローアップ',
                        status: 'waiting_human'
                    },
                    human_steps: [{ id: 'hs-empty', step_type: 'approval' }]
                },
                code: 'missing_human_prompt'
            },
            {
                name: 'waiting human with blank prompt',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        workflow_id: 'wf_sales_followup',
                        workflow_name: '営業フォローアップ',
                        status: 'waiting_human'
                    },
                    human_steps: [{ id: 'hs-blank', step_type: 'approval', prompt: '   ' }]
                },
                code: 'missing_human_prompt'
            },
            {
                name: 'unsupported run status',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        workflow_id: 'wf_sales_followup',
                        workflow_name: '営業フォローアップ',
                        status: 'succeeded'
                    }
                },
                code: 'unsupported_run_status'
            },
            {
                name: 'unsupported run trigger type',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        status: 'completed',
                        trigger_type: 'webhook'
                    }
                },
                code: 'unsupported_trigger_type'
            },
            {
                name: 'unsupported run eligibility autonomy level',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        status: 'completed',
                        eligibility: {
                            status: 'eligible',
                            autonomy_level: 'root_access'
                        }
                    }
                },
                code: 'unsupported_autonomy_level'
            },
            {
                name: 'unsupported run eligibility status',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        status: 'completed',
                        eligibility: {
                            status: 'queued',
                            autonomy_level: 'approval_required'
                        }
                    }
                },
                code: 'unsupported_eligibility_status'
            },
            {
                name: 'invalid run eligibility approval flag',
                patch: {
                    run: {
                        project_id: 'brainbase',
                        role_agent_id: 'sales',
                        status: 'completed',
                        eligibility: {
                            status: 'eligible',
                            autonomy_level: 'auto_execute',
                            requires_human_approval: 'false'
                        }
                    }
                },
                code: 'invalid_boolean'
            },
            {
                name: 'invalid optional human_steps array',
                patch: { human_steps: {} },
                code: 'invalid_array'
            },
            {
                name: 'invalid optional human_steps element',
                patch: { human_steps: [null] },
                code: 'invalid_object'
            },
            {
                name: 'invalid optional outputs array',
                patch: { outputs: {} },
                code: 'invalid_array'
            },
            {
                name: 'invalid optional outputs element',
                patch: { outputs: ['not-an-output'] },
                code: 'invalid_object'
            },
            {
                name: 'invalid optional learning_candidates array',
                patch: { learning_candidates: {} },
                code: 'invalid_array'
            },
            {
                name: 'invalid optional learning_candidates element',
                patch: { learning_candidates: [null] },
                code: 'invalid_object'
            }
        ];

        for (const item of cases) {
            const { repository, service } = makeService();
            await expect(service.ingest(makePayload(item.patch)), item.name).rejects.toMatchObject({ code: item.code });
            expect(repository.listRuns(), item.name).toHaveLength(0);
            expect(repository.listAuditLogs(), item.name).toHaveLength(0);
        }
    });

    it('blocks direct Graph auto-promotion learning candidates', async () => {
        const { service } = makeService();
        const payload = makePayload({
            learning_candidates: [{
                candidate_id: 'lc-auto',
                cognitive_type: 'claim',
                body: '外部runnerがGraphへ直昇格してよい',
                promotion_policy: 'auto_promote',
                redaction_status: 'not_required'
            }]
        });

        await expect(service.ingest(payload)).rejects.toBeInstanceOf(ExternalRunnerContractError);
        await expect(service.ingest(payload)).rejects.toMatchObject({
            code: 'forbidden_auto_promotion'
        });
    });

    it('rejects invalid learning candidates before partially persisting a run', async () => {
        const repository = new InMemoryWorkflowRepository();
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            candidateRepository: {
                async create() {
                    throw new Error('Candidate Store should not be called for invalid contract payloads');
                }
            }
        });
        const payload = makePayload({
            learning_candidates: [{
                candidate_id: 'lc-invalid',
                promotion_policy: 'manual_review',
                redaction_status: 'not_required'
            }]
        });

        await expect(service.ingest(payload)).rejects.toMatchObject({
            code: 'missing_string',
            details: { path: 'learning_candidates[0].cognitive_type' }
        });
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('treats repeated Cloudflare/computer run ids as idempotent duplicates', async () => {
        const { repository, service } = makeService();

        const first = await service.ingest(makePayload());
        const second = await service.ingest(makePayload());

        expect(first.status).toBe('created');
        expect(second).toMatchObject({
            status: 'duplicate',
            run: { id: first.run.id }
        });
        expect(second.outputs).toHaveLength(1);
        expect(second.audit_logs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.duplicate_replay_ignored',
                target_id: first.run.id,
                after: expect.objectContaining({
                    reason: 'idempotent_duplicate',
                    original_run_id: first.run.id
                })
            })
        ]));
        expect(repository.listAuditLogs({ targetId: first.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.duplicate_replay_ignored' })
        ]));
    });

    it('serializes concurrent identical ingests across JsonFile repository instances', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-external-runner-race-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'workflow-ledger.json');
        const firstRepository = new JsonFileWorkflowRepository({ filePath });
        const secondRepository = new JsonFileWorkflowRepository({ filePath });
        const firstService = new ExternalRunnerIngestService({ workflowRepository: firstRepository });
        const secondService = new ExternalRunnerIngestService({ workflowRepository: secondRepository });
        const payload = makePayload({ learning_candidates: [] });

        const results = await Promise.all([
            firstService.ingest(payload),
            secondService.ingest(payload)
        ]);
        const persisted = new JsonFileWorkflowRepository({ filePath });
        const runId = results[0].run.id;

        expect(results.map((result) => result.status).sort()).toEqual(['created', 'duplicate']);
        expect(persisted.listRuns({ limit: null })).toHaveLength(1);
        expect(persisted.listContextSnapshots(runId)).toHaveLength(1);
        expect(persisted.listHumanSteps(runId)).toHaveLength(0);
        expect(persisted.listOutputs(runId)).toHaveLength(1);
        expect(persisted.listAuditLogs({ targetId: runId })
            .filter((entry) => entry.action === 'external_runner.ingested')).toHaveLength(1);
    });

    it('accepts the legacy explicit external_runner trigger type for external_runner.v0 payloads', async () => {
        const { repository, service } = makeService();

        const result = await service.ingest(makePayload({
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'completed',
                trigger_type: 'external_runner'
            }
        }));

        expect(result.run).toMatchObject({
            trigger_type: 'external_runner',
            status: 'success'
        });
        expect(repository.listRuns()).toHaveLength(1);
    });

    it('normalizes loop-control Cloudflare/computer trigger_type from the referenced workflow trigger', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository);

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-loop-legacy-trigger-type',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-loop-legacy-trigger-type'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                loop_intent_id: 'loop-salestailor-human-sales',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed',
                trigger_type: 'external_runner'
            }
        }));

        expect(result.run).toMatchObject({
            trigger_id: 'trg-salestailor-human-sales',
            trigger_type: 'human',
            metadata: expect.objectContaining({
                trigger_id: 'trg-salestailor-human-sales',
                trigger_type: 'human'
            })
        });
        expect(repository.listRuns()[0]).toMatchObject({
            trigger_type: 'human'
        });
    });

    it('rejects duplicate replay when the external run payload content changes', async () => {
        const { repository, service } = makeService();

        await service.ingest(makePayload());
        await expect(service.ingest(makePayload({
            outputs: [{
                id: 'out-1',
                output_type: 'draft',
                title: 'Slack返信案',
                body: '同じCloudflare/computer run idで本文が変わった返信案',
                visibility: 'internal',
                approval_required: true,
                evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/out-1']
            }],
            learning_candidates: [{
                candidate_id: 'lc-1',
                cognitive_type: 'insight',
                body: '同じCloudflare/computer run idで学習候補が変わった',
                promotion_policy: 'manual_review',
                redaction_status: 'not_required',
                evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/out-1']
            }]
        }))).rejects.toMatchObject({
            code: 'duplicate_payload_mismatch',
            details: {
                surface: 'outputs'
            }
        });
        expect(repository.listRuns()).toHaveLength(1);
        expect(repository.listOutputs(repository.listRuns()[0].id)).toEqual([
            expect.objectContaining({ body: '次回提案の返信案' })
        ]);
    });

    it('rejects duplicate replay when Loop Control references change under the same external run id', async () => {
        const { repository, service } = makeService();
        seedLoopControlRefs(repository, {
            roleAgentInstanceId: 'rai-a',
            templateId: 'tmpl-a',
            bindingId: 'bind-a',
            triggerId: 'trg-a',
            loopIntentId: 'loop-a'
        });
        seedLoopControlRefs(repository, {
            roleAgentInstanceId: 'rai-b',
            templateId: 'tmpl-b',
            bindingId: 'bind-b',
            triggerId: 'trg-b',
            loopIntentId: 'loop-b'
        });

        const first = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-conflicting-duplicate',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-conflicting-duplicate'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-a',
                workflow_template_id: 'tmpl-a',
                workflow_binding_id: 'bind-a',
                trigger_id: 'trg-a',
                loop_intent_id: 'loop-a',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed'
            }
        }));

        await expect(service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-conflicting-duplicate',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-conflicting-duplicate'
            },
            run: {
                org_id: 'salestailor',
                project_id: 'salestailor',
                role_agent_id: 'sales',
                role_agent_instance_id: 'rai-b',
                workflow_template_id: 'tmpl-b',
                workflow_binding_id: 'bind-b',
                trigger_id: 'trg-b',
                loop_intent_id: 'loop-b',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'duplicate_payload_mismatch',
            details: {
                workflow_run_id: first.run.id,
                surface: 'run'
            }
        });
        expect(repository.listRuns()).toHaveLength(1);
        expect(repository.listRuns()[0]).toMatchObject({
            role_agent_instance_id: 'rai-a',
            loop_intent_id: 'loop-a'
        });
    });

    it('does not collapse distinct Cloudflare/computer run ids that normalize to the same readable prefix', async () => {
        const { repository, service } = makeService();

        const slash = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare/run-collision',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-collision-slash'
            }
        }));
        const underscore = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare_run-collision',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-collision-underscore'
            },
            outputs: [{
                id: 'out-2',
                output_type: 'draft',
                title: '別runの返信案',
                body: '正規化衝突しない返信案',
                visibility: 'internal',
                evidence_refs: ['cloudflare-computer://trace/cloudflare-run-collision-underscore/output/out-2']
            }]
        }));

        expect(slash.status).toBe('created');
        expect(underscore.status).toBe('created');
        expect(slash.run.id).not.toBe(underscore.run.id);
        expect(repository.listRuns()).toHaveLength(2);
        expect(repository.listOutputs(underscore.run.id)).toEqual(expect.arrayContaining([
            expect.objectContaining({ title: '別runの返信案' })
        ]));
    });

    it('uses project, runner type, and external run id as the idempotency key even when workflow_run_id differs', async () => {
        const { repository, service } = makeService();

        const first = await service.ingest(makePayload({
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'completed',
                workflow_run_id: 'caller-run-a'
            }
        }));
        const second = await service.ingest(makePayload({
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'completed',
                workflow_run_id: 'caller-run-b'
            }
        }));

        expectRunIdForExternalRun(first.run.id, 'cloudflare-run-001');
        expect(second).toMatchObject({
            status: 'duplicate',
            run: { id: first.run.id }
        });
        expect(repository.listRuns()).toHaveLength(1);
    });

    it('does not replay a duplicate across project boundaries for the same Cloudflare/computer external run id', async () => {
        const { repository, service } = makeService();

        const first = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-cross-project',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-cross-project-brainbase'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'completed'
            }
        }));
        const second = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-cross-project',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-cross-project-salestailor'
            },
            run: {
                project_id: 'salestailor',
                role_agent_id: 'sales',
                workflow_id: 'wf_salestailor_followup',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed'
            }
        }));

        expect(first.status).toBe('created');
        expect(second.status).toBe('created');
        expect(first.run.id).not.toBe(second.run.id);
        expect(first.run.project_id).toBe('brainbase');
        expect(second.run.project_id).toBe('salestailor');
        expect(repository.listRuns()).toHaveLength(2);
    });

    it('S-004d uses project-scoped fallback workflow ids when workflow_id is omitted', async () => {
        const { repository, service } = makeService();

        const first = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-fallback-workflow',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-fallback-workflow-brainbase'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_name: '営業フォローアップ',
                status: 'completed'
            }
        }));
        const second = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-fallback-workflow',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-fallback-workflow-salestailor'
            },
            run: {
                project_id: 'salestailor',
                role_agent_id: 'sales',
                workflow_name: 'SalesTailor営業フォローアップ',
                status: 'completed'
            }
        }));

        expect(first.status).toBe('created');
        expect(second.status).toBe('created');
        expect(first.workflow.id).toBe('external_runner_brainbase_brainbase_sales-agent');
        expect(second.workflow.id).toBe('external_runner_salestailor_salestailor_sales-agent');
        expect(repository.listRuns()).toHaveLength(2);
    });

    it('does not overwrite an existing Brainbase workflow definition on workflow_id collision', async () => {
        const { repository, service } = makeService();
        repository.upsertWorkflow({
            id: 'wf_sales_followup',
            workspace_id: 'default',
            project_id: 'brainbase',
            name: 'Existing local workflow',
            owner_id: 'owner-a',
            default_assignee_id: 'owner-a',
            default_approver_id: 'owner-a',
            execution_env: 'local',
            implementation_key: 'manual-placeholder',
            context_sources: []
        });

        const result = await service.ingest(makePayload({
            loop_control: {
                owner_id: 'owner-b',
                cost_owner_id: 'owner-b',
                approval_owner_id: 'owner-b',
                stop_conditions: ['external_send_requires_approval']
            }
        }));

        expect(repository.getWorkflow('wf_sales_followup')).toMatchObject({
            name: 'Existing local workflow',
            owner_id: 'owner-a',
            execution_env: 'local',
            implementation_key: 'manual-placeholder'
        });
        expect(repository.getRun(result.run.id)).toMatchObject({
            workflow_id: 'wf_sales_followup',
            status: 'success'
        });
    });

    it('rejects cross-project workflow_id collisions before creating a run', async () => {
        const { repository, service } = makeService();
        repository.upsertWorkflow({
            id: 'wf_shared_collision',
            workspace_id: 'default',
            project_id: 'brainbase',
            name: 'Brainbase existing workflow',
            owner_id: 'owner-a',
            default_assignee_id: 'owner-a',
            default_approver_id: 'owner-a',
            execution_env: 'local',
            implementation_key: 'manual-placeholder',
            context_sources: []
        });

        await expect(service.ingest(makePayload({
            run: {
                project_id: 'salestailor',
                role_agent_id: 'sales',
                workflow_id: 'wf_shared_collision',
                workflow_name: 'SalesTailor followup',
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'workflow_project_mismatch',
            details: {
                workflow_id: 'wf_shared_collision',
                workflow_project_id: 'brainbase',
                run_project_id: 'salestailor'
            }
        });
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('maps cancelled Cloudflare/computer runs to closed cancelled workflow state', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-cancelled',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-cancelled'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'cancelled',
                selected_workflow_reason: '停止条件に到達した'
            }
        }));

        expect(result.run).toMatchObject({
            status: 'cancelled',
            closure_state: 'closed',
            action_required: 'none'
        });
    });

    it('maps waiting_human Cloudflare/computer runs to approval-required workflow state', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-waiting-human',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-waiting-human'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'waiting_human',
                selected_workflow_reason: 'Cloudflare/computer側で人間承認待ち'
            },
            human_steps: [{
                id: 'hs-waiting-human',
                step_type: 'approval',
                prompt: 'Cloudflare/computer側の承認をBrainbaseで確認する'
            }]
        }));

        expect(result.run).toMatchObject({
            status: 'waiting_human',
            closure_state: 'open',
            action_required: 'approve',
            human_waiting: true
        });
        expect(result.human_steps[0]).toMatchObject({
            id: 'hs-waiting-human',
            status: 'pending',
            prompt: 'Cloudflare/computer側の承認をBrainbaseで確認する',
            title: 'Cloudflare/computer側の承認をBrainbaseで確認する',
            requested_to: 'keigo',
            required_by: 'keigo'
        });
    });

    it('lets the loop approval owner resolve an external-runner human step through Workflow Mission Control', async () => {
        const { repository, service } = makeService();
        const runner = new WorkflowRunner({
            repository,
            handlers: createDefaultWorkflowHandlers()
        });
        runner.registerHandler('external-runner:cloudflare_computer', async (ctx) => ({
            status: 'success',
            closureState: 'closed',
            actionRequired: 'none',
            message: `External runner approval ${ctx.humanStepResolution?.resolution || 'recorded'}`,
            outputCount: 1,
            data: { humanStepResolution: ctx.humanStepResolution }
        }));
        const workflowService = new TestAutomationRuntime({
            repository,
            runner,
            configParser: {
                async getProjects() {
                    return {
                        source: { status: 'loaded', mode: 'registry_scoped' },
                        projects: [{ id: 'brainbase', session_select: true }]
                    };
                }
            }
        });

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-resolvable-human',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-resolvable-human'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'approval_required',
                selected_workflow_reason: '外部送信前にBrainbase側の承認が必要'
            },
            human_steps: [{
                id: 'hs-external-resolvable',
                step_type: 'approval',
                prompt: 'Cloudflare/computer側の外部送信を承認する'
            }]
        }));

        expect(result.human_steps[0]).toMatchObject({
            id: 'hs-external-resolvable',
            requested_to: 'keigo',
            required_by: 'keigo'
        });

        const resolved = await workflowService.automationRunService.resolveHumanStep(
            'hs-external-resolvable',
            { resolution: 'approved' },
            {
                person_id: 'keigo',
                projectCodes: ['brainbase'],
                role: 'member',
                authSource: 'test',
                organizationId: 'brainbase'
            }
        );

        expect(resolved.human_step).toMatchObject({
            id: 'hs-external-resolvable',
            status: 'approved',
            resolved_by: 'keigo'
        });
        expect(resolved.resumed_run).toMatchObject({
            workflow_id: 'wf_sales_followup',
            parent_run_id: result.run.id,
            trigger_type: 'human_resume',
            status: 'success',
            closure_state: 'closed'
        });
    });

    it('closes an agent_report run on approval without leaving an orphan needs_action run', async () => {
        const { repository, service } = makeService();
        // Note: intentionally NO handler registered for external-runner:agent_report.
        // agent_report runs carry no executable workflow; the generic runWorkflow
        // fallback would produce an orphan needs_action run. The special-case in
        // resolveHumanStep must close the run instead.
        const runner = new WorkflowRunner({
            repository,
            handlers: createDefaultWorkflowHandlers()
        });
        const workflowService = new TestAutomationRuntime({
            repository,
            runner,
            configParser: {
                async getProjects() {
                    return {
                        source: { status: 'loaded', mode: 'registry_scoped' },
                        projects: [{ id: 'brainbase', session_select: true }]
                    };
                }
            }
        });

        const result = await service.ingest(makePayload({
            runner: {
                type: 'agent_report',
                external_run_id: 'ceo-report-2026-07',
                agent_id: 'agent/ceo'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'agent_ceo',
                status: 'waiting_human',
                metadata: { report_kind: 'ceo_report', period: '2026-07' }
            },
            human_steps: [{
                id: 'hs-agent-report-ceo',
                step_type: 'approval',
                prompt: 'CEOレビューを承認する'
            }]
        }));

        expect(result.run).toMatchObject({ status: 'waiting_human', closure_state: 'open' });

        const resolved = await workflowService.automationRunService.resolveHumanStep(
            'hs-agent-report-ceo',
            { resolution: 'approved' },
            {
                person_id: 'keigo',
                projectCodes: ['brainbase'],
                role: 'member',
                authSource: 'test',
                organizationId: 'brainbase'
            }
        );

        expect(resolved.human_step).toMatchObject({ status: 'approved' });
        // Run must be closed, not left as an orphan needs_action.
        expect(resolved.resumed_run).toMatchObject({
            id: result.run.id,
            status: 'success',
            closure_state: 'closed',
            human_waiting: false,
            action_required: 'none'
        });

        const persisted = repository.getRun(result.run.id);
        expect(persisted.closure_state).toBe('closed');
        expect(persisted.status).toBe('success');

        // No orphan needs_action run should exist in the ledger.
        const orphans = repository.listRuns().filter(
            (run) => run.closure_state === 'needs_action' || run.status === 'needs_action'
        );
        expect(orphans).toHaveLength(0);
    });

    it('keeps an agent_report run open while other human steps remain pending', async () => {
        const { repository, service } = makeService();
        const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
        const workflowService = new TestAutomationRuntime({
            repository,
            runner,
            configParser: {
                async getProjects() {
                    return {
                        source: { status: 'loaded', mode: 'registry_scoped' },
                        projects: [{ id: 'brainbase', session_select: true }]
                    };
                }
            }
        });

        const result = await service.ingest(makePayload({
            runner: {
                type: 'agent_report',
                external_run_id: 'cso-report-2026-07',
                agent_id: 'agent/cso'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'agent_cso',
                status: 'waiting_human',
                metadata: { report_kind: 'cso_report', period: '2026-07' }
            },
            human_steps: [
                { id: 'hs-agent-report-cso-1', step_type: 'approval', prompt: '承認1' },
                { id: 'hs-agent-report-cso-2', step_type: 'approval', prompt: '承認2' }
            ]
        }));

        expect(result.run).toMatchObject({ status: 'waiting_human' });

        const first = await workflowService.automationRunService.resolveHumanStep(
            'hs-agent-report-cso-1',
            { resolution: 'approved' },
            {
                person_id: 'keigo',
                projectCodes: ['brainbase'],
                role: 'member',
                authSource: 'test',
                organizationId: 'brainbase'
            }
        );
        expect(first.resumed_run).toMatchObject({ status: 'waiting_human', closure_state: 'open' });

        const second = await workflowService.automationRunService.resolveHumanStep(
            'hs-agent-report-cso-2',
            { resolution: 'approved' },
            {
                person_id: 'keigo',
                projectCodes: ['brainbase'],
                role: 'member',
                authSource: 'test',
                organizationId: 'brainbase'
            }
        );
        expect(second.resumed_run).toMatchObject({ status: 'success', closure_state: 'closed' });

        const orphans = repository.listRuns().filter(
            (run) => run.closure_state === 'needs_action' || run.status === 'needs_action'
        );
        expect(orphans).toHaveLength(0);
    });

    it('cancels an agent_report run when the human step is rejected', async () => {
        const { repository, service } = makeService();
        const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
        const workflowService = new TestAutomationRuntime({
            repository,
            runner,
            configParser: {
                async getProjects() {
                    return {
                        source: { status: 'loaded', mode: 'registry_scoped' },
                        projects: [{ id: 'brainbase', session_select: true }]
                    };
                }
            }
        });

        const result = await service.ingest(makePayload({
            runner: {
                type: 'agent_report',
                external_run_id: 'retro-report-2026-W27',
                agent_id: 'agent/retro'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'agent_retro',
                status: 'waiting_human',
                metadata: { report_kind: 'retro_report', period: '2026-W27' }
            },
            human_steps: [{ id: 'hs-agent-report-retro', step_type: 'approval', prompt: 'レトロを承認する' }]
        }));

        const rejected = await workflowService.automationRunService.resolveHumanStep(
            'hs-agent-report-retro',
            { resolution: 'rejected' },
            {
                person_id: 'keigo',
                projectCodes: ['brainbase'],
                role: 'member',
                authSource: 'test',
                organizationId: 'brainbase'
            }
        );

        expect(rejected.resumed_run).toMatchObject({ status: 'cancelled', closure_state: 'closed' });
        const orphans = repository.listRuns().filter(
            (run) => run.closure_state === 'needs_action' || run.status === 'needs_action'
        );
        expect(orphans).toHaveLength(0);
    });

    it('uses description-only human steps as visible approval text', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-description-human',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-description-human'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'approval_required'
            },
            human_steps: [{
                id: 'hs-description-only',
                step_type: 'approval',
                description: '説明だけで来た承認依頼'
            }]
        }));

        expect(result.human_steps[0]).toMatchObject({
            id: 'hs-description-only',
            prompt: '説明だけで来た承認依頼',
            title: '説明だけで来た承認依頼',
            description: '説明だけで来た承認依頼'
        });
    });

    it('ignores whitespace prompt when title has actionable approval text', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-whitespace-human',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-whitespace-human'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'approval_required'
            },
            human_steps: [{
                id: 'hs-whitespace-title',
                step_type: 'approval',
                prompt: '   ',
                title: 'Approve publish'
            }]
        }));

        expect(result.human_steps[0]).toMatchObject({
            prompt: 'Approve publish',
            title: 'Approve publish',
            description: 'Approve publish'
        });
    });

    it('maps blocked and failed Cloudflare/computer statuses to actionable workflow states', async () => {
        const { service } = makeService();

        const blocked = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-blocked',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-blocked'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'blocked'
            }
        }));
        const failed = await service.ingest(makePayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-failed',
                agent_id: 'sales-agent',
                trace_ref: 'https://vercel.com/acme/computer/traces/cloudflare-run-failed'
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'failed'
            }
        }));

        expect(blocked.run).toMatchObject({
            status: 'needs_action',
            closure_state: 'needs_action',
            action_required: 'resolve_blocker'
        });
        expect(failed.run).toMatchObject({
            status: 'failed',
            closure_state: 'needs_action',
            action_required: 'check_error'
        });
    });

    it('stores learning candidates through the connected Candidate Store create contract', async () => {
        const repository = new InMemoryWorkflowRepository();
        const created = [];
        let activeLedgerTransactions = 0;
        const originalTransaction = repository.transaction.bind(repository);
        repository.transaction = (callback) => originalTransaction(async () => {
            activeLedgerTransactions += 1;
            try {
                return await callback();
            } finally {
                activeLedgerTransactions -= 1;
            }
        });
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            candidateRepository: {
                async create(input) {
                    expect(activeLedgerTransactions).toBe(0);
                    created.push(input);
                    return { id: input.id, ...input };
                }
            }
        });

        const result = await service.ingest(makePayload());
        const identity = expectedCandidateIdentity();

        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            id: identity.id,
            cognitive_type: 'insight',
            owner_person_id: 'keigo',
            actor_person_id: 'sales-agent',
            source_system: 'external_runner',
            source_event_ids: [identity.scopeEventId, 'lc-1'],
            visibility: 'owner',
            sensitivity: 'internal',
            body: '営業フォローでは期限と顧客温度感を同時に見る'
        });
        expect(created[0].permission_snapshot).toMatchObject({
            source: 'external_runner',
            workflow_run_id: result.run.id,
            org_id: 'brainbase'
        });
        expect(result.learning_candidates).toEqual([
            expect.objectContaining({ id: identity.id })
        ]);
        expect(result.audit_logs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.learning_candidate.stored',
                after: expect.objectContaining({
                    candidate_id: 'lc-1',
                    stored_candidate_id: identity.id,
                    persistence_status: 'stored',
                    cognitive_type: 'insight',
                    promotion_policy: 'manual_review',
                    redaction_status: 'not_required',
                    body: '営業フォローでは期限と顧客温度感を同時に見る',
                    evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/out-1']
                })
            })
        ]));
        expect(repository.listAuditLogs({ targetId: result.run.id })).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.learning_candidate.deferred' })
        ]));
        const replay = await service.ingest(makePayload());
        expect(replay).toMatchObject({ status: 'duplicate' });
        expect(replay.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-1',
                stored_candidate_id: identity.id,
                persistence_status: 'stored'
            })
        ]);
    });

    it('rejects repositories without a transaction boundary before writing any surface', async () => {
        const repository = new InMemoryWorkflowRepository();
        repository.transaction = undefined;
        const service = new ExternalRunnerIngestService({ workflowRepository: repository });
        const normalized = service.adapter.normalize(makePayload());

        await expect(service.ingest(makePayload())).rejects.toMatchObject({
            code: 'workflow_transaction_required'
        });
        expect(repository.getRun(normalized.run.id)).toBeNull();
        expect(repository.listAuditLogs({ targetId: normalized.run.id })).toEqual([]);
    });

    it('resumes a pending candidate after Candidate Store committed before ledger finalization', async () => {
        const repository = new InMemoryWorkflowRepository();
        const candidateRepository = new InMemoryCandidateRepository();
        const identity = expectedCandidateIdentity();
        let transactionCount = 0;
        let interruptSecondTransaction = true;
        const originalTransaction = repository.transaction.bind(repository);
        repository.transaction = async (callback) => {
            transactionCount += 1;
            if (interruptSecondTransaction && transactionCount === 2) {
                throw new Error('simulated finalize interruption');
            }
            return originalTransaction(callback);
        };
        const service = new ExternalRunnerIngestService({ workflowRepository: repository, candidateRepository });
        const runId = service.adapter.normalize(makePayload()).run.id;

        await expect(service.ingest(makePayload())).rejects.toThrow('simulated finalize interruption');
        expect(candidateRepository.findById(identity.id)).toMatchObject({ id: identity.id });
        expect(repository.listAuditLogs({ targetId: runId })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.learning_candidate.pending',
                after: expect.objectContaining({ stored_candidate_id: identity.id })
            })
        ]));

        interruptSecondTransaction = false;
        const resumed = await service.ingest(makePayload());

        expect(resumed).toMatchObject({ status: 'duplicate' });
        expect(resumed.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-1',
                stored_candidate_id: identity.id,
                persistence_status: 'stored'
            })
        ]);
        expect(repository.listAuditLogs({ targetId: resumed.run.id })).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.duplicate_replay_ignored' })
        ]));

        await service.ingest(makePayload());
        expect(repository.listAuditLogs({ targetId: resumed.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.duplicate_replay_ignored' })
        ]));
    });

    it('keeps a mismatched Candidate Store duplicate actionable instead of deferring it', async () => {
        const repository = new InMemoryWorkflowRepository();
        const identity = expectedCandidateIdentity();
        const expected = [];
        const candidateRepository = {
            async create(input) {
                expected.push(input);
                throw new DuplicateCandidateError(input.id);
            },
            async findById() {
                return { ...expected[0], body: 'different immutable body' };
            }
        };
        const service = new ExternalRunnerIngestService({ workflowRepository: repository, candidateRepository });
        const runId = service.adapter.normalize(makePayload()).run.id;

        await expect(service.ingest(makePayload())).rejects.toMatchObject({
            code: 'external_runner_candidate_conflict'
        });
        expect(repository.listAuditLogs({ targetId: runId })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.candidate_conflict',
                after: expect.objectContaining({
                    candidate_id: 'lc-1',
                    stored_candidate_id: identity.id,
                    persistence_status: 'pending',
                    action_required: 'resolve_candidate_conflict'
                })
            })
        ]));
        expect(repository.listAuditLogs({ targetId: runId })).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.learning_candidate.deferred' })
        ]));
    });

    it('defers learning candidates visibly when connected Candidate Store writes fail', async () => {
        const repository = new InMemoryWorkflowRepository();
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            candidateRepository: {
                async create() {
                    throw new Error('candidate store unavailable');
                }
            }
        });

        const first = await service.ingest(makePayload());
        const second = await service.ingest(makePayload());

        expect(first.status).toBe('created');
        expect(first.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-1',
                persistence_status: 'deferred',
                reason: 'candidate_store_write_failed',
                error: 'candidate store unavailable'
            })
        ]);
        expect(first.audit_logs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.learning_candidate.deferred',
                after: expect.objectContaining({
                    candidate_id: 'lc-1',
                    reason: 'candidate_store_write_failed',
                    error: 'candidate store unavailable',
                    cognitive_type: 'insight',
                    promotion_policy: 'manual_review',
                    redaction_status: 'not_required',
                    body: '営業フォローでは期限と顧客温度感を同時に見る',
                    evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/out-1']
                })
            })
        ]));
        expect(repository.listAuditLogs({ targetId: first.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.learning_candidate.deferred',
                after: expect.objectContaining({
                    candidate_id: 'lc-1',
                    persistence_status: 'deferred',
                    reason: 'candidate_store_write_failed'
                })
            })
        ]));
        expect(second).toMatchObject({
            status: 'duplicate',
            run: { id: first.run.id }
        });
        expect(second.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'lc-1',
                persistence_status: 'deferred',
                reason: 'candidate_store_write_failed'
            })
        ]);
    });

    it('ignores external runner lifecycle injection for Candidate Store promotion boundary', async () => {
        const repository = new InMemoryWorkflowRepository();
        const created = [];
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            candidateRepository: {
                async create(input) {
                    created.push(input);
                    return { id: input.id, ...input };
                }
            }
        });

        await service.ingest(makePayload({
            learning_candidates: [{
                candidate_id: 'lc-injected',
                cognitive_type: 'claim',
                body: '外部runnerは昇格状態を注入できない',
                promotion_policy: 'manual_review',
                promotion_status: 'promoted_to_graph',
                requires_approval: false,
                redaction_status: 'not_required',
                evidence_refs: ['cloudflare-computer://trace/cloudflare-run-001/output/injected']
            }]
        }));

        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            id: expectedCandidateIdentity({ sourceCandidateId: 'lc-injected' }).id,
            promotion_status: 'candidate',
            requires_approval: true,
            source_system: 'external_runner'
        });
    });
});
