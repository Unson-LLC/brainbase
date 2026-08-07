import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(path, 'utf8');
}

describe('judgment resolver publication surfaces', () => {
    // Trace: story-brainbase-judgment-resolver-v1:ac:14
    it('CLAUDEとAGENTSのalways-loaded host contractを同一に保つ', () => {
        const claude = read('CLAUDE.md');
        const agents = read('AGENTS.md');
        expect(agents).toBe(claude);
        expect(claude).toContain('brainbase_judgment_resolve');
        expect(claude).toContain('各Brainbase管理対象turn');
        expect(claude).toContain('選択されたactive DAGだけ');
        expect(claude).toContain('write/external');
    });

    it('Skill・capability・runbook・catalogを相互参照可能にする', () => {
        const skill = read('.claude/skills/brainbase-judgment-resolver/SKILL.md');
        const capability = read('docs/brainbase-capabilities/capabilities/judgment.resolve.yml');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');
        const catalog = read('docs/brainbase-capabilities/README.md');
        const capabilityMap = read('.claude/skills/brainbase-capability-map/SKILL.md');

        expect(skill).toContain('judgment.resolve.yml');
        expect(skill).toContain('brainbase_judgment_resolve');
        expect(skill).toContain('required_capabilities');
        expect(skill).toContain('active_node_definitions');
        expect(capability).toContain('id: judgment.resolve');
        expect(capability).toContain('conversation_context');
        expect(capability).toContain('receipt does not authorize');
        expect(runbook).toContain('management_status=managed');
        expect(runbook).toContain('conversation_context');
        expect(runbook).toContain('active_node_definitions');
        expect(catalog).toContain('`judgment.resolve`');
        expect(capabilityMap).toContain('`judgment.resolve`');
    });

    it('binding secretをenv・MCP preflight・運用手順へ公開する', () => {
        const envExample = read('.env.example');
        const launcher = read('scripts/run-brainbase-mcp.sh');
        const runbook = read('docs/brainbase-capabilities/runbooks/judgment-resolve.md');

        expect(envExample).toContain('BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(envExample).toContain('BRAINBASE_JUDGMENT_ADAPTER_ID=brainbase-mcp');
        expect(launcher).toContain('missing BRAINBASE_JUDGMENT_BINDING_SECRET');
        expect(launcher).toContain('BRAINBASE_JUDGMENT_BINDING_SECRET must be at least 32 characters');
        expect(launcher).toContain('preflight-judgment-binding.js');
        expect(runbook).toContain('Binding secret provisioning and rotation');
        expect(runbook).toContain('scripts/run-brainbase-mcp.sh --check');
        expect(runbook).toContain('signed read-only probe');
    });
});
