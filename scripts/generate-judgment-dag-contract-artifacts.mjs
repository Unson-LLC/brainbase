#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = path.join(repositoryRoot, 'contracts', 'judgment-dag');
const sourceLockPath = path.join(contractRoot, 'source-lock.json');
const digestPath = path.join(contractRoot, 'digest.json');
const packageBoundary = `${repositoryRoot}${path.sep}`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function packageRelativeFile(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath) ||
      relativePath.includes('\\') || relativePath.split('/').includes('..')) {
    throw new Error(`contract hash path is not package-relative: ${String(relativePath)}`);
  }
  const resolved = path.resolve(repositoryRoot, relativePath);
  if (resolved !== repositoryRoot && !resolved.startsWith(packageBoundary)) {
    throw new Error(`contract hash path escapes package root: ${relativePath}`);
  }
  return resolved;
}

async function hashRelativeFile(relativePath) {
  return sha256(await readFile(packageRelativeFile(relativePath)));
}

const sourceLock = JSON.parse(await readFile(sourceLockPath, 'utf8'));
sourceLock.sources = await Promise.all([...sourceLock.sources]
  .sort((left, right) => left.path.localeCompare(right.path))
  .map(async (source) => ({ ...source, sha256: await hashRelativeFile(source.path) })));
if (new Set(sourceLock.sources.map((source) => source.path)).size !== sourceLock.sources.length) {
  throw new Error('source-lock contains duplicate source paths');
}
await writeFile(sourceLockPath, `${JSON.stringify(sourceLock, null, 2)}\n`);

const digestPaths = [
  'README.md',
  'contracts/judgment-dag/fixture.json',
  'contracts/judgment-dag/schema.json',
  'contracts/judgment-dag/source-lock.json',
  ...sourceLock.sources.map((source) => source.path)
].sort((left, right) => left.localeCompare(right));
if (new Set(digestPaths).size !== digestPaths.length) {
  throw new Error('digest contains duplicate file paths');
}
const files = await Promise.all(digestPaths.map(async (relativePath) => ({
  path: relativePath,
  sha256: await hashRelativeFile(relativePath)
})));
const canonical = files.map((file) => `${file.path}\0${file.sha256}\n`).join('');
await writeFile(digestPath, `${JSON.stringify({
  contract: 'judgment-dag-core',
  algorithm: 'sha256',
  canonicalization: 'UTF-8 lines sorted by path as path + NUL + sha256 + LF',
  files,
  digest: sha256(canonical)
}, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  sourceLock: sourceLockPath,
  sourceCount: sourceLock.sources.length,
  digest: digestPath,
  fileCount: files.length,
  aggregateDigest: sha256(canonical)
}) + '\n');
