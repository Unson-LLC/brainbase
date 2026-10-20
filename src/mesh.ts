import { randomUUID } from 'node:crypto';

/** Portable mesh envelope and host-port contracts. No network or auth dependency. */
export const MESH_CONTRACT_VERSION = 'mesh.v1' as const;

export const MESH_ENVELOPE_TYPES = [
  'query',
  'response',
  'ping',
  'pong',
  'peer_joined',
  'peer_left'
] as const;

export type MeshEnvelopeType = typeof MESH_ENVELOPE_TYPES[number];
export type MeshJson = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface MeshEnvelope {
  id: string;
  from: string;
  to: string;
  type: MeshEnvelopeType;
  payload: MeshJson;
  ts: number;
  nonce: string;
}

export interface MeshEnvelopeInput {
  from: string;
  to: string;
  type: MeshEnvelopeType;
  payload?: MeshJson;
}

export class MeshContractError extends Error {
  readonly code = 'mesh_contract_invalid';

  constructor(field: string, message = `mesh field is invalid: ${field}`) {
    super(message);
    this.name = 'MeshContractError';
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new MeshContractError(field);
  return value.trim();
}

function isJson(value: unknown, ancestors = new Set<object>()): value is MeshJson {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJson(entry, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value as Record<string, unknown>).every((entry) => isJson(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

export function createMeshEnvelope(
  input: MeshEnvelopeInput,
  options: { now?: number; idFactory?: () => string; nonceFactory?: () => string } = {}
): MeshEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MeshContractError('envelope');
  const from = text(input.from, 'from');
  const to = text(input.to, 'to');
  if (!MESH_ENVELOPE_TYPES.includes(input.type)) throw new MeshContractError('type');
  if (input.payload !== undefined && !isJson(input.payload)) throw new MeshContractError('payload');
  const ts = options.now ?? Date.now();
  if (!Number.isFinite(ts) || ts <= 0) throw new MeshContractError('ts');
  return {
    id: text(options.idFactory?.() ?? randomUUID(), 'id'),
    from,
    to,
    type: input.type,
    payload: input.payload ?? null,
    ts,
    nonce: text(options.nonceFactory?.() ?? randomUUID(), 'nonce')
  };
}

export function normalizeMeshEnvelope(value: unknown): MeshEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MeshContractError('envelope');
  const candidate = value as Record<string, unknown>;
  const from = text(candidate.from, 'from');
  const to = text(candidate.to, 'to');
  const id = text(candidate.id, 'id');
  const nonce = text(candidate.nonce, 'nonce');
  if (typeof candidate.type !== 'string' || !MESH_ENVELOPE_TYPES.includes(candidate.type as MeshEnvelopeType)) {
    throw new MeshContractError('type');
  }
  if (!Number.isFinite(candidate.ts) || typeof candidate.ts !== 'number' || candidate.ts <= 0) {
    throw new MeshContractError('ts');
  }
  const payload = candidate.payload ?? null;
  if (!isJson(payload)) throw new MeshContractError('payload');
  return {
    id,
    from,
    to,
    type: candidate.type as MeshEnvelopeType,
    payload,
    ts: candidate.ts,
    nonce
  };
}

/**
 * Parse a serialized or already-decoded envelope through the same strict
 * boundary used by the host adapter.
 *
 * The host runtime accepts both JSON strings and objects. Keeping that input
 * shape here lets a host compare the local contract result before handing an
 * envelope to its network or crypto layer without moving either dependency
 * into the portable package.
 */
export function parseMeshEnvelope(value: unknown): MeshEnvelope {
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      throw new MeshContractError('envelope', 'mesh envelope JSON is invalid');
    }
  }
  return normalizeMeshEnvelope(decoded);
}

export interface MeshProjectPort {
  projectId: string;
  localPath?: string;
  globInclude?: string[];
  ports?: Record<string, string | number>;
}

export interface MeshNodeProfile {
  nodeId: string;
  principalRef: string;
  roleRank?: number;
  agentRuntime?: string;
  projects: MeshProjectPort[];
}

export function normalizeMeshNodeProfile(value: unknown): MeshNodeProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MeshContractError('profile');
  const candidate = value as Record<string, unknown>;
  const projects = Array.isArray(candidate.projects) ? candidate.projects.map((project, index) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new MeshContractError(`projects.${index}`);
    const item = project as Record<string, unknown>;
    const projectId = text(item.projectId, `projects.${index}.projectId`);
    const localPath = item.localPath === undefined ? undefined : text(item.localPath, `projects.${index}.localPath`);
    const globInclude = item.globInclude === undefined
      ? undefined
      : Array.isArray(item.globInclude) && item.globInclude.every((entry) => typeof entry === 'string')
        ? [...item.globInclude]
        : (() => { throw new MeshContractError(`projects.${index}.globInclude`); })();
    const ports = item.ports === undefined
      ? undefined
      : item.ports && typeof item.ports === 'object' && !Array.isArray(item.ports)
        && Object.entries(item.ports).every(([key, port]) => Boolean(key)
          && (typeof port === 'string' || (typeof port === 'number' && Number.isFinite(port))))
        ? { ...(item.ports as Record<string, string | number>) }
        : (() => { throw new MeshContractError(`projects.${index}.ports`); })();
    return { projectId, localPath, globInclude, ports };
  }) : [];
  const roleRankValue = candidate.roleRank;
  const roleRank = roleRankValue === undefined ? undefined : roleRankValue;
  if (roleRank !== undefined && (typeof roleRank !== 'number' || !Number.isInteger(roleRank) || roleRank < 0)) {
    throw new MeshContractError('roleRank');
  }
  return {
    nodeId: text(candidate.nodeId, 'nodeId'),
    principalRef: text(candidate.principalRef, 'principalRef'),
    roleRank,
    agentRuntime: candidate.agentRuntime === undefined ? undefined : text(candidate.agentRuntime, 'agentRuntime'),
    projects
  };
}

export interface MeshQueryRequest {
  queryId: string;
  from: string;
  to: string;
  question: string;
  scope?: string;
}

export function normalizeMeshQueryRequest(value: unknown): MeshQueryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MeshContractError('query');
  const candidate = value as Record<string, unknown>;
  return {
    queryId: text(candidate.queryId, 'queryId'),
    from: text(candidate.from, 'from'),
    to: text(candidate.to, 'to'),
    question: text(candidate.question, 'question'),
    scope: candidate.scope === undefined ? undefined : text(candidate.scope, 'scope')
  };
}

export function createMeshSendReceipt(queryId: string): {
  queryId: string;
  status: 'sent';
  receipt_kind: 'send_ack';
  answer_status: 'unknown';
} {
  return {
    queryId: text(queryId, 'queryId'),
    status: 'sent',
    receipt_kind: 'send_ack',
    answer_status: 'unknown'
  };
}
