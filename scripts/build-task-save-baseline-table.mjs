#!/usr/bin/env node

/**
 * Deterministic builder for the Task-save old/new equivalence comparison table
 * ("Task保存の新旧比較表を固定SHAで確定する", itsaplan UNS-231 / 2-qa-baseline).
 *
 * The completion contract for 2-qa-baseline has two parts:
 *   1. Pin the three baselines (旧経路 / OSS 正式 0.44.1 / 組織版 baaca) to their
 *      fixed *source revision* and the *artifact hash recorded at the time* of
 *      the 2026-10-19 run.
 *   2. Correspond the seven Task operations
 *      (作成 / 更新 / 状態遷移 / 削除 / 再試行 / 拒否 / 監査) to the existing
 *      evidence (the 11 recorded items), and mark whatever is not confirmed.
 *
 * This tool keeps two things strictly apart so the table stays honest:
 *
 *   - ACQUISITION (取得). Whether the evidence file is physically present at
 *     --root as non-empty, parseable JSON, and — if so — the sha256 of its
 *     bytes. This digest identifies the acquired *file*; it is NOT the source
 *     revision of a baseline nor the artifact hash recorded at run time. A
 *     missing, empty, or broken file is simply not acquired.
 *
 *   - VERIFICATION (確認). Whether a comparison row is actually proven: the
 *     baseline's pinned source revision and artifact digest, or an operation's
 *     mapping to specific evidence IDs among the existing 11. Proving this needs
 *     the originals' schema, which is not available in CI / on any runner / in
 *     the box. So verification is unimplemented and every row is reported
 *     未確認 — acquiring a file never flips a row to confirmed.
 *
 * Evidence is supplied explicitly by the caller; this tool has no customer
 * filesystem defaults and never uses the current source SHA as a stand-in.
 *
 * Usage:
 *   node scripts/build-task-save-baseline-table.mjs --root <dir> [--format json|markdown] [--require-complete]
 *
 *   --root              Directory holding the evidence-2026-10-19 bundle.
 *                       Alternatively: $TASK_BASELINE_EVIDENCE_ROOT.
 *   --format            json (default) or markdown.
 *   --require-complete   Exit 1 unless every row is confirmed. Until a
 *                       schema-aware verifier is implemented this always exits 1,
 *                       which is intentional: the table is not yet confirmable.
 *
 * Output is deterministic: identical inputs produce byte-identical output
 * (keys are emitted in a fixed order; no timestamps are read from the clock).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// A required source revision / artifact digest / operation correspondence that
// has not been proven. Verification needs the originals' schema, which is not
// available in this environment, so this is the value every row carries today.
export const UNVERIFIED = '未確認（原本スキーマ検証が必要）';

// The sha256 slot for an evidence file that is not acquired (missing, empty, or
// not parseable JSON). Distinct from UNVERIFIED on purpose: this is about the
// file not being here, not about a comparison being unproven.
export const UNACQUIRED = '未取得（原本未配置）';

// The three baselines the table pins, each to the evidence artifact that is
// expected to carry its source revision and artifact digest. `file` is relative
// to the evidence root.
export const BASELINES = Object.freeze([
    Object.freeze({
        id: 'legacy-unson',
        label: '旧経路（unson 旧実装）',
        file: 'task-equivalence-current-consolidated-20261019.json',
    }),
    Object.freeze({
        id: 'oss-0.44.1',
        label: 'OSS 正式 0.44.1',
        file: 'task-equivalence-formal-artifact-20261019.json',
    }),
    Object.freeze({
        id: 'org-baaca',
        label: '組織版（baaca 拡張）',
        file: 'task-equivalence-formal-extension-baaca-20261019.json',
    }),
]);

// The seven Task operations the migration must prove equivalent, each pointing
// at the evidence artifact that is expected to carry its new/old correspondence.
export const OPERATIONS = Object.freeze([
    Object.freeze({ id: 'create', label: '作成 (create)', file: 'task-equivalence-2qa-task-mapping-20261019.json' }),
    Object.freeze({ id: 'update', label: '更新 (update)', file: 'task-equivalence-2qa-task-mapping-20261019.json' }),
    Object.freeze({ id: 'status', label: '状態遷移 (status transition)', file: 'task-equivalence-2qa-task-mapping-20261019.json' }),
    Object.freeze({ id: 'delete', label: '削除 (delete)', file: 'task-equivalence-coverage-20261019.json' }),
    Object.freeze({ id: 'retry', label: '再試行 (retry)', file: 'task-equivalence-coverage-20261019.json' }),
    Object.freeze({ id: 'reject', label: '拒否 (reject)', file: 'task-equivalence-coverage-20261019.json' }),
    Object.freeze({ id: 'audit', label: '監査 (audit)', file: 'task-transport-pg-20261019/task-transport-pg-20261019.json' }),
]);

// Every evidence artifact the table depends on, in a fixed order.
export const REQUIRED_EVIDENCE = Object.freeze([
    'task-equivalence-2qa-task-mapping-20261019.json',
    'task-equivalence-formal-artifact-20261019.json',
    'task-equivalence-formal-extension-baaca-20261019.json',
    'task-equivalence-coverage-20261019.json',
    'task-equivalence-current-consolidated-20261019.json',
    'task-transport-pg-20261019/task-transport-pg-20261019.json',
]);

/**
 * Inspect one evidence artifact relative to `root` for ACQUISITION only. Never
 * throws. A file counts as acquired only when it is present, non-empty, and
 * parses as a non-empty JSON object/array; an empty or broken file is reported
 * as not acquired with a reason, and its byte digest is withheld.
 */
export function inspectArtifact(root, relativeFile) {
    const absPath = path.join(root, relativeFile);
    const base = { file: relativeFile, present: false, acquired: false, fileSha256: UNACQUIRED, bytes: null };
    let stat;
    try {
        stat = fs.statSync(absPath);
    } catch {
        return { ...base, reason: '原本未配置' };
    }
    if (!stat.isFile()) {
        return { ...base, reason: 'ファイルでない' };
    }
    const bytes = stat.size;
    if (bytes === 0) {
        return { ...base, present: true, bytes, reason: '空ファイル' };
    }
    let raw;
    try {
        raw = fs.readFileSync(absPath);
    } catch {
        return { ...base, present: true, bytes, reason: '読み取り不可' };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch {
        return { ...base, present: true, bytes, reason: '壊れたJSON' };
    }
    if (parsed === null || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
        return { ...base, present: true, bytes, reason: '意味情報の欠落（空のJSON）' };
    }
    return {
        file: relativeFile,
        present: true,
        acquired: true,
        fileSha256: createHash('sha256').update(raw).digest('hex'),
        bytes,
        reason: '取得済',
    };
}

/**
 * Verify a baseline row: its pinned source revision and the artifact hash
 * recorded at run time. Proving these needs the originals' schema, which is not
 * available here, so this is unimplemented and the row stays unconfirmed. The
 * acquired file's byte digest is deliberately NOT used as a stand-in for either
 * value. Implement once the 2026-10-19 originals and their schema are in hand.
 */
export function verifyBaseline(/* artifact */) {
    return { confirmed: false, sourceRevision: UNVERIFIED, artifactDigest: UNVERIFIED };
}

/**
 * Verify an operation row: which of the existing 11 evidence items it maps to
 * and the new/old correspondence. Unimplemented for the same reason as
 * verifyBaseline; the row stays unconfirmed.
 */
export function verifyOperation(/* artifact */) {
    return { confirmed: false, evidenceIds: UNVERIFIED, correspondence: UNVERIFIED };
}

/**
 * Build the full comparison table as a plain, deterministically ordered object.
 */
export function buildTable(root) {
    const artifacts = {};
    for (const file of REQUIRED_EVIDENCE) {
        artifacts[file] = inspectArtifact(root, file);
    }

    // Acquisition inventory: one row per required evidence file.
    const evidence = REQUIRED_EVIDENCE.map((file) => artifacts[file]);
    const acquiredCount = evidence.filter((a) => a.acquired).length;

    const baselines = BASELINES.map((baseline) => {
        const artifact = artifacts[baseline.file];
        const verdict = verifyBaseline(artifact);
        return {
            id: baseline.id,
            label: baseline.label,
            evidenceFile: baseline.file,
            acquired: artifact.acquired,
            fileSha256: artifact.fileSha256, // acquired-file digest only, never the source pin
            sourceRevision: verdict.sourceRevision,
            artifactDigest: verdict.artifactDigest,
            confirmed: verdict.confirmed,
        };
    });

    const operations = OPERATIONS.map((operation) => {
        const artifact = artifacts[operation.file];
        const verdict = verifyOperation(artifact);
        return {
            id: operation.id,
            label: operation.label,
            evidenceFile: operation.file,
            acquired: artifact.acquired,
            fileSha256: artifact.fileSha256, // acquired-file digest only
            evidenceIds: verdict.evidenceIds,
            correspondence: verdict.correspondence,
            confirmed: verdict.confirmed,
        };
    });

    const rows = [...baselines, ...operations];
    const confirmedCount = rows.filter((row) => row.confirmed).length;
    const totalCount = rows.length;

    return {
        schema: 'task-save-baseline-table-v2',
        work_package: '2-qa-baseline',
        itsaplan: 'UNS-231',
        evidenceRoot: root,
        acquiredCount,
        acquiredTotal: REQUIRED_EVIDENCE.length,
        confirmedCount,
        totalCount,
        // complete tracks VERIFICATION, never mere acquisition.
        complete: confirmedCount === totalCount,
        evidence,
        baselines,
        operations,
    };
}

function cell(value) {
    if (value === UNVERIFIED || value === UNACQUIRED) return value;
    return `\`${value}\``;
}

export function renderMarkdown(table) {
    const lines = [];
    lines.push(`# Task 保存 新旧比較表（${table.complete ? '固定SHA確定' : '未確定'}）`);
    lines.push('');
    lines.push(`- work_package: ${table.work_package}`);
    lines.push(`- itsaplan: ${table.itsaplan}`);
    lines.push(`- evidenceRoot: \`${table.evidenceRoot}\``);
    lines.push(`- 取得: ${table.acquiredCount}/${table.acquiredTotal} ファイル`);
    lines.push(`- 確認: ${table.confirmedCount}/${table.totalCount}${table.complete ? '（全確定）' : '（未確定あり）'}`);
    lines.push('');
    lines.push('## 取得目録（証拠ファイルの有無と byte digest）');
    lines.push('');
    lines.push('> この sha256 は取得した証拠ファイルの内容ハッシュであり、基準の固定SHAでも実行成果物hashでもない。');
    lines.push('');
    lines.push('| 証拠ファイル | 取得 | fileSha256 | 備考 |');
    lines.push('| --- | --- | --- | --- |');
    for (const artifact of table.evidence) {
        lines.push(`| \`${artifact.file}\` | ${artifact.acquired ? '済' : '未'} | ${cell(artifact.fileSha256)} | ${artifact.reason} |`);
    }
    lines.push('');
    lines.push('## 基準（固定SHA / 実行成果物hash）');
    lines.push('');
    lines.push('| 基準 | 証拠ファイル | 取得 | ソース固定SHA | 実行成果物hash | 確認 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const baseline of table.baselines) {
        lines.push(
            `| ${baseline.label} | \`${baseline.evidenceFile}\` | ${baseline.acquired ? '済' : '未'} | ` +
            `${cell(baseline.sourceRevision)} | ${cell(baseline.artifactDigest)} | ${baseline.confirmed ? '確認済' : '未確認'} |`,
        );
    }
    lines.push('');
    lines.push('## 7操作の対応');
    lines.push('');
    lines.push('| 操作 | 証拠ファイル | 取得 | 対応する証拠ID | 新旧対応 | 確認 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const operation of table.operations) {
        lines.push(
            `| ${operation.label} | \`${operation.evidenceFile}\` | ${operation.acquired ? '済' : '未'} | ` +
            `${cell(operation.evidenceIds)} | ${cell(operation.correspondence)} | ${operation.confirmed ? '確認済' : '未確認'} |`,
        );
    }
    lines.push('');
    return lines.join('\n');
}

export function parseArgs(argv) {
    const options = {
        root: process.env.TASK_BASELINE_EVIDENCE_ROOT,
        format: 'json',
        requireComplete: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--root') {
            options.root = argv[i + 1];
            i += 1;
        } else if (arg === '--format') {
            options.format = argv[i + 1];
            i += 1;
        } else if (arg === '--require-complete') {
            options.requireComplete = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!options.root) {
        throw new Error('--root (or TASK_BASELINE_EVIDENCE_ROOT) is required');
    }
    if (options.format !== 'json' && options.format !== 'markdown') {
        throw new Error(`--format must be json or markdown, got: ${options.format}`);
    }
    return options;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const table = buildTable(options.root);
    if (options.format === 'markdown') {
        process.stdout.write(`${renderMarkdown(table)}\n`);
    } else {
        process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
    }
    if (options.requireComplete && !table.complete) {
        process.stderr.write(
            `未確認の行が ${table.totalCount - table.confirmedCount} 件あります` +
            `（取得 ${table.acquiredCount}/${table.acquiredTotal}）。` +
            'ファイルの取得だけでは確定しません。原本スキーマに基づく検証（verifyBaseline / ' +
            'verifyOperation）を実装してから再実行してください。\n',
        );
        process.exitCode = 1;
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
