import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/stories/story-codex-appserver-thread-session-foundation.md';
const architecturePath = 'docs/architecture/codex-appserver-thread-session-foundation-architecture.md';
const specPath = 'docs/specs/codex-appserver-thread-session-foundation-spec.md';
const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';
const displayRoutePath = 'public/modules/domain/session/session-display-route.js';
const sessionUiStatePath = 'public/modules/session-ui-state.js';
const displayRouteTestPath = 'tests/domain/session/session-display-route.test.js';
const sessionUiStateTestPath = 'tests/unit/session-ui-state.test.js';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-codex-appserver-thread-session-foundation contract', () => {
  test('ac:1 routes Codex sessions with primary App Server thread metadata to App Server display mode', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const route = await read(displayRoutePath);
    const routeTest = await read(displayRouteTestPath);

    expect(story).toContain('Codex sessions with `session.codexAppServer.threadId` resolve to `codex_app_server`');
    expect(spec).toContain("session.codexAppServer.threadId");
    expect(route).toContain('session.codexAppServer?.threadId');
    expect(route).toContain('SESSION_DISPLAY_MODES.CODEX_APP_SERVER');
    expect(routeTest).toContain('routes Codex sessions with App Server thread metadata');
  });

  test('ac:2 routes Codex sessions with restore thread metadata to App Server display mode', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const route = await read(displayRoutePath);
    const routeTest = await read(displayRouteTestPath);

    expect(story).toContain('Codex sessions with `session.codexAppServer.restore.threadId` resolve to `codex_app_server`');
    expect(spec).toContain("session.codexAppServer.restore.threadId");
    expect(route).toContain('session.codexAppServer?.restore?.threadId');
    expect(routeTest).toContain('uses restore thread metadata');
  });

  test('ac:3 keeps Codex sessions without App Server metadata on xterm fallback', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    const routeTest = await read(displayRouteTestPath);

    expect(story).toContain('Codex sessions without App Server thread metadata resolve to `terminal_xterm`');
    expect(architecture).toContain('legacy Codex, stale metadata, and missing metadata');
    expect(spec).toContain("Missing App Server metadata falls back to `terminal_xterm`");
    expect(routeTest).toContain('keeps Codex sessions without App Server metadata on xterm fallback');
  });

  test('ac:4 treats stale App Server metadata as xterm fallback', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const route = await read(displayRoutePath);
    const routeTest = await read(displayRouteTestPath);

    expect(story).toContain('Stale App Server metadata resolves to `terminal_xterm`');
    expect(spec).toContain("session.codexAppServer.stale === true");
    expect(route).toContain('session.codexAppServer?.stale === true');
    expect(route).toContain('codex_app_server_thread_stale');
    expect(routeTest).toContain('distinct xterm fallback reason');
  });

  test('ac:5 keeps Claude Code sessions off the Codex App Server display route', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    const route = await read(displayRoutePath);
    const routeTest = await read(displayRouteTestPath);

    expect(story).toContain('Claude Code sessions never resolve to `codex_app_server`');
    expect(architecture).toContain('Claude Code is explicitly excluded from the App Server route');
    expect(spec).toContain("Only sessions with `engine === 'codex'` can use `codex_app_server`");
    expect(route).toContain("session.engine !== 'codex'");
    expect(routeTest).toContain('never routes Claude Code sessions through Codex App Server metadata');
  });

  test('ac:6 exposes display route through derived session UI state', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const sessionUiState = await read(sessionUiStatePath);
    const sessionUiStateTest = await read(sessionUiStateTestPath);

    expect(story).toContain('`deriveSessionUiState()` exposes the display route without changing terminal transport behavior');
    expect(spec).toContain('deriveSessionUiState(sessionId).displayRoute');
    expect(sessionUiState).toContain('displayRoute: deriveSessionDisplayRoute(session)');
    expect(sessionUiStateTest).toContain('Codex App Server thread metadata から display route を導出する');
  });

  test('ac:7 keeps terminal transport replacement out of this slice', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);

    expect(story).toContain('Terminal transport files remain unchanged in this slice');
    expect(architecture).toContain('terminal.transport` remains the only interactive terminal IO path in this slice');
    expect(spec).toContain('it does not replace terminal input, xterm rendering, or tmux snapshots');
  });

  test('ac:8 documents the staged App Server display boundary in Capability Map', async () => {
    const story = await read(storyPath);
    const capability = await read(capabilityPath);

    expect(story).toContain('Capability Map documents the staged App Server display boundary and fallback');
    expect(capability).toContain('session display-route state for Codex App Server thread sessions');
    expect(capability).toContain('Codex App Server display eligibility is derived only for Codex sessions');
    expect(capability).toContain('all Claude Code sessions remain on the xterm display route');
    expect(capability).toContain('App Server display-route state is read-only');
  });
});
