import { describe, expect, it } from 'vitest';

import {
  KnowledgePromotionError,
  KnowledgePromotionService,
  normalizePromotionPayload,
  organizationReviewReceipt,
  ownerConsentReceipt,
  type KnowledgePromotionPrincipal,
  type KnowledgePromotionRequest,
  type PromotionReviewPolicy,
} from '../src/knowledge-promotion.js';

const DECISION_PAYLOAD = {
  schema_version: 'personal_knowledge_normalized.v1',
  kind: 'decision',
  entity: { id: 'decision.pricing-2026', type: 'decision', payload: { statement: '2026年度の価格は据え置く' } },
  decision_domain: 'pricing',
  sensitivity: 'internal',
  role_min: 'member',
};

const ENTITY_PAYLOAD = {
  schema_version: 'personal_knowledge_normalized.v1',
  kind: 'entity',
  entity: { id: 'observation.onboarding-delay', type: 'observation', payload: { label: '導入の初週に設定で詰まる顧客が多い' } },
};

const OWNER: KnowledgePromotionPrincipal = {
  personId: 'per_owner', organizationId: 'org_unson', projectCodes: ['brainbase'], role: 'member', principalType: 'person',
};
const GM: KnowledgePromotionPrincipal = {
  personId: 'per_gm', organizationId: 'org_unson', projectCodes: ['brainbase'], role: 'gm', principalType: 'person',
};
const OTHER_ORG_GM: KnowledgePromotionPrincipal = { ...GM, personId: 'per_other', organizationId: 'org_other' };
const ROUTINE: KnowledgePromotionPrincipal = { ...GM, personId: 'svc_routine', principalType: 'service' };

type Clock = { value: string };

function harness({
  policy = allowAll(),
  personalEvents = [{ event_id: 'pfe_1', owner_person_id: 'per_owner', organization_id: 'org_unson', body_hash: 'sha256:body1', version: 'v1', active: true }],
  candidates = [{ candidate_id: 'cand_1', organization_id: 'org_unson', project_code: 'brainbase', version: 'c1', active: true, evidence_hash: 'sha256:cand1', source_event_ids: ['kev_meeting_1'] }],
  withPolicy = true,
  withOutcome = true,
}: {
  policy?: PromotionReviewPolicy;
  personalEvents?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  withPolicy?: boolean;
  withOutcome?: boolean;
} = {}) {
  const requests = new Map<string, KnowledgePromotionRequest>();
  const lineage: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const graph: Array<Record<string, unknown>> = [];
  const outcomes: Array<Record<string, unknown>> = [];
  const authorityUses = new Set<string>();
  const policyCalls: Array<Record<string, unknown>> = [];
  const txLog: unknown[] = [];
  const personal = new Map(personalEvents.map((event) => [event.event_id as string, { ...event }]));
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidate_id as string, { ...candidate }]));
  const clock: Clock = { value: '2026-10-01T00:00:00.000Z' };

  const store = {
    async transaction<T>(work: (tx: unknown) => Promise<T>) {
      // Snapshot every side-effect so a thrown error rolls back like a DB transaction.
      const snapshot = {
        requests: new Map([...requests].map(([key, value]) => [key, structuredClone(value)])),
        lineage: lineage.length, events: events.length, graph: graph.length, outcomes: outcomes.length,
        uses: new Set(authorityUses),
      };
      const tx = { id: txLog.length + 1 };
      txLog.push(tx);
      try {
        return await work(tx);
      } catch (error) {
        requests.clear();
        for (const [key, value] of snapshot.requests) requests.set(key, value);
        lineage.length = snapshot.lineage;
        events.length = snapshot.events;
        graph.length = snapshot.graph;
        outcomes.length = snapshot.outcomes;
        authorityUses.clear();
        for (const use of snapshot.uses) authorityUses.add(use);
        throw error;
      }
    },
    async createRequest(request: KnowledgePromotionRequest) {
      const existing = requests.get(request.request_id);
      if (existing) return structuredClone(existing);
      requests.set(request.request_id, structuredClone(request));
      return structuredClone(request);
    },
    async findRequest(requestId: string) {
      const found = requests.get(requestId);
      return found ? structuredClone(found) : null;
    },
    async updateRequest(requestId: string, patch: Partial<KnowledgePromotionRequest>, { expectedRevision }: { expectedRevision: number }) {
      const current = requests.get(requestId);
      if (!current || current.revision !== expectedRevision) return null;
      const next = { ...current, ...patch, revision: current.revision + 1 };
      requests.set(requestId, next);
      return structuredClone(next);
    },
    async createLineage(entry: Record<string, unknown>) {
      lineage.push(structuredClone(entry));
    },
    async claimAuthorityUse(use: { operation_id: string; idempotency_key: string }) {
      const key = `${use.operation_id}:${use.idempotency_key}`;
      if (authorityUses.has(key)) throw new KnowledgePromotionError('knowledge_promotion_authority_replayed', 409);
      authorityUses.add(key);
    },
  };
  const sources = {
    async readPersonalKnowledgeEvent(eventId: string) {
      return personal.get(eventId) ?? null;
    },
    async readOrganizationCandidate(candidateId: string) {
      return candidateMap.get(candidateId) ?? null;
    },
    ...(withOutcome ? {
      async recordOrganizationCandidateOutcome(outcome: Record<string, unknown>) {
        outcomes.push(structuredClone(outcome));
      },
    } : {}),
  };
  const knowledgeEvents = {
    async recordOrganizationEvent(event: Record<string, unknown>) {
      events.push(structuredClone(event));
      return { event_id: event.event_id as string, candidate_id: `mc_${events.length}`, semantic_state: 'active' };
    },
  };
  const graphPort = {
    async commitNormalizedPromotion(mutation: Record<string, unknown>) {
      graph.push(structuredClone(mutation));
      return { id: (mutation.entity as { id: string }).id };
    },
  };
  const recordingPolicy: PromotionReviewPolicy = {
    async authorize(input, ctx) {
      policyCalls.push({ action: input.action, approvalKind: input.approvalKind, personId: input.principal.personId });
      return policy.authorize(input, ctx);
    },
  };
  const service = new KnowledgePromotionService({
    store,
    sources,
    reviewPolicy: withPolicy ? recordingPolicy : null,
    knowledgeEvents,
    graph: graphPort,
    now: () => new Date(clock.value),
  });
  return { service, requests, lineage, events, graph, outcomes, policyCalls, personal, candidateMap, clock, txLog };
}

function allowAll(): PromotionReviewPolicy {
  return { async authorize() { return { allowed: true }; } };
}

function denyReview(): PromotionReviewPolicy {
  return {
    async authorize(input) {
      return input.action === 'organization_review'
        ? { allowed: false, code: 'organization_reviewer_required', status: 403 }
        : { allowed: true };
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(KnowledgePromotionError);
  expect((error as KnowledgePromotionError).code).toBe(code);
  if (status !== undefined) expect((error as KnowledgePromotionError).status).toBe(status);
}

async function sharedAndConsented(h: ReturnType<typeof harness>) {
  const requested = await h.service.requestPersonalShare({
    personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '価格は据え置く方針', normalized_payload: DECISION_PAYLOAD,
  }, { principal: OWNER });
  const consented = await h.service.decideOwnerConsent(requested.request_id, {
    decision: 'approve', normalized_payload_hash: requested.normalized_payload_hash, expected_revision: requested.revision,
  }, { principal: OWNER });
  return { requested, consented };
}

describe('共通昇格処理：個人共有（本人承認→組織レビュー）', () => {
  it('S-1 本人の申請と本人承認の後、別人の承認でだけ知識イベント・Graph・系譜を同じトランザクションで一度書く', async () => {
    const h = harness();
    const { requested, consented } = await sharedAndConsented(h);
    expect(requested.status).toBe('pending_owner_approval');
    expect(requested.approval_kind).toBe('personal_share');
    expect(requested.source).toEqual({ kind: 'personal_knowledge_v1', id: 'pfe_1', version: 'v1', evidence_hash: 'sha256:body1' });
    expect(JSON.stringify(requested)).not.toContain('body1-raw');
    expect(consented.status).toBe('pending_org_review');
    expect(consented.owner_consent_receipt_id).toMatch(/^pkoc_[a-f0-9]{24}$/u);
    expect(h.graph).toHaveLength(0);

    h.clock.value = '2026-10-01T01:00:00.000Z';
    const accepted = await h.service.reviewOrganization(consented.request_id, {
      decision: 'approve', expected_revision: consented.revision,
    }, { principal: GM });

    expect(accepted.status).toBe('org_accepted');
    expect(accepted.graph_entity_id).toBe('decision.pricing-2026');
    expect(h.events).toHaveLength(1);
    expect(h.graph).toHaveLength(1);
    expect(h.lineage).toHaveLength(1);
    const event = h.events[0] as { source: { type: string }; permission_snapshot: Record<string, unknown>; payload: Record<string, unknown> };
    expect(event.source.type).toBe('personal_knowledge_promotion');
    expect(event.permission_snapshot).toMatchObject({ owner_consented: true, organization_reviewed: true, approval_kind: 'personal_share' });
    // 原文も本人が書いた要約も組織側へ渡さない。
    for (const written of [h.events[0], h.graph[0], h.lineage[0]]) {
      expect(JSON.stringify(written)).not.toContain('価格は据え置く方針');
    }
    expect(h.lineage[0]).toMatchObject({
      approval_kind: 'personal_share',
      promotion_request_id: consented.request_id,
      source: { kind: 'personal_knowledge_v1', id: 'pfe_1', version: 'v1', evidence_hash: 'sha256:body1' },
      owner_person_id: 'per_owner',
      organization_id: 'org_unson',
      project_code: 'brainbase',
      graph_entity_id: 'decision.pricing-2026',
      receipts: { owner_consent_receipt_id: consented.owner_consent_receipt_id, organization_review_receipt_id: accepted.organization_review_receipt_id },
      sanitization: { raw_copied: false, personal_body_copied: false, sanitized_preview_copied: false },
    });
    expect(h.policyCalls.map((call) => call.action)).toEqual(['request', 'owner_consent', 'organization_review']);
  });

  it('S-2 本人承認の前の組織レビューは止まり、何も書かない', async () => {
    const h = harness();
    const requested = await h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '価格は据え置く方針', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER });
    await expectCode(h.service.reviewOrganization(requested.request_id, { decision: 'approve', expected_revision: requested.revision }, { principal: GM }),
      'knowledge_promotion_owner_consent_required', 409);
    expect(h.graph).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('本人以外は本人承認できず、ハッシュが申請と違う本人承認も受け付けない', async () => {
    const h = harness();
    const requested = await h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '価格は据え置く方針', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER });
    await expectCode(h.service.decideOwnerConsent(requested.request_id, {
      decision: 'approve', normalized_payload_hash: requested.normalized_payload_hash, expected_revision: 0,
    }, { principal: GM }), 'knowledge_promotion_request_not_found', 404);
    await expectCode(h.service.decideOwnerConsent(requested.request_id, {
      decision: 'approve', normalized_payload_hash: `sha256:${'0'.repeat(64)}`, expected_revision: 0,
    }, { principal: OWNER }), 'knowledge_promotion_normalized_payload_hash_mismatch', 409);
    expect(h.requests.get(requested.request_id)?.status).toBe('pending_owner_approval');
  });

  it('S-3 本人の却下は終わりで、その後の組織レビューは拒否される', async () => {
    const h = harness();
    const requested = await h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '価格は据え置く方針', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER });
    const rejected = await h.service.decideOwnerConsent(requested.request_id, { decision: 'reject', expected_revision: 0 }, { principal: OWNER });
    expect(rejected.status).toBe('owner_rejected');
    await expectCode(h.service.reviewOrganization(requested.request_id, { decision: 'approve', expected_revision: rejected.revision }, { principal: GM }),
      'knowledge_promotion_owner_consent_required', 409);
    expect(h.graph).toHaveLength(0);
  });

  it('S-3 組織の却下は終わりで、Graphにも系譜にも書かず、後から承認できない', async () => {
    const h = harness();
    const { consented } = await sharedAndConsented(h);
    const rejected = await h.service.reviewOrganization(consented.request_id, {
      decision: 'reject', reason: '既存の決定と重複', expected_revision: consented.revision,
    }, { principal: GM });
    expect(rejected.status).toBe('org_rejected');
    expect(rejected.decisions.at(-1)).toMatchObject({ action: 'organization_review', decision: 'reject', actor_person_id: 'per_gm', reason: '既存の決定と重複' });
    await expectCode(h.service.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: rejected.revision }, { principal: GM }),
      'knowledge_promotion_already_decided', 409);
    expect(h.graph).toHaveLength(0);
    expect(h.events).toHaveLength(0);
    expect(h.lineage).toHaveLength(0);
  });

  it('S-4 他人・別組織のイベントと、秘密やメールアドレスを含む申請は受け付けない', async () => {
    const h = harness({ personalEvents: [
      { event_id: 'pfe_1', owner_person_id: 'per_owner', organization_id: 'org_unson', body_hash: 'sha256:b', version: 'v1', active: true },
      { event_id: 'pfe_other', owner_person_id: 'per_someone', organization_id: 'org_unson', body_hash: 'sha256:c', version: 'v1', active: true },
    ] });
    await expectCode(h.service.requestPersonalShare({
      personal_event_id: 'pfe_other', project_code: 'brainbase', summary: '要約', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER }), 'knowledge_promotion_source_not_found', 404);
    await expectCode(h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '要約', normalized_payload: DECISION_PAYLOAD,
    }, { principal: { ...OWNER, organizationId: 'org_other' } }), 'knowledge_promotion_source_not_found', 404);
    await expectCode(h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: 'owner@example.com に確認済み', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER }), 'knowledge_promotion_requires_safe_preview', 400);
    await expectCode(h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '要約',
      normalized_payload: { ...ENTITY_PAYLOAD, entity: { ...ENTITY_PAYLOAD.entity, payload: { label: 'x', transcript: '会話の全文' } } },
    }, { principal: OWNER }), 'personal_knowledge_normalized_payload_forbidden_field', 400);
    await expectCode(h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'salestailor', summary: '要約', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER }), 'knowledge_promotion_project_access_denied', 403);
    expect(h.requests.size).toBe(0);
  });

  it('S-5 審査規則の拒否・未設定、サービス主体、本人と同じ人の組織レビューはGraphへ書かない', async () => {
    const denied = harness({ policy: denyReview() });
    const { consented } = await sharedAndConsented(denied);
    await expectCode(denied.service.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: consented.revision }, { principal: GM }),
      'organization_reviewer_required', 403);
    expect(denied.graph).toHaveLength(0);
    expect(denied.requests.get(consented.request_id)?.status).toBe('pending_org_review');

    const self = harness();
    const selfFlow = await sharedAndConsented(self);
    await expectCode(self.service.reviewOrganization(selfFlow.consented.request_id, {
      decision: 'approve', expected_revision: selfFlow.consented.revision,
    }, { principal: { ...OWNER, role: 'ceo' } }), 'knowledge_promotion_distinct_reviewer_required', 403);

    const automated = harness();
    const autoFlow = await sharedAndConsented(automated);
    await expectCode(automated.service.reviewOrganization(autoFlow.consented.request_id, {
      decision: 'approve', expected_revision: autoFlow.consented.revision,
    }, { principal: ROUTINE }), 'knowledge_promotion_human_principal_required', 403);

    await expectCode(automated.service.reviewOrganization(autoFlow.consented.request_id, {
      decision: 'approve', expected_revision: autoFlow.consented.revision,
    }, { principal: OTHER_ORG_GM }), 'knowledge_promotion_request_not_found', 404);

    const unset = harness({ withPolicy: false });
    await expectCode(unset.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '要約', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER }), 'knowledge_promotion_review_policy_unavailable', 503);
    for (const h of [self, automated, unset]) expect(h.graph).toHaveLength(0);
  });

  it('S-7 承認の直前に元の記憶が撤回・更新されていれば古い版として止め、Graphへ書かない', async () => {
    const h = harness();
    const { consented } = await sharedAndConsented(h);
    h.personal.set('pfe_1', { ...h.personal.get('pfe_1'), version: 'v2' });
    await expectCode(h.service.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: consented.revision }, { principal: GM }),
      'knowledge_promotion_source_stale', 409);
    expect(h.requests.get(consented.request_id)?.status).toBe('source_stale');
    expect(h.graph).toHaveLength(0);

    const retracted = harness();
    const flow = await sharedAndConsented(retracted);
    retracted.personal.set('pfe_1', { ...retracted.personal.get('pfe_1'), active: false });
    await expectCode(retracted.service.reviewOrganization(flow.consented.request_id, { decision: 'approve', expected_revision: flow.consented.revision }, { principal: GM }),
      'knowledge_promotion_source_stale', 409);
    expect(retracted.graph).toHaveLength(0);
  });

  it('S-8 同じ申請・同じ判断の再試行は一度しか書かず、古い版の判断は409で止める', async () => {
    const h = harness();
    const { requested, consented } = await sharedAndConsented(h);
    const again = await h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '価格は据え置く方針', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER });
    expect(again.request_id).toBe(requested.request_id);
    expect(again.status).toBe('pending_org_review');

    await expectCode(h.service.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: 0 }, { principal: GM }),
      'knowledge_promotion_stale_revision', 409);
    const accepted = await h.service.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: consented.revision }, { principal: GM });
    const replay = await h.service.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: consented.revision }, { principal: GM });
    expect(replay.status).toBe('org_accepted');
    expect(replay.graph_entity_id).toBe(accepted.graph_entity_id);
    expect(h.graph).toHaveLength(1);
    expect(h.events).toHaveLength(1);
    expect(h.lineage).toHaveLength(1);
  });

  it('署名つき権限は一度しか使えない', async () => {
    const h = harness();
    const authority = { operationId: 'op-1', idempotencyKey: 'idem-1' };
    await h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '要約', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER, authority });
    await expectCode(h.service.requestPersonalShare({
      personal_event_id: 'pfe_1', project_code: 'brainbase', summary: '要約', normalized_payload: DECISION_PAYLOAD,
    }, { principal: OWNER, authority }), 'knowledge_promotion_authority_replayed', 409);
  });

  it('Graphへの書込みが失敗したら、知識イベント・系譜・状態の更新も残さない', async () => {
    const h = harness();
    const { consented } = await sharedAndConsented(h);
    const failing = new KnowledgePromotionService({
      ...(h.service as unknown as { ports: ConstructorParameters<typeof KnowledgePromotionService>[0] }).ports,
      graph: { async commitNormalizedPromotion() { throw new Error('graph down'); } },
    });
    await expect(failing.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: consented.revision }, { principal: GM }))
      .rejects.toThrow('graph down');
    expect(h.requests.get(consented.request_id)?.status).toBe('pending_org_review');
    expect(h.events).toHaveLength(0);
    expect(h.lineage).toHaveLength(0);
  });

  it('知識イベントが隔離されたらGraphへ書かない', async () => {
    const h = harness();
    const { consented } = await sharedAndConsented(h);
    const quarantining = new KnowledgePromotionService({
      ...(h.service as unknown as { ports: ConstructorParameters<typeof KnowledgePromotionService>[0] }).ports,
      knowledgeEvents: { async recordOrganizationEvent(event) { return { event_id: event.event_id, semantic_state: 'quarantined', quarantine_reason: 'decision_authority_unverified' }; } },
    });
    await expectCode(quarantining.reviewOrganization(consented.request_id, { decision: 'approve', expected_revision: consented.revision }, { principal: GM }),
      'knowledge_promotion_event_quarantined', 409);
    expect(h.graph).toHaveLength(0);
  });
});

describe('共通昇格処理：組織候補（組織内承認）', () => {
  it('S-6 候補の申請と組織内承認でGraphへ入り、元の候補へ結果を記録する。本人承認の形は取らない', async () => {
    const h = harness();
    const requested = await h.service.requestOrganizationCandidate({
      candidate_id: 'cand_1', project_code: 'brainbase', normalized_payload: ENTITY_PAYLOAD,
    }, { principal: GM });
    expect(requested.approval_kind).toBe('organization_candidate');
    expect(requested.status).toBe('pending_org_review');
    expect(requested.owner_person_id).toBeNull();

    await expectCode(h.service.decideOwnerConsent(requested.request_id, {
      decision: 'approve', normalized_payload_hash: requested.normalized_payload_hash, expected_revision: requested.revision,
    }, { principal: GM }), 'knowledge_promotion_owner_consent_not_applicable', 409);

    const accepted = await h.service.reviewOrganization(requested.request_id, {
      decision: 'approve', expected_revision: requested.revision,
    }, { principal: GM });
    expect(accepted.status).toBe('org_accepted');
    expect(accepted.organization_review_receipt_id).toMatch(/^pkca_[a-f0-9]{24}$/u);
    expect(accepted.owner_consent_receipt_id).toBeNull();
    const event = h.events[0] as { source: { type: string }; permission_snapshot: Record<string, unknown>; decision_authority: Record<string, unknown> };
    expect(event.source.type).toBe('organization_candidate_promotion');
    expect(event.permission_snapshot.owner_consented).toBeUndefined();
    expect(event.permission_snapshot).toMatchObject({ approval_kind: 'organization_candidate', organization_reviewed: true });
    expect(event.decision_authority).toMatchObject({ authorized: true, decider_id: 'per_gm' });
    expect(h.outcomes).toEqual([expect.objectContaining({
      candidate_id: 'cand_1', outcome: 'promoted', graph_entity_id: 'observation.onboarding-delay', request_id: requested.request_id, actor_person_id: 'per_gm',
    })]);
    expect(h.lineage[0]).toMatchObject({
      approval_kind: 'organization_candidate',
      source: { kind: 'organization_candidate', id: 'cand_1', version: 'c1', evidence_hash: 'sha256:cand1' },
      owner_person_id: null,
      receipts: { owner_consent_receipt_id: null, organization_review_receipt_id: accepted.organization_review_receipt_id },
      source_event_ids: ['kev_meeting_1'],
    });
  });

  it('判断の候補は、承認者を決定権者として知識イベントに残す', async () => {
    const h = harness();
    const requested = await h.service.requestOrganizationCandidate({
      candidate_id: 'cand_1', project_code: 'brainbase', normalized_payload: DECISION_PAYLOAD,
    }, { principal: GM });
    await h.service.reviewOrganization(requested.request_id, { decision: 'approve', expected_revision: requested.revision }, { principal: GM });
    expect(h.events[0]).toMatchObject({ decision_authority: { authorized: true, decider_id: 'per_gm', domain: 'pricing' } });
  });

  it('組織内の却下は元の候補へ却下を記録し、Graphへ書かない', async () => {
    const h = harness();
    const requested = await h.service.requestOrganizationCandidate({
      candidate_id: 'cand_1', project_code: 'brainbase', normalized_payload: ENTITY_PAYLOAD,
    }, { principal: GM });
    const rejected = await h.service.reviewOrganization(requested.request_id, { decision: 'reject', expected_revision: requested.revision }, { principal: GM });
    expect(rejected.status).toBe('org_rejected');
    expect(h.outcomes).toEqual([expect.objectContaining({ candidate_id: 'cand_1', outcome: 'rejected' })]);
    expect(h.graph).toHaveLength(0);
  });

  it('昇格レビュー待ちでない候補、別組織・別プロジェクトの候補、サービス主体の申請は受け付けない', async () => {
    const h = harness({ candidates: [
      { candidate_id: 'cand_1', organization_id: 'org_unson', project_code: 'brainbase', version: 'c1', active: true, evidence_hash: 'sha256:a', source_event_ids: [] },
      { candidate_id: 'cand_rejected', organization_id: 'org_unson', project_code: 'brainbase', version: 'c1', active: false, evidence_hash: 'sha256:b', source_event_ids: [] },
      { candidate_id: 'cand_other_org', organization_id: 'org_other', project_code: 'brainbase', version: 'c1', active: true, evidence_hash: 'sha256:c', source_event_ids: [] },
    ] });
    await expectCode(h.service.requestOrganizationCandidate({ candidate_id: 'cand_rejected', project_code: 'brainbase', normalized_payload: ENTITY_PAYLOAD }, { principal: GM }),
      'knowledge_promotion_source_not_promotable', 409);
    await expectCode(h.service.requestOrganizationCandidate({ candidate_id: 'cand_other_org', project_code: 'brainbase', normalized_payload: ENTITY_PAYLOAD }, { principal: GM }),
      'knowledge_promotion_source_not_found', 404);
    await expectCode(h.service.requestOrganizationCandidate({ candidate_id: 'cand_1', project_code: 'salestailor', normalized_payload: ENTITY_PAYLOAD }, { principal: { ...GM, projectCodes: ['brainbase', 'salestailor'] } }),
      'knowledge_promotion_source_scope_mismatch', 403);
    await expectCode(h.service.requestOrganizationCandidate({ candidate_id: 'cand_1', project_code: 'brainbase', normalized_payload: ENTITY_PAYLOAD }, { principal: ROUTINE }),
      'knowledge_promotion_human_principal_required', 403);
    expect(h.requests.size).toBe(0);
  });

  it('元の候補へ結果を記録する口が無ければ、申請の段階で止める', async () => {
    const h = harness({ withOutcome: false });
    await expectCode(h.service.requestOrganizationCandidate({ candidate_id: 'cand_1', project_code: 'brainbase', normalized_payload: ENTITY_PAYLOAD }, { principal: GM }),
      'knowledge_promotion_candidate_outcome_unavailable', 503);
  });
});

describe('共通昇格処理：正規化と受領記録', () => {
  it('S-9 個人共有の受領記録は、既存の二段階昇格と同じ値になる', () => {
    const normalized = normalizePromotionPayload(DECISION_PAYLOAD);
    // brainbase-unson origin/develop a8cc6a0bf の personal-knowledge-normalization.js で計算した値。
    expect(normalized.normalized_payload_hash).toBe('sha256:abde0876ac3ecd5d62d2d9534d434eb03ed6433d54de3229b7077b6368a92f11');
    const request = {
      request_id: 'kpr_fixture', owner_person_id: 'per_owner', owner_decided_by: 'per_owner', owner_decided_at: '2026-10-01T00:00:00.000Z',
      normalized_payload_hash: normalized.normalized_payload_hash,
    };
    expect(ownerConsentReceipt(request)).toBe('pkoc_8d3dca5d1071dd342768a45f');
    expect(organizationReviewReceipt(request, normalized.normalized_payload_hash, 'per_gm', '2026-10-01T01:00:00.000Z'))
      .toBe('pkor_885e62a85525db8944423fd5');
  });
});
