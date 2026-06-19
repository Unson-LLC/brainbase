import { describe, expect, it } from 'vitest';

import { ExternalRunnerContractError } from '../../../server/services/external-runner/contract-schema.js';
import { ExternalRunnerIngestService } from '../../../server/services/external-runner/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

function makePayload(overrides = {}) {
    return {
        contract_version: 'external_runner.v0',
        runner: {
            type: 'eve',
            external_run_id: 'eve-run-001',
            agent_id: 'sales-agent',
            eve: {
                trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-001'
            }
        },
        run: {
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
            evidence_refs: ['eve://trace/eve-run-001/round-1']
        }],
        outputs: [{
            id: 'out-1',
            output_type: 'draft',
            title: 'Slack返信案',
            body: '次回提案の返信案',
            visibility: 'internal',
            approval_required: true,
            evidence_refs: ['eve://trace/eve-run-001/output/out-1']
        }],
        learning_candidates: [{
            candidate_id: 'lc-1',
            cognitive_type: 'insight',
            body: '営業フォローでは期限と顧客温度感を同時に見る',
            promotion_policy: 'manual_review',
            redaction_status: 'not_required',
            evidence_refs: ['eve://trace/eve-run-001/output/out-1']
        }],
        ...overrides
    };
}

function makeService() {
    const repository = new InMemoryWorkflowRepository();
    const service = new ExternalRunnerIngestService({ workflowRepository: repository });
    return { repository, service };
}

describe('ExternalRunnerIngestService', () => {
    function expectRunIdForExternalRun(runId, externalRunId) {
        const readable = String(externalRunId || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
        expect(runId).toMatch(new RegExp(`^run_brainbase_eve_${readable}_[a-f0-9]{12}$`));
    }

    it('ingests S-001 runner.type=eve envelope into Workflow Mission Control surfaces', async () => {
        const { repository, service } = makeService();

        const result = await service.ingest(makePayload());

        expect(result.status).toBe('created');
        expect(result.workflow).toMatchObject({
            id: 'wf_sales_followup',
            execution_env: 'external',
            implementation_key: 'external-runner:eve'
        });
        expect(result.run).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            action_required: 'none'
        });
        expectRunIdForExternalRun(result.run.id, 'eve-run-001');
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

    it('rejects S-003 Eve payloads without trace_ref before creating a completed run', async () => {
        const { repository, service } = makeService();
        const payload = makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-run-002',
                agent_id: 'sales-agent',
                eve: {}
            }
        });

        await expect(service.ingest(payload)).rejects.toMatchObject({
            code: 'missing_string'
        });
        expect(repository.listRuns()).toHaveLength(0);
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
                        type: 'eve',
                        external_run_id: '',
                        agent_id: 'sales-agent',
                        eve: { trace_ref: 'https://vercel.com/acme/eve/traces/missing-run-id' }
                    }
                },
                code: 'missing_string'
            },
            {
                name: 'missing runner agent id',
                patch: {
                    runner: {
                        type: 'eve',
                        external_run_id: 'eve-run-missing-agent',
                        agent_id: '',
                        eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-missing-agent' }
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
                patch: { rounds: [{ round_id: '', status: 'completed', evidence_refs: ['eve://trace/round'] }] },
                code: 'missing_string'
            },
            {
                name: 'missing round status',
                patch: { rounds: [{ round_id: 'round-missing-status', status: '', evidence_refs: ['eve://trace/round'] }] },
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

    it('treats repeated Eve run ids as idempotent duplicates', async () => {
        const { service } = makeService();

        const first = await service.ingest(makePayload());
        const second = await service.ingest(makePayload());

        expect(first.status).toBe('created');
        expect(second).toMatchObject({
            status: 'duplicate',
            run: { id: first.run.id }
        });
        expect(second.outputs).toHaveLength(1);
    });

    it('does not collapse distinct Eve run ids that normalize to the same readable prefix', async () => {
        const { repository, service } = makeService();

        const slash = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve/run-collision',
                agent_id: 'sales-agent',
                eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-collision-slash' }
            }
        }));
        const underscore = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve_run-collision',
                agent_id: 'sales-agent',
                eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-collision-underscore' }
            },
            outputs: [{
                id: 'out-2',
                output_type: 'draft',
                title: '別runの返信案',
                body: '正規化衝突しない返信案',
                visibility: 'internal',
                evidence_refs: ['eve://trace/eve-run-collision-underscore/output/out-2']
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

        expectRunIdForExternalRun(first.run.id, 'eve-run-001');
        expect(second).toMatchObject({
            status: 'duplicate',
            run: { id: first.run.id }
        });
        expect(repository.listRuns()).toHaveLength(1);
    });

    it('does not replay a duplicate across project boundaries for the same Eve external run id', async () => {
        const { repository, service } = makeService();

        const first = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-cross-project',
                agent_id: 'sales-agent',
                eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-cross-project-brainbase' }
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
                type: 'eve',
                external_run_id: 'eve-cross-project',
                agent_id: 'sales-agent',
                eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-cross-project-salestailor' }
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
                type: 'eve',
                external_run_id: 'eve-fallback-workflow',
                agent_id: 'sales-agent',
                eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-fallback-workflow-brainbase' }
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
                type: 'eve',
                external_run_id: 'eve-fallback-workflow',
                agent_id: 'sales-agent',
                eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-fallback-workflow-salestailor' }
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
        expect(first.workflow.id).toBe('external_runner_brainbase_sales-agent');
        expect(second.workflow.id).toBe('external_runner_salestailor_sales-agent');
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

    it('maps cancelled Eve runs to closed cancelled workflow state', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-run-cancelled',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-cancelled'
                }
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

    it('maps waiting_human Eve runs to approval-required workflow state', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-run-waiting-human',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-waiting-human'
                }
            },
            run: {
                project_id: 'brainbase',
                role_agent_id: 'sales',
                workflow_id: 'wf_sales_followup',
                workflow_name: '営業フォローアップ',
                status: 'waiting_human',
                selected_workflow_reason: 'Eve側で人間承認待ち'
            },
            human_steps: [{
                id: 'hs-waiting-human',
                step_type: 'approval',
                prompt: 'Eve側の承認をBrainbaseで確認する'
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
            prompt: 'Eve側の承認をBrainbaseで確認する',
            title: 'Eve側の承認をBrainbaseで確認する',
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
        runner.registerHandler('external-runner:eve', async (ctx) => ({
            status: 'success',
            closureState: 'closed',
            actionRequired: 'none',
            message: `External runner approval ${ctx.humanStepResolution?.resolution || 'recorded'}`,
            outputCount: 1,
            data: { humanStepResolution: ctx.humanStepResolution }
        }));
        const workflowService = new WorkflowService({
            repository,
            runner,
            configParser: {
                async getProjects() {
                    return {
                        projects: [{ id: 'brainbase', session_select: true }]
                    };
                }
            }
        });

        const result = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-run-resolvable-human',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-resolvable-human'
                }
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
                prompt: 'Eve側の外部送信を承認する'
            }]
        }));

        expect(result.human_steps[0]).toMatchObject({
            id: 'hs-external-resolvable',
            requested_to: 'keigo',
            required_by: 'keigo'
        });

        const resolved = await workflowService.resolveHumanStep(
            'hs-external-resolvable',
            { resolution: 'approved' },
            {
                person_id: 'keigo',
                projectCodes: ['brainbase'],
                role: 'member',
                authSource: 'test'
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

    it('uses description-only human steps as visible approval text', async () => {
        const { service } = makeService();

        const result = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-run-description-human',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-description-human'
                }
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
                type: 'eve',
                external_run_id: 'eve-run-whitespace-human',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-whitespace-human'
                }
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

    it('maps blocked and failed Eve statuses to actionable workflow states', async () => {
        const { service } = makeService();

        const blocked = await service.ingest(makePayload({
            runner: {
                type: 'eve',
                external_run_id: 'eve-run-blocked',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-blocked'
                }
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
                type: 'eve',
                external_run_id: 'eve-run-failed',
                agent_id: 'sales-agent',
                eve: {
                    trace_ref: 'https://vercel.com/acme/eve/traces/eve-run-failed'
                }
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
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            candidateRepository: {
                async create(input) {
                    created.push(input);
                    return { id: input.id, ...input };
                }
            }
        });

        const result = await service.ingest(makePayload());

        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            id: 'lc-1',
            cognitive_type: 'insight',
            owner_person_id: 'keigo',
            actor_person_id: 'sales-agent',
            source_system: 'external_runner',
            source_event_ids: ['eve-run-001', 'lc-1'],
            visibility: 'owner',
            sensitivity: 'internal',
            body: '営業フォローでは期限と顧客温度感を同時に見る'
        });
        expect(result.learning_candidates).toEqual([
            expect.objectContaining({ id: 'lc-1' })
        ]);
        expect(result.audit_logs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'external_runner.learning_candidate.stored',
                after: expect.objectContaining({
                    candidate_id: 'lc-1',
                    stored_candidate_id: 'lc-1',
                    persistence_status: 'stored',
                    cognitive_type: 'insight',
                    promotion_policy: 'manual_review',
                    redaction_status: 'not_required',
                    body: '営業フォローでは期限と顧客温度感を同時に見る',
                    evidence_refs: ['eve://trace/eve-run-001/output/out-1']
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
                stored_candidate_id: 'lc-1',
                persistence_status: 'stored'
            })
        ]);
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
                    evidence_refs: ['eve://trace/eve-run-001/output/out-1']
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
                evidence_refs: ['eve://trace/eve-run-001/output/injected']
            }]
        }));

        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            id: 'lc-injected',
            promotion_status: 'candidate',
            requires_approval: true,
            source_system: 'external_runner'
        });
    });
});
