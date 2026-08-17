import { canonicalEdgeId } from '../src/canonical-graph.js';
import type { CanonicalEdge, GraphFileV2 } from '../src/types.js';

const edges: CanonicalEdge[] = [
  { id: '', fromId: 'person-tanaka-atlas', relation: 'accountable_for', toId: 'project-atlas', validFrom: '2026-01-01T00:00:00.000Z' },
  { id: '', fromId: 'person-tanaka-other', relation: 'accountable_for', toId: 'project-other', validFrom: '2026-01-01T00:00:00.000Z' },
  { id: '', fromId: 'decision-user-outcome', relation: 'governs', toId: 'project-atlas', validFrom: '2026-01-01T00:00:00.000Z' }
].map((edge) => ({ ...edge, id: canonicalEdgeId(edge) }));

export const canonicalResolutionGraph: GraphFileV2 = {
  version: 2,
  ontology: {
    id: 'brainbase-personal-os',
    version: '2.0.0',
    releaseDigest: 'fixture-ontology-digest'
  },
  entities: [
    { id: 'project-atlas', type: 'project', name: 'Atlas導入', aliases: ['Atlas', 'Atlas 導入'] },
    { id: 'project-other', type: 'project', name: '別案件' },
    { id: 'person-tanaka-atlas', type: 'person', name: '田中', aliases: ['田中太郎'] },
    { id: 'person-tanaka-other', type: 'person', name: '田中', aliases: ['田中次郎'] },
    { id: 'decision-user-outcome', type: 'decision', name: '実測と利用者成果を分けて判断する', aliases: ['判断基準'] }
  ],
  edges
};
