import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test, expect } from '@playwright/test';
import { CodexAppServerAdapter } from '../../server/services/codex-app-server-adapter.js';

// story-codex-app-server-adapter ac:1
// story-codex-app-server-adapter ac:2
// story-codex-app-server-adapter ac:3
// story-codex-app-server-adapter ac:4
// story-codex-app-server-adapter ac:5
// story-codex-app-server-adapter ac:6
// story-codex-app-server-adapter ac:7
// story-codex-app-server-adapter ac:8
// story-codex-app-server-adapter ac:9

function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: (signal?: string) => boolean;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
    proc.emit('exit', 0, 'SIGTERM');
    return true;
  };
  return proc;
}

test('story-codex-app-server-adapter acceptance contract', async () => {
  const proc = createFakeProcess();
  const writes: any[] = [];
  proc.stdin.on('data', (chunk) => {
    for (const line of chunk.toString().trim().split('\n').filter(Boolean)) {
      writes.push(JSON.parse(line));
    }
  });

  const adapter = new CodexAppServerAdapter({
    spawnFn: () => proc as any,
    cwd: process.cwd(),
    requestTimeoutMs: 500
  });
  const notifications: any[] = [];
  adapter.on('notification', (notification) => notifications.push(notification));

  const started = adapter.start();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'brainbase'
      }
    }
  });
  proc.stdout.write(`${JSON.stringify({ id: 1, result: { platformFamily: 'unix' } })}\n`);
  await started;
  expect(writes[1]).toEqual({ method: 'initialized', params: {} });

  const thread = adapter.startThread({ model: 'gpt-5.4', cwd: process.cwd() });
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toMatchObject({
    method: 'thread/start',
    params: {
      model: 'gpt-5.4',
      cwd: process.cwd()
    }
  });
  proc.stdout.write(`${JSON.stringify({ id: 2, result: { thread: { id: 'thr_story' } } })}\n`);
  await expect(thread).resolves.toEqual({ thread: { id: 'thr_story' } });

  const turn = adapter.startTurn({
    threadId: 'thr_story',
    input: [{ type: 'text', text: 'Summarize this repo.' }]
  });
  await expect.poll(() => writes.length).toBe(4);
  expect(writes[3]).toMatchObject({
    method: 'turn/start',
    params: {
      threadId: 'thr_story',
      input: [{ type: 'text', text: 'Summarize this repo.' }]
    }
  });
  proc.stdout.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn_story' } } })}\n`);
  proc.stdout.write(`${JSON.stringify({ id: 3, result: { turn: { id: 'turn_story' } } })}\n`);
  await expect(turn).resolves.toEqual({ turn: { id: 'turn_story' } });
  expect(notifications).toContainEqual({
    method: 'turn/started',
    params: { turn: { id: 'turn_story' } }
  });

  const pending = adapter.request('thread/read', { threadId: 'thr_story' });
  await expect.poll(() => writes.length).toBe(5);
  proc.emit('exit', 1, null);
  await expect(pending).rejects.toThrow('Codex App Server exited');
  expect(adapter.running).toBe(false);
});
