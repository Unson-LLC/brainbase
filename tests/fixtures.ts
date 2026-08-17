import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalEdgeId } from '../src/canonical-graph.js';

const participation = {
  fromId: 'person-otawara',
  relation: 'participates_in' as const,
  toId: 'project-personal-os'
};
const governance = {
  fromId: 'decision-local-only',
  relation: 'governs' as const,
  toId: 'project-personal-os'
};

export async function createFixturePersonalOs(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, 'sources'), { recursive: true });
  await writeFile(join(dataDir, 'graph.json'), `${JSON.stringify({
    version: 2,
    ontology: {
      id: 'brainbase-personal-os',
      version: '1.0.0',
      releaseDigest: 'fixture-ontology-digest'
    },
    owner: {
      id: 'person-owner',
      name: 'Owner',
      summary: 'Local-first AI operator'
    },
    entities: [
      {
        id: 'person-owner',
        type: 'person',
        name: 'Owner',
        summary: 'Local-first AI operator',
        tags: ['self']
      },
      {
        id: 'person-otawara',
        type: 'person',
        name: 'Otawara',
        summary: 'External collaborator evaluating local Brainbase MCP',
        tags: ['partner']
      },
      {
        id: 'project-personal-os',
        type: 'project',
        name: 'Personal OS',
        summary: 'Local SSOT exposed through MCP',
        tags: ['work']
      },
      {
        id: 'decision-local-only',
        type: 'decision',
        name: 'v1 backend scope',
        summary: 'Use local personal SSOT only for v1.',
        tags: ['scope']
      }
    ],
    edges: [
      {
        id: canonicalEdgeId(participation),
        ...participation,
        role: 'partner',
        context: 'Needs local MCP access from Codex and Claude',
        provenance: { sourceKind: 'import', sourceId: 'relationship-otawara' }
      },
      {
        id: canonicalEdgeId(governance),
        ...governance,
        context: 'Use local personal SSOT only for v1.',
        provenance: { sourceKind: 'import', sourceId: 'decision-local-only' }
      }
    ]
  }, null, 2)}\n`);
  await writeFile(join(dataDir, 'relationships.json'), `${JSON.stringify({
    version: 1,
    relationships: [
      {
        id: 'relationship-otawara',
        person: 'Otawara',
        role: 'partner',
        context: 'Needs local MCP access from Codex and Claude',
        tags: ['partner']
      }
    ]
  }, null, 2)}\n`);
  await writeFile(join(dataDir, 'personal-kg.jsonl'), [
    JSON.stringify({
      id: 'self-1',
      type: 'self',
      text: 'I prefer local canonical facts over remote server assumptions.',
      tags: ['self']
    }),
    JSON.stringify({
      id: 'work-1',
      type: 'work',
      text: 'Brainbase v1 should provide local MCP context without UI.',
      tags: ['mcp']
    }),
    JSON.stringify({
      id: 'judgment-1',
      type: 'judgment',
      text: 'Raw meeting notes are secondary materials; canonical Personal KG wins.',
      tags: ['ssot']
    }),
    JSON.stringify({
      id: 'sns-context-1',
      type: 'sns_context',
      text: 'Persona Brain / Peer Circle / Own Proof is the content design center for trusted SNS operation.',
      tags: ['Persona Brain', 'Peer Circle', 'Own Proof']
    })
  ].join('\n') + '\n');
  await writeFile(join(dataDir, 'decisions.jsonl'), `${JSON.stringify({
    id: 'decision-local-only',
    title: 'v1 backend scope',
    decision: 'Use local personal SSOT only for v1.',
    rationale: 'Hosted backend and secrets are unnecessary for personal onboarding.',
    tags: ['scope']
  })}\n`);
  await writeFile(join(dataDir, 'sources', 'meeting-note.txt'), 'Remote hosted server should be preferred.\n');
}
