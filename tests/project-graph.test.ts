import { describe, expect, it } from 'vitest';
import {
  computeProjectGraphLayout,
  createProjectGraphModel,
  normalizeProjectGraph,
  projectGraphEdgePresentation,
  projectGraphNeighborIds,
  projectGraphNodePresentation,
} from '../ui/project-graph.js';

describe('project graph projection', () => {
  it('drops malformed records and dangling endpoints without fabricating nodes', () => {
    const result = normalizeProjectGraph({
      nodes: [
        { id: 'project-a', type: 'project', label: 'Project A' },
        { id: 'person-a', type: 'person', label: 'Person A' },
        { id: 'project-a', type: 'project', label: 'duplicate' },
        { label: 'missing id' },
      ],
      edges: [
        { id: 'owns', source: 'person-a', target: 'project-a', label: 'owns' },
        { id: 'owns', source: 'person-a', target: 'project-a', label: 'also owns' },
        { id: 'dangling', source: 'person-a', target: 'not-in-snapshot' },
        { id: 'missing-target', source: 'person-a' },
      ],
    });

    expect(result.nodes.map((node) => node.id)).toEqual(['project-a', 'person-a']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['owns', 'owns~2']);
    expect(result.edges.every((edge) => result.nodes.some((node) => node.id === edge.source))).toBe(true);
    expect(result.edges.every((edge) => result.nodes.some((node) => node.id === edge.target))).toBe(true);
    expect(result.invalidNodeCount).toBe(2);
    expect(result.invalidEdgeCount).toBe(2);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'duplicate_node', id: 'project-a' }),
      expect.objectContaining({ kind: 'invalid_edge', reason: 'target_not_found' }),
    ]));
  });

  it('keeps parallel edges with stable keys', () => {
    const result = normalizeProjectGraph({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { id: 'same', source: 'a', target: 'b', label: 'first' },
        { id: 'same', source: 'a', target: 'b', label: 'second' },
        { source: 'a', target: 'b', label: 'third' },
      ],
    });

    expect(result.edges).toHaveLength(3);
    expect(result.edges.map((edge) => edge.id)).toEqual(['edge-3', 'same', 'same~2']);
    expect(new Set(result.edges.map((edge) => edge.id)).size).toBe(3);
  });

  it('produces deterministic clustered positions and anchors a selected node', () => {
    const input = {
      nodes: [
        { id: 'project', type: 'project', label: 'Project' },
        { id: 'decision', type: 'decision', label: 'Decision' },
        { id: 'person', type: 'person', label: 'Person' },
        { id: 'doc', type: 'document', label: 'Document' },
      ],
      edges: [
        { id: 'project-decision', source: 'project', target: 'decision', label: 'guides' },
        { id: 'person-project', source: 'person', target: 'project', label: 'owns' },
      ],
    };
    const first = createProjectGraphModel(input, { selectedId: 'project' });
    const second = createProjectGraphModel(input, { selectedId: 'project' });

    expect(first.nodes).toEqual(second.nodes);
    expect(first.nodes.find((node) => node.id === 'project')).toMatchObject({ x: 0, y: 0 });
    expect(projectGraphNeighborIds(first.nodes, first.edges, 'project')).toEqual(new Set(['decision', 'person']));
    for (const node of first.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('does not let invalid edges affect layout or neighbor emphasis', () => {
    const nodes = [
      { id: 'a', type: 'project', label: 'A' },
      { id: 'b', type: 'person', label: 'B' },
    ];
    const valid = [{ id: 'valid', source: 'a', target: 'b' }];
    const invalid = [...valid, { id: 'phantom', source: 'a', target: 'missing' }];

    expect(computeProjectGraphLayout(nodes, valid, { selectedId: 'a' }))
      .toEqual(computeProjectGraphLayout(nodes, invalid, { selectedId: 'a' }));
    expect(projectGraphNeighborIds(nodes, invalid, 'a')).toEqual(new Set(['b']));
  });

  it('keeps a dense selected neighborhood readable by forcing only the selected label', () => {
    const neighborIds = new Set(Array.from({ length: 105 }, (_, index) => `person-${index}`));
    const selected = projectGraphNodePresentation(
      { id: 'project', size: 40 },
      { selectedId: 'project', neighborIds },
    );
    const neighbor = projectGraphNodePresentation(
      { id: 'person-0', size: 40 },
      { selectedId: 'project', neighborIds },
    );
    const unrelated = projectGraphNodePresentation(
      { id: 'decision', size: 40 },
      { selectedId: 'project', neighborIds },
    );
    const relation = projectGraphEdgePresentation(
      { source: 'project', target: 'person-0', label: '担当' },
      { selectedId: 'project', neighborIds },
    );
    const sparseRelation = projectGraphEdgePresentation(
      { source: 'project', target: 'person-0', label: '担当' },
      { selectedId: 'project', neighborIds: new Set(['person-0']) },
    );

    expect(selected).toMatchObject({ state: 'selected', forceLabel: true, highlighted: true });
    expect(selected.size).toBeLessThanOrEqual(18);
    expect(neighbor).toMatchObject({ state: 'neighbor', forceLabel: false, highlighted: false });
    expect(neighbor.size).toBeLessThanOrEqual(12);
    expect(unrelated).toMatchObject({ state: 'unrelated', forceLabel: false, highlighted: false, label: null });
    expect(relation).toEqual({ relevant: true, showLabel: false, forceLabel: false });
    expect(sparseRelation).toEqual({ relevant: true, showLabel: true, forceLabel: false });

    const denseNodes = [
      { id: 'project', type: 'project', label: 'Project' },
      ...Array.from({ length: 105 }, (_, index) => ({
        id: `person-${index}`,
        type: 'person',
        label: `Person ${index}`,
      })),
    ];
    const denseEdges = denseNodes.slice(1).map((node, index) => ({
      id: `relation-${index}`,
      source: 'project',
      target: node.id,
    }));
    const denseLayout = computeProjectGraphLayout(denseNodes, denseEdges, { selectedId: 'project' });
    const neighborRadii = new Set(
      denseNodes.slice(1).map((node) => Math.round(Math.hypot(denseLayout[node.id].x, denseLayout[node.id].y) * 100) / 100),
    );
    expect(neighborRadii.size).toBeGreaterThan(1);
  });
});
