export type SkillTarget = 'codex' | 'claude' | 'portable';

export type BrainbaseSkillId =
  | 'brainbase-personal-onboarding'
  | 'brainbase-source-import'
  | 'brainbase-candidate-review'
  | 'brainbase-daily-routines';

export interface BrainbaseSkillDefinition {
  id: BrainbaseSkillId;
  description: string;
  body: string;
}

export interface SkillFile {
  id: BrainbaseSkillId;
  description: string;
  relativePath: string;
  recommendedPath: string;
  content: string;
}

export interface SkillBundle {
  target: SkillTarget;
  goal: string;
  canonicalWrites: false;
  liveConfigWrites: false;
  skills: SkillFile[];
  safetyRules: string[];
  nextSteps: string[];
}

export const ALL_BRAINBASE_SKILLS: BrainbaseSkillId[] = [
  'brainbase-personal-onboarding',
  'brainbase-source-import',
  'brainbase-candidate-review',
  'brainbase-daily-routines'
];

const TARGET_BASE_PATHS: Record<SkillTarget, string> = {
  codex: '~/.agents/skills',
  claude: '.claude/skills',
  portable: 'skills'
};

const SECRET_RULE = 'Never ask the user to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.';

const SKILL_DEFINITIONS: Record<BrainbaseSkillId, BrainbaseSkillDefinition> = {
  'brainbase-personal-onboarding': {
    id: 'brainbase-personal-onboarding',
    description: 'Run the public Brainbase personal onboarding interview and local MCP setup without hosted services.',
    body: [
      '## Purpose',
      '',
      'Use this skill when a person wants to start using Brainbase from Codex, Claude Code, or another coding agent.',
      '',
      '## Workflow',
      '',
      '1. Start with `brainbase onboard:agent` and let the agent ask about mail, calendar, drive/docs, tasks, permissions, and approval.',
      '2. Run `brainbase onboard:init` to create the local Personal OS directory.',
      '3. Run `brainbase onboard:diagnose-sources` using the user answers before collecting any source data.',
      '4. Draft review candidates with `brainbase onboard:candidates --write` or by running the source import/extract loop.',
      '5. Promote only facts the user explicitly approves into canonical SSOT with `brainbase onboard:seed` or `brainbase onboard:apply --write`.',
      '6. Install MCP config with `brainbase onboard:install --target codex|claude|codecode --dry-run`, then have the user review the generated snippet.',
      '',
      '## Safety',
      '',
      `- ${SECRET_RULE}`,
      '- Keep Brainbase local-first: use the local MCP server and `~/.brainbase/personal-os/` unless the user explicitly chooses another local path.',
      '- Treat raw mail, calendar, drive, task, and notes data as secondary source material under `sources/`.',
      '- Canonical context comes only from `graph.json`, `relationships.json`, `personal-kg.jsonl`, and `decisions.jsonl` after user review.'
    ].join('\n')
  },
  'brainbase-source-import': {
    id: 'brainbase-source-import',
    description: 'Collect local source metadata, import it into Brainbase sources, and extract review candidates.',
    body: [
      '## Purpose',
      '',
      'Use this skill when the user has selected mail, calendar, drive/docs, task, or local note sources for Brainbase onboarding.',
      '',
      '## Workflow',
      '',
      '1. Confirm explicit allowlists before reading drive folders, local folders, calendars, task projects, or mail accounts.',
      '2. Prefer metadata-first collection. For Google Workspace, use local GoG-style collection when available and keep output under `sources/`.',
      '3. Import collected JSON with `brainbase onboard:import --source gmail|calendar|drive|local --from <file>`.',
      '4. Extract deterministic candidates with `brainbase onboard:extract --self-email <email> --write`.',
      '5. Show candidate ids, provenance counts, and source areas to the user before promotion.',
      '',
      '## Safety',
      '',
      `- ${SECRET_RULE}`,
      '- Do not collect full mail bodies, full event descriptions, or file contents unless the user explicitly approves excerpts.',
      '- Do not scan an entire drive or home directory. Use explicit allowlists.',
      '- Import/extract steps are not canonical memory. They only create secondary source records and review candidates.'
    ].join('\n')
  },
  'brainbase-candidate-review': {
    id: 'brainbase-candidate-review',
    description: 'Review Brainbase candidates with the user before promoting anything into canonical personal SSOT.',
    body: [
      '## Purpose',
      '',
      'Use this skill when Brainbase has candidate facts from an interview or source extraction.',
      '',
      '## Workflow',
      '',
      '1. Group candidates by self, value, project, person, organization, relationship, decision, and next action.',
      '2. Present candidate ids with plain-language summaries and provenance, not raw private source dumps.',
      '3. Ask the user which candidate ids to approve, reject, or revise.',
      '4. Dry-run promotion first with `brainbase onboard:apply --from <candidate-file> --select <id>` or use `brainbase onboard:seed` for manual facts.',
      '5. Write canonical files only after explicit approval using `--write`.',
      '6. Run `brainbase doctor` and, when useful, call Brainbase MCP `get_context` or `search` to confirm the approved facts are visible.',
      '',
      '## Safety',
      '',
      `- ${SECRET_RULE}`,
      '- Never promote candidates just because they appear frequently.',
      '- Keep rejected or uncertain candidates out of canonical SSOT.',
      '- Separate source-derived guesses from user-approved durable memory.'
    ].join('\n')
  },
  'brainbase-daily-routines': {
    id: 'brainbase-daily-routines',
    description: 'Generate personal Brainbase ohayo, oyasumi, and retro routines for the user agent scheduler.',
    body: [
      '## Purpose',
      '',
      'Use this skill when the user wants Brainbase to become a recurring personal operating loop, not a one-time setup.',
      '',
      '## Workflow',
      '',
      '1. Generate routine definitions with `brainbase onboard:routines --target codex|claude`.',
      '2. Use `--routines ohayo,oyasumi,retro` or a subset when the user wants only part of the loop.',
      '3. Tune routine times with `--ohayo-hour`, `--oyasumi-hour`, `--retro-dow`, and `--retro-hour`.',
      '4. Review the generated prompt and schedule with the user before registering it in any scheduler.',
      '5. Keep each routine scoped to the user\'s local Brainbase MCP context and their own approved sources.',
      '',
      '## Safety',
      '',
      `- ${SECRET_RULE}`,
      '- Do not send messages, publish, modify calendars, or delete records without explicit confirmation.',
      '- Treat authentication or collector failures as unavailable data, not as zero work.',
      '- Routine generation does not register a live scheduler unless the user performs that separate step.'
    ].join('\n')
  }
};

const BANNED_PUBLIC_TERMS = [
  'slack',
  'sns',
  'nocodb',
  'vibepro',
  'infisical',
  'lightsail',
  'hosted backend',
  'server operations',
  'server operation',
  'unson'
];

export function parseSkillTarget(value: string | undefined): SkillTarget {
  if (value === 'codex' || value === 'claude' || value === 'portable') {
    return value;
  }
  throw new Error('onboard:skills requires --target codex|claude|portable');
}

export function parseSkillIds(value: string | undefined): BrainbaseSkillId[] {
  if (!value) {
    return [...ALL_BRAINBASE_SKILLS];
  }
  const requested = new Set(value.split(',').map((part) => part.trim()).filter(Boolean));
  const unknown = [...requested].filter((id) => !isBrainbaseSkillId(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown Brainbase skill id(s): ${unknown.join(', ')}. Expected one of: ${ALL_BRAINBASE_SKILLS.join(', ')}`);
  }
  const selected = ALL_BRAINBASE_SKILLS.filter((id) => requested.has(id));
  if (selected.length === 0) {
    throw new Error(`--skills must include at least one of: ${ALL_BRAINBASE_SKILLS.join(', ')}`);
  }
  return selected;
}

export function buildSkillBundle(target: SkillTarget, ids: BrainbaseSkillId[] = ALL_BRAINBASE_SKILLS): SkillBundle {
  const skills = ids.map((id) => buildSkillFile(target, SKILL_DEFINITIONS[id]));
  return {
    target,
    goal: 'Install public-safe Brainbase onboarding skills for a personal coding-agent workflow.',
    canonicalWrites: false,
    liveConfigWrites: false,
    skills,
    safetyRules: [
      SECRET_RULE,
      'Generated skills are personal-scoped and local-first.',
      'Generated skills are not copied from internal Brainbase operations.',
      'This command prints or writes portable SKILL.md files; it does not mutate live agent configuration.'
    ],
    nextSteps: [
      `Review the generated ${target} skill files.`,
      'Place the files in the target agent skill directory or point the agent at the generated directory.',
      'Run `brainbase onboard:agent` and continue the onboarding interview.'
    ]
  };
}

export function renderSkillsMarkdown(bundle: SkillBundle, outDir?: string): string {
  const lines: string[] = ['# Brainbase Public Onboarding Skills', ''];
  lines.push(`- Target: ${bundle.target}`);
  lines.push(`- Skills: ${bundle.skills.map((skill) => skill.id).join(', ')}`);
  lines.push(`- Canonical writes: ${bundle.canonicalWrites}`);
  lines.push(`- Live config writes: ${bundle.liveConfigWrites}`);
  if (outDir) {
    lines.push(`- Output directory: ${outDir}`);
  }
  lines.push('', '## Files');
  for (const skill of bundle.skills) {
    lines.push('', `### ${skill.id}`, '');
    lines.push(`- Recommended path: ${skill.recommendedPath}`);
    lines.push(`- Relative path: ${skill.relativePath}`);
    lines.push('', '```markdown', skill.content.trimEnd(), '```');
  }
  lines.push('', '## Safety Rules');
  for (const rule of bundle.safetyRules) {
    lines.push(`- ${rule}`);
  }
  lines.push('', '## Next Steps');
  for (const step of bundle.nextSteps) {
    lines.push(`- ${step}`);
  }
  return `${lines.join('\n')}\n`;
}

export function assertPublicSafeSkillBundle(bundle: SkillBundle): void {
  const haystack = bundle.skills.map((skill) => skill.content).join('\n').toLowerCase();
  for (const term of BANNED_PUBLIC_TERMS) {
    if (haystack.includes(term)) {
      throw new Error(`Generated public Brainbase skills contain banned internal term: ${term}`);
    }
  }
  for (const skill of bundle.skills) {
    if (!skill.content.includes(SECRET_RULE)) {
      throw new Error(`Generated skill ${skill.id} is missing the no-secrets safety rule.`);
    }
  }
}

function buildSkillFile(target: SkillTarget, definition: BrainbaseSkillDefinition): SkillFile {
  const relativePath = `${definition.id}/SKILL.md`;
  return {
    id: definition.id,
    description: definition.description,
    relativePath,
    recommendedPath: `${TARGET_BASE_PATHS[target]}/${relativePath}`,
    content: renderSkillContent(definition)
  };
}

function renderSkillContent(definition: BrainbaseSkillDefinition): string {
  return [
    '---',
    `name: ${definition.id}`,
    `description: ${definition.description}`,
    '---',
    '',
    `# ${titleize(definition.id)}`,
    '',
    definition.body,
    ''
  ].join('\n');
}

function titleize(id: string): string {
  return id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function isBrainbaseSkillId(value: string): value is BrainbaseSkillId {
  return (ALL_BRAINBASE_SKILLS as string[]).includes(value);
}
