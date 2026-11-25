import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    BASELINES,
    OPERATIONS,
    REQUIRED_EVIDENCE,
    UNACQUIRED,
    UNVERIFIED,
    buildTable,
    inspectArtifact,
    parseArgs,
    renderMarkdown,
} from '../scripts/build-task-save-baseline-table.mjs';

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

async function writeArtifact(root, relativeFile, body) {
    const absPath = path.join(root, relativeFile);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, body);
}

async function writeFullBundle(root) {
    const bodies = {};
    for (const [index, file] of REQUIRED_EVIDENCE.entries()) {
        const body = `{"evidence":"${file}","n":${index}}`;
        bodies[file] = body;
        await writeArtifact(root, file, body);
    }
    return bodies;
}

function expectNeverConfirmed(table) {
    expect(table.complete).toBe(false);
    expect(table.confirmedCount).toBe(0);
    for (const baseline of table.baselines) {
        expect(baseline.confirmed).toBe(false);
        expect(baseline.sourceRevision).toBe(UNVERIFIED);
        expect(baseline.artifactDigest).toBe(UNVERIFIED);
    }
    for (const operation of table.operations) {
        expect(operation.confirmed).toBe(false);
        expect(operation.evidenceIds).toBe(UNVERIFIED);
        expect(operation.correspondence).toBe(UNVERIFIED);
    }
}

describe('build-task-save-baseline-table', () => {
    let root;

    beforeEach(() => {
        root = mkdtempSync(path.join(os.tmpdir(), 'task-save-baseline-'));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('marks every row unverified and unacquired when the bundle is absent', () => {
        const table = buildTable(root);
        expect(table.totalCount).toBe(BASELINES.length + OPERATIONS.length);
        expect(table.acquiredCount).toBe(0);
        expect(table.acquiredTotal).toBe(REQUIRED_EVIDENCE.length);
        expectNeverConfirmed(table);
        const markdown = renderMarkdown(table);
        expect(markdown.split('\n')[0]).toBe('# Task 保存 新旧比較表（未確定）');
        expect(markdown).not.toContain('固定SHA確定');
        expect(markdown).toContain('| fileSha256 |');
        for (const artifact of table.evidence) {
            expect(artifact.acquired).toBe(false);
            expect(artifact.fileSha256).toBe(UNACQUIRED);
        }
        for (const baseline of table.baselines) {
            expect(baseline.acquired).toBe(false);
            expect(baseline.fileSha256).toBe(UNACQUIRED);
        }
    });

    it('acquires present files but never confirms a row on presence alone', async () => {
        const bodies = await writeFullBundle(root);

        const table = buildTable(root);
        // Every file is acquired...
        expect(table.acquiredCount).toBe(REQUIRED_EVIDENCE.length);
        for (const artifact of table.evidence) {
            expect(artifact.acquired).toBe(true);
            expect(artifact.fileSha256).toBe(sha256(bodies[artifact.file]));
        }
        for (const baseline of table.baselines) {
            expect(baseline.acquired).toBe(true);
            expect(baseline.fileSha256).toBe(sha256(bodies[baseline.evidenceFile]));
        }
        // ...but the comparison is still entirely unconfirmed (regression for
        // "file existence must not become complete/confirmed").
        expectNeverConfirmed(table);
    });

    it('keeps the acquired-file digest separate from the source pin and artifact hash', async () => {
        const bodies = await writeFullBundle(root);
        const table = buildTable(root);
        for (const baseline of table.baselines) {
            const fileDigest = sha256(bodies[baseline.evidenceFile]);
            expect(baseline.fileSha256).toBe(fileDigest);
            // The required values are NOT the evidence-file digest.
            expect(baseline.sourceRevision).not.toBe(fileDigest);
            expect(baseline.artifactDigest).not.toBe(fileDigest);
            expect(baseline.sourceRevision).toBe(UNVERIFIED);
            expect(baseline.artifactDigest).toBe(UNVERIFIED);
        }
    });

    it('does not acquire empty files', async () => {
        for (const file of REQUIRED_EVIDENCE) {
            await writeArtifact(root, file, '');
        }
        const table = buildTable(root);
        expect(table.acquiredCount).toBe(0);
        for (const artifact of table.evidence) {
            expect(artifact.present).toBe(true);
            expect(artifact.acquired).toBe(false);
            expect(artifact.fileSha256).toBe(UNACQUIRED);
            expect(artifact.reason).toBe('空ファイル');
        }
        expectNeverConfirmed(table);
    });

    it('does not acquire broken JSON or semantically empty JSON', async () => {
        const broken = REQUIRED_EVIDENCE[0];
        const emptyObject = REQUIRED_EVIDENCE[1];
        await writeArtifact(root, broken, '{not json');
        await writeArtifact(root, emptyObject, '{}');
        for (const file of REQUIRED_EVIDENCE.slice(2)) {
            await writeArtifact(root, file, `{"evidence":"${file}"}`);
        }
        const brokenRow = inspectArtifact(root, broken);
        expect(brokenRow.acquired).toBe(false);
        expect(brokenRow.reason).toBe('壊れたJSON');
        const emptyRow = inspectArtifact(root, emptyObject);
        expect(emptyRow.acquired).toBe(false);
        expect(emptyRow.reason).toBe('意味情報の欠落（空のJSON）');

        const table = buildTable(root);
        expect(table.acquiredCount).toBe(REQUIRED_EVIDENCE.length - 2);
        expectNeverConfirmed(table);
    });

    it('reports a file-type / absent artifact as not acquired', () => {
        const missing = inspectArtifact(root, 'does-not-exist.json');
        expect(missing.present).toBe(false);
        expect(missing.acquired).toBe(false);
        expect(missing.fileSha256).toBe(UNACQUIRED);
        expect(missing.reason).toBe('原本未配置');
    });

    it('is deterministic across runs for the same inputs', async () => {
        await writeFullBundle(root);
        expect(JSON.stringify(buildTable(root))).toBe(JSON.stringify(buildTable(root)));
        expect(renderMarkdown(buildTable(root))).toBe(renderMarkdown(buildTable(root)));
    });

    it('renders markdown with the acquisition inventory and explicit 未確認 columns', async () => {
        const bodies = await writeFullBundle(root);
        const markdown = renderMarkdown(buildTable(root));
        expect(markdown.split('\n')[0]).toBe('# Task 保存 新旧比較表（未確定）');
        expect(markdown).not.toContain('固定SHA確定');
        expect(markdown).toContain('取得目録');
        expect(markdown).toContain('OSS 正式 0.44.1');
        expect(markdown).toContain('監査 (audit)');
        // Acquisition digest is shown in the inventory...
        expect(markdown).toContain(sha256(bodies['task-equivalence-coverage-20261019.json']));
        // ...and the required source/artifact values remain explicitly 未確認.
        expect(markdown).toContain(UNVERIFIED);
        expect(markdown).toContain('ソース固定SHA');
        expect(markdown).toContain('実行成果物hash');
    });

    it('exits nonzero for --require-complete even with a full acquired bundle', async () => {
        await writeFullBundle(root);
        const cli = fileURLToPath(new URL('../scripts/build-task-save-baseline-table.mjs', import.meta.url));
        const result = spawnSync(process.execPath, [cli, '--root', root, '--require-complete'], { encoding: 'utf8' });
        expect(result.status).toBe(1);
        const table = JSON.parse(result.stdout);
        expect(table.acquiredCount).toBe(6);
        expectNeverConfirmed(table);
        expect(result.stderr).toContain('未確認の行が 10 件');
    });

    it('requires an explicit root and parses arguments', () => {
        const env = process.env.TASK_BASELINE_EVIDENCE_ROOT;
        delete process.env.TASK_BASELINE_EVIDENCE_ROOT;
        try {
            expect(() => parseArgs([])).toThrow(/--root/);
            process.env.TASK_BASELINE_EVIDENCE_ROOT = '/tmp/from-env';
            expect(parseArgs([]).root).toBe('/tmp/from-env');
            delete process.env.TASK_BASELINE_EVIDENCE_ROOT;
            expect(parseArgs(['--root', '/tmp/x', '--format', 'markdown', '--require-complete'])).toEqual({
                root: '/tmp/x',
                format: 'markdown',
                requireComplete: true,
            });
            expect(() => parseArgs(['--root', root, '--format', 'yaml'])).toThrow(/--format/);
            expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
        } finally {
            if (env !== undefined) process.env.TASK_BASELINE_EVIDENCE_ROOT = env;
        }
    });
});
