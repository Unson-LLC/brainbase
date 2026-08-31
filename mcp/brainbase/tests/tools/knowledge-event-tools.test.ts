import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalKnowledgeEventJson,
  handleKnowledgeEventToolCall,
  knowledgeEventSha256,
  knowledgeEventTools,
  validateVibeProKnowledgeEvent,
  type KnowledgeEventToolDependencies,
  type VibeProKnowledgeEvent,
} from '../../src/tools/knowledge-event-tools.js';

const HEAD_SHA = 'a'.repeat(40);
const STORY_ID = 'story-vibepro-runtime-handoff';
const PROJECT_CODE = 'vibepro';
const ORGANIZATION_ID = 'org_unson';
const SOURCE_REF = `github://Unson-LLC/vibepro@${HEAD_SHA}#${STORY_ID}`;
const SUBJECT_ID = `vibepro:${STORY_ID}:${HEAD_SHA}`;
const PARENT_EPISODE_ID = 'jep_vibepro_runtime_handoff_001';

type FetchCall = { input: string | URL | Request; init?: RequestInit };
type TestDependencies = KnowledgeEventToolDependencies & {
  calls: FetchCall[];
  tokenReads: () => number;
  token: string;
};

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function serviceToken(claims: Record<string, unknown> = {}): string {
  return `bbsvc_${encodeJwtPart({ alg: 'none', typ: 'JWT' })}.${encodeJwtPart({
    sub: 'svc_vibepro',
    projectCodes: [PROJECT_CODE],
    organizationId: ORGANIZATION_ID,
    ...claims,
  })}.signature`;
}

function buildEvent(summary = 'A computed verification showed that exact Git-state binding prevents stale implementation learning.'): VibeProKnowledgeEvent {
  const payload: VibeProKnowledgeEvent['payload'] = {
    schema_version: 'vibepro-development-learning.v1',
    story_id: STORY_ID,
    summary,
    context_digest: 'b'.repeat(64),
    verification_evidence: {
      artifact_digest: 'c'.repeat(64),
      head_sha: HEAD_SHA,
      passing_kinds: ['integration', 'unit'],
      evidence_sources: ['runner_direct'],
    },
    knowledge_reference_count: 3,
  };
  const bodyHash = knowledgeEventSha256(canonicalKnowledgeEventJson(payload));
  const eventId = `kev_${knowledgeEventSha256(canonicalKnowledgeEventJson([
    payload.schema_version,
    SOURCE_REF,
    SUBJECT_ID,
    PARENT_EPISODE_ID,
    bodyHash,
  ]))}`;
  return {
    schema_version: 'knowledge_event.v1',
    event_id: eventId,
    occurred_at: '2026-08-31T00:01:00.000Z',
    captured_at: '2026-08-31T00:02:00.000Z',
    source: { type: 'vibepro', ref: SOURCE_REF },
    subject: { type: 'development_learning', id: SUBJECT_ID },
    decision_authority: {
      kind: 'development_learning_candidate',
      authorized: false,
      graph_promotion_allowed: false,
    },
    applicability_scope: { scope: 'project', project_code: PROJECT_CODE },
    permission_snapshot: {
      knowledge_registration: true,
      external_action: false,
      graph_promotion: false,
      visibility: 'team',
      sensitivity: 'internal',
    },
    source_pointer: {
      uri: `vibepro://Unson-LLC/vibepro/${STORY_ID}?sha=${HEAD_SHA}`,
    },
    body_hash: bodyHash,
    parent_episode_id: PARENT_EPISODE_ID,
    payload,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function dependencies(options: {
  idempotent?: boolean;
  graphEntityId?: string | null;
  processingStage?: string;
  semanticState?: string;
  token?: string;
  configuredProjectCodes?: string[];
  responseStatus?: number;
} = {}): TestDependencies {
  const token = options.token ?? serviceToken();
  let tokenReadCount = 0;
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    const url = String(input);
    if (url.endsWith('/api/knowledge/events')) {
      if (options.responseStatus && options.responseStatus >= 400) {
        return jsonResponse({ error: 'knowledge_event_failed', message: 'backend rejected event' }, options.responseStatus);
      }
      const event = JSON.parse(String(init?.body ?? '{}')) as VibeProKnowledgeEvent;
      return jsonResponse({
        event_id: event.event_id,
        idempotent: options.idempotent ?? false,
        candidate_id: 'kc_vibepro_learning_001',
        graph_entity_id: options.graphEntityId ?? null,
        processing_stage: options.processingStage ?? 'retrievable',
        semantic_state: options.semanticState ?? 'active',
      }, 202);
    }
    return jsonResponse({ error: 'unexpected_route' }, 404);
  };
  return {
    apiUrl: 'https://brainbase.example',
    configuredProjectCodes: options.configuredProjectCodes ?? [PROJECT_CODE],
    tokenManager: {
      getToken: async () => {
        tokenReadCount += 1;
        return token;
      },
    },
    fetch,
    calls,
    tokenReads: () => tokenReadCount,
    token,
  };
}

function recordData(result: Awaited<ReturnType<typeof handleKnowledgeEventToolCall>>): Record<string, unknown> {
  assert.ok(result);
  assert.equal(result.status, 'ok');
  assert.ok(result.data && typeof result.data === 'object');
  return result.data as Record<string, unknown>;
}

describe('VibePro Knowledge Event MCP adapter', () => {
  it('publishes one strict candidate-only idempotent write tool', () => {
    assert.equal(knowledgeEventTools.length, 1);
    const tool = knowledgeEventTools[0];
    assert.equal(tool.name, 'brainbase_knowledge_event_record');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const schema = tool.inputSchema as Record<string, any>;
    assert.deepEqual(schema.required, ['event']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.event.additionalProperties, false);
    assert.equal(schema.properties.event.properties.decision_authority.properties.authorized.const, false);
    assert.equal(schema.properties.event.properties.decision_authority.properties.graph_promotion_allowed.const, false);
    assert.equal(schema.properties.event.properties.permission_snapshot.properties.external_action.const, false);
    assert.equal(schema.properties.event.properties.permission_snapshot.properties.graph_promotion.const, false);
  });

  it('validates and records the exact event through authenticated project scope', async () => {
    const event = buildEvent();
    const deps = dependencies();
    const result = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event },
      deps,
    );
    const data = recordData(result);

    assert.equal(result?.scope.project_codes[0], PROJECT_CODE);
    assert.equal(data.schema_version, 'brainbase-vibepro-knowledge-event-record-receipt.v1');
    assert.equal(data.status, 'recorded');
    assert.equal(data.event_id, event.event_id);
    assert.equal(data.project_code, PROJECT_CODE);
    assert.equal(data.story_id, STORY_ID);
    assert.equal(data.candidate_id, 'kc_vibepro_learning_001');
    assert.equal(data.processing_stage, 'retrievable');
    assert.equal(data.candidate_only, true);
    assert.equal(data.graph_promoted, false);
    assert.equal(data.external_action_executed, false);
    assert.equal(JSON.stringify(result).includes(deps.token), false);
    assert.equal(JSON.stringify(result).includes('/Users/'), false);
    assert.equal(deps.tokenReads(), 1);
    assert.equal(deps.calls.length, 1);

    const eventRequest = deps.calls[0];
    assert.equal(String(eventRequest.input), 'https://brainbase.example/api/knowledge/events');
    assert.deepEqual(JSON.parse(String(eventRequest.init?.body)), event);
    const headers = eventRequest.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${deps.token}`);
    assert.equal(headers['x-brainbase-projects'], PROJECT_CODE);
    assert.equal(headers['x-brainbase-organization-id'], ORGANIZATION_ID);
  });

  it('returns already_recorded for an idempotent backend replay', async () => {
    const data = recordData(await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ idempotent: true }),
    ));
    assert.equal(data.status, 'already_recorded');
  });

  it('fails before authentication when body hash or authority is tampered', async () => {
    const bodyTampered = buildEvent() as unknown as Record<string, unknown>;
    bodyTampered.body_hash = 'd'.repeat(64);
    const bodyDeps = dependencies();
    const bodyResult = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: bodyTampered },
      bodyDeps,
    );
    assert.equal(bodyResult?.status, 'error');
    assert.equal(bodyResult?.error?.code, 'knowledge_event_invalid');
    assert.match(bodyResult?.error?.message ?? '', /body_hash/);
    assert.equal(bodyDeps.tokenReads(), 0);
    assert.equal(bodyDeps.calls.length, 0);

    const authorityTampered = buildEvent() as unknown as Record<string, unknown>;
    authorityTampered.permission_snapshot = {
      ...(authorityTampered.permission_snapshot as Record<string, unknown>),
      graph_promotion: true,
    };
    const authorityDeps = dependencies();
    const authorityResult = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: authorityTampered },
      authorityDeps,
    );
    assert.equal(authorityResult?.status, 'error');
    assert.equal(authorityResult?.error?.code, 'knowledge_event_invalid');
    assert.match(authorityResult?.error?.message ?? '', /graph_promotion/);
    assert.equal(authorityDeps.tokenReads(), 0);
    assert.equal(authorityDeps.calls.length, 0);
  });

  it('rejects sensitive summaries, unsorted evidence, and mismatched source bindings', () => {
    assert.throws(
      () => validateVibeProKnowledgeEvent(buildEvent('api_key=super-secret-value')),
      /sensitive content/,
    );

    const unsorted = buildEvent() as unknown as Record<string, unknown>;
    const unsortedPayload = unsorted.payload as Record<string, unknown>;
    unsortedPayload.verification_evidence = {
      ...(unsortedPayload.verification_evidence as Record<string, unknown>),
      passing_kinds: ['unit', 'integration'],
    };
    assert.throws(() => validateVibeProKnowledgeEvent(unsorted), /sorted by Unicode code point/);

    const mismatched = buildEvent() as unknown as Record<string, unknown>;
    mismatched.source_pointer = {
      uri: `vibepro://another/repository/${STORY_ID}?sha=${HEAD_SHA}`,
    };
    assert.throws(() => validateVibeProKnowledgeEvent(mismatched), /source_pointer/);
  });

  it('fails closed when project or service-token organization scope is missing', async () => {
    const inaccessible = dependencies({ configuredProjectCodes: ['another-project'] });
    const inaccessibleResult = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      inaccessible,
    );
    assert.equal(inaccessibleResult?.status, 'error');
    assert.equal(inaccessibleResult?.error?.code, 'brainbase_project_not_accessible');
    assert.equal(inaccessible.calls.length, 0);

    const organizationMissing = dependencies({
      token: serviceToken({ organizationId: undefined }),
    });
    const organizationResult = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      organizationMissing,
    );
    assert.equal(organizationResult?.status, 'error');
    assert.equal(organizationResult?.error?.code, 'knowledge_event_organization_context_invalid');
    assert.match(organizationResult?.error?.message ?? '', /organization context/);
    assert.equal(organizationMissing.calls.length, 0);
  });

  it('fails closed when the backend reports Graph promotion or incomplete indexing', async () => {
    const promoted = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ graphEntityId: 'dec_forbidden' }),
    );
    assert.equal(promoted?.status, 'error');
    assert.equal(promoted?.error?.code, 'knowledge_event_record_failed');
    assert.match(promoted?.error?.message ?? '', /unexpectedly promoted/);

    const incomplete = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ processingStage: 'candidate_created' }),
    );
    assert.equal(incomplete?.status, 'error');
    assert.equal(incomplete?.error?.code, 'knowledge_event_record_failed');
    assert.match(incomplete?.error?.message ?? '', /candidate indexing/);
  });

  it('preserves backend HTTP errors without presenting a successful receipt', async () => {
    const result = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ responseStatus: 403 }),
    );
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'knowledge_event_failed');
    assert.equal(result?.error?.message, 'backend rejected event');
    assert.equal(result?.error?.http_status, 403);
  });

  it('returns null for unrelated tools', async () => {
    assert.equal(await handleKnowledgeEventToolCall('brainbase_search', {}, dependencies()), null);
  });
});
