#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendDecisions, appendPersonalKg, initializePersonalOs, loadPersonalOs, saveGraph, saveRelationships } from './ssot.js';
import { resolveDataDir } from './paths.js';
import { onboardingStatus } from './tools.js';
import { buildCandidateDrafts, parseOnboardingFormat, renderAgentProtocol, renderCandidateDrafts, renderConnectorRecommendations, renderLocalOnboardingPlan, renderSourceDiagnosis } from './onboarding.js';
import {
  buildExtractedCandidateSet,
  extractCandidates,
  loadApplyCandidates,
  normalizeSource,
  parseProvider,
  planApply,
  renderSourceJsonl,
  sourcePathFor,
  type ApplyResult,
  type ExtractedCandidateSet,
  type SourceRecord
} from './import-extract.js';
import {
  buildClaudeScheduledTasks,
  buildRoutines,
  parseRoutineKinds,
  parseRoutineTarget,
  renderCodexAutomations,
  type RoutineDefinition
} from './routines.js';
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
      case 'onboard:diagnose-sources':
        return await onboardDiagnoseSources(parsed, io);
      case 'onboard:plan':
        return await onboardPlan(parsed, io);
      case 'onboard:candidates':
        return await onboardCandidates(parsed, io);
      case 'onboard:import':
        return await onboardImport(parsed, io);
      case 'onboard:extract':
        return await onboardExtract(parsed, io);
      case 'onboard:apply':
        return await onboardApply(parsed, io);
      case 'onboard:routines':
        return await onboardRoutines(parsed, io);
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

async function onboardDiagnoseSources(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const gogCommand = first(parsed, 'gog-command') ?? 'gog';
  const gogAvailable = parsed.flags.has('assume-gog') || await commandExists(gogCommand);
  write(io, renderSourceDiagnosis({
    dataDir,
    email: first(parsed, 'email'),
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    tasks: first(parsed, 'tasks'),
    gogCommand,
    gogAvailable,
    driveFolders: parsed.values.get('drive-folder') ?? []
  }, format));
  return 0;
}

async function onboardPlan(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  write(io, renderLocalOnboardingPlan({
    profile: first(parsed, 'profile'),
    host: first(parsed, 'host'),
    email: first(parsed, 'email'),
    secondaryEmails: parsed.values.get('secondary-email') ?? [],
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    driveFolders: parsed.values.get('drive-folder') ?? [],
    localFolders: parsed.values.get('local-folder') ?? [],
    tasks: first(parsed, 'tasks'),
    inactiveTaskTools: parsed.values.get('inactive-task-tool') ?? []
  }, format));
  return 0;
}

async function onboardCandidates(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const input = {
    dataDir,
    name: first(parsed, 'name'),
    values: parsed.values.get('value') ?? [],
    projects: parsed.values.get('project') ?? [],
    relationships: parsed.values.get('relationship') ?? [],
    decisionPrinciples: parsed.values.get('decision-principle') ?? [],
    now: new Date().toISOString()
  };
  const candidateSet = buildCandidateDrafts(input);
  if (candidateSet.candidates.length === 0 && !parsed.flags.has('non-interactive')) {
    write(io, 'No candidate values provided. Use --name, --value, --project, --decision-principle, or --relationship.\n');
    return 1;
  }
  if (parsed.flags.has('write')) {
    await mkdir(dirname(candidateSet.candidatePath), { recursive: true });
    await writeFile(candidateSet.candidatePath, `${JSON.stringify(candidateSet, null, 2)}\n`, { flag: 'wx' });
  }
  write(io, renderCandidateDrafts(input, format));
  if (parsed.flags.has('write')) {
    write(io, format === 'json' ? '' : `Wrote candidate file: ${candidateSet.candidatePath}\n`);
  }
  return 0;
}

async function onboardImport(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const provider = parseProvider(first(parsed, 'source'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const fromPath = first(parsed, 'from');
  if (!fromPath) {
    throw new Error('onboard:import requires --from <file|-> with collected provider JSON.');
  }
  const rawText = await readInput(fromPath, io);
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`onboard:import expected JSON from ${fromPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const records = normalizeSource(provider, raw, { includeDescriptions: parsed.flags.has('include-descriptions') });
  const relativePath = first(parsed, 'out') ?? sourcePathFor(provider);
  const outPath = isAbsolute(relativePath) ? relativePath : join(dataDir, relativePath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderSourceJsonl(records));

  if (format === 'json') {
    write(io, `${JSON.stringify({ provider, sourcePath: outPath, count: records.length }, null, 2)}\n`);
  } else {
    write(io, `Imported ${records.length} ${provider} record(s) (metadata-first) to ${outPath}\n`);
  }
  return 0;
}

async function onboardExtract(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const records = await readSourceRecords(dataDir);
  const candidates = extractCandidates(records, {
    selfEmails: parsed.values.get('self-email') ?? [],
    topRelationships: numberOption(first(parsed, 'top-relationships'))
  });
  const candidateSet = buildExtractedCandidateSet(candidates, dataDir);

  if (records.length === 0) {
    write(io, format === 'json'
      ? `${JSON.stringify(candidateSet, null, 2)}\n`
      : 'No source records found. Run onboard:import first.\n');
    return records.length === 0 && !parsed.flags.has('write') ? 1 : 0;
  }

  if (parsed.flags.has('write')) {
    await mkdir(dirname(candidateSet.candidatePath), { recursive: true });
    await writeFile(candidateSet.candidatePath, `${JSON.stringify(candidateSet, null, 2)}\n`);
  }

  write(io, format === 'json' ? `${JSON.stringify(candidateSet, null, 2)}\n` : renderExtractedSet(candidateSet));
  if (parsed.flags.has('write') && format !== 'json') {
    write(io, `Wrote extracted candidate file: ${candidateSet.candidatePath}\n`);
  }
  return 0;
}

async function onboardApply(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const fromPath = first(parsed, 'from');
  if (!fromPath) {
    throw new Error('onboard:apply requires --from <candidate-file>.');
  }
  const raw = JSON.parse(await readInput(fromPath, io));
  const candidates = loadApplyCandidates(raw);
  const selectedIds = new Set(parsed.values.get('select') ?? []);
  const all = parsed.flags.has('all');
  if (!all && selectedIds.size === 0) {
    throw new Error('onboard:apply requires --select <id> (repeatable) or --all to choose which candidates to promote.');
  }

  const os = await loadPersonalOs(dataDir);
  const now = new Date().toISOString();
  const result = planApply(candidates, { ids: selectedIds, all }, {
    graphEntities: [...os.graph.entities],
    relationships: [...os.relationships.relationships],
    personalKg: os.personalKg,
    decisions: os.decisions,
    ownerName: os.graph.owner?.name
  }, now);

  const willWrite = parsed.flags.has('write');
  if (willWrite) {
    await saveGraph(dataDir, { ...os.graph, owner: result.ownerName ? { ...os.graph.owner, name: result.ownerName } : os.graph.owner, entities: result.graphEntities });
    await saveRelationships(dataDir, { version: 1, relationships: result.relationships });
    await appendPersonalKg(dataDir, result.personalKgAdditions);
    await appendDecisions(dataDir, result.decisionAdditions);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ applied: result.applied, skipped: result.skipped, canonicalWrites: willWrite, dataDir }, null, 2)}\n`);
  } else {
    write(io, renderApplyResult(result, willWrite, dataDir));
  }
  return 0;
}

async function readInput(fromPath: string, io: CliIo): Promise<string> {
  if (fromPath === '-') {
    return readStdin();
  }
  return readFile(fromPath, 'utf8');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readSourceRecords(dataDir: string): Promise<SourceRecord[]> {
  const relativePaths = ['sources/gmail/threads.jsonl', 'sources/calendar/events.jsonl', 'sources/drive/files.jsonl', 'sources/drive/local-files.jsonl'];
  const records: SourceRecord[] = [];
  for (const relativePath of relativePaths) {
    let content = '';
    try {
      content = await readFile(join(dataDir, relativePath), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n').map((row) => row.trim()).filter(Boolean)) {
      try {
        records.push(JSON.parse(line) as SourceRecord);
      } catch {
        // Skip malformed source lines; sources are secondary material.
      }
    }
  }
  return records;
}

function renderExtractedSet(set: ExtractedCandidateSet): string {
  const lines: string[] = ['# Brainbase Extracted Candidates', '', set.goal, ''];
  lines.push(`- Candidate path: \`${set.candidatePath}\``);
  lines.push(`- Counts: person ${set.counts.person}, org ${set.counts.org}, project ${set.counts.project}, relationship ${set.counts.relationship}, next_action ${set.counts.next_action}`);
  lines.push('', '## Candidates');
  for (const candidate of set.candidates) {
    const label = candidate.payload.name ?? candidate.payload.person ?? candidate.payload.text ?? candidate.id;
    lines.push(`- [${candidate.kind}] ${candidate.id}: ${String(label)} (count ${candidate.provenance.count}, sources ${candidate.provenance.sources.join('/')})`);
  }
  lines.push('', '## Safety Rules');
  for (const rule of set.safetyRules) {
    lines.push(`- ${rule}`);
  }
  lines.push('', '## Next Commands');
  for (const command of set.nextCommands) {
    lines.push(`- ${command}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderApplyResult(result: ApplyResult, wrote: boolean, dataDir: string): string {
  const lines: string[] = ['# Brainbase Apply', ''];
  lines.push(`- Canonical writes: ${wrote}`);
  lines.push(`- Data dir: ${dataDir}`);
  lines.push('', '## Applied');
  if (result.applied.length === 0) {
    lines.push('- (none)');
  }
  for (const item of result.applied) {
    lines.push(`- [${item.kind}] ${item.id}: ${item.summary}`);
  }
  lines.push('', '## Skipped');
  if (result.skipped.length === 0) {
    lines.push('- (none)');
  }
  for (const item of result.skipped) {
    lines.push(`- ${item.id}: ${item.reason}`);
  }
  if (!wrote) {
    lines.push('', 'Dry-run only. Re-run with --write to promote selected candidates into canonical SSOT.');
  }
  return `${lines.join('\n')}\n`;
}

function numberOption(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function onboardRoutines(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const target = parseRoutineTarget(first(parsed, 'target'));
  const kinds = parseRoutineKinds(first(parsed, 'routines'));
  const cwd = first(parsed, 'cwd') ?? process.cwd();
  const definitions = buildRoutines(kinds, {
    ohayoHour: numberOption(first(parsed, 'ohayo-hour')),
    ohayoMinute: numberOption(first(parsed, 'ohayo-minute')),
    oyasumiHour: numberOption(first(parsed, 'oyasumi-hour')),
    oyasumiMinute: numberOption(first(parsed, 'oyasumi-minute')),
    retroDow: first(parsed, 'retro-dow'),
    retroHour: numberOption(first(parsed, 'retro-hour')),
    retroMinute: numberOption(first(parsed, 'retro-minute'))
  });

  const payload = target === 'codex'
    ? renderCodexAutomations(definitions, cwd, first(parsed, 'model') ?? 'gpt-5')
    : `${JSON.stringify(buildClaudeScheduledTasks(definitions, cwd), null, 2)}\n`;

  const outPath = first(parsed, 'out');
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeConfigSnippet(outPath, payload);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ target, cwd, outPath: outPath ?? null, routines: definitions }, null, 2)}\n`);
  } else {
    write(io, renderRoutinesMarkdown(definitions, target, payload, outPath));
  }
  return 0;
}

function renderRoutinesMarkdown(definitions: RoutineDefinition[], target: string, payload: string, outPath?: string): string {
  const lines: string[] = ['# Brainbase Personal Routines', ''];
  lines.push(`- Target agent: ${target}`);
  lines.push(`- Routines: ${definitions.map((definition) => definition.kind).join(', ')}`);
  lines.push('- Generation only: this prints a definition; it does not register with any live scheduler.');
  lines.push('', '## Schedule');
  for (const definition of definitions) {
    const when = definition.schedule.freq === 'weekly'
      ? `weekly ${definition.schedule.dayOfWeek} ${pad(definition.schedule.hour)}:${pad(definition.schedule.minute)}`
      : `daily ${pad(definition.schedule.hour)}:${pad(definition.schedule.minute)}`;
    lines.push(`- ${definition.kind}: ${when} (rrule \`${definition.rrule}\`, cron \`${definition.cron}\`)`);
  }
  lines.push('', `## ${target === 'codex' ? 'automation.toml' : 'scheduled-tasks.json'}`, '', '```', payload.trimEnd(), '```');
  lines.push('', '## Register');
  if (target === 'codex') {
    lines.push('- Save each per-file TOML document as ~/.codex/automations/<id>/automation.toml on your agent host, or import it through your Codex automation UI.');
  } else {
    lines.push('- Register each scheduled task with your Claude Code scheduler (for example the /schedule command) using its cron and prompt.');
  }
  lines.push('- Routines run against your local Brainbase MCP context; keep external side effects confirmation-gated.');
  if (outPath) {
    lines.push(`- Wrote routine definition to ${outPath}`);
  }
  return `${lines.join('\n')}\n`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
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

async function commandExists(command: string): Promise<boolean> {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, command));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue checking PATH candidates.
    }
  }
  return false;
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
  brainbase onboard:diagnose-sources [--dir path] [--email value] [--calendar value] [--drive value] [--drive-folder id] [--tasks value] [--assume-gog] [--gog-command command] [--format markdown|json]
  brainbase onboard:plan [--profile google-workspace-local] [--host value] [--email value] [--secondary-email value] [--calendar value] [--drive value] [--drive-folder id] [--local-folder path] [--tasks value] [--inactive-task-tool value] [--format markdown|json]
  brainbase onboard:candidates [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--relationship "person|role|context"] [--write] [--format markdown|json]
  brainbase onboard:import --source gmail|calendar|drive|local --from path|- [--dir path] [--out path] [--include-descriptions] [--format markdown|json]
  brainbase onboard:extract [--dir path] [--self-email value] [--top-relationships n] [--write] [--format markdown|json]
  brainbase onboard:apply --from path [--select id] [--all] [--write] [--dir path] [--format markdown|json]
  brainbase onboard:routines --target codex|claude [--routines ohayo,oyasumi,retro] [--ohayo-hour n] [--oyasumi-hour n] [--retro-dow MON-SUN] [--retro-hour n] [--cwd path] [--out path] [--format markdown|json]
  brainbase doctor [--dir path]
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runCli();
  process.exit(code);
}
