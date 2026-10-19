import {
  canonicalJson,
  sha256Hex
} from './judgment-resolution-contract.js';
import type {
  ConversationMessage,
  JudgmentOwnerAudit,
  JudgmentReceipt,
  JudgmentRequest
} from './judgment-host.js';

/**
 * The lifecycle core deliberately has no filesystem, environment, Graph, or
 * network dependency. Hosts provide those boundaries through the ports below.
 * A host therefore keeps ownership of the canonical journal and can adopt this
 * state machine without moving its existing persistence or authorization code.
 */

export type MaybePromise<T> = T | PromiseLike<T>;

export interface JudgmentLifecycleIdentity {
  session_ref: string;
  turn_id: string;
}

export interface JudgmentLifecycleRequestInput {
  request: string;
  turn_id: string;
  session_ref: string;
  project_code?: string;
  messages?: readonly ConversationMessage[];
  prior_receipts?: readonly Record<string, unknown>[];
  runtime?: {
    host?: string;
    model?: string | null;
    permission_mode?: string | null;
    project_binding?: string | null;
  };
  instruction_bindings?: ReadonlyArray<{ scope: string; source_ref: string; digest: string }>;
  completeness?: 'complete' | 'partial';
}

export interface JudgmentLifecycleAdoption {
  schema_version: 'brainbase-judgment-adoption-v1' | 'brainbase-judgment-adoption-v2';
  accepted_at: string;
  request_text_digest: string;
  request: JudgmentRequest;
  receipt: JudgmentReceipt;
  receipt_digest: string;
  owner_audit: JudgmentOwnerAudit;
}

export interface JudgmentLifecycleEpisode {
  schema_version: 'brainbase-judgment-episode-v1';
  session_ref: string;
  turn_id: string;
  started_at: string;
  request_text_digest: string;
  initial_receipt_digest: string;
  adoption: JudgmentLifecycleAdoption;
  audit_contract: {
    schema_version: 'brainbase-owner-audit-contract-v1';
    repair_body_policy: 'preserve';
    zero_call_display_line: string | null;
    zero_call_display_line_digest: string | null;
  };
  episode_digest: string;
}

export interface JudgmentLifecycleToolEvent {
  schema_version: 'brainbase-judgment-tool-event-v1';
  session_ref: string;
  turn_id: string;
  sequence: number;
  recorded_at: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  audit_kind: 'routing' | 'search' | 'retrieval';
  success: boolean;
  satisfies: string[];
  display_line: string;
  event_fingerprint: string;
  event_digest: string;
}

export interface JudgmentLifecycleFinalReceipt {
  schema_version: 'brainbase-judgment-final-v1';
  session_ref: string;
  turn_id: string;
  finalized_at: string;
  initial_receipt_digest: string;
  event_count: number;
  event_set_digest: string;
  answer_digest: string;
  completion_status: 'complete';
  owner_audit_complete: true;
  owner_audit_line_count: number;
  final_digest: string;
}

export interface JudgmentLifecycleBlock {
  decision: 'block';
  block_kind: 'audit_repair';
  reason: string;
}

export interface JudgmentLifecycleJournalPort {
  /** The implementation owns the turn lock, validation, and canonical writes. */
  withLock<T>(identity: JudgmentLifecycleIdentity, operation: () => MaybePromise<T>): MaybePromise<T>;
  readEpisode(identity: JudgmentLifecycleIdentity): MaybePromise<JudgmentLifecycleEpisode | null>;
  writeEpisode(episode: JudgmentLifecycleEpisode): MaybePromise<void>;
  readEvents(identity: JudgmentLifecycleIdentity): MaybePromise<readonly JudgmentLifecycleToolEvent[]>;
  appendEvent(identity: JudgmentLifecycleIdentity, event: JudgmentLifecycleToolEvent): MaybePromise<void>;
  readFinal(identity: JudgmentLifecycleIdentity): MaybePromise<JudgmentLifecycleFinalReceipt | null>;
  writeFinal(final: JudgmentLifecycleFinalReceipt): MaybePromise<void>;
}

export interface JudgmentLifecycleResolverPort {
  /** The host may bind this to the OSS local resolver or another approved resolver. */
  resolve(request: JudgmentRequest): MaybePromise<JudgmentReceipt>;
}

export interface JudgmentLifecycleKnowledgeTransportPort {
  /** Optional projection/queue boundary. It is never used to replace journal writes. */
  enqueueFinalized(input: {
    episode: JudgmentLifecycleEpisode;
    final: JudgmentLifecycleFinalReceipt;
    answer: string;
  }): MaybePromise<void>;
}

/**
 * Authorization, Graph access, and Task persistence intentionally stay outside
 * this interface. A host can perform those actions before or after a lifecycle
 * call and retain its existing tenant/authentication boundary.
 */
export interface JudgmentLifecyclePorts {
  journal: JudgmentLifecycleJournalPort;
  resolver: JudgmentLifecycleResolverPort;
  transport?: JudgmentLifecycleKnowledgeTransportPort;
}

export interface JudgmentLifecycleCore {
  start(input: {
    request: JudgmentRequest;
    accepted_at: string;
  }): Promise<JudgmentLifecycleEpisode>;
  recordToolEvent(input: {
    identity: JudgmentLifecycleIdentity;
    eligible: boolean;
    recorded_at: string;
    tool_use_id: string;
    tool_name: string;
    tool_input: unknown;
    tool_response: unknown;
    audit_kind: JudgmentLifecycleToolEvent['audit_kind'];
    success: boolean;
    satisfies: readonly string[];
    display_line: string;
  }): Promise<JudgmentLifecycleToolEvent | null>;
  finalize(input: {
    identity: JudgmentLifecycleIdentity;
    finalized_at: string;
    answer: string;
    audit: {
      complete: boolean;
      line_count: number;
      reason?: string;
    };
  }): Promise<JudgmentLifecycleFinalReceipt | JudgmentLifecycleBlock>;
}

export const ZERO_CALL_DISPLAY_LINE = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(code);
  return value.trim();
}

function normalizeMessages(messages: readonly ConversationMessage[]): Required<ConversationMessage>[] {
  return messages.flatMap((message, sequence) => {
    if (!message || !['user', 'assistant'].includes(message.role)
      || typeof message.text !== 'string' || !message.text.trim()) return [];
    return [{
      sequence,
      turn_id: typeof message.turn_id === 'string' ? message.turn_id : null,
      role: message.role,
      phase: typeof message.phase === 'string' ? message.phase : null,
      text: message.text
    }];
  });
}

/**
 * Normalizes host-provided context without discovering files, reading env, or
 * deciding which source is authoritative. Those are host responsibilities.
 */
export function normalizeJudgmentRequest(input: JudgmentLifecycleRequestInput): JudgmentRequest {
  const request = nonEmpty(input.request, 'judgment_request_missing');
  const turnId = nonEmpty(input.turn_id, 'judgment_turn_id_missing');
  const sessionRef = nonEmpty(input.session_ref, 'judgment_session_ref_missing');
  const messages = normalizeMessages(input.messages ?? []);
  const currentMessages = messages.filter((message) => !(
    message.role === 'user' && message.turn_id === turnId && message.text === request
  ));
  const trailingMessage = currentMessages.at(-1);
  if (trailingMessage?.role === 'user' && trailingMessage.turn_id === null && trailingMessage.text === request) {
    trailingMessage.turn_id = turnId;
  } else {
    currentMessages.push({
      sequence: currentMessages.length,
      turn_id: turnId,
      role: 'user',
      phase: null,
      text: request
    });
  }
  const contextWithoutDigest = {
    schema_version: 'brainbase-conversation-context-v1' as const,
    session_ref: sessionRef,
    messages: currentMessages.map((message, sequence) => ({ ...message, sequence })),
    prior_receipts: [...(input.prior_receipts ?? [])],
    runtime: {
      host: input.runtime?.host ?? 'codex',
      model: input.runtime?.model ?? null,
      permission_mode: input.runtime?.permission_mode ?? null,
      project_binding: input.runtime?.project_binding ?? null
    },
    instruction_bindings: [...(input.instruction_bindings ?? [])],
    completeness: input.completeness ?? 'partial'
  };
  return {
    request,
    turn_id: turnId,
    ...(input.project_code ? { project_code: input.project_code } : {}),
    conversation_context: {
      ...contextWithoutDigest,
      source_digest: sha256Hex(canonicalJson(contextWithoutDigest))
    }
  };
}

/** Fails closed on an unbound or tampered request before the resolver is used. */
export function assertCanonicalJudgmentRequest(request: JudgmentRequest): JudgmentRequest {
  const requestText = nonEmpty(request.request, 'judgment_request_missing');
  const turnId = nonEmpty(request.turn_id, 'judgment_turn_id_missing');
  const context = record(request.conversation_context);
  if (!context || context.schema_version !== 'brainbase-conversation-context-v1') {
    throw new TypeError('judgment_context_invalid');
  }
  const sessionRef = nonEmpty(context.session_ref, 'judgment_session_ref_missing');
  if (!Array.isArray(context.messages) || !Array.isArray(context.prior_receipts)
    || !record(context.runtime) || !Array.isArray(context.instruction_bindings)
    || !['complete', 'partial'].includes(String(context.completeness))
    || typeof context.source_digest !== 'string') {
    throw new TypeError('judgment_context_invalid');
  }
  const { source_digest: _sourceDigest, ...contextWithoutDigest } = context;
  if (sha256Hex(canonicalJson(contextWithoutDigest)) !== context.source_digest) {
    throw new Error('judgment_context_digest_mismatch');
  }
  return {
    ...request,
    request: requestText,
    turn_id: turnId,
    conversation_context: {
      ...request.conversation_context,
      session_ref: sessionRef
    }
  };
}

const OWNER_EXCERPT_LIMIT = 26;
const PRIOR_EVIDENCE_SOURCES = new Set<JudgmentReceipt['classification_evidence']['source']>([
  'prior_receipt',
  'prior_message'
]);

function sanitizeOwnerExcerpt(value: unknown): string {
  const redacted = String(value ?? '')
    .replace(/\b(token|api[_-]?key|secret|password)\s*=\s*[^\s]+/giu, '$1=[秘密情報]')
    .replace(/\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,}|AIza[a-z0-9_-]{8,})\b/giu, '[秘密情報]')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/[「」]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const points = Array.from(redacted);
  return points.length > OWNER_EXCERPT_LIMIT
    ? `${points.slice(0, OWNER_EXCERPT_LIMIT).join('')}…`
    : redacted;
}

function ownerEvidenceSource(request: JudgmentRequest, receipt: JudgmentReceipt): {
  sourceKind: JudgmentOwnerAudit['source_kind'];
  text: string;
  sourceTurnIds: string[];
} {
  const sourceTurnIds = Array.isArray(receipt.classification_evidence?.source_turn_ids)
    ? receipt.classification_evidence.source_turn_ids.filter((turnId) => typeof turnId === 'string')
    : [];
  const inherited = receipt.reconciliation_reasons?.includes('classification_inherited_from_prior_turn');
  const prior = PRIOR_EVIDENCE_SOURCES.has(receipt.classification_evidence?.source) || inherited;
  if (!prior) return { sourceKind: 'current_request', text: request.request, sourceTurnIds };
  const messages = Array.isArray(request.conversation_context?.messages)
    ? request.conversation_context.messages
    : [];
  const exact = [...messages].reverse().find((message) => (
    message.role === 'user'
    && message.turn_id !== request.turn_id
    && typeof message.turn_id === 'string'
    && sourceTurnIds.includes(message.turn_id)
  ));
  const fallback = sourceTurnIds.length === 0
    ? [...messages].reverse().find((message) => message.role === 'user' && message.turn_id !== request.turn_id)
    : undefined;
  return {
    sourceKind: exact ? 'prior_turn' : fallback ? 'prior_turn_fallback' : 'prior_turn_unavailable',
    text: exact?.text ?? fallback?.text ?? '',
    sourceTurnIds
  };
}

function ownerDecision(receipt: JudgmentReceipt): string {
  if (receipt.selected_dag_ids?.includes('knowledge.v1')) return 'Brainbase内検索が必要と判断';
  const byIntent: Partial<Record<NonNullable<JudgmentReceipt['classification']>['intent'], string>> = {
    implement: '実装依頼として継続',
    investigate: '調査として確認',
    diagnose: '原因診断として確認',
    review: 'レビューとして確認',
    design: '設計として検討',
    answer: '質問として回答',
    operate: '運用依頼として対応'
  };
  return receipt.classification?.intent
    ? byIntent[receipt.classification.intent] ?? '回答方針を確認'
    : '回答方針を確認';
}

/** Deterministically renders the owner-visible line used by the Host contract. */
export function buildJudgmentOwnerAudit(
  request: JudgmentRequest,
  receipt: JudgmentReceipt,
  { historicalExact = true }: { historicalExact?: boolean } = {}
): JudgmentOwnerAudit {
  const evidence = ownerEvidenceSource(request, receipt);
  const excerpt = sanitizeOwnerExcerpt(evidence.text);
  let decision = ownerDecision(receipt);
  let displayLine: string;
  if (receipt.status === 'needs_clarification' || receipt.selected_dag_ids.includes('clarification.v1')) {
    decision = '確認質問';
    displayLine = `⚠️ 判断参照: 「${excerpt || '現在の依頼'}」の対象を特定できず → ${decision}`;
  } else if (evidence.sourceKind === 'prior_turn_unavailable') {
    decision = '判断証跡を要確認';
    displayLine = `⚠️ 判断参照: 参照元の会話を確認できず → ${decision}`;
  } else {
    const prefix = evidence.sourceKind.startsWith('prior_turn') ? '直前の' : '';
    displayLine = `🧠 判断参照: ${prefix}「${excerpt || '現在の依頼'}」を参照 → ${decision} ✓`;
  }
  return {
    schema_version: 'brainbase-owner-audit-v1',
    renderer_version: '1',
    locale: 'ja-JP',
    historical_exact: historicalExact,
    source_receipt_digest: sha256Hex(canonicalJson(receipt)),
    source_kind: evidence.sourceKind,
    source_turn_ids: evidence.sourceTurnIds,
    source_excerpt: excerpt,
    decision,
    display_line: displayLine,
    text_digest: sha256Hex(displayLine)
  };
}

export function assertJudgmentOwnerAudit(value: unknown, receipt: JudgmentReceipt): JudgmentOwnerAudit {
  const ownerAudit = record(value) as unknown as JudgmentOwnerAudit | null;
  if (!ownerAudit || ownerAudit.schema_version !== 'brainbase-owner-audit-v1') {
    throw new Error('judgment_owner_audit_missing');
  }
  if (ownerAudit.source_receipt_digest !== sha256Hex(canonicalJson(receipt))) {
    throw new Error('judgment_owner_audit_receipt_mismatch');
  }
  if (typeof ownerAudit.display_line !== 'string' || ownerAudit.text_digest !== sha256Hex(ownerAudit.display_line)) {
    throw new Error('judgment_owner_audit_digest_mismatch');
  }
  return ownerAudit;
}

function assertReceiptForRequest(receipt: JudgmentReceipt, request: JudgmentRequest): JudgmentReceipt {
  if (!record(receipt) || receipt.turn_id !== request.turn_id) throw new Error('judgment_receipt_turn_mismatch');
  if (receipt.request_digest !== sha256Hex(canonicalJson(request))) throw new Error('judgment_receipt_request_mismatch');
  if (receipt.context_digest !== sha256Hex(canonicalJson(request.conversation_context))) {
    throw new Error('judgment_receipt_context_mismatch');
  }
  if (typeof receipt.plan_digest !== 'string' || receipt.plan_digest.length === 0) {
    throw new Error('judgment_receipt_plan_missing');
  }
  return receipt;
}

/** Pure episode/adoption projection. The port owns writing and locking. */
export function createJudgmentEpisode(input: {
  request: JudgmentRequest;
  receipt: JudgmentReceipt;
  accepted_at: string;
  owner_audit?: JudgmentOwnerAudit;
}): JudgmentLifecycleEpisode {
  const request = assertCanonicalJudgmentRequest(input.request);
  const receipt = assertReceiptForRequest(input.receipt, request);
  const acceptedAt = nonEmpty(input.accepted_at, 'judgment_adoption_time_missing');
  const ownerAudit = assertJudgmentOwnerAudit(
    input.owner_audit ?? buildJudgmentOwnerAudit(request, receipt),
    receipt
  );
  const adoption: JudgmentLifecycleAdoption = {
    schema_version: 'brainbase-judgment-adoption-v2',
    accepted_at: acceptedAt,
    request_text_digest: sha256Hex(request.request),
    request,
    receipt,
    receipt_digest: sha256Hex(canonicalJson(receipt)),
    owner_audit: ownerAudit
  };
  const initialReceiptDigest = sha256Hex(canonicalJson(receipt));
  const episodeWithoutDigest = {
    schema_version: 'brainbase-judgment-episode-v1' as const,
    session_ref: request.conversation_context.session_ref,
    turn_id: request.turn_id,
    started_at: acceptedAt,
    request_text_digest: sha256Hex(request.request),
    initial_receipt_digest: initialReceiptDigest,
    adoption,
    audit_contract: {
      schema_version: 'brainbase-owner-audit-contract-v1' as const,
      repair_body_policy: 'preserve' as const,
      zero_call_display_line: receipt.selected_dag_ids.includes('knowledge.v1') ? null : ZERO_CALL_DISPLAY_LINE,
      zero_call_display_line_digest: receipt.selected_dag_ids.includes('knowledge.v1')
        ? null
        : sha256Hex(ZERO_CALL_DISPLAY_LINE)
    }
  };
  return {
    ...episodeWithoutDigest,
    episode_digest: sha256Hex(canonicalJson(episodeWithoutDigest))
  };
}

function eventFingerprint(input: {
  tool_use_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
}): string {
  return sha256Hex(canonicalJson(input));
}

/** Pure event projection. Tool eligibility and display rendering stay Host-owned. */
export function createJudgmentToolEvent(input: {
  session_ref: string;
  turn_id: string;
  sequence: number;
  recorded_at: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  audit_kind: JudgmentLifecycleToolEvent['audit_kind'];
  success: boolean;
  satisfies: readonly string[];
  display_line: string;
}): JudgmentLifecycleToolEvent {
  const sessionRef = nonEmpty(input.session_ref, 'judgment_session_ref_missing');
  const turnId = nonEmpty(input.turn_id, 'judgment_turn_id_missing');
  const toolUseId = nonEmpty(input.tool_use_id, 'judgment_tool_use_id_missing');
  const toolName = nonEmpty(input.tool_name, 'judgment_tool_name_missing');
  const recordedAt = nonEmpty(input.recorded_at, 'judgment_tool_event_time_missing');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new TypeError('judgment_tool_event_sequence_invalid');
  if (typeof input.display_line !== 'string') throw new TypeError('judgment_tool_display_line_invalid');
  const toolInput = input.tool_input ?? null;
  const toolResponse = input.tool_response ?? null;
  const fingerprint = eventFingerprint({
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse
  });
  const eventWithoutDigest = {
    schema_version: 'brainbase-judgment-tool-event-v1' as const,
    session_ref: sessionRef,
    turn_id: turnId,
    sequence: input.sequence,
    recorded_at: recordedAt,
    tool_use_id: toolUseId,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
    audit_kind: input.audit_kind,
    success: input.success,
    satisfies: [...input.satisfies],
    display_line: input.display_line,
    event_fingerprint: fingerprint
  };
  return {
    ...eventWithoutDigest,
    event_digest: sha256Hex(canonicalJson(eventWithoutDigest))
  };
}

/** Pure final receipt projection. Callers must provide successful audit validation. */
export function createJudgmentFinalReceipt(input: {
  episode: JudgmentLifecycleEpisode;
  events: readonly JudgmentLifecycleToolEvent[];
  finalized_at: string;
  answer: string;
  owner_audit_line_count: number;
}): JudgmentLifecycleFinalReceipt {
  if (!Number.isSafeInteger(input.owner_audit_line_count) || input.owner_audit_line_count < 1) {
    throw new TypeError('judgment_owner_audit_line_count_invalid');
  }
  const finalizedAt = nonEmpty(input.finalized_at, 'judgment_finalized_time_missing');
  const eventSetDigest = sha256Hex(canonicalJson(input.events));
  const finalWithoutDigest = {
    schema_version: 'brainbase-judgment-final-v1' as const,
    session_ref: input.episode.session_ref,
    turn_id: input.episode.turn_id,
    finalized_at: finalizedAt,
    initial_receipt_digest: input.episode.initial_receipt_digest,
    event_count: input.events.length,
    event_set_digest: eventSetDigest,
    answer_digest: sha256Hex(input.answer),
    completion_status: 'complete' as const,
    owner_audit_complete: true as const,
    owner_audit_line_count: input.owner_audit_line_count
  };
  return {
    ...finalWithoutDigest,
    final_digest: sha256Hex(canonicalJson(finalWithoutDigest))
  };
}

function assertIdentity(episode: JudgmentLifecycleEpisode, identity: JudgmentLifecycleIdentity): void {
  if (episode.session_ref !== identity.session_ref || episode.turn_id !== identity.turn_id) {
    throw new Error('judgment_episode_binding_mismatch');
  }
}

function assertEventIdentity(event: JudgmentLifecycleToolEvent, identity: JudgmentLifecycleIdentity): void {
  if (event.session_ref !== identity.session_ref || event.turn_id !== identity.turn_id) {
    throw new Error('judgment_tool_event_binding_mismatch');
  }
}

function finalMatches(
  final: JudgmentLifecycleFinalReceipt,
  episode: JudgmentLifecycleEpisode,
  events: readonly JudgmentLifecycleToolEvent[],
  answer: string
): boolean {
  return final.session_ref === episode.session_ref
    && final.turn_id === episode.turn_id
    && final.initial_receipt_digest === episode.initial_receipt_digest
    && final.event_count === events.length
    && final.event_set_digest === sha256Hex(canonicalJson(events))
    && final.answer_digest === sha256Hex(answer);
}

function eventInputFingerprint(input: {
  tool_use_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
}): string {
  return eventFingerprint({
    tool_use_id: nonEmpty(input.tool_use_id, 'judgment_tool_use_id_missing'),
    tool_name: nonEmpty(input.tool_name, 'judgment_tool_name_missing'),
    tool_input: input.tool_input ?? null,
    tool_response: input.tool_response ?? null
  });
}

export function createJudgmentLifecycleCore(ports: JudgmentLifecyclePorts): JudgmentLifecycleCore {
  return {
    async start(input) {
      const request = assertCanonicalJudgmentRequest(input.request);
      const identity = {
        session_ref: request.conversation_context.session_ref,
        turn_id: request.turn_id
      };
      return ports.journal.withLock(identity, async () => {
        const existing = await ports.journal.readEpisode(identity);
        if (existing) {
          assertIdentity(existing, identity);
          const existingRequest = assertCanonicalJudgmentRequest(existing.adoption.request);
          const existingReceipt = assertReceiptForRequest(existing.adoption.receipt, existingRequest);
          if (sha256Hex(canonicalJson(existingRequest)) !== sha256Hex(canonicalJson(request))) {
            throw new Error('judgment_episode_request_conflict');
          }
          if (existing.request_text_digest !== sha256Hex(existingRequest.request)
            || existing.initial_receipt_digest !== sha256Hex(canonicalJson(existingReceipt))) {
            throw new Error('judgment_episode_binding_mismatch');
          }
          return existing;
        }
        const receipt = assertReceiptForRequest(await ports.resolver.resolve(request), request);
        const episode = createJudgmentEpisode({
          request,
          receipt,
          accepted_at: input.accepted_at
        });
        await ports.journal.writeEpisode(episode);
        return episode;
      });
    },

    async recordToolEvent(input) {
      const identity = input.identity;
      if (!input.eligible) return null;
      return ports.journal.withLock(identity, async () => {
        const episode = await ports.journal.readEpisode(identity);
        if (!episode) throw new Error('judgment_orphan_post_tool_use');
        assertIdentity(episode, identity);
        const existingFinal = await ports.journal.readFinal(identity);
        if (existingFinal) throw new Error('judgment_episode_already_finalized');
        const events = [...await ports.journal.readEvents(identity)];
        const fingerprint = eventInputFingerprint(input);
        const replay = events.find((event) => event.tool_use_id === input.tool_use_id);
        if (replay) {
          assertEventIdentity(replay, identity);
          if (replay.event_fingerprint !== fingerprint) throw new Error('judgment_tool_event_conflict');
          return replay;
        }
        const event = createJudgmentToolEvent({
          session_ref: identity.session_ref,
          turn_id: identity.turn_id,
          sequence: events.length + 1,
          recorded_at: input.recorded_at,
          tool_use_id: input.tool_use_id,
          tool_name: input.tool_name,
          tool_input: input.tool_input,
          tool_response: input.tool_response,
          audit_kind: input.audit_kind,
          success: input.success,
          satisfies: input.satisfies,
          display_line: input.display_line
        });
        await ports.journal.appendEvent(identity, event);
        return event;
      });
    },

    async finalize(input) {
      const identity = input.identity;
      return ports.journal.withLock(identity, async () => {
        const episode = await ports.journal.readEpisode(identity);
        if (!episode) throw new Error('judgment_orphan_stop');
        assertIdentity(episode, identity);
        const events = [...await ports.journal.readEvents(identity)];
        events.forEach((event) => assertEventIdentity(event, identity));
        const existing = await ports.journal.readFinal(identity);
        if (existing) {
          if (!finalMatches(existing, episode, events, input.answer)) throw new Error('judgment_final_conflict');
          if (ports.transport) {
            await ports.transport.enqueueFinalized({ episode, final: existing, answer: input.answer });
          }
          return existing;
        }
        if (!input.audit.complete) {
          return {
            decision: 'block',
            block_kind: 'audit_repair',
            reason: input.audit.reason
              ?? 'Brainbase judgment episodeを完了する前に監査行と回答本文を確認してください。'
          };
        }
        const final = createJudgmentFinalReceipt({
          episode,
          events,
          finalized_at: input.finalized_at,
          answer: input.answer,
          owner_audit_line_count: input.audit.line_count
        });
        await ports.journal.writeFinal(final);
        if (ports.transport) {
          await ports.transport.enqueueFinalized({ episode, final, answer: input.answer });
        }
        return final;
      });
    }
  };
}
