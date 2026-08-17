import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalEdgeId, validateCanonicalGraph } from '../src/canonical-graph.js';
import { resolveText, verifyResolutionReceipt } from '../src/entity-resolution.js';
import type { GraphFile, GraphFileV1, GraphFileV2 } from '../src/types.js';
import { canonicalResolutionGraph } from './canonical-resolution-fixture.js';

describe('story-brainbase-canonical-entity-resolution contract', () => {
  it('AC-1 validates typed ID edges while retaining Graph v1 read compatibility', () => {
    const legacy: GraphFileV1 = { version: 1, entities: [{ id: 'person-1', type: 'person', name: '田中' }] };
    const compatible: GraphFile = canonicalResolutionGraph;
    expect(compatible.version).toBe(2);
    expect(() => validateCanonicalGraph(legacy)).not.toThrow();
    expect(() => validateCanonicalGraph(canonicalResolutionGraph)).not.toThrow();

    const dangling = structuredClone(canonicalResolutionGraph);
    dangling.edges[0]!.toId = 'missing-project';
    expect(() => validateCanonicalGraph(dangling)).toThrow(/GRAPH-EDGE-ENDPOINT-EXISTS/);

    const wrongType = structuredClone(canonicalResolutionGraph);
    wrongType.edges[0]!.toId = 'decision-user-outcome';
    expect(() => validateCanonicalGraph(wrongType)).toThrow(/GRAPH-EDGE-ENDPOINT-TYPE/);

    const unstableId = structuredClone(canonicalResolutionGraph);
    unstableId.edges[0]!.id = 'edge-manual';
    expect(() => validateCanonicalGraph(unstableId)).toThrow(/GRAPH-EDGE-ID-STABLE/);

    const duplicateV1: GraphFileV1 = { version: 1, entities: [legacy.entities[0]!, legacy.entities[0]!] };
    expect(() => validateCanonicalGraph(duplicateV1)).toThrow(/GRAPH-ENTITY-ID-UNIQUE/);
    expect(() => validateCanonicalGraph({ version: 3, entities: [] } as never)).toThrow(/GRAPH-VERSION-SUPPORTED/);

    const nonRfc3339 = structuredClone(canonicalResolutionGraph);
    nonRfc3339.entities[0]!.validFrom = '2026-01-01';
    expect(() => validateCanonicalGraph(nonRfc3339)).toThrow(/GRAPH-VALIDITY-DATETIME/);

    const impossibleDate = structuredClone(canonicalResolutionGraph);
    impossibleDate.entities[0]!.validFrom = '2026-02-30T00:00:00.000Z';
    expect(() => validateCanonicalGraph(impossibleDate)).toThrow(/GRAPH-VALIDITY-DATETIME/);

    for (const malformed of [
      { ...structuredClone(canonicalResolutionGraph), ontology: undefined },
      { ...structuredClone(canonicalResolutionGraph), ontology: { id: 'other', version: '2.0.0', releaseDigest: 'digest' } },
      { ...structuredClone(canonicalResolutionGraph), ontology: { id: 'brainbase-personal-os', version: '', releaseDigest: 'digest' } },
      { ...structuredClone(canonicalResolutionGraph), entities: [{ id: '', type: 'person', name: '田中' }], edges: [] },
      { ...structuredClone(canonicalResolutionGraph), entities: [{ id: 'x', type: 'unknown', name: '田中' }], edges: [] }
    ]) {
      expect(() => validateCanonicalGraph(malformed)).toThrow();
    }

    for (const malformed of [
      { ...structuredClone(canonicalResolutionGraph), owner: '田中' },
      { ...structuredClone(canonicalResolutionGraph), entities: [{ id: 'x', type: 'person', name: '田中', tags: 'bad' }], edges: [] },
      { ...structuredClone(canonicalResolutionGraph), entities: [{ id: 'x', type: 'person', name: '田中', validFrom: null }], edges: [] },
      { ...structuredClone(canonicalResolutionGraph), edges: [{ ...canonicalResolutionGraph.edges[0]!, provenance: { sourceKind: 'unknown' } }] }
    ]) {
      expect(() => validateCanonicalGraph(malformed)).toThrow();
    }

    const delimiterA = canonicalEdgeId({ fromId: 'p', relation: 'member_of', toId: 'o|member_of|x' });
    const delimiterB = canonicalEdgeId({ fromId: 'p|member_of|o', relation: 'member_of', toId: 'x' });
    expect(delimiterA).not.toBe(delimiterB);
  });

  it('AC-5 resolves honorific aliases with exact UTF-16 spans and keeps ties ambiguous', () => {
    const text = '田中さんにAtlas導入の判断基準を確認する';
    const result = resolveText({
      text,
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    const tanaka = result.mentions.find((mention) => mention.surface === '田中さん');
    expect(tanaka).toMatchObject({ status: 'resolved', selectedEntityId: 'person-tanaka-atlas' });
    expect(text.slice(tanaka!.span.start, tanaka!.span.end)).toBe('田中さん');
    expect(result.mentions.find((mention) => mention.surface === 'Atlas導入'))
      .toMatchObject({ status: 'resolved', selectedEntityId: 'project-atlas' });
    expect(result.mentions.find((mention) => mention.surface === '判断基準'))
      .toMatchObject({ status: 'resolved', selectedEntityId: 'decision-user-outcome' });

    const ambiguous = resolveText({
      text: '田中さんに確認する',
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    expect(ambiguous.mentions[0]).toMatchObject({ status: 'ambiguous' });
    expect(ambiguous.mentions[0]).not.toHaveProperty('selectedEntityId');

    const normalized = resolveText({
      text: '  Ａｔｌａｓ   導入を確認する',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    const atlas = normalized.mentions.find((mention) => mention.selectedEntityId === 'project-atlas');
    expect(atlas?.surface).toBe('Ａｔｌａｓ   導入');
    expect(normalized.receipt.mentions.find((mention) => mention.selectedEntityId === 'project-atlas')?.span)
      .toEqual(atlas?.span);

    const unicode = resolveText({
      text: '🧠 前  Ａｔｌａｓ   導入を確認する',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    const unicodeAtlas = unicode.mentions.find((mention) => mention.selectedEntityId === 'project-atlas');
    expect(unicodeAtlas?.surface).toBe('Ａｔｌａｓ   導入');
    expect('🧠 前  Ａｔｌａｓ   導入を確認する'.slice(unicodeAtlas!.span.start, unicodeAtlas!.span.end)).toBe(unicodeAtlas!.surface);
  });

  it('AC-6 keeps source failure separate from semantic unresolved results', () => {
    const unavailable = resolveText({
      text: '存在しない人物',
      asOf: '2026-08-17T00:00:00.000Z',
      source: {
        authority: 'local_graph',
        status: 'unavailable',
        issues: [{ code: 'graph_unavailable', message: 'Graph could not be read' }]
      }
    });
    expect(unavailable.receipt).toMatchObject({ resolutionStatus: 'blocked', summary: null });
    expect(verifyResolutionReceipt(unavailable.receipt, {
      text: '存在しない人物',
      asOf: '2026-08-17T00:00:00.000Z',
      sourceStatus: 'unavailable',
      sourceIssueCodes: ['graph_unavailable']
    })).toBe(true);

    expect(() => resolveText({
      text: '田中さん',
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'invalid', graph: canonicalResolutionGraph }
    })).toThrow(/RESOLUTION-SOURCE-GRAPH-FORBIDDEN/);

    expect(() => resolveText({
      text: '田中さん',
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1' }
    })).toThrow(/RESOLUTION-SOURCE-GRAPH-REQUIRED/);

    const healthy = resolveText({
      text: '存在しない人物',
      mentionSpans: [{ start: 0, end: '存在しない人物'.length }],
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    expect(healthy.receipt).toMatchObject({ resolutionStatus: 'none', summary: { resolved: 0, unresolved: 1 } });
  });

  it('AC-6 preserves an explicitly requested unknown span inside a longer automatic match', () => {
    const result = resolveText({
      text: 'Atlas導入',
      mentionSpans: [{ start: 0, end: 2 }],
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });

    expect(result.mentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ span: { start: 0, end: 2 }, status: 'unresolved' }),
      expect.objectContaining({ span: { start: 0, end: 7 }, status: 'resolved', selectedEntityId: 'project-atlas' })
    ]));
    expect(result.receipt).toMatchObject({
      resolutionStatus: 'partial',
      summary: { resolved: 1, ambiguous: 0, unresolved: 1 }
    });
  });

  it('AC-5 applies strict project scope and as_of edge validity', () => {
    const beforeEdge = resolveText({
      text: '田中さん',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2025-12-31T23:59:59.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    expect(beforeEdge.mentions[0]).toMatchObject({ status: 'unresolved' });

    const active = resolveText({
      text: '田中さん',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    expect(active.mentions[0]).toMatchObject({ status: 'resolved', selectedEntityId: 'person-tanaka-atlas' });

    const decision = resolveText({
      text: '実測と利用者成果を分けて判断する',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    });
    expect(decision.mentions[0]).toMatchObject({ status: 'resolved', selectedEntityId: 'decision-user-outcome' });

    const expiredProjectGraph = structuredClone(canonicalResolutionGraph);
    expiredProjectGraph.entities.find((entity) => entity.id === 'project-atlas')!.validTo = '2026-08-01T00:00:00.000Z';
    const expiredProject = resolveText({
      text: '田中さん',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: expiredProjectGraph }
    });
    expect(expiredProject.mentions[0]).toMatchObject({ status: 'unresolved' });
  });

  it('AC-7 and AC-8 produce a deterministic, verifiable receipt independent of input ordering', () => {
    const reversed: GraphFileV2 = {
      ...canonicalResolutionGraph,
      entities: [...canonicalResolutionGraph.entities].reverse(),
      edges: [...canonicalResolutionGraph.edges].reverse()
    };
    const input = {
      text: '田中さんとAtlas導入',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' as const },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph' as const, status: 'complete' as const, revision: 'fixture-r1' }
    };
    const first = resolveText({ ...input, source: { ...input.source, graph: canonicalResolutionGraph } }).receipt;
    const second = resolveText({ ...input, source: { ...input.source, graph: reversed } }).receipt;
    expect(first.digest).toBe(second.digest);
    const expected = {
      text: input.text,
      asOf: input.asOf,
      sourceStatus: input.source.status,
      sourceRevision: input.source.revision,
      graph: canonicalResolutionGraph,
      projectScope: input.projectScope
    };
    expect(verifyResolutionReceipt(first, expected)).toBe(true);
    expect(verifyResolutionReceipt(first, { ...expected, text: '別の文章' })).toBe(false);
    expect(verifyResolutionReceipt({ ...first, resolutionStatus: 'partial' }, expected)).toBe(false);

    const alteredSpan = structuredClone(first);
    alteredSpan.mentions[0]!.span.start += 1;
    alteredSpan.digest = receiptDigest(alteredSpan);
    expect(verifyResolutionReceipt(alteredSpan, expected)).toBe(false);

    const alteredSummary = structuredClone(first);
    alteredSummary.summary!.resolved += 1;
    alteredSummary.digest = receiptDigest(alteredSummary);
    expect(verifyResolutionReceipt(alteredSummary, expected)).toBe(false);

    const alteredEvidence = structuredClone(first);
    alteredEvidence.mentions[0]!.candidates[0]!.evidence = [{ kind: 'valid_at', asOf: '1900-01-01T00:00:00.000Z' }];
    alteredEvidence.digest = receiptDigest(alteredEvidence);
    expect(verifyResolutionReceipt(alteredEvidence, expected)).toBe(false);
    expect(JSON.stringify(first)).not.toContain('田中さんとAtlas導入');
    expect(JSON.stringify(first)).not.toContain('田中さん');
  });

  it('AC-8 keeps the receipt digest stable when multiple scoped edges are reordered', () => {
    const graph = structuredClone(canonicalResolutionGraph);
    const extra = { ...graph.edges[0]!, id: '', relation: 'participates_in' as const };
    extra.id = canonicalEdgeId(extra);
    graph.edges.push(extra);
    const reversed = { ...graph, edges: [...graph.edges].reverse() };
    const input = {
      text: '田中さん',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' as const },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph' as const, status: 'complete' as const, revision: 'fixture-r1' }
    };
    expect(resolveText({ ...input, source: { ...input.source, graph } }).receipt.digest)
      .toBe(resolveText({ ...input, source: { ...input.source, graph: reversed } }).receipt.digest);
  });

  it('AC-5 rejects malformed runtime scope and entity filters before producing a Receipt', () => {
    const base = {
      text: '田中さん',
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'fixture-r1', graph: canonicalResolutionGraph }
    };
    expect(() => resolveText({ ...base, projectScope: { projectIds: [123], policy: 'strict' } } as never))
      .toThrow(/RESOLUTION-INPUT-PROJECT-SCOPE/);
    expect(() => resolveText({ ...base, projectScope: { projectIds: ['project-atlas'], policy: 'bogus' } } as never))
      .toThrow(/RESOLUTION-INPUT-SCOPE-POLICY/);
    expect(() => resolveText({ ...base, entityTypes: ['bogus'] } as never))
      .toThrow(/RESOLUTION-INPUT-ENTITY-TYPES/);
  });
});

function receiptDigest(receipt: { digest: string } & Record<string, unknown>): string {
  const { digest: _digest, ...payload } = receipt;
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}
