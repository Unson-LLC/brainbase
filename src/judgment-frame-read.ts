import { createHash } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  buildJudgmentFrameCatalog,
  type JudgmentFrameKind,
  type JudgmentFrameRecordsPage,
  type JudgmentFrameSourceRecord,
} from './judgment-frame.js';

const KINDS = ['philosophy', 'objective', 'model'] as const;
const FRAME_PAGE_LIMIT = 500;
const MAX_SELECTIONS = 24;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_REF_LENGTH = 1_000;

type JudgmentFrameReadSelection = {
  readonly kind: JudgmentFrameKind;
  readonly ref: string;
};

type JudgmentFrameReadResult = {
  readonly status: 'ok';
  readonly data: {
    readonly schema_version: 'brainbase-judgment-frame-read-v1';
    readonly catalog_digest: `sha256:${string}`;
    readonly records: readonly JudgmentFrameReadRecord[];
  };
} | {
  readonly status: 'unavailable' | 'error';
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
};

export type JudgmentFrameReadRecord = {
  readonly kind: JudgmentFrameKind;
  readonly ref: string;
  readonly body: string;
  readonly body_digest: `sha256:${string}`;
  readonly version: string;
  readonly version_source: 'graph' | 'body_digest';
  readonly applicability_scope: string;
  readonly applicability_scope_source: 'graph' | 'unspecified';
};

export type JudgmentFrameReadDependencies = {
  /** Read every record of one kind visible to the caller, at most `limit`. */
  readonly loadRecords: (kind: JudgmentFrameKind, limit: number) => Promise<JudgmentFrameRecordsPage>;
};

const UNSPECIFIED_APPLICABILITY_SCOPE = 'Graphに適用範囲の記載なし';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const text = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
);

const versionText = (value: unknown): string | undefined => (
  text(value) ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined)
);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function scopeText(value: unknown): string | undefined {
  const stringValue = text(value);
  if (stringValue) return stringValue;
  if (!isRecord(value) && !Array.isArray(value)) return undefined;
  const serialized = canonicalJson(value);
  return serialized && serialized !== '{}' && serialized !== '[]' ? serialized : undefined;
}

function itemBody(kind: JudgmentFrameKind, payload: Record<string, unknown>): string | undefined {
  const foundation = isRecord(payload.foundation) ? payload.foundation : {};
  if (kind === 'philosophy') {
    const statement = text(payload.statement) ?? text(foundation.meaning);
    const name = text(payload.display_name) ?? text(payload.title);
    if (!statement) return undefined;
    return name && name !== statement ? `${name}：${statement}` : statement;
  }
  if (kind === 'objective') {
    return text(foundation.desiredState) ?? text(foundation.meaning) ?? text(payload.statement);
  }
  // A model title is a label, not a readable world-model body. Require a
  // meaning/statement so a name-only catalog item cannot become evidence.
  return text(foundation.meaning) ?? text(payload.statement);
}

type JudgmentFrameApplicabilityScope = {
  readonly value: string;
  readonly source: 'graph' | 'unspecified';
};

function recordScope(
  kind: JudgmentFrameKind,
  record: JudgmentFrameSourceRecord,
): JudgmentFrameApplicabilityScope {
  const payload = isRecord(record.payload) ? record.payload : {};
  const foundation = isRecord(payload.foundation) ? payload.foundation : {};
  const recordMetadata = record as unknown as Record<string, unknown>;
  const candidates: unknown[] = kind === 'model'
    ? [
      payload.applicability_text,
      payload.applicability_scope,
      foundation.applicability_text,
      foundation.applicability_scope,
      payload.applicability,
      foundation.applicability,
    ]
    : [
      payload.applicability_scope,
      payload.applicability_text,
      foundation.applicability_scope,
      foundation.applicability_text,
      payload.applicability,
      foundation.applicability,
    ];
  candidates.push(
    recordMetadata.applicability_scope,
    recordMetadata.applicability_text,
  );
  for (const candidate of candidates) {
    const value = scopeText(candidate);
    if (value) return { value, source: 'graph' };
  }
  return { value: UNSPECIFIED_APPLICABILITY_SCOPE, source: 'unspecified' };
}

function invalidInput(): JudgmentFrameReadResult {
  return {
    status: 'error',
    error: {
      code: 'judgment_frame_read_input_invalid',
      message: 'Provide one current catalog digest and one or more unique philosophy, objective, or model references.',
    },
  };
}

function toolError(
  status: 'unavailable' | 'error',
  code: string,
  message: string,
  details?: unknown,
): JudgmentFrameReadResult {
  return { status, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

function isSelection(value: unknown): value is JudgmentFrameReadSelection {
  if (!isRecord(value) || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'kind') || !Object.hasOwn(value, 'ref')) return false;
  return KINDS.includes(value.kind as JudgmentFrameKind)
    && typeof value.ref === 'string'
    && value.ref.trim() === value.ref
    && value.ref.length > 0
    && value.ref.length <= MAX_REF_LENGTH;
}

function parseInput(args: Record<string, unknown>): {
  readonly catalogDigest: `sha256:${string}`;
  readonly selections: readonly JudgmentFrameReadSelection[];
} | null {
  if (!isRecord(args)
    || Object.keys(args).length !== 2
    || !Object.hasOwn(args, 'catalog_digest')
    || !Object.hasOwn(args, 'selections')
    || typeof args.catalog_digest !== 'string'
    || !DIGEST_PATTERN.test(args.catalog_digest)
    || !Array.isArray(args.selections)
    || args.selections.length === 0
    || args.selections.length > MAX_SELECTIONS
    || !args.selections.every(isSelection)) return null;
  const selections = args.selections as JudgmentFrameReadSelection[];
  const keys = selections.map((selection) => `${selection.kind}:${selection.ref}`);
  if (new Set(keys).size !== keys.length) return null;
  return { catalogDigest: args.catalog_digest as `sha256:${string}`, selections };
}

async function loadFrameCatalog(
  dependencies: JudgmentFrameReadDependencies,
): Promise<(ReturnType<typeof buildJudgmentFrameCatalog> & {
  readonly records: readonly JudgmentFrameSourceRecord[];
}) | JudgmentFrameReadResult> {
  const records: JudgmentFrameSourceRecord[] = [];
  for (const kind of KINDS) {
    let page: JudgmentFrameRecordsPage;
    try {
      page = await dependencies.loadRecords(kind, FRAME_PAGE_LIMIT);
    } catch (error) {
      return toolError(
        'unavailable',
        'judgment_frame_catalog_unavailable',
        `Graph ${kind} records could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (page.status !== 'ok') return toolError(page.status, page.code, page.message);
    if (page.records.length >= FRAME_PAGE_LIMIT) {
      return toolError(
        'error',
        'judgment_frame_catalog_truncated',
        `Graph returned ${page.records.length} ${kind} records; the catalog may be incomplete`,
      );
    }
    records.push(...page.records);
  }
  return { ...buildJudgmentFrameCatalog(records), records };
}

export const judgmentFrameReadTools: Tool[] = [{
  name: 'brainbase_judgment_frame_read',
  description: 'On every confirmed turn, after reading the judgment frame catalog, retrieve the full canonical Graph body, version, and applicability scope for every selected philosophy, objective, and world model reference. Pass the exact catalog_digest and selected kind/ref pairs. The read is authorized against the caller-visible Graph and fails on a stale catalog, unknown reference, or empty body. If Graph metadata has no applicability scope, the result says so explicitly; authorization scope is never presented as applicability scope.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      catalog_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      selections: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SELECTIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: [...KINDS] },
            ref: { type: 'string', minLength: 1, maxLength: MAX_REF_LENGTH },
          },
          required: ['kind', 'ref'],
        },
      },
    },
    required: ['catalog_digest', 'selections'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
}];

export async function handleJudgmentFrameReadToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: JudgmentFrameReadDependencies,
): Promise<JudgmentFrameReadResult | null> {
  if (name !== 'brainbase_judgment_frame_read') return null;
  const input = parseInput(args);
  if (!input) return invalidInput();

  const loaded = await loadFrameCatalog(dependencies);
  if ('status' in loaded) return loaded;
  const { catalog, records: sourceRecords } = loaded;
  if (input.catalogDigest !== catalog.digest) {
    return toolError(
      'error',
      'judgment_frame_catalog_mismatch',
      'The supplied catalog_digest is stale or was produced from a different visible Graph.',
      { current_catalog_digest: catalog.digest },
    );
  }

  const records: JudgmentFrameReadRecord[] = [];
  const sourceByKey = new Map<string, JudgmentFrameSourceRecord>();
  for (const record of sourceRecords) {
    const key = `${record.entity_type}:${record.id}`;
    if (!sourceByKey.has(key)) sourceByKey.set(key, record);
  }

  for (const selection of input.selections) {
    const item = catalog.items.find((candidate) => candidate.kind === selection.kind && candidate.id === selection.ref);
    if (!item) {
      return toolError('error', 'judgment_frame_ref_unknown', `${selection.kind}/${selection.ref} is not in the current judgment frame catalog`);
    }
    const source = sourceByKey.get(`${selection.kind}:${selection.ref}`);
    if (!source) {
      return toolError('error', 'judgment_frame_body_unavailable', `${selection.kind}/${selection.ref} is no longer available in the authorized Graph`);
    }
    const payload = isRecord(source.payload) ? source.payload : {};
    const semanticBody = itemBody(selection.kind, payload);
    if (!semanticBody) return toolError('error', 'judgment_frame_body_unavailable', `${selection.kind}/${selection.ref} has no readable body`);
    // The catalog intentionally clips a compact summary. Return the full
    // canonical payload so model predictions, constraints, and measurements
    // are not silently discarded by the read step.
    const body = canonicalJson(payload);
    const bodyDigest = `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}` as `sha256:${string}`;
    const foundation = isRecord(payload.foundation) ? payload.foundation : {};
    const graphVersion = versionText(foundation.revision) ?? versionText(source.version);
    const version = graphVersion ?? bodyDigest;
    const versionSource = graphVersion ? 'graph' : 'body_digest';
    const applicabilityScope = recordScope(selection.kind, source);
    records.push({
      kind: selection.kind,
      ref: selection.ref,
      body,
      body_digest: bodyDigest,
      version,
      version_source: versionSource,
      applicability_scope: applicabilityScope.value,
      applicability_scope_source: applicabilityScope.source,
    });
  }

  return {
    status: 'ok',
    data: {
      schema_version: 'brainbase-judgment-frame-read-v1',
      catalog_digest: catalog.digest,
      records,
    },
  };
}
