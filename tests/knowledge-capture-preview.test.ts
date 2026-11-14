import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  KnowledgeAIAdapterContractError,
  normalizeReadback,
  normalizeVersion,
  referenceKey,
  resolveKnowledgeAdapter,
  validateCaptureProposal,
  validatePreviewAnswer,
  versionValue,
} from '../src/knowledge-capture-preview.js';

// brainbase-unson server/services/knowledge-capture-preview-adapter.js を処理を変えずに移した。
// unsonには直接のテストが無いため、呼び出し側（knowledge-catalog-service・knowledge-bedrock-adapter）
// が頼っている振る舞いをここで固定する（story-document-and-meeting-source-exits-v1）。
const readback = { state: 'read', verified: true };

function captureResult(overrides: Record<string, unknown> = {}) {
  return {
    proposal: { kind: 'decision', summary: 's', scope: 'team', owner_candidate: 'per_1', relations: [] },
    evidence: [{ id: 'cand_1', version: '3', source_ref: 'graph:cand_1' }],
    unknown: ['owner'],
    version: '1',
    readback,
    ...overrides,
  };
}

describe('knowledge-capture-preview の検証', () => {
  it('取り込みの提案を、根拠・版・読み戻しをそろえて正規化する', () => {
    const allowed = new Set([referenceKey('cand_1', '3')]);
    const result = validateCaptureProposal(captureResult(), { allowedReferences: allowed });
    expect(result).toEqual({
      proposal: { kind: 'decision', summary: 's', scope: 'team', owner_candidate: 'per_1', relations: [] },
      evidence: [{ id: 'cand_1', version: '3', source_ref: 'graph:cand_1' }],
      unknown: ['owner'],
      version: '1',
      readback: { state: 'read', verified: true },
    });
  });

  it('提案の項目・版・読み戻しの検証が欠けると、成功にしない', () => {
    const { proposal } = captureResult();
    expect(() => validateCaptureProposal(captureResult({ proposal: { ...proposal, relations: undefined, owner_candidate: undefined } })))
      .not.toThrow();
    expect(() => validateCaptureProposal(captureResult({ proposal: { kind: 'decision', summary: 's', scope: 'team', relations: [] } })))
      .toThrowError(/owner_candidate is required/);
    expect(() => validateCaptureProposal(captureResult({ version: undefined }))).toThrowError(/version is required/);
    expect(() => validateCaptureProposal(captureResult({ readback: { state: 'read' } }))).toThrowError(/verified must be explicit/);
    expect(() => validateCaptureProposal(captureResult({ unknown: 'none' }))).toThrowError(/unknown must be an array/);
  });

  it('許可された候補の外を指す根拠を拒否する', () => {
    const allowed = new Set([referenceKey('cand_1', '2')]);
    expect(() => validateCaptureProposal(captureResult(), { allowedReferences: allowed }))
      .toThrowError(/references an unavailable candidate/);
  });

  it('下書きの回答は、隔離された候補の正確な版だけを引用できる', () => {
    const allowed = new Set([referenceKey('cand_1', '3')]);
    const answer = validatePreviewAnswer({
      answer: ' 回答 ',
      citations: [{ id: 'cand_1', version: '3' }],
      evidence: [{ id: 'cand_1', version: '3' }],
      unknown: [],
      readback,
      version: { state: 'unverified', value: 2 },
    }, { allowedReferences: allowed });
    expect(answer).toMatchObject({
      answer: '回答',
      citations: [{ id: 'cand_1', version: '3' }],
      exclusions: [],
      version: { state: 'unverified', value: '2' },
    });

    expect(() => validatePreviewAnswer({
      answer: 'a', citations: [{ id: 'cand_9', version: '3' }], evidence: [], unknown: [], readback, version: '1',
    }, { allowedReferences: allowed })).toThrowError(/outside the isolated set/);
    expect(() => validatePreviewAnswer({
      answer: 'a', citations: [{ id: 'cand_1', version: { state: 'unknown' } }], evidence: [], unknown: [], readback, version: '1',
    }, { allowedReferences: allowed })).toThrowError(/must be an exact value/);
    expect(() => validatePreviewAnswer({
      answer: 'a', citations: [], evidence: [{ source_ref: 'graph:x', version: '1' }], unknown: [], readback, version: '1',
    }, { allowedReferences: allowed })).toThrowError(/id is required/);
  });

  it('検証の失敗は、型・コード・状態の決まったエラーになる', () => {
    try {
      validatePreviewAnswer({}, { allowedReferences: new Set() });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeAIAdapterContractError);
      expect(error).toMatchObject({
        name: 'KnowledgeAIAdapterContractError',
        code: 'knowledge_ai_adapter_contract_invalid',
        status: 502,
        details: { field: 'answer' },
      });
    }
  });

  it('版と読み戻しを正規化し、部品は明示的に渡されたものだけを使う', () => {
    expect(normalizeVersion(' 4 ')).toBe('4');
    expect(normalizeVersion(5)).toBe('5');
    expect(normalizeVersion({ status: 'pending' })).toEqual({ state: 'pending', value: null });
    expect(versionValue('4')).toBe('4');
    expect(versionValue({ state: 'pending', value: null })).toBeNull();
    expect(normalizeReadback({ status: 'ok', verified: false })).toEqual({ status: 'ok', state: 'ok', verified: false });

    const adapter = { proposeCapture() { return this; } };
    expect(resolveKnowledgeAdapter(adapter, 'proposeCapture')?.()).toBe(adapter);
    expect(resolveKnowledgeAdapter(adapter, 'previewAnswer')).toBeNull();
    expect(resolveKnowledgeAdapter(null, 'proposeCapture')).toBeNull();
    const fn = () => 'x';
    expect(resolveKnowledgeAdapter(fn, 'anything')).toBe(fn);
  });
});

describe('knowledge-capture-preview の公開の出口', () => {
  it('package.json の出口から、ビルド後の成果物として読み込める', async () => {
    const root = process.cwd();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.exports['./knowledge-capture-preview']).toEqual({
      types: './dist/knowledge-capture-preview.d.ts',
      import: './dist/knowledge-capture-preview.js',
    });
    const built = await import(pathToFileURL(path.join(root, manifest.exports['./knowledge-capture-preview'].import)).href);
    expect(built.referenceKey('cand_1', '3')).toBe(referenceKey('cand_1', '3'));
    expect(() => built.validateCaptureProposal(null)).toThrowError(built.KnowledgeAIAdapterContractError);
  });
});
