#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = 'docs/policies/repository-classification.md';
const RETIRED_ROOTS = ['shared/', '_codex/', 'settings/nocodb/', 'common/frameworks/'];
const REQUIRED_BOUNDARIES = ['brainbase-unson', 'brainbase-organization', 'growin-project'];

export function findRetiredTrackedPaths(paths) {
    return paths.filter((candidate) => RETIRED_ROOTS.some((root) => candidate.startsWith(root)));
}

export function validateRepositoryClassification({ trackedPaths, claude, agents, policyExists, policy }) {
    const errors = [];
    if (!policyExists) errors.push(`${POLICY_PATH} がありません`);
    if (claude !== agents) errors.push('CLAUDE.md と AGENTS.md が一致していません');
    if (!claude.includes(POLICY_PATH)) errors.push(`CLAUDE.md が ${POLICY_PATH} を参照していません`);

    const retired = findRetiredTrackedPaths(trackedPaths);
    if (retired.length > 0) errors.push(`廃止済みルートが追跡されています: ${retired.join(', ')}`);

    for (const boundary of REQUIRED_BOUNDARIES) {
        if (!policy.includes(boundary)) errors.push(`分類方針に ${boundary} の境界がありません`);
    }
    return errors;
}

export function checkRepository(repoRoot) {
    const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const policyFile = path.join(repoRoot, POLICY_PATH);
    const trackedPaths = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
    return validateRepositoryClassification({
        trackedPaths,
        claude: read('CLAUDE.md'),
        agents: read('AGENTS.md'),
        policyExists: fs.existsSync(policyFile),
        policy: fs.existsSync(policyFile) ? fs.readFileSync(policyFile, 'utf8') : ''
    });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const errors = checkRepository(repoRoot);
    if (errors.length > 0) {
        console.error(errors.map((error) => `- ${error}`).join('\n'));
        process.exitCode = 1;
    } else {
        console.log('Repository classification contract: OK');
    }
}
