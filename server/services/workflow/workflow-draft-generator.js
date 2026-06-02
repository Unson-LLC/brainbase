// @ts-check
import crypto from 'node:crypto';
import { AppError } from '../../lib/errors.js';

const DEFAULT_WORKSPACE_ID = 'default';

function slugify(value, fallback = 'workflow') {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);
    return slug || fallback;
}

function titleFromPrompt(prompt) {
    const text = String(prompt || '').trim();
    if (/おはよう|毎朝|morning|daily/i.test(text)) return 'Morning Briefing';
    if (/おやすみ|夜|night|daily close/i.test(text)) return 'Daily Close';
    if (/月末|month/i.test(text)) return 'Month End Routine';
    if (/レトロ|retro/i.test(text)) return 'Weekly Retro';
    const compact = text.replace(/\s+/g, ' ').slice(0, 32);
    return compact || 'Generated Workflow';
}

function riskFromPrompt(prompt) {
    const text = String(prompt || '').toLowerCase();
    if (/delete|削除|本番|支払い|請求|契約/.test(text)) return 'high';
    if (/send|post|publish|slack|email|メール|投稿|公開|外部/.test(text)) return 'medium';
    return 'low';
}

function hitlFromRisk(riskLevel, prompt) {
    const text = String(prompt || '').toLowerCase();
    if (riskLevel === 'high') return 'approval_required';
    if (riskLevel === 'medium' || /確認|承認|human|review/.test(text)) return 'human_review';
    return 'none';
}

function requireString(value, label, errors) {
    if (!value || typeof value !== 'string') errors.push(`${label} is required`);
}

function hasDuplicate(values) {
    return new Set(values).size !== values.length;
}

function comparableContextSource(source) {
    return {
        source_type: source?.source_type || '',
        source_ref: source?.source_ref || '',
        permission: source?.permission || 'read',
        required: source?.required === true
    };
}

function normalizePrompt(prompt) {
    const value = String(prompt || '').trim();
    if (!value) throw AppError.validation('prompt is required');
    if (value.length < 8) throw AppError.validation('prompt must describe the workflow purpose');
    return value;
}

export function generateWorkflowDraft(input = {}) {
    const prompt = normalizePrompt(input.prompt);
    const projectId = String(input.project_id || input.projectId || '').trim();
    if (!projectId) throw AppError.validation('project_id is required');
    const name = titleFromPrompt(prompt);
    const suffix = slugify(`${projectId}-${name}-${crypto.randomUUID().slice(0, 8)}`);
    const riskLevel = riskFromPrompt(prompt);
    const hitlPolicy = hitlFromRisk(riskLevel, prompt);
    const workflow = {
        id: `wf-${suffix}`,
        workspace_id: DEFAULT_WORKSPACE_ID,
        project_id: projectId,
        name,
        description: prompt,
        enabled: true,
        schedule: null,
        execution_env: 'local',
        risk_level: riskLevel,
        hitl_policy: hitlPolicy,
        timeout_ms: 300000,
        implementation_key: 'manual-placeholder',
        context_sources: [{
            id: 'ctx-project',
            source_type: 'project',
            source_ref: projectId,
            scope: 'project',
            permission: 'read',
            required: true,
            preview: `Project context: ${projectId}`
        }]
    };
    const steps = [
        { id: 'start', type: 'start', label: 'Start', summary: `Project ${projectId}で開始` },
        { id: 'context', type: 'context', label: 'Context', summary: `${projectId} のProject contextを読む` },
        { id: 'execute', type: 'execute', label: 'Plan / Execute', summary: prompt },
        {
            id: hitlPolicy === 'none' ? 'output' : 'human-review',
            type: hitlPolicy === 'none' ? 'output' : 'human',
            label: hitlPolicy === 'none' ? 'Output' : 'Human Review',
            summary: hitlPolicy === 'none' ? '結果をWorkflow outputとして記録' : '人間確認後に続行'
        }
    ];
    const builderPreview = {
        nodes: steps.map((step, index) => ({ id: step.id, type: step.type, label: step.label, summary: step.summary, x: index * 220, y: index === 3 ? 110 : 0 })),
        edges: steps.slice(1).map((step, index) => ({ id: `edge-${steps[index].id}-${step.id}`, from: steps[index].id, to: step.id }))
    };
    return {
        draft_id: `draft_${crypto.randomUUID()}`,
        status: 'draft',
        prompt,
        project_id: workflow.project_id,
        name: workflow.name,
        description: workflow.description,
        risk_level: workflow.risk_level,
        hitl_policy: workflow.hitl_policy,
        implementation_key: workflow.implementation_key,
        workflow,
        steps,
        context_sources: workflow.context_sources,
        builder_preview: builderPreview
    };
}

export function testWorkflowDraft(draft = {}) {
    const workflow = draft.workflow || {};
    const errors = [];
    requireString(workflow.id, 'workflow.id', errors);
    requireString(workflow.project_id, 'workflow.project_id', errors);
    requireString(workflow.name, 'workflow.name', errors);
    requireString(workflow.implementation_key, 'workflow.implementation_key', errors);
    if (!['low', 'medium', 'high'].includes(workflow.risk_level)) {
        errors.push('workflow.risk_level must be low, medium, or high');
    }
    if (!['none', 'human_review', 'approval_required'].includes(workflow.hitl_policy)) {
        errors.push('workflow.hitl_policy must be none, human_review, or approval_required');
    }
    if (!Array.isArray(draft.steps) || draft.steps.length === 0) {
        errors.push('steps are required');
    } else {
        const stepIds = draft.steps.map((step) => step?.id).filter(Boolean);
        if (stepIds.length !== draft.steps.length) errors.push('each step.id is required');
        if (hasDuplicate(stepIds)) errors.push('step ids must be unique');
        for (const step of draft.steps) {
            requireString(step?.type, 'step.type', errors);
            requireString(step?.label, 'step.label', errors);
        }
    }
    if (!Array.isArray(draft.context_sources) || draft.context_sources.length === 0) {
        errors.push('context_sources are required');
    } else {
        for (const source of draft.context_sources) {
            requireString(source?.source_type, 'context_source.source_type', errors);
            requireString(source?.source_ref, 'context_source.source_ref', errors);
            if (!['read', 'write'].includes(source?.permission || 'read')) {
                errors.push('context_source.permission must be read or write');
            }
        }
    }
    if (!Array.isArray(workflow.context_sources) || workflow.context_sources.length !== draft.context_sources?.length) {
        errors.push('workflow.context_sources must match draft context_sources');
    } else {
        const draftSources = draft.context_sources.map(comparableContextSource);
        const workflowSources = workflow.context_sources.map(comparableContextSource);
        if (JSON.stringify(draftSources) !== JSON.stringify(workflowSources)) {
            errors.push('workflow.context_sources must match draft context_sources');
        }
    }
    const preview = draft.builder_preview || {};
    if (!Array.isArray(preview.nodes) || preview.nodes.length === 0) {
        errors.push('builder_preview.nodes are required');
    } else {
        const stepIds = new Set((draft.steps || []).map((step) => step.id));
        for (const node of preview.nodes) {
            requireString(node?.id, 'builder_preview.node.id', errors);
            if (node?.id && !stepIds.has(node.id)) errors.push(`builder_preview node '${node.id}' has no matching step`);
        }
    }
    if (!Array.isArray(preview.edges)) {
        errors.push('builder_preview.edges are required');
    } else {
        const nodeIds = new Set((preview.nodes || []).map((node) => node.id));
        for (const edge of preview.edges) {
            if (!nodeIds.has(edge?.from) || !nodeIds.has(edge?.to)) {
                errors.push('builder_preview edges must reference existing nodes');
            }
        }
    }
    return {
        dry_run: true,
        status: errors.length ? 'failed' : 'passed',
        message: errors.length ? errors.join('; ') : 'Draft is valid. No workflow_runs entry was created.',
        step_results: (draft.steps || []).map((step) => ({
            step_id: step.id,
            status: 'passed',
            message: step.summary || step.label || step.id
        })),
        output_preview: {
            workflow_id: workflow.id || null,
            project_id: workflow.project_id || null,
            risk_level: workflow.risk_level || 'low',
            hitl_policy: workflow.hitl_policy || 'none'
        }
    };
}
