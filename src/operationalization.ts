export type OperationalizationTarget = 'codex' | 'claude' | 'codecode' | 'agent';

export interface OperationalizationAction {
  id: 'public-skills' | 'routines' | 'mcp-config' | 'source-allowlist' | 'verification';
  title: string;
  status: 'pending';
  command: string;
  why: string;
  safety: string;
}

export interface OperationalizationPlan {
  goal: string;
  completed: string[];
  pending: OperationalizationAction[];
  recommendedOrder: string[];
  safetyRules: string[];
  completionCheck: string[];
}

export interface OperationalizationPlanInput {
  target?: OperationalizationTarget;
  dataDir?: string;
  cwd?: string;
  firstValueReady?: boolean;
}

export function buildOperationalizationPlan(input: OperationalizationPlanInput = {}): OperationalizationPlan {
  const target = input.target ?? 'agent';
  const dataDir = input.dataDir ?? '<personal-os-dir>';
  const cwd = input.cwd ?? '<brainbase-checkout>';
  const installTarget = target === 'agent' ? '<agent>' : target;
  const skillsTarget = target === 'claude' ? 'claude' : target === 'codex' ? 'codex' : 'portable';
  const routinesTarget = target === 'claude' ? 'claude' : 'codex';

  return {
    goal: 'Keep onboarding open until the first value demo is followed by the operating setup the user still needs.',
    completed: input.firstValueReady
      ? [
        'Initial approved context is seeded locally.',
        'doctor can report the first value demo as ready.',
        'onboard:demo produced a prompt, sample result, and plain-language value explanation.'
      ]
      : [
        'Personal OS setup has started.'
      ],
    pending: [
      {
        id: 'public-skills',
        title: 'Place the public Brainbase onboarding skills',
        status: 'pending',
        command: `brainbase onboard:skills --target ${skillsTarget}`,
        why: 'Agents need the public onboarding, source import, candidate review, and daily routine instructions available where they run.',
        safety: 'Generation is dry-run by default; write files only with an explicit --out path and do not overwrite existing SKILL.md files.'
      },
      {
        id: 'routines',
        title: 'Register ohayo / oyasumi / retro routines',
        status: 'pending',
        command: `brainbase onboard:routines --target ${routinesTarget} --cwd ${commandArg(cwd)}`,
        why: 'The operating loop is not active until the morning, end-of-day, and weekly retrospective routines are scheduled.',
        safety: 'Register routines paused or confirmation-gated first; generated definitions alone do not create a live scheduler.'
      },
      {
        id: 'mcp-config',
        title: 'Merge the Brainbase MCP config into the real agent config',
        status: 'pending',
        command: `brainbase onboard:install --target ${installTarget} --dir ${commandArg(dataDir)} --dry-run`,
        why: 'A dry-run snippet proves the config shape, but the agent cannot call Brainbase until the real Codex / Claude / CodeCode config is updated.',
        safety: 'Keep dry-run as preview only; merge into live config after user approval and restart the target agent.'
      },
      {
        id: 'source-allowlist',
        title: 'Decide source allowlists, import, and candidate review',
        status: 'pending',
        command: 'brainbase onboard:diagnose-sources --email <provider> --calendar <provider> --drive <provider> --drive-folder <folder-id> --tasks <tool>',
        why: 'Mail, calendar, drive, files, and tasks are optional follow-up sources and need explicit allowlists before import.',
        safety: 'Keep imported material under sources/ and promote only reviewed candidates into approved local memory.'
      },
      {
        id: 'verification',
        title: 'Verify doctor and MCP get_context / search',
        status: 'pending',
        command: `brainbase doctor --dir ${commandArg(dataDir)}`,
        why: 'Onboarding is operational only when doctor and the MCP tools show the approved context from a fresh agent session.',
        safety: 'Check get_context/search after config merge instead of assuming command generation was enough.'
      }
    ],
    recommendedOrder: [
      'Install or write public skills for the target agent.',
      'Generate ohayo / oyasumi / retro routines and register them paused or confirmation-gated.',
      'Merge the Brainbase MCP snippet into the real Codex / Claude / CodeCode config and restart the agent.',
      'Decide source allowlists and run import / candidate review only where more context is needed.',
      'Run doctor, then verify MCP get_context and search from a fresh agent session.'
    ],
    safetyRules: [
      'Do not write live config, scheduler entries, or canonical facts without user approval.',
      'Do not treat generated skills, generated routines, or MCP dry-run snippets as completed installation.',
      'Do not ask users to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.',
      'Source imports stay local-first and reviewed before canonical promotion.'
    ],
    completionCheck: [
      'The user has seen the first value output.',
      'The completion report names all still-pending operationalization actions.',
      'The target agent can call Brainbase MCP get_context/search after real config merge.',
      'Source allowlists and candidate review are either completed or explicitly deferred.'
    ]
  };
}

function commandArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
