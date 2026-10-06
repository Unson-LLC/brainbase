import {
  cloneFoundationDefinition,
  digestFoundationDefinition
} from './foundation-catalog.js';
import { canonicalPortableJson } from './portable-graph.js';
import {
  FoundationStoreError,
  type FoundationRevisionStore,
  type FoundationStoreContext
} from './foundation-store.js';
import type {
  PhilosophyRevisionApplicability,
  PhilosophyRevisionReadRequest,
  PhilosophyRevisionReadResult,
  PhilosophyRevisionReader,
  PhilosophyRevisionRecord,
  PhilosophyRevisionReference
} from './philosophy-revision-reader.js';
import { philosophyRevisionDigest } from './philosophy-revision-reader.js';
import type {
  FoundationAcl,
  FoundationDefinition,
  FoundationRevision,
  FoundationScope,
  FoundationType
} from './ontology-foundation.js';
import { validateFoundationDefinition } from './ontology-foundation.js';
import type { FoundationCatalogRecord } from './types.js';

/** Read contract for history that is joined to the current Graph row. */
export const GRAPH_FOUNDATION_READ_CONTRACT_VERSION = 'graph-foundation-history-read.v1' as const;

/**
 * The query deliberately joins the historical row to the current Graph row.
 * The host supplies a transaction-bound query function; its RLS policies make
 * an invisible current row disappear before the adapter sees the result.
 *
 * `storage_digest_valid` is calculated by PostgreSQL over `payload::text` so
 * that an adapter never has to reproduce database JSON serialization rules.
 * `current_visible` is selected explicitly to make fake/test adapters and
 * future providers fail closed when they do not prove current-row visibility.
 */
export const GRAPH_FOUNDATION_READ_SQL = `
SELECT
  history.entity_id,
  history.entity_type,
  history.revision,
  history.payload,
  history.project_id,
  history.role_min,
  history.sensitivity,
  history.lifecycle_status,
  history.storage_digest,
  history.captured_at,
  (
    history.storage_digest = 'sha256:' ||
      encode(sha256(convert_to(history.payload::text, 'UTF8')), 'hex')
  ) AS storage_digest_valid,
  current_entity.id AS current_entity_id,
  current_entity.entity_type AS current_entity_type,
  current_entity.payload AS current_payload,
  current_entity.project_id AS current_project_id,
  current_entity.role_min AS current_role_min,
  current_entity.sensitivity AS current_sensitivity,
  current_entity.lifecycle_status AS current_lifecycle_status,
  projects.code AS current_project_code,
  true AS current_visible
FROM public.graph_foundation_revisions AS history
JOIN public.graph_entities AS current_entity
  ON current_entity.id = history.entity_id
 AND current_entity.entity_type = history.entity_type
JOIN public.projects AS projects
  ON projects.id = current_entity.project_id
WHERE history.entity_id = $1
  AND history.entity_type = $2
  AND history.revision = $3
`;

/**
 * Read the newest immutable revision for one Foundation entity.  The current
 * Graph row remains part of the query so RLS and the adapter's current-row
 * checks apply identically to latest and historical reads.
 */
export const GRAPH_FOUNDATION_LATEST_SQL = `
SELECT
  history.entity_id,
  history.entity_type,
  history.revision,
  history.payload,
  history.project_id,
  history.role_min,
  history.sensitivity,
  history.lifecycle_status,
  history.storage_digest,
  history.captured_at,
  (
    history.storage_digest = 'sha256:' ||
      encode(sha256(convert_to(history.payload::text, 'UTF8')), 'hex')
  ) AS storage_digest_valid,
  current_entity.id AS current_entity_id,
  current_entity.entity_type AS current_entity_type,
  current_entity.payload AS current_payload,
  current_entity.project_id AS current_project_id,
  current_entity.role_min AS current_role_min,
  current_entity.sensitivity AS current_sensitivity,
  current_entity.lifecycle_status AS current_lifecycle_status,
  projects.code AS current_project_code,
  true AS current_visible
FROM public.graph_entities AS current_entity
LEFT JOIN public.projects AS projects
  ON projects.id = current_entity.project_id
LEFT JOIN LATERAL (
  SELECT history.*
  FROM public.graph_foundation_revisions AS history
  WHERE history.entity_id = current_entity.id
    AND history.entity_type = current_entity.entity_type
  ORDER BY history.revision::numeric DESC
  LIMIT 1
) AS history ON true
WHERE current_entity.id = $1
  AND current_entity.entity_type = $2
ORDER BY history.revision::numeric DESC NULLS LAST
LIMIT 1
`;

/**
 * List the newest revision of each Foundation entity visible in the selected
 * project.  The project filter is by canonical project code, which is the
 * scope identifier selected by the organization BFF.
 */
export const GRAPH_FOUNDATION_LIST_SQL = `
SELECT
  history.entity_id,
  history.entity_type,
  history.revision,
  history.payload,
  history.project_id,
  history.role_min,
  history.sensitivity,
  history.lifecycle_status,
  history.storage_digest,
  history.captured_at,
  (
    history.storage_digest = 'sha256:' ||
      encode(sha256(convert_to(history.payload::text, 'UTF8')), 'hex')
  ) AS storage_digest_valid,
  current_entity.id AS current_entity_id,
  current_entity.entity_type AS current_entity_type,
  current_entity.payload AS current_payload,
  current_entity.project_id AS current_project_id,
  current_entity.role_min AS current_role_min,
  current_entity.sensitivity AS current_sensitivity,
  current_entity.lifecycle_status AS current_lifecycle_status,
  projects.code AS current_project_code,
  true AS current_visible
FROM public.graph_entities AS current_entity
LEFT JOIN public.projects AS projects
  ON projects.id = current_entity.project_id
LEFT JOIN LATERAL (
  SELECT history.*
  FROM public.graph_foundation_revisions AS history
  WHERE history.entity_id = current_entity.id
    AND history.entity_type = current_entity.entity_type
  ORDER BY history.revision::numeric DESC
  LIMIT 1
) AS history ON true
WHERE ($1::text IS NULL OR current_entity.entity_type = $1)
  AND ($2::text IS NULL OR projects.code = $2 OR projects.id IS NULL)
  AND current_entity.entity_type IN ('objective', 'variable', 'model', 'constraint')
ORDER BY current_entity.id, current_entity.entity_type
`;

/**
 * List the newest immutable revision for each philosophy attached to the
 * selected project. The current Graph row is still the authorization
 * boundary; the transaction's RLS policies hide rows the caller cannot see.
 * Unlike the Foundation list, this query requires a canonical project join so
 * a missing project membership cannot be interpreted as a selected-scope hit.
 */
export const GRAPH_PHILOSOPHY_LIST_SQL = `
SELECT
  history.entity_id,
  history.entity_type,
  history.revision,
  history.payload,
  history.project_id,
  history.role_min,
  history.sensitivity,
  history.lifecycle_status,
  history.storage_digest,
  history.captured_at,
  (
    history.storage_digest = 'sha256:' ||
      encode(sha256(convert_to(history.payload::text, 'UTF8')), 'hex')
  ) AS storage_digest_valid,
  current_entity.id AS current_entity_id,
  current_entity.entity_type AS current_entity_type,
  current_entity.payload AS current_payload,
  current_entity.project_id AS current_project_id,
  current_entity.role_min AS current_role_min,
  current_entity.sensitivity AS current_sensitivity,
  current_entity.lifecycle_status AS current_lifecycle_status,
  projects.code AS current_project_code,
  true AS current_visible
FROM public.graph_entities AS current_entity
JOIN public.projects AS projects
  ON projects.id = current_entity.project_id
LEFT JOIN LATERAL (
  SELECT history.*
  FROM public.graph_foundation_revisions AS history
  WHERE history.entity_id = current_entity.id
    AND history.entity_type = current_entity.entity_type
  ORDER BY history.revision::numeric DESC
  LIMIT 1
) AS history ON true
WHERE current_entity.entity_type = 'philosophy'
  AND projects.code = $1
ORDER BY current_entity.id
`;

/** Flat row shape returned by GRAPH_FOUNDATION_READ_SQL. */
export interface GraphFoundationHistoryRow {
  readonly entity_id?: unknown;
  readonly entity_type?: unknown;
  readonly revision?: unknown;
  readonly payload?: unknown;
  readonly project_id?: unknown;
  readonly role_min?: unknown;
  readonly sensitivity?: unknown;
  readonly lifecycle_status?: unknown;
  readonly storage_digest?: unknown;
  readonly storage_digest_valid?: unknown;
  readonly captured_at?: unknown;
  readonly current_entity_id?: unknown;
  readonly current_entity_type?: unknown;
  readonly current_payload?: unknown;
  readonly current_project_id?: unknown;
  readonly current_project_code?: unknown;
  readonly current_role_min?: unknown;
  readonly current_sensitivity?: unknown;
  readonly current_lifecycle_status?: unknown;
  readonly current_visible?: unknown;
}

export interface GraphFoundationQueryResult {
  readonly rows: readonly GraphFoundationHistoryRow[];
}

/** A pg-compatible callback, normally `client.query.bind(client)`. */
export type GraphFoundationQuery = (
  text: string,
  values: readonly unknown[]
) => GraphFoundationQueryResult | readonly GraphFoundationHistoryRow[] | Promise<GraphFoundationQueryResult | readonly GraphFoundationHistoryRow[]>;

export interface GraphFoundationReaderOptions {
  /** Context resolved by the trusted host auth boundary. */
  readonly context: FoundationStoreContext;
  /** Query callback bound to the host's already-authenticated transaction. */
  readonly query: GraphFoundationQuery;
  /** Canonical project code selected by the organization boundary. */
  readonly selectedProjectCode?: string;
}

export interface FoundationObjectiveDetails {
  readonly title?: unknown;
  readonly criteria_text?: unknown;
  readonly beneficiary_description?: unknown;
  readonly evaluation_period_note?: unknown;
  readonly evaluator_note?: unknown;
  readonly current_state?: unknown;
}

/** Runtime shape used by the overview contract for Objective records. */
export interface FoundationOverviewObjectiveRecord extends FoundationCatalogRecord {
  readonly details?: FoundationObjectiveDetails;
}

export interface GraphFoundationReaders {
  readonly store: Pick<FoundationRevisionStore, 'read' | 'readLatest' | 'list'>;
  readonly philosophyReader: PhilosophyRevisionReader;
  /** List latest, current-visible philosophy revisions for the selected project. */
  readonly listPhilosophies: (context: FoundationStoreContext) => Promise<PhilosophyRevisionRecord[]>;
}

const FOUNDATION_TYPES: readonly FoundationType[] = ['objective', 'variable', 'model', 'constraint'];
const REVISION_PATTERN = /^[1-9]\d*$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ACTIVE_LIFECYCLE_STATUSES = new Set(['active']);
const PHILOSOPHY_SCOPE_TYPES = new Set(['project', 'organization']);

/**
 * Create both public read ports over one trusted, transaction-bound context.
 * No principal or tenant is read from a request payload.  The context is
 * closed over by both readers and a caller-supplied context must carry the
 * same principal before any query is issued.
 */
export function createGraphFoundationReaders(options: GraphFoundationReaderOptions): GraphFoundationReaders {
  assertReaderOptions(options);
  const context = cloneContext(options.context);
  const query = options.query;
  const selectedProjectCode = options.selectedProjectCode;

  const store: Pick<FoundationRevisionStore, 'read' | 'readLatest' | 'list'> = {
    async read(reference, suppliedContext): Promise<FoundationCatalogRecord | null> {
      assertTrustedPrincipal(context, suppliedContext);
      assertFoundationReference(reference);

      const rows = await executeRead(query, reference.id, reference.type, reference.revision);
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        throw corrupt('Graph foundation history returned multiple rows for one revision');
      }
      return validateFoundationRecord(rows[0]!, reference, context, selectedProjectCode);
    },

    async readLatest(type, id, suppliedContext): Promise<FoundationCatalogRecord | null> {
      assertTrustedPrincipal(context, suppliedContext);
      assertFoundationType(type);
      assertEntityId(id);

      const rows = await executeLatestRead(query, id, type);
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        throw corrupt('Graph foundation latest query returned multiple rows');
      }
      const row = rows[0]!;
      const reference = rowReference(row);
      if (reference.id !== id || reference.type !== type) {
        throw corrupt('Graph foundation latest row identity does not match the request');
      }
      return validateFoundationRecord(row, reference, context, selectedProjectCode, true);
    },

    async list(type, suppliedContext): Promise<FoundationCatalogRecord[]> {
      assertTrustedPrincipal(context, suppliedContext);
      if (type !== undefined) assertFoundationType(type);

      const rows = await executeList(query, type, selectedProjectCode);
      const seen = new Set<string>();
      return rows.map((row) => {
        const reference = rowReference(row);
        if (type !== undefined && reference.type !== type) {
          throw corrupt('Graph foundation list returned an unexpected entity type');
        }
        const key = `${reference.type}:${reference.id}`;
        if (seen.has(key)) throw corrupt('Graph foundation list returned duplicate entity rows');
        seen.add(key);
        return validateFoundationRecord(row, reference, context, selectedProjectCode, true);
      });
    }
  };

  const philosophyReader: PhilosophyRevisionReader = {
    async readCanonical(input): Promise<PhilosophyRevisionReadResult> {
      return readCanonicalPhilosophyRevision(input, context, query);
    },
    async read(input): Promise<PhilosophyRevisionReadResult> {
      return readPhilosophyRevision(input, context, query);
    }
  };

  async function listPhilosophies(suppliedContext: FoundationStoreContext): Promise<PhilosophyRevisionRecord[]> {
    assertTrustedPrincipal(context, suppliedContext);
    if (selectedProjectCode === undefined) {
      throw scopeViolation('A selected project is required to list philosophy revisions');
    }

    const rows = await executePhilosophyList(query, selectedProjectCode);
    const seen = new Set<string>();
    return rows.map((row) => {
      const id = requireString(row.entity_id, 'Philosophy history entity_id');
      const revision = requireRevision(row.revision, 'Philosophy history revision');
      if (row.current_project_code !== selectedProjectCode) {
        throw scopeViolation('The current philosophy project is outside the selected project scope');
      }
      const key = `${id}:${revision}`;
      if (seen.has(key)) throw corrupt('Philosophy list returned duplicate entity revisions');
      seen.add(key);

      const validated = validatePhilosophyHistoryAccess(row, id, revision, context);
      return createPhilosophyRevisionRecord(validated, id, revision, context.principal);
    });
  }

  return { store, philosophyReader, listPhilosophies };
}

function createPhilosophyRevisionRecord(
  validated: ValidatedPhilosophyHistoryAccess,
  id: string,
  revision: string,
  principal: string
): PhilosophyRevisionRecord {
  return {
    kind: 'philosophy',
    id,
    revision,
    digest: validated.digest,
    payload: validated.history.payload,
    applicability: validated.history.applicability,
    // This is a read-time projection of the current Graph permission. It
    // does not mutate the canonical philosophy payload or Graph ACL.
    currentAcl: privateCurrentAcl(principal),
    currentScope: cloneJudgmentScope(validated.history.applicability.scope)
  };
}

async function readCanonicalPhilosophyRevision(
  input: { readonly id: string; readonly revision: string; readonly context: FoundationStoreContext },
  trustedContext: FoundationStoreContext,
  query: GraphFoundationQuery
): Promise<PhilosophyRevisionReadResult> {
  try {
    assertCanonicalPhilosophyReadRequest(input);
    assertTrustedPrincipal(trustedContext, input.context);
  } catch (error) {
    return {
      status: 'unauthorized',
      message: errorMessage(error, 'Philosophy revision read is outside the trusted context')
    };
  }

  if (!trustedContext.scope || !input.context.scope) {
    return { status: 'unauthorized', message: 'A trusted scope is required for canonical philosophy reads' };
  }

  let rows: readonly GraphFoundationHistoryRow[];
  try {
    rows = await executeRead(query, input.id, 'philosophy', input.revision);
  } catch {
    return { status: 'corrupt', message: 'Philosophy revision history query failed closed' };
  }
  if (rows.length === 0) return { status: 'missing', message: 'Philosophy revision was not found' };
  if (rows.length !== 1) return { status: 'corrupt', message: 'Philosophy revision history returned multiple rows' };

  try {
    const validated = validatePhilosophyHistoryAccess(rowOrThrow(rows), input.id, input.revision, trustedContext);
    return {
      status: 'resolved',
      record: {
        kind: 'philosophy',
        id: input.id,
        revision: input.revision,
        digest: validated.digest,
        payload: validated.history.payload,
        applicability: validated.history.applicability,
        // This is a read-time projection of the current Graph permission. It
        // does not mutate the canonical philosophy payload or Graph ACL.
        currentAcl: privateCurrentAcl(trustedContext.principal),
        currentScope: cloneJudgmentScope(validated.history.applicability.scope)
      }
    };
  } catch (error) {
    const message = errorMessage(error, 'Philosophy revision failed integrity validation');
    if (error instanceof FoundationStoreError && error.code === 'authorization_denied') {
      return { status: 'unauthorized', message };
    }
    return { status: 'corrupt', message };
  }
}

async function readPhilosophyRevision(
  input: PhilosophyRevisionReadRequest,
  trustedContext: FoundationStoreContext,
  query: GraphFoundationQuery
): Promise<PhilosophyRevisionReadResult> {
  try {
    assertPhilosophyReadRequest(input);
  } catch (error) {
    return { status: 'corrupt', message: errorMessage(error, 'Philosophy revision request is invalid') };
  }

  const reference = input.reference;
  if (input.context.principal !== trustedContext.principal) {
    return { status: 'unauthorized', message: 'The requested principal is outside the trusted read context' };
  }
  if (!trustedContext.scope || !scopeAllowed(reference.scope, trustedContext.scope)) {
    return { status: 'unauthorized', message: 'Philosophy revision is outside the trusted project or organization scope' };
  }

  let rows: readonly GraphFoundationHistoryRow[];
  try {
    rows = await executeRead(query, reference.id, 'philosophy', reference.revision);
  } catch {
    return { status: 'corrupt', message: 'Philosophy revision history query failed closed' };
  }
  if (rows.length === 0) return { status: 'missing', message: 'Philosophy revision was not found' };
  if (rows.length !== 1) return { status: 'corrupt', message: 'Philosophy revision history returned multiple rows' };

  const row = rows[0]!;
  try {
    const validated = validatePhilosophyHistoryAccess(row, reference.id, reference.revision, trustedContext);
    if (!scopeEqual(validated.history.applicability.scope, reference.scope)) {
      return { status: 'unauthorized', message: 'Philosophy revision applicability scope does not match the request' };
    }
    if (!scopeEqual(validated.current.philosophy!.applicability.scope, reference.scope)) {
      return { status: 'unauthorized', message: 'Current philosophy applicability scope does not match the request' };
    }
    if (validated.digest !== reference.digest) {
      return { status: 'corrupt', message: 'Philosophy revision digest does not match the requested reference' };
    }
    return {
      status: 'resolved',
      record: {
        kind: 'philosophy',
        id: reference.id,
        revision: reference.revision,
        digest: validated.digest,
        payload: validated.history.payload,
        applicability: validated.history.applicability,
        // This is a read-time projection of the current Graph permission. It
        // does not mutate the canonical philosophy payload or Graph ACL.
        currentAcl: privateCurrentAcl(trustedContext.principal),
        currentScope: cloneJudgmentScope(reference.scope)
      }
    };
  } catch (error) {
    const message = errorMessage(error, 'Philosophy revision failed integrity validation');
    if (error instanceof FoundationStoreError && error.code === 'authorization_denied') {
      return { status: 'unauthorized', message };
    }
    return { status: 'corrupt', message };
  }
}

interface ValidatedPhilosophyHistoryAccess {
  readonly history: ValidatedPhilosophyHistory;
  readonly current: ValidatedCurrentRow & {
    readonly philosophy: { readonly applicability: PhilosophyRevisionApplicability };
  };
  readonly digest: ReturnType<typeof philosophyRevisionDigest>;
}

function validatePhilosophyHistoryAccess(
  row: GraphFoundationHistoryRow,
  id: string,
  revision: string,
  trustedContext: FoundationStoreContext
): ValidatedPhilosophyHistoryAccess {
  const history = validatePhilosophyHistoryRow(row, { id, revision });
  const current = validateCurrentRow(row, id, 'philosophy');
  const philosophy = current.philosophy;
  if (!philosophy) {
    throw corrupt('Current Graph philosophy applicability is missing');
  }
  if (history.projectId !== current.projectId) {
    throw new FoundationStoreError('authorization_denied', 'Philosophy history moved outside its current project');
  }
  if (!trustedContext.scope || !scopeAllowed(history.applicability.scope, trustedContext.scope) ||
      !scopeAllowed(philosophy.applicability.scope, trustedContext.scope)) {
    throw new FoundationStoreError('authorization_denied', 'Current philosophy scope is outside the trusted read context');
  }
  if (!scopeEqual(history.applicability.scope, philosophy.applicability.scope)) {
    throw new FoundationStoreError('authorization_denied', 'Historical and current philosophy applicability scopes do not match');
  }
  const digest = philosophyRevisionDigest({
    kind: 'philosophy',
    id,
    revision,
    payload: history.payload,
    applicability: history.applicability
  });
  return { history, current: { ...current, philosophy }, digest };
}

async function executeRead(
  query: GraphFoundationQuery,
  id: string,
  type: string,
  revision: string
): Promise<readonly GraphFoundationHistoryRow[]> {
  let result: GraphFoundationQueryResult | readonly GraphFoundationHistoryRow[];
  try {
    result = await query(GRAPH_FOUNDATION_READ_SQL, [id, type, revision]);
  } catch {
    throw corrupt('Graph foundation history query failed');
  }
  if (Array.isArray(result)) return result;
  if (!Array.isArray(result) && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as readonly GraphFoundationHistoryRow[];
  }
  throw corrupt('Graph foundation history query returned an invalid result');
}

async function executeLatestRead(
  query: GraphFoundationQuery,
  id: string,
  type: FoundationType
): Promise<readonly GraphFoundationHistoryRow[]> {
  let result: GraphFoundationQueryResult | readonly GraphFoundationHistoryRow[];
  try {
    result = await query(GRAPH_FOUNDATION_LATEST_SQL, [id, type]);
  } catch {
    throw corrupt('Graph foundation latest query failed');
  }
  if (Array.isArray(result)) return result;
  if (!Array.isArray(result) && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as readonly GraphFoundationHistoryRow[];
  }
  throw corrupt('Graph foundation latest query returned an invalid result');
}

async function executeList(
  query: GraphFoundationQuery,
  type: FoundationType | undefined,
  selectedProjectCode: string | undefined
): Promise<readonly GraphFoundationHistoryRow[]> {
  let result: GraphFoundationQueryResult | readonly GraphFoundationHistoryRow[];
  try {
    result = await query(GRAPH_FOUNDATION_LIST_SQL, [type ?? null, selectedProjectCode ?? null]);
  } catch {
    throw corrupt('Graph foundation list query failed');
  }
  if (Array.isArray(result)) return result;
  if (!Array.isArray(result) && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as readonly GraphFoundationHistoryRow[];
  }
  throw corrupt('Graph foundation list query returned an invalid result');
}

async function executePhilosophyList(
  query: GraphFoundationQuery,
  selectedProjectCode: string
): Promise<readonly GraphFoundationHistoryRow[]> {
  let result: GraphFoundationQueryResult | readonly GraphFoundationHistoryRow[];
  try {
    result = await query(GRAPH_PHILOSOPHY_LIST_SQL, [selectedProjectCode]);
  } catch {
    throw corrupt('Graph philosophy list query failed');
  }
  if (Array.isArray(result)) return result;
  if (!Array.isArray(result) && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as readonly GraphFoundationHistoryRow[];
  }
  throw corrupt('Graph philosophy list query returned an invalid result');
}

interface ValidatedFoundationHistory {
  readonly definition: FoundationDefinition;
  readonly payload: Record<string, unknown>;
  readonly projectId: string;
}

interface ValidatedPhilosophyHistory {
  readonly payload: PhilosophyRevisionRecord['payload'];
  readonly applicability: PhilosophyRevisionApplicability;
  readonly projectId: string;
}

interface ValidatedCurrentRow {
  readonly payload: Record<string, unknown>;
  readonly projectId: string;
  readonly projectCode?: string;
  readonly foundation?: FoundationDefinition;
  readonly philosophy?: {
    readonly applicability: PhilosophyRevisionApplicability;
  };
}

function validateFoundationRecord(
  row: GraphFoundationHistoryRow,
  reference: FoundationRevision,
  context: FoundationStoreContext,
  selectedProjectCode: string | undefined,
  requireCurrentRevision = false
): FoundationOverviewObjectiveRecord {
  const history = validateHistoryRow(row, reference.id, reference.type, reference.revision);
  const current = validateCurrentRow(row, reference.id, reference.type);
  if (requireCurrentRevision && current.projectCode === undefined) {
    throw corrupt('Current Graph project code is missing');
  }
  authorizeCurrentFoundation(current, context, selectedProjectCode);

  // Latest reads must prove that the current Graph payload points at the
  // revision returned by the history query. Otherwise a missing newer history
  // row could silently fall back to an older immutable revision.
  if (requireCurrentRevision && current.foundation?.revision !== reference.revision) {
    throw corrupt('Current Graph foundation revision does not match the latest history revision');
  }

  // A history row remains readable only through the current Graph row,
  // including its current project and current scope. The old payload is
  // returned unchanged after these current-row checks.
  if (history.projectId !== current.projectId) {
    throw scopeViolation('Historical foundation project differs from current Graph project');
  }
  const record: FoundationOverviewObjectiveRecord = {
    definition: cloneFoundationDefinition(history.definition),
    digest: digestFoundationDefinition(history.definition)
  };
  if (reference.type === 'objective') {
    const details = projectObjectiveDetails(history.payload);
    if (details !== undefined) return { ...record, details };
  }
  return record;
}

const OBJECTIVE_DETAIL_KEYS = [
  'title',
  'criteria_text',
  'beneficiary_description',
  'evaluation_period_note',
  'evaluator_note',
  'current_state'
] as const satisfies readonly (keyof FoundationObjectiveDetails)[];

function projectObjectiveDetails(payload: Record<string, unknown>): FoundationObjectiveDetails | undefined {
  const nestedDetails = isPlainRecord(payload.details) ? payload.details : undefined;
  const foundation = isPlainRecord(payload.foundation) ? payload.foundation : undefined;
  // Graphify payloads historically carried these descriptive fields at the
  // payload root. Keep the two known nested forms compatible while exposing
  // only the six fields in the overview contract.
  const candidates = [payload, nestedDetails, foundation].filter(
    (candidate): candidate is Record<string, unknown> => candidate !== undefined
  );
  const projected: Record<string, unknown> = {};
  for (const key of OBJECTIVE_DETAIL_KEYS) {
    const source = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(candidate, key));
    if (source !== undefined && source[key] !== undefined) projected[key] = source[key];
  }
  return Object.keys(projected).length === 0 ? undefined : projected as FoundationObjectiveDetails;
}

function rowReference(row: GraphFoundationHistoryRow): FoundationRevision {
  const id = requireString(row.entity_id, 'Foundation history entity_id');
  const type = parseFoundationType(row.entity_type);
  const revision = requireRevision(row.revision, 'Foundation history revision');
  return { id, type, revision };
}

function validateHistoryRow(
  row: GraphFoundationHistoryRow,
  id: string,
  type: FoundationType,
  revision: string
): ValidatedFoundationHistory {
  assertRowIdentity(row, id, type, revision);
  assertStorageDigest(row);
  const payload = requireObject(row.payload, 'Foundation history payload');
  const definition = requireObject(payload.foundation, 'Foundation history payload.foundation') as unknown as FoundationDefinition;
  const result = validateFoundationDefinition(definition, { use: 'draft' });
  if (!result.valid) throw corrupt(`Foundation history definition is invalid: ${result.issues.map((issue) => issue.path).join(', ')}`);
  if (definition.id !== id || definition.type !== type || definition.revision !== revision) {
    throw corrupt('Foundation history definition identity does not match the requested revision');
  }
  const projectId = requireString(row.project_id, 'Foundation history project_id');
  return { definition, payload, projectId };
}

function validatePhilosophyHistoryRow(
  row: GraphFoundationHistoryRow,
  reference: Pick<PhilosophyRevisionReference, 'id' | 'revision'>
): ValidatedPhilosophyHistory {
  assertRowIdentity(row, reference.id, 'philosophy', reference.revision);
  assertStorageDigest(row);
  const payload = requireJsonValue(row.payload, 'Philosophy history payload');
  const applicability = parseJudgmentApplicability(payload);
  const projectId = requireString(row.project_id, 'Philosophy history project_id');
  return { payload, applicability, projectId };
}

function assertCanonicalPhilosophyReadRequest(
  input: { readonly id: string; readonly revision: string; readonly context: FoundationStoreContext }
): void {
  if (!isPlainRecord(input) || typeof input.id !== 'string' || input.id.trim().length === 0 || input.id.includes('\0') ||
      typeof input.revision !== 'string' || !REVISION_PATTERN.test(input.revision) ||
      !isPlainRecord(input.context) || typeof input.context.principal !== 'string' ||
      input.context.principal.trim().length === 0 || input.context.principal.includes('\0')) {
    throw new TypeError('Canonical philosophy revision request is invalid');
  }
}

function rowOrThrow(rows: readonly GraphFoundationHistoryRow[]): GraphFoundationHistoryRow {
  const row = rows[0];
  if (!row) throw corrupt('Philosophy revision history row is missing');
  return row;
}

function validateCurrentRow(row: GraphFoundationHistoryRow, id: string, type: string): ValidatedCurrentRow {
  if (row.current_visible !== true) {
    throw new FoundationStoreError('authorization_denied', 'The current Graph row is not visible in the trusted transaction');
  }
  if (row.current_entity_id !== id || row.current_entity_type !== type) {
    throw corrupt('Current Graph identity does not match the historical row');
  }
  if (!ACTIVE_LIFECYCLE_STATUSES.has(String(row.current_lifecycle_status))) {
    throw new FoundationStoreError('authorization_denied', 'The current Graph row is not active');
  }
  const projectId = requireString(row.current_project_id, 'Current Graph project_id');
  const projectCode = typeof row.current_project_code === 'string' && row.current_project_code.length > 0
    ? row.current_project_code
    : undefined;
  const payload = requireObject(row.current_payload, 'Current Graph payload');
  if (type === 'philosophy') {
    const applicability = parseJudgmentApplicability(payload);
    return { payload, projectId, projectCode, philosophy: { applicability } };
  }
  const definition = requireObject(payload.foundation, 'Current Graph payload.foundation') as unknown as FoundationDefinition;
  const result = validateFoundationDefinition(definition, { use: 'draft' });
  if (!result.valid || definition.id !== id || definition.type !== type) {
    throw corrupt('Current Graph foundation definition is invalid');
  }
  return { payload, projectId, projectCode, foundation: definition };
}

function authorizeCurrentFoundation(
  current: ValidatedCurrentRow,
  context: FoundationStoreContext,
  selectedProjectCode?: string
): void {
  if (!current.foundation) throw corrupt('Current Graph foundation definition is missing');
  if (selectedProjectCode !== undefined && current.projectCode !== selectedProjectCode) {
    throw scopeViolation('The current Graph project is outside the selected project scope');
  }
  const definition = current.foundation;
  if (!canRead(definition.acl, context.principal)) {
    throw new FoundationStoreError('authorization_denied', 'The current foundation ACL does not permit this principal');
  }
  if (context.scope && !scopeAllowed(definition.scope, context.scope)) {
    throw new FoundationStoreError('scope_violation', 'The current foundation scope is outside the trusted context');
  }
}

function assertStorageDigest(row: GraphFoundationHistoryRow): void {
  if (row.storage_digest_valid !== true || typeof row.storage_digest !== 'string' || !DIGEST_PATTERN.test(row.storage_digest)) {
    throw corrupt('Foundation history storage digest is missing or invalid');
  }
}

function assertRowIdentity(row: GraphFoundationHistoryRow, id: string, type: string, revision: string): void {
  if (row.entity_id !== id || row.entity_type !== type || row.revision !== revision) {
    throw corrupt('Foundation history identity does not match the requested revision');
  }
}

function parseFoundationType(value: unknown): FoundationType {
  if (typeof value === 'string' && FOUNDATION_TYPES.includes(value as FoundationType)) {
    return value as FoundationType;
  }
  throw corrupt('Foundation history entity_type is invalid');
}

function requireRevision(value: unknown, label: string): string {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) {
    throw corrupt(`${label} must be a positive revision`);
  }
  return value;
}

function assertEntityId(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new FoundationStoreError('invalid_input', 'A foundation entity id is required');
  }
}

function assertFoundationType(value: FoundationType): void {
  if (!FOUNDATION_TYPES.includes(value)) {
    throw new FoundationStoreError('invalid_input', 'A supported foundation type is required');
  }
}

function assertFoundationReference(reference: FoundationRevision): void {
  if (!isPlainRecord(reference) || typeof reference.id !== 'string' || reference.id.length === 0 ||
      !FOUNDATION_TYPES.includes(reference.type as FoundationType) ||
      typeof reference.revision !== 'string' || !REVISION_PATTERN.test(reference.revision)) {
    throw new FoundationStoreError('invalid_input', 'A foundation revision reference requires id, type, and a positive revision');
  }
}

function assertPhilosophyReadRequest(input: PhilosophyRevisionReadRequest): void {
  if (!isPlainRecord(input) || !isPlainRecord(input.reference) || input.reference.kind !== 'philosophy' ||
      typeof input.reference.id !== 'string' || input.reference.id.length === 0 ||
      typeof input.reference.revision !== 'string' || !REVISION_PATTERN.test(input.reference.revision) ||
      typeof input.reference.digest !== 'string' || !DIGEST_PATTERN.test(input.reference.digest) ||
      !isPlainRecord(input.reference.scope) || !PHILOSOPHY_SCOPE_TYPES.has(String(input.reference.scope.type)) ||
      typeof input.reference.scope.id !== 'string' || input.reference.scope.id.length === 0 ||
      !isPlainRecord(input.context) || typeof input.context.principal !== 'string' ||
      !input.context.principal || !isPlainRecord(input.context.scope)) {
    throw new TypeError('Philosophy revision request is invalid');
  }
}

function assertReaderOptions(options: GraphFoundationReaderOptions): void {
  if (!options || typeof options !== 'object' || typeof options.query !== 'function') {
    throw new TypeError('A transaction-bound Graph foundation query is required');
  }
  if (!options.context || typeof options.context.principal !== 'string' || options.context.principal.trim().length === 0) {
    throw new TypeError('A trusted Graph foundation principal is required');
  }
  if (options.context.scope !== undefined) {
    const scope = options.context.scope;
    if (!isValidFoundationScope(scope)) throw new TypeError('A trusted Graph foundation scope is invalid');
  }
  if (options.selectedProjectCode !== undefined
    && (typeof options.selectedProjectCode !== 'string' || options.selectedProjectCode.trim().length === 0)) {
    throw new TypeError('A selected Graph project code is invalid');
  }
}

function assertTrustedPrincipal(trusted: FoundationStoreContext, supplied: FoundationStoreContext): void {
  if (!supplied || supplied.principal !== trusted.principal) {
    throw new FoundationStoreError('authorization_denied', 'The supplied principal does not match the trusted read context');
  }
}

function cloneContext(context: FoundationStoreContext): FoundationStoreContext {
  return {
    principal: context.principal,
    ...(context.scope === undefined ? {} : { scope: cloneFoundationScope(context.scope) })
  };
}

function privateCurrentAcl(principal: string): FoundationAcl {
  return { ownerId: principal, visibility: 'private', readerIds: [], writerIds: [] };
}

function canRead(acl: FoundationAcl, principal: string): boolean {
  return acl.visibility === 'public' || acl.ownerId === principal || acl.readerIds.includes(principal) || acl.writerIds.includes(principal);
}

function scopeAllowed(scope: FoundationScope | { type: string; id: string }, trusted: FoundationScope): boolean {
  const ids = 'subjectIds' in scope ? scope.subjectIds : [scope.id];
  return ids.some((id) => trusted.subjectIds.includes(id));
}

function scopeEqual(left: { type: string; id: string }, right: { type: string; id: string }): boolean {
  return left.type === right.type && left.id === right.id;
}

function cloneFoundationScope(scope: FoundationScope): FoundationScope {
  return {
    subjectIds: [...scope.subjectIds],
    validFrom: scope.validFrom,
    ...(scope.validUntil === undefined ? {} : { validUntil: scope.validUntil })
  };
}

function cloneJudgmentScope(scope: PhilosophyRevisionReference['scope']): PhilosophyRevisionReference['scope'] {
  return { type: scope.type, id: scope.id };
}

function isValidFoundationScope(value: unknown): value is FoundationScope {
  if (!isPlainRecord(value) || !Array.isArray(value.subjectIds) || value.subjectIds.length === 0 ||
      !value.subjectIds.every((item) => typeof item === 'string' && item.trim().length > 0) ||
      typeof value.validFrom !== 'string' || parseRfc3339(value.validFrom) === undefined) return false;
  return value.validUntil === undefined || (typeof value.validUntil === 'string' && parseRfc3339(value.validUntil) !== undefined && parseRfc3339(value.validUntil)! > parseRfc3339(value.validFrom)!);
}

function parseJudgmentApplicability(payload: unknown): PhilosophyRevisionApplicability {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.judgmentApplicability)) {
    throw corrupt('Philosophy payload requires judgmentApplicability');
  }
  const value = payload.judgmentApplicability;
  if (!isPlainRecord(value.scope) || !PHILOSOPHY_SCOPE_TYPES.has(String(value.scope.type)) ||
      typeof value.scope.id !== 'string' || value.scope.id.length === 0 ||
      typeof value.validFrom !== 'string' || parseRfc3339(value.validFrom) === undefined ||
      (value.validUntil !== undefined && (typeof value.validUntil !== 'string' || parseRfc3339(value.validUntil) === undefined || parseRfc3339(value.validUntil)! < parseRfc3339(value.validFrom)!))) {
    throw corrupt('Philosophy judgmentApplicability is invalid');
  }
  return {
    scope: { type: value.scope.type as PhilosophyRevisionApplicability['scope']['type'], id: value.scope.id },
    validFrom: value.validFrom,
    ...(value.validUntil === undefined ? {} : { validUntil: value.validUntil })
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw corrupt(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw corrupt(`${label} must be a non-empty string`);
  return value;
}

function requireJsonValue(value: unknown, label: string): PhilosophyRevisionRecord['payload'] {
  if (value === undefined) throw corrupt(`${label} is missing`);
  try {
    canonicalPortableJson(value);
  } catch {
    throw corrupt(`${label} must be JSON`);
  }
  return value as PhilosophyRevisionRecord['payload'];
}

function parseRfc3339(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return undefined;
  const fraction = match[7] ?? '';
  const milliseconds = Number((fraction + '000').slice(0, 3));
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function corrupt(message: string): FoundationStoreError {
  return new FoundationStoreError('corrupt_catalog', message);
}

function scopeViolation(message: string): FoundationStoreError {
  return new FoundationStoreError('scope_violation', message);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
