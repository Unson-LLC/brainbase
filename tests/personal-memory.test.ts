import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JudgmentHistoryRecord, JudgmentHistorySource, JudgmentHistorySourceSnapshot } from '../src/judgment-history.js';
import {
  createPersonalMemoryJudgmentIndex,
  personalMemoryFromEntry,
  readLocalPersonalMemories
} from '../src/personal-memory.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-personal-memory-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('readLocalPersonalMemories', () => {
  it('maps a personal-kg.jsonl entry as the spec table says, newest update first', async () => {
    await writeFile(join(directory, 'personal-kg.jsonl'), [
      JSON.stringify({ id: 'value-a1', type: 'value', text: '可逆な決定は早く決める', tags: ['value'], updatedAt: '2026-10-01T00:00:00.000Z' }),
      JSON.stringify({ id: 'work-b2', type: 'work', text: '週次の振り返りは土曜に回す', updatedAt: '2026-10-05T00:00:00.000Z' }),
      JSON.stringify({ id: 'self-c3', type: 'self', text: '更新日の無い記憶' })
    ].join('\n'));

    const result = await readLocalPersonalMemories(directory);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.items.map((item) => item.id)).toEqual(['work-b2', 'value-a1', 'self-c3']);
    expect(result.items[1]).toEqual({
      id: 'value-a1',
      kind: 'value',
      text: '可逆な決定は早く決める',
      tags: ['value'],
      state: 'unrecorded',
      supersededBy: null,
      origin: { organizationLabel: '手元', projectLabel: null, workplace: null, inferred: false },
      occurredAt: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
      recallScope: 'general',
      history: []
    });
    expect(result.items[0].tags).toEqual([]);
  });

  it('reports an empty file as zero memories, confirmed', async () => {
    await writeFile(join(directory, 'personal-kg.jsonl'), '');
    expect(await readLocalPersonalMemories(directory)).toEqual({ status: 'ok', items: [] });
  });

  it('reports a missing or malformed file as unavailable, never as zero', async () => {
    expect(await readLocalPersonalMemories(directory)).toEqual({ status: 'unavailable', reason: 'personal_kg_missing' });
    await writeFile(join(directory, 'personal-kg.jsonl'), '{"id":"x","type":"self"}\n');
    expect(await readLocalPersonalMemories(directory)).toEqual({ status: 'unavailable', reason: 'personal_kg_invalid' });
  });

  it('never states a memory without a state record as active', () => {
    expect(personalMemoryFromEntry({ id: 'a', type: 'judgment', text: 't' }).state).toBe('unrecorded');
  });
});

function record(id: string, at: string, refs: string[], summary: string | null = `判断 ${id}`): JudgmentHistoryRecord {
  return {
    schema_version: 'brainbase-judgment-history-record-v1',
    record_id: id,
    entrypoint: 'codex',
    recorded_at: at,
    project_code: 'brainbase',
    turn_ref: `turn-${id}`,
    judgment: {
      status: 'resolved',
      summary,
      reason: null,
      selected_references: [
        { ref: 'phi_x', kind: 'philosophy', version: null, digest: null, why: null, usage: null, availability: 'recorded' },
        ...refs.map((ref) => ({ ref, kind: 'personal_knowledge', version: null, digest: null, why: null, usage: 'applied', availability: 'unknown' as const }))
      ],
      alternatives: null
    },
    execution: { status: 'completed', result_summary: null, outcome_status: 'unknown' },
    missing_fields: []
  };
}

function source(snapshot: Partial<JudgmentHistorySourceSnapshot>): JudgmentHistorySource {
  return {
    storage: 'local',
    read: async () => ({
      status: 'available',
      records: [],
      coverage: { complete: true, storage: 'local', reason: null, sources: [], total: null },
      ...snapshot
    })
  };
}

describe('createPersonalMemoryJudgmentIndex', () => {
  const memoryIds = ['value-a1', 'work-b2'];

  it('finds the judgments that used a memory, newest first, by its id', async () => {
    const index = createPersonalMemoryJudgmentIndex({
      source: source({ records: [
        record('r1', '2026-10-01T00:00:00.000Z', ['value-a1']),
        record('r2', '2026-10-03T00:00:00.000Z', ['value-a1', 'work-b2']),
        record('r3', '2026-10-02T00:00:00.000Z', []),
        record('r4', '2026-10-04T00:00:00.000Z', ['value-a1'], null)
      ] }),
      memoryIds: async () => memoryIds
    });

    const used = await index.judgmentsUsing('value-a1', 2);
    expect(used).toEqual({
      status: 'ok',
      total: 3,
      items: [
        { decisionId: 'r4', title: null, at: '2026-10-04T00:00:00.000Z', kind: null },
        { decisionId: 'r2', title: '判断 r2', at: '2026-10-03T00:00:00.000Z', kind: null }
      ]
    });
    expect(await index.counts()).toEqual({ status: 'ok', counts: { 'value-a1': 3, 'work-b2': 1 } });
    expect(await index.judgmentsUsing('work-b2', 5)).toMatchObject({ status: 'ok', total: 1 });
  });

  it('says a memory was not used yet only when the references belong to these memories', async () => {
    const index = createPersonalMemoryJudgmentIndex({
      source: source({ records: [record('r1', '2026-10-01T00:00:00.000Z', ['value-a1'])] }),
      memoryIds: async () => memoryIds
    });
    expect(await index.judgmentsUsing('work-b2', 5)).toEqual({ status: 'ok', total: 0, items: [] });
  });

  it('cannot confirm when the recorded references name memories kept somewhere else', async () => {
    const index = createPersonalMemoryJudgmentIndex({
      source: source({ records: [record('r1', '2026-10-01T00:00:00.000Z', ['adopt_sato_world_model_20260928_wm_007_v1'])] }),
      memoryIds: async () => memoryIds
    });
    expect(await index.judgmentsUsing('value-a1', 5)).toEqual({ status: 'unavailable', reason: 'reference_source_mismatch' });
    expect(await index.counts()).toEqual({ status: 'unavailable', reason: 'reference_source_mismatch' });
  });

  it('cannot confirm when the judgment journal is unreadable or only partly read', async () => {
    for (const status of ['unavailable', 'partial'] as const) {
      const index = createPersonalMemoryJudgmentIndex({
        source: source({ status, records: status === 'partial' ? [record('r1', '2026-10-01T00:00:00.000Z', ['value-a1'])] : null }),
        memoryIds: async () => memoryIds
      });
      expect(await index.judgmentsUsing('value-a1', 5)).toEqual({ status: 'unavailable', reason: `journal_${status}` });
    }
  });

  it('reads the journal once for requests made together, and again after the reuse window', async () => {
    let clock = 0;
    const base = source({ records: [record('r1', '2026-10-01T00:00:00.000Z', ['value-a1'])] });
    let reads = 0;
    const counted: JudgmentHistorySource = { storage: 'local', read: async () => { reads += 1; return base.read(); } };
    const index = createPersonalMemoryJudgmentIndex({ source: counted, memoryIds: async () => memoryIds, reuseMs: 1000, now: () => clock });
    await Promise.all([index.counts(), index.judgmentsUsing('value-a1', 5)]);
    expect(reads).toBe(1);
    clock = 1500;
    await index.counts();
    expect(reads).toBe(2);
  });

  it('cannot confirm when the memories themselves cannot be read', async () => {
    const index = createPersonalMemoryJudgmentIndex({
      source: source({ records: [] }),
      memoryIds: async () => null
    });
    expect(await index.counts()).toEqual({ status: 'unavailable', reason: 'personal_kg_unavailable' });
  });
});
