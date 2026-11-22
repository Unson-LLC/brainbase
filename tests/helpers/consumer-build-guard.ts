import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createReleaseArtifact } from '../../scripts/npm-release.mjs';

/**
 * Ensures `dist/` is built before packing a consumer tarball.
 *
 * CI and `npm run release:validate` already execute `npm run build` right before
 * invoking Vitest and pass `BRAINBASE_TEST_SKIP_BUILD=1`. Re-running `npm run build`
 * inside multiple parallel Vitest workers both wastes ~16s per test and overwrites
 * the shared `dist/` directory concurrently. When invoked locally without that flag,
 * or if `dist/index.js` is absent, this still runs `npm run build`.
 */
export function ensureBuiltPackage(
  root: string,
  execute: (command: string, args: string[], cwd?: string) => string
): void {
  if (process.env.BRAINBASE_TEST_SKIP_BUILD === '1' && existsSync(path.join(root, 'dist/index.js'))) {
    return;
  }
  execute('npm', ['run', 'build'], root);
}

async function waitForFile(filePath: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await stat(filePath);
      if (info.isFile() && info.size > 0) return true;
    } catch {
      // Wait for peer worker to finish packing.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Produces a real release tarball for consumer smoke tests.
 *
 * When `BRAINBASE_TEST_SKIP_BUILD=1` and `BRAINBASE_TEST_FIXTURE_ROOT` are set
 * (CI / release validation), packs the immutable HEAD tarball once inside the
 * per-run fixture root and copies it for sibling consumer smoke tests so we do
 * not pack the same `dist/` three times in parallel.
 */
export async function getConsumerReleaseArtifact(
  root: string,
  artifactRoot: string,
  version: string,
  sha: string,
  execute: (command: string, args: string[], cwd?: string) => string
): Promise<{ tarballPath: string; tarballSha256: string; tarballIntegrity: string }> {
  const fixtureRoot = process.env.BRAINBASE_TEST_FIXTURE_ROOT;
  if (process.env.BRAINBASE_TEST_SKIP_BUILD !== '1' || !fixtureRoot) {
    return createReleaseArtifact(root, artifactRoot, version, sha, execute);
  }

  const sharedDir = path.join(fixtureRoot, 'shared-release-artifact');
  const metadataPath = path.join(sharedDir, `${version}-${sha}.json`);
  const lockDir = path.join(sharedDir, `${version}-${sha}.lock`);
  await mkdir(sharedDir, { recursive: true });

  const loadShared = async () => {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
      tarballPath: string;
      tarballSha256: string;
      tarballIntegrity: string;
    };
    const localTarball = path.join(artifactRoot, path.basename(metadata.tarballPath));
    await copyFile(metadata.tarballPath, localTarball);
    return {
      tarballPath: localTarball,
      tarballSha256: metadata.tarballSha256,
      tarballIntegrity: metadata.tarballIntegrity,
    };
  };

  if (existsSync(metadataPath)) return loadShared();

  let acquired = false;
  try {
    mkdirSync(lockDir);
    acquired = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
  }

  if (acquired) {
    try {
      const artifact = await createReleaseArtifact(root, sharedDir, version, sha, execute);
      const tmpMeta = `${metadataPath}.${process.pid}.tmp`;
      const { writeFile, rename } = await import('node:fs/promises');
      await writeFile(tmpMeta, JSON.stringify(artifact));
      await rename(tmpMeta, metadataPath);
      return loadShared();
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  if (await waitForFile(metadataPath)) return loadShared();
  return createReleaseArtifact(root, artifactRoot, version, sha, execute);
}
