import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(path, 'utf8');
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
        expect(convergence).toContain('lightsail_sha');
        expect(convergence).toContain('npm run ontology:verify');
        expect(convergence).toContain('/api/info/graph/maintenance/validate');
        expect(convergence).toContain('graph_http_status');
        expect(convergence).toContain('collection_complete');
        expect(convergence).toContain('suppressed_edge_count');
        expect(convergence).toContain('suppression_reasons');
        expect(convergence).toContain('structural_violation_count');
        expect(convergence).toContain('ontology_violation_count');
        expect(convergence).toContain('graph_valid');
        expect(convergence).toContain('production-convergence-receipt.json');

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

    // Trace: story-brainbase-judgment-resolver-v1:ac:14
    it('CLAUDEとAGENTSのalways-loaded Host contractを同一に保つ', () => {
        const claude = read('CLAUDE.md');
        const agents = read('AGENTS.md');
        expect(agents).toBe(claude);
        expect(claude).toContain('model生成前に1つのjudgment episodeを開始');
        expect(claude).toContain('PostToolUse');
        expect(claude).toContain('Stop');
        expect(claude).toContain('modelはResolverを呼ばず');
        expect(claude).toContain('canonical context');
        expect(claude).toContain('clarification receiptでも回答生成へ進む');
        expect(claude).toContain('project access不能だけで判断を止めない');
        expect(claude).toContain('通常の権限・承認を置き換えない');
        expect(claude).toContain('現行Resolverは内部LLMを持たず');
        expect(claude).toContain('専門matcher未一致の非follow-up入力はserver-owned `general/answer` fallback');
        expect(claude).toContain('Claude Codeは将来のHost adapter候補');
        expect(claude).toContain('現行episode lifecycle hook integrationには含まれない');
        expect(claude).toContain('最初の修復可能なStopで`decision:block`を返し');
        expect(claude).toContain('`judgment_stop_repair_exhausted`で非zero終了し');
        expect(claude).toContain('Brainbase callが0件で参照必須でないturnも0件だったことを明示する');
        expect(claude).toContain('episodeのないorphan Stopも成功へ潰さない');
        expect(claude).toContain('journalに記録されたStop修復だけを最終監査へ表示し');
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
        expect(host).toContain('answerContainsExactAuditPrefix');
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
        expect(host).toContain('owner.audit.display');
        expect(host).toContain('there is no one-call-per-turn limit');
        expect(host).not.toContain('classification_proposal');
    });

    it('Skill・capability・runbook・specがmodel非依存の同じ境界を公開する', () => {
        const skill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const capability = read('docs/brainbase-capabilities/capabilities/judgment.resolve.yml');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const architecture = read('docs/architecture/story-brainbase-judgment-resolver-v1.md');
        const story = read('docs/management/stories/active/story-brainbase-judgment-resolver-v1.md');
        const spec = read('docs/specs/story-brainbase-judgment-resolver-v1.md');
        const surfaces = [skill, capability, runbook, architecture, story, spec];

        for (const surface of surfaces) {
            expect(surface).toMatch(/model.*(call|呼|Resolver)/iu);
            expect(surface).toMatch(/before model generation|model生成前|pre-model/iu);
            expect(surface).toContain('conversation_context');
            expect(surface).toMatch(/judgment episode|判断episode|判断エピソード/iu);
            expect(surface).toContain('PostToolUse');
            expect(surface).toContain('Stop');
            expect(surface).toMatch(/0\.\.N|0-N|何度でも|複数回/iu);
            expect(surface).toMatch(/project.*(context|文脈)/iu);
            expect(surface).toMatch(/authorize|authorization|権限|許可/iu);
            expect(surface).toMatch(
                /(内部|internal).*(LLM|model)|LLM.*(ない|持たない|使わない)|no LLM/iu
            );
            expect(surface).toMatch(/Codex/iu);
            expect(surface).toContain('general/answer');
            expect(surface).not.toContain('classification_proposal');
            expect(surface).toContain('ready_for_fresh_task');
            expect(surface).toContain('proven_active');
        }

        expect(capability).toContain('mcp: []');
        expect(capability).toContain('POST http://127.0.0.1:39002/host/judgment/resolve');
        expect(runbook).toContain('structural filtering');
        expect(runbook).toContain('records every completed tool call as execution evidence');
        expect(runbook).toContain('satisfies the execution requirement even when the result is `unconfirmed` or the tool fails');
        expect(runbook).toContain('Only `resolved` qualifies as successful');
        expect(spec).toContain('Resolver determines classification');
        expect(spec).toContain('Plain non-follow-up matcher misses use the `general/answer` fallback instead');
        expect(spec).toContain('one authentic exact `mcp__brainbase__brainbase_knowledge_resolve` `PostToolUse` event regardless of response outcome');
        expect(architecture).toContain('trust-boundary defect');
        expect(architecture).toContain('Every completed call produces a non-visible execution event');
        expect(story).toContain('model-callable toolとして公開しない');
        expect(story).toContain('Brainbase knowledge/retrieval toolを0..N回');
        expect(story).toContain('initial/final receiptは判断と監査の証拠');
        expect(story).toContain('project bindingは判断文脈であり、action authorityではない');
        expect(story).toContain('専門domain/intent matcherに一致しない非follow-up入力');
        expect(story).toContain('## 影響範囲');
        expect(architecture).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(spec).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(runbook).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(capability).toMatch(/Claude Code.*future Host-adapter candidate/iu);
        expect(skill).toContain('Claude Codeは同じ責務分割を適用できる将来のHost adapter候補');
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
        expect(runbook).toContain('active repeated Stop exits non-zero with `judgment_stop_repair_exhausted`');
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
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_NONCE');
        expect(runbook).toContain('BRAINBASE_JUDGMENT_E2E_RUN_QUERY');
        expect(runbook).toContain('query-embedded source HEAD differs');
        expect(runbook).toContain('final receipt is at most one hour old');
        expect(capability).toContain('exact Stop Hook-visible answer body');
        expect(runbook).toContain('exact Stop Hook-visible answer body');
        for (const surface of [capability, runbook]) {
            expect(surface).toContain('only one complete trailing `<oai-mem-citation>...</oai-mem-citation>` block');
            expect(surface).toMatch(/incomplete, embedded, or multiple citation block.*fails closed/iu);
            expect(surface).not.toContain('answer digest binds that rendered message');
            expect(surface).not.toContain('answer digest must match that rendered message');
        }
        for (const surface of [architecture, spec]) {
            expect(surface).toContain('exact Stop Hook-visible answer body');
            expect(surface).toContain('only one complete trailing `<oai-mem-citation>...</oai-mem-citation>` block');
            expect(surface).toMatch(/incomplete, embedded, or multiple citation blocks.*fail(?:s)? closed/iu);
            expect(surface).not.toMatch(/answer digest.*final assistant (?:message|`response_item`).*canonical JSONL transcript/iu);
            expect(surface).not.toContain('that its digest matches the final receipt');
            expect(surface).not.toContain('answer digest matching the final assistant message');
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
