export type RoutineKind = 'ohayo' | 'oyasumi' | 'retro';
export type RoutineTarget = 'codex' | 'claude';

export interface ScheduleOptions {
  ohayoHour?: number;
  ohayoMinute?: number;
  oyasumiHour?: number;
  oyasumiMinute?: number;
  retroDow?: string;
  retroHour?: number;
  retroMinute?: number;
}

export interface RoutineSchedule {
  freq: 'daily' | 'weekly';
  hour: number;
  minute: number;
  dayOfWeek?: string;
}

export interface RoutineDefinition {
  id: string;
  kind: RoutineKind;
  name: string;
  schedule: RoutineSchedule;
  rrule: string;
  cron: string;
  prompt: string;
}

const ALL_KINDS: RoutineKind[] = ['ohayo', 'oyasumi', 'retro'];

const DOW_TO_RRULE: Record<string, string> = {
  MON: 'MO', TUE: 'TU', WED: 'WE', THU: 'TH', FRI: 'FR', SAT: 'SA', SUN: 'SU'
};

// cron day-of-week: Sunday = 0
const DOW_TO_CRON: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6
};

const ROUTINE_PROMPTS: Record<RoutineKind, string> = {
  ohayo:
    'Run my personal morning input routine using the local Brainbase MCP. Read my Brainbase get_context for who and what matters to me, review today and the next few days of my own Google Calendar and my unread Gmail metadata-first via gog, and surface today\'s priorities and pending follow-ups. Treat anything new (people, tasks, decisions) as Brainbase candidates for review, not canonical memory. Do not send messages, publish anything, modify my calendar, or delete records without my explicit confirmation; draft or report pending work instead. Treat authentication, gog, or source failures as unavailable, not as zero items.',
  oyasumi:
    'Run my personal end-of-day routine using the local Brainbase MCP. Summarize what I decided and worked on today, update my open task candidates from my calendar and notes, and capture reflections and decisions as Brainbase candidates for review. Promote nothing into canonical SSOT without my explicit approval. Do not send messages, publish, modify my calendar, or delete records without confirmation.',
  retro:
    'Run my weekly retrospective using the local Brainbase MCP. From my Brainbase context and this week\'s calendar, mail metadata, and notes, summarize the week\'s meetings, decisions, and completed versus pending work, then propose next week\'s focus. Write the retrospective as a local review note and record any durable lessons as Brainbase candidates for review. Do not send, publish, edit my calendar, or delete anything without my explicit confirmation.'
};

const ROUTINE_NAMES: Record<RoutineKind, string> = {
  ohayo: 'Brainbase personal ohayo (morning input)',
  oyasumi: 'Brainbase personal oyasumi (end of day)',
  retro: 'Brainbase personal retro (weekly retrospective)'
};

export function parseRoutineTarget(value: string | undefined): RoutineTarget {
  if (value === 'codex' || value === 'claude') {
    return value;
  }
  throw new Error('onboard:routines requires --target codex|claude');
}

export function parseRoutineKinds(value: string | undefined): RoutineKind[] {
  if (!value) {
    return [...ALL_KINDS];
  }
  const requested = value.split(',').map((part) => part.trim().toLowerCase());
  const kinds: RoutineKind[] = [];
  for (const kind of ALL_KINDS) {
    if (requested.includes(kind)) {
      kinds.push(kind);
    }
  }
  if (kinds.length === 0) {
    throw new Error('--routines must include at least one of: ohayo, oyasumi, retro');
  }
  return kinds;
}

export function buildRoutines(kinds: RoutineKind[], options: ScheduleOptions = {}): RoutineDefinition[] {
  const ohayoHour = clampHour(options.ohayoHour, 7);
  const ohayoMinute = clampMinute(options.ohayoMinute, 0);
  const oyasumiHour = clampHour(options.oyasumiHour, 21);
  const oyasumiMinute = clampMinute(options.oyasumiMinute, 0);
  const retroDow = normalizeDow(options.retroDow, 'FRI');
  const retroHour = clampHour(options.retroHour, 17);
  const retroMinute = clampMinute(options.retroMinute, 0);

  const schedules: Record<RoutineKind, RoutineSchedule> = {
    ohayo: { freq: 'daily', hour: ohayoHour, minute: ohayoMinute },
    oyasumi: { freq: 'daily', hour: oyasumiHour, minute: oyasumiMinute },
    retro: { freq: 'weekly', hour: retroHour, minute: retroMinute, dayOfWeek: retroDow }
  };

  return kinds.map((kind) => {
    const schedule = schedules[kind];
    return {
      id: `brainbase-${kind}`,
      kind,
      name: ROUTINE_NAMES[kind],
      schedule,
      rrule: scheduleToRrule(schedule),
      cron: scheduleToCron(schedule),
      prompt: ROUTINE_PROMPTS[kind]
    };
  });
}

export function scheduleToRrule(schedule: RoutineSchedule): string {
  if (schedule.freq === 'weekly') {
    const byday = DOW_TO_RRULE[schedule.dayOfWeek ?? 'FRI'] ?? 'FR';
    return `FREQ=WEEKLY;BYDAY=${byday};BYHOUR=${schedule.hour};BYMINUTE=${schedule.minute};BYSECOND=0`;
  }
  return `FREQ=DAILY;BYHOUR=${schedule.hour};BYMINUTE=${schedule.minute};BYSECOND=0`;
}

export function scheduleToCron(schedule: RoutineSchedule): string {
  if (schedule.freq === 'weekly') {
    const dow = DOW_TO_CRON[schedule.dayOfWeek ?? 'FRI'] ?? 5;
    return `${schedule.minute} ${schedule.hour} * * ${dow}`;
  }
  return `${schedule.minute} ${schedule.hour} * * *`;
}

export function renderCodexAutomations(definitions: RoutineDefinition[], cwd: string, model = 'gpt-5'): string {
  // Each Codex automation is a flat TOML document saved as its own file at
  // ~/.codex/automations/<id>/automation.toml. They are delimited by a file
  // marker comment so a single output can be split into per-file documents.
  return `${definitions.map((definition) => renderCodexAutomation(definition, cwd, model)).join('\n')}`;
}

export function renderCodexAutomation(definition: RoutineDefinition, cwd: string, model = 'gpt-5'): string {
  return [
    `# file: ~/.codex/automations/${definition.id}/automation.toml`,
    'version = 1',
    `id = ${tomlString(definition.id)}`,
    'kind = "cron"',
    `name = ${tomlString(definition.name)}`,
    `prompt = ${tomlString(definition.prompt)}`,
    'status = "ACTIVE"',
    `rrule = ${tomlString(definition.rrule)}`,
    `model = ${tomlString(model)}`,
    'reasoning_effort = "high"',
    'execution_environment = "local"',
    `cwds = [${tomlString(cwd)}]`,
    ''
  ].join('\n');
}

export function buildClaudeScheduledTasks(definitions: RoutineDefinition[], cwd: string): Record<string, unknown> {
  return {
    scheduledTasks: definitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      cron: definition.cron,
      cwd,
      prompt: definition.prompt
    }))
  };
}

function clampHour(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(23, Math.max(0, Math.trunc(value)));
}

function clampMinute(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(59, Math.max(0, Math.trunc(value)));
}

function normalizeDow(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const upper = value.trim().toUpperCase().slice(0, 3);
  return DOW_TO_RRULE[upper] ? upper : fallback;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
