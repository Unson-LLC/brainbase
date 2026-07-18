import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TokenManagerLike {
  getToken(): Promise<string>;
}

interface ControlPlaneDependencies {
  apiUrl: string;
  configuredProjectCodes?: string[];
  tokenManager: TokenManagerLike;
  fetch?: FetchLike;
  now?: () => Date;
  requestId?: () => string;
}

interface ProjectCatalogItem {
  id: string;
  name?: string;
  healthStatus?: string;
  [key: string]: unknown;
}

interface RunReceiptInboxItem {
  project_id: string;
  [key: string]: unknown;
}

interface RunReceiptSourceIdentity {
  type: string;
  identity: string;
}

interface RunReceiptDiagnosis {
  state: string;
  issue_codes: string[];
  recommended_action: string | null;
}

interface AutomationRunDetail {
  project_id: string;
  [key: string]: unknown;
}

interface MeetingAutomationDiagnosis {
  project_id: string;
  state: string;
  issue_codes: string[];
  recommended_actions: string[];
  [key: string]: unknown;
}

interface ControlPlaneData {
  projects?: ProjectCatalogItem[];
  items?: RunReceiptInboxItem[];
  source?: RunReceiptSourceIdentity;
  receipt?: RunReceiptInboxItem;
  diagnosis?: RunReceiptDiagnosis;
  run?: AutomationRunDetail;
  run_steps?: Record<string, unknown>[];
  context_snapshots?: Record<string, unknown>[];
  human_steps?: Record<string, unknown>[];
  outputs?: Record<string, unknown>[];
  audit_logs?: Record<string, unknown>[];
  human_step?: Record<string, unknown>;
  resumed_run?: AutomationRunDetail | null;
  meeting_automation?: MeetingAutomationDiagnosis;
  count?: number;
  has_more?: boolean;
  omitted_count?: number;
}

interface AuditEvidence {
  request_id: string;
  tool: string;
  operation: 'read' | 'write';
  actor: string | null;
  role: string | null;
  project_codes: string[];
  observed_at: string;
  source: string;
}

export interface ControlPlaneResult {
  status: 'ok' | 'unavailable' | 'error';
  scope: { project_codes: string[] };
  audit: AuditEvidence;
  data?: ControlPlaneData;
  error?: { code: string; message: string; http_status?: number };
}

interface AccessClaims {
  actor: string | null;
  role: string | null;
  projectCodes: string[];
}

export const controlPlaneTools: Tool[] = [
  {
    name: 'brainbase_projects',
    description:
      'List the authenticated Brainbase project catalog. Returns a structured status that distinguishes confirmed empty results from unavailable or error states, with project-scope and audit evidence.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'brainbase_run_receipt_inbox',
    description:
      'Read the authenticated Brainbase Run Receipt Inbox for cross-runtime automation evidence. Keeps blocked, unconfirmed, no_data, unavailable, and error states distinct. This is an operational receipt reader, not generic Workflow CRUD.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project ID within the authenticated project scope.',
        },
        source_type: {
          type: 'string',
          enum: ['mana', 'codex_automations', 'github_actions', 'salestailor'],
          description: 'Optional automation runtime filter.',
        },
        run_status: {
          type: 'string',
          enum: ['success', 'failed', 'blocked', 'waiting_human', 'cancelled'],
          description: 'Optional source run status filter.',
        },
        evidence_state: {
          type: 'string',
          enum: ['confirmed', 'unconfirmed', 'no_data'],
          description: 'Optional evidence confidence filter.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of receipt identities to return. Defaults to 100.',
        },
      },
    },
  },
  {
    name: 'brainbase_run_receipt_history',
    description:
      'Read the authenticated execution history for one Run Receipt source identity. Preserves blocked, unconfirmed, no_data, unavailable, and error states and does not expose generic Workflow CRUD.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID within the authenticated project scope.',
        },
        source_type: {
          type: 'string',
          enum: ['mana', 'codex_automations', 'github_actions', 'salestailor'],
          description: 'Automation runtime type.',
        },
        source_identity: {
          type: 'string',
          description: 'Stable runtime-local workflow, automation, or job identity.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of receipts to return. Defaults to 100.',
        },
      },
      required: ['project_id', 'source_type', 'source_identity'],
    },
  },
  {
    name: 'brainbase_run_receipt_diagnosis',
    description:
      'Diagnose one authenticated Run Receipt without flattening blocked, failed, waiting_human, unconfirmed, or no_data into success. Returns structured issue codes and a recommended action.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID within the authenticated project scope.',
        },
        run_id: {
          type: 'string',
          description: 'Brainbase Run Receipt ID.',
        },
      },
      required: ['project_id', 'run_id'],
    },
  },
  {
    name: 'brainbase_automation_run_detail',
    description:
      'Read one authenticated Automation Run with its steps, approval state, outputs, and audit trail. This is a run-ledger reader and does not expose generic Workflow creation or editing.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID within the authenticated project scope.' },
        run_id: { type: 'string', description: 'Automation Run ID.' },
      },
      required: ['project_id', 'run_id'],
    },
  },
  {
    name: 'brainbase_automation_human_step_resolve',
    description:
      'Approve or reject one pending human step in an authenticated Automation Run. The write is explicit, scoped, and recorded as audit evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID within the authenticated project scope.' },
        run_id: { type: 'string', description: 'Automation Run ID.' },
        step_id: { type: 'string', description: 'Pending human step ID.' },
        resolution: { type: 'string', enum: ['approved', 'rejected'] },
        reason: { type: 'string', description: 'Optional operator reason recorded with the resolution.' },
      },
      required: ['project_id', 'run_id', 'step_id', 'resolution'],
    },
  },
  {
    name: 'brainbase_meeting_automation_diagnosis',
    description:
      'Diagnose Meeting Automation source connectivity and the latest scheduled sync without flattening blocked, unconfirmed, no_data, failed, or healthy states.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID within the authenticated project scope.' },
      },
      required: ['project_id'],
    },
  },
];

const RUN_RECEIPT_SOURCE_TYPES = new Set(['mana', 'codex_automations', 'github_actions', 'salestailor']);
const RUN_RECEIPT_STATUSES = new Set(['success', 'failed', 'blocked', 'waiting_human', 'cancelled']);
const RUN_RECEIPT_EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const HUMAN_STEP_RESOLUTIONS = new Set(['approved', 'rejected']);

function normalizeProjectCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  return normalized || null;
}

function normalizeProjectCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeProjectCode).filter((code): code is string => Boolean(code)))];
}

function decodeAccessClaims(token: string): AccessClaims {
  const jwt = token.startsWith('bbsvc_') ? token.slice('bbsvc_'.length) : token;
  const payloadSegment = jwt.split('.')[1];
  if (!payloadSegment) throw new Error('Token does not contain JWT claims');

  let payload: Record<string, unknown>;
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new Error('Token claims could not be decoded');
  }

  return {
    actor: typeof payload.sub === 'string'
      ? payload.sub
      : typeof payload.personId === 'string'
        ? payload.personId
        : null,
    role: typeof payload.role === 'string' ? payload.role.toLowerCase() : null,
    projectCodes: normalizeProjectCodes(payload.projectCodes),
  };
}

function effectiveProjectCodes(tokenCodes: string[], configuredCodes?: string[]): string[] {
  const configured = normalizeProjectCodes(configuredCodes);
  if (configured.length === 0) return tokenCodes;
  const allowed = new Set(configured);
  return tokenCodes.filter((code) => allowed.has(code));
}

function projectId(project: ProjectCatalogItem): string | null {
  return normalizeProjectCode(project.id);
}

function optionalStringArgument(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function requiredStringArgument(args: Record<string, unknown>, key: string): string {
  const value = optionalStringArgument(args, key);
  if (value === null) throw new Error(`${key} is required`);
  return value;
}

function optionalEnumArgument(
  args: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
): string | null {
  const value = optionalStringArgument(args, key);
  if (value === null) return null;
  if (!allowed.has(value)) {
    throw new Error(`${key} must be one of: ${[...allowed].join(', ')}`);
  }
  return value;
}

function runReceiptInboxSource(
  apiUrl: string,
  args: Record<string, unknown>,
): { source: string; projectId: string | null } {
  const url = new URL('/api/run-receipts/inbox', `${apiUrl.replace(/\/+$/, '')}/`);
  const requestedProject = optionalStringArgument(args, 'project_id');
  const normalizedProject = requestedProject ? normalizeProjectCode(requestedProject) : null;
  if (requestedProject && !normalizedProject) throw new Error('project_id is invalid');

  const sourceType = optionalEnumArgument(args, 'source_type', RUN_RECEIPT_SOURCE_TYPES);
  const runStatus = optionalEnumArgument(args, 'run_status', RUN_RECEIPT_STATUSES);
  const evidenceState = optionalEnumArgument(args, 'evidence_state', RUN_RECEIPT_EVIDENCE_STATES);
  const rawLimit = args.limit;
  let limit: number | null = null;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    if (typeof rawLimit !== 'number' || !Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
      throw new Error('limit must be an integer between 1 and 200');
    }
    limit = rawLimit;
  }

  if (normalizedProject) url.searchParams.set('project_id', normalizedProject);
  if (sourceType) url.searchParams.set('source_type', sourceType);
  if (runStatus) url.searchParams.set('run_status', runStatus);
  if (evidenceState) url.searchParams.set('evidence_state', evidenceState);
  if (limit !== null) url.searchParams.set('limit', String(limit));

  return { source: url.toString(), projectId: normalizedProject };
}

function normalizeRequiredProject(args: Record<string, unknown>): string {
  const requestedProject = requiredStringArgument(args, 'project_id');
  const normalizedProject = normalizeProjectCode(requestedProject);
  if (!normalizedProject) throw new Error('project_id is invalid');
  return normalizedProject;
}

function optionalRunReceiptLimit(args: Record<string, unknown>): number | null {
  const rawLimit = args.limit;
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') return null;
  if (typeof rawLimit !== 'number' || !Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
    throw new Error('limit must be an integer between 1 and 200');
  }
  return rawLimit;
}

function runReceiptHistorySource(
  apiUrl: string,
  args: Record<string, unknown>,
): { source: string; projectId: string } {
  const url = new URL('/api/run-receipts/history', `${apiUrl.replace(/\/+$/, '')}/`);
  const projectId = normalizeRequiredProject(args);
  const sourceType = optionalEnumArgument(args, 'source_type', RUN_RECEIPT_SOURCE_TYPES);
  if (!sourceType) throw new Error('source_type is required');
  const sourceIdentity = requiredStringArgument(args, 'source_identity');
  const limit = optionalRunReceiptLimit(args);

  url.searchParams.set('project_id', projectId);
  url.searchParams.set('source_type', sourceType);
  url.searchParams.set('source_identity', sourceIdentity);
  if (limit !== null) url.searchParams.set('limit', String(limit));
  return { source: url.toString(), projectId };
}

function runReceiptDiagnosisSource(
  apiUrl: string,
  args: Record<string, unknown>,
): { source: string; projectId: string } {
  const projectId = normalizeRequiredProject(args);
  const runId = requiredStringArgument(args, 'run_id');
  const url = new URL(
    `/api/run-receipts/${encodeURIComponent(runId)}/diagnosis`,
    `${apiUrl.replace(/\/+$/, '')}/`,
  );
  url.searchParams.set('project_id', projectId);
  return { source: url.toString(), projectId };
}

interface ControlPlaneRequest {
  source: string;
  projectId: string | null;
  init: RequestInit;
  operation: 'read' | 'write';
}

function automationRunDetailRequest(
  apiUrl: string,
  args: Record<string, unknown>,
): ControlPlaneRequest {
  const projectId = normalizeRequiredProject(args);
  const runId = requiredStringArgument(args, 'run_id');
  const url = new URL(
    `/api/workflow-runs/${encodeURIComponent(runId)}`,
    `${apiUrl.replace(/\/+$/, '')}/`,
  );
  return { source: url.toString(), projectId, init: { method: 'GET' }, operation: 'read' };
}

function automationHumanStepResolveRequest(
  apiUrl: string,
  args: Record<string, unknown>,
): ControlPlaneRequest {
  const projectId = normalizeRequiredProject(args);
  const runId = requiredStringArgument(args, 'run_id');
  const stepId = requiredStringArgument(args, 'step_id');
  const resolution = optionalEnumArgument(args, 'resolution', HUMAN_STEP_RESOLUTIONS);
  if (!resolution) throw new Error('resolution is required');
  const reason = optionalStringArgument(args, 'reason');
  const url = new URL(
    `/api/workflow-runs/${encodeURIComponent(runId)}/human-steps/${encodeURIComponent(stepId)}/resolve`,
    `${apiUrl.replace(/\/+$/, '')}/`,
  );
  return {
    source: url.toString(),
    projectId,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution, ...(reason ? { reason } : {}) }),
    },
    operation: 'write',
  };
}

function meetingAutomationDiagnosisRequest(
  apiUrl: string,
  args: Record<string, unknown>,
): ControlPlaneRequest {
  const projectId = normalizeRequiredProject(args);
  const url = new URL(
    '/api/settings/meeting-sources/diagnosis',
    `${apiUrl.replace(/\/+$/, '')}/`,
  );
  url.searchParams.set('project_id', projectId);
  return { source: url.toString(), projectId, init: { method: 'GET' }, operation: 'read' };
}

function parseRunReceiptInbox(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected a Run Receipt Inbox object');
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.items)) throw new Error('Run Receipt Inbox items must be an array');
  const items = record.items.filter((item): item is RunReceiptInboxItem => (
    Boolean(item)
      && typeof item === 'object'
      && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).project_id === 'string'
  ));
  if (items.length !== record.items.length) throw new Error('Run Receipt Inbox contains invalid items');

  const count = record.count;
  const hasMore = record.has_more;
  const omittedCount = record.omitted_count;
  if (!Number.isSafeInteger(count) || (count as number) < items.length) {
    throw new Error('Run Receipt Inbox count is invalid');
  }
  if (typeof hasMore !== 'boolean') throw new Error('Run Receipt Inbox has_more is invalid');
  if (!Number.isSafeInteger(omittedCount) || (omittedCount as number) < 0) {
    throw new Error('Run Receipt Inbox omitted_count is invalid');
  }
  if ((omittedCount as number) !== (count as number) - items.length) {
    throw new Error('Run Receipt Inbox omitted_count does not match count');
  }
  if (hasMore !== ((omittedCount as number) > 0)) {
    throw new Error('Run Receipt Inbox has_more does not match omitted_count');
  }

  const allowed = new Set(scope);
  if (items.some((item) => {
    const normalized = normalizeProjectCode(item.project_id);
    return !normalized || !allowed.has(normalized);
  })) {
    throw new Error('Run Receipt Inbox contains an item outside the authenticated project scope');
  }

  return {
    items,
    count: count as number,
    has_more: hasMore,
    omitted_count: omittedCount as number,
  };
}

function parseRunReceiptHistory(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected a Run Receipt history object');
  }
  const record = payload as Record<string, unknown>;
  const source = record.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Run Receipt history source is invalid');
  }
  const sourceRecord = source as Record<string, unknown>;
  if (typeof sourceRecord.type !== 'string' || typeof sourceRecord.identity !== 'string') {
    throw new Error('Run Receipt history source identity is invalid');
  }
  const page = parseRunReceiptInbox(payload, scope);
  return {
    ...page,
    source: {
      type: sourceRecord.type,
      identity: sourceRecord.identity,
    },
  };
}

function parseRunReceiptDiagnosis(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected a Run Receipt diagnosis object');
  }
  const record = payload as Record<string, unknown>;
  const receipt = record.receipt;
  const diagnosis = record.diagnosis;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Run Receipt diagnosis receipt is invalid');
  }
  const receiptRecord = receipt as RunReceiptInboxItem;
  const normalizedProject = normalizeProjectCode(receiptRecord.project_id);
  if (!normalizedProject || !scope.includes(normalizedProject)) {
    throw new Error('Run Receipt diagnosis is outside the authenticated project scope');
  }
  if (!diagnosis || typeof diagnosis !== 'object' || Array.isArray(diagnosis)) {
    throw new Error('Run Receipt diagnosis result is invalid');
  }
  const diagnosisRecord = diagnosis as Record<string, unknown>;
  if (
    typeof diagnosisRecord.state !== 'string'
    || !Array.isArray(diagnosisRecord.issue_codes)
    || diagnosisRecord.issue_codes.some((code) => typeof code !== 'string')
    || (diagnosisRecord.recommended_action !== null && typeof diagnosisRecord.recommended_action !== 'string')
  ) {
    throw new Error('Run Receipt diagnosis fields are invalid');
  }

  return {
    receipt: receiptRecord,
    diagnosis: {
      state: diagnosisRecord.state,
      issue_codes: diagnosisRecord.issue_codes as string[],
      recommended_action: diagnosisRecord.recommended_action as string | null,
    },
    count: 1,
  };
}

function recordArray(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${key} must be an array of objects`);
  }
  return value as Record<string, unknown>[];
}

function parseAutomationRunDetail(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected an Automation Run detail object');
  }
  const record = payload as Record<string, unknown>;
  const run = record.run;
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error('Automation Run detail is missing run');
  }
  const runRecord = run as AutomationRunDetail;
  const normalizedProject = normalizeProjectCode(runRecord.project_id);
  if (!normalizedProject || !scope.includes(normalizedProject)) {
    throw new Error('Automation Run is outside the authenticated project scope');
  }
  return {
    run: runRecord,
    run_steps: recordArray(record, 'run_steps'),
    context_snapshots: recordArray(record, 'context_snapshots'),
    human_steps: recordArray(record, 'human_steps'),
    outputs: recordArray(record, 'outputs'),
    audit_logs: recordArray(record, 'audit_logs'),
  };
}

function parseAutomationHumanStepResolution(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected an Automation human-step resolution object');
  }
  const record = payload as Record<string, unknown>;
  const humanStep = record.human_step;
  if (!humanStep || typeof humanStep !== 'object' || Array.isArray(humanStep)) {
    throw new Error('Automation human-step resolution is missing human_step');
  }
  const resumedRun = record.resumed_run;
  if (resumedRun !== undefined && resumedRun !== null) {
    if (typeof resumedRun !== 'object' || Array.isArray(resumedRun)) {
      throw new Error('Automation resumed_run is invalid');
    }
    const normalizedProject = normalizeProjectCode((resumedRun as Record<string, unknown>).project_id);
    if (!normalizedProject || !scope.includes(normalizedProject)) {
      throw new Error('Automation resumed Run is outside the authenticated project scope');
    }
  }
  return {
    human_step: humanStep as Record<string, unknown>,
    resumed_run: (resumedRun || null) as AutomationRunDetail | null,
  };
}

function parseMeetingAutomationDiagnosis(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected a Meeting Automation diagnosis object');
  }
  const record = payload as Record<string, unknown>;
  const normalizedProject = normalizeProjectCode(record.project_id);
  if (!normalizedProject || !scope.includes(normalizedProject)) {
    throw new Error('Meeting Automation diagnosis is outside the authenticated project scope');
  }
  if (
    typeof record.state !== 'string'
    || !Array.isArray(record.issue_codes)
    || record.issue_codes.some((code) => typeof code !== 'string')
    || !Array.isArray(record.recommended_actions)
    || record.recommended_actions.some((action) => typeof action !== 'string')
  ) {
    throw new Error('Meeting Automation diagnosis fields are invalid');
  }
  return { meeting_automation: record as unknown as MeetingAutomationDiagnosis };
}

function createAudit(
  tool: string,
  source: string,
  claims: AccessClaims,
  projectCodes: string[],
  dependencies: ControlPlaneDependencies,
  operation: 'read' | 'write' = 'read',
): AuditEvidence {
  return {
    request_id: dependencies.requestId?.() || globalThis.crypto.randomUUID(),
    tool,
    operation,
    actor: claims.actor,
    role: claims.role,
    project_codes: projectCodes,
    observed_at: (dependencies.now?.() || new Date()).toISOString(),
    source,
  };
}

function failure(
  status: 'unavailable' | 'error',
  code: string,
  message: string,
  scope: string[],
  audit: AuditEvidence,
  httpStatus?: number,
): ControlPlaneResult {
  return {
    status,
    scope: { project_codes: scope },
    audit,
    error: {
      code,
      message,
      ...(httpStatus ? { http_status: httpStatus } : {}),
    },
  };
}

export async function handleControlPlaneToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: ControlPlaneDependencies,
): Promise<ControlPlaneResult | null> {
  const supportedTools = [
    'brainbase_projects',
    'brainbase_run_receipt_inbox',
    'brainbase_run_receipt_history',
    'brainbase_run_receipt_diagnosis',
    'brainbase_automation_run_detail',
    'brainbase_automation_human_step_resolve',
    'brainbase_meeting_automation_diagnosis',
  ];
  if (!supportedTools.includes(name)) return null;

  const baseUrl = dependencies.apiUrl.replace(/\/+$/, '');
  let operation: 'read' | 'write' = name === 'brainbase_automation_human_step_resolve' ? 'write' : 'read';
  let requestInit: RequestInit = { method: 'GET' };
  let source = name === 'brainbase_projects'
    ? `${baseUrl}/api/brainbase/projects`
    : name === 'brainbase_run_receipt_history'
      ? `${baseUrl}/api/run-receipts/history`
      : name === 'brainbase_run_receipt_diagnosis'
        ? `${baseUrl}/api/run-receipts/diagnosis`
        : name === 'brainbase_meeting_automation_diagnosis'
          ? `${baseUrl}/api/settings/meeting-sources/diagnosis`
          : name === 'brainbase_automation_run_detail'
            ? `${baseUrl}/api/workflow-runs/run`
            : name === 'brainbase_automation_human_step_resolve'
              ? `${baseUrl}/api/workflow-runs/run/human-steps/step/resolve`
        : `${baseUrl}/api/run-receipts/inbox`;
  let token: string;
  try {
    token = await dependencies.tokenManager.getToken();
  } catch (error) {
    const claims = { actor: null, role: null, projectCodes: [] };
    const audit = createAudit(name, source, claims, [], dependencies, operation);
    return failure(
      'unavailable',
      'brainbase_auth_unavailable',
      error instanceof Error ? error.message : String(error),
      [],
      audit,
    );
  }

  let claims: AccessClaims;
  try {
    claims = decodeAccessClaims(token);
  } catch (error) {
    const unknownClaims = { actor: null, role: null, projectCodes: [] };
    const audit = createAudit(name, source, unknownClaims, [], dependencies, operation);
    return failure(
      'error',
      'brainbase_auth_context_invalid',
      error instanceof Error ? error.message : String(error),
      [],
      audit,
    );
  }

  const scope = effectiveProjectCodes(claims.projectCodes, dependencies.configuredProjectCodes);
  let requestedProject: string | null = null;
  if (name !== 'brainbase_projects') {
    try {
      const request: ControlPlaneRequest = name === 'brainbase_run_receipt_history'
        ? { ...runReceiptHistorySource(dependencies.apiUrl, args), init: { method: 'GET' }, operation: 'read' }
        : name === 'brainbase_run_receipt_diagnosis'
          ? { ...runReceiptDiagnosisSource(dependencies.apiUrl, args), init: { method: 'GET' }, operation: 'read' }
          : name === 'brainbase_automation_run_detail'
            ? automationRunDetailRequest(dependencies.apiUrl, args)
            : name === 'brainbase_automation_human_step_resolve'
              ? automationHumanStepResolveRequest(dependencies.apiUrl, args)
              : name === 'brainbase_meeting_automation_diagnosis'
                ? meetingAutomationDiagnosisRequest(dependencies.apiUrl, args)
                : { ...runReceiptInboxSource(dependencies.apiUrl, args), init: { method: 'GET' }, operation: 'read' };
      source = request.source;
      requestedProject = request.projectId;
      requestInit = request.init;
      operation = request.operation;
    } catch (error) {
      const audit = createAudit(name, source, claims, scope, dependencies, operation);
      return failure(
        'error',
        'brainbase_input_invalid',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  const audit = createAudit(name, source, claims, scope, dependencies, operation);
  if (requestedProject && !scope.includes(requestedProject)) {
    return failure(
      'error',
      'brainbase_project_not_accessible',
      `project '${requestedProject}' is not accessible`,
      scope,
      audit,
    );
  }

  let response: Response;
  try {
    response = await (dependencies.fetch || globalThis.fetch)(source, {
      ...requestInit,
      headers: {
        ...requestInit.headers,
        Authorization: `Bearer ${token}`,
        'x-brainbase-projects': scope.join(','),
      },
    });
  } catch (error) {
    return failure(
      'unavailable',
      'brainbase_api_unavailable',
      error instanceof Error ? error.message : String(error),
      scope,
      audit,
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failure(
      'error',
      'brainbase_auth_rejected',
      `${response.status} ${response.statusText}`.trim(),
      scope,
      audit,
      response.status,
    );
  }

  if (!response.ok) {
    const unavailable = response.status >= 500;
    return failure(
      unavailable ? 'unavailable' : 'error',
      unavailable ? 'brainbase_api_unavailable' : 'brainbase_api_error',
      `${response.status} ${response.statusText}`.trim(),
      scope,
      audit,
      response.status,
    );
  }

  if (name === 'brainbase_run_receipt_inbox') {
    try {
      const data = parseRunReceiptInbox(await response.json(), scope);
      return {
        status: 'ok',
        scope: { project_codes: scope },
        audit,
        data,
      };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  if (name === 'brainbase_run_receipt_history') {
    try {
      const data = parseRunReceiptHistory(await response.json(), scope);
      return {
        status: 'ok',
        scope: { project_codes: scope },
        audit,
        data,
      };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  if (name === 'brainbase_run_receipt_diagnosis') {
    try {
      const data = parseRunReceiptDiagnosis(await response.json(), scope);
      return {
        status: 'ok',
        scope: { project_codes: scope },
        audit,
        data,
      };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  if (name === 'brainbase_automation_run_detail') {
    try {
      const data = parseAutomationRunDetail(await response.json(), scope);
      return { status: 'ok', scope: { project_codes: scope }, audit, data };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  if (name === 'brainbase_automation_human_step_resolve') {
    try {
      const data = parseAutomationHumanStepResolution(await response.json(), scope);
      return { status: 'ok', scope: { project_codes: scope }, audit, data };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  if (name === 'brainbase_meeting_automation_diagnosis') {
    try {
      const data = parseMeetingAutomationDiagnosis(await response.json(), scope);
      return { status: 'ok', scope: { project_codes: scope }, audit, data };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  let projects: ProjectCatalogItem[];
  try {
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Expected an array project catalog');
    projects = payload.filter((project): project is ProjectCatalogItem => (
      Boolean(project) && typeof project === 'object' && typeof project.id === 'string'
    ));
    if (projects.length !== payload.length) throw new Error('Project catalog contains invalid entries');
  } catch (error) {
    return failure(
      'error',
      'brainbase_contract_error',
      error instanceof Error ? error.message : String(error),
      scope,
      audit,
    );
  }

  const allowed = new Set(scope);
  const scopedProjects = projects.filter((project) => {
    const id = projectId(project);
    return id ? allowed.has(id) : false;
  });

  return {
    status: 'ok',
    scope: { project_codes: scope },
    audit,
    data: {
      projects: scopedProjects,
      count: scopedProjects.length,
    },
  };
}
