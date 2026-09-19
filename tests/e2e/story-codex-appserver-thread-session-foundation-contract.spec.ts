import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

const storyPath = 'docs/stories/story-codex-appserver-thread-session-foundation.md';
const architecturePath = 'docs/architecture/codex-appserver-thread-session-foundation-architecture.md';
const specPath = 'docs/specs/codex-appserver-thread-session-foundation-spec.md';
const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('Codex App Server historical lineage and retirement contract', () => {
  test('history:1 records the former primary-thread App Server display route', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);

    expect(story).toContain('Codex sessions with `session.codexAppServer.threadId` resolve to `codex_app_server`');
    expect(spec).toContain("session.codexAppServer.threadId");
  });

  test('history:2 records the former restore-thread App Server display route', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);

    expect(story).toContain('Codex sessions with `session.codexAppServer.restore.threadId` resolve to `codex_app_server`');
    expect(spec).toContain("session.codexAppServer.restore.threadId");
  });

  test('history:3 records the former xterm fallback for sessions without App Server metadata', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);

    expect(story).toContain('Codex sessions without App Server thread metadata resolve to `terminal_xterm`');
    expect(architecture).toContain('legacy Codex, stale metadata, and missing metadata');
    expect(spec).toContain("Missing App Server metadata falls back to `terminal_xterm`");
  });

  test('history:4 records the former xterm fallback for stale App Server metadata', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);

    expect(story).toContain('Stale App Server metadata resolves to `terminal_xterm`');
    expect(spec).toContain("session.codexAppServer.stale === true");
  });

  test('history:5 records the former exclusion of Claude Code from the App Server display route', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);

    expect(story).toContain('Claude Code sessions never resolve to `codex_app_server`');
    expect(architecture).toContain('Claude Code is explicitly excluded from the App Server route');
    expect(spec).toContain("Only sessions with `engine === 'codex'` can use `codex_app_server`");
  });

  test('history:6 records the former session UI display-route projection', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);

    expect(story).toContain('`deriveSessionUiState()` exposes the display route without changing terminal transport behavior');
    expect(spec).toContain('deriveSessionUiState(sessionId).displayRoute');
  });

  test('history:7 records that the former display slice did not replace terminal transport', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);

    expect(story).toContain('Terminal transport files remain unchanged in this slice');
    expect(architecture).toContain('terminal.transport` remains the only interactive terminal IO path in this slice');
    expect(spec).toContain('it does not replace terminal input, xterm rendering, or tmux snapshots');
  });

  test('retirement: records an empty active boundary and historical pointers', async () => {
    const capability = yaml.load(await read(capabilityPath)) as {
      lifecycle: string;
      surfaces: Record<string, string[]>;
      depends_on: string[];
      architecture_decision: string;
      current_evidence_capability: string;
      history: { documents: string[] };
      visibility_rules: string[];
    };

    expect(capability.lifecycle).toBe('retired');
    expect(capability.surfaces).toEqual({ ui: [], api: [], code: [], data: [] });
    expect(capability.depends_on).toEqual([]);
    expect(capability.architecture_decision).toBe('docs/architecture/ADR-019-codex-owns-development-runtime.md');
    expect(capability.current_evidence_capability).toBe('docs/brainbase-capabilities/capabilities/run-receipt.inbox.yml');
    expect(capability.history.documents).toContain(storyPath);
    expect(capability.history.documents).toContain(architecturePath);
    expect(capability.history.documents).toContain(specPath);
    expect(capability.visibility_rules.join('\n')).toContain('Codex app/CLI owns task, thread, worktree, branch, terminal, and process lifecycle under ADR-019.');
  });
});
