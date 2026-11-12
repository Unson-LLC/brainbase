import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  frameApplicationMetadata,
  frameReadMetadata,
  hasCompleteJudgmentFrame,
  sessionFrameCatalogDigests,
} from '../src/judgment-frame-evidence.js';

const catalog_digest = `sha256:${'a'.repeat(64)}`;
const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const selections = [{ kind: 'philosophy', ref: 'phi_guardrails', why: '承認の境界' }];
const input = {
  catalog_digest,
  selections,
  none: { objective: '不適用', model: '不適用' },
  chosen_option: 'A',
  options: [{ label: 'A', uses: [{ ref: 'phi_guardrails', role: 'constraint', note: '承認を残す', verdict: 'satisfied' }] }],
};
const body = '承認の境界を守る。';
const read = {
  schema_version: 'brainbase-judgment-frame-read-v1',
  catalog_digest,
  records: [{
    kind: 'philosophy', ref: 'phi_guardrails', body, body_digest: hash(body),
    version: '2', version_source: 'graph', applicability_scope: '外部変更', applicability_scope_source: 'graph',
  }],
};
const frame = { catalog_digest, selections, chosen_option: 'A' };
const catalogEvent = {
  event_kind: 'frame_catalog', success: true, safe_metadata: { judgment_frame_catalog: { catalog_digest } },
};
const readEvent = () => ({
  event_kind: 'frame_read', success: true, safe_metadata: { judgment_frame_read: frameReadMetadata(read, input) },
});
const frameEvent = (value: unknown = input) => ({
  event_kind: 'frame', success: true,
  safe_metadata: { judgment_frame: { catalog_digest, ...frameApplicationMetadata(frame, value) } },
});

describe('現在turnの判断参照の照合', () => {
  it('採用案と各参照の適用対応を保持し、案名・適用文・不適用理由はdigestだけ残す', () => {
    const metadata = frameApplicationMetadata(frame, input);
    expect(metadata.chosen_option_digest).toBe(hash('A'));
    expect(metadata.applications).toEqual([{
      kind: 'philosophy', ref: 'phi_guardrails', role: 'constraint', verdict: 'satisfied', note_digest: hash('承認を残す'),
    }]);
    expect(metadata.non_applicability).toEqual([
      { kind: 'objective', reason_digest: hash('不適用') }, { kind: 'model', reason_digest: hash('不適用') },
    ]);
    expect(JSON.stringify(metadata)).not.toContain('承認を残す');
    expect(JSON.stringify(metadata)).not.toContain('不適用');
  });

  it('本文digest・版・適用範囲を確認し、本文を監査へ保存しない', () => {
    const metadata = frameReadMetadata(read, input);
    expect(metadata?.records[0]).toEqual({
      kind: 'philosophy', ref: 'phi_guardrails', body_digest: read.records[0].body_digest,
      version: '2', version_source: 'graph', applicability_scope_source: 'graph',
    });
    expect(JSON.stringify(metadata)).not.toContain(body);
    expect(hasCompleteJudgmentFrame([catalogEvent, readEvent(), frameEvent()])).toBe(true);
  });

  it.each(['body', 'version', 'applicability_scope'])('空の%sは本文取得にならない', (field) => {
    expect(frameReadMetadata({ ...read, records: [{ ...read.records[0], [field]: '' }] }, input)).toBeNull();
  });

  it('本文改変、catalog不一致、未要求参照、重複を拒否する', () => {
    expect(frameReadMetadata({ ...read, records: [{ ...read.records[0], body: '別の本文' }] }, input)).toBeNull();
    expect(frameReadMetadata({ ...read, catalog_digest: `sha256:${'b'.repeat(64)}` }, input)).toBeNull();
    expect(frameReadMetadata(read, { ...input, selections: [{ kind: 'model', ref: 'phi_guardrails' }] })).toBeNull();
    expect(frameReadMetadata(
      { ...read, records: [read.records[0], read.records[0]] },
      { ...input, selections: [selections[0], selections[0]] },
    )).toBeNull();
    expect(frameReadMetadata({ ...read, records: [{ ...read.records[0], version_source: 'body_digest' }] }, input)).toBeNull();
    expect(frameReadMetadata({ ...read, records: [{ ...read.records[0], applicability_scope_source: 'invented' }] }, input)).toBeNull();
  });

  it('catalogだけ、別turnにしかない本文、失敗した本文取得は完了できない', () => {
    expect(hasCompleteJudgmentFrame([catalogEvent, frameEvent()])).toBe(false);
    expect(hasCompleteJudgmentFrame([catalogEvent, { ...readEvent(), success: false }, frameEvent()])).toBe(false);
    expect(hasCompleteJudgmentFrame([readEvent(), frameEvent()])).toBe(false);
  });

  it('記録後の本文取得や新しいcatalogは過去の記録を充足しない', () => {
    expect(hasCompleteJudgmentFrame([catalogEvent, frameEvent(), readEvent()])).toBe(false);
    expect(hasCompleteJudgmentFrame([catalogEvent, readEvent(), frameEvent(), catalogEvent])).toBe(false);
  });

  it('全選択を採用案に適用する。別案だけの適用、不適用理由欠落は失敗する', () => {
    expect(hasCompleteJudgmentFrame([catalogEvent, readEvent(), frameEvent({
      ...input, options: [{ label: 'B', uses: input.options[0].uses }, { label: 'A', uses: [] }],
    })])).toBe(false);
    expect(frameApplicationMetadata(frame, { ...input, none: {} }).application_complete).toBe(false);
    expect(frameApplicationMetadata(frame, { ...input, options: {} }).application_complete).toBe(false);
    expect(frameApplicationMetadata(frame, { ...input, selections: [null] }).application_complete).toBe(false);
    expect(frameApplicationMetadata(frame, { ...input, options: [{ label: 'A', uses: [null] }] }).application_complete).toBe(false);
  });

  it('単純回答で三種類とも不適用ならcatalogと理由の記録を要求する', () => {
    const none = {
      ...input, selections: [],
      none: { philosophy: '判断を追加しない単純翻訳', objective: '同上', model: '同上' },
      options: [{ label: 'A', uses: [] }],
    };
    const event = {
      event_kind: 'frame', success: true,
      safe_metadata: { judgment_frame: { catalog_digest, ...frameApplicationMetadata({ ...frame, selections: [] }, none) } },
    };
    expect(hasCompleteJudgmentFrame([catalogEvent, event])).toBe(true);
    expect(hasCompleteJudgmentFrame([event])).toBe(false);
  });
});

describe('story-judgment-frame-evidence-common 会話内の一覧の使い回し', () => {
  it('ac:1 同じ会話で読んだ一覧と同じdigestなら、一覧を読み直さなくても完了にする', () => {
    const sessionCatalogDigests = [catalog_digest];
    expect(hasCompleteJudgmentFrame([readEvent(), frameEvent()], { sessionCatalogDigests })).toBe(true);
    // The body read and the application are still required on this turn.
    expect(hasCompleteJudgmentFrame([frameEvent()], { sessionCatalogDigests })).toBe(false);
    expect(hasCompleteJudgmentFrame([frameEvent(), readEvent()], { sessionCatalogDigests })).toBe(false);
    expect(hasCompleteJudgmentFrame([{ ...readEvent(), success: false }, frameEvent()], { sessionCatalogDigests })).toBe(false);
  });

  it('ac:2 会話で読んでいないdigestの記録は、一覧なしでは完了にしない', () => {
    expect(hasCompleteJudgmentFrame([readEvent(), frameEvent()], { sessionCatalogDigests: [`sha256:${'b'.repeat(64)}`] })).toBe(false);
    expect(hasCompleteJudgmentFrame([readEvent(), frameEvent()], { sessionCatalogDigests: [] })).toBe(false);
    expect(hasCompleteJudgmentFrame([readEvent(), frameEvent()])).toBe(false);
  });

  it('ac:3 このturnで一覧を読んだら、会話の過去のdigestではなくその一覧に合わせる', () => {
    const older = `sha256:${'b'.repeat(64)}`;
    const olderCatalog = {
      event_kind: 'frame_catalog', success: true, safe_metadata: { judgment_frame_catalog: { catalog_digest: older } },
    };
    expect(hasCompleteJudgmentFrame([olderCatalog, readEvent(), frameEvent()], { sessionCatalogDigests: [catalog_digest] })).toBe(false);
  });

  it('ac:4 同じ会話のほかのturnで成功した一覧取得のdigestだけを集める', () => {
    const directory = mkdtempSync(join(tmpdir(), 'frame-catalog-'));
    const write = (turn: string, name: string, event: unknown) => {
      mkdirSync(join(directory, `${turn}.events`), { recursive: true });
      writeFileSync(join(directory, `${turn}.events`, name), typeof event === 'string' ? event : JSON.stringify(event));
    };
    const other = `sha256:${'c'.repeat(64)}`;
    write('turn-1', 'a.json', catalogEvent);
    write('turn-1', 'b.json', readEvent());
    write('turn-2', 'a.json', { ...catalogEvent, success: false, safe_metadata: { judgment_frame_catalog: { catalog_digest: other } } });
    write('turn-2', 'b.json', '{broken');
    write('turn-3', 'a.json', { ...catalogEvent, safe_metadata: { judgment_frame_catalog: { catalog_digest: 'not-a-digest' } } });
    write('current', 'a.json', { ...catalogEvent, safe_metadata: { judgment_frame_catalog: { catalog_digest: other } } });
    expect(sessionFrameCatalogDigests(directory, join(directory, 'current.events'))).toEqual([catalog_digest]);
    expect(sessionFrameCatalogDigests(join(directory, 'missing'), join(directory, 'current.events'))).toEqual([]);
  });

  it('ac:5 公開packageのsubpathとして出す', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(packageJson.exports['./judgment-frame-evidence']).toEqual({
      types: './dist/judgment-frame-evidence.d.ts',
      import: './dist/judgment-frame-evidence.js',
    });
  });
});
