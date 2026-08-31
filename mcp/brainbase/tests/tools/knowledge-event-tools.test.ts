import { beforeEach, describe, expect, it, vi } from 'vitest';
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

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch;
type TestDependencies = KnowledgeEventToolDependencies & {
  fetcher: FetchMock;
  getToken: ReturnType<typeof vi.fn>;
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
  const getToken = vi.fn(async () => token);
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
  }) as unknown as FetchMock;
  return {
    apiUrl: 'https://brainbase.example',
    configuredProjectCodes: options.configuredProjectCodes ?? [PROJECT_CODE],
    tokenManager: { getToken },
    fetch: fetcher,
    fetcher,
    getToken,
    token,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('VibePro Knowledge Event MCP adapter', () => {
  it('publishes one strict candidate-only idempotent write tool', () => {
    expect(knowledgeEventTools).toHaveLength(1);
    expect(knowledgeEventTools[0]).toMatchObject({
      name: 'brainbase_knowledge_event_record',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: 'object',
        required: ['event'],
        additionalProperties: false,
        properties: {
          event: {
            additionalProperties: false,
            properties: {
              decision_authority: {
                properties: {
                  authorized: { const: false },
                  graph_promotion_allowed: { const: false },
                },
              },
              permission_snapshot: {
                properties: {
                  external_action: { const: false },
                  graph_promotion: { const: false },
                },
              },
            },
          },
        },
      },
    });
  });

  it('validates and records the exact event through authenticated project scope', async () => {
    const event = buildEvent();
    const deps = dependencies();
    const result = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event },
      deps,
    );

    expect(result).toMatchObject({
      status: 'ok',
      scope: { project_codes: [PROJECT_CODE] },
      data: {
        schema_version: 'brainbase-vibepro-knowledge-event-record-receipt.v1',
        status: 'recorded',
        event_id: event.event_id,
        project_code: PROJECT_CODE,
        story_id: STORY_ID,
        candidate_id: 'kc_vibepro_learning_001',
        processing_stage: 'retrievable',
        candidate_only: true,
        graph_promoted: false,
        external_action_executed: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(deps.token);
    expect(JSON.stringify(result)).not.toContain('/Users/');
    expect(deps.getToken).toHaveBeenCalledTimes(1);
    expect(deps.fetcher).toHaveBeenCalledTimes(1);

    const eventRequest = deps.fetcher.mock.calls[0] as unknown as [string | URL | Request, RequestInit];
    expect(String(eventRequest[0])).toBe('https://brainbase.example/api/knowledge/events');
    expect(JSON.parse(String(eventRequest[1].body))).toEqual(event);
    expect(eventRequest[1].headers).toMatchObject({
      Authorization: `Bearer ${deps.token}`,
      'x-brainbase-projects': PROJECT_CODE,
      'x-brainbase-organization-id': ORGANIZATION_ID,
    });
  });

  it('returns already_recorded for an idempotent backend replay', async () => {
    const result = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ idempotent: true }),
    );
    expect(result).toMatchObject({ status: 'ok', data: { status: 'already_recorded' } });
  });

  it('fails before authentication when body hash or authority is tampered', async () => {
    const bodyTampered = buildEvent() as unknown as Record<string, unknown>;
    bodyTampered.body_hash = 'd'.repeat(64);
    const bodyDeps = dependencies();
    await expect(handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: bodyTampered },
      bodyDeps,
    )).resolves.toMatchObject({
      status: 'error',
      error: { code: 'knowledge_event_invalid', message: expect.stringContaining('body_hash') },
    });
    expect(bodyDeps.getToken).not.toHaveBeenCalled();
    expect(bodyDeps.fetcher).not.toHaveBeenCalled();

    const authorityTampered = buildEvent() as unknown as Record<string, unknown>;
    authorityTampered.permission_snapshot = {
      ...(authorityTampered.permission_snapshot as Record<string, unknown>),
      graph_promotion: true,
    };
    const authorityDeps = dependencies();
    await expect(handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: authorityTampered },
      authorityDeps,
    )).resolves.toMatchObject({
      status: 'error',
      error: { code: 'knowledge_event_invalid', message: expect.stringContaining('graph_promotion') },
    });
    expect(authorityDeps.getToken).not.toHaveBeenCalled();
    expect(authorityDeps.fetcher).not.toHaveBeenCalled();
  });

  it('rejects sensitive summaries, unsorted evidence, and mismatched source bindings', () => {
    expect(() => validateVibeProKnowledgeEvent(buildEvent('api_key=super-secret-value')))
      .toThrow(/sensitive content/);

    const unsorted = buildEvent() as unknown as Record<string, unknown>;
    const unsortedPayload = unsorted.payload as Record<string, unknown>;
    unsortedPayload.verification_evidence = {
      ...(unsortedPayload.verification_evidence as Record<string, unknown>),
      passing_kinds: ['unit', 'integration'],
    };
    expect(() => validateVibeProKnowledgeEvent(unsorted)).toThrow(/sorted by Unicode code point/);

    const mismatched = buildEvent() as unknown as Record<string, unknown>;
    mismatched.source_pointer = {
      uri: `vibepro://another/repository/${STORY_ID}?sha=${HEAD_SHA}`,
    };
    expect(() => validateVibeProKnowledgeEvent(mismatched)).toThrow(/source_pointer/);
  });

  it('fails closed when project or service-token organization scope is missing', async () => {
    const inaccessible = dependencies({ configuredProjectCodes: ['another-project'] });
    await expect(handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      inaccessible,
    )).resolves.toMatchObject({
      status: 'error',
      error: { code: 'brainbase_project_not_accessible' },
    });
    expect(inaccessible.fetcher).not.toHaveBeenCalled();

    const organizationMissing = dependencies({
      token: serviceToken({ organizationId: undefined }),
    });
    await expect(handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      organizationMissing,
    )).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'knowledge_event_organization_context_invalid',
        message: expect.stringContaining('organization context'),
      },
    });
    expect(organizationMissing.fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when the backend reports Graph promotion or incomplete indexing', async () => {
    const promoted = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ graphEntityId: 'dec_forbidden' }),
    );
    expect(promoted).toMatchObject({
      status: 'error',
      error: {
        code: 'knowledge_event_record_failed',
        message: expect.stringContaining('unexpectedly promoted'),
      },
    });

    const incomplete = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ processingStage: 'candidate_created' }),
    );
    expect(incomplete).toMatchObject({
      status: 'error',
      error: {
        code: 'knowledge_event_record_failed',
        message: expect.stringContaining('candidate indexing'),
      },
    });
  });

  it('preserves backend HTTP errors without presenting a successful receipt', async () => {
    const result = await handleKnowledgeEventToolCall(
      'brainbase_knowledge_event_record',
      { event: buildEvent() },
      dependencies({ responseStatus: 403 }),
    );
    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'knowledge_event_failed',
        message: 'backend rejected event',
        http_status: 403,
      },
    });
  });

  it('returns null for unrelated tools', async () => {
    await expect(handleKnowledgeEventToolCall('brainbase_search', {}, dependencies())).resolves.toBeNull();
  });
});
