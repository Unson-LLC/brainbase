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

function isJson(value: unknown): value is MeshJson {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJson);
  return false;
}

export function createMeshEnvelope(
  input: MeshEnvelopeInput,
  options: { now?: number; idFactory?: () => string; nonceFactory?: () => string } = {}
): MeshEnvelope {
  const from = text(input.from, 'from');
  const to = text(input.to, 'to');
  if (!MESH_ENVELOPE_TYPES.includes(input.type)) throw new MeshContractError('type');
  if (input.payload !== undefined && !isJson(input.payload)) throw new MeshContractError('payload');
  const ts = options.now ?? Date.now();
  if (!Number.isFinite(ts)) throw new MeshContractError('ts');
  return {
    id: options.idFactory?.() ?? randomUUID(),
    from,
    to,
    type: input.type,
    payload: input.payload ?? null,
    ts,
    nonce: options.nonceFactory?.() ?? randomUUID()
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
  if (!isJson(candidate.payload)) throw new MeshContractError('payload');
  return {
    id,
    from,
    to,
    type: candidate.type as MeshEnvelopeType,
    payload: candidate.payload,
    ts: candidate.ts,
    nonce
  };
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
        && Object.entries(item.ports).every(([key, port]) => Boolean(key) && (typeof port === 'string' || typeof port === 'number'))
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
