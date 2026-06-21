export const MEETING_WORKFLOW_PACK_ID = 'mana-meeting-workflow-pack-v1';

export const MEETING_WORKFLOW_DEFINITIONS = [
    {
        id: 'pre-meeting-briefing',
        name: 'Pre-Meeting Briefing',
        label: 'MTG前準備',
        trigger_types: ['schedule', 'human'],
        primary_trigger_type: 'schedule',
        output_contract: 'agenda / context brief',
        human_gate: 'optional_before_share',
        write_back_target: 'workflow_output',
        risk_level: 'low',
        judgment_dag_id: 'meeting-pre-briefing-dag-v1'
    },
    {
        id: 'transcript-to-meeting-note',
        name: 'Transcript to Meeting Note',
        label: '議事録ドラフト生成',
        trigger_types: ['event', 'human'],
        primary_trigger_type: 'event',
        output_contract: 'meeting_note_draft',
        human_gate: 'required_before_publish',
        write_back_target: 'meeting_note_draft',
        risk_level: 'medium',
        judgment_dag_id: 'meeting-note-draft-dag-v1'
    },
    {
        id: 'meeting-note-to-tasks',
        name: 'Meeting Note to Tasks',
        label: 'タスク候補抽出',
        trigger_types: ['event', 'human'],
        primary_trigger_type: 'event',
        output_contract: 'task_candidates',
        human_gate: 'required_before_task_create',
        write_back_target: 'task_store',
        risk_level: 'medium',
        judgment_dag_id: 'meeting-task-extraction-dag-v1'
    },
    {
        id: 'meeting-note-to-decisions',
        name: 'Meeting Note to Decisions',
        label: 'Decision昇格候補',
        trigger_types: ['event', 'human'],
        primary_trigger_type: 'human',
        output_contract: 'decision_candidates',
        human_gate: 'required_before_graph_promotion',
        write_back_target: 'graph_ssot_decision',
        risk_level: 'high',
        judgment_dag_id: 'meeting-decision-extraction-dag-v1'
    },
    {
        id: 'post-meeting-follow-up-message',
        name: 'Post-Meeting Follow-up Message',
        label: 'MTG後挨拶文',
        trigger_types: ['event', 'human'],
        primary_trigger_type: 'human',
        output_contract: 'message_draft',
        human_gate: 'required_before_external_send',
        write_back_target: 'external_message_draft',
        risk_level: 'high',
        judgment_dag_id: 'meeting-follow-up-message-dag-v1'
    }
];

function stablePart(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function meetingPackIds({ orgId, projectId, definitionId = null, triggerType = null } = {}) {
    const scope = [orgId, projectId].map(stablePart).filter(Boolean).join('_');
    const definition = stablePart(definitionId);
    const trigger = stablePart(triggerType);
    return {
        roleAgentId: `rai_${scope}_meeting_ops`,
        templateId: definition ? `wft_${scope}_${definition}` : null,
        bindingId: definition ? `wfb_${scope}_meeting_ops_${definition}` : null,
        triggerId: definition && trigger ? `wftg_${scope}_${definition}_${trigger}` : null,
        loopIntentId: definition ? `loop_${scope}_${definition}_bootstrap` : null
    };
}

export function buildMeetingWorkflowPackRecords({
    orgId,
    projectId,
    actorId = 'system',
    seedLoopIntents = true
} = {}) {
    const ids = meetingPackIds({ orgId, projectId });
    const roleAgent = {
        id: ids.roleAgentId,
        workspace_id: 'default',
        org_id: orgId,
        project_id: projectId,
        role_archetype_id: 'meeting-ops',
        name: 'Meeting Ops Agent',
        description: 'Mana meeting workflow selector for pre-meeting, note, task, decision, and follow-up operations.',
        owner_id: actorId,
        default_approver_id: actorId,
        context_policy: {
            graph_refs: [`org:${orgId}`, `project:${projectId}`],
            meeting_scope: 'project_meetings',
            required_sources: ['calendar', 'transcript_or_note', 'graph_ssot']
        },
        tool_scope: {
            allow: ['calendar.read', 'transcript.read', 'slack.read', 'slack.draft', 'graph.read'],
            deny: ['gmail.send', 'slack.send', 'graph.write_without_approval']
        },
        workflow_constraints: {
            max_autonomy_level: 'approval_required',
            external_send_requires_approval: true,
            graph_promotion_requires_approval: true,
            duplicate_output_requires_retry_evidence: true
        },
        tags: ['meeting-workflow-pack', MEETING_WORKFLOW_PACK_ID],
        enabled: true
    };

    const templates = [];
    const bindings = [];
    const triggers = [];
    const loopIntents = [];

    for (const definition of MEETING_WORKFLOW_DEFINITIONS) {
        const scopedIds = meetingPackIds({ orgId, projectId, definitionId: definition.id });
        templates.push({
            id: scopedIds.templateId,
            workspace_id: 'default',
            org_id: orgId,
            project_id: projectId,
            name: definition.name,
            description: definition.label,
            workflow_kind: 'meeting',
            judgment_dag_id: definition.judgment_dag_id,
            spec_ref: `docs/specs/story-mana-meeting-workflow-pack-data-v1-spec.md#${definition.id}`,
            input_contract: {
                meeting_identity: 'required',
                project_or_org_scope: 'required',
                trigger_type: definition.trigger_types
            },
            context_policy: {
                required_sources: ['meeting_source', 'graph_ssot'],
                optional_sources: ['calendar', 'slack_thread', 'previous_meeting_notes']
            },
            output_schema: {
                type: definition.output_contract,
                write_back_target: definition.write_back_target,
                graph_ssot_until_approved: false
            },
            human_gate: definition.human_gate,
            trigger_types: definition.trigger_types,
            write_back_target: definition.write_back_target,
            risk_level: definition.risk_level,
            tags: ['meeting-workflow-definition', MEETING_WORKFLOW_PACK_ID, definition.id],
            enabled: true
        });

        bindings.push({
            id: scopedIds.bindingId,
            workspace_id: 'default',
            org_id: orgId,
            project_id: projectId,
            role_agent_instance_id: ids.roleAgentId,
            workflow_template_id: scopedIds.templateId,
            name: `Meeting Ops Agent -> ${definition.name}`,
            workflow_selection_reason: `${definition.label}をmeeting_identityとtrigger_typeから選択する`,
            judgment_dag_id: definition.judgment_dag_id,
            autonomy_level: 'approval_required',
            stop_conditions: ['missing_meeting_identity', 'missing_project_mapping', 'privacy_scope_leak'],
            approval_owner_id: actorId,
            cost_owner_id: actorId,
            enabled: true
        });

        for (const triggerType of definition.trigger_types) {
            const triggerIds = meetingPackIds({ orgId, projectId, definitionId: definition.id, triggerType });
            triggers.push({
                id: triggerIds.triggerId,
                workspace_id: 'default',
                org_id: orgId,
                project_id: projectId,
                workflow_binding_id: scopedIds.bindingId,
                trigger_type: triggerType,
                name: `${definition.name} ${triggerType}`,
                event_source: triggerType === 'event' ? 'mana.meeting' : null,
                schedule: triggerType === 'schedule' ? { offset: 'before_meeting', minutes: 30 } : null,
                human_prompt_ref: triggerType === 'human' ? `mana:${definition.id}` : null,
                enabled: true
            });
        }

        if (seedLoopIntents) {
            const primaryTriggerIds = meetingPackIds({
                orgId,
                projectId,
                definitionId: definition.id,
                triggerType: definition.primary_trigger_type
            });
            loopIntents.push({
                id: scopedIds.loopIntentId,
                workspace_id: 'default',
                org_id: orgId,
                project_id: projectId,
                role_agent_instance_id: ids.roleAgentId,
                workflow_template_id: scopedIds.templateId,
                workflow_binding_id: scopedIds.bindingId,
                workflow_trigger_id: primaryTriggerIds.triggerId,
                trigger_id: primaryTriggerIds.triggerId,
                trigger_type: definition.primary_trigger_type,
                requested_by: actorId,
                input_ref: `meeting-pack:${definition.id}`,
                input_summary: `${definition.label}の初期Loop Intent候補`,
                input_payload: {
                    meeting_identity: null,
                    workflow_definition_id: definition.id,
                    requested_output: definition.output_contract,
                    write_back_target: definition.write_back_target,
                    source: 'meeting_pack_bootstrap'
                },
                eligibility: {
                    status: 'needs_approval',
                    autonomy_level: 'approval_required',
                    requires_human_approval: true,
                    reasons: ['meeting_pack_bootstrap_requires_real_meeting_identity']
                },
                selected_workflow_reason: `${definition.label}をMeeting Ops Agentが選択する初期候補`,
                judgment_dag_id: definition.judgment_dag_id,
                status: 'ready',
                enabled: true
            });
        }
    }

    return {
        pack_id: MEETING_WORKFLOW_PACK_ID,
        role_agent_instance: roleAgent,
        workflow_templates: templates,
        workflow_bindings: bindings,
        workflow_triggers: triggers,
        loop_intents: loopIntents
    };
}
