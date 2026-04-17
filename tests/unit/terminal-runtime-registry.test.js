import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TerminalRuntimeRegistry } from '../../server/services/terminal-runtime-registry.js';

describe('TerminalRuntimeRegistry', () => {
  let tempDir;
  let filePath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-runtime-registry-'));
    filePath = path.join(tempDir, 'terminal-runtime-registry.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('missing file時_empty registryを返す', () => {
    const registry = new TerminalRuntimeRegistry({ filePath, serverGeneration: { id: 'gen-1' } });

    expect(registry.getAll()).toEqual({
      version: 1,
      serverGeneration: { id: 'gen-1' },
      sessions: {}
    });
  });

  it('session observed stateをatomic saveする', async () => {
    const registry = new TerminalRuntimeRegistry({ filePath, serverGeneration: { id: 'gen-1' } });

    registry.updateSession('session-1', {
      runtimeState: 'interactive_ready',
      observed: {
        inputProbe: { status: 'passed' }
      }
    });

    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(raw.sessions['session-1']).toMatchObject({
      sessionId: 'session-1',
      runtimeState: 'interactive_ready',
      observed: {
        inputProbe: { status: 'passed' }
      }
    });
  });

  it('observed subtreesを深くmergeする', () => {
    const registry = new TerminalRuntimeRegistry({ filePath, serverGeneration: { id: 'gen-1' } });

    registry.updateSession('session-1', {
      observed: {
        inputProbe: { status: 'passed', lastPassedAt: '2026-04-17T12:00:00.000Z' }
      }
    });
    registry.updateSession('session-1', {
      observed: {
        gateway: { connected: true, viewerId: 'viewer-1' }
      }
    });

    expect(registry.getSession('session-1').observed).toMatchObject({
      inputProbe: { status: 'passed' },
      gateway: { connected: true, viewerId: 'viewer-1' }
    });
  });

  it('gatewayとcli stateを記録する', () => {
    const registry = new TerminalRuntimeRegistry({ filePath, serverGeneration: { id: 'gen-1' } });

    registry.setGateway('session-1', { connected: true, viewerId: 'viewer-1' });
    registry.setCliState('session-1', { state: 'waiting', reason: 'choice_prompt' });

    expect(registry.getSession('session-1').observed).toMatchObject({
      gateway: { connected: true, viewerId: 'viewer-1' },
      cli: { state: 'waiting', reason: 'choice_prompt' }
    });
  });
});
