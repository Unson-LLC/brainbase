// @ts-check

import crypto from 'node:crypto';

export const LOOP_PACK_MANIFEST_VERSION = 'loop_pack_manifest.v0';
export const LOOP_PACK_DESIGN_GATE_ID = 'loop_pack_design_gate.v0';
export const LOOP_PACK_DESIGN_GATE_VERSION = '0.1.0';

const REQUIRED_SECTIONS = [
    ['target_business_process', 'string'],
    ['purpose', 'string'],
    ['inputs', 'array'],
    ['role_agent', 'object'],
    ['workflow_templates', 'array'],
    ['bindings', 'array'],
    ['triggers', 'array'],
    ['human_gates', 'array'],
    ['outputs', 'array'],
    ['audit_evidence', 'array'],
    ['promotion_candidates', 'array'],
    ['learning_candidates', 'array'],
    ['success_metrics', 'array'],
    ['completion_rubric', 'array'],
    ['stop_conditions', 'array'],
    ['budget', 'object'],
    ['judge_seats', 'array']
];

const RISKY_SIDE_EFFECTS = new Set(['external_send', 'graph_promotion', 'decision_promotion', 'task_create']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableNormalize(value) {
    if (Array.isArray(value)) return value.map(stableNormalize);
    if (isPlainObject(value)) {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = stableNormalize(value[key]);
            return acc;
        }, {});
    }
    return value;
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(stableNormalize(value))).digest('hex');
}

function hasSection(manifest, key, kind) {
    const value = manifest?.[key];
    if (kind === 'string') return typeof value === 'string' && value.trim().length > 0;
    if (kind === 'array') return Array.isArray(value) && value.length > 0;
    if (kind === 'object') return isPlainObject(value);
    return value !== undefined && value !== null;
}

function issue(code, message, path, severity = 'blocker') {
    return { severity, code, message, ...(path ? { path } : {}) };
}

function rubric(id, label, passed, evidence = [], issues = []) {
    return { id, label, status: passed ? 'pass' : 'fail', evidence, issues };
}

function positive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
}

function hasJudgeSeat(judgeSeats, needles) {
    return judgeSeats.some((seat) => {
        const text = [seat?.id, seat?.role, seat?.type, seat?.name, seat?.responsibility]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return needles.some((needle) => text.includes(needle));
    });
}

export function reviewLoopPackDesign(inputManifest = {}) {
    const manifest = JSON.parse(JSON.stringify(inputManifest || {}));
    const issues = [];
    const rubricItems = [];

    const sectionIssues = REQUIRED_SECTIONS
        .filter(([key, kind]) => !hasSection(manifest, key, kind))
        .map(([key]) => issue('missing_required_section', `Loop Pack Manifest requires ${key}`, key));
    issues.push(...sectionIssues);
    rubricItems.push(rubric(
        'required_sections',
        '必須セクションが揃っている',
        sectionIssues.length === 0,
        REQUIRED_SECTIONS.map(([key]) => key),
        sectionIssues
    ));

    const templates = Array.isArray(manifest.workflow_templates) ? manifest.workflow_templates : [];
    const bindings = Array.isArray(manifest.bindings) ? manifest.bindings : [];
    const triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];
    const templateIdsWithBindings = new Set(bindings.map((binding) => binding?.workflow_template_id).filter(Boolean));
    const bindingIdsWithTriggers = new Set(triggers.map((trigger) => trigger?.workflow_binding_id).filter(Boolean));
    const reachabilityIssues = [
        ...templates
            .filter((template) => template?.id && !templateIdsWithBindings.has(template.id))
            .map((template) => issue('workflow_without_binding', `Workflow Definition '${template.id}' has no Role Agent binding`, `workflow_templates.${template.id}`)),
        ...bindings
            .filter((binding) => binding?.id && !bindingIdsWithTriggers.has(binding.id))
            .map((binding) => issue('binding_without_trigger', `Workflow Binding '${binding.id}' is not reachable from any trigger`, `bindings.${binding.id}`))
    ];
    issues.push(...reachabilityIssues);
    rubricItems.push(rubric(
        'workflow_reachability',
        'Workflow DefinitionがRole AgentとTriggerから到達可能である',
        reachabilityIssues.length === 0,
        [`templates=${templates.length}`, `bindings=${bindings.length}`, `triggers=${triggers.length}`],
        reachabilityIssues
    ));

    const triggerClasses = new Set(triggers.map((trigger) => trigger?.trigger_type).filter(Boolean));
    const requiredTriggerClasses = Array.isArray(manifest.required_trigger_classes) ? manifest.required_trigger_classes : [];
    const triggerIssues = requiredTriggerClasses
        .filter((triggerClass) => !triggerClasses.has(triggerClass))
        .map((triggerClass) => issue('missing_trigger_class', `Required trigger class '${triggerClass}' is missing`, 'triggers'));
    issues.push(...triggerIssues);
    rubricItems.push(rubric('trigger_classes', '必要なTrigger classが揃っている', triggerIssues.length === 0, Array.from(triggerClasses).sort(), triggerIssues));

    const humanGates = Array.isArray(manifest.human_gates) ? manifest.human_gates : [];
    const humanGateById = new Map(humanGates
        .map((gate) => [gate?.id || gate?.human_gate || gate?.name, gate])
        .filter(([gateId]) => Boolean(gateId)));
    const outputs = Array.isArray(manifest.outputs) ? manifest.outputs : [];
    const sideEffectIssues = outputs
        .filter((output) => output?.requires_human_gate === true || RISKY_SIDE_EFFECTS.has(output?.side_effect_type))
        .filter((output) => {
            const gateRef = output?.human_gate_ref || output?.human_gate;
            const gate = gateRef ? humanGateById.get(gateRef) : null;
            if (!gate || gate.required !== true) return true;
            if (!RISKY_SIDE_EFFECTS.has(output?.side_effect_type)) return false;
            return !Array.isArray(gate.protects) || !gate.protects.includes(output.side_effect_type);
        })
        .map((output) => issue(
            'unsafe_side_effect',
            `Output '${output?.id || output?.workflow_definition_id || 'unknown'}' requires a valid Human Gate`,
            `outputs.${output?.id || output?.workflow_definition_id || 'unknown'}`
        ));
    issues.push(...sideEffectIssues);
    rubricItems.push(rubric('human_gate_protection', '危険な副作用がHuman Gateで保護されている', sideEffectIssues.length === 0, Array.from(humanGateById.keys()).sort(), sideEffectIssues));

    const completionIssues = Array.isArray(manifest.completion_rubric) && manifest.completion_rubric.length > 0
        ? []
        : [issue('missing_loop_closure_rubric', 'Loop Pack must define completion_rubric before execution', 'completion_rubric')];
    issues.push(...completionIssues);
    rubricItems.push(rubric(
        'completion_rubric',
        '完了条件がルーブリック化されている',
        completionIssues.length === 0,
        Array.isArray(manifest.completion_rubric) ? manifest.completion_rubric.map((item) => item?.id).filter(Boolean) : [],
        completionIssues
    ));

    const budget = isPlainObject(manifest.budget) ? manifest.budget : {};
    const controlIssues = [];
    if (!Array.isArray(manifest.stop_conditions) || manifest.stop_conditions.length === 0) {
        controlIssues.push(issue('missing_stop_conditions', 'Loop Pack must define stop_conditions', 'stop_conditions'));
    }
    if (!positive(budget.max_iterations) || !positive(budget.max_tokens) || !positive(budget.max_wall_clock_minutes)) {
        controlIssues.push(issue('missing_budget_or_stop', 'Loop Pack budget must include max_iterations, max_tokens, and max_wall_clock_minutes', 'budget'));
    }
    issues.push(...controlIssues);
    rubricItems.push(rubric(
        'gates_and_control',
        '停止条件と予算が設定されている',
        controlIssues.length === 0,
        [
            ...(Array.isArray(manifest.stop_conditions) ? manifest.stop_conditions : []),
            `max_iterations=${budget.max_iterations || 'missing'}`,
            `max_tokens=${budget.max_tokens || 'missing'}`,
            `max_wall_clock_minutes=${budget.max_wall_clock_minutes || 'missing'}`
        ],
        controlIssues
    ));

    const judgeSeats = Array.isArray(manifest.judge_seats) ? manifest.judge_seats : [];
    const judgeIssues = [];
    if (!hasJudgeSeat(judgeSeats, ['reviewer', 'judge'])) {
        judgeIssues.push(issue('missing_judge_seat', 'Loop Pack must assign a reviewer or judge seat', 'judge_seats'));
    }
    if (!hasJudgeSeat(judgeSeats, ['human', 'owner', 'sign_off', 'sign-off'])) {
        judgeIssues.push(issue('missing_human_signoff_seat', 'Loop Pack must assign a human owner or sign-off seat', 'judge_seats'));
    }
    issues.push(...judgeIssues);
    rubricItems.push(rubric('judge_seats', 'Judge席と人間Ownerが設定されている', judgeIssues.length === 0, judgeSeats.map((seat) => seat?.id || seat?.role).filter(Boolean), judgeIssues));

    const runnerIssues = manifest.runner_policy?.direct_runtime_state_mutation === false
        ? []
        : [issue('direct_runtime_mutation_not_for_pack_creation', 'Runner may draft or execute, but Brainbase must own Pack import and runtime ledger writes', 'runner_policy.direct_runtime_state_mutation')];
    issues.push(...runnerIssues);
    rubricItems.push(rubric('runner_boundary', 'runnerは正本ではなく、BrainbaseがPack importを所有している', runnerIssues.length === 0, [manifest.runner_policy?.source_of_truth || 'missing'], runnerIssues));

    return {
        gate_id: LOOP_PACK_DESIGN_GATE_ID,
        version: LOOP_PACK_DESIGN_GATE_VERSION,
        manifest_version: manifest.manifest_version || null,
        pack_id: manifest.pack_id || null,
        status: issues.some((item) => item.severity === 'blocker') ? 'needs_revision' : 'pass',
        manifest_digest: digest(manifest),
        rubric: rubricItems,
        issues,
        required_actions: issues.map((item) => ({
            code: item.code,
            path: item.path || null,
            action: item.message
        }))
    };
}
