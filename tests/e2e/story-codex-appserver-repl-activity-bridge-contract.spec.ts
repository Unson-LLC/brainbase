import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import {
  buildActivityReportPayload,
  buildCodexAppServerStatePatch,
  classifyAppServerNotification
} from '../../scripts/lib/codex-app-server-activity-client.mjs';

const storyPath = 'docs/stories/story-codex-appserver-repl-activity-bridge.md';
const architecturePath = 'docs/architecture/codex-appserver-repl-activity-bridge-architecture.md';
const specPath = 'docs/specs/codex-appserver-repl-activity-bridge-spec.md';
const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';
const replPath = 'scripts/codex-app-repl.mjs';
const helperPath = 'scripts/lib/codex-app-server-activity-client.mjs';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-codex-appserver-repl-activity-bridge contract', () => {
  test('ac:1 sends structured App Server start activity', async () => {
    const result = buildActivityReportPayload({
      sessionId: 'session-codex',
      method: 'turn/started',
      reportedAt: 1779688449000,
      params: { thread: { id: 'thread-app' }, turn: { id: 'turn-app' } }
    });

    expect(result).toMatchObject({
      mutates: true,
      payload: {
        status: 'working',
        lifecycle: 'turn_started',
        eventType: 'turn/started',
        turnId: 'turn-app',
        currentStep: 'Codex App Serverで作業開始'
      }
    });
  });

  test('ac:2 sends structured App Server completion and clears the active turn contract', async () => {
    const result = buildActivityReportPayload({
      sessionId: 'session-codex',
      method: 'turn/completed',
      reportedAt: 1779688459000,
      fallbackTurnId: 'turn-app'
    });
    const patch = buildCodexAppServerStatePatch({
      sessionId: 'session-codex',
      method: 'turn/completed',
      reportedAt: 1779688459000,
      fallbackThreadId: 'thread-app',
      fallbackTurnId: 'turn-app'
    });

    expect(result).toMatchObject({
      mutates: true,
      payload: {
        status: 'done',
        lifecycle: 'turn_completed',
        eventType: 'turn/completed',
        turnId: 'turn-app',
        currentStep: 'Codex App Serverのターンが完了'
      }
    });
    expect(patch).toMatchObject({
      mutates: true,
      patch: {
        codexAppServer: {
          activeTurnId: null,
          lastTurnId: 'turn-app',
          lifecycle: 'turn_completed',
          status: 'done'
        }
      }
    });
  });

  test('ac:3 persists App Server thread metadata through the state patch contract', async () => {
    const patch = buildCodexAppServerStatePatch({
      sessionId: 'session-codex',
      method: 'turn/started',
      reportedAt: 1779688449000,
      params: { thread: { id: 'thread-app' }, turn: { id: 'turn-app' } }
    });

    expect(patch).toMatchObject({
      mutates: true,
      sessionId: 'session-codex',
      patch: {
        codexAppServer: {
          source: 'codex_app_server',
          threadId: 'thread-app',
          activeTurnId: 'turn-app',
          restore: {
            strategy: 'codex_app_server_thread',
            threadId: 'thread-app'
          }
        }
      }
    });
  });

  test('ac:4 completion aliases are structured instead of legacy unscoped done', async () => {
    expect(classifyAppServerNotification('codex/event/task_complete')).toMatchObject({
      supported: true,
      status: 'done',
      lifecycle: 'turn_completed'
    });
    expect(classifyAppServerNotification('waiting_for_user_input')).toMatchObject({
      supported: true,
      status: 'done',
      lifecycle: 'turn_completed'
    });
    expect(classifyAppServerNotification('turn/interrupted')).toMatchObject({
      supported: true,
      status: 'done',
      lifecycle: 'turn_completed'
    });
  });

  test('ac:5 missing Brainbase session id remains non-mutating', async () => {
    expect(buildActivityReportPayload({
      method: 'turn/started',
      params: { turn: { id: 'turn-app' } }
    })).toEqual({ mutates: false, reason: 'missing_session_id' });
    expect(buildCodexAppServerStatePatch({
      method: 'turn/started',
      params: { turn: { id: 'turn-app' } }
    })).toEqual({ mutates: false, reason: 'missing_session_id' });
  });

  test('ac:6 REPL uses the helper and does not depend on browser globals or server internals', async () => {
    const repl = await read(replPath);
    const helper = await read(helperPath);
    expect(repl).toContain("from './lib/codex-app-server-activity-client.mjs'");
    expect(repl).toContain('reportAppServerActivity');
    expect(repl).toContain('/api/sessions/report_activity');
    expect(repl).toContain('/api/state/sessions/');
    expect(repl).not.toContain('features.codex_hooks=true');
    expect(repl).toContain('response.ok');
    expect(repl).toContain('process.stderr.write');
    expect(helper).not.toContain('window.');
    expect(helper).not.toContain('document.');
    expect(helper).not.toContain('stateStore');
  });

  test('ac:7 Story, ADR, and Spec define the REPL bridge boundary', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('Codex App Server REPL turn start sends structured `turn_started` activity');
    expect(story).toContain('Codex App Server REPL turn completion sends structured `turn_completed` activity');
    expect(architecture).toContain('The REPL script runs outside the server process');
    expect(spec).toContain('Make the user-facing Codex App Server REPL path use the structured App Server activity');
  });

  test('ac:8 Capability Map documents the REPL activity client surface', async () => {
    const capability = await read(capabilityPath);
    expect(capability).toContain('scripts/codex-app-repl.mjs');
    expect(capability).toContain('scripts/lib/codex-app-server-activity-client.mjs');
    expect(capability).toContain('REPL activity client tests prove the REPL path constructs structured lifecycle metadata');
    expect(capability).toContain('port 31013 live-runtime proof still requires post-merge smoke evidence');
  });

  test('ac:9 terminal transport remains outside this story', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('Existing terminal/xterm transport files remain unchanged');
    expect(architecture).toContain('Terminal/xterm transport files must remain unchanged');
    expect(spec).toContain('Terminal/xterm transport files must remain unchanged');
  });
});
