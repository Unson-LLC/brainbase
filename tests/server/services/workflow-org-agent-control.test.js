import { describe, expect, it } from 'vitest';

import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

function makeService() {
    const repository = new InMemoryWorkflowRepository();
    const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                projects: [
                    { id: 'unson', session_select: true, aliases: ['unson-os'] },
                    { id: 'salestailor', session_select: true, aliases: ['sales-tailor'] }
                ]
            };
        }
    };
    const service = new WorkflowService({ repository, runner, configParser });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['unson', 'salestailor']
    };
    return { repository, service, actor };
}

async function createAgentStack(service, actor, {
    orgId,
    projectId,
    roleAgentInstanceId,
    templateId,
    bindingId,
    triggerId,
    autonomyLevel = 'approval_required',
    triggerType = 'human',
    bindingEnabled = true,
    triggerEnabled = true
}) {
    await service.createRoleAgentInstance({
        id: roleAgentInstanceId,
        org_id: orgId,
        project_id: projectId,
        role_archetype_id: 'sales',
        name: `${orgId} sales agent`,
        context_policy: { graph_refs: [`org:${orgId}`], customer_scope: `${orgId}:active_accounts` },
        tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
        workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
    }, actor);
    await service.createWorkflowTemplate({
        id: templateId,
        name: `${orgId} sales followup`,
        workflow_kind: 'sales',
        judgment_dag_id: 'sales-followup-v1'
    }, actor);
    await service.createWorkflowBinding({
        id: bindingId,
        org_id: orgId,
        project_id: projectId,
        role_agent_instance_id: roleAgentInstanceId,
        workflow_template_id: templateId,
        autonomy_level: autonomyLevel,
        workflow_selection_reason: `${orgId}の営業接触期限を判断する`,
        enabled: bindingEnabled
    }, actor);
    await service.createWorkflowTrigger({
        id: triggerId,
        org_id: orgId,
        project_id: projectId,
        workflow_binding_id: bindingId,
        trigger_type: triggerType,
        enabled: triggerEnabled
    }, actor);
}

describe('WorkflowService org agent loop control', () => {
    it('keeps Unson and SalesTailor role agent instances separate for the same archetype', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-sales',
            triggerId: 'trg-unson-human-sales'
        });
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-event-sales',
            triggerType: 'event'
        });

        expect(repository.listRoleAgentInstances({ roleArchetypeId: 'sales' })).toEqual([
            expect.objectContaining({
                id: 'rai-unson-sales',
                org_id: 'unson',
                context_policy: { graph_refs: ['org:unson'], customer_scope: 'unson:active_accounts' },
                tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
                workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
            }),
            expect.objectContaining({
                id: 'rai-salestailor-sales',
                org_id: 'salestailor',
                context_policy: { graph_refs: ['org:salestailor'], customer_scope: 'salestailor:active_accounts' },
                tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
                workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
            })
        ]);
        expect(repository.listWorkflowBindings({ orgId: 'salestailor' })).toEqual([
            expect.objectContaining({
                id: 'bind-salestailor-sales',
                workflow_selection_reason: 'salestailorの営業接触期限を判断する'
            })
        ]);
        expect(repository.listWorkflowTriggers({ orgId: 'salestailor' })).toEqual([
            expect.objectContaining({ id: 'trg-salestailor-event-sales', trigger_type: 'event' })
        ]);
    });

    it('creates approval-required loop intents from trigger, binding, and org context', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-schedule-sales',
            triggerType: 'schedule'
        });

        const result = await service.createLoopIntent({
            id: 'loop-salestailor-scheduled-sales',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-schedule-sales',
            input_summary: '毎朝の営業フォロー候補抽出',
            input_payload: {
                source: 'schedule',
                candidate_filters: {
                    stale_days: 7,
                    stages: ['proposal', 'follow_up']
                }
            }
        }, actor);

        expect(result.loop_intent).toMatchObject({
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-salestailor-sales',
            workflow_template_id: 'tmpl-sales-followup',
            input_summary: '毎朝の営業フォロー候補抽出',
            input_payload: {
                source: 'schedule',
                candidate_filters: {
                    stale_days: 7,
                    stages: ['proposal', 'follow_up']
                }
            },
            selected_workflow_reason: 'salestailorの営業接触期限を判断する',
            trigger_type: 'schedule',
            eligibility: {
                status: 'needs_approval',
                autonomy_level: 'approval_required',
                requires_human_approval: true,
                reasons: ['autonomy_level_approval_required']
            }
        });
    });

    it('blocks loop intents for disabled triggers', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-sales',
            triggerId: 'trg-unson-disabled-sales',
            triggerEnabled: false
        });

        const result = await service.createLoopIntent({
            id: 'loop-unson-disabled',
            org_id: 'unson',
            project_id: 'unson',
            workflow_binding_id: 'bind-unson-sales',
            trigger_id: 'trg-unson-disabled-sales'
        }, actor);

        expect(result.loop_intent).toMatchObject({
            status: 'blocked',
            eligibility: {
                status: 'blocked',
                reasons: ['workflow_trigger_disabled']
            }
        });
    });

    it('records human-only loop intents without marking them ready for Eve execution', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-human-only-sales',
            triggerId: 'trg-unson-human-only-sales',
            autonomyLevel: 'human_only'
        });

        const result = await service.createLoopIntent({
            id: 'loop-unson-human-only',
            org_id: 'unson',
            project_id: 'unson',
            workflow_binding_id: 'bind-unson-human-only-sales',
            trigger_id: 'trg-unson-human-only-sales',
            input_summary: '人間だけで判断する営業相談'
        }, actor);

        expect(result.loop_intent).toMatchObject({
            id: 'loop-unson-human-only',
            status: 'human_only',
            input_summary: '人間だけで判断する営業相談',
            eligibility: {
                status: 'human_only',
                autonomy_level: 'human_only',
                requires_human_approval: true,
                reasons: ['autonomy_level_human_only']
            }
        });
        expect(repository.getLoopIntent('loop-unson-human-only')).toMatchObject({
            status: 'human_only',
            eligibility: expect.objectContaining({ status: 'human_only' })
        });
    });

    it('blocks loop intents for disabled bindings', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'unson',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-unson-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-unson-disabled-sales',
            triggerId: 'trg-unson-sales',
            bindingEnabled: false
        });

        const result = await service.createLoopIntent({
            id: 'loop-unson-disabled-binding',
            org_id: 'unson',
            project_id: 'unson',
            workflow_binding_id: 'bind-unson-disabled-sales',
            trigger_id: 'trg-unson-sales'
        }, actor);

        expect(result.loop_intent).toMatchObject({
            status: 'blocked',
            eligibility: {
                status: 'blocked',
                reasons: ['workflow_binding_disabled']
            }
        });
    });

    it('rejects loop intents with invalid direct trigger types before persistence', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });

        await expect(service.createLoopIntent({
            id: 'loop-invalid-webhook',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_type: 'webhook'
        }, actor)).rejects.toMatchObject({
            message: 'trigger_type must be one of human, event, schedule'
        });
        expect(repository.listLoopIntents({ orgId: 'salestailor' })).toEqual([]);
    });

    it('rejects non-json loop intent input payloads before persistence', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });

        await expect(service.createLoopIntent({
            id: 'loop-invalid-input-payload',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            input_payload: 'customer=salestailor'
        }, actor)).rejects.toMatchObject({
            message: 'input_payload must be a JSON object or array'
        });
        expect(repository.getLoopIntent('loop-invalid-input-payload')).toBeNull();
    });

    it('preserves null and array loop intent input payloads', async () => {
        const { repository, service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-sales-followup',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });

        const nullResult = await service.createLoopIntent({
            id: 'loop-null-input-payload',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            input_payload: null
        }, actor);
        const arrayResult = await service.createLoopIntent({
            id: 'loop-array-input-payload',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            input_payload: [
                { customer_id: 'cus_salestailor_001' },
                { customer_id: 'cus_salestailor_002' }
            ]
        }, actor);

        expect(nullResult.loop_intent).toMatchObject({ input_payload: null });
        expect(arrayResult.loop_intent.input_payload).toEqual([
            { customer_id: 'cus_salestailor_001' },
            { customer_id: 'cus_salestailor_002' }
        ]);
        expect(repository.getLoopIntent('loop-null-input-payload')).toMatchObject({ input_payload: null });
        expect(repository.getLoopIntent('loop-array-input-payload')).toMatchObject({
            input_payload: [
                { customer_id: 'cus_salestailor_001' },
                { customer_id: 'cus_salestailor_002' }
            ]
        });
    });

    it('rejects bindings when the agent belongs to a different org', async () => {
        const { service, actor } = makeService();
        await service.createRoleAgentInstance({
            id: 'rai-unson-sales',
            org_id: 'unson',
            project_id: 'unson',
            role_archetype_id: 'sales',
            name: 'Unson sales agent'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-sales-followup',
            name: 'Sales followup',
            workflow_kind: 'sales'
        }, actor);

        await expect(service.createWorkflowBinding({
            id: 'bind-cross-org',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-unson-sales',
            workflow_template_id: 'tmpl-sales-followup',
            autonomy_level: 'approval_required'
        }, actor)).rejects.toMatchObject({
            message: "role_agent_instance 'rai-unson-sales' belongs to org 'unson'"
        });
    });

    it('rejects unknown org references before WMC becomes an org source of truth', async () => {
        const { repository, service, actor } = makeService();

        await expect(service.createRoleAgentInstance({
            id: 'rai-unknown-sales',
            org_id: 'unknown-org',
            project_id: 'salestailor',
            role_archetype_id: 'sales',
            name: 'Unknown org sales agent'
        }, actor)).rejects.toMatchObject({
            message: "org 'unknown-org' is not a known Graph org reference"
        });

        await expect(service.createWorkflowTemplate({
            id: 'tmpl-unknown-org',
            org_id: 'unknown-org',
            project_id: 'salestailor',
            name: 'Unknown org template',
            workflow_kind: 'sales'
        }, actor)).rejects.toMatchObject({
            message: "org 'unknown-org' is not a known Graph org reference"
        });

        expect(repository.listRoleAgentInstances({ orgId: 'unknown-org' })).toEqual([]);
        expect(repository.listWorkflowTemplates({ orgId: 'unknown-org' })).toEqual([]);
    });

    it('rejects bindings when the agent belongs to a different project in the same org', async () => {
        const { service, actor } = makeService();
        await service.createRoleAgentInstance({
            id: 'rai-sales-unson-project',
            org_id: 'salestailor',
            project_id: 'unson',
            role_archetype_id: 'sales',
            name: 'SalesTailor agent in Unson project'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-salestailor-sales',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'SalesTailor sales followup',
            workflow_kind: 'sales'
        }, actor);

        await expect(service.createWorkflowBinding({
            id: 'bind-cross-project',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-sales-unson-project',
            workflow_template_id: 'tmpl-salestailor-sales',
            autonomy_level: 'approval_required'
        }, actor)).rejects.toMatchObject({
            message: "role_agent_instance 'rai-sales-unson-project' belongs to project 'unson'"
        });
    });

    it('rejects triggers and loop intents when parent project or binding lineage does not match', async () => {
        const { service, actor } = makeService();
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'salestailor',
            roleAgentInstanceId: 'rai-salestailor-sales',
            templateId: 'tmpl-salestailor-sales',
            bindingId: 'bind-salestailor-sales',
            triggerId: 'trg-salestailor-human-sales'
        });
        await createAgentStack(service, actor, {
            orgId: 'salestailor',
            projectId: 'unson',
            roleAgentInstanceId: 'rai-salestailor-unson-project',
            templateId: 'tmpl-salestailor-unson-project',
            bindingId: 'bind-salestailor-unson-project',
            triggerId: 'trg-salestailor-unson-project'
        });

        await expect(service.createWorkflowTrigger({
            id: 'trg-cross-project',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-unson-project',
            trigger_type: 'human'
        }, actor)).rejects.toMatchObject({
            message: "workflow_binding 'bind-salestailor-unson-project' belongs to project 'unson'"
        });

        await expect(service.createLoopIntent({
            id: 'loop-cross-binding-trigger',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-unson-project'
        }, actor)).rejects.toMatchObject({
            message: "workflow_trigger 'trg-salestailor-unson-project' belongs to project 'unson'"
        });
    });

    it('enforces project access on workflow templates before binding selection', async () => {
        const { repository, service, actor } = makeService();
        const noAccessActor = {
            ...actor,
            role: 'member',
            projectCodes: []
        };

        await expect(service.createWorkflowTemplate({
            id: 'tmpl-denied-unson-sales',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Denied Unson Sales',
            workflow_kind: 'sales'
        }, noAccessActor)).rejects.toMatchObject({
            message: "project 'unson' is not accessible"
        });

        await expect(service.createWorkflowTemplate({
            id: 'tmpl-denied-global',
            name: 'Denied Global',
            workflow_kind: 'sales'
        }, noAccessActor)).rejects.toMatchObject({
            message: 'project_id is required for workflow_template creation'
        });

        repository.upsertWorkflowTemplate({
            id: 'tmpl-hidden-unson-sales',
            workspace_id: 'default',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Hidden Unson Sales',
            workflow_kind: 'sales'
        });

        const listResult = await service.listWorkflowTemplates({ orgId: 'unson' }, noAccessActor);
        expect(listResult.workflow_templates).toEqual([]);
    });

    it('includes global workflow templates in project-scoped selection lists', async () => {
        const { service, actor } = makeService();
        await service.createWorkflowTemplate({
            id: 'tmpl-global-sales',
            name: 'Global sales followup',
            workflow_kind: 'sales'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-salestailor-sales',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'SalesTailor sales followup',
            workflow_kind: 'sales'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'tmpl-unson-sales',
            org_id: 'unson',
            project_id: 'unson',
            name: 'Unson sales followup',
            workflow_kind: 'sales'
        }, actor);

        const result = await service.listWorkflowTemplates({
            orgId: 'salestailor',
            projectId: 'salestailor',
            workflowKind: 'sales'
        }, actor);

        expect(result.workflow_templates.map((template) => template.id)).toEqual([
            'tmpl-global-sales',
            'tmpl-salestailor-sales'
        ]);
    });
});
