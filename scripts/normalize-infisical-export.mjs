#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { normalizeInfisicalExport, writePrivateJsonAtomically } from './lib/infisical-export.mjs';

const [snapshotPath] = process.argv.slice(2);
if (!snapshotPath) {
    console.error('usage: normalize-infisical-export.mjs <snapshot.json>');
    process.exit(2);
}

try {
    const parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    const normalized = normalizeInfisicalExport(parsed);
    writePrivateJsonAtomically(snapshotPath, normalized);
} catch {
    console.error('[brainbase-runtime] Infisical export normalization blocked');
    process.exit(1);
}
