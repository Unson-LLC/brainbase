import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/stories/story-codex-appserver-session-state-ssot.md';
const architecturePath = 'docs/architecture/codex-appserver-session-state-ssot-architecture.md';
const specPath = 'docs/specs/codex-appserver-session-state-ssot-spec.md';
const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';
const sessionStatePath = 'server/services/codex-app-server-session-state.js';
const activityBridgePath = 'server/services/codex-app-server-activity-bridge.js';
const runtimeQueryPath = 'server/services/session-runtime/runtime-query-methods.js';
const stateControllerPath = 'server/controllers/state-controller.js';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-codex-appserver-session-state-ssot contract', () => {
  test('ac:1 defines a named durable App Server thread owner', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const sessionState = await read(sessionStatePath);
    const stateController = await read(stateControllerPath);
    expect(story).toContain('named field with a documented owner');
    expect(spec).toContain('Codex App Server thread identity must have a named durable owner in Brainbase session state');
    expect(sessionState).toContain('codexAppServer');
    expect(sessionState).toContain('threadId');
    expect(stateController).toContain("'codexAppServer'");
  });

  test('ac:2 keeps active App Server turns in existing activity state', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const sessionState = await read(sessionStatePath);
    const activityBridge = await read(activityBridgePath);
    expect(story).toContain('existing activity state without inventing a browser-only SSOT');
    expect(spec).toContain('Active App Server turn identity must continue to flow through existing `hookStatus` activity state');
    expect(sessionState).toContain('activeTurnId');
    expect(activityBridge).toContain('activityService.reportActivity');
    expect(activityBridge).toContain('recordCodexAppServerSessionState');
  });

  test('ac:3 requires Codex restore metadata without changing Claude Code restore', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const sessionState = await read(sessionStatePath);
    const runtimeQuery = await read(runtimeQueryPath);
    expect(story).toContain('Runtime restore for `engine: codex` can choose App Server resume metadata');
    expect(architecture).toContain('use App Server metadata only for Codex restore/reconcile decisions');
    expect(sessionState).toContain('buildCodexAppServerRestoreMetadata');
    expect(sessionState).toContain('getCodexAppServerThreadId');
    expect(runtimeQuery).toContain('buildCodexAppServerRestoreMetadata');
    expect(runtimeQuery).toContain('codexAppServerThreadId');
  });

  test('ac:4 prevents Claude Code sessions from receiving App Server metadata', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    const sessionState = await read(sessionStatePath);
    expect(story).toContain('Claude Code sessions cannot receive Codex App Server thread, turn, or resume metadata');
    expect(architecture).toContain('Claude Code sessions must not store or consume Codex App Server metadata');
    expect(spec).toContain('Claude Code sessions must not receive App Server metadata and must keep existing restore semantics');
    expect(sessionState).toContain("selectedEngine === 'codex'");
    expect(sessionState).toContain("'unsupported_engine'");
  });

  test('ac:5 requires explicit fallback for missing or stale metadata', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    const sessionState = await read(sessionStatePath);
    expect(story).toContain('explicit fallback or recovery state');
    expect(architecture).toContain('Stale or missing App Server metadata must surface as a recoverable state or explicit fallback');
    expect(spec).toContain('Missing or stale App Server metadata must produce an explicit recovery/fallback outcome');
    expect(sessionState).toContain("'missing_restore_metadata'");
    expect(sessionState).toContain("'stale_app_server_metadata'");
    expect(sessionState).toContain('blocker');
  });

  test('ac:6 keeps event item persistence out of scope unless a ledger is defined', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('App Server event item persistence is either explicitly out of scope');
    expect(architecture).toContain('keep full App Server item/event persistence out of scope unless a ledger contract is created');
    expect(spec).toContain('Full App Server event item persistence must remain out of scope unless this story adds a ledger contract');
  });

  test('ac:7 keeps terminal transport unchanged unless a separate story approves it', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('Existing xterm/tmux terminal transport files remain unchanged');
    expect(architecture).toContain('Existing terminal transport files must remain unchanged unless a terminal transport story is created');
    expect(spec).toContain('Terminal/xterm transport must remain unchanged');
  });

  test('ac:8 updates Capability Map with the new Codex-only boundary', async () => {
    const capability = await read(capabilityPath);
    expect(capability).toContain('story-codex-appserver-session-state-ssot');
    expect(capability).toContain('server/services/codex-app-server-session-state.js');
    expect(capability).toContain('session.codexAppServer durable metadata');
    expect(capability).toContain('App Server session-state metadata is a Codex-only boundary');
    expect(capability).toContain('Claude Code sessions must not store or consume it');
  });

  test('ac:9 requires future tests for Codex metadata persistence and Claude non-mutation', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    const capability = await read(capabilityPath);
    expect(story).toContain('Unit or contract tests cover Codex session metadata persistence');
    expect(architecture).toContain('Unit or contract tests proving Claude Code sessions are not mutated');
    expect(spec).toContain('Claude Code non-mutation');
    expect(capability).toContain('tests/server/services/codex-app-server-session-state.test.js');
  });

  test('ac:10 documents non-mutating fallback for unresolved session ownership', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const sessionState = await read(sessionStatePath);
    const activityBridge = await read(activityBridgePath);
    expect(story).toContain('without a resolvable Brainbase session id return an explicit non-mutating outcome');
    expect(spec).toContain('missing, unknown, or cannot be resolved after state reload');
    expect(spec).toContain('missing session ids, missing state-store support, unsupported engines, and unknown sessions');
    expect(spec).toContain('sessionIndex === -1');
    expect(sessionState).toContain("'missing_session_id'");
    expect(sessionState).toContain("'session_not_found'");
    expect(activityBridge).toContain("'missing_session_id'");
  });

  test('ac:11 keeps unmatched runtime rows from inferring App Server ownership', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    const runtimeQuery = await read(runtimeQueryPath);
    expect(story).toContain('cannot be matched to a Brainbase session id do not create or infer App Server session ownership');
    expect(spec).toContain('Runtime inventory process rows with no matching Brainbase session id');
    expect(spec).toContain('matches.length === 0 || !session.id');
    expect(runtimeQuery).toContain('matches.length === 0 || !session.id');
  });
});
