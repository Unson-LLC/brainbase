import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ensureShadowRuntimeLinks, resolveRuntimePaths } from '../../lib/runtime-paths.js';

describe('runtime-paths', () => {
  const createdDirs = [];

  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('prefers BRAINBASE_STATE_PATH over BRAINBASE_VAR_DIR', () => {
    const runtimePaths = resolveRuntimePaths({
      repoDir: '/Users/ksato/workspace/code/brainbase',
      env: {
        BRAINBASE_STATE_PATH: '/tmp/brainbase-custom/state.json',
        BRAINBASE_VAR_DIR: '/tmp/brainbase-var',
        BRAINBASE_ROOT: '/Users/ksato/workspace/shared'
      }
    });

    expect(runtimePaths.varDir).toBe('/tmp/brainbase-custom');
    expect(runtimePaths.stateFile).toBe('/tmp/brainbase-custom/state.json');
  });

  it('uses workspace var even when brainbase root points at shared', () => {
    const runtimePaths = resolveRuntimePaths({
      repoDir: '/Users/ksato/workspace/code/brainbase',
      env: {
        BRAINBASE_ROOT: '/Users/ksato/workspace/shared'
      }
    });

    expect(runtimePaths.workspaceRoot).toBe('/Users/ksato/workspace');
    expect(runtimePaths.varDir).toBe('/Users/ksato/workspace/var');
    expect(runtimePaths.stateFile).toBe('/Users/ksato/workspace/var/state.json');
  });

  it('migrates shared runtime files into symlinks to the canonical var dir', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-runtime-paths-'));
    createdDirs.push(tempRoot);

    const runtimePaths = resolveRuntimePaths({
      repoDir: path.join(tempRoot, 'workspace', 'code', 'brainbase'),
      env: {
        BRAINBASE_VAR_DIR: path.join(tempRoot, 'workspace', 'var')
      }
    });

    await fs.mkdir(runtimePaths.varDir, { recursive: true });
    await fs.writeFile(runtimePaths.stateFile, '{"sessions":[]}');
    await fs.writeFile(runtimePaths.pidFile, '12345');
    await fs.writeFile(runtimePaths.portFile, '31013');

    await fs.mkdir(runtimePaths.shadowVarDir, { recursive: true });
    await fs.writeFile(path.join(runtimePaths.shadowVarDir, 'state.json'), '{"sessions":[{"id":"old"}]}');
    await fs.writeFile(path.join(runtimePaths.shadowVarDir, 'brainbase.pid'), '99999');
    await fs.writeFile(path.join(runtimePaths.shadowVarDir, '.brainbase-port'), '32000');

    await ensureShadowRuntimeLinks(runtimePaths, { warn: () => {} });

    const shadowStateStat = await fs.lstat(path.join(runtimePaths.shadowVarDir, 'state.json'));
    const shadowPidStat = await fs.lstat(path.join(runtimePaths.shadowVarDir, 'brainbase.pid'));
    const shadowPortStat = await fs.lstat(path.join(runtimePaths.shadowVarDir, '.brainbase-port'));

    expect(shadowStateStat.isSymbolicLink()).toBe(true);
    expect(shadowPidStat.isSymbolicLink()).toBe(true);
    expect(shadowPortStat.isSymbolicLink()).toBe(true);

    const linkedState = await fs.realpath(path.join(runtimePaths.shadowVarDir, 'state.json'));
    const linkedPid = await fs.realpath(path.join(runtimePaths.shadowVarDir, 'brainbase.pid'));
    const linkedPort = await fs.realpath(path.join(runtimePaths.shadowVarDir, '.brainbase-port'));

    expect(linkedState).toBe(await fs.realpath(runtimePaths.stateFile));
    expect(linkedPid).toBe(await fs.realpath(runtimePaths.pidFile));
    expect(linkedPort).toBe(await fs.realpath(runtimePaths.portFile));
  });

  it('treats EEXIST from a concurrent expected symlink creation as success', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-runtime-paths-race-'));
    createdDirs.push(tempRoot);

    const runtimePaths = resolveRuntimePaths({
      repoDir: path.join(tempRoot, 'workspace', 'code', 'brainbase'),
      env: {
        BRAINBASE_VAR_DIR: path.join(tempRoot, 'workspace', 'var')
      }
    });

    await fs.mkdir(runtimePaths.varDir, { recursive: true });
    await fs.writeFile(runtimePaths.stateFile, '{"sessions":[]}');
    await fs.writeFile(runtimePaths.pidFile, '12345');
    await fs.writeFile(runtimePaths.portFile, '31013');

    const originalSymlink = fs.symlink.bind(fs);
    const symlinkSpy = vi.spyOn(fs, 'symlink').mockImplementationOnce(async (target, linkPath) => {
      await originalSymlink(target, linkPath);
      const error = new Error('file exists');
      error.code = 'EEXIST';
      throw error;
    });

    try {
      await ensureShadowRuntimeLinks(runtimePaths, { warn: () => {} });
    } finally {
      symlinkSpy.mockRestore();
    }

    expect(await fs.realpath(path.join(runtimePaths.shadowVarDir, 'state.json')))
      .toBe(await fs.realpath(runtimePaths.stateFile));
  });

  it('does not rewrite shared runtime links for custom var dirs', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-runtime-paths-custom-'));
    createdDirs.push(tempRoot);

    const workspaceRoot = path.join(tempRoot, 'workspace');
    const defaultVarDir = path.join(workspaceRoot, 'var');
    const customVarDir = path.join(tempRoot, 'worktree', 'var', 'e2e-brainbase-var');
    const sharedVarDir = path.join(workspaceRoot, 'shared', 'var');
    await fs.mkdir(defaultVarDir, { recursive: true });
    await fs.mkdir(customVarDir, { recursive: true });
    await fs.mkdir(sharedVarDir, { recursive: true });
    await fs.writeFile(path.join(defaultVarDir, 'state.json'), '{"sessions":[]}');
    await fs.writeFile(path.join(defaultVarDir, 'brainbase.pid'), '11111');
    await fs.writeFile(path.join(defaultVarDir, '.brainbase-port'), '31013');
    await fs.symlink('../../var/state.json', path.join(sharedVarDir, 'state.json'));

    const runtimePaths = resolveRuntimePaths({
      repoDir: path.join(workspaceRoot, 'code', 'brainbase'),
      env: {
        WORKSPACE_ROOT: workspaceRoot,
        BRAINBASE_VAR_DIR: customVarDir
      }
    });

    await ensureShadowRuntimeLinks(runtimePaths, { warn: () => {} });

    expect(await fs.readlink(path.join(sharedVarDir, 'state.json'))).toBe('../../var/state.json');
  });
});
