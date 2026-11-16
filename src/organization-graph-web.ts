import type { GraphVocabularyTerm } from './local-web-host.js';
import { canonicalEdgeId } from './canonical-graph.js';
import { canonicalGraphOntologyRelease } from './templates.js';
import type { CanonicalEdge, CanonicalEntity, CanonicalEntityKind, CoreRelation, GraphFileV2 } from './types.js';

/**
 * Projects organization Graph records (as an organization host reads them for
 * its member) into a Graph v2, so shared parts such as the world draw them the
 * same way as a local Graph. This module never reads a network or a token: the
 * host that owns the records passes them in (`projectOrganizationWorld`).
 *
 * Relations come only from what the organization Graph states:
 *   - `member_of` person → project       → `participates_in` (role = role_code)
 *   - RACI `assigned_to` raci → person, with the RACI's project:
 *       accountable / A / lane decider / decision:*  → `accountable_for`
 *       any other role                                → `participates_in`
 * Retired or superseded records are counted, not drawn.
 */

export const ORGANIZATION_GRAPH_WEB_VERSION = 'organization-graph-web.v0' as const;
const ENTITY_TYPES: readonly CanonicalEntityKind[] = ['project', 'person', 'org', 'decision'];

interface OrganizationRecord {
  id: string;
  entity_type?: string;
  project_id?: string | null;
  project_code?: string | null;
  lifecycle_status?: string;
  payload?: Record<string, unknown>;
}

interface OrganizationEdge {
  id: string;
  from_id: string;
  to_id: string;
  rel_type: string;
  project_id?: string | null;
  lifecycle_status?: string;
  payload?: Record<string, unknown> | null;
}

export interface OrganizationGraphRecords {
  readonly entities: Readonly<Record<CanonicalEntityKind | 'raci_assignment', readonly OrganizationRecord[]>>;
  readonly memberOf: readonly OrganizationEdge[];
  readonly assignedTo: readonly OrganizationEdge[];
}

export interface OrganizationGraphProjection {
  readonly graph: GraphFileV2;
  readonly excluded: { readonly inactive: number; readonly unnamed: number; readonly danglingRelations: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nameOf(type: CanonicalEntityKind, payload: Record<string, unknown>): string | null {
  return type === 'decision'
    ? text(payload.title) ?? text(payload.name) ?? text(payload.decision)?.slice(0, 80) ?? null
    : text(payload.display_name) ?? text(payload.name);
}

function isAccountableRole(payload: Record<string, unknown>): boolean {
  const role = text(payload.role_code) ?? text(payload.role) ?? '';
  const lane = text(payload.lane) ?? '';
  return role === 'accountable' || role === 'A' || lane === 'decider' || role.startsWith('decision:');
}

/** The record that is the project of its scope: its code, or else its id, is the scope's code. */
function isCatalogProject(record: OrganizationRecord, payload: Record<string, unknown>): boolean {
  const scope = text(record.project_code);
  return scope !== null && (text(payload.code) ?? record.id) === scope;
}

/**
 * The organization's words for field values: active glossary terms that carry
 * `payload.vocabulary = { field, value }`.  The name is the term's label, else
 * its term, else the value itself (pure; tested).
 */
export function projectVocabularyTerms(records: readonly unknown[]): GraphVocabularyTerm[] {
  const terms: GraphVocabularyTerm[] = [];
  for (const record of records) {
    if (!isRecord(record) || typeof record.id !== 'string' || !isRecord(record.payload)) continue;
    if (record.lifecycle_status && record.lifecycle_status !== 'active') continue;
    const vocabulary = record.payload.vocabulary;
    const field = isRecord(vocabulary) ? text(vocabulary.field) : null;
    const value = isRecord(vocabulary) ? text(vocabulary.value) : null;
    if (!field || !value) continue;
    terms.push({
      id: record.id,
      field,
      value,
      label: text(record.payload.label) ?? text(record.payload.term) ?? value,
      definition: text(record.payload.definition)
    });
  }
  return terms.sort((a, b) => a.id.localeCompare(b.id));
}

/** A project's code, parent and repositories as the organization Graph states them. */
function projectPlacement(record: OrganizationRecord, payload: Record<string, unknown>, catalogByCode: ReadonlyMap<string, string>): Record<string, unknown> {
  const scope = text(record.project_code);
  const isCatalog = isCatalogProject(record, payload);
  const code = text(payload.code) ?? (isCatalog ? scope : null);
  const repositories = Array.isArray(payload.repository_roots)
    ? payload.repository_roots.filter(isRecord).map((root) => text(root.repository)).filter((name): name is string => name !== null)
    : [];
  const parentId = scope ? catalogByCode.get(scope) : undefined;
  return {
    ...(code ? { code } : {}),
    ...(!isCatalog && scope ? { parent_project_code: scope } : {}),
    ...(!isCatalog && parentId && parentId !== record.id ? { parent_project_id: parentId } : {}),
    ...(repositories.length ? { repositories } : {})
  };
}

/** Projects organization Graph records into a canonical Graph v2 (pure; tested). */
export function projectOrganizationGraph(records: OrganizationGraphRecords, owner?: { id: string; name?: string }): OrganizationGraphProjection {
  const entities: CanonicalEntity[] = [];
  const ids = new Map<string, CanonicalEntityKind>();
  let inactive = 0;
  let unnamed = 0;
  // The organization's catalog project for each project code (its own code or id equals its scope);
  // other projects in that scope hang under it (the world draws them as its districts).
  const catalogByCode = new Map<string, string>();
  for (const record of records.entities.project ?? []) {
    if (!isRecord(record) || typeof record.id !== 'string' || (record.lifecycle_status && record.lifecycle_status !== 'active')) continue;
    const scope = text(record.project_code);
    if (scope && isCatalogProject(record, isRecord(record.payload) ? record.payload : {}) && !catalogByCode.has(scope)) catalogByCode.set(scope, record.id);
  }
  for (const type of ENTITY_TYPES) {
    for (const record of records.entities[type] ?? []) {
      if (!isRecord(record) || typeof record.id !== 'string' || ids.has(record.id)) continue;
      if (record.lifecycle_status && record.lifecycle_status !== 'active') {
        inactive += 1;
        continue;
      }
      const payload = isRecord(record.payload) ? record.payload : {};
      const name = nameOf(type, payload);
      if (!name) {
        unnamed += 1;
        continue;
      }
      const aliases = Array.isArray(payload.aliases) ? payload.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim() !== '' && alias !== name) : [];
      const summary = text(payload.purpose) ?? text(payload.summary) ?? text(payload.description);
      const status = text(payload.operational_status) ?? text(payload.status);
      entities.push({
        id: record.id,
        type,
        name,
        ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
        ...(summary ? { summary } : {}),
        metadata: {
          source: 'organization_graph',
          ...(record.project_code ? { project_code: record.project_code } : {}),
          ...(type === 'project' && summary ? { goal: summary } : {}),
          ...(type === 'project' && status ? { status } : {}),
          ...(type === 'project' && text(payload.kind) ? { kind: text(payload.kind) } : {}),
          ...(type === 'decision' && text(payload.decided_at) ? { decided_at: text(payload.decided_at) } : {}),
          ...(type === 'project' ? projectPlacement(record, payload, catalogByCode) : {})
        }
      });
      ids.set(record.id, type);
    }
  }
  // One canonical relation per person, relation and project (the edge id is derived from them);
  // the organization's role names for that pair are kept together.
  const byKey = new Map<string, { edge: CanonicalEdge; roles: string[] }>();
  let danglingRelations = 0;
  const addEdge = (sourceId: string, fromId: string, relation: CoreRelation, toId: string, role: string | null) => {
    if (ids.get(fromId) !== 'person' || ids.get(toId) !== 'project') {
      danglingRelations += 1;
      return;
    }
    const key = `${fromId}|${relation}|${toId}`;
    const existing = byKey.get(key);
    if (existing) {
      if (role && !existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    byKey.set(key, {
      edge: { id: canonicalEdgeId({ fromId, relation, toId }), fromId, relation, toId, provenance: { sourceKind: 'import', sourceId } },
      roles: role ? [role] : []
    });
  };
  for (const edge of records.memberOf) {
    if (edge.lifecycle_status && edge.lifecycle_status !== 'active') continue;
    addEdge(edge.id, edge.from_id, 'participates_in', edge.to_id, text(edge.payload?.role_code));
  }
  const raci = new Map((records.entities.raci_assignment ?? []).filter((record) => !record.lifecycle_status || record.lifecycle_status === 'active').map((record) => [record.id, record]));
  for (const edge of records.assignedTo) {
    if (edge.lifecycle_status && edge.lifecycle_status !== 'active') continue;
    const assignment = raci.get(edge.from_id);
    const projectId = assignment?.project_id ?? edge.project_id ?? null;
    if (!assignment || !projectId) {
      danglingRelations += 1;
      continue;
    }
    const payload = isRecord(assignment.payload) ? assignment.payload : {};
    const role = text(payload.role_code) ?? text(payload.role) ?? text(edge.payload?.role_code);
    addEdge(edge.id, edge.to_id, isAccountableRole(payload) ? 'accountable_for' : 'participates_in', projectId, role);
  }
  const edges = [...byKey.values()].map(({ edge, roles }) => (roles.length ? { ...edge, role: roles.join('、') } : edge));
  const ownerEntity = owner && ids.get(owner.id) === 'person' ? owner : undefined;
  return {
    graph: {
      version: 2,
      ontology: { ...canonicalGraphOntologyRelease.binding },
      owner: ownerEntity ? { id: ownerEntity.id, ...(ownerEntity.name ? { name: ownerEntity.name } : {}) } : {},
      entities,
      edges
    },
    excluded: { inactive, unnamed, danglingRelations }
  };
}
