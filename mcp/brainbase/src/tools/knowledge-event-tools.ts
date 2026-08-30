import { createHash } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateProject,
  fetchAuthenticatedJson,
  toolError,
  type AuthenticatedApiDependencies,
  type ToolResult
} from './authenticated-api-tool.js';

const EVENT_SCHEMA = 'knowledge_event.v1';
const PAYLOAD_SCHEMA = 'vibepro-development-learning.v1';
const EVENT_ID_PATTERN = /^kev_[a-f0-9]{64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const SOURCE_REF_PATTERN = /^(?:github|repo):\/\/([^@#\s]+)@([a-f0-9]{40})#([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const COMPUTED_EVIDENCE_SOURCES = new Set(['runner_direct', 'ci_import', 'autopilot_run']);
const SENSITIVE_CONTENT = [
  /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/iu,
  /\bsk-[a-z0-9_-]{8,}\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
] as const;

interface JsonRecord {
  [key: string]: unknown;
}

export interface VibeProKnowledgeEvent {
  schema_version: 'knowledge_event.v1';
  event_id: string;
  occurred_at: string;
  captured_at: string;
  source: {
    type: 'vibepro';
    ref: string;
  };
  subject: {
    type: 'development_learning';
    id: string;
  };
  decision_authority: {
    kind: 'development_learning_candidate';
    authorized: false;
    graph_promotion_allowed: false;
  };
  applicability_scope: {
    scope: 'project';
    project_code: string;
  };
  permission_snapshot: {
    knowledge_registration: true;
    external_action: false;
    graph_promotion: false;
    visibility: 'team';
    sensitivity: 'internal';
  };
  source_pointer: {
    uri: string;
  };
  body_hash: string;
  parent_episode_id: string;
  payload: {
    schema_version: 'vibepro-development-learning.v1';
    story_id: string;
    summary: string;
    context_digest: string;
    verification_evidence: {
      artifact_digest: string;
      head_sha: string;
      passing_kinds: string[];
      evidence_sources: Array<'runner_direct' | 'ci_import' | 'autopilot_run'>;
    };
    knowledge_reference_count: number;
  };
}

export interface KnowledgeEventToolDependencies extends AuthenticatedApiDependencies {}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalKnowledgeEventJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalKnowledgeEventJson(entry)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareCodePoints).map((key) => {
      if (value[key] === undefined) throw new TypeError('canonical JSON does not support undefined');
      return `${JSON.stringify(key)}:${canonicalKnowledgeEventJson(value[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function knowledgeEventSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertExactKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) throw new Error(`${label} has unsupported fields: ${unexpected.sort(compareCodePoints).join(', ')}`);
}

function requiredString(value: unknown, label: string, maxLength = 2000): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} contains control characters`);
  return value;
}

function exactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new Error(`${label} must be ${expected}`);
}

function exactBoolean(value: unknown, expected: boolean, label: string): void {
  if (value !== expected) throw new Error(`${label} must be ${expected}`);
}

function digest(value: unknown, label: string): string {
  const text = requiredString(value, label, 64);
  if (!SHA256_PATTERN.test(text)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return text;
}

function gitSha(value: unknown, label: string): string {
  const text = requiredString(value, label, 40);
  if (!GIT_SHA_PATTERN.test(text)) throw new Error(`${label} must be a lowercase 40-character Git SHA`);
  return text;
}

function safeIdentifier(value: unknown, label: string): string {
  const text = requiredString(value, label, 200);
  if (!SAFE_IDENTIFIER_PATTERN.test(text)) {
    throw new Error(`${label} must contain only letters, numbers, dot, underscore, or hyphen`);
  }
  return text;
}

function isoInstant(value: unknown, label: string): string {
  const text = requiredString(value, label, 40);
  if (!ISO_INSTANT_PATTERN.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${label} must be an RFC 3339 instant`);
  }
  return text;
}

function uniqueStrings(value: unknown, label: string, allowed?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error(`${label} must be a non-empty array with at most 50 values`);
  }
  const values = value.map((entry, index) => requiredString(entry, `${label}[${index}]`, 100));
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`);
  if (allowed) {
    const unsupported = values.filter((entry) => !allowed.has(entry));
    if (unsupported.length > 0) throw new Error(`${label} contains unsupported values: ${unsupported.join(', ')}`);
  }
  return values;
}

function validateSummary(value: unknown): string {
  const summary = requiredString(value, 'event.payload.summary', 2000);
  if (SENSITIVE_CONTENT.some((pattern) => pattern.test(summary))) {
    throw new Error('event.payload.summary contains sensitive content');
  }
  return summary;
}

export function validateVibeProKnowledgeEvent(value: unknown): VibeProKnowledgeEvent {
  const event = asRecord(value, 'event');
  assertExactKeys(event, [
    'schema_version', 'event_id', 'occurred_at', 'captured_at', 'source', 'subject',
    'decision_authority', 'applicability_scope', 'permission_snapshot', 'source_pointer',
    'body_hash', 'parent_episode_id', 'payload'
  ], 'event');

  exactString(event.schema_version, EVENT_SCHEMA, 'event.schema_version');
  const eventId = requiredString(event.event_id, 'event.event_id', 68);
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('event.event_id must be kev_<lowercase SHA-256>');
  const occurredAt = isoInstant(event.occurred_at, 'event.occurred_at');
  const capturedAt = isoInstant(event.captured_at, 'event.captured_at');
  if (Date.parse(capturedAt) < Date.parse(occurredAt)) {
    throw new Error('event.captured_at must not precede event.occurred_at');
  }

  const source = asRecord(event.source, 'event.source');
  assertExactKeys(source, ['type', 'ref'], 'event.source');
  exactString(source.type, 'vibepro', 'event.source.type');
  const sourceRef = requiredString(source.ref, 'event.source.ref', 500);
  const sourceMatch = sourceRef.match(SOURCE_REF_PATTERN);
  if (!sourceMatch) throw new Error('event.source.ref must bind a repository, Git HEAD, and Story');
  const [, repositoryRef, sourceHeadSha, sourceStoryId] = sourceMatch;

  const subject = asRecord(event.subject, 'event.subject');
  assertExactKeys(subject, ['type', 'id'], 'event.subject');
  exactString(subject.type, 'development_learning', 'event.subject.type');
  const subjectId = requiredString(subject.id, 'event.subject.id', 300);

  const authority = asRecord(event.decision_authority, 'event.decision_authority');
  assertExactKeys(authority, ['kind', 'authorized', 'graph_promotion_allowed'], 'event.decision_authority');
  exactString(authority.kind, 'development_learning_candidate', 'event.decision_authority.kind');
  exactBoolean(authority.authorized, false, 'event.decision_authority.authorized');
  exactBoolean(authority.graph_promotion_allowed, false, 'event.decision_authority.graph_promotion_allowed');

  const applicability = asRecord(event.applicability_scope, 'event.applicability_scope');
  assertExactKeys(applicability, ['scope', 'project_code'], 'event.applicability_scope');
  exactString(applicability.scope, 'project', 'event.applicability_scope.scope');
  const projectCode = safeIdentifier(applicability.project_code, 'event.applicability_scope.project_code');

  const permission = asRecord(event.permission_snapshot, 'event.permission_snapshot');
  assertExactKeys(permission, [
    'knowledge_registration', 'external_action', 'graph_promotion', 'visibility', 'sensitivity'
  ], 'event.permission_snapshot');
  exactBoolean(permission.knowledge_registration, true, 'event.permission_snapshot.knowledge_registration');
  exactBoolean(permission.external_action, false, 'event.permission_snapshot.external_action');
  exactBoolean(permission.graph_promotion, false, 'event.permission_snapshot.graph_promotion');
  exactString(permission.visibility, 'team', 'event.permission_snapshot.visibility');
  exactString(permission.sensitivity, 'internal', 'event.permission_snapshot.sensitivity');

  const pointer = asRecord(event.source_pointer, 'event.source_pointer');
  assertExactKeys(pointer, ['uri'], 'event.source_pointer');
  const sourcePointer = requiredString(pointer.uri, 'event.source_pointer.uri', 1000);

  const payload = asRecord(event.payload, 'event.payload');
  assertExactKeys(payload, [
    'schema_version', 'story_id', 'summary', 'context_digest',
    'verification_evidence', 'knowledge_reference_count'
  ], 'event.payload');
  exactString(payload.schema_version, PAYLOAD_SCHEMA, 'event.payload.schema_version');
  const storyId = safeIdentifier(payload.story_id, 'event.payload.story_id');
  const summary = validateSummary(payload.summary);
  const contextDigest = digest(payload.context_digest, 'event.payload.context_digest');

  const evidence = asRecord(payload.verification_evidence, 'event.payload.verification_evidence');
  assertExactKeys(evidence, ['artifact_digest', 'head_sha', 'passing_kinds', 'evidence_sources'], 'event.payload.verification_evidence');
  const artifactDigest = digest(evidence.artifact_digest, 'event.payload.verification_evidence.artifact_digest');
  const evidenceHeadSha = gitSha(evidence.head_sha, 'event.payload.verification_evidence.head_sha');
  const passingKinds = uniqueStrings(evidence.passing_kinds, 'event.payload.verification_evidence.passing_kinds');
  const evidenceSources = uniqueStrings(
    evidence.evidence_sources,
    'event.payload.verification_evidence.evidence_sources',
    COMPUTED_EVIDENCE_SOURCES
  ) as Array<'runner_direct' | 'ci_import' | 'autopilot_run'>;

  if (!Number.isInteger(payload.knowledge_reference_count) || Number(payload.knowledge_reference_count) < 0) {
    throw new Error('event.payload.knowledge_reference_count must be a non-negative integer');
  }
  const knowledgeReferenceCount = Number(payload.knowledge_reference_count);
  const bodyHash = digest(event.body_hash, 'event.body_hash');
  const parentEpisodeId = requiredString(event.parent_episode_id, 'event.parent_episode_id', 500);

  if (storyId !== sourceStoryId) throw new Error('event payload Story does not match event.source.ref');
  if (evidenceHeadSha !== sourceHeadSha) throw new Error('verification Git HEAD does not match event.source.ref');
  if (subjectId !== `vibepro:${storyId}:${sourceHeadSha}`) {
    throw new Error('event.subject.id does not match the VibePro Story and Git HEAD');
  }
  const expectedPointer = `vibepro://${repositoryRef}/${encodeURIComponent(storyId)}?sha=${sourceHeadSha}`;
  if (sourcePointer !== expectedPointer) throw new Error('event.source_pointer.uri does not match event.source.ref');

  const normalizedPayload: VibeProKnowledgeEvent['payload'] = {
    schema_version: PAYLOAD_SCHEMA,
    story_id: storyId,
    summary,
    context_digest: contextDigest,
    verification_evidence: {
      artifact_digest: artifactDigest,
      head_sha: evidenceHeadSha,
      passing_kinds: passingKinds,
      evidence_sources: evidenceSources
    },
    knowledge_reference_count: knowledgeReferenceCount
  };
  const expectedBodyHash = knowledgeEventSha256(canonicalKnowledgeEventJson(normalizedPayload));
  if (bodyHash !== expectedBodyHash) throw new Error('event.body_hash does not match event.payload');

  const expectedEventId = `kev_${knowledgeEventSha256(canonicalKnowledgeEventJson([
    PAYLOAD_SCHEMA,
    sourceRef,
    subjectId,
    parentEpisodeId,
    bodyHash
  ]))}`;
  if (eventId !== expectedEventId) throw new Error('event.event_id does not match its deterministic identity');

  return {
    schema_version: EVENT_SCHEMA,
    event_id: eventId,
    occurred_at: occurredAt,
    captured_at: capturedAt,
    source: { type: 'vibepro', ref: sourceRef },
    subject: { type: 'development_learning', id: subjectId },
    decision_authority: {
      kind: 'development_learning_candidate',
      authorized: false,
      graph_promotion_allowed: false
    },
    applicability_scope: { scope: 'project', project_code: projectCode },
    permission_snapshot: {
      knowledge_registration: true,
      external_action: false,
      graph_promotion: false,
      visibility: 'team',
      sensitivity: 'internal'
    },
    source_pointer: { uri: sourcePointer },
    body_hash: bodyHash,
    parent_episode_id: parentEpisodeId,
    payload: normalizedPayload
  };
}

export const knowledgeEventTools: Tool[] = [
  {
    name: 'brainbase_knowledge_event_record',
    title: 'Record verified VibePro Knowledge Event',
    description: 'Validate a VibePro development-learning event and record it as an append-only Brainbase candidate. This never grants Graph promotion or external-action authority.',
    inputSchema: {
      type: 'object',
      required: ['event'],
      additionalProperties: false,
      properties: {
        event: {
          type: 'object',
          required: [
            'schema_version', 'event_id', 'occurred_at', 'captured_at', 'source', 'subject',
            'decision_authority', 'applicability_scope', 'permission_snapshot', 'source_pointer',
            'body_hash', 'parent_episode_id', 'payload'
          ],
          additionalProperties: false,
          properties: {
            schema_version: { const: EVENT_SCHEMA },
            event_id: { type: 'string', pattern: '^kev_[a-f0-9]{64}$' },
            occurred_at: { type: 'string', format: 'date-time' },
            captured_at: { type: 'string', format: 'date-time' },
            source: {
              type: 'object', required: ['type', 'ref'], additionalProperties: false,
              properties: { type: { const: 'vibepro' }, ref: { type: 'string', minLength: 1 } }
            },
            subject: {
              type: 'object', required: ['type', 'id'], additionalProperties: false,
              properties: { type: { const: 'development_learning' }, id: { type: 'string', minLength: 1 } }
            },
            decision_authority: {
              type: 'object', required: ['kind', 'authorized', 'graph_promotion_allowed'], additionalProperties: false,
              properties: {
                kind: { const: 'development_learning_candidate' },
                authorized: { const: false },
                graph_promotion_allowed: { const: false }
              }
            },
            applicability_scope: {
              type: 'object', required: ['scope', 'project_code'], additionalProperties: false,
              properties: {
                scope: { const: 'project' },
                project_code: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' }
              }
            },
            permission_snapshot: {
              type: 'object',
              required: ['knowledge_registration', 'external_action', 'graph_promotion', 'visibility', 'sensitivity'],
              additionalProperties: false,
              properties: {
                knowledge_registration: { const: true },
                external_action: { const: false },
                graph_promotion: { const: false },
                visibility: { const: 'team' },
                sensitivity: { const: 'internal' }
              }
            },
            source_pointer: {
              type: 'object', required: ['uri'], additionalProperties: false,
              properties: { uri: { type: 'string', pattern: '^vibepro://' } }
            },
            body_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            parent_episode_id: { type: 'string', minLength: 1, maxLength: 500 },
            payload: {
              type: 'object',
              required: [
                'schema_version', 'story_id', 'summary', 'context_digest',
                'verification_evidence', 'knowledge_reference_count'
              ],
              additionalProperties: false,
              properties: {
                schema_version: { const: PAYLOAD_SCHEMA },
                story_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' },
                summary: { type: 'string', minLength: 1, maxLength: 2000 },
                context_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                verification_evidence: {
                  type: 'object',
                  required: ['artifact_digest', 'head_sha', 'passing_kinds', 'evidence_sources'],
                  additionalProperties: false,
                  properties: {
                    artifact_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                    head_sha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
                    passing_kinds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
                    evidence_sources: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ['runner_direct', 'ci_import', 'autopilot_run'] } }
                  }
                },
                knowledge_reference_count: { type: 'integer', minimum: 0 }
              }
            }
          }
        }
      }
    }
  }
];

function validBackendResult(value: unknown, event: VibeProKnowledgeEvent): JsonRecord {
  const result = asRecord(value, 'knowledge event API response');
  if (result.event_id !== event.event_id) throw new Error('knowledge event API returned another event_id');
  const candidateId = requiredString(result.candidate_id, 'knowledge event API candidate_id', 300);
  if (result.graph_entity_id !== null && result.graph_entity_id !== undefined) {
    throw new Error('knowledge event API unexpectedly promoted the VibePro candidate to Graph');
  }
  if (result.processing_stage !== 'retrievable') {
    throw new Error('knowledge event API did not finish candidate indexing');
  }
  if (result.semantic_state !== 'active') {
    throw new Error('knowledge event API did not preserve an active candidate');
  }
  return { ...result, candidate_id: candidateId };
}

export async function handleKnowledgeEventToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: KnowledgeEventToolDependencies
): Promise<ToolResult | null> {
  if (name !== 'brainbase_knowledge_event_record') return null;

  let event: VibeProKnowledgeEvent;
  try {
    assertExactKeys(args, ['event'], 'arguments');
    event = validateVibeProKnowledgeEvent(args.event);
  } catch (error) {
    return toolError('knowledge_event_invalid', error instanceof Error ? error.message : String(error));
  }

  try {
    const context = await authenticateProject({
      project_code: event.applicability_scope.project_code
    }, dependencies);
    const backend = validBackendResult(await fetchAuthenticatedJson(dependencies, context, {
      method: 'POST',
      path: '/api/knowledge/events',
      body: event
    }), event);
    const candidateId = String(backend.candidate_id);
    return {
      status: 'ok',
      scope: { project_codes: context.scope },
      data: {
        schema_version: 'brainbase-vibepro-knowledge-event-record-receipt.v1',
        status: backend.idempotent === true ? 'already_recorded' : 'recorded',
        event_id: event.event_id,
        project_code: event.applicability_scope.project_code,
        story_id: event.payload.story_id,
        body_hash: event.body_hash,
        parent_episode_id: event.parent_episode_id,
        candidate_id: candidateId,
        processing_stage: 'retrievable',
        candidate_only: true,
        graph_promoted: false,
        external_action_executed: false,
        record_ref: `brainbase://knowledge-events/${event.event_id}`,
        candidate_ref: `brainbase://knowledge-candidates/${candidateId}`
      }
    };
  } catch (error) {
    return toolError('knowledge_event_record_failed', error instanceof Error ? error.message : String(error));
  }
}
