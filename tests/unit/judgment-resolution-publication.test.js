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
        expect(claude).toContain('model生成前にResolverを実行');
        expect(claude).toContain('modelはResolverを呼ばず');
        expect(claude).toContain('canonical context');
        expect(claude).toContain('clarification receiptでも回答生成へ進む');
        expect(claude).toContain('project access不能だけで判断を止めない');
        expect(claude).toContain('通常の権限・承認を置き換えない');
    });

    it('UserPromptSubmit wrapperがpre-model Host実装だけを起動する', () => {
        const wrapper = read('scripts/codex-hooks/judgment-resolver-entry.sh');
        const host = read('scripts/codex-hooks/judgment-resolver-host.mjs');

        expect(wrapper).toContain('judgment-resolver-host.mjs');
        expect(wrapper).not.toContain('brainbase_judgment_resolve');
        expect(host).toContain('readCanonicalTranscript');
        expect(host).toContain('buildJudgmentRequest');
        expect(host).toContain('/host/judgment/resolve');
        expect(host).toContain('resolveAndAdopt');
        expect(host).toContain('This is the only accepted receipt for the current turn');
        expect(host).not.toContain('classification_proposal');
    });

    it('Skill・capability・runbook・specがmodel非依存の同じ境界を公開する', () => {
        const skill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const capability = read('docs/brainbase-capabilities/capabilities/judgment.resolve.yml');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const story = read('docs/architecture/story-brainbase-judgment-resolver-v1.md');
        const spec = read('docs/specs/brainbase-judgment-resolver-v1-spec.md');
        const surfaces = [skill, capability, runbook, story, spec];

        for (const surface of surfaces) {
            expect(surface).toMatch(/model.*(call|呼|Resolver)/iu);
            expect(surface).toMatch(/before model generation|model生成前|pre-model/iu);
            expect(surface).toContain('conversation_context');
            expect(surface).toMatch(/one accepted receipt|1件だけ採用|1つのreceipt|exactly one accepted/iu);
            expect(surface).toMatch(/project.*(context|文脈)/iu);
            expect(surface).toMatch(/authorize|authorization|権限|許可/iu);
        }

        expect(capability).toContain('mcp: []');
        expect(capability).toContain('POST http://127.0.0.1:39002/host/judgment/resolve');
        expect(runbook).toContain('structural filtering');
        expect(spec).toContain('Resolver determines classification');
        expect(story).toContain('trust-boundary defect');
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
    });
});
