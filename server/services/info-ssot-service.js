// Visibility is enforced only by policy info_graph_entities_select.
// This query does not repeat that predicate. A second copy kept the
// non-inlined function in the plan (estimate 52 rows, actual 6702).

export const GRAPH_ENTITY_PAGE_DEFAULT = 50;
export const GRAPH_ENTITY_PAGE_MAX = 100;

export const GRAPH_ENTITY_LIST_SQL = `SELECT ge.id,
       ge.updated_at,
       ge.entity_type,
       ge.project_id,
       ge.payload,
       ge.role_min,
       ge.sensitivity,
       ge.lifecycle_status
FROM public.graph_entities AS ge
WHERE (
    $1::timestamptz IS NULL
    OR ge.updated_at < $1::timestamptz
    OR (ge.updated_at = $1::timestamptz AND ge.id < $2::text)
  )
  AND ($4::text IS NULL OR ge.entity_type = $4)
  AND (
    $5::text IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = ge.project_id
        AND project.code = $5
    )
  )
ORDER BY ge.updated_at DESC, ge.id DESC
LIMIT $3`;

export function graphEntityPageLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return GRAPH_ENTITY_PAGE_DEFAULT;
  return Math.min(Math.floor(parsed), GRAPH_ENTITY_PAGE_MAX);
}

export function encodeGraphEntityCursor(row) {
  if (!row?.id || row.updated_at === undefined || row.updated_at === null) {
    throw cursorError('cursor row is missing updated_at or id');
  }
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : String(row.updated_at);
  return Buffer.from(JSON.stringify({ updated_at: updatedAt, id: String(row.id) }), 'utf8').toString('base64url');
}

export function decodeGraphEntityCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.length > 512) throw cursorError('cursor is invalid');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw cursorError('cursor is invalid');
  }
  if (!parsed || typeof parsed.id !== 'string' || parsed.id.length === 0 || parsed.id.length > 200) {
    throw cursorError('cursor is invalid');
  }
  if (typeof parsed.updated_at !== 'string' || !Number.isFinite(Date.parse(parsed.updated_at))) {
    throw cursorError('cursor is invalid');
  }
  return { updatedAt: new Date(parsed.updated_at).toISOString(), id: parsed.id };
}

export function pageGraphEntityRows(rows, limit) {
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit && page.length > 0
    ? encodeGraphEntityCursor(page[page.length - 1])
    : null;
  return { records: page, next_cursor: nextCursor };
}

function cursorError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function assertAccess(access) {
  if (!access?.role) throw Object.assign(new Error('Access role is required'), { status: 400 });
  if (!Array.isArray(access.projectCodes) || access.projectCodes.length === 0) {
    throw Object.assign(new Error('Access project list is required'), { status: 400 });
  }
  if (!Array.isArray(access.clearance) || access.clearance.length === 0) {
    throw Object.assign(new Error('Access clearance is required'), { status: 400 });
  }
}

/**
 * Transaction-local access context. jit is disabled here because the list
 * query spent about 1.2s of 2.5s compiling, inside a 4s gateway timeout.
 */
export async function withAccessContext(client, access, handler) {
  assertAccess(access);
  const organizationId = access.organizationId || access.tenantId || '';
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('jit', 'off', true)");
    await client.query('SELECT set_config($1, $2, true)', ['app.role', access.role]);
    await client.query('SELECT set_config($1, $2, true)', ['app.project_codes', access.projectCodes.join(',')]);
    await client.query('SELECT set_config($1, $2, true)', ['app.clearance', access.clearance.join(',')]);
    await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.person_id', access.personId || '']);
    await client.query('SELECT set_config($1, $2, true)', ['app.graph_maintenance_mode', access.graphMaintenanceMode === true ? 'true' : 'false']);
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function listGraphEntities(client, access, options = {}) {
  return withAccessContext(client, access, async (queryClient) => {
    const limit = graphEntityPageLimit(options.limit);
    const cursor = decodeGraphEntityCursor(options.cursor);
    const { rows } = await queryClient.query(GRAPH_ENTITY_LIST_SQL, [
      cursor?.updatedAt ?? null,
      cursor?.id ?? null,
      limit + 1,
      options.entityType || null,
      options.projectCode || null
    ]);
    return pageGraphEntityRows(rows, limit);
  });
}

export class InfoSSOTService {
  constructor({ query } = {}) {
    this.query = query;
  }

  client() {
    if (typeof this.query !== 'function') {
      throw Object.assign(new Error('Info SSOT query client is not configured'), { status: 503 });
    }
    return { query: this.query };
  }

  async withAccessContext(access, handler) {
    return withAccessContext(this.client(), access, handler);
  }

  async listGraphEntities(access, options = {}) {
    return listGraphEntities(this.client(), access, options);
  }
}
