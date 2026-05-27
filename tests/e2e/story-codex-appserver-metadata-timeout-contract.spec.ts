import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { SessionController } from '../../server/controllers/session-controller.js';

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function buildController() {
  return new SessionController({
    activity: {},
    ownership: {},
    workspace: {},
    runtimeQuery: {},
    runtimeLifecycle: {},
    runtimeRegistry: {},
    runtimeReconciler: {},
    terminalIo: {},
    terminalInputProbe: {},
    snapshot: {},
    worktreeService: {},
    stateStore: { get: () => ({ sessions: [] }) }
  });
}

test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 story-codex-appserver-metadata-timeout traceability contract', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const spec = read('docs/specs/codex-appserver-session-create-spec.md');
  const architecture = read('docs/architecture/codex-appserver-session-create-architecture.md');
  const controller = read('server/controllers/session-controller.js');
  const startHandler = read('server/controllers/session/runtime-handlers.js');
  const worktreeHandler = read('server/controllers/session/worktree-handlers.js');

  // story-codex-appserver-metadata-timeout ac:1
  expect(story).toContain('AC-9: Cold Codex App Server startup is allowed enough time');
  // story-codex-appserver-metadata-timeout ac:2
  expect(spec).toContain('REQ-12');
  // story-codex-appserver-metadata-timeout ac:3
  expect(spec).toContain('S-7 cold-start-wait');
  // story-codex-appserver-metadata-timeout ac:4
  expect(architecture).toContain('Cold App Server startup can exceed a short fixed wait');
  // story-codex-appserver-metadata-timeout ac:5
  expect(controller).toContain('DEFAULT_CODEX_APP_SERVER_METADATA_TIMEOUT_MS = 45_000');
  // story-codex-appserver-metadata-timeout ac:6
  expect(controller).toContain('BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS');
  // story-codex-appserver-metadata-timeout ac:7
  expect(controller).toContain('BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS');
  // story-codex-appserver-metadata-timeout ac:8
  expect(startHandler).toContain('controller.codexAppServerMetadataTimeoutMs');
  // story-codex-appserver-metadata-timeout ac:9
  expect(worktreeHandler).toContain('controller.codexAppServerMetadataTimeoutMs');
});

test('ac:9 controller defaults tolerate Codex App Server cold metadata startup', () => {
  const controller = buildController();

  expect(controller.codexAppServerMetadataTimeoutMs).toBe(45_000);
  expect(controller.codexAppServerMetadataIntervalMs).toBe(250);
});

test('ac:9 controller metadata wait can be tuned by environment', () => {
  const previousTimeout = process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS;
  const previousInterval = process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS;
  process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS = '60000';
  process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS = '500';

  try {
    const controller = buildController();
    expect(controller.codexAppServerMetadataTimeoutMs).toBe(60_000);
    expect(controller.codexAppServerMetadataIntervalMs).toBe(500);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS;
    } else {
      process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS = previousTimeout;
    }
    if (previousInterval === undefined) {
      delete process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS;
    } else {
      process.env.BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS = previousInterval;
    }
  }
});

test('story-codex-appserver-metadata-timeout ac:1 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const runtime = read('server/services/session-runtime/runtime-lifecycle-methods.js');
  expect(story).toContain(`AC-1: \`POST /api/sessions/start\` accepts a Codex App Server creation request and passes \`BRAINBASE_CODEX_APP_SERVER=1\` to the runtime startup path.`);
  expect(runtime).toContain('BRAINBASE_CODEX_APP_SERVER');
});

test('story-codex-appserver-metadata-timeout ac:2 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const sessionService = read('public/modules/domain/session/session-service.js');
  expect(story).toContain(`AC-2: Regular new Codex sessions request Codex App Server startup from the browser session service.`);
  expect(sessionService).toContain("codexAppServer: engine === 'codex'");
});

test('story-codex-appserver-metadata-timeout ac:3 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const worktreeHandler = read('server/controllers/session/worktree-handlers.js');
  expect(story).toContain(`AC-3: Worktree new Codex sessions request Codex App Server startup from the server-side worktree creation path.`);
  expect(worktreeHandler).toContain('codexAppServer: shouldStartCodexAppServerSession(engine, true)');
});

test('story-codex-appserver-metadata-timeout ac:4 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const startup = read('server/controllers/session/codex-app-server-startup.js');
  expect(story).toContain(`AC-4: Codex App Server creation waits until \`session.codexAppServer.threadId\` or \`session.codexAppServer.restore.threadId\` is persisted before returning success.`);
  expect(startup).toContain('getCodexAppServerThreadId');
});

test('story-codex-appserver-metadata-timeout ac:5 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const startup = read('server/controllers/session/codex-app-server-startup.js');
  expect(story).toContain(`AC-5: Claude Code sessions do not set \`BRAINBASE_CODEX_APP_SERVER\` and keep the existing terminal path.`);
  expect(startup).toContain("engine === 'codex'");
});

test('story-codex-appserver-metadata-timeout ac:6 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const displayRoute = read('public/modules/domain/session/session-display-route.js');
  expect(story).toContain(`AC-6: Existing Codex sessions without App Server metadata keep terminal fallback unless they are explicitly started through this creation request.`);
  expect(displayRoute).toContain('codex_app_server_thread_missing');
});

test('story-codex-appserver-metadata-timeout ac:7 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const startHandler = read('server/controllers/session/runtime-handlers.js');
  expect(story).toContain(`AC-7: If App Server metadata is not persisted after runtime startup, the just-started runtime is stopped before creation failure is reported.`);
  expect(startHandler).toContain('shouldCleanupCodexAppServerRuntime');
});

test('story-codex-appserver-metadata-timeout ac:8 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const displayMixin = read('public/modules/app/codex-app-server-display-mixin.js');
  expect(story).toContain(`AC-8: Regular and worktree Codex creation paths have browser evidence that the persisted App Server thread id is stored while the user-facing terminal remains interactive.`);
  expect(displayMixin).toContain('codexAppServerThreadId');
});

test('story-codex-appserver-metadata-timeout ac:9 acceptance marker', () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const controller = buildController();
  expect(story).toContain(`AC-9: Cold Codex App Server startup is allowed enough time to persist \`thread/started\` metadata before the controller reports metadata failure.`);
  expect(controller.codexAppServerMetadataTimeoutMs).toBe(45_000);
});
