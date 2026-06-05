import { describe, expect, it } from 'vitest';
import {
  buildClaudeScheduledTasks,
  buildRoutines,
  parseRoutineKinds,
  parseRoutineTarget,
  renderCodexAutomations,
  scheduleToCron,
  scheduleToRrule
} from '../src/routines.js';

describe('parseRoutineTarget', () => {
  it('accepts codex/claude and rejects others', () => {
    expect(parseRoutineTarget('codex')).toBe('codex');
    expect(parseRoutineTarget('claude')).toBe('claude');
    expect(() => parseRoutineTarget('launchd')).toThrow(/codex\|claude/);
  });
});

describe('parseRoutineKinds', () => {
  it('defaults to all three in order', () => {
    expect(parseRoutineKinds(undefined)).toEqual(['ohayo', 'oyasumi', 'retro']);
  });

  it('selects a subset preserving canonical order (S-3)', () => {
    expect(parseRoutineKinds('retro,ohayo')).toEqual(['ohayo', 'retro']);
  });

  it('throws when no known routine is selected', () => {
    expect(() => parseRoutineKinds('weekly')).toThrow(/ohayo, oyasumi, retro/);
  });
});

describe('schedule mapping (INV-4, S-4)', () => {
  it('maps daily and weekly schedules to rrule', () => {
    expect(scheduleToRrule({ freq: 'daily', hour: 7, minute: 0 })).toBe('FREQ=DAILY;BYHOUR=7;BYMINUTE=0;BYSECOND=0');
    expect(scheduleToRrule({ freq: 'weekly', hour: 17, minute: 30, dayOfWeek: 'FRI' })).toBe('FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=30;BYSECOND=0');
  });

  it('maps daily and weekly schedules to cron', () => {
    expect(scheduleToCron({ freq: 'daily', hour: 22, minute: 0 })).toBe('0 22 * * *');
    expect(scheduleToCron({ freq: 'weekly', hour: 17, minute: 0, dayOfWeek: 'MON' })).toBe('0 17 * * 1');
  });
});

describe('buildRoutines', () => {
  it('uses defaults and reflects schedule options (INV-7, S-4)', () => {
    const routines = buildRoutines(['ohayo', 'oyasumi', 'retro'], {
      ohayoHour: 7, oyasumiHour: 22, retroDow: 'FRI', retroHour: 17
    });
    const byKind = Object.fromEntries(routines.map((routine) => [routine.kind, routine]));
    expect(byKind.ohayo.schedule).toEqual({ freq: 'daily', hour: 7, minute: 0 });
    expect(byKind.oyasumi.schedule).toEqual({ freq: 'daily', hour: 22, minute: 0 });
    expect(byKind.retro.schedule).toEqual({ freq: 'weekly', hour: 17, minute: 0, dayOfWeek: 'FRI' });
    expect(byKind.retro.cron).toBe('0 17 * * 5');
  });

  it('clamps out-of-range hours and falls back on bad day-of-week', () => {
    const [routine] = buildRoutines(['ohayo'], { ohayoHour: 99 });
    expect(routine.schedule.hour).toBe(23);
    const [retro] = buildRoutines(['retro'], { retroDow: 'FUNDAY' });
    expect(retro.schedule.dayOfWeek).toBe('FRI');
  });

  it('derives stable ids and is deterministic (INV-2)', () => {
    const a = buildRoutines(['ohayo', 'oyasumi', 'retro']);
    const b = buildRoutines(['ohayo', 'oyasumi', 'retro']);
    expect(a.map((routine) => routine.id)).toEqual(['brainbase-ohayo', 'brainbase-oyasumi', 'brainbase-retro']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('routine prompts (INV-5, INV-6, S-6)', () => {
  const routines = buildRoutines(['ohayo', 'oyasumi', 'retro']);

  it('are personal-scoped with no Unson internal references', () => {
    const joined = routines.map((routine) => routine.prompt).join('\n').toLowerCase();
    for (const banned of ['slack', 'sns', 'nocodb', 'unson', 'salestailor', 'techknight', 'ledger']) {
      expect(joined, `prompt must not reference ${banned}`).not.toContain(banned);
    }
    expect(joined).toContain('brainbase mcp');
  });

  it('forbid unconfirmed external side effects', () => {
    for (const routine of routines) {
      expect(routine.prompt.toLowerCase()).toMatch(/confirmation|approval/);
      expect(routine.prompt.toLowerCase()).toContain('do not send');
    }
  });
});

describe('renderCodexAutomations (S-1)', () => {
  it('emits one flat per-file TOML document per routine', () => {
    const toml = renderCodexAutomations(buildRoutines(['ohayo', 'oyasumi', 'retro']), '/Users/otawara/brainbase');
    expect((toml.match(/# file: ~\/.codex\/automations\//g) ?? []).length).toBe(3);
    expect(toml).not.toContain('[automation]');
    expect(toml).toContain('kind = "cron"');
    expect(toml).toContain('rrule = "FREQ=DAILY;BYHOUR=7');
    expect(toml).toContain('cwds = ["/Users/otawara/brainbase"]');
  });
});

describe('buildClaudeScheduledTasks (S-2)', () => {
  it('emits cron + prompt per routine', () => {
    const tasks = buildClaudeScheduledTasks(buildRoutines(['ohayo', 'retro']), '/Users/otawara/brainbase') as {
      scheduledTasks: { id: string; cron: string; prompt: string }[];
    };
    expect(tasks.scheduledTasks).toHaveLength(2);
    expect(tasks.scheduledTasks[0]).toMatchObject({ id: 'brainbase-ohayo', cron: '0 7 * * *' });
    expect(tasks.scheduledTasks[1].cron).toBe('0 17 * * 5');
    expect(tasks.scheduledTasks[0].prompt).toContain('Brainbase MCP');
  });
});
