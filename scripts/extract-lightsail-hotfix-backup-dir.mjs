#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const marker = 'BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR=';
const allowedPath = /^\/home\/ubuntu\/brainbase-production-hotfix-[A-Za-z0-9._-]+$/u;
const lines = readFileSync(0, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(marker));

if (lines.length !== 1) {
    console.error(`expected exactly one ${marker} marker, received ${lines.length}`);
    process.exit(1);
}

const path = lines[0].slice(marker.length);
if (!allowedPath.test(path)) {
    console.error('invalid Lightsail hotfix backup directory');
    process.exit(1);
}

process.stdout.write(`${path}\n`);
