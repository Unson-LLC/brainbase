#!/usr/bin/env node
import { constants, realpathSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializePersonalOs, loadPersonalOs, migrateCanonicalGraph, mutatePersonalOs } from './ssot.js';
import { diagnoseGraph, type GraphDiagnosis } from './graph-diagnosis.js';
import { resolveDataDir } from './paths.js';
import { auditPersonalOsDirectory } from './ontology-ssot.js';
import { portableOntology, resolveOntologyVersion } from './ontology.js';
import { onboardingStatus } from './tools.js';
import { buildCandidateDrafts, buildValueDemo, parseOnboardingFormat, renderAgentProtocol, renderCandidateDrafts, renderConnectorRecommendations, renderLocalOnboardingPlan, renderSourceDiagnosis, renderValueDemo } from './onboarding.js';
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
import {
  assertPublicSafeSkillBundle,
  buildSkillBundle,
  parseSkillIds,
  parseSkillTarget,
  renderSkillsMarkdown,
  type SkillBundle
} from './skills.js';
import {
  buildProjectRegistrationPlan,
  parseProjectSource,
  parseProjectStakeholder,
  renderProjectRegistrationMarkdown,
  type ProjectRegistrationPlan
} from './projects.js';
import { renderGuidedFirstRun, type GuidedTarget } from './guided-onboarding.js';
import { blockedJudgmentOutput, processJudgmentHook, type JudgmentHookPayload } from './judgment-host.js';
import { applyCanonicalWrites, buildCanonicalEdge } from './canonical-edge-builder.js';
import type { CanonicalEntity, DecisionRecord, PersonalKgEntry, PersonalOs, RelationshipRecord } from './types.js';

interface CliIo {
  stdin?: AsyncIterable<string | Uint8Array>;
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
    if (parsed.flags.has('help')) {
      write(io, usage());
      return 0;
    }
    switch (parsed.command) {
      case 'onboard:init':
        return await onboardInit(parsed, io);
      case 'onboard:seed':
        return await onboardSeed(parsed, io);
      case 'onboard:install':
        return await onboardInstall(parsed, io);
      case 'onboard:agent':
        return await onboardAgent(parsed, io);
      case 'onboard:start':
        return await onboardStart(parsed, io);
      case 'onboard:demo':
        return await onboardDemo(parsed, io);
      case 'onboard:recommend':
        return await onboardRecommend(parsed, io);
      case 'onboard:diagnose-sources':
        return await onboardDiagnoseSources(parsed, io);
      case 'onboard:plan':
        return await onboardPlan(parsed, io);
      case 'onboard:projects':
        return await onboardProjects(parsed, io);
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
      case 'onboard:skills':
        return await onboardSkills(parsed, io);
      case 'ontology:show':
        write(io, `${JSON.stringify(portableOntology, null, 2)}\n`);
        return 0;
      case 'ontology:audit':
        return await ontologyAudit(parsed, io);
      case 'ontology:migrate':
        return await ontologyMigrate(parsed, io);
      case 'judgment:hook':
        return await judgmentHook(io);
      case 'judgment:install':
        return await judgmentInstall(parsed, io);
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

async function judgmentHook(io: CliIo): Promise<number> {
  let payload: JudgmentHookPayload = {};
  try {
    const input = await readHookStdin(io.stdin ?? process.stdin);
    payload = JSON.parse(input || '{}') as JudgmentHookPayload;
    write(io, `${JSON.stringify(await processJudgmentHook(payload))}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const eventName = payload.hook_event_name ?? payload.hookEventName;
    if (eventName === 'Stop' && payload.stop_hook_active === true) {
      writeError(io, `${reason}\n`);
      return 1;
    }
    write(io, `${JSON.stringify(blockedJudgmentOutput(reason))}\n`);
  }
  return 0;
}

async function judgmentInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = first(parsed, 'target');
  if (target !== 'codex') throw new Error('judgment:install currently requires --target codex');
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const hook = {
    hooks: [{
      type: 'command',
      command: `${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} judgment:hook`,
      statusMessage: 'brainbase judgment resolver'
    }]
  };
  const payload = `${JSON.stringify({
    hooks: {
      UserPromptSubmit: [hook],
      PostToolUse: [hook],
      Stop: [hook]
    }
  }, null, 2)}\n`;
  const outputPath = first(parsed, 'output');
  if (parsed.flags.has('dry-run') || !outputPath) {
    write(io, payload);
    return 0;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeConfigSnippet(outputPath, payload);
  write(io, `Wrote Codex Judgment Host config snippet to ${outputPath}\n`);
  return 0;
}

async function readHookStdin(input: AsyncIterable<string | Uint8Array>): Promise<string> {
  let text = '';
  for await (const chunk of input) text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
  return text;
}

async function onboardInit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  write(io, `Initialized Brainbase Personal OS at ${dataDir}\n`);
  return 0;
}

async function onboardSeed(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const name = first(parsed, 'name');
  const encodedRelationships = parsed.values.get('relationship') ?? [];
  for (const encoded of encodedRelationships) {
    const [person, , context] = encoded.split('|').map((part) => part.trim());
    if (!person || !context) {
      throw new Error([
        '関係者の形式が正しくありません。',
        '形式: "人|役割|覚えておく文脈"',
        '例: "田中|責任者|Atlas導入の最終判断を担当"',
        '保存内容は変更していません。',
        `再実行: ${seedRetryCommand(parsed, dataDir, encoded)}`
      ].join('\n'));
    }
  }
  await initializePersonalOs(dataDir);
  const hasSeedValues = Boolean(name)
    || ['value', 'project', 'decision-principle', 'relationship'].some((key) => (parsed.values.get(key)?.length ?? 0) > 0);
  if (!parsed.flags.has('non-interactive') && !hasSeedValues) {
    write(io, 'No seed values provided. Use --name, --value, --project, --decision-principle, or --relationship.\n');
    return 1;
  }

  await mutatePersonalOs(dataDir, (os) => {
    const now = new Date().toISOString();
    const personalEntries: PersonalKgEntry[] = [...os.personalKg];
    const decisions: DecisionRecord[] = [...os.decisions];
    const relationships: RelationshipRecord[] = [...os.relationships.relationships];
    const canonicalEntities: CanonicalEntity[] = [];

    if (name) {
      canonicalEntities.push({
        id: 'self',
        type: 'person',
        name,
        summary: 'このPersonal OSの本人。',
        tags: ['self']
      });
      upsertById(personalEntries, {
        id: `self-${hash(name)}`,
        type: 'self',
        text: `私は${name}です。`,
        tags: ['self'],
        updatedAt: now
      });
    }

    for (const value of parsed.values.get('value') ?? []) {
      upsertById(personalEntries, {
        id: `value-${hash(value)}`,
        type: 'value',
        text: value,
        tags: ['onboarding'],
        updatedAt: now
      });
    }

    for (const project of parsed.values.get('project') ?? []) {
      canonicalEntities.push({
        id: `project-${hash(project)}`,
        type: 'project',
        name: project,
        summary: '現在取り組んでいるプロジェクト。',
        tags: ['work']
      });
      upsertById(personalEntries, {
        id: `work-${hash(project)}`,
        type: 'work',
        text: project,
        tags: ['work'],
        updatedAt: now
      });
    }

    for (const value of parsed.values.get('decision-principle') ?? []) {
      const decision = {
        id: `decision-${hash(value)}`,
        title: 'オンボーディングで登録した判断基準',
        decision: value,
        tags: ['principle', 'onboarding'],
        updatedAt: now
      };
      upsertById(decisions, decision);
      canonicalEntities.push({
        id: decision.id,
        type: 'decision',
        name: decision.title,
        summary: decision.decision,
        tags: decision.tags
      });
    }

    for (const encoded of encodedRelationships) {
      const [person, role, context] = encoded.split('|').map((part) => part.trim());
      upsertById(relationships, {
        id: `relationship-${hash(encoded)}`,
        person,
        role: role || undefined,
        context,
        tags: ['relationship'],
        updatedAt: now
      });
      canonicalEntities.push({
        id: `person-${hash(person)}`,
        type: 'person',
        name: person,
        summary: context,
        tags: ['relationship']
      });
    }

    const projects = (parsed.values.get('project') ?? []).map((project) => ({
      id: `project-${hash(project)}`,
      name: project
    }));
    const people = encodedRelationships.map((encoded) => {
      const [person, role, context] = encoded.split('|').map((part) => part.trim());
      return {
        id: `person-${hash(person)}`,
        relationshipId: `relationship-${hash(encoded)}`,
        role: role || undefined,
        context
      };
    });
    const seedDecisions = (parsed.values.get('decision-principle') ?? []).map((decision) => ({
      id: `decision-${hash(decision)}`,
      decision
    }));
    const canonicalEdges = projects.flatMap((project) => [
      ...(name ? [buildCanonicalEdge({
        fromId: 'self',
        relation: 'participates_in',
        toId: project.id,
        context: 'Registered together during onboarding.',
        provenance: { sourceKind: 'onboarding' as const, sourceId: project.id }
      })] : []),
      ...people.map((person) => buildCanonicalEdge({
        fromId: person.id,
        relation: 'participates_in',
        toId: project.id,
        role: person.role,
        context: person.context,
        provenance: { sourceKind: 'onboarding' as const, sourceId: person.relationshipId }
      })),
      ...seedDecisions.map((decision) => buildCanonicalEdge({
        fromId: decision.id,
        relation: 'governs',
        toId: project.id,
        context: decision.decision,
        provenance: { sourceKind: 'onboarding' as const, sourceId: decision.id }
      }))
    ]);
    const graph = applyCanonicalWrites(os.graph, { entities: canonicalEntities, edges: canonicalEdges });

    return proposedPersonalOs(os, {
      graph: {
        ...graph,
        owner: { ...graph.owner, ...(name ? { id: 'self', name } : {}) }
      },
      relationships: { version: 1, relationships },
      personalKg: personalEntries,
      decisions
    });
  });
  const summary = [
    `Brainbaseへ保存しました: ${dataDir}`,
    ...(name ? [`- 本人: ${name}`] : []),
    ...(parsed.values.get('value') ?? []).map((value) => `- 価値観: ${value}`),
    ...(parsed.values.get('project') ?? []).map((project) => `- プロジェクト: ${project}`),
    ...encodedRelationships.map((encoded) => {
      const [person, role] = encoded.split('|').map((part) => part.trim());
      return `- 関係者: ${person}${role ? `（${role}）` : ''}`;
    }),
    ...(parsed.values.get('decision-principle') ?? []).map((value) => `- 判断基準: ${value}`),
    '- 同じ文脈は更新しました。既存の別データは削除していません。',
    '',
    '次に実行:',
    `brainbase onboard:install --target codex --dir ${shellArg(dataDir)} --dry-run`,
    '設定を承認・反映してエージェントを再起動した後、実際の依頼でBrainbaseのget_contextとsearchを使います。',
    ''
  ];
  write(io, summary.join('\n'));
  return 0;
}

function seedRetryCommand(parsed: ParsedArgs, dataDir: string, invalidRelationship: string): string {
  const args = ['brainbase', 'onboard:seed', '--dir', dataDir];
  const append = (flag: string, value: string | undefined): void => {
    if (value) args.push(flag, value);
  };
  append('--name', first(parsed, 'name'));
  append('--value', first(parsed, 'value'));
  append('--project', first(parsed, 'project'));
  append('--decision-principle', first(parsed, 'decision-principle'));
  for (const relationship of parsed.values.get('relationship') ?? []) {
    if (relationship !== invalidRelationship) append('--relationship', relationship);
  }
  append('--relationship', '田中|責任者|Atlas導入の最終判断を担当');
  return args.map(shellArg).join(' ');
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

async function onboardStart(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const target = parseGuidedTarget(first(parsed, 'target'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const os = await loadPersonalOs(dataDir);
  const status = onboardingStatus(os);
  const missing = Array.isArray(status.missing)
    ? status.missing.filter((item): item is string => typeof item === 'string')
    : [];
  const explicitGogCommand = first(parsed, 'gog-command');
  const gogCommand = explicitGogCommand ?? 'gog';
  const gogAvailable = parsed.flags.has('assume-gog') || await commandExists(gogCommand);
  const projectName = first(parsed, 'project') ?? first(parsed, 'project-name');
  const project = projectName ? {
    name: projectName,
    goal: first(parsed, 'goal'),
    status: first(parsed, 'status'),
    role: first(parsed, 'role'),
    stakeholders: (parsed.values.get('stakeholder') ?? []).map(parseProjectStakeholder),
    sources: (parsed.values.get('source') ?? []).map(parseProjectSource),
    taskSources: parsed.values.get('task-source') ?? [],
    decisionPrinciples: parsed.values.get('decision-principle') ?? []
  } : undefined;

  write(io, renderGuidedFirstRun({
    dataDir,
    target,
    profile: first(parsed, 'profile'),
    host: first(parsed, 'host'),
    name: first(parsed, 'name'),
    value: parsed.values.get('value') ?? [],
    email: first(parsed, 'email'),
    secondaryEmails: parsed.values.get('secondary-email') ?? [],
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    driveFolders: parsed.values.get('drive-folder') ?? [],
    localFolders: parsed.values.get('local-folder') ?? [],
    tasks: first(parsed, 'tasks'),
    inactiveTaskTools: parsed.values.get('inactive-task-tool') ?? [],
    gogCommand: explicitGogCommand,
    assumeGog: parsed.flags.has('assume-gog'),
    gogAvailable,
    project,
    connected: readLocalBackendConnected(status),
    missing
  }, format, parsed.flags.has('details')));
  return 0;
}

async function onboardDemo(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const os = await loadPersonalOs(dataDir);
  const demo = buildValueDemo({ os, scenario: first(parsed, 'scenario') });
  write(io, renderValueDemo({ os, scenario: first(parsed, 'scenario') }, format, parsed.flags.has('details')));
  return demo.ready ? 0 : 1;
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

async function onboardProjects(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const name = first(parsed, 'name');
  if (!name) {
    throw new Error('onboard:projects requires --name <project-name>');
  }
  const plan = buildProjectRegistrationPlan({
    name,
    goal: first(parsed, 'goal'),
    status: first(parsed, 'status'),
    role: first(parsed, 'role'),
    stakeholders: (parsed.values.get('stakeholder') ?? []).map(parseProjectStakeholder),
    sources: (parsed.values.get('source') ?? []).map(parseProjectSource),
    taskSources: parsed.values.get('task-source') ?? [],
    decisionPrinciples: parsed.values.get('decision-principle') ?? [],
    now: parsed.flags.has('write') ? new Date().toISOString() : undefined
  });

  const willWrite = parsed.flags.has('write');
  if (willWrite) {
    await applyProjectRegistrationPlan(dataDir, plan);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ ...plan, canonicalWrites: willWrite, dataDir }, null, 2)}\n`);
  } else {
    write(io, renderProjectRegistrationMarkdown(plan, willWrite, dataDir));
  }
  return 0;
}

async function applyProjectRegistrationPlan(dataDir: string, plan: ProjectRegistrationPlan): Promise<void> {
  await mutatePersonalOs(dataDir, (os) => {
    const graph = applyCanonicalWrites(os.graph, {
      entities: plan.writes.canonicalEntities,
      edges: plan.writes.canonicalEdges
    });
    const relationships = [...os.relationships.relationships];
    for (const relationship of plan.writes.relationships) {
      upsertById(relationships, relationship);
    }
    const personalKg = [...os.personalKg];
    for (const entry of plan.writes.personalKg) {
      upsertById(personalKg, entry);
    }
    const decisions = [...os.decisions];
    for (const decision of plan.writes.decisions) {
      upsertById(decisions, decision);
    }
    return proposedPersonalOs(os, {
      graph,
      relationships: { version: 1, relationships },
      personalKg,
      decisions
    });
  });
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

  const now = new Date().toISOString();
  const willWrite = parsed.flags.has('write');
  let result: ApplyResult | undefined;
  if (willWrite) {
    await mutatePersonalOs(dataDir, (os) => {
      if (os.graph.version !== 2) {
        throw new Error('migration_required: Graph v1 cannot store canonical ID edges; migrate graph.json to Graph v2 before writing');
      }
      result = planApply(candidates, { ids: selectedIds, all }, {
        graphEntities: [...os.graph.entities],
        graphEdges: [...os.graph.edges],
        relationships: [...os.relationships.relationships],
        personalKg: os.personalKg,
        decisions: os.decisions,
        ownerName: os.graph.owner?.name
      }, now);
      const personalKg = [...os.personalKg];
      for (const entry of result.personalKgAdditions) upsertById(personalKg, entry);
      const decisions = [...os.decisions];
      for (const decision of result.decisionAdditions) upsertById(decisions, decision);
      const graph = applyCanonicalWrites(os.graph, result.canonicalWrites);
      return proposedPersonalOs(os, {
        graph: { ...graph, owner: result.ownerName ? { ...graph.owner, name: result.ownerName } : graph.owner },
        relationships: { version: 1, relationships: result.relationships },
        personalKg,
        decisions
      });
    });
  } else {
    const os = await loadPersonalOs(dataDir);
    if (os.graph.version !== 2) {
      throw new Error('migration_required: Graph v1 cannot store canonical ID edges; migrate graph.json to Graph v2 before writing');
    }
    result = planApply(candidates, { ids: selectedIds, all }, {
      graphEntities: [...os.graph.entities],
      graphEdges: [...os.graph.edges],
      relationships: [...os.relationships.relationships],
      personalKg: os.personalKg,
      decisions: os.decisions,
      ownerName: os.graph.owner?.name
    }, now);
  }

  if (!result) {
    throw new Error('Failed to compute onboarding apply result.');
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

async function onboardSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const target = parseSkillTarget(first(parsed, 'target'));
  const ids = parseSkillIds(first(parsed, 'skills'));
  const bundle = buildSkillBundle(target, ids);
  assertPublicSafeSkillBundle(bundle);

  const outDir = first(parsed, 'out');
  if (outDir) {
    await writeSkillBundle(outDir, bundle);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ ...bundle, outDir: outDir ?? null }, null, 2)}\n`);
  } else {
    write(io, renderSkillsMarkdown(bundle, outDir));
  }
  return 0;
}

async function writeSkillBundle(outDir: string, bundle: SkillBundle): Promise<void> {
  for (const skill of bundle.skills) {
    const outputPath = join(outDir, skill.relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    try {
      await writeFile(outputPath, skill.content, { flag: 'wx' });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new Error(`Refusing to overwrite existing skill file ${outputPath}. Choose a new --out directory or remove the old file first.`);
      }
      throw error;
    }
  }
}

function isInstallTarget(value: string | undefined): value is InstallTarget {
  return value === 'codex' || value === 'claude' || value === 'codecode';
}

function parseGuidedTarget(value: string | undefined): GuidedTarget {
  if (!value || value === 'codex') {
    return 'codex';
  }
  if (value === 'claude' || value === 'codecode') {
    return value;
  }
  throw new Error('onboard:start requires --target codex|claude|codecode');
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
  const graphDiagnosis = await diagnoseGraph(dataDir);
  let status: Record<string, unknown>;
  try {
    status = onboardingStatus(await loadPersonalOs(dataDir));
  } catch (error) {
    write(io, `${JSON.stringify({
      graphDiagnosis,
      localBackend: { connected: false, backend: 'local' },
      issue: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`);
    return graphDiagnosisExitCode(graphDiagnosis.status) || 1;
  }
  const judgmentHooksPath = first(parsed, 'judgment-hooks');
  if (!judgmentHooksPath) {
    write(io, `${JSON.stringify({ ...status, graphDiagnosis }, null, 2)}\n`);
    return graphDiagnosisExitCode(graphDiagnosis.status);
  }
  const config = JSON.parse(await readFile(judgmentHooksPath, 'utf8')) as Record<string, unknown>;
  const hooks = config.hooks as Record<string, unknown> | undefined;
  const requiredEvents = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
  const valid = Boolean(hooks) && requiredEvents.every((eventName) => {
    const bindings = hooks?.[eventName];
    return Array.isArray(bindings) && bindings.some((binding) => {
      const commands = (binding as { hooks?: unknown }).hooks;
      return Array.isArray(commands) && commands.some((command) => (
        typeof (command as { command?: unknown }).command === 'string'
        && (command as { command: string }).command.includes('judgment:hook')
      ));
    });
  });
  if (!valid) throw new Error('judgment_hooks_invalid');
  write(io, `${JSON.stringify({
    ...status,
    graphDiagnosis,
    judgment_hooks: { status: 'ready', events: requiredEvents, source: judgmentHooksPath }
  }, null, 2)}\n`);
  return graphDiagnosisExitCode(graphDiagnosis.status);
}

function graphDiagnosisExitCode(status: GraphDiagnosis['status']): number {
  return status === 'invalid' || status === 'unavailable' || status === 'migration_required' ? 1 : 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [firstToken, ...remaining] = argv;
  const command = firstToken?.startsWith('--') ? undefined : firstToken;
  const rest = command ? remaining : argv;
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

function readLocalBackendConnected(status: Record<string, unknown>): boolean {
  const localBackend = status.localBackend;
  return typeof localBackend === 'object'
    && localBackend !== null
    && 'connected' in localBackend
    && localBackend.connected === true;
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

function upsertById<T extends { id: string }>(entries: T[], entry: T): void {
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index >= 0) {
    entries[index] = entry;
  } else {
    entries.push(entry);
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

async function ontologyAudit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const requestedVersion = first(parsed, 'ontology-version');
  const ontologyVersion = requestedVersion === undefined
    ? undefined
    : resolveOntologyVersion(requestedVersion);
  const result = await auditPersonalOsDirectory(dataDir, { ontologyVersion });
  write(io, `${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'unverified') {
    return 1;
  }
  return result.violations.some((violation) => violation.severity === 'error') ? 1 : 0;
}

async function ontologyMigrate(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const result = await migrateCanonicalGraph(dataDir, {
    write: parsed.flags.has('write'),
    expectedInputDigest: first(parsed, 'expected-input-digest')
  });
  write(io, `${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'blocked' ? 1 : 0;
}

function proposedPersonalOs(
  os: PersonalOs,
  proposed: Pick<PersonalOs, 'graph' | 'relationships' | 'personalKg' | 'decisions'>
): PersonalOs {
  return { ...os, ...proposed };
}

function usage(): string {
  return `初回価値まで（5ステップ）:
  1. brainbase onboard:start --target codex
  2. 表示された brainbase onboard:seed を確認して実行
  3. brainbase onboard:install --target codex --dry-run
  4. 設定を承認・反映し、Codexを再起動
  5. 新しいエージェントで実際の依頼を送り、役立ったか本人が判断

使い方:
  brainbase-mcp
  brainbase mcp
  brainbase onboard:init [--dir path]
  brainbase onboard:seed [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--relationship "person|role|context"]
  brainbase onboard:install --target codex|claude|codecode [--dir path] [--dry-run] [--output path]
  brainbase onboard:agent [--format markdown|json]
  brainbase onboard:start [--target codex|claude|codecode] [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--goal value] [--status value] [--role value] [--email value] [--calendar value] [--drive value] [--drive-folder id] [--local-folder path] [--tasks value] [--format markdown|json] [--details]
  brainbase onboard:demo [--dir path] [--scenario value] [--format markdown|json] [--details]
  brainbase onboard:recommend [--email value] [--calendar value] [--drive value] [--tasks value] [--format markdown|json]
  brainbase onboard:diagnose-sources [--dir path] [--email value] [--calendar value] [--drive value] [--drive-folder id] [--tasks value] [--assume-gog] [--gog-command command] [--format markdown|json]
  brainbase onboard:plan [--profile google-workspace-local] [--host value] [--email value] [--secondary-email value] [--calendar value] [--drive value] [--drive-folder id] [--local-folder path] [--tasks value] [--inactive-task-tool value] [--format markdown|json]
  brainbase onboard:projects --name value [--goal value] [--status value] [--role value] [--stakeholder "person|role|context"] [--source "area|label|ref"] [--task-source value] [--decision-principle value] [--write] [--dir path] [--format markdown|json]
  brainbase onboard:candidates [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--relationship "person|role|context"] [--write] [--format markdown|json]
  brainbase onboard:import --source gmail|calendar|drive|local --from path|- [--dir path] [--out path] [--include-descriptions] [--format markdown|json]
  brainbase onboard:extract [--dir path] [--self-email value] [--top-relationships n] [--write] [--format markdown|json]
  brainbase onboard:apply --from path [--select id] [--all] [--write] [--dir path] [--format markdown|json]
  brainbase onboard:routines --target codex|claude [--routines ohayo,oyasumi,retro] [--ohayo-hour n] [--oyasumi-hour n] [--retro-dow MON-SUN] [--retro-hour n] [--cwd path] [--out path] [--format markdown|json]
  brainbase onboard:skills --target codex|claude|portable [--skills id,id] [--out dir] [--format markdown|json]
  brainbase ontology:show
  brainbase ontology:audit [--dir path] [--ontology-version 0.0.0|1.0.0|2.0.0]
  brainbase ontology:migrate [--dir path] [--write --expected-input-digest digest]
  brainbase judgment:install --target codex [--dry-run] [--output path]
  brainbase judgment:hook
  brainbase doctor [--dir path] [--judgment-hooks path]
`;
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

export function isCliEntrypoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  if (!invokedPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(invokedPath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const code = await runCli();
  process.exit(code);
}
