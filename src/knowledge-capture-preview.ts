/**
 * Contracts shared by the local knowledge capture and preview adapters.
 *
 * The adapter is deliberately provider-agnostic.  Production bootstrap does
 * not create one; callers must inject an explicit implementation.  This file
 * only normalizes and validates the boundary so an adapter cannot turn
 * missing evidence or an unverified version into a successful result.
 *
 * Moved unchanged from brainbase-unson server/services/knowledge-capture-preview-adapter.js
 * (story-document-and-meeting-source-exits-v1).
 */

export type KnowledgeVersion = string | { state: string; value: string | null };
type Details = Record<string, unknown>;
type Entry = Record<string, unknown>;

export class KnowledgeAIAdapterContractError extends Error {
  code: string;
  status: number;
  details: Details;

  constructor(message: string, details: Details = {}) {
    super(message);
    this.name = 'KnowledgeAIAdapterContractError';
    this.code = 'knowledge_ai_adapter_contract_invalid';
    this.status = 502;
    this.details = details;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function fail(message: string, details: Details = {}): never {
  throw new KnowledgeAIAdapterContractError(message, details);
}

function isRecord(value: unknown): value is Entry {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeVersion(value: unknown, field = 'version'): KnowledgeVersion {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (isRecord(value)) {
    const state = text(value.state) || text(value.status);
    if (!state) fail(`${field} must include an explicit state`, { field });
    return {
      state,
      value: typeof value.value === 'string' && value.value.trim()
        ? value.value.trim()
        : typeof value.value === 'number' && Number.isFinite(value.value)
          ? String(value.value)
          : null,
    };
  }
  fail(`${field} is required`, { field });
}

export function versionValue(value: KnowledgeVersion): string | null {
  return typeof value === 'string' ? value : null;
}

function versionKey(value: KnowledgeVersion): string {
  return typeof value === 'string' ? `known:${value}` : `unknown:${value.state}:${value.value || ''}`;
}

export function normalizeUnknown(value: unknown, field = 'unknown'): Array<string | Entry> {
  if (!Array.isArray(value)) fail(`${field} must be an array`, { field });
  return value.map((entry: unknown, index: number) => {
    if (typeof entry === 'string' && entry.trim()) return entry.trim();
    if (isRecord(entry)) return { ...entry };
    fail(`${field}[${index}] must be text or an object`, { field, index });
  });
}

export function normalizeReadback(value: unknown, field = 'readback'): Entry & { state: string; verified: boolean } {
  if (!isRecord(value)) {
    fail(`${field} is required`, { field });
  }
  const state = text(value.state) || text(value.status);
  if (!state) fail(`${field}.state is required`, { field });
  if (typeof value.verified !== 'boolean') {
    fail(`${field}.verified must be explicit`, { field });
  }
  return { ...value, state, verified: value.verified };
}

/**
 * Resolve only explicitly injected adapter methods.  There is intentionally
 * no environment or default-provider lookup here.
 */
export function resolveKnowledgeAdapter(adapter: unknown, method: string): ((...args: any[]) => any) | null {
  if (typeof adapter === 'function') return adapter as (...args: any[]) => any;
  if (!adapter || typeof adapter !== 'object') return null;
  const candidate = (adapter as Entry)[method];
  if (typeof candidate === 'function') return (candidate as (...args: any[]) => any).bind(adapter);
  return null;
}

export function normalizeEvidence(value: unknown, {
  field = 'evidence',
  allowedReferences = null,
  requireExactReference = false,
}: {
  field?: string;
  allowedReferences?: Set<string> | null;
  requireExactReference?: boolean;
} = {}): Array<Entry & { id: string | null; version: KnowledgeVersion; source_ref: string | null }> {
  if (!Array.isArray(value)) fail(`${field} must be an array`, { field });
  return value.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      fail(`${field}[${index}] must be an object`, { field, index });
    }
    const id = text(entry.id) || text(entry.candidate_id) || null;
    const sourceRef = text(entry.source_ref) || text(entry.pointer) || text(entry.source) || null;
    if (requireExactReference && !id) {
      fail(`${field}[${index}].id is required`, { field, index });
    }
    if (!id && !sourceRef) {
      fail(`${field}[${index}] needs an id or source_ref`, { field, index });
    }
    if (!hasOwn(entry, 'version')) {
      fail(`${field}[${index}].version is required`, { field, index });
    }
    const version = normalizeVersion(entry.version, `${field}[${index}].version`);
    if (allowedReferences && id) {
      const key = `${id}\u0000${versionKey(version)}`;
      if (!allowedReferences.has(key)) {
        fail(`${field}[${index}] references an unavailable candidate`, {
          field,
          index,
          id,
          version,
        });
      }
    }
    return {
      ...entry,
      id,
      version,
      source_ref: sourceRef,
    };
  });
}

export function referenceKey(id: unknown, version: KnowledgeVersion): string {
  return `${text(id) || ''}\u0000${versionKey(version)}`;
}

export function normalizeCitations(value: unknown, {
  field = 'citations',
  allowedReferences,
}: {
  field?: string;
  allowedReferences?: Set<string> | null;
} = {}): Array<Entry & { id: string; version: string }> {
  if (!Array.isArray(value)) fail(`${field} must be an array`, { field });
  return value.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      fail(`${field}[${index}] must be an object`, { field, index });
    }
    const id = text(entry.id) || text(entry.candidate_id);
    if (!id) fail(`${field}[${index}].id is required`, { field, index });
    if (!hasOwn(entry, 'version')) fail(`${field}[${index}].version is required`, { field, index });
    const version = normalizeVersion(entry.version, `${field}[${index}].version`);
    if (typeof version !== 'string') {
      fail(`${field}[${index}].version must be an exact value`, { field, index, id });
    }
    const key = referenceKey(id, version);
    if (allowedReferences && !allowedReferences.has(key)) {
      fail(`${field}[${index}] references a candidate outside the isolated set`, {
        field,
        index,
        id,
        version,
      });
    }
    return {
      ...entry,
      id,
      version,
    };
  });
}

export function validateCaptureProposal(value: unknown, { allowedReferences = null }: { allowedReferences?: Set<string> | null } = {}) {
  if (!isRecord(value)) {
    fail('capture adapter must return an object');
  }
  const proposal = isRecord(value.proposal)
    ? value.proposal
    : value;
  for (const field of ['kind', 'summary', 'scope', 'owner_candidate', 'relations']) {
    if (!hasOwn(proposal, field)) fail(`capture proposal.${field} is required`, { field });
  }
  const version = normalizeVersion(value.version, 'capture proposal.version');
  const unknown = normalizeUnknown(value.unknown, 'capture proposal.unknown');
  const evidence = normalizeEvidence(value.evidence, {
    field: 'capture proposal.evidence',
    allowedReferences,
  });
  const readback = normalizeReadback(value.readback, 'capture proposal.readback');
  return {
    proposal: {
      kind: proposal.kind,
      summary: proposal.summary,
      scope: proposal.scope,
      owner_candidate: proposal.owner_candidate,
      relations: proposal.relations,
    },
    evidence,
    unknown,
    version,
    readback,
  };
}

export function validatePreviewAnswer(value: unknown, { allowedReferences }: { allowedReferences?: Set<string> | null }) {
  if (!isRecord(value)) {
    fail('preview adapter must return an object');
  }
  const answer = text(value.answer);
  if (!answer) fail('preview answer is required', { field: 'answer' });
  const rawCitations = value.citations ?? value.cited_refs ?? value.selected_refs;
  const citations = normalizeCitations(rawCitations, {
    field: 'preview citations',
    allowedReferences,
  });
  const unknown = normalizeUnknown(value.unknown, 'preview unknown');
  const evidence = normalizeEvidence(value.evidence, {
    field: 'preview evidence',
    allowedReferences,
    requireExactReference: true,
  });
  const readback = normalizeReadback(value.readback, 'preview readback');
  const version = normalizeVersion(value.version, 'preview version');
  const exclusions = Array.isArray(value.exclusions)
    ? value.exclusions.map((entry: unknown) => ({ ...(entry as Entry) }))
    : [];
  return {
    answer,
    citations,
    evidence,
    exclusions,
    unknown,
    version,
    readback,
  };
}
