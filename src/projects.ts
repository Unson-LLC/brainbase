import type { DecisionRecord, GraphEntity, PersonalKgEntry, RelationshipRecord } from './types.js';

export type ProjectSourceArea = 'mail' | 'calendar' | 'drive' | 'tasks' | 'local' | 'other';

export interface ProjectSourceReference {
  area: ProjectSourceArea;
  label: string;
  ref: string;
}

export interface ProjectStakeholder {
  person: string;
  role?: string;
  context: string;
}

export interface ProjectRegistrationInput {
  name: string;
  goal?: string;
  status?: string;
  role?: string;
  stakeholders?: ProjectStakeholder[];
  sources?: ProjectSourceReference[];
  taskSources?: string[];
  decisionPrinciples?: string[];
  now?: string;
}

export interface ProjectRegistrationPlan {
  goal: string;
  canonicalWrites: false;
  project: {
    id: string;
    name: string;
    summary: string;
    goal?: string;
    status?: string;
    role?: string;
    sources: ProjectSourceReference[];
    taskSources: string[];
    decisionPrinciples: string[];
  };
  stakeholders: ProjectStakeholder[];
  writes: {
    graphEntities: GraphEntity[];
    relationships: RelationshipRecord[];
    personalKg: PersonalKgEntry[];
    decisions: DecisionRecord[];
  };
  safetyRules: string[];
  nextCommands: string[];
}

export function parseProjectSource(value: string): ProjectSourceReference {
  const [areaRaw, labelRaw, refRaw] = value.split('|').map((part) => part.trim());
  const area = parseProjectSourceArea(areaRaw);
  const label = labelRaw || area;
  const ref = refRaw || labelRaw || area;
  if (!ref) {
    throw new Error('project source must be "area|label|ref" or "area|ref"');
  }
  return { area, label, ref };
}

export function parseProjectStakeholder(value: string): ProjectStakeholder {
  const [person, role, context] = value.split('|').map((part) => part.trim());
  if (!person || !context) {
    throw new Error('project stakeholder must be "person|role|context" or "person||context"');
  }
  return { person, role: role || undefined, context };
}

export function buildProjectRegistrationPlan(input: ProjectRegistrationInput): ProjectRegistrationPlan {
  const name = input.name.trim();
  if (!name) {
    throw new Error('onboard:projects requires --name <project-name>');
  }
  const now = input.now ?? 'dry-run';
  const projectId = `project-${stableHash(name)}`;
  const stakeholders = dedupeStakeholders(input.stakeholders ?? []);
  const sources = dedupeSources(input.sources ?? []);
  const taskSources = dedupeStrings(input.taskSources ?? []);
  const decisionPrinciples = dedupeStrings(input.decisionPrinciples ?? []);
  const summary = buildProjectSummary(input);

  const projectEntity: GraphEntity = {
    id: projectId,
    type: 'project',
    name,
    summary,
    tags: ['work', 'project'],
    metadata: {
      goal: emptyToUndefined(input.goal),
      status: emptyToUndefined(input.status),
      role: emptyToUndefined(input.role),
      sources,
      taskSources,
      decisionPrinciples
    }
  };

  const stakeholderEntities: GraphEntity[] = stakeholders.map((stakeholder) => ({
    id: `person-${stableHash(stakeholder.person)}`,
    type: 'person',
    name: stakeholder.person,
    summary: `Stakeholder for ${name}: ${stakeholder.context}`,
    tags: ['relationship', 'project-stakeholder'],
    metadata: { project: name, projectId }
  }));

  const relationships: RelationshipRecord[] = stakeholders.map((stakeholder) => ({
    id: `relationship-${stableHash(`${name}|${stakeholder.person}|${stakeholder.context}`)}`,
    person: stakeholder.person,
    role: stakeholder.role,
    context: `${name}: ${stakeholder.context}`,
    tags: ['project', 'relationship'],
    updatedAt: now
  }));

  const personalKg: PersonalKgEntry[] = [{
    id: `work-${stableHash(`${name}|${summary}`)}`,
    type: 'work',
    text: buildProjectWorkText(name, input, sources, taskSources),
    tags: ['project', 'work'],
    source: 'onboard:projects',
    updatedAt: now
  }];

  const decisions: DecisionRecord[] = decisionPrinciples.map((principle) => ({
    id: `decision-${stableHash(`${name}|${principle}`)}`,
    title: `Project principle: ${name}`,
    decision: principle,
    rationale: 'Registered during Brainbase project onboarding.',
    tags: ['project', 'principle'],
    updatedAt: now
  }));

  return {
    goal: 'Review project registration before promoting it into canonical Brainbase SSOT.',
    canonicalWrites: false,
    project: {
      id: projectId,
      name,
      summary,
      goal: emptyToUndefined(input.goal),
      status: emptyToUndefined(input.status),
      role: emptyToUndefined(input.role),
      sources,
      taskSources,
      decisionPrinciples
    },
    stakeholders,
    writes: {
      graphEntities: [projectEntity, ...stakeholderEntities],
      relationships,
      personalKg,
      decisions
    },
    safetyRules: [
      'Project registration works from user interview answers first; connected sources are optional.',
      'Source references are metadata-only allowlists and are not read by onboard:projects.',
      'Canonical SSOT writes happen only when the command is rerun with --write.',
      'Review stakeholders and decision principles with the user before promotion.'
    ],
    nextCommands: [
      'Review this project registration with the user.',
      'brainbase onboard:projects --name "<project>" ... --write',
      'brainbase doctor'
    ]
  };
}

export function renderProjectRegistrationMarkdown(plan: ProjectRegistrationPlan, wrote: boolean, dataDir: string): string {
  const lines: string[] = ['# Brainbase Project Registration', ''];
  lines.push(`- Canonical writes: ${wrote}`);
  lines.push(`- Data dir: ${dataDir}`);
  lines.push(`- Project: ${plan.project.name}`);
  lines.push(`- Summary: ${plan.project.summary}`);
  if (plan.project.role) {
    lines.push(`- My role: ${plan.project.role}`);
  }
  lines.push('', '## Source Allowlists');
  if (plan.project.sources.length === 0) {
    lines.push('- (none)');
  }
  for (const source of plan.project.sources) {
    lines.push(`- ${source.area}: ${source.label} (${source.ref})`);
  }
  lines.push('', '## Task Sources');
  if (plan.project.taskSources.length === 0) {
    lines.push('- (none)');
  }
  for (const taskSource of plan.project.taskSources) {
    lines.push(`- ${taskSource}`);
  }
  lines.push('', '## Stakeholders');
  if (plan.stakeholders.length === 0) {
    lines.push('- (none)');
  }
  for (const stakeholder of plan.stakeholders) {
    lines.push(`- ${stakeholder.person}${stakeholder.role ? ` (${stakeholder.role})` : ''}: ${stakeholder.context}`);
  }
  lines.push('', '## Decision Principles');
  if (plan.project.decisionPrinciples.length === 0) {
    lines.push('- (none)');
  }
  for (const principle of plan.project.decisionPrinciples) {
    lines.push(`- ${principle}`);
  }
  lines.push('', '## Safety Rules');
  for (const rule of plan.safetyRules) {
    lines.push(`- ${rule}`);
  }
  if (!wrote) {
    lines.push('', 'Dry-run only. Re-run with --write after user approval to promote this project into canonical SSOT.');
  }
  return `${lines.join('\n')}\n`;
}

function parseProjectSourceArea(value: string): ProjectSourceArea {
  if (value === 'mail' || value === 'calendar' || value === 'drive' || value === 'tasks' || value === 'local' || value === 'other') {
    return value;
  }
  throw new Error('project source area must be mail|calendar|drive|tasks|local|other');
}

function buildProjectSummary(input: ProjectRegistrationInput): string {
  const parts = [
    input.goal ? `Goal: ${input.goal.trim()}` : '',
    input.status ? `Status: ${input.status.trim()}` : '',
    input.role ? `My role: ${input.role.trim()}` : ''
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'Registered during Brainbase project onboarding.';
}

function buildProjectWorkText(name: string, input: ProjectRegistrationInput, sources: ProjectSourceReference[], taskSources: string[]): string {
  const lines = [`Project ${name}`];
  if (input.goal) {
    lines.push(`Goal: ${input.goal.trim()}`);
  }
  if (input.status) {
    lines.push(`Status: ${input.status.trim()}`);
  }
  if (input.role) {
    lines.push(`My role: ${input.role.trim()}`);
  }
  if (sources.length > 0) {
    lines.push(`Allowed sources: ${sources.map((source) => `${source.area}:${source.label}`).join(', ')}`);
  }
  if (taskSources.length > 0) {
    lines.push(`Task sources: ${taskSources.join(', ')}`);
  }
  return lines.join('\n');
}

function dedupeSources(sources: ProjectSourceReference[]): ProjectSourceReference[] {
  const seen = new Set<string>();
  const result: ProjectSourceReference[] = [];
  for (const source of sources) {
    const key = `${source.area}|${source.label}|${source.ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(source);
    }
  }
  return result;
}

function dedupeStakeholders(stakeholders: ProjectStakeholder[]): ProjectStakeholder[] {
  const seen = new Set<string>();
  const result: ProjectStakeholder[] = [];
  for (const stakeholder of stakeholders) {
    const key = `${stakeholder.person}|${stakeholder.role ?? ''}|${stakeholder.context}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(stakeholder);
    }
  }
  return result;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function stableHash(value: string): string {
  let hashValue = 0;
  for (const char of value) {
    hashValue = ((hashValue << 5) - hashValue + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hashValue).toString(36);
}
