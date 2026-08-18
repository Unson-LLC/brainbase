import { expect, test } from '@playwright/test';
import express from 'express';
import type { AddressInfo } from 'node:net';

import { handleOnboardingToolCall } from '../../mcp/brainbase/src/tools/onboarding-tools.ts';
import { createOnboardingRouter } from '../../server/routes/onboarding.js';
import { InMemoryCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';
import {
  InMemoryOnboardingRunRepository,
  OnboardingRuntimeService,
} from '../../server/services/onboarding/onboarding-runtime-service.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

async function fixture() {
  let nowMs = Date.parse('2026-08-02T00:00:00.000Z');
  let runCounter = 0;
  const graphWrites: unknown[] = [];
  const graphEdges: unknown[] = [];
  let graphFailuresRemaining = 0;
  const service = new OnboardingRuntimeService({
    repository: new InMemoryOnboardingRunRepository(),
    candidateRepository: new InMemoryCandidateRepository(),
    infoSSOTService: {
      async createOrUpdateGraphEntity(access: unknown, input: { id: string }) {
        if (graphFailuresRemaining > 0) {
          graphFailuresRemaining -= 1;
          throw new Error('simulated Graph transport failure');
        }
        graphWrites.push({ access, input });
        return { entity_id: input.id };
      },
      async createOrUpdateGraphEdge(access: unknown, input: { fromId: string; toId: string; relType: string }) {
        graphEdges.push({ access, input });
        return { from_id: input.fromId, to_id: input.toId, rel_type: input.relType };
      },
    },
    now: () => new Date(nowMs),
    idFactory: () => `onb_e2e_${String(++runCounter).padStart(3, '0')}`,
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const authorization = req.get('authorization') || '';
    const projectCodes = (req.get('x-brainbase-projects') || '').split(',').filter(Boolean);
    if (!authorization.startsWith('Bearer ') || !projectCodes.includes('brainbase')) {
      res.status(401).json({ error: { code: 'onboarding_auth_required', message: 'authenticated project scope required' } });
      return;
    }
    req.auth = { sub: 'per_owner', role: 'ceo' };
    req.access = { personId: 'per_owner', role: 'ceo', projectCodes };
    next();
  });
  app.use('/api/onboarding', createOnboardingRouter({ service }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  const dependencies = {
    apiUrl: `http://127.0.0.1:${address.port}`,
    configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => jwt({ sub: 'per_owner', projectCodes: ['brainbase'] }) },
  };
  return {
    dependencies,
    graphWrites,
    graphEdges,
    failNextGraphWrite: () => { graphFailuresRemaining += 1; },
    advance: (ms: number) => { nowMs += ms; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function data<T>(result: Awaited<ReturnType<typeof handleOnboardingToolCall>>): T {
  expect(result).toMatchObject({ status: 'ok', scope: { project_codes: ['brainbase'] } });
  return result?.data as T;
}

for (const sourceMode of ['mcp', 'drive', 'gmail', 'local_folder', 'single_document']) {
  test(`AC-1 AC-2 AC-3 AC-6 AC-7 AC-8 AC-9 RT-SCENARIO-001 host-agent MCP flow_replay: ${sourceMode} reaches a useful first-value review within ten minutes`, async () => {
    const state = await fixture();
    try {
      const run = data<{ id: string; workflow_state: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
        project_code: 'brainbase',
        value_target: 'Brainbaseを誰が運営しているか',
        source_mode: sourceMode,
      }, state.dependencies));
      expect(run.workflow_state).toBe('initialized');
      const ingested = data<{ candidates: Array<{ id: string }> }>(await handleOnboardingToolCall('brainbase_onboarding_ingest', {
        project_code: 'brainbase',
        run_id: run.id,
        source: {
          mode: sourceMode,
          source_id: `${sourceMode}:source-1`,
          evidence_ref: `${sourceMode}:source-1#item-2`,
          content_hash: HASH_A,
          permission_snapshot: { visibility: 'owner', collected_by: 'host_agent' },
          collection_status: 'collected',
        },
        candidates: [{
          subject_type: 'org',
          fact: 'Unson LLC は Brainbase を運営している',
          observation_class: 'observed',
          evidence_id: `${sourceMode}:source-1#item-2`,
        }],
      }, state.dependencies));
      const promoted = data<{ graph_entity_id: string; candidate: { promoted_graph_entity_id: string } }>(await handleOnboardingToolCall('brainbase_onboarding_review', {
        project_code: 'brainbase', run_id: run.id, candidate_id: ingested.candidates[0].id, decision: 'approve',
      }, state.dependencies));
      expect(promoted.candidate.promoted_graph_entity_id).toBe(promoted.graph_entity_id);
      data(await handleOnboardingToolCall('brainbase_onboarding_first_value', {
        project_code: 'brainbase', run_id: run.id, action: 'record', answer_hash: HASH_B,
        used_graph_entity_ids: [promoted.graph_entity_id], missing_context: [],
        presentation_contract_version: 'first_value_clarity.v1',
        presented_sections: ['覚えていたこと', 'つながったこと', '次にできること'],
      }, state.dependencies));
      state.advance(9 * 60 * 1000);
      const completed = data<{ source_mode: string; status: string; workflow_state: string; first_value_review: { verdict: string; within_ten_minutes: boolean } }>(
        await handleOnboardingToolCall('brainbase_onboarding_first_value', {
          project_code: 'brainbase', run_id: run.id, action: 'review', verdict: 'useful',
        }, state.dependencies),
      );

      expect(completed).toMatchObject({
        source_mode: sourceMode,
        status: 'first_value_answer_reviewed',
        workflow_state: 'first_value_answer_reviewed',
        first_value_review: { verdict: 'useful', within_ten_minutes: true },
      });
      expect(state.graphWrites).toHaveLength(1);
      expect(state.graphEdges).toHaveLength(0);
    } finally {
      await state.close();
    }
  });
}

test('evidence_lifecycle_regression host-agent MCP failure replay: redaction-required PII is hidden and cannot reach Graph', async () => {
  const state = await fixture();
  try {
    const run = data<{ id: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '連絡先', source_mode: 'drive',
    }, state.dependencies));
    const ingestedResult = await handleOnboardingToolCall('brainbase_onboarding_ingest', {
      project_code: 'brainbase',
      run_id: run.id,
      source: {
        mode: 'drive', source_id: 'drive:pii', evidence_ref: 'drive:pii#item-1', content_hash: HASH_A,
        permission_snapshot: { visibility: 'owner' }, collection_status: 'collected',
      },
      candidates: [{
        subject_type: 'person', fact: '連絡先は 090-1234-5678', observation_class: 'observed', evidence_id: 'drive:pii#item-1',
      }],
    }, state.dependencies);
    const ingested = data<{ candidates: Array<{ id: string; fact: null; redaction_required: boolean }> }>(ingestedResult);

    expect(ingested.candidates[0]).toMatchObject({ fact: null, redaction_required: true });
    expect(JSON.stringify(ingestedResult)).not.toContain('090-1234-5678');
    const promotion = await handleOnboardingToolCall('brainbase_onboarding_review', {
      project_code: 'brainbase', run_id: run.id, candidate_id: ingested.candidates[0].id, decision: 'approve',
    }, state.dependencies);
    expect(promotion).toMatchObject({ status: 'error', error: { http_status: 409 } });
    expect(state.graphWrites).toHaveLength(0);
    expect(state.graphEdges).toHaveLength(0);
  } finally {
    await state.close();
  }
});

test('host-agent MCP failure replay: project scope mismatch is rejected by the HTTP boundary without Graph writes', async () => {
  const state = await fixture();
  try {
    const run = data<{ id: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '組織概要', source_mode: 'mcp',
    }, state.dependencies));
    const outsideScope = {
      ...state.dependencies,
      configuredProjectCodes: ['outside-project'],
      tokenManager: { getToken: async () => jwt({ sub: 'per_owner', projectCodes: ['outside-project'] }) },
    };

    const result = await handleOnboardingToolCall('brainbase_onboarding_get', {
      project_code: 'outside-project', run_id: run.id,
    }, outsideScope);

    expect(result).toMatchObject({
      status: 'error',
      scope: { project_codes: ['outside-project'] },
      error: { code: 'brainbase_api_error', http_status: 401 },
    });
    expect(state.graphWrites).toHaveLength(0);
    expect(state.graphEdges).toHaveLength(0);
  } finally {
    await state.close();
  }
});

test('AC-4 host-agent MCP failure replay: inferred candidate cannot be promoted to Graph', async () => {
  const state = await fixture();
  try {
    const run = data<{ id: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '組織概要', source_mode: 'gmail',
    }, state.dependencies));
    const ingested = data<{ candidates: Array<{ id: string }> }>(await handleOnboardingToolCall('brainbase_onboarding_ingest', {
      project_code: 'brainbase',
      run_id: run.id,
      source: {
        mode: 'gmail', source_id: 'gmail:inferred', evidence_ref: 'gmail:inferred#item-1', content_hash: HASH_A,
        permission_snapshot: { visibility: 'owner' }, collection_status: 'collected',
      },
      candidates: [{
        subject_type: 'org', fact: 'Brainbase は将来別組織が運営する可能性がある',
        observation_class: 'inferred', evidence_id: 'gmail:inferred#item-1',
      }],
    }, state.dependencies));

    const promotion = await handleOnboardingToolCall('brainbase_onboarding_review', {
      project_code: 'brainbase', run_id: run.id, candidate_id: ingested.candidates[0].id, decision: 'approve',
    }, state.dependencies);

    expect(promotion).toMatchObject({ status: 'error', error: { http_status: 409 } });
    expect(state.graphWrites).toHaveLength(0);
    expect(state.graphEdges).toHaveLength(0);
  } finally {
    await state.close();
  }
});

test('AC-5 evidence_lifecycle_regression host-agent MCP review replay: rejected candidate remains auditable without a Graph ID', async () => {
  const state = await fixture();
  try {
    const run = data<{ id: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '組織概要', source_mode: 'single_document',
    }, state.dependencies));
    const ingested = data<{ candidates: Array<{ id: string }> }>(await handleOnboardingToolCall('brainbase_onboarding_ingest', {
      project_code: 'brainbase',
      run_id: run.id,
      source: {
        mode: 'single_document', source_id: 'single-document:reject', evidence_ref: 'single-document:reject#item-1',
        content_hash: HASH_A, permission_snapshot: { visibility: 'owner' }, collection_status: 'collected',
      },
      candidates: [{
        subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
        observation_class: 'observed', evidence_id: 'single-document:reject#item-1',
      }],
    }, state.dependencies));

    const rejected = data<{ candidate: { id: string; promotion_status: string; promoted_graph_entity_id: string | null } }>(
      await handleOnboardingToolCall('brainbase_onboarding_review', {
        project_code: 'brainbase', run_id: run.id, candidate_id: ingested.candidates[0].id, decision: 'reject',
      }, state.dependencies),
    );
    expect(rejected.candidate).toMatchObject({
      id: ingested.candidates[0].id,
      promotion_status: 'rejected',
      promoted_graph_entity_id: null,
    });
    expect(state.graphWrites).toHaveLength(0);
    expect(state.graphEdges).toHaveLength(0);
  } finally {
    await state.close();
  }
});

test('provider_failure host-agent MCP failure replay: unavailable transport remains unavailable rather than empty success', async () => {
  const result = await handleOnboardingToolCall('brainbase_onboarding_get', {
    project_code: 'brainbase', run_id: 'onb_missing',
  }, {
    apiUrl: 'http://127.0.0.1:1',
    configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => jwt({ sub: 'per_owner', projectCodes: ['brainbase'] }) },
  });
  expect(result).toMatchObject({ status: 'unavailable', error: { code: 'brainbase_api_unavailable' } });
  expect(result).not.toHaveProperty('data');
});

test('provider_failure workflow_state_regression host-agent MCP retry replay: Graph failure resumes the approved candidate without duplicate writes', async () => {
  const state = await fixture();
  try {
    const run = data<{ id: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '組織概要', source_mode: 'drive',
    }, state.dependencies));
    const ingested = data<{ candidates: Array<{ id: string }> }>(await handleOnboardingToolCall('brainbase_onboarding_ingest', {
      project_code: 'brainbase', run_id: run.id,
      source: {
        mode: 'drive', source_id: 'drive:retry', evidence_ref: 'drive:retry#item-1', content_hash: HASH_A,
        permission_snapshot: { visibility: 'owner' }, collection_status: 'collected',
      },
      candidates: [{
        subject_type: 'org', fact: 'Unson LLC は Brainbase を運営している',
        observation_class: 'observed', evidence_id: 'drive:retry#item-1',
      }],
    }, state.dependencies));

    state.failNextGraphWrite();
    const failed = await handleOnboardingToolCall('brainbase_onboarding_review', {
      project_code: 'brainbase', run_id: run.id, candidate_id: ingested.candidates[0].id, decision: 'approve',
    }, state.dependencies);
    expect(failed).toMatchObject({ status: 'unavailable', error: { http_status: 500 } });
    expect(state.graphWrites).toHaveLength(0);

    const retried = data<{ graph_entity_id: string; candidate: { promotion_status: string } }>(await handleOnboardingToolCall('brainbase_onboarding_review', {
      project_code: 'brainbase', run_id: run.id, candidate_id: ingested.candidates[0].id, decision: 'approve',
    }, state.dependencies));
    expect(retried.candidate.promotion_status).toBe('promoted_to_graph');
    expect(retried.graph_entity_id).toBeTruthy();
    expect(state.graphWrites).toHaveLength(1);
    expect(state.graphEdges).toHaveLength(0);
  } finally {
    await state.close();
  }
});

test('parse_failure schema_failure host-agent MCP credential guard rejects long malformed tails before HTTP ledger persistence', async () => {
  const state = await fixture();
  try {
    const run = data<{ id: string }>(await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '組織概要', source_mode: 'drive',
    }, state.dependencies));
    for (const evidenceRef of [
      'https://example.test/file?access_token%ZZZZ=plaintext-secret',
      'https://example.test/oauth?client_secret%malformed=plaintext-secret',
      'https://example.test/oauth?oauth_token%ZZZZ=plaintext-secret',
    ]) {
      const rejected = await handleOnboardingToolCall('brainbase_onboarding_ingest', {
        project_code: 'brainbase', run_id: run.id,
        source: {
          mode: 'drive', source_id: evidenceRef, evidence_ref: evidenceRef, content_hash: HASH_A,
          permission_snapshot: { visibility: 'owner' }, collection_status: 'collected',
        },
        candidates: [],
      }, state.dependencies);
      expect(rejected).toMatchObject({ status: 'error', error: { code: 'brainbase_onboarding_input_invalid' } });
    }
    const persisted = data<{ sources: unknown[] }>(await handleOnboardingToolCall('brainbase_onboarding_get', {
      project_code: 'brainbase', run_id: run.id,
    }, state.dependencies));
    expect(persisted.sources).toHaveLength(0);
    expect(state.graphWrites).toHaveLength(0);
    expect(state.graphEdges).toHaveLength(0);
  } finally {
    await state.close();
  }
});
