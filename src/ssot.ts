import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { emptyGraph, emptyRelationships, schemaTemplates } from './templates.js';
import type { DecisionRecord, GraphFile, PersonalKgEntry, PersonalOs, RelationshipsFile } from './types.js';

const graphEntitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['person', 'org', 'project', 'relationship']),
  name: z.string().min(1),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional()
});

const graphSchema: z.ZodType<GraphFile> = z.object({
  version: z.literal(1),
  owner: z.object({
    name: z.string().optional(),
    summary: z.string().optional()
  }).optional(),
  entities: z.array(graphEntitySchema)
});

const personalKgSchema: z.ZodType<PersonalKgEntry> = z.object({
  id: z.string().min(1),
  type: z.enum(['self', 'work', 'relationship', 'value', 'judgment', 'experience', 'sns_context']),
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  updatedAt: z.string().optional()
});

const relationshipSchema = z.object({
  id: z.string().min(1),
  person: z.string().min(1),
  role: z.string().optional(),
  context: z.string().min(1),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional()
});

const relationshipsSchema: z.ZodType<RelationshipsFile> = z.object({
  version: z.literal(1),
  relationships: z.array(relationshipSchema)
});

const decisionSchema: z.ZodType<DecisionRecord> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().optional(),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional()
});

export async function initializePersonalOs(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(dataDir, 'sources'), { recursive: true });
  await mkdir(join(dataDir, 'sources', 'gmail'), { recursive: true });
  await mkdir(join(dataDir, 'sources', 'calendar'), { recursive: true });
  await mkdir(join(dataDir, 'sources', 'drive'), { recursive: true });
  await mkdir(join(dataDir, 'sources', 'tasks'), { recursive: true });
  await mkdir(join(dataDir, 'candidates'), { recursive: true });
  await mkdir(join(dataDir, 'schemas'), { recursive: true });
  await writeJsonIfMissing(join(dataDir, 'graph.json'), emptyGraph);
  await writeJsonIfMissing(join(dataDir, 'relationships.json'), emptyRelationships);
  await writeTextIfMissing(join(dataDir, 'personal-kg.jsonl'), '');
  await writeTextIfMissing(join(dataDir, 'decisions.jsonl'), '');

  for (const [fileName, schema] of Object.entries(schemaTemplates)) {
    await writeJsonIfMissing(join(dataDir, 'schemas', fileName), schema);
  }
}

export async function loadPersonalOs(dataDir: string): Promise<PersonalOs> {
  const graph = graphSchema.parse(await readJson(join(dataDir, 'graph.json')));
  const relationships = relationshipsSchema.parse(await readJson(join(dataDir, 'relationships.json')));
  const personalKg = await readJsonl(join(dataDir, 'personal-kg.jsonl'), personalKgSchema, 'personal-kg.jsonl');
  const decisions = await readJsonl(join(dataDir, 'decisions.jsonl'), decisionSchema, 'decisions.jsonl');
  const sourceCount = await countSources(dataDir);

  return {
    dataDir,
    graph,
    personalKg,
    relationships,
    decisions,
    sourceCount
  };
}

export async function saveGraph(dataDir: string, graph: GraphFile): Promise<void> {
  graphSchema.parse(graph);
  await writeFile(join(dataDir, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
}

export async function saveRelationships(dataDir: string, relationships: RelationshipsFile): Promise<void> {
  relationshipsSchema.parse(relationships);
  await writeFile(join(dataDir, 'relationships.json'), `${JSON.stringify(relationships, null, 2)}\n`);
}

export async function appendPersonalKg(dataDir: string, entries: PersonalKgEntry[]): Promise<void> {
  for (const entry of entries) {
    personalKgSchema.parse(entry);
  }
  if (entries.length === 0) {
    return;
  }
  await writeFile(
    join(dataDir, 'personal-kg.jsonl'),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    { flag: 'a' }
  );
}

export async function appendDecisions(dataDir: string, decisions: DecisionRecord[]): Promise<void> {
  for (const decision of decisions) {
    decisionSchema.parse(decision);
  }
  if (decisions.length === 0) {
    return;
  }
  await writeFile(
    join(dataDir, 'decisions.jsonl'),
    `${decisions.map((decision) => JSON.stringify(decision)).join('\n')}\n`,
    { flag: 'a' }
  );
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read canonical SSOT file ${filePath}: ${formatError(error)}`);
  }
}

async function readJsonl<T>(filePath: string, schema: z.ZodType<T>, label: string): Promise<T[]> {
  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read canonical SSOT file ${filePath}: ${formatError(error)}`);
  }

  const rows = content.split('\n').map((line) => line.trim()).filter(Boolean);
  return rows.map((line, index) => {
    try {
      return schema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid ${label} line ${index + 1}: ${formatError(error)}`);
    }
  });
}

async function countSources(dataDir: string): Promise<number> {
  return countSourceFiles(join(dataDir, 'sources'));
}

async function countSourceFiles(sourceDir: string): Promise<number> {
  try {
    const entries = await readdir(sourceDir);
    const counts = await Promise.all(entries.filter((entry) => !entry.startsWith('.')).map(async (entry) => {
      const entryPath = join(sourceDir, entry);
      const entryStat = await stat(entryPath);
      if (entryStat.isDirectory()) {
        return countSourceFiles(entryPath);
      }
      return entryStat.isFile() ? 1 : 0;
    }));
    return counts.reduce((sum, count) => sum + count, 0);
  } catch {
    return 0;
  }
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  });
}

async function writeTextIfMissing(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, value, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
