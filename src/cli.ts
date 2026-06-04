#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendDecisions, appendPersonalKg, initializePersonalOs, loadPersonalOs, saveGraph, saveRelationships } from './ssot.js';
import { resolveDataDir } from './paths.js';
import { onboardingStatus } from './tools.js';
import { parseOnboardingFormat, renderAgentProtocol, renderConnectorRecommendations } from './onboarding.js';
import type { DecisionRecord, GraphEntity, PersonalKgEntry, RelationshipRecord } from './types.js';

interface CliIo {
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
}

interface ParsedArgs {
  command?: string;
  values: Map<string, string[]>;
  flags: Set<string>;
}

type InstallTarget = 'codex' | 'claude' | 'codecode';

export async function runCli(argv = process.argv.slice(2), io: CliIo = process): Promise<number> {
  const parsed = parseArgs(argv);

  try {
    switch (parsed.command) {
      case 'onboard:init':
        return await onboardInit(parsed, io);
      case 'onboard:seed':
        return await onboardSeed(parsed, io);
      case 'onboard:install':
        return await onboardInstall(parsed, io);
      case 'onboard:agent':
        return await onboardAgent(parsed, io);
      case 'onboard:recommend':
        return await onboardRecommend(parsed, io);
      case 'doctor':
        return await doctor(parsed, io);
      case 'mcp':
        await import('./index.js');
        return 0;
      default:
        write(io, usage());
        return parsed.flags.has('help') || !parsed.command ? 0 : 1;
    }
  } catch (error) {
    writeError(io, `${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function onboardInit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  write(io, `Initialized Brainbase Personal OS at ${dataDir}\n`);
  return 0;
}

async function onboardSeed(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const os = await loadPersonalOs(dataDir);
  const now = new Date().toISOString();
  const name = first(parsed, 'name');
  const personalEntries: PersonalKgEntry[] = [];
  const decisions: DecisionRecord[] = [];
  const relationships: RelationshipRecord[] = [...os.relationships.relationships];
  const graphEntities: GraphEntity[] = [...os.graph.entities];

  if (name) {
    os.graph.owner = { ...os.graph.owner, name };
    upsertGraphEntity(graphEntities, {
      id: 'self',
      type: 'person',
      name,
      summary: 'Owner of this local Brainbase Personal OS.',
      tags: ['self']
    });
    personalEntries.push({
      id: `self-${Date.now()}`,
      type: 'self',
      text: `I am ${name}.`,
      tags: ['self'],
      updatedAt: now
    });
  }

  for (const value of parsed.values.get('value') ?? []) {
    personalEntries.push({
      id: `value-${hash(value)}`,
      type: 'value',
      text: value,
      tags: ['onboarding'],
      updatedAt: now
    });
  }

  for (const project of parsed.values.get('project') ?? []) {
    upsertGraphEntity(graphEntities, {
      id: `project-${hash(project)}`,
      type: 'project',
      name: project,
      summary: 'Seeded during Brainbase onboarding.',
      tags: ['work']
    });
    personalEntries.push({
      id: `work-${hash(project)}`,
      type: 'work',
      text: project,
      tags: ['work'],
      updatedAt: now
    });
  }

  for (const value of parsed.values.get('decision-principle') ?? []) {
    decisions.push({
      id: `decision-${hash(value)}`,
      title: 'Seeded decision principle',
      decision: value,
      tags: ['principle', 'onboarding'],
      updatedAt: now
    });
  }

  for (const encoded of parsed.values.get('relationship') ?? []) {
    const [person, role, context] = encoded.split('|').map((part) => part.trim());
    if (!person || !context) {
      throw new Error('relationship must be "person|role|context" or "person||context"');
    }
    relationships.push({
      id: `relationship-${hash(encoded)}`,
      person,
      role: role || undefined,
      context,
      tags: ['relationship'],
      updatedAt: now
    });
    upsertGraphEntity(graphEntities, {
      id: `person-${hash(person)}`,
      type: 'person',
      name: person,
      summary: context,
      tags: ['relationship']
    });
  }

  if (!parsed.flags.has('non-interactive') && personalEntries.length === 0 && decisions.length === 0 && relationships.length === os.relationships.relationships.length) {
    write(io, 'No seed values provided. Use --name, --value, --project, --decision-principle, or --relationship.\n');
    return 1;
  }

  await saveGraph(dataDir, { ...os.graph, entities: graphEntities });
  await saveRelationships(dataDir, { version: 1, relationships });
  await appendPersonalKg(dataDir, personalEntries);
  await appendDecisions(dataDir, decisions);
  write(io, `Seeded Brainbase Personal OS at ${dataDir}\n`);
  return 0;
}

async function onboardInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = first(parsed, 'target');
  if (!isInstallTarget(target)) {
    throw new Error('onboard:install requires --target codex|claude|codecode');
  }

  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const payload = buildInstallPayload(target, dataDir);
  const outputPath = first(parsed, 'output');

  if (parsed.flags.has('dry-run') || !outputPath) {
    write(io, payload);
    return 0;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeConfigSnippet(outputPath, payload);
  write(io, `Wrote ${target} MCP config to ${outputPath}\n`);
  return 0;
}

async function onboardAgent(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  write(io, renderAgentProtocol(format));
  return 0;
}

async function onboardRecommend(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  write(io, renderConnectorRecommendations({
    email: first(parsed, 'email'),
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    tasks: first(parsed, 'tasks')
  }, format));
  return 0;
}

function isInstallTarget(value: string | undefined): value is InstallTarget {
  return value === 'codex' || value === 'claude' || value === 'codecode';
}

function buildInstallPayload(target: InstallTarget, dataDir: string): string {
  const server = {
    command: process.execPath,
    args: [fileURLToPath(new URL('./index.js', import.meta.url))],
    env: {
      BRAINBASE_PERSONAL_OS_DIR: dataDir
    }
  };

  if (target === 'codex') {
    return [
      '[mcp_servers.brainbase]',
      `command = ${tomlString(server.command)}`,
      `args = [${server.args.map(tomlString).join(', ')}]`,
      '',
      '[mcp_servers.brainbase.env]',
      `BRAINBASE_PERSONAL_OS_DIR = ${tomlString(dataDir)}`,
      ''
    ].join('\n');
  }

  return `${JSON.stringify({ mcpServers: { brainbase: server } }, null, 2)}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function writeConfigSnippet(outputPath: string, payload: string): Promise<void> {
  try {
    await writeFile(outputPath, payload, { flag: 'wx' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing MCP config snippet ${outputPath}. Choose a new --output path or remove the old snippet first.`);
    }
    throw error;
  }
}

async function doctor(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const os = await loadPersonalOs(dataDir);
  write(io, `${JSON.stringify(onboardingStatus(os), null, 2)}\n`);
  return 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const values = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    values.set(key, [...(values.get(key) ?? []), next]);
    index += 1;
  }

  return {
    command,
    values,
    flags
  };
}

function first(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.values.get(key)?.[0];
}

function upsertGraphEntity(entities: GraphEntity[], entity: GraphEntity): void {
  const index = entities.findIndex((candidate) => candidate.id === entity.id);
  if (index >= 0) {
    entities[index] = entity;
  } else {
    entities.push(entity);
  }
}

function hash(value: string): string {
  let hashValue = 0;
  for (const char of value) {
    hashValue = ((hashValue << 5) - hashValue + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hashValue).toString(36);
}

function write(io: CliIo, text: string): void {
  io.stdout?.write(text);
}

function writeError(io: CliIo, text: string): void {
  io.stderr?.write(text);
}

function usage(): string {
  return `Usage:
  brainbase-mcp
  brainbase mcp
  brainbase onboard:init [--dir path]
  brainbase onboard:seed [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--relationship "person|role|context"]
  brainbase onboard:install --target codex|claude|codecode [--dir path] [--dry-run] [--output path]
  brainbase onboard:agent [--format markdown|json]
  brainbase onboard:recommend [--email value] [--calendar value] [--drive value] [--tasks value] [--format markdown|json]
  brainbase doctor [--dir path]
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runCli();
  process.exit(code);
}
