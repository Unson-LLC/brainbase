/*
 * UX-06 source-navigation fixture.
 *
 * This is intentionally synthetic.  It does not mirror the owner's journal
 * and must never be used to claim that an existing value-proof has a source.
 */

export const UX06_SOURCE = Object.freeze({
  kind: 'local_graph',
  entity_id: 'project-atlas',
  entity_type: 'project',
  digest: 'sha256:fixture-project-atlas',
});

export const UX06_GRAPH_ENTITY = Object.freeze({
  id: 'project-atlas',
  type: 'project',
  name: 'Atlas導入',
  aliases: [],
  summary: '出典遷移を確認するための架空プロジェクト',
  tags: ['fixture'],
  validFrom: null,
  validTo: null,
  active: true,
  digest: 'sha256:fixture-project-atlas',
});

const BASE_PROOF = Object.freeze({
  schema_version: 'brainbase-judgment-value-proof-v1',
  intent_id: 'fixture-intent-ux06',
  decision_attempt_id: 'fixture-attempt-ux06',
  recorded_at: '2026-09-20T00:00:00.000Z',
  state: 'unconfirmed',
  interruption: {
    resolution: 'continued_without_human',
    question_display_text: '架空fixtureの設定を反映してよいですか？',
    question_digest: 'sha256:fixture-question',
    reason_code: 'routine_reversible_work',
    human_reason: null,
  },
  decision: {
    summary: '架空fixtureの出典を確認できた場合だけ対象へ移動する',
    work_impact: '出典の確認結果を画面に残す',
    basis: [{
      entity_id: UX06_SOURCE.entity_id,
      application: '架空fixtureの対象を確認する',
      layer: 'objective',
      source: UX06_SOURCE,
    }],
    prior_learning_reused: false,
  },
  execution: { status: 'completed', summary: 'fixtureを表示した', artifact_refs: [] },
  outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
  human_decision: null,
  feedback: { status: 'none', summary: null, evidence_ref: null },
});

export function sourceBearingProof(overrides = {}) {
  const decision = overrides.decision ?? {};
  const source = overrides.source ?? UX06_SOURCE;
  const baseBasis = BASE_PROOF.decision.basis.map((entry) => ({ ...entry, source: { ...source } }));
  return {
    ...BASE_PROOF,
    ...overrides,
    interruption: { ...BASE_PROOF.interruption, ...(overrides.interruption ?? {}) },
    decision: {
      ...BASE_PROOF.decision,
      ...decision,
      basis: decision.basis ?? baseBasis,
    },
    execution: { ...BASE_PROOF.execution, ...(overrides.execution ?? {}) },
    outcome: { ...BASE_PROOF.outcome, ...(overrides.outcome ?? {}) },
    feedback: { ...BASE_PROOF.feedback, ...(overrides.feedback ?? {}) },
  };
}

export function sourceFreeProof(overrides = {}) {
  const proof = sourceBearingProof(overrides);
  return {
    ...proof,
    decision: {
      ...proof.decision,
      basis: proof.decision.basis.map(({ source: _source, ...entry }) => entry),
    },
  };
}

export function sourceBearingHome(proof = sourceBearingProof()) {
  const item = { section: 'continued', proof, feedback_history: [] };
  return {
    status: 'available',
    root: '/synthetic/ux06-journal',
    coverage: { saved: 1, rejected: 0, latest_recorded_at: proof.recorded_at, possibly_stalled: false },
    sections: { needs_human: [], blocked: [], continued: [item], other: [] },
    delegation_map: {
      judged: 1,
      kind_recorded: 0,
      rated: 0,
      rows: [{
        key: 'reason:routine_reversible_work',
        source: 'reason_code',
        label: 'routine_reversible_work',
        state: 'verifying',
        state_basis: { reason: 'no_feedback' },
        counts: {
          continued: 1,
          returned: 0,
          rated: 0,
          by_feedback: { accepted: 0, corrected: 0, next_time_ask: 0, reverted: 0 },
          corrected_or_reverted: 0,
          inherited: 0,
        },
        latest_recorded_at: proof.recorded_at,
        items: [{ intent_id: proof.intent_id, decision_attempt_id: proof.decision_attempt_id, row_key: 'reason:routine_reversible_work' }],
      }],
      corrected_after_continue: [],
      continued_after_ask: [],
    },
    rejected: [],
  };
}

export function graphEntityPayload(overrides = {}) {
  return {
    status: 'ok',
    source: { dataDir: '/synthetic/ux06-graph', graphFormat: 2, authority: 'local_graph' },
    asOf: '2026-09-26T00:00:00.000Z',
    entity: { ...UX06_GRAPH_ENTITY, ...overrides.entity },
    outgoing: [],
    incoming: [],
    history: [],
    issues: [],
    ...overrides,
  };
}

export const UX06_GRAPH_SEARCH = Object.freeze({
  status: 'ok',
  source: { dataDir: '/synthetic/ux06-graph', graphFormat: 2, authority: 'local_graph' },
  query: { q: '', type: null, asOf: null },
  results: [UX06_GRAPH_ENTITY],
  total: 1,
  truncated: false,
  absenceConfirmed: false,
  graphEmpty: false,
});

export const UX06_GRAPH_ONTOLOGY = Object.freeze({
  status: 'ok',
  source: { dataDir: '/synthetic/ux06-graph', graphFormat: 2, authority: 'local_graph' },
  asOf: '2026-09-26T00:00:00.000Z',
  ontology: { id: 'ux06-fixture', version: '1', releaseDigest: 'sha256:fixture-ontology', currentVersion: '1', upToDate: true },
  entityTypes: [{ id: 'project', meaning: '架空fixtureのプロジェクト', count: 1 }],
  relations: [],
});
