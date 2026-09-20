/**
 * Mana outcome-delegation UI.
 *
 * This module deliberately has no knowledge of fetch, tenant tokens, or the
 * Mana runtime URL.  The host injects the same-origin `api` and `apiMutation`
 * functions used by the organization shell.  The BFF remains responsible for
 * deriving tenant, actor, and project access from the authenticated session.
 */

export const OUTCOME_DELEGATION_CONTRACT_VERSION = 'mana.outcome-delegation.v1';
export const MANA_STORY_IDS = Object.freeze([
  'story-brainbase-outcome-mana-contract',
  'story-brainbase-outcome-mana-authority',
  'story-brainbase-outcome-mana-triggers',
  'story-brainbase-outcome-mana-deliver-outcome',
  'story-brainbase-outcome-mana-safe-test',
  'story-brainbase-outcome-mana-run-control',
]);

const UNKNOWN = '未確認';
const EMPTY = 'empty';
const STOPPED_RUN_RESTART_UNAVAILABLE = '停止した実行は再開できません。';

const STATUS_LABELS = Object.freeze({
  loading: '読み込み中',
  idle: '待機中',
  ready: '取得済み',
  draft: '下書き',
  active: '有効',
  stopped: '停止',
  misconfigured: '設定不備',
  retired: '廃止',
  queued: '待機中',
  pending: '待機中',
  running: '実行中',
  waiting_approval: '承認待ち',
  failed: '失敗',
  completion_unverified: '完了未確認',
  configuration_snapshot_missing: '設定記録不足',
  completed_verified: '成果検証済み',
  completed: '完了',
  not_executed: '未実行',
  unexecuted: '未実行',
  executed: '実行済み・完了未確認',
  verified: '検証済み',
  saved_unverified: '保存済み・確認待ち',
  stale: '再試験が必要',
  permission_denied: '権限不足',
  error_retryable: '再試行可能なエラー',
});

const AUTHORITY_LABELS = Object.freeze({
  auto: '自動許可',
  approval: '承認が必要',
  deny: '禁止',
});

const TRIGGER_LABELS = Object.freeze({
  manual: '手動',
  schedule: '定期実行',
  document: '文書追加',
});

const RUN_STATUSES = new Set([
  'queued', 'running', 'waiting_approval', 'failed', 'stopped',
  'completion_unverified', 'completed_verified',
]);

const STAGE_LABELS = Object.freeze({
  preflight: '事前確認',
  knowledge_retrieval: '知識取得',
  input_retrieval: '入力取得',
  generate: '成果生成',
  effect_execution: '外部操作',
  artifact_save: '成果物保存',
  artifact_readback: '保存結果確認',
  completion_verification: '完了条件確認',
});

// The runtime still exposes the same contract, authority, trigger, test, and
// run resources.  The UI presents those resources as one operational workflow
// so people can see the current step without expanding five long cards at once.
const WORKFLOW_STAGES = Object.freeze([
  { id: 'contract', label: '成果契約', description: '成果・根拠・保存先・完了条件' },
  { id: 'authority', label: '権限', description: '操作・対象資源・主体ごとの許可' },
  { id: 'triggers', label: '起動条件', description: '起動方式と明示的な有効化' },
  { id: 'safe_test', label: '安全試験', description: '隔離実行と完了条件の検証' },
  { id: 'runs', label: '実行履歴', description: '起動理由・段階・成果物・再開地点' },
]);

const READBACK_STATES = new Set(['verified', 'active', 'completed_verified', 'readback_verified']);

// These are the operational surfaces of the Mana workspace.  Codex and
// Claude Code are intentionally not listed here: their own applications are
// the source of truth for their plug-in connections.  Mana needs the shared
// inventory because its runtime authority is only visible from this module.
const MANA_VIEWS = Object.freeze([
  { id: 'overview', label: '委任一覧', description: '委任ごとの状態と概要' },
  { id: 'connections', label: '接続状態', description: '組織全体の接続と許可リソース' },
  { id: 'runs', label: '実行履歴', description: '実行工程とreadback' },
  { id: 'settings', label: 'Mana設定', description: 'runtime既定値と監査' },
]);

const CONNECTOR_DEFINITIONS = Object.freeze([
  { id: 'github', label: 'GitHub', description: 'コード・ドキュメントの参照', icon: '/icons/mana/brand-github.svg' },
  { id: 'drive', label: 'Google Drive', description: '資料・成果物の保存', icon: '/icons/mana/brand-google-drive.svg' },
  { id: 'slack', label: 'Slack', description: '通知・承認・文書イベント', icon: '/icons/mana/brand-slack.svg' },
  { id: 'brainbase', label: 'Brainbase Graph', description: '知識・判断の参照', icon: '/icons/mana/affiliate.svg' },
  { id: 'mana', label: 'Mana runtime', description: '委任の実行基盤', icon: '/icons/mana/cpu.svg' },
]);

const CONNECTOR_FOUNDATION_KINDS = Object.freeze({
  github: 'github',
  drive: 'drive',
  slack: 'slack',
  brainbase: 'knowledge',
  mana: 'mana',
});

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveInjected(value) {
  return typeof value === 'function' ? value() : value;
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function present(value, fallback = UNKNOWN) {
  if (Array.isArray(value)) {
    const items = value.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
    return items.length ? items.join(', ') : fallback;
  }
  return value === null || value === undefined || String(value).trim() === '' ? fallback : String(value);
}

function stringValue(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function integerValue(value, fallback = null) {
  return Number.isInteger(value) ? value : Number.isInteger(Number(value)) ? Number(value) : fallback;
}

function projectValue(input) {
  const project = objectValue(resolveInjected(input));
  return {
    // Keep the canonical project payload intact.  The UI only reads a small
    // subset today, but foundation values/resources are needed to render the
    // connection inventory without guessing a connection is healthy.
    ...project,
    code: firstPresent(project.code, project.project_code, project.projectCode) ?? null,
    name: firstPresent(project.name, project.display_name, project.displayName) ?? null,
  };
}

function sessionValue(input) {
  const session = objectValue(resolveInjected(input));
  const permissions = objectValue(session.permissions);
  return {
    role: firstPresent(session.role, session.project_role, permissions.role) ?? null,
    actorId: firstPresent(session.actor_id, session.actorId, session.person_id, session.personId, session.slack_user_id) ?? null,
    displayName: firstPresent(session.display_name, session.displayName, session.name) ?? null,
    outcomePermission: firstPresent(session.outcome_permission, permissions.outcomes, permissions.outcome_delegation) ?? null,
  };
}

function normalizeStatus(value) {
  const status = stringValue(value).trim().toLowerCase().replace(/[ -]+/g, '_');
  return status || null;
}

export function normalizeConnector(value, fallbackId = '') {
  const raw = value;
  const source = objectValue(value);
  const resources = Array.isArray(source.resources)
    ? source.resources
    : Array.isArray(source.allowedResources)
      ? source.allowedResources
      : Array.isArray(source.allowed_resources) ? source.allowed_resources : [];
  return {
    raw,
    id: stringValue(firstPresent(source.id, source.connectorId, source.connector_id, fallbackId), fallbackId),
    label: stringValue(firstPresent(source.label, source.name, source.provider, fallbackId), fallbackId),
    description: stringValue(source.description, ''),
    // A registered resource may have no status.  Keep that distinction so
    // the screen can show 未確認 instead of inferring a live connection.
    status: normalizeStatus(firstPresent(source.status, source.state, source.connectionState, source.connection_state)),
    account: firstPresent(source.account, source.accountId, source.account_id, source.identifier, source.url) ?? null,
    resourceCount: integerValue(firstPresent(source.resourceCount, source.resource_count), resources.length || null),
    resources,
    checkedAt: firstPresent(source.checkedAt, source.checked_at, source.updatedAt, source.updated_at) ?? null,
    reason: firstPresent(source.reason, source.error, source.connectionReason, source.connection_reason) ?? null,
  };
}

export function normalizeApprovalTarget(value, fallbackContractVersion = null) {
  const source = objectValue(value);
  const effect = objectValue(source.effect);
  const payload = effect.payload;
  const payloadObject = objectValue(payload);
  const operation = firstPresent(source.operation, effect.operation);
  const resource = firstPresent(source.resource, effect.resource);
  const destination = firstPresent(
    source.destination, source.external_destination, source.externalDestination,
    payloadObject.destination, payloadObject.external_destination, payloadObject.externalDestination,
    resource,
  );
  const diff = firstPresent(
    source.diff, source.change_summary, source.changeSummary, source.changes,
    payloadObject.diff, payloadObject.change_summary, payloadObject.changeSummary, payloadObject.changes,
    payload,
  );
  const target = {
    approvalId: stringValue(firstPresent(source.approvalId, source.approval_id), ''),
    operation: stringValue(operation, ''),
    resource: stringValue(resource, ''),
    payloadHash: stringValue(firstPresent(source.payloadHash, source.payload_hash), ''),
    destination: destination ?? null,
    contractVersion: integerValue(firstPresent(source.contractVersion, source.contract_version, fallbackContractVersion), null),
    expiresAt: firstPresent(source.expiresAt, source.expires_at) ?? null,
    diff: diff ?? null,
  };
  return {
    ...target,
    complete: Boolean(target.approvalId && target.operation && target.resource && target.payloadHash
      && target.destination && target.contractVersion !== null && target.expiresAt && target.diff),
  };
}

function approvalDisplayValue(value) {
  if (value === null || value === undefined || value === '') return UNKNOWN;
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return UNKNOWN; }
  }
  return String(value);
}

function statusLabel(value) {
  const status = normalizeStatus(value);
  return STATUS_LABELS[status] ?? (status ? `状態: ${status}` : UNKNOWN);
}

function authorityLabel(value) {
  return AUTHORITY_LABELS[normalizeStatus(value)] ?? UNKNOWN;
}

function triggerLabel(value) {
  const source = objectValue(value);
  const normalized = normalizeStatus(typeof value === 'object' ? firstPresent(source.type, source.triggerType, source.trigger_type) : value);
  return TRIGGER_LABELS[normalized] ?? UNKNOWN;
}

function runReasonLabel(reason, trigger) {
  const normalized = normalizeStatus(reason);
  if (TRIGGER_LABELS[normalized]) return TRIGGER_LABELS[normalized];
  if (typeof reason === 'string' && reason.trim() && !/^[a-z0-9_]+$/i.test(reason.trim())) return reason.trim();
  return triggerLabel(trigger);
}

function dateLabel(value) {
  if (!value) return UNKNOWN;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UNKNOWN;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function idempotencyKey(prefix) {
  const generated = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${generated}`;
}

function normalizeError(value) {
  const source = value instanceof Error ? value : objectValue(value);
  const nested = objectValue(source.error);
  const status = integerValue(source.status ?? source.statusCode ?? source.response?.status, null);
  const code = stringValue(firstPresent(source.code, nested.code, typeof source.error === 'string' ? source.error : null, status ? `http_${status}` : null), 'unknown_error');
  const message = stringValue(firstPresent(source.message, nested.message), code);
  const lower = `${code} ${message}`.toLowerCase();
  const permission = status === 401 || status === 403 || /permission|forbidden|not_allowed|scope_mismatch|unauthori/.test(lower);
  const conflict = status === 409 || /conflict|version|stale/.test(lower);
  return {
    code,
    message,
    status,
    kind: permission ? 'permission_denied' : conflict ? 'conflict' : 'error_retryable',
  };
}

function collectionFrom(payload, keys = ['items', 'records', 'contracts', 'delegations', 'runs']) {
  if (Array.isArray(payload)) return payload;
  const object = objectValue(payload);
  for (const key of keys) if (Array.isArray(object[key])) return object[key];
  return null;
}

function explicitEmpty(payload, keys) {
  if (Array.isArray(payload)) return payload.length === 0;
  const object = objectValue(payload);
  if (object.state === EMPTY || object.state === 'empty') return true;
  const collection = collectionFrom(payload, keys);
  return Array.isArray(collection) && collection.length === 0;
}

function isReadbackVerified(payload) {
  const object = objectValue(payload);
  const readback = objectValue(object.readback ?? object.verification);
  const contract = objectValue(object.contract ?? object.delegation);
  const run = objectValue(object.run ?? object.testRun);
  return object.verified === true || object.readback_verified === true || readback.verified === true
    || READBACK_STATES.has(normalizeStatus(object.state)) || READBACK_STATES.has(normalizeStatus(readback.state))
    || READBACK_STATES.has(normalizeStatus(contract.status)) || READBACK_STATES.has(normalizeStatus(run.status));
}

function contractMatchesExpected(contract, { id, version = null, fields = null, status = null } = {}) {
  if (!contract?.contractId || contract.contractId !== id) return false;
  if (version !== null && contract.version !== version) return false;
  if (status && contract.status !== status) return false;
  if (!fields) return true;
  const expected = normalizeContract(fields);
  const source = objectValue(fields);
  const comparisons = [
    ['project', 'project_code', 'projectCode'], ['outcome'], ['scope'],
    ['inputRefs', 'input_refs'], ['knowledgeRefs', 'knowledge_refs'], ['judgmentRefs', 'judgment_refs'],
    ['artifactDestination', 'artifact_destination'], ['completionCriteria', 'completion_criteria'],
    ['owner'], ['limits'], ['trigger'],
  ];
  return comparisons.every((keys) => {
    if (!keys.some((key) => hasOwn(source, key))) return true;
    const normalizedKey = keys[0];
    return JSON.stringify(contract[normalizedKey]) === JSON.stringify(expected[normalizedKey]);
  });
}

function normalizeReference(value) {
  const reference = objectValue(value);
  return {
    id: stringValue(firstPresent(reference.id, reference.referenceId, reference.reference_id)),
    version: reference.version === null ? null : stringValue(firstPresent(reference.version, reference.revision), ''),
  };
}

function normalizeCriterion(value, index = 0) {
  const criterion = objectValue(value);
  return {
    id: stringValue(firstPresent(criterion.id, criterion.criterionId), `criterion-${index + 1}`),
    description: stringValue(firstPresent(criterion.description, criterion.label), ''),
    kind: stringValue(firstPresent(criterion.kind), 'content_includes'),
    expected: criterion.expected,
  };
}

export function normalizeTrigger(value) {
  const trigger = objectValue(value);
  const type = normalizeStatus(firstPresent(trigger.type, trigger.trigger_type));
  return {
    type: ['manual', 'schedule', 'document'].includes(type) ? type : null,
    scheduleId: stringValue(firstPresent(trigger.scheduleId, trigger.schedule_id), ''),
    subscriptionId: stringValue(firstPresent(trigger.subscriptionId, trigger.subscription_id), ''),
    provider: stringValue(trigger.provider, ''),
    state: normalizeStatus(firstPresent(trigger.state, trigger.status, trigger.connection_state)) ?? null,
    reason: stringValue(firstPresent(trigger.reason, trigger.error, trigger.connection_reason), ''),
  };
}

export function normalizeContract(value) {
  const raw = objectValue(value);
  const source = objectValue(raw.contract ?? raw.delegation ?? raw);
  const destination = objectValue(source.artifactDestination ?? source.artifact_destination);
  const owner = objectValue(source.owner);
  const limits = objectValue(source.limits);
  const references = (key, snakeKey) => {
    const refs = source[key] ?? source[snakeKey];
    return Array.isArray(refs) ? refs.map(normalizeReference) : [];
  };
  const criteria = source.completionCriteria ?? source.completion_criteria;
  return {
    raw: value,
    schemaVersion: stringValue(firstPresent(source.schemaVersion, source.schema_version), OUTCOME_DELEGATION_CONTRACT_VERSION),
    contractId: stringValue(firstPresent(source.contractId, source.contract_id, source.id), ''),
    version: integerValue(source.version, null),
    tenantId: null,
    project: stringValue(firstPresent(source.project, source.project_code, source.projectCode), ''),
    status: normalizeStatus(source.status),
    nextAction: stringValue(firstPresent(source.nextAction, source.next_action), ''),
    outcome: stringValue(source.outcome, ''),
    scope: stringValue(source.scope, ''),
    inputRefs: references('inputRefs', 'input_refs'),
    knowledgeRefs: references('knowledgeRefs', 'knowledge_refs'),
    judgmentRefs: references('judgmentRefs', 'judgment_refs'),
    artifactDestination: {
      adapterId: stringValue(firstPresent(destination.adapterId, destination.adapter_id), ''),
      location: stringValue(destination.location, ''),
      environment: ['production', 'isolated'].includes(stringValue(destination.environment)) ? destination.environment : null,
    },
    completionCriteria: Array.isArray(criteria) ? criteria.map(normalizeCriterion) : [],
    owner: { actorId: stringValue(firstPresent(owner.actorId, owner.actor_id), '') },
    trigger: normalizeTrigger(source.trigger),
    limits: {
      maxAttempts: integerValue(limits.maxAttempts ?? limits.max_attempts, null),
      timeoutMs: integerValue(limits.timeoutMs ?? limits.timeout_ms, null),
      budgetUnits: integerValue(limits.budgetUnits ?? limits.budget_units, null),
    },
    createdBy: stringValue(firstPresent(source.createdBy, source.created_by), ''),
    createdAt: source.createdAt ?? source.created_at ?? null,
    updatedAt: source.updatedAt ?? source.updated_at ?? null,
    supersedesVersion: integerValue(source.supersedesVersion ?? source.supersedes_version, null),
  };
}

export function normalizeContracts(payload) {
  const records = collectionFrom(payload, ['items', 'records', 'contracts', 'delegations']);
  if (!records) return { state: 'unknown', records: [], raw: payload };
  return { state: records.length ? 'ready' : 'empty', records: records.map(normalizeContract), raw: payload };
}

export function normalizeAuthority(value) {
  const source = objectValue(value);
  const entries = collectionFrom(source, ['matrix', 'rules', 'items', 'entries', 'authorities']);
  if (!entries) return { state: 'unknown', status: 'unknown', matrix: [], raw: value };
  const status = entries.length ? 'ready' : 'empty';
  return {
    state: status,
    status,
    matrix: entries.map((entry, index) => {
      const item = objectValue(entry);
      return {
        id: stringValue(firstPresent(item.id, item.operationId, item.operation_id), `operation-${index + 1}`),
        operation: stringValue(firstPresent(item.operation, item.action, item.name), UNKNOWN),
        target: stringValue(firstPresent(item.target, item.resource, item.resource_id), UNKNOWN),
        project: stringValue(firstPresent(item.project, item.project_code, item.projectCode), UNKNOWN),
        actor: stringValue(firstPresent(item.actor, item.actor_id, item.actorId), UNKNOWN),
        policy: ['auto', 'approval', 'deny'].includes(normalizeStatus(item.policy ?? item.mode ?? item.effect)) ? normalizeStatus(item.policy ?? item.mode ?? item.effect) : null,
        reason: stringValue(firstPresent(item.reason, item.explanation), ''),
        state: normalizeStatus(item.state),
      };
    }),
    raw: value,
  };
}

export function normalizeRun(value) {
  const raw = objectValue(value);
  const source = objectValue(raw.run ?? raw);
  const completion = objectValue(source.completion ?? source.completion_result ?? source.completionResult);
  const artifacts = source.artifacts ?? source.artifact_refs ?? source.artifactRefs;
  const evidence = source.evidence ?? source.references ?? [];
  const stages = Array.isArray(source.stages) ? source.stages : [];
  const status = normalizeStatus(source.status ?? source.state);
  const safeTestSource = objectValue(source.safeTest ?? source.safe_test ?? raw.safeTest ?? raw.safe_test);
  const configHash = stringValue(firstPresent(
    source.configHash, source.config_hash,
    safeTestSource.configHash, safeTestSource.config_hash,
  ), '');
  const triggerSource = source.trigger;
  const trigger = typeof triggerSource === 'string'
    ? triggerSource
    : firstPresent(objectValue(triggerSource).type, objectValue(triggerSource).triggerType, objectValue(triggerSource).trigger_type, source.triggerType, source.trigger_type, source.triggerReason, source.trigger_reason, source.reason) ?? null;
  const artifactReadback = source.artifactReadback ?? source.artifact_readback ?? source.readback;
  const judgment = source.judgment ?? source.judgment_result ?? source.judgmentResult;
  const judgmentReason = firstPresent(
    source.judgmentReason, source.judgment_reason,
    objectValue(judgment).reason, source.reason_detail,
  ) ?? null;
  return {
    raw: value,
    id: stringValue(firstPresent(source.runId, source.run_id, source.id), ''),
    contractId: stringValue(firstPresent(source.contractId, source.contract_id), ''),
    contractVersion: integerValue(source.contractVersion ?? source.contract_version, null),
    mode: normalizeStatus(source.mode),
    status: RUN_STATUSES.has(status) ? status : status ?? null,
    safeTest: {
      configSnapshot: safeTestSource.configSnapshot ?? safeTestSource.config_snapshot ?? null,
      configHash: stringValue(firstPresent(safeTestSource.configHash, safeTestSource.config_hash), ''),
      currentConfigHash: stringValue(firstPresent(safeTestSource.currentConfigHash, safeTestSource.current_config_hash), ''),
      retestRequired: safeTestSource.retestRequired === true || safeTestSource.retest_required === true,
      retestReason: stringValue(firstPresent(safeTestSource.retestReason, safeTestSource.retest_reason), ''),
    },
    configHash,
    trigger,
    reason: stringValue(firstPresent(source.triggerReason, source.trigger_reason, source.reason), ''),
    artifactReadback: artifactReadback === undefined ? null : artifactReadback,
    judgment: judgment === undefined ? null : judgment,
    judgmentReason,
    stage: stringValue(firstPresent(source.stage, source.step, source.phase), ''),
    stages: stages.map((value) => {
      const stage = objectValue(value);
      return {
        id: stringValue(firstPresent(stage.id, stage.stageId, stage.stage_id), ''),
        status: normalizeStatus(stage.status ?? stage.state),
        attempt: integerValue(stage.attempt, null),
        startedAt: stage.startedAt ?? stage.started_at ?? null,
        completedAt: stage.completedAt ?? stage.completed_at ?? null,
        errorCode: stringValue(firstPresent(stage.errorCode, stage.error_code), ''),
        receipt: stage.receipt,
      };
    }),
    resumePoint: stringValue(firstPresent(source.resumePoint, source.resume_point, source.restart_from), ''),
    evidence: Array.isArray(evidence) ? evidence : [],
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    completion: {
      state: normalizeStatus(firstPresent(completion.state, completion.status, source.completion_state)),
      criteria: Array.isArray(completion.criteria) ? completion.criteria : [],
      reason: stringValue(firstPresent(completion.reason, completion.error), ''),
    },
    pendingApproval: normalizeApprovalTarget(source.pendingApproval ?? source.pending_approval, integerValue(source.contractVersion ?? source.contract_version, null)),
    startedAt: source.startedAt ?? source.started_at ?? source.createdAt ?? source.created_at ?? null,
    updatedAt: source.updatedAt ?? source.updated_at ?? null,
  };
}

function safeTestStatus(value, contract) {
  const run = normalizeRun(value);
  const current = objectValue(contract);
  const resultState = completionState(value);
  if (resultState === 'unexecuted') return 'unexecuted';
  if (resultState === 'failed') return 'failed';
  if (resultState !== 'completed_verified') return 'completion_unverified';
  if (run.mode !== 'safe_test' || !run.contractId || run.contractId !== current.contractId) return 'unknown';
  const { configHash, currentConfigHash, retestRequired, retestReason } = run.safeTest;
  if (retestReason === 'configuration_snapshot_missing') return 'configuration_snapshot_missing';
  if (retestRequired || (configHash && currentConfigHash && configHash !== currentConfigHash)) return 'stale';
  if (!configHash || !currentConfigHash) return 'configuration_snapshot_missing';
  return configHash === currentConfigHash ? 'verified' : 'stale';
}

export function normalizeRuns(payload) {
  const records = collectionFrom(payload, ['runs', 'items', 'records']);
  if (!records) return { state: 'unknown', records: [], raw: payload };
  return { state: records.length ? 'ready' : 'empty', records: records.map(normalizeRun), raw: payload };
}

export function completionState(value) {
  const source = objectValue(value);
  const run = objectValue(source.run ?? source.testRun ?? source);
  const state = normalizeStatus(firstPresent(source.completion_state, source.completionState, run.completion_state, run.completionState, run.status, source.status));
  const executed = source.executed === true || source.execution_state === 'executed' || Boolean(firstPresent(source.run_id, source.runId, run.id, run.run_id))
    || ['queued', 'running', 'waiting_approval', 'failed', 'stopped', 'completion_unverified', 'completed_verified'].includes(state);
  const verified = source.completion_verified === true || source.completionVerified === true
    || state === 'completed_verified' || objectValue(source.completion).state === 'verified' || objectValue(run.completion).state === 'verified';
  if (!executed) return 'unexecuted';
  if (verified) return 'completed_verified';
  return state === 'failed' ? 'failed' : state === 'stopped' ? 'stopped' : 'completion_unverified';
}

function criterionLines(criteria) {
  return (Array.isArray(criteria) ? criteria : []).map((criterion) => {
    const value = normalizeCriterion(criterion);
    const expected = value.expected === undefined ? '' : `\t${String(value.expected)}`;
    return `${value.id}\t${value.description}\t${value.kind}${expected}`;
  }).join('\n');
}

function parseReferenceLines(value) {
  return stringValue(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id, version = ''] = line.split(/\s*(?:@|\t|\|)\s*/, 2);
    return { id: id.trim(), version: version.trim() || null };
  });
}

function parseCriteriaLines(value) {
  const text = stringValue(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(normalizeCriterion);
  } catch {
    // The line format keeps the form usable for people who do not want to edit JSON.
  }
  return text.split(/\r?\n/).map((line, index) => {
    const [id, description, kind = 'content_includes', expected = ''] = line.split(/\s*(?:\t|\|)\s*/);
    return normalizeCriterion({ id: id?.trim() || `criterion-${index + 1}`, description: description?.trim() || line.trim(), kind: kind?.trim() || 'content_includes', expected: expected?.trim() || undefined }, index);
  });
}

function contractDraftFromForm(fields) {
  const criterionText = fields.completionCriteria.value;
  const body = {
    outcome: fields.outcome.value,
    scope: fields.scope.value,
    inputRefs: parseReferenceLines(fields.inputRefs.value),
    knowledgeRefs: parseReferenceLines(fields.knowledgeRefs.value),
    judgmentRefs: parseReferenceLines(fields.judgmentRefs.value),
    artifactDestination: {
      adapterId: fields.adapterId.value,
      location: fields.location.value,
      environment: fields.environment.value,
    },
    completionCriteria: parseCriteriaLines(criterionText),
    owner: { actorId: fields.ownerActorId.value },
    trigger: { type: 'manual' },
    limits: {
      maxAttempts: Number(fields.maxAttempts.value),
      timeoutMs: Number(fields.timeoutMs.value),
      budgetUnits: Number(fields.budgetUnits.value),
    },
  };
  return body;
}

function createElement(document, tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === null) continue;
    element.setAttribute(name, String(value));
  }
  return element;
}

function clearElement(element) {
  if (!element) return;
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else if (Array.isArray(element.children)) element.children.length = 0;
}

function listen(element, type, handler) {
  if (element && typeof element.addEventListener === 'function') element.addEventListener(type, handler);
}

function focusElement(element) {
  if (element && typeof element.focus === 'function') element.focus();
}

function button(document, text, handler, options = {}) {
  const item = createElement(document, 'button', {
    className: options.className ?? 'outcome-mana-button',
    text,
    attrs: { type: 'button', ...(options.attrs ?? {}) },
  });
  if (options.disabled) item.disabled = true;
  listen(item, 'click', (event) => { event?.preventDefault?.(); handler?.(item, event); });
  return item;
}

function group(document, tag, options = {}, children = []) {
  const element = createElement(document, tag, options);
  element.append(...children.filter(Boolean));
  return element;
}

function connectorIdentity(document, connector, options = {}) {
  const identity = createElement(document, options.tag ?? 'span', {
    className: `outcome-mana-connector-identity outcome-mana-connector-${connector.id}${options.large ? ' is-large' : ''}`,
    attrs: options.attrs,
  });
  identity.append(
    group(document, 'span', { className: 'outcome-mana-connector-icon-frame', attrs: { 'aria-hidden': 'true' } }, [
      createElement(document, 'img', {
        className: 'outcome-mana-connector-icon',
        attrs: { src: connector.icon, alt: '', width: options.large ? '24' : '20', height: options.large ? '24' : '20' },
      }),
    ]),
    group(document, 'span', { className: 'outcome-mana-connector-copy' }, [
      createElement(document, options.large ? 'h3' : 'strong', { text: connector.label }),
      options.large ? createElement(document, 'small', { text: connector.description }) : null,
    ]),
  );
  return identity;
}

function statusBadge(document, status, label = statusLabel(status)) {
  const normalized = normalizeStatus(status) ?? 'unknown';
  return createElement(document, 'span', {
    className: `outcome-mana-badge outcome-mana-badge-${normalized}`,
    text: label,
    attrs: { 'data-state': normalized },
  });
}

function stateMessage(document, status, options = {}) {
  const state = status ?? 'unknown';
  if (state === 'loading') {
    const item = createElement(document, 'div', { className: 'outcome-mana-state outcome-mana-loading', attrs: { role: 'status', 'aria-live': 'polite' } });
    item.append(createElement(document, 'span', { className: 'outcome-mana-skeleton', attrs: { 'aria-hidden': 'true' } }), createElement(document, 'span', { text: options.loadingText ?? '読み込んでいます…' }));
    return item;
  }
  if (state === 'empty') {
    const item = createElement(document, 'div', { className: 'outcome-mana-state outcome-mana-empty', attrs: { role: 'status' } });
    item.append(createElement(document, 'strong', { text: options.emptyTitle ?? '登録された内容はありません' }), createElement(document, 'p', { text: options.emptyText ?? 'ここから登録できます。' }));
    return item;
  }
  if (state === 'permission_denied') {
    const item = createElement(document, 'div', { className: 'outcome-mana-state outcome-mana-permission', attrs: { role: 'alert' } });
    item.append(createElement(document, 'strong', { text: '権限がありません' }), createElement(document, 'p', { text: options.permissionText ?? 'このプロジェクトの委任設定を確認する権限がありません。現在の権限を確認してください。' }));
    return item;
  }
  if (state === 'error_retryable' || state === 'conflict' || state === 'unknown') {
    const item = createElement(document, 'div', { className: `outcome-mana-state outcome-mana-error outcome-mana-error-${state}`, attrs: { role: 'alert' } });
    item.append(createElement(document, 'strong', { text: state === 'unknown' ? '状態を確認できません' : state === 'conflict' ? '別の更新を確認しました' : '読み込みを確認できません' }));
    if (options.message) item.append(createElement(document, 'p', { text: options.message }));
    if (options.retry) item.append(button(document, '再試行', options.retry, { className: 'outcome-mana-button outcome-mana-button-secondary' }));
    return item;
  }
  return null;
}

function definitionList(document, entries) {
  const list = createElement(document, 'dl', { className: 'outcome-mana-definition' });
  for (const [term, value] of entries) {
    list.append(createElement(document, 'dt', { text: term }), createElement(document, 'dd', { text: present(value) }));
  }
  return list;
}

function field(document, labelText, type, name, value, options = {}) {
  const label = createElement(document, 'label', { className: 'outcome-mana-field' });
  label.append(createElement(document, 'span', { className: 'outcome-mana-label', text: labelText }));
  const input = createElement(document, type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', {
    className: 'outcome-mana-input',
    attrs: { name, id: options.id ?? `outcome-mana-${name}`, ...(options.attrs ?? {}) },
  });
  if (type === 'select') {
    for (const option of options.options ?? []) input.append(createElement(document, 'option', { text: option.label, attrs: { value: option.value } }));
  }
  if (type === 'textarea') input.textContent = stringValue(value);
  else input.value = stringValue(value);
  if (options.helper) label.append(input, createElement(document, 'small', { className: 'outcome-mana-helper', text: options.helper }));
  else label.append(input);
  return { label, input };
}

function textOf(value) {
  if (value === null || value === undefined) return UNKNOWN;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const id = firstPresent(value.label, value.name, value.title, value.identifier, value.url, value.id);
    if (id) return value.version ? `${id} @ ${value.version}` : id;
  }
  try { return JSON.stringify(value, null, 2); } catch { return UNKNOWN; }
}

function evidenceList(document, title, values) {
  const section = createElement(document, 'div', { className: 'outcome-mana-evidence' });
  section.append(createElement(document, 'h4', { text: title }));
  if (!Array.isArray(values) || !values.length) {
    section.append(createElement(document, 'p', { className: 'outcome-mana-muted', text: UNKNOWN }));
    return section;
  }
  const list = createElement(document, 'ul');
  values.forEach((value) => list.append(createElement(document, 'li', { text: textOf(value) })));
  section.append(list);
  return section;
}

function stageList(document, stages) {
  const section = createElement(document, 'div', { className: 'outcome-mana-evidence' });
  section.append(createElement(document, 'h4', { text: '処理段階' }));
  if (!Array.isArray(stages) || !stages.length) {
    section.append(createElement(document, 'p', { className: 'outcome-mana-muted', text: UNKNOWN }));
    return section;
  }
  const rows = stages.map((stage) => {
    const details = [statusLabel(stage.status)];
    if (stage.attempt !== null) details.push(`試行 ${stage.attempt}`);
    if (stage.errorCode) details.push(`エラー: ${stage.errorCode}`);
    return [`${STAGE_LABELS[stage.id] ?? stage.id} (${stage.id || UNKNOWN})`, details.join(' / ')];
  });
  section.append(definitionList(document, rows));
  return section;
}

function sectionHeading(document, title, status, description, id) {
  const head = createElement(document, 'div', { className: 'outcome-mana-section-heading' });
  const copy = createElement(document, 'div');
  copy.append(createElement(document, 'h2', { text: title, attrs: id ? { id } : {} }), createElement(document, 'p', { className: 'outcome-mana-section-description', text: description }));
  head.append(copy);
  if (status) head.append(statusBadge(document, status));
  return head;
}

function defaultPathMap(basePath, projectCode) {
  const root = String(basePath || '/api/outcome-delegations').replace(/\/$/, '');
  const query = projectCode ? `?project_code=${encodeURIComponent(projectCode)}` : '';
  return {
    settings: `${root}/settings${query}`,
    contractList: `${root}${query}`,
    triggerCatalog: (type) => {
      const search = new URLSearchParams(projectCode ? { project_code: projectCode } : {});
      if (type) search.set('type', type);
      return `${root}/triggers${search.size ? `?${search}` : ''}`;
    },
    contractDetail: (contractId) => `${root}/${encodeURIComponent(contractId)}${query}`,
    contractClone: (contractId) => `${root}/${encodeURIComponent(contractId)}/clone${query}`,
    contractRetire: (contractId) => `${root}/${encodeURIComponent(contractId)}/retire${query}`,
    authority: (contractId, params = {}) => {
      const search = new URLSearchParams(projectCode ? { project_code: projectCode } : {});
      if (Number.isInteger(params.contractVersion)) search.set('contractVersion', String(params.contractVersion));
      return `${root}/${encodeURIComponent(contractId)}/authority${search.size ? `?${search}` : ''}`;
    },
    triggers: (contractId) => `${root}/${encodeURIComponent(contractId)}/triggers${query}`,
    tests: (contractId) => `${root}/${encodeURIComponent(contractId)}/tests${query}`,
    activation: (contractId) => `${root}/${encodeURIComponent(contractId)}/activation${query}`,
    runList: (contractId) => `${root}/${encodeURIComponent(contractId)}/runs${query}`,
    runDetail: (runId) => `${root}/runs/${encodeURIComponent(runId)}${query}`,
    decisions: (runId) => `${root}/runs/${encodeURIComponent(runId)}/decisions${query}`,
    resume: (runId) => `${root}/runs/${encodeURIComponent(runId)}/resume${query}`,
    runStop: (runId) => `${root}/runs/${encodeURIComponent(runId)}/stop${query}`,
  };
}

export function createManaPaths(options = {}) {
  return defaultPathMap(options.basePath ?? '/api/outcome-delegations', options.projectCode ?? options.project_code ?? null);
}

function resolvePath(pathMap, name, params) {
  const value = pathMap[name];
  return typeof value === 'function' ? value(params?.id ?? params?.contractId ?? params?.runId, params) : value;
}

function canManage(session) {
  const permission = normalizeStatus(session.outcomePermission);
  if (['deny', 'denied', 'false', 'none'].includes(permission) || session.outcomePermission === false) return false;
  return true;
}

function contractFormValues(contract, draft) {
  const source = draft ?? contract ?? normalizeContract({});
  return {
    outcome: source.outcome ?? '',
    scope: source.scope ?? '',
    inputRefs: (source.inputRefs ?? []).map((item) => `${item.id}${item.version ? `@${item.version}` : ''}`).join('\n'),
    knowledgeRefs: (source.knowledgeRefs ?? []).map((item) => `${item.id}${item.version ? `@${item.version}` : ''}`).join('\n'),
    judgmentRefs: (source.judgmentRefs ?? []).map((item) => `${item.id}${item.version ? `@${item.version}` : ''}`).join('\n'),
    adapterId: source.artifactDestination?.adapterId ?? '',
    location: source.artifactDestination?.location ?? '',
    environment: source.artifactDestination?.environment ?? 'isolated',
    completionCriteria: criterionLines(source.completionCriteria),
    ownerActorId: source.owner?.actorId ?? '',
    maxAttempts: source.limits?.maxAttempts ?? '',
    timeoutMs: source.limits?.timeoutMs ?? '',
    budgetUnits: source.limits?.budgetUnits ?? '',
  };
}

function contractInput(contract, overrides = {}) {
  return {
    outcome: contract.outcome,
    scope: contract.scope,
    inputRefs: contract.inputRefs,
    knowledgeRefs: contract.knowledgeRefs,
    judgmentRefs: contract.judgmentRefs,
    artifactDestination: contract.artifactDestination,
    completionCriteria: contract.completionCriteria,
    owner: contract.owner,
    trigger: contract.trigger?.type ? {
      type: contract.trigger.type,
      ...(contract.trigger.type === 'schedule' ? { scheduleId: contract.trigger.scheduleId } : {}),
      ...(contract.trigger.type === 'document' ? { subscriptionId: contract.trigger.subscriptionId, provider: contract.trigger.provider } : {}),
    } : { type: 'manual' },
    limits: contract.limits,
    ...overrides,
  };
}

function triggerFromContract(contract, draft) {
  return normalizeTrigger(draft?.trigger ?? contract?.trigger);
}

export function createManaOutcomeUI(options = {}) {
  const document = options.document ?? globalThis.document;
  if (!document) throw new Error('outcome_mana_document_unavailable');
  const root = options.root ?? options.container ?? null;
  const api = options.api;
  const apiMutation = options.apiMutation;
  const paths = options.paths ?? {};
  const pathBuilder = typeof options.pathFor === 'function' ? options.pathFor : null;
  const projectInput = options.project;
  const sessionInput = options.session;
  const state = {
    // null means no user choice has been made yet. render() derives a useful
    // first step from the state so existing deep links/readbacks land on the
    // relevant workspace; clicks then remain the source of truth.
    activeView: null,
    delegationTab: 'settings',
    activeStage: null,
    contract: { status: 'loading', records: [], selectedId: null, detail: null, error: null, formDraft: null, pendingSave: null },
    authority: { status: 'idle', matrix: [], raw: null, error: null, draft: null },
    triggers: { status: 'idle', trigger: null, error: null, draft: null, catalogStatus: 'idle', schedules: [], subscriptions: [], catalogError: null },
    safeTest: { status: 'idle', result: null, error: null, formDraft: null },
    activation: { status: 'idle', error: null, message: '' },
    runs: { status: 'idle', records: [], selectedId: null, detail: null, error: null },
    runAction: { status: 'idle', error: null, draft: null },
    connections: { status: 'unknown', records: [], selectedId: null, detail: null, error: null },
    manaSettings: { status: 'unknown', data: null, error: null, draft: null, saveStatus: 'idle', saveError: null },
  };

  const viewIds = new Set([...MANA_VIEWS.map((view) => view.id), 'delegation_settings']);

  function stageStatus(id) {
    if (id === 'contract') return state.contract.status;
    if (id === 'authority') return state.authority.status;
    if (id === 'triggers') {
      if (state.triggers.status !== 'idle') return state.triggers.status;
      if (state.triggers.catalogStatus !== 'idle') return state.triggers.catalogStatus;
      return currentContract()?.status ?? 'idle';
    }
    if (id === 'safe_test') {
      if (state.safeTest.status === 'loading') return 'loading';
      return state.safeTest.result ? safeTestStatus(state.safeTest.result, currentContract()) : state.safeTest.status;
    }
    if (id === 'runs') return state.runs.status;
    return 'unknown';
  }

  function derivedActiveStage() {
    if (state.activeStage && WORKFLOW_STAGES.some((stage) => stage.id === state.activeStage)) return state.activeStage;
    if (state.triggers.status !== 'idle' || state.triggers.catalogStatus !== 'idle') return 'triggers';
    // The trigger workspace is where the final activation gates are shown.
    // Keep it as the landing step when a caller has already loaded the two
    // prerequisites but has not clicked a stage yet.
    if (state.authority.status !== 'idle' && state.safeTest.status !== 'idle') return 'triggers';
    if (state.runs.status !== 'idle') return 'runs';
    if (state.safeTest.status !== 'idle') return 'safe_test';
    if (state.authority.status !== 'idle') return 'authority';
    return 'contract';
  }

  function setActiveStage(id) {
    if (WORKFLOW_STAGES.some((stage) => stage.id === id)) {
      state.activeStage = id;
      state.delegationTab = 'settings';
      // The five existing workflow stages are the detail workspace.  Keeping
      // this transition here preserves deep links and existing callers while
      // the top-level navigation remains focused on the five new surfaces.
      // Runs also has a top-level operational view. Keep that view selected
      // while it refreshes or opens a run; explicit workflow-stage navigation
      // still enters the delegation detail workspace.
      if (!(id === 'runs' && state.activeView === 'runs')) state.activeView = 'delegation_settings';
    }
  }

  function setActiveView(id) {
    if (viewIds.has(id)) state.activeView = id;
    return state.activeView;
  }

  function derivedActiveView() {
    if (state.activeView && viewIds.has(state.activeView)) return state.activeView;
    // A detail-only readback is the existing deep-link shape.  Render it in
    // the settings workspace until the user explicitly returns to overview.
    if (state.contract.detail && !state.contract.records.length) return 'delegation_settings';
    return 'overview';
  }

  function currentProject() { return projectValue(projectInput); }
  function currentSession() { return sessionValue(sessionInput); }
  function currentContract() {
    return state.contract.detail ?? state.contract.records.find((record) => record.contractId === state.contract.selectedId) ?? null;
  }
  function contractId() { return currentContract()?.contractId || null; }
  function currentPaths() {
    const generated = defaultPathMap(options.basePath ?? '/api/outcome-delegations', currentProject().code);
    return { ...generated, ...paths };
  }
  function path(name, params = {}) {
    const context = { ...params, projectCode: currentProject().code, project: currentProject() };
    if (pathBuilder) return pathBuilder(name, context);
    return resolvePath(currentPaths(), name, context);
  }

  function connectorSource(project, id) {
    const foundations = objectValue(project.foundation_values);
    const resources = objectValue(project.resources);
    const aliases = {
      brainbase: ['brainbase', 'knowledge'],
      drive: ['drive', 'google_drive', 'googleDrive'],
      github: ['github', 'gitHub'],
      slack: ['slack'],
      mana: ['mana', 'mana_runtime', 'manaRuntime'],
    };
    for (const key of aliases[id] ?? [id]) {
      if (hasOwn(foundations, key)) return foundations[key];
      if (hasOwn(resources, key)) return resources[key];
      if (hasOwn(project, key)) return project[key];
    }
    return null;
  }

  function connectorRecordsFromProject() {
    const project = currentProject();
    return CONNECTOR_DEFINITIONS.map((definition) => {
      const source = connectorSource(project, definition.id);
      // GitHub foundations can be an array of repositories.  Keep every item
      // as a permitted resource while leaving the connection state unknown.
      const value = Array.isArray(source)
        ? { resources: source }
        : (source !== null && source !== undefined && typeof source !== 'object' ? { account: source } : source);
      const normalized = normalizeConnector(value, definition.id);
      return {
        ...normalized,
        label: definition.label,
        description: definition.description,
        source,
      };
    });
  }

  function connectionStatusLabel(status) {
    const normalized = normalizeStatus(status);
    if (['connected', 'verified', 'readback_verified'].includes(normalized)) return '接続確認済み';
    if (['active', 'enabled', 'ready', 'available'].includes(normalized)) return '利用可能';
    if (['failed', 'error', 'unavailable'].includes(normalized)) return '確認失敗';
    if (['unregistered', 'not_registered'].includes(normalized)) return '未登録';
    if (['unconfigured', 'misconfigured'].includes(normalized)) return '確認設定なし';
    if (['permission_denied', 'forbidden', 'unauthorized'].includes(normalized)) return '権限不足';
    if (['timeout', 'timed_out'].includes(normalized)) return 'タイムアウト';
    if (['rejected', 'unconfirmed', 'readback_mismatch'].includes(normalized)) return '確認できません';
    return UNKNOWN;
  }

  function connectionReasonLabel(reason) {
    const value = stringValue(reason).trim();
    const normalized = normalizeStatus(value);
    const labels = {
      connection_unregistered: '接続先が登録されていません',
      foundation_provider_check_unconfigured: '接続確認の設定が不足しています',
      foundation_provider_check_url_missing: '接続確認先のURLが設定されていません',
      provider_check_url_missing: '接続確認先のURLが設定されていません',
      foundation_provider_check_token_missing: '接続確認用の認証情報が設定されていません',
      provider_credentials_missing: '接続確認用の認証情報が設定されていません',
      provider_credentials_unavailable: '接続確認用の認証情報を読み取れません',
      provider_credentials_invalid: '接続確認用の認証情報が不正です',
      provider_permission_denied: '認証または権限が不足しています',
      permission_denied: '認証または権限が不足しています',
      provider_timeout: '接続先が時間内に応答しませんでした',
      upstream_timeout: '接続先が時間内に応答しませんでした',
      provider_request_failed: '接続先へ到達できませんでした',
      upstream_unavailable: '接続先へ到達できませんでした',
      provider_rejected: '接続先が確認要求を拒否しました',
      provider_readback_mismatch: '登録内容と確認結果が一致しません',
      local_preview_only: 'ローカルプレビューでは実接続を確認できません',
    };
    return labels[normalized] ?? (value || UNKNOWN);
  }

  function resourceLabel(value) {
    const source = objectValue(value);
    return firstPresent(source.label, source.name, source.title, source.identifier, source.url, source.id) ?? textOf(value);
  }

  function permittedResources(contract) {
    const source = objectValue(contract);
    const raw = source.allowedResources ?? source.allowed_resources ?? source.resources ?? source.scopeResources ?? source.scope_resources;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.entries(raw).flatMap(([kind, items]) => (Array.isArray(items) ? items : [items]).map((item) => ({ kind, value: item })));
    const refs = [source.inputRefs, source.knowledgeRefs, source.judgmentRefs].flatMap((items) => Array.isArray(items) ? items : []);
    return refs;
  }

  function normalizeConnectorPayload(payload) {
    const records = collectionFrom(payload, ['connectors', 'connections', 'items', 'records']);
    if (!records) return { state: 'unknown', records: [], raw: payload };
    return { state: records.length ? 'ready' : 'empty', records: records.map((item) => normalizeConnector(item)), raw: payload };
  }

  function connectorFromFoundationCheck(definition, payload, error, attemptedAt) {
    const source = objectValue(payload ?? error?.payload);
    const verification = objectValue(source.verification);
    const registered = connectorRecordsFromProject().find((item) => item.id === definition.id) ?? {};
    const status = firstPresent(source.status, verification.state, error?.status === 403 ? 'permission_denied' : null, error ? 'failed' : null);
    const reason = firstPresent(verification.reason, source.reason, source.error?.code, source.error, error?.message);
    const resources = Array.isArray(source.resources) ? source.resources : registered.resources;
    return normalizeConnector({
      ...registered,
      id: definition.id,
      label: definition.label,
      description: definition.description,
      status,
      account: firstPresent(source.account, source.identifier, registered.account),
      resources,
      checkedAt: firstPresent(verification.checked_at, verification.checkedAt, source.checked_at, source.checkedAt, attemptedAt),
      reason,
    }, definition.id);
  }

  async function checkConnections() {
    const attemptedAt = new Date().toISOString();
    return Promise.all(CONNECTOR_DEFINITIONS.map(async (definition) => {
      const kind = CONNECTOR_FOUNDATION_KINDS[definition.id];
      const target = path('foundationCheck', { kind });
      if (!target || typeof apiMutation !== 'function') return connectorFromFoundationCheck(definition, {}, null, null);
      try {
        const payload = await apiMutation(target, {
          method: 'POST',
          key: `mana-foundation-${kind}-check-${attemptedAt}`,
          body: {},
        });
        return connectorFromFoundationCheck(definition, payload, null, attemptedAt);
      } catch (error) {
        return connectorFromFoundationCheck(definition, null, error, attemptedAt);
      }
    }));
  }

  async function loadConnections() {
    const checkTarget = path('foundationCheck', { kind: 'github' });
    const target = path('connectors') ?? path('connections');
    state.connections.status = 'loading'; state.connections.error = null; render();
    try {
      if (checkTarget && typeof apiMutation === 'function') {
        const records = await checkConnections();
        state.connections = { ...state.connections, status: 'ready', records, error: null };
      } else if (!target) {
        const records = projectConnectors();
        state.connections = { ...state.connections, status: records.some((item) => item.source !== null && item.source !== undefined) ? 'ready' : 'unknown', records, error: null };
      } else {
        const normalized = normalizeConnectorPayload(await callApi(target));
        state.connections = { ...state.connections, ...normalized, status: normalized.state, error: null };
      }
      if (!state.connections.selectedId && state.connections.records.length) state.connections.selectedId = state.connections.records[0].id;
      state.connections.detail = state.connections.records.find((item) => item.id === state.connections.selectedId) ?? null;
    } catch (error) { setError(state.connections, error); }
    render(); notifyChange(); return state.connections;
  }

  async function loadManaSettings() {
    const target = path('settings') ?? path('manaSettings');
    const mana = objectValue(currentProject().mana);
    const projected = objectValue(firstPresent(
      currentProject().manaSettings,
      currentProject().mana_settings,
      mana.settings,
      mana.runtimeSettings,
      mana.runtime_settings,
    ));
    if (!target) {
      state.manaSettings = { ...state.manaSettings, status: Object.keys(projected).length ? 'ready' : 'unknown', data: Object.keys(projected).length ? projected : null, error: null };
      render(); notifyChange(); return state.manaSettings;
    }
    state.manaSettings.status = 'loading'; state.manaSettings.error = null; render();
    try {
      const payload = await callApi(target);
      const data = objectValue(payload.settings ?? payload.manaSettings ?? payload);
      state.manaSettings = { ...state.manaSettings, status: Object.keys(data).length ? 'ready' : 'unknown', data: Object.keys(data).length ? data : null, error: null };
    } catch (error) { setError(state.manaSettings, error); }
    render(); notifyChange(); return state.manaSettings;
  }

  function settingsSaveTarget() {
    // The read endpoint is intentionally not reused for writes.  Hosts must
    // opt into a write route explicitly so an editable form cannot mutate a
    // runtime setting by accident.
    if (!hasOwn(paths, 'settingsSave') && !pathBuilder) return null;
    return path('settingsSave');
  }

  function settingSection(data, camelKey, snakeKey) {
    return objectValue(firstPresent(data[camelKey], data[snakeKey]));
  }

  function settingValue(section, ...keys) {
    return firstPresent(...keys.map((key) => section[key])) ?? '';
  }

  function scalarSettingValue(value) {
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const nestedKeys = ['maxAttempts', 'max_attempts', 'max', 'limit', 'count', 'value'];
    const nestedKey = nestedKeys.find((key) => hasOwn(value, key));
    return nestedKey ? scalarSettingValue(value[nestedKey]) : '';
  }

  function updateAttemptSetting(current, nextValue) {
    if (current === undefined) return nextValue;
    if (typeof current === 'string' || typeof current === 'number') return nextValue;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    const nestedKeys = ['maxAttempts', 'max_attempts', 'max', 'limit', 'count', 'value'];
    const nestedKey = nestedKeys.find((key) => hasOwn(current, key));
    if (!nestedKey) return current;
    return { ...current, [nestedKey]: updateAttemptSetting(current[nestedKey], nextValue) };
  }

  function settingsDraftFromFields(data, controls) {
    const source = objectValue(data);
    const draft = JSON.parse(JSON.stringify(source));
    const defaultsKey = hasOwn(source, 'runtime_defaults') ? 'runtime_defaults' : hasOwn(source, 'runtimeDefaults') ? 'runtimeDefaults' : 'defaults';
    const safetyKey = hasOwn(source, 'safety_limits') ? 'safety_limits' : hasOwn(source, 'safetyLimits') ? 'safetyLimits' : 'safety_limits';
    const notificationKey = hasOwn(source, 'notifications') ? 'notifications' : 'notifications';
    const auditKey = hasOwn(source, 'audit') ? 'audit' : 'audit';
    const defaults = objectValue(source[defaultsKey]);
    const safety = objectValue(source[safetyKey]);
    const attemptKeys = ['maxAttempts', 'max_attempts', 'attempts'];
    const safetyAttemptKey = attemptKeys.find((key) => hasOwn(safety, key));
    const defaultsAttemptKey = attemptKeys.find((key) => hasOwn(defaults, key));
    const attemptsSectionKey = safetyAttemptKey ? safetyKey : defaultsAttemptKey ? defaultsKey : safetyKey;
    const attemptsPropertyKey = safetyAttemptKey ?? defaultsAttemptKey ?? (attemptsSectionKey === safetyKey ? 'attempts' : 'maxAttempts');
    draft[defaultsKey] = { ...defaults, timeout: controls.timeout.value, timeoutMs: controls.timeoutMs.value, budgetUnits: controls.budgetUnits.value };
    if (attemptsSectionKey === defaultsKey) draft[defaultsKey][attemptsPropertyKey] = updateAttemptSetting(defaults[attemptsPropertyKey], controls.maxAttempts.value);
    if (attemptsSectionKey === safetyKey) draft[safetyKey] = { ...safety, [attemptsPropertyKey]: updateAttemptSetting(safety[attemptsPropertyKey], controls.maxAttempts.value) };
    draft[safetyKey] = { ...objectValue(draft[safetyKey] ?? safety), safeTestRequired: controls.safeTestRequired.checked, externalEffectApproval: controls.externalEffectApproval.checked };
    draft[notificationKey] = { ...objectValue(source[notificationKey]), channel: controls.channel.value, events: controls.events.value };
    draft[auditKey] = { ...objectValue(source[auditKey]), retention: controls.retention.value, destination: controls.auditDestination.value };
    return draft;
  }

  async function saveManaSettings(draft) {
    const target = settingsSaveTarget();
    state.manaSettings.saveError = null;
    if (state.manaSettings.status !== 'ready' || !target) {
      state.manaSettings.draft = null;
      state.manaSettings.saveStatus = 'unknown';
      render(); notifyChange();
      return state.manaSettings;
    }
    state.manaSettings.draft = objectValue(draft);
    state.manaSettings.saveStatus = 'saving';
    render();
    try {
      const payload = await callMutation(target, { method: 'PUT', body: { settings: state.manaSettings.draft }, key: idempotencyKey('mana-settings-save') });
      const readback = objectValue(payload?.settings ?? payload?.manaSettings ?? payload);
      if (Object.keys(readback).length) {
        state.manaSettings = { ...state.manaSettings, status: 'ready', data: readback, draft: null, saveStatus: 'ready', saveError: null, error: null };
      } else {
        state.manaSettings.saveStatus = 'saved_unverified';
      }
    } catch (error) {
      state.manaSettings.saveStatus = 'error_retryable';
      state.manaSettings.saveError = normalizeError(error);
    }
    render(); notifyChange(); return state.manaSettings;
  }

  async function callApi(target, request = {}) {
    if (typeof api !== 'function') throw new Error('outcome_mana_api_unavailable');
    return api(target, { method: 'GET', headers: { accept: 'application/json' }, ...request });
  }
  async function callMutation(target, request = {}) {
    if (typeof apiMutation !== 'function') throw new Error('outcome_mana_api_mutation_unavailable');
    const method = request.method ?? 'POST';
    const key = request.key ?? idempotencyKey('mana-outcome');
    return apiMutation(target, { method, key, body: request.body ?? {} });
  }

  function notifyChange() { if (typeof options.onChange === 'function') options.onChange(state); }
  function setError(target, error) {
    target.error = normalizeError(error);
    target.status = target.error.kind;
  }
  function confirmAction(message) {
    if (typeof options.confirm === 'function') return options.confirm(message);
    if (typeof globalThis.confirm === 'function') return globalThis.confirm(message);
    return true;
  }

  async function loadContracts() {
    state.contract.status = 'loading'; state.contract.error = null; render();
    try {
      const payload = await callApi(path('contractList'));
      const normalized = normalizeContracts(payload);
      state.contract = { ...state.contract, ...normalized, status: normalized.state, error: null };
      if (state.contract.records.length && !state.contract.records.some((record) => record.contractId === state.contract.selectedId)) state.contract.selectedId = state.contract.records[0].contractId;
      if (state.contract.selectedId) await loadContractDetail(state.contract.selectedId, { renderAfter: false });
    } catch (error) {
      setError(state.contract, error);
    }
    render(); notifyChange();
    return state.contract;
  }

  async function loadContractDetail(id = contractId(), { renderAfter = true } = {}) {
    if (!id) return null;
    state.contract.status = 'loading'; state.contract.error = null;
    if (renderAfter) render();
    try {
      const payload = await callApi(path('contractDetail', { contractId: id }));
      const contract = normalizeContract(payload);
      state.contract.detail = contract.contractId ? contract : { ...contract, contractId: id };
      state.contract.selectedId = id;
      state.contract.status = 'ready';
      const authorityPayload = objectValue(payload).authority ?? objectValue(payload).authorityMatrix;
      if (authorityPayload !== undefined) state.authority = { ...normalizeAuthority(authorityPayload), error: null };
      const triggerPayload = objectValue(payload).trigger ?? objectValue(payload).triggers;
      if (triggerPayload !== undefined) state.triggers = { ...state.triggers, status: 'ready', trigger: normalizeTrigger(triggerPayload), error: null, draft: null };
      await loadTriggerCatalog(state.contract.detail.trigger?.type ?? 'manual', { renderAfter: false, enterDetail: false });
    } catch (error) {
      setError(state.contract, error);
    }
    if (renderAfter) { render(); notifyChange(); }
    return state.contract.detail;
  }

  async function loadTriggerCatalog(type = triggerFromContract(currentContract(), state.triggers.draft).type, { renderAfter = true, enterDetail = true } = {}) {
    if (enterDetail) setActiveStage('triggers');
    if (type === 'manual') {
      state.triggers.catalogStatus = 'ready'; state.triggers.schedules = []; state.triggers.subscriptions = []; state.triggers.catalogError = null;
      if (renderAfter) { render(); notifyChange(); }
      return state.triggers;
    }
    state.triggers.catalogStatus = 'loading'; state.triggers.catalogError = null;
    if (renderAfter) render();
    try {
      const payload = objectValue(await callApi(path('triggerCatalog', { id: type })));
      state.triggers.schedules = Array.isArray(payload.schedules) ? payload.schedules.filter((item) => item && typeof item === 'object') : [];
      state.triggers.subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions.filter((item) => item && typeof item === 'object') : [];
      state.triggers.catalogStatus = 'ready';
    } catch (error) {
      state.triggers.catalogError = normalizeError(error); state.triggers.catalogStatus = state.triggers.catalogError.kind;
    }
    if (renderAfter) { render(); notifyChange(); }
    return state.triggers;
  }

  function triggerAvailability(trigger) {
    if (trigger.type === 'manual') return { available: true, reason: '' };
    if (state.triggers.catalogStatus !== 'ready') return { available: false, reason: '接続候補を確認できていないため、この起動方式は利用できません。' };
    if (trigger.type === 'schedule') {
      const candidate = state.triggers.schedules.find((item) => item.id === trigger.scheduleId);
      if (!candidate) return { available: false, reason: '一致する定期実行の接続が見つからないため、定期実行は利用できません。' };
      if (!candidate.connected) return { available: false, reason: '定期実行の接続を確認できないため、定期実行は利用できません。' };
      if (!candidate.enabled) return { available: false, reason: '定期実行の接続が無効なため、定期実行は利用できません。' };
      return { available: true, reason: '' };
    }
    const candidate = state.triggers.subscriptions.find((item) => item.id === trigger.subscriptionId && item.provider === trigger.provider);
    const provider = trigger.provider ? `${trigger.provider === 'docusign' ? 'DocuSign' : trigger.provider}の` : '';
    if (!candidate) return { available: false, reason: `${provider}購読接続が見つからないため、文書追加は利用できません。` };
    if (!candidate.connected) return { available: false, reason: `${provider}購読接続を確認できないため、文書追加は利用できません。` };
    if (!candidate.enabled) return { available: false, reason: `${provider}購読接続が無効なため、文書追加は利用できません。` };
    if (candidate.available !== true) {
      const reasons = {
        document_event_authenticator_missing: `${provider}文書イベントの署名検証が未接続のため、文書追加は利用できません。`,
        document_subscription_unsubscriber_missing: `${provider}購読解除処理が未接続のため、文書追加は利用できません。`,
        document_subscription_scope_mismatch: 'この接続の組織・プロジェクト・実行者が現在の委任と一致しないため利用できません。委任に対応する接続を選択してください。',
        github_document_ingress_credentials_missing: 'GitHubの文書取り込み用Webhook認証情報が未設定のため、文書追加は利用できません。Webhook用認証情報を設定するか、管理者に確認してください。',
        github_document_ingress_configuration_missing: 'GitHubのリポジトリ・参照先・取り込みパス・コールバック先の設定が未設定または不正なため、文書追加は利用できません。リポジトリ、参照先、取り込みパス、コールバック先を確認してください。',
      };
      return { available: false, reason: reasons[candidate.reason] ?? `${provider}外部プロバイダー固有のWebhook接続を確認できないため、文書追加は利用できません。` };
    }
    return { available: true, reason: '' };
  }

  async function verifyContractReadback(id, mutationPayload, expectedStatus = null, expectedFields = null) {
    const applyReadback = (readback) => {
      state.contract.detail = readback;
      state.contract.selectedId = id;
      state.contract.status = 'ready';
      const index = state.contract.records.findIndex((record) => record.contractId === id);
      if (index === -1) state.contract.records = [...state.contract.records, readback];
      else state.contract.records = state.contract.records.map((record, recordIndex) => recordIndex === index ? readback : record);
      return readback;
    };
    const inline = normalizeContract(mutationPayload);
    const expectedVersion = inline.version;
    if (!Number.isInteger(expectedVersion)) return null;
    const expectation = { id, version: expectedVersion, fields: expectedFields, status: expectedStatus };
    if (contractMatchesExpected(inline, expectation) && isReadbackVerified(mutationPayload)) return applyReadback(inline);
    try {
      const payload = await callApi(path('contractDetail', { contractId: id }));
      const readback = normalizeContract(payload);
      if (contractMatchesExpected(readback, expectation)) return applyReadback(readback);
    } catch {
      // A successful write without a readback is intentionally not a verified state.
    }
    return null;
  }

  async function saveContractDraft(draft, { create = false } = {}) {
    const id = contractId();
    const body = objectValue(draft);
    state.contract.formDraft = body;
    state.contract.status = 'saving'; state.contract.error = null; render();
    try {
      const target = create || !id ? path('contractList') : path('contractDetail', { contractId: id });
      const method = create || !id ? 'POST' : 'PATCH';
      const mutationBody = id && !create && Number.isInteger(currentContract()?.version) ? { ...body, expected_version: currentContract().version } : body;
      const fingerprint = `${method}:${target}:${JSON.stringify(mutationBody)}`;
      if (state.contract.pendingSave?.fingerprint !== fingerprint) {
        state.contract.pendingSave = { fingerprint, key: idempotencyKey(create || !id ? 'mana-contract-create' : 'mana-contract-save') };
      }
      const payload = await callMutation(target, {
        method,
        body: mutationBody,
        key: state.contract.pendingSave.key,
      });
      const saved = normalizeContract(payload);
      const savedId = saved.contractId || id;
      state.contract.formDraft = null;
      if (savedId) {
        const readback = await verifyContractReadback(savedId, payload, null, body);
        if (readback) {
          state.contract.detail = readback; state.contract.selectedId = savedId;
          state.contract.records = state.contract.records.some((item) => item.contractId === savedId)
            ? state.contract.records.map((item) => item.contractId === savedId ? readback : item)
            : [readback, ...state.contract.records];
          state.contract.status = 'ready';
          state.contract.pendingSave = null;
          if (state.safeTest.result) await refreshSafeTestReadback();
        } else {
          state.contract.status = 'saved_unverified';
        }
      } else state.contract.status = 'saved_unverified';
    } catch (error) {
      setError(state.contract, error);
    }
    render(); notifyChange(); return state.contract;
  }

  async function cloneContract(id = contractId()) {
    if (!id) return null;
    state.contract.status = 'saving'; render();
    try {
      const payload = await callMutation(path('contractClone', { contractId: id }), { body: {}, key: idempotencyKey('mana-contract-clone') });
      const cloned = normalizeContract(payload);
      const readback = cloned.contractId ? await verifyContractReadback(cloned.contractId, payload, 'draft') : null;
      if (readback) {
        state.contract.records = [readback, ...state.contract.records.filter((item) => item.contractId !== readback.contractId)];
        state.contract.selectedId = readback.contractId; state.contract.detail = readback; state.contract.status = 'ready';
      } else state.contract.status = 'saved_unverified';
    } catch (error) { setError(state.contract, error); }
    render(); notifyChange(); return state.contract;
  }

  async function retireContract(id = contractId()) {
    if (!id || !confirmAction('この委任契約を廃止します。履歴は保持されます。続けますか？')) return null;
    state.contract.status = 'saving'; render();
    try {
      const current = currentContract();
      const payload = await callMutation(path('contractRetire', { contractId: id }), {
        body: Number.isInteger(current?.version) ? { expected_version: current.version } : {}, key: idempotencyKey('mana-contract-retire'),
      });
      const readback = await verifyContractReadback(id, payload, 'retired');
      if (readback) {
        state.contract.detail = readback; state.contract.records = state.contract.records.map((item) => item.contractId === id ? readback : item); state.contract.status = 'ready';
      } else state.contract.status = 'saved_unverified';
    } catch (error) { setError(state.contract, error); }
    render(); notifyChange(); return state.contract;
  }

  async function loadAuthority(id = contractId()) {
    setActiveStage('authority');
    if (!id) { state.authority.status = 'unknown'; render(); return state.authority; }
    state.authority.status = 'loading'; state.authority.error = null; render();
    try {
      const payload = await callApi(path('authority', { contractId: id, contractVersion: currentContract()?.version }));
      state.authority = { ...state.authority, ...normalizeAuthority(payload), error: null };
    } catch (error) { setError(state.authority, error); }
    render(); notifyChange(); return state.authority;
  }

  async function saveAuthority(matrix, id = contractId()) {
    if (!id) return null;
    state.authority.draft = matrix; state.authority.status = 'saving'; state.authority.error = null; render();
    try {
      const current = currentContract();
      const entries = Array.isArray(matrix) ? matrix : [];
      for (const entry of entries) {
        await callMutation(path('authority', { contractId: id }), {
          method: 'PUT', body: { contract_version: current?.version, operation: entry.operation,
            resource: entry.resource ?? entry.target, effect: entry.effect ?? entry.policy },
          key: idempotencyKey(`mana-authority-save-${entry.operation ?? 'rule'}`),
        });
      }
      const payload = await callApi(path('authority', { contractId: id, contractVersion: current?.version }));
      const readback = normalizeAuthority(payload);
      const signature = (entry) => JSON.stringify({
        operation: entry.operation,
        resource: entry.resource ?? entry.target,
        effect: entry.effect ?? entry.policy,
        actor: entry.actorId ?? entry.actor ?? null,
      });
      const expected = entries.map(signature).sort();
      const actual = readback.matrix.map(signature).sort();
      state.authority = { ...state.authority, ...readback, draft: null,
        status: expected.length === actual.length && expected.every((value, index) => value === actual[index]) ? 'ready' : 'saved_unverified', error: null };
    } catch (error) { setError(state.authority, error); }
    render(); notifyChange(); return state.authority;
  }

  async function saveTriggers(trigger, id = contractId()) {
    if (!id) return null;
    state.triggers.draft = normalizeTrigger(trigger); state.triggers.status = 'saving'; state.triggers.error = null; render();
    try {
      const current = currentContract();
      const normalized = normalizeTrigger(trigger);
      const cleanTrigger = normalized.type === 'schedule' ? { type: 'schedule', scheduleId: normalized.scheduleId }
        : normalized.type === 'document' ? { type: 'document', subscriptionId: normalized.subscriptionId, provider: normalized.provider }
          : { type: 'manual' };
      const payload = await callMutation(path('triggers', { contractId: id }), {
        method: 'PUT', body: { contract: contractInput(current, { trigger: cleanTrigger }), ...(Number.isInteger(current?.version) ? { expected_version: current.version } : {}) }, key: idempotencyKey('mana-trigger-save'),
      });
      if (isReadbackVerified(payload)) {
        const savedContract = normalizeContract(payload);
        const saved = savedContract.trigger;
        state.contract.detail = savedContract;
        state.triggers = { ...state.triggers, status: 'ready', trigger: saved, error: null, draft: null };
        await loadTriggerCatalog(saved.type, { renderAfter: false });
      } else state.triggers.status = 'saved_unverified';
    } catch (error) { setError(state.triggers, error); }
    render(); notifyChange(); return state.triggers;
  }

  async function runSafeTest(input = {}, id = contractId()) {
    setActiveStage('safe_test');
    if (!id) return null;
    const body = {
      contract_version: input.contractVersion ?? input.contract_version ?? currentContract()?.version,
      sample_input: input.sampleInput ?? input.sample_input ?? '',
      mode: 'isolated',
      external_send: false,
      production_writes: false,
    };
    state.safeTest.formDraft = body; state.safeTest.status = 'loading'; state.safeTest.error = null; render();
    try {
      const payload = await callMutation(path('tests', { contractId: id }), { body, key: idempotencyKey('mana-safe-test') });
      const accepted = normalizeRun(payload);
      let readback = null;
      if (accepted.id) {
        try { readback = normalizeRun(await callApi(path('runDetail', { runId: accepted.id }))); } catch { /* accepted is not completion */ }
      }
      const result = readback?.id ? readback : payload;
      state.safeTest.result = result;
      state.safeTest.formDraft = null;
      state.safeTest.status = safeTestStatus(result, currentContract());
    } catch (error) { setError(state.safeTest, error); }
    render(); notifyChange(); return state.safeTest;
  }

  async function refreshSafeTestReadback() {
    const runId = normalizeRun(state.safeTest.result).id;
    if (!runId) return state.safeTest;
    try {
      const result = normalizeRun(await callApi(path('runDetail', { runId })));
      state.safeTest.result = result;
      state.safeTest.status = safeTestStatus(result, currentContract());
      state.safeTest.error = null;
    } catch {
      state.safeTest.status = 'unknown';
    }
    return state.safeTest;
  }

  async function activate(id = contractId()) {
    setActiveStage('triggers');
    if (!id) return null;
    const contract = currentContract();
    const availability = triggerAvailability(triggerFromContract(currentContract(), state.triggers.draft));
    const testStatus = state.safeTest.result ? safeTestStatus(state.safeTest.result, contract) : state.safeTest.status;
    const authorityVerified = state.authority.status === 'ready' && state.authority.matrix.length > 0;
    const blockedReason = !availability.available ? availability.reason
      : !authorityVerified ? '権限マトリクスを確認できていないため、委任を有効化できません。'
        : testStatus !== 'verified' ? '現在の設定で完了条件まで検証した隔離試験が必要です。' : '';
    if (blockedReason) {
      state.activation = { status: 'unknown', error: { kind: 'unknown', message: blockedReason }, message: '' };
      render(); notifyChange(); return null;
    }
    state.activation.status = 'loading'; state.activation.error = null; state.activation.message = ''; render();
    try {
      const current = currentContract();
      const payload = await callMutation(path('activation', { contractId: id }), {
        body: { action: 'activate', ...(Number.isInteger(current?.version) ? { expected_version: current.version } : {}) }, key: idempotencyKey('mana-activation'),
      });
      const readback = await verifyContractReadback(id, payload, 'active');
      if (readback) { state.activation.status = 'verified'; state.activation.message = '有効化済みの契約を再取得して確認しました。'; }
      else state.activation.status = 'saved_unverified';
    } catch (error) { const normalized = normalizeError(error); state.activation.error = normalized; state.activation.status = normalized.kind; }
    render(); notifyChange(); return state.activation;
  }

  async function stopActivation(id = contractId()) {
    setActiveStage('triggers');
    if (!id || !confirmAction('この委任を停止します。進行中の実行は実行詳細で確認してください。続けますか？')) return null;
    state.activation.status = 'loading'; state.activation.error = null; render();
    try {
      const current = currentContract();
      const payload = await callMutation(path('activation', { contractId: id }), {
        body: { action: 'stop', ...(Number.isInteger(current?.version) ? { expected_version: current.version } : {}) }, key: idempotencyKey('mana-activation-stop'),
      });
      const readback = await verifyContractReadback(id, payload, 'stopped');
      state.activation.status = readback ? 'verified' : 'saved_unverified';
      if (readback) state.activation.message = '停止状態を再取得して確認しました。';
    } catch (error) { const normalized = normalizeError(error); state.activation.error = normalized; state.activation.status = normalized.kind; }
    render(); notifyChange(); return state.activation;
  }

  async function loadRuns(id = contractId()) {
    setActiveStage('runs');
    if (!id) { state.runs.status = 'unknown'; render(); return state.runs; }
    state.runs.status = 'loading'; state.runs.error = null; render();
    try {
      const normalized = normalizeRuns(await callApi(path('runList', { contractId: id })));
      state.runs = { ...state.runs, ...normalized, status: normalized.state, error: null };
      const latestSafeTest = normalized.records.find((run) => run.mode === 'safe_test' && run.contractId === id);
      if (latestSafeTest) {
        state.safeTest.result = latestSafeTest;
        state.safeTest.status = safeTestStatus(latestSafeTest, currentContract());
        state.safeTest.error = null;
      }
    }
    catch (error) { setError(state.runs, error); }
    render(); notifyChange(); return state.runs;
  }

  async function loadRunDetail(id = state.runs.selectedId, { renderAfter = true } = {}) {
    setActiveStage('runs');
    if (!id) { state.runs.status = 'unknown'; if (renderAfter) render(); return null; }
    state.runs.status = 'loading'; state.runs.error = null; state.runs.selectedId = id; if (renderAfter) render();
    try {
      const payload = await callApi(path('runDetail', { runId: id }));
      state.runs.detail = normalizeRun(payload); state.runs.status = 'ready';
    } catch (error) { setError(state.runs, error); }
    if (renderAfter) { render(); notifyChange(); }
    return state.runs.detail;
  }

  async function runAction(action, input = {}, id = state.runs.selectedId) {
    setActiveStage('runs');
    if (!id) return null;
    const detail = state.runs.detail ?? state.runs.records.find((item) => item.id === id);
    const current = objectValue(detail);
    if (action === 'retry' && current.status === 'stopped') {
      state.runAction = { status: 'unknown', error: { kind: 'unknown', message: STOPPED_RUN_RESTART_UNAVAILABLE }, draft: null };
      render(); notifyChange(); return state.runAction;
    }
    if (action === 'approve' && !normalizeApprovalTarget(current.pendingApproval, current.contractVersion).complete) {
      state.runAction = { status: 'unknown', error: { kind: 'unknown', message: '承認対象の差分を取得できないため承認できません。' }, draft: null };
      render(); notifyChange(); return state.runAction;
    }
    const body = { ...objectValue(input) };
    if (Number.isInteger(current.version)) body.expected_version = current.version;
    state.runAction = { status: 'loading', error: null, draft: body }; render();
    try {
      let targetName = 'runStop';
      if (action === 'approve' || action === 'reject') {
        targetName = 'decisions'; body.decision = action;
        body.approvalId = current.pendingApproval?.approvalId ?? current.pendingApproval?.approval_id ?? '';
      }
      else if (action === 'retry') targetName = 'resume';
      const payload = await callMutation(path(targetName, { runId: id }), { body, key: idempotencyKey(`mana-run-${action}`) });
      state.runAction.draft = null;
      const readback = await loadRunDetail(id, { renderAfter: false });
      state.runAction.status = readback ? 'verified' : isReadbackVerified(payload) ? 'verified' : 'saved_unverified';
    } catch (error) { state.runAction.status = normalizeError(error).kind; state.runAction.error = normalizeError(error); }
    render(); notifyChange(); return state.runAction;
  }

  function renderContractSection() {
    const section = createElement(document, 'section', { className: 'outcome-mana-section outcome-mana-contract', attrs: { 'aria-labelledby': 'outcome-mana-contract-heading' } });
    section.append(sectionHeading(document, '成果契約', state.contract.status, '期待する成果、対象範囲、根拠、保存先、完了条件を版付きで管理します。保存と有効化は別操作です。', 'outcome-mana-contract-heading'));
    const content = createElement(document, 'div', { className: 'outcome-mana-section-content' });
    if (['loading', 'empty', 'permission_denied', 'error_retryable', 'conflict', 'unknown'].includes(state.contract.status)) {
      const message = state.contract.status === 'empty'
        ? stateMessage(document, EMPTY, { emptyTitle: '委任契約はありません', emptyText: '新しい下書きを作成すると、成果と完了条件を入力できます。' })
        : stateMessage(document, state.contract.status, { message: state.contract.error?.message, retry: loadContracts });
      if (message) content.append(message);
      if (state.contract.status === 'empty' && canManage(currentSession())) content.append(button(document, '新しい下書きを作成', () => { state.contract.detail = normalizeContract({ status: 'draft', project: currentProject().code }); state.contract.selectedId = null; state.contract.formDraft = {}; state.contract.status = 'ready'; render(); }));
      section.append(content); return section;
    }
    const list = createElement(document, 'div', { className: 'outcome-mana-contract-list', attrs: { role: 'list', 'aria-label': '委任契約一覧' } });
    state.contract.records.forEach((record) => {
      const item = createElement(document, 'div', { className: `outcome-mana-contract-list-item${record.contractId === state.contract.selectedId ? ' is-selected' : ''}`, attrs: { role: 'listitem' } });
      const select = button(document, `${present(record.outcome, '成果未確認')} / ${record.version === null ? '版未確認' : `v${record.version}`}`, () => { state.contract.selectedId = record.contractId; loadContractDetail(record.contractId); }, { className: 'outcome-mana-list-select', attrs: { 'aria-current': record.contractId === state.contract.selectedId ? 'true' : 'false' } });
      item.append(select, statusBadge(document, record.status)); list.append(item);
    });
    content.append(list);
    const contract = currentContract() ?? normalizeContract({ status: 'draft', project: currentProject().code });
    const values = contractFormValues(contract, state.contract.formDraft);
    const form = createElement(document, 'form', { className: 'outcome-mana-form', attrs: { 'aria-label': '成果契約の編集' } });
    const fields = {};
    const addField = (name, label, type, options = {}) => { const result = field(document, label, type, name, values[name], options); fields[name] = result.input; form.append(result.label); };
    addField('outcome', '期待する成果', 'textarea', { attrs: { rows: '4', required: 'required', maxlength: '2000' }, helper: '手順ではなく、受け取りたい状態を具体的に書きます。' });
    addField('scope', '対象範囲', 'textarea', { attrs: { rows: '3', required: 'required', maxlength: '2000' }, helper: '対象プロジェクトや資料の範囲。サーバーでも検証します。' });
    addField('inputRefs', '入力資料（ID@版、1行1件）', 'textarea', { attrs: { rows: '3', required: 'required', maxlength: '4000' } });
    addField('knowledgeRefs', '参照する知識（ID@版、1行1件）', 'textarea', { attrs: { rows: '3', maxlength: '4000' } });
    addField('judgmentRefs', '参照する判断（ID@版、1行1件）', 'textarea', { attrs: { rows: '3', maxlength: '4000' } });
    addField('adapterId', '成果物アダプター', 'input', { attrs: { required: 'required', maxlength: '128' } });
    addField('location', '成果物の保存先', 'input', { attrs: { required: 'required', maxlength: '2000' } });
    addField('environment', '保存環境', 'select', { options: [{ value: 'isolated', label: '隔離保存先' }, { value: 'production', label: '本番保存先' }], helper: '隔離試験は本番保存先へ書き込みません。' });
    addField('completionCriteria', '完了条件（id・説明・kind・expected、タブ区切り）', 'textarea', { attrs: { rows: '5', required: 'required', maxlength: '8000' }, helper: '例: criteria-1［Tab］本文を含む［Tab］content_includes［Tab］報告' });
    addField('ownerActorId', '責任者の主体ID', 'input', { attrs: { required: 'required', maxlength: '128' }, helper: '主体はサーバーで現在の組織権限と照合します。' });
    const limits = createElement(document, 'div', { className: 'outcome-mana-inline-fields' });
    for (const [name, label, helper] of [
      ['maxAttempts', '最大試行回数'],
      ['timeoutMs', 'タイムアウト（ms）'],
      ['budgetUnits', '外部処理の実行上限', 'AI生成・保存・外部送信を新しく開始するたびに1回として数えます。1回の処理に含まれる保存確認などは追加で数えません。読み取り・確認、完了済み処理の再開は数えません。'],
    ]) {
      const result = field(document, label, 'input', name, values[name], { attrs: { type: 'number', min: '1', required: 'required' }, helper }); fields[name] = result.input; limits.append(result.label);
    }
    form.append(limits);
    const formError = state.contract.error ? createElement(document, 'p', { className: 'outcome-mana-inline-error', text: state.contract.error.message, attrs: { role: 'alert' } }) : null;
    if (formError) form.append(formError);
    const actions = createElement(document, 'div', { className: 'outcome-mana-actions' });
    const manage = canManage(currentSession());
    const isExisting = Boolean(contract.contractId);
    const save = button(document, isExisting ? '下書きを保存' : '下書きを作成', async () => {
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      await saveContractDraft(contractDraftFromForm(fields), { create: !isExisting });
    }, { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !manage || state.contract.status === 'saving', attrs: { 'aria-label': isExisting ? '成果契約の下書きを保存' : '成果契約の下書きを作成' } });
    actions.append(save);
    if (isExisting) {
      actions.append(button(document, '複製', () => cloneContract(contract.contractId), { disabled: !manage || state.contract.status === 'saving' }));
      if (contract.status !== 'retired') actions.append(button(document, '廃止', () => retireContract(contract.contractId), { className: 'outcome-mana-button outcome-mana-button-danger', disabled: !manage || state.contract.status === 'saving' }));
    }
    form.append(actions);
    listen(form, 'submit', (event) => { event.preventDefault?.(); save.click?.(); });
    content.append(form); section.append(content); return section;
  }

  function renderAuthoritySection() {
    const section = createElement(document, 'section', { className: 'outcome-mana-section', attrs: { 'aria-labelledby': 'outcome-mana-authority-heading' } });
    section.append(sectionHeading(document, '権限マトリクス', state.authority.status, '操作・対象資源・プロジェクト・主体ごとに、自動許可・承認・禁止を設定します。選択だけで権限は拡大しません。', 'outcome-mana-authority-heading'));
    const content = createElement(document, 'div', { className: 'outcome-mana-section-content' });
    if (state.authority.status === 'idle') content.append(stateMessage(document, 'unknown', { message: '契約を選択すると、実際の権限マトリクスを確認できます.', retry: contractId() ? () => loadAuthority() : null }));
    else if (['loading', 'empty', 'permission_denied', 'error_retryable', 'conflict', 'unknown'].includes(state.authority.status)) {
      const message = stateMessage(document, state.authority.status, { emptyTitle: '権限設定は未登録です', emptyText: '上流の権限設定を確認してから追加します。', message: state.authority.error?.message, retry: () => loadAuthority() });
      if (message) content.append(message);
    } else {
      const matrix = state.authority.draft ?? state.authority.matrix;
      const table = createElement(document, 'div', { className: 'outcome-mana-authority-table', attrs: { role: 'table', 'aria-label': '操作権限マトリクス' } });
      const header = createElement(document, 'div', { className: 'outcome-mana-authority-row outcome-mana-authority-header', attrs: { role: 'row' } });
      ['操作', '対象資源', 'プロジェクト', '主体', '設定'].forEach((label) => header.append(createElement(document, 'span', { text: label, attrs: { role: 'columnheader' } }))); table.append(header);
      const controls = [];
      matrix.forEach((entry, index) => {
        const row = createElement(document, 'div', { className: 'outcome-mana-authority-row', attrs: { role: 'row' } });
        row.append(createElement(document, 'span', { text: entry.operation }), createElement(document, 'span', { text: entry.target }), createElement(document, 'span', { text: entry.project }), createElement(document, 'span', { text: entry.actor }));
        const select = createElement(document, 'select', { className: 'outcome-mana-input', attrs: { 'aria-label': `${entry.operation}の権限設定` } });
        Object.entries(AUTHORITY_LABELS).forEach(([value, label]) => select.append(createElement(document, 'option', { text: label, attrs: { value } })));
        select.value = entry.policy ?? '';
        controls.push({ select, index }); row.append(select); table.append(row);
      });
      content.append(table);
      const actions = createElement(document, 'div', { className: 'outcome-mana-actions' });
      actions.append(button(document, '権限設定を保存', () => {
        const next = matrix.map((entry, index) => ({ ...entry, policy: controls[index]?.select.value || null }));
        saveAuthority(next);
      }, { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !canManage(currentSession()) || state.authority.status === 'saving' }));
      content.append(actions);
    }
    section.append(content); return section;
  }

  function renderTriggersSection() {
    const section = createElement(document, 'section', { className: 'outcome-mana-section', attrs: { 'aria-labelledby': 'outcome-mana-triggers-heading' } });
    const contract = currentContract();
    section.append(sectionHeading(document, '起動条件と有効化', contract?.status ?? state.triggers.status, '手動・定期・文書追加を設定し、接続・権限・入力・保存先・完了条件を確認してから明示的に有効化します。', 'outcome-mana-triggers-heading'));
    const content = createElement(document, 'div', { className: 'outcome-mana-section-content' });
    if (!contract) { content.append(stateMessage(document, 'unknown', { message: '契約を選択すると起動条件を設定できます。' })); section.append(content); return section; }
    const trigger = triggerFromContract(contract, state.triggers.draft);
    const availability = triggerAvailability(trigger);
    if (state.triggers.status === 'permission_denied' || state.triggers.status === 'error_retryable' || state.triggers.status === 'conflict') {
      const message = stateMessage(document, state.triggers.status, { message: state.triggers.error?.message, retry: () => loadContractDetail(contract.contractId) }); if (message) content.append(message);
    }
    const form = createElement(document, 'form', { className: 'outcome-mana-trigger-form', attrs: { 'aria-label': '起動条件の編集' } });
    const radioGroup = createElement(document, 'fieldset', { className: 'outcome-mana-trigger-options' });
    radioGroup.append(createElement(document, 'legend', { text: '起動方式' }));
    const triggerRadios = [];
    for (const [value, label] of Object.entries(TRIGGER_LABELS)) {
      const item = createElement(document, 'label', { className: 'outcome-mana-choice' });
      const radio = createElement(document, 'input', { attrs: { type: 'radio', name: 'outcome-mana-trigger-type', value } }); radio.checked = trigger.type === value; item.append(radio, createElement(document, 'span', { text: label })); radioGroup.append(item);
      triggerRadios.push(radio);
    }
    form.append(radioGroup);
    const controls = {};
    const schedule = field(document, 'スケジュールID', 'input', 'scheduleId', trigger.scheduleId, { attrs: { maxlength: '128' }, helper: '定期実行の接続が未確認なら有効化できません。' });
    const subscription = field(document, '文書購読ID', 'input', 'subscriptionId', trigger.subscriptionId, { attrs: { maxlength: '256' } });
    const provider = field(document, '文書プロバイダー', 'input', 'provider', trigger.provider, { attrs: { maxlength: '128' } });
    controls.scheduleId = schedule.input; controls.subscriptionId = subscription.input; controls.provider = provider.input;
    form.append(schedule.label, subscription.label, provider.label);
    const triggerStatus = availability.available
      ? statusBadge(document, 'verified', '利用準備確認済み')
      : createElement(document, 'p', { className: 'outcome-mana-inline-error', text: availability.reason, attrs: { role: 'status' } });
    form.append(createElement(document, 'div', { className: 'outcome-mana-trigger-status' }), triggerStatus);
    const actions = createElement(document, 'div', { className: 'outcome-mana-actions' });
    actions.append(button(document, '起動条件を保存', () => {
      const selected = triggerRadios.find((item) => item.checked)?.value ?? trigger.type;
      saveTriggers({ type: selected, scheduleId: controls.scheduleId.value, subscriptionId: controls.subscriptionId.value, provider: controls.provider.value });
    }, { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !canManage(currentSession()) }));
    const isActive = contract.status === 'active';
    const effectiveTestStatus = state.safeTest.status === 'loading' ? 'loading' : state.safeTest.result
      ? safeTestStatus(state.safeTest.result, contract) : state.safeTest.status;
    const testVerified = effectiveTestStatus === 'verified';
    const authorityVerified = state.authority.status === 'ready' && state.authority.matrix.length > 0;
    actions.append(button(document, isActive ? '委任を停止' : '委任を有効化', () => isActive ? stopActivation(contract.contractId) : activate(contract.contractId), { className: isActive ? 'outcome-mana-button outcome-mana-button-danger' : 'outcome-mana-button outcome-mana-button-primary', disabled: !canManage(currentSession()) || state.activation.status === 'loading' || (!isActive && (!testVerified || !availability.available || !authorityVerified)) }));
    if (!isActive && !testVerified) actions.append(createElement(document, 'small', { className: 'outcome-mana-helper', text: '有効化前に隔離試験を実行し、完了条件の検証済み結果を確認してください。' }));
    if (!isActive && !authorityVerified) actions.append(createElement(document, 'small', { className: 'outcome-mana-helper', text: '有効化前に権限マトリクスのreadbackを確認してください。' }));
    if (state.activation.error) actions.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: state.activation.error.message, attrs: { role: 'alert' } }));
    if (state.activation.message) actions.append(createElement(document, 'p', { className: 'outcome-mana-inline-success', text: state.activation.message, attrs: { role: 'status' } }));
    form.append(actions); listen(form, 'submit', (event) => event.preventDefault?.()); content.append(form); section.append(content); return section;
  }

  function renderSafeTestSection() {
    const section = createElement(document, 'section', { className: 'outcome-mana-section', attrs: { 'aria-labelledby': 'outcome-mana-safe-test-heading' } });
    const contract = currentContract();
    const effectiveTestStatus = state.safeTest.status === 'loading' ? 'loading' : state.safeTest.result
      ? safeTestStatus(state.safeTest.result, contract) : state.safeTest.status;
    section.append(sectionHeading(document, '隔離試験', effectiveTestStatus, '契約版とサンプル入力で試験します。外部送信と本番書き込みはリクエストでも遮断し、未実行の操作を成功とは表示しません。', 'outcome-mana-safe-test-heading'));
    const content = createElement(document, 'div', { className: 'outcome-mana-section-content' });
    if (!contract) { content.append(stateMessage(document, 'unknown', { message: '契約を選択すると隔離試験を実行できます。' })); section.append(content); return section; }
    const form = createElement(document, 'form', { className: 'outcome-mana-safe-test-form', attrs: { 'aria-label': '隔離試験の実行' } });
    const draft = state.safeTest.formDraft ?? {};
    const version = field(document, '試験する契約版', 'input', 'contractVersion', draft.contract_version ?? contract.version ?? '', { attrs: { type: 'number', min: '1', required: 'required' }, helper: '実行は選択した版へ固定されます。' });
    const sample = field(document, 'サンプル入力', 'textarea', 'sampleInput', draft.sample_input ?? '', { attrs: { rows: '6', required: 'required', maxlength: '12000' }, helper: '送信先・本番データではなく、試験用の入力を指定します。' });
    form.append(version.label, sample.label);
    const safety = createElement(document, 'p', { className: 'outcome-mana-safe-note', text: '隔離モード: 外部送信なし / 本番書き込みなし / 成果物は隔離保存先のみ' }); form.append(safety);
    const actions = createElement(document, 'div', { className: 'outcome-mana-actions' });
    actions.append(button(document, '隔離試験を実行', () => runSafeTest({ contractVersion: Number(version.input.value), sampleInput: sample.input.value }), { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !canManage(currentSession()) || state.safeTest.status === 'loading' }));
    form.append(actions); listen(form, 'submit', (event) => event.preventDefault?.()); content.append(form);
    if (effectiveTestStatus === 'unexecuted') content.append(stateMessage(document, 'unknown', { message: '試験要求は受理されましたが、実行結果を確認できていません。成功とは扱いません。', retry: () => runSafeTest({ contractVersion: Number(version.input.value), sampleInput: sample.input.value }) }));
    if (effectiveTestStatus === 'executed') content.append(stateMessage(document, 'unknown', { message: '試験は実行済みですが、完了条件の検証済み結果を確認できていません。', retry: () => runSafeTest({ contractVersion: Number(version.input.value), sampleInput: sample.input.value }) }));
    if (effectiveTestStatus === 'verified') content.append(createElement(document, 'p', { className: 'outcome-mana-inline-success', text: 'この設定で試験済み', attrs: { role: 'status' } }));
    if (effectiveTestStatus === 'stale') content.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '設定変更のため再試験が必要', attrs: { role: 'status' } }));
    if (effectiveTestStatus === 'completion_unverified') content.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '試験は実行済みですが、完了条件の検証結果を確認できていません。', attrs: { role: 'status' } }));
    if (effectiveTestStatus === 'configuration_snapshot_missing') content.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '試験時の設定記録が不足しているため、現在の設定と一致するか確認できません。再試験が必要です。', attrs: { role: 'status' } }));
    if (effectiveTestStatus === 'failed') content.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '隔離試験が失敗しました。外部への副作用は成功扱いにしていません。', attrs: { role: 'alert' } }));
    if (state.safeTest.error) content.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: state.safeTest.error.message, attrs: { role: 'alert' } }));
    if (state.safeTest.result) {
      const result = objectValue(state.safeTest.result);
      const execution = objectValue(result.execution ?? result.testRun ?? result.run);
      content.append(definitionList(document, [['実行状態', statusLabel(completionState(state.safeTest.result))], ['試験ID', firstPresent(result.test_id, result.testId, result.id, execution.id)], ['対象版', firstPresent(result.contract_version, result.contractVersion, contract.version)]]));
      content.append(evidenceList(document, '予定した操作', result.operations ?? execution.operations));
      content.append(evidenceList(document, '必要な承認', result.approvals ?? execution.approvals));
      content.append(evidenceList(document, '参照した根拠', result.evidence ?? execution.evidence));
      content.append(evidenceList(document, '隔離成果物', result.artifacts ?? execution.artifacts));
      content.append(evidenceList(document, '完了条件の評価', result.completion?.criteria ?? result.completion ?? execution.completion?.criteria ?? execution.completion));
    }
    section.append(content); return section;
  }

  function renderRunDetail() {
    const detail = state.runs.detail;
    const section = createElement(document, 'div', { className: 'outcome-mana-run-detail' });
    if (!detail) { section.append(stateMessage(document, 'unknown', { message: '実行を選択すると、起動理由・契約版・段階・成果物・完了条件・再開地点を確認できます。' })); return section; }
    section.append(createElement(document, 'h3', { text: '実行詳細' }), statusBadge(document, detail.status));
    section.append(definitionList(document, [
      ['実行ID', detail.id],
      ['起動理由', triggerLabel(detail.trigger ?? detail.reason)],
      ['契約版', detail.contractVersion === null ? UNKNOWN : `v${detail.contractVersion}`],
      ['設定ハッシュ', detail.configHash],
      ['現在の処理段階', detail.stage],
      ['再開地点', detail.resumePoint],
      ['成果物readback', approvalDisplayValue(detail.artifactReadback)],
      ['判断結果', approvalDisplayValue(detail.judgment)],
      ['判断理由', detail.judgmentReason],
      ['開始', dateLabel(detail.startedAt)],
      ['更新', dateLabel(detail.updatedAt)],
    ]));
    section.append(stageList(document, detail.stages));
    section.append(evidenceList(document, '参照した根拠', detail.evidence), evidenceList(document, '成果物', detail.artifacts), evidenceList(document, '完了条件', detail.completion.criteria));
    if (detail.completion.reason) section.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: detail.completion.reason, attrs: { role: 'alert' } }));
    const actions = createElement(document, 'div', { className: 'outcome-mana-actions' });
    const manageable = canManage(currentSession());
    if (detail.status === 'waiting_approval') {
      const approval = normalizeApprovalTarget(detail.pendingApproval, detail.contractVersion);
      section.append(createElement(document, 'h4', { text: '承認対象の差分と外部影響' }));
      section.append(definitionList(document, [
        ['差分', approvalDisplayValue(approval.diff)],
        ['操作', approvalDisplayValue(approval.operation)],
        ['対象リソース', approvalDisplayValue(approval.resource)],
        ['payload hash', approvalDisplayValue(approval.payloadHash)],
        ['外部送信先', approvalDisplayValue(approval.destination)],
        ['契約版', approval.contractVersion === null ? UNKNOWN : `v${approval.contractVersion}`],
        ['承認期限', dateLabel(approval.expiresAt)],
      ]));
      if (!approval.complete) section.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '承認対象の差分を取得できないため承認できません。未確認項目を補ってから再読込してください。', attrs: { role: 'alert' } }));
      const reason = field(document, '却下理由（必須）', 'textarea', 'rejectReason', state.runAction.draft?.reason ?? '', { attrs: { rows: '3', maxlength: '2000' } });
      section.append(reason.label);
      actions.append(button(document, '承認する', () => runAction('approve'), { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !manageable || !approval.complete }), button(document, '却下する', () => runAction('reject', { reason: reason.input.value }), { className: 'outcome-mana-button outcome-mana-button-danger', disabled: !manageable }));
    }
    if (detail.status === 'failed') actions.append(button(document, '失敗地点から再開', () => runAction('retry'), { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !manageable }));
    if (detail.status === 'stopped') section.append(createElement(document, 'p', { className: 'outcome-mana-muted', text: STOPPED_RUN_RESTART_UNAVAILABLE }));
    if (['queued', 'running', 'waiting_approval'].includes(detail.status)) actions.append(button(document, 'この実行を停止', () => { if (confirmAction('この実行を停止します。続けますか？')) runAction('stop'); }, { className: 'outcome-mana-button outcome-mana-button-danger', disabled: !manageable }));
    if (state.runAction.error) actions.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: state.runAction.error.message, attrs: { role: 'alert' } }));
    if (state.runAction.status === 'saved_unverified') actions.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '操作は保存されましたが、最新の実行状態を確認できていません。成功とは扱いません。', attrs: { role: 'alert' } }));
    section.append(actions); return section;
  }

  function renderRunsSection() {
    const section = createElement(document, 'section', { className: 'outcome-mana-section outcome-mana-runs', attrs: { 'aria-labelledby': 'outcome-mana-runs-heading' } });
    section.append(sectionHeading(document, '実行履歴', state.runs.status, '起動理由、契約版、処理段階、承認、成果物、完了検証を実行単位で確認します。', 'outcome-mana-runs-heading'));
    const content = createElement(document, 'div', { className: 'outcome-mana-section-content' });
    const toolbar = createElement(document, 'div', { className: 'outcome-mana-toolbar' }); toolbar.append(button(document, '実行履歴を読み込む', () => loadRuns(), { className: 'outcome-mana-button outcome-mana-button-secondary', disabled: state.runs.status === 'loading' })); content.append(toolbar);
    if (['loading', 'empty', 'permission_denied', 'error_retryable', 'conflict', 'unknown'].includes(state.runs.status)) {
      const message = stateMessage(document, state.runs.status, { emptyTitle: '実行履歴はありません', emptyText: '有効化後に起動した実行がここへ表示されます。', message: state.runs.error?.message, retry: () => loadRuns() }); if (message) content.append(message);
    } else {
      const list = createElement(document, 'div', { className: 'outcome-mana-run-list outcome-mana-run-table', attrs: { role: 'list', 'aria-label': 'Mana実行履歴' } });
      const tableHeader = createElement(document, 'div', { className: 'outcome-mana-run-table-header', attrs: { role: 'row' } });
      ['起動理由', '契約版', '状態', '更新'].forEach((label) => tableHeader.append(createElement(document, 'span', { text: label, attrs: { role: 'columnheader' } })));
      list.append(tableHeader);
      state.runs.records.forEach((run) => {
        const item = createElement(document, 'div', { className: `outcome-mana-run-item${run.id === state.runs.selectedId ? ' is-selected' : ''}`, attrs: { role: 'listitem' } });
        item.append(
          button(document, runReasonLabel(run.reason, run.trigger), () => loadRunDetail(run.id), { className: 'outcome-mana-list-select', attrs: { 'aria-current': run.id === state.runs.selectedId ? 'true' : 'false' } }),
          createElement(document, 'span', { className: 'outcome-mana-run-version', text: run.contractVersion === null ? '版未確認' : `v${run.contractVersion}` }),
          statusBadge(document, run.status),
          createElement(document, 'time', { className: 'outcome-mana-run-updated', text: dateLabel(run.updatedAt ?? run.startedAt) }),
        ); list.append(item);
      });
      content.append(list, renderRunDetail());
    }
    section.append(content); return section;
  }

  function renderWorkspaceNavigation() {
    const nav = createElement(document, 'nav', { className: 'outcome-mana-view-nav', attrs: { 'aria-label': 'Mana管理画面' } });
    const activeView = derivedActiveView() === 'delegation_settings' ? 'overview' : derivedActiveView();
    for (const view of MANA_VIEWS) {
      nav.append(button(document, view.label, () => {
        setActiveView(view.id);
        if (view.id === 'runs' && state.runs.status === 'idle' && contractId()) loadRuns();
        else if (view.id === 'connections' && state.connections.status === 'unknown') loadConnections();
        else if (view.id === 'settings' && state.manaSettings.status === 'unknown') loadManaSettings();
        else render();
      }, {
        className: `outcome-mana-view-tab${activeView === view.id ? ' is-active' : ''}`,
        attrs: { 'aria-current': activeView === view.id ? 'page' : 'false' },
      }));
    }
    return nav;
  }

  function renderOverviewView() {
    const view = createElement(document, 'section', { className: 'outcome-mana-overview', attrs: { 'aria-labelledby': 'outcome-mana-overview-heading' } });
    function startNewDelegation() {
      state.contract.detail = null;
      state.contract.selectedId = null;
      state.contract.formDraft = {};
      setActiveStage('contract');
      render();
    }
    const heading = createElement(document, 'div', { className: 'outcome-mana-view-heading' });
    heading.append(group(document, 'div', {}, [
      createElement(document, 'h2', { id: 'outcome-mana-overview-heading', text: '委任一覧' }),
      createElement(document, 'p', { text: 'Manaに任せた仕事の状態と、次に必要な操作を比較します。' }),
    ]));
    if (state.contract.status !== 'empty') {
      heading.append(button(document, '新しい委任を作成', startNewDelegation, { className: 'outcome-mana-button outcome-mana-button-primary', disabled: !canManage(currentSession()) }));
    }
    view.append(heading);
    const hasContractSnapshot = ['ready', 'empty'].includes(state.contract.status);
    const records = state.contract.records;
    // The runs endpoint is scoped to a single delegation, so it cannot
    // support a workspace-wide running count without an aggregate API.
    const runningCount = UNKNOWN;
    const kpis = [
      ['登録委任', hasContractSnapshot ? records.length : UNKNOWN, 'contract-count'],
      ['有効', hasContractSnapshot ? records.filter((item) => item.status === 'active').length : UNKNOWN, 'active-count'],
      ['確認待ち', hasContractSnapshot ? records.filter((item) => ['draft', 'waiting_approval', 'saved_unverified'].includes(item.status)).length : UNKNOWN, 'waiting-count'],
      ['実行中', runningCount, 'running-count'],
    ];
    const kpiGrid = createElement(document, 'div', { className: 'outcome-mana-kpi-grid', attrs: { 'aria-label': 'Mana委任の概要指標' } });
    kpis.forEach(([label, value, id]) => {
      const card = createElement(document, 'article', { className: 'outcome-mana-kpi-card', attrs: { 'data-kpi': id } });
      card.append(createElement(document, 'span', { className: 'outcome-mana-kpi-label', text: label }), createElement(document, 'strong', { className: 'outcome-mana-kpi-value', text: String(value) }));
      kpiGrid.append(card);
    });
    view.append(kpiGrid);
    if (state.contract.status === 'empty') {
      const empty = createElement(document, 'section', {
        className: 'outcome-mana-state outcome-mana-empty outcome-mana-empty-workspace',
        attrs: { role: 'region', 'aria-labelledby': 'outcome-mana-empty-workspace-heading' },
      });
      empty.append(
        createElement(document, 'span', { className: 'outcome-mana-eyebrow', text: '最初の委任' }),
        createElement(document, 'h3', { id: 'outcome-mana-empty-workspace-heading', text: 'Manaに仕事を委任しましょう' }),
        createElement(document, 'p', { text: '登録された委任はありません。成果と責任者を決め、使える資源と起動条件を確認してから安全試験へ進めます。' }),
      );
      const steps = createElement(document, 'ol', { className: 'outcome-mana-empty-steps' });
      [
        ['成果と責任者', 'Manaに任せる結果と、その結果を確認する人を決めます。'],
        ['資源と起動条件', '委任で使える資源と、実行を始める条件を設定します。'],
        ['安全試験と有効化', '保存後に安全試験を行い、内容を確認してから有効化します。'],
      ].forEach(([title, description], index) => {
        const item = createElement(document, 'li', { className: 'outcome-mana-empty-step' });
        item.append(createElement(document, 'span', { className: 'outcome-mana-empty-step-number', text: String(index + 1) }));
        item.append(group(document, 'span', { className: 'outcome-mana-empty-step-copy' }, [
          createElement(document, 'strong', { text: title }),
          createElement(document, 'small', { text: description }),
        ]));
        steps.append(item);
      });
      empty.append(steps);
      empty.append(button(document, '成果契約を入力する', startNewDelegation, {
        className: 'outcome-mana-button outcome-mana-button-primary',
        disabled: !canManage(currentSession()),
      }));
      if (!canManage(currentSession())) {
        empty.append(createElement(document, 'small', { className: 'outcome-mana-helper', text: '委任を作成できる権限を持つ管理者に依頼してください。' }));
      }
      view.append(empty);
      return view;
    }
    if (['loading', 'permission_denied', 'error_retryable', 'unknown'].includes(state.contract.status)) {
      view.append(stateMessage(document, state.contract.status, { message: state.contract.error?.message, retry: loadContracts }));
      return view;
    }
    const layout = createElement(document, 'div', { className: 'outcome-mana-overview-layout' });
    const list = createElement(document, 'div', { className: 'outcome-mana-delegation-list', attrs: { role: 'list', 'aria-label': 'Mana委任一覧' } });
    for (const contract of state.contract.records) {
      const selected = contract.contractId === state.contract.selectedId;
      const item = button(document, '', async () => { await loadContractDetail(contract.contractId); setActiveView('overview'); render(); }, {
        className: `outcome-mana-delegation-card${selected ? ' is-selected' : ''}`,
        attrs: { role: 'listitem', 'aria-current': selected ? 'true' : 'false' },
      });
      const copy = createElement(document, 'span', { className: 'outcome-mana-delegation-copy' });
      const nextAction = contract.nextAction || (contract.status === 'active' ? '実行履歴を確認' : contract.status === 'draft' ? '委任設定を完了' : '状態を確認');
      copy.append(
        createElement(document, 'strong', { text: present(contract.outcome, '成果未登録') }),
        createElement(document, 'small', { text: `${triggerLabel(contract.trigger?.type)} · v${contract.version ?? UNKNOWN}` }),
        createElement(document, 'small', { text: `次の操作: ${nextAction}` }),
      );
      item.append(copy, statusBadge(document, contract.status));
      list.append(item);
    }
    const selected = currentContract();
    const inspector = createElement(document, 'aside', { className: 'outcome-mana-inspector', attrs: { 'aria-label': '選択した委任の概要' } });
    if (!selected) inspector.append(stateMessage(document, 'unknown', { message: '委任を選ぶと成果、責任者、起動条件、最終実行を確認できます。' }));
    else {
      inspector.append(createElement(document, 'span', { className: 'outcome-mana-eyebrow', text: '選択中の委任' }), createElement(document, 'h3', { text: present(selected.outcome, '成果未登録') }));
      inspector.append(definitionList(document, [
        ['責任者', present(selected.owner?.actorId)], ['対象範囲', present(selected.scope)], ['起動条件', triggerLabel(selected.trigger?.type)],
        ['契約版', selected.version === null ? UNKNOWN : `v${selected.version}`], ['最終実行', state.runs.records[0] ? dateLabel(state.runs.records[0].updatedAt ?? state.runs.records[0].startedAt) : UNKNOWN],
      ]));
      inspector.append(button(document, '委任設定を開く', () => { setActiveView('delegation_settings'); render(); }, { className: 'outcome-mana-button outcome-mana-button-primary' }));
    }
    layout.append(list, inspector); view.append(layout); return view;
  }

  function projectConnectors() {
    const project = currentProject();
    const source = project.connections ?? project.connectors ?? project.foundationConnections ?? project.foundation_connections;
    const values = Array.isArray(source) ? source : Object.entries(objectValue(source)).map(([id, value]) => ({ id, ...objectValue(value) }));
    const byId = new Map(values.map((item) => [normalizeConnector(item).id.toLowerCase(), normalizeConnector(item)]));
    const registeredById = new Map(connectorRecordsFromProject().map((item) => [item.id.toLowerCase(), item]));
    const loadedById = new Map(state.connections.records.map((item) => [item.id.toLowerCase(), item]));
    return CONNECTOR_DEFINITIONS.map((definition) => ({
      ...definition,
      ...(registeredById.get(definition.id) ?? {}),
      ...(byId.get(definition.id) ?? {}),
      ...(loadedById.get(definition.id) ?? {}),
      label: definition.label,
      description: definition.description,
    }));
  }

  function renderConnectionsView() {
    const view = createElement(document, 'section', { className: 'outcome-mana-connections', attrs: { 'aria-labelledby': 'outcome-mana-connections-heading' } });
    const headingCopy = group(document, 'div', {}, [createElement(document, 'h2', { id: 'outcome-mana-connections-heading', text: '接続状態' }), createElement(document, 'p', { text: 'Mana runtimeの組織接続と、選択中の委任が利用できる資源を分けて表示します。' })]);
    const headingActions = createElement(document, 'div', { className: 'outcome-mana-toolbar' });
    headingActions.append(button(document, state.connections.status === 'loading' ? '確認中…' : '接続を再確認', () => loadConnections(), { className: 'outcome-mana-button outcome-mana-button-secondary', disabled: state.connections.status === 'loading' }));
    view.append(group(document, 'div', { className: 'outcome-mana-view-heading' }, [headingCopy, headingActions]));
    const connectors = projectConnectors();
    if (!state.connections.selectedId && connectors.length) state.connections.selectedId = connectors[0].id;
    const selectedConnector = connectors.find((item) => item.id === state.connections.selectedId) ?? null;
    const table = createElement(document, 'div', { className: 'outcome-mana-connection-table', attrs: { role: 'table', 'aria-label': 'Mana組織接続一覧' } });
    const header = createElement(document, 'div', { className: 'outcome-mana-connection-row outcome-mana-connection-header', attrs: { role: 'row' } });
    ['接続', '状態', 'アカウント', '登録資源', '最終確認'].forEach((label) => header.append(createElement(document, 'span', { text: label, attrs: { role: 'columnheader' } })));
    table.append(header);
    for (const connector of connectors) {
      const selected = connector.id === state.connections.selectedId;
      const row = button(document, '', () => {
        state.connections.selectedId = connector.id;
        state.connections.detail = connector;
        render();
      }, { className: `outcome-mana-connection-row${selected ? ' is-selected' : ''}`, attrs: { role: 'row', 'aria-current': selected ? 'true' : 'false' } });
      row.append(
        connectorIdentity(document, connector, { attrs: { role: 'cell' } }),
        group(document, 'span', { attrs: { role: 'cell' } }, [statusBadge(document, connector.status ?? 'unknown', connectionStatusLabel(connector.status))]),
        createElement(document, 'span', { text: present(connector.account), attrs: { role: 'cell' } }),
        createElement(document, 'span', { text: connector.resources?.length ? connector.resources.map(resourceLabel).join('、') : UNKNOWN, attrs: { role: 'cell' } }),
        createElement(document, 'span', { text: dateLabel(connector.checkedAt), attrs: { role: 'cell' } }),
      );
      table.append(row);
    }
    const contract = currentContract();
    const inspector = createElement(document, 'aside', { className: 'outcome-mana-connection-inspector', attrs: { 'aria-label': '選択した接続の詳細' } });
    inspector.append(createElement(document, 'span', { className: 'outcome-mana-eyebrow', text: '選択中の接続' }));
    if (selectedConnector) {
      inspector.append(connectorIdentity(document, selectedConnector, { large: true }));
      inspector.append(definitionList(document, [['接続状態', connectionStatusLabel(selectedConnector.status)], ['接続先', selectedConnector.account], ['確認日時', dateLabel(selectedConnector.checkedAt)], ['確認理由', connectionReasonLabel(selectedConnector.reason)]]));
      inspector.append(evidenceList(document, '登録資源', selectedConnector.resources));
    } else inspector.append(stateMessage(document, 'unknown', { message: '接続を選ぶと登録資源と確認状態を表示します。' }));
    const allowed = createElement(document, 'aside', { className: 'outcome-mana-resource-panel' });
    allowed.append(createElement(document, 'span', { className: 'outcome-mana-eyebrow', text: '委任単位の許可範囲' }), createElement(document, 'h3', { text: 'この委任が利用できる資源' }));
    if (!contract) allowed.append(stateMessage(document, 'unknown', { message: '委任を選ぶと、契約版に固定された参照先と保存先を確認できます。' }));
    else {
      const permitted = permittedResources(contract);
      allowed.append(evidenceList(document, '許可リソース', permitted));
      allowed.append(evidenceList(document, '入力', contract.inputRefs), evidenceList(document, '知識', contract.knowledgeRefs), evidenceList(document, '判断', contract.judgmentRefs), definitionList(document, [['保存先', present(contract.artifactDestination?.location)], ['接続ID', present(contract.artifactDestination?.adapterId)], ['環境', present(contract.artifactDestination?.environment)]]));
    }
    view.append(table, group(document, 'div', { className: 'outcome-mana-connection-detail-layout' }, [inspector, allowed])); return view;
  }

  function renderDelegationSettings() {
    const view = createElement(document, 'section', { className: 'outcome-mana-settings-workspace', attrs: { 'aria-labelledby': 'outcome-mana-settings-workspace-heading' } });
    const top = createElement(document, 'div', { className: 'outcome-mana-view-heading' });
    top.append(group(document, 'div', {}, [createElement(document, 'span', { className: 'outcome-mana-eyebrow', text: '委任設定' }), createElement(document, 'h2', { id: 'outcome-mana-settings-workspace-heading', text: present(currentContract()?.outcome, '新しい委任') }), createElement(document, 'p', { text: '保存、安全試験、有効化を別々に確認しながら進めます。' })]), button(document, '一覧へ戻る', () => { setActiveView('overview'); render(); }, { className: 'outcome-mana-button outcome-mana-button-secondary' }));
    const tabs = createElement(document, 'div', { className: 'outcome-mana-detail-tabs', attrs: { role: 'tablist', 'aria-label': '委任詳細' } });
    [['summary', '概要'], ['settings', '設定'], ['runs', '実行履歴']].forEach(([id, label]) => {
      const active = state.delegationTab === id;
      tabs.append(button(document, label, () => {
        if (id === 'summary') { setActiveView('overview'); return; }
        state.delegationTab = id;
        setActiveView('delegation_settings');
        render();
      }, { className: `outcome-mana-detail-tab${active ? ' is-active' : ''}`, attrs: { role: 'tab', 'aria-selected': active ? 'true' : 'false' } }));
    });
    view.append(top, tabs);
    if (state.delegationTab === 'runs') {
      view.append(renderRunsSection());
      return view;
    }
    const workspace = createElement(document, 'div', { className: 'outcome-mana-delegation-layout' });
    workspace.append(renderStageNavigator(), renderStageWorkspace());
    view.append(workspace);
    const sticky = createElement(document, 'div', { className: 'outcome-mana-sticky-actions', attrs: { 'aria-label': '委任設定の次の操作' } });
    sticky.append(createElement(document, 'span', { className: 'outcome-mana-muted', text: '保存と安全試験は別の工程として記録します。' }));
    sticky.append(button(document, '安全試験を開く', () => { state.delegationTab = 'settings'; setActiveStage('safe_test'); render(); }, { className: 'outcome-mana-button outcome-mana-button-primary' }));
    sticky.append(button(document, '実行履歴を見る', () => { state.delegationTab = 'runs'; setActiveView('delegation_settings'); render(); }, { className: 'outcome-mana-button outcome-mana-button-secondary' }));
    view.append(sticky);
    return view;
  }

  function renderRunsView() {
    const view = createElement(document, 'section', { className: 'outcome-mana-runs-view', attrs: { 'aria-labelledby': 'outcome-mana-runs-view-heading' } });
    view.append(group(document, 'div', { className: 'outcome-mana-view-heading' }, [group(document, 'div', {}, [createElement(document, 'h2', { id: 'outcome-mana-runs-view-heading', text: '実行履歴' }), createElement(document, 'p', { text: '成果生成から保存、readback、完了判定までを実行単位で追跡します。' })])]));
    view.append(renderRunsSection()); return view;
  }

  function renderSettingsView() {
    const view = createElement(document, 'section', { className: 'outcome-mana-runtime-settings', attrs: { 'aria-labelledby': 'outcome-mana-runtime-settings-heading' } });
    view.append(group(document, 'div', { className: 'outcome-mana-view-heading' }, [group(document, 'div', {}, [createElement(document, 'h2', { id: 'outcome-mana-runtime-settings-heading', text: 'Mana設定' }), createElement(document, 'p', { text: 'runtime全体の既定値、安全上限、通知、監査を確認します。実効権限は各委任契約の版で決まります。' })])]));
    if (['loading', 'permission_denied', 'error_retryable', 'conflict'].includes(state.manaSettings.status)) {
      const message = stateMessage(document, state.manaSettings.status, {
        message: state.manaSettings.error?.message,
        retry: () => loadManaSettings(),
        loadingText: 'Mana設定を読み込んでいます…',
      });
      if (message) view.append(message);
      return view;
    }
    if (state.manaSettings.status !== 'ready') {
      view.append(stateMessage(document, 'unknown', { message: '現在のruntime設定を確認できていません。取得できるまで編集と保存はできません。' }));
      return view;
    }
    const data = objectValue(state.manaSettings.data);
    const defaults = objectValue(firstPresent(data.defaults, data.runtimeDefaults, data.runtime_defaults));
    const safety = objectValue(firstPresent(data.safetyLimits, data.safety_limits));
    const notifications = objectValue(data.notifications);
    const audit = objectValue(data.audit);
    const controls = {};
    const form = createElement(document, 'form', { className: 'outcome-mana-settings-form', attrs: { 'aria-label': 'Mana runtime設定の編集' } });
    const defaultFieldset = createElement(document, 'fieldset', { className: 'outcome-mana-settings-fieldset' });
    defaultFieldset.append(createElement(document, 'legend', { text: '既定値' }));
    const timeout = field(document, 'タイムアウト表示', 'input', 'timeout', settingValue(defaults, 'timeout', 'duration'), { helper: '未確認の場合は空欄のまま保持します。', attrs: { placeholder: UNKNOWN } });
    const timeoutMs = field(document, 'タイムアウト(ms)', 'input', 'timeoutMs', settingValue(defaults, 'timeoutMs', 'timeout_ms'), { attrs: { inputmode: 'numeric', placeholder: UNKNOWN } });
    const budgetUnits = field(document, '外部処理の上限', 'input', 'budgetUnits', settingValue(defaults, 'budgetUnits', 'budget_units'), { attrs: { inputmode: 'numeric', placeholder: UNKNOWN } });
    controls.timeout = timeout.input; controls.timeoutMs = timeoutMs.input; controls.budgetUnits = budgetUnits.input;
    defaultFieldset.append(timeout.label, timeoutMs.label, budgetUnits.label);
    const safetyFieldset = createElement(document, 'fieldset', { className: 'outcome-mana-settings-fieldset' });
    safetyFieldset.append(createElement(document, 'legend', { text: '安全上限' }));
    const attemptKeys = ['maxAttempts', 'max_attempts', 'attempts'];
    const knownSafetyAttemptKey = attemptKeys.find((key) => hasOwn(safety, key));
    const knownDefaultsAttemptKey = attemptKeys.find((key) => hasOwn(defaults, key));
    const rawMaxAttempts = knownSafetyAttemptKey ? safety[knownSafetyAttemptKey] : knownDefaultsAttemptKey ? defaults[knownDefaultsAttemptKey] : '';
    const maxAttemptsValue = scalarSettingValue(rawMaxAttempts);
    const maxAttempts = field(document, '最大試行回数', 'input', 'maxAttempts', maxAttemptsValue, { attrs: { inputmode: 'numeric', placeholder: UNKNOWN } });
    controls.maxAttempts = maxAttempts.input;
    safetyFieldset.append(maxAttempts.label);
    const toggleField = (labelText, name, value) => {
      const label = createElement(document, 'label', { className: 'outcome-mana-toggle-field' });
      const input = createElement(document, 'input', { attrs: { type: 'checkbox', name, id: `outcome-mana-${name}` } });
      const known = typeof value === 'boolean';
      input.checked = known && value;
      if (!known) input.disabled = true;
      label.append(input, createElement(document, 'span', { text: labelText }), createElement(document, 'small', { className: 'outcome-mana-helper', text: known ? (value ? '有効' : '無効') : UNKNOWN }));
      return { label, input };
    };
    const safeTestRequired = toggleField('安全試験を必須にする', 'safeTestRequired', firstPresent(safety.safeTestRequired, safety.safe_test_required));
    const externalEffectApproval = toggleField('外部作用に承認を要求する', 'externalEffectApproval', firstPresent(safety.externalEffectApproval, safety.external_effect_approval));
    controls.safeTestRequired = safeTestRequired.input; controls.externalEffectApproval = externalEffectApproval.input;
    safetyFieldset.append(safeTestRequired.label, externalEffectApproval.label);
    const notificationFieldset = createElement(document, 'fieldset', { className: 'outcome-mana-settings-fieldset' });
    notificationFieldset.append(createElement(document, 'legend', { text: '通知' }));
    const channel = field(document, '通知先', 'input', 'channel', settingValue(notifications, 'channel', 'destination'), { attrs: { placeholder: UNKNOWN } });
    const events = field(document, '対象イベント', 'input', 'events', settingValue(notifications, 'events', 'eventFilter', 'event_filter'), { attrs: { placeholder: UNKNOWN } });
    controls.channel = channel.input; controls.events = events.input;
    notificationFieldset.append(channel.label, events.label);
    const auditFieldset = createElement(document, 'fieldset', { className: 'outcome-mana-settings-fieldset' });
    auditFieldset.append(createElement(document, 'legend', { text: '監査' }));
    const retention = field(document, '保持期間', 'input', 'retention', settingValue(audit, 'retention', 'retentionPeriod', 'retention_period'), { attrs: { placeholder: UNKNOWN } });
    const auditDestination = field(document, '監査保存先', 'input', 'auditDestination', settingValue(audit, 'destination', 'location'), { attrs: { placeholder: UNKNOWN } });
    controls.retention = retention.input; controls.auditDestination = auditDestination.input;
    auditFieldset.append(retention.label, auditDestination.label);
    form.append(defaultFieldset, safetyFieldset, notificationFieldset, auditFieldset);
    const actions = createElement(document, 'div', { className: 'outcome-mana-actions' });
    const saveTarget = settingsSaveTarget();
    actions.append(button(document, 'Mana設定を保存', () => saveManaSettings(settingsDraftFromFields(data, controls)), { className: 'outcome-mana-button outcome-mana-button-primary', disabled: state.manaSettings.status !== 'ready' || state.manaSettings.saveStatus === 'saving' || !saveTarget || !canManage(currentSession()) }));
    if (!saveTarget) actions.append(createElement(document, 'small', { className: 'outcome-mana-helper', text: '設定保存経路は未確認です。読み取り専用のまま保持しています。' }));
    if (state.manaSettings.saveStatus === 'saved_unverified') actions.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: '保存応答は受け取りましたが、設定のreadbackを確認できていません。', attrs: { role: 'alert' } }));
    if (state.manaSettings.saveStatus === 'error_retryable') actions.append(createElement(document, 'p', { className: 'outcome-mana-inline-error', text: state.manaSettings.saveError?.message ?? '設定を保存できませんでした。', attrs: { role: 'alert' } }));
    form.append(actions);
    const rail = createElement(document, 'aside', { className: 'outcome-mana-settings-rail', attrs: { 'aria-label': 'Mana設定の適用範囲' } });
    rail.append(createElement(document, 'span', { className: 'outcome-mana-eyebrow', text: '適用範囲' }), createElement(document, 'h3', { text: 'runtime全体' }));
    rail.append(definitionList(document, [['取得状態', state.manaSettings.status === 'ready' ? '取得済み' : UNKNOWN], ['保存状態', state.manaSettings.saveStatus === 'ready' ? '保存済み・readback確認済み' : state.manaSettings.saveStatus === 'saved_unverified' ? '保存済み・確認待ち' : UNKNOWN], ['実効権限', '委任契約の版で確定'], ['外部作用', '委任単位の許可範囲に従う']]));
    rail.append(createElement(document, 'p', { className: 'outcome-mana-safe-note', text: 'runtimeの既定値は初期値です。実効権限、利用可能な資源、外部作用は委任契約の版が所有します。' }));
    const layout = createElement(document, 'div', { className: 'outcome-mana-settings-layout' });
    layout.append(form, rail);
    view.append(layout); return view;
  }

  function renderStageNavigator() {
    const nav = createElement(document, 'nav', { className: 'outcome-mana-stage-nav', attrs: { 'aria-label': 'Manaの設定工程' } });
    const list = createElement(document, 'ol', { className: 'outcome-mana-stage-list' });
    const activeStage = derivedActiveStage();
    for (const [index, stage] of WORKFLOW_STAGES.entries()) {
      const item = createElement(document, 'li', { className: `outcome-mana-stage-item${activeStage === stage.id ? ' is-active' : ''}` });
      const status = stageStatus(stage.id);
      const stageButton = button(document, '', () => { setActiveStage(stage.id); render(); }, {
        className: 'outcome-mana-stage-button',
        attrs: {
          'aria-current': activeStage === stage.id ? 'step' : 'false',
          'aria-controls': 'outcome-mana-stage-workspace',
          'aria-label': `${stage.label} / ${statusLabel(status)}`,
        },
      });
      const stageCopy = createElement(document, 'span', { className: 'outcome-mana-stage-copy' });
      stageCopy.append(
        createElement(document, 'strong', { text: stage.label }),
        createElement(document, 'small', { text: stage.description }),
      );
      stageButton.append(
        createElement(document, 'span', { className: 'outcome-mana-stage-number', text: String(index + 1).padStart(2, '0'), attrs: { 'aria-hidden': 'true' } }),
        stageCopy,
        statusBadge(document, status),
      );
      item.append(stageButton);
      list.append(item);
    }
    nav.append(list);
    return nav;
  }

  function renderStageWorkspace() {
    const activeStage = derivedActiveStage();
    const workspace = createElement(document, 'section', {
      className: 'outcome-mana-stage-workspace',
      attrs: { id: 'outcome-mana-stage-workspace', 'aria-label': `${WORKFLOW_STAGES.find((stage) => stage.id === activeStage)?.label ?? 'Mana'}の作業領域`, 'aria-live': 'polite' },
    });
    const renderers = {
      contract: renderContractSection,
      authority: renderAuthoritySection,
      triggers: renderTriggersSection,
      safe_test: renderSafeTestSection,
      runs: renderRunsSection,
    };
    const panel = renderers[activeStage]?.() ?? renderContractSection();
    panel.className = `${panel.className} outcome-mana-stage-panel`;
    panel.setAttribute?.('data-stage', activeStage);
    workspace.append(panel);
    return workspace;
  }

  function render(target = root) {
    const destination = target;
    const activeStage = derivedActiveStage();
    if (!destination) {
      const fragment = document.createDocumentFragment?.() ?? createElement(document, 'div');
      fragment.append(renderStageNavigator(), renderStageWorkspace());
      return fragment;
    }
    clearElement(destination);
    const activeView = derivedActiveView();
    const wrapper = createElement(document, 'div', { className: 'outcome-mana-root', attrs: { 'data-project-code': currentProject().code ?? '', 'data-active-stage': activeStage, 'data-active-view': activeView } });
    const header = createElement(document, 'header', { className: 'outcome-mana-header' });
    const headerCopy = createElement(document, 'div', { className: 'outcome-mana-header-copy' });
    headerCopy.append(createElement(document, 'div', { className: 'outcome-mana-eyebrow', text: 'BRAINBASE / MANA' }), createElement(document, 'h1', { text: 'Manaに任せる仕事' }), createElement(document, 'p', { text: `${present(currentProject().name, 'プロジェクト未確認')} / ${present(currentProject().code, 'プロジェクトコード未確認')} / セッション: ${present(currentSession().displayName ?? currentSession().actorId, '利用者未確認')}` }));
    header.append(headerCopy, statusBadge(document, currentContract()?.status ?? state.contract.status));
    const renderers = { overview: renderOverviewView, delegation_settings: renderDelegationSettings, connections: renderConnectionsView, runs: renderRunsView, settings: renderSettingsView };
    wrapper.append(header, renderWorkspaceNavigation(), renderers[activeView]?.() ?? renderOverviewView());
    destination.append(wrapper); return destination;
  }

  const controller = {
    state,
    render,
    setActiveView: (id) => { setActiveView(id); render(); return state.activeView; },
    setActiveStage: (id) => { setActiveStage(id); render(); return state.activeStage; },
    load: loadContracts,
    loadContracts,
    loadContractDetail,
    loadConnections,
    loadManaSettings,
    loadTriggerCatalog,
    saveContractDraft,
    cloneContract,
    retireContract,
    loadAuthority,
    saveAuthority,
    saveTriggers,
    runSafeTest,
    activate,
    stopActivation,
    loadRuns,
    loadRunDetail,
    saveManaSettings,
    approveRun: (id, input = {}) => runAction('approve', input, id),
    rejectRun: (id, input = {}) => runAction('reject', input, id),
    retryRun: (id, input = {}) => runAction('retry', input, id),
    stopRun: (id, input = {}) => runAction('stop', input, id),
    paths: currentPaths,
  };
  if (root && options.autoLoad !== false) {
    render();
    if (typeof api === 'function') loadContracts();
  } else if (root) render();
  return controller;
}

export function renderManaOutcome(target, options = {}) {
  return createManaOutcomeUI({ ...options, root: target, autoLoad: options.autoLoad ?? false }).render();
}

export const createOutcomeManaUI = createManaOutcomeUI;
export const renderOutcomeMana = renderManaOutcome;
export { authorityLabel, triggerLabel, statusLabel, normalizeError, isReadbackVerified };
export default createManaOutcomeUI;
