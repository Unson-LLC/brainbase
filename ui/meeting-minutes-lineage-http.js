import { createMeetingMinutesLineageView } from './meeting-minutes-lineage.js';

/** Browser-side transport and host action-slot bridge for the lineage screen. */
export const MEETING_MINUTES_LINEAGE_HTTP_UI_CONTRACT_VERSION = 'brainbase.meeting-minutes-lineage-http-ui.v1';

export function createMeetingMinutesLineageHttpActions({
  reference,
  basePath = '/api/meeting-minutes-lineage',
  fetcher = globalThis.fetch,
  actorFor,
  idFor,
  idempotencyKeyFor,
} = {}) {
  if (!reference || typeof reference !== 'object') throw new TypeError('reference is required');
  if (typeof fetcher !== 'function') throw new TypeError('fetcher is required');
  if (typeof actorFor !== 'function' || typeof idFor !== 'function' || typeof idempotencyKeyFor !== 'function') {
    throw new TypeError('actorFor, idFor, and idempotencyKeyFor are required');
  }
  const prefix = String(basePath).replace(/\/+$/u, '');
  const requestJson = async (path, body) => {
    const response = await fetcher(`${prefix}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
    id: idFor({ candidate, action }),
    idempotencyKey: idempotencyKeyFor({ candidate, action }),
    actor: actorFor({ candidate, action }),
    ...extra,
  });
  return {
    load: () => requestJson('/by-version', { reference }),
    actions: {
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
  actorFor,
  idFor,
  idempotencyKeyFor,
  documentRef = globalThis.document,
} = {}) {
  if (!slot || typeof slot.mount !== 'function') throw new TypeError('a host action slot with mount(view) is required');
  const transport = createMeetingMinutesLineageHttpActions({
    reference,
    basePath,
    fetcher,
    actorFor,
    idFor,
    idempotencyKeyFor,
  });
  const view = createMeetingMinutesLineageView({
    root,
    load: transport.load,
    actions: transport.actions,
    documentRef,
  });
  slot.mount(view);
  return view;
}

