import { createMeetingMinutesLineageView } from './meeting-minutes-lineage.js';

/** Browser-side transport and host action-slot bridge for the lineage screen. */
export const MEETING_MINUTES_LINEAGE_HTTP_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-lineage-http-ui.v1';

export function createMeetingMinutesLineageHttpActions({
  reference,
  basePath = '/api/meeting-minutes-lineage',
  fetcher = globalThis.fetch,
  token,
  actorFor,
  idFor,
  idempotencyKeyFor,
} = {}) {
  if (!reference || typeof reference !== 'object') throw new TypeError('reference is required');
  if (typeof fetcher !== 'function') throw new TypeError('fetcher is required');
  const auditActorFor = typeof actorFor === 'function' ? actorFor : () => ({ type: 'person', id: 'browser-ui' });
  const operationIds = new Map();
  const operationId = (candidate, action) => {
    const stable = candidate && typeof candidate === 'object'
      ? (candidate.draftId ?? candidate.id ?? candidate.candidateId ?? candidate.candidate?.id)
      : null;
    const key = `${action}:${typeof stable === 'string' && stable ? stable : 'operation'}`;
    let id = operationIds.get(key);
    if (!id) {
      id = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `lineage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      operationIds.set(key, id);
    }
    return id;
  };
  const operationIdFor = typeof idFor === 'function'
    ? ({ candidate, action }) => {
      const key = `${action}:${operationId(candidate, action)}`;
      if (!operationIds.has(`id:${key}`)) operationIds.set(`id:${key}`, idFor({ candidate, action }));
      return operationIds.get(`id:${key}`);
    }
    : ({ candidate, action }) => operationId(candidate, action);
  const operationKeyFor = typeof idempotencyKeyFor === 'function'
    ? ({ candidate, action }) => {
      const key = `${action}:${operationId(candidate, action)}`;
      if (!operationIds.has(`key:${key}`)) operationIds.set(`key:${key}`, idempotencyKeyFor({ candidate, action }));
      return operationIds.get(`key:${key}`);
    }
    : ({ candidate, action }) => `meeting-minutes-lineage:${operationId(candidate, action)}`;
  const prefix = String(basePath).replace(/\/+$/u, '');
  const requestJson = async (path, body) => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers['X-Brainbase-Review-Token'] = token;
    const response = await fetcher(`${prefix}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    // The local shell's request helper returns parsed JSON, while a direct
    // fetcher returns a Response. Support both so the extension remains a
    // usable host action slot outside the default shell.
    if (!response || typeof response.json !== 'function') {
      if (response?.ok === false) {
        const failure = new Error(`Lineage request failed (${response.status ?? 'unknown'})`);
        failure.code = 'lineage_unavailable';
        failure.status = response.status;
        throw failure;
      }
      return response;
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = payload?.error;
      const failure = new Error(typeof error?.message === 'string' ? error.message : `Lineage request failed (${response.status})`);
      failure.code = typeof error?.code === 'string' ? error.code : 'lineage_unavailable';
      failure.status = response.status;
      throw failure;
    }
    return payload;
  };
  const requestMutation = (candidate, action, path, extra = {}) => requestJson(path, {
    id: operationIdFor({ candidate, action }),
    idempotencyKey: operationKeyFor({ candidate, action }),
    // This is retained as an audit hint only. The host resolves the actor
    // from its verified context and ignores this field for authority.
    actor: auditActorFor({ candidate, action }),
    ...extra,
  });
  return {
    load: () => requestJson('/by-version', { reference }),
    actions: {
      createCandidate: (input) => {
        if (!input || (input.kind !== 'judgment' && input.kind !== 'task')) {
          return Promise.reject(Object.assign(new Error('候補の種類を選んでください。'), { code: 'invalid_input' }));
        }
        const candidate = { ...input, draftId: input.draftId ?? operationId(input, 'create') };
        return requestMutation(candidate, 'create', '/candidates', {
          evidence: reference,
          kind: candidate.kind,
          proposal: candidate.proposal,
          epistemicStatus: candidate.epistemicStatus ?? 'inferred',
        });
      },
      confirmCandidate: (candidate) => requestMutation(candidate, 'confirm', `/candidates/${encodeURIComponent(candidate.id)}/confirm`, {
        evidenceDigest: candidate.evidenceDigest,
      }),
      adoptJudgment: (candidate) => requestMutation(candidate, 'adopt_judgment', `/candidates/${encodeURIComponent(candidate.id)}/adopt/judgment`),
      adoptTask: (candidate) => requestMutation(candidate, 'adopt_task', `/candidates/${encodeURIComponent(candidate.id)}/adopt/task`),
      // Corrections are intentionally host-owned because they require an
      // explicit replacement version and a human supplied reason.
    },
  };
}

/**
 * Connect a host-owned shared UI action slot to the real HTTP loader/actions.
 * The slot must mount the returned view; an absent slot is a wiring error,
 * never a successful no-op.
 */
export function connectMeetingMinutesLineageActionSlot({
  slot,
  root,
  reference,
  basePath,
  fetcher,
  token,
  actorFor,
  idFor,
  idempotencyKeyFor,
  candidateDefaults,
  documentRef = globalThis.document,
} = {}) {
  if (!slot || typeof slot.mount !== 'function') throw new TypeError('a host action slot with mount(view) is required');
  const transport = createMeetingMinutesLineageHttpActions({
    reference,
    basePath,
    fetcher,
    token,
    actorFor,
    idFor,
    idempotencyKeyFor,
  });
  const view = createMeetingMinutesLineageView({
    root,
    load: transport.load,
    actions: transport.actions,
    candidateDefaults,
    documentRef,
  });
  slot.mount(view);
  return view;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function exactVersionReference(version, detail, documentRecord) {
  if (!version || !detail?.meeting?.meeting_id || !documentRecord?.minutes_id || !version.version_id) return null;
  const source = version.source_ref;
  if (source && text(source.provider) && text(source.locator) && text(source.revision) && text(source.digest)) {
    return {
      meetingId: detail.meeting.meeting_id,
      minutesId: documentRecord.minutes_id,
      versionId: version.version_id,
      contentDigest: source.digest,
      locator: source.locator,
      provenance: {
        providerKind: source.provider,
        providerId: source.locator,
        revision: source.revision,
        digest: source.digest,
      },
    };
  }
  return {
    meetingId: detail.meeting.meeting_id,
    minutesId: documentRecord.minutes_id,
    versionId: version.version_id,
    contentDigest: text(version.body_digest),
    locator: `${detail.meeting.meeting_id}/${documentRecord.minutes_id}/${version.version_id}`,
    provenance: {
      providerKind: 'brainbase.native',
      providerId: `${detail.meeting.meeting_id}/${documentRecord.minutes_id}`,
      revision: version.version_id,
      ...(text(version.body_digest) ? { digest: text(version.body_digest) } : {}),
    },
  };
}

/** Add the real lineage transport/view to the same selected-version action slot. */
export function createMeetingMinutesLineageExtension({
  basePath = '/api/meeting-minutes-lineage',
  fetcher,
  token,
  actorFor,
  idFor,
  idempotencyKeyFor,
  candidateDefaults = null,
} = {}) {
  return Object.freeze({
    id: 'meeting-minutes-lineage',
    mount({ root, document: documentRef, detail, documentRecord, version, request, setStatus }) {
      const reference = exactVersionReference(version, detail, documentRecord);
      if (!reference) {
        root.replaceChildren();
        const notice = documentRef.createElement('p');
        notice.className = 'bb-mml-notice';
        notice.textContent = '選択した議事録版の根拠を確認できないため、判断・Taskを操作できません。';
        root.appendChild(notice);
        return null;
      }
      let view;
      const slot = { mount(next) { view = next; } };
      connectMeetingMinutesLineageActionSlot({
        slot,
        root,
        reference,
        basePath,
        fetcher: fetcher ?? request,
        token,
        actorFor,
        idFor,
        idempotencyKeyFor,
        documentRef,
        candidateDefaults,
      });
      // `connect...` owns the view, while this extension owns the initial
      // refresh and shares the core's status line for transport failures.
      if (view) {
        const originalRefresh = view.refresh;
        view.refresh = async (...args) => {
          try {
            return await originalRefresh(...args);
          } catch (error) {
            setStatus?.(error instanceof Error ? error.message : '判断履歴を読み取れません。', 'error');
            throw error;
          }
        };
        void view.refresh();
      }
      return view;
    },
  });
}
