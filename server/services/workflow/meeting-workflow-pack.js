import {
    LOOP_PACK_MANIFEST_VERSION,
    reviewLoopPackDesign
} from './loop-pack-design-gate.js';

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

function outputSideEffectType(writeBackTarget) {
    if (writeBackTarget === 'external_message_draft') return 'external_send';
    if (writeBackTarget === 'graph_ssot_decision') return 'graph_promotion';
    if (writeBackTarget === 'task_store') return 'task_create';
    if (writeBackTarget === 'meeting_note_draft') return 'publish_meeting_note';
    return 'workflow_output';
}

function humanGateProtects(humanGate) {
    if (humanGate === 'required_before_external_send') return ['external_send'];
    if (humanGate === 'required_before_graph_promotion') return ['graph_promotion', 'decision_promotion'];
    if (humanGate === 'required_before_task_create') return ['task_create'];
    if (humanGate === 'required_before_publish') return ['meeting_note_publish'];
    return ['share_or_reuse'];
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

export function buildMeetingWorkflowPackManifest({
    orgId,
    projectId,
    actorId = 'system',
    roleAgent,
    workflowTemplates = [],
    workflowBindings = [],
    workflowTriggers = []
} = {}) {
    const humanGateIds = Array.from(new Set(MEETING_WORKFLOW_DEFINITIONS.map((definition) => definition.human_gate)));
    return {
        manifest_version: LOOP_PACK_MANIFEST_VERSION,
        pack_id: MEETING_WORKFLOW_PACK_ID,
        title: 'Mana Meeting Workflow Pack',
        org_id: orgId,
        project_id: projectId,
        owner_id: actorId,
        target_business_process: '会議前後業務',
        purpose: '会議で発生した判断・タスク・文脈を会社の実行資産に変換する',
        required_trigger_classes: ['schedule', 'event', 'human'],
        inputs: [
            { id: 'calendar_event', required_for: ['pre-meeting-briefing'] },
            { id: 'meeting_identity', required_for: ['all'] },
            {
                id: 'mcp_meeting_source',
                provider_policy: {
                    online: 'tactiq',
                    offline: 'plaud',
                    online_tactiq_unavailable: 'plaud',
                    slack: 'pointer_or_fallback_only'
                },
                required_for: ['transcript-to-meeting-note', 'meeting-note-to-tasks', 'meeting-note-to-decisions']
            },
            { id: 'graph_ssot_context', required_for: ['all'] },
            { id: 'slack_or_channel_context', role: 'follow_up_or_fallback_pointer', required_for: ['post-meeting-follow-up-message'] }
        ],
        role_agent: {
            id: roleAgent.id,
            role_archetype_id: roleAgent.role_archetype_id,
            name: roleAgent.name,
            owner_id: roleAgent.owner_id,
            context_policy: roleAgent.context_policy,
            tool_scope: roleAgent.tool_scope,
            workflow_constraints: roleAgent.workflow_constraints
        },
        workflow_templates: workflowTemplates.map((template) => ({
            id: template.id,
            workflow_kind: template.workflow_kind,
            judgment_dag_id: template.judgment_dag_id,
            input_contract: template.input_contract,
            output_contract: template.output_schema?.type || null,
            human_gate: template.human_gate,
            write_back_target: template.write_back_target,
            risk_level: template.risk_level
        })),
        bindings: workflowBindings.map((binding) => ({
            id: binding.id,
            workflow_template_id: binding.workflow_template_id,
            role_agent_instance_id: binding.role_agent_instance_id,
            autonomy_level: binding.autonomy_level,
            stop_conditions: binding.stop_conditions,
            approval_owner_id: binding.approval_owner_id,
            workflow_selection_reason: binding.workflow_selection_reason
        })),
        triggers: workflowTriggers.map((trigger) => ({
            id: trigger.id,
            workflow_binding_id: trigger.workflow_binding_id,
            trigger_type: trigger.trigger_type,
            event_source: trigger.event_source,
            schedule: trigger.schedule,
            human_prompt_ref: trigger.human_prompt_ref
        })),
        human_gates: humanGateIds.map((humanGate) => ({
            id: humanGate,
            required: humanGate.startsWith('required_'),
            protects: humanGateProtects(humanGate)
        })),
        outputs: MEETING_WORKFLOW_DEFINITIONS.map((definition) => ({
            id: `${definition.id}.output`,
            workflow_definition_id: definition.id,
            output_contract: definition.output_contract,
            write_back_target: definition.write_back_target,
            side_effect_type: outputSideEffectType(definition.write_back_target),
            requires_human_gate: definition.human_gate.startsWith('required_')
                || ['external_message_draft', 'graph_ssot_decision', 'task_store'].includes(definition.write_back_target),
            human_gate_ref: definition.human_gate
        })),
        audit_evidence: [
            'meeting_source_ref',
            'context_snapshot_ref',
            'runner_trace_ref',
            'human_approval_or_reject',
            'write_back_result',
            'retry_reason'
        ],
        promotion_candidates: ['task_candidate', 'decision_candidate', 'graph_relationship_candidate', 'learning_candidate'],
        learning_candidates: ['workflow_selection_reason', 'human_reject_reason', 'rubric_gap', 'stop_condition_hit', 'follow_up_tone_feedback'],
        success_metrics: [
            '会議前準備が会議開始前に利用可能になる',
            '議事録からTask候補とDecision候補が根拠付きで作成される',
            '外部送信、Task作成、Graph昇格はHuman Gateを通過している',
            '次回会議準備が前回のDecision、Task、学習候補を参照できる'
        ],
        completion_rubric: [
            {
                id: 'loop_closure',
                pass_condition: '会議予定から準備、議事録、Task、Decision、Follow-up、Graph昇格候補、学習候補、次回会議準備への反映まで追跡できる'
            },
            {
                id: 'human_gate_integrity',
                pass_condition: '外部送信、Task作成、Decision/Graph昇格は承認なしに実行されない'
            },
            {
                id: 'evidence_integrity',
                pass_condition: '各outputはmeeting source、context snapshot、runner trace、人間判断をaudit evidenceとして保持する'
            }
        ],
        stop_conditions: [
            'missing_meeting_identity',
            'missing_project_mapping',
            'privacy_scope_leak',
            'external_send_without_approval',
            'graph_promotion_without_approval',
            'token_budget_exceeded',
            'stalled_iterations'
        ],
        budget: {
            max_iterations: 12,
            max_tokens: 2000000,
            max_wall_clock_minutes: 30
        },
        judge_seats: [
            { id: 'host_model', role: 'draft_loop_pack', responsibility: 'Pack manifestを作成する' },
            { id: 'reviewer', role: 'reviewer', responsibility: '完了ルーブリックと証跡を審査する' },
            { id: 'human_owner', role: 'human_sign_off', responsibility: '業務Ownerとして承認する' }
        ],
        runner_policy: {
            source_of_truth: 'brainbase_control_plane',
            allowed_runners: ['cloudflare_computer', 'codex', 'claude_code', 'mana'],
            direct_runtime_state_mutation: false
        }
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
            required_sources: ['calendar', 'mcp_meeting_source', 'graph_ssot']
        },
        tool_scope: {
            allow: ['calendar.read', 'tactiq.read', 'plaud.read', 'transcript.read', 'slack.read', 'slack.draft', 'graph.read'],
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

    const loopPackManifest = buildMeetingWorkflowPackManifest({
        orgId,
        projectId,
        actorId,
        roleAgent,
        workflowTemplates: templates,
        workflowBindings: bindings,
        workflowTriggers: triggers
    });
    const loopPackDesignReview = reviewLoopPackDesign(loopPackManifest);

    return {
        pack_id: MEETING_WORKFLOW_PACK_ID,
        role_agent_instance: roleAgent,
        workflow_templates: templates,
        workflow_bindings: bindings,
        workflow_triggers: triggers,
        loop_intents: loopIntents,
        loop_pack_manifest: loopPackManifest,
        loop_pack_design_review: loopPackDesignReview
    };
}
