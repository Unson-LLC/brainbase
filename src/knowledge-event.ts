import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { resolveDataDir } from './paths.js';

const EVENT_SCHEMA = 'knowledge_event.v1' as const;
const EVENT_PAYLOAD_SCHEMA = 'vibepro-development-learning.v1' as const;
const STORED_RECORD_SCHEMA = 'brainbase-knowledge-event-record.v1' as const;
const RECEIPT_SCHEMA = 'brainbase-knowledge-event-record-receipt.v1' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const EVENT_ID_PATTERN = /^kev_[a-f0-9]{64}$/u;
const SOURCE_REF_PATTERN = /^(?:github|repo):\/\/([^@#\s]+)@([a-f0-9]{40})#([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const COMPUTED_EVIDENCE_SOURCES = ['runner_direct', 'ci_import', 'autopilot_run'] as const;
const SENSITIVE_CONTENT = [
  /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/iu,
  /\bsk-[a-z0-9_-]{8,}\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
] as const;

const sha256Schema = z.string().regex(SHA256_PATTERN);
const gitShaSchema = z.string().regex(GIT_SHA_PATTERN);
const safeIdSchema = z.string().regex(SAFE_ID_PATTERN);
const boundedTextSchema = z.string().min(1).max(500).refine((value) => !CONTROL_CHARACTERS.test(value), {
  message: 'control_characters_not_allowed'
});
const summarySchema = z.string().min(1).max(2000).refine((value) => !CONTROL_CHARACTERS.test(value), {
  message: 'control_characters_not_allowed'
});
const timestampSchema = z.string().datetime({ offset: true });

export const vibeProKnowledgeEventSchema = z.object({
  schema_version: z.literal(EVENT_SCHEMA),
  event_id: z.string().regex(EVENT_ID_PATTERN),
  occurred_at: timestampSchema,
  captured_at: timestampSchema,
  source: z.object({
    type: z.literal('vibepro'),
    ref: z.string().min(1).max(1000)
  }).strict(),
  subject: z.object({
    type: z.literal('development_learning'),
    id: z.string().min(1).max(500)
  }).strict(),
  decision_authority: z.object({
    kind: z.literal('development_learning_candidate'),
    authorized: z.literal(false),
    graph_promotion_allowed: z.literal(false)
  }).strict(),
  applicability_scope: z.object({
    scope: z.literal('project'),
    project_code: safeIdSchema
  }).strict(),
  permission_snapshot: z.object({
    knowledge_registration: z.literal(true),
    external_action: z.literal(false),
    graph_promotion: z.literal(false),
    visibility: z.literal('team'),
    sensitivity: z.literal('internal')
  }).strict(),
  source_pointer: z.object({
    uri: z.string().min(1).max(2000)
  }).strict(),
  body_hash: sha256Schema,
  parent_episode_id: boundedTextSchema,
  payload: z.object({
    schema_version: z.literal(EVENT_PAYLOAD_SCHEMA),
    story_id: safeIdSchema,
    summary: summarySchema,
    context_digest: sha256Schema,
    verification_evidence: z.object({
      artifact_digest: sha256Schema,
      head_sha: gitShaSchema,
      passing_kinds: z.array(boundedTextSchema).min(1).max(50),
      evidence_sources: z.array(z.enum(COMPUTED_EVIDENCE_SOURCES)).min(1).max(COMPUTED_EVIDENCE_SOURCES.length)
    }).strict(),
    knowledge_reference_count: z.number().int().nonnegative()
  }).strict()
}).strict();

export type VibeProKnowledgeEvent = z.infer<typeof vibeProKnowledgeEventSchema>;

const recordInputSchema = z.object({
  dataDir: z.string().optional(),
  event: vibeProKnowledgeEventSchema
}).strict();

const storedRecordSchema = z.object({
  schema_version: z.literal(STORED_RECORD_SCHEMA),
  recorded_at: timestampSchema,
  event_digest: sha256Schema,
  storage: z.object({
    authority: z.literal('brainbase_local_candidate_store'),
    candidate_only: z.literal(true),
    graph_promoted: z.literal(false),
    external_action_executed: z.literal(false)
  }).strict(),
  event: vibeProKnowledgeEventSchema
}).strict();

export type BrainbaseKnowledgeEventRecord = z.infer<typeof storedRecordSchema>;

export interface BrainbaseKnowledgeEventRecordReceipt {
  schema_version: typeof RECEIPT_SCHEMA;
  status: 'recorded' | 'already_recorded';
  event_id: string;
  event_digest: string;
  body_hash: string;
  project_code: string;
  story_id: string;
  parent_episode_id: string;
  recorded_at: string;
  record_ref: string;
  candidate_state: 'pending_review';
  graph_promoted: false;
  external_action_executed: false;
}

export const knowledgeEventToolDefinition = {
  name: 'brainbase_knowledge_event_record',
  description: 'Validate and append one VibePro development-learning Knowledge Event to Brainbase candidate storage. This tool never promotes Graph data and never executes an external action.',
  inputSchema: {
    type: 'object',
    required: ['event'],
    additionalProperties: false,
    properties: {
      dataDir: { type: 'string', description: 'Optional Brainbase Personal OS directory.' },
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
            properties: { type: { const: 'vibepro' }, ref: { type: 'string' } }
          },
          subject: {
            type: 'object', required: ['type', 'id'], additionalProperties: false,
            properties: { type: { const: 'development_learning' }, id: { type: 'string' } }
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
            properties: { scope: { const: 'project' }, project_code: { type: 'string' } }
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
            properties: { uri: { type: 'string' } }
          },
          body_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          parent_episode_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['schema_version', 'story_id', 'summary', 'context_digest', 'verification_evidence', 'knowledge_reference_count'],
            additionalProperties: false,
            properties: {
              schema_version: { const: EVENT_PAYLOAD_SCHEMA },
              story_id: { type: 'string' },
              summary: { type: 'string', minLength: 1, maxLength: 2000 },
              context_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              verification_evidence: {
                type: 'object',
                required: ['artifact_digest', 'head_sha', 'passing_kinds', 'evidence_sources'],
                additionalProperties: false,
                properties: {
                  artifact_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  head_sha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
                  passing_kinds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
                  evidence_sources: { type: 'array', minItems: 1, maxItems: 3, items: { enum: [...COMPUTED_EVIDENCE_SOURCES] } }
                }
              },
              knowledge_reference_count: { type: 'integer', minimum: 0 }
            }
          }
        }
      }
    }
  }
} as const;

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareCodePoints).map((key) => {
      if (record[key] === undefined) throw new TypeError('canonical JSON does not support undefined');
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field}_contains_duplicates`);
}

function validateEventBindings(event: VibeProKnowledgeEvent): void {
  if (Date.parse(event.captured_at) < Date.parse(event.occurred_at)) {
    throw new Error('knowledge_event_captured_before_occurrence');
  }
  if (SENSITIVE_CONTENT.some((pattern) => pattern.test(event.payload.summary))) {
    throw new Error('knowledge_event_summary_contains_sensitive_content');
  }
  assertUnique(event.payload.verification_evidence.passing_kinds, 'passing_kinds');
  assertUnique(event.payload.verification_evidence.evidence_sources, 'evidence_sources');

  const expectedBodyHash = sha256(canonicalJson(event.payload));
  if (event.body_hash !== expectedBodyHash) throw new Error('knowledge_event_body_hash_mismatch');

  const expectedEventId = `kev_${sha256(canonicalJson([
    event.payload.schema_version,
    event.source.ref,
    event.subject.id,
    event.parent_episode_id,
    event.body_hash
  ]))}`;
  if (event.event_id !== expectedEventId) throw new Error('knowledge_event_id_mismatch');

  const sourceMatch = event.source.ref.match(SOURCE_REF_PATTERN);
  if (!sourceMatch) throw new Error('knowledge_event_source_ref_invalid');
  const [, repository, headSha, storyId] = sourceMatch;
  if (event.payload.story_id !== storyId) throw new Error('knowledge_event_story_binding_mismatch');
  if (event.payload.verification_evidence.head_sha !== headSha) throw new Error('knowledge_event_head_binding_mismatch');
  if (event.subject.id !== `vibepro:${storyId}:${headSha}`) throw new Error('knowledge_event_subject_binding_mismatch');
  const expectedPointer = `vibepro://${repository}/${encodeURIComponent(storyId)}?sha=${headSha}`;
  if (event.source_pointer.uri !== expectedPointer) throw new Error('knowledge_event_source_pointer_mismatch');
}

function recordPath(dataDir: string | undefined, eventId: string): string {
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('knowledge_event_id_invalid');
  return join(resolveDataDir(dataDir), 'runtime', 'knowledge-events', 'v1', `${eventId}.json`);
}

function recordRef(eventId: string): string {
  return `brainbase://knowledge-events/v1/${eventId}`;
}

function receiptFrom(
  record: BrainbaseKnowledgeEventRecord,
  status: BrainbaseKnowledgeEventRecordReceipt['status']
): BrainbaseKnowledgeEventRecordReceipt {
  return {
    schema_version: RECEIPT_SCHEMA,
    status,
    event_id: record.event.event_id,
    event_digest: record.event_digest,
    body_hash: record.event.body_hash,
    project_code: record.event.applicability_scope.project_code,
    story_id: record.event.payload.story_id,
    parent_episode_id: record.event.parent_episode_id,
    recorded_at: record.recorded_at,
    record_ref: recordRef(record.event.event_id),
    candidate_state: 'pending_review',
    graph_promoted: false,
    external_action_executed: false
  };
}

function parseStoredRecord(serialized: string): BrainbaseKnowledgeEventRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error('knowledge_event_record_corrupt');
  }
  const record = storedRecordSchema.parse(raw);
  validateEventBindings(record.event);
  if (record.event_digest !== sha256(canonicalJson(record.event))) {
    throw new Error('knowledge_event_record_digest_mismatch');
  }
  return record;
}

export async function readBrainbaseKnowledgeEventRecord(
  dataDir: string | undefined,
  eventId: string
): Promise<BrainbaseKnowledgeEventRecord> {
  return parseStoredRecord(await readFile(recordPath(dataDir, eventId), 'utf8'));
}

export async function recordBrainbaseKnowledgeEvent(
  rawArgs: unknown,
  options: { now?: () => Date } = {}
): Promise<BrainbaseKnowledgeEventRecordReceipt> {
  const { dataDir, event } = recordInputSchema.parse(rawArgs ?? {});
  validateEventBindings(event);
  const target = recordPath(dataDir, event.event_id);
  const eventDigest = sha256(canonicalJson(event));
  const record: BrainbaseKnowledgeEventRecord = {
    schema_version: STORED_RECORD_SCHEMA,
    recorded_at: (options.now ?? (() => new Date()))().toISOString(),
    event_digest: eventDigest,
    storage: {
      authority: 'brainbase_local_candidate_store',
      candidate_only: true,
      graph_promoted: false,
      external_action_executed: false
    },
    event
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${event.event_id}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    try {
      await link(temporary, target);
      return receiptFrom(record, 'recorded');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readBrainbaseKnowledgeEventRecord(dataDir, event.event_id);
      if (existing.event_digest !== eventDigest || canonicalJson(existing.event) !== canonicalJson(event)) {
        throw new Error('knowledge_event_id_conflict');
      }
      return receiptFrom(existing, 'already_recorded');
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
