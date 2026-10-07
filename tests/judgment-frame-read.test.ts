import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'vitest';

import {
  buildJudgmentFrameCatalog,
  judgmentFrameReadTools,
  handleJudgmentFrameReadToolCall,
  type JudgmentFrameKind,
  type JudgmentFrameSourceRecord,
  type JudgmentFrameReadDependencies,
} from '../src/judgment-frame.js';

const sourceRecords: JudgmentFrameSourceRecord[] = [
  {
    id: 'phi-guardrails',
    entity_type: 'philosophy',
    version: 2,
    payload: {
      display_name: '利用者の自律',
      statement: '利用者が検証可能な選択をできる状態を守る',
      constraint_details: { veto: '不可逆な隠れた変更をしない' },
      applicability_scope: '外部変更',
    },
  },
  {
    id: 'obj-value',
    entity_type: 'objective',
    version: 3,
    payload: {
      foundation: {
        desiredState: '選択の根拠を短時間で確認できる',
        measurement: '確認に要する時間',
        revision: 'objective-r7',
      },
      applicability_scope: ['判断を伴う応答'],
    },
  },
  {
    id: 'model-change',
    entity_type: 'model',
    payload: {
      foundation: {
        meaning: '本文取得を挟むと、要約だけの判断より参照漏れが減る',
        prediction: '本文参照済みのturnでは欠落指摘が減る',
        falsifier: '本文参照済みでも欠落率が同じ',
      },
    },
  },
];

function dependencies(records: readonly JudgmentFrameSourceRecord[] = sourceRecords): JudgmentFrameReadDependencies {
  return {
    loadRecords: async (kind: JudgmentFrameKind, limit: number) => {
      assert.equal(limit, 500);
      return {
        status: 'ok' as const,
        records: records.filter((record) => record.entity_type === kind),
      };
    },
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function catalogDigest(records: readonly JudgmentFrameSourceRecord[] = sourceRecords): `sha256:${string}` {
  return buildJudgmentFrameCatalog(records).catalog.digest;
}

describe('brainbase_judgment_frame_read', () => {
  it('does not present authorization scope as semantic applicability', async () => {
    const records: JudgmentFrameSourceRecord[] = [{
      id: 'model-auth-only', entity_type: 'model',
      payload: {
        scope: { subjectIds: ['tenant-a'] },
        foundation: { meaning: '予測本文', scope: { subjectIds: ['tenant-a'] } },
      },
    }];
    const result = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: catalogDigest(records),
      selections: [{ kind: 'model', ref: 'model-auth-only' }],
    }, dependencies(records));
    assert.equal(result?.status, 'ok');
    if (!result || result.status !== 'ok') return;
    assert.equal(result.data.records[0]?.applicability_scope, 'Graphに適用範囲の記載なし');
    assert.equal(result.data.records[0]?.applicability_scope_source, 'unspecified');
  });
  it('publishes the read tool as a read-only contract', () => {
    assert.deepEqual(judgmentFrameReadTools.map((tool) => tool.name), ['brainbase_judgment_frame_read']);
    assert.equal(judgmentFrameReadTools[0]?.annotations?.readOnlyHint, true);
  });

  it('returns full canonical payloads and distinguishes Graph metadata from derived/unspecified values', async () => {
    const result = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: catalogDigest(),
      selections: [
        { kind: 'philosophy', ref: 'phi-guardrails' },
        { kind: 'objective', ref: 'obj-value' },
        { kind: 'model', ref: 'model-change' },
      ],
    }, dependencies());

    assert.equal(result?.status, 'ok');
    if (!result || result.status !== 'ok') return;
    assert.equal(result.data.schema_version, 'brainbase-judgment-frame-read-v1');
    assert.equal(result.data.records.length, 3);

    const byRef = new Map(result.data.records.map((record) => [record.ref, record]));
    const philosophy = byRef.get('phi-guardrails');
    assert.ok(philosophy);
    assert.deepEqual(JSON.parse(philosophy.body), sourceRecords[0]?.payload);
    assert.equal(philosophy.body_digest, digest(philosophy.body));
    assert.equal(philosophy.version, '2');
    assert.equal(philosophy.version_source, 'graph');
    assert.equal(philosophy.applicability_scope, '外部変更');
    assert.equal(philosophy.applicability_scope_source, 'graph');

    const objective = byRef.get('obj-value');
    assert.ok(objective);
    assert.deepEqual(JSON.parse(objective.body), sourceRecords[1]?.payload);
    assert.equal(objective.version, 'objective-r7');
    assert.equal(objective.version_source, 'graph');
    assert.equal(objective.applicability_scope, '["判断を伴う応答"]');
    assert.equal(objective.applicability_scope_source, 'graph');

    const model = byRef.get('model-change');
    assert.ok(model);
    assert.match(model.body, /falsifier/);
    assert.match(model.body, /prediction/);
    assert.equal(model.version, model.body_digest);
    assert.equal(model.version_source, 'body_digest');
    assert.equal(model.applicability_scope, 'Graphに適用範囲の記載なし');
    assert.equal(model.applicability_scope_source, 'unspecified');
  });

  it('rejects a stale catalog digest before returning any body', async () => {
    const result = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: digest('stale'),
      selections: [{ kind: 'philosophy', ref: 'phi-guardrails' }],
    }, dependencies());

    assert.deepEqual(result?.status, 'error');
    assert.equal(result?.status === 'error' && result.error.code, 'judgment_frame_catalog_mismatch');
  });

  it('rejects unknown, duplicate, and malformed selections', async () => {
    const digestValue = catalogDigest();
    const unknown = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: digestValue,
      selections: [{ kind: 'philosophy', ref: 'missing' }],
    }, dependencies());
    assert.equal(unknown?.status === 'error' && unknown.error.code, 'judgment_frame_ref_unknown');

    const duplicate = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: digestValue,
      selections: [
        { kind: 'philosophy', ref: 'phi-guardrails' },
        { kind: 'philosophy', ref: 'phi-guardrails' },
      ],
    }, dependencies());
    assert.equal(duplicate?.status === 'error' && duplicate.error.code, 'judgment_frame_read_input_invalid');

    const extra = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: digestValue,
      selections: [{ kind: 'philosophy', ref: 'phi-guardrails', extra: true }],
    }, dependencies());
    assert.equal(extra?.status === 'error' && extra.error.code, 'judgment_frame_read_input_invalid');
  });

  it('does not promote a model title into a readable body', async () => {
    const records = [
      ...sourceRecords,
      { id: 'model-title-only', entity_type: 'model', payload: { title: '予測の名前だけ' } },
    ] satisfies JudgmentFrameSourceRecord[];
    const result = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: catalogDigest(records),
      selections: [{ kind: 'model', ref: 'model-title-only' }],
    }, dependencies(records));

    assert.equal(result?.status === 'error' && result.error.code, 'judgment_frame_body_unavailable');
  });

  it('fails closed when Graph reads fail or a page may be truncated', async () => {
    const unavailable: JudgmentFrameReadDependencies = {
      loadRecords: async () => ({ status: 'unavailable', code: 'graph_down', message: 'Graph unavailable' }),
    };
    const failed = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: catalogDigest(),
      selections: [{ kind: 'philosophy', ref: 'phi-guardrails' }],
    }, unavailable);
    assert.equal(failed?.status === 'unavailable' && failed.error.code, 'graph_down');

    const truncated: JudgmentFrameReadDependencies = {
      loadRecords: async (kind) => ({
        status: 'ok' as const,
        records: Array.from({ length: 500 }, (_, index) => ({
          id: `${kind}-${index}`,
          entity_type: kind,
          payload: { statement: `${kind}-${index}` },
        })),
      }),
    };
    const incomplete = await handleJudgmentFrameReadToolCall('brainbase_judgment_frame_read', {
      catalog_digest: catalogDigest(),
      selections: [{ kind: 'philosophy', ref: 'phi-guardrails' }],
    }, truncated);
    assert.equal(incomplete?.status === 'error' && incomplete.error.code, 'judgment_frame_catalog_truncated');
  });
});
