import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createFixturePersonalOs(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, 'sources'), { recursive: true });
  await writeFile(join(dataDir, 'graph.json'), `${JSON.stringify({
    version: 1,
    owner: {
      name: 'Owner',
      summary: 'Local-first AI operator'
    },
    entities: [
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
