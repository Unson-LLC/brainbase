/*
 * HTTP adapter for the Objective editor port.
 *
 * It maps ObjectiveEditorPort methods onto the Foundation Objective routes
 * (`GET/POST /objectives`, `GET/PUT /objectives/:id`, `/readiness`,
 * `/constraints`).  The host injects the fetcher, base path and write token;
 * this module keeps no global state.  Authority fields (ACL, scope, storage,
 * provenance, authorized uses) are decided by the host from its trusted
 * context, so they are removed before a definition leaves the browser.
 * Constraint links are only read here; there is no replace method.
 */

export const OBJECTIVE_EDITOR_HTTP_PORT_VERSION = 'brainbase.objective-editor-http-port.v1';

/** Top-level fields the Foundation route rejects with `authority_field_in_body`. */
export const OBJECTIVE_AUTHORITY_FIELDS = Object.freeze([
  'acl', 'scope', 'storage', 'provenance', 'authorizedUses', 'authorized_uses',
  'ownerId', 'owner_id', 'userId', 'user_id', 'memberId', 'member_id',
  'readerIds', 'reader_ids', 'writerIds', 'writer_ids', 'tenant', 'subjectIds', 'subject_ids',
  'tenantId', 'tenant_id', 'organization', 'organization_id', 'organizationId', 'org', 'orgId', 'org_id',
  'workspace', 'workspaceId', 'workspace_id', 'principal', 'actor', 'actorId', 'actor_id',
  'role', 'roles', 'raci', 'authorization', 'permission', 'permissions',
]);

const AUTHORITY_FIELD_SET = new Set(OBJECTIVE_AUTHORITY_FIELDS);

const ERROR_MESSAGES = Object.freeze({
  revision_conflict: '別の保存で版が進んでいます。入力は残しています。再読込して今の版を確かめてください。',
  authority_field_in_body: '権限・範囲・保存先・由来はホストが決めるため、画面からは送れません。',
  authority_field_change: '権限・範囲・保存先・由来は変更できません。',
  authorization_denied: 'この目的を読み書きする権限がありません。',
  scope_violation: 'この目的は扱える範囲の外にあります。',
  csrf_failed: '起動時のトークンを確かめられません。ページを開き直してください。',
  web_token_required: '起動時のトークンを確かめられません。ページを開き直してください。',
  cross_origin_rejected: '別のサイトからの保存は受け付けません。',
  graph_migration_required: 'Graphの移行が必要です。',
  body_too_large: '入力が大きすぎます。',
  payload_too_large: '入力が大きすぎます。',
  network_error: 'ホストに接続できません。',
  invalid_response: 'ホストの応答を読み取れません。',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Error thrown by the port. `code`/`status`/`currentRevision` follow the editor's error contract. */
export class ObjectiveEditorHttpError extends Error {
  constructor({ code, status, message, currentRevision = null, detail = null }) {
    super(message);
    this.name = 'ObjectiveEditorHttpError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.currentRevision = currentRevision;
    this.detail = detail;
  }
}

function errorFromResponse(status, payload) {
  const error = isRecord(payload?.error) ? payload.error : {};
  const code = typeof error.code === 'string' && error.code ? error.code : `http_${status}`;
  const detail = typeof error.message === 'string' && error.message ? error.message : null;
  const base = ERROR_MESSAGES[code];
  const message = code === 'invalid_input' || code === 'invalid_json'
    ? `入力が保存の条件を満たしていません${detail ? `（${detail}）` : ''}`
    : base ?? detail ?? `HTTP ${status}`;
  return new ObjectiveEditorHttpError({
    code,
    status,
    message,
    currentRevision: typeof error.currentRevision === 'string' ? error.currentRevision : null,
    detail,
  });
}

/** Shallow copy of a draft without the fields the host owns. */
export function stripObjectiveAuthorityFields(definition) {
  if (!isRecord(definition)) return definition;
  return Object.fromEntries(Object.entries(definition).filter(([key]) => !AUTHORITY_FIELD_SET.has(key)));
}

export function createObjectiveEditorHttpPort({
  fetcher,
  basePath = '/api/foundation',
  token,
  tokenHeader = 'X-Brainbase-Review-Token',
  /** Called with each list payload, e.g. to show how many records could not be read. */
  onListResult,
} = {}) {
  const request = typeof fetcher === 'function'
    ? fetcher
    : typeof globalThis.fetch === 'function' ? (path, init) => globalThis.fetch(path, init) : null;
  const base = String(basePath).replace(/\/+$/u, '');

  async function call(path, init) {
    if (!request) throw new ObjectiveEditorHttpError({ code: 'network_error', status: 0, message: ERROR_MESSAGES.network_error });
    let response;
    try {
      response = await request(path, init);
    } catch {
      throw new ObjectiveEditorHttpError({ code: 'network_error', status: 0, message: ERROR_MESSAGES.network_error });
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) throw errorFromResponse(response.status, payload);
    if (payload === null) throw new ObjectiveEditorHttpError({ code: 'invalid_response', status: response.status, message: ERROR_MESSAGES.invalid_response });
    return payload;
  }

  const objectivePath = (id, suffix = '') => `${base}/objectives/${encodeURIComponent(id)}${suffix}`;
  const withRevision = (path, revision) => (revision ? `${path}?revision=${encodeURIComponent(revision)}` : path);
  const writeInit = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { [tokenHeader]: token } : {}) },
    body: JSON.stringify(body),
  });

  return {
    contractVersion: OBJECTIVE_EDITOR_HTTP_PORT_VERSION,
    async listObjectives() {
      const payload = await call(`${base}/objectives`);
      onListResult?.(payload);
      return payload;
    },
    async readObjective(id, _context, revision) {
      try {
        return await call(withRevision(objectivePath(id), revision));
      } catch (error) {
        // A missing Objective is a readback miss, not a failure of the request.
        if (error instanceof ObjectiveEditorHttpError && error.status === 404 && error.code === 'not_found') return null;
        throw error;
      }
    },
    checkObjectiveReadiness(id, _context, revision) {
      return call(withRevision(objectivePath(id, '/readiness'), revision));
    },
    createObjective(definition) {
      return call(`${base}/objectives`, writeInit('POST', stripObjectiveAuthorityFields(definition)));
    },
    updateObjective(id, expectedRevision, definition) {
      return call(objectivePath(id), writeInit('PUT', { expectedRevision, definition: stripObjectiveAuthorityFields(definition) }));
    },
    listObjectiveConstraintRefs(reference) {
      return call(withRevision(objectivePath(reference.id, '/constraints'), reference.revision));
    },
  };
}

export default createObjectiveEditorHttpPort;
