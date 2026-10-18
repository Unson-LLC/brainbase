#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entryPoint = join(repoRoot, 'dist/onboarding-runtime.js');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'brainbase-stage3b-bundle-'));
const temporaryOutput = join(temporaryRoot, 'onboarding-runtime.js');

try {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: temporaryOutput,
    legalComments: 'inline',
    sourcemap: false,
    logLevel: 'warning',
  });
  await rename(temporaryOutput, entryPoint);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
