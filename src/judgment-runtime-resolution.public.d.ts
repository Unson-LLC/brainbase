export { JudgmentResolutionError, canonicalJson, computeRequestDigest, sha256Hex } from './judgment-resolution-contract.js';

export type JudgmentRuntimeIntent =
    | 'answer'
    | 'investigate'
    | 'diagnose'
    | 'design'
    | 'implement'
    | 'review'
    | 'operate';
export type JudgmentRuntimeDomain =
    | 'general'
    | 'knowledge'
    | 'personal_judgment'
    | 'engineering'
    | 'organization'
    | 'operations';
export type JudgmentRuntimeSignal =
    | 'cumulative_effect'
    | 'complexity_growth'
    | 'threshold_proposal'
    | 'parallel_exploration'
    | 'authority_boundary'
    | 'problem_frame_uncertain'
    | 'external_outcome';
export type JudgmentRuntimeActionKind = 'none' | 'read' | 'write' | 'external';
export type JudgmentRuntimeRisk = 'low' | 'medium' | 'high' | 'critical';
export type JudgmentRuntimeConfidence = 'confirmed' | 'inferred' | 'unknown';
export type JudgmentRuntimeStatus = 'resolved' | 'needs_classification' | 'needs_policy_resolution';
export type JudgmentRuntimeAutonomyDecision = 'continue' | 'escalate';

export interface JudgmentRuntimeClassification {
    intent: JudgmentRuntimeIntent;
    domains: JudgmentRuntimeDomain[];
    action_kind: JudgmentRuntimeActionKind;
    risk: JudgmentRuntimeRisk;
    confidence: JudgmentRuntimeConfidence;
    signals: JudgmentRuntimeSignal[];
}

export interface JudgmentRuntimeMessage {
    sequence: number;
    turn_id: string | null;
    role: 'user' | 'assistant';
    phase: string | null;
    text: string;
}

export interface JudgmentRuntimePriorReceipt {
    turn_id: string;
    resolution_id: string;
    request_digest: string;
    context_digest: string | null;
    plan_digest: string;
    classification: JudgmentRuntimeClassification;
    selected_dag_ids: string[];
}

export interface JudgmentRuntimeRuntimeContext {
    host: 'codex' | 'claude-code';
    entrypoint?: 'codex' | 'claude_code' | 'mana' | 'company_os' | 'unknown';
    model: string | null;
    permission_mode: string | null;
    project_binding: string | null;
}

export interface JudgmentRuntimeConversationContext {
    schema_version: 'brainbase-conversation-context-v1';
    session_ref: string;
    messages: JudgmentRuntimeMessage[];
    prior_receipts: JudgmentRuntimePriorReceipt[];
    runtime: JudgmentRuntimeRuntimeContext;
    instruction_bindings: Array<{ scope: string; source_ref: string; digest: string }>;
    completeness: 'complete' | 'partial';
    source_digest: string;
}

export interface JudgmentRuntimeInput {
    request: string;
    turn_id: string;
    project_code: string | null;
    conversation_context: JudgmentRuntimeConversationContext;
    model_interpretation: JudgmentRuntimeClassification | null;
}

export interface JudgmentRuntimeManifestLock {
    schema_version: 'brainbase-judgment-manifest-lock-v1';
    entries: Array<{ runtime_version: string; manifest_digest: string }>;
}

export interface JudgmentRuntimePolicy {
    id: string;
    version: string;
    priority: number;
    strength: 'hard' | 'soft';
    scope: { type: 'global' | 'organization' | 'project' | 'owner'; id: string | null };
    visibility: 'organization' | 'owner';
    owner_person_id: string | null;
    evidence_requirement: string;
    effect: { target: string; decision: 'require' | 'forbid' | 'prefer' };
    instruction: string;
    human_approval?: {
        action_kinds?: JudgmentRuntimeActionKind[];
        risks?: JudgmentRuntimeRisk[];
    };
    [key: string]: unknown;
}

export interface JudgmentRuntimeManifest {
    schema_version: 'brainbase-judgment-runtime-v1';
    runtime_version: string;
    host_bindings: Array<{ adapter_id: string; adapter_version: string; status?: string; [key: string]: unknown }>;
    policies: JudgmentRuntimePolicy[];
    nodes: Array<{
        id: string;
        kind: 'common' | 'judgment' | 'capability' | 'constraint' | 'fail_closed';
        instruction: string;
        required_capability_template: string | null;
        execution_contract?: string;
        [key: string]: unknown;
    }>;
    dags: Array<{
        id: string;
        kind: 'domain' | 'constraint' | 'fail_closed';
        path: string[];
        policy_ids: string[];
        [key: string]: unknown;
    }>;
    composition_edges: Array<[string, string]>;
    selectors: {
        domain_order: JudgmentRuntimeDomain[];
        signal_order: JudgmentRuntimeSignal[];
        domain_dags: Record<JudgmentRuntimeDomain, string>;
        signal_dags: Record<JudgmentRuntimeSignal, string>;
        engineering_implementation_dag?: string;
        authority_dag: string;
        clarification_dag: string;
        [key: string]: unknown;
    };
    semantic_matchers: {
        intents: Record<JudgmentRuntimeIntent, string[]>;
        domains: Record<Exclude<JudgmentRuntimeDomain, 'general'>, string[]>;
        signals: Record<JudgmentRuntimeSignal, string[]>;
        safety: Record<'write' | 'external' | 'critical', string[]>;
        positive_commands: string[];
        follow_up: string[];
        [key: string]: unknown;
    };
    autonomy: {
        schema_version: 'brainbase-autonomy-policy-v1';
        continue_risks: JudgmentRuntimeRisk[];
        escalate_risks: JudgmentRuntimeRisk[];
        escalate_action_kinds: JudgmentRuntimeActionKind[];
        runtime_escalation_reasons: string[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface JudgmentRuntimeReconciliation {
    status: 'resolved' | 'needs_classification';
    classification: JudgmentRuntimeClassification | null;
    assurance: 'verified' | 'bounded' | 'unknown';
    reasons: string[];
    evidence: Record<string, unknown>;
}

export interface JudgmentRuntimeResolutionPlan {
    status: JudgmentRuntimeStatus;
    autonomy_decision: JudgmentRuntimeAutonomyDecision;
    autonomy_reason_code: 'routine_in_scope' | 'classification_missing' | 'policy_conflict' | 'risk_or_external';
    allowed_runtime_escalation_reasons: string[];
    autonomy_policy_ids: string[];
    reconciliation: JudgmentRuntimeReconciliation;
    selected_dag_ids: string[];
    applicable_policies: JudgmentRuntimePolicy[];
    suppressed_policies: Array<{ policy_id: string; suppressed_by_policy_id: string; reason: string }>;
    policy_conflict: boolean;
    required_capabilities: Array<{
        capability: string;
        status: string;
        input: Record<string, unknown>;
        receipt_required: boolean;
        [key: string]: unknown;
    }>;
    active_nodes: string[];
    active_edges: Array<[string, string]>;
    active_node_definitions: JudgmentRuntimeManifest['nodes'];
    unresolved: string[];
    rationale: string[];
}

export interface JudgmentRuntimeCoreInput {
    input: JudgmentRuntimeInput;
    manifest: JudgmentRuntimeManifest;
    /** Policies already filtered by the Organization/Host authorization adapter. */
    applicablePolicies?: JudgmentRuntimePolicy[];
    ownerPersonId?: string | null;
    clientCapabilities?: string[];
}

export declare function validateManifestLock(
    lock: JudgmentRuntimeManifestLock,
    previous?: JudgmentRuntimeManifestLock | null,
    current?: { runtimeVersion: string; manifestDigest: string } | null,
): true;
export declare function validateManifest(manifest: JudgmentRuntimeManifest, lock: JudgmentRuntimeManifestLock): string;
export declare function validateRuntimeInput(rawInput: unknown, manifest: JudgmentRuntimeManifest): JudgmentRuntimeInput;
export declare function autonomyResolution(
    status: JudgmentRuntimeStatus,
    classification: JudgmentRuntimeClassification | null,
    manifest: JudgmentRuntimeManifest,
    applicablePolicies?: JudgmentRuntimePolicy[],
): {
    autonomy_decision: JudgmentRuntimeAutonomyDecision;
    autonomy_reason_code: JudgmentRuntimeResolutionPlan['autonomy_reason_code'];
    allowed_runtime_escalation_reasons: string[];
    autonomy_policy_ids: string[];
};
export declare function reconcileModelInterpretation(
    input: JudgmentRuntimeInput,
    manifest: JudgmentRuntimeManifest,
): JudgmentRuntimeReconciliation;
export declare function classify(input: JudgmentRuntimeInput, manifest: JudgmentRuntimeManifest): JudgmentRuntimeReconciliation;
export declare function materializePolicy(policy: JudgmentRuntimePolicy, ownerPersonId: string | null): JudgmentRuntimePolicy;
export declare function mergePolicies(policies: JudgmentRuntimePolicy[]): {
    applicable: JudgmentRuntimePolicy[];
    suppressed: Array<{ policy_id: string; suppressed_by_policy_id: string; reason: string }>;
    conflict: boolean;
};
export declare function selectedDags(classification: JudgmentRuntimeClassification, manifest: JudgmentRuntimeManifest): string[];
export declare function buildGraph(
    dagIds: string[],
    manifest: JudgmentRuntimeManifest,
    options?: { clarification?: boolean },
): { active_nodes: string[]; active_edges: Array<[string, string]> };
export declare function materializeActiveNodeDefinitions(
    activeNodes: string[],
    manifest: JudgmentRuntimeManifest,
    options?: { evidenceRequired?: boolean },
): JudgmentRuntimeManifest['nodes'];
export declare function topologicallySortNodes(nodes: string[], edges: Array<[string, string]>): string[];
export declare const JUDGMENT_FRAME_CAPABILITY: 'judgment.frame';
export declare function isJudgmentBearing(classification: JudgmentRuntimeClassification | null): boolean;
export declare function frameCapabilities(
    input: JudgmentRuntimeInput,
    classification: JudgmentRuntimeClassification | null,
    clientCapabilities: ReadonlySet<string>,
    status: JudgmentRuntimeStatus,
): JudgmentRuntimeResolutionPlan['required_capabilities'];
export declare function knowledgeCapabilities(
    input: JudgmentRuntimeInput,
    classification: JudgmentRuntimeClassification | null,
): JudgmentRuntimeResolutionPlan['required_capabilities'];
export declare function resolveJudgmentRuntimeCore(args: JudgmentRuntimeCoreInput): JudgmentRuntimeResolutionPlan;
