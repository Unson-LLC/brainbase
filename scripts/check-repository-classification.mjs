#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = 'docs/policies/repository-classification.md';
const OWNERSHIP_PATH = 'docs/contracts/repository-ownership.json';
const RETIRED_ROOTS = ['shared/', '_codex/', 'settings/nocodb/', 'common/frameworks/'];
const REQUIRED_BOUNDARIES = ['brainbase-unson', 'brainbase-organization', 'growin-project'];
const OWNERSHIP_LIFECYCLES = new Set(['canonical', 'migration_pending', 'retired']);

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

export function validateOwnershipContract(contract, trackedPaths) {
    const errors = [];
    if (contract?.version !== 1) errors.push('所有台帳の version は 1 である必要があります');
    if (!Array.isArray(contract?.components) || contract.components.length === 0) {
        return [...errors, '所有台帳に components がありません'];
    }
    const seen = new Set();
    for (const component of contract.components) {
        const id = typeof component?.id === 'string' && component.id ? component.id : 'unknown';
        if (seen.has(id)) errors.push(`所有台帳の component id が重複しています: ${id}`);
        seen.add(id);
        for (const field of ['current_repository', 'final_repository', 'product_scope']) {
            if (typeof component?.[field] !== 'string' || !component[field]) {
                errors.push(`${id} に ${field} がありません`);
            }
        }
        if (!OWNERSHIP_LIFECYCLES.has(component?.lifecycle)) {
            errors.push(`${id} の lifecycle が不正です: ${component?.lifecycle ?? 'undefined'}`);
        }
        if (component?.lifecycle === 'migration_pending') {
            if (component.current_repository === component.final_repository) {
                errors.push(`${id} の移管先が現所在地と同じです`);
            }
            if (typeof component.migration_condition !== 'string' || !component.migration_condition.trim()) {
                errors.push(`${id} に migration_condition がありません`);
            }
        }
        if (!Array.isArray(component?.current_paths) || component.current_paths.length === 0) {
            errors.push(`${id} に current_paths がありません`);
            continue;
        }
        if (component.current_repository === 'brainbase-unson') {
            for (const currentPath of component.current_paths) {
                if (!trackedPaths.has(currentPath)) errors.push(`${id} の現物が追跡されていません: ${currentPath}`);
            }
        }
    }
    return errors;
}

export function checkRepository(repoRoot) {
    const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const policyFile = path.join(repoRoot, POLICY_PATH);
    const ownershipFile = path.join(repoRoot, OWNERSHIP_PATH);
    const trackedPaths = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
    const errors = validateRepositoryClassification({
        trackedPaths,
        claude: read('CLAUDE.md'),
        agents: read('AGENTS.md'),
        policyExists: fs.existsSync(policyFile),
        policy: fs.existsSync(policyFile) ? fs.readFileSync(policyFile, 'utf8') : ''
    });
    if (!fs.existsSync(ownershipFile)) return [...errors, `${OWNERSHIP_PATH} がありません`];
    let ownership;
    try {
        ownership = JSON.parse(fs.readFileSync(ownershipFile, 'utf8'));
    } catch {
        return [...errors, `${OWNERSHIP_PATH} をJSONとして読めません`];
    }
    return [...errors, ...validateOwnershipContract(ownership, new Set(trackedPaths))];
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
