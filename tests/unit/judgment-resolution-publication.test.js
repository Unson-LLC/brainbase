import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(path, 'utf8');
}

function expectProductionNotRunInUserFacingPrBody(body) {
    expect(body).not.toContain('保存済み説明は現在の証拠と一致しないため表示していません');
    const acceptanceCriteriaIndex = body.indexOf('## Acceptance criteria');
    expect(acceptanceCriteriaIndex).toBeGreaterThanOrEqual(0);
    const userFacingSummary = body.slice(0, acceptanceCriteriaIndex);
    expect(userFacingSummary).toContain('現在の本番実行状態は production_execution_status=not_run');
}

describe('judgment resolver publication surfaces', () => {
    it('本番hotfix退避先を複数行出力から1件だけ抽出し、不正markerを拒否する', () => {
        const parser = 'scripts/extract-lightsail-hotfix-backup-dir.mjs';
        const validPath = '/home/ubuntu/brainbase-production-hotfix-20260902T000000Z';
        const run = (input) =>
            spawnSync(process.execPath, [parser], {
                input,
                encoding: 'utf8',
            });

        const valid = run(
            `[rollback/production-hotfix 123] preserve\n4 files changed\nBRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR=${validPath}\n`
        );
        expect(valid.status).toBe(0);
        expect(valid.stdout).toBe(`${validPath}\n`);

        for (const invalid of [
            'commit output only\n',
            `BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR=${validPath}\nBRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR=${validPath}-2\n`,
            'BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR=/tmp/brainbase-production-hotfix-invalid\n',
        ]) {
            const result = run(invalid);
            expect(result.status).not.toBe(0);
            expect(result.stdout).toBe('');
        }

        const shellIntegration = spawnSync(
            'bash',
            [
                '-eu',
                '-o',
                'pipefail',
                '-c',
                `BACKUP_DIR="$(printf 'invalid\\n' | ${process.execPath} ${parser})"; export BACKUP_DIR; printf 'survived\\n'`,
            ],
            { encoding: 'utf8' }
        );
        expect(shellIntegration.status).not.toBe(0);
        expect(shellIntegration.stdout).not.toContain('survived');

        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        expect(runbook).not.toContain('export BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR="$(');
        expect(runbook).toMatch(
            /BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR="\$\([\s\S]*?extract-lightsail-hotfix-backup-dir\.mjs[\s\S]*?\)"\nexport BRAINBASE_LIGHTSAIL_HOTFIX_BACKUP_DIR/u
        );
    });

    it('本番hotfixの復旧証跡を検証してからmerge済みSHAへ切り替える', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const forward = runbook.slice(
            runbook.indexOf('production dirty hotfix reconciliationを実行した場合'),
            runbook.indexOf('### Verification')
        );

        expect(runbook).toContain('node scripts/extract-lightsail-hotfix-backup-dir.mjs');
        expect(forward).toContain('test "$(cat "$HOTFIX_BACKUP_DIR/rollback.sha")" = "$ROLLBACK_SHA"');
        expect(forward).toContain('sha256sum -c "$HOTFIX_BACKUP_DIR/content.sha256"');
        expect(forward).toContain('test "$(git rev-parse origin/develop)" = "$TARGET_SHA"');
        expect(forward).toContain('git switch --detach "$TARGET_SHA"');
        expect(forward.indexOf('rollback.sha')).toBeLessThan(
            forward.indexOf('git switch --detach "$TARGET_SHA"')
        );
        expect(forward.indexOf('content.sha256')).toBeLessThan(
            forward.indexOf('git switch --detach "$TARGET_SHA"')
        );
    });

    it('本番収束receiptが設定・4面・Ontology・Graph検証を同一runへ束縛する', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const convergence = runbook.slice(
            runbook.indexOf('### Production convergence receipt'),
            runbook.indexOf('### Verification')
        );

        expect(convergence).toContain('BRAINBASE_PRODUCTION_RUN_ID');
        expect(convergence).toContain('ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY');
        expect(convergence).toContain('ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY');
        expect(convergence).toContain('ONTOLOGY_PUBLICATION_SIGNING_KEY_ID');
        expect(convergence).toContain('public_key_override_present_before');
        expect(convergence).toContain('public_key_override_present_after');
        expect(convergence).toContain('private_key_preserved');
        expect(convergence).toContain('key_id_preserved');
        expect(convergence).toContain('secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY');
        expect(convergence).toContain('--type shared');
        expect(convergence).toContain('global_hook_sha');
        expect(convergence).toContain('local_ui_sha');
        expect(convergence).toContain('mcp_runtime_sha');
        expect(convergence).toContain('/health/version');
        expect(convergence).toContain('mcp.version.json');
        expect(convergence).toContain('lightsail_sha');
        expect(convergence).toContain('surfaces.evidence.json');
        expect(convergence).toContain('process_sha');
        expect(convergence).toContain('readiness');
        expect(convergence).toContain('entrypoint_sha256');
        expect(convergence).toContain('npm run ontology:verify');
        expect(convergence).toContain('ontology.evidence.json');
        expect(convergence).toContain('repository_digest');
        expect(convergence).toContain('production_digest');
        expect(convergence).toContain('production.publication_verification');
        expect(convergence).toContain('trust_source: verification.trust_source');
        expect(convergence).toContain('signature_verification: verification.status');
        expect(convergence).toContain("evidence.trust_source !== 'git_trust_store'");
        expect(convergence).toContain("evidence.signature_verification !== 'verified'");
        expect(convergence).toContain('/api/info/graph/maintenance/validate');
        expect(convergence).toContain('"strict_collection":true');
        expect(convergence).toContain('graph_http_status');
        expect(convergence).toContain('snapshot_hash');
        expect(convergence).toContain('collection_complete');
        expect(convergence).toContain('suppressed_edge_count');
        expect(convergence).toContain('suppression_reasons');
        expect(convergence).toContain('structural_violation_count');
        expect(convergence).toContain('ontology_violation_count');
        expect(convergence).toContain('graph_valid');
        expect(convergence).toContain('production-convergence-receipt.json');
        expect(convergence).toContain('cp "$BRAINBASE_ROLLBACK_STATE_DIR/infisical.before.json"');

        expect(convergence.indexOf('public_key_override_present_before')).toBeLessThan(
            convergence.indexOf('secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY')
        );
        expect(convergence.indexOf('secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY')).toBeLessThan(
            convergence.indexOf('public_key_override_present_after')
        );
        expect(convergence.indexOf('npm run ontology:verify')).toBeLessThan(
            convergence.indexOf('/api/info/graph/maintenance/validate')
        );

        expect(convergence).toMatch(/suppressed_edge_count !== 0[\s\S]*?process\.exit\(1\)/u);
    });

    it('本番収束の途中失敗を秘密値なしのoperator向けreceiptへ固定する', () => {
        const runDir = mkdtempSync(join(tmpdir(), 'brainbase-production-failure-'));
        try {
            const result = spawnSync(
                process.execPath,
                ['scripts/write-production-convergence-failure-receipt.mjs'],
                {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        BRAINBASE_PRODUCTION_RUN_DIR: runDir,
                        BRAINBASE_PRODUCTION_RUN_ID: 'production-convergence-test',
                        BRAINBASE_PRODUCTION_TARGET_SHA: 'a'.repeat(40),
                        BRAINBASE_PRODUCTION_STAGE: 'infisical_snapshot_before',
                        BRAINBASE_PRODUCTION_STATE_CHANGED: 'true',
                        BRAINBASE_PRODUCTION_EXIT_CODE: '23',
                        ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY: 'must-not-leak',
                    },
                }
            );

            expect(result.status).toBe(0);
            const receiptPath = join(runDir, 'production-convergence-failure.json');
            const raw = readFileSync(receiptPath, 'utf8');
            const receipt = JSON.parse(raw);
            expect(receipt).toMatchObject({
                schema_version: 'brainbase.production-convergence-failure.v1',
                run_id: 'production-convergence-test',
                target_sha: 'a'.repeat(40),
                status: 'failed',
                failed_stage: 'infisical_snapshot_before',
                state_changed: true,
                rollback_required: true,
                secret_cleanup: {
                    local_attempted: false,
                    local_confirmed: false,
                    remote_attempted: false,
                    remote_confirmed: false,
                },
                exit_code: 23,
            });
            expect(receipt.evidence_paths).toEqual(expect.any(Array));
            expect(raw).not.toContain('must-not-leak');
            expect(result.stderr).toContain('rollback_required=true');
        } finally {
            rmSync(runDir, { recursive: true, force: true });
        }

        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const convergence = runbook.slice(
            runbook.indexOf('### Production convergence receipt'),
            runbook.indexOf('### Verification')
        );
        expect(convergence).toContain("trap 'write_production_failure_receipt $?' ERR");
        expect(convergence).toContain('BRAINBASE_PRODUCTION_STAGE=');
        expect(convergence).toContain('BRAINBASE_PRODUCTION_STATE_CHANGED=true');
        expect(convergence).not.toContain('BRAINBASE_PRODUCTION_STATE_CHANGED=false');
        expect(convergence.indexOf("trap 'write_production_failure_receipt $?' ERR")).toBeLessThan(
            convergence.indexOf('$(date -u +%Y%m%dT%H%M%SZ)')
        );
        expect(convergence.indexOf("trap 'write_production_failure_receipt $?' ERR")).toBeLessThan(
            convergence.indexOf('$(mktemp -d')
        );
        expect(convergence).toContain('status=unknown stage=%s rollback_required=true');
        expect(convergence).not.toContain('${TARGET_SHA:?');
        expect(convergence).not.toContain('${BRAINBASE_ROLLBACK_STATE_DIR:?');
        expect(convergence.indexOf('BRAINBASE_PRODUCTION_STATE_CHANGED=true')).toBeLessThan(
            convergence.indexOf('BRAINBASE_PRODUCTION_STAGE=infisical_snapshot_before')
        );
        expect(convergence.indexOf('BRAINBASE_PRODUCTION_STATE_CHANGED=true')).toBeLessThan(
            convergence.indexOf('secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY')
        );
        expect(convergence).toContain('production-convergence-failure.json');
        expect(convergence).toContain('rollback_required');
        expect(convergence).toContain('trap - ERR');

        const initialization = convergence.slice(
            convergence.indexOf('set -euo pipefail'),
            convergence.indexOf('INFISICAL=')
        );
        const {
            TARGET_SHA: _targetSha,
            BRAINBASE_ROLLBACK_STATE_DIR: _rollbackStateDir,
            ...initializationEnv
        } = process.env;
        const initializationFailure = spawnSync('/bin/bash', ['-c', initialization], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: initializationEnv,
        });
        expect(initializationFailure.status).not.toBe(0);
        expect(initializationFailure.stderr).toContain('status=unknown stage=preflight rollback_required=true');
    });

    it('本番収束の正常・失敗経路でlocalとremoteの秘密一時ファイルを削除する', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const convergence = runbook.slice(
            runbook.indexOf('### Production convergence receipt'),
            runbook.indexOf('### Verification')
        );
        const cleanupStart = convergence.indexOf('cleanup_production_secrets() {');
        const cleanupEnd = convergence.indexOf('\nwrite_production_failure_receipt()', cleanupStart);
        expect(cleanupStart).toBeGreaterThanOrEqual(0);
        expect(cleanupEnd).toBeGreaterThan(cleanupStart);
        const cleanupBlock = convergence.slice(cleanupStart, cleanupEnd);
        const root = mkdtempSync(join(tmpdir(), 'brainbase-production-secret-cleanup-'));
        for (const name of [
            'infisical.before.json',
            'infisical.deployed-before.json',
            'infisical.after.json',
            '.env.infisical',
        ]) writeFileSync(join(root, name), 'secret-value\n', { mode: 0o600 });
        const cleanup = spawnSync('bash', ['-c', `set -euo pipefail\n${cleanupBlock}\ncleanup_production_secrets`], {
            encoding: 'utf8',
            env: { ...process.env, BRAINBASE_PRODUCTION_RUN_DIR: root },
        });
        expect(cleanup.status).toBe(0);
        for (const name of [
            'infisical.before.json',
            'infisical.deployed-before.json',
            'infisical.after.json',
            '.env.infisical',
        ]) expect(existsSync(join(root, name))).toBe(false);
        expect(convergence).toContain("trap 'cleanup_production_secrets >/dev/null 2>&1 || true' EXIT");
        expect(convergence).toContain('trap cleanup_remote_env EXIT');
        expect(convergence).toContain('test ! -e "$REMOTE_ENV"');
        expect(convergence).toContain('BRAINBASE_PRODUCTION_REMOTE_SECRET_CLEANUP_CONFIRMED=true');
        expect(convergence).toContain('if (!Object.values(receipt.secret_cleanup).every(Boolean)) process.exit(1)');

        const remoteStart = convergence.indexOf(
            'set -euo pipefail\nREMOTE_ENV="$1"\nTARGET_SHA="$2"\ncleanup_remote_env()'
        );
        const remoteEnd = convergence.indexOf('\nREMOTE\nthen', remoteStart);
        expect(remoteStart).toBeGreaterThanOrEqual(0);
        expect(remoteEnd).toBeGreaterThan(remoteStart);
        const remoteBlock = convergence.slice(remoteStart, remoteEnd);
        const remoteRoot = mkdtempSync(join(tmpdir(), 'brainbase-production-remote-cleanup-'));
        const remoteBin = join(remoteRoot, 'bin');
        mkdirSync(remoteBin);
        writeFileSync(join(remoteBin, 'sudo'), '#!/bin/sh\nexit 19\n', { mode: 0o755 });
        const remoteTransfer = join(remoteRoot, 'remote.env');
        writeFileSync(remoteTransfer, 'remote-secret-value\n', { mode: 0o600 });
        const remoteFailure = spawnSync('bash', ['-c', remoteBlock, 'remote-cleanup', remoteTransfer, 'a'.repeat(40)], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${remoteBin}:${process.env.PATH}` },
        });
        expect(remoteFailure.status).not.toBe(0);
        expect(existsSync(remoteTransfer)).toBe(false);
        rmSync(root, { recursive: true, force: true });
        rmSync(remoteRoot, { recursive: true, force: true });
    });

    it('利用者向けPR本文がAC引用とは別に本番実行前であることを明示する', () => {
        const marker = 'production_execution_status=not_run';
        expect(read('docs/management/stories/active/story-brainbase-production-artifact-reconciliation.md')).toContain(
            marker
        );
        expect(read('docs/architecture/story-brainbase-production-artifact-reconciliation.md')).toContain(marker);
        expect(read('.vibepro/spec/story-brainbase-production-artifact-reconciliation/spec.json')).toContain(marker);

        expectProductionNotRunInUserFacingPrBody(`### 保存済みの判断説明

現在の本番実行状態は production_execution_status=not_run。PR・CI完了後に本番反映します。

## Acceptance criteria

- AC-007: ${marker}
`);
        expect(() => expectProductionNotRunInUserFacingPrBody(`### 保存済みの判断説明

> ⚠️ 保存済み説明は現在の証拠と一致しないため表示していません。

## Acceptance criteria

- AC-007: ${marker}
`)).toThrow();

        const generatedPrBody = '.vibepro/pr/story-brainbase-production-artifact-reconciliation/pr-body.md';
        if (existsSync(generatedPrBody)) expectProductionNotRunInUserFacingPrBody(read(generatedPrBody));
    });

    it('通常taskと委譲taskの本番証拠を別E2E・別rollback条件に保つ', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const story = read('docs/management/stories/active/story-brainbase-production-artifact-reconciliation.md');
        const spec = read('docs/specs/story-brainbase-production-artifact-reconciliation-v1.md');
        const machineSpec = JSON.parse(read('.vibepro/spec/story-brainbase-production-artifact-reconciliation/spec.json'));
        const normalVerifier = 'tests/e2e/story-brainbase-judgment-resolver-v1-live-session.spec.ts';
        const delegatedVerifier = 'tests/e2e/story-brainbase-judgment-resolver-delegation-recovery-live-session.spec.ts';
        const normalCase = 'story-brainbase-judgment-resolver-v1 がcurrent runのglobal hook・回帰suite・final receiptを検証する';
        const delegatedCase = 'delegated fresh task proves post-generation recovery without impersonating UserPromptSubmit';

        expect(runbook).toContain('route_application=pre_generation');
        expect(runbook).toContain('episode_origin=stop_delegation_recovery');
        expect(runbook).toContain('route_application=post_generation_recovery');
        expect(runbook).toContain(delegatedVerifier);
        expect(runbook).toContain('brainbase-owner-visible-readback-v1');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_OWNER_VISIBLE_PATH');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_DELEGATION_E2E_OWNER_VISIBLE_PATH');
        expect(runbook).toContain('session_meta.payload.id');
        expect(runbook).toContain('system_message_digest');
        expect(runbook).toContain('occurrences');
        expect(runbook).toContain('event_id');
        expect(runbook).toContain('final_event_fingerprint');
        expect(runbook).toContain('never use a recovered Stop episode as evidence that `UserPromptSubmit` guided generation');
        expect(runbook).toContain("Never substitute one path's evidence for the other");
        expect(read(normalVerifier)).toContain('BRAINBASE_JUDGMENT_E2E_OWNER_VISIBLE_PATH');
        expect(read(normalVerifier)).toContain('brainbase-owner-visible-readback-v1');
        expect(read(normalVerifier)).toContain('system_message_digest');
        expect(read(normalVerifier)).toContain('occurrences');
        expect(read(normalVerifier)).toContain('event_id');
        expect(read(normalVerifier)).toContain('final_event_fingerprint');
        expect(read(normalVerifier)).toContain('session_meta.payload.id');
        expect(read(delegatedVerifier)).toContain('BRAINBASE_JUDGMENT_DELEGATION_E2E_OWNER_VISIBLE_PATH');
        expect(read(delegatedVerifier)).toContain('brainbase-owner-visible-readback-v1');
        expect(read(delegatedVerifier)).toContain('system_message_digest');
        expect(read(delegatedVerifier)).toContain('occurrences');
        expect(read(delegatedVerifier)).toContain('event_id');
        expect(read(delegatedVerifier)).toContain('final_event_fingerprint');
        expect(read(delegatedVerifier)).toContain('session_meta.payload.id');
        expect(read(delegatedVerifier)).toContain('Brainbase判断レシート exactly once');
        expect(read(delegatedVerifier)).toContain('Delegated continuation canary must record exactly one value proof');
        expect(read(delegatedVerifier)).toContain(
            "assert.equal(final.owner_audit_source, 'stop_hook_system_message')"
        );
        expect(read(delegatedVerifier)).toContain('The Host-rendered judgment receipt must not be duplicated in the assistant body');
        expect(read(delegatedVerifier)).toContain('Stop recovery must never claim pre-generation guidance');
        expect(story).toContain('2つのfresh task');
        expect(spec).toContain('2つの新しいCodexタスク');
        expect(spec).toContain(normalVerifier);
        expect(spec).toContain(delegatedVerifier);
        for (const id of ['C-005', 'S-003']) {
            const contract = machineSpec.clauses.find((entry) => entry.id === id);
            expect(contract.origin.test_refs).toEqual(expect.arrayContaining([
                { file: normalVerifier, case: normalCase },
                { file: delegatedVerifier, case: delegatedCase }
            ]));
            expect(contract.verifiable_by.test_pattern).toEqual(expect.arrayContaining([
                { file_glob: normalVerifier, must_cover: normalCase },
                { file_glob: delegatedVerifier, must_cover: delegatedCase }
            ]));
        }
    });

    it('公開鍵override除去をforward-only修復としてrollback後も維持する', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const verifier = read('scripts/verify-production-signing-config.mjs');
        const capture = runbook.slice(
            runbook.indexOf('### Pre-deployment rollback capture'),
            runbook.indexOf('### Production convergence receipt')
        );
        const rollback = runbook.slice(
            runbook.indexOf('### Rollback'),
            runbook.indexOf('## Autonomy Gate rollout')
        );

        expect(capture).toContain('infisical.before.json');
        expect(capture).toContain('ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY');
        expect(capture).toContain('ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY');
        expect(capture).toContain('ONTOLOGY_PUBLICATION_SIGNING_KEY_ID');
        expect(rollback).toContain('forward-only incident remediation');
        expect(rollback).toContain('secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY');
        expect(rollback).toContain('infisical.rollback-final.json');
        expect(rollback).toContain('$BRAINBASE_SOURCE_ROOT/scripts/verify-production-signing-config.mjs" final');
        expect(verifier).toContain('private_key_preserved_after_rollback');
        expect(verifier).toContain('key_id_preserved_after_rollback');
        expect(rollback).toContain('infisical.rollback.evidence.json');
        expect(verifier).toContain('private_key_preserved_before_delete');
        expect(verifier).toContain('key_id_preserved_before_delete');
        expect(rollback.indexOf('$BRAINBASE_SOURCE_ROOT/scripts/verify-production-signing-config.mjs" pre-delete')).toBeLessThan(
            rollback.indexOf('secrets delete ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY')
        );
        expect(rollback).toContain('REMOTE_TRANSFER_SHA');
        expect(rollback.indexOf('test "$REMOTE_TRANSFER_SHA" = "$EXPECTED_ENV_SHA"')).toBeLessThan(
            rollback.indexOf('sudo mv "$REMOTE_TARGET_NEXT" "$TARGET_ENV"')
        );
        expect(rollback).toContain('test "$ACTUAL_ENV_SHA" = "$EXPECTED_ENV_SHA"');
        expect(rollback.indexOf('infisical.rollback.evidence.json')).toBeLessThan(
            rollback.indexOf('Restore the exact previous Hook config last')
        );
        for (const contract of [
            read('docs/management/stories/active/story-brainbase-production-artifact-reconciliation.md'),
            read('docs/architecture/story-brainbase-production-artifact-reconciliation.md'),
            read('.vibepro/spec/story-brainbase-production-artifact-reconciliation/spec.json')
        ]) {
            expect(contract).toContain('forward-only incident remediation');
            expect(contract).toContain('秘密鍵');
            expect(contract).toContain('key_id');
            expect(contract).toContain('Lightsail');
        }
    });

    it('署名設定rollbackを変更前と変更後に秘密値非表示でfail-closed検証する', () => {
        const root = mkdtempSync(join(tmpdir(), 'brainbase-signing-rollback-'));
        const script = 'scripts/verify-production-signing-config.mjs';
        const writeJson = (name, value) => {
            const path = join(root, name);
            writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
            return path;
        };
        const beforeValue = {
            ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: 'invalid-public',
            ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY: 'private-secret',
            ONTOLOGY_PUBLICATION_SIGNING_KEY_ID: 'key-id',
        };
        const before = writeJson('before.json', beforeValue);
        const run = (mode, observedValue, evidenceName) => {
            const observed = writeJson(`${evidenceName}.observed.json`, observedValue);
            const evidencePath = join(root, `${evidenceName}.evidence.json`);
            const result = spawnSync(process.execPath, [script, mode, before, observed, evidencePath], { encoding: 'utf8' });
            return { result, evidence: JSON.parse(readFileSync(evidencePath, 'utf8')) };
        };

        const ready = run('pre-delete', beforeValue, 'ready');
        expect(ready.result.status).toBe(0);
        expect(ready.evidence.status).toBe('ready_to_repair');

        const drift = run('pre-delete', { ...beforeValue, ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY: 'drifted-secret' }, 'drift');
        expect(drift.result.status).not.toBe(0);
        expect(drift.evidence).toMatchObject({
            status: 'blocked',
            rollback_complete: false,
            partial_state: true,
            next_action: 'stop_and_inspect_saved_rollback_state',
            private_key_preserved_before_delete: false,
        });
        const driftOutput = `${drift.result.stdout}${drift.result.stderr}${JSON.stringify(drift.evidence)}`;
        expect(driftOutput).not.toContain('private-secret');
        expect(driftOutput).not.toContain('drifted-secret');

        const repaired = { ...beforeValue };
        delete repaired.ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY;
        const final = run('final', repaired, 'final');
        expect(final.result.status).toBe(0);
        expect(final.evidence).toMatchObject({
            status: 'signing_config_repaired',
            rollback_complete: false,
            signing_config_repair_complete: true,
            public_key_override_present: false,
        });

        const keyIdDrift = run('pre-delete', { ...beforeValue, ONTOLOGY_PUBLICATION_SIGNING_KEY_ID: 'drifted-key-id' }, 'key-id-drift');
        expect(keyIdDrift.result.status).not.toBe(0);
        expect(keyIdDrift.evidence).toMatchObject({ status: 'blocked', key_id_preserved_before_delete: false });

        const outsideCwdEvidence = join(root, 'outside-cwd.evidence.json');
        const outsideCwd = spawnSync(process.execPath, [join(process.cwd(), script), 'pre-delete', before, before, outsideCwdEvidence], {
            cwd: root,
            encoding: 'utf8',
        });
        expect(outsideCwd.status).toBe(0);
        expect(JSON.parse(readFileSync(outsideCwdEvidence, 'utf8')).status).toBe('ready_to_repair');

        const ambiguousDelete = run('final', beforeValue, 'ambiguous-delete');
        expect(ambiguousDelete.result.status).not.toBe(0);
        expect(ambiguousDelete.evidence).toMatchObject({ status: 'blocked', rollback_complete: false, public_key_override_present: true });
        rmSync(root, { recursive: true, force: true });
    }, 30_000);

    it('Lightsail env転送checksum不一致時はlive targetを変更しない', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const marker = 'set -euo pipefail\nREMOTE_ROLLBACK_ENV="$1"\nEXPECTED_ENV_SHA="$2"\nTARGET_ENV="$3"';
        const start = runbook.lastIndexOf(marker);
        const end = runbook.indexOf('\nREMOTE\nthen', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const remoteBlock = runbook.slice(start, end);
        const root = mkdtempSync(join(tmpdir(), 'brainbase-env-transfer-'));
        const bin = join(root, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
        const transfer = join(root, 'transfer.env');
        const target = join(root, 'live.env');
        writeFileSync(transfer, 'new-value\n', { mode: 0o600 });
        writeFileSync(target, 'original-value\n', { mode: 0o600 });
        const result = spawnSync('bash', ['-c', remoteBlock, 'rollback-env-test', transfer, 'definitely-wrong-checksum', target, 'unused.service', 'unused-sha', '1', '0'], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        });
        expect(result.status).not.toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('original-value\n');
        expect(existsSync(transfer)).toBe(false);
        expect(result.stderr).toContain('target unchanged; rollback_complete=false');
        expect(JSON.parse(result.stdout)).toMatchObject({
            status: 'blocked',
            failed_stage: 'transfer_checksum',
            rollback_complete: false,
            target_changed: false,
        });
        rmSync(root, { recursive: true, force: true });
    });

    it('Lightsail scp失敗時もremote秘密一時ファイルをcleanupしてReceiptを残す', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const start = runbook.lastIndexOf('ROLLBACK_REMOTE_EVIDENCE="$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-env-rollback.evidence.json"');
        const end = runbook.indexOf('if ssh -i "$HOME/.ssh/lightsail-brainbase.pem" ubuntu@176.34.20.239 bash -s --', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const scpBlock = runbook.slice(start, end);
        const root = mkdtempSync(join(tmpdir(), 'brainbase-env-scp-'));
        const bin = join(root, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'scp'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nprintf cleanup-attempted > "$SSH_CLEANUP_MARKER"\nexit 0\n', { mode: 0o755 });
        const cleanupMarker = join(root, 'cleanup.marker');
        const result = spawnSync('bash', ['-c', scpBlock], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                HOME: root,
                BRAINBASE_ROLLBACK_STATE_DIR: root,
                ROLLBACK_ENV: join(root, 'rollback.env'),
                REMOTE_ROLLBACK_ENV: '/tmp/partial-secret.env',
                SSH_CLEANUP_MARKER: cleanupMarker,
            },
        });
        expect(result.status).not.toBe(0);
        expect(existsSync(cleanupMarker)).toBe(true);
        expect(result.stderr).toContain('Lightsail env transfer blocked');
        expect(JSON.parse(readFileSync(join(root, 'lightsail-env-rollback.evidence.json'), 'utf8'))).toMatchObject({
            status: 'blocked',
            failed_stage: 'lightsail_env_scp',
            rollback_complete: false,
            rollback_required: false,
            target_changed: false,
            remote_secret_cleanup_confirmed: true,
        });
        expect(runbook).toContain('failed_stage: "lightsail_env_ssh"');
        expect(runbook).toContain('target_changed: "unknown"');
        expect(runbook).toContain('rollback_required: "unknown"');

        const unwritableState = join(root, 'not-a-directory');
        writeFileSync(unwritableState, 'occupied');
        const unknownReceipt = spawnSync('bash', ['-c', scpBlock], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                HOME: root,
                BRAINBASE_ROLLBACK_STATE_DIR: unwritableState,
                ROLLBACK_ENV: join(root, 'rollback.env'),
                REMOTE_ROLLBACK_ENV: '/tmp/partial-secret.env',
                SSH_CLEANUP_MARKER: cleanupMarker,
            },
        });
        expect(unknownReceipt.status).not.toBe(0);
        expect(unknownReceipt.stderr).toContain('Receipt status is unknown');
        rmSync(root, { recursive: true, force: true });
    });

    it('Lightsail SSH結果不明とcleanup失敗をunknown Receiptへ収束する', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const start = runbook.lastIndexOf('ROLLBACK_REMOTE_EVIDENCE="$BRAINBASE_ROLLBACK_STATE_DIR/lightsail-env-rollback.evidence.json"');
        const end = runbook.indexOf('\ncleanup_rollback_secrets\nROLLBACK_STAGE=public_readiness_after_env_projection', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const transportBlock = runbook.slice(start, end);
        const root = mkdtempSync(join(tmpdir(), 'brainbase-env-ssh-unknown-'));
        const bin = join(root, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'scp'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexit 17\n', { mode: 0o755 });
        const result = spawnSync('bash', ['-c', transportBlock], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                HOME: root,
                BRAINBASE_ROLLBACK_STATE_DIR: root,
                ROLLBACK_ENV: join(root, 'rollback.env'),
                REMOTE_ROLLBACK_ENV: '/tmp/partial-secret.env',
                EXPECTED_ENV_SHA: 'expected-env-sha',
                TARGET_SHA: 'expected-production-sha',
            },
        });
        expect(result.status).toBe(17);
        expect(result.stderr).toContain('Lightsail env rollback blocked');
        expect(JSON.parse(readFileSync(join(root, 'lightsail-env-rollback.evidence.json'), 'utf8'))).toMatchObject({
            status: 'blocked',
            failed_stage: 'lightsail_env_ssh',
            rollback_complete: false,
            rollback_required: 'unknown',
            target_changed: 'unknown',
            remote_secret_cleanup_confirmed: false,
        });
        rmSync(root, { recursive: true, force: true });
    });

    it('Lightsail env反映後にruntime SHAをbounded readbackしReceiptへ残す', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const marker = 'set -euo pipefail\nREMOTE_ROLLBACK_ENV="$1"\nEXPECTED_ENV_SHA="$2"\nTARGET_ENV="$3"';
        const start = runbook.lastIndexOf(marker);
        const end = runbook.indexOf('\nREMOTE\nthen', start);
        const remoteBlock = runbook.slice(start, end);
        const root = mkdtempSync(join(tmpdir(), 'brainbase-env-readiness-'));
        const bin = join(root, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
        writeFileSync(join(bin, 'install'), '#!/bin/sh\nshift 6\ncp "$1" "$2"\nchmod 600 "$2"\n', { mode: 0o755 });
        writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        writeFileSync(join(bin, 'curl'), '#!/bin/sh\nprintf \'%s\\n\' \'{"runtime":{"git":{"sha":"expected-sha","dirty":false}}}\'\n', { mode: 0o755 });
        const transfer = join(root, 'transfer.env');
        const target = join(root, 'live.env');
        writeFileSync(transfer, 'new-value\n', { mode: 0o600 });
        writeFileSync(target, 'original-value\n', { mode: 0o600 });
        const expected = spawnSync('sha256sum', [transfer], { encoding: 'utf8' }).stdout.split(/\s+/)[0];
        const run = (sha, name) => spawnSync('bash', ['-c', remoteBlock, name, transfer, expected, target, 'service', sha, '2', '0'], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        });

        const success = run('expected-sha', 'success');
        expect(success.status).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe('new-value\n');
        expect(JSON.parse(success.stdout)).toMatchObject({
            status: 'lightsail_projection_ready',
            rollback_complete: false,
            lightsail_projection_complete: true,
            rollback_required: true,
            target_changed: true,
            remote_secret_cleanup_confirmed: true,
        });

        writeFileSync(transfer, 'next-value\n', { mode: 0o600 });
        const nextExpected = spawnSync('sha256sum', [transfer], { encoding: 'utf8' }).stdout.split(/\s+/)[0];
        const timeout = spawnSync('bash', ['-c', remoteBlock, 'timeout', transfer, nextExpected, target, 'service', 'wrong-sha', '2', '0'], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        });
        expect(timeout.status).not.toBe(0);
        expect(timeout.stderr).toContain('local readiness after env rollback timed out');
        expect(JSON.parse(timeout.stdout)).toMatchObject({
            status: 'blocked',
            failed_stage: 'local_readiness',
            rollback_required: true,
            lightsail_projection_complete: false,
            target_changed: true,
        });

        writeFileSync(transfer, 'cleanup-failure-value\n', { mode: 0o600 });
        const cleanupExpected = spawnSync('sha256sum', [transfer], { encoding: 'utf8' }).stdout.split(/\s+/)[0];
        writeFileSync(join(bin, 'rm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const cleanupFailure = spawnSync('bash', ['-c', remoteBlock, 'cleanup-failure', transfer, cleanupExpected, target, 'service', 'expected-sha', '2', '0'], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        });
        expect(cleanupFailure.status).not.toBe(0);
        expect(JSON.parse(cleanupFailure.stdout)).toMatchObject({
            status: 'blocked',
            failed_stage: 'remote_secret_cleanup',
            rollback_complete: false,
            rollback_required: true,
            lightsail_projection_complete: true,
            target_changed: true,
            remote_secret_cleanup_confirmed: false,
        });
        rmSync(root, { recursive: true, force: true });
    }, 15_000);

    it('env反映後の外側の失敗もproduction rollback Receiptへ収束する', () => {
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        expect(runbook).toContain('ROLLBACK_INFISICAL_BEFORE="$BRAINBASE_ROLLBACK_STATE_DIR/infisical.before.json"');
        expect(runbook).toContain('rm -f "$ROLLBACK_INFISICAL_BEFORE" || cleanup_ok=false');
        expect(runbook).toContain('local_secret_cleanup_confirmed:true');
        const cleanupStart = runbook.lastIndexOf('ROLLBACK_INFISICAL_BEFORE=');
        const cleanupEnd = runbook.indexOf('\ntrap cleanup_rollback_secrets EXIT', cleanupStart);
        expect(cleanupStart).toBeGreaterThanOrEqual(0);
        expect(cleanupEnd).toBeGreaterThan(cleanupStart);
        const cleanupBlock = runbook.slice(cleanupStart, cleanupEnd);
        const cleanupRoot = mkdtempSync(join(tmpdir(), 'brainbase-rollback-secret-cleanup-'));
        for (const name of [
            'infisical.before.json',
            'infisical.rollback-current.json',
            'infisical.rollback-final.json',
            '.env.infisical.rollback',
        ]) writeFileSync(join(cleanupRoot, name), 'secret-value\n', { mode: 0o600 });
        const cleanup = spawnSync('bash', ['-c', `set -euo pipefail\n${cleanupBlock}\ncleanup_rollback_secrets`], {
            encoding: 'utf8',
            env: { ...process.env, BRAINBASE_ROLLBACK_STATE_DIR: cleanupRoot },
        });
        expect(cleanup.status).toBe(0);
        for (const name of [
            'infisical.before.json',
            'infisical.rollback-current.json',
            'infisical.rollback-final.json',
            '.env.infisical.rollback',
        ]) expect(existsSync(join(cleanupRoot, name))).toBe(false);
        const start = runbook.lastIndexOf('ROLLBACK_STAGE=lightsail_env_export');
        const end = runbook.indexOf('\n"$INFISICAL" export --silent', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const receiptTrap = runbook.slice(start, end);
        expect(runbook.indexOf('trap write_incomplete_rollback_receipt EXIT', start)).toBeLessThan(
            runbook.indexOf('if ! scp -i', start)
        );
        expect(runbook.indexOf('trap write_incomplete_rollback_receipt EXIT', start)).toBeLessThan(
            runbook.indexOf('cleanup_rollback_secrets\nROLLBACK_STAGE=public_readiness_after_env_projection', start)
        );
        const root = mkdtempSync(join(tmpdir(), 'brainbase-production-rollback-receipt-'));
        const failure = spawnSync('bash', ['-c', `set -euo pipefail\ncleanup_rollback_secrets() { :; }\n${receiptTrap}\nLIGHTSAIL_PROJECTION_STATUS=verified\nROLLBACK_STAGE=test_post_projection\nfalse`], {
            encoding: 'utf8',
            env: {
                ...process.env,
                BRAINBASE_ROLLBACK_STATE_DIR: root,
                TARGET_SHA: 'expected-production-sha',
            },
        });
        expect(failure.status).not.toBe(0);
        expect(JSON.parse(readFileSync(join(root, 'production-rollback.evidence.json'), 'utf8'))).toMatchObject({
            status: 'blocked',
            failed_stage: 'test_post_projection',
            rollback_complete: false,
            rollback_required: true,
            target_sha: 'expected-production-sha',
            target_changed: true,
            signing_config_repair_complete: true,
            lightsail_projection_complete: true,
            lightsail_projection_status: 'verified',
            hook_restore_status: 'not_started',
            hook_restored: false,
            local_secret_cleanup_attempted: true,
            local_secret_cleanup_confirmed: true,
        });

        const cleanupFailureRoot = mkdtempSync(join(tmpdir(), 'brainbase-local-secret-cleanup-'));
        const cleanupFailure = spawnSync('bash', ['-c', `set -euo pipefail\ncleanup_rollback_secrets() { return 1; }\n${receiptTrap}\nROLLBACK_STAGE=test_local_secret_cleanup\nfalse`], {
            encoding: 'utf8',
            env: {
                ...process.env,
                BRAINBASE_ROLLBACK_STATE_DIR: cleanupFailureRoot,
                TARGET_SHA: 'expected-production-sha',
            },
        });
        expect(cleanupFailure.status).not.toBe(0);
        expect(JSON.parse(readFileSync(join(cleanupFailureRoot, 'production-rollback.evidence.json'), 'utf8'))).toMatchObject({
            status: 'blocked',
            failed_stage: 'test_local_secret_cleanup',
            rollback_required: true,
            local_secret_cleanup_attempted: true,
            local_secret_cleanup_confirmed: false,
        });

        const changedRoot = mkdtempSync(join(tmpdir(), 'brainbase-hook-restore-receipt-'));
        const changedUnverified = spawnSync('bash', ['-c', `set -euo pipefail\ncleanup_rollback_secrets() { :; }\n${receiptTrap}\nLIGHTSAIL_PROJECTION_STATUS=verified\nHOOK_RESTORE_STATUS=changed_unverified\nROLLBACK_STAGE=hook_restore\nfalse`], {
            encoding: 'utf8',
            env: {
                ...process.env,
                BRAINBASE_ROLLBACK_STATE_DIR: changedRoot,
                TARGET_SHA: 'expected-production-sha',
            },
        });
        expect(changedUnverified.status).not.toBe(0);
        expect(JSON.parse(readFileSync(join(changedRoot, 'production-rollback.evidence.json'), 'utf8'))).toMatchObject({
            status: 'blocked',
            failed_stage: 'hook_restore',
            hook_restore_status: 'changed_unverified',
            hook_restored: false,
        });

        const unwritableState = join(root, 'not-a-directory');
        writeFileSync(unwritableState, 'occupied');
        const unknownReceipt = spawnSync('bash', ['-c', `set -euo pipefail\ncleanup_rollback_secrets() { :; }\n${receiptTrap}\nROLLBACK_STAGE=test_receipt_write\nfalse`], {
            encoding: 'utf8',
            env: {
                ...process.env,
                BRAINBASE_ROLLBACK_STATE_DIR: unwritableState,
                TARGET_SHA: 'expected-production-sha',
            },
        });
        expect(unknownReceipt.status).not.toBe(0);
        expect(unknownReceipt.stderr).toContain('status=unknown rollback_complete=false rollback_required=true');
        expect(unknownReceipt.stderr).toContain('next_action=stop_and_inspect_saved_rollback_state');
        expect(runbook).toContain('ROLLBACK_STAGE=hook_restore');
        expect(runbook).toContain('ROLLBACK_STAGE=mcp_runtime_readiness');
        expect(runbook).toContain('ROLLBACK_STAGE=final_public_health');
        expect(runbook).toContain('ROLLBACK_COMPLETE=true\ntrap - EXIT');
        rmSync(root, { recursive: true, force: true });
        rmSync(changedRoot, { recursive: true, force: true });
        rmSync(cleanupFailureRoot, { recursive: true, force: true });
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:14
    it('CLAUDEとAGENTSのalways-loaded Host contractを同一に保つ', () => {
        const claude = read('CLAUDE.md');
        const agents = read('AGENTS.md');
        expect(agents).toBe(claude);
        expect(claude).toContain('未解決episodeを開くだけ');
        expect(claude).toContain('PostToolUse');
        expect(claude).toContain('Stop');
        expect(claude).toContain('model-callable `brainbase_resolve_turn`');
        expect(claude).toContain('canonical turn input');
        expect(claude).toContain('通常の権限・承認を置き換えない');
        expect(claude).toContain('未一致を`general/answer`へ落としたり必要能力を減らしたりしない');
    });

    it('wrapperがUserPromptSubmit・PostToolUse・Stopのepisode lifecycleを起動する', () => {
        const wrapper = read('scripts/codex-hooks/judgment-resolver-entry.sh');
        const host = read('scripts/codex-hooks/judgment-resolver-host.mjs');

        expect(wrapper).toContain('judgment-resolver-host.mjs');
        expect(wrapper).not.toContain('brainbase_judgment_resolve');
        expect(host).toContain('readCanonicalTranscript');
        expect(host).toContain('buildJudgmentRequest');
        expect(host).toContain('/host/judgment/resolve');
        expect(host).toContain('startEpisode');
        expect(host).toContain('recordBrainbaseToolUse');
        expect(host).toContain('finalizeEpisode');
        expect(host).toContain('completedAuditOutput');
        expect(host).toContain('owner_audit_source');
        expect(host).toContain('stop_hook_system_message');
        expect(host).toContain('BEGIN IMMEDIATE');
        expect(host).toContain('transition.sqlite');
        expect(host).toContain('judgment_episode_transition_timeout');
        expect(host).toContain('judgment_episode_identity_missing');
        expect(host).toContain('judgment_episode_not_found');
        expect(host).toContain('NO_BRAINBASE_REFERENCE_LINE');
        expect(host).toContain('STOP_REPAIR_COMPLETE_LINE');
        expect(host).toContain('ORPHAN_AUDIT_WARNING');
        expect(host).toContain("completion_status: 'audit_degraded'");
        expect(host).not.toContain('新しいCodex taskを作り、同じ依頼を送ってください');
        expect(host).toContain('Settings → Hooks');
        expect(host).toContain("completion_status: 'complete'");
        expect(host).toContain('autonomy.continuation');
        expect(host).toContain('there is no one-call-per-turn limit');
        expect(host).not.toContain('classification_proposal');
    });

    it('Skill・capability・runbook・specがmodel-firstの同じ境界を公開する', () => {
        const skill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const capability = read('docs/brainbase-capabilities/capabilities/judgment.resolve.yml');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const architecture = read('docs/architecture/story-brainbase-judgment-resolver-v1.md');
        const story = read('docs/management/stories/active/story-brainbase-judgment-resolver-v1.md');
        const spec = read('docs/specs/story-brainbase-judgment-resolver-v1.md');
        const surfaces = [skill, capability, runbook, architecture, story, spec];

        for (const surface of surfaces) {
            expect(surface).toMatch(/model.*(call|呼|Resolver)/iu);
            expect(surface).toContain('brainbase_resolve_turn');
            expect(surface).toContain('conversation_context');
            expect(surface).toMatch(/judgment episode|判断episode|判断エピソード/iu);
            expect(surface).toContain('PostToolUse');
            expect(surface).toContain('Stop');
            expect(surface).toMatch(/0\.\.N|0-N|何度でも|複数回/iu);
            expect(surface).toMatch(/project.*(context|文脈)/iu);
            expect(surface).toMatch(/authorize|authorization|権限|許可/iu);
            expect(surface).toMatch(/model interpretation|modelの意味解釈|モデルの意味解釈/iu);
            expect(surface).toMatch(/Codex/iu);
            expect(surface).toMatch(/未一致|unmatched/iu);
            expect(surface).not.toContain('classification_proposal');
            expect(surface).toContain('ready_for_fresh_task');
            expect(surface).toContain('proven_active');
        }

        expect(capability).toContain('brainbase_resolve_turn');
        expect(capability).toContain('POST http://127.0.0.1:39002/host/judgment/resolve');
        expect(runbook).toContain('structural filtering');
        expect(runbook).toContain('records every completed tool call as execution evidence');
        expect(runbook).toContain('satisfies the execution requirement even when the result is `unconfirmed` or the tool fails');
        expect(runbook).toContain('Only `resolved` qualifies as successful');
        expect(spec).toContain('The Codex model proposes semantic classification');
        expect(spec).toContain('An unmatched keyword rule never removes a capability');
        expect(spec).toContain('one authentic exact `mcp__brainbase__brainbase_knowledge_resolve` `PostToolUse` event regardless of response outcome');
        expect(architecture).toContain('trust-boundary defect');
        expect(architecture).toContain('Every completed call produces a non-visible execution event');
        expect(story).toContain('model-callable `brainbase_resolve_turn`');
        expect(story).toContain('Brainbase knowledge/retrieval toolを0..N回');
        expect(story).toContain('initial/final receiptは判断と監査の証拠');
        expect(story).toContain('project bindingは判断文脈であり、action authorityではない');
        expect(story).toContain('matcher未一致');
        expect(story).toContain('## 影響範囲');
        expect(architecture).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(spec).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(capability).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(skill).toContain('SQLite');
        expect(skill).toContain('非zero exit');
        expect(capability).toContain('non-final `audit_degraded` receipt');
        expect(capability).toContain('rejects a late Start for the same identity');
        expect(capability).toContain('model-authored `🛠️` line without that marker is rejected');
        expect(spec).toContain('rejects a late Start for the same identity');
        expect(architecture).toContain('Codex lifecycle Host adapter');
        expect(architecture).toContain('BEGIN IMMEDIATE');
        expect(architecture).toContain('non-final `audit_degraded` receipt');
        expect(architecture).toContain('Persistent Brainbase Host bridge');
        expect(architecture).toContain('Resolver API/server');
        expect(architecture).toContain('Resolver API/server owns the verifier copy');
        expect(architecture).toContain('would not receive either copy of the shared secret');
        expect(runbook).toContain('Codex lifecycle Host adapter');
        expect(runbook).toContain('Persistent Brainbase Host bridge');
        expect(runbook).toContain('Resolver API/server');
        expect(runbook).toContain('Resolver API/server verifier hold the two runtime copies');
        expect(runbook).toContain('future Claude Code adapter must not hold or receive either copy');
        expect(runbook).toContain('SQLite');
        expect(runbook).toContain('finalizes as `audit_degraded` and exits 0');
        expect(runbook).toContain('🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓');
        expect(runbook).toContain('never fabricates `.final.json` or asks the operator to create a new task');
        expect(runbook).toContain('official `hooks/list` RPC');
        expect(runbook).toContain('Open `/hooks`');
        expect(runbook).toContain('must never calculate or write Codex `trusted_hash`');
        expect(runbook).toContain('transcript task was created before the current Hook/trust files');
        expect(spec).toContain('BEGIN IMMEDIATE');
        expect(spec).toContain('explicit non-zero hook failure');
        expect(spec).toContain('Repository code never writes Codex `trusted_hash`');
        expect(capability).toContain('scripts/check-codex-judgment-hook-readiness.mjs');
        expect(skill).toContain('既存task、過去artifact、direct entrypoint実行はlive activationの代用にならない');
    });

    it('audit fail-closed Story・Architecture・Spec・Taskを公開する', () => {
        const story = read('docs/management/stories/active/story-brainbase-judgment-audit-fail-closed.md');
        const architecture = read('docs/architecture/story-brainbase-judgment-audit-fail-closed.md');
        const spec = read('docs/specs/story-brainbase-judgment-audit-fail-closed.md');
        const task = read('docs/management/tasks/TASK-brainbase-judgment-audit-fail-closed.md');
        const surfaces = [story, architecture, spec, task];

        for (const surface of surfaces) {
            expect(surface).toContain('ready_for_fresh_task');
            expect(surface).toContain('proven_active');
            expect(surface).toMatch(/hooks\/list|Hook.*trust/iu);
            expect(surface).toMatch(/final.*(作らない|なし|no final)/iu);
        }
        expect(architecture).toContain('judgment_episode_identity_missing');
        expect(architecture).toContain('judgment_episode_not_found');
        expect(spec).toContain('Open /hooks and approve the three current Resolver hooks.');
        expect(story).toContain('Brainbaseはtrust hashを計算・書換しない');
    });

    // Traceability: story-judgment-audit-continuity-v1:ac:3-9
    it('audit continuity Story・Architecture・Spec・Taskがdegradedとcompleteを分離する', () => {
        const story = read('docs/management/stories/active/story-judgment-audit-continuity-v1.md');
        const architecture = read('docs/architecture/story-judgment-audit-continuity-v1.md');
        const spec = read('docs/specs/story-judgment-audit-continuity-v1.md');
        const task = read('docs/management/tasks/TASK-judgment-audit-continuity-v1.md');
        const surfaces = [story, architecture, spec, task];

        for (const surface of surfaces) {
            expect(surface).toContain('audit_degraded');
            expect(surface).toMatch(/complete/iu);
            expect(surface).toMatch(/transition lock|transition\.sqlite|BEGIN IMMEDIATE/iu);
        }
        expect(story).toContain('新しいtaskを作る作業を求められたくない');
        expect(architecture).toContain('audit_degraded != complete');
        expect(spec).toContain('does not instruct the user to create a new task');
        expect(task).toContain('global Hook切替とDesktop E2Eは未承認');
    });

    it('capability README indexが現行integrationと将来候補を区別する', () => {
        const readme = read('docs/brainbase-capabilities/README.md');

        expect(readme).toContain('Codex Host opens one canonical-context-bound judgment episode');
        expect(readme).toContain('internal-LLM-free Resolver deterministically selects the initial route');
        expect(readme).toContain('`PostToolUse` records all completed tool calls as execution evidence');
        expect(readme).toContain('one non-authorizing receipt');
        expect(readme).toContain('Claude Code remains a future Host-adapter candidate');
    });

    it('binding secret・preflight・deployment boundaryを維持する', () => {
        const envExample = read('.env.example');
        const infisicalTargets = JSON.parse(read('config/infisical-targets.json'));
        const launcher = read('scripts/run-brainbase-mcp.sh');
        const capability = read('docs/brainbase-capabilities/capabilities/judgment.resolve.yml');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const architecture = read('docs/architecture/story-brainbase-judgment-resolver-v1.md');
        const spec = read('docs/specs/story-brainbase-judgment-resolver-v1.md');
        const story = read('docs/management/stories/active/story-brainbase-judgment-resolver-v1.md');

        expect(envExample).toContain('BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(envExample).toContain('BRAINBASE_JUDGMENT_ADAPTER_ID=brainbase-mcp');
        expect(infisicalTargets.targets['brainbase-mcp'].requiredKeys).toContain(
            'BRAINBASE_JUDGMENT_BINDING_SECRET'
        );
        expect(launcher).toContain('missing BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(launcher).toContain('preflight-judgment-binding.js');
        expect(runbook).toContain('scripts/run-brainbase-mcp.sh --check');
        expect(runbook).toContain('npm run check:judgment-hook-readiness');
        expect(runbook).toContain('signed read-only probe');
        expect(runbook).toContain('not proof that the global hook');
        expect(runbook).toContain('content-equivalent to the current contract checkout');
        expect(runbook).toContain('not proof that the installed Hook checkout has the same Git SHA');
        expect(runbook).toContain('Verify the merged/deployed checkout SHA separately after deployment');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_EPISODE_PATH');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_TRANSCRIPT_PATH');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_OWNER_VISIBLE_PATH');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_DELEGATION_E2E_OWNER_VISIBLE_PATH');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_NONCE');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_RUN_QUERY');
        expect(runbook).toContain('brainbase-owner-visible-readback-v1');
        expect(runbook).toContain('session_meta.payload.id');
        expect(runbook).toContain('system_message_digest');
        expect(runbook).toContain('occurrences');
        expect(runbook).toContain('event_id');
        expect(runbook).toContain('final_event_fingerprint');
        expect(runbook).toContain('query-embedded source HEAD differs');
        expect(runbook).toContain('final receipt is at most one hour old');
        for (const surface of [capability, runbook, architecture, spec]) {
            expect(surface).toContain('owner_audit_source=stop_hook_system_message');
            expect(surface).toMatch(/owner UI or event stream|Codex Hook UI or event stream/iu);
            expect(surface).toMatch(/model-authored.*(?:last_assistant_message|answer)/iu);
            expect(surface).not.toMatch(/final (?:user-visible )?(?:answer|assistant message).*begins? with.*owner-visible|final user-visible answer starts with/iu);
        }
        expect(runbook).toContain('scripts/reconcile-brainbase-mcp-runtime.sh "$TARGET_SHA"');
        expect(runbook).toContain('brainbase-mcp-reconcile.last');
        expect(runbook).toContain('deploy-lightsail-production.md');
        expect(runbook).toContain('Pre-deployment rollback capture');
        expect(runbook).toContain('global-hook.sha');
        expect(runbook).toContain('local-ui.sha');
        expect(runbook).toContain('mcp-runtime.sha');
        expect(runbook).toContain('lightsail.sha');
        expect(runbook).toContain('/Users/ksato/workspace/repos/.runtime/brainbase-31013');
        expect(runbook).toContain('/Users/ksato/workspace/var/brainbase-runtime-pinned.sha');
        expect(runbook).toContain('git rev-parse --is-inside-work-tree');
        expect(runbook).toContain('PIN_TMP="$(mktemp "${BRAINBASE_RUNTIME_PIN_FILE}.XXXXXX")"');
        expect(runbook).toContain('mv "$PIN_TMP" "$BRAINBASE_RUNTIME_PIN_FILE"');
        expect(runbook).toContain('brainbase_wait_for_runtime_ready');
        expect(runbook).not.toMatch(/launchctl kickstart[^\n]*\n(?:sleep )/u);
        expect(runbook.indexOf('mv "$PIN_TMP" "$BRAINBASE_RUNTIME_PIN_FILE"')).toBeLessThan(
            runbook.indexOf('launchctl kickstart -k "gui/$(id -u)/com.brainbase.ui"')
        );
        expect(runbook).not.toContain('/Users/ksato/workspace/code/brainbase');
        expect(runbook).not.toContain('test -z "$(git -C "$BRAINBASE_CANONICAL_ROOT"');
        expect(runbook).not.toContain('switch --detach "$CANONICAL_ROLLBACK_SHA"');
        expect(runbook).not.toContain('switch --detach "$MCP_ROLLBACK_SHA"');
        expect(runbook).toContain('install -m 600 "$BRAINBASE_ROLLBACK_STATE_DIR/hooks.json" "$HOME/.codex/hooks.json"');
        expect(runbook).toContain('Never remove `~/.codex/var/judgment-resolver`');
        expect(spec).toContain('global Hook on its independent clean checkout');
        expect(spec).toContain('shared local UI/MCP disposable runtime');
        expect(spec).toContain('recorded pinned commit SHA');
        expect(spec).toContain('restore Lightsail separately');
        expect(spec).toMatch(/exact prior Hook file.*restored last/u);
        expect(spec).toContain('dirty canonical source checkout');
        expect(story).toContain('global Hookは独立したclean checkout');
        expect(story).toContain('local UI/MCPは共有disposable runtime');
        expect(story).toContain('記録済みcommit SHAへpin');
        expect(story).toContain('Lightsailを別面として復元');
        expect(story).toContain('最後に元の`hooks.json`を復元');
        expect(story).toContain('dirtyな正本source checkout');

        const restartRunbook = read('docs/brainbase-capabilities/runbooks/restart-31013-launchd.md');
        expect(restartRunbook).toContain('brainbase_resolve_runtime_target');
        expect(restartRunbook).toContain('brainbase_wait_for_runtime_ready');
        expect(restartRunbook).not.toContain('sleep 5');

        const lightsailRunbook = read('docs/brainbase-capabilities/runbooks/deploy-lightsail-production.md');
        expect(lightsailRunbook).toContain('TARGET_SHA="$(git rev-parse HEAD)"');
        expect(lightsailRunbook).toContain('git?.sha !== process.env.TARGET_SHA');
        expect(lightsailRunbook).toContain('Unexpected public runtime Git state');
        expect(lightsailRunbook).toContain('https://bb.unson.jp/api/version | TARGET_SHA="$TARGET_SHA" node');
        expect(lightsailRunbook).toContain('git switch --detach "$ROLLBACK_SHA"');
        expect(lightsailRunbook).toContain('four-surface rollback order');
        expect(lightsailRunbook).not.toContain('127.0.0.1:55123/api/version | jq');
    });
});
