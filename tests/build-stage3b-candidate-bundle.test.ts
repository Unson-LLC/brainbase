import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  rename: vi.fn(),
  copyFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('esbuild', () => ({ build: mocks.build }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdtemp: vi.fn(async () => join(tmpdir(), 'brainbase-stage3b-bundle-test')),
  rename: mocks.rename,
  copyFile: mocks.copyFile,
  rm: mocks.rm,
}));

const temporaryRoot = join(tmpdir(), 'brainbase-stage3b-bundle-test');
const temporaryOutput = join(temporaryRoot, 'onboarding-runtime.js');
const entryPoint = fileURLToPath(new URL('../dist/onboarding-runtime.js', import.meta.url));
const siblingOutput = `${entryPoint}.${process.pid}.tmp`;
const run = () => import('../scripts/build-stage3b-candidate-bundle.mjs');

describe('build-stage3b candidate bundle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  afterEach(() => {
    expect(mocks.rm).toHaveBeenCalledWith(temporaryRoot, { recursive: true, force: true });
  });

  it('produces the same bundle settings and renames the output before cleanup', async () => {
    await run();
    expect(mocks.build).toHaveBeenCalledWith({
      entryPoints: [entryPoint], bundle: true, format: 'esm', platform: 'node',
      target: 'node20', outfile: temporaryOutput, legalComments: 'inline',
      sourcemap: false, logLevel: 'warning',
    });
    expect(mocks.rename).toHaveBeenCalledWith(temporaryOutput, entryPoint);
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.rename.mock.invocationCallOrder[0]).toBeLessThan(mocks.rm.mock.invocationCallOrder[0]);
  });

  it('copies to a sibling file then renames onto the entry point on EXDEV before cleanup', async () => {
    mocks.rename.mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
    await run();
    expect(mocks.copyFile).toHaveBeenCalledWith(temporaryOutput, siblingOutput);
    expect(mocks.rename).toHaveBeenNthCalledWith(2, siblingOutput, entryPoint);
    expect(mocks.copyFile.mock.invocationCallOrder[0]).toBeLessThan(mocks.rename.mock.invocationCallOrder[1]);
    expect(mocks.rename.mock.invocationCallOrder[1]).toBeLessThan(mocks.rm.mock.invocationCallOrder[0]);
    expect(mocks.rm).toHaveBeenCalledTimes(1);
  });

  it('propagates other rename errors and cleans up', async () => {
    const error = Object.assign(new Error('move denied'), { code: 'EACCES' });
    mocks.rename.mockRejectedValueOnce(error);
    await expect(run()).rejects.toBe(error);
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it('cleans up when bundling fails', async () => {
    const error = new Error('bundle failed');
    mocks.build.mockRejectedValueOnce(error);
    await expect(run()).rejects.toBe(error);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it('removes the sibling file without renaming onto the entry point when the EXDEV copy fails', async () => {
    mocks.rename.mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }));
    const error = new Error('copy failed');
    mocks.copyFile.mockRejectedValueOnce(error);
    await expect(run()).rejects.toBe(error);
    expect(mocks.copyFile).toHaveBeenCalledWith(temporaryOutput, siblingOutput);
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename).not.toHaveBeenCalledWith(siblingOutput, entryPoint);
    expect(mocks.rm).toHaveBeenNthCalledWith(1, siblingOutput, { force: true });
    expect(mocks.rm).toHaveBeenCalledTimes(2);
  });

  it('removes the sibling file and cleans up when the EXDEV fallback rename fails', async () => {
    const error = new Error('move failed');
    mocks.rename
      .mockRejectedValueOnce(Object.assign(new Error('cross-device move'), { code: 'EXDEV' }))
      .mockRejectedValueOnce(error);
    await expect(run()).rejects.toBe(error);
    expect(mocks.rename).toHaveBeenNthCalledWith(2, siblingOutput, entryPoint);
    expect(mocks.rm).toHaveBeenNthCalledWith(1, siblingOutput, { force: true });
    expect(mocks.rm).toHaveBeenCalledTimes(2);
  });
});
