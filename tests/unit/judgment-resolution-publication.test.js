import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(path, 'utf8');
}

describe('judgment resolver publication surfaces', () => {
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
        }

        expect(capability).toContain('mcp: []');
        expect(capability).toContain('POST http://127.0.0.1:39002/host/judgment/resolve');
        expect(runbook).toContain('structural filtering');
        expect(runbook).toContain('records only direct `mcp__brainbase__*` outcomes');
        expect(runbook).toContain('successful `unconfirmed` result does satisfy the routing capability');
        expect(runbook).not.toContain('A failed or unconfirmed call');
        expect(spec).toContain('Resolver determines classification');
        expect(spec).toContain('Plain non-follow-up matcher misses use the `general/answer` fallback instead');
        expect(architecture).toContain('trust-boundary defect');
        expect(architecture).toContain('local file reads and other connectors are not yet covered');
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
        expect(architecture).toContain('Codex lifecycle Host adapter');
        expect(architecture).toContain('Persistent Brainbase Host bridge');
        expect(architecture).toContain('Resolver API/server');
        expect(architecture).toContain('Resolver API/server owns the verifier copy');
        expect(architecture).toContain('would not receive either copy of the shared secret');
        expect(runbook).toContain('Codex lifecycle Host adapter');
        expect(runbook).toContain('Persistent Brainbase Host bridge');
        expect(runbook).toContain('Resolver API/server');
        expect(runbook).toContain('Resolver API/server verifier hold the two runtime copies');
        expect(runbook).toContain('future Claude Code adapter must not hold or receive either copy');
    });

    it('capability README indexが現行integrationと将来候補を区別する', () => {
        const readme = read('docs/brainbase-capabilities/README.md');

        expect(readme).toContain('Codex Host opens one canonical-context-bound judgment episode');
        expect(readme).toContain('internal-LLM-free Resolver deterministically selects the initial route');
        expect(readme).toContain('0..N actual Brainbase calls recorded through `PostToolUse`');
        expect(readme).toContain('one non-authorizing receipt');
        expect(readme).toContain('Claude Code remains a future Host-adapter candidate');
    });

    it('binding secret・preflight・deployment boundaryを維持する', () => {
        const envExample = read('.env.example');
        const infisicalTargets = JSON.parse(read('config/infisical-targets.json'));
        const launcher = read('scripts/run-brainbase-mcp.sh');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');

        expect(envExample).toContain('BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(envExample).toContain('BRAINBASE_JUDGMENT_ADAPTER_ID=brainbase-mcp');
        expect(infisicalTargets.targets['brainbase-mcp'].requiredKeys).toContain(
            'BRAINBASE_JUDGMENT_BINDING_SECRET'
        );
        expect(launcher).toContain('missing BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(launcher).toContain('preflight-judgment-binding.js');
        expect(runbook).toContain('scripts/run-brainbase-mcp.sh --check');
        expect(runbook).toContain('signed read-only probe');
        expect(runbook).toContain('not proof that the global hook');
        expect(runbook).toContain('content-equivalent to the current contract checkout');
        expect(runbook).toContain('not proof that the installed Hook checkout has the same Git SHA');
        expect(runbook).toContain('Verify the merged/deployed checkout SHA separately after deployment');
    });
});
