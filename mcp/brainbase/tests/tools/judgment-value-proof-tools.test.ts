import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleJudgmentValueProofToolCall,
  judgmentValueProofTools,
  normalizeJudgmentValueProofInput,
} from '../../src/tools/judgment-value-proof-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

function validInput(): Record<string, any> {
  return {
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '既存文書を更新するか、新規文書を作るか',
      reason_code: 'routine_reversible_work',
    },
    decision: {
      summary: '既存SSOTを最小更新する',
      work_impact: '確認で止めず、PR作成まで進めた',
      basis: [{
        entity_id: 'dec_example',
        application: '正本が存在する場合は重複する文書を増やさない',
      }],
    },
    execution: {
      summary: '既存文書を更新し、PRを作成した',
      artifact_refs: [{ kind: 'pull_request', ref: 'github://pull/142', label: 'PR #142' }],
    },
    outcome: {
      status: 'outcome_verified',
      summary: 'PRを読み戻し、テスト成功を確認した',
      evidence_refs: [{
        kind: 'canonical_readback',
        tool_use_id: 'tool-readback-1',
        subject_ref: 'github://pull/142',
        label: 'PR読み戻し',
      }],
    },
    human_decision: null,
    feedback_requested: false,
  };
}

describe('brainbase_judgment_value_proof_record', () => {
  it('publishes one strict out-of-band tool contract', () => {
    assert.equal(judgmentValueProofTools.length, 1);
    assert.equal(judgmentValueProofTools[0].name, 'brainbase_judgment_value_proof_record');
    assert.equal(judgmentValueProofTools[0].inputSchema.additionalProperties, false);
    assert.ok(serverTesting.tools.some((tool) => tool.name === 'brainbase_judgment_value_proof_record'));
  });

  it('normalizes a delegated decision without copying raw tool output', async () => {
    const result = await handleJudgmentValueProofToolCall(
      'brainbase_judgment_value_proof_record',
      validInput(),
    );

    assert.equal(result?.status, 'ok');
    assert.deepEqual(result && result.status === 'ok' ? result.data : null, {
      schema_version: 'brainbase-judgment-value-proof-input-v1',
      ...validInput(),
    });
  });

  it('accepts a real human decision only with reason and option impacts', () => {
    const input = validInput();
    input.interruption = {
      resolution: 'human_required',
      question_display_text: '契約上限をいくらにするか',
      reason_code: 'material_commitment',
    };
    input.decision.summary = null;
    input.decision.work_impact = null;
    input.execution.summary = null;
    input.execution.artifact_refs = [];
    input.outcome = { status: 'not_applicable', summary: null, evidence_refs: [] };
    input.human_decision = {
      question: '契約上限をいくらにするか',
      why_human: '外部への金銭的コミットメントになるため',
      options: [{ id: 'A', label: '30万円', impact: '利益率を守れるが受注可能性が下がる' }],
    };

    assert.equal(normalizeJudgmentValueProofInput(input)?.human_decision?.options[0].id, 'A');

    input.human_decision.options = [];
    assert.equal(normalizeJudgmentValueProofInput(input), null);
  });

  it('rejects delegated decisions when no outcome can apply', async () => {
    const input = validInput();
    input.outcome = { status: 'not_applicable', summary: null, evidence_refs: [] };

    assert.equal(normalizeJudgmentValueProofInput(input), null);
    assert.deepEqual(await handleJudgmentValueProofToolCall(
      'brainbase_judgment_value_proof_record',
      input,
    ), {
      status: 'error',
      error: {
        code: 'judgment_value_proof_invalid',
        message: 'Judgment value proof does not match brainbase-judgment-value-proof-input-v1',
      },
    });
  });

  it('rejects verified outcomes without evidence and secret-bearing summaries', async () => {
    const withoutEvidence = validInput();
    withoutEvidence.outcome.evidence_refs = [];
    assert.equal(normalizeJudgmentValueProofInput(withoutEvidence), null);

    const secret = validInput();
    secret.decision.summary = 'token=abcdef123456 を使って進める';
    const result = await handleJudgmentValueProofToolCall(
      'brainbase_judgment_value_proof_record',
      secret,
    );
    assert.deepEqual(result, {
      status: 'error',
      error: {
        code: 'judgment_value_proof_invalid',
        message: 'Judgment value proof does not match brainbase-judgment-value-proof-input-v1',
      },
    });
  });

  it('does not claim unrelated tools', async () => {
    assert.equal(await handleJudgmentValueProofToolCall('brainbase_projects', {}), null);
  });
});
